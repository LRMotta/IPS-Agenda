'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

test('projeto configura BioSystem e Sepio, preserva múltiplas regras e permite remover', async () => {
  // Fixture isolada: rede bloqueada, somente funções reais do cadastro.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.route('**/*', route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = readProjectFile('IndexContentAfterStock.html');
    const start = html.indexOf('<div class="form-section" id="projetoCaixasSection">');
    const end = html.indexOf('<div class="form-section soa-project-section">', start);
    await page.setContent('<html lang="pt-BR"><head>' + readProjectFile('IndexStyles.html') + '</head><body><select id="pSituacaoEnvioAmostras"><option>Sim</option><option>Não</option></select>' + html.slice(start, end) + '</body></html>');
    await page.addScriptTag({ content: `
      var COURIERS_PROJ = [{id:'M1',nome:'Marken'}, {id:'O1',nome:'Ocasa'}];
      var LABORATORIOS_TRANSPORTE_PROJ = [{id:'L1',nome:'Lab Um'}, {id:'L2',nome:'Lab Dois'}];
      var _projetoCaixasTransporte = [], _projetoCaixasTransporteErro = '', _projetoCaixasTransporteSalvas = [];
      function esc(v) { return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
      function normSelectValue(v) { return String(v || '').toLowerCase(); }
      ${contentAccessibilitySource(['carregarProjetoCaixasTransporte_', 'renderProjetoCaixasTransporte_', 'adicionarProjetoCaixaTransporte', 'removerProjetoCaixaTransporte', 'alterarProjetoCaixaTransporte', 'validarProjetoCaixasTransporte_'])}
      carregarProjetoCaixasTransporte_('');
    ` });
    await page.getByRole('button', { name: 'Adicionar regra de caixa' }).click();
    await page.locator('#pCaixaCourier0').selectOption('M1');
    await page.locator('#pCaixaLab0').selectOption('L1');
    assert.match(await page.locator('#pCaixasTransporteList').innerText(), /Alterações pendentes/);
    await page.getByRole('button', { name: 'Adicionar regra de caixa' }).click();
    await page.locator('#pCaixaCourier1').selectOption('O1');
    await page.locator('#pCaixaLab1').selectOption('L2');
    assert.equal(await page.evaluate(() => window.validarProjetoCaixasTransporte_()), true);
    await page.evaluate(() => window.carregarProjetoCaixasTransporte_(JSON.stringify(window._projetoCaixasTransporte)));
    assert.equal(await page.locator('.project-box-rule-status.is-saved').count(), 2);
    await page.evaluate(() => { window._projetoCaixasTransporte.push({ ...window._projetoCaixasTransporte[0] }); window.renderProjetoCaixasTransporte_(); });
    assert.match(await page.locator('.project-box-rule-status').last().innerText(), /Alterações pendentes/);
    assert.equal(await page.evaluate(() => window.validarProjetoCaixasTransporte_()), false);
    await page.evaluate(() => { window._projetoCaixasTransporte.pop(); window.renderProjetoCaixasTransporte_(); });
    await page.locator('#pCaixaLab0').focus();
    await page.locator('#pCaixaLab0').selectOption('L2');
    assert.match(await page.locator('.project-box-rule-status').first().innerText(), /Alterações pendentes/);
    assert.equal(await page.locator('#pCaixaLab0').evaluate(el => document.activeElement === el), true);
    await page.locator('#pCaixaLab0').selectOption('L1');
    assert.match(await page.locator('.project-box-rule-status').first().innerText(), /Regra ativa/);
    assert.equal(await page.locator('#pCaixaCourier0').inputValue(), 'M1');
    assert.equal(await page.locator('#pCaixaLab1').inputValue(), 'L2');
    assert.match(await page.locator('#pCaixasTransporteList').innerText(), /BioSystem/);
    assert.match(await page.locator('#pCaixasTransporteList').innerText(), /Sepio/);
    await page.getByRole('button', { name: 'Remover regra' }).first().click();
    assert.equal(await page.locator('#pCaixaCourier0').inputValue(), 'O1');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
