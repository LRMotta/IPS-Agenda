'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFile, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');

test('RPCs legadas rejeitam mutações sem ler ou gravar planilhas, inclusive payload ausente', () => {
  let authorized = 0;
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet() { assert.fail('RPC legada não deve acessar planilhas'); } }
  });
  server.codexAssertCanWrite_ = () => { authorized++; };
  for (const payload of [undefined, null, {}, { id: 'SOL-1', nome: 'Alterado' }, { id: 'ana@example.invalid' }]) {
    assert.throws(() => server.salvarDadosSolicitante(payload), /gerenciado em Usuários/);
  }
  for (const id of [undefined, null, 'SOL-1', 'ana@example.invalid']) {
    assert.throws(() => server.excluirSolicitante(id), /gerenciada em Usuários/);
  }
  assert.equal(authorized, 9);
  server.codexAssertCanWrite_ = () => { throw new Error('Acesso negado'); };
  assert.throws(() => server.salvarDadosSolicitante(), /Acesso negado/);
  assert.throws(() => server.excluirSolicitante('SOL-1'), /Acesso negado/);
});

test('responsáveis de recebimento vêm de Users ativos sem exigir permissão de exames e sem alterar legado', () => {
  const users = new FakeSheet('Users', [
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames'],
    ['ana@example.invalid', 'Ana', 'user', 'Sim', '', '', '', 'Sim'],
    ['bia@example.invalid', 'Bia', 'readonly', 'Sim', '', '', '', 'Não'],
    ['bia2@example.invalid', 'Bia', 'user', 'Sim', '', '', '', 'Sim'],
    ['caio@example.invalid', 'Caio', 'admin', 'Não', '', '', '', 'Sim']
  ]);
  const legacy = new FakeSheet('🙋 Solicitantes', [['ID', 'Nome'], ['SOL-1', 'Histórico']]);
  const before = JSON.stringify([users.rows, legacy.rows]);
  const server = runFile('WebApp.gs');
  server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Users: users, '🙋 Solicitantes': legacy });
  server.codexAssertCanRead_ = () => {};
  assert.deepEqual(Array.from(server.getSolicitantesEquipamentos_()), ['Ana', 'Bia']);
  assert.deepEqual(Array.from(server.getSolicitantes(), user => user.nome), ['Ana', 'Bia']);
  users.rows[1][1] = 'Ana Atualizada';
  users.rows[2][3] = 'Não';
  users.rows[3][3] = 'Não';
  assert.deepEqual(Array.from(server.getSolicitantesEquipamentos_()), ['Ana Atualizada']);
  users.rows[1][1] = 'Ana'; users.rows[2][3] = 'Sim'; users.rows[3][3] = 'Sim';
  assert.equal(JSON.stringify([users.rows, legacy.rows]), before);
  assert.equal(users.writes + legacy.writes, 0);
});

test('rotas e ações legadas direcionam somente admin a Usuários, sem RPC de mutação', () => {
  const routes = [], notices = [];
  const context = vm.createContext({
    CURRENT_ACCESS: { ok: true, role: 'admin' },
    document: { getElementById: () => null },
    irPara: page => routes.push(page),
    snackErro: message => notices.push(message)
  });
  vm.runInContext(contentAccessibilitySource(['abrirCadastroSolicitantesEmUsuarios', 'carregarSolicitantes',
    'abrirFormSolicitante', 'salvarSolicitanteApp', 'confirmarExcluirSol']), context);
  for (const method of ['carregarSolicitantes', 'abrirFormSolicitante', 'salvarSolicitanteApp', 'confirmarExcluirSol']) {
    context[method]();
  }
  assert.deepEqual(routes, ['usuarios', 'usuarios', 'usuarios', 'usuarios']);
  context.CURRENT_ACCESS.role = 'user';
  context.salvarSolicitanteApp();
  assert.equal(routes.length, 4);
  assert.match(notices[0], /administrador/);
  // O alias de navegação precisa interceptar a rota antes de carregar a página antiga.
  vm.runInContext(contentAccessibilitySource(['irPara']), context);
  context.abrirCadastroSolicitantesEmUsuarios = () => routes.push('alias');
  context.irPara('solicitantes');
  assert.equal(routes.at(-1), 'alias');
});

