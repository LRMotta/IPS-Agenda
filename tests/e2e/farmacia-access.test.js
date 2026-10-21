'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

async function fixture(browser, width) {
  // Browser plugin not available. Shell real, serviços simulados e rede bloqueada.
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/*', request => request.abort());
  // Logotipo remoto não é necessário para esta fixture sem rede.
  const content = readProjectFile('IndexContent.html').replace(/<img\b[^>]*>/g, '<span>IPS | UCS</span>');
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS | UCS — Farmácia local</title>' +
    readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
    '<style>.material-symbols-outlined{font-size:0!important}</style></head><body>' + content +
    readProjectFile('IndexContentAfterDashboard.html') + readProjectFile('IndexContentAfterStock.html') + '</body></html>');
  await page.addScriptTag({ content: readProjectFile('SharedAccessRules.html').replace(/<\/?script>/g, '') });
  await page.addScriptTag({ content: `
    var CURRENT_ACCESS={ok:true,email:'admin@example.invalid',role:'admin',farmaciaAccess:'none'};
    var FARMACIA_REQUEST_ID=0, CURRENT_PAGE='', APP_USER_NAVIGATED=false, pending=[], notices=[];
    var USERS_ADMIN_ROWS=[{rowIndex:2,email:'admin@example.invalid',name:'Admin',role:'admin',ativo:'Sim',farmaciaAccess:'read'}];
    var USER_PROFILE_FORMACOES=[], PROFILE_MONTH_NAMES=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    function esc(value) { return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    function snack(value) { notices.push(value); }
    function appErrorMessage(error) { return error.message; }
    function appConfirmNavigationIfDirty() { return true; }
    function isEmbeddedModuleEnabled() { return false; }
    function setCurrentPage(page) { return CURRENT_PAGE=page; }
    function getCurrentPage() { return CURRENT_PAGE; }
    function getRoutePageConfig(page) { return {label:page==='farmacia'?'Farmácia':page,icon:''}; }
    function appSyncNavAccessibility() {}
    function resetAppScrollPosition() {}
    function updateFloatingAddButton() {}
    function closeMobileNav() { document.body.classList.remove('mobile-nav-open'); }
    function toggleMobileNav() { document.body.classList.toggle('mobile-nav-open'); }
    function carregarAniversariosAgenda_() {}
    function initAgendaV1() {}
    function carregarUsersAdmin() {}
    function invalidarReferenciasUsuarios() {}
    function appApplyTeamBirthdays_() {}
    function abrirOverlay(id) { document.getElementById(id).removeAttribute('inert'); document.getElementById(id).classList.add('open'); }
    function fecharOverlay(id) { document.getElementById(id).classList.remove('open'); document.getElementById(id).setAttribute('inert',''); }
    function fecharModalSeClicouFora() {}
    function limparErro() {}
    function runner(success,failure) { return new Proxy({}, {get(target,method) {
      if(method==='withSuccessHandler') return fn=>runner(fn,failure);
      if(method==='withFailureHandler') return fn=>runner(success,fn);
      return payload=>pending.push({method,payload,success,failure});
    }}); }
    var google={script:{run:runner()}};
    ${contentAccessibilitySource(['farmaciaAccessLabel', 'applyFarmaciaAccess', 'carregarFarmacia', 'irPara',
      'profileDayOptionsHtml', 'profileMonthOptionsHtml', 'preencherSelectsAniversario', 'validarAniversarioCliente',
      'profileFormationOptionsHtml', 'preencherSelectFormacaoPerfil', 'abrirFormUsuarioAdmin', 'salvarUsuarioAdminApp'])}
    applyFarmaciaAccess();
  ` });
  return { page, errors };
}

test('Farmácia: menu, autorização, resposta obsoleta e revogação em desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, errors } = await fixture(browser, width);
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS | UCS — Farmácia local');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(), 0);
      assert.equal(await page.locator('#navFarmacia').evaluate(el => el.style.display), 'none');
      await page.evaluate(() => window.irPara('farmacia', { initial: true }));
      assert.equal(await page.evaluate(() => window.CURRENT_PAGE), 'agenda');
      assert.equal(await page.evaluate(() => window.pending.length), 0);
      await page.evaluate(() => { window.CURRENT_ACCESS.farmaciaAccess = 'read'; window.applyFarmaciaAccess(); });
      if (width < 900) await page.locator('#mobileMenuBtn').click();
      await page.locator('#navFarmacia').click();
      assert.equal(await page.locator('#page-farmacia').isVisible(), true);
      assert.match(await page.locator('#page-farmacia').innerText(), /Área em preparação/);
      await page.evaluate(() => window.pending[0].success({ farmaciaAccess: 'read' }));
      assert.equal(await page.locator('#farmaciaStatus').innerText(), 'Seu acesso: Consulta.');
      await page.getByRole('button', { name: 'Revalidar acesso' }).click();
      await page.getByRole('button', { name: 'Revalidar acesso' }).click();
      await page.evaluate(() => { window.pending[2].success({ farmaciaAccess: 'manage' }); window.pending[1].success({ farmaciaAccess: 'read' }); });
      assert.equal(await page.locator('#farmaciaStatus').innerText(), 'Seu acesso: Responsável pela Farmácia.');
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'farmacia-access-' + width + '.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.getByRole('button', { name: 'Revalidar acesso' }).click();
      await page.evaluate(() => window.pending[3].failure({ message: 'Sem permissão' }));
      assert.equal(await page.locator('#page-farmacia').isVisible(), false);
      assert.equal(await page.evaluate(() => window.CURRENT_PAGE), 'agenda');
      assert.equal(await page.locator('#farmaciaStatus').innerText(), '');
      await page.evaluate(() => window.pending[2].success({ farmaciaAccess: 'manage' }));
      assert.equal(await page.evaluate(() => window.CURRENT_ACCESS.farmaciaAccess), 'none');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Admin edita concessão de Farmácia, salva e revoga o próprio menu', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, errors } = await fixture(browser, 390);
    await page.evaluate(() => { window.CURRENT_ACCESS.farmaciaAccess = 'read'; window.applyFarmaciaAccess(); window.abrirFormUsuarioAdmin(2); });
    assert.equal(await page.locator('#userAdminFarmaciaAccess').inputValue(), 'read');
    await page.locator('#userAdminFarmaciaAccess').selectOption('manage');
    await page.locator('#userAdminFarmaciaAccess').scrollIntoViewIfNeeded();
    const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
    fs.mkdirSync(artifacts, { recursive: true });
    await page.locator('#modalUsuarioAdmin .modal-box').screenshot({ path: path.join(artifacts, 'farmacia-user-access.png') });
    await page.locator('#btnSalvarUsuarioAdmin').click();
    assert.equal(await page.evaluate(() => window.pending[0].payload.farmaciaAccess), 'manage');
    await page.evaluate(() => window.pending[0].success({ email: 'admin@example.invalid', farmaciaAccess: 'manage' }));
    assert.equal(await page.evaluate(() => window.CURRENT_ACCESS.farmaciaAccess), 'manage');
    await page.evaluate(() => window.abrirFormUsuarioAdmin(2));
    await page.locator('#userAdminFarmaciaAccess').selectOption('none');
    await page.locator('#btnSalvarUsuarioAdmin').click();
    await page.evaluate(() => window.pending[1].success({ email: 'admin@example.invalid', farmaciaAccess: 'none' }));
    assert.equal(await page.locator('#navFarmacia').evaluate(el => el.style.display), 'none');
    await page.evaluate(() => window.abrirFormUsuarioAdmin());
    assert.equal(await page.locator('#userAdminFarmaciaAccess').inputValue(), 'none');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
