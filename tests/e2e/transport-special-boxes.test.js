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
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Sim, BioSystem');
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), true);
    assert.match(await page.locator('#caixaEspecialResumo').innerText(), /operacoes.cs@marken.com.*2 kg/);
    await page.evaluate(() => window.selectTemp('CONGELADO'));
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), false);
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Não');
    await page.evaluate(() => window.selectTemp('AMBIENTE'));
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'BioSystem');
    await page.evaluate(() => {
      window.state.options.caixasTransporteRegras.push({ nomeAbreviado: 'Estudo A', courier: 'MARKEN', temperatura: 'REFRIGERADO', destino: 'Lab A', tipoCaixa: 'CREDO_CUBE' });
      window.selectTemp('REFRIGERADO');
    });
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'Crēdo Cube');
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Sim, Crēdo Cube');
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), true);
    assert.match(await page.locator('#caixaEspecialResumo').innerText(), /protocolos\.credo@marken\.com.*5 kg.*Sem gelo seco/);
    // Quarta 11/11/2026: sexta conta 2 dias úteis; feriado na quinta e fim de semana não contam.
    assert.equal(await page.evaluate(() => window.transportDiasUteisAte('2026-11-11', '2026-11-13', {})), 2);
    assert.equal(await page.evaluate(() => window.transportDiasUteisAte('2026-11-11', '2026-11-12', {})), 1);
    assert.equal(await page.evaluate(() => window.transportDiasUteisAte('2026-11-11', '2026-11-13', { '2026-11-12': true })), 1);
    assert.equal(await page.evaluate(() => window.transportDiasUteisAte('2026-11-13', '2026-11-16', {})), 1);
    assert.equal(await page.evaluate(() => window.transportDiasUteisAte('2026-11-11', '2026-11-13', { '--11-12': true })), 1);
    const prazo = /pelo menos 2 dias úteis de antecedência/;
    await page.evaluate(() => { document.getElementById('dataEnvio').value = new Date().toLocaleDateString('en-CA'); window.renderDerived(); });
    assert.match(await page.locator('body').innerText(), prazo);
    await page.evaluate(() => { document.getElementById('dataEnvio').value = new Date(Date.now() + 30 * 864e5).toLocaleDateString('en-CA'); window.renderDerived(); });
    assert.doesNotMatch(await page.locator('body').innerText(), prazo);
    await page.evaluate(() => window.selectTemp('CONGELADO'));
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Não');
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), false);
    await page.evaluate(() => window.selectTemp('AMBIENTE'));
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
      window.state.registro.solicitarCaixa = 'Sim';
      window.state.registro.caixaTransporte = { confirmado: true, tipoCaixa: 'BIOSYSTEM', contexto: [p.idAgenda, p.agendaSlot, p.participanteCadastroId, p.paciente, p.protocolo, p.courier, p.temperatura, p.destino].map(window.norm) };
      window.state.options.caixasTransporteRegras = [];
      window.renderAll({ skipCe: true });
      window.renderDerived();
    });
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'BioSystem');
    await page.evaluate(() => { document.getElementById('destino').value = ''; window.renderDerived(); });
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Não');
    await page.evaluate(() => {
      window.state.registro = { ...window.state.registro, caixaTransporte: null, solicitarCaixa: 'Não' };
      window.renderAll({ skipCe: true });
      window.renderDerived();
    });
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').isDisabled(), true);
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Não');
    const dimensions = await page.locator('body').evaluate(e => ({ client: e.clientWidth, scroll: e.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

async function caixaConfirmada(page, tipoCaixa) {
  await page.evaluate(tipo => {
    const p = window.collectPayload();
    window.state.registro.solicitarCaixa = 'Não';
    window.state.registro.caixaTransporte = { confirmado: true, tipoCaixa: tipo, contexto: [p.idAgenda, p.agendaSlot, p.participanteCadastroId, p.paciente, p.protocolo, p.courier, p.temperatura, p.destino].map(window.norm) };
    window.state.options.caixasTransporteRegras = [];
    window.renderAll({ skipCe: true });
    window.renderDerived();
  }, tipoCaixa);
}

test('Reavaliar caixa pede confirmação, volta à caixa normal e exige refazer PDF e rascunho', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = await transportBrowserFixture(page, { fromAgenda: true });
    await caixaConfirmada(page, 'CREDO_CUBE');
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'Crēdo Cube');
    assert.match(await page.locator('#caixaReavaliarResumo').innerText(), /difere da caixa confirmada/);

    await page.locator('#btnReavaliarCaixa').click();
    assert.match(await page.locator('#confirmCaixaReavaliarModal').innerText(), /PDF e rascunho já gerados precisam ser refeitos/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#confirmCaixaReavaliarModal').isVisible(), false);
    assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'reavaliarCaixaTransporte')), false);

    // Falha do servidor conserva a caixa confirmada e não sugere refazer documentos.
    await page.locator('#btnReavaliarCaixa').click();
    await page.locator('#btnConfirmarCaixaReavaliar').click();
    await page.evaluate(() => window.calls.find(call => call.method === 'reavaliarCaixaTransporte').failure(new Error('Revise as caixas especiais no cadastro do projeto.')));
    assert.equal(await page.locator('#caixaEspecial').inputValue(), 'Crēdo Cube');
    assert.match(await page.locator('#actionStatus').innerText(), /Revise as caixas/);
    assert.doesNotMatch(await page.locator('body').innerText(), /Caixa reavaliada/);

    const chaveAntes = await page.evaluate(() => window.transportGenerationStorageKey(window.collectPayload()));
    await page.evaluate(() => { window.calls.length = 0; window.state.lastPdfResult = { type: 'pdf', fileName: 'antigo.pdf' }; });
    await page.locator('#btnReavaliarCaixa').click();
    await page.locator('#btnConfirmarCaixaReavaliar').click();
    const enviado = await page.evaluate(() => {
      const call = window.calls.find(item => item.method === 'reavaliarCaixaTransporte');
      const payload = call.args[0];
      call.success({ ok: true, agendaSync: {}, registro: { ...payload, solicitarCaixa: 'Não', caixaTransporte: { ...window.state.registro.caixaTransporte, tipoCaixa: '', tipoCaixaAnterior: 'CREDO_CUBE', reavaliadoEm: '2026-11-05T12:00:00.000Z' } } });
      return { argumentos: call.args.length, idAgenda: payload.idAgenda, temCaixa: 'caixaTransporte' in payload };
    });
    assert.deepEqual(enviado, { argumentos: 1, idAgenda: 'EVT-A', temCaixa: false });
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#caixaReavaliarField').isVisible(), false);
    assert.equal(await page.locator('#solicitarCaixa').inputValue(), 'Não');
    assert.match(await page.locator('#actionStatus').innerText(), /Crēdo Cube → caixa normal.*Gere PDF e rascunho novamente/);
    const aviso = /Caixa reavaliada: PDF e rascunho já gerados precisam ser refeitos/;
    assert.match(await page.locator('body').innerText(), aviso);
    assert.doesNotMatch(await page.locator('body').innerText(), /antigo\.pdf/);
    assert.notEqual(await page.evaluate(() => window.transportGenerationStorageKey(window.collectPayload())), chaveAntes);

    await page.evaluate(() => { window.showPdfModal({ type: 'pdf', fileId: 'NOVO', fileName: 'novo.pdf' }); window.closePdfModal(); });
    assert.doesNotMatch(await page.locator('body').innerText(), aviso);
    const dimensions = await page.locator('body').evaluate(e => ({ client: e.clientWidth, scroll: e.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Reavaliar caixa só aparece em envio confirmado com caixa ou com regra atual', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    const errors = await transportBrowserFixture(page);
    const regra = { nomeAbreviado: 'Estudo A', courier: 'MARKEN', temperatura: 'AMBIENTE', destino: 'Lab A', tipoCaixa: 'BIOSYSTEM' };
    await page.evaluate(item => { window.state.options.caixasTransporteRegras = [item]; window.renderDerived(); }, regra);
    assert.equal(await page.locator('#caixaReavaliarField').isVisible(), false, 'rascunho segue a regra atual');
    await caixaConfirmada(page, '');
    assert.equal(await page.locator('#caixaReavaliarField').isVisible(), false, 'sem caixa e sem regra');
    await page.evaluate(item => { window.state.options.caixasTransporteRegras = [item]; window.renderDerived(); }, regra);
    assert.equal(await page.locator('#caixaEspecialField').isVisible(), false);
    assert.equal(await page.locator('#caixaReavaliarField').isVisible(), true);
    await caixaConfirmada(page, 'BIOSYSTEM');
    await page.evaluate(item => { window.state.options.caixasTransporteRegras = [item]; window.renderDerived(); }, regra);
    assert.match(await page.locator('#caixaReavaliarResumo').innerText(), /^Caixa confirmada neste envio/);
    await page.evaluate(() => { window.state.options.caixasTransporteRegras = [{ nomeAbreviado: 'Estudo A', erro: 'Revise as caixas especiais no cadastro do projeto.' }]; window.renderDerived(); });
    assert.match(await page.locator('#caixaReavaliarResumo').innerText(), /Revise as caixas/);
    await page.evaluate(() => window.selectTemp('CONGELADO'));
    assert.equal(await page.locator('#caixaReavaliarField').isVisible(), false, 'contexto alterado resolve ao salvar');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
