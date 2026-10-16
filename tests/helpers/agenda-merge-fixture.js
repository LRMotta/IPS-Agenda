'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFiles } = require('./load-app-script');
const { FakeSheet } = require('./fake-spreadsheet');

function fixture() {
  let email = 'editor@exemplo.invalid';
  let spreadsheetId = 'BASE-TESTE';
  const props = new Map();
  let locked = false;
  const utilities = {
    getUuid: () => crypto.randomUUID(),
    base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'),
    base64DecodeWebSafe: value => Buffer.from(value, 'base64url'),
    newBlob: value => ({ getDataAsString: () => Buffer.from(value).toString() }),
    computeHmacSha256Signature: (value, key) => crypto.createHmac('sha256', key).update(value).digest(),
    formatDate: (date, _tz, pattern) => {
      const iso = date.toISOString();
      if (pattern === "yyyy-MM-dd'T'HH:mm:ss") return iso.slice(0, 19);
      if (pattern === 'HH:mm') return iso.slice(11, 16);
      return iso.slice(0, 10);
    }
  };
  const c = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'AgendaMerge.gs'], {
    Utilities: utilities, Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key), setProperty: (key, value) => props.set(key, value) }) },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo', getActiveUser: () => ({ getEmail: () => email }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => spreadsheetId }), flush() {} }
  });
  c.agendaUseParticipanteCadastroColumn_(53);
  const i = c.AGENDA_CFG.idx;
  const row = Array(c.AGENDA_CFG.lastCol).fill('');
  Object.entries({ id: 'A', data: new Date(2026, 11, 20, 8, 0), hora: '08:00', tipo: 'Visita', status: 'Agendado', participante: 'Pessoa de teste',
    nasc: '1980-01-01', idParticipante: '001', participanteCadastroId: 'CAD-A', projeto: 'Estudo A', braco: 'Braço A', visita: 'V1',
    labCentral: 'Sim', medico: 'Médico original', obs: 'Observação original', servTerc: 'Prestador original' }).forEach(([key, value]) => { row[i[key]] = value; });
  row[i.c1.nome] = row[i.c2.nome] = 'Marken';
  row[i.c1.temp] = row[i.c2.temp] = 'Ambiente';
  row[i.c1.status] = row[i.c2.status] = 'Não Agendado';
  row[i.c1.awb] = '1234567890';
  const sheet = new FakeSheet('Agenda', [Array(row.length).fill(''), row]);
  const audits = [], validations = [];
  c.getAgendaSheet_ = () => sheet;
  c.getCodexSpreadsheet_ = () => ({ getId: () => spreadsheetId });
  c.codexGetActiveUserEmail_ = () => email;
  c.codexAssertCanWrite_ = () => {};
  c.codexWithDocumentLock_ = (_name, fn) => { const previous = locked; locked = true; try { return fn(); } finally { locked = previous; } };
  c.agendaLocalizarLinhaPorId_ = c.encontrarLinhaPorId = () => 2;
  c.agendaValidarMaterialBioPayload_ = dados => { validations.push(dados); };
  c.agendaSincronizarProjetoDoParticipante_ = () => null;
  c.agendaVisitaCriadaNaMesmaData_ = () => null;
  c.agendaCourierStatusFuturoErro_ = c.agendaRealizadoFuturoErro_ = () => '';
  c.agendaOperationalRiskAlerts_ = () => [];
  c.agendaDateIsBeforeToday_ = () => false;
  c.agendaInvalidateDateIndexCache_ = c.verificarNotificacoes_ = c.agendaAtualizarBackupAwbVinculado_ = () => {};
  c.agendaSetAwbValue_ = (range, value) => range.setValue(value);
  c.codexWriteAuditChanges_ = (...args) => audits.push(args);
  c.codexCourierAssertDocumentAwb_ = () => {};
  const event = c.agendaRowToObject_(sheet.rows[1], 2);
  const payload = Object.assign({}, c.agendaMergePayloadFromEvent_(event), { id: 'A',
    _recordVersion: event.recordVersion, _editRecordVersion: event.editRecordVersion,
    _editFieldVersions: c.agendaEditFieldVersionsFromRow_(sheet.rows[1]),
    _editMergeToken: c.agendaIssueMergeToken_(sheet.rows[1], event) });
  assert.ok(payload._editMergeToken);
  const merge = c.agendaTryMergeEdit_;
  c.agendaTryMergeEdit_ = (...args) => { assert.equal(locked, true, 'comparacao dentro do lock'); return merge(...args); };
  return { c, i, sheet, payload, audits, validations, setEmail: value => { email = value; }, setSpreadsheet: value => { spreadsheetId = value; } };
}

function material(label, total = 2) {
  return JSON.stringify({ v: 1, items: [{ key: 'soro', tipo: 'Soro', ensaio: label, formula: '1x' + total, tubos: 1, total, unit: 'mL', segmentos: [{ qtd: 1, vol: total }] }] });
}


module.exports = { fixture, material };
