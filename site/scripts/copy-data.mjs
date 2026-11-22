// Copies ../data/stars.json into public/ so Vite serves it and bundles it into dist/.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(site, 'public'), { recursive: true });
copyFileSync(path.join(site, '..', 'data', 'stars.json'), path.join(site, 'public', 'stars.json'));
console.log('copied data/stars.json -> site/public/stars.json');
