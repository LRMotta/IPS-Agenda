'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const HEADERS = ['ID', 'Número', 'Data', 'Projeto', 'Laboratório', 'Responsável', 'Status', 'Obs', 'Courier', 'Rastreio', 'Número do laboratório'];
const ITEM_HEADERS = ['ID_Pedido', 'Número', 'Projeto', 'Descrição', 'Tipo', 'ID_Item', 'QtdSol', 'QtdRec', 'Status', 'ID_Mov', 'Legado'];
const PEDIDO = ['PED-A', 'N1', '', 'Projeto A', 'Lab A', '', 'Parcial', 'Antes'];
const ITEM = ['PED-A', 'N1', 'Projeto A', 'Kit A', 'Kit', 'KIT-A', 10, 5, 'Parcial', 'MOV-A', 'Preservar'];

function fixture(pedidos = [PEDIDO], itens = [ITEM], headers = HEADERS) {
  const ped = new FakeSheet('Pedidos', [headers, ...pedidos]);
  const pi = new FakeSheet('Pedidos_Itens', [ITEM_HEADERS, ...itens]);
  const ss = new FakeSpreadsheet({ Pedidos: ped, Pedidos_Itens: pi });
  let uuid = 0;
  const locks = { acquired: 0, released: 0, held: false };
  const lock = {
    tryLock: () => { locks.acquired++; locks.held = true; return true; },
    releaseLock: () => { locks.released++; locks.held = false; }
  };
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@example.invalid' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0'), formatDate: () => '30/09/2026' },
    LockService: { getDocumentLock: () => null, getScriptLock: () => lock }
  });
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'user' });
  server.codexWriteAuditLog_ = () => {};
  const originalReads = { getItensEstoque: server.getItensEstoque, getAgendaCouriers_: server.getAgendaCouriers_ };
  // Catálogo/couriers e RichText são dependências externas à regra dos pedidos.
  server.getItensEstoque = () => ({ itens: [] });
  server.getAgendaCouriers_ = () => [];
  server.setEstoquePedidoTrackingRichText_ = (sh, row, col, value) => sh.getRange(row, col).setValue(value || '');
  return { server, ped, pi, locks, originalReads };
}

function edit(overrides = {}) {
  return { rowIndex: 2, idPedido: 'PED-A', numeroPedido: 'N1', data: '2026-09-30', projeto: 'Projeto A', laboratorio: 'Lab A', observacoes: 'Depois', status: 'Pendente',
    itens: [{ idItem: 'KIT-A', descricao: 'Kit A', tipo: 'Kit', qtdSolicitada: 10 }], ...overrides };
}

function snapshot(f) { return JSON.stringify([f.ped.rows, f.pi.rows]); }

function assertUnchanged(f, callback, pattern) {
  const before = snapshot(f);
  assert.throws(callback, pattern);
  assert.equal(snapshot(f), before);
  assert.equal(f.ped.writes + f.pi.writes, 0);
}

test('editar pedido parcial preserva recebimento, movimentação e colunas extras em lote', () => {
  const second = ['PED-A', 'N1', 'Projeto A', 'Kit B', 'Kit', 'KIT-B', 2, 2, 'Recebido', 'MOV-B', 'Extra'];
  const f = fixture([PEDIDO], [ITEM, second, ['PED-B', 'N2', 'Projeto B', 'Outro', 'Kit', 'KIT-C', 1, 0, 'Pendente']]);
  const originalRange = f.pi.getRange.bind(f.pi);
  f.pi.getRange = (row, col, count, width) => {
    assert.ok(col + width - 1 <= 10, 'Não regravar extensões legadas, inclusive fórmulas');
    return originalRange(row, col, count, width);
  };
  f.server.salvarPedidoEstoque(edit({ itens: [
    { idItem: 'KIT-B', descricao: 'Kit B', tipo: 'Kit', qtdSolicitada: 2 },
    { idItem: 'KIT-A', descricao: 'Kit A', tipo: 'Kit', qtdSolicitada: 10 }
  ] }));
  assert.deepEqual(f.pi.rows[1].slice(7), [5, 'Parcial', 'MOV-A', 'Preservar']);
  assert.deepEqual(f.pi.rows[2].slice(7), [2, 'Recebido', 'MOV-B', 'Extra']);
  assert.equal(f.pi.rows[3][0], 'PED-B');
  assert.equal(f.pi.writes, 1);
  assert.equal(f.ped.rows[1][6], 'Parcial');
  assert.equal(f.ped.rows[1][7], 'Depois');
  assert.deepEqual([f.locks.acquired, f.locks.released], [1, 1]);
});

test('editar pedido recebido mantém status e preserva itens quando a lista é omitida', () => {
  const f = fixture([PEDIDO], [[...ITEM.slice(0, 6), 5, 5, 'Recebido', 'MOV-A', 'Legado']]);
  f.server.salvarPedidoEstoque(edit({ itens: undefined }));
  assert.equal(f.pi.rows[1][7], 5);
  assert.equal(f.pi.rows[1][9], 'MOV-A');
  assert.equal(f.ped.rows[1][6], 'Recebido');
});

