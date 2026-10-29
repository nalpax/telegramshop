// Database backup through the bot: a JSON file with every table, sent as a protected document (cannot be forwarded) to
// admins only. It contains participants' personal data. Weekly automatic copy plus a button in the admin panel.
// Restore on a server: node scripts/restore-backup.mjs <file> [database path]. On Cloudflare the Durable Object
// additionally keeps 30 days of point-in-time history.
const HOUR = 3600000; const WEEK = 7 * 24 * HOUR;
export async function sendBackup({ store, telegram, chatIds, now = Date.now() }) {
  const backup = store.dump(now); const text = JSON.stringify(backup);
  const name = `vibentry-backup-${backup.createdAt.slice(0, 10)}.json`;
  const caption = `Резервная копия базы Vibentry от ${backup.createdAt.slice(0, 10)}: участников ${backup.tables.users.length}, оплат ${backup.tables.payments.length}. В файле личные данные участников — храните его в надёжном месте и никому не пересылайте.`;
  for (const chat of chatIds) {
    const form = new FormData();
    form.append('chat_id', String(chat)); form.append('caption', caption); form.append('protect_content', 'true');
    form.append('document', new File([text], name, { type: 'application/json' }));
    await telegram.upload('sendDocument', form);
  }
  return backup;
}
// At most once a week, 10:00-20:00 Moscow time, to every admin.
export async function weeklyBackup({ store, telegram, chatIds, now = Date.now() }) {
  const hour = new Date(now + 3 * HOUR).getUTCHours();
  if (!chatIds.length || hour < 10 || hour >= 20 || now - store.lastBackupAt() < WEEK) return false;
  await sendBackup({ store, telegram, chatIds, now });
  store.setLastBackupAt(now);
  return true;
}
export const adminChatIds = () => (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(id => Number.isSafeInteger(id) && id > 0);
