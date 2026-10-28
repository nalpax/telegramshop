// Builds the server-side content files from the owner's reviewed package
// (Vibentry_MiniApp_Handoff). Usage: node scripts/import-package.mjs <path-to-package>
// Writes: data/lessons.json, data/resources.json, data/prompts.json, data/articles.json,
//         data/free-lessons.json (lesson 01 only) and public/assets/lessons/*.png.
// The paid files are git-ignored. Run it on the owner's machine/server, not in public CI.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('Usage: node scripts/import-package.mjs <package-folder>'); process.exit(1); }
const text = rel => readFile(path.join(root, rel), 'utf8');
const json = rel => text(rel).then(JSON.parse);
const write = (file, value) => writeFile(file, JSON.stringify(value, null, 1) + '\n');
const clean = s => s.replace(/^[\p{Extended_Pictographic}️\s]+/u, '').trim();
const stripHtmlComments = s => s.replace(/<!--[\s\S]*?-->/g, '');

function codeBlocks(md) {
  const blocks = []; const re = /```[\w]*\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(md))) blocks.push(m[1].replace(/\s+$/, ''));
  return blocks;
}
function splitLesson(md, id) {
  md = stripHtmlComments(md).replace(/\r\n?/g, '\n').trim();
  const lines = md.split('\n');
  const head = lines.shift().match(/^##\s+(\d+)\.\s+(.*)$/);
  if (!head || Number(head[1]) !== id) throw new Error(`Lesson ${id}: unexpected title line`);
  const rest = lines.join('\n').trim();
  // "Что вы получите" → outcome (first paragraph). "Готово, когда" → task.
  const outcomeRe = /^#{3,4}\s+Что вы получите\s*\n+([\s\S]*?)(?:\n\n|$)/m;
  const outcomeMatch = rest.match(outcomeRe);
  const outcome = outcomeMatch ? outcomeMatch[1].trim() : '';
  let body = outcomeMatch ? rest.replace(outcomeRe, '').trim() : rest;
  const taskRe = /\n?^(#{3,4}\s+Готово, когда\s*\n[\s\S]*)$/m;
  const taskMatch = body.match(taskRe);
  const task = taskMatch ? taskMatch[1].trim() : '';
  if (taskMatch) body = body.replace(taskRe, '').trim();
  if (!outcome) throw new Error(`Lesson ${id}: the "Что вы получите" block is missing`);
  return { id, title: head[2].trim(), outcome, markdown: body, task, confirmation: task ? 'Всё из списка выполнено' : 'Урок прочитан, можно идти дальше' };
}

const lessons = [];
for (let n = 1; n <= 24; n++) lessons.push(splitLesson(await text(`02_content/01_course/paid/${String(n).padStart(2, '0')}.md`), n));
// Lesson links such as (10.md) become in-app routes.
const articleLinks = md => md.replace(/\]\(03_client_search_prompt\.txt\)/g, '](#article?id=clients-search-prompt)').replace(/\]\(02_coffee_creation_prompt\.txt\)/g, '](#article?id=cases-coffee-prompt)');
const route = md => articleLinks(md).replace(/\]\((?:paid\/)?(\d{2})\.md\)/g, (_, n) => `](#lesson?id=${Number(n)})`);
for (const lesson of lessons) { lesson.markdown = route(lesson.markdown); lesson.task = route(lesson.task); }
await mkdir('data', { recursive: true });
await write('data/lessons.json', lessons);
await write('data/free-lessons.json', [lessons[0]]);

// Short copyable materials: code blocks taken verbatim from lessons.
const blocks = n => codeBlocks(stripHtmlComments(lessons[n - 1].markdown));
const resources = {
  notes: blocks(2)[2], 'first-prompt': blocks(3)[0], 'mobile-prompt': blocks(5)[0],
  'brief-prompt': blocks(6).slice(0, 3).join('\n\n'), 'reply-prompt': blocks(18)[3],
  estimate: blocks(20)[0], offer: blocks(20)[1], handover: blocks(22)[0],
};
for (const [key, value] of Object.entries(resources)) if (!value) throw new Error(`Resource ${key} was not found in lessons`);
await write('data/resources.json', resources);

// Prompt library (IDs 001–200 are kept as they are).
const prompts = await json('02_content/02_prompts/prompts.json');
const categories = await json('07_data/prompt_categories.json');
const list = Array.isArray(prompts) ? prompts : prompts.prompts;
if (list.length !== 200 || list.some((p, i) => p.id !== String(i + 1).padStart(3, '0'))) throw new Error('Prompt IDs must be 001–200 in order');
// v0.5: data/prompts.json now holds 300 prompts (201–300 written for the app). Never overwrite a larger library with the original 200.
const existing = await readFile(new URL('../data/prompts.json', import.meta.url), 'utf8').then(JSON.parse, () => null);
if (existing?.items?.length > 200) console.log('Kept data/prompts.json (' + existing.items.length + ' prompts).'); else await write('data/prompts.json', { categories: categories.map(c => ({ id: c.id, title: c.title.replace(/^\d+\.\s*/, ''), ids: c.prompt_ids })), items: list.map(p => ({ id: p.id, title: p.title, use: p.use, prompt: p.prompt })) });

// Articles (База).
const G = { start: 'Старт', tools: 'Инструменты и ресурсы', niches: 'Ниши и услуги', clients: 'Клиенты', orders: 'Заказы', cases: 'Кейсы' };
const articles = [];
async function addMd(id, group, rel, description, extra = {}) {
  const titleOverride = extra.title; delete extra.title;
  let md = stripHtmlComments(await text(rel)).replace(/\r\n?/g, '\n').trim();
  const m = md.match(/^#\s+(.*)\n+/); let title = titleOverride || (m ? clean(m[1]) : id);
  if (m) md = md.slice(m[0].length);
  articles.push({ id, group, groupTitle: G[group], title, description, markdown: route(md.replace(/\]\((?:\.\.\/01_course\/)?(?:paid\/)?(\d{2})\.md\)/g, '](#lesson?id=$1)')), ...extra });
}
async function addTxt(id, group, title, description, rel, intro = '') {
  const body = (await text(rel)).trim();
  articles.push({ id, group, groupTitle: G[group], title, description, markdown: `${intro}${intro ? '\n\n' : ''}\`\`\`text\n${body}\n\`\`\`` });
}
await addMd('start-how', 'start', '02_content/01_course/front_full.md', 'Как идти по курсу и где искать помощь', { free: true });
await addMd('tools-models', 'tools', '02_content/03_resources/01_models_tools.md', 'Модели и агенты: что для чего подходит');
await addMd('tools-resources', 'tools', '02_content/03_resources/02_useful_resources.md', 'Шрифты, иконки, фото и палитры');
await addMd('tools-publishing', 'tools', '02_content/03_resources/03_publishing_integrations.md', 'Хостинг, домен, формы и статистика');
await addMd('tools-suppliers', 'tools', '02_content/03_resources/05_suppliers.md', 'Список поставщиков подписок от автора');
await addMd('clients-first', 'clients', '02_content/05_clients/01_first_clients.md', 'Где искать первых клиентов');
await addMd('clients-bigger', 'clients', '02_content/05_clients/02_larger_projects.md', 'Как выходить на проекты крупнее');
await addMd('clients-ai-search', 'clients', '02_content/05_clients/04_ai_search_intro.md', 'Как поручить поиск ChatGPT', { title: 'Как поручить поиск клиентов ChatGPT' });
await addTxt('clients-search-prompt', 'clients', 'Промпт для поиска клиентов', 'Текст для копирования: заполните поля в скобках', '02_content/05_clients/03_client_search_prompt.txt');
await addMd('clients-cold-calls', 'clients', '02_content/05_clients/05_cold_calls.md', 'Как начать разговор по телефону');
await addMd('orders-brief', 'orders', '02_content/06_orders/01_client_brief.md', 'Что спросить до начала работы');
await addMd('orders-price', 'orders', '02_content/06_orders/02_pricing_and_offer.md', 'Цена и предложение клиенту');
await addMd('orders-revisions', 'orders', '02_content/06_orders/03_revisions.md', 'Правки без споров');
await addMd('orders-delivery', 'orders', '02_content/06_orders/04_delivery.md', 'Как сдать сайт клиенту');
await addMd('cases-coffee', 'cases', '02_content/07_cases/03_coffee_caption.md', 'Готовый учебный сайт кофейни');
await addMd('cases-coffee-source', 'cases', '02_content/07_cases/04_source_caption.md', 'Что лежит в архиве с исходниками');
await addTxt('cases-coffee-prompt', 'cases', 'Промпт, по которому создан сайт кофейни', 'Полный текст запроса', '02_content/07_cases/02_coffee_creation_prompt.txt');
await addMd('cases-coffee-full', 'cases', '02_content/07_cases/01_coffee_case.md', 'Разбор учебного проекта');
await addMd('start-appendix', 'start', '02_content/01_course/appendix.md', 'Шаблоны и ссылки по урокам');
// Niches and services from structured data.
const asArticle = (item, group, description) => {
  const sections = item.sections?.length ? item.sections : [{ heading: '', body: item.text }];
  const md = sections.map(s => `${s.heading ? `### ${s.heading}\n\n` : ''}${Array.isArray(s.body) ? s.body.map(x => `- ${x}`).join('\n') : s.body.split(/\n{2,}/).map(x => x.trim()).filter(Boolean).join('\n\n')}`).join('\n\n');
  articles.push({ id: item.id, group, groupTitle: G[group], title: item.title, description, markdown: md });
};
for (const s of await json('07_data/services.json')) asArticle(s, 'niches', 'Услуга: что продаём и кому');
for (const n of await json('07_data/niches.json')) asArticle(n, 'niches', 'Ниша: кого искать и что предложить');
// Order: group order, then as written.
const order = Object.keys(G); articles.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
await write('data/articles.json', articles);

// Screenshots used inside lessons.
await mkdir('public/assets/lessons', { recursive: true });
for (const file of await readdir(path.join(root, '02_content/01_course/assets'))) if (/\.(png|jpe?g|webp)$/i.test(file)) await copyFile(path.join(root, '02_content/01_course/assets', file), path.join('public/assets/lessons', file));
console.log(`Imported ${lessons.length} lessons, ${Object.keys(resources).length} materials, ${list.length} prompts in ${categories.length} categories, ${articles.length} articles.`);
