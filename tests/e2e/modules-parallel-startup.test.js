'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');

test('Dashboard e cadastro abrem com consulta paralela, sem duplicação ou erro de interface', async () => {
  // Browser plugin indisponível: Playwright local com RPCs simuladas e rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const route of ['dashboard', 'medicos']) {
      for (const width of [1280, 390]) {
        for (const dataFirst of [true, false]) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
          await page.route('**/*', request => request.abort());
          await page.setContent('<!doctype html><html><head><title>Teste local — carga paralela</title>' + readProjectFile('IndexStyles.html') +
            readProjectFile('IndexDashboardStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
            '<style>body{display:block;height:auto;overflow:auto;padding:16px}.material-symbols-outlined{display:none}.page{height:auto}</style></head><body>' +
            '<span id="topDate"></span><h1 id="topTitle"></h1><span id="topIcon"></span>' +
            '<div id="navCadastrosToggle"></div><div id="navCadastrosBody"></div>' +
            readProjectFile('IndexDashboardContent.html') +
            '<section class="page" id="page-medicos"><span id="medicosStatus"></span><table id="tableMedicos"><tbody id="bodyMedicos"></tbody></table></section></body></html>');
          await page.evaluate(initialRoute => {
            window.INDEX_INITIAL_PAGE = initialRoute;
            window.APP_USER_NAVIGATED = false;
            window.CURRENT_ACCESS = { ok: false };
            window.requests = [];
            window.CADASTROS_BOOTSTRAP_CACHE = {};
            window.CADASTROS_BOOTSTRAP_IN_FLIGHT = {};
            window.CADASTROS_BOOTSTRAP_CACHE_TTL_MS = 300000;
            window.isEmbeddedModuleEnabled = name => name === 'dashboard' && initialRoute === 'dashboard';
            window.codexClientNow_ = () => 0;
            window.codexClientBootstrapTraceId_ = () => 'modules-startup';
            window.codexClientBootstrapPayloadBytes_ = () => 0;
            window.codexLogClientBootstrapPerformance_ = () => {};
            window.applyAppBootstrapData = () => { window.CURRENT_ACCESS = { ok: true }; };
            window.handleAppBootstrapFailure = () => {};
            window.appConfirmNavigationIfDirty = () => true;
            window.closeMobileNav = window.appSyncNavAccessibility = window.resetAppScrollPosition = window.updateFloatingAddButton = () => {};
            window.getRoutePageConfig = name => ({ label: name === 'dashboard' ? 'Dashboard' : 'Médicos', icon: '' });
            window.setCurrentPage = name => (window.CURRENT_PAGE = name);
            window.getCurrentPage = () => window.CURRENT_PAGE;
            window.sortCadastroByField = data => data;
            window.renderMedicos = data => {
              document.getElementById('tableMedicos').setAttribute('aria-busy', 'false');
              document.getElementById('medicosStatus').textContent = 'Dados carregados';
              document.getElementById('bodyMedicos').textContent = data.map(item => item.nome).join(', ');
            };
            window.esc = value => String(value || '');
            window.projetoEstaAtivo_ = () => true;
            window.Chart = function() { this.destroy = function() {}; this.update = function() {}; };
            function runner(success, failure) {
              const rpc = { withSuccessHandler: fn => runner(fn, failure), withFailureHandler: fn => runner(success, fn) };
              for (const method of ['getAppBootstrapData', 'getDashboardData']) rpc[method] = request => window.requests.push({ method, request, success, failure });
              return rpc;
            }
            window.google = { script: { run: runner() } };
            window.appServerRun = options => window.requests.push({ method: options.method, success: options.onSuccess, failure: options.onFailure });
          }, route);
          const core = readProjectFile('IndexCoreScripts.html');
          for (const [start, end] of [
            ['function cadastroBootstrapCacheValid(', 'function appMarkUnsavedChanges('],
            ['function startCodexAppOnce(', 'function navegarParaRotaWebApp('],
            ['function irPara(', 'function transporteLoadingHtml('],
            ['function carregarMedicos(', 'function renderMedicos('],
          ]) await page.addScriptTag({ content: core.slice(core.indexOf(start), core.indexOf(end)) });
          await page.addScriptTag({ content: readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
          await page.evaluate(() => {
            window.dashboardRenderFromSessionCache = () => false;
            window.dashboardStoreSessionCache = () => {};
            window.renderDashboardAgenda = window.renderDashboardEstoque = () => {};
            window.startCodexAppOnce();
          });
          assert.deepEqual(await page.evaluate(() => window.requests.map(r => r.method)),
            ['getAppBootstrapData', route === 'dashboard' ? 'getDashboardData' : 'getCadastrosBootstrapData']);
          if (route === 'dashboard') {
            assert.equal(await page.locator('#page-dashboard').isVisible(), true);
            assert.equal(await page.locator('#btnDashRefresh').isDisabled(), true);
            assert.equal(await page.locator('#page-dashboard').getAttribute('aria-busy'), 'true');
          }
          await page.evaluate(first => {
            const bootstrap = () => window.requests[0].success({});
            const data = () => window.requests[1].success(window.INDEX_INITIAL_PAGE === 'dashboard'
              ? { projetos: [], participantesResumo: { total: 12, ativos: 8, porProjeto: {}, cidades: {} }, estoqueResumo: {}, agendaResumo: {} }
              : { data: [{ nome: 'Médico simulado' }], config: { especialidades: ['Simulada'] } });
            if (first) { data(); bootstrap(); } else { bootstrap(); data(); }
          }, dataFirst);
          assert.equal(await page.evaluate(() => window.requests.length), 2);
          assert.equal(await page.locator('#page-' + route).isVisible(), true);
          if (route === 'dashboard') {
            assert.equal(await page.locator('#kpiPart').textContent(), '12');
            assert.equal(await page.locator('#btnDashRefresh').isEnabled(), true);
            assert.equal(await page.locator('#page-dashboard').getAttribute('aria-busy'), 'false');
            await page.locator('#btnDashRefresh').click();
            assert.equal(await page.evaluate(() => window.requests[2].method), 'getDashboardData');
            assert.equal(await page.locator('#btnDashRefresh').isDisabled(), true);
            await page.evaluate(() => window.requests[2].success({ projetos: [], participantesResumo: { total: 13, ativos: 9, porProjeto: {}, cidades: {} }, estoqueResumo: {}, agendaResumo: {} }));
            assert.equal(await page.locator('#kpiPart').textContent(), '13');
            assert.equal(await page.locator('#btnDashRefresh').isEnabled(), true);
          } else {
            assert.equal(await page.locator('#bodyMedicos').textContent(), 'Médico simulado');
            assert.equal(await page.locator('#tableMedicos').getAttribute('aria-busy'), 'false');
          }
          assert.deepEqual(errors, []);
          assert.equal(await page.title(), 'Teste local — carga paralela');
          if (dataFirst && width === 390) {
            const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
            fs.mkdirSync(artifacts, { recursive: true });
            await page.screenshot({ path: path.join(artifacts, route + '-bootstrap-paralelo.png') });
          }
          if (route === 'dashboard') {
            // A entrada quente não ativa a página antes do perfil; inclusive o
            // MutationObserver da página deve aguardar a abertura normal.
            await page.evaluate(() => {
              window.APP_BOOTSTRAP_STARTED = false;
              window._dashInited = false;
              window._dashLoadedAt = 0;
              document.getElementById('page-dashboard').classList.remove('active');
              window.requests = [];
              Object.defineProperty(window, 'sessionStorage', { configurable: true, value: {
                getItem: () => 'entrada existente',
              } });
            });
            await page.evaluate(() => window.startCodexAppOnce());
            assert.equal(await page.locator('#page-dashboard').isVisible(), false);
            assert.deepEqual(await page.evaluate(() => window.requests.map(r => r.method)), ['getAppBootstrapData']);
            await page.evaluate(() => window.requests[0].success({}));
            assert.equal(await page.locator('#page-dashboard').isVisible(), true);
            assert.deepEqual(await page.evaluate(() => window.requests.map(r => r.method)), ['getAppBootstrapData', 'getDashboardData']);
          }
          assert.deepEqual(errors, []);
          await page.close();
        }
      }
    }
  } finally { await browser.close(); }
});
