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

// backupFixture amplia as colunas depois de o payload ser montado; a versao aberta nao se aplica aqui.
function salvarEnvio(f, campos) {
  return f.c.atualizarAgendaEventoCompleto(Object.assign(f.payload, { _recordVersion: '', _editRecordVersion: '' }, campos));
}

function origemVinculada(f, id, refs) {
  const origem = Array(54).fill('');
  origem[f.i.id] = id;
  origem[f.i.data] = new Date(2027, 0, 6, 14, 0);
  origem[f.i.hora] = '14:00';
  origem[f.i.tipo] = 'Visita';
  origem[f.i.status] = 'Agendado';
  origem[f.i.labCentral] = 'Sim';
  origem[f.i.backupAgendaRef] = JSON.stringify(refs.backup);
  origem[53] = JSON.stringify({ nome: 'MARKEN', status: 'Adicionado à Agenda', agendamentos: refs.backup2 });
  f.sheet.rows.push(origem);
  return origem;
}

test('reagendar o envio atualiza data e horario do vinculo nas origens de Backup I e II', () => {
  const f = backupFixture();
  const antigo = { id: 'A', data: '20/dez./2026', dataIso: '2026-12-20', hora: '08:00' };
  const outro = { id: 'OUTRO', data: '02/jan./2027', dataIso: '2027-01-02', hora: '09:00' };
  const origem = origemVinculada(f, 'ORIGEM', {
    backup: [outro, Object.assign({}, antigo, { awb: 'AWB-1', slot: 'II' })],
    backup2: [antigo]
  });
  const naoVinculada = origemVinculada(f, 'SEM-VINCULO', { backup: outro, backup2: [outro] });
  const refSemVinculo = naoVinculada[f.i.backupAgendaRef];

  const res = salvarEnvio(f, {
    data: '2026-12-19', hora: '13:00', reagendamentoConfirmado: true
  });

  assert.equal(res.ok, true);
  const refs = JSON.parse(origem[f.i.backupAgendaRef]);
  assert.deepEqual(refs[0], outro, 'outro vinculo da mesma origem nao muda');
  assert.equal(refs[1].dataIso, '2026-12-19');
  assert.equal(refs[1].hora, '13:00');
  assert.equal(refs[1].data, f.c.formatarDataSafe(new Date(2026, 11, 19, 13, 0)));
  assert.equal(refs[1].awb, 'AWB-1', 'demais campos do vinculo preservados');
  assert.equal(refs[1].slot, 'II');
  const backup2 = f.c.agendaBackup2FromRow_(origem);
  assert.equal(backup2.agendamento.dataIso, '2026-12-19');
  assert.equal(backup2.agendamento.hora, '13:00');
  assert.equal(backup2.status, 'Adicionado à Agenda');
  assert.equal(naoVinculada[f.i.backupAgendaRef], refSemVinculo);
  const auditorias = f.audits.filter(args => args[1] === 'sincronizarBackupData');
  assert.deepEqual(auditorias.map(args => args[3][0].field), ['Backup - Agendamento', 'Backup II - Agendamento']);
  assert.ok(auditorias.every(args => args[2] === 'ORIGEM'));
});

test('mudar somente o horario do envio tambem atualiza o vinculo', () => {
  const f = backupFixture();
  const origem = origemVinculada(f, 'ORIGEM', {
    backup: { id: 'A', data: '20/dez./2026', dataIso: '2026-12-20', hora: '08:00' }, backup2: []
  });
  const res = salvarEnvio(f, { data: '2026-12-20', hora: '10:30' });
  assert.equal(res.ok, true);
  assert.equal(JSON.parse(origem[f.i.backupAgendaRef]).hora, '10:30');
});

test('salvar o envio sem mudar data ou horario nao procura vinculos', () => {
  const f = backupFixture();
  let chamadas = 0;
  f.c.agendaAtualizarBackupDataVinculada_ = () => { chamadas++; };
  const res = salvarEnvio(f, { data: '2026-12-20', hora: '08:00', obs: 'Outra' });
  assert.equal(res.ok, true);
  assert.equal(chamadas, 0);
});
