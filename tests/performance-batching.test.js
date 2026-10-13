'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

test('exclusões agrupam intervalos descendentes, deduplicam linhas e preservam vizinhos', () => {
  const server = runFile('WebApp.gs');
  const sheet = new FakeSheet('Itens', [['Cabeçalho'], ...'abcdefgh'.split('').map(id => [id])]);
  const calls = [];
  const remove = sheet.deleteRows.bind(sheet);
  sheet.deleteRows = (start, count) => { calls.push([start, count]); remove(start, count); };
  sheet.deleteRow = () => { throw new Error('Não excluir individualmente'); };
  server.codexDeleteRowBlocks_(sheet, [8, 6, 5, 2, 7, 5]);
  assert.deepEqual(calls, [[5, 4], [2, 1]]);
  assert.deepEqual(sheet.rows, [['Cabeçalho'], ['b'], ['c'], ['h']]);
  assert.throws(() => server.codexDeleteRowBlocks_(sheet, [2, 1]), /Linha inválida/);
  assert.equal(calls.length, 2, 'Validar todas as linhas antes da primeira exclusão');
});

test('auditoria do bloco concluído ocorre mesmo se a próxima exclusão falhar', () => {
  const server = runFile('WebApp.gs');
  const events = [];
  const sheet = { deleteRows: start => { events.push('delete-' + start); if (start === 2) throw new Error('Falha de Sheets'); } };
  assert.throws(() => server.codexDeleteRowBlocks_(sheet, [2, 5, 6], (start, count) => events.push('audit-' + start + '-' + count)), /Falha de Sheets/);
  assert.deepEqual(events, ['delete-5', 'audit-5-2', 'delete-2']);
});

test('período intercalado lê uma vez após as escritas e mantém IDs/auditoria por registro', () => {
  let flushes = 0;
  const server = runFile('WebApp.gs', { SpreadsheetApp: { flush: () => flushes++ } });
  const idx = server.AGENDA_CFG.idx;
  const make = id => { const row = Array(server.AGENDA_CFG.lastCol).fill(''); row[idx.id] = id; row[idx.data] = 'antes-' + id; return row; };
  const agenda = new FakeSheet('Agenda', [make('header'), ...['A', 'vizinho-1', 'B', 'C', 'D', 'vizinho-2', 'E'].map(make)]);
  const originals = [4, 2, 5, 6, 8].map(rowIndex => ({ rowIndex, row: agenda.rows[rowIndex - 1].slice() }));
  const reads = [], deletes = [], audits = [];
  let updates = 0, sorts = 0;
  const range = agenda.getRange.bind(agenda);
  agenda.getRange = (...args) => {
    const result = range(...args);
    const read = result.getValues.bind(result);
    result.getValues = () => { assert.equal(updates, 2); reads.push(args); return read(); };
    result.sort = () => { sorts++; return result; };
    return result;
  };
  const remove = agenda.deleteRows.bind(agenda);
  agenda.deleteRows = (start, count) => { deletes.push([start, count]); remove(start, count); };
  server.agendaTipoPeriodoLabel_ = () => 'Monitoria';
  server.agendaDatasPeriodo_ = () => ['nova-B', 'nova-A'];
  server.agendaPeriodoRowsDoPeriodo_ = () => originals;
  server.agendaWritePeriodoRow_ = (sheet, row, date) => { updates++; sheet.rows[row - 1][idx.data] = date; };
  server.agendaAuditChangesFromRows_ = (before, after) => [{ oldValue: before[idx.data], newValue: after[idx.data] }];
  server.codexWriteAuditChanges_ = (_module, _action, id, changes) => audits.push({ id, changes });
  server.formatarDataSafe = String;
  server.agendaInvalidateDateIndexCache_ = () => assert.equal(flushes, 1);
  server.agendaEmailEnabled_ = () => false;
  const result = server.agendaAtualizarPeriodoEvento_(agenda, {}, 4, originals[0].row, { id: 'B' }, 'monitoria');
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0], [2, 1, 3, server.AGENDA_CFG.lastCol]);
  assert.deepEqual(Array.from(result.ids), ['B', 'A']);
  assert.deepEqual(deletes, [[8, 1], [5, 2]]);
  assert.deepEqual(audits.map(a => a.id), ['B', 'A', 'E', 'D', 'C']);
  assert.equal(audits[0].changes[0].newValue, 'nova-B');
  assert.equal(audits[1].changes[0].newValue, 'nova-A');
  assert.deepEqual(agenda.rows.map(row => row[idx.id]), ['header', 'A', 'vizinho-1', 'B', 'vizinho-2']);
  assert.equal(sorts, 1);
});

