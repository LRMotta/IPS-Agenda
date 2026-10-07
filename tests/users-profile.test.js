'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

function profileServer(rows) {
  const users = new FakeSheet('Users', rows);
  const lock = fakeDocumentLock();
  const server = runFile('WebApp.gs', { LockService: lock.LockService });
  server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Users: users });
  server.codexCacheRemove_ = () => {};
  server.codexWriteAuditLog_ = () => {};
  server.codexWriteAuditChanges_ = () => {};
  server.codexWriteAuditLogBatch_ = () => {};
  server.codexWriteAuditChangesBatch_ = () => {};
  server.codexGetTeamBirthdays_ = () => [];
  return { server, users, lock: lock.state };
}

const PROFILE_HEADERS = ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames'];

test('perfil próprio não regrava papel e ativação alterados depois da leitura', () => {
  const { server, users } = profileServer([
    PROFILE_HEADERS,
    ['maria@example.invalid', 'Maria', 'admin', 'Sim', '', '', '', 'Sim']
  ]);
  server.codexAssertSelfProfileWrite_ = () => ({ userEmail: 'maria@example.invalid', role: 'admin' });
  const getRange = users.getRange.bind(users);
  let changed = false;
  users.getRange = (...args) => {
    const range = getRange(...args);
    const getValues = range.getValues.bind(range);
    range.getValues = () => {
      const snapshot = getValues();
      if (!changed && args[0] === 2 && args[1] === 1) {
        changed = true;
        users.rows[1][2] = 'readonly';
        users.rows[1][3] = 'Não';
      }
      return snapshot;
    };
    return range;
  };
  server.salvarMeuPerfil({ name: 'Maria Atualizada' });
  assert.equal(users.rows[1][1], 'Maria Atualizada');
  assert.deepEqual(users.rows[1].slice(2, 4), ['readonly', 'Não']);
});

test('carga rápida grava somente linhas selecionadas e preserva A, C e D', () => {
  const { server, users } = profileServer([
    PROFILE_HEADERS,
    ['maria@example.invalid', 'Maria', 'admin', 'Sim', '', '', '', 'Sim'],
    ['rafael@example.invalid', 'Rafael', 'user', 'Sim', '', '', '', 'Sim'],
    ['ana@example.invalid', 'Ana', 'user', 'Sim', '', '', '', 'Sim']
  ]);
  server.codexAssertAdmin_ = () => ({ userEmail: 'admin@example.invalid', role: 'admin' });
  const getRange = users.getRange.bind(users);
  let changed = false;
  users.getRange = (...args) => {
    const range = getRange(...args);
    const getValues = range.getValues.bind(range);
    range.getValues = () => {
      const snapshot = getValues();
      if (!changed && args[0] === 2 && args[1] === 1) {
        changed = true;
        users.rows[1][0] = 'novo@example.invalid';
        users.rows[1][2] = 'readonly';
        users.rows[1][3] = 'Não';
        users.rows[2] = ['rafael@example.invalid', 'Rafael Atualizado', 'readonly', 'Não', '04-01', 'Outra formação', 'Registro atual', 'Não'];
      }
      return snapshot;
    };
    return range;
  };
  const result = server.salvarPerfisUsuariosAdmin({ users: [
    { rowIndex: 4, name: 'Ana Atualizada', birthday: '05-03' },
    { rowIndex: 2, name: 'Maria Atualizada', birthday: '09-18' }
  ] });
  assert.equal(result.updated, 2);
  assert.deepEqual(users.rows[1].slice(0, 5), ['novo@example.invalid', 'Maria Atualizada', 'readonly', 'Não', '09-18']);
  assert.deepEqual(users.rows[2], ['rafael@example.invalid', 'Rafael Atualizado', 'readonly', 'Não', '04-01', 'Outra formação', 'Registro atual', 'Não']);
  assert.equal(users.rows[3][1], 'Ana Atualizada');
  assert.equal(users.rows[3][4], '05-03');
  assert.equal(users.writes, 4);
});

