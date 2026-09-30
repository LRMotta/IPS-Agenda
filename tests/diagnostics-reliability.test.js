'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFiles } = require('./helpers/load-app-script');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');

function server() { return runFiles(['WebApp.gs', 'DeploymentDiagnostics.gs']); }

function criticalData(overrides = {}) {
  return Object.assign({
    operational: { overall: { errors: 0, warnings: 0, checks: [] } },
    auth: { ok: true, required: false }, spreadsheet: { ok: true },
    permissions: { drive: { ok: true }, calendar: { ok: true } },
    transport: { ok: true }, mail: { ok: true, remainingDailyQuota: 10 },
    smoke: { checks: [{ label: 'Admin', ok: true }] }
  }, overrides);
}

test('resumo incorpora falhas criticas, cota e verificacoes basicas sem esconder leituras indisponiveis', () => {
  const s = server();
  const data = criticalData({
    auth: { ok: true, required: true }, permissions: { drive: { ok: false, error: 'Acesso negado' } },
    mail: { ok: false, remainingDailyQuota: 0 },
    smoke: { checks: [{ label: 'Laboratorios', ok: false, status: 'Erro' }] }
  });
  s.codexAppendCriticalChecks_(data);
  const overall = data.operational.overall;
  assert.equal(overall.status, 'Erro');
  assert.equal(overall.errors, 4);
  assert.equal(overall.unverified, 2); // Calendar e confirmacao da entrega.
  assert.equal(overall.checks.find(item => item.label === 'Permissao Calendar').ok, null);
  assert.equal(overall.checks.find(item => item.label === 'OAuth').ok, false);
  const healthy = criticalData();
  s.codexAppendCriticalChecks_(healthy);
  assert.equal(healthy.operational.overall.status, 'Nao verificado');
  assert.equal(healthy.operational.overall.errors, 0);
});

test('falha inesperada de uma sonda preserva as demais e registra nao verificado', () => {
  const s = server();
  const timings = [];
  const result = s.codexSafeDiagnostic_(timings, 'drive', 'Drive', () => { throw new Error('Servico indisponivel'); });
  assert.equal(result.status, 'Nao verificado');
  assert.equal(timings[0].ok, false);
  assert.equal(s.codexSafeDiagnostic_(timings, 'outra', 'Outra', () => ({ ok: true })).ok, true);
});

test('RPC administrativa mantem autorizacao e entrega parcial quando uma sonda falha', () => {
  const s = server();
  let probes = 0;
  s.codexAssertAdmin_ = () => { throw new Error('Admin obrigatorio'); };
  s.codexGetUserOAuthStatus_ = () => { probes++; throw new Error('OAuth indisponivel'); };
  assert.throws(() => s.getCodexDeploymentDiagnostics({}), /Admin obrigatorio/);
  assert.equal(probes, 0);
  s.codexAssertAdmin_ = () => ({ role: 'admin' });
  s.codexGetIdentityDiagnostics_ = () => ({});
  s.codexGetCacheDiagnostics_ = () => ({});
  s.codexGetTransportDiagnostics_ = () => ({ ok: true });
  s.codexGetTriggersDiagnostics_ = () => ({ expected: [] });
  s.codexGetAutomationRunDiagnostics_ = () => ({ items: [] });
  s.codexGetMailDiagnostics_ = () => ({ ok: true, remainingDailyQuota: 10 });
  s.codexGetCriticalPermissionsDiagnostics_ = () => ({ drive: { ok: true }, calendar: { ok: true } });
  s.codexGetOperationalHealthDiagnostics_ = () => ({ overall: { errors: 0, warnings: 0, checks: [] } });
  s.codexBuildConfigAppDiagnostics_ = () => ({ ok: true, items: [] });
  s.codexGetProfileHealthDiagnostics_ = () => ({ activeAdmins: 1 });
  s.codexGetSmokeDiagnostics_ = () => ({ checks: [{ label: 'Admin', ok: true }] });
  s.codexGetRecentAuditIssuesDiagnostics_ = () => ({ items: [] });
  s.Session = { getScriptTimeZone: () => 'America/Sao_Paulo' };
  s.Utilities = { formatDate: () => '2026-09-30 19:00:00' };
  s.ScriptApp = { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) };
  s.getCodexSpreadsheet_ = () => ({ getId: () => 'sheet-test', getName: () => 'Teste', getUrl: () => 'https://example.invalid', getSpreadsheetTimeZone: () => 'America/Sao_Paulo' });
  const result = s.getCodexDeploymentDiagnostics({});
  assert.equal(result.auth.status, 'Nao verificado');
  assert.equal(result.spreadsheet.ok, true);
  assert.equal(result.operational.overall.unverified, 2);
  assert.equal(result.operational.overall.ok, false);
  assert.equal(result.validUntilMs - result.checkedAtMs, 300000);
  assert.equal(result.timings.find(item => item.key === 'auth').ok, false);
  assert.match(result.coverage, /Nao valida saldos\/reservas/);
});

