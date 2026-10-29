'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runHtmlScript } = require('./helpers/load-app-script');
const { dashboardAgendaFixture } = require('./helpers/dashboard-agenda-fixture');
const plain = value => JSON.parse(JSON.stringify(value));
function client(f) {
  const c = vm.createContext({ window: {}, Date: f.Date, AgendaRules: runHtmlScript('SharedAgendaRules.html').AgendaRules,
    document: { readyState: 'loading', addEventListener() {} } });
  vm.runInContext(readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, ''), c);
  return c;
}
function legacyEvents(f) {
  return f.rows.filter(r => f.server.parseAgendaDateAny_(r[f.server.AGENDA_CFG.idx.data]))
    .map(r => f.server.agendaDashboardRowInfo_(r, f.server.AGENDA_CFG.idx, f.server.parseAgendaDateAny_(r[f.server.AGENDA_CFG.idx.data])).evento);
}
test('agregados de Agenda preservam todos os recortes, regras e identidades sem enviar eventos', () => {
  const f = dashboardAgendaFixture(), c = client(f);
  const summary = plain(f.server.getAgendaDashboardResumo_());
  assert.equal(f.reads(), 1);
  assert.equal(f.sheet.writes, 0);
  assert.equal(summary.eventosPeriodo, undefined);
  assert.deepEqual(summary.periodos.anosDisponiveis, [2027, 2026]);
  c._dashAgendaRaw = legacyEvents(f);
  for (const tipo of ['global', 'ano', 'mes']) {
    for (const ano of [2026, 2027, 2028]) {
      for (const mes of [1, 2, 3, 10]) {
        c._dashAgendaPeriod = { tipo, ano, mes };
        c._dashAgendaResumoAtual = {};
        const expected = plain(c.dashboardAggregateAgendaPeriod_());
        c._dashAgendaResumoAtual = summary;
        c.AgendaRules = { countsIn() { assert.fail('Agregado não deve recalcular eventos no navegador'); } };
        assert.deepEqual(plain(c.dashboardAggregateAgendaPeriod_()), expected, `${tipo}/${ano}/${mes}`);
        c.AgendaRules = runHtmlScript('SharedAgendaRules.html').AgendaRules;
      }
    }
  }
  assert.equal(summary.periodos.global.participants, 3);
  assert.equal(summary.periodos.anos['2026'].participants, 3);
  assert.equal(summary.periodos.meses['2026-1'].participants, 1);
  assert.equal(summary.periodos.meses['2026-2'].participants, 3);
  assert.equal(summary.periodos.meses['2026-10'].visits, 1); // Hoje conta; amanhã não.
  // Courier sem status é transporte previsto, mesmo com a visita já realizada.
  assert.equal(summary.periodos.meses['2026-10'].labs, 0);
  assert.equal(summary.periodos.meses['2026-10'].labsPrevistos, 3);
  assert.equal(summary.periodos.meses['2026-10'].monitoringDays, 0);
  assert.equal(summary.periodos.meses['2026-10'].monitoringDaysPrevistos, 1);
  assert.equal(summary.periodos.anos['2027'].labs, 0);
  assert.ok(!JSON.stringify(summary).includes('cadastro:p1'));
});
test('Agenda vazia entrega global zero e mês vazio não reutiliza o ano', () => {
  const f = dashboardAgendaFixture(), c = client(f);
  f.sheet.rows.splice(1);
  const summary = plain(f.server.getAgendaDashboardResumo_());
  assert.equal(f.reads(), 0);
  c._dashAgendaResumoAtual = summary;
  for (const tipo of ['global', 'ano', 'mes']) {
    c._dashAgendaPeriod = { tipo, ano: 2026, mes: 3 };
    assert.equal(c.dashboardAggregateAgendaPeriod_().total, 0);
  }
});
test('global deduplica a mesma participação entre anos e Lab Central exclui futuros do anual', () => {
  const f = dashboardAgendaFixture();
  const BaseDate = f.Date;
  f.server.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [2027, 9, 2, 12])); } };
  const summary = plain(f.server.getAgendaDashboardResumo_());
  assert.equal(summary.periodos.anos['2026'].participants, 3);
  assert.equal(summary.periodos.anos['2027'].participants, 1);
  assert.equal(summary.periodos.global.participants, 3);
  assert.equal(summary.labCentralAno, summary.periodos.anos['2027'].labs);
});
test('rankings mantêm Outros e payload cresce por recorte, não por evento', t => {
  const f = dashboardAgendaFixture(), c = client(f);
  f.rows.splice(0);
  for (let i = 0; i < 1000; i++) f.rows.push(f.row('01/02/2026', 'Visita', 'Realizado', {
    projeto: 'Projeto ' + i % 20, medico: 'Médico ' + i % 15, participanteCadastroId: 'P' + i % 50
  }));
  f.sheet.rows.splice(1, f.sheet.rows.length - 1, ...f.rows);
  const summary = plain(f.server.getAgendaDashboardResumo_());
  c._dashAgendaRaw = legacyEvents(f);
  c._dashAgendaPeriod = { tipo: 'global', ano: 2026, mes: 2 };
  assert.deepEqual(summary.periodos.global, plain(c.dashboardAggregateAgendaPeriod_()));
  assert.equal(summary.periodos.global.protocols.length, 15);
  assert.equal(summary.periodos.global.protocols.at(-1).label, 'Outros');
  const before = Buffer.byteLength(JSON.stringify(c._dashAgendaRaw)), after = Buffer.byteLength(JSON.stringify(summary));
  assert.ok(after < before / 10);
  t.diagnostic(`1000 eventos sintéticos: ${before} bytes de eventos -> ${after} bytes de resumo completo.`);
});
test('Lab Central separa transportes realizados e previstos e ignora reagendados', () => {
  const f = dashboardAgendaFixture();
  const { cfg = f.server.AGENDA_CFG } = {};
  const enviado = f.row('06/01/2026', 'Visita', 'Realizado', { }), reag = f.row('07/01/2026', 'Visita', 'Reagendado');
  enviado[cfg.idx.c1.status] = 'Enviado';
  f.sheet.rows.splice(1, f.sheet.rows.length - 1, enviado, reag, f.row('08/01/2026', 'Visita', 'Realizado'));
  const jan = plain(f.server.getAgendaDashboardResumo_()).periodos.meses['2026-1'];
  assert.equal(jan.labs, 1);
  assert.equal(jan.labsPrevistos, 1);
  assert.deepEqual(jan.labBuckets, [{ label: 'Jan', value: 2, realizados: 1, previstos: 1 }]);
});
test('qualidade dos dados conta visitas sem protocolo ou médico e linhas sem data válida', () => {
  const f = dashboardAgendaFixture(), c = client(f);
  f.rows.splice(0, f.rows.length,
    f.row('06/01/2026', 'Visita', 'Realizado', { projeto: '', medico: '' }),
    f.row('07/01/2026', 'Visita', 'Realizado', { medico: ' ' }),
    f.row('08/01/2026', 'Visita', 'Agendado', { medico: '' }),
    f.row('inválida', 'Visita', 'Realizado'), f.row('', '', '', { projeto: '' }));
  f.sheet.rows.splice(1, f.sheet.rows.length - 1, ...f.rows);
  const summary = plain(f.server.getAgendaDashboardResumo_());
  const ano = summary.periodos.anos['2026'];
  assert.equal(ano.semProtocolo, 1);
  assert.equal(ano.semMedico, 2); // Só visitas realizadas entram nos rankings.
  assert.equal(summary.qualidade.semDataValida, 1); // Linha totalmente vazia não conta.
  assert.deepEqual(ano.doctors.map(d => d.label), ['Sem médico']);
  c._dashAgendaRaw = legacyEvents(f);
  c._dashAgendaPeriod = { tipo: 'ano', ano: 2026, mes: 1 };
  assert.deepEqual(ano, plain(c.dashboardAggregateAgendaPeriod_()));
});
