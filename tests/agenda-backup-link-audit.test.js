'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

// Envio 22a2c270 (04/11/2026): Backup I passou por Cancelado e voltou; o vinculo foi
// apagado por agendaSetBackupLinha_ sem registro na auditoria.
test('auditoria da edicao registra a remocao do vinculo do Backup I', () => {
  const s = runFile('WebApp.gs');
  const idx = s.AGENDA_CFG.idx;
  const antes = Array(s.AGENDA_CFG.lastCol).fill('');
  antes[idx.cb.status] = 'Adicionado à agenda';
  antes[idx.backupAgendaRef] = '{"id":"22a2c270","data":"16/nov./2026"}';
  const depois = antes.slice();
  depois[idx.backupAgendaRef] = '';
  const changes = s.agendaAuditChangesFromRows_(antes, depois);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), [
    { field: 'Backup - Agendamento', oldValue: '{"id":"22a2c270","data":"16/nov./2026"}', newValue: '' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.agendaAuditChangesFromRows_(antes, antes.slice()))), []);
});
