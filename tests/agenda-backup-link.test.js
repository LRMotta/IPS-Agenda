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

function readonlyAgendaSheet(rows, maxColumns) {
  const sheet = new FakeSheet('Agenda', rows);
  const getRange = sheet.getRange.bind(sheet);
  function denyWrite() {
    sheet.writeAttempts++;
    throw new Error('Voce nao tem permissao para alterar o documento solicitado.');
  }
  sheet.writeAttempts = 0;
  sheet.getMaxColumns = () => maxColumns;
  sheet.insertColumnsAfter = denyWrite;
  sheet.getRange = (...args) => {
    const range = getRange(...args);
    range.setValue = denyWrite;
    range.setValues = denyWrite;
    range.clearContent = denyWrite;
    return range;
  };
  return sheet;
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
  row[cfg.idx.tipo] = 'Visita';
  row[cfg.idx.labCentral] = 'Sim';
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

test('temperatura do backup nao vaza para SIV ou visita sem laboratorio', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const siv = Array(cfg.lastCol).fill('');
  siv[cfg.idx.tipo] = 'SIV';
  siv[cfg.idx.labCentral] = 'Não aplicável';
  siv[cfg.idx.cb.temp] = '81231558';
  const visitaSemLab = Array(cfg.lastCol).fill('');
  visitaSemLab[cfg.idx.tipo] = 'Visita';
  visitaSemLab[cfg.idx.labCentral] = 'Não';
  visitaSemLab[cfg.idx.cb.temp] = 'CONGELADO';

  assert.equal(server.agendaRowToObject_(siv, 2).backup.temperatura, '');
  assert.equal(server.agendaRowToObject_(visitaSemLab, 3).backup.temperatura, '');
});

test('coluna de temperatura do backup e localizada pelo cabecalho sem reutilizar coluna legada', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const headers = Array(cfg.lastCol).fill('');
  const siv = Array(cfg.lastCol).fill('');
  headers[cfg.idx.cb.temp] = 'Telefone legado';
  siv[cfg.idx.cb.temp] = '81231558';
  const sheet = new FakeSheet('Agenda', [headers, siv]);

  const column = server.agendaEnsureBackupTemperaturaColumn_(sheet);

  assert.equal(column, 53);
  assert.equal(sheet.rows[0][51], 'Telefone legado');
  assert.equal(sheet.rows[1][51], '81231558');
  assert.equal(sheet.rows[0][52], 'Backup - Temperatura');
  assert.equal(cfg.idx.cb.temp, 52);

  const sameColumn = server.agendaEnsureBackupTemperaturaColumn_(sheet);
  assert.equal(sameColumn, 53);
  assert.equal(sheet.rows[0].length, 53);
});

test('carga da Agenda em planilha readonly aceita esquema legado sem tentar criar coluna', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const headers = Array(cfg.col.backupAgendaRef).fill('');
  const row = Array(cfg.col.backupAgendaRef).fill('');
  row[cfg.idx.id] = 'EVT-READONLY';
  row[cfg.idx.tipo] = 'Visita';
  row[cfg.idx.status] = 'Agendado';
  row[cfg.idx.labCentral] = 'Nao';
  const sheet = readonlyAgendaSheet([headers, row], cfg.col.backupAgendaRef);

  server.getCodexSpreadsheet_ = () => ({
    getSheetByName: (name) => cfg.abaNomes.includes(name) ? sheet : null
  });
  server.getCodexSheetDataByName_ = () => [];

  const eventos = server.getAgendaEventos(5000);

  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].id, 'EVT-READONLY');
  assert.equal(eventos[0].backup.temperatura, '');
  assert.equal(cfg.lastCol, cfg.col.backupAgendaRef);
  assert.equal(cfg.col.backupTemperatura, 0);
  assert.equal(cfg.idx.cb.temp, -1);
  assert.equal(sheet.writeAttempts, 0);
});

test('carga readonly localiza temperatura do backup em coluna dinamica sem escrever cabecalhos', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const headers = Array(53).fill('');
  const row = Array(53).fill('');
  headers[51] = 'Telefone legado';
  headers[52] = 'Backup - Temperatura';
  row[cfg.idx.id] = 'EVT-BACKUP';
  row[cfg.idx.tipo] = 'Visita';
  row[cfg.idx.status] = 'Agendado';
  row[cfg.idx.labCentral] = 'Sim';
  row[52] = 'CONGELADO';
  const sheet = readonlyAgendaSheet([headers, row], 53);

  server.getCodexSpreadsheet_ = () => ({
    getSheetByName: (name) => cfg.abaNomes.includes(name) ? sheet : null
  });
  server.getCodexSheetDataByName_ = () => [];

  const eventos = server.getAgendaEventos(5000);

  assert.equal(cfg.lastCol, 53);
  assert.equal(cfg.col.backupTemperatura, 53);
  assert.equal(cfg.idx.cb.temp, 52);
  assert.equal(eventos[0].tipo, 'Visita');
  assert.equal(eventos[0].labCentral, 'Sim');
  assert.equal(eventos[0].backup.temperatura, 'CONGELADO');
  assert.equal(sheet.writeAttempts, 0);
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

test('novo envio do Backup exige temperatura sem alterar o legado', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const serverSource = readProjectFile('WebApp.gs');
  const server = agendaServer();
  const inicio = client.indexOf('function criarEnvioAmostrasDoBackupAgenda()');
  const fim = client.indexOf('function gerarTransporteAgendaCard(', inicio);
  const fluxoBackup = client.slice(inicio, fim);

  assert.match(fluxoBackup, /backup\.temperatura \|\| backup\.temp/);
  assert.match(fluxoBackup, /Informe a Temperatura do Transporte de Amostras Backup/);
  assert.match(client, /function atualizarEstadoNovoEnvioBackup_\(\)/);
  assert.match(client, /btn\.disabled = !temperaturaInformada/);
  assert.match(serverSource, /function salvarNovoEventoCompleto[\s\S]*agendaNovoEnvioBackupTemperaturaErro_\(dados\)/);
  assert.match(serverSource, /function salvarNovoEventoComFeriado[\s\S]*agendaNovoEnvioBackupTemperaturaErro_\(dados\)/);

  assert.equal(server.agendaNovoEnvioBackupTemperaturaErro_({
    backupOrigemAgendaId: 'LEGADO-1',
    courier1: { temperatura: '' },
    backup: { temperatura: 'CONGELADO' }
  }), 'Informe a Temperatura do Transporte de Amostras I antes de salvar o novo envio.');
  assert.equal(server.agendaNovoEnvioBackupTemperaturaErro_({
    backupOrigemAgendaId: 'ORIGEM-1',
    courier1: { temperatura: 'CONGELADO' },
    backup: {}
  }), '');
  assert.equal(server.agendaNovoEnvioBackupTemperaturaErro_({ courier1: { temperatura: '' } }), '');
});
