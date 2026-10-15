'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture() {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const c = runFile('WebApp.gs', { AgendaServerRules_: rules, SpreadsheetApp: { getActiveSpreadsheet: () => ({}) } });
  const row = Array(c.AGENDA_CFG.lastCol).fill('');
  row[c.AGENDA_CFG.idx.id] = 'TESTE-CONFLITO';
  row[c.AGENDA_CFG.idx.tipo] = 'Visita';
  row[c.AGENDA_CFG.idx.status] = 'Agendado';
  const audits = [];
  const failures = [];
  c.codexAssertCanWrite_ = () => {};
  c.codexWithDocumentLock_ = (_name, fn) => fn();
  c.agendaValidarMaterialBioPayload_ = () => {};
  c.getAgendaSheet_ = () => ({ getRange: () => ({ getValues: () => [row] }) });
  c.agendaLocalizarLinhaPorId_ = () => 2;
  c.codexWriteAuditChanges_ = (...args) => audits.push(args);
  c.codexLogAuditFailure_ = (...args) => failures.push(args);
  const payload = { id: 'TESTE-CONFLITO',
    _recordVersion: c.agendaRecordVersionFromRow_(row),
    _editRecordVersion: c.agendaEditableRecordVersionFromRow_(row),
    _editFieldVersions: c.agendaEditFieldVersionsFromRow_(row) };
  return { c, row, payload, audits, failures };
}

test('conflito registra campos e hashes sem gravar o agendamento ou valores clinicos', () => {
  const { c, row, payload, audits } = fixture();
  row[c.AGENDA_CFG.idx.c1.matBio] = '{"material":"SEGREDO-CLINICO"}';
  const before = row.slice();
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.conflito, true);
  assert.equal(result.diagnostic.reason, 'CAMPOS_DIVERGENTES');
  assert.deepEqual(Array.from(result.diagnostic.fields), ['Transporte I - Material estruturado']);
  assert.deepEqual(row, before);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].slice(0, 3), ['Agenda', 'bloquearEdicaoAgenda', 'TESTE-CONFLITO']);
  assert.match(audits[0][4], /origem=salvar_agendamento/);
  assert.doesNotMatch(JSON.stringify(audits), /SEGREDO-CLINICO/);
  assert.equal(audits[0][3].length, 3);
});

test('referencia ausente ou invalida e explicitada sem inventar campos divergentes', () => {
  for (const mode of ['ausente', 'versao', 'hash', 'sem-edit-version']) {
    const { c, row, payload } = fixture();
    row[c.AGENDA_CFG.idx.status] = 'Realizado';
    if (mode === 'ausente') delete payload._editFieldVersions;
    if (mode === 'versao') payload._editFieldVersions.version = 'outra';
    if (mode === 'hash') payload._editFieldVersions.fields.Status = '<script>inválido</script>';
    if (mode === 'sem-edit-version') delete payload._editRecordVersion;
    const result = c.atualizarAgendaEventoCompleto(payload);
    assert.equal(result.conflito, true);
    assert.equal(result.diagnostic.reason, mode === 'sem-edit-version' ? 'SEM_VERSAO_EDITAVEL' : 'SEM_REFERENCIA_DE_CAMPOS');
    assert.equal(result.diagnostic.fields.length, 0);
  }
});

test('fingerprints adulterados nunca liberam a escrita e apontam referencia inconsistente', () => {
  const { c, row, payload } = fixture();
  row[c.AGENDA_CFG.idx.status] = 'Realizado';
  payload._editFieldVersions.fields = c.agendaEditFieldVersionsFromRow_(row).fields;
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.conflito, true);
  assert.equal(result.diagnostic.reason, 'REFERENCIA_INCONSISTENTE');
});

test('falha de auditoria conserva rejeicao e os dados do agendamento', () => {
  const { c, row, payload, failures } = fixture();
  row[c.AGENDA_CFG.idx.c2.status] = 'Agendado';
  c.codexWriteAuditChanges_ = () => { throw new Error('Falha simulada'); };
  assert.equal(c.atualizarAgendaEventoCompleto(payload).conflito, true);
  assert.equal(failures.length, 1);
});

test('diagnostico diferencia tentativa de Gerar docs sem atribuir a origem da mudanca', () => {
  const { c, row, payload, audits } = fixture();
  row[c.AGENDA_CFG.idx.obs] = 'SEGREDO';
  payload.transporteDocumentosSlot = '1';
  payload.courier1 = { awb: '123', nome: 'Teste' };
  c.codexCourierAssertDocumentAwb_ = () => {};
  assert.equal(c.atualizarAgendaEventoCompleto(payload).conflito, true);
  assert.match(audits[0][4], /origem=gerar_documentos:1/);
  assert.match(audits[0][4], /sem atribuição de autoria/);
});

test('mudancas auxiliares e JSON equivalente continuam tolerados sem diagnostico de conflito', () => {
  const { c, row, payload, audits } = fixture();
  row[c.AGENDA_CFG.idx.controle] = 'Notificado';
  row[c.AGENDA_CFG.idx.reqStatus] = 'Enviado';
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.conflito, undefined);
  assert.equal(audits.length, 0);
  const first = c.agendaEditFieldVersionsFromRow_(row);
  row[c.AGENDA_CFG.idx.c1.matBio] = '{"b":2,"a":1}';
  const second = c.agendaEditFieldVersionsFromRow_(row);
  row[c.AGENDA_CFG.idx.c1.matBio] = '{"a":1,"b":2}';
  assert.deepEqual(c.agendaEditFieldVersionsFromRow_(row), second);
  assert.equal(Object.keys(first.fields).length, c.agendaEditableRecordVersionValuesFromRow_(row).length);
});
