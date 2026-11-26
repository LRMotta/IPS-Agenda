'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

function servidor() {
  const server = runFile('WebApp.gs', {});
  server.formatarDataMesCurtoPt_ = (d, sep) => {
    const s = sep || '/';
    return String(d.getDate()).padStart(2, '0') + s + ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][d.getMonth()] + s + d.getFullYear();
  };
  return server;
}

test('campos do formulário convertem nascimento e data como a aba fazia e mantêm a grade de 40 exames', () => {
  const server = servidor();
  const campos = server.reqExamesCamposDoFormulario_({
    paciente: 'Paciente Teste', nascimento: '05/03/1980', protocolo: '00123', dataAgendamento: '2026-12-01', urgente: true
  }, ['A', 'B']);
  assert.ok(isDate(campos.value('E9')));
  assert.equal(campos.display('E9'), '05/mar/1980');
  assert.ok(isDate(campos.value('H10')));
  assert.equal(campos.display('H10'), '01/dez/2026');
  assert.equal(campos.display('H8'), '00123', 'protocolo continua texto, com zeros à esquerda');
  assert.equal(campos.value('I5'), 'URGENTE');
  assert.equal(campos.display('B36'), '');
  assert.equal(campos.examesSlots.length, 40);
  assert.deepEqual(Array.from(campos.examesSlots.filter(Boolean)), ['A', 'B']);

  const semData = server.reqExamesCamposDoFormulario_({ nascimento: 'não informado' }, []);
  assert.equal(semData.value('E9'), 'não informado');
  assert.equal(semData.display('E9'), 'não informado');
});

test('gerarRequisicaoPDF não toca na planilha nem reautoriza solicitante, prestador, assinatura ou status', () => {
  const server = servidor();
  const counts = { assertWrite: 0, authorize: 0, users: 0, statusAutorizado: 0, draft: 0 };
  let html = null, draft = null;
  const users = { 'sol@example.invalid': { active: true, name: 'Solicitante Teste', podeSolicitarExames: 'Sim' } };
  server.codexAssertCanWrite_ = (action, mod, id, snapshot) => {
    counts.assertWrite++;
    if (snapshot) snapshot.users = users;
    return { ok: true, role: 'user', userEmail: 'sol@example.invalid', podeSolicitarExames: 'Sim' };
  };
  server.codexAuthorizeWebAppRequest_ = () => { counts.authorize++; return { ok: true, role: 'user' }; };
  server.codexAssertCanRead_ = () => { counts.authorize++; return { ok: true }; };
  server.codexGetAllowedUsers_ = () => { counts.users++; return users; };
  server.codexMeasurePerformance_ = (op, stage, meta, fn) => fn();
  server.agendaDateIsBeforeToday_ = () => false;
  server.SpreadsheetApp = new Proxy({}, { get() { throw new Error('não deve acessar a planilha'); } });
  server.getCodexSpreadsheet_ = () => { throw new Error('não deve abrir a planilha'); };
  server.reqExamesAssertGmailDraftAllowed_ = () => {};
  server.buscarEmailDoLocalDados_ = nome => (nome === 'Lab X' ? 'prestador@example.invalid' : null);
  server.getGmailSignatureDados_ = () => '';
  server.getReqExamesCcEmails_ = () => '';
  server.reqExamesPdfHtml_ = dados => { html = dados; return '<html></html>'; };
  const pdf = { setName: () => pdf };
  server.HtmlService = { createHtmlOutput: () => ({ getBlob: () => ({ getAs: () => pdf }) }) };
  server.MimeType = { PDF: 'application/pdf' };
  server.GmailApp = { createDraft(to, subject, body, opts) { counts.draft++; draft = { to, subject, opts }; } };
  server.atualizarStatusRequisicaoAgendaAutorizado_ = () => { counts.statusAutorizado++; return { statusRequisicao: 'Requisição Enviada' }; };
  server.atualizarStatusRequisicaoAgenda = () => { throw new Error('não deve reautorizar o status'); };

  const res = server.gerarRequisicaoPDF({
    paciente: 'Paciente Teste', nascimento: '05/03/1980', localExame: 'Lab X', dataAgendamento: '2026-12-01',
    solicitante: 'Solicitante Teste', exames: ['Hemograma', ' ', 'Glicemia'], agendaId: 'AG-1'
  });

  assert.equal(res.ok, true);
  assert.equal(res.pdfMode, 'html-institucional');
  assert.equal(res.statusRequisicao, 'Requisição Enviada');
  assert.deepEqual(counts, { assertWrite: 1, authorize: 0, users: 0, statusAutorizado: 1, draft: 1 });
  assert.equal(html.paciente, 'Paciente Teste');
  assert.equal(html.nascimento, '05/mar/1980');
  assert.equal(html.dataAgendamento, '01/dez/2026');
  assert.deepEqual(Array.from(html.exames), ['Hemograma', 'Glicemia']);
  assert.equal(draft.to, 'prestador@example.invalid');
  assert.match(draft.subject, /Paciente Teste - Data: 01\/dez\/2026/);
  assert.match(draft.opts.htmlBody, /05\/mar\/1980/);
  assert.equal(draft.opts.attachments[0], pdf);
});

test('prestador sem e-mail continua bloqueando antes do PDF e do rascunho', () => {
  const server = servidor();
  server.codexAssertCanWrite_ = (a, m, id, snapshot) => {
    snapshot.users = { 's@example.invalid': { active: true, name: 'Sol', podeSolicitarExames: 'Sim' } };
    return { ok: true, role: 'user', userEmail: 's@example.invalid', podeSolicitarExames: 'Sim' };
  };
  server.codexMeasurePerformance_ = (op, stage, meta, fn) => fn();
  server.agendaDateIsBeforeToday_ = () => false;
  server.reqExamesAssertGmailDraftAllowed_ = () => {};
  server.buscarEmailDoLocalDados_ = () => null;
  server.reqExamesExportPdfBlob_ = () => { throw new Error('não deve gerar PDF'); };
  assert.throws(() => server.gerarRequisicaoPDF({ localExame: 'Sem Email', dataAgendamento: '2026-12-01', solicitante: 'Sol' }),
    /E-mail do local "Sem Email" não encontrado/);
});
