'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function activeConfig(grupo, chave, valor) {
  return { grupo, chave, valor, ativo: 'Sim' };
}

test('diagnostico valida as configuracoes essenciais da Config_App', () => {
  const server = runFile('WebApp.gs');
  server.codexReadConfigAppRowsForDiagnostics_ = () => [
    activeConfig('Agenda', 'Tipo de evento', 'Visita'),
    activeConfig('Agenda', 'Status', 'Agendado'),
    activeConfig('Projetos', 'Fase', 'III'),
    activeConfig('Projetos', 'Status', 'Ativo'),
    activeConfig('Estoque', 'Laboratório 1', 'Lab A'),
    activeConfig('Estoque', 'Localização 1', 'Sala A'),
    activeConfig('Estoque', 'Tipo de item 1', 'Kit')
  ];

  let result = server.codexBuildConfigAppDiagnostics_();
  assert.equal(result.ok, true);
  assert.equal(result.missing, 0);

  server.codexReadConfigAppRowsForDiagnostics_ = () => [activeConfig('Agenda', 'Status', 'Agendado')];
  result = server.codexBuildConfigAppDiagnostics_();
  assert.equal(result.ok, false);
  assert.ok(result.items.some((item) => item.label === 'Estoque / Tipos de item' && !item.ok));
});

test('diagnostico de perfis conta duplicados, inativos, nomes e aniversarios invalidos', () => {
  const server = runFile('WebApp.gs', {
    Utilities: { formatDate: () => '04-01' },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  const result = server.codexBuildProfileDiagnostics_([
    ['admin@exemplo.invalid', 'Admin', 'admin', 'Sim', '04-01'],
    ['ADMIN@exemplo.invalid', '', 'user', 'Não', '31/04'],
    ['', 'Sem email', 'user', 'Sim', '']
  ]);

  assert.equal(result.total, 3);
  assert.equal(result.active, 2);
  assert.equal(result.inactive, 1);
  assert.equal(result.duplicateEmails, 1);
  assert.equal(result.missingEmails, 1);
  assert.equal(result.missingNames, 1);
  assert.equal(result.invalidBirthdays, 1);
});

test('diagnostico diferencia gatilho ausente, unico e duplicado', () => {
  function trigger(handler) {
    return {
      getHandlerFunction: () => handler,
      getTriggerSource: () => 'CLOCK',
      getEventType: () => 'CLOCK',
      getUniqueId: () => handler + '-id'
    };
  }
  const server = runFile('WebApp.gs', {
    ScriptApp: {
      getProjectTriggers: () => [
        trigger('monitorarConfirmacoesCourierAgendadas'),
        trigger('monitorarConfirmacoesCourierAgendadas')
      ]
    }
  });
  const result = server.codexGetTriggersDiagnostics_();

  assert.equal(result.ok, false);
  assert.equal(result.missing, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.expected.find((item) => item.key === 'courier').count, 2);
  assert.equal(result.expected.find((item) => item.key === 'dhl').count, 0);
});

test('automacoes registram ultima execucao, duracao, sucesso e falha', () => {
  const values = new Map();
  const properties = {
    setProperty: (key, value) => values.set(key, value),
    getProperty: (key) => values.get(key) || ''
  };
  const server = runFile('WebApp.gs', {
    PropertiesService: { getScriptProperties: () => properties }
  });

  const success = server.codexRunTrackedAutomation_('monitorarEntregasDhlAgendadas', () => ({ ok: true, verificados: 3, entregues: 1 }));
  assert.equal(success.entregues, 1);
  let history = server.codexGetAutomationRunDiagnostics_();
  let dhl = history.items.find((item) => item.handler === 'monitorarEntregasDhlAgendadas');
  assert.equal(dhl.status, 'Sucesso');
  assert.match(dhl.summary, /verificados=3/);

  assert.throws(() => server.codexRunTrackedAutomation_('monitorarConfirmacoesCourierAgendadas', () => { throw new Error('Gmail indisponivel'); }), /Gmail indisponivel/);
  history = server.codexGetAutomationRunDiagnostics_();
  const courier = history.items.find((item) => item.handler === 'monitorarConfirmacoesCourierAgendadas');
  assert.equal(courier.status, 'Falha');
  assert.match(courier.message, /Gmail indisponivel/);
});

test('cronometro registra duracao e o painel renderiza os diagnosticos medios', () => {
  const server = runFile('WebApp.gs');
  const timings = [];
  assert.equal(server.codexTimedDiagnostic_(timings, 'teste', 'Teste', () => 'ok'), 'ok');
  assert.equal(timings.length, 1);
  assert.equal(timings[0].label, 'Teste');
  assert.ok(timings[0].durationMs >= 0);

  const content = readProjectFile('IndexContentAfterDashboard.html');
  const client = readProjectFile('IndexCoreScripts.html');
  ['diagConfigValidation', 'diagProfileHealth', 'diagAutomationRuns', 'diagTimings'].forEach((id) => {
    assert.match(content, new RegExp('id="' + id + '"'));
    assert.match(client, new RegExp(id));
  });
  assert.match(client, /Tempo total do diagnostico/);
});
