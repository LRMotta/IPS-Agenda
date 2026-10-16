'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { transportBrowserFixture } = require('../helpers/transport-browser-fixture');

test('Transporte aplica BioSystem, remove efeito ao trocar combinação e conserva Sepio sem implicações documentais', async () => {
  // Browser plugin not available. HTML real, rede bloqueada e RPCs simuladas.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    const errors = await transportBrowserFixture(page);
    await page.evaluate(() => {
      window.state.options.caixasTransporteRegras = [
        { nomeAbreviado: 'Estudo A', courier: 'MARKEN', temperatura: 'AMBIENTE', destino: 'Lab A', tipoCaixa: 'BIOSYSTEM' },
        { nomeAbreviado: 'Estudo A', courier: 'OCASA', temperatura: 'AMBIENTE', destino: 'Lab A', tipoCaixa: 'SEPIO' }
      ];
      window.renderDerived();
    });
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'BioSystem');
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Sim');
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), true);
    assert.match(await page.locator('#caixaEspecialResumo').innerText(), /operacoes.cs@marken.com.*2 kg/);
    await page.evaluate(() => window.selectTemp('CONGELADO'));
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), false);
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Não');
    await page.evaluate(() => window.selectTemp('AMBIENTE'));
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'BioSystem');
    await page.evaluate(() => window.selectCourier('DHL'));
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Sim');
    await page.evaluate(() => window.selectCourier('OCASA'));
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'Sepio');
    assert.match(await page.locator('#caixaEspecialResumo').innerText(), /Mantidos o e-mail e o preenchimento/);
    assert.equal(await page.locator('#solicitarCaixaField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), false);
    await page.evaluate(() => { document.getElementById('destino').value = ''; window.renderDerived(); });
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('prévia conserva caixa histórica confirmada, troca de participante e recarga removem estado anterior', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = await transportBrowserFixture(page);
    await page.evaluate(() => {
      const p = window.collectPayload();
      window.state.registro.caixaTransporte = { confirmado: true, tipoCaixa: 'BIOSYSTEM', contexto: [p.idAgenda, p.agendaSlot, p.participanteCadastroId, p.paciente, p.protocolo, p.courier, p.temperatura, p.destino].map(window.norm) };
      window.state.options.caixasTransporteRegras = [];
      window.renderDerived();
    });
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'BioSystem');
    await page.evaluate(() => {
      window.state.registro = { ...window.state.registro, caixaTransporte: null, solicitarCaixa: 'Não' };
      window.renderAll({ skipCe: true });
      window.renderDerived();
    });
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), false);
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Não');
    const dimensions = await page.locator('body').evaluate(e => ({ client: e.clientWidth, scroll: e.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
