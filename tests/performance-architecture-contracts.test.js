'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const stockHeaders = ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote', 'Accession_Number'];
const movHeaders = ['ID_Mov', 'Data/hora', 'Tipo de movimento', 'ID_Item', 'Descrição', 'Tipo de item', 'Projeto', 'Qtde.', 'Validade', 'Localização', 'Lote', 'ID_Participante', 'Participante', 'ID_Visita', 'Responsável', 'Origem', 'Observação', 'Agenda_ID', 'Agenda_Kit_Acao', 'Accession_Number'];

function countReads(sheet) {
  const calls = { full: 0, readRanges: [] };
  const full = sheet.getDataRange.bind(sheet), range = sheet.getRange.bind(sheet);
  sheet.getDataRange = () => { calls.full++; return full(); };
  sheet.getRange = (...args) => {
    const result = range(...args), read = result.getValues.bind(result);
    result.getValues = () => { calls.readRanges.push(args); return read(); };
    return result;
  };
  return calls;
}

function fixture(count = 30) {
  const stock = new FakeSheet('Estoque', [stockHeaders, ...Array.from({ length: count }, (_, i) =>
    ['KIT-' + i, 'Estudo', 'Kit ' + i, 'Kit', '31/12/2026', 'Sala', 3, 0, 'OK', '', '', '', '', 'L-' + i, 'ACC-' + i])]);
  const mov = new FakeSheet('Movimentações', [movHeaders]);
  const book = new FakeSpreadsheet({ Estoque: stock, Movimentações: mov });
  const stockCalls = countReads(stock), movCalls = countReads(mov);
  let held = false, flushes = 0, invalidations = 0, seq = 0;
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush: () => { assert.equal(held, true); flushes++; } },
    Session: { getActiveUser: () => ({ getEmail: () => 'local@example.invalid' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'UUID-' + (++seq), formatDate: v => String(v) }
  });
  server.codexAssertCanRead_ = () => {};
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_, fn) => { held = true; try { return fn(); } finally { held = false; } };
  server.agendaInvalidateKitsReference_ = () => { assert.equal(held, true); assert.ok(flushes); invalidations++; };
  return { server, stock, mov, book, stockCalls, movCalls, counts: () => ({ flushes, invalidations }) };
}

test('cabeçalhos de Movimentações leem só as primeiras cinco linhas, inclusive aba vazia', () => {
  const { server } = fixture(1);
  const sheet = new FakeSheet('Movimentações', [['Título'], [], movHeaders, ...Array.from({ length: 2000 }, () => ['valor'])]);
  const calls = countReads(sheet);
  assert.equal(server.movimentacoesHeaderInfo_(sheet).row, 3);
  assert.equal(calls.full, 0);
  assert.deepEqual(calls.readRanges, [[1, 1, 5, movHeaders.length]]);
  assert.equal(server.movimentacoesHeaderInfo_(new FakeSheet('vazia', [])).row, 1);
});

test('trinta baixas e devoluções leem Estoque uma vez por operação e gravam histórico em um bloco', () => {
  const f = fixture();
  const kits = Array.from({ length: 30 }, (_, i) => ({ idItem: 'KIT-' + i, idLote: 'L-' + i, accessionNumber: 'ACC-' + i }));
  const result = f.server.baixarKitsAgendaEvento({ agendaId: 'AG-1', kits });
  assert.equal(result.baixados, 30);
  assert.equal(f.stockCalls.full, 1);
  assert.equal(f.movCalls.full, 0);
  assert.equal(f.mov.writes, 1);
  assert.deepEqual(f.counts(), { flushes: 1, invalidations: 1 });
  assert.ok(f.stock.rows.slice(1).every(row => row[6] === 2));
  const returned = f.server.devolverKitsAgendaEvento({ agendaId: 'AG-1' });
  assert.equal(returned.devolvidos, 30);
  assert.equal(f.stockCalls.full, 2);
  assert.equal(f.mov.writes, 2);
  assert.deepEqual(f.counts(), { flushes: 2, invalidations: 2 });
  assert.ok(f.stock.rows.slice(1).every(row => row[6] === 3));
  assert.equal(f.mov.rows[31][10], 'L-0');
  assert.equal(f.mov.rows[31][19], 'ACC-0');
  const before = f.mov.writes;
  assert.equal(f.server.baixarKitsAgendaEvento({ agendaId: 'AG-1', kits }).baixados, 30);
  assert.equal(f.mov.writes, before + 1);
  assert.equal(f.server.baixarKitsAgendaEvento({ agendaId: 'AG-1', kits }).pulados, 30);
  assert.equal(f.mov.writes, before + 1);
});

test('validação de lote impede baixa parcial e preserva fallback entre IDs de kit', () => {
  const f = fixture(1);
  assert.throws(() => f.server.baixarKitsAgendaEvento({ agendaId: 'AG', kits: [{ idItem: 'KIT-0' }, { idItem: 'ausente' }] }), /não encontrado/);
  assert.equal(f.stock.writes + f.mov.writes, 0);
  assert.equal(f.counts().flushes, 0);
  assert.equal(f.server.baixarKitsAgendaEvento({ agendaId: 'AG', kits: [{ idItem: 'ausente,KIT-0' }] }).baixados, 1);
  assert.equal(f.stock.rows[1][6], 2);
});

