'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const ITEM_HEADERS = [
  'ID_Item', 'Projeto', 'Descrição', 'Detalhes Visita / Complemento',
  'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações',
  'Laboratório', 'Status', 'Ordem de utilização'
];

function fixture(sheet) {
  const spreadsheet = new FakeSpreadsheet({ [sheet.name]: sheet });
  const locks = [];
  let locked = false;
  let beforeLock = () => {};
  let nextId = 0;
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => {
        assert.equal(locked, true, 'A planilha deve ser relida dentro do lock.');
        return spreadsheet;
      },
      flush() {}
    },
    Utilities: { getUuid: () => 'new-receipt-' + (++nextId), formatDate: () => '2026-10-16' },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  server.codexAssertCanWrite_ = () => {};
  server.getUsuarioEmail = () => 'writer@example.invalid';
  server.agendaInvalidateKitsReference_ = () => {};
  server.codexWithDocumentLock_ = (name, action) => {
    locks.push(name);
    beforeLock();
    locked = true;
    try { return action(); } finally { locked = false; }
  };
  return { server, sheet, locks, beforeLock(action) { beforeLock = action; } };
}

function itemRow(id, description) {
  return [id, 'Projeto A', description, 'V1', 'Material', 'Principal', 1, 'Original', 'Lab A', 'Ativo', 1];
}

function itemPayload(identity = {}) {
  return Object.assign({
    id: '2', idItem: '0001', projeto: 'Projeto A', descricao: 'Item atualizado', tipo: 'Material',
    localizacao: 'Principal', estoqueMin: 1, observacoes: 'Atualizada', laboratorio: 'Lab A', status: 'Ativo'
  }, identity);
}

test('item: ID estável acompanha a linha movida enquanto aguardava o lock', () => {
  const f = fixture(new FakeSheet('Itens', [ITEM_HEADERS, itemRow('0001', 'Alvo'), itemRow('0002', 'Vizinho')]));
  f.beforeLock(() => f.sheet.rows.splice(1, 0, itemRow('0003', 'Inserido')));
  f.server.salvarItemEstoque(itemPayload());
  assert.deepEqual(f.locks, ['salvarItemEstoque']);
  assert.equal(f.sheet.rows[1][2], 'Inserido');
  assert.equal(f.sheet.rows[2][0], '0001');
  assert.equal(f.sheet.rows[2][2], 'Item atualizado');
  assert.equal(f.sheet.rows[2][3], 'V1', 'Detalhes opcionais omitidos devem ser preservados.');
  assert.equal(f.sheet.rows[3][2], 'Vizinho');
});

test('item: busca o ID na coluna mapeada quando o catálogo está reordenado', () => {
  const order = [2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10];
  const reorder = row => order.map(index => row[index]);
  const f = fixture(new FakeSheet('Itens', [reorder(ITEM_HEADERS), reorder(itemRow('0002', 'Vizinho')), reorder(itemRow('0001', 'Alvo'))]));
  f.server.salvarItemEstoque(itemPayload());
  assert.equal(f.sheet.rows[1][0], 'Vizinho');
  assert.equal(f.sheet.rows[2][2], '0001');
  assert.equal(f.sheet.rows[2][0], 'Item atualizado');
});

test('item: exclusão numérica legada nunca confunde a linha com outro ID', () => {
  const f = fixture(new FakeSheet('Itens', [ITEM_HEADERS, itemRow('0001', 'Alvo da tela antiga'), itemRow('2', 'Outro ID') ]));
  const before = JSON.stringify(f.sheet.rows);
  for (const legacyIdentity of [2, '2', { id: '2' }, { rowIndex: 2 }]) {
    assert.throws(() => f.server.excluirItemEstoque(legacyIdentity), /ID|atualize|cadastro|identifica/i);
    assert.equal(JSON.stringify(f.sheet.rows), before);
    assert.equal(f.sheet.writes, 0);
  }
});

