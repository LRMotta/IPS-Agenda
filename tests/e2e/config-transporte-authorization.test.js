'use strict';
/* global window, document */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

const source = contentAccessibilitySource([
  'configGrupoTransporte_', 'renderTabelaConfig', 'bindTableRecordActions', 'configValoresUnicos',
  'preencherSelectConfig', 'onConfigBlocoChange', 'onConfigGrupoChange', 'abrirFormConfig',
  'salvarConfigApp', 'enviarConfigApp_', 'confirmarExcluirConfig', 'abrirConfirmacaoDestrutiva', 'fecharModalSeClicouFora', 'norm'
]);
const stock = readProjectFile('IndexContentAfterStock.html');
const modal = stock.slice(stock.indexOf('<div class="modal-overlay" id="modalConfig"'), stock.indexOf('<div class="modal-overlay" id="modalConfigAjuda"'));
const confirmation = stock.slice(stock.indexOf('<div class="modal-overlay" id="confirmDel"'), stock.indexOf('<div class="modal-overlay" id="confirmPartDuplicate"'));

for (const width of [1280, 390]) test('ConfigApp Transporte: confirmar/cancelar preserva permissoes em ' + width + 'px', async () => {
  // Browser plugin indisponivel: HTML/CSS reais, RPCs simuladas e rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) errors.push(message.text()); });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — ConfigApp local</title>' +
      readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
      '</head><body><h1>Configurações</h1><table><tbody id="bodyConfig"></tbody></table>' + modal + confirmation + '</body></html>');
    await page.addScriptTag({ content: `
      var CURRENT_ACCESS = {}, requests = [];
      var CONFIG_APP_CHAVES_DISPONIVEIS = {};
      var _configApp = [
        { rowIndex: 2, startCol: 1, bloco: 'Principal', grupo: 'Transporte', chave: 'Peso', valor: '1', ativo: 'Sim' },
        { rowIndex: 3, startCol: 1, bloco: 'Principal', grupo: 'Agenda', chave: 'Status', valor: 'Pendente', ativo: 'Sim' }
      ];
      function esc(value) { var el = document.createElement('div'); el.textContent = String(value || ''); return el.innerHTML; }
      function simNaoChip(value) { return esc(value); }
      function appSetStatus(id, text) { document.getElementById(id).textContent = text; }
      function appRequiredFeedback() { return true; }
      function appErrorMessage(error) { return error.message; }
      function limparErro() {}
      function abrirOverlay(id) { var el = document.getElementById(id); el.removeAttribute('inert'); el.classList.add('open'); }
      function fecharOverlay(id) { var el = document.getElementById(id); el.classList.remove('open'); el.setAttribute('inert', ''); }
      function runner() { return new Proxy({}, { get: function(_target, method) {
        if (method === 'withSuccessHandler' || method === 'withFailureHandler') return function() { return runner(); };
        return function() { requests.push({ method: method, args: Array.prototype.slice.call(arguments) }); };
      } }); }
      var google = { script: { run: runner() } };
      ${source}
    ` });
    assert.equal(await page.title(), 'IPS — ConfigApp local');
    assert.ok((await page.locator('body').innerText()).includes('Configurações'));
    for (const role of ['user', 'admin']) {
      await page.evaluate(role => {
        window.CURRENT_ACCESS = { ok: true, role, canWrite: true };
        window.requests = [];
        window.fecharOverlay('modalConfig'); window.fecharOverlay('confirmDel');
        window.renderTabelaConfig(window._configApp);
      }, role);
      await page.locator('#bodyConfig tr').first().getByTitle('Editar', { exact: true }).click();
      await page.locator('#cfgValor').fill('2,5');
      await page.locator('#btnSalvarCfg').click();
      assert.match(await page.locator('#confirmDelTitle').innerText(), /Confirmar alteração/);
      assert.match(await page.locator('#confirmDelMsg').innerText(), /2,5.*documentação de transporte/);
      assert.equal(await page.evaluate(() => window.requests.length), 0);
      await page.locator('#confirmDel').getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.equal(await page.evaluate(() => window.requests.length), 0);
      assert.equal(await page.locator('#cfgValor').inputValue(), '2,5');
      await page.locator('#btnSalvarCfg').click();
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'config-transporte-confirmacao-' + width + '.png') });
      await page.evaluate(() => { document.getElementById('cfgValor').value = '999'; });
      await page.locator('#btnConfirmDel').click();
      const save = await page.evaluate(() => window.requests[0]);
      assert.equal(save.method, 'salvarConfigAppItem');
      assert.equal(save.args[0].valor, '2,5', 'envia o valor revisado na confirmacao');
      assert.equal(save.args[0].confirmarAlteracaoTransporte, true);

      await page.evaluate(() => { window.requests = []; window.fecharOverlay('modalConfig'); });
      await page.locator('#bodyConfig tr').first().getByTitle('Excluir', { exact: true }).click();
      assert.match(await page.locator('#confirmDelMsg').innerText(), /documentação de transporte/);
      assert.equal(await page.evaluate(() => window.requests.length), 0);
      await page.locator('#confirmDel').getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.equal(await page.evaluate(() => window.requests.length), 0);
      await page.locator('#bodyConfig tr').first().getByTitle('Excluir', { exact: true }).click();
      await page.locator('#btnConfirmDel').click();
      const removal = await page.evaluate(() => window.requests[0]);
      assert.equal(removal.method, 'excluirConfigAppItem');
      assert.deepEqual(removal.args, [2, 1, { confirmarAlteracaoTransporte: true }]);

      await page.evaluate(() => { window.requests = []; window.abrirFormConfig(window._configApp[0]); });
      await page.locator('#cfgGrupo').selectOption('Agenda');
      await page.locator('#cfgChave').selectOption('Status');
      await page.locator('#btnSalvarCfg').click();
      assert.equal(await page.evaluate(() => window.requests.length), 0, 'trocar o grupo original tambem pede confirmacao');
      await page.locator('#confirmDel').getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.evaluate(() => window.abrirFormConfig(window._configApp[1]));
      await page.locator('#btnSalvarCfg').click();
      assert.equal(await page.evaluate(() => window.requests.length), 1, 'outro grupo mantem o fluxo existente');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('ConfigApp: primeira linha de Transporte / Autorizado a peticionar pelo formulário, com confirmação', async () => {
  // Catálogo real de chaves do app: a lista ainda não tem nenhuma linha em Config_App.
  const core = readProjectFile('IndexCoreScripts.html');
  const catalogo = core.slice(core.indexOf('var CONFIG_APP_CHAVES_DISPONIVEIS = {'), core.indexOf('function carregarConfigApp('));
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) errors.push(message.text()); });
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — ConfigApp local</title>' +
      readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
      '</head><body><h1>Configurações</h1><table><tbody id="bodyConfig"></tbody></table>' + modal + confirmation + '</body></html>');
    await page.addScriptTag({ content: `
      var CURRENT_ACCESS = { ok: true, role: 'admin', canWrite: true }, requests = [];
      ${catalogo}
      var _configApp = [
        { rowIndex: 2, startCol: 1, bloco: 'Principal', grupo: 'Transporte', chave: 'Agendado por', valor: 'Pessoa', ativo: 'Sim' },
        { rowIndex: 3, startCol: 1, bloco: 'Principal', grupo: 'Agenda', chave: 'Status courier', valor: 'Pendente', ativo: 'Sim' }
      ];
      function esc(value) { var el = document.createElement('div'); el.textContent = String(value || ''); return el.innerHTML; }
      function simNaoChip(value) { return esc(value); }
      function appSetStatus(id, text) { document.getElementById(id).textContent = text; }
      function appRequiredFeedback() { return true; }
      function appErrorMessage(error) { return error.message; }
      function limparErro() {}
      function abrirOverlay(id) { var el = document.getElementById(id); el.removeAttribute('inert'); el.classList.add('open'); }
      function fecharOverlay(id) { var el = document.getElementById(id); el.classList.remove('open'); el.setAttribute('inert', ''); }
      function runner() { return new Proxy({}, { get: function(_target, method) {
        if (method === 'withSuccessHandler' || method === 'withFailureHandler') return function() { return runner(); };
        return function() { requests.push({ method: method, args: Array.prototype.slice.call(arguments) }); };
      } }); }
      var google = { script: { run: runner() } };
      ${source}
    ` });
    await page.evaluate(() => window.abrirFormConfig({}));
    await page.locator('#cfgGrupo').selectOption('Transporte');
    const chaves = await page.locator('#cfgChave option').allTextContents();
    assert.ok(chaves.includes('Autorizado a peticionar'), 'chave oferecida sem linhas cadastradas: ' + chaves.join(', '));
    await page.locator('#cfgChave').selectOption('Autorizado a peticionar');
    await page.locator('#cfgValor').fill('lrmotta@ucs.br');
    await page.locator('#btnSalvarCfg').click();
    // Grupo Transporte: confirmação antes de gravar.
    assert.match(await page.locator('#confirmDelTitle').innerText(), /Confirmar/);
    assert.equal(await page.evaluate(() => window.requests.length), 0);
    await page.locator('#btnConfirmDel').click();
    const save = await page.evaluate(() => window.requests[0]);
    assert.equal(save.method, 'salvarConfigAppItem');
    assert.deepEqual([save.args[0].grupo, save.args[0].chave, save.args[0].valor, save.args[0].ativo, save.args[0].confirmarAlteracaoTransporte],
      ['Transporte', 'Autorizado a peticionar', 'lrmotta@ucs.br', 'Sim', true]);
    assert.ok(!save.args[0].rowIndex, 'linha nova');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
