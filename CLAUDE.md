# Vibentry — Telegram Mini App + bot (проект для Claude Code)

Платный курс по вайбкодингу в Telegram. Node.js 24+ (проверено на 22), без npm-зависимостей, SQLite (`node:sqlite`), чистые HTML/CSS/JS.

## Команды
- `npm start` — сервер (раздаёт `public/` и `/api/*`), `npm run bot` — бот (long polling). Два процесса, одна база (`DATABASE_PATH`).
- `npm run deploy:cloudflare` — выкладка на Cloudflare Workers (нужен `CLOUDFLARE_API_TOKEN`; `--dry-run` показывает, что уйдёт). Это основной хостинг: см. раздел «Cloudflare» в `handoff/LAUNCH_CHECKLIST_RU.md`.
- `npm test` — все тесты (29+). Перед каждым коммитом тесты должны быть зелёными.
- `npm run check-links` — проверка внешних ссылок курса (нужен интернет).
- `python3 scripts/browser-smoke.py` — браузерная проверка (нужен Playwright, сервер на :3000).

## Правила, которые нельзя ломать
1. Доступ к платному контенту проверяется на сервере по подписанному `initData` Telegram. Клиенту и `initDataUnsafe` не доверять.
2. Платёж засчитывается только после подтверждения: Stars — `successful_payment` от Telegram; внешние провайдеры — после запроса статуса у самого провайдера (`server/providers/*`), с проверкой суммы и валюты. Вебхук сам по себе доступа не открывает.
3. Платные файлы лежат в `data/` (не в git, не раздаются). Раздаётся только `public/`. Тексты уроков/статей отдаются по запросу, с лимитом и невидимой меткой читателя (`server/fingerprint.mjs`). Промпты копируются свободно — это сознательно.
4. Секреты (токены, ключи провайдеров) только в `.env` на сервере (на Cloudflare — в Secrets воркера). В админку и ответы API они не попадают. Не логировать токены и тела запросов.
5. Весь текст для читателя — на «вы», живой русский язык, без выдуманных кейсов, цифр дохода и отзывов; учебные примеры подписаны как учебные.
6. CSP запрещает inline-стили и скрипты: стили только в `style.css`, динамику через классы или CSSOM.
7. Минимальный размер шрифта 11 px, область нажатия не меньше 44 px.

## Карта
- `server/api.mjs` — все маршруты (одинаковые для Node и Cloudflare); `store-core.mjs` — логика базы поверх драйвера SQL, `store.mjs` — драйвер node:sqlite, `durable-sql.mjs` — драйвер SQLite Durable Object; `content-node.mjs` — чтение `data/` на Node; `telegram.mjs` — Telegram API, цены, каналы, промокоды; `providers/` — Platega, CryptoBot, xRocket; `bot-core.mjs` — обработка апдейтов бота, `bot.mjs` — long polling на Node.
- Cloudflare: `worker.mjs` — вход (Durable Object `VibentryApp` с базой; статика из `public/`), `worker-app.mjs` — webhook бота, автонастройка webhook на `/health`, мост к `api.mjs` (тестируется в Node). `scripts/deploy-cloudflare.mjs` собирает `data/` и `public/` в скрипт в памяти, на диск и в git они не попадают.
- Документы для покупателей и банка: `public/tariffs.html`, `terms.html`, `privacy.html`, `contacts.html` + `public/js/legal.js` (данные из `/api/legal`: продавец из `SELLER_NAME`/`SELLER_INN`, цены из админки). Меняя тексты, обновите дату в них и `DOCUMENTS_DATE` в `api.mjs`.
- `public/js/app.js` — экраны; `admin.js` — админ-панель; `protect.js` — защита чтения; `markdown.js` — рендер текстов.
- `data/*.json` — приватный контент (уроки, статьи, 300 промптов, шаблоны). `scripts/import-package.mjs` — импорт из пакета материалов (не затирает 300 промптов).
