'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function fixture() {
  const requests = [], timers = [], buttons = [];
  const grid = {
    children: [], placeholder: '',
    get innerHTML() { return this.children.length ? this.children.map(card => card.html).join('') : this.placeholder; },
    set innerHTML(html) { this.children = []; this.placeholder = html; },
    querySelector(selector) { return this.children.find(card => selector.includes('"' + card.key + '"')) || null; },
    appendChild(card) { this.children.push(card); card.parent = this; syncButtons(); },
    contains(button) { return this.children.includes(button.card); },
    addEventListener(_name, fn) { this.click = fn; },
    querySelectorAll() {
      return buttons;
    }
  };
  function syncButtons() {
    buttons.length = 0;
    for (const card of grid.children) {
      for (const match of card.html.matchAll(/data-pendencia-action="(\d+)"/g)) {
        const button = { card, index: match[1], getAttribute() { return this.index; }, closest(selector) { return selector === '[data-pendencia-action]' ? this : card; } };
        button.click = (event = {}) => grid.click({ ...event, target: button });
        buttons.push(button);
      }
    }
  }
  function createElement() {
    return {
      set innerHTML(html) {
        this.firstElementChild = {
          html, key: html.match(/data-pendencia-card="([^"]+)"/)[1],
          replaceWith(card) { const parent = this.parent; parent.children[parent.children.indexOf(this)] = card; card.parent = parent; syncButtons(); },
          remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); syncButtons(); }
        };
      }
    };
  }
  const ts = { textContent: '' };
  const status = { innerHTML: '' }, button = { disabled: false, querySelector() { return null; } };
  const context = vm.createContext({
    window: { STATE: {}, addEventListener() {} },
    document: { createElement, addEventListener() {}, getElementById(id) { return { pendenciasGrid: grid, pendenciasStatus: status, btnPendenciasRefresh: button, pendenciasTs: ts }[id] || null; } },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    esc(value) { return String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); },
    snack() {}, snackErro() {}, fecharOverlay() {}
  });
  context.appServerRun = options => { context.mutation = options; };
  function runner(success, failure) {
    return { withSuccessHandler(fn) { return runner(fn, failure); }, withFailureHandler(fn) { return runner(success, fn); }, getPendenciasOperacionais() { requests.push({ success, failure }); } };
  }
  context.google = { script: { run: runner() } };
  vm.runInContext(readProjectFile('IndexPendenciasScripts.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, ''), context);
  return { context, grid, buttons, requests, timers, status, button, ts };
}

test('courier nao agendada abre Transporte com slot correto e transicao, sem exigir AWB na Agenda', () => {
  const { context } = fixture();
  const calls = [];
  const targetWindow = {};
  context.prepararJanelaTransporte = args => { calls.push(['transition', args]); return targetWindow; };
  context.abrirTransporteModulo = (target, args) => calls.push(['open', target, args]);
  context.pendenciaTransporteAction({ agendaId: 'EVT-1', slot: 'Transporte II', participante: 'Teste', projeto: 'P' })();
  assert.equal(calls[0][0], 'transition');
  assert.equal(calls[1][1], targetWindow);
  assert.equal(calls[1][2].agendaId, 'EVT-1');
  assert.equal(calls[1][2].slot, '2');
  assert.equal(context.pendenciasEstaoDesatualizadas(), true);
});

test('cache vencido aparece durante entrada e refresh forcado sem reconstruir lista existente', () => {
  for (const forced of [false, true]) {
    for (const empty of [false, true]) {
      const { context, grid, requests, button, ts, status } = fixture();
      context._pendenciasCache = { kitsVencendo: [{ descricao: 'Kit anterior' }] };
      context.setPendenciasLoadedAtState(Date.now() - 240000);
      if (!empty) grid.innerHTML = '<div>DOM anterior preservado</div>';
      const before = grid.innerHTML;
      const loadedAt = context.pendenciasLoadedAtTime();
      context.carregarPendencias(forced);
      assert.equal(requests.length, 1);
      assert.equal(button.disabled, true);
      assert.equal(status.innerHTML, '');
      assert.match(ts.textContent, /^Em memória: /);
      assert.equal(context.pendenciasLoadedAtTime(), loadedAt);
      if (empty) assert.match(grid.innerHTML, /Kit anterior/);
      else assert.equal(grid.innerHTML, before);
      assert.doesNotMatch(grid.innerHTML, /Carregando pendências/);
      requests[0].success({ pendencias: { kitsVencendo: [{ descricao: 'Kit novo' }] } });
      assert.match(grid.innerHTML, /Kit novo/);
      assert.match(ts.textContent, /^Atualizado: /);
      assert.equal(button.disabled, false);
    }
  }
});

test('acoes preservam aspas, entidades e HTML como dados, sem eventos inline', () => {
  const { context, grid, buttons } = fixture();
  const value = 'Kit "especial" &quot; \' </button><img src=x onerror=alert(1)>';
  let opened;
  context.abrirPendenciaEstoque = q => { opened = q; };
  context.renderDashboardPendencias({ kitsVencendo: [{ descricao: value }] });
  assert.doesNotMatch(grid.innerHTML, /\sonclick=|<img\b/);
  assert.match(grid.innerHTML, /<button type="button" class="dash-pend-text dash-pend-open"/);
  buttons[0].click();
  assert.equal(opened, value);
});

test('renderizar AWB nao altera o item e cada botao abre sua propria acao', () => {
  const { context, grid, buttons } = fixture();
  const item = Object.freeze({ agendaId: 'A"&quot;', slot: 'Transporte I', awb: '123', courier: 'DHL', temperatura: 'Ambiente', trackingUrl: 'https://example.org/?a="&b=1' });
  const calls = [];
  context.abrirPendenciaTracking = (_ev, url) => calls.push(url);
  context.confirmarEntregaPendencia = (_ev, ...args) => calls.push(args);
  context.abrirPendenciaAwb = id => calls.push(id);
  context.renderDashboardPendencias({ awbEnviadaNaoEntregue: [item] });
  assert.equal(item.courier, 'DHL');
  assert.match(grid.innerHTML, /DHL \/ Ambiente/);
  buttons.forEach(btn => btn.click({ currentTarget: btn }));
  assert.equal(calls[0], item.agendaId);
  assert.equal(calls[1], item.trackingUrl);
  assert.equal(calls[2][0], item.agendaId);
  assert.equal(calls[2][4], 'DHL');
});

test('refresh incremental preserva cards iguais e atualiza contagens, avisos e handlers do card alterado', () => {
  const { context, grid, buttons } = fixture();
  let opened;
  context.abrirPendenciaEstoque = q => { opened = q; };
  const data = { kitsVencendo: [{ descricao: 'Kit A' }], courierNaoAgendada: [{ agendaId: 'A' }] };
  context.renderDashboardPendencias(data);
  const kit = grid.children[6], courier = grid.children[0];
  context.renderDashboardPendencias(JSON.parse(JSON.stringify(data)));
  assert.equal(grid.children[6], kit);
  assert.equal(grid.children[0], courier);
  context.renderDashboardPendencias({ ...data, counts: { kitsVencendo: 20 } });
  assert.notEqual(grid.children[6], kit);
  assert.equal(grid.children[0], courier);
  assert.match(grid.children[6].html, /dash-pend-count">20</);
  context.renderDashboardPendencias({ ...data, unavailable: { kitsVencendo: 'Indisponível' } });
  assert.match(grid.children[6].html, /Indisponível/);
  assert.equal(grid.children[0], courier);
  context.renderDashboardPendencias({ ...data, kitsVencendo: [{ descricao: 'Kit B' }] });
  buttons.find(button => button.card === grid.children[6]).click();
  assert.equal(opened, 'Kit B');
  assert.equal(grid.children[0], courier);
});

test('onComplete aguarda a consulta compartilhada e recebe sucesso', () => {
  const { context, requests, button } = fixture();
  const completed = [];
  context.carregarPendencias(false, { onComplete: result => completed.push(result.ok) });
  context.carregarPendencias(false, { onComplete: result => completed.push(result.ok) });
  assert.equal(requests.length, 1);
  assert.equal(completed.length, 0);
  requests[0].success({ pendencias: {} });
  assert.deepEqual(completed, [true, true]);
  assert.equal(button.disabled, false);
});

test('confirmacao durante consulta descarta resposta antiga e consulta novamente antes de concluir', () => {
  const { context, requests } = fixture();
  const item = { agendaId: 'A', slot: 'Transporte I', awb: '123' };
  let completed = 0;
  context._pendenciasCache = { awbEnviadaNaoEntregue: [item] };
  context.carregarPendencias(true, { silent: true, onComplete: () => completed++ });
  context._pendenciaEntregaPendente = item;
  context.executarConfirmarEntregaPendencia_();
  context.mutation.onSuccess({ ok: true });
  assert.equal(context._pendenciasCache.awbEnviadaNaoEntregue.length, 0);
  requests[0].success({ pendencias: { awbEnviadaNaoEntregue: [item] } });
  assert.equal(context._pendenciasCache.awbEnviadaNaoEntregue.length, 0);
  assert.equal(requests.length, 2);
  assert.equal(completed, 0);
  requests[1].success({ pendencias: { awbEnviadaNaoEntregue: [] } });
  assert.equal(completed, 1);
  assert.equal(context._pendenciasRefreshing, false);
});

test('pedidos forcados simultaneos geram apenas uma consulta adicional', () => {
  const { context, requests } = fixture();
  let completed = 0;
  for (let i = 0; i < 4; i++) context.carregarPendencias(true, { onComplete: () => completed++ });
  requests[0].success({ pendencias: { counts: { kitsVencendo: 99 } } });
  assert.equal(requests.length, 2);
  assert.equal(context._pendenciasCache, null);
  requests[1].success({ pendencias: {} });
  assert.equal(completed, 4);
});

test('falha silenciosa compartilhada avisa solicitante visivel e preserva cache', () => {
  const { context, requests, status, button } = fixture();
  const cache = { kitsVencendo: [] };
  context._pendenciasCache = cache;
  context.carregarPendencias(true, { silent: true });
  let result;
  context.carregarPendencias(false, { onComplete: value => { result = value; } });
  requests[0].failure(new Error('Falha simulada'));
  assert.equal(result.ok, false);
  assert.equal(context._pendenciasCache, cache);
  assert.match(status.innerHTML, /Falha simulada/);
  assert.equal(button.disabled, false);
});

test('timeout libera fila, ignora resposta tardia e permite nova tentativa', () => {
  const { context, requests, timers, button } = fixture();
  let completed = 0;
  context.carregarPendencias(false, { onComplete: result => { assert.equal(result.ok, false); completed++; } });
  timers[0]();
  requests[0].success({ pendencias: {} });
  assert.equal(completed, 1);
  assert.equal(context._pendenciasCache, null);
  assert.equal(button.disabled, false);
  context.carregarPendencias(true);
  requests[1].success({ pendencias: {} });
  assert.equal(context._pendenciasRefreshing, false);
});

test('falhas no renderer e na recuperacao preservam cache/carimbo e liberam fila', () => {
  for (const cached of [false, true]) {
    const { context, requests, button, timers } = fixture();
    const cache = cached ? { kitsVencendo: [] } : null;
    context._pendenciasCache = cache;
    context.setPendenciasLoadedAtState(1234);
    const renderer = context.renderDashboardPendencias;
    context.renderDashboardPendencias = () => { throw new Error('render indisponivel'); };
    let result;
    context.carregarPendencias(true, { onComplete: value => { result = value; } });
    requests[0].success({ pendencias: { kitsVencendo: [] } });
    timers[0]();
    assert.equal(result.ok, false);
    assert.equal(context._pendenciasRefreshing, false);
    assert.equal(button.disabled, false);
    assert.equal(context._pendenciasCache, cache);
    assert.equal(context.pendenciasLoadedAtTime(), 1234);
    context.renderDashboardPendencias = renderer;
    context.carregarPendencias(true);
    requests[1].success({ pendencias: {} });
    assert.equal(context._pendenciasRefreshing, false);
    assert.notEqual(context.pendenciasLoadedAtTime(), 1234);
  }
});

test('respostas invalidas nao substituem cache nem carimbo e permitem retentativa', () => {
  for (const response of [null, {}, { erro: 'falha' }, { ok: false }, { pendencias: [] }, { pendencias: { kitsVencendo: [null] } }]) {
    const { context, requests } = fixture();
    const cache = { kitsVencendo: [] };
    context._pendenciasCache = cache;
    context.setPendenciasLoadedAtState(1234);
    let result;
    context.carregarPendencias(true, { onComplete: value => { result = value; } });
    requests[0].success(response);
    assert.equal(result.ok, false);
    assert.equal(context._pendenciasCache, cache);
    assert.equal(context.pendenciasLoadedAtTime(), 1234);
    assert.equal(context._pendenciasRefreshing, false);
  }
});

test('resultado parcial mostra kits indisponiveis e continua mostrando outras pendencias', () => {
  const { context, requests, grid, status } = fixture();
  let result;
  context.carregarPendencias(true, { silent: true, onComplete: value => { result = value; } });
  requests[0].success({ pendencias: { unavailable: { kitsVencendo: 'Estoque indisponível' }, courierNaoAgendada: [{ participante: 'Pessoa A' }] } });
  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.match(grid.innerHTML, /Estoque indisponível/);
  assert.match(grid.innerHTML, /Pessoa A/);
  assert.match(status.innerHTML, /Estoque indisponível/);
  assert.equal(context.pendenciasEstaoDesatualizadas(), true);
});

test('falha ao aplicar refresh silencioso restaura a tela do cache anterior', () => {
  const { context, requests, grid } = fixture();
  context._pendenciasCache = { kitsVencendo: [{ descricao: 'Kit anterior' }] };
  const render = context.renderDashboardPendencias;
  render(context._pendenciasCache);
  const previousHtml = grid.innerHTML;
  let calls = 0;
  context.renderDashboardPendencias = data => {
    if (++calls === 1) { grid.innerHTML = 'DOM incompleto'; throw new Error('falha apos DOM'); }
    render(data);
  };
  context.carregarPendencias(true, { silent: true });
  requests[0].success({ pendencias: { kitsVencendo: [] } });
  assert.equal(grid.innerHTML, previousHtml);
  assert.equal(context._pendenciasRefreshing, false);
});

test('recuperacao silenciosa limpa somente aviso parcial que ainda pertence a consulta', () => {
  for (const confirmed of [false, true]) {
    const { context, requests, status } = fixture();
    context.carregarPendencias(true, { silent: true });
    requests[0].success({ pendencias: { unavailable: { kitsVencendo: 'Estoque indisponível' } } });
    if (confirmed) context.setPendenciasStatus('Entrega confirmada', 'ok');
    context.carregarPendencias(true, { silent: true });
    requests[1].success({ pendencias: {} });
    if (confirmed) assert.match(status.innerHTML, /Entrega confirmada/);
    else assert.equal(status.innerHTML, '');
    assert.equal(context.pendenciasEstaoDesatualizadas(), false);
  }
});

test('retorno de confirmacao A nao altera modal nem botao da entrega B', () => {
  for (const outcome of ['success', 'conflict', 'failure']) {
    const { context } = fixture();
    const btn = { disabled: false, innerHTML: '' };
    const get = context.document.getElementById;
    context.document.getElementById = id => id === 'btnConfirmarEntregaPendencia' ? btn : get(id);
    context.appErrorMessage = e => e.message;
    let closes = 0;
    context.fecharOverlay = () => { closes++; };
    context._pendenciaEntregaPendente = { agendaId: 'A', slot: 'Transporte I' };
    context.executarConfirmarEntregaPendencia_();
    const request = context.mutation;
    context.fecharConfirmacaoEntregaPendencia();
    const b = { agendaId: 'B', slot: 'Transporte II' };
    context._pendenciaEntregaPendente = b;
    btn.disabled = true;
    btn.innerHTML = 'Confirmando B';
    if (outcome === 'failure') request.onFailure(new Error('rede'));
    else request.onSuccess(outcome === 'conflict' ? { conflito: true } : { ok: true });
    assert.equal(context._pendenciaEntregaPendente, b);
    assert.equal(closes, 1);
    assert.equal(btn.disabled, true);
    assert.equal(btn.innerHTML, 'Confirmando B');
  }
});

test('falha da confirmacao atual restaura rotulo e habilita nova tentativa', () => {
  const { context } = fixture();
  const btn = { disabled: false, innerHTML: '' };
  const get = context.document.getElementById;
  context.document.getElementById = id => id === 'btnConfirmarEntregaPendencia' ? btn : get(id);
  context.appErrorMessage = e => e.message;
  const pending = { agendaId: 'A', slot: 'Transporte I' };
  context._pendenciaEntregaPendente = pending;
  context.executarConfirmarEntregaPendencia_();
  context.mutation.onFailure(new Error('rede'));
  assert.equal(btn.disabled, false);
  assert.match(btn.innerHTML, /Confirmar entrega/);
  assert.equal(context._pendenciaEntregaPendente, pending);
});
