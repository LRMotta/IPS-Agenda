'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

function serverFor(sheet, options = {}) {
  const server = runFile('WebApp.gs', {
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
    SpreadsheetApp: { flush() {} }
  });
  Object.assign(server.AGENDA_CFG.idx, { participanteCadastroId: 52, backup2Dados: 53 });
  Object.assign(server.AGENDA_CFG.col, { participanteCadastroId: 53, backup2Dados: 54 });
  server.AGENDA_CFG.lastCol = 54;
  server.codexAssertCanRead_ = server.codexAssertCanWrite_ = server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role: 'admin' });
  server.codexWriteAuditChanges_ = server.codexLogPerformance_ = () => {};
  server.getAgendaSheetForRead_ = server.getAgendaSheet_ = () => sheet;
  server.LockService = { getDocumentLock: () => ({ tryLock: () => options.lockAvailable !== false, releaseLock() {} }), getScriptLock: () => null };
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

function backup2(overrides = {}) {
  return Object.assign({ nome: 'MARKEN', temperatura: 'REFRIGERADO', status: 'Não Agendado', material: 'Soro', destino: 'Laboratório Central', matBioJson: '[{"key":"soro","quantidade":2}]' }, overrides);
}

function fixture() {
  const sheet = new FakeSheet('Agenda', []);
  const server = serverFor(sheet);
  const idx = server.AGENDA_CFG.idx;
  const headers = Array(54).fill('');
  headers[53] = 'Backup II - Dados';
  const row = (id, days) => {
    const result = Array(54).fill('');
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
  origin[idx.cb.destino] = 'Outro laboratório';
  origin[idx.backup2Dados] = JSON.stringify(backup2());
  sheet.rows = [headers, origin, row('destino', 5)];
  sheet.maxColumns = 54;
  return { server, sheet, idx };
}

function payload(server, sheet, slot = 'II') {
  return { origemId: 'origem', destinoId: 'destino', backupSlot: 'backup2', slot,
    origemVersion: server.agendaRecordVersionFromRow_(sheet.rows[1]),
    destinoVersion: server.agendaRecordVersionFromRow_(sheet.rows[2]) };
}

test('Backup II ausente no schema legado e lido sem criar colunas nem escrever', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows.forEach(row => row.pop());
  sheet.maxColumns = 53;
  const before = JSON.stringify(sheet.rows);
  assert.equal(server.agendaResolveBackup2Column_(sheet, sheet.rows[0], false), 0);
  const object = server.agendaRowToObject_(sheet.rows[1], 2);
  assert.equal(object.backup.nome, 'OCASA');
  assert.equal(object.backup.temperatura, 'CONGELADO');
  assert.equal(object.backup2.nome, '');
  assert.equal(object.backup2.agendamento, null);
  assert.equal(sheet.rows[1][idx.cb.nome], 'OCASA');
  assert.equal(sheet.writes, 0);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('Backup II localiza coluna dinamica e grava dados sem modificar Backup I ou coluna legada', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows.forEach(row => row.push('dado legado', row.pop()));
  sheet.rows[0][53] = 'Campo legado';
  sheet.rows[0][54] = 'Backup II - Dados';
  sheet.maxColumns = 55;
  assert.equal(server.agendaResolveBackup2Column_(sheet, sheet.rows[0], false), 55);
  const first = sheet.rows[1].slice(0, 54);
  server.agendaBackup2Write_(sheet, 2, backup2({ temperatura: 'CONGELADO', nome: 'DHL' }));
  assert.deepEqual(sheet.rows[1].slice(0, 54), first);
  assert.equal(server.agendaBackup2FromRow_(sheet.rows[1]).nome, 'DHL');
  assert.equal(sheet.rows[1][idx.cb.nome], 'OCASA');
});

test('salvar transporte com payload legado omitindo Backup II preserva seu envio e vinculos', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows[1][idx.backup2Dados] = JSON.stringify(backup2({ status: 'Adicionado à Agenda', agendamentos: [{ id: 'outro-envio', slot: 'III', awb: 'AWB-BACKUP-II' }] }));
  const before = sheet.rows[1][idx.backup2Dados];
  server.agendaGravarTransportesDoEvento_(sheet, 2, { tipo: 'Visita', backup: { nome: 'OCASA', temperatura: 'CONGELADO' } }, 'Sim');
  assert.equal(sheet.rows[1][idx.backup2Dados], before);
});

