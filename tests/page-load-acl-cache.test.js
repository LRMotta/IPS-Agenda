'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fakeCache() {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    cache: {
      get: (key) => (store.has(key) ? store.get(key) : null),
      put: (key, value, ttl) => { puts.push({ key, ttl }); store.set(key, value); },
      remove: (key) => { store.delete(key); }
    }
  };
}

function aclServer(initialUsers) {
  const cache = fakeCache();
  const logs = [];
  const server = runFile('WebApp.gs', {
    CacheService: { getScriptCache: () => cache.cache },
    Logger: { log: (line) => logs.push(String(line)) }
  });
  const state = { users: initialUsers, reads: 0, email: 'ana@example.invalid' };
  server.codexGetActiveUserEmail_ = () => state.email;
  server.codexGetAllowedUsers_ = () => {
    state.reads += 1;
    return JSON.parse(JSON.stringify(state.users));
  };
  return { server, cache, state, logs };
}

function user(role, active) {
  return { name: 'Pessoa', firstName: 'Pessoa', birthday: '', role, active };
}

test('abertura reutiliza a ACL em cache; RPCs comuns e mutações sempre leem Users', () => {
  const { server, cache, state } = aclServer({ 'ana@example.invalid': user('admin', true) });

  const meta1 = {};
  assert.equal(server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: meta1 }).ok, true);
  assert.equal(meta1.cacheMiss, true);
  assert.equal(state.reads, 1);
  assert.equal(cache.puts[0].ttl, server.CODEX_PAGE_LOAD_ACL_CACHE_TTL_SECONDS_);

  const meta2 = {};
  assert.equal(server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: meta2 }).ok, true);
  assert.equal(meta2.cacheHit, true);
  assert.equal(state.reads, 1, 'segunda abertura não relê Users');

  // Revogação ainda dentro do TTL: leituras protegidas e mutações já negam.
  state.users = { 'ana@example.invalid': user('readonly', true) };
  assert.throws(() => server.codexAssertCanWrite_('qualquer', 'Agenda', ''), /somente leitura/);
  assert.equal(state.reads, 2);
  state.users = { 'outra@example.invalid': user('admin', true) };
  assert.throws(() => server.codexAssertCanRead_(), /nao esta autorizado/);
  assert.equal(server.codexGetCurrentUserAccess().ok, false);
  assert.equal(state.reads, 4);
});

test('cache nunca nega a abertura: usuário ausente ou inativo no cache é confirmado em Users', () => {
  const { server, state } = aclServer({ 'ana@example.invalid': user('admin', true) });
  server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: {} });
  assert.equal(state.reads, 1);

  // Novo usuário cadastrado direto na planilha durante o TTL.
  state.email = 'bia@example.invalid';
  state.users = { 'ana@example.invalid': user('admin', true), 'bia@example.invalid': user('user', true) };
  const meta = {};
  const access = server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: meta });
  assert.equal(access.ok, true);
  assert.equal(access.role, 'user');
  assert.equal(meta.cacheMiss, true);
  assert.equal(state.reads, 2);

  // A releitura atualiza o cache para as próximas aberturas.
  const metaNext = {};
  assert.equal(server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: metaNext }).ok, true);
  assert.equal(metaNext.cacheHit, true);
  assert.equal(state.reads, 2);
});

test('escritas em Users invalidam o cache e bypass ignora a leitura do cache', () => {
  const { server, cache, state } = aclServer({ 'ana@example.invalid': user('admin', true) });
  server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: {} });
  assert.ok(cache.store.has(server.CODEX_PAGE_LOAD_ACL_CACHE_KEY_));
  server.codexInvalidatePageLoadAclCache_();
  assert.equal(cache.store.has(server.CODEX_PAGE_LOAD_ACL_CACHE_KEY_), false);

  server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: {} });
  assert.equal(state.reads, 2);
  server.CODEX_CACHE_BYPASS_READS_ = true;
  const meta = {};
  server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: meta });
  assert.equal(meta.cacheMiss, true);
  assert.equal(state.reads, 3);
});

