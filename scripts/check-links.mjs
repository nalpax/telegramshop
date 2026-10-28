// Checks every external link used in the course data. Run on YOUR machine (needs internet):  npm run check-links
// Output: OK / REDIRECT (shows where it goes) / BLOCKED (site refuses bots — open it by hand) / BROKEN (404, DNS, timeout).
import { readFile, readdir } from 'node:fs/promises';
const dataDir = new URL('../data/', import.meta.url);
const sources = new Map();
const add = (text, where) => { for (const m of String(text).matchAll(/https?:\/\/[^\s)\]>"'`\\,;]+/g)) { const url = m[0].replace(/[.,:;!?»]+$/, ''); if (/ИМЯ|example\.|localhost|YOUR/i.test(url)) continue; (sources.get(url) || sources.set(url, new Set()).get(url)).add(where); } };
for (const name of await readdir(dataDir)) if (name.endsWith('.json')) add(await readFile(new URL(name, dataDir), 'utf8'), name);
add(await readFile(new URL('../public/js/course.js', import.meta.url), 'utf8'), 'public/js/course.js');
const urls = [...sources.keys()].sort(); const results = [];
async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const response = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'ru,en;q=0.8' } });
      if (response.status === 405 || response.status === 501) continue;
      const moved = response.redirected && new URL(response.url).pathname !== new URL(url).pathname;
      const kind = response.ok ? (moved ? 'REDIRECT' : 'OK') : [401, 403, 429, 451, 999].includes(response.status) ? 'BLOCKED' : 'BROKEN';
      return { url, kind, status: response.status, to: moved ? response.url : '' };
    } catch (error) { if (method === 'GET') return { url, kind: 'BROKEN', status: 0, to: String(error.cause?.code || error.name) }; }
  }
}
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (next < urls.length) { const url = urls[next++]; results.push(await check(url)); } }));
const order = { BROKEN: 0, BLOCKED: 1, REDIRECT: 2, OK: 3 };
for (const r of results.sort((a, b) => order[a.kind] - order[b.kind] || a.url.localeCompare(b.url))) console.log(`${r.kind.padEnd(8)} ${String(r.status).padEnd(4)} ${r.url}${r.to ? '  →  ' + r.to : ''}  [${[...sources.get(r.url)].slice(0, 2).join(', ')}]`);
const broken = results.filter(r => r.kind === 'BROKEN').length;
console.log(`\nВсего ссылок: ${results.length}. Не работают: ${broken}. Закрыты для ботов (проверить вручную): ${results.filter(r => r.kind === 'BLOCKED').length}.`);
process.exitCode = broken ? 1 : 0;
