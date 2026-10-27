'use strict';
/* global document, window, FARMACIA_STOCK, farmaciaDocumentHtml, farmaciaCycleNavigate, farmaciaEstoqueReset */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {loadPlaywright}=require('../helpers/playwright-runtime');
const {cycleFixture,cycleData}=require('../helpers/farmacia-cycle-browser-fixture');

test('impressão abre prévia de dispensação e ficha consolidada em desktop/celular sem mutações',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{for(const width of [1536,390]){
    const {page,errors}=await cycleFixture(browser,width);
    await page.evaluate(()=>{window.CURRENT_ACCESS={ok:true,name:'Profissional de Teste Completo',firstName:'Profissional',email:'impressor@example.invalid'};});
    const before=await page.evaluate(()=>JSON.stringify(FARMACIA_STOCK.data));
    await page.locator('[data-pane="dispense"]').click();
    const popupReady=page.waitForEvent('popup');await page.getByRole('button',{name:'Imprimir registro',exact:true}).click();const preview=await popupReady;
    await preview.waitForLoadState();
    assert.match(await preview.title(),/Registro de dispensação/);
    assert.match(await preview.locator('header.head').innerText(),/Emitido por Profissional de Teste Completo/);
    assert.doesNotMatch(await preview.locator('header.head').innerText(),/IPS \| UCS/);
    assert.equal(await preview.locator('.signature-name').first().innerText(),'Profissional de Teste Completo');
    assert.equal(await preview.locator('.signature-name').nth(1).innerText(),'');
    assert.equal(await preview.evaluate(()=>window.opener),null);
    assert.equal(await preview.locator('.document-logo').count(),1);
    assert.match(await preview.locator('.document-logo').getAttribute('src'),/^data:image\/png;base64,/);
    assert.match(await preview.locator('body').innerText(),/DEMO-014/);
    assert.match(await preview.locator('body').innerText(),/PRESC-DEMO-14/);
    assert.equal(await preview.locator('.signature').count(),2);
    assert.match(await preview.locator('.signatures').innerText(),/Nome legível/);
    await preview.evaluate(()=>{window.printed=false;window.print=()=>{window.printed=true;};});
    await preview.getByRole('button',{name:'Imprimir / Salvar em PDF',exact:true}).click();assert.equal(await preview.evaluate(()=>window.printed),true);
    await preview.emulateMedia({media:'print'});assert.equal(await preview.locator('.toolbar').isVisible(),false);
    const dir=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright');fs.mkdirSync(dir,{recursive:true});
    if(width===1536)await preview.pdf({path:path.join(dir,'farmacia-dispensacao.pdf'),preferCSSPageSize:true});
    await preview.emulateMedia({media:'screen'});await preview.setViewportSize({width,height:1000});
    await preview.screenshot({path:path.join(dir,'farmacia-documento-'+width+'.png'),fullPage:true});
    assert.equal(await preview.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await preview.close();
    await page.evaluate(()=>farmaciaCycleNavigate('cycle','RET1'));
    const lotReady=page.waitForEvent('popup');await page.getByRole('button',{name:'Imprimir ficha do lote / kit',exact:true}).click();const lot=await lotReady;
    assert.match(await lot.title(),/Ficha de controle/);assert.equal(await lot.locator('tbody tr').count(),2);
    assert.match(await lot.locator('body').innerText(),/RET-DEMO-01/);await lot.close();
    assert.equal(await page.evaluate(()=>JSON.stringify(FARMACIA_STOCK.data)),before);
    assert.equal(await page.evaluate(()=>window.pending.length),0);
    assert.deepEqual(errors,[]);await page.close();
  }}finally{await browser.close();}
});

