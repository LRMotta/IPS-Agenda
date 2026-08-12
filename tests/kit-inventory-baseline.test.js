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

test('excecao operacional registra perda e encerra a reserva correspondente', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Laboratório', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', 'AG-1', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'P-1', 'V1']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de movimento', 'ID_Item', 'Descrição', 'Tipo de item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID_Participante', 'Participante', 'ID_Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque, Reservas_Kits: reservas, Movimentações: mov });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'EXC-1', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.registrarExcecaoKitEstoque({ idItem: 'KIT-1', idLote: 'LOTE-1', localizacao: 'Laboratório', qtde: 1, tipo: 'perda', motivo: 'Avaria no armazenamento' });
  assert.equal(result.reservasAtualizadas, 1);
  assert.equal(estoque.rows[1][6], 1);
  assert.equal(reservas.rows[1][11], 'Perdido');
  assert.equal(mov.rows[1][2], 'Saída - Perda');
});

test('substituição de lote preserva histórico e cria reserva elegível', () => {
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', 'AG-1', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'P-1', 'V1']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'SUB-1', formatDate: value => String(value) }
  });
  server.getEstoque = () => [{ idItem: 'KIT-1', idLote: 'LOTE-2', descricao: 'Kit coleta', validade: '31/12/2026', localizacao: 'Estoque Principal', qtde: 2 }];
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.substituirReservaKitAgenda({ idReserva: 'RES-1', novoIdLote: 'LOTE-2', justificativa: 'Lote original comprometido.' });
  assert.equal(result.ok, true);
  assert.equal(reservas.rows[1][11], 'Substituída');
  assert.equal(reservas.rows.length, 3);
  assert.equal(reservas.rows[2][6], 'LOTE-2');
  assert.equal(reservas.rows[2][11], 'Reservado');
});

test('gestão de reserva exige justificativa e ajusta quantidade com histórico', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Laboratório', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', 'AG-1', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'P-1', 'V1']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Estoque: estoque, Reservas_Kits: reservas }), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'ADJ-1', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  assert.throws(() => server.cancelarReservaKitAgenda({ idReserva: 'RES-1' }), /justificativa/);
  const result = server.ajustarReservaKitAgenda({ idReserva: 'RES-1', qtde: 2, justificativa: 'Visita exige uma unidade adicional.' });
  assert.equal(result.quantidadeAnterior, 1);
  assert.equal(reservas.rows[1][10], 2);
  assert.equal(reservas.rows[2][11], 'Ajustada');
  assert.match(String(reservas.rows[2][14]), /Visita exige/);
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

test('fase SoA: calendario do protocolo ordena visitas e preserva aliases', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes'],
    ['SOA-2', 'Estudo A', 'FU-03', 'Follow-up 3', 20, 'mensal', 30, 'FU 3; Follow up 3', 'Sim', ''],
    ['SOA-1', 'Estudo A', 'T-2', 'Subsequente', 10, 'a cada 6 meses', 180, 'C18; C24', 'Sim', ''],
    ['SOA-3', 'Estudo B', 'V1', 'Baseline', 10, '', '', '', 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  const visitas = server.getSoAVisitasProjeto('estudo a');
  assert.deepEqual(Array.from(visitas, item => item.idSoA), ['SOA-1', 'SOA-2']);
  assert.deepEqual(Array.from(visitas[0].aliases), ['C18', 'C24']);
  assert.equal(visitas[1].intervaloDias, 30);
});

test('fase SoA: salvar visita atualiza registro existente sem duplicar', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes'],
    ['SOA-1', 'Estudo A', 'V1', 'Baseline', 10, '', '', '', 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  server.salvarSoAVisita({ idSoA: 'SOA-1', projeto: 'Estudo A', codigo: 'V1', nome: 'Baseline atualizado', ordem: 5, aliases: 'V0; Triagem' });
  assert.equal(soa.rows.length, 2);
  assert.equal(soa.rows[1][3], 'Baseline atualizado');
  assert.equal(soa.rows[1][7], 'V0; Triagem');
});

