// Reader protection (lessons and Base articles). Prompts and templates stay copyable on purpose — they sit in .code-panel
// blocks with a copy button. This is a deterrent, not a lock: nothing in a browser can stop a photo of the screen.
// What actually protects the course: content is served per request to paying accounts only, scraping is rate-limited,
// every delivered text carries an invisible fingerprint of the reader, and the screen carries a visible watermark.
const reading = () => document.body.classList.contains('reading');
const allowed = node => !!(node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.code-panel, input, textarea');
const insideReader = node => !!(node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.lesson-article');

function watermarkImage(label) {
  const safe = String(label).replace(/[<>&"']/g, '').slice(0, 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="190"><text x="150" y="95" transform="rotate(-24 150 95)" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="700" fill="#ffffff" fill-opacity="0.075">${safe}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export function installProtection(getUser) {
  const mark = document.createElement('div');
  mark.className = 'watermark'; mark.setAttribute('aria-hidden', 'true');
  document.body.append(mark);
  const refresh = () => { const user = getUser(); mark.style.backgroundImage = watermarkImage(user ? `${user.first_name || 'Vibentry'} · ID ${user.id}` : 'Vibentry · демо'); };
  refresh();
  window.addEventListener('hashchange', refresh);
  for (const type of ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart']) {
    document.addEventListener(type, event => {
      if (!reading()) return;
      const node = type === 'copy' || type === 'cut' ? document.getSelection()?.anchorNode : event.target;
      if (insideReader(node) && !allowed(node)) event.preventDefault();
    }, true);
  }
  document.addEventListener('keydown', event => {
    if (!reading() || !(event.ctrlKey || event.metaKey)) return;
    if (['s', 'p', 'u'].includes(event.key.toLowerCase()) && !allowed(event.target)) event.preventDefault();
  }, true);
  document.addEventListener('keyup', event => {
    if (reading() && event.key === 'PrintScreen') navigator.clipboard?.writeText('Vibentry · материалы курса защищены').catch(() => {});
  });
  window.addEventListener('beforeprint', () => document.body.classList.add('printing'));
  window.addEventListener('afterprint', () => document.body.classList.remove('printing'));
  return { refresh };
}
