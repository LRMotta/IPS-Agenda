'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');

test('Dashboard revalida silenciosamente sem bloquear indicadores e mantém dados após falha', async () => {
  // Browser plugin indisponível: Playwright local, RPCs simuladas, rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      await page.route('**/*', request => request.abort());
      await page.setContent('<!doctype html><html><head><title>Dashboard — teste local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexDashboardStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '<style>body{display:block;height:auto;overflow:auto;padding:16px}.page{height:auto}.material-symbols-outlined{display:none}</style></head><body>' +
        readProjectFile('IndexDashboardContent.html') + '</body></html>');
      await page.evaluate(() => {
        window.requests = [];
        window.esc = value => String(value || '');
        window.projetoEstaAtivo_ = () => true;
        window.getCurrentPage = () => 'dashboard';
        window.Chart = function(_canvas, config) { this.data = config.data; this.destroy = this.update = () => {}; };
        window.makeDashboardData = total => ({ projetos: [], participantesResumo: { total, ativos: total - 1, porProjeto: {}, cidades: {} }, estoqueResumo: {}, agendaResumo: {} });
        function runner(success, failure) {
          return { withSuccessHandler: fn => runner(fn, failure), withFailureHandler: fn => runner(success, fn),
            getDashboardData: request => window.requests.push({ request, success, failure }) };
        }
        window.google = { script: { run: runner() } };
      });
      await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      await page.evaluate(() => {
        document.getElementById('page-dashboard').classList.add('active');
        window.carregarDashboard(false);
        window.requests[0].success(window.makeDashboardData(12));
      });
      assert.equal(await page.title(), 'Dashboard — teste local');
      assert.equal(await page.locator('#kpiPart').textContent(), '12');
      await page.locator('#dashAgendaPeriodTipo').selectOption('global');
      const timestamp = await page.locator('#dashTs').textContent();
      await page.evaluate(() => {
        window._dashLoadedAt = Date.now() - window.DASHBOARD_SESSION_CACHE_TTL_MS - 1;
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await page.evaluate(() => window.requests.length), 2);
      assert.equal(await page.locator('#kpiPart').textContent(), '12');
      assert.equal(await page.locator('#btnDashRefresh').isEnabled(), true);
      assert.equal(await page.locator('#page-dashboard').getAttribute('aria-busy'), 'false');
      assert.equal(await page.locator('#dashKpis').evaluate(el => window.getComputedStyle(el).opacity), '1');
      assert.notEqual(await page.locator('#dashKpis').evaluate(el => window.getComputedStyle(el).pointerEvents), 'none');
      await page.evaluate(() => window.requests[1].failure(new Error('falha simulada')));
      assert.equal(await page.locator('#kpiPart').textContent(), '12');
      assert.equal(await page.locator('#dashTs').textContent(), timestamp);
      assert.equal(await page.locator('#dashErrorBox').count(), 0);
      assert.match(await page.locator('#dashLoadStatus').textContent(), /dados anteriores/);
      // Resposta parcial é rejeitada antes de destruir os gráficos existentes.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        window.requests[2].success({ erros: ['falha simulada'] });
        window.dispatchEvent(new Event('focus'));
      });
      assert.equal(await page.locator('#kpiPart').textContent(), '12');
      // Exercita o rollback do renderizador real, após destruir os gráficos.
      await page.evaluate(() => window.requests[3].success({ projetos: 'resposta inválida' }));
      assert.equal(await page.locator('#kpiPart').textContent(), '12');
      assert.equal(await page.locator('#dashTs').textContent(), timestamp);
      assert.equal(await page.locator('#dashErrorBox').count(), 0);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        window.requests[4].success(window.makeDashboardData(15));
      });
      assert.equal(await page.locator('#kpiPart').textContent(), '15');
      assert.equal(await page.locator('#dashAgendaPeriodTipo').inputValue(), 'global');
      await page.evaluate(() => {
        window._dashLoadedAt = Date.now() - window.DASHBOARD_SESSION_CACHE_TTL_MS - 1;
        window.dispatchEvent(new Event('focus'));
      });
      await page.locator('#btnDashRefresh').click();
      assert.equal(await page.locator('#btnDashRefresh').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.requests.length), 6);
      await page.evaluate(() => window.requests[5].success(window.makeDashboardData(99)));
      assert.equal(await page.locator('#kpiPart').textContent(), '15');
      assert.equal(await page.evaluate(() => window.requests.length), 7);
      await page.evaluate(() => window.requests[6].success(window.makeDashboardData(18)));
      assert.equal(await page.locator('#kpiPart').textContent(), '18');
      assert.equal(await page.locator('#btnDashRefresh').isEnabled(), true);
      assert.equal(await page.locator('#dashAgendaPeriodTipo').inputValue(), 'global');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await page.evaluate(() => window.requests.length), 7);
      assert.deepEqual(errors, []);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'dashboard-background-' + width + '.png') });
      await page.close();
    }
  } finally { await browser.close(); }
});
