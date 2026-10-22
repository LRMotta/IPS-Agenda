'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

const STANDARD = 'farmacia-standard-0000000001', RESTRICTED = 'farmacia-restricted-00000001', MAIN = 'principal-00000000000000001';
function fixture(realLocations = false) {
  const users = new FakeSheet('Users', [
    ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário (MM-DD)', 'Formação', 'Registro no Conselho Profissional', 'Pode solicitar exames', 'Acesso à Farmácia', 'Estudos da Farmácia (JSON)'],
    ['farm@example.invalid', 'Farmácia', 'readonly', 'Sim', '', '', '', 'Sim', 'manage', '[{"studyId":"P1","restricted":true}]']
  ]);
  const app = new FakeSpreadsheet({ Users:users, Projetos:new FakeSheet('Projetos', [['ID', 'Nome', 'Código'], ['P1', 'Estudo A', 'A'], ['P2', 'Estudo B', 'B']]) });
  app.getId = () => MAIN;
  const stores = { [STANDARD]:new FakeSpreadsheet({}), [RESTRICTED]:new FakeSpreadsheet({}) };
  const lock = fakeDocumentLock();
  const state = { config:JSON.stringify({ version:1, studies:[{ studyId:'P1', standard:STANDARD, restricted:RESTRICTED }] }), opened:[], today:'2026-10-21', uuid:0 };
  const server = runFiles(['WebApp.gs', 'FarmaciaEstoque.gs', 'FarmaciaLocais.gs', 'FarmaciaLocationActions.gs'], {
    LockService:lock.LockService,
    PropertiesService:{ getScriptProperties:() => ({ getProperty:() => state.config }) },
    SpreadsheetApp:{ openById:id => { state.opened.push(id); if (!stores[id]) throw new Error('Arquivo desconhecido'); return stores[id]; } },
    Utilities:{ getUuid:() => 'uuid-' + (++state.uuid) }
  });
  server.getCodexSpreadsheet_ = () => app;
  server.codexGetActiveUserEmail_ = () => 'farm@example.invalid';
  server.codexWriteAuditLog_ = () => {};
  server.farmaciaToday_ = () => state.today;
  if (!realLocations) server.farmaciaReadLocations_ = () => ({ configured:true, units:[{id:'UNIT-1',code:'Armário 1',positions:['Prateleira 1'],min:null,max:null,status:'active'}] });
  const product = (overrides = {}) => ({ studyId:'P1', restricted:false, requestId:'product-request-0001', ...overrides,
    data:{name:'Produto A',presentation:'Frasco de teste',unit:'frasco',control:'quantity',storage:{min:null,max:null,instructions:'Conferir documento fictício',source:'Rótulo fictício',version:'1'},supplySource:'site',...overrides.data} });
  const initial = (productId, overrides = {}) => ({ studyId:'P1', restricted:false, requestId:'initial-request-0001', data:{ productId, lot:'L1', expiry:'2027-01-31', location:'Armário 1 → Prateleira 1', locationRef:{unitId:'UNIT-1',position:'Prateleira 1'}, kit:'', physical:10, blocked:2, countedOn:'2026-10-21', confirmed:true, note:'Contagem física' }, ...overrides });
  const sheet = (restricted = false) => stores[restricted ? RESTRICTED : STANDARD].getSheetByName(server.FARMACIA_LEDGER_SHEET_);
  return { server, app, users, stores, state, lock:lock.state, product, initial, sheet };
}

const LOCATIONS = 'farmacia-locations-0000000001';
function locationFixture() {
  const f = fixture(true);
  f.users.rows[1][2]='user';
  f.state.config = JSON.stringify({...JSON.parse(f.state.config),locations:LOCATIONS});
  f.stores[LOCATIONS] = new FakeSpreadsheet({});
  f.users.rows[0][10] = 'Acesso ao estoque comum da Farmácia'; f.users.rows[1][10] = 'manage';
  f.location = (overrides = {}) => ({requestId:'location-request-0001',data:{code:'IPS AF-01',type:'cabinet',model:'Armário',room:'Farmácia',
    min:15,max:30,source:'Qualificação fictícia',version:'1',sensor:'SENSOR-01',status:'active',positions:['Prateleira 1','Prateleira 2']},...overrides});
  f.catalogSheet = () => f.stores[LOCATIONS].getSheetByName(f.server.FARMACIA_LOCATIONS_SHEET_);
  f.inventory = id => {const request=f.initial(id); request.data.location='Catálogo'; request.data.locationRef={unitId:f.unitId,position:'Prateleira 1'}; return request;};
  return f;
}

test('catálogo dedicado preserva exclusividade; sem configuração usa o app sem criar schema na leitura', () => {
  const f = locationFixture();
  assert.equal(f.server.getFarmaciaEstoque('P1',false).storageUnits.length,0);
  assert.equal(f.catalogSheet(),null);
  const writes=f.users.writes;
  for (const id of [MAIN,STANDARD,RESTRICTED,'https://example.invalid/file']) {
    f.state.config=JSON.stringify({version:1,locations:id,studies:[{studyId:'P1',standard:STANDARD,restricted:RESTRICTED}]});
    f.state.opened=[];
    assert.throws(()=>f.server.getFarmaciaEstoque('P1',false),/inválida|exclusivos/);
    assert.deepEqual(f.state.opened,[]);
  }
  assert.equal(f.users.writes,writes);
  const missing=fixture(true);
  const stock=missing.server.getFarmaciaEstoque('P1',false);
  assert.equal(stock.locationsConfigured,true);
  assert.equal(stock.storageUnits.length,0);
  assert.equal(missing.app.getSheetByName(missing.server.FARMACIA_LOCATIONS_SHEET_),null);
});

test('primeiro equipamento cria aba e cabeçalhos no app, preserva outras abas e recarrega sem duplicar', () => {
  const f=locationFixture();
  f.state.config='';
  const users=JSON.stringify(f.users.rows), projects=JSON.stringify(f.app.getSheetByName('Projetos').rows);
  const name=f.server.FARMACIA_LOCATIONS_SHEET_;
  assert.equal(f.server.farmaciaReadLocations_().configured,true);
  assert.equal(f.app.getSheetByName(name),null);
  const invalid=f.location(); invalid.data.positions=[];
  assert.throws(()=>f.server.cadastrarLocalFarmacia(invalid),/posições/);
  assert.equal(f.app.getSheetByName(name),null);
  const request=f.location(), created=f.server.cadastrarLocalFarmacia(request);
  const sheet=f.app.getSheetByName(name);
  assert.deepEqual(Array.from(sheet.rows[0]),Array.from(f.server.FARMACIA_LOCATIONS_HEADERS_));
  const writes=sheet.writes;
  assert.equal(f.server.cadastrarLocalFarmacia(request).repeated,true);
  assert.equal(sheet.writes,writes);
  const units=f.server.farmaciaReadLocations_().units;
  assert.equal(units.length,1); assert.equal(units[0].id,created.id); assert.equal(units[0].code,request.data.code);
  assert.equal(JSON.stringify(f.users.rows),users);
  assert.equal(JSON.stringify(f.app.getSheetByName('Projetos').rows),projects);
  assert.equal(f.catalogSheet(),null);
  assert.deepEqual(f.state.opened,[]);
});