const PROFILE_MUTATIONS = [
  ['salvarMeuPerfil', { name: 'Maria Atualizada' }],
  ['salvarPerfisUsuariosAdmin', { users: [{ rowIndex: 2, name: 'Maria Atualizada' }] }],
  ['salvarUsuarioAdmin', { rowIndex: 2, email: 'maria@example.invalid', name: 'Maria Atualizada', role: 'user', ativo: 'Sim' }],
  ['inativarUsuarioAdmin', 2]
];

function adminIdentityFixture() {
  const fixture = profileServer([
    PROFILE_HEADERS,
    ['maria@example.invalid', 'Maria', 'user', 'Sim', '', '', '', 'Sim'],
    ['admin@example.invalid', 'Administrador', 'admin', 'Sim', '', '', '', 'Sim']
  ]);
  fixture.server.codexAssertAdmin_ = () => ({ userEmail: 'admin@example.invalid', role: 'admin' });
  return fixture;
}

test('edição administrativa rejeita identidade divergente e linha inválida antes de escrever', () => {
  const { server, users } = adminIdentityFixture();
  const before = users.rows.map(row => row.slice());
  for (const rowIndex of [1, -1, 2.5, 4, NaN, Infinity, 'inválido']) {
    assert.throws(() => server.salvarUsuarioAdmin({ rowIndex, originalEmail: 'maria@example.invalid', email: 'novo@example.invalid', name: 'Novo' }), /Linha de usuário inválida/);
  }
  for (const rowIndex of [0, 3]) {
    assert.throws(() => server.salvarUsuarioAdmin({ rowIndex, originalEmail: 'maria@example.invalid', email: 'novo@example.invalid', name: 'Novo' }), /linha mudou|Linha de usuário inválida/);
  }
  assert.throws(() => server.salvarUsuarioAdmin({ rowIndex: 3, email: 'novo@example.invalid', name: 'Novo' }), /linha mudou/);
  assert.equal(users.writes, 0);
  assert.deepEqual(users.rows, before);
});

test('identidade original é conferida após esperar pelo lock', () => {
  const { server, users, lock } = adminIdentityFixture();
  lock.onAcquire = () => { users.rows[1][0] = 'outra@example.invalid'; };
  assert.throws(() => server.salvarUsuarioAdmin({ rowIndex: 2, originalEmail: 'maria@example.invalid', email: 'novo@example.invalid', name: 'Novo' }), /linha mudou/);
  assert.equal(users.writes, 0);
  assert.equal(users.rows[1][1], 'Maria');
  assert.equal(lock.released, 1);
});

test('identidade original permite editar e-mail e mantém clientes legados com e-mail inalterado', () => {
  const { server, users } = adminIdentityFixture();
  const result = server.salvarUsuarioAdmin({ rowIndex: '2', originalEmail: ' MARIA@EXAMPLE.INVALID ', email: 'novo@example.invalid', name: 'Maria Atualizada', role: 'user', ativo: 'Sim' });
  assert.equal(result.rowIndex, 2);
  assert.equal(users.rows[1][0], 'novo@example.invalid');
  server.salvarUsuarioAdmin({ rowIndex: 2, email: 'novo@example.invalid', name: 'Maria Legado', role: 'user', ativo: 'Sim' });
  assert.equal(users.rows[1][1], 'Maria Legado');
  assert.equal(users.rows[2][0], 'admin@example.invalid');
});

test('administrador não perde o próprio acesso ao mudar e-mail, papel ou ativação', () => {
  const { server, users } = adminIdentityFixture();
  for (const values of [
    { email: 'novo@example.invalid', role: 'admin', ativo: 'Sim' },
    { email: 'novo@example.invalid', role: 'user', ativo: 'Não' },
    { email: 'admin@example.invalid', role: 'user', ativo: 'Sim' },
    { email: 'admin@example.invalid', role: 'admin', ativo: 'Não' }
  ]) {
    assert.throws(() => server.salvarUsuarioAdmin({ rowIndex: 3, originalEmail: 'admin@example.invalid', name: 'Administrador', ...values }), /próprio acesso administrativo/);
  }
  assert.equal(users.writes, 0);
  server.salvarUsuarioAdmin({ rowIndex: 3, originalEmail: 'admin@example.invalid', email: 'admin@example.invalid', name: 'Administrador Atualizado', role: 'admin', ativo: 'Sim' });
  assert.equal(users.rows[2][1], 'Administrador Atualizado');
});

