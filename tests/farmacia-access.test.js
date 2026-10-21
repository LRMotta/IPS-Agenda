'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, runHtmlScript } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

const headers = ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames'];
function fixture(level, role = 'user', header = 'Acesso à Farmácia') {
  const users = new FakeSheet('Users', [[...headers, header], ['teste@example.invalid', 'Teste', role, 'Sim', '', '', '', 'Sim', level]]);
  const lock = fakeDocumentLock();
  const server = runFile('WebApp.gs', { LockService: lock.LockService });
  server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Users: users });
  server.codexGetActiveUserEmail_ = () => 'teste@example.invalid';
  server.codexWriteAuditLog_ = () => {};
  server.codexWriteAuditChanges_ = () => {};
  server.codexWriteAuditLogBatch_ = () => {};
  server.codexWriteAuditChangesBatch_ = () => {};
  server.codexGetTeamBirthdays_ = () => [];
  return { server, users, lock: lock.state };
}

test('Farmácia exige concessão explícita independente do perfil geral e nunca abre estudos', () => {
  const rules = runHtmlScript('SharedAccessRules.html').CodexAccessRules;
  for (const role of ['admin', 'user', 'readonly']) {
    for (const level of ['none', 'read', 'operate', 'manage', '', 'constructor', '__proto__', 'outro']) {
      const { server, users } = fixture(level, role);
      const allowed = ['read', 'operate', 'manage'].includes(level);
      const access = server.codexGetCurrentUserAccess();
      assert.equal(rules.isModuleVisible(access, 'farmacia'), allowed);
      if (allowed) {
        const result = server.getFarmaciaBootstrap();
        assert.equal(result.stage, 'access-only');
        assert.equal(result.studies.length, 0);
        assert.equal(result.farmaciaAccess, level);
        for (const study of ['', 'P1', '*']) assert.throws(() => server.codexAssertFarmaciaAccess_('read', study), /por estudo/);
      } else assert.throws(() => server.getFarmaciaBootstrap(), /permissão/);
      for (const permission of ['read', 'operate', 'manage', 'invalid']) {
        if (['none', 'read', 'operate', 'manage'].indexOf(level) >= ['none', 'read', 'operate', 'manage'].indexOf(permission) && permission !== 'invalid' && level !== 'none') {
          assert.equal(server.codexAssertFarmaciaAccess_(permission).role, role);
        } else assert.throws(() => server.codexAssertFarmaciaAccess_(permission), /permissão/);
      }
      users.rows[1][3] = 'Não';
      assert.throws(() => server.getFarmaciaBootstrap(), /inativo/);
      assert.equal(rules.isModuleVisible(server.codexGetCurrentUserAccess(), 'farmacia'), false);
      assert.equal(users.writes, 0);
    }
    assert.equal(rules.isModuleVisible(role, 'farmacia'), false);
  }
});

test('coluna ausente ou alheia não concede acesso nem é migrada na leitura; revogação é imediata', () => {
  for (const header of ['', 'Observações', 'Outro acesso a farmacia']) {
    const { server, users } = fixture('manage', 'admin', header);
    assert.throws(() => server.getFarmaciaBootstrap(), /permissão/);
    assert.equal(server.getUsersAdminList()[0].farmaciaAccess, 'none');
    assert.equal(users.writes, 0);
  }
  const { server, users } = fixture('read', 'admin');
  assert.equal(server.getFarmaciaBootstrap().farmaciaAccess, 'read');
  users.rows[1][8] = 'none';
  assert.throws(() => server.getFarmaciaBootstrap(), /permissão/);
  users.rows[0] = headers.slice();
  users.rows[1] = users.rows[1].slice(0, 8);
  assert.throws(() => server.getFarmaciaBootstrap(), /permissão/);
  assert.equal(users.writes, 0);
});

