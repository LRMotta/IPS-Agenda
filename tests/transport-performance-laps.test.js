'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function loadWith(globals) {
  const logs = [];
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log: line => logs.push(line) }, ...globals });
  return { s, entries: () => logs.filter(line => line.startsWith('[CODEX_PERF] ')).map(line => JSON.parse(line.slice(13))) };
}

test('marcas de subetapa registram somente nome, duracao e contagem de linhas', () => {
  const f = loadWith({});
  const lap = f.s.transporteLapStart_('salvarTransporte');
  lap('rp_sheets');
  lap('rp_participantes', 12);
  const entries = f.entries();
  assert.deepEqual(entries.map(e => e.stage), ['rp_sheets', 'rp_participantes']);
  assert.deepEqual(entries.map(e => e.rowCount), [0, 12]);
  entries.forEach(e => {
    assert.deepEqual(Object.keys(e).sort(), ['durationMs', 'operation', 'rowCount', 'stage', 'success']);
    assert.equal(e.operation, 'salvarTransporte');
    assert.equal(e.success, true);
  });
});

test('marcas usam o registrador central quando existe e reset descarta o intervalo', () => {
  const calls = [];
  const f = loadWith({ codexLogPerformance_: (...args) => calls.push(args) });
  const lap = f.s.transporteLapStart_('gerarPdfTransporte');
  lap.reset();
  lap('ia_config');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'gerarPdfTransporte');
  assert.equal(calls[0][1], 'ia_config');
  assert.ok(calls[0][2] >= 0);
  assert.equal(calls[0][4], true);
});

test('falha do registrador nao altera a operacao observada', () => {
  const f = loadWith({ codexLogPerformance_: () => { throw new Error('indisponivel'); } });
  const lap = f.s.transporteLapStart_('salvarTransporte');
  assert.doesNotThrow(() => lap('as_lookup'));
});
