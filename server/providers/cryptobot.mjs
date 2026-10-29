// CryptoBot / Crypto Pay (https://help.send.tg/en/articles/10279948-crypto-pay-api)
//  POST {base}/createInvoice   header Crypto-Pay-API-Token   body {currency_type:'crypto', asset:'USDT', amount:'9.99', payload, expires_in, paid_btn_name, paid_btn_url, allow_comments}
//  -> {ok:true, result:{invoice_id, status, bot_invoice_url, mini_app_invoice_url, amount, asset}}
//  GET  {base}/getInvoices?invoice_ids=ID -> result.items[0].status 'active'|'paid'|'expired'
//  Webhook: header crypto-pay-api-signature = hex HMAC-SHA256(key = SHA256(token), data = raw body); update_type 'invoice_paid'.
//  Testnet: set CRYPTOBOT_API_BASE to the testnet base from @CryptoTestnetBot.
import { hmacHex, http, safeEqual, sha256 } from './index.mjs';
export function cryptobot(env, fetchImpl) {
  const base = () => (env.CRYPTOBOT_API_BASE || 'https://pay.crypt.bot/api').replace(/\/$/, '');
  const auth = () => ({ 'Crypto-Pay-API-Token': env.CRYPTOBOT_TOKEN || '' });
  return {
    id: 'cryptobot', title: 'Криптовалюта (CryptoBot)', currency: 'USDT', symbol: 'USDT', external: true,
    configured: () => !!env.CRYPTOBOT_TOKEN,
    async createInvoice({ order }) {
      const botName = String(env.BOT_USERNAME || '').replace(/^@/, '');
      const data = await http(fetchImpl, base() + '/createInvoice', { method: 'POST', headers: auth(), body: {
        currency_type: 'crypto', asset: 'USDT', amount: order.amount.toFixed(2), description: 'Vibentry — полный доступ', payload: order.id, expires_in: 3600, allow_comments: false,
        ...(botName ? { paid_btn_name: 'openBot', paid_btn_url: `https://t.me/${botName}` } : {}) } });
      const invoice = data?.ok ? data.result : null;
      const payUrl = invoice?.mini_app_invoice_url || invoice?.bot_invoice_url;
      if (!invoice?.invoice_id || !payUrl) throw new Error('CryptoBot: unexpected response');
      return { externalId: String(invoice.invoice_id), payUrl };
    },
    verifyWebhook({ headers, rawBody }) {
      if (!env.CRYPTOBOT_TOKEN || !safeEqual(headers['crypto-pay-api-signature'], hmacHex(sha256(env.CRYPTOBOT_TOKEN), rawBody))) return null;
      let body; try { body = JSON.parse(rawBody); } catch { return null; }
      const id = body?.payload?.invoice_id;
      if (body?.update_type !== 'invoice_paid' || id === undefined) return { externalId: null, paidHint: false };
      return { externalId: String(id), paidHint: true };
    },
    // Used by the admin system check: confirms the token is accepted.
    async ping() { const data = await http(fetchImpl, base() + '/getMe', { headers: auth() }); if (!data?.ok) throw new Error('CryptoBot: token not accepted'); return true; },
    async fetchStatus(externalId) {
      const data = await http(fetchImpl, `${base()}/getInvoices?invoice_ids=${encodeURIComponent(externalId)}`, { headers: auth() });
      const invoice = data?.ok ? data.result?.items?.[0] : null;
      if (!invoice) return null;
      return { paid: invoice.status === 'paid', amount: Number(invoice.amount), currency: invoice.asset };
    },
  };
}
