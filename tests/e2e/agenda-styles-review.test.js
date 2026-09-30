'use strict';
/* global document, window, getComputedStyle */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');

test('CSS da Agenda: resumos, cancelados e foco cabem no shell desktop e mobile', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1440, 1280, 1000, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = await agendaBrowserFixture(page);
      await page.addStyleTag({ content: 'body{padding:0}#page-agenda{display:block}' });
      await page.evaluate(() => {
        document.getElementById('agendaCreatePanel').classList.remove('open');
        const agenda = document.getElementById('page-agenda');
        const nav = document.createElement('aside');
        nav.className = 'nav-drawer';
        const main = document.createElement('main');
        main.className = 'main';
        const content = document.createElement('div');
        content.className = 'content';
        document.body.append(nav, main);
        main.append(content);
        content.append(agenda);
        content.insertAdjacentHTML('afterbegin', '<div class="stats-row content-stats-row content-stats-cols-5">' +
          Array(5).fill('<div class="stat-card"><div class="stat-value">123</div><div class="stat-label">Participantes ativos</div></div>').join('') + '</div>');
        document.getElementById('agendaViewLista').innerHTML = window.agendaCanceladoCompactoHtml({
          id: 'A', rowIndex: 1, tipo: 'Visita', hora: '09:00', status: 'Cancelado',
          participante: 'Participante de teste', projeto: 'Estudo AB', visita: 'Visita 1', obs: 'Motivo de cancelamento',
        }, 'review');
      });
      assert.equal(await page.title(), 'Agenda — teste local');
      const measurements = await page.evaluate(() => {
        const stats = document.querySelector('.main .content > .content-stats-row');
        const grid = document.querySelector('.ag-cancelado-compact-main');
        return { statsWidth: stats.clientWidth, statsScroll: stats.scrollWidth,
          columns: getComputedStyle(stats).gridTemplateColumns.split(' ').length,
          gridWidth: grid.clientWidth, gridScroll: grid.scrollWidth };
      });
      assert.ok(measurements.statsScroll <= measurements.statsWidth + 1, JSON.stringify(measurements));
      assert.ok(measurements.gridScroll <= measurements.gridWidth + 1, JSON.stringify(measurements));
      if (width <= 1100) assert.equal(measurements.columns, 2);
      await page.locator('#agendaBusca').focus();
      assert.notEqual(await page.locator('.ag-search').evaluate(el => getComputedStyle(el).boxShadow), 'none');
      await page.locator('.ag-action-menu-trigger').click();
      const menu = page.locator('.ag-action-menu.open');
      assert.equal(await menu.evaluate(el => el.parentNode === document.body), true);
      const box = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.ok(box.y >= 0 && box.y + box.height <= 900);
      assert.equal(await menu.locator('[role="menuitem"]').last().evaluate(el => {
        const box = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), true, 'ultima ação visível e clicável fora do recorte da lista');
      await page.keyboard.press('Escape');
      assert.equal(await menu.count(), 0);
      assert.equal(await page.locator('.ag-action-menu-trigger').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.ag-action-menu-wrap .ag-action-menu').count(), 1);
      await page.locator('.ag-action-menu-trigger').click();
      await page.locator('.content').evaluate(el => el.dispatchEvent(new Event('scroll')));
      assert.equal(await page.locator('.ag-action-menu.open').count(), 0);
      await page.locator('.ag-action-menu-trigger').click();
      await page.evaluate(() => window.renderAgendaOperacional());
      assert.equal(await page.locator('body > .ag-action-menu').count(), 0, 'renderização remove o menu antigo do viewport');
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'agenda-styles-review-' + width + '.png') });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('menu da Agenda abre acima perto do rodapé e acompanha reabertura e resize', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 600 } });
    const errors = await agendaBrowserFixture(page);
    await page.evaluate(() => {
      document.getElementById('agendaCreatePanel').classList.remove('open');
      document.getElementById('agendaViewLista').innerHTML = '<div class="ag-appt" style="position:fixed;bottom:14px;right:14px"><div class="ag-action-menu-wrap">' +
        '<button class="ag-act-btn ag-action-menu-trigger" onclick="agendaToggleActionMenu(\'reviewMenu\',this)" aria-expanded="false">...</button>' +
        '<div class="ag-action-menu" id="reviewMenu">' + Array(8).fill('<button class="ag-action-menu-item" role="menuitem">Ação de teste</button>').join('') + '</div></div></div>';
    });
    await page.locator('.ag-action-menu-trigger').click();
    const anchor = await page.locator('.ag-action-menu-trigger').boundingBox();
    const box = await page.locator('#reviewMenu').boundingBox();
    assert.ok(box.y + box.height < anchor.y);
    await page.keyboard.press('End');
    assert.equal(await page.locator('#reviewMenu button').last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await page.locator('.ag-appt').evaluate(el => { el.style.bottom = 'auto'; el.style.top = '14px'; });
    await page.locator('.ag-action-menu-trigger').click();
    const reopened = await page.locator('#reviewMenu').boundingBox();
    assert.ok(reopened.y > 14 && reopened.y + reopened.height <= 600);
    await page.setViewportSize({ width: 320, height: 600 });
    await page.waitForFunction(() => !document.querySelector('.ag-action-menu.open'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