test('remoção de item recebido ou vinculado a movimentação falha antes de qualquer escrita', () => {
  for (const item of [ITEM, [...ITEM.slice(0, 7), 0, 'Pendente', 'MOV-A']]) {
    const f = fixture([PEDIDO], [item], HEADERS.slice(0, 8));
    assertUnchanged(f, () => f.server.salvarPedidoEstoque(edit({ itens: [] })), /recebimento ou movimentação/);
  }
});

test('reduzir quantidade abaixo do recebido ou mudar projeto rejeita toda a edição', () => {
  const f = fixture();
  assertUnchanged(f, () => f.server.salvarPedidoEstoque(edit({ itens: [{ idItem: 'KIT-A', qtdSolicitada: 4 }] })), /menor/);
  assertUnchanged(f, () => f.server.salvarPedidoEstoque(edit({ projeto: 'Outro' })), /alterar o projeto/);
});

test('edição pode substituir itens pendentes sem modificar pedidos alheios', () => {
  const f = fixture([PEDIDO], [['PED-A', 'N1', 'Projeto A', 'Kit A', 'Kit', 'KIT-A', 10, 0, 'Pendente', ''], ['PED-B', 'N2', 'Projeto B', 'Kit B', 'Kit', 'KIT-B', 1, 0, 'Pendente']]);
  const unrelated = f.pi.rows[2].slice();
  f.server.salvarPedidoEstoque(edit({ itens: [{ idItem: 'KIT-NOVO', descricao: 'Novo', tipo: 'Kit', qtdSolicitada: 3 }] }));
  assert.deepEqual(f.pi.rows[1], unrelated);
  assert.equal(f.pi.rows[2][5], 'KIT-NOVO');
  assert.equal(f.pi.rows[2][7], 0);
});

test('itens inválidos e IDs duplicados não deixam gravação parcial nem migração de schema', () => {
  for (const itens of [[{ idItem: 'KIT-A', qtdSolicitada: Infinity }], [{ idItem: 'KIT-A', qtdSolicitada: 10 }, { idItem: 'KIT-A', qtdSolicitada: 10 }]]) {
    const f = fixture([PEDIDO], [ITEM], HEADERS.slice(0, 8));
    assertUnchanged(f, () => f.server.salvarPedidoEstoque(edit({ itens })), /quantidade positiva|duplicados/);
  }
});

test('salvamento e exclusão usam o ID autoritativo apesar de uma linha antiga da tela', () => {
  const f = fixture([['PED-B', 'N2', '', 'Projeto B', 'Lab B'], PEDIDO], [ITEM, ['PED-B', 'N2']]);
  f.server.salvarPedidoEstoque(edit());
  assert.equal(f.ped.rows[1][1], 'N2');
  assert.equal(f.ped.rows[2][7], 'Depois');
  f.server.excluirPedidoEstoque(2, 'PED-A');
  assert.equal(f.ped.rows.length, 2);
  assert.equal(f.ped.rows[1][0], 'PED-B');
  assert.equal(f.pi.rows[1][0], 'PED-B');
  assert.deepEqual([f.locks.acquired, f.locks.released], [2, 2]);
});

test('exclusão rejeita linha inválida, ID ausente/inexistente/duplicado antes de apagar itens', () => {
  for (const [hint, id] of [['invalida', 'PED-A'], [1, 'PED-A'], [2, ''], [2, 'AUSENTE']]) {
    const f = fixture();
    assertUnchanged(f, () => f.server.excluirPedidoEstoque(hint, id), /Linha inválida|Informe o ID|não encontrado/);
  }
  const f = fixture([PEDIDO, PEDIDO]);
  assertUnchanged(f, () => f.server.excluirPedidoEstoque(2, 'PED-A'), /duplicado/);
  assertUnchanged(f, () => f.server.salvarPedidoEstoque(edit()), /duplicado/);
});

test('novos pedidos mantêm IDs únicos depois de exclusões e preservam IDs legados', () => {
  const f = fixture([['PED-0001'], ['PED-0003']], []);
  const payload = edit({ idPedido: '', rowIndex: '', itens: [] });
  f.server.salvarPedidoEstoque(payload);
  const first = f.ped.rows[3][0];
  f.server.excluirPedidoEstoque(4, first);
  f.server.salvarPedidoEstoque(payload);
  const second = f.ped.rows[3][0];
  assert.notEqual(first, second);
  assert.match(second, /^PED-[a-f0-9-]{36}$/);
  assert.deepEqual(f.ped.rows.slice(1, 3).map(r => r[0]), ['PED-0001', 'PED-0003']);
});

