'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

function fixture(overrides = {}) {
  const app = new FakeSpreadsheet({ Participantes: new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto'],
    ['CAD-1', 'Nome nunca exposto', '', '', 'EST-014', 'Estudo A'],
    ['CAD-2', 'Outro estudo', '', '', 'EST-014', 'Estudo B']
  ]) });
  const state = {today:'2026-10-26',permission:'manage',uuid:0,restricted:true,location:true};
  const lock = fakeDocumentLock();
  const server = runFiles(['FarmaciaEstoque.gs','FarmaciaLocais.gs','FarmaciaCatalogActions.gs','FarmaciaCiclo.gs'], {
    FARMACIA_COMMON_SCOPE_:'@IPS_COMMON',
    Utilities:{getUuid:()=>String(++state.uuid)},
    getCodexSpreadsheet_:()=>app,
    codexFarmaciaStudyCatalog_:()=>[{id:'P1',nome:'Estudo A'},{id:'P2',nome:'Estudo B'}],
    codexAssertFarmaciaAccess_:(permission,studyId,restricted)=>{
      // Hierarquia real dos níveis: um nível só concede o que está igual ou abaixo dele.
      const levels=['none','read','operate','manage'];
      if (studyId!=='P1'||(restricted&&!state.restricted)||levels.indexOf(state.permission)<Math.max(1,levels.indexOf(permission))) throw new Error('Sem permissão');
      return {userEmail:'farm@example.invalid',farmaciaAccess:state.permission,role:'user',farmaciaStudy:{id:'P1',nome:'Estudo A'}};
    },
    codexAssertFarmaciaCommonAccess_:()=>{throw new Error('Sem permissão');},
    codexWithDocumentLock_:(name,fn)=>{const held=lock.LockService.getDocumentLock();if(!held.tryLock())throw new Error('Lock indisponível');try{return fn();}finally{held.releaseLock();}}
  });
  server.farmaciaToday_=()=>state.today;
  server.farmaciaRegisteredDay_=()=>state.today;
  server.farmaciaReadLocations_=()=>({configured:true,units:state.location?[{id:'UNIT-1',code:'IPS AF-01',positions:['Gaveta 1','Quarentena'],min:15,max:25,status:'active'}]:[]});
  const scope = {studyId:'P1',restricted:false};
  const product=server.cadastrarProdutoFarmacia({...scope,requestId:'product-request-0001',data:{category:'medicine',name:'Produto A',presentation:'Comprimidos',unit:'comprimido',control:'quantity',supplySource:'sponsor',storage:{min:15,max:25,instructions:''},...overrides}}).id;
  const position=server.registrarInventarioInicialFarmacia({...scope,requestId:'initial-request-0001',data:{productId:product,lot:'L1',expiry:'2027-08-31',location:'Catálogo',locationRef:{unitId:'UNIT-1',position:'Gaveta 1'},kit:overrides.control==='kit'?'KIT-1':'',physical:overrides.control==='kit'?1:140,blocked:0,countedOn:'2026-10-12',confirmed:true,note:''}}).id;
  const movement=(data,requestId='movement-request-'+(++state.uuid))=>server.registrarMovimentacaoFarmacia({...scope,requestId,data:{positionId:position,revision:stock().positions[0].revision,action:'release',from:'pending',quantity:overrides.control==='kit'?1:140,reason:'Conferência',document:'CONF-1',...data}});
  const stock=()=>server.getFarmaciaEstoque('P1',false);
  movement();
  const payload=(data,requestId='lifecycle-request-'+(++state.uuid))=>({...scope,requestId,data:{action:'dispense',positionId:position,revision:stock().positions[0].revision,occurredOn:'2026-10-26',document:'DOC-1',reason:'',quantity:30,participantId:'CAD-1',visit:'C1D1',prescription:'PRESC-1',platformReference:'IRT-'+state.uuid,validThrough:'2026-11-05',confirmed:true,...data}});
  const write=(data,requestId)=>server.registrarCicloFarmacia(payload(data,requestId));
  const sheet=()=>app.getSheetByName(server.farmaciaLedgerSheetName_('P1'));
  return {server,app,state,lock:lock.state,product,position,payload,write,stock,sheet,movement};
}

