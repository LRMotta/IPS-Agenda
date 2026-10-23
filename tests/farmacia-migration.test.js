'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {runFiles} = require('./helpers/load-app-script');
const {FakeSpreadsheet,FakeSheet} = require('./helpers/fake-spreadsheet');
const {fakeDocumentLock} = require('./helpers/fake-document-lock');

function fixture() {
  const main=new FakeSpreadsheet({}), external=new FakeSpreadsheet({}), lock=fakeDocumentLock();
  main.getId=()=> 'principal-00000000000000001';
  const source='farmacia-standard-0000000001';
  const state={raw:'',opened:[],allowed:true,uuid:0,failProperty:false,sources:{[source]:external}};
  const server=runFiles(['WebApp.gs','FarmaciaEstoque.gs','FarmaciaLocais.gs','FarmaciaCatalogActions.gs','FarmaciaMigracao.gs'],{
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>state.raw,setProperty:(key,value)=>{if(state.failProperty)throw new Error('Falha na propriedade');state.raw=value;}})},
    SpreadsheetApp:{openById:id=>{state.opened.push(id);if(!state.sources[id])throw new Error('Arquivo inacessível');return state.sources[id];}},
    Utilities:{getUuid:()=> 'migration-'+(++state.uuid)}, LockService:lock.LockService
  });
  server.getCodexSpreadsheet_=()=>main;
  server.codexAssertAdmin_=()=>{if(!state.allowed)throw new Error('Somente administradores');return {role:'admin'};};
  server.codexAssertFarmaciaAccess_=()=>({userEmail:'test@example.invalid',farmaciaAccess:'manage',role:'user',farmaciaStudy:{id:'P1'},farmaciaRestricted:false});
  server.farmaciaToday_=()=> '2026-10-23';
  const product=server.cadastrarProdutoFarmacia({studyId:'P1',restricted:false,requestId:'migration-product-0001',data:{name:'Produto',presentation:'Frasco',category:'medicine',unit:'frasco',control:'quantity',supplySource:'site',storage:{min:null,max:null,instructions:'Conservar'}}});
  external.sheets[server.FARMACIA_LEDGER_SHEET_]=new FakeSheet(server.FARMACIA_LEDGER_SHEET_,main.getSheetByName(server.FARMACIA_LEDGER_SHEET_).rows);
  delete main.sheets[server.FARMACIA_LEDGER_SHEET_];
  state.raw=JSON.stringify({version:1,studies:[{studyId:'P1',standard:source}]});
  return {server,main,external,state,lock:lock.state,source,product};
}

test('migração exige Admin, prévia atual e lock; copia histórico intacto e passa a ler só o principal',()=>{
  const f=fixture(), name=f.server.FARMACIA_LEDGER_SHEET_;
  assert.throws(()=>f.server.getFarmaciaEstoque('P1',false),/Migração.*pendente/);
  assert.deepEqual(f.state.opened,[]);
  const original=JSON.stringify(f.external.getSheetByName(name).rows);
  f.state.allowed=false;
  assert.throws(()=>f.server.getFarmaciaMigracaoPreview(),/administradores/);
  assert.deepEqual(f.state.opened,[]);
  f.state.allowed=true;
  const preview=f.server.getFarmaciaMigracaoPreview();
  assert.equal(preview.ledgerRowsToImport,1);
  assert.equal(f.main.getSheetByName(name),null);
  assert.throws(()=>f.server.migrarFarmaciaParaArquivoPrincipal({fingerprint:'antigo',confirm:true}),/prévia/);
  assert.equal(f.main.getSheetByName(name),null);
  const result=f.server.migrarFarmaciaParaArquivoPrincipal({...preview,confirm:true});
  assert.equal(result.ledgerRowsImported,1);
  assert.equal(JSON.stringify(f.main.getSheetByName(name).rows),original);
  assert.equal(JSON.stringify(f.external.getSheetByName(name).rows),original);
  assert.equal(JSON.parse(f.state.raw).version,2);
  f.state.opened=[];
  assert.equal(f.server.getFarmaciaEstoque('P1',false).products[0].id,f.product.id);
  assert.deepEqual(f.state.opened,[]);
  const writes=f.main.getSheetByName(name).writes;
  f.server.migrarFarmaciaParaArquivoPrincipal({...f.server.getFarmaciaMigracaoPreview(),confirm:true});
  assert.equal(f.main.getSheetByName(name).writes,writes);
  assert.equal(f.lock.held,false);
});