for (const [roman, cfg] of [['II', 'c2'], ['III', 'c3']]) {
  test(`Backup II usa somente Transporte ${roman}, preserva Backup I e repete sem gravacao`, () => {
    const { server, sheet, idx } = fixture();
    const firstBackup = sheet.rows[1].slice(0, idx.backup2Dados);
    const request = payload(server, sheet, roman);
    const result = server.aplicarBackupEmVisitaFutura(request);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.origem.backup2.agendamento.id, 'destino');
    assert.equal(result.origem.backup2.agendamento.slot, roman);
    assert.equal(result.origem.backup2.status, 'Adicionado à Agenda');
    assert.deepEqual(sheet.rows[1].slice(0, idx.backup2Dados), firstBackup);
    assert.equal(sheet.rows[2][idx[cfg].temp], 'REFRIGERADO');
    assert.equal(sheet.rows[2][idx[cfg].nome], 'MARKEN');
    assert.equal(sheet.rows[2][idx[cfg === 'c2' ? 'c3' : 'c2'].nome], '');
    const writes = sheet.writes;
    assert.equal(server.aplicarBackupEmVisitaFutura(request).jaVinculado, true);
    assert.equal(sheet.writes, writes);
  });
}

test('Backup II rejeita versao obsoleta, slot ocupado e lock indisponivel sem gravar', () => {
  const { server, sheet, idx } = fixture();
  const request = payload(server, sheet);
  const before = JSON.stringify(sheet.rows);
  assert.equal(server.aplicarBackupEmVisitaFutura(Object.assign({}, request, { origemVersion: 'versao-obsoleta' })).conflito, true);
  assert.equal(JSON.stringify(sheet.rows), before);
  sheet.rows[2][idx.c2.nome] = 'DHL';
  const occupiedBefore = JSON.stringify(sheet.rows);
  const occupied = server.aplicarBackupEmVisitaFutura(payload(server, sheet));
  assert.match(occupied.erro, /Transporte II já foi preenchido/);
  assert.equal(JSON.stringify(sheet.rows), occupiedBefore);
  const lockedServer = serverFor(sheet, { lockAvailable: false });
  assert.throws(() => lockedServer.aplicarBackupEmVisitaFutura(request), /Outra operação está gravando/);
  assert.equal(JSON.stringify(sheet.rows), occupiedBefore);
});

