'use strict';
/* global window, document, renderDashboard, renderDashboardAgenda */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile, runFile } = require('../helpers/load-app-script');
const { dashboardAgendaFixture } = require('../helpers/dashboard-agenda-fixture');

test('Agenda agregada preserva filtros, gráficos e únicos sem eventos no desktop e celular', async () => {
  const f = dashboardAgendaFixture();
  const summary = JSON.parse(JSON.stringify(f.server.getAgendaDashboardResumo_()));
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
      await page.route('**/*', r => r.abort());
      await page.setContent('<html><head><title>Agenda agregada — QA local</title>' + readProjectFile('IndexStyles.html') +
        readProjectFile('IndexDashboardStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + '</head><body>' +
        readProjectFile('IndexDashboardContent.html').replace('class="page"', 'class="page active"') + '</body></html>');
      await page.addScriptTag({ content: `window.Chart=function(ctx,config){this.config=config;this.data=config.data;this.options=config.options;this.destroy=function(){};this.update=function(){};};
        window.AgendaRules={countsIn:function(){throw new Error('Eventos não devem ser recalculados');}};
        window.esc=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');` });
      await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      await page.evaluate(s => { document.getElementById('dashAgendaBlock').style.display=''; renderDashboardAgenda(s); }, summary);
      assert.equal(await page.title(), 'Agenda agregada — QA local');
      assert.equal(page.url(), 'about:blank');
      assert.deepEqual(await page.locator('#dashAgendaPeriodAno option').evaluateAll(els => els.map(el => el.value)), ['2027', '2026']);
      await page.locator('#dashAgendaPeriodTipo').selectOption('ano');
      await page.locator('#dashAgendaPeriodAno').selectOption('2026');
      for (const [tipo, mes, expected] of [
        ['ano', null, summary.periodos.anos['2026']],
        ['mes', '2', summary.periodos.meses['2026-2']],
        ['mes', '3', { visits: 0, participants: 0, labs: 0 }],
        ['mes', '10', summary.periodos.meses['2026-10']],
        ['global', null, summary.periodos.global]
      ]) {
        await page.locator('#dashAgendaPeriodTipo').selectOption(tipo);
        if (mes) await page.locator('#dashAgendaPeriodMes').selectOption(mes);
        assert.equal(await page.locator('#dashAgendaVisitasAno').textContent(), String(expected.visits));
        assert.equal(await page.locator('#dashAgendaParticipantesAtendidos').textContent(), String(expected.participants));
        assert.equal(await page.locator('#dashAgendaLabAno').textContent(), String(expected.labs));
      }
      assert.equal(await page.locator('#chartAgendaVisitasMesTitle .dash-chart-title-text').textContent(), 'Visitas realizadas por ano');
      assert.equal(await page.locator('#dashAgendaPeriodAno').isVisible(), false);
      assert.equal(await page.locator('#dashAgendaMesCards .dash-kpi').count(), 1);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.locator('#dashAgendaPeriodTipo').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, 'agenda-aggregated-' + width + '.png') });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

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

test('Jornada exibe visitas desde 2026 sem seção anterior ou chamada histórica', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.abort());
    await page.setContent('<html><head><title>Jornada — QA local</title></head><body><main id="history"></main></body></html>');
    const source = readProjectFile('IndexCoreScripts.html');
    const renderer = source.slice(source.indexOf('function jornadaParticipanteHtml_('), source.indexOf('var _jornadaParticipanteAtual'));
    await page.addScriptTag({ content: `function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
      function appServerRun(){throw new Error('Consulta extra inesperada');}
      ${renderer}
      document.getElementById('history').innerHTML=jornadaParticipanteHtml_({possuiSoA:false,visitas:[],eventosLivres:[{visita:'V1',data:'02/10/2026',status:'Realizado'}],eventosAnteriores:[{visita:'LEGADO',data:'2025'}]});` });
    assert.equal(await page.getByRole('heading', { name: 'Visitas registradas desde 2026' }).count(), 1);
    assert.equal(await page.getByText('V1', { exact: true }).count(), 1);
    assert.equal(await page.getByText('LEGADO', { exact: true }).count(), 0);
    assert.equal(await page.locator('#jornadaHistoricoAnterior').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Carregar histórico' }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
