'use strict';
/* global getComputedStyle */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');

test('BioSystem mantém as nove linhas e os estilos do modelo MARKEN no e-mail', async () => {
  const rows = [['Agendamento', ''], ['Nº HAWB', 'TESTE'], ['PI', 'Investigador exemplo'], ['Data da Coleta', '20/10/2026'], ['Horário (Janela de 1 a 2 hrs)', '13:00 - 15:00'], ['Quantidade de volumes', '1'], ['Temperatura', 'AMBIENTE'], ['Enviar Caixa de Transporte', 'Não'], ['Cidade', 'Caxias do Sul']];
  const range = {
    getDisplayValues: () => rows.map(row => row.slice()),
    getBackgrounds: () => rows.map((_row, i) => i === 0 ? ['#00b050', '#00b050'] : ['#305496', '#ffffff']),
    getFontColors: () => rows.map((_row, i) => [i === 0 ? '#000000' : '#ffffff', '#000000']),
    getFontWeights: () => rows.map(() => ['bold', 'bold']),
    getHorizontalAlignments: () => rows.map(() => ['left', 'left'])
  };
  const server = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  server.transporteCodexGetSheet_ = () => ({ getRange: () => range });
  server.transporteCnpjTexto_ = () => 'CNPJ de exemplo';
  const html = server.transporteCodexEmailHtml_({}, 'emailMarken', 'MARKEN', 'Bom dia', 'AMBIENTE', true);
  // Browser plugin not available. Corpo real gerado pelo servidor, dados fictícios e rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 620, height: 620 } });
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="pt-BR"><head><title>Modelo MARKEN — teste local</title></head><body style="font-family:Arial,sans-serif">' + html + '</body></html>');
    assert.equal(await page.locator('table tr').count(), 9);
    assert.deepEqual(await page.locator('table tr').allTextContents(), rows.map((row, index) => row[0] + (index === 7 ? 'Sim' : row[1])));
    const caixa = page.locator('table tr').nth(7);
    assert.equal(await caixa.locator('td').nth(1).innerText(), 'Sim');
    const styles = await caixa.locator('td').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight }));
    assert.deepEqual(styles, { background: 'rgb(48, 84, 150)', color: 'rgb(255, 255, 255)', weight: '700' });
    assert.equal(await page.getByText('Fornecer caixa', { exact: true }).count(), 0);
    assert.equal(rows[7][1], 'Não', 'matriz original não é alterada');
    rows[7][1] = 'Sim';
    const convencional = server.transporteCodexEmailHtml_({}, 'emailMarken', 'MARKEN', 'Bom dia', 'AMBIENTE', false);
    await page.setContent('<html lang="pt-BR"><head><title>Modelo MARKEN — teste local</title></head><body style="font-family:Arial,sans-serif">' + convencional + '</body></html>');
    assert.equal(await page.locator('table tr').count(), 9);
    assert.equal(await page.locator('table tr').nth(7).locator('td').nth(1).innerText(), 'Não');
    assert.equal(await page.getByText('Fornecer caixa', { exact: true }).count(), 0);
    const output = path.join(os.tmpdir(), 'ips-agenda-playwright');
    fs.mkdirSync(output, { recursive: true });
    await page.locator('table').screenshot({ path: path.join(output, 'marken-email-convencional.png') });
  } finally { await browser.close(); }
});
