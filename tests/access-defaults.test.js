'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

const INVALID_ROLES = [undefined, null, '', '   ', 'desconhecido', 'constructor', '__proto__', 'toString', 'hasOwnProperty'];
const INACTIVE_VALUES = [undefined, null, '', '   ', 'desconhecido', 'Não', 'nao', 'no', 'false', false, '0', 0, 'inativo', 'inactive', 2];
const ACTIVE_VALUES = ['Sim', ' SIM ', 'yes', 'true', true, '1', 1, 'ativo', 'active'];

function accessServer(role = 'user', active = 'Sim') {
  const users = new FakeSheet('Users', [
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames'],
    ['teste@example.invalid', 'Teste', role, active, '', '', '', '']
  ]);
  const server = runFile('WebApp.gs', { LockService: fakeDocumentLock().LockService });
  server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Users: users });
  server.codexGetActiveUserEmail_ = () => 'teste@example.invalid';
  server.codexWriteAuditLog_ = () => {};
  return { server, users };
}

test('papel ausente, inválido ou herdado normaliza para readonly', () => {
  const { server } = accessServer();
  for (const role of INVALID_ROLES) assert.equal(server.codexNormalizeRole_(role), 'readonly', String(role));
  for (const role of ['admin', 'user', 'readonly']) {
    assert.equal(server.codexNormalizeRole_(' ' + role.toUpperCase() + ' '), role);
  }
});

test('ativação exige valor afirmativo explícito', () => {
  const { server } = accessServer();
  for (const value of INACTIVE_VALUES) assert.equal(server.codexNormalizeActive_(value), false, String(value));
  for (const value of ACTIVE_VALUES) assert.equal(server.codexNormalizeActive_(value), true, String(value));
});

test('Users com papel inválido permite apenas leitura quando explicitamente ativo', () => {
  const { server, users } = accessServer();
  for (const role of [...INVALID_ROLES, 'readonly']) {
    users.rows[1][2] = role;
    assert.equal(server.codexAssertCanRead_().role, 'readonly');
    assert.equal(server.codexGetCurrentUserAccess().canWrite, false);
    assert.throws(() => server.codexAssertCanWrite_('salvarTeste'), /somente leitura/);
    assert.throws(() => server.codexAssertAdmin_(), /administradores/);
  }
  assert.equal(users.writes, 0);
});

test('Users sem ativação explícita bloqueia leitura, escrita e administração até para admin', () => {
  const { server, users } = accessServer('admin');
  for (const value of INACTIVE_VALUES) {
    users.rows[1][3] = value;
    assert.equal(server.codexAuthorizeWebAppRequest_().ok, false);
    const presentation = server.codexGetCurrentUserAccess();
    assert.equal(presentation.ok, false);
    assert.equal(presentation.canWrite, false);
    for (const method of ['codexAssertCanRead_', 'codexAssertCanWrite_', 'codexAssertAdmin_']) {
      assert.throws(() => server[method](), /inativo/);
    }
  }
  assert.equal(users.writes, 0);
});

test('admin e user explicitamente ativos mantêm as permissões e refletem revogação na próxima consulta', () => {
  const { server, users } = accessServer();
  for (const role of ['admin', 'user']) {
    users.rows[1][2] = role;
    for (const active of ACTIVE_VALUES) {
      users.rows[1][3] = active;
      assert.equal(server.codexAssertCanWrite_('salvarTeste').role, role);
      assert.equal(server.codexGetCurrentUserAccess().canWrite, true);
    }
  }
  assert.throws(() => server.codexAssertAdmin_(), /administradores/);
  users.rows[1][2] = 'admin';
  assert.equal(server.codexAssertAdmin_().role, 'admin');
  users.rows[1][3] = '';
  assert.throws(() => server.codexAssertCanWrite_(), /inativo/);
});

test('escrita e apresentação rejeitam papel inválido mesmo sem passar pelo normalizador', () => {
  const { server } = accessServer();
  for (const role of [...INVALID_ROLES, 'readonly', 'ADMIN']) {
    server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, role });
    assert.throws(() => server.codexAssertCanWrite_('salvarTeste'), /somente leitura/);
    assert.equal(server.codexAccessPresentation_({ ok: true, role }).canWrite, false);
  }
  assert.equal(server.codexAccessPresentation_({ ok: false, role: 'admin' }).canWrite, false);
});

test('cadastro administrativo persiste readonly e inativo para permissões ausentes ou inválidas', () => {
  const { server, users } = accessServer('admin');
  server.codexCacheRemove_ = () => {};
  server.codexWriteAuditChanges_ = () => {};
  server.codexGetTeamBirthdays_ = () => [];
  for (const values of [{}, { role: 'constructor', ativo: 'desconhecido' }]) {
    const result = server.salvarUsuarioAdmin({
      email: 'novo@example.invalid', name: 'Novo usuário', rowIndex: users.rows.length > 2 ? 3 : undefined, ...values
    });
    assert.equal(result.role, 'readonly');
    assert.equal(result.ativo, 'Não');
    assert.deepEqual(users.rows[2].slice(2, 4), ['readonly', 'Não']);
  }
});

test('regra opcional de solicitação de exames mantém o contrato legado independente da ativação', () => {
  const { server } = accessServer();
  for (const value of [undefined, null, '', '   ', 'desconhecido', ...ACTIVE_VALUES]) {
    assert.equal(server.codexNormalizeCanRequestExams_(value), 'Sim', String(value));
  }
  for (const value of ['Não', 'nao', 'no', 'false', false, '0', 0, 'inativo', 'inactive']) {
    assert.equal(server.codexNormalizeCanRequestExams_(value), 'Não', String(value));
  }
  assert.equal(server.codexAssertCanRead_().podeSolicitarExames, 'Sim');
});
