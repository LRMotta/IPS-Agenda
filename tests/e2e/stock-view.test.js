'use strict';
/* global window, document, getComputedStyle */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('visualização do estoque: layout, busca, detalhes sob demanda, ações e recuperação de erro', async () => {
  // Browser plugin not available: Playwright local, sem RPCs ou rede reais.
  const source = readProjectFile('IndexEstoqueScripts.html');
  const names = ['evRender', 'carregarEstoqueView', 'evAgendarBusca', 'evPrepararItemView', 'evFiltrar', 'evRenderTabela',
    'evDetalheHtml', 'evToggle', 'evTipoItem', 'evEhKit', 'evEhLaboratorio', 'evNivel', 'evChipStatus', 'evValCls',
    'estoqueItemDescricaoHtml', 'estoqueItemNotasDetalheHtml', 'estoqueValidadeExibicao', 'diasAteValidade', 'estoqueHojeIso',
    'estoqueDataCivilTimestamp', 'sortValidade', 'itemTipoChip', 'evPedidoLink', 'estoqueActionAttrs', 'estoqueBindActions'];
  const functions = names.map(name => {
    const match = source.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}'));
    assert.ok(match, name);
    return match[0];
  }).join('\n');
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => route.abort());
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', msg => { if (['warning', 'error'].includes(msg.type())) errors.push(msg.text()); });
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"><title>IPS — Estoque local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '<style>.material-symbols-outlined{display:inline-block;width:20px;overflow:hidden;white-space:nowrap}</style></head>' +
        '<body><main style="padding:16px">' + readProjectFile('IndexEstoqueContent.html') + '</main></body></html>');
      await page.addScriptTag({ content: `
        var evItens=[],_evItemViewCache=new WeakMap(),_evDetalheRows={},_evBuscaTimer=null,_evViewStatus='idle';
        var _evTransferRows={},_evParticipantes=[],_evAlertas=null,_evPiloto=null,_estoqueActionsBound=false,_estoqueBusinessDateFormatter=null;
        var requests=[],calls=[],filterCount=0;
        function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
        function appErrorMessage(e){return e.message} function snackErro(){} function invalidateEstoqueClientCache(){}
        function estoqueCachedRun(key,method,args,ok,fail){requests.push({ok:ok,fail:fail})}
        function evStats(){} function evRenderAlertas(){} function evRenderReservas(){}
        function evAbrirTransferenciaIndice(i,l){calls.push(['reserva',_evTransferRows[i][l].item.idItem,_evTransferRows[i][l].lote.idLote])}
        function evAbrirExcecaoLoteIndice(i,l){calls.push(['excecao',_evTransferRows[i][l].item.idItem,_evTransferRows[i][l].lote.idLote])}
        ${functions}
        var originalFilter=evFiltrar;
        evFiltrar=function(){filterCount++;originalFilter()};
        document.getElementById('page-estoque-view').classList.add('active');
      ` });
      const items = Array.from({ length: 40 }, (_v, i) => ({ idItem: 'KIT' + i, descricao: 'Kit coleta ' + i,
        projeto: i === 39 ? 'Estudo B' : 'Estudo A', tipo: 'Kit', laboratorio: 'Lab A', status: 'Ativo', estoquePrincipal: 20,
        observacoes: 'Observação única ' + i, detalhesVisita: 'Complemento ' + i, numerosPedidoPendente: ['PED-' + i],
        reservasLaboratorio: [{ participante: 'Pessoa ' + i, participanteId: 'PESSOA-' + i, visitaPrevista: 'Visita ' + i, dataVisita: '01/11/2026', agendaId: 'AGENDA-' + i }],
        lotes: Array.from({ length: 4 }, (_l, l) => ({ idLote: 'L' + i + '-' + l, validade: '0' + (l + 1) + '/12/2026',
          localizacao: 'Estoque Principal', numeroPedido: 'NUM-' + i, responsavel: 'Responsável ' + i, accessionNumber: 'ACC-' + i,
          qtde: 5, qtdeFisica: 5, qtdeDisponivel: 5, status: 'Ativo' })) }));
      await page.evaluate(data => window.evRender({ itens: data }), items);
      assert.equal(await page.title(), 'IPS — Estoque local');
      assert.equal(await page.locator('#evBody .par-main').count(), 40);
      assert.equal(await page.locator('#evBody tr').count(), 80);
      assert.equal(await page.locator('#evBody .estoque-lotes-table').count(), 0);
      assert.equal(await page.locator('#evBody').getAttribute('aria-busy'), 'false');
      for (const name of ['Buscar no estoque', 'Filtrar por projeto', 'Filtrar por tipo', 'Filtrar por status']) {
        assert.equal(await page.getByLabel(name, { exact: true }).count(), 1);
      }
      const layout = await page.evaluate(() => {
        const toolbar = document.querySelector('.estoque-view-toolbar'), scroll = document.querySelector('.estoque-view-scroll');
        return { toolbarWidth: toolbar.scrollWidth, toolbarClient: toolbar.clientWidth,
          overflow: getComputedStyle(scroll).overflowX, client: scroll.clientWidth, scroll: scroll.scrollWidth,
          statsColumns: getComputedStyle(document.querySelector('.stats-row')).gridTemplateColumns.split(' ').length };
      });
      assert.ok(layout.toolbarWidth <= layout.toolbarClient + 1, JSON.stringify(layout));
      assert.equal(layout.overflow, 'auto');
      if (width === 390) { assert.equal(layout.statsColumns, 2); assert.ok(layout.scroll > layout.client); }
      const expand = page.locator('#evBody .par-main button').first();
      await expand.click();
      assert.equal(await expand.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#evBody .estoque-lotes-table').count(), 1);
      assert.equal(await page.locator('#evBody tr').count(), 85);
      assert.equal(await page.getByRole('button', { name: /Reservar$/ }).count(), 4);
      assert.equal(await page.getByRole('button', { name: /Exceção$/ }).count(), 4);
      await page.getByRole('button', { name: /Reservar$/ }).first().click();
      await page.getByRole('button', { name: /Exceção$/ }).first().click();
      assert.deepEqual(await page.evaluate(() => window.calls), [['reserva', 'KIT0', 'L0-0'], ['excecao', 'KIT0', 'L0-0']]);
      await page.evaluate(() => { window.firstTable = document.querySelector('.estoque-lotes-table'); });
      await expand.click(); await expand.click();
      assert.equal(await page.evaluate(() => window.firstTable === document.querySelector('.estoque-lotes-table')), true);
      await page.locator('#evBody .par-main button').nth(1).click();
      assert.equal(await expand.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('#evBody .par-detail:visible').count(), 1);
      const before = await page.evaluate(() => window.filterCount);
      await page.locator('#evSearch').fill('KIT39');
      await page.locator('#evSearch').fill('ACC-39');
      await page.locator('#evSearch').fill('PESSOA-39');
      await page.waitForTimeout(240);
      assert.equal(await page.evaluate(() => window.filterCount), before + 1);
      assert.equal(await page.locator('#evBody .par-main').count(), 1);
      await page.locator('#evBody .par-main button').click();
      await page.getByRole('button', { name: /Exceção$/ }).first().click();
      assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), ['excecao', 'KIT39', 'L39-0']);
      // Seleção é imediata e cancela qualquer digitação pendente.
      await page.locator('#evSearch').fill('');
      await page.locator('#evFilterProjeto').selectOption('Estudo A');
      assert.equal(await page.locator('#evBody .par-main').count(), 39);
      const filtered = await page.evaluate(() => window.filterCount);
      await page.waitForTimeout(240);
      assert.equal(await page.evaluate(() => window.filterCount), filtered);
      await page.evaluate(() => window.carregarEstoqueView(true));
      await page.locator('#evFilterTipo').selectOption('Kit');
      assert.ok((await page.locator('#evBody').innerText()).includes('Carregando'));
      await page.evaluate(() => window.requests[0].fail(new Error('Falha simulada')));
      await page.locator('#evSearch').fill('Kit');
      await page.waitForTimeout(240);
      assert.ok((await page.locator('#evBody').innerText()).includes('Falha simulada'));
      await page.getByRole('button', { name: 'Tentar novamente' }).click();
      await page.evaluate(data => window.requests[1].ok({ data }), items);
      assert.equal(await page.locator('#evBody .par-main').count(), 39);
      assert.equal(await page.locator('#evBody .estoque-lotes-table').count(), 0);
      assert.deepEqual(errors, []);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'stock-view-' + width + '.png'), fullPage: true });
      await page.close();
    }
  } finally { await browser.close(); }
});