test('dispensação baixa apenas disponível, valida participante e preserva replay/idempotência',()=>{
  const f=fixture(),p=f.payload({platformReference:'IRT-unique'}),id=f.server.registrarCicloFarmacia(p).id;
  assert.equal(f.stock().positions[0].physical,110);assert.equal(f.stock().positions[0].available,110);
  f.write({quantity:5,platformReference:'IRT-second'});
  const writes=f.sheet().writes;
  assert.equal(f.server.registrarCicloFarmacia(p).id,id);assert.equal(f.server.registrarCicloFarmacia(p).repeated,true);
  assert.equal(f.sheet().writes,writes);
  assert.throws(()=>f.server.registrarCicloFarmacia({...p,data:{...p.data,quantity:31}}),/outros dados/);
  assert.throws(()=>f.write({participantId:'CAD-2'}),/Participante/);
  assert.throws(()=>f.write({platformReference:'IRT-unique'}),/já foi registrada/);
  const participants=f.server.getFarmaciaParticipantes('P1',false).participants;
  assert.equal(participants.length,1);assert.equal(participants[0].id,'CAD-1');assert.equal(participants[0].label,'EST-014');
  assert.doesNotMatch(JSON.stringify(participants),/Nome nunca/);
});

test('retorno exige confirmação da contagem antes de gravar',()=>{
  const f=fixture(),dispenseId=f.write({quantity:30}).id,writes=f.sheet().writes;
  assert.throws(()=>f.write({action:'return',dispenseId,quantity:5,confirmed:false,locationRef:{unitId:'UNIT-1',position:'Quarentena'}}),/Confirme a contagem/);
  assert.equal(f.sheet().writes,writes);
});

test('referência da plataforma pode conter itens distintos sem permitir duplicação do mesmo item',()=>{
  const f=fixture();f.write({quantity:1,platformReference:'IRT-BATCH'});
  const second=f.server.registrarInventarioInicialFarmacia({studyId:'P1',restricted:false,requestId:'second-initial-request',data:{productId:f.product,lot:'L2',expiry:'2027-08-31',location:'Catálogo',locationRef:{unitId:'UNIT-1',position:'Gaveta 1'},kit:'',physical:20,blocked:0,countedOn:'2026-10-12',confirmed:true,note:''}}).id;
  f.movement({positionId:second,revision:second,quantity:20});
  const revision=f.stock().positions.find(p=>p.id===second).revision;
  f.write({positionId:second,revision,quantity:1,platformReference:'IRT-BATCH'});
  assert.throws(()=>f.write({quantity:1,platformReference:'IRT-BATCH'}),/já foi registrada/);
  assert.equal(f.stock().movements.filter(r=>r.type==='LIFECYCLE'&&r.data.action==='dispense').length,2);
});

test('acesso fresco sob lock, revisão e estudo/classe cruzados impedem escrita',()=>{
  const f=fixture(),p=f.payload({});const writes=f.sheet().writes;
  f.state.permission='read';assert.throws(()=>f.server.registrarCicloFarmacia(p),/permissão/);assert.equal(f.sheet().writes,writes);
  f.state.permission='manage';assert.throws(()=>f.server.registrarCicloFarmacia({...p,studyId:'P2'}),/permissão/);
  assert.throws(()=>f.server.registrarCicloFarmacia({...p,restricted:true}),/identificado|não encontrada/);
  f.write({quantity:1});assert.throws(()=>f.server.registrarCicloFarmacia(p),/saldo mudou/);
  assert.equal(f.lock.acquired,f.lock.released);
});

test('quantidade, validade, data futura e unidade discreta são validadas antes da primeira escrita',()=>{
  const f=fixture(),writes=f.sheet().writes;
  for(const data of [{quantity:141},{quantity:0},{quantity:1.5},{occurredOn:'2026-10-27'},{validThrough:'2028-01-01'},{confirmed:false},{validThrough:'2026-10-01'}])assert.throws(()=>f.write(data));
  assert.equal(f.sheet().writes,writes);
  f.state.today='2028-01-01';assert.throws(()=>f.write({occurredOn:'2026-10-26'}),/vencido/);
});

