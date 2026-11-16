'use strict';
/* global document, agendaParticipanteInfoHtml_, window, abrirFormPart, salvarPartApp, abrirNovaParticipacaoPessoa, participanteRenderHistorico_ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('Participantes carrega detalhe antes de salvar e preserva campos no desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const [width, participantStatus] of [[1280, 'Descontinuado'], [390, 'Descontinuado'], [1280, 'Em acompanhamento de segurança'], [390, 'Em acompanhamento de segurança']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', r => r.abort());
      const content = readProjectFile('IndexContentAfterStock.html');
      const modal = content.slice(content.indexOf('<div class="modal-overlay" id="modalParticipante"'), content.indexOf('<div class="modal-overlay" id="modalMedico"'));
      await page.setContent('<html><head><title>IPS — cadastro local</title>' + readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + '</head><body>' + modal + '</body></html>');
      const source = readProjectFile('IndexCoreScripts.html');
      const names = ['limparErro', 'participanteRenderHistorico_', 'participanteBloquearDetalhes_', 'participanteAvisoCarregando_', 'abrirFormPart', 'abrirFormPartPreenchido_', 'participanteDefinirPessoaSomenteLeitura_',
        'participanteMonitorarIdentidadeDoModal_', 'participantePreservarIdentidadeOriginal_', 'renderAcompanhantesPart_', 'lerAcompanhantesPart_',
        'participantePodeNovaParticipacao_', 'participanteAcompanhantesAbertos_', 'participanteDefinirAcompanhanteAberto_', 'participanteRevelarCampoAcompanhante_',
        'participanteAtualizarReciboPendencias_', 'participanteMonitorarReciboPendencias_', 'participanteResumoCabecalho_', 'salvarPartApp', 'fecharOverlay', 'abrirNovaParticipacaoPessoa', 'prepararNovaParticipacaoPessoa_', 'preencherMarcosParticipacao_', 'lerMarcosParticipacao_'];
      const functions = names.map(name => { const m = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}')); assert.ok(m, name); return m[0]; }).join('\n');
      await page.addScriptTag({ content: `
        var _participanteDetalhesConsulta=null,_participanteDetalhesPendente=false,_participanteDetalhesDisabled=[],_participanteEdicaoAtual=null;
        var BANCOS_PART=['Banco preservado'],STATUS_PART=['Descontinuado','Em acompanhamento de segurança'];
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
        function participanteValidarCpfsDoFormulario_(){return true;} function participanteFormatarEValidarCpf_(){} function participanteValidarCpfCampo_(){return true;}function participanteValidarLocalidadesFormulario_(){return true;}
        function participanteProjetoCadastrado(){return true;} function appRequiredFeedback(entries){window.requiredMissing=entries.filter(e=>!e.value).map(e=>e.label);return !window.requiredMissing.length;}
        function appSetButtonBusy(btn,busy){btn.disabled=busy;} function appSetStatus(id,s){document.getElementById(id).textContent=s;}
        function participanteStatusEncerrado_(){return true;}
        function participacoesDaPessoa_(p){return [p];}
        function normSelectValue(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
        ${functions}` });
      const detail = { sexoNascimento: 'Feminino', id: '1', idPessoa: 'PES-1', nome: 'Pessoa', idParticipante: 'PT-1', projeto: 'Aurora', status: participantStatus,
        rua: 'Rua preservada', numero: '20', cidade: 'Caxias', estado: 'RS', municipioCodigo: '4305108', banco: 'Banco preservado',
        tipoConta: 'Conta corrente', agencia: '001', contaCorrente: '1234', titularConta: 'Pessoa',
        marcosParticipacao: { RANDOMIZACAO: '2026-09-01', ULTIMA_DOSE: '2026-10-01' },
        acompanhantes: [{ id: 'AC-1', nome: 'Acompanhante', banco: 'Banco preservado', contaCorrente: '9876', estado: 'RS', cidade: 'Caxias' }] };
      const historico = { cadastro: { dataHora: '01/10/2026 09:20', responsavel: 'cadastro@exemplo.org' }, ultimaAtualizacao: { dataHora: '15/10/2026 11:40' } };
      await page.evaluate(() => abrirFormPart({ id: '1', nome: 'Resumo' }));
      assert.equal(await page.locator('#btnSalvarPart').isDisabled(), true);
      await page.evaluate(() => salvarPartApp());
      assert.equal(await page.evaluate(() => window.requests.length), 1);
      assert.equal(await page.locator('#ptCarregandoAviso').isVisible(), true);
      await page.evaluate(d => window.requests[0].onSuccess(d), detail);
      assert.equal(await page.locator('#ptCarregandoAviso').isVisible(), false);
      assert.equal(await page.evaluate(() => window.requests[1].method), 'getParticipanteHistoricoCadastro');
      await page.evaluate(h => window.requests[1].onSuccess(h), historico);
      // Cabeçalho identifica o cadastro e as ações ficam visíveis sem rolar o formulário longo.
      assert.equal(await page.locator('#modalPartSub').textContent(), 'Pessoa · Aurora · ID PT-1 · ' + participantStatus);
      const saveBox = await page.locator('#btnSalvarPart').boundingBox();
      assert.ok(saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= 900, 'Salvar fora da área visível');
      assert.equal(await page.locator('#modalParticipante .modal-box').evaluate(el => el.scrollHeight > el.clientHeight), true);
      // Pendências do recibo refletem os campos e acompanham a digitação.
      assert.equal(await page.locator('#ptReciboPendenciasTexto').textContent(), 'Para gerar recibo ainda faltam: CPF, telefone com DDD.');
      await page.locator('#ptCpf').fill('123.456.789-09');
      await page.locator('#ptTelefone').fill('(54) 99999 0000');
      assert.equal(await page.locator('#ptReciboPendenciasTexto').textContent(), 'Dados completos para gerar recibo.');
      await page.locator('#ptCpf').fill('');
      await page.locator('#ptTelefone').fill('');
      // Acompanhante já identificado abre recolhido; campo inválido reabre o cartão em vez de travar o salvamento em silêncio.
      assert.equal(await page.locator('#ptAco0_corpo').isVisible(), false);
      assert.match(await page.locator('.participant-companion-summary').textContent(), /^Acompanhante/);
      await page.locator('#ptAco0_nome').evaluate(el => { el.value = ''; });
      await page.locator('#btnSalvarPart').click();
      assert.equal(await page.evaluate(() => window.requests.length), 2);
      assert.equal(await page.locator('#ptAco0_corpo').isVisible(), true);
      assert.equal(await page.locator('.participant-companion-toggle').getAttribute('aria-expanded'), 'true');
      await page.locator('#ptAco0_nome').fill('Acompanhante');
      await page.locator('.participant-companion-toggle').click();
      assert.equal(await page.locator('#ptAco0_corpo').isVisible(), false);
      await page.screenshot({ path: path.join(process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright'), 'participant-modal-top-' + width + '.png') });
      await page.locator('.participant-companion-toggle').click();
      const sexArtifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(sexArtifacts, { recursive: true });
      await page.locator('#ptSexoNascimento').locator('xpath=../..').screenshot({ path: path.join(sexArtifacts, 'participant-identification-' + width + '.png') });
      assert.equal(await page.locator('#ptHistoricoCadastro').getAttribute('open'), null);
      assert.equal(await page.locator('#ptCadastroData').isVisible(), false);
      assert.equal(await page.locator('#ptHistoricoCadastro').evaluate(el => el.previousElementSibling.textContent.includes('Observações')), true);
      await page.locator('#ptHistoricoCadastro summary').click();
      assert.equal(await page.locator('#ptCadastroData').isVisible(), true);
      assert.equal(await page.locator('#ptCadastroData').textContent(), '01/10/2026 09:20');
      assert.equal(await page.locator('#ptCadastroResponsavel').textContent(), 'cadastro@exemplo.org');
      assert.equal(await page.locator('#ptAtualizacaoData').textContent(), '15/10/2026 11:40');
      assert.equal(await page.locator('#ptHistoricoCadastro').evaluate(el => el.scrollWidth > el.clientWidth), false);
      const auditArtifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(auditArtifacts, { recursive: true });
      await page.locator('#modalParticipante').evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)); });
      await page.screenshot({ path: path.join(auditArtifacts, 'participant-audit-' + width + '.png') });
      assert.equal(await page.locator('#ptSexoNascimento').inputValue(), detail.sexoNascimento);
      assert.equal(await page.locator('#ptRua').inputValue(), detail.rua);
      assert.equal(await page.locator('#ptBanco').inputValue(), detail.banco);
      assert.equal(await page.locator('#ptAco0_contaCorrente').inputValue(), '9876');
      assert.equal(await page.locator('#ptMarcoRANDOMIZACAO').inputValue(), '2026-09-01');
      await page.locator('#ptMarcoDECISAO_INTERRUPCAO_TRATAMENTO').fill('2026-10-03');
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — cadastro local');
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
      await page.locator('.participant-milestones-section').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('.participant-milestones-section').evaluate(el => el.scrollWidth > el.clientWidth), false);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'participant-milestones-' + width + '.png') });
      await page.locator('#ptSexoNascimento').selectOption('');
      await page.locator('#btnSalvarPart').click();
      assert.equal(await page.evaluate(() => window.requests.length), 2);
      await page.locator('#ptSexoNascimento').selectOption('Feminino');
      // CPF e telefone vazios bloqueiam o salvamento e destacam os campos.
      await page.locator('#btnSalvarPart').click();
      assert.equal(await page.evaluate(() => window.requests.length), 2);
      assert.deepEqual(await page.evaluate(() => window.requiredMissing), ['CPF', 'Telefone']);
      assert.equal(await page.locator('#ptCpf').getAttribute('aria-required'), 'true');
      assert.equal(await page.locator('#ptTelefone').getAttribute('aria-required'), 'true');
      await page.locator('#ptCpf').fill('123.456.789-09');
      await page.locator('#ptTelefone').fill('(54) 99999 0000');
      await page.locator('#btnSalvarPart').click();
      const payload = await page.evaluate(() => window.requests[2].args[0]);
      assert.equal(payload.sexoNascimento, 'Feminino');
      assert.equal(payload.cpf, '123.456.789-09');
      assert.equal(payload.telefone, '(54) 99999 0000');
      assert.equal(payload.id, '1');
      assert.equal(payload.projeto, 'Aurora');
      assert.equal(payload.rua, detail.rua);
      assert.equal(payload.contaCorrente, '1234');
      assert.equal(payload.acompanhantes[0].contaCorrente, '9876');
      assert.deepEqual(payload.marcosParticipacao, { DECISAO_INTERRUPCAO_TRATAMENTO: '2026-10-03' });
      assert.deepEqual(payload.marcosParticipacaoBase, { DECISAO_INTERRUPCAO_TRATAMENTO: '' });
      await page.evaluate(() => abrirNovaParticipacaoPessoa());
      assert.equal(await page.locator('#ptHistoricoCadastro').isVisible(), false);
      assert.equal(await page.locator('#ptPessoaBaseCadastroId').inputValue(), '1');
      assert.equal(await page.locator('#ptBanco').inputValue(), detail.banco);
      assert.equal(await page.locator('#ptSexoNascimento').inputValue(), detail.sexoNascimento);
      assert.equal(await page.locator('#ptRua').inputValue(), detail.rua);
      assert.equal(await page.locator('#ptNome').getAttribute('readonly'), '');
      assert.equal(await page.locator('#ptMarcoRANDOMIZACAO').inputValue(), '');
      assert.equal(await page.locator('#ptMarcoULTIMA_DOSE').inputValue(), '');
      await page.evaluate(() => abrirFormPart({ id: '1' }));
      await page.evaluate(() => window.requests[3].onFailure(new Error('Falha simulada')));
      assert.equal(await page.locator('#btnSalvarPart').isDisabled(), true);
      await page.getByRole('button', { name: 'Tentar novamente' }).click();
      await page.evaluate(d => window.requests[4].onSuccess(d), detail);
      assert.equal(await page.locator('#btnSalvarPart').isDisabled(), false);
      assert.equal(await page.locator('#ptHistoricoCadastro').getAttribute('open'), null);
      assert.equal(await page.locator('#ptBanco').inputValue(), detail.banco);
      await page.evaluate(() => participanteRenderHistorico_({ id: '1' }));
      assert.equal(await page.locator('#ptCadastroData').textContent(), 'Não disponível');
      assert.equal(await page.locator('#ptAtualizacaoData').textContent(), 'Não disponível');
      await page.evaluate(() => participanteRenderHistorico_({ id: '1', historicoCadastro: { indisponivel: true } }));
      assert.match(await page.locator('#ptHistoricoNota').textContent(), /Não foi possível consultar/);
      await page.evaluate(() => participanteRenderHistorico_({ id: '1', historicoCadastro: { cadastro: { responsavel: '<img src=x onerror=alert(1)>' } } }));
      assert.equal(await page.locator('#ptCadastroResponsavel img').count(), 0);
      assert.match(await page.locator('#ptCadastroResponsavel').textContent(), /<img/);
      const agenda = readProjectFile('IndexAgendaScripts.html');
      const renderInfo = agenda.match(/  function agendaParticipanteInfoHtml_\([^]*?\n  \}/)[0];
      await page.addScriptTag({content: `function esc(s){return String(s).replace(/</g,'&lt;');} function agendaIntervaloDesdeUltimaVisita_(){return '';} ${renderInfo}`});
      await page.evaluate(() => {
        const box=document.createElement('div'); box.id='sexoAgenda';
        box.innerHTML=agendaParticipanteInfoHtml_({sexoNascimento:'Feminino',numId:'PT-1'});
        document.body.appendChild(box);
      });
      assert.match(await page.locator('#sexoAgenda').textContent(), /Sexo no nascimento: Feminino/);
      await page.evaluate(() => document.getElementById('sexoAgenda').innerHTML=agendaParticipanteInfoHtml_({}));
      assert.match(await page.locator('#sexoAgenda').textContent(), /Pendente de preenchimento/);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
