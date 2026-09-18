'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function digestBytes(algorithm, text) {
  const name = String(algorithm || '').toLowerCase().includes('sha_256') ? 'sha256' : String(algorithm || 'sha256').replace('-', '').toLowerCase();
  return Array.from(crypto.createHash(name).update(String(text || ''), 'utf8').digest());
}

function preloadContext(rows) {
  const sheet = new FakeSheet('ReqExames_Preloads', rows);
  let uuid = 0;
  const spreadsheet = new FakeSpreadsheet({ ReqExames_Preloads: sheet });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: digestBytes,
      getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0')
    }
  });
  server.codexAssertCanWrite_ = () => ({ ok: true, userEmail: 'tester@example.invalid' });
  server.codexWithDocumentLock_ = (_name, callback) => callback();
  return { server, sheet };
}

function row(key, exams, active = 'Sim', number = '', id = '') {
  const values = [key].concat(exams || []);
  while (values.length < 41) values.push('');
  values.push(active, number, id);
  return values;
}

test('listas legadas de imagem e analises continuam separadas e recebem numeracao automatica', () => {
  const { server, sheet } = preloadContext([
    ['Projeto'].concat(Array.from({ length: 40 }, (_, i) => 'Exame ' + (i + 1)), ['Ativo']),
    row('PROTO-1 | Serviço de imagem', ['Ressonância de crânio']),
    row('PROTO-1 | Análises clínicas', ['Hemograma'])
  ]);

  const imagem = server.getReqExamesPreloadProjetoLists('PROTO-1', 'Serviço de imagem');
  const clinica = server.getReqExamesPreloadProjetoLists('PROTO-1', 'Análises clínicas');

  assert.equal(imagem.listas.length, 1);
  assert.equal(imagem.listas[0].label, 'Lista 01');
  assert.deepEqual(JSON.parse(JSON.stringify(imagem.listas[0].exames)), ['Ressonância de crânio']);
  assert.equal(clinica.listas[0].label, 'Lista 01');
  assert.deepEqual(JSON.parse(JSON.stringify(clinica.listas[0].exames)), ['Hemograma']);
  assert.equal(imagem.listas[0].id, 'LEGACY-2');
});

test('nova combinacao e salva como proxima lista sem pedir nome e a edicao usa o ID estavel', () => {
  const { server, sheet } = preloadContext([
    ['Projeto'].concat(Array.from({ length: 40 }, (_, i) => 'Exame ' + (i + 1)), ['Ativo']),
    row('PROTO-2 | Serviço de imagem', ['Tomografia']),
    row('PROTO-2 | Serviço de imagem', ['Ultrassom'])
  ]);

  const antes = server.getReqExamesPreloadProjetoLists('PROTO-2', 'Serviço de imagem');
  assert.deepEqual(JSON.parse(JSON.stringify(antes.listas.map((item) => item.label))), ['Lista 01', 'Lista 02']);
  const nova = server.salvarReqExamesPreloadLista(
    'PROTO-2',
    'Serviço de imagem',
    ['Raios X', 'Contraste'],
    '',
    ''
  );

  assert.equal(nova.ok, true);
  assert.equal(nova.created, true);
  assert.equal(nova.list.label, 'Lista 03');
  assert.equal(sheet.rows.length, 4);

  const selecionada = antes.listas[0];
  const atualizada = server.salvarReqExamesPreloadLista(
    'PROTO-2',
    'Serviço de imagem',
    ['Tomografia de tórax'],
    selecionada.hash,
    selecionada.id
  );
  assert.equal(atualizada.ok, true);
  assert.equal(atualizada.created, false);
  assert.match(atualizada.list.id, /^RQP-/);
  assert.equal(atualizada.list.label, 'Lista 01');
  assert.deepEqual(JSON.parse(JSON.stringify(sheet.rows[1].slice(1, 3))), ['Tomografia de tórax', '']);
});

test('conflito impede sobrescrever uma lista alterada por outro usuario', () => {
  const { server, sheet } = preloadContext([
    ['Projeto'].concat(Array.from({ length: 40 }, (_, i) => 'Exame ' + (i + 1)), ['Ativo']),
    row('PROTO-3 | Análises clínicas', ['Hemograma'])
  ]);
  const lista = server.getReqExamesPreloadProjetoLists('PROTO-3', 'Análises clínicas').listas[0];
  sheet.rows[1][1] = 'Hemograma atualizado por outra pessoa';
  const result = server.salvarReqExamesPreloadLista(
    'PROTO-3',
    'Análises clínicas',
    ['Hemograma novo'],
    lista.hash,
    lista.id
  );
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.match(result.list.id, /^RQP-/);
  assert.equal(result.exames[0], 'Hemograma atualizado por outra pessoa');
});

test('lista generica legada vira lista especifica sem sobrescrever a fonte geral', () => {
  const { server, sheet } = preloadContext([
    ['Projeto'].concat(Array.from({ length: 40 }, (_, i) => 'Exame ' + (i + 1)), ['Ativo']),
    row('PROTO-4', ['Exame geral'])
  ]);
  const fallback = server.getReqExamesPreloadProjetoLists('PROTO-4', 'Serviço de imagem');
  assert.equal(fallback.fallbackUsed, true);
  assert.equal(fallback.listas[0].fallbackUsed, true);
  assert.equal(fallback.listas[0].label, 'Lista 01');

  const saved = server.salvarReqExamesPreloadLista(
    'PROTO-4',
    'Serviço de imagem',
    ['Exame específico'],
    fallback.listas[0].hash,
    fallback.listas[0].id
  );
  assert.equal(saved.created, true);
  assert.equal(saved.list.label, 'Lista 01');
  assert.equal(sheet.rows.length, 3);
  assert.equal(sheet.rows[1][0], 'PROTO-4');
  assert.equal(sheet.rows[2][0], 'PROTO-4 | Serviço de imagem');
  assert.deepEqual(JSON.parse(JSON.stringify(server.getReqExamesPreloadProjetoLists('PROTO-4', 'Serviço de imagem').listas.map((item) => item.exames))), [['Exame específico']]);
});

test('schema inesperado nas colunas de metadados bloqueia a escrita para nao sobrescrever dados', () => {
  const headers = ['Projeto'].concat(Array.from({ length: 40 }, (_, i) => 'Exame ' + (i + 1)), ['Ativo', 'Observação interna']);
  const { server, sheet } = preloadContext([headers, row('PROTO-5 | Serviço de imagem', ['Exame'])]);
  const writesBefore = sheet.writes;
  assert.throws(() => server.salvarReqExamesPreloadLista('PROTO-5', 'Serviço de imagem', ['Outro'], '', ''), /colunas de metadados reservadas/);
  assert.equal(sheet.writes, writesBefore);
  assert.equal(sheet.rows[0][42], 'Observação interna');
});
