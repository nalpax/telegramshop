// Shared by the Node server (index.mjs) and the Cloudflare worker (worker-app.mjs) so both send the same headers.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Do not set X-Frame-Options: Telegram Web embeds the Mini App in an iframe.
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://*.t.me",
};
export const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
export function json(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
export async function body(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 20000) { const error = new Error('Payload too large'); error.status = 413; throw error; } chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
export const errorStatus = error => (error.code === 'ENOENT' ? 404 : error.status || (error instanceof SyntaxError || error instanceof URIError ? 400 : 500));
