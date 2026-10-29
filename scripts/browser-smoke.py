"""Optional UI smoke test. Requires Python Playwright + Chromium; not an app dependency."""
import hashlib, hmac, json, os, subprocess, time
from urllib.parse import urlencode
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
out = Path('artifacts'); out.mkdir(exist_ok=True)
ROOT = Path(__file__).resolve().parent.parent
SIGNED_PORT = int(os.environ.get('SMOKE_PORT', '3001'))
SMOKE_TOKEN = '123456:synthetic_smoke_token_not_a_real_one_x'  # same synthetic token as scripts/smoke-server.mjs

def init_data(user_id):
    fields = {'auth_date': str(int(time.time())), 'query_id': 'smoke', 'user': json.dumps({'id': user_id, 'first_name': 'Тест'}, ensure_ascii=False, separators=(',', ':'))}
    check = '\n'.join(f'{k}={fields[k]}' for k in sorted(fields))
    secret = hmac.new(b'WebAppData', SMOKE_TOKEN.encode(), hashlib.sha256).digest()
    return urlencode({**fields, 'hash': hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()})
with sync_playwright() as p:
    chromium = os.environ.get('CHROMIUM_PATH')
    browser = p.chromium.launch(**({'executable_path': chromium} if chromium else {}), args=['--no-sandbox'])
    for width, height in [(390, 844), (320, 740), (1280, 900)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1)
        page = context.new_page(); errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://telegram.org/**', lambda route: route.abort())
        page.goto(BASE_URL, wait_until='networkidle')
        page.get_by_text('Большие проекты').wait_for()
        page.screenshot(path=str(out / f'gate-{width}.png'), full_page=True)
        page.get_by_role('button', name='Посмотреть дизайн в демо-режиме').click()
        page.get_by_text('Ваш сайт обретает форму').wait_for()
        page.locator('.stage-steps li').first.wait_for()  # the demo project loads from the server
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
        page.screenshot(path=str(out / f'home-{width}.png'), full_page=True)
        page.get_by_role('button', name='Начать урок').click()
        page.get_by_role('checkbox').wait_for()
        assert page.get_by_role('button', name='Завершить урок').is_disabled()
        assert len(page.locator('.article-body').inner_text()) > 1000, 'Actual course text must be loaded'
        page.screenshot(path=str(out / f'lesson-{width}.png'), full_page=True)
        page.get_by_role('checkbox').check()
        page.get_by_role('button', name='Завершить урок').click()
        page.wait_for_url('**#lesson?id=2')  # free lessons lead straight to the next one
        page.evaluate("location.hash = '#home'")
        page.get_by_text('Пройдено 1 из 24 уроков').wait_for()
        page.evaluate("location.hash = '#lessons'")
        page.locator('#lesson-results [data-action="lesson"][data-id="6"]').click()
        if width >= 1024:  # on a computer the first tap chooses the lesson, the panel button opens it
            page.locator('[data-action="lesson-open"][data-id="6"]').click()
        page.get_by_role('dialog').wait_for()
        page.get_by_role('dialog').locator('[data-action="pay-stub"]').click()  # demo: payments are off, a clear stub is shown
        page.locator('#pay-stub:not(.is-hidden)').wait_for()
        page.keyboard.press('Escape')
        page.get_by_role('searchbox').fill('клиент')
        assert page.locator('.lesson-row').count() > 0
        page.get_by_role('searchbox').fill('zzzzzzzzz')
        page.get_by_text('Пока ничего не нашлось').wait_for()
        page.get_by_role('searchbox').fill('')
        page.evaluate("location.hash = '#materials?tab=prompts'")
        page.locator('.mat-card, .empty-state').first.wait_for()
        page.evaluate("location.hash = '#materials?tab=base'")
        page.locator('.mat-card, .empty-state').first.wait_for()
        if page.locator('[data-action="mat-select"][data-id="start-how"]').count():  # only when the private library is installed
            page.evaluate("location.hash = '#article?id=start-how'")
            page.locator('.article-body').wait_for()
            assert len(page.locator('.article-body').inner_text()) > 300
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow in article'
            page.evaluate("location.hash = '#home'")
            page.get_by_role('link', name='Профиль', exact=True).wait_for()
        page.get_by_role('link', name='Профиль', exact=True).click()
        page.get_by_text('Демо: прогресс сохраняется только на этом устройстве.').wait_for()
        assert not errors, errors
        context.close()
    # Signed flows against the real API: scripts/smoke-server.mjs (fake Telegram, in-memory database, synthetic token).
    server = subprocess.Popen(['node', str(ROOT / 'scripts/smoke-server.mjs'), str(SIGNED_PORT)], stdout=subprocess.PIPE, text=True)
    try:
        assert 'smoke server' in server.stdout.readline()
        signed_url = f'http://127.0.0.1:{SIGNED_PORT}/'

        def open_as(user_id, width=390, height=844):
            context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1)
            page = context.new_page(); page.errors = []
            page.on('pageerror', lambda error: page.errors.append(str(error)))
            stub = 'window.Telegram={WebApp:new Proxy({initData:%s,initDataUnsafe:{},platform:"android",version:"8.0"},{get:(t,k)=>k in t?t[k]:new Proxy(()=>{},{get:(a,b)=>()=>{},apply:()=>undefined})})};' % json.dumps(init_data(user_id))
            page.route('https://telegram.org/**', lambda route: route.fulfill(content_type='text/javascript', body=stub))
            return context, page

        def check_layout(page, name):
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal overflow: {name}'
            small = page.evaluate("""[...document.querySelectorAll('#app *, #overlay-root *')].filter(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim()) && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 11).length""")
            assert small == 0, f'Text smaller than 11px: {name}'

        # New free user: onboarding, then the checkout with the price from PRICE_RUB.
        context, page = open_as(778)
        page.goto(signed_url, wait_until='load')
        page.get_by_text('Что для вас главное?').wait_for()
        page.locator('[data-action="onb-answer"][data-id="own"]').click()
        page.locator('[data-action="onb-answer"][data-id="none"]').click()
        page.locator('[data-action="onb-home"]').click()
        page.get_by_text('Пройдено 0 из 24 уроков').wait_for()
        check_layout(page, 'home')
        page.evaluate("location.hash = '#lessons'")
        page.locator('[data-action="lesson"][data-id="6"]').click()
        page.get_by_role('dialog').wait_for()
        dialog = page.get_by_role('dialog').inner_text()
        assert '1299' in dialog.replace(' ', '').replace('\u202f', '').replace('\xa0', '') and 'навсегда' in dialog, dialog
        page.screenshot(path=str(out / 'checkout-390.png'), full_page=True)
        assert not page.errors, page.errors
        context.close()

        # Paid user: bookmarks (server) and «Недавно открытое» (this device).
        for width, height in [(360, 780), (1280, 900)]:
            context, page = open_as(779, width, height)
            page.goto(signed_url + '#materials?tab=favorites', wait_until='load')
            page.get_by_text('Здесь будут ваши закладки').wait_for()
            page.goto(signed_url + '#lesson?id=6', wait_until='load')
            star = page.locator('.reader-meta [data-action="favorite"]')
            star.wait_for(); assert star.get_attribute('aria-pressed') == 'false'
            star.click(); page.wait_for_function("document.querySelector('.reader-meta [data-action=favorite]').getAttribute('aria-pressed') === 'true'")
            page.wait_for_timeout(300)
            page.reload(wait_until='load'); star.wait_for()
            assert star.get_attribute('aria-pressed') == 'true', 'bookmark is kept on the server'
            page.goto(signed_url + '#materials?tab=favorites', wait_until='load')
            page.locator('.mat-card').first.wait_for()
            check_layout(page, f'favorites-{width}')
            page.locator('.mat-card [data-action="favorite"]').first.click()
            page.get_by_text('Здесь будут ваши закладки').wait_for()
            page.evaluate("location.hash = '#home'")
            page.locator('.recent-item[data-action="lesson"][data-id="6"]').wait_for()
            check_layout(page, f'home-recent-{width}')
            assert not page.errors, page.errors
            context.close()

        # Learning project and lesson exercises: mistake, retry, saved after reload, stage view, all widths.
        context, page = open_as(778, 390, 844)
        page.goto(signed_url + '#practice?ex=task-prompt', wait_until='load')
        page.locator('#ex-text').wait_for()
        page.locator('[data-action="ex-check"]').click()
        page.locator('.ex-result.is-retry').wait_for()
        page.locator('#ex-text').fill('Создай учебную страницу для репетитора. Для кого: родители школьников. Блоки: шапка; первый экран; три формата занятий; контакт. Сначала покажи план.')
        page.locator('[data-action="ex-check"]').click()
        page.locator('.ex-result.is-passed').wait_for()
        page.reload(wait_until='load'); page.locator('.ex-status.is-passed').wait_for()
        page.goto(signed_url + '#practice?ex=style-contrast', wait_until='load')
        page.locator('.exercise.is-locked').wait_for()
        assert '#C8C8C8' not in page.content(), 'locked exercise content is not sent'
        page.goto(signed_url + '#project', wait_until='load')
        page.locator('.stage-panel').wait_for()
        page.locator('[data-action="stage"][data-id="content"]').click()
        assert page.locator('.site3d').get_attribute('data-focus') == 'content'
        assert page.locator('.stage-steps .is-done').count() == 0, 'viewing never completes a stage'
        assert not page.errors, page.errors
        context.close()
        for width in [320, 390, 768, 1280, 1440, 1920]:
            context, page = open_as(779, width, 900)
            for hash in ['#home', '#lessons', '#project', '#materials', '#practice', '#lesson?id=7']:
                page.goto(signed_url + hash, wait_until='load')
                page.locator('.project-card, .lesson-panel-card, .lesson-row, .stage-panel, .mat-card, .pick-row, .article-body').first.wait_for()
                page.wait_for_timeout(250)
                check_layout(page, f'{hash}-{width}')
            assert not page.errors, page.errors
            context.close()

        # Admin: system check and saving the price.
        for width, height in [(390, 844), (1280, 900)]:
            context, page = open_as(777, width, height)
            page.goto(signed_url + '#admin', wait_until='load')
            page.get_by_role('tab', name='Система').click()
            page.get_by_role('heading', name='Проверка системы').wait_for()
            page.locator('.health-row').first.wait_for()
            assert page.locator('.health-row.is-ok').count() >= 3, 'bot, channel and database must be green'
            check_layout(page, f'admin-system-{width}')
            page.screenshot(path=str(out / f'admin-system-{width}.png'), full_page=True)
            page.get_by_role('tab', name='Воронка').click()
            page.locator('.funnel-row').first.wait_for()
            assert page.locator('.funnel-row').count() == 6 and page.locator('.funnel-tr').count() == 25
            check_layout(page, f'admin-funnel-{width}')
            page.screenshot(path=str(out / f'admin-funnel-{width}.png'), full_page=True)
            page.get_by_role('button', name='7 дней').click()
            page.locator('.funnel-row').first.wait_for()
            page.get_by_role('tab', name='Акции').click()
            page.locator('[name="priceRub"]').fill('1399')
            page.get_by_role('button', name='Сохранить цену').click()
            page.get_by_text('Цена и акция сохранены.').wait_for()
            page.locator('[name="priceRub"]').fill('1299')
            page.get_by_role('button', name='Сохранить цену').click()
            page.get_by_text('Цена и акция сохранены.').wait_for()
            assert not page.errors, page.errors
            context.close()
    finally:
        server.terminate()
    browser.close()
print(json.dumps({'viewports': [320, 390, 768, 1280, 1440, 1920], 'result': 'PASS', 'flows': ['gate', 'home', 'real lesson', 'progress', 'paywall', 'search', 'resources', 'profile', 'onboarding', 'checkout', 'favorites', 'recently opened', 'exercise retry', 'saved result', 'locked exercise', 'project stages', 'widths 320–1920', 'admin system', 'admin funnel', 'admin price']}, ensure_ascii=False))