test('item: exclusão por objeto com ID segue o registro movido durante espera do lock', () => {
  const f = fixture(new FakeSheet('Itens', [ITEM_HEADERS, itemRow('0001', 'Alvo'), itemRow('0002', 'Vizinho')]));
  f.beforeLock(() => f.sheet.rows.splice(1, 0, itemRow('0003', 'Inserido')));
  f.server.excluirItemEstoque({ idItem: '0001', rowIndex: 2 });
  assert.deepEqual(f.locks, ['excluirItemEstoque']);
  assert.deepEqual(f.sheet.rows.slice(1).map(row => row[0]), ['0003', '0002']);
});

test('item: exclusão localiza ID pela coluna mapeada em catálogo reordenado', () => {
  const order = [2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10];
  const reorder = row => order.map(index => row[index]);
  const f = fixture(new FakeSheet('Itens', [reorder(ITEM_HEADERS), reorder(itemRow('0002', 'Vizinho')), reorder(itemRow('0001', 'Alvo'))]));
  f.server.excluirItemEstoque({ idItem: '0001' });
  assert.equal(f.sheet.rows.length, 2);
  assert.equal(f.sheet.rows[1][2], '0002');
  assert.equal(f.sheet.rows[1][0], 'Vizinho');
});

for (const [reason, identity, duplicate] of [
  ['sem ID estável', { idItem: '' }, false],
  ['ID ausente', { idItem: 'INEXISTENTE' }, false],
  ['ID duplicado', {}, true]
]) {
  test('item: edição ' + reason + ' falha antes de alterar dados ou schema', () => {
    const headers = ITEM_HEADERS.slice(0, -1);
    const f = fixture(new FakeSheet('Itens', [headers, itemRow('0001', 'Alvo').slice(0, -1)]));
    if (duplicate) f.sheet.rows.push(itemRow('0001', 'Duplicado').slice(0, -1));
    const before = JSON.stringify(f.sheet.rows);
    assert.throws(() => f.server.salvarItemEstoque(itemPayload(identity)), /ID|recarreg|atualize|cadastro|identifica|duplicad|encontrad/i);
    assert.equal(JSON.stringify(f.sheet.rows), before);
    assert.equal(f.sheet.writes, 0);
  });
}