test('inventario cobre lembretes e historico distingue atraso, execucao, falha e ausencia', () => {
  const s = server();
  const values = new Map();
  s.PropertiesService = { getScriptProperties: () => ({ getProperty: key => values.get(key) || '' }) };
  function history(state) {
    values.set(s.codexAutomationRunKey_('monitorarLembretesCourier'), JSON.stringify(state));
    return s.codexGetAutomationRunDiagnostics_().items.find(item => item.handler === 'monitorarLembretesCourier');
  }
  let result = history({ status: 'Sucesso', finishedAt: new Date(Date.now() - 46 * 60000).toISOString() });
  assert.equal(result.status, 'Execucao atrasada');
  assert.equal(result.ok, false);
  result = history({ status: 'Sucesso', finishedAt: new Date().toISOString() });
  assert.equal(result.ok, true);
  assert.equal(history({ status: 'Executando', startedAt: new Date(Date.now() - 31 * 60000).toISOString() }).status, 'Possivel interrupcao');
  assert.equal(history({ status: 'Sucesso', finishedAt: 'invalido' }).status, 'Historico invalido');
  values.clear();
  result = s.codexGetAutomationRunDiagnostics_().items.find(item => item.handler === 'monitorarLembretesCourier');
  assert.equal(result.status, 'Nunca registrado');
  assert.equal(result.ok, false);
});

function clientFixture() {
  const requests = [], elements = {}, timers = [];
  let success, failure, copied;
  const run = {
    withSuccessHandler(callback) { success = callback; return this; },
    withFailureHandler(callback) { failure = callback; return this; },
    getCodexDeploymentDiagnostics() { requests.push({ success, failure }); },
    limparCodexCachesDiagnostico() { requests.push({ success, failure }); }
  };
  let now = 1000000;
  const context = {
    APP_DEPLOYMENT_DIAGNOSTICS: null, APP_DIAGNOSTICS_REQUEST_ID: 0, APP_DIAGNOSTICS_IN_FLIGHT: false,
    APP_DIAGNOSTICS_CLEARING: false, APP_DIAGNOSTICS_RECEIVED_AT: 0, APP_DIAGNOSTICS_EXPIRY_TIMER: null,
    APP_DIAGNOSTICS_TTL_MS: 300000, APP_LOADED_VERSION: 'v1', APP_VERSION_CHECK_TIMER: 1, APP_VERSION_NOTICE_VISIBLE: false,
    Date: { now: () => now }, document: { getElementById: id => elements[id] ||= {}, querySelectorAll: () => [] },
    google: { script: { run } }, window: { confirm: () => true }, navigator: { clipboard: { writeText: text => { copied = text; return Promise.resolve(); } } },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
    esc: text => String(text), snack: () => {}, snackErro: () => {}, renderDiagnosticoImplantacao: () => {}
  };
  vm.createContext(context);
  vm.runInContext(contentAccessibilitySource(['carregarDiagnosticoImplantacao', 'diagSnapshotFresh', 'diagBeginRequest',
    'diagApplyResult', 'diagRenderFreshness', 'diagClientContext', 'diagSetText', 'limparCachesDiagnostico', 'copiarDiagnosticoImplantacao']), context);
  return { context, requests, elements, timers, advance: ms => { now += ms; }, copied: () => copied };
}

test('diagnostico deduplica carga, ignora sucesso/falha antigos e expira sem RPC automatica', () => {
  const f = clientFixture(), c = f.context;
  c.carregarDiagnosticoImplantacao(false);
  c.carregarDiagnosticoImplantacao(false);
  assert.equal(f.requests.length, 1);
  c.carregarDiagnosticoImplantacao(true);
  f.requests[1].success({ checkedAt: 'novo' });
  f.requests[0].success({ checkedAt: 'antigo' });
  f.requests[0].failure(new Error('antigo'));
  assert.equal(c.APP_DEPLOYMENT_DIAGNOSTICS.checkedAt, 'novo');
  assert.equal(c.diagSnapshotFresh(), true);
  c.carregarDiagnosticoImplantacao(false);
  assert.equal(f.requests.length, 2);
  f.advance(300000);
  f.timers.at(-1)();
  assert.equal(f.elements.diagOverall.textContent, 'Não verificado');
  assert.equal(f.requests.length, 2);
  c.carregarDiagnosticoImplantacao(false);
  assert.equal(f.requests.length, 3);
});

test('limpeza invalida leitura pendente e falha atual impede reutilizar saude antiga', () => {
  const f = clientFixture(), c = f.context;
  c.carregarDiagnosticoImplantacao(false);
  c.limparCachesDiagnostico();
  c.carregarDiagnosticoImplantacao(true);
  assert.equal(f.requests.length, 2);
  f.requests[0].success({ checkedAt: 'antes da limpeza' });
  assert.equal(c.APP_DEPLOYMENT_DIAGNOSTICS, null);
  f.requests[1].success({ checkedAt: 'apos limpeza' });
  c.carregarDiagnosticoImplantacao(true);
  f.requests[2].failure(new Error('atual'));
  assert.equal(c.diagSnapshotFresh(), false);
  assert.equal(f.elements.diagOverall.textContent, 'Não verificado');
});

test('resumo copiado contem divergencia, evidencia, proximo passo e validade', () => {
  const f = clientFixture(), c = f.context;
  c.diagApplyResult(c.diagBeginRequest(), { coverage: 'Somente leitura', operational: { overall: {
    status: 'Atencao', checks: [{ label: 'Referencias', ok: false, severity: 'warning', detail: 'linha 794: CAD-1 | Proximo passo: revisar protocolo original' }]
  } } });
  c.copiarDiagnosticoImplantacao();
  assert.match(f.copied(), /linha 794: CAD-1/);
  assert.match(f.copied(), /revisar protocolo original/);
  assert.match(f.copied(), /Publicacao: nao confirmada/);
  f.advance(300000);
  c.copiarDiagnosticoImplantacao();
  assert.match(f.copied(), /leitura vencida ou indisponivel/);
});
