'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const headers = ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote', 'Accession_Number'];
function fixture(reorder, legacy = false) {
  const stockHeaders = legacy ? headers.slice(0, 14) : headers;
  const order = reorder ? stockHeaders.map((_, index) => stockHeaders.length - 1 - index) : stockHeaders.map((_, index) => index);
  const toRow = values => order.map(index => values[index]);
  const estoque = new FakeSheet('Estoque', [toRow(stockHeaders),
    toRow(['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Sala A', 5, 1, 'OK', 'data antiga', 'usuario antigo', 2, 'PED-1', 'LOTE-A', 'ACC-A']),
    toRow(['KIT-1', 'Estudo B', 'Outro kit', 'Material', '31/12/2026', 'Sala A', 7, 2, 'OK', 'inalterada', 'outro usuario', 3, 'PED-2', 'LOTE-B', 'ACC-B'])]);
  const mov = new FakeSheet('Movimentações', [['ID_Mov', 'Data/Hora', 'Tipo de movimento', 'ID_Item', 'Descrição', 'Tipo de item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID_Participante', 'Participante', 'ID_Visita', 'Responsável', 'Origem', 'Observação']]);
  const descartes = new FakeSheet('Descartes_Estoque', [['ID', 'Data', 'Projeto', 'Solicitante', 'Email', 'Status', 'Responsavel', 'Observacoes', 'Efetivado em'], ['DESC-1', '', 'Estudo A', '', '', 'Em planejamento', '', 'Avaria', '']]);
  const itens = new FakeSheet('Descartes_Itens', [['ID', 'ID_Item', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde planejada', 'Qtde descartada', 'Status', 'Motivo'], ['DESC-1', 'KIT-1', 'Kit coleta', 'Kit', '31/12/2026', 'Sala A', 6, 0, 'Em planejamento', '']]);
  const ss = new FakeSpreadsheet({ Estoque: estoque, Movimentações: mov, Descartes_Estoque: descartes, Descartes_Itens: itens });
  let locked = false;
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => assert.equal(locked, true) }, Session: {getScriptTimeZone: () => 'America/Sao_Paulo', getActiveUser: () => ({getEmail: () => 'teste@ucs.br'})}, Utilities: { getUuid: () => 'MOV-TESTE', formatDate: value => String(value) } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_name, fn) => { const previous = locked; locked = true; try { return fn(); } finally { locked = previous; } };
  server.agendaInvalidateKitsReference_ = () => {};
  server.atualizarReservasPorLote_ = () => 0;
  const col = name => estoque.rows[0].indexOf(name);
  return { server, estoque, mov, descartes, itens, col, ss };
}
for (const reorder of [false, true]) {
  for (const legacy of [false, true]) {
    test(`movimentação preserva saldo e metadados (reordenado=${reorder}, legado=${legacy})`, () => {
      const {server, estoque, mov, col} = fixture(reorder, legacy);
      const untouched = estoque.rows[2].slice();
      server.registrarMovimentacaoEstoque({idItem:'KIT-1', idLote:'LOTE-A', qtde:2});
      assert.equal(estoque.rows[1][col('Qtde')], 3);
      assert.equal(estoque.rows[1][col('Responsavel')], 'teste@ucs.br');
      assert.equal(typeof estoque.rows[1][col('UltimaAlteracao')].getTime, 'function');
      assert.equal(estoque.rows[1][col('N_Pedido')], 'PED-1');
      assert.deepEqual(estoque.rows[2], untouched);
      assert.deepEqual(Array.from(mov.rows[1].slice(3, 11)), ['KIT-1','Kit coleta','Kit','Estudo A',2,'31/12/2026','Sala A','LOTE-A']);
      assert.equal(mov.rows[1][mov.rows[0].indexOf('Accession_Number')], legacy ? '' : 'ACC-A');
      server.registrarMovimentacaoEstoque({idItem:'KIT-1', idLote:'LOTE-A', qtde:1, tipoMovimento:'Entrada - Devolução'});
      assert.equal(estoque.rows[1][col('Qtde')], 4);
    });
  }
  test(`descarte distribui baixas entre lotes com colunas mapeadas (reordenado=${reorder})`, () => {
    const {server, estoque, mov, descartes, itens, col} = fixture(reorder);
    assert.match(server.efetivarDescarteEstoque('DESC-1'), /efetivado/);
    assert.equal(estoque.rows[1][col('Qtde')], 0);
    assert.equal(estoque.rows[2][col('Qtde')], 6);
    assert.equal(mov.rows.length, 3);
    assert.deepEqual(mov.rows.slice(1).map(row => [row[4],row[5],row[7],row[10]]), [['Kit coleta','Kit',5,'LOTE-A'],['Outro kit','Material',1,'LOTE-B']]);
    assert.equal(itens.rows[1][7], 6);
    assert.equal(descartes.rows[1][5], 'Efetivado');
    server.efetivarDescarteEstoque('DESC-1');
    assert.equal(mov.rows.length, 3);
  });
}
test('descarte sem saldo suficiente valida todos os lotes antes da baixa', () => {
  const {server, estoque, itens, mov} = fixture(true);
  itens.rows[1][6] = 20;
  const before = estoque.rows.map(row => row.slice());
  assert.throws(() => server.efetivarDescarteEstoque('DESC-1'), /insuficiente/);
  assert.deepEqual(estoque.rows, before);
  assert.equal(mov.rows.length, 1);
  assert.equal(itens.rows[1][7], 0);
});

for (const reorder of [false, true]) {
  test(`descarte usa saldo livre e conserva reservas ativas (reordenado=${reorder})`, () => {
    const {server, estoque, itens, ss, col} = fixture(reorder);
    const reservation = Array(18).fill('');
    Object.assign(reservation, {0:'RES-1', 5:'KIT-1', 6:'LOTE-A', 8:'31/12/2026', 9:'Sala A', 10:4, 11:'Reservado', 17:'ACC-A'});
    const reservas = new FakeSheet('Reservas_Kits', [Array(18).fill(''), reservation]);
    ss.sheets.Reservas_Kits = reservas;
    server.atualizarReservasPorLote_ = () => assert.fail('descarte de saldo livre não altera reservas');
    const before = JSON.stringify(reservas.rows);
    itens.rows[1][6] = 2;
    server.efetivarDescarteEstoque('DESC-1');
    assert.equal(estoque.rows[1][col('Qtde')], 4);
    assert.equal(estoque.rows[2][col('Qtde')], 6);
    assert.equal(JSON.stringify(reservas.rows), before);
    assert.equal(reservas.writes, 0);
  });

  test(`descarte que consumiria reservas é rejeitado sem baixa (reordenado=${reorder})`, () => {
    const {server, estoque, itens, mov, descartes, ss} = fixture(reorder);
    const reservation = Array(18).fill('');
    Object.assign(reservation, {0:'RES-1', 5:'KIT-1', 6:'LOTE-A', 8:'31/12/2026', 9:'Sala A', 10:4, 11:'Reservado', 17:'ACC-A'});
    ss.sheets.Reservas_Kits = new FakeSheet('Reservas_Kits', [Array(18).fill(''), reservation]);
    itens.rows[1][6] = 9;
    const before = JSON.stringify([estoque.rows, mov.rows, descartes.rows, itens.rows]);
    assert.throws(() => server.efetivarDescarteEstoque('DESC-1'), /reservas ativas/);
    assert.equal(JSON.stringify([estoque.rows, mov.rows, descartes.rows, itens.rows]), before);
    assert.equal(estoque.writes + mov.writes + descartes.writes + itens.writes, 0);
  });
}
