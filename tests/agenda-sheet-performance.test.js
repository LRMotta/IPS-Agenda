'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function sheetServer() {
  const calls = { spreadsheet: 0, lookup: 0, dimensions: 0, headers: 0 };
  const logs = [];
  let headers = Array(53).fill('');
  headers[51] = 'Backup - Temperatura';
  headers[52] = 'ID Cadastro Participante';
  const sheet = {
    getLastColumn() { calls.dimensions++; return headers.length; },
    getRange(row, column, rows, columns) {
      assert.equal(row, 1, 'getter somente consulta cabecalho');
      assert.equal(column, 1);
      assert.equal(rows, 1);
      assert.equal(columns, headers.length);
      return { getValues() { calls.headers++; return [headers.slice()]; } };
    }
  };
  const spreadsheet = {
    getSheetByName(name) { calls.lookup++; return name === 'Agenda' ? sheet : null; }
  };
  const server = runFile('WebApp.gs', {
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
    SpreadsheetApp: { getActiveSpreadsheet() { calls.spreadsheet++; return spreadsheet; } },
    Logger: { log(message) { logs.push(JSON.parse(message.replace(/^\[CODEX_PERF\]\s*/, ''))); } }
  });
  return { server, calls, logs, sheet, setHeaders(value) { headers = value; } };
}

test('edicao mede obtencao da planilha e schema com uma leitura de cabecalho e sem dados pessoais', () => {
  const { server, calls, logs, sheet, setHeaders } = sheetServer();
  const headers = Array(53).fill('Cabecalho sigiloso');
  headers[51] = 'Backup - Temperatura';
  headers[52] = 'ID Cadastro Participante';
  setHeaders(headers);
  assert.equal(server.getAgendaSheetForRead_('getAgendaEdicaoContexto'), sheet);
  assert.deepEqual(calls, { spreadsheet: 1, lookup: 2, dimensions: 1, headers: 1 });
  assert.equal(server.AGENDA_CFG.col.backupTemperatura, 52);
  assert.equal(server.AGENDA_CFG.col.participanteCadastroId, 53);
  assert.deepEqual(logs.map(log => log.stage), [
    'sheet_spreadsheet', 'sheet_lookup', 'sheet_dimensions', 'sheet_headers', 'sheet_schema'
  ]);
  const headerLog = logs.find(log => log.stage === 'sheet_headers');
  assert.equal(headerLog.instrumentedReadCalls, 1);
  assert.equal(headerLog.instrumentedCellsRead, 53);
  assert.equal(logs.every(log => log.success), true);
  assert.doesNotMatch(JSON.stringify(logs), /sigiloso|Cadastro|Temperatura/);
});

test('cada obtencao revalida schema fresco, incluindo cabecalhos legados e campos ausentes', () => {
  const { server, calls, logs, setHeaders } = sheetServer();
  server.getAgendaSheetForRead_('getAgendaEdicaoContexto');
  const headers = Array(54).fill('');
  headers[50] = 'ID interno participante';
  headers[53] = 'temperatura backup';
  setHeaders(headers);
  server.getAgendaSheetForRead_('getAgendaEdicaoContexto');
  assert.equal(server.AGENDA_CFG.col.backupTemperatura, 54);
  assert.equal(server.AGENDA_CFG.col.participanteCadastroId, 51);
  setHeaders(Array(51).fill(''));
  server.getAgendaSheetForRead_();
  assert.equal(server.AGENDA_CFG.col.backupTemperatura, 0);
  assert.equal(server.AGENDA_CFG.col.participanteCadastroId, 0);
  assert.equal(server.AGENDA_CFG.idx.cb.temp, -1);
  assert.equal(server.AGENDA_CFG.idx.participanteCadastroId, -1);
  assert.equal(calls.headers, 3, 'schema nao pode sobreviver a outra consulta');
  assert.equal(calls.dimensions, 3);
  assert.equal(calls.spreadsheet, 1, 'somente o handle de Spreadsheet ja e reutilizado na execucao');
  assert.equal(logs.length, 10, 'getter sem operation nao adiciona telemetria');
});

