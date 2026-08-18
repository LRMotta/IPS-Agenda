'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const ITEM_HEADERS = [
  'ID_Item', 'Projeto', 'Descrição', 'Detalhes Visita / Complemento',
  'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações',
  'Laboratório', 'Status'
];

function stockServer() {
  const itens = new FakeSheet('Itens', [
    ITEM_HEADERS,
    ['0001', 'Estudo A', 'Kit coleta', 'Somente V1', 'Kit', 'Sala A', 2, 'Frágil', 'Lab A', 'Ativo']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet }
  });
  server.getProjetosAtivosEstoque_ = () => [];
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  return { server, itens };
}

test('cadastro de itens lê o layout com detalhes de visita sem deslocar as colunas', () => {
  const { server } = stockServer();
  const item = server.getItensEstoque().itens[0];

  assert.equal(item.detalhesVisita, 'Somente V1');
  assert.equal(item.tipo, 'Kit');
  assert.equal(item.localizacao, 'Sala A');
  assert.equal(item.estoqueMin, 2);
  assert.equal(item.observacoes, 'Frágil');
  assert.equal(item.laboratorio, 'Lab A');
  assert.equal(item.status, 'Ativo');
});

test('cadastro de itens ordena por projeto e ordem de utilização, deixando vazios ao final', () => {
  const itens = new FakeSheet('Itens', [
    ITEM_HEADERS.concat('Ordem de utilização'),
    ['0001', 'Estudo A', 'Kit 20', 'V2', 'Kit', 'Sala A', 0, '', 'Lab A', 'Ativo', 20],
    ['0002', 'Estudo A', 'Kit sem ordem', 'V3', 'Kit', 'Sala A', 0, '', 'Lab A', 'Ativo', ''],
    ['0003', 'Estudo A', 'Kit 10', 'V1', 'Kit', 'Sala A', 0, '', 'Lab A', 'Ativo', 10],
    ['0004', 'Estudo B', 'Kit 1', 'V1', 'Kit', 'Sala A', 0, '', 'Lab A', 'Ativo', 1]
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Itens: itens }) }
  });
  server.getProjetosAtivosEstoque_ = () => [];

  assert.deepEqual(Array.from(server.getItensEstoque().itens, item => item.descricao), [
    'Kit 10', 'Kit 20', 'Kit sem ordem', 'Kit 1'
  ]);
});

test('edição de item preserva detalhes de visita e grava tipo até status nas colunas corretas', () => {
  const { server, itens } = stockServer();
  server.salvarItemEstoque({
    id: '2', projeto: 'Estudo B', descricao: 'Kit atualizado', tipo: 'Material',
    localizacao: 'Sala B', estoqueMin: 5, observacoes: 'Nova observação',
    laboratorio: 'Lab B', status: 'Inativo'
  });

  assert.equal(itens.rows[1][3], 'Somente V1');
  assert.equal(itens.rows[1][4], 'Material');
  assert.equal(itens.rows[1][5], 'Sala B');
  assert.equal(itens.rows[1][6], 5);
  assert.equal(itens.rows[1][7], 'Nova observação');
  assert.equal(itens.rows[1][8], 'Lab B');
  assert.equal(itens.rows[1][9], 'Inativo');
});

test('novo item mantém vazia a coluna de detalhes e alinha os demais campos', () => {
  const { server, itens } = stockServer();
  server.salvarItemEstoque({
    projeto: 'Estudo B', descricao: 'Tubo', tipo: 'Material', localizacao: 'Sala C',
    estoqueMin: 3, observacoes: '', laboratorio: 'Lab C', status: 'Ativo'
  });
  const row = itens.rows[2];

  assert.equal(row[0], '0002');
  assert.equal(row[3], '');
  assert.equal(row[4], 'Material');
  assert.equal(row[8], 'Lab C');
  assert.equal(row[9], 'Ativo');
});