test('retorno cumulativo cria posição segregada sem aumentar disponível nem permitir liberação',()=>{
  const f=fixture(),dispenseId=f.write({}).id;
  const p=f.payload({action:'return',dispenseId,quantity:10,locationRef:{unitId:'UNIT-1',position:'Quarentena'}});
  const returned=f.server.registrarCicloFarmacia(p).id;
  let positions=f.stock().positions;
  assert.equal(positions.length,2);assert.equal(positions[0].physical,110);assert.equal(positions[1].physical,10);assert.equal(positions[1].blocked,10);assert.equal(positions[1].available,0);
  assert.equal(positions[1].origin,'return');assert.equal(positions[1].originalPositionId,f.position);
  assert.equal(positions[1].location,'IPS AF-01 → Quarentena');
  assert.equal(f.server.registrarCicloFarmacia(p).repeated,true);
  assert.throws(()=>f.movement({positionId:returned,revision:returned,from:'blocked',quantity:10}),/retornados/);
  f.write({action:'return',dispenseId,quantity:20,locationRef:{unitId:'UNIT-1',position:'Quarentena'}});
  assert.throws(()=>f.write({action:'return',dispenseId,quantity:1,locationRef:{unitId:'UNIT-1',position:'Quarentena'}}),/acumulada/);
  positions=f.stock().positions;assert.equal(positions.reduce((sum,p)=>sum+p.physical,0),140);assert.equal(positions.reduce((sum,p)=>sum+p.available,0),110);
});

test('retorno exige posição cadastrada e protege vínculo da dispensação de outro escopo',()=>{
  const f=fixture(),dispenseId=f.write({}).id,writes=f.sheet().writes;
  assert.throws(()=>f.write({action:'return',dispenseId,quantity:10,locationRef:{unitId:'UNIT-1',position:'Não cadastrado'}}),/cadastrados/);
  assert.throws(()=>f.write({action:'return',dispenseId:'FLC-outro',quantity:10,locationRef:{unitId:'UNIT-1',position:'Quarentena'}}),/não encontrada/);
  assert.equal(f.sheet().writes,writes);
});

test('adesão usa período inclusivo, mantém acima de 100% e rejeita datas incompatíveis',()=>{
  const f=fixture(),dispenseId=f.write({occurredOn:'2026-10-15'}).id;
  const adherence={dailyDose:2,firstDose:'2026-10-15',lastDose:'2026-10-24',confirmedFixedDose:true};
  f.write({action:'return',dispenseId,quantity:5,locationRef:{unitId:'UNIT-1',position:'Quarentena'},adherence});
  const event=f.stock().movements.at(-1);assert.equal(event.adherenceResult.days,10);assert.equal(event.adherenceResult.percent,125);
  assert.throws(()=>f.write({action:'return',dispenseId,quantity:5,locationRef:{unitId:'UNIT-1',position:'Quarentena'},adherence:{...adherence,confirmedFixedDose:false}}),/dose diária fixa/);
  assert.throws(()=>f.write({action:'return',dispenseId,quantity:5,locationRef:{unitId:'UNIT-1',position:'Quarentena'},adherence:{...adherence,lastDose:'2026-10-27'}}),/período compatível/);
});

function departure(f,extra={}) {return f.write({action:'transport_departure',quantity:20,departureTime:'10:00',origin:'Farmácia',destination:'Outro local',locationRef:{unitId:'UNIT-1',position:'Quarentena'},operation:'storage',thermometer:'TERM-1',min:15,max:25,departureTemperature:21,...extra});}
function arrival(f,departureId,extra={}) {return f.write({action:'transport_arrival',departureId,arrivalTime:'10:30',currentTemperature:22,minTemperature:20,maxTemperature:23,...extra});}

test('transporte reserva saldo sem alterar físico; chegada idempotente libera reserva',()=>{
  const f=fixture(),id=departure(f).id;
  let position=f.stock().positions[0];assert.equal(position.physical,140);assert.equal(position.available,120);assert.equal(position.inTransit,20);
  assert.throws(()=>f.write({quantity:121}),/Saldo insuficiente/);
  assert.throws(()=>f.movement({action:'block',from:'available',quantity:1}),/transporte/);
  const p=f.payload({action:'transport_arrival',departureId:id,arrivalTime:'10:30',currentTemperature:22,minTemperature:20,maxTemperature:23});
  f.server.registrarCicloFarmacia(p);assert.equal(f.server.registrarCicloFarmacia(p).repeated,true);
  const positions=f.stock().positions;position=positions[0];assert.equal(position.physical,120);assert.equal(position.available,120);assert.equal(position.inTransit,0);
  assert.equal(positions[1].origin,'transport');assert.equal(positions[1].location,'IPS AF-01 → Quarentena');assert.equal(positions[1].physical,20);assert.equal(positions[1].available,20);
  assert.equal(positions.reduce((sum,p)=>sum+p.physical,0),140);
  assert.throws(()=>arrival(f,id),/registro de saída/);
});

