'use strict';
/* global window */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');

test('Dashboard conserva gráficos idênticos, atualiza alterações e limpa gráficos vazios', async t => {
  // Browser plugin indisponível: Playwright local, sem RPCs ou rede real.
  const realChart = process.env.DASHBOARD_CHART_JS_PATH;
  t.diagnostic(realChart ? 'Chart.js real, mesma versão do app.' : 'Chart.js simulado; defina DASHBOARD_CHART_JS_PATH para testar render real.');
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      await page.route('**/*', request => request.abort());
      await page.setContent('<!doctype html><html><head><title>Dashboard — gráficos locais</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexDashboardStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '<style>body{display:block;height:auto;overflow:auto;padding:16px}.page{height:auto}.material-symbols-outlined{display:none}</style></head><body>' +
        readProjectFile('IndexDashboardContent.html').replace('class="page"', 'class="page active"') + '</body></html>');
      await page.addScriptTag({ content: realChart ? fs.readFileSync(realChart, 'utf8') :
        'window.Chart=function(ctx,config){this.canvas=ctx.canvas;this.config=config;this.data=config.data;this.options=config.options;this.destroy=function(){};this.update=function(){};};' });
      await page.evaluate(() => {
        window.chartCounts = { created: 0, destroyed: 0, updated: 0 };
        const Base = window.Chart;
        if (Base.defaults) Base.defaults.animation = false;
        window.Chart = new Proxy(Base, { construct(target, args, newTarget) {
          const instance = Reflect.construct(target, args, newTarget);
          window.chartCounts.created++;
          const update = instance.update.bind(instance), destroy = instance.destroy.bind(instance);
          instance.update = mode => { if (mode === 'none') window.chartCounts.updated++; return update(mode); };
          instance.destroy = () => { window.chartCounts.destroyed++; return destroy(); };
          return instance;
        } });
        window.projetoEstaAtivo_ = project => project.status === 'Ativo';
        window.codexNormText = value => String(value || '').toLowerCase();
        window.esc = value => String(value || '');
        window.payload = { projetos: [{ id: 'P1', nomeAbreviado: 'Estudo', status: 'Ativo', fase: 'III', especialidade: 'Clínica',
          cro: 'ORPC', patrocinador: 'Patrocinador', investigador: 'Investigador', coordenador: 'Coordenador' }],
          participantesResumo: { total: 1, ativos: 1, porProjeto: { estudo: { total: 1, ativos: 1, ativosStrict: 1 } }, cidades: { Cidade: 1 }, faixasEtarias: { total: 23, semNascimentoValido: 2, faixas: ['10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–99'].map((label, i) => ({ label, value: [1, 2, 5, 6, 4, 3, 2, 0, 0][i] })) } } };
      });
      await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      await page.evaluate(() => { window.renderDashboard(window.payload); window.firstCharts = { ...window._dashCharts }; });
      assert.equal(await page.title(), 'Dashboard — gráficos locais');
      assert.equal(await page.locator('#kpiProjetos').textContent(), '1');
      await page.evaluate(() => window.renderDashboard(JSON.parse(JSON.stringify(window.payload))));
      assert.deepEqual(await page.evaluate(() => window.chartCounts), { created: 10, destroyed: 0, updated: 0 });
      assert.equal(await page.evaluate(() => Object.keys(window.firstCharts).every(id => window.firstCharts[id] === window._dashCharts[id])), true);
      await page.evaluate(() => {
        window.payload.participantesResumo.cidades.Cidade = 2;
        window.renderDashboard(window.payload);
      });
      assert.deepEqual(await page.evaluate(() => window.chartCounts), { created: 10, destroyed: 0, updated: 1 });
      assert.match(await page.locator('#chartPartCidadeData').textContent(), /2/);
      await page.locator('#chartPartIdadeData summary').click();
      assert.match(await page.locator('#chartPartIdadeData').textContent(), /30–39/);
      assert.match(await page.locator('#chartPartIdadeNote').textContent(), /Sem nascimento válido: 2/);
      assert.equal(await page.locator('#chartPartIdade').evaluate(el => el.getBoundingClientRect().right <= window.innerWidth), true);
      const ageArtifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(ageArtifacts, { recursive: true });
      await page.locator('[aria-labelledby="chartPartIdadeTitle"].chart-card').screenshot({ path: path.join(ageArtifacts, 'dashboard-idade-' + width + '.png') });
      await page.locator('#chartPartIdadeData summary').click();
      await page.setViewportSize({ width: width === 390 ? 420 : 1100, height: 900 });
      await page.evaluate(() => window.renderDashboard(window.payload));
      assert.equal(await page.evaluate(() => window._dashCharts.chartFase.canvas.width > 0), true);
      assert.equal(await page.evaluate(() => window.dashboardPrintHtml().includes('data:image/png')), true);
      const createdAfterPrint = await page.evaluate(() => window.chartCounts.created);
      await page.evaluate(() => window.renderDashboard({ projetos: [], participantes: [] }));
      // A impressão prepara gráficos de seções recolhidas. Eles são atualizados
      // ao expandir; todos os gráficos principais devem ser limpos agora.
      assert.equal(await page.evaluate(() => Object.keys(window.firstCharts).filter(id => window._dashCharts[id]).length), 0);
      assert.equal(await page.evaluate(() => window.chartCounts.destroyed), 10);
      assert.match(await page.locator('#chartFaseData').textContent(), /Sem dados/);
      await page.evaluate(() => window.renderDashboard(window.payload));
      assert.equal(await page.evaluate(() => window.chartCounts.created), createdAfterPrint + 10);
      assert.deepEqual(errors, []);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'dashboard-chart-refresh-' + width + '.png') });
      await page.close();
    }
  } finally { await browser.close(); }
});
