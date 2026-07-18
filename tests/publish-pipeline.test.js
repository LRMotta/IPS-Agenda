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
  const testIndex = source.lastIndexOf('npm.cmd run verify');
  const claspIndex = source.indexOf('& $clasp push --force');
  assert.ok(versionIndex > -1 && versionIndex < testIndex);
  assert.ok(testIndex < claspIndex);
});

test('GitHub exige branch, PR, checks e merge antes da publicacao no Apps Script', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  const branchIndex = source.indexOf('HEAD:refs/heads/$publishBranch');
  const prIndex = source.indexOf('gh pr create');
  const checksIndex = source.lastIndexOf('gh pr checks');
  const mergeIndex = source.indexOf('gh pr merge');
  const claspIndex = source.indexOf('& $clasp push --force');
  assert.ok(branchIndex > -1 && branchIndex < prIndex);
  assert.ok(prIndex < checksIndex && checksIndex < mergeIndex);
  assert.ok(mergeIndex < claspIndex);
  assert.match(source, /git merge --ff-only origin\/main/);
});

test('publicacao reconhece commit da main que ja passou por Pull Request', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  assert.match(source, /\$sourceFullSha -eq \$originMainSha/);
  assert.match(source, /commits\/\$sourceFullSha\/pulls/);
  assert.match(source, /select\(\.merged_at != null and \.base\.ref == "main"\)/);
  assert.match(source, /gh pr checks \$prNumber --repo \$repo --required/);
});

test('arquivo local e restaurado mesmo quando a publicacao falha', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  assert.match(source, /finally\s*\{/);
  assert.match(source, /WriteAllBytes\(\$webAppPath, \$originalBytes\)/);
});
