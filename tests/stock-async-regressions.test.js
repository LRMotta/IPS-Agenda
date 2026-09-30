'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const source = readProjectFile('IndexEstoqueScripts.html');

function loadFunctions(values, names) {
  const context = vm.createContext(values);
  names.forEach(name => {
    const match = source.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  });
  return context;
}

function fakeRunner(requests) {
  return { withSuccessHandler(ok) {
    return { withFailureHandler(fail) {
      return new Proxy({}, { get: (_target, method) => (...args) => requests.push({ method, args, ok, fail }) });
    } };
  } };
}

function cacheFixture() {
  const requests = [];
  const c = loadFunctions({
    ESTOQUE_CLIENT_CACHE: {}, ESTOQUE_CLIENT_IN_FLIGHT: {}, ESTOQUE_CLIENT_CACHE_TTL_MS: 300000,
    _estoqueConfigLoaded: true, _estoqueConfigLoadedAt: Date.now(), window: {},
    google: { script: { run: fakeRunner(requests) } }
  }, ['estoqueClientCacheValid', 'resetEstoqueConfigCacheState', 'invalidateEstoqueClientCache', 'estoqueCachedRun']);
  return { c, requests };
}

for (const order of [[0, 1], [1, 0]]) {
  test('estoque: force entrega apenas a resposta nova a todos os consumidores, ordem ' + order, () => {
    const { c, requests } = cacheFixture();
    const results = [];
    c.estoqueCachedRun('itens', 'getItens', [], v => results.push('inicial:' + v), null, false);
    c.estoqueCachedRun('itens', 'getItens', [], v => results.push('compartilhado:' + v), null, false);
    assert.equal(requests.length, 1);
    c.estoqueCachedRun('itens', 'getItens', [], v => results.push('force:' + v), null, true);
    order.forEach(i => requests[i].ok(i === 0 ? 'antiga' : 'nova'));
    assert.deepEqual(results, ['inicial:nova', 'compartilhado:nova', 'force:nova']);
    assert.equal(c.ESTOQUE_CLIENT_CACHE.itens.data, 'nova');
  });

  for (const global of [false, true]) {
    test('estoque: invalidação ' + (global ? 'global' : 'por chave') + ' descarta callbacks antigos, ordem ' + order, () => {
      const { c, requests } = cacheFixture();
      const results = [];
      c.estoqueCachedRun('itens', 'getItens', [], v => results.push('antigo:' + v), null, false);
      c.invalidateEstoqueClientCache(global ? undefined : 'itens');
      c.estoqueCachedRun('itens', 'getItens', [], v => results.push('atual:' + v), null, true);
      order.forEach(i => requests[i].ok(i === 0 ? 'antiga' : 'nova'));
      assert.deepEqual(results, ['atual:nova']);
      assert.equal(c.ESTOQUE_CLIENT_CACHE.itens.data, 'nova');
    });
  }
}

test('estoque: erro obsoleto não remove a requisição atual nem chama seus callbacks', () => {
  const { c, requests } = cacheFixture();
  const failures = [];
  c.estoqueCachedRun('itens', 'getItens', [], null, e => failures.push(e.message), false);
  c.estoqueCachedRun('itens', 'getItens', [], null, e => failures.push(e.message), true);
  requests[0].fail(new Error('antigo'));
  assert.deepEqual(failures, []);
  assert.ok(c.ESTOQUE_CLIENT_IN_FLIGHT.itens);
  requests[1].fail(new Error('atual'));
  assert.deepEqual(failures, ['atual', 'atual']);
  assert.equal(c.ESTOQUE_CLIENT_IN_FLIGHT.itens, undefined);
});

test('estoque: force remove cache anterior e consultas seguintes compartilham a atualização', () => {
  const { c, requests } = cacheFixture();
  const results = [];
  c.ESTOQUE_CLIENT_CACHE.itens = { data: 'antiga', loadedAt: Date.now() };
  c.estoqueCachedRun('itens', 'getItens', [], v => results.push(v), null, true);
  c.estoqueCachedRun('itens', 'getItens', [], v => results.push(v), null, false);
  assert.deepEqual(results, []);
  assert.equal(requests.length, 1);
  requests[0].ok('nova');
  c.estoqueCachedRun('itens', 'getItens', [], v => results.push(v), null, false);
  assert.equal(requests.length, 1);
  assert.deepEqual(results, ['nova', 'nova', 'nova']);
});

