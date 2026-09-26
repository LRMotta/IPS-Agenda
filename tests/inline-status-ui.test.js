'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function statusHarness(inModal = true) {
  const attributes = {};
  const el = {
    innerHTML: '', dataset: {},
    closest: () => inModal ? {} : null,
    hasAttribute: key => Object.hasOwn(attributes, key),
    setAttribute: (key, value) => { attributes[key] = value; },
    removeAttribute: key => { delete attributes[key]; }
  };
  const source = readProjectFile('IndexCoreScripts.html');
  const context = vm.createContext({
    document: { getElementById: () => el },
    esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  });
  vm.runInContext(source.slice(source.indexOf('function appSetInlineStatusMessage('), source.indexOf('function appSetButtonBusy(')), context);
  return { el, attributes, set: context.appSetInlineStatusMessage, setStatus: context.appSetStatus };
}

test('progresso anuncia o estado e permite erro, sucesso e limpeza subsequentes', () => {
  const { el, attributes, set } = statusHarness();
  set(el, 'Salvando…', 'info');
  assert.equal(el.dataset.appStatusRendered, 'loading');
  assert.match(el.innerHTML, /Salvando alterações…/);
  assert.equal(attributes['aria-live'], 'polite');
  assert.equal(attributes['aria-busy'], undefined);
  set(el, 'Falha ao salvar', 'error');
  assert.equal(el.dataset.appStatusRendered, 'danger');
  assert.doesNotMatch(el.innerHTML, /spinner/);
  set(el, 'Concluído', 'success');
  assert.match(el.innerHTML, /#137333/);
  assert.equal(el.dataset.appStatusRendered, '');
  set(el, '');
  assert.equal(el.innerHTML, '');
});

test('tipos explícitos prevalecem sobre verbos de progresso', () => {
  const { el, set, setStatus } = statusHarness();
  for (const type of ['error', 'danger', 'validation', 'warning', 'warn', 'success', 'ok']) {
    set(el, 'Carregando dados: operação interrompida', type);
    assert.notEqual(el.dataset.appStatusRendered, 'loading', type);
    assert.doesNotMatch(el.innerHTML, /spinner/);
  }
  setStatus(el, 'Salvando: falha de permissão', '#e53935');
  assert.equal(el.dataset.appStatusRendered, 'danger');
});

test('progresso inferido fica restrito aos modais e escapa texto recebido', () => {
  const { el, set } = statusHarness(false);
  set(el, 'Carregando dados', 'info');
  assert.doesNotMatch(el.innerHTML, /spinner/);
  set(el, 'Carregando <img src=x onerror=alert(1)>', 'loading');
  assert.equal(el.dataset.appStatusRendered, 'loading');
  assert.doesNotMatch(el.innerHTML, /<img/);
  assert.match(el.innerHTML, /&lt;img/);
});

test('avisos inline e progresso de modais compartilham o mesmo componente visual', () => {
  const styles = readProjectFile('IndexStyles.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const agenda = readProjectFile('IndexAgendaScripts.html');
  const estoque = readProjectFile('IndexEstoqueScripts.html');
  const modaisExtras = readProjectFile('IndexExtraModals.html');
  const modaisCadastro = readProjectFile('IndexContentAfterStock.html');
  const modaisAgenda = readProjectFile('IndexContentAfterDashboard.html');

  assert.match(styles, /\.app-inline-notice--danger\s*\{/);
  assert.match(styles, /\.app-inline-notice--warning\s*\{/);
  assert.match(styles, /\.app-inline-notice--loading\s*\{/);
  assert.match(styles, /\.app-inline-notice-spinner\s*\{/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /\.status-msg > span\[style\*="#e53935"\]/);
  assert.match(core, /function appSetInlineStatusMessage\(elOrId, msg, type, color\)/);
  assert.match(core, /isProgressMessage[\s\S]*\.modal-overlay/);
  assert.match(core, /carregando\|registrando\|recebendo/);
  assert.match(core, /Salvando alterações…/);
  assert.match(core, /Aguarde, estamos atualizando os dados\./);
  assert.doesNotMatch(core, /el\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(core, /appSetStatus\('statusMeuPerfil', 'Salvando alterações…'\)/);
  assert.match(core, /statusConfigCtms" class="status-msg jornada-ctms-config-status[\s\S]*jornada-ctms-config-actions/);
  assert.match(core, /statusReservaPreviaJornada" class="status-msg[\s\S]*jornada-reserve-actions/);
  assert.match(core, /appSetStatus\(status, 'Salvando configuração…'\)/);
  assert.match(core, /function appSetStatus\(elOrId, msg, color\)\s*\{[\s\S]*?appSetInlineStatusMessage\(elOrId, msg, type, color\)/);
  assert.match(core, /function setRequisicaoStatus\(msg, type\)\s*\{[\s\S]*?appSetInlineStatusMessage\(statusEl, msg, type\)/);
  assert.match(agenda, /function setAgendaStatus\(msg, type\)\s*\{[\s\S]*?appSetInlineStatusMessage\(el, msg, type\)/);
  assert.match(estoque, /appSetStatus\('statusItemInline', 'Salvando…'\)/);
  assert.match(estoque, /appSetStatus\('statusPedidoInline', 'Salvando…'\)/);
  assert.match(estoque, /status-msg" id="statusItemInline"[\s\S]*btnSalvarItemInline/);
  assert.match(estoque, /status-msg" id="statusExcecaoKit"[\s\S]*estoque-transfer-actions/);
  assert.match(modaisExtras, /status-msg" id="statusPrest"[\s\S]*btnSalvarPrest/);
  assert.match(modaisExtras, /status-msg" id="agendaReciboStatus"[\s\S]*agenda-recibo-actions/);
  assert.match(modaisCadastro, /status-msg" id="statusProj"[\s\S]*btnSalvarProj/);
  assert.match(modaisAgenda, /class="ag-modal-actions">\s*<button[^>]*id="btnSalvarAgenda"[\s\S]*?<\/button>\s*<div id="agendaStatusMsg"/);
  assert.doesNotMatch(modaisAgenda, /onclick="abrirDisplayAgendaFromForm\(\)"/);
  assert.match(modaisAgenda, /agendaCancelMotivoStatus[\s\S]*confirm-actions/);
  assert.match(modaisAgenda, /statusReqPreload"[\s\S]*req-preload-actions/);
});
