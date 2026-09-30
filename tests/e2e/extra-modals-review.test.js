'use strict';
/* global window, document, ClipboardEvent, DataTransfer */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

const functions = contentAccessibilitySource([
  'appDialogFocusable', 'appFocusDialog', 'appSyncContentFieldAccessibility', 'appSyncAccessibleDialogs',
  'appAccessibleDialogKeydown', 'appInitContentAccessibility', 'fecharOverlay', 'fecharModalSeClicouFora',
  'appHasUnsavedChanges', 'appMarkUnsavedChanges', 'appClearUnsavedChanges',
  'appOpenUnsavedConfirm', 'fecharConfirmUnsaved', 'appConfirmNavigationIfDirty',
  'appRequiredFeedback', 'limparErro', 'salvarPrestadorApp', 'appSetButtonBusy',
  'prestadorEmailsNormalizados', 'renderPrestadorEmails', 'adicionarEmailPrestador',
  'prepararEditorEmailsPrestador', 'courierEditorHtml', 'courierEditorPastePlain',
  'appExtraModalSnapshot_', 'appFinishExtraModalSave_', 'appBeginExtraModalSave_', 'appEndExtraModalSave_',
  'prepararEditorCourier_', 'courierEditorSyncToolbar_', 'courierEditorCommand'
]);
const core = readProjectFile('IndexCoreScripts.html');
const dirtyListeners = core.slice(core.indexOf('function appEditableDirtyScope('), core.indexOf("window.addEventListener('beforeunload'"));
const stock = readProjectFile('IndexContentAfterStock.html');
const unsaved = stock.slice(stock.indexOf('<div class="modal-overlay" id="confirmUnsaved"'), stock.indexOf('<div class="modal-overlay" id="confirmAgendaKits"'));

