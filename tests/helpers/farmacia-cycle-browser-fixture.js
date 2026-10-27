'use strict';
/* global document, FARMACIA_STOCK, renderFarmaciaEstoque */
const { readProjectFile } = require('./load-app-script');
const { contentAccessibilitySource } = require('./content-accessibility-source');
const fs = require('node:fs');

function extractTagBody(markup,tagName) {
  const source=String(markup),tag=String(tagName).toLowerCase(),lower=source.toLowerCase();
  const openStart=lower.indexOf('<'+tag),openEnd=lower.indexOf('>',openStart+tag.length+1);
  const closeStart=lower.indexOf('</'+tag,openEnd+1),closeEnd=lower.indexOf('>',closeStart+tag.length+2);
  if(openStart<0||openEnd<0||closeStart<0||closeEnd<0)throw new Error(`Tag ${tagName} ausente no fixture`);
  return source.slice(openEnd+1,closeStart);
}

function cycleData(overrides={}) {
  const product={id:'PR1',name:'Medicamento fictício',category:'medicine',presentation:'Comprimidos de demonstração',unit:'comprimido',control:'quantity',supplySource:'sponsor',storage:{min:15,max:25,instructions:'Conforme documento fictício'}};
  const position={id:'IN1',revision:'OP-BLOCK',productId:'PR1',lot:'DEMO-001',expiry:'2027-08-31',location:'IPS AF-01 → Gaveta 12',locationRef:{unitId:'UNIT-1',position:'Gaveta 12'},physical:110,available:100,pending:0,blocked:10,origin:'initial',countedOn:'2026-10-12',registeredAt:'2026-10-12T16:10:00.000Z',author:'farm@example.invalid'};
  const event=(id,type,data,date='2026-10-26T12:00:00.000Z')=>({id,type,data,author:'farm@example.invalid',registeredAt:date});
  return {configured:true,farmaciaAccess:'manage',locationsConfigured:true,locationsCanManage:false,study:{id:'P1',nome:'Estudo demonstrativo A'},
    storageUnits:[{id:'UNIT-1',code:'IPS AF-01',model:'Armário',room:'Farmácia',min:15,max:25,status:'active',positions:['Gaveta 12','Área segregada'],probes:[]}],products:[product],positions:[position,{...position,id:'RET1',revision:'RET1',physical:5,available:0,blocked:5,origin:'return',returned:true,originalPositionId:'IN1',dispenseId:'DISP1',location:'IPS AF-01 → Área segregada',locationRef:{unitId:'UNIT-1',position:'Área segregada'},countedOn:'2026-10-25'}],
    movements:[event('IN1','INITIAL',{physical:140,productId:'PR1',lot:'DEMO-001',countedOn:'2026-10-12'},'2026-10-12T16:10:00.000Z'),event('DISP1','LIFECYCLE',{action:'dispense',positionId:'IN1',quantity:30,participantId:'CAD-014',participantLabel:'DEMO-014',occurredOn:'2026-10-15',document:'DOC-DEMO-14',prescription:'PRESC-DEMO-14'},'2026-10-15T12:00:00.000Z'),event('RET1','LIFECYCLE',{action:'return',positionId:'IN1',dispenseId:'DISP1',quantity:5,occurredOn:'2026-10-25',document:'RET-DEMO-01'},'2026-10-25T12:00:00.000Z'),event('OP-BLOCK','MOVEMENT',{action:'block',positionId:'IN1',quantity:10,from:'available',document:'TEMP-DEMO-03'})],...overrides};
}

