// Admin panel: participants, offers & promo codes, required channels, audit log.
// Every call is re-checked on the server (ADMIN_IDS); this file only draws the screens.
import { icon } from './icons.js';
import { escape as e } from './state.js';

const TABS = [['overview', 'Обзор'], ['users', 'Участники'], ['offers', 'Акции'], ['access', 'Доступ'], ['log', 'Журнал']];
const fmtDate = ms => ms ? new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDay = ms => ms ? new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fullName = u => [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Без имени';
export const planBadge = plan => `<span class="plan-badge plan-${plan === 'pro' ? 'pro' : 'free'}">${plan === 'pro' ? 'Pro' : 'Free'}</span>`;

export function createAdmin({ sendApi, getApi, toast, modal, closeModal, config, refreshConfig, getSession }) {
  const state = { tab: 'overview', overview: null, users: null, q: '', plan: 'all', page: 0, audit: null, error: false, loading: false };
  let searchTimer;
  const root = () => document.querySelector('#admin-root');

  async function load(what) {
    state.loading = true; state.error = false;
    try {
      if (what === 'overview' || what === 'offers' || what === 'access') state.overview = await getApi('/api/admin/overview');
      if (what === 'users') state.users = await getApi(`/api/admin/users?plan=${state.plan}&page=${state.page}&q=${encodeURIComponent(state.q)}`);
      if (what === 'log') state.audit = await getApi('/api/admin/audit');
    } catch { state.error = true; }
    state.loading = false;
    paint();
  }

  function chart(stats) {
    const { joined, paid, start } = stats.daily; const w = 560; const h = 150; const pad = 22; const slot = (w - pad) / 14;
    const max = Math.max(3, ...joined, ...paid);
    const bars = joined.map((n, i) => {
      const x = pad + i * slot; const jh = Math.round(n / max * (h - 34)); const ph = Math.round(paid[i] / max * (h - 34));
      const day = new Date(start + i * 86400000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' });
      return `<g><title>${day}: новых ${n}, оплат ${paid[i]}</title><rect class="bar-join" x="${x + 2}" y="${h - 18 - jh}" width="${slot / 2 - 3}" height="${Math.max(jh, n ? 2 : 0)}" rx="3"/><rect class="bar-paid" x="${x + slot / 2}" y="${h - 18 - ph}" width="${slot / 2 - 3}" height="${Math.max(ph, paid[i] ? 2 : 0)}" rx="3"/>${i % 2 === 0 ? `<text x="${x + slot / 2}" y="${h - 3}" text-anchor="middle">${day}</text>` : ''}</g>`;
    }).join('');
    return `<svg class="admin-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Новые участники и оплаты за 14 дней"><line x1="${pad}" x2="${w}" y1="${h - 18}" y2="${h - 18}" class="axis"/><text x="0" y="12" class="axis-label">${max}</text>${bars}</svg><div class="chart-legend"><span><i class="dot dot-join"></i>Новые участники</span><span><i class="dot dot-paid"></i>Оплаты</span></div>`;
  }

  const revenueText = s => { const parts = (s.revenueBy || []).map(r => r.currency === 'XTR' ? `${r.total} ★` : r.currency === 'RUB' ? `${r.total} ₽` : `${r.total} ${r.currency}`); return parts.length ? parts.join(' · ') : '0'; };
  function overviewTab() {
    const s = state.overview.stats;
    const card = (label, value, hint = '') => `<div class="stat-card"><small>${label}</small><strong>${value}</strong>${hint ? `<span>${hint}</span>` : ''}</div>`;
    return `<div class="stat-grid">${card('Участников', s.users, `+${s.new7} за 7 дней`)}${card('Pro', s.pro, `конверсия ${s.conversion}%`)}${card('Free', s.free)}${card('Выручка', revenueText(s), s.refunds ? `возвратов: ${s.refunds}` : 'без возвратов')}</div>
    <section class="admin-card"><h2>Последние 14 дней</h2>${chart(s)}</section>
    <section class="admin-card"><h2>Сейчас в продаже</h2><p class="admin-line">${state.overview.current.priceStars ? `<strong>${state.overview.current.priceStars} ★</strong>${state.overview.current.discountPercent ? ` · скидка −${state.overview.current.discountPercent}% (обычная цена ${state.overview.current.regularPriceStars} ★)` : ' · без скидки'}` : 'Цена не задана — оплата выключена.'}</p><p class="admin-line">Для бесплатных уроков: ${state.overview.effectiveChannels.length ? state.overview.effectiveChannels.map(c => `<b>${e(c.title)}</b>`).join(', ') : '<b class="warn">каналы не заданы — приложение никого не пустит</b>'}</p></section>`;
  }

  function usersTab() {
    const data = state.users;
    const chips = [['all', 'Все'], ['free', 'Free'], ['pro', 'Pro']].map(([id, label]) => `<button class="chip ${state.plan === id ? 'is-active' : ''}" data-adm="plan" data-id="${id}">${label}</button>`).join('');
    const rows = !data ? '<p class="admin-empty">Загружаем…</p>' : data.items.length ? data.items.map(u => `<button class="user-row" data-adm="user" data-id="${u.id}"><span class="user-avatar">${e((u.firstName || '?')[0])}</span><span class="user-main"><strong>${e(fullName(u))}</strong><small>${u.username ? '@' + e(u.username) + ' · ' : ''}ID ${u.id}</small></span><span class="user-meta"><small>${u.done}/24 уроков</small><small>был ${fmtDate(u.lastSeen)}</small></span>${planBadge(u.plan)}</button>`).join('') : '<p class="admin-empty">Никого не нашли. Участники появляются здесь, когда впервые открывают приложение.</p>';
    const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
    return `<div class="admin-tools"><label class="search-box">${icon('search')}<input id="admin-search" type="search" placeholder="Имя, @username или ID" value="${e(state.q)}" autocomplete="off"></label><div class="chips">${chips}</div></div><p class="section-meta">${data ? `Найдено: ${data.total}` : ''}</p><div class="user-list">${rows}</div>${pages > 1 ? `<div class="pager"><button class="button button-secondary" data-adm="page" data-id="-1" ${state.page === 0 ? 'disabled' : ''}>Назад</button><span>${state.page + 1} / ${pages}</span><button class="button button-secondary" data-adm="page" data-id="1" ${state.page + 1 >= pages ? 'disabled' : ''}>Дальше</button></div>` : ''}`;
  }

  const dateInput = iso => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  function offersTab() {
    const o = state.overview; const promos = o.promos;
    const promoRows = promos.length ? promos.map(p => `<div class="promo-row"><div><strong>${e(p.code)}</strong><small>−${p.percent}% · использовано ${p.used}${p.max_uses ? ' из ' + p.max_uses : ''}${p.expires_at ? ' · до ' + fmtDay(Date.parse(p.expires_at)) : ''}${p.active ? '' : ' · выключен'}</small></div><button class="mini-button" data-adm="promo-toggle" data-id="${e(p.code)}">${p.active ? 'Выключить' : 'Включить'}</button><button class="mini-button danger" data-adm="promo-delete" data-id="${e(p.code)}" aria-label="Удалить промокод ${e(p.code)}">Удалить</button></div>`).join('') : '<p class="admin-empty">Промокодов пока нет.</p>';
    const providers = `<section class="admin-card"><h2>Способы оплаты</h2><p class="admin-line">Telegram Stars работают всегда, когда задана цена в Stars. Остальное включается двумя шагами: ключи в файле <b>.env</b> на сервере (в приложение они не попадают) и переключатель здесь. Способ появится у покупателя, только если для него задана цена выше.</p>${o.providers.map(p => `<div class="provider-row"><div><strong>${e(p.title)}</strong><small>${p.configured ? 'ключи найдены' : 'ключей в .env нет'} · ${p.currency}${p.needsSandboxCheck ? ' · сначала проверьте на тестовом ключе' : ''}</small><small class="mono">${e(p.webhook)}</small></div><button class="mini-button ${p.enabled ? '' : 'off'}" data-adm="provider-toggle" data-id="${p.id}" role="switch" aria-checked="${p.enabled}">${p.enabled ? 'Включён' : 'Выключен'}</button></div>`).join('')}<p class="form-hint">Адрес под названием — это webhook: вставьте его в личном кабинете провайдера. Платёж засчитывается только после проверки у самого провайдера.</p></section>`;
    return providers + `<section class="admin-card"><h2>Цена и общая скидка</h2><form id="offer-form"><label>Обычная цена в Stars<input type="number" name="priceStars" min="1" max="999999" step="1" required value="${e(o.priceStars || config.regularPriceStars || '')}" placeholder="Например, 500"></label><label>Цена в рублях (карта, СБП) — необязательно<input type="number" name="priceRub" min="1" step="1" value="${e(o.priceRub || '')}" placeholder="Например, 990"></label><label>Цена в USDT (CryptoBot, xRocket) — необязательно<input type="number" name="priceUsdt" min="0.01" step="0.01" value="${e(o.priceUsdt || '')}" placeholder="Например, 9.99"></label><label>Скидка для всех, %<input type="number" name="discountPercent" min="0" max="90" step="1" required value="${e(o.discountPercent || 0)}"></label><label>Окончание акции<input type="datetime-local" name="saleEndsAt" value="${dateInput(o.saleEndsAt)}"></label><p class="form-hint">Дата — по времени вашего устройства. Без даты скидка действует, пока вы её не уберёте. Новая цена касается новых счетов; купившие остаются с доступом.</p><button type="button" class="button button-primary" data-adm="save-offer">Сохранить цену${icon('check')}</button></form></section>
    <section class="admin-card"><h2>Промокоды</h2><p class="admin-line">Скидка по коду считается от текущей цены. Участник вводит код перед оплатой.</p><div class="promo-list">${promoRows}</div><form id="promo-form" class="promo-form"><label>Код<input name="code" maxlength="24" placeholder="START20" autocapitalize="characters" required></label><label>Скидка, %<input type="number" name="percent" min="1" max="90" required value="20"></label><label>Лимит<input type="number" name="maxUses" min="1" placeholder="Без лимита"></label><label>Действует до<input type="datetime-local" name="expiresAt"></label><button type="button" class="button button-primary" data-adm="save-promo">Добавить код${icon('check')}</button></form></section>`;
  }

  function channelRow(c, i) {
    return `<div class="channel-row" data-index="${i}"><label>Название<input name="title" maxlength="60" value="${e(c.title || '')}" placeholder="Канал Vibentry"></label><label>Ссылка для участников<input name="url" inputmode="url" value="${e(c.url || '')}" placeholder="https://t.me/vibentry"></label><label>ID или @имя чата<input name="chatId" value="${e(c.chatId || '')}" placeholder="@vibentry или -1001234567890"></label><div class="channel-actions"><button type="button" class="mini-button" data-adm="channel-check" data-id="${i}">Проверить бота</button><button type="button" class="mini-button danger" data-adm="channel-remove" data-id="${i}">Убрать</button><output class="channel-status" aria-live="polite"></output></div></div>`;
  }
  function accessTab() {
    const list = state.overview.channels; const fallback = !list.length && state.overview.effectiveChannels.length;
    return `<section class="admin-card"><h2>Подписка для бесплатных уроков</h2><p class="admin-line">Чтобы открыть бесплатные уроки 01–05, человек должен состоять во <b>всех</b> перечисленных каналах и чатах. Бот должен быть администратором в каждом — иначе Telegram не покажет, подписан ли человек. До 5 штук.</p>${fallback ? '<p class="admin-line warn">Сейчас используется канал из файла .env. Добавьте список ниже — он заменит его.</p>' : ''}<div id="channel-list">${list.map(channelRow).join('') || '<p class="admin-empty" id="channel-empty">Список пуст.</p>'}</div><div class="admin-actions"><button type="button" class="button button-secondary" data-adm="channel-add" ${list.length >= 5 ? 'disabled' : ''}>Добавить канал или чат</button><button type="button" class="button button-primary" data-adm="save-channels">Сохранить список${icon('check')}</button></div><p class="form-hint">Для публичного канала достаточно ссылки вида https://t.me/имя — ID определится сам. Для закрытого чата укажите ссылку-приглашение (https://t.me/+…) и числовой ID вида -100…. Узнать ID можно у любого бота-«ID-информера».</p></section>`;
  }

  function logTab() {
    const items = state.audit?.items || [];
    return `<section class="admin-card"><h2>Последние действия</h2>${items.length ? items.map(a => `<div class="log-row"><small>${fmtDate(a.at)}</small><span><b>${e(a.admin)}</b> · ${e(logName(a.action))}${a.detail ? ' · ' + e(a.detail) : ''}</span></div>`).join('') : '<p class="admin-empty">Пока пусто.</p>'}</section>`;
  }
  const logName = action => ({ offer: 'цена и скидка', channels: 'каналы доступа', promo: 'промокод', 'promo-delete': 'промокод удалён', provider: 'способ оплаты', 'rate-limit': 'частые запросы (похоже на парсинг)', grant: 'выдан Pro', revoke: 'Pro отозван' }[action] || action);

  function paint() {
    const box = root(); if (!box) return;
    const tabs = `<div class="admin-tabs" role="tablist">${TABS.map(([id, label]) => `<button role="tab" aria-selected="${state.tab === id}" class="${state.tab === id ? 'is-active' : ''}" data-adm="tab" data-id="${id}">${label}</button>`).join('')}</div>`;
    let body;
    if (state.error) body = '<div class="empty-state"><h2>Не загрузилось</h2><p>Проверьте соединение и попробуйте ещё раз.</p><button class="button button-secondary" data-adm="reload">Повторить</button></div>';
    else if ((state.tab === 'users' && !state.users && state.loading) || (state.tab === 'log' && !state.audit) || (['overview', 'offers', 'access'].includes(state.tab) && !state.overview)) body = '<p class="admin-empty">Загружаем…</p>';
    else body = state.tab === 'overview' ? overviewTab() : state.tab === 'users' ? usersTab() : state.tab === 'offers' ? offersTab() : state.tab === 'access' ? accessTab() : logTab();
    const keep = document.activeElement?.id === 'admin-search';
    box.innerHTML = tabs + `<div class="admin-body">${body}</div>`;
    if (keep) { const input = document.querySelector('#admin-search'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  function screen() {
    setTimeout(() => load(state.tab), 0);
    return '<section class="admin-panel"><span class="eyebrow">УПРАВЛЕНИЕ VIBENTRY</span><h1>Админ-панель</h1><p class="admin-sub">Участники, цены, промокоды и доступ к бесплатным урокам.</p><div id="admin-root"></div></section>';
  }

  async function openUser(id) {
    modal('Участник', '<div id="user-detail"><p class="admin-empty">Загружаем…</p></div>');
    try {
      const u = await getApi(`/api/admin/users/${id}`);
      const pay = u.payments.length ? u.payments.map(p => `<div class="log-row"><small>${fmtDate(p.paidAt * 1000)}</small><span>${p.manual ? 'Выдан вручную' : p.currency === 'XTR' || !p.currency ? p.stars + ' ★' : p.amount + ' ' + (p.currency === 'RUB' ? '₽' : p.currency) + ' · ' + e(p.provider)}${p.promo ? ' · код ' + e(p.promo) : ''}${p.refunded ? ' · <b class="warn">возврат</b>' : ''}</span></div>`).join('') : '<p class="admin-empty">Покупок нет.</p>';
      const body = `<div class="user-card"><span class="user-avatar big">${e((u.firstName || '?')[0])}</span><div><strong>${e(fullName(u))}</strong><small>${u.username ? '@' + e(u.username) + ' · ' : ''}ID ${u.id}</small></div>${planBadge(u.plan)}</div><dl class="user-facts"><div><dt>Впервые открыл</dt><dd>${fmtDay(u.firstSeen)}</dd></div><div><dt>Последний раз</dt><dd>${fmtDate(u.lastSeen)}</dd></div><div><dt>Пройдено</dt><dd>${u.done.length}/24</dd></div></dl><h3>Платежи</h3>${pay}<div class="admin-actions">${u.username ? `<a class="button button-secondary" href="https://t.me/${e(u.username)}" data-external>Написать${icon('send')}</a>` : ''}${u.plan === 'pro' ? `<button class="button button-secondary danger" data-adm="revoke" data-id="${u.id}">Отозвать Pro</button>` : `<button class="button button-primary" data-adm="grant" data-id="${u.id}">Выдать Pro бесплатно</button>`}</div><p class="form-hint">«Отозвать» помечает платежи участника как возвращённые. Stars деньгами это не возвращает — возврат платежа делайте через Telegram.</p>`;
      const detail = document.querySelector('#user-detail'); if (detail) { detail.innerHTML = body; document.querySelector('#modal-title').textContent = fullName(u); }
    } catch { const p = document.querySelector('#user-detail .admin-empty'); if (p) p.textContent = 'Не удалось загрузить участника.'; }
  }

  function readChannels() {
    return [...document.querySelectorAll('.channel-row')].map(row => ({ title: row.querySelector('[name=title]').value.trim(), url: row.querySelector('[name=url]').value.trim(), chatId: row.querySelector('[name=chatId]').value.trim() }));
  }
  async function saveChannels(button) {
    button.disabled = true;
    try { state.overview = await sendApi('/api/admin/channels', { channels: readChannels() }); await refreshConfig(); toast('Список каналов сохранён.'); paint(); }
    catch (error) { toast(error.message || 'Не удалось сохранить. Проверьте ссылки и ID.'); button.disabled = false; }
  }

  async function onClick(event) {
    const target = event.target.closest('[data-adm]'); if (!target || !getSession()?.isAdmin) return;
    event.preventDefault();
    const { adm: action, id } = target.dataset;
    if (action === 'tab') { state.tab = id; state.error = false; paint(); load(id); }
    else if (action === 'reload') load(state.tab);
    else if (action === 'plan') { state.plan = id; state.page = 0; state.users = null; paint(); load('users'); }
    else if (action === 'page') { state.page = Math.max(0, state.page + Number(id)); load('users'); }
    else if (action === 'user') openUser(id);
    else if (action === 'grant' || action === 'revoke') {
      if (action === 'revoke' && !target.dataset.sure) { target.dataset.sure = '1'; target.textContent = 'Точно отозвать?'; return; }
      target.disabled = true;
      try { await sendApi(`/api/admin/${action}`, { userId: Number(id) }); toast(action === 'grant' ? 'Pro выдан.' : 'Pro отозван.'); closeModal(); state.users = null; state.overview = null; load(state.tab); }
      catch { toast('Не получилось. Попробуйте ещё раз.'); target.disabled = false; }
    }
    else if (action === 'save-offer') {
      const form = document.querySelector('#offer-form'); if (!form.reportValidity()) return;
      const data = new FormData(form); const date = data.get('saleEndsAt'); target.disabled = true;
      try { await sendApi('/api/admin/offer', { priceRub: data.get('priceRub') ? Number(data.get('priceRub')) : null, priceUsdt: data.get('priceUsdt') ? Number(data.get('priceUsdt')) : null, priceStars: Number(data.get('priceStars')), discountPercent: Number(data.get('discountPercent')), saleEndsAt: date ? new Date(date).toISOString() : null }); await refreshConfig(); toast('Цена и акция сохранены.'); load('offers'); }
      catch { toast('Не удалось сохранить. Проверьте цену, скидку и дату (она должна быть в будущем).'); }
      target.disabled = false;
    }
    else if (action === 'provider-toggle') {
      const provider = state.overview.providers.find(p => p.id === id);
      try { state.overview = await sendApi('/api/admin/providers', { id, enabled: !provider.enabled }); await refreshConfig(); paint(); }
      catch (error) { toast(error.message || 'Не удалось переключить.'); }
    }
    else if (action === 'save-promo') {
      const form = document.querySelector('#promo-form'); if (!form.reportValidity()) return;
      const data = new FormData(form); const date = data.get('expiresAt'); target.disabled = true;
      try { state.overview = await sendApi('/api/admin/promos', { code: data.get('code'), percent: Number(data.get('percent')), maxUses: data.get('maxUses') ? Number(data.get('maxUses')) : null, expiresAt: date ? new Date(date).toISOString() : null }); toast('Промокод сохранён.'); paint(); }
      catch (error) { toast(error.message || 'Код: 3–24 символа A–Z, 0–9, _ или -.'); target.disabled = false; }
    }
    else if (action === 'promo-delete' || action === 'promo-toggle') {
      const promo = state.overview.promos.find(p => p.code === id); if (!promo) return;
      try { state.overview = await sendApi('/api/admin/promos', action === 'promo-delete' ? { code: id, remove: true } : { code: id, percent: promo.percent, maxUses: promo.max_uses, expiresAt: promo.expires_at, active: !promo.active }); paint(); }
      catch (error) { toast(error.message || 'Не удалось изменить промокод.'); }
    }
    else if (action === 'channel-add') {
      state.overview.channels = [...readChannels(), { title: '', url: '', chatId: '' }]; paint();
    }
    else if (action === 'channel-remove') { const list = readChannels(); list.splice(Number(id), 1); state.overview.channels = list; paint(); }
    else if (action === 'save-channels') saveChannels(target);
    else if (action === 'channel-check') {
      const row = target.closest('.channel-row'); const status = row.querySelector('.channel-status'); status.textContent = 'Проверяем…';
      const c = readChannels()[Number(id)];
      try { const r = await sendApi('/api/admin/channels/check', c); status.textContent = r.ok ? '✓ Бот — администратор, всё в порядке' : r.status === 'unreachable' ? '✕ Бот не видит этот чат. Добавьте его и сделайте администратором.' : '✕ Бот есть в чате, но не администратор.'; }
      catch (error) { status.textContent = '✕ ' + (error.message || 'Проверьте ссылку и ID.'); }
    }
  }
  document.addEventListener('click', onClick);
  document.addEventListener('input', event => {
    if (event.target.id !== 'admin-search') return;
    clearTimeout(searchTimer); const value = event.target.value;
    searchTimer = setTimeout(() => { state.q = value.trim(); state.page = 0; load('users'); }, 300);
  });
  return { screen };
}
