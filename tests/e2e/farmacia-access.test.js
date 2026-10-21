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
  await page.addScriptTag({ content: readProjectFile('SharedAccessRules.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '') });
  await page.addScriptTag({ content: `
    var CURRENT_ACCESS={ok:true,email:'admin@example.invalid',role:'admin',farmaciaAccess:'none'};
    var FARMACIA_REQUEST_ID=0, FARMACIA_STUDY_REQUEST_ID=0, USER_ADMIN_FARMACIA_CATALOG=[], CURRENT_PAGE='', APP_USER_NAVIGATED=false, pending=[], notices=[];
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
    ${contentAccessibilitySource(['appSyncNavAccessibility', 'toggleNavFarmacia', 'abrirFarmaciaView', 'farmaciaAccessLabel', 'applyFarmaciaAccess', 'carregarFarmacia', 'renderFarmaciaStudies', 'selecionarFarmaciaStudy',
      'renderUserFarmaciaStudies', 'collectUserFarmaciaStudies', 'farmaciaStudySelectionChanged', 'irPara',
      'profileDayOptionsHtml', 'profileMonthOptionsHtml', 'preencherSelectsAniversario', 'validarAniversarioCliente',
      'profileFormationOptionsHtml', 'preencherSelectFormacaoPerfil', 'abrirFormUsuarioAdmin', 'salvarUsuarioAdminApp'])}
    applyFarmaciaAccess();
  ` });
  return { page, errors };
}

test('acesso somente comum mantém menu, oferece somente estoque comum e reflete salvamento próprio', async () => {
  const browser = await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors} = await fixture(browser,390);
    await page.evaluate(() => {
      window.CURRENT_ACCESS.farmaciaCommonAccess='read'; window.applyFarmaciaAccess(); window.irPara('farmacia');
      window.pending.at(-1).success({farmaciaAccess:'none',farmaciaCommonAccess:'read',studies:[]});
    });
    assert.equal(await page.locator('#navFarmacia').evaluate(el => el.style.display),'');
    assert.equal(await page.locator('#farmaciaStudy option').count(),2);
    await page.locator('#farmaciaStudy').selectOption('@IPS_COMMON');
    await page.evaluate(() => window.pending.at(-1).success({study:{id:'@IPS_COMMON',nome:'Estoque comum do IPS'},farmaciaAccess:'read',restrictedAllowed:false}));
    assert.match(await page.locator('#farmaciaStudyDetail').innerText(),/saldo independente dos estudos/);
    await page.evaluate(() => {
      window.USERS_ADMIN_ROWS[0].farmaciaAccess='none';
      window.USERS_ADMIN_ROWS[0].farmaciaCommonAccess='read';
      window.USERS_ADMIN_ROWS[0].farmaciaCommonOriginal='read';
      window.abrirFormUsuarioAdmin(2);
    });
    await page.locator('#userAdminFarmaciaCommonAccess').selectOption('manage');
    await page.locator('#btnSalvarUsuarioAdmin').click();
    assert.equal(await page.evaluate(() => window.pending.at(-1).payload.farmaciaCommonOriginal),'read');
    await page.evaluate(() => window.pending.at(-1).success({email:'admin@example.invalid',farmaciaAccess:'none',farmaciaCommonAccess:'manage'}));
    assert.equal(await page.evaluate(() => window.CURRENT_ACCESS.farmaciaCommonAccess),'manage');
    assert.equal(await page.locator('#navFarmacia').evaluate(el => el.style.display),'');
    await page.evaluate(() => {window.CURRENT_ACCESS.farmaciaCommonAccess='none'; window.applyFarmaciaAccess();});
    assert.equal(await page.locator('#navFarmacia').evaluate(el => el.style.display),'');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('Farmácia: menu, autorização, resposta obsoleta e revogação em desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, errors } = await fixture(browser, width);
      await page.evaluate(() => { window.CURRENT_ACCESS.ok=false; window.applyFarmaciaAccess(); });
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS | UCS — Farmácia local');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(), 0);
      assert.equal(await page.locator('#navFarmacia').evaluate(el => el.style.display), 'none');
      assert.equal(await page.locator('#navFarmaciaSection').isVisible(), false);
      await page.evaluate(() => window.irPara('farmacia', { initial: true }));
      assert.equal(await page.evaluate(() => window.CURRENT_PAGE), 'agenda');
      assert.equal(await page.evaluate(() => window.pending.length), 0);
      await page.evaluate(() => { window.CURRENT_ACCESS.ok=true; window.CURRENT_ACCESS.farmaciaAccess = 'read'; window.applyFarmaciaAccess(); });
      assert.equal(await page.locator('#navFarmaciaSection').getByRole('button',{name:'Farmácia',exact:true}).count(), 1);
      assert.equal(await page.locator('#navFarmaciaSection #navFarmacia').count(), 1);
      assert.equal(await page.locator('#navFarmaciaSection').evaluate(el => el.style.display), '');
      if (width < 900) await page.locator('#mobileMenuBtn').click();
      assert.equal(await page.locator('#navFarmaciaSection .nav-section').innerText(), 'FARMÁCIA');
      assert.equal(await page.locator('#navFarmaciaSection .nav-section').isVisible(), true);
      await page.locator('#navFarmacia').click();
      await page.locator('[data-farmacia-view="stock"]').click();
      assert.equal(await page.locator('#page-farmacia').isVisible(), true);
      assert.match(await page.locator('#page-farmacia').innerText(), /Lotes, localização e saldos/);
      await page.evaluate(() => window.pending[0].success({ farmaciaAccess: 'read' }));
      assert.equal(await page.locator('#farmaciaStatus').innerText(), 'Estudos: Consulta. Estoque comum: Sem acesso.');
      await page.getByRole('button', { name: 'Revalidar acesso' }).click();
      await page.getByRole('button', { name: 'Revalidar acesso' }).click();
      await page.evaluate(() => { window.pending[2].success({ farmaciaAccess: 'manage' }); window.pending[1].success({ farmaciaAccess: 'read' }); });
      assert.equal(await page.locator('#farmaciaStatus').innerText(), 'Estudos: Responsável pela Farmácia. Estoque comum: Sem acesso.');
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'farmacia-access-' + width + '.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.getByRole('button', { name: 'Revalidar acesso' }).click();
      await page.evaluate(() => window.pending[3].failure({ message: 'Sem permissão' }));
      assert.equal(await page.locator('#navFarmaciaSection').evaluate(el=>el.style.display), '');
      assert.equal(await page.locator('#page-farmacia').isVisible(), true);
      assert.equal(await page.evaluate(() => window.CURRENT_PAGE), 'farmacia');
      assert.equal(await page.locator('#farmaciaStatus').innerText(), '');
      await page.evaluate(() => window.pending[2].success({ farmaciaAccess: 'manage' }));
      assert.equal(await page.evaluate(() => window.CURRENT_ACCESS.farmaciaAccess), 'none');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Admin revoga concessão própria de estoque e mantém acesso ao catálogo geral', async () => {
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
    assert.equal(await page.locator('#navFarmacia').evaluate(el => el.style.display), '');
    await page.evaluate(() => window.abrirFormUsuarioAdmin());
    assert.equal(await page.locator('#userAdminFarmaciaAccess').inputValue(), 'none');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Admin seleciona estudos e autorização restrita sem perder vínculos órfãos no desktop/celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, errors } = await fixture(browser, width);
      await page.evaluate(() => {
        window.USER_ADMIN_FARMACIA_CATALOG = [{ id: 'P1', nome: 'Estudo Aurora', codigo: 'A-01' }, { id: 'P2', nome: 'Estudo Horizonte', codigo: 'H-02' }];
        window.USERS_ADMIN_ROWS[0].farmaciaStudies = [{ studyId: 'OLD', restricted: true }];
        window.USERS_ADMIN_ROWS[0].farmaciaStudiesOriginal = '[{"studyId":"OLD","restricted":true}]';
        window.abrirFormUsuarioAdmin(2);
      });
      const aurora = page.locator('[data-farmacia-study="P1"]');
      const orphan = page.locator('[data-farmacia-study="OLD"]');
      assert.equal(await aurora.locator('.farmacia-study-restricted').isDisabled(), true);
      await aurora.locator('.farmacia-study-selected').check();
      assert.equal(await aurora.locator('.farmacia-study-restricted').isEnabled(), true);
      assert.equal(await aurora.locator('.farmacia-study-restricted').isChecked(), false);
      await aurora.locator('.farmacia-study-restricted').check();
      assert.equal(await orphan.locator('.farmacia-study-selected').isChecked(), true);
      assert.equal(await orphan.locator('.farmacia-study-restricted').isDisabled(), true);
      await page.locator('#userAdminFarmaciaAccess').selectOption('none');
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await aurora.scrollIntoViewIfNeeded();
      await page.locator('#modalUsuarioAdmin .modal-box').screenshot({ path: path.join(artifacts, 'farmacia-study-grants-' + width + '.png') });
      await page.locator('#btnSalvarUsuarioAdmin').click();
      const payload = await page.evaluate(() => window.pending[0].payload);
      assert.equal(payload.farmaciaStudiesOriginal, '[{"studyId":"OLD","restricted":true}]');
      assert.deepEqual(payload.farmaciaStudies, [{ studyId: 'P1', restricted: true }, { studyId: 'OLD', restricted: true }]);
      assert.equal(payload.farmaciaAccess, 'none', 'desativar nível geral preserva a seleção por estudo');
      await page.evaluate(() => window.pending[0].failure({ message: 'As permissões por estudo mudaram. Reabra o usuário antes de salvar.' }));
      assert.match(await page.locator('#statusUsuarioAdmin').innerText(), /permissões por estudo mudaram/);
      assert.equal(await aurora.locator('.farmacia-study-restricted').isChecked(), true);
      await aurora.locator('.farmacia-study-selected').uncheck();
      assert.equal(await aurora.locator('.farmacia-study-restricted').isChecked(), false);
      assert.equal(await aurora.locator('.farmacia-study-restricted').isDisabled(), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Farmácia mostra só estudos autorizados e descarta respostas de outra seleção e revalidação', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, errors } = await fixture(browser, width);
      await page.evaluate(() => { window.CURRENT_ACCESS.farmaciaAccess = 'read'; window.applyFarmaciaAccess(); window.irPara('farmacia'); });
      assert.equal(await page.locator('#farmaciaStudy').isDisabled(), true);
      await page.evaluate(() => window.pending[0].success({ farmaciaAccess: 'read', studies: [{ id: 'P1', nome: 'Estudo Aurora' }, { id: 'P2', nome: 'Estudo Horizonte' }] }));
      assert.equal(await page.locator('#farmaciaStudy option').count(), 3);
      await page.locator('#farmaciaStudy').selectOption('P1');
      await page.locator('#farmaciaStudy').selectOption('P2');
      assert.equal(await page.evaluate(() => window.pending[1].payload), 'P1');
      assert.equal(await page.evaluate(() => window.pending[2].payload), 'P2');
      await page.evaluate(() => {
        window.pending[2].success({ study: { id: 'P2', nome: 'Estudo Horizonte' }, farmaciaAccess: 'read', restrictedAllowed: false });
        window.pending[1].success({ study: { id: 'P1', nome: 'Estudo Aurora' }, farmaciaAccess: 'manage', restrictedAllowed: true });
      });
      assert.match(await page.locator('#farmaciaStudyDetail').innerText(), /Horizonte.*não autorizadas/);
      assert.doesNotMatch(await page.locator('#farmaciaStudyDetail').innerText(), /Aurora/);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'farmacia-studies-' + width + '.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.getByRole('button', { name: 'Revalidar acesso' }).click();
      assert.equal(await page.locator('#farmaciaStudyDetail').innerText(), '');
      await page.evaluate(() => { window.pending[3].success({ farmaciaAccess: 'read', studies: [] }); window.pending[2].success({ study: { id: 'P2', nome: 'Antigo' }, restrictedAllowed: true }); });
      assert.equal(await page.locator('#farmaciaStudy').isDisabled(), true);
      assert.equal(await page.locator('#farmaciaStudyDetail').innerText(), '');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
