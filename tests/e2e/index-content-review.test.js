'use strict';
/* global document, window */
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

const medicosSource = contentAccessibilitySource(['carregarMedicos', 'renderMedicos', 'filtrarMedicos',
  'renderTabela', 'esc', 'bindTableRecordActions', 'codexRunSearchFilter']) + '\n' +
  readProjectFile('IndexCoreScripts.html').match(/^function norm\([^\n]+/m)[0];
for (const width of [1280, 390]) test('médicos recupera erro, filtra e mantém ações acessíveis em ' + width + 'px', async () => {
  // Browser plugin not available. Fixture local sem RPCs nem rede real.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.text()); });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — médicos local</title>' +
      readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
      '</head><body>' + readProjectFile('IndexContent.html') + '</div></div></body></html>');
    await page.addScriptTag({ content: medicosSource + `
      var _medicos = [], ESPS = [], CODEX_SEARCH_FILTER_TIMERS = {}, CODEX_SEARCH_FILTER_DELAY_MS = 140;
      window.requests = []; window.profileOpens = 0; window.edited = null;
      function getCadastrosBootstrapCached(type, success, failure, force) { window.requests.push({success, failure, force}); }
      function snackErro() {} function sortCadastroByField(list) { return list; }
      function abrirFormMedico(item) { window.edited = item.id; }
      function confirmarExcluir() {} function abrirMeuPerfil() { window.profileOpens++; }
      document.getElementById('page-medicos').classList.add('active');
      document.getElementById('topTitle').textContent = 'Médicos';
      document.getElementById('userEmail').textContent = 'Equipe IPS';
      carregarMedicos(false);
    ` });
    assert.equal(page.url(), 'about:blank');
    assert.equal(await page.title(), 'IPS — médicos local');
    assert.ok((await page.locator('body').innerText()).includes('Novo Médico'));
    assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
    assert.equal(await page.locator('#tableMedicos').getAttribute('aria-busy'), 'true');
    await page.evaluate(() => window.requests[0].failure(new Error('offline')));
    assert.equal(await page.locator('#tableMedicos').getAttribute('aria-busy'), 'false');
    assert.ok((await page.locator('#medicosStatus').innerText()).includes('Não foi possível'));
    assert.equal(await page.locator('#bodyMedicos .spinner').count(), 0);
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    assert.equal(await page.evaluate(() => window.requests[1].force), true);
    await page.evaluate(() => window.requests[1].success({ data: [
      { id: 'M1', nome: 'Ana "Clara" da Silva de Albuquerque', especialidade: 'Medicina interna',
        cpf: '000.000.000-00', cremers: '12345', telefone: '(54) 99999-9999', email: 'ana.clara.albuquerque@exemplo.invalid' },
      { id: 'M2', nome: '<Bruno>', especialidade: 'Cardiologia' },
    ], config: {} }));
    assert.equal(await page.locator('#tableMedicos').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#medicosStatus').innerText(), '2 médicos encontrados.');
    assert.equal(await page.locator('#bodyMedicos .row-name').first().innerText(), 'Ana "Clara" da Silva de Albuquerque');
    assert.equal(await page.locator('#bodyMedicos script, #bodyMedicos bruno').count(), 0);
    assert.ok((await page.locator('#bodyMedicos tr').first().boundingBox()).height < 150);
    const scroll = page.locator('.medicos-table-scroll');
    const sizes = await scroll.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (width < 900) {
      assert.ok(sizes.scroll > sizes.client);
      await scroll.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.medicos-table-scroll').scrollLeft > 0);
      await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      const action = page.getByRole('button', { name: 'Editar médico Ana "Clara" da Silva de Albuquerque', exact: true });
      const box = await action.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
    }
    const dir = path.join(os.tmpdir(), 'ips-index-content-qa'); fs.mkdirSync(dir, { recursive: true });
    await scroll.screenshot({ path: path.join(dir, 'medicos-' + width + '.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Editar médico Ana "Clara" da Silva de Albuquerque', exact: true }).click();
    assert.equal(await page.evaluate(() => window.edited), 'M1');
    await page.getByRole('textbox', { name: 'Buscar médicos' }).fill('bruno');
    await page.waitForFunction(() => document.getElementById('medicosStatus').textContent === '1 médico encontrado.');
    assert.equal(await page.locator('#bodyMedicos tr').count(), 1);
    await page.getByRole('textbox', { name: 'Buscar médicos' }).fill('inexistente');
    await page.waitForFunction(() => document.getElementById('medicosStatus').textContent === '0 médicos encontrados.');
    assert.ok((await page.locator('#bodyMedicos').innerText()).includes('Nenhum médico encontrado'));
    await page.getByRole('button', { name: 'Abrir meu perfil' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.profileOpens), 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
