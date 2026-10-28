import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function walk(dir) { const all = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) all.push(...await walk(file)); else if (/\.(mjs|js)$/.test(entry.name)) all.push(file); } return all; }
for (const file of [...await walk('public/js'), ...await walk('server'), ...await walk('scripts'), ...await walk('tests')]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const file of ['public/assets/brand.png', 'public/assets/hero.png', 'data/free-lessons.json']) await access(file);
const data = JSON.parse(await readFile('data/free-lessons.json', 'utf8'));
if (data.length !== 1 || data[0].id !== 1 || !(data[0].sections?.length || data[0].markdown)) throw new Error('Exactly one real free lesson is required');
console.log('Syntax, assets and the free lesson: OK. No build step required.');
