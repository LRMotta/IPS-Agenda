'use strict';
/* global document, window, renderDashboardPendencias */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('Pendencias: fim dos cards tem folga no limite da rolagem do shell real', async () => {
  // Browser plugin not available: Chromium local com rede bloqueada e dados simulados.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 3492, 390]) {
      const page = await browser.newPage({ viewport: { width, height: width === 3492 ? 1912 : 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      await page.route('**/*', route => route.abort());
      const content = readProjectFile('IndexContent.html');
      const pendingPage = content.slice(content.indexOf('<div class="page" id="page-pendencias">'));
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Pendências — layout local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '<style>.material-symbols-outlined{display:inline-block;width:1em;overflow:hidden}</style>' +
        '</head><body><div class="main"><div class="top-bar"><span class="page-title">Pendências</span></div><div class="content">' +
        pendingPage + '</div></div></body></html>');
      await page.evaluate(() => {
        document.getElementById('page-pendencias').classList.add('active');
        window.esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      });
      await page.addScriptTag({ content: readProjectFile('IndexPendenciasScripts.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      await page.evaluate(() => {
        const items = Array.from({ length: 11 }, (_, i) => ({ data: '01/out./2026', hora: '08:00', participante: 'Participante de teste ' + i, projeto: 'Estudo de teste', descricao: 'Kit de teste ' + i }));
        renderDashboardPendencias({ courierNaoAgendada: items, courierNaoConfirmada: items, awbEnviadaNaoEntregue: items, requisicaoExamesPendente: items, posVisitaPoloTrialPendente: items, posVisitaEcrfPendente: items, kitsVencendo: items.slice(0, 3), transporteBackupNaoAgendado: items.slice(0, 2) });
      });
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'Pendências — layout local');
      assert.equal(await page.locator('.dash-pend-card').count(), 9);
      // Expandir altera a altura real do grid e deve preservar o rodapé alcançável.
      await page.locator('.dash-pend-more').first().click();
      assert.equal(await page.locator('.dash-pend-more').first().getAttribute('aria-expanded'), 'true');
      const geometry = await page.evaluate(() => {
        const content = document.querySelector('.content');
        content.scrollTop = content.scrollHeight;
        const cards = [...document.querySelectorAll('.dash-pend-card')];
        return { gap: content.getBoundingClientRect().bottom - Math.max(...cards.map(card => card.getBoundingClientRect().bottom)), horizontalOverflow: content.scrollWidth > content.clientWidth };
      });
      assert.ok(geometry.gap >= 14, 'Folga inferior em ' + width + 'px: ' + geometry.gap);
      assert.equal(geometry.horizontalOverflow, false);
      assert.deepEqual(errors, []);
      console.log('Folga inferior em ' + width + 'px: ' + geometry.gap + 'px');
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'pendencias-rodape-' + width + '.png') });
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