test('RPC de edicao autoriza toda chamada antes de obter a planilha e nao memoiza permissoes', () => {
  const { server, calls, logs, sheet } = sheetServer();
  let allowed = true;
  let checks = 0;
  server.codexAuthorizeWebAppRequest_ = () => { checks++; return { ok: allowed, message: 'Acesso negado.' }; };
  server.agendaLerEventoPorId_ = (id, row, options) => {
    assert.equal(options.sheet, sheet);
    return { id, tipo: 'Consulta' };
  };
  assert.equal(server.getAgendaEdicaoContexto('EVT-SIGILOSO', 2).evento.id, 'EVT-SIGILOSO');
  assert.equal(logs.some(log => log.stage === 'sheet_headers'), true);
  const priorCalls = { ...calls };
  allowed = false;
  assert.throws(() => server.getAgendaEdicaoContexto('EVT-SIGILOSO', 2), /Acesso negado/);
  assert.equal(checks, 2);
  assert.deepEqual(calls, priorCalls, 'negacao antecede qualquer leitura da Agenda');
  assert.equal(logs.filter(log => log.stage === 'authorization').at(-1).success, false);
  assert.doesNotMatch(JSON.stringify(logs), /SIGILOSO/);
});

test('falha de leitura do cabecalho permanece falha da consulta e registra etapa sem dados', () => {
  const { server, sheet, logs } = sheetServer();
  const error = new Error('Mensagem com dado sigiloso');
  sheet.getRange = () => ({ getValues() { throw error; } });
  assert.throws(() => server.getAgendaSheetForRead_('getAgendaEdicaoContexto'), value => value === error);
  assert.equal(logs.find(log => log.stage === 'sheet_headers').success, false);
  assert.doesNotMatch(JSON.stringify(logs), /sigiloso/);
});

test('expansao de periodo reutiliza dimensao da mesma leitura e consulta novamente na proxima RPC', () => {
  const server = runFile('WebApp.gs', {
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_, Logger: { log() {} }
  });
  server.getCodexSheetDataByName_ = () => [['ID', 'Nome', 'Codigo'], ['PROJ-1', 'Projeto', 'PA']];
  function row(values) {
    const result = Array(server.AGENDA_CFG.lastCol).fill('');
    Object.keys(values).forEach(key => { result[server.AGENDA_CFG.idx[key]] = values[key]; });
    return result;
  }
  const rows = Array.from({ length: 400 }, (_, i) => row({ id: 'H' + i, data: '2020-01-01', tipo: 'Visita' }));
  const period = Array.from({ length: 35 }, (_, i) => row({
    id: 'M' + i, data: new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10),
    tipo: 'Monitoria', projeto: 'PA', monitorName: 'Monitor legado', salaMonitoria: 'Sala legada'
  }));
  rows.push(...period);
  let lastRowCalls = 0;
  const ranges = [];
  const sheet = {
    getLastRow() { lastRowCalls++; return rows.length + 1; },
    getRange(start, column, count, columns) {
      ranges.push({ start, column, count, columns });
      return { getValues: () => rows.slice(start - 2, start - 2 + count).map(value => value.slice(column - 1, column - 1 + columns)) };
    }
  };
  const actual = server.agendaPeriodoOperacionalDaLinha_(sheet, 'M10', 412, period[10], 'test', {});
  assert.equal(actual.ids.length, 35);
  assert.equal(actual.inicio, '2026-10-01');
  assert.equal(actual.fim, '2026-11-04');
  assert.ok(ranges.filter(range => range.columns > 1).length > 1, 'cenario exige expansao');
  assert.equal(lastRowCalls, 1, 'expansoes nao repetem getLastRow');
  const legacy = server.agendaPeriodoOperacionalDaLinha_(sheet, 'M10', 412, period[10], 'test', {}, { attempts: 2 });
  assert.deepEqual(actual, legacy);
  assert.equal(lastRowCalls, 2, 'nova chamada reconsulta dimensao');
});
