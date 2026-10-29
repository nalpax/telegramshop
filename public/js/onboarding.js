// First visit: two questions and a tip where to start. Shown once after subscribing; answers are kept on the server
// (/api/onboarding) and visible to the owner in the participant card. The tip never sends a free user to a paid lesson.
import { icon } from './icons.js';

export const GOALS = [['own', 'Сделать сайт для себя или своего дела'], ['earn', 'Начать зарабатывать на сайтах'], ['learn', 'Просто разобраться, интересно']];
export const EXPERIENCE = [['none', 'Никогда не делал(а) сайты'], ['tried', 'Немного пробовал(а) с ИИ'], ['pro', 'Уже делаю сайты, хочу быстрее']];
const QUESTIONS = [['goal', 'Что для вас главное?', GOALS], ['experience', 'Есть ли опыт?', EXPERIENCE]];

export function startTip({ goal, experience } = {}) {
  const start = experience === 'tried' ? { lesson: 3, text: 'Уроки 01–02 про установку и рабочее место можно пролистать. Начните с 03 — там главное: как поставить задачу модели. Для разминки попробуйте «Конструктор промпта» в «Практикуме».' }
    : experience === 'pro' ? { lesson: 5, text: 'Основы вам знакомы: быстро пролистайте 01–04 и начните с 05 — проверка и публикация, там собраны частые ошибки.' }
    : { lesson: 1, text: 'Начните с урока 01: какие инструменты нужны и как всё устроено. По одному уроку в день — нормальный темп.' };
  const extra = goal === 'earn' ? ' Для заработка самое важное — модули 3 и 4: портфолио, поиск клиентов, оценка и сдача проекта. Посчитать первый заказ поможет калькулятор оценки в «Практикуме».'
    : goal === 'own' ? ' Для своего сайта хватит модулей 1–2: от первой страницы до формы заявки и своего домена.'
    : goal === 'learn' ? ' Если встретится незнакомое слово — нажмите на него: откроется объяснение из «Терминов».' : '';
  return { lesson: start.lesson, text: start.text + extra };
}

// step: 0 or 1 — a question; 2 — the tip.
export function onboardingScreen(step, answers, lessonTitle) {
  if (step >= QUESTIONS.length) {
    const tip = startTip(answers);
    return `<main class="onboarding"><span class="eyebrow">С ЧЕГО НАЧАТЬ</span><h1>Ваш первый шаг<span>.</span></h1><div class="onb-tip">${icon('target')}<p>${tip.text}</p></div><button class="button button-primary" data-action="onb-start" data-id="${tip.lesson}">Открыть урок ${String(tip.lesson).padStart(2, '0')}${lessonTitle ? ` · ${lessonTitle(tip.lesson)}` : ''}${icon('arrow')}</button><button class="button button-secondary" data-action="onb-home">На главную</button></main>`;
  }
  const [key, title, options] = QUESTIONS[step];
  return `<main class="onboarding"><div class="p-step"><span>Вопрос ${step + 1} из ${QUESTIONS.length}</span><progress max="${QUESTIONS.length}" value="${step}"></progress></div><h1>${title}</h1><p class="practice-intro">Подскажем, с чего начать. Ответ можно поменять в любой момент — просто пройдите курс в своём порядке.</p><div class="p-answers">${options.map(([id, label]) => `<button class="p-answer ${answers[key] === id ? 'is-right' : ''}" data-action="onb-answer" data-q="${key}" data-id="${id}">${label}</button>`).join('')}</div><button class="text-link onb-skip" data-action="onb-skip">Пропустить</button></main>`;
}
