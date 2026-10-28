"""Optional UI smoke test. Requires Python Playwright + Chromium; not an app dependency."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
out = Path('artifacts'); out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width, height in [(390, 844), (320, 740), (1280, 900)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1)
        page = context.new_page(); errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://telegram.org/**', lambda route: route.abort())
        page.goto(BASE_URL, wait_until='networkidle')
        page.get_by_text('Большие проекты').wait_for()
        page.screenshot(path=str(out / f'gate-{width}.png'), full_page=True)
        page.get_by_role('button', name='Посмотреть дизайн в демо-режиме').click()
        page.get_by_role('button', name='Начать бесплатно').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
        page.screenshot(path=str(out / f'home-{width}.png'), full_page=True)
        page.get_by_role('button', name='Начать бесплатно').click()
        page.get_by_role('checkbox').wait_for()
        assert page.get_by_role('button', name='Завершить урок').is_disabled()
        assert len(page.locator('.article-body').inner_text()) > 1000, 'Actual course text must be loaded'
        page.screenshot(path=str(out / f'lesson-{width}.png'), full_page=True)
        page.get_by_role('checkbox').check()
        page.get_by_role('button', name='Завершить урок').click()
        page.get_by_text('Пройдено 1 из 24 уроков').wait_for()
        page.get_by_role('link', name='Материалы', exact=True).click()
        page.locator('[data-action="lesson"][data-id="2"]').click()
        page.get_by_role('dialog').wait_for()
        assert page.get_by_role('button', name='Покупка пока недоступна').is_disabled()
        page.keyboard.press('Escape')
        page.get_by_role('searchbox').fill('клиент')
        assert page.locator('.lesson-row').count() > 0
        page.get_by_role('searchbox').fill('zzzzzzzzz')
        page.get_by_text('Пока ничего не нашлось').wait_for()
        page.get_by_role('searchbox').fill('')
        page.get_by_role('link', name='Промпты', exact=True).click()
        page.locator('.resource-card').first.wait_for()
        assert page.locator('.resource-card').count() > 0
        page.get_by_role('link', name='Профиль', exact=True).click()
        page.get_by_text('Демо: прогресс сохраняется на этом устройстве.').wait_for()
        assert not errors, errors
        context.close()
    # Admin and checkout UI fixtures only. These do not replace server authorization tests.
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    page.route('https://telegram.org/**', lambda r: r.fulfill(content_type='text/javascript', body='window.Telegram={WebApp:{initData:"ui-fixture",ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},BackButton:{onClick(){},show(){},hide(){}},openInvoice(url,cb){cb("cancelled")}}};'))
    configuration = {'supportUsername': 'nalpax', 'requiredChannelUrl': 'https://t.me/examplechannel', 'priceStars': 500, 'regularPriceStars': 500, 'discountPercent': 0, 'accessMode': 'one_time', 'paymentsEnabled': True, 'preview': False}
    page.route('**/api/config', lambda r: r.fulfill(json=configuration))
    page.route('**/api/session', lambda r: r.fulfill(json={'user': {'id': 424242, 'first_name': 'Владелец'}, 'subscribed': True, 'access': {'active': False, 'expiresAt': None}, 'done': [], 'isAdmin': True}))
    def offer_save(route):
        payload = route.request.post_data_json
        assert payload['priceStars'] == 750 and payload['discountPercent'] == 20
        configuration.update({'priceStars': 600, 'regularPriceStars': 750, 'discountPercent': 20})
        route.fulfill(json={'current': {'priceStars': 600, 'regularPriceStars': 750, 'discountPercent': 20, 'saleEndsAt': None}})
    page.route('**/api/admin/offer', offer_save)
    page.route('**/api/invoice', lambda r: r.fulfill(json={'url': 'https://t.me/$ui-fixture'}))
    page.goto(BASE_URL, wait_until='networkidle')
    page.get_by_role('link', name='Профиль', exact=True).click()
    page.get_by_role('link', name='Управление ценой и акциями').click()
    page.locator('[name="priceStars"]').fill('750')
    page.locator('[name="discountPercent"]').fill('20')
    page.get_by_role('button', name='Сохранить цену').click()
    page.get_by_text('Цена и акция сохранены.').wait_for()
    page.screenshot(path=str(out / 'admin-390.png'), full_page=True)
    page.get_by_role('link', name='В профиль', exact=True).click()
    page.locator('.access-banner').click()
    page.get_by_role('button', name='Оплатить 600 ★').wait_for()
    assert 'навсегда' in page.get_by_role('dialog').inner_text()
    page.screenshot(path=str(out / 'checkout-390.png'), full_page=True)
    page.get_by_role('button', name='Оплатить 600 ★').click()
    assert page.get_by_role('button', name='Оплатить 600 ★').is_enabled()
    context.close()
    browser.close()
print(json.dumps({'viewports': [320, 390, 1280], 'result': 'PASS', 'flows': ['gate', 'home', 'real lesson', 'progress', 'paywall', 'search', 'resources', 'profile']}, ensure_ascii=False))
