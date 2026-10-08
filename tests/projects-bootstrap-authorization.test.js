'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const users = new FakeSheet('Users', [
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário', 'Formação', 'Registro', 'Pode solicitar exames'],
    ['reader@example.invalid', 'Leitor', 'readonly', 'Sim', '', 'Enfermagem', 'SIMULADO', 'Sim'],
    ['inactive@example.invalid', 'Inativo', 'user', 'Não', '', '', '', 'Sim'],
    ['blocked@example.invalid', 'Sem exames', 'user', 'Sim', '', '', '', 'Não']
  ]);
  const medicos = new FakeSheet('🩺 Médicos', [
    ['ID', 'Nome', 'Especialidade', 'CPF', 'Registro', 'Telefone', 'Email'],
    ['MED-1', 'Médico simulado', 'Especialidade', '0123', 'REG-SIMULADO', '01234', 'med@example.invalid']
  ]);
  const ss = new FakeSpreadsheet({ Users: users, '🩺 Médicos': medicos });
  const counts = { users: 0, http: 0, config: 0, projects: 0 };
  const getRange = users.getRange.bind(users);
  users.getRange = (...args) => {
    const range = getRange(...args);
    const getValues = range.getValues.bind(range);
    range.getValues = () => { counts.users++; return getValues(); };
    return range;
  };
  const lock = fakeDocumentLock();
  const server = runFiles(['AgendaServerRules.gs', 'WebApp.gs'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Session: { getActiveUser: () => ({ getEmail: () => 'reader@example.invalid' }) },
    UrlFetchApp: { fetch: () => { counts.http++; throw new Error('HTTP proibido no teste'); } },
    LockService: lock.LockService
  });
  server.getConfigValues_ = () => { counts.config++; return ['Opção simulada']; };
  server.getConfigAppValuesByKeys_ = () => ['AMBIENTE'];
  server.getCodexSheetDataByName_ = name => {
    assert.equal(name, 'Projetos');
    counts.projects++;
    return [['ID', 'Nome', 'Código'], ['P1', 'Projeto simulado', 'PROTOCOLO-SIMULADO']];
  };
  server.getParticipantesStatsPorProjeto_ = () => ({});
  server.getProjetosSivPorProjeto_ = () => ({});
  server.codexWriteAuditLog_ = () => {};
  return { server, users, counts, lock: lock.state };
}

test('bootstrap de Projetos lê Users uma vez e preserva DTO das RPCs autorizadas', () => {
  const f = fixture();
  const result = plain(f.server.getCadastrosBootstrapData('projetos'));
  assert.equal(f.counts.users, 1);
  assert.equal(f.counts.http, 0);
  assert.equal(result.access.role, 'readonly');
  assert.equal(result.access.canWrite, false);
  assert.deepEqual(result.solicitantes.map(user => user.id), ['reader@example.invalid']);
  assert.equal(result.data[0].id, 'P1');
  assert.equal(result.medicos[0].cpf, '0123');
  assert.equal(result.users, undefined);
  assert.equal(result.readSnapshot, undefined);
  const direct = fixture().server;
  assert.deepEqual(result.config, plain(direct.getProjetoFormConfig()));
  assert.deepEqual(result.data, plain(direct.getProjetos()));
  assert.deepEqual(result.medicos, plain(direct.getMedicos()));
  assert.deepEqual(result.solicitantes, plain(direct.getSolicitantes()));
});

test('bootstrap de Médicos e Solicitantes não repete a leitura da ACL', () => {
  const medicos = fixture();
  const medicosResult = plain(medicos.server.getCadastrosBootstrapData('medicos'));
  assert.equal(medicos.counts.users, 1);
  assert.equal(medicosResult.data[0].cpf, '0123');
  assert.deepEqual(medicosResult.config.especialidades, ['Opção simulada']);

  const solicitantes = fixture();
  const solicitantesResult = plain(solicitantes.server.getCadastrosBootstrapData('solicitantes'));
  assert.equal(solicitantes.counts.users, 1);
  assert.deepEqual(solicitantesResult.data.map(user => user.id), ['reader@example.invalid']);
});

test('RPCs diretas e autorização de escrita/administração não herdam snapshot do bootstrap', () => {
  const f = fixture();
  f.server.getCadastrosBootstrapData('projetos');
  const protectedReads = f.counts.projects + f.counts.config;
  f.users.rows[1][3] = 'Não';
  for (const call of [
    () => f.server.getProjetoFormConfig(), () => f.server.getProjetos(),
    () => f.server.getProjetosDados_(false), () => f.server.getMedicos(),
    () => f.server.getSolicitantes(), () => f.server.codexAssertCanWrite_(),
    () => f.server.codexAssertAdmin_(), () => f.server.getCadastrosBootstrapData('projetos')
  ]) assert.throws(call, /inativo/);
  assert.equal(f.counts.users, 9);
  assert.equal(f.counts.projects + f.counts.config, protectedReads);
});

test('nova composição no mesmo runtime reflete alterações em Users e falhas não deixam memo', () => {
  const f = fixture();
  f.server.getCadastrosBootstrapData('projetos');
  f.users.rows[1][1] = 'Nome atualizado';
  f.users.rows[1][7] = 'Não';
  const result = f.server.getCadastrosBootstrapData('projetos');
  assert.equal(f.counts.users, 2);
  assert.equal(result.access.name, 'Nome atualizado');
  assert.equal(result.solicitantes.length, 0);
  f.server.getProjetoFormConfigDados_ = () => { throw new Error('Falha simulada'); };
  assert.throws(() => f.server.getCadastrosBootstrapData('projetos'), /Falha simulada/);
  f.users.rows[1][3] = 'Não';
  assert.throws(() => f.server.getCadastrosBootstrapData('projetos'), /inativo/);
  assert.equal(f.counts.users, 4);
});

test('snapshot preexistente não concede acesso e escrita após esperar lock lê ACL fresca', () => {
  const f = fixture();
  const forged = { users: { 'reader@example.invalid': { active: true, role: 'admin' } } };
  assert.equal(f.server.codexAssertCanRead_(forged).role, 'readonly');
  assert.equal(forged.users['reader@example.invalid'].role, 'readonly');
  f.users.rows[1][2] = 'admin';
  f.server.getCadastrosBootstrapData('projetos');
  f.lock.onAcquire = () => { f.users.rows[1][3] = 'Não'; };
  assert.throws(() => f.server.codexWithDocumentLock_('mutacao_simulada', () => f.server.codexAssertCanWrite_()), /inativo/);
  assert.equal(f.lock.released, 1);
  assert.equal(f.counts.users, 3);
  assert.throws(() => f.server.codexAssertCanRead_(forged), /inativo/);
});

test('constantes e invalidações de cache ACL persistente obsoleto foram removidas', () => {
  assert.doesNotMatch(readProjectFile('WebApp.gs'), /CODEX_ACL_CACHE_KEY_|CODEX_ACL_CACHE_SECONDS_/);
});
