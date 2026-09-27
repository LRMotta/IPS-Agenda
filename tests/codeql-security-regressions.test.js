'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function fakeElement() {
  let text = '';
  const classes = new Set();
  const element = {
    children: [],
    dataset: {},
    listeners: {},
    style: {},
    value: '',
    className: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
  };
  Object.defineProperty(element, 'textContent', {
    get() { return text; },
    set(value) {
      text = String(value == null ? '' : value);
      this.children = [];
    }
  });
  Object.defineProperty(element, 'innerHTML', {
    get() { throw new Error('innerHTML nao deve ser lido neste teste'); },
    set() { throw new Error('innerHTML nao deve ser escrito neste teste'); }
  });
  return element;
}

function fakePrintWindow() {
  const written = [];
  const elements = {};
  const classElements = {};
  const doc = {
    open() {},
    write(html) { written.push(String(html)); },
    close() {},
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) { return classElements[selector] || []; }
  };
  return {
    written,
    elements,
    classElements,
    window: { open: () => ({ document: doc }) }
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

test('presenca da Agenda usa aleatoriedade criptografica e mantem um ID estavel por aba', () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  const body = sourceBetween(source, 'function agendaEditPresenceSessionId()', 'function agendaStopEditPresenceTimer()');
  assert.doesNotMatch(body, /Math\.random/);

  let calls = 0;
  const context = vm.createContext({
    Date: { now: () => 1790000000000 },
    Uint8Array,
    _agendaEditSessionId: '',
    _agendaEditSessionSequence: 0,
    window: {
      crypto: {
        getRandomValues(bytes) {
          calls += 1;
          bytes.forEach((_, index) => { bytes[index] = index; });
          return bytes;
        }
      }
    }
  });
  vm.runInContext(body, context);

  const first = context.agendaEditPresenceSessionId();
  assert.equal(first, 'ag-1790000000000-000102030405060708090a0b0c0d0e0f');
  assert.equal(context.agendaEditPresenceSessionId(), first);
  assert.equal(calls, 1);
});

test('fallback de identificador de presenca nao usa Math.random nem interrompe navegadores legados', () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  const body = sourceBetween(source, 'function agendaEditPresenceSessionId()', 'function agendaStopEditPresenceTimer()');
  const context = vm.createContext({
    Date: { now: () => 1234 },
    _agendaEditSessionId: '',
    _agendaEditSessionSequence: 0,
    window: { performance: { now: () => 5.25 } }
  });
  vm.runInContext(body, context);

  assert.equal(context.agendaEditPresenceSessionId(), 'ag-1234-5.25-1');
  assert.equal(context.agendaEditPresenceSessionId(), 'ag-1234-5.25-1');
});

test('autocomplete de especialidades renderiza texto literal e seleciona sem handler inline', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const renderer = sourceBetween(source, 'function renderAcList(q)', 'function selectEsp(val)');
  const payload = `O'Brien\\');alert(1)//\n<img src=x onerror=alert(2)>`;
  const list = fakeElement();
  const selected = [];
  const context = vm.createContext({
    ESPS: [payload],
    _acIdx: -1,
    norm: value => String(value).toLowerCase(),
    document: {
      getElementById: () => list,
      createElement: () => fakeElement()
    },
    selectEsp: value => selected.push(value)
  });
  vm.runInContext(renderer, context);

  context.renderAcList('');
  const item = list.children[0];
  assert.equal(item.textContent, payload);
  assert.equal(item.dataset.val, payload);
  let prevented = false;
  item.listeners.mousedown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(selected, [payload]);
});

