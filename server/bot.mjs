// A real long-polling Telegram bot adapter. No mock Telegram requests or fake payments.
// Only run ONE polling instance per token. Configure secrets on your host, not in chat.
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store } from './store.mjs';
import { configureBot, handleUpdate, sendReminders, validateAppUrl } from './bot-core.mjs';
import { loadContent } from './content-node.mjs';
import { sendOffers } from './offers.mjs';
import { adminChatIds, weeklyBackup } from './backup.mjs';
import { makeApi } from './api.mjs';
import { Telegram } from './telegram.mjs';
export { messageFor, validateAppUrl } from './bot-core.mjs';

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
    await configureBot(api, appUrl);
    const store = new Store();
    console.log(`Vibentry bot @${me.username}: polling started. Telegram Stars handler enabled.`);
    // Hourly bot reminders (one message after 3 quiet days, see bot-core.mjs).
    const content = await loadContent(); const titles = content.lessons.map(l => l.title);
    const purchase = makeApi(store, new Telegram(token), content).purchaseInfo;
    const remind = () => sendReminders({ store, api, appUrl, titles }).then(() => sendOffers({ store, api, appUrl, purchase })).then(() => weeklyBackup({ store, telegram: new Telegram(token), chatIds: adminChatIds() })).catch(() => console.error('Reminders or offers failed. No tokens or user data logged.'));
    const timer = setInterval(remind, 3600000); controller.signal.addEventListener('abort', () => clearInterval(timer)); remind();
    let offset = 0;
    while (!controller.signal.aborted) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'pre_checkout_query', 'callback_query'] }, 35000);
        for (const update of updates) {
          await handleUpdate(update, { api, store, appUrl, purchase, titles });
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
