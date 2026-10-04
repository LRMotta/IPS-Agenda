'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function fixture(fileName) {
  let clock = 0;
  const entries = [];
  const core = readProjectFile('IndexCoreScripts.html');
  const helpers = core.slice(core.indexOf('function codexClientNow_()'), core.indexOf('function codexClientBootstrapPayloadBytes_'));
  const context = vm.createContext({
    window: { performance: { now: () => clock }, console: { info: line => entries.push(JSON.parse(line.slice('[CODEX_PERF_CLIENT] '.length))) } },
    Date, Math, document: { readyState: 'loading', getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] },
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(helpers, context);
  if (fileName) vm.runInContext(readProjectFile(fileName).replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, ''), context);
  return { context, entries, advance: ms => { clock += ms; } };
}

test('telemetria separa RPC, render e total sem registrar dados e preserva exceções', () => {
  const f = fixture();
  const perf = f.context.codexStartClientReadPerformance_('getDashboardData', true);
  assert.match(perf.request.traceId, /^[A-Za-z0-9_-]{8,80}$/);
  f.advance(100);
  perf.rpc(true);
  assert.equal(perf.measure('render', () => { f.advance(7); return 'PRIVADO'; }), 'PRIVADO');
  perf.finish(true);
  perf.finish(false);
  assert.deepEqual(f.entries.map(e => [e.stage, e.durationMs]), [['rpc', 100], ['render', 7], ['total', 107]]);
  assert.equal(f.entries.every(e => e.traceId === perf.request.traceId && e.success && e.forceRefresh), true);
  assert.equal(JSON.stringify(f.entries).includes('PRIVADO'), false);
  const error = new Error('PRIVADO');
  assert.throws(() => perf.measure('render', () => { throw error; }), e => e === error);
  assert.equal(f.entries.at(-1).success, false);
  f.context.window.console.info = () => { throw error; };
  assert.equal(perf.measure('render', () => 42), 42);
});

test('Dashboard envia trace e mede RPC, render e escrita de cache preservando sucesso/falha', () => {
  const f = fixture('IndexDashboard.html');
  let success, failure, request;
  f.context.google = { script: { run: {
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler(fn) { failure = fn; return this; },
    getDashboardData(value) { request = value; }
  } } };
  f.context.dashboardRenderFromSessionCache = () => false;
  f.context.renderDashboard = () => { f.advance(4); return true; };
  f.context.dashboardStoreSessionCache = () => { f.advance(2); };
  f.context.mostrarErroDashboard = () => {};
  f.context.carregarDashboard(true);
  f.advance(100);
  success({});
  assert.equal(f.context._dashInited, true);
  assert.deepEqual(f.entries.map(e => [e.stage, e.durationMs]), [['rpc', 100], ['render', 4], ['session_cache_write', 2], ['total', 106]]);
  assert.equal(f.entries.every(e => e.traceId === request.traceId), true);
  f.context.carregarDashboard(true);
  f.advance(50);
  failure(new Error('PRIVADO'));
  assert.equal(f.context._dashInited, false);
  assert.equal(f.entries.at(-1).success, false);
  assert.equal(JSON.stringify(f.entries).includes('PRIVADO'), false);
});

test('Pendências descarta resposta anterior sem medir render e não duplica total', () => {
  const f = fixture('IndexPendenciasScripts.html');
  const requests = [];
  f.context.window.addEventListener = () => {};
  f.context.google = { script: { run: {
    withSuccessHandler(fn) { this.success = fn; return this; },
    withFailureHandler(fn) { this.failure = fn; return this; },
    getPendenciasOperacionais(request) { requests.push({ success: this.success, failure: this.failure, request }); }
  } } };
  f.context.renderDashboardPendencias = () => { f.advance(3); };
  f.context.atualizarPendenciasTs = () => {};
  f.context.carregarPendencias(true);
  f.context.carregarPendencias(true);
  f.advance(100);
  requests[0].success({ pendencias: {} });
  assert.equal(requests.length, 2);
  assert.deepEqual(f.entries.map(e => e.stage), ['rpc', 'total']);
  requests[0].success({ pendencias: {} });
  assert.equal(f.entries.length, 2);
  f.advance(50);
  requests[1].success({ pendencias: {} });
  assert.deepEqual(f.entries.slice(2).map(e => [e.stage, e.durationMs]), [['rpc', 50], ['render', 3], ['total', 53]]);
  assert.equal(f.entries.at(-1).traceId, requests[1].request.traceId);
});
