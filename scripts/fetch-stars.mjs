// Updates data/stars.json from GitHub via the gh CLI.
// Usage: node scripts/fetch-stars.mjs   (requires `gh auth login`)
//
// data/stars.json is the record of truth: repos stay in it after they are unstarred
// on GitHub, keeping their original star date and categories. Each run:
//   - adds anything newly starred (with its star lists) to the saved data,
//   - refreshes metadata (stars, description, language...) for every saved repo,
//   - rebuilds the archive from data/archive.json.
// To drop a repo for good, delete it from data/stars.json by hand.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data', 'stars.json');
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);

function gql(query, vars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v != null) args.push('-F', `${k}=${v}`);
  const json = JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const REPO_FIELDS = `nameWithOwner url description homepageUrl stargazerCount forkCount isArchived pushedAt
  primaryLanguage{name color} repositoryTopics(first:8){nodes{topic{name}}} owner{avatarUrl}`;

const toRepo = (n) => ({
  name: n.nameWithOwner,
  url: n.url,
  description: n.description,
  homepage: n.homepageUrl || null,
  stars: n.stargazerCount,
  forks: n.forkCount,
  language: n.primaryLanguage?.name ?? null,
  languageColor: n.primaryLanguage?.color ?? null,
  topics: n.repositoryTopics.nodes.map((t) => t.topic.name),
  archived: n.isArchived,
  pushedAt: n.pushedAt,
  avatar: n.owner.avatarUrl,
});

