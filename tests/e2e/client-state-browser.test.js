'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');
const core = contentAccessibilitySource(['ativarAutocompleteProjeto', 'sincronizarAutocompleteProjeto', 'ativarAutocompletesProjetoDinamicos', 'iniciarAutocompletesProjetoDinamicos']);
const stock = readProjectFile('IndexEstoqueScripts.html');
const stockFunctions = ['ensureEstoqueFramePage', 'montarFormItemInline', 'abrirFormPedidoInline', 'renderPlanejamentoProjetos', 'renderDescarteProjetos'].map(name => {
  const match = stock.match(new RegExp('  function ' + name + '\\([^]*?\\n  \\}')); assert.ok(match, name); return match[0];
}).join('\n');
const localities = contentAccessibilitySource(['participanteMunicipioElementos_', 'participantePreencherEstadosBrasilElemento_', 'participanteCarregarMunicipios_',
  'participanteInicializarLocalidade_', 'participanteSelecionarMunicipio_', 'participanteFixarMunicipio_', 'participanteMunicipioDigitado_',
  'participanteValidarLocalidadesFormulario_', 'participanteDefinirPessoaSomenteLeitura_', 'prepararNovaParticipacaoPessoa_']);

test('Farmácia: busca estoque por código, preserva ID e sincroniza revalidação', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<select id="farmaciaStudy"></select>');
    await page.addScriptTag({ content: `
      var _autocompleteProjetoAtivo={}, changes=[];
      function esc(v){return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
      function normSelectValue(v){return String(v).toLowerCase();}
      ${contentAccessibilitySource(['ativarAutocompleteProjeto','sincronizarAutocompleteProjeto','opcoesAutocompleteProjeto','renderAutocompleteProjeto','selecionarAutocompleteProjeto','navegarAutocompleteProjeto','renderFarmaciaStudies','farmaciaStudyLabel'])}
      document.getElementById('farmaciaStudy').addEventListener('change',function(){changes.push(this.value);});
      renderFarmaciaStudies([{id:'@IPS_COMMON',nome:'Geral (Farmácia)'},{id:'P1',nome:'KANDELA-302',codigo:'BGB-43395-302'}]);
    ` });
    const input = page.locator('#farmaciaStudyAutocompleteInput');
    await input.fill('BGB-43395');
    assert.equal(await page.locator('.ac-item').count(), 1);
    assert.equal(await page.locator('.ac-item-meta').textContent(), 'BGB-43395-302');
    await input.press('ArrowDown');
    await input.press('Enter');
    assert.equal(await page.locator('#farmaciaStudy').inputValue(), 'P1');
    assert.deepEqual(await page.evaluate(() => window.changes), ['P1']);
    await input.fill('Geral (Farmácia)');
    await page.locator('.ac-item').click();
    assert.equal(await page.locator('#farmaciaStudy').inputValue(), '@IPS_COMMON');
    await page.evaluate(() => window.renderFarmaciaStudies([]));
    assert.equal(await input.isDisabled(), true);
    assert.equal(await input.inputValue(), '');
    assert.equal(await page.locator('#farmaciaStudyAutocomplete').count(), 1);
  } finally { await browser.close(); }
});