test('admin e user cadastram catálogo sem concessão de estoque; readonly não grava e lock revalida perfil', () => {
  for(const role of ['admin','user']) {
    const allowed=locationFixture();
    allowed.users.rows[1][2]=role; allowed.users.rows[1][8]='none'; allowed.users.rows[1][9]='[]'; allowed.users.rows[1][10]='none';
    assert.equal(allowed.server.getFarmaciaCatalogo().locationsCanManage,true);
    assert.equal(allowed.server.cadastrarLocalFarmacia(allowed.location()).ok,true);
    assert.throws(()=>allowed.server.getFarmaciaEstoque('P1',false),/permissão/);
  }
  const f=locationFixture();
  f.users.rows[1][2]='readonly';
  assert.equal(f.server.getFarmaciaCatalogo().locationsCanManage,false);
  f.state.opened=[];
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location()),/somente leitura/);
  assert.deepEqual(f.state.opened,[]);
  f.users.rows[1][2]='user';
  f.lock.onAcquire=()=>{f.users.rows[1][2]='readonly';};
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location()),/somente leitura/);
  assert.equal(f.catalogSheet(),null);
  f.users.rows[1][2]='user';
  f.lock.onAcquire=()=>{f.users.rows[1][3]='Não';};
  f.state.opened=[];
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location()),/inativo/);
  assert.deepEqual(f.state.opened,[]);
  assert.equal(f.catalogSheet(),null);
  assert.throws(()=>f.server.codexNormalizeFarmaciaStudies_([{studyId:'@IPS_LOCATIONS',restricted:false}]),/inválida/);
});

test('catálogo no app mantém ACL e recusa schema alheio sem sobrescrever dados', () => {
  const f=locationFixture();
  f.state.config='';
  f.users.rows[1][2]='readonly';
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location()),/somente leitura/);
  const name=f.server.FARMACIA_LOCATIONS_SHEET_;
  assert.equal(f.app.getSheetByName(name),null);
  f.users.rows[1][2]='user';
  const sheet=f.app.insertSheet(name);
  sheet.getRange(1,1,1,2).setValues([['Dados antigos','Preservar']]);
  const before=JSON.stringify(sheet.rows), writes=sheet.writes;
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location()),/Estrutura.*divergente/);
  assert.equal(sheet.writes,writes);
  assert.equal(JSON.stringify(sheet.rows),before);
});

test('catálogo pode ser consultado sem projeto ou estoque autorizado e não expõe produtos/saldos', () => {
  const f=locationFixture();
  f.server.cadastrarLocalFarmacia(f.location());
  f.users.rows[1][9]='[]'; f.users.rows[1][8]='none'; f.users.rows[1][10]='none'; f.users.rows[1][2]='readonly';
  f.state.opened=[];
  const result=f.server.getFarmaciaCatalogo();
  assert.equal(result.storageUnits.length,1); assert.equal(result.locationsCanManage,false);
  assert.deepEqual(Object.keys(result).sort(),['locationsCanManage','locationsConfigured','storageUnits']);
  assert.deepEqual(f.state.opened,[LOCATIONS]);
  f.users.rows[1][10]='none'; f.users.rows[1][8]='read';
  assert.equal(f.server.getFarmaciaCatalogo().storageUnits.length,1);
  f.users.rows[1][3]='Não'; f.state.opened=[];
  assert.throws(()=>f.server.getFarmaciaCatalogo(),/inativo/);
  assert.deepEqual(f.state.opened,[]);
});

test('equipamento tem código único e posições estáveis; cadastro e situação são idempotentes e auditados', () => {
  const f=locationFixture(),created=f.server.cadastrarLocalFarmacia(f.location()); f.unitId=created.id;
  const writes=f.catalogSheet().writes;
  assert.equal(f.server.cadastrarLocalFarmacia(f.location()).id,created.id);
  assert.equal(f.catalogSheet().writes,writes);
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location({requestId:'location-request-0002'})),/já cadastrado/);
  const update={requestId:'status-request-0001',data:{unitId:created.id,revision:1,status:'maintenance',reason:'Manutenção fictícia'}};
  const status=f.server.atualizarSituacaoLocalFarmacia(update);
  assert.equal(f.server.atualizarSituacaoLocalFarmacia(update).id,status.id);
  const unit=f.server.getFarmaciaEstoque('P1',false).storageUnits[0];
  assert.equal(unit.status,'maintenance'); assert.equal(unit.revision,2);
  assert.equal(unit.author,'farm@example.invalid'); assert.ok(unit.registeredAt);
  assert.throws(()=>f.server.atualizarSituacaoLocalFarmacia({...update,requestId:'status-request-0002'}),/equipamento mudou/);
  assert.throws(()=>f.server.atualizarSituacaoLocalFarmacia({...update,data:{...update.data,status:'active'}}),/outros dados/);
  assert.equal(f.catalogSheet().writes,writes+1);
});

test('posições e temperaturas inválidas são rejeitadas antes da primeira escrita; faixas não são inferidas', () => {
  for(const changes of [{min:30,max:15},{min:null,max:8},{min:NaN},{max:Infinity},{min:'2'}, {positions:[]},
    {positions:['A','a']},{positions:[' A ','A']},{status:'unknown'}]) {
    const f=locationFixture(),payload=f.location();
    assert.throws(()=>f.server.cadastrarLocalFarmacia({...payload,data:{...payload.data,...changes}}));
    assert.equal(f.catalogSheet(),null);
  }
  const f=locationFixture(),payload=f.location();
  f.server.cadastrarLocalFarmacia({...payload,data:{...payload.data,min:null,max:null,model:'phcbi MPR-721R-PA'}});
  const unit=f.server.getFarmaciaEstoque('P1',false).storageUnits[0];
  assert.equal(unit.min,null); assert.equal(unit.max,null);
});

test('equipamento é cadastrado sem referência documental ou versão, com retentativa idempotente', () => {
  const f=locationFixture(), payload=f.location();
  delete payload.data.source;
  delete payload.data.version;
  const created=f.server.cadastrarLocalFarmacia(payload);
  const writes=f.catalogSheet().writes;
  const unit=f.server.getFarmaciaCatalogo().storageUnits[0];
  assert.equal(unit.id,created.id);
  assert.equal(unit.min,15);
  assert.equal(unit.max,30);
  assert.equal(unit.source,'');
  assert.equal(unit.version,'');
  assert.equal(f.server.cadastrarLocalFarmacia(payload).repeated,true);
  assert.equal(f.catalogSheet().writes,writes);
});

