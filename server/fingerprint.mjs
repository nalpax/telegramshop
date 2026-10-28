// Invisible per-reader fingerprint. A leaked paragraph can be traced to the account that read it (scripts/trace-leak.mjs).
// Bits are written with zero-width characters: U+200B = 0, U+200C = 1, wrapped in U+2060. It is added at delivery time only;
// stored course files stay clean. Code blocks and Markdown syntax are never touched, so copied prompts and commands stay exact.
const ZERO = '​'; const ONE = '‌'; const MARK = '⁠';
export function encodeId(userId) {
  const bits = Number(userId).toString(2).padStart(40, '0');
  return MARK + [...bits].map(b => (b === '1' ? ONE : ZERO)).join('') + MARK;
}
export function decodeIds(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/⁠([​‌]{40})⁠/g)) found.add(parseInt([...m[1]].map(c => (c === ONE ? '1' : '0')).join(''), 2));
  return [...found];
}
const syntax = /^\s*(#|>|\||[-*+]\s|\d+[.)]\s|```|~~~|<|!\[|\[!|---|===|\s*$)/;
export function fingerprint(markdown, userId) {
  if (typeof markdown !== 'string' || !Number.isSafeInteger(userId)) return markdown;
  const mark = encodeId(userId); let inCode = false;
  return markdown.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { inCode = !inCode; return line; }
    if (inCode || syntax.test(line) || line.length < 60) return line;
    const cut = line.indexOf(' ', 20);
    return cut > 0 ? line.slice(0, cut) + mark + line.slice(cut) : line;
  }).join('\n');
}
