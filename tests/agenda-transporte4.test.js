'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

const LABELS = ['Courier', 'Temperatura', 'Status', 'AWB', 'Material', 'Destino', 'Material estruturado']
  .map(label => 'Transporte IV - ' + label);
const BASE_COLUMNS = 54;

function serverFor(sheet) {
  const server = runFile('WebApp.gs', {
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
    SpreadsheetApp: { flush() {} }
  });
  Object.assign(server.AGENDA_CFG.idx, { participanteCadastroId: 52, backup2Dados: 53 });
  Object.assign(server.AGENDA_CFG.col, { participanteCadastroId: 53, backup2Dados: 54 });
  server.AGENDA_CFG.lastCol = BASE_COLUMNS;
  server.codexAssertCanRead_ = server.codexAssertCanWrite_ = server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'admin' });
  server.codexWriteAuditChanges_ = server.codexLogPerformance_ = () => {};
  server.getAgendaSheetForRead_ = server.getAgendaSheet_ = () => sheet;
  server.LockService = { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }), getScriptLock: () => null };
  server.Utilities = { formatDate: value => new Date(value).toISOString().slice(0, 19) };
  server.Session = { getScriptTimeZone: () => 'America/Sao_Paulo' };
  server.formatarDataSafe = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  };
  server.formatarDataIsoAgenda_ = server.formatarDataSafe;
  server.formatarHoraSafe_ = value => value instanceof Date ? value.toISOString().slice(11, 16) : String(value || '00:00');
  return server;
}

function fixture({ withColumns } = {}) {
  const sheet = new FakeSheet('Agenda', []);
  const server = serverFor(sheet);
  const idx = server.AGENDA_CFG.idx;
  const width = BASE_COLUMNS + (withColumns ? LABELS.length : 0);
  const headers = Array(width).fill('');
  headers[53] = 'Backup II - Dados';
  if (withColumns) LABELS.forEach((label, index) => { headers[BASE_COLUMNS + index] = label; });
  const row = (id, days) => {
    const result = Array(width).fill('');
    const date = new Date();
    date.setDate(date.getDate() + days);
    result[idx.id] = id;
    result[idx.data] = date.toISOString().slice(0, 10);
    result[idx.hora] = '12:00';
    result[idx.tipo] = 'Visita';
    result[idx.status] = 'Agendado';
    result[idx.participante] = 'Pessoa Teste';
    result[idx.participanteCadastroId] = 'pessoa-1';
    result[idx.projeto] = 'Projeto A';
    result[idx.visita] = 'Visita 1';
    result[idx.labCentral] = 'Sim';
    return result;
  };
  const origin = row('origem', -1);
  origin[idx.cb.nome] = 'OCASA';
  origin[idx.cb.temp] = 'CONGELADO';
  origin[idx.cb.status] = 'Não Agendado';
  origin[idx.cb.material] = 'Plasma';
  origin[idx.cb.destino] = 'Laboratório Central';
  sheet.rows = [headers, origin, row('destino', 5)];
  sheet.maxColumns = width;
  if (withColumns) server.agendaResolveTransporte4Columns_(sheet, headers, false);
  return { server, sheet, idx };
}

