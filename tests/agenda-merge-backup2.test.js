'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, material } = require('./helpers/agenda-merge-fixture');

function withBackup2() {
  const f = fixture();
  f.i.backup2Dados = 53;
  f.c.AGENDA_CFG.col.backup2Dados = 54;
  f.c.AGENDA_CFG.lastCol = 54;
  f.sheet.rows[1][53] = JSON.stringify({ nome: 'Marken', temperatura: 'REFRIGERADO', status: 'Adicionado à Agenda', agendamentos: [{ id: 'DESTINO', slot: 'II' }] });
  const event = f.c.agendaRowToObject_(f.sheet.rows[1], 2);
  f.payload = Object.assign({}, f.c.agendaMergePayloadFromEvent_(event), { id: 'A', _recordVersion: event.recordVersion,
    _editRecordVersion: event.editRecordVersion, _editMergeToken: f.c.agendaIssueMergeToken_(f.sheet.rows[1], event) });
  f.merge = () => f.c.codexWithDocumentLock_('test', () => f.c.agendaTryMergeEdit_(f.payload, f.sheet.rows[1]));
  return f;
}

test('merge conserva mudancas independentes entre Backup I e Backup II', () => {
  const f = withBackup2();
  f.payload.backup.matBioJson = material('Backup I local');
  const remote = JSON.parse(f.sheet.rows[1][53]);
  remote.matBioJson = material('Backup II remoto');
  f.sheet.rows[1][53] = JSON.stringify(remote);
  const result = f.merge();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.dados.backup.matBioJson, f.payload.backup.matBioJson);
  assert.equal(result.dados.backup2.matBioJson, remote.matBioJson);
});

test('merge recusa material local do Backup II quando seu vinculo remoto muda', () => {
  const f = withBackup2();
  f.payload.backup2.matBioJson = material('Local');
  const remote = JSON.parse(f.sheet.rows[1][53]);
  remote.agendamentos = [{ id: 'OUTRO', slot: 'III' }];
  f.sheet.rows[1][53] = JSON.stringify(remote);
  const result = f.merge();
  assert.equal(result.ok, false);
  assert.ok(result.fields.includes('Backup II - Agendamento vinculado'));
});

test('merge nao transporta referencias Backup II injetadas pelo cliente', () => {
  const f = withBackup2();
  f.payload.backup2.agendamentos = [{ id: 'INJETADO' }];
  f.payload.backup2.agendamento = { id: 'INJETADO' };
  f.payload.obs = 'Local';
  f.sheet.rows[1][f.i.medico] = 'Remoto';
  const result = f.merge();
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.dados.backup2, 'agendamentos'), false);
  assert.equal(Object.hasOwn(result.dados.backup2, 'agendamento'), false);
});
