'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function agendaKitContext() {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  server.getEstoque = () => [
    { idItem: 'KIT-B', descricao: 'Kit Beta', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '20/12/2026', qtde: 1 },
    { idItem: 'EX-1', descricao: 'Requisição de exame', tipoItem: 'Exame', projeto: 'Estudo A', validade: '01/12/2026', qtde: 5 },
    { idItem: 'KIT-A', descricao: 'Kit Alpha', tipoItem: 'Kit', projeto: 'Estudo A', validade: '30/11/2026', qtde: 2 },
    { idItem: 'KIT-Z', descricao: 'Kit sem saldo', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '01/01/2027', qtde: 0 }
  ];
  return server;
}

test('contrato legado: kits da Agenda filtram itens não-kit e ordenam pelo rótulo', () => {
  const server = agendaKitContext();
  const kits = server.getAgendaKitsEstoque_(true);

  assert.deepEqual(Array.from(kits, kit => kit.id), ['KIT-A', 'KIT-B']);
  assert.equal(kits[0].projeto, 'Estudo A');
  assert.match(kits[0].label, /Kit Alpha/);
  assert.match(kits[0].label, /qtd 2/);
});

test('contrato legado: itens iguais permanecem separados quando mudam validade ou localização', () => {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  const itens = [
    { idItem: 'KIT-1', projeto: 'Estudo A', descricao: 'Kit coleta', tipoItem: 'Kit', validade: '31/12/2026', localizacao: 'Estoque Principal', qtde: 4, status: 'OK' },
    { idItem: 'KIT-1', projeto: 'Estudo A', descricao: 'Kit coleta', tipoItem: 'Kit', validade: '31/12/2026', localizacao: 'Laboratório', qtde: 3, status: 'OK' },
    { idItem: 'KIT-1', projeto: 'Estudo A', descricao: 'Kit coleta', tipoItem: 'Kit', validade: '31/01/2027', localizacao: 'Estoque Principal', qtde: 2, status: 'OK' }
  ];
  const agrupados = server.agruparEstoquePorItemValidade_(itens);

  assert.equal(agrupados.length, 3);
  assert.deepEqual(Array.from(agrupados, item => [item.validade, item.localizacao, item.qtde]), [
    ['31/12/2026', 'Estoque Principal', 4],
    ['31/12/2026', 'Laboratório', 3],
    ['31/01/2027', 'Estoque Principal', 2]
  ]);
});

test('contrato legado: baixa da Agenda registra uma unidade por kit e evita IDs já baixados', () => {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  const chamadas = [];
  server.getKitsAgendaBaixaStatus = () => ({ ids: ['KIT-JA'], baixados: true });
  server.registrarMovimentacaoEstoque = payload => chamadas.push(payload);
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();

  const resultado = server.baixarKitsAgendaEvento({
    agendaId: 'EVT-1',
    projeto: 'Estudo A',
    participante: 'Pessoa A',
    kits: [
      { idItem: 'KIT-JA', label: 'Kit já baixado' },
      { idItem: 'KIT-NOVO', label: 'Kit novo' }
    ]
  });

  assert.equal(resultado.baixados, 1);
  assert.equal(resultado.pulados, 1);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].idItem, 'KIT-NOVO');
  assert.equal(chamadas[0].qtde, 1);
  assert.equal(chamadas[0].agendaId, 'EVT-1');
  assert.equal(chamadas[0].agendaKitAcao, 'baixa');
});

test('fase 2: ordem configurada do projeto precede o rótulo alfabético na Agenda', () => {
  const server = agendaKitContext();
  server.getEstoque = () => [
    { idItem: 'KIT-B', descricao: 'Kit Beta', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '20/12/2026', qtde: 1, ordem: 20 },
    { idItem: 'KIT-A', descricao: 'Kit Alpha', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1, ordem: 10 },
    { idItem: 'KIT-C', descricao: 'Kit Gamma', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1 }
  ];
  const kits = server.getAgendaKitsEstoque_(true);

  assert.deepEqual(Array.from(kits, kit => kit.id), ['KIT-A', 'KIT-B', 'KIT-C']);
  assert.deepEqual(Array.from(kits, kit => kit.ordem), [10, 20, '']);
});