test('fase braços: catálogo do projeto ordena opções sem alterar a compatibilidade legada', () => {
  const bracos = new FakeSheet('Projeto_Bracos', [
    ['ID_Braco', 'Projeto', 'Nome do braço', 'Ordem', 'Ativo', 'Observações'],
    ['BR-2', 'Estudo A', 'Placebo', 20, 'Sim', ''],
    ['BR-1', 'Estudo A', 'Braço A', 10, 'Sim', ''],
    ['BR-3', 'Estudo A', 'Descontinuado', 30, 'Não', ''],
    ['BR-4', 'Estudo B', 'Controle', 10, 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Projeto_Bracos: bracos });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  const lista = server.getBracosProjeto('estudo a');
  assert.deepEqual(Array.from(lista, item => item.nome), ['Braço A', 'Placebo', 'Descontinuado']);
  assert.equal(lista.filter(item => item.ativo).length, 2);
});

test('fase braços: atualização do catálogo não duplica o braço', () => {
  const bracos = new FakeSheet('Projeto_Bracos', [
    ['ID_Braco', 'Projeto', 'Nome do braço', 'Ordem', 'Ativo', 'Observações'],
    ['BR-1', 'Estudo A', 'Braço A', 10, 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Projeto_Bracos: bracos });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  server.salvarBracoProjeto({ idBraco: 'BR-1', projeto: 'Estudo A', nome: 'Braço A atualizado', ordem: 5 });
  assert.equal(bracos.rows.length, 2);
  assert.equal(bracos.rows[1][2], 'Braço A atualizado');
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
    agendaId: 'EVT-1', projeto: 'Estudo A', participante: 'Pessoa A', participanteId: 'PART-1', data: '2026-12-15',
    kits: [{ idItem: 'KIT-1', idLote: 'LOTE-1', qtde: 1 }]
  });

  assert.equal(result.reservados, 1);
  assert.equal(reservas.rows.length, 2);
  assert.equal(reservas.rows[1][15], 'PART-1');
  assert.equal(server.getKitsAgendaReservaStatus('EVT-1').reservado, true);
  const lote = server.getEstoque().find(item => item.idLote === 'LOTE-1');
  assert.equal(lote.qtdeFisica, 3);
  assert.equal(lote.qtdeReservada, 1);
  assert.equal(lote.qtdeDisponivel, 2);
});

test('fase 7: baixa seleciona o lote informado quando existem validades iguais', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Estoque Principal', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-A'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Estoque Principal', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-B']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de Movimento', 'ID_Item', 'Descrição', 'Tipo de Item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID Participante', 'Participante', 'ID Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque, Movimentações: mov });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'MOV-LOTE', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  server.registrarMovimentacaoEstoque({
    idItem: 'KIT-1', idLote: 'LOTE-B', qtde: 1, tipoMovimento: 'Saida - Visita',
    projeto: 'Estudo A', localizacao: 'Estoque Principal', origem: 'Agenda kit EVT-1'
  });

  assert.equal(estoque.rows[1][6], 2);
  assert.equal(estoque.rows[2][6], 1);
  assert.equal(mov.rows[1][10], 'LOTE-B');
});

test('fase 3: transferência move o lote entre localizações com uma operação compartilhada', () => {
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações', 'Laboratório', 'Status'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', 'Estoque Principal', 0, '', 'Lab A', 'Ativo']
  ]);
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', '31/12/2026', 'Estoque Principal', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de Movimento', 'ID_Item', 'Descrição', 'Tipo de Item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID Participante', 'Participante', 'ID Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens, Estoque: estoque, Movimentações: mov });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'TRANS-1', formatDate: value => {
      const d = new Date(value);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    } }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  const reservasTransferencia = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista']
  ]);
  server.getKitReservasSheet_ = () => reservasTransferencia;

  assert.throws(() => server.transferirKitEstoque({
    idItem: 'KIT-1', idLote: 'LOTE-1', origem: 'Estoque Principal', destino: 'Laboratório', qtde: 1
  }), /deve ser reservado/);

  const result = server.transferirKitEstoque({
    idItem: 'KIT-1', idLote: 'LOTE-1', origem: 'Estoque Principal', destino: 'Laboratório', qtde: 2,
    reserva: {
      participanteId: 'PART-1', participante: 'Pessoa A', projeto: 'Estudo A',
      visitaPrevista: 'T-2', dataVisita: '2026-12-15'
    }
  });

  assert.equal(result.quantidade, 2);
  assert.equal(estoque.rows.length, 3);
  assert.equal(estoque.rows[1][6], 1);
  assert.equal(estoque.rows[2][5], 'Laboratório');
  assert.equal(estoque.rows[2][6], 2);
  assert.equal(mov.rows.length, 3);
  assert.equal(mov.rows[1][0], mov.rows[2][0]);
  assert.equal(mov.rows[1][2], 'Saída - Transferência');
  assert.equal(mov.rows[2][2], 'Entrada - Transferência');
  assert.equal(reservasTransferencia.rows.length, 2);
  assert.equal(reservasTransferencia.rows[1][4], 'Pessoa A');
  assert.equal(reservasTransferencia.rows[1][15], 'PART-1');
  assert.equal(reservasTransferencia.rows[1][16], 'T-2');
});