test('migração preserva e lê produtos e correções gravados no formato anterior',()=>{
  const f=fixture(), name=f.server.FARMACIA_LEDGER_SHEET_;
  const sheet=f.external.getSheetByName(name), productRow=sheet.rows[1];
  const current=JSON.parse(productRow[7]);
  const legacy={name:current.name,presentation:current.presentation,unit:current.unit,control:current.control,
    dosageForm:'Comprimido',strength:'10 mg',route:'Oral',
    storage:{...current.storage,source:'Rótulo legado',version:'1'},supplySource:current.supplySource};
  productRow[7]=JSON.stringify(legacy);
  const edit=f.server.farmaciaCatalogActionData_('PRODUCT_EDIT',{entityId:productRow[0],revision:productRow[0],reason:'Correção antiga',data:{...legacy,name:'Produto legado corrigido'}});
  sheet.rows.push(['FCA-legacy-edit-0001','PRODUCT_EDIT',JSON.stringify('P1'),false,'legacy-edit-0001',
    JSON.stringify('2026-10-23T12:01:00.000Z'),JSON.stringify('test@example.invalid'),JSON.stringify(edit)]);

  assert.equal(JSON.stringify(f.server.farmaciaProductData_(legacy,true)),JSON.stringify(legacy));
  assert.equal(JSON.stringify(f.server.farmaciaCatalogActionData_('PRODUCT_EDIT',edit)),JSON.stringify(edit));
  assert.doesNotThrow(()=>f.server.farmaciaParseLedgerRows_({studyId:'P1',restricted:false},null,[sheet.rows[0],productRow]));

  f.state.raw=JSON.stringify({version:1,studies:[{studyId:'P1',standard:f.source}]});
  const preview=f.server.getFarmaciaMigracaoPreview();
  assert.equal(preview.ledgerRowsToImport,2);
  f.server.migrarFarmaciaParaArquivoPrincipal({...preview,confirm:true});
  const product=f.server.getFarmaciaEstoque('P1',false).products[0];
  assert.equal(product.name,'Produto legado corrigido');
  assert.equal(Object.hasOwn(product,'category'),false);
  assert.equal(Object.hasOwn(product,'barcode'),false);
  assert.equal(product.dosageForm,'Comprimido');
  assert.equal(product.storage.source,'Rótulo legado');
  assert.equal(product.storage.version,'1');
});

test('revogação administrativa sob lock e alterações após prévia impedem migração antes da primeira escrita',()=>{
  const f=fixture(), preview=f.server.getFarmaciaMigracaoPreview();
  f.lock.onAcquire=()=>{f.state.allowed=false;};
  assert.throws(()=>f.server.migrarFarmaciaParaArquivoPrincipal({...preview,confirm:true}),/administradores/);
  assert.equal(f.main.getSheets().length,0);
  f.state.allowed=true;f.lock.onAcquire=null;
  const row=f.external.getSheetByName(f.server.FARMACIA_LEDGER_SHEET_).rows[1];
  const data=JSON.parse(row[7]);data.name='Atualizado';row[7]=JSON.stringify(data);
  assert.throws(()=>f.server.migrarFarmaciaParaArquivoPrincipal({...preview,confirm:true}),/prévia/);
  assert.equal(f.main.getSheets().length,0);
});

test('preflight recusa arquivo inacessível, schema divergente, contexto errado e colisões sem gravar',()=>{
  for(const kind of ['inaccessible','schema','scope','collision','request','duplicate-source']) {
    const f=fixture(),name=f.server.FARMACIA_LEDGER_SHEET_,sheet=f.external.getSheetByName(name);
    if(kind==='inaccessible')f.state.raw=JSON.stringify({version:1,studies:[{studyId:'P1',standard:'missing-file-000000000000001'}]});
    if(kind==='schema')sheet.rows[0][0]='Outro';
    if(kind==='scope')sheet.rows[1][2]='"P2"';
    if(kind==='collision'||kind==='request') {
      const rows=sheet.rows.map(row=>row.slice());
      const data=JSON.parse(rows[1][7]);data.name='Divergente';rows[1][7]=JSON.stringify(data);
      if(kind==='request')rows[1][0]='FPR-another-id';
      f.main.sheets[name]=new FakeSheet(name,rows);
    }
    if(kind==='duplicate-source')sheet.rows.push(sheet.rows[1].slice());
    const before=JSON.stringify(f.main.getSheets().map(item=>item.rows));
    assert.throws(()=>f.server.getFarmaciaMigracaoPreview());
    assert.equal(JSON.stringify(f.main.getSheets().map(item=>item.rows)),before);
    assert.equal(f.main.getSheets().reduce((sum,item)=>sum+item.writes,0),0);
    assert.equal(JSON.parse(f.state.raw).version,1);
  }
});