test('alteracao concorrente no Backup II muda a versao e impede vincular o snapshot anterior', () => {
  const { server, sheet, idx } = fixture();
  const request = payload(server, sheet);
  sheet.rows[1][idx.backup2Dados] = JSON.stringify(backup2({ temperatura: 'CONGELADO' }));
  assert.notEqual(server.agendaRecordVersionFromRow_(sheet.rows[1]), request.origemVersion);
  const before = JSON.stringify(sheet.rows);
  assert.equal(server.aplicarBackupEmVisitaFutura(request).conflito, true);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('dois backups da mesma origem podem vincular ao mesmo destino em slots distintos', () => {
  const { server, sheet, idx } = fixture();
  const first = server.aplicarBackupEmVisitaFutura(Object.assign(payload(server, sheet), { backupSlot: 'backup' }));
  assert.equal(first.ok, true, JSON.stringify(first));
  const firstRef = sheet.rows[1][idx.backupAgendaRef];
  const second = server.aplicarBackupEmVisitaFutura(payload(server, sheet, 'III'));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(sheet.rows[1][idx.backupAgendaRef], firstRef);
  assert.equal(sheet.rows[2][idx.c2.temp], 'CONGELADO');
  assert.equal(sheet.rows[2][idx.c3.temp], 'REFRIGERADO');
  server.agendaAtualizarBackupAwbVinculado_(sheet, 3, 'AWB-II', 'II');
  server.agendaAtualizarBackupAwbVinculado_(sheet, 3, 'AWB-III', 'III');
  const origin = server.agendaRowToObject_(sheet.rows[1], 2);
  assert.equal(origin.backup.awb, 'AWB-II');
  assert.equal(origin.backup2.awb, 'AWB-III');
});

test('Backup II invalido nao e tratado como vazio nem sobrescrito silenciosamente', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows[1][idx.backup2Dados] = '{json corrompido';
  const before = JSON.stringify(sheet.rows);
  assert.throws(() => server.agendaBackup2FromRow_(sheet.rows[1]), /Backup II estão inválidos/);
  assert.throws(() => server.agendaBackup2Write_(sheet, 2, backup2()), /Backup II estão inválidos/);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('Backup II restaura envio e transporte se a gravacao do vinculo falhar', () => {
  const { server, sheet, idx } = fixture();
  const request = payload(server, sheet);
  const before = JSON.stringify(sheet.rows);
  const getRange = sheet.getRange.bind(sheet);
  let fail = true;
  sheet.getRange = (...args) => {
    const range = getRange(...args);
    const setValue = range.setValue.bind(range);
    range.setValue = value => {
      if (fail && args[0] === 2 && args[1] === idx.backup2Dados + 1) {
        fail = false;
        throw new Error('falha simulada no Backup II');
      }
      return setValue(value);
    };
    return range;
  };
  assert.throws(() => server.aplicarBackupEmVisitaFutura(request), /falha simulada no Backup II/);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('AWB do Backup II segue apenas seu destino e slot sem atualizar Backup I', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows[1][idx.backupAgendaRef] = JSON.stringify({ id: 'destino', slot: 'II', awb: 'AWB-I' });
  sheet.rows[1][idx.backup2Dados] = JSON.stringify(backup2({ status: 'Adicionado à Agenda', agendamentos: [{ id: 'destino', slot: 'III' }] }));
  server.agendaAtualizarBackupAwbVinculado_(sheet, 3, 'AWB-III', 'III');
  assert.equal(server.agendaBackup2FromRow_(sheet.rows[1]).awb, 'AWB-III');
  assert.equal(JSON.parse(sheet.rows[1][idx.backupAgendaRef]).awb, 'AWB-I');
  server.agendaAtualizarBackupAwbVinculado_(sheet, 3, 'AWB-II', 'II');
  assert.equal(JSON.parse(sheet.rows[1][idx.backupAgendaRef]).awb, 'AWB-II');
  assert.equal(server.agendaBackup2FromRow_(sheet.rows[1]).awb, 'AWB-III');
});

test('consulta do Backup II usa seus dados mesmo com Backup I vazio e exige autorizacao', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows[1][idx.cb.nome] = '';
  const result = server.getAgendaVisitasFuturasParaBackup('origem', 'backup2');
  assert.equal(result.visitas.length, 1);
  assert.equal(result.visitas[0].id, 'destino');
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: false, message: 'Acesso negado' });
  assert.throws(() => server.getAgendaVisitasFuturasParaBackup('origem', 'backup2'), /Acesso negado/);
});

test('novo envio do Backup II vincula ao Transporte I e preserva integralmente o Backup I', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows[1][idx.backupAgendaRef] = JSON.stringify({ id: 'envio-do-backup-i', awb: 'AWB-ANTERIOR-I' });
  sheet.rows[2][idx.tipo] = 'Envio de amostras';
  sheet.rows[2][idx.c1.awb] = 'AWB-NOVO-ENVIO';
  const firstBackup = sheet.rows[1].slice(0, idx.backup2Dados);
  const date = new Date(2099, 0, 15, 12, 30);
  server.formatAgendaHora_ = () => '12:30';
  const ref = server.agendaVincularBackupAoAgendamento_(sheet, 'origem', 'destino', date, 'backup2');
  assert.equal(ref.id, 'destino');
  assert.equal(ref.awb, 'AWB-NOVO-ENVIO');
  assert.equal(String(ref.slot || 'I'), 'I');
  assert.deepEqual(sheet.rows[1].slice(0, idx.backup2Dados), firstBackup);
  const secondBackup = server.agendaBackup2FromRow_(sheet.rows[1]);
  assert.equal(secondBackup.status, 'Adicionado à Agenda');
  assert.equal(secondBackup.agendamento.id, 'destino');
  assert.equal(secondBackup.agendamento.hora, '12:30');
  assert.equal(secondBackup.awb, 'AWB-NOVO-ENVIO');
  server.agendaAtualizarBackupAwbVinculado_(sheet, 3, 'AWB-I-ATUALIZADA', 'I');
  assert.equal(server.agendaBackup2FromRow_(sheet.rows[1]).awb, 'AWB-I-ATUALIZADA');
  assert.deepEqual(sheet.rows[1].slice(0, idx.backup2Dados), firstBackup);
});

