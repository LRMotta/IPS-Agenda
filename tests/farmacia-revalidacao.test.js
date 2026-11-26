'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

// Estoque de estudo com produto do patrocinador: 140 unidades liberadas e parte já dispensada.
function fixture() {
  const app = new FakeSpreadsheet({ Participantes: new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto'], ['CAD-1', 'Nome', '', '', 'EST-014', 'Estudo A']]) });
  const state = { today:'2026-10-26', permission:'manage', uuid:0 };
  const server = runFiles(['FarmaciaEstoque.gs', 'FarmaciaLocais.gs', 'FarmaciaCatalogActions.gs', 'FarmaciaCiclo.gs', 'FarmaciaRevalidacao.gs'], {
    FARMACIA_COMMON_SCOPE_:'@IPS_COMMON',
    Utilities:{ getUuid:() => String(++state.uuid) },
    getCodexSpreadsheet_:() => app,
    codexFarmaciaStudyCatalog_:() => [{ id:'P1', nome:'Estudo A' }],
    codexAssertFarmaciaAccess_:(permission, studyId) => {
      const levels = ['none', 'read', 'operate', 'manage'];
      if (studyId !== 'P1' || levels.indexOf(state.permission) < Math.max(1, levels.indexOf(permission))) throw new Error('Sem permissão');
      return { userEmail:'farm@example.invalid', farmaciaAccess:state.permission, role:'user', farmaciaStudy:{ id:'P1', nome:'Estudo A' } };
    },
    codexAssertFarmaciaCommonAccess_:() => { throw new Error('Sem permissão'); },
    codexWithDocumentLock_:(name, fn) => fn()
  });
  server.farmaciaToday_ = () => state.today;
  server.farmaciaRegisteredDay_ = () => state.today;
  server.farmaciaReadLocations_ = () => ({ configured:true, units:[{ id:'UNIT-1', code:'IPS RB-04', positions:['Gaveta 1', 'Gaveta 2'], min:15, max:25, status:'active' }] });
  const scope = { studyId:'P1', restricted:false };
  const product = server.cadastrarProdutoFarmacia({ ...scope, requestId:'product-request-0001', data:{ category:'medicine', name:'Produto A', presentation:'Frasco', unit:'frasco', control:'quantity', supplySource:'sponsor', storage:{ min:15, max:25, instructions:'' } } }).id;
  const initial = (lot, position, requestId) => server.registrarInventarioInicialFarmacia({ ...scope, requestId, data:{ productId:product, lot, expiry:'2026-12-31', location:'Catálogo', locationRef:{ unitId:'UNIT-1', position }, kit:'', physical:140, blocked:0, countedOn:'2026-10-12', confirmed:true, note:'' } }).id;
  const stock = () => server.getFarmaciaEstoque('P1', false);
  const find = id => stock().positions.find(item => item.id === id);
  const original = initial('L1', 'Gaveta 1', 'initial-request-0001');
  server.registrarMovimentacaoFarmacia({ ...scope, requestId:'movement-request-0001', data:{ positionId:original, revision:find(original).revision, action:'release', from:'pending', quantity:130, reason:'Conferência', document:'CONF-1' } });
  server.registrarCicloFarmacia({ ...scope, requestId:'dispense-request-0001', data:{ action:'dispense', positionId:original, revision:find(original).revision, occurredOn:'2026-10-26', document:'DOC-1', reason:'', quantity:30, participantId:'CAD-1', visit:'C1D1', prescription:'PRESC-1', platformReference:'IRT-1', validThrough:'2026-11-05', confirmed:true } });
  let seq = 0;
  const revalidate = (data = {}, requestId) => server.registrarRevalidacaoFarmacia({ ...scope, requestId:requestId || 'revalidation-request-' + String(++seq).padStart(4, '0'),
    data:{ positionId:original, revision:find(original).revision, lot:'L1', expiry:'2027-06-30', occurredOn:'2026-10-26', reason:'Extensão de validade', document:'Carta do patrocinador 20/10/2026', ...data } });
  const sheet = () => app.getSheetByName(server.farmaciaLedgerSheetName_('P1'));
  return { server, state, scope, product, original, initial, stock, find, revalidate, sheet };
}

test('revalidação leva só o saldo restante à nova validade e preserva a validade do que já foi dispensado', () => {
  const f = fixture();
  const before = f.find(f.original);
  assert.deepEqual([before.physical, before.available, before.pending], [110, 100, 10]);
  const result = f.revalidate();
  const revision = before.revision;
  const old = f.find(f.original), next = f.find(result.id);
  assert.deepEqual([old.physical, old.available, old.pending, old.blocked, old.expiry], [0, 0, 0, 0, '2026-12-31']);
  assert.equal(old.revalidatedTo, result.id);
  assert.deepEqual([next.physical, next.available, next.pending, next.blocked], [110, 100, 10, 0]);
  assert.deepEqual([next.lot, next.expiry, next.location, next.origin], ['L1', '2027-06-30', 'IPS RB-04 → Gaveta 1', 'revalidation']);
  assert.deepEqual([next.sourcePositionId, next.originalPositionId, next.previousExpiry], [f.original, f.original, '2026-12-31']);
  const dispense = f.stock().movements.find(item => item.type === 'LIFECYCLE');
  assert.equal(dispense.data.positionId, f.original);
  const record = f.stock().movements.find(item => item.type === 'REVALIDATION');
  assert.equal(record.id, result.id); assert.equal(record.author, 'farm@example.invalid');
  // Retentativa com o mesmo identificador não duplica; com outros dados é recusada.
  const writes = f.sheet().writes;
  assert.equal(f.revalidate({ revision }, 'revalidation-request-0001').repeated, true);
  assert.throws(() => f.revalidate({ revision, expiry:'2027-07-31' }, 'revalidation-request-0001'), /outros dados/);
  assert.equal(f.sheet().writes, writes);
  // A nova entrada continua o ciclo normalmente.
  f.server.registrarCicloFarmacia({ ...f.scope, requestId:'dispense-request-0002', data:{ action:'dispense', positionId:result.id, revision:next.revision, occurredOn:'2026-10-26', document:'DOC-2', reason:'', quantity:10, participantId:'CAD-1', visit:'C2D1', prescription:'PRESC-2', platformReference:'IRT-2', validThrough:'2026-11-05', confirmed:true } });
  assert.equal(f.find(result.id).available, 90);
});

test('material vencido revalidado volta a ser exibido com a partição registrada', () => {
  const f = fixture();
  f.state.today = '2027-01-10';
  assert.equal(f.find(f.original).expired, true); assert.equal(f.find(f.original).available, 0);
  const result = f.revalidate({ occurredOn:'2027-01-10' });
  const next = f.find(result.id);
  assert.equal(next.expired, false); assert.equal(next.available, 100); assert.equal(next.pending, 10);
});

test('revalidação valida validade, data, revisão, saldo, documento e lote sem gravar', () => {
  const f = fixture(), writes = f.sheet().writes;
  for (const [data, pattern] of [[{ expiry:'2026-12-31' }, /posterior à validade atual/], [{ expiry:'2026-11-30' }, /posterior à validade atual/],
    [{ occurredOn:'2026-10-27' }, /futura/], [{ occurredOn:'2026-10-01' }, /anterior à entrada/], [{ revision:'obsoleta' }, /saldo mudou/],
    [{ document:'' }, /documento/], [{ reason:'' }, /motivo/], [{ lot:'' }, /lote/], [{ expiry:'2026-02-30' }, /validade/]]) {
    assert.throws(() => f.revalidate(data), pattern);
  }
  f.state.today = '2028-01-10';
  assert.throws(() => f.revalidate({ occurredOn:'2028-01-10', expiry:'2027-06-30' }), /já passou/);
  f.state.today = '2026-10-26';
  f.state.permission = 'operate';
  assert.throws(() => f.revalidate(), /permissão/);
  assert.equal(f.sheet().writes, writes);
});

test('novo lote não pode somar saldo com outra entrada ativa no mesmo local; entrada zerada não é revalidada de novo', () => {
  const f = fixture();
  f.initial('L2', 'Gaveta 1', 'initial-request-0002');
  assert.throws(() => f.revalidate({ lot:'L2' }), /Já existe saldo/);
  const result = f.revalidate({ lot:'L1-R' });
  assert.equal(f.find(result.id).lot, 'L1-R');
  assert.throws(() => f.revalidate(), /não tem saldo/);
});

test('entradas revalidadas não aceitam correção nem exclusão de inventário', () => {
  const f = fixture();
  // Sem movimentações anteriores: a revalidação basta para bloquear a correção da entrada original.
  const fresh = f.initial('L3', 'Gaveta 2', 'initial-request-0003');
  const result = f.revalidate({ positionId:fresh, revision:f.find(fresh).revision });
  const action = (entityId, revision, type, requestId) => f.server.alterarRegistroFarmacia({ ...f.scope, requestId, type,
    data:{ entityId, revision, reason:'Correção', ...(type === 'INITIAL_EDIT' ? { data:{ lot:'L9', expiry:'2027-08-31', note:'' } } : {}) } });
  assert.throws(() => action(fresh, f.find(fresh).revision, 'INITIAL_EDIT', 'catalog-request-0001'), /movimentações preservam/);
  assert.throws(() => action(fresh, f.find(fresh).revision, 'INITIAL_DELETE', 'catalog-request-0002'), /movimentações preservam/);
  assert.throws(() => action(result.id, result.id, 'INITIAL_EDIT', 'catalog-request-0003'), /revalidação preservam/);
});

test('replay recusa revalidação adulterada', () => {
  const f = fixture();
  f.revalidate();
  const sheet = f.sheet(), row = sheet.rows.find(item => item[1] === 'REVALIDATION');
  const data = JSON.parse(row[7]); data.expiry = '2026-11-01'; row[7] = JSON.stringify(data);
  assert.throws(() => f.stock(), /inconsistentes/);
});

test('material sem validade não é revalidado', () => {
  const f = fixture();
  const material = f.server.cadastrarProdutoFarmacia({ ...f.scope, requestId:'material-product-0001', data:{ category:'material', materialUse:'loan', name:'Mochila', presentation:'1 mochila', unit:'unidade', control:'quantity', supplySource:'sponsor', storage:{ min:2, max:8, instructions:'' } } }).id;
  const id = f.server.registrarInventarioInicialFarmacia({ ...f.scope, requestId:'material-initial-0001', data:{ productId:material, lot:'', expiry:'', location:'Catálogo', locationRef:{ unitId:'UNIT-1', position:'Gaveta 2' }, kit:'', physical:1, blocked:0, countedOn:'2026-10-12', confirmed:true, note:'' } }).id;
  assert.throws(() => f.revalidate({ positionId:id, revision:f.find(id).revision, lot:'X' }), /sem validade/);
});
