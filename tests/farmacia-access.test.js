'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runHtmlScript } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

// Modelo único da Farmácia: Farmacêutico(a) Sim/Não. Somente a coluna L ("todos") concede acesso.
const HEADERS = ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames',
  'Acesso à Farmácia', 'Estudos da Farmácia (JSON)', 'Acesso ao estoque comum da Farmácia', 'Escopo dos estudos da Farmácia'];
const BASE = { rowIndex: 2, email: 'teste@example.invalid', name: 'Teste', role: 'admin', ativo: 'Sim' };

function fixture({ scope = 'todos', grants = [], role = 'admin', level = 'manage', common = 'manage', headers = HEADERS } = {}) {
  const row = ['teste@example.invalid', 'Teste', role, 'Sim', '', '', '', 'Sim', level, typeof grants === 'string' ? grants : JSON.stringify(grants), common, scope];
  const users = new FakeSheet('Users', [headers.slice(), row.slice(0, headers.length)]);
  const projects = new FakeSheet('Projetos', [
    ['ID', 'Nome', 'Código', 'Informação clínica fora do catálogo'],
    ['P1', 'Estudo de teste', 'TEST-1', 'NÃO LER'],
    ['P2', 'Estudo de teste', 'TEST-2', 'NÃO LER']
  ]);
  const getRange = projects.getRange.bind(projects);
  projects.getRange = (...args) => {
    assert.equal(args[1], 1);
    assert.equal(args[3], 3, 'o catálogo lê apenas A:C');
    return getRange(...args);
  };
  const lock = fakeDocumentLock();
  const server = runFiles(['WebApp.gs', 'FarmaciaEstoque.gs'], { LockService: lock.LockService });
  server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Users: users, Projetos: projects });
  server.codexGetActiveUserEmail_ = () => 'teste@example.invalid';
  server.codexWriteAuditLog_ = () => {};
  server.codexWriteAuditChanges_ = () => {};
  server.codexWriteAuditLogBatch_ = () => {};
  server.codexWriteAuditChangesBatch_ = () => {};
  server.codexGetTeamBirthdays_ = () => [];
  server.codexUserProfileFormations_ = () => [];
  server.getProjetos = () => { throw new Error('Consulta ampla indevida'); };
  return { server, users, projects, lock: lock.state };
}

test('Farmacêutico(a) acessa o estoque Geral e os estoques não restritos de todos os estudos, inclusive novos', () => {
  const rules = runHtmlScript('SharedAccessRules.html').CodexAccessRules;
  for (const role of ['admin', 'user', 'readonly']) {
    const { server, users, projects } = fixture({ role });
    assert.equal(rules.isModuleVisible(server.codexGetCurrentUserAccess(), 'farmacia'), true);
    const boot = server.getFarmaciaBootstrap();
    assert.equal(boot.farmaciaAccess, 'manage');
    assert.equal(boot.farmaciaCommonAccess, 'manage');
    assert.deepEqual(Array.from(boot.studies, study => study.id), ['P1', 'P2']);
    assert.equal(server.getFarmaciaEstudo('@IPS_COMMON').restrictedAllowed, false);
    assert.equal(server.getFarmaciaEstudo('P2').restrictedAllowed, false);
    assert.equal(server.codexAssertFarmaciaAccess_('manage', 'P1', false).farmaciaRestricted, false);
    assert.equal(server.codexAssertFarmaciaProductsAccess_('P2', false).farmaciaRestricted, false);
    projects.rows.push(['P9', 'Estudo novo', 'TEST-9']);
    assert.ok(server.getFarmaciaBootstrap().studies.some(study => study.id === 'P9'), 'projeto novo entra sem reconfigurar usuários');
    for (const study of ['', '*', 'p1', 'P404']) assert.throws(() => server.codexAssertFarmaciaAccess_('read', study));
    users.rows[1][3] = 'Não';
    assert.throws(() => server.getFarmaciaBootstrap(), /inativo/);
    assert.equal(users.writes, 0);
  }
});