test('excursão na chegada bloqueia somente o estoque transportado e mantém contabilidade',()=>{
  const f=fixture(),id=departure(f).id;
  arrival(f,id,{maxTemperature:28});
  const stock=f.stock(),position=stock.positions[0],destination=stock.positions[1];assert.equal(position.physical,120);assert.equal(position.available,120);assert.equal(destination.blocked,20);assert.equal(stock.movements.at(-1).excursion,true);
  f.movement({positionId:destination.id,revision:destination.revision,action:'release',from:'blocked',quantity:20});assert.equal(f.stock().positions[1].available,20);
});

test('transporte vinculado à dispensação registra excursão sem baixar ou bloquear estoque já separado',()=>{
  const f=fixture(),dispenseId=f.write({}).id;
  const id=departure(f,{operation:'administration',dispenseId,quantity:30}).id;
  arrival(f,id,{maxTemperature:28});const position=f.stock().positions[0];
  assert.equal(position.physical,110);assert.equal(position.available,110);assert.equal(position.blocked,0);assert.equal(f.stock().movements.at(-1).excursion,true);
});

test('excursão informada na saída de medicamento dispensado permanece sinalizada após chegada normal',()=>{
  const f=fixture(),dispenseId=f.write({}).id;
  const id=departure(f,{operation:'administration',dispenseId,quantity:30,departureTemperature:27}).id;
  assert.equal(f.stock().movements.at(-1).excursion,true);
  arrival(f,id,{currentTemperature:21,minTemperature:20,maxTemperature:22});
  assert.equal(f.stock().movements.at(-1).excursion,true);
  assert.equal(f.stock().positions[0].physical,110);
});

test('temperaturas, ordem cronológica e faixa documentada não são inferidas do cliente',()=>{
  const f=fixture(),writes=f.sheet().writes;
  assert.throws(()=>departure(f,{min:2,max:8}),/condições documentadas/);
  assert.throws(()=>departure(f,{departureTemperature:30}),/fora da faixa/);
  assert.equal(f.sheet().writes,writes);
  const id=departure(f).id;
  assert.throws(()=>arrival(f,id,{arrivalTime:'09:00'}),/horário de chegada/);
  assert.throws(()=>arrival(f,id,{minTemperature:24,maxTemperature:20}),/temperaturas/);
});

test('destinação só baixa saldo segregado com motivo e autorização; vencimento preserva replay',()=>{
  const f=fixture();
  assert.throws(()=>f.write({action:'destination',quantity:5,from:'blocked',destination:'sponsor',authorization:'AUT-1',reason:'Devolução'}),/saldo segregado/);
  f.movement({action:'block',from:'available',quantity:20});
  f.write({action:'destination',quantity:5,from:'blocked',destination:'sponsor',authorization:'AUT-1',reason:'Devolução'});
  let p=f.stock().positions[0];assert.equal(p.physical,135);assert.equal(p.available,120);assert.equal(p.blocked,15);
  f.state.today='2028-01-01';
  f.write({action:'destination',occurredOn:'2028-01-01',quantity:135,from:'blocked',destination:'disposal',authorization:'AUT-2',reason:'Descarte documentado'});
  p=f.stock().positions[0];assert.equal(p.physical,0);assert.equal(p.blocked,0);assert.equal(p.available,0);
});

test('destinação de material vencido com data até a validade usa o saldo apresentado como bloqueado',()=>{
  const f=fixture();
  f.state.today='2028-01-01';
  const shown=f.stock().positions[0];assert.equal(shown.expired,true);assert.equal(shown.blocked,140);
  // Antes: "excede o saldo segregado", pois o bucket real de bloqueio era 0.
  f.write({action:'destination',occurredOn:'2027-08-31',quantity:100,from:'blocked',destination:'disposal',authorization:'AUT-1',reason:'Descarte documentado'});
  let p=f.stock().positions[0];assert.equal(p.physical,40);assert.equal(p.blocked,40);
  assert.throws(()=>f.write({action:'destination',occurredOn:'2027-08-31',quantity:41,from:'blocked',destination:'disposal',authorization:'AUT-2',reason:'x'}),/vencido deve sair/);
  // Bloqueio de material vencido recebe mensagem própria (não fala em "liberar").
  assert.throws(()=>f.movement({action:'block',from:'available',quantity:1}),/já está integralmente bloqueado/);
  assert.throws(()=>f.movement({action:'release',from:'blocked',quantity:1}),/não pode ser liberado/);
});

