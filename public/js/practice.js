// «Практикум»: interactive trainers next to the course. Paid: Pro has no limit, a free account gets 3 launches, counted on
// the server (/api/practice), which also sends the quiz and checklist content only for an allowed launch.
// Examples are labelled as educational. Progress inside a trainer is a per-device convenience (localStorage).
import { icon } from './icons.js';
import { escape as e } from './state.js';

const KEY = 'vibentry.practice.v1';
let QUIZ = []; let HANDOVER = [];
export function setPracticeData(data = {}) { if (data.quiz) QUIZ = data.quiz; if (data.handover) HANDOVER = data.handover; }
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = state => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
const update = (id, patch) => { const state = load(); state[id] = { ...state[id], ...patch }; save(state); };

export const trainers = [
  { id: 'builder', title: 'Конструктор промпта', description: 'Ответьте на вопросы — получите готовый запрос для первой страницы', minutes: '5 мин', glyph: 'sparkle' },
  { id: 'quiz', title: 'Найдите слабое место', description: 'Семь учебных промптов: что в каждом мешает получить хороший результат', minutes: '7 мин', glyph: 'target' },
  { id: 'estimate', title: 'Калькулятор оценки', description: 'Задачи, часы и запас — сумма и текст для предложения клиенту', minutes: '10 мин', glyph: 'clock' },
  { id: 'handover', title: 'Проверка перед сдачей', description: 'Пройдите сайт по списку, прежде чем отправить ссылку клиенту', minutes: '15 мин', glyph: 'check' },
];

const TIPS = [
  ['target', 'На своём проекте', 'Конструктор и калькулятор работают с вашими ответами: в итоге получается текст под вашу задачу, а не общий пример.'],
  ['copy', 'Сразу в работу', 'Готовый промпт и текст для предложения клиенту копируются одной кнопкой.'],
  ['check', 'Отметка о прохождении', 'Пройденные тренажёры отмечаются галочкой на этом устройстве, чтобы было видно, что осталось.'],
];
// limits: { unlimited, limit, remaining } from the server (session.practice).
export function practiceList(limits) {
  const state = load(); const free = limits && !limits.unlimited; const out = free && limits.remaining <= 0;
  const banner = !free ? '' : `<button class="practice-limit ${out ? 'is-out' : ''}" data-action="access">${icon(out ? 'lock' : 'sparkle')}<span><strong>${out ? 'Бесплатные запуски закончились' : `Бесплатно: осталось ${limits.remaining} из ${limits.limit} запусков`}</strong><small>С полным доступом «Практикум» без ограничений</small></span>${icon('arrow')}</button>`;
  return `<header class="page-header"><div><h1>Практикум</h1><p>Тренажёры, чтобы закрепить навык на деле</p></div></header>
  <p class="practice-intro">Это не уроки курса, а инструменты: соберите промпт, проверьте себя, посчитайте проект.</p>${banner}
  <div class="practice-grid">${trainers.map(t => `<a class="practice-card ${out ? 'is-locked' : ''}" href="#practice?id=${t.id}"><span class="practice-glyph">${icon(t.glyph)}</span><span class="practice-info"><strong>${t.title}</strong><small>${t.description}</small><span class="practice-meta">${t.minutes}${state[t.id]?.done ? ` · ${icon('check')}пройдено` : ''}</span></span>${icon(out ? 'lock' : 'chevron')}</a>`).join('')}</div>
  <section class="practice-tips" aria-label="Как устроен Практикум">${TIPS.map(([glyph, title, text]) => `<div class="practice-tip">${icon(glyph)}<strong>${title}</strong><p>${text}</p></div>`).join('')}</section>`;
}
// Shown instead of a trainer when a free account has used its launches.
export function practicePaywall(id, price) {
  const t = trainers.find(x => x.id === id);
  return `<header class="reader-header"><a href="#practice" class="back-link">${icon('back')}Практикум</a></header><section class="practice-panel practice-paywall"><span class="practice-glyph">${icon('lock')}</span><h2>${t ? e(t.title) : 'Практикум'}</h2><p>Бесплатные запуски «Практикума» закончились. С тарифом «Полный доступ» тренажёры открыты без ограничений — вместе со всеми уроками, промптами и базой.</p><div class="after-price">${price ? `<strong>${e(price)}</strong><span>один раз · доступ навсегда · без подписки</span>` : ''}</div><button class="button button-primary" data-action="access">${price ? `Оплатить ${e(price)}` : 'Подробнее о полном доступе'}${icon('arrow')}</button></section>`;
}