async function cycleFixture(browser,width=1536) {
  const page=await browser.newPage({viewport:{width,height:1024}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  await page.route('**/*',r=>r.abort());
  await page.clock.install({time:new Date('2026-10-26T15:00:00.000Z')});
  const iconFont=process.env.FARMACIA_TEST_ICON_FONT;
  const fonts=iconFont?'<style>@font-face{font-family:"Material Symbols Outlined";src:url(data:font/woff2;base64,'+fs.readFileSync(iconFont).toString('base64')+')} .material-symbols-outlined{font-family:"Material Symbols Outlined";font-weight:normal;font-style:normal;letter-spacing:normal;text-transform:none;white-space:nowrap;font-feature-settings:"liga"}</style>':'<style>.material-symbols-outlined{font-size:0!important}</style>';
  const cycle=readProjectFile('IndexFarmaciaCiclo.html');
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS | Farmácia — ciclo local</title>'+readProjectFile('IndexStyles.html')+readProjectFile('IndexStylesAfterDashboard.html')+'<style>'+extractTagBody(cycle,'style')+'</style>'+fonts+'</head><body>'+readProjectFile('IndexContent.html')+readProjectFile('IndexContentAfterDashboard.html')+readProjectFile('IndexContentAfterStock.html')+'</body></html>');
  await page.addScriptTag({content:`
    var FARMACIA_STUDY_REQUEST_ID=0,FARMACIA_REQUEST_ID=1,pending=[],currentPage='farmacia';
    function getCurrentPage(){return currentPage;} function irPara(page){currentPage=page;}
    function abrirOverlay(id){document.getElementById(id).classList.add('open');}
    function fecharModalSeClicouFora(event,id){if(event.target.id===id)fecharOverlay(id);}
    function snackErro(message){throw new Error(message);}
    var APP_ACCESSIBLE_DIALOGS=[],APP_CONTENT_ACCESSIBILITY_READY=false,APP_UNSAVED_SCOPES={},APP_UNSAVED_ON_CANCEL=null;
    function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function appErrorMessage(error){return error.message;}
    function runner(success,failure){return new Proxy({}, {get(target,method){
      if(method==='withSuccessHandler')return fn=>runner(fn,failure);
      if(method==='withFailureHandler')return fn=>runner(success,fn);
      return (...args)=>pending.push({method,args,success,failure});
    }});} var google={script:{run:runner()}};
    ${contentAccessibilitySource(['farmaciaAccessLabel','selecionarFarmaciaStudy','renderFarmaciaStudies','farmaciaStudyLabel','abrirFarmaciaView','toggleNavFarmacia','appSyncNavAccessibility','setMobileNav','closeMobileNav','toggleMobileNav','appDialogFocusable','appFocusDialog','appSyncContentFieldAccessibility','appSyncAccessibleDialogs','appAccessibleDialogKeydown','appInitContentAccessibility','appHasUnsavedChanges','appMarkUnsavedChanges','appClearUnsavedChanges','appEditableDirtyScope','appConfirmNavigationIfDirty','appOpenUnsavedConfirm','fecharConfirmUnsaved','fecharOverlay','appSetStatus','appSetInlineStatusMessage'])}
    document.addEventListener('input',event=>{const id=appEditableDirtyScope(event.target);if(id)appMarkUnsavedChanges(id);},true);
    document.addEventListener('change',event=>{const id=appEditableDirtyScope(event.target);if(id)appMarkUnsavedChanges(id);},true);
    appInitContentAccessibility();
  `});
  for(const file of ['IndexFarmaciaScripts.html','IndexFarmaciaViewScripts.html','IndexFarmaciaLocationActions.html','IndexFarmaciaActions.html','IndexFarmaciaCiclo.html','IndexFarmaciaDocumentos.html']){
    const source=extractTagBody(readProjectFile(file),'script');await page.addScriptTag({content:source});
  }
  await page.evaluate(data=>{
    document.getElementById('page-farmacia').classList.add('active');document.getElementById('navFarmaciaSection').style.display='';document.getElementById('navFarmacia').style.display='';
    document.getElementById('userEmail').textContent='Equipe demonstrativa';document.getElementById('appVersionChip').textContent='Prévia local';
    document.querySelectorAll('[data-farmacia-view="stock"],[data-farmacia-view="products"]').forEach(b=>b.hidden=false);
    const select=document.getElementById('farmaciaStudy');select.disabled=false;select.innerHTML='<option value="P1">Estudo demonstrativo A</option><option value="P2">Outro estudo fictício</option>';
    FARMACIA_STOCK.studyId='P1';FARMACIA_STOCK.data=data;renderFarmaciaEstoque(data);
  },cycleData());
  if(iconFont)await page.evaluate(()=>document.fonts.ready);
  return {page,errors};
}

module.exports={cycleData,cycleFixture};