test('inventário exige referências válidas, deriva rótulo no servidor e compara faixas sem alterar saldos', () => {
  const f=locationFixture(); f.unitId=f.server.cadastrarLocalFarmacia(f.location()).id;
  const storage={min:15,max:25,instructions:'Proteger da luz',source:'Manual fictício',version:'2'};
  const product=f.server.cadastrarProdutoFarmacia(f.product({data:{...f.product().data,storage}})).id;
  const request=f.inventory(product);
  const missing={...request,data:{...request.data}}; delete missing.data.locationRef;
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia(missing),/equipamento e uma posição/);
  for(const locationRef of [{unitId:'OUTRO',position:'Prateleira 1'},{unitId:f.unitId,position:'INEXISTENTE'}]) {
    assert.throws(()=>f.server.registrarInventarioInicialFarmacia({...request,data:{...request.data,locationRef}}),/equipamento e uma posição/);
  }
  f.server.registrarInventarioInicialFarmacia(request);
  assert.equal(f.server.registrarInventarioInicialFarmacia(request).repeated,true);
  const stock=f.server.getFarmaciaEstoque('P1',false),position=stock.positions[0];
  assert.equal(position.location,'IPS AF-01 → Prateleira 1'); assert.equal(position.storageCheck.status,'incompatible');
  assert.equal(position.physical,10); assert.equal(position.available,8); assert.equal(position.blocked,2);
  f.server.atualizarSituacaoLocalFarmacia({requestId:'status-request-0001',data:{unitId:f.unitId,revision:1,status:'unavailable',reason:'Revisão'}});
  const after=f.server.getFarmaciaEstoque('P1',false).positions[0];
  assert.equal(after.storageCheck.status,'unavailable'); assert.equal(after.available,8);
});

test('conservação documentada valida fonte/versão e falta de faixa permanece pendente', () => {
  const f=locationFixture(); f.unitId=f.server.cadastrarLocalFarmacia(f.location()).id;
  const storage={min:15,max:30,instructions:'Não congelar',source:'Rótulo fictício',version:'1'};
  for(const changes of [{min:null},{min:31},{min:'15'},{source:''},{version:''}]) {
    assert.throws(()=>f.server.cadastrarProdutoFarmacia(f.product({data:{...f.product().data,storage:{...storage,...changes}}})));
    assert.equal(f.sheet(),null);
  }
  const id=f.server.cadastrarProdutoFarmacia(f.product({data:{...f.product().data,storage}})).id;
  f.server.registrarInventarioInicialFarmacia(f.inventory(id));
  const writes=f.sheet().writes;
  assert.equal(f.server.getFarmaciaEstoque('P1',false).positions[0].storageCheck.status,'compatible');
  assert.equal(f.sheet().writes,writes);
  assert.equal(f.server.farmaciaStorageCheck_({}, {locationRef:{unitId:f.unitId,position:'Prateleira 1'}},f.server.getFarmaciaEstoque('P1',false).storageUnits).status,'pending');
});

test('localizações históricas continuam legíveis, sem migração ou recontagem equivalente', () => {
  const f=locationFixture(); f.unitId=f.server.cadastrarLocalFarmacia(f.location()).id;
  const id=f.server.cadastrarProdutoFarmacia(f.product()).id,request=f.inventory(id);
  f.server.registrarInventarioInicialFarmacia(request);
  const historical=JSON.parse(f.sheet().rows[2][7]); delete historical.locationRef;
  f.sheet().rows[2][7]=JSON.stringify(historical);
  const before=JSON.stringify(f.sheet().rows),writes=f.sheet().writes;
  const position=f.server.getFarmaciaEstoque('P1',false).positions[0];
  assert.equal(position.location,'IPS AF-01 → Prateleira 1'); assert.equal(position.storageCheck.status,'pending');
  assert.equal(JSON.stringify(f.sheet().rows),before); assert.equal(f.sheet().writes,writes);
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia({...request,requestId:'another-initial-request'}),/já possui/);
});

test('catálogo não revela ocupação restrita e registros corrompidos impedem leitura/escrita', () => {
  const f=locationFixture(); f.unitId=f.server.cadastrarLocalFarmacia(f.location()).id;
  const id=f.server.cadastrarProdutoFarmacia(f.product({restricted:true,data:{...f.product().data,name:'SEGREDO RESTRITO'}})).id;
  const payload=f.inventory(id); payload.restricted=true;
  f.server.registrarInventarioInicialFarmacia(payload);
  f.users.rows[1][9]='[{"studyId":"P1","restricted":false}]'; f.users.rows[1][10]='none';
  const standard=f.server.getFarmaciaEstoque('P1',false);
  assert.doesNotMatch(JSON.stringify(standard),/SEGREDO RESTRITO/);
  assert.equal(standard.locationsCanManage,true); assert.equal(standard.positions.length,0);
  f.catalogSheet().rows[1][5]='{}';
  assert.throws(()=>f.server.getFarmaciaEstoque('P1',false),/catálogo de locais inconsistentes/);
  f.users.rows[1][10]='manage';
  const writes=f.catalogSheet().writes;
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location({requestId:'new-location-request'})),/catálogo de locais inconsistentes/);
  assert.equal(f.catalogSheet().writes,writes);
});

test('sondas individuais têm série/número interno exclusivos, equipamento válido e calibração documentada', () => {
  const f=locationFixture(); f.unitId=f.server.cadastrarLocalFarmacia(f.location()).id;
  const probe=(code,serial)=>({requestId:'probe-request-'+code,data:{unitId:f.unitId,code,serial,model:'Modelo fictício',point:'Ponto '+code,
    calibration:{status:'current',calibratedOn:'2026-10-01',validUntil:'2026-10-31',certificate:'CERT-FICTICIO',note:''}}});
  const first=probe('S01','SERIE-01'),second=probe('S02','SERIE-02');
  const id=f.server.cadastrarSondaFarmacia(first).id;
  assert.equal(f.server.cadastrarSondaFarmacia(first).id,id);
  f.server.cadastrarSondaFarmacia(second);
  assert.equal(f.server.getFarmaciaEstoque('P1',false).storageUnits[0].probes.length,2);
  assert.throws(()=>f.server.cadastrarSondaFarmacia({...first,requestId:'probe-duplicate-0001'}),/já cadastrado/);
  assert.throws(()=>f.server.cadastrarSondaFarmacia({...second,requestId:'probe-duplicate-0002',data:{...second.data,code:'S03',serial:'serie-01'}}),/já cadastrado/);
  assert.throws(()=>f.server.cadastrarSondaFarmacia({...first,requestId:'probe-unknown-unit-0001',data:{...first.data,unitId:'OUTRO'}}),/não encontrado/);
  const writes=f.catalogSheet().writes;
  f.users.rows[1][2]='readonly';
  assert.throws(()=>f.server.cadastrarSondaFarmacia(probe('S03','SERIE-03')),/somente leitura/);
  assert.equal(f.catalogSheet().writes,writes);
});

