'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planningIntegration } = require('./helpers/soa-planning-integration');
const { poloParser, poloCsv, singleAnchorVisits, chainedVisits, fixed } = require('./helpers/polo-flowchart-fixture');

const parser = poloParser();
const extract = csv => JSON.parse(JSON.stringify(parser.soaPoloExtrair_(csv)));

function fixture(visits = singleAnchorVisits(), extra = {}) {
  const f = planningIntegration();
  f.server.getProjetoBaseCalculoPadrao_ = () => 'MANTER_DATAS_PREVISTAS';
  return { ...f, s: f.server, p: { projeto: 'Estudo local', dados: extract(poloCsv(visits)), braco: 'Braço A', criarBracos: true, ...extra } };
}
function apply(s, p) {
  const before = s.validarImportacaoSoA(p);
  assert.equal(before.podeImportar, true, JSON.stringify(before.alertas));
  return s.importarSoAJson({ ...p, confirmarRevisaoPlanejamento: true, fingerprintPlanejamento: before.fingerprint });
}
const byCode = (result, code) => result.visitas.find(visit => visit.codigo === code);

test('leitor mantém só as visitas: valores e procedimentos não saem do navegador', () => {
  const dados = extract(poloCsv(singleAnchorVisits()));
  const raw = JSON.stringify(dados);
  assert.equal(dados.schema, 'polo-trial-flowchart');
  assert.equal(dados.visits.length, 7);
  assert.deepEqual(Object.keys(dados.visits[2]), ['label', 'note', 'interval', 'unit', 'after', 'reference', 'window_before', 'window_after']);
  assert.equal(dados.visits[2].interval, '14');
  assert.doesNotMatch(raw, /98765|12345|confidencial/);
});

test('leitor aceita ponto e vírgula, campos entre aspas e quebras de linha na célula', () => {
  const visits = [{ label: 'V1, com vírgula', note: 'Linha 1\nLinha "2"', after: 'Por demanda', before: 0, later: 0 }];
  assert.equal(extract(poloCsv(visits)).visits[0].note, 'Linha 1\nLinha "2"');
  assert.equal(extract(poloCsv(singleAnchorVisits(), ';')).visits.length, 7);
});

test('leitor recusa arquivo que não é a exportação original', () => {
  assert.throws(() => parser.soaPoloExtrair_('a,b\n1,2\n'), /não parece ser a exportação/);
  assert.throws(() => parser.soaPoloExtrair_('PK\u0003\u0004 planilha'), /arquivo CSV/);
  assert.throws(() => parser.soaPoloExtrair_('Nome da Visita,Caf�'), /arquivo CSV/);
  assert.throws(() => parser.soaPoloExtrair_('x,Nome da Visita,V1\n'), /não traz a linha/);
});

test('referência única: a primeira visita vira marco e as demais contam a partir dela', () => {
  const { s, p } = fixture();
  const r = s.validarImportacaoSoA(p);
  assert.equal(r.podeImportar, true, JSON.stringify(r.alertas));
  const c1 = byCode(r, 'C1'), c2 = byCode(r, 'C2');
  assert.equal(c1.papelCronograma, 'MARCO_CALCULO');
  assert.equal(c1.janelaDiasMenos, '', 'janela 0/0 de Por demanda não é tolerância zero');
  assert.equal(c2.referencia, c1.idSoA);
  assert.equal(c2.intervaloDias, 14);
  assert.equal(c2.janelaDiasMenos, 1);
  assert.equal(c2.janelaDiasMais, 3);
  assert.equal(c2.baseCalculo, '', 'a base é herdada do protocolo');
  assert.equal(c2.nome, 'Ciclo 2');
  assert.deepEqual(Array.from(c2.aliases), ['Cycle 2', 'Ciclo 2 / Cycle 2']);
});

