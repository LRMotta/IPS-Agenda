'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function serverFixture() {
  const users = new FakeSheet('Users', [
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversario', 'Formacao', 'Registro', 'Pode solicitar exames'],
    ['reader@example.invalid', 'Leitor simulado', 'readonly', 'Sim', '10/10', '', '', 'Sim']
  ]);
  let reads = 0;
  const getRange = users.getRange.bind(users);
  users.getRange = (...args) => {
    const range = getRange(...args), getValues = range.getValues.bind(range);
    range.getValues = () => { reads++; return getValues(); };
    return range;
  };
  const ss = new FakeSpreadsheet({ Users: users });
  const server = runFiles(['AgendaServerRules.gs', 'WebApp.gs'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Session: { getActiveUser: () => ({ getEmail: () => 'reader@example.invalid' }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) }
  });
  server.agendaWindowedLoadingV2EnabledForAccess_ = () => false;
  server.codexGetUserOAuthStatus_ = () => ({});
  server.codexGetAppVersion_ = () => ({});
  server.getDadosFormularioAgenda = () => ({ simulated: true });
  return { server, users, reads: () => reads };
}

test('bootstrap de Pendencias nao busca aniversarios nem formulario da Agenda, inclusive no modo legado', () => {
  const f = serverFixture();
  f.server.getDadosFormularioAgenda = () => { throw new Error('Formulario indevido'); };
  f.server.codexGetTeamBirthdays_ = () => { throw new Error('Aniversarios indevidos'); };
  const result = f.server.getAppBootstrapData({ page: 'pendencias' });
  assert.equal(result.access.ok, true);
  assert.equal(result.agendaFormData, null);
  assert.equal(Object.hasOwn(result, 'teamBirthdays'), false);
  assert.deepEqual(Object.keys(result.errors), []);
  assert.equal(f.reads(), 1);
});

test('Agenda reutiliza Users da autorizacao apenas na mesma RPC e mantem aniversarios e acesso frescos', () => {
  const f = serverFixture();
  const initial = f.server.getAppBootstrapData({ page: 'agenda' });
  assert.equal(initial.teamBirthdays[0].name, 'Leitor simulado');
  assert.equal(initial.agendaFormData.simulated, true);
  assert.equal(f.reads(), 1);
  f.users.rows[1][1] = 'Nome atualizado';
  const lazy = f.server.getAniversariosEquipe();
  assert.equal(lazy[0].name, 'Nome atualizado');
  assert.equal(f.reads(), 2);
  f.users.rows[1][3] = 'Nao';
  assert.throws(() => f.server.getAniversariosEquipe(), /inativo/);
  assert.equal(f.reads(), 3);
  assert.equal(f.server.getAppBootstrapData({ page: 'agenda' }).access.ok, false);
  assert.equal(f.reads(), 4);
});

