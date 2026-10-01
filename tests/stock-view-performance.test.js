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

test('índice do estoque preserva todos os campos pesquisáveis e ordena lotes uma vez por carga', () => {
  let comparisons = 0;
  const c = load({ _evItemViewCache: new WeakMap(), evTipoItem: i => i.tipo,
    sortValidade: (a, b) => { comparisons++; return a.localeCompare(b); }
  }, ['evPrepararItemView']);
  const item = { descricao: 'Descrição', projeto: 'Projeto', tipo: 'Tipo', laboratorio: 'Laboratorio', idItem: 'ID',
    observacoes: 'Notas', detalhesVisita: 'Complemento', numerosPedidoPendente: ['Pendente'],
    lotes: [{ validade: '2027-01-01', localizacao: 'Local', numeroPedido: 'Pedido', responsavel: 'Responsavel', status: 'Status', accessionNumber: 'Accession' },
      { validade: '2026-12-01' }],
    reservasLaboratorio: [{ participante: 'Participante', participanteId: 'Pessoa', visitaPrevista: 'Visita', dataVisita: 'Data', agendaId: 'Agenda' }] };
  const first = c.evPrepararItemView(item);
  for (const word of ['descrição', 'projeto', 'tipo', 'laboratorio', 'id', 'notas', 'complemento', 'pendente',
    '2027-01-01', 'local', 'pedido', 'responsavel', 'status', 'accession', 'participante', 'pessoa', 'visita', 'data', 'agenda']) {
    assert.ok(first.search.includes(word), word);
  }
  assert.equal(first.lotes[0].validade, '2026-12-01');
  assert.equal(item.lotes[0].validade, '2027-01-01');
  const count = comparisons;
  for (let i = 0; i < 10; i++) assert.equal(c.evPrepararItemView(item), first);
  assert.equal(comparisons, count);
  c._evItemViewCache = new WeakMap();
  item.observacoes = 'Atualizado';
  assert.ok(c.evPrepararItemView(item).search.includes('atualizado'));
  assert.ok(comparisons > count);
});

test('digitação rápida agenda só o último filtro e seleção cancela busca pendente', () => {
  const timers = new Map();
  let next = 0, renders = 0;
  const fields = { evSearch: { value: '' }, evFilterProjeto: { value: '' }, evFilterTipo: { value: '' }, evFilterStatus: { value: '' } };
  const c = load({ _evBuscaTimer: null, _evViewStatus: 'ready', evItens: [], document: { getElementById: id => fields[id] },
    setTimeout: (callback, ms) => { assert.equal(ms, 180); timers.set(++next, callback); return next; },
    clearTimeout: id => timers.delete(id), evRenderTabela: () => { renders++; }
  }, ['evAgendarBusca', 'evFiltrar']);
  c.evAgendarBusca(); c.evAgendarBusca(); c.evAgendarBusca();
  assert.equal(timers.size, 1);
  assert.equal(renders, 0);
  c.evFiltrar();
  assert.equal(timers.size, 0);
  assert.equal(renders, 1);
  c.evAgendarBusca();
  timers.values().next().value();
  assert.equal(renders, 2);
  assert.equal(timers.size, 0);
});

test('falha do bootstrap encerra carregamento e oferece nova tentativa sem injetar mensagem como HTML', () => {
  let failure;
  const body = { innerHTML: '', attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const c = load({ _evBuscaTimer: null, _evViewStatus: 'idle', clearTimeout() {}, invalidateEstoqueClientCache() {},
    document: { getElementById: () => body },
    estoqueCachedRun: (_key, _method, _args, _ok, fail) => { failure = fail; },
    snackErro() {}, appErrorMessage: e => e.message,
    esc: s => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }, ['carregarEstoqueView', 'evFiltrar']);
  c.carregarEstoqueView();
  assert.equal(body.attributes['aria-busy'], 'true');
  failure(new Error('<script>falha</script>'));
  assert.equal(body.attributes['aria-busy'], 'false');
  assert.match(body.innerHTML, /Tentar novamente/);
  assert.doesNotMatch(body.innerHTML, /<script>/);
  assert.doesNotMatch(body.innerHTML, /Carregando/);
  const errorHtml = body.innerHTML;
  c.evFiltrar();
  assert.equal(body.innerHTML, errorHtml);
  c.carregarEstoqueView(true);
  c.evFiltrar();
  assert.match(body.innerHTML, /Carregando/);
});
