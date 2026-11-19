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
    _rqLookup: { participantesPorNome: {}, solicitantePorNome: {} }, _rqUrgente: false,
    ensureRequisicaoDataLoaded: fn => pending.push(fn), preencherSolicitanteUsuarioAtual() {}, preencherEnderecoReq() {},
    updateRequisicaoGenerateAvailability() {}, setRequisicaoFieldInvalid() {}, snack() {}, getExames: () => ['Exame'],
  });
  const core = contentAccessibilitySource(['atualizarRequisicaoLembreteVisita', 'limparRequisicaoOrigem', 'requisicaoAgendaOrigemIdAtual', 'rqLookupKey', 'codexNormText', 'rqGroupBy', 'rqEscolherParticipacao', 'rqContextoParticipacaoOrigem', 'rqParticipacoesDescricao', 'preencherDadosPaciente', 'onRequisicaoRequiredInput', 'montarPayloadRequisicao']);
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

function carregarParticipacoes(context, lista) {
  context._rqLookup.participantesPorNome = context.rqGroupBy(lista, 'nome');
}

const WILLIAM = [
  { id: '81231589', nome: 'William Rafael da Silva Lourenço', nascimento: '3/mai./1954', protocolo: 'J6Z-MC-IIBD', medico: 'Dr. A', status: 'Falha de Pré-Triagem', ativa: false },
  { id: '81231591', nome: 'William Rafael da Silva Lourenço', nascimento: '3/mai./1994', protocolo: 'TOPAZ-UC', medico: 'Dr. B', status: 'Em Triagem', ativa: true }
];

test('requisição digitada usa a participação ativa, não a primeira cadastrada', () => {
  const { context, elements } = fixture();
  carregarParticipacoes(context, WILLIAM);
  elements.rqPaciente.value = WILLIAM[0].nome;
  context.preencherDadosPaciente();
  assert.equal(elements.rqProtocolo.value, 'TOPAZ-UC');
  assert.equal(elements.rqNascimento.value, '3/mai./1994');
  assert.equal(elements.rqMedico.value, 'Dr. B');
});

test('requisição aberta pela Agenda usa a participação do evento, mesmo encerrada', () => {
  const { context, elements, pending } = fixture();
  carregarParticipacoes(context, WILLIAM);
  context.aplicarAgendaNaRequisicao({ id: 'A', participante: WILLIAM[0].nome, projeto: 'J6Z-MC-IIBD' });
  pending[0]();
  assert.equal(elements.rqProtocolo.value, 'J6Z-MC-IIBD');
  context.aplicarAgendaNaRequisicao({ id: 'B', participante: WILLIAM[0].nome, projeto: 'Outro', participanteCadastroId: '81231591' });
  pending[1]();
  assert.equal(elements.rqProtocolo.value, 'TOPAZ-UC');
});

test('sugestões de paciente mostram protocolo e status de cada participação', () => {
  const { context } = fixture();
  carregarParticipacoes(context, WILLIAM);
  assert.equal(context.rqParticipacoesDescricao(WILLIAM[0].nome), 'J6Z-MC-IIBD (Falha de Pré-Triagem) · TOPAZ-UC (Em Triagem)');
});

test('participação encerrada em um protocolo não prevalece sobre a nova pré-triagem', () => {
  const { context, elements } = fixture();
  carregarParticipacoes(context, [
    { id: '81231586', nome: 'Felipe Jose Mente', protocolo: 'SUNSCAPE-1', status: 'Falha de Pré-Triagem', ativa: false },
    { id: '81231592', nome: 'Felipe Jose Mente', protocolo: 'EMERALD-3', status: 'Pré-Triagem', ativa: true }
  ]);
  elements.rqPaciente.value = 'Felipe Jose Mente';
  context.preencherDadosPaciente();
  assert.equal(elements.rqProtocolo.value, 'EMERALD-3');
});
