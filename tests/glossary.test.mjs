import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, TERMS, termRegex } from '../public/js/glossary.js';

test('Glossary: unique ids, known groups, short plain definitions; every term finds its own name', () => {
  assert.equal(new Set(TERMS.map(t => t.id)).size, TERMS.length);
  const groups = new Set(GROUPS.map(([id]) => id));
  for (const t of TERMS) {
    assert.ok(groups.has(t.group), t.id); assert.ok(t.text.length > 30 && t.text.length < 320, t.id);
    assert.ok(termRegex(t).test(t.title.replace(/\s*\(.*\)/, '')), `${t.id} finds «${t.title}»`);
  }
});
test('Glossary: word forms and boundaries', () => {
  const re = id => termRegex(TERMS.find(t => t.id === id));
  for (const [id, yes, no] of [
    ['commit', ['Сделайте коммит', 'после коммита', 'два коммита'], ['коммуникация']],
    ['git', ['Git хранит историю', 'установите git'], ['GitHub', 'гитара']],
    ['github', ['на GitHub', 'GitHub Pages'], []],
    ['uxui', ['удобный UX', 'UI кнопок'], ['build', 'guide', 'ux-тексты']],
    ['domain', ['свой домен', 'домена', 'к домену'], []],
    ['api', ['через API бота'], ['rapid']],
    ['agent', ['ИИ-агент правит', 'агенту'], ['агентство']],
    ['repo', ['репозиторий', 'в репозитории'], []],
  ]) {
    for (const text of yes) assert.ok(re(id).test(text), `${id}: «${text}»`);
    for (const text of no) assert.equal(re(id).test(text), false, `${id} must not match «${text}»`);
  }
});
