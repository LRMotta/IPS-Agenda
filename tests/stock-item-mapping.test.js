'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
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
