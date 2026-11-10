'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardAgendaFixture } = require('./helpers/dashboard-agenda-fixture');

function fixture() {
  const f = dashboardAgendaFixture();
  f.sheet.rows.splice(1);
  f.server.getAgendaFeriadosPendenciasMap_ = () => ({ '2026-10-05': true });
  f.server.transporteDocumentosSemEnvioPendencias_ = () => [];
  const calls = [];
  const deadline = f.server.prazoHorasPendenciaAgenda_;
  f.server.prazoHorasPendenciaAgenda_ = (date, time, holidays) => {
    calls.push({ date, time });
    return deadline(date, time, holidays);
  };
  function add(id, date, status, configure = () => {}) {
    const r = f.row(date, 'Visita', status, { id, hora: '09:00', participante: 'Pessoa' });
    r[f.server.AGENDA_CFG.idx.c1.nome] = '';
    r[f.server.AGENDA_CFG.idx.c2.nome] = '';
    configure(r, f.server.AGENDA_CFG.idx);
    f.sheet.rows.push(r);
  }
  return { ...f, calls, deadline, add };
}

test('histórico sem pendências não calcula prazos, mesmo com mil eventos', () => {
  const f = fixture();
  for (let n = 0; n < 1000; n++) f.add(String(n), '01/01/2020', n % 2 ? 'Concluído' : 'Realizado');
  const result = f.server.getDashboardPendencias_([]);
  assert.equal(Object.values(result.counts).every(count => count === 0), true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sheet.writes, 0);
});

test('prazo é calculado uma vez por linha com pendências e preserva feriado, horário e formato', () => {
  const f = fixture();
  f.add('00012', '06/10/2026', 'Agendado', (r, i) => {
    r[i.servTerc] = 'Laboratório';
    r[i.c1.nome] = 'OCASA'; r[i.c1.status] = 'Não Agendado';
    r[i.c2.nome] = 'Marken'; r[i.c2.status] = 'Agendado';
    r[i.cb.nome] = 'OCASA'; r[i.cb.status] = 'Não Agendado'; r[i.cb.temp] = '-80';
  });
  const result = f.server.getDashboardPendencias_([]);
  assert.equal(f.calls.length, 1);
  const expected = f.deadline('06/10/2026', '09:00', { '2026-10-05': true });
  for (const group of ['courierNaoAgendada', 'courierNaoConfirmada', 'transporteBackupNaoAgendado', 'requisicaoExamesPendente']) {
    assert.equal(result[group].length, 1, group);
    assert.equal(result[group][0].agendaId, '00012');
    assert.equal(result[group][0].prazoHoras, expected);
    assert.equal(result[group][0].data, '06/10/2026');
    assert.equal(result[group][0].hora, '09:00');
  }
});

test('Backup e AWB de histórico concluído mantêm prazo; pós-visita e cancelados não exigem cálculo', () => {
  const f = fixture();
  f.add('backup', '01/01/2020', 'Concluído', (r, i) => {
    r[i.cb.nome] = 'OCASA'; r[i.cb.status] = 'Não Agendado';
    r[i.c1.nome] = 'OCASA'; r[i.c1.status] = 'Enviado'; r[i.c1.awb] = '000123';
  });
  f.add('post', '01/10/2026', 'Realizado');
  f.add('cancel', '06/10/2026', 'Cancelado', (r, i) => {
    r[i.cb.nome] = 'OCASA'; r[i.cb.status] = 'Não Agendado';
  });
  const result = f.server.getDashboardPendencias_([]);
  assert.equal(result.transporteBackupNaoAgendado[0].agendaId, 'backup');
  assert.equal(result.awbEnviadaNaoEntregue[0].awb, '000123');
  assert.equal(result.transporteBackupNaoAgendado[0].prazoHoras, result.awbEnviadaNaoEntregue[0].prazoHoras);
  assert.equal(result.posVisitaPoloTrialPendente[0].agendaId, 'post');
  assert.equal(result.posVisitaEcrfPendente[0].agendaId, 'post');
  assert.equal(f.calls.length, 1);
});

