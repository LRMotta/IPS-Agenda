'use strict';
/* global document, FARMACIA_STOCK, renderFarmaciaEstoque, farmaciaCycleNavigate, farmaciaCycleReportRows, pending */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {loadPlaywright}=require('../helpers/playwright-runtime');
const {cycleFixture}=require('../helpers/farmacia-cycle-browser-fixture');

async function capture(page,name,width){const dir=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright');fs.mkdirSync(dir,{recursive:true});await page.screenshot({animations:'disabled',fullPage:true,path:path.join(dir,'farmacia-geral-'+name+'-'+width+'.png')});}

// Estoque Geral fictício: dipirona comprada pelo IPS, dispensada a participante de outro estudo, com sobra devolvida.
function geralData() {
  const event=(id,type,data,date)=>({id,type,data,author:'farm@example.invalid',registeredAt:date});
  const product={id:'PRG1',name:'Dipirona fictícia',category:'medicine',presentation:'500 mg comprimido',unit:'comprimido',control:'quantity',supplySource:'site',storage:{min:15,max:30,instructions:'Ambiente'}};
  const seringa={id:'PRG2',name:'Seringa fictícia',category:'material',presentation:'10 mL',unit:'unidade',control:'quantity',supplySource:'site',materialUse:'site',storage:{min:15,max:30,instructions:'Ambiente'}};
  return {configured:true,farmaciaAccess:'operate',locationsConfigured:true,locationsCanManage:false,study:{id:'@IPS_COMMON',nome:'Geral (Farmácia)'},
    storageUnits:[{id:'UNIT-1',code:'IPS AF-01',status:'active',positions:['Gaveta 1','Quarentena'],probes:[]}],products:[product,seringa],
    positions:[{id:'RCG1',revision:'RTG1',productId:'PRG1',lot:'DIP-01',expiry:'2027-05-31',location:'IPS AF-01 → Gaveta 1',locationRef:{unitId:'UNIT-1',position:'Gaveta 1'},physical:72,available:72,pending:0,blocked:0,origin:'receipt',receivedOn:'2026-09-01'},
      {id:'RCG2',revision:'AJG1',productId:'PRG2',lot:'',expiry:'',location:'IPS AF-01 → Gaveta 1',physical:40,available:40,pending:0,blocked:0,origin:'receipt',receivedOn:'2026-09-01'}],
    movements:[event('RCG1','RECEIPT',{productId:'PRG1',lot:'DIP-01',physical:100,receivedOn:'2026-09-01',document:'NF-10'},'2026-09-01T12:00:00.000Z'),
      event('RCG2','RECEIPT',{productId:'PRG2',lot:'',physical:50,receivedOn:'2026-09-01',document:'NF-10'},'2026-09-01T12:00:00.000Z'),
      event('DSG1','LIFECYCLE',{action:'dispense',positionId:'RCG1',quantity:30,participantId:'CAD-2',participantLabel:'B-201',participantStudyId:'P2',participantStudyLabel:'Outro estudo fictício',visit:'',occurredOn:'2026-10-01',validThrough:''},'2026-10-01T12:00:00.000Z'),
      event('RTG1','LIFECYCLE',{action:'return',positionId:'RCG1',dispenseId:'DSG1',quantity:2,returnTo:'stock',occurredOn:'2026-10-10',document:'Contagem'},'2026-10-10T12:00:00.000Z'),
      {...event('AJG1','ADJUSTMENT',{positionId:'RCG2',kind:'consumption',from:'available',quantity:10,occurredOn:'2026-10-05',responsible:'Equipe',reason:'Procedimentos'},'2026-10-05T12:00:00.000Z'),adjustmentDelta:-10}]};
}

test('estoque Geral: dispensação para participante de qualquer estudo, retorno ao estoque e relatório de consumo',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{for(const width of [1536,390]){
    const {page,errors}=await cycleFixture(browser,width);
    await page.evaluate(data=>{const select=document.getElementById('farmaciaStudy');select.innerHTML='<option value="@IPS_COMMON">Geral (Farmácia)</option>';FARMACIA_STOCK.studyId='@IPS_COMMON';FARMACIA_STOCK.data=data;renderFarmaciaEstoque(data);},geralData());
    const nav=await page.locator('#farmaciaCycleNav').textContent();
    assert.match(nav,/Relatório de consumo/);assert.doesNotMatch(nav,/Transporte|Devolução e destruição/);

    await page.evaluate(()=>farmaciaCycleNavigate('dispense'));
    assert.match(await page.locator('#farmaciaCyclePane').textContent(),/Outro estudo fictício/);
    await page.locator('[data-cycle-action="dispense"]').click();
    assert.equal(await page.locator('#farmaciaCycle-platformReference').count(),0,'Geral não pede IRT');
    await page.evaluate(()=>{const call=pending.find(c=>c.method==='getFarmaciaParticipantes');call.success({participants:[{id:'CAD-1',label:'A-014',studyId:'P1',studyLabel:'Estudo demonstrativo A'},{id:'CAD-2',label:'B-201',studyId:'P2',studyLabel:'Outro estudo fictício'},{id:'CAD-3',label:'B-105',studyId:'P2',studyLabel:'Outro estudo fictício'}]});});
    assert.equal(await page.locator('#farmaciaCycle-participantStudyId option').count(),3);
    await page.selectOption('#farmaciaCycle-participantStudyId','P2');
    assert.deepEqual(await page.locator('#farmaciaCycle-participantId option').allTextContents(),['Selecione o participante','B-105','B-201']);
    await page.selectOption('#farmaciaCycle-participantId','CAD-2');
    const lots=await page.locator('[name="guidePosition"] option').allTextContents();
    assert.ok(lots.some(t=>/Dipirona/.test(t)),'medicamento do Geral entra na guia');assert.ok(!lots.some(t=>/Seringa/.test(t)),'material consumido no centro fica fora');
    await page.selectOption('[name="guidePosition"]','RCG1');await page.fill('[name="guideQuantity"]','10');
    await page.check('#farmaciaCycleForm [name="confirmed"]');
    await capture(page,'dispensacao',width);
    await page.locator('#farmaciaCycleForm [type="submit"]').click();
    const payload=await page.evaluate(()=>pending.find(c=>c.method==='registrarDispensacaoFarmacia').args[0]);
    assert.equal(payload.studyId,'@IPS_COMMON');assert.equal(payload.data.participantStudyId,'P2');assert.equal(payload.data.participantId,'CAD-2');
    assert.equal(payload.data.visit,'');assert.equal(payload.data.validThrough,'');assert.equal(payload.items[0].quantity,10);

    await page.evaluate(()=>{FARMACIA_STOCK.saving=false;farmaciaCycleNavigate('return',null,true);});
    await page.locator('[data-cycle-action="return"]').click();
    await page.selectOption('#farmaciaCycle-dispenseId','DSG1');
    assert.equal(await page.locator('#farmaciaCycle-returnTo').isVisible(),true,'Geral escolhe o destino da sobra');
    assert.match(await page.locator('#farmaciaCycle-returnTo').textContent(),/Sobra conferida/);
    assert.equal(await page.locator('[data-cycle-adherence]').first().isVisible(),false);

    await page.evaluate(()=>farmaciaCycleNavigate('report',null,true));
    const rows=await page.evaluate(()=>farmaciaCycleReportRows().map(r=>[r.product.name,r.used,r.monthly,r.coverage]));
    // Período padrão: 90 dias até 26/10 (fixture). Dipirona: 30 − 2 = 28; seringa: 10 no centro.
    assert.deepEqual(rows,[['Dipirona fictícia',28,9.333,231],['Seringa fictícia',10,3.333,360]]);
    // Unidade concorda com a quantidade e a validade não quebra em duas linhas na coluna estreita.
    const first=page.locator('#farmaciaCyclePane tbody tr').first();
    assert.equal((await first.locator('td').nth(1).textContent()).trim(),'72 comprimidos');
    assert.equal(await first.locator('td').nth(1).locator('.farmacia-cycle-report-nowrap').evaluate(el=>el.ownerDocument.defaultView.getComputedStyle(el).whiteSpace),'nowrap');
    assert.equal(await first.locator('td.farmacia-cycle-report-product').evaluate(el=>el.ownerDocument.defaultView.getComputedStyle(el).overflowWrap),'normal');
    const date=first.locator('td.farmacia-cycle-report-date');
    assert.equal((await date.textContent()).trim(),'31/05/2027');
    assert.equal(await date.evaluate(el=>el.ownerDocument.defaultView.getComputedStyle(el).whiteSpace),'nowrap');
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Exportar planilha'}).click()]);
    assert.equal(download.suggestedFilename(),'relatorio-consumo-geral-2026-07-29-a-2026-10-26.csv');
    const csv=fs.readFileSync(await download.path(),'utf8');
    assert.equal(csv.charCodeAt(0),0xFEFF);assert.match(csv,/Relatório de consumo/);
    assert.match(csv,/Dipirona fictícia · 500 mg comprimido;comprimido;72;0;100;30;2;0;0;28;9,333;231;31\/05\/2027/);
    await capture(page,'relatorio',width);
    assert.deepEqual(errors,[]);
    await page.close();
  }}finally{await browser.close();}
});