test('kit persiste múltiplas visitas SoA por ID e mantém leitura legada opcional', () => {
  const { server, itens } = stockServer();
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Código da visita', 'Nome padrão da visita', 'Ordem', 'Repetição', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observações'],
    ['SOA-1', 'Estudo A', 'V1', 'Baseline', 1, '', '', '', 'Sim', ''],
    ['SOA-2', 'Estudo A', 'V2', 'Semana 4', 2, '', '', '', 'Sim', ''],
    ['SOA-3', 'Estudo B', 'V1', 'Outra visita', 1, '', '', '', 'Sim', '']
  ]);
  server.getSoAVisitasSheet_ = () => soa;

  assert.deepEqual(Array.from(server.getItensEstoque().itens[0].visitasAplicaveisIds), []);
  server.salvarItemEstoque({
    id: '2', projeto: 'Estudo A', descricao: 'Kit coleta', tipo: 'Kit', localizacao: 'Sala A',
    estoqueMin: 2, observacoes: '', laboratorio: 'Lab A', status: 'Ativo',
    visitasAplicaveisIds: ['SOA-2', 'SOA-1', 'SOA-2']
  });

  const visitasCol = itens.rows[0].indexOf('Visitas aplicáveis (IDs SoA)');
  assert.ok(visitasCol >= 0);
  assert.equal(itens.rows[1][visitasCol], 'SOA-2; SOA-1');
  assert.deepEqual(Array.from(server.getItensEstoque().itens[0].visitasAplicaveisIds), ['SOA-2', 'SOA-1']);
});

test('vínculo de kit rejeita visita pertencente a outro projeto', () => {
  const { server } = stockServer();
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Código da visita', 'Nome padrão da visita'],
    ['SOA-B', 'Estudo B', 'V1', 'Visita B']
  ]);
  server.getSoAVisitasSheet_ = () => soa;

  assert.throws(() => server.salvarItemEstoque({
    id: '2', projeto: 'Estudo A', descricao: 'Kit coleta', tipo: 'Kit', localizacao: 'Sala A',
    estoqueMin: 2, observacoes: '', laboratorio: 'Lab A', status: 'Ativo',
    visitasAplicaveisIds: ['SOA-B']
  }), /não pertencem ao projeto/);
});

test('visualização do estoque incorpora observações e detalhes do cadastro do item', () => {
  const itens = new FakeSheet('Itens', [
    ITEM_HEADERS,
    ['0001', 'Estudo A', 'Kit coleta', 'V1 e V2', 'Kit', 'Sala A', 2, 'Manter duas unidades', 'Lab A', 'Ativo']
  ]);
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido'],
    ['0001', 'Estudo A', 'Kit coleta', 'Kit', '', 'Sala A', 3, 2, 'OK', '', 'pessoa@ucs.br', '', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens, Estoque: estoque });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: () => '' }
  });
  server.getProjetosAtivosEstoque_ = () => [];

  const item = server.getEstoque()[0];
  assert.equal(item.observacoes, 'Manter duas unidades');
  assert.equal(item.detalhesVisita, 'V1 e V2');
});