test('"todos" nunca abre a classe restrita; somente concessões restritas explícitas em J a abrem', () => {
  const { server, users } = fixture({ grants: [{ studyId: 'P2', restricted: true }] });
  for (const study of ['P1']) assert.throws(() => server.codexAssertFarmaciaAccess_('read', study, true), /não autorizado/);
  assert.equal(server.codexAssertFarmaciaAccess_('read', 'P2', true).farmaciaRestricted, true);
  assert.equal(server.getFarmaciaEstudo('P2').restrictedAllowed, true);
  assert.equal(server.getFarmaciaEstudo('P1').restrictedAllowed, false);
  // Entradas não restritas em J (modelo antigo) são ignoradas e não ampliam nada.
  users.rows[1][9] = JSON.stringify([{ studyId: 'P1', restricted: false }]);
  assert.throws(() => server.codexAssertFarmaciaAccess_('read', 'P1', true), /não autorizado/);
  assert.equal(server.getFarmaciaEstudo('P1').restrictedAllowed, false);
  // JSON inválido ou cabeçalho J alheio removem somente os restritos; "todos" segue valendo.
  for (const invalid of ['{', 'null', '"P1"', JSON.stringify([{ studyId: 'P2', restricted: 'true' }]), JSON.stringify([{ studyId: '*', restricted: true }])]) {
    users.rows[1][9] = invalid;
    assert.throws(() => server.codexAssertFarmaciaAccess_('read', 'P2', true), /não autorizado/);
    assert.equal(server.getFarmaciaEstudo('P2').restrictedAllowed, false);
  }
  users.rows[1][9] = JSON.stringify([{ studyId: 'P2', restricted: true }]);
  users.rows[0][9] = 'Observações';
  assert.throws(() => server.codexAssertFarmaciaAccess_('read', 'P2', true), /não autorizado/);
  assert.equal(users.writes, 0);
});

test('sem "todos" na coluna L não há acesso, mesmo com níveis ou concessões do modelo antigo', () => {
  for (const scope of ['', 'Todos os estudos', 'sim', '*', 'all', 'constructor', '__proto__']) {
    for (const role of ['admin', 'user', 'readonly']) {
      const { server, users } = fixture({ scope, role, grants: [{ studyId: 'P1', restricted: true }, { studyId: 'P2', restricted: false }] });
      const boot = server.getFarmaciaBootstrap();
      assert.equal(boot.farmaciaAccess, 'none', scope);
      assert.equal(boot.farmaciaCommonAccess, 'none', scope);
      assert.equal(boot.studies.length, 0, scope);
      assert.throws(() => server.getFarmaciaEstudo('@IPS_COMMON'), /permissão/);
      assert.throws(() => server.getFarmaciaEstudo('P1'), /permissão/);
      assert.throws(() => server.codexAssertFarmaciaAccess_('read', 'P1', true));
      assert.equal(users.writes, 0);
    }
  }
});

test('cabeçalho L ausente, vazio ou alheio nega acesso e a leitura nunca migra a planilha', () => {
  for (const header of ['', 'Observações', 'Outro escopo']) {
    const headers = HEADERS.slice(0, 11).concat([header]);
    const { server, users } = fixture({ headers });
    assert.equal(server.getFarmaciaBootstrap().farmaciaAccess, 'none');
    assert.equal(server.getUsersAdminList()[0].farmaciaAllStudies, false);
    assert.equal(server.getUsersAdminList()[0].farmaciaAccess, 'none');
    assert.equal(users.writes, 0);
  }
  const { server, users } = fixture({ headers: HEADERS.slice(0, 8) });
  assert.equal(server.getFarmaciaBootstrap().farmaciaAccess, 'none');
  assert.equal(users.writes, 0);
  const revoked = fixture();
  assert.equal(revoked.server.getFarmaciaBootstrap().farmaciaAccess, 'manage');
  revoked.users.rows[1][11] = '';
  assert.equal(revoked.server.getFarmaciaBootstrap().farmaciaAccess, 'none', 'revogação é imediata, sem cache');
});

test('catálogo usa somente ID exato e único, lendo apenas A:C', () => {
  const { server, projects } = fixture({ grants: [{ studyId: 'P1', restricted: true }] });
  projects.rows[1][0] = ' P1 ';
  assert.throws(() => server.getFarmaciaEstudo('P1'), /indisponível/);
  projects.rows[1][0] = 'P1';
  projects.rows.push(['P1', 'Outro estudo', 'TEST-3']);
  assert.deepEqual(Array.from(server.getFarmaciaBootstrap().studies, study => study.id), ['P2']);
  assert.throws(() => server.getFarmaciaEstudo('P1'), /indisponível/);
  assert.throws(() => server.codexNormalizeFarmaciaStudies_([{ studyId: '@IPS_COMMON', restricted: true }]), /inválida/);
});

