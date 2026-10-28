import { readFile } from 'node:fs/promises';
import { validateInitData } from './auth.mjs';
import { accessMode, isAdmin, offerFor } from './telegram.mjs';
async function readOptional(name, fallback) {
  try { return JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
const freeLessons = JSON.parse(await readFile(new URL('../data/free-lessons.json', import.meta.url), 'utf8'));
const defaultLessons = await readOptional('lessons.json', freeLessons);
const defaultResources = await readOptional('resources.json', {});
const userName = x => /^[a-zA-Z0-9_]{5,32}$/.test(x || '') ? x : 'nalpax';
function channelUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 't.me' && /^\/[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(u.pathname) && !u.search && !u.hash ? u.toString() : null; } catch { return null; } }
export function makeApi(store, telegram, { lessons = defaultLessons, resources = defaultResources } = {}) {
  const contentReady = Array.from({ length: 24 }, (_, i) => i + 1).every(id => lessons.some(l => l.id === id && l.sections?.length)) && ['first-prompt', 'mobile-prompt', 'notes'].every(id => typeof resources[id] === 'string' && resources[id].length > 0);
  const pending = new Set();
  const recent = new Map();
  return async function api(request, response, url, json, body) {
    if (!url.pathname.startsWith('/api/')) return false;
    const send = (status, data) => { json(response, status, data); return true; };
    const preview = !process.env.BOT_TOKEN && process.env.NODE_ENV !== 'production';
    if (url.pathname === '/api/config' && request.method === 'GET') { const offer = offerFor(store); return send(200, { supportUsername: userName(process.env.SUPPORT_USERNAME), requiredChannelUrl: channelUrl(process.env.REQUIRED_CHANNEL_URL), ...offer, accessMode: accessMode(), paymentsEnabled: !!(contentReady && process.env.BOT_TOKEN && offer.priceStars && process.env.REQUIRED_CHANNEL_ID && channelUrl(process.env.REQUIRED_CHANNEL_URL)), preview, freeLessons: 1 }); }
    const adminRoute = url.pathname === '/api/admin/offer';
    const lessonMatch = url.pathname.match(/^\/api\/lessons\/(\d+)$/);
    const resourceMatch = url.pathname.match(/^\/api\/resources\/([a-z-]+)$/);
    const acceptedPost = ['/api/session', '/api/progress', '/api/invoice', '/api/admin/offer'].includes(url.pathname) && request.method === 'POST';
    if (!acceptedPost && !((lessonMatch || resourceMatch || adminRoute) && request.method === 'GET')) return send(404, { error: 'Unknown API endpoint' });
    if (preview && url.pathname === '/api/session') return send(200, { preview: true, user: null, subscribed: false, access: { active: false }, done: [] });
    const data = acceptedPost ? await body(request) : {};
    const user = validateInitData(acceptedPost ? data.initData : request.headers['x-telegram-init-data'], process.env.BOT_TOKEN);
    const id = lessonMatch ? Number(lessonMatch[1]) : null;
    if (preview && id === 1) return send(200, lessons[0]);
    if (!user) return send(401, { error: 'Open the app from Telegram' });
    if (adminRoute) {
      if (!isAdmin(user.id)) return send(403, { error: 'Admin access required' });
      if (request.method === 'GET') return send(200, { ...store.settings(), current: offerFor(store) });
      if (!Number.isInteger(data.priceStars) || data.priceStars < 1 || data.priceStars > 999999 || !Number.isInteger(data.discountPercent) || data.discountPercent < 0 || data.discountPercent > 90 || (data.saleEndsAt && (!Number.isFinite(Date.parse(data.saleEndsAt)) || Date.parse(data.saleEndsAt) <= Date.now()))) return send(400, { error: 'Invalid price or sale parameters' });
      store.saveSettings({ priceStars: data.priceStars, discountPercent: data.discountPercent, saleEndsAt: data.saleEndsAt || null });
      return send(200, { ...store.settings(), current: offerFor(store) });
    }
    const subscribed = await telegram.isMember(user.id);
    const access = store.entitlement(user.id);
    if (url.pathname === '/api/session') return send(200, { user, subscribed, access, done: store.getProgress(user.id), isAdmin: isAdmin(user.id) });
    if (!subscribed) return send(403, { error: 'Channel subscription required', reason: 'channel' });
    if (resourceMatch) {
      if (!access.active) return send(403, { error: 'Purchase required', reason: 'payment' });
      return resources[resourceMatch[1]] ? send(200, { text: resources[resourceMatch[1]] }) : send(404, { error: 'Material not found' });
    }
    if (lessonMatch) {
      if (!lessons[id - 1]) return send(404, { error: 'Lesson not found' });
      if (id > 1 && !access.active) return send(403, { error: 'Purchase required', reason: 'payment' });
      return send(200, lessons[id - 1]);
    }
    if (url.pathname === '/api/progress') {
      if (data.reset === true) store.reset(user.id);
      else {
        if (!Number.isInteger(data.lessonId) || data.lessonId < 1 || data.lessonId > 24) return send(400, { error: 'Invalid lesson' });
        if (data.lessonId > 1 && !access.active) return send(403, { error: 'Purchase required' });
        store.complete(user.id, data.lessonId);
      }
      return send(200, { done: store.getProgress(user.id) });
    }
    const price = offerFor(store).priceStars;
    if (!contentReady || !price || !channelUrl(process.env.REQUIRED_CHANNEL_URL)) return send(503, { error: 'Course content, price or channel not configured' });
    if (access.active) return send(409, { error: 'Access already active' });
    if (pending.has(user.id) || Date.now() - (recent.get(user.id) || 0) < 10000) return send(429, { error: 'Please wait before creating another invoice' });
    pending.add(user.id);
    try {
      const mode = accessMode();
      const order = store.createOrder(user.id, price, mode);
      const link = await telegram.api('createInvoiceLink', {
        title: 'Vibentry — полный курс', description: 'Все 24 урока и материалы курса. Разовая покупка навсегда для твоего аккаунта Telegram.',
        payload: order.id, provider_token: '', currency: 'XTR', prices: [{ label: 'Полный доступ', amount: price }],
      });
      recent.set(user.id, Date.now());
      if (recent.size > 10000) for (const [key, time] of recent) if (Date.now() - time > 60000) recent.delete(key);
      return send(200, { url: link });
    } finally { pending.delete(user.id); }
  };
}
