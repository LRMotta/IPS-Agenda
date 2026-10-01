'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');

function fixture() {
  const entries = new Map();
  const reads = {};
  const revisions = {};
  const batches = { get: 0, put: 0 };
  const events = [];
  const logs = [];
  let unavailable = false;
  function value(part, object = false) {
    reads[part] = (reads[part] || 0) + 1;
    const text = part + '-' + (revisions[part] || 1);
    return object ? { label: text } : [text];
  }
  const cache = {
    get(key) { if (unavailable) throw Error('cache indisponivel'); return entries.get(key) || null; },
    put(key, val) { if (unavailable) throw Error('cache indisponivel'); entries.set(key, val); },
    remove(key) { entries.delete(key); },
    getAll(keys) { batches.get++; return Object.fromEntries(keys.map(key => [key, this.get(key)]).filter(([, val]) => val)); },
    putAll(values) { batches.put++; Object.entries(values).forEach(([key, val]) => this.put(key, val)); },
    removeAll(keys) { keys.forEach(key => entries.delete(key)); }
  };
  const spreadsheet = {
    getSheetByName(name) {
      const part = name.includes('dicos') ? 'medicos' : 'prestadores';
      return { getLastRow: () => 2, getRange: () => ({ getValues: () => value(part).map(v => [v]) }) };
    }
  };
  const server = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs'], {
    Logger: { log(line) { logs.push(line); } },
    Utilities: { formatDate: () => '20260915', newBlob: text => ({ getBytes: () => Buffer.from(text) }) },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    PropertiesService: { getScriptProperties: () => ({ setProperty() {}, deleteProperty() {} }) },
    CacheService: { getScriptCache: () => cache },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet }
  });
  const helpers = {
    agendaParticipantesFormulario_: 'participantes', getProjetoOptions_: 'projetos',
    getAgendaLaboratorios_: 'laboratorios', getAgendaCouriers_: 'couriers',
    getAgendaCourierConfigs_: 'courier_config', getAgendaProjetoCourierMap_: 'project_courier_map',
    getAgendaFeriadosOperacionais_: 'feriados', getAgendaTemperaturas_: 'temperaturas',
    getAgendaCourierStatuses_: 'status_courier', getAgendaLabDestinos_: 'laboratorios_destino',
    getAgendaKitsEstoque_: 'kits_coleta', getAgendaEventTypes_: 'tipos_evento',
    getAgendaMonitoriaSalas_: 'salas_monitoria', getAgendaStatuses_: 'status',
    getAgendaProcedimentoChips_: 'procedimento_chips', getMonitores: 'monitores'
  };
  Object.entries(helpers).forEach(([name, part]) => {
    server[name] = () => value(part, ['courier_config', 'project_courier_map'].includes(part));
  });
  server.agendaEmailEnabled_ = () => { value('email_enabled'); return true; };
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'user' });
  server.codexCacheMetaKey_ = key => 'meta:' + key;
  server.agendaWindowedLoadingV2EnabledForAccess_ = () => true;
  server.agendaGetEventosPorPeriodo_ = (start, end, limit, fresh) => {
    events.push({ fresh, bypass: server.CODEX_CACHE_BYPASS_READS_ });
    return { items: [{ id: 'EVENTO', recordVersion: String(events.length) }], total: 1, truncated: false };
  };
  return { server, entries, reads, revisions, batches, events, logs, unavailable: () => { unavailable = true; } };
}

test('revalidacao mede listas e distingue reconstrucao de marca recente sem dados pessoais', () => {
  const f = fixture();
  f.server.getAgendaReferenceDataBackgroundRevalidate();
  const before = { ...f.reads };
  f.server.getAgendaReferenceDataBackgroundRevalidate();
  assert.deepEqual(f.reads, before);
  const summaries = f.logs.filter(line => line.startsWith('[CODEX_AGENDA_REFERENCE_REVALIDATE] '))
    .map(line => JSON.parse(line.slice('[CODEX_AGENDA_REFERENCE_REVALIDATE] '.length)));
  assert.deepEqual(summaries.map(log => log.outcome), ['rebuilt_marked', 'recent_revalidation']);
  assert.notEqual(summaries[0].traceId, summaries[1].traceId);
  assert.ok(summaries.every(log => log.startedAtMs > 0 && log.durationMs >= 0));
  const stages = f.logs.filter(line => line.startsWith('[CODEX_PERF] '))
    .map(line => JSON.parse(line.slice('[CODEX_PERF] '.length)));
  for (const stage of ['authorization', 'reference_kits_coleta', 'reference_feriados', 'reference', 'total']) {
    assert.ok(stages.some(log => log.stage === stage && log.traceId === summaries[0].traceId && log.success), stage);
  }
  assert.doesNotMatch(f.logs.join(''), /medicos-1|participantes-1|kits_coleta-1/);
});

