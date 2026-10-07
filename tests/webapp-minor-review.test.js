'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFile, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

test('doGet restringe páginas ao módulo e preserva parâmetros textuais para serialização segura', () => {
  const server = runFile('WebApp.gs');
  server.codexAuthorizeWebAppRequestSafe_ = () => ({ ok: true });
  server.agendaWindowedLoadingV2EnabledForAccess_ = () => false;
  let template;
  server.HtmlService = { createTemplateFromFile: () => {
    template = { evaluate: () => ({ addMetaTag() { return this; }, setTitle() { return this; } }) };
    return template;
  } };
  const hostile = '</script><script>alert(1)</script>';
  for (const [page, pagina, expected] of [
    ['index', hostile, 'agenda'], ['index', 'itens', 'agenda'], ['index', 'participantes', 'participantes'],
    ['estoque', hostile, 'itens'], ['estoque', 'usuarios', 'itens'], ['estoque', 'descartes', 'descartes'],
    ['estoque', 'estoque-view', 'visualizacao'], ['estoque-view', hostile, 'visualizacao'],
    ['pedidos', hostile, 'pedidos'], ['dashboard', hostile, 'dashboard']
  ]) {
    server.doGet({ parameter: { page, pagina, busca: hostile, dashFiltro: hostile, agendaId: hostile } });
    assert.equal(template.paginaInicial, expected);
    assert.equal(JSON.parse(server.codexJsonForScript_(template.paginaInicial)), expected);
    if (page === 'index') {
      assert.equal(template.agendaAbrirInicial, hostile);
      assert.equal(template.dashboardFiltroInicial, hostile);
    }
    if (page === 'estoque') assert.equal(template.buscaInicial, hostile);
  }
});

test('inicialização do Estoque aceita ambos os aliases e mantém fallback para rota inválida', () => {
  const source = readProjectFile('IndexCoreScripts.html').match(/function abrirPaginaInicialApp\(\) \{[\s\S]*?\n\}/)[0];
  for (const page of ['visualizacao', 'estoque-view', 'invalida']) {
    const calls = [];
    const search = { value: '' };
    const context = {
      APP_USER_NAVIGATED: false, getCurrentPage: () => '',
      window: { INDEX_INITIAL_PAGE: page, INDEX_INITIAL_SEARCH: 'Kit A' },
      isEmbeddedModuleEnabled: module => module === 'estoque',
      APP_ROUTE: { estoquePages: ['visualizacao', 'itens', 'pedidos', 'descartes', 'movimentacoes', 'relatorios'] },
      irParaEstoqueApp: value => calls.push(['estoque', value]), carregarEstoqueView: () => {},
      irPara: value => calls.push(['pagina', value]), document: { getElementById: () => search }
    };
    vm.runInNewContext(source + '\nabrirPaginaInicialApp();', context);
    assert.deepEqual(calls, page === 'invalida' ? [['estoque', 'itens']] : [['pagina', 'estoque-view']]);
    if (page !== 'invalida') assert.equal(search.value, 'Kit A');
  }
});

test('bootstrap normaliza visualizacao para estoque-view sem duplicar consultas', () => {
  const server = runFile('WebApp.gs');
  server.codexGetCurrentUserAccess = () => ({ ok: true });
  server.getEstoqueConfig = () => ({});
  let reads = 0;
  server.getEstoqueVisualizacao = () => { reads++; return []; };
  server.montarAlertasEstoque_ = () => [];
  server.getKitsBaixadosSemConciliacao_ = () => [];
  server.getEstoquePilotoData_ = () => ({});
  server.getParticipantes = () => [];
  for (const page of ['visualizacao', 'estoque-view']) {
    assert.equal(server.getEstoqueBootstrapData(page).page, 'estoque-view');
  }
  assert.equal(reads, 2);
  assert.throws(() => server.getEstoqueBootstrapData('invalida'), /nao suportado/);
});

test('carga de 500 perfis mantém registros de auditoria e grava uma vez por trilha sob lock', () => {
  const headers = ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames'];
  const rows = Array.from({ length: 500 }, (_, i) => [`p${i}@example.invalid`, 'Antes', 'user', 'Sim', '', '', '', 'Sim']);
  const users = new FakeSheet('Users', [headers, ...rows]);
  const log = new FakeSheet('Audit_Log', [['ID', 'Email', 'Ação', 'Data', 'Módulo', 'Registro'], ['LEGADO']]);
  const changes = new FakeSheet('Audit_Changes', [Array(10).fill('Header')]);
  const lock = fakeDocumentLock();
  const server = runFile('WebApp.gs', { LockService: lock.LockService });
  const ss = new FakeSpreadsheet({ Users: users, Audit_Log: log, Audit_Changes: changes });
  server.getCodexSpreadsheet_ = () => ss;
  server.codexAssertAdmin_ = () => ({ role: 'admin' });
  server.codexGetActiveUserEmail_ = () => 'admin@example.invalid';
  server.codexGetTeamBirthdays_ = () => [];
  let id = 0;
  server.codexGenerateAuditId_ = () => 'AUD-' + ++id;
  log.appendRow = () => { assert.fail('Auditoria deve ser gravada em lote'); };
  for (const sheet of [log, changes]) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      assert.equal(lock.state.held, true);
      return getRange(...args);
    };
  }
  const result = server.salvarPerfisUsuariosAdmin({ users: rows.map((row, i) => ({ rowIndex: i + 2, name: 'Depois', podeSolicitarExames: 'Sim' })) });
  assert.equal(result.updated, 500);
  assert.equal(log.writes, 1);
  assert.equal(changes.writes, 1);
  assert.equal(log.rows.length, 502);
  assert.equal(changes.rows.length, 501);
  assert.equal(log.rows[1][0], 'LEGADO');
  for (let i = 0; i < 500; i++) {
    assert.deepEqual(log.rows[i + 2].slice(4), ['Sistema', rows[i][0]]);
    assert.equal(log.rows[i + 2][1], 'admin@example.invalid');
    assert.equal(log.rows[i + 2][2], 'salvarPerfisUsuariosAdmin');
    assert.deepEqual(changes.rows[i + 1].slice(5), [rows[i][0], 'Usuário - Nome', 'Antes', 'Depois', 'Carga rápida de perfis']);
    assert.deepEqual(users.rows[i + 1].slice(2, 4), ['user', 'Sim']);
  }
  assert.equal(new Set([...log.rows.slice(2), ...changes.rows.slice(1)].map(row => row[0])).size, 1000);
  assert.equal(lock.state.held, false);
});
