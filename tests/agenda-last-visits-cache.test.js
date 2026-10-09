'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');
function fixture() {
  const entries = new Map(), logs = [];
  let day = '20261008', fail = false, duringRead;
  const cache = { get: key => entries.get(key) || null, getAll: keys => Object.fromEntries(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)])), put: (key, value) => entries.set(key, value), putAll: values => Object.entries(values).forEach(([key,value]) => entries.set(key,value)), remove: key => entries.delete(key) };
  const server = runFile('WebApp.gs', { CacheService: {getScriptCache: () => cache}, Utilities: {getUuid: randomUUID, formatDate: value => value && typeof value.getUTCFullYear === 'function' && [2020, 2027].includes(value.getUTCFullYear()) ? String(value.getUTCFullYear()) + String(value.getUTCMonth()+1).padStart(2,'0') + String(value.getUTCDate()).padStart(2,'0') : day}, Session: {getScriptTimeZone: () => 'America/Sao_Paulo'}, Logger: {log: value => logs.push(value)}, AgendaServerRules_: {isVisit: value => value === 'Visita', isCompleted: value => ['concluído', 'concluido'].includes(value)} });
  server.AGENDA_CFG.lastCol = 53;
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.agendaDateFromValue_ = value => value;
  server.formatarDataSafe = () => '01/01/2020';
  server.formatarDataIsoAgenda_ = () => '2020-01-01';
  const row = Array(server.AGENDA_CFG.lastCol).fill('');
  Object.assign(row, {1: new Date('2020-01-01T12:00:00Z'),3:'Visita',4:'Concluído',5:'Pessoa simulada',10:'V1'});
  row[server.AGENDA_CFG.idx.participanteCadastroId] = 'CAD-1';
  server.getAgendaSheetForRead_ = () => ({ getLastRow: () => 2, getRange: () => ({getValues: () => {if(fail) throw Error('simulado'); if(duringRead) duringRead(); return [row];}}) });
  server.codexCacheRemoveAll_ = keys => keys.forEach(cache.remove);
  return {server, entries, row, logs, setDay: value => {day=value;}, setFail: value => {fail=value;}, duringRead: fn => {duringRead=fn;}, metrics: () => JSON.parse(logs.filter(value => value.startsWith('[CODEX_PERF] ')).at(-1).slice(13))};
}
test('últimas visitas: leitura fria, acerto sem células, atualização forçada e nova geração', () => {
  const f=fixture(), s=f.server;
  assert.equal(s.getUltimasVisitasParticipantesAgendaMap_()['cadastro:cad-1'].visita,'V1');
  assert.equal(f.metrics().instrumentedReadCalls,1);
  assert.equal(f.metrics().instrumentedCellsRead,s.AGENDA_CFG.lastCol);
  assert.equal(f.metrics().cacheMiss,true);
  s.getUltimasVisitasParticipantesAgendaMap_();
  assert.equal(f.metrics().instrumentedCellsRead,0);
  assert.equal(f.metrics().cacheHit,true);
  f.row[10]='V2'; s.getUltimasVisitasParticipantesAgendaMap_(true);
  assert.equal(f.metrics().instrumentedReadCalls,1);
  s.agendaInvalidateDateIndexCache_();
  assert.equal(s.getUltimasVisitasParticipantesAgendaMap_()['cadastro:cad-1'].visita,'V2');
  assert.equal(f.metrics().cacheMiss,true);
  f.setDay('20261009'); s.getUltimasVisitasParticipantesAgendaMap_();
  assert.equal(f.metrics().cacheMiss,true);
});
test('escopo de referências preserva eventos; participantes preservam datas e renovam eventos', () => {
  const f=fixture(),s=f.server;
  s.getUltimasVisitasParticipantesAgendaMap_();
  const generation=s.agendaWindowCacheGeneration_(false);
  f.entries.set(s.agendaDateIndexCacheKey_(),'datas');
  f.entries.set(s.agendaParticipantHydrationCacheKey_(),'hidratação');
  s.clearCodexRuntimeCaches_(['medicos'],'references');
  assert.equal(s.agendaWindowCacheGeneration_(false),generation);
  assert.equal(f.entries.get(s.agendaParticipantHydrationCacheKey_()),'hidratação');
  s.clearCodexRuntimeCaches_(['participantes'],'participants');
  assert.equal(s.agendaWindowCacheGeneration_(false),null);
  assert.equal(f.entries.get(s.agendaDateIndexCacheKey_()),'datas');
  assert.equal(f.entries.has(s.agendaParticipantHydrationCacheKey_()),false);
  s.clearCodexRuntimeCaches_();
  assert.equal(f.entries.has(s.agendaDateIndexCacheKey_()),false);
});
test('erro e leitura concorrente à invalidação não armazenam última visita obsoleta', () => {
  const f=fixture(),s=f.server;
  f.setFail(true); assert.equal(Object.keys(s.getUltimasVisitasParticipantesAgendaMap_()).length,0);
  assert.equal([...f.entries.keys()].some(key=>key.endsWith(':manifest')),false);
  f.setFail(false);f.duringRead(()=>s.agendaInvalidateWindowCache_());
  s.getUltimasVisitasParticipantesAgendaMap_();
  assert.equal([...f.entries.keys()].some(key=>key.endsWith(':manifest')),false);
  f.duringRead(null);s.getUltimasVisitasParticipantesAgendaMap_();
  assert.equal(f.metrics().cacheMiss,true);
});
test('bypass e indisponibilidade de cache mantêm leitura fresca', () => {
  const f=fixture(),s=f.server;s.getUltimasVisitasParticipantesAgendaMap_();
  s.CODEX_CACHE_BYPASS_READS_=true;s.getUltimasVisitasParticipantesAgendaMap_();
  assert.equal(f.metrics().instrumentedReadCalls,1);
  s.CacheService.getScriptCache=()=>{throw Error('cache indisponível');};
  assert.equal(s.getUltimasVisitasParticipantesAgendaMap_()['cadastro:cad-1'].visita,'V1');
});

test('virada do dia inclui visita concluída que antes era futura', () => {
  const f=fixture(); f.row[1]=new Date('2027-01-02T12:00:00Z'); f.setDay('20270101');
  assert.equal(Object.keys(f.server.getUltimasVisitasParticipantesAgendaMap_()).length,0);
  f.setDay('20270102');
  assert.equal(f.server.getUltimasVisitasParticipantesAgendaMap_()['cadastro:cad-1'].visita,'V1');
});
