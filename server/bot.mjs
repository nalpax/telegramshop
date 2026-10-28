// A real long-polling Telegram bot adapter. No mock Telegram requests or fake payments.
// Only run ONE polling instance per token. Configure secrets on your host, not in chat.
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store } from './store.mjs';
import { validCheckout } from './telegram.mjs';

export function validateAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname && !['localhost', '127.0.0.1'].includes(url.hostname); } catch { return false; }
}
export function messageFor(command, appUrl, support = 'nalpax') {
  const safeSupport = /^[a-zA-Z0-9_]{5,32}$/.test(support) ? support : 'nalpax';
  if (command === '/help') return { text: 'Vibentry — практический курс по вайбкодингу.\n\nОткрой мини-приложение, подпишись на канал и получи первый урок бесплатно.\n\n/start — открыть курс\n/support — связаться с автором\n/paysupport — вопросы об оплате', reply_markup: { inline_keyboard: [[{ text: 'Открыть Vibentry', web_app: { url: appUrl } }]] } };
  if (['/support', '/paysupport'].includes(command)) return { text: `По вопросам курса, участия и оплаты напиши автору: @${safeSupport}.\n\nНе отправляй никому токены бота, пароли и платёжные данные.` };
  return { text: 'Привет! Это Vibentry 🌱\n\nОт первого запроса к ИИ до своего сайта, портфолио и работы с клиентом.\n\nВнутри — 24 урока, промпты и рабочие шаблоны. Подпишись на канал и забери первый урок бесплатно.\n\nНачни с одной маленькой страницы.', reply_markup: { inline_keyboard: [[{ text: 'Начать бесплатно →', web_app: { url: appUrl } }], [{ text: 'Задать вопрос автору', url: `https://t.me/${safeSupport}` }]] } };
}
async function run() {
  const token = process.env.BOT_TOKEN;
  const appUrl = process.env.APP_URL;
  if (!token || !validateAppUrl(appUrl)) { console.error('Set BOT_TOKEN and a public HTTPS APP_URL in .env before starting the bot.'); process.exitCode = 1; return; }
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  async function api(method, payload = {}, timeout = 15000) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]) });
    const data = await response.json();
    if (!response.ok || !data.ok) { const error = new Error('Telegram request failed'); error.code = data.error_code; error.retryAfter = data.parameters?.retry_after; throw error; }
    return data.result;
  }
  try {
    const me = await api('getMe');
    const webhook = await api('getWebhookInfo');
    if (webhook.url) { console.error('This bot has a webhook configured. Use its existing deployment or remove the webhook deliberately before running polling.'); process.exitCode = 1; return; }
    await api('setMyCommands', { commands: [{ command: 'start', description: 'Открыть курс' }, { command: 'help', description: 'Как всё устроено' }, { command: 'support', description: 'Написать автору' }, { command: 'paysupport', description: 'Вопросы об оплате' }, { command: 'id', description: 'Мой Telegram ID' }] });
    await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Vibentry', web_app: { url: appUrl } } });
    const store = new Store();
    console.log(`Vibentry bot @${me.username}: polling started. Telegram Stars handler enabled.`);
    let offset = 0;
    while (!controller.signal.aborted) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'pre_checkout_query'] }, 35000);
        for (const update of updates) {
          if (update.pre_checkout_query) {
            const ok = validCheckout(store, update.pre_checkout_query);
            await api('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok, ...(ok ? {} : { error_message: 'Счёт недействителен. Открой приложение и создай новый счёт.' }) });
          } else if (update.message?.refunded_payment) {
            store.refund(update.message.refunded_payment.telegram_payment_charge_id);
          } else if (update.message?.successful_payment && update.message?.from?.id) {
            const ok = store.recordPayment(update.message.from.id, update.message.successful_payment);
            if (!ok) console.error('Payment validation failed; access was not granted. Contact /paysupport.');
            else await api('sendMessage', { chat_id: update.message.chat.id, text: 'Оплата получена! Все уроки Vibentry доступны в мини-приложении.', reply_markup: { inline_keyboard: [[{ text: 'Продолжить обучение →', web_app: { url: appUrl } }]] } });
          } else if (update.message?.chat?.type === 'private' && update.message.text) {
            const command = update.message.text.split(/\s/)[0].split('@')[0];
            if (command === '/id') { await api('sendMessage', { chat_id: update.message.chat.id, text: 'Твой Telegram ID: ' + update.message.from.id }); offset = update.update_id + 1; continue; }
            await api('sendMessage', { chat_id: update.message.chat.id, ...messageFor(command, appUrl, process.env.SUPPORT_USERNAME) });
          }
          offset = update.update_id + 1;
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(`Telegram polling error (code ${Number(error.code) || 'network'}). No tokens or update bodies logged.`);
        if ([401, 409].includes(error.code)) { process.exitCode = 1; break; }
        await delay(Math.min(60000, Math.max(1000, (error.retryAfter || 4) * 1000)), undefined, { signal: controller.signal });
      }
    }
  } catch { if (!controller.signal.aborted) { console.error('Bot initialization failed. Check token, network access, TLS trust and APP_URL. Credentials are not logged.'); process.exitCode = 1; } }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
