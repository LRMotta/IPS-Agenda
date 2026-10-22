'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture(control = 'Notificado 22/10/2026') {
  const sent = [];
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const server = runFile('WebApp.gs', {
    AgendaServerRules_: rules,
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) },
    CodexExternalEffects_: { sendEmail: message => sent.push(message) }
  });
  const cfg = server.AGENDA_CFG;
  const row = Array(cfg.lastCol).fill('');
  Object.entries({ id: 'EVT-1', data: '22/10/2026', status: 'Agendado', labCentral: 'Não', controle: control, projeto: 'Estudo' })
    .forEach(([key, value]) => { row[cfg.idx[key]] = value; });
  const sheet = { getRange(line, col, count, width) {
    assert.equal(line, 2);
    return {
      getValues: () => [row.slice(col - 1, col - 1 + width)],
      setValue: value => { row[col - 1] = value; }
    };
  } };
  ['gerarTabelaAgendaEmail_', 'gerarHtmlCouriers_', 'gerarRodapeEmailAgenda_'].forEach(name => { server[name] = () => ''; });
  server.agendaCancelamentoMotivoHtml_ = () => '<p>Motivo antigo de cancelamento da visita</p>';
  server.gerarListaDestinatarios_ = () => 'equipe@example.invalid';
  server.agendaEmailEnabled_ = () => true;
  server.datasAgendaDiferentes_ = () => false;
  const notify = () => server.verificarNotificacoes_({ user: {} }, 'EVT-1', null, sheet, 2);
  return { server, row, cfg, sent, notify };
}

test('retirada do Lab Central avisa uma vez, mantem visita e permite nova inclusao', () => {
  const f = fixture();
  f.notify();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].subject, /\[CANCELAMENTO\].*Envio ao Lab Central/);
  assert.match(f.sent[0].htmlBody, /CANCELAMENTO DE ENVIO AO LAB CENTRAL/);
  assert.match(f.sent[0].htmlBody, /O agendamento da visita foi mantido/);
  assert.doesNotMatch(f.sent[0].htmlBody, /Motivo antigo/);
  assert.equal(f.row[f.cfg.idx.status], 'Agendado');
  assert.equal(f.row[f.cfg.idx.controle], 'Cancelado');
  f.notify();
  assert.equal(f.sent.length, 1);
  f.row[f.cfg.idx.labCentral] = 'Sim';
  f.server.enviarEmailAgendamento_ = () => f.sent.push({ subject: 'novo agendamento' });
  f.server.formatarDataSafe = () => '22/10/2026';
  f.notify();
  assert.equal(f.sent.length, 2);
  assert.equal(f.row[f.cfg.idx.controle], 'Notificado 22/10/2026');
});

test('retirada apos reagendamento avisa cancelamento mesmo com nova mudanca de data', () => {
  const f = fixture('Reagendado 22/10/2026');
  f.server.datasAgendaDiferentes_ = () => true;
  f.notify();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].subject, /CANCELAMENTO/);
});

for (const control of ['', 'Pendente notificacao - modo teste', 'Cancelado']) {
  test('retirada nao envia aviso sem notificacao ativa anterior: ' + control, () => {
    const f = fixture(control);
    f.notify();
    assert.equal(f.sent.length, 0);
    assert.equal(f.row[f.cfg.idx.controle], control);
  });
}

test('cancelamento da visita preserva mensagem e motivo existentes', () => {
  const f = fixture();
  f.row[f.cfg.idx.status] = 'Cancelado';
  f.notify();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].htmlBody, /CANCELAMENTO DE VISITA \/ ENVIO/);
  assert.match(f.sent[0].htmlBody, /Motivo antigo/);
  assert.doesNotMatch(f.sent[0].htmlBody, /visita foi mantido/);
});

test('e-mail desativado ou falha de envio nao registra cancelamento como notificado', () => {
  const f = fixture();
  f.server.agendaEmailEnabled_ = () => false;
  f.notify();
  assert.equal(f.sent.length, 0);
  assert.equal(f.row[f.cfg.idx.controle], 'Notificado 22/10/2026');
  f.server.agendaEmailEnabled_ = () => true;
  f.server.CodexExternalEffects_.sendEmail = () => { throw new Error('Falha simulada'); };
  assert.throws(f.notify, /Falha simulada/);
  assert.equal(f.row[f.cfg.idx.controle], 'Notificado 22/10/2026');
});
