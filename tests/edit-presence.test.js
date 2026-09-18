'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

const headers = ['Module', 'Record ID', 'User Email', 'User Name', 'Session ID', 'Opened At', 'Expires At', 'Version'];

test('limpeza de presenca compacta registros ativos sem excluir linhas fisicas', () => {
  const now = new Date('2026-07-29T20:00:00Z');
  const expired = ['Agenda', 'A-1', 'old@ucs.br', 'Old', 's1', now, new Date('2026-07-29T19:00:00Z'), 'v1'];
  const active = ['Agenda', 'A-2', 'active@ucs.br', 'Active', 's2', now, new Date('2026-07-29T21:00:00Z'), 'v2'];
  const invalid = ['Agenda', 'A-3', 'invalid@ucs.br', 'Invalid', 's3', now, '', 'v3'];
  const sheet = new FakeSheet('Edit_Presence', [headers, expired, active, invalid]);
  sheet.deleteRow = () => { throw new Error('nao deve excluir linhas fisicas'); };
  const context = runFile('WebApp.gs', { Date });

  const result = context.codexCleanupEditPresence_(sheet, now);

  assert.equal(result.length, 1);
  assert.deepEqual(sheet.rows[1], active);
  assert.deepEqual(sheet.rows[2].slice(0, 8), Array(8).fill(''));
  assert.deepEqual(sheet.rows[3].slice(0, 8), Array(8).fill(''));
  assert.equal(sheet.rows.length, 4, 'a quantidade fisica de linhas deve ser preservada');
});

test('abertura e liberacao de presenca nao usam exclusao fisica de linhas', () => {
  const source = readProjectFile('WebApp.gs');
  const cleanup = source.match(/function codexCleanupEditPresence_\([\s\S]*?\n\}/);
  const open = source.match(/function codexOpenEditPresence\([\s\S]*?\n\}/);
  const release = source.match(/function codexReleaseEditPresence\([\s\S]*?\n\}/);

  assert.ok(cleanup);
  assert.ok(open);
  assert.ok(release);
  assert.doesNotMatch(cleanup[0] + open[0] + release[0], /\.deleteRow\s*\(/);
  assert.match(open[0], /codexCleanupEditPresence_\(sh, now\)/);
  assert.match(release[0], /codexReplaceEditPresenceRows_\(sh, remaining\)/);
});

test('abertura de presenca mede as etapas sem incluir dados do registro na telemetria', () => {
  const source = readProjectFile('WebApp.gs');
  const open = source.match(/function codexOpenEditPresence\([\s\S]*?\n\}/);

  assert.ok(open);
  assert.match(open[0], /codexMeasurePerformance_\('codexOpenEditPresence', 'total'/);
  for (const stage of [
    'authorization',
    'presence_sheet',
    'presence_cleanup',
    'record_version',
    'editable_version',
    'presence_write'
  ]) {
    assert.match(open[0], new RegExp("codexMeasurePerformance_\\('codexOpenEditPresence', '" + stage + "'"));
  }
  assert.match(open[0], /codexWithDocumentLock_\('codexOpenEditPresence',[\s\S]*\{ operation: 'codexOpenEditPresence' \}/);
  assert.doesNotMatch(open[0], /codexLogPerformance_\([^\n]*(recordId|sessionId|email)/);
});
