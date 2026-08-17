'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

const AGENDA_TRANSPORT_INDEXES = {
  1: { nome: 18, temp: 19, status: 20, awb: 21, material: 22 },
  2: { nome: 23, temp: 24, status: 25, awb: 26, material: 27 },
  3: { nome: 28, temp: 29, status: 30, awb: 31, material: 32 }
};

function loadCourierSetter() {
  const source = readProjectFile('WebApp.gs');
  const start = source.indexOf('function agendaSetCourierLinha_(');
  const end = source.indexOf('function agendaMaterialSummaryFromJson_(');
  assert.ok(start >= 0 && end > start, 'setter de courier nao localizado');
  const calls = [];
  const context = vm.createContext({
    agendaMaterialSummaryFromJson_: (_json, fallback) => String(fallback || ''),
    agendaSetAwbValue_: (range, awb, courier) => {
      calls.push({ awb: String(awb || ''), courier: String(courier || '') });
      if (String(awb || '')) range.setValue(awb);
      else range.clearContent();
    }
  });
  vm.runInContext(source.slice(start, end), context, { filename: 'WebApp.gs' });
  return { setter: context.agendaSetCourierLinha_, calls };
}

test('payload vazio ou sem intencao preserva AWB existente nos Transportes I, II e III', () => {
  Object.entries(AGENDA_TRANSPORT_INDEXES).forEach(([slot, idx]) => {
    const row = Array(52).fill('');
    const awbAnterior = `AWB-EXISTENTE-${slot}`;
    row[idx.awb] = awbAnterior;
    const sheet = new FakeSheet('Agenda', [Array(52).fill(''), row]);
    const { setter, calls } = loadCourierSetter();

    setter(sheet, 2, idx, { nome: 'DHL', status: 'Agendado', material: 'Soro', awb: '' });
    setter(sheet, 2, idx, { nome: 'DHL', status: 'Agendado', material: 'Soro', awb: 'AWB-DESATUALIZADA', awbTouched: false });

    assert.equal(sheet.rows[1][idx.awb], awbAnterior, `Transporte ${slot}`);
    assert.deepEqual(calls, [], `Transporte ${slot} nao deveria limpar a AWB`);
  });
});

test('limpeza explicitamente tocada continua funcionando nos Transportes I, II e III', () => {
  Object.entries(AGENDA_TRANSPORT_INDEXES).forEach(([slot, idx]) => {
    const row = Array(52).fill('');
    row[idx.awb] = `AWB-EXISTENTE-${slot}`;
    const sheet = new FakeSheet('Agenda', [Array(52).fill(''), row]);
    const { setter, calls } = loadCourierSetter();

    setter(sheet, 2, idx, { nome: 'DHL', awb: '', awbTouched: true, material: 'Soro' });

    assert.equal(sheet.rows[1][idx.awb], '', `Transporte ${slot}`);
    assert.equal(calls.length, 1, `Transporte ${slot} deveria limpar explicitamente`);
    assert.equal(calls[0].awb, '', `Transporte ${slot}`);
  });
});

test('AWB tocada continua podendo preencher ou substituir os Transportes I, II e III', () => {
  Object.entries(AGENDA_TRANSPORT_INDEXES).forEach(([slot, idx]) => {
    const row = Array(52).fill('');
    row[idx.awb] = `AWB-ANTERIOR-${slot}`;
    const sheet = new FakeSheet('Agenda', [Array(52).fill(''), row]);
    const { setter, calls } = loadCourierSetter();

    setter(sheet, 2, idx, { nome: 'MARKEN', awb: `AWB-NOVA-${slot}`, awbTouched: true, material: 'Soro' });

    assert.equal(sheet.rows[1][idx.awb], `AWB-NOVA-${slot}`, `Transporte ${slot}`);
    assert.equal(calls.length, 1, `Transporte ${slot} deveria atualizar a AWB`);
  });
});

test('cliente envia intencao de AWB separada do valor carregado no formulario', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  assert.match(client, /awbTouched: !!\(awbEl && awbEl\.dataset\.awbTouched === 'true'\)/);
  assert.match(client, /el\.addEventListener\('input',[\s\S]*?el\.dataset\.awbTouched = 'true'/);
  assert.match(client, /agendaSetAwbTrackingBaseline_\(prefix, c\.awb\)/);
});
