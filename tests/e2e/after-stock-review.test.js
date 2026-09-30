'use strict';
/* global window, document, getComputedStyle */

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
  'appAccessibleDialogKeydown', 'appInitContentAccessibility', 'abrirOverlay', 'fecharOverlay', 'fecharModalSeClicouFora',
  'appHasUnsavedChanges', 'appOpenUnsavedConfirm', 'fecharConfirmUnsaved', 'appConfirmNavigationIfDirty',
  'appClearUnsavedChanges', 'appMarkUnsavedChanges', 'limparErro', 'renderAcProj', 'pickAcProj',
  'fecharAcProj', 'fixAcProj', 'navAcProj', 'appSetButtonBusy',
  'invalidarPreviaImportacaoSoA_', 'soaImportTextoPayload_', 'previsualizarSoAJsonApp',
  'confirmarImportacaoSoAApp', 'renderSoAImportPreview_'
]);

for (const width of [1280, 390]) {
  test('modais após Estoque: teclado, prévia e responsividade em ' + width + 'px', async () => {
    // Browser plugin not available. Fixture local, sem RPC ou rede real.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      await page.setContent('<!doctype html><html><head><title>IPS — revisão local dos modais</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '</head><body><button id="openButton">Abrir formulário</button>' + readProjectFile('IndexContentAfterStock.html') + '</body></html>');
      await page.addScriptTag({ content: `
        var APP_ACCESSIBLE_DIALOGS = [], APP_CONTENT_ACCESSIBILITY_READY = false;
        var APP_UNSAVED_SCOPES = {}, APP_UNSAVED_ON_CANCEL = null;
        var _acIdxProj = {}, ESPS_PROJ = ['Oncologia', 'Cardiologia'];
        var _medicosProj = [], _solicitantesProj = [], PATS_PROJ = [], CROS_PROJ = [];
        var _soaProjetoAtual = { nomeAbreviado: 'Projeto local' };
        var _soaImportDadosAtual = null, _soaImportFingerprintAtual = '', _soaImportRevisao = 0, _soaImportEmAndamento = false;
        var testRequests = [];
        function norm(value) { return String(value || '').toLowerCase(); }
        function appSetStatus(id, message) { document.getElementById(id).textContent = message; }
        function appErrorMessage(error) { return error.message; }
        function esc(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
        function soaOrdemLabel_(value) { return String(value || ''); }
        function appServerRun(options) { testRequests.push(options); }
        function carregarSoAVisitasProjeto() {} function carregarBracosProjeto() {} function snack() {}
        ${functions}
        appInitContentAccessibility();
      ` });
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — revisão local dos modais');
      assert.ok((await page.locator('body').innerText()).includes('Abrir formulário'));
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);

      // Cada um dos 22 modais abre sozinho e devolve o foco ao acionador.
      const ids = await page.locator('[data-stock-dialog]').evaluateAll(elements => elements.map(el => el.id));
      for (const id of ids) {
        await page.locator('#openButton').focus();
        await page.evaluate(id => window.abrirOverlay(id), id);
        await page.waitForFunction(id => document.activeElement.closest('#' + id), id);
        assert.equal(await page.locator('#' + id + ' > div').getAttribute('aria-modal'), 'true', id);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement.id === 'openButton');
        assert.equal(await page.locator('#' + id).getAttribute('inert'), '', id);
      }

      await page.evaluate(() => window.abrirOverlay('modalProjeto'));
      await page.waitForFunction(() => document.activeElement.id === 'pNome');
      const columns = await page.locator('.stock-project-identification').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      assert.equal(columns, width === 390 ? 1 : 4);
      const overflow = await page.locator('#modalProjeto .modal-body').evaluate(el => el.scrollWidth > el.clientWidth);
      assert.equal(overflow, false);
      // Esperar transições de entrada/saída evita capturar overlays anteriores esmaecendo.
      await page.locator('.modal-overlay').evaluateAll(elements => Promise.all(elements.flatMap(el =>
        el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))));
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'after-stock-project-' + width + '.png'), fullPage: false });
      await page.locator('#btnSalvarProj').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'modal-close');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnSalvarProj');

      const autocomplete = page.getByRole('combobox', { name: 'Especialidade Médica', exact: false }).first();
      await autocomplete.fill('Onco');
      await autocomplete.press('ArrowDown');
      await page.waitForFunction(() => document.getElementById('pEsp').hasAttribute('aria-activedescendant'));
      assert.equal(await autocomplete.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#pEspList [aria-selected="true"]').innerText(), 'Oncologia');
      await autocomplete.press('Enter');
      assert.equal(await autocomplete.inputValue(), 'Oncologia');
      await autocomplete.press('ArrowDown');
      await autocomplete.press('Escape');
      assert.equal(await page.locator('#modalProjeto').evaluate(el => el.classList.contains('open')), true);
      await autocomplete.press('Enter');
      assert.equal(await autocomplete.getAttribute('aria-expanded'), 'false');
      await autocomplete.fill('Inexistente');
      await autocomplete.press('Escape');
      assert.equal(await page.locator('#modalProjeto').evaluate(el => el.classList.contains('open')), true);
      await autocomplete.press('Escape');
      await page.waitForFunction(() => document.activeElement.id === 'openButton');

      // A confirmação de alterações continua aninhada e oferece revisão e descarte.
      await page.evaluate(() => { window.abrirOverlay('modalParticipante'); window.appMarkUnsavedChanges('modalParticipante'); });
      await page.waitForFunction(() => document.activeElement.id === 'ptNome');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.closest('#confirmUnsaved'));
      await page.getByRole('button', { name: 'Continuar editando' }).click();
      await page.waitForFunction(() => document.activeElement.id === 'ptNome');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Sair sem salvar' }).click();
      await page.waitForFunction(() => document.activeElement.id === 'openButton');

      await page.evaluate(() => window.abrirOverlay('modalSoAImport'));
      await page.locator('#soaImportTexto').fill('{"visitas":[{"codigo":"V1"}]}');
      await page.locator('#btnPreviewSoA').click();
      await page.evaluate(() => window.testRequests.at(-1).onSuccess({ ok: true, visitas: [{ codigo: 'V1' }], totalVisitas: 1 }));
      assert.equal(await page.locator('#btnImportarSoAConfirm').isEnabled(), true);
      await page.locator('#soaImportModo').selectOption('atualizar');
      assert.equal(await page.locator('#btnImportarSoAConfirm').isEnabled(), false);
      await page.locator('#btnPreviewSoA').click();
      await page.evaluate(() => window.testRequests.at(-1).onSuccess({ ok: true, visitas: [{ codigo: 'V1' }], totalVisitas: 1 }));
      await page.locator('#btnImportarSoAConfirm').click();
      assert.equal(await page.evaluate(() => window.testRequests.at(-1).args[0].modo), 'atualizar');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
