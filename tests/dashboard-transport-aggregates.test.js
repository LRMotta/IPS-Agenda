'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardAgendaFixture } = require('./helpers/dashboard-agenda-fixture');
const { FakeSheet } = require('./helpers/fake-spreadsheet');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const f = dashboardAgendaFixture();
  f.rows.splice(0);
  function event(data, status, slots, values = {}) {
    const row = f.row(data, 'Visita', status, values);
    ['c1', 'c2', 'c3'].forEach((key, index) => {
      const cfg = f.server.AGENDA_CFG.idx[key], slot = slots[index] || {};
      row[cfg.nome] = slot.nome || '';
      row[cfg.status] = slot.status || '';
      row[cfg.destino] = slot.destino || '';
      row[cfg.material] = slot.material || '';
    });
    f.rows.push(row);
    return row;
  }
  function summary() {
    f.sheet.rows.splice(1, f.sheet.rows.length - 1, ...f.rows);
    return plain(f.server.getAgendaDashboardResumo_());
  }
  return { ...f, event, summary };
}

test('couriers e destinos contam transportes pelo status individual e consolidam Pinex', () => {
  const f = fixture();
  f.event('01/02/2026', 'Realizado', [
    { nome: 'Pinex (Agendamento)', status: 'Agendado', destino: 'Lab A' },
    { nome: 'Pinex', status: 'Enviado', destino: 'Lab A' },
    { nome: 'Marken', status: 'Entregue', destino: 'Lab B' }
  ]);
  f.event('02/02/2026', 'Agendado', [
    { nome: 'Pinex', status: 'Não Agendado', destino: 'Lab A' },
    { nome: 'Pinex', status: 'Confirmado', destino: 'Lab B' },
    { nome: 'Ocasa', status: 'Cancelado', destino: 'Lab C' }
  ]);
  f.event('03/02/2026', 'Realizado', [
    { nome: 'Ocasa', status: '', destino: '' },
    { nome: 'DHL', status: 'Não enviado', destino: 'Lab A' },
    { nome: 'N/A', status: 'Enviado', destino: 'Lab A' }
  ]);
  f.event('04/02/2026', 'Realizado', [
    { nome: 'Ocasa', status: 'Não aplicável', destino: 'Lab C' }
  ]);
  const summary = f.summary();
  const couriers = [
    { label: 'Pinex', value: 4, realizados: 1, previstos: 3 },
    { label: 'DHL', value: 1, realizados: 0, previstos: 1 },
    { label: 'Marken', value: 1, realizados: 1, previstos: 0 },
    { label: 'Ocasa', value: 1, realizados: 0, previstos: 1 }
  ];
  const labs = [
    { label: 'Lab A', value: 4, realizados: 1, previstos: 3 },
    { label: 'Lab B', value: 2, realizados: 1, previstos: 1 },
    { label: 'Destino não identificado na Agenda', value: 1, realizados: 0, previstos: 1 }
  ];
  assert.deepEqual(summary.courierUsoAno, couriers);
  assert.deepEqual(summary.transporteLaboratoriosAno, labs);
  for (const period of [summary.periodos.global, summary.periodos.anos['2026'], summary.periodos.meses['2026-2']]) {
    assert.deepEqual(period.couriers, couriers);
    assert.deepEqual(period.transportLabs, labs);
    for (const field of ['value', 'realizados', 'previstos']) {
      assert.equal(period.transportLabs.reduce((sum, item) => sum + item[field], 0),
        period.couriers.reduce((sum, item) => sum + item[field], 0), field);
    }
  }
  assert.equal(summary.periodos.version, 1);
  assert.equal(f.reads(), 1);
  assert.equal(f.sheet.writes, 0);
  assert.equal(summary.eventosPeriodo, undefined);
  assert.equal(JSON.stringify(summary).includes('cadastro:p1'), false);
  assert.equal(f.rows[0][f.server.AGENDA_CFG.idx.c1.nome], 'Pinex (Agendamento)');
});

