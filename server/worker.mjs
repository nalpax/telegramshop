// Cloudflare Workers entry (deployed by scripts/deploy-cloudflare.mjs). One Durable Object holds the SQLite database,
// so payments, progress and limits are handled in one place, like the single Node process.
// ./content-bundle.mjs (from data/) and ./public-bundle.mjs (public/ files) are generated at deploy time, never written to disk or committed.
import { DurableObject } from 'cloudflare:workers';
import { StoreCore } from './store-core.mjs';
import { durableSql } from './durable-sql.mjs';
import { Telegram } from './telegram.mjs';
import { isAppRoute, makeWorkerApp, serveAsset, withSecurityHeaders } from './worker-app.mjs';
import content from './content-bundle.mjs';
import files from './public-bundle.mjs';

export class VibentryApp extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // telegram.mjs, api.mjs and providers read process.env, as on a Node server.
    for (const [key, value] of Object.entries(env)) if (typeof value === 'string') process.env[key] = value;
    this.handle = makeWorkerApp({ store: new StoreCore(durableSql(ctx.storage.sql)), telegram: new Telegram(env.BOT_TOKEN), content, env });
  }
  async fetch(request) {
    // Hourly alarm for bot reminders; scheduled once per object start if none is pending.
    if (!this.alarmChecked) { this.alarmChecked = true; try { if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60000); } catch {} }
    return this.handle(request);
  }
  async alarm() {
    try { await this.handle.reminders(); } finally { await this.ctx.storage.setAlarm(Date.now() + 3600000); }
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (isAppRoute(pathname)) return withSecurityHeaders(await env.APP.get(env.APP.idFromName('main')).fetch(request));
    if (!['GET', 'HEAD'].includes(request.method)) return withSecurityHeaders(Response.json({ error: 'Method not allowed' }, { status: 405 }));
    return serveAsset(files, request);
  },
};
