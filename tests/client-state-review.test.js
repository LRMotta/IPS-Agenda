'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function load(file, names, context) {
  const s = readProjectFile(file), c = vm.createContext(context);
  for (const name of names) {
    const indent = file === 'IndexCoreScripts.html' ? '' : file === 'TransporteApp.html' ? '    ' : '  ';
    const found = s.match(new RegExp('^' + indent + 'function ' + name + '\\([^]*?\\n' + indent + '\\}', 'm'));
    assert.ok(found, name); vm.runInContext(found[0], c);
  }
  return c;
}
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
function element() {
  return { value: '', dataset: {}, disabled: false, readOnly: false, style: {}, innerHTML: '', events: 0,
    classList: { remove() {}, add() {}, contains() { return false; } },
    replaceChildren() {}, appendChild() {}, setAttribute() {}, dispatchEvent() { this.events++; },
    setCustomValidity(message) { this.invalid = message; } };
}
function municipalities() {
  const nodes = { city: element(), uf: element(), list: element() }, requests = [];
  nodes.city.dataset.ufTarget = 'uf'; nodes.city.dataset.listTarget = 'list';
  const c = load('IndexCoreScripts.html', ['participanteMunicipioElementos_', 'participantePreencherEstadosBrasilElemento_',
    'participanteCarregarMunicipios_', 'participanteInicializarLocalidade_', 'participanteSelecionarMunicipio_',
    'participanteFixarMunicipio_', 'participanteMunicipioDigitado_'], {
    document: { getElementById: id => nodes[id], createElement: element }, Event: function() {},
    ESTADOS_BRASIL_PARTICIPANTE_: [['RS', 'RS'], ['SC', 'SC']], _municipiosBrasilParticipanteCache_: {},
    _municipiosBrasilParticipanteEspera_: {}, _participanteLocalidadeRevision_: 0,
    normSelectValue: norm, appServerRun: r => requests.push(r), participanteRenderMunicipios_() {}
  });
  return { c, nodes, requests };
}

test('localidade legada carrega catálogo, resolve somente nome exato e não marca edição do usuário', () => {
  const { c, nodes, requests } = municipalities();
  c.participanteInicializarLocalidade_('city', 'RS', 'Caxias do Sul', '');
  assert.equal(requests.length, 1);
  assert.equal(c.participanteFixarMunicipio_('city'), true, 'histórico inalterado pode ser preservado enquanto carrega');
  requests[0].onSuccess([{ nome: 'Caxias do Sul', codigo: '4305108' }]);
  assert.equal(nodes.city.dataset.municipioCodigo, '4305108');
  assert.equal(nodes.city.events, 0);
});

test('nova participação não invalida município bloqueado sem código; campo alterado segue estrito', () => {
  const { c, nodes } = municipalities();
  nodes.city.value = 'Histórico'; nodes.uf.value = 'RS'; nodes.city.disabled = true;
  assert.equal(c.participanteFixarMunicipio_('city'), true);
  assert.equal(nodes.city.invalid, '');
  nodes.city.disabled = false;
  assert.equal(c.participanteFixarMunicipio_('city'), false);
});

test('município histórico desconhecido/indisponível permanece intacto, mas digitação exige seleção', () => {
  for (const fail of [false, true]) {
    const { c, nodes, requests } = municipalities();
    c.participanteInicializarLocalidade_('city', 'RS', 'Grafia histórica', '');
    if (fail) requests[0].onFailure(new Error('rede'));
    else requests[0].onSuccess([{ nome: 'Outra cidade', codigo: '123' }]);
    assert.equal(nodes.city.value, 'Grafia histórica');
    assert.equal(c.participanteFixarMunicipio_('city'), true);
    nodes.city.value = 'Alteração'; c.participanteMunicipioDigitado_('city');
    assert.equal(c.participanteFixarMunicipio_('city'), false);
  }
});

test('resposta de município não altera formulário reaberto, ainda que UF e nome sejam iguais', () => {
  const { c, nodes, requests } = municipalities();
  c.participanteInicializarLocalidade_('city', 'RS', 'Caxias', '');
  c.participanteInicializarLocalidade_('city', 'RS', 'Caxias', 'NOVO');
  requests[0].onSuccess([{ nome: 'Caxias', codigo: 'ANTIGO' }]);
  assert.equal(nodes.city.dataset.municipioCodigo, 'NOVO');
});

