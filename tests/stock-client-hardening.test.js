'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const source = readProjectFile('IndexEstoqueScripts.html');

function load(values, names) {
  const c = vm.createContext(values);
  for (const name of names) {
    const match = source.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}'));
    assert.ok(match, name);
    vm.runInContext(match[0], c);
  }
  return c;
}

test('ações do Estoque tratam aspas, barras e HTML como dados, sem handlers interpolados', () => {
  const listeners = {}, calls = [];
  const noop = () => {};
  const c = load({
    _estoqueActionsBound: false, document: { addEventListener: (type, callback) => { listeners[type] = callback; } },
    esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    abrirFormItemInline: noop, excluirItemInline: (...args) => calls.push(args), abrirFormPedidoInline: noop,
    excluirPedidoInline: noop, abrirPedidoPorNumero: noop, imprimirRelatorioDescarte: noop, efetivarDescarteInline: noop,
    atualizarDescarteQtd: (...args) => calls.push(args)
  }, ['estoqueActionAttrs', 'estoqueBindActions']);
  const values = ['ID"<&', 'Kit "Especial" \\ </button><script>throw 1</script>'];
  const html = c.estoqueActionAttrs('item-excluir', values);
  assert.doesNotMatch(html, /onclick|<script>/);
  const args = html.match(/data-estoque-args="([^"]*)"/)[1];
  const control = { value: '2', getAttribute: name => name === 'data-estoque-action' ? 'item-excluir' : args };
  const event = { type: 'click', target: { closest: () => control }, stopPropagation() {} };
  listeners.click(event);
  assert.deepEqual(calls[0], values);
  control.getAttribute = name => name === 'data-estoque-action' ? 'descarte-qtd' : encodeURIComponent(JSON.stringify([values[0]]));
  listeners.click(event);
  assert.equal(calls.length, 1);
  listeners.input({ ...event, type: 'input' });
  assert.deepEqual(calls[1], [values[0], '2']);
  control.getAttribute = name => name === 'data-estoque-action' ? '__proto__' : args;
  listeners.click(event);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(source, /on(?:click|input)="(?:excluirItemInline|excluirPedidoInline|abrirPedidoPorNumero|imprimirRelatorioDescarte|efetivarDescarteInline|atualizarDescarteQtd)\(/);
});

test('pedido rejeita zero, vazio, negativos e não finitos sem truncar quantidades fracionárias', () => {
  const fields = { piTipo: { value: 'Material' }, piItem: { value: 'I1', selectedIndex: 0, options: [{ text: 'Item' }] }, piQtd: { value: '' } };
  const errors = [];
  const c = load({ document: { getElementById: id => fields[id] }, _pedidoInlineItens: [], snack() {}, snackErro: msg => errors.push(msg), renderPedidoInlineItensForm() {} },
    ['estoqueQuantidadeValida', 'adicionarItemPedidoInline']);
  for (const value of ['', '0', '-1', 'Infinity', 'NaN']) {
    fields.piQtd.value = value;
    c.adicionarItemPedidoInline();
  }
  assert.equal(c._pedidoInlineItens.length, 0);
  assert.equal(errors.length, 5);
  fields.piQtd.value = '1.5';
  c.adicionarItemPedidoInline();
  assert.equal(c._pedidoInlineItens[0].qtdSolicitada, 1.5);
  assert.equal(c.estoqueQuantidadeValida('1.5', 1, undefined, true), false);
  assert.equal(c.estoqueQuantidadeValida('4', 0, 3), false);
});

test('recebimento com valor não finito bloqueia toda a RPC', () => {
  const elements = {};
  const c = load({
    _recebimentoPedidoInline: { itens: [{ idItem: 'I1', pendente: 3 }], pedido: {} },
    document: { getElementById: id => elements[id] || (elements[id] = { value: id.startsWith('rpQtd') ? 'NaN' : '2026-10-01', classList: { add() {}, remove() {} } }) },
    appSetStatus() {}, snack() {}, snackErro() {}, google: { script: { run: { withSuccessHandler() { throw new Error('RPC indevida'); } } } }
  }, ['estoqueQuantidadeValida', 'salvarRecebimentoPedidoInline']);
  c.salvarRecebimentoPedidoInline();
});