test('calibração vence sem escrita nem prazo presumido; atualização preserva histórico e revisão concorrente', () => {
  const f=locationFixture(); f.unitId=f.server.cadastrarLocalFarmacia(f.location()).id;
  const calibration={status:'current',calibratedOn:'2026-10-01',validUntil:'2026-10-21',certificate:'CERT-01',note:''};
  const payload={requestId:'probe-request-0001',data:{unitId:f.unitId,code:'S01',serial:'SERIE-01',model:'Modelo fictício',point:'Superior',calibration}};
  for(const changes of [{calibratedOn:''},{validUntil:''},{certificate:''},{calibratedOn:'2026-10-22'},{validUntil:'2026-09-30'}]) {
    assert.throws(()=>f.server.cadastrarSondaFarmacia({...payload,data:{...payload.data,calibration:{...calibration,...changes}}}));
  }
  const id=f.server.cadastrarSondaFarmacia(payload).id;
  assert.equal(f.server.getFarmaciaEstoque('P1',false).storageUnits[0].probes[0].calibrationStatus,'current');
  const writes=f.catalogSheet().writes;
  f.state.today='2026-10-22';
  assert.equal(f.server.getFarmaciaEstoque('P1',false).storageUnits[0].probes[0].calibrationStatus,'expired');
  assert.equal(f.catalogSheet().writes,writes);
  const update={requestId:'calibration-request-0001',data:{unitId:f.unitId,probeId:id,revision:1,
    calibration:{status:'current',calibratedOn:'2026-10-22',validUntil:'2027-02-15',certificate:'CERT-02',note:'Nova calibração'}}};
  f.server.atualizarCalibracaoSondaFarmacia(update);
  assert.equal(f.server.atualizarCalibracaoSondaFarmacia(update).repeated,true);
  assert.equal(f.catalogSheet().writes,writes+1);
  assert.throws(()=>f.server.atualizarCalibracaoSondaFarmacia({...update,requestId:'calibration-request-0002'}),/sonda mudou/);
  const probe=f.server.getFarmaciaEstoque('P1',false).storageUnits[0].probes[0];
  assert.equal(probe.revision,2); assert.equal(probe.calibrationStatus,'current'); assert.equal(probe.calibration.certificate,'CERT-02');
  assert.equal(JSON.parse(f.catalogSheet().rows[2][5]).calibration.certificate,'CERT-01');
});

test('produto novo exige conservação no servidor, mas registros antigos e replay histórico são preservados', () => {
  const f=fixture(); const request=f.product(); delete request.data.storage;
  assert.throws(()=>f.server.cadastrarProdutoFarmacia(request),/conservação/);
  const id=f.server.cadastrarProdutoFarmacia(f.product()).id;
  const old=JSON.parse(f.sheet().rows[1][7]); delete old.storage;
  f.sheet().rows[1][7]=JSON.stringify(old);
  assert.equal(f.server.getFarmaciaEstoque('P1',false).products[0].storage,undefined);
  assert.equal(f.server.cadastrarProdutoFarmacia(request).id,id);
});

test('estoque comum persiste em arquivo próprio sem conceder estudos nem misturar posições', () => {
  const f = fixture(), common = 'farmacia-common-000000000001';
  f.stores[common] = new FakeSpreadsheet({});
  f.state.config = JSON.stringify({version:1,common,studies:[{studyId:'P1',standard:STANDARD,restricted:RESTRICTED}]});
  f.users.rows[0].push('Acesso ao estoque comum da Farmácia');
  f.users.rows[1].push('manage');
  const studyProduct = f.server.cadastrarProdutoFarmacia(f.product()).id;
  f.server.registrarInventarioInicialFarmacia(f.initial(studyProduct));
  const payload = f.product({studyId:'@IPS_COMMON'});
  const productId = f.server.cadastrarProdutoFarmacia(payload).id;
  f.server.registrarInventarioInicialFarmacia(f.initial(productId,{studyId:'@IPS_COMMON'}));
  assert.equal(f.server.cadastrarProdutoFarmacia(payload).id, productId);
  assert.notEqual(studyProduct, productId);
  assert.equal(f.server.getFarmaciaEstoque('@IPS_COMMON',false).positions[0].productId,productId);
  assert.equal(f.server.getFarmaciaEstoque('P1',false).positions[0].productId,studyProduct);
  f.users.rows[1][8] = 'none'; f.users.rows[1][9] = '[]';
  assert.equal(f.server.getFarmaciaEstoque('@IPS_COMMON',false).farmaciaAccess,'manage');
  assert.throws(() => f.server.getFarmaciaEstoque('P1',false), /permissão/);
  assert.throws(() => f.server.getFarmaciaEstoque('@IPS_COMMON',true), /não possui classe restrita/);
  assert.throws(() => f.server.registrarInventarioInicialFarmacia(f.initial(studyProduct,{studyId:'@IPS_COMMON',requestId:'foreign-product-request'})), /Produto não encontrado/);
  for (const level of ['read','operate','none']) {
    f.users.rows[1][10] = level;
    assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product({studyId:'@IPS_COMMON',requestId:'new-common-product'})), /permissão/);
  }
});

test('estoque comum sem configuração não usa arquivos de estudo e rejeita aliases no mapa inteiro', () => {
  const f = fixture();
  f.users.rows[0].push('Acesso ao estoque comum da Farmácia'); f.users.rows[1].push('manage');
  assert.equal(f.server.getFarmaciaEstoque('@IPS_COMMON',false).configured,false);
  assert.deepEqual(f.state.opened,[]);
  assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product({studyId:'@IPS_COMMON'})), /não configurado/);
  for (const common of [MAIN,STANDARD,RESTRICTED,'https://invalid.test/file',null]) {
    f.state.config = JSON.stringify({version:1,common,studies:[{studyId:'P1',standard:STANDARD,restricted:RESTRICTED}]});
    assert.throws(() => f.server.getFarmaciaEstoque('P1',false), /inválida|exclusivos/);
    assert.deepEqual(f.state.opened,[]);
  }
  f.state.config = JSON.stringify({version:1,studies:[{studyId:'@IPS_COMMON',standard:STANDARD}]});
  assert.throws(() => f.server.getFarmaciaEstoque('@IPS_COMMON',false), /inválida/);
});

test('revogação do estoque comum ao adquirir lock impede gravação e acesso a arquivos', () => {
  const f = fixture();
  f.users.rows[0].push('Acesso ao estoque comum da Farmácia'); f.users.rows[1].push('manage');
  f.lock.onAcquire = () => { f.users.rows[1][10] = 'none'; };
  assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product({studyId:'@IPS_COMMON'})), /permissão/);
  assert.deepEqual(f.state.opened,[]);
});

test('leituras não criam arquivos/abas e ausência de configuração nunca usa a planilha principal', () => {
  const f = fixture();
  assert.equal(f.server.getFarmaciaEstoque('P1', false).configured, true);
  assert.equal(f.sheet(), null);
  f.state.config = '';
  const result = f.server.getFarmaciaEstoque('P1', false);
  assert.equal(result.configured, false);
  assert.equal(result.products.length, 0);
  assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product()), /não configurado/);
  assert.equal(f.sheet(), null);
  assert.equal(f.users.writes, 0);
});

test('configuração rejeita arquivo principal, aliases e mistura de estudos/classes antes de abrir arquivos', () => {
  for (const studies of [
    [{ studyId:'P1', standard:MAIN }], [{ studyId:'P1', standard:STANDARD, restricted:STANDARD }],
    [{ studyId:'P1', standard:STANDARD }, { studyId:'P2', standard:STANDARD }],
    [{ studyId:'P1', standard:'https://docs.google.com/spreadsheets/d/' + STANDARD }],
    [{ studyId:'P1', standard:STANDARD }, { studyId:'P1', restricted:RESTRICTED }]
  ]) {
    const f = fixture();
    f.state.config = JSON.stringify({ version:1, studies });
    assert.throws(() => f.server.getFarmaciaEstoque('P1', false), /inválida|exclusivos/);
    assert.deepEqual(f.state.opened, []);
  }
});