test('revalidacoes sobrepostas antes da marca ficam identificadas como duas reconstrucoes', () => {
  const f = fixture();
  const original = f.server.getAgendaKitsEstoque_;
  let nested = false;
  f.server.getAgendaKitsEstoque_ = () => {
    if (!nested) {
      nested = true;
      f.server.getAgendaReferenceDataBackgroundRevalidate();
    }
    return original();
  };
  f.server.getAgendaReferenceDataBackgroundRevalidate();
  const summaries = f.logs.filter(line => line.startsWith('[CODEX_AGENDA_REFERENCE_REVALIDATE] '))
    .map(line => JSON.parse(line.slice('[CODEX_AGENDA_REFERENCE_REVALIDATE] '.length)));
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every(log => log.outcome === 'rebuilt_marked'));
  assert.notEqual(summaries[0].traceId, summaries[1].traceId);
  assert.equal(f.reads.kits_coleta, 2);
  assert.equal(f.server.CODEX_CACHE_BYPASS_READS_, false);
});

test('falha de reconstrucao e cache indisponivel preservam bypass, fallback e diagnostico', () => {
  const f = fixture();
  f.unavailable();
  f.server.getAgendaReferenceDataBackgroundRevalidate();
  assert.ok(f.logs.some(line => line.includes('rebuilt_marker_failed')));
  f.server.getAgendaKitsEstoque_ = () => { throw Error('falha kits'); };
  f.server.CODEX_CACHE_BYPASS_READS_ = true;
  assert.throws(() => f.server.getAgendaReferenceDataBackgroundRevalidate(), /falha kits/);
  assert.equal(f.server.CODEX_CACHE_BYPASS_READS_, true);
  assert.ok(f.logs.some(line => line.includes('"outcome":"failed"')));
  f.server.Logger.log = () => { throw Error('logger'); };
  f.server.getAgendaKitsEstoque_ = () => [];
  assert.ok(f.server.getAgendaReferenceDataBackgroundRevalidate());
});

test('atualizacao automatica, pos-gravacao e explicita leem eventos frescos sem reconstruir listas', () => {
  const f = fixture();
  f.server.agendaGetReferenceData_(false, true);
  const before = { ...f.reads };
  for (const role of ['admin', 'user', 'readonly']) {
    f.server.codexGetCurrentUserAccess = () => ({ ok: true, role });
    for (const reason of ['stale_event_revalidation', 'post_mutation_refresh', 'explicit_refresh', 'forced_refresh']) {
      const response = f.server.getAgendaBootstrap('2026-09-14', '2026-09-21', true, reason);
      assert.equal(response.complete, true);
      assert.equal(response.events[0].recordVersion, String(f.events.length));
      assert.deepEqual({ ...f.reads }, before);
      assert.equal(f.server.CODEX_CACHE_BYPASS_READS_, false);
    }
  }
  assert.equal(f.events.length, 12);
  assert.ok(f.events.every(event => event.fresh && event.bypass));
});

test('invalidação de estoque renova apenas kits e preserva todas as outras listas', () => {
  const f = fixture();
  const before = f.server.agendaGetReferenceData_(false, true);
  f.revisions.kits_coleta = 2;
  f.server.agendaInvalidateKitsReference_();
  const after = f.server.getAgendaBootstrap('2026-09-14', '2026-09-21', true, 'post_mutation_refresh').referenceData;
  assert.deepEqual(Array.from(after.kitsColeta), ['kits_coleta-2']);
  for (const key of Object.keys(before)) {
    if (key !== 'kitsColeta') assert.deepEqual(JSON.parse(JSON.stringify(after[key])), JSON.parse(JSON.stringify(before[key])), key);
  }
  for (const [part, count] of Object.entries(f.reads)) assert.equal(count, part === 'kits_coleta' ? 2 : 1, part);
  assert.deepEqual(f.batches, { get: 2, put: 2 });
});

