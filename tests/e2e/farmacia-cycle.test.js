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
    assert.equal(await page.locator('#farmaciaLifecycleSummary .farmacia-life-card').count(),7);
    assert.equal(await page.locator('#farmaciaSummary').isVisible(),false);
    assert.match(await page.locator('[data-filter="all"]').textContent(),/1 lote/);
    await capture(page,'estoque',width);
    await page.locator('[data-filter="available"]').click();assert.equal(await page.locator('#farmaciaInventoryResults tr[data-farmacia-row]:visible').count(),1);
    await page.locator('[data-filter="blocked"]').click();assert.equal(await page.locator('#farmaciaInventoryResults tr[data-farmacia-row]:visible').count(),2);
    await page.locator('[data-filter="all"]').click();await page.locator('#farmaciaSearch').fill('inexistente');assert.equal(await page.locator('#farmaciaSearchEmpty').isVisible(),true);
    await page.locator('#farmaciaSearch').fill('');await page.locator('[data-farmacia-position="IN1"] .farmacia-cycle-link').click();
    assert.equal(await page.locator('.farmacia-cycle-event').count(),4);assert.equal(await page.locator('#farmaciaLifecycleSummary').isVisible(),true);assert.equal(await page.locator('#farmaciaLifecycleSummary [aria-pressed="true"]').count(),0);assert.match(await page.locator('.farmacia-cycle-balances').textContent(),/115/);await capture(page,'historico',width);
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
    await page.locator('[name="participantId"]').selectOption('CAD-014');await page.locator('[name="visit"]').fill('C2D1');
    assert.match(await page.locator('[name="guidePosition"] option[value="IN1"]').textContent(),/100 comprimido disponíveis/);
    assert.equal(await page.locator('.farmacia-guide-remove').isVisible(),false);assert.equal(await page.locator('[name="platformReference"]').getAttribute('required'),null);
    await page.locator('[name="guidePosition"]').selectOption('IN1');await page.locator('[name="guideQuantity"]').fill('10');
    await page.getByRole('button',{name:'Adicionar item',exact:true}).click();assert.equal(await page.locator('.farmacia-guide-item').count(),2);
    assert.match(await page.locator('.farmacia-guide-item').nth(1).locator('[data-guide-label]').textContent(),/Item 2/);
    await page.locator('[name="guidePosition"]').nth(1).selectOption('IN1');await page.locator('[name="guideQuantity"]').nth(1).fill('5');await page.locator('[name="validThrough"]').fill('2026-11-10');await page.locator('[name="prescription"]').fill('PRESC-NOVA');await page.locator('[name="platformReference"]').fill('IRT-NOVA');await page.locator('[name="document"]').fill('DOC-NOVO');await page.locator('[name="confirmed"]').check();
    assert.equal(await page.locator('#farmaciaLifecycleSummary').isVisible(),false);
    await capture(page,'dispensacao',1536);const before=await page.evaluate(()=>window.pending.length);await page.locator('#farmaciaCycleForm [type="submit"]').click();
    assert.match(await page.locator('#farmaciaCycleSaveStatus').textContent(),/mais de uma vez/);assert.equal(await page.evaluate(()=>window.pending.length),before);
    await page.getByRole('button',{name:'Remover item 2',exact:true}).click();assert.equal(await page.locator('.farmacia-guide-item').count(),1);
    await page.locator('#farmaciaCycleForm [type="submit"]').click();
    const payload=await page.evaluate(()=>window.pending.at(-1).args[0]);assert.equal(payload.items.length,1);assert.equal(payload.items[0].revision,'OP-BLOCK');assert.equal(payload.items[0].quantity,10);assert.equal(payload.data.participantId,'CAD-014');assert.equal(payload.data.platformReference,'IRT-NOVA');
    await page.evaluate(()=>window.farmaciaStockRefresh());assert.equal(await page.locator('#confirmUnsaved').evaluate(node=>node.classList.contains('open')),false);assert.equal(await page.evaluate(()=>window.pending.at(-1).method),'registrarDispensacaoFarmacia');
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Conflito de revisão'}));assert.equal(await page.locator('[name="guideQuantity"]').inputValue(),'10');assert.match(await page.locator('#farmaciaCycleSaveStatus').textContent(),/preservados/);
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
    assert.equal(await page.getByRole('button',{name:'Devolver / destruir',exact:true}).count(),0);
    await render('manage');await page.locator('[data-pane="cycle"]').click();
    assert.equal(await page.getByRole('button',{name:'Devolver / destruir',exact:true}).count(),1);
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

