export class Telegram {
  constructor(token = process.env.BOT_TOKEN) { this.token = token; }
  async api(method, payload = {}, signal) {
    if (!this.token) throw new Error('Telegram is not configured');
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: signal || AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || !data.ok) { const error = new Error('Telegram API request failed'); error.code = data.error_code; error.retryAfter = data.parameters?.retry_after; throw error; }
    return data.result;
  }
  // Every configured channel/chat must be joined. An empty list means the gate is not configured: nobody passes.
  async isMember(userId, channels) {
    const list = channels || channelsFor();
    if (!list.length) return false;
    for (const channel of list) {
      const member = await this.api('getChatMember', { chat_id: channel.chatId, user_id: userId });
      const ok = ['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member === true);
      if (!ok) return false;
    }
    return true;
  }
}
export function publicLink(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 't.me' || u.search || u.hash) return null;
    return /^\/([a-zA-Z][a-zA-Z0-9_]{4,31}|\+[A-Za-z0-9_-]{8,40})\/?$/.test(u.pathname) ? u.toString() : null;
  } catch { return null; }
}
export function normalizeChannel(input) {
  const url = publicLink(String(input?.url || '').trim());
  if (!url) return null;
  const name = new URL(url).pathname.replace(/\//g, '');
  let chatId = String(input?.chatId || '').trim();
  if (!chatId && !name.startsWith('+')) chatId = '@' + name;
  if (!/^(@[a-zA-Z][a-zA-Z0-9_]{4,31}|-100\d{5,14})$/.test(chatId)) return null;
  const title = String(input?.title || '').trim().slice(0, 60) || (name.startsWith('+') ? 'Закрытый чат' : '@' + name);
  return { chatId, url, title };
}
// Admin-configured list wins; the old single-channel env variables remain as a fallback.
export function channelsFor(store) {
  const saved = store?.channels() || [];
  if (saved.length) return saved;
  const fallback = normalizeChannel({ chatId: process.env.REQUIRED_CHANNEL_ID, url: process.env.REQUIRED_CHANNEL_URL });
  return fallback ? [fallback] : [];
}
export function configuredPrice() {
  const value = process.env.PRICE_STARS || '';
  return /^[1-9]\d{0,5}$/.test(value) ? Number(value) : null;
}
export function accessMode() { return 'one_time'; }
export function isAdmin(id) { return (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(id)); }
export function offerFor(store, now = Date.now()) {
  const value = store.settings();
  const base = Number.isInteger(value.priceStars) ? value.priceStars : configuredPrice();
  const onSale = !!(base && value.discountPercent > 0 && (!value.saleEndsAt || Date.parse(value.saleEndsAt) > now));
  return { priceStars: base ? (onSale ? Math.max(1, Math.round(base * (100 - value.discountPercent) / 100)) : base) : null, regularPriceStars: base, discountPercent: onSale ? value.discountPercent : 0, saleEndsAt: onSale ? value.saleEndsAt || null : null };
}
// Prices in every currency the shop sells in. Sale first, then promo; each step is rounded like the buyer would see it.
export function pricesFor(store, promoPercent = 0, now = Date.now()) {
  const s = store.settings(); const sale = offerFor(store, now).discountPercent || 0;
  const step = (base, digits, min) => {
    if (!(Number(base) > 0)) return null;
    const k = 10 ** digits; const cut = (v, pct) => Math.max(min, Math.round(v * (100 - pct) / 100 * k) / k);
    return cut(cut(Number(base), sale), promoPercent);
  };
  const stars = Number.isInteger(s.priceStars) ? s.priceStars : configuredPrice();
  return { stars: step(stars, 0, 1), rub: step(s.priceRub, 0, 1), usdt: step(s.priceUsdt, 2, 0.01), regular: { stars, rub: s.priceRub || null, usdt: s.priceUsdt || null }, salePercent: sale, promoPercent };
}
export function applyPromo(store, code, base, now = Date.now()) {
  const promo = store.promo(code);
  if (!promo || !promo.active) return { error: 'Промокод не найден или отключён' };
  if (promo.expires_at && Date.parse(promo.expires_at) <= now) return { error: 'Срок действия промокода закончился' };
  if (promo.max_uses && promo.used >= promo.max_uses) return { error: 'Промокод уже использован максимальное число раз' };
  return { code: promo.code, percent: promo.percent, priceStars: Math.max(1, Math.round(base * (100 - promo.percent) / 100)) };
}
export function validCheckout(store, query) {
  const order = store.order(query.invoice_payload);
  return !!(order && order.user_id === query.from?.id && query.currency === 'XTR' && query.total_amount === order.stars && Date.now() - order.created_at < 3600000);
}
