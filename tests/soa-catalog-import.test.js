'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planningIntegration } = require('./helpers/soa-planning-integration');

function fixture() {
  const f = planningIntegration();
  const d = f.canonical;
  d.schema_version = '1.1.0';
  const first = d.visits[0], next = d.visits[1];
  first.timing = {};
  first.scheduling = { mode: 'milestone', reason: 'A própria avaliação inicial realizada inicia o calendário.' };
  next.timing = { anchor: 'visit', anchor_visit_id: first.id, basis: 'planned', offset_days: 14, window_before_days: 3, window_after_days: 3 };
  next.scheduling = { mode: 'calculated' };
  d.visits.push({ ...JSON.parse(JSON.stringify(next)), id: 'manual', code: 'VNP', name: 'Visita por indicação clínica', order: 3,
    status: 'requires_review', timing: {}, scheduling: { mode: 'manual', reason: 'Programar somente por indicação clínica, sem prazo fixo.' } });
  d.rules = [{ id: 'by_occurrence', kind: 'event_driven_visit', description: 'Sem prazo fixo.', handling: 'manual', reason: 'A visita será programada por ocorrência.',
    visit_ids: ['manual'], source: first.source, status: 'requires_review' }];
  return { ...f, d, p: { projeto: 'Estudo local', dados: d, criarBracos: true } };
}

function apply(s, p) {
  const before = s.validarImportacaoSoA(p);
  assert.equal(before.podeImportar, true, JSON.stringify(before.alertas));
  return s.importarSoAJson({ ...p, confirmarRevisaoPlanejamento: true, fingerprintPlanejamento: before.fingerprint });
}

test('catálogo 1.1 importa marco, cálculo e ocorrência sem zeros presumidos e arquiva fontes/regras', () => {
  const { server: s, spreadsheet, d, p } = fixture();
  const preview = s.validarImportacaoSoA(p);
  assert.equal(preview.ok, true);
  assert.equal(preview.podeImportar, true);
  assert.equal(spreadsheet.getSheets().length, 0);
  assert.ok(preview.planejamento.issues.every(i => !i.blocking));
  assert.throws(() => s.importarSoAJson(p), /confirme/);
  const saved = apply(s, p);
  const rows = s.getSoAVisitasProjeto(p.projeto);
  assert.equal(rows.length, 3);
  const manual = rows.find(v => v.codigo === 'VNP');
  const milestone = rows.find(v => v.idSoA === rows[1].referencia);
  assert.equal(manual.intervaloDias, '');
  assert.equal(manual.janelaDiasMenos, '');
  assert.equal(manual.janelaDiasMais, '');
  assert.equal(manual.referencia, '');
  assert.equal(manual.baseCalculo, '');
  assert.equal(manual.papelCronograma, 'NAO_PARTICIPA_CALCULO');
  assert.match(manual.observacoes, /sem prazo fixo/);
  assert.equal(milestone.papelCronograma, 'MARCO_CALCULO');
  assert.equal(milestone.baseCalculo, '');
  assert.deepEqual(JSON.parse(JSON.stringify(s.carregarPlanejamentoSoA(p.projeto, saved.planejamentoId).dados)), d);
  assert.equal(apply(s, p).adicionadas, 0);
});

test('regra manual não libera condição desconhecida sobre visita calculada nem aceita fonte/escopo ausentes', () => {
  const mutations = [
    d => { d.rules[0].visit_ids = [d.visits[1].id]; },
    d => { d.rules[0].visit_ids = ['unknown']; },
    d => { d.rules[0].visit_ids = []; },
    d => { delete d.rules[0].reason; },
    d => { delete d.rules[0].description; },
    d => { d.rules[0].source = {}; },
    d => { delete d.rules[0].handling; },
    d => { d.rules.push(JSON.parse(JSON.stringify(d.rules[0]))); },
    d => { d.visits[2].scheduling.mode = 'unknown'; },
    d => { d.visits[2].scheduling.reason = ''; },
    d => { d.visits[2].scheduling = 'manual'; },
    d => { d.visits[2].scheduling.mode = false; },
    d => { d.visits[2].timing = []; },
    d => { d.visits[2].timing = 14; },
    d => { d.visits[1].timing.offset_days = null; },
    d => { d.visits[1].timing.anchor_visit_id = 'manual'; },
    d => { d.visits[0].timing = { offset_days: 0 }; },
    d => { d.schema_version = '1.0.0'; }
  ];
  for (const mutate of mutations) {
    const { server: s, spreadsheet, p, d } = fixture();
    mutate(d);
    const preview = s.validarImportacaoSoA(p);
    assert.equal(preview.podeImportar, false, mutate.toString());
    assert.throws(() => s.importarSoAJson({ ...p, confirmarRevisaoPlanejamento: true, fingerprintPlanejamento: preview.fingerprint }), /pendente/);
    assert.equal(spreadsheet.getSheets().length, 0);
  }
});

