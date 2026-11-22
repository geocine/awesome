// Fetches all starred repos and GitHub star lists via the gh CLI and writes data/stars.json.
// Usage: node scripts/fetch-stars.mjs   (requires `gh auth login`)
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function gql(query, vars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v != null) args.push('-F', `${k}=${v}`);
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const json = JSON.parse(out);
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const STARS = `query($cursor:String){ viewer { login starredRepositories(first:100, after:$cursor, orderBy:{field:STARRED_AT,direction:DESC}) {
  pageInfo{hasNextPage endCursor}
  edges { starredAt node { nameWithOwner url description homepageUrl stargazerCount forkCount isArchived pushedAt
    primaryLanguage{name color} repositoryTopics(first:8){nodes{topic{name}}} owner{avatarUrl} } } } } }`;

const LISTS = `{ viewer { lists(first:100){ nodes { id name slug description } } } }`;
const LIST_ITEMS = `query($id:ID!,$cursor:String){ node(id:$id){ ... on UserList { items(first:100, after:$cursor){
  pageInfo{hasNextPage endCursor} nodes { ... on Repository { nameWithOwner } } } } } }`;

let login;
const stars = [];
for (let cursor = null; ;) {
  const d = gql(STARS, { cursor }).viewer;
  login = d.login;
  for (const e of d.starredRepositories.edges) {
    const n = e.node;
    stars.push({
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
      starredAt: e.starredAt,
      avatar: n.owner.avatarUrl,
    });
  }
  process.stderr.write(`stars: ${stars.length}\r`);
  if (!d.starredRepositories.pageInfo.hasNextPage) break;
  cursor = d.starredRepositories.pageInfo.endCursor;
}

const lists = gql(LISTS).viewer.lists.nodes.map((l) => ({ ...l, repos: [] }));
for (const l of lists) {
  for (let cursor = null; ;) {
    const items = gql(LIST_ITEMS, { id: l.id, cursor }).node.items;
    l.repos.push(...items.nodes.map((n) => n.nameWithOwner).filter(Boolean));
    if (!items.pageInfo.hasNextPage) break;
    cursor = items.pageInfo.endCursor;
  }
}

const membership = new Map();
for (const l of lists) for (const r of l.repos) membership.set(r, [...(membership.get(r) ?? []), l.slug]);

const overridesPath = path.join(root, 'data', 'descriptions.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};

for (const s of stars) {
  s.lists = membership.get(s.name) ?? [];
  if (!s.description && overrides[s.name]) s.description = overrides[s.name];
}

for (const s of stars) s.source = 'starred';

// Archive: repos and links I used to star, kept by hand in data/archive.json.
// GitHub entries are enriched with live metadata; anything starred again is skipped.
const archivePath = path.join(root, 'data', 'archive.json');
const archiveSrc = existsSync(archivePath) ? JSON.parse(readFileSync(archivePath, 'utf8')) : [];
const ghRepo = (url) => url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
const ghEntries = archiveSrc.map((a, i) => ({ a, i, m: ghRepo(a.url) })).filter((e) => e.m);
const meta = new Map();
for (let b = 0; b < ghEntries.length; b += 40) {
  const chunk = ghEntries.slice(b, b + 40);
  const fields = chunk
    .map(
      ({ i, m }) => `r${i}: repository(owner:${JSON.stringify(m[1])}, name:${JSON.stringify(m[2])}) {
        nameWithOwner url description homepageUrl stargazerCount forkCount isArchived pushedAt
        primaryLanguage{name color} repositoryTopics(first:8){nodes{topic{name}}} owner{avatarUrl} }`,
    )
    .join('\n');
  // Missing (deleted) repos come back as null with an error; keep the partial data.
  const args = ['api', 'graphql', '-f', `query={ ${fields} }`];
  let json;
  try {
    json = JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (e) {
    json = JSON.parse(e.stdout);
  }
  for (const [k, v] of Object.entries(json.data ?? {})) if (v) meta.set(Number(k.slice(1)), v);
}

const starredNames = new Set(stars.map((s) => s.name.toLowerCase()));
const archive = [];
for (const [i, a] of archiveSrc.entries()) {
  const n = meta.get(i);
  if (n && starredNames.has(n.nameWithOwner.toLowerCase())) continue;
  archive.push(
    n
      ? {
          name: n.nameWithOwner,
          url: n.url,
          description: a.description || n.description,
          homepage: n.homepageUrl || null,
          stars: n.stargazerCount,
          forks: n.forkCount,
          language: n.primaryLanguage?.name ?? null,
          languageColor: n.primaryLanguage?.color ?? null,
          topics: n.repositoryTopics.nodes.map((t) => t.topic.name),
          archived: n.isArchived,
          pushedAt: n.pushedAt,
          starredAt: null,
          avatar: n.owner.avatarUrl,
          lists: [a.list],
          source: 'archive',
        }
      : {
          name: a.title,
          url: a.url,
          description: a.description,
          homepage: null,
          stars: null,
          forks: null,
          language: null,
          languageColor: null,
          topics: [],
          archived: false,
          pushedAt: null,
          starredAt: null,
          avatar: null,
          lists: [a.list],
          source: 'archive',
        },
  );
}

const out = {
  user: login,
  generatedAt: new Date().toISOString(),
  lists: lists.map(({ id, repos, ...l }) => ({ ...l, count: repos.length })),
  stars,
  archive,
};
writeFileSync(path.join(root, 'data', 'stars.json'), JSON.stringify(out, null, 1) + '\n');

const uncategorized = stars.filter((s) => !s.lists.length).map((s) => s.name);
const missing = stars.filter((s) => !s.description).map((s) => s.name);
console.error(`\n${stars.length} stars, ${lists.length} lists`);
if (uncategorized.length) console.error(`Not in any list (${uncategorized.length}):\n  ${uncategorized.join('\n  ')}`);
if (missing.length) console.error(`No description (${missing.length}), add to data/descriptions.json:\n  ${missing.join('\n  ')}`);