test('encerramento e acompanhamento ficam manuais, com a regra do Polo preservada', () => {
  const { s, p } = fixture();
  const r = s.validarImportacaoSoA(p);
  const eot = byCode(r, 'EOT');
  assert.equal(eot.papelCronograma, 'NAO_PARTICIPA_CALCULO');
  assert.equal(eot.intervaloDias, '');
  assert.equal(eot.referencia, '');
  assert.match(eot.observacoes, /após Visita Ciclo 1 \/ Cycle 1, intervalo 364 Dia\(s\), janela −7\/\+7/);
  assert.match(eot.observacoes, /confira a referência com o protocolo/);
});

test('intervalo fora de sequência bloqueia e não é corrigido sozinho', () => {
  const visits = singleAnchorVisits();
  visits.splice(4, 0, fixed('Ciclo 4 / Cycle 4', 28));
  const { s, p } = fixture(visits);
  const r = s.validarImportacaoSoA(p);
  assert.equal(r.podeImportar, false);
  assert.ok(r.alertas.some(item => /C4 cai no dia 28, sem avançar em relação a C3/.test(item)), JSON.stringify(r.alertas));
  assert.equal(byCode(r, 'C4').intervaloDias, 28);
});

test('referências encadeadas: ordena pelo dia calculado e aceita marcos especiais', () => {
  const { s, p } = fixture(chainedVisits());
  const r = s.validarImportacaoSoA(p);
  assert.equal(r.podeImportar, true, JSON.stringify(r.alertas));
  const order = r.visitas.slice().sort((a, b) => a.ordem - b.ordem).map(visit => visit.codigo);
  assert.deepEqual(Array.from(order.slice(0, 5)), ['SCREENING', 'C1D1', 'C2D1', 'C2D8', 'C3D1']);
  assert.equal(byCode(r, 'C1D1').referencia, 'RANDOMIZACAO');
  assert.equal(byCode(r, 'C3D1').referencia, byCode(r, 'C2D1').idSoA);
  assert.equal(byCode(r, 'C2D8').referencia, byCode(r, 'C2D1').idSoA);
});

test('janela negativa, acompanhamento e nome bilíngue seguem as regras do arquivo', () => {
  const { s, p } = fixture(chainedVisits());
  const r = s.validarImportacaoSoA(p);
  const triagem = byCode(r, 'SCREENING');
  assert.equal(triagem.nome, 'Triagem');
  assert.equal(triagem.schedulingMode, 'manual');
  assert.match(triagem.observacoes, /janela −28\/\+-1/);
  const safety = byCode(r, 'SFU');
  assert.equal(safety.nome, 'Acompanhamento de Segurança');
  assert.equal(safety.schedulingMode, 'manual');
  assert.match(safety.observacoes, /30 dias após a última dose/);
  assert.match(safety.observacoes, /após Fim do tratamento, intervalo 30/);
  assert.match(byCode(r, 'LTFU').observacoes, /janela −7\/\+7/);
});

test('nota de faturamento não vira observação clínica', () => {
  const { s, p } = fixture(chainedVisits());
  const visit = byCode(s.validarImportacaoSoA(p), 'C2D4');
  assert.equal(visit.nome, 'C2 (D4 do Escalonamento de cada semana)');
  assert.doesNotMatch(visit.observacoes, /Invoiceable/);
});

test('o nome do braço é obrigatório e vincula as visitas', () => {
  const { s, p } = fixture();
  assert.throws(() => s.validarImportacaoSoA({ ...p, braco: '  ' }), /Informe o nome do braço/);
  assert.throws(() => s.validarImportacaoSoA({ ...p, braco: 'x'.repeat(121) }), /até 120 caracteres/);
  assert.equal(s.validarImportacaoSoA({ ...p, braco: '=HYPERLINK(1)' }).podeImportar, false);
  const r = s.validarImportacaoSoA(p);
  assert.deepEqual(Array.from(r.missingBracos), ['Braço A']);
  assert.deepEqual(Array.from(byCode(r, 'C2').bracoNomes), ['Braço A']);
});

