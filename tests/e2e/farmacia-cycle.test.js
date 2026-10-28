'use strict';
/* global document, window, FARMACIA_STOCK, FARMACIA_CYCLE, farmaciaEstoqueReset, farmaciaLifecycleRender, renderFarmaciaEstoque, farmaciaCycleNavigate, farmaciaCycleDispenseOptions, farmaciaCycleOutstanding, appClearUnsavedChanges */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {loadPlaywright}=require('../helpers/playwright-runtime');
const {cycleFixture,cycleData}=require('../helpers/farmacia-cycle-browser-fixture');

async function capture(page,name,width){const dir=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright');fs.mkdirSync(dir,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(dir,'farmacia-ciclo-'+name+'-'+width+'.png')});}

test('ciclo visual filtra sem somar unidades e mostra contabilidade de origem e retorno em desktop/celular',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{for(const width of [1536,390]){
    const {page,errors}=await cycleFixture(browser,width);
    assert.equal(await page.locator('#farmaciaLifecycleSummary .farmacia-life-card').count(),6);
    assert.equal(await page.locator('#farmaciaSummary').isVisible(),false);
    assert.match(await page.locator('[data-filter="all"]').textContent(),/1 lote/);
    await capture(page,'estoque',width);
    await page.locator('[data-filter="available"]').click();assert.equal(await page.locator('#farmaciaInventoryResults tr[data-farmacia-row]:visible').count(),1);
    await page.locator('[data-filter="blocked"]').click();assert.equal(await page.locator('#farmaciaInventoryResults tr[data-farmacia-row]:visible').count(),2);
    await page.locator('[data-filter="all"]').click();await page.locator('#farmaciaSearch').fill('inexistente');assert.equal(await page.locator('#farmaciaSearchEmpty').isVisible(),true);
    await page.locator('#farmaciaSearch').fill('');await page.locator('[data-farmacia-position="IN1"] .farmacia-cycle-link').click();
    assert.equal(await page.locator('.farmacia-cycle-event').count(),4);assert.equal(await page.locator('#farmaciaLifecycleSummary').isVisible(),false);assert.match(await page.locator('.farmacia-cycle-balances').textContent(),/115/);await capture(page,'historico',width);
    await page.getByRole('tab',{name:'Contabilidade',exact:true}).click();assert.match(await page.locator('#farmaciaCyclePane tbody tr').last().textContent(),/115 comprimido/);
    await page.locator('#farmaciaCyclePosition').selectOption('RET1');assert.match(await page.locator('#farmaciaCyclePane tbody tr').last().textContent(),/115 comprimido/);
    await page.getByRole('tab',{name:'Documentos',exact:true}).click();assert.match(await page.locator('#farmaciaCyclePane').textContent(),/RET-DEMO-01/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    assert.deepEqual(errors,[]);await page.close();
  }}finally{await browser.close();}
});

test('dispensação preserva formulário e requestId em falha e descarta respostas após trocar estudo',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    await page.locator('[data-pane="dispense"]').click();await page.getByRole('button',{name:'Registrar dispensação',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'getFarmaciaParticipantes');
    await page.evaluate(()=>window.pending.at(-1).success({participants:[{id:'CAD-014',label:'DEMO-014'}]}));
    await page.locator('[name="participantId"]').selectOption('CAD-014');await page.locator('[name="visit"]').fill('C2D1');await page.locator('#farmaciaCyclePosition').selectOption('IN1');
    await page.locator('[name="quantity"]').fill('10');await page.locator('[name="validThrough"]').fill('2026-11-10');await page.locator('[name="prescription"]').fill('PRESC-NOVA');await page.locator('[name="platformReference"]').fill('IRT-NOVA');await page.locator('[name="document"]').fill('DOC-NOVO');await page.locator('[name="confirmed"]').check();
    await capture(page,'dispensacao',1536);await page.locator('#farmaciaCycleForm [type="submit"]').click();
    const payload=await page.evaluate(()=>window.pending.at(-1).args[0]);assert.equal(payload.data.revision,'OP-BLOCK');assert.equal(payload.data.participantId,'CAD-014');
    await page.evaluate(()=>window.farmaciaStockRefresh());assert.equal(await page.locator('#confirmUnsaved').evaluate(node=>node.classList.contains('open')),false);assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'registrarCicloFarmacia');
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Conflito de revisão'}));assert.equal(await page.locator('[name="quantity"]').inputValue(),'10');assert.match(await page.locator('#farmaciaCycleSaveStatus').textContent(),/preservados/);
    await page.locator('#farmaciaCycleForm [type="submit"]').click();assert.equal(await page.evaluate(()=>window.pending.at(-1).args[0].requestId),payload.requestId);
    await page.evaluate(()=>{window.oldSave=window.pending.at(-1);farmaciaEstoqueReset();document.getElementById('farmaciaStudy').value='P2';window.oldSave.success({ok:true});});
    assert.equal(await page.locator('#farmaciaCyclePane').isVisible(),false);assert.equal(await page.locator('#farmaciaCycleForm').count(),0);
    await page.evaluate(data=>{FARMACIA_STOCK.studyId='P1';document.getElementById('farmaciaStudy').value='P1';FARMACIA_STOCK.data=data;renderFarmaciaEstoque(data);},cycleData({farmaciaAccess:'read'}));
    await page.locator('[data-pane="dispense"]').click();assert.equal(await page.getByRole('button',{name:'Registrar dispensação',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('retorno calcula adesão acumulada e envia posição segregada; transporte mostra excursão e mantém revisão',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    await page.locator('[data-pane="return"]').click();await page.getByRole('button',{name:'Registrar retorno',exact:true}).click();await page.locator('[name="dispenseId"]').selectOption('DISP1');
    await page.locator('[name="quantity"]').fill('5');await page.locator('[name="unitId"]').selectOption('UNIT-1');await page.locator('[name="position"]').selectOption('Área segregada');
    await page.locator('[name="calculateAdherence"]').check();await page.locator('[name="dailyDose"]').fill('2');await page.locator('[name="firstDose"]').fill('2026-10-15');await page.locator('[name="lastDose"]').fill('2026-10-24');
    assert.match(await page.locator('#farmaciaCycleCalculation').textContent(),/100,0%/);await capture(page,'retorno',1536);
    await page.locator('[name="quantity"]').fill('0');assert.match(await page.locator('#farmaciaCycleCalculation').textContent(),/125,0%/);await page.locator('[name="quantity"]').fill('26');assert.doesNotMatch(await page.locator('#farmaciaCycleCalculation').textContent(),/%/);
    await page.locator('[name="quantity"]').fill('5');await page.locator('[name="document"]').fill('RET-NOVO');await page.locator('[name="confirmed"]').check();await page.locator('#farmaciaCycleForm [type="submit"]').click();
    const payload=await page.evaluate(()=>window.pending.at(-1).args[0]);assert.equal(payload.data.action,'return');assert.equal(payload.data.locationRef.position,'Área segregada');assert.equal(payload.data.adherence.confirmedFixedDose,true);
    await page.evaluate(()=>window.pending.at(-1).success({ok:true,id:'RET2'}));await page.evaluate(data=>window.pending.at(-1).success(data),cycleData());
    await page.locator('[data-pane="transport"]').click();await page.getByRole('button',{name:'Registrar saída',exact:true}).click();await page.locator('#farmaciaCyclePosition').selectOption('IN1');
    assert.equal(await page.locator('[name="min"]').inputValue(),'15');assert.equal(await page.locator('#farmaciaCycleDestination').isVisible(),true);
    await page.locator('[name="operation"]').selectOption('administration');assert.equal(await page.locator('#farmaciaCycleDestination').isVisible(),false);assert.equal(await page.locator('[name="dispenseId"]').getAttribute('required'),'');
    await page.evaluate(()=>{FARMACIA_CYCLE.form=null;FARMACIA_CYCLE.renderData=null;window.appClearUnsavedChanges('farmaciaCyclePane');});
    const d=cycleData();d.movements.push({id:'DEP1',type:'LIFECYCLE',registeredAt:'2026-10-26T12:00:00.000Z',author:'farm@example.invalid',data:{action:'transport_departure',positionId:'IN1',quantity:10,occurredOn:'2026-10-26',departureTime:'09:00',origin:'Farmácia',destination:'Local de teste',min:15,max:25}});
    await page.evaluate(data=>{FARMACIA_STOCK.data=data;farmaciaLifecycleRender();},d);await page.getByRole('button',{name:'Registrar chegada',exact:true}).click();await page.locator('[name="currentTemperature"]').fill('22');await page.locator('[name="minTemperature"]').fill('20');await page.locator('[name="maxTemperature"]').fill('27');
    assert.match(await page.locator('#farmaciaCycleCalculation').textContent(),/Excursão identificada/);await capture(page,'transporte',1536);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('quantidade inteira é válida e transporte de kit dispensado usa saldo externo; chegada inclui excursão da saída',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    const data=cycleData();data.products[0].unit='kit';data.products[0].control='kit';data.positions[0].physical=0;data.positions[0].available=0;data.positions[0].blocked=0;data.movements=data.movements.filter(r=>r.data.action!=='return');data.movements.find(r=>r.id==='DISP1').data.quantity=1;
    await page.evaluate(d=>{FARMACIA_STOCK.data=d;farmaciaCycleNavigate('transport');},data);
    await page.getByRole('button',{name:'Registrar saída',exact:true}).click();await page.locator('[name="dispenseId"]').selectOption('DISP1');
    await page.locator('[name="quantity"]').fill('1');assert.equal(await page.locator('[name="quantity"]').getAttribute('min'),'1');assert.equal(await page.locator('[name="quantity"]').getAttribute('max'),'1');assert.equal(await page.locator('[name="quantity"]').evaluate(el=>el.validity.valid),true);
    await page.evaluate(()=>{appClearUnsavedChanges('farmaciaCyclePane');FARMACIA_CYCLE.form=null;});
    data.movements.push({id:'DEP-HOT',type:'LIFECYCLE',author:'farm@example.invalid',registeredAt:'2026-10-26T12:00:00.000Z',data:{action:'transport_departure',positionId:'IN1',operation:'administration',quantity:1,occurredOn:'2026-10-26',departureTime:'09:00',departureTemperature:27,min:15,max:25,origin:'A',destination:'B'}});
    await page.evaluate(d=>{FARMACIA_STOCK.data=d;farmaciaLifecycleRender();},data);await page.getByRole('button',{name:'Registrar chegada',exact:true}).click();
    await page.locator('[name="currentTemperature"]').fill('22');await page.locator('[name="minTemperature"]').fill('20');await page.locator('[name="maxTemperature"]').fill('23');
    assert.match(await page.locator('#farmaciaCycleCalculation').textContent(),/Excursão identificada/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('formulário sujo pede confirmação ao trocar estudo, classe, subseção ou atualizar',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    await page.locator('[data-pane="dispense"]').click();await page.getByRole('button',{name:'Registrar dispensação',exact:true}).click();await page.evaluate(()=>window.pending.at(-1).success({participants:[]}));
    await page.locator('[name="visit"]').fill('C2D1');
    await page.locator('#farmaciaStudy').selectOption('P2');assert.equal(await page.locator('#confirmUnsaved').evaluate(node=>node.classList.contains('open')),true);assert.equal(await page.locator('#farmaciaStudy').inputValue(),'P1');
    await page.getByRole('button',{name:'Continuar editando',exact:true}).click();assert.equal(await page.locator('[name="visit"]').inputValue(),'C2D1');
    await page.evaluate(()=>{document.getElementById('farmaciaRestrictedLabel').hidden=false;});await page.locator('#farmaciaStockRestricted').click();assert.equal(await page.locator('#confirmUnsaved').evaluate(node=>node.classList.contains('open')),true);assert.equal(await page.locator('#farmaciaStockRestricted').isChecked(),false);
    await page.getByRole('button',{name:'Continuar editando',exact:true}).click();
    await page.locator('[data-farmacia-view="products"]').click();assert.equal(await page.locator('#confirmUnsaved').evaluate(node=>node.classList.contains('open')),true);await page.getByRole('button',{name:'Continuar editando',exact:true}).click();assert.equal(await page.locator('[name="visit"]').inputValue(),'C2D1');
    await page.evaluate(()=>window.farmaciaStockRefresh());assert.equal(await page.locator('#confirmUnsaved').evaluate(node=>node.classList.contains('open')),true);await page.getByRole('button',{name:'Continuar editando',exact:true}).click();
    await page.locator('#farmaciaStudy').selectOption('P2');await page.locator('#btnConfirmUnsaved').click();assert.equal(await page.locator('#farmaciaCycleForm').count(),0);assert.equal(await page.locator('#farmaciaStudy').inputValue(),'P2');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('nível Operação vê as ações de rotina e o recebimento, mas não a destinação final',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    const render=level=>page.evaluate(data=>{FARMACIA_STOCK.studyId='P1';document.getElementById('farmaciaStudy').value='P1';FARMACIA_STOCK.data=data;renderFarmaciaEstoque(data);},cycleData({farmaciaAccess:level}));
    await render('operate');
    assert.equal(await page.locator('#farmaciaReceiptAction').isVisible(),true);
    assert.equal(await page.locator('#farmaciaPrimaryAction').isVisible(),false);
    for(const [pane,button] of [['dispense','Registrar dispensação'],['return','Registrar retorno'],['transport','Registrar saída']]){
      await page.locator('[data-pane="'+pane+'"]').click();assert.equal(await page.getByRole('button',{name:button,exact:true}).count(),1);
    }
    await page.locator('[data-pane="overview"]').click();await page.locator('[data-farmacia-position="IN1"] .farmacia-cycle-link').click();
    assert.equal(await page.getByRole('button',{name:'Dispensar',exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'Registrar destinação',exact:true}).count(),0);
    await render('manage');await page.locator('[data-pane="cycle"]').click();
    assert.equal(await page.getByRole('button',{name:'Registrar destinação',exact:true}).count(),1);
    await render('read');
    assert.equal(await page.locator('#farmaciaReceiptAction').isVisible(),false);
    await page.locator('[data-pane="dispense"]').click();assert.equal(await page.getByRole('button',{name:'Registrar dispensação',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('retorno com data anterior à última operação exige motivo na tela e avisa o lançamento retroativo',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    await page.locator('[data-pane="return"]').click();await page.getByRole('button',{name:'Registrar retorno',exact:true}).click();
    await page.locator('[name="dispenseId"]').selectOption('DISP1');
    const last=await page.evaluate(()=>FARMACIA_STOCK.data.movements.filter(r=>r.type==='LIFECYCLE'&&r.data.positionId==='IN1').reduce((max,r)=>r.data.occurredOn>max?r.data.occurredOn:max,''));
    const before=await page.evaluate(date=>new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10),last);
    const notice=page.locator('#farmaciaCycleRetroNotice'),reason=page.locator('#farmaciaCycleForm [name="reason"]');
    assert.equal(await notice.isVisible(),false);
    await page.locator('[name="occurredOn"]').fill(before);
    assert.equal(await notice.isVisible(),true);assert.match(await notice.textContent(),/Lançamento retroativo/);
    assert.equal(await reason.evaluate(node=>node.required),true);
    await page.locator('[name="occurredOn"]').fill(last);
    assert.equal(await notice.isVisible(),false);assert.equal(await reason.evaluate(node=>node.required),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('formulários ocultam o que não se aplica: origem/destino no armazenamento e dispensações já devolvidas',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    await page.locator('[data-pane="transport"]').click();await page.getByRole('button',{name:'Registrar saída',exact:true}).click();
    await page.locator('[name="operation"]').selectOption('storage');
    assert.equal(await page.locator('[name="origin"]').isVisible(),false);assert.equal(await page.locator('[name="destination"]').isVisible(),false);
    await page.locator('[name="operation"]').selectOption('administration');
    assert.equal(await page.locator('[name="origin"]').isVisible(),true);assert.equal(await page.locator('[name="destination"]').isVisible(),true);
    assert.equal(await page.locator('[name="origin"]').getAttribute('maxlength'),'200');
    // O texto livre usa o mesmo limite do servidor.
    await page.getByRole('button',{name:'Cancelar'}).first().click().catch(()=>{});
    const before=await page.evaluate(()=>farmaciaCycleDispenseOptions('').match(/<option/g).length);
    assert.equal(before>=1,true);
    // Dispensação totalmente devolvida deixa de ser oferecida para retorno e transporte.
    const left=await page.evaluate(()=>{const d=FARMACIA_STOCK.data.movements.find(function(r){return r.type==='LIFECYCLE'&&r.data.action==='dispense';});
      FARMACIA_STOCK.data.movements.push({id:'RET-ALL',type:'LIFECYCLE',data:{action:'return',dispenseId:d.id,quantity:farmaciaCycleOutstanding(d.id),positionId:d.data.positionId,occurredOn:'2026-10-26'}});
      return {id:d.id,html:farmaciaCycleDispenseOptions('')};});
    assert.equal(left.html.indexOf('value="'+left.id+'"'),-1);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