test('visualização agregada consolida lotes por ID e mantém item zerado com pedido pendente', () => {
  const itens = new FakeSheet('Itens', [
    ITEM_HEADERS,
    ['0014', 'MonumenTAL-3', 'A Bulk Item', '', 'Bulk Supplies', '', 0, '', 'Labcorp', 'Ativo'],
    ['0001', 'MonumenTAL-3', 'Z Kit Item', 'C18, C24 e C30', 'Kit', 'Face F', 2, 'Um por participante', 'Labcorp', 'Ativo']
  ]);
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido'],
    ['0001', 'MonumenTAL-3', 'Z Kit Item', 'Kit', '31/12/2026', 'Face F', 2, 2, 'OK', '', 'a@ucs.br', 99, 'PED-1'],
    ['0001', 'MonumenTAL-3', 'Z Kit Item', 'Kit', '31/03/2027', 'Face F', 3, 2, 'OK', '', 'b@ucs.br', 99, 'PED-2']
  ]);
  const pedidos = new FakeSheet('Pedidos', [
    ['ID_Pedido', 'N°', 'Data', 'Projeto', 'Laboratório', 'Responsável', 'Status', 'Observações'],
    ['PED-14', 'PO-14', '', 'MonumenTAL-3', 'Labcorp', '', 'Pendente', ''],
    ['PED-DRAFT', '', '', 'MonumenTAL-3', 'Labcorp', '', 'Em planejamento', ''],
    ['PED-PLANNED', 'PO-PLANNED', '', 'MonumenTAL-3', 'Labcorp', '', 'Planejado', '']
  ]);
  const pedidoItens = new FakeSheet('Pedido_Itens', [
    ['ID_Pedido', 'N°', 'Projeto', 'Descrição', 'Tipo', 'ID_Item', 'QtdSol', 'QtdRec', 'Status'],
    ['PED-14', 'PO-14', 'MonumenTAL-3', 'A Bulk Item', 'Bulk Supplies', '0014', 4, 0, 'Pendente'],
    ['PED-DRAFT', '', 'MonumenTAL-3', 'A Bulk Item', 'Bulk Supplies', '0014', 2, 0, 'Em planejamento'],
    ['PED-PLANNED', 'PO-PLANNED', 'MonumenTAL-3', 'A Bulk Item', 'Bulk Supplies', '0014', 3, 0, 'Planejado']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens, Estoque: estoque, Pedidos: pedidos, Pedido_Itens: pedidoItens });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: value => String(value) }
  });
  server.getProjetosAtivosEstoque_ = () => [];

  const visualizacao = server.getEstoqueVisualizacao();
  const t2 = visualizacao.find(item => item.idItem === '0001');
  const t14 = visualizacao.find(item => item.idItem === '0014');

  assert.equal(visualizacao.length, 2);
  assert.equal(Array.from(visualizacao, item => item.idItem).join(','), '0001,0014');
  assert.equal(t2.estoqueAtual, 5);
  assert.equal(t2.lotes.length, 2);
  assert.equal(Array.from(t2.lotes, lote => lote.qtde).join(','), '2,3');
  assert.equal(t2.status, 'OK');
  assert.equal(t14.estoqueAtual, 0);
  assert.equal(t14.lotes.length, 0);
  assert.equal(t14.qtdePedidaPendente, 4);
  assert.equal(Array.from(t14.numerosPedidoPendente).join(','), 'PO-14');
  assert.equal(t14.status, 'Crítico');
});

test('visualização separa o saldo principal das reservas nominadas no Laboratório', () => {
  const itens = new FakeSheet('Itens', [
    ITEM_HEADERS,
    ['KIT-1', 'Estudo A', 'Kit de coleta', '', 'Kit', 'Estoque Principal', 1, '', 'Lab A', 'Ativo']
  ]);
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit de coleta', 'Kit', '31/12/2026', 'Estoque Principal', 3, 1, 'OK', '', '', '', '', 'LOTE-1'],
    ['KIT-1', 'Estudo A', 'Kit de coleta', 'Kit', '31/12/2026', 'Laboratório', 2, 1, 'OK', '', '', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', '', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit de coleta', '31/12/2026', 'Laboratório', 2, 'Reservado', '15/10/2026', '', '', 'PART-1', 'Follow-up 1']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Itens: itens, Estoque: estoque, Reservas_Kits: reservas }) },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: value => String(value) }
  });
  server.getProjetosAtivosEstoque_ = () => [];

  const item = server.getEstoqueVisualizacao().find(row => row.idItem === 'KIT-1');
  assert.equal(item.estoquePrincipal, 3);
  assert.equal(item.estoqueLaboratorio, 2);
  assert.equal(item.qtdeReservadaLaboratorio, 2);
  assert.equal(item.qtdeNaoConciliadaLaboratorio, 0);
  assert.equal(item.reservasLaboratorio[0].participanteId, 'PART-1');
  assert.equal(item.reservasLaboratorio[0].semVisitaConciliada, true);
});