test('validade usa calendário estrito e dia de São Paulo para ambos os formatos', () => {
  const c = load({ estoqueHojeIso: () => '2026-09-30' }, ['estoqueDataCivilTimestamp', 'diasAteValidade', 'evValCls']);
  assert.equal(c.diasAteValidade('30/09/2026'), 0);
  assert.equal(c.diasAteValidade('2026-10-01'), 1);
  assert.equal(c.diasAteValidade('29/09/2026'), -1);
  assert.match(c.evValCls('2026-09-29'), /b3261e/);
  for (const value of ['31/02/2026', '2026-04-31', '29/02/2026', '2026-13-01', '2026-00-01', '', '—']) {
    assert.equal(c.diasAteValidade(value), 999999);
    assert.equal(c.evValCls(value), '');
  }
  assert.ok(c.estoqueDataCivilTimestamp('29/02/2028'));
  assert.equal(c.estoqueDataCivilTimestamp('01/03/2028') - c.estoqueDataCivilTimestamp('29/02/2028'), 86400000);
});

function conferenceFixture(values) {
  const requests = [], messages = [];
  const inputs = values.map((value, i) => ({ value, getAttribute: () => 'R' + i }));
  const btn = { disabled: false };
  const c = load({
    _evPiloto: { reservas: values.map((_v, i) => ({ idReserva: 'R' + i, idItem: 'I', qtdeEsperada: 1 })) },
    document: { querySelectorAll: () => inputs, getElementById: () => btn },
    evPilotoMostrarStatus: (msg, tone) => messages.push({ msg, tone }), appErrorMessage: e => e.message,
    carregarEstoqueView: () => { c.refreshed = true; },
    google: { script: { run: { withSuccessHandler(ok) { return { withFailureHandler(fail) { return {
      registrarConferenciaLaboratorio: payload => requests.push({ ok, fail, payload })
    }; } }; } } } }
  }, ['estoqueQuantidadeValida', 'evPilotoSalvarConferencias']);
  return { c, inputs, requests, messages, btn };
}

test('conferência valida todas as linhas antes da primeira escrita', () => {
  const f = conferenceFixture(['1', '-1']);
  f.c.evPilotoSalvarConferencias();
  assert.equal(f.requests.length, 0);
  assert.match(f.messages.at(-1).msg, /Nenhuma conferência/);
});

test('conferência informa progresso parcial e nova tentativa não reenvia linhas confirmadas', () => {
  const f = conferenceFixture(['1', '2', '0']);
  f.c.evPilotoSalvarConferencias();
  f.c.evPilotoSalvarConferencias();
  assert.equal(f.requests.length, 1);
  f.requests[0].ok();
  f.requests[1].fail(new Error('offline'));
  assert.match(f.messages.at(-1).msg, /1 de 3.*R1.*offline/);
  assert.equal(f.inputs[0].value, '');
  assert.equal(f.btn.disabled, false);
  f.c.evPilotoSalvarConferencias();
  assert.equal(f.requests[2].payload.idReserva, 'R1');
  f.requests[2].ok();
  f.requests[3].ok();
  assert.equal(f.requests[3].payload.qtdeConferida, 0);
  assert.match(f.messages.at(-1).msg, /2 de 2/);
  assert.equal(f.c.refreshed, true);
});

test('conferência captura os valores antes de enviar e preserva edição posterior', () => {
  const f = conferenceFixture(['1', '2']);
  f.c.evPilotoSalvarConferencias();
  f.inputs[0].value = '3';
  f.inputs[1].value = '4';
  f.requests[0].ok();
  assert.equal(f.inputs[0].value, '3');
  assert.equal(f.requests[1].payload.qtdeConferida, 2);
  f.requests[1].ok();
  assert.equal(f.c.refreshed, undefined);
  assert.match(f.messages.at(-1).msg, /novos valores preenchidos/);
});
