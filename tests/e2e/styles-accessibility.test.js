'use strict';
/* global document, getComputedStyle */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

function luminance(rgb) {
  const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test('CSS real: contraste, foco de teclado e carregamento com movimento reduzido', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setContent('<!doctype html><html><head><title>IPS — estilos locais</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexDashboardStyles.html') +
        readProjectFile('IndexStylesAfterDashboard.html') + '</head><body><main class="main">' +
        '<div class="content"><div class="audit-toolbar"><label class="audit-filter-wrap">' +
        '<input class="audit-filter-input" placeholder="Buscar auditoria"></label></div>' +
        '<table class="data-table"><thead><tr><th>Projeto</th></tr></thead></table>' +
        '<p class="field-help">Orientação do formulário</p><div class="table-skeleton-bar"></div>' +
        '<div class="spinner"></div><div class="ac-spin"></div>' +
        '<div class="app-inline-notice app-inline-notice--loading"><span class="app-inline-notice-spinner"></span>' +
        '<span class="app-inline-notice-copy"><strong>Salvando alterações…</strong></span></div></div></main></body></html>');
      assert.equal(await page.title(), 'IPS — estilos locais');
      assert.ok((await page.locator('body').innerText()).toLowerCase().includes('projeto'));
      const colors = await page.locator('.data-table th').evaluate(element => {
        const style = getComputedStyle(element);
        return { foreground: style.color, background: style.backgroundColor };
      });
      const ratio = (luminance(colors.background) + 0.05) / (luminance(colors.foreground) + 0.05);
      assert.ok(ratio >= 4.5, 'texto auxiliar deve atingir contraste AA: ' + ratio);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.className), 'audit-filter-input');
      assert.notEqual(await page.locator('.audit-filter-wrap').evaluate(element => getComputedStyle(element).boxShadow), 'none');
      const loaders = '.table-skeleton-bar, .spinner, .ac-spin, .app-inline-notice-spinner';
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.deepEqual(await page.locator('.table-skeleton-bar, .spinner, .ac-spin').evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName)), Array(3).fill('none'));
      // Saving progress must keep rotating even when decorative motion is reduced.
      for (const reducedMotion of ['reduce', 'no-preference']) {
        await page.emulateMedia({ reducedMotion });
        const spinner = page.locator('.app-inline-notice-spinner');
        assert.equal(await spinner.evaluate(element => getComputedStyle(element).animationName), 'app-inline-notice-spin');
        const transform = await spinner.evaluate(element => getComputedStyle(element).transform);
        await page.waitForFunction(previous => getComputedStyle(document.querySelector('.app-inline-notice-spinner')).transform !== previous, transform);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const artifactDir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifactDir, { recursive: true });
      await page.screenshot({ path: path.join(artifactDir, 'styles-accessibility-' + width + '.png'), fullPage: true });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      assert.ok((await page.locator(loaders).evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName))).every(name => name !== 'none'));
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('CSS real: texto de carregamento fica junto do spinner em listas e modais', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.setContent('<!doctype html><html><head>' + readProjectFile('IndexStyles.html') +
      '</head><body><div style="display:block;width:1500px">' +
      '<div class="courier-list" data-case="courier"><div class="loading-row"><div class="spinner"></div>Carregando…</div></div>' +
      '<div data-case="div"><div class="loading-row"><div class="spinner"></div>Carregando…</div></div>' +
      '<div class="agenda-recibo-loading" data-case="recibo"><span class="spinner"></span>Carregando dados do recibo...</div>' +
      '<div style="display:grid" data-case="visitas"><div class="item-visitas-empty"><div class="spinner"></div>Carregando visitas…</div></div>' +
      '<table class="data-table" style="width:100%" data-case="tabela"><tbody><tr class="loading-row"><td><div class="spinner"></div>Carregando…</td></tr></tbody></table>' +
      '</div></body></html>');
    // O body do app usa flex; o wrapper de bloco reproduz a largura real da lista.
    const gaps = await page.evaluate(() => Array.from(document.querySelectorAll('[data-case]')).map(box => {
      const spinner = box.querySelector('.spinner').getBoundingClientRect();
      const node = Array.from(box.querySelectorAll('*')).concat(box)
        .flatMap(el => Array.from(el.childNodes)).find(n => n.nodeType === 3 && n.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      // Distância horizontal entre a borda do spinner e o texto (0 quando se sobrepõem).
      const gap = Math.max(0, text.left - spinner.right, spinner.left - text.right);
      return { name: box.dataset.case, gap: Math.round(gap) };
    }));
    for (const item of gaps) assert.ok(item.gap <= 12, item.name + ': texto afastado do spinner em ' + item.gap + 'px');
    await page.close();
  } finally { await browser.close(); }
});