test('cache corrompido ou com formato inesperado é descartado', () => {
  const { server, cache, state } = aclServer({ 'ana@example.invalid': user('admin', true) });
  const key = server.CODEX_PAGE_LOAD_ACL_CACHE_KEY_;
  for (const raw of ['{', '[]', '{}', JSON.stringify({ 'ANA@example.invalid': user('admin', true) }),
    JSON.stringify({ 'ana@example.invalid': { role: 'admin', active: 'Sim' } })]) {
    cache.store.set(key, raw);
    const meta = {};
    assert.equal(server.codexAuthorizeWebAppRequest_(undefined, undefined, { useAclCache: true, cacheMeta: meta }).ok, true);
    assert.equal(meta.cacheMiss, true, raw);
  }
  assert.equal(state.reads, 5);
});

test('todas as funções que gravam Users invalidam o cache da abertura', () => {
  const source = require('./helpers/load-app-script').readProjectFile('WebApp.gs');
  for (const name of ['salvarMeuPerfil', 'salvarPerfisUsuariosAdmin', 'salvarUsuarioAdmin', 'inativarUsuarioAdmin']) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const next = source.indexOf('\nfunction ', start + 1);
    assert.match(source.slice(start, next), /codexInvalidatePageLoadAclCache_\(\)/, name);
  }
});

test('doGet registra etapas fixas, includes e cache da ACL sem dados pessoais', () => {
  const { server, logs } = aclServer({ 'ana@example.invalid': user('admin', true) });
  server.agendaWindowedLoadingV2EnabledForAccess_ = () => true;
  server.HtmlService = {
    createTemplateFromFile: () => ({
      evaluate() {
        server.include('IndexStyles');
        server.include('IndexCoreScripts');
        return { addMetaTag() { return this; }, setTitle() { return this; } };
      }
    }),
    createHtmlOutputFromFile: () => ({ getContent: () => '' })
  };
  server.doGet({ parameter: {} });
  server.doGet({ parameter: { page: 'transporte' } });
  const entries = logs.filter((line) => line.startsWith('[CODEX_PERF] ')).map((line) => JSON.parse(line.slice(13)));
  const stages = entries.filter((entry) => entry.operation === 'doGet').map((entry) => entry.stage);
  assert.deepEqual(stages, [
    'access', 'template', 'canary_flag', 'evaluate_index', 'includes_index', 'total',
    'access', 'template', 'evaluate_transporte', 'includes_transporte', 'total'
  ]);
  const includes = entries.find((entry) => entry.stage === 'includes_index');
  assert.equal(includes.rowCount, 2);
  const accessEntries = entries.filter((entry) => entry.stage === 'access');
  assert.equal(accessEntries[0].cacheMiss, true);
  assert.equal(accessEntries[1].cacheHit, true);
  const traceIds = new Set(entries.filter((entry) => entry.operation === 'doGet').map((entry) => entry.traceId));
  assert.equal(traceIds.size, 2, 'um trace por abertura');
  assert.doesNotMatch(logs.join('\n'), /ana@example/);
  // Fora do doGet, include não acumula estatísticas.
  assert.equal(server.CODEX_DOGET_INCLUDE_STATS_, null);
});

test('doGet com acesso negado continua mostrando a página de negação', () => {
  const { server, state } = aclServer({ 'ana@example.invalid': user('admin', false) });
  let denied = null;
  server.codexAccessDeniedOutput_ = (access) => { denied = access; return 'negado'; };
  server.HtmlService = { createTemplateFromFile: () => { throw new Error('não deveria montar template'); } };
  assert.equal(server.doGet({ parameter: {} }), 'negado');
  assert.match(denied.message, /inativo/);
  assert.equal(state.reads, 1);
});
