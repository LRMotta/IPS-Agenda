'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {runFiles} = require('./helpers/load-app-script');
const {FakeSpreadsheet} = require('./helpers/fake-spreadsheet');

const COMMON = '@IPS_COMMON';

function fixture() {
  const ss = new FakeSpreadsheet({}), state = {uuid:0, today:'2026-11-10', access:'manage'};
  const server = runFiles(['FarmaciaEstoque.gs', 'FarmaciaLocais.gs', 'FarmaciaCatalogActions.gs', 'FarmaciaAjustes.gs'], {
    Utilities:{getUuid:() => 'test-' + (++state.uuid)}, FARMACIA_COMMON_SCOPE_:COMMON
  });
  server.farmaciaToday_ = () => state.today;
  server.codexWithDocumentLock_ = (name, fn) => fn();
  const contexts = {};
  server.farmaciaContext_ = (studyId, restricted, permission) => {
    if (restricted !== false) throw new Error('Sem permissão');
    if (permission === 'manage' && state.access !== 'manage') throw new Error('Seu usuário não tem permissão para esta ação no estoque comum da Farmácia.');
    contexts[studyId] = contexts[studyId] || {ss, studyId, restricted:false, access:{userEmail:'farm@example.invalid', farmaciaAccess:state.access}};
    return contexts[studyId];
  };
  server.farmaciaReadLocations_ = () => ({units:[{id:'U1',code:'Armário',positions:['A','B']}]});
  const productData = {name:'Cavilon',presentation:'Spray 28 mL',category:'medicine',dosageForm:'Spray',unit:'frasco',control:'quantity',supplySource:'site',storage:{min:null,max:null,instructions:'Temperatura ambiente'}};
  const product = server.cadastrarProdutoFarmacia({studyId:COMMON,restricted:false,requestId:'product-request-0001',data:productData});
  const initial = server.registrarInventarioInicialFarmacia({studyId:COMMON,restricted:false,requestId:'initial-request-0001',data:{productId:product.id,lot:'L1',expiry:'2027-01-31',location:'Catálogo',locationRef:{unitId:'U1',position:'A'},kit:'',physical:10,blocked:2,countedOn:'2026-11-01',confirmed:true,note:''}});
  const ledger = () => server.farmaciaReadLedger_(contexts[COMMON]);
  const position = () => server.getFarmaciaEstoque(COMMON, false).positions.find(item => item.id === initial.id);
  let seq = 0;
  const adjust = (data, requestId) => server.registrarAjusteFarmacia({studyId:COMMON,restricted:false,requestId:requestId || 'adjust-request-' + String(++seq).padStart(4, '0'),
    data:{positionId:initial.id,revision:position().revision,kind:'consumption',from:'available',quantity:3,occurredOn:'2026-11-10',responsible:'Letícia',reason:'Uso em procedimento',document:'',...data}});
  return {server,state,ss,product,initial,ledger,position,adjust};
}

test('consumo, perda e recontagem alteram o saldo e preservam o histórico append-only', () => {
  const f = fixture();
  const rowsBefore = f.ledger().rows.length;
  f.adjust({});
  assert.deepEqual([f.position().physical, f.position().available, f.position().blocked], [7, 5, 2]);
  f.adjust({kind:'loss', from:'blocked', quantity:1, reason:'Frasco danificado'});
  assert.deepEqual([f.position().physical, f.position().available, f.position().blocked], [6, 5, 1]);
  f.adjust({kind:'recount', from:'available', quantity:8, reason:'Contagem mensal'});
  assert.deepEqual([f.position().physical, f.position().available, f.position().blocked], [9, 8, 1]);
  f.adjust({kind:'recount', from:'available', quantity:0, reason:'Contagem: nada encontrado'});
  assert.deepEqual([f.position().physical, f.position().available, f.position().blocked], [1, 0, 1]);
  const ledger = f.ledger();
  assert.equal(ledger.rows.length, rowsBefore + 4);
  assert.ok(ledger.records.some(item => item.type === 'INITIAL' && item.data.physical === 10), 'contagem inicial permanece intacta');
  const events = f.server.getFarmaciaEstoque(COMMON, false).movements.filter(item => item.type === 'ADJUSTMENT');
  assert.deepEqual(Array.from(events, item => item.adjustmentDelta), [-3, -1, 3, -8]);
  assert.deepEqual(Array.from(events, item => item.data.responsible), ['Letícia', 'Letícia', 'Letícia', 'Letícia']);
  assert.ok(events.every(item => item.author === 'farm@example.invalid' && /^FAJ-/.test(item.id)));
});

