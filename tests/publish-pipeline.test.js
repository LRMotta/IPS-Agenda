'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

test('publicacao exige main limpa', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  assert.match(source, /branch -ne 'main'/);
  assert.match(source, /git status --porcelain/);
});

test('publicacao gera versao com data e commit', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  assert.match(source, /yyyy\.MM\.dd\.HHmm/);
  assert.match(source, /git rev-parse --short=8 HEAD/);
  assert.match(source, /CODEX_APP_VERSION_/);
  assert.match(source, /CODEX_APP_BUILD_LABEL_/);
  assert.match(source, /CODEX_APP_BUILD_DATE_/);
});

test('testes acontecem depois da versao e antes do clasp push', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  const versionIndex = source.indexOf('WriteAllText');
  const testIndex = source.indexOf('npm.cmd run verify');
  const claspIndex = source.indexOf('& $clasp push --force');
  assert.ok(versionIndex > -1 && versionIndex < testIndex);
  assert.ok(testIndex < claspIndex);
});

test('GitHub e atualizado somente depois da publicacao no Apps Script', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  const claspIndex = source.indexOf('& $clasp push --force');
  const githubIndex = source.indexOf('git push origin main');
  assert.ok(claspIndex > -1 && claspIndex < githubIndex);
  assert.match(source, /GitHub atualizado com sucesso/);
});

test('arquivo local e restaurado mesmo quando a publicacao falha', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  assert.match(source, /finally\s*\{/);
  assert.match(source, /WriteAllBytes\(\$webAppPath, \$originalBytes\)/);
});
