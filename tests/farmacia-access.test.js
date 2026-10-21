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

function commonFixture(level = 'manage', role = 'admin') {
  const f = fixture('none', role);
  f.users.rows[0].push('Estudos da Farmácia (JSON)', 'Acesso ao estoque comum da Farmácia');
  f.users.rows[1].push('[]', level);
  return f;
}

test('estoque comum tem concessão independente, inclusive sem estudos ou perfil de escrita geral', () => {
  const rules = runHtmlScript('SharedAccessRules.html').CodexAccessRules;
  for (const role of ['admin', 'user', 'readonly']) {
    for (const level of ['none', 'read', 'operate', 'manage', 'constructor', '']) {
      const {server, users} = commonFixture(level, role);
      const allowed = ['read', 'operate', 'manage'].includes(level);
      const access = server.codexGetCurrentUserAccess();
      assert.equal(rules.isModuleVisible(access, 'farmacia'), allowed);
      if (allowed) {
        assert.equal(server.getFarmaciaBootstrap().farmaciaCommonAccess, level);
        assert.equal(server.getFarmaciaBootstrap().studies.length, 0);
        assert.equal(server.getFarmaciaEstudo('@IPS_COMMON').restrictedAllowed, false);
        assert.throws(() => server.getFarmaciaEstudo('P1'), /permissão/);
      } else assert.throws(() => server.getFarmaciaEstudo('@IPS_COMMON'), /permissão/);
      users.rows[1][3] = 'Não';
      assert.throws(() => server.getFarmaciaEstudo('@IPS_COMMON'), /inativo/);
      assert.equal(users.writes, 0);
    }
  }
  const f = commonFixture('none');
  f.users.rows[1][8] = 'manage';
  assert.throws(() => f.server.getFarmaciaEstudo('@IPS_COMMON'), /permissão/);
});

test('concessão comum só é alterada por Admin, preserva omissão e retorna nível salvo no DTO', () => {
  const {server, users} = commonFixture('read');
  let changes;
  server.codexWriteAuditChanges_ = (module, action, email, entries) => { changes = entries; };
  const payload = {rowIndex:2, email:'teste@example.invalid', name:'Teste', role:'admin', ativo:'Sim'};
  server.salvarUsuarioAdmin(payload);
  server.salvarMeuPerfil({name:'Teste', farmaciaCommonAccess:'manage'});
  server.salvarPerfisUsuariosAdmin({users:[{rowIndex:2, name:'Teste', farmaciaCommonAccess:'manage'}]});
  assert.equal(users.rows[1][10], 'read');
  const result = server.salvarUsuarioAdmin({...payload, farmaciaCommonAccess:'manage', farmaciaCommonOriginal:'read'});
  assert.equal(result.farmaciaCommonAccess, 'manage');
  assert.equal(users.rows[1][8], 'none'); assert.equal(users.rows[1][9], '[]');
  assert.ok(changes.some(change => change.field === 'Usuário - Estoque comum da Farmácia' && change.newValue === 'manage'));
  const writes = users.writes;
  assert.throws(() => server.salvarUsuarioAdmin({...payload, farmaciaCommonAccess:'none', farmaciaCommonOriginal:'read'}), /permissão do estoque comum mudou/);
  assert.equal(users.writes, writes);
  users.rows[1][2] = 'user';
  assert.throws(() => server.salvarUsuarioAdmin({...payload, farmaciaCommonAccess:'manage', farmaciaCommonOriginal:'manage'}), /administradores/);
});