test('cadastro e contagem exigem manage por estudo/classe; Admin não substitui concessão e lock revalida', () => {
  const f = fixture();
  for (const level of ['read', 'operate', 'none']) {
    f.users.rows[1][8] = level;
    assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product()), /permissão/);
  }
  f.users.rows[1][2] = 'admin';
  assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product()), /permissão/);
  f.users.rows[1][8] = 'manage';
  f.users.rows[1][9] = '[{"studyId":"P1","restricted":false}]';
  assert.throws(() => f.server.getFarmaciaEstoque('P1', true), /não autorizado/);
  assert.throws(() => f.server.getFarmaciaEstoque('P2', false), /não autorizado/);
  assert.throws(() => f.server.getFarmaciaEstoque('P1', 'false'), /classe/);
  f.lock.onAcquire = () => { f.users.rows[1][3] = 'Não'; };
  assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product()), /inativo/);
  assert.equal(f.sheet(), null);
  assert.equal(f.lock.held, false);
});

test('saldo inicial tem autoria/data, totais corretos e retentativas não duplicam produto nem posição', () => {
  const f = fixture();
  const created = f.server.cadastrarProdutoFarmacia(f.product());
  const writes = f.sheet().writes;
  assert.equal(f.server.cadastrarProdutoFarmacia(f.product()).id, created.id);
  assert.equal(f.sheet().writes, writes);
  const request = f.initial(created.id);
  const counted = f.server.registrarInventarioInicialFarmacia(request);
  assert.equal(f.server.registrarInventarioInicialFarmacia(request).id, counted.id);
  assert.equal(f.sheet().writes, writes + 1);
  const position = f.server.getFarmaciaEstoque('P1', false).positions[0];
  assert.equal(position.physical, 10); assert.equal(position.available, 8); assert.equal(position.blocked, 2);
  assert.equal(position.author, 'farm@example.invalid'); assert.equal(position.countedOn, '2026-10-21');
  assert.match(position.registeredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.throws(() => f.server.registrarInventarioInicialFarmacia({ ...request, requestId:'initial-request-0002' }), /já possui/);
  assert.throws(() => f.server.registrarInventarioInicialFarmacia({ ...request, requestId:'initial-request-0002', data:{ ...request.data, expiry:'2028-01-31' } }), /já possui/);
  assert.throws(() => f.server.registrarInventarioInicialFarmacia({ ...request, data:{ ...request.data, physical:20 } }), /outros dados/);
  assert.throws(() => f.server.cadastrarProdutoFarmacia({ ...f.product(), requestId:'product-request-0002' }), /já está cadastrado/);
});

test('resposta perdida após gravação não duplica inventário no retry', () => {
  const f = fixture(), productId = f.server.cadastrarProdutoFarmacia(f.product()).id;
  const sheet = f.sheet(), getRange = sheet.getRange.bind(sheet), request = f.initial(productId);
  let fail = true;
  sheet.getRange = (...args) => {
    const range = getRange(...args), setValues = range.setValues.bind(range);
    range.setValues = values => {
      const result = setValues(values);
      if (fail) { fail = false; throw new Error('Resposta perdida após gravar'); }
      return result;
    };
    return range;
  };
  assert.throws(() => f.server.registrarInventarioInicialFarmacia(request), /Resposta perdida/);
  const writes = sheet.writes;
  assert.equal(f.server.registrarInventarioInicialFarmacia(request).repeated, true);
  assert.equal(sheet.writes, writes);
  assert.equal(f.server.getFarmaciaEstoque('P1', false).positions.length, 1);
});

test('arquivo com dados alheios é recusado e corrupção de inventário não é corrigida na leitura', () => {
  const occupied = fixture();
  occupied.stores[STANDARD].insertSheet('Estoque legado').appendRow(['Dado existente']);
  assert.throws(() => occupied.server.getFarmaciaEstoque('P1', false), /arquivo dedicado/);
  for (const changes of [{ productId:'PRODUTO-AUSENTE' }, { blocked:99 }]) {
    const f = fixture(), productId = f.server.cadastrarProdutoFarmacia(f.product()).id;
    f.server.registrarInventarioInicialFarmacia(f.initial(productId));
    const row = f.sheet().rows[2]; row[7] = JSON.stringify({ ...JSON.parse(row[7]), ...changes });
    const writes = f.sheet().writes;
    assert.throws(() => f.server.getFarmaciaEstoque('P1', false), /inconsistentes/);
    assert.throws(() => f.server.registrarInventarioInicialFarmacia(f.initial(productId)), /inconsistentes/);
    assert.equal(f.sheet().writes, writes);
  }
});

test('kits individualizados valem uma unidade e não podem ser contados de novo em outro produto ou local', () => {
  const f = fixture();
  const kitData = { name:'Kit cego A', presentation:'Caixa de teste', unit:'kit', control:'kit' };
  const created = f.server.cadastrarProdutoFarmacia(f.product({ data:kitData }));
  const base = f.initial(created.id);
  assert.throws(() => f.server.registrarInventarioInicialFarmacia(base), /kit válido|saldo físico/);
  const request = { ...base, data:{ ...base.data, physical:1, blocked:0, kit:'K-001' } };
  f.server.registrarInventarioInicialFarmacia(request);
  const other = f.server.cadastrarProdutoFarmacia(f.product({ requestId:'product-request-0002', data:{ ...kitData, name:'Kit cego B' } }));
  assert.throws(() => f.server.registrarInventarioInicialFarmacia({ ...request, requestId:'initial-request-0002', data:{ ...request.data, productId:other.id, location:'Outro armário', lot:'L2' } }), /já possui/);
});

test('quantidades, calendário, conferência e produto são validados antes da escrita', () => {
  const f = fixture(), productId = f.server.cadastrarProdutoFarmacia(f.product()).id;
  const request = f.initial(productId), writes = f.sheet().writes;
  for (const data of [
    { physical:'' }, { physical:NaN }, { physical:Infinity }, { physical:-1 }, { physical:0 }, { physical:1.5 },
    { blocked:11 }, { expiry:'2026-02-30' }, { countedOn:'2026-10-22' }, { confirmed:false },
    { productId:'OUTRO' }, { kit:'KIT-INDEVIDO' }, { locationRef:{unitId:'OUTRO',position:'Prateleira 1'} }, { expiry:'2026-01-01', blocked:0 }
  ]) assert.throws(() => f.server.registrarInventarioInicialFarmacia({ ...request, data:{ ...request.data, ...data } }));
  assert.equal(f.sheet().writes, writes);
  f.server.registrarInventarioInicialFarmacia({ ...request, data:{ ...request.data, expiry:'2026-01-01', blocked:10 } });
  assert.equal(f.server.getFarmaciaEstoque('P1', false).positions[0].available, 0);
});

test('vencimento posterior zera disponível sem alterar o registro e replay original continua idempotente', () => {
  const f = fixture(), productId = f.server.cadastrarProdutoFarmacia(f.product()).id;
  const request = f.initial(productId);
  f.server.registrarInventarioInicialFarmacia(request);
  const writes = f.sheet().writes;
  f.state.today = '2027-02-01';
  const position = f.server.getFarmaciaEstoque('P1', false).positions[0];
  assert.equal(position.available, 0); assert.equal(position.blocked, 10); assert.equal(position.initialBlocked, 2);
  assert.equal(f.server.registrarInventarioInicialFarmacia(request).repeated, true);
  assert.equal(f.sheet().writes, writes);
});

test('classes são arquivos distintos; leitura padrão não abre nem conta conteúdo restrito', () => {
  const f = fixture();
  f.server.cadastrarProdutoFarmacia(f.product({ restricted:true, data:{ ...f.product().data, name:'Restrito' } }));
  f.state.opened = [];
  const standard = f.server.getFarmaciaEstoque('P1', false);
  assert.equal(standard.products.length, 0);
  assert.deepEqual(f.state.opened, [STANDARD]);
  assert.equal(f.server.getFarmaciaEstoque('P1', true).products[0].name, 'Restrito');
});

test('schema e registros inconsistentes bloqueiam leitura e escrita sem normalizar saldo', () => {
  for (const corrupt of [
    sheet => { sheet.rows[0][0] = 'Outra coluna'; },
    sheet => { sheet.rows[1][2] = '"P2"'; },
    sheet => { sheet.rows[1][7] = '{}'; },
    sheet => { sheet.rows.push(sheet.rows[1].slice()); }
  ]) {
    const f = fixture(); f.server.cadastrarProdutoFarmacia(f.product());
    corrupt(f.sheet());
    const writes = f.sheet().writes;
    assert.throws(() => f.server.getFarmaciaEstoque('P1', false), /divergente|inconsistentes/);
    assert.throws(() => f.server.cadastrarProdutoFarmacia(f.product({ requestId:'product-request-0002' })), /divergente|inconsistentes/);
    assert.equal(f.sheet().writes, writes);
  }
});

test('campos textuais são persistidos em JSON seguro contra fórmulas e unidades fracionárias mantêm precisão', () => {
  const f = fixture();
  const productId = f.server.cadastrarProdutoFarmacia(f.product({ data:{ name:'=HYPERLINK("teste")', presentation:'@rótulo', unit:'mL', control:'quantity' } })).id;
  const base = f.initial(productId);
  f.server.registrarInventarioInicialFarmacia({ ...base, data:{ ...base.data, lot:'=LOTE', location:'+LOCAL', physical:0.125, blocked:0.025 } });
  assert.equal(f.server.getFarmaciaEstoque('P1', false).positions[0].available, 0.1);
  assert.ok(f.sheet().rows.slice(1).every(row => row[7].startsWith('{') && row[6].startsWith('"') && row[2].startsWith('"')));
});

function lifecycleFixture(data = {}) {
  const f = fixture();
  f.productId = f.server.cadastrarProdutoFarmacia(f.product({data:{supplySource:'sponsor',...data}})).id;
  f.stock = () => f.server.getFarmaciaEstoque('P1',false);
  f.receipt = (overrides = {}) => ({studyId:'P1',restricted:false,requestId:'receipt-request-0001',data:{productId:f.productId,
    lot:'L2',expiry:'2027-01-31',location:'Catálogo',locationRef:{unitId:'UNIT-1',position:'Prateleira 1'},kit:'',physical:10,
    receivedOn:'2026-10-21',document:'REMESSA-001',note:'Conferência do recebimento',...overrides}});
  f.move = (position, overrides = {}) => ({studyId:'P1',restricted:false,requestId:'movement-request-'+(++f.state.uuid),
    data:{positionId:position.id,revision:position.revision,action:'release',quantity:2,from:'pending',reason:'Avaliação registrada',document:'DOC-001',...overrides}});
  return f;
}

test('origem do fornecimento é explícita em novos produtos; histórico permanece sem origem presumida', () => {
  const f=fixture(), request=f.product(); delete request.data.supplySource;
  assert.throws(()=>f.server.cadastrarProdutoFarmacia(request),/origem/);
  assert.throws(()=>f.server.cadastrarProdutoFarmacia(f.product({data:{supplySource:'inferida'}})),/origem/);
  assert.equal(f.sheet(),null);
  const id=f.server.cadastrarProdutoFarmacia(f.product()).id;
  const row=f.sheet().rows[1], data=JSON.parse(row[7]); delete data.supplySource; row[7]=JSON.stringify(data);
  assert.equal(f.server.getFarmaciaEstoque('P1',false).products[0].supplySource,undefined);
  assert.equal(f.server.cadastrarProdutoFarmacia(request).id,id);
  const receipt=lifecycleFixture().receipt(); receipt.data.productId=id;
  assert.throws(()=>f.server.registrarRecebimentoFarmacia(receipt),/exclusivos/);
  const common='farmacia-common-000000000001';
  f.users.rows[0][10]='Acesso ao estoque comum da Farmácia'; f.users.rows[1][10]='manage';
  f.state.config=JSON.stringify({...JSON.parse(f.state.config),common}); f.stores[common]=new FakeSpreadsheet({});
  assert.throws(()=>f.server.cadastrarProdutoFarmacia(f.product({studyId:'@IPS_COMMON',requestId:'sponsored-common-product',data:{supplySource:'sponsor'}})),/estoque do estudo/);
  assert.equal(f.stores[common].getSheets().length,0);
});

test('saldo inicial do patrocinador não presume liberação; recebimento mantém origem e autoria distintas', () => {
  const f=lifecycleFixture();
  const initial=f.server.registrarInventarioInicialFarmacia(f.initial(f.productId));
  const receipt=f.server.registrarRecebimentoFarmacia(f.receipt());
  const stock=f.stock(), position=stock.positions.find(item=>item.id===initial.id), received=stock.positions.find(item=>item.id===receipt.id);
  assert.equal(position.available,0); assert.equal(position.pending,8); assert.equal(position.blocked,2);
  assert.equal(position.origin,'initial'); assert.equal(position.revision,initial.id);
  assert.equal(received.origin,'receipt'); assert.equal(received.pending,10); assert.equal(received.blocked,0);
  assert.equal(received.document,'REMESSA-001'); assert.equal(received.location,'Armário 1 → Prateleira 1');
  assert.equal(stock.movements.length,2); assert.equal(stock.movements[1].type,'RECEIPT');
  assert.equal(stock.movements[1].author,'farm@example.invalid');
  assert.match(stock.movements[1].registeredAt,/^\d{4}-\d{2}-\d{2}T/);
  const tampered=f.initial(f.productId); tampered.requestId='initial-pending-tamper'; tampered.data.pending=0;
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia(tampered),/aguarda avaliação/);
});

