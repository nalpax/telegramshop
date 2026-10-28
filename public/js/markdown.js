// Small, dependency-free Markdown renderer for course text.
// Everything is HTML-escaped first; only a fixed set of tags is produced.
// Links must be https (or t.me / #route), images only from /assets/.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function safeHref(url) {
  const value = String(url).trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(value)) return value;
  if (/^#[a-z0-9?=&_-]*$/i.test(value)) return value;
  return null;
}
export function inline(text) {
  const parts = [];
  const hold = html => `\u0000${parts.push(html) - 1}\u0000`;
  let s = String(text ?? '');
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    const href = safeHref(url);
    if (!href) return label;
    const external = href.startsWith('https://');
    return hold(`<a href="${esc(href)}" ${external ? 'data-external="1" rel="noopener noreferrer"' : ''}>${esc(label)}</a>`);
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(«"])\*([^*\s][^*]*?)\*(?=[\s).,;:!?»"]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)]);
}
function image(line) {
  const m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
  if (!m) return null;
  const src = m[2].replace(/^\.?\/?assets\//, '/assets/lessons/');
  if (!/^\/assets\/lessons\/[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(src)) return '';
  return `<figure><img src="${esc(src)}" alt="${esc(m[1])}" loading="lazy" decoding="async"><figcaption>${inline(m[1])}</figcaption></figure>`;
}
function listItems(lines, start) {
  const items = []; let i = start; const ordered = /^\d+\.\s/.test(lines[start]);
  const marker = ordered ? /^\d+\.\s+(.*)$/ : /^[-*]\s+(.*)$/;
  while (i < lines.length) {
    const m = lines[i].match(marker);
    if (!m) break;
    let text = m[1]; i++;
    const nested = [];
    while (i < lines.length && /^\s{2,}\S/.test(lines[i])) { nested.push(lines[i].trim()); i++; }
    items.push({ text, nested });
  }
  return { items, ordered, next: i };
}
function renderList({ items, ordered }) {
  const tag = ordered ? 'ol' : 'ul';
  const body = items.map(({ text, nested }) => {
    const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
    const content = task ? `<span class="task-box ${task[1] === ' ' ? '' : 'is-done'}" aria-hidden="true"></span><span>${inline(task[2])}</span>` : inline(text);
    const sub = nested.length ? `<span class="li-more">${nested.map(inline).join('<br>')}</span>` : '';
    return `<li class="${task ? 'task-item' : ''}">${content}${sub}</li>`;
  }).join('');
  return `<${tag} class="md-list">${body}</${tag}>`;
}
function renderTable(rows) {
  const cells = row => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const head = cells(rows[0]); const body = rows.slice(2).map(cells);
  return `<div class="md-table"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map((c, k) => `<td data-label="${esc(head[k] || '')}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
// Returns { html, codes } where codes holds fenced code blocks (index used by the copy button).
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; const codes = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^<!--/.test(line.trim())) { while (i < lines.length && !/-->/.test(lines[i])) i++; i++; continue; }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const code = buf.join('\n').replace(/\s+$/, '');
      const kind = fence[1] || 'text';
      const label = kind === 'text' || kind === 'txt' ? 'Промпт' : kind.toUpperCase();
      codes.push(code);
      out.push(`<div class="code-panel"><div class="code-toolbar"><span>${esc(label)}</span><button type="button" data-action="copy-code" data-index="${codes.length - 1}"><span class="copy-label">Копировать</span></button></div><pre><code>${esc(code)}</code></pre></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { const level = Math.min(4, Math.max(2, heading[1].length)); out.push(`<h${level} class="md-h${heading[1].length}">${inline(heading[2])}</h${level}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    const img = image(line.trim());
    if (img !== null) { out.push(img); i++; continue; }
    if (/^>\s?/.test(line)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`); continue; }
    if (/^\|/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); out.push(renderTable(rows)); continue; }
    if (/^([-*]|\d+\.)\s/.test(line)) { const list = listItems(lines, i); out.push(renderList(list)); i = list.next; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\||([-*]|\d+\.)\s|!\[)/.test(lines[i])) buf.push(lines[i++].trim());
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`); else i++;
  }
  return { html: out.join('\n'), codes };
}