function soa() {
  const nodes = new Proxy({}, { get: (o, id) => o[id] || (o[id] = element()) }), requests = [];
  const c = load('IndexCoreScripts.html', ['soaProjetoNomeAtual_', 'invalidarPreviaReplicacaoCiclosSoA_',
    'carregarSoAVisitasProjeto', 'carregarBracosProjeto', 'soaCyclePayload_', 'previsualizarReplicacaoCiclosSoAApp', 'confirmarReplicacaoCiclosSoAApp'], {
    document: { getElementById: id => nodes[id] }, _soaProjetoAtual: null, _soaCyclePreviewAtual: null,
    _soaCyclePreviewRequest: 0, _soaCyclePreviewPayload: '', _soaVisitasRequest: 0, _bracosProjetoRequest: 0,
    _soaVisitasAtual: [], _bracosProjetoAtual: [], renders: [], arms: [], models: [], statuses: [],
    appServerRun: r => requests.push(r), appSetStatus: (...args) => c.statuses.push(args),
    appSetButtonBusy: (b, busy) => { b.disabled = busy; }, soaAtualizarAcoesOrdem_() {},
    renderSoAVisitas: rows => { c._soaVisitasAtual = rows; c.renders.push(rows); },
    renderBracosProjeto: rows => { c._bracosProjetoAtual = rows; c.arms.push(rows); },
    aplicarModelosEstoqueNasVisitasSoA_: rows => c.models.push(rows),
    renderReplicacaoCiclosSoAPreview_: result => { nodes.btnConfirmarCiclosSoA.disabled = !result.podeGravar; },
    esc: String, appErrorMessage: e => e.message, fecharOverlay() {}, snack() {}
  });
  return { c, nodes, requests };
}

for (const same of [false, true]) test('SoA descarta respostas e erros antigos, inclusive A→B→A: ' + same, () => {
  const { c, nodes, requests } = soa();
  c.carregarSoAVisitasProjeto({ codigo: 'A' }); c.carregarBracosProjeto({ codigo: 'A' });
  c.carregarSoAVisitasProjeto({ codigo: 'B' }); c.carregarBracosProjeto({ codigo: 'B' });
  if (same) { c.carregarSoAVisitasProjeto({ codigo: 'A' }); c.carregarBracosProjeto({ codigo: 'A' }); }
  const last = same ? 4 : 2;
  requests[last].onSuccess(['atuais']); requests[last + 1].onSuccess(['braços atuais']);
  requests[0].onSuccess(['antigas']); requests[1].onSuccess(['braços antigos']);
  requests[0].onFailure(new Error('antigo')); requests[1].onFailure(new Error('antigo'));
  assert.deepEqual(Array.from(c._soaVisitasAtual), ['atuais']);
  assert.deepEqual(Array.from(c._bracosProjetoAtual), ['braços atuais']);
  assert.doesNotMatch(nodes.pSoAList.innerHTML, /antigo/);
  assert.equal(requests.filter(r => r.method === 'getModelosEstoqueSoAPorProjeto').length, 1);
});

test('modelos SoA antigos também não sobrescrevem uma recarga do mesmo projeto', () => {
  const { c, requests } = soa();
  c.carregarSoAVisitasProjeto({ codigo: 'A' }); requests[0].onSuccess(['primeiras']);
  const old = requests[1];
  c.carregarSoAVisitasProjeto({ codigo: 'A' }); requests[2].onSuccess(['atuais']);
  old.onSuccess(['antigos']); requests[3].onSuccess(['atuais']);
  assert.deepEqual(Array.from(c.models[0]), ['atuais']);
  assert.equal(c.models.length, 1);
});

test('alterar ciclos invalida prévia em voo, ignora erro antigo e impede confirmar snapshot diferente', () => {
  const { c, nodes, requests } = soa(); c._soaProjetoAtual = { codigo: 'A' };
  nodes.soaCycleModelo.value = '1'; nodes.soaCycleDestinos.value = '2';
  c.previsualizarReplicacaoCiclosSoAApp();
  nodes.soaCycleDestinos.value = '3'; c.invalidarPreviaReplicacaoCiclosSoA_();
  requests[0].onSuccess({ podeGravar: true });
  assert.equal(c._soaCyclePreviewAtual, null); assert.equal(nodes.btnConfirmarCiclosSoA.disabled, true);
  c.previsualizarReplicacaoCiclosSoAApp(); requests[1].onSuccess({ podeGravar: true, ok: true });
  requests[0].onFailure(new Error('antigo'));
  assert.equal(nodes.btnConfirmarCiclosSoA.disabled, false);
  nodes.soaCycleDestinos.value = '4'; c.confirmarReplicacaoCiclosSoAApp();
  assert.equal(requests.some(r => r.method === 'criarCiclosSoAPorReplicacao'), false);
});

test('invalidação da Agenda limpa janelas, ambos timestamps e descarta resposta em voo', () => {
  const c = load('IndexAgendaScripts.html', ['setAgendaEventosLoadedAtState', 'agendaWindowMemoryCacheClear_', 'invalidarAgendaEventosCliente_'], {
    _agendaEventosLoadedAt: 123, STATE: { agenda: { eventsLoadedAt: 123 } },
    _agendaWindowMemoryCache: { antiga: {} }, _agendaWindowMemoryCacheOrder: ['antiga'], _agendaEventosRequestId: 4, _agendaBootstrapInFlightRequestId: 4
  });
  c.invalidarAgendaEventosCliente_();
  assert.equal(c._agendaEventosLoadedAt, 0); assert.equal(c.STATE.agenda.eventsLoadedAt, 0);
  assert.equal(Object.keys(c._agendaWindowMemoryCache).length, 0); assert.equal(c._agendaEventosRequestId, 5);
  assert.equal(c._agendaBootstrapInFlightRequestId, 0);
});

