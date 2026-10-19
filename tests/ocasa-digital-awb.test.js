 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runHtmlScript } = require('./helpers/load-app-script');

test('OCASA digital e obrigatoria em novas entradas; legado somente no mesmo transporte', () => {
  const c = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const s = runFiles(['WebApp.gs']);
  for (const validate of [c.isValidAwbEntry, s.codexCourierIsValidAwbEntry_]) {
    for (const value of ['PK2OZB276947', 'pk2 ozb276947', '']) assert.equal(validate(value, 'OCASA'), true);
    for (const value of ['A1234567', 'PK2OZB27694', 'PK2OZB276947X', 'XXXOZB276947']) assert.equal(validate(value, 'OCASA'), false);
    assert.equal(validate('A1234567', 'OCASA', { nome: 'Ocasa', awb: 'A1234567' }), true);
    assert.equal(validate('B1234567', 'OCASA', { nome: 'Ocasa', awb: 'A1234567' }), false);
    assert.equal(validate('A1234567', 'OCASA', { nome: 'DHL', awb: 'A1234567' }), false);
    assert.equal(validate('1234567890', 'DHL'), true);
  }
  assert.equal(s.codexCourierIsValidOcasaAwb_('A1234567'), true, 'leitura/rastreio legado continuam disponiveis');
  const input = { removeAttribute(name) { delete this[name]; } };
  c.applyToInput(input, 'OCASA', false);
  assert.equal(new RegExp('^' + input.pattern + '$').test('A1234567'), false);
  c.applyToInput(input, 'OCASA', false, { nome: 'OCASA', awb: 'A1234567' });
  assert.equal(new RegExp('^' + input.pattern + '$').test('A1234567'), true);
  assert.equal(new RegExp('^' + input.pattern + '$').test('B1234567'), false);
});

test('Agenda revalida OCASA antes da reserva de AWB nos tres slots', () => {
  const s = runFiles(['WebApp.gs']);
  let reservations = 0;
  s.agendaAwbContexto_ = () => ({ current: {} });
  s.agendaAwbRegistro_ = () => ({});
  s.agendaAwbReservar_ = () => { reservations++; return []; };
  for (const slot of [1, 2, 3]) {
    const idx = s.AGENDA_CFG.idx['c' + slot];
    const row = [];
    row[idx.nome] = 'OCASA'; row[idx.awb] = 'A1234567';
    assert.throws(() => s.agendaAwbValidarPayload_({}, { ['courier' + slot]: { nome: 'OCASA', awb: 'A1234567' } }, 'novo'), /formato digital/);
    assert.doesNotThrow(() => s.agendaAwbValidarPayload_({}, { ['courier' + slot]: { nome: 'OCASA', awb: 'A1234567' } }, 'antigo', row));
    assert.throws(() => s.agendaAwbValidarPayload_({}, { ['courier' + slot]: { nome: 'OCASA', awb: 'B1234567' } }, 'antigo', row), /formato digital/);
  }
  assert.equal(reservations, 3);
});

test('Transporte confere o legado na Agenda persistida e nao em flags do cliente', () => {
  const s = runFiles(['WebApp.gs', 'TransporteCodexConfig.gs']);
  let reads = 0;
  s.buscarAgendaEventoPorIdTransp_ = () => { reads++; return { courier1: { nome: 'OCASA', awb: 'A1234567' }, courier2: { nome: 'OCASA', awb: '' }, backup: { nome: 'OCASA', awb: 'B1234567' } }; };
  const p = { courier: 'OCASA', awb: 'A1234567' };
  assert.throws(() => s.transporteValidarEntradaAwbOcasa_(p), /formato digital/);
  assert.throws(() => s.transporteValidarEntradaAwbOcasa_({ ...p, previous: p, allowLegacy: true }), /formato digital/);
  assert.doesNotThrow(() => s.transporteValidarEntradaAwbOcasa_({ ...p, idAgenda: 'A', agendaSlot: '1' }));
  assert.throws(() => s.transporteValidarEntradaAwbOcasa_({ ...p, idAgenda: 'A', agendaSlot: '2' }), /formato digital/);
  assert.doesNotThrow(() => s.transporteValidarEntradaAwbOcasa_({ ...p, awb: 'B1234567', idAgenda: 'A', agendaSlot: 'backup' }));
  assert.doesNotThrow(() => s.transporteValidarEntradaAwbOcasa_({ ...p, awb: 'PK2OZB276947' }));
  assert.equal(reads, 3);
});
