'use strict';
const { readProjectFile } = require('./load-app-script');
const { contentAccessibilitySource } = require('./content-accessibility-source');

async function projectModalBrowserFixture(page) {
  const errors = [];
  await page.route('**/*', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — Projeto e SoA locais</title>' +
    readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
    '</head><body>' + readProjectFile('IndexContent.html') + readProjectFile('IndexContentAfterDashboard.html') +
    readProjectFile('IndexContentAfterStock.html') + '</body></html>');
  const functions = contentAccessibilitySource([
    'appDialogFocusable', 'appFocusDialog', 'appSyncContentFieldAccessibility', 'appSyncAccessibleDialogs',
    'appAccessibleDialogKeydown', 'appInitContentAccessibility', 'abrirOverlay', 'fecharOverlay', 'fecharModalSeClicouFora',
    'appHasUnsavedChanges', 'appOpenUnsavedConfirm', 'fecharConfirmUnsaved', 'appConfirmNavigationIfDirty',
    'appClearUnsavedChanges', 'appMarkUnsavedChanges', 'appSetButtonBusy', 'appRequiredFeedback', 'limparErro',
    'carregarProjetoCaixasTransporte_', 'renderProjetoCaixasTransporte_', 'adicionarProjetoCaixaTransporte',
    'removerProjetoCaixaTransporte', 'alterarProjetoCaixaTransporte', 'validarProjetoCaixasTransporte_',
    'abrirSoAVisitaForm', 'salvarSoAVisitaApp', 'soaSelectedBracos_', 'soaReferenciaAlternativaChange_'
  ]);
  await page.addScriptTag({ content: `
    var APP_ACCESSIBLE_DIALOGS = [], APP_CONTENT_ACCESSIBILITY_READY = false;
    var APP_UNSAVED_SCOPES = {}, APP_UNSAVED_ON_CANCEL = null;
    var COURIERS_PROJ = [{id:'M1',nome:'Marken'}, {id:'O1',nome:'Ocasa'}];
    var LABORATORIOS_TRANSPORTE_PROJ = [{id:'L1',nome:'Laboratório exemplo'}];
    var _projetoCaixasTransporte = [], _projetoCaixasTransporteErro = '', _projetoCaixasTransporteSalvas = [];
    var _soaProjetoAtual = {nomeAbreviado:'PROJETO EXEMPLO'}, testRequests = [];
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];}); }
    function normSelectValue(value) { return String(value || '').toLowerCase(); }
    function appSetStatus(id, message) { document.getElementById(id).textContent = message; }
    function appErrorMessage(error) { return error.message; }
    function appServerRun(options) { testRequests.push(options); }
    function snack() {} function snackErro() {} function carregarSoAVisitasProjeto() {}
    function soaPopulateReferenciaOptions_() { document.getElementById('soaReferencia').innerHTML = '<option value="">Sem referência (legado)</option><option value="V1">V1 — Visita inicial</option>'; }
    function soaPopulateBracosOptions_() { document.getElementById('soaBracosOpcoes').innerHTML = '<label class="soa-arm-option"><input type="checkbox" value="B1"> Braço A</label><label class="soa-arm-option"><input type="checkbox" value="B2"> Braço B</label>'; }
    function soaAtualizarBaseCalculoHelp_() {}
    ${functions}
    appInitContentAccessibility();
    document.querySelectorAll('.page').forEach(function(e) { e.classList.remove('active'); });
    document.getElementById('page-projetos').classList.add('active');
    document.getElementById('topTitle').textContent = 'Projetos';
    document.getElementById('userEmail').textContent = 'Equipe IPS';
    document.getElementById('navCadastrosBody').classList.add('open');
    document.getElementById('bodyProjetos').innerHTML = '<tr><td><strong>PROJETO EXEMPLO</strong></td><td>III</td><td>Oncologia</td><td>Equipe IPS</td><td>—</td><td>—</td><td>—</td><td>Ativo</td><td><button id="fixtureOpenProject">Editar</button></td></tr>';
    document.getElementById('fixtureOpenProject').onclick = function() { abrirOverlay('modalProjeto'); };
    document.getElementById('pNome').value = 'PROJETO EXEMPLO';
    document.getElementById('pFase').value = 'III';
    document.getElementById('pStatus').innerHTML = '<option>Ativo</option>';
    document.getElementById('pCourierPrincipal').innerHTML = '<option>Marken</option>';
    document.getElementById('pSituacaoEnvioAmostras').value = 'Sim';
    document.getElementById('pCourierPrincipalTemperaturas').innerHTML = '<label class="soa-arm-option"><input type="checkbox" checked> Ambiente</label>';
    carregarProjetoCaixasTransporte_(JSON.stringify([{courierId:'M1',temperatura:'AMBIENTE',laboratorioId:'L1',tipoCaixa:'BIOSYSTEM'}]));
  ` });
  return errors;
}

module.exports = { projectModalBrowserFixture };