/** Looks up many repos by "owner/name", 40 per query. Missing (deleted) repos are absent from the result. */
function repoMeta(names) {
  const found = new Map();
  for (let b = 0; b < names.length; b += 40) {
    const chunk = names.slice(b, b + 40);
    const fields = chunk
      .map((full, i) => {
        const [owner, name] = full.split('/');
        return `r${i}: repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)}) { ${REPO_FIELDS} }`;
      })
      .join('\n');
    let json;
    try {
      const out = execFileSync('gh', ['api', 'graphql', '-f', `query={ ${fields} }`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      json = JSON.parse(out);
    } catch (e) {
      json = JSON.parse(e.stdout); // partial data when some repos no longer exist
    }
    for (const [k, v] of Object.entries(json.data ?? {})) if (v) found.set(chunk[Number(k.slice(1))], v);
    process.stderr.write(`metadata: ${Math.min(b + 40, names.length)}/${names.length}\r`);
  }
  process.stderr.write('\n');
  return found;
}

// ---------- Live stars and lists ----------

const STARS = `query($cursor:String){ viewer { login starredRepositories(first:100, after:$cursor, orderBy:{field:STARRED_AT,direction:DESC}) {
  pageInfo{hasNextPage endCursor} edges { starredAt node { ${REPO_FIELDS} } } } } }`;
const LISTS = `{ viewer { lists(first:100){ nodes { id name slug description } } } }`;
const LIST_ITEMS = `query($id:ID!,$cursor:String){ node(id:$id){ ... on UserList { items(first:100, after:$cursor){
  pageInfo{hasNextPage endCursor} nodes { ... on Repository { nameWithOwner } } } } } }`;

let login;
const live = [];
for (let cursor = null; ;) {
  const d = gql(STARS, { cursor }).viewer;
  login = d.login;
  for (const e of d.starredRepositories.edges) live.push({ ...toRepo(e.node), starredAt: e.starredAt });
  process.stderr.write(`live stars: ${live.length}\r`);
  if (!d.starredRepositories.pageInfo.hasNextPage) break;
  cursor = d.starredRepositories.pageInfo.endCursor;
}
process.stderr.write('\n');

const liveLists = gql(LISTS).viewer.lists.nodes.map((l) => ({ ...l, repos: [] }));
for (const l of liveLists) {
  for (let cursor = null; ;) {
    const items = gql(LIST_ITEMS, { id: l.id, cursor }).node.items;
    l.repos.push(...items.nodes.map((n) => n.nameWithOwner).filter(Boolean));
    if (!items.pageInfo.hasNextPage) break;
    cursor = items.pageInfo.endCursor;
  }
}
const liveMembership = new Map();
for (const l of liveLists) for (const r of l.repos) liveMembership.set(r, [...(liveMembership.get(r) ?? []), l.slug]);

// ---------- Merge with saved data ----------

const saved = readJson(dataPath, { lists: [], stars: [] });
const overrides = readJson(path.join(root, 'data', 'descriptions.json'), {});

const lists = new Map(saved.lists.map(({ count, ...l }) => [l.slug, l]));
for (const { id, repos, ...l } of liveLists) lists.set(l.slug, l);

const byName = new Map(saved.stars.map((s) => [s.name.toLowerCase(), s]));
let added = 0;
for (const s of live) {
  const key = s.name.toLowerCase();
  const prev = byName.get(key);
  const liveLists = liveMembership.get(s.name) ?? [];
  if (!prev) added++;
  byName.set(key, {
    ...s,
    // Keep the original star date and categories if this repo was saved before.
    starredAt: prev?.starredAt ?? s.starredAt,
    lists: liveLists.length ? liveLists : (prev?.lists ?? []),
  });
}

// Refresh metadata for saved repos that are no longer starred on GitHub.
const liveNames = new Set(live.map((s) => s.name.toLowerCase()));
const stale = [...byName.values()].filter((s) => !liveNames.has(s.name.toLowerCase()));
const fresh = repoMeta(stale.map((s) => s.name));
for (const s of stale) {
  const n = fresh.get(s.name);
  if (n) byName.set(s.name.toLowerCase(), { ...s, ...toRepo(n), starredAt: s.starredAt, lists: s.lists });
}

const stars = [...byName.values()]
  .map((s) => ({
    ...s,
    description: s.description || overrides[s.name] || null,
    source: 'starred',
  }))
  .sort((a, b) => b.starredAt.localeCompare(a.starredAt));

// ---------- Archive (data/archive.json) ----------

const archiveSrc = readJson(path.join(root, 'data', 'archive.json'), []);
const ghName = (url) => url.match(/^https?:\/\/github\.com\/([^/]+\/[^/#?]+)/)?.[1];
const archiveMeta = repoMeta(archiveSrc.map((a) => ghName(a.url)).filter(Boolean));
const starredNames = new Set(stars.map((s) => s.name.toLowerCase()));
const archive = [];
for (const a of archiveSrc) {
  const n = archiveMeta.get(ghName(a.url));
  if (n && starredNames.has(n.nameWithOwner.toLowerCase())) continue;
  const base = n
    ? toRepo(n)
    : {
        name: a.title,
        url: a.url,
        homepage: null,
        stars: null,
        forks: null,
        language: null,
        languageColor: null,
        topics: [],
        archived: false,
        pushedAt: null,
        avatar: null,
      };
  archive.push({ ...base, description: a.description || base.description || null, starredAt: null, lists: [a.list], source: 'archive' });
}

// ---------- Write ----------

const counts = new Map();
for (const s of stars) for (const l of s.lists) counts.set(l, (counts.get(l) ?? 0) + 1);

writeFileSync(
  dataPath,
  JSON.stringify(
    {
      user: login,
      generatedAt: new Date().toISOString(),
      lists: [...lists.values()].map((l) => ({ ...l, count: counts.get(l.slug) ?? 0 })),
      stars,
      archive,
    },
    null,
    1,
  ) + '\n',
);

const uncategorized = stars.filter((s) => !s.lists.length).map((s) => s.name);
const missing = stars.filter((s) => !s.description).map((s) => s.name);
console.error(`${stars.length} saved stars (${live.length} live on GitHub, ${added} new), ${archive.length} archived, ${lists.size} lists`);
if (uncategorized.length) console.error(`Not in any list (${uncategorized.length}):\n  ${uncategorized.join('\n  ')}`);
if (missing.length) console.error(`No description (${missing.length}), add to data/descriptions.json:\n  ${missing.join('\n  ')}`);
