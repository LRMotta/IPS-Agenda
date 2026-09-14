'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function monitorServer(rows) {
  const writes = { append: 0, ranges: 0, caches: 0 };
  const sheet = {
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map((row) => row.slice()) }),
    getRange: () => ({ setValues: () => { writes.ranges++; } }),
    appendRow: (row) => { writes.append++; rows.push(row.slice()); }
  };
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) }
  });
  server.codexAssertCanWrite_ = () => ({});
  server.codexWithDocumentLock_ = (_label, fn) => fn();
  server.clearCodexRuntimeCaches_ = () => { writes.caches++; };
  return { server, writes };
}

const headers = ['ID', 'Nome', 'E-mail', 'Telefone', 'Projeto_1', 'Projeto_1 Unblinded?', 'Projeto_2', 'Projeto_2 Unblinded?', 'Projeto_3', 'Projeto_3 Unblinded?', 'Projeto_4', 'Projeto_4 Unblinded?'];

test('prévia de monitores agrupa registros repetidos sem gravar', () => {
  const { server, writes } = monitorServer([
    headers,
    ['MON-1', 'Felipe', '', '', 'JI1-MC-GZBO', 'Não', '', '', '', '', '', ''],
    ['MON-2', ' Felipe ', '', '', 'JI1-MC-GZBO', 'Não', '', '', '', '', '', ''],
    ['MON-3', 'Felipe', '', '', 'JI1-MC-GZBO', 'Não', '', '', '', '', '', '']
  ]);
  const previa = server.previsualizarDuplicidadesMonitores();
  assert.equal(previa.totalGrupos, 1);
  assert.equal(previa.totalRegistros, 3);
  assert.equal(previa.grupos[0].registrosIguais, true);
  assert.deepEqual(Array.from(previa.grupos[0].registros.map((item) => item.linha)), [2, 3, 4]);
  assert.deepEqual(writes, { append: 0, ranges: 0, caches: 0 });
});

test('servidor bloqueia inclusão e edição que reproduzam cadastro idêntico de monitor', () => {
  const rows = [
    headers,
    ['MON-1', 'Felipe', '', '', 'JI1-MC-GZBO', 'Não', '', '', '', '', '', ''],
    ['MON-2', 'Outro monitor', '', '', 'OUTRO', 'Não', '', '', '', '', '', '']
  ];
  const { server, writes } = monitorServer(rows);
  const duplicate = { nome: ' felipe ', projeto1: 'ji1-mc-gzbo', unblinded1: 'Não' };
  assert.throws(() => server.salvarDadosMonitor(duplicate), /mesmo cadastro/);
  assert.throws(() => server.salvarDadosMonitor(Object.assign({ id: 'MON-2' }, duplicate)), /mesmo cadastro/);
  assert.equal(writes.append, 0);
  assert.equal(writes.ranges, 0);
  assert.equal(server.salvarDadosMonitor({ nome: 'Novo monitor', projeto1: 'JI1-MC-GZBO', unblinded1: 'Não' }), 'Monitor cadastrado com sucesso.');
  assert.equal(writes.append, 1);
});

test('cliente oferece prévia somente leitura de duplicidades de monitores', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  assert.match(core, /method: 'previsualizarDuplicidadesMonitores'/);
  assert.match(core, /Esta prévia não consolida nem remove dados/);
  assert.match(content, /id="modalPreviaDuplicidadesMonitores"/);
  assert.match(content, /nenhum registro será alterado ou excluído/i);
});
