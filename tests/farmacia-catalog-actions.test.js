'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {runFiles} = require('./helpers/load-app-script');
const {FakeSpreadsheet} = require('./helpers/fake-spreadsheet');

function fixture() {
  const ss = new FakeSpreadsheet({}), state = {uuid:0, allowed:true, onLock:null};
  const server = runFiles(['FarmaciaEstoque.gs', 'FarmaciaLocais.gs', 'FarmaciaCatalogActions.gs'], {
    Utilities:{getUuid:() => 'test-' + (++state.uuid)}, FARMACIA_COMMON_SCOPE_:'@IPS_COMMON'
  });
  server.farmaciaToday_ = () => '2026-10-22';
  server.codexWithDocumentLock_ = (name, fn) => { if (state.onLock) state.onLock(); return fn(); };
  const context = {ss, studyId:'P1', restricted:false, access:{userEmail:'test@example.invalid'}};
  server.farmaciaContext_ = (studyId, restricted) => {
    if (!state.allowed || studyId !== 'P1' || restricted !== false) throw new Error('Sem permissão');
    return context;
  };
  server.farmaciaReadLocations_ = () => ({units:[{id:'U1',code:'Armário',positions:['A']}]});
  const product = server.cadastrarProdutoFarmacia({studyId:'P1',restricted:false,requestId:'product-request-0001',data:{name:'Produto',presentation:'Frasco',category:'medicine',productCode:'',barcode:'',dosageForm:'',strength:'',route:'',unit:'frasco',control:'quantity',supplySource:'site',storage:{min:null,max:null,instructions:'Conservar'}}});
  const ledger = () => server.farmaciaReadLedger_(context);
  const action = (type, entityId, revision, data, requestId = 'action-request-00001') => ({studyId:'P1',restricted:false,requestId,type,data:{entityId,revision,reason:'Correção de cadastro incorreto',...(data ? {data} : {})}});
  const initial = () => server.registrarInventarioInicialFarmacia({studyId:'P1',restricted:false,requestId:'initial-request-0001',data:{productId:product.id,lot:'L1',expiry:'2027-01-31',location:'Catálogo',locationRef:{unitId:'U1',position:'A'},kit:'',physical:10,blocked:0,countedOn:'2026-10-22',confirmed:true,note:''}});
  return {server,state,ss,product,ledger,action,initial};
}

test('correções de produto são append-only, idempotentes e preservam campos omitidos', () => {
  const f = fixture(), original = JSON.stringify(f.ss.getSheetByName(f.server.FARMACIA_LEDGER_SHEET_).rows[1]);
  const data = {name:'Corrigido',category:'medicine',presentation:'Frasco',unit:'frasco',control:'quantity'};
  const payload = f.action('PRODUCT_EDIT',f.product.id,f.product.id,data);
  const saved = f.server.alterarRegistroFarmacia(payload);
  assert.equal(f.server.alterarRegistroFarmacia(payload).repeated,true);
  const product = f.ledger().products[0];
  assert.equal(product.data.name,'Corrigido'); assert.equal(product.data.supplySource,'site'); assert.ok(product.data.storage);
  assert.equal(product.revision,saved.id);
  assert.equal(JSON.stringify(f.ss.getSheetByName(f.server.FARMACIA_LEDGER_SHEET_).rows[1]),original);
  assert.throws(() => f.server.alterarRegistroFarmacia({...payload,requestId:'action-request-00002'}),/mudou/);
  assert.throws(() => f.server.alterarRegistroFarmacia({...payload,data:{...payload.data,reason:'Outro motivo'}}),/outros dados/);
});

test('edição de produto preserva características omitidas e permite correção explícita com revisão', () => {
  const f=fixture(), data={...f.ledger().products[0].data,productCode:'IMP-001',dosageForm:'Comprimido',strength:'10 mg',route:'Oral'};
  const first=f.server.alterarRegistroFarmacia(f.action('PRODUCT_EDIT',f.product.id,f.product.id,data));
  f.server.alterarRegistroFarmacia(f.action('PRODUCT_EDIT',f.product.id,first.id,{name:'Rótulo autorizado',category:'medicine',presentation:data.presentation,unit:data.unit,control:data.control},'product-edit-omit-0001'));
  let current=f.ledger().products[0];
  for (const key of ['productCode','dosageForm','strength','route']) assert.equal(current.data[key],data[key]);
  const payload=f.action('PRODUCT_EDIT',f.product.id,current.revision,{...current.data,strength:'20 mg',route:''},'product-edit-clear-0001');
  f.server.alterarRegistroFarmacia(payload);
  assert.equal(f.server.alterarRegistroFarmacia(payload).repeated,true);
  current=f.ledger().products[0];
  assert.equal(current.data.strength,'20 mg'); assert.equal(current.data.route,'');
  assert.equal(f.ledger().records[1].data.data.strength,'10 mg');
  assert.throws(()=>f.server.alterarRegistroFarmacia({...payload,requestId:'stale-product-0001'}),/mudou/);
});

