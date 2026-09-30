'use strict';
/* global window, document */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');

test('menu de ações abre recibo do evento sem precisar expandir detalhes, em desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = await agendaBrowserFixture(page);
      await page.evaluate(() => {
        document.getElementById('agendaCreatePanel').classList.remove('open');
        const row = { id: 'AG-123', rowIndex: 42, tipo: 'Visita', participante: 'Participante de teste', projeto: 'Estudo AB', status: 'Agendado', hora: '09:00' };
        document.getElementById('agendaViewLista').innerHTML = window.agendaCardHtml(row, 'receipt-menu-test');
      });
      assert.equal(await page.title(), 'Agenda — teste local');
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.locator('.ag-appt-detail').getByText('Gerar recibo', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'Ações do agendamento' });
      assert.equal(await menu.isVisible(), true);
      assert.equal(await menu.getByRole('menuitem', { name: 'Gerar Display' }).isVisible(), true);
      assert.equal(await menu.getByRole('menuitem', { name: 'Adicionar ao Google Agenda' }).isVisible(), true);
      const box = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.ok(box.y >= 0 && box.y + box.height <= 900);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'agenda-receipt-menu-' + width + '.png') });
      await menu.getByRole('menuitem', { name: 'Gerar recibo', exact: true }).click();
      assert.equal(await page.locator('.ag-action-menu.open').count(), 0);
      assert.equal(await page.locator('#modalAgendaRecibo').isVisible(), true);
      assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.method === 'getAgendaReciboData').map(call => call.args)), [['AG-123', 42]]);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
