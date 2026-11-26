'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

// Carrega só a função da lista, com os auxiliares do ciclo simulados.
function funcao(arquivo, nome) {
  const fonte = readProjectFile(arquivo);
  const inicio = fonte.indexOf('function ' + nome + '(');
  assert.ok(inicio >= 0, nome);
  const fim = /\r?\n\}\r?\n/.exec(fonte.slice(inicio));
  return fonte.slice(inicio, inicio + fim.index + fim[0].length);
}

function cliente({ operate = true, outstanding = {} } = {}) {
  const positions = { 'POS-LOAN': { id: 'POS-LOAN', productId: 'MOCHILA' }, 'POS-MED': { id: 'POS-MED', productId: 'MED' } };
  const products = { MOCHILA: { name: 'Mochila térmica', unit: 'unidade', category: 'material', materialUse: 'loan' }, MED: { name: 'Medicamento', unit: 'caixa', category: 'medicine' } };
  const dispenses = [
    { id: 'D-NEW', data: { positionId: 'POS-LOAN', participantLabel: '076-004', visit: 'Week 4', occurredOn: '2026-11-25' } },
    { id: 'D-OLD', data: { positionId: 'POS-LOAN', participantLabel: '076-001', visit: 'Week 1', occurredOn: '2026-11-04' } },
    { id: 'D-BACK', data: { positionId: 'POS-LOAN', participantLabel: '076-002', visit: 'Week 2', occurredOn: '2026-11-10' } },
    { id: 'D-MED', data: { positionId: 'POS-MED', participantLabel: '076-003', visit: 'Week 3', occurredOn: '2026-11-12' } }
  ];
  const ctx = vm.createContext({
    esc: (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';'),
    farmaciaCycleRecords: () => dispenses,
    farmaciaCyclePosition: (id) => positions[id],
    farmaciaCycleProduct: (p) => p && products[p.productId],
    farmaciaCycleLoan: (p) => !!p && products[p.productId].materialUse === 'loan',
    farmaciaCycleOutstanding: (id) => (id in outstanding ? outstanding[id] : 1),
    farmaciaCycleCanOperate: () => operate,
    farmaciaCycleToday: () => '2026-11-26',
    farmaciaStockDate: (d) => d.split('-').reverse().join('/'),
    farmaciaStockNumber: (n) => String(n),
    farmaciaTable: (headers, rows, label) => '<table aria-label="' + label + '"><tr>' + headers.map((h) => '<th>' + h + '</th>').join('') + '</tr>' + rows + '</table>'
  });
  vm.runInContext(funcao('IndexFarmaciaCiclo.html', 'farmaciaCycleLoansHtml'), ctx);
  return ctx;
}

test('materiais emprestados em uso: só empréstimos não devolvidos, o mais antigo primeiro, com os dias', () => {
  const html = cliente({ outstanding: { 'D-BACK': 0 } }).farmaciaCycleLoansHtml();
  assert.match(html, /Materiais emprestados em uso/);
  assert.doesNotMatch(html, /076-002/, 'devolvido sai da lista');
  assert.doesNotMatch(html, /076-003/, 'medicamento não é empréstimo');
  assert.ok(html.indexOf('076-001') < html.indexOf('076-004'), 'mais antigo primeiro');
  assert.match(html, /04\/11\/2026<small>há 22 dias/);
  assert.match(html, /25\/11\/2026<small>há 1 dia/);
  assert.match(html, /data-reference="D-OLD" onclick="farmaciaCycleStart\('return',this.dataset.reference\)">Registrar devolução/);
});

test('materiais emprestados em uso: sem empréstimo em aberto não aparece; leitura não registra devolução', () => {
  assert.equal(cliente({ outstanding: { 'D-NEW': 0, 'D-OLD': 0, 'D-BACK': 0 } }).farmaciaCycleLoansHtml(), '');
  const html = cliente({ operate: false }).farmaciaCycleLoansHtml();
  assert.match(html, /076-001/);
  assert.doesNotMatch(html, /Registrar devolução/);
});
