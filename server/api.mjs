import { validateInitData } from './auth.mjs';
import { FREE_LESSONS, accessMode, applyPromo, channelsFor, isAdmin, normalizeChannel, offerFor, pricesFor } from './telegram.mjs';
import { makeProviders } from './providers/index.mjs';
import { fingerprint } from './fingerprint.mjs';
import { FREE_PRACTICE_LAUNCHES, HANDOVER, QUIZ, TRAINER_IDS } from './practice-data.mjs';
import { MAX_OFFER_PERCENT, offerSettings } from './offers.mjs';
import { sendBackup } from './backup.mjs';
import { weekPlanMessage } from './bot-core.mjs';
// Course content is passed in by the host: server/content-node.mjs reads data/ for Node, the Cloudflare build bundles it.
// Date of the current terms and privacy policy (public/terms.html, public/privacy.html). Change both when the texts change.
const DOCUMENTS_DATE = '2026-10-29';
const userName = x => /^[a-zA-Z0-9_]{5,32}$/.test(x || '') ? x : 'nalpax';
async function readRaw(request, limit = 20000) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) { const error = new Error('Payload too large'); error.status = 413; throw error; } chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
const currencyKey = { RUB: 'rub', USDT: 'usdt' };
export function makeApi(store, telegram, { lessons = [], resources = {}, prompts = { categories: [], items: [] }, articles = [], providers = makeProviders() } = {}) {
  // Payment methods the buyer can pick right now: Stars (needs the bot token) plus every provider that is configured in .env,
  // switched on in the admin panel and has a price in its currency.
  function methodsFor(promoPercent = 0) {
    const prices = pricesFor(store, promoPercent); const state = store.providerState(); const list = [];
    if (process.env.BOT_TOKEN && prices.stars) list.push({ id: 'stars', title: 'Telegram Stars', symbol: '★', amount: prices.stars, regular: prices.regular.stars });
    for (const provider of providers.list) {
      const amount = prices[currencyKey[provider.currency]];
      if (provider.configured() && state[provider.id] && amount) list.push({ id: provider.id, title: provider.title, symbol: provider.symbol, amount, regular: prices.regular[currencyKey[provider.currency]] });
    }
    return list;
  }
  // Scraping guard: a real reader opens a handful of pages; a script pulls everything in seconds.
  const windows = new Map();
  const limits = { content: 40, prompts: 200 };
  function overLimit(userId, bucket) {
    const key = `${bucket}:${userId}`; const now = Date.now(); const hits = (windows.get(key) || []).filter(time => now - time < 600000);
    hits.push(now); windows.set(key, hits);
    if (windows.size > 20000) windows.clear();
    if (hits.length > limits[bucket]) { if (hits.length === limits[bucket] + 1) store.log(userId, 'rate-limit', bucket); return true; }
    return false;
  }
  const settleThrottle = new Map();
  async function settle(provider, externalId, hint = null) {
    const order = store.orderByInvoice(provider.id, externalId);
    if (!order) return 'unknown';
    if (store.orderPaid(order.id)) return 'duplicate';
    let status = await provider.fetchStatus(externalId);
    if (!status) {
      if (!hint?.paidHint) return 'pending';
      if (hint.claimed?.payload && hint.claimed.payload !== order.id) return 'mismatch';
      status = { paid: true, amount: hint.claimed?.amount, currency: hint.claimed?.currency };
    }
    if (!status.paid) return 'pending';
    const result = store.recordExternalPayment(provider.id, externalId, status);
    if (result === 'new') telegram.api('sendMessage', { chat_id: order.user_id, text: 'Оплата получена, спасибо! Все уроки, промпты и база материалов открыты в мини-приложении.' }).then(() => telegram.api('sendMessage', { chat_id: order.user_id, ...weekPlanMessage({ done: store.getProgress(order.user_id), titles: lessons.map(l => l.title), appUrl: (process.env.APP_URL || '').replace(/\/$/, ''), support: process.env.SUPPORT_USERNAME }) })).catch(() => {});
    return result || 'mismatch';
  }
  const hasText = l => !!(l.sections?.length || l.markdown);
  const promptIndex = new Map((prompts.items || []).map(item => [item.id, item]));
  const articleIndex = new Map(articles.map(item => [item.id, item]));
  // Positive membership checks are cached briefly so a busy app does not hit getChatMember on every request.
  const members = new Map();
  async function subscribedUser(userId, fresh = false) {
    const hit = members.get(userId);
    const ttl = Math.max(0, Number(process.env.MEMBERSHIP_CACHE_SECONDS ?? 60)) * 1000;
    if (!fresh && hit && Date.now() - hit < ttl) return true;
    const ok = await telegram.isMember(userId, channelsFor(store));
    if (ok) { members.set(userId, Date.now()); if (members.size > 20000) members.clear(); } else members.delete(userId);
    return ok;
  }
  const contentReady = Array.from({ length: 24 }, (_, i) => i + 1).every(id => lessons.some(l => l.id === id && hasText(l))) && ['first-prompt', 'mobile-prompt', 'notes'].every(id => typeof resources[id] === 'string' && resources[id].length > 0);
  const promptList = () => ({ categories: prompts.categories || [], items: (prompts.items || []).map(({ id, title, use }) => ({ id, title, use })) });
  const articleList = () => ({ items: articles.map(({ id, group, groupTitle, title, description, free }) => ({ id, group, groupTitle, title, description, free: !!free })) });
  const pending = new Set();
  const recent = new Map();
  // What is sold and whether it can be bought right now: the bot's tariff screen uses the same facts as the app.
  const purchaseInfo = () => ({ prices: pricesFor(store), ready: !!(contentReady && channelsFor(store).length > 0 && methodsFor().length > 0), course: { lessons: 24, freeLessons: FREE_LESSONS, prompts: promptIndex.size, articles: articleIndex.size } });
  const handler = async function api(request, response, url, json, body) {
    if (!url.pathname.startsWith('/api/')) return false;
    const send = (status, data) => { json(response, status, data); return true; };
    const preview = !process.env.BOT_TOKEN && process.env.NODE_ENV !== 'production';
    const hook = url.pathname.match(/^\/api\/webhooks\/([a-z]+)$/);
    if (hook && request.method === 'POST') {
      const provider = providers.get(hook[1]);
      if (!provider || !provider.configured()) return send(404, { error: 'Unknown provider' });
      const event = provider.verifyWebhook({ headers: request.headers, rawBody: await readRaw(request) });
      if (!event) return send(401, { error: 'Invalid signature' });
      try { if (event.externalId) await settle(provider, event.externalId, event); } catch { return send(500, { error: 'Try again later' }); }
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/config' && request.method === 'GET') { const offer = offerFor(store); return send(200, { supportUsername: userName(process.env.SUPPORT_USERNAME), requiredChannelUrl: channelsFor(store)[0]?.url || null, requiredChannels: channelsFor(store).map(({ title, url }) => ({ title, url })), ...offer, accessMode: accessMode(), methods: methodsFor(), prices: pricesFor(store), paymentsEnabled: !!(contentReady && channelsFor(store).length > 0 && methodsFor().length > 0), preview, freeLessons: FREE_LESSONS, library: { prompts: promptIndex.size, articles: articleIndex.size } }); }
    // Public facts for the documents pages (tariffs, terms, privacy, contacts): no Telegram login, no secrets.
    // Seller details are optional (SELLER_STATUS / SELLER_NAME / SELLER_INN): by default the documents name only the service
    // administration and the support contact. Nothing is shown if a value is missing or malformed.
    if (url.pathname === '/api/legal' && request.method === 'GET') {
      const name = String(process.env.SELLER_NAME || '').trim().slice(0, 120);
      const status = String(process.env.SELLER_STATUS || '').trim().slice(0, 120);
      const inn = String(process.env.SELLER_INN || '').trim();
      const email = String(process.env.SUPPORT_EMAIL || '').trim();
      const bot = String(process.env.BOT_USERNAME || '').trim().replace(/^@/, '');
      return send(200, {
        seller: { status: status || null, name: name || null, inn: /^(\d{10}|\d{12})$/.test(inn) ? inn : null },
        support: { telegram: userName(process.env.SUPPORT_USERNAME), email: /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email) ? email : null, bot: /^[a-zA-Z0-9_]{5,32}$/.test(bot) ? bot : null },
        prices: pricesFor(store), course: { lessons: 24, freeLessons: FREE_LESSONS, prompts: promptIndex.size, articles: articleIndex.size }, documentsDate: DOCUMENTS_DATE,
      });
    }
    const adminRoute = url.pathname.startsWith('/api/admin/');
    const lessonMatch = url.pathname.match(/^\/api\/lessons\/(\d+)$/);
    const resourceMatch = url.pathname.match(/^\/api\/resources\/([a-z-]+)$/);
    const promptMatch = url.pathname.match(/^\/api\/prompts\/(\d{3})$/);
    const articleMatch = url.pathname.match(/^\/api\/articles\/([a-z0-9-]+)$/);
    const listRoute = ['/api/prompts', '/api/articles', '/api/marks'].includes(url.pathname);
    const orderMatch = url.pathname.match(/^\/api\/order\/([0-9a-f-]{36})$/);
    const acceptedPost = (['/api/session', '/api/progress', '/api/invoice', '/api/promo', '/api/marks', '/api/practice', '/api/event', '/api/onboarding'].includes(url.pathname) || url.pathname.startsWith('/api/admin/')) && request.method === 'POST';
    if (!acceptedPost && !((lessonMatch || resourceMatch || promptMatch || articleMatch || listRoute || adminRoute || orderMatch) && request.method === 'GET')) return send(404, { error: 'Unknown API endpoint' });
    if (preview && url.pathname === '/api/session') return send(200, { preview: true, user: null, subscribed: false, access: { active: false }, done: [] });
    const data = acceptedPost ? await body(request) : {};
    const user = validateInitData(acceptedPost ? data.initData : request.headers['x-telegram-init-data'], process.env.BOT_TOKEN);
    const id = lessonMatch ? Number(lessonMatch[1]) : null;
    if (preview && id >= 1 && id <= FREE_LESSONS && lessons[id - 1]) return send(200, lessons[id - 1]);
    // Design preview only (no BOT_TOKEN, not production): catalogue titles and the free article are readable.
    if (preview && request.method === 'GET') {
      if (url.pathname === '/api/prompts') return send(200, promptList());
      if (url.pathname === '/api/articles') return send(200, articleList());
      const sample = articleMatch && articleIndex.get(articleMatch[1]);
      if (sample?.free) return send(200, { id: sample.id, title: sample.title, groupTitle: sample.groupTitle, markdown: sample.markdown });
    }
    if (!user) return send(401, { error: 'Open the app from Telegram' });
    if (adminRoute) {
      if (!isAdmin(user.id)) return send(403, { error: 'Admin access required' });
      store.upsertUser(user);
      const route = url.pathname.slice('/api/admin/'.length);
      const get = request.method === 'GET';
      const bad = message => send(400, { error: message });
      const providerList = () => providers.list.map(p => ({ id: p.id, title: p.title, currency: p.currency, configured: p.configured(), enabled: !!store.providerState()[p.id], needsSandboxCheck: !!p.needsSandboxCheck, webhook: `${(process.env.APP_URL || '').replace(/\/$/, '')}/api/webhooks/${p.id}` }));
      const overview = () => ({ ...store.settings(), current: offerFor(store), prices: pricesFor(store), methods: methodsFor(), providers: providerList(), channels: store.channels(), effectiveChannels: channelsFor(store), promos: store.promos(), stats: store.stats() , autoOffers: { ...offerSettings(store), stats: store.offerStats(), paymentsReady: purchaseInfo().ready }});
      if (route === 'offer') {
        if (get) return send(200, { ...store.settings(), current: offerFor(store) });
        // Stars price is optional (Stars payment stays off without it); at least one price in some currency is required.
        const stars = data.priceStars === null || data.priceStars === undefined || data.priceStars === '' ? null : data.priceStars;
        if ((stars !== null && (!Number.isInteger(stars) || stars < 1 || stars > 999999)) || !Number.isInteger(data.discountPercent) || data.discountPercent < 0 || data.discountPercent > 90 || (data.saleEndsAt && (!Number.isFinite(Date.parse(data.saleEndsAt)) || Date.parse(data.saleEndsAt) <= Date.now()))) return bad('Invalid price or sale parameters');
        const optional = (value, min, max) => value === undefined || value === null || value === '' ? null : (Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Math.round(Number(value) * 100) / 100 : NaN);
        const priceRub = optional(data.priceRub, 1, 9999999); const priceUsdt = optional(data.priceUsdt, 0.01, 99999);
        if (Number.isNaN(priceRub) || Number.isNaN(priceUsdt)) return bad('Invalid price or sale parameters');
        if (stars === null && priceRub === null && priceUsdt === null) return bad('Укажите цену хотя бы в одной валюте');
        store.saveSettings({ priceStars: stars, priceRub, priceUsdt, discountPercent: data.discountPercent, saleEndsAt: data.saleEndsAt || null });
        store.log(user.id, 'offer', [stars && `${stars}⭐`, priceRub && `${priceRub}₽`, priceUsdt && `${priceUsdt} USDT`].filter(Boolean).join(' / ') + ` −${data.discountPercent}%`);
        return send(200, { ...store.settings(), current: offerFor(store) });
      }
      if (route === 'overview' && get) return send(200, overview());
      if (route === 'funnel' && get) {
        const days = Number.parseInt(url.searchParams.get('days') || '', 10);
        const admins = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Number.isSafeInteger);
        const f = store.funnel(days > 0 ? Date.now() - days * 86400000 : 0, FREE_LESSONS, admins);
        const labels = [['opened', 'Открыли приложение'], ['subscribed', 'Подписались на канал'], ['lesson1', 'Прошли урок 01'], ['free', `Прошли бесплатную часть (01–${String(FREE_LESSONS).padStart(2, '0')})`], ['tariff', 'Открыли тариф'], ['pay', 'Нажали «Оплатить»'], ['bought', 'Купили']];
        const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
        return send(200, { days: days > 0 ? days : null, steps: labels.map(([id, label], i) => ({ id, label, count: f[id], ofTotal: pct(f[id], f.opened), ofPrevious: i ? pct(f[id], f[labels[i - 1][0]]) : 100 })), offers: store.offerStats() });
      }
      if (route === 'users' && get) {
        const plan = ['all', 'free', 'pro'].includes(url.searchParams.get('plan')) ? url.searchParams.get('plan') : 'all';
        const page = Math.max(0, Number.parseInt(url.searchParams.get('page') || '0', 10) || 0);
        const result = store.listUsers({ q: (url.searchParams.get('q') || '').slice(0, 64), plan, limit: 20, offset: page * 20 });
        return send(200, { total: result.total, page, pageSize: 20, items: result.items.map(row => ({ id: row.id, firstName: row.first_name, lastName: row.last_name, username: row.username, plan: row.pro ? 'pro' : 'free', stars: row.stars, done: row.done, firstSeen: row.first_seen, lastSeen: row.last_seen })) });
      }
      const userMatch = route.match(/^users\/(\d{1,15})$/);
      if (userMatch && get) {
        const row = store.userRow(Number(userMatch[1]));
        if (!row) return send(404, { error: 'User not found' });
        return send(200, { id: row.id, firstName: row.first_name, lastName: row.last_name, username: row.username, firstSeen: row.first_seen, lastSeen: row.last_seen, onboarding: store.onboarding(row.id), done: store.getProgress(row.id), plan: store.entitlement(row.id).active ? 'pro' : 'free', payments: store.userPayments(row.id).map(p => ({ provider: p.provider, amount: p.amount, currency: p.currency, chargeId: p.charge_id.startsWith('manual-') ? 'manual' : p.charge_id.slice(0, 12) + '…', stars: p.stars, paidAt: p.paid_at, promo: p.promo, refunded: !!p.refunded, manual: p.charge_id.startsWith('manual-') })) });
      }
      if (get && route === 'audit') return send(200, { items: store.auditLog().map(a => ({ at: a.at, admin: a.username ? '@' + a.username : a.first_name || String(a.admin_id), action: a.action, detail: a.detail })) });
      if (get) return send(404, { error: 'Unknown API endpoint' });
      if (route === 'grant' || route === 'revoke') {
        if (!Number.isSafeInteger(data.userId) || !store.userRow(data.userId)) return bad('Unknown user');
        const changed = route === 'grant' ? store.grantAccess(data.userId) : store.revokeAccess(data.userId);
        store.log(user.id, route, `user ${data.userId}`);
        return send(200, { changed: !!changed, plan: store.entitlement(data.userId).active ? 'pro' : 'free' });
      }
      if (route === 'channels') {
        if (!Array.isArray(data.channels) || data.channels.length > 5) return bad('До 5 каналов или чатов');
        const list = data.channels.map(normalizeChannel);
        if (list.some(c => !c)) return bad('Проверьте ссылку (https://t.me/имя или приглашение) и ID чата (@имя или -100…). Для публичного канала @имя должно совпадать со ссылкой — или оставьте ID пустым.');
        if (new Set(list.map(c => c.chatId)).size !== list.length) return bad('Один и тот же чат указан дважды');
        store.saveChannels(list);
        store.log(user.id, 'channels', list.map(c => c.chatId).join(', ') || 'пусто');
        return send(200, overview());
      }
      if (route === 'channels/check') {
        const normal = normalizeChannel(data);
        if (!normal) return bad('Некорректная ссылка или ID');
        try { const chat = await telegram.api('getChat', { chat_id: normal.chatId }); const me = await telegram.api('getMe'); const admin = await telegram.api('getChatMember', { chat_id: normal.chatId, user_id: me.id }); return send(200, { ok: ['administrator', 'creator'].includes(admin.status), title: chat.title || normal.title, status: admin.status }); }
        catch { return send(200, { ok: false, status: 'unreachable' }); }
      }
      if (route === 'providers') {
        const provider = providers.get(String(data.id || ''));
        if (!provider) return bad('Unknown provider');
        if (data.enabled === true && !provider.configured()) return bad('Сначала добавьте ключи этого провайдера в настройки сервера (.env или Secrets в Cloudflare)');
        store.saveProviderState({ ...store.providerState(), [provider.id]: data.enabled === true });
        store.log(user.id, 'provider', `${provider.id} ${data.enabled === true ? 'on' : 'off'}`);
        return send(200, overview());
      }
      if (route === 'backup') {
        try { await sendBackup({ store, telegram, chatIds: [user.id] }); } catch { return send(502, { error: 'Не удалось отправить файл. Напишите боту /start и попробуйте ещё раз.' }); }
        store.log(user.id, 'backup', 'копия отправлена в Telegram');
        return send(200, { ok: true });
      }
      if (route === 'auto-offers') {
        const ladder = Array.isArray(data.ladder) ? data.ladder : [];
        if (typeof data.enabled !== 'boolean' || !ladder.length || ladder.length > 3 || ladder.some(n => !Number.isInteger(n) || n < 5 || n > MAX_OFFER_PERCENT)) return bad(`Скидки: от 5 до ${MAX_OFFER_PERCENT}%, до трёх ступеней`);
        store.saveOfferSettings({ enabled: data.enabled, ladder });
        store.log(user.id, 'auto-offers', `${data.enabled ? 'on' : 'off'} ${ladder.join('/')}%`);
        return send(200, overview());
      }
      if (route === 'promos') {
        const code = String(data.code || '').trim().toUpperCase();
        if (data.remove === true) { store.deletePromo(code); store.log(user.id, 'promo-delete', code); return send(200, overview()); }
        const maxUses = data.maxUses === null || data.maxUses === '' || data.maxUses === undefined ? null : Number(data.maxUses);
        if (!/^[A-Z0-9_-]{3,24}$/.test(code) || !Number.isInteger(data.percent) || data.percent < 1 || data.percent > 90 || (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000000)) || (data.expiresAt && (!Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()))) return bad('Код: 3–24 символа A–Z, 0–9, _ или -; скидка 1–90%');
        store.savePromo({ code, percent: data.percent, maxUses, expiresAt: data.expiresAt || null, active: data.active !== false });
        store.log(user.id, 'promo', `${code} −${data.percent}%`);
        return send(200, overview());
      }
      return send(404, { error: 'Unknown API endpoint' });
    }
    // Funnel events from the app. The tariff can be opened before subscribing, so this comes before the subscription check.
    if (url.pathname === '/api/event') {
      if (!['tariff_open', 'pay_click'].includes(data.step)) return send(400, { error: 'Unknown step' });
      store.upsertUser(user); store.markStep(user.id, data.step);
      return send(200, { ok: true });
    }
    if (['/api/session', '/api/practice', '/api/onboarding'].includes(url.pathname)) store.upsertUser(user);
    let subscribed;
    let subscriptionUnavailable = false;
    try { subscribed = await subscribedUser(user.id, url.pathname === '/api/session'); }
    catch {
      // Signing in must survive a Telegram failure (otherwise a wrong channel locks the owner out of the admin panel).
      // It fails closed: not subscribed. Every content request below still answers 503.
      if (url.pathname !== '/api/session') return send(503, { error: 'Subscription check is temporarily unavailable', reason: 'telegram' });
      subscribed = false; subscriptionUnavailable = true;
    }
    const access = store.entitlement(user.id);
    if (subscribed && url.pathname === '/api/session') store.markStep(user.id, 'subscribed');
    const practice = () => ({ unlimited: !!access.active, limit: FREE_PRACTICE_LAUNCHES, remaining: Math.max(0, FREE_PRACTICE_LAUNCHES - store.practiceUsed(user.id)) });
    if (url.pathname === '/api/session') return send(200, { user, subscribed, access, done: store.getProgress(user.id), isAdmin: isAdmin(user.id), practice: practice(), onboarding: store.onboarding(user.id), personalOffer: (({ code, percent, expires_at } = {}) => (code ? { code, percent, expiresAt: expires_at } : null))(store.activePersonalPromo(user.id) || undefined), ...(subscriptionUnavailable ? { subscriptionUnavailable } : {}) });
    if (!subscribed) return send(403, { error: 'Channel subscription required', reason: 'channel' });
    if (orderMatch) {
      const order = store.order(orderMatch[1]);
      if (!order || order.user_id !== user.id) return send(404, { error: 'Order not found' });
      let paid = store.orderPaid(order.id);
      const provider = providers.get(order.provider); const row = store.invoiceForOrder(order.id);
      // Fallback for a missed webhook: ask the provider at most every 3 seconds per order.
      if (!paid && provider && row && Date.now() - (settleThrottle.get(order.id) || 0) > 3000) {
        settleThrottle.set(order.id, Date.now()); if (settleThrottle.size > 5000) settleThrottle.clear();
        try { await settle(provider, row.external_id); paid = store.orderPaid(order.id); } catch {}
      }
      return send(200, { paid });
    }
    if (url.pathname === '/api/prompts') return send(200, promptList());
    if (url.pathname === '/api/articles') return send(200, articleList());
    // «Практикум»: Pro has no limit; a free account gets FREE_PRACTICE_LAUNCHES launches. Quiz and checklist content only after an allowed launch.
    if (url.pathname === '/api/practice') {
      if (!TRAINER_IDS.includes(data.id)) return send(400, { error: 'Unknown trainer' });
      if (!access.active) { if (store.practiceUsed(user.id) >= FREE_PRACTICE_LAUNCHES) return send(403, { error: 'Purchase required', reason: 'payment', ...practice() }); store.usePractice(user.id); }
      return send(200, { ...practice(), data: data.id === 'quiz' ? { quiz: QUIZ } : data.id === 'handover' ? { handover: HANDOVER } : {} });
    }
    if (url.pathname === '/api/onboarding') {
      const goal = data.skip === true ? 'skip' : data.goal; const experience = data.skip === true ? 'skip' : data.experience;
      if (!['own', 'earn', 'learn', 'skip'].includes(goal) || !['none', 'tried', 'pro', 'skip'].includes(experience)) return send(400, { error: 'Unknown answer' });
      store.setOnboarding(user.id, goal, experience);
      return send(200, { onboarding: store.onboarding(user.id) });
    }
    if (url.pathname === '/api/marks') {
      if (request.method === 'GET') return send(200, store.marks(user.id));
      if (data.favorite) {
        const id = String(data.favorite.id || '');
        if (!promptIndex.has(id)) return send(400, { error: 'Unknown prompt' });
        store.setFavorite(user.id, id, data.favorite.on === true);
      } else if (data.task) {
        const { lessonId, index, on } = data.task;
        if (!Number.isInteger(lessonId) || lessonId < 1 || lessonId > 24 || !Number.isInteger(index) || index < 0 || index > 99) return send(400, { error: 'Invalid checklist item' });
        if (lessonId > FREE_LESSONS && !access.active) return send(403, { error: 'Purchase required', reason: 'payment' });
        store.setTask(user.id, lessonId, index, on === true);
      } else return send(400, { error: 'Nothing to save' });
      return send(200, store.marks(user.id));
    }
    if (promptMatch) {
      const item = promptIndex.get(promptMatch[1]);
      if (!item) return send(404, { error: 'Prompt not found' });
      if (!access.active) return send(403, { error: 'Purchase required', reason: 'payment' });
      if (overLimit(user.id, 'prompts')) return send(429, { error: 'Слишком много запросов подряд. Подождите несколько минут.' });
      return send(200, { id: item.id, title: item.title, use: item.use, text: item.prompt });
    }
    if (articleMatch) {
      const item = articleIndex.get(articleMatch[1]);
      if (!item) return send(404, { error: 'Article not found' });
      if (!item.free && !access.active) return send(403, { error: 'Purchase required', reason: 'payment' });
      if (overLimit(user.id, 'content')) return send(429, { error: 'Слишком много запросов подряд. Подождите несколько минут.' });
      return send(200, { id: item.id, title: item.title, groupTitle: item.groupTitle, markdown: fingerprint(item.markdown, user.id) });
    }
    if (resourceMatch) {
      if (!access.active) return send(403, { error: 'Purchase required', reason: 'payment' });
      if (overLimit(user.id, 'prompts')) return send(429, { error: 'Слишком много запросов подряд. Подождите несколько минут.' });
      return resources[resourceMatch[1]] ? send(200, { text: resources[resourceMatch[1]] }) : send(404, { error: 'Material not found' });
    }
    if (lessonMatch) {
      if (!lessons[id - 1]) return send(404, { error: 'Lesson not found' });
      if (id > FREE_LESSONS && !access.active) return send(403, { error: 'Purchase required', reason: 'payment' });
      if (overLimit(user.id, 'content')) return send(429, { error: 'Слишком много запросов подряд. Подождите несколько минут.' });
      const lesson = lessons[id - 1];
      return send(200, lesson.markdown ? { ...lesson, markdown: fingerprint(lesson.markdown, user.id), ...(lesson.task ? { task: fingerprint(lesson.task, user.id) } : {}) } : lesson);
    }
    if (url.pathname === '/api/progress') {
      if (data.reset === true) store.reset(user.id);
      else {
        if (!Number.isInteger(data.lessonId) || data.lessonId < 1 || data.lessonId > 24) return send(400, { error: 'Invalid lesson' });
        if (data.lessonId > FREE_LESSONS && !access.active) return send(403, { error: 'Purchase required' });
        store.complete(user.id, data.lessonId);
      }
      return send(200, { done: store.getProgress(user.id) });
    }
    // ---- checkout ----
    let promoCode = null; let promoPercent = 0;
    if (url.pathname === '/api/promo' || (typeof data.promo === 'string' && data.promo.trim())) {
      const result = applyPromo(store, data.promo, 100, Date.now(), user.id);
      if (result.error) return send(400, { error: result.error });
      promoCode = result.code; promoPercent = result.percent;
      if (url.pathname === '/api/promo') return send(200, { code: promoCode, percent: promoPercent, methods: methodsFor(promoPercent) });
    }
    if (url.pathname === '/api/promo') return send(400, { error: 'Введите промокод' });
    const wanted = typeof data.method === 'string' ? data.method : 'stars';
    const method = methodsFor(promoPercent).find(m => m.id === wanted);
    if (!contentReady || !method || !channelsFor(store).length) return send(503, { error: 'Course content, price, payment method or channel not configured' });
    if (access.active) return send(409, { error: 'Access already active' });
    if (pending.has(user.id) || Date.now() - (recent.get(user.id) || 0) < 10000) return send(429, { error: 'Please wait before creating another invoice' });
    pending.add(user.id);
    const description = `Все 24 урока, ${promptIndex.size} промптов и база материалов. Разовая покупка для вашего аккаунта Telegram.`;
    try {
      let result;
      if (method.id === 'stars') {
        const order = store.createOrder(user.id, method.amount, accessMode(), promoCode);
        const link = await telegram.api('createInvoiceLink', { title: 'Vibentry — полный доступ', description, payload: order.id, provider_token: '', currency: 'XTR', prices: [{ label: 'Полный доступ', amount: method.amount }] });
        result = { url: link, method: 'stars' };
      } else {
        const provider = providers.get(method.id);
        const order = store.createExternalOrder(user.id, provider.id, method.amount, provider.currency, promoCode);
        const home = process.env.APP_URL || (process.env.BOT_USERNAME ? `https://t.me/${process.env.BOT_USERNAME.replace(/^@/, '')}` : 'https://t.me');
        const { externalId, payUrl } = await provider.createInvoice({ order, urls: { success: home, fail: home } });
        store.attachInvoice(provider.id, externalId, order.id);
        result = { url: payUrl, method: provider.id, orderId: order.id };
      }
      recent.set(user.id, Date.now());
      if (recent.size > 10000) for (const [key, time] of recent) if (Date.now() - time > 60000) recent.delete(key);
      return send(200, result);
    } catch (error) { if (method.id !== 'stars') return send(502, { error: 'Payment provider is unavailable' }); throw error; }
    finally { pending.delete(user.id); }
  };
  handler.purchaseInfo = purchaseInfo;
  return handler;
}