test('repetição com o mesmo identificador não duplica o ajuste e outros dados são recusados', () => {
  const f = fixture();
  const payload = {studyId:COMMON,restricted:false,requestId:'adjust-repeat-0001',data:{positionId:f.initial.id,revision:f.initial.id,kind:'consumption',from:'available',quantity:2,occurredOn:'2026-11-10',responsible:'Letícia',reason:'Uso',document:''}};
  const first = f.server.registrarAjusteFarmacia(payload);
  assert.equal(f.server.registrarAjusteFarmacia(payload).repeated, true);
  assert.equal(f.server.registrarAjusteFarmacia(payload).id, first.id);
  assert.equal(f.position().physical, 8);
  assert.throws(() => f.server.registrarAjusteFarmacia({...payload,data:{...payload.data,quantity:1}}), /outros dados/);
});

test('ajustes inválidos falham antes de qualquer escrita', () => {
  const f = fixture();
  const sheet = f.ledger().sheet, writes = sheet.writes;
  assert.throws(() => f.adjust({quantity:9}), /excede/);
  assert.throws(() => f.adjust({kind:'consumption', from:'blocked', quantity:1}), /Consumo sai somente/);
  assert.throws(() => f.adjust({quantity:0}), /positiva/);
  assert.throws(() => f.adjust({kind:'recount', quantity:8}), /confere/);
  assert.throws(() => f.adjust({kind:'shrink'}), /consumo, perda ou recontagem/);
  assert.throws(() => f.adjust({occurredOn:'2026-11-11'}), /futura/);
  assert.throws(() => f.adjust({occurredOn:'2026-10-31'}), /anterior à entrada/);
  assert.throws(() => f.adjust({responsible:''}), /responsável/);
  assert.throws(() => f.adjust({reason:'  '}), /justificativa/);
  assert.throws(() => f.adjust({quantity:1.5}), /Quantidade inválida/);
  assert.throws(() => f.adjust({revision:'FIN-antiga'}), /validação do histórico|saldo mudou/);
  f.state.access = 'operate';
  assert.throws(() => f.adjust({}), /permissão/);
  assert.equal(sheet.writes, writes);
});

test('revisão antiga é recusada depois de outro ajuste no mesmo lote', () => {
  const f = fixture();
  const stale = f.position().revision;
  f.adjust({});
  assert.throws(() => f.server.registrarAjusteFarmacia({studyId:COMMON,restricted:false,requestId:'adjust-stale-00001',data:{positionId:f.initial.id,revision:stale,kind:'consumption',from:'available',quantity:1,occurredOn:'2026-11-10',responsible:'Letícia',reason:'Uso',document:''}}), /saldo mudou|validação/);
});

test('ajuste é exclusivo do estoque Geral', () => {
  const f = fixture();
  assert.throws(() => f.server.registrarAjusteFarmacia({studyId:'P1',restricted:false,requestId:'adjust-study-00001',data:{}}), /exclusivo do estoque Geral/);
});

test('material vencido não registra consumo; perda e recontagem partem do saldo bloqueado', () => {
  const f = fixture();
  f.state.today = '2027-02-10';
  assert.throws(() => f.adjust({occurredOn:'2027-02-10'}), /vencido/);
  assert.equal(f.position().blocked, 10);
  f.adjust({kind:'loss', from:'blocked', quantity:10, occurredOn:'2027-02-10', reason:'Descarte de vencido'});
  assert.deepEqual([f.position().physical, f.position().available, f.position().blocked], [0, 0, 0]);
});

test('lote com ajuste preserva o inventário: correção e exclusão são recusadas', () => {
  const f = fixture();
  f.adjust({});
  const revision = f.position().revision;
  const action = (type, data) => f.server.alterarRegistroFarmacia({studyId:COMMON,restricted:false,requestId:'catalog-' + type.toLowerCase() + '-0001',type,data:{entityId:f.initial.id,revision,reason:'Correção',...(data ? {data} : {})}});
  assert.throws(() => action('INITIAL_DELETE'), /movimentações preservam/);
  assert.throws(() => action('INITIAL_EDIT', {lot:'L2', expiry:'2027-01-31', note:''}), /movimentações preservam/);
});

test('replay recusa ajuste adulterado ou fora do estoque Geral', () => {
  const f = fixture();
  f.adjust({});
  const sheet = f.ledger().sheet, row = sheet.rows[sheet.rows.length - 1];
  const original = row[7];
  row[7] = JSON.stringify({...JSON.parse(original), quantity:30});
  assert.throws(() => f.ledger(), /inconsistentes/);
  row[7] = original;
  assert.equal(f.position().physical, 7);
});

test('cliente envia o ajuste pelo RPC público e exibe o histórico do ajuste', () => {
  const fs = require('node:fs'), path = require('node:path');
  const scripts = fs.readFileSync(path.join(__dirname, '..', 'IndexFarmaciaScripts.html'), 'utf8');
  const cycle = fs.readFileSync(path.join(__dirname, '..', 'IndexFarmaciaCiclo.html'), 'utf8');
  assert.match(scripts, /runner\.registrarAjusteFarmacia\(payload\)/);
  assert.match(scripts, /type === 'adjustment' && FARMACIA_STOCK\.studyId !== '@IPS_COMMON'/);
  assert.match(cycle, /delta=r\.type==='ADJUSTMENT'\?r\.adjustmentDelta/);
});
