'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture() {
  let clock = 0;
  const logs = [];
  const server = runFile('WebApp.gs', {
    Date: class extends Date { static now() { return clock; } },
    Logger: { log: message => logs.push(message) },
    Utilities: { newBlob: value => ({ getBytes: () => Buffer.from(value, 'utf8') }) }
  });
  function read(ms, rows = 1, cols = 2) {
    return server.codexReadValuesMeasured_({ getValues() {
      clock += ms;
      return Array.from({ length: rows }, () => Array(cols).fill('DADO_PRIVADO'));
    } }, false);
  }
  server.codexAssertCanRead_ = () => { read(5); };
  server.getProjetos = () => { read(10, 2, 3); return [{ nomeAbreviado: 'DADO_PRIVADO' }]; };
  server.getParticipantesDashboardResumo_ = () => { read(20, 3, 4); return [{ nome: 'DADO_PRIVADO' }]; };
  server.getEstoque = () => { read(30, 4, 5); return []; };
  server.getAgendaDashboardResumo_ = () => { read(40, 5, 6); return {}; };
  server.getDashboardPendencias_ = () => { read(50, 6, 7); return {}; };
  return { server, read, entries: () => logs.filter(line => line.startsWith('[CODEX_PERF] '))
    .map(line => JSON.parse(line.slice('[CODEX_PERF] '.length))) };
}

test('Dashboard mede cada etapa e total sem duplicar leituras ou alterar a resposta', () => {
  const f = fixture();
  f.read(100, 9, 9); // Leituras anteriores na mesma execução não pertencem ao Dashboard.
  const result = f.server.getDashboardData();
  assert.equal(result.projetos[0].nomeAbreviado, 'DADO_PRIVADO');
  const entries = f.entries();
  assert.deepEqual(entries.map(entry => entry.stage), ['access', 'projects', 'participants', 'stock', 'agenda', 'pending', 'serialize', 'total']);
  assert.deepEqual(entries.slice(0, 6).map(entry => entry.durationMs), [5, 10, 20, 30, 40, 50]);
  const total = entries.at(-1);
  assert.equal(total.durationMs, 155);
  assert.equal(total.instrumentedReadCalls, 6);
  assert.equal(total.instrumentedCellsRead, 112);
  assert.equal(total.rowCount, 2);
  assert.equal(total.responseBytes, Buffer.byteLength(JSON.stringify(result)));
  assert.equal(entries.some(entry => JSON.stringify(entry).includes('DADO_PRIVADO')), false);
});

test('falha parcial do Dashboard é marcada na etapa e conserva os fallbacks', () => {
  const f = fixture();
  f.server.getEstoque = () => { f.read(30); throw new Error('DADO_PRIVADO'); };
  const result = f.server.getDashboardData();
  assert.equal(result.secoes.estoque, false);
  assert.equal(result.estoqueResumo.lotes, 0);
  assert.equal(f.entries().find(entry => entry.stage === 'stock').success, false);
  assert.equal(f.entries().at(-1).success, true); // RPC retornou a resposta parcial prevista.
  assert.equal(f.entries().some(entry => JSON.stringify(entry).includes('DADO_PRIVADO')), false);
});

test('acesso negado não inicia consultas do Dashboard e preserva a exceção', () => {
  const f = fixture();
  const failure = new Error('negado');
  f.server.codexAssertCanRead_ = () => { throw failure; };
  assert.throws(() => f.server.getDashboardData(), error => error === failure);
  assert.deepEqual(f.entries().map(entry => entry.stage), ['access', 'total']);
  assert.equal(f.entries().at(-1).instrumentedReadCalls, 0);
  assert.equal(f.entries().every(entry => !entry.success), true);
});

test('bootstrap mede leituras por etapa e bytes UTF-8 mantendo o trace e contrato', () => {
  const f = fixture();
  f.server.codexGetCurrentUserAccess = () => { f.read(5); return { ok: true, role: 'admin' }; };
  f.server.agendaWindowedLoadingV2EnabledForAccess_ = () => false;
  f.server.codexGetUserOAuthStatus_ = () => ({});
  f.server.codexGetAppVersion_ = () => ({});
  f.server.ScriptApp = { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) };
  f.server.getDadosFormularioAgenda = strict => { assert.equal(strict, true); f.read(20, 2, 4); return { label: 'ação' }; };
  f.server.codexGetTeamBirthdays_ = () => { f.read(10); return []; };
  const result = f.server.getAppBootstrapData({ traceId: 'bootstrap-measure-test' });
  assert.equal(result.agendaFormData.label, 'ação');
  const entries = f.entries();
  assert.equal(entries.every(entry => entry.traceId === 'bootstrap-measure-test'), true);
  assert.equal(entries.find(entry => entry.stage === 'agenda_form_data').durationMs, 20);
  assert.equal(entries.at(-1).durationMs, 35);
  assert.equal(entries.at(-1).instrumentedReadCalls, 3);
  assert.equal(entries.at(-1).instrumentedCellsRead, 12);
  assert.equal(entries.at(-1).responseBytes, Buffer.byteLength(JSON.stringify(result)));
});

test('leitura formatada permanece intacta e falha de telemetria não altera a operação', () => {
  const f = fixture();
  const values = [['01/10/2026', '00123']];
  f.server.Logger.log = () => { throw new Error('log indisponível'); };
  const result = f.server.codexMeasureReadPerformance_('teste', 'total', {}, () =>
    f.server.codexReadValuesMeasured_({ getDisplayValues: () => values }, true));
  assert.equal(result, values);
  const failure = new Error('falha original');
  assert.throws(() => f.server.codexMeasureReadPerformance_('teste', 'total', {}, () => {
    throw failure;
  }), error => error === failure);
});
