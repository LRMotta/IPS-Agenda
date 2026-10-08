'use strict';
/* global window, document, renderDashboardPendencias, getComputedStyle */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('Pendencias: falha parcial, recuperacao e retorno de outro modal no DOM real', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<html><head><title>Pendências — falhas locais</title>' + readProjectFile('IndexStyles.html') + '</head><body><h1>Pendências</h1><button id="btnPendenciasRefresh"><span class="btn-label">Atualizar</span></button><div id="pendenciasStatus"></div><div id="pendenciasGrid"></div>' + readProjectFile('IndexExtraModals.html') + '</body></html>');
      await page.evaluate(() => {
        window.requests = []; window.mutations = [];
        window.esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        window.snack = window.snackErro = () => {};
        window.appErrorMessage = e => e.message;
        window.abrirOverlay = id => document.getElementById(id).classList.add('open');
        window.fecharOverlay = id => document.getElementById(id).classList.remove('open');
        window.appServerRun = opts => window.mutations.push(opts);
        function runner(success, failure) {
          return { withSuccessHandler(fn) { return runner(fn, failure); }, withFailureHandler(fn) { return runner(success, fn); }, getPendenciasOperacionais() { window.requests.push({ success, failure }); } };
        }
        window.google = { script: { run: runner() } };
      });
      await page.addScriptTag({ content: readProjectFile('IndexPendenciasScripts.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      await page.evaluate(() => {
        window.carregarPendencias(true);
        window.requests[0].success({ pendencias: { unavailable: { kitsVencendo: 'Estoque indisponível' }, awbEnviadaNaoEntregue: [{ agendaId: 'A', slot: 'Transporte I', participante: 'Pessoa A' }] } });
      });
      const kit = page.locator('[data-pendencia-card="pendenciasGrid:kitsVencendo"]');
      assert.match(await kit.innerText(), /Estoque indisponível/);
      assert.doesNotMatch(await kit.innerText(), /Sem pendências/);
      assert.equal(await kit.locator('.dash-pend-count').innerText(), '—');
      await page.evaluate(() => {
        window.confirmarEntregaPendencia(null, 'A', 'Transporte I', '123', 'Pessoa A');
        window.executarConfirmarEntregaPendencia_();
        window.fecharConfirmacaoEntregaPendencia();
        window.confirmarEntregaPendencia(null, 'B', 'Transporte II', '456', 'Pessoa B');
        window.mutations[0].onSuccess({ ok: true });
      });
      assert.equal(await page.locator('#modalConfirmarEntregaPendencia').evaluate(el => el.classList.contains('open')), true);
      assert.equal(await page.locator('#pendenciaEntregaParticipante').textContent(), 'Pessoa B');
      await page.evaluate(() => {
        window.executarConfirmarEntregaPendencia_();
        window.mutations[1].onFailure(new Error('rede'));
      });
      assert.equal(await page.locator('#btnConfirmarEntregaPendencia').isDisabled(), false);
      assert.match(await page.locator('#btnConfirmarEntregaPendencia').innerText(), /Confirmar entrega/i);
      await page.evaluate(() => {
        const render = window.renderDashboardPendencias;
        window.renderDashboardPendencias = () => { throw new Error('falha renderer'); };
        window.requests[1].success({ pendencias: {} });
        window.renderDashboardPendencias = render;
        window.carregarPendencias(true);
        window.requests[2].success({ pendencias: { kitsVencendo: [] } });
      });
      assert.match(await kit.innerText(), /Sem pendências/);
      assert.equal(await page.locator('#btnPendenciasRefresh').isDisabled(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Pendencias: dados literais, teclado, rastreio, modal e expansao em desktop e celular', async () => {
  // Browser plugin not available: reutiliza o runtime Playwright local; nenhuma rede ou RPC real.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Pendências — teste local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '<style>body{display:block;height:auto;overflow:auto;padding:16px}.material-symbols-outlined{display:inline-block;width:1em;overflow:hidden}#page-pendencias{height:auto}</style></head><body><h1>Pendências</h1><div id="page-pendencias"><div id="pendenciasGrid" class="dash-pend-grid"></div></div>' +
        readProjectFile('IndexExtraModals.html') + '</body></html>');
      await page.evaluate(() => {
        window.calls = [];
        window.esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        window.snackErro = value => { throw new Error(value); };
        window.abrirAgendaRegistroPorId = id => window.calls.push(['agenda', id]);
        window.abrirModuloEstoque = (_view, q) => window.calls.push(['estoque', q]);
        window.abrirOverlay = id => document.getElementById(id).classList.add('open');
        window.fecharOverlay = id => document.getElementById(id).classList.remove('open');
        window.open = (url, target, features) => window.calls.push(['tracking', url, target, features]);
      });
      await page.addScriptTag({ content: readProjectFile('IndexPendenciasScripts.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '') });
      const literal = 'Kit "especial" &quot; </button><img src=x onerror=alert(1)>';
      await page.evaluate(value => renderDashboardPendencias({
        kitsVencendo: Array.from({ length: 11 }, (_, index) => ({ descricao: index === 0 ? value : 'Kit ' + index, dias: 3 })),
        awbEnviadaNaoEntregue: [{ agendaId: 'A"&quot;', slot: 'Transporte I', awb: '123', participante: 'Participante de teste', courier: 'DHL', temperatura: 'Ambiente', trackingUrl: 'https://example.org/?a="&b=1' }]
      }), literal);
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'Pendências — teste local');
      assert.equal(await page.locator('.dash-pend-card').count(), 9);
      assert.equal(await page.locator('#pendenciasGrid img, #pendenciasGrid [onclick], #pendenciasGrid [onerror]').count(), 0);
      const kit = page.locator('.dash-pend-open').filter({ hasText: literal });
      assert.equal(await kit.locator('.dash-pend-main').textContent(), literal);
      await kit.focus();
      assert.notEqual(await kit.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => window.calls), [['estoque', literal]]);
      const awb = page.locator('.dash-pend-card').filter({ has: page.locator('.dash-pend-confirm') });
      await awb.locator('.dash-pend-open').focus();
      await page.keyboard.press('Space');
      await awb.locator('.dash-pend-track').click();
      await awb.locator('.dash-pend-confirm').click();
      assert.deepEqual(await page.evaluate(() => window.calls.slice(1)), [['agenda', 'A"&quot;'], ['tracking', 'https://example.org/?a="&b=1', '_blank', 'noopener']]);
      assert.equal(await page.locator('#pendenciaEntregaCourier').textContent(), 'DHL / Ambiente');
      assert.equal(await page.locator('#pendenciaEntregaAwb').textContent(), 'AWB 123');
      assert.equal(await page.locator('#modalConfirmarEntregaPendencia').evaluate(el => el.classList.contains('open')), true);
      await page.evaluate(() => window.fecharConfirmacaoEntregaPendencia());
      const more = page.locator('.dash-pend-more');
      await more.focus();
      await page.keyboard.press('Enter');
      assert.equal(await more.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.dash-pend-overflow').isVisible(), true);
      await page.evaluate(() => renderDashboardPendencias(window._pendenciasCache || {
        kitsVencendo: Array.from({ length: 11 }, (_, index) => ({ descricao: 'Kit ' + index, dias: 3 }))
      }));
      assert.equal(await more.getAttribute('aria-expanded'), 'true', 'refresh conserva expansao');
      assert.equal(await more.locator('.dash-pend-more-label').textContent(), 'Mostrar menos');
      await more.click();
      assert.equal(await page.locator('.dash-pend-overflow').isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      const screenshot = path.join(artifacts, 'pendencias-' + width + '.png');
      await page.screenshot({ path: screenshot, fullPage: false });
      console.log('Screenshot:', screenshot);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
