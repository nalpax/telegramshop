import { icon, art } from './icons.js';
import { modules, lessons, materials } from './course.js';
import { renderMarkdown } from './markdown.js';
import { createAdmin, planBadge } from './admin.js';
import { installProtection } from './protect.js';
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
  const items = [['home', 'home', 'Главная'], ['materials', 'book', 'Материалы'], ['profile', 'user', 'Профиль'], ...(session?.isAdmin ? [['admin', 'sparkle', 'Админка']] : [])];
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
  const freeDone = progress.done.includes(1) && !session?.access?.active;
  const eyebrow = freeDone ? 'ПЕРВЫЙ УРОК ПРОЙДЕН' : progress.done.length ? 'ВАШ СЛЕДУЮЩИЙ ШАГ' : 'НАЧНИТЕ С МАЛЕНЬКОГО';
  const title = freeDone ? 'Продолжим создавать?' : `${String(next.id).padStart(2, '0')} · ${e(next.title)}`;
  const label = freeDone ? 'Посмотреть полную программу' : progress.done.length ? 'Продолжить урок' : 'Начать бесплатно';
  const percent = Math.round(progress.done.length / 24 * 100);
  return `<header class="home-header">${brand()}</header>
  ${hero()}
  <section class="continue-card" aria-labelledby="continue-title"><div class="continue-top"><span class="eyebrow">${eyebrow}</span>${icon(freeDone ? 'check' : 'sparkle')}</div><h2 id="continue-title">${title}</h2><div class="progress-caption"><span>Пройдено ${progress.done.length} из 24 уроков</span><span>${percent}%</span></div><progress max="24" value="${progress.done.length}" aria-label="Прогресс курса"></progress><button class="button button-primary" data-action="${freeDone ? 'access' : 'lesson'}" ${freeDone ? '' : `data-id="${next.id}"`}>${label}${icon('arrow')}</button></section>
  <section class="quick-section" aria-labelledby="quick-title"><div class="section-heading"><h2 id="quick-title">Быстрый доступ</h2></div><div class="quick-grid">${tile('Уроки', '24 урока,<br>первый бесплатно', 'book', urlFor())}${tile('Промпты', '300 запросов<br>для ИИ', 'prompts', urlFor('prompts'))}${tile('База', 'Инструменты, ниши,<br>клиенты, заказы', 'files', urlFor('base'))}${tile(session?.access?.active ? 'Мой доступ' : 'Полный доступ', session?.access?.active ? 'Всё открыто,<br>навсегда' : 'Один платёж,<br>навсегда', 'plane', '#access', 'access')}</div></section>
  <p class="home-note">Одна сделанная страница полезнее десяти прочитанных.</p>${nav('home')}`;
}
function lessonRow(lesson) {
  const done = progress.done.includes(lesson.id);
  const locked = !lesson.free && !session?.access?.active;
  const active = lesson.id === progress.last && !done && !locked;
  const note = active ? '<small>Ваш следующий шаг</small>' : done ? '<small>Пройдено</small>' : '';
  return `<button class="lesson-row ${active ? 'lesson-current' : ''} ${done ? 'lesson-done' : ''} ${locked ? 'lesson-locked' : ''}" data-action="lesson" data-id="${lesson.id}"><span class="lesson-number">${String(lesson.id).padStart(2, '0')}</span><span class="lesson-info"><strong>${e(lesson.title)}</strong>${note}</span><span class="lesson-status ${done ? 'done-badge' : ''}">${icon(done ? 'check' : locked ? 'lock' : 'chevron')}</span></button>`;
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
  const chips = `<div class="chips" role="group" aria-label="Категории промптов"><button class="chip ${promptCategory === 'all' ? 'selected' : ''}" data-action="prompt-category" data-id="all">Все ${items.length}</button>${categories.map((c, i) => `<button class="chip ${promptCategory === c.id ? 'selected' : ''}" data-action="prompt-category" data-id="${e(c.id)}">${e(c.title)} <span>${c.ids.length}</span></button>`).join('')}</div>`;
  const chosen = promptCategory === 'all' ? items : (categories.find(c => c.id === promptCategory)?.ids || []).map(id => byId.get(id)).filter(Boolean);
  const rows = chosen.filter(item => matches(query, item.id, item.title, item.use));
  const locked = !session?.access?.active;
  return `${chips}<div class="prompt-list">${rows.map(item => `<div class="prompt-item"><button class="prompt-card ${locked ? 'is-locked' : ''}" data-action="prompt" data-id="${e(item.id)}"><span class="prompt-number">${e(item.id)}</span><span class="prompt-info"><strong>${e(item.title)}</strong><small>${e(item.use)}</small></span></button><button class="copy-quick ${locked ? 'is-locked' : ''}" data-action="quick-copy" data-id="${e(item.id)}" aria-label="${locked ? 'Откроется после покупки' : 'Скопировать промпт ' + e(item.id)}">${icon(locked ? 'lock' : 'copy')}</button></div>`).join('') || emptySearch()}</div>`;
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
  return modules.map(m => {
    const rows = lessons.filter(l => l.module === m.id && matches(query, l.title, l.id));
    if (!rows.length) return '';
    const meta = m.id === 1 ? '<span class="free-label">Первый урок бесплатно</span>' : `${rows.length} ${plural(rows.length, 'урок', 'урока', 'уроков')}`;
    return `<section class="module-section">${heading(m.range, m.title, meta)}<div class="lesson-list">${rows.map(lessonRow).join('')}</div></section>`;
  }).join('') || emptySearch();
}
function emptySearch() { return `<div class="empty-state">${icon('search')}<h2>Пока ничего не нашлось</h2><p>Попробуйте другое слово или номер.</p></div>`; }
const TABS = [['lessons', 'Уроки'], ['prompts', 'Промпты'], ['base', 'База']];
const PLACEHOLDER = { lessons: 'Найти урок', prompts: 'Найти промпт', base: 'Найти материал' };
function catalogue(params) {
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'lessons';
  catalogueTab = tab;
  loadLibrary(tab);
  const banner = session?.access?.active ? '' : `<button class="access-banner" data-action="access"><span class="access-icon">${icon('lock')}</span><span><strong>Откройте весь Vibentry</strong><small>Уроки 02–24, 300 промптов и вся база</small></span>${icon('arrow')}</button>`;
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
  const footnote = id < 24 ? `Далее: ${e(lessons[id].title)}` : 'Вы прошли весь курс. Пора применять знания!';
  return `<header class="reader-header"><a href="${urlFor()}" class="back-link">${icon('back')}Все уроки</a>${brand(true)}</header><article class="lesson-article"><div class="reader-meta"><span class="eyebrow">УРОК ${String(id).padStart(2, '0')} / 24</span><span class="free-label">${meta.free ? 'Бесплатно' : 'Полный доступ'}</span></div><h1>${e(meta.title)}</h1><div class="outcome">${icon('target')}<p><span>РЕЗУЛЬТАТ УРОКА</span>${e(content.outcome)}</p></div><div class="article-body">${bodyHtml}</div>${practice}<button class="button button-primary finish-button" data-action="finish" ${checked ? '' : 'disabled'}>${progress.done.includes(id) ? 'К следующему шагу' : 'Завершить урок'}${icon('arrow')}</button><p class="reader-footnote">${footnote}</p></article>`;
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
    app.innerHTML = `<header class="reader-header"><a href="${urlFor('base')}" class="back-link">${icon('back')}База</a>${brand(true)}</header><article class="lesson-article"><div class="reader-meta"><span class="eyebrow">${e(String(content.groupTitle || 'БАЗА').toUpperCase())}</span></div><h1>${e(content.title)}</h1><div class="article-body">${html}</div><a class="button button-secondary" href="${urlFor('base')}">К списку материалов${icon('arrow')}</a></article>`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch { if (epoch === renderEpoch) app.innerHTML = `<header class="reader-header"><a href="${urlFor('base')}" class="back-link">${icon('back')}База</a>${brand(true)}</header>${errorPanel()}`; }
}
function profile() {
  const name = session?.user?.first_name || 'Ваш профиль';
  const initials = session?.user?.first_name ? e(session.user.first_name[0]) : 've.';
  const active = session?.access?.active;
  const percent = Math.round(progress.done.length / 24 * 100);
  return `<header class="page-header">${brand(true)}<div><h1>Ваш прогресс</h1><p>Маленькие шаги. Настоящие проекты.</p></div></header><section class="profile-card"><div class="profile-avatar">${initials}</div><h2>${e(name)}</h2>${planBadge(active ? 'pro' : 'free')}<span class="profile-label ${active ? 'is-full' : ''}">${active ? 'Полный доступ · навсегда' : 'Бесплатный доступ · урок 01'}</span><div class="profile-stats"><div><strong>${progress.done.length}<span>/24</span></strong><small>уроков пройдено</small></div><div><strong>${percent}<span>%</span></strong><small>вашего маршрута</small></div></div><progress max="24" value="${progress.done.length}" aria-label="Пройдено уроков"></progress><p class="storage-note">${config.preview ? 'Демо: прогресс сохраняется только на этом устройстве.' : 'Прогресс привязан к вашему аккаунту Telegram.'}</p></section>${active ? '' : `<button class="access-banner" data-action="access"><span class="access-icon">${icon('sparkle')}</span><span><strong>Откройте весь Vibentry</strong><small>23 урока, 300 промптов и база материалов</small></span>${icon('arrow')}</button>`}<section class="profile-links"><button data-action="support">${icon('chat')}Помощь и вопросы автору${icon('chevron')}</button><button data-action="community">${icon('lock')}Доступ и оплата${icon('chevron')}</button><button data-action="about">${icon('book')}О курсе${icon('chevron')}</button><button data-action="reset">${icon('back')}Начать заново${icon('chevron')}</button></section>${sessionError ? '<p class="storage-note">Не удалось подтвердить вход через Telegram. Откройте приложение заново из бота.</p>' : ''}<div class="profile-signature">${brand(true)}<span>Сначала одна маленькая страница.<br>Остальное потом.</span></div>${session?.isAdmin ? '<a class="button button-secondary admin-entry" href="#admin">Админ-панель: участники, акции, каналы</a>' : ''}${nav('profile')}`;
}
function render() {
  const epoch = ++renderEpoch;
  if (!bootstrapped) { app.innerHTML = '<div class="loading" role="status">Открываем Vibentry<span></span></div>'; return; }
  if (!config.preview && (!tg?.initData || sessionError)) { app.innerHTML = authScreen(); return; }
  if ((config.preview && !previewEntered) || (!config.preview && !session?.subscribed)) { app.innerHTML = gateScreen(); return; }
  const { name, params } = route();
  readerId = 0;
  const reading = name === 'lesson' || name === 'article';
  app.dataset.page = name;
  document.body.classList.toggle('reading', reading);
  app.classList.toggle('reader-shell', reading);
  closeModal(false);
  if (name === 'lesson') { try { tg?.BackButton.show(); } catch {} reader(Number(params.get('id')), epoch); }
  else if (name === 'article') { try { tg?.BackButton.show(); } catch {} articleReader(params.get('id') || '', epoch); }
  else { try { tg?.BackButton.hide(); } catch {} app.innerHTML = name === 'materials' ? catalogue(params) : name === 'profile' ? profile() : name === 'admin' ? adminScreen() : home(); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function toast(message) { const box = document.querySelector('#toast'); box.textContent = message; box.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('visible'), 3000); }
function safeExternal(url) { const parsed = new URL(url); if (parsed.protocol !== 'https:') return; try { if (parsed.hostname === 't.me' && tg?.openTelegramLink) tg.openTelegramLink(url); else if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener,noreferrer'); } catch { toast('Не удалось открыть ссылку. Попробуйте ещё раз.'); } }
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
const money = (amount, method) => method.id === 'stars' ? `${amount} ★` : method.symbol === '₽' ? `${amount} ₽` : `${amount} USDT`;
function payArea() {
  const list = methods.length ? methods : config.methods || [];
  const method = list.find(m => m.id === selectedMethod) || list[0];
  const ready = config.paymentsEnabled && !config.preview && method;
  const sale = method && method.regular && method.regular > method.amount;
  return `${list.length > 1 ? `<div class="method-list" role="radiogroup" aria-label="Способ оплаты">${list.map(m => `<button class="method ${m.id === method.id ? 'is-active' : ''}" role="radio" aria-checked="${m.id === method.id}" data-action="method" data-id="${m.id}"><span>${e(m.title)}</span><strong>${e(money(m.amount, m))}</strong></button>`).join('')}</div>` : ''}<div class="price-block">${sale ? `<del>${e(money(method.regular, method))}</del><span class="sale-badge">−${Math.round((1 - method.amount / method.regular) * 100)}%</span>` : ''}<strong>${method ? e(money(method.amount, method)) : 'Скоро'}</strong><span>разовая покупка</span></div><div class="promo-box"><label>Есть промокод?<span><input id="promo-input" maxlength="24" autocapitalize="characters" autocomplete="off" placeholder="Введите код" value="${e(promoApplied || '')}"><button class="mini-button" data-action="apply-promo">Применить</button></span></label><output id="promo-result" aria-live="polite"></output></div><p class="billing-note">Один платёж навсегда. Доступ привязан к вашему аккаунту Telegram и не передаётся другому человеку.</p><button class="button button-primary" data-action="pay" ${ready ? '' : 'disabled'}>${ready ? 'Оплатить ' + e(money(method.amount, method)) : 'Покупка пока недоступна'}${icon('arrow')}</button>`;
}
function openAccess() {
  methods = []; selectedMethod = (config.methods || [])[0]?.id || 'stars';
  promoApplied = null;
  const active = session?.access?.active;
  modal(active ? 'Ваш доступ открыт' : 'Весь Vibentry. В одном месте.', `<p>${active ? 'Все уроки, промпты и материалы открыты в приложении. Доступ остаётся у вас навсегда.' : 'От первой страницы до портфолио, клиентов и сдачи проекта. Продолжите свой маршрут.'}</p><div class="access-benefits">${['Все 24 урока курса', '300 промптов и рабочие шаблоны', 'База: инструменты, ниши, клиенты, заказы', 'Прогресс в вашем Telegram'].map(t => `<div>${icon('check')}<span>${t}</span></div>`).join('')}</div>${active ? `<p>${session.access.expiresAt ? 'Оплачен до ' + new Date(session.access.expiresAt * 1000).toLocaleDateString('ru-RU') : 'Разовая покупка · без ограничения срока'}</p><a class="button button-primary" href="#materials">К урокам${icon('arrow')}</a>` : `<div id="pay-area">${payArea()}</div><p class="modal-note">Оплата через Telegram Stars, карту, СБП или криптовалюту. Курс не гарантирует заказы и доход.</p>`}<button class="text-link support-link" data-action="support">Вопросы об оплате</button>`);
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
    toast('Промпт скопирован. Замените [скобки] своими данными.');
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
    overlay.querySelector('#resource-copy').onclick = () => copy(item.text);
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
  if (action === 'pay') pay(target);
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
  if (action === 'prompt-category') { promptCategory = target.dataset.id; refreshResults(); }
  if (action === 'article') { const info = library.articles?.items.find(a => a.id === target.dataset.id); if (info && !info.free && !session?.access?.active) return openAccess(); go('#article?id=' + target.dataset.id); }
  if (action === 'reload-library') loadLibrary(catalogueTab, true);
  if (action === 'copy-code') { const code = readerCodes[Number(target.dataset.index)]; if (code) copy(code); }
  if (action === 'copy-section') { const section = freeCache.get(readerId)?.sections[Number(target.dataset.index)]; if (section?.code) copy(section.code); }
  if (action === 'finish' && readerId && checked) { finishLesson(); return; }
  if (action === 'about') modal('Сначала одна маленькая страница.', '<p>Vibentry — практический учебник по вайбкодингу от @nalpax. 24 урока: от первого запроса до сайта, который можно показать людям, плюс 300 промптов и база материалов.</p><p>Первый урок открывается после подписки на канал. Дальше — настоящие сайты, портфолио, клиенты, цена и сдача проектов.</p><p class="modal-note">Курс не гарантирует заказы и доход: они зависят от вашей практики и спроса.</p>');
  if (action === 'reset') modal('Начать с чистого листа?', '<p>Отметки о пройденных уроках будут удалены.</p><button class="button button-primary" data-action="confirm-reset">Сбросить прогресс</button><button class="button button-secondary" data-action="close">Сохранить прогресс</button>');
  if (action === 'confirm-reset') resetAllProgress(target);
});
document.addEventListener('change', event => { if (event.target.id === 'task-done') { checked = event.target.checked; app.querySelector('.finish-button').disabled = !checked; } });
document.addEventListener('input', event => { if (event.target.id === 'material-search') { search = event.target.value; refreshResults(); } });
document.addEventListener('keydown', event => {
  if (!overlay.innerHTML) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') { const focusable = [...overlay.querySelectorAll('button, a, textarea, input')].filter(el => !el.disabled); const first = focusable[0]; const last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
});
window.addEventListener('hashchange', render);
render();
function gateScreen() {
  return `<header class="home-header">${brand()}</header><main class="welcome-screen"><div class="welcome-art"><img src="/assets/hero.png" alt="" width="230" height="230"></div><span class="eyebrow">ВАШ ПЕРВЫЙ ШАГ</span><h1>Большие проекты<br>начинаются с малого<span>.</span></h1><p>Подпишитесь на канал Vibentry, чтобы открыть приложение и забрать первый урок бесплатно.</p><div class="welcome-steps"><div><span>01</span><p>Подпишитесь на канал</p>${icon('send')}</div><div><span>02</span><p>Вернитесь и проверьте подписку</p>${icon('check')}</div><div><span>03</span><p>Откройте бесплатный урок</p>${icon('book')}</div></div>${config.requiredChannelUrl ? `<a class="button button-primary" href="${e(config.requiredChannelUrl)}" target="_blank" rel="noopener noreferrer">Подписаться на канал${icon('arrow')}</a>` : '<button class="button button-primary" disabled>Канал скоро появится</button>'}<button class="button button-secondary" data-action="check-subscription">Проверить подписку${icon('check')}</button><p class="welcome-note">Первый урок — бесплатно.<br>Полный курс оплачивается внутри приложения.</p>${config.preview ? '<button class="preview-link" data-action="preview">Посмотреть дизайн в демо-режиме →</button>' : ''}</main>`;
}
function authScreen() {
  return `<header class="home-header">${brand()}</header><main class="welcome-screen"><div class="welcome-art"><img src="/assets/hero.png" alt="" width="230" height="230"></div><h1>Откройте Vibentry<br>в Telegram</h1><p>Для проверки подписки, оплаты и сохранения прогресса нужен вход через бота.</p><button class="button button-primary" data-action="reauth">Проверить вход ещё раз${icon('arrow')}</button><button class="button button-secondary" data-action="support">Связаться с автором</button></main>`;
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
  if (!config.preview) { progress.done = data.done || []; progress.last = Math.min(24, (progress.done.at(-1) || 0) + 1); }
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
  try { await refreshSession(); if (session.subscribed) { render(); toast('Подписка подтверждена. Первый урок открыт!'); } else toast('Подписка пока не найдена. Подпишитесь и проверьте ещё раз.'); }
  catch { toast('Не удалось проверить подписку. Попробуйте чуть позже.'); }
  finally { if (button.isConnected) { button.disabled = false; button.innerHTML = `Проверить подписку${icon('check')}`; } }
}
async function finishLesson() {
  const id = readerId; const button = document.querySelector('.finish-button'); button.disabled = true;
  try {
    if (!config.preview) await sendApi('/api/progress', { lessonId: id }); complete(id);
    try { tg?.HapticFeedback.notificationOccurred('success'); } catch {}
    if (id < 24 && session?.access?.active) { go('#lesson?id=' + (id + 1)); toast('Ещё один шаг. Отличная работа!'); }
    else { go('#home'); toast(id === 1 ? 'Первый урок пройден. Дальше — больше!' : 'Отличная работа!'); }
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
