'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

function agendaServer() {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  return runFile('WebApp.gs', {
    AgendaServerRules_: rules,
    SpreadsheetApp: { flush() {} }
  });
}

test('vinculo do backup guarda o agendamento de destino com data e hora', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const source = Array(cfg.lastCol).fill('');
  source[cfg.idx.id] = 'origem-1';
  source[cfg.idx.cb.status] = 'Não Agendado';
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), source]);

  server.formatarDataSafe = () => '29/07/2026';
  server.formatarDataIsoAgenda_ = () => '2026-07-29';
  server.formatAgendaHora_ = () => '14:30';
  server.codexWriteAuditChanges_ = () => {};

  const ref = server.agendaVincularBackupAoAgendamento_(sheet, 'origem-1', 'destino-9', new Date(2026, 6, 29, 14, 30));

  assert.equal(sheet.rows[1][cfg.idx.cb.status], 'Adicionado à Agenda');
  assert.deepEqual(JSON.parse(JSON.stringify(ref)), {
    id: 'destino-9',
    data: '29/07/2026',
    dataIso: '2026-07-29',
    hora: '14:30'
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(server.agendaBackupAgendaRefFromCell_(sheet.rows[1][cfg.idx.backupAgendaRef]))),
    JSON.parse(JSON.stringify(ref))
  );
});

test('referencia invalida do backup nao quebra a carga da Agenda', () => {
  const server = agendaServer();
  assert.equal(server.agendaBackupAgendaRefFromCell_('conteudo legado'), null);
  assert.equal(server.agendaBackupAgendaRefFromCell_('{"data":"29/07/2026"}'), null);
});

test('temperatura do backup e persistida e devolvida no registro da Agenda', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const row = Array(cfg.lastCol).fill('');
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), row]);

  server.agendaSetBackupLinha_(sheet, 2, {
    nome: 'OCASA',
    temperatura: 'CONGELADO',
    status: 'Não Agendado',
    material: 'Soro'
  });

  assert.equal(sheet.rows[1][cfg.idx.cb.temp], 'CONGELADO');
  assert.equal(server.agendaRowToObject_(sheet.rows[1], 2).backup.temperatura, 'CONGELADO');
});

test('interface vincula somente depois de salvar e abre o agendamento pelo chip', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');

  assert.match(client, /backupOrigemAgendaId:\s*_agendaBackupOrigemId/);
  assert.doesNotMatch(client, /method:\s*'atualizarStatusBackupAgenda'[\s\S]{0,500}Adicionado/);
  assert.match(client, /agendaCourierStatusHtml\(c, backup, naoAplicavel, ok\)/);
  assert.match(client, /agendaAbrirAgendamentoVinculado/);
  assert.match(client, /abrirAgendaRegistroPorId\(agendaId\)/);
  assert.match(server, /agendaVincularBackupAoAgendamento_\(agenda, backupOrigemId, resultado\.id, d\)/);
  assert.match(server, /Backup_Agendamento_Ref/);
});

test('novo envio criado do backup preserva o medico do agendamento de origem', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const inicio = client.indexOf('function criarEnvioAmostrasDoBackupAgenda()');
  const fim = client.indexOf('function gerarTransporteAgendaCard(', inicio);
  const fluxoBackup = client.slice(inicio, fim);

  assert.notEqual(inicio, -1);
  assert.notEqual(fim, -1);
  assert.match(fluxoBackup, /setAgendaSelectValue\('agMedico', origem\.medico\)/);
  assert.match(fluxoBackup, /setAgendaSelectValue\('agC1Temp', agendaBackupTemperaturaOrigem\(origem, backup\)\)/);
  assert.match(client, /agBackupTemp/);
  assert.match(client, /temperatura: v\('agBackupTemp'\)/);
});