// ---------- 1. Prompt builder ----------
const SITE_TYPES = [['card', 'Сайт-визитка специалиста', 'сайт-визитку специалиста'], ['service', 'Лендинг одной услуги', 'лендинг одной услуги'], ['local', 'Сайт небольшого местного бизнеса', 'сайт небольшого местного бизнеса'], ['portfolio', 'Портфолио', 'сайт-портфолио']];
const GOALS = [['lead', 'оставить заявку через форму'], ['call', 'позвонить или написать в мессенджер'], ['booking', 'записаться на удобное время'], ['view', 'посмотреть работы и связаться']];
const BLOCKS = [['hero', 'Первый экран: кто вы и что предлагаете'], ['services', 'Услуги или направления'], ['prices', 'Цены или «от …»'], ['steps', 'Как проходит работа, по шагам'], ['works', 'Примеры работ'], ['faq', 'Частые вопросы'], ['contacts', 'Контакты и карта']];
const STYLES = [['calm', 'спокойный, светлый, много воздуха'], ['bold', 'яркий, крупная типографика, контрастный'], ['strict', 'строгий, деловой, сдержанные цвета']];
export function builderPrompt(v) {
  const type = SITE_TYPES.find(([id]) => id === v.type)?.[2] || 'сайт';
  const goal = GOALS.find(([id]) => id === v.goal)?.[1];
  const blocks = BLOCKS.filter(([id]) => v.blocks?.includes(id)).map(([, label]) => label);
  const style = STYLES.find(([id]) => id === v.style)?.[1];
  return [
    `Ты — опытный веб-разработчик. Сделай ${type} — одну страницу.`,
    v.about ? `О проекте: ${v.about.trim()}.` : 'О проекте: [чем вы или заказчик занимаетесь].',
    v.audience ? `Для кого: ${v.audience.trim()}.` : 'Для кого: [кто ваши клиенты и что им важно].',
    goal ? `Главная цель страницы: посетитель должен ${goal}. Кнопка с этим действием видна на первом экране.` : 'Главная цель страницы: [какое одно действие должен сделать посетитель].',
    blocks.length ? `Блоки по порядку:\n${blocks.map((b, i) => `${i + 1}. ${b}`).join('\n')}` : 'Блоки по порядку: [перечислите блоки].',
    style ? `Стиль: ${style}.` : 'Стиль: [какое впечатление должна оставлять страница].',
    'Тексты пиши на русском, обращайся к посетителю на «вы». Где данных нет, ставь понятные заглушки в [квадратных скобках], ничего не выдумывай: ни отзывов, ни цифр.',
    'Технически: один файл index.html со встроенными стилями, без фреймворков. Страница аккуратно выглядит на телефоне от 320 px и на компьютере. Все кнопки и ссылки работают.',
    'Сначала коротко перечисли, что сделаешь, потом пришли код целиком.',
  ].join('\n\n');
}
function builderChecks(v) {
  return [['О проекте', !!v.about?.trim()], ['Аудитория', !!v.audience?.trim()], ['Цель', !!v.goal], ['Блоки (3+)', (v.blocks?.length || 0) >= 3], ['Стиль', !!v.style]];
}
function builderView() {
  const v = load().builder?.values || { type: 'card', blocks: ['hero', 'services', 'contacts'] };
  const radios = (name, list) => list.map(([id, label]) => `<label class="p-option"><input type="radio" name="${name}" value="${id}" ${v[name] === id ? 'checked' : ''}><span>${label}</span></label>`).join('');
  return `<section class="practice-panel" id="builder"><h2>Конструктор промпта</h2><p class="practice-intro">Заполните поля — промпт ниже соберётся сам. Чем точнее ответы, тем меньше правок потом.</p>
  <fieldset><legend>Что за сайт</legend>${radios('type', SITE_TYPES)}</fieldset>
  <label class="p-field">Чем вы или заказчик занимаетесь<input name="about" maxlength="200" value="${e(v.about || '')}" placeholder="Например: [мастер маникюра в своём районе]"></label>
  <label class="p-field">Для кого сайт<input name="audience" maxlength="200" value="${e(v.audience || '')}" placeholder="Например: [жители района, которым важно рядом и без очереди]"></label>
  <fieldset><legend>Что должен сделать посетитель</legend>${radios('goal', GOALS)}</fieldset>
  <fieldset><legend>Какие блоки нужны</legend>${BLOCKS.map(([id, label]) => `<label class="p-option"><input type="checkbox" name="blocks" value="${id}" ${v.blocks?.includes(id) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>
  <fieldset><legend>Какой стиль</legend>${radios('style', STYLES)}</fieldset>
  <div class="p-result"><div class="p-checks" id="builder-checks"></div><pre id="builder-out"></pre><button class="button button-primary" data-p="copy-builder">Копировать промпт${icon('copy')}</button></div></section>`;
}
function readBuilder(root) {
  const form = root.querySelector('#builder'); const value = name => form.querySelector(`[name=${name}]:checked`)?.value || '';
  return { type: value('type'), goal: value('goal'), style: value('style'), about: form.querySelector('[name=about]').value, audience: form.querySelector('[name=audience]').value, blocks: [...form.querySelectorAll('[name=blocks]:checked')].map(x => x.value) };
}
function paintBuilder(root) {
  const v = readBuilder(root); const checks = builderChecks(v); const ready = checks.filter(([, ok]) => ok).length;
  root.querySelector('#builder-out').textContent = builderPrompt(v);
  root.querySelector('#builder-checks').innerHTML = `<strong>Готовность: ${ready} из ${checks.length}</strong>${checks.map(([label, ok]) => `<span class="${ok ? 'is-ok' : ''}">${icon(ok ? 'check' : 'close')}${label}</span>`).join('')}`;
  update('builder', { values: v, ...(ready === checks.length ? { done: true } : {}) });
}

// ---------- 2. Quiz ----------
function quizView() {
  const s = load().quiz || {}; const i = Math.min(s.index || 0, QUIZ.length);
  if (i >= QUIZ.length) return `<section class="practice-panel"><h2>Найдите слабое место</h2><div class="p-score"><strong>${s.score || 0} из ${QUIZ.length}</strong><p>${(s.score || 0) >= 6 ? 'Отлично: вы видите, что мешает модели понять задачу.' : 'Хороший повод вернуться к урокам 03 и 06 — там разобрано, из чего состоит понятная задача.'}</p></div><button class="button button-secondary" data-p="quiz-restart">Пройти ещё раз</button></section>`;
  const q = QUIZ[i]; const answered = s.answered === i;
  return `<section class="practice-panel"><div class="p-step"><span>Вопрос ${i + 1} из ${QUIZ.length}</span><progress max="${QUIZ.length}" value="${i}"></progress></div><h2>Что не так с этим промптом?</h2><p class="p-label">Учебный пример</p><blockquote class="p-prompt">${e(q.prompt)}</blockquote>
  <div class="p-answers">${q.options.map((text, k) => `<button class="p-answer ${answered ? (k === q.right ? 'is-right' : k === s.choice ? 'is-wrong' : '') : ''}" data-p="quiz-answer" data-k="${k}" ${answered ? 'disabled' : ''}>${e(text)}</button>`).join('')}</div>
  ${answered ? `<div class="p-why ${s.choice === q.right ? 'is-right' : ''}"><strong>${s.choice === q.right ? 'Верно.' : 'Не совсем.'}</strong> ${e(q.why)}</div><button class="button button-primary" data-p="quiz-next">${i + 1 < QUIZ.length ? 'Следующий вопрос' : 'Результат'}${icon('arrow')}</button>` : ''}</section>`;
}

// ---------- 3. Estimate ----------
const DEFAULT_TASKS = [['Бриф и согласование структуры', 2], ['Первая версия страницы', 4], ['Тексты и изображения от заказчика', 1], ['Адаптивность и проверка на телефонах', 2], ['Форма заявки и проверка доставки', 1], ['Публикация и домен', 1], ['Правки (один круг)', 2]];
function estimateView() {
  const s = load().estimate || {}; const tasks = s.tasks || DEFAULT_TASKS;
  return `<section class="practice-panel" id="estimate"><h2>Калькулятор оценки</h2><p class="practice-intro">Разбейте проект на задачи и оцените часы. Ставку указываете вы — у каждого она своя.</p>
  <div class="p-tasks">${tasks.map(([name, hours], i) => `<div class="p-task"><input name="task" maxlength="80" value="${e(name)}" aria-label="Задача ${i + 1}"><input name="hours" type="number" inputmode="decimal" min="0" max="200" step="0.5" value="${e(hours)}" aria-label="Часы на задачу ${i + 1}"><button class="p-remove" data-p="task-remove" data-i="${i}" aria-label="Убрать задачу">${icon('close')}</button></div>`).join('')}</div>
  <button class="button button-secondary" data-p="task-add">Добавить задачу</button>
  <div class="p-row"><label class="p-field">Ваша ставка, ₽ в час<input name="rate" type="number" inputmode="numeric" min="0" step="50" value="${e(s.rate || '')}" placeholder="Укажите свою"></label><label class="p-field">Запас на непредвиденное, %<input name="reserve" type="number" inputmode="numeric" min="0" max="100" step="5" value="${e(s.reserve ?? 20)}"></label></div>
  <div class="p-result" id="estimate-out"></div></section>`;
}
function readEstimate(root) {
  const form = root.querySelector('#estimate');
  const names = [...form.querySelectorAll('[name=task]')].map(x => x.value); const hours = [...form.querySelectorAll('[name=hours]')].map(x => Math.max(0, Number(x.value) || 0));
  return { tasks: names.map((name, i) => [name, hours[i]]), rate: Math.max(0, Number(form.querySelector('[name=rate]').value) || 0), reserve: Math.min(100, Math.max(0, Number(form.querySelector('[name=reserve]').value) || 0)) };
}
const fmt = n => Math.round(n).toLocaleString('ru-RU');
const hrs = n => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
export function estimateText(v) {
  const hours = v.tasks.reduce((sum, [, h]) => sum + h, 0); const withReserve = hours * (1 + v.reserve / 100);
  return { hours, withReserve, price: withReserve * v.rate, text: ['Оценка работ', ...v.tasks.filter(([n, h]) => n.trim() && h > 0).map(([n, h]) => `— ${n.trim()}: ${hrs(h)} ч`), `Итого: ${hrs(hours)} ч + запас ${v.reserve}% = ${hrs(withReserve)} ч`, ...(v.rate ? [`Стоимость: ${fmt(withReserve * v.rate)} ₽`] : []), 'В оценку входит один круг правок. Дополнительные правки — по отдельной договорённости.'].join('\n') };
}
function paintEstimate(root) {
  const v = readEstimate(root); const r = estimateText(v);
  root.querySelector('#estimate-out').innerHTML = `<div class="p-total"><span>${hrs(r.hours)} ч работы · с запасом ${hrs(r.withReserve)} ч</span><strong>${v.rate ? fmt(r.price) + ' ₽' : 'Укажите ставку'}</strong></div><pre>${e(r.text)}</pre><button class="button button-primary" data-p="copy-estimate">Копировать для предложения${icon('copy')}</button>`;
  update('estimate', { tasks: v.tasks, rate: v.rate || '', reserve: v.reserve, ...(v.rate && r.hours ? { done: true } : {}) });
}

// ---------- 4. Handover checklist ----------
function handoverView() {
  const done = new Set(load().handover?.checked || []); let n = 0; const total = HANDOVER.reduce((s, [, items]) => s + items.length, 0);
  return `<section class="practice-panel" id="handover"><h2>Проверка перед сдачей</h2><p class="practice-intro">Пройдите сайт по пунктам. Всё, что не отмечено, — повод проверить ещё раз, прежде чем отправлять ссылку.</p><div class="p-step"><span id="handover-count">${done.size} из ${total}</span><progress id="handover-bar" max="${total}" value="${done.size}"></progress></div>
  ${HANDOVER.map(([group, items]) => `<fieldset><legend>${group}</legend>${items.map(item => { const k = n++; return `<label class="p-option p-check"><input type="checkbox" name="handover" value="${k}" ${done.has(k) ? 'checked' : ''}><span>${item}</span></label>`; }).join('')}</fieldset>`).join('')}
  <div class="p-why is-right is-hidden" id="handover-done"><strong>Готово к сдаче.</strong> Отправьте заказчику ссылку и короткую инструкцию.</div></section>`;
}
function paintHandover(root) {
  const checked = [...root.querySelectorAll('[name=handover]:checked')].map(x => Number(x.value)); const total = root.querySelectorAll('[name=handover]').length;
  root.querySelector('#handover-count').textContent = `${checked.length} из ${total}`; root.querySelector('#handover-bar').value = checked.length;
  root.querySelector('#handover-done').classList.toggle('is-hidden', checked.length !== total);
  update('handover', { checked, ...(checked.length === total ? { done: true } : {}) });
}

// ---------- screen + events ----------
const VIEWS = { builder: builderView, quiz: quizView, estimate: estimateView, handover: handoverView };
export function practiceScreen(id) {
  const t = trainers.find(x => x.id === id);
  if (!t) return practiceList();
  const body = VIEWS[id]();
  return `<header class="reader-header"><a href="#practice" class="back-link">${icon('back')}Практикум</a></header><div class="practice-root" data-trainer="${id}">${body}</div>`;
}
export function mountPractice(app, { copy }) {
  const root = app.querySelector('.practice-root'); if (!root) return;
  const id = root.dataset.trainer;
  const paint = { builder: paintBuilder, estimate: paintEstimate, handover: paintHandover }[id];
  if (paint) { paint(root); root.addEventListener('input', () => paint(root)); root.addEventListener('change', () => paint(root)); }
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-p]'); if (!button) return;
    const action = button.dataset.p; const rerender = () => { root.innerHTML = VIEWS[id](); if (paint) paint(root); };
    if (action === 'copy-builder') { copy(builderPrompt(readBuilder(root))); update('builder', { done: true }); }
    if (action === 'copy-estimate') copy(estimateText(readEstimate(root)).text);
    if (action === 'task-add') { const v = readEstimate(root); update('estimate', { ...v, tasks: [...v.tasks, ['', 1]] }); rerender(); root.querySelectorAll('[name=task]').forEach((x, i, all) => { if (i === all.length - 1) x.focus(); }); }
    if (action === 'task-remove') { const v = readEstimate(root); v.tasks.splice(Number(button.dataset.i), 1); update('estimate', v); rerender(); }
    if (action === 'quiz-answer') { const s = load().quiz || {}; const i = s.index || 0; const k = Number(button.dataset.k); update('quiz', { answered: i, choice: k, score: (s.score || 0) + (k === QUIZ[i].right ? 1 : 0) }); rerender(); }
    if (action === 'quiz-next') { const s = load().quiz || {}; const next = (s.index || 0) + 1; update('quiz', { index: next, answered: -1, ...(next >= QUIZ.length ? { done: true } : {}) }); rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (action === 'quiz-restart') { update('quiz', { index: 0, answered: -1, score: 0 }); rerender(); }
  });
}
