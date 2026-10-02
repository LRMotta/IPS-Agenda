'use strict';
/* global window, renderDashboard */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile, runFile } = require('../helpers/load-app-script');

test('Dashboard agregado preserva indicadores e atalhos no desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
      await page.route('**/*', r => r.abort());
      await page.setContent('<html lang="pt-BR"><head><title>Desempenho — QA local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexDashboardStyles.html') +
        readProjectFile('IndexStylesAfterDashboard.html') + '</head><body>' +
        readProjectFile('IndexDashboardContent.html').replace('class="page"', 'class="page active"') + '</body></html>');
      await page.addScriptTag({ content: `window.Chart=function(ctx,config){this.config=config;this.data=config.data;this.options=config.options;this.destroy=function(){};};
        window.codexNormText=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim();
        window.projetoEstaAtivo_=p=>p.classificacaoStatus==='ativo';
        window.esc=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        window.isEmbeddedModuleEnabled=()=>true;
        window.abrirModuloPrincipal=(page,query)=>{window.selected={page,query};};` });
      await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      const server = runFile('WebApp.gs');
      const summary = JSON.parse(JSON.stringify(server.dashboardAgregarParticipantes_([
        { projeto: 'Aurora', status: 'Ativo', cidade: 'Caxias do Sul', estado: 'RS' },
        { projeto: 'Aurora', status: 'Em seguimento', cidade: 'Bento', estado: 'RS' },
        { projeto: 'Aurora', status: 'Encerrado' }
      ])));
      await page.evaluate(summary => {
        window.renderDashboardAgenda = () => {};
        window.renderDashboardEstoque = () => {};
        renderDashboard({ participantesResumo: summary, projetos: [
          { nomeAbreviado: 'Aurora', codigo: 'A', status: 'Recrutamento aberto', classificacaoStatus: 'ativo', coordenador: 'Ana' },
          { nomeAbreviado: 'Sem recrutados', codigo: 'B', status: 'Recrutamento aberto', classificacaoStatus: 'ativo' }
        ] });
      }, summary);
      assert.equal(await page.title(), 'Desempenho — QA local');
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.locator('#kpiPart').textContent(), '3');
      assert.equal(await page.locator('#kpiAtivos').textContent(), '2');
      assert.equal(await page.locator('#kpiZeroRecrut').textContent(), '1');
      await page.locator('#kpiAtivos').locator('..').click();
      assert.deepEqual(await page.evaluate(() => window.selected), { page: 'participantes', query: 'dashFiltro=participantesAtivos' });
      await page.locator('#kpiZeroRecrut').locator('..').press('Enter');
      assert.match((await page.evaluate(() => window.selected)).query, /dashFiltro=recrutZero&dashKeys=sem%20recrutados%7Cb/);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'dashboard-aggregated-' + width + '.png') });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('histórico anterior carrega sob demanda, mantém conteúdo escapado e não repete consulta', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.abort());
    await page.setContent('<html><head><title>Jornada — QA local</title></head><body><main id="history"></main></body></html>');
    const source = readProjectFile('IndexCoreScripts.html');
    const functions = ['jornadaHistoricoAnteriorHtml_', 'carregarHistoricoAnteriorJornada'].map(name => {
      const match = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
      assert.ok(match, name);
      return match[0];
    }).join('\n');
    await page.addScriptTag({ content: `var _jornadaParticipanteDados={participante:{nome:'Pessoa',projeto:'Aurora'},eventosAnterioresTotal:2,historicoAnteriorSobDemanda:true};
      window._jornadaParticipanteConsulta={};window.historyCalls=0;
      function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
      function appErrorMessage(e){return e.message;}
      function appServerRun(options){window.historyCalls++;window.historySuccess=options.onSuccess;}
      ${functions}
      document.getElementById('history').innerHTML=jornadaHistoricoAnteriorHtml_(_jornadaParticipanteDados);` });
    await page.locator('summary').click();
    await page.getByRole('button', { name: 'Carregar histórico' }).click();
    assert.equal(await page.getByRole('button').isDisabled(), true);
    await page.evaluate(() => window.historySuccess({ total: 2, eventos: [
      { visita: '<img src=x>', data: '2025', status: 'Realizado' },
      { visita: 'V2', data: '2025', status: 'Agendado' }
    ] }));
    assert.equal(await page.locator('img').count(), 0);
    assert.ok((await page.locator('#history').textContent()).includes('<img src=x>'));
    assert.equal(await page.getByRole('button').count(), 0);
    await page.locator('summary').click();
    await page.locator('summary').click();
    assert.equal(await page.evaluate(() => window.historyCalls), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
