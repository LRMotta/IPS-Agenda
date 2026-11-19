'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

const source = readProjectFile('IndexCoreScripts.html');

test('monitor de versao permanece ativo sem depender da URL externa do iframe', () => {
  const watcher = source.match(/function startAppVersionWatcher\(\) \{([\s\S]*?)\n\}/);
  const checker = source.match(/function checkAppRuntimeVersion\(\) \{([\s\S]*?)\n\}/);

  assert.ok(watcher, 'startAppVersionWatcher deve existir');
  assert.ok(checker, 'checkAppRuntimeVersion deve existir');
  assert.match(watcher[1], /setInterval\(checkAppRuntimeVersion, APP_VERSION_CHECK_INTERVAL_MS\)/);
  assert.match(watcher[1], /setTimeout\(checkAppRuntimeVersion, APP_VERSION_INITIAL_CHECK_DELAY_MS\)/);
  assert.doesNotMatch(watcher[1] + checker[1], /appIsPublishedExecRuntime|APP_VERSION_RUNTIME_IS_EXEC/);
});

test('monitor so consulta com a aba visivel e verifica ao voltar, com intervalo minimo', () => {
  const checker = source.match(/function checkAppRuntimeVersion\(\) \{([\s\S]*?)\n\}/);
  assert.ok(checker, 'checkAppRuntimeVersion deve existir');
  const hiddenGuard = checker[1].indexOf('if (document.hidden) return;');
  assert.ok(hiddenGuard >= 0, 'aba oculta nao deve chamar o servidor');
  assert.ok(hiddenGuard < checker[1].indexOf('google.script.run'), 'guarda deve vir antes da RPC');
  assert.match(checker[1], /APP_VERSION_LAST_CHECK_AT = Date\.now\(\)/);

  const onVisible = source.match(/document\.addEventListener\('visibilitychange', function\(\) \{([\s\S]*?)\n\}\);/);
  assert.ok(onVisible, 'listener de visibilidade deve existir');
  assert.match(onVisible[1], /if \(document\.hidden\) return;/);
  assert.match(onVisible[1], /Date\.now\(\) - APP_VERSION_LAST_CHECK_AT < APP_VERSION_RETURN_MIN_GAP_MS/);
  assert.match(onVisible[1], /checkAppRuntimeVersion\(\)/);
});

test('monitor consulta o servidor e exibe aviso quando a versao mudou', () => {
  assert.match(source, /\.getAppRuntimeInfo\(\)/);
  assert.match(source, /current\s*&&\s*current\s*!==\s*APP_LOADED_VERSION/);
  assert.match(source, /showAppVersionNotice\(info\.appVersion\)/);
  assert.match(source, /Nova versão disponível\. Atualize a página para continuar\./);
  assert.match(source, /appReloadWebAppAfterVersionNotice\(\)/);
});

test('bootstrap mede RPC, aplicacao e payload com um trace correlacionavel', () => {
  assert.match(source, /function codexClientBootstrapTraceId_\(\)/);
  assert.match(source, /function codexLogClientBootstrapPerformance_\(metrics\)/);
  assert.match(source, /bootstrapRequest\.traceId = bootstrapTraceId/);
  assert.match(source, /rpcDurationMs: rpcCompletedAt - bootstrapStartedAt/);
  assert.match(source, /applyDurationMs: applyCompletedAt - applyStartedAt/);
  assert.match(source, /payloadBytes: codexClientBootstrapPayloadBytes_\(data\)/);
  assert.match(source, /\[CODEX_PERF_CLIENT\]/);
  assert.doesNotMatch(source, /CODEX_PERF_CLIENT[^\n]*(email|nome|cpf|participante|agendaId)/i);
});
