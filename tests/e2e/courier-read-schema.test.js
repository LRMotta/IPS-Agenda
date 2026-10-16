'use strict';
/* global window */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

const source = contentAccessibilitySource(['bindTableRecordActions', '_renderTabelaCouriers', 'regularizarIdsCouriersFront_', 'stripHtmlSimple', 'courierConfirmationHtml', 'courierConfirmationEffective', 'courierConfirmationDefaultFront', 'courierNormNome']);
const content = readProjectFile('IndexContentAfterDashboard.html');
const markup = content.slice(content.indexOf('<div class="page" id="page-couriers">'), content.indexOf('<!-- ═══ FERIADOS'));

for (const width of [1280, 390]) {
  test('courier legado regulariza explicitamente sem abrir criação em ' + width + 'px', async () => {
    // Browser plugin not available: Playwright do projeto, rede e RPCs isoladas.
    // Fluxo: Couriers -> Regularizar cadastro -> recarga -> Editar com ID persistido.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['warning', 'error'].includes(message.type())) errors.push(message.text()); });
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — Couriers local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '</head><body><main class="main"><div class="content">' + markup.replace('class="page"', 'class="page active"') + '<div id="feedback" role="status"></div></div></main></body></html>');
      await page.addScriptTag({ content: `
        var requests = [], opened = [], deleted = [], invalidated = [];
        var records = [{id:'',nome:'Marken',empresa1:'Empresa histórica'}, {id:'COU-ESTAVEL',nome:'DHL'}];
        function esc(v) { return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
        function norm(v) { return String(v || '').toLowerCase(); }
        function normSelectValue(v) { return norm(v); }
        function abrirFormCourier(id) { opened.push(id); document.getElementById('feedback').textContent='Editando '+id; }
        function confirmarExcluirCourier(id) { deleted.push(id); }
        function appServerRun(options) { requests.push(options); }
        function invalidateCadastroBootstrapCache(key) { invalidated.push(key); }
        function snack(message) { document.getElementById('feedback').textContent=message; }
        function snackErro(error) { snack(error.message); }
        function carregarCouriers(force) { if (!force) throw new Error('recarga precisa ser forçada'); _renderTabelaCouriers(records); }
        ${source}
        _renderTabelaCouriers(records);
      ` });
      assert.deepEqual(errors, []);
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — Couriers local');
      assert.match(await page.locator('body').innerText(), /Couriers cadastradas/i);
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
      await page.locator('.courier-item summary').first().click();
      assert.equal(await page.getByRole('button', { name: 'Editar Marken' }).count(), 0);
      await page.getByRole('button', { name: 'Regularizar cadastro' }).click();
      assert.deepEqual(await page.evaluate(() => window.opened), []);
      assert.equal(await page.evaluate(() => window.requests[0].method), 'regularizarIdsCouriers');
      await page.evaluate(() => {
        window.requests[0].onFailure({ message: 'Acesso negado simulado' });
      });
      assert.match(await page.locator('#feedback').innerText(), /Acesso negado/);
      await page.getByRole('button', { name: 'Regularizar cadastro' }).click();
      await page.evaluate(() => {
        window.records[0].id = 'COU-NOVO';
        window.requests[1].onSuccess('Identificações regularizadas. Selecione a courier para continuar.');
      });
      assert.deepEqual(await page.evaluate(() => window.invalidated), ['couriers']);
      assert.match(await page.locator('#feedback').innerText(), /regularizadas/);
      await page.locator('.courier-item summary').first().click();
      await page.getByRole('button', { name: 'Editar Marken' }).click();
      assert.deepEqual(await page.evaluate(() => window.opened), ['COU-NOVO']);
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false);
      assert.deepEqual(errors, []);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'courier-schema-' + width + '.png'), fullPage: false });
    } finally { await browser.close(); }
  });
}
