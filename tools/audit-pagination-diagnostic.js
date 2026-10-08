'use strict';

// Diagnóstico offline: chama o leitor atual em VM e compara um protótipo.
// Não disponibiliza APIs Google, rede, autorização real ou operações de escrita.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { runFile, readProjectFile } = require('../tests/helpers/load-app-script');

const generatedAt = new Date().toISOString();
const results = [];
const scenarios = [
  { name: 'sem_filtro', filters: {} },
  { name: 'todos', filters: { action: 'salvar' } },
  { name: 'um_por_cento', filters: { action: 'raro' } },
  { name: 'dez_por_cento_datas', filters: { startDate: '2026-01-01', endDate: '2026-01-10' } },
  { name: 'nenhum', filters: { user: 'inexistente' } }
];
const digest = ids => crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex');

function fixture(type, size) {
  let count = size;
  const cols = type === 'log' ? 6 : 10;
  const indexes = type === 'log'
    ? { userCol: 1, actionCol: 2, dateCol: 3, moduleCol: 4 }
    : { userCol: 2, actionCol: 4, dateCol: 1, moduleCol: 3 };
  const stats = { reads: 0, cells: 0, evaluated: 0, lastRowCalls: 0 };
  const movedRows = new Map();
  const payload = 'X'.repeat(500);
  function row(index) {
    const id = 'AUD-20261007120000-00000000-0000-4000-8000-' + String(index).padStart(12, '0');
    const date = new Date(2026, 0, 1 + index % 100, 12);
    const user = 'simulado-' + index % 25 + '@example.invalid';
    const action = index % 100 === 0 ? 'salvar_raro' : 'salvar';
    const moduleName = index % 2 ? 'Agenda' : 'Sistema';
    return type === 'log' ? [id, user, action, date, moduleName, 'REC-' + index]
      : [id, date, user, moduleName, action, 'REC-' + index, 'Campo', payload, payload, 'Simulação'];
  }
  const sheet = {
    getLastRow() { stats.lastRowCalls++; return count + 1; },
    getRange(start, column, rows, columns) {
      assert.ok(start >= 2 && start + rows - 1 <= count + 1);
      return { getValues() {
        stats.reads++;
        stats.cells += rows * columns;
        return Array.from({ length: rows }, (_, i) => {
          const index = start + i - 2;
          return row(movedRows.get(index) ?? index).slice(column - 1, column - 1 + columns);
        });
      } };
    }
  };
  const server = runFile('WebApp.gs', { Date });
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: () => sheet });
  const matches = server.codexAuditRowMatchesFilters_;
  server.codexAuditRowMatchesFilters_ = (...args) => { stats.evaluated++; return matches(...args); };
  const mapper = r => type === 'log' ? {
    id: r[0], email: r[1], action: r[2], timestamp: r[3].toISOString(), module: r[4], recordId: r[5]
  } : {
    id: r[0], timestamp: r[1].toISOString(), email: r[2], module: r[3], action: r[4], recordId: r[5],
    field: r[6], oldValue: r[7], newValue: r[8], note: r[9]
  };
  return { server, sheet, stats, indexes, mapper, cols, append: n => { count += n; },
    swapRecords: (a, b) => { movedRows.set(a, b); movedRows.set(b, a); } };
}

// Apenas hipótese executável para comparar leituras e equivalência.
// Persistência, ACL, TTL, manutenção e coordenação cliente não são implementados.
function buildPlan(f, filters, limit) {
  const highWaterRow = f.sheet.getLastRow();
  const prepared = f.server.codexPrepareAuditFilters_(filters);
  const rows = f.sheet.getRange(2, 1, highWaterRow - 1, 5).getValues();
  const users = new Set();
  const modules = new Set();
  const pages = [];
  let ids = [];
  let firstRow = 0;
  let lastRow = 0;
  let total = 0;
  function finishPage() {
    if (!ids.length) return;
    pages.push({ firstRow, lastRow, count: ids.length, idDigest: digest(ids) });
    ids = [];
  }
  for (let index = rows.length - 1; index >= 0; index--) {
    const r = rows[index];
    if (!f.server.codexAuditRowMatchesFilters_(r, filters, f.indexes, prepared)) continue;
    if (!ids.length) firstRow = index + 2;
    lastRow = index + 2;
    ids.push(r[0]);
    total++;
    users.add(String(r[f.indexes.userCol] || ''));
    modules.add(String(r[f.indexes.moduleCol] || ''));
    if (ids.length === limit) finishPage();
  }
  finishPage();
  users.delete('');
  modules.delete('');
  return { highWaterRow, prepared, pages, total, userCount: users.size, moduleCount: modules.size };
}

