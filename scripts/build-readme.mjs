// Generates README.md from data/stars.json (current stars + archive).
// Usage: node scripts/build-readme.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CATEGORY_ORDER, primaryCategory } from './categories.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data', 'stars.json'), 'utf8'));
const archive = data.archive ?? [];

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
// README is emoji-free: strip pictographs, flags, modifiers and :shortcodes:.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const SHORTCODE = /(^|\s):[a-z0-9_+-]{2,}:(?=\s|$)/g;
const noEmoji = (s) => (s ?? '').replace(EMOJI, ' ').replace(SHORTCODE, '$1');
const listName = (l) => noEmoji(l?.name ?? 'Uncategorized').trim();
const clean = (s) =>
  noEmoji(s)
    .replace(/\s+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();

const entry = (r) => {
  const desc = clean(r.description);
  const meta = [r.stars != null ? `${fmt(r.stars)} stars` : null, r.archived ? 'read-only' : null].filter(Boolean);
  return `- [${r.name}](${r.url})${desc ? ` - ${desc}` : ''}${meta.length ? ` (${meta.join(', ')})` : ''}`;
};
const byStarsThenName = (a, b) => (b.stars ?? -1) - (a.stars ?? -1) || a.name.localeCompare(b.name);

const lists = new Map(data.lists.map((l) => [l.slug, l]));
const groups = new Map(CATEGORY_ORDER.map((slug) => [slug, { stars: [], archive: [] }]));
const groupFor = (slug) => {
  if (!groups.has(slug)) groups.set(slug, { stars: [], archive: [] });
  return groups.get(slug);
};
for (const s of data.stars) groupFor(primaryCategory(s.lists)).stars.push(s);
for (const a of archive) groupFor(primaryCategory(a.lists)).archive.push(a);
const used = [...groups].filter(([, g]) => g.stars.length + g.archive.length);

const out = [];
out.push('# awesome');
out.push('');
out.push(
  'My awesome list, everyone has one. Every repository I have starred on GitHub, sorted into categories with a short description of each.',
);
out.push('');
out.push(
  `${(data.stars.length + archive.length).toLocaleString('en-US')} items in ${used.length} categories, then grouped by language. ` +
    'Each item appears once, under its most specific category. "Archive" holds older bookmarks I kept from before. ' +
    '"read-only" marks repos archived by their owners.',
);
out.push('');
out.push(
  `**Browse and search it at [geocine-awesome.netlify.app](https://geocine-awesome.netlify.app/)**, where each item shows every category it belongs to. Last updated ${data.generatedAt.slice(0, 10)}.`,
);
out.push('');
out.push('## Contents');
out.push('');
for (const [slug, g] of used) {
  out.push(`- [${listName(lists.get(slug))}](#${slug}) (${g.stars.length + g.archive.length} items)`);
}
out.push('');

for (const [slug, g] of used) {
  out.push(`<a id="${slug}"></a>`);
  out.push('');
  out.push(`## ${listName(lists.get(slug))}`);
  out.push('');

  const byLang = new Map();
  for (const r of g.stars) {
    const lang = r.language ?? 'Other';
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(r);
  }
  const langs = [...byLang.entries()].sort(
    (a, b) => (a[0] === 'Other') - (b[0] === 'Other') || b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  const block = (summary, items) => {
    out.push(`<details><summary>${summary} (${items.length})</summary>`);
    out.push('');
    for (const r of items.toSorted(byStarsThenName)) out.push(entry(r));
    out.push('');
    out.push('</details>');
    out.push('');
  };
  for (const [lang, items] of langs) block(`<b>${lang}</b>`, items);
  if (g.archive.length) block('<b>Archive</b> <i>previously starred</i>', g.archive);
}

writeFileSync(path.join(root, 'README.md'), out.join('\n').trimEnd() + '\n');
console.log(`README.md written: ${data.stars.length} starred + ${archive.length} archived in ${used.length} categories`);
