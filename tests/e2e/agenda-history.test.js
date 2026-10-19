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
const {runFiles}=require('../helpers/load-app-script');
const {FakeSheet,FakeSpreadsheet}=require('../helpers/fake-spreadsheet');

function backendFixture(withCreation=false) {
  const rows=[Array(10).fill('header')];
  if(withCreation)rows.push(['CRIACAO',new Date('2026-10-15T12:00:00Z'),'criador@exemplo.org','Agenda','criarAgendaEventoConcluido','AG-123','Agendamento','','Criado','Nota privada']);
  const changes=[
    ['Data','20/10/2026','22/10/2026','atualizarAgendaEventoCompleto'],
    ['Kit','Kit A','Kit B','atualizarAgendaEventoCompleto'],
    ['Polo Trial concluído','','17/10/2026','atualizarAgendaEventoCompleto'],
    ['Transporte I - AWB','1234567890','9876543210','salvarTransporte'],
    ['Transporte II - Status','Agendado','Confirmado','monitorarConfirmacoesCourierAgendadas'],
    ['eCRF concluída','','17/10/2026','atualizarAgendaEventoCompleto'],
    ['Status Requisição','Pendente','Enviada','atualizarStatusRequisicaoAgenda']
  ];
  for(let i=0;i<42;i++) {
    const [field,oldValue,newValue,action]=changes[i%changes.length];
    rows.push(['AUD-'+i,new Date(),'equipe@exemplo.org','Agenda',action,'AG-123',field,oldValue,newValue,'Nota privada']);
    for(let j=0;j<25;j++)rows.push(['OTHER',new Date(),'','Agenda','atualizarAgendaEventoCompleto','OUTRO','Data','','','']);
  }
  const sheet=new FakeSheet('Audit_Changes',rows);
  const server=runFiles(['AgendaHistory.gs'],{Date,Utilities:{formatDate:()=> '17/10/2026 09:20:00'}});
  server.codexAssertCanRead_=()=>({ok:true});
  server.getCodexSpreadsheet_=()=>new FakeSpreadsheet({Audit_Changes:sheet});
  server.codexMeasureReadPerformance_=(_o,_s,_m,fn)=>fn();
  server.codexReadValuesMeasured_=range=>range.getValues();
  return before=>JSON.parse(JSON.stringify(server.getAgendaHistorico('AG-123',before)));
}



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
      const backend=backendFixture();
      const data=backend(null);
      assert.equal(data.rows.length,40);
      await page.evaluate(d=>window.calls.find(c=>c.method==='getAgendaHistorico').success(d),data);
      assert.equal(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),'Criação não registrada');
      assert.match(await page.locator('#agendaHistoricoCriacaoDetalhes').innerText(),/Data e responsável não disponíveis/);
      assert.equal(await page.locator('#agendaHistoricoLista li').count(),40);
      const automaticAuthors=await page.locator('#agendaHistoricoLista li').filter({hasText:'Confirmação automática do transporte'}).locator('small').allTextContents();
      assert.ok(automaticAuthors.length>0);
      assert.ok(automaticAuthors.every(text=>text.endsWith(' · Sistema')));
      const manualAuthors=await page.locator('#agendaHistoricoLista li').filter({hasText:'Atualização da requisição'}).locator('small').allTextContents();
      assert.ok(manualAuthors.length>0);
      assert.ok(manualAuthors.every(text=>text.endsWith(' · equipe@exemplo.org')));
      assert.match(await page.locator('#agendaHistoricoLista').innerText(), /Transporte|Kit|Polo Trial|eCRF/);
      assert.equal(await page.locator('#agendaHistoricoLista').evaluate(el=>el.scrollWidth>el.clientWidth),false);
      const dir=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright');
      fs.mkdirSync(dir,{recursive:true});
      await page.clock.runFor(250);
      await page.screenshot({animations:'disabled',path:path.join(dir,'agenda-history-actors-'+width+'.png')});
      await page.getByRole('button',{name:'Ver mais alterações'}).click();
      assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[1].args),['AG-123',data.nextBefore]);
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[1].failure(new Error('Falha simulada')));
      await page.getByRole('button',{name:'Tentar novamente'}).click();
      const second=backend(data.nextBefore);
      assert.equal(second.rows.length,2);
      await page.evaluate(d=>window.calls.filter(c=>c.method==='getAgendaHistorico')[2].success(d),second);
      assert.equal(await page.locator('#agendaHistoricoLista li').count(),42);
      assert.equal(await page.locator('#agendaHistoricoMais').isVisible(),false);
      await page.getByRole('button',{name:'Fechar histórico'}).click();
      await page.evaluate(()=>window.abrirAgendaHistorico('A'));
      await page.evaluate(()=>window.abrirAgendaHistorico('B'));
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[3].success({agendaId:'A',rows:[{field:'Obsoleto'}],hasMore:false}));
      assert.equal(await page.locator('#agendaHistoricoLista li').count(),0);
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[4].success({agendaId:'B',rows:[{timestamp:'hoje',email:'<img src=x onerror=alert(1)>',action:'Alteração',field:'Status',oldValue:'Agendado',newValue:'Confirmado'}],hasMore:false}));
      assert.equal(await page.locator('#agendaHistoricoLista img').count(),0);
      await page.evaluate(()=>window.abrirAgendaHistorico('VAZIO'));
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[5].success({agendaId:'VAZIO',rows:[],hasMore:false,nextBefore:null}));
      assert.equal(await page.locator('#agendaHistoricoMais').isVisible(),false);
      assert.match(await page.locator('#agendaHistoricoStatus').textContent(),/Nenhuma alteração registrada/);
      await page.evaluate(()=>window.abrirAgendaHistorico('C'));
      await page.getByRole('button',{name:'Fechar histórico'}).click();
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico')[6].success({agendaId:'C',rows:[{field:'Fechado'}],hasMore:false}));
      assert.equal(await page.locator('#agendaHistoricoLista li').count(),0);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close();}
});

