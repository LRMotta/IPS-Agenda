'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29);

function store(entries) {
  const values = {};
  Object.entries(entries).forEach(([key, record]) => { values['TRP_GEN_V1:' + key] = typeof record === 'string' ? record : JSON.stringify(record); });
  return {
    values,
    props: {
      getProperties: () => ({ ...values }),
      setProperty: (key, value) => { values[key] = value; },
      deleteProperty: key => { delete values[key]; }
    }
  };
}

function phases(values) {
  const parsed = {};
  Object.entries(values).forEach(([key, value]) => {
    try { parsed[key.replace('TRP_GEN_V1:', '')] = JSON.parse(value).phase; } catch { /* valor ilegivel de proposito */ }
  });
  return parsed;
}

function prune(entries) {
  const s = runFile('TransporteCodexConfig.gs', {});
  const fixture = store(entries);
  const kept = s.transporteGenerationPrune_(fixture.props, NOW);
  return { kept, ...fixture, phases: phases(fixture.values) };
}

const big = phase => ({ hash: 'h', phase, updatedAt: NOW - DAY, result: { filler: 'x'.repeat(7000) } });

test('geracoes abertas antigas viram marcadores e liberam a cota', () => {
  const entries = {};
  for (let n = 0; n < 40; n++) entries['open' + n] = { ...big('PDF_READY'), updatedAt: NOW - (n + 1) * 1000 };
  const result = prune(entries);
  const full = Object.values(result.values).filter(value => JSON.parse(value).phase === 'PDF_READY');
  assert.equal(full.length, 19);
  assert.equal(Object.values(result.phases).filter(phase => phase === 'RETIRED').length, 21);
  assert.equal(result.phases.open0, 'PDF_READY'); // Os mais recentes continuam recuperaveis.
  assert.equal(result.phases.open39, 'RETIRED');
  const bytes = Object.values(result.values).reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  assert.ok(bytes < 200000, 'armazenamento de recuperacao fora do limite: ' + bytes);
});

test('registro aberto com mais de 30 dias e retirado mesmo sem excesso', () => {
  const result = prune({ velho: { ...big('DRAFT_INTENT'), updatedAt: NOW - 31 * DAY }, recente: big('DRAFT_INTENT') });
  assert.equal(result.phases.velho, 'RETIRED');
  assert.equal(result.phases.recente, 'DRAFT_INTENT');
  assert.equal(JSON.parse(result.values['TRP_GEN_V1:velho']).hash, 'h');
  assert.equal(JSON.parse(result.values['TRP_GEN_V1:velho']).result, undefined);
});

test('geracoes completas continuam limitadas a 19 e abertas nao as deslocam', () => {
  const entries = { aberto: big('PDF_READY') };
  for (let n = 0; n < 25; n++) entries['ok' + n] = { ...big('COMPLETE'), updatedAt: NOW - (n + 1) * 1000 };
  const result = prune(entries);
  assert.equal(Object.values(result.phases).filter(phase => phase === 'COMPLETE').length, 19);
  assert.equal(result.phases.aberto, 'PDF_READY');
});

test('READY antigo e marcador com mais de um ano expiram; recentes e ilegiveis permanecem', () => {
  const result = prune({
    readyVelho: { hash: 'h', phase: 'READY', updatedAt: NOW - 31 * DAY },
    readyNovo: { hash: 'h', phase: 'READY', updatedAt: NOW - DAY },
    stubVelho: { hash: 'h', phase: 'RETIRED', updatedAt: NOW - 366 * DAY },
    stubNovo: { hash: 'h', phase: 'RETIRED', updatedAt: NOW - 100 * DAY },
    corrompido: '{nao-json'
  });
  assert.deepEqual(Array.from(result.kept).sort(), ['TRP_GEN_V1:corrompido', 'TRP_GEN_V1:readyNovo', 'TRP_GEN_V1:stubNovo']);
  assert.equal(result.values['TRP_GEN_V1:readyVelho'], undefined);
  assert.equal(result.values['TRP_GEN_V1:stubVelho'], undefined);
  assert.equal(result.values['TRP_GEN_V1:corrompido'], '{nao-json');
});

test('historico cheio so ocorre depois da limpeza por idade', () => {
  const entries = {};
  for (let n = 0; n < 1000; n++) entries['s' + n] = { hash: 'h', phase: 'RETIRED', updatedAt: NOW - 400 * DAY };
  assert.equal(prune(entries).kept.length, 0);
});
