'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { transportBrowserFixture } = require('../helpers/transport-browser-fixture');

test('Transporte OCASA exige digital e conserva somente a AWB legada original em desktop/celular', async () => {
  // Browser plugin ausente; HTML real, rede bloqueada e RPCs simuladas.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = await transportBrowserFixture(page);
      const result = await page.evaluate(() => {
        window.selectCourier('OCASA');
        const input = document.getElementById('awb');
        input.value = 'A1234567';
        const novoLegado = input.checkValidity();
        input.value = 'PK2OZB276947';
        const novoDigital = input.checkValidity();
        window.state.registro.courier = 'OCASA'; window.state.registro.awb = 'A1234567';
        window.applyAwbRule(false);
        input.value = 'A1234567';
        const antigo = input.checkValidity();
        input.value = 'B1234567';
        return { novoLegado, novoDigital, antigo, substituicao: input.checkValidity(), placeholder: input.placeholder };
      });
      assert.deepEqual(result, { novoLegado: false, novoDigital: true, antigo: true, substituicao: false, placeholder: 'PK2OZB276947' });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
