'use strict';
/* global window */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');

test('Dashboard mede consulta e render no navegador preservando botão, indicadores e cache', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const logs = [], errors = [];
    page.on('console', message => {
      if (message.text().startsWith('[CODEX_PERF_CLIENT] ')) logs.push(JSON.parse(message.text().slice(20)));
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html><body>' + readProjectFile('IndexDashboardContent.html') + '</body></html>');
    const core = readProjectFile('IndexCoreScripts.html');
    await page.addScriptTag({ content: core.slice(core.indexOf('function codexClientNow_()'), core.indexOf('function codexClientBootstrapPayloadBytes_')) });
    await page.addScriptTag({ content: `window.Chart=function(){this.destroy=function(){};this.update=function(){};};
      window.esc=v=>String(v||'');
      window.projetoEstaAtivo_=()=>true;
      window.google={script:{run:{withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},
      getDashboardData(request){window.measuredRequest=request;setTimeout(()=>this.success({projetos:[],participantesResumo:{total:12,ativos:8,porProjeto:{},cidades:{}},estoqueResumo:{},agendaResumo:{}}),10);}}}};` });
    await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '') });
    await page.evaluate(() => {
      window.dashboardRenderFromSessionCache = () => false;
      window.dashboardStoreSessionCache = () => { window.cacheWrites = (window.cacheWrites || 0) + 1; };
      window.renderDashboardAgenda = () => {};
      window.renderDashboardEstoque = () => {};
      window.carregarDashboard(true);
    });
    await page.waitForFunction(() => window.cacheWrites === 1);
    assert.equal(await page.locator('#btnDashRefresh').isEnabled(), true);
    assert.equal(await page.locator('#kpiPart').textContent(), '12');
    assert.equal(await page.locator('#kpiAtivos').textContent(), '8');
    assert.deepEqual(logs.map(e => e.stage), ['rpc', 'render_agenda', 'render_stock', 'render', 'session_cache_write', 'total']);
    assert.equal(logs.every(e => e.success && e.traceId === logs[0].traceId && e.durationMs >= 0), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
