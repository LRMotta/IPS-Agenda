'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');
const { fixture, material } = require('../helpers/agenda-merge-fixture');

test('formulario e servidor combinam campos independentes e preservam rascunho em sobreposicao', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      for (const mode of ['combined', 'conflict', 'pending']) {
        const conflict = mode === 'conflict';
        const { c, i, sheet, payload } = fixture();
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(4000);
        const errors = await agendaBrowserFixture(page);
        assert.equal(await page.title(), 'Agenda — teste local');
        const event = JSON.parse(JSON.stringify(c.agendaRowToObject_(sheet.rows[1], 2)));
        event.editMergeToken = payload._editMergeToken;
        event.editFieldVersions = JSON.parse(JSON.stringify(payload._editFieldVersions));
        await page.evaluate(record => {
          window.CURRENT_ACCESS = { ok: true, email: 'editor@exemplo.invalid' };
          window._agendaDados.participantes.push({ id: record.participanteCadastroId, nome: record.participante, numId: record.idParticipante, nascimento: record.nascimento, projeto: record.projeto, braco: record.braco });
          window.agendaAbrirEdicaoComRegistroPronto_(record);
          window.updateAgendaSaveAvailability = window.validarAgendaCampo = window.validarAgendaAlertasDataPassada = window.validarAgendaRealizadoFuturo = window.validarAgendaCourierStatusData_ = window.validateAgendaAwbs = () => true;
          window.agendaDataAlteradaInfo_ = () => null;
          window.appMarkUnsavedChanges = () => { window.dirty = true; };
          window.agendaMatBioSetItems('agC1', [{ key: 'soro', tipo: 'Soro', ensaio: 'Material local', formula: '1x2', tubos: 1, total: 2, unit: 'mL', segmentos: [{ qtd: 1, vol: 2 }] }]);
          document.getElementById('agObs').value = 'Observação local';
          window.salvarAgendaEvento();
        }, event);
        const submitted = await page.evaluate(() => window.calls.find(call => call.method === 'atualizarAgendaEventoCompleto')?.args[0]);
        assert.ok(submitted, 'salvamento iniciado no formulario real');
        assert.equal(submitted._editMergeToken, payload._editMergeToken);
        sheet.rows[1][i.c1.status] = 'Agendado';
        if (conflict) sheet.rows[1][i.c1.matBio] = material('Material remoto');
        const result = c.atualizarAgendaEventoCompleto(submitted);
        if (mode === 'pending') await page.locator('#agObs').fill('Texto digitado durante o salvamento');
        await page.evaluate(response => window.calls.find(call => call.method === 'atualizarAgendaEventoCompleto').success(response), JSON.parse(JSON.stringify(result)));
        if (conflict) {
          assert.equal(result.conflito, true);
          assert.equal(sheet.writes, 0);
          assert.equal(await page.locator('#agendaCreatePanel').evaluate(el => el.classList.contains('open')), true);
          assert.match(await page.locator('#agendaStatusMsg').innerText(), /Alterações incompatíveis: Transporte I - Material biológico/);
          assert.equal(await page.locator('.ag-mat-line[data-prefix="agC1"] .ag-mat-ensaio').first().inputValue(), 'Material local');
          assert.equal(await page.locator('#agObs').inputValue(), 'Observação local');
          assert.equal(await page.evaluate(() => window.agendaConflictDraftRead_('A').mergeToken), payload._editMergeToken);
          const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
          fs.mkdirSync(dir, { recursive: true });
          await page.locator('#agendaStatusMsg').screenshot({ path: path.join(dir, 'agenda-combinacao-conflito-' + width + '.png') });
        } else if (mode === 'pending') {
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(sheet.rows[1][i.obs], 'Observação local');
          assert.equal(await page.locator('#agendaCreatePanel').evaluate(el => el.classList.contains('open')), true);
          assert.equal(await page.locator('#agObs').inputValue(), 'Texto digitado durante o salvamento');
          assert.equal(await page.evaluate(() => window.dirty), true);
          assert.equal(await page.evaluate(() => window.agendaConflictDraftRead_('A').mergeToken), payload._editMergeToken);
          assert.match(await page.locator('#agendaStatusMsg').innerText(), /novas alterações/);
        } else {
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(result.merged, true);
          assert.equal(sheet.rows[1][i.c1.status], 'Agendado');
          assert.match(sheet.rows[1][i.c1.matBio], /Material local/);
          assert.equal(sheet.rows[1][i.obs], 'Observação local');
          assert.equal(await page.locator('#agendaCreatePanel').evaluate(el => el.classList.contains('open')), false);
          assert.equal(await page.evaluate(() => window.notifications.some(text => text.includes('Atualizações feitas em outros campos foram preservadas'))), true);
          assert.equal(await page.evaluate(() => window.agendaConflictDraftRead_('A')), null);
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
