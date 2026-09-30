'use strict';
/* global window, document */

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
  'appAccessibleDialogKeydown', 'appInitContentAccessibility', 'appOpenUnsavedConfirm', 'fecharConfirmUnsaved',
  'appConfirmNavigationIfDirty', 'appClearUnsavedChanges', 'appMarkUnsavedChanges', 'fecharOverlay',
  'fecharReqPreloadModal', 'renderReqAC', 'reqAcOptionsIndex', 'pickReqAC', 'fecharReqAC', 'navReqAC',
  'toggleUrgente', 'setAuditView', 'updateAuditTabAccessibility', 'auditTabKeydown'
]);

for (const width of [1280, 390]) {
  test('conteúdo acessível local: teclado, confirmação aninhada e autocomplete em ' + width + 'px', async () => {
    // Browser plugin not available: Playwright já configurado, sem instalar dependências.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.text()); });
      const extra = readProjectFile('IndexContentAfterStock.html');
      const unsaved = extra.slice(extra.indexOf('<div class="modal-overlay" id="confirmUnsaved"'), extra.indexOf('<div class="modal-overlay" id="confirmAgendaKits"'));
      await page.setContent('<!doctype html><html><head><title>IPS — conteúdo acessível local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + '</head><body>' +
        '<button id="testOpen" type="button" onclick="abrirOverlay(\'modalReqPreload\')">Editar lista de exames</button>' +
        readProjectFile('IndexContentAfterDashboard.html') + unsaved + '</body></html>');
      await page.addScriptTag({ content: `
        var APP_ACCESSIBLE_DIALOGS = [], APP_CONTENT_ACCESSIBILITY_READY = false;
        var APP_UNSAVED_SCOPES = {}, APP_UNSAVED_ON_CANCEL = null;
        var _rqAcIdx = {}, _rqAcOptionsCache = {}, _rqUrgente = false, _reqPreloadConflictData = null;
        var _rqParticipantesNomes = ['Pessoa de teste', 'Outra pessoa'], _rqPrestadoresNomes = ['Laboratório A'];
        var _rqSolicitantesNomes = ['Solicitante de teste'];
        var REQUISICAO_ID_ALIASES = { prestador: ['rqPrestador'] };
        var AUDIT_VIEW = 'log', AUDIT_PAGE_OFFSET = {}, testAuditCalls = [];
        function carregarAuditPage(view) { testAuditCalls.push(view); }
        function abrirOverlay(id) { document.getElementById(id).classList.add('open'); }
        function snackErro(message) { throw new Error(message); }
        function _rqNorm(value) { return String(value || '').toLowerCase(); }
        function preencherDadosPaciente() {} function preencherEnderecoReq() {} function preencherDadosSolicitante() {}
        function abrirReqPreloadSelecaoSePronto_() {} function updateRequisicaoGenerateAvailability() {}
        ${functions}
        appInitContentAccessibility();
      ` });
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — conteúdo acessível local');
      assert.ok((await page.locator('body').innerText()).includes('Editar lista de exames'));
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
      await page.locator('#testOpen').click();
      await page.waitForFunction(() => document.activeElement.id === 'reqPreloadExames');
      const editable = page.locator('#reqPreloadExames');
      await page.locator('#btnSalvarReqPreload').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'modal-close');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnSalvarReqPreload');
      await editable.focus();
      await page.evaluate(() => window.appMarkUnsavedChanges('modalReqPreload'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.closest('#confirmUnsaved'));
      assert.equal(await page.locator('#modalReqPreload').evaluate(el => el.classList.contains('open')), true);
      assert.equal(await page.locator('#confirmUnsaved .confirm-box').getAttribute('role'), 'dialog');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement.id === 'reqPreloadExames');
      await page.keyboard.press('Escape');
      await page.locator('#btnConfirmUnsaved').click();
      await page.waitForFunction(() => document.activeElement.id === 'testOpen');
      assert.equal(await page.locator('.modal-overlay.open').count(), 0);
      assert.equal(await page.locator('#modalReqPreload').getAttribute('inert'), '');
      // A confirmação compartilhada continua utilizável em fluxos externos ao fragmento.
      await page.evaluate(() => window.appOpenUnsavedConfirm(function() {}));
      await page.getByRole('button', { name: 'Continuar editando' }).click();
      await page.waitForFunction(() => document.getElementById('confirmUnsaved').hasAttribute('inert'));
      assert.equal(await page.locator('#confirmUnsaved').getAttribute('inert'), '');
      await page.locator('#testOpen').click();
      await page.waitForFunction(() => document.activeElement.id === 'reqPreloadExames');
      await page.evaluate(() => {
        document.getElementById('modalReqPreload').classList.remove('open');
        document.getElementById('modalReqPreloadSelect').classList.add('open');
      });
      await page.waitForFunction(() => document.activeElement.closest('#modalReqPreloadSelect'));
      await page.evaluate(() => document.getElementById('modalReqPreloadSelect').classList.remove('open'));
      await page.waitForFunction(() => document.activeElement.id === 'testOpen');

      // Mudanças diretas de classe (usadas pela Agenda) também entram na pilha.
      await page.evaluate(() => {
        document.getElementById('page-agenda').classList.add('active');
        document.getElementById('agendaCreatePanel').classList.add('open');
      });
      await page.waitForFunction(() => document.activeElement.id === 'agData');
      assert.equal(await page.locator('#agData').getAttribute('aria-required'), 'true');
      assert.equal(await page.locator('#agDataFim').getAttribute('aria-required'), 'false');
      await page.evaluate(() => {
        document.getElementById('agDataFimWrap').style.display = '';
        document.getElementById('agDataFim').classList.add('invalid');
      });
      await page.waitForFunction(() => document.getElementById('agDataFim').getAttribute('aria-required') === 'true');
      assert.equal(await page.locator('#agDataFim').getAttribute('aria-invalid'), 'true');
      await page.evaluate(() => window.abrirOverlay('modalAgendaVisitaMesmaData'));
      await page.waitForFunction(() => document.activeElement.id === 'btnAgendaSairVisitaMesmaData');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#modalAgendaVisitaMesmaData').evaluate(el => el.classList.contains('open')), true);
      await page.evaluate(() => {
        document.getElementById('modalAgendaVisitaMesmaData').classList.remove('open');
        document.getElementById('agendaCreatePanel').classList.remove('open');
        document.getElementById('page-agenda').classList.remove('active');
        document.getElementById('page-requisicao').classList.add('active');
      });
      await page.waitForFunction(() => window.APP_ACCESSIBLE_DIALOGS.length === 0);
      const patient = page.getByRole('combobox', { name: 'Nome do Paciente' });
      await patient.fill('Pessoa');
      await patient.press('ArrowDown');
      assert.equal(await patient.getAttribute('aria-activedescendant'), 'rqPacienteList-option-0');
      assert.equal(await page.locator('#rqPacienteList-option-0').getAttribute('aria-selected'), 'true');
      await patient.press('Enter');
      assert.equal(await patient.inputValue(), 'Pessoa de teste');
      assert.equal(await patient.getAttribute('aria-expanded'), 'false');
      assert.equal(await patient.getAttribute('aria-activedescendant'), null);
      // Enter após fechar não reaproveita a seleção anterior.
      await patient.press('Enter');
      assert.equal(await patient.getAttribute('aria-expanded'), 'false');
      await patient.press('ArrowDown');
      assert.equal(await patient.getAttribute('aria-expanded'), 'true');
      await patient.press('Escape');
      assert.equal(await patient.getAttribute('aria-expanded'), 'false');
      await patient.fill('Inexistente');
      await patient.press('Escape');
      assert.equal(await patient.getAttribute('aria-expanded'), 'false');
      await page.locator('#urgenteBtnForm').click();
      assert.equal(await page.locator('#urgenteBtnForm').getAttribute('aria-pressed'), 'true');
      await page.locator('#urgenteBtnForm').click();
      assert.equal(await page.locator('#urgenteBtnForm').getAttribute('aria-pressed'), 'false');

      await page.evaluate(() => {
        document.getElementById('page-requisicao').classList.remove('active');
        document.getElementById('page-audit-log').classList.add('active');
      });
      await page.getByRole('tab', { name: 'Ações', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('tab', { name: 'Alterações', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('#auditResultsPanel').getAttribute('aria-labelledby'), 'auditTabChanges');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'searchAudit');
      await page.getByRole('tab', { name: 'Alterações', exact: true }).focus();
      await page.keyboard.press('Home');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'auditTabLog');
      await page.keyboard.press('End');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'auditTabChanges');
      const artifactDir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifactDir, { recursive: true });
      await page.screenshot({ path: path.join(artifactDir, 'content-accessibility-' + width + '.png'), fullPage: false });
      assert.deepEqual(errors, []);
      await page.close();
    } finally { await browser.close(); }
  });
}