function dhlFixture(count = 60) {
  let now = 0, locked = false, sequence = 0;
  const properties = new Map();
  const sleeps = [], calls = [];
  const keys = Array.from({ length: count }, (_, i) => String(1000000000 + i));
  const server = runFile('WebApp.gs', {
    Date: class extends Date { static now() { return now; } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => { assert.equal(locked, true); properties.set(key, value); },
      deleteProperty: key => { assert.equal(locked, true); properties.delete(key); }
    }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => { assert.equal(locked, false); locked = true; return true; },
      releaseLock: () => { assert.equal(locked, true); locked = false; }
    }) },
    Utilities: { getUuid: () => 'run-' + ++sequence, sleep: ms => { assert.equal(locked, false); sleeps.push(ms); now += ms; } }
  });
  server.getDhlTrackingApiKey_ = () => 'SIMULADO';
  server.getAgendaSheet_ = () => ({ getLastRow: () => 2, getRange: () => ({ getValues: () => [], getDisplayValues: () => [] }) });
  server.getAgendaDhlAwbsPendentesEntrega_ = () => Object.fromEntries(keys.map(key => [key, []]));
  server.consultarEntregaDhl_ = awb => { assert.equal(locked, false); calls.push(awb); return { entregue: false }; };
  return { server, properties, sleeps, calls, keys, advance: ms => { now += ms; } };
}

test('DHL impõe teto absoluto, intervalos e cursor que dá vez às AWBs seguintes', () => {
  const f = dhlFixture();
  // Sem avanço de tempo, isolar o teto absoluto de consultas.
  f.server.Utilities.sleep = ms => f.sleeps.push(ms);
  const first = f.server.monitorarEntregasDhlAgendadas_({ maxConsultas: 999 });
  assert.equal(first.verificados, 45);
  assert.equal(f.sleeps.length, 44);
  assert.ok(f.sleeps.every(ms => ms === 5200));
  f.server.monitorarEntregasDhlAgendadas_({ maxConsultas: 3 });
  assert.deepEqual(f.calls.slice(45), f.keys.slice(45, 48));
  assert.equal(f.properties.has(f.server.DHL_TRACKING_RUN_PROPERTY_), false);
});

test('DHL interrompe antes do orçamento, conserva cursor e retoma em chamada seguinte', () => {
  const f = dhlFixture();
  const result = f.server.monitorarEntregasDhlAgendadas_({ maxConsultas: 45 });
  assert.equal(result.interrompidoPorTempo, true);
  assert.ok(result.verificados < 45);
  assert.equal(result.restantes, 60 - result.verificados);
  f.server.monitorarEntregasDhlAgendadas_({ maxConsultas: 1 });
  assert.equal(f.calls.at(-1), f.keys[result.verificados]);
});

test('DHL recusa execução sobreposta, recupera reserva expirada e respeita token de outro executor', () => {
  const f = dhlFixture(1);
  const active = f.server.dhlTrackingClaimRun_();
  assert.equal(f.server.monitorarEntregasDhlAgendadas_().ignorado, true);
  assert.equal(f.calls.length, 0);
  f.advance(420001);
  const replacement = f.server.dhlTrackingClaimRun_();
  f.server.dhlTrackingReleaseRun_(active, true);
  assert.equal(JSON.parse(f.properties.get(f.server.DHL_TRACKING_RUN_PROPERTY_)).token, replacement.token);
  f.server.dhlTrackingReleaseRun_(replacement, true);
  assert.equal(f.properties.has(f.server.DHL_TRACKING_RUN_PROPERTY_), false);
});

test('DHL libera reserva após falha de persistência e não avança o cursor de um lote incompleto', () => {
  const f = dhlFixture(1);
  f.server.monitorarEntregasDhlLote_ = (_options, run) => { run.lastAwb = f.keys[0]; throw new Error('Sheets indisponível'); };
  assert.throws(() => f.server.monitorarEntregasDhlAgendadas_(), /Sheets indisponível/);
  assert.equal(f.properties.has(f.server.DHL_TRACKING_RUN_PROPERTY_), false);
  assert.equal(f.properties.has(f.server.DHL_TRACKING_CURSOR_PROPERTY_), false);
});

test('DHL falha HTTP não reutiliza resposta de entrega da AWB anterior', () => {
  const f = dhlFixture(2);
  let queries = 0, marked;
  f.server.consultarEntregaDhl_ = () => { if (++queries === 2) throw new Error('HTTP 429'); return { entregue: true }; };
  f.server.getAgendaDhlAwbsPendentesEntrega_ = () => Object.fromEntries(f.keys.map(key => [key, [{ agendaId: key, nameCol: 1, awbCol: 2, statusCol: 3 }]]));
  f.server.codexWithDocumentLock_ = (_name, callback) => callback();
  const rows = f.keys.map(key => ['DHL', key, 'Agendado']);
  f.server.agendaAutomationSnapshot_ = () => ({ values: rows, display: rows, ids: Object.fromEntries(f.keys.map((key, i) => [key, i + 2])) });
  f.server.AgendaServerRules_ = { courierIsDeliveryTerminal: () => false };
  f.server.normText_ = value => value.toLowerCase();
  f.server.normalizarAwbCourier_ = String;
  f.server.SpreadsheetApp = { flush: () => {} };
  f.server.agendaInvalidateDateIndexCache_ = () => {};
  f.server.agendaWriteAutomationStatuses_ = () => {};
  f.server.codexWriteAuditChangesBatch_ = audits => { marked = audits; };
  const result = f.server.monitorarEntregasDhlAgendadas_({ maxConsultas: 2 });
  assert.equal(result.verificados, 2);
  assert.equal(result.erros.length, 1);
  assert.equal(result.entregues, 1);
  assert.equal(marked.length, 1);
});