for (const width of [1280, 390]) {
  test('modais extras: foco, descarte, erro de e-mail e colagem em ' + width + 'px', async () => {
    // Browser plugin not available. Playwright com HTML real e rede/RPCs isoladas.

    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);

      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — modais extras locais</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '</head><body><button id="opener">Abrir cadastro</button>' + readProjectFile('IndexExtraModals.html') + unsaved + '</body></html>');

      await page.addScriptTag({ content: `
        var APP_ACCESSIBLE_DIALOGS = [], APP_CONTENT_ACCESSIBILITY_READY = false;
        var APP_UNSAVED_SCOPES = {}, APP_UNSAVED_ON_CANCEL = null;
        var requests = [];
        var COURIER_EDITOR_RANGE = null;
        function appServerRun(options) { requests.push(options); }
        function appSetStatus(id, text) { (typeof id === 'string' ? document.getElementById(id) : id).textContent = text; }
        function snackErro() {} function carregarPrestadores() {}
        function appErrorMessage(error) { return error.message; }
        function fecharConfirmacaoEntregaPendencia() { fecharOverlay('modalConfirmarEntregaPendencia'); }
        function aplicarDefaultsCourierConfirmacao() {}
        ${functions}
        ${dirtyListeners}
        appInitContentAccessibility();
        prepararEditorEmailsPrestador();
        prepararEditorCourier_();
      ` });

      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — modais extras locais');
      assert.ok((await page.locator('body').innerText()).includes('Abrir cadastro'));
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);

      const ids = await page.locator('[data-extra-dialog]').evaluateAll(elements => elements.map(el => el.id));
      assert.equal(ids.length, 10);
      for (const id of ids) {

        await page.locator('#opener').focus();
        await page.evaluate(id => document.getElementById(id).classList.add('open'), id);
        await page.waitForFunction(id => document.activeElement.closest('#' + id), id);
        const box = page.locator('#' + id + ' > div');
        assert.equal(await box.getAttribute('aria-modal'), 'true', id);
        assert.ok(await box.getAttribute('aria-labelledby'), id);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement.id === 'opener');
        assert.equal(await page.locator('#' + id).getAttribute('inert'), '', id);
      }

      for (const [id, field] of [['modalPrestador', 'prestEmpresa'], ['modalLabCentral', 'labCentralNomeAbrev'],
        ['modalFeriado', 'feriadoNome'], ['modalCourier', 'courierNome']]) {
        await page.locator('#opener').focus();
        await page.evaluate(id => document.getElementById(id).classList.add('open'), id);
        await page.locator('#' + field).fill('Edição local');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement.closest('#confirmUnsaved'));
        await page.getByRole('button', { name: 'Continuar editando' }).click();
        assert.equal(await page.locator('#' + field).inputValue(), 'Edição local');
        await page.waitForFunction(id => document.activeElement.closest('#' + id), id);
        await page.locator('#' + id).click({ position: { x: 2, y: 2 } });
        await page.getByRole('button', { name: 'Sair sem salvar' }).click();
        await page.waitForFunction(() => document.activeElement.id === 'opener');
      }

      await page.evaluate(() => {
        document.getElementById('prestTipoServico').innerHTML = '<option value="Imagem">Imagem</option>';
        document.getElementById('modalPrestador').classList.add('open');
      });
      await page.locator('#btnSalvarPrest').click();
      await page.waitForFunction(() => document.activeElement.id === 'prestEmailEntry');
      assert.equal(await page.locator('#prestEmailEntry').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.evaluate(() => window.requests.length), 0);
      await page.locator('#prestEmailEntry').fill('contato@example.com');
      await page.locator('#prestEmailAdd').click();
      assert.equal(await page.locator('#prestEmail').inputValue(), 'contato@example.com');
      await page.evaluate(() => window.appClearUnsavedChanges('modalPrestador'));
      await page.getByRole('button', { name: 'Remover contato@example.com' }).click();
      assert.equal(await page.evaluate(() => window.appHasUnsavedChanges('modalPrestador')), true);
      await page.locator('#prestEmailEntry').fill('contato@example.com');
      await page.locator('#btnSalvarPrest').click();
      assert.equal(await page.locator('#statusPrest').getAttribute('role'), 'status');
      const requestCount = await page.evaluate(() => window.requests.length);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#modalPrestador').evaluate(el => el.classList.contains('open')), true);
      assert.match(await page.locator('#statusPrest').innerText(), /A gravação já foi enviada/);
      await page.evaluate(() => window.salvarPrestadorApp());
      assert.equal(await page.evaluate(() => window.requests.length), requestCount);
      await page.evaluate(() => window.requests.at(-1).onFailure(new Error('Falha simulada')));
      assert.equal(await page.evaluate(() => window.appHasUnsavedChanges('modalPrestador')), true);
      await page.locator('#btnSalvarPrest').click();
      await page.evaluate(() => window.requests.at(-1).onSuccess('Salvo localmente'));
      await page.waitForFunction(() => !document.getElementById('modalPrestador').classList.contains('open'));
      assert.equal(await page.evaluate(() => window.appHasUnsavedChanges('modalPrestador')), false);
      assert.equal(await page.locator('#confirmUnsaved').evaluate(el => el.classList.contains('open')), false);

      await page.evaluate(() => document.getElementById('modalCourier').classList.add('open'));
      await page.locator('#modalCourier summary').filter({ hasText: 'Declaração de transporte' }).click();
      const editor = page.getByRole('textbox', { name: 'Conteúdo da Declaração de Transporte', exact: true });
      await editor.focus();
      await editor.evaluate(el => {
        const data = new DataTransfer();
        data.setData('text/plain', 'Texto seguro');
        data.setData('text/html', '<img src="x" onerror="alert(1)">Texto seguro');
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      });
      assert.equal(await editor.innerText(), 'Texto seguro');
      assert.equal(await editor.locator('img').count(), 0);
      await editor.evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        window.courierEditorSyncToolbar_();
      });
      await page.getByRole('button', { name: 'Negrito', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Negrito', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.ok(await editor.locator('b, strong').count());
      await page.getByRole('button', { name: 'Itálico', exact: true }).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.getByRole('button', { name: 'Itálico', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.ok(await editor.locator('i, em').count());
      assert.equal(await page.evaluate(() => window.appHasUnsavedChanges('modalCourier')), true);
      await page.locator('#btnSalvarCourier').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'modal-close');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnSalvarCourier');
      assert.equal(await page.locator('#modalCourier .modal-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.locator('.modal-overlay').evaluateAll(elements => Promise.all(elements.flatMap(el =>
        el.getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity)
          .map(animation => animation.finished.catch(() => {})))));
      await page.screenshot({ path: path.join(artifacts, 'extra-modals-courier-' + width + '.png') });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