test('revalidação no histórico do lote envia nova validade, lote e documento com a revisão atual; recebimento abre como recebimento',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    await page.locator('[data-farmacia-position="IN1"] [data-action="view"]').click();
    const form=page.locator('#farmaciaRevalidationForm');
    assert.equal(await form.isVisible(),true);
    assert.match(await form.textContent(),/110 comprimido/);
    assert.equal(await page.locator('#farmaciaRevalidationLot').inputValue(),'DEMO-001');
    await page.locator('#farmaciaRevalidationExpiry').fill('2028-02-29');
    await page.locator('#farmaciaRevalidationReason').fill('Extensão de validade');
    await page.locator('#farmaciaRevalidationDocument').fill('Carta do patrocinador 20/10/2026');
    await capture(page,'revalidacao',1536);
    await form.locator('[type="submit"]').click();
    const call=await page.evaluate(()=>window.pending.at(-1));
    assert.equal(call.method,'registrarRevalidacaoFarmacia');
    assert.deepEqual(call.args[0].data,{positionId:'IN1',revision:'OP-BLOCK',lot:'DEMO-001',expiry:'2028-02-29',occurredOn:'2026-10-26',reason:'Extensão de validade',document:'Carta do patrocinador 20/10/2026'});
    await page.evaluate(()=>window.pending.at(-1).failure({message:'O saldo mudou.'}));
    assert.match(await page.locator('#farmaciaModal-positionDetail .farmacia-dialog-status').textContent(),/preservados/);
    assert.equal(await page.locator('#farmaciaRevalidationDocument').inputValue(),'Carta do patrocinador 20/10/2026');
    await page.evaluate(()=>{const data=FARMACIA_STOCK.data;data.positions[0].origin='receipt';renderFarmaciaEstoque(data);});
    await page.evaluate(()=>window.farmaciaOpenRecordAction('position','IN1','edit'));
    assert.equal(await page.locator('#farmaciaRecordActionTitle').textContent(),'Editar recebimento');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('memorando de devolução / destruição: vários lotes, campos por destinação e falha preservada',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{for(const width of [1536,390]){
    const {page,errors}=await cycleFixture(browser,width);
    await page.locator('[data-pane="destination"]').click();
    assert.match(await page.locator('#farmaciaCyclePane h2').first().textContent(),/Devolução e destruição/);
    await page.getByRole('button',{name:'Novo memorando',exact:true}).click();
    assert.match(await page.locator('[name="guidePosition"] option[value="RET1"]').textContent(),/5 comprimido em quarentena · retornado/);
    assert.equal(await page.locator('#farmaciaCycleMemoSponsor').isVisible(),true);assert.equal(await page.locator('#farmaciaCycleMemoDisposal').isVisible(),false);
    await page.locator('[name="reasonCategory"]').selectOption('participant_return');await page.locator('[name="authorization"]').fill('E-mail CRA 20/11');await page.locator('[name="awb"]').fill('AWB-777');await page.locator('[name="document"]').fill('SOP-FARM-07');
    await page.locator('[name="guidePosition"]').selectOption('RET1');await page.locator('[name="guideQuantity"]').fill('5');await page.locator('[name="guideCondition"]').selectOption('mixed');
    assert.equal(await page.locator('[name="guideNote"]').getAttribute('required'),'');await page.locator('[name="guideNote"]').fill('3 cheios, 2 vazios');
    await page.getByRole('button',{name:'Adicionar lote / kit',exact:true}).click();assert.match(await page.locator('.farmacia-guide-item').nth(1).locator('[data-guide-label]').textContent(),/Item 2/);
    await page.locator('[name="guidePosition"]').nth(1).selectOption('IN1');await page.locator('[name="guideQuantity"]').nth(1).fill('10');await page.locator('[name="guideCondition"]').nth(1).selectOption('intact');
    assert.equal(await page.locator('[name="guideQuantity"]').nth(1).getAttribute('max'),'10');
    await page.locator('[name="confirmed"]').check();await capture(page,'memorando',width);
    await page.locator('#farmaciaCycleForm [type="submit"]').click();
    const call=await page.evaluate(()=>window.pending.at(-1));assert.equal(call.method,'registrarDestinacaoFarmacia');
    const payload=call.args[0];assert.equal(payload.items.length,2);assert.equal(payload.data.destination,'sponsor');assert.equal(payload.data.awb,'AWB-777');assert.equal(payload.data.company,undefined);
    assert.deepEqual(payload.items.map(i=>[i.positionId,i.quantity,i.from,i.condition,i.itemNote]),[['RET1',5,'blocked','mixed','3 cheios, 2 vazios'],['IN1',10,'blocked','intact','']]);
    // Destruição troca os campos de envio pelos da empresa responsável.
    await page.evaluate(()=>window.pending.at(-1).failure({message:'Falha simulada'}));
    await page.locator('[name="destination"]').selectOption('disposal');assert.equal(await page.locator('#farmaciaCycleMemoDisposal').isVisible(),true);assert.equal(await page.locator('[name="awb"]').isDisabled(),true);
    assert.equal(await page.locator('[name="method"]').inputValue(),'Incineração');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    assert.deepEqual(errors,[]);await page.close();
  }}finally{await browser.close();}
});

