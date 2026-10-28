export class Telegram {
  constructor(token = process.env.BOT_TOKEN) { this.token = token; }
  async api(method, payload = {}, signal) {
    if (!this.token) throw new Error('Telegram is not configured');
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: signal || AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || !data.ok) { const error = new Error('Telegram API request failed'); error.code = data.error_code; error.retryAfter = data.parameters?.retry_after; throw error; }
    return data.result;
  }
  async isMember(userId) {
    if (!process.env.REQUIRED_CHANNEL_ID) return false;
    const member = await this.api('getChatMember', { chat_id: process.env.REQUIRED_CHANNEL_ID, user_id: userId });
    return ['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member === true);
  }
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
export function validCheckout(store, query) {
  const order = store.order(query.invoice_payload);
  return !!(order && order.user_id === query.from?.id && query.currency === 'XTR' && query.total_amount === order.stars && Date.now() - order.created_at < 3600000);
}