function clientFixture(page = 'pendencias') {
  const requests = [], renders = [], routes = [];
  const grid = { innerHTML: '' };
  const context = vm.createContext({
    window: { INDEX_INITIAL_PAGE: page, STATE: {}, addEventListener() {} },
    document: { addEventListener() {}, getElementById: id => id === 'pendenciasGrid' ? grid : id === 'topDate' ? {} : null },
    Date, setTimeout: () => 1, clearTimeout() {},
    CURRENT_ACCESS: { ok: true }, APP_USER_NAVIGATED: false,
    isEmbeddedModuleEnabled: () => false, codexClientNow_: () => 0,
    codexClientBootstrapTraceId_: () => 'startup-test', codexLogClientBootstrapPerformance_() {},
    codexClientBootstrapPayloadBytes_: () => 0, handleAppBootstrapFailure() {},
    applyAppBootstrapData() {}, getCurrentPage: () => context.currentPage,
    agendaSetTeamBirthdays: data => renders.push(data),
  });
  function runner(success, failure) {
    const result = { withSuccessHandler: fn => runner(fn, failure), withFailureHandler: fn => runner(success, fn) };
    for (const method of ['getAppBootstrapData', 'getPendenciasOperacionais', 'getAniversariosEquipe']) {
      result[method] = request => requests.push({ method, request, success, failure });
    }
    return result;
  }
  context.google = { script: { run: runner() } };
  const core = readProjectFile('IndexCoreScripts.html');
  vm.runInContext(core.slice(core.indexOf('function appApplyTeamBirthdays_('), core.indexOf('function renderAppVersion(')), context);
  vm.runInContext(core.slice(core.indexOf('function startCodexAppOnce('), core.indexOf('function navegarParaRotaWebApp(')), context);
  vm.runInContext(readProjectFile('IndexPendenciasScripts.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, ''), context);
  context.renderDashboardPendencias = (_data, _id, loading) => { grid.innerHTML = loading ? 'skeleton' : 'dados'; };
  context.irPara = (route, options) => {
    context.currentPage = route;
    routes.push({ route, options });
    if (options.shellOnly) return;
    if (route === 'pendencias') context.carregarPendencias(false);
    if (route === 'agenda') context.carregarAniversariosAgenda_();
  };
  return { context, requests, renders, routes, grid };
}

for (const bootstrapFirst of [true, false]) {
  test('primeira carga paralela nao duplica consulta: bootstrap responde ' + (bootstrapFirst ? 'antes' : 'depois'), () => {
    const f = clientFixture();
    f.context.startCodexAppOnce();
    assert.deepEqual(f.requests.map(r => r.method), ['getAppBootstrapData', 'getPendenciasOperacionais']);
    assert.equal(f.requests[0].request.page, 'pendencias');
    assert.equal(f.grid.innerHTML, 'skeleton');
    assert.equal(f.routes[0].options.shellOnly, true);
    const bootstrap = () => f.requests[0].success({});
    const pending = () => f.requests[1].success({ pendencias: {} });
    if (bootstrapFirst) { bootstrap(); pending(); } else { pending(); bootstrap(); }
    f.context.startCodexAppOnce();
    assert.equal(f.requests.length, 2);
    assert.equal(f.grid.innerHTML, 'dados');
    assert.equal(f.context._pendenciasRefreshing, false);
  });
}

test('bootstrap com falha nao interrompe Pendencias e navegacao durante bootstrap e preservada', () => {
  const f = clientFixture();
  f.context.startCodexAppOnce();
  f.context.APP_USER_NAVIGATED = true;
  f.context.currentPage = 'projetos';
  f.requests[0].failure(new Error('Falha simulada'));
  f.requests[1].success({ pendencias: {} });
  assert.equal(f.context.currentPage, 'projetos');
  assert.equal(f.requests.length, 2);
  assert.equal(f.context._pendenciasRefreshing, false);
});

test('Agenda inicial conserva apenas bootstrap e abertura posterior busca aniversarios uma vez', () => {
  const f = clientFixture('agenda');
  f.context.startCodexAppOnce();
  assert.deepEqual(f.requests.map(r => r.method), ['getAppBootstrapData']);
  f.context.appApplyTeamBirthdays_([]); // Resposta vazia tambem e completa.
  f.requests[0].success({});
  assert.equal(f.requests.length, 1);
  const lazy = clientFixture();
  lazy.context.carregarAniversariosAgenda_();
  lazy.context.carregarAniversariosAgenda_();
  assert.equal(lazy.requests.length, 1);
  lazy.requests[0].failure(new Error('Falha simulada'));
  lazy.context.carregarAniversariosAgenda_();
  assert.equal(lazy.requests.length, 2);
  lazy.requests[1].success([{ name: 'Equipe simulada' }]);
  lazy.context.carregarAniversariosAgenda_();
  assert.equal(lazy.requests.length, 2);
  assert.equal(lazy.renders[0][0].name, 'Equipe simulada');
});

test('resposta de aniversarios anterior a edicao de perfil nao substitui os dados novos', () => {
  const f = clientFixture();
  f.context.carregarAniversariosAgenda_();
  f.context.appApplyTeamBirthdays_([{ name: 'Nome atualizado' }]);
  f.requests[0].success([{ name: 'Nome antigo' }]);
  assert.equal(f.context.window.APP_TEAM_BIRTHDAYS[0].name, 'Nome atualizado');
  assert.equal(f.renders.length, 1);
  f.context.CURRENT_ACCESS.ok = false;
  f.context.window.APP_TEAM_BIRTHDAYS_LOADED = false;
  f.context.carregarAniversariosAgenda_();
  assert.equal(f.requests.length, 1);
});

test('Agenda aberta durante bootstrap busca aniversarios assim que o perfil e validado', () => {
  const f = clientFixture();
  const core = readProjectFile('IndexCoreScripts.html');
  vm.runInContext(core.slice(core.indexOf('function applyAppBootstrapData('), core.indexOf('function appApplyTeamBirthdays_(')), f.context);
  f.context.CURRENT_ACCESS = { ok: false };
  f.context.document.getElementById = id => ['topDate', 'userEmail', 'userInitial'].includes(id) ? {} : null;
  f.context.document.querySelectorAll = () => [];
  f.context.renderAppVersion = () => {};
  f.context.startAppVersionWatcher = () => {};
  f.context.updateFloatingAddButton = () => {};
  f.context.handleUserOAuthStatus = () => {};
  f.context.startCodexAppOnce();
  f.context.APP_USER_NAVIGATED = true;
  f.context.irPara('agenda', {});
  assert.equal(f.requests.length, 2);
  f.requests[0].success({ access: { ok: true, email: 'reader@example.invalid' } });
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].method, 'getAniversariosEquipe');
  assert.equal(f.context.currentPage, 'agenda');
  f.requests[1].success({ pendencias: {} });
  f.requests[2].success([]);
  assert.equal(f.context.window.APP_TEAM_BIRTHDAYS_LOADED, true);
});