test('identificador numérico é recusado antes de gravar (o Sheets o converteria em número e inutilizaria o replay)',()=>{
  const f=fixture();const writes=f.sheet().writes;
  assert.throws(()=>f.write({},'123456789012'),/Identificador da operação inválido/);
  assert.throws(()=>f.write({},'1e12345678901'),/Identificador da operação inválido/);
  assert.equal(f.sheet().writes,writes);
  f.write({},'a23456789012');
  assert.equal(f.stock().movements.length>0,true);
});

test('equipamento em manutenção ou indisponível não recebe retorno nem transporte para armazenamento',()=>{
  const f=fixture();const writes=f.sheet().writes;
  ['maintenance','unavailable'].forEach(status=>{
    f.server.farmaciaReadLocations_=()=>({configured:true,units:[{id:'UNIT-1',code:'IPS AF-01',positions:['Gaveta 1','Quarentena'],min:15,max:25,status}]});
    assert.throws(()=>departure(f),/manutenção ou indisponível/);
  });
  assert.equal(f.sheet().writes,writes);
  f.server.farmaciaReadLocations_=()=>({configured:true,units:[{id:'UNIT-1',code:'IPS AF-01',positions:['Gaveta 1','Quarentena'],min:15,max:25,status:'active'}]});
  departure(f);
});

test('transporte para armazenamento não exige origem e destino do cliente; os demais continuam exigindo',()=>{
  const f=fixture();
  f.write({action:'transport_departure',quantity:5,departureTime:'10:00',operation:'storage',locationRef:{unitId:'UNIT-1',position:'Quarentena'},thermometer:'TERM-1',min:15,max:25,departureTemperature:21});
  const event=f.stock().movements.at(-1);assert.equal(event.data.origin,'IPS AF-01 → Gaveta 1');assert.equal(event.data.destination,'IPS AF-01 → Quarentena');
  assert.throws(()=>f.write({action:'transport_departure',quantity:5,departureTime:'10:00',operation:'preparation',thermometer:'TERM-1',min:15,max:25,departureTemperature:21}),/origem/);
});

test('correção/exclusão de inventário com ciclo preserva os registros originais',()=>{
  const f=fixture();f.write({quantity:5});const p=f.stock().positions[0];
  assert.throws(()=>f.server.alterarRegistroFarmacia({studyId:'P1',restricted:false,type:'INITIAL_DELETE',requestId:'delete-request-0001',data:{entityId:p.id,revision:p.revision,reason:'Excluir'}}),/preservam seu histórico/);
  assert.throws(()=>f.server.alterarRegistroFarmacia({studyId:'P1',restricted:false,type:'INITIAL_EDIT',requestId:'edit-request-0001',data:{entityId:p.id,revision:p.revision,reason:'Corrigir',data:{lot:'L2',expiry:'2027-08-31',note:''}}}),/preservam seu histórico/);
});

test('kits individualizados saem e retornam uma única unidade preservando o vínculo',()=>{
  const f=fixture({control:'kit',unit:'kit'});assert.throws(()=>f.write({quantity:2}),/quantidade 1/);
  const dispenseId=f.write({quantity:1}).id;assert.throws(()=>f.write({quantity:1}),/Saldo insuficiente/);
  f.write({action:'return',dispenseId,quantity:1,locationRef:{unitId:'UNIT-1',position:'Quarentena'}});
  assert.equal(f.stock().positions[1].kit,'KIT-1');assert.equal(f.stock().positions[1].blocked,1);
});

test('vínculo ambíguo ou cadastro duplicado não autoriza dispensação',()=>{
  const f=fixture();f.app.getSheetByName('Participantes').rows.push(['CAD-1','Duplicado','','','OUTRO','Estudo A']);
  assert.equal(f.server.getFarmaciaParticipantes('P1',false).participants.length,0);
  assert.throws(()=>f.write({}),/Participante não encontrado/);
});