test('liberação e bloqueio parciais preservam físico e histórico; revisão obsoleta e excesso não gravam', () => {
  const f=lifecycleFixture(); f.server.registrarRecebimentoFarmacia(f.receipt());
  const original=f.stock().positions[0], release=f.move(original);
  const released=f.server.registrarMovimentacaoFarmacia(release), writes=f.sheet().writes;
  let position=f.stock().positions[0];
  assert.equal(position.physical,10); assert.equal(position.available,2); assert.equal(position.pending,8);
  assert.equal(position.revision,released.id);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia({...release,requestId:'stale-movement-request'}),/saldo mudou/);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia(f.move(position,{quantity:9})),/excede/);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia(f.move(position,{action:'block',from:'blocked',quantity:1})),/situação/);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia(f.move(position,{action:'release',from:'available',quantity:1})),/situação/);
  assert.equal(f.sheet().writes,writes);
  f.server.registrarMovimentacaoFarmacia(f.move(position,{action:'block',from:'available',quantity:1}));
  position=f.stock().positions[0]; assert.equal(position.available,1); assert.equal(position.blocked,1);
  f.server.registrarMovimentacaoFarmacia(f.move(position,{action:'block',from:'pending',quantity:3}));
  position=f.stock().positions[0]; assert.equal(position.pending,5); assert.equal(position.blocked,4);
  f.server.registrarMovimentacaoFarmacia(f.move(position,{from:'blocked',quantity:2}));
  position=f.stock().positions[0]; assert.equal(position.available,3); assert.equal(position.blocked,2); assert.equal(position.pending,5);
  assert.equal(f.stock().movements.length,5);
  assert.equal(f.stock().movements[0].data.physical,10);
});

