import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ, builderPrompt, estimateText, trainers } from '../public/js/practice.js';

test('Practicum: builder makes a complete prompt and never asks the model to invent reviews or numbers', () => {
  const full = builderPrompt({ type: 'service', goal: 'lead', style: 'calm', about: 'ремонт ванных комнат', audience: 'владельцы квартир в городе', blocks: ['hero', 'services', 'prices', 'contacts'] });
  assert.match(full, /Сделай лендинг одной услуги — одну страницу/); assert.match(full, /ремонт ванных комнат/); assert.match(full, /оставить заявку/);
  assert.match(full, /1\. Первый экран[\s\S]*4\. Контакты/); assert.match(full, /ничего не выдумывай/); assert.match(full, /320 px/);
  const empty = builderPrompt({});
  assert.match(empty, /\[чем вы или заказчик занимаетесь\]/); assert.match(empty, /\[какое одно действие/);
});
test('Practicum: estimate adds the reserve and prints a ready text; no rate means no price', () => {
  const r = estimateText({ tasks: [['Бриф', 2], ['Страница', 4], ['', 3]], rate: 1000, reserve: 20 });
  assert.equal(r.hours, 9); assert.equal(Math.round(r.withReserve * 10) / 10, 10.8); assert.equal(Math.round(r.price), 10800);
  assert.match(r.text, /— Бриф: 2 ч/); assert.doesNotMatch(r.text, /— : 3/); assert.match(r.text, /Стоимость: 10\s800 ₽/u);
  assert.doesNotMatch(estimateText({ tasks: [['Бриф', 2]], rate: 0, reserve: 0 }).text, /₽/);
});
test('Practicum: every quiz question has a valid answer and an explanation; four trainers are listed', () => {
  assert.equal(QUIZ.length, 7);
  for (const q of QUIZ) { assert.ok(q.right >= 0 && q.right < q.options.length); assert.ok(q.why.length > 30); }
  assert.deepEqual(trainers.map(t => t.id), ['builder', 'quiz', 'estimate', 'handover']);
});