test('aplicação cria o braço, arquiva sem valores e repetir o arquivo não duplica', () => {
  const { s, p } = fixture();
  const result = apply(s, p);
  assert.equal(result.adicionadas, 7);
  assert.equal(result.bracosCriados, 1);
  const arm = s.getBracosProjeto('Estudo local')[0];
  const visits = s.getSoAVisitasProjeto('Estudo local');
  assert.equal(visits.length, 7);
  assert.ok(visits.every(visit => visit.bracoIds.length === 1 && visit.bracoIds[0] === arm.idBraco));
  assert.equal(visits.find(visit => visit.codigo === 'C2').referencia, visits.find(visit => visit.codigo === 'C1').idSoA);
  assert.doesNotMatch(JSON.stringify(s.carregarPlanejamentoSoA('Estudo local', result.planejamentoId).dados), /98765|12345/);
  const again = apply(s, p);
  assert.equal(again.adicionadas, 0);
  assert.equal(again.ignoradas, 7);
  assert.equal(s.getSoAVisitasProjeto('Estudo local').length, 7);
});

test('o mesmo arquivo em outro braço cria visitas próprias com referências do próprio braço', () => {
  const { s, p } = fixture();
  apply(s, p);
  apply(s, { ...p, braco: 'Braço B' });
  const visits = s.getSoAVisitasProjeto('Estudo local');
  assert.equal(visits.length, 14);
  const arms = s.getBracosProjeto('Estudo local');
  assert.equal(arms.length, 2);
  arms.forEach(arm => {
    const own = visits.filter(visit => visit.bracoIds[0] === arm.idBraco);
    assert.equal(own.find(visit => visit.codigo === 'C2').referencia, own.find(visit => visit.codigo === 'C1').idSoA);
  });
});

test('modo atualizar mantém o ID e aplica a nova regra', () => {
  const { s, p } = fixture();
  apply(s, p);
  const before = s.getSoAVisitasProjeto('Estudo local').find(visit => visit.codigo === 'C2');
  const visits = singleAnchorVisits();
  visits[2].later = 5;
  const changed = { ...p, dados: extract(poloCsv(visits)), modo: 'atualizar' };
  apply(s, changed);
  const after = s.getSoAVisitasProjeto('Estudo local').find(visit => visit.codigo === 'C2');
  assert.equal(after.idSoA, before.idSoA);
  assert.equal(after.janelaDiasMais, 5);
});

test('visita já cadastrada é reconhecida por nome ou alias e mantém identidade e escopo', () => {
  const { s, p } = fixture();
  s.getSoAVisitasProjeto = () => [
    { idSoA: 'SOA-1', codigo: 'C2D1', nome: 'Ciclo 2', aliases: '', bracoIds: [] },
    { idSoA: 'SOA-2', codigo: 'V3', nome: 'Terceiro ciclo', aliases: 'Cycle 3; outro nome', bracoIds: [] }
  ];
  const r = s.validarImportacaoSoA({ ...p, modo: 'atualizar' });
  const c2 = r.visitas.find(visit => visit.idSoA === 'SOA-1');
  assert.equal(c2.existente, true);
  assert.equal(c2.codigo, 'C2D1');
  assert.deepEqual(Array.from(c2.bracoIds), []);
  assert.equal(r.visitas.find(visit => visit.idSoA === 'SOA-2').nome, 'Terceiro ciclo');
  assert.equal(r.novasVisitas, 5);
  assert.ok(r.alertas.some(item => /2 visita\(s\) já cadastrada\(s\) para todos os braços continuam comuns/.test(item)));
});

test('sem base no protocolo, referência a marco não exige escolha e grava a visita calculável', () => {
  const { s, p } = fixture();
  s.getProjetoBaseCalculoPadrao_ = () => '';
  const r = s.validarImportacaoSoA(p);
  assert.equal(r.podeImportar, true, JSON.stringify(r.alertas));
  assert.equal(byCode(r, 'C2').baseCalculo, 'MANTER_DATAS_PREVISTAS');
  assert.equal(byCode(r, 'C1').baseCalculo, '', 'o marco precisa continuar datado pela própria realização');
  assert.equal(byCode(r, 'EOT').baseCalculo, '');
});

