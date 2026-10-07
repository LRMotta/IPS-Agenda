'use strict';
/* global window, document */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

test('atalhos antigos direcionam manutenção a Usuários e recebimentos preservam responsável histórico', async () => {
  // Browser plugin not available. Fixture local; RPCs não usadas e rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    await page.route('**/*', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await page.setContent(`<!doctype html><html><head><title>IPS — solicitantes em Usuários</title>
      <style>body{font:18px system-ui;margin:40px;color:#19304e}button,select{font:inherit;padding:12px;margin:12px 12px 12px 0}section{padding:20px;border:1px solid #ccd8e6;border-radius:12px;max-width:850px}#notice{color:#a42525}</style></head><body>
      <h1>Manutenção de solicitantes</h1><section>
      <button id="edit" onclick="abrirFormSolicitante()">Editar solicitante (atalho antigo)</button>
      <button id="delete" onclick="confirmarExcluirSol('SOL-1','Histórico')">Excluir (atalho antigo)</button>
      <h2 id="route">Solicitantes</h2><p id="notice" role="status"></p>
      <label for="eqResponsavelReceb">Responsável pelo recebimento</label><br><select id="eqResponsavelReceb"></select>
      </section></body></html>`);
    await page.addScriptTag({ content: `
      var CURRENT_ACCESS = {ok:true,role:'admin'};
      function irPara(page) { if(page !== 'usuarios') throw new Error('Rota inesperada'); document.getElementById('route').textContent='Usuários'; }
      function snackErro(message) { document.getElementById('notice').textContent=message; }
      ${contentAccessibilitySource(['abrirCadastroSolicitantesEmUsuarios', 'abrirFormSolicitante', 'confirmarExcluirSol', 'fillSelectOptions', 'normSelectValue', 'codexNormText'])}
      fillSelectOptions('eqResponsavelReceb',['Ana','Bia'],'Responsável histórico');
    ` });
    assert.equal(page.url(), 'about:blank');
    assert.equal(await page.title(), 'IPS — solicitantes em Usuários');
    assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
    assert.equal(await page.locator('#eqResponsavelReceb').inputValue(), 'Responsável histórico');
    assert.deepEqual(await page.locator('#eqResponsavelReceb option').allTextContents(), ['— Selecione —', 'Ana', 'Bia', 'Responsável histórico']);
    await page.locator('#edit').click();
    assert.equal(await page.locator('#route').innerText(), 'Usuários');
    await page.locator('#delete').click();
    assert.equal(await page.locator('#route').innerText(), 'Usuários');
    await page.evaluate(() => { window.CURRENT_ACCESS.role = 'user'; document.getElementById('route').textContent = 'Solicitantes'; });
    await page.locator('#edit').click();
    assert.equal(await page.locator('#route').innerText(), 'Solicitantes');
    assert.ok((await page.locator('#notice').innerText()).includes('administrador'));
    const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'solicitantes-users-migration.png'), fullPage: false });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('requisição preenchida aguarda atualização de solicitantes e permite tentar novamente após falha', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    await page.route('**/*', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await page.setContent('<!doctype html><html><head><title>IPS — atualização de solicitantes</title></head><body>' +
      '<h1>Requisição preenchida</h1><label>Solicitante <input id="rqSolicitante" value="Ana"></label>' +
      '<div id="card"><span id="cardName"></span><span id="cardDetail"></span></div>' +
      '<button id="generate" onclick="gerarRequisicao()">Gerar requisição</button><p id="status" role="status"></p></body></html>');
    await page.addScriptTag({ content: `
      var _rqSolicitantesRequestId=0, _rqSolicitantesState='ready', _rqSolicitantesLoaded=true;
      var _rqSolicitantes=[], _rqSolicitantesNomes=[], _rqAcOptionsCache={}, _rqParticipantes=[], _rqPrestadores=[];
      var pending=[];
      function appServerRun(request) { if(request.method !== 'buscarSolicitantesCompleto') throw new Error('Geração indevida'); pending.push(request); }
      function preencherSolicitanteUsuarioAtual() {} function flushRequisicaoLoadCallbacks() {} function snackErro() {}
      function appErrorMessage(error) { return error.message; }
      function requisicaoEl(key) { return document.getElementById({gerarBtn:'generate',status:'status',solicitanteCard:'card',solicitanteCardNome:'cardName',solicitanteCardDetalhe:'cardDetail'}[key]); }
      function setRequisicaoStatus(message) { document.getElementById('status').textContent=message; }
      function requisicaoMissingRequiredChecks() { return []; } function requisicaoRequiredValues() { return []; }
      ${contentAccessibilitySource(['rqLookupKey', 'rqLookupEmail', 'rqIndexBy', 'rebuildRequisicaoLookups',
        'carregarSolicitantesRequisicao', 'updateRequisicaoGenerateAvailability', 'gerarRequisicao', 'preencherDadosSolicitante'])}
      carregarSolicitantesRequisicao();
    ` });
    assert.equal(page.url(), 'about:blank');
    assert.equal(await page.title(), 'IPS — atualização de solicitantes');
    assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
    await page.locator('#generate').click({ force: true });
    assert.ok((await page.locator('#status').innerText()).includes('Aguarde'));
    assert.equal(await page.evaluate(() => window.pending.length), 1);
    await page.evaluate(() => window.pending[0].onFailure(new Error('Falha simulada')));
    assert.ok((await page.locator('#status').innerText()).includes('tentar novamente'));
    await page.locator('#generate').click({ force: true });
    assert.equal(await page.evaluate(() => window.pending.length), 2);
    await page.evaluate(() => window.pending[1].onSuccess([{nome:'Ana',formacao:'Médico(a)',registro:'CRM atual'}]));
    assert.equal(await page.locator('#generate').getAttribute('aria-disabled'), 'false');
    assert.equal(await page.locator('#cardDetail').innerText(), 'Médico(a) · CRM atual');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
