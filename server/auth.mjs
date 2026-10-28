import { createHmac, timingSafeEqual } from 'node:crypto';

// Telegram's documented Mini Apps validation algorithm. Never trust initDataUnsafe.
export function validateInitData(initData, token, { now = Date.now(), maxAge = 3600 } = {}) {
  if (!token || typeof initData !== 'string' || initData.length > 16384) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const date = Number(params.get('auth_date'));
  const age = now / 1000 - date;
  if (!Number.isSafeInteger(date) || age < -30 || age > maxAge) return null;
  try {
    const user = JSON.parse(params.get('user'));
    if (!Number.isSafeInteger(user?.id) || user.id <= 0 || typeof user.first_name !== 'string') return null;
    return { id: user.id, first_name: user.first_name, ...(typeof user.last_name === 'string' ? { last_name: user.last_name } : {}), ...(typeof user.username === 'string' ? { username: user.username } : {}) };
  } catch { return null; }
}
