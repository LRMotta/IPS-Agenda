'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

function fixture() {
  const entries = new Map();
  const properties = new Map();
  const calls = { puts: 0, removeAll: [], formatDate: 0, propertyReads: 0 };
  const logs = [];
  const cache = {
    get(key) { return entries.has(key) ? entries.get(key).value : null; },
    put(key, value, ttl) { calls.puts++; entries.set(key, { value, ttl }); },
    removeAll(keys) { calls.removeAll.push(Array.from(keys)); keys.forEach(key => entries.delete(key)); },
    remove(key) { entries.delete(key); }
  };
  const propertyStore = {
    setProperty(key, value) { properties.set(key, value); },
    deleteProperty(key) { properties.delete(key); },
    getProperty(key) { return properties.get(key) || null; },
    getProperties() { calls.propertyReads++; return Object.fromEntries(properties); }
  };
  const server = runFiles(['AgendaServerRules.gs', 'WebApp.gs', 'DeploymentDiagnostics.gs'], {
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => propertyStore },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
    Utilities: {
      formatDate() { calls.formatDate++; return '20261007'; },
      base64EncodeWebSafe(value) { return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); }
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Logger: { log(line) { logs.push(String(line)); } }
  });
  return { server, entries, properties, propertyStore, cache, calls, logs };
}

test('codexCachePut rejeita JSON acima do limite e registra falha sem conteúdo', () => {
  const f = fixture();
  const value = 'dado-clinico-simulado-' + 'x'.repeat(110 * 1024);
  assert.equal(f.server.codexCachePut_('chave-simulada', value), false);
  assert.equal(f.calls.puts, 0);
  assert.match(f.logs.join('\n'), /\[CODEX_CACHE\] put_too_large bytes=/);
  assert.doesNotMatch(f.logs.join('\n'), /dado-clinico-simulado|chave-simulada/);
});

test('metadados persistentes ficam restritos aos itens exibidos no diagnóstico', () => {
  const f = fixture();
  assert.equal(f.server.codexCachePut_('AgendaDateIndex:v2', { rowCount: 2 }), true);
  assert.equal(f.server.codexCachePut_('ConfigAppRows:v2', [{ chave: 'simulado' }]), true);
  assert.equal(f.calls.puts, 2);
  assert.equal(f.properties.size, 1);
  assert.ok(Array.from(f.properties.keys())[0].startsWith('CODEX_CACHE_META_'));
});

test('clearCodexRuntimeCaches calcula o dia uma vez e remove suas 14 chaves em lote', () => {
  const f = fixture();
  f.server.agendaInvalidateReferenceDataCache_ = () => {};
  f.server.agendaInvalidateParticipantHydrationCache_ = () => {};
  f.server.agendaInvalidateDateIndexCache_ = () => {};
  f.server.clearCodexRuntimeCaches_([]);
  assert.equal(f.calls.formatDate, 1);
  assert.equal(f.calls.removeAll.length, 1);
  assert.equal(f.calls.removeAll[0].length, 14);
  assert.ok(f.calls.removeAll[0].includes('AgendaFormData:v6:20261007'));
});

test('invalidacao remove metadados legados e expirados preservando propriedades e outros caches atuais', () => {
  const f = fixture();
  const rawMetaKey = key => 'CODEX_CACHE_META_' + Buffer.from(key).toString('base64url');
  const seeds = [
    ['AgendaDateIndex:v2', Date.now() + 60000],
    ['AgendaFormDataStrict:v6:20260101', 1],
    ['AgendaFormData:v6:daily', 1],
    ['TRANSPORTE_OPTIONS_BASE_V6', Date.now() + 60000]
  ];
  seeds.forEach(([key, expiresAtMs]) => f.properties.set(rawMetaKey(key), JSON.stringify({ key, expiresAtMs })));
  f.properties.set('CONFIG_SIMULADA', 'preservar');
  f.properties.set('CODEX_CACHE_META_corrompido', '{');
  f.server.codexCachePut_('AgendaDateIndex:v2', { rows: [] });
  f.server.codexCacheRemove_('AgendaDateIndex:v2');
  assert.equal(f.entries.has('AgendaDateIndex:v2'), false);
  assert.equal(f.calls.propertyReads, 1);
  assert.deepEqual(Array.from(f.properties.keys()).sort(), [rawMetaKey('TRANSPORTE_OPTIONS_BASE_V6'), 'CONFIG_SIMULADA'].sort());
});

