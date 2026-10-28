// Usage: node scripts/trace-leak.mjs < leaked-text.txt     (or pass a file path)
// Prints the Telegram user IDs whose invisible fingerprint is found in the text. Look the ID up in the admin panel (Участники).
import { readFileSync } from 'node:fs';
import { decodeIds } from '../server/fingerprint.mjs';
const text = readFileSync(process.argv[2] || 0, 'utf8');
const ids = decodeIds(text);
console.log(ids.length ? 'Найдены ID: ' + ids.join(', ') : 'Отпечатков не найдено (текст мог быть набран заново или очищен от невидимых символов).');
