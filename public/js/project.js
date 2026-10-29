import { icon } from './icons.js';
import { escape as e } from './state.js';

const STAGES = [
  ['Задача и структура', 'Определите цель сайта, аудиторию и порядок блоков.'],
  ['Первая версия', 'Соберите страницу и проверьте тексты и изображения.'],
  ['Проверка', 'Проверьте мобильную версию, кнопки и доставку заявок.'],
  ['Публикация', 'Опубликуйте сайт и сохраните его адрес.'],
];
const key = userId => `vibentry.project.v1.${userId || 'preview'}`;
export function readProject(userId) {
  try { const v = JSON.parse(localStorage.getItem(key(userId))) || {}; return { title: typeof v.title === 'string' ? v.title.slice(0, 100) : '', url: typeof v.url === 'string' ? v.url.slice(0, 300) : '', done: Array.isArray(v.done) ? [...new Set(v.done.filter(n => Number.isInteger(n) && n >= 0 && n < 4))] : [] }; }
  catch { return { title: '', url: '', done: [] }; }
}
export function saveProject(userId, values) { try { localStorage.setItem(key(userId), JSON.stringify(values)); return true; } catch { return false; } }
export function siteDrawing() {
  return `<div class="site-study" aria-hidden="true"><div class="study-toolbar"><i></i><i></i><i></i><span>ваш-проект.site</span></div><div class="study-body"><div class="study-nav"><b>Мой проект.</b><span>О проекте&nbsp;&nbsp; Контакты</span></div><div class="study-hero"><div><b>Хорошая идея.<br>Понятный сайт.</b><span class="study-rule"></span><span class="study-rule short"></span><span class="study-button">Обсудить проект ↗</span></div><div class="study-graphic"><span></span><span></span><span></span></div></div><div class="study-blocks"><span>01 <i></i></span><span>02 <i></i></span><span>03 <i></i></span></div></div></div>`;
}
export function projectSummary(userId) {
  const p = readProject(userId);
  return `<section class="project-summary"><div class="panel-heading"><span class="eyebrow">В ПРАКТИКЕ</span><span class="panel-number">${p.done.length} / 4</span></div><div class="project-heading"><h2>${e(p.title || 'Ваш первый сайт')}</h2><a class="quiet-icon" href="#project" aria-label="Открыть учебный проект">${icon('arrow')}</a></div>${siteDrawing()}<div class="project-milestones">${STAGES.map(([title], i) => `<span class="${p.done.includes(i) ? 'completed' : ''}" title="${e(title)}">${p.done.includes(i) ? icon('check') : String(i + 1).padStart(2, '0')}</span>`).join('')}</div><p class="project-caption">Отметьте этапы, которые уже сделали.</p><a class="underlined-link" href="#project">Открыть проект ${icon('arrow')}</a></section>`;
}
export function projectScreen(userId) {
  const p = readProject(userId);
  let safeUrl = null;
  try { const parsed = new URL(p.url); if (['https:', 'http:'].includes(parsed.protocol)) safeUrl = parsed.href; } catch {}
  return `<header class="page-header"><div><p class="eyebrow">РАБОЧАЯ ТЕТРАДЬ / ПРОЕКТ</p><h1>Один сайт.<br>От начала до ссылки.</h1><p>Здесь — ваши этапы и результат. Выполняйте задания на своём компьютере.</p></div></header><div class="project-workspace"><section class="project-form-panel"><h2>Что вы собираете?</h2><form id="project-form"><label>Название проекта<input name="title" maxlength="100" value="${e(p.title)}" placeholder="Например, сайт фотографа"></label><label>Ссылка на готовый сайт<input name="url" type="url" maxlength="300" value="${e(p.url)}" placeholder="https://"></label><button class="button button-primary" type="submit">Сохранить проект ${icon('check')}</button></form><p class="local-note">Записи проекта хранятся на этом устройстве.</p>${safeUrl ? `<a class="underlined-link" href="${e(safeUrl)}" target="_blank" rel="noopener noreferrer">Открыть сайт ${icon('arrow')}</a>` : ''}</section><section class="project-stage-panel"><div class="panel-heading"><h2>План работы</h2><span class="panel-number">${p.done.length} / 4</span></div>${STAGES.map(([title, text], i) => `<label class="project-step"><input type="checkbox" name="project-stage" value="${i}" ${p.done.includes(i) ? 'checked' : ''}><span><strong>${e(title)}</strong><small>${e(text)}</small></span></label>`).join('')}<a class="underlined-link" href="#practice?id=handover">Проверка перед сдачей ${icon('arrow')}</a></section></div>`;
}