test('validade do estoque é exibida com mês abreviado em português', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const estoque = readProjectFile('IndexEstoqueScripts.html');
  const formatter = core.slice(core.indexOf('function formatDateBr('), core.indexOf('function dateToInputValue('));
  const wrapper = estoque.slice(estoque.indexOf('function estoqueValidadeExibicao('), estoque.indexOf('function estoqueItemDescricaoHtml('));
  const context = vm.createContext({});
  vm.runInContext(`${formatter}\n${wrapper}`, context);

  assert.equal(context.estoqueValidadeExibicao('31/12/2026'), '31/dez./2026');
  assert.equal(context.estoqueValidadeExibicao('2027-03-31'), '31/mar./2027');
  assert.equal(context.estoqueValidadeExibicao(''), '');
});

test('resumo da visualização separa reservas nominadas do saldo do Estoque Principal', () => {
  const estoque = readProjectFile('IndexEstoqueScripts.html');

  assert.match(estoque, /qtdeReservadaLaboratorio/);
  assert.match(estoque, /evRenderReservas/);
  assert.match(estoque, /Visita não identificada/);
  assert.match(estoque, /Validade: a partir de/);
  assert.doesNotMatch(estoque, /Físico/);
});

test('modal de item oferece seleção múltipla de visitas somente para kits', () => {
  const estoque = readProjectFile('IndexEstoqueScripts.html');

  assert.match(estoque, /id="iiVisitasSection"/);
  assert.match(estoque, /getSoAVisitasProjeto\(projeto\)/);
  assert.match(estoque, /#iiVisitasLista input\[type="checkbox"\]:checked/);
  assert.match(estoque, /visitasAplicaveisIds: itemInlineEhKit\(\)/);
});

test('Bulk Supply fica fora do fluxo de reserva e conciliação de kits', () => {
  const estoque = readProjectFile('IndexEstoqueScripts.html');
  const webApp = readProjectFile('WebApp.gs');

  assert.match(estoque, /function evEhKit\(item\)/);
  assert.match(estoque, /if \(!evEhKit\(item\)\) return;/);
  assert.match(webApp, /function estoqueTipoEhKit_\(tipo\)/);
  assert.match(webApp, /itemEhKit \? Math\.max\(0, estoqueLaboratorio - reservasLaboratorio\) : 0/);
});

test('reservas sem Agenda oferecem vínculo posterior por visita compatível', () => {
  const estoque = readProjectFile('IndexEstoqueScripts.html');
  const webApp = readProjectFile('WebApp.gs');

  assert.match(estoque, /Vincular Agenda/);
  assert.match(estoque, /getAgendaCandidatosReservaKit/);
  assert.match(estoque, /vincularReservaKitAgenda/);
  assert.match(webApp, /function getAgendaCandidatosReservaKit\(payload\)/);
  assert.match(webApp, /function vincularReservaKitAgenda\(payload\)/);
});

test('baixa da Agenda preserva o ID do participante e o lote escolhido', () => {
  const agenda = readProjectFile('IndexAgendaScripts.html');
  const webApp = readProjectFile('WebApp.gs');

  assert.match(agenda, /participanteId: String\(\(_agendaParticipanteInfo/);
  assert.match(agenda, /idLote: opt && opt\.dataset/);
  assert.match(agenda, /participanteId: dados\.participanteId/);
  assert.match(webApp, /idLote: String\(kit\.idLote \|\| ''\)\.trim\(\)/);
  assert.match(webApp, /atualizarStatusReservasAgendaItens_\(agendaId/);
});
