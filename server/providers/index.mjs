// Payment providers beyond Telegram Stars. Telegram Stars stay in api.mjs/bot.mjs because Telegram requires them for digital goods
// sold inside Telegram; these providers are optional extras and OFF until configured in .env AND switched on in the admin panel.
//
// Common contract (every provider returns this shape):
//   id, title, currency            — what the buyer sees
//   configured()                   — are the .env credentials present?
//   createInvoice({order, urls})   — -> { externalId, payUrl }
//   verifyWebhook({headers, rawBody}) — -> { externalId, paidHint } | null   (null = signature invalid)
//   fetchStatus(externalId)        — -> { paid, amount, currency } | null    (authoritative lookup at the provider)
//
// A webhook is only ever a HINT. Access is granted after the server asks the provider itself (fetchStatus) and the amount/currency
// match the order. Providers that cannot be looked up (xRocket, see its file) fall back to the verified signature.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { platega } from './platega.mjs';
import { cryptobot } from './cryptobot.mjs';
import { xrocket } from './xrocket.mjs';

export const safeEqual = (a, b) => { const x = Buffer.from(String(a ?? '')); const y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };
export const hmacHex = (key, data) => createHmac('sha256', key).update(data).digest('hex');
export const sha256 = data => createHash('sha256').update(data).digest();

export async function http(fetchImpl, url, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetchImpl(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch {}
  if (!response.ok) { const error = new Error('Provider request failed'); error.status = response.status; throw error; }
  return data;
}

export function makeProviders(env = process.env, fetchImpl = fetch) {
  const list = [platega(env, fetchImpl), cryptobot(env, fetchImpl), xrocket(env, fetchImpl)];
  return { list, get: id => list.find(p => p.id === id) || null };
}
