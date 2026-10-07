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
  server.getProjetosDados_ = () => { read(10, 2, 3); return [{ nomeAbreviado: 'DADO_PRIVADO' }]; };
  server.getParticipantesDashboardResumo_ = () => { read(20, 3, 4); return [{ nome: 'DADO_PRIVADO' }]; };
  server.getEstoque = () => { read(30, 4, 5); return []; };
  server.getAgendaDashboardResumo_ = () => { read(40, 5, 6); return {}; };
  server.getDashboardPendencias_ = () => { throw new Error('Dashboard não deve calcular pendências'); };
  return { server, read, entries: () => logs.filter(line => line.startsWith('[CODEX_PERF] '))
    .map(line => JSON.parse(line.slice('[CODEX_PERF] '.length))) };
}

test('Dashboard mede cada etapa e total sem duplicar leituras ou alterar a resposta', () => {
  const f = fixture();
  f.read(100, 9, 9); // Leituras anteriores na mesma execução não pertencem ao Dashboard.
  const result = f.server.getDashboardData({ traceId: 'dashboard-stage-test' });
  assert.equal(result.projetos[0].nomeAbreviado, 'DADO_PRIVADO');
  const entries = f.entries();
  assert.equal(entries.every(entry => entry.traceId === 'dashboard-stage-test'), true);
  assert.deepEqual(entries.map(entry => entry.stage), ['access', 'projects', 'participants', 'stock', 'agenda', 'serialize', 'total']);
  assert.deepEqual(entries.slice(0, 5).map(entry => entry.durationMs), [5, 10, 20, 30, 40]);
  const total = entries.at(-1);
  assert.equal(total.durationMs, 105);
  assert.equal(total.instrumentedReadCalls, 5);
  assert.equal(total.instrumentedCellsRead, 70);
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

test('Pendências mede acesso, estoque, composição e serialização sem alterar resultado', () => {
  const f = fixture();
  f.server.codexGetCurrentUserAccess = () => { f.read(5); return { ok: true }; };
  f.server.getEstoqueResumoParaPendencias_ = () => { f.read(10, 2, 3); return []; };
  f.server.getDashboardPendencias_ = (_stock, perf) => {
    assert.equal(perf.traceId, 'pending-stage-test');
    f.read(20, 3, 4);
    return { counts: { courier: 2 }, courier: [{ nome: 'DADO_PRIVADO' }] };
  };
  const result = f.server.getPendenciasOperacionais({ traceId: 'pending-stage-test' });
  assert.equal(result.pendencias.courier[0].nome, 'DADO_PRIVADO');
  const entries = f.entries();
  assert.deepEqual(entries.map(e => e.stage), ['access', 'stock', 'pending', 'serialize', 'total']);
  assert.equal(entries.every(e => e.traceId === 'pending-stage-test'), true);
  assert.equal(entries.at(-1).durationMs, 35);
  assert.equal(entries.at(-1).instrumentedReadCalls, 3);
  assert.equal(entries.at(-1).instrumentedCellsRead, 20);
  assert.equal(entries.at(-1).responseBytes, Buffer.byteLength(JSON.stringify(result)));
  assert.equal(JSON.stringify(entries).includes('DADO_PRIVADO'), false);
});

test('Pendências preserva acesso negado e falha de composição com total malsucedido', () => {
  for (const denied of [true, false]) {
    const f = fixture();
    f.server.codexGetCurrentUserAccess = () => ({ ok: !denied, message: 'negado' });
    f.server.getEstoqueResumoParaPendencias_ = () => [];
    f.server.getDashboardPendencias_ = () => { throw new Error('DADO_PRIVADO'); };
    assert.throws(() => f.server.getPendenciasOperacionais(), denied ? /negado/ : /DADO_PRIVADO/);
    assert.equal(f.entries().at(-1).success, false);
    assert.equal(f.entries().some(e => e.stage === 'stock'), !denied);
  }
});

test('Agenda propaga trace e contadores para referências, janela e revisão', () => {
  const f = fixture();
  f.server.agendaWindowedLoadingV2EnabledForAccess_ = () => true;
  f.server.agendaLogBootstrapRequest_ = () => {};
  f.server.agendaGetReferenceData_ = (_force, _cache, measure) => measure('reference_test', {}, () => { f.read(5); return {}; });
  f.server.agendaGetEventosPorPeriodo_ = (_start, _end, _max, _force, measure) =>
    measure('row_read', {}, () => { f.read(10); return { items: [], total: 0 }; });
  f.server.agendaBootstrapRevision_ = () => 'revision';
  const result = f.server.agendaGetBootstrapForAccess_({ ok: true }, '2026-10-01', '2026-10-08', false, 'app_initial', 'agenda-stage-test');
  assert.equal(result.revision, 'revision');
  assert.equal(f.entries().every(e => e.traceId === 'agenda-stage-test'), true);
  assert.equal(f.entries().find(e => e.stage === 'reference_test').instrumentedReadCalls, 1);
  assert.equal(f.entries().find(e => e.stage === 'row_read').instrumentedReadCalls, 1);
});

test('subetapas reais de Pendências preservam resultado e ordem de classificação/anotações', () => {
  const { dashboardAgendaFixture } = require('./helpers/dashboard-agenda-fixture');
  const f = dashboardAgendaFixture();
  const logs = [], order = [];
  f.server.Logger = { log: line => logs.push(line) };
  f.server.getAgendaFeriadosPendenciasMap_ = () => ({});
  f.server.transporteDocumentosSemEnvioPendencias_ = () => [];
  const originalSort = f.server.ordenarPendenciasAgendaPorUrgencia_;
  f.server.ordenarPendenciasAgendaPorUrgencia_ = values => { order.push('sort'); return originalSort(values); };
  f.server.courierLembreteAnotarPendencias_ = () => { order.push('reminders'); };
  const result = f.server.getDashboardPendencias_([], { operation: 'getPendenciasOperacionais', traceId: 'pending-real-test' });
  const entries = logs.filter(line => line.startsWith('[CODEX_PERF] ')).map(line => JSON.parse(line.slice(13)));
  assert.deepEqual(entries.map(e => e.stage), ['pending_sheet', 'pending_agenda_read', 'pending_holidays',
    'pending_classify_agenda', 'pending_transport_documents', 'pending_classify_documents', 'pending_classify_stock',
    'pending_sort_unbooked', 'pending_reminder_annotations', 'pending_sort']);
  assert.equal(entries.every(e => e.traceId === 'pending-real-test' && e.success), true);
  assert.equal(entries.find(e => e.stage === 'pending_agenda_read').instrumentedReadCalls, 1);
  assert.deepEqual(order.slice(0, 2), ['sort', 'reminders']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), JSON.parse(JSON.stringify(f.server.getDashboardPendencias_([]))));
});