test('memorando impresso reúne os itens, o cadastro do estudo e as assinaturas',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);const data=cycleData();
    const common={action:'destination',occurredOn:'2026-10-26',document:'SOP-FARM-07',reason:'',from:'blocked',destination:'disposal',authorization:'AUT-9',memoId:'memo-request-0001',memoNumber:'MEM-2026-004',reasonCategory:'participant_return',company:'Empresa Licenciada Fictícia',method:'Incineração',certificate:'',memoStudy:{code:'PROT-001',sponsor:'Patrocinador Fictício',cro:'CRO Fictícia',site:'123',investigator:'Dra. Fictícia'}};
    const item=(id,positionId,quantity,extra)=>({id,type:'LIFECYCLE',author:'farm@example.invalid',registeredAt:'2026-10-26T12:00:00.000Z',data:{...common,positionId,revision:positionId,quantity,condition:'intact',itemNote:'',...extra}});
    data.movements.push(item('MEM1','RET1',5,{condition:'mixed',itemNote:'3 cheios, 2 vazios'}),item('MEM2','IN1',10));
    await page.evaluate(d=>{FARMACIA_STOCK.data=d;farmaciaCycleNavigate('destination');},data);
    assert.equal(await page.locator('#farmaciaCyclePane tbody tr').count(),1);assert.match(await page.locator('#farmaciaCyclePane tbody').innerText(),/MEM-2026-004/);
    const ready=page.waitForEvent('popup');await page.getByRole('button',{name:'Imprimir memorando',exact:true}).click();const memo=await ready;
    const text=await memo.locator('body').innerText();
    assert.match(await memo.title(),/Memorando de destruição/);assert.equal(await memo.locator('tbody tr').count(),2);
    for(const expected of [/MEM-2026-004/,/Patrocinador Fictício/,/PROT-001/,/Dra\. Fictícia/,/Retornado pelo participante DEMO-014/,/3 cheios, 2 vazios/,/Total:\s*15 comprimido/,/Empresa Licenciada Fictícia/,/preencher após a destruição/,/Farmacêutico\(a\) responsável/,/CRF:/,/Monitor\(a\) do patrocinador/,/Certificado de destruição \/ MTR emitido/]) assert.match(text,expected);
    await memo.screenshot({path:require('node:path').join(process.env.PLAYWRIGHT_ARTIFACTS_DIR||require('node:path').join(os.tmpdir(),'ips-agenda-playwright'),'farmacia-ciclo-memorando-impresso.png'),fullPage:true});
    await memo.close();assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('material emprestado: lista de emprestados em uso, devolução ao estoque sem posição segregada e avariado segregado',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    const data=cycleData();
    data.products.push({id:'PR-LOAN',name:'Mochila térmica fictícia',category:'material',materialUse:'loan',presentation:'1 mochila',unit:'unidade',control:'quantity',supplySource:'sponsor',storage:{min:2,max:8,instructions:''}});
    data.positions.push({id:'IN-LOAN',revision:'DISP-LOAN',productId:'PR-LOAN',lot:'MOCH-1',expiry:'2030-12-31',location:'IPS AF-01 → Gaveta 12',locationRef:{unitId:'UNIT-1',position:'Gaveta 12'},physical:1,available:1,pending:0,blocked:0,origin:'initial',countedOn:'2026-10-12',registeredAt:'2026-10-12T16:10:00.000Z',author:'farm@example.invalid'});
    data.movements.push({id:'DISP-LOAN',type:'LIFECYCLE',registeredAt:'2026-10-20T12:00:00.000Z',author:'farm@example.invalid',data:{action:'dispense',positionId:'IN-LOAN',quantity:1,participantId:'CAD-014',participantLabel:'DEMO-014',visit:'Week 4',occurredOn:'2026-10-20',document:''}});
    await page.evaluate(d=>{FARMACIA_STOCK.data=d;renderFarmaciaEstoque(d);},data);
    await page.locator('[data-pane="return"]').click();
    const loans=page.locator('.farmacia-cycle-loans');
    assert.match(await loans.textContent(),/Materiais emprestados em uso/);assert.match(await loans.textContent(),/DEMO-014.*Mochila térmica fictícia.*há 6 dias/);
    assert.doesNotMatch(await loans.textContent(),/Medicamento fictício/);
    // Retorno de medicamento: o destino não aparece e a posição segregada continua exigida.
    await page.getByRole('button',{name:'Registrar retorno',exact:true}).click();await page.locator('[name="dispenseId"]').selectOption('DISP1');
    assert.equal(await page.locator('[name="returnTo"]').isVisible(),false);assert.equal(await page.locator('[name="unitId"]').isVisible(),true);
    assert.equal(await page.locator('[name="dailyDose"]').isVisible(),true);assert.match(await page.locator('#farmaciaCycleNoticeText').textContent(),/segregada/);
    await page.evaluate(()=>{FARMACIA_CYCLE.form=null;FARMACIA_CYCLE.renderData=null;window.appClearUnsavedChanges('farmaciaCyclePane');farmaciaCycleNavigate('return');});
    await page.locator('.farmacia-cycle-loans').getByRole('button',{name:'Registrar devolução',exact:true}).click();
    assert.equal(await page.locator('[name="dispenseId"]').inputValue(),'DISP-LOAN');
    assert.equal(await page.locator('[name="returnTo"]').isVisible(),true);
    await page.locator('[name="returnTo"]').selectOption('stock');
    assert.equal(await page.locator('[name="unitId"]').isVisible(),false);assert.equal(await page.locator('[name="position"]').isVisible(),false);
    assert.equal(await page.locator('[name="calculateAdherence"]').isVisible(),false);assert.equal(await page.locator('[name="dailyDose"]').isVisible(),false);
    assert.match(await page.locator('#farmaciaCycleNoticeText').textContent(),/volta ao saldo disponível/);assert.match(await page.locator('#farmaciaCycleReturnConfirm').textContent(),/higienização/);
    await capture(page,'devolucao-emprestimo',1536);
    await page.locator('[name="quantity"]').fill('1');await page.locator('[name="document"]').fill('DEV-MOCH');await page.locator('[name="confirmed"]').check();
    await page.locator('#farmaciaCycleForm [type="submit"]').click();
    let payload=await page.evaluate(()=>window.pending.at(-1).args[0]);
    assert.equal(payload.data.returnTo,'stock');assert.equal(payload.data.locationRef,undefined);assert.equal(payload.data.positionId,'IN-LOAN');
    await page.evaluate(()=>window.pending.at(-1).failure(new Error('Falha simulada')));
    // Avariado: volta a pedir a posição segregada.
    await page.locator('[name="returnTo"]').selectOption('quarantine');
    assert.equal(await page.locator('[name="unitId"]').isVisible(),true);
    await page.locator('[name="unitId"]').selectOption('UNIT-1');await page.locator('[name="position"]').selectOption('Área segregada');
    await page.locator('#farmaciaCycleForm [type="submit"]').click();
    payload=await page.evaluate(()=>window.pending.at(-1).args[0]);
    assert.equal(payload.data.returnTo,undefined);assert.equal(payload.data.locationRef.position,'Área segregada');
    assert.deepEqual(errors,[]);await page.close();
  }finally{await browser.close();}
});

