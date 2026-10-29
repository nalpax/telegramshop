// Fills the document pages (tariffs, terms, privacy, contacts) with the seller, support contacts and current prices from
// /api/legal. Everything is set through textContent; a missing value hides its line instead of showing a guess.
const $$ = selector => [...document.querySelectorAll(selector)];
const set = (key, value) => $$(`[data-legal="${key}"]`).forEach(node => { node.textContent = value; });
const show = (key, visible) => $$(`[data-legal-if="${key}"]`).forEach(node => node.classList.toggle('is-hidden', !visible));
const money = (value, digits = 0) => Number(value).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function current() { const page = location.pathname; $$('.doc-nav a').forEach(a => { if (a.getAttribute('href') === page) a.setAttribute('aria-current', 'page'); }); }

async function fill() {
  set('site', location.origin);
  let data;
  try { const response = await fetch('/api/legal'); if (!response.ok) throw new Error(); data = await response.json(); } catch { return; }
  const { seller, support, prices, course } = data;
  set('seller-status', seller.status);
  if (seller.name) set('seller-name', seller.name);
  if (seller.inn) set('seller-inn', seller.inn);
  show('seller-name', !!seller.name); show('seller-inn', !!seller.inn); show('seller-missing', !seller.name || !seller.inn);
  set('support-telegram', '@' + support.telegram);
  $$('[data-legal="support-telegram"]').forEach(a => { a.href = `https://t.me/${support.telegram}`; });
  if (support.email) { set('support-email', support.email); $$('[data-legal="support-email"]').forEach(a => { a.href = `mailto:${support.email}`; }); }
  show('support-email', !!support.email);
  if (support.bot) { set('bot', '@' + support.bot); $$('[data-legal="bot"]').forEach(a => { a.href = `https://t.me/${support.bot}`; }); }
  show('bot', !!support.bot);
  set('prompts', String(course.prompts || 300)); set('articles', String(course.articles || '')); set('free-lessons', String(course.freeLessons));
  show('articles', !!course.articles);
  if (prices.rub) set('price-rub', money(prices.rub));
  if (prices.stars) set('price-stars', money(prices.stars));
  show('price-rub', !!prices.rub); show('price-stars', !!prices.stars); show('price-missing', !prices.rub && !prices.stars);
  const sale = prices.salePercent > 0;
  show('sale', sale);
  if (sale) { set('sale-percent', String(prices.salePercent)); if (prices.regular.rub) set('regular-rub', money(prices.regular.rub)); show('regular-rub', !!prices.regular.rub); }
}
current();
fill();
