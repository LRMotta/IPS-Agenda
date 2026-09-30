'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function fixture() {
  const requests = [], timers = [], buttons = [];
  const grid = {
    innerHTML: '',
    querySelectorAll() {
      buttons.length = 0;
      for (const match of this.innerHTML.matchAll(/data-pendencia-action="(\d+)"/g)) {
        buttons.push({ index: match[1], getAttribute() { return this.index; }, addEventListener(_name, fn) { this.click = fn; } });
      }
      return buttons;
    }
  };
  const status = { innerHTML: '' }, button = { disabled: false, querySelector() { return null; } };
  const context = vm.createContext({
    window: { STATE: {}, addEventListener() {} },
    document: { addEventListener() {}, getElementById(id) { return { pendenciasGrid: grid, pendenciasStatus: status, btnPendenciasRefresh: button }[id] || null; } },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    esc(value) { return String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); },
    snack() {}, snackErro() {}, fecharOverlay() {}
  });
  context.appServerRun = options => { context.mutation = options; };
  function runner(success, failure) {
    return { withSuccessHandler(fn) { return runner(fn, failure); }, withFailureHandler(fn) { return runner(success, fn); }, getPendenciasOperacionais() { requests.push({ success, failure }); } };
  }
  context.google = { script: { run: runner() } };
  vm.runInContext(readProjectFile('IndexPendenciasScripts.html').replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, ''), context);
  return { context, grid, buttons, requests, timers, status, button };
}

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
