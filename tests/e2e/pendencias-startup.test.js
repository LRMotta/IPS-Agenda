'use strict';
/* global window, document */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');

test('entrada Pendencias paralela ao bootstrap e aniversarios sob demanda na Agenda', async () => {
  // Browser plugin not available: Playwright local, RPCs simuladas e rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      for (const bootstrapFirst of [true, false]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
        await page.route('**/*', route => route.abort());
        await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Pendencias — teste local</title>' +
          readProjectFile('IndexStyles.html') + '<style>body{display:block;height:auto;overflow:auto;padding:16px}.material-symbols-outlined{display:none}.page{height:auto}</style></head><body>' +
          '<span id="topDate"></span><span id="userEmail"></span><span id="userInitial"></span><h1 id="topTitle"></h1><span id="topIcon"></span>' +
          '<button id="agendaNav" onclick="irPara(\'agenda\')">Agenda</button><button id="pendingNav" onclick="irPara(\'pendencias\')">Pendências</button>' +
          '<section class="page" id="page-pendencias"><button id="btnPendenciasRefresh"><span class="btn-label">Atualizar</span></button><span id="pendenciasTs"></span><div id="pendenciasStatus"></div><div id="pendenciasGrid" class="dash-pend-grid"></div></section>' +
          '<section class="page" id="page-agenda"><h2>Agenda</h2><div id="birthdays"></div></section></body></html>');
        await page.evaluate(() => {
          window.requests = [];
          window.INDEX_INITIAL_PAGE = 'pendencias';
          window.CURRENT_ACCESS = { ok: false };
          window.APP_USER_NAVIGATED = false;
          window.STATE = {};
          window.isEmbeddedModuleEnabled = () => false;
          window.codexClientNow_ = () => 0;
          window.codexClientBootstrapTraceId_ = () => 'simulated-startup';
          window.codexClientBootstrapPayloadBytes_ = () => 0;
          window.codexLogClientBootstrapPerformance_ = () => {};
          window.appConfirmNavigationIfDirty = () => true;
          window.closeMobileNav = window.appSyncNavAccessibility = window.resetAppScrollPosition = window.updateFloatingAddButton = () => {};
          window.renderAppVersion = window.startAppVersionWatcher = window.handleUserOAuthStatus = () => {};
          window.getRoutePageConfig = page => ({ label: page === 'agenda' ? 'Agenda' : 'Pendências', icon: '' });
          window.setCurrentPage = page => (window.CURRENT_PAGE = page);
          window.getCurrentPage = () => window.CURRENT_PAGE;
          window.initAgendaV1 = () => {};
          window.agendaSetTeamBirthdays = data => { document.getElementById('birthdays').textContent = data.map(item => item.name).join(', '); };
          window.esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
          function runner(success, failure) {
            const result = { withSuccessHandler: fn => runner(fn, failure), withFailureHandler: fn => runner(success, fn) };
            for (const method of ['getAppBootstrapData', 'getPendenciasOperacionais', 'getAniversariosEquipe']) result[method] = request => window.requests.push({ method, request, success, failure });
            return result;
          }
          window.google = { script: { run: runner() } };
        });
        const core = readProjectFile('IndexCoreScripts.html');
        await page.addScriptTag({ content: core.slice(core.indexOf('function applyAppBootstrapData('), core.indexOf('function renderAppVersion(')) });
        await page.addScriptTag({ content: core.slice(core.indexOf('function startCodexAppOnce('), core.indexOf('function navegarParaRotaWebApp(')) });
        await page.addScriptTag({ content: core.slice(core.indexOf('function irPara('), core.indexOf('function transporteLoadingHtml(')) });
        await page.addScriptTag({ content: readProjectFile('IndexPendenciasScripts.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
        await page.evaluate(() => window.startCodexAppOnce());
        assert.equal(await page.title(), 'Pendencias — teste local');
        assert.equal(await page.locator('#topTitle').innerText(), 'Pendências');
        assert.equal(await page.locator('#pendenciasGrid [aria-busy="true"]').count(), 9);
        assert.deepEqual(await page.evaluate(() => window.requests.map(r => r.method)), ['getAppBootstrapData', 'getPendenciasOperacionais']);
        await page.evaluate(first => {
          const bootstrap = () => window.requests[0].success({ access: { ok: true, email: 'reader@example.invalid' } });
          const pending = () => window.requests[1].success({ pendencias: { kitsVencendo: [{ descricao: 'Kit simulado', diasParaVencer: 2 }] } });
          if (first) { bootstrap(); pending(); } else { pending(); bootstrap(); }
        }, bootstrapFirst);
        assert.equal(await page.evaluate(() => window.requests.length), 2);
        assert.equal(await page.locator('#pendenciasGrid [aria-busy="true"]').count(), 0);
        assert.match(await page.locator('#pendenciasGrid').innerText(), /Kit simulado/);
        await page.locator('#agendaNav').click();
        assert.equal(await page.locator('#page-agenda').isVisible(), true);
        assert.equal(await page.evaluate(() => window.requests[2].method), 'getAniversariosEquipe');
        await page.evaluate(() => window.requests[2].success([{ name: 'Equipe simulada' }]));
        assert.equal(await page.locator('#birthdays').innerText(), 'Equipe simulada');
        await page.locator('#pendingNav').click();
        await page.locator('#agendaNav').click();
        assert.equal(await page.evaluate(() => window.requests.length), 3);
        assert.deepEqual(errors, []);
        const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
        fs.mkdirSync(artifacts, { recursive: true });
        await page.locator('#pendingNav').click();
        await page.screenshot({ path: path.join(artifacts, 'pendencias-bootstrap-paralelo-' + width + '-' + bootstrapFirst + '.png'), fullPage: true });
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
