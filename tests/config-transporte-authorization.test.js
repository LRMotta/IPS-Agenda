'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

function fixture(role = 'user', beforeLock) {
  const sheet = new FakeSheet('Config_App', [
    ['Grupo', 'Chave', 'Valor', 'Ativo', 'Ordem', 'Observação', '', 'Grupo', 'Chave', 'Valor', 'Ativo', 'Ordem', 'Observação'],
    ['Transporte', 'Peso MARKEN ambiente (kg)', '1', 'Sim', '', '', '', 'Transporte', 'Contato de emergência centro', '123', 'Sim', '', ''],
    ['Agenda', 'Status', 'Agendado', 'Sim', '', '', '', 'Agenda', 'Status', 'Pendente', 'Sim', '', '']
  ]);
  let locked = false;
  let flushes = 0;
  let sheetReads = 0;
  const audits = [];
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { flush() { assert.equal(locked, true); flushes++; } }
  });
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role });
  server.codexWriteAuditLog_ = () => {};
  server.codexWriteAuditChanges_ = (...args) => { assert.equal(locked, true); audits.push(args); };
  server.clearConfigAppDefaultsCache_ = () => { assert.equal(locked, true); };
  server.getConfigAppSheet_ = () => { assert.equal(locked, true); sheetReads++; return sheet; };
  server.codexWithDocumentLock_ = (_name, callback) => {
    locked = true;
    try { if (beforeLock) beforeLock(sheet); return callback(); }
    finally { locked = false; }
  };
  return { server, sheet, audits, counters: () => ({ flushes, sheetReads }) };
}

test('Transporte exige confirmacao antes de criar, editar ou trocar grupo nos dois blocos', () => {
  const attempts = [
    { grupo: 'Transporte', chave: 'CNPJ do centro', valor: '12345678901234' },
    { grupo: '  tRáNsPoRtE  ', chave: 'Contato', valor: 'Teste' },
    { rowIndex: 2, startCol: 1, grupo: 'Agenda', chave: 'Status', valor: 'Alterado' },
    { rowIndex: 2, startCol: 8, grupo: 'Agenda', chave: 'Status', valor: 'Alterado' },
    { rowIndex: 3, startCol: 1, grupo: 'Transporte', chave: 'Peso', valor: '99' },
    { rowIndex: 2, startCol: 1, grupo: 'Transporte', chave: 'Peso', valor: '99', ativo: 'Não' }
  ];
  for (const role of ['user', 'admin']) for (const payload of attempts) {
    const { server, sheet, audits } = fixture(role);
    const initial = JSON.stringify(sheet.rows);
    assert.throws(() => server.salvarConfigAppItem(payload), /Confirme/);
    assert.equal(sheet.writes, 0);
    assert.equal(JSON.stringify(sheet.rows), initial);
    assert.equal(audits.length, 0);
  }
});

test('exclusao de Transporte exige confirmacao nos dois blocos; readonly continua bloqueado', () => {
  for (const startCol of [1, 8]) {
    const { server, sheet } = fixture();
    assert.throws(() => server.excluirConfigAppItem(2, startCol), /Confirme/);
    assert.equal(sheet.writes, 0);
  }
  const { server, counters } = fixture('readonly');
  assert.throws(() => server.salvarConfigAppItem({ grupo: 'Agenda', chave: 'Status', valor: 'A' }), /somente leitura/);
  assert.throws(() => server.excluirConfigAppItem(2, 1), /somente leitura/);
  assert.equal(counters().sheetReads, 0);
});

test('grupo persistido e revalidado dentro do lock depois de uma mudanca concorrente', () => {
  const { server, sheet } = fixture('user', target => { target.rows[2][0] = 'Transporte'; });
  assert.throws(() => server.salvarConfigAppItem({ rowIndex: 3, startCol: 1, grupo: 'Agenda', chave: 'Status', valor: 'A' }), /Confirme/);
  assert.equal(sheet.writes, 0);
});

test('user e admin confirmados criam, editam, movem e excluem Transporte com auditoria e flush', () => {
  for (const role of ['user', 'admin']) {
  const { server, sheet, audits, counters } = fixture(role);
  assert.match(server.salvarConfigAppItem({ grupo: 'Transporte', chave: 'Peso', valor: '2,5', confirmarAlteracaoTransporte: true }), /cadastrada/);
  assert.match(server.salvarConfigAppItem({ rowIndex: 2, startCol: 8, grupo: 'Transporte', chave: 'Contato', valor: '999', confirmarAlteracaoTransporte: true }), /atualizada/);
  assert.equal(sheet.rows[1][9], '999');
  assert.match(server.salvarConfigAppItem({ rowIndex: 2, startCol: 1, grupo: 'Agenda', chave: 'Status', valor: 'A', confirmarAlteracaoTransporte: true }), /atualizada/);
  assert.match(server.excluirConfigAppItem(4, 1, { confirmarAlteracaoTransporte: true }), /excluída/);
  assert.equal(audits.length, 4);
  assert.equal(counters().flushes, 4);
  }
});

test('confirmacao deve ser booleano true e grupo calculado nao contorna a confirmacao', () => {
  for (const confirmarAlteracaoTransporte of ['true', 1, {}, false]) {
    const { server, sheet } = fixture();
    assert.throws(() => server.salvarConfigAppItem({ grupo: 'Transporte', chave: 'Peso', valor: '99', confirmarAlteracaoTransporte }), /Confirme/);
    assert.equal(sheet.writes, 0);
  }
  for (const rowIndex of ['', 3]) {
    const { server, sheet, counters } = fixture();
    assert.throws(() => server.salvarConfigAppItem({ rowIndex, startCol: 1, grupo: '="Transporte"', chave: 'Peso', valor: '99' }), /sem fórmula/);
    assert.equal(sheet.writes, 0);
    assert.equal(counters().sheetReads, 0);
  }
});

test('user conserva edicao e exclusao de outros grupos', () => {
  const { server, sheet, counters } = fixture('user');
  assert.match(server.salvarConfigAppItem({ rowIndex: 3, startCol: 1, grupo: 'Agenda', chave: 'Status', valor: 'Pendente' }), /atualizada/);
  assert.equal(sheet.rows[2][2], 'Pendente');
  assert.match(server.excluirConfigAppItem(3, 8), /excluída/);
  assert.equal(counters().flushes, 2);
});
