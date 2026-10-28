import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/js/markdown.js';

test('Markdown renderer escapes HTML, rejects unsafe links and foreign images', () => {
  const { html } = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://example.com) ![a](https://evil.example/p.png)\n\n![b](assets/a.png)');
  assert.equal(/<img src=x/.test(html), false);
  assert.equal(html.includes('javascript:'), false);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.equal(/<img[^>]+evil\.example/.test(html), false);
  assert.match(html, /src="\/assets\/lessons\/a\.png"/);
});
test('Markdown renderer produces code blocks with copy indexes, lists, checklists and tables', () => {
  const { html, codes } = renderMarkdown('### H\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done\n\n```text\nA < B\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
  assert.deepEqual(codes, ['A < B']);
  assert.match(html, /data-action="copy-code" data-index="0"/);
  assert.match(html, /<ol class="md-list">/); assert.match(html, /task-box is-done/); assert.match(html, /<table>/);
  assert.equal(html.includes('A < B'), false); assert.match(html, /A &lt; B/);
});
test('Lesson routes inside text stay in-app', () => {
  const { html } = renderMarkdown('[урок](#lesson?id=10)');
  assert.match(html, /href="#lesson\?id=10"/); assert.equal(html.includes('data-external'), false);
});
