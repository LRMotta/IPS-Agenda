'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

test('adaptador de e-mail pode ser simulado sem enviar mensagem real', () => {
  const captured = [];
  const context = runFile('CodexExternalEffects.gs', {
    MailApp: { sendEmail: (message) => captured.push(message) }
  });

  context.CodexExternalEffects_.sendEmail({
    to: 'teste@example.invalid',
    subject: '[TESTE] Cancelamento',
    htmlBody: '<p>simulado</p>'
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].to, 'teste@example.invalid');
});

test('fluxo de cancelamento usa o adaptador, nao MailApp diretamente', () => {
  const source = readProjectFile('WebApp.gs');
  const start = source.indexOf('function enviarEmailCancelamento_(');
  const end = source.indexOf('\nfunction enviarEmailReagendamento_(', start);
  const cancellationFunction = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(cancellationFunction, /CodexExternalEffects_\.sendEmail\s*\(/);
  assert.doesNotMatch(cancellationFunction, /MailApp\.sendEmail\s*\(/);
});

test('todos os e-mails da Agenda usam o adaptador simulavel', () => {
  const source = readProjectFile('WebApp.gs');
  const functionNames = ['enviarEmailAgendamento_', 'enviarEmailReagendamento_', 'enviarEmailCancelamento_'];

  functionNames.forEach((functionName) => {
    const start = source.indexOf('function ' + functionName + '(');
    const end = source.indexOf('\nfunction ', start + 10);
    const body = source.slice(start, end);
    assert.notEqual(start, -1, functionName);
    assert.match(body, /CodexExternalEffects_\.sendEmail\s*\(/, functionName);
    assert.doesNotMatch(body, /MailApp\.sendEmail\s*\(/, functionName);
  });
});

test('notificacoes da Agenda excluem usuarios inativos dos destinatarios', () => {
  const context = runFile('WebApp.gs');
  context.getConfigAppValuesByKeys_ = () => [
    'ativa@example.invalid; inativa@example.invalid; grupo@example.invalid'
  ];
  context.codexGetAllowedUsers_ = () => ({
    'ativa@example.invalid': { active: true },
    'inativa@example.invalid': { active: false },
    'autora@example.invalid': { active: true }
  });

  const recipients = context.gerarListaDestinatarios_({
    getEmail: () => 'autora@example.invalid'
  }).split(',');

  assert.deepEqual(Array.from(recipients), [
    'ativa@example.invalid',
    'grupo@example.invalid',
    'autora@example.invalid'
  ]);
});

test('codigo da Agenda nao cria nem remove eventos de calendarios reais', () => {
  const source = readProjectFile('WebApp.gs') + readProjectFile('IndexAgendaScripts.html');
  assert.doesNotMatch(source, /CalendarApp\s*\.\s*(createEvent|getEventById)/);
  assert.doesNotMatch(source, /\.deleteEvent\s*\(/);
});
