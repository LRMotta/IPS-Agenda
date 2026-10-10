'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');

function fixture() {
  const ids = ['rqPaciente', 'rqNascimento', 'rqProtocolo', 'rqMedico', 'rqPrestador', 'rqData', 'rqHorario', 'rqEndereco', 'rqObs', 'rqVisitReminder', 'rqReminderBraco', 'rqReminderVisita', 'page-requisicao'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', hidden: true, dataset: {}, closest: () => true }]));
  const pending = [];
  const context = vm.createContext({
    document: { getElementById: id => elements[id] || null, querySelectorAll: () => [{}] },
    window: {}, _rqOrigemContext: null, _rqOrigemRequestId: 0, _rqAgendaOrigemId: '', _agendaEditId: '',
    _rqLookup: { participantePorNome: {}, solicitantePorNome: {} }, _rqUrgente: false,
    ensureRequisicaoDataLoaded: fn => pending.push(fn), preencherSolicitanteUsuarioAtual() {}, preencherEnderecoReq() {},
    updateRequisicaoGenerateAvailability() {}, setRequisicaoFieldInvalid() {}, snack() {}, getExames: () => ['Exame'],
  });
  const core = contentAccessibilitySource(['atualizarRequisicaoLembreteVisita', 'limparRequisicaoOrigem', 'requisicaoAgendaOrigemIdAtual', 'rqLookupKey', 'preencherDadosPaciente', 'onRequisicaoRequiredInput', 'montarPayloadRequisicao']);
  const agenda = readProjectFile('IndexAgendaScripts.html').match(/  function aplicarAgendaNaRequisicao\([^]*?\n  \}/)[0];
  vm.runInContext(core + '\n' + agenda, context);
  return { context, elements, pending };
}

test('requisição mostra braço/visita da origem e não envia o lembrete no payload PDF/e-mail', () => {
  const { context, elements, pending } = fixture();
  context.aplicarAgendaNaRequisicao({ id: 'A', participante: 'Pessoa', braco: '<img src=x onerror=alert(1)>', visita: 'V3 — Semana 12' });
  pending[0]();
  assert.equal(elements.rqVisitReminder.hidden, false);
  assert.equal(elements.rqReminderBraco.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(elements.rqReminderVisita.textContent, 'V3 — Semana 12');
  const payload = context.montarPayloadRequisicao({ paciente: 'Pessoa', solicitante: 'Usuário', data: '2026-10-14', local: 'Prestador' });
  assert.equal(payload.agendaId, 'A');
  assert.equal(Object.hasOwn(payload, 'braco'), false);
  assert.equal(Object.hasOwn(payload, 'visita'), false);
  assert.doesNotMatch(JSON.stringify(payload), /Semana 12|onerror|rqReminder/);
});

test('requisição usa rótulos de ausência sem inferir braço ou visita', () => {
  const { context, elements, pending } = fixture();
  context.aplicarAgendaNaRequisicao({ id: 'A', participante: 'Pessoa' });
  pending[0]();
  assert.equal(elements.rqReminderBraco.textContent, 'Não informado');
  assert.equal(elements.rqReminderVisita.textContent, 'Não informada');
});

test('troca de paciente e limpeza removem o lembrete e o vínculo com a visita anterior', () => {
  const { context, elements, pending } = fixture();
  context.aplicarAgendaNaRequisicao({ id: 'A', participante: 'Pessoa', braco: 'A', visita: 'V1' });
  pending[0]();
  elements.rqPaciente.value = 'Outra pessoa';
  context.onRequisicaoRequiredInput({ target: { id: 'rqPaciente', closest: () => true } });
  assert.equal(elements.rqVisitReminder.hidden, true);
  assert.equal(context.requisicaoAgendaOrigemIdAtual(), '');
  assert.equal(elements.rqReminderBraco.textContent, '');
  context.limparRequisicaoOrigem();
  assert.equal(elements.rqReminderVisita.textContent, '');
});

test('respostas de carregamento fora de ordem não restauram o lembrete de outra visita', () => {
  const { context, elements, pending } = fixture();
  context.aplicarAgendaNaRequisicao({ id: 'A', participante: 'Pessoa A', visita: 'V1' });
  context.aplicarAgendaNaRequisicao({ id: 'B', participante: 'Pessoa B', visita: 'V2' });
  pending[1]();
  pending[0]();
  assert.equal(elements.rqPaciente.value, 'Pessoa B');
  assert.equal(elements.rqReminderVisita.textContent, 'V2');
  assert.equal(context.requisicaoAgendaOrigemIdAtual(), 'B');
  context.aplicarAgendaNaRequisicao({ id: 'C', participante: 'Pessoa C' });
  context.limparRequisicaoOrigem();
  pending[2]();
  assert.equal(elements.rqPaciente.value, 'Pessoa B');
  assert.equal(elements.rqVisitReminder.hidden, true);
});

test('lembrete fica antes dos exames, sem campos de envio e oculto na impressão', () => {
  const html = readProjectFile('IndexContentAfterDashboard.html');
  const reminder = html.slice(html.indexOf('<aside class="req-visit-reminder"'), html.indexOf('<!-- 4. Exames -->'));
  assert.match(reminder, /hidden/);
  assert.doesNotMatch(reminder, /<input|<textarea|name=/);
  assert.match(readProjectFile('IndexStyles.html'), /@media print \{ \.req-visit-reminder \{ display:none!important; \} \}/);
});

test('atalho completo da Agenda repassa o braço carregado somente para o participante selecionado', () => {
  const source = readProjectFile('IndexAgendaScripts.html').match(/  function abrirReqExamesDaAgenda\([^]*?\n  \}/)[0];
  let received;
  const context = vm.createContext({
    _agendaEditId: 'A', _agendaParticipanteInfo: { nome: 'Pessoa', braco: 'B (Cetuxi + FOLFOX)' },
    agendaMatBioValidateAll: () => true, coletarAgendaEvento: () => ({ participante: 'Pessoa', servTerc: 'Prestador', data: '2026-10-14', visita: 'C14D15' }),
    agendaMeaningfulValue: Boolean, agendaIsPastDate: () => false, fecharAgendaModal: fn => fn(),
    irPara() {}, setTimeout: (fn, delay) => { if (delay === 250) fn(); },
    aplicarAgendaNaRequisicao: data => { received = data; }, snackErro() {},
  });
  vm.runInContext(source, context);
  context.abrirReqExamesDaAgenda();
  assert.equal(received.braco, 'B (Cetuxi + FOLFOX)');
  assert.equal(received.visita, 'C14D15');
  context._agendaParticipanteInfo = { nome: 'Outra pessoa', braco: 'A' };
  context.abrirReqExamesDaAgenda();
  assert.equal(received.braco, '');
});