test('alterações de Users invalidam apenas Cadastros dependentes e renovam requisição já inicializada', () => {
  let reloads = 0;
  const pages = ['solicitantes', 'projetos', 'equipamentos', 'medicamentos', 'participantes'];
  const context = vm.createContext({
    CADASTROS_BOOTSTRAP_CACHE: Object.fromEntries(pages.map(page => [page, { data: page }])),
    CADASTROS_BOOTSTRAP_IN_FLIGHT: {}, _reqInited: false,
    carregarSolicitantesRequisicao: () => { reloads++; }
  });
  vm.runInContext(contentAccessibilitySource(['invalidateCadastroBootstrapCache', 'invalidarReferenciasUsuarios']), context);
  context.invalidarReferenciasUsuarios();
  assert.deepEqual(Object.keys(context.CADASTROS_BOOTSTRAP_CACHE), ['participantes']);
  assert.equal(reloads, 0);
  context._reqInited = true;
  context.invalidarReferenciasUsuarios();
  assert.equal(reloads, 1);
  const source = readProjectFile('IndexCoreScripts.html');
  for (const name of ['salvarMeuPerfilApp', 'salvarUsuarioAdminApp', 'salvarCargaPerfisAdminApp', 'confirmarInativarUsuarioAdmin']) {
    const block = source.match(new RegExp('function ' + name + '\\([^]*?\n\}'))[0];
    assert.match(block, /withSuccessHandler\(function\(result\) \{\s+invalidarReferenciasUsuarios\(\)/);
  }
});

test('respostas antigas de solicitantes não repovoam requisição após alteração em Users', () => {
  const requests = [];
  const context = vm.createContext({
    _rqSolicitantesRequestId: 0, _rqSolicitantesLoaded: true,
    _rqSolicitantes: [{ nome: 'Antigo', email: 'antigo@example.invalid' }],
    _rqSolicitantesNomes: ['Antigo'], _rqAcOptionsCache: {},
    _rqParticipantes: [], _rqPrestadores: [],
    appServerRun: request => requests.push(request),
    updateRequisicaoGenerateAvailability: () => {}, preencherDadosSolicitante: () => {},
    preencherSolicitanteUsuarioAtual: () => {}, flushRequisicaoLoadCallbacks: () => {},
    snackErro: () => assert.fail('erro obsoleto deve ser ignorado')
  });
  vm.runInContext(contentAccessibilitySource(['rqLookupKey', 'rqLookupEmail', 'rqIndexBy',
    'rebuildRequisicaoLookups', 'carregarSolicitantesRequisicao']), context);
  context.carregarSolicitantesRequisicao();
  context.carregarSolicitantesRequisicao();
  assert.equal(context._rqSolicitantesLoaded, false);
  assert.deepEqual(Object.keys(context._rqLookup.solicitantePorNome), []);
  requests[1].onSuccess([{ nome: 'Atual', email: 'atual@example.invalid' }]);
  requests[0].onSuccess([{ nome: 'Obsoleto', email: 'obsoleto@example.invalid' }]);
  requests[0].onFailure(new Error('Falha antiga'));
  assert.equal(context._rqSolicitantesLoaded, true);
  assert.deepEqual(Array.from(context._rqSolicitantesNomes), ['Atual']);
  assert.deepEqual(Object.keys(context._rqLookup.solicitantePorEmail), ['atual@example.invalid']);
});

test('requisição preenchida bloqueia geração durante recarga e após falha, permite retry e atualiza cartão', () => {
  const requests = [], statuses = [];
  let cardUpdates = 0;
  const button = { dataset: {}, setAttribute() {} };
  const input = { value: 'Ana' };
  const context = vm.createContext({
    _rqSolicitantesRequestId: 0, _rqSolicitantesState: 'ready', _rqSolicitantesLoaded: true,
    _rqSolicitantes: [{ nome: 'Ana', formacao: 'Antiga', registro: 'Registro antigo' }],
    _rqSolicitantesNomes: ['Ana'], _rqAcOptionsCache: {}, _rqParticipantes: [], _rqPrestadores: [],
    appServerRun: request => requests.push(request),
    preencherSolicitanteUsuarioAtual: () => {}, preencherDadosSolicitante: () => { cardUpdates++; },
    flushRequisicaoLoadCallbacks: () => {}, snackErro: () => {}, appErrorMessage: error => error.message,
    requisicaoEl: () => button, document: { getElementById: () => input },
    setRequisicaoStatus: message => statuses.push(message),
    requisicaoMissingRequiredChecks: () => [], requisicaoRequiredValues: () => [],
    validarRequisicaoAntesDeGerar: () => assert.fail('geração deve permanecer bloqueada')
  });
  vm.runInContext(contentAccessibilitySource(['rqLookupKey', 'rqLookupEmail', 'rqIndexBy', 'rebuildRequisicaoLookups',
    'carregarSolicitantesRequisicao', 'updateRequisicaoGenerateAvailability', 'gerarRequisicao']), context);
  context.carregarSolicitantesRequisicao();
  context.gerarRequisicao();
  assert.equal(requests.length, 1);
  assert.match(statuses.at(-1), /Aguarde/);
  requests[0].onFailure(new Error('Falha de rede simulada'));
  assert.equal(context.updateRequisicaoGenerateAvailability(), false);
  context.gerarRequisicao();
  assert.equal(requests.length, 2);
  assert.equal(context._rqSolicitantesState, 'loading');
  requests[1].onSuccess([{ nome: 'Ana', formacao: 'Atualizada', registro: 'Registro atual' }]);
  assert.equal(context.updateRequisicaoGenerateAvailability(), true);
  assert.equal(context._rqLookup.solicitantePorNome.Ana.registro, 'Registro atual');
  assert.equal(cardUpdates, 1);
  context.carregarSolicitantesRequisicao();
  requests[2].onSuccess([]);
  assert.equal(context.updateRequisicaoGenerateAvailability(), false);
  context.gerarRequisicao();
  assert.match(statuses.at(-1), /não está disponível/);
  assert.equal(requests.length, 3);
});