test('planejamento também gera IDs únicos para cada laboratório sem reutilizar sequência de linhas', () => {
  const f = fixture([['PED-0001'], ['PED-0003']], []);
  f.server.salvarPlanejamentoPedidoEstoque({ projeto: 'Projeto A', itens: [
    { idItem: 'KIT-A', descricao: 'A', laboratorio: 'Lab A', qtdSolicitada: 2 },
    { idItem: 'KIT-B', descricao: 'B', laboratorio: 'Lab B', qtdSolicitada: 1 }
  ] });
  const ids = f.ped.rows.slice(1).map(r => r[0]);
  assert.equal(new Set(ids).size, 4);
  assert.equal(f.pi.rows.length, 3);
});

test('consulta de pedidos readonly calcula status sem escrever dados nem criar colunas', () => {
  const f = fixture([[...PEDIDO.slice(0, 6), 'Pendente', 'Antes']], [ITEM], HEADERS.slice(0, 8));
  Object.assign(f.server, f.originalReads);
  f.server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'readonly' });
  const before = snapshot(f);
  const result = f.server.getPedidosEstoque();
  assert.equal(result.pedidos[0].status, 'Parcial');
  assert.equal(snapshot(f), before);
  assert.equal(f.ped.writes + f.pi.writes, 0);
  assert.equal(f.ped.rows[0].length, 8);
  assert.equal(f.ped.rows[1][6], 'Pendente');
  assert.throws(() => f.server.salvarPedidoEstoque(edit()), /somente leitura/);
  assert.throws(() => f.server.excluirPedidoEstoque(2, 'PED-A'), /somente leitura/);
});

// Lista explícita da superfície protegida: cada RPC deve negar antes de ler serviços.
const READ_RPCS = [
  'consultarJornadaParticipante', 'consultarConcilicaoVisitasParticipante', 'getEstoqueConfig', 'getMedicos', 'getSolicitantes',
  'buscarParticipantesRequisicao', 'buscarPrestadoresParaRequisicao', 'getReqExamesPreloadProjeto', 'getReqExamesPreloadProjetoContext',
  'getReqExamesPreloadProjetoEditor', 'getReqExamesPreloadProjetoLists', 'buscarEmailDoLocal', 'getGmailSignature', 'getProjetoFormConfig',
  'getMedicoFormConfig', 'getProjetos', 'getSoAVisitasProjeto', 'getAgendaVisitasSoASugeridas', 'validarReplicacaoCiclosSoA', 'validarImportacaoSoA',
  'getBracosProjeto', 'getParticipantes', 'getParticipanteFormConfig', 'previsualizarDuplicidadesMonitores', 'getMonitores', 'getPrestadores',
  'getDashboardData', 'getPendenciasOperacionais', 'getItensEstoque', 'getModelosEstoqueSoAPorProjeto', 'getPedidosEstoque',
  'getPlanejamentoPedidoEstoque', 'getKitsAgendaBaixaStatus', 'getDescartesEstoque', 'getMovimentacoesEstoqueV2', 'getMovimentacoesEstoqueV3',
  'getEstoque', 'getKitsAgendaReservaStatus', 'getEstoqueVisualizacao', 'getMovimentacoesEstoque', 'getEquipamentosFornecidos',
  'getMedicamentosRecebidos', 'getDadosFormularioAgenda', 'getInfoParticipante', 'getUltimaVisita', 'getJornadaParticipante',
  'getConcilicaoVisitasParticipante', 'getAgendaEventos', 'getAgendaEventosPorPeriodo', 'pesquisarAgendaHistorico',
  'getAgendaMateriaisAnteriores', 'getAgendaPeriodoOperacionalPorEventoId', 'getAgendaEventoPorId', 'getConfigApp', 'getLabCentral', 'getCouriersCadastro'
];

test('RPCs de consulta negam acesso revogado antes de ler dados, inclusive caminhos com catch/fallback', () => {
  let calls = 0;
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => { calls++; throw new Error('LEITURA INDEVIDA'); } } });
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: false, message: 'Acesso revogado' });
  for (const name of READ_RPCS) assert.throws(() => server[name](), /Acesso revogado/, name);
  assert.equal(calls, 0);
});

test('autorização de leitura preserva perfis e bypass restrito ao contexto POST já autenticado', () => {
  const server = runFile('WebApp.gs');
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'readonly' });
  assert.equal(server.codexAssertCanRead_().role, 'readonly');
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: false, message: 'Não autorizado' });
  assert.throws(() => server.codexAssertCanRead_(), /Não autorizado/);
  server.CODEX_API_TOKEN_REQUEST_ = true;
  assert.equal(server.codexAssertCanRead_().userEmail, 'api-token');
  server.CODEX_API_TOKEN_REQUEST_ = false;
  assert.throws(() => server.codexAssertCanRead_(), /Não autorizado/);
});

test('uma colisão de ID novo com itens órfãos é rejeitada antes de gravar', () => {
  const f = fixture([], [['PED-COLISAO', 'N1', 'Projeto A', 'Kit', 'Kit', 'KIT-A', 1, 1, 'Recebido', 'MOV-A']]);
  f.server.Utilities.getUuid = () => 'COLISAO';
  assertUnchanged(f, () => f.server.salvarPedidoEstoque(edit({ rowIndex: '', idPedido: '' })), /ID único/);
});
