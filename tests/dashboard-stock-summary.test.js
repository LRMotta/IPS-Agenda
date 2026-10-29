'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture() {
  const fixed = new Date(2026, 9, 10, 12).getTime();
  const server = runFile('WebApp.gs', { Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }, Logger: { log() {} } });
  const calls = { access: 0, stock: 0, reservations: 0 };
  server.codexAssertCanRead_ = () => { calls.access++; };
  server.getKitReservasResumo_ = () => { calls.reservations++; return {}; };
  const date = offset => {
    const d = new Date(2026, 9, 10 + offset);
    return [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/');
  };
  const item = (id, validity, status, accession = '') => ({ idItem: id, projeto: 'Projeto', descricao: 'Kit', tipoItem: 'Kit',
    idLote: 'Lote', localizacao: 'Principal', accessionNumber: accession, validade: validity, status, qtde: 2 });
  const rows = [item('1', date(0), 'OK'), item('2', date(0), 'OK'), item('3', date(90), 'OK', 'ACC'),
    item('4', date(-1), 'OK'), item('5', date(91), 'OK'), item('6', 'inválida', 'Estoque baixo'),
    item('7', '', 'Vencido'), item('8', '', '')];
  server.getEstoqueLinhas_ = () => { calls.stock++; return rows; };
  server.getProjetosDadosInterno_ = server.getParticipantesDashboardResumo_ = () => [];
  server.getAgendaDashboardResumo_ = () => ({});
  return { server, calls, rows };
}

test('Dashboard preserva agrupamentos, categoria única por lote e limites de validade sem consultar reservas', () => {
  const f = fixture();
  const original = JSON.stringify(f.rows);
  const result = f.server.getDashboardData();
  assert.deepEqual(JSON.parse(JSON.stringify(result.estoqueResumo)), { lotes: 7, ok: 3, baixo: 1, vencidos: 2, outros: 1, proximosValidade: 2 });
  assert.equal(f.calls.stock, 1);
  assert.equal(f.calls.reservations, 0);
  assert.equal(JSON.stringify(f.rows), original);
  // A RPC operacional continua calculando saldos e mantendo autorização.
  const previousAccess = f.calls.access;
  const full = f.server.getEstoque();
  assert.equal(full.length, result.estoqueResumo.lotes);
  assert.equal(full[0].qtdeFisica, 4);
  assert.equal(full[0].qtdeDisponivel, 4);
  assert.equal(f.calls.reservations, 1);
  assert.equal(f.calls.access, previousAccess + 1);
});

test('Dashboard com Estoque vazio não consulta reservas e mantém zero nos indicadores', () => {
  const f = fixture();
  f.server.getEstoqueLinhas_ = () => [];
  const result = f.server.getDashboardData();
  assert.equal(Object.values(result.estoqueResumo).every(value => value === 0), true);
  assert.equal(f.calls.reservations, 0);
});

test('autorização do Dashboard precede a leitura resumida de Estoque', () => {
  const f = fixture();
  f.server.codexAssertCanRead_ = () => { throw new Error('Acesso negado'); };
  assert.throws(() => f.server.getDashboardData(), /Acesso negado/);
  assert.equal(f.calls.stock, 0);
  assert.equal(f.calls.reservations, 0);
});