test('revogação ao adquirir lock é revalidada antes de ler/gravar ciclo',()=>{
  const f=fixture(),p=f.payload({}),writes=f.sheet().writes;
  f.lock.onAcquire=()=>{f.state.permission='read';};
  assert.throws(()=>f.server.registrarCicloFarmacia(p),/permissão/);
  assert.equal(f.sheet().writes,writes);assert.equal(f.lock.held,false);
});

test('vencimento durante transporte mantém partição física sem duplicar saldo em trânsito',()=>{
  const f=fixture();departure(f);f.state.today='2028-01-01';
  const p=f.stock().positions[0];assert.equal(p.available,0);assert.equal(p.blocked,120);assert.equal(p.inTransit,20);
  assert.equal(p.available+p.pending+p.blocked+p.inTransit,p.physical);
});

test('mesma quantidade dispensada não pode estar em dois transportes nem retornar durante trânsito',()=>{
  const f=fixture(),dispenseId=f.write({quantity:30}).id;
  const id=departure(f,{operation:'administration',dispenseId,quantity:30}).id;
  assert.throws(()=>departure(f,{operation:'administration',dispenseId,quantity:1}),/ainda não retornada/);
  assert.throws(()=>f.write({action:'return',dispenseId,quantity:1,locationRef:{unitId:'UNIT-1',position:'Quarentena'}}),/transporte da dispensação/);
  arrival(f,id);
  f.write({action:'return',dispenseId,quantity:30,locationRef:{unitId:'UNIT-1',position:'Quarentena'}});
  assert.throws(()=>departure(f,{operation:'administration',dispenseId,quantity:1}),/ainda não retornada/);
});

test('transporte de kit mantém uma única unidade física no destino e repete saída sem duplicar reserva',()=>{
  const f=fixture({control:'kit',unit:'kit'}),p=f.payload({action:'transport_departure',quantity:1,departureTime:'10:00',origin:'Rótulo do cliente',destination:'Outro rótulo',locationRef:{unitId:'UNIT-1',position:'Quarentena'},operation:'storage',thermometer:'TERM-1',min:15,max:25,departureTemperature:21});
  const id=f.server.registrarCicloFarmacia(p).id;assert.equal(f.server.registrarCicloFarmacia(p).repeated,true);
  const event=f.stock().movements.at(-1);assert.equal(event.data.origin,'IPS AF-01 → Gaveta 1');assert.equal(event.data.destination,'IPS AF-01 → Quarentena');
  arrival(f,id);const positions=f.stock().positions;
  assert.equal(positions[0].physical,0);assert.equal(positions[1].physical,1);assert.equal(positions[1].kit,'KIT-1');
  assert.equal(positions.filter(item=>item.kit==='KIT-1'&&item.physical>0).length,1);
});

test('código de participante acima do limite do ledger é recusado antes de gravar e não inutiliza o estoque',()=>{
  const f=fixture();
  f.app.getSheetByName('Participantes').rows[1][4]='P'.repeat(121);
  const writes=f.sheet().writes;
  assert.throws(()=>f.write({}),/código do participante no cadastro excede 120 caracteres/);
  assert.equal(f.sheet().writes,writes);
  assert.equal(f.stock().positions[0].physical,140);
});

test('rótulo derivado que o replay recusaria não é gravado no ledger do estudo',()=>{
  const f=fixture(),dispenseId=f.write({}).id;
  // Catálogo simulado fora dos limites do cadastro real: o rótulo derivado excede o aceito pelo replay.
  f.server.farmaciaReadLocations_=()=>({configured:true,units:[{id:'UNIT-1',code:'X'.repeat(190),positions:['Gaveta 1','Quarentena'],min:15,max:25,status:'active'}]});
  const writes=f.sheet().writes;
  // Retorno: rótulo derivado depois da normalização, protegido pelo replay antes da gravação.
  assert.throws(()=>f.write({action:'return',dispenseId,quantity:5,locationRef:{unitId:'UNIT-1',position:'Quarentena'}}),/Nenhum dado foi gravado/);
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia({studyId:'P1',restricted:false,requestId:'initial-request-long',data:{productId:f.product,lot:'L2',expiry:'2027-08-31',location:'x',locationRef:{unitId:'UNIT-1',position:'Gaveta 1'},kit:'',physical:10,blocked:0,countedOn:'2026-10-12',confirmed:true,note:''}}),/localização válido/);
  assert.equal(f.sheet().writes,writes);
  assert.equal(f.stock().positions[0].physical,110);
});