function itemFixture() {
  const requests = [];
  const elements = {};
  function element(id) {
    if (!elements[id]) elements[id] = {
      value: '', style: {}, disabled: false, checks: [], classList: { remove() {}, toggle() {} },
      get innerHTML() { return this.html || ''; },
      set innerHTML(html) {
        this.html = html;
        this.checks = Array.from(html.matchAll(/<input type="checkbox" value="([^"]*)"( checked)?/g), m => ({ value: m[1], checked: !!m[2] }));
      },
      insertAdjacentHTML(_position, html) { this.html = (this.html || '') + html; }
    };
    return elements[id];
  }
  const c = loadFunctions({
    _itemInlineEditId: '', _itemInlineVisitasRequest: 0, _itemInlineVinculosState: null,
    ESTOQUE_CONFIG: { laboratorios: ['Lab'], localizacoes: ['Principal'], tiposItem: ['Kit', 'Material'] },
    document: { getElementById: element, querySelectorAll: selector => element(selector.split(' ')[0].slice(1)).checks.filter(i => i.checked) },
    google: { script: { run: fakeRunner(requests) } }, esc: v => String(v),
    appSetStatus() {}, appErrorMessage: e => e.message, abrirOverlay() {}, fecharOverlay() {}, snack() {}, carregarEstoqueInline() {}
  }, ['montarFormItemInline', 'itemInlinePermiteVinculoSoA', 'visitasSelecionadasItemInline',
    'bracosSelecionadosItemInline', 'ordenarVisitasSoAItemInline', 'atualizarVisitasItemInline', 'validarCampoItemInline', 'salvarItemInline']);
  c.montarFormItemInline({ id: '2', projeto: 'A', tipo: 'Kit', descricao: 'Kit', laboratorio: 'Lab', visitasAplicaveisIds: ['V1'], bracosAplicaveisIds: ['B1'] }, {}, ['A', 'B']);
  return { c, requests, element };
}

function savedPayload(f) {
  f.c.salvarItemInline();
  return JSON.parse(JSON.stringify(f.requests.filter(r => r.method === 'salvarItemEstoque').at(-1).args[0]));
}

test('item: salvar durante a carga preserva visitas e braços cadastrados', () => {
  const f = itemFixture();
  const payload = savedPayload(f);
  assert.deepEqual(payload.visitasAplicaveisIds, ['V1']);
  assert.deepEqual(payload.bracosAplicaveisIds, ['B1']);
});

test('item: falha das consultas preserva vínculos e uma nova tentativa não perde a seleção', () => {
  const f = itemFixture();
  f.requests[0].fail(new Error('offline'));
  f.requests[1].fail(new Error('offline'));
  let payload = savedPayload(f);
  assert.deepEqual(payload.visitasAplicaveisIds, ['V1']);
  assert.deepEqual(payload.bracosAplicaveisIds, ['B1']);
  f.c.atualizarVisitasItemInline();
  payload = savedPayload(f);
  assert.deepEqual(payload.visitasAplicaveisIds, ['V1']);
  assert.deepEqual(payload.bracosAplicaveisIds, ['B1']);
});

test('item: permite remover visitas explicitamente sem perder braços ainda carregando', () => {
  const f = itemFixture();
  f.requests[0].ok([{ idSoA: 'V1', nome: 'Visita' }]);
  f.element('iiVisitasLista').checks[0].checked = false;
  const payload = savedPayload(f);
  assert.deepEqual(payload.visitasAplicaveisIds, []);
  assert.deepEqual(payload.bracosAplicaveisIds, ['B1']);
});

test('item: mudança de projeto limpa vínculos anteriores e ignora respostas antigas', () => {
  const f = itemFixture();
  f.element('iiProjeto').value = 'B';
  f.c.atualizarVisitasItemInline([], []);
  f.requests[0].ok([{ idSoA: 'V1', nome: 'Antiga' }]);
  f.requests[1].fail(new Error('antigo'));
  const payload = savedPayload(f);
  assert.deepEqual(payload.visitasAplicaveisIds, []);
  assert.deepEqual(payload.bracosAplicaveisIds, []);
  assert.match(f.element('iiVisitasLista').innerHTML, /Carregando/);
});

test('item: projeto sem SoA e tipos sem vínculo continuam salváveis', () => {
  const f = itemFixture();
  f.requests[0].ok([]);
  f.requests[1].ok([]);
  let payload = savedPayload(f);
  assert.deepEqual(payload.visitasAplicaveisIds, []);
  assert.deepEqual(payload.bracosAplicaveisIds, []);
  f.element('iiTipo').value = 'Material';
  f.c.atualizarVisitasItemInline();
  payload = savedPayload(f);
  assert.deepEqual(payload.visitasAplicaveisIds, []);
  assert.deepEqual(payload.bracosAplicaveisIds, []);
});