test('autocomplete de formacoes renderiza texto literal e seleciona sem handler inline', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const renderer = sourceBetween(source, 'function renderAcListSol(q)', 'function selectFormacao(val)');
  const payload = `Formação \\');alert(1)//\n<svg onload=alert(2)>`;
  const list = fakeElement();
  const selected = [];
  const context = vm.createContext({
    FORMACOES: [payload],
    _acIdxSol: -1,
    norm: value => String(value).toLowerCase(),
    document: {
      getElementById: () => list,
      createElement: () => fakeElement()
    },
    selectFormacao: value => selected.push(value)
  });
  vm.runInContext(renderer, context);

  context.renderAcListSol('');
  const item = list.children[0];
  assert.equal(item.textContent, payload);
  assert.equal(item.dataset.val, payload);
  let prevented = false;
  item.listeners.mousedown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(selected, [payload]);
});

test('autocomplete de projetos renderiza texto literal e seleciona sem handler inline', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const renderer = sourceBetween(source, 'function renderAcProj(inputId, listId, opts, selVar)', 'function pickAcProj(');
  const payload = `Projeto\\');alert(1)//\n<img src=x onerror=alert(2)>`;
  const input = fakeElement();
  const list = fakeElement();
  const selected = [];
  const context = vm.createContext({
    _acIdxProj: {},
    norm: value => String(value).toLowerCase(),
    document: {
      getElementById: id => id === 'pEsp' ? input : list,
      createElement: () => fakeElement()
    },
    pickAcProj: (...args) => selected.push(args)
  });
  vm.runInContext(renderer, context);

  context.renderAcProj('pEsp', 'pEspList', [payload], '_selPEsp');
  const item = list.children[0];
  assert.equal(item.textContent, payload);
  assert.equal(item.dataset.val, payload);
  let prevented = false;
  item.listeners.mousedown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(selected, [['pEsp', 'pEspList', payload, '_selPEsp']]);
});

test('feedback da copia de grafico nao reinterpreta HTML lido do proprio botao', () => {
  const dashboard = readProjectFile('IndexDashboard.html');
  const feedback = sourceBetween(dashboard, '  function dashboardCopyChartFeedback(', '  function dashboardSetChartCopyButtonContent_(');
  const content = sourceBetween(dashboard, '  function dashboardSetChartCopyButtonContent_(', '\n  </script>');
  const timers = [];
  const button = fakeElement();
  const context = vm.createContext({
    document: { createElement: () => fakeElement() },
    window: { setTimeout(callback, delay) { timers.push({ callback, delay }); } },
    snack() {},
    snackErro() {}
  });
  vm.runInContext(feedback + content, context);

  context.dashboardCopyChartFeedback(button, true, 'Gráfico copiado.');
  assert.deepEqual(button.children.map(child => child.textContent), ['check', 'Copiado!']);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 2200);
  timers[0].callback();
  assert.deepEqual(button.children.map(child => child.textContent), ['content_copy', 'Copiar gráfico']);
});

