'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

function stockData(overrides = {}) {
  return { configured:true, farmaciaAccess:'manage', locationsConfigured:true, locationsCanManage:false,
    storageUnits:[{id:'UNIT-1',code:'IPS AF-01',model:'Armário',room:'Farmácia',min:15,max:30,status:'active',positions:['Prateleira 1'],source:'Documento fictício',version:'1',revision:1}],
    products:[{ id:'PR1', name:'Produto fictício', category:'medicine', productCode:'', barcode:'', dosageForm:'', strength:'', route:'', presentation:'Frasco de teste', unit:'frasco', control:'quantity' }],
    positions:[{ id:'IN1', productId:'PR1', lot:'L-TESTE', expiry:'2027-10-31', location:'Armário A', kit:'', physical:10, available:8, blocked:2,
      countedOn:'2026-10-21', author:'farmacia@example.invalid', registeredAt:'2026-10-21T12:00:00.000Z' }], ...overrides };
}

async function fixture(browser, width) {
  // Browser plugin not available. HTML/CSS/JS reais, RPCs simuladas e rede bloqueada.
  const page = await browser.newPage({ viewport:{ width, height:1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/*', request => request.abort());
  await page.clock.install({ time:new Date('2026-10-21T15:00:00Z') });
  const html = readProjectFile('IndexContent.html');
  const iconFont = process.env.FARMACIA_TEST_ICON_FONT;
  // Capturas podem usar cópia local da fonte do app; a fixture continua sem rede.
  const iconStyle = iconFont ? '<style>@font-face{font-family:"Material Symbols Outlined";src:url(data:font/ttf;base64,' + fs.readFileSync(iconFont).toString('base64') + ') format("truetype");}.material-symbols-outlined{font-family:"Material Symbols Outlined";font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;font-feature-settings:"liga";}</style>' : '<style>.material-symbols-outlined{font-size:0!important}</style>';
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS | Farmácia — estoque local</title>' + readProjectFile('IndexStyles.html') +
    readProjectFile('IndexStylesAfterDashboard.html') + iconStyle + '</head><body>' + html +
    readProjectFile('IndexContentAfterDashboard.html') + readProjectFile('IndexContentAfterStock.html') + '</body></html>');
  const initialNavigation=await page.evaluate(()=>({sectionDisplay:window.getComputedStyle(document.getElementById('navFarmaciaSection')).display,
    toggleDisplay:window.getComputedStyle(document.getElementById('navFarmacia')).display,
    equipmentHidden:document.querySelector('[data-farmacia-view="equipment"]').hidden,
    probesHidden:document.querySelector('[data-farmacia-view="probes"]').hidden,
    stockHidden:document.querySelector('[data-farmacia-view="stock"]').hidden,
    productsHidden:document.querySelector('[data-farmacia-view="products"]').hidden}));
  await page.addScriptTag({ content:`
    var FARMACIA_STUDY_REQUEST_ID=0, FARMACIA_REQUEST_ID=1, pending=[], currentPage='farmacia';
    function getCurrentPage(){return currentPage;}
    function irPara(page){currentPage=page;}
    function abrirOverlay(id){document.getElementById(id).classList.add('open');}
    function fecharModalSeClicouFora(event,id){if(event.target.id===id)fecharOverlay(id);}
    function snackErro(message){throw new Error(message);}
    var APP_ACCESSIBLE_DIALOGS=[], APP_CONTENT_ACCESSIBILITY_READY=false, APP_UNSAVED_SCOPES={}, APP_UNSAVED_ON_CANCEL=null;
    function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function appErrorMessage(error){return error.message;}
    function runner(success,failure){return new Proxy({}, {get(target,method){
      if(method==='withSuccessHandler')return fn=>runner(fn,failure);
      if(method==='withFailureHandler')return fn=>runner(success,fn);
      return (...args)=>pending.push({method,args,success,failure});
    }});}
    var google={script:{run:runner()}};
    ${contentAccessibilitySource(['farmaciaAccessLabel','selecionarFarmaciaStudy','renderFarmaciaStudies','farmaciaStudyLabel','abrirFarmaciaView','toggleNavFarmacia','appSyncNavAccessibility','setMobileNav','closeMobileNav','toggleMobileNav','appDialogFocusable','appFocusDialog','appSyncContentFieldAccessibility','appSyncAccessibleDialogs','appAccessibleDialogKeydown','appInitContentAccessibility','appHasUnsavedChanges','appMarkUnsavedChanges','appClearUnsavedChanges','appEditableDirtyScope','appConfirmNavigationIfDirty','appOpenUnsavedConfirm','fecharConfirmUnsaved','fecharOverlay','appSetStatus','appSetInlineStatusMessage'])}
    document.addEventListener('input',event=>{const id=appEditableDirtyScope(event.target);if(id)appMarkUnsavedChanges(id);},true);
    document.addEventListener('change',event=>{const id=appEditableDirtyScope(event.target);if(id)appMarkUnsavedChanges(id);},true);
    appInitContentAccessibility();
  ` });
  await page.addScriptTag({ content:readProjectFile('IndexFarmaciaScripts.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '') });
  await page.addScriptTag({content:readProjectFile('IndexFarmaciaViewScripts.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
  await page.addScriptTag({content:readProjectFile('IndexFarmaciaLocationActions.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
  await page.addScriptTag({content:readProjectFile('IndexFarmaciaActions.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
  await page.evaluate(() => {
    document.getElementById('page-farmacia').classList.add('active');
    document.getElementById('navFarmaciaSection').style.display='';
    document.getElementById('navFarmacia').style.display='';
    document.getElementById('topTitle').textContent='Farmácia';
    document.querySelectorAll('[data-farmacia-view="stock"],[data-farmacia-view="products"]').forEach(button=>button.hidden=false);
    window.farmaciaSetView('stock');
    const select=document.getElementById('farmaciaStudy');
    select.disabled=false; select.innerHTML='<option value="">Selecione</option><option value="P1">Estudo A</option><option value="P2">Estudo B</option>';
  });
  if (iconFont) await page.evaluate(()=>document.fonts.ready);
  return { page, errors, initialNavigation };
}

test('edição de equipamento acrescenta gaveta e mantém posições ao salvar em desktop/celular', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width);
      const data=stockData({locationsCanManage:true});
      await openStock(page,data);
      await chooseView(page,'equipment');
      await page.getByRole('button',{name:'Editar equipamento IPS AF-01',exact:true}).click();
      const field=page.getByLabel('Posições (uma por linha)',{exact:true});
      assert.equal(await field.inputValue(),'Prateleira 1');
      await field.fill('Prateleira 1\nGaveta 39');
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-editar-posicoes-'+width+'.png')});
      await page.locator('#farmaciaModal-unitDetail').getByRole('button',{name:'Salvar alterações',exact:true}).click();
      const request=await page.evaluate(()=>({method:window.pending.at(-1).method,payload:window.pending.at(-1).args[0]}));
      assert.equal(request.method,'editarRegistroCatalogoFarmacia');
      assert.equal(request.payload.data.revision,1);
      assert.deepEqual(request.payload.data.values.positions,['Prateleira 1','Gaveta 39']);
      await page.evaluate(()=>window.pending.at(-1).failure({message:'O registro mudou. Atualize o catálogo.'}));
      assert.match(await page.locator('#farmaciaModal-unitDetail .farmacia-dialog-status').innerText(),/registro mudou/);
      assert.equal(await field.inputValue(),'Prateleira 1\nGaveta 39');
      await page.locator('#farmaciaModal-unitDetail').getByRole('button',{name:'Salvar alterações',exact:true}).click();
      await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
      data.storageUnits[0].positions.push('Gaveta 39'); data.storageUnits[0].revision=2;
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      await page.getByRole('button',{name:'Ver equipamento IPS AF-01',exact:true}).click();
      assert.match(await page.locator('#farmaciaUnitDetail').innerText(),/Gaveta 39/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser.close();}
});

test('gavetas numeradas criam 1 × 5 e editam 3 × 13 com total contínuo e ações no rodapé', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width), data=stockData({locationsCanManage:true});
      data.storageUnits[0].positions=['1','2','3','4','5'];
      data.storageUnits[0].layout={columns:1,drawersPerColumn:5};
      await openStock(page,data);
      await openForm(page,'equipment');
      await page.locator('#farmaciaLocationCode').fill('REF-01');
      await page.locator('#farmaciaLocationType').selectOption('refrigerator');
      await page.locator('#farmaciaLocationRoom').fill('Farmácia');
      await page.getByLabel('Colunas',{exact:true}).fill('1');
      await page.getByLabel('Gavetas por coluna',{exact:true}).fill('5');
      await page.getByRole('button',{name:'Cadastrar equipamento',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'cadastrarLocalFarmacia');
      const created=await page.evaluate(()=>window.pending.at(-1).args[0].data);
      assert.equal(await page.getByLabel('Colunas',{exact:true}).isDisabled(),true);
      assert.equal(await page.getByLabel('Gavetas por coluna',{exact:true}).isDisabled(),true);
      assert.deepEqual(created.layout,{columns:1,drawersPerColumn:5});
      assert.deepEqual(created.positions,['1','2','3','4','5']);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      await page.getByRole('button',{name:'Editar equipamento IPS AF-01',exact:true}).click();
      const modal=page.locator('#farmaciaModal-unitDetail');
      assert.equal(await modal.getByLabel('Colunas',{exact:true}).inputValue(),'1');
      assert.equal(await modal.locator('form > button').count(),0);
      assert.equal(await modal.getByText('Referência documental',{exact:true}).count(),0);
      assert.equal(await modal.getByText('Versão da referência',{exact:true}).count(),0);
      assert.equal(await modal.locator('.farmacia-dialog-actions').getByRole('button',{name:'Alterar situação',exact:true}).count(),1);
      await modal.getByLabel('Colunas',{exact:true}).fill('3');
      await modal.getByLabel('Gavetas por coluna',{exact:true}).fill('13');
      assert.match(await modal.locator('[data-position-summary]').innerText(),/39 gavetas.*1 a 39/);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-editar-gavetas-'+width+'.png')});
      await modal.getByLabel('Gavetas por coluna',{exact:true}).fill('40');
      const count=await page.evaluate(()=>window.pending.length);
      await modal.getByRole('button',{name:'Salvar alterações',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.length),count);
      await modal.getByLabel('Gavetas por coluna',{exact:true}).fill('13');
      await modal.getByRole('button',{name:'Salvar alterações',exact:true}).click();
      const saved=await page.evaluate(()=>window.pending.at(-1).args[0].data.values);
      assert.deepEqual(saved.layout,{columns:3,drawersPerColumn:13});
      assert.deepEqual(saved.positions,Array.from({length:39},(_,i)=>String(i+1)));
      assert.equal(Object.hasOwn(saved,'source'),false); assert.equal(Object.hasOwn(saved,'version'),false);
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada'}));
      assert.equal(await modal.getByLabel('Colunas',{exact:true}).inputValue(),'3');
      assert.equal(await modal.getByLabel('Gavetas por coluna',{exact:true}).inputValue(),'13');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

async function openStock(page, data, id = 'P1') {
  await page.locator('#farmaciaStudy').selectOption(id);
  await page.evaluate(studyId => window.pending.at(-1).success({ study:{ id:studyId, nome:'Estudo fictício' }, farmaciaAccess:'manage', restrictedAllowed:true }), id);
  await page.evaluate(result => window.pending.at(-1).success(result), data);
}

test('seleção de produtos consulta direto, mostra erro de leitura, permite tentar novamente e descarta falha obsoleta', async () => {
  const browser = await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors} = await fixture(browser,width);
      await chooseView(page,'products');
      await page.locator('#farmaciaStudy').selectOption('P1');
      assert.equal(await page.locator('#farmaciaNoSelection').isVisible(),false);
      assert.equal(await page.locator('#farmaciaStockStatus').innerText(),'Carregando produtos…');
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha temporária ao validar o acesso.'}));
      assert.equal(await page.locator('#farmaciaStockStatus').isVisible(),true);
      assert.match(await page.locator('#farmaciaStockStatus').innerText(),/Falha temporária/);
      assert.equal(await page.locator('#farmaciaStudy').inputValue(),'P1');
      assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),false);
      await page.getByRole('button',{name:'Atualizar estoque',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaProdutos');
      await page.evaluate(result=>window.pending.at(-1).success(result),stockData());
      assert.equal(await page.locator('#farmaciaStockPanel').isVisible(),true);
      assert.equal(await page.locator('#farmaciaStockStatus').innerText(),'');
      assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),true);
      assert.equal(await page.locator('#farmaciaRestrictedLabel').isVisible(),false);
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright');
      fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({path:path.join(artifacts,'farmacia-acesso-recuperado-'+width+'.png')});
      await page.locator('#farmaciaStudy').selectOption('P2');
      const oldRequest=await page.evaluate(()=>window.pending.length-1);
      await page.locator('#farmaciaStudy').selectOption('P1');
      await page.evaluate(index=>window.pending[index].failure({message:'Erro de outra seleção'}),oldRequest);
      assert.equal(await page.locator('#farmaciaStockStatus').innerText(),'Carregando produtos…');
      await page.locator('#farmaciaStudy').selectOption('');
      assert.equal(await page.locator('#farmaciaStockStatus').innerText(),'');
      assert.equal(await page.locator('#farmaciaNoSelection').isVisible(),true);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser.close();}
});

test('Farmácia navega por área, mantém estoque, filtra tabelas e apresenta configuração pendente sem blocos vazios', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width);
      assert.equal(await page.locator('#topTitle').textContent(),'Farmácia › Estoque');
      assert.equal(await page.locator('#farmaciaRefreshAction').isVisible(),true);
      assert.equal(await page.locator('#topIcon').innerText(),'local_pharmacy');
      assert.equal(await page.locator('#farmaciaViewTitle').isVisible(),false);
      assert.equal(await page.locator('#farmaciaViewDescription').isVisible(),false);
      assert.equal(await page.locator('#page-farmacia h1, #page-farmacia h2, #page-farmacia h3').filter({hasText:'Farmácia'}).count(),0);
      assert.equal(await page.locator('#navFarmaciaSection .nav-section').innerText(),'FARMÁCIA');
      await openStock(page,stockData({configured:false,locationsConfigured:false,products:[],positions:[],storageUnits:[],locationsCanManage:true}));
      assert.equal(await page.locator('#farmaciaInventoryResults table').count(),0);
      assert.match(await page.locator('#farmaciaInventoryResults').innerText(),/Estoque ainda não configurado/);
      assert.equal(await page.locator('#farmaciaMetric0').innerText(),'—');
      assert.equal(await page.locator('#farmaciaPrimaryAction').isDisabled(),true);
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-redesign-pendente-'+width+'.png')});
      const data=stockData({locationsCanManage:true});
      data.products.push({id:'PR2',name:'Seringa de demonstração',presentation:'10 mL',unit:'unidade',control:'quantity'});
      data.storageUnits[0].probes=[{id:'PROBE-1',unitId:'UNIT-1',code:'SONDA-01',serial:'SERIE-FICTICIA',model:'Modelo de demonstração',point:'Superior',revision:1,calibrationStatus:'expired',calibration:{status:'current',calibratedOn:'2026-01-01',validUntil:'2026-10-20',certificate:'CERT-FICTICIO',note:''}}];
      await page.locator('button[aria-label="Atualizar estoque"]').click();
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      const count=await page.evaluate(()=>window.pending.length);
      await chooseView(page,'products');
      assert.equal(await page.locator('#topTitle').textContent(),'Farmácia › Produtos');
      assert.equal(await page.locator('#topIcon').innerText(),'local_pharmacy');
      assert.equal(await page.locator('#farmaciaViewTitle').isVisible(),false);
      assert.equal(await page.locator('#farmaciaViewDescription').isVisible(),false);
      assert.equal(await page.locator('#farmaciaProductsResults').isVisible(),true);
      assert.equal(await page.locator('#farmaciaInventoryResults').isVisible(),false);
      await page.locator('#farmaciaSearch').fill('seringa');
      assert.equal(await page.locator('#farmaciaProductsResults tr[data-farmacia-row]:visible').count(),1);
      await page.locator('#farmaciaSearch').fill('inexistente');
      assert.equal(await page.locator('#farmaciaSearchEmpty').isVisible(),true);
      await chooseView(page,'probes');
      assert.equal(await page.locator('#farmaciaRefreshAction').isVisible(),false);
      assert.equal(await page.locator('#farmaciaStudy').inputValue(),'P1');
      assert.equal(await page.locator('#farmaciaSearch').inputValue(),'');
      assert.equal(await page.locator('[data-farmacia-view="probes"]').getAttribute('aria-current'),'page');
      assert.equal(await page.evaluate(()=>window.pending.length),count,'troca de área não dispara consulta ou altera dados');
      assert.equal(await page.locator('#farmaciaMetric2').innerText(),'1');
      assert.match(await page.locator('#farmaciaProbesResults').innerText(),/Vencida/);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-redesign-sondas-'+width+'.png')});
      await chooseView(page,'equipment');
      assert.equal(await page.locator('#farmaciaRefreshAction').isVisible(),false);
      assert.equal(await page.locator('#farmaciaMetric0').innerText(),'1');
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-redesign-equipamentos-'+width+'.png')});
      await page.getByRole('button',{name:'Ver equipamento IPS AF-01'}).click();
      assert.equal(await page.locator('#farmaciaModal-unitDetail').getAttribute('inert'),null);
      assert.match(await page.locator('#farmaciaUnitDetail').innerText(),/Prateleira 1/);
      await page.locator('#farmaciaModal-unitDetail .modal-close').click();
      await openForm(page,'equipment');
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-redesign-modal-'+width+'.png')});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('Farmácia e catálogo aparecem no shell antes do perfil e a carga retoma após a validação', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1280,390]) {
      const {page,errors,initialNavigation}=await fixture(browser,width);
      assert.notEqual(initialNavigation.sectionDisplay,'none'); assert.notEqual(initialNavigation.toggleDisplay,'none');
      assert.equal(initialNavigation.equipmentHidden,false); assert.equal(initialNavigation.probesHidden,false);
      assert.equal(initialNavigation.stockHidden,true); assert.equal(initialNavigation.productsHidden,true);
      await page.addScriptTag({content:readProjectFile('SharedAccessRules.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
      await page.addScriptTag({content:`
        var CURRENT_ACCESS={ok:false,email:'',role:'',farmaciaAccess:'none',farmaciaCommonAccess:'none'};
        function snack() {} function renderAppVersion() {} function startAppVersionWatcher() {}
        function updateFloatingAddButton() {} function handleUserOAuthStatus() {} function appApplyTeamBirthdays_() {}
        ${contentAccessibilitySource(['applyAppBootstrapData','applyFarmaciaAccess','carregarFarmacia'])}
        applyFarmaciaAccess();
      `});
      if (width<900) await page.locator('#mobileMenuBtn').click();
      assert.equal(await page.locator('#navFarmacia').isVisible(),true);
      assert.equal(await page.locator('[data-farmacia-view="equipment"]').isVisible(),true);
      assert.equal(await page.locator('[data-farmacia-view="probes"]').isVisible(),true);
      assert.equal(await page.evaluate(()=>window.pending.length),0);
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-menu-inicial-'+width+'.png')});
      await page.locator('[data-farmacia-view="equipment"]').click();
      assert.equal(await page.evaluate(()=>window.pending.length),0,'menu funciona antes do perfil; consultas aguardam sua validação');
      assert.equal(await page.locator('#topTitle').textContent(),'Farmácia › Equipamentos');
      assert.equal(await page.locator('#farmaciaPrimaryAction').isEnabled(),false);
      await page.evaluate(()=>window.applyAppBootstrapData({access:{ok:true,email:'teste@example.invalid',role:'user',farmaciaAccess:'none',farmaciaCommonAccess:'none'}}));
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaBootstrap');
      assert.equal(await page.evaluate(()=>window.FARMACIA_CATALOG.data),null);
      await page.evaluate(()=>window.pending.at(-1).success({farmaciaAccess:'none',farmaciaCommonAccess:'none',studies:[]}));
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaCatalogo');
      await page.evaluate(()=>window.pending.at(-1).success({locationsConfigured:true,locationsCanManage:true,storageUnits:[]}));
      assert.equal(await page.locator('#farmaciaLocationsResults .empty-row').innerText(),'Nenhum equipamento cadastrado');
      assert.equal(await page.locator('[data-farmacia-view="stock"]').evaluate(el=>el.hidden),true);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('catálogo aberto a usuários sem concessão de Farmácia usa título e ícone da seção sem texto extra', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1280,390]) for (const role of ['user','readonly']) {
      const {page,errors}=await fixture(browser,width);
      await page.addScriptTag({content:readProjectFile('SharedAccessRules.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
      await page.addScriptTag({content:`
        var CURRENT_ACCESS={ok:true,email:'teste@example.invalid',role:'${role}',farmaciaAccess:'none',farmaciaCommonAccess:'none'};
        function snack() {}
        ${contentAccessibilitySource(['applyFarmaciaAccess','carregarFarmacia'])}
        applyFarmaciaAccess(); carregarFarmacia();
      `});
      assert.equal(await page.locator('#navFarmaciaSection').evaluate(el=>el.style.display),'');
      assert.equal(await page.locator('[data-farmacia-view="stock"]').evaluate(el=>el.hidden),true);
      assert.equal(await page.locator('[data-farmacia-view="products"]').evaluate(el=>el.hidden),false);
      await page.evaluate(()=>window.pending.at(-1).success({farmaciaAccess:'none',farmaciaCommonAccess:'none',studies:[]}));
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaCatalogo');
      assert.equal(await page.locator('#farmaciaViewDescription').isVisible(),false);
      assert.equal(await page.locator('#farmaciaLocationsResults .loading-row .spinner').isVisible(),true);
      assert.match(await page.locator('#farmaciaLocationsResults thead').innerText(),/equipamento/i);
      assert.equal(await page.locator('#farmaciaLocationsResults thead').isVisible(),width>700);
      if (width<700) assert.equal(await page.locator('#farmaciaLocationsResults table').evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth),true);
      assert.equal(await page.locator('#farmaciaStockStatus').innerText(),'');
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-catalogo-carregando-'+role+'-'+width+'.png')});
      await page.evaluate(canManage=>window.pending.at(-1).success({locationsConfigured:true,locationsCanManage:canManage,storageUnits:[]}),role==='user');
      assert.equal(await page.locator('#farmaciaLocationsResults .empty-row').innerText(),'Nenhum equipamento cadastrado');
      assert.equal(await page.locator('#farmaciaLocationsResults .farmacia-empty').count(),0);
      assert.equal(await page.locator('#farmaciaLocationsResults .loading-row').count(),0);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-catalogo-equipamentos-'+role+'-'+width+'.png')});
      assert.equal(await page.locator('#topTitle').textContent(),'Farmácia › Equipamentos');
      assert.equal(await page.locator('#topIcon').textContent(),'local_pharmacy');
      assert.equal(await page.locator('#farmaciaContext').isVisible(),false);
      assert.equal(await page.getByText('Equipamentos e sondas compartilhados entre todos os projetos.',{exact:true}).count(),0);
      assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),role==='user');
      assert.equal(await page.locator('#farmaciaPrimaryAction').isEnabled(),role==='user');
      await chooseView(page,'probes');
      assert.equal(await page.locator('#topTitle').textContent(),'Farmácia › Sondas e calibração');
      assert.equal(await page.locator('#topIcon').textContent(),'local_pharmacy');
      assert.equal(await page.locator('#farmaciaViewTitle').isVisible(),false);
      assert.equal(await page.locator('#farmaciaViewDescription').isVisible(),false);
      assert.equal(await page.locator('#farmaciaProbesResults .empty-row').innerText(),'Nenhuma sonda cadastrada');
      assert.equal(await page.locator('#farmaciaProbesResults .farmacia-empty').count(),0);
      assert.equal(await page.locator('#farmaciaStockSelector').isVisible(),false);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-catalogo-aberto-'+role+'-'+width+'.png')});
      assert.equal(await page.evaluate(()=>window.pending.some(item=>item.method==='getFarmaciaEstoque'||item.method==='getFarmaciaEstudo')),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('bootstrap atrasado preserva formulário e acompanhamento do salvamento do catálogo', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280);
    await page.addScriptTag({content:readProjectFile('SharedAccessRules.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
    await page.addScriptTag({content:`
      var CURRENT_ACCESS={ok:true,email:'teste@example.invalid',role:'user',farmaciaAccess:'none',farmaciaCommonAccess:'none'};
      function snack() {}
      ${contentAccessibilitySource(['applyFarmaciaAccess','carregarFarmacia'])}
      applyFarmaciaAccess(); carregarFarmacia();
    `});
    await chooseView(page,'equipment');
    await page.evaluate(()=>window.pending[1].success({locationsConfigured:true,locationsCanManage:true,storageUnits:[]}));
    await openForm(page,'equipment');
    await page.locator('#farmaciaLocationCode').fill('PRESERVAR');
    await page.evaluate(()=>window.farmaciaStockSave('location',{code:'PRESERVAR'}));
    const epoch=await page.evaluate(()=>window.FARMACIA_STOCK.epoch);
    await page.evaluate(()=>window.pending[0].success({farmaciaAccess:'none',farmaciaCommonAccess:'none',studies:[]}));
    assert.equal(await page.locator('#farmaciaLocationCode').inputValue(),'PRESERVAR');
    assert.equal(await page.locator('#farmaciaModal-location').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.FARMACIA_STOCK.epoch),epoch);
    assert.equal(await page.evaluate(()=>window.FARMACIA_STOCK.saving),true);
    assert.equal(await page.evaluate(()=>window.pending[2].method),'cadastrarLocalFarmacia');
    await page.evaluate(()=>window.pending[2].success({ok:true}));
    assert.equal(await page.evaluate(()=>window.FARMACIA_STOCK.saving),false);
    assert.equal(await page.locator('#farmaciaModal-location').evaluate(el=>el.classList.contains('open')),false);
    assert.equal(await page.locator('#farmaciaModal-location').getAttribute('inert'),'');
    assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaCatalogo');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('catálogo sem seleção descarta respostas após sair da área ou revalidar acesso e permite retomar leitura', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280);
    await chooseView(page,'equipment');
    assert.equal(await page.locator('#farmaciaNoSelection').isVisible(),false);
    await chooseView(page,'products');
    await page.evaluate(result=>window.pending[0].success(result),stockData({locationsCanManage:true}));
    assert.equal(await page.locator('#farmaciaNoSelection').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.FARMACIA_CATALOG.data),null);
    await chooseView(page,'probes');
    await page.evaluate(()=>window.farmaciaEstoqueReset());
    await page.evaluate(result=>window.pending[1].success(result),stockData({locationsCanManage:true}));
    assert.equal(await page.evaluate(()=>window.FARMACIA_CATALOG.data),null);
    await chooseView(page,'probes');
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada do catálogo'}));
    assert.match(await page.locator('#farmaciaStockStatus').innerText(),/Falha simulada/);
    assert.equal(await page.locator('#farmaciaPrimaryAction').isEnabled(),false);
    await chooseView(page,'equipment');
    await page.evaluate(result=>window.pending.at(-1).success(result),stockData({locationsCanManage:true}));
    assert.equal(await page.locator('#farmaciaStockSelector').isVisible(),false);
    assert.equal(await page.locator('#farmaciaPrimaryAction').isEnabled(),true);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('seleção de projeto atrasada não apaga cadastro do catálogo e estoque retoma sua seleção', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280);
    await page.locator('#farmaciaStudy').selectOption('P1');
    await chooseView(page,'equipment');
    await page.evaluate(result=>window.pending[1].success(result),stockData({locationsCanManage:true}));
    await openForm(page,'equipment');
    await page.locator('#farmaciaLocationCode').fill('EM-PREENCHIMENTO');
    await page.evaluate(()=>window.pending[0].success({study:{id:'P1',nome:'Estudo atrasado'},farmaciaAccess:'manage',restrictedAllowed:true}));
    assert.equal(await page.locator('#farmaciaModal-location').isVisible(),true);
    assert.equal(await page.locator('#farmaciaLocationCode').inputValue(),'EM-PREENCHIMENTO');
    assert.equal(await page.evaluate(()=>window.pending.length),2);
    await page.evaluate(()=>window.farmaciaCloseDialogs());
    await chooseView(page,'stock');
    assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaEstudo');
    await page.evaluate(()=>window.pending.at(-1).success({study:{id:'P1',nome:'Estudo A'},farmaciaAccess:'manage',restrictedAllowed:true}));
    await page.evaluate(result=>window.pending.at(-1).success(result),stockData());
    assert.equal(await page.locator('#farmaciaStockSelector').isVisible(),true);
    assert.equal(await page.locator('#farmaciaStudy').inputValue(),'P1');
    assert.equal(await page.locator('#farmaciaInventoryResults table').isVisible(),true);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('modal da Farmácia usa foco/dirty reais, bloqueia fechamento em voo e preserva formulário após falha', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280);
    await openStock(page,stockData());
    await openForm(page,'products');
    await page.waitForFunction(()=>document.activeElement.id==='farmaciaProductCategory');
    assert.equal(await page.locator('#farmaciaModal-product .modal-box').getAttribute('aria-modal'),'true');
    await page.locator('#farmaciaProductForm button[type=submit]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.className),'modal-close');
    await page.locator('#farmaciaProductCategory').selectOption('medicine');
    await page.locator('#farmaciaProductName').fill('Produto em edição');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#confirmUnsaved').isVisible(),true);
    await page.getByRole('button',{name:'Continuar editando'}).click();
    assert.equal(await page.locator('#farmaciaProductName').inputValue(),'Produto em edição');
    await page.locator('#farmaciaProductPresentation').fill('Frasco');
    await page.locator('#farmaciaProductInstructions').fill('Instrução fictícia');
    assert.equal(await page.locator('#farmaciaProductSupply').inputValue(),'');
    const requestsBeforeSupply=await page.evaluate(()=>window.pending.length);
    await page.locator('#farmaciaProductForm button[type=submit]').click();
    assert.equal(await page.evaluate(()=>window.pending.length),requestsBeforeSupply,'fornecimento precisa ser declarado');
    await page.locator('#farmaciaProductSupply').selectOption('site');
    await page.locator('#farmaciaProductForm button[type=submit]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#farmaciaModal-product').evaluate(el=>el.classList.contains('open')),true);
    await page.locator('#farmaciaModal-product .modal-close').click();
    assert.match(await page.locator('#farmaciaModal-product .status-msg').innerText(),/gravação já foi enviada/);
    const token=await page.evaluate(()=>window.pending.at(-1).args[0].requestId);
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada'}));
    assert.equal(await page.locator('#farmaciaProductName').inputValue(),'Produto em edição');
    assert.match(await page.locator('#farmaciaModal-product .status-msg').innerText(),/Falha simulada/);
    await page.locator('#farmaciaProductForm button[type=submit]').click();
    assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),token);
    await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
    assert.equal(await page.locator('.farmacia-dialog.open').count(),0);
    await page.evaluate(result=>window.pending.at(-1).success(result),stockData());
    await page.waitForFunction(()=>document.activeElement.id==='farmaciaPrimaryAction');
    await openForm(page,'products');
    assert.equal(await page.locator('#farmaciaProductName').inputValue(),'');
    await page.locator('#farmaciaProductName').fill('Rascunho para descartar');
    await page.keyboard.press('Escape');
    await page.locator('#btnConfirmUnsaved').click();
    assert.equal(await page.locator('.farmacia-dialog.open').count(),0);
    await openForm(page,'products');
    assert.equal(await page.locator('#farmaciaProductName').inputValue(),'');
    await page.evaluate(()=>window.farmaciaEstoqueReset());
    assert.equal(await page.locator('.farmacia-dialog.open').count(),0);
    assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),false);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('consulta preserva sensor histórico e observação de calibração sem liberar edição', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280),data=stockData({farmaciaAccess:'read',locationsCanManage:false});
    data.storageUnits[0].sensor='SENSOR-HISTORICO';
    data.storageUnits[0].probes=[{id:'PROBE-1',code:'SONDA-01',serial:'SERIE-01',model:'Modelo fictício',calibrationStatus:'pending',calibration:{status:'pending',calibratedOn:'',validUntil:'',certificate:'',note:'Observação histórica'}}];
    await openStock(page,data);
    await chooseView(page,'equipment');
    await page.getByRole('button',{name:'Ver equipamento IPS AF-01'}).click();
    assert.match(await page.locator('#farmaciaUnitDetail').innerText(),/SENSOR-HISTORICO/);
    assert.equal(await page.locator('#farmaciaUnitDetail form').count(),0);
    await page.locator('#farmaciaModal-unitDetail .modal-close').click();
    await chooseView(page,'probes');
    await page.getByRole('button',{name:'Ver sonda SONDA-01'}).click();
    assert.match(await page.locator('#farmaciaProbeDetail').innerText(),/Observação histórica/);
    assert.equal(await page.locator('#farmaciaProbeDetail form').count(),0);
    await page.evaluate(()=>window.farmaciaEstoqueReset());
    assert.equal(await page.locator('#farmaciaProbeDetail').textContent(),'');
    assert.equal(await page.locator('#farmaciaUnitDetail').textContent(),'');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});


async function chooseView(page,view) {
  if (await page.locator('#mobileMenuBtn').isVisible()) await page.locator('#mobileMenuBtn').click();
  if (await page.locator('#navFarmacia').getAttribute('aria-expanded') !== 'true') await page.locator('#navFarmacia').click();
  await page.locator('[data-farmacia-view="'+view+'"]').click();
}

test('edição de unidade permite Caixa sem histórico e bloqueia histórico e kit no desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({headless:true});
  const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(),'ips-agenda-playwright');
  fs.mkdirSync(artifacts,{recursive:true});
  try {
    for (const width of [1280,390]) {
      const {page,errors} = await fixture(browser,width), data = stockData({positions:[]});
      Object.assign(data.products[0],{dosageForm:'Comprimido',unit:'comprimido',hasStockHistory:false});
      await openStock(page,data);
      await chooseView(page,'products');
      await page.evaluate(result => window.pending.at(-1).success(result),{...data,productsOnly:true});
      await page.locator('#farmaciaProductsResults button[data-action="edit"]').click();
      const modal = page.locator('#farmaciaModal-recordAction'), unit = modal.getByLabel('Unidade de controle',{exact:true});
      assert.equal(await unit.inputValue(),'comprimido');
      assert.equal(await unit.isEnabled(),true);
      await unit.selectOption('caixa');
      await modal.getByLabel('Motivo da correção').fill('Controle por embalagem conforme conferência');
      await modal.locator('.modal-box').screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-editar-unidade-'+width+'.png')});
      await modal.getByRole('button',{name:'Salvar correção',exact:true}).click();
      const payload = await page.evaluate(() => window.pending.at(-1).args[0]);
      assert.equal(payload.data.data.unit,'caixa');
      assert.equal(payload.data.data.dosageForm,'Comprimido');
      await page.evaluate(() => window.pending.at(-1).failure({message:'Falha simulada'}));
      assert.equal(await unit.inputValue(),'caixa');
      assert.equal(await unit.isEnabled(),true);
      await modal.getByRole('button',{name:'Salvar correção',exact:true}).click();
      assert.equal(await page.evaluate(() => window.pending.at(-1).args[0].requestId),payload.requestId);
      await page.evaluate(() => window.pending.at(-1).success({ok:true}));
      data.products[0].unit = 'caixa'; data.products[0].hasStockHistory = true;
      await page.evaluate(result => window.pending.at(-1).success(result),{...data,productsOnly:true});
      await page.locator('#farmaciaProductsResults button[data-action="edit"]').click();
      assert.equal(await unit.isDisabled(),true);
      assert.equal(await unit.inputValue(),'caixa');
      assert.match(await modal.innerText(),/possui histórico de estoque/);
      await modal.getByLabel('Motivo da correção').fill('Correção de outros dados');
      await modal.getByRole('button',{name:'Salvar correção',exact:true}).click();
      await page.evaluate(() => window.pending.at(-1).failure({message:'Falha simulada'}));
      assert.equal(await unit.isDisabled(),true);
      await modal.getByRole('button',{name:'Cancelar',exact:true}).click();
      await page.locator('#confirmUnsaved').getByRole('button',{name:'Sair sem salvar',exact:true}).click();
      await page.evaluate(() => { Object.assign(window.FARMACIA_STOCK.data.products[0],{control:'kit',unit:'kit',hasStockHistory:false}); });
      await page.locator('#farmaciaProductsResults button[data-action="edit"]').click();
      assert.equal(await unit.isDisabled(),true);
      assert.equal(await unit.inputValue(),'kit');
      assert.match(await modal.innerText(),/Kits individualizados usam a unidade kit/);
      assert.equal(await page.title(),'IPS | Farmácia — estoque local');
      assert.equal(page.url(),'about:blank');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(),0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('equipe consulta produtos por projeto sem estoque, edição ou respostas de outra área', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1280,390]) for (const role of ['user','readonly']) {
      const {page,errors}=await fixture(browser,width);
      await page.addScriptTag({content:readProjectFile('SharedAccessRules.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
      await page.addScriptTag({content:`
        var CURRENT_ACCESS={ok:true,email:'teste@example.invalid',role:'${role}',farmaciaAccess:'none',farmaciaCommonAccess:'none'};
        function snack() {}
        ${contentAccessibilitySource(['applyFarmaciaAccess','carregarFarmacia'])}
        applyFarmaciaAccess(); carregarFarmacia();
      `});
      await page.evaluate(()=>window.pending.at(-1).success({farmaciaAccess:'none',studies:[],productStudies:[{id:'P2',nome:'Estudo B'}]}));
      await chooseView(page,'products');
      await page.locator('#farmaciaStudy').selectOption('P2');
      assert.deepEqual(await page.evaluate(()=>window.pending.at(-1).args),['P2',false]);
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaProdutos');
      const result=stockData({farmaciaAccess:'read',productsOnly:true,positions:[],movements:[],storageUnits:[],locationsConfigured:false});
      await page.evaluate(data=>window.pending.at(-1).success(data),result);
      assert.match(await page.locator('#farmaciaProductsResults').innerText(),/Produto fictício/);
      assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),false);
      assert.equal(await page.locator('[data-farmacia-view="stock"]').evaluate(el=>el.hidden),true);
      assert.equal(await page.locator('#farmaciaMetric1').isVisible(),false);
      assert.equal(await page.locator('#farmaciaProductsResults [data-action="edit"]').count(),0);
      assert.equal(await page.locator('#farmaciaRestrictedLabel').isVisible(),false);
      await page.evaluate(()=>window.farmaciaStockRefresh());
      const old=await page.evaluate(()=>window.pending.length-1);
      await chooseView(page,'equipment');
      await page.evaluate(({index,data})=>window.pending[index].success(data),{index:old,data:result});
      assert.equal(await page.locator('#farmaciaProductsResults').isVisible(),false);
      assert.equal(await page.evaluate(()=>window.pending.some(item=>item.method==='getFarmaciaEstoque')),false);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close(); }
});

async function openForm(page,view) {
  await chooseView(page,view);
  await page.locator('#farmaciaPrimaryAction').click();
}

test('setup vazio cadastra primeiro equipamento sem estoque configurado, sonda e calibração em desktop/celular', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for(const width of [1280,390]) {
      const {page,errors}=await fixture(browser,width);
      const data=stockData({locationsCanManage:true});
      await chooseView(page,'equipment');
      assert.equal(await page.locator('#farmaciaStudy').inputValue(),'');
      assert.equal(await page.locator('#farmaciaStockSelector').isVisible(),false);
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaCatalogo');
      await page.evaluate(()=>window.pending.at(-1).success({locationsConfigured:true,locationsCanManage:true,storageUnits:[]}));
      assert.match(await page.locator('#farmaciaLocationsResults').innerText(),/Nenhum equipamento cadastrado/);
      assert.equal(await page.locator('#farmaciaPrimaryAction').isEnabled(),true);
      await openForm(page,'equipment');
      await page.locator('#farmaciaLocationCode').fill('IPS AF-02');
      await page.locator('#farmaciaLocationModel').fill('phcbi MPR-721R-PA');
      await page.locator('#farmaciaLocationRoom').fill('Farmácia fictícia');
      assert.equal(await page.locator('#farmaciaLocationSource, #farmaciaLocationVersion').count(),0);
      await page.getByLabel('Organização',{exact:true}).selectOption('custom');
      await page.getByLabel('Posições (uma por linha)',{exact:true}).fill('Prateleira 1\nPrateleira 2');
      assert.equal(await page.locator('#farmaciaLocationMin').inputValue(),'');
      assert.equal(await page.locator('#farmaciaLocationMax').inputValue(),'');
      await page.locator('#farmaciaLocationForm').getByRole('button',{name:'Cadastrar equipamento',exact:true}).click();
      const location=await page.evaluate(()=>window.pending.at(-1));
      assert.equal(location.method,'cadastrarLocalFarmacia'); assert.equal(location.args[0].data.min,null);
      assert.equal(Object.hasOwn(location.args[0],'studyId'),false);
      assert.equal(Object.hasOwn(location.args[0],'restricted'),false);
      assert.deepEqual(location.args[0].data.positions,['Prateleira 1','Prateleira 2']);
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada'}));
      assert.equal(await page.locator('#farmaciaLocationCode').inputValue(),'IPS AF-02');
      await page.locator('#farmaciaLocationForm').getByRole('button',{name:'Cadastrar equipamento',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),location.args[0].requestId);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
      data.storageUnits[0]={...location.args[0].data,id:'UNIT-1',revision:1,probes:[]};
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaCatalogo');
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      await openForm(page,'probes');
      await page.locator('#farmaciaProbeUnit').selectOption('UNIT-1');
      await page.locator('#farmaciaProbeCode').fill('SONDA-01');
      await page.locator('#farmaciaProbeSerial').fill('SERIE-01');
      await page.locator('#farmaciaProbeModel').fill('Modelo fictício');
      await page.locator('#farmaciaProbeCalibrationStatus').selectOption('current');
      await page.locator('#farmaciaProbeCalibratedOn').fill('2026-01-01');
      await page.locator('#farmaciaProbeValidUntil').fill('2026-10-20');
      await page.locator('#farmaciaProbeCertificate').fill('CERT-01');
      await page.locator('#farmaciaProbeForm').getByRole('button',{name:'Cadastrar sonda',exact:true}).click();
      const saved=await page.evaluate(()=>window.pending.at(-1));
      assert.equal(saved.method,'cadastrarSondaFarmacia'); assert.equal(saved.args[0].data.serial,'SERIE-01');
      assert.equal(Object.hasOwn(saved.args[0],'studyId'),false);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
      data.storageUnits[0].probes=[{...saved.args[0].data,id:'PROBE-1',revision:1,calibrationStatus:'expired'}];
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      assert.match(await page.locator('#farmaciaProbesResults').innerText(),/Vencida/);
      await page.getByRole('button',{name:'Editar sonda SONDA-01',exact:true}).click();
      await page.getByRole('button',{name:'Atualizar calibração',exact:true}).click();
      const probe=page.locator('#farmaciaModal-probeDetail');
      const calibration=probe.locator('form');
      await calibration.locator('[name=validUntil]').fill('2027-04-15');
      await calibration.locator('[name=certificate]').fill('CERT-02');
      await calibration.getByRole('button',{name:'Atualizar calibração'}).click();
      const update=await page.evaluate(()=>window.pending.at(-1));
      assert.equal(update.method,'atualizarCalibracaoSondaFarmacia'); assert.equal(update.args[0].data.revision,1);
      assert.equal(update.args[0].data.probeId,'PROBE-1');
      await page.evaluate(()=>window.pending.at(-1).failure({message:'A sonda mudou. Atualize o estoque.'}));
      assert.equal(await calibration.locator('[name=certificate]').inputValue(),'CERT-02');
      assert.equal(await calibration.locator('[name=validUntil]').inputValue(),'2027-04-15');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await probe.locator('.modal-header').scrollIntoViewIfNeeded();
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-sondas-'+width+'.png')});
      await page.evaluate(()=>{document.getElementById('farmaciaStudy').value='P2';window.selecionarFarmaciaStudy();});
      assert.equal(await page.locator('.farmacia-dialog.open').count(),0);
      assert.equal(await page.locator('#farmaciaLocationsResults').textContent(),'');
      assert.equal(await page.locator('#farmaciaProbeSerial').inputValue(),'');
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('conservação mostra incompatibilidade documental e consulta não libera setup ou calibração', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,390);
    const data=stockData(); data.products[0].storage={min:2,max:8,instructions:'Não congelar'};
    await openStock(page,data);
    await openForm(page,'stock');
    await page.locator('#farmaciaInitialProduct').selectOption('PR1');
    await page.locator('#farmaciaInitialUnit').selectOption('UNIT-1');
    await page.locator('#farmaciaInitialLocation').selectOption('Prateleira 1');
    assert.match(await page.locator('#farmaciaInitialStorageStatus').innerText(),/incompatível/);
    assert.equal(await page.locator('#farmaciaLocationCode').isDisabled(),true);
    assert.equal(await page.locator('#farmaciaProbeCode').isDisabled(),true);
    await page.evaluate(()=>{document.getElementById('farmaciaStudy').value='P2';window.selecionarFarmaciaStudy();});
    await page.evaluate(()=>window.pending.at(-1).success({study:{id:'P2',nome:'Estudo B'},farmaciaAccess:'read',restrictedAllowed:false}));
    await page.evaluate(result=>window.pending.at(-1).success(result),{...data,farmaciaAccess:'read'});
    assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),false);
    assert.equal(await page.locator('[data-farmacia-unit]').count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('estoque comum aparece separado, oculta classe restrita e troca descarta resposta antiga em desktop/celular', async () => {
  const browser = await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1280,390]) {
      const {page,errors} = await fixture(browser,width);
      await page.evaluate(() => window.renderFarmaciaStudies([{id:'@IPS_COMMON',nome:'Geral (Farmácia)'},{id:'P1',nome:'Estudo A'}]));
      await page.locator('#farmaciaStudy').selectOption('@IPS_COMMON');
      assert.equal(await page.evaluate(() => window.pending.at(-1).args[0]),'@IPS_COMMON');
      await page.evaluate(() => window.pending.at(-1).success({study:{id:'@IPS_COMMON',nome:'Geral (Farmácia)'},farmaciaAccess:'manage',restrictedAllowed:false}));
      assert.deepEqual(await page.evaluate(() => window.pending.at(-1).args),['@IPS_COMMON',false]);
      const oldIndex = await page.evaluate(() => window.pending.length-1);
      const data = stockData({products:[{id:'PR1',name:'Equipo fictício',presentation:'Equipo de teste',unit:'unidade',control:'quantity'}]});
      await page.evaluate(result => window.pending.at(-1).success(result),data);
      assert.equal(await page.locator('#farmaciaRestrictedLabel').isVisible(),false);
      assert.match(await page.locator('#farmaciaStudyDetail').innerText(),/saldo independente dos estudos/);
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.evaluate(() => {document.querySelector('.content').scrollTop=0;});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-common-'+width+'.png')});
      await openForm(page,'products');
      assert.equal(await page.locator('#farmaciaProductSupply option[value=sponsor]').isDisabled(),true);
      await page.locator('#farmaciaProductSupply').selectOption('site');
      await page.locator('#farmaciaProductCategory').selectOption('material');
      await page.locator('#farmaciaProductName').fill('Seringa fictícia');
      await page.locator('#farmaciaProductBrand').fill('Marca de material');
      await page.locator('#farmaciaProductBarcode').fill('07891234567890');
      await page.locator('#farmaciaProductPresentation').fill('10 mL');
      await page.locator('#farmaciaProductInstructions').fill('Instrução fictícia');
      assert.equal(await page.locator('#farmaciaModal-product [data-farmacia-medication-field]:visible').count(),0);
      assert.equal(await page.locator('#farmaciaProductStudyLabel').innerText(),'Geral (Farmácia)');
      if (width === 1280) {
        await page.setViewportSize({width,height:1600});
        await page.locator('#farmaciaModal-product .modal-box').screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-produto-material-preview.png')});
      }
      if (width === 1280) await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-produto-material-desktop.png')});
      await page.locator('#farmaciaProductForm').getByRole('button',{name:'Cadastrar produto'}).click();
      const commonProduct=await page.evaluate(() => window.pending.at(-1).args[0]);
      assert.equal(commonProduct.studyId,'@IPS_COMMON');
      assert.equal(commonProduct.data.category,'material');
      assert.equal(commonProduct.data.brand,'Marca de material');
      assert.equal(commonProduct.data.barcode,'07891234567890');
      assert.equal(Object.hasOwn(commonProduct.data.storage,'source'),false);
      assert.equal(Object.hasOwn(commonProduct.data.storage,'version'),false);
      await page.evaluate(() => window.pending.at(-1).failure({message:'Falha simulada'}));
      await page.evaluate(()=>{document.getElementById('farmaciaStudy').value='P1';window.selecionarFarmaciaStudy();});
      assert.equal(await page.locator('#farmaciaStockResults').innerText(),'');
      assert.equal(await page.locator('#farmaciaProductName').inputValue(),'');
      await page.evaluate(() => window.pending.at(-1).success({study:{id:'P1',nome:'Estudo A'},farmaciaAccess:'read',restrictedAllowed:true}));
      await page.evaluate(result => window.pending.at(-1).success(result),stockData({farmaciaAccess:'read',products:[],positions:[]}));
      await page.evaluate(({i,result}) => window.pending[i].success(result),{i:oldIndex,result:data});
      assert.doesNotMatch(await page.locator('#farmaciaStockResults').innerText(),/Equipo fictício/);
      assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser.close();}
});

test('consulta de material omite atributos farmacêuticos e mantém identificação em desktop/celular', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width);
      const data=stockData();
      Object.assign(data.products[0],{category:'material',name:'Seringa',barcode:'07891234567890',presentation:'Caixa com 100 seringas',unit:'seringa'});
      await openStock(page,data);
      await chooseView(page,'products');
      await page.locator('button[data-record-id="PR1"][data-action="view"]').click();
      const details=page.locator('#farmaciaModal-recordAction .farmacia-detail-grid');
      assert.match(await details.innerText(),/Seringa/);
      assert.match(await details.innerText(),/Material \/ dispositivo/);
      assert.match(await details.innerText(),/07891234567890/);
      assert.doesNotMatch(await details.innerText(),/Forma farmacêutica|Dosagem \/ concentração|Via de administração/);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser.close();}
});

test('visualização de produto legado sem categoria mantém características já registradas', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width), data=stockData();
      Object.assign(data.products[0],{dosageForm:'Comprimido',strength:'10 mg',route:'Oral',
        storage:{min:null,max:null,instructions:'Conservar',source:'Referência antiga',version:'1'}});
      delete data.products[0].category; delete data.products[0].barcode;
      await openStock(page,data);
      await chooseView(page,'products');
      await page.locator('button[data-record-id="PR1"][data-action="view"]').click();
      const details=page.locator('#farmaciaModal-recordAction .farmacia-detail-grid');
      assert.match(await details.innerText(),/Tipo não informado/);
      assert.match(await details.innerText(),/Comprimido/);
      assert.match(await details.innerText(),/10 mg/);
      assert.match(await details.innerText(),/Oral/);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser.close();}
});

test('produto cadastra Caixa sem código de estudo e corrige forma, dosagem e via; modais e seletores distinguem apresentações', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width), data=stockData({study:{id:'P1',nome:'KANDELA-302',codigo:'BGB-43395-302'}});
      await page.evaluate(()=>window.renderFarmaciaStudies([{id:'P1',nome:'KANDELA-302',codigo:'BGB-43395-302'}]));
      await openStock(page,data);
      await openForm(page,'products');
      const modal=page.locator('#farmaciaModal-product');
      await page.locator('#farmaciaProductCategory').selectOption('medicine');
      await page.locator('#farmaciaProductName').fill('Produto de demonstração');
      await page.locator('#farmaciaProductBrand').fill('Marca de demonstração');
      assert.equal(await page.locator('#farmaciaProductCode').count(),0);
      await page.locator('#farmaciaProductUnit').selectOption('caixa');
      await page.locator('#farmaciaProductBarcode').fill('7891234567890');
      await page.locator('#farmaciaProductDosageForm').selectOption('Comprimido');
      await page.locator('#farmaciaProductStrength').fill('10 mg');
      await page.locator('#farmaciaProductRoute').fill('Oral');
      await page.locator('#farmaciaProductPresentation').fill('Frasco com 30 comprimidos');
      await page.locator('#farmaciaProductSupply').selectOption('sponsor');
      await page.locator('#farmaciaProductInstructions').fill('Conforme rótulo autorizado');
      await modal.locator('.modal-header').scrollIntoViewIfNeeded();
      assert.equal(await modal.locator('.section-label').count(),3);
      assert.equal(await modal.locator('#farmaciaProductStudyLabel').innerText(),'KANDELA-302 — BGB-43395-302');
      if (width === 1440) assert.equal(await page.locator('#farmaciaStudy option[value="P1"]').innerText(),'KANDELA-302 — BGB-43395-302');
      assert.equal(await page.locator('#farmaciaProductDosageForm').evaluate(el=>el.tagName),'SELECT');
      assert.equal(await page.locator('#farmaciaProductSource,#farmaciaProductVersion').count(),0);
      if (width === 1440) await page.setViewportSize({width,height:1600});
      await page.locator('#farmaciaProductInstructions').evaluate(el=>el.blur());
      await page.evaluate(()=>document.activeElement&&document.activeElement.blur());
      if (width === 1440) await modal.locator('.modal-box').screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-produto-modal-preview.png')});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-produto-novo-'+width+'.png')});
      await modal.getByRole('button',{name:'Cadastrar produto',exact:true}).click();
      const first=await page.evaluate(()=>window.pending.at(-1).args[0]);
      assert.equal(first.data.category,'medicine'); assert.equal(first.data.strength,'10 mg'); assert.equal(first.data.dosageForm,'Comprimido');
      assert.equal(first.data.brand,'Marca de demonstração');
      assert.equal(Object.hasOwn(first.data,'productCode'),false); assert.equal(first.data.unit,'caixa'); assert.equal(first.data.barcode,'7891234567890'); assert.equal(first.data.route,'Oral');
      assert.equal(Object.hasOwn(first.data.storage,'source'),false); assert.equal(Object.hasOwn(first.data.storage,'version'),false);
      assert.equal(await page.locator('#farmaciaProductStrength').isDisabled(),true);
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada'}));
      assert.equal(await page.locator('#farmaciaProductStrength').inputValue(),'10 mg');
      await modal.getByRole('button',{name:'Cadastrar produto',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),first.requestId);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true,id:'PR2'}));
      data.products.push({...first.data,id:'PR2'});
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      assert.match(await page.locator('#farmaciaProductsResults').innerText(),/Medicamento/);
      assert.equal(await page.locator('#farmaciaProductsResults .farmacia-product-heading .chip-blue').count(),2);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-produtos-tabela-'+width+'.png')});
      await page.locator('#farmaciaSearch').fill('7891234567890');
      assert.equal(await page.locator('#farmaciaProductsResults [data-farmacia-row]:visible').count(),1);
      await page.locator('#farmaciaSearch').fill('10 mg');
      assert.equal(await page.locator('#farmaciaProductsResults [data-farmacia-row]:visible').count(),1);
      await page.locator('#farmaciaSearch').fill('Marca de demonstração');
      assert.equal(await page.locator('#farmaciaProductsResults [data-farmacia-row]:visible').count(),1);
      await page.locator('#farmaciaSearch').fill('');
      await page.locator('#farmaciaProductsResults button[data-record-id="PR2"][data-action="view"]').click();
      assert.match(await page.locator('#farmaciaModal-recordAction').innerText(),/Marca do produto/i);
      assert.match(await page.locator('#farmaciaModal-recordAction').innerText(),/Marca de demonstração/);
      await page.locator('#farmaciaModal-recordAction .modal-close').click();
      await page.locator('#farmaciaProductsResults button[data-record-id="PR2"][data-action="edit"]').click();
      const edit=page.locator('#farmaciaModal-recordAction');
      assert.equal(await edit.locator('.modal-header-title').innerText(),'Editar produto');
      assert.equal(await edit.locator('.modal-header-sub').innerText(),'KANDELA-302 — BGB-43395-302');
      assert.equal(await page.locator('#farmaciaAction-strength').inputValue(),'10 mg');
      assert.equal(await page.locator('#farmaciaAction-brand').inputValue(),'Marca de demonstração');
      await page.locator('#farmaciaAction-brand').fill('Marca corrigida');
      await page.locator('#farmaciaAction-strength').fill('20 mg');
      await page.locator('#farmaciaAction-reason').fill('Correção conforme documento autorizado');
      await edit.locator('.modal-header').scrollIntoViewIfNeeded();
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-produto-editar-'+width+'.png')});
      await edit.getByRole('button',{name:'Salvar correção',exact:true}).click();
      const correction=await page.evaluate(()=>window.pending.at(-1).args[0]);
      assert.equal(correction.type,'PRODUCT_EDIT'); assert.equal(correction.data.data.strength,'20 mg');
      assert.equal(correction.data.data.barcode,'7891234567890');
      assert.equal(correction.data.data.brand,'Marca corrigida');
      assert.equal(correction.data.data.route,'Oral');
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada'}));
      assert.equal(await page.locator('#farmaciaAction-strength').inputValue(),'20 mg');
      await edit.getByRole('button',{name:'Salvar correção',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),correction.requestId);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
      Object.assign(data.products[1],correction.data.data);
      data.products.push({...data.products[1],id:'PR3',strength:'10 mg'});
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      await page.locator('#farmaciaProductsResults button[data-record-id="PR2"][data-action="view"]').click();
      assert.match(await edit.innerText(),/20 mg/); assert.doesNotMatch(await edit.innerText(),/Código do produto no estudo/); assert.match(await edit.innerText(),/7891234567890/);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-produto-visualizar-'+width+'.png')});
      await edit.getByRole('button',{name:'Fechar',exact:true}).last().click();
      await page.evaluate(()=>window.farmaciaSetView('stock'));
      assert.match(await page.locator('#farmaciaInitialProduct option[value="PR2"]').innerText(),/20 mg.*Comprimido.*Oral/);
      assert.match(await page.locator('#farmaciaInitialProduct option[value="PR3"]').innerText(),/10 mg.*Comprimido.*Oral/);
      assert.match(await page.locator('#farmaciaReceiptProduct option[value="PR2"]').innerText(),/20 mg/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(),0);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('estoque exibe saldos por unidade, cadastra produto e preserva token após falha em desktop/celular', async () => {
  const browser=await loadPlaywright().chromium.launch({ headless:true });
  try {
    for (const width of [1280, 390]) {
      const { page, errors }=await fixture(browser,width);
      await openStock(page,stockData());
      assert.equal(page.url(),'about:blank');
      assert.equal(await page.title(),'IPS | Farmácia — estoque local');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(),0);
      assert.match(await page.locator('#farmaciaStockResults').innerText(),/10 frasco.*8 frasco.*2 frasco/s);
      await openForm(page,'products');
      await page.locator('#farmaciaProductCategory').selectOption('medicine');
      await page.locator('#farmaciaProductSupply').selectOption('sponsor');
      await page.locator('#farmaciaProductName').fill('Kit fictício');
      await page.locator('#farmaciaProductPresentation').fill('Caixa de teste');
      await page.locator('#farmaciaProductInstructions').fill('Conferir manual fictício');
      await page.locator('#farmaciaProductControl').selectOption('kit');
      assert.equal(await page.locator('#farmaciaProductUnit').inputValue(),'kit');
      assert.equal(await page.locator('#farmaciaProductUnit').isDisabled(),true);
      await page.locator('#farmaciaProductForm').getByRole('button',{name:'Cadastrar produto'}).click();
      const first=await page.evaluate(()=>window.pending.at(-1).args[0]);
      assert.equal(first.studyId,'P1'); assert.equal(first.restricted,false); assert.equal(first.data.control,'kit');
      assert.equal(first.data.supplySource,'sponsor');
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Resposta não recebida'}));
      assert.equal(await page.locator('#farmaciaProductName').inputValue(),'Kit fictício');
      await page.locator('#farmaciaProductForm').getByRole('button',{name:'Cadastrar produto'}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),first.requestId);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true,id:'PR2'}));
      await page.evaluate(result=>window.pending.at(-1).success(result),stockData());
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.locator('#farmaciaStockPanel').scrollIntoViewIfNeeded();
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-stock-'+width+'.png')});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('inventário de kit exige contagem confirmada e envia uma unidade com lote, local, data e kit', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,390);
    await openStock(page,stockData({products:[{id:'KIT1',name:'Kit fictício',presentation:'Caixa',unit:'kit',control:'kit'}],positions:[]}));
    await openForm(page,'stock');
    await page.locator('#farmaciaInitialProduct').selectOption('KIT1');
    assert.equal(await page.locator('#farmaciaInitialPhysical').inputValue(),'1');
    assert.equal(await page.locator('#farmaciaInitialPhysical').getAttribute('readonly'),'');
    await page.locator('#farmaciaInitialLot').fill('L-KIT');
    await page.locator('#farmaciaInitialExpiry').fill('2027-10-31');
    await page.locator('#farmaciaInitialUnit').selectOption('UNIT-1');
    await page.locator('#farmaciaInitialLocation').selectOption('Prateleira 1');
    await page.locator('#farmaciaInitialKit').fill('K-001');
    await page.locator('#farmaciaInitialCountedOn').fill('2026-10-21');
    await page.locator('#farmaciaInitialConfirmed').check();
    await page.locator('#farmaciaInitialForm').getByRole('button',{name:'Registrar inventário inicial'}).click();
    const payload=await page.evaluate(()=>window.pending.at(-1).args[0]);
    assert.equal(payload.data.physical,1); assert.equal(payload.data.blocked,0); assert.equal(payload.data.kit,'K-001');
    assert.equal(payload.data.confirmed,true); assert.equal(payload.data.countedOn,'2026-10-21');
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Posição já inventariada'}));
    assert.match(await page.locator('#farmaciaStockStatus').innerText(),/já inventariada/);
    assert.equal(await page.locator('#farmaciaInitialKit').inputValue(),'K-001');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('troca de estudo/classe elimina dados anteriores, ignora resposta antiga e não libera formulário sem manage/config', async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await fixture(browser,1280);
    await openStock(page,stockData());
    const oldIndex=await page.evaluate(()=>window.pending.length-1);
    await page.locator('#farmaciaStudy').selectOption('P2');
    assert.equal(await page.locator('#farmaciaStockResults').innerText(),'');
    await page.evaluate(()=>window.pending.at(-1).success({study:{id:'P2',nome:'Estudo B'},farmaciaAccess:'read',restrictedAllowed:true}));
    await page.evaluate(result=>window.pending.at(-1).success(result),stockData({farmaciaAccess:'read',products:[],positions:[]}));
    await page.evaluate(({index,result})=>window.pending[index].success(result),{index:oldIndex,result:stockData()});
    assert.doesNotMatch(await page.locator('#farmaciaStockResults').innerText(),/Produto fictício/);
    assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),false);
    await page.locator('#farmaciaStockRestricted').check();
    assert.deepEqual(await page.evaluate(()=>window.pending.at(-1).args),['P2',true]);
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Informações restritas não autorizadas'}));
    assert.equal(await page.locator('#farmaciaStockResults').innerText(),'');
    assert.match(await page.locator('#farmaciaStockStatus').innerText(),/não autorizadas/);
    await page.locator('#farmaciaStockRestricted').uncheck();
    await page.evaluate(result=>window.pending.at(-1).success(result),stockData({configured:false,products:[],positions:[]}));
    assert.match(await page.locator('#farmaciaInventoryResults').innerText(),/ainda não configurado/);
    assert.equal(await page.locator('#farmaciaPrimaryAction').isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

function lifecycleData(overrides = {}) {
  const data=stockData();
  data.products[0].supplySource='sponsor';
  data.storageUnits[0].positions.push('Prateleira 2');
  Object.assign(data.positions[0],{revision:'IN1',origin:'initial',pending:8,available:0,
    location:'IPS AF-01 → Prateleira 1',locationRef:{unitId:'UNIT-1',position:'Prateleira 1'}});
  data.movements=[{id:'IN1',type:'INITIAL',registeredAt:data.positions[0].registeredAt,author:data.positions[0].author,
    data:{...data.positions[0],confirmed:true,note:'Contagem inicial fictícia'}}];
  return {...data,...overrides};
}

async function fillReceipt(page) {
  await page.locator('#farmaciaReceiptProduct').selectOption('PR1');
  await page.locator('#farmaciaReceiptLot').fill('L-REMESSA');
  await page.locator('#farmaciaReceiptExpiry').fill('2027-10-31');
  await page.locator('#farmaciaReceiptUnit').selectOption('UNIT-1');
  await page.locator('#farmaciaReceiptLocation').selectOption('Prateleira 1');
  await page.locator('#farmaciaReceiptPhysical').fill('4');
  await page.locator('#farmaciaReceiptReceivedOn').fill('2026-10-21');
  await page.locator('#farmaciaReceiptDocument').fill('REMESSA-FICTICIA-001');
  await page.locator('#farmaciaReceiptNote').fill('Conferência fictícia do transporte');
}

test('ciclo de vida: recebimento preserva formulário e operação após falha em desktop/celular', async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1280,390]) {
      const {page,errors}=await fixture(browser,width);
      await openStock(page,lifecycleData());
      assert.equal(await page.locator('#farmaciaReceiptAction').isVisible(),true);
      assert.match(await page.locator('#farmaciaInventoryResults').innerText(),/Aguardando avaliação/i);
      await page.locator('#farmaciaReceiptAction').click();
      assert.equal(await page.locator('#farmaciaModal-receipt').getAttribute('inert'),null);
      await fillReceipt(page);
      await page.locator('#farmaciaReceiptForm button[type=submit]').click();
      const first=await page.evaluate(()=>({method:window.pending.at(-1).method,payload:window.pending.at(-1).args[0]}));
      assert.equal(first.method,'registrarRecebimentoFarmacia');
      assert.equal(first.payload.studyId,'P1');
      assert.equal(first.payload.data.physical,4);
      assert.equal(first.payload.data.document,'REMESSA-FICTICIA-001');
      assert.deepEqual(first.payload.data.locationRef,{unitId:'UNIT-1',position:'Prateleira 1'});
      assert.equal(await page.locator('#farmaciaReceiptFields').evaluate(el=>el.disabled),true);
      assert.equal(await page.locator('#farmaciaReceiptDocument').isDisabled(),true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#farmaciaModal-receipt').evaluate(el=>el.classList.contains('open')),true);
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Resposta perdida simulada'}));
      assert.equal(await page.locator('#farmaciaReceiptPhysical').inputValue(),'4');
      assert.equal(await page.locator('#farmaciaReceiptDocument').inputValue(),'REMESSA-FICTICIA-001');
      assert.match(await page.locator('#farmaciaModal-receipt .status-msg').innerText(),/Resposta perdida/);
      await page.locator('#farmaciaReceiptForm button[type=submit]').click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),first.payload.requestId);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true,id:'RC1'}));
      assert.equal(await page.locator('.farmacia-dialog.open').count(),0);
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaEstoque');
      const refreshed=lifecycleData();
      refreshed.positions.push({...refreshed.positions[0],id:'RC1',revision:'RC1',origin:'receipt',lot:'L-REMESSA',physical:4,blocked:0,pending:4,available:0,receivedOn:'2026-10-21'});
      await page.evaluate(result=>window.pending.at(-1).success(result),refreshed);
      assert.match(await page.locator('#farmaciaInventoryResults').innerText(),/L-REMESSA/);
      assert.equal(await page.locator('#farmaciaInventoryResults [data-position-id]').count(),2);
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-ciclo-estoque-'+width+'.png')});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('ciclo de vida: histórico permite liberação parcial documentada e preserva revisão do saldo', async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1280,390]) {
      const {page,errors}=await fixture(browser,width);
      await openStock(page,lifecycleData());
      await page.locator('#farmaciaInventoryResults button[data-position-id="IN1"]').click();
      assert.match(await page.locator('#farmaciaPositionDetail').innerText(),/farmacia@example.invalid/);
      assert.match(await page.locator('#farmaciaPositionDetail').innerText(),/Contagem inicial fictícia/);
      await page.locator('#farmaciaMovementAction').selectOption('release');
      assert.equal(await page.getByRole('button',{name:'Confirmar liberação',exact:true}).isVisible(),true);
      assert.equal(await page.getByLabel('Situação atual do saldo',{exact:true}).isVisible(),true);
      assert.match(await page.locator('#farmaciaMovementFrom').innerText(),/Aguardando avaliação — 8 frasco/);
      assert.match(await page.locator('#farmaciaMovementHelp').innerText(),/liberar até 8 frasco.*disponível para uso/);
      const helpStyle=await page.locator('#farmaciaMovementHelp').evaluate(el=>{
        const actual=window.getComputedStyle(el), standard=window.getComputedStyle(document.getElementById('farmaciaMovementDocumentHelp'));
        return {className:el.className,actual:[actual.fontFamily,actual.fontSize,actual.color,actual.lineHeight],standard:[standard.fontFamily,standard.fontSize,standard.color,standard.lineHeight]};
      });
      assert.equal(helpStyle.className,'field-help');
      assert.deepEqual(helpStyle.actual,helpStyle.standard);
      await page.locator('#farmaciaMovementFrom').selectOption('blocked');
      assert.match(await page.locator('#farmaciaMovementHelp').innerText(),/até 2 frasco/);
      assert.equal(await page.locator('#farmaciaMovementQuantity').getAttribute('max'),'2');
      await page.locator('#farmaciaMovementFrom').selectOption('pending');
      assert.equal(await page.getByLabel('Quantidade a liberar (frasco)',{exact:true}).isVisible(),true);
      await page.locator('#farmaciaMovementQuantity').fill('3');
      await page.locator('#farmaciaMovementReason').fill('Conferência documental fictícia');
      const count=await page.evaluate(()=>window.pending.length);
      await page.locator('#farmaciaMovementForm button[type=submit]').click();
      assert.equal(await page.evaluate(()=>window.pending.length),count,'documento obrigatório impede envio');
      await page.locator('#farmaciaMovementDocument').fill('LIBERACAO-FICTICIA-001');
      // Uma atualização do mesmo escopo não autoriza o formulário antigo a usar
      // revisão/saldo que o responsável ainda não conferiu no modal aberto.
      await page.evaluate(()=>{
        window.FARMACIA_STOCK.data.positions[0].revision='MV-new';
        window.FARMACIA_STOCK.data.positions[0].pending=2;
      });
      const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-ciclo-liberacao-'+width+'.png')});
      await page.locator('#farmaciaMovementForm button[type=submit]').click();
      const sent=await page.evaluate(()=>({method:window.pending.at(-1).method,payload:window.pending.at(-1).args[0]}));
      assert.equal(sent.method,'registrarMovimentacaoFarmacia');
      assert.equal(sent.payload.data.positionId,'IN1');
      assert.equal(sent.payload.data.revision,'IN1');
      assert.equal(sent.payload.data.action,'release');
      assert.equal(sent.payload.data.from,'pending');
      assert.equal(sent.payload.data.quantity,3);
      assert.equal(sent.payload.data.document,'LIBERACAO-FICTICIA-001');
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Saldo mudou. Atualize o estoque.'}));
      assert.match(await page.locator('#farmaciaModal-positionDetail .status-msg').innerText(),/Saldo mudou/);
      assert.equal(await page.locator('#farmaciaMovementQuantity').inputValue(),'3');
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('ciclo de vida: transferência envia o saldo físico integral para uma posição cadastrada', async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280);
    await openStock(page,lifecycleData());
    await page.locator('#farmaciaInventoryResults button[data-position-id="IN1"]').click();
    await page.locator('#farmaciaMovementAction').selectOption('transfer');
    assert.equal(await page.getByRole('button',{name:'Confirmar transferência',exact:true}).isVisible(),true);
    assert.match(await page.locator('#farmaciaMovementHelp').innerText(),/Todo o saldo físico \(10 frasco\)/);
    assert.equal(await page.locator('#farmaciaMovementQuantity').inputValue(),'10');
    assert.equal(await page.locator('#farmaciaMovementQuantity').getAttribute('readonly'),'');
    await page.locator('#farmaciaMovementUnit').selectOption('UNIT-1');
    await page.locator('#farmaciaMovementLocation').selectOption('Prateleira 2');
    await page.locator('#farmaciaMovementReason').fill('Mudança de posição fictícia');
    await page.locator('#farmaciaMovementDocument').fill('REGISTRO-FICTICIO-TRANSFERENCIA');
    await page.locator('#farmaciaMovementForm button[type=submit]').click();
    const payload=await page.evaluate(()=>window.pending.at(-1).args[0]);
    assert.equal(payload.data.action,'transfer');
    assert.equal(payload.data.quantity,10);
    assert.deepEqual(payload.data.locationRef,{unitId:'UNIT-1',position:'Prateleira 2'});
    await page.evaluate(()=>window.pending.at(-1).success({ok:true,id:'MV1'}));
    const refreshed=lifecycleData();
    Object.assign(refreshed.positions[0],{revision:'MV1',location:'IPS AF-01 → Prateleira 2',locationRef:{unitId:'UNIT-1',position:'Prateleira 2'}});
    await page.evaluate(result=>window.pending.at(-1).success(result),refreshed);
    assert.match(await page.locator('#farmaciaInventoryResults').innerText(),/Prateleira 2/);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test('ciclo de vida: consulta de histórico não concede escrita e produto histórico não ganha origem presumida', async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const source of ['sponsor',undefined]) {
      const {page,errors}=await fixture(browser,1280);
      const data=lifecycleData({farmaciaAccess:source?'read':'manage'});
      if (!source) delete data.products[0].supplySource;
      await openStock(page,data);
      assert.equal(await page.locator('#farmaciaReceiptAction').isVisible(),false);
      await page.locator('#farmaciaInventoryResults button[data-position-id="IN1"]').click();
      assert.match(await page.locator('#farmaciaPositionDetail').innerText(),/Contagem inicial fictícia/);
      assert.equal(await page.locator('#farmaciaMovementForm').count(),0);
      assert.deepEqual(errors,[]); await page.close();
    }
  } finally {await browser.close();}
});

test('ciclo de vida: troca de escopo elimina histórico/formulários e ignora resposta de recebimento antiga', async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280);
    await openStock(page,lifecycleData());
    await page.locator('#farmaciaReceiptAction').click();
    await fillReceipt(page);
    await page.locator('#farmaciaReceiptForm button[type=submit]').click();
    const oldIndex=await page.evaluate(()=>window.pending.length-1);
    await page.evaluate(()=>window.farmaciaEstoqueReset());
    assert.equal(await page.locator('.farmacia-dialog.open').count(),0);
    assert.equal(await page.locator('#farmaciaReceiptDocument').inputValue(),'');
    assert.equal(await page.locator('#farmaciaPositionDetail').textContent(),'');
    await page.evaluate(index=>window.pending[index].success({ok:true}),oldIndex);
    assert.equal(await page.evaluate(()=>window.pending.length-1),oldIndex,'resposta obsoleta não recarrega estoque anterior');
    assert.equal(await page.locator('#farmaciaInventoryResults').textContent(),'');
    assert.equal(await page.locator('#farmaciaReceiptAction').isVisible(),false);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});


test('tabelas usam ações por perfil; sonda mostra histórico, edita e confirma exclusão em desktop/celular', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  const artifacts=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright'); fs.mkdirSync(artifacts,{recursive:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width);
      const data=stockData({locationsCanManage:true});
      data.storageUnits[0].probes=[{id:'PROBE-1',unitId:'UNIT-1',code:'SONDA-01',serial:'SERIE-01',model:'Modelo teste',revision:2,calibrationStatus:'current',calibration:{status:'current',calibratedOn:'2026-10-01',validUntil:'2027-10-01',certificate:'CERT-02',note:''},calibrationHistory:[{calibration:{status:'current',calibratedOn:'2025-10-01',validUntil:'2026-10-01',certificate:'CERT-01',note:'Anterior'},author:'admin@example.invalid',registeredAt:'2025-10-01T15:00:00.000Z'}]}];
      await openStock(page,data);
      await page.evaluate(()=>window.farmaciaSetView('products'));
      assert.equal(await page.locator('button[data-record-id="PR1"][data-action="edit"]').count(),1);
      await page.locator('button[data-record-id="PR1"][data-action="view"]').click();
      assert.match(await page.locator('#farmaciaModal-recordAction').innerText(),/Frasco de teste/);
      await page.locator('#farmaciaModal-recordAction').getByRole('button',{name:'Fechar',exact:true}).last().click();
      await page.evaluate(()=>window.farmaciaSetView('probes'));
      assert.equal(await page.getByRole('button',{name:'Editar sonda SONDA-01',exact:true}).count(),1);
      assert.equal(await page.locator('#farmaciaProbePoint').count(),0);
      assert.equal(await page.locator('#farmaciaProbesResults').getByText('Ponto não informado').count(),0);
      assert.match(await page.title(),/Farmácia/);
      assert.equal(await page.locator('#farmaciaProbesResults tbody tr').count(),1);
      assert.equal(page.url(),'about:blank');
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-acoes-'+width+'.png')});
      await page.getByRole('button',{name:'Ver sonda SONDA-01',exact:true}).click();
      assert.equal(await page.locator('#farmaciaProbeDetail form').count(),0);
      assert.match(await page.locator('#farmaciaProbeDetail').innerText(),/CERT-01/);
      assert.equal(await page.locator('#farmaciaProbeDetail .participant-participation-row').count(),1);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-calibracoes-historico-'+width+'.png')});
      await page.locator('#farmaciaModal-probeDetail').getByRole('button',{name:'Fechar janela'}).click();
      await page.getByRole('button',{name:'Editar sonda SONDA-01',exact:true}).click();
      assert.equal(await page.locator('#farmaciaModal-unitDetail form > button').count(),0);
      assert.equal(await page.locator('#farmaciaModal-unitDetail .farmacia-dialog-actions').getByRole('button',{name:'Atualizar calibração',exact:true}).count(),1);
      assert.equal(await page.locator('#farmaciaModal-unitDetail .farmacia-dialog-actions').getByRole('button',{name:'Cancelar',exact:true}).count(),1);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-editar-sonda-'+width+'.png')});
      await page.locator('#farmaciaEdit-model').fill('Modelo corrigido');
      await page.locator('#farmaciaModal-unitDetail').getByRole('button',{name:'Salvar alterações',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'editarRegistroCatalogoFarmacia');
      assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].data.values.model),'Modelo corrigido');
      await page.evaluate(()=>window.pending.at(-1).failure({message:'O registro mudou'}));
      assert.equal(await page.locator('#farmaciaEdit-model').inputValue(),'Modelo corrigido');
      await page.evaluate(()=>{window.appClearUnsavedChanges('farmaciaModal-unitDetail');window.fecharOverlay('farmaciaModal-unitDetail');});
      await page.getByRole('button',{name:'Excluir sonda SONDA-01',exact:true}).click();
      await page.getByRole('button',{name:'Confirmar exclusão',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'excluirRegistroCatalogoFarmacia');
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Sem permissão'}));
      await page.evaluate(()=>{window.appClearUnsavedChanges('farmaciaModal-unitDetail');window.fecharOverlay('farmaciaModal-unitDetail');window.FARMACIA_CATALOG.data={...window.FARMACIA_STOCK.data,locationsCanManage:false};window.renderFarmaciaEstoque(window.FARMACIA_CATALOG.data);});
      assert.equal(await page.getByRole('button',{name:'Editar sonda SONDA-01',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Excluir sonda SONDA-01',exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {await browser.close();}
});


test('Produtos obtém autorização restrita na própria leitura sem RPC anterior de estoque', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1440);
    await chooseView(page,'products');
    await page.locator('#farmaciaStudy').selectOption('P1');
    assert.deepEqual(await page.evaluate(()=>window.pending.map(item=>item.method)),['getFarmaciaProdutos']);
    await page.evaluate(data=>window.pending.at(-1).success(data),stockData({productsOnly:true,restrictedAllowed:true}));
    assert.equal(await page.locator('#farmaciaRestrictedLabel').isVisible(),true);
    await page.locator('#farmaciaStockRestricted').check();
    assert.deepEqual(await page.evaluate(()=>window.pending.at(-1).args),['P1',true]);
    await page.evaluate(data=>window.pending.at(-1).success(data),stockData({productsOnly:true,restricted:true,restrictedAllowed:true}));
    assert.equal(await page.locator('#farmaciaStockRestricted').isChecked(),true);
    assert.deepEqual(errors,[]);
    await page.close();
  } finally {await browser.close();}
});