test('destino ausente na Agenda preserva o histórico sem afirmar agendamento sem destino ou inferir laboratório', () => {
  const f = fixture();
  f.event('06/01/2026', 'Realizado', [
    { nome: 'Marken', status: 'Entregue' },
    { nome: 'Marken', status: 'Enviado', destino: 'Lab A' }
  ]);
  f.event('07/01/2026', 'Agendado', [{ nome: 'Marken', status: 'Agendado', destino: '   ' }]);
  const summary = f.summary();
  const missing = { label: 'Destino não identificado na Agenda', value: 2, realizados: 1, previstos: 1 };
  for (const ranking of [summary.transporteLaboratoriosAno, summary.periodos.global.transportLabs,
    summary.periodos.anos['2026'].transportLabs, summary.periodos.meses['2026-1'].transportLabs]) {
    assert.deepEqual(ranking.find(item => item.label === missing.label), missing);
    assert.deepEqual(ranking.find(item => item.label === 'Lab A'), { label: 'Lab A', value: 1, realizados: 1, previstos: 0 });
    assert.equal(ranking.reduce((total, item) => total + item.value, 0), 3);
    assert.equal(ranking.some(item => item.label === 'Sem destino informado'), false);
  }
  assert.equal(f.sheet.writes, 0);
  assert.equal(f.reads(), 1);
  assert.equal(f.rows[0][f.server.AGENDA_CFG.idx.c1.destino], '');
});

test('fallback usa a descrição do mesmo slot, prioriza destino explícito e lê cadastro uma vez por consulta sem escrever', () => {
  const f = fixture();
  const labs = new FakeSheet('LabCentral', [['ID', 'Nome', '', '', 'Cidade'],
    ['a', 'LABCORP (INDIANAPOLIS)', '', '', 'Indianapolis, IN'],
    ['b', 'LABCORP (TORRANCE)', '', '', 'Torrance, CA'],
    ['c', 'PPD GLOBAL (HIGHLAND HEIGHTS)', '', '', 'Highland Heights, KY']]);
  let reads = 0;
  const range = labs.getRange.bind(labs);
  labs.getRange = (...args) => { reads++; return range(...args); };
  f.server.getCodexSpreadsheet_ = () => ({ getSheetByName: name => name === 'LabCentral' ? labs : null });
  f.event('06/01/2026', 'Realizado', [
    { nome: 'Marken', status: 'Entregue', material: 'Labcorp Indianápolis - Serum: 2 x 1 mL' },
    { nome: 'Marken', status: 'Entregue', material: 'FROZEN Serum: 2 x 1 mL' },
    { nome: 'Ocasa', status: 'Enviado', material: 'Envio OCASA - PPD Laboratories' }
  ]);
  f.event('07/01/2026', 'Agendado', [
    { nome: 'Marken', status: 'Agendado', destino: 'Destino explícito', material: 'Labcorp Indianápolis' },
    { nome: 'Marken', status: 'Agendado', material: 'Labcorp - Frozen' }
  ]);
  const summary = f.summary();
  assert.equal(reads, 1);
  assert.equal(labs.writes, 0);
  assert.equal(f.sheet.writes, 0);
  assert.equal(f.rows[0][f.server.AGENDA_CFG.idx.c1.destino], '');
  for (const ranking of [summary.transporteLaboratoriosAno, summary.periodos.global.transportLabs,
    summary.periodos.anos['2026'].transportLabs, summary.periodos.meses['2026-1'].transportLabs]) {
    assert.equal(ranking.find(item => item.label === 'LABCORP (INDIANAPOLIS)').realizados, 1);
    assert.equal(ranking.find(item => item.label === 'PPD GLOBAL (HIGHLAND HEIGHTS)').realizados, 1);
    assert.equal(ranking.find(item => item.label === 'Destino explícito').previstos, 1);
    assert.equal(ranking.find(item => item.label === 'Destino não identificado na Agenda').value, 2);
    assert.equal(ranking.reduce((sum, item) => sum + item.value, 0), 5);
  }
  f.summary();
  assert.equal(reads, 2, 'o cadastro é relido na próxima consulta');
});

test('resolução histórica rejeita duas marcas, cidades ambíguas e correspondência parcial', () => {
  const f = fixture();
  const labs = [
    { nomeAbreviado: 'IQVIA (VALENCIA)', cidade: 'Valencia' },
    { nomeAbreviado: 'IQVIA (MARIETTA)', cidade: 'Marietta' },
    { nomeAbreviado: 'DASA (BARUERI)', cidade: 'Barueri' }
  ];
  const resolve = text => f.server.agendaDashboardDestinoMaterial_(text, labs);
  assert.equal(resolve('1) IQVIA- VALÊNCIA - MARKEN'), 'IQVIA (VALENCIA)');
  assert.equal(resolve('DASA Barueri'), 'DASA (BARUERI)');
  for (const text of ['IQVIA', 'IQVIA Valencia e Marietta', 'IQVIA Valencia / DASA Barueri', 'XIQVIA Valencia', 'Serum: 2 mL']) {
    assert.equal(resolve(text), '', text);
  }
  assert.equal(f.server.agendaDashboardDestinoMaterial_('DASA Barueri', []), '');
});

