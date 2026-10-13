'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture(pilot, codes = [200]) {
  let fetches = 0, now = 0;
  const sleeps = [], logs = [];
  const blob = { getBytes: () => Array(1200).fill(1), getContentType: () => 'application/pdf', setName: () => blob };
  const server = runFile('WebApp.gs', {
    Date: class extends Date { static now() { return now; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => pilot }) },
    Utilities: { sleep: ms => { sleeps.push(ms); now += ms; } },
    ScriptApp: { getOAuthToken: () => 'TOKEN-SIMULADO' },
    Logger: { log: message => logs.push(message) },
    UrlFetchApp: { fetch: () => {
      const status = codes[fetches++] || 200;
      return { getResponseCode: () => status, getBlob: () => blob, getHeaders: () => ({ 'Content-Type': 'application/pdf' }) };
    } }
  });
  server.reqExamesExportErrorSnippet_ = () => 'HTTP simulado';
  return { server, blob, sleeps, logs, get fetches() { return fetches; } };
}

test('PDF conserva espera inicial por padrão e em falha da configuração do piloto', () => {
  const f = fixture(null);
  assert.equal(f.server.reqExamesFetchPdfBlob_('https://example.invalid/export', 'NOME-SIMULADO'), f.blob);
  assert.deepEqual(f.sleeps, [900]);
  f.server.PropertiesService.getScriptProperties = () => { throw new Error('Indisponível'); };
  f.server.reqExamesFetchPdfBlob_('https://example.invalid/export', 'NOME-SIMULADO');
  assert.deepEqual(f.sleeps, [900, 900]);
});

test('piloto PDF somente opt-in remove a espera inicial e mantém backoff após HTTP transitório', () => {
  const f = fixture('true', [503, 200]);
  assert.equal(f.server.reqExamesFetchPdfBlob_('https://example.invalid/export', 'NOME-SIMULADO'), f.blob);
  assert.equal(f.fetches, 2);
  assert.deepEqual(f.sleeps, [900]);
  assert.ok(f.logs.some(log => log.includes('retry_wait_1')));
  assert.ok(f.logs.every(log => !/TOKEN-SIMULADO|NOME-SIMULADO|example.invalid/.test(log)));
});

test('cópia temporária conserva espera mesmo com piloto ativo; HTTP permanente não faz novas tentativas', () => {
  const f = fixture('true', [403]);
  assert.throws(() => f.server.reqExamesFetchPdfBlob_('https://example.invalid/export', 'NOME-SIMULADO', { conservarEsperaInicial: true }), /HTTP 403/);
  assert.deepEqual(f.sleeps, [900]);
  assert.equal(f.fetches, 1);
});

test('piloto mantém a validação do conteúdo PDF e não aceita resposta 200 com blob inválido', () => {
  const f = fixture('true');
  f.blob.getBytes = () => [];
  assert.throws(() => f.server.reqExamesFetchPdfBlob_('https://example.invalid/export', 'NOME-SIMULADO'), /Não foi possivel|Nao foi possivel/);
});
