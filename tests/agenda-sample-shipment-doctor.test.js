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
  test(method + ' grava Envio de amostras sem medico mesmo com valor recebido no payload', () => {
    const { c, i, sheet, payload, audits } = setup();
    Object.assign(payload, { tipo: 'Envio de Amostras', medico: 'Médico recebido', labCentral: 'Nao', servTerc: '', courier1: {}, courier2: {}, courier3: {}, backup: {} });
    assert.equal(c[method](payload).ok, true);
    const row = method === 'atualizarAgendaEventoCompleto' ? 1 : 2;
    assert.equal(sheet.rows[row][i.medico], '');
    if (method === 'atualizarAgendaEventoCompleto') {
      assert.ok(audits.some(entry => entry[3].some(change => change.field === 'Médico' && change.newValue === '')));
    }
  });
}

test('edicao de envio legado limpa medico apenas no salvamento e revalida depois do merge', () => {
  const f = setup();
  f.sheet.rows[1][f.i.tipo] = 'Envio de amostras';
  const event = f.c.agendaRowToObject_(f.sheet.rows[1], 2);
  assert.equal(event.medico, 'Médico original');
  assert.equal(f.sheet.writes, 0, 'leitura preserva o historico');
  Object.assign(f.payload, f.c.agendaMergePayloadFromEvent_(event), {
    _recordVersion: event.recordVersion,
    _editRecordVersion: event.editRecordVersion,
    _editMergeToken: f.c.agendaIssueMergeToken_(f.sheet.rows[1], event)
  });
  f.payload.obs = 'Observação atualizada';
  f.sheet.rows[1][f.i.medico] = 'Médico remoto';
  const result = f.c.atualizarAgendaEventoCompleto(f.payload);
  assert.equal(result.ok, true);
  assert.equal(result.merged, true);
  assert.equal(f.sheet.rows[1][f.i.medico], '');
  assert.equal(f.sheet.rows[1][f.i.obs], 'Observação atualizada');
});

test('Visita e Consulta continuam aceitando medico e Consulta continua exigindo seu preenchimento', () => {
  for (const tipo of ['Visita', 'Consulta']) {
    const { c, i, sheet, payload } = setup();
    Object.assign(payload, { tipo, medico: 'Médico escolhido' });
    assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true);
    assert.equal(sheet.rows[1][i.medico], 'Médico escolhido');
  }
  const { c, sheet, payload } = setup();
  Object.assign(payload, { tipo: 'Consulta', medico: '' });
  assert.match(c.atualizarAgendaEventoCompleto(payload).erro, /médico responsável/);
  assert.equal(sheet.writes, 0);
});