test('dois movimentos do mesmo lote acumulam saldo em memória e rejeitam quantidade não finita', () => {
  const f = fixture(1);
  f.server.codexWithDocumentLock_('teste', () => f.server.comLoteMovimentacoesEstoque_(registrar => {
    registrar({ idItem: 'KIT-0', qtde: 1 });
    registrar({ idItem: 'KIT-0', qtde: 2 });
  }));
  assert.equal(f.stock.rows[1][6], 0);
  assert.equal(f.mov.writes, 1);
  assert.equal(f.counts().flushes, 1);
  assert.throws(() => f.server.registrarMovimentacaoEstoque({ idItem: 'KIT-0', qtde: Infinity }), /quantidade válida/);
});

test('descarte de múltiplos lotes reaproveita leitura e usa uma persistência do histórico', () => {
  const f = fixture(2);
  f.book.sheets.Descartes_Estoque = new FakeSheet('Descartes_Estoque', [Array(9).fill(''), ['D-1', '', 'Estudo', '', '', 'Em planejamento', '', '', '']]);
  f.book.sheets.Descartes_Itens = new FakeSheet('Descartes_Itens', [Array(10).fill(''),
    ['D-1', 'KIT-0', 'Kit 0', 'Kit', '31/12/2026', 'Sala', 2, 0, 'Em planejamento', ''],
    ['D-1', 'KIT-1', 'Kit 1', 'Kit', '31/12/2026', 'Sala', 2, 0, 'Em planejamento', '']]);
  f.server.efetivarDescarteEstoque('D-1');
  assert.equal(f.stockCalls.full, 1);
  assert.equal(f.mov.writes, 1);
  assert.deepEqual(f.counts(), { flushes: 1, invalidations: 1 });
});

function visit(i) {
  return { idSoA: 'S-' + i, projeto: 'Estudo', codigo: 'V' + i, nome: 'Visita ' + i, ordem: i, repeticao: '', intervaloDias: '',
    aliases: [], ativo: true, observacoes: '', referencia: '', janelaDiasMenos: '', janelaDiasMais: '', bracoIds: [] };
}

test('SoA importa sessenta visitas e seis braços em blocos, com leitura única das visitas', () => {
  const f = fixture(1), s = f.server;
  const sheet = new FakeSheet('SoA_Visitas', [Array.from(s.SOA_VISITAS_HEADERS_)]);
  const arms = new FakeSheet('Projeto_Bracos', [['ID_Braco', 'Projeto', 'Nome', 'Ordem', 'Ativo', 'Observações']]);
  f.book.sheets.SoA_Visitas = sheet;
  s.getProjetoBracosSheet_ = () => arms;
  const calls = countReads(sheet);
  s.soaCreateImportArms_('Estudo', ['A', 'B', 'C', 'D', 'E', 'F']);
  s.soaWriteImportRows_({ projeto: 'Estudo', visitas: Array.from({ length: 60 }, (_, i) => visit(i)) });
  assert.equal(arms.writes, 1);
  assert.equal(sheet.writes, 1);
  assert.equal(sheet.rows.length, 61);
  assert.equal(calls.full, 1);
  assert.equal(calls.readRanges.length, 1, 'somente cabeçalho; nenhuma releitura por visita');
});

test('SoA em atualização esparsa preserva projeto alheio, coluna extra com fórmula e ordem manual', () => {
  const f = fixture(1), s = f.server;
  const headers = [...s.SOA_VISITAS_HEADERS_, 'Fórmula externa'];
  const make = (id, project, manual) => Object.assign(Array(headers.length).fill(''), { 0: id, 1: project, 4: 99, 14: manual, [headers.length - 1]: '=A2' });
  const sheet = new FakeSheet('SoA_Visitas', [headers, make('S-0', 'Estudo', 'Sim'), make('OUTRO', 'Outro', 'Não'), make('S-1', 'Estudo', 'Não')]);
  f.book.sheets.SoA_Visitas = sheet;
  const before = JSON.stringify(sheet.rows[2]);
  s.soaWriteImportRows_({ projeto: 'Estudo', visitas: [visit(0), visit(1), visit(2)] });
  assert.equal(JSON.stringify(sheet.rows[2]), before);
  assert.equal(sheet.rows[1][4], 99);
  assert.equal(sheet.rows[1][headers.length - 1], '=A2');
  assert.equal(sheet.rows[3][headers.length - 1], '=A2');
  assert.equal(sheet.rows[4][4], 100);
});

