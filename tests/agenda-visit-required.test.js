'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/agenda-merge-fixture');

function setup() {
  const f = fixture();
  f.c.codexLogPerformance_ = () => {};
  f.c.agendaEmailEnabled_ = () => false;
  f.c.getInfoParticipante = () => null;
  return f;
}

for (const method of ['salvarNovoEventoCompleto', 'salvarNovoEventoComFeriado', 'atualizarAgendaEventoCompleto']) {
  test(method + ' rejeita Visita vazia ou com espacos antes de qualquer escrita', () => {
    for (const visita of [undefined, '', ' \t ']) {
      for (const labCentral of ['Não', 'Sim', 'Não aplicável']) {
        const { c, sheet, payload, audits } = setup();
        Object.assign(payload, { visita, labCentral });
        const before = JSON.stringify(sheet.rows);
        const result = c[method](payload);
        assert.equal(result.erro, 'Informe a visita para eventos do tipo Visita.');
        assert.equal(sheet.writes, 0);
        assert.equal(JSON.stringify(sheet.rows), before);
        assert.equal(audits.length, 0);
      }
    }
  });

  test(method + ' aceita visita livre sem calendario SoA e sem Lab Central', () => {
    const { c, i, sheet, payload } = setup();
    Object.assign(payload, { visita: 'Triagem livre', labCentral: 'Não', servTerc: '', courier1: {}, courier2: {}, courier3: {}, backup: {} });
    assert.equal(c[method](payload).ok, true);
    const row = method === 'atualizarAgendaEventoCompleto' ? 1 : 2;
    assert.equal(sheet.rows[row][i.visita], 'Triagem livre');
  });
}

test('edicao exige Visita ao converter outro tipo e permite corrigir registro legado vazio', () => {
  for (const previousType of ['Consulta', 'Visita']) {
    const { c, i, sheet, payload } = setup();
    sheet.rows[1][i.tipo] = previousType;
    sheet.rows[1][i.visita] = '';
    sheet.rows[1][i.labCentral] = 'Não';
    delete payload._recordVersion;
    Object.assign(payload, { visita: '', labCentral: 'Não' });
    assert.match(c.atualizarAgendaEventoCompleto(payload).erro, /Informe a visita/);
    assert.equal(sheet.writes, 0);
    payload.visita = 'V2';
    assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true);
    assert.equal(sheet.rows[1][i.visita], 'V2');
  }
});

test('outros tipos preservam visita opcional e a exigencia anterior de Lab Central = Sim', () => {
  for (const tipo of ['Consulta', 'Envio de amostras', 'Contato telefônico']) {
    const { c, i, sheet, payload } = setup();
    Object.assign(payload, { tipo, visita: '', labCentral: 'Não' });
    assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true, tipo);
    assert.equal(sheet.rows[1][i.visita], '');
  }
  const { c, sheet, payload } = setup();
  Object.assign(payload, { tipo: 'Envio de amostras', visita: '', labCentral: 'Sim' });
  assert.match(c.atualizarAgendaEventoCompleto(payload).erro, /Laboratorio Central = Sim/);
  assert.equal(sheet.writes, 0);
});
