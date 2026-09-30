'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function client() {
  const nodes = {};
  const calls = [];
  let now = 1000000;
  function runner(success, failure) {
    return new Proxy({}, { get(_target, method) {
      if (method === 'withSuccessHandler') return (callback) => runner(callback, failure);
      if (method === 'withFailureHandler') return (callback) => runner(success, callback);
      return (...args) => calls.push({ method, args, success, failure });
    } });
  }
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, console: { info() {}, warn() {} },
    window: {}, document: { addEventListener() {}, getElementById: (id) => nodes[id] || null },
    CodexMatBioTypes: { list: () => [] },
    google: { script: { run: runner() } },
    esc: (value) => String(value ?? ''), codexNormText: (value) => String(value ?? '').toLowerCase(),
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  });
  const source = readProjectFile('IndexAgendaScripts.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '');
  vm.runInContext(source, context);
  return { context, nodes, calls, advance: (ms) => { now += ms; } };
}

test('Gerar docs envia linha e versoes, respeita conflito e atualiza a versao apos sucesso', () => {
  const { context: c, calls } = client();
  const errors = [];
  let opened = 0;
  c._agendaEditId = 'A'; c._agendaEditRecordVersion = 'vA'; c._agendaEditEditableVersion = 'eA';
  c.agendaEventoAtualEditado_ = () => ({ id: 'A', rowIndex: 7 });
  c.coletarAgendaEvento = () => ({ participante: 'Pessoa', courier1: { nome: 'Courier', awb: '123' } });
  for (const name of ['agendaMeaningfulValue', 'agendaCourierMeaningful', 'agendaValidarAwbDocumentos_', 'validateAgendaAwb']) c[name] = () => true;
  c.transporteAgendaContextFromDados = () => ({}); c.prepararJanelaTransporte = () => ({});
  c.atualizarJanelaTransporteErro = (_window, message) => errors.push(message);
  c.snackErro = () => {}; c.snack = () => {}; c.agendaRecarregarJanelaAtual_ = () => {};
  c.abrirTransporteModulo = () => { opened += 1; };
  c.gerarTransporteAgenda('1', 'button');
  assert.equal(calls[0].method, 'atualizarAgendaEventoCompleto');
  assert.equal(calls[0].args[0]._rowIndex, 7);
  assert.equal(calls[0].args[0]._recordVersion, 'vA');
  assert.equal(calls[0].args[0]._editRecordVersion, 'eA');
  calls[0].success({ conflito: true, erro: 'Alterado' });
  assert.equal(opened, 0); assert.deepEqual(errors, ['Alterado']);
  c.gerarTransporteAgenda('1', 'button');
  calls[1].success({ recordVersion: 'vB', editRecordVersion: 'eB' });
  assert.equal(opened, 1); assert.equal(c._agendaEditRecordVersion, 'vB');
  assert.equal(c._agendaEditEditableVersion, 'eB');
});

test('resumo na edicao preserva kit, monitor e projeto em resposta imediata, remota e falha', () => {
  const { context: c, nodes, calls } = client();
  nodes.agParticipante = { value: 'P' }; nodes.agProjeto = { value: 'Projeto historico' };
  nodes.agKit1 = { value: 'KIT-HISTORICO' }; nodes.agMonitor1 = { value: 'MONITOR-HISTORICO' };
  c._agendaDados = { participantes: [{ id: 'P', nome: 'Pessoa', projeto: 'Projeto atual' }] };
  c.atualizarAgendaProjetoLock = () => {}; c.agendaMatBioUpdateAllCopyOptions = () => {};
  c.agendaMostrarParticipanteInfo = () => {};
  c.onAgendaProjetoChange = () => { nodes.agKit1.value = ''; nodes.agMonitor1.value = ''; };
  c.setAgendaSelectValue = (id, value) => { nodes[id].value = value; };
  c.onAgendaParticipanteChange({ preservarCampos: true });
  calls[0].success({ id: 'P', nome: 'Pessoa', projeto: 'Projeto atual' });
  c.onAgendaParticipanteChange({ preservarCampos: true }); calls[1].failure(new Error('Indisponivel'));
  assert.equal(nodes.agKit1.value, 'KIT-HISTORICO'); assert.equal(nodes.agMonitor1.value, 'MONITOR-HISTORICO');
  assert.equal(nodes.agProjeto.value, 'Projeto historico');
  c.onAgendaParticipanteChange();
  assert.equal(nodes.agProjeto.value, 'Projeto atual'); assert.equal(nodes.agKit1.value, '');
});