test('cadastro ausente ou indisponível mantém destino desconhecido sem impedir resumo', () => {
  const f = fixture();
  f.server.Logger = { log() {} };
  f.event('06/01/2026', 'Realizado', [{ nome: 'Marken', status: 'Entregue', material: 'Labcorp Indianápolis' }]);
  for (const getSheetByName of [() => null, () => { throw new Error('indisponível'); }]) {
    f.server.getCodexSpreadsheet_ = () => ({ getSheetByName });
    assert.equal(f.summary().transporteLaboratoriosAno[0].label, 'Destino não identificado na Agenda');
  }
  assert.equal(f.sheet.writes, 0);
});

test('previstos incluem datas futuras; envio explícito independe do status e data da visita', () => {
  const f = fixture();
  const slot = status => [{ nome: 'Marken', status, destino: 'Lab A' }];
  f.event('03/10/2026', 'Agendado', slot('Enviado'));
  f.event('04/10/2026', 'Agendado', slot('Entregue'));
  f.event('05/10/2026', 'Agendado', slot('Confirmado'));
  f.event('06/01/2027', 'Agendado', slot('Agendado'));
  f.event('01/02/2026', 'Cancelado', slot('Enviado'));
  f.event('02/02/2026', 'Reagendado', slot('Entregue'));
  f.event('03/02/2026', 'Realizado', slot('Enviado'), { labCentral: 'Não' });
  f.event('04/02/2026', 'Realizado', slot('Enviado'), { tipo: 'Monitoria' });
  const summary = f.summary();
  assert.deepEqual(summary.periodos.global.couriers, [{ label: 'Marken', value: 4, realizados: 2, previstos: 2 }]);
  assert.deepEqual(summary.courierUsoAno, [{ label: 'Marken', value: 3, realizados: 2, previstos: 1 }]);
  assert.deepEqual(summary.periodos.anos['2027'].transportLabs, [{ label: 'Lab A', value: 1, realizados: 0, previstos: 1 }]);
  assert.deepEqual(summary.periodos.meses['2026-2'].couriers, []);
  assert.equal(summary.visitasRealizadasAno, 1);
  assert.equal(summary.cancelReagPorProtocolo[0].value, 2);
  for (const period of [summary.periodos.global, ...Object.values(summary.periodos.anos), ...Object.values(summary.periodos.meses)]) {
    for (const field of ['value', 'realizados', 'previstos']) {
      assert.equal(period.transportLabs.reduce((sum, item) => sum + item[field], 0),
        period.couriers.reduce((sum, item) => sum + item[field], 0), field);
    }
  }
});

test('limite dos rankings preserva totais de realizados e previstos em Outros', () => {
  const f = fixture();
  for (let n = 0; n < 15; n++) {
    f.event('01/02/2026', 'Realizado', [{ nome: 'Courier ' + n, status: n % 2 ? 'Enviado' : '', destino: 'Lab ' + n }]);
  }
  const summary = f.summary();
  for (const ranking of [summary.courierUsoAno, summary.transporteLaboratoriosAno]) {
    assert.equal(ranking.length, 12);
    assert.equal(ranking.at(-1).label, 'Outros');
    assert.equal(ranking.at(-1).value, 4);
    assert.equal(ranking.reduce((total, item) => total + item.value, 0), 15);
    assert.equal(ranking.reduce((total, item) => total + item.realizados, 0), 7);
    assert.equal(ranking.reduce((total, item) => total + item.previstos, 0), 8);
  }
});

test('Agenda vazia entrega ambos rankings vazios em todos os contratos', () => {
  const f = fixture(), summary = f.summary();
  assert.deepEqual(summary.courierUsoAno, []);
  assert.deepEqual(summary.transporteLaboratoriosAno, []);
  assert.deepEqual(summary.periodos.global.couriers, []);
  assert.deepEqual(summary.periodos.global.transportLabs, []);
  assert.equal(f.reads(), 0);
});
