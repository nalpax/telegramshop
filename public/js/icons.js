const shapes = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h8"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M15 7V3H4v14h4"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
  sparkle: '<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4zM11 13 22 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.file}</svg>`;
}
export function art(kind) {
  const id = `ceramic-${kind}`;
  const paths = {
    book: '<path d="M22 22Q41 15 59 25L57 77Q39 67 21 74Z"/><path d="M59 25Q77 15 95 21L91 72Q74 68 57 77Z"/><path d="M27 27Q42 22 53 28M26 36Q40 31 52 36M65 29Q79 22 88 26M64 38Q77 31 87 35" fill="none" stroke="#798d62" stroke-width="1.4"/>',
    prompts: '<path d="M42 19c-12 0-15 6-15 17v8c0 7-3 10-10 11 7 1 10 5 10 12v7c0 11 3 17 15 17v-9c-5 0-6-2-6-9v-8c0-5-2-8-7-10 5-2 7-5 7-10v-9c0-6 1-8 6-8zM70 19c12 0 15 6 15 17v8c0 7 3 10 10 11-7 1-10 5-10 12v7c0 11-3 17-15 17v-9c5 0 6-2 6-9v-8c0-5 2-8 7-10-5-2-7-5-7-10v-9c0-6-1-8-6-8z"/>',
    files: '<path d="m35 17 49 10-4 66-49-11z" opacity=".5"/><path d="m27 23 49 10-4 66-49-11z" opacity=".7"/><path d="m21 17 49 10-4 66-49-11z"/><path d="m31 35 27 6m-28 7 27 6m-28 7 21 5" fill="none" stroke="#788960" stroke-width="2.5"/>',
    plane: '<path d="m15 45 86-29-26 79-19-29-20 9 6-22z"/><path d="m42 53 59-37-45 50 19 29" fill="none" stroke="#8b9d6c" stroke-width="1.5"/>',
    // Module covers: a browser window, a palette, a briefcase, a stack of coins.
    browser: '<rect x="14" y="22" width="84" height="64" rx="10"/><path d="M14 38h84" fill="none" stroke="#798d62" stroke-width="2"/><circle cx="25" cy="30" r="3" fill="#798d62" stroke="none"/><circle cx="34" cy="30" r="3" fill="#798d62" stroke="none"/><path d="M26 52h40M26 62h30M26 72h18" fill="none" stroke="#798d62" stroke-width="3.5" stroke-linecap="round"/>',
    palette: '<path d="M56 16C32 16 14 33 14 55s17 41 38 41c7 0 10-4 10-9 0-6-5-8-5-13 0-4 3-7 8-7h10c13 0 23-9 23-22C98 28 79 16 56 16z"/><circle cx="36" cy="48" r="6" fill="#798d62" stroke="none"/><circle cx="50" cy="32" r="6" fill="#9caa7a" stroke="none"/><circle cx="70" cy="32" r="6" fill="#798d62" stroke="none"/><circle cx="82" cy="48" r="5" fill="#9caa7a" stroke="none"/>',
    briefcase: '<path d="M42 30v-6a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v6" fill="none" stroke="#e8dfc1" stroke-width="6"/><rect x="14" y="30" width="84" height="58" rx="10"/><path d="M14 54h84" fill="none" stroke="#798d62" stroke-width="2"/><rect x="48" y="48" width="16" height="12" rx="3" fill="#9caa7a"/>',
    coins: '<ellipse cx="56" cy="80" rx="34" ry="10"/><path d="M22 80V66m68 14V66" fill="none"/><ellipse cx="56" cy="66" rx="34" ry="10"/><ellipse cx="56" cy="52" rx="34" ry="10"/><ellipse cx="56" cy="38" rx="34" ry="10"/><path d="M44 38h24" fill="none" stroke="#798d62" stroke-width="3" stroke-linecap="round"/>',
  };
  return `<svg class="tile-art" viewBox="0 0 112 112" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fffbed"/><stop offset=".48" stop-color="#e8dfc1"/><stop offset="1" stop-color="#9caa7a"/></linearGradient></defs><g fill="url(#${id})" stroke="#f6f0dc" stroke-width="1.1" stroke-linejoin="round">${paths[kind] || paths.files}</g></svg>`;
}