test('duplicidade criada durante espera pelo lock bloqueia cadastro e troca de e-mail', () => {
  for (const editing of [false, true]) {
    const { server, users, lock } = adminIdentityFixture();
    lock.onAcquire = () => { users.rows.push(['novo@example.invalid', 'Novo', 'user', 'Sim', '', '', '', 'Sim']); };
    assert.throws(() => server.salvarUsuarioAdmin({
      rowIndex: editing ? 2 : 0, originalEmail: editing ? 'maria@example.invalid' : '',
      email: 'novo@example.invalid', name: 'Novo', role: 'user', ativo: 'Sim'
    }), /já está cadastrado/);
    assert.equal(users.writes, 0);
    assert.equal(users.rows[1][0], 'maria@example.invalid');
    assert.equal(lock.released, 1);
  }
});

for (const [method, payload] of PROFILE_MUTATIONS) {
  test(method + ' relê e grava Users sob o mesmo lock e o libera', () => {
    const { server, users, lock } = profileServer([
      PROFILE_HEADERS,
      ['maria@example.invalid', 'Maria', 'user', 'Sim', '', '', '', 'Sim']
    ]);
    server.codexAssertAdmin_ = () => ({ userEmail: 'admin@example.invalid', role: 'admin' });
    server.codexAssertSelfProfileWrite_ = () => {
      assert.equal(lock.held, true);
      return { userEmail: 'maria@example.invalid', role: 'user' };
    };
    const getRange = users.getRange.bind(users);
    users.getRange = (...args) => {
      assert.equal(lock.held, true, 'leitura e escrita protegidas');
      return getRange(...args);
    };
    let oldName;
    server.codexWriteAuditChanges_ = (module, action, email, changes) => {
      const change = changes.find(item => item.field === 'Usuário - Nome');
      if (change) oldName = change.oldValue;
    };
    server.codexWriteAuditChangesBatch_ = entries => {
      entries.forEach(entry => server.codexWriteAuditChanges_(entry.moduleName, entry.action, entry.recordId, entry.changes));
    };
    lock.onAcquire = () => { users.rows[1][1] = 'Nome atualizado durante a espera'; };
    server[method](payload);
    if (method !== 'inativarUsuarioAdmin') assert.equal(oldName, 'Nome atualizado durante a espera');
    assert.equal(lock.acquired, 1);
    assert.equal(lock.released, 1);
    assert.equal(lock.held, false);
  });

  test(method + ' bloqueia sem lock e revalida autorização após a espera', () => {
    const { server, users, lock } = profileServer([
      PROFILE_HEADERS,
      ['maria@example.invalid', 'Maria', 'user', 'Sim', '', '', '', 'Sim']
    ]);
    let authorized = true;
    const authorize = () => {
      if (!authorized) throw new Error('Acesso revogado');
      return { userEmail: 'maria@example.invalid', role: 'admin' };
    };
    server.codexAssertAdmin_ = authorize;
    server.codexAssertSelfProfileWrite_ = authorize;
    lock.available = false;
    assert.throws(() => server[method](payload), /Outra operação está gravando/);
    assert.equal(users.writes, 0);
    lock.available = true;
    lock.onAcquire = () => { authorized = false; };
    assert.throws(() => server[method](payload), /Acesso revogado/);
    assert.equal(users.writes, 0);
    assert.equal(lock.released, 1);
    assert.equal(lock.held, false);
  });

  test(method + ' respeita inativação do solicitante em Users enquanto espera pelo lock', () => {
    const { server, users, lock } = profileServer([
      PROFILE_HEADERS,
      ['maria@example.invalid', 'Maria', 'user', 'Sim', '', '', '', 'Sim'],
      ['admin@example.invalid', 'Administrador', 'admin', 'Sim', '', '', '', 'Sim']
    ]);
    server.codexGetActiveUserEmail_ = () => 'admin@example.invalid';
    lock.onAcquire = () => { users.rows[2][3] = 'Não'; };
    assert.throws(() => server[method](payload), /inativo/);
    assert.equal(users.writes, 0);
    assert.equal(users.rows[1][1], 'Maria');
    assert.equal(users.rows[1][3], 'Sim');
    assert.equal(lock.released, 1);
    assert.equal(lock.held, false);
  });
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