test('cadastros e feriados renovam somente suas dependencias, inclusive na notificacao administrativa', () => {
  for (const parts of [['medicos'], ['participantes'], ['prestadores'], ['monitores'], ['feriados'], ['projetos', 'project_courier_map', 'participantes', 'monitores', 'kits_coleta']]) {
    const f = fixture();
    f.server.agendaGetReferenceData_(false, true);
    parts.forEach(part => { f.revisions[part] = 2; });
    f.server.clearCodexRuntimeCaches_(parts);
    f.server.getAgendaReferenceDataFresh(true);
    for (const [part, count] of Object.entries(f.reads)) assert.equal(count, parts.includes(part) ? 2 : 1, part);
    assert.equal(f.events.length, 0);
  }
});

test('leitura fresca explicita e revalidacao periodica ainda recuperam alteracoes diretas na planilha', () => {
  const f = fixture();
  f.server.agendaGetReferenceData_(false, true);
  f.revisions.medicos = 2;
  assert.deepEqual(Array.from(f.server.getAgendaReferenceDataFresh().medicos), ['medicos-2']);
  assert.ok(Object.values(f.reads).every(count => count === 2));
  f.revisions.medicos = 3;
  assert.deepEqual(Array.from(f.server.getAgendaReferenceDataBackgroundRevalidate().medicos), ['medicos-3']);
  assert.ok(Object.values(f.reads).every(count => count === 3));
  assert.equal(f.server.CODEX_CACHE_BYPASS_READS_, false);
});

test('cache vazio ou indisponivel reconstrói formulario completo sem omitir listas', () => {
  for (const unavailable of [false, true]) {
    const f = fixture();
    if (unavailable) f.unavailable();
    const result = f.server.getAgendaBootstrap('2026-09-14', '2026-09-21', true);
    assert.equal(result.complete, true);
    assert.equal(Object.keys(f.reads).length, 19);
    assert.ok(Object.values(f.reads).every(count => count === 1));
    assert.equal(f.server.agendaValidateReferenceData_(result.referenceData), result.referenceData);
  }
});

test('falha de eventos restaura bypass anterior; acesso negado nao consulta referencias', () => {
  const f = fixture();
  f.server.CODEX_CACHE_BYPASS_READS_ = true;
  f.server.agendaGetEventosPorPeriodo_ = () => { throw Error('falha de eventos'); };
  assert.throws(() => f.server.getAgendaBootstrap('2026-09-14', '2026-09-21', true), /falha de eventos/);
  assert.equal(f.server.CODEX_CACHE_BYPASS_READS_, true);
  f.server.codexGetCurrentUserAccess = () => ({ ok: false, message: 'Negado' });
  const before = { ...f.reads };
  assert.equal(f.server.getAgendaBootstrap('2026-09-14', '2026-09-21', true).complete, false);
  assert.throws(() => f.server.getAgendaReferenceDataFresh(true), /Negado/);
  assert.deepEqual(f.reads, before);
});

test('mutacoes de estoque e feriados conectam invalidacao persistente das listas', () => {
  const source = readProjectFile('WebApp.gs');
  function body(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const end = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, end < 0 ? undefined : end);
  }
  for (const name of ['salvarItemEstoque', 'excluirItemEstoque', 'receberPedidoEstoque', 'registrarMovimentacaoEstoque', 'transferirKitEstoque', 'reservarKitsAgendaEvento', 'reservarKitsPrevisaoJornada', 'cancelarReservaKitAgenda', 'ajustarReservaKitAgenda', 'substituirReservaKitAgenda', 'cancelarReservasKitsAgenda_', 'atualizarStatusReservasAgendaItens_', 'atualizarReservasPorLote_']) {
    assert.match(body(name), /agendaInvalidateKitsReference_\(\)/, name);
  }
  for (const name of ['atualizarAgendaEventoCompleto', '_gravarLinhaEvento']) {
    assert.doesNotMatch(body(name), /agendaInvalidateReferenceDataCache_\(\['feriados'\]\)/);
  }
  assert.match(readProjectFile('Feriados.gs'), /function feriadoClearCaches_\(\)\s*\{\s*agendaInvalidateReferenceDataCache_\(\['feriados'\]\)/);
});