for (const config of [
  { kind: 'equipamento', sheetName: 'Equipamentos', headersKey: 'EQUIPAMENTOS_HEADERS_', save: 'salvarEquipamentoFornecido', remove: 'excluirEquipamentoFornecido', idKey: 'idEquipamentoRec', description: 9, created: 16, author: 17 },
  { kind: 'medicamento', sheetName: 'Medicamentos', headersKey: 'MEDICAMENTOS_HEADERS_', save: 'salvarMedicamentoRecebido', remove: 'excluirMedicamentoRecebido', idKey: 'idMedicamentoRec', description: 7, created: 14, author: 15 }
]) {
  function receiptFixture(duplicate = false) {
    const constants = runFile('WebApp.gs');
    const headers = Array.from(constants[config.headersKey]);
    function row(id, description) {
      const values = Array(headers.length).fill('');
      values[0] = id;
      values[2] = 'Projeto A';
      values[config.description] = description;
      values[config.created] = 'CRIAÇÃO ORIGINAL';
      values[config.author] = 'original@example.invalid';
      return values;
    }
    const f = fixture(new FakeSheet(config.sheetName, [headers, row('REC-A', 'Alvo'), row(duplicate ? 'REC-A' : 'REC-B', 'Vizinho')]));
    f.insert = () => f.sheet.rows.splice(1, 0, row('REC-C', 'Inserido'));
    return f;
  }

  function payload(identity = {}) {
    return Object.assign({ rowIndex: 2, [config.idKey]: 'REC-A', projeto: 'Projeto A', descricao: 'Atualizado' }, identity);
  }

  test(config.kind + ': salva o ID correto após deslocamento durante espera do lock e preserva autoria', () => {
    const f = receiptFixture();
    f.beforeLock(f.insert);
    f.server[config.save](payload());
    assert.deepEqual(f.locks, [config.save]);
    assert.equal(f.sheet.rows[1][config.description], 'Inserido');
    assert.equal(f.sheet.rows[2][0], 'REC-A');
    assert.equal(f.sheet.rows[2][config.description], 'Atualizado');
    assert.equal(f.sheet.rows[2][config.created], 'CRIAÇÃO ORIGINAL');
    assert.equal(f.sheet.rows[2][config.author], 'original@example.invalid');
    assert.equal(f.sheet.rows[3][config.description], 'Vizinho');
  });

  test(config.kind + ': exclui o ID correto após deslocamento enquanto aguardava lock', () => {
    const f = receiptFixture();
    f.beforeLock(f.insert);
    f.server[config.remove](2, 'REC-A');
    assert.deepEqual(f.locks, [config.remove]);
    assert.deepEqual(f.sheet.rows.slice(1).map(row => row[0]), ['REC-C', 'REC-B']);
  });

  for (const [reason, identity, duplicate] of [
    ['sem ID', { [config.idKey]: '' }, false],
    ['ID desconhecido', { [config.idKey]: 'INEXISTENTE' }, false],
    ['ID duplicado', {}, true]
  ]) {
    test(config.kind + ': salvar ' + reason + ' não sobrescreve nem insere registro', () => {
      const f = receiptFixture(duplicate);
      const before = JSON.stringify(f.sheet.rows);
      assert.throws(() => f.server[config.save](payload(identity)), /ID|recarreg|atualize|cadastro|identifica|duplicad|encontrad/i);
      assert.equal(JSON.stringify(f.sheet.rows), before);
      assert.equal(f.sheet.writes, 0);
    });
  }

  for (const [reason, rowIndex, id, duplicate] of [
    ['sem ID', 2, '', false],
    ['ID desconhecido', 2, 'INEXISTENTE', false],
    ['ID duplicado', 2, 'REC-A', true]
  ]) {
    test(config.kind + ': excluir ' + reason + ' não apaga o vizinho', () => {
      const f = receiptFixture(duplicate);
      const before = JSON.stringify(f.sheet.rows);
      assert.throws(() => f.server[config.remove](rowIndex, id), /ID|recarreg|atualize|cadastro|identifica|duplicad|encontrad/i);
      assert.equal(JSON.stringify(f.sheet.rows), before);
      assert.equal(f.sheet.writes, 0);
    });
  }

  test(config.kind + ': criação sem identidade continua gerando ID e autoria próprios', () => {
    const f = receiptFixture();
    f.server[config.save](payload({ rowIndex: '', [config.idKey]: '' }));
    assert.deepEqual(f.locks, [config.save]);
    assert.equal(f.sheet.rows.length, 4);
    assert.ok(f.sheet.rows[3][0]);
    assert.notEqual(f.sheet.rows[3][0], 'REC-A');
    assert.equal(f.sheet.rows[3][config.author], 'writer@example.invalid');
  });
}

for (const [rpc, payload] of [
  ['excluirMonitor', 'MON-1'],
  ['salvarDadosPrestador', { empresa: 'Empresa', email: 'empresa@example.invalid', tipoServico: 'Outros' }],
  ['excluirPrestador', 'PREST-1'],
  ['salvarLabCentral', { nomeAbreviado: 'Lab', nomeCompleto: 'Laboratório' }],
  ['excluirLabCentral', 'LAB-1'],
  ['salvarCourier', { nome: 'Marken' }],
  ['excluirCourier', 'COU-1'],
  ['corrigirMatrizIdadeParticipantes', undefined]
]) {
  test(rpc + ': adquire o lock antes de ler linhas mutáveis ou criar schema', () => {
    const server = runFile('WebApp.gs', {
      SpreadsheetApp: { getActiveSpreadsheet() { throw new Error('Leitura antes do lock'); } }
    });
    server.codexAssertCanWrite_ = () => {};
    const sentinel = new Error('LOCK_ADQUIRIDO');
    let locks = 0;
    server.codexWithDocumentLock_ = (label, callback) => {
      assert.equal(label, rpc);
      assert.equal(typeof callback, 'function');
      locks++;
      throw sentinel;
    };
    assert.throws(() => server[rpc](payload), error => error === sentinel);
    assert.equal(locks, 1);
  });
}
