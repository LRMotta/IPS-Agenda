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

function backupTestServer(sheet, options) {
  options = options || {};
  const server = agendaServer();
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.AGENDA_CFG.col.participanteCadastroId = 53;
  server.AGENDA_CFG.lastCol = 53;
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'readonly' });
  server.codexAssertCanWrite_ = () => ({ ok: true, role: 'admin' });
  server.codexWriteAuditChanges_ = () => {};
  server.codexLogPerformance_ = () => {};
  server.getAgendaSheetForRead_ = () => sheet;
  server.getAgendaSheet_ = () => sheet;
  server.LockService = {
    getDocumentLock: () => ({
      tryLock: () => options.lockAvailable !== false,
      releaseLock() {}
    }),
    getScriptLock: () => null
  };
  server.Utilities = {
    formatDate(value) {
      const date = value instanceof Date ? value : new Date(value);
      return date.toISOString().slice(0, 19);
    }
  };
  server.Session = { getScriptTimeZone: () => 'America/Sao_Paulo' };
  server.formatarDataSafe = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };
  server.formatarDataIsoAgenda_ = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  server.formatarHoraSafe_ = (value) => value instanceof Date
    ? `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
    : String(value || '00:00');
  return server;
}

function backupTestDate(dayOffset) {
  const date = new Date();
  date.setDate(date.getDate() + Number(dayOffset || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function backupTestRow(server, id, values) {
  values = values || {};
  const row = Array(server.AGENDA_CFG.lastCol).fill('');
  const idx = server.AGENDA_CFG.idx;
  row[idx.id] = id;
  row[idx.data] = values.data || backupTestDate(5);
  row[idx.hora] = values.hora || '12:00';
  row[idx.tipo] = values.tipo || 'Visita';
  row[idx.status] = values.status || 'Agendado';
  row[idx.participante] = values.nomeParticipante || 'Pessoa Teste';
  row[idx.participanteCadastroId] = values.participanteId || 'pessoa-1';
  row[idx.projeto] = values.projeto || 'Projeto A';
  row[idx.visita] = values.visita || 'Visita 1';
  row[idx.labCentral] = values.labCentral || 'Sim';
  if (values.backup) {
    row[idx.cb.nome] = values.backup.nome || 'MARKEN';
    row[idx.cb.temp] = values.backup.temperatura || 'CONGELADO';
    row[idx.cb.status] = values.backup.status || 'Não Agendado';
    row[idx.cb.material] = values.backup.material || 'Soro';
    row[idx.cb.destino] = values.backup.destino || 'Laboratório Central';
    row[idx.cb.matBio] = values.backup.matBioJson || '[{"key":"soro"}]';
  }
  ['courier1', 'courier2', 'courier3'].forEach((name, offset) => {
    const courier = values[name];
    if (!courier) return;
    const cfg = [idx.c1, idx.c2, idx.c3][offset];
    row[cfg.nome] = courier.nome || '';
    row[cfg.temp] = courier.temperatura || '';
    row[cfg.status] = courier.status || '';
    row[cfg.awb] = courier.awb || '';
    row[cfg.material] = courier.material || '';
    row[cfg.destino] = courier.destino || '';
    row[cfg.matBio] = courier.matBioJson || '';
  });
  return row;
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

test('vinculo do backup devolve e atualiza a AWB do envio na visita original', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const source = Array(cfg.lastCol).fill('');
  source[cfg.idx.id] = 'origem-awb';
  source[cfg.idx.tipo] = 'Visita';
  source[cfg.idx.labCentral] = 'Sim';
  source[cfg.idx.cb.nome] = 'MARKEN';
  source[cfg.idx.cb.status] = 'Não Agendado';
  const destination = Array(cfg.lastCol).fill('');
  destination[cfg.idx.id] = 'destino-awb';
  destination[cfg.idx.c1.awb] = '620X12345678';
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), source, destination]);

  server.formatarDataSafe = () => '29/07/2026';
  server.formatarDataIsoAgenda_ = () => '2026-07-29';
  server.formatAgendaHora_ = () => '14:30';
  server.codexWriteAuditChanges_ = () => {};

  const ref = server.agendaVincularBackupAoAgendamento_(sheet, 'origem-awb', 'destino-awb', new Date(2026, 6, 29, 14, 30));
  assert.equal(ref.awb, '620X12345678');
  assert.equal(server.agendaRowToObject_(sheet.rows[1], 2).backup.awb, '620X12345678');

  server.agendaAtualizarBackupAwbVinculado_(sheet, 3, '620X87654321');
  assert.equal(server.agendaRowToObject_(sheet.rows[1], 2).backup.awb, '620X87654321');
});

test('novo vinculo do backup preserva os anteriores e a leitura retorna o ultimo', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const source = Array(cfg.lastCol).fill('');
  source[cfg.idx.id] = 'origem-1';
  source[cfg.idx.cb.status] = 'Adicionado à Agenda';
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), source]);

  server.formatarDataSafe = (value) => value instanceof Date ? value.getDate() + '/08/2026' : String(value || '');
  server.formatarDataIsoAgenda_ = (value) => value instanceof Date
    ? '2026-08-' + String(value.getDate()).padStart(2, '0')
    : String(value || '');
  server.formatAgendaHora_ = (value) => String(value.getHours()).padStart(2, '0') + ':00';
  server.codexWriteAuditChanges_ = () => {};

  server.agendaVincularBackupAoAgendamento_(sheet, 'origem-1', 'destino-1', new Date(2026, 7, 5, 9));
  server.agendaVincularBackupAoAgendamento_(sheet, 'origem-1', 'destino-2', new Date(2026, 7, 19, 11));

  const refs = JSON.parse(sheet.rows[1][cfg.idx.backupAgendaRef]);
  assert.deepEqual(JSON.parse(JSON.stringify(refs.map((ref) => ref.id))), ['destino-1', 'destino-2']);
  assert.equal(server.agendaBackupAgendaRefFromCell_(sheet.rows[1][cfg.idx.backupAgendaRef]).id, 'destino-2');
  sheet.rows[1][cfg.idx.tipo] = 'Visita';
  sheet.rows[1][cfg.idx.labCentral] = 'Sim';
  sheet.rows[1][cfg.idx.cb.nome] = 'OCASA';
  sheet.rows[1][cfg.idx.cb.status] = 'Adicionado à Agenda';
  assert.equal(server.agendaRowToObject_(sheet.rows[1], 2).backup.agendamento.id, 'destino-2');
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

test('pendencias separam Transporte de Amostras Backup nao agendado e preservam o link da Agenda', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const backupNaoAgendado = Array(cfg.lastCol).fill('');
  backupNaoAgendado[cfg.idx.id] = 'EVT-BACKUP-PENDENTE';
  backupNaoAgendado[cfg.idx.data] = '2099-01-15';
  backupNaoAgendado[cfg.idx.hora] = '09:00';
  backupNaoAgendado[cfg.idx.tipo] = 'Visita';
  backupNaoAgendado[cfg.idx.status] = 'Agendado';
  backupNaoAgendado[cfg.idx.participante] = 'Participante Backup';
  backupNaoAgendado[cfg.idx.projeto] = 'Projeto Backup';
  backupNaoAgendado[cfg.idx.visita] = 'V1';
  backupNaoAgendado[cfg.idx.cb.nome] = 'OCASA';
  backupNaoAgendado[cfg.idx.cb.temp] = 'CONGELADO';
  backupNaoAgendado[cfg.idx.cb.status] = 'Não Agendado';

  const backupAgendado = backupNaoAgendado.slice();
  backupAgendado[cfg.idx.id] = 'EVT-BACKUP-AGENDADO';
  backupAgendado[cfg.idx.cb.status] = 'Agendado';
  const backupSemCourier = backupNaoAgendado.slice();
  backupSemCourier[cfg.idx.id] = 'EVT-BACKUP-SEM-COURIER';
  backupSemCourier[cfg.idx.cb.nome] = '';
  const backupVisitaRealizada = backupNaoAgendado.slice();
  backupVisitaRealizada[cfg.idx.id] = 'EVT-BACKUP-REALIZADA';
  backupVisitaRealizada[cfg.idx.status] = 'Realizado';
  const backupVisitaConcluida = backupNaoAgendado.slice();
  backupVisitaConcluida[cfg.idx.id] = 'EVT-BACKUP-CONCLUIDA';
  backupVisitaConcluida[cfg.idx.status] = 'Concluído';
  const backupDataPassada = backupNaoAgendado.slice();
  backupDataPassada[cfg.idx.id] = 'EVT-BACKUP-DATA-PASSADA';
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  backupDataPassada[cfg.idx.data] = ontem.toISOString().slice(0, 10);

  server.getAgendaSheetForRead_ = () => new FakeSheet('Agenda', [
    Array(cfg.lastCol).fill(''),
    backupNaoAgendado,
    backupAgendado,
    backupSemCourier,
    backupVisitaRealizada,
    backupVisitaConcluida,
    backupDataPassada
  ]);
  server.getAgendaFeriadosPendenciasMap_ = () => ({});

  const pendencias = server.getDashboardPendencias_([]);

  assert.equal(pendencias.counts.transporteBackupNaoAgendado, 4);
  assert.equal(pendencias.transporteBackupNaoAgendado.length, 4);
  assert.deepEqual(
    JSON.parse(JSON.stringify(pendencias.transporteBackupNaoAgendado.map((item) => item.agendaId).sort())),
    ['EVT-BACKUP-CONCLUIDA', 'EVT-BACKUP-DATA-PASSADA', 'EVT-BACKUP-PENDENTE', 'EVT-BACKUP-REALIZADA']
  );
  const pendenciasClient = readProjectFile('IndexPendenciasScripts.html');
  const backupCardIndex = pendenciasClient.indexOf("key: 'transporteBackupNaoAgendado'");
  const documentacaoCardIndex = pendenciasClient.indexOf("key: 'documentacaoTransporteSemEnvio'");
  assert.match(pendenciasClient, /key: 'transporteBackupNaoAgendado',[\s\S]*?action: pendenciaAgendaRegistroAction/);
  assert.ok(backupCardIndex > pendenciasClient.indexOf("key: 'kitsVencendo'"));
  assert.ok(documentacaoCardIndex > backupCardIndex);
  assert.equal(pendenciasClient.lastIndexOf("key: '"), documentacaoCardIndex);
  const pendenciaOriginal = pendencias.transporteBackupNaoAgendado.find((item) => item.agendaId === 'EVT-BACKUP-PENDENTE');
  assert.deepEqual(JSON.parse(JSON.stringify(pendenciaOriginal)), {
    agendaId: 'EVT-BACKUP-PENDENTE',
    data: '2099-01-15',
    hora: '09:00',
    prazoHoras: pendenciaOriginal.prazoHoras,
    participante: 'Participante Backup',
    projeto: 'Projeto Backup',
    visita: 'V1',
    tipo: 'Visita',
    slot: 'Transporte de Amostras Backup',
    courier: 'OCASA',
    temperatura: 'CONGELADO',
    statusCourier: 'Não Agendado'
  });
});

test('pendencias exibem documentacao de transporte sem envio identificado', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const row = Array(cfg.lastCol).fill('');
  row[cfg.idx.id] = 'EVT-DOCS-1';
  row[cfg.idx.data] = '2099-09-03';
  row[cfg.idx.hora] = '09:00';
  row[cfg.idx.tipo] = 'Visita';
  row[cfg.idx.status] = 'Agendado';
  row[cfg.idx.participante] = 'Participante Docs';
  row[cfg.idx.projeto] = 'Projeto Docs';
  row[cfg.idx.visita] = 'V1';
  row[cfg.idx.c1.nome] = 'DHL';
  row[cfg.idx.c1.temp] = 'AMBIENTE';
  row[cfg.idx.c1.status] = 'Pendente';
  server.getAgendaSheetForRead_ = () => new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), row]);
  server.getAgendaFeriadosPendenciasMap_ = () => ({});
  server.transporteDocumentosSemEnvioPendencias_ = () => [{
    agendaId: 'EVT-DOCS-1',
    slot: '1',
    referencia: 'IPS-TRP-EVT-DOCS-1-T1',
    courier: 'DHL',
    geradoEm: '2099-09-01T09:00:00',
    motivo: 'Rascunho criado; envio do e-mail não identificado há mais de 1 hora.'
  }];

  const pendencias = server.getDashboardPendencias_([]);

  assert.equal(pendencias.counts.documentacaoTransporteSemEnvio, 1);
  assert.equal(pendencias.counts.courierNaoAgendada, 0);
  assert.equal(pendencias.documentacaoTransporteSemEnvio[0].slot, 'Transporte I');
  assert.match(pendencias.documentacaoTransporteSemEnvio[0].motivo, /1 hora/);
  const pendenciasSource = readProjectFile('IndexPendenciasScripts.html');
  assert.match(pendenciasSource, /key: 'documentacaoTransporteSemEnvio'/);
  assert.ok(
    pendenciasSource.indexOf("key: 'documentacaoTransporteSemEnvio'") > pendenciasSource.indexOf("key: 'transporteBackupNaoAgendado'"),
    'documentacao de transporte sem envio deve ser a ultima caixa de Pendencias'
  );
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

test('consulta de backup lista somente visitas futuras do participante e projeto com slot livre', () => {
  const server = agendaServer();
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.AGENDA_CFG.col.participanteCadastroId = 53;
  server.AGENDA_CFG.lastCol = 53;
  const idx = server.AGENDA_CFG.idx;
  const origem = backupTestRow(server, 'ORIGEM-CONSULTA', {
    data: backupTestDate(-1), backup: {}
  });
  const iiOcupado = backupTestRow(server, 'VISITA-II-OCUPADO', {
    courier2: { nome: 'DHL', temperatura: 'REFRIGERADO', status: 'Agendado', awb: 'AWB-II', destino: 'Lab', material: 'Soro' }
  });
  const ambosOcupados = backupTestRow(server, 'VISITA-AMBOS-OCUPADOS', {
    courier2: { nome: 'DHL' }, courier3: { nome: 'MARKEN' }
  });
  const outraIdentidade = backupTestRow(server, 'MESMO-NOME', { participanteId: 'pessoa-2' });
  const outroProjeto = backupTestRow(server, 'OUTRO-PROJETO', { projeto: 'Projeto B' });
  const cancelada = backupTestRow(server, 'CANCELADA', { status: 'Cancelado' });
  const concluida = backupTestRow(server, 'CONCLUIDA', { status: 'Concluído' });
  const passada = backupTestRow(server, 'PASSADA', { data: backupTestDate(-1) });
  const semLaboratorio = backupTestRow(server, 'SEM-LAB', { labCentral: 'Não' });
  const vazia = backupTestRow(server, 'VISITA-VAZIA');
  const sheet = new FakeSheet('Agenda', [Array(server.AGENDA_CFG.lastCol).fill(''), origem, iiOcupado, ambosOcupados, outraIdentidade, outroProjeto, cancelada, concluida, passada, semLaboratorio, vazia]);
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'readonly' });
  server.getAgendaSheetForRead_ = () => sheet;
  server.formatarDataSafe = (value) => value instanceof Date ? `${value.getDate()}/${value.getMonth() + 1}/${value.getFullYear()}` : String(value);
  server.formatarHoraSafe_ = (value) => String(value || '00:00');
  server.formatarDataIsoAgenda_ = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  assert.equal(server.agendaBackupDadosOrigemErro_(origem), '');
  assert.equal(String(origem[server.AGENDA_CFG.idx.participanteCadastroId]), 'pessoa-1');
  assert.equal(String(iiOcupado[server.AGENDA_CFG.idx.participanteCadastroId]), 'pessoa-1');
  assert.equal(String(origem[server.AGENDA_CFG.idx.projeto]), String(iiOcupado[server.AGENDA_CFG.idx.projeto]));
  assert.equal(server.AgendaServerRules_.isVisit(iiOcupado[server.AGENDA_CFG.idx.tipo]), true);
  assert.equal(server.AgendaServerRules_.isLabCentral(iiOcupado[server.AGENDA_CFG.idx.labCentral]), true);
  assert.ok(server._parseDateHora(iiOcupado[server.AGENDA_CFG.idx.data], '12:00').getTime() > Date.now());
  assert.equal(server.agendaBackupVisitaElegivel_(origem, iiOcupado, new Date()), true);

  const result = server.getAgendaVisitasFuturasParaBackup('ORIGEM-CONSULTA');
  assert.deepEqual(Array.from(result.visitas, (item) => item.id), ['VISITA-II-OCUPADO', 'VISITA-VAZIA']);
  assert.equal(result.visitas[0].transporteII.disponivel, false);
  assert.equal(result.visitas[0].transporteIII.disponivel, true);
  assert.equal(result.visitas[1].transporteII.disponivel, true);
  assert.equal(result.visitas[1].transporteIII.disponivel, true);
  assert.equal(idx.participanteCadastroId, 52);
});

test('consulta de visitas futuras rejeita sessoes sem autorizacao', () => {
  const server = agendaServer();
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: false, message: 'Acesso negado.' });
  server.getAgendaSheetForRead_ = () => { throw new Error('a planilha nao deve ser consultada'); };

  assert.throws(() => server.getAgendaVisitasFuturasParaBackup('ORIGEM-NEGADA'), /Acesso negado/);
});

test('visita destino deve ocorrer depois do agendamento de origem quando ele tambem e futuro', () => {
  const server = agendaServer();
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.AGENDA_CFG.col.participanteCadastroId = 53;
  server.AGENDA_CFG.lastCol = 53;
  const origem = backupTestRow(server, 'ORIGEM-FUTURA', { data: backupTestDate(5), hora: '18:00', backup: {} });
  const anterior = backupTestRow(server, 'DESTINO-ANTERIOR', { data: backupTestDate(5), hora: '12:00' });
  const posterior = backupTestRow(server, 'DESTINO-POSTERIOR', { data: backupTestDate(6), hora: '12:00' });
  const context = backupTestServer(new FakeSheet('Agenda', []));

  assert.equal(context.agendaBackupVisitaElegivel_(origem, anterior, new Date()), false);
  assert.equal(context.agendaBackupVisitaElegivel_(origem, posterior, new Date()), true);
});

test('vincular backup transfere dados apenas ao slot escolhido e atualiza a referencia do modal', () => {
  const server = agendaServer();
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.AGENDA_CFG.col.participanteCadastroId = 53;
  server.AGENDA_CFG.lastCol = 53;
  const idx = server.AGENDA_CFG.idx;
  const origem = backupTestRow(server, 'ORIGEM-TRANSFERENCIA', {
    data: backupTestDate(-1),
    backup: { nome: 'MARKEN', temperatura: 'CONGELADO', destino: 'Lab Central', material: 'Soro', matBioJson: '[{"key":"soro","quantidade":2}]' }
  });
  const destino = backupTestRow(server, 'DESTINO-TRANSFERENCIA', {
    courier3: { nome: 'DHL', temperatura: 'AMBIENTE', status: 'Agendado', awb: 'AWB-III', material: 'Plasma', destino: 'Outro Lab', matBioJson: '[{"key":"plasma"}]' }
  });
  const sheet = new FakeSheet('Agenda', [Array(server.AGENDA_CFG.lastCol).fill(''), origem, destino]);
  const context = backupTestServer(sheet);
  const sourceBefore = sheet.getRange(2, 1, 1, context.AGENDA_CFG.lastCol).getValues()[0];
  const targetBefore = sheet.getRange(3, 1, 1, context.AGENDA_CFG.lastCol).getValues()[0];
  const result = context.aplicarBackupEmVisitaFutura({
    origemId: 'ORIGEM-TRANSFERENCIA',
    destinoId: 'DESTINO-TRANSFERENCIA',
    slot: 'II',
    origemVersion: context.agendaRecordVersionFromRow_(sourceBefore),
    destinoVersion: context.agendaRecordVersionFromRow_(targetBefore)
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.origem.backup.status, 'Adicionado à Agenda');
  assert.equal(result.origem.backup.agendamento.id, 'DESTINO-TRANSFERENCIA');
  assert.equal(result.origem.backup.agendamento.slot, 'II');
  assert.equal(sheet.rows[1][idx.cb.nome], 'MARKEN');
  assert.equal(sheet.rows[1][idx.cb.destino], 'Lab Central');
  assert.equal(sheet.rows[1][idx.cb.temp], 'CONGELADO');
  assert.equal(sheet.rows[2][idx.c2.nome], 'MARKEN');
  assert.equal(sheet.rows[2][idx.c2.temp], 'CONGELADO');
  assert.equal(sheet.rows[2][idx.c2.status], 'Não Agendado');
  assert.equal(sheet.rows[2][idx.c2.destino], 'Lab Central');
  assert.equal(sheet.rows[2][idx.c2.material], 'Soro');
  assert.equal(sheet.rows[2][idx.c2.matBio], '[{"key":"soro","quantidade":2}]');
  assert.equal(sheet.rows[2][idx.c2.awb], '');
  assert.equal(sheet.rows[2][idx.c3.nome], 'DHL');
  assert.equal(sheet.rows[2][idx.c3.awb], 'AWB-III');
  assert.equal(result.destino.courier2.nome, 'MARKEN');
});

test('vincular backup bloqueia slot ocupado, identidade divergente e versoes obsoletas sem gravar', () => {
  const server = agendaServer();
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.AGENDA_CFG.col.participanteCadastroId = 53;
  server.AGENDA_CFG.lastCol = 53;
  const idx = server.AGENDA_CFG.idx;
  const origem = backupTestRow(server, 'ORIGEM-GUARD', { data: backupTestDate(-1), backup: {} });
  const destino = backupTestRow(server, 'DESTINO-GUARD', { courier2: { nome: 'DHL', status: 'Não Agendado' } });
  const sheet = new FakeSheet('Agenda', [Array(server.AGENDA_CFG.lastCol).fill(''), origem, destino]);
  const context = backupTestServer(sheet);
  const sourceRow = sheet.getRange(2, 1, 1, context.AGENDA_CFG.lastCol).getValues()[0];
  const targetRow = sheet.getRange(3, 1, 1, context.AGENDA_CFG.lastCol).getValues()[0];
  const payload = {
    origemId: 'ORIGEM-GUARD', destinoId: 'DESTINO-GUARD', slot: 'II',
    origemVersion: context.agendaRecordVersionFromRow_(sourceRow),
    destinoVersion: context.agendaRecordVersionFromRow_(targetRow)
  };
  const before = JSON.stringify(sheet.rows);
  const occupied = context.aplicarBackupEmVisitaFutura(payload);
  assert.match(occupied.erro, /Transporte II já foi preenchido/);
  assert.equal(JSON.stringify(sheet.rows), before);

  sheet.rows[2][idx.c2.nome] = '';
  sheet.rows[2][idx.c2.status] = '';
  sheet.rows[2][idx.participanteCadastroId] = 'outra-pessoa';
  const mismatchedVersion = context.agendaRecordVersionFromRow_(sheet.rows[2]);
  const mismatch = context.aplicarBackupEmVisitaFutura(Object.assign({}, payload, { destinoVersion: mismatchedVersion }));
  assert.match(mismatch.erro, /não é mais elegível/);
  assert.equal(sheet.rows[2][idx.c2.nome], '');

  sheet.rows[2][idx.participanteCadastroId] = 'pessoa-1';
  const stale = context.aplicarBackupEmVisitaFutura(Object.assign({}, payload, { destinoVersion: 'stale-version' }));
  assert.equal(stale.conflito, true);
  assert.equal(sheet.rows[2][idx.c2.nome], '');
});

test('vincular backup é idempotente e exige o lock de documento', () => {
  const server = agendaServer();
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.AGENDA_CFG.col.participanteCadastroId = 53;
  server.AGENDA_CFG.lastCol = 53;
  const origem = backupTestRow(server, 'ORIGEM-IDEMPOTENTE', { data: backupTestDate(-1), backup: {} });
  const destino = backupTestRow(server, 'DESTINO-IDEMPOTENTE');
  const sheet = new FakeSheet('Agenda', [Array(server.AGENDA_CFG.lastCol).fill(''), origem, destino]);
  const context = backupTestServer(sheet);
  let invalidacoes = 0;
  context.agendaInvalidateWindowCache_ = () => { invalidacoes++; };
  const payload = {
    origemId: 'ORIGEM-IDEMPOTENTE', destinoId: 'DESTINO-IDEMPOTENTE', slot: 'III',
    origemVersion: context.agendaRecordVersionFromRow_(sheet.rows[1]),
    destinoVersion: context.agendaRecordVersionFromRow_(sheet.rows[2])
  };
  const first = context.aplicarBackupEmVisitaFutura(payload);
  const writesAfterFirst = sheet.writes;
  const second = context.aplicarBackupEmVisitaFutura(payload);
  assert.equal(first.ok, true);
  assert.equal(second.jaVinculado, true);
  assert.equal(sheet.writes, writesAfterFirst);
  assert.equal(invalidacoes, 1, 'a gravação deve invalidar o cache uma única vez');

  sheet.rows[2][context.AGENDA_CFG.idx.c3.status] = 'Agendado';
  sheet.rows[2][context.AGENDA_CFG.idx.c3.awb] = 'AWB-III';
  assert.equal(context.aplicarBackupEmVisitaFutura(payload).jaVinculado, true,
    'o avanço normal do transporte não altera a identidade do vínculo');

  const outraTentativa = context.aplicarBackupEmVisitaFutura(Object.assign({}, payload, {
    destinoVersion: context.agendaRecordVersionFromRow_(sheet.rows[2])
  }));
  assert.equal(outraTentativa.conflito, true, 'versões diferentes não identificam a mesma tentativa');
  assert.equal(invalidacoes, 1);

  sheet.rows[2][context.AGENDA_CFG.idx.c3.destino] = 'Outro laboratório';
  const slotAlterado = context.aplicarBackupEmVisitaFutura(payload);
  assert.equal(slotAlterado.conflito, true, 'um slot alterado não deve ser confirmado como vínculo válido');
  assert.equal(sheet.writes, writesAfterFirst);
  assert.equal(invalidacoes, 1);

  sheet.rows[2][context.AGENDA_CFG.idx.c3.destino] = 'Laboratório Central';
  sheet.rows[2][context.AGENDA_CFG.idx.projeto] = 'Outro projeto';
  assert.equal(context.aplicarBackupEmVisitaFutura(payload).conflito, true,
    'a visita precisa continuar pertencendo ao mesmo projeto');

  const withoutLock = backupTestServer(sheet, { lockAvailable: false });
  assert.throws(() => withoutLock.aplicarBackupEmVisitaFutura(payload), /Outra operação está gravando/);
});

test('falha ao gravar a referencia restaura o slot de transporte antes de retornar erro', () => {
  const server = agendaServer();
  server.AGENDA_CFG.idx.participanteCadastroId = 52;
  server.AGENDA_CFG.col.participanteCadastroId = 53;
  server.AGENDA_CFG.lastCol = 53;
  const origem = backupTestRow(server, 'ORIGEM-ROLLBACK', { data: backupTestDate(-1), backup: {} });
  const destino = backupTestRow(server, 'DESTINO-ROLLBACK');
  const sheet = new FakeSheet('Agenda', [Array(server.AGENDA_CFG.lastCol).fill(''), origem, destino]);
  const context = backupTestServer(sheet);
  let invalidacoes = 0;
  context.agendaInvalidateWindowCache_ = () => { invalidacoes++; };
  const getRange = sheet.getRange.bind(sheet);
  let failOnce = true;
  sheet.getRange = (...args) => {
    const range = getRange(...args);
    const setValue = range.setValue.bind(range);
    range.setValue = (value) => {
      if (failOnce && args[0] === 2 && args[1] === context.AGENDA_CFG.col.backupAgendaRef) {
        failOnce = false;
        throw new Error('falha simulada no vinculo');
      }
      return setValue(value);
    };
    return range;
  };
  const payload = {
    origemId: 'ORIGEM-ROLLBACK', destinoId: 'DESTINO-ROLLBACK', slot: 'II',
    origemVersion: context.agendaRecordVersionFromRow_(sheet.rows[1]),
    destinoVersion: context.agendaRecordVersionFromRow_(sheet.rows[2])
  };
  const before = JSON.stringify(sheet.rows);

  assert.throws(() => context.aplicarBackupEmVisitaFutura(payload), /falha simulada no vinculo/);
  assert.equal(JSON.stringify(sheet.rows), before);
  assert.equal(invalidacoes, 1, 'o rollback deve descartar leituras parciais em cache');
});

test('sincronizacao AWB respeita o slot do vinculo e mantem legado como Transporte I', () => {
  const server = agendaServer();
  const cfg = server.AGENDA_CFG;
  const origin = Array(cfg.lastCol).fill('');
  origin[cfg.idx.id] = 'origem-slot-awb';
  origin[cfg.idx.backupAgendaRef] = JSON.stringify({ id: 'destino-slot-awb', slot: 'II', data: '25/09/2026', dataIso: '2026-09-25', hora: '12:00' });
  const legacyOrigin = Array(cfg.lastCol).fill('');
  legacyOrigin[cfg.idx.id] = 'origem-legado-awb';
  legacyOrigin[cfg.idx.backupAgendaRef] = JSON.stringify({ id: 'destino-slot-awb', data: '25/09/2026', dataIso: '2026-09-25', hora: '12:00' });
  const destination = Array(cfg.lastCol).fill('');
  destination[cfg.idx.id] = 'destino-slot-awb';
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), origin, legacyOrigin, destination]);
  server.codexWriteAuditChanges_ = () => {};

  server.agendaAtualizarBackupAwbVinculado_(sheet, 4, 'AWB-III', 'III');
  assert.equal(JSON.parse(sheet.rows[1][cfg.idx.backupAgendaRef]).awb, undefined);
  server.agendaAtualizarBackupAwbVinculado_(sheet, 4, 'AWB-II', 'II');
  assert.equal(JSON.parse(sheet.rows[1][cfg.idx.backupAgendaRef]).awb, 'AWB-II');
  assert.equal(JSON.parse(sheet.rows[2][cfg.idx.backupAgendaRef]).awb, undefined);
  server.agendaAtualizarBackupAwbVinculado_(sheet, 4, 'AWB-I');
  assert.equal(JSON.parse(sheet.rows[2][cfg.idx.backupAgendaRef]).awb, 'AWB-I');
});

test('interface oferece os dois caminhos e mantém o modal da Agenda durante a vinculação', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const server = readProjectFile('WebApp.gs');

  assert.match(content, /Criar novo Envio de Amostras/);
  assert.match(content, /Usar visita futura/);
  assert.match(content, /aria-controls="backupAgendaActions"/);
  assert.match(client, /appHasUnsavedChanges\('agendaCreatePanel'\)/);
  assert.match(client, /getAgendaVisitasFuturasParaBackup\(origemId\)/);
  assert.match(client, /\.aplicarBackupEmVisitaFutura\(/);
  assert.match(client, /_agendaEditRecord\s*=\s*agendaStoreEventoLocal_\(res\.origem\)/);
  assert.match(client, /setAgendaSelectValue\('agBackupStatus', res\.origem\.backup && res\.origem\.backup\.status\)/);
  assert.match(server, /function getAgendaVisitasFuturasParaBackup\(origemId\)/);
  assert.match(server, /function aplicarBackupEmVisitaFutura\(payload\)/);
});