test('cabeçalho K conflitante ou dados sem cabeçalho negam acesso e impedem qualquer escrita', () => {
  for (const header of ['', 'Observações']) {
    const {server, users} = commonFixture('manage');
    users.rows[0][10] = header; users.rows[0][4] = '';
    assert.equal(server.codexGetCurrentUserAccess().farmaciaCommonAccess, 'none');
    assert.throws(() => server.salvarUsuarioAdmin({rowIndex:2, email:'teste@example.invalid', name:'Teste', role:'admin', ativo:'Sim',
      farmaciaCommonAccess:'read', farmaciaCommonOriginal:''}), /coluna K/);
    assert.equal(users.writes, 0);
  }
  const f = fixture('none', 'admin');
  f.server.salvarUsuarioAdmin({rowIndex:2,email:'teste@example.invalid',name:'Teste',role:'admin',ativo:'Sim',farmaciaCommonAccess:'read',farmaciaCommonOriginal:''});
  assert.equal(f.users.rows[0][10], 'Acesso ao estoque comum da Farmácia');
  assert.equal(f.users.rows[0][9], undefined);
  assert.equal(f.server.getFarmaciaBootstrap().farmaciaCommonAccess, 'read');
});

test('concessão comum concorrente é revalidada sob lock e namespace reservado nunca vira estudo', () => {
  const f = commonFixture('read');
  f.lock.onAcquire = () => { f.users.rows[1][10] = 'none'; };
  assert.throws(() => f.server.salvarUsuarioAdmin({rowIndex:2,email:'teste@example.invalid',name:'Teste',role:'admin',ativo:'Sim',
    farmaciaCommonAccess:'manage',farmaciaCommonOriginal:'read'}), /permissão do estoque comum mudou/);
  assert.equal(f.users.writes, 0);
  assert.throws(() => f.server.codexNormalizeFarmaciaStudies_([{studyId:'@IPS_COMMON',restricted:false}]), /inválida/);
});

