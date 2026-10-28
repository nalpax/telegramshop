import { icon, art } from './icons.js';
import { modules, lessons, materials } from './course.js';
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
let renderEpoch = 0;
let checked = false;
let search = '';
let toastTimer;
let modalReturnFocus;
const freeCache = new Map();
const urlFor = (tab = 'lessons') => `#materials?tab=${tab}`;

try { tg?.ready(); tg?.expand(); tg?.setHeaderColor('#061b12'); tg?.setBackgroundColor('#061b12'); } catch {}
try { tg?.BackButton.onClick(back); } catch {}

function route() { const [name, params] = (location.hash.slice(1) || 'home').split('?'); return { name, params: new URLSearchParams(params) }; }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function back() { go(readerId ? '#materials?tab=lessons' : '#home'); }
function brand(compact = false) { return `<a href="#home" class="brand ${compact ? 'brand-compact' : ''}" aria-label="Vibentry — главная"><span class="brand-image"><img src="/assets/brand.png" alt="Знак ve. Vibentry" width="64" height="64"></span>${compact ? '' : '<span><strong>Vibentry<span class="brand-dot">.</span></strong><span class="brand-caption">Твоя база по вайбкодингу</span></span>'}</a>`; }
function nav(active) {
  return `<nav class="bottom-nav" aria-label="Основная навигация">${[['home', 'home', 'Главная'], ['materials', 'book', 'Материалы'], ['profile', 'user', 'Профиль']].map(([id, glyph, label]) => `<a href="#${id}" class="nav-item ${active === id ? 'is-active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')}</nav>`;
}
function heading(kicker, title, caption = '') { return `<div class="section-heading"><div><p class="eyebrow">${kicker}</p><h2>${title}</h2></div>${caption ? `<span class="section-meta">${caption}</span>` : ''}</div>`; }
function hero() {
  return `<section class="hero" aria-labelledby="hero-title"><div class="hero-grid" aria-hidden="true"></div><div class="hero-copy"><span class="eyebrow">ПРАКТИЧЕСКИЙ КУРС</span><h1 id="hero-title">От идеи —<br>к своему сайту<span>.</span></h1><p>Учись. Собирай. Запускай.</p></div><img class="hero-art" src="/assets/hero.png" width="220" height="220" alt="" fetchpriority="high"></section>`;
}
function tile(title, subtitle, kind, hash, action = '') { return `<a class="quick-tile tile-${kind}" href="${hash}" ${action ? `data-action="${action}"` : ''}><div><h3>${title}</h3><p>${subtitle}</p></div>${art(kind)}<span class="tile-arrow">${icon('arrow')}</span></a>`; }
function home() {
  const next = lessons[progress.last - 1];
  const freeDone = progress.done.includes(1) && !session?.access?.active;
  return `<header class="home-header">${brand()}<span class="version-label">v.02</span></header>
  ${hero()}
  <section class="continue-card" aria-labelledby="continue-title"><div class="continue-top"><span class="eyebrow">${freeDone ? 'ПЕРВЫЙ УРОК ПРОЙДЕН' : progress.done.length ? 'ТВОЙ СЛЕДУЮЩИЙ ШАГ' : 'НАЧНИ С МАЛЕНЬКОГО'}</span>${icon(freeDone ? 'check' : 'sparkle')}</div><h2 id="continue-title">${freeDone ? 'Продолжим создавать?' : `${String(next.id).padStart(2, '0')} · ${e(next.title)}`}</h2><div class="progress-caption"><span>Пройдено ${progress.done.length} из 24 уроков</span><span>${Math.round(progress.done.length / 24 * 100)}%</span></div><progress max="24" value="${progress.done.length}" aria-label="Прогресс курса"></progress><button class="button button-primary" data-action="${freeDone ? 'access' : 'lesson'}" ${freeDone ? '' : `data-id="${next.id}"`}>${freeDone ? 'Посмотреть полную программу' : progress.done.length ? 'Продолжить урок' : 'Начать бесплатно'}${icon('arrow')}</button></section>
  <section class="quick-section" aria-labelledby="quick-title"><div class="section-heading"><h2 id="quick-title">Быстрый доступ</h2><span class="tiny-label">ВСЁ ПОД РУКОЙ</span></div><div class="quick-grid">${tile('Уроки', '24 урока<br>1 бесплатно', 'book', urlFor())}${tile('Промпты', 'Точные запросы<br>для ИИ', 'prompts', urlFor('prompts'))}${tile('Шаблоны', 'Брифы<br>и чек-листы', 'files', urlFor('templates'))}${tile('Мой доступ', 'Все возможности<br>Vibentry', 'plane', '#access', 'access')}</div></section>
  <p class="home-note">Одна сделанная страница полезнее десяти прочитанных.</p>${nav('home')}`;
}
function lessonRow(lesson) {
  const done = progress.done.includes(lesson.id);
  const active = lesson.id === progress.last && !done && lesson.free;
  return `<button class="lesson-row ${active ? 'lesson-current' : ''} ${done ? 'lesson-done' : ''}" data-action="lesson" data-id="${lesson.id}"><span class="lesson-number">${String(lesson.id).padStart(2, '0')}</span><span class="lesson-info"><strong>${e(lesson.title)}</strong>${active ? '<small>Твой следующий шаг</small>' : done ? '<small>Пройдено</small>' : ''}</span><span class="lesson-status ${done ? 'done-badge' : ''}">${icon(done ? 'check' : lesson.free ? 'chevron' : 'lock')}</span></button>`;
}
function catalogueBody(tab) {
  const query = search.trim().toLocaleLowerCase('ru');
  if (tab === 'lessons') {
    return modules.map(m => {
      const rows = lessons.filter(l => l.module === m.id && (!query || `${l.title} ${l.id}`.toLocaleLowerCase('ru').includes(query)));
      if (!rows.length) return '';
      return `<section class="module-section">${heading(m.range, m.title, m.id === 1 ? '<span class="free-label">Первый урок бесплатно</span>' : `${rows.length} уроков ${icon('lock')}`)}<div class="lesson-list">${rows.map(lessonRow).join('')}</div></section>`;
    }).join('') || emptySearch();
  }
  return `<div class="resource-list">${materials.filter(m => m.type === tab && (!query || `${m.title} ${m.description}`.toLocaleLowerCase('ru').includes(query))).map(m => `<button class="resource-card" data-action="resource" data-id="${m.id}"><span class="resource-symbol">${icon(tab === 'prompts' ? 'copy' : 'file')}</span><span><span class="eyebrow ${m.free ? 'free-label' : ''}">${m.free ? 'ОТКРЫТЫЙ МАТЕРИАЛ' : 'ПОЛНЫЙ ДОСТУП'}</span><strong>${e(m.title)}</strong><small>${e(m.description)}</small></span>${icon(m.free ? 'chevron' : 'lock')}</button>`).join('') || emptySearch()}</div>`;
}
function emptySearch() { return `<div class="empty-state">${icon('search')}<h2>Пока ничего не нашлось</h2><p>Попробуй другое слово или номер урока.</p></div>`; }
function catalogue(params) {
  const tab = ['lessons', 'prompts', 'templates'].includes(params.get('tab')) ? params.get('tab') : 'lessons';
  return `<header class="page-header">${brand(true)}<div><h1>Материалы</h1><p>Всё, что нужно для твоего сайта</p></div></header><div class="catalogue-tools"><nav class="segments" aria-label="Тип материалов">${[['lessons', 'Уроки'], ['prompts', 'Промпты'], ['templates', 'Шаблоны']].map(([id, label]) => `<a href="${urlFor(id)}" class="${tab === id ? 'selected' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav><label class="search-box">${icon('search')}<input type="search" id="material-search" aria-label="Найти материал" placeholder="Найти материал" value="${e(search)}" autocomplete="off"></label></div><div id="catalogue-results">${catalogueBody(tab)}</div><button class="access-banner" data-action="access"><span class="access-icon">${icon('lock')}</span><span><strong>Больше практики — внутри</strong><small>Уроки 02–24 и рабочие шаблоны</small></span>${icon('arrow')}</button>${nav('materials')}`;
}
function errorPanel() { return `<section class="empty-state">${icon('file')}<h2>Урок не загрузился</h2><p>Проверь соединение и попробуй ещё раз.</p><button class="button button-primary" data-action="retry">Повторить ${icon('arrow')}</button></section>`; }
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
      content = await response.json(); freeCache.set(id, content);
    } catch { if (epoch === renderEpoch) app.innerHTML = `<a href="${urlFor()}" class="back-link">${icon('back')}Все уроки</a>${errorPanel()}`; return; }
  }
  if (epoch !== renderEpoch) return;
  app.innerHTML = `<header class="reader-header"><a href="${urlFor()}" class="back-link">${icon('back')}Все уроки</a>${brand(true)}</header><article class="lesson-article"><div class="reader-meta"><span class="eyebrow">УРОК ${String(id).padStart(2, '0')} / 24</span><span class="free-label">${meta.free ? 'Бесплатно' : 'Полный доступ'}</span></div><h1>${e(meta.title)}</h1><div class="outcome">${icon('target')}<p><span>РЕЗУЛЬТАТ УРОКА</span>${e(content.outcome)}</p></div><div class="article-body">${content.sections.map(section => `<section>${section.title ? `<h2>${e(section.title)}</h2>` : ''}${section.paragraphs?.map(p => `<p>${e(p)}</p>`).join('') || ''}${section.list ? `<ol>${section.list.map(p => `<li>${e(p)}</li>`).join('')}</ol>` : ''}${section.code ? `<div class="code-panel"><div class="code-toolbar"><span>ПРОМПТ</span><button data-action="copy-section" data-index="${content.sections.indexOf(section)}">${icon('copy')}<span>Копировать</span></button></div><pre><code>${e(section.code)}</code></pre></div>` : ''}</section>`).join('')}</div><section class="practice"><span class="eyebrow">СДЕЛАЙ СЕЙЧАС</span><h2>Попробуй на своём проекте</h2><p>${e(content.task)}</p><label class="task-check"><input type="checkbox" id="task-done" ${checked ? 'checked' : ''}><span class="check-visual">${icon('check')}</span><span>${e(content.confirmation)}</span></label></section><button class="button button-primary finish-button" data-action="finish" ${checked ? '' : 'disabled'}>${progress.done.includes(id) ? 'К следующему шагу' : 'Завершить урок'}${icon('arrow')}</button><p class="reader-footnote">${id < 24 ? `Далее: ${e(lessons[id].title)}` : 'Ты прошёл весь курс. Пора применить знания!'}</p></article>`;
}
function profile() {
  const name = session?.user?.first_name || 'Твой профиль';
  const initials = session?.user?.first_name ? e(session.user.first_name[0]) : 've.';
  return `<header class="page-header">${brand(true)}<div><h1>Твой прогресс</h1><p>Маленькие шаги. Настоящие проекты.</p></div></header><section class="profile-card"><div class="profile-avatar">${initials}</div><h2>${e(name)}</h2><span class="profile-label">${session?.access?.active ? 'Полный доступ' : 'Бесплатный доступ · урок 01'}</span><div class="profile-stats"><div><strong>${progress.done.length}<span>/24</span></strong><small>Уроков пройдено</small></div><div><strong>${Math.round(progress.done.length / 24 * 100)}<span>%</span></strong><small>Твоего маршрута</small></div></div><progress max="24" value="${progress.done.length}" aria-label="Пройдено уроков"></progress><p class="storage-note">${config.preview ? 'Демо: прогресс сохраняется на этом устройстве.' : 'Прогресс привязан к твоему Telegram.'}</p></section><button class="access-banner" data-action="access"><span class="access-icon">${icon('sparkle')}</span><span><strong>Открой весь Vibentry</strong><small>23 следующих урока и шаблоны</small></span>${icon('arrow')}</button><section class="profile-links"><button data-action="support">${icon('chat')}Написать автору${icon('chevron')}</button><button data-action="community">${icon('lock')}Условия доступа${icon('chevron')}</button><button data-action="about">${icon('book')}О курсе${icon('chevron')}</button><button data-action="reset">${icon('back')}Начать заново${icon('chevron')}</button></section>${sessionError ? '<p class="storage-note">Не удалось подтвердить вход через Telegram. Открой приложение заново из бота.</p>' : ''}<div class="profile-signature">${brand(true)}<span>Сначала одна маленькая страница.<br>Остальное потом.</span></div>${session?.isAdmin ? '<a class="button button-secondary admin-entry" href="#admin">Управление ценой и акциями</a>' : ''}${nav('profile')}`;
}
function render() {
  const epoch = ++renderEpoch;
  if (!bootstrapped) { app.innerHTML = '<div class="loading" role="status">Открываем Vibentry<span></span></div>'; return; }
  if (!config.preview && (!tg?.initData || sessionError)) { app.innerHTML = authScreen(); return; }
  if ((config.preview && !previewEntered) || (!config.preview && !session?.subscribed)) { app.innerHTML = gateScreen(); return; }
  const { name, params } = route();
  readerId = 0;
  document.body.classList.toggle('reading', name === 'lesson');
  app.classList.toggle('reader-shell', name === 'lesson');
  closeModal(false);
  if (name === 'lesson') { try { tg?.BackButton.show(); } catch {} reader(Number(params.get('id')), epoch); }
  else { try { tg?.BackButton.hide(); } catch {} app.innerHTML = name === 'materials' ? catalogue(params) : name === 'profile' ? profile() : name === 'admin' ? adminScreen() : home(); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function toast(message) { const box = document.querySelector('#toast'); box.textContent = message; box.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => box.classList.remove('visible'), 3000); }
function safeExternal(url) { const parsed = new URL(url); if (parsed.protocol !== 'https:') return; try { if (parsed.hostname === 't.me' && tg?.openTelegramLink) tg.openTelegramLink(url); else if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener,noreferrer'); } catch { toast('Не удалось открыть ссылку. Попробуй ещё раз.'); } }
function support() { safeExternal(`https://t.me/${config.supportUsername || 'nalpax'}`); }
function modal(title, body) {
  modalReturnFocus = document.activeElement;
  overlay.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-grab" aria-hidden="true"></div><button class="modal-close" aria-label="Закрыть окно" data-action="close">${icon('close')}</button>${brand(true)}<h2 id="modal-title">${title}</h2>${body}</section></div>`;
  document.body.classList.add('modal-open');
  overlay.querySelector('.modal-close').focus();
}
function closeModal(restore = true) { const had = !!overlay.innerHTML; overlay.innerHTML = ''; document.body.classList.remove('modal-open'); if (had && restore && modalReturnFocus?.isConnected) modalReturnFocus.focus(); }
function openAccess() {
  const active = session?.access?.active;
  modal(active ? 'Твой доступ открыт' : 'Весь Vibentry. В одном месте.', `<p>${active ? 'Все уроки и материалы курса доступны тебе в приложении.' : 'От первой страницы до портфолио, клиентов и сдачи проекта. Продолжи свой маршрут.'}</p><div class="access-benefits">${['Все 24 урока курса', 'Промпты, брифы и рабочие шаблоны', 'Прогресс в твоём Telegram'].map(t => `<div>${icon('check')}<span>${t}</span></div>`).join('')}</div>${active ? `<p>${session.access.expiresAt ? 'Оплачен до ' + new Date(session.access.expiresAt * 1000).toLocaleDateString('ru-RU') : 'Разовая покупка · без ограничения срока'}</p><a class="button button-primary" href="#materials">К урокам${icon('arrow')}</a>` : `<div class="price-block">${config.discountPercent ? `<del>${e(config.regularPriceStars)} ★</del><span class="sale-badge">−${e(config.discountPercent)}%</span>` : ''}<strong>${config.priceStars ? e(config.priceStars) + ' ★' : 'Скоро'}</strong><span>разовая покупка</span></div><p class="billing-note">Один платёж навсегда. Доступ привязан к твоему аккаунту Telegram и не передаётся другому пользователю.</p><button class="button button-primary" data-action="pay" ${config.paymentsEnabled && !config.preview ? '' : 'disabled'}>${config.paymentsEnabled && !config.preview ? 'Оплатить ' + e(config.priceStars) + ' ★' : 'Покупка пока недоступна'}${icon('arrow')}</button><p class="modal-note">Оплата через Telegram Stars. Курс не гарантирует заказы и доход.</p>`}<button class="text-link support-link" data-action="support">Вопросы об оплате</button>`);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано. Подстрой под свой проект.'); }
  catch { modal('Скопируй текст', `<p>Выдели текст и скопируй его вручную.</p><textarea class="copy-fallback" readonly aria-label="Текст для копирования">${e(text)}</textarea>`); overlay.querySelector('textarea').select(); }
}
async function openResource(id) {
  const m = materials.find(m => m.id === id);
  if (!m || !session?.access?.active) return openAccess();
  if (!['notes', 'first-prompt', 'mobile-prompt'].includes(id)) { go('#lesson?id=' + m.lesson); return; }
  try {
    const response = await fetch('/api/resources/' + encodeURIComponent(id), { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
    if (!response.ok) throw new Error();
    const { text } = await response.json();
    modal(e(m.title), `<p>${e(m.description)}</p><div class="template-preview"><pre>${e(text)}</pre></div><button class="button button-primary" id="resource-copy">Копировать${icon('copy')}</button><a class="text-link" href="#lesson?id=${m.lesson}">Открыть урок ${m.lesson}${icon('arrow')}</a>`);
    overlay.querySelector('#resource-copy').onclick = () => copy(text);
  } catch { toast('Материал недоступен. Проверь свой доступ и соединение.'); }
}
document.addEventListener('click', event => {
  if (event.target.classList.contains('modal-backdrop')) return closeModal();
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  const action = target.dataset.action;
  if (action === 'lesson') { const lesson = lessons.find(l => l.id === Number(target.dataset.id)); if (!lesson || (!lesson.free && !session?.access?.active)) return openAccess(); go(`#lesson?id=${lesson.id}`); }
  if (action === 'access') openAccess();
  if (action === 'check-subscription') checkSubscription(target);
  if (action === 'preview') { previewEntered = true; render(); }
  if (action === 'pay') pay(target);
  if (action === 'save-offer') saveOffer(target);
  if (action === 'support') support();
  if (action === 'community') openAccess();
  if (action === 'close') closeModal();
  if (action === 'retry') render();
  if (action === 'reauth') { sessionError = false; initialize(); }
  if (action === 'resource') openResource(target.dataset.id);
  if (action === 'copy-section') { const section = freeCache.get(readerId)?.sections[Number(target.dataset.index)]; if (section?.code) copy(section.code); }
  if (action === 'finish' && readerId && checked) { finishLesson(); return; }
  if (action === 'about') modal('Сначала одна маленькая страница.', '<p>Vibentry — практический учебник вайбкодера от @nalpax. 24 урока: от первого запроса до сайта, который можно показать людям.</p><p>Первый урок открыт после подписки на канал. Дальше — полноценные сайты, портфолио, клиенты, цена и сдача проектов.</p><p class="modal-note">Учебник v0.2. Курс не гарантирует заказы и доход.</p>');
  if (action === 'reset') modal('Начать с чистого листа?', '<p>Отметки о пройденных уроках на этом устройстве будут удалены.</p><button class="button button-primary" data-action="confirm-reset">Сбросить прогресс</button><button class="button button-secondary" data-action="close">Сохранить прогресс</button>');
  if (action === 'confirm-reset') resetAllProgress(target);
});
document.addEventListener('change', event => { if (event.target.id === 'task-done') { checked = event.target.checked; app.querySelector('.finish-button').disabled = !checked; } });
document.addEventListener('input', event => { if (event.target.id === 'material-search') { search = event.target.value; document.querySelector('#catalogue-results').innerHTML = catalogueBody(route().params.get('tab') || 'lessons'); } });
document.addEventListener('keydown', event => {
  if (!overlay.innerHTML) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') { const focusable = [...overlay.querySelectorAll('button, a, textarea, input')].filter(el => !el.disabled); const first = focusable[0]; const last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
});
window.addEventListener('hashchange', render);
render();
function gateScreen() {
  return `<header class="home-header">${brand()}</header><main class="welcome-screen"><div class="welcome-art"><img src="/assets/hero.png" alt="" width="230" height="230"></div><span class="eyebrow">ТВОЙ ПЕРВЫЙ ШАГ</span><h1>Большие проекты<br>начинаются с малого<span>.</span></h1><p>Подпишись на канал Vibentry, чтобы открыть приложение и забрать первый урок бесплатно.</p><div class="welcome-steps"><div><span>01</span><p>Подпишись на канал</p>${icon('send')}</div><div><span>02</span><p>Вернись и проверь подписку</p>${icon('check')}</div><div><span>03</span><p>Открой бесплатный урок</p>${icon('book')}</div></div>${config.requiredChannelUrl ? `<a class="button button-primary" href="${e(config.requiredChannelUrl)}" target="_blank" rel="noopener noreferrer">Подписаться на канал${icon('arrow')}</a>` : '<button class="button button-primary" disabled>Канал скоро появится</button>'}<button class="button button-secondary" data-action="check-subscription">Проверить подписку${icon('check')}</button><p class="welcome-note">Первый урок — бесплатно.<br>Полный курс оплачивается внутри приложения.</p>${config.preview ? '<button class="preview-link" data-action="preview">Посмотреть дизайн в демо-режиме →</button>' : ''}</main>`;
}
function authScreen() {
  return `<header class="home-header">${brand()}</header><main class="welcome-screen"><div class="welcome-art"><img src="/assets/hero.png" alt="" width="230" height="230"></div><h1>Открой Vibentry<br>в Telegram</h1><p>Для проверки подписки, оплаты и сохранения прогресса нужен вход через бота.</p><button class="button button-primary" data-action="reauth">Проверить вход ещё раз${icon('arrow')}</button><button class="button button-secondary" data-action="support">Связаться с автором</button></main>`;
}
async function sendApi(endpoint, data = {}) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, initData: tg?.initData || '' }) });
  if (!response.ok) { const error = new Error('Request failed'); error.status = response.status; throw error; }
  return response.json();
}
async function refreshSession() {
  const data = await sendApi('/api/session'); session = data;
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
  if (config.preview) return toast('В демо подписка не проверяется. Нажми «Посмотреть дизайн».');
  button.disabled = true; button.textContent = 'Проверяем…';
  try { await refreshSession(); if (session.subscribed) { render(); toast('Подписка подтверждена. Первый урок открыт!'); } else toast('Подписка пока не найдена. Подпишись и проверь ещё раз.'); }
  catch { toast('Не удалось проверить подписку. Попробуй чуть позже.'); }
  finally { if (button.isConnected) { button.disabled = false; button.innerHTML = `Проверить подписку${icon('check')}`; } }
}
async function finishLesson() {
  const id = readerId; const button = document.querySelector('.finish-button'); button.disabled = true;
  try {
    if (!config.preview) await sendApi('/api/progress', { lessonId: id }); complete(id);
    try { tg?.HapticFeedback.notificationOccurred('success'); } catch {}
    if (id < 24 && session?.access?.active) { go('#lesson?id=' + (id + 1)); toast('Ещё один шаг. Отличная работа!'); }
    else { go('#home'); toast(id === 1 ? 'Первый урок пройден. Дальше — больше!' : 'Отличная работа!'); }
  } catch { toast('Не удалось сохранить прогресс. Проверь соединение.'); if (button.isConnected) button.disabled = false; }
}
async function pay(button) {
  if (!config.paymentsEnabled || config.preview) return;
  if (!tg?.openInvoice) return toast('Открой приложение в Telegram для оплаты.');
  button.disabled = true; button.textContent = 'Открываем оплату…';
  try {
    const invoice = await sendApi('/api/invoice');
    tg.openInvoice(invoice.url, async status => {
      if (status !== 'paid') { if (button.isConnected) { button.disabled = false; button.textContent = 'Оплатить ' + config.priceStars + ' ★'; } if (status === 'failed') toast('Оплата не прошла. Попробуй ещё раз.'); return; }
      // The client callback is NOT authorization. Only successful_payment grants access.
      for (let i = 0; i < 6; i++) {
        try { await refreshSession(); if (session?.access?.active) { closeModal(); render(); toast('Оплата подтверждена. Все уроки открыты!'); return; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      closeModal(); toast('Платёж обрабатывается. Обнови приложение через минуту.');
    });
  } catch { toast('Счёт пока недоступен. Попробуй позже или напиши автору.'); if (button.isConnected) { button.disabled = false; button.textContent = 'Повторить оплату'; } }
}
function adminScreen() {
  if (!session?.isAdmin) return `<div class="empty-state"><h1>Доступ ограничен</h1><p>Этот раздел доступен только владельцу проекта.</p><a class="button button-secondary" href="#profile">В профиль</a></div>${nav('profile')}`;
  return `<header class="reader-header"><a href="#profile" class="back-link">${icon('back')}В профиль</a>${brand(true)}</header><section class="admin-panel"><span class="eyebrow">УПРАВЛЕНИЕ VIBENTRY</span><h1>Цена и акции</h1><p>Одна покупка. Полный доступ навсегда.</p><form id="offer-form"><label>Обычная цена в Stars<input type="number" name="priceStars" min="1" max="999999" step="1" required value="${e(config.regularPriceStars || '')}" placeholder="Например, 500"></label><label>Скидка, %<input type="number" name="discountPercent" min="0" max="90" step="1" required value="${e(config.discountPercent || 0)}"></label><label>Окончание акции<input type="datetime-local" name="saleEndsAt" value="${config.saleEndsAt ? new Date(new Date(config.saleEndsAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16) : ''}"></label><p class="form-hint">Дата — в часовом поясе твоего устройства. Без даты скидка действует, пока ты её не отключишь.</p><button type="button" class="button button-primary" data-action="save-offer">Сохранить цену${icon('check')}</button></form><p class="admin-note">Цена изменится для новых счетов. Уже выставленные счета действуют до часа. Действующие покупки остаются у владельцев.</p></section>${nav('profile')}`;
}
async function saveOffer(button) {
  const form = document.querySelector('#offer-form'); if (!form.reportValidity()) return;
  const formData = new FormData(form); const date = formData.get('saleEndsAt');
  button.disabled = true;
  try {
    const data = await sendApi('/api/admin/offer', { priceStars: Number(formData.get('priceStars')), discountPercent: Number(formData.get('discountPercent')), saleEndsAt: date ? new Date(date).toISOString() : null });
    Object.assign(config, data.current);
    const response = await fetch('/api/config');
    if (response.ok) Object.assign(config, await response.json());
    toast('Цена и акция сохранены.');
  } catch { toast('Не удалось сохранить. Проверь цену, скидку и дату.'); }
  finally { button.disabled = false; }
}
initialize();

async function resetAllProgress(button) {
  button.disabled = true;
  try { if (!config.preview) await sendApi('/api/progress', { reset: true }); resetProgress(); closeModal(); render(); toast('Можно начинать заново.'); }
  catch { toast('Не удалось сбросить прогресс. Попробуй ещё раз.'); button.disabled = false; }
}
