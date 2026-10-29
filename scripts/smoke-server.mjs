// Server for scripts/browser-smoke.py: the real API with a fake Telegram and an in-memory database.
// The token is synthetic (the smoke script signs initData with the same one); nothing here talks to Telegram or touches real data.
// Users: 777 — admin, onboarding done; 778 — new free user; 779 — paid user, onboarding done. Usage: node scripts/smoke-server.mjs [port]
process.env.BOT_TOKEN = '123456:synthetic_smoke_token_not_a_real_one_x';
process.env.ADMIN_IDS = '777'; process.env.PRICE_RUB = '1299'; process.env.BOT_USERNAME = 'vibentry_bot';
process.env.APP_URL = 'https://smoke.invalid'; process.env.MEMBERSHIP_CACHE_SECONDS = '0';
const { Store } = await import('../server/store.mjs');
const { createApp } = await import('../server/index.mjs');
const store = new Store(':memory:');
store.saveChannels([{ chatId: '@smokechannel', url: 'https://t.me/smokechannel', title: 'Канал' }]);
store.upsertUser({ id: 777, first_name: 'Владелец' }); store.setOnboarding(777, 'earn', 'tried');
store.upsertUser({ id: 779, first_name: 'Покупатель' }); store.setOnboarding(779, 'own', 'none'); store.grantAccess(779);
for (const id of [778, 779]) store.addEvent(id, 'app_open'); store.addEvent(779, 'lesson_open', '1'); store.complete(779, 1); // a little for «Воронка»
const replies = { getMe: { id: 1, username: 'vibentry_bot' }, getChatMember: { status: 'administrator' }, getWebhookInfo: { url: '' }, createInvoiceLink: 'https://t.me/$smoke' };
const telegram = { isMember: async () => true, api: async method => replies[method] ?? true, upload: async () => true };
const port = Number(process.argv[2] || 3001);
createApp({ store, telegram }).listen(port, '127.0.0.1', () => console.log(`smoke server on http://127.0.0.1:${port}`));
