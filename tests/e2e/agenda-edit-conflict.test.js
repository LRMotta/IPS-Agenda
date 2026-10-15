'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');

test('conflito guarda rascunho e restaura materiais sem adotar a versao atual', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
      await page.route('http://agenda.test/', route => route.fulfill({ body: '<!doctype html><title>Fixture</title>' }));
      await page.goto('http://agenda.test/');
      const errors = await agendaBrowserFixture(page);
      assert.equal(await page.title(), 'Agenda — teste local');
      await page.evaluate(() => {
        window.CURRENT_ACCESS = { ok: true, email: 'teste@exemplo.invalid' };
        window.agendaAbrirEdicaoComRegistroPronto_({ id: 'A', tipo: 'Visita', status: 'Agendado', dataIso: '2026-10-05', hora: '08:00', participante: 'Pessoa de teste', participanteCadastroId: 'P', projeto: 'Estudo A', labCentral: 'Sim', recordVersion: 'original', editRecordVersion: 'editavel-original' });
        window.initAgendaMatBioForms();
        window.agendaMatBioSetItems('agC1', [{ tipo: 'Soro', key: 'soro', ensaio: 'Teste', formula: '2x3', tubos: 2, total: 6, unit: 'mL', segmentos: [{ qtd: 2, vol: 3 }] }]);
        document.getElementById('agVisita').value = 'Visita preenchida';
        document.getElementById('agObs').value = 'Observação digitada';
        window._agendaEditRecordVersion = 'original';
        window._agendaEditEditableVersion = 'editavel-original';
        window._agendaEditFieldVersions = { version: 'editavel-original', fields: { Status: '1-1' } };
        window._agendaEditRecord = { id: 'A', tipo: 'Visita', status: 'Agendado', dataIso: '2026-10-05', hora: '08:00', participante: 'Pessoa de teste', projeto: 'Estudo A', labCentral: 'Sim', recordVersion: 'original', editRecordVersion: 'editavel-original' };
        window.appMarkUnsavedChanges = () => { window.dirty = true; };
        window.appConfirmNavigationIfDirty = () => !window.dirty;
        window.updateAgendaSaveAvailability = window.validarAgendaCampo = window.validarAgendaAlertasDataPassada = window.validarAgendaRealizadoFuturo = window.validarAgendaCourierStatusData_ = window.validateAgendaAwbs = () => true;
        window.agendaMatBioValidateAll = () => true;
        const collect = window.coletarAgendaEvento;
        window.coletarAgendaEvento = () => ({ ...collect(), data: '2026-10-05', status: 'Agendado' });
        window.salvarAgendaEvento();
        const call = window.calls.find(c => c.method === 'atualizarAgendaEventoCompleto');
        if (!call) throw new Error('Salvamento não foi iniciado');
        window.submitted = call.args[0];
        call.success({ conflito: true, currentVersion: 'nova', currentEditVersion: 'nova-editavel', diagnostic: { fields: ['Transporte I - Status', '<img src=x onerror=alert(1)>'] } });
      });
      const status = page.locator('#agendaStatusMsg');
      assert.match(await status.innerText(), /Preenchimento preservado/);
      assert.equal(await status.locator('img').count(), 0);
      assert.equal(await page.locator('#agVisita').inputValue(), 'Visita preenchida');
      const state = await page.evaluate(() => ({ material: window.agendaMatBioSerialize('agC1'), version: window._agendaEditRecordVersion, edit: window._agendaEditEditableVersion,
        refresh: window.refreshes, dirty: window.dirty, submitted: window.submitted }));
      assert.match(state.material.json, /Soro/);
      assert.equal(state.version, 'original');
      assert.equal(state.edit, 'editavel-original');
      assert.equal(state.refresh, 0);
      assert.equal(state.dirty, true);
      assert.equal(state.submitted._editFieldVersions.version, 'editavel-original');
      await page.evaluate(() => window.fecharAgendaModal());
      assert.equal(await page.locator('#agendaCreatePanel').evaluate(el => el.classList.contains('open')), true);
      await page.locator('#agObs').fill('Ajuste depois do conflito');
      await page.locator('.ag-mat-line[data-prefix="agC1"] .ag-mat-formula').first().fill('2x');
      await page.evaluate(() => {
        if (!window.agendaConflictDraftRead_('A')) throw new Error('Rascunho ausente');
        // Simula nova abertura, sem o cache em memoria da pagina anterior.
        window._agendaConflictDrafts = Object.create(null);
        window._agendaConflictDraftActive = '';
        window.dirty = false;
        window._agendaEditRecordVersion = 'nova'; window._agendaEditEditableVersion = 'nova-editavel';
        document.getElementById('agObs').value = 'Valor atual do servidor';
        window.agendaMatBioClear('agC1');
        window.agendaConflictDraftOffer_();
      });
      assert.equal(await page.locator('#agObs').inputValue(), 'Valor atual do servidor', 'oferta nao substitui os dados atuais');
      await page.getByRole('button', { name: 'Restaurar preenchimento' }).click();
      assert.equal(await page.locator('#agObs').inputValue(), 'Ajuste depois do conflito');
      assert.equal(await page.locator('.ag-mat-line[data-prefix="agC1"] .ag-mat-formula').first().inputValue(), '2x', 'formula incompleta tambem e preservada');
      assert.equal(await page.locator('#agVisita').inputValue(), 'Visita preenchida');
      assert.equal(await page.evaluate(() => window._agendaEditRecordVersion), 'original');
      assert.equal(await page.evaluate(() => window._agendaEditEditableVersion), 'editavel-original');
      assert.equal(await page.evaluate(() => window.dirty), true);
      // O rascunho de outra conta ou outro agendamento nao pode ser recuperado.
      assert.equal(await page.evaluate(() => window.agendaConflictDraftRead_('B')), null);
      assert.equal(await page.evaluate(() => { window.CURRENT_ACCESS.email = 'outro@exemplo.invalid'; return window.agendaConflictDraftRead_('A'); }), null);
      await page.evaluate(() => { window.CURRENT_ACCESS.email = 'teste@exemplo.invalid'; });
      await page.locator('#agendaStatusMsg').scrollIntoViewIfNeeded();
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'agenda-conflito-' + width + '.png') });
      // Uma resposta antiga nao deve marcar nem alterar outro formulario.
      await page.evaluate(() => {
        window._agendaEditId = 'B'; window._agendaEditOpenRequestId++;
        document.getElementById('agendaStatusMsg').textContent = 'Edição B';
        window.calls.find(c => c.method === 'atualizarAgendaEventoCompleto').success({ conflito: true });
      });
      assert.equal(await status.innerText(), 'Edição B');
      await page.evaluate(() => { window._agendaEditId = 'A'; window.agendaConflictDraftOffer_(); });
      await page.locator('#agendaStatusMsg').screenshot({ path: path.join(dir, 'agenda-restaurar-' + width + '.png') });
      await page.getByRole('button', { name: 'Descartar rascunho' }).click();
      assert.equal(await page.evaluate(() => window.agendaConflictDraftRead_('A')), null);
      assert.equal(await page.locator('#agObs').inputValue(), 'Ajuste depois do conflito', 'descartar copia nao apaga o formulario');
      await page.evaluate(() => {
        const key = window.agendaConflictDraftKey_('A');
        window.sessionStorage.setItem(key, '{"id":"A","record":{"id":"A"},"controls":[null],"materials":{}}');
      });
      assert.equal(await page.evaluate(() => window.agendaConflictDraftRead_('A')), null, 'rascunho corrompido e ignorado');
      await page.evaluate(() => {
        window.CURRENT_ACCESS = { ok: true, email: 'teste@exemplo.invalid' };
        const key = window.agendaConflictDraftKey_('A');
        window._agendaConflictDraftActive = 'A';
        window.agendaConflictDraftSave_();
        window.sessionStorage.removeItem(key);
        window._agendaConflictDrafts[key].savedAt = Date.now() - 25 * 60 * 60 * 1000;
      });
      assert.equal(await page.evaluate(() => window.agendaConflictDraftRead_('A')), null, 'copia em memoria tambem expira');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
