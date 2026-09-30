'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');

test('buscas, filtros e erros têm nomes e referências acessíveis válidas', () => {
  const html = readProjectFile('IndexContentAfterDashboard.html');
  const tags = html.match(/<(?:input|select|textarea)\b[^>]*>/g);
  for (const tag of tags) {
    const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
    if (/^(search|filter|auditFilter|auditLimit|agendaBusca)/.test(id)) assert.match(tag, /aria-label="[^"]+"/, id);
    const described = (tag.match(/aria-describedby="([^"]+)"/) || [])[1];
    if (described) for (const target of described.split(' ')) assert.ok(html.includes('id="' + target + '"'), target);
  }
  assert.match(html, /<label[^>]+for="rqObs"/);
  for (const id of ['rqPaciente', 'rqPrestador', 'rqSolicitante']) {
    const tag = tags.find(tag => tag.includes('id="' + id + '"'));
    assert.match(tag, /role="combobox"/);
    assert.ok(tag.includes('aria-controls="' + id + 'List"'));
    assert.match(tag, /aria-required="true"/);
  }
});

test('todos os diálogos do fragmento têm título válido e fechamento sem efeito de confirmação', () => {
  const html = readProjectFile('IndexContentAfterDashboard.html');
  const dialogs = [...html.matchAll(/<div class="(?:modal-overlay|ag-create-panel)"[^>]+>\s*(<div[^>]+>)/g)];
  assert.equal(dialogs.length, 11);
  for (const [overlay, box] of dialogs) {
    assert.match(overlay, /data-accessible-dialog/);
    assert.match(box, /role="(?:alertdialog|dialog)"/);
    const title = box.match(/aria-labelledby="([^"]+)"/)[1];
    assert.ok(html.includes('id="' + title + '"'), title);
  }
  assert.match(html, /id="modalAgendaVisitaMesmaData"[^>]*data-dialog-escape="blocked"/);
});

test('abas da auditoria sincronizam seleção, painel e navegação circular antes da resposta remota', () => {
  const elements = Object.fromEntries(['auditTabLog', 'auditTabChanges', 'auditResultsPanel'].map(id => [id, {
    attrs: {}, classList: { toggle() {} },
    setAttribute(key, value) { this.attrs[key] = value; },
    focus() { this.focused = true; }
  }]));
  const calls = [];
  const c = vm.createContext({ document: { getElementById: id => elements[id] }, AUDIT_VIEW: 'log',
    AUDIT_PAGE_OFFSET: { changes: 200 }, carregarAuditPage: (...args) => calls.push(args) });
  vm.runInContext(contentAccessibilitySource(['setAuditView', 'updateAuditTabAccessibility', 'auditTabKeydown']), c);
  let prevented = 0;
  c.auditTabKeydown({ currentTarget: { id: 'auditTabLog' }, key: 'ArrowLeft', preventDefault() { prevented++; } });
  assert.equal(elements.auditTabChanges.attrs['aria-selected'], 'true');
  assert.equal(elements.auditTabLog.attrs.tabindex, '-1');
  assert.equal(elements.auditResultsPanel.attrs['aria-labelledby'], 'auditTabChanges');
  assert.equal(elements.auditTabChanges.focused, true);
  assert.deepEqual(calls[0], ['changes', 200, false]);
  c.auditTabKeydown({ currentTarget: { id: 'auditTabChanges' }, key: 'Home', preventDefault() { prevented++; } });
  assert.equal(elements.auditTabLog.attrs['aria-selected'], 'true');
  assert.equal(prevented, 2);
});

test('Escape fecha autocomplete vazio sem fechar o diálogo e não escolhe opções invisíveis', () => {
  let open = true, closed = 0, prevented = 0;
  const c = vm.createContext({ document: {
    getElementById: () => ({ classList: { contains: () => open } }),
    querySelectorAll: () => []
  }, fecharReqAC: () => { closed++; open = false; } });
  vm.runInContext(contentAccessibilitySource(['navReqAC']), c);
  c.navReqAC({ key: 'Escape', preventDefault() { prevented++; } }, 'rqPaciente', 'rqPacienteList');
  assert.equal(closed, 1);
  assert.equal(prevented, 1);
  c.navReqAC({ key: 'Enter', preventDefault() { prevented++; } }, 'rqPaciente', 'rqPacienteList');
  assert.equal(prevented, 1);
});

test('rótulo acentuado de Laboratório Central preserva o valor legado enviado pela Agenda', () => {
  const html = readProjectFile('IndexContentAfterDashboard.html');
  const select = html.match(/<select\b[^>]*id="agLabCentral"[^>]*>([^]*?)<\/select>/)[1];
  assert.match(select, /<option value="Nao">Não<\/option>/);
  assert.match(select, /<option>Sim<\/option>/);
});
