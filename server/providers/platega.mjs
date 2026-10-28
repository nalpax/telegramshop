// Platega (https://platega.io) — cards, SBP and other RUB methods. Docs: docs.platega.io
//  POST {base}/transaction/process   headers X-MerchantId, X-Secret   body {paymentMethod, id, paymentDetails:{amount,currency}, description, return, failedUrl, payload}
//  -> {transactionId, redirect, status}      GET {base}/transaction/{id} -> {status: PENDING|CONFIRMED|CANCELED|...}
//  Callback: POST to your URL with the same X-MerchantId / X-Secret headers (no HMAC) and {id, amount, currency, status, payload}. Reply 200.
import { http, safeEqual } from './index.mjs';
export function platega(env, fetchImpl) {
  const base = () => (env.PLATEGA_API_BASE || 'https://app.platega.io').replace(/\/$/, '');
  const auth = () => ({ 'X-MerchantId': env.PLATEGA_MERCHANT_ID || '', 'X-Secret': env.PLATEGA_SECRET || '' });
  return {
    id: 'platega', title: 'Карта / СБП', currency: 'RUB', symbol: '₽', external: true,
    configured: () => !!(env.PLATEGA_MERCHANT_ID && env.PLATEGA_SECRET),
    async createInvoice({ order, urls }) {
      const data = await http(fetchImpl, base() + '/transaction/process', { method: 'POST', headers: auth(), body: {
        paymentMethod: Number(env.PLATEGA_PAYMENT_METHOD || 2), id: order.id, paymentDetails: { amount: order.amount, currency: 'RUB' },
        description: 'Vibentry — полный доступ', return: urls.success, failedUrl: urls.fail, payload: order.id } });
      if (!data?.transactionId || !data?.redirect) throw new Error('Platega: unexpected response');
      return { externalId: data.transactionId, payUrl: data.redirect };
    },
    verifyWebhook({ headers, rawBody }) {
      if (!safeEqual(headers['x-merchantid'], env.PLATEGA_MERCHANT_ID) || !safeEqual(headers['x-secret'], env.PLATEGA_SECRET)) return null;
      let body; try { body = JSON.parse(rawBody); } catch { return null; }
      if (typeof body?.id !== 'string') return null;
      return { externalId: body.id, paidHint: body.status === 'CONFIRMED' };
    },
    async fetchStatus(externalId) {
      const data = await http(fetchImpl, `${base()}/transaction/${encodeURIComponent(externalId)}`, { headers: auth() });
      if (!data) return null;
      return { paid: data.status === 'CONFIRMED', amount: Number(data.paymentDetails?.amount), currency: data.paymentDetails?.currency };
    },
  };
}