test('conferência de administração não agenda doses e não libera regras de calendário disfarçadas', () => {
  const { server: s, p, d } = fixture();
  d.rules[0] = { ...d.rules[0], kind: 'minimum_interval', scope: 'administration', visit_ids: [d.visits[1].id] };
  assert.equal(s.validarImportacaoSoA(p).podeImportar, true);
  d.rules[0].kind = 'conditional_pathway';
  assert.equal(s.validarImportacaoSoA(p).podeImportar, false);
});

test('marco próprio exige realização e libera dependentes, enquanto visita manual ignora base herdada', () => {
  const { server: s, p } = fixture();
  apply(s, p);
  s.getProjetoBaseCalculoPadrao_ = () => 'MANTER_DATAS_PREVISTAS';
  const rows = s.getSoAVisitasProjeto(p.projeto);
  const milestone = rows.find(v => v.papelCronograma === 'MARCO_CALCULO');
  const manual = rows.find(v => v.codigo === 'VNP');
  manual.referencia = milestone.idSoA; // Legacy/stale manual configuration must not acquire a forecast.
  manual.intervaloDias = 1;
  const input = { visitas: rows, bracoId: rows[0].bracoIds[0], eventos: [{ id: 'a', idSoA: milestone.idSoA, data: '2026-10-15', concluida: false }] };
  let preview = s.jornadaCtmsCalcularPreviaPura_(input);
  assert.ok(preview.linhas.every(r => !r.dataPrevistaIso));
  input.eventos[0].concluida = true;
  preview = s.jornadaCtmsCalcularPreviaPura_(input);
  assert.equal(preview.linhas.find(r => r.idSoA === milestone.idSoA).dataPrevistaIso, '2026-10-15');
  assert.equal(preview.linhas.find(r => r.idSoA === milestone.idSoA).janelaInicio, '');
  assert.equal(preview.linhas.find(r => r.idSoA === milestone.idSoA).janelaFim, '');
  assert.equal(preview.linhas.find(r => r.idSoA === rows[1].idSoA).dataPrevistaIso, '2026-10-29');
  assert.equal(preview.linhas.find(r => r.idSoA === manual.idSoA).dataPrevistaIso, '');
});

test('reimportação manual sem note não acumula observação gerada e conserva a nota anterior', () => {
  const { server: s, p, d } = fixture();
  apply(s, p);
  delete d.visits[2].note;
  p.modo = 'atualizar';
  const before = s.getSoAVisitasProjeto(p.projeto).find(v => v.codigo === 'VNP').observacoes;
  apply(s, p);
  apply(s, p);
  assert.equal(s.getSoAVisitasProjeto(p.projeto).find(v => v.codigo === 'VNP').observacoes, before);
});

test('Jornada operacional respeita realização do marco com CTMS desligado ou sem aprovação', () => {
  const { server: s, p } = fixture();
  apply(s, p);
  const rows = s.getSoAVisitasProjeto(p.projeto);
  const milestone = rows.find(v => v.papelCronograma === 'MARCO_CALCULO');
  const manual = rows.find(v => v.codigo === 'VNP');
  const event = { id: 'a', data: new Date(2026, 9, 15), concluida: false, cancelada: false };
  s.jornadaLerEventos_ = () => [event, { id: 'b', data: new Date(2026, 9, 16), concluida: false, cancelada: false }];
  s.getAgendaSoAConciliacoesPorAgendaId_ = () => ({ a: milestone.idSoA, b: manual.idSoA });
  s.agendaSoAEventoFazParteDoIPS_ = () => true;
  s.jornadaCtmsLerConfigParticipante_ = () => ({ marcos: {}, escolhasReferencias: {}, aprovacoes: {} });
  s.jornadaCtmsProjetoPiloto_ = () => false;
  s.getModelosEstoqueSoAPorProjeto = () => [];
  s.getKitReservasLinhas_ = () => [];
  s.getEstoque = () => [];
  s.agendaSoAMontarConcilicaoVisitas_ = () => [];
  s.formatarDataSafe = v => s.jornadaCtmsDateIso_(v);
  s.formatarDataIsoAgenda_ = v => s.jornadaCtmsDateIso_(v);
  for (const active of [false, true]) {
    s.projetoCtmsJornadaAtivo_ = () => active;
    event.concluida = false;
    let result = s.getJornadaParticipanteInterno_({ nome: 'Pessoa fictícia', projeto: p.projeto });
    assert.equal(result.visitas.find(v => v.idSoA === rows[1].idSoA).dataAlvoIso, '');
    assert.equal(result.visitas.find(v => v.idSoA === milestone.idSoA).janelaInicio, '');
    assert.equal(result.visitas.find(v => v.idSoA === manual.idSoA).janelaInicio, '');
    event.concluida = true;
    result = s.getJornadaParticipanteInterno_({ nome: 'Pessoa fictícia', projeto: p.projeto });
    assert.equal(result.visitas.find(v => v.idSoA === rows[1].idSoA).dataAlvoIso, '2026-10-29');
  }
});