test('planejamento de pedido usa adaptador de e-mail e mantém retorno de falha do envio', () => {
  const f = fixture(1), s = f.server;
  f.book.sheets.Pedidos = new FakeSheet('Pedidos', [['ID', 'Número', 'Data', 'Projeto', 'Laboratório', 'Usuário', 'Status', 'Observações']]);
  f.book.sheets.Pedidos_Itens = new FakeSheet('Pedidos_Itens', [Array(10).fill('')]);
  s.gerarHtmlCabecalhoEmail_ = () => '';
  s.gerarTabelaEmailGenerica_ = () => '';
  s.gerarRodapeEmailAgenda_ = () => '';
  let emails = 0;
  s.MailApp = { sendEmail: () => assert.fail('chamada direta ao serviço') };
  s.CodexExternalEffects_ = { sendEmail: message => { assert.equal(message.to, 'local@example.invalid'); emails++; throw new Error('falha simulada'); } };
  const result = s.salvarPlanejamentoPedidoEstoque({ projeto: 'Estudo', emailDestino: 'local@example.invalid', itens: [{ idItem: 'KIT-0', laboratorio: 'Lab', qtdSolicitada: 2 }] });
  assert.equal(emails, 1);
  assert.match(JSON.stringify(result), /falha simulada/);
  assert.equal(f.book.sheets.Pedidos.rows.length, 2);
});

test('regularização explícita de courier exige escrita, lock e mantém IDs existentes', () => {
  const f = fixture(1), s = f.server;
  const sheet = new FakeSheet('Courier', [Array.from(s.COURIER_HEADERS_), ['', 'Marken'], ['COU-EXISTENTE', 'DHL']]);
  f.book.sheets.Courier = sheet;
  s.getCodexSpreadsheet_ = () => f.book;
  let invalidations = 0;
  s.limparCacheCourier_ = () => { invalidations++; };
  s.regularizarIdsCouriers();
  assert.match(sheet.rows[1][0], /^COU-/);
  assert.equal(sheet.rows[2][0], 'COU-EXISTENTE');
  assert.equal(invalidations, 1);
  const previous = sheet.rows[1][0];
  s.regularizarIdsCouriers();
  assert.equal(sheet.rows[1][0], previous);
  s.codexAssertCanWrite_ = () => { throw new Error('Acesso negado'); };
  assert.throws(() => s.regularizarIdsCouriers(), /Acesso negado/);
});

function boundedGrid(sheet) {
  sheet.maxRows = sheet.rows.length;
  const range = sheet.getRange.bind(sheet);
  sheet.getRange = (row, column, rows = 1, columns = 1) => {
    assert.ok(row + rows - 1 <= sheet.getMaxRows(), 'faixa excedeu as linhas disponíveis');
    assert.ok(column + columns - 1 <= sheet.getMaxColumns(), 'faixa excedeu as colunas disponíveis');
    return range(row, column, rows, columns);
  };
}

test('lotes ampliam a grade e falha de expansão ocorre antes de alterar saldos', () => {
  const f = fixture(3), s = f.server;
  boundedGrid(f.mov);
  s.baixarKitsAgendaEvento({ agendaId: 'AG', kits: [0, 1, 2].map(i => ({ idItem: 'KIT-' + i })) });
  assert.equal(f.mov.getMaxRows(), 4);
  const visits = new FakeSheet('SoA_Visitas', [Array.from(s.SOA_VISITAS_HEADERS_)]);
  const arms = new FakeSheet('Projeto_Bracos', [Array(6).fill('')]);
  boundedGrid(visits);
  boundedGrid(arms);
  f.book.sheets.SoA_Visitas = visits;
  s.getProjetoBracosSheet_ = () => arms;
  s.soaCreateImportArms_('Estudo', ['A', 'B', 'C']);
  s.soaWriteImportRows_({ projeto: 'Estudo', visitas: [visit(0), visit(1), visit(2)] });
  assert.equal(arms.getMaxRows(), 4);
  assert.equal(visits.getMaxRows(), 4);
  const blocked = fixture(1);
  boundedGrid(blocked.mov);
  blocked.mov.insertRowsAfter = () => { throw new Error('falha simulada de capacidade'); };
  assert.throws(() => blocked.server.baixarKitsAgendaEvento({ agendaId: 'AG', kits: [{ idItem: 'KIT-0' }] }), /capacidade/);
  assert.equal(blocked.stock.writes + blocked.mov.writes, 0);
});

test('devoluções repetidas do mesmo lote reduzem a reserva parcial em memória', () => {
  const f = fixture(1), s = f.server;
  const mov = i => ['M-' + i, '', 'Saida - Visita', 'KIT-0', 'Kit', 'Kit', 'Estudo', 1, '31/12/2026', 'Sala', 'L-0', '', '', '', '', '', '', 'AG', 'baixa', 'ACC-0'];
  f.mov.rows.push(mov(1), mov(2));
  const reservation = Object.assign(Array(18).fill(''), { 0: 'R-1', 2: 'AG', 5: 'KIT-0', 6: 'L-0', 10: 3, 11: 'Baixado', 17: 'ACC-0' });
  const reservations = new FakeSheet('Reservas_Kits', [Array(18).fill(''), reservation]);
  f.book.sheets.Reservas_Kits = reservations;
  s.devolverKitsAgendaEvento({ agendaId: 'AG' });
  assert.equal(reservations.rows[1][10], 1);
  assert.deepEqual(reservations.rows.slice(2).map(row => [row[10], row[11]]), [[1, 'Devolvido'], [1, 'Devolvido']]);
});
