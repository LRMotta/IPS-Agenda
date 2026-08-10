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

test('aniversario legado convertido em data pela planilha continua sendo reconhecido', () => {
  const server = runFile('WebApp.gs');
  assert.equal(server.codexNormalizeBirthday_(new Date(2026, 3, 1)), '04-01');
});

test('meu perfil rele a linha atual e nao perde aniversario ausente no cache de acesso', () => {
  const { server } = profileServer([
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)'],
    ['leonardo@example.invalid', 'Leonardo Rapone da Motta', 'admin', 'Sim', '04-01']
  ]);
  server.codexAuthorizeWebAppRequest_ = () => ({
    ok: true,
    userEmail: 'leonardo@example.invalid',
    name: 'Leonardo Rapone da Motta',
    role: 'admin',
    birthday: ''
  });

  const result = server.getMeuPerfil();
  assert.equal(result.birthday, '04-01');
  assert.equal(result.birthdayDay, 1);
  assert.equal(result.birthdayMonth, 4);
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
  assert.deepEqual(users.rows[1], ['maria@example.invalid', 'Maria Oliveira', 'readonly', 'Sim', '09-18', '', '']);
  assert.deepEqual(users.numberFormats.at(-1), {
    row: 2,
    column: 5,
    numRows: 1,
    numColumns: 1,
    format: '@'
  });
});

test('perfil profissional usa formacoes do ConfigApp e preserva a permissao administrativa', () => {
  const { server, users } = profileServer([
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames'],
    ['maria@example.invalid', 'Maria Antiga', 'user', 'Sim', '', 'Enfermeiro(a)', 'COREN 123', 'Não']
  ]);
  server.codexAssertSelfProfileWrite_ = () => ({ ok: true, userEmail: 'maria@example.invalid', role: 'user' });
  server.codexUserProfileFormations_ = () => ['Enfermeiro(a)', 'Médico(a)'];

  const result = server.salvarMeuPerfil({
    name: 'Maria Oliveira',
    formacao: 'Médico(a)',
    registroProfissional: 'CRM 456'
  });

  assert.equal(result.formacao, 'Médico(a)');
  assert.equal(result.registroProfissional, 'CRM 456');
  assert.equal(result.podeSolicitarExames, 'Não');
  assert.deepEqual(users.rows[1].slice(5, 8), ['Médico(a)', 'CRM 456', 'Não']);
});

test('formacoes de usuarios reconhecem o grupo Profissionais do ConfigApp', () => {
  const server = runFile('WebApp.gs');
  let gruposRecebidos = [];
  server.getConfigAppValuesByKeys_ = (grupos) => {
    gruposRecebidos = grupos;
    return ['Enfermeiro(a)'];
  };
  assert.deepEqual(JSON.parse(JSON.stringify(server.codexUserProfileFormations_())), ['Enfermeiro(a)']);
  assert.ok(gruposRecebidos.includes('Profissionais'));
});

test('lista de solicitantes vem de Users e respeita ativo e pode solicitar exames', () => {
  const { server } = profileServer([
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames'],
    ['ana@example.invalid', 'Ana Souza', 'user', 'Sim', '', 'Enfermeiro(a)', 'COREN 1', 'Sim'],
    ['bia@example.invalid', 'Bia Lima', 'user', 'Sim', '', 'Médico(a)', 'CRM 2', 'Não'],
    ['caio@example.invalid', 'Caio Alves', 'user', 'Não', '', 'Médico(a)', 'CRM 3', 'Sim']
  ]);
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, userEmail: 'ana@example.invalid', role: 'user' });

  assert.deepEqual(JSON.parse(JSON.stringify(server.buscarSolicitantesCompleto())), [{
    id: 'ana@example.invalid',
    nome: 'Ana Souza',
    formacao: 'Enfermeiro(a)',
    registro: 'COREN 1',
    email: 'ana@example.invalid'
  }]);
});

test('geracao de requisicao bloqueia usuario sem permissao antes de efeitos externos', () => {
  const server = runFile('WebApp.gs');
  server.codexAssertCanWrite_ = () => ({
    ok: true,
    userEmail: 'bia@example.invalid',
    role: 'user',
    podeSolicitarExames: 'Não'
  });
  assert.throws(() => server.gerarRequisicaoPDF({ paciente: 'Teste' }), /não está autorizado a solicitar exames/i);
});

test('interface unifica solicitantes em usuarios e oferece edicao multipla profissional', () => {
  const nav = readProjectFile('IndexContent.html');
  const content = readProjectFile('IndexContentAfterStock.html');
  const core = readProjectFile('IndexCoreScripts.html');
  assert.doesNotMatch(nav, /irPara\('solicitantes'\)/);
  assert.match(content, /id="meuPerfilFormacao"/);
  assert.match(content, /id="meuPerfilPodeSolicitar"/);
  assert.match(content, /Solicita exames/);
  assert.match(core, /bulkUserFormation-/);
  assert.match(core, /getUsersAdminBootstrap\(\)/);
  assert.match(core, /podeSolicitarExames/);
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
  assert.deepEqual(users.numberFormats.at(-1), {
    row: 2,
    column: 5,
    numRows: 2,
    numColumns: 1,
    format: '@'
  });
});

test('edicao administrativa grava aniversario como texto para evitar conversao da planilha', () => {
  const { server, users } = profileServer([
    ['Email', 'Nome', 'Perfil', 'Ativo', 'AniversÃ¡rio (MM-DD)'],
    ['priscila@example.invalid', 'Priscila Dias GonÃ§alves', 'user', 'Sim', '']
  ]);
  server.codexAssertAdmin_ = () => ({ ok: true, userEmail: 'admin@example.invalid', role: 'admin' });

  server.salvarUsuarioAdmin({
    rowIndex: 2,
    email: 'priscila@example.invalid',
    name: 'Priscila Dias GonÃ§alves',
    birthdayDay: 1,
    birthdayMonth: 4,
    role: 'user',
    ativo: 'Sim'
  });

  assert.equal(users.rows[1][4], '04-01');
  assert.deepEqual(users.numberFormats.at(-1), {
    row: 2,
    column: 5,
    numRows: 1,
    numColumns: 1,
    format: '@'
  });
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
