'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

test('couriers usam lista expansivel e mantem acoes acessiveis', () => {
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const styles = readProjectFile('IndexStyles.html');

  assert.match(content, /class="courier-list" id="bodyCouriers" aria-live="polite"/);
  assert.match(client, /return '<details class="courier-item">'/);
  assert.match(client, /data-record-action="edit"/);
  assert.match(client, /data-record-action="delete"/);
  assert.match(styles, /\.courier-item > summary/);
});

test('modal de courier agrupa configuracoes em persianas com acoes padrao', () => {
  const modal = readProjectFile('IndexExtraModals.html');
  const styles = readProjectFile('IndexStyles.html');

  assert.match(modal, /<details class="courier-form-panel" open>/);
  assert.match(modal, /<span>Confirmação e cobrança<\/span>/);
  assert.match(modal, /class="courier-modal-actions"/);
  assert.match(modal, /onclick="fecharOverlay\('modalCourier'\)">Cancelar/);
  assert.match(modal, /id="btnSalvarCourier"/);
  assert.match(styles, /\.courier-modal-actions \.btn-save/);
});