test('couriers sem ação e datas inválidas preservam elegibilidade e prazo nulo', () => {
  const f = fixture();
  f.add('ok', '06/10/2026', 'Agendado', (r, i) => {
    r[i.c1.nome] = 'OCASA'; r[i.c1.status] = 'Entregue';
    r[i.c2.nome] = 'OCASA'; r[i.c2.status] = 'Confirmado';
  });
  f.add('invalid', 'inválida', 'Concluído', (r, i) => {
    r[i.cb.nome] = 'OCASA'; r[i.cb.status] = 'Não Agendado';
  });
  const result = f.server.getDashboardPendencias_([]);
  assert.equal(result.courierNaoAgendada.length, 0);
  assert.equal(result.courierNaoConfirmada.length, 0);
  assert.equal(result.transporteBackupNaoAgendado[0].agendaId, 'invalid');
  assert.equal(result.transporteBackupNaoAgendado[0].prazoHoras, null);
  assert.equal(f.calls.length, 1);
});

test('documentação usa a última linha com ID duplicado e substitui apenas o slot correspondente', () => {
  const f = fixture();
  for (const date of ['06/10/2026', '07/10/2026']) {
    f.add('dup', date, 'Agendado', (r, i) => {
      r[i.c1.nome] = 'OCASA'; r[i.c1.status] = 'Não Agendado'; r[i.c1.awb] = '00123';
      r[i.cb.nome] = 'OCASA'; r[i.cb.status] = 'Não Agendado';
    });
  }
  f.server.transporteDocumentosSemEnvioPendencias_ = () => [
    { agendaId: 'dup', slot: '1', referencia: 'DOC' }, { agendaId: 'dup', slot: 'invalido' }
  ];
  const result = f.server.getDashboardPendencias_([]);
  assert.equal(result.courierNaoAgendada.length, 0);
  assert.equal(result.counts.courierNaoAgendada, 0);
  assert.equal(result.transporteBackupNaoAgendado.length, 2);
  assert.equal(result.documentacaoTransporteSemEnvio.length, 1);
  const doc = result.documentacaoTransporteSemEnvio[0];
  assert.equal(doc.data, '07/10/2026');
  assert.equal(doc.awb, '00123');
  assert.equal(doc.prazoHoras, f.deadline('07/10/2026', '09:00', { '2026-10-05': true }));
  assert.equal(f.calls.length, 3); // Uma por linha; documentos conserva seu cálculo independente.
});

test('documentação gerada depois do pedido de coleta (Agendado) não volta a pedir envio', () => {
  // Caso real de 06/11/2026: DHL congelado com pedido de coleta já identificado (Agendado); o PDF gerado de novo com a
  // WB da resposta é para imprimir. O item segue em "Courier não confirmada", não em "Documentação sem envio".
  const f = fixture();
  f.add('dhl', '06/10/2026', 'Agendado', (r, i) => {
    r[i.c2.nome] = 'DHL'; r[i.c2.temp] = 'Congelado'; r[i.c2.status] = 'Agendado'; r[i.c2.awb] = '4188228590';
  });
  f.server.transporteDocumentosSemEnvioPendencias_ = () => [{ agendaId: 'dhl', slot: '2', referencia: 'DOC' }];
  const result = f.server.getDashboardPendencias_([]);
  assert.equal(result.documentacaoTransporteSemEnvio.length, 0);
  assert.equal(result.counts.documentacaoTransporteSemEnvio, 0);
  assert.equal(result.courierNaoConfirmada.length, 1);
  assert.equal(result.courierNaoConfirmada[0].agendaId, 'dhl');
});

test('Courier não agendada lista todas as pendências, sem janela de dias úteis', () => {
  // Decisão do usuário (09/11/2026): a janela de dias úteis (7, decisão de 10/11/2026) vale só na tela do Transporte (piloto).
  const f = fixture();
  const naoAgendada = (r, i) => { r[i.c1.nome] = 'OCASA'; r[i.c1.status] = 'Não Agendado'; };
  f.add('hoje', '02/10/2026', 'Agendado', naoAgendada);
  f.add('quinto', '12/10/2026', 'Agendado', naoAgendada);
  f.add('sexto', '13/10/2026', 'Agendado', naoAgendada);
  f.add('longe', '30/11/2026', 'Agendado', naoAgendada);
  const result = f.server.getDashboardPendencias_([]);
  assert.deepEqual(Array.from(result.courierNaoAgendada, item => item.agendaId).sort(), ['hoje', 'longe', 'quinto', 'sexto']);
  assert.equal(result.counts.courierNaoAgendada, 4);
  assert.equal(result.courierNaoAgendada.some(item => 'foraDaJanela' in item), false);
  assert.equal('courierNaoAgendadaSeguintes' in result.counts, false);
});