test('relatorios da Agenda atribuem a origem do logo como propriedade, fora do HTML escrito', () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  const shell = sourceBetween(source, 'function agendaPrintShell(opts)', 'function agendaPrintResumoHtml(');
  const opener = sourceBetween(source, 'function agendaAbrirJanelaImpressao(titulo, html)', 'function agendaGoogleCalendarDateIso(');
  const receipt = sourceBetween(source, 'function agendaReciboPrintHtml_(dados, recibo)', 'function agendaCourierCards(');
  const logo = '"><img src=x onerror=alert(1)>';
  const popup = fakePrintWindow();
  popup.elements.agendaPrintLogo = fakeElement();
  popup.elements.agendaPrintLogoFallback = fakeElement();
  const context = vm.createContext({
    Date,
    document: { querySelector: () => ({ src: logo }) },
    window: popup.window,
    esc: escapeHtml,
    agendaReciboFormatarValor_: () => 'R$ 10,00',
    agendaReciboValorExtenso_: () => 'dez reais',
    agendaReciboDataExtenso_: () => '27 de setembro de 2026',
    agendaReciboDataBr_: () => '27/09/2026',
    snack() {}
  });
  vm.runInContext(shell + opener + receipt, context);

  const html = context.agendaPrintShell({ title: 'Agenda', body: '<div>Resumo</div>', landscape: true });
  assert.doesNotMatch(html, /onerror=alert/);
  assert.match(html, /id="agendaPrintLogo"/);
  context.agendaAbrirJanelaImpressao('Agenda', html);
  assert.doesNotMatch(popup.written[0], /onerror=alert/);
  assert.equal(popup.elements.agendaPrintLogo.src, logo);
  assert.equal(popup.elements.agendaPrintLogo.style.display, '');
  assert.equal(popup.elements.agendaPrintLogoFallback.style.display, 'none');

  popup.classElements['.agendaPrintReceiptLogo'] = [fakeElement(), fakeElement(), fakeElement()];
  popup.classElements['.agendaPrintReceiptLogoFallback'] = [fakeElement(), fakeElement(), fakeElement()];
  const receiptHtml = context.agendaReciboPrintHtml_(
    { projeto: 'IPS', idParticipante: 'P-123', visita: 'V1' },
    { valor: 10, dataEmissao: '2026-09-27', dataVisita: '2026-09-20', nome: 'Ana', tipo: 'Participante' }
  );
  assert.equal((receiptHtml.match(/class="agendaPrintReceiptLogo"/g) || []).length, 3);
  assert.doesNotMatch(receiptHtml, /onerror=alert/);
  assert.doesNotMatch(receiptHtml, /src="[^"]*onerror/);
  context.agendaAbrirJanelaImpressao('Recibo', receiptHtml);
  assert.doesNotMatch(popup.written[1], /onerror=alert/);
  assert.deepEqual(popup.classElements['.agendaPrintReceiptLogo'].map(image => image.src), [logo, logo, logo]);
  assert.ok(popup.classElements['.agendaPrintReceiptLogo'].every(image => image.style.display === ''));
  assert.ok(popup.classElements['.agendaPrintReceiptLogoFallback'].every(fallback => fallback.style.display === 'none'));
});

test('relatorios de estoque atribuem a origem do logo como propriedade, fora do HTML escrito', () => {
  const source = readProjectFile('IndexEstoqueScripts.html');
  const logo = '"><img src=x onerror=alert(1)>';

  for (const report of [
    {
      name: 'estoque',
      start: 'function imprimirRelatorioEstoque()',
      end: 'function ensurePlanejamentoPedidoModal()',
      imageId: 'estoquePrintLogo',
      context: {
        getRelatorioEstoqueTipo: () => 'estoque',
        getItensRelatorioFiltrados: () => []
      }
    },
    {
      name: 'descarte',
      start: 'function imprimirRelatorioDescarte(id)',
      end: 'function pedidoStatusChip(status)',
      imageId: 'estoqueDescartePrintLogo',
      context: {
        _estoqueInlineDados: { descartes: [{ idDescarte: 'D-1' }], itensMap: { 'D-1': [] } }
      }
    }
  ]) {
    const renderer = sourceBetween(source, report.start, report.end);
    const popup = fakePrintWindow();
    popup.elements[report.imageId] = fakeElement();
    const context = vm.createContext(Object.assign({
      Date,
      document: {
        querySelector: () => ({ src: logo }),
        getElementById: () => ({ value: '' })
      },
      window: popup.window,
      esc: escapeHtml,
      estoqueValidadeExibicao: () => '',
      snack() {}
    }, report.context));
    vm.runInContext(renderer, context);

    if (report.name === 'estoque') context.imprimirRelatorioEstoque();
    else context.imprimirRelatorioDescarte('D-1');

    assert.doesNotMatch(popup.written[0], /onerror=alert/, report.name);
    assert.match(popup.written[0], new RegExp(`id="${report.imageId}"`));
    assert.equal(popup.elements[report.imageId].src, logo, report.name);
    assert.equal(popup.elements[report.imageId].style.display, '', report.name);
  }
});
