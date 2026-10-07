'use strict';
/* global window */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

test('editar usuário envia identidade original separada e novo cadastro limpa a identidade', async () => {
  // Browser plugin not available. Fixture local com RPC simulada e rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    await page.route('**/*', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await page.setContent('<!doctype html><html><head><title>IPS — identidade do usuário</title>' +
      readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
      '</head><body><button id="edit" onclick="abrirFormUsuarioAdmin(2)">Editar Maria</button>' +
      '<button id="new" onclick="abrirFormUsuarioAdmin()">Novo usuário</button>' +
      readProjectFile('IndexContentAfterStock.html') + '</body></html>');
    await page.addScriptTag({ content: `
      var USERS_ADMIN_ROWS = [{rowIndex:2,email:'maria@example.invalid',name:'Maria',role:'user',ativo:'Sim',podeSolicitarExames:'Sim'}];
      var USER_PROFILE_FORMACOES = [], PROFILE_MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      function esc(value) { return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
      function abrirOverlay(id) { document.getElementById(id).removeAttribute('inert'); document.getElementById(id).classList.add('open'); }
      function fecharOverlay(id) { document.getElementById(id).classList.remove('open'); document.getElementById(id).setAttribute('inert',''); }
      function fecharModalSeClicouFora() {}
      function limparErro() {}
      function snack() {}
      function carregarUsersAdmin() {}
      function appErrorMessage(error) { return error.message; }
      var rpc = {withSuccessHandler(fn) {this.success=fn; return this;},withFailureHandler(fn) {this.failure=fn; return this;},
        salvarUsuarioAdmin(payload) { window.savedPayload=payload; this.failure({message:'O usuário desta linha mudou. Recarregue a lista e reabra o cadastro.'}); }};
      var google = {script:{run:rpc}};
      ${contentAccessibilitySource(['profileDayOptionsHtml', 'profileMonthOptionsHtml', 'preencherSelectsAniversario',
        'validarAniversarioCliente', 'profileFormationOptionsHtml', 'preencherSelectFormacaoPerfil',
        'abrirFormUsuarioAdmin', 'salvarUsuarioAdminApp'])}
    ` });
    assert.equal(page.url(), 'about:blank');
    assert.equal(await page.title(), 'IPS — identidade do usuário');
    assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
    await page.locator('#edit').click();
    assert.equal(await page.locator('#userAdminOriginalEmail').inputValue(), 'maria@example.invalid');
    await page.locator('#userAdminEmail').fill('novo@example.invalid');
    await page.locator('#btnSalvarUsuarioAdmin').click();
    const payload = await page.evaluate(() => window.savedPayload);
    assert.equal(payload.originalEmail, 'maria@example.invalid');
    assert.equal(payload.email, 'novo@example.invalid');
    assert.equal(payload.rowIndex, '2');
    assert.ok((await page.locator('#statusUsuarioAdmin').innerText()).includes('linha mudou'));
    assert.equal(await page.locator('#btnSalvarUsuarioAdmin').isEnabled(), true);
    assert.equal(await page.locator('#modalUsuarioAdmin').evaluate(el => el.classList.contains('open')), true);
    const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
    fs.mkdirSync(artifacts, { recursive: true });
    await page.locator('#modalUsuarioAdmin .modal-box').screenshot({ path: path.join(artifacts, 'users-admin-identity.png') });
    await page.evaluate(() => window.fecharOverlay('modalUsuarioAdmin'));
    await page.locator('#new').click();
    assert.equal(await page.locator('#userAdminOriginalEmail').inputValue(), '');
    assert.equal(await page.locator('#userAdminRowIndex').inputValue(), '');
    assert.equal(await page.locator('#userAdminEmail').inputValue(), '');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
