"""Real browser screenshots of the editorial variant; no generated mockups.
Run the app, then BASE_URL=http://127.0.0.1:3119 python scripts/capture-editorial.py.
Uses the explicitly labelled development preview. Never simulates a real payment.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

base = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
out = Path('handoff/screenshots/editorial')
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    for name, width, height in [('desktop', 1440, 1080), ('mobile', 390, 844), ('small', 320, 740)]:
        context = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://telegram.org/**', lambda route: route.abort())
        page.goto(base, wait_until='networkidle')
        page.get_by_role('button', name='Посмотреть дизайн в демо-режиме').click()
        page.get_by_role('button', name='Начать бесплатно').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), name + ': horizontal overflow'
        page.screenshot(path=str(out / f'{name}-home.png'), full_page=True)
        page.screenshot(path=str(out / f'{name}-viewport.png'))
        if name == 'desktop':
            page.get_by_role('link', name='Открыть проект', exact=True).click()
            page.locator('#project-form').wait_for()
            page.locator('[name=title]').fill('Учебный сайт фотографа')
            page.locator('[name=url]').fill('https://example.com')
            page.get_by_role('button', name='Сохранить проект').click()
            page.locator('[name=project-stage]').first.check()
            page.get_by_role('link', name='Главная', exact=True).click()
            page.get_by_role('heading', name='Учебный сайт фотографа').wait_for()
            page.get_by_role('link', name='Открыть конструктор').click()
            page.locator('#builder').wait_for()
            page.locator('[name=about]').fill('Делаю портреты для специалистов и небольших команд')
            page.locator('[name=audience]').fill('Предприниматели и авторы проектов')
            page.locator('[name=goal][value=booking]').check()
            page.locator('[name=style][value=calm]').check()
            assert 'Предприниматели' in page.locator('#builder-out').inner_text()
            page.screenshot(path=str(out / 'desktop-builder.png'), full_page=True)
        if name == 'mobile':
            page.get_by_role('button', name='Начать бесплатно').click()
            page.locator('.article-body').wait_for()
            page.screenshot(path=str(out / 'mobile-lesson.png'), full_page=True)
        assert not errors, errors
        context.close()
    browser.close()
print('PASS: real screenshots at 1440, 390 and 320 px; project notebook and prompt builder verified.')
