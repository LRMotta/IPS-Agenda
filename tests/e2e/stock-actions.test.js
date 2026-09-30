'use strict';
/* global window, document */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('Estoque local: editar e excluir preservam textos com aspas e HTML sem executar código', async () => {
  // Browser plugin not available: usa o runtime Playwright já configurado no projeto.
  const source = readProjectFile('IndexEstoqueScripts.html');
  const functions = ['estoqueActionAttrs', 'estoqueBindActions', 'evPedidoLink', 'estoqueItemDescricaoHtml',
    'itemTipoChip', 'itemStatusChip', 'renderItensInline'].map(name => {
    const match = source.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}'));
    assert.ok(match, name);
    return match[0];
  }).join('\n');
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.text()); });
      await page.setContent('<!doctype html><html><head><title>IPS — Estoque local</title>' + readProjectFile('IndexStyles.html') +
        '</head><body><main style="padding:24px"><h1>Estoque — teste local</h1><input id="eiSearch" aria-label="Buscar">' +
        '<table class="data-table"><thead id="eiHead"></thead><tbody id="eiBody"></tbody></table><div id="pedidoLink"></div></main></body></html>');
      await page.addScriptTag({ content: `
        var _estoqueActionsBound = false, _estoqueInlineDados, ESTOQUE_CONFIG = { tiposItem: ['Kit','Material'] };
        var calls = [];
        function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
        function normSelectValue(s) { return String(s || '').toLowerCase(); }
        function projetoChip(s) { return esc(s); }
        function setEstoqueMetric() {} function setEstoqueControlVisible() {}
        function abrirFormItemInline(payload) { calls.push(['editar', JSON.parse(decodeURIComponent(payload))]); }
        function excluirItemInline(id, descricao) { calls.push(['excluir', id, descricao]); }
        function abrirPedidoPorNumero(numero) { calls.push(['pedido', numero]); }
        function abrirFormPedidoInline() {} function excluirPedidoInline() {}
        function imprimirRelatorioDescarte() {} function efetivarDescarteInline() {} function atualizarDescarteQtd() {}
        ${functions}
      ` });
      const item = { id: 'I"1', descricao: 'Kit "Especial" \\ <img src=x onerror="window.injected=true">',
        projeto: 'Estudo A', tipo: 'Kit', ordem: '', status: 'Ativo', localizacao: 'Laboratório', laboratorio: 'Lab A', estoqueMin: 1 };
      await page.evaluate(data => {
        window._estoqueInlineDados = { itens: [data] };
        window.renderItensInline();
        document.getElementById('pedidoLink').innerHTML = window.evPedidoLink('Pedido "A"');
      }, item);
      assert.equal(await page.title(), 'IPS — Estoque local');
      assert.ok((await page.locator('#eiBody').innerText()).includes(item.descricao));
      assert.equal(await page.locator('#eiBody img').count(), 0);
      await page.locator('[data-estoque-action="item-editar"] span').click();
      await page.locator('[data-estoque-action="item-excluir"] span').click();
      await page.locator('[data-estoque-action="pedido-abrir"]').click();
      const calls = await page.evaluate(() => window.calls);
      assert.deepEqual(calls, [['editar', item], ['excluir', item.id, item.descricao], ['pedido', 'Pedido "A"']]);
      await page.evaluate(() => window.renderItensInline());
      await page.locator('[data-estoque-action="item-excluir"]').click();
      assert.equal(await page.evaluate(() => window.calls.length), 4);
      assert.equal(await page.evaluate(() => !!window.injected), false);
      assert.deepEqual(errors, []);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'stock-actions-' + width + '.png'), fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});
