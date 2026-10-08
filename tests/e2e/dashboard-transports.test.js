'use strict';
/* global window, document, renderDashboard, renderDashboardAgenda, dashboardPrintHtml, renderDashTransportChart_ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { dashboardAgendaFixture } = require('../helpers/dashboard-agenda-fixture');
const { FakeSheet } = require('../helpers/fake-spreadsheet');

test('transportes: barras, filtros, detalhes sob demanda e impressão no desktop e celular', async t => {
  const f = dashboardAgendaFixture(), i = f.server.AGENDA_CFG.idx;
  const labs = new FakeSheet('LabCentral', [['ID', 'Nome', '', '', 'Cidade'],
    ['a', 'LABCORP (INDIANAPOLIS)', '', '', 'Indianapolis, IN'],
    ['b', 'LABCORP (TORRANCE)', '', '', 'Torrance, CA']]);
  f.server.getCodexSpreadsheet_ = () => ({ getSheetByName: () => labs });
  f.sheet.rows.splice(1);
  function add(date, eventStatus, slots) {
    const r = f.row(date, 'Visita', eventStatus);
    [i.c1, i.c2, i.c3].forEach((c, n) => {
      const slot = slots[n] || [];
      r[c.nome] = slot[0] || ''; r[c.status] = slot[1] || ''; r[c.destino] = slot[2] || '';
      r[c.material] = slot[3] || '';
    });
    f.sheet.rows.push(r);
  }
  add('06/01/2026', 'Realizado', [['Pinex (Agendamento)', 'Enviado', 'Lab A'], ['Pinex', 'Confirmado', 'Lab A'], ['Ocasa', 'Entregue', 'Lab B']]);
  add('06/12/2026', 'Agendado', [['Marken', 'Agendado', 'Lab B'], ['Marken', 'Não Agendado', 'Lab B']]);
  add('07/01/2026', 'Realizado', [['DHL', 'Cancelado', 'Lab C']]);
  add('08/01/2026', 'Realizado', [['Marken', 'Entregue', '']]);
  add('09/01/2026', 'Agendado', [['Marken', 'Agendado', '']]);
  add('10/01/2026', 'Realizado', [['Marken', 'Entregue', '', 'Labcorp Indianápolis - Plasma: 2 x 1 mL']]);
  const summary = JSON.parse(JSON.stringify(f.server.getAgendaDashboardResumo_()));
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  const realChart = process.env.DASHBOARD_CHART_JS_PATH;
  t.diagnostic(realChart ? 'Chart.js real local; rede bloqueada.' : 'Chart.js simulado; contratos e DOM. Defina DASHBOARD_CHART_JS_PATH para QA visual real.');
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', e => { if (['error', 'warning'].includes(e.type())) errors.push(e.text()); });
      await page.route('**/*', r => r.abort());
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Transportes — QA local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexDashboardStyles.html') + '</head><body><main style="padding:16px">' +
        readProjectFile('IndexDashboardContent.html').replace('class="page"', 'class="page active"') + '</main></body></html>');
      await page.addScriptTag({ content: realChart ? fs.readFileSync(realChart, 'utf8') :
        'window.Chart=function(ctx,config){this.config=config;this.data=config.data;this.options=config.options;this.destroy=function(){};this.update=function(){};};' });
      await page.addScriptTag({ content: 'window.esc=v=>String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");' });
      await page.addScriptTag({ content: 'window.projetoEstaAtivo_=p=>p.classificacaoStatus==="ativo";window.codexNormText=v=>String(v||"").toLowerCase();' });
      await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      await page.evaluate(s => renderDashboard({ projetos: [], participantes: [], agendaResumo: s, estoqueResumo: {} }), summary);
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'Transportes — QA local');
      assert.equal(await page.locator('#dashAgendaAtendimentos').getAttribute('open'), null);
      const transportDetails = page.locator('#dashAgendaTransportes');
      assert.equal(await transportDetails.getAttribute('open'), null);
      assert.deepEqual(await page.evaluate(() => Object.keys(window._dashCharts)), []);
      assert.equal(await page.locator('#chartAgendaCourierAnoData, #chartAgendaTransportLabsData').count(), 0);
      await page.getByRole('combobox', { name: 'Período', exact: true }).selectOption('mes');
      await page.getByRole('combobox', { name: 'Mês', exact: true }).selectOption('12');
      assert.deepEqual(await page.evaluate(() => Object.keys(window._dashCharts)), []);
      await transportDetails.locator('summary').first().click();
      await page.waitForFunction(() => !!window._dashCharts.chartAgendaCourierAno);
      assert.deepEqual(await page.evaluate(() => window._dashCharts.chartAgendaCourierAno.data.labels), ['Marken']);
      await page.getByRole('combobox', { name: 'Período', exact: true }).selectOption('ano');
      assert.deepEqual(await page.evaluate(() => Object.keys(window._dashCharts).sort()), ['chartAgendaCourierAno', 'chartAgendaTransportLabs']);
      const chart = await page.evaluate(() => {
        const c = window._dashCharts.chartAgendaCourierAno;
        return { labels: c.data.labels, series: c.data.datasets.map(d => ({ label: d.label, data: d.data })), stacked: c.options.scales.x.stacked };
      });
      assert.equal(chart.stacked, true);
      assert.ok(chart.labels.includes('Pinex'));
      assert.ok(!chart.labels.includes('Pinex (Agendamento)'));
      assert.deepEqual(chart.series.map(s => s.label), ['Realizados', 'Previstos']);
      const transportLayout = await page.locator('.dash-transport-grid').evaluate(el => {
        const cards = Array.from(el.children);
        return { cards: cards.every(card => card.classList.contains('chart-card')),
          tops: cards.map(card => card.querySelector('.chart-wrap').getBoundingClientRect().top) };
      });
      assert.equal(transportLayout.cards, true);
      if (width === 1280) assert.ok(Math.abs(transportLayout.tops[0] - transportLayout.tops[1]) < 2, 'Notas não devem deslocar apenas um dos gráficos');
      const help = page.locator('#dashTransportHelp');
      assert.equal(await help.getAttribute('open'), null);
      await help.locator('summary').press('Enter');
      assert.equal(await help.getAttribute('open'), '');
      assert.ok((await help.innerText()).includes('Backup não incluído'));
      assert.ok((await help.innerText()).includes('não comprova agendamento sem destino'));
      assert.ok((await help.innerText()).includes('um agendamento pode ter vários transportes'));
      await help.locator('summary').press('Enter');
      assert.equal(await help.getAttribute('open'), null);
      const columns = await page.locator('#dashAgendaBlock > .dash-grid-5').evaluate(el =>
        window.getComputedStyle(el).gridTemplateColumns.split(' ').length);
      assert.equal(columns, width === 390 ? 2 : 5);
      if (width === 390) {
        const last = await page.locator('#dashAgendaTotalAno').evaluate(el => window.getComputedStyle(el.parentElement).gridColumn);
        assert.equal(last, '1 / -1');
        const copy = page.getByRole('button', { name: 'Copiar gráfico Laboratórios de destino', exact: true });
        assert.equal(await copy.isVisible(), true);
        assert.equal(await copy.locator('span').last().evaluate(el => window.getComputedStyle(el).display), 'none');
      }
      await page.evaluate(() => renderDashTransportChart_('chartAgendaTransportLabs', Array.from({ length: 10 }, (_, n) =>
        ({ label: 'Laboratório ' + n, realizados: 200 + n, previstos: 30, value: 230 + n }))));
      assert.equal(await page.locator('#chartAgendaTransportLabs').evaluate(el => el.parentElement.style.height), '352px');
      assert.equal(await page.locator('#chartAgendaCourierAno').evaluate(el => el.parentElement.style.height), '240px');
      if (realChart) {
        const ticks = await page.evaluate(() => window._dashCharts.chartAgendaTransportLabs.scales.x.ticks.map(tick => tick.value));
        assert.ok(ticks.length <= 6, 'Escala legível mesmo com totais grandes');
        assert.ok(ticks.every(Number.isInteger));
      }
      await page.evaluate(s => renderDashboardAgenda(s), summary);
      await page.locator('#chartAgendaTransportLabsData summary').click();
      assert.equal(await page.locator('#chartAgendaTransportLabsData thead').textContent(), 'CategoriaRealizadosPrevistosTotal');
      assert.ok((await page.locator('#chartAgendaTransportLabsData').innerText()).includes('Lab B'));
      assert.ok((await page.locator('#chartAgendaTransportLabsData').innerText()).includes('LABCORP (INDIANAPOLIS)'));
      assert.ok((await page.locator('#chartAgendaTransportLabsData').innerText()).includes('Destino não identificado na Agenda'));
      assert.ok(!(await page.locator('#chartAgendaTransportLabsData').innerText()).includes('Sem destino informado'));
      assert.ok((await help.textContent()).includes('não comprova agendamento sem destino'));
      const destinationChart = await page.evaluate(() => {
        const c = window._dashCharts.chartAgendaTransportLabs;
        const n = c.data.labels.findIndex(label => String(label).startsWith('Destino não'));
        return c.data.datasets.map(d => d.data[n]);
      });
      assert.deepEqual(destinationChart, [1, 1]);
      const totals = await page.evaluate(() => ['chartAgendaCourierAno', 'chartAgendaTransportLabs'].map(id =>
        window._dashCharts[id].data.datasets.map(d => d.data.reduce((sum, value) => sum + value, 0))));
      assert.deepEqual(totals[0], totals[1]);
      assert.ok((await help.textContent()).includes('um agendamento pode ter vários transportes'));
      await page.locator('#chartAgendaTransportLabsData summary').click();
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      const captureHeight = Math.ceil(await page.locator('#dashAgendaBlock').evaluate(e => e.getBoundingClientRect().height)) + 40;
      await page.setViewportSize({ width, height: Math.max(900, captureHeight) });
      await page.locator('#dashAgendaBlock').screenshot({ path: path.join(artifacts, 'dashboard-transports-' + width + '.png') });
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#dashAgendaAtendimentos > summary').click();
      await page.waitForFunction(() => !!window._dashCharts.chartAgendaVisitasMes && !!window._dashCharts.chartAgendaProt);
      const expandedHeight = await page.locator('#dashAgendaBlock').evaluate(e => e.getBoundingClientRect().height);
      await page.locator('#dashAgendaAtendimentos > summary').click();
      const compactHeight = await page.locator('#dashAgendaBlock').evaluate(e => e.getBoundingClientRect().height);
      assert.ok(compactHeight < expandedHeight - 800);
      await page.evaluate(() => { window.transportChartBeforeClose = window._dashCharts.chartAgendaCourierAno; });
      await transportDetails.locator('summary').first().click();
      await page.getByRole('combobox', { name: 'Período', exact: true }).selectOption('mes');
      await page.getByRole('combobox', { name: 'Mês', exact: true }).selectOption('12');
      assert.ok((await page.evaluate(() => window._dashCharts.chartAgendaCourierAno.data.labels)).includes('Pinex'), 'Persiana fechada não atualiza os gráficos');
      assert.equal(await page.locator('#dashAgendaVisitasAno').textContent(), '0');
      const print = await page.evaluate(() => dashboardPrintHtml());
      assert.ok(print.includes('Laboratórios de destino'));
      assert.ok(print.includes('Visitas realizadas por mês'));
      assert.equal(await page.locator('#dashAgendaAtendimentos').getAttribute('open'), null);
      assert.equal(await transportDetails.getAttribute('open'), null);
      assert.deepEqual(await page.evaluate(() => window._dashCharts.chartAgendaCourierAno.data.labels), ['Marken']);
      await transportDetails.locator('summary').first().click();
      await page.waitForFunction(() => document.getElementById('dashAgendaTransportes').open && window._dashCharts.chartAgendaCourierAno.data.labels.length === 1);
      assert.equal(await page.evaluate(() => window._dashCharts.chartAgendaCourierAno === window.transportChartBeforeClose), true, 'Reabrir reaproveita a instância');
      await page.locator('#dashAgendaAtendimentos > summary').click();
      assert.ok((await page.locator('#chartAgendaVisitasMesData').textContent()).includes('Sem dados'));
      await page.locator('#dashAgendaAtendimentos > summary').click();
      await page.getByRole('combobox', { name: 'Mês', exact: true }).selectOption('3');
      assert.equal(await page.evaluate(() => !!window._dashCharts.chartAgendaCourierAno), false);
      assert.ok((await page.locator('#chartAgendaTransportLabsData').textContent()).includes('Sem transportes'));
      await page.evaluate(() => window.dashboardSectionAvailability_('dashAgendaBlock', false));
      await page.locator('#dashAgendaAtendimentos > summary').click();
      await page.evaluate(() => dashboardPrintHtml());
      assert.equal(await page.locator('#dashAgendaVisitasAno').textContent(), 'Dados indisponíveis');
      assert.equal(await page.locator('#dashAgendaTotalAno').textContent(), 'Dados indisponíveis');
      await page.evaluate(s => { window.dashboardSectionAvailability_('dashAgendaBlock', true); renderDashboardAgenda(s); }, summary);
      assert.equal(await page.locator('#dashAgendaVisitasAno').textContent(), '0');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      t.diagnostic(`${width}px: Agenda compacta ${Math.round(compactHeight)}px; expandida ${Math.round(expandedHeight)}px; nenhum gráfico inicial da Agenda; 2 de Transporte e 7 de atendimentos sob demanda.`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
