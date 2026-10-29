# Vibentry — Telegram Mini App + bot (проект для Claude Code)

Платный курс по вайбкодингу в Telegram. Node.js 24+ (проверено на 22), без npm-зависимостей, SQLite (`node:sqlite`), чистые HTML/CSS/JS.

## Команды
- `npm start` — сервер (раздаёт `public/` и `/api/*`), `npm run bot` — бот (long polling). Два процесса, одна база (`DATABASE_PATH`).
- `npm run deploy:cloudflare` — выкладка на Cloudflare Workers (нужен `CLOUDFLARE_API_TOKEN`; `--dry-run` показывает, что уйдёт). Это основной хостинг: см. раздел «Cloudflare» в `handoff/LAUNCH_CHECKLIST_RU.md`.
- `npm test` — все тесты (64+).
- `node scripts/restore-backup.mjs <файл> [база]` — восстановить базу из копии, которую бот присылает админам. Перед каждым коммитом тесты должны быть зелёными.
- `npm run check-links` — проверка внешних ссылок курса (нужен интернет).
- `python3 scripts/browser-smoke.py` — браузерная проверка (нужен Python Playwright; демо-сервер `npm start` без `BOT_TOKEN` на :3000, подписанные сценарии скрипт сам запускает через `scripts/smoke-server.mjs` на :3001).

## Правила, которые нельзя ломать
1. Доступ к платному контенту проверяется на сервере по подписанному `initData` Telegram. Клиенту и `initDataUnsafe` не доверять.
2. Платёж засчитывается только после подтверждения: Stars — `successful_payment` от Telegram; внешние провайдеры — после запроса статуса у самого провайдера (`server/providers/*`), с проверкой суммы и валюты. Вебхук сам по себе доступа не открывает.
3. Платные файлы лежат в `data/` (не в git, не раздаются). Раздаётся только `public/`. Тексты уроков/статей отдаются по запросу, с лимитом и невидимой меткой читателя (`server/fingerprint.mjs`). Промпты копируются свободно — это сознательно.
4. Секреты (токены, ключи провайдеров) только в `.env` на сервере (на Cloudflare — в Secrets воркера). В админку и ответы API они не попадают. Не логировать токены и тела запросов.
5. Весь текст для читателя — на «вы», живой русский язык, без выдуманных кейсов, цифр дохода и отзывов; учебные примеры подписаны как учебные.
6. CSP запрещает inline-стили и скрипты: стили только в `style.css`, динамику через классы или CSSOM.
7. Минимальный размер шрифта 11 px, область нажатия не меньше 44 px.

## Карта
- `server/api.mjs` — все маршруты (одинаковые для Node и Cloudflare); `store-core.mjs` — логика базы поверх драйвера SQL, `store.mjs` — драйвер node:sqlite, `durable-sql.mjs` — драйвер SQLite Durable Object; `content-node.mjs` — чтение `data/` на Node; `telegram.mjs` — Telegram API, цены, каналы, промокоды; `providers/` — Platega, CryptoBot, xRocket; `offers.mjs` — автоскидки в боте (выключены по умолчанию, личные коды на 48 ч, лесенка до 50%); `backup.mjs` — резервная копия базы файлом в бот админам (раз в неделю и кнопкой); `bot-core.mjs` — обработка апдейтов бота и напоминания (`sendReminders`: одно сообщение после 3 дней тишины, 10–20 по Москве, `/reminders`; на Cloudflare — ежечасный alarm Durable Object), `bot.mjs` — long polling на Node.
- Cloudflare: `worker.mjs` — вход (Durable Object `VibentryApp` с базой; статика из `public/`), `worker-app.mjs` — webhook бота, автонастройка webhook на `/health`, мост к `api.mjs` (тестируется в Node). `scripts/deploy-cloudflare.mjs` собирает `data/` и `public/` в скрипт в памяти, на диск и в git они не попадают.
- Документы для покупателей и банка: `public/tariffs.html`, `terms.html`, `privacy.html`, `contacts.html` + `public/js/legal.js` (данные из `/api/legal`: контакты, цены из админки; реквизиты продавца — только если владелец задал `SELLER_*`, по умолчанию не публикуются). Меняя тексты, обновите дату в них и `DOCUMENTS_DATE` в `api.mjs`.
- `public/js/app.js` — экраны (в т.ч. экран после урока 05 `#next`, тариф `#buy`, события воронки `/api/event`, избранное и чек-листы через `/api/marks`); `practice.js` — «Практикум» (4 тренажёра; Pro без ограничений, Free — 3 запуска, считает сервер `/api/practice`, квиз и чек-лист в `server/practice-data.mjs`); `glossary.js` — «Термины» (вкладка в Материалах и всплывающие объяснения слов в уроках); `admin.js` — админ-панель; `protect.js` — защита чтения; `markdown.js` — рендер текстов.
- `data/*.json` — приватный контент (уроки, статьи, 300 промптов, шаблоны). `scripts/import-package.mjs` — импорт из пакета материалов (не затирает 300 промптов).
