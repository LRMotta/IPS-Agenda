'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function fixture() {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote', 'Accession_Number'],
    ['KIT-A', 'P1', 'Kit Alpha', 'Kit', '31/12/2030', 'Sala', 2, 0, 'OK', '', '', '', '', 'LA', 'AA'],
    ['KIT-A', 'P1', 'Kit Alpha', 'Kit', '31/12/2030', 'Sala', 3, 0, 'OK', '', '', '', '', 'LA', 'AA'],
    ['KIT-A', 'P1', 'Kit Alpha', 'Kit', '31/12/2030', 'Sala', 1, 0, 'OK', '', '', '', '', 'LB', 'AB'],
    ['KIT-Z', 'P1', 'Kit Zebra', 'Kit coleta', '31/12/2030', 'Sala', 4, 0, 'OK', '', '', '', '', 'LZ', 'AZ'],
    ['EX', 'P1', 'Requisição de exame', 'Exame', '', 'Sala', 5, 0, 'OK']
  ]);
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Localização', 'EstoqueMin', 'Observações', 'Laboratório', 'Status', 'Ordem'],
    ['KIT-A', 'P1', 'Kit Alpha', 'Kit', 'Sala', 0, '', '', 'Ativo', 2],
    ['KIT-Z', 'P1', 'Kit Zebra', 'Kit coleta', 'Sala', 0, '', '', 'Ativo', 1]
  ]);
  const reservas = new FakeSheet('Reservas de Kits', [
    ['ID_Reserva'],
    ['R1', '', 'AG1', 'P1', '', 'KIT-A', 'LA', '', '31/12/2030', 'Sala', 2, 'Reservado', '', '', '', '', '', 'AA'],
    ['R2', '', 'AG2', 'P1', '', 'KIT-A', 'LB', '', '31/12/2030', 'Sala', 1, 'Reservado', '', '', '', '', '', 'AB'],
    ['R3', '', 'AG3', 'P1', '', 'KIT-Z', 'LZ', '', '31/12/2030', 'Sala', 4, 'Cancelado', '', '', '', '', '', 'AZ']
  ]);
  const reads = [];
  for (const sheet of [estoque, itens, reservas]) {
    const range = sheet.getRange.bind(sheet);
    const dataRange = sheet.getDataRange.bind(sheet);
    sheet.getRange = (...args) => {
      const result = range(...args);
      const values = result.getValues.bind(result);
      result.getValues = () => { reads.push({ sheet: sheet.name, args }); return values(); };
      return result;
    };
    sheet.getDataRange = () => {
      const result = dataRange();
      const values = result.getValues.bind(result);
      result.getValues = () => { reads.push({ sheet: sheet.name, dataRange: true }); return values(); };
      return result;
    };
  }
  const ss = new FakeSpreadsheet({ Estoque: estoque, Itens: itens, 'Reservas de Kits': reservas });
  const findSheet = ss.getSheetByName.bind(ss);
  ss.getSheetByName = name => {
    if (name === 'Projetos') throw new Error('Projetos nao pertence a carga de kits');
    return findSheet(name);
  };
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: () => '31/12/2030' }
  });
  server.codexAssertCanRead_ = () => {};
  server.getProjetosAtivosEstoque_ = () => { throw new Error('Lista de projetos ativos desnecessaria'); };
  server.formatarDataSafe = value => String(value || '');
  return { server, estoque, itens, reservas, reads, ss };
}

test('kits leem estoque, catalogo e reservas uma vez, sem listas de projetos', () => {
  const f = fixture();
  const kits = f.server.getAgendaKitsEstoque_(true);
  assert.deepEqual(Array.from(kits, k => [k.id, k.idLote, k.accessionNumber, k.qtde, k.ordem]), [
    ['KIT-Z', 'LZ', 'AZ', 4, 1], ['KIT-A', 'LA', 'AA', 5, 2]
  ]);
  assert.match(kits[1].label, /disponível 3/);
  assert.deepEqual(f.reads, [
    { sheet: 'Estoque', args: [1, 1, 6, 15] },
    { sheet: 'Itens', dataRange: true },
    { sheet: 'Reservas de Kits', args: [2, 1, 3, 18] }
  ]);
  for (const sheet of [f.estoque, f.itens, f.reservas]) assert.equal(sheet.writes, 0);
});

test('renovacao dos kits desconta reservas atuais e preserva bypass do cache de execucao', () => {
  const f = fixture();
  assert.equal(f.server.getAgendaKitsEstoque_(true).length, 2);
  const readsBefore = f.reads.length;
  f.server.getAgendaKitsEstoque_(true);
  assert.equal(f.reads.length, readsBefore);
  f.reservas.rows[1][10] = 5;
  f.server.CODEX_CACHE_BYPASS_READS_ = true;
  assert.deepEqual(Array.from(f.server.getAgendaKitsEstoque_(true), k => k.id), ['KIT-Z']);
  assert.equal(f.reads.length, readsBefore + 3);
});

test('consulta de estoque nega acesso antes de consultar catalogo ou saldo', () => {
  const f = fixture();
  f.server.codexAssertCanRead_ = () => { throw new Error('Acesso negado'); };
  assert.throws(() => f.server.getAgendaKitsEstoque_(true), /Acesso negado/);
  assert.deepEqual(f.reads, []);
});

test('consulta publica do cadastro continua carregando projetos e verificando acesso', () => {
  const f = fixture();
  let auth = 0;
  let active = 0;
  f.server.codexAssertCanRead_ = () => { auth++; };
  f.server.getProjetosAtivosEstoque_ = () => { active++; return ['P2']; };
  f.ss.sheets.Projetos = new FakeSheet('Projetos', [['ID', 'Nome'], ['P2', 'Outro projeto']]);
  f.ss.getSheetByName = name => f.ss.sheets[name] || null;
  const result = f.server.getItensEstoque();
  assert.deepEqual(Array.from(result.projetos), ['P1']);
  assert.deepEqual(Array.from(result.projetosAtivos), ['P2']);
  assert.equal(result.itens.length, 2);
  assert.equal(auth, 1);
  assert.equal(active, 1);
});