test('fase 5: concilia kit já no Laboratório sem movimentar o saldo físico', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', '31/12/2026', 'Laboratório', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque, Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'RES-CONCILIADA', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.conciliarReservaKitLaboratorio({
    idItem: 'KIT-1', idLote: 'LOTE-1', qtde: 2, participanteId: 'PART-1', participante: 'Pessoa A',
    projeto: 'Estudo A', visitaPrevista: 'Follow-up 1', dataVisita: '2026-12-15'
  });

  assert.equal(result.ok, true);
  assert.equal(estoque.rows[1][6], 2);
  assert.equal(reservas.rows.length, 2);
  assert.equal(reservas.rows[1][4], 'Pessoa A');
  assert.equal(reservas.rows[1][9], 'Laboratório');
  assert.equal(reservas.rows[1][10], 2);
  assert.equal(reservas.rows[1][16], 'Follow-up 1');
});

test('fase 5: Bulk Supply não exige reserva de participante', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['BULK-1', 'Estudo A', 'Slides', 'Bulk Supply', '31/12/2026', 'Estoque Principal', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-B']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de Movimento', 'ID_Item', 'Descrição', 'Tipo de Item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID Participante', 'Participante', 'ID Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Estoque: estoque, Movimentações: mov }), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'TRANS-BULK', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.transferirKitEstoque({
    idItem: 'BULK-1', idLote: 'LOTE-B', origem: 'Estoque Principal', destino: 'Laboratório', qtde: 1
  });

  assert.equal(result.ok, true);
  assert.equal(estoque.rows[1][6], 2);
  assert.equal(estoque.rows[2][5], 'Laboratório');
  assert.equal(estoque.rows[2][6], 1);
});

test('fase 6: encontra visita da Agenda por participante e projeto sem exigir o mesmo rótulo de visita', () => {
  const agendaHeaders = Array.from({ length: 51 }, (_, index) => 'C' + (index + 1));
  const agendaRow = Array.from({ length: 51 }, () => '');
  agendaRow[0] = 'AG-42';
  agendaRow[1] = '2026-12-15';
  agendaRow[3] = 'Visita';
  agendaRow[4] = 'Agendado';
  agendaRow[5] = 'Pessoa A';
  agendaRow[7] = 'PART-1';
  agendaRow[8] = 'Estudo A';
  agendaRow[10] = 'Visita 4 - nome do SoA';
  const agenda = new FakeSheet('Agenda', [agendaHeaders, agendaRow]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', '', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'PART-1', 'Follow-up 3']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Agenda: agenda, Reservas_Kits: reservas }), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: value => String(value) }
  });
  server.getAgendaSheetForRead_ = () => agenda;
  server.getKitReservasSheet_ = () => reservas;
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.AgendaServerRules_ = { isCancelled: status => String(status || '').toLowerCase() === 'cancelado' };
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const encontrados = server.getAgendaCandidatosReservaKit({ idReserva: 'RES-1' });
  assert.equal(encontrados.candidatos.length, 1);
  assert.equal(encontrados.candidatos[0].id, 'AG-42');
  assert.equal(encontrados.candidatos[0].visita, 'Visita 4 - nome do SoA');

  const result = server.vincularReservaKitAgenda({ idReserva: 'RES-1', agendaId: 'AG-42', rowIndex: 2 });
  assert.equal(result.ok, true);
  assert.equal(reservas.rows[1][2], 'AG-42');
});

test('fase 6: visita histórica sem ID recebe identificador interno ao vincular a reserva', () => {
  const agendaHeaders = Array.from({ length: 51 }, (_, index) => 'C' + (index + 1));
  const agendaRow = Array.from({ length: 51 }, () => '');
  agendaRow[1] = '2026-12-15'; agendaRow[3] = 'Visita'; agendaRow[4] = 'Agendado'; agendaRow[5] = 'Pessoa A'; agendaRow[7] = 'PART-1'; agendaRow[8] = 'Estudo A'; agendaRow[10] = 'FU 3';
  const agenda = new FakeSheet('Agenda', [agendaHeaders, agendaRow]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-2', '', '', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'PART-1', 'Follow-up 3']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Agenda: agenda, Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'HIST-1', formatDate: value => String(value) }
  });
  server.getAgendaSheetForRead_ = () => agenda;
  server.getKitReservasSheet_ = () => reservas;
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.AgendaServerRules_ = { isCancelled: status => String(status || '').toLowerCase() === 'cancelado' };
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const candidatos = server.getAgendaCandidatosReservaKit({ idReserva: 'RES-2' }).candidatos;
  assert.equal(candidatos[0].semId, true);
  const result = server.vincularReservaKitAgenda({ idReserva: 'RES-2', rowIndex: 2 });
  assert.equal(result.ok, true);
  assert.equal(agenda.rows[1][0], 'AG-HIST-1');
  assert.equal(reservas.rows[1][2], 'AG-HIST-1');
});
