// Correções documentadas: o ledger original permanece append-only.
function farmaciaCatalogActionData_(type, value) {
  value = value || {};
  var result = { entityId: farmaciaText_(value.entityId, 'o registro', 100),
    revision: farmaciaText_(value.revision, 'a revisão do registro', 100),
    reason: farmaciaText_(value.reason, 'o motivo da correção', 500) };
  if (type === 'PRODUCT_EDIT') result.data = farmaciaProductData_(value.data, true);
  else if (type === 'INITIAL_EDIT') {
    var data = value.data || {};
    if (Object.keys(data).some(function(key) { return ['lot', 'expiry', 'note'].indexOf(key) === -1; })) throw new Error('A correção não pode alterar quantidades, produto, kit ou localização.');
    result.data = { lot: farmaciaText_(data.lot, 'o lote', 100), expiry: farmaciaDate_(data.expiry, 'a validade'),
      note: farmaciaText_(data.note, 'a observação', 500, true) };
  } else if (['PRODUCT_DELETE', 'INITIAL_DELETE'].indexOf(type) === -1) throw new Error('Ação de catálogo inválida.');
  return result;
}

function farmaciaApplyCatalogAction_(ledger, record) {
  var data = record.data, productAction = record.type.indexOf('PRODUCT_') === 0;
  var list = productAction ? ledger.products : ledger.positions;
  var index = list.findIndex(function(item) { return item.id === data.entityId; });
  var current = list[index];
  if (!current || data.revision !== (current.revision || current.id)) throw new Error('O registro mudou ou foi excluído. Atualize a tabela antes de continuar.');
  var deleting = record.type.slice(-7) === '_DELETE';
  if (productAction) {
    var used = ledger.records.some(function(item) { return ['INITIAL', 'RECEIPT'].indexOf(item.type) !== -1 && item.data.productId === current.id; });
    if (deleting && used) throw new Error('Este produto possui histórico de estoque e não pode ser excluído.');
    if (!deleting) {
      var next = Object.assign({}, data.data);
      ['category', 'storage', 'supplySource', 'productCode', 'barcode', 'dosageForm', 'strength', 'route', 'brand'].forEach(function(key) {
        if (!Object.prototype.hasOwnProperty.call(next, key) && Object.prototype.hasOwnProperty.call(current.data, key)) next[key] = current.data[key];
      });
      // A categoria deve ser coerente com o estado completo, inclusive campos preservados na correção.
      next = farmaciaProductData_(next, !Object.prototype.hasOwnProperty.call(next, 'category'));
      if (used && ['unit', 'control', 'supplySource'].some(function(key) { return next[key] !== current.data[key]; })) throw new Error('Produtos com histórico devem preservar unidade, controle e origem do fornecimento.');
      if (ledger.products.some(function(item) { return item.id !== current.id && farmaciaProductKey_(item.data) === farmaciaProductKey_(next); })) throw new Error('Este produto já está cadastrado.');
      list[index] = Object.assign({}, current, { data: next, revision: record.id });
    }
  } else {
    if (current.origin !== 'initial' || ledger.movements.some(function(item) { return (item.type === 'MOVEMENT' || item.type === 'LIFECYCLE') && item.data.positionId === current.id; })) throw new Error('Recebimentos e registros com movimentações preservam seu histórico. Use uma movimentação documentada.');
    if (!deleting) {
      var corrected = Object.assign({}, current, data.data);
      if (ledger.positions.some(function(item) { return item.id !== current.id && farmaciaSamePosition_(item, corrected); })) throw new Error('Esta posição já possui saldo.');
      list[index] = Object.assign(corrected, { revision: record.id });
    }
  }
  if (deleting) list.splice(index, 1);
}

function alterarRegistroFarmacia(payload) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-catalog-action', function() {
    var context = farmaciaContext_(payload.studyId, payload.restricted, 'manage');
    if (!context.ss) throw new Error('Armazenamento deste estudo e classe ainda não configurado.');
    var type = payload.type;
    var data = farmaciaCatalogActionData_(type, payload.data);
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    farmaciaAssertRequestId_(requestId);
    var ledger = farmaciaReadLedger_(context), dataJson = JSON.stringify(data);
    var previous = ledger.records.find(function(item) { return item.requestId === requestId; });
    if (previous) {
      if (previous.type !== type || previous.dataJson !== dataJson) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true };
    }
    var record = { id: 'FCA-' + Utilities.getUuid(), type: type, data: data };
    if (ledger.records.some(function(item) { return item.id === record.id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
    if (type === 'PRODUCT_EDIT' && context.studyId === FARMACIA_COMMON_SCOPE_ && data.data.supplySource === 'sponsor') throw new Error('Produtos do patrocinador devem pertencer ao estoque do estudo.');
    if (type === 'INITIAL_EDIT') {
      var position = ledger.positions.find(function(item) { return item.id === data.entityId; });
      if (position && data.data.expiry < farmaciaToday_() && position.blocked !== position.physical) throw new Error('Material vencido deve permanecer integralmente bloqueado.');
    }
    farmaciaApplyCatalogAction_(ledger, record);
    var row = [record.id, type, JSON.stringify(context.studyId), context.restricted, requestId,
      JSON.stringify(new Date().toISOString()), JSON.stringify(context.access.userEmail), dataJson];
    farmaciaAssertLedgerRowReplayable_(context, ledger, row);
    ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { ok: true, id: record.id, repeated: false };
  });
}
