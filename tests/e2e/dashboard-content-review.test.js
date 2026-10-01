'use strict';
/* global document, window, dashboardChartData_, dashboardDrawEmptyChart_, dashboardSectionAvailability_,
   renderDashboardAgendaPeriodoResumo, bindDashboardChartCopyButtons, _barH, _doughnut,
   carregarDashboard */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('Dashboard responsivo: títulos, filtros, tabelas acessíveis e navegação por teclado', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Dashboard — QA local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexDashboardStyles.html') +
        readProjectFile('IndexStylesAfterDashboard.html') + '</head><body><main style="padding:16px">' +
        readProjectFile('IndexDashboardContent.html').replace('class="page"', 'class="page active"') +
        '</main></body></html>');
      // Isolate Google services and Chart.js: this test exercises DOM and data contracts.
      await page.addScriptTag({ content: `window.Chart=function(ctx,config){
        this.config=config;this.data=config.data;this.options=config.options;
        this.updates=0;this.destroy=function(){};this.update=function(){this.updates++};
      };` });
      await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script\b[^>]*>/i, '').replace(/<\/script\b[^>]*>\s*$/i, '') });
      await page.evaluate(() => {
        document.getElementById('dashAgendaBlock').style.display = '';
        document.getElementById('dashAgendaMesCards').innerHTML = Array.from({ length: 12 }, (_, i) =>
          '<div class="dash-kpi"><div class="dash-kpi-val">' + (i + 1) + '</div><div class="dash-kpi-lbl">Mês ' + (i + 1) + '</div></div>').join('');
        document.getElementById('dashAgendaPeriodAno').innerHTML = '<option>2026</option>';
        document.querySelectorAll('.dash-kpi-icon').forEach(el => { el.style.display = 'none'; });
        document.querySelectorAll('.material-symbols-outlined').forEach(el => { el.style.display = 'none'; });
        _barH('chartCoord', ['Ana <img src=x>', 'Outros'], [{ label: 'Projetos', data: [5, 2] }], label => { window.selectedCoordinator = label; });
        _doughnut('chartFase', ['II', 'III'], [3, 4]);
      });
      assert.equal(await page.title(), 'Dashboard — QA local');
      assert.equal(await page.getByRole('heading', { name: 'Dashboard Gerencial' }).count(), 1);
      assert.equal(await page.locator('#btnDashRefresh #dashTs').count(), 0);
      assert.equal(await page.locator('#dashTs').count(), 1);
      assert.ok((await page.locator('#chartPartProjTitle').textContent()).includes('exceto etapa regulatória'));
      assert.ok((await page.locator('#dashEstoqueBlock').textContent()).includes('Registros de estoque'));
      assert.equal(await page.locator('#dashAgendaBlock').evaluate(el => el.nextElementSibling.id), 'dashEstoqueBlock');
      for (const label of ['Período', 'Ano']) assert.equal(await page.getByRole('combobox', { name: label, exact: true }).count(), 1);
      assert.equal(await page.locator('#dashAgendaPeriodMes').getAttribute('aria-label'), 'Mês');
      assert.deepEqual(await page.locator('canvas').evaluateAll(canvases => canvases.map(canvas =>
        Boolean(document.getElementById(canvas.getAttribute('aria-labelledby'))))), Array(17).fill(true));
      assert.deepEqual(await page.locator('section').evaluateAll(sections => sections.map(section =>
        section.contains(document.getElementById(section.getAttribute('aria-labelledby'))))), Array(11).fill(true));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const stockCols = await page.locator('#dashEstoqueBlock .dash-grid').evaluate(el => window.getComputedStyle(el).gridTemplateColumns.split(' ').length);
      assert.equal(stockCols, width === 390 ? 1 : 5);
      const details = page.locator('#chartCoordData');
      await details.locator('summary').click();
      // Repeating an unchanged table preserves the DOM and keyboard focus.
      await details.locator('summary').focus();
      await page.evaluate(() => dashboardChartData_('chartCoord', ['Ana <img src=x>', 'Outros'], [{ label: 'Projetos', data: [5, 2] }], document.getElementById('chartCoordData')._dashboardRowClick));
      assert.equal(await details.locator('summary').evaluate(el => document.activeElement === el), true);
      assert.equal(await details.getByRole('cell', { name: '5', exact: true }).count(), 1);
      assert.equal(await details.locator('img').count(), 0);
      const coordinator = details.getByRole('button', { name: 'Abrir projetos do coordenador Ana <img src=x>', exact: true });
      await coordinator.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.selectedCoordinator), 'Ana <img src=x>');
      await page.evaluate(() => dashboardChartData_('chartCoord', ['Bia'], [{ label: 'Projetos', data: [8] }]));
      assert.equal(await details.getAttribute('open'), '');
      assert.ok((await details.innerText()).includes('Bia'));
      assert.ok(!(await details.innerText()).includes('Ana'));
      await page.evaluate(() => dashboardDrawEmptyChart_(document.getElementById('chartCoord'), 'Sem dados para o período selecionado'));
      assert.ok((await details.innerText()).includes('Sem dados para o período selecionado'));
      assert.equal(await details.locator('table').count(), 0);
      await page.evaluate(() => dashboardSectionAvailability_('dashAgendaBlock', false));
      assert.equal(await page.locator('#dashAgendaCardsTitle').isVisible(), false);
      await page.evaluate(() => {
        dashboardSectionAvailability_('dashAgendaBlock', true);
        window.AgendaRules = { countsIn: () => false };
        renderDashboardAgendaPeriodoResumo();
        bindDashboardChartCopyButtons();
      });
      await page.getByRole('combobox', { name: 'Período', exact: true }).selectOption('global');
      assert.equal(await page.locator('#dashAgendaCardsTitle').textContent(), 'Visitas realizadas por ano');
      assert.equal(await page.locator('#chartAgendaVisitasMesTitle .dash-chart-title-text').textContent(), 'Visitas realizadas por ano');
      assert.equal(await page.locator('.dash-chart-copy').count(), 17);
      await page.evaluate(() => {
        window.savedDashboardRender = window.renderDashboard;
        window.renderDashboard = () => true;
        window.google = { script: { run: {
          withSuccessHandler(fn) { window.dashboardSuccess = fn; return this; },
          withFailureHandler(fn) { window.dashboardFailure = fn; return this; },
          getDashboardData() {}
        } } };
        carregarDashboard(true);
      });
      assert.equal(await page.locator('#page-dashboard').getAttribute('aria-busy'), 'true');
      assert.equal(await page.getByRole('button', { name: 'Atualizar dados', exact: true }).isDisabled(), true);
      assert.ok((await page.locator('#dashLoadStatus').textContent()).includes('Atualizando'));
      await page.evaluate(() => window.dashboardSuccess({}));
      assert.equal(await page.locator('#page-dashboard').getAttribute('aria-busy'), 'false');
      assert.ok((await page.locator('#dashLoadStatus').textContent()).includes('atualizados'));
      await page.evaluate(() => { window.renderDashboard = window.savedDashboardRender; });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.dash-chart-copy').first().evaluate(el => window.getComputedStyle(el).transitionDuration), '0s');
      const artifactDir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifactDir, { recursive: true });
      await page.locator('#dashEstoqueBlock').screenshot({ path: path.join(artifactDir, 'dashboard-stock-' + width + '.png') });
      await page.screenshot({ path: path.join(artifactDir, 'dashboard-review-' + width + '.png') });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

