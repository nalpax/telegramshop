const KEY = 'vibentry.progress.v1';
function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return { done: [...new Set((Array.isArray(raw?.done) ? raw.done : []).filter(x => Number.isInteger(x) && x >= 1 && x <= 24))], last: Number.isInteger(raw?.last) && raw.last >= 1 && raw.last <= 24 ? raw.last : 1 };
  } catch { return { done: [], last: 1 }; }
}
export const progress = restore();
export function saveProgress() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch {} }
export function complete(id) { if (id >= 1 && id <= 24 && !progress.done.includes(id)) progress.done.push(id); progress.last = Math.min(id + 1, 24); saveProgress(); }
export function resetProgress() { progress.done = []; progress.last = 1; saveProgress(); }
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