test('material do patrocinador sem uso definido: aviso na guia, atalho para o cadastro e selo em Produtos',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);
    const data=cycleData();
    data.products.push({id:'PR-BAG',name:'Bag de transporte fictícia',category:'material',presentation:'1 bag',unit:'unidade',control:'quantity',supplySource:'sponsor',storage:{min:2,max:8,instructions:''}});
    data.products.push({id:'PR-EQUIPO',name:'Equipo fictício',category:'material',materialUse:'site',presentation:'1 equipo',unit:'equipo',control:'quantity',supplySource:'sponsor',storage:{min:15,max:25,instructions:''}});
    for(const [id,productId] of [['IN-BAG','PR-BAG'],['IN-EQUIPO','PR-EQUIPO']])data.positions.push({id,revision:id,productId,lot:'',expiry:'',location:'IPS AF-01 → Gaveta 12',locationRef:{unitId:'UNIT-1',position:'Gaveta 12'},physical:1,available:1,pending:0,blocked:0,origin:'initial',countedOn:'2026-10-12',registeredAt:'2026-10-12T16:10:00.000Z',author:'farm@example.invalid'});
    await page.evaluate(d=>{FARMACIA_STOCK.data=d;renderFarmaciaEstoque(d);},data);
    await page.locator('[data-pane="dispense"]').click();
    const notice=page.locator('#farmaciaCyclePane .farmacia-material-notice');
    assert.match(await notice.textContent(),/⚠ Bag de transporte fictícia não aparece na guia porque falta definir o uso do material/);
    assert.match(await notice.textContent(),/Equipo fictício está marcado como consumido no centro/);
    await capture(page,'material-sem-uso',1536);
    // Dentro da guia o aviso só orienta: a correção recarregaria o formulário.
    await page.getByRole('button',{name:'Registrar dispensação',exact:true}).click();
    assert.match(await page.locator('#farmaciaCycleForm .farmacia-material-notice').textContent(),/Cancele a guia e use “Definir uso”/);
    assert.equal(await page.locator('#farmaciaCycleForm .farmacia-material-notice button').count(),0);
    assert.doesNotMatch(await page.locator('[name="guidePosition"]').first().innerHTML(),/Bag de transporte/);
    await page.evaluate(()=>{FARMACIA_CYCLE.form=null;FARMACIA_CYCLE.renderData=null;window.appClearUnsavedChanges('farmaciaCyclePane');farmaciaCycleNavigate('dispense');});
    await page.getByRole('button',{name:'Definir uso: Bag de transporte fictícia',exact:true}).click();
    assert.equal(await page.locator('#farmaciaModal-recordAction').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'farmaciaAction-materialUse');
    assert.equal(await page.locator('#farmaciaAction-reason').inputValue(),'Definir o uso do material');
    await page.locator('#farmaciaAction-materialUse').selectOption('participant');
    await page.locator('#farmaciaModal-recordAction [type="submit"]').click();
    const payload=await page.evaluate(()=>window.pending.at(-1).args[0]);
    assert.equal(payload.type,'PRODUCT_EDIT');assert.equal(payload.data.data.materialUse,'participant');
    // Sem o nível Responsável não há atalho; a orientação aponta quem corrige.
    await page.evaluate(d=>{FARMACIA_CYCLE.form=null;FARMACIA_CYCLE.renderData=null;FARMACIA_STOCK.saving=false;document.getElementById('farmaciaModal-recordAction').classList.remove('open');d.farmaciaAccess='operate';FARMACIA_STOCK.data=d;renderFarmaciaEstoque(d);farmaciaCycleNavigate('dispense');},data);
    assert.match(await page.locator('#farmaciaCyclePane .farmacia-material-notice').textContent(),/Peça ao Responsável pela Farmácia/);
    assert.equal(await page.locator('#farmaciaCyclePane .farmacia-material-notice button').count(),0);
    const products=await page.evaluate(()=>document.getElementById('farmaciaProductsResults').innerHTML);
    assert.ok(products.includes('Bag de transporte fictícia</strong><span class="chip chip-green">Material / dispositivo</span> <span class="chip chip-orange">⚠ Defina o uso</span>'));
    assert.match(products,/Consumido no centro/);
    assert.deepEqual(errors,[]);await page.close();
  }finally{await browser.close();}
});
