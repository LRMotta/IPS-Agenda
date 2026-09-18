'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

function awbServer(sheet, audits) {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const server = runFile('WebApp.gs', {
    AgendaServerRules_: rules,
    SpreadsheetApp: { flush() {} }
  });
  server.codexAssertCanWrite_ = () => ({ ok: true });
  server.codexWithDocumentLock_ = (_name, callback) => callback();
  server.getAgendaSheet_ = () => sheet;
  server.encontrarLinhaPorId = (_sheet, id) => id === 'EVT-AWB' ? 2 : 0;
  server.codexWriteAuditChanges_ = (...args) => audits.push(args);
  return server;
}

function awbSheet(status, awb) {
  const cfg = runFile('WebApp.gs', {}).AGENDA_CFG;
  const row = Array(cfg.lastCol).fill('');
  row[cfg.idx.id] = 'EVT-AWB';
  row[cfg.idx.c1.nome] = 'DHL';
  row[cfg.idx.c1.status] = status;
  row[cfg.idx.c1.awb] = awb;
  return new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), row]);
}

test('Pendencias AWB exibem acao propria, botao de confirmacao e editor da Agenda', () => {
  const source = readProjectFile('IndexPendenciasScripts.html');
  const start = source.indexOf("key: 'awbEnviadaNaoEntregue'");
  const end = source.indexOf("key: 'requisicaoExamesPendente'");
  const awbCard = source.slice(start, end);

  assert.match(awbCard, /action: pendenciaAwbAction/);
  assert.doesNotMatch(awbCard, /action: pendenciaAgendaAction/);
  assert.match(source, /function pendenciaAwbAction\(it\)/);
  assert.match(source, /function abrirPendenciaAwb\(agendaId\)/);
  assert.match(source, /abrirAgendaRegistroPorId/);
  assert.match(source, /confirmarEntregaPendencia\(event/);
  assert.match(source, /method: 'confirmarEntregaTransportePendencia'/);
  assert.match(source, /stopPropagation/);
  assert.match(source, /modalConfirmarEntregaPendencia/);
  assert.match(source, /executarConfirmarEntregaPendencia_/);
  assert.doesNotMatch(source, /window\.confirm\(/);
  assert.match(readProjectFile('IndexExtraModals.html'), /pendenciaEntregaParticipante/);
  assert.match(readProjectFile('IndexStyles.html'), /\.dash-pend-confirm/);
});

test('pendencias operacionais abrem o agendamento e apenas requisicao usa o fluxo de Req. Exames', () => {
  const source = readProjectFile('IndexPendenciasScripts.html');
  const agendaKeys = [
    'courierNaoAgendada',
    'courierNaoConfirmada',
    'posVisitaPoloTrialPendente',
    'posVisitaEcrfPendente',
    'transporteBackupNaoAgendado',
    'documentacaoTransporteSemEnvio'
  ];
  agendaKeys.forEach((key) => {
    const start = source.indexOf(`key: '${key}'`);
    const end = source.indexOf("key: '", start + 1);
    const card = source.slice(start, end === -1 ? source.length : end);
    assert.match(card, /action: pendenciaAgendaRegistroAction/);
  });
  const requisicaoStart = source.indexOf("key: 'requisicaoExamesPendente'");
  const requisicaoEnd = source.indexOf("key: '", requisicaoStart + 1);
  const requisicao = source.slice(requisicaoStart, requisicaoEnd === -1 ? source.length : requisicaoEnd);
  assert.match(requisicao, /action: pendenciaAgendaAction/);
  assert.match(source, /function abrirPendenciaAgendaRegistro\(agendaId\)/);
  assert.match(source, /window\.abrirAgendaRegistroPorId/);
});

test('confirmar entrega atualiza somente o slot AWB correspondente e audita a mutacao', () => {
  const audits = [];
  const sheet = awbSheet('Enviado', 'AWB-123');
  const server = awbServer(sheet, audits);
  const result = server.confirmarEntregaTransportePendencia('EVT-AWB', 'Transporte I', 'AWB-123');
  const cfg = server.AGENDA_CFG;

  assert.equal(result.ok, true);
  assert.equal(result.status, 'Entregue');
  assert.equal(sheet.rows[1][cfg.idx.c1.status], 'Entregue');
  assert.equal(audits.length, 1);
  assert.match(audits[0][4], /Entrega confirmada manualmente/);
  assert.equal(audits[0][3][0].field, 'Transporte I - Status');
});

test('confirmar entrega rejeita AWB stale e nao grava se o transporte mudou', () => {
  const audits = [];
  const sheet = awbSheet('Enviado', 'AWB-ATUAL');
  const server = awbServer(sheet, audits);
  const result = server.confirmarEntregaTransportePendencia('EVT-AWB', 'Transporte I', 'AWB-ANTIGA');
  const cfg = server.AGENDA_CFG;

  assert.equal(result.conflito, true);
  assert.match(result.erro, /AWB deste transporte mudou/);
  assert.equal(sheet.rows[1][cfg.idx.c1.status], 'Enviado');
  assert.equal(sheet.writes, 0);
  assert.equal(audits.length, 0);
});