test('documentos vinculam transporte, destinação e adesão histórica sem incluir retornos futuros',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page,errors}=await cycleFixture(browser);const data=cycleData({farmaciaAccess:'read'});
    const event=(id,detail)=>({id,type:'LIFECYCLE',author:'farm@example.invalid',registeredAt:'2026-10-26T12:00:00.000Z',data:{positionId:'IN1',occurredOn:'2026-10-26',...detail}});
    const ret=data.movements.find(r=>r.id==='RET1');ret.data.adherence={dailyDose:2,firstDose:'2026-10-15',lastDose:'2026-10-24',confirmedFixedDose:true};ret.adherenceResult={days:10,consumed:25,expected:20,percent:125};
    data.movements.push(event('RET-LATER',{action:'return',dispenseId:'DISP1',quantity:3}));
    data.movements.push(event('DEP1',{action:'transport_departure',operation:'administration',dispenseId:'DISP1',quantity:10,origin:'Origem A',destination:'Destino B',departureTime:'09:00',thermometer:'TERM1',min:15,max:25,departureTemperature:20}));
    data.movements.push({...event('ARR1',{action:'transport_arrival',departureId:'DEP1',arrivalTime:'10:00',currentTemperature:22,minTemperature:20,maxTemperature:27,confirmed:true}),excursion:true});
    data.movements.push(event('DEST1',{action:'destination',quantity:2,from:'blocked',destination:'disposal',authorization:'AUT-123',document:'CERT-456',reason:'Descarte documentado'}));
    await page.evaluate(d=>{FARMACIA_STOCK.data=d;},data);
    const retHtml=await page.evaluate(()=>farmaciaDocumentHtml('RET1',false));
    await page.setContent(retHtml);assert.match(await page.locator('body').innerText(),/125%/);
    assert.equal(await page.locator('dl>div').filter({has:page.locator('dt',{hasText:'Total retornado até este registro'})}).locator('dd').innerText(),'5 comprimido');
    // Use another fixture: setContent deliberately removed the original app scripts.
    const next=await cycleFixture(browser);await next.page.evaluate(d=>{FARMACIA_STOCK.data=d;},data);
    const dep=await next.page.evaluate(()=>farmaciaDocumentHtml('DEP1',false));const arr=await next.page.evaluate(()=>farmaciaDocumentHtml('ARR1',false));
    await page.setContent(dep);assert.equal(await page.locator('section').count(),3);assert.match(await page.locator('body').innerText(),/Destino B/);assert.match(await page.locator('body').innerText(),/Identificada — requer avaliação/);
    await page.setContent(arr);assert.match(await page.locator('body').innerText(),/TERM1/);assert.match(await page.locator('body').innerText(),/Responsável pelo recebimento/);
    await page.setContent(await next.page.evaluate(()=>farmaciaDocumentHtml('DEST1',false)));assert.match(await page.locator('body').innerText(),/AUT-123/);assert.match(await page.locator('body').innerText(),/CERT-456/);
    assert.deepEqual(errors,[]);assert.deepEqual(next.errors,[]);
  }finally{await browser.close();}
});

test('impressão escapa conteúdo e rejeita referências ausentes ou consulta encerrada',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try{
    const {page}=await cycleFixture(browser);
    await page.evaluate(()=>{window.CURRENT_ACCESS={ok:true,name:'<img src=x onerror=alert(1)>'};FARMACIA_STOCK.data.products[0].name='<img src=x onerror="window.compromised=true">';FARMACIA_STOCK.data.movements[1].data.reason='</dd><script>window.compromised=true</script>';});
    const html=await page.evaluate(()=>farmaciaDocumentHtml('DISP1',false));
    assert.equal(await page.evaluate(()=>farmaciaDocumentHtml('missing',false)),'');
    await page.evaluate(()=>farmaciaEstoqueReset());assert.equal(await page.evaluate(()=>farmaciaDocumentHtml('DISP1',false)),'');
    await page.setContent(html);assert.equal(await page.locator('img[onerror],script').count(),0);assert.equal(await page.evaluate(()=>window.compromised),undefined);
  }finally{await browser.close();}
});
