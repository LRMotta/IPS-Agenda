'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

function fixture(type = 'log', count = 350) {
  const rows = Array.from({ length: count }, (_, i) => {
    const id = 'AUD-' + i;
    const date = new Date(2026, 9, 1 + i % 10, 12);
    const email = i % 2 ? 'a@example.invalid' : 'b@example.invalid';
    const action = i % 3 ? 'Salvar' : 'Excluir';
    return type === 'log' ? [id, email, action, date, 'Agenda', 'REC-' + i]
      : [id, date, email, 'Agenda', action, 'REC-' + i, 'Campo', 'Antes', 'Depois', 'Nota'];
  });
  const sheet = new FakeSheet(type === 'log' ? 'Audit_Log' : 'Audit_Changes', [Array(type === 'log' ? 6 : 10).fill('Header'), ...rows]);
  sheet.getSheetId = () => 12;
  const reads = [];
  const range = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => { reads.push(args); return range(...args); };
  const entries = new Map();
  const properties = new Map([['CODEX_AUDIT_QUERY_SIGNING_KEY_V1', 'simulated-secret']]);
  const logs = [];
  let authorizations = 0;
  let email = 'admin@example.invalid';
  let allowed = true;
  let clock = Date.now();
  const NativeDate = Date;
  const server = runFiles(['WebApp.gs', 'AuditPagination.gs'], {
    Date: class extends NativeDate {
      static now() { return clock; }
      static [Symbol.hasInstance](value) { return value instanceof NativeDate; }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (algo, value) => crypto.createHash(algo).update(value).digest(),
      computeHmacSha256Signature: (value, key) => crypto.createHmac('sha256', key).update(value).digest(),
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'),
      base64DecodeWebSafe: value => Buffer.from(value, 'base64url'),
      newBlob: value => ({ getDataAsString: () => Buffer.from(value).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
      formatDate: value => value.toISOString()
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value)
    }) },
    Logger: { log: value => logs.push(value) }
  });
  server.codexAssertAdmin_ = () => {
    authorizations++;
    if (!allowed) throw new Error('Acesso negado');
    return { ok: true, role: 'admin', userEmail: email };
  };
  server.getCodexSpreadsheet_ = () => ({ getId: () => 'spreadsheet-test', getSheetByName: () => sheet });
  server.codexCacheGet_ = key => entries.has(key) ? JSON.parse(entries.get(key)) : null;
  server.codexCachePut_ = (key, value) => {
    const raw = JSON.stringify(value);
    assert.ok(Buffer.byteLength(raw) < 100 * 1024);
    entries.set(key, raw);
    return true;
  };
  const page = (filters = {}, offset = 0, token = '', limit = 100) => server.getAuditPage(type, limit, offset, filters,
    { paginationVersion: 2, snapshotId: token });
  return { server, sheet, reads, entries, properties, logs, page,
    get authorizations() { return authorizations; },
    set email(value) { email = value; }, set allowed(value) { allowed = value; },
    advance: ms => { clock += ms; } };
}

const plain = value => JSON.parse(JSON.stringify(value));

for (const type of ['log', 'changes']) {
  test(type + ': recorte filtrado preserva contratos e só lê corpo da próxima página', () => {
    const f = fixture(type);
    const filters = { action: 'salvar', user: 'a@', startDate: '2026-10-01', endDate: '2026-10-10' };
    const old = f.server[type === 'log' ? 'getAuditLogPage' : 'getAuditChangesPage'](100, 0, filters);
    f.reads.length = 0;
    const first = f.page(filters);
    assert.deepEqual(plain(first.rows), plain(old.rows));
    for (const key of ['total', 'userCount', 'moduleCount', 'hasMore']) assert.equal(first[key], old[key]);
    assert.equal(f.reads.filter(args => args[3] === 5).length, 1);
    f.reads.length = 0;
    const second = f.page(filters, 100, first.snapshotId);
    assert.equal(second.snapshotId, first.snapshotId);
    assert.equal(second.total, first.total);
    assert.equal(f.reads.length, 1);
    assert.equal(f.reads[0][3], type === 'log' ? 6 : 10);
    assert.equal(second.rows.length, first.total - 100);
    assert.equal(f.authorizations, 3);
    const cache = [...f.entries.values()].join('');
    assert.doesNotMatch(cache, /admin@example|a@example|Antes|Depois|REC-|AUD-/);
  });

  test(type + ': sem filtro continua com uma faixa e append não desloca páginas', () => {
    const f = fixture(type);
    const first = f.page();
    assert.equal(f.reads.length, 1);
    assert.equal(f.reads[0][2], 100);
    assert.equal(f.entries.size, 0);
    f.sheet.rows.push(f.sheet.rows[1].map(value => value === 'AUD-0' ? 'NOVO' : value));
    const next = f.page({}, 100, first.snapshotId);
    assert.equal(next.total, 350);
    assert.equal(next.rows[0].id, 'AUD-249');
    assert.equal(new Set(first.rows.concat(next.rows).map(row => row.id)).size, 200);
  });
}

