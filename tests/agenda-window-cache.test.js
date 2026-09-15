'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');

function serverWithWindowCache() {
  const entries = new Map();
  const properties = new Map();
  const cache = {
    get: (key) => entries.get(key) || null,
    getAll: (keys) => Object.fromEntries(keys.filter((key) => entries.has(key)).map((key) => [key, entries.get(key)])),
    put: (key, value) => {
      assert.ok(key.length <= 250);
      assert.ok(Buffer.byteLength(value, 'utf8') < 100000);
      entries.set(key, value);
    },
    putAll: (values) => Object.keys(values).forEach((key) => cache.put(key, values[key])),
    remove: (key) => entries.delete(key)
  };
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const cadastro = runFile('CadastroRules.gs').CadastroRules_;
  const env = {
    AgendaServerRules_: rules,
    CadastroRules_: cadastro,
    Utilities: { getUuid: randomUUID, newBlob: (text) => ({ getBytes: () => Buffer.from(text, 'utf8') }) },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
        deleteProperty: (key) => properties.delete(key)
      })
    }
  };
  const fresh = () => runFile('WebApp.gs', env);
  return { server: fresh(), entries, properties, cache, env, fresh };
}

function chunkKey(server, entries, key, index) {
  const manifest = JSON.parse(entries.get(server.agendaWindowCacheManifestKey_(key)));
  return server.agendaWindowCacheChunkKey_(key, manifest.writeId, index);
}

function makeKey(server) {
  return server.agendaWindowCacheKey_(25, '2026-09-14', '2026-09-21', 5000);
}

test('cache de janela preserva payload pequeno em um bloco', () => {
  const { server, entries } = serverWithWindowCache();
  const key = makeKey(server);
  const payload = { items: [{ id: 'EVT-1', observacao: 'curta' }], total: 1, truncated: false, outOfOrder: false };

  assert.equal(server.agendaWindowCachePut_(key, payload), true);
  const manifest = JSON.parse(entries.get(server.agendaWindowCacheManifestKey_(key)));
  assert.equal(manifest.schemaVersion, server.AGENDA_WINDOW_CACHE_SCHEMA_VERSION_);
  assert.equal(manifest.chunkCount, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(server.agendaWindowCacheGet_(key))), payload);
});

test('cache de janela divide payload acima de 100 KB em blocos abaixo do limite seguro', () => {
  const { server, entries } = serverWithWindowCache();
  const key = makeKey(server);
  const payload = { items: [{ id: 'EVT-GRANDE', observacao: 'x'.repeat(120000) }], total: 1, truncated: false, outOfOrder: false };

  server.agendaWindowCachePut_(key, payload);
  const manifest = JSON.parse(entries.get(server.agendaWindowCacheManifestKey_(key)));
  assert.ok(manifest.payloadBytes > 100000);
  assert.ok(manifest.chunkCount > 1);
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    assert.ok(Buffer.byteLength(entries.get(chunkKey(server, entries, key, index)), 'utf8') <= 90000);
  }
  assert.equal(server.agendaWindowCacheGet_(key).items[0].observacao.length, 120000);
});

test('cache de janela recompõe payload em múltiplos blocos', () => {
  const { server, entries } = serverWithWindowCache();
  const key = makeKey(server);
  const payload = { items: Array.from({ length: 4 }, (_, index) => ({ id: `EVT-${index}`, observacao: String(index).repeat(70000) })), total: 4, truncated: false, outOfOrder: false };

  server.agendaWindowCachePut_(key, payload);
  const manifest = JSON.parse(entries.get(server.agendaWindowCacheManifestKey_(key)));
  assert.ok(manifest.chunkCount >= 3);
  assert.deepEqual(JSON.parse(JSON.stringify(server.agendaWindowCacheGet_(key))), payload);
});

test('bloco ausente torna o cache inválido e permite fallback transparente', () => {
  const { server, entries } = serverWithWindowCache();
  const key = makeKey(server);
  server.agendaWindowCachePut_(key, { items: [{ observacao: 'x'.repeat(120000) }], total: 1, truncated: false, outOfOrder: false });
  entries.delete(chunkKey(server, entries, key, 1));

  assert.equal(server.agendaWindowCacheGet_(key), null);
});

