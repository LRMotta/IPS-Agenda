'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');

test('modais extras participam da pilha acessível e identificam os controles visíveis', () => {
  const html = readProjectFile('IndexExtraModals.html');
  const overlays = html.match(/<div class="modal-overlay"[^>]+>/g);
  assert.equal(overlays.length, 10);
  for (const overlay of overlays) {
    assert.match(overlay, /data-accessible-dialog/);
    assert.match(overlay, /data-extra-dialog/);
    assert.match(overlay, /\binert\b/);
  }
  for (const button of html.match(/<button class="modal-close"[^>]+>/g)) {
    assert.match(button, /type="button"/);
    assert.match(button, /aria-label="Fechar janela"/);
  }
  assert.match(html, /id="prestEmailEntry"[^>]*aria-describedby="errPrestEmail"/);
  assert.match(html, /id="courierConteudoEditor"[^>]*role="textbox"[^>]*aria-multiline="true"[^>]*aria-labelledby="courierConteudoLabel"/);
  assert.doesNotMatch(html, /obrigatÃ/);
});

test('edições e remoção de destinatários marcam o cadastro para confirmação de descarte', () => {
  const c = vm.createContext({});
  vm.runInContext(contentAccessibilitySource(['appEditableDirtyScope']), c);
  for (const id of ['modalPrestador', 'modalLabCentral', 'modalFeriado', 'modalCourier']) {
    const target = {
      matches: () => true,
      closest(selector) { return selector.includes('#' + id) ? { id } : null; }
    };
    assert.equal(c.appEditableDirtyScope(target), id);
  }
  const client = readProjectFile('IndexCoreScripts.html');
  assert.match(client, /remover.addEventListener\('click', function\(\) \{\s*appMarkUnsavedChanges\('modalPrestador'\)/);
  assert.match(client, /entrada.value = '';\s*appMarkUnsavedChanges\('modalPrestador'\)/);
});

function saveFixture() {
  const field = { id: 'nome', value: 'Original', matches: () => false };
  const modal = { dataset: { extraEditRevision: '1' }, querySelectorAll: () => [field] };
  const timers = [], closed = [];
  const c = vm.createContext({ document: { getElementById: () => modal }, APP_UNSAVED_SCOPES: { modalPrestador: true },
    setTimeout: callback => timers.push(callback), fecharOverlay: id => closed.push(id) });
  vm.runInContext(contentAccessibilitySource(['appExtraModalSnapshot_', 'appFinishExtraModalSave_',
    'appClearUnsavedChanges', 'appHasUnsavedChanges']), c);
  const snapshot = c.appExtraModalSnapshot_('modalPrestador');
  return { c, field, modal, timers, closed, snapshot };
}

test('salvamento confirmado limpa o estado e fecha sem pedir descarte', () => {
  const { c, timers, closed, snapshot } = saveFixture();
  c.appFinishExtraModalSave_('modalPrestador', snapshot, 900);
  assert.equal(c.appHasUnsavedChanges('modalPrestador'), false);
  timers[0]();
  assert.deepEqual(closed, ['modalPrestador']);
});

test('resposta de gravação preserva edição durante a RPC e não fecha outro formulário reaberto', () => {
  for (const change of ['value', 'session']) {
    const { c, field, modal, timers, snapshot } = saveFixture();
    if (change === 'value') field.value = 'Alterado durante RPC';
    else modal.dataset.extraEditRevision = '2';
    c.appFinishExtraModalSave_('modalPrestador', snapshot, 900);
    assert.equal(c.appHasUnsavedChanges('modalPrestador'), true);
    assert.equal(timers.length, 0);
  }
});

test('edição na pausa de fechamento mantém o formulário aberto', () => {
  const { c, timers, closed, snapshot } = saveFixture();
  c.appFinishExtraModalSave_('modalPrestador', snapshot, 900);
  c.APP_UNSAVED_SCOPES.modalPrestador = true;
  timers[0]();
  assert.deepEqual(closed, []);
});

test('validação do prestador aponta para entrada visível sem mudar o payload de e-mails', () => {
  const fn = contentAccessibilitySource(['salvarPrestadorApp']);
  assert.match(fn, /input: 'prestEmailEntry', error: 'errPrestEmail', label: 'E-mail', value: email/);
  assert.match(fn, /document.getElementById\('prestEmail'\).value.trim\(\)/);
  assert.match(fn, /email: email/);
});

test('gravação em andamento impede duplicação e fechamento e libera após o resultado', () => {
  const messages = [];
  const modal = { dataset: {}, querySelector: () => ({}) };
  const c = vm.createContext({ document: { getElementById: () => modal },
    appSetStatus: (target, message) => messages.push(message) });
  vm.runInContext(contentAccessibilitySource(['appBeginExtraModalSave_', 'appEndExtraModalSave_', 'fecharOverlay']), c);
  assert.equal(c.appBeginExtraModalSave_('modalPrestador'), true);
  assert.equal(c.appBeginExtraModalSave_('modalPrestador'), false);
  assert.equal(c.fecharOverlay('modalPrestador'), false);
  assert.match(messages.at(-1), /A gravação já foi enviada/);
  c.appEndExtraModalSave_('modalPrestador');
  assert.equal(c.appBeginExtraModalSave_('modalPrestador'), true);
});

test('cada cadastro libera o estado de gravação tanto no sucesso quanto na falha', () => {
  for (const [fn, id] of [['salvarPrestadorApp', 'modalPrestador'], ['salvarLabCentralApp', 'modalLabCentral'],
    ['salvarFeriadoApp', 'modalFeriado'], ['salvarCourierApp', 'modalCourier']]) {
    const source = contentAccessibilitySource([fn]);
    assert.match(source, new RegExp("if \\(!appBeginExtraModalSave_\\('" + id + "'\\)\\) return"));
    assert.equal(source.split("appEndExtraModalSave_('" + id + "')").length - 1, 2);
  }
});

test('erros, rodapés, status e dicas dos modais extras têm referências válidas', () => {
  const html = readProjectFile('IndexExtraModals.html');
  for (const tag of html.match(/<(?:input|select)[^>]+aria-describedby="[^"]+"[^>]*>/g)) {
    for (const id of tag.match(/aria-describedby="([^"]+)"/)[1].split(' ')) assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.equal((html.match(/class="courier-modal-actions extra-modal-actions"/g) || []).length, 3);
  for (const tag of html.match(/<div class="status-msg"[^>]+>/g)) {
    assert.match(tag, /role="status"/);
    assert.match(tag, /aria-live="polite"/);
  }
  assert.match(html, /data-rich-command="bold"/);
  assert.match(html, /data-rich-command="italic"/);
  assert.match(html, /data-rich-command="underline"/);
});

test('corrigir um campo limpa ambas as classes usadas para exibir seu erro', () => {
  const classes = new Set(['show', 'visible']);
  const c = vm.createContext({ document: { getElementById: () => ({ classList: { remove: name => classes.delete(name) } }) } });
  vm.runInContext(contentAccessibilitySource(['limparErro']), c);
  c.limparErro('prestEmpresa', 'errPrestEmpresa');
  assert.equal(classes.size, 0);
});