test('conflito do backup reabre a origem pela funcao existente', () => {
  const { context: c, nodes, calls } = client();
  nodes.backupAgendaVisitas = {}; c._agendaEditId = 'A';
  c.agendaEventoAtualEditado_ = () => ({ recordVersion: 'vA' }); c.snackErro = () => {};
  let reopened;
  c.agendaFetchEventoPorId_ = (_id, _row, callback) => callback({ id: 'A' });
  c.abrirAgendaEdicaoComRegistro_ = (record) => { reopened = record; };
  c.aplicarBackupEmVisitaFuturaAgenda('B', 'vB', 'II');
  calls[0].success({ conflito: true, erro: 'Conflito' });
  assert.equal(reopened.id, 'A');
});

test('resposta e recuperacao tardias do backup nao reabrem outro modal', () => {
  const { context: c, nodes, calls } = client();
  nodes.backupAgendaVisitas = {}; c._agendaEditId = 'A';
  c.agendaEventoAtualEditado_ = () => ({ recordVersion: 'vA' }); c.snackErro = () => {};
  let recover; let reopened = 0;
  c.agendaFetchEventoPorId_ = (_id, _row, callback) => { recover = callback; };
  c.abrirAgendaEdicaoComRegistro_ = () => { reopened += 1; };
  c.aplicarBackupEmVisitaFuturaAgenda('B', 'vB', 'II');
  calls[0].success({ conflito: true, erro: 'Conflito' });
  c._agendaEditId = 'C'; c._agendaEditOpenRequestId++;
  recover({ id: 'A' }); assert.equal(reopened, 0);
  nodes.backupAgendaVisitas.innerHTML = 'Modal C';
  calls[0].failure(new Error('Antiga')); assert.equal(nodes.backupAgendaVisitas.innerHTML, 'Modal C');
});

test('presenca atrasada nao injeta versoes nem aviso em outra edicao', () => {
  const { context: c, calls } = client(); let warnings = 0;
  c.agendaEditPresenceSessionId = () => 'session'; c.agendaShowPresenceWarning = () => { warnings += 1; };
  c._agendaEditId = 'A'; c._agendaEditOpenRequestId = 1; c.agendaOpenEditPresence('A', '', '');
  c._agendaEditId = 'B'; c._agendaEditOpenRequestId = 2;
  calls[0].success({ version: 'vA', editVersion: 'eA' });
  assert.equal(c._agendaEditRecordVersion, ''); assert.equal(c._agendaEditEditableVersion, ''); assert.equal(warnings, 0);
});

test('baixa e reserva ignoram sucesso e falha de modal anterior, inclusive reabertura do mesmo ID', () => {
  for (const [method, setter, result] of [
    ['atualizarEstadoBaixaKitsAgenda', 'setAgendaKitsBaixaState', { baixados: true }],
    ['atualizarEstadoReservaKitsAgenda', 'setAgendaKitsReservaState', { reservado: true }],
  ]) {
    const { context: c, calls } = client();
    const states = []; c[setter] = (...args) => states.push(args);
    c._agendaEditId = 'A'; c._agendaEditOpenRequestId = 1; c[method]('A');
    c._agendaEditId = 'B'; c._agendaEditOpenRequestId = 2; c[method]('B');
    calls[1].success(result); const count = states.length;
    calls[0].success(result); calls[0].failure(new Error('Antiga'));
    assert.equal(states.length, count);
    c._agendaEditId = 'A'; c._agendaEditOpenRequestId = 3;
    calls[0].success(result); assert.equal(states.length, count);
  }
});

test('recibo ignora dados e erros de solicitacao anterior', () => {
  const { context: c, calls } = client(); let shown; let failures = 0;
  c.abrirOverlay = () => {}; c.agendaReciboPreencher_ = (data) => { shown = data; };
  c.agendaReciboFalha_ = () => { failures += 1; };
  c.abrirAgendaRecibo('A', 1); c.abrirAgendaRecibo('B', 2);
  calls[1].success({ agendaId: 'B', beneficiarios: [{ nome: 'B' }] });
  calls[0].success({ agendaId: 'A', beneficiarios: [{ nome: 'A' }] }); calls[0].failure(new Error('Antiga'));
  assert.equal(shown.agendaId, 'B'); assert.equal(c._agendaReciboData.agendaId, 'B'); assert.equal(failures, 0);
});