function plannedPage(f, plan, filters, limit, offset) {
  const bookmark = plan.pages[offset / limit];
  let rows = [];
  if (bookmark) {
    rows = f.sheet.getRange(bookmark.lastRow, 1, bookmark.firstRow - bookmark.lastRow + 1, f.cols).getValues();
    rows.reverse();
    rows = rows.filter(r => f.server.codexAuditRowMatchesFilters_(r, filters, f.indexes, plan.prepared));
    assert.equal(rows.length, bookmark.count);
    assert.equal(digest(rows.map(r => r[0])), bookmark.idDigest, 'IDs divergem do recorte inicial');
  }
  return { rows: rows.map(f.mapper), total: plan.total, limit, offset,
    hasMore: offset + rows.length < plan.total, userCount: plan.userCount, moduleCount: plan.moduleCount };
}

function runSeries(type, size, scenario, limit, planned) {
  const f = fixture(type, size);
  const output = [];
  const start = performance.now();
  const plan = planned && scenario.name !== 'sem_filtro' ? buildPlan(f, scenario.filters, limit) : null;
  for (let offset = 0; output.length < 3; offset += limit) {
    const page = plan ? plannedPage(f, plan, scenario.filters, limit, offset)
      : f.server.getAuditRowsPage_(type, f.cols, limit, offset, f.mapper, scenario.filters, f.indexes);
    output.push(page);
    if (!page.hasMore) break;
  }
  const durationMs = performance.now() - start;
  return { output, durationMs, ...f.stats,
    pageCount: output.length,
    maxResponseBytes: Math.max(...output.map(page => Buffer.byteLength(JSON.stringify(page)))),
    planBytes: plan ? Buffer.byteLength(JSON.stringify(plan.pages)) : 0 };
}

for (const type of ['log', 'changes']) {
  for (const size of [1000, 10000, 50000, 100000]) {
    for (const limit of [100, 500]) {
      for (const scenario of scenarios) {
        const samples = [];
        for (let repeat = 0; repeat < 3; repeat++) {
          const current = runSeries(type, size, scenario, limit, false);
          const planned = runSeries(type, size, scenario, limit, true);
          assert.deepEqual(JSON.parse(JSON.stringify(planned.output)), JSON.parse(JSON.stringify(current.output)),
            'Contratos distintos: ' + [type, size, limit, scenario.name].join('/'));
          samples.push({ current, planned });
        }
        function summarize(key) {
          const { output, durationMs, ...metrics } = samples[0][key];
          void durationMs;
          return { ...metrics, total: output[0].total,
            localMedianMs: samples.map(sample => sample[key].durationMs).sort((a, b) => a - b)[1] };
        }
        results.push({ type, size, limit, scenario: scenario.name, current: summarize('current'), planned: summarize('planned') });
      }
    }
  }
}

const concurrency = fixture('log', 250);
const first = concurrency.server.getAuditRowsPage_('log', 6, 100, 0, concurrency.mapper, {}, concurrency.indexes);
concurrency.append(2);
const second = concurrency.server.getAuditRowsPage_('log', 6, 100, 100, concurrency.mapper, {}, concurrency.indexes);
const firstIds = new Set(first.rows.map(r => r.id));
const repeated = second.rows.filter(r => firstIds.has(r.id)).length;
assert.equal(repeated, 2);
const anchored = fixture('changes', 250);
const plan = buildPlan(anchored, { action: 'salvar' }, 100);
const anchoredFirst = plannedPage(anchored, plan, { action: 'salvar' }, 100, 0);
anchored.append(2);
const anchoredSecond = plannedPage(anchored, plan, { action: 'salvar' }, 100, 100);
assert.equal(anchoredSecond.rows.filter(r => anchoredFirst.rows.some(old => old.id === r.id)).length, 0);
anchored.swapRecords(240, 241);
assert.throws(() => plannedPage(anchored, plan, { action: 'salvar' }, 100, 0), /IDs divergem/);

const report = {
  generatedAt, nodeVersion: process.version,
  sourceSha256: crypto.createHash('sha256').update(readProjectFile('WebApp.gs')).digest('hex'),
  methodology: 'Somente dados sintéticos; 3 execuções por combinação; 1 a 3 páginas novas; VM atual vs protótipo offline; tempos não incluem serviços Google, ACL, RPC, cache ou navegador; datas inclusivas geradas no fuso local do processo.',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  combinations: results.length,
  equivalenceChecks: results.length * 3,
  concurrentAppend: { appended: 2, repeatedCurrent: repeated, repeatedPlanned: 0 },
  reorderedIdsDetected: true,
  results
};
const outputPath = path.resolve(__dirname, '../docs/audit-pagination-diagnostic-2026-10-07.json');
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, combinations: report.combinations, equivalenceChecks: report.equivalenceChecks, concurrentAppend: report.concurrentAppend }));
