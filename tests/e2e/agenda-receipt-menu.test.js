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

test('impressão do acompanhante identifica o recebedor nas três vias e conserva cada via em uma página', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
    const errors = await agendaBrowserFixture(page);
    await page.evaluate(() => {
      // Infraestrutura do shell ausente no fixture; preservar o clique fora do modal.
      window.fecharModalSeClicouFora = (event, id) => {
        if (event.target.id === id) window.fecharOverlay(id);
      };
      window.agendaAbrirJanelaImpressao = (_titulo, html) => { window.receiptHtml = html; };
      window.abrirAgendaRecibo('AG-123', 42);
      window.calls.find(call => call.method === 'getAgendaReciboData').success({
        idParticipante: 'P-001', participante: 'Participante de teste', projeto: 'Estudo AB', visita: 'Visita 1',
        dataVisitaIso: '2026-10-07', coordenador: 'Coordenação de teste',
        beneficiarios: [
          { tipo: 'Participante', nome: 'Participante de teste', cpf: '52998224725', valorPadrao: 100 },
          { tipo: 'Acompanhante', nome: 'Acompanhante de teste', cpf: '52998224725', endereco: 'Rua Teste, 10, Caxias do Sul, RS', telefone: '(54) 99999-0202', valorPadrao: 80, banco: 'Banco Teste', agencia: '0001', conta: '1234' }
        ]
      });
    });
    await page.locator('input[name="agendaReciboRecebedor"][value="1"]').check();
    await page.locator('#btnImprimirAgendaRecibo').click();
    const html = await page.evaluate(() => window.receiptHtml);
    assert.ok(html);
    assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.method)), ['getAgendaReciboData']);
    await page.setContent(html);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.title(), 'Recibo de ressarcimento');
    assert.equal(page.url(), 'about:blank');
    const copies = page.locator('.receipt-copy');
    assert.equal(await copies.count(), 3);
    for (let index = 0; index < 3; index += 1) {
      const copy = copies.nth(index);
      assert.match(await copy.locator('p').innerText(), /Eu, Acompanhante de teste, CPF[\s\S]*na condição de acompanhante do participante de pesquisa identificado abaixo/);
      assert.equal(await copy.locator('.signature').first().innerText(), 'Acompanhante de teste\nAcompanhante de Participante de Pesquisa');
      assert.match(await copy.innerText(), /Endereço do acompanhante:[\s\S]*Telefone do acompanhante:/);
      assert.equal(await copy.locator('.bank').count(), index === 1 ? 0 : 1);
      const fits = await copy.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const last = element.querySelector('.receipt-signatures').getBoundingClientRect();
        // A4 menos as margens de 12 mm superior/inferior.
        return bounds.height <= 273 * 96 / 25.4 && last.bottom <= bounds.bottom;
      });
      assert.equal(fits, true, 'a via deve caber na área imprimível A4 sem cortar assinaturas');
    }
    assert.match(await copies.nth(1).innerText(), /Participante do estudo: nº P-001/);
    assert.doesNotMatch(await copies.nth(1).innerText(), /Participante de teste/);
    assert.match(await copies.nth(2).innerText(), /3ª via — Acompanhante/);
    const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
    fs.mkdirSync(dir, { recursive: true });
    await copies.nth(1).screenshot({ path: path.join(dir, 'recibo-acompanhante-via-ips.png') });
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});
