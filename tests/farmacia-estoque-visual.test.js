'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

// Carrega só as funções de apresentação, sem o restante do script da página.
function funcoes(arquivo, nomes) {
  const fonte = readProjectFile(arquivo);
  return nomes.map((nome) => {
    const inicio = fonte.indexOf('function ' + nome + '(');
    assert.ok(inicio >= 0, nome);
    const fim = /\r?\n\}\r?\n/.exec(fonte.slice(inicio));
    assert.ok(fim, nome);
    return fonte.slice(inicio, inicio + fim.index + fim[0].length);
  }).join('\n');
}

function cliente() {
  const ctx = vm.createContext({ esc: (v) => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';') });
  vm.runInContext(funcoes('IndexFarmaciaScripts.html', ['farmaciaStockNumber', 'farmaciaStockQuantity']), ctx);
  vm.runInContext(funcoes('IndexFarmaciaViewScripts.html', ['farmaciaStorageNote', 'farmaciaStockQuantityCell']), ctx);
  return ctx;
}

test('estoque: unidade concorda com a quantidade; abreviaturas não variam', () => {
  const c = cliente();
  assert.equal(c.farmaciaStockQuantity(1, 'caixa'), '1 caixa');
  assert.equal(c.farmaciaStockQuantity(2, 'caixa'), '2 caixas');
  assert.equal(c.farmaciaStockQuantity(0, 'frasco'), '0 frascos');
  assert.equal(c.farmaciaStockQuantity(1.5, 'ampola'), '1,5 ampola');
  assert.equal(c.farmaciaStockQuantity(3, 'cápsula'), '3 cápsulas');
  assert.equal(c.farmaciaStockQuantity(4, 'kit'), '4 kits');
  assert.equal(c.farmaciaStockQuantity(20, 'mL'), '20 mL');
  assert.equal(c.farmaciaStockQuantity(5, 'g'), '5 g');
  assert.equal(c.farmaciaStockQuantity(5, ''), '5');
});

test('estoque: zero apagado; conservação compatível sem nota; incompatível e indisponível em destaque', () => {
  const c = cliente();
  assert.match(c.farmaciaStockQuantityCell(0, 'caixa'), /farmacia-quantity farmacia-quantity-zero">0 caixas</);
  assert.doesNotMatch(c.farmaciaStockQuantityCell(8, 'caixa'), /quantity-zero/);
  assert.equal(c.farmaciaStorageNote({ status: 'compatible', message: 'Faixas cadastradas compatíveis.' }), '');
  assert.match(c.farmaciaStorageNote({ status: 'incompatible', message: 'Faixa incompatível.' }), /class="farmacia-storage-alert">Faixa incompatível\./);
  assert.match(c.farmaciaStorageNote({ status: 'unavailable', message: 'Em manutenção.' }), /farmacia-storage-alert/);
  assert.equal(c.farmaciaStorageNote({ status: 'pending', message: 'Conferir.' }), '<small>Conferir.</small>');
  assert.equal(c.farmaciaStorageNote(null), '<small>Conservação pendente de conferência.</small>');
  assert.match(c.farmaciaStorageNote({ status: 'incompatible', message: '<b>x</b>' }), /&#60;b&#62;/);
});

test('ciclo do lote: aguardando avaliação é um card do grid, com o filtro pending, sem o link solto', () => {
  const fonte = readProjectFile('IndexFarmaciaCiclo.html');
  assert.match(fonte, /\['pending','hourglass_top','Aguardando avaliação',lots\(function\(p\)\{return p\.pending>0;\}\),'lotes \/ kits','amber'\]/);
  assert.match(fonte, /\.farmacia-life-grid\{display:grid;grid-template-columns:repeat\(7,/);
  assert.doesNotMatch(fonte, /Aguardando avaliação: '\+/);
  assert.match(fonte, /filter==='pending'&&p\.pending>0/);
});

test('estoque: validade com "Vence em breve" até 30 dias; vencido continua vindo do servidor', () => {
  const ctx = vm.createContext({});
  vm.runInContext('var FARMACIA_VENCE_EM_BREVE_DIAS = 30;\n' + funcoes('IndexFarmaciaViewScripts.html', ['farmaciaExpiryChip']), ctx);
  const chip = (expiry, expired) => ctx.farmaciaExpiryChip({ expiry, expired: !!expired }, '2026-11-25');
  assert.match(chip('2026-09-30', true), /chip-red[^>]*>Vencido</);
  assert.match(chip('2026-11-30'), /chip-orange[^>]*>Vence em 5 dias</);
  assert.match(chip('2026-11-25'), />Vence hoje</);
  assert.match(chip('2026-11-26'), />Vence amanhã</);
  assert.match(chip('2026-12-25'), />Vence em 30 dias</);
  assert.equal(chip('2026-12-26'), '');
  assert.equal(chip('2027-03-31'), '');
  assert.equal(chip(''), '');
  assert.equal(chip('2026-11-24'), '', 'data passada sem vencido do servidor não inventa aviso');
});

test('estoque: "Ver ciclo" fica na mesma linha dos ícones de ação', () => {
  const ctx = vm.createContext({ esc: (v) => String(v === undefined || v === null ? '' : v), FARMACIA_STOCK: { studyId: 'P1' } });
  vm.runInContext(funcoes('IndexFarmaciaActions.html', ['farmaciaRecordActions']), ctx);
  const html = ctx.farmaciaRecordActions('position', { id: 'POS-1', lot: 'L1' }, { farmaciaAccess: 'manage' }, '<button class="farmacia-cycle-link">Ver ciclo</button>');
  assert.match(html, /^<div class="action-btns"><button class="farmacia-cycle-link">Ver ciclo<\/button><button type="button" class="icon-btn"/);
  assert.match(ctx.farmaciaRecordActions('position', { id: 'POS-1', lot: 'L1' }, { farmaciaAccess: 'view' }), /^<div class="action-btns"><button type="button" class="icon-btn"/);
  const view = readProjectFile('IndexFarmaciaViewScripts.html');
  assert.match(view, /farmaciaRecordActions\('position',position,data,typeof farmaciaCycleOpen === 'function' \? '<button type="button" class="btn-txt farmacia-cycle-link"/);
});

test('estoque: a tabela usa o aviso de validade', () => {
  assert.match(readProjectFile('IndexFarmaciaViewScripts.html'), /esc\(farmaciaStockDate\(position\.expiry\)\) \+ farmaciaExpiryChip\(position\)/);
});
