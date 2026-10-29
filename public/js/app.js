import { icon } from './icons.js';
import { FREE_LESSONS, modules, lessons, materials } from './course.js';
import { renderMarkdown } from './markdown.js';
import { createAdmin, planBadge } from './admin.js';
import { installProtection } from './protect.js';
import { GROUPS, TERMS, linkTerms } from './glossary.js';
import { onboardingScreen } from './onboarding.js';
import { mountPractice, practicePaywall, practiceScreen, setPracticeData, trainers } from './practice.js';
import { art3d, exerciseHtml, exerciseLocked, exerciseTypeName, site3d, stagePanel, stageStepper, startAnswer } from './learn.js';
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
// Bookmarks (prompts, lessons, articles) live on the server (/api/favorites); in the demo they stay in memory.
// «Недавно открытое» is a per-device list (localStorage, last 6), never sent anywhere.
let favorites = [];
const KIND = { prompt: ['Промпт', 'copy'], lesson: ['Урок', 'book'], article: ['База', 'file'], resource: ['Шаблон', 'copy'] };
const OPENED_KEY = 'vibentry.opened.v1';
const sameItem = (f, kind, id) => f.kind === kind && String(f.id) === String(id);
const isFav = (kind, id) => favorites.some(f => sameItem(f, kind, id));
const favIds = kind => favorites.filter(f => f.kind === kind).map(f => String(f.id));
async function loadFavorites() { if (config.preview || !session?.subscribed) return; try { favorites = (await getApi('/api/favorites')).items || []; } catch {} }
const favLabel = (on, kind, title) => `${on ? 'Убрать из избранного' : 'В избранное'}: ${KIND[kind][0].toLowerCase()} «${title}»`;
function starButton(kind, id, title, extra = '') {
  const on = isFav(kind, id);
  return `<button class="fav-quick ${extra} ${on ? 'is-on' : ''}" data-action="favorite" data-kind="${kind}" data-id="${e(String(id))}" data-title="${e(title)}" aria-pressed="${on}" aria-label="${e(favLabel(on, kind, title))}">${icon('star')}</button>`;
}
function paintStars(kind, id) {
  const on = isFav(kind, id);
  for (const b of document.querySelectorAll(`[data-action="favorite"][data-kind="${kind}"][data-id="${CSS.escape(String(id))}"]`)) { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', favLabel(on, kind, b.dataset.title || '')); }
}
async function toggleFavorite(kind, id, title) {
  if (!KIND[kind]) return;
  const on = !isFav(kind, id); const before = favorites;
  favorites = on ? [{ kind, id: kind === 'lesson' ? Number(id) : id, title }, ...favorites] : favorites.filter(f => !sameItem(f, kind, id));
  const relist = () => { paintStars(kind, id); if (catalogueTab === 'favorites' || (kind === 'prompt' && promptCategory === 'fav')) refreshResults(); };
  relist();
  try { tg?.HapticFeedback.selectionChanged(); } catch {}
  if (config.preview) { if (on) toast('Добавлено в избранное.'); return; }
  try {
    const response = await fetch(`/api/favorites/${kind}/${encodeURIComponent(id)}`, { method: on ? 'PUT' : 'DELETE', headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (!response.ok) { let message = ''; try { const body = await response.json(); if (/[А-Яа-я]/.test(body.error || '')) message = body.error; } catch {} throw new Error(message); }
    favorites = (await response.json()).items || favorites;
    if (on) toast('Добавлено в избранное.');
  } catch (error) {
    favorites = before; relist();
    toast(error.message || (on ? 'Не удалось добавить в избранное. Проверьте соединение и попробуйте ещё раз.' : 'Не удалось убрать из избранного. Проверьте соединение и попробуйте ещё раз.'));
  }
}
function pushOpened(kind, id, title) {
  if (!KIND[kind] || !title) return;
  writeLocal(OPENED_KEY, [{ kind, id, title }, ...readLocal(OPENED_KEY, []).filter(x => x && !sameItem(x, kind, id))].slice(0, 6));
}
function recentStrip() {
  const list = readLocal(OPENED_KEY, []); const items = (Array.isArray(list) ? list : []).filter(x => x && KIND[x.kind] && typeof x.title === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(String(x.id))).slice(0, 6);
  if (!items.length) return '';
  return `<section class="recent-strip" aria-labelledby="recent-title"><div class="section-heading"><h2 id="recent-title">Недавно открытое</h2></div><div class="recent-row">${items.map(x => `<button class="recent-item" data-action="${x.kind}" data-id="${e(String(x.id))}"><span class="recent-kind">${icon(KIND[x.kind][1])}${KIND[x.kind][0]}${x.kind === 'lesson' ? ' ' + String(x.id).padStart(2, '0') : ''}</span><strong>${e(x.title)}</strong></button>`).join('')}</div></section>`;
}
// ---- learning project and lesson exercises (learn.js; server/exercises.mjs checks and stores the answers) ----
// project / exList come from the server and are tied to the verified Telegram account. Drafts of an answer live in
// localStorage (per exercise and version) only until the answer is checked.
let project = null; let projectFailed = false; let exList = null; let viewStage = '';
const exState = new Map();
const DRAFT_KEY = 'vibentry.drafts.v1';
const wide = () => matchMedia('(min-width:1024px)').matches;
let projectLoading = null; let exListLoading = null;
function loadProject(force = false) {
  if ((project && !force) || projectLoading) return projectLoading || Promise.resolve();
  projectLoading = getApi('/api/project').then(p => { project = p; projectFailed = false; }, () => { projectFailed = !project; }).finally(() => { projectLoading = null; refreshLearning(); });
  return projectLoading;
}
function loadExercises(force = false) {
  if ((exList && !force) || exListLoading) return exListLoading || Promise.resolve();
  exListLoading = getApi('/api/exercises').then(r => { exList = r.items || []; }, () => {}).finally(() => { exListLoading = null; refreshLearning(); });
  return exListLoading;
}
// Re-draw the blocks that depend on the project or the exercise list, in place.
function refreshLearning() {
  const blocks = { 'project-card': projectCard, 'home-practice': homePractice };
  document.querySelectorAll('[data-learn]').forEach(node => {
    const name = node.dataset.learn;
    // Re-draw only when the data behind the block changed (keeps the site's assembly animation and typing focus).
    if (blocks[name]) { const html = blocks[name](); const sig = /data-sig="([^"]*)"/.exec(html)?.[1]; if (sig !== node.dataset.sig) node.outerHTML = html; }
    else if (name === 'project-view') { if (project && !project.stages.some(s => s.id === viewStage)) viewStage = project.stages[project.current].id; node.innerHTML = projectBody(); }
    else if (name === 'lesson-panel') node.innerHTML = lessonPanel(Number(node.dataset.id));
    else if (name === 'practice-list') { const q = new URLSearchParams(location.hash.split('?')[1] || ''); if (!q.get('ex') && !q.get('id')) { const shown = document.querySelector('#practice-work [data-ex-slot]')?.dataset.exSlot; if (shown) q.set('ex', shown); } node.innerHTML = practiceList2(q); }
  });
}
async function ensureExercise(id, force = false) {
  const known = exState.get(id);
  if (!force && known && (known.x || known.locked || known.loading)) return;
  exState.set(id, { loading: true });
  try {
    const response = await fetch('/api/exercises/' + encodeURIComponent(id), { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (response.status === 403) { const body = await response.json().catch(() => ({})); exState.set(id, { locked: body.card || exList?.find(x => x.id === id) || { id, title: 'Задание', skill: '', type: '', lesson: 0 } }); }
    else if (!response.ok) throw new Error('exercise');
    else {
      const { exercise, saved } = await response.json();
      const draft = readLocal(DRAFT_KEY, {})[`${id}@${exercise.version}`];
      exState.set(id, { x: exercise, saved, answer: startAnswer(exercise, saved, draft), result: saved && !saved.outdated ? saved.result : null });
    }
  } catch { exState.set(id, { failed: true }); }
  paintExercise(id);
}
function exerciseInner(id, compact) {
  const st = exState.get(id);
  if (!st || st.loading) return '<div class="loading" role="status">Загружаем задание<span></span></div>';
  if (st.failed) return `<div class="empty-state compact">${icon('file')}<h3>Задание не загрузилось</h3><p>Проверьте соединение и попробуйте ещё раз.</p><button class="button button-secondary" data-action="ex-load" data-id="${e(id)}">Повторить${icon('arrow')}</button></div>`;
  if (st.locked) return exerciseLocked(st.locked, { price: priceLabel() });
  return exerciseHtml(st.x, st, { lessonTitle: n => lessons[n - 1]?.title || '', compact });
}
function exerciseSlot(id, compact = false) { return `<div class="ex-slot" data-ex-slot="${e(id)}" data-compact="${compact ? '1' : ''}">${exerciseInner(id, compact)}</div>`; }
function paintExercise(id) {
  document.querySelectorAll(`[data-ex-slot="${CSS.escape(id)}"]`).forEach(slot => {
    const focused = document.activeElement?.closest?.('[data-ex-slot]') === slot ? document.activeElement : null;
    const key = focused && (focused.id || `${focused.dataset.action}|${focused.dataset.id}|${focused.dataset.item || ''}`);
    slot.innerHTML = exerciseInner(id, !!slot.dataset.compact);
    // Keep the keyboard focus on the same control after a move or a pick (buttons are re-drawn).
    if (key) (focused.id ? slot.querySelector('#' + CSS.escape(focused.id)) : [...slot.querySelectorAll('[data-action]')].find(b => `${b.dataset.action}|${b.dataset.id}|${b.dataset.item || ''}` === key && !b.disabled))?.focus();
  });
}
function saveDraft(id) { const st = exState.get(id); if (!st?.x) return; const drafts = readLocal(DRAFT_KEY, {}); drafts[`${id}@${st.x.version}`] = st.answer; writeLocal(DRAFT_KEY, drafts); }
function clearDraft(id) { const st = exState.get(id); if (!st?.x) return; const drafts = readLocal(DRAFT_KEY, {}); delete drafts[`${id}@${st.x.version}`]; writeLocal(DRAFT_KEY, drafts); }
function editExercise(id, change) {
  const st = exState.get(id); if (!st?.x || st.busy) return;
  change(st.answer, st.x); st.error = ''; saveDraft(id); paintExercise(id);
}
async function checkExercise(id) {
  const st = exState.get(id); if (!st?.x || st.busy) return;
  st.busy = true; st.error = ''; paintExercise(id);
  try {
    const r = await sendApi('/api/exercises/' + encodeURIComponent(id), { answer: st.answer });
    st.result = r.result;
    if (r.saved) { st.saved = { ...(st.saved || {}), answer: st.answer, passed: r.passed, attempts: (st.saved?.attempts || 0) + 1, outdated: false }; clearDraft(id); }
    try { tg?.HapticFeedback.notificationOccurred(r.result.passed ? 'success' : 'warning'); } catch {}
    if (r.saved) { const item = exList?.find(x => x.id === id); if (item) { item.passed = r.passed; item.attempts = st.saved.attempts; } loadProject(true); }
  } catch (error) {
    st.error = error.status === 403 ? 'Задание откроется после покупки.' : error.status === 429 ? 'Слишком много попыток подряд. Подождите несколько минут.' : /[А-Яа-я]/.test(error.message || '') ? error.message : 'Не удалось проверить ответ. Проверьте соединение и нажмите «Проверить» ещё раз — ответ сохранён на этом устройстве.';
    saveDraft(id);
  }
  st.busy = false; paintExercise(id); refreshLearning();
  document.querySelector(`[data-ex-slot="${CSS.escape(id)}"] .ex-result`)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// ---- «Практика»: choose on the left, work on the right; on a phone the chosen task opens as its own screen ----
function practiceList2(params) {
  const ex = params.get('ex'); const id = params.get('id');
  const limits = session?.practice; const free = limits && !limits.unlimited;
  const exRows = exList ? exList.map(x => `<a class="pick-row ${ex === x.id ? 'is-selected' : ''} ${x.open ? '' : 'is-locked'}" href="#practice?ex=${x.id}" ${ex === x.id ? 'aria-current="true"' : ''}><span class="pick-type">${e(exerciseTypeName(x.type))} · урок ${pad2(x.lesson)}</span><strong>${e(x.title)}</strong><span class="pick-state">${x.passed ? `${icon('check')}засчитано` : !x.open ? `${icon('lock')}полный доступ` : x.attempts ? 'есть попытки' : 'не начато'}</span></a>`).join('') : '<div class="loading" role="status">Загружаем задания<span></span></div>';
  const trainerRows = trainers.map(t => `<a class="pick-row ${id === t.id ? 'is-selected' : ''}" href="#practice?id=${t.id}" ${id === t.id ? 'aria-current="true"' : ''}><span class="pick-type">Тренажёр · ${e(t.minutes)}</span><strong>${e(t.title)}</strong><span class="pick-state">${e(t.description)}</span></a>`).join('');
  return `<h2 class="pick-title">Задания уроков</h2><p class="pick-note">Связаны с уроками и этапами проекта. Не тратят бесплатные запуски.</p><div class="pick-list">${exRows}</div><h2 class="pick-title">Тренажёры</h2><p class="pick-note">${free ? `Бесплатно: осталось ${limits.remaining} из ${limits.limit} запусков. С полным доступом — без ограничений.` : 'Конструктор, квиз, калькулятор и проверка перед сдачей.'}</p><div class="pick-list">${trainerRows}</div>`;
}
function practiceView(params) {
  loadExercises();
  const ex = params.get('ex'); const id = params.get('id');
  let work = ''; const listParams = new URLSearchParams(params);
  if (ex) { ensureExercise(ex); work = exerciseSlot(ex); }
  else if (id) work = trainerWork(id);
  else if (wide() && exList) { const first = exList.find(x => x.open && !x.passed) || exList.find(x => x.open) || exList[0]; if (first) { ensureExercise(first.id); work = exerciseSlot(first.id); listParams.set('ex', first.id); } }
  else if (wide()) work = '<div class="loading" role="status">Загружаем задания<span></span></div>';
  const chosen = !!(ex || id);
  return `<header class="page-header">${brand(true)}<div><h1>Практика</h1><p>Задания уроков и тренажёры: ответ, проверка, разбор, новая попытка</p></div></header><div class="split-layout practice-layout ${chosen ? 'has-work' : ''}"><aside class="split-main practice-side" data-learn="practice-list" aria-label="Выбор задания">${practiceList2(listParams)}</aside><section class="split-side practice-work" id="practice-work" aria-label="Рабочая область">${chosen ? `<a href="#practice" class="back-link practice-back">${icon('back')}Все задания</a>` : ''}${work}</section></div>${nav('practice')}`;
}
// A trainer opens only after the server allows the launch (free accounts: 3 in total); a launch counts once per app session.
function trainerWork(id) {
  if (practiceStarted.has(id)) return practiceScreen(id);
  if (practiceBlocked.has(id) || (session?.practice && !session.practice.unlimited && session.practice.remaining <= 0)) return practicePaywall(id, priceLabel());
  startPractice(id, renderEpoch);
  return '<div class="loading" role="status">Открываем тренажёр<span></span></div>';
}
async function startPractice(id, epoch) {
  try {
    const result = await sendApi('/api/practice', { id });
    setPracticeData(result.data); practiceStarted.add(id);
    if (session) session.practice = { unlimited: result.unlimited, limit: result.limit, remaining: result.remaining };
    if (!result.unlimited) toast(result.remaining ? `Бесплатный запуск. Осталось ${result.remaining} из ${result.limit}.` : 'Это был последний бесплатный запуск «Практикума».');
  } catch (error) {
    if (error.status === 403) { practiceBlocked.add(id); if (session?.practice) session.practice.remaining = 0; }
    else if (epoch === renderEpoch) { const box = document.querySelector('#practice-work'); if (box) box.innerHTML = errorPanel(); return; }
  }
  if (route().name === 'practice' && route().params.get('id') === id) render();
}
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
const urlFor = (tab = 'lessons') => (tab === 'lessons' ? '#lessons' : `#materials?tab=${tab}`);
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

try { tg?.ready(); tg?.expand(); tg?.setHeaderColor('#031c14'); tg?.setBackgroundColor('#031c14'); } catch {}
try { tg?.BackButton.onClick(back); } catch {}

function route() { const [name, params] = (location.hash.slice(1) || 'home').split('?'); return { name, params: new URLSearchParams(params) }; }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
// Telegram's «Назад»: a reader returns to its list, a chosen task to «Практика», every other screen to the home screen.
function back() { const { name, params } = route(); if (overlay.innerHTML) { closeModal(); return; } go(name === 'article' ? urlFor('base') : name === 'lesson' ? '#lessons?id=' + (params.get('id') || '') : name === 'practice' && (params.get('id') || params.get('ex')) ? '#practice' : '#home'); }
function brand(compact = false) { return `<a href="#home" class="brand ${compact ? 'brand-compact' : ''}" aria-label="Vibentry — главная"><span class="brand-image"><img src="/assets/brand.png" alt="Знак ve. Vibentry" width="64" height="64"></span>${compact ? '' : '<span><strong>Vibentry<span class="brand-dot">.</span></strong><span class="brand-caption">База по вайбкодингу</span></span>'}</a>`; }
function nav(active) {
  // «Мой проект» and «Админка» live in the side menu on a computer; on a phone the project opens from the home card.
  const items = [['home', 'home', 'Главная'], ['lessons', 'book', 'Уроки'], ['project', 'target', 'Мой проект', 'nav-wide'], ['materials', 'file', 'Материалы'], ['practice', 'play', 'Практика'], ['profile', 'user', 'Профиль'], ...(session?.isAdmin ? [['admin', 'sparkle', 'Админка', 'nav-wide']] : [])];
  return `<nav class="bottom-nav" aria-label="Основная навигация"><a href="#home" class="nav-brand"><img src="/assets/brand.png" alt="" width="40" height="40"><span><strong>Vibentry</strong><small>курс по вайбкодингу</small></span></a>${items.map(([id, glyph, label, extra = '']) => `<a href="#${id}" class="nav-item ${extra} ${active === id ? 'is-active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')}${planChip()}</nav>`;
}
function planChip() { return session?.user ? `<div class="nav-plan">${planBadge(session.access?.active ? 'pro' : 'free')}<span>${e(session.user.first_name)}</span></div>` : ''; }
function heading(kicker, title, caption = '') { return `<div class="section-heading"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2></div>${caption ? `<span class="section-meta">${caption}</span>` : ''}</div>`; }
const pad2 = n => String(n).padStart(2, '0');
const canOpenLesson = id => !!lessons[id - 1]?.free || !!session?.access?.active;
// The lesson to continue: the first one not done that this account can open, else the first not done at all.
function nextLesson() { return lessons.find(l => !progress.done.includes(l.id) && canOpenLesson(l.id)) || lessons.find(l => !progress.done.includes(l.id)) || null; }
const MODULE_ART = { 1: 'template', 2: 'palette', 3: 'brief', 4: 'checklist' };
// Learning project card (home and «Мой проект»): the volumetric site shows how many stages are really done.
function projectCard() {
  const p = project; const done = p?.completed || 0; const cur = p?.stages?.[p.current];
  const line = !p ? (projectFailed ? 'Не удалось загрузить проект.' : 'Загружаем проект…') : done === 4 ? 'Все 4 этапа завершены' : `Учебный проект · этап ${p.current + 1} из 4 · ${e(cur.title)}`;
  const sig = p ? `${done}:${p.current}:${p.stages.map(s => s.ready).join('')}` : projectFailed ? 'failed' : 'loading';
  return `<section class="project-card" data-learn="project-card" data-sig="${sig}" aria-labelledby="project-title"><div class="project-copy"><span class="eyebrow">Ваш следующий шаг</span><h1 id="project-title">Ваш сайт обретает форму</h1><p>Проходите уроки, выполняйте задания — и учебный сайт собирается вместе с вами.</p></div><div class="project-art">${site3d(done, '')}</div><div class="project-foot"><p class="project-line">${line}</p>${p ? stageStepper(p, '') : projectFailed ? '<button class="button button-secondary" data-action="project-retry">Повторить</button>' : ''}<a class="text-link project-open" href="#project">Открыть проект${icon('arrow')}</a></div></section>`;
}
function lessonNowCard() {
  const l = nextLesson();
  const n = progress.done.length;
  if (!l) return `<section class="lesson-now"><span class="lesson-now-art">${art3d('flag')}</span><div class="lesson-now-copy"><span class="eyebrow">Курс пройден</span><h2>Все 24 урока пройдены</h2><p>Закрепите навык в «Практике» и соберите следующий проект.</p></div><a class="button button-primary" href="#practice">Открыть практику${icon('arrow')}</a></section>`;
  const locked = !canOpenLesson(l.id);
  const freeDone = locked && lessons.filter(x => x.free).every(x => progress.done.includes(x.id));
  const action = freeDone ? `<a class="button button-primary" href="#next">Что дальше в курсе${icon('arrow')}</a>` : `<button class="button button-primary" data-action="lesson" data-id="${l.id}">${locked ? 'Открыть доступ' : n ? 'Продолжить урок' : 'Начать урок'}${icon(locked ? 'lock' : 'arrow')}</button>`;
  return `<section class="lesson-now" aria-labelledby="lesson-now-title"><span class="lesson-now-art">${art3d(MODULE_ART[l.module])}</span><div class="lesson-now-copy"><span class="eyebrow">${n ? 'Продолжить обучение' : 'Начните с первого урока'}</span><h2 id="lesson-now-title">${pad2(l.id)} · ${e(l.title)}</h2><p>${e(l.outcome)}</p><div class="progress-caption"><span>Пройдено ${n} из 24 уроков</span><span>${Math.round(n / 24 * 100)}%</span></div><progress max="24" value="${n}" aria-label="Прогресс курса"></progress></div>${action}</section>`;
}
// «Ваша практика»: the next lesson exercise this account can do, right on the home screen.
function homePractice() {
  const head = `<div class="section-heading"><h2>Ваша практика</h2><a class="section-link" href="#practice">Все задания${icon('chevron')}</a></div>`;
  if (!exList) return `<section class="home-practice" data-learn="home-practice" data-sig="loading">${head}<div class="loading" role="status">Загружаем задания<span></span></div></section>`;
  const next = exList.find(x => x.open && !x.passed);
  if (!next) {
    const locked = exList.find(x => !x.open);
    return `<section class="home-practice" data-learn="home-practice" data-sig="none">${head}<div class="empty-state compact">${icon('check')}<h3>Доступные задания засчитаны</h3><p>${locked ? `Остальные ${exList.filter(x => !x.open).length} заданий откроются вместе с уроками полного курса.` : 'Можно вернуться к любому заданию и пройти его ещё раз.'}</p><a class="button button-secondary" href="#practice">Открыть практику${icon('arrow')}</a></div></section>`;
  }
  ensureExercise(next.id);
  return `<section class="home-practice" data-learn="home-practice" data-sig="${next.id}">${head}${exerciseSlot(next.id, true)}</section>`;
}
function homeMaterials() {
  const card = (artKind, title, text, href, label) => `<a class="mat-tile" href="${href}"><span class="mat-tile-art">${art3d(artKind)}</span><span class="mat-tile-copy"><strong>${title}</strong><small>${text}</small><span class="mat-tile-go">${label}${icon('arrow')}</span></span></a>`;
  return `<section class="home-materials" aria-labelledby="home-mat-title"><div class="section-heading"><h2 id="home-mat-title">Материалы и практика</h2><a class="section-link" href="#materials">Вся библиотека${icon('chevron')}</a></div><div class="mat-tiles">${card('braces', 'Конструктор промпта', 'Цель, аудитория, блоки — и готовый запрос для первой страницы.', '#practice?id=builder', 'Собрать промпт')}${card('folder', 'Шаблоны из уроков', 'Бриф, оценка работ, отклик на заявку и список передачи.', urlFor('templates'), 'Открыть шаблоны')}${card('checklist', 'Проверка перед запуском', 'Десять пунктов из урока 12: путь посетителя по вашему сайту.', '#practice?ex=launch-check', 'Открыть проверку')}${card('brief', `${config.library?.prompts || 300} промптов`, 'Готовые запросы для каждого этапа: от брифа до сдачи.', urlFor('prompts'), 'Открыть промпты')}</div></section>`;
}
function home() {
  loadProject(); loadExercises();
  return `<header class="home-header">${brand()}</header>
  <div class="home-grid">${projectCard()}${lessonNowCard()}${homeMaterials()}${homePractice()}</div>
  ${recentStrip()}<p class="home-note">Одна сделанная страница полезнее десяти прочитанных.</p>${nav('home')}`;
}
// «Мой проект»: the volumetric site, the four stages and the stage someone opened.
function projectView(params) {
  loadProject(); loadExercises();
  const wanted = params.get('stage');
  if (project) viewStage = project.stages.some(s => s.id === wanted) ? wanted : project.stages.some(s => s.id === viewStage) ? viewStage : project.stages[project.current].id;
  return `<header class="page-header">${brand(true)}<div><h1>Мой проект</h1><p>Учебный сайт, который собирается по мере обучения</p></div></header><div class="project-layout" data-learn="project-view">${projectBody()}</div>${nav('project')}`;
}
function projectBody() {
  if (!project) return projectFailed ? `<div class="empty-state">${icon('file')}<h2>Проект не загрузился</h2><p>Проверьте соединение и попробуйте ещё раз.</p><button class="button button-primary" data-action="project-retry">Повторить${icon('arrow')}</button></div>` : '<div class="loading" role="status">Загружаем проект<span></span></div>';
  const stage = project.stages.find(s => s.id === viewStage) || project.stages[project.current];
  return `<section class="project-stage-view"><div class="project-art big">${site3d(project.completed, stage.id)}</div>${stageStepper(project, stage.id)}<p class="project-legend">Готово этапов: ${project.completed} из 4. Сайт показывает то, что вы уже сделали. Нажмите на этап, чтобы посмотреть задание.</p></section><div class="stage-slot">${stagePanel(stage, { lessonTitle: id => lessons[id - 1]?.title || '', canOpenLesson })}</div>`;
}
// Opening a stage only changes what is shown (no hash render, so the layers animate); it never marks the stage.
function showStage(id) {
  if (route().name !== 'project') { go('#project?stage=' + id); return; }
  viewStage = id; history.replaceState(null, '', '#project?stage=' + id);
  const stage = project?.stages.find(s => s.id === id); if (!stage) return;
  document.querySelector('.site3d')?.setAttribute('data-focus', id);
  document.querySelectorAll('.stage-steps li').forEach(li => { const on = li.querySelector('button')?.dataset.id === id; li.classList.toggle('is-selected', on); li.querySelector('button')?.setAttribute('aria-pressed', String(on)); });
  const slot = document.querySelector('.stage-slot'); if (slot) slot.innerHTML = stagePanel(stage, { lessonTitle: x => lessons[x - 1]?.title || '', canOpenLesson });
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
let justDone = 0;
function lessonRow(lesson, selected = 0) {
  const done = progress.done.includes(lesson.id);
  const locked = !lesson.free && !session?.access?.active;
  const active = lesson.id === nextLesson()?.id && !done && !locked;
  const note = active ? '<small>Ваш следующий шаг</small>' : done ? '<small>Пройдено</small>' : locked ? '<small>Полный доступ</small>' : '';
  return `<button class="lesson-row ${active ? 'lesson-current' : ''} ${done ? 'lesson-done' : ''} ${locked ? 'lesson-locked' : ''} ${selected === lesson.id ? 'is-selected' : ''} ${justDone === lesson.id ? 'just-done' : ''}" data-action="lesson" data-id="${lesson.id}" ${selected === lesson.id ? 'aria-current="true"' : ''}><span class="lesson-number">${pad2(lesson.id)}</span><span class="lesson-info"><strong>${e(lesson.title)}</strong>${note}</span><span class="lesson-status ${done ? 'done-badge' : ''}">${icon(done ? 'check' : locked ? 'lock' : 'chevron')}</span></button>`;
}
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return b > 10 && b < 20 ? many : a === 1 ? one : a > 1 && a < 5 ? few : many; };
const matches = (query, ...parts) => !query || parts.join(' ').toLocaleLowerCase('ru').includes(query);
function libraryNotice(kind) {
  if (library.failed[kind]) return `<div class="empty-state">${icon('file')}<h2>Не удалось загрузить</h2><p>Проверьте соединение и попробуйте ещё раз.</p><button class="button button-primary" data-action="reload-library">Повторить${icon('arrow')}</button></div>`;
  if (library[kind]) return '';
  return '<div class="loading" role="status">Загружаем<span></span></div>';
}
function emptySearch() { return `<div class="empty-state">${icon('search')}<h2>Пока ничего не нашлось</h2><p>Попробуйте другое слово или номер.</p></div>`; }

// ---- «Уроки»: the programme on the left, the chosen lesson on the right (on a phone a tap opens the lesson) ----
let lessonSearch = '';
function lessonListBody(selected) {
  const query = lessonSearch.trim().toLocaleLowerCase('ru');
  return modules.map(m => {
    const rows = lessons.filter(l => l.module === m.id && matches(query, l.title, l.id, l.outcome));
    if (!rows.length) return '';
    const done = lessons.filter(l => l.module === m.id && progress.done.includes(l.id)).length;
    const meta = m.end <= FREE_LESSONS ? '<span class="free-label">Бесплатно после подписки</span>' : session?.access?.active ? `${done} из ${m.end - m.start + 1}` : `${icon('lock')}Полный доступ`;
    return `<section class="module-section hue-${m.id}">${heading(m.range, m.title, meta)}<div class="lesson-list">${rows.map(l => lessonRow(l, selected)).join('')}</div></section>`;
  }).join('') || emptySearch();
}
const STAGE_TITLE = { structure: 'Структура', design: 'Дизайн', content: 'Контент', publish: 'Публикация' };
function lessonPanel(id) {
  const l = lessons[id - 1]; if (!l) return '';
  const m = modules.find(x => x.id === l.module);
  const done = progress.done.includes(id); const locked = !canOpenLesson(id);
  const tasks = (exList || []).filter(x => x.lesson === id);
  const stage = tasks.find(x => x.stage)?.stage;
  const status = done ? `<span class="chip-status is-done">${icon('check')}Пройден</span>` : locked ? `<span class="chip-status">${icon('lock')}Полный доступ</span>` : id === nextLesson()?.id ? '<span class="chip-status is-next">Следующий шаг</span>' : '<span class="chip-status">Не начат</span>';
  const taskRows = tasks.length ? `<ul class="panel-tasks">${tasks.map(x => `<li><a href="#practice?ex=${x.id}"><span class="panel-task-type">${e(exerciseTypeName(x.type))}</span><strong>${e(x.title)}</strong><small>${e(x.skill)}</small></a>${x.passed ? `<span class="chip-status is-done">${icon('check')}Засчитано</span>` : !x.open ? icon('lock') : ''}</li>`).join('')}</ul>` : '<p class="panel-muted">В этом уроке задание — чек-лист «Готово, когда» внутри урока.</p>';
  return `<article class="lesson-panel-card hue-${l.module}" aria-labelledby="lesson-panel-title"><div class="panel-top"><span class="eyebrow">Урок ${pad2(id)} / 24 · ${e(m.title)}</span>${starButton('lesson', id, l.title, 'fav-inline')}</div><h2 id="lesson-panel-title">${e(l.title)}</h2>${status}<div class="panel-outcome">${icon('target')}<p><span>Чему научитесь</span>${e(l.outcome)}</p></div><h3>Задание к уроку</h3>${taskRows}${stage ? `<p class="panel-stage">Этап учебного проекта: <a href="#project?stage=${stage}">${STAGE_TITLE[stage]}</a></p>` : ''}<div class="panel-actions"><button class="button button-primary" data-action="lesson-open" data-id="${id}">${locked ? 'Открыть доступ' : done ? 'Открыть ещё раз' : progress.done.length ? 'Продолжить' : 'Открыть урок'}${icon(locked ? 'lock' : 'arrow')}</button></div>${locked ? `<p class="panel-muted">Уроки ${pad2(FREE_LESSONS + 1)}–24 открываются после покупки${priceLabel() ? ` · ${e(priceLabel())} навсегда` : ''}.</p>` : ''}</article>`;
}
function lessonsView(params) {
  loadExercises();
  const selected = Number(params.get('id')) || nextLesson()?.id || 1;
  return `<header class="page-header">${brand(true)}<div><h1>Уроки</h1><p>24 урока · 4 модуля · первые ${FREE_LESSONS} бесплатно после подписки</p></div></header><div class="split-layout lessons-layout"><div class="split-main"><div class="catalogue-tools"><label class="search-box">${icon('search')}<input type="search" id="lesson-search" aria-label="Найти урок" placeholder="Найти урок" value="${e(lessonSearch)}" autocomplete="off"></label></div><div id="lesson-results">${lessonListBody(selected)}</div></div><aside class="split-side lesson-panel" data-learn="lesson-panel" data-id="${selected}" aria-label="Выбранный урок">${lessonPanel(selected)}</aside></div>${session?.access?.active ? '' : accessBanner()}${nav('lessons')}`;
}
function accessBanner() { return `<button class="access-banner" data-action="access"><span class="access-icon">${icon('lock')}</span><span><strong>Откройте весь Vibentry</strong><small>Уроки ${pad2(FREE_LESSONS + 1)}–24, 300 промптов и вся база${priceLabel() ? ' · ' + priceLabel() + ' навсегда' : ''}</small></span>${icon('arrow')}</button>`; }

// ---- «Материалы»: catalogue on the left, a permanent preview on the right (a bottom sheet on a phone) ----
const TABS = [['templates', 'Шаблоны'], ['prompts', 'Промпты'], ['base', 'База'], ['terms', 'Термины'], ['favorites', 'Избранное']];
const PLACEHOLDER = { prompts: 'Найти промпт', templates: 'Найти шаблон', base: 'Найти материал', terms: 'Найти термин', favorites: 'Найти в избранном' };
const MAT_KIND = { prompt: 'Промпт', resource: 'Шаблон', article: 'База', term: 'Термин', lesson: 'Урок' };
let selectedMat = null; let highlightTerm = '';
const fragments = new Map();
const matOpen = (kind, id) => kind === 'term' ? true : kind === 'lesson' ? canOpenLesson(Number(id)) : kind === 'article' ? !!library.articles?.items.find(a => a.id === id)?.free || !!session?.access?.active : !!session?.access?.active;
function matCard(kind, id, title, text, { number = '', fav = true } = {}) {
  const open = matOpen(kind, id); const on = selectedMat && selectedMat.kind === kind && String(selectedMat.id) === String(id);
  return `<div class="mat-card ${on ? 'is-selected' : ''} ${open ? '' : 'is-locked'}"><button class="mat-card-main" data-action="mat-select" data-kind="${kind}" data-id="${e(String(id))}" aria-pressed="${!!on}"><span class="mat-type">${number ? `<b>${e(number)}</b>` : ''}${MAT_KIND[kind]}${open ? '' : ` · ${icon('lock')}полный доступ`}</span><strong>${e(title)}</strong>${text ? `<small>${e(text)}</small>` : ''}</button>${fav && kind !== 'term' ? starButton(kind, id, title, 'fav-inline') : ''}</div>`;
}
function promptsBody(query) {
  const notice = libraryNotice('prompts'); if (notice) return notice;
  const { categories, items } = library.prompts;
  if (!items.length) return `<div class="empty-state">${icon('copy')}<h2>Промпты скоро появятся</h2><p>Библиотека из 300 запросов подключается вместе с остальными материалами курса.</p></div>`;
  const byId = new Map(items.map(item => [item.id, item]));
  const recent = readLocal(RECENT_KEY, []).filter(id => byId.has(id));
  const special = [['fav', 'Избранное', favIds('prompt').length], ['recent', 'Недавние', recent.length]].filter(([, , n]) => n > 0).map(([id, label, n]) => `<button class="chip chip-special ${promptCategory === id ? 'selected' : ''}" data-action="prompt-category" data-id="${id}">${id === 'fav' ? icon('star') : icon('clock')}${label} <span>${n}</span></button>`).join('');
  const chips = `<div class="chips" role="group" aria-label="Категории промптов"><button class="chip ${promptCategory === 'all' ? 'selected' : ''}" data-action="prompt-category" data-id="all">Все ${items.length}</button>${special}${categories.map(c => `<button class="chip ${promptCategory === c.id ? 'selected' : ''}" data-action="prompt-category" data-id="${e(c.id)}">${e(c.title)} <span>${c.ids.length}</span></button>`).join('')}</div>`;
  const ids = promptCategory === 'fav' ? favIds('prompt') : promptCategory === 'recent' ? recent : categories.find(c => c.id === promptCategory)?.ids;
  const chosen = promptCategory === 'all' || !ids ? items : ids.map(id => byId.get(id)).filter(Boolean);
  const all = chosen.filter(item => matches(query, item.id, item.title, item.use));
  const rows = all.slice(0, promptLimit); const rest = all.length - rows.length;
  const more = rest > 0 ? `<button class="button button-secondary more-button" data-action="more-prompts">Показать ещё ${Math.min(30, rest)} · осталось ${rest}</button>` : '';
  return `${chips}<div class="mat-list">${rows.map(item => matCard('prompt', item.id, item.title, item.use, { number: '№' + item.id })).join('') || emptySearch()}</div>${more}`;
}
function templatesBody(query) {
  const rows = materials.filter(m => matches(query, m.title, m.description));
  return rows.length ? `<p class="practice-intro">Готовые заготовки из уроков: заполните своими данными и пользуйтесь в работе.</p><div class="mat-list">${rows.map(m => matCard('resource', m.id, m.title, m.description)).join('')}</div>` : emptySearch();
}
function baseBody(query) {
  const notice = libraryNotice('articles'); if (notice) return notice;
  const items = library.articles.items.filter(a => matches(query, a.title, a.description, a.groupTitle));
  const groups = [...new Set(library.articles.items.map(a => a.group))];
  const sections = groups.map(group => {
    const rows = items.filter(a => a.group === group);
    return rows.length ? `<section class="module-section">${heading('', e(rows[0].groupTitle), `${rows.length} ${plural(rows.length, 'материал', 'материала', 'материалов')}`)}<div class="mat-list">${rows.map(a => matCard('article', a.id, a.title, (a.free ? 'Открыт для всех · ' : '') + (a.description || ''))).join('')}</div></section>` : '';
  }).join('');
  return sections || emptySearch();
}
// «Термины»: open to everyone; the term from a lesson (#materials?tab=terms&term=id) is highlighted.
function termsBody(query) {
  const rows = TERMS.filter(t => matches(query, t.title, t.text));
  const sections = GROUPS.map(([id, title]) => { const items = rows.filter(t => t.group === id); return items.length ? `<section class="module-section">${heading('', title, `${items.length} ${plural(items.length, 'термин', 'термина', 'терминов')}`)}<div class="term-list">${items.map(t => `<article class="term-card ${highlightTerm === t.id ? 'is-highlighted' : ''}" id="term-${t.id}"><h3>${e(t.title)}</h3><p>${e(t.text)}</p></article>`).join('')}</div></section>` : ''; }).join('');
  return sections ? `<p class="practice-intro">Простые объяснения слов из уроков. В текстах такие слова подчёркнуты — нажмите на слово, чтобы увидеть объяснение.</p>${sections}` : emptySearch();
}
function openTerm(id) {
  const t = TERMS.find(x => x.id === id); if (!t) return;
  modal(e(t.title), `<p>${e(t.text)}</p><a class="button button-secondary" href="${urlFor('terms')}&term=${t.id}" data-action="all-terms">Все термины${icon('arrow')}</a>`);
}
function favoritesBody(query) {
  if (!favorites.length) return `<div class="empty-state">${icon('star')}<h2>Здесь будут ваши закладки</h2><p>Нажмите звёздочку у промпта, шаблона, урока или материала базы — он появится здесь. Закладки хранятся в вашем аккаунте Telegram, их видно на любом устройстве.</p><a class="button button-secondary" href="${urlFor('templates')}">К шаблонам${icon('arrow')}</a></div>`;
  const sections = [['lesson', 'Уроки'], ['prompt', 'Промпты'], ['resource', 'Шаблоны'], ['article', 'Материалы базы']].map(([kind, title]) => {
    const rows = favorites.filter(f => f.kind === kind && matches(query, f.title, f.id));
    return rows.length ? `<section class="module-section">${heading('', title, String(rows.length))}<div class="mat-list">${rows.map(f => matCard(kind, f.id, f.title, '', { number: kind === 'lesson' ? pad2(f.id) : kind === 'prompt' ? '№' + f.id : '' })).join('')}</div></section>` : '';
  }).join('');
  return sections || emptySearch();
}
function catalogueBody(tab) {
  const query = search.trim().toLocaleLowerCase('ru');
  if (tab === 'prompts') return promptsBody(query);
  if (tab === 'base') return baseBody(query);
  if (tab === 'terms') return termsBody(query);
  if (tab === 'favorites') return favoritesBody(query);
  return templatesBody(query);
}
// The first card of the current list is previewed until something else is chosen.
function defaultMat(tab) {
  if (tab === 'templates') return materials[0] && { kind: 'resource', id: materials[0].id };
  if (tab === 'prompts') return library.prompts?.items?.[0] && { kind: 'prompt', id: library.prompts.items[0].id };
  if (tab === 'base') return library.articles?.items?.[0] && { kind: 'article', id: library.articles.items[0].id };
  if (tab === 'favorites') return favorites[0] && { kind: favorites[0].kind, id: favorites[0].id };
  return null;
}
function matInfo(kind, id) {
  if (kind === 'prompt') { const p = library.prompts?.items.find(x => x.id === id); const cat = library.prompts?.categories.find(c => c.ids.includes(id)); return p && { title: p.title, purpose: p.use, parts: cat ? [`Категория: ${cat.title}`, 'Квадратные скобки — места для ваших данных'] : [], open: () => openPrompt(id) }; }
  if (kind === 'resource') { const m = materials.find(x => x.id === id); return m && { title: m.title, purpose: m.description, parts: [`Из урока ${pad2(m.lesson)} · ${lessons[m.lesson - 1].title}`, 'Текст для копирования и заполнения'], lesson: m.lesson }; }
  if (kind === 'article') { const a = library.articles?.items.find(x => x.id === id); return a && { title: a.title, purpose: a.description, group: a.groupTitle, parts: a.outline || [] }; }
  if (kind === 'lesson') { const l = lessons[Number(id) - 1]; return l && { title: `${pad2(l.id)} · ${l.title}`, purpose: l.outcome, parts: [modules.find(m => m.id === l.module).title] }; }
  if (kind === 'term') { const t = TERMS.find(x => x.id === id); return t && { title: t.title, purpose: t.text, parts: [] }; }
  return null;
}
// A small allowed fragment: only for what this account can open (the server checks access again).
async function loadFragment(kind, id) {
  const key = `${kind}:${id}`; if (fragments.has(key) || !matOpen(kind, id) || !['prompt', 'resource'].includes(kind) || config.preview) return;
  fragments.set(key, null);
  try {
    const response = await fetch(`/api/${kind === 'prompt' ? 'prompts' : 'resources'}/${encodeURIComponent(id)}`, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (!response.ok) throw new Error();
    const { text } = await response.json(); fragments.set(key, String(text || ''));
  } catch { fragments.delete(key); }
  const pane = document.querySelector('[data-learn="mat-preview"]');
  if (pane && selectedMat && `${selectedMat.kind}:${selectedMat.id}` === key) pane.innerHTML = matPreviewInner();
  const sheet = overlay.querySelector('.mat-preview'); if (sheet && sheet.dataset.key === key) sheet.outerHTML = matPreviewInner();
}
function matPreviewInner(sel = selectedMat) {
  if (!sel) return `<div class="mat-preview empty">${art3d('folder')}<p>Выберите материал слева, чтобы посмотреть, что в нём.</p></div>`;
  const info = matInfo(sel.kind, sel.id); if (!info) return '<div class="mat-preview empty"><p>Материал не найден.</p></div>';
  const open = matOpen(sel.kind, sel.id); const key = `${sel.kind}:${sel.id}`;
  loadFragment(sel.kind, sel.id);
  const text = fragments.get(key);
  const fragment = sel.kind === 'term' ? '' : !open ? `<div class="mat-fragment is-locked">${icon('lock')}<p>Содержимое откроется после покупки. Здесь видно только назначение и состав.</p></div>` : text ? `<div class="mat-fragment"><span class="eyebrow">Фрагмент</span><pre>${e(text.slice(0, 320))}${text.length > 320 ? '…' : ''}</pre></div>` : ['prompt', 'resource'].includes(sel.kind) && !config.preview ? '<div class="mat-fragment"><div class="loading" role="status">Загружаем фрагмент<span></span></div></div>' : '';
  const action = sel.kind === 'term' ? `<a class="button button-secondary" href="${urlFor('terms')}&term=${sel.id}" data-action="all-terms">Все термины${icon('arrow')}</a>` : !open ? `<button class="button button-primary" data-action="access">Открыть полный доступ${priceLabel() ? ' · ' + e(priceLabel()) : ''}${icon('arrow')}</button>` : `<button class="button button-primary" data-action="mat-open" data-kind="${sel.kind}" data-id="${e(String(sel.id))}">${sel.kind === 'lesson' ? 'Открыть урок' : sel.kind === 'article' ? 'Читать' : 'Открыть и скопировать'}${icon('arrow')}</button>`;
  const artKind = { prompt: 'braces', resource: 'brief', article: 'template', lesson: 'checklist', term: 'brief' }[sel.kind];
  return `<div class="mat-preview" data-key="${e(key)}"><div class="mat-preview-head"><span class="mat-preview-art">${art3d(artKind)}</span><div><span class="eyebrow">${MAT_KIND[sel.kind]}${info.group ? ' · ' + e(info.group) : ''}</span><h2>${e(info.title)}</h2></div>${sel.kind !== 'term' ? starButton(sel.kind, sel.id, info.title, 'fav-inline') : ''}</div><div class="mat-section"><h3>Назначение</h3><p>${e(info.purpose || '')}</p></div>${info.parts.length ? `<div class="mat-section"><h3>Состав</h3><ul>${info.parts.map(p => `<li>${e(p)}</li>`).join('')}</ul></div>` : ''}${fragment}<div class="mat-actions">${action}${info.lesson ? `<a class="text-link" href="#lesson?id=${info.lesson}" data-action="lesson" data-id="${info.lesson}">Урок ${pad2(info.lesson)}${icon('arrow')}</a>` : ''}</div></div>`;
}
function selectMat(kind, id) {
  selectedMat = { kind, id: kind === 'lesson' ? Number(id) : id };
  if (wide()) {
    document.querySelectorAll('.mat-card').forEach(card => { const b = card.querySelector('.mat-card-main'); const on = b?.dataset.kind === kind && b?.dataset.id === String(id); card.classList.toggle('is-selected', on); b?.setAttribute('aria-pressed', String(on)); });
    const pane = document.querySelector('[data-learn="mat-preview"]'); if (pane) pane.innerHTML = matPreviewInner();
  } else {
    const info = matInfo(kind, id);
    modal(e(info?.title || 'Материал'), matPreviewInner());
  }
}
function openMat(kind, id) {
  closeModal(false);
  if (kind === 'prompt') openPrompt(id);
  else if (kind === 'resource') openResource(id);
  else if (kind === 'article') go('#article?id=' + id);
  else if (kind === 'lesson') go('#lesson?id=' + id);
}
function catalogue(params) {
  const wanted = params.get('tab');
  if (wanted === 'lessons') { setTimeout(() => go('#lessons'), 0); return ''; }
  const tab = TABS.some(([id]) => id === wanted) ? wanted : 'templates';
  if (catalogueTab !== tab) selectedMat = null;
  catalogueTab = tab; highlightTerm = tab === 'terms' ? params.get('term') || '' : '';
  if (highlightTerm) setTimeout(() => document.querySelector(`#term-${CSS.escape(highlightTerm)}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
  loadLibrary(tab);
  if (!selectedMat && tab !== 'terms') selectedMat = defaultMat(tab);
  const side = tab === 'terms' ? '' : `<aside class="split-side" aria-label="Предпросмотр"><div class="mat-preview-pane" data-learn="mat-preview">${matPreviewInner()}</div></aside>`;
  return `<header class="page-header">${brand(true)}<div><h1>Материалы</h1><p>Шаблоны, промпты и база — всё, что нужно для вашего сайта</p></div></header><div class="split-layout materials-layout ${side ? '' : 'is-single'}"><div class="split-main"><div class="catalogue-tools"><nav class="filter-row" aria-label="Тип материалов">${TABS.map(([id, label]) => `<a href="${urlFor(id)}" class="chip ${tab === id ? 'selected' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${id === 'favorites' ? icon('star') : ''}${label}</a>`).join('')}</nav><label class="search-box">${icon('search')}<input type="search" id="material-search" aria-label="${PLACEHOLDER[tab]}" placeholder="${PLACEHOLDER[tab]}" value="${e(search)}" autocomplete="off"></label></div><div id="catalogue-results">${catalogueBody(tab)}</div></div>${side}</div>${session?.access?.active ? '' : accessBanner()}${nav('materials')}`;
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
  return `<header class="reader-header"><a href="${urlFor()}" class="back-link">${icon('back')}Все уроки</a>${brand(true)}</header><article class="lesson-article"><div class="reader-meta"><span class="eyebrow">УРОК ${String(id).padStart(2, '0')} / 24</span><span class="reader-tools"><span class="free-label">${meta.free ? 'Бесплатно' : 'Полный доступ'}</span>${starButton('lesson', id, meta.title, 'fav-inline')}</span></div><h1>${e(meta.title)}</h1><div class="outcome">${icon('target')}<p><span>РЕЗУЛЬТАТ УРОКА</span>${e(content.outcome)}</p></div><details class="reader-toc" ${wide() ? 'open' : ''}><summary>Содержание урока</summary><ol></ol></details><div class="article-body">${bodyHtml}</div><section class="lesson-exercises" id="lesson-practice" data-lesson="${id}" aria-label="Практика урока"></section>${practice}<button class="button button-primary finish-button" data-action="finish" ${checked ? '' : 'disabled'}>${progress.done.includes(id) ? 'К следующему шагу' : 'Завершить урок'}${icon('arrow')}</button>${footnote}</article>`;
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
  app.innerHTML = lessonHtml(id, meta, content); pushOpened('lesson', id, meta.title); track('lesson_open', id);
  window.scrollTo({ top: 0, behavior: 'instant' });
  wireChecklist(id); linkTerms(app.querySelectorAll('.lesson-article .article-body, .lesson-article .practice-body')); restoreScroll(id);
  wireToc(); loadExercises().then(() => mountLessonExercises(id));
}
// «Содержание»: the lesson's own headings; buttons scroll (the hash stays the lesson's address).
function wireToc() {
  const list = app.querySelector('.reader-toc ol'); if (!list) return;
  const heads = [...app.querySelectorAll('.lesson-article > .article-body h2, .lesson-article > .article-body h3')];
  heads.forEach((h, i) => { h.id = 'sec-' + i; });
  list.innerHTML = heads.map((h, i) => `<li><button data-action="toc" data-id="sec-${i}">${e(h.textContent)}</button></li>`).join('') + '<li class="toc-practice" hidden><button data-action="toc" data-id="lesson-practice">Практика урока</button></li><li><button data-action="toc" data-id="task-done">Проверьте себя</button></li>';
  if (!heads.length) app.querySelector('.reader-toc')?.remove();
}
// Объяснение и пример — the lesson text; задание и проверка — the exercises of this lesson, right after it.
function mountLessonExercises(id) {
  const box = app.querySelector(`.lesson-exercises[data-lesson="${id}"]`); if (!box || readerId !== id) return;
  const list = (exList || []).filter(x => x.lesson === id);
  if (!list.length) { box.remove(); return; }
  app.querySelector('.toc-practice')?.removeAttribute('hidden');
  box.innerHTML = `<span class="eyebrow">Практика урока</span><h2>Попробуйте сами</h2><p>Задание проверяется сразу: вы увидите, что уже получилось и что стоит дописать. Результат сохраняется в вашем аккаунте.</p>${list.map(x => exerciseSlot(x.id)).join('')}`;
  list.forEach(x => ensureExercise(x.id));
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
    const { html, codes } = copyBlocks(content.markdown); readerCodes = codes; pushOpened('article', id, content.title);
    queueMicrotask(() => linkTerms(app.querySelectorAll('.lesson-article .article-body')));
    app.innerHTML = `<header class="reader-header"><a href="${urlFor('base')}" class="back-link">${icon('back')}База</a>${brand(true)}</header><article class="lesson-article"><div class="reader-meta"><span class="eyebrow">${e(String(content.groupTitle || 'БАЗА').toUpperCase())}</span>${starButton('article', content.id || id, content.title, 'fav-inline')}</div><h1>${e(content.title)}</h1><div class="article-body">${html}</div><a class="button button-secondary" href="${urlFor('base')}">К списку материалов${icon('arrow')}</a></article>`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch { if (epoch === renderEpoch) app.innerHTML = `<header class="reader-header"><a href="${urlFor('base')}" class="back-link">${icon('back')}База</a>${brand(true)}</header>${errorPanel()}`; }
}
// Profile: the next lesson and progress by module — real numbers from progress.done only.
function profileNext() {
  const next = lessons.find(l => !progress.done.includes(l.id));
  if (!next) return `<section class="profile-next"><span class="eyebrow">ВЕСЬ КУРС ПРОЙДЕН</span><strong>Пора применять знания</strong><a class="button button-secondary" href="#practice">Открыть «Практикум»${icon('arrow')}</a></section>`;
  const locked = !next.free && !session?.access?.active;
  return `<section class="profile-next"><span class="eyebrow">СЛЕДУЮЩИЙ УРОК</span><strong>${String(next.id).padStart(2, '0')} · ${e(next.title)}</strong><button class="button button-primary" data-action="lesson" data-id="${next.id}">${locked ? 'Открыть доступ' : progress.done.length ? 'Продолжить' : 'Начать'}${icon(locked ? 'lock' : 'arrow')}</button></section>`;
}
function profileRoute() {
  return `<section class="profile-route" aria-labelledby="route-title"><h2 id="route-title">Маршрут по модулям</h2>${modules.map(m => {
    const ids = lessons.filter(l => l.module === m.id).map(l => l.id); const done = ids.filter(id => progress.done.includes(id)).length;
    return `<div class="route-row hue-${m.id}"><span class="path-num">${String(m.id).padStart(2, '0')}</span><span class="route-body"><strong>${e(m.title)}</strong><progress max="${ids.length}" value="${done}" aria-label="${e(m.title)}: ${done} из ${ids.length}"></progress></span><small>${done}/${ids.length}</small></div>`;
  }).join('')}</section>`;
}
function profile() {
  const name = session?.user?.first_name || 'Ваш профиль';
  const initials = session?.user?.first_name ? e(session.user.first_name[0]) : 've.';
  const active = session?.access?.active;
  const percent = Math.round(progress.done.length / 24 * 100);
  return `<header class="page-header">${brand(true)}<div><h1>Ваш прогресс</h1><p>Маленькие шаги. Настоящие проекты.</p></div></header><div class="profile-side"><section class="profile-card"><div class="profile-avatar">${initials}</div><h2>${e(name)}</h2>${planBadge(active ? 'pro' : 'free')}<span class="profile-label ${active ? 'is-full' : ''}">${active ? 'Полный доступ · навсегда' : `Бесплатный доступ · уроки 01–${String(FREE_LESSONS).padStart(2, '0')}`}</span><div class="profile-stats"><div><strong>${progress.done.length}<span>/24</span></strong><small>уроков пройдено</small></div><div><strong>${percent}<span>%</span></strong><small>вашего маршрута</small></div></div><progress max="24" value="${progress.done.length}" aria-label="Пройдено уроков"></progress><p class="storage-note">${config.preview ? 'Демо: прогресс сохраняется только на этом устройстве.' : 'Прогресс привязан к вашему аккаунту Telegram.'}</p></section>${profileNext()}</div>${active ? '' : `<button class="access-banner" data-action="access"><span class="access-icon">${icon('sparkle')}</span><span><strong>Откройте весь Vibentry</strong><small>Ещё ${24 - FREE_LESSONS} ${plural(24 - FREE_LESSONS, 'урок', 'урока', 'уроков')}, 300 промптов и база${priceLabel() ? ' · ' + priceLabel() + ' навсегда' : ''}</small></span>${icon('arrow')}</button>`}<section class="profile-links"><button data-action="support">${icon('chat')}Помощь и вопросы автору${icon('chevron')}</button><button data-action="community">${icon('lock')}Доступ и оплата${icon('chevron')}</button><button data-action="about">${icon('book')}О курсе${icon('chevron')}</button><button data-action="reset">${icon('back')}Начать заново${icon('chevron')}</button></section>${sessionError ? '<p class="storage-note">Не удалось подтвердить вход через Telegram. Откройте приложение заново из бота.</p>' : ''}${profileRoute()}${legalLinks()}<div class="profile-signature">${brand(true)}<span>Сначала одна маленькая страница.<br>Остальное потом.</span></div>${session?.isAdmin ? '<a class="button button-secondary admin-entry" href="#admin">Админ-панель: участники, акции, каналы</a>' : ''}${nav('profile')}`;
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
  else { try { if (name === 'home') tg?.BackButton.hide(); else tg?.BackButton.show(); } catch {} app.innerHTML = name === 'materials' ? catalogue(params) : name === 'lessons' ? lessonsView(params) : name === 'project' ? projectView(params) : name === 'profile' ? profile() : name === 'admin' ? adminScreen() : name === 'practice' ? practiceView(params) : name === 'next' && !session?.access?.active ? afterFree() : home(); if (name === 'buy') openAccess(params.get('promo') || session?.personalOffer?.code || null); if (name === 'practice' && practiceStarted.has(params.get('id'))) mountPractice(app, { copy }); }
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
// Funnel events (admin «Воронка»): once per app session per type and meta; the server also keeps app_open and paywall_view
// to once a day. Only the type and a lesson number or payment method are sent. The answer is 204 with no body.
const sentEvents = new Set();
function track(type, meta) {
  const key = `${type}:${meta ?? ''}`;
  if (config.preview || !tg?.initData || sentEvents.has(key)) return; sentEvents.add(key);
  fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...(meta != null ? { meta } : {}), initData: tg.initData }) }).then(r => { if (!r.ok) sentEvents.delete(key); }, () => sentEvents.delete(key));
}
function openAccess(promo = null) {
  methods = []; selectedMethod = (config.methods || [])[0]?.id || 'stars';
  promoApplied = null;
  const personal = session?.personalOffer && Date.parse(session.personalOffer.expiresAt) > Date.now() ? session.personalOffer : null;
  const active = session?.access?.active;
  if (!active) track('paywall_view');
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
    const item = await response.json(); pushOpened('prompt', item.id, item.title);
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
  // In «Уроки» on a computer a tap in the programme chooses the lesson for the panel; the panel button opens it.
  if (action === 'lesson' && route().name === 'lessons' && wide() && target.closest('.split-main')) { selectLesson(Number(target.dataset.id)); return; }
  if (action === 'lesson' || action === 'lesson-open') { const lesson = lessons.find(l => l.id === Number(target.dataset.id)); if (!lesson || (!lesson.free && !session?.access?.active)) return openAccess(); go(`#lesson?id=${lesson.id}`); }
  if (action === 'stage') showStage(target.dataset.id);
  if (action === 'project-retry') { projectFailed = false; refreshLearning(); loadProject(true); }
  if (action === 'mat-select') selectMat(target.dataset.kind, target.dataset.id);
  if (action === 'mat-open') openMat(target.dataset.kind, target.dataset.id);
  if (action === 'toc') { const node = document.getElementById(target.dataset.id); node?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  if (action === 'ex-load') ensureExercise(target.dataset.id, true);
  if (action === 'ex-check') checkExercise(target.dataset.id);
  const exId = target.closest('[data-ex]')?.dataset.ex;
  if (exId && action === 'ex-add') editExercise(exId, a => { a.blocks.push(target.dataset.id); });
  if (exId && action === 'ex-remove') editExercise(exId, a => { a.blocks = a.blocks.filter(b => b !== target.dataset.id); });
  if (exId && action === 'ex-move') editExercise(exId, a => { const i = a.blocks.indexOf(target.dataset.id); const j = i + Number(target.dataset.dir); if (i >= 0 && j >= 0 && j < a.blocks.length) [a.blocks[i], a.blocks[j]] = [a.blocks[j], a.blocks[i]]; });
  if (exId && action === 'ex-pick') editExercise(exId, a => { a.picks[Number(target.dataset.item)] = Number(target.dataset.id); });
  if (exId && action === 'ex-mark') editExercise(exId, a => { a.marks[target.dataset.item] = target.dataset.id; });
  if (exId && action === 'ex-reset') { const st = exState.get(exId); if (st?.x) { st.answer = startAnswer(st.x, null, null); st.result = null; clearDraft(exId); paintExercise(exId); } }
  if (action === 'access') openAccess();
  if (action === 'check-subscription') checkSubscription(target);
  if (action === 'preview') { previewEntered = true; render(); }
  if (action === 'pay' || action === 'pay-stub') track('checkout_start', action === 'pay-stub' ? 'stub' : selectedMethod);
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
  if (action === 'favorite') toggleFavorite(target.dataset.kind, target.dataset.id, target.dataset.title || '');
  if (action === 'task-item') toggleTask(target);
  if (action === 'term') openTerm(target.dataset.id);
  if (action === 'home-category') { promptCategory = target.dataset.id; go(urlFor('prompts')); }
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
document.addEventListener('input', event => {
  if (event.target.id === 'material-search') { search = event.target.value; promptLimit = 30; refreshResults(); }
  if (event.target.id === 'lesson-search') { lessonSearch = event.target.value; const box = document.querySelector('#lesson-results'); if (box) box.innerHTML = lessonListBody(Number(route().params.get('id')) || nextLesson()?.id || 1); }
  if (event.target.id === 'ex-text') {
    const id = event.target.closest('[data-ex]')?.dataset.ex; const st = exState.get(id); if (!st?.x) return;
    st.answer.text = event.target.value; saveDraft(id);
    const button = event.target.closest('[data-ex]').querySelector('[data-action="ex-check"]'); if (button && !st.busy) button.disabled = !event.target.value.trim();
  }
});
// On a phone the on-screen keyboard should not push the bottom menu over a text field.
document.addEventListener('focusin', event => { if (event.target.matches?.('textarea, input:not([type=checkbox]):not([type=radio])')) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches?.('textarea, input')) document.body.classList.remove('typing'); }, 50));
// Two layouts: re-draw when the window crosses the computer width (split panels vs. separate screens).
matchMedia('(min-width:1024px)').addEventListener?.('change', () => { if (bootstrapped && !document.activeElement?.matches?.('textarea, input')) render(); });
function selectLesson(id) {
  history.replaceState(null, '', '#lessons?id=' + id);
  document.querySelectorAll('#lesson-results .lesson-row').forEach(row => { const on = Number(row.dataset.id) === id; row.classList.toggle('is-selected', on); if (on) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current'); });
  const panel = document.querySelector('[data-learn="lesson-panel"]'); if (panel) { panel.dataset.id = String(id); panel.innerHTML = lessonPanel(id); }
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
  const data = await sendApi('/api/session'); session = data; protection.refresh(); track('app_open');
  if (data.practice?.unlimited) practiceBlocked.clear();
  if (!config.preview) { progress.done = data.done || []; progress.last = Math.min(24, (progress.done.at(-1) || 0) + 1); }
  await Promise.all([loadMarks(), loadFavorites()]);
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
