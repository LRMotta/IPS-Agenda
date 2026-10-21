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
  const server = runFiles(['WebApp.gs', 'FarmaciaEstoque.gs', 'FarmaciaLocais.gs'], {
    LockService:lock.LockService,
    PropertiesService:{ getScriptProperties:() => ({ getProperty:() => state.config }) },
    SpreadsheetApp:{ openById:id => { state.opened.push(id); if (!stores[id]) throw new Error('Arquivo desconhecido'); return stores[id]; } },
    Utilities:{ getUuid:() => 'uuid-' + (++state.uuid) }
  });
  server.getCodexSpreadsheet_ = () => app;
  server.codexGetActiveUserEmail_ = () => 'farm@example.invalid';
  server.farmaciaToday_ = () => state.today;
  if (!realLocations) server.farmaciaReadLocations_ = () => ({ configured:true, units:[{id:'UNIT-1',code:'Armário 1',positions:['Prateleira 1'],min:null,max:null,status:'active'}] });
  const product = (overrides = {}) => ({ studyId:'P1', restricted:false, requestId:'product-request-0001', ...overrides,
    data:{name:'Produto A',presentation:'Frasco de teste',unit:'frasco',control:'quantity',storage:{min:null,max:null,instructions:'Conferir documento fictício',source:'Rótulo fictício',version:'1'},...overrides.data} });
  const initial = (productId, overrides = {}) => ({ studyId:'P1', restricted:false, requestId:'initial-request-0001', data:{ productId, lot:'L1', expiry:'2027-01-31', location:'Armário 1 → Prateleira 1', locationRef:{unitId:'UNIT-1',position:'Prateleira 1'}, kit:'', physical:10, blocked:2, countedOn:'2026-10-21', confirmed:true, note:'Contagem física' }, ...overrides });
  const sheet = (restricted = false) => stores[restricted ? RESTRICTED : STANDARD].getSheetByName(server.FARMACIA_LEDGER_SHEET_);
  return { server, users, stores, state, lock:lock.state, product, initial, sheet };
}

const LOCATIONS = 'farmacia-locations-0000000001';
function locationFixture() {
  const f = fixture(true);
  f.state.config = JSON.stringify({...JSON.parse(f.state.config),locations:LOCATIONS});
  f.stores[LOCATIONS] = new FakeSpreadsheet({});
  f.users.rows[0][10] = 'Acesso ao estoque comum da Farmácia'; f.users.rows[1][10] = 'manage';
  f.location = (overrides = {}) => ({requestId:'location-request-0001',data:{code:'IPS AF-01',type:'cabinet',model:'Armário',room:'Farmácia',
    min:15,max:30,source:'Qualificação fictícia',version:'1',sensor:'SENSOR-01',status:'active',positions:['Prateleira 1','Prateleira 2']},...overrides});
  f.catalogSheet = () => f.stores[LOCATIONS].getSheetByName(f.server.FARMACIA_LOCATIONS_SHEET_);
  f.inventory = id => {const request=f.initial(id); request.data.location='Catálogo'; request.data.locationRef={unitId:f.unitId,position:'Prateleira 1'}; return request;};
  return f;
}

test('catálogo compartilhado exige arquivo exclusivo; leitura sem configuração não cria schema', () => {
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
  assert.equal(stock.locationsConfigured,false);
  assert.equal(stock.storageUnits.length,0);
});

test('somente responsável comum administra locais; estudo/manage e Admin não substituem concessão', () => {
  const f=locationFixture();
  for(const role of ['admin','user','readonly']) for(const level of ['none','read','operate']) {
    f.users.rows[1][2]=role; f.users.rows[1][10]=level; f.state.opened=[];
    assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location()),/permissão/);
    assert.deepEqual(f.state.opened,[]);
  }
  f.users.rows[1][10]='manage';
  f.lock.onAcquire=()=>{f.users.rows[1][10]='none';};
  assert.throws(()=>f.server.cadastrarLocalFarmacia(f.location()),/permissão/);
  assert.equal(f.catalogSheet(),null);
  assert.throws(()=>f.server.codexNormalizeFarmaciaStudies_([{studyId:'@IPS_LOCATIONS',restricted:false}]),/inválida/);
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
    {positions:['A','a']},{positions:[' A ','A']},{status:'unknown'},{source:''},{version:''}]) {
    const f=locationFixture(),payload=f.location();
    assert.throws(()=>f.server.cadastrarLocalFarmacia({...payload,data:{...payload.data,...changes}}));
    assert.equal(f.catalogSheet(),null);
  }
  const f=locationFixture(),payload=f.location();
  f.server.cadastrarLocalFarmacia({...payload,data:{...payload.data,min:null,max:null,model:'phcbi MPR-721R-PA'}});
  const unit=f.server.getFarmaciaEstoque('P1',false).storageUnits[0];
  assert.equal(unit.min,null); assert.equal(unit.max,null);
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
  assert.equal(standard.locationsCanManage,false); assert.equal(standard.positions.length,0);
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
  f.users.rows[1][10]='read';
  assert.throws(()=>f.server.cadastrarSondaFarmacia(probe('S03','SERIE-03')),/permissão/);
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
