'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function identityServer(activeEmail, effectiveEmail = 'owner@example.invalid', failure = '') {
  const calls = { effective: 0, token: 0, http: 0, reads: 0 };
  const users = new FakeSheet('Users', [
    ['Email', 'Nome', 'Perfil', 'Ativo'],
    ['owner@example.invalid', 'Owner', 'admin', 'Sim'],
    ['reader@example.invalid', 'Reader', 'readonly', 'Sim'],
    ['user@example.invalid', 'User', 'user', 'Sim']
  ]);
  const server = runFile('WebApp.gs', {
    Session: {
      getActiveUser: () => {
        if (failure === 'session') throw new Error('Identidade indisponível');
        return { getEmail: () => {
          if (failure === 'email') throw new Error('E-mail indisponível');
          return activeEmail;
        } };
      },
      getEffectiveUser: () => { calls.effective++; return { getEmail: () => effectiveEmail }; }
    },
    ScriptApp: { getOAuthToken: () => { calls.token++; return 'TOKEN_SIMULADO'; } },
    UrlFetchApp: { fetch: () => {
      calls.http++;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ email: 'owner@example.invalid' }) };
    } }
  });
  server.getCodexSpreadsheet_ = () => {
    calls.reads++;
    return new FakeSpreadsheet({ Users: users });
  };
  server.codexWriteAuditLog_ = () => {};
  return { server, calls, users };
}

test('identidade ausente ou com erro nunca usa proprietário nem OAuth userinfo para autorizar', () => {
  for (const effectiveEmail of ['owner@example.invalid', '']) {
    for (const input of [
      { email: '' }, { email: '   ' }, { email: undefined },
      { email: '', failure: 'session' }, { email: '', failure: 'email' }
    ]) {
      const { server, calls, users } = identityServer(input.email, effectiveEmail, input.failure);
      assert.equal(server.codexGetActiveUserEmail_(), '');
      const access = server.codexAuthorizeWebAppRequest_();
      assert.equal(access.ok, false);
      assert.equal(access.userEmail, '');
      assert.equal(server.codexGetCurrentUserAccess().canWrite, false);
      for (const method of ['codexAssertCanRead_', 'codexAssertCanWrite_', 'codexAssertAdmin_', 'getUsersAdminList', 'salvarUsuarioAdmin']) {
        assert.throws(() => server[method](), /identificar seu e-mail/);
      }
      assert.deepEqual(calls, { effective: 0, token: 0, http: 0, reads: 0 });
      assert.equal(users.writes, 0);
    }
  }
});

test('identidade ativa prevalece sobre proprietário admin e mantém o perfil do visitante', () => {
  for (const [email, role] of [['reader@example.invalid', 'readonly'], ['user@example.invalid', 'user']]) {
    const { server, calls } = identityServer('  ' + email.toUpperCase() + '  ');
    const access = server.codexAssertCanRead_();
    assert.equal(access.userEmail, email);
    assert.equal(access.role, role);
    assert.throws(() => server.codexAssertAdmin_(), /administradores/);
    if (role === 'readonly') assert.throws(() => server.codexAssertCanWrite_(), /somente leitura/);
    else assert.equal(server.codexAssertCanWrite_().role, 'user');
    assert.equal(calls.effective + calls.token + calls.http, 0);
  }
});

test('visitante não cadastrado não herda acesso do proprietário; admin identificado mantém acesso', () => {
  const unknown = identityServer('unknown@example.invalid');
  assert.equal(unknown.server.codexAuthorizeWebAppRequest_().ok, false);
  assert.throws(() => unknown.server.codexAssertAdmin_(), /não esta autorizado|nao esta autorizado/);
  const owner = identityServer('owner@example.invalid');
  assert.equal(owner.server.codexAssertAdmin_().role, 'admin');
  assert.equal(owner.server.codexAssertCanWrite_().userEmail, 'owner@example.invalid');
  assert.equal(owner.calls.effective + owner.calls.token + owner.calls.http, 0);
});

test('diagnóstico explícito pode mostrar usuário efetivo sem conceder acesso', () => {
  const { server, calls } = identityServer('');
  const access = server.codexAuthorizeWebAppRequest_({ parameter: { debugAuth: '1' } });
  assert.equal(access.ok, false);
  assert.equal(access.userEmail, '');
  assert.equal(access.debugAuth.activeUserEmail, '');
  assert.equal(access.debugAuth.effectiveUserEmail, 'owner@example.invalid');
  assert.equal(access.debugAuth.userinfoEmail, 'owner@example.invalid');
  assert.deepEqual(calls, { effective: 1, token: 1, http: 1, reads: 0 });
  assert.equal(server.codexAuthorizeWebAppRequest_().ok, false);
});
