// xRocket Pay — current API (checked against the OpenAPI spec at https://pay.api.xrocket.exchange/api/docs-json, 29.10.2026).
//  Auth: Authorization: Bearer <API token> (xRocket Pay → app → Settings → API Token).
//  POST {base}/api/v1/invoices  body {priceAmount:'9.99', priceCurrency:'USDT', numPayments:1, clientInvoiceId, description, expiresIn, url:{successUrl,cancelUrl}}
//    -> InvoiceDto {id, status, priceAmount, priceCurrency, clientInvoiceId, links:{telegramBotLink, telegramMiniAppLink, webLink}}
//  GET  {base}/api/v1/invoice?invoiceId=ID -> InvoiceDto; status: active | paid | partially_paid | expired | cancelled
//  Webhook body {id, timestamp, type:'invoice', data:{event:'invoice_status_changed'|'payment_status_changed', invoice: InvoiceDto}}
//    headers Signature-Timestamp (ms), Signature-Version 'v1', Signature = hex HMAC-SHA256(webhook secret, `${timestamp}.${raw body}`).
// Like the other providers the webhook is only a hint: the invoice is looked up at xRocket before access is granted.
// needsSandboxCheck stays on until a real test payment went through (handoff/LIVE_TEST_RU.md).
import { hmacHex, http, safeEqual } from './index.mjs';
export function xrocket(env, fetchImpl) {
  const base = () => (env.XROCKET_API_BASE || 'https://pay.api.xrocket.exchange').replace(/\/$/, '');
  const auth = () => ({ Authorization: `Bearer ${env.XROCKET_API_KEY || ''}` });
  const unwrap = data => (data && typeof data === 'object' && data.data && !data.id ? data.data : data);
  return {
    id: 'xrocket', title: 'Криптовалюта (xRocket)', currency: 'USDT', symbol: 'USDT', external: true, needsSandboxCheck: true,
    configured: () => !!(env.XROCKET_API_KEY && env.XROCKET_WEBHOOK_SECRET),
    async createInvoice({ order, urls = {} }) {
      const invoice = unwrap(await http(fetchImpl, base() + '/api/v1/invoices', { method: 'POST', headers: auth(), body: {
        priceAmount: order.amount.toFixed(2), priceCurrency: 'USDT', numPayments: 1, clientInvoiceId: order.id, description: 'Vibentry — полный доступ', expiresIn: 3600,
        ...(urls.success ? { url: { successUrl: urls.success, cancelUrl: urls.fail || urls.success } } : {}) } }));
      const link = invoice?.links?.telegramMiniAppLink || invoice?.links?.telegramBotLink || invoice?.links?.webLink;
      if (!invoice?.id || typeof link !== 'string') throw new Error('xRocket: unexpected response');
      return { externalId: String(invoice.id), payUrl: link };
    },
    verifyWebhook({ headers, rawBody, now = Date.now() }) {
      const secret = env.XROCKET_WEBHOOK_SECRET; const stamp = headers['signature-timestamp'];
      if (!secret || headers['signature-version'] !== 'v1' || !/^\d{10,16}$/.test(String(stamp)) || Math.abs(now - Number(stamp)) > 300000) return null;
      if (!safeEqual(headers.signature, hmacHex(secret, `${stamp}.${rawBody}`))) return null;
      let body; try { body = JSON.parse(rawBody); } catch { return null; }
      const invoice = body?.data?.invoice;
      if (body?.type !== 'invoice' || !invoice?.id) return { externalId: null, paidHint: false };
      return { externalId: String(invoice.id), paidHint: invoice.status === 'paid' };
    },
    async fetchStatus(externalId) {
      const invoice = unwrap(await http(fetchImpl, `${base()}/api/v1/invoice?invoiceId=${encodeURIComponent(externalId)}`, { headers: auth() }));
      if (!invoice?.status) return null;
      return { paid: invoice.status === 'paid', amount: Number(invoice.priceAmount), currency: invoice.priceCurrency };
    },
    // Admin system check: a cheap authenticated call (401 means the token is wrong).
    async ping() { await http(fetchImpl, `${base()}/api/v1/invoices?limit=1`, { headers: auth() }); return true; },
  };
}
