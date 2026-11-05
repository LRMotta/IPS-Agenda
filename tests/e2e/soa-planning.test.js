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
const { poloCsv, chainedVisits, singleAnchorVisits, fixed } = require('../helpers/polo-flowchart-fixture');

const csvFile = (visits, name = 'Polo_Trial_Flowchart.csv') => ({ name, mimeType: 'text/csv', buffer: Buffer.from(poloCsv(visits), 'utf8') });

for (const width of [2560, 1280, 390]) {
  test('Cronograma de Avaliações: CSV do Polo, prévia e importação revisada em ' + width + 'px', async () => {
    // Real local handlers and server with simulated Sheets only.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const { server } = planningIntegration();
      server.getProjetoBaseCalculoPadrao_ = () => 'MANTER_DATAS_PREVISTAS';
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const errors = [], payloads = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); });
      await page.exposeFunction('planningRpc', async (method, args) => {
        assert.ok(['validarImportacaoSoA', 'importarSoAJson'].includes(method));
        payloads.push(JSON.stringify(args));
        return JSON.parse(JSON.stringify(server[method](...args)));
      });
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — cronograma local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '</head><body>' + readProjectFile('IndexContentAfterStock.html') + '</body></html>');
      const core = readProjectFile('IndexCoreScripts.html');
      const importer = core.slice(core.indexOf('var _soaImportDadosAtual'), core.indexOf('function excluirSoAVisitaApp'));
      await page.addScriptTag({ content: readProjectFile('SharedSoAPlanningImport.html').replace(/^<script>/i, '').replace(/<\/script>\s*$/i, '') });
      await page.addScriptTag({ content: `
        var _soaProjetoAtual = { nomeAbreviado: 'Estudo local' };
        var _bracosProjetoAtual = [{ nome: 'Braço cadastrado' }, { nome: 'Braço inativo', ativo: false }];
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
      assert.equal(page.url(), 'about:blank');
      assert.ok((await page.locator('#modalSoAImport').innerText()).includes('IMPORTAR CRONOGRAMA DE AVALIAÇÕES'));
      assert.equal(await page.locator('#soaImportBracosLista option').count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Baixar instruções para IA' }).count(), 0);
      assert.equal(await page.locator('#btnSalvarPlanejamentoSoA').count(), 0);

      // Mesmo padrão visual dos demais modais: seções, controles alinhados e seletor de arquivo sem aparência nativa.
      assert.equal(await page.locator('#modalSoAImport .modal-body > .form-section .section-label').count(), 2);
      assert.equal(await page.locator('#modalSoAImport .form-section #soaImportPreview').count(), 1);
      const fileButton = await page.locator('#soaImportArquivo').evaluate(el => {
        const style = window.getComputedStyle(el, '::file-selector-button');
        return { color: style.color, height: style.height };
      });
      assert.deepEqual(fileButton, { color: await page.locator('#btnPreviewSoA').evaluate(el => window.getComputedStyle(el).color), height: '31px' });
      if (width > 760) {
        const tops = await page.locator('#soaImportBraco, #soaImportModo, #soaImportBaseCalculo').evaluateAll(els => els.map(el => el.getBoundingClientRect().top));
        assert.equal(new Set(tops).size, 1);
      }

      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.includes('Selecione o arquivo CSV'));
      await page.locator('#soaImportArquivo').setInputFiles(csvFile(chainedVisits()));
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Arquivo carregado'));
      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.includes('Informe o nome do braço'));

      // A blocked file shows what to fix and cannot be applied.
      const broken = singleAnchorVisits();
      broken.splice(4, 0, fixed('Ciclo 4 / Cycle 4', 28));
      await page.locator('#soaImportArquivo').setInputFiles(csvFile(broken, 'bloqueado.csv'));
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Arquivo carregado'));
      await page.locator('#soaImportBraco').fill('Braço A');
      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Há impedimentos'));
      assert.equal(await page.locator('#btnImportarSoAConfirm').isDisabled(), true);
      assert.equal(await page.locator('#soaImportRevisaoBox').isVisible(), false);
      await page.getByText(/^Pontos de atenção/).click();
      assert.ok((await page.locator('#soaImportPreview').innerText()).includes('Corrija o intervalo no Polo Trial'));
      assert.equal(await page.locator('#modalSoAImport .modal-body').evaluate(el => el.scrollWidth > el.clientWidth), false);

      await page.locator('#soaImportArquivo').setInputFiles(csvFile(chainedVisits()));
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Arquivo carregado'));
      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Prévia pronta'));
      assert.equal(await page.locator('#btnImportarSoAConfirm').isDisabled(), true);
      await page.locator('#soaImportRevisado').check();
      assert.equal(await page.locator('#btnImportarSoAConfirm').isEnabled(), true);

      // Changing the arm discards the review.
      await page.locator('#soaImportBraco').fill('Braço B');
      assert.equal(await page.locator('#btnImportarSoAConfirm').isDisabled(), true);
      assert.equal(await page.locator('#soaImportRevisado').isChecked(), false);
      await page.locator('#btnPreviewSoA').click();
      await page.waitForFunction(() => document.getElementById('statusSoAImport').textContent.startsWith('Prévia pronta'));
      await page.locator('#soaImportRevisado').check();

      const modalBox = await page.locator('#modalSoAImport .modal-box').boundingBox();
      if (width === 2560) assert.ok(modalBox.width > 1000);
      await page.locator('#modalSoAImport .modal-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      for (const selector of ['.modal-header', '.soa-import-footer']) {
        const box = await page.locator('#modalSoAImport ' + selector).boundingBox();
        assert.ok(box.y >= 0 && box.y + box.height <= 961);
      }
      assert.equal(await page.locator('#modalSoAImport .modal-box').evaluate(el => el.scrollHeight > el.clientHeight), false);
      assert.equal(await page.locator('#modalSoAImport .modal-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'cronograma-polo-ready-' + width + '.png') });

      await page.locator('#btnImportarSoAConfirm').click();
      await page.waitForFunction(() => window.testSuccess.includes('Cronograma de Avaliações importado'));
      assert.equal(server.getSoAVisitasProjeto('Estudo local').length, chainedVisits().length);
      assert.equal(server.getBracosProjeto('Estudo local')[0].nome, 'Braço B');
      assert.doesNotMatch(payloads.join(''), /98765|12345|confidencial/);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