test('cache perdido reconstrói o mesmo recorte e ignora inclusões novas', () => {
  const f = fixture();
  const filters = { action: 'salvar' };
  const first = f.page(filters);
  f.entries.clear();
  f.sheet.rows.push(['NOVO', 'a@example.invalid', 'Salvar', new Date(), 'Agenda', 'REC']);
  f.reads.length = 0;
  const next = f.page(filters, 100, first.snapshotId);
  assert.equal(next.total, first.total);
  assert.equal(next.snapshotId, first.snapshotId);
  assert.equal(f.reads[0][2], 350);
  assert.equal(new Set(first.rows.concat(next.rows).map(row => row.id)).size, 200);
});

test('partes são limitadas em bytes; orçamento ou indisponibilidade preserva leitura sem cache', () => {
  const f = fixture();
  f.server.CODEX_AUDIT_QUERY_PART_BYTES_ = 600;
  const first = f.page({ action: 'salvar' }, 0, '', 10);
  assert.ok([...f.entries.keys()].filter(key => key.includes(':part:')).length > 1);
  for (const [key, raw] of f.entries) if (key.includes(':part:')) assert.ok(Buffer.byteLength(raw) <= 600);
  f.server.CODEX_AUDIT_QUERY_BUDGET_BYTES_ = 1;
  f.entries.clear();
  const next = f.page({ action: 'salvar' }, 10, first.snapshotId, 10);
  assert.equal(next.total, first.total);
  assert.equal(f.entries.size, 0);
  f.server.CODEX_AUDIT_QUERY_BUDGET_BYTES_ = 512 * 1024;
  f.server.codexCachePut_ = () => false;
  assert.equal(f.page({ action: 'salvar' }, 20, first.snapshotId, 10).rows.length, 10);
});

test('expiração, alteração de IDs e reconstrução divergente pedem atualização sem páginas parciais', () => {
  for (const cachePresent of [true, false]) {
    const f = fixture();
    const first = f.page({ action: 'salvar' });
    if (!cachePresent) f.entries.clear();
    f.sheet.rows[350][0] = 'ID-ALTERADO';
    const result = f.page({ action: 'salvar' }, 0, first.snapshotId);
    assert.equal(result.refreshRequired, true);
    assert.equal(result.reason, 'source_changed');
    assert.equal(result.rows, undefined);
  }
  const f = fixture();
  const first = f.page({ action: 'salvar' });
  f.advance(301000);
  f.reads.length = 0;
  assert.equal(f.page({ action: 'salvar' }, 100, first.snapshotId).reason, 'expired');
  assert.equal(f.reads.length, 0);
});

test('ACL é revalidada antes de cache/dados, token não pode trocar conta, filtro ou limite', () => {
  const f = fixture();
  const first = f.page({ action: 'salvar' });
  f.reads.length = 0;
  f.allowed = false;
  assert.throws(() => f.page({ action: 'salvar' }, 100, first.snapshotId), /negado/);
  f.allowed = true;
  f.email = 'outro@example.invalid';
  assert.throws(() => f.page({ action: 'salvar' }, 100, first.snapshotId), /incompatível/);
  f.email = 'admin@example.invalid';
  assert.throws(() => f.page({ action: 'excluir' }, 100, first.snapshotId), /incompatível/);
  assert.throws(() => f.page({ action: 'salvar' }, 0, first.snapshotId, 200), /incompatível/);
  assert.throws(() => f.page({ action: 'salvar' }, 100, first.snapshotId.slice(0, -3) + 'XXX'), /inválida/);
  assert.equal(f.reads.length, 0);
  assert.doesNotMatch(f.logs.join(''), /example.invalid|AUD-|REC-|snapshotId|salvar/);
});

