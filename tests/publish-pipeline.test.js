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

test('workflow registra o check tambem nas branches oficiais de publicacao', () => {
  const source = readProjectFile('.github/workflows/regression-tests.yml');
  assert.match(source, /push:\s*[\s\S]*branches:\s*[\s\S]*main\s*[\s\S]*agent\/publish-\*/);
  assert.match(source, /pull_request:\s*[\s\S]*branches:\s*\[main\]/);
});

test('publicacao reconhece commit da main que ja passou por Pull Request', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  assert.match(source, /\$sourceFullSha -eq \$originMainSha/);
  assert.match(source, /commits\/\$sourceFullSha\/pulls/);
  assert.match(source, /ConvertFrom-Json/);
  assert.match(source, /Where-Object \{ \$_\.merged_at -and \$_\.base\.ref -eq 'main' \}/);
  assert.match(source, /gh pr checks \$prNumber --repo \$repo --required/);
});

test('arquivo local e restaurado mesmo quando a publicacao falha', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  assert.match(source, /finally\s*\{/);
  assert.match(source, /WriteAllBytes\(\$webAppPath, \$originalBytes\)/);
});

test('push deixa publicacao pendente ate a verificacao obrigatoria no Chrome', () => {
  const source = readProjectFile('tools/push-clasp.ps1');
  const claspIndex = source.indexOf('& $clasp push --force');
  const pendingIndex = source.indexOf('PUBLICACAO PENDENTE: VERIFICACAO CHROME OBRIGATORIA.');
  assert.ok(claspIndex > -1 && claspIndex < pendingIndex);
  assert.match(source, /WebApp\.gs remoto/);
  assert.match(source, /trecho funcional exclusivo/);
  assert.match(source, /implantacao ativa/);
  assert.match(source, /Recarregue \/exec/);
  assert.doesNotMatch(source, /Publicacao concluida com a versao/);
});

test('instrucoes exigem conferir arquivo remoto, implantacao ativa e exec no Chrome', () => {
  const agents = readProjectFile('AGENTS.md');
  const publication = readProjectFile('PUBLICACAO_SEGURA.md');

  for (const source of [agents, publication]) {
    assert.match(source, /@Chrome/);
    assert.match(source, /WebApp\.gs/);
    assert.match(source, /CODEX_APP_VERSION_/);
    assert.match(source, /trecho funcional exclusivo/);
    assert.match(source, /implantacao ativa/);
    assert.match(source, /\/exec/);
    assert.match(source, /publicacao pendente/i);
  }
});
