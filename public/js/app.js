import { icon, art } from './icons.js';
import { FREE_LESSONS, modules, lessons, materials } from './course.js';
import { renderMarkdown } from './markdown.js';
import { createAdmin, planBadge } from './admin.js';
import { installProtection } from './protect.js';
import { GROUPS, TERMS, linkTerms } from './glossary.js';
import { onboardingScreen } from './onboarding.js';
import { mountPractice, practiceList, practicePaywall, practiceScreen, setPracticeData } from './practice.js';
import { progress, saveProgress, complete, resetProgress, escape as e } from './state.js';

const app = document.querySelector('#app');
const overlay = document.querySelector('#overlay-root');
const tg = window.Telegram?.WebApp;
let config = { supportUsername: 'nalpax', preview: true };
let session = null;
let sessionError = false;
let bootstrapped = false;
let previewEntered = false;
let readerId = 0;
let readerCodes = [];
let catalogueTab = 'lessons';
let promptCategory = 'all';
let promptLimit = 30;
// First-visit questions (onboarding.js): current step, answers, and whether the tip is still on screen.
let obStep = 0; let obAnswers = {}; let obTip = false;
// «Практикум» trainers allowed or refused by the server in this app session (see practiceView).
const practiceStarted = new Set(); const practiceBlocked = new Set();
// Favourite prompts and ticked checklist items live on the server (/api/marks); recently copied prompts are a per-device convenience.
let marks = { favorites: [], tasks: {} };
const RECENT_KEY = 'vibentry.recent.v1'; const SCROLL_KEY = 'vibentry.scroll.v1';
const readLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
function pushRecent(id) { writeLocal(RECENT_KEY, [id, ...readLocal(RECENT_KEY, []).filter(x => x !== id)].slice(0, 12)); }
async function loadMarks() { if (config.preview || !session?.subscribed) return; try { marks = await getApi('/api/marks'); } catch {} }
async function saveMark(change) { if (config.preview) return true; try { marks = await sendApi('/api/marks', change); return true; } catch (error) { if (error.status === 403) openAccess(); else toast('Не удалось сохранить. Проверьте соединение.'); return false; } }
const library = { prompts: null, articles: null, failed: {} };
let renderEpoch = 0;
let promoApplied = null;
let checked = false;
let search = '';
let toastTimer;
let modalReturnFocus;
const freeCache = new Map();
const urlFor = (tab = 'lessons') => `#materials?tab=${tab}`;
async function loadLibrary(tab, force = false) {
  const kind = tab === 'prompts' ? 'prompts' : tab === 'base' ? 'articles' : null;
  if (!kind || (library[kind] && !force)) return;
  if (force) { library.failed[kind] = false; library[kind] = null; refreshResults(); }
  try {
    const response = await fetch(`/api/${kind}`, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (!response.ok) throw new Error('library unavailable');
    library[kind] = await response.json(); library.failed[kind] = false;
  } catch { library.failed[kind] = true; }
  refreshResults();
}
function refreshResults() { const box = document.querySelector('#catalogue-results'); if (box && route().name === 'materials') box.innerHTML = catalogueBody(catalogueTab); }

try { tg?.ready(); tg?.expand(); tg?.setHeaderColor('#061b12'); tg?.setBackgroundColor('#061b12'); } catch {}
try { tg?.BackButton.onClick(back); } catch {}

function route() { const [name, params] = (location.hash.slice(1) || 'home').split('?'); return { name, params: new URLSearchParams(params) }; }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function back() { const name = route().name; go(name === 'article' ? urlFor('base') : name === 'lesson' ? urlFor() : '#home'); }
function brand(compact = false) { return `<a href="#home" class="brand ${compact ? 'brand-compact' : ''}" aria-label="Vibentry — главная"><span class="brand-image"><img src="/assets/brand.png" alt="Знак ve. Vibentry" width="64" height="64"></span>${compact ? '' : '<span><strong>Vibentry<span class="brand-dot">.</span></strong><span class="brand-caption">База по вайбкодингу</span></span>'}</a>`; }
function nav(active) {
  const items = [['home', 'home', 'Главная'], ['materials', 'book', 'Материалы'], ['practice', 'play', 'Практикум'], ['profile', 'user', 'Профиль'], ...(session?.isAdmin ? [['admin', 'sparkle', 'Админка']] : [])];
  return `<nav class="bottom-nav" aria-label="Основная навигация"><a href="#home" class="nav-brand"><img src="/assets/brand.png" alt="" width="40" height="40"><span><strong>Vibentry</strong><small>курс по вайбкодингу</small></span></a>${items.map(([id, glyph, label]) => `<a href="#${id}" class="nav-item ${active === id ? 'is-active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')}${planChip()}</nav>`;
}
function planChip() { return session?.user ? `<div class="nav-plan">${planBadge(session.access?.active ? 'pro' : 'free')}<span>${e(session.user.first_name)}</span></div>` : ''; }
function heading(kicker, title, caption = '') { return `<div class="section-heading"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2></div>${caption ? `<span class="section-meta">${caption}</span>` : ''}</div>`; }
function hero() {
  return `<section class="hero" aria-labelledby="hero-title"><div class="hero-grid" aria-hidden="true"></div><div class="hero-copy"><span class="eyebrow">ПРАКТИЧЕСКИЙ КУРС</span><h1 id="hero-title">От идеи —<br>к своему сайту<span>.</span></h1><p>Учитесь. Собирайте. Запускайте.</p></div><img class="hero-art" src="/assets/hero.png" width="220" height="220" alt="" fetchpriority="high"></section>`;
}
function tile(title, subtitle, kind, hash, action = '') { return `<a class="quick-tile tile-${kind}" href="${hash}" ${action ? `data-action="${action}"` : ''}><div><h3>${title}</h3><p>${subtitle}</p></div>${art(kind)}<span class="tile-arrow">${icon('arrow')}</span></a>`; }
function home() {
  const next = lessons[progress.last - 1];
  const freeDone = lessons.filter(l => l.free).every(l => progress.done.includes(l.id)) && !session?.access?.active;
  const eyebrow = freeDone ? 'БЕСПЛАТНЫЕ УРОКИ ПРОЙДЕНЫ' : progress.done.length ? 'ВАШ СЛЕДУЮЩИЙ ШАГ' : 'НАЧНИТЕ С МАЛЕНЬКОГО';
  const title = freeDone ? 'Продолжим создавать?' : `${String(next.id).padStart(2, '0')} · ${e(next.title)}`;
  const label = freeDone ? 'Посмотреть полную программу' : progress.done.length ? 'Продолжить урок' : 'Начать бесплатно';
  const percent = Math.round(progress.done.length / 24 * 100);
  return `<header class="home-header">${brand()}</header>
  ${hero()}
  <section class="continue-card" aria-labelledby="continue-title"><div class="continue-top"><span class="eyebrow">${eyebrow}</span>${icon(freeDone ? 'check' : 'sparkle')}</div><h2 id="continue-title">${title}</h2><div class="progress-caption"><span>Пройдено ${progress.done.length} из 24 уроков</span><span>${percent}%</span></div><progress max="24" value="${progress.done.length}" aria-label="Прогресс курса"></progress>${freeDone ? `<a class="button button-primary" href="#next">${label}${icon('arrow')}</a>` : `<button class="button button-primary" data-action="lesson" data-id="${next.id}">${label}${icon('arrow')}</button>`}</section>
  <section class="quick-section" aria-labelledby="quick-title"><div class="section-heading"><h2 id="quick-title">Быстрый доступ</h2></div><div class="quick-grid">${tile('Уроки', `24 урока,<br>${FREE_LESSONS} бесплатно`, 'book', urlFor())}${tile('Промпты', '300 запросов<br>для ИИ', 'prompts', urlFor('prompts'))}${tile('База', 'Инструменты, ниши,<br>клиенты, заказы', 'files', urlFor('base'))}${tile(session?.access?.active ? 'Мой доступ' : 'Полный доступ', session?.access?.active ? 'Всё открыто,<br>навсегда' : priceLabel() ? `${priceLabel()}<br>навсегда` : 'Один платёж,<br>навсегда', 'plane', '#access', 'access')}</div></section>
  <a class="practice-teaser" href="#practice"><span class="practice-glyph">${icon('play')}</span><span><strong>Практикум</strong><small>Конструктор промпта, квиз, калькулятор оценки и проверка перед сдачей${session?.practice && !session.practice.unlimited ? ` · бесплатно ${session.practice.remaining} из ${session.practice.limit} запусков` : ''}</small></span>${icon('arrow')}</a>
  <p class="home-note">Одна сделанная страница полезнее десяти прочитанных.</p>${nav('home')}`;
}
// Shown after the last free lesson: what the buyer gets next, the price, one clear button. No invented reviews or income.
function afterFree() {
  const done = lessons.filter(l => l.free && progress.done.includes(l.id)).length;
  const next = modules.filter(m => m.start > FREE_LESSONS);
  const price = priceLabel();
  return `<header class="home-header">${brand()}</header><main class="after-free"><div class="after-badge">${icon('check')}</div><span class="eyebrow">МОДУЛЬ «${e(modules[0].title.toUpperCase())}» ПРОЙДЕН</span><h1>Первая страница готова<span>.</span></h1><p class="after-lead">Вы прошли ${done} из ${FREE_LESSONS} бесплатных уроков: от пустой папки до опубликованной страницы. Дальше — сайт, который можно показать клиенту, и первые заказы.</p>
  <section class="after-plan" aria-label="Что дальше">${next.map(m => `<div class="after-module"><span class="after-range">${m.range}</span><div><strong>${e(m.title)}</strong><small>${e(m.description)} · ${m.end - m.start + 1} ${plural(m.end - m.start + 1, 'урок', 'урока', 'уроков')}</small></div></div>`).join('')}<div class="after-module"><span class="after-range">${icon('copy')}</span><div><strong>300 промптов</strong><small>Готовые запросы для каждого этапа: от брифа до сдачи проекта</small></div></div><div class="after-module"><span class="after-range">${icon('file')}</span><div><strong>База материалов</strong><small>Инструменты, ниши, поиск клиентов, оценка и правки</small></div></div><div class="after-module"><span class="after-range">${icon('play')}</span><div><strong>«Практикум» без ограничений</strong><small>Конструктор промпта, квиз, калькулятор оценки, проверка перед сдачей</small></div></div></section>
  <div class="after-price">${price ? `<strong>${e(price)}</strong><span>один раз · доступ навсегда · без подписки</span>` : '<span>Цена появится перед началом продаж</span>'}</div>
  <button class="button button-primary" data-action="access">${price ? `Открыть весь курс за ${e(price)}` : 'Подробнее о полном доступе'}${icon('arrow')}</button><a class="button button-secondary" href="${urlFor()}">Вернуться к урокам</a><p class="welcome-note">Курс учит навыкам, но не гарантирует заказов и дохода.</p></main>${nav('home')}`;
}
// Module header: illustration, title, what it covers and a progress ring (steps of 10% are CSS classes: no inline styles).
function moduleCover(m) {
  const total = m.end - m.start + 1; const done = progress.done.filter(id => id >= m.start && id <= m.end).length;
  const locked = m.end > FREE_LESSONS && !session?.access?.active;
  const label = m.end <= FREE_LESSONS ? '<span class="free-label">Бесплатно после подписки</span>' : locked ? `<span class="cover-lock">${icon('lock')}Полный доступ</span>` : '';
  return `<div class="module-cover cover-${m.id}">${art(m.art)}<div class="cover-text"><span class="eyebrow">МОДУЛЬ ${m.id} · ${m.range}</span><h2>${e(m.title)}</h2><p>${e(m.description)}</p>${label}</div><span class="ring ring-${Math.round(done / total * 10) * 10}" role="img" aria-label="Пройдено ${done} из ${total}"><span>${done}/${total}</span></span></div>`;
}
let justDone = 0;
function lessonRow(lesson) {
  const done = progress.done.includes(lesson.id);
  const locked = !lesson.free && !session?.access?.active;
  const active = lesson.id === progress.last && !done && !locked;
  const note = active ? '<small>Ваш следующий шаг</small>' : done ? '<small>Пройдено</small>' : '';
  return `<button class="lesson-row ${active ? 'lesson-current' : ''} ${done ? 'lesson-done' : ''} ${locked ? 'lesson-locked' : ''} ${justDone === lesson.id ? 'just-done' : ''}" data-action="lesson" data-id="${lesson.id}"><span class="lesson-number">${String(lesson.id).padStart(2, '0')}</span><span class="lesson-info"><strong>${e(lesson.title)}</strong>${note}</span><span class="lesson-status ${done ? 'done-badge' : ''}">${icon(done ? 'check' : locked ? 'lock' : 'chevron')}</span></button>`;
}
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return b > 10 && b < 20 ? many : a === 1 ? one : a > 1 && a < 5 ? few : many; };
const matches = (query, ...parts) => !query || parts.join(' ').toLocaleLowerCase('ru').includes(query);
function libraryNotice(kind) {
  if (library.failed[kind]) return `<div class="empty-state">${icon('file')}<h2>Не удалось загрузить</h2><p>Проверьте соединение и попробуйте ещё раз.</p><button class="button button-primary" data-action="reload-library">Повторить${icon('arrow')}</button></div>`;
  if (library[kind]) return '';
  return '<div class="loading" role="status">Загружаем<span></span></div>';
}
function promptsBody(query) {
  const notice = libraryNotice('prompts'); if (notice) return notice;
  const { categories, items } = library.prompts;
  if (!items.length) return `<div class="empty-state">${icon('copy')}<h2>Промпты скоро появятся</h2><p>Библиотека из 300 запросов подключается вместе с остальными материалами курса.</p></div>`;
  const byId = new Map(items.map(item => [item.id, item]));
  const recent = readLocal(RECENT_KEY, []).filter(id => byId.has(id));
  const special = [['fav', 'Избранное', marks.favorites.length], ['recent', 'Недавние', recent.length]].filter(([, , n]) => n > 0).map(([id, label, n]) => `<button class="chip chip-special ${promptCategory === id ? 'selected' : ''}" data-action="prompt-category" data-id="${id}">${id === 'fav' ? icon('star') : icon('clock')}${label} <span>${n}</span></button>`).join('');
  const chips = `<div class="chips" role="group" aria-label="Категории промптов"><button class="chip ${promptCategory === 'all' ? 'selected' : ''}" data-action="prompt-category" data-id="all">Все ${items.length}</button>${special}${categories.map((c, i) => `<button class="chip ${promptCategory === c.id ? 'selected' : ''}" data-action="prompt-category" data-id="${e(c.id)}">${e(c.title)} <span>${c.ids.length}</span></button>`).join('')}</div>`;
  const ids = promptCategory === 'fav' ? marks.favorites : promptCategory === 'recent' ? recent : categories.find(c => c.id === promptCategory)?.ids;
  const chosen = promptCategory === 'all' || !ids ? items : ids.map(id => byId.get(id)).filter(Boolean);
  const all = chosen.filter(item => matches(query, item.id, item.title, item.use));
  const rows = all.slice(0, promptLimit); const rest = all.length - rows.length;
  const locked = !session?.access?.active;
  const star = item => { const on = marks.favorites.includes(item.id); return `<button class="fav-quick ${on ? 'is-on' : ''}" data-action="favorite" data-id="${e(item.id)}" aria-pressed="${on}" aria-label="${on ? 'Убрать из избранного' : 'В избранное'}: промпт ${e(item.id)}">${icon('star')}</button>`; };
  const more = rest > 0 ? `<button class="button button-secondary more-button" data-action="more-prompts">Показать ещё ${Math.min(30, rest)} · осталось ${rest}</button>` : '';
  const emptyFav = promptCategory === 'fav' && !all.length ? `<div class="empty-state">${icon('star')}<h2>Здесь будут избранные промпты</h2><p>Нажмите звёздочку рядом с промптом, чтобы он всегда был под рукой.</p></div>` : '';
  return `${chips}${emptyFav}<div class="prompt-list">${rows.map(item => `<div class="prompt-item">${star(item)}<button class="prompt-card ${locked ? 'is-locked' : ''}" data-action="prompt" data-id="${e(item.id)}"><span class="prompt-number">${e(item.id)}</span><span class="prompt-info"><strong>${e(item.title)}</strong><small>${e(item.use)}</small></span></button><button class="copy-quick ${locked ? 'is-locked' : ''}" data-action="quick-copy" data-id="${e(item.id)}" aria-label="${locked ? 'Откроется после покупки' : 'Скопировать промпт ' + e(item.id)}">${icon(locked ? 'lock' : 'copy')}</button></div>`).join('') || (emptyFav ? '' : emptySearch())}</div>${more}`;
}
function baseBody(query) {
  const notice = libraryNotice('articles'); if (notice) return notice;
  const items = library.articles.items.filter(a => matches(query, a.title, a.description, a.groupTitle));
  const groups = [...new Set(library.articles.items.map(a => a.group))];
  const locked = a => !a.free && !session?.access?.active;
  const sections = groups.map(group => {
    const rows = items.filter(a => a.group === group);
    if (!rows.length) return '';
    return `<section class="module-section">${heading('', e(rows[0].groupTitle), `${rows.length} ${plural(rows.length, 'материал', 'материала', 'материалов')}`)}<div class="lesson-list">${rows.map(a => `<button class="lesson-row base-row ${locked(a) ? 'lesson-locked' : ''}" data-action="article" data-id="${e(a.id)}"><span class="base-icon">${icon('file')}</span><span class="lesson-info"><strong>${e(a.title)}</strong><small>${a.free ? 'Открыт для всех · ' : ''}${e(a.description || '')}</small></span><span class="lesson-status">${icon(locked(a) ? 'lock' : 'chevron')}</span></button>`).join('')}</div></section>`;
  }).join('');
  const templates = materials.filter(m => matches(query, m.title, m.description));
  const templateBlock = templates.length ? `<section class="module-section">${heading('', 'Шаблоны из уроков', `${templates.length} ${plural(templates.length, 'шаблон', 'шаблона', 'шаблонов')}`)}<div class="lesson-list">${templates.map(m => `<button class="lesson-row base-row ${session?.access?.active ? '' : 'lesson-locked'}" data-action="resource" data-id="${e(m.id)}"><span class="base-icon">${icon('copy')}</span><span class="lesson-info"><strong>${e(m.title)}</strong><small>${e(m.description)}</small></span><span class="lesson-status">${icon(session?.access?.active ? 'chevron' : 'lock')}</span></button>`).join('')}</div></section>` : '';
  return (sections + templateBlock) || emptySearch();
}
function catalogueBody(tab) {
  const query = search.trim().toLocaleLowerCase('ru');
  if (tab === 'prompts') return promptsBody(query);
  if (tab === 'base') return baseBody(query);
  if (tab === 'terms') return termsBody(query);
  return modules.map(m => {
    const rows = lessons.filter(l => l.module === m.id && matches(query, l.title, l.id));
    if (!rows.length) return '';
    return `<section class="module-section">${moduleCover(m)}<div class="lesson-list">${rows.map(lessonRow).join('')}</div></section>`;
  }).join('') || emptySearch();
}
// «Термины»: open to everyone; the term from a lesson (#materials?tab=terms&term=id) is highlighted.
let highlightTerm = '';
function termsBody(query) {
  const rows = TERMS.filter(t => matches(query, t.title, t.text));
  const sections = GROUPS.map(([id, title]) => { const items = rows.filter(t => t.group === id); return items.length ? `<section class="module-section">${heading('', title, `${items.length} ${plural(items.length, 'термин', 'термина', 'терминов')}`)}<div class="term-list">${items.map(t => `<article class="term-card ${highlightTerm === t.id ? 'is-highlighted' : ''}" id="term-${t.id}"><h3>${e(t.title)}</h3><p>${e(t.text)}</p></article>`).join('')}</div></section>` : ''; }).join('');
  return sections ? `<p class="practice-intro">Простые объяснения слов из уроков. В текстах такие слова подчёркнуты — нажмите на слово, чтобы увидеть объяснение.</p>${sections}` : emptySearch();
}
function openTerm(id) {
  const t = TERMS.find(x => x.id === id); if (!t) return;
  modal(e(t.title), `<p>${e(t.text)}</p><a class="button button-secondary" href="${urlFor('terms')}&term=${t.id}" data-action="all-terms">Все термины${icon('arrow')}</a>`);
}
function emptySearch() { return `<div class="empty-state">${icon('search')}<h2>Пока ничего не нашлось</h2><p>Попробуйте другое слово или номер.</p></div>`; }
const TABS = [['lessons', 'Уроки'], ['prompts', 'Промпты'], ['base', 'База'], ['terms', 'Термины']];
const PLACEHOLDER = { lessons: 'Найти урок', prompts: 'Найти промпт', base: 'Найти материал', terms: 'Найти термин' };
function catalogue(params) {
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'lessons';
  catalogueTab = tab; highlightTerm = tab === 'terms' ? params.get('term') || '' : '';
  if (highlightTerm) setTimeout(() => document.querySelector(`#term-${CSS.escape(highlightTerm)}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
  loadLibrary(tab);
  const banner = session?.access?.active ? '' : `<button class="access-banner" data-action="access"><span class="access-icon">${icon('lock')}</span><span><strong>Откройте весь Vibentry</strong><small>Уроки ${String(FREE_LESSONS + 1).padStart(2, '0')}–24, 300 промптов и вся база${priceLabel() ? ' · ' + priceLabel() + ' навсегда' : ''}</small></span>${icon('arrow')}</button>`;
  return `<header class="page-header">${brand(true)}<div><h1>Материалы</h1><p>Всё, что нужно для вашего сайта</p></div></header><div class="catalogue-tools"><nav class="segments" aria-label="Тип материалов">${TABS.map(([id, label]) => `<a href="${urlFor(id)}" class="${tab === id ? 'selected' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav><label class="search-box">${icon('search')}<input type="search" id="material-search" aria-label="${PLACEHOLDER[tab]}" placeholder="${PLACEHOLDER[tab]}" value="${e(search)}" autocomplete="off"></label></div><div id="catalogue-results">${catalogueBody(tab)}</div>${banner}${nav('materials')}`;
}
function errorPanel() { return `<section class="empty-state">${icon('file')}<h2>Материал не загрузился</h2><p>Проверьте соединение и попробуйте ещё раз.</p><button class="button button-primary" data-action="retry">Повторить ${icon('arrow')}</button></section>`; }
function copyBlocks(markdown) { const { html, codes } = renderMarkdown(markdown); return { html, codes }; }
function lessonHtml(id, meta, content) {
  let bodyHtml; let codes = [];
  if (content.markdown) { ({ html: bodyHtml, codes } = copyBlocks(content.markdown)); }
  else bodyHtml = content.sections.map(section => `<section>${section.title ? `<h2>${e(section.title)}</h2>` : ''}${section.paragraphs?.map(p => `<p>${e(p)}</p>`).join('') || ''}${section.list ? `<ol>${section.list.map(p => `<li>${e(p)}</li>`).join('')}</ol>` : ''}${section.code ? `<div class="code-panel"><div class="code-toolbar"><span>ПРОМПТ</span><button data-action="copy-section" data-index="${content.sections.indexOf(section)}"><span class="copy-label">Копировать</span></button></div><pre><code>${e(section.code)}</code></pre></div>` : ''}</section>`).join('');
  let practice;
  if (content.markdown) {
    const task = content.task ? copyBlocks(content.task) : { html: '', codes: [] };
    codes = codes.concat(task.codes);
    practice = `<section class="practice"><span class="eyebrow">ПРОВЕРЬТЕ СЕБЯ</span>${task.html ? `<div class="practice-body article-body">${task.html.replace(/data-index="(\d+)"/g, (_, n) => `data-index="${Number(n) + (codes.length - task.codes.length)}"`)}</div>` : ''}<label class="task-check"><input type="checkbox" id="task-done" ${checked ? 'checked' : ''}><span class="check-visual">${icon('check')}</span><span>${e(content.confirmation || 'Урок пройден')}</span></label></section>`;
  } else {
    practice = `<section class="practice"><span class="eyebrow">СДЕЛАЙТЕ СЕЙЧАС</span><h2>Попробуйте на своём проекте</h2><p>${e(content.task)}</p><label class="task-check"><input type="checkbox" id="task-done" ${checked ? 'checked' : ''}><span class="check-visual">${icon('check')}</span><span>${e(content.confirmation)}</span></label></section>`;
  }
  readerCodes = codes;
  const upcoming = lessons[id];
  const nextLocked = upcoming && !upcoming.free && !session?.access?.active;
  const footnote = !upcoming ? '<p class="reader-footnote">Вы прошли весь курс. Пора применять знания!</p>'
    : id === FREE_LESSONS && nextLocked ? `<a class="next-lesson" href="#next"><span><small>Бесплатная часть пройдена</small><strong>Что дальше в курсе</strong></span>${icon('arrow')}</a>`
    : `<button class="next-lesson ${nextLocked ? 'is-locked' : ''}" data-action="lesson" data-id="${upcoming.id}"><span><small>Следующий урок</small><strong>${String(upcoming.id).padStart(2, '0')} · ${e(upcoming.title)}</strong></span>${icon(nextLocked ? 'lock' : 'arrow')}</button>`;
  return `<header class="reader-header"><a href="${urlFor()}" class="back-link">${icon('back')}Все уроки</a>${brand(true)}</header><article class="lesson-article"><div class="reader-meta"><span class="eyebrow">УРОК ${String(id).padStart(2, '0')} / 24</span><span class="free-label">${meta.free ? 'Бесплатно' : 'Полный доступ'}</span></div><h1>${e(meta.title)}</h1><div class="outcome">${icon('target')}<p><span>РЕЗУЛЬТАТ УРОКА</span>${e(content.outcome)}</p></div><div class="article-body">${bodyHtml}</div>${practice}<button class="button button-primary finish-button" data-action="finish" ${checked ? '' : 'disabled'}>${progress.done.includes(id) ? 'К следующему шагу' : 'Завершить урок'}${icon('arrow')}</button>${footnote}</article>`;
}
async function reader(id, epoch) {
  const meta = lessons.find(l => l.id === id);
  if (!meta || (!meta.free && !session?.access?.active)) { go(urlFor()); openAccess(); return; }
  readerId = id; progress.last = id; saveProgress(); checked = progress.done.includes(id);
  app.innerHTML = `<header class="reader-header"><a href="${urlFor()}" class="back-link">${icon('back')}Все уроки</a>${brand(true)}</header><div class="loading" role="status">Загружаем урок<span></span></div>`;
  let content = meta.free ? freeCache.get(id) : null;
  if (!content) {
    try {
      const response = await fetch(`/api/lessons/${id}`, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
      if (!response.ok) throw new Error('lesson unavailable');
      content = await response.json(); if (meta.free) freeCache.set(id, content);
    } catch { if (epoch === renderEpoch) app.innerHTML = `<a href="${urlFor()}" class="back-link">${icon('back')}Все уроки</a>${errorPanel()}`; return; }
  }
  if (epoch !== renderEpoch) return;
  app.innerHTML = lessonHtml(id, meta, content);
  window.scrollTo({ top: 0, behavior: 'instant' });
  wireChecklist(id); linkTerms(app.querySelectorAll('.lesson-article .article-body, .lesson-article .practice-body')); restoreScroll(id);
}
async function articleReader(id, epoch) {
  const info = library.articles?.items.find(a => a.id === id);
  app.innerHTML = `<header class="reader-header"><a href="${urlFor('base')}" class="back-link">${icon('back')}База</a>${brand(true)}</header><div class="loading" role="status">Загружаем материал<span></span></div>`;
  if (info && !info.free && !session?.access?.active) { go(urlFor('base')); openAccess(); return; }
  try {
    const response = await fetch(`/api/articles/${encodeURIComponent(id)}`, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (response.status === 403) { go(urlFor('base')); openAccess(); return; }
    if (!response.ok) throw new Error('article unavailable');
    const content = await response.json();
    if (epoch !== renderEpoch) return;
    const { html, codes } = copyBlocks(content.markdown); readerCodes = codes;
    queueMicrotask(() => linkTerms(app.querySelectorAll('.lesson-article .article-body')));
    app.innerHTML = `<header class="reader-header"><a href="${urlFor('base')}" class="back-link">${icon('back')}База</a>${brand(true)}</header><article class="lesson-article"><div class="reader-meta"><span class="eyebrow">${e(String(content.groupTitle || 'БАЗА').toUpperCase())}</span></div><h1>${e(content.title)}</h1><div class="article-body">${html}</div><a class="button button-secondary" href="${urlFor('base')}">К списку материалов${icon('arrow')}</a></article>`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch { if (epoch === renderEpoch) app.innerHTML = `<header class="reader-header"><a href="${urlFor('base')}" class="back-link">${icon('back')}База</a>${brand(true)}</header>${errorPanel()}`; }
}
function profile() {
  const name = session?.user?.first_name || 'Ваш профиль';
  const initials = session?.user?.first_name ? e(session.user.first_name[0]) : 've.';
  const active = session?.access?.active;
  const percent = Math.round(progress.done.length / 24 * 100);
  return `<header class="page-header">${brand(true)}<div><h1>Ваш прогресс</h1><p>Маленькие шаги. Настоящие проекты.</p></div></header><section class="profile-card"><div class="profile-avatar">${initials}</div><h2>${e(name)}</h2>${planBadge(active ? 'pro' : 'free')}<span class="profile-label ${active ? 'is-full' : ''}">${active ? 'Полный доступ · навсегда' : `Бесплатный доступ · уроки 01–${String(FREE_LESSONS).padStart(2, '0')}`}</span><div class="profile-stats"><div><strong>${progress.done.length}<span>/24</span></strong><small>уроков пройдено</small></div><div><strong>${percent}<span>%</span></strong><small>вашего маршрута</small></div></div><progress max="24" value="${progress.done.length}" aria-label="Пройдено уроков"></progress><p class="storage-note">${config.preview ? 'Демо: прогресс сохраняется только на этом устройстве.' : 'Прогресс привязан к вашему аккаунту Telegram.'}</p></section>${active ? '' : `<button class="access-banner" data-action="access"><span class="access-icon">${icon('sparkle')}</span><span><strong>Откройте весь Vibentry</strong><small>Ещё ${24 - FREE_LESSONS} ${plural(24 - FREE_LESSONS, 'урок', 'урока', 'уроков')}, 300 промптов и база${priceLabel() ? ' · ' + priceLabel() + ' навсегда' : ''}</small></span>${icon('arrow')}</button>`}<section class="profile-links"><button data-action="support">${icon('chat')}Помощь и вопросы автору${icon('chevron')}</button><button data-action="community">${icon('lock')}Доступ и оплата${icon('chevron')}</button><button data-action="about">${icon('book')}О курсе${icon('chevron')}</button><button data-action="reset">${icon('back')}Начать заново${icon('chevron')}</button></section>${sessionError ? '<p class="storage-note">Не удалось подтвердить вход через Telegram. Откройте приложение заново из бота.</p>' : ''}${legalLinks()}<div class="profile-signature">${brand(true)}<span>Сначала одна маленькая страница.<br>Остальное потом.</span></div>${session?.isAdmin ? '<a class="button button-secondary admin-entry" href="#admin">Админ-панель: участники, акции, каналы</a>' : ''}${nav('profile')}`;
}
function render() {
  const epoch = ++renderEpoch;
  if (!bootstrapped) { app.innerHTML = '<div class="loading" role="status">Открываем Vibentry<span></span></div>'; return; }
  if (!config.preview && (!tg?.initData || sessionError)) { app.innerHTML = authScreen(); return; }
  // The owner must reach the admin panel before any channel exists (channels are added there). The server checks ADMIN_IDS.
  const adminBypass = session?.isAdmin && route().name === 'admin';
  if ((config.preview && !previewEntered) || (!config.preview && !session?.subscribed && !adminBypass)) { app.innerHTML = gateScreen(); return; }
  const { name, params } = route();
  // Once, after subscribing. Deep links (a lesson from a reminder, the tariff, the admin panel) are never blocked.
  if (!config.preview && session && (session.onboarding === null || obTip) && !['admin', 'buy', 'lesson', 'article', 'practice'].includes(name)) { app.innerHTML = onboardingScreen(obStep, obAnswers, id => e(lessons[id - 1].title)); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  readerId = 0;
  const reading = name === 'lesson' || name === 'article';
  app.dataset.page = name;
  document.body.classList.toggle('reading', reading);
  app.classList.toggle('reader-shell', reading);
  closeModal(false);
  if (name === 'lesson') { try { tg?.BackButton.show(); } catch {} reader(Number(params.get('id')), epoch); }
  else if (name === 'article') { try { tg?.BackButton.show(); } catch {} articleReader(params.get('id') || '', epoch); }
  else { try { tg?.BackButton.hide(); } catch {} app.innerHTML = name === 'materials' ? catalogue(params) : name === 'profile' ? profile() : name === 'admin' ? adminScreen() : name === 'practice' ? practiceView(params) : name === 'next' && !session?.access?.active ? afterFree() : home(); if (name === 'buy') openAccess(params.get('promo') || session?.personalOffer?.code || null); if (name === 'practice' && practiceStarted.has(params.get('id'))) mountPractice(app, { copy }); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function toast(message) { const box = document.querySelector('#toast'); box.textContent = message; box.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('visible'), 3000); }
function safeExternal(url) { const parsed = new URL(url); if (parsed.protocol !== 'https:') return; try { if (parsed.hostname === 't.me' && tg?.openTelegramLink) tg.openTelegramLink(url); else if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener,noreferrer'); } catch { toast('Не удалось открыть ссылку. Попробуйте ещё раз.'); } }
// Public documents (also opened by the bank and the payment provider in a normal browser).
function legalLinks() { return `<nav class="legal-links" aria-label="Документы">${[['/tariffs.html', 'Тарифы и цены'], ['/terms.html', 'Соглашение'], ['/privacy.html', 'Конфиденциальность'], ['/contacts.html', 'Контакты']].map(([href, label]) => `<a href="${location.origin}${href}" data-external>${label}</a>`).join('')}</nav>`; }
function support() { safeExternal(`https://t.me/${config.supportUsername || 'nalpax'}`); }
function modal(title, body) {
  modalReturnFocus = document.activeElement;
  overlay.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-grab" aria-hidden="true"></div><button class="modal-close" aria-label="Закрыть окно" data-action="close">${icon('close')}</button>${brand(true)}<h2 id="modal-title">${title}</h2>${body}</section></div>`;
  document.body.classList.add('modal-open');
  overlay.querySelector('.modal-close').focus();
}
function closeModal(restore = true) { const had = !!overlay.innerHTML; overlay.innerHTML = ''; document.body.classList.remove('modal-open'); if (had && restore && modalReturnFocus?.isConnected) modalReturnFocus.focus(); }
let methods = [];
let selectedMethod = 'stars';
// The price the buyer will pay, from the server's offer: rubles first, then Stars. null while no price is set.
function priceLabel() { const p = config.prices || {}; return p.rub ? `${p.rub.toLocaleString('ru-RU')} ₽` : p.stars ? `${p.stars} ★` : null; }
const money = (amount, method) => method.id === 'stars' ? `${amount} ★` : method.symbol === '₽' ? `${amount} ₽` : `${amount} USDT`;
function payArea() {
  const list = methods.length ? methods : config.methods || [];
  const method = list.find(m => m.id === selectedMethod) || list[0];
  const ready = config.paymentsEnabled && !config.preview && method;
  const sale = method && method.regular && method.regular > method.amount;
  return `${list.length > 1 ? `<div class="method-list" role="radiogroup" aria-label="Способ оплаты">${list.map(m => `<button class="method ${m.id === method.id ? 'is-active' : ''}" role="radio" aria-checked="${m.id === method.id}" data-action="method" data-id="${m.id}"><span>${e(m.title)}</span><strong>${e(money(m.amount, m))}</strong></button>`).join('')}</div>` : ''}<div class="price-block">${sale ? `<del>${e(money(method.regular, method))}</del><span class="sale-badge">−${Math.round((1 - method.amount / method.regular) * 100)}%</span>` : ''}<strong>${method ? e(money(method.amount, method)) : e(priceLabel() || 'Скоро')}</strong><span>разовая покупка · навсегда</span></div><div class="promo-box"><label>Есть промокод?<span><input id="promo-input" maxlength="24" autocapitalize="characters" autocomplete="off" placeholder="Введите код" value="${e(promoApplied || '')}"><button class="mini-button" data-action="apply-promo">Применить</button></span></label><output id="promo-result" aria-live="polite"></output></div><p class="billing-note">Один платёж навсегда. Доступ привязан к вашему аккаунту Telegram и не передаётся другому человеку.</p>${ready ? `<button class="button button-primary" data-action="pay">Оплатить ${e(money(method.amount, method))}${icon('arrow')}</button>` : `<button class="button button-primary" data-action="pay-stub">${priceLabel() ? 'Оплатить ' + e(priceLabel()) : 'Оплатить'}${icon('arrow')}</button><div class="pay-stub is-hidden" id="pay-stub" role="status">${icon('clock')}<p><strong>Оплата пока недоступна.</strong> Платёжная система подключается, деньги не списаны. Как только оплата заработает, эта кнопка поведёт на страницу оплаты.</p></div>`}`;
}
// Funnel events (once per app session); the server keeps only the first time anyway.
const sentEvents = new Set();
function track(step) { if (config.preview || !tg?.initData || sentEvents.has(step)) return; sentEvents.add(step); sendApi('/api/event', { step }).catch(() => sentEvents.delete(step)); }
function openAccess(promo = null) {
  methods = []; selectedMethod = (config.methods || [])[0]?.id || 'stars';
  promoApplied = null;
  const personal = session?.personalOffer && Date.parse(session.personalOffer.expiresAt) > Date.now() ? session.personalOffer : null;
  const active = session?.access?.active;
  if (!active) track('tariff_open');
  modal(active ? 'Ваш доступ открыт' : 'Тариф «Полный доступ»', `<p>${active ? 'Все уроки, промпты и материалы открыты в приложении. Доступ остаётся у вас навсегда.' : 'От первой страницы до портфолио, клиентов и сдачи проекта. Продолжите свой маршрут.'}</p><div class="access-benefits">${['Все 24 урока курса', '300 промптов и рабочие шаблоны', 'База: инструменты, ниши, клиенты, заказы', '«Практикум» без ограничений', 'Прогресс в вашем Telegram'].map(t => `<div>${icon('check')}<span>${t}</span></div>`).join('')}</div>${active ? `<p>${session.access.expiresAt ? 'Оплачен до ' + new Date(session.access.expiresAt * 1000).toLocaleDateString('ru-RU') : 'Разовая покупка · без ограничения срока'}</p><a class="button button-primary" href="#materials">К урокам${icon('arrow')}</a>` : `${personal ? `<div class="personal-offer">${icon('sparkle')}<p><strong>Ваша скидка ${personal.percent}%</strong> по коду ${e(personal.code)} — до ${e(new Date(personal.expiresAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}</p></div>` : ''}<div id="pay-area">${payArea()}</div><p class="modal-note">Оплата через Telegram Stars, карту, СБП или криптовалюту. Курс не гарантирует заказы и доход. Оплачивая, вы принимаете <a href="${location.origin}/terms.html" data-external>пользовательское соглашение</a> и <a href="${location.origin}/privacy.html" data-external>политику конфиденциальности</a>.</p>`}<button class="text-link support-link" data-action="support">Вопросы об оплате</button>`);
  const code = promo || personal?.code;
  if (code && !active && config.methods?.length) { const input = document.querySelector('#promo-input'); const button = document.querySelector('[data-action="apply-promo"]'); if (input && button) { input.value = code; applyPromoCode(button); } }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано. Подставьте свои данные вместо скобок.'); }
  catch { modal('Скопируйте текст', `<p>Выделите текст и скопируйте его вручную.</p><textarea class="copy-fallback" readonly aria-label="Текст для копирования">${e(text)}</textarea>`); overlay.querySelector('textarea').select(); }
}
async function openResource(id) {
  const m = materials.find(m => m.id === id);
  if (!m || !session?.access?.active) return openAccess();
  try {
    const response = await fetch('/api/resources/' + encodeURIComponent(id), { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (!response.ok) throw new Error();
    const { text } = await response.json();
    modal(e(m.title), `<p>${e(m.description)}</p><div class="template-preview"><pre>${e(text)}</pre></div><button class="button button-primary" id="resource-copy">Копировать${icon('copy')}</button><a class="text-link" href="#lesson?id=${m.lesson}">Открыть урок ${m.lesson}${icon('arrow')}</a>`);
    overlay.querySelector('#resource-copy').onclick = () => copy(text);
  } catch { toast('Материал недоступен. Проверьте доступ и соединение.'); }
}
// One tap: fetch the prompt and put it on the clipboard. The clipboard item is handed over as a promise so Safari
// still counts it as part of the tap even though the text arrives from the server a moment later.
async function quickCopy(id, button) {
  if (!session?.access?.active) return openAccess();
  const load = async () => {
    const response = await fetch('/api/prompts/' + encodeURIComponent(id), { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (response.status === 403) throw Object.assign(new Error('payment'), { payment: true });
    if (!response.ok) throw new Error('load');
    return (await response.json()).text;
  };
  try {
    let text;
    if (window.ClipboardItem && navigator.clipboard?.write) {
      const pending = load(); await navigator.clipboard.write([new ClipboardItem({ 'text/plain': pending.then(value => new Blob([value], { type: 'text/plain' })) })]); text = await pending;
    } else { text = await load(); await navigator.clipboard.writeText(text); }
    button.classList.add('is-done'); button.innerHTML = icon('check'); setTimeout(() => { if (button.isConnected) { button.classList.remove('is-done'); button.innerHTML = icon('copy'); } }, 1600);
    pushRecent(id); toast('Промпт скопирован. Замените [скобки] своими данными.');
  } catch (error) {
    if (error.payment) return openAccess();
    try { const text = await load(); copy(text); } catch { toast('Не получилось скопировать. Откройте промпт и нажмите «Копировать».'); }
  }
}
async function openPrompt(id) {
  if (!session?.access?.active) return openAccess();
  const card = library.prompts?.items.find(item => item.id === id);
  try {
    const response = await fetch('/api/prompts/' + encodeURIComponent(id), { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (response.status === 403) return openAccess();
    if (!response.ok) throw new Error();
    const item = await response.json();
    modal(e(item.title), `<p>${e(item.use || card?.use || '')}</p><div class="template-preview prompt-preview"><pre>${e(item.text)}</pre></div><button class="button button-primary" id="resource-copy">Копировать промпт${icon('copy')}</button><p class="modal-note">Промпт № ${e(item.id)}. Всё, что в квадратных скобках, замените своими данными.</p>`);
    overlay.querySelector('#resource-copy').onclick = () => { pushRecent(item.id); copy(item.text); };
  } catch { toast('Промпт недоступен. Проверьте доступ и соединение.'); }
}
document.addEventListener('click', event => {
  if (event.target.classList.contains('modal-backdrop')) return closeModal();
  const external = event.target.closest('a[data-external]');
  if (external) { event.preventDefault(); safeExternal(external.href); return; }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  const action = target.dataset.action;
  if (action === 'lesson') { const lesson = lessons.find(l => l.id === Number(target.dataset.id)); if (!lesson || (!lesson.free && !session?.access?.active)) return openAccess(); go(`#lesson?id=${lesson.id}`); }
  if (action === 'access') openAccess();
  if (action === 'check-subscription') checkSubscription(target);
  if (action === 'preview') { previewEntered = true; render(); }
  if (action === 'pay' || action === 'pay-stub') track('pay_click');
  if (action === 'pay') pay(target);
  if (action === 'pay-stub') { const note = document.querySelector('#pay-stub'); note?.classList.remove('is-hidden'); note?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); try { tg?.HapticFeedback.notificationOccurred('warning'); } catch {} }
  if (action === 'quick-copy') quickCopy(target.dataset.id, target);
  if (action === 'apply-promo') applyPromoCode(target);
  if (action === 'method') { selectedMethod = target.dataset.id; document.querySelector('#pay-area').innerHTML = payArea(); }
  if (action === 'check-order') checkOrder(target.dataset.id, true);
  if (action === 'cancel-wait') { paymentWatch++; document.querySelector('#pay-area').innerHTML = payArea(); }
  if (action === 'save-offer') saveOffer(target);
  if (action === 'support') support();
  if (action === 'community') openAccess();
  if (action === 'close') closeModal();
  if (action === 'retry') render();
  if (action === 'reauth') { sessionError = false; initialize(); }
  if (action === 'resource') openResource(target.dataset.id);
  if (action === 'prompt') openPrompt(target.dataset.id);
  if (action === 'prompt-category') { promptCategory = target.dataset.id; promptLimit = 30; refreshResults(); }
  if (action === 'more-prompts') { promptLimit += 30; refreshResults(); }
  if (action === 'favorite') toggleFavorite(target.dataset.id);
  if (action === 'task-item') toggleTask(target);
  if (action === 'term') openTerm(target.dataset.id);
  if (action === 'onb-answer') { obAnswers[target.dataset.q] = target.dataset.id; obStep++; if (obStep >= 2) { obTip = true; session.onboarding = { ...obAnswers }; sendApi('/api/onboarding', obAnswers).catch(() => {}); } render(); }
  if (action === 'onb-skip') { obTip = false; session.onboarding = { goal: 'skip', experience: 'skip' }; sendApi('/api/onboarding', { skip: true }).catch(() => {}); go('#home'); }
  if (action === 'onb-start') { obTip = false; go('#lesson?id=' + Number(target.dataset.id)); }
  if (action === 'onb-home') { obTip = false; go('#home'); }
  if (action === 'all-terms') { closeModal(false); go(target.getAttribute('href')); }
  if (action === 'article') { const info = library.articles?.items.find(a => a.id === target.dataset.id); if (info && !info.free && !session?.access?.active) return openAccess(); go('#article?id=' + target.dataset.id); }
  if (action === 'reload-library') loadLibrary(catalogueTab, true);
  if (action === 'copy-code') { const code = readerCodes[Number(target.dataset.index)]; if (code) copy(code); }
  if (action === 'copy-section') { const section = freeCache.get(readerId)?.sections[Number(target.dataset.index)]; if (section?.code) copy(section.code); }
  if (action === 'finish' && readerId && checked) { finishLesson(); return; }
  if (action === 'about') modal('Сначала одна маленькая страница.', '<p>Vibentry — практический учебник по вайбкодингу от @nalpax. 24 урока: от первого запроса до сайта, который можно показать людям, плюс 300 промптов и база материалов.</p><p>Первые 5 уроков открываются после подписки на канал. Дальше — настоящие сайты, портфолио, клиенты, цена и сдача проектов.</p><p class="modal-note">Курс не гарантирует заказы и доход: они зависят от вашей практики и спроса.</p>');
  if (action === 'reset') modal('Начать с чистого листа?', '<p>Отметки о пройденных уроках будут удалены.</p><button class="button button-primary" data-action="confirm-reset">Сбросить прогресс</button><button class="button button-secondary" data-action="close">Сохранить прогресс</button>');
  if (action === 'confirm-reset') resetAllProgress(target);
});
document.addEventListener('change', event => { if (event.target.id === 'task-done') { checked = event.target.checked; app.querySelector('.finish-button').disabled = !checked; } });
document.addEventListener('input', event => { if (event.target.id === 'material-search') { search = event.target.value; promptLimit = 30; refreshResults(); } });
async function toggleFavorite(id) {
  const on = !marks.favorites.includes(id);
  marks.favorites = on ? [...marks.favorites, id].sort() : marks.favorites.filter(x => x !== id); refreshResults();
  try { tg?.HapticFeedback.selectionChanged(); } catch {}
  if (!(await saveMark({ favorite: { id, on } }))) { marks.favorites = on ? marks.favorites.filter(x => x !== id) : [...marks.favorites, id].sort(); refreshResults(); }
  else if (on) toast('Добавлено в избранное.');
}
// Checklist items («Готово, когда») inside a lesson become real checkboxes, saved per account.
function wireChecklist(id) {
  const done = new Set(marks.tasks[id] || []);
  app.querySelectorAll('.lesson-article .task-item').forEach((item, index) => {
    const on = done.has(index);
    Object.assign(item.dataset, { action: 'task-item', index: String(index) });
    item.setAttribute('role', 'checkbox'); item.setAttribute('tabindex', '0'); item.setAttribute('aria-checked', String(on));
    item.classList.toggle('is-checked', on); item.querySelector('.task-box')?.classList.toggle('is-done', on);
  });
}
async function toggleTask(item) {
  const id = readerId; const index = Number(item.dataset.index); const on = item.getAttribute('aria-checked') !== 'true';
  const paint = value => { item.setAttribute('aria-checked', String(value)); item.classList.toggle('is-checked', value); item.querySelector('.task-box')?.classList.toggle('is-done', value); };
  paint(on); try { tg?.HapticFeedback.selectionChanged(); } catch {}
  if (!(await saveMark({ task: { lessonId: id, index, on } }))) paint(!on);
  const list = app.querySelectorAll('.lesson-article .task-item');
  if (on && list.length && [...list].every(x => x.getAttribute('aria-checked') === 'true')) toast('Все пункты выполнены. Можно завершать урок.');
}
document.addEventListener('keydown', event => { const item = event.target.closest?.('.task-item[role=checkbox]'); if (item && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); toggleTask(item); } });
// Where the reader stopped in a long lesson (per device).
let scrollTimer;
window.addEventListener('scroll', () => {
  if (!readerId || route().name !== 'lesson') return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => { const max = document.documentElement.scrollHeight - innerHeight; if (max > 0 && readerId) writeLocal(SCROLL_KEY, { ...readLocal(SCROLL_KEY, {}), [readerId]: Math.round(scrollY / max * 1000) / 1000 }); }, 400);
}, { passive: true });
function restoreScroll(id) {
  const ratio = readLocal(SCROLL_KEY, {})[id];
  if (!(ratio > 0.05 && ratio < 0.95) || progress.done.includes(id)) return;
  requestAnimationFrame(() => { window.scrollTo({ top: ratio * (document.documentElement.scrollHeight - innerHeight), behavior: 'instant' }); toast('Продолжаем с места, где вы остановились.'); });
}
document.addEventListener('keydown', event => {
  if (!overlay.innerHTML) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') { const focusable = [...overlay.querySelectorAll('button, a, textarea, input')].filter(el => !el.disabled); const first = focusable[0]; const last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
});
window.addEventListener('hashchange', render);
render();
function gateScreen() {
  return `<header class="home-header">${brand()}</header><main class="welcome-screen"><div class="welcome-art"><img src="/assets/hero.png" alt="" width="230" height="230"></div><span class="eyebrow">ВАШ ПЕРВЫЙ ШАГ</span><h1>Большие проекты<br>начинаются с малого<span>.</span></h1><p>Подпишитесь на канал Vibentry, чтобы открыть приложение и забрать первые ${FREE_LESSONS} уроков бесплатно.</p><div class="welcome-steps"><div><span>01</span><p>Подпишитесь на канал</p>${icon('send')}</div><div><span>02</span><p>Вернитесь и проверьте подписку</p>${icon('check')}</div><div><span>03</span><p>Откройте бесплатные уроки</p>${icon('book')}</div></div>${config.requiredChannelUrl ? `<a class="button button-primary" href="${e(config.requiredChannelUrl)}" target="_blank" rel="noopener noreferrer">Подписаться на канал${icon('arrow')}</a>` : '<button class="button button-primary" disabled>Канал скоро появится</button>'}<button class="button button-secondary" data-action="check-subscription">Проверить подписку${icon('check')}</button><p class="welcome-note">Первые ${FREE_LESSONS} уроков — бесплатно.<br>Полный курс оплачивается внутри приложения.</p><button class="button button-secondary gate-tariff" data-action="access">${icon('sparkle')}Тариф «Полный доступ»${priceLabel() ? ' — ' + e(priceLabel()) : ''}</button>${config.preview ? '<button class="preview-link" data-action="preview">Посмотреть дизайн в демо-режиме →</button>' : ''}${session?.isAdmin && session?.subscriptionUnavailable ? '<p class="welcome-note warn">Бот не может проверить канал из списка «Доступ»: проверьте ссылку и ID и что бот — администратор канала.</p>' : ''}${session?.isAdmin ? '<a class="button button-secondary admin-entry" href="#admin">Админ-панель: каналы, цена, участники</a>' : ''}${legalLinks()}</main>`;
}
function authScreen() {
  return `<header class="home-header">${brand()}</header><main class="welcome-screen"><div class="welcome-art"><img src="/assets/hero.png" alt="" width="230" height="230"></div><h1>Откройте Vibentry<br>в Telegram</h1><p>Для проверки подписки, оплаты и сохранения прогресса нужен вход через бота.</p><button class="button button-primary" data-action="reauth">Проверить вход ещё раз${icon('arrow')}</button><button class="button button-secondary" data-action="support">Связаться с автором</button>${legalLinks()}</main>`;
}
async function sendApi(endpoint, data = {}) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, initData: tg?.initData || '' }) });
  if (!response.ok) { const error = new Error('Request failed'); error.status = response.status; try { const body = await response.json(); if (/[А-Яа-я]/.test(body.error || '')) error.message = body.error; } catch {} throw error; }
  return response.json();
}
async function getApi(endpoint) {
  const response = await fetch(endpoint, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
  if (!response.ok) { const error = new Error('Request failed'); error.status = response.status; throw error; }
  return response.json();
}
async function refreshConfig() { const response = await fetch('/api/config'); if (response.ok) config = await response.json(); }
const protection = installProtection(() => session?.user || null);
const admin = createAdmin({ sendApi, getApi, toast, modal, closeModal, config: { get regularPriceStars() { return config.regularPriceStars; } }, refreshConfig, getSession: () => session });
async function refreshSession() {
  const data = await sendApi('/api/session'); session = data; protection.refresh();
  if (data.practice?.unlimited) practiceBlocked.clear();
  if (!config.preview) { progress.done = data.done || []; progress.last = Math.min(24, (progress.done.at(-1) || 0) + 1); }
  await loadMarks();
  return data;
}
async function initialize() {
  try {
    const response = await fetch('/api/config'); if (!response.ok) throw new Error(); config = await response.json();
    if (!config.preview && tg?.initData) await refreshSession();
  } catch { sessionError = true; }
  finally { bootstrapped = true; render(); }
}
async function checkSubscription(button) {
  if (config.preview) return toast('В демо подписка не проверяется. Нажмите «Посмотреть дизайн».');
  button.disabled = true; button.textContent = 'Проверяем…';
  try { await refreshSession(); if (session.subscriptionUnavailable) toast(session.isAdmin ? 'Бот не может проверить канал. Откройте «Админ-панель» → «Доступ» → «Проверить бота».' : 'Не удалось проверить подписку. Попробуйте чуть позже.'); else if (session.subscribed) { render(); toast(`Подписка подтверждена. Первые ${FREE_LESSONS} уроков открыты!`); } else toast('Подписка пока не найдена. Подпишитесь и проверьте ещё раз.'); }
  catch { toast('Не удалось проверить подписку. Попробуйте чуть позже.'); }
  finally { if (button.isConnected) { button.disabled = false; button.innerHTML = `Проверить подписку${icon('check')}`; } }
}
async function finishLesson() {
  const id = readerId; const button = document.querySelector('.finish-button'); button.disabled = true;
  try {
    if (!config.preview) await sendApi('/api/progress', { lessonId: id }); complete(id); justDone = id; setTimeout(() => { justDone = 0; }, 4000);
    try { tg?.HapticFeedback.notificationOccurred('success'); } catch {}
    if (id < 24 && (session?.access?.active || lessons[id]?.free)) { go('#lesson?id=' + (id + 1)); toast('Ещё один шаг. Отличная работа!'); }
    else if (id === FREE_LESSONS && !session?.access?.active) go('#next');
    else { go('#home'); toast('Отличная работа!'); }
  } catch { toast('Не удалось сохранить прогресс. Проверьте соединение.'); if (button.isConnected) button.disabled = false; }
}
async function applyPromoCode(button) {
  const input = document.querySelector('#promo-input'); const out = document.querySelector('#promo-result'); const code = input.value.trim();
  if (!code) { out.textContent = 'Введите код.'; return; }
  button.disabled = true;
  try { const r = await sendApi('/api/promo', { promo: code }); promoApplied = r.code; methods = r.methods; document.querySelector('#pay-area').innerHTML = payArea(); document.querySelector('#promo-result').textContent = `Код ${r.code}: −${r.percent}%`; }
  catch (error) { promoApplied = null; out.textContent = error.message === 'Request failed' ? 'Не удалось проверить код.' : error.message; button.disabled = false; }
}
function openPaymentLink(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return false;
  try { if (parsed.hostname === 't.me' && tg?.openTelegramLink) tg.openTelegramLink(url); else if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener,noreferrer'); return true; } catch { return false; }
}
let paymentWatch = 0;
async function watchOrder(orderId) {
  const ticket = ++paymentWatch; const area = document.querySelector('#pay-area');
  if (area) area.innerHTML = `<div class="pay-wait" role="status"><span class="spinner" aria-hidden="true"></span><strong>Ждём подтверждение оплаты</strong><p>Оплатите в открывшемся окне. Как только платёж дойдёт, доступ откроется сам — это обычно занимает до минуты.</p><button class="button button-secondary" data-action="check-order" data-id="${e(orderId)}">Я оплатил(а) — проверить</button><button class="text-link" data-action="cancel-wait">Выбрать другой способ</button></div>`;
  for (let i = 0; i < 150 && ticket === paymentWatch; i++) {
    await new Promise(resolve => setTimeout(resolve, 4000));
    if (ticket !== paymentWatch) return;
    if (await checkOrder(orderId, false)) return;
  }
}
async function checkOrder(orderId, manual) {
  try {
    const order = await getApi('/api/order/' + orderId);
    if (order.paid) { paymentWatch++; await refreshSession(); closeModal(); render(); toast('Оплата подтверждена. Все уроки открыты!'); return true; }
    if (manual) toast('Платёж пока не поступил. Подождите минуту и проверьте ещё раз.');
  } catch { if (manual) toast('Не удалось проверить. Попробуйте ещё раз.'); }
  return false;
}
async function pay(button) {
  const method = (methods.length ? methods : config.methods || []).find(m => m.id === selectedMethod) || (config.methods || [])[0];
  if (!config.paymentsEnabled || config.preview || !method) return;
  if (method.id === 'stars' && !tg?.openInvoice) return toast('Оплата Stars работает внутри Telegram.');
  button.disabled = true; button.textContent = 'Готовим оплату…';
  try {
    const invoice = await sendApi('/api/invoice', { method: method.id, ...(promoApplied ? { promo: promoApplied } : {}) });
    if (method.id !== 'stars') {
      if (!openPaymentLink(invoice.url)) { toast('Не удалось открыть страницу оплаты.'); if (button.isConnected) { button.disabled = false; button.textContent = 'Повторить оплату'; } return; }
      watchOrder(invoice.orderId); return;
    }
    tg.openInvoice(invoice.url, async status => {
      if (status !== 'paid') { if (button.isConnected) { button.disabled = false; button.textContent = 'Оплатить ' + money(method.amount, method); } if (status === 'failed') toast('Оплата не прошла. Попробуйте ещё раз.'); return; }
      // The client callback is NOT authorization. Only successful_payment grants access.
      for (let i = 0; i < 6; i++) {
        try { await refreshSession(); if (session?.access?.active) { closeModal(); render(); toast('Оплата подтверждена. Все уроки открыты!'); return; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      closeModal(); toast('Платёж обрабатывается. Обновите приложение через минуту.');
    });
  } catch (error) { toast(error.status === 429 ? 'Подождите несколько секунд и попробуйте снова.' : 'Счёт пока недоступен. Попробуйте другой способ или напишите автору.'); if (button.isConnected) { button.disabled = false; button.textContent = 'Повторить оплату'; } }
}
// A trainer opens only after the server allows the launch (free accounts: 3 in total); a launch counts once per app session.
function practiceView(params) {
  const id = params.get('id');
  if (!id) return `${practiceList(session?.practice)}${nav('practice')}`;
  if (practiceStarted.has(id)) return `${practiceScreen(id)}${nav('practice')}`;
  if (practiceBlocked.has(id) || (session?.practice && !session.practice.unlimited && session.practice.remaining <= 0)) return `${practicePaywall(id, priceLabel())}${nav('practice')}`;
  startPractice(id, renderEpoch);
  return `<header class="reader-header"><a href="#practice" class="back-link">${icon('back')}Практикум</a></header><div class="loading" role="status">Открываем тренажёр<span></span></div>${nav('practice')}`;
}
async function startPractice(id, epoch) {
  try {
    const result = await sendApi('/api/practice', { id });
    setPracticeData(result.data); practiceStarted.add(id);
    if (session) session.practice = { unlimited: result.unlimited, limit: result.limit, remaining: result.remaining };
    if (!result.unlimited) toast(result.remaining ? `Бесплатный запуск. Осталось ${result.remaining} из ${result.limit}.` : 'Это был последний бесплатный запуск «Практикума».');
  } catch (error) {
    if (error.status === 403) { practiceBlocked.add(id); if (session?.practice) session.practice.remaining = 0; }
    else if (epoch === renderEpoch) { app.innerHTML = `<header class="reader-header"><a href="#practice" class="back-link">${icon('back')}Практикум</a></header>${errorPanel()}${nav('practice')}`; return; }
  }
  if (route().name === 'practice' && route().params.get('id') === id) render();
}
function adminScreen() {
  if (!session?.isAdmin) return `<div class="empty-state"><h1>Доступ ограничен</h1><p>Этот раздел доступен только владельцу проекта.</p><a class="button button-secondary" href="#profile">В профиль</a></div>${nav('profile')}`;
  return `<header class="reader-header"><a href="#profile" class="back-link">${icon('back')}В профиль</a>${brand(true)}</header>${admin.screen()}${nav('admin')}`;
}
initialize();

async function resetAllProgress(button) {
  button.disabled = true;
  try { if (!config.preview) await sendApi('/api/progress', { reset: true }); resetProgress(); closeModal(); render(); toast('Можно начинать заново.'); }
  catch { toast('Не удалось сбросить прогресс. Попробуйте ещё раз.'); button.disabled = false; }
}