test('movimentações exigem motivo, documento, unidade válida e registro do mesmo escopo antes de gravar', () => {
  const f=lifecycleFixture(); f.server.registrarRecebimentoFarmacia(f.receipt());
  const position=f.stock().positions[0], writes=f.sheet().writes;
  for(const data of [{reason:''},{document:''},{quantity:0},{quantity:NaN},{quantity:Infinity},{quantity:1.5},{positionId:'FIN-OUTRO'},
    {action:'dispense'},{from:'available'},{quantity:-1},{revision:''}]) {
    assert.throws(()=>f.server.registrarMovimentacaoFarmacia(f.move(position,data)));
  }
  assert.equal(f.sheet().writes,writes);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia({...f.move(position),restricted:true}),/exclusivas/);
  assert.equal(f.stores[RESTRICTED].getSheets().length,0);
});

test('recebimento valida data, documento, produto, kit e localização antes de criar entrada', () => {
  const f=lifecycleFixture(), writes=f.sheet().writes;
  for(const data of [{receivedOn:'2026-10-22'},{receivedOn:'2026-02-30'},{document:''},{physical:0},{physical:1.5},
    {kit:'INDEVIDO'},{productId:'OUTRO'},{locationRef:{unitId:'OUTRO',position:'Prateleira 1'}}]) {
    assert.throws(()=>f.server.registrarRecebimentoFarmacia(f.receipt(data)));
  }
  assert.equal(f.sheet().writes,writes);
  f.server.registrarRecebimentoFarmacia(f.receipt());
  assert.throws(()=>f.server.registrarRecebimentoFarmacia({...f.receipt(),requestId:'receipt-request-newid'}),/já foi registrado/);
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia({...f.initial(f.productId),data:{...f.initial(f.productId).data,lot:'L2'}}),/já possui/);
  assert.equal(f.stock().positions.length,1);
});

test('kit recebido é único entre recebimentos e inventário e produto local não recebe ciclo do patrocinador', () => {
  const f=lifecycleFixture({unit:'kit',control:'kit'});
  f.server.registrarRecebimentoFarmacia(f.receipt({physical:1,kit:'KIT-01'}));
  assert.throws(()=>f.server.registrarRecebimentoFarmacia({...f.receipt({physical:1,kit:'KIT-01',document:'OUTRA'}),requestId:'receipt-kit-duplicate'}),/já possui/);
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia({...f.initial(f.productId),data:{...f.initial(f.productId).data,physical:1,blocked:0,kit:'KIT-01'}}),/já possui/);
  const local=fixture(), product=local.server.cadastrarProdutoFarmacia(local.product()).id;
  local.server.registrarInventarioInicialFarmacia(local.initial(product));
  assert.throws(()=>local.server.registrarMovimentacaoFarmacia(f.move(local.server.getFarmaciaEstoque('P1',false).positions[0],{from:'blocked',quantity:1})),/exclusivas/);
});

test('vencimento bloqueia DTO e liberação sem reescrever histórico; retry anterior continua idempotente', () => {
  const f=lifecycleFixture(); f.server.registrarRecebimentoFarmacia(f.receipt());
  const request=f.move(f.stock().positions[0]); f.server.registrarMovimentacaoFarmacia(request);
  const writes=f.sheet().writes; f.state.today='2027-02-01';
  const position=f.stock().positions[0];
  assert.equal(position.blocked,10); assert.equal(position.available,0); assert.equal(position.pending,0);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia(f.move(position)),/vencido/);
  assert.equal(f.server.registrarMovimentacaoFarmacia(request).repeated,true);
  assert.equal(f.server.registrarRecebimentoFarmacia(f.receipt()).repeated,true);
  assert.equal(f.sheet().writes,writes);
  const expired=lifecycleFixture(); expired.server.registrarRecebimentoFarmacia(expired.receipt({expiry:'2026-10-20'}));
  assert.equal(expired.stock().positions[0].blocked,10);
});

test('transferência integral altera localização atual e preserva origem, situações e documentos no histórico', () => {
  const f=lifecycleFixture(); f.server.farmaciaReadLocations_=()=>({configured:true,units:[{id:'UNIT-1',code:'Armário 1',positions:['Prateleira 1','Prateleira 2'],min:null,max:null,status:'active'}]});
  f.server.registrarRecebimentoFarmacia(f.receipt());
  const position=f.stock().positions[0], request=f.move(position,{action:'transfer',quantity:10,location:'Catálogo',locationRef:{unitId:'UNIT-1',position:'Prateleira 2'}});
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia({...request,data:{...request.data,quantity:5}}),/todo o saldo/);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia({...request,data:{...request.data,locationRef:{unitId:'UNIT-1',position:'Prateleira 1'}}}),/diferente/);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia({...request,data:{...request.data,locationRef:{unitId:'UNIT-1',position:'Ausente'}}}),/posição cadastrados/);
  const result=f.server.registrarMovimentacaoFarmacia(request), writes=f.sheet().writes;
  const stock=f.stock(), transferred=stock.positions[0];
  assert.equal(transferred.location,'Armário 1 → Prateleira 2'); assert.equal(transferred.pending,10); assert.equal(transferred.physical,10);
  assert.equal(transferred.revision,result.id); assert.equal(stock.movements[0].data.location,'Armário 1 → Prateleira 1');
  assert.equal(stock.movements[1].data.location,'Armário 1 → Prateleira 2');
  assert.equal(f.server.registrarMovimentacaoFarmacia(request).repeated,true); assert.equal(f.sheet().writes,writes);
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia({...request,data:{...request.data,reason:'Outro'}}),/outros dados/);
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia({...f.initial(f.productId),data:{...f.initial(f.productId).data,lot:'L2',locationRef:{unitId:'UNIT-1',position:'Prateleira 2'}}}),/já possui/);
});