test('abertura de edicao e resolucao tardia do periodo nao substituem a ultima tentativa', () => {
  const { context: c } = client(); const callbacks = {}; const opened = [];
  c.agendaEditOpenPerformanceStart_ = () => ({}); c.agendaComFormularioPronto_ = (callback) => callback();
  c.agendaLogEditOpenPerformance_ = () => {}; c.agendaPreloadPeriodoEdicao_ = () => null;
  c.agendaFetchEventoPorId_ = (id, _row, callback) => { callbacks[id] = callback; };
  c.agendaAbrirEdicaoResolvida_ = (record, id, perf) => { opened.push([record.id, perf]); };
  c.abrirAgendaEdicao('A', 1); c.abrirAgendaEdicao('B', 2);
  callbacks.B({ id: 'B' }); callbacks.A({ id: 'A' });
  assert.equal(opened.length, 1); assert.equal(opened[0][0], 'B');
  let lateOpens = 0; c.abrirAgendaEdicaoComRegistro_ = () => { lateOpens += 1; };
  c.agendaAbrirEdicaoComContexto_({ id: 'A' }, 'A', { requestId: 1 });
  assert.equal(lateOpens, 0);
  c._agendaEditOpenRequestId++;
  c.agendaAbrirEdicaoComContexto_({ id: 'B' }, 'B', opened[0][1]); assert.equal(lateOpens, 0);
});

test('cache conserva idade na reutilizacao e expira no TTL sem renovar a validade', () => {
  const { context: c, advance } = client();
  c.agendaBootstrapWindowValido_ = () => true;
  const range = { start: '2026-09-28', endExclusive: '2026-10-19' };
  c.agendaWindowMemoryCachePut_({ events: [{ id: 'A' }], range }, range);
  const original = c.agendaWindowMemoryCacheGet_(range).cachedAt;
  advance(c.AGENDA_EVENTOS_TTL_MS - 1);
  const cached = c.agendaWindowMemoryCacheGet_(range);
  assert.equal(cached.cachedAt, original);
  c.agendaNormalizeRow = (row) => row; c.agendaMatBioUpdateAllCopyOptions = () => {};
  c.agendaAplicarEventos_(cached.events, 'window', { inicio: range.start, fim: range.endExclusive }, false, cached.cachedAt);
  assert.equal(c._agendaEventosLoadedAt, original);
  advance(1); assert.equal(c.agendaWindowMemoryCacheGet_(range), null);
  assert.equal(Object.keys(c._agendaWindowMemoryCache).length, 0);
});

test('carga legada descarta resposta e erro antigos mas conclui todos os pedidos', () => {
  const { context: c, nodes, calls } = client(); let rows; let completions = 0; let successes = 0;
  nodes.agendaViewLista = { innerHTML: '' }; c.agendaWindowedLoadingAtivo_ = () => false;
  c.agendaUpdatePeriod = () => {}; c.agendaRenderAposCarga_ = () => {};
  c.agendaAplicarEventos_ = (items) => { rows = items; };
  const options = { onComplete: () => { completions += 1; } };
  c.carregarAgendaEventos(true, () => { successes += 1; }, options);
  c.carregarAgendaEventos(true, () => { successes += 1; }, options);
  calls[1].success([{ status: 'novo' }]); calls[0].success([{ status: 'antigo' }]);
  assert.equal(rows[0].status, 'novo'); assert.equal(completions, 2); assert.equal(successes, 1);
  c.carregarAgendaEventos(true, null, options); c.carregarAgendaEventos(true, null, options);
  calls[3].success([{ status: 'atual' }]); nodes.agendaViewLista.innerHTML = 'atual';
  calls[2].failure(new Error('Antiga')); assert.equal(nodes.agendaViewLista.innerHTML, 'atual');
  assert.equal(completions, 4);
});

test('fallback concorrente compartilha carga real e entrega resultado a todos os interessados', () => {
  const { context: c, calls } = client(); let results = 0; let completions = 0;
  c.agendaRegistrarFallback_ = () => {}; c.agendaFormularioEstaPronto_ = () => true;
  c.agendaUpdatePeriod = () => {}; c.agendaRenderAposCarga_ = () => {}; c.agendaAplicarEventos_ = () => {};
  const options = { silent: true, onComplete: () => { completions += 1; } };
  c.agendaFallbackCargaCompleta_(() => { results += 1; }, options, 'truncated');
  c.agendaFallbackCargaCompleta_(() => { results += 1; }, options, 'rpc_failure');
  assert.equal(calls.length, 1); calls[0].success([{ id: 'A' }]);
  assert.equal(results, 2); assert.equal(completions, 2); assert.equal(c._agendaFallbackCargaEmAndamento, false);
});