test('invalidação existente troca a geração das janelas em cache', () => {
  const { server, fresh } = serverWithWindowCache();
  const before = makeKey(server);
  server.agendaWindowCachePut_(before, { items: [{ id: 'EVT-1' }], total: 1, truncated: false, outOfOrder: false });

  fresh().agendaInvalidateDateIndexCache_();
  const after = makeKey(fresh());
  assert.notEqual(after, before);
  assert.equal(server.agendaWindowCacheGet_(after), null);
  assert.equal(server.agendaWindowCacheGet_(before), null);
  assert.equal(server.agendaWindowCachePut_(before, { old: true }), false);
});

test('bloco ausente faz fallback de eventos e forceRefresh ignora a janela cacheada', () => {
  const { server, entries } = serverWithWindowCache();
  const cfg = server.AGENDA_CFG;
  const row = Array(cfg.lastCol).fill('');
  row[cfg.idx.id] = 'EVT-1';
  row[cfg.idx.data] = '2026-09-15';
  row[cfg.idx.tipo] = 'Visita';
  row[cfg.idx.status] = 'Agendado';
  row[cfg.idx.participante] = 'Pessoa';
  row[cfg.idx.idParticipante] = 'P-1';
  const sheet = {
    getLastRow: () => 2,
    getRange: (startRow, startColumn, rows, columns) => ({
      getValues: () => [row.slice(startColumn - 1, startColumn - 1 + columns)]
    })
  };
  server.getAgendaSheetForRead_ = () => sheet;
  server.agendaHydrateParticipantFields_ = () => {};

  const first = server.agendaGetEventosPorPeriodo_('2026-09-14', '2026-09-21', 5000, false);
  const key = server.agendaWindowCacheKey_(2, '2026-09-14', '2026-09-21', 5000);
  entries.delete(chunkKey(server, entries, key, 0));
  row[cfg.idx.status] = 'Em andamento';
  const fallback = server.agendaGetEventosPorPeriodo_('2026-09-14', '2026-09-21', 5000, false);
  row[cfg.idx.status] = 'Realizado';
  const refreshed = server.agendaGetEventosPorPeriodo_('2026-09-14', '2026-09-21', 5000, true);

  assert.equal(first.items[0].status, 'Agendado');
  assert.equal(fallback.items[0].status, 'Em andamento');
  assert.equal(refreshed.items[0].status, 'Realizado');
});

test('falhas de leitura e escrita em PropertiesService não impedem invalidação entre execuções', () => {
  const f = serverWithWindowCache();
  const before = makeKey(f.server);
  f.server.agendaWindowCachePut_(before, { status: 'antigo' });
  f.env.PropertiesService = { getScriptProperties: () => ({
    getProperty: () => { throw new Error('read unavailable'); },
    setProperty: () => { throw new Error('write unavailable'); },
    deleteProperty: () => { throw new Error('delete unavailable'); }
  }) };
  f.fresh().agendaInvalidateDateIndexCache_();
  const reader = f.fresh();
  const after = makeKey(reader);
  assert.notEqual(before, after);
  assert.equal(reader.agendaWindowCacheGet_(before), null);
  assert.equal(reader.agendaWindowCacheGet_(after), null);
  assert.equal(reader.agendaWindowCachePut_(after, { status: 'novo' }), true);
  assert.equal(f.fresh().agendaWindowCacheGet_(after).status, 'novo');
});

test('marcador ausente ou CacheService indisponível nunca reutiliza geração antiga', () => {
  const f = serverWithWindowCache();
  const key = makeKey(f.server);
  f.server.agendaWindowCachePut_(key, { old: true });
  const originalGet = f.cache.get;
  f.cache.get = () => { throw new Error('cache unavailable'); };
  assert.equal(makeKey(f.fresh()), null);
  assert.equal(f.server.agendaWindowCacheGet_(key), null);
  assert.equal(f.server.agendaWindowCachePut_(null, { old: true }), false);
  f.cache.get = originalGet;
  f.entries.delete(f.server.AGENDA_WINDOW_CACHE_GENERATION_KEY_);
  assert.equal(f.server.agendaWindowCacheGet_(key), null);
  const newKey = makeKey(f.fresh());
  assert.notEqual(newKey, key);
  assert.equal(f.server.agendaWindowCacheGet_(key), null);
});

test('falha isolada na remoção invalida por substituição do marcador', () => {
  const f = serverWithWindowCache();
  const key = makeKey(f.server);
  f.server.agendaWindowCachePut_(key, { old: true });
  f.cache.remove = () => { throw new Error('remove unavailable'); };
  f.fresh().agendaInvalidateDateIndexCache_();
  assert.notEqual(makeKey(f.fresh()), key);
  assert.equal(f.fresh().agendaWindowCacheGet_(key), null);
});

