'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function fixture() {
  const sheet = new FakeSheet('Farmacia_Locais_v1', []);
  const ss = new FakeSpreadsheet({ Farmacia_Locais_v1:sheet });
  const state = { reads:0, uuid:0, allowed:true, logs:[] };
  const original = sheet.getDataRange.bind(sheet);
  sheet.getDataRange = () => { state.reads++; return original(); };
  const server = runFiles(['FarmaciaEstoque.gs', 'FarmaciaLocais.gs'], {
    Utilities:{ getUuid:() => 'perf-' + (++state.uuid) },
    codexWithDocumentLock_:(label, callback) => callback(),
    codexAssertCanWrite_:() => {
      if (!state.allowed) throw new Error('Acesso negado');
      return { role:'admin', userEmail:'admin@example.invalid' };
    },
    codexLogPerformance_:(...args) => state.logs.push(args)
  });
  server.farmaciaStorage_ = () => ss;
  server.farmaciaToday_ = () => '2026-10-22';
  const unit = server.cadastrarLocalFarmacia({ requestId:'performance-unit-0001', data:{
    code:'PERF-01',type:'cabinet',model:'Modelo',room:'Sala',min:null,max:null,source:'',version:'',sensor:'',status:'active',positions:['P1']
  } });
  state.reads = 0;
  const payload = { requestId:'performance-probe-0001', data:{unitId:unit.id,code:'S1',serial:'SER1',model:'Modelo',point:'',
    calibration:{status:'pending',calibratedOn:'',validUntil:'',certificate:'',note:''}} };
  return {server,sheet,state,payload};
}

test('salvar catálogo prepara snapshot autorizado com uma leitura e replay não grava novamente', () => {
  const f = fixture();
  const result = f.server.cadastrarSondaFarmacia(f.payload);
  assert.equal(f.state.reads, 1);
  assert.equal(result.catalog.locationsCanManage, true);
  assert.equal(result.catalog.storageUnits[0].probes[0].id, result.id);
  assert.equal(result.catalog.storageUnits[0].probes[0].calibrationStatus, 'pending');
  assert.deepEqual(Object.keys(result.catalog).sort(), ['locationsCanManage','locationsConfigured','storageUnits']);
  const writes = f.sheet.writes;
  const replay = f.server.cadastrarSondaFarmacia(f.payload);
  assert.equal(replay.repeated, true);
  assert.equal(f.sheet.writes, writes);
  assert.equal(replay.catalog.storageUnits[0].probes.length, 1);
  f.state.allowed = false;
  assert.throws(() => f.server.cadastrarSondaFarmacia(f.payload), /Acesso negado/);
  assert.equal(f.sheet.writes, writes);
  assert.ok(f.state.logs.some(entry => entry[1] === 'read_catalog'));
  assert.ok(f.state.logs.some(entry => entry[1] === 'persist'));
  assert.ok(f.state.logs.some(entry => entry[1] === 'total' && entry[4] === false));
});

test('snapshot da calibração coincide com releitura e mantém revisão atual no replay', () => {
  const f = fixture();
  const probe = f.server.cadastrarSondaFarmacia(f.payload);
  const update = {requestId:'performance-calibration-0001', data:{unitId:f.payload.data.unitId,probeId:probe.id,revision:1,
    calibration:{status:'current',calibratedOn:'2026-10-22',validUntil:'2027-10-22',certificate:'CERT',note:''}}};
  f.state.reads = 0;
  const result = f.server.atualizarCalibracaoSondaFarmacia(update);
  assert.equal(f.state.reads, 1);
  assert.equal(result.catalog.storageUnits[0].probes[0].revision, 2);
  const replay = f.server.cadastrarSondaFarmacia(f.payload);
  assert.equal(replay.catalog.storageUnits[0].probes[0].revision, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.catalog.storageUnits)), JSON.parse(JSON.stringify(f.server.farmaciaReadLocations_().units)));
});

function clientFixture() {
  const pending = [], nodes = new Map();
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, { id, dataset:{}, querySelector:() => ({}), reset() {} });
    return nodes.get(id);
  }
  const runner = new Proxy({}, { get(target, name) {
    if (name === 'withSuccessHandler') return callback => { target.success = callback; return runner; };
    if (name === 'withFailureHandler') return callback => { target.failure = callback; return runner; };
    return (...args) => pending.push({name,args,success:target.success,failure:target.failure});
  } });
  const client = vm.createContext({window:{},google:{script:{run:runner}},document:{getElementById:element,querySelectorAll:() => []},
    getCurrentPage:() => 'farmacia', FARMACIA_VIEW:'probes', farmaciaDialogId:() => 'modal',appSetStatus() {},fecharOverlay() {},
    farmaciaUpdateSummary() {},farmaciaCatalogTable:() => '',farmaciaProductControlChanged() {},farmaciaRestoreFocus() {},renderFarmaciaEstoque() {}});
  vm.runInContext(readProjectFile('IndexFarmaciaScripts.html').replace(/<\/?script>/g,''), client);
  client.renderFarmaciaEstoque = () => {};
  client.farmaciaProductControlChanged = () => {};
  client.farmaciaOperationId = () => 'performance-client-0001';
  client.farmaciaStockRefresh = () => { client.refreshes++; };
  client.refreshes = 0;
  client.FARMACIA_CATALOG.data = {locationsConfigured:true,locationsCanManage:true,storageUnits:[]};
  return {client,pending};
}

test('cliente aplica snapshot sem RPC de recarga, invalida respostas pendentes e aceita servidor antigo', () => {
  const {client,pending} = clientFixture();
  client.carregarFarmaciaCatalogo(true);
  const stale = pending.shift();
  client.FARMACIA_CATALOG.loading = false;
  client.FARMACIA_CATALOG.data = {locationsConfigured:true,locationsCanManage:true,storageUnits:[]};
  client.farmaciaStockSave('calibration', {unitId:'UNIT',probeId:'PROBE'});
  const save = pending.shift();
  const snapshot = {locationsConfigured:true,locationsCanManage:true,storageUnits:[{id:'UPDATED'}]};
  save.success({ok:true,catalog:snapshot});
  assert.equal(client.refreshes, 0);
  assert.equal(pending.length, 0);
  assert.equal(client.FARMACIA_CATALOG.data, snapshot);
  stale.success({locationsConfigured:true,locationsCanManage:false,storageUnits:[]});
  assert.equal(client.FARMACIA_CATALOG.data, snapshot);
  client.farmaciaStockSave('calibration', {unitId:'UNIT',probeId:'PROBE'});
  pending.shift().success({ok:true});
  assert.equal(client.refreshes, 1);
});
