// Bot logic shared by the Node polling process (server/bot.mjs) and the Cloudflare webhook (server/worker.mjs).
// No mock Telegram requests or fake payments. Tokens and update bodies are never logged.
import { FREE_LESSONS, validCheckout } from './telegram.mjs';

export function validateAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname && !['localhost', '127.0.0.1'].includes(url.hostname); } catch { return false; }
}
export function messageFor(command, appUrl, support = 'nalpax') {
  const safeSupport = /^[a-zA-Z0-9_]{5,32}$/.test(support) ? support : 'nalpax';
  if (command === '/help') return { text: 'Vibentry — практический курс по вайбкодингу.\n\nОткройте мини-приложение, подпишитесь на канал и получите первые 5 уроков бесплатно.\n\n/start — открыть курс\n/support — связаться с автором\n/paysupport — вопросы об оплате\n/reminders — напоминания об уроках', reply_markup: { inline_keyboard: [[{ text: 'Открыть Vibentry', web_app: { url: appUrl } }]] } };
  if (['/support', '/paysupport'].includes(command)) return { text: `По вопросам курса, доступа и оплаты напишите автору: @${safeSupport}.\n\nНе отправляйте никому токены бота, пароли и платёжные данные.` };
  return { text: 'Привет! Это Vibentry 🌱\n\nОт первого запроса к ИИ до своего сайта, портфолио и работы с клиентом.\n\nВнутри — 24 урока, 300 промптов и база материалов. Подпишитесь на канал и заберите первые 5 уроков бесплатно.\n\nНачните с одной маленькой страницы.', reply_markup: { inline_keyboard: [[{ text: 'Начать бесплатно →', web_app: { url: appUrl } }], [{ text: 'Написать автору', url: `https://t.me/${safeSupport}` }]] } };
}
export const BOT_COMMANDS = [{ command: 'start', description: 'Открыть курс' }, { command: 'help', description: 'Как всё устроено' }, { command: 'support', description: 'Написать автору' }, { command: 'paysupport', description: 'Вопросы об оплате' }, { command: 'id', description: 'Мой Telegram ID' }, { command: 'reminders', description: 'Напоминания об уроках' }];
// Commands and the menu button that opens the Mini App.
export async function configureBot(api, appUrl) {
  await api('setMyCommands', { commands: BOT_COMMANDS });
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Vibentry', web_app: { url: appUrl } } });
}
// One Telegram update. Access is granted only by successful_payment checked against the stored order.
export async function handleUpdate(update, { api, store, appUrl, support = process.env.SUPPORT_USERNAME, log = console.error }) {
  if (update.callback_query) {
    const { id, from, data } = update.callback_query;
    if (from?.id && (data === 'reminders:off' || data === 'reminders:on')) {
      store.setReminders(from.id, data === 'reminders:on');
      await api('answerCallbackQuery', { callback_query_id: id, text: data === 'reminders:on' ? 'Напоминания включены.' : 'Больше не напоминаем. Включить снова: /reminders' });
    } else await api('answerCallbackQuery', { callback_query_id: id });
    return;
  }
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
    else if (command === '/reminders') {
      const on = store.remindersOn(update.message.from.id);
      await api('sendMessage', { chat_id: update.message.chat.id, text: on ? 'Напоминания включены: если вы не заходили в курс 3 дня, бот один раз напомнит, на каком уроке вы остановились.' : 'Напоминания выключены.', reply_markup: { inline_keyboard: [[{ text: on ? 'Выключить напоминания' : 'Включить напоминания', callback_data: on ? 'reminders:off' : 'reminders:on' }]] } });
    }
    else await api('sendMessage', { chat_id: update.message.chat.id, ...messageFor(command, appUrl, support) });
  }
}

// One gentle reminder after 3 quiet days: only for a started, unfinished course, only for lessons the user can open,
// never twice for the same pause, not after 30 days of silence, and only in the daytime (Moscow time).
const DAY = 86400000;
export async function sendReminders({ store, api, appUrl, titles = [], now = Date.now(), limit = 30, log = console.error }) {
  const hour = new Date(now + 3 * 3600000).getUTCHours();
  if (hour < 10 || hour >= 20) return 0;
  let sent = 0;
  for (const row of store.reminderCandidates()) {
    if (sent >= limit) break;
    const active = Math.max(row.last_seen || 0, row.last_done || 0);
    if (now - active < 3 * DAY || now - active > 30 * DAY || (row.reminded_at && row.reminded_at >= active)) continue;
    const done = new Set(store.getProgress(row.id));
    const next = Array.from({ length: 24 }, (_, i) => i + 1).find(id => !done.has(id));
    if (!next || (next > FREE_LESSONS && !store.entitlement(row.id).active)) continue;
    store.markReminded(row.id, now); // even if Telegram refuses (user blocked the bot): do not retry every hour
    const number = String(next).padStart(2, '0');
    try {
      await api('sendMessage', { chat_id: row.id, text: `Вы остановились на уроке ${number}${titles[next - 1] ? ` «${titles[next - 1]}»` : ''}. Продолжим с того же места?\n\nЕсли напоминания не нужны, нажмите «Не напоминать».`, reply_markup: { inline_keyboard: [[{ text: 'Продолжить урок →', web_app: { url: `${appUrl}/#lesson?id=${next}` } }], [{ text: 'Не напоминать', callback_data: 'reminders:off' }]] } });
      sent++;
    } catch (error) { log(`Reminder not delivered (code ${Number(error.code) || 'network'}).`); }
  }
  return sent;
}
