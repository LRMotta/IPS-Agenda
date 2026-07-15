'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  removeAppsScriptTemplates,
  syntaxError,
  validateHtml,
  validateProject
} = require('../tools/validate-syntax');

test('validador aceita JavaScript valido e rejeita sintaxe incompleta', () => {
  assert.equal(syntaxError('function ok() { return 1; }', 'ok.js'), null);
  assert.match(syntaxError('function quebrada( {', 'erro.js'), /Unexpected/);
});

test('expressoes de template do Apps Script sao neutralizadas antes da analise', () => {
  const sanitized = removeAppsScriptTemplates('const valor = <?!= JSON.stringify(dados) ?>;');
  assert.equal(syntaxError(sanitized, 'template.js'), null);
});

test('validador detecta include HTML inexistente', () => {
  const result = validateHtml('Index.html', "<?!= include('Ausente'); ?>", new Set(['Index']));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Ausente\.html/);
});

test('todo o projeto passa pela validacao sintatica integral', () => {
  const result = validateProject(path.resolve(__dirname, '..'));
  assert.deepEqual(result.errors, []);
  assert.ok(result.gsCount > 0);
  assert.ok(result.htmlCount > 0);
  assert.ok(result.scriptCount > 0);
});
