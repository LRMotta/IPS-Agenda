'use strict';
/* global document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');
const source = contentAccessibilitySource(['appSyncNavAccessibility', 'toggleNavCadastros', 'toggleNavEstoque',
  'setMobileNav', 'toggleMobileNav', 'closeMobileNav', 'appMobileNavKeydown', 'irPara']);
for (const width of [1280, 390]) test('menu acessível por teclado em ' + width + 'px', async () => {
  // Browser plugin not available. Rede e serviços Google isolados na fixture local.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.text()); });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — menu local</title>' +
      readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
      '</head><body>' + readProjectFile('IndexContent.html') + '</div></div></body></html>');
    await page.addScriptTag({ content: source + `
      var APP_USER_NAVIGATED = false;
      function appConfirmNavigationIfDirty() { return true; }
      function isEmbeddedModuleEnabled() { return false; }
      function setCurrentPage(page) { return page; }
      function resetAppScrollPosition() {}
      function getRoutePageConfig(page) { return { label: page === 'medicos' ? 'Médicos' : 'Pendências', icon: 'person' }; }
      function carregarMedicos() {} function carregarPendencias() {} function updateFloatingAddButton() {}
      document.addEventListener('keydown', appMobileNavKeydown);
      window.addEventListener('resize', function() { setMobileNav(document.body.classList.contains('mobile-nav-open')); });
      appSyncNavAccessibility(); setMobileNav(false);
    ` });
    assert.equal(page.url(), 'about:blank');
    assert.equal(await page.title(), 'IPS — menu local');
    assert.ok((await page.locator('body').innerText()).includes('Agenda'));
    assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
    if (width < 900) {
      assert.equal(await page.locator('#appNavDrawer').getAttribute('inert'), '');
      await page.locator('#mobileMenuBtn').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#mobileMenuBtn').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.nav-item').first().evaluate(el => document.activeElement === el), true);
    }
    await page.locator('#navCadastrosToggle').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#navCadastrosToggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#navCadastrosBody').getAttribute('inert'), null);
    await page.locator('#navEstoqueToggle').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#navCadastrosToggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#navCadastrosBody').getAttribute('inert'), '');
    assert.equal(await page.locator('#navEstoqueToggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#navCadastrosToggle').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#navEstoqueBody').getAttribute('inert'), '');
    await page.getByRole('button', { name: 'Médicos', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.nav-item.active').getAttribute('aria-current'), 'page');
    assert.equal(await page.getByRole('heading', { level: 1, name: 'Médicos', exact: true }).count(), 1);
    assert.equal(await page.getByRole('textbox', { name: 'Buscar médicos' }).count(), 1);
    if (width < 900) {
      assert.equal(await page.locator('#mobileMenuBtn').evaluate(el => document.activeElement === el), true);
      await page.keyboard.press('Enter');
      await page.locator('#appNavDrawer button').filter({ hasText: 'Configurações' }).focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#mobileMenuBtn').evaluate(el => document.activeElement === el), true);
      await page.keyboard.press('Shift+Tab');
      assert.ok(await page.evaluate(() => document.activeElement.textContent.includes('Configurações')));
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#appNavDrawer').getAttribute('inert'), '');
      assert.equal(await page.locator('#mobileMenuBtn').evaluate(el => document.activeElement === el), true);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForFunction(() => !document.getElementById('appNavDrawer').hasAttribute('inert'));
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => document.getElementById('appNavDrawer').hasAttribute('inert'));
    }
    await page.evaluate(() => { document.getElementById('userEmail').textContent = 'Equipe IPS'; });
    const stats = await page.locator('#page-medicos .stats-row').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(stats.scroll <= stats.width + 1);
    assert.deepEqual(errors, []);
    const dir = path.join(os.tmpdir(), 'ips-index-content-qa'); fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'menu-' + width + '.png'), animations: 'disabled' });
    await page.close();
  } finally { await browser.close(); }
});
