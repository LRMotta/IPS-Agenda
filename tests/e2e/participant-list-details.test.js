'use strict';
/* global window, abrirFormPart, salvarPartApp, abrirNovaParticipacaoPessoa */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('Participantes carrega detalhe antes de salvar e preserva campos no desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', r => r.abort());
      const content = readProjectFile('IndexContentAfterStock.html');
      const modal = content.slice(content.indexOf('<div class="modal-overlay" id="modalParticipante"'), content.indexOf('<div class="modal-overlay" id="modalMedico"'));
      await page.setContent('<html><head>' + readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + '</head><body>' + modal + '</body></html>');
      const source = readProjectFile('IndexCoreScripts.html');
      const names = ['participanteBloquearDetalhes_', 'abrirFormPart', 'abrirFormPartPreenchido_', 'participanteDefinirPessoaSomenteLeitura_',
        'participanteMonitorarIdentidadeDoModal_', 'participantePreservarIdentidadeOriginal_', 'renderAcompanhantesPart_', 'lerAcompanhantesPart_',
        'salvarPartApp', 'fecharOverlay', 'abrirNovaParticipacaoPessoa', 'prepararNovaParticipacaoPessoa_'];
      const functions = names.map(name => { const m = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; }).join('\n');
      await page.addScriptTag({ content: `
        var _participanteDetalhesConsulta=null,_participanteDetalhesPendente=false,_participanteDetalhesDisabled=[],_participanteEdicaoAtual=null;
        var BANCOS_PART=['Banco preservado'],STATUS_PART=['Descontinuado'];
        window.requests=[];
        function appServerRun(o){window.requests.push(o);}
        function appClearUnsavedChanges(){} function appConfirmNavigationIfDirty(){return true;}
        function appErrorMessage(e){return e.message;} function snackErro(){}
        function abrirOverlay(id){var el=document.getElementById(id);el.inert=false;el.classList.add('open');}
        function fecharModalSeClicouFora(e,id){if(e.target.id===id)fecharOverlay(id);}
        function dateToInputValue(){return '';} function formatarTelefoneBrasileiro(v){return v||'';}
        function fillSelectOptions(id,values,value){var el=document.getElementById(id);el.replaceChildren();[''].concat(values).forEach(v=>{var o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o);});el.value=value||'';}
        function participanteInicializarLocalidade_(id,uf,cidade,codigo){var el=document.getElementById(id);el.value=cidade;el.dataset.municipioCodigo=codigo;el.disabled=!uf;fillSelectOptions('ptEstado',['RS'],uf);}
        function participantePreencherEstadosBrasilElemento_(el,uf){var o=document.createElement('option');o.value=uf;o.textContent=uf;el.appendChild(o);}
        function participanteFixarMunicipio_(){return true;} function participanteRenderMunicipios_(){}
        function renderBracosParticipante(){} function renderParticipacoesPessoa_(){}
        function preencherProjetosParticipante(v){document.getElementById('ptProjeto').value=v;}
        function atualizarParticipanteIdObrigatorio(){return true;}
        function participanteValidarCpfsDoFormulario_(){return true;} function participanteValidarLocalidadesFormulario_(){return true;}
        function participanteProjetoCadastrado(){return true;} function appRequiredFeedback(){return true;}
        function appSetButtonBusy(btn,busy){btn.disabled=busy;} function appSetStatus(id,s){document.getElementById(id).textContent=s;}
        function participanteStatusEncerrado_(){return true;}
        ${functions}` });
      const detail = { id: '1', idPessoa: 'PES-1', nome: 'Pessoa', idParticipante: 'PT-1', projeto: 'Aurora', status: 'Descontinuado',
        rua: 'Rua preservada', numero: '20', cidade: 'Caxias', estado: 'RS', municipioCodigo: '4305108', banco: 'Banco preservado',
        tipoConta: 'Conta corrente', agencia: '001', contaCorrente: '1234', titularConta: 'Pessoa',
        acompanhantes: [{ id: 'AC-1', nome: 'Acompanhante', banco: 'Banco preservado', contaCorrente: '9876', estado: 'RS', cidade: 'Caxias' }] };
      await page.evaluate(() => abrirFormPart({ id: '1', nome: 'Resumo' }));
      assert.equal(await page.locator('#btnSalvarPart').isDisabled(), true);
      await page.evaluate(() => salvarPartApp());
      assert.equal(await page.evaluate(() => window.requests.length), 1);
      await page.evaluate(d => window.requests[0].onSuccess(d), detail);
      assert.equal(await page.locator('#ptRua').inputValue(), detail.rua);
      assert.equal(await page.locator('#ptBanco').inputValue(), detail.banco);
      assert.equal(await page.locator('#ptAco0_contaCorrente').inputValue(), '9876');
      await page.locator('#btnSalvarPart').click();
      const payload = await page.evaluate(() => window.requests[1].args[0]);
      assert.equal(payload.id, '1');
      assert.equal(payload.projeto, 'Aurora');
      assert.equal(payload.rua, detail.rua);
      assert.equal(payload.contaCorrente, '1234');
      assert.equal(payload.acompanhantes[0].contaCorrente, '9876');
      await page.evaluate(() => abrirNovaParticipacaoPessoa());
      assert.equal(await page.locator('#ptPessoaBaseCadastroId').inputValue(), '1');
      assert.equal(await page.locator('#ptBanco').inputValue(), detail.banco);
      assert.equal(await page.locator('#ptRua').inputValue(), detail.rua);
      assert.equal(await page.locator('#ptNome').getAttribute('readonly'), '');
      await page.evaluate(() => abrirFormPart({ id: '1' }));
      await page.evaluate(() => window.requests[2].onFailure(new Error('Falha simulada')));
      assert.equal(await page.locator('#btnSalvarPart').isDisabled(), true);
      await page.getByRole('button', { name: 'Tentar novamente' }).click();
      await page.evaluate(d => window.requests[3].onSuccess(d), detail);
      assert.equal(await page.locator('#btnSalvarPart').isDisabled(), false);
      assert.equal(await page.locator('#ptBanco').inputValue(), detail.banco);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