test('Farmácia exige concessão explícita independente do perfil geral e não abre estudos sem vínculo', () => {
  const rules = runHtmlScript('SharedAccessRules.html').CodexAccessRules;
  for (const role of ['admin', 'user', 'readonly']) {
    for (const level of ['none', 'read', 'operate', 'manage', '', 'constructor', '__proto__', 'outro']) {
      const { server, users } = fixture(level, role);
      const allowed = ['read', 'operate', 'manage'].includes(level);
      const access = server.codexGetCurrentUserAccess();
      assert.equal(rules.isModuleVisible(access, 'farmacia'), allowed);
      if (allowed) {
        const result = server.getFarmaciaBootstrap();
        assert.equal(result.stage, 'study-access');
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

function studyFixture(grants, role = 'admin', level = 'manage') {
  const f = fixture(level, role);
  f.users.rows[0].push('Estudos da Farmácia (JSON)');
  f.users.rows[1].push(typeof grants === 'string' ? grants : JSON.stringify(grants));
  f.projects = new FakeSheet('Projetos', [
    ['ID', 'Nome', 'Código', 'Informação clínica fora do catálogo'],
    ['P1', 'Estudo de teste', 'TEST-1', 'NÃO LER'],
    ['P2', 'Estudo de teste', 'TEST-2', 'NÃO LER']
  ]);
  const getRange = f.projects.getRange.bind(f.projects);
  f.projects.getRange = (...args) => {
    assert.equal(args[1], 1);
    assert.equal(args[3], 3, 'o catálogo lê apenas A:C');
    return getRange(...args);
  };
  f.server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Users: f.users, Projetos: f.projects });
  f.server.getProjetos = () => { throw new Error('Consulta ampla indevida'); };
  f.server.codexUserProfileFormations_ = () => [];
  return f;
}

test('vínculo por ID e autorização restrita são independentes de Admin/manage e revalidados sem cache', () => {
  for (const role of ['admin', 'user', 'readonly']) {
    const { server, users, projects } = studyFixture([{ studyId: 'P1', restricted: false }], role);
    assert.deepEqual(Array.from(server.getFarmaciaBootstrap().studies, study => study.id), ['P1']);
    assert.equal(server.getFarmaciaEstudo('P1').restrictedAllowed, false);
    assert.throws(() => server.getFarmaciaEstudo('P2'), /não autorizado/);
    assert.throws(() => server.getFarmaciaEstudo('p1'), /não autorizado/);
    assert.throws(() => server.getFarmaciaEstudo('Estudo de teste'), /não autorizado/);
    assert.throws(() => server.codexAssertFarmaciaAccess_('read', 'P1', true), /não autorizado/);
    users.rows[1][9] = JSON.stringify([{ studyId: 'P1', restricted: true }]);
    assert.equal(server.codexAssertFarmaciaAccess_('operate', 'P1', true).farmaciaRestricted, true);
    users.rows[1][9] = JSON.stringify([{ studyId: 'P1', restricted: false }]);
    assert.throws(() => server.codexAssertFarmaciaAccess_('read', 'P1', true), /não autorizado/);
    assert.equal(server.getFarmaciaEstudo('P1').restrictedAllowed, false);
    projects.rows[1][1] = 'Nome alterado';
    assert.equal(server.getFarmaciaEstudo('P1').study.nome, 'Nome alterado');
    users.rows[1][9] = '[]';
    assert.throws(() => server.getFarmaciaEstudo('P1'), /não autorizado/);
    assert.equal(users.writes + projects.writes, 0);
  }
});

test('JSON inválido, permissões parciais, duplicadas e cabeçalho alheio negam a lista inteira', () => {
  for (const invalid of ['{', '{}', 'null', '"P1"', '[{"studyId":"P1","restricted":false},{"studyId":"P2","restricted":"true"}]',
    JSON.stringify([{ studyId: 'P1', restricted: true }, { studyId: 'P1', restricted: false }]),
    JSON.stringify([{ studyId: '*', restricted: true }]), JSON.stringify([{ studyId: ' P1 ', restricted: true }])]) {
    const { server, users } = studyFixture(invalid);
    assert.equal(server.getFarmaciaBootstrap().studies.length, 0);
    assert.throws(() => server.getFarmaciaEstudo('P1'), /não autorizado/);
    assert.equal(users.writes, 0);
  }
  const { server, users } = studyFixture([{ studyId: 'P1', restricted: true }]);
  users.rows[0][9] = 'Observações';
  assert.equal(server.getFarmaciaBootstrap().studies.length, 0);
});

test('estudo inexistente, duplicado ou com espaços no ID não recebe acesso por aproximação', () => {
  const { server, projects } = studyFixture([{ studyId: 'P1', restricted: true }]);
  projects.rows[1][0] = ' P1 ';
  assert.throws(() => server.getFarmaciaEstudo('P1'), /indisponível/);
  projects.rows[1][0] = 'P1';
  projects.rows.push(['P1', 'Outro estudo', 'TEST-3']);
  assert.equal(server.getFarmaciaBootstrap().studies.length, 0);
  assert.throws(() => server.getFarmaciaEstudo('P1'), /indisponível/);
});

test('admin configura estudos com preflight, auditoria e controle de edição concorrente sob lock', () => {
  const { server, users, lock } = studyFixture([]);
  let changes;
  server.codexWriteAuditChanges_ = (module, action, email, entries) => { assert.equal(lock.held, true); changes = entries; };
  const payload = { rowIndex: 2, email: 'teste@example.invalid', name: 'Teste', role: 'admin', ativo: 'Sim',
    farmaciaStudiesOriginal: '[]', farmaciaStudies: [{ studyId: 'P1', restricted: true }] };
  server.salvarUsuarioAdmin(payload);
  assert.equal(JSON.parse(users.rows[1][9])[0].restricted, true);
  assert.ok(changes.some(change => change.field === 'Usuário - Estudos da Farmácia'));
  const writes = users.writes;
  assert.throws(() => server.salvarUsuarioAdmin(payload), /permissões por estudo mudaram/);
  assert.equal(users.writes, writes);
  const original = users.rows[1][9];
  lock.onAcquire = () => { users.rows[1][9] = '[]'; };
  assert.throws(() => server.salvarUsuarioAdmin({ ...payload, farmaciaStudiesOriginal: original }), /permissões por estudo mudaram/);
  assert.equal(users.writes, writes);
});

test('omissão e perfil próprio preservam JSON bruto; órfãos podem ser mantidos ou revogados', () => {
  const { server, users, projects } = studyFixture(' [ { "studyId": "P1", "restricted": false } ] ');
  const original = users.rows[1][9];
  const payload = { rowIndex: 2, email: 'teste@example.invalid', name: 'Teste', role: 'admin', ativo: 'Sim' };
  server.salvarUsuarioAdmin(payload);
  assert.equal(users.rows[1][9], original);
  server.salvarMeuPerfil({ name: 'Teste', farmaciaStudies: [{ studyId: 'P2', restricted: true }] });
  assert.equal(users.rows[1][9], original);
  server.salvarPerfisUsuariosAdmin({ users: [{ rowIndex: 2, name: 'Teste', farmaciaStudies: [] }] });
  assert.equal(users.rows[1][9], original);
  projects.rows[1][0] = 'P3';
  assert.throws(() => server.salvarUsuarioAdmin({ ...payload, farmaciaStudiesOriginal: original, farmaciaStudies: [{ studyId: 'P1', restricted: true }] }), /indisponível/);
  server.salvarUsuarioAdmin({ ...payload, farmaciaStudiesOriginal: original, farmaciaStudies: [{ studyId: 'P1', restricted: false }] });
  assert.equal(server.getFarmaciaBootstrap().studies.length, 0);
  server.salvarUsuarioAdmin({ ...payload, farmaciaStudiesOriginal: users.rows[1][9], farmaciaStudies: [] });
  assert.equal(users.rows[1][9], '[]');
});

test('cabeçalho J ocupado ou sem cabeçalho com dados bloqueia todas as escritas e não migra E:I', () => {
  for (const header of ['', 'Observações']) {
    const { server, users } = studyFixture('[]');
    users.rows[0][9] = header;
    users.rows[0][4] = '';
    assert.throws(() => server.salvarUsuarioAdmin({ rowIndex: 2, email: 'teste@example.invalid', name: 'Teste', role: 'admin', ativo: 'Sim',
      farmaciaStudiesOriginal: '', farmaciaStudies: [] }), /coluna J/);
    assert.equal(users.writes, 0);
  }
});

test('somente Admin recebe o catálogo completo; nível none bloqueia mesmo com estudos concedidos', () => {
  const { server, users } = studyFixture([{ studyId: 'P1', restricted: true }]);
  assert.equal(server.getUsersAdminBootstrap().farmaciaStudies.length, 2);
  users.rows[1][2] = 'user';
  assert.throws(() => server.getUsersAdminBootstrap(), /administradores/);
  users.rows[1][8] = 'none';
  assert.throws(() => server.getFarmaciaEstudo('P1'), /permissão/);
});

test('J é criada só em salvamento explícito e payload inválido é recusado antes das escritas', () => {
  const { server, users } = studyFixture([]);
  users.rows[0] = users.rows[0].slice(0, 9);
  users.rows[1] = users.rows[1].slice(0, 9);
  assert.equal(server.getFarmaciaBootstrap().studies.length, 0);
  assert.equal(users.writes, 0);
  const payload = { rowIndex: 2, email: 'teste@example.invalid', name: 'Teste', role: 'admin', ativo: 'Sim', farmaciaStudiesOriginal: '' };
  for (const farmaciaStudies of [null, 'P1', [{ studyId: 'P1', restricted: false }, { studyId: 'P2', restricted: 'false' }],
    Array.from({ length: 201 }, (_, index) => ({ studyId: 'P' + index, restricted: false }))]) {
    assert.throws(() => server.salvarUsuarioAdmin({ ...payload, farmaciaStudies }), /válid/);
    assert.equal(users.writes, 0);
  }
  server.salvarUsuarioAdmin({ ...payload, farmaciaStudies: [{ studyId: 'P1', restricted: false }] });
  assert.equal(users.rows[0][9], 'Estudos da Farmácia (JSON)');
  assert.equal(server.getFarmaciaEstudo('P1').restrictedAllowed, false);
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