test('item: abrir outro cadastro não herda vínculos de consultas pendentes', () => {
  const f = itemFixture();
  f.c.montarFormItemInline({ id: '3', projeto: 'A', tipo: 'Kit', descricao: 'Outro kit', laboratorio: 'Lab', visitasAplicaveisIds: ['V2'], bracosAplicaveisIds: ['B2'] }, {}, ['A']);
  f.requests[0].ok([{ idSoA: 'V1', nome: 'Antiga' }]);
  const payload = savedPayload(f);
  assert.equal(payload.id, '3');
  assert.deepEqual(payload.visitasAplicaveisIds, ['V2']);
  assert.deepEqual(payload.bracosAplicaveisIds, ['B2']);
});

function pageFixture() {
  const f = cacheFixture();
  const rendered = [], errors = [];
  Object.assign(f.c, {
    _estoqueInlinePagina: 'itens', _estoqueInlineRequest: 0, _pedidoFiltroInicial: '',
    document: { getElementById: () => ({ innerHTML: '', value: '' }) },
    setEstoqueInlineDadosState: data => { f.c.data = data; },
    applyEstoqueBootstrapConfig() {}, renderEstoqueInline: () => rendered.push(f.c.data),
    estoqueInlineErro: e => errors.push(e.message)
  });
  for (const name of ['estoqueInlineCachedRun', 'carregarEstoqueInline', 'carregarEstoqueInlineBootstrap']) {
    vm.runInContext(source.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}'))[0], f.c);
  }
  return { ...f, rendered, errors };
}

for (const bootstrap of [false, true]) {
  test('estoque: troca de seção ignora resposta e erro antigos (' + (bootstrap ? 'bootstrap' : 'dados') + ')', () => {
    const f = pageFixture();
    const load = bootstrap ? 'carregarEstoqueInlineBootstrap' : 'carregarEstoqueInline';
    f.c[load]();
    f.c._estoqueInlinePagina = 'relatorios';
    f.c[load]();
    const report = [{ idItem: 'atual' }];
    f.requests[1].ok(bootstrap ? { data: report } : report);
    f.requests[0].ok(bootstrap ? { data: { itens: ['antigos'] } } : { itens: ['antigos'] });
    f.requests[0].fail(new Error('obsoleto'));
    assert.equal(f.rendered.length, 1);
    assert.deepEqual(Array.from(f.c.data.estoque), report);
    assert.deepEqual(f.errors, []);
  });
}

test('estoque: sair e voltar à mesma seção não reaplica consumidores anteriores', () => {
  const f = pageFixture();
  f.c.carregarEstoqueInline();
  f.c._estoqueInlinePagina = 'pedidos';
  f.c.carregarEstoqueInline();
  f.c._estoqueInlinePagina = 'itens';
  f.c.carregarEstoqueInline();
  assert.equal(f.requests.length, 2);
  f.requests[0].ok({ itens: ['atual'] });
  f.requests[1].fail(new Error('pedido antigo'));
  assert.equal(f.rendered.length, 1);
  assert.deepEqual(f.errors, []);
});

test('estoque: erro atual continua visível após ignorar resposta antiga', () => {
  const f = pageFixture();
  f.c.carregarEstoqueInlineBootstrap();
  f.c.carregarEstoqueInline(true);
  f.requests[0].ok({ data: { itens: ['antigos'] } });
  f.requests[1].fail(new Error('atual'));
  assert.equal(f.rendered.length, 0);
  assert.deepEqual(f.errors, ['atual']);
});

function modalFixture() {
  const requests = [], elements = {};
  function el(id) {
    if (!elements[id]) elements[id] = { innerHTML: '', textContent: '', disabled: false, value: '', open: false,
      classList: { contains: () => elements[id].open } };
    return elements[id];
  }
  const c = loadFunctions({
    _evVinculoAgendaRequest: 0, _evSoASugestoesRequest: 0, _evAgendaCandidatos: [],
    _evReservaVinculoRows: [{ idReserva: 'R1' }, { idReserva: 'R2' }], _evReservaVinculoSelecionada: null,
    _evTransferSelecionado: { item: { projeto: 'A' } },
    document: { getElementById: el }, google: { script: { run: fakeRunner(requests) } },
    appServerRun: options => requests.push({ ok: options.onSuccess, fail: options.onFailure, args: options.args }),
    evGarantirModalVinculoAgenda() {}, esc: v => String(v), appSetStatus() {},
    abrirOverlay: id => { el(id).open = true; }
  }, ['evAbrirVinculoAgendaIndice', 'evCarregarSugestoesSoA']);
  el('modalTransferInline').open = true;
  return { c, requests, el };
}

