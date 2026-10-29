// Learning project and lesson exercises in the app (server: server/exercises.mjs, map: handoff/LEARNING_MAP_RU.md).
// Pure render helpers: app.js owns the state, the API calls and the events. Nothing here knows the right answers:
// exercises arrive without them and the breakdown comes back from the server after an answer.
import { icon } from './icons.js';
import { escape as e } from './state.js';

// ---- milky volumetric graphics (inline SVG, no image downloads) ----
let uid = 0;
const MILK = ['#fffaf0', '#e8dfc5', '#b9b08f'];
function grad(id) { return `<linearGradient id="${id}" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="${MILK[0]}"/><stop offset=".5" stop-color="${MILK[1]}"/><stop offset="1" stop-color="${MILK[2]}"/></linearGradient>`; }
// A shape drawn twice: a darker «side» shifted down-right, then the lit face. Gives the ceramic volume of the mockups.
function solid(d, id, depth = 5) { return `<path d="${d}" fill="#8f8a6c" transform="translate(${depth * 0.6} ${depth})"/><path d="${d}" fill="url(#${id})" stroke="#fff8e6" stroke-width="1"/>`; }
const ART = {
  braces: id => `${solid('M44 16c-14 0-18 7-18 19v9c0 7-3 11-11 12 8 1 11 5 11 12v8c0 13 4 20 18 20v-11c-5 0-7-3-7-10v-9c0-6-2-9-8-11 6-2 8-5 8-11v-9c0-7 2-9 7-9z', id)}${solid('M70 16c14 0 18 7 18 19v9c0 7 3 11 11 12-8 1-11 5-11 12v8c0 13-4 20-18 20v-11c5 0 7-3 7-10v-9c0-6 2-9 8-11-6-2-8-5-8-11v-9c0-7-2-9-7-9z', id)}`,
  brief: id => `${solid('M26 14h44l18 18v66H26z', id)}<path d="M70 14v18h18" fill="#cfc5a4"/><path d="M36 44h40M36 54h40M36 64h28M36 74h34" stroke="#5f7a52" stroke-width="3" stroke-linecap="round"/>`,
  template: id => `${solid('M18 22h78v70H18z', id)}<path d="M18 34h78" stroke="#a49b7b" stroke-width="2"/><circle cx="25" cy="28" r="2.4" fill="#5f7a52"/><circle cx="32" cy="28" r="2.4" fill="#5f7a52"/><rect x="26" y="42" width="34" height="6" rx="3" fill="#5f7a52"/><rect x="26" y="52" width="24" height="5" rx="2.5" fill="#a49b7b"/><rect x="64" y="42" width="24" height="18" rx="3" fill="#a9c08a"/><rect x="26" y="66" width="18" height="18" rx="3" fill="#cfc5a4"/><rect x="48" y="66" width="18" height="18" rx="3" fill="#cfc5a4"/><rect x="70" y="66" width="18" height="18" rx="3" fill="#cfc5a4"/>`,
  checklist: id => `${solid('M24 14h66v80H24z', id)}${[30, 50, 70].map((y, i) => `<rect x="34" y="${y}" width="12" height="12" rx="3" fill="${i < 2 ? '#5f7a52' : '#fff8e6'}" stroke="#5f7a52" stroke-width="2"/>${i < 2 ? `<path d="M37 ${y + 6}l3 3 5-6" stroke="#fff8e6" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : ''}<path d="M52 ${y + 6}h28" stroke="#a49b7b" stroke-width="3" stroke-linecap="round"/>`).join('')}`,
  folder: id => `${solid('M30 30h26l6 7h30v52H30z', id, 4)}${solid('M22 38h26l6 7h30v52H22z', id, 4)}${solid('M14 46h26l6 7h30v50H14z', id)}`,
  palette: id => `${solid('M58 14C32 14 14 32 14 56s18 42 40 42c8 0 11-4 11-9 0-7-6-9-6-14 0-5 4-8 9-8h11c14 0 23-10 23-24C102 26 82 14 58 14z', id)}<circle cx="38" cy="50" r="7" fill="#5f7a52"/><circle cx="52" cy="32" r="7" fill="#d9f99a"/><circle cx="72" cy="32" r="7" fill="#a9c08a"/><circle cx="86" cy="48" r="6" fill="#cfc5a4"/>`,
  flag: id => `${solid('M30 12h8v88h-8z', id, 3)}${solid('M38 16c18-8 30 8 52 0v38c-22 8-34-8-52 0z', id)}`,
};
export function art3d(kind, extra = '') {
  const id = `milk-${kind}-${++uid}`;
  return `<svg class="art3d ${extra}" viewBox="0 0 112 112" aria-hidden="true" focusable="false"><defs>${grad(id)}</defs><ellipse cx="60" cy="104" rx="40" ry="5" fill="#00110a" opacity=".45"/>${(ART[kind] || ART.template)(id)}</svg>`;
}

// ---- the volumetric site: layered HTML with CSS perspective (style in design.css, «site3d»).
// data-built = stages really completed (0–4): 0 ghost outlines, 1 frame, 2 palette and fonts, 3 texts and pictures,
// 4 assembled and published. data-focus = the stage someone is looking at; it only highlights a layer.
const PIC = {
  mountain: '<svg viewBox="0 0 60 40" aria-hidden="true"><path d="M0 40 18 14l10 12 8-8 24 22z" fill="#5f7a52"/><circle cx="46" cy="10" r="5" fill="#e8dfc5"/></svg>',
  plant: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 34V16M20 22c-6-2-9-7-9-12 6 1 9 5 9 12zm0 4c6-2 9-7 9-12-6 1-9 5-9 12z" stroke="#5f7a52" stroke-width="3" fill="#a9c08a" stroke-linejoin="round"/><path d="M13 34h14l-2 5H15z" fill="#8f8a6c"/></svg>',
  vase: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M15 6h10v5c5 3 7 8 7 13 0 8-5 12-12 12S8 32 8 24c0-5 2-10 7-13z" fill="#8f8a6c"/></svg>',
};
export function site3d(built = 0, focus = '') {
  const card = (pic, n) => `<div class="s3-card s3-card-${n}"><span class="s3-pic">${PIC[pic]}</span><b></b><b class="short"></b></div>`;
  return `<div class="site3d" data-built="${Math.max(0, Math.min(4, built))}" data-focus="${e(focus)}" aria-hidden="true"><div class="s3-glow"></div><div class="s3-stack">
    <div class="s3-plate"></div>
    <div class="s3-layer s3-bar"><i></i><i></i><i></i><span class="s3-url"><em></em></span></div>
    <div class="s3-layer s3-hero"><div class="s3-hero-copy"><b></b><b></b><b class="short"></b><span class="s3-btn"></span></div><span class="s3-pic s3-hero-pic">${PIC.mountain}</span></div>
    <div class="s3-layer s3-cards">${card('mountain', 1)}${card('plant', 2)}${card('vase', 3)}</div>
    <div class="s3-layer s3-foot"><b></b><b></b><b class="short"></b></div>
    <div class="s3-layer s3-palette"><i></i><i></i><i></i><span>Aa</span></div>
    <div class="s3-layer s3-badge">${icon('check')}</div>
  </div><svg class="s3-cursor" viewBox="0 0 40 48"><path d="M4 2l30 26-14 2 8 14-6 3-8-14-10 9z" fill="#f4eedb" stroke="#8f8a6c" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`;
}

// ---- project stages ----
export const STAGE_LAYER = { structure: 'Каркас и основные блоки', design: 'Палитра, шрифты, первый экран', content: 'Тексты и изображения', publish: 'Собранная страница и запуск' };
const pad = n => String(n).padStart(2, '0');
export function stageStepper(project, selected, { compact = false } = {}) {
  const stages = project?.stages || [];
  return `<ol class="stage-steps ${compact ? 'is-compact' : ''}" aria-label="Этапы учебного проекта">${stages.map((s, i) => {
    const state = s.done ? 'is-done' : i === project.current ? 'is-current' : '';
    const label = `${s.title}: ${s.done ? 'завершён' : i === project.current ? 'идёт сейчас' : 'впереди'}`;
    return `<li class="${state} ${selected === s.id ? 'is-selected' : ''}"><button data-action="stage" data-id="${s.id}" aria-pressed="${selected === s.id}" aria-label="${e(label)}"><span class="stage-dot">${s.done ? icon('check') : ''}</span><span class="stage-name">${e(s.title)}</span></button></li>`;
  }).join('')}</ol>`;
}
// The panel a stage opens: what it is, the task, required lessons, criteria and where to go. Never marks anything.
export function stagePanel(stage, { lessonTitle, canOpenLesson }) {
  if (!stage) return '';
  const lessonRows = stage.lessons.map(l => `<li class="${l.done ? 'is-ok' : ''}">${icon(l.done ? 'check' : l.open ? 'book' : 'lock')}<a href="#lesson?id=${l.id}" data-action="lesson" data-id="${l.id}">Урок ${pad(l.id)} · ${e(lessonTitle(l.id))}</a><small>${l.done ? 'пройден' : l.open ? 'не пройден' : 'после покупки'}</small></li>`).join('');
  const exRows = stage.exercises.map(x => `<li class="${x.passed ? 'is-ok' : ''}">${icon(x.passed ? 'check' : x.open ? 'target' : 'lock')}<a href="#practice?ex=${x.id}">${e(x.title)}</a><small>${x.passed ? 'засчитано' : x.attempts ? 'есть попытки' : x.open ? 'не начато' : 'после покупки'}</small></li>`).join('');
  const next = stage.exercises.find(x => !x.passed && x.open) || null;
  const nextLesson = stage.lessons.find(l => !l.done && canOpenLesson(l.id)) || null;
  const action = stage.done ? `<p class="stage-done">${icon('check')}Этап завершён: уроки пройдены, задания засчитаны.</p>`
    : next ? `<a class="button button-primary" href="#practice?ex=${next.id}">Открыть задание «${e(next.title)}»${icon('arrow')}</a>`
    : nextLesson ? `<button class="button button-primary" data-action="lesson" data-id="${nextLesson.id}">Открыть урок ${pad(nextLesson.id)}${icon('arrow')}</button>`
    : `<button class="button button-primary" data-action="access">Открыть полный доступ${icon('lock')}</button>`;
  return `<section class="stage-panel" aria-labelledby="stage-title" aria-live="polite"><div class="stage-panel-top"><span class="eyebrow">Этап · ${stage.ready} из ${stage.total}</span><span class="stage-layer">${e(STAGE_LAYER[stage.id] || '')}</span></div><h2 id="stage-title">${e(stage.title)}</h2><p>${e(stage.short)}</p><div class="stage-task"><strong>Задание</strong><p>${e(stage.task)}</p></div><div class="stage-lists"><div><h3>Уроки</h3><ul class="stage-list">${lessonRows}</ul></div><div><h3>Критерии</h3><ul class="stage-list">${exRows}</ul></div></div>${action}<p class="stage-note">Этап засчитывается сам, когда пройдены уроки и засчитаны задания. Просмотр этапа его не отмечает.</p></section>`;
}

// ---- exercises ----
const TYPE_NAME = { improve: 'Улучшите промпт', order: 'Соберите структуру', choice: 'Найдите ошибку', checklist: 'Проверка перед запуском' };
export const exerciseTypeName = type => TYPE_NAME[type] || 'Задание';
// The answer being edited: a draft from this device, else the saved answer, else the starting state.
export function startAnswer(x, saved, draft) {
  if (draft) return draft;
  if (saved?.answer && !saved.outdated) return saved.answer;
  if (x.type === 'improve') return { text: x.starter || '' };
  if (x.type === 'order') return { blocks: [] };
  if (x.type === 'choice') return { picks: x.items.map(() => null) };
  if (x.type === 'checklist') return { marks: {} };
  return {};
}
export function answerReady(x, a) {
  if (x.type === 'improve') return String(a.text || '').trim().length > 0;
  if (x.type === 'order') return a.blocks.length > 0;
  if (x.type === 'choice') return a.picks.every(p => Number.isInteger(p));
  if (x.type === 'checklist') return x.items.every(i => a.marks[i.id]);
  return false;
}
function body(x, a) {
  if (x.type === 'improve') return `<label class="ex-field"><span>Ваш запрос</span><textarea id="ex-text" rows="7" maxlength="${x.maxLength || 3000}" spellcheck="true">${e(a.text || '')}</textarea></label><div class="ex-criteria"><strong>Что проверим</strong><ul>${x.criteria.map(c => `<li>${e(c)}</li>`).join('')}</ul></div>`;
  if (x.type === 'order') {
    const byId = new Map(x.pool.map(p => [p.id, p]));
    const chosen = a.blocks.map(id => byId.get(id)).filter(Boolean);
    const rest = x.pool.filter(p => !a.blocks.includes(p.id));
    return `<div class="ex-order"><div><strong id="ex-page-title">Страница сверху вниз</strong><ol class="ex-page" aria-labelledby="ex-page-title">${chosen.map((p, i) => `<li><span class="ex-num">${i + 1}</span><span class="ex-label">${e(p.label)}</span><span class="ex-moves"><button data-action="ex-move" data-id="${p.id}" data-dir="-1" aria-label="Выше: ${e(p.label)}" ${i === 0 ? 'disabled' : ''}>↑</button><button data-action="ex-move" data-id="${p.id}" data-dir="1" aria-label="Ниже: ${e(p.label)}" ${i === chosen.length - 1 ? 'disabled' : ''}>↓</button><button data-action="ex-remove" data-id="${p.id}" aria-label="Убрать: ${e(p.label)}">${icon('close')}</button></span></li>`).join('') || '<li class="ex-empty">Пока пусто. Добавьте блоки справа.</li>'}</ol></div><div><strong id="ex-pool-title">Блоки</strong><ul class="ex-pool" aria-labelledby="ex-pool-title">${rest.map(p => `<li><button data-action="ex-add" data-id="${p.id}"><span>${e(p.label)}</span><span class="ex-add">+ Добавить</span></button></li>`).join('') || '<li class="ex-empty">Все блоки на странице.</li>'}</ul></div></div>`;
  }
  if (x.type === 'choice') return x.items.map((item, i) => `<fieldset class="ex-choice"><legend>${x.items.length > 1 ? `${i + 1}. ` : ''}${e(item.q)}</legend><div role="radiogroup" aria-label="${e(item.q)}">${item.options.map((o, j) => `<button class="ex-option ${a.picks[i] === j ? 'is-picked' : ''}" role="radio" aria-checked="${a.picks[i] === j}" data-action="ex-pick" data-item="${i}" data-id="${j}"><span class="ex-radio" aria-hidden="true"></span><span>${e(o)}</span></button>`).join('')}</div></fieldset>`).join('');
  if (x.type === 'checklist') return `<ul class="ex-checks">${x.items.map(item => `<li><span class="ex-check-label">${e(item.label)}</span><span class="ex-marks" role="radiogroup" aria-label="${e(item.label)}">${x.marks.map(([id, label]) => `<button class="ex-mark mark-${id} ${a.marks[item.id] === id ? 'is-picked' : ''}" role="radio" aria-checked="${a.marks[item.id] === id}" data-action="ex-mark" data-item="${item.id}" data-id="${id}">${label}</button>`).join('')}</span></li>`).join('')}</ul>`;
  return '';
}
function resultBlock(x, result) {
  if (!result) return '';
  const rows = (result.feedback || []).map(f => `<li class="${f.ok ? 'is-ok' : f.optional ? 'is-tip' : 'is-miss'}">${icon(f.ok ? 'check' : f.optional ? 'sparkle' : 'close')}<span>${f.label ? `<strong>${e(f.label)}</strong>${f.text ? ' — ' : ''}` : ''}${e(f.text || '')}</span></li>`).join('');
  const note = x.type === 'improve' ? '<p class="ex-note">Проверка по признакам из урока, а не оценка искусственного интеллекта.</p>' : x.type === 'checklist' ? '<p class="ex-note">Это ваша отметка после ручной проверки. Приложение сайт не открывало и не проверяло.</p>' : '';
  return `<div class="ex-result ${result.passed ? 'is-passed' : 'is-retry'}" role="status"><strong>${result.passed ? 'Засчитано' : 'Попробуйте ещё раз'}</strong><p>${e(result.summary || '')}</p>${rows ? `<ul>${rows}</ul>` : ''}${note}</div>`;
}
// state: { answer, result, saved, busy, error }
export function exerciseHtml(x, state, { lessonTitle, compact = false } = {}) {
  const a = state.answer;
  const saved = state.saved;
  const status = saved?.passed ? `<span class="ex-status is-passed">${icon('check')}Засчитано${saved.outdated ? ' · прошлая версия задания' : ''}</span>` : saved?.attempts ? `<span class="ex-status">Попыток: ${saved.attempts}</span>` : '';
  return `<article class="exercise ${compact ? 'is-compact' : ''}" data-ex="${e(x.id)}" aria-labelledby="ex-title-${e(x.id)}"><div class="ex-top"><span class="eyebrow">${e(exerciseTypeName(x.type))} · урок ${pad(x.lesson)}</span>${status}</div><h2 id="ex-title-${e(x.id)}">${e(x.title)}</h2><p class="ex-situation">${e(x.situation)}</p><p class="ex-task"><strong>Задание.</strong> ${e(x.task)}</p>${body(x, a)}${state.error ? `<p class="ex-error" role="alert">${e(state.error)}</p>` : ''}<div class="ex-actions"><button class="button button-primary" data-action="ex-check" data-id="${e(x.id)}" ${state.busy || !answerReady(x, a) ? 'disabled' : ''}>${state.busy ? 'Проверяем…' : state.result ? 'Проверить ещё раз' : 'Проверить'}${icon('check')}</button>${x.type !== 'improve' && (a.blocks?.length || a.picks?.some(p => p !== null) || Object.keys(a.marks || {}).length) ? `<button class="button button-secondary" data-action="ex-reset" data-id="${e(x.id)}">Начать заново</button>` : ''}</div>${resultBlock(x, state.result)}${lessonTitle ? `<a class="ex-lesson" href="#lesson?id=${x.lesson}" data-action="lesson" data-id="${x.lesson}">${icon('book')}Связанный урок ${pad(x.lesson)} · ${e(lessonTitle(x.lesson))}</a>` : ''}</article>`;
}
// Without access: the title, the skill and what is checked — never the content.
export function exerciseLocked(card, { price }) {
  return `<article class="exercise is-locked"><div class="ex-top"><span class="eyebrow">${e(exerciseTypeName(card.type))} · урок ${pad(card.lesson)}</span><span class="ex-status">${icon('lock')}Полный доступ</span></div><h2>${e(card.title)}</h2><p class="ex-situation">${e(card.skill)}</p><p>Задание откроется вместе с уроком ${pad(card.lesson)}.</p><button class="button button-primary" data-action="access">${price ? `Открыть доступ · ${e(price)}` : 'Открыть полный доступ'}${icon('arrow')}</button></article>`;
}
