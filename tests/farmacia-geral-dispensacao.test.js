'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const COMMON = '@IPS_COMMON';

// Estoque Geral (Farmácia): dispensação a participantes de qualquer estudo e retorno simples ao estoque.
function fixture() {
  const app = new FakeSpreadsheet({ Participantes: new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto'],
    ['CAD-1', 'Nome nunca exposto', '', '', 'EST-014', 'Estudo A'],
    ['CAD-2', 'Outro nome', '', '', 'B-201', 'Estudo B'],
    ['CAD-3', 'Sem estudo', '', '', 'X-9', 'Projeto inexistente']
  ]) });
  const state = {today:'2026-11-26', permission:'operate', uuid:0};
  const levels = ['none','read','operate','manage'];
  const server = runFiles(['FarmaciaEstoque.gs','FarmaciaLocais.gs','FarmaciaCatalogActions.gs','FarmaciaAjustes.gs','FarmaciaCiclo.gs'], {
    FARMACIA_COMMON_SCOPE_:COMMON,
    Utilities:{getUuid:()=>String(++state.uuid)},
    getCodexSpreadsheet_:()=>app,
    codexFarmaciaStudyCatalog_:()=>[{id:'P1',nome:'Estudo A',codigo:'A-001'},{id:'P2',nome:'Estudo B',codigo:'B-002'}],
    codexAssertFarmaciaAccess_:()=>{throw new Error('Sem permissão');},
    codexAssertFarmaciaCommonAccess_:(permission)=>{
      if (levels.indexOf(state.permission)<Math.max(1,levels.indexOf(permission))) throw new Error('Seu usuário não tem permissão para esta ação no estoque comum da Farmácia.');
      return {userEmail:'farm@example.invalid',farmaciaAccess:state.permission,role:'user',farmaciaStudy:{id:COMMON,nome:'Geral (Farmácia)'}};
    },
    codexWithDocumentLock_:(name,fn)=>fn()
  });
  server.farmaciaToday_=()=>state.today;
  server.farmaciaRegisteredDay_=()=>state.today;
  server.farmaciaReadLocations_=()=>({configured:true,units:[{id:'U1',code:'Armário',positions:['A','Quarentena'],status:'active'}]});
  const scope = {studyId:COMMON,restricted:false};
  state.permission='manage';
  const product=server.cadastrarProdutoFarmacia({...scope,requestId:'product-request-0001',data:{category:'medicine',name:'Dipirona',presentation:'500 mg',unit:'comprimido',control:'quantity',supplySource:'site',storage:{min:15,max:30,instructions:''}}}).id;
  const position=server.registrarRecebimentoFarmacia({...scope,requestId:'receipt-request-0001',data:{productId:product,lot:'L1',expiry:'2027-08-31',locationRef:{unitId:'U1',position:'A'},kit:'',physical:100,receivedOn:'2026-11-20',document:'NF-1 item 1',location:'Catálogo',note:''}});
  state.permission='operate';
  const stock=()=>server.getFarmaciaEstoque(COMMON,false);
  const guide=(data={},items,requestId='guide-request-'+String(++state.uuid).padStart(4,'0'))=>server.registrarDispensacaoFarmacia({...scope,requestId,
    data:{occurredOn:'2026-11-26',participantId:'CAD-2',participantStudyId:'P2',visit:'',prescription:'',platformReference:'',validThrough:'',document:'',reason:'',confirmed:true,...data},
    items:items||[{positionId:position.id,revision:stock().positions[0].revision,quantity:10}]});
  return {server,state,product,position,stock,guide,scope};
}

test('Geral lista participantes de todos os estudos, só com código e estudo, e exige Operação',()=>{
  const f=fixture();
  const list=f.server.getFarmaciaParticipantes(COMMON,false).participants;
  assert.deepEqual(JSON.parse(JSON.stringify(list.map(p=>[p.id,p.label,p.studyId,p.studyLabel]))),[['CAD-1','EST-014','P1','Estudo A'],['CAD-2','B-201','P2','Estudo B']]);
  assert.doesNotMatch(JSON.stringify(list),/nome/i);
  f.state.permission='read';
  assert.throws(()=>f.server.getFarmaciaParticipantes(COMMON,false),/permissão/);
});

test('dispensação do Geral baixa o disponível, grava o estudo do participante e é idempotente',()=>{
  const f=fixture();
  const first=f.guide({},undefined,'guide-request-fixed');
  assert.equal(f.stock().positions[0].available,90);
  const record=f.stock().movements.find(r=>r.id===first.ids[0]);
  assert.equal(record.data.participantLabel,'B-201');
  assert.equal(record.data.participantStudyId,'P2');
  assert.equal(record.data.participantStudyLabel,'Estudo B');
  assert.equal(record.data.validThrough,'');
  const again=f.server.registrarDispensacaoFarmacia({...f.scope,requestId:'guide-request-fixed',data:{occurredOn:'2026-11-26',participantId:'CAD-2',participantStudyId:'P2',visit:'',prescription:'',platformReference:'',validThrough:'',document:'',reason:'',confirmed:true},items:[{positionId:f.position.id,revision:f.position.id,quantity:10}]});
  assert.equal(again.repeated,true);
  assert.equal(f.stock().positions[0].available,90);
});

test('dispensação do Geral confere o estudo do participante e não aceita leitura',()=>{
  const f=fixture();
  assert.throws(()=>f.guide({participantStudyId:'P1'}),/não pertence ao estudo/);
  assert.throws(()=>f.guide({participantStudyId:''}),/estudo do participante/);
  assert.throws(()=>f.guide({participantId:'CAD-3',participantStudyId:'P1'}),/Participante não encontrado/);
  assert.throws(()=>f.guide({validThrough:'2026-11-20'}),/período previsto/);
  f.state.permission='read';
  assert.throws(()=>f.guide(),/permissão/);
  assert.equal(f.stock().positions[0].available,100);
});

test('retorno no Geral devolve a sobra ao estoque ou segrega; transporte e destinação continuam recusados',()=>{
  const f=fixture();
  const dispenseId=f.guide().ids[0];
  const back=(data,requestId)=>f.server.registrarCicloFarmacia({...f.scope,requestId,data:{action:'return',positionId:f.position.id,revision:f.stock().positions[0].revision,dispenseId,occurredOn:'2026-11-26',document:'Contagem da sobra',reason:'',confirmed:true,...data}});
  back({quantity:3,returnTo:'stock'},'return-request-0001');
  assert.equal(f.stock().positions[0].available,93);
  back({quantity:2,locationRef:{unitId:'U1',position:'Quarentena'}},'return-request-0002');
  const segregated=f.stock().positions.find(p=>p.returned);
  assert.equal(segregated.blocked,2);
  assert.throws(()=>back({quantity:6,returnTo:'stock'},'return-request-0003'),/excede/);
  assert.throws(()=>f.server.registrarCicloFarmacia({...f.scope,requestId:'transport-request-0001',data:{action:'transport_departure',positionId:f.position.id,revision:f.stock().positions[0].revision,occurredOn:'2026-11-26',quantity:1,departureTime:'10:00',operation:'preparation',origin:'A',destination:'B',thermometer:'T1',min:15,max:30,departureTemperature:20,document:'',reason:''}}),/estudo configurado/);
});