test('reserva: candidatos e erros antigos não substituem os da reserva atual', () => {
  const f = modalFixture();
  f.c.evAbrirVinculoAgendaIndice(0);
  f.c.evAbrirVinculoAgendaIndice(1);
  f.requests[1].ok({ candidatos: [{ id: 'AG2', data: '01/10/2026', visita: 'V2' }] });
  f.requests[0].ok({ candidatos: [{ id: 'AG1' }] });
  f.requests[0].fail(new Error('antigo'));
  assert.equal(f.c._evAgendaCandidatos[0].id, 'AG2');
  assert.match(f.el('evVinculoAgendaSelect').innerHTML, /AG2/);
  assert.equal(f.el('evVinculoAgendaStatus').textContent, '1 visita(s) encontrada(s).');
  f.el('modalVinculoReservaAgenda').open = false;
  f.requests[1].fail(new Error('fechado'));
  assert.equal(f.el('evVinculoAgendaStatus').textContent, '1 visita(s) encontrada(s).');
});

test('transferência: sugestões de outro projeto ou modal fechado não alteram a seleção', () => {
  const f = modalFixture();
  f.c.evCarregarSugestoesSoA('A');
  f.c._evTransferSelecionado = { item: { projeto: 'B' } };
  f.c.evCarregarSugestoesSoA('B');
  f.requests[1].ok([{ nome: 'Visita B' }]);
  f.requests[0].ok([{ nome: 'Visita A' }]);
  f.requests[0].fail(new Error('antigo'));
  assert.match(f.el('trSoAVisita').innerHTML, /Visita B/);
  assert.equal(f.el('trSoAVisita').disabled, false);
  f.el('modalTransferInline').open = false;
  f.requests[1].fail(new Error('fechado'));
  assert.equal(f.el('trSoAVisita').disabled, false);
});

test('configuração: falha mantém fallback, invalida TTL e permite nova tentativa', () => {
  const requests = [], messages = [];
  const c = loadFunctions({
    window: { STATE: { estoque: { configLoadedAt: 123 } } },
    _estoqueConfigLoaded: true, _estoqueConfigLoadedAt: 123, ESTOQUE_CONFIG_TTL_MS: 300000,
    ESTOQUE_CONFIG: { laboratorios: ['Anterior'], localizacoes: ['Principal'], tiposItem: ['Kit'] },
    google: { script: { run: fakeRunner(requests) } }, snack: message => messages.push(message)
  }, ['estoqueConfigCacheValid', 'resetEstoqueConfigCacheState', 'applyEstoqueBootstrapConfig', 'carregarEstoqueConfig']);
  let done = 0;
  c.carregarEstoqueConfig(true, () => done++);
  requests[0].fail(new Error('offline'));
  assert.equal(c.estoqueConfigCacheValid(), false);
  assert.equal(c.window.STATE.estoque.configLoadedAt, 0);
  assert.deepEqual(c.ESTOQUE_CONFIG.laboratorios, ['Anterior']);
  assert.equal(messages.length, 1);
  assert.equal(done, 1);
  c.carregarEstoqueConfig(false, () => done++);
  assert.equal(requests.length, 2);
  requests[1].ok({ laboratorios: ['Atual'] });
  assert.equal(c.estoqueConfigCacheValid(), true);
  assert.deepEqual(c.ESTOQUE_CONFIG.laboratorios, ['Atual']);
  c.carregarEstoqueConfig(false, () => done++);
  assert.equal(requests.length, 2);
  assert.equal(done, 3);
});

test('estoque: data padrão segue São Paulo na virada do dia, mês e ano', () => {
  let instant;
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
  const c = loadFunctions({ Date: FixedDate, _estoqueBusinessDateFormatter: null }, ['estoqueHojeIso']);
  for (const [time, expected] of [
    ['2026-09-30T01:00:00Z', '2026-09-29'],
    ['2026-10-01T02:59:59Z', '2026-09-30'],
    ['2026-10-01T03:00:00Z', '2026-10-01'],
    ['2027-01-01T01:00:00Z', '2026-12-31']
  ]) {
    instant = time;
    assert.equal(c.estoqueHojeIso(), expected);
  }
  assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.split\('T'\)/);
  assert.match(source, /pedido\.dataISO \|\| estoqueHojeIso\(\)/);
  assert.equal((source.match(/function evAbrirSubstituicaoReservaIndice\(/g) || []).length, 1);
});
