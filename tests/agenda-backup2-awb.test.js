'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/agenda-merge-fixture');

function backupFixture() {
  const f = fixture();
  f.i.backup2Dados = 53;
  f.c.AGENDA_CFG.col.backup2Dados = 54;
  f.c.AGENDA_CFG.lastCol = 54;
  f.sheet.rows[1][53] = '';
  return f;
}

test('historico de AWB espelhada no Backup II pertence ao destino mesmo depois de desvincular', () => {
  const { c, i, sheet } = backupFixture();
  const awb = '999123456789';
  sheet.rows[1][53] = JSON.stringify({ nome: 'MARKEN', temperatura: 'REFRIGERADO', status: 'Adicionado à Agenda',
    agendamentos: [{ id: 'DESTINO', slot: 'II', awb }] });
  const target = Array(54).fill('');
  target[i.id] = 'DESTINO';
  target[i.c2.nome] = 'MARKEN';
  target[i.c2.temp] = 'REFRIGERADO';
  target[i.c2.awb] = awb;
  target[i.status] = 'Agendado';
  sheet.rows.push(target);

  // Uma mutacao comum registra todos os envios existentes no historico.
  c.agendaAwbReservar_(c.agendaAwbContexto_(sheet), [], false);
  const ledger = c.getCodexSpreadsheet_().getSheetByName('AWB_Utilizadas');
  const entries = ledger.rows.slice(1).filter(row => row[0] === awb);
  assert.equal(entries.length, 1, 'espelho nao cria uma segunda remessa historica');
  assert.equal(entries[0][1], c.agendaAwbOwner_('DESTINO', '2'));

  c.agendaBackup2Write_(sheet, 2, { status: 'Não agendado' });
  assert.equal(c.agendaBackup2FromRow_(sheet.rows[1]).agendamentos.length, 0);
  const context = c.agendaAwbContexto_(sheet);
  const destination = c.agendaAwbRegistro_(target, 2);
  assert.doesNotThrow(() => c.agendaAwbReservar_(context, [destination], true), 'o envio legitimo continua apto a gerar documentos');
  assert.throws(() => c.agendaAwbReservar_(context, [{ ...destination, owner: c.agendaAwbOwner_('OUTRO', '1'), id: 'OUTRO', slot: '1' }], true), /AWB.*outro envio/,
    'desvincular nao libera a AWB para uma nova remessa');
});

test('novo vinculo do Backup II sem AWB nao reutiliza AWB armazenada do vinculo anterior', () => {
  const { c, sheet } = backupFixture();
  sheet.rows[1][53] = JSON.stringify({ nome: 'MARKEN', status: 'Adicionado à Agenda', awb: 'AWB-ANTIGA',
    agendamentos: [{ id: 'ANTERIOR', awb: 'AWB-ANTIGA' }] });
  c.agendaBackup2Write_(sheet, 2, { agendamentos: [{ id: 'ANTERIOR', awb: 'AWB-ANTIGA' }, { id: 'NOVO', awb: '' }] });
  const current = c.agendaBackup2FromRow_(sheet.rows[1]);
  assert.equal(current.agendamento.id, 'NOVO');
  assert.equal(current.awb, '', 'AWB vazia do envio atual prevalece sobre dado antigo');
  assert.equal(current.agendamentos[0].awb, 'AWB-ANTIGA', 'historico do envio anterior permanece disponivel');
});

test('slot de origem Backup invalido e rejeitado antes de acessar planilha ou criar evento', () => {
  for (const method of ['salvarNovoEventoCompleto', 'salvarNovoEventoComFeriado']) {
    const { c, sheet } = backupFixture();
    let sheetAccesses = 0;
    c.getAgendaSheet_ = () => { sheetAccesses++; throw new Error('Acesso prematuro à planilha'); };
    c.SpreadsheetApp.getActiveSpreadsheet = () => { sheetAccesses++; throw new Error('Acesso prematuro à planilha'); };
    assert.throws(() => c[method]({ origemBackupSlot: 'backup3', backupOrigemAgendaId: 'A' }), /Backup inválido/);
    assert.equal(sheetAccesses, 0, method);
    assert.equal(sheet.writes, 0, method);
  }
});
