'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

function fixture() {
  const leituras = { participantes: 0 };
  const linhas = [['CAD-1', 'Pessoa', '01/02/1990', '', '123', 'Estudo', 'Braco A', '', 'Ativo']];
  const aba = {
    getLastRow: () => linhas.length + 1,
    getLastColumn: () => 9,
    getRange: () => ({ getValues: () => { leituras.participantes++; return linhas; } })
  };
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs'], {
    Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => aba }) }
  });
  s.getInfoParticipante = () => { throw new Error('nao pode acionar a leitura de ultima visita'); };
  return { s, leituras };
}

const dados = { participante: 'Pessoa', participanteCadastroId: 'CAD-1', projeto: 'Estudo' };

test('nascimento, ID e braco compartilham uma leitura de Participantes no salvamento', () => {
  const { s, leituras } = fixture();
  const leitura = {};
  assert.ok(s.agendaNascimentoFromDados_(dados, null, leitura));
  assert.equal(s.agendaIdParticipanteFromDados_(dados, null, leitura), '123');
  assert.equal(s.agendaBracoFromDados_(dados, null, leitura), 'Braco A');
  assert.equal(leituras.participantes, 1);
});

test('sem leitura compartilhada cada consulta continua funcionando', () => {
  const { s, leituras } = fixture();
  assert.equal(s.agendaIdParticipanteFromDados_(dados), '123');
  assert.equal(s.agendaBracoFromDados_(dados), 'Braco A');
  assert.equal(leituras.participantes, 2);
});

test('valor ja informado ou da linha anterior nao le Participantes', () => {
  const { s, leituras } = fixture();
  assert.equal(s.agendaIdParticipanteFromDados_({ ...dados, idParticipante: '999' }, null, {}), '999');
  assert.equal(s.agendaBracoFromDados_({ ...dados, braco: 'Braco B' }, null, {}), 'Braco B');
  assert.equal(leituras.participantes, 0);
});