test('pendencias contam separadamente os dois backups nao agendados mesmo em visita historica concluida', () => {
  const { server, sheet, idx } = fixture();
  sheet.rows = sheet.rows.slice(0, 2);
  sheet.rows[1][idx.status] = 'Concluído';
  server.getAgendaFeriadosPendenciasMap_ = () => ({});
  const pendencias = server.getDashboardPendencias_([]);
  assert.equal(pendencias.counts.transporteBackupNaoAgendado, 2);
  assert.equal(pendencias.transporteBackupNaoAgendado.length, 2);
  const first = pendencias.transporteBackupNaoAgendado.find(item => item.slot === 'Transporte de Amostras Backup');
  const second = pendencias.transporteBackupNaoAgendado.find(item => item.slot === 'Transporte de Amostras Backup II');
  assert.equal(first.agendaId, 'origem');
  assert.equal(first.courier, 'OCASA');
  assert.equal(first.temperatura, 'CONGELADO');
  assert.equal(second.agendaId, 'origem');
  assert.equal(second.courier, 'MARKEN');
  assert.equal(second.temperatura, 'REFRIGERADO');
  assert.equal(second.statusCourier, 'Não Agendado');
  sheet.rows[1][idx.backup2Dados] = JSON.stringify(backup2({ status: 'Agendado' }));
  const updated = server.getDashboardPendencias_([]);
  assert.equal(updated.counts.transporteBackupNaoAgendado, 1);
  assert.equal(updated.transporteBackupNaoAgendado[0].slot, 'Transporte de Amostras Backup');
});

test('materiais anteriores detectam Backup II sozinho e devolvem materiais dos dois backups sem mistura', () => {
  const { server, sheet, idx } = fixture();
  const row = sheet.rows[1];
  row[idx.cb.material] = '';
  row[idx.cb.matBio] = '';
  assert.equal(server.agendaLinhaTemMaterialAnterior_(row), true);
  assert.equal(server.agendaLinhaTemMaterialAnterior_(row, 'backup2'), true);
  assert.equal(server.agendaLinhaTemMaterialAnterior_(row, idx.cb), false);
  row[idx.cb.material] = 'Plasma congelado';
  const previous = server.agendaMaterialAnteriorFromRow_(row, 2, 'pessoa-1', 'projeto-1');
  assert.equal(previous.id, 'origem');
  assert.equal(previous.projetoId, 'projeto-1');
  assert.equal(previous.backup.material, 'Plasma congelado');
  assert.equal(previous.backup2.material, 'Soro');
  assert.equal(previous.backup2.matBioJson, backup2().matBioJson);
  const withoutSecondMaterial = row.slice();
  withoutSecondMaterial[idx.cb.material] = '';
  withoutSecondMaterial[idx.backup2Dados] = JSON.stringify(backup2({ material: '', matBioJson: '' }));
  assert.equal(server.agendaLinhaTemMaterialAnterior_(withoutSecondMaterial), false);
  const noLab = row.slice();
  noLab[idx.labCentral] = 'Não';
  assert.equal(server.agendaLinhaTemMaterialAnterior_(noLab, 'backup2'), false);
});
