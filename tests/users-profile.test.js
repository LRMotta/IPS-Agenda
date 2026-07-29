'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function profileServer(rows) {
  const users = new FakeSheet('Users', rows);
  const server = runFile('WebApp.gs');
  server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Users: users });
  server.codexCacheRemove_ = () => {};
  server.codexWriteAuditLog_ = () => {};
  server.codexWriteAuditChanges_ = () => {};
  server.codexGetTeamBirthdays_ = () => [];
  return { server, users };
}

test('aniversario e normalizado sem ano e valida o calendario', () => {
  const server = runFile('WebApp.gs');
  assert.equal(server.codexNormalizeBirthday_('09-18'), '09-18');
  assert.equal(server.codexNormalizeBirthday_('18/09'), '09-18');
  assert.equal(server.codexNormalizeBirthday_({ day: 29, month: 2 }), '02-29');
  assert.equal(server.codexNormalizeBirthday_({ day: '', month: '' }), '');
  assert.throws(() => server.codexNormalizeBirthday_({ day: 31, month: 4 }), /aniversário válido/);
});

test('coluna de aniversario nao sobrescreve uma coluna E ja utilizada', () => {
  const server = runFile('WebApp.gs');
  const users = new FakeSheet('Users', [['Email', 'Nome', 'Perfil', 'Ativo', 'Outro dado']]);
  assert.throws(() => server.codexEnsureUsersProfileColumns_(users), /coluna E.*já está em uso/);
  assert.equal(users.rows[0][4], 'Outro dado');
});

test('usuario altera somente o proprio nome e aniversario', () => {
  const { server, users } = profileServer([
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)'],
    ['maria@example.invalid', 'Maria Antiga', 'readonly', 'Sim', '']
  ]);
  server.codexAssertSelfProfileWrite_ = () => ({
    ok: true,
    userEmail: 'maria@example.invalid',
    role: 'readonly'
  });

  const result = server.salvarMeuPerfil({
    email: 'outra-pessoa@example.invalid',
    name: 'Maria Oliveira',
    birthdayDay: 18,
    birthdayMonth: 9,
    role: 'admin',
    ativo: 'Não'
  });

  assert.equal(result.email, 'maria@example.invalid');
  assert.equal(result.firstName, 'Maria');
  assert.deepEqual(users.rows[1], ['maria@example.invalid', 'Maria Oliveira', 'readonly', 'Sim', '09-18']);
});

test('carga administrativa valida todas as linhas antes da gravacao em lote', () => {
  const { server, users } = profileServer([
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)'],
    ['maria@example.invalid', 'Maria', 'user', 'Sim', ''],
    ['rafael@example.invalid', 'Rafael', 'user', 'Sim', '']
  ]);
  server.codexAssertAdmin_ = () => ({ ok: true, userEmail: 'admin@example.invalid', role: 'admin' });

  const writesBefore = users.writes;
  assert.throws(() => server.salvarPerfisUsuariosAdmin({ users: [
    { rowIndex: 2, name: 'Maria Oliveira', birthdayDay: 18, birthdayMonth: 9 },
    { rowIndex: 3, name: '', birthdayDay: 31, birthdayMonth: 4 }
  ] }), /nome completo|aniversário válido/);
  assert.equal(users.writes, writesBefore);
  assert.equal(users.rows[1][1], 'Maria');

  const result = server.salvarPerfisUsuariosAdmin({ users: [
    { rowIndex: 2, name: 'Maria Oliveira', birthdayDay: 18, birthdayMonth: 9 },
    { rowIndex: 3, name: 'Rafael Souza', birthdayDay: 3, birthdayMonth: 11 }
  ] });
  assert.equal(result.updated, 2);
  assert.equal(users.rows[1][4], '09-18');
  assert.equal(users.rows[2][4], '11-03');
});

test('agenda trata aniversarios como faixa informativa fora dos eventos', () => {
  const agenda = readProjectFile('IndexAgendaScripts.html');
  assert.match(agenda, /function agendaBirthdayBannerHtml\(d, compact\)/);
  assert.match(agenda, /html \+= agendaBirthdayBannerHtml\(d, false\)/);
  assert.match(agenda, /var birthdayHtml = agendaBirthdayBannerHtml\(d, true\)/);
  assert.doesNotMatch(agenda, /_agendaEventos\.push\([^\n]*birthday/i);
});

test('topo usa primeiro nome sem solicitar escopo adicional de perfil Google', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  const manifest = JSON.parse(readProjectFile('appsscript.json'));
  assert.match(core, /CURRENT_ACCESS\.firstName \|\| CURRENT_ACCESS\.name \|\| email/);
  assert.doesNotMatch(server, /codexGetGoogleUserProfile_/);
  assert.ok(!manifest.oauthScopes.includes('https://www.googleapis.com/auth/userinfo.profile'));
});