test('confirmar entrega invalida Agenda somente após sucesso, inclusive retorno com outro modal aberto', () => {
  for (const outcome of ['success', 'conflict', 'failure']) {
    let invalidations = 0, request;
    const c = load('IndexPendenciasScripts.html', ['executarConfirmarEntregaPendencia_'], {
      document: { getElementById: () => null }, _pendenciaEntregaPendente: { agendaId: 'A', slot: '1', awb: 'X' }, _pendenciasCache: null,
      appServerRun: r => { request = r; }, invalidarAgendaEventosCliente_: () => { invalidations++; },
      snack() {}, snackErro() {}, carregarPendencias() {}, setPendenciasStatus() {}, fecharConfirmacaoEntregaPendencia() {}, appErrorMessage: e => e.message
    });
    c.executarConfirmarEntregaPendencia_(); c._pendenciaEntregaPendente = { agendaId: 'B' };
    if (outcome === 'failure') request.onFailure(new Error('rede'));
    else request.onSuccess(outcome === 'success' ? { ok: true } : { conflito: true });
    assert.equal(invalidations, outcome === 'success' ? 1 : 0);
  }
});

test('servidor preserva localidade legada inalterada; novo/alterado ou código inválido continuam bloqueados', () => {
  const headers = ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braço', 'Última visita', 'Status', 'Telefone', 'CPF', 'Obs', 'Rua', 'Número', 'Cidade', 'UF'];
  const old = ['P-1', 'Pessoa', '', '', 'PT-1', 'Estudo A', '', '', 'Falha de Triagem', '', '', '', '', '', 'Grafia histórica', 'RS'];
  const sh = new FakeSheet('Participantes', [headers, old]);
  const ss = new FakeSpreadsheet({ Participantes: sh });
  const s = runFiles(['CadastroRules.gs', 'BrazilLocations.gs', 'WebApp.gs'], {
    Date, SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} }, Utilities: { getUuid: () => 'NOVA-PESSOA' }, Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  s.codexAssertCanWrite_ = () => {}; s.codexWithDocumentLock_ = (_, f) => f();
  s.clearCodexRuntimeCaches_ = () => {}; s.getProjetosParticipantesOptions_ = () => [{ nome: 'Estudo A' }, { nome: 'Estudo B' }];
  s.codexWriteAuditChanges_ = () => {}; s.codexWriteAuditLog_ = () => {};
  s.codexLogPerformance_ = () => {}; s.participantePossuiEventoAgenda_ = () => false;
  const base = { nome: 'Pessoa', idParticipante: 'PT-1', projeto: 'Estudo A', status: 'Falha de Triagem', estado: 'RS', cidade: 'Grafia histórica', municipioCodigo: '' };
  s.salvarDadosParticipante({ ...base, id: 'P-1', telefone: '54999999999' });
  assert.equal(sh.rows[1][14], 'Grafia histórica');
  s.salvarDadosParticipante({ ...base, idParticipante: 'PT-2', projeto: 'Estudo B', status: 'Ativo', novaParticipacaoDireta: true, vincularPessoaCadastroId: 'P-1' });
  assert.equal(sh.rows.length, 3); assert.equal(sh.rows[2][14], 'Grafia histórica');
  assert.throws(() => s.salvarDadosParticipante({ ...base, id: 'P-1', cidade: 'Alterada' }), /município/);
  assert.throws(() => s.salvarDadosParticipante({ ...base, id: 'P-1', municipioCodigo: '999' }), /não corresponde/);
  assert.throws(() => s.salvarDadosParticipante({ ...base, nome: 'Outra pessoa', idParticipante: 'NOVA' }), /município/);
  const companion = { id: 'ACO-1', nome: 'Acompanhante', estado: 'RS', cidade: 'Grafia histórica', municipioCodigo: '' };
  assert.equal(s.participanteValidarAcompanhantes_([companion], [companion])[0].cidade, companion.cidade);
  assert.throws(() => s.participanteValidarAcompanhantes_([{ ...companion, cidade: 'Alterada' }], [companion]), /município/);
  assert.throws(() => s.participanteValidarAcompanhantes_([{ ...companion, id: 'OUTRO' }], [companion]), /município|não pertence/);
});

test('registro normalizado retornado pelo Transporte prevalece sobre payload local', () => {
  const c = load('TransporteApp.html', ['transportApplySavedRegistro'], { state: { registro: { idAgenda: 'A', observacoes: 'antiga' } } });
  c.transportApplySavedRegistro({ observacoes: 'salva', courier: 'dhl' }, { registro: { courier: 'DHL', dataEnvio: '2026-10-16' } });
  assert.equal(c.state.registro.idAgenda, 'A'); assert.equal(c.state.registro.courier, 'DHL'); assert.equal(c.state.registro.observacoes, 'salva');
  c.transportApplySavedRegistro({ observacoes: 'legado' }, { type: 'pdf', recovered: true });
  assert.equal(c.state.registro.observacoes, 'legado');
});