test('Transporte IV ausente no schema legado e lido como vazio sem criar colunas nem escrever', () => {
  const { server, sheet, idx } = fixture();
  const before = JSON.stringify(sheet.rows);
  assert.equal(server.agendaResolveTransporte4Columns_(sheet, sheet.rows[0], false), 0);
  assert.equal(server.agendaTransporte4Disponivel_(), false);
  assert.deepEqual(Object.values(idx.c4), Array(7).fill(-1));
  const object = server.agendaRowToObject_(sheet.rows[1], 2);
  assert.deepEqual(JSON.parse(JSON.stringify(object.courier4)), { nome: '', temperatura: '', status: '', awb: '', material: '', destino: '', matBioJson: '' });
  assert.equal(sheet.writes, 0);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('Transporte IV preserva a versao do registro enquanto as colunas nao existem', () => {
  const legacy = fixture();
  const withColumns = fixture({ withColumns: true });
  assert.equal(legacy.server.agendaEditableRecordVersionValuesFromRow_(legacy.sheet.rows[1]).length + 7,
    withColumns.server.agendaEditableRecordVersionValuesFromRow_(withColumns.sheet.rows[1]).length,
    'sem as colunas a composicao da versao e a mesma dos registros legados');
  const before = withColumns.server.agendaRecordVersionFromRow_(withColumns.sheet.rows[1]);
  withColumns.sheet.rows[1][withColumns.idx.c4.nome] = 'DHL';
  assert.notEqual(withColumns.server.agendaRecordVersionFromRow_(withColumns.sheet.rows[1]), before,
    'alterar o Transporte IV altera a versao usada na protecao de edicao concorrente');
});

test('caminho de escrita cria as sete colunas ao fim uma unica vez, sem tocar nas existentes', () => {
  const { server, sheet, idx } = fixture();
  const first = sheet.rows[1].slice();
  const column = server.agendaResolveTransporte4Columns_(sheet, null, true);
  assert.equal(column, BASE_COLUMNS + 1);
  assert.deepEqual(sheet.rows[0].slice(BASE_COLUMNS), LABELS);
  assert.deepEqual(Object.values(idx.c4), [54, 55, 56, 57, 58, 59, 60]);
  assert.equal(server.AGENDA_CFG.lastCol, BASE_COLUMNS + 7);
  assert.deepEqual(sheet.rows[1].slice(0, BASE_COLUMNS), first.slice(0, BASE_COLUMNS));
  const headers = JSON.stringify(sheet.rows[0]);
  server.agendaResolveTransporte4Columns_(sheet, null, true);
  assert.equal(JSON.stringify(sheet.rows[0]), headers, 'segunda chamada e idempotente');
});

test('colunas do Transporte IV sao localizadas pelo cabecalho, em qualquer posicao', () => {
  const { server, sheet, idx } = fixture({ withColumns: true });
  sheet.rows.forEach(row => row.splice(10, 0, 'coluna inserida'));
  sheet.rows[0][10] = 'Outro campo';
  server.agendaResolveTransporte4Columns_(sheet, sheet.rows[0], false);
  assert.equal(idx.c4.nome, BASE_COLUMNS + 1);
  assert.equal(idx.c4.matBio, BASE_COLUMNS + 7);
});

test('cabecalhos parciais mantem o Transporte IV indisponivel em leitura', () => {
  const { server, sheet, idx } = fixture({ withColumns: true });
  sheet.rows[0][BASE_COLUMNS + 3] = '';
  server.agendaResolveTransporte4Columns_(sheet, sheet.rows[0], false);
  assert.equal(server.agendaTransporte4Disponivel_(), false);
  assert.equal(idx.c4.nome, -1);
});

test('salvar Transporte IV grava courier, AWB, material e destino e le de volta no courier4', () => {
  const { server, sheet, idx } = fixture({ withColumns: true });
  server.agendaGravarTransportesDoEvento_(sheet, 3, {
    tipo: 'Visita',
    courier4: { nome: 'DHL', temperatura: 'AMBIENTE', status: 'Não Agendado', material: 'Soro', destino: 'Laboratório Central', matBioJson: '' }
  }, 'Sim');
  const row = sheet.rows[2];
  assert.equal(row[idx.c4.nome], 'DHL');
  assert.equal(row[idx.c4.temp], 'AMBIENTE');
  assert.equal(row[idx.c4.status], 'Não Agendado');
  assert.equal(row[idx.c4.destino], 'Laboratório Central');
  const object = server.agendaRowToObject_(row, 3);
  assert.equal(object.courier4.nome, 'DHL');
  assert.equal(object.courier4.destino, 'Laboratório Central');
});

test('payload legado que omite courier4 preserva o Transporte IV existente', () => {
  const { server, sheet, idx } = fixture({ withColumns: true });
  Object.assign(sheet.rows[2], {});
  sheet.rows[2][idx.c4.nome] = 'DHL';
  sheet.rows[2][idx.c4.destino] = 'Laboratório Central';
  sheet.rows[2][idx.c4.matBio] = '{"items":[]}';
  const before = sheet.rows[2].slice(idx.c4.nome, idx.c4.matBio + 1);
  server.agendaGravarTransportesDoEvento_(sheet, 3, { tipo: 'Visita', courier1: { nome: 'MARKEN' } }, 'Sim');
  assert.deepEqual(sheet.rows[2].slice(idx.c4.nome, idx.c4.matBio + 1), before);
});

test('courier4 sem colunas na planilha nao grava em coluna invalida', () => {
  const { server, sheet } = fixture();
  const before = JSON.stringify(sheet.rows);
  server.agendaSetCourierLinha_(sheet, 3, server.AGENDA_CFG.idx.c4, { nome: 'DHL', awb: '1234567890', awbTouched: true });
  assert.equal(JSON.stringify(sheet.rows), before);
  assert.equal(sheet.writes, 0);
});

test('Backup pode usar o Transporte IV vazio de uma visita futura e repete sem gravacao', () => {
  const { server, sheet, idx } = fixture({ withColumns: true });
  const visitas = server.getAgendaVisitasFuturasParaBackup('origem', 'backup');
  assert.equal(visitas.visitas.length, 1);
  assert.equal(visitas.visitas[0].transporteIV.disponivel, true);
  const request = {
    origemId: 'origem', destinoId: 'destino', backupSlot: 'backup', slot: 'IV',
    origemVersion: server.agendaRecordVersionFromRow_(sheet.rows[1]),
    destinoVersion: server.agendaRecordVersionFromRow_(sheet.rows[2])
  };
  const result = server.aplicarBackupEmVisitaFutura(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.origem.backup.agendamento.slot, 'IV');
  assert.equal(sheet.rows[2][idx.c4.nome], 'OCASA');
  assert.equal(sheet.rows[2][idx.c4.temp], 'CONGELADO');
  assert.equal(sheet.rows[2][idx.c4.status], 'Não Agendado');
  assert.equal(sheet.rows[2][idx.c3.nome], '');
  const writes = sheet.writes;
  assert.equal(server.aplicarBackupEmVisitaFutura(request).jaVinculado, true);
  assert.equal(sheet.writes, writes);
});

test('Transporte IV ocupado ou ausente nao e oferecido nem aceito para o Backup', () => {
  const { server, sheet, idx } = fixture({ withColumns: true });
  sheet.rows[2][idx.c4.nome] = 'DHL';
  assert.equal(server.getAgendaVisitasFuturasParaBackup('origem', 'backup').visitas[0].transporteIV.disponivel, false);
  const request = {
    origemId: 'origem', destinoId: 'destino', backupSlot: 'backup', slot: 'IV',
    origemVersion: server.agendaRecordVersionFromRow_(sheet.rows[1]),
    destinoVersion: server.agendaRecordVersionFromRow_(sheet.rows[2])
  };
  const before = JSON.stringify(sheet.rows);
  assert.match(server.aplicarBackupEmVisitaFutura(request).erro, /Transporte IV já foi preenchido/);
  assert.equal(JSON.stringify(sheet.rows), before);

  const legacy = fixture();
  legacy.sheet.rows[2][legacy.idx.c2.nome] = 'DHL';
  legacy.sheet.rows[2][legacy.idx.c3.nome] = 'OCASA';
  assert.equal(legacy.server.getAgendaVisitasFuturasParaBackup('origem', 'backup').visitas.length, 0,
    'sem as colunas do Transporte IV, II e III ocupados nao deixam slot disponivel');
});

test('AWB do Transporte IV e unica e reconhecida como slot 4 no contexto de AWBs', () => {
  const { server, sheet, idx } = fixture({ withColumns: true });
  sheet.rows[1][idx.c4.awb] = 'AWB-IV-UNICA';
  sheet.rows[1][idx.c4.nome] = 'PINEX';
  const entry = server.agendaAwbRegistro_(sheet.rows[1], 4);
  assert.equal(entry.slot, '4');
  assert.equal(entry.awb, 'AWB-IV-UNICA');
  assert.equal(entry.courier, 'PINEX');
  assert.equal(entry.owner, 'AGD:ORIGEM:4');
  assert.match(server.agendaAwbMensagem_('AWB-IV-UNICA', entry), /Transporte IV/);
});

test('pendencias, dashboard e auditoria reconhecem o Transporte IV', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'WebApp.gs'), 'utf8');
  assert.match(source, /label: 'Transporte IV', cfg: i\.c4/);
  assert.match(source, /field: 'Transporte IV - AWB', idx: i\.c4\.awb/);
  assert.match(source, /\[i\.c1, i\.c2, i\.c3, i\.c4\]/);
});