test('sem base no protocolo, visitas encadeadas exigem a escolha na importação', () => {
  const { s, p } = fixture(chainedVisits());
  s.getProjetoBaseCalculoPadrao_ = () => '';
  const r = s.validarImportacaoSoA(p);
  assert.equal(r.podeImportar, false);
  assert.ok(r.alertas.some(item => /Escolha a Contagem das datas/.test(item)));
  assert.throws(() => s.importarSoAJson({ ...p, confirmarRevisaoPlanejamento: true, fingerprintPlanejamento: r.fingerprint }), /Planejamento pendente/);
  const chosen = s.validarImportacaoSoA({ ...p, baseCalculo: 'RECALCULAR_VISITA_REALIZADA' });
  assert.equal(chosen.podeImportar, true, JSON.stringify(chosen.alertas));
  assert.equal(byCode(chosen, 'C3D1').baseCalculo, 'RECALCULAR_VISITA_REALIZADA');
  assert.equal(byCode(chosen, 'SFU').baseCalculo, '', 'visita manual não recebe base');
});

test('a escolha na importação prevalece sobre a base do protocolo e invalida a prévia', () => {
  const { s, p } = fixture(chainedVisits());
  assert.equal(byCode(s.validarImportacaoSoA(p), 'C3D1').baseCalculo, '', 'sem escolha, herda o protocolo');
  const r = s.validarImportacaoSoA({ ...p, baseCalculo: 'RECALCULAR_VISITA_REALIZADA' });
  assert.equal(byCode(r, 'C3D1').baseCalculo, 'RECALCULAR_VISITA_REALIZADA');
  assert.throws(() => s.importarSoAJson({ ...p, confirmarRevisaoPlanejamento: true, fingerprintPlanejamento: r.fingerprint }), /Valide novamente/);
  assert.throws(() => s.validarImportacaoSoA({ ...p, baseCalculo: 'OUTRA' }), /Contagem das datas inválida/);
});

test('valores desconhecidos bloqueiam em vez de serem adivinhados', () => {
  for (const [change, message] of [
    [{ after: 'Consentimento' }, /Valor não reconhecido em "Após"/],
    [{ reference: 'Ciclo 99' }, /Visita de referência não encontrada/],
    [{ interval: '' }, /Informe o intervalo/],
    [{ interval: '14,5' }, /Número inválido/]
  ]) {
    const visits = singleAnchorVisits();
    Object.assign(visits[2], change);
    const { s, p } = fixture(visits);
    const r = s.validarImportacaoSoA(p);
    assert.equal(r.podeImportar, false);
    assert.ok(r.alertas.some(item => message.test(item)), JSON.stringify(r.alertas));
  }
});

test('unidade em semanas é convertida e outra unidade fica manual', () => {
  const visits = singleAnchorVisits();
  visits[2].interval = 2;
  visits[2].unit = 'Semana(s)';
  visits[3].unit = 'Mês(es)';
  const { s, p } = fixture(visits);
  const r = s.validarImportacaoSoA(p);
  assert.equal(byCode(r, 'C2').intervaloDias, 14);
  assert.equal(byCode(r, 'C3').schedulingMode, 'manual');
});

test('servidor recusa campo fora do contrato e versão desconhecida', () => {
  const { s, p } = fixture();
  const dados = JSON.parse(JSON.stringify(p.dados));
  dados.visits[0].valor = '1000';
  assert.throws(() => s.validarImportacaoSoA({ ...p, dados }), /campo de visita não suportado/);
  assert.throws(() => s.validarImportacaoSoA({ ...p, dados: { ...p.dados, schema_version: '2.0.0' } }), /Versão de exportação/);
});

test('prévia desatualizada pelo braço não pode ser aplicada', () => {
  const { s, p } = fixture();
  const preview = s.validarImportacaoSoA(p);
  assert.throws(() => s.importarSoAJson({ ...p, braco: 'Braço B', confirmarRevisaoPlanejamento: true, fingerprintPlanejamento: preview.fingerprint }), /Valide novamente/);
});
