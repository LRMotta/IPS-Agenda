'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture(status = 'Não agendado', awb = '123') {
  const row = ['DHL', status, awb, 'Agendado'];
  let invalidations = 0;
  const s = runFile('TransporteCodexConfig.gs', {
    AGENDA_CFG: { idx: { c1: { nome: 0, status: 1, awb: 2 } }, col: { status: 4 } },
    AgendaServerRules_: { isCancelled: v => v === 'Cancelado', courierStatusKey: v => String(v).normalize('NFD').replace(/[\u0300-\u036f\s]/g, '').toLowerCase() },
    normText_: v => String(v || '').toLowerCase(), normalizarAwbCourier_: v => String(v || ''),
    getAgendaSheet_: () => ({ getLastColumn: () => 4, getRange: (_line, col, count) => count ? { getDisplayValues: () => [row] } : { setValue: v => { row[col - 1] = v; } } }),
    encontrarLinhaPorId: () => 2, agendaInvalidateDateIndexCache_: () => { invalidations++; }
  });
  return { row, s, sync: result => s.transporteMarcarDocsGeradosAgenda_({ idAgenda: 'EVENT', agendaSlot: '1', awb: '123', courier: 'DHL' }, result), invalidations: () => invalidations };
}
const pdf = { type: 'pdf', fileId: 'PDF' };

test('PDF confirmado promove somente transporte correspondente e invalida cache; repetir é idempotente', () => {
  const f = fixture();
  assert.equal(f.sync(pdf).atualizado, true);
  assert.equal(f.row[1], 'Docs gerados');
  assert.equal(f.invalidations(), 1);
  assert.equal(f.sync(pdf), null);
  assert.equal(f.invalidations(), 1);
});

test('falha ou resultado sem ID confirmado não promove; AWB divergente também não', () => {
  for (const result of [null, 'Erro no PDF', { type: 'pdf' }]) {
    const f = fixture(); assert.equal(f.sync(result), null); assert.equal(f.row[1], 'Não agendado');
  }
  const f = fixture('Não agendado', '456'); assert.equal(f.sync(pdf), null); assert.equal(f.row[1], 'Não agendado');
});

test('regeneração preserva estados posteriores e evento cancelado', () => {
  for (const status of ['Docs gerados', 'Agendado', 'Confirmado', 'Enviado', 'Entregue']) {
    const f = fixture(status); assert.equal(f.sync(pdf), null); assert.equal(f.row[1], status);
  }
  const f = fixture(); f.row[3] = 'Cancelado'; assert.equal(f.sync(pdf), null);
});
