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
const { planningIntegration } = require('../helpers/soa-planning-integration');

for (const width of [1280, 390]) {
  test('planejamento IA: prévia, rascunho e aplicação revisada em ' + width + 'px', async () => {
    // Browser plugin not available. Real local handlers and server with simulated Sheets only.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const { server, spreadsheet, canonical, poc } = planningIntegration();
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
      await page.exposeFunction('planningRpc', async (method, args) => {
        assert.ok(['listarPlanejamentosSoA', 'carregarPlanejamentoSoA', 'salvarPlanejamentoSoA', 'validarImportacaoSoA', 'importarSoAJson'].includes(method));
        return JSON.parse(JSON.stringify(server[method](...args)));
      });
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — planejamento local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '</head><body>' + readProjectFile('IndexContentAfterStock.html') + '</body></html>');
      const core = readProjectFile('IndexCoreScripts.html');
      const importer = core.slice(core.indexOf('var _soaImportDadosAtual'), core.indexOf('function excluirSoAVisitaApp'));
      await page.addScriptTag({ content: `
        var _soaProjetoAtual = { nomeAbreviado: 'BGB-43395-302' };
        var testRequests = [], testSuccess = '';
        function esc(value) { return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
        function appSetStatus(id,message) { document.getElementById(id).textContent = message; }
        function appErrorMessage(e) { return e.message; }
        function soaOrdemLabel_(v) { return String(v == null ? '' : v); }
        function abrirOverlay(id) { document.getElementById(id).removeAttribute('inert'); document.getElementById(id).classList.add('open'); }
        function fecharOverlay(id) { document.getElementById(id).classList.remove('open'); document.getElementById(id).setAttribute('inert',''); }
        function fecharModalSeClicouFora() {}
        function snack(message) { testSuccess = message; }
        function carregarSoAVisitasProjeto() {} function carregarBracosProjeto() {}
        function appServerRun(options) { testRequests.push(options.method); window.planningRpc(options.method,options.args).then(options.onSuccess,options.onFailure); }
        ${contentAccessibilitySource(['appSetButtonBusy'])}
        ${importer}
        abrirSoAImportForm();
      ` });
      await page.addScriptTag({ content: readProjectFile('SharedSoAPlanningImport.html').replace(/^<script>/i,'').replace(/<\/script>\s*$/i,'') });
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — planejamento local');
      assert.ok((await page.locator('#modalSoAImport').innerText()).includes('IMPORTAR CALENDÁRIO'));
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Baixar instruções para IA' }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'ips-agenda-instrucoes-extracao-1.0.0.txt');
      assert.equal(fs.readFileSync(await download.path(), 'utf8').trim(), readProjectFile('docs/INSTRUCOES_EXTRACAO_IA.txt').trim());
      await page.locator('#soaImportTexto').fill(JSON.stringify(poc));
      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Rascunho recebido'));
      assert.equal(await page.locator('#btnImportarSoAConfirm').isDisabled(), true);
      await page.getByText('Regras extraídas (8)', { exact: true }).click();
      assert.ok((await page.locator('#soaImportPreview').innerText()).includes('Página impressa: 100'));
      await page.locator('#btnSalvarPlanejamentoSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Rascunho salvo'));
      assert.equal(spreadsheet.getSheets().length, 1);
      const saved = server.listarPlanejamentosSoA('BGB-43395-302')[0];
      await page.waitForFunction(() => document.getElementById('soaPlanejamentoSalvo').options.length === 2);
      await page.locator('#soaImportTexto').fill('{}');
      await page.locator('#soaPlanejamentoSalvo').selectOption(saved.id);
      await page.getByRole('button', { name: 'Abrir rascunho' }).click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Rascunho recebido'));
      assert.deepEqual(JSON.parse(await page.locator('#soaImportTexto').inputValue()), poc);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(),'ips-agenda-playwright');
      fs.mkdirSync(artifacts,{recursive:true});
      await page.locator('#soaImportPreview').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,'soa-planning-draft-' + width + '.png')});
      assert.equal(await page.locator('#modalSoAImport .modal-body').evaluate(el => el.scrollWidth > el.clientWidth), false);

      await page.evaluate(() => { window._soaProjetoAtual = { nomeAbreviado: 'Estudo local' }; window.abrirSoAImportForm(); });
      await page.locator('#soaImportTexto').fill(JSON.stringify(canonical));
      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Prévia pronta'));
      assert.equal(await page.locator('#btnImportarSoAConfirm').isDisabled(), true);
      await page.locator('#soaImportRevisado').check();
      assert.equal(await page.locator('#btnImportarSoAConfirm').isEnabled(), true);
      await page.locator('#soaImportModo').selectOption('atualizar');
      assert.equal(await page.locator('#btnImportarSoAConfirm').isDisabled(), true);
      assert.equal(await page.locator('#soaImportRevisado').isChecked(), false);
      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Prévia pronta'));
      await page.locator('#soaImportRevisado').check();
      await page.locator('#soaImportPreview').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,'soa-planning-ready-' + width + '.png')});
      assert.equal(await page.locator('#modalSoAImport .modal-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
      await page.locator('#btnImportarSoAConfirm').click();
      await page.waitForFunction(() => window.testSuccess.includes('extração arquivada'));
      assert.equal(server.getSoAVisitasProjeto('Estudo local').length, 2);
      assert.equal(server.getBracosProjeto('Estudo local').length, 1);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
