'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function fixture(page, embedded = '') {
  const requests = [], renders = [];
  const context = vm.createContext({
    window: { INDEX_INITIAL_PAGE: page }, Date, Math,
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    CURRENT_ACCESS: { ok: false }, APP_USER_NAVIGATED: false,
    CADASTROS_BOOTSTRAP_CACHE: {}, CADASTROS_BOOTSTRAP_IN_FLIGHT: {}, CADASTROS_BOOTSTRAP_CACHE_TTL_MS: 120000,
    isEmbeddedModuleEnabled: name => name === embedded,
    codexClientNow_: () => 0, codexClientBootstrapTraceId_: () => 'modules-startup',
    codexLogClientBootstrapPerformance_() {}, codexClientBootstrapPayloadBytes_: () => 0,
    applyAppBootstrapData() {}, handleAppBootstrapFailure() {},
    getCurrentPage: () => context.currentPage,
  });
  context.document.getElementById = id => id === 'topDate' ? {} : null;
  function runner(success, failure) {
    return { withSuccessHandler: fn => runner(fn, failure), withFailureHandler: fn => runner(success, fn),
      getAppBootstrapData: request => requests.push({ method: 'getAppBootstrapData', request, success, failure }),
      getDashboardData: request => requests.push({ method: 'getDashboardData', request, success, failure }) };
  }
  context.google = { script: { run: runner() } };
  context.appServerRun = options => requests.push({ method: options.method, request: options.args, success: options.onSuccess, failure: options.onFailure });
  const core = readProjectFile('IndexCoreScripts.html');
  vm.runInContext(core.slice(core.indexOf('function cadastroBootstrapCacheValid('), core.indexOf('function appMarkUnsavedChanges(')), context);
  vm.runInContext(core.slice(core.indexOf('function startCodexAppOnce('), core.indexOf('function navegarParaRotaWebApp(')), context);
  vm.runInContext(readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, ''), context);
  context.renderDashboard = data => { renders.push(data); return true; };
  context.mostrarErroDashboard = () => {};
  context.dashboardStoreSessionCache = () => {};
  context.irPara = (route, options) => {
    context.currentPage = route;
    if (options && options.shellOnly) return;
    if (route === 'dashboard') context.carregarDashboard(false);
    else context.getCadastrosBootstrapCached(route, data => renders.push(data));
  };
  return { context, requests, renders };
}

for (const page of ['participantes', 'projetos', 'medicos', 'monitores', 'feriados', 'dashboard']) {
  for (const dataFirst of [true, false]) {
    test(page + ': consulta começa antes da resposta do bootstrap, dados chegam ' + (dataFirst ? 'antes' : 'depois'), () => {
      const f = fixture(page, page === 'dashboard' ? 'dashboard' : '');
      f.context.startCodexAppOnce();
      assert.deepEqual(f.requests.map(r => r.method), ['getAppBootstrapData', page === 'dashboard' ? 'getDashboardData' : 'getCadastrosBootstrapData']);
      if (page !== 'dashboard') {
        assert.deepEqual(Array.from(f.requests[1].request), [page]);
        assert.equal(f.renders.length, 0);
      }
      const payload = { data: ['simulado'] };
      const bootstrap = () => f.requests[0].success({});
      const data = () => f.requests[1].success(payload);
      if (dataFirst) { data(); bootstrap(); } else { bootstrap(); data(); }
      assert.equal(f.requests.length, 2);
      assert.equal(f.renders.length, 1);
      assert.equal(f.renders[0], payload);
      f.context.startCodexAppOnce();
      assert.equal(f.requests.length, 2);
    });
  }
}

test('falha antecipada permite nova tentativa após bootstrap e não deixa cache pendente', () => {
  for (const page of ['participantes', 'dashboard']) {
    const f = fixture(page, page === 'dashboard' ? 'dashboard' : '');
    f.context.startCodexAppOnce();
    f.requests[1].failure(new Error('falha simulada'));
    f.requests[0].success({});
    assert.equal(f.requests.length, 3);
    f.requests[2].success({ data: [] });
    assert.equal(f.renders.length, 1);
  }
});

test('navegação durante bootstrap não é substituída pelo cadastro antecipado', () => {
  const f = fixture('participantes');
  f.context.startCodexAppOnce();
  f.context.APP_USER_NAVIGATED = true;
  f.context.currentPage = 'projetos';
  f.requests[0].success({});
  f.requests[1].success({ data: [] });
  assert.equal(f.context.currentPage, 'projetos');
  assert.equal(f.renders.length, 0);
});

test('Dashboard com entrada de cache mantém validação e exibição após bootstrap, sem RPC extra', () => {
  const f = fixture('dashboard', 'dashboard');
  const data = { cached: true };
  const store = { getItem: () => JSON.stringify({ version: f.context.DASHBOARD_SESSION_CACHE_VERSION, cachedAt: Date.now(), data }) };
  f.context.window.sessionStorage = f.context.sessionStorage = store;
  f.context.startCodexAppOnce();
  assert.equal(f.requests.length, 1);
  assert.equal(f.renders.length, 0);
  f.requests[0].success({});
  assert.equal(f.requests.length, 1);
  assert.equal(f.renders[0].cached, true);
});

test('somente a rota solicitada é antecipada; migrações, redirecionamentos e Estoque mantêm fluxo', () => {
  for (const page of ['equipamentos', 'medicamentos', 'prestadores', 'labcentral', 'couriers', 'solicitantes', 'usuarios', 'agenda', 'estoque-view', 'dashboard']) {
    const f = fixture(page);
    f.context.startCodexAppOnce();
    assert.equal(f.requests.length, 1, page);
  }
  const stock = fixture('participantes', 'estoque');
  stock.context.startCodexAppOnce();
  assert.equal(stock.requests.length, 1);
});
