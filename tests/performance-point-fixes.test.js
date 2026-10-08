'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

test('amostragem de bytes do bootstrap seleciona somente os primeiros 5% do intervalo', () => {
  let random = 0.0499;
  const server = runFile('WebApp.gs', { Math: { random: () => random } });
  assert.equal(server.codexShouldMeasureBootstrapBytes_(), true);
  random = 0.05;
  assert.equal(server.codexShouldMeasureBootstrapBytes_(), false);
  random = 0.999;
  assert.equal(server.codexShouldMeasureBootstrapBytes_(), false);
});

function presenceFixture(acquired = true) {
  const waits = [];
  let releases = 0;
  const server = runFile('WebApp.gs', {
    LockService: {
      getDocumentLock: () => null,
      getScriptLock: () => ({ tryLock: ms => { waits.push(ms); return acquired; }, releaseLock: () => releases++ })
    }
  });
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, userEmail: 'tester@example.invalid' });
  const sheet = new FakeSheet('Edit_Presence', [['headers']]);
  server.codexGetEditPresenceSheet_ = () => sheet;
  server.codexCleanupEditPresence_ = () => [];
  return { server, waits, sheet, get releases() { return releases; } };
}

test('presença calcula os dois hashes com uma busca de ID e uma leitura de linha', () => {
  const f = presenceFixture();
  const row = ['registro'];
  let searches = 0;
  let reads = 0;
  f.server.getAgendaSheetForRead_ = () => ({ getRange: () => ({ getValues: () => { reads++; return [row]; } }) });
  f.server.encontrarLinhaPorId = () => { searches++; return 2; };
  f.server.agendaRecordVersionFromRow_ = value => { assert.equal(value, row); return 'full'; };
  f.server.agendaEditableRecordVersionFromRow_ = value => { assert.equal(value, row); return 'editable'; };
  const result = f.server.codexOpenEditPresence('Agenda', 'ID', 'session');
  assert.equal(result.version, 'full');
  assert.equal(result.editVersion, 'editable');
  assert.equal(searches, 1);
  assert.equal(reads, 1);
  assert.deepEqual(f.waits, [1000]);
  assert.equal(f.releases, 1);
  assert.equal(f.sheet.rows[1][7], 'full');
});

test('presença retorna lockBusy em Open e Release sem acessar a planilha', () => {
  const f = presenceFixture(false);
  f.server.codexGetEditPresenceSheet_ = () => { throw new Error('não deve ler'); };
  for (const rpc of ['codexOpenEditPresence', 'codexReleaseEditPresence']) {
    const result = f.server[rpc]('Agenda', 'ID', 'session');
    assert.equal(result.ok, false);
    assert.equal(result.lockBusy, true);
  }
  assert.deepEqual(f.waits, [1000, 1000]);
  assert.equal(f.releases, 0);
});

test('lock de gravação conserva espera padrão e libera mesmo quando operação falha', () => {
  const f = presenceFixture();
  assert.throws(() => f.server.codexWithDocumentLock_('save', () => { throw new Error('falha'); }), /falha/);
  assert.deepEqual(f.waits, [30000]);
  assert.equal(f.releases, 1);
});

test('Release remove somente presença do usuário, registro e sessão solicitados', () => {
  const f = presenceFixture();
  const rows = [
    ['Agenda', 'ID', 'tester@example.invalid', '', 'session'],
    ['Agenda', 'ID', 'other@example.invalid', '', 'session'],
    ['Agenda', 'ID', 'tester@example.invalid', '', 'other-session'],
    ['Agenda', 'OTHER', 'tester@example.invalid', '', 'session']
  ];
  f.server.codexCleanupEditPresence_ = () => rows;
  f.server.codexReplaceEditPresenceRows_ = (sheet, remaining) => assert.deepEqual(Array.from(remaining), rows.slice(1));
  assert.equal(f.server.codexReleaseEditPresence('Agenda', 'ID', 'session').ok, true);
});

test('Config_App lê A:M uma vez e mantém origem, coluna separadora e cache/bypass', () => {
  const server = runFile('WebApp.gs');
  const rows = [['Grupo', 'Chave', 'Valor', 'Não', 2, 'Obs', 'IGNORAR', 'Grupo', 'Outra', 'Apoio', '', 1, 'Nota']];
  const ranges = [];
  server.codexCacheGet_ = () => null;
  server.codexCachePut_ = () => true;
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: () => ({
    getLastRow: () => 2,
    getRange: (...args) => { ranges.push(args); return { getValues: () => rows }; }
  }) });
  const result = server.readConfigAppRows_();
  assert.deepEqual(ranges, [[2, 1, 1, 13]]);
  assert.equal(result.length, 2);
  assert.equal(result[0].startCol, 1);
  assert.equal(result[0].rowIndex, 2);
  assert.equal(result[0].ativo, 'Não');
  assert.equal(result[1].startCol, 8);
  assert.equal(result[1].bloco, 'Apoio');
  assert.equal(result[1].observacao, 'Nota');
  assert.equal(server.readConfigAppRows_(), result);
  assert.equal(ranges.length, 1);
  server.CODEX_CACHE_BYPASS_READS_ = true;
  server.readConfigAppRows_();
  assert.equal(ranges.length, 2);
});