test('somente admin atribui acesso, sob lock, preservando payload legado e auditando mudança', () => {
  const { server, users, lock } = fixture('read', 'admin');
  let audit;
  server.codexWriteAuditChanges_ = (...args) => { audit = args; assert.equal(lock.held, true); };
  const payload = { rowIndex: 2, email: 'teste@example.invalid', name: 'Teste', role: 'admin', ativo: 'Sim' };
  server.salvarUsuarioAdmin(payload);
  assert.equal(users.rows[1][8], 'read');
  server.salvarUsuarioAdmin({ ...payload, farmaciaAccess: 'manage' });
  assert.equal(users.rows[1][8], 'manage');
  const change = audit[3].find(item => item.field === 'Usuário - Acesso à Farmácia');
  assert.equal(change.oldValue, 'read');
  assert.equal(change.newValue, 'manage');
  assert.equal(audit[2], 'teste@example.invalid');
  users.rows[1][2] = 'user';
  const writes = users.writes;
  assert.throws(() => server.salvarUsuarioAdmin({ ...payload, farmaciaAccess: 'none' }), /administradores/);
  assert.equal(users.writes, writes);
  assert.equal(lock.held, false);
});

test('valida grant e todos os cabeçalhos antes de qualquer escrita', () => {
  for (const header of ['', 'Observações', 'Outro acesso a farmacia']) {
    const { server, users } = fixture('read', 'admin', header);
    users.rows[0][4] = '';
    assert.throws(() => server.salvarUsuarioAdmin({ rowIndex: 2, email: 'teste@example.invalid', name: 'Novo', role: 'admin', ativo: 'Sim', farmaciaAccess: 'read' }), /coluna I/);
    assert.equal(users.writes, 0);
  }
  const { server, users } = fixture('none', 'admin');
  for (const farmaciaAccess of ['other', '__proto__', '*', null, '']) {
    assert.throws(() => server.salvarUsuarioAdmin({ rowIndex: 2, email: 'teste@example.invalid', name: 'Novo', role: 'admin', ativo: 'Sim', farmaciaAccess }), /acesso válido/);
    assert.equal(users.writes, 0);
  }
});

test('migração explícita cria apenas o cabeçalho e grant selecionado; novo usuário legado fica sem acesso', () => {
  const { server, users } = fixture('', 'admin', '');
  server.salvarUsuarioAdmin({ email: 'novo@example.invalid', name: 'Novo', role: 'user', ativo: 'Sim' });
  assert.equal(server.getUsersAdminList().find(user => user.email === 'novo@example.invalid').farmaciaAccess, 'none');
  server.salvarUsuarioAdmin({ rowIndex: 2, email: 'teste@example.invalid', name: 'Teste', role: 'admin', ativo: 'Sim', farmaciaAccess: 'read' });
  assert.equal(users.rows[0][8], 'Acesso à Farmácia');
  assert.equal(server.getFarmaciaBootstrap().farmaciaAccess, 'read');
});

test('perfil próprio e carga rápida ignoram grants enviados e preservam permissão existente', () => {
  const { server, users } = fixture('none', 'admin');
  server.salvarMeuPerfil({ name: 'Atualizado', farmaciaAccess: 'manage' });
  assert.equal(users.rows[1][8], 'none');
  server.salvarPerfisUsuariosAdmin({ users: [{ rowIndex: 2, name: 'Outro', farmaciaAccess: 'manage' }] });
  assert.equal(users.rows[1][8], 'none');
  users.rows[1][8] = 'manage';
  server.salvarMeuPerfil({ name: 'Atualizado', farmaciaAccess: 'none' });
  assert.equal(users.rows[1][8], 'manage');
});

test('admin perde autoridade enquanto espera lock e nenhuma permissão é gravada', () => {
  const { server, users, lock } = fixture('none', 'admin');
  lock.onAcquire = () => { users.rows[1][2] = 'user'; };
  assert.throws(() => server.salvarUsuarioAdmin({ email: 'novo@example.invalid', name: 'Novo', farmaciaAccess: 'manage' }), /administradores/);
  assert.equal(users.writes, 0);
});