test('movimentações e recebimentos revalidam ACL sob lock sem substituir permissões por perfil geral', () => {
  for(const method of ['registrarRecebimentoFarmacia','registrarMovimentacaoFarmacia']) {
    const f=lifecycleFixture(); f.server.registrarRecebimentoFarmacia(f.receipt());
    const payload=method==='registrarRecebimentoFarmacia'?{...f.receipt({document:'OUTRA'}),requestId:'receipt-permission-check'}:f.move(f.stock().positions[0]);
    const writes=f.sheet().writes; f.users.rows[1][8]='operate';
    assert.throws(()=>f.server[method](payload),/permissão/);
    f.users.rows[1][2]='admin'; assert.throws(()=>f.server[method](payload),/permissão/);
    f.users.rows[1][8]='manage'; f.lock.onAcquire=()=>{f.users.rows[1][8]='read';};
    assert.throws(()=>f.server[method](payload),/permissão/);
    assert.equal(f.sheet().writes,writes); assert.equal(f.lock.held,false);
  }
});

test('resposta perdida após movimento não duplica saldo; retentativa usa payload e revisão originais', () => {
  const f=lifecycleFixture(); f.server.registrarRecebimentoFarmacia(f.receipt());
  const request=f.move(f.stock().positions[0]), sheet=f.sheet(), getRange=sheet.getRange.bind(sheet);
  let fail=true;
  sheet.getRange=(...args)=>{
    const range=getRange(...args), setValues=range.setValues.bind(range);
    range.setValues=values=>{const result=setValues(values); if(fail){fail=false;throw new Error('Resposta perdida');}return result;};
    return range;
  };
  assert.throws(()=>f.server.registrarMovimentacaoFarmacia(request),/Resposta perdida/);
  const writes=sheet.writes; assert.equal(f.server.registrarMovimentacaoFarmacia(request).repeated,true);
  assert.equal(sheet.writes,writes); assert.equal(f.stock().positions[0].available,2);
  assert.equal(f.stock().movements.length,2);
});

test('replay do ledger recusa movimento corrompido sem corrigir saldos nem gravar', () => {
  for(const changes of [{quantity:99},{revision:'FMV-ausente'},{positionId:'FIN-ausente'},{from:'available'},{reason:''}]) {
    const f=lifecycleFixture(); f.server.registrarRecebimentoFarmacia(f.receipt());
    f.server.registrarMovimentacaoFarmacia(f.move(f.stock().positions[0]));
    const row=f.sheet().rows.at(-1); row[7]=JSON.stringify({...JSON.parse(row[7]),...changes});
    const writes=f.sheet().writes;
    assert.throws(()=>f.stock(),/inconsistentes/);
    assert.throws(()=>f.server.registrarRecebimentoFarmacia({...f.receipt({document:'OUTRA'}),requestId:'receipt-after-corrupt'}),/inconsistentes/);
    assert.equal(f.sheet().writes,writes);
  }
});

test('liberação fracionária mantém precisão e texto documental permanece em JSON seguro', () => {
  const f=lifecycleFixture({unit:'mL'}); f.server.registrarRecebimentoFarmacia(f.receipt({physical:0.125,document:'=REMESSA'}));
  f.server.registrarMovimentacaoFarmacia(f.move(f.stock().positions[0],{quantity:0.025,reason:'=Motivo',document:'@DOCUMENTO'}));
  const stock=f.stock(); assert.equal(stock.positions[0].available,0.025); assert.equal(stock.positions[0].pending,0.1);
  assert.equal(stock.movements[1].data.reason,'=Motivo');
  assert.ok(f.sheet().rows.slice(1).every(row=>row[7].startsWith('{')&&row[6].startsWith('"')));
});


test('correções e exclusões do catálogo preservam calibrações, IDs e concorrência', () => {
  const f=locationFixture();
  f.unitId=f.server.cadastrarLocalFarmacia(f.location()).id;
  const created=f.server.cadastrarSondaFarmacia({requestId:'probe-actions-0001',data:{unitId:f.unitId,code:'S1',serial:'SER1',model:'M1',calibration:{status:'current',calibratedOn:'2026-10-01',validUntil:'2027-10-01',certificate:'CERT-1',note:'Primeira'}}});
  const change={requestId:'probe-edit-actions-0001',data:{kind:'probe',unitId:f.unitId,probeId:created.id,revision:1,values:{...created.catalog.storageUnits[0].probes[0],model:'M2'}}};
  const edited=f.server.editarRegistroCatalogoFarmacia(change);
  assert.equal(edited.catalog.storageUnits[0].probes[0].model,'M2');
  assert.equal(f.server.editarRegistroCatalogoFarmacia(change).repeated,true);
  assert.throws(()=>f.server.editarRegistroCatalogoFarmacia({...change,requestId:'stale-edit-actions-0001'}),/mudou/);
  f.server.atualizarCalibracaoSondaFarmacia({requestId:'calibration-actions-0001',data:{unitId:f.unitId,probeId:created.id,revision:2,calibration:{status:'current',calibratedOn:'2026-10-21',validUntil:'2027-10-21',certificate:'CERT-2',note:'Segunda'}}});
  const probe=f.server.getFarmaciaCatalogo().storageUnits[0].probes[0];
  assert.equal(probe.calibrationHistory.length,1);
  assert.equal(probe.calibrationHistory[0].calibration.certificate,'CERT-1');
  assert.equal(probe.calibrationHistory[0].calibration.note,'Primeira');
  assert.throws(()=>f.server.excluirRegistroCatalogoFarmacia({requestId:'delete-unit-actions-0001',data:{kind:'unit',unitId:f.unitId,revision:1}}),/sondas vinculadas/);
  const deleted=f.server.excluirRegistroCatalogoFarmacia({requestId:'delete-probe-actions-0001',data:{kind:'probe',unitId:f.unitId,probeId:created.id,revision:3}});
  assert.equal(deleted.catalog.storageUnits[0].probes[0].deleted,true);
  assert.equal(deleted.catalog.storageUnits[0].probes[0].calibrationHistory[0].calibration.certificate,'CERT-1');
  f.users.rows[1][2]='readonly';
  assert.throws(()=>f.server.excluirRegistroCatalogoFarmacia({requestId:'forbidden-unit-actions-0001',data:{kind:'unit',unitId:f.unitId,revision:1}}),/somente leitura/);
});


test('equipamento excluído não recebe novas entradas e edição não contorna motivo de situação', () => {
  const f=locationFixture();
  const unit=f.server.cadastrarLocalFarmacia(f.location());f.unitId=unit.id;
  const values={...unit.catalog.storageUnits[0],status:'maintenance'};
  assert.throws(()=>f.server.editarRegistroCatalogoFarmacia({requestId:'unit-status-bypass-0001',data:{kind:'unit',unitId:unit.id,revision:1,values}}),/situação com motivo/);
  const product=f.server.cadastrarProdutoFarmacia(f.product()).id;
  f.server.excluirRegistroCatalogoFarmacia({requestId:'unit-delete-guard-0001',data:{kind:'unit',unitId:unit.id,revision:1}});
  assert.throws(()=>f.server.registrarInventarioInicialFarmacia(f.inventory(product)),/equipamento.*posição/);
  assert.equal(f.server.getFarmaciaCatalogo().storageUnits[0].deleted,true);
});