test('fase 2: lotes com mesma validade mantêm identidade distinta na lista de kits', () => {
  const server = agendaKitContext();
  server.getEstoque = () => [
    { idItem: 'KIT-A', idLote: 'LOTE-1', descricao: 'Kit Alpha', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1 },
    { idItem: 'KIT-A', idLote: 'LOTE-2', descricao: 'Kit Alpha', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1 }
  ];

  const kits = server.getAgendaKitsEstoque_(true);
  assert.equal(kits.length, 2);
  assert.deepEqual(Array.from(kits, kit => kit.idLote), ['LOTE-1', 'LOTE-2']);
});

test('fase 2: salvar item adiciona a coluna de ordem sem deslocar o layout legado', () => {
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Detalhes Visita / Complemento', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações', 'Laboratório', 'Status'],
    ['0001', 'Estudo A', 'Kit coleta', 'V1', 'Kit', 'Estoque Principal', 0, '', 'Lab A', 'Ativo']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet }
  });
  server.getProjetosAtivosEstoque_ = () => [];
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();

  server.salvarItemEstoque({
    id: '2', projeto: 'Estudo A', descricao: 'Kit coleta', tipo: 'Kit',
    localizacao: 'Estoque Principal', estoqueMin: 0, observacoes: '',
    laboratorio: 'Lab A', status: 'Ativo', ordem: 10
  });

  assert.equal(itens.rows[0][10], 'Ordem de utilização');
  assert.equal(itens.rows[1][3], 'V1');
  assert.equal(itens.rows[1][10], 10);
});

test('fase 2: migração de lotes cria ID_Lote sem alterar linhas existentes', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '30/11/2026', 'Estoque Principal', 4, 0, 'OK', '', 'a@ucs.br', '', 'PED-1'],
    ['KIT-2', 'Estudo A', 'Kit coleta 2', 'Kit', '31/12/2026', 'Laboratório', 2, 0, 'OK', '', 'a@ucs.br', '', 'PED-2']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => {}
    },
    Utilities: { getUuid: () => 'UUID-LOTE-1' }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();

  const result = server.migrarIdsLotesEstoque();

  assert.equal(result.preenchidos, 2);
  assert.equal(estoque.rows[0][13], 'ID_Lote');
  assert.equal(estoque.rows[1][13], 'UUID-LOTE-1');
  assert.equal(estoque.rows[2][13], 'UUID-LOTE-1');
});

test('fase 3: reserva manual vincula agenda ao lote sem reduzir saldo físico', () => {
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações', 'Laboratório', 'Status', 'Ordem de utilização'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', 'Estoque Principal', 0, '', 'Lab A', 'Ativo', 10]
  ]);
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', '31/12/2026', 'Estoque Principal', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens, Estoque: estoque, Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'RES-1', formatDate: value => {
      const d = new Date(value);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    } }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.reservarKitsAgendaEvento({
    agendaId: 'EVT-1', projeto: 'Estudo A', participante: 'Pessoa A', data: '2026-12-15',
    kits: [{ idItem: 'KIT-1', idLote: 'LOTE-1', qtde: 1 }]
  });

  assert.equal(result.reservados, 1);
  assert.equal(reservas.rows.length, 2);
  assert.equal(server.getKitsAgendaReservaStatus('EVT-1').reservado, true);
  const lote = server.getEstoque().find(item => item.idLote === 'LOTE-1');
  assert.equal(lote.qtdeFisica, 3);
  assert.equal(lote.qtdeReservada, 1);
  assert.equal(lote.qtdeDisponivel, 2);
});
