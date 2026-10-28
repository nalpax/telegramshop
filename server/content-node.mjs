// Node host: private course files live in data/ next to server/ (not in git, never served).
import { readFile } from 'node:fs/promises';
async function readOptional(name, fallback) {
  try { return JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function loadContent() {
  const freeLessons = JSON.parse(await readFile(new URL('../data/free-lessons.json', import.meta.url), 'utf8'));
  return {
    lessons: await readOptional('lessons.json', freeLessons),
    resources: await readOptional('resources.json', {}),
    prompts: await readOptional('prompts.json', { categories: [], items: [] }),
    articles: await readOptional('articles.json', []),
  };
}
