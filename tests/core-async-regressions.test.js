'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const source = readProjectFile('IndexCoreScripts.html');

function loadFunctions(context, names) {
  vm.createContext(context);
  names.forEach(name => {
    const match = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  });
  return context;
}

test('braços descartam respostas obsoletas após trocar participante ou limpar projeto', () => {
  const requests = [], rendered = [];
  const fields = { ptProjeto: { value: 'A' }, ptBracoOpcao: {}, ptBraco: { value: '' } };
  const c = loadFunctions({ _participanteBracosConsulta: null,
    document: { getElementById: id => fields[id] }, appServerRun: options => requests.push(options),
    renderBracosParticipante: (...args) => rendered.push(args)
  }, ['carregarBracosParticipante']);
  c.carregarBracosParticipante('A', 'Braço antigo');
  c.carregarBracosParticipante('A', 'Braço novo');
  requests[0].onSuccess(['Obsoleto']);
  requests[0].onFailure();
  assert.equal(rendered.length, 0);
  requests[1].onSuccess(['Atual']);
  assert.equal(rendered[0][1], 'Braço novo');
  fields.ptProjeto.value = '';
  c.carregarBracosParticipante('', '');
  requests[1].onSuccess(['Obsoleto']);
  assert.equal(rendered.length, 2);
  const edit = source.slice(source.indexOf('function abrirFormPart('), source.indexOf('function abrirFormParticipante('));
  assert.equal((edit.match(/carregarBracosParticipante\(/g) || []).length, 0);
  assert.ok(edit.indexOf("document.getElementById('ptBraco').value") < edit.indexOf('preencherProjetosParticipante(p.projeto'));
});

test('histórico anterior bloqueia duplicação, permite retry e ignora resposta de outra Jornada', () => {
  const requests = [];
  const fields = { jornadaHistoricoAnteriorStatus: {} };
  const c = loadFunctions({ window: { _jornadaParticipanteConsulta: {} },
    _jornadaParticipanteDados: { participante: { nome: 'A', projeto: 'P' }, eventosAnteriores: [] },
    document: { getElementById: id => fields[id] }, appServerRun: options => requests.push(options),
    appErrorMessage: error => error.message,
    jornadaHistoricoAnteriorHtml_: () => ''
  }, ['carregarHistoricoAnteriorJornada']);
  const button = {};
  c.carregarHistoricoAnteriorJornada(button);
  c.carregarHistoricoAnteriorJornada(button);
  assert.equal(requests.length, 1);
  assert.equal(button.disabled, true);
  requests[0].onFailure(new Error('Falhou'));
  assert.equal(button.disabled, false);
  assert.equal(fields.jornadaHistoricoAnteriorStatus.textContent, 'Falhou');
  c.carregarHistoricoAnteriorJornada(button);
  requests[1].onSuccess({ total: 1, eventos: [{ visita: 'V1' }] });
  c.carregarHistoricoAnteriorJornada(button);
  assert.equal(requests.length, 2);
  c._jornadaParticipanteDados = { participante: { nome: 'A', projeto: 'P' } };
  c.carregarHistoricoAnteriorJornada(button);
  const current = { participante: { nome: 'B', projeto: 'P' } };
  c._jornadaParticipanteDados = current;
  c.window._jornadaParticipanteConsulta = {};
  requests[2].onSuccess({ total: 51, proximoOffset: null, eventos: [{ visita: 'V2' }] });
  assert.equal(current.eventosAnteriores, undefined);
});

function cadastroFixture() {
  const requests = [];
  const context = loadFunctions({
    CADASTROS_BOOTSTRAP_CACHE: {}, CADASTROS_BOOTSTRAP_IN_FLIGHT: {},
    CADASTROS_BOOTSTRAP_CACHE_TTL_MS: 300000,
    appServerRun: options => requests.push(options)
  }, ['cadastroBootstrapCacheValid', 'invalidateCadastroBootstrapCache', 'getCadastrosBootstrapCached']);
  return { context, requests };
}

for (const order of [[0, 1], [1, 0]]) {
  test('cadastros preservam todos os callbacks e a resposta nova na ordem ' + order.join(','), () => {
    const { context: c, requests } = cadastroFixture();
    const results = [];
    c.getCadastrosBootstrapCached('projetos', res => results.push('inicial:' + res.version), null, false);
    c.getCadastrosBootstrapCached('projetos', res => results.push('compartilhado:' + res.version), null, false);
    assert.equal(requests.length, 1);
    c.getCadastrosBootstrapCached('projetos', res => results.push('forcado:' + res.version), null, true);
    assert.equal(requests.length, 2);
    order.forEach(index => requests[index].onSuccess({ version: index === 0 ? 'antiga' : 'nova' }));
    assert.deepEqual(results, ['inicial:nova', 'compartilhado:nova', 'forcado:nova']);
    assert.equal(c.CADASTROS_BOOTSTRAP_CACHE.projetos.data.version, 'nova');
  });
}

test('invalidacao de cadastro em voo transfere consumidores para uma leitura atual', () => {
  const { context: c, requests } = cadastroFixture();
  const results = [];
  c.getCadastrosBootstrapCached('projetos', res => results.push(res.version), null, false);
  c.invalidateCadastroBootstrapCache('projetos');
  assert.equal(requests.length, 2);
  requests[0].onSuccess({ version: 'antiga' });
  assert.deepEqual(results, []);
  requests[1].onSuccess({ version: 'nova' });
  assert.deepEqual(results, ['nova']);
  c.getCadastrosBootstrapCached('projetos', res => results.push(res.version), null, false);
  assert.equal(requests.length, 2);
});

test('falha obsoleta nao remove a consulta nova nem perde seus consumidores', () => {
  const { context: c, requests } = cadastroFixture();
  const failures = [];
  c.getCadastrosBootstrapCached('projetos', null, err => failures.push('inicial:' + err.message), false);
  c.getCadastrosBootstrapCached('projetos', null, err => failures.push('forcado:' + err.message), true);
  requests[0].onFailure(new Error('antiga'));
  assert.deepEqual(failures, []);
  requests[1].onFailure(new Error('nova'));
  assert.deepEqual(failures, ['inicial:nova', 'forcado:nova']);
  assert.equal(c.CADASTROS_BOOTSTRAP_IN_FLIGHT.projetos, undefined);
});

test('atualizacao forcada impede que consumidores novos leiam o cache antigo', () => {
  const { context: c, requests } = cadastroFixture();
  c.CADASTROS_BOOTSTRAP_CACHE.projetos = { data: { version: 'antiga' }, loadedAt: Date.now() };
  const results = [];
  c.getCadastrosBootstrapCached('projetos', res => results.push(res.version), null, true);
  c.getCadastrosBootstrapCached('projetos', res => results.push(res.version), null, false);
  assert.equal(requests.length, 1);
  assert.deepEqual(results, []);
  requests[0].onSuccess({ version: 'nova' });
  assert.deepEqual(results, ['nova', 'nova']);
});

test('invalidacao global preserva consumidores e isola cada cadastro', () => {
  const { context: c, requests } = cadastroFixture();
  const results = [];
  c.getCadastrosBootstrapCached('projetos', res => results.push(res.version), null, false);
  c.getCadastrosBootstrapCached('medicos', res => results.push(res.version), null, false);
  c.invalidateCadastroBootstrapCache();
  assert.equal(requests.length, 4);
  requests[1].onSuccess({ version: 'medicos antigos' });
  requests[2].onSuccess({ version: 'projetos novos' });
  requests[0].onFailure(new Error('projetos antigos'));
  requests[3].onSuccess({ version: 'medicos novos' });
  assert.deepEqual(results, ['projetos novos', 'medicos novos']);
});

function jornadaFixture() {
  const requests = [];
  const content = { innerHTML: '' };
  const subtitle = { textContent: '' };
  const overlay = { classList: { remove() {} } };
  const c = loadFunctions({
    window: {}, _jornadaParticipanteAtual: null, _jornadaParticipanteDados: null,
    document: { getElementById: id => id === 'jornadaParticipanteConteudo' ? content : id === 'jornadaParticipanteSubtitulo' ? subtitle : overlay },
    jornadaParticipanteOverlay_: () => overlay, abrirOverlay: () => {},
    appServerRun: options => requests.push(options), jornadaParticipanteHtml_: data => data.id,
    esc: String, appErrorMessage: err => err.message, appConfirmNavigationIfDirty: () => true,
    appClearUnsavedChanges: () => {}
  }, ['abrirJornadaParticipante', 'fecharOverlay']);
  return { c, requests, content, subtitle };
}

test('jornada descarta respostas de outro participante e limpa dados durante a carga', () => {
  const { c, requests, content, subtitle } = jornadaFixture();
  c.abrirJornadaParticipante({ id: 'A', nome: 'A' });
  requests[0].onSuccess({ id: 'A' });
  c.abrirJornadaParticipante({ id: 'B', nome: 'B' });
  assert.equal(c._jornadaParticipanteDados, null);
  requests[1].onSuccess({ id: 'B' });
  requests[0].onSuccess({ id: 'A' });
  requests[0].onFailure(new Error('falha antiga'));
  assert.equal(c._jornadaParticipanteAtual.id, 'B');
  assert.equal(c._jornadaParticipanteDados.id, 'B');
  assert.equal(content.innerHTML, 'B');
  assert.match(subtitle.textContent, /^B/);
});

test('fechar a jornada invalida a resposta que ainda esta em voo', () => {
  const { c, requests, content } = jornadaFixture();
  c.abrirJornadaParticipante({ id: 'A' });
  const before = content.innerHTML;
  c.fecharOverlay('modalJornadaParticipante');
  requests[0].onSuccess({ id: 'A' });
  assert.equal(c._jornadaParticipanteDados, null);
  assert.equal(content.innerHTML, before);
});

for (const method of ['definirAprovacaoCtmsJornada', 'salvarConfiguracaoCtmsJornada', 'salvarConcilicaoVisitasParticipante']) {
  test(method + ' nao aplica retorno de gravacao na jornada de outro participante', () => {
    const { c, requests, content } = jornadaFixture();
    const tokenA = {};
    c.window._jornadaParticipanteConsulta = tokenA;
    c._jornadaParticipanteAtual = { id: 'A', nome: 'A', projeto: 'P' };
    c._jornadaParticipanteDados = { conciliacao: [{ visitaOriginal: 'Visita A' }] };
    const control = { value: 'SOA-1', getAttribute: () => '1' };
    c.document.getElementById = () => control;
    c.document.querySelectorAll = () => [];
    c.appSetButtonBusy = () => {};
    c.appSetStatus = () => {};
    c.snack = () => {};
    c.snackErro = () => { throw new Error('Erro obsoleto exibido'); };
    c.abrirPreviaCtmsJornada = () => { throw new Error('Previas obsoletas exibidas'); };
    loadFunctions(c, [method]);
    c[method](control);
    assert.equal(requests.length, 1);
    c.window._jornadaParticipanteConsulta = {};
    c._jornadaParticipanteAtual = { id: 'B' };
    c._jornadaParticipanteDados = { id: 'B' };
    requests[0].onSuccess({ jornada: { id: 'A' } });
    requests[0].onFailure(new Error('antiga'));
    assert.equal(c._jornadaParticipanteAtual.id, 'B');
    assert.equal(c._jornadaParticipanteDados.id, 'B');
    assert.equal(requests.length, 1);
    assert.equal(content.innerHTML, '');
  });
}

test('retorno de reserva somente atualiza a jornada que iniciou a operacao', () => {
  const { c, content } = jornadaFixture();
  loadFunctions(c, ['jornadaAplicarRespostaAtualizada_']);
  const tokenA = {};
  c.window._jornadaParticipanteConsulta = tokenA;
  c.snack = () => {};
  c.jornadaAplicarRespostaAtualizada_({ jornada: { id: 'A' } }, '', tokenA);
  assert.equal(content.innerHTML, 'A');
  c.window._jornadaParticipanteConsulta = {};
  c._jornadaParticipanteDados = { id: 'B' };
  content.innerHTML = 'B';
  c.jornadaAplicarRespostaAtualizada_({ jornada: { id: 'A' } }, '', tokenA);
  assert.equal(content.innerHTML, 'B');
  assert.equal(c._jornadaParticipanteDados.id, 'B');
});

test('consulta de lotes antiga nao preenche outra visita aberta no mesmo participante', () => {
  const { c, requests } = jornadaFixture();
  loadFunctions(c, ['abrirReservaPreviaJornada']);
  c.window._jornadaParticipanteConsulta = {};
  c._jornadaParticipanteAtual = { id: 'A', nome: 'A', projeto: 'P' };
  c._jornadaParticipanteDados = { visitas: [{ idSoA: 'V1' }, { idSoA: 'V2' }] };
  const content = { innerHTML: '' };
  let target = { innerHTML: '' };
  c.document.getElementById = id => id === 'jornadaParticipanteConteudo' ? content : target;
  c.abrirReservaPreviaJornada('V1');
  target = { innerHTML: 'visita 2 carregando' };
  c.abrirReservaPreviaJornada('V2');
  requests[0].onSuccess({ kits: [] });
  requests[0].onFailure(new Error('antiga'));
  assert.equal(target.innerHTML, 'visita 2 carregando');
  requests[1].onSuccess({ kits: [] });
  assert.match(target.innerHTML, /Não há modelos/);
});

function auditFixture() {
  const requests = [];
  let user = 'A';
  const body = { innerHTML: '' };
  const c = loadFunctions({
    AUDIT_VIEW: 'log', AUDIT_PAGE_SIZE: 100, AUDIT_PAGE_REQUEST_ID: 0,
    AUDIT_FILTER_SIGNATURE: 'A', AUDIT_PAGE_OFFSET: { log: 0, changes: 0 },
    AUDIT_PAGE_CACHE: { log: {}, changes: {} }, AUDIT_PAGE_META: { log: {}, changes: {} },
    AUDIT_PREFETCHING: {}, AUDIT_LOG_ROWS: [], AUDIT_CHANGES_ROWS: [],
    document: { getElementById: () => body },
    auditFilters: () => ({ user }), auditFilterSignature: () => user,
    appTableSkeletonRow: () => 'carregando', renderAuditLog: () => {}, renderAuditPager: () => {},
    esc: String, appErrorMessage: err => err.message,
    google: { script: { run: { withSuccessHandler(ok) {
      return { withFailureHandler(fail) {
        return { getAuditPage(type, limit, offset, filters) { requests.push({ ok, fail, type, limit, offset, filters }); } };
      } };
    } } } }
  }, ['auditCacheKey', 'setAuditRows', 'auditRowsForView', 'carregarAuditPage', 'prefetchAuditNextPage']);
  return { c, requests, body, setUser: value => { user = value; } };
}

test('auditoria ignora sucesso e falha de filtros anteriores', () => {
  const { c, requests, body, setUser } = auditFixture();
  c.carregarAuditPage('log', 0, false);
  setUser('B');
  c.carregarAuditPage('log', 0, false);
  requests[1].ok({ rows: [{ user: 'B' }] });
  requests[0].ok({ rows: [{ user: 'A' }] });
  requests[0].fail(new Error('antiga'));
  assert.equal(c.AUDIT_LOG_ROWS[0].user, 'B');
  assert.doesNotMatch(body.innerHTML, /antiga/);
});

test('auditoria mantém a pagina mais recente mesmo com respostas invertidas', () => {
  const { c, requests } = auditFixture();
  c.carregarAuditPage('log', 0, false);
  c.carregarAuditPage('log', 100, false);
  requests[1].ok({ rows: [{ id: 'segunda' }], offset: 100 });
  requests[0].ok({ rows: [{ id: 'primeira' }], offset: 0 });
  assert.equal(c.AUDIT_PAGE_OFFSET.log, 100);
  assert.equal(c.AUDIT_LOG_ROWS[0].id, 'segunda');
});

test('pagina em cache invalida resposta pendente de outra pagina', () => {
  const { c, requests } = auditFixture();
  c.AUDIT_PAGE_CACHE.log['A:100:0'] = { rows: [{ id: 'cache' }], meta: { offset: 0, hasMore: false } };
  c.carregarAuditPage('log', 100, false);
  c.carregarAuditPage('log', 0, false);
  requests[0].ok({ rows: [{ id: 'antiga' }], offset: 100 });
  assert.equal(c.AUDIT_LOG_ROWS[0].id, 'cache');
});

test('trocar a visao impede que a falha anterior sobrescreva a tabela atual', () => {
  const { c, requests, body } = auditFixture();
  c.carregarAuditPage('log', 0, false);
  c.AUDIT_VIEW = 'changes';
  c.carregarAuditPage('changes', 0, false);
  requests[0].fail(new Error('log antigo'));
  assert.equal(body.innerHTML, 'carregando');
});

test('prefetch de uma consulta anterior nao repovoa o cache apos atualizacao', () => {
  const { c, requests } = auditFixture();
  c.AUDIT_PAGE_META.log = { offset: 0, limit: 100, hasMore: true };
  c.AUDIT_LOG_ROWS = [{ id: 'primeira' }];
  c.prefetchAuditNextPage('log');
  c.AUDIT_PAGE_CACHE.log = {};
  requests[0].ok({ rows: [{ id: 'prefetch antigo' }] });
  assert.equal(c.AUDIT_PAGE_CACHE.log['A:100:1'], undefined);
});

test('auditoria aceita prefetch e falhas da consulta atual', () => {
  const { c, requests, body } = auditFixture();
  c.carregarAuditPage('log', 0, false);
  requests[0].fail(new Error('falha atual'));
  assert.match(body.innerHTML, /falha atual/);
  c.carregarAuditPage('log', 0, false);
  requests[1].ok({ rows: [{ id: 'primeira' }], hasMore: true });
  assert.equal(requests.length, 3);
  requests[2].ok({ rows: [{ id: 'prefetch' }] });
  c.carregarAuditPage('log', 1, false);
  assert.equal(c.AUDIT_LOG_ROWS[0].id, 'prefetch');
  assert.equal(requests.length, 3);
});
