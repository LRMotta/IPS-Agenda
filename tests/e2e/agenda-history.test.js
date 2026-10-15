'use strict';
/* global window, document */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {loadPlaywright}=require('../helpers/playwright-runtime');
const {agendaBrowserFixture}=require('../helpers/agenda-browser-fixture');
const {contentAccessibilitySource}=require('../helpers/content-accessibility-source');

test('histórico só consulta ao clicar, pagina, trata erro e descarta resposta de outro evento no desktop/celular',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for(const width of [1280,390]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=await agendaBrowserFixture(page);
      await page.addScriptTag({content:contentAccessibilitySource(['fecharModalSeClicouFora'])});
      await page.evaluate(()=>{
        document.getElementById('agendaCreatePanel').classList.remove('open');
        window._agendaEventosPorId['AG-123']={id:'AG-123',participante:'Participante de teste',projeto:'Estudo AB',data:'20/10/2026'};
        document.getElementById('agendaViewLista').innerHTML=window.agendaCardHtml({id:'AG-123',rowIndex:42,tipo:'Visita',participante:'Participante de teste',projeto:'Estudo AB',status:'Agendado',hora:'09:00'},'history-test');
      });
      assert.equal(await page.title(),'Agenda — teste local');
      assert.equal(page.url(),'about:blank');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(),0);
      assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico').length),0);
      await page.getByRole('button',{name:'Mais ações',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico').length),0);
      await page.getByRole('menuitem',{name:'Histórico do agendamento',exact:true}).click();
      assert.equal(await page.locator('#modalAgendaHistorico').isVisible(),true);
      assert.equal(await page.locator('#agendaHistoricoMais').isDisabled(),true);
      await page.evaluate(()=>window.carregarAgendaHistorico());
      assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico').length),1);
      const data={agendaId:'AG-123',rows:[{timestamp:'15/10/2026 09:20:00',email:'equipe@exemplo.org',action:'Alteração do agendamento',field:'Data',oldValue:'20/10/2026',newValue:'22/10/2026'},{timestamp:'15/10/2026 09:20:00',email:'equipe@exemplo.org',action:'Alteração do agendamento',field:'Horário',oldValue:'08:00',newValue:'09:30'}],hasMore:true,nextBefore:502};
      await page.evaluate(d=>window.calls.find(c=>c.method==='getAgendaHistorico').success(d),data);
      assert.equal(await page.locator('#agendaHistoricoLista li').count(),2);
      assert.equal(await page.locator('#agendaHistoricoLista').evaluate(el=>el.scrollWidth>el.clientWidth),false);
      const dir=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright');
      fs.mkdirSync(dir,{recursive:true});
      await page.clock.runFor(250);
      await page.screenshot({animations:'disabled',path:path.join(dir,'agenda-history-'+width+'.png')});
      await page.getByRole('button',{name:'Buscar registros anteriores'}).click();
      assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[1].args),['AG-123',502]);
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[1].failure(new Error('Falha simulada')));
      await page.getByRole('button',{name:'Tentar novamente'}).click();
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[2].success({agendaId:'AG-123',rows:[],hasMore:false,nextBefore:null}));
      assert.equal(await page.locator('#agendaHistoricoMais').isVisible(),false);
      await page.getByRole('button',{name:'Fechar histórico'}).click();
      await page.evaluate(()=>window.abrirAgendaHistorico('A'));
      await page.evaluate(()=>window.abrirAgendaHistorico('B'));
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[3].success({agendaId:'A',rows:[{field:'Obsoleto'}],hasMore:false}));
      assert.equal(await page.locator('#agendaHistoricoLista li').count(),0);
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[4].success({agendaId:'B',rows:[{timestamp:'hoje',email:'<img src=x onerror=alert(1)>',action:'Alteração',field:'Status',oldValue:'Agendado',newValue:'Confirmado'}],hasMore:false}));
      assert.equal(await page.locator('#agendaHistoricoLista img').count(),0);
      await page.evaluate(()=>window.abrirAgendaHistorico('C'));
      await page.getByRole('button',{name:'Fechar histórico'}).click();
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[5].success({agendaId:'C',rows:[{field:'Fechado'}],hasMore:false}));
      assert.equal(await page.locator('#agendaHistoricoLista li').count(),0);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close();}
});
