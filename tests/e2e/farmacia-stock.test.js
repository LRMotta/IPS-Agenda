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
  const html = readProjectFile('IndexContent.html').replace(/<img\b[^>]*>/g, '<span>IPS | UCS</span>');
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS | Farmácia — estoque local</title>' + readProjectFile('IndexStyles.html') +
    readProjectFile('IndexStylesAfterDashboard.html') + '<style>.material-symbols-outlined{font-size:0!important}</style></head><body>' + html +
    readProjectFile('IndexContentAfterDashboard.html') + readProjectFile('IndexContentAfterStock.html') + '</body></html>');
  await page.addScriptTag({ content:`
    var FARMACIA_STUDY_REQUEST_ID=0, FARMACIA_REQUEST_ID=1, pending=[], currentPage='farmacia';
    function getCurrentPage(){return currentPage;}
    function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function appErrorMessage(error){return error.message;}
    function runner(success,failure){return new Proxy({}, {get(target,method){
      if(method==='withSuccessHandler')return fn=>runner(fn,failure);
      if(method==='withFailureHandler')return fn=>runner(success,fn);
      return (...args)=>pending.push({method,args,success,failure});
    }});}
    var google={script:{run:runner()}};
    ${contentAccessibilitySource(['farmaciaAccessLabel', 'selecionarFarmaciaStudy', 'renderFarmaciaStudies'])}
  ` });
  await page.addScriptTag({ content:readProjectFile('IndexFarmaciaScripts.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '') });
  await page.evaluate(() => {
    document.getElementById('page-farmacia').classList.add('active');
    document.getElementById('navFarmaciaSection').style.display='';
    document.getElementById('navFarmacia').style.display='';
    document.getElementById('topTitle').textContent='Farmácia';
    const select=document.getElementById('farmaciaStudy');
    select.disabled=false; select.innerHTML='<option value="">Selecione</option><option value="P1">Estudo A</option><option value="P2">Estudo B</option>';
  });
  return { page, errors };
}

async function openStock(page, data, id = 'P1') {
  await page.locator('#farmaciaStudy').selectOption(id);
  await page.evaluate(studyId => window.pending.at(-1).success({ study:{ id:studyId, nome:'Estudo fictício' }, farmaciaAccess:'manage', restrictedAllowed:true }), id);
  await page.evaluate(result => window.pending.at(-1).success(result), data);
}

test('setup cadastra equipamento sem faixas presumidas, sonda e calibração com revisão em desktop/celular', async () => {
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for(const width of [1280,390]) {
      const {page,errors}=await fixture(browser,width);
      const data=stockData({locationsCanManage:true});
      await openStock(page,data);
      await page.locator('#farmaciaLocationSetup > summary').click();
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
      await page.locator('#farmaciaProbeSetup > summary').click();
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
      const equipment=page.locator('#farmaciaLocationsResults details').first();
      await equipment.locator('summary').first().click();
      const probe=equipment.locator('details').filter({hasText:'Sonda SONDA-01'});
      assert.match(await probe.locator('summary').innerText(),/Vencida/);
      await probe.locator('summary').click();
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
      await equipment.scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(artifacts,'farmacia-sondas-'+width+'.png')});
      await page.locator('#farmaciaStudy').selectOption('P2');
      assert.equal(await page.locator('#farmaciaLocationsResults').innerText(),'');
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
    await page.locator('details').filter({has:page.locator('#farmaciaInitialForm')}).locator('summary').click();
    await page.locator('#farmaciaInitialProduct').selectOption('PR1');
    await page.locator('#farmaciaInitialUnit').selectOption('UNIT-1');
    await page.locator('#farmaciaInitialLocation').selectOption('Prateleira 1');
    assert.match(await page.locator('#farmaciaInitialStorageStatus').innerText(),/incompatível/);
    assert.equal(await page.locator('#farmaciaLocationSetup').isVisible(),false);
    assert.equal(await page.locator('#farmaciaProbeSetup').isVisible(),false);
    await page.locator('#farmaciaStudy').selectOption('P2');
    await page.evaluate(()=>window.pending.at(-1).success({study:{id:'P2',nome:'Estudo B'},farmaciaAccess:'read',restrictedAllowed:false}));
    await page.evaluate(result=>window.pending.at(-1).success(result),{...data,farmaciaAccess:'read'});
    assert.equal(await page.locator('#farmaciaStockForms').isVisible(),false);
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
      await page.screenshot({path:path.join(artifacts,'farmacia-common-'+width+'.png')});
      await page.locator('details').filter({has:page.locator('#farmaciaProductForm')}).locator('summary').click();
      await page.locator('#farmaciaProductName').fill('Seringa fictícia');
      await page.locator('#farmaciaProductPresentation').fill('10 mL');
      await page.locator('#farmaciaProductInstructions').fill('Instrução fictícia');
      await page.locator('#farmaciaProductSource').fill('Rótulo fictício');
      await page.locator('#farmaciaProductVersion').fill('1');
      await page.locator('#farmaciaProductForm').getByRole('button',{name:'Cadastrar produto'}).click();
      assert.equal(await page.evaluate(() => window.pending.at(-1).args[0].studyId),'@IPS_COMMON');
      await page.evaluate(() => window.pending.at(-1).failure({message:'Falha simulada'}));
      await page.locator('#farmaciaStudy').selectOption('P1');
      assert.equal(await page.locator('#farmaciaStockResults').innerText(),'');
      assert.equal(await page.locator('#farmaciaProductName').inputValue(),'');
      await page.evaluate(() => window.pending.at(-1).success({study:{id:'P1',nome:'Estudo A'},farmaciaAccess:'read',restrictedAllowed:true}));
      await page.evaluate(result => window.pending.at(-1).success(result),stockData({farmaciaAccess:'read',products:[],positions:[]}));
      await page.evaluate(({i,result}) => window.pending[i].success(result),{i:oldIndex,result:data});
      assert.doesNotMatch(await page.locator('#farmaciaStockResults').innerText(),/Equipo fictício/);
      assert.equal(await page.locator('#farmaciaStockForms').isVisible(),false);
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
      const details=page.locator('details').filter({ has:page.locator('#farmaciaProductForm') });
      await details.locator('summary').click();
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
      await page.screenshot({path:path.join(artifacts,'farmacia-stock-'+width+'.png')});
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
    await page.locator('details').filter({has:page.locator('#farmaciaInitialForm')}).locator('summary').click();
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
    assert.equal(await page.locator('#farmaciaStockForms').isVisible(),false);
    await page.locator('#farmaciaStockRestricted').check();
    assert.deepEqual(await page.evaluate(()=>window.pending.at(-1).args),['P2',true]);
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Informações restritas não autorizadas'}));
    assert.equal(await page.locator('#farmaciaStockResults').innerText(),'');
    assert.match(await page.locator('#farmaciaStockStatus').innerText(),/não autorizadas/);
    await page.locator('#farmaciaStockRestricted').uncheck();
    await page.evaluate(result=>window.pending.at(-1).success(result),stockData({configured:false,products:[],positions:[]}));
    assert.match(await page.locator('#farmaciaStockStatus').innerText(),/precisa ser configurado/);
    assert.equal(await page.locator('#farmaciaStockForms').isVisible(),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