test('criacao fica no inicio, preserva autor na paginacao e limpa estados em troca, erro e resposta antiga',async()=>{
  const browser=await loadPlaywright().chromium.launch({headless:true});
  try {
    for(const width of [1280,390]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=await agendaBrowserFixture(page);
      await page.addScriptTag({content:contentAccessibilitySource(['fecharModalSeClicouFora'])});
      await page.evaluate(()=>{
        document.getElementById('agendaCreatePanel').classList.remove('open');
        window.abrirAgendaHistorico('AG-123');
      });
      assert.equal(await page.title(),'Agenda — teste local');
      assert.equal(page.url(),'about:blank');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(),0);
      assert.match(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),/Consultando/);
      const backend=backendFixture(true);
      const data=backend(null);
      assert.equal(data.rows.some(r=>r.action==='Criação do agendamento'),false,'criacao fora da primeira pagina');
      await page.evaluate(d=>window.calls.find(c=>c.method==='getAgendaHistorico').success(d),data);
      assert.equal(await page.locator('#agendaHistoricoCriacaoDetalhes').innerText(),'Responsável: criador@exemplo.org');
      assert.match(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),/17\/10\/2026 09:20:00/);
      assert.equal(await page.locator('.agenda-history-creation').evaluate(el=>el.scrollWidth>el.clientWidth),false);
      const dir=process.env.PLAYWRIGHT_ARTIFACTS_DIR||path.join(os.tmpdir(),'ips-agenda-playwright');
      fs.mkdirSync(dir,{recursive:true});
      await page.screenshot({animations:'disabled',path:path.join(dir,'agenda-history-creation-'+width+'.png')});
      await page.getByRole('button',{name:'Ver mais alterações'}).click();
      await page.evaluate(d=>window.calls.filter(c=>c.method==='getAgendaHistorico').at(-1).success(d),backend(data.nextBefore));
      assert.equal(await page.locator('#agendaHistoricoCriacaoDetalhes').innerText(),'Responsável: criador@exemplo.org');
      await page.evaluate(()=>window.abrirAgendaHistorico('VAZIO'));
      assert.equal(await page.locator('#agendaHistoricoCriacaoDetalhes').innerText(),'');
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico').at(-1).failure(new Error('Falha simulada')));
      assert.match(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),/Não foi possível consultar/);
      assert.doesNotMatch(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),/Criação não registrada/);
      await page.getByRole('button',{name:'Tentar novamente'}).click();
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico').at(-1).success({agendaId:'VAZIO',creation:{found:false},rows:[],hasMore:false,nextBefore:null}));
      assert.equal(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),'Criação não registrada');
      await page.screenshot({animations:'disabled',path:path.join(dir,'agenda-history-missing-creation-'+width+'.png')});
      await page.evaluate(()=>{
        window.abrirAgendaHistorico('ANTIGO');
        window.abrirAgendaHistorico('ATUAL');
        const calls=window.calls.filter(c=>c.method==='getAgendaHistorico');
        calls.at(-2).success({agendaId:'ANTIGO',creation:{found:true,timestamp:'ONTEM',actorLabel:'AUTOR OBSOLETO'},rows:[],hasMore:false});
      });
      assert.match(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),/Consultando/);
      assert.equal(await page.locator('#agendaHistoricoCriacaoDetalhes').innerText(),'');
      await page.evaluate(()=>window.calls.filter(c=>c.method==='getAgendaHistorico').at(-1).success({agendaId:'ATUAL',creation:{found:true,timestamp:'<img src=x onerror=alert(1)>',actorLabel:'<img src=x onerror=alert(1)>'},rows:[],hasMore:false}));
      assert.equal(await page.locator('.agenda-history-creation img').count(),0);
      assert.match(await page.locator('#agendaHistoricoCriacaoDetalhes').innerText(),/<img/);
      await page.evaluate(()=>{
        window.abrirAgendaHistorico('LEGADO');
        window.calls.filter(c=>c.method==='getAgendaHistorico').at(-1).success({agendaId:'LEGADO',rows:[],hasMore:false});
      });
      assert.equal(await page.locator('#agendaHistoricoCriacaoStatus').innerText(),'Dados de criação não disponíveis nesta consulta.');
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close();}
});
