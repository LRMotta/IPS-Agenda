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
    products:[{ id:'PR1', name:'Produto fictício', presentation:'Frasco de teste', unit:'frasco', control:'quantity' }],
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
    ${contentAccessibilitySource(['farmaciaAccessLabel','selecionarFarmaciaStudy','renderFarmaciaStudies','abrirFarmaciaView','toggleNavFarmacia','appSyncNavAccessibility','setMobileNav','closeMobileNav','toggleMobileNav','appDialogFocusable','appFocusDialog','appSyncContentFieldAccessibility','appSyncAccessibleDialogs','appAccessibleDialogKeydown','appInitContentAccessibility','appHasUnsavedChanges','appMarkUnsavedChanges','appClearUnsavedChanges','appEditableDirtyScope','appConfirmNavigationIfDirty','appOpenUnsavedConfirm','fecharConfirmUnsaved','fecharOverlay','appSetStatus','appSetInlineStatusMessage'])}
    document.addEventListener('input',event=>{const id=appEditableDirtyScope(event.target);if(id)appMarkUnsavedChanges(id);},true);
    document.addEventListener('change',event=>{const id=appEditableDirtyScope(event.target);if(id)appMarkUnsavedChanges(id);},true);
    appInitContentAccessibility();
  ` });
  await page.addScriptTag({ content:readProjectFile('IndexFarmaciaScripts.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '') });
  await page.addScriptTag({content:readProjectFile('IndexFarmaciaViewScripts.html').replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,'')});
  await page.evaluate(() => {
    document.getElementById('page-farmacia').classList.add('active');
    document.getElementById('navFarmaciaSection').style.display='';
    document.getElementById('navFarmacia').style.display='';
    document.getElementById('topTitle').textContent='Farmácia';
    window.farmaciaSetView('stock');
    const select=document.getElementById('farmaciaStudy');
    select.disabled=false; select.innerHTML='<option value="">Selecione</option><option value="P1">Estudo A</option><option value="P2">Estudo B</option>';
  });
  if (iconFont) await page.evaluate(()=>document.fonts.ready);
  return { page, errors };
}

async function openStock(page, data, id = 'P1') {
  await page.locator('#farmaciaStudy').selectOption(id);
  await page.evaluate(studyId => window.pending.at(-1).success({ study:{ id:studyId, nome:'Estudo fictício' }, farmaciaAccess:'manage', restrictedAllowed:true }), id);
  await page.evaluate(result => window.pending.at(-1).success(result), data);
}

test('Farmácia navega por área, mantém estoque, filtra tabelas e apresenta configuração pendente sem blocos vazios', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for (const width of [1440,390]) {
      const {page,errors}=await fixture(browser,width);
      assert.equal(await page.locator('#page-farmacia h1, #page-farmacia h2, #page-farmacia h3').filter({hasText:'Farmácia'}).count(),0);
      assert.equal(await page.locator('#navFarmaciaSection .nav-section').count(),0);
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
      assert.equal(await page.locator('#farmaciaProductsResults').isVisible(),true);
      assert.equal(await page.locator('#farmaciaInventoryResults').isVisible(),false);
      await page.locator('#farmaciaSearch').fill('seringa');
      assert.equal(await page.locator('#farmaciaProductsResults tr[data-farmacia-row]:visible').count(),1);
      await page.locator('#farmaciaSearch').fill('inexistente');
      assert.equal(await page.locator('#farmaciaSearchEmpty').isVisible(),true);
      await chooseView(page,'probes');
      assert.equal(await page.locator('#farmaciaStudy').inputValue(),'P1');
      assert.equal(await page.locator('#farmaciaSearch').inputValue(),'');
      assert.equal(await page.locator('[data-farmacia-view="probes"]').getAttribute('aria-current'),'page');
      assert.equal(await page.evaluate(()=>window.pending.length),count,'troca de área não dispara consulta ou altera dados');
      assert.equal(await page.locator('#farmaciaMetric2').innerText(),'1');
      assert.match(await page.locator('#farmaciaProbesResults').innerText(),/Vencida/);
      await page.screenshot({animations:'disabled',path:path.join(artifacts,'farmacia-redesign-sondas-'+width+'.png')});
      await chooseView(page,'equipment');
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

test('modal da Farmácia usa foco/dirty reais, bloqueia fechamento em voo e preserva formulário após falha', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    const {page,errors}=await fixture(browser,1280);
    await openStock(page,stockData());
    await openForm(page,'products');
    await page.waitForFunction(()=>document.activeElement.id==='farmaciaProductName');
    assert.equal(await page.locator('#farmaciaModal-product .modal-box').getAttribute('aria-modal'),'true');
    await page.locator('#farmaciaProductForm button[type=submit]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.className),'modal-close');
    await page.locator('#farmaciaProductName').fill('Produto em edição');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#confirmUnsaved').isVisible(),true);
    await page.getByRole('button',{name:'Continuar editando'}).click();
    assert.equal(await page.locator('#farmaciaProductName').inputValue(),'Produto em edição');
    await page.locator('#farmaciaProductPresentation').fill('Frasco');
    await page.locator('#farmaciaProductInstructions').fill('Instrução fictícia');
    await page.locator('#farmaciaProductSource').fill('Rótulo fictício');
    await page.locator('#farmaciaProductVersion').fill('1');
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

async function openForm(page,view) {
  await chooseView(page,view);
  await page.locator('#farmaciaPrimaryAction').click();
}

test('setup cadastra equipamento sem faixas presumidas, sonda e calibração com revisão em desktop/celular', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for(const width of [1280,390]) {
      const {page,errors}=await fixture(browser,width);
      const data=stockData({locationsCanManage:true});
      await openStock(page,data);
      await openForm(page,'equipment');
      await page.locator('#farmaciaLocationCode').fill('IPS AF-02');
      await page.locator('#farmaciaLocationModel').fill('phcbi MPR-721R-PA');
      await page.locator('#farmaciaLocationRoom').fill('Farmácia fictícia');
      await page.locator('#farmaciaLocationSource').fill('Qualificação fictícia pendente');
      await page.locator('#farmaciaLocationVersion').fill('2026-10-21');
      await page.locator('#farmaciaLocationPositions').fill('Prateleira 1\nPrateleira 2');
      assert.equal(await page.locator('#farmaciaLocationMin').inputValue(),'');
      assert.equal(await page.locator('#farmaciaLocationMax').inputValue(),'');
      await page.locator('#farmaciaLocationForm').getByRole('button',{name:'Cadastrar equipamento',exact:true}).click();
      const location=await page.evaluate(()=>window.pending.at(-1));
      assert.equal(location.method,'cadastrarLocalFarmacia'); assert.equal(location.args[0].data.min,null);
      assert.deepEqual(location.args[0].data.positions,['Prateleira 1','Prateleira 2']);
      await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada'}));
      assert.equal(await page.locator('#farmaciaLocationCode').inputValue(),'IPS AF-02');
      await page.locator('#farmaciaLocationForm').getByRole('button',{name:'Cadastrar equipamento',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),location.args[0].requestId);
      await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      await openForm(page,'probes');
      await page.locator('#farmaciaProbeUnit').selectOption('UNIT-1');
      await page.locator('#farmaciaProbeCode').fill('SONDA-01');
      await page.locator('#farmaciaProbeSerial').fill('SERIE-01');
      await page.locator('#farmaciaProbeModel').fill('Modelo fictício');
      await page.locator('#farmaciaProbePoint').fill('Ponto superior');
      await page.locator('#farmaciaProbeCalibrationStatus').selectOption('current');
      await page.locator('#farmaciaProbeCalibratedOn').fill('2026-01-01');
      await page.locator('#farmaciaProbeValidUntil').fill('2026-10-20');
      await page.locator('#farmaciaProbeCertificate').fill('CERT-01');
      await page.locator('#farmaciaProbeForm').getByRole('button',{name:'Cadastrar sonda',exact:true}).click();
      const saved=await page.evaluate(()=>window.pending.at(-1));
      assert.equal(saved.method,'cadastrarSondaFarmacia'); assert.equal(saved.args[0].data.serial,'SERIE-01');
      await page.evaluate(()=>window.pending.at(-1).success({ok:true}));
      data.storageUnits[0].probes=[{...saved.args[0].data,id:'PROBE-1',revision:1,calibrationStatus:'expired'}];
      await page.evaluate(result=>window.pending.at(-1).success(result),data);
      assert.match(await page.locator('#farmaciaProbesResults').innerText(),/Vencida/);
      await page.getByRole('button',{name:'Ver sonda SONDA-01',exact:true}).click();
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
    const data=stockData(); data.products[0].storage={min:2,max:8,instructions:'Não congelar',source:'Manual fictício',version:'2'};
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
      await page.evaluate(() => window.renderFarmaciaStudies([{id:'@IPS_COMMON',nome:'Estoque comum do IPS'},{id:'P1',nome:'Estudo A'}]));
      await page.locator('#farmaciaStudy').selectOption('@IPS_COMMON');
      assert.equal(await page.evaluate(() => window.pending.at(-1).args[0]),'@IPS_COMMON');
      await page.evaluate(() => window.pending.at(-1).success({study:{id:'@IPS_COMMON',nome:'Estoque comum do IPS'},farmaciaAccess:'manage',restrictedAllowed:false}));
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
      await page.locator('#farmaciaProductName').fill('Seringa fictícia');
      await page.locator('#farmaciaProductPresentation').fill('10 mL');
      await page.locator('#farmaciaProductInstructions').fill('Instrução fictícia');
      await page.locator('#farmaciaProductSource').fill('Rótulo fictício');
      await page.locator('#farmaciaProductVersion').fill('1');
      await page.locator('#farmaciaProductForm').getByRole('button',{name:'Cadastrar produto'}).click();
      assert.equal(await page.evaluate(() => window.pending.at(-1).args[0].studyId),'@IPS_COMMON');
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
      await page.locator('#farmaciaProductName').fill('Kit fictício');
      await page.locator('#farmaciaProductPresentation').fill('Caixa de teste');
      await page.locator('#farmaciaProductInstructions').fill('Conferir manual fictício');
      await page.locator('#farmaciaProductSource').fill('Manual fictício');
      await page.locator('#farmaciaProductVersion').fill('1');
      await page.locator('#farmaciaProductControl').selectOption('kit');
      assert.equal(await page.locator('#farmaciaProductUnit').inputValue(),'kit');
      assert.equal(await page.locator('#farmaciaProductUnit').isDisabled(),true);
      await page.locator('#farmaciaProductForm').getByRole('button',{name:'Cadastrar produto'}).click();
      const first=await page.evaluate(()=>window.pending.at(-1).args[0]);
      assert.equal(first.studyId,'P1'); assert.equal(first.restricted,false); assert.equal(first.data.control,'kit');
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
