// Automatic offers from the bot to people who have not bought yet. OFF until the owner switches them on in the admin panel,
// and silent while no payment method works (a discount you cannot pay for only disappoints). Only 10:00-20:00 Moscow time.
// Every message is true: a personal one-time code that really expires after 48 hours, the exact price, and an opt-out button.
import { randomBytes } from 'node:crypto';
import { FREE_LESSONS, pricesFor } from './telegram.mjs';

const DAY = 86400000; const HOUR = 3600000;
export const OFFER_DEFAULTS = { enabled: false, ladder: [15, 30, 50] };
export const MAX_OFFER_PERCENT = 50;
export function offerSettings(store) {
  const saved = store.offerSettings();
  const ladder = Array.isArray(saved.ladder) && saved.ladder.length ? saved.ladder.map(n => Math.min(MAX_OFFER_PERCENT, Math.max(5, Math.round(Number(n) || 0)))).slice(0, 3) : OFFER_DEFAULTS.ladder;
  return { enabled: saved.enabled === true, ladder };
}
const rub = n => `${Number(n).toLocaleString('ru-RU')} ₽`;
// Moscow time is UTC+3 all year; formatted by hand so the text is the same on every runtime.
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const until = ms => { const d = new Date(ms + 3 * HOUR); const p = n => String(n).padStart(2, '0'); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const optOut = [{ text: 'Не присылать предложения', callback_data: 'offers:off' }];
function newCode(store) { for (;;) { const code = 'VIBE-' + [...randomBytes(6)].map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); if (!store.promo(code)) return code; } }

export async function sendOffers({ store, api, appUrl, purchase, now = Date.now(), limit = 30, log = console.error }) {
  const result = { offers: 0, nudges: 0, afterFree: 0 };
  const hour = new Date(now + 3 * HOUR).getUTCHours();
  if (!offerSettings(store).enabled || !purchase?.()?.ready || hour < 10 || hour >= 20) return result;
  const { ladder } = offerSettings(store);
  const regular = pricesFor(store).regular.rub; if (!regular) return result;
  const send = async (chatId, text, buttonText, url) => {
    try { await api('sendMessage', { chat_id: chatId, text, reply_markup: { inline_keyboard: [[{ text: buttonText, web_app: { url } }], optOut] } }); return true; }
    catch (error) { log(`Offer not delivered (code ${Number(error.code) || 'network'}).`); return false; }
  };
  let budget = limit;
  // 1. Less than 12 hours left on an unused personal code: one reminder.
  for (const promo of store.promosToNudge()) {
    if (budget <= 0) break;
    const ends = Date.parse(promo.expires_at);
    if (!(ends > now && ends - now <= 12 * HOUR) || !store.offersOn(promo.user_id) || store.entitlement(promo.user_id).active) continue;
    store.markNudged(promo.code);
    const price = pricesFor(store, promo.percent).rub;
    if (await send(promo.user_id, `⏳ До конца вашей скидки ${promo.percent}% осталось меньше 12 часов\n\nПолный доступ к Vibentry за ${rub(price)} вместо ${rub(regular)} — один платёж, доступ навсегда.\n\nКод ${promo.code} действует до ${until(ends)} (МСК). Потом цена снова ${rub(regular)}.`, `Купить за ${rub(price)}`, `${appUrl}/#buy?promo=${promo.code}`)) { result.nudges++; budget--; }
  }
  for (const user of store.offerCandidates()) {
    if (budget <= 0) break;
    if (now - user.last_seen > 90 * DAY) continue; // gone for good: leave them alone
    // 2. A day after the free lessons: what the full access gives, no code. Once.
    const done = store.getProgress(user.id);
    if (!user.after_free_at && Array.from({ length: FREE_LESSONS }, (_, i) => i + 1).every(id => done.includes(id))) {
      const finished = store.db.prepare('SELECT MAX(completed_at) AS at FROM progress WHERE user_id=? AND lesson_id<=?').get(user.id, FREE_LESSONS).at;
      if (now - finished >= DAY && now - finished <= 14 * DAY) {
        store.markAfterFree(user.id, now);
        if (await send(user.id, `Вы прошли бесплатную часть Vibentry 🌱\n\nДальше — сайт из нескольких страниц, дизайн по референсам, портфолио, поиск клиентов, оценка и сдача проекта. Плюс 300 промптов, база материалов и «Практикум» без ограничений.\n\nПолный доступ стоит ${rub(regular)}: платите один раз, и курс остаётся у вас навсегда. Без подписки и автосписаний.`, 'Открыть полный доступ', `${appUrl}/#buy`)) { result.afterFree++; budget--; }
        continue;
      }
    }
    // 3. Once a month: a personal code for 48 hours, the discount grows along the ladder (capped at 50%).
    if (now - user.first_seen < 3 * DAY || (user.last_offer_at && now - user.last_offer_at < 30 * DAY)) continue;
    const percent = Math.min(MAX_OFFER_PERCENT, ladder[Math.min(user.offer_count, ladder.length - 1)]);
    const code = newCode(store); const ends = now + 48 * HOUR;
    store.addPersonalPromo(code, percent, new Date(ends).toISOString(), user.id, now); store.markOffered(user.id, now);
    const price = pricesFor(store, percent).rub;
    if (await send(user.id, `🎁 Персональная скидка ${percent}% на Vibentry\n\nПолный доступ: ${rub(price)} вместо ${rub(regular)}. Один платёж — и курс ваш навсегда: 24 урока, 300 промптов, база материалов и «Практикум» без ограничений.\n\nВаш код: ${code}\nДействует 48 часов — до ${until(ends)} (МСК). Код личный и одноразовый.`, `Купить за ${rub(price)}`, `${appUrl}/#buy?promo=${code}`)) { result.offers++; budget--; }
  }
  return result;
}