test('falha após gravar dados permite retomar sem duplicar nem reescrever origens',()=>{
  const f=fixture(),preview=f.server.getFarmaciaMigracaoPreview(),name=f.server.FARMACIA_LEDGER_SHEET_;
  f.state.failProperty=true;
  assert.throws(()=>f.server.migrarFarmaciaParaArquivoPrincipal({...preview,confirm:true}),/Falha na propriedade/);
  assert.equal(JSON.parse(f.state.raw).version,1);
  const writes=f.main.getSheetByName(name).writes;
  f.state.failProperty=false;
  const next=f.server.getFarmaciaMigracaoPreview();
  assert.equal(next.ledgerRowsToImport,0);
  f.server.migrarFarmaciaParaArquivoPrincipal({...next,confirm:true});
  assert.equal(f.main.getSheetByName(name).writes,writes);
  assert.equal(f.external.getSheetByName(name).writes,0);
});

test('catálogo físico dedicado migra preservando o catálogo já existente no principal',()=>{
  const f=fixture(),name=f.server.FARMACIA_LOCATIONS_SHEET_;
  const unit=['FLR-unit-1','UNIT','migration-location-0001',JSON.stringify('2026-10-23T12:00:00.000Z'),JSON.stringify('test@example.invalid'),JSON.stringify({code:'ARM-1',type:'cabinet',model:'',room:'Sala',min:null,max:null,sensor:'',status:'active',positions:['P1']})];
  f.external.sheets={ [name]:new FakeSheet(name,[Array.from(f.server.FARMACIA_LOCATIONS_HEADERS_),unit]) };
  f.main.sheets[name]=new FakeSheet(name,[Array.from(f.server.FARMACIA_LOCATIONS_HEADERS_),unit]);
  f.state.raw=JSON.stringify({version:1,locations:f.source,studies:[]});
  const preview=f.server.getFarmaciaMigracaoPreview();
  assert.equal(preview.locationRows,1);assert.equal(preview.locationRowsToImport,0);
  f.server.migrarFarmaciaParaArquivoPrincipal({...preview,confirm:true});
  assert.equal(f.main.getSheetByName(name).writes,0);
  assert.equal(f.server.farmaciaReadLocations_().units[0].code,'ARM-1');
});

test('falha entre escrita de estoque e catálogo retoma o restante sem duplicar o ledger',()=>{
  const f=fixture(),name=f.server.FARMACIA_LOCATIONS_SHEET_,file='farmacia-locations-0000000001';
  const unit=['FLR-unit-1','UNIT','migration-location-0001',JSON.stringify('2026-10-23T12:00:00.000Z'),JSON.stringify('test@example.invalid'),JSON.stringify({code:'ARM-1',type:'cabinet',model:'',room:'Sala',min:null,max:null,sensor:'',status:'active',positions:['P1']})];
  f.state.sources[file]=new FakeSpreadsheet({[name]:new FakeSheet(name,[Array.from(f.server.FARMACIA_LOCATIONS_HEADERS_),unit])});
  f.state.raw=JSON.stringify({version:1,locations:file,studies:[{studyId:'P1',standard:f.source}]});
  const preview=f.server.getFarmaciaMigracaoPreview(),insert=f.main.insertSheet.bind(f.main);
  f.main.insertSheet=sheetName=>{if(sheetName===name)throw new Error('Falha ao criar catálogo');return insert(sheetName);};
  assert.throws(()=>f.server.migrarFarmaciaParaArquivoPrincipal({...preview,confirm:true}),/Falha ao criar/);
  assert.equal(JSON.parse(f.state.raw).version,1);
  const ledger=f.main.getSheetByName(f.server.FARMACIA_LEDGER_SHEET_),writes=ledger.writes;
  f.main.insertSheet=insert;
  const next=f.server.getFarmaciaMigracaoPreview();
  assert.equal(next.ledgerRowsToImport,0);assert.equal(next.locationRowsToImport,1);
  f.server.migrarFarmaciaParaArquivoPrincipal({...next,confirm:true});
  assert.equal(ledger.writes,writes);
  assert.equal(f.server.getFarmaciaEstoque('P1',false).storageUnits[0].id,'FLR-unit-1');
  assert.equal(JSON.parse(f.state.raw).version,2);
});