for (const width of [1280, 390]) {
  test('Estoque: projetos de edição e histórico aparecem sem depender do observer em ' + width + 'px', async () => {
    // Browser plugin not available: Playwright existente, rede/RPCs isoladas.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      await page.route('**/*', route => route.abort()); page.on('pageerror', e => errors.push(e.message));
      await page.setContent('<!doctype html><html><head><title>IPS — formulários locais</title>' + readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '</head><body><main class="main"><div class="content"></div></main></body></html>');
      await page.addScriptTag({ content: `
        var _itemInlineVinculosState=null,_itemInlineEditId='',_itemInlineEditStableId='',_pedidoInlineEdit=null,_pedidoInlineItens=[];
        var _autocompleteProjetoAtivo={},_estoqueInlineDados={projetos:['Atual'],projLabsMap:{Atual:[]},pedidoItensMap:{}};
        var ESTOQUE_CONFIG={laboratorios:[],localizacoes:[],tiposItem:['Material']};
        var _planejamentoPedidoData={projetos:[{nome:'Atual'}]},_descarteData={estoque:[{projeto:'Atual',qtde:1}]};
        function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
        function appSetStatus(){} function atualizarVisitasItemInline(){} function onPedidoProjetoChange(){} function onPedidoLabChange(){}
        function renderPedidoInlineItensForm(){} function estoqueHojeIso(){return '2026-10-16';}
        function abrirOverlay(id){document.getElementById(id).inert=false;document.getElementById(id).classList.add('open');}
        function updateScrollTopButton(){} function estoqueBindActions(){} function appInitContentAccessibility(){}
        ${core}
        ${stockFunctions}
        ensureEstoqueFramePage();
        document.querySelector('.content').insertAdjacentHTML('beforeend','<select id="planProjeto"></select><select id="desProjeto"></select>');
        ativarAutocompletesProjetoDinamicos(document);
      ` });
      assert.equal(page.url(), 'about:blank'); assert.equal(await page.title(), 'IPS — formulários locais');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(), 0);
      await page.evaluate(() => window.montarFormItemInline({id:'1',projeto:'Histórico',tipo:'Material',descricao:'Item'}, {}, ['Atual']));
      assert.equal(await page.locator('#iiProjetoAutocompleteInput').inputValue(), 'Histórico');
      await page.evaluate(() => {
        document.getElementById('modalItemInline').classList.remove('open');
        window.abrirFormPedidoInline(encodeURIComponent(JSON.stringify({idPedido:'P1',projeto:'Histórico',numeroPedido:'PED1'})));
      });
      assert.equal(await page.locator('#piProjetoAutocompleteInput').inputValue(), 'Histórico');
      await page.evaluate(() => {
        window.renderPlanejamentoProjetos(); window.renderDescarteProjetos();
        document.getElementById('planProjetoAutocompleteInput').value='Valor obsoleto';
        document.getElementById('desProjetoAutocompleteInput').value='Valor obsoleto';
        window.renderPlanejamentoProjetos(); window.renderDescarteProjetos();
      });
      assert.equal(await page.locator('#planProjetoAutocompleteInput').inputValue(), '');
      assert.equal(await page.locator('#desProjetoAutocompleteInput').inputValue(), '');
      // O observer real também mantém o valor após seu callback assíncrono.
      await page.evaluate(() => window.iniciarAutocompletesProjetoDinamicos());
      await page.evaluate(() => window.montarFormItemInline({id:'2',projeto:'Atual',tipo:'Material'}, {}, ['Atual']));
      assert.equal(await page.locator('#iiProjetoAutocompleteInput').inputValue(), 'Atual');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test('Nova Participação: município legado bloqueado permite preservar cadastro em ' + width + 'px', async () => {
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
      await page.route('**/*', route => route.abort()); page.on('pageerror', e => errors.push(e.message));
      const content = readProjectFile('IndexContentAfterStock.html');
      const modal = content.slice(content.indexOf('<div class="modal-overlay" id="modalParticipante"'), content.indexOf('<div class="modal-overlay" id="modalMedico"'));
      await page.setContent('<!doctype html><html><head><title>IPS — município local</title>' + readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + '</head><body>' + modal + '</body></html>');
      await page.addScriptTag({ content: `
        var _municipiosBrasilParticipanteCache_={},_municipiosBrasilParticipanteEspera_={},_participanteLocalidadeRevision_=0;
        var ESTADOS_BRASIL_PARTICIPANTE_=[['RS','Rio Grande do Sul']],BANCOS_PART=[];
        window.requests=[];
        function appServerRun(r){requests.push(r);} function appClearUnsavedChanges(){}
        function abrirFormPart(){document.getElementById('modalParticipante').inert=false;document.getElementById('modalParticipante').classList.add('open');}
        function dateToInputValue(){return '';} function formatarTelefoneBrasileiro(v){return v||'';}
        function renderParticipacoesPessoa_(){} function participanteRenderMunicipios_(){}
        function fillSelectOptions(id,values,value){document.getElementById(id).innerHTML='<option value=""></option>';document.getElementById(id).value=value||'';}
        function normSelectValue(v){return String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim().toLowerCase();}
        ${localities}
        prepararNovaParticipacaoPessoa_({id:'P-1',idPessoa:'PES-1',nome:'Pessoa de teste',estado:'RS',cidade:'Caxias do Sul'});
      ` });
      assert.equal(await page.title(), 'IPS — município local');
      assert.equal(await page.locator('#ptCidade').isDisabled(), true);
      assert.equal(await page.evaluate(() => window.participanteValidarLocalidadesFormulario_()), true);
      await page.evaluate(() => window.requests[0].onSuccess([{nome:'Caxias do Sul',codigo:'4305108'}]));
      assert.equal(await page.locator('#ptCidade').getAttribute('data-municipio-codigo'), '4305108');
      await page.evaluate(() => {
        window.participanteDefinirPessoaSomenteLeitura_(false);
        window.participanteInicializarLocalidade_('ptCidade','RS','Grafia histórica','');
      });
      assert.equal(await page.evaluate(() => window.participanteValidarLocalidadesFormulario_()), true);
      await page.locator('#ptCidade').fill('Outra cidade');
      assert.equal(await page.evaluate(() => window.participanteValidarLocalidadesFormulario_()), false, JSON.stringify(await page.locator('#ptCidade').evaluate(el => ({value:el.value,readOnly:el.readOnly,disabled:el.disabled,dataset:el.dataset,ufDisabled:document.getElementById('ptEstado').disabled}))));
      assert.deepEqual(errors, []);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'participant-locality-' + width + '.png'), fullPage: false });
    } finally { await browser.close(); }
  });
}