test('gravações concorrentes e leitura durante publicação usam conjuntos independentes', () => {
  const f = serverWithWindowCache();
  const key = makeKey(f.server);
  const previous = { text: 'p'.repeat(110000) };
  const first = { text: 'a'.repeat(220000) };
  const second = { text: 'b'.repeat(140000) };
  f.server.agendaWindowCachePut_(key, previous);
  const originalPutAll = f.cache.putAll;
  let interleave = true;
  f.cache.putAll = (values) => {
    originalPutAll(values);
    if (interleave) {
      interleave = false;
      assert.equal(f.fresh().agendaWindowCacheGet_(key).text, previous.text);
      assert.equal(f.fresh().agendaWindowCachePut_(key, second), true);
      assert.equal(f.fresh().agendaWindowCacheGet_(key).text, second.text);
    }
  };
  assert.equal(f.server.agendaWindowCachePut_(key, first), true);
  assert.equal(f.fresh().agendaWindowCacheGet_(key).text, first.text);
});

test('invalidação durante gravação impede publicar resposta da geração antiga', () => {
  const f = serverWithWindowCache();
  const key = makeKey(f.server);
  const originalPutAll = f.cache.putAll;
  f.cache.putAll = (values) => {
    originalPutAll(values);
    f.fresh().agendaInvalidateDateIndexCache_();
  };
  assert.equal(f.server.agendaWindowCachePut_(key, { text: 'x'.repeat(120000) }), false);
  assert.equal(f.fresh().agendaWindowCacheGet_(key), null);
  assert.equal(f.entries.has(f.server.agendaWindowCacheManifestKey_(key)), false);
});

test('falha parcial de gravação preserva o conjunto previamente publicado', () => {
  const f = serverWithWindowCache();
  const key = makeKey(f.server);
  f.server.agendaWindowCachePut_(key, { text: 'anterior' });
  f.cache.putAll = (values) => {
    const firstKey = Object.keys(values)[0];
    f.cache.put(firstKey, values[firstKey]);
    throw new Error('partial failure');
  };
  assert.equal(f.server.agendaWindowCachePut_(key, { text: 'x'.repeat(200000) }), false);
  assert.equal(f.fresh().agendaWindowCacheGet_(key).text, 'anterior');
});

test('Unicode mantém medida UTF-8 exata e pares de surrogate íntegros no limite dos blocos', () => {
  const f = serverWithWindowCache();
  const key = makeKey(f.server);
  f.env.Utilities.newBlob = () => { throw new Error('blob unavailable'); };
  const payload = { text: 'a'.repeat(89990) + '😀é漢'.repeat(30000) };
  assert.equal(f.server.agendaWindowCachePut_(key, payload), true);
  const manifest = JSON.parse(f.entries.get(f.server.agendaWindowCacheManifestKey_(key)));
  assert.equal(manifest.payloadBytes, Buffer.byteLength(JSON.stringify(payload), 'utf8'));
  for (let i = 0; i < manifest.chunkCount; i += 1) {
    const chunk = f.entries.get(chunkKey(f.server, f.entries, key, i));
    assert.ok(Buffer.byteLength(chunk, 'utf8') <= 90000);
    assert.equal(Buffer.from(chunk, 'utf8').toString('utf8'), chunk);
  }
  assert.equal(f.fresh().agendaWindowCacheGet_(key).text, payload.text);
});

test('corrupção com mesmo tamanho e manifesto inválido provocam cache miss', () => {
  const f = serverWithWindowCache();
  const key = makeKey(f.server);
  f.server.agendaWindowCachePut_(key, { text: 'abc' });
  const chunk = chunkKey(f.server, f.entries, key, 0);
  f.entries.set(chunk, f.entries.get(chunk).replace('abc', 'xyz'));
  assert.equal(f.server.agendaWindowCacheGet_(key), null);
  for (const invalid of [{ schemaVersion: 3 }, { chunkCount: 1.5 }, { writeId: '' }]) {
    f.server.agendaWindowCachePut_(key, { text: 'abc' });
    const manifestKey = f.server.agendaWindowCacheManifestKey_(key);
    const manifest = JSON.parse(f.entries.get(manifestKey));
    f.entries.set(manifestKey, JSON.stringify({ ...manifest, ...invalid }));
    assert.equal(f.server.agendaWindowCacheGet_(key), null);
  }
});
