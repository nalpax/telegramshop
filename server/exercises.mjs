// Lesson exercises and the learning project (handoff/LEARNING_MAP_RU.md). Server only: the right answers, option notes
// and checking rules never reach the public files. The app gets an exercise without answers (publicExercise) and
// the explanation only after it sends an answer (checkAnswer).
// Checks are rule-based (explainable signs from the lesson), not an AI evaluation, and the app says so.
// Bump `version` when an exercise changes: saved results keep the version they were made with.

const norm = text => String(text || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');

export const EXERCISES = [
  {
    id: 'task-prompt', version: 1, lesson: 3, stage: 'structure', type: 'improve',
    title: 'Задача для агента', skill: 'Поставить задачу так, чтобы агент не гадал',
    situation: 'Вы готовите первую задачу для агента: учебная страница репетитора. Черновик получился таким.',
    task: 'Допишите запрос: что нужно сделать, для кого, какие блоки и как вы примете результат.',
    starter: 'Сделай красивый сайт для репетитора.',
    checks: [
      { id: 'goal', label: 'Понятно, что создать', miss: 'Назовите результат: какую страницу или сайт сделать и где он появится.', any: [/(созда|сдела|собер|сверста|подготов)/], all: [/(страниц|сайт|лендинг|index\.html)/] },
      { id: 'audience', label: 'Понятна аудитория', miss: 'Скажите, для кого сайт: кто его откроет и что ему нужно.', any: [/для кого|аудитор|посетител|ученик|родител|школьник|студент|взросл|клиент/] },
      { id: 'blocks', label: 'Перечислены блоки', miss: 'Перечислите блоки страницы, например: шапка, первый экран, форматы занятий, контакт.', count: [3, /шапк|первый экран|формат|заняти|услуг|цен|контакт|обо мне|подпис|меню|блок/g] },
      { id: 'result', label: 'Понятно, как принять работу', miss: 'Опишите ожидаемый результат: попросите сначала план, перечислить файлы или объяснить, как проверить.', any: [/план|провер|файл|перечисл|открыва|готов|результат|(^|[^а-я])ок([^а-я]|$)/] },
    ],
    bonus: { label: 'Есть ограничения', hit: 'Ограничения тоже есть: агенту понятно, чего не делать.', miss: 'Совет: добавьте ограничения, например «не добавляй отзывы и формы, не выдумывай факты».', any: [/не (добавля|выдумыва|придумыва|использ)|без (react|npm|форм|отзыв|сборк)|запрещ/] },
  },
  {
    id: 'page-blocks', version: 1, lesson: 3, stage: 'structure', type: 'order',
    title: 'Блоки страницы', skill: 'Собрать первую страницу из нужных блоков',
    situation: 'Учебная страница репетитора из урока 03. Нужно выбрать блоки и расставить их сверху вниз.',
    task: 'Добавьте в страницу нужные блоки и поставьте их по порядку. Лишнее оставьте в стороне.',
    pool: [
      ['header', 'Шапка с названием'], ['reviews', 'Отзывы довольных учеников'], ['hero', 'Первый экран: кто вы и чем помогаете'],
      ['formats', 'Три формата занятий'], ['payment', 'Форма оплаты'], ['contact', 'Контакт (#contact)'],
      ['account', 'Личный кабинет'], ['note', 'Подпись «Учебный проект Vibentry»'],
    ],
  },
  {
    id: 'style-contrast', version: 1, lesson: 7, stage: 'design', type: 'choice',
    title: 'Карточка стиля', skill: 'Проверить контраст до того, как красить весь сайт',
    situation: 'Учебный пример. Карточка стиля для сайта репетитора: фон #FFFFFF, основной текст #C8C8C8, акцент для кнопок #2E7D32. Шрифты: Playfair Display для заголовков, Inter для текста. Радиус скругления 8 px.',
    task: 'Что в этой карточке помешает людям читать сайт?',
    items: [{
      q: 'Главная проблема карточки', right: 1,
      options: [
        ['Два разных шрифта', 'Два шрифта — нормально: один для заголовков, один для текста. Так и советует урок 07.'],
        ['Светло-серый текст #C8C8C8 на белом фоне', ''],
        ['Радиус 8 px слишком маленький', 'Радиус — дело вкуса, на чтение он не влияет.'],
      ],
      why: 'Контраст #C8C8C8 на белом — примерно 1,7 к 1, а для обычного текста WCAG требует не ниже 4,5 к 1. На телефоне на улице такой текст почти не виден. Возьмите текст темнее, например #2B2B2B, и проверьте пару в сервисе контраста.',
    }],
  },
  {
    id: 'mobile-fix', version: 1, lesson: 9, stage: 'design', type: 'choice',
    title: 'Правка по скриншоту', skill: 'Попросить точную правку мобильной версии',
    situation: 'Учебный пример. На телефоне шириной 375 px таблица с ценами шире экрана: страницу приходится двигать вбок. Остальной сайт в порядке.',
    task: 'Какой запрос агенту лучше отправить вместе со скриншотом?',
    items: [{
      q: 'Запрос агенту', right: 2,
      options: [
        ['«Сделай сайт адаптивным»', 'Слишком общо: агент не знает, что именно сломано, и может переделать лишнее.'],
        ['«Перепиши весь сайт под телефон»', 'Ради одной таблицы агент перепишет всё и может сломать то, что работало.'],
        ['«Вот скриншот с телефона: таблица цен уезжает за край. Исправь это и ничего больше не меняй. Скажи, какие файлы изменились.»', ''],
      ],
      why: 'Хороший запрос называет конкретную проблему, ограничивает правку и просит отчёт о файлах. После правки проверьте не только таблицу, но и соседние блоки (урок 09).',
    }],
  },
  {
    id: 'content-facts', version: 1, lesson: 8, stage: 'content', type: 'choice',
    title: 'Текст «Обо мне»', skill: 'Заметить выдуманные факты',
    situation: 'Учебный пример. Факты от клиента: «Преподаю английский 3 года, готовлю к ОГЭ и ЕГЭ, занятия онлайн». Модель вернула: «Анна — репетитор с 12-летним опытом. Более 300 учеников сдали ЕГЭ на 90+. «Лучший преподаватель!» — Мария, 17 лет».',
    task: 'Что не так с этим текстом?',
    items: [{
      q: 'Проблема текста', right: 0,
      options: [
        ['Модель добавила стаж, число учеников и отзыв, которых клиент не сообщал', ''],
        ['Текст слишком короткий для блока «Обо мне»', 'Длина здесь не главное: даже короткий текст не должен обманывать посетителя.'],
        ['Нужно добавить ещё пару отзывов, чтобы было убедительнее', 'Отзывов клиент не присылал. Выдуманный отзыв — это обман посетителей.'],
      ],
      why: 'Все факты на сайте должны приходить от клиента. Модель умеет красиво переписать, но не знает, что правда. В запросе прямо запрещайте добавлять цифры, награды и отзывы (урок 08).',
    }],
  },
  {
    id: 'about-prompt', version: 1, lesson: 8, stage: 'content', type: 'improve',
    title: 'Запрос на текст без выдумок', skill: 'Попросить модель переписать текст только по фактам',
    situation: 'Клиент прислал несколько фактов о себе. Вы просите модель сделать из них блок «Обо мне».',
    task: 'Допишите запрос так, чтобы модель не добавила лишнего и уточнила, если фактов мало.',
    starter: 'Перепиши текст «Обо мне» красиво.',
    checks: [
      { id: 'facts', label: 'Только факты клиента', miss: 'Скажите, на что опираться: «используй только факты из моего текста».', any: [/только (факт|из|мои|то, что)|из моего текста|исходн|факты (ниже|клиента|из)/] },
      { id: 'ban', label: 'Запрет добавлять лишнее', miss: 'Запретите добавлять цифры, награды, отзывы и факты, которых нет.', any: [/не (добавля|выдумыва|придумыва|дописыва)|ничего (не|лишнего)|запрещ/] },
      { id: 'ask', label: 'Просьба уточнить', miss: 'Попросите задать вопрос, если чего-то не хватает, вместо догадок.', any: [/вопрос|спроси|уточни|переспроси/] },
    ],
    bonus: { label: 'Задан формат', hit: 'Формат тоже задан: модели понятно, какой длины и каким языком писать.', miss: 'Совет: задайте формат, например «живым понятным языком, в два абзаца».', any: [/абзац|предложени|коротк|живым|понятн|просты|до \d+/] },
  },
  {
    id: 'launch-check', version: 1, lesson: 12, stage: 'publish', type: 'checklist',
    title: 'Проверка перед запуском', skill: 'Пройти сайт глазами посетителя',
    situation: 'Откройте публичный адрес учебного сайта в приватном окне, потом на телефоне. Пройдите по списку из урока 12.',
    task: 'Отметьте каждый пункт: «готово», «исправить» или «не используется». Это ваша проверка — приложение сайт не проверяет.',
    items: [
      ['open', 'Главная и внутренние страницы открываются напрямую, после обновления нет 404'],
      ['links', 'Меню, кнопки, почта и контакты ведут по согласованным адресам'],
      ['form', 'Тестовая заявка пришла получателю, все поля на месте'],
      ['errors', 'Пустая форма и неверная почта обрабатываются, ошибка сети не показывает успех'],
      ['mobile', 'На телефоне нет горизонтальной прокрутки, текст читается, кнопки удобно нажимать'],
      ['access', 'Контраст проверен, у картинок есть описания, тяжёлые файлы сжаты'],
      ['facts', 'Нет выдуманных фактов, чужих отзывов, случайных контактов и заглушек'],
      ['meta', 'У страницы есть название и описание, на основном домене работает HTTPS'],
      ['secrets', 'В публичных файлах и истории нет секретов и лишних материалов'],
      ['backup', 'Есть резервная копия, владелец знает, где размещён сайт и что продлевать'],
    ],
  },
  {
    id: 'edit-or-task', version: 1, lesson: 22, stage: null, type: 'choice',
    title: 'Правка или новая задача', skill: 'Отличать правку от нового объёма',
    situation: 'Сайт сдан, клиент присылает три просьбы. Разберите каждую по правилу урока 22.',
    task: 'Для каждой просьбы выберите: это правка или новая задача?',
    items: [
      { q: 'Поменять заголовок первого экрана', right: 0, options: [['Правка', ''], ['Новая задача', 'Заголовок уже был согласован — изменить его значит сделать правку.']], why: 'Правка — изменить то, что уже согласовано: заголовок, цвет, порядок блоков.' },
      { q: 'Добавить страницу «Цены», которой не было в брифе', right: 1, options: [['Правка', 'Этого не было в первоначальном списке, это новый объём.'], ['Новая задача', '']], why: 'Новая страница — новый объём. Его оценивают отдельно: «Этого не было в первоначальном списке, предлагаю оценить отдельно».' },
      { q: 'Форма заявки не отправляет письма, хотя вы её сделали и сдали', right: 0, options: [['Правка', ''], ['Новая задача', 'Это ваша ошибка в согласованной функции: её нельзя выдавать за новую платную задачу.']], why: 'Ошибку в том, что вы делали, исправляют бесплатно и не списывают на круг правок.' },
    ],
  },
];

export const STAGES = [
  { id: 'structure', title: 'Структура', short: 'Каркас страницы: какие блоки нужны и в каком порядке.', task: 'Составьте задачу для агента и соберите блоки первой страницы учебного сайта.', lessons: [3, 6], exercises: ['task-prompt', 'page-blocks'] },
  { id: 'design', title: 'Дизайн', short: 'Палитра, шрифты и первый экран, которые читаются на любом экране.', task: 'Соберите карточку стиля по уроку 07 и проверьте сайт на телефоне по уроку 09.', lessons: [7, 9], exercises: ['style-contrast', 'mobile-fix'] },
  { id: 'content', title: 'Контент', short: 'Тексты и изображения без выдуманных фактов, с понятными источниками.', task: 'Наполните сайт фактами клиента и картинками с понятной лицензией.', lessons: [8], exercises: ['content-facts', 'about-prompt'] },
  { id: 'publish', title: 'Публикация', short: 'Сайт по публичной ссылке, проверенный глазами посетителя.', task: 'Опубликуйте сайт и пройдите проверку перед запуском.', lessons: [5, 11, 12], exercises: ['launch-check'] },
];

export const exerciseById = id => EXERCISES.find(x => x.id === id) || null;

// What the app may see before answering: no right answers, no option notes, no checking rules.
export function publicExercise(x) {
  const base = { id: x.id, version: x.version, lesson: x.lesson, stage: x.stage, type: x.type, title: x.title, skill: x.skill, situation: x.situation, task: x.task };
  if (x.type === 'improve') return { ...base, starter: x.starter, maxLength: 3000, criteria: x.checks.map(c => c.label) };
  if (x.type === 'order') return { ...base, pool: x.pool.map(([id, label]) => ({ id, label })) };
  if (x.type === 'choice') return { ...base, items: x.items.map(i => ({ q: i.q, options: i.options.map(([label]) => label) })) };
  if (x.type === 'checklist') return { ...base, items: x.items.map(([id, label]) => ({ id, label })), marks: [['done', 'Готово'], ['fix', 'Исправить'], ['na', 'Не используется']] };
  return base;
}
// Short card for lists and the project screen: always safe to show, even without access.
export const exerciseCard = x => ({ id: x.id, title: x.title, skill: x.skill, lesson: x.lesson, stage: x.stage, type: x.type, version: x.version });

const invalid = message => Object.assign(new Error(message), { status: 400 });
const matchAny = (text, list = []) => list.some(re => re.test(text));

// Returns { passed, summary, feedback: [{ ok, text }], items? }. Throws { status: 400 } for a malformed answer.
export function checkAnswer(x, answer) {
  if (!answer || typeof answer !== 'object') throw invalid('No answer');
  if (x.type === 'improve') {
    const raw = String(answer.text ?? '');
    if (raw.length > 3000) throw invalid('Too long');
    const text = norm(raw);
    if (text.trim().length < 20 || text.trim() === norm(x.starter)) return { passed: false, summary: 'Запрос пока не изменён. Допишите его по подсказкам ниже.', feedback: x.checks.map(c => ({ ok: false, label: c.label, text: c.miss })) };
    const feedback = x.checks.map(c => {
      const ok = (c.any ? matchAny(text, c.any) : true) && (c.all ? c.all.every(re => re.test(text)) : true) && (c.count ? (text.match(c.count[1]) || []).length >= c.count[0] : true);
      return { ok, label: c.label, text: ok ? '' : c.miss };
    });
    const bonus = matchAny(text, x.bonus.any);
    feedback.push({ ok: bonus, label: x.bonus.label, text: bonus ? x.bonus.hit : x.bonus.miss, optional: true });
    const passed = feedback.filter(f => !f.optional).every(f => f.ok);
    return { passed, summary: passed ? 'Запрос закрывает все пункты из урока. Его можно отправлять агенту.' : 'Уже лучше. Допишите то, что отмечено ниже, и проверьте ещё раз.', feedback };
  }
  if (x.type === 'order') {
    const ids = answer.blocks;
    const known = new Set(x.pool.map(([id]) => id));
    if (!Array.isArray(ids) || ids.length > known.size || ids.some(id => !known.has(id)) || new Set(ids).size !== ids.length) throw invalid('Unknown blocks');
    const at = id => ids.indexOf(id); const has = id => at(id) >= 0;
    const label = id => x.pool.find(([k]) => k === id)[1];
    const rules = [
      ...['header', 'hero', 'formats', 'contact'].map(id => ({ ok: has(id), text: has(id) ? `«${label(id)}» на месте.` : `Не хватает блока «${label(id)}» — он есть в задаче урока 03.` })),
      ...['reviews', 'payment', 'account'].filter(has).map(id => ({ ok: false, text: `«${label(id)}» уберите: урок 03 прямо запрещает отзывы, оплату и личный кабинет в этой странице.` })),
    ];
    if (has('header') && at('header') !== 0) rules.push({ ok: false, text: 'Шапку ставят первой: в ней название и меню.' });
    if (has('hero') && has('formats') && at('hero') > at('formats')) rules.push({ ok: false, text: 'Первый экран должен идти раньше форматов: сначала человек понимает, кто вы, потом выбирает формат.' });
    if (has('hero') && has('contact') && at('contact') < at('hero')) rules.push({ ok: false, text: 'Контакт поставьте после первого экрана: кнопки ведут к нему вниз.' });
    if (has('note') && at('note') !== ids.length - 1) rules.push({ ok: false, text: 'Подпись «Учебный проект Vibentry» обычно ставят в самый низ.' });
    const passed = rules.every(r => r.ok);
    return { passed, summary: passed ? 'Структура подходит. Порядок форматов и контакта может отличаться — это нормально, главное, что каждый блок на своём месте.' : 'Почти. Поправьте отмеченное и проверьте ещё раз.', feedback: rules };
  }
  if (x.type === 'choice') {
    const picks = answer.picks;
    if (!Array.isArray(picks) || picks.length !== x.items.length || picks.some((p, i) => !Number.isInteger(p) || p < 0 || p >= x.items[i].options.length)) throw invalid('Bad picks');
    const items = x.items.map((item, i) => { const ok = picks[i] === item.right; return { ok, text: ok ? item.why : item.options[picks[i]][1] || 'Не совсем. Перечитайте ситуацию и попробуйте ещё раз.' }; });
    const passed = items.every(i => i.ok);
    return { passed, summary: passed ? 'Верно.' : x.items.length > 1 ? `Верно ${items.filter(i => i.ok).length} из ${x.items.length}. Посмотрите подсказки и попробуйте ещё раз.` : 'Не совсем. Посмотрите подсказку и попробуйте ещё раз.', feedback: items };
  }
  if (x.type === 'checklist') {
    const marks = answer.marks;
    if (!marks || typeof marks !== 'object' || Array.isArray(marks)) throw invalid('Bad marks');
    const values = x.items.map(([id]) => marks[id]);
    if (values.some(v => v !== undefined && !['done', 'fix', 'na'].includes(v))) throw invalid('Bad mark');
    const missing = x.items.filter(([id]) => !marks[id]); const fix = x.items.filter(([id]) => marks[id] === 'fix');
    const passed = !missing.length && !fix.length;
    const feedback = [...missing.map(([, label]) => ({ ok: false, text: `Не отмечено: ${label}` })), ...fix.map(([, label]) => ({ ok: false, text: `Исправить: ${label}` }))];
    return { passed, summary: passed ? 'Все пункты отмечены. Это ваша отметка после ручной проверки: приложение сайт не проверяло.' : missing.length ? 'Отметьте все пункты. Если пункт к сайту не относится, выберите «не используется».' : `Осталось исправить: ${fix.length}. Исправьте, проверьте ещё раз и обновите отметки.`, feedback };
  }
  throw invalid('Unknown type');
}

// Only the fields an answer of this type has: nothing else from the request is stored.
export function cleanAnswer(x, answer) {
  if (x.type === 'improve') return { text: String(answer.text ?? '').slice(0, 3000) };
  if (x.type === 'order') return { blocks: answer.blocks };
  if (x.type === 'choice') return { picks: answer.picks };
  if (x.type === 'checklist') return { marks: Object.fromEntries(x.items.filter(([id]) => answer.marks[id]).map(([id]) => [id, answer.marks[id]])) };
  return {};
}
// Stage status from real data: lessons done + exercises passed. Viewing a stage never counts.
export function projectState({ done = [], results = new Map(), canOpen = () => true }) {
  const stages = STAGES.map(stage => {
    const lessons = stage.lessons.map(id => ({ id, done: done.includes(id), open: canOpen(id) }));
    const exercises = stage.exercises.map(id => { const x = exerciseById(id); const r = results.get(id); return { ...exerciseCard(x), passed: !!r?.passed, attempts: r?.attempts || 0, open: canOpen(x.lesson) }; });
    const total = lessons.length + exercises.length; const ready = lessons.filter(l => l.done).length + exercises.filter(x => x.passed).length;
    return { id: stage.id, title: stage.title, short: stage.short, task: stage.task, lessons, exercises, ready, total, done: ready === total };
  });
  const current = stages.findIndex(s => !s.done);
  return { version: 1, stages, completed: stages.filter(s => s.done).length, current: current === -1 ? stages.length - 1 : current };
}
