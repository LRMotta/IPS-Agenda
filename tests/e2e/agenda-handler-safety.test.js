'use strict';
/* global window, document */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');

test('handlers da Agenda preservam dados com aspas sem interpretar codigo no DOM real', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  const value = 'O\'Brien "<>&\\\n);window.__injected=true;//';
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = await agendaBrowserFixture(page);
    await page.evaluate(value => {
      window.__injected = false;
      window.handlerCalls = [];
      window.AGENDA_PROCEDIMENTO_CHIPS = [value];
      window.renderAgendaProcedimentoChips();
      document.getElementById('agProcedimentos').value = '';
    }, value);
    await page.locator('#agProcedimentosChips .ag-proc-chip').click();
    assert.equal(await page.locator('#agProcedimentos').inputValue(), value);

    await page.evaluate(value => {
      document.getElementById('agendaCreatePanel').classList.remove('open');
      window.parentClicks = 0;
      const mount = document.getElementById('agendaViewLista');
      mount.onclick = () => { window.parentClicks += 1; };
      const row = { id: value, rowIndex: 42, tipo: 'Visita', participante: value, projeto: 'Estudo AB', status: 'Agendado', hora: '09:00' };
      window.expectedDisplay = window.agendaDisplayPayload(row);
      mount.innerHTML = window.agendaCardHtml(row, 'safety') + window.agendaAwbCopyButton(value);
      for (const name of ['abrirAgendaEdicao', 'abrirEventoNoGoogleCalendar', 'cancelarAgendaEvento', 'abrirAgendaRecibo', 'abrirDisplayMonitoriaAgendaCard']) {
        window[name] = (...args) => window.handlerCalls.push({ name, args });
      }
      window.abrirDisplayPaciente = payload => window.handlerCalls.push({ name: 'abrirDisplayPaciente', args: [JSON.parse(decodeURIComponent(payload))] });
      Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: text => {
        window.handlerCalls.push({ name: 'clipboard', args: [text] });
        return Promise.resolve();
      } } });
    }, value);
    // O fixture usa texto no lugar da fonte de icones; disparar o clique evita sobreposicao visual entre icones.
    await page.getByRole('button', { name: 'Editar', exact: true }).dispatchEvent('click');
    const actions = [
      ['Adicionar ao Google Agenda', 'abrirEventoNoGoogleCalendar', [value]],
      ['Cancelar', 'cancelarAgendaEvento', [value]],
      ['Gerar Display', 'abrirDisplayPaciente', [await page.evaluate(() => window.expectedDisplay)]],
      ['Gerar recibo', 'abrirAgendaRecibo', [value, 42]]
    ];
    for (const [label, name, args] of actions) {
      await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      assert.equal(await page.locator('.ag-action-menu.open').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.handlerCalls.at(-1)), { name, args });
    }
    await page.getByRole('button', { name: 'Copiar AWB', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.handlerCalls), [
      { name: 'abrirAgendaEdicao', args: [value, 42] },
      ...actions.map(([, name, args]) => ({ name, args })),
      { name: 'clipboard', args: [value] }
    ]);
    assert.equal(await page.evaluate(() => window.parentClicks), 0);

    await page.evaluate(value => {
      const row = { id: value, rowIndex: 43, tipo: 'Monitoria', projeto: value, status: 'Agendado' };
      document.getElementById('agendaViewLista').innerHTML = window.agendaCardHtml(row, 'operational-safety');
    }, value);
    await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Gerar Display', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.handlerCalls.at(-1)), { name: 'abrirDisplayMonitoriaAgendaCard', args: [value, 43] });
    assert.equal(await page.evaluate(() => window.parentClicks), 0);
    assert.equal(await page.evaluate(() => window.__injected), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});


