// Saída / ajuste de quantidade do estoque Geral (Farmácia): o ledger permanece append-only.
// Consumo e perda retiram quantidade; recontagem informa o novo saldo contado da situação escolhida.
var FARMACIA_ADJUSTMENT_KINDS_ = ['consumption', 'loss', 'recount'];

function farmaciaAdjustmentData_(value) {
  value = value || {};
  if (FARMACIA_ADJUSTMENT_KINDS_.indexOf(value.kind) === -1) throw new Error('Selecione o motivo do ajuste: consumo, perda ou recontagem.');
  if (['available', 'blocked'].indexOf(value.from) === -1 || (value.kind === 'consumption' && value.from !== 'available')) {
    throw new Error('Selecione a situação do saldo ajustado. Consumo sai somente do saldo disponível.');
  }
  var result = { positionId: farmaciaText_(value.positionId, 'o registro de estoque', 100),
    revision: farmaciaText_(value.revision, 'a revisão do saldo', 100), kind: value.kind, from: value.from,
    quantity: farmaciaQuantity_(value.quantity, true),
    occurredOn: farmaciaDate_(value.occurredOn, 'a data do ajuste'),
    responsible: farmaciaText_(value.responsible, 'o responsável', 120),
    reason: farmaciaText_(value.reason, 'a justificativa do ajuste', 500),
    document: farmaciaText_(value.document, 'a referência documental', 200, true) };
  if (value.kind !== 'recount' && !result.quantity) throw new Error('A quantidade deve ser positiva.');
  return result;
}

// Determinístico no replay: depende apenas do registro e do estado anterior da posição.
function farmaciaApplyAdjustment_(ledger, record) {
  var data = record.data;
  var position = ledger.positions.find(function(item) { return item.id === data.positionId; });
  var product = position && ledger.products.find(function(item) { return item.id === position.productId; });
  if (!position || !product || product.data.supplySource === 'sponsor') throw new Error('Ajustes são exclusivos de entradas do estoque Geral.');
  if (data.revision !== position.revision) throw new Error('O saldo mudou. Atualize o estoque antes de ajustar.');
  if (position.transportReserved) throw new Error('Conclua o transporte em andamento antes de ajustar esta entrada.');
  if (data.occurredOn < (position.countedOn || position.receivedOn || '')) throw new Error('A data do ajuste não pode ser anterior à entrada do lote.');
  var quantity = farmaciaQuantity_(data.quantity, ['mL', 'g'].indexOf(product.data.unit) !== -1);
  if (position.expiry < data.occurredOn) {
    // Após a validade todo o saldo já é exibido como bloqueado; o ajuste parte desse mesmo estado.
    if (data.kind === 'consumption') throw new Error('Material vencido não pode ser registrado como consumo.');
    position.blocked = Math.round((position.blocked + position.available) * 1000) / 1000;
    position.available = 0;
  }
  var current = position[data.from] || 0;
  var delta = data.kind === 'recount' ? Math.round((quantity - current) * 1000) / 1000 : -quantity;
  if (data.kind === 'recount' && !delta) throw new Error('A recontagem confere com o saldo registrado. Nenhum ajuste é necessário.');
  if (current + delta < 0) throw new Error('A quantidade excede o saldo na situação selecionada.');
  position[data.from] = Math.round((current + delta) * 1000) / 1000;
  position.physical = Math.round((position.physical + delta) * 1000) / 1000;
  position.revision = record.id;
  record.adjustmentDelta = delta;
  ledger.movements.push(record);
}

function registrarAjusteFarmacia(payload) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-adjustment', function() {
    // Autorização fresca dentro da seção protegida: ajuste de saldo é ação do Responsável pela Farmácia.
    var context = farmaciaContext_(payload.studyId, payload.restricted, 'manage');
    if (context.studyId !== FARMACIA_COMMON_SCOPE_) throw new Error('Saída / ajuste de quantidade é exclusivo do estoque Geral (Farmácia).');
    if (!context.ss) throw new Error('Armazenamento deste estoque ainda não configurado.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    farmaciaAssertRequestId_(requestId);
    var data = farmaciaAdjustmentData_(payload.data);
    var dataJson = JSON.stringify(data);
    var ledger = farmaciaReadLedger_(context);
    var previous = ledger.records.find(function(record) { return record.requestId === requestId; });
    if (previous) {
      if (previous.type !== 'ADJUSTMENT' || previous.dataJson !== dataJson) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true };
    }
    if (data.occurredOn > farmaciaToday_()) throw new Error('A data do ajuste não pode ser futura.');
    var position = ledger.positions.find(function(item) { return item.id === data.positionId; });
    if (position && data.kind === 'consumption' && position.expiry < farmaciaToday_()) throw new Error('Material vencido não pode ser registrado como consumo.');
    var record = { id: 'FAJ-' + Utilities.getUuid(), type: 'ADJUSTMENT', data: data };
    if (ledger.records.some(function(item) { return item.id === record.id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
    farmaciaApplyAdjustment_(ledger, record);
    var row = [record.id, 'ADJUSTMENT', JSON.stringify(context.studyId), context.restricted, requestId,
      JSON.stringify(new Date().toISOString()), JSON.stringify(context.access.userEmail), dataJson];
    farmaciaAssertLedgerRowReplayable_(context, ledger, row);
    ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { ok: true, id: record.id, repeated: false };
  });
}
