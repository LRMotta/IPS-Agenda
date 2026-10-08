'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const next = source.indexOf('\n  function ', start + 1);
  const coreNext = source.indexOf('\nfunction ', start + 1);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  return source.slice(start, indent === '' ? coreNext : next);
}
test('AWB fallback confirms only successful copying and always removes textarea', () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  for (const mode of ['true', 'false', 'throw']) {
    let success = 0, removed = 0; const errors = [];
    const context = vm.createContext({
      document: { createElement: () => ({ setAttribute() {}, style: {}, select() {} }), body: { appendChild() {}, removeChild() { removed++; } }, execCommand() { if (mode === 'throw') throw Error('denied'); return mode === 'true'; } },
      snackErro: x => errors.push(x)
    });
    vm.runInContext(extract(source, 'agendaCopyAwbFallback'), context);
    context.agendaCopyAwbFallback('AWB', () => success++);
    assert.equal(success, mode === 'true' ? 1 : 0);
    assert.equal(errors.length, mode === 'true' ? 0 : 1);
    assert.equal(removed, 1);
  }
});
test('CPF wrappers share validation and preserve optional field handling', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const agenda = readProjectFile('IndexAgendaScripts.html');
  const context = vm.createContext({});
  vm.runInContext(extract(core, 'cpfValido') + extract(core, 'participanteCpfValido_') + extract(agenda, 'agendaReciboCpfValido_'), context);
  for (const [value, expected] of [['529.982.247-25', true], ['52998224725', true], ['11111111111', false], ['52998224724', false], ['', false], [null, false], ['123', false]]) {
    assert.equal(context.participanteCpfValido_(value), expected);
    assert.equal(context.agendaReciboCpfValido_(value), expected);
  }
});
test('kit selection preserves lot, accession, labels and reservation quantity', () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  const controls = { a: { value: 'KIT', selectedIndex: 0, options: [{ text: 'Kit label', dataset: { idLote: 'LOT', accessionNumber: 'ACC' } }] }, b: { value: '' } };
  const context = vm.createContext({ agendaKitIds: () => ['a', 'b', 'missing'], document: { getElementById: id => controls[id] } });
  vm.runInContext(extract(source, 'agendaKitsSelecionados_') + extract(source, 'agendaKitsSelecionadosParaBaixa') + extract(source, 'agendaKitsSelecionadosParaReserva'), context);
  const expected = [{ idItem: 'KIT', idLote: 'LOT', accessionNumber: 'ACC', label: 'Kit label' }];
  assert.deepEqual(JSON.parse(JSON.stringify(context.agendaKitsSelecionadosParaBaixa())), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(context.agendaKitsSelecionadosParaReserva())), [{ ...expected[0], qtde: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.agendaKitsSelecionadosParaBaixa())), expected);
});

test('AWB uses Clipboard first and falls back on rejection or absence', async () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  for (const mode of ['resolve', 'reject', 'absent']) {
    let fallback = 0; const messages = []; const copied = [];
    const context = vm.createContext({
      navigator: mode === 'absent' ? {} : { clipboard: { writeText: value => { copied.push(value); return mode === 'resolve' ? Promise.resolve() : Promise.reject(Error('denied')); } } },
      snack: value => messages.push(value),
      agendaCopyAwbFallback: (value, done) => { assert.equal(value, "O'Brien"); fallback++; done(); }
    });
    vm.runInContext(extract(source, 'agendaCopyAwb'), context);
    let stopped = 0;
    context.agendaCopyAwb(encodeURIComponent("O'Brien"), { stopPropagation() { stopped++; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, 1);
    assert.equal(fallback, mode === 'resolve' ? 0 : 1);
    assert.deepEqual(messages, ['AWB copiada.']);
    assert.deepEqual(copied, mode === 'absent' ? [] : ["O'Brien"]);
  }
});