test('kits usam ID ou alias exato e preservam listas legadas sem aceitar projetos parecidos', () => {
  const { context: c } = client();
  c._agendaDados = { projetos: [{ id: 'P1', nome: 'Estudo A', codigo: 'EA' }, { id: 'P2', nome: 'Estudo AB', codigo: 'EAB' }] };
  assert.equal(c.agendaKitPertenceProjeto_({ projeto: 'Estudo AB' }, 'Estudo A'), false);
  assert.equal(c.agendaKitPertenceProjeto_({ projeto: 'EA' }, 'Estudo A'), true);
  assert.equal(c.agendaKitPertenceProjeto_({ projeto: 'Estudo A' }, 'P1'), true);
  assert.equal(c.agendaKitPertenceProjeto_({ projetoId: 'P2', projeto: 'Estudo A' }, 'Estudo A'), false);
  assert.equal(c.agendaKitPertenceProjeto_({ projetoId: 'P1', projeto: 'Nome antigo' }, 'Estudo A'), true);
  assert.equal(c.agendaKitPertenceProjeto_({ projeto: 'Protocolo legado' }, 'Protocolo legado'), true);
  assert.equal(c.agendaKitPertenceProjeto_('Kit legado', 'Estudo A'), true);
  assert.equal(c.agendaKitPertenceProjeto_('Kit legado', ''), false);
});

test('hoje, semana e comparacoes seguem Sao Paulo na virada UTC de domingo para segunda', () => {
  const { context: c } = client();
  c.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-05T01:00:00Z'])); }
  };
  assert.equal(c.agendaHojeIso_(), '2026-10-04');
  assert.equal(c.agendaIsPastDate('2026-10-04'), false);
  assert.equal(c.agendaIsFutureDate('2026-10-05'), true);
  assert.equal(c.agendaIso(c.agendaWeekStartForOffset_(0)), '2026-09-28');
});

test('apagar ou trocar pesquisa descarta erros recebidos durante o debounce', () => {
  const { context: c, nodes, calls } = client();
  nodes.agendaBusca = { value: 'Pessoa A' }; nodes.agendaViewLista = { innerHTML: 'Lista atual' };
  c.renderAgendaOperacional = () => {};
  c.agendaCarregarHistorico('Pessoa A', null, 0);
  nodes.agendaBusca.value = ''; c.agendaOnSearchInput(); calls[0].failure(new Error('Atrasada'));
  assert.equal(nodes.agendaViewLista.innerHTML, 'Lista atual');
  nodes.agendaBusca.value = 'Pessoa A'; c.agendaCarregarHistorico('Pessoa A', null, 0);
  nodes.agendaBusca.value = 'Pessoa B'; c.agendaOnSearchInput(); calls[1].failure(new Error('Atrasada'));
  assert.equal(c._agendaHistoricoLoading, true); assert.equal(nodes.agendaViewLista.innerHTML, 'Lista atual');
});

test('reserva, baixa e devolucao capturam origem e ignoram respostas de outra edicao', () => {
  for (const mode of ['reservar', 'baixar', 'devolver']) {
    const { context: c, nodes, calls } = client(); let confirmed; let refreshes = 0; let states = 0;
    nodes.btnReservarKitsAgenda = { disabled: false }; nodes.btnBaixarKitsAgenda = { disabled: false };
    c._agendaEditId = 'A'; c._agendaEditOpenRequestId = 1; c._agendaKitsBaixados = mode === 'devolver';
    c.agendaKitsSelecionadosParaReserva = c.agendaKitsSelecionadosParaBaixa = () => [{ idLote: 'L1' }];
    c.coletarAgendaEvento = () => ({ participante: 'Pessoa A', projeto: 'Estudo A' });
    c.confirmarAgendaKits = (_title, _message, callback) => { confirmed = callback; };
    c.setAgendaKitsReservaState = c.setAgendaKitsBaixaState = () => { states += 1; };
    c.carregarAgendaEventos = () => { refreshes += 1; }; c.snack = c.snackErro = () => { states += 1; };
    const action = mode === 'reservar' ? c.reservarKitsAgendaEvento : c.baixarKitsAgendaEvento;
    action(); confirmed(); assert.equal(calls[0].args[0].agendaId, 'A');
    c._agendaEditId = 'B'; c._agendaEditOpenRequestId = 2;
    calls[0].success({}); calls[0].failure(new Error('Atrasada'));
    assert.equal(states, 0); assert.equal(refreshes, 1);
    c._agendaEditId = 'A'; c._agendaEditOpenRequestId = 3; action();
    c._agendaEditId = 'B'; c._agendaEditOpenRequestId = 4; confirmed();
    assert.equal(calls.length, 1, 'confirmacao antiga nao pode enviar uma mutacao');
  }
});
