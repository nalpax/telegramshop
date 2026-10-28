// Bot logic shared by the Node polling process (server/bot.mjs) and the Cloudflare webhook (server/worker.mjs).
// No mock Telegram requests or fake payments. Tokens and update bodies are never logged.
import { validCheckout } from './telegram.mjs';

export function validateAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname && !['localhost', '127.0.0.1'].includes(url.hostname); } catch { return false; }
}
export function messageFor(command, appUrl, support = 'nalpax') {
  const safeSupport = /^[a-zA-Z0-9_]{5,32}$/.test(support) ? support : 'nalpax';
  if (command === '/help') return { text: 'Vibentry — практический курс по вайбкодингу.\n\nОткройте мини-приложение, подпишитесь на канал и получите первые 5 уроков бесплатно.\n\n/start — открыть курс\n/support — связаться с автором\n/paysupport — вопросы об оплате', reply_markup: { inline_keyboard: [[{ text: 'Открыть Vibentry', web_app: { url: appUrl } }]] } };
  if (['/support', '/paysupport'].includes(command)) return { text: `По вопросам курса, доступа и оплаты напишите автору: @${safeSupport}.\n\nНе отправляйте никому токены бота, пароли и платёжные данные.` };
  return { text: 'Привет! Это Vibentry 🌱\n\nОт первого запроса к ИИ до своего сайта, портфолио и работы с клиентом.\n\nВнутри — 24 урока, 300 промптов и база материалов. Подпишитесь на канал и заберите первые 5 уроков бесплатно.\n\nНачните с одной маленькой страницы.', reply_markup: { inline_keyboard: [[{ text: 'Начать бесплатно →', web_app: { url: appUrl } }], [{ text: 'Написать автору', url: `https://t.me/${safeSupport}` }]] } };
}
export const BOT_COMMANDS = [{ command: 'start', description: 'Открыть курс' }, { command: 'help', description: 'Как всё устроено' }, { command: 'support', description: 'Написать автору' }, { command: 'paysupport', description: 'Вопросы об оплате' }, { command: 'id', description: 'Мой Telegram ID' }];
// Commands and the menu button that opens the Mini App.
export async function configureBot(api, appUrl) {
  await api('setMyCommands', { commands: BOT_COMMANDS });
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Vibentry', web_app: { url: appUrl } } });
}
// One Telegram update. Access is granted only by successful_payment checked against the stored order.
export async function handleUpdate(update, { api, store, appUrl, support = process.env.SUPPORT_USERNAME, log = console.error }) {
  if (update.pre_checkout_query) {
    const ok = validCheckout(store, update.pre_checkout_query);
    await api('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok, ...(ok ? {} : { error_message: 'Счёт недействителен. Откройте приложение и создайте новый счёт.' }) });
  } else if (update.message?.refunded_payment) {
    store.refund(update.message.refunded_payment.telegram_payment_charge_id);
  } else if (update.message?.successful_payment && update.message?.from?.id) {
    const ok = store.recordPayment(update.message.from.id, update.message.successful_payment);
    if (!ok) {
      log('Payment validation failed; access was not granted. Check the order and /paysupport.');
      // The buyer must never be left without an answer after paying.
      await api('sendMessage', { chat_id: update.message.chat.id, text: 'Платёж получен, но доступ не открылся автоматически. Не оплачивайте ещё раз: напишите автору через /paysupport, мы разберёмся.' }).catch(() => {});
    }
    else await api('sendMessage', { chat_id: update.message.chat.id, text: 'Оплата получена, спасибо! Все уроки, промпты и база материалов открыты в мини-приложении.', reply_markup: { inline_keyboard: [[{ text: 'Продолжить обучение →', web_app: { url: appUrl } }]] } });
  } else if (update.message?.chat?.type === 'private' && update.message.text) {
    const command = update.message.text.split(/\s/)[0].split('@')[0];
    if (command === '/id') await api('sendMessage', { chat_id: update.message.chat.id, text: 'Ваш Telegram ID: ' + update.message.from.id });
    else await api('sendMessage', { chat_id: update.message.chat.id, ...messageFor(command, appUrl, support) });
  }
}