test('nível Operação registra dispensação, retorno e transporte, mas não destinação final nem liberação',()=>{
  const f=fixture();f.state.permission='operate';
  const dispenseId=f.write({quantity:30}).id;
  f.write({action:'return',dispenseId,quantity:5,locationRef:{unitId:'UNIT-1',position:'Quarentena'}});
  arrival(f,departure(f).id);
  const writes=f.sheet().writes;
  assert.throws(()=>f.write({action:'destination',quantity:5,from:'blocked',destination:'sponsor',authorization:'AUT-1',reason:'Devolução'}),/permissão/);
  assert.throws(()=>f.write({action:'inexistente'}),/permissão/);
  assert.throws(()=>f.movement({action:'block',from:'available',quantity:1}),/permissão/);
  assert.equal(f.sheet().writes,writes);
  f.state.permission='read';
  assert.throws(()=>f.write({quantity:1}),/permissão/);
  assert.equal(f.lock.acquired,f.lock.released);
});

test('retorno não depende da revisão da origem, mas continua protegido pela dispensação e pelo acumulado',()=>{
  const f=fixture(),dispenseId=f.write({quantity:30}).id,stale=f.stock().positions[0].revision;
  f.write({quantity:5,platformReference:'IRT-depois'});
  assert.notEqual(f.stock().positions[0].revision,stale);
  const location={unitId:'UNIT-1',position:'Quarentena'};
  const returned=f.payload({action:'return',dispenseId,quantity:10,locationRef:location});returned.data.revision=stale;
  f.server.registrarCicloFarmacia(returned);
  assert.equal(f.stock().positions.at(-1).origin,'return');
  const excess=f.payload({action:'return',dispenseId,quantity:21,locationRef:location});excess.data.revision=stale;
  assert.throws(()=>f.server.registrarCicloFarmacia(excess),/acumulada/);
  const dispense=f.payload({quantity:1,platformReference:'IRT-nova'});dispense.data.revision=stale;
  assert.throws(()=>f.server.registrarCicloFarmacia(dispense),/saldo mudou/);
  assert.equal(f.stock().positions[0].physical,105);
});

test('retorno e chegada aceitam data anterior à última operação com motivo; demais operações permanecem cronológicas',()=>{
  const f=fixture(),location={unitId:'UNIT-1',position:'Quarentena'};
  const dispenseId=f.write({occurredOn:'2026-10-14',quantity:30}).id;
  const departureId=departure(f,{occurredOn:'2026-10-16'}).id;
  f.write({occurredOn:'2026-10-20',quantity:5,platformReference:'IRT-b'});
  const writes=f.sheet().writes;
  const late={action:'return',dispenseId,quantity:10,occurredOn:'2026-10-17',locationRef:location};
  assert.throws(()=>f.write(late),/retroativo/);
  assert.throws(()=>arrival(f,departureId,{occurredOn:'2026-10-17'}),/retroativo/);
  assert.equal(f.sheet().writes,writes);
  f.write({...late,reason:'Retorno trazido pelo participante em 17/10 e lançado depois'});
  assert.equal(f.stock().movements.at(-1).retroactive,true);
  arrival(f,departureId,{occurredOn:'2026-10-17',reason:'Chegada conferida em 17/10 e lançada depois'});
  assert.equal(f.stock().movements.at(-1).retroactive,true);
  // Dispensação e saída não reduzem o disponível retroativamente: seguem em ordem.
  assert.throws(()=>f.write({occurredOn:'2026-10-18',quantity:1,platformReference:'IRT-c',reason:'x'}),/anteceder a última/);
  assert.throws(()=>departure(f,{occurredOn:'2026-10-18',reason:'x'}),/anteceder a última/);
  assert.throws(()=>f.write({...late,occurredOn:'2026-10-13',reason:'x'}),/dispensação e a data/);
  // Sem antecedência não há sinalização; o histórico continua legível ao reexecutar o ledger.
  f.write({action:'return',dispenseId,quantity:1,occurredOn:'2026-10-21',locationRef:location});
  assert.equal(f.stock().movements.at(-1).retroactive,undefined);
  // 140 iniciais − 35 dispensados + 11 retornados; a transferência por transporte não altera o físico.
  assert.equal(f.stock().positions.reduce((sum,p)=>sum+p.physical,0),116);
});
