'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture() {
  const backup = { nome: 'MARKEN', temperatura: 'REFRIGERADO', status: 'Não agendado', awb: '', destino: '', material: '', matBioJson: '', agendamentos: [{ id: 'DESTINO' }] };
  const row = ['Realizado'];
  const writes = [];
  const sheet = { getRange: () => ({ getValues: () => [row] }) };
  const server = runFile('TransporteCodexConfig.gs', {
    normText_: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    normalizarAwbCourier_: value => String(value || '').replace(/\W/g, ''),
    AGENDA_CFG: { lastCol: 1, idx: {}, col: { status: 1 } },
    getAgendaSheet_: () => sheet,
    encontrarLinhaPorId: () => 2,
    agendaBackup2FromRow_: () => ({ ...backup }),
    agendaBackup2Write_: (_sheet, _row, value) => { writes.push(value); Object.assign(backup, value); },
    agendaInvalidateWindowCache_: () => {},
    SpreadsheetApp: { flush() {} }
  });
  return { server, backup, writes };
}

test('Backup II seleciona dados e temperatura proprios sem herdar o Backup I', () => {
  const { server } = fixture();
  const evento = { courier1: { temperatura: 'CONGELADO' }, backup: { nome: 'DHL', temperatura: 'CONGELADO' }, backup2: { nome: 'MARKEN', temperatura: 'REFRIGERADO', destino: 'Laboratorio II' } };
  for (const slot of ['backup2', 'Backup II', 'b2']) {
    assert.equal(server.normalizarSlotTransporteCodex_(slot, true), 'backup2');
    assert.equal(server.transporteAgendaCourierFromEvento_(evento, slot).temperatura, 'REFRIGERADO');
    assert.equal(server.transporteDestinoAgenda_(evento, slot), 'Laboratorio II');
  }
  evento.backup2.temperatura = '';
  assert.equal(server.transporteAgendaCourierFromEvento_(evento, 'backup2').temperatura, '', 'temperatura clinica ausente nao deve ser inferida');
});

test('sincronizacao do Backup II persiste somente seu envelope e conserva vinculos', () => {
  const { server, backup, writes } = fixture();
  const result = server.transporteSincronizarAgenda_({ idAgenda: 'ORIGEM', agendaSlot: 'backup2', temperatura: 'CONGELADO', destino: 'Laboratorio II', awb: '123456789012', statusCourier: 'Agendado' });
  assert.equal(result.atualizado, true);
  assert.equal(writes.length, 1);
  assert.equal(backup.temperatura, 'REFRIGERADO', 'valor existente nao e sobrescrito');
  assert.equal(backup.destino, 'Laboratorio II');
  assert.equal(backup.status, 'Agendado');
  assert.equal(backup.awb, '123456789012');
  assert.equal(backup.agendamentos[0].id, 'DESTINO');
  const divergent = server.transporteSincronizarAgenda_({ idAgenda: 'ORIGEM', agendaSlot: 'backup2', awb: '999999999999' });
  assert.equal(divergent.warnings.length, 1);
  assert.equal(backup.awb, '123456789012');
});

test('materiais de Backup II seguem a mesma validacao de unidade dos demais envios', () => {
  const { server } = fixture();
  const matBioJson = JSON.stringify({ items: [{ key: 'soro', tipo: 'Soro', formula: '1x1', unit: 'L' }] });
  assert.throws(() => server.codexMatBioValidateAgendaPayload_({ backup2: { nome: 'MARKEN', matBioJson } }), /unidade|volumes|mL/i);
});