test('paginação valida offsets e fontes reduzidas, mantendo vazio e página final', () => {
  const f = fixture();
  assert.throws(() => f.page({}, 101), /inválida/);
  assert.throws(() => f.page({}, Infinity), /inválida/);
  const first = f.page({ user: 'sem resultado' });
  assert.equal(first.total, 0);
  f.reads.length = 0;
  assert.equal(f.page({ user: 'sem resultado' }, 0, first.snapshotId).rows.length, 0);
  assert.equal(f.reads.length, 0);
  f.sheet.rows.pop();
  assert.equal(f.page({ user: 'sem resultado' }, 0, first.snapshotId).reason, 'source_changed');
  const empty = fixture('log', 0);
  assert.equal(empty.page().total, 0);
});

test('limites 100/200/500 e bordas preservam todas as páginas e contagens de ambas as trilhas', () => {
  for (const type of ['log', 'changes']) {
    for (const count of [0, 1, 99, 100, 101, 200, 201, 499, 500, 501]) {
      for (const limit of [100, 200, 500]) {
        const f = fixture(type, count);
        const filters = { action: 'salvar' };
        let token = '';
        for (let offset = 0; offset < count + limit; offset += limit) {
          const expected = f.server[type === 'log' ? 'getAuditLogPage' : 'getAuditChangesPage'](limit, offset, filters);
          const result = f.page(filters, offset, token, limit);
          assert.deepEqual(plain(result.rows), plain(expected.rows));
          for (const key of ['total', 'hasMore']) assert.equal(result[key], expected[key]);
          if (count) {
            for (const key of ['userCount', 'moduleCount']) assert.equal(result[key], expected[key]);
          }
          token = result.snapshotId;
        }
      }
    }
  }
});

test('parte ausente com manifesto presente refaz o índice; ID deslocado não é aceito', () => {
  const f = fixture();
  const first = f.page({ action: 'salvar' });
  for (const key of f.entries.keys()) if (key.includes(':part:')) f.entries.delete(key);
  assert.equal(f.page({ action: 'salvar' }, 100, first.snapshotId).total, first.total);
  [f.sheet.rows[347], f.sheet.rows[350]] = [f.sheet.rows[350], f.sheet.rows[347]];
  assert.equal(f.page({ action: 'salvar' }, 0, first.snapshotId).reason, 'source_changed');
});

test('blocos de projeção preservam limites entre blocos e página grande não é armazenada', () => {
  const f = fixture('changes', 1000);
  f.server.CODEX_AUDIT_QUERY_SCAN_ROWS_ = 137;
  f.sheet.rows.slice(1).forEach(row => { row[7] = 'A'.repeat(500); row[8] = 'B'.repeat(500); });
  const first = f.page({ action: 'salvar' }, 0, '', 500);
  assert.equal(f.reads.filter(args => args[3] === 5).length, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) > 100 * 1024);
  assert.doesNotMatch([...f.entries.values()].join(''), /AAAA|BBBB/);
  f.reads.length = 0;
  const next = f.page({ action: 'salvar' }, 500, first.snapshotId, 500);
  assert.equal(f.reads.length, 1);
  assert.equal(next.rows.length, first.total - 500);
});

test('chave de assinatura é criada uma vez e atualização forçada cria recorte novo', () => {
  const f = fixture();
  f.properties.clear();
  f.server.codexWithDocumentLock_ = (label, fn) => fn();
  const first = f.page();
  const key = f.properties.get('CODEX_AUDIT_QUERY_SIGNING_KEY_V1');
  f.sheet.rows.push(['NOVO', 'a@example.invalid', 'Salvar', new Date(), 'Agenda', 'REC']);
  const refreshed = f.server.getAuditPage('log', 100, 0, {},
    { paginationVersion: 2, snapshotId: first.snapshotId, forceRefresh: true });
  assert.equal(refreshed.total, 351);
  assert.notEqual(refreshed.snapshotId, first.snapshotId);
  assert.equal(f.properties.get('CODEX_AUDIT_QUERY_SIGNING_KEY_V1'), key);
  assert.equal(f.properties.size, 1);
});
