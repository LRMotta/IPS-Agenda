'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function auditServer(start = 0) {
  let uuidCount = start;
  const server = runFile('WebApp.gs', {
    Utilities: {
      formatDate: () => '20261007120000',
      getUuid: () => '00000000-0000-4000-8000-' + String(++uuidCount).padStart(12, '0')
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  // Reproduz o defeito anterior sem depender de sorte ou da velocidade da máquina.
  vm.runInContext('Math.random = () => 0.5', server);
  server.codexGetActiveUserEmail_ = () => 'tester@example.invalid';
  return { server, get uuidCount() { return uuidCount; } };
}

test('IDs de auditoria preservam UUID completo em lote no mesmo segundo e em execuções distintas', () => {
  const first = auditServer();
  const ids = Array.from({ length: 12000 }, () => first.server.codexGenerateAuditId_());
  const second = auditServer(first.uuidCount);
  ids.push(second.server.codexGenerateAuditId_());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(first.uuidCount, 12000);
  assert.equal(ids[0], 'AUD-20261007120000-00000000-0000-4000-8000-000000000001');
  assert.equal(ids.at(-1), 'AUD-20261007120000-00000000-0000-4000-8000-000000012001');
});

test('log e alterações em lote recebem IDs distintos e preservam conteúdo e histórico', () => {
  const fixture = auditServer();
  const log = new FakeSheet('Audit_Log', [
    ['ID', 'Email', 'Ação', 'Timestamp', 'Módulo', 'Record ID'],
    ['AUD-20260101120000-5500', 'old@example.invalid', 'legado', '2026-01-01', 'Sistema', 'LEG-1']
  ]);
  const changes = new FakeSheet('Audit_Changes', [
    ['Audit ID', 'Timestamp', 'User Email', 'Módulo', 'Ação', 'Record ID', 'Campo', 'Valor anterior', 'Valor novo', 'Motivo/observação'],
    ['AUD-20260101120000-5501', '2026-01-01', 'old@example.invalid', 'Sistema', 'legado', 'LEG-1', 'Campo', 'A', 'B', 'Histórico']
  ]);
  const originalLog = log.getDataRange().getValues();
  const originalChanges = changes.getDataRange().getValues();
  fixture.server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Audit_Log: log, Audit_Changes: changes });
  let batchWrites = 0;
  const getRange = changes.getRange.bind(changes);
  changes.getRange = (...args) => {
    const range = getRange(...args);
    const setValues = range.setValues.bind(range);
    range.setValues = values => { batchWrites++; return setValues(values); };
    return range;
  };
  const entries = Array.from({ length: 500 }, (_, index) => ({
    moduleName: 'Sistema', action: 'salvarPerfisUsuariosAdmin', recordId: 'USER-' + index,
    changes: [
      { field: 'Nome', oldValue: 'Anterior', newValue: 'Atual' },
      { field: 'Formação', oldValue: '', newValue: 'Enfermeiro(a)' },
      { field: 'Sem alteração', oldValue: 'igual', newValue: 'igual' }
    ],
    note: 'Carga rápida de perfis'
  }));
  for (const entry of entries) fixture.server.codexWriteAuditLog_(entry.action, entry.moduleName, entry.recordId);
  fixture.server.codexWriteAuditChangesBatch_(entries);
  fixture.server.codexWriteAuditChanges_('Agenda', 'monitor', 'AG-1', [
    { field: 'Status', oldValue: 'Agendado', newValue: 'Enviado' }
  ], 'Monitor simulado');
  const logRows = log.getDataRange().getValues();
  const changeRows = changes.getDataRange().getValues();
  assert.deepEqual(logRows.slice(0, 2), originalLog);
  assert.deepEqual(changeRows.slice(0, 2), originalChanges);
  assert.equal(logRows.length, 502);
  assert.equal(changeRows.length, 1003);
  const generatedIds = [...logRows.slice(2), ...changeRows.slice(2)].map(row => row[0]);
  assert.equal(new Set(generatedIds).size, 1501);
  assert.equal(fixture.uuidCount, 1501);
  assert.equal(batchWrites, 2);
  assert.deepEqual(logRows[2].slice(4), ['Sistema', 'USER-0']);
  assert.deepEqual(changeRows[2].slice(2), [
    'tester@example.invalid', 'Sistema', 'salvarPerfisUsuariosAdmin', 'USER-0', 'Nome', 'Anterior', 'Atual', 'Carga rápida de perfis'
  ]);
  assert.deepEqual(changeRows.at(-1).slice(3), ['Agenda', 'monitor', 'AG-1', 'Status', 'Agendado', 'Enviado', 'Monitor simulado']);
  fixture.server.codexAssertAdmin_ = () => {};
  assert.equal(fixture.server.getAuditLogPage(1, 0).rows[0].id, logRows.at(-1)[0]);
  assert.equal(fixture.server.getAuditChangesPage(1, 0).rows[0].id, changeRows.at(-1)[0]);
  assert.equal(fixture.server.getAuditLogPage(1, 500).rows[0].id, originalLog[1][0]);
  assert.equal(fixture.server.getAuditChangesPage(1, 1001).rows[0].id, originalChanges[1][0]);
});
