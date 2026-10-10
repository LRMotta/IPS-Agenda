'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function fixture() {
  let now = 1000000;
  const events = {}, requests = [], renders = [], errors = [], finishes = [];
  const kpis = { style: { opacity: '1', pointerEvents: '' } };
  const status = { textContent: 'Dados atualizados.' }, button = { disabled: false };
  const page = { classList: { contains: () => true }, setAttribute(name, value) { this[name] = value; } };
  const nodes = { dashKpis: kpis, dashLoadStatus: status, btnDashRefresh: button, 'page-dashboard': page };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } }, Math,
    window: { addEventListener: (name, callback) => { (events[name] ||= []).push(callback); } },
    document: { readyState: 'loading', hidden: false, getElementById: id => nodes[id] || null,
      querySelectorAll: () => [], addEventListener: (name, callback) => { (events[name] ||= []).push(callback); } },
    getCurrentPage: () => context.route, route: 'dashboard',
  });
  function runner(success, failure) {
    return { withSuccessHandler: fn => runner(fn, failure), withFailureHandler: fn => runner(success, fn),
      getDashboardData: request => requests.push({ success, failure, request }) };
  }
  context.google = { script: { run: runner() } };
  vm.runInContext(readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, ''), context);
  context.dashboardRenderFromSessionCache = () => false;
  context.dashboardStoreSessionCache = () => {};
  context.codexStartClientReadPerformance_ = () => ({ request: {}, rpc() {}, measure: (_stage, fn) => fn(), finish: success => finishes.push(success) });
  context.renderDashboard = data => { renders.push(data); return true; };
  context.mostrarErroDashboard = error => errors.push(error);
  context.carregarDashboard(false);
  requests[0].success({ id: 'initial' });
  return { context, requests, renders, errors, finishes, kpis, status, button, page,
    expire() { now += context.DASHBOARD_SESSION_CACHE_TTL_MS + 1; },
    emit(name) { for (const callback of events[name] || []) callback(); }, events };
}

test('Dashboard revalida por foco/visibilidade somente quando ativo, visível e vencido', () => {
  const f = fixture();
  f.emit('focus');
  f.emit('visibilitychange');
  assert.equal(f.requests.length, 1);
  f.expire();
  f.context.route = 'agenda';
  f.emit('focus');
  f.context.route = 'dashboard';
  f.context.document.hidden = true;
  f.emit('focus');
  f.emit('visibilitychange');
  assert.equal(f.requests.length, 1);
  f.context.document.hidden = false;
  f.emit('visibilitychange');
  f.emit('focus');
  assert.equal(f.requests.length, 2);
  assert.equal(f.button.disabled, false);
  assert.equal(f.page['aria-busy'], 'false');
  assert.deepEqual(f.kpis.style, { opacity: '1', pointerEvents: '' });
  assert.equal(f.renders.length, 1);
  f.requests[1].success({ id: 'updated' });
  assert.equal(f.renders.at(-1).id, 'updated');
  assert.equal(f.context._dashLoading, false);
  f.emit('focus');
  assert.equal(f.requests.length, 2);
  assert.equal(f.events.focus.length, 1);
  assert.equal(f.events.visibilitychange.length, 1);
});

test('Dashboard preserva dados e idade em falha ou resposta incompleta silenciosa e permite tentar novamente', () => {
  for (const response of [null, { erros: ['falha'] }, { secoes: { agenda: false } }, { ok: false }, []]) {
    const f = fixture();
    const stamp = f.context._dashLoadedAt;
    f.expire();
    f.emit('focus');
    f.requests[1].success(response);
    assert.equal(f.renders.length, 1);
    assert.equal(f.context._dashInited, true);
    assert.equal(f.context._dashLoadedAt, stamp);
    assert.equal(f.context._dashLoading, false);
    assert.match(f.status.textContent, /dados anteriores/);
    assert.equal(f.errors.length, 0);
    assert.equal(f.finishes.at(-1), false);
    f.emit('focus');
    assert.equal(f.requests.length, 3);
    f.requests[2].failure(new Error('RPC simulada'));
    assert.equal(f.context._dashLoadedAt, stamp);
    assert.equal(f.renders.length, 1);
    assert.equal(f.errors.length, 0);
  }
});

test('Falha de render silenciosa restaura o último conjunto de dados, sem registrar sucesso', () => {
  for (const throws of [true, false]) {
    const f = fixture();
    f.expire();
    f.context.renderDashboard = data => {
      f.renders.push(data);
      if (data.id === 'broken') {
        if (throws) throw new Error('render simulado');
        return false;
      }
      return true;
    };
    f.emit('focus');
    f.requests[1].success({ id: 'broken' });
    assert.equal(f.renders.at(-1).id, 'initial');
    assert.equal(f.context._dashLastData.id, 'initial');
    assert.equal(f.context._dashInited, true);
    assert.equal(f.finishes.at(-1), false);
    assert.equal(f.errors.length, 0);
  }
});

test('Atualizar durante revalidação descarta resposta antiga e executa apenas uma consulta posterior ao clique', () => {
  for (const failure of [false, true]) {
    const f = fixture();
    f.expire();
    f.emit('focus');
    f.context.carregarDashboard(true);
    f.context.carregarDashboard(true);
    assert.equal(f.requests.length, 2);
    if (failure) f.requests[1].failure(new Error('falha anterior')); else f.requests[1].success({ id: 'obsolete' });
    assert.equal(f.renders.length, 1);
    assert.equal(f.errors.length, 0);
    assert.equal(f.requests.length, 3);
    assert.equal(f.button.disabled, true);
    f.requests[2].success({ id: 'forced' });
    assert.equal(f.renders.at(-1).id, 'forced');
    assert.equal(f.button.disabled, false);
    assert.equal(f.context._dashRefreshQueued, false);
  }
});

test('Retorno à página com dados vencidos também consulta silenciosamente', () => {
  const f = fixture();
  f.expire();
  f.context.carregarDashboard(false);
  assert.equal(f.requests.length, 2);
  assert.equal(f.button.disabled, false);
  assert.equal(f.kpis.style.opacity, '1');
});
