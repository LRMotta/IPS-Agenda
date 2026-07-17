'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

const MUTATION_PREFIX = /^(salvar|excluir|atualizar|configurar|instalar|remover|limpar|criar|gerar|importar|sincronizar|executar|registrar|receber|baixar|cancelar|marcar|concluir|aplicar|enviar|exportar|organizar|focar|resetar|corrigir|monitorar|manage|perform|processar|verificarEAtualizar)/;
const AUTHORIZATION_GUARD = /\b(codexAssertAdmin_|codexAssertCanWrite_|codexAssertAdminOrInstalledTrigger_)\s*\(/;

function topLevelFunctions(source) {
  const matches = Array.from(source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm));
  return matches.map((match, index) => ({
    name: match[1],
    source: source.slice(match.index, matches[index + 1] ? matches[index + 1].index : source.length)
  }));
}

function functionSource(fileName, functionName) {
  const fn = topLevelFunctions(readProjectFile(fileName)).find((item) => item.name === functionName);
  assert.ok(fn, `${fileName}: funcao ${functionName} nao encontrada`);
  return fn.source;
}

test('toda funcao publica potencialmente mutavel possui autorizacao explicita', () => {
  const files = ['WebApp.gs', 'TransporteCodexConfig.gs'];
  const exceptions = {
    limparNome: /return nome\.trim\(\)/,
    importarTransporteCodex: /return salvarTransporte\s*\(/
  };

  files.forEach((fileName) => {
    topLevelFunctions(readProjectFile(fileName))
      .filter((fn) => !fn.name.endsWith('_') && MUTATION_PREFIX.test(fn.name))
      .forEach((fn) => {
        const guard = AUTHORIZATION_GUARD.exec(fn.source);
        if (guard) {
          assert.ok(guard.index < 400, `${fileName}: ${fn.name} autoriza somente depois de iniciar a operacao`);
          return;
        }
        const delegatedGuard = exceptions[fn.name];
        assert.ok(delegatedGuard && delegatedGuard.test(fn.source), `${fileName}: ${fn.name} esta publica e sem guard de autorizacao`);
      });
  });
});

test('helpers destrutivos e de e-mail do Transporte nao fazem parte da superficie RPC', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const privateHelpers = [
    'performContentDeletion_',
    'criarRascunhoEmail_',
    'criarRascunhoTransporte_',
    'atualizarAbasDependentesDeclaracao_',
    'atualizarOcasaProformaTipoAmostra_',
    'manageSheetVisibilityUnified_'
  ];

  privateHelpers.forEach((name) => {
    assert.match(source, new RegExp(`^function\\s+${name}\\s*\\(`, 'm'), name);
    assert.doesNotMatch(source, new RegExp(`^function\\s+${name.slice(0, -1)}\\s*\\(`, 'm'), name);
  });
});

test('gatilhos novos apontam para handlers privados e pontes legadas exigem autorizacao', () => {
  const source = readProjectFile('WebApp.gs');
  const handlers = [
    'marcarAgendaPassadaComoRealizada',
    'monitorarConfirmacoesCourierAgendadas',
    'monitorarEntregasDhlAgendadas'
  ];

  handlers.forEach((handler) => {
    assert.match(source, new RegExp(`ScriptApp\\.newTrigger\\('${handler}_'\\)`), handler);
    assert.match(functionSource('WebApp.gs', handler), /codexAssertAdminOrInstalledTrigger_\s*\(/, handler);
    assert.match(source, new RegExp(`^function\\s+${handler}_\\s*\\(`, 'm'), handler);
  });
});

test('configuracao, instalacao de gatilhos e sandbox exigem perfil admin', () => {
  const functions = [
    ['WebApp.gs', 'configurarDhlTrackingApiKey'],
    ['WebApp.gs', 'instalarGatilhoAgendaRealizadoFimDoDia'],
    ['WebApp.gs', 'instalarGatilhoMonitorConfirmacaoCouriers'],
    ['WebApp.gs', 'removerGatilhoMonitorConfirmacaoCouriers'],
    ['WebApp.gs', 'instalarGatilhoMonitorEntregasDhl'],
    ['WebApp.gs', 'removerGatilhoMonitorEntregasDhl'],
    ['TransporteCodexConfig.gs', 'configurarPlanilhaTransporteCodex'],
    ['TransporteCodexConfig.gs', 'configurarUrlWebAppTransporteCodex'],
    ['TransporteCodexConfig.gs', 'executarSandboxTransporteCodex'],
    ['TransporteCodexConfig.gs', 'limparSandboxCodex']
  ];

  functions.forEach(([fileName, functionName]) => {
    assert.match(functionSource(fileName, functionName), /codexAssertAdmin_\s*\(/, `${fileName}: ${functionName}`);
  });
});

test('RPCs operacionais de Transporte exigem permissao de escrita antes da mutacao', () => {
  ['sincronizarTransporte', 'limparTransporte'].forEach((functionName) => {
    const source = functionSource('TransporteCodexConfig.gs', functionName);
    const guardIndex = source.indexOf('codexAssertCanWrite_');
    const mutationIndex = source.search(/transporteSincronizarDependencias_|performContentDeletion_/);
    assert.ok(guardIndex >= 0 && mutationIndex > guardIndex, functionName);
  });
});