test('auditoria prepara datas duas vezes por consulta, mantendo ordem, totais e filtros', () => {
  const server = runFile('WebApp.gs', { Date });
  const rows = [['a', 'User', 'Agenda', new Date(2026, 9, 1), 'Salvar'], ['b', 'User', 'Sistema', new Date(2026, 9, 2), 'Salvar']];
  const sheet = new FakeSheet('Audit_Log', [['headers'], ...rows]);
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: () => sheet });
  const parse = server.codexParseAuditFilterDate_;
  let parses = 0;
  server.codexParseAuditFilterDate_ = (...args) => { parses++; return parse(...args); };
  const result = server.getAuditRowsPage_('Audit_Log', 5, 1, 0, row => row[0],
    { user: ' user ', action: 'SALVAR', startDate: '2026-10-01', endDate: '2026-10-02' },
    { userCol: 1, moduleCol: 2, dateCol: 3, actionCol: 4 });
  assert.equal(parses, 2);
  assert.deepEqual(Array.from(result.rows), ['b']);
  assert.equal(result.total, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.userCount, 1);
  assert.equal(result.moduleCount, 2);
});

function logoFixture() {
  const entries = new Map();
  let fetches = 0;
  let contentType = 'image/png';
  let status = 200;
  const puts = [];
  const server = runFile('WebApp.gs', {
    UrlFetchApp: { fetch: () => { fetches++; return {
      getResponseCode: () => status,
      getBlob: () => ({ getContentType: () => contentType, getBytes: () => [1, 2] })
    }; } },
    Utilities: { base64Encode: bytes => Buffer.from(bytes).toString('base64') }
  });
  server.codexCacheGet_ = key => entries.get(key);
  server.codexCachePut_ = (key, value, ttl) => { puts.push({ key, value, ttl }); entries.set(key, value); return true; };
  return { server, entries, puts, get fetches() { return fetches; },
    set contentType(value) { contentType = value; }, set status(value) { status = value; } };
}

test('logo reutiliza base64 por seis horas e refaz fetch após eviction ou mudança de URL', () => {
  const f = logoFixture();
  const first = f.server.reqExamesLogoSrc_();
  assert.equal(first, 'data:image/png;base64,AQI=');
  assert.equal(f.server.reqExamesLogoSrc_(), first);
  assert.equal(f.fetches, 1);
  assert.equal(f.puts[0].ttl, 21600);
  f.entries.clear();
  f.server.reqExamesLogoSrc_();
  assert.equal(f.fetches, 2);
  f.server.reqExamesLogoUrl_ = () => 'https://example.invalid/new.png';
  f.server.reqExamesLogoSrc_();
  assert.equal(f.fetches, 3);
  assert.notEqual(f.puts[0].key, f.puts.at(-1).key);
});

test('logo mantém fallback e não armazena resposta HTTP inválida ou não imagem', () => {
  const f = logoFixture();
  f.status = 500;
  assert.equal(f.server.reqExamesLogoSrc_(), f.server.reqExamesLogoUrl_());
  f.status = 200;
  f.contentType = 'text/html';
  assert.equal(f.server.reqExamesLogoSrc_(), f.server.reqExamesLogoUrl_());
  assert.equal(f.puts.length, 0);
  f.contentType = 'image/png';
  f.server.codexCachePut_ = () => false;
  assert.equal(f.server.reqExamesLogoSrc_(), 'data:image/png;base64,AQI=');
});

test('ampliação de período adia finalização de cada inclusão e ordena/flush uma vez', () => {
  let sorts = 0;
  let flushes = 0;
  const server = runFile('WebApp.gs', { SpreadsheetApp: { flush: () => flushes++ } });
  server.agendaTipoPeriodoLabel_ = () => 'Monitoria';
  server.agendaDatasPeriodo_ = () => ['d1', 'd2', 'd3'];
  server.agendaPeriodoRowsDoPeriodo_ = () => [];
  server.agendaDateWithHora_ = date => date;
  server.agendaEmailEnabled_ = () => false;
  server.agendaInvalidateDateIndexCache_ = () => {};
  const options = [];
  server._gravarLinhaEvento = (agenda, date, clone, ss, operation, saveOptions) => {
    options.push(saveOptions.deferFinalize);
    return { id: date };
  };
  const agenda = { getLastRow: () => 4, getRange: () => ({ sort: () => sorts++ }) };
  const result = server.agendaAtualizarPeriodoEvento_(agenda, {}, 2, [], { tipo: 'monitoria' }, 'monitoria');
  assert.deepEqual(options, [true, true, true]);
  assert.deepEqual(Array.from(result.ids), ['d1', 'd2', 'd3']);
  assert.equal(sorts, 1);
  assert.equal(flushes, 1);
});
