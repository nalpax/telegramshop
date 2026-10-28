// xRocket Pay (https://docs.xrocket.exchange/api/pay) — NEW API: base https://pay.api.xrocket.exchange, POST /api/v1/invoices, Bearer token.
// Webhook signature (documented): header `Signature` = hex HMAC-SHA256(webhook secret, `${Signature-Timestamp}.${raw body}`), Signature-Version 'v1',
// timestamp in ms, reject if older than 5 minutes. The webhook secret is NOT the API token.
//
// UNVERIFIED: the public docs we could read did not show the exact invoice request/response field names or a single-invoice lookup.
// The names below follow the older xRocket API (amount, currency, description, payload, expiredIn, numPayments; response id + link).
// Parsing is tolerant, but test with a real key in xRocket's testnet (XROCKET_API_BASE) BEFORE you switch this provider on.
// Without a lookup we trust only a correctly signed webhook whose payload (our order id) and amount match the order.
import { hmacHex, http, safeEqual } from './index.mjs';
export function xrocket(env, fetchImpl) {
  const base = () => (env.XROCKET_API_BASE || 'https://pay.api.xrocket.exchange').replace(/\/$/, '');
  const auth = () => ({ Authorization: `Bearer ${env.XROCKET_API_KEY || ''}` });
  const dig = (obj, ...keys) => { for (const k of keys) { const v = k.split('.').reduce((o, p) => o?.[p], obj); if (v !== undefined && v !== null) return v; } return undefined; };
  return {
    id: 'xrocket', title: 'Криптовалюта (xRocket)', currency: 'USDT', symbol: 'USDT', external: true, needsSandboxCheck: true,
    configured: () => !!(env.XROCKET_API_KEY && env.XROCKET_WEBHOOK_SECRET),
    async createInvoice({ order }) {
      const data = await http(fetchImpl, base() + '/api/v1/invoices', { method: 'POST', headers: auth(), body: {
        amount: order.amount, currency: 'USDT', description: 'Vibentry — полный доступ', payload: order.id, clientInvoiceId: order.id, numPayments: 1, expiredIn: 3600 } });
      const id = dig(data, 'data.id', 'id'); const link = dig(data, 'data.link', 'link');
      if (!id || typeof link !== 'string') throw new Error('xRocket: unexpected response');
      return { externalId: String(id), payUrl: link };
    },
    verifyWebhook({ headers, rawBody, now = Date.now() }) {
      const secret = env.XROCKET_WEBHOOK_SECRET; const stamp = headers['signature-timestamp'];
      if (!secret || headers['signature-version'] !== 'v1' || !/^\d{10,16}$/.test(String(stamp)) || Math.abs(now - Number(stamp)) > 300000) return null;
      if (!safeEqual(headers.signature, hmacHex(secret, `${stamp}.${rawBody}`))) return null;
      let body; try { body = JSON.parse(rawBody); } catch { return null; }
      const id = dig(body, 'data.id', 'invoice.id', 'id'); const status = String(dig(body, 'data.status', 'status') ?? ''); const type = String(dig(body, 'type', 'event', 'eventType') ?? '');
      return { externalId: id === undefined ? null : String(id), paidHint: /paid/i.test(status) || /paid/i.test(type), claimed: { amount: Number(dig(body, 'data.amount', 'amount')), currency: dig(body, 'data.currency', 'currency'), payload: dig(body, 'data.payload', 'payload') } };
    },
    // No documented single-invoice lookup: try the conventional path, and report "unknown" (null) if it does not answer as expected.
    async fetchStatus(externalId) {
      try {
        const data = await http(fetchImpl, `${base()}/api/v1/invoices/${encodeURIComponent(externalId)}`, { headers: auth() });
        const status = String(dig(data, 'data.status', 'status') ?? ''); if (!status) return null;
        return { paid: /paid/i.test(status), amount: Number(dig(data, 'data.amount', 'amount')), currency: dig(data, 'data.currency', 'currency') };
      } catch { return null; }
    },
  };
}