test('admin grava Sim: deriva I/J/K/L no servidor, ignora níveis do cliente e audita a troca de escopo', () => {
  const { server, users, lock } = fixture({ scope: '', level: 'none', common: 'none' });
  let changes;
  server.codexWriteAuditChanges_ = (module, action, email, entries) => { assert.equal(lock.held, true); changes = entries; };
  const sim = { ...BASE, farmaciaAllStudies: true, farmaciaScopeOriginal: '', farmaciaStudiesOriginal: users.rows[1][9],
    farmaciaAccess: 'read', farmaciaCommonAccess: 'read',
    farmaciaStudies: [{ studyId: 'P2', restricted: true }, { studyId: 'P1', restricted: false }] };
  const result = server.salvarUsuarioAdmin(sim);
  assert.equal(result.farmaciaAllStudies, true);
  assert.equal(result.farmaciaAccess, 'manage');
  assert.deepEqual(users.rows[1].slice(8, 12), ['manage', JSON.stringify([{ studyId: 'P2', restricted: true }]), 'manage', 'todos']);
  assert.ok(changes.some(c => c.field === 'Usuário - Escopo dos estudos da Farmácia' && c.oldValue === 'Selecionados' && c.newValue === 'Todos os estudos'));
  const listed = server.getUsersAdminList()[0];
  assert.equal(listed.farmaciaAllStudies, true);
  assert.equal(listed.farmaciaScopeOriginal, 'todos');
  assert.deepEqual(Array.from(listed.farmaciaStudies, grant => grant.studyId), ['P2']);
  assert.equal(server.getFarmaciaEstudo('P2').restrictedAllowed, true);
  assert.equal(server.getFarmaciaEstudo('P1').restrictedAllowed, false);
  // Não: limpa tudo.
  server.salvarUsuarioAdmin({ ...BASE, farmaciaAllStudies: false, farmaciaScopeOriginal: 'todos', farmaciaStudiesOriginal: users.rows[1][9], farmaciaStudies: [{ studyId: 'P2', restricted: true }] });
  assert.deepEqual(users.rows[1].slice(8, 12), ['none', '[]', 'none', '']);
  assert.equal(server.getFarmaciaBootstrap().farmaciaAccess, 'none');
});

test('omissão preserva a linha; valores inválidos e edição concorrente são recusados antes de escrever', () => {
  const { server, users, lock } = fixture({ grants: [{ studyId: 'P1', restricted: true }] });
  const before = users.rows[1].slice(8, 12);
  server.salvarUsuarioAdmin(BASE);
  assert.deepEqual(users.rows[1].slice(8, 12), before);
  // Campos do modelo antigo sem farmaciaAllStudies não alteram nada.
  server.salvarUsuarioAdmin({ ...BASE, farmaciaAccess: 'none', farmaciaCommonAccess: 'none', farmaciaStudies: [] });
  assert.deepEqual(users.rows[1].slice(8, 12), before);
  const writes = users.writes;
  const sim = { ...BASE, farmaciaAllStudies: true, farmaciaScopeOriginal: 'todos', farmaciaStudiesOriginal: users.rows[1][9], farmaciaStudies: [] };
  for (const farmaciaAllStudies of ['true', 1, null, undefined]) {
    assert.throws(() => server.salvarUsuarioAdmin({ ...sim, farmaciaAllStudies }), /Sim ou Não/);
  }
  assert.throws(() => server.salvarUsuarioAdmin({ ...sim, farmaciaScopeOriginal: '' }), /escopo de estudos da Farmácia mudou/);
  assert.throws(() => server.salvarUsuarioAdmin({ ...sim, farmaciaStudiesOriginal: '[]' }), /permissões por estudo mudaram/);
  for (const farmaciaStudies of [null, 'P1', [{ studyId: 'P1', restricted: 'true' }], Array.from({ length: 201 }, (_, i) => ({ studyId: 'P' + i, restricted: true }))]) {
    if (farmaciaStudies === null) continue; // null equivale a lista vazia
    assert.throws(() => server.salvarUsuarioAdmin({ ...sim, farmaciaStudies }), /válid|inválid/);
  }
  assert.equal(users.writes, writes);
  lock.onAcquire = () => { users.rows[1][11] = ''; };
  assert.throws(() => server.salvarUsuarioAdmin(sim), /escopo de estudos da Farmácia mudou/);
  assert.equal(users.writes, writes);
  lock.onAcquire = null;
  lock.onAcquire = () => { users.rows[1][9] = '[]'; };
  users.rows[1][11] = 'todos';
  assert.throws(() => server.salvarUsuarioAdmin(sim), /permissões por estudo mudaram/);
  assert.equal(users.writes, writes);
});

test('restrito órfão pode ser mantido ou revogado, nunca criado', () => {
  const { server, users, projects } = fixture({ grants: [{ studyId: 'P1', restricted: true }] });
  projects.rows[1][0] = 'P3';
  const sim = () => ({ ...BASE, farmaciaAllStudies: true, farmaciaScopeOriginal: 'todos', farmaciaStudiesOriginal: users.rows[1][9] });
  assert.throws(() => server.salvarUsuarioAdmin({ ...sim(), farmaciaStudies: [{ studyId: 'P1', restricted: true }, { studyId: 'P8', restricted: true }] }), /indisponível/);
  server.salvarUsuarioAdmin({ ...sim(), farmaciaStudies: [{ studyId: 'P1', restricted: true }] });
  assert.equal(JSON.parse(users.rows[1][9])[0].studyId, 'P1');
  server.salvarUsuarioAdmin({ ...sim(), farmaciaStudies: [] });
  assert.equal(users.rows[1][9], '[]');
});

