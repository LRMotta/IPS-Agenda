// Revalidação do fornecedor/patrocinador: o saldo restante de uma entrada ganha nova validade (e, se
// reetiquetado, novo lote). O ledger permanece append-only: a entrada original fica com saldo zero e a
// validade antiga, preservando o que já foi dispensado ou transportado; o restante passa a uma nova
// entrada (ID do próprio registro) com a mesma localização e a mesma partição de saldos.
function farmaciaRevalidationData_(value) {
  value = value || {};
  return { positionId: farmaciaText_(value.positionId, 'o registro de estoque', 100),
    revision: farmaciaText_(value.revision, 'a revisão do saldo', 100),
    lot: farmaciaText_(value.lot, 'o lote', 100),
    expiry: farmaciaDate_(value.expiry, 'a nova validade'),
    occurredOn: farmaciaDate_(value.occurredOn, 'a data da revalidação'),
    reason: farmaciaText_(value.reason, 'o motivo da revalidação', 500),
    document: farmaciaText_(value.document, 'o documento da revalidação', 200) };
}

// Determinístico no replay: depende apenas do registro e do estado anterior da posição.
function farmaciaApplyRevalidation_(ledger, record) {
  var data = record.data;
  var position = ledger.positions.find(function(item) { return item.id === data.positionId; });
  if (!position) throw new Error('Registro de estoque não encontrado. Atualize a tabela antes de continuar.');
  if (data.revision !== position.revision) throw new Error('O saldo mudou. Atualize o estoque antes de revalidar.');
  if (position.returned) throw new Error('Produtos retornados pelo participante permanecem em quarentena até a destinação documentada.');
  if (position.transportReserved) throw new Error('Conclua o transporte em andamento antes de revalidar esta entrada.');
  if (!(position.physical > 0)) throw new Error('Esta entrada não tem saldo para revalidar.');
  if (data.occurredOn < (position.countedOn || position.receivedOn || position.occurredOn || '')) throw new Error('A data da revalidação não pode ser anterior à entrada do lote.');
  if (data.expiry <= position.expiry) throw new Error('A nova validade deve ser posterior à validade atual (' + position.expiry + ').');
  if (data.expiry < data.occurredOn) throw new Error('A nova validade não pode ser anterior à data da revalidação.');
  var next = { id: record.id, revision: record.id, productId: position.productId, lot: data.lot, kit: position.kit,
    expiry: data.expiry, location: position.location, physical: position.physical, available: position.available,
    pending: position.pending || 0, blocked: position.blocked, initialBlocked: position.blocked,
    origin: 'revalidation', occurredOn: data.occurredOn, registeredAt: record.registeredAt, author: record.author,
    originalPositionId: position.originalPositionId || position.id, sourcePositionId: position.id,
    previousLot: position.lot, previousExpiry: position.expiry, note: position.note || '' };
  if (position.locationRef) next.locationRef = position.locationRef;
  ['participantId', 'dispenseId'].forEach(function(key) { if (position[key] !== undefined) next[key] = position[key]; });
  // Mesmo lote e local de outra entrada ativa somaria saldos de validades distintas no mesmo cadastro.
  if (data.lot !== position.lot && ledger.positions.some(function(item) {
    return item.id !== position.id && item.physical > 0 && farmaciaSamePosition_(item, next);
  })) throw new Error('Já existe saldo deste produto com o lote informado nesta localização.');
  position.physical = 0; position.available = 0; position.pending = 0; position.blocked = 0;
  position.revision = record.id;
  position.revalidatedTo = record.id;
  ledger.positions.push(next);
  ledger.movements.push(record);
}

function registrarRevalidacaoFarmacia(payload) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-revalidation', function() {
    // Autorização fresca dentro da seção protegida: revalidar é ação do Responsável pela Farmácia.
    var context = farmaciaContext_(payload.studyId, payload.restricted, 'manage');
    if (!context.ss) throw new Error('Armazenamento deste estoque ainda não configurado.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    farmaciaAssertRequestId_(requestId);
    var data = farmaciaRevalidationData_(payload.data);
    var dataJson = JSON.stringify(data);
    var ledger = farmaciaReadLedger_(context);
    var previous = ledger.records.find(function(record) { return record.requestId === requestId; });
    if (previous) {
      if (previous.type !== 'REVALIDATION' || previous.dataJson !== dataJson) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true };
    }
    if (data.occurredOn > farmaciaToday_()) throw new Error('A data da revalidação não pode ser futura.');
    if (data.expiry < farmaciaToday_()) throw new Error('A nova validade já passou. Confira o documento da revalidação.');
    var record = { id: 'FRV-' + Utilities.getUuid(), type: 'REVALIDATION', data: data };
    if (ledger.records.some(function(item) { return item.id === record.id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
    farmaciaApplyRevalidation_(ledger, record);
    var row = [record.id, 'REVALIDATION', JSON.stringify(context.studyId), context.restricted, requestId,
      JSON.stringify(new Date().toISOString()), JSON.stringify(context.access.userEmail), dataJson];
    farmaciaAssertLedgerRowReplayable_(context, ledger, row);
    ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { ok: true, id: record.id, repeated: false };
  });
}