test('troca para material revalida campos herdados antes de gravar e aceita limpeza explícita', () => {
  const f=fixture();
  const medicine={...f.ledger().products[0].data,dosageForm:'Comprimido',strength:'10 mg',route:'Oral'};
  const edited=f.server.alterarRegistroFarmacia(f.action('PRODUCT_EDIT',f.product.id,f.product.id,medicine));
  const material={name:medicine.name,presentation:medicine.presentation,category:'material',unit:medicine.unit,control:medicine.control};
  const sheet=f.ledger().sheet, rows=JSON.stringify(sheet.rows), writes=sheet.writes;
  const partial=f.action('PRODUCT_EDIT',f.product.id,edited.id,material,'material-partial-0001');
  assert.throws(()=>f.server.alterarRegistroFarmacia(partial),/campos farmacêuticos/);
  assert.equal(sheet.writes,writes); assert.equal(JSON.stringify(sheet.rows),rows);
  assert.equal(f.ledger().products[0].data.category,'medicine');
  const explicit=f.action('PRODUCT_EDIT',f.product.id,edited.id,{...material,dosageForm:'',strength:'',route:''},'material-explicit-0001');
  f.server.alterarRegistroFarmacia(explicit);
  assert.equal(f.server.alterarRegistroFarmacia(explicit).repeated,true);
  const current=f.ledger().products[0].data;
  assert.equal(current.category,'material');
  for (const key of ['dosageForm','strength','route']) assert.equal(current[key],'');
  assert.equal(current.supplySource,medicine.supplySource);
  assert.deepEqual(current.storage,medicine.storage);
});

test('produto sem estoque pode ser excluído; histórico impede exclusão e mudança de unidade', () => {
  const f = fixture();
  f.server.alterarRegistroFarmacia(f.action('PRODUCT_DELETE',f.product.id,f.product.id));
  assert.equal(f.ledger().products.length,0); assert.equal(f.ledger().records.length,2);
  const used = fixture(); used.initial();
  assert.throws(() => used.server.alterarRegistroFarmacia(used.action('PRODUCT_DELETE',used.product.id,used.product.id)),/histórico/);
  assert.throws(() => used.server.alterarRegistroFarmacia(used.action('PRODUCT_EDIT',used.product.id,used.product.id,{...used.ledger().products[0].data,unit:'mL'})),/preservar/);
});

test('estoque corrige metadados sem alterar quantidades e exclusão preserva linhas históricas', () => {
  const f = fixture(), initial = f.initial();
  const payload = f.action('INITIAL_EDIT',initial.id,initial.id,{lot:'L2',expiry:'2028-01-31',note:'Correção documental'});
  const saved = f.server.alterarRegistroFarmacia(payload), position = f.ledger().positions[0];
  assert.equal(position.lot,'L2'); assert.equal(position.physical,10); assert.equal(position.revision,saved.id);
  assert.throws(() => f.server.alterarRegistroFarmacia(f.action('INITIAL_EDIT',initial.id,saved.id,{lot:'L2',expiry:'2028-01-31',note:'',physical:0},'action-request-00002')),/quantidades/);
  f.server.alterarRegistroFarmacia(f.action('INITIAL_DELETE',initial.id,saved.id,null,'action-request-00003'));
  assert.equal(f.ledger().positions.length,0); assert.equal(f.ledger().records.length,4);
  assert.equal(f.ledger().records[1].data.lot,'L1');
});

test('ACL é revalidada sob lock e classe/estudo errados nunca gravam', () => {
  const f = fixture(), payload = f.action('PRODUCT_DELETE',f.product.id,f.product.id), sheet = f.ledger().sheet;
  const writes = sheet.writes;
  f.state.onLock = () => { f.state.allowed = false; };
  assert.throws(() => f.server.alterarRegistroFarmacia(payload),/permissão/);
  assert.equal(sheet.writes,writes);
  f.state.onLock = null; f.state.allowed = true;
  assert.throws(() => f.server.alterarRegistroFarmacia({...payload,restricted:true}),/permissão/);
  assert.throws(() => f.server.alterarRegistroFarmacia({...payload,studyId:'P2'}),/permissão/);
  assert.equal(sheet.writes,writes);
});

test('recebimentos e posições movimentadas não podem ser editados/excluídos', () => {
  const f = fixture();
  const ledger = {records:[],products:[],positions:[{id:'X',revision:'R',origin:'receipt'}],movements:[]};
  assert.throws(() => f.server.farmaciaApplyCatalogAction_(ledger,{id:'N',type:'INITIAL_DELETE',data:{entityId:'X',revision:'R'}}),/Recebimentos/);
  ledger.positions[0].origin='initial'; ledger.movements.push({type:'MOVEMENT',data:{positionId:'X'}});
  assert.throws(() => f.server.farmaciaApplyCatalogAction_(ledger,{id:'N',type:'INITIAL_EDIT',data:{entityId:'X',revision:'R',data:{lot:'L'}}}),/movimentações/);
});

test('produto renomeado permite cadastro com nome original sem corromper replay', () => {
  const f = fixture(), data = {...f.ledger().products[0].data,name:'Novo nome'};
  f.server.alterarRegistroFarmacia(f.action('PRODUCT_EDIT',f.product.id,f.product.id,data));
  f.server.cadastrarProdutoFarmacia({studyId:'P1',restricted:false,requestId:'product-request-0002',data:{...data,name:'Produto'}});
  assert.equal(f.ledger().products.length,2);
  assert.throws(() => f.server.alterarRegistroFarmacia(f.action('PRODUCT_EDIT',f.product.id,f.ledger().products[0].revision,{...data,name:'Produto'},'action-request-00002')),/já está cadastrado/);
});

test('correção de validade continua legível após vencimento e ledger adulterado falha fechado', () => {
  const f = fixture(), initial = f.initial();
  f.server.alterarRegistroFarmacia(f.action('INITIAL_EDIT',initial.id,initial.id,{lot:'L2',expiry:'2027-01-31',note:''}));
  f.server.farmaciaToday_ = () => '2028-01-01';
  assert.equal(f.ledger().positions[0].expiry,'2027-01-31');
  const sheet=f.ledger().sheet, data=JSON.parse(sheet.rows[3][7]);
  data.revision='revision-adulterada'; sheet.rows[3][7]=JSON.stringify(data);
  const writes=sheet.writes;
  assert.throws(() => f.ledger(),/inconsistentes/);
  assert.equal(sheet.writes,writes);
});