test('primeiro salvamento cria os cabeçalhos I:L; cabeçalho alheio bloqueia tudo antes de escrever', () => {
  const { server, users } = fixture({ headers: HEADERS.slice(0, 8) });
  assert.equal(server.getFarmaciaBootstrap().farmaciaAccess, 'none');
  assert.equal(users.writes, 0);
  server.salvarUsuarioAdmin({ ...BASE, farmaciaAllStudies: true, farmaciaScopeOriginal: '', farmaciaStudiesOriginal: '', farmaciaStudies: [] });
  assert.deepEqual(users.rows[0].slice(8, 12), HEADERS.slice(8, 12));
  assert.equal(server.getFarmaciaBootstrap().farmaciaAccess, 'manage');
  for (const [column, letter] of [[8, 'I'], [9, 'J'], [10, 'K'], [11, 'L']]) {
    const f = fixture({ scope: '' });
    f.users.rows[0][column] = 'Observações'; f.users.rows[0][4] = '';
    assert.throws(() => f.server.salvarUsuarioAdmin({ ...BASE, farmaciaAllStudies: true, farmaciaScopeOriginal: '', farmaciaStudiesOriginal: column === 9 ? '' : f.users.rows[1][9], farmaciaStudies: [] }),
      new RegExp('coluna ' + letter));
    assert.equal(f.users.writes, 0);
  }
  const semCabecalho = fixture({ scope: '', headers: HEADERS.slice(0, 11).concat(['']) });
  semCabecalho.users.rows[1][11] = 'x';
  assert.throws(() => semCabecalho.server.salvarUsuarioAdmin({ ...BASE, farmaciaAllStudies: true, farmaciaScopeOriginal: '', farmaciaStudiesOriginal: '[]', farmaciaStudies: [] }), /coluna L/);
  assert.equal(semCabecalho.users.writes, 0);
});

test('somente Admin atribui acesso, sob lock, e perde a autoridade se mudar enquanto espera', () => {
  const { server, users, lock } = fixture({ role: 'admin', scope: '' });
  const sim = { ...BASE, farmaciaAllStudies: true, farmaciaScopeOriginal: '', farmaciaStudiesOriginal: users.rows[1][9], farmaciaStudies: [] };
  server.salvarUsuarioAdmin(sim);
  assert.equal(lock.held, false);
  assert.equal(users.rows[1][11], 'todos');
  users.rows[1][2] = 'user';
  const writes = users.writes;
  assert.throws(() => server.salvarUsuarioAdmin({ ...sim, farmaciaAllStudies: false, farmaciaScopeOriginal: 'todos' }), /administradores/);
  assert.throws(() => server.getUsersAdminBootstrap(), /administradores/);
  users.rows[1][2] = 'admin';
  lock.onAcquire = () => { users.rows[1][2] = 'user'; };
  assert.throws(() => server.salvarUsuarioAdmin({ ...BASE, email: 'novo@example.invalid', rowIndex: 0, name: 'Novo', farmaciaAllStudies: true }), /administradores/);
  assert.equal(users.writes, writes);
  assert.equal(lock.held, false);
});

test('somente Admin recebe o catálogo completo para a lista de restritos', () => {
  const { server } = fixture({ role: 'admin' });
  assert.equal(server.getUsersAdminBootstrap().farmaciaStudies.length, 2);
});

test('perfil próprio e carga rápida ignoram campos da Farmácia e preservam a permissão existente', () => {
  const { server, users } = fixture({ scope: '', role: 'admin', level: 'none', common: 'none' });
  const before = users.rows[1].slice(8, 12);
  server.salvarMeuPerfil({ name: 'Atualizado', farmaciaAllStudies: true, farmaciaAccess: 'manage', farmaciaStudies: [{ studyId: 'P1', restricted: true }] });
  server.salvarPerfisUsuariosAdmin({ users: [{ rowIndex: 2, name: 'Outro', farmaciaAllStudies: true, farmaciaAccess: 'manage', farmaciaCommonAccess: 'manage' }] });
  assert.deepEqual(users.rows[1].slice(8, 12), before);
  users.rows[1][11] = 'todos';
  server.salvarMeuPerfil({ name: 'Atualizado', farmaciaAllStudies: false });
  assert.equal(users.rows[1][11], 'todos');
});
