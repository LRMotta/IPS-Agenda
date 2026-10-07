'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

test('rotas iniciais do Estoque renderizam visualização para ambos os aliases', async () => {
  // Browser plugin not available: Playwright local com navegação/RPCs simuladas e rede bloqueada.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    await page.route('**/*', route => route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — rota inicial do Estoque</title></head>' +
      '<body><h1>Visualização do Estoque</h1><button id="legacy">Abrir visualizacao</button>' +
      '<button id="alias">Abrir estoque-view</button><input id="evSearch" aria-label="Buscar no estoque">' +
      '<p id="result" role="status">Aguardando abertura</p></body></html>');
    await page.addScriptTag({ content: `
      var APP_USER_NAVIGATED = false;
      var APP_ROUTE = {estoquePages:['visualizacao','itens','pedidos','descartes','movimentacoes','relatorios']};
      function getCurrentPage() { return ''; }
      function isEmbeddedModuleEnabled(module) { return module === 'estoque'; }
      function irParaEstoqueApp(page) { document.getElementById('result').textContent = page; }
      function carregarEstoqueView() {}
      function irPara(page) { document.getElementById('result').textContent = page === 'estoque-view' ? 'Estoque carregado' : page; }
      ${contentAccessibilitySource(['abrirPaginaInicialApp'])}
      function openRoute(page) { window.INDEX_INITIAL_PAGE = page; window.INDEX_INITIAL_SEARCH = 'Kit A'; abrirPaginaInicialApp(); }
      document.getElementById('legacy').onclick = function() { openRoute('visualizacao'); };
      document.getElementById('alias').onclick = function() { openRoute('estoque-view'); };
    ` });
    assert.equal(page.url(), 'about:blank');
    assert.equal(await page.title(), 'IPS — rota inicial do Estoque');
    assert.equal(await page.locator('h1').textContent(), 'Visualização do Estoque');
    assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
    for (const id of ['legacy', 'alias']) {
      await page.locator('#' + id).click();
      assert.equal(await page.getByRole('status').textContent(), 'Estoque carregado');
      assert.equal(await page.getByLabel('Buscar no estoque').inputValue(), 'Kit A');
    }
    const directory = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
    fs.mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, 'stock-initial-route.png') });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
