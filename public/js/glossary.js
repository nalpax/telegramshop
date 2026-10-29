// «Термины»: plain explanations for beginners. Public on purpose (no paid course text). In lessons and articles the first
// mention of a term becomes a tap target that shows its explanation (linkTerms below).
// `forms` is a regular expression source for the word forms to find in texts; boundaries are added by termRegex().
export const GROUPS = [
  ['ai', 'ИИ и промпты'], ['code', 'Код и сайт'], ['git', 'Git и GitHub'], ['publish', 'Публикация'], ['design', 'Дизайн'], ['client', 'Работа с клиентом'],
];
export const TERMS = [
  { id: 'prompt', group: 'ai', title: 'Промпт', forms: 'промпт\\p{L}{0,3}', text: 'Текст задачи для нейросети: что сделать, для кого, с какими ограничениями. Чем точнее промпт, тем меньше правок потом.' },
  { id: 'model', group: 'ai', title: 'Модель (нейросеть)', forms: 'нейросет\\p{L}{0,3}|модел[ьиейюя]\\p{L}{0,2}', text: 'Программа, которая понимает текст и отвечает на него: ChatGPT, Claude и другие. Модель не видит ваш компьютер, пока вы сами не покажете ей файлы или код.' },
  { id: 'agent', group: 'ai', title: 'ИИ-агент', forms: '(?:ИИ-)?агент\\p{L}{0,3}', text: 'Модель, которой дали инструменты: она может сама открывать файлы проекта, менять код и запускать команды. Работает быстрее чата, но требует проверки после каждой правки.' },
  { id: 'context', group: 'ai', title: 'Контекст', forms: 'контекст\\p{L}{0,3}', text: 'Всё, что модель «помнит» в текущей переписке: ваши сообщения, файлы, ответы. Слишком длинная переписка путает модель — тогда помогает новый чат с коротким пересказом.' },
  { id: 'html', group: 'code', title: 'HTML', forms: 'HTML', text: 'Язык разметки, из которого состоит страница: заголовки, абзацы, кнопки, картинки. Это «скелет» сайта.' },
  { id: 'css', group: 'code', title: 'CSS', forms: 'CSS', text: 'Язык оформления: цвета, шрифты, отступы, расположение блоков. Это «одежда» сайта поверх HTML.' },
  { id: 'js', group: 'code', title: 'JavaScript', forms: 'JavaScript|JS', text: 'Язык, который оживляет страницу: открывает меню, проверяет форму, отправляет заявку.' },
  { id: 'index', group: 'code', title: 'index.html', forms: 'index\\.html', text: 'Главный файл сайта. Когда человек открывает адрес сайта, браузер сначала загружает именно его.' },
  { id: 'editor', group: 'code', title: 'Редактор кода', forms: 'редактор\\p{L}{0,3} кода|VS Code|Visual Studio Code|Cursor', text: 'Программа для работы с файлами проекта: VS Code, Cursor и похожие. В ней удобно смотреть код, а агент может править файлы прямо там.' },
  { id: 'devtools', group: 'code', title: 'Инструменты разработчика', forms: 'инструмент\\p{L}{0,3} разработчика|DevTools|консол[ьи]\\p{L}{0,2}', text: 'Панель в браузере (обычно клавиша F12). Во вкладке Console видны ошибки страницы — их текст полезно копировать модели.' },
  { id: 'responsive', group: 'code', title: 'Адаптивность', forms: 'адаптивн\\p{L}{0,5}', text: 'Умение страницы аккуратно выглядеть на любом экране: от телефона шириной 320 px до большого монитора.' },
  { id: 'layout', group: 'code', title: 'Вёрстка', forms: 'в[её]рстк\\p{L}{0,2}|сверста\\p{L}{0,4}', text: 'Превращение макета в настоящую страницу на HTML и CSS.' },
  { id: 'frontend', group: 'code', title: 'Фронтенд', forms: 'фронтенд\\p{L}{0,3}|frontend', text: 'То, что работает в браузере у посетителя: страница, кнопки, анимации.' },
  { id: 'backend', group: 'code', title: 'Бэкенд (сервер)', forms: 'бэкенд\\p{L}{0,3}|backend', text: 'Часть сайта, которая работает на сервере: хранит данные, принимает заявки, проверяет оплату. Посетитель её не видит.' },
  { id: 'api', group: 'code', title: 'API', forms: 'API', text: 'Способ, которым программы общаются друг с другом. Например, сайт отправляет заявку в Telegram через API бота.' },
  { id: 'token', group: 'code', title: 'Токен (ключ API)', forms: 'токен\\p{L}{0,3}|ключ\\p{L}{0,2} API|API-ключ\\p{L}{0,2}', text: 'Секретная строка, которая даёт доступ к сервису. Как пароль: не публикуйте его в коде и не отправляйте в чат с моделью.' },
  { id: 'library', group: 'code', title: 'Библиотека', forms: 'библиотек\\p{L}{0,3}', text: 'Готовый чужой код, который подключают, чтобы не писать всё с нуля: например, для слайдера или карты.' },
  { id: 'framework', group: 'code', title: 'Фреймворк', forms: 'фреймворк\\p{L}{0,3}', text: 'Большой набор готовых правил и инструментов для сайта (React, Next.js и другие). Для простой страницы чаще всего не нужен.' },
  { id: 'database', group: 'code', title: 'База данных', forms: 'баз[аеуыо]\\p{L}{0,2} данных', text: 'Место, где сайт хранит записи: заявки, пользователей, заказы. Простому сайту-визитке обычно не нужна.' },
  { id: 'readme', group: 'code', title: 'README', forms: 'README', text: 'Файл с описанием проекта: что это, как запустить, где что лежит. Полезен и вам через месяц, и заказчику.' },
  { id: 'git', group: 'git', title: 'Git', forms: 'Git', text: 'Программа, которая хранит историю изменений проекта. Можно в любой момент вернуться к рабочей версии.' },
  { id: 'github', group: 'git', title: 'GitHub', forms: 'GitHub\\p{L}{0,2}', text: 'Сайт, где хранятся проекты с историей Git. Через него удобно показывать код и публиковать сайты.' },
  { id: 'repo', group: 'git', title: 'Репозиторий', forms: 'репозитор\\p{L}{0,4}', text: 'Папка проекта вместе со всей историей изменений в Git — у вас на компьютере или на GitHub.' },
  { id: 'commit', group: 'git', title: 'Коммит', forms: 'коммит\\p{L}{0,4}', text: 'Сохранение рабочей версии проекта в Git с коротким описанием: «Блок услуг готов». К любому коммиту можно вернуться.' },
  { id: 'branch', group: 'git', title: 'Ветка', forms: 'ветк[аиеуой]\\p{L}{0,2}|ветвь', text: 'Отдельная линия изменений в Git. В ветке можно пробовать рискованное, не трогая рабочую версию.' },
  { id: 'hosting', group: 'publish', title: 'Хостинг', forms: 'хостинг\\p{L}{0,3}', text: 'Сервис, на котором лежит сайт, чтобы его видели в интернете: GitHub Pages, Netlify, Vercel и другие.' },
  { id: 'static-hosting', group: 'publish', title: 'Netlify, Vercel, GitHub Pages', forms: 'Netlify|Vercel|GitHub Pages', text: 'Популярные хостинги для простых сайтов. Подключаются к репозиторию и публикуют сайт после каждого изменения.' },
  { id: 'deploy', group: 'publish', title: 'Деплой (публикация)', forms: 'деплой\\p{L}{0,3}|задеплой\\p{L}{0,3}', text: 'Выкладка новой версии сайта на хостинг, чтобы её увидели посетители.' },
  { id: 'domain', group: 'publish', title: 'Домен', forms: 'домен\\p{L}{0,3}', text: 'Адрес сайта, который набирают люди: например, example.ru. Покупается у регистратора и продлевается каждый год.' },
  { id: 'dns', group: 'publish', title: 'DNS', forms: 'DNS', text: 'Система, которая связывает домен с сервером, где лежит сайт. Записи DNS настраивают у регистратора домена.' },
  { id: 'https', group: 'publish', title: 'HTTPS', forms: 'HTTPS', text: 'Защищённое соединение с сайтом (замок в адресной строке). Без него браузеры пугают посетителей предупреждением.' },
  { id: 'url', group: 'publish', title: 'URL (адрес)', forms: 'URL', text: 'Полный адрес страницы в интернете, например https://example.ru/contacts.' },
  { id: 'reference', group: 'design', title: 'Референс', forms: 'референс\\p{L}{0,3}', text: 'Пример чужого сайта или дизайна, который нравится и на который вы ориентируетесь. Не для копирования, а чтобы объяснить настроение.' },
  { id: 'mockup', group: 'design', title: 'Макет', forms: 'макет\\p{L}{0,3}', text: 'Картинка будущей страницы: где какие блоки, тексты и кнопки. По нему потом делают вёрстку.' },
  { id: 'figma', group: 'design', title: 'Figma', forms: 'Figma', text: 'Онлайн-редактор для дизайна сайтов и приложений. В нём рисуют макеты и показывают их заказчику.' },
  { id: 'uxui', group: 'design', title: 'UX и UI', forms: 'UX|UI', text: 'UX — насколько удобно человеку пользоваться сайтом. UI — как выглядят кнопки, шрифты и цвета.' },
  { id: 'landing', group: 'design', title: 'Лендинг', forms: 'лендинг\\p{L}{0,3}', text: 'Одностраничный сайт под одну услугу или предложение, который ведёт к одному действию: заявке, звонку, записи.' },
  { id: 'brief', group: 'client', title: 'Бриф', forms: 'бриф\\p{L}{0,3}', text: 'Короткий документ с ответами на главные вопросы о проекте: цель, аудитория, страницы, материалы, стиль, сроки.' },
  { id: 'portfolio', group: 'client', title: 'Портфолио', forms: 'портфолио', text: 'Подборка ваших работ, по которой заказчик понимает, что вы умеете. Можно начинать с учебных проектов — честно подписанных.' },
  { id: 'case', group: 'client', title: 'Кейс', forms: 'кейс\\p{L}{0,3}', text: 'Рассказ об одной работе: какая была задача, что вы сделали и что получилось.' },
  { id: 'proposal', group: 'client', title: 'Коммерческое предложение (КП)', forms: 'коммерческ\\p{L}{0,3} предложени\\p{L}{0,3}|КП', text: 'Письмо заказчику с тем, что вы сделаете, за какие сроки и сколько это стоит.' },
  { id: 'analytics', group: 'client', title: 'Аналитика', forms: 'аналитик\\p{L}{0,3}', text: 'Сервисы, которые считают посетителей сайта и их действия: сколько пришло, откуда, сколько оставили заявку.' },
];
// Case-sensitive for Latin abbreviations (so «ui» inside words or «api» in code-like text is left alone), otherwise case-insensitive.
export function termRegex(term) {
  const latinAbbr = /^[A-Z|.\\]+$/.test(term.forms);
  return new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${term.forms})(?![\\p{L}\\p{N}_])`, latinAbbr ? 'u' : 'iu');
}
const SKIP = 'a, code, pre, button, h1, h2, h3, h4, .code-panel, .term, .outcome span, .eyebrow, label';
// Turns the first mention of every term inside `containers` into <button class="term" data-action="term" data-id="…">.
export function linkTerms(containers) {
  const used = new Set(); const patterns = TERMS.map(t => [t, termRegex(t)]);
  for (const root of containers) {
    if (!root) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: node => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (let node of nodes) {
      for (;;) {
        let best = null;
        for (const [term, re] of patterns) { if (used.has(term.id)) continue; const m = re.exec(node.data); if (m && (!best || m.index < best.m.index)) best = { term, m }; }
        if (!best) break;
        used.add(best.term.id);
        const rest = node.splitText(best.m.index); const after = rest.splitText(best.m[0].length);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'term'; button.dataset.action = 'term'; button.dataset.id = best.term.id;
        button.textContent = rest.data; rest.replaceWith(button); node = after;
      }
    }
  }
}