test('diagnostico reconhece cada cache atual da Agenda e conserva o resultado de Transporte', () => {
  for (const key of ['AgendaFormData:v12:20261007', 'AgendaFormDataStrict:v6:20261007', 'AgendaBootstrapReferenceData:v3:20261007']) {
    const f = fixture();
    assert.equal(f.server.codexCachePut_(key, { simulado: true }), true);
    f.cache.put('TRANSPORTE_OPTIONS_BASE_V6', JSON.stringify({ simulado: true }), 300);
    const diagnostic = f.server.codexGetCacheDiagnostics_();
    assert.equal(diagnostic.error, '');
    assert.equal(diagnostic.agendaBootstrapCachePresent, true, key);
    assert.equal(diagnostic.transporteOptionsCachePresent, true, key);
    const item = diagnostic.items.find(item => item.key === key);
    assert.equal(item.present, true);
    assert.notEqual(item.createdAt, '');
  }
});

test('limpeza historica e limitada por lote sem impedir a remocao de uma chave afetada', () => {
  const f = fixture();
  for (let i = 0; i < 15; i++) {
    f.properties.set('CODEX_CACHE_META_legado' + i, JSON.stringify({ key: 'legado' + i, expiresAtMs: 1 }));
  }
  const affected = 'CODEX_CACHE_META_afetado';
  f.properties.set(affected, JSON.stringify({ key: 'AgendaDateIndex:v2', expiresAtMs: Date.now() + 60000 }));
  f.server.codexCacheRemove_('AgendaDateIndex:v2');
  assert.equal(f.properties.has(affected), false);
  assert.equal(f.properties.size, 5);
  f.server.codexCacheRemove_('AgendaDateIndex:v2');
  assert.equal(f.properties.size, 0);
});

test('familias atuais usam um metadado estavel sem exibir datas de outro dia', () => {
  for (const prefix of ['AgendaFormData:v12:', 'AgendaFormDataStrict:v6:', 'AgendaBootstrapReferenceData:v3:']) {
    const f = fixture();
    const first = prefix + '20261007';
    const second = prefix + '20261008';
    f.server.codexCachePut_(first, { simulado: true });
    f.server.codexCachePut_(second, { simulado: true });
    assert.equal(f.properties.size, 1);
    assert.equal(f.server.codexCacheItemDiagnostics_(first, 'simulado').createdAt, '');
    assert.notEqual(f.server.codexCacheItemDiagnostics_(second, 'simulado').createdAt, '');
    f.server.codexCacheRemove_(second);
    assert.equal(f.properties.size, 0);
  }
});

test('falha de metadados preserva put bem sucedido e falha do lote permite remocao individual', () => {
  const f = fixture();
  f.propertyStore.setProperty = () => { throw new Error('falha simulada'); };
  assert.equal(f.server.codexCachePut_('ConfigAppRows:v2', { simulado: true }), true);
  assert.equal(f.entries.has('ConfigAppRows:v2'), true);
  f.cache.removeAll = () => { throw new Error('falha simulada'); };
  f.server.codexCacheRemove_('ConfigAppRows:v2');
  assert.equal(f.entries.has('ConfigAppRows:v2'), false);
  assert.match(f.logs.join('\n'), /metadata_put/);
  assert.match(f.logs.join('\n'), /remove_all/);
});

test('limite do cache mede UTF-8 incluindo caracteres multibyte', () => {
  const f = fixture();
  const value = 'á😀'.repeat(18000);
  assert.equal(value.length < 100 * 1024, true);
  assert.equal(f.server.codexUtf8ByteLength_(JSON.stringify(value)), Buffer.byteLength(JSON.stringify(value), 'utf8'));
  assert.equal(f.server.codexCachePut_('simulado', value), false);
  assert.equal(f.calls.puts, 0);
});
