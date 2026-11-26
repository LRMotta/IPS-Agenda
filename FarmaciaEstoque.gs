// Estoque próprio da pesquisa no arquivo principal, segregado por estudo e classe no servidor.
// O ID estável evita renomear a aba quando nome/código do projeto mudam.
function farmaciaLedgerSheetName_(studyId) {
  if (studyId === FARMACIA_COMMON_SCOPE_) return 'Farmacia_Comum_v1';
  studyId = farmaciaText_(studyId, 'o projeto', 120);
  // Hexadecimal distingue IDs que diferem apenas por maiúsculas no Sheets.
  if (/^[A-Za-z0-9_-]{1,40}$/.test(studyId)) return 'Farmacia_ID_' + studyId.split('').map(function(character) { return ('0' + character.charCodeAt(0).toString(16)).slice(-2); }).join('');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, studyId, Utilities.Charset.UTF_8);
  return 'Farmacia_SHA256_' + digest.map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}
var FARMACIA_LEDGER_HEADERS_ = ['ID', 'Tipo', 'Estudo_JSON', 'Restrito', 'Request_ID', 'Registrado_em_JSON', 'Autor_JSON', 'Dados_JSON'];
var FARMACIA_PRODUCT_DOSAGE_FORMS_ = ['Comprimido', 'Cápsula', 'Solução oral', 'Suspensão oral', 'Solução injetável', 'Suspensão injetável', 'Pó para solução injetável', 'Ampola', 'Creme', 'Pomada', 'Gel', 'Colírio', 'Solução oftálmica', 'Spray', 'Spray nasal', 'Solução inalatória', 'Aerossol', 'Supositório', 'Adesivo transdérmico', 'Outro'];

function farmaciaToday_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
}

// O Sheets converte texto numérico em número ao gravar (ex.: "123456789012"); o replay exige string e deixaria o
// estudo ilegível. Identificadores gravados precisam permanecer texto.
function farmaciaAssertRequestId_(requestId) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(requestId) || !isNaN(Number(requestId))) throw new Error('Identificador da operação inválido.');
}

// Dia civil do instante gravado no ledger (não o dia da leitura): mantém o replay determinístico.
function farmaciaRegisteredDay_(record) {
  return Utilities.formatDate(new Date(record.registeredAt), 'America/Sao_Paulo', 'yyyy-MM-dd');
}

function farmaciaText_(value, label, max, optional) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Informe ' + label + ' válido.');
  return value.trim();
}

function farmaciaDate_(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe ' + label + ' válida.');
  var date = new Date(value + 'T12:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01') throw new Error('Informe ' + label + ' válida.');
  return value;
}

function farmaciaQuantity_(value, fractional) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000 ||
      Math.abs(value * 1000 - Math.round(value * 1000)) > 0.00001 || (!fractional && !Number.isInteger(value))) {
    throw new Error('Quantidade inválida. Use valores não negativos, com até três casas decimais para mL ou g.');
  }
  return Math.round(value * 1000) / 1000;
}

function farmaciaProductData_(value, allowLegacyCategory) {
  value = value || {};
  allowLegacyCategory = allowLegacyCategory === true;
  var name = farmaciaText_(value.name, 'o nome do produto', 160);
  var presentation = farmaciaText_(value.presentation, 'a apresentação', 160);
  var unit = farmaciaText_(value.unit, 'a unidade', 30);
  var hasCategory = Object.prototype.hasOwnProperty.call(value, 'category');
  var category = hasCategory ? farmaciaText_(value.category, 'a categoria do produto', 30) : '';
  if ((!hasCategory && !allowLegacyCategory) || (hasCategory && ['medicine', 'material'].indexOf(category) === -1) ||
      ['unidade', 'caixa', 'comprimido', 'cápsula', 'frasco', 'ampola', 'seringa', 'equipo', 'kit', 'mL', 'g'].indexOf(unit) === -1 ||
      ['quantity', 'kit'].indexOf(value.control) === -1 || (value.control === 'kit' && unit !== 'kit')) {
    throw new Error('Selecione categoria, unidade e tipo de controle válidos. Kits individualizados usam a unidade kit.');
  }
  var result = { name: name, presentation: presentation };
  if (hasCategory) result.category = category;
  result.unit = unit;
  result.control = value.control;
  // Opcionais omitidos em uma correção preservam o valor atual; string vazia permite limpar explicitamente.
  [['productCode',80,'o código do produto no estudo'],['barcode',80,'o código de barras do produto'],
    ['dosageForm',80,'a forma farmacêutica'],['strength',120,'a dosagem ou concentração'],['route',80,'a via de administração'],['brand',120,'a marca do produto']]
    .forEach(function(field) {
      if (Object.prototype.hasOwnProperty.call(value, field[0])) result[field[0]] = farmaciaText_(value[field[0]], field[2], field[1], true);
    });
  if ((category === 'medicine' && result.dosageForm && FARMACIA_PRODUCT_DOSAGE_FORMS_.indexOf(result.dosageForm) === -1) ||
      (category === 'material' && (result.dosageForm || result.strength || result.route))) {
    throw new Error('Revise os campos farmacêuticos conforme a categoria do produto.');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'storage')) result.storage = farmaciaConservationData_(value.storage, !hasCategory);
  if (Object.prototype.hasOwnProperty.call(value, 'supplySource')) {
    if (['sponsor', 'site'].indexOf(value.supplySource) === -1) throw new Error('Selecione a origem do fornecimento do produto.');
    result.supplySource = value.supplySource;
  }
  // Uso do material: entregue ao participante, emprestado (volta para reuso) ou consumido no centro.
  // Só materiais têm; cadastros anteriores sem a chave continuam válidos no replay.
  if (Object.prototype.hasOwnProperty.call(value, 'materialUse')) {
    if (category !== 'material' || FARMACIA_MATERIAL_USES_.indexOf(value.materialUse) === -1) throw new Error('Selecione o uso do material.');
    result.materialUse = value.materialUse;
  }
  return result;
}
var FARMACIA_MATERIAL_USES_ = ['participant', 'loan', 'site'];

// Material pode não ter lote nem validade: o texto vazio registra "sem lote" / "sem validade".
// Medicamento (e produto antigo sem categoria) continua exigindo os dois.
function farmaciaLotOptional_(product) {
  return !!product && product.data.category === 'material';
}

function farmaciaEntryExpiry_(value, product, label) {
  return farmaciaLotOptional_(product) && value === '' ? '' : farmaciaDate_(value, label);
}

// Vencido na data informada. Sem validade nunca vence (o texto vazio não pode entrar em comparação de datas).
function farmaciaExpiredOn_(expiry, date) {
  return !!expiry && date > expiry;
}

function farmaciaInitialData_(value, product, historical) {
  value = value || {};
  if (!product) throw new Error('Produto não encontrado neste estudo e classe de acesso.');
  var fractional = ['mL', 'g'].indexOf(product.data.unit) !== -1;
  var physical = farmaciaQuantity_(value.physical, fractional);
  var blocked = farmaciaQuantity_(value.blocked, fractional);
  var expiry = farmaciaEntryExpiry_(value.expiry, product, 'a validade');
  var countedOn = farmaciaDate_(value.countedOn, 'a data da conferência');
  var kit = farmaciaText_(value.kit, 'o número do kit', 100, product.data.control !== 'kit');
  if (!physical || blocked > physical || countedOn > farmaciaToday_() || value.confirmed !== true ||
      (product.data.control === 'kit' && physical !== 1) || (product.data.control !== 'kit' && kit)) {
    throw new Error('Confira o saldo físico, bloqueado, a data e o tipo de controle. Confirme a contagem física.');
  }
  // Não cria vínculo clínico nem presume que material vencido esteja utilizável.
  if (!historical && farmaciaExpiredOn_(expiry, farmaciaToday_()) && blocked !== physical) throw new Error('Material vencido deve entrar integralmente bloqueado.');
  var result = { productId: product.id, lot: farmaciaText_(value.lot, 'o lote', 100, farmaciaLotOptional_(product)), expiry: expiry,
    location: farmaciaText_(value.location, 'a localização', 200), kit: kit,
    physical: physical, blocked: blocked, countedOn: countedOn, confirmed: true,
    note: farmaciaText_(value.note, 'a observação', 500, true) };
  if (Object.prototype.hasOwnProperty.call(value, 'locationRef')) {
    var ref = value.locationRef || {};
    result.locationRef = { unitId: farmaciaText_(ref.unitId, 'o equipamento', 100), position: farmaciaText_(ref.position, 'a posição', 80) };
  }
  if (product.data.supplySource === 'sponsor') {
    result.pending = Math.round((physical - blocked) * 1000) / 1000;
    if (value.pending !== undefined && value.pending !== result.pending) throw new Error('O saldo inicial do patrocinador aguarda avaliação; não presume liberação.');
  }
  return result;
}

function farmaciaStorage_() {
  // Instalação nova: a configuração de arquivos externos não é usada.
  return getCodexSpreadsheet_();
}

function farmaciaContext_(studyId, restricted, permission) {
  if (typeof restricted !== 'boolean') throw new Error('Selecione uma classe de acesso válida.');
  if (studyId === FARMACIA_COMMON_SCOPE_ && restricted) throw new Error('O estoque comum não possui classe restrita.');
  var access = studyId === FARMACIA_COMMON_SCOPE_ ? codexAssertFarmaciaCommonAccess_(permission) : codexAssertFarmaciaAccess_(permission, studyId, restricted);
  return { access: access, studyId: studyId, restricted: restricted, ss: farmaciaStorage_() };
}

function farmaciaProductKey_(data) {
  return JSON.stringify([data.name.toLowerCase(), data.presentation.toLowerCase(), data.category, data.unit, data.control].concat(
    ['productCode','barcode','dosageForm','strength','route','brand'].map(function(key) { return (data[key] || '').toLowerCase(); })));
}

function farmaciaPositionKey_(data) {
  return JSON.stringify([data.productId, data.lot, data.locationRef ? [data.locationRef.unitId, data.locationRef.position] : data.location, data.kit]);
}

// Produtos com estoque lançado: recebimentos sempre contam; inventário inicial deixa de contar
// depois de excluído (a exclusão só é aceita sem movimentações, então nenhum saldo depende dele).
function farmaciaProductsWithStock_(records) {
  var deleted = {}, result = {};
  records.forEach(function(item) { if (item.type === 'INITIAL_DELETE') deleted[item.data.entityId] = true; });
  records.forEach(function(item) {
    if (item.type === 'RECEIPT' || (item.type === 'INITIAL' && !deleted[item.id])) result[item.data.productId] = true;
  });
  return result;
}

function farmaciaSamePosition_(a, b) {
  return farmaciaPositionKey_(a) === farmaciaPositionKey_(b) ||
    (a.productId === b.productId && a.lot === b.lot && a.kit === b.kit && a.location === b.location);
}

// Recebimento: produto do patrocinador no estoque do estudo, ou produto próprio do IPS no estoque Geral.
// O do patrocinador entra aguardando avaliação; o do Geral entra disponível (pending: 0), como no inventário inicial.
function farmaciaReceiptData_(value, product, common) {
  value = value || {};
  var sponsor = !!product && product.data.supplySource === 'sponsor';
  if (!product || (common ? sponsor : !sponsor)) throw new Error(common ? 'Recebimentos do estoque Geral são de produtos próprios do IPS.' : 'Recebimentos do estudo são exclusivos de produtos do patrocinador identificados neste estudo.');
  var receivedOn = farmaciaDate_(value.receivedOn, 'a data do recebimento');
  if (receivedOn > farmaciaToday_()) throw new Error('A data do recebimento não pode ser futura.');
  var initial = farmaciaInitialData_(Object.assign({}, value, { blocked: 0, countedOn: receivedOn, confirmed: true }), product, true);
  var result = { productId: initial.productId, lot: initial.lot, expiry: initial.expiry, location: initial.location,
    kit: initial.kit, physical: initial.physical, receivedOn: receivedOn,
    document: farmaciaText_(value.document, 'a referência documental do recebimento', 200), note: initial.note };
  if (initial.locationRef) result.locationRef = initial.locationRef;
  if (common) result.pending = 0;
  // Registros anteriores não têm a chave "invoice"; o replay os normaliza sem ela.
  if (Object.prototype.hasOwnProperty.call(value, 'invoice')) result.invoice = farmaciaReceiptInvoice_(value.invoice);
  return result;
}

// Nota fiscal do recebimento. Número em branco = nota ainda não recebida; com número, remetente e
// valor unitário (por item, como o RM pede) são obrigatórios.
function farmaciaReceiptInvoice_(value) {
  value = value || {};
  var number = farmaciaText_(value.number, 'o número da nota fiscal', 30, true);
  if (number && !/\d/.test(number)) throw new Error('Informe um número de nota fiscal válido.');
  var sender = farmaciaText_(value.sender, 'o remetente da nota fiscal', 120, !number);
  var unitValue = value.unitValue === undefined || value.unitValue === null || value.unitValue === '' ? null : value.unitValue;
  if (unitValue !== null && (typeof unitValue !== 'number' || !Number.isFinite(unitValue) || unitValue < 0 || unitValue > 1000000000 ||
      Math.abs(unitValue * 100 - Math.round(unitValue * 100)) > 0.000001)) throw new Error('Informe o valor unitário em reais, com até duas casas decimais.');
  if (number && unitValue === null) throw new Error('Informe o valor unitário do item na nota fiscal.');
  return { number: number, sender: sender, unitValue: unitValue === null ? null : Math.round(unitValue * 100) / 100 };
}

// Nota fiscal informada ou corrigida depois do recebimento (RECEIPT_INVOICE). O recebimento original não muda:
// o registro novo fica no histórico e passa a valer como a nota do recebimento (o mais recente prevalece).
function farmaciaReceiptInvoiceEditData_(value) {
  value = value || {};
  var invoice = farmaciaReceiptInvoice_(value.invoice);
  if (!invoice.number) throw new Error('Informe o número da nota fiscal.');
  return { receiptId: farmaciaText_(value.receiptId, 'o recebimento', 100), invoice: invoice,
    reason: farmaciaText_(value.reason, 'o motivo', 500) };
}

function farmaciaApplyReceiptInvoice_(ledger, record) {
  var receipt = ledger.records.find(function(item) { return item.type === 'RECEIPT' && item.id === record.data.receiptId; });
  if (!receipt) throw new Error('Recebimento não encontrado neste estudo e classe de acesso.');
  var position = ledger.positions.find(function(item) { return item.id === receipt.id; });
  if (position) position.invoice = record.data.invoice;
  ledger.movements.push(record);
}

function registrarNotaRecebimentoFarmacia(payload) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-RECEIPT_INVOICE', function() {
    var context = farmaciaContext_(payload.studyId, payload.restricted, 'operate');
    if (!context.ss) throw new Error('Armazenamento deste estudo e classe ainda não configurado.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    farmaciaAssertRequestId_(requestId);
    var ledger = farmaciaReadLedger_(context), data = farmaciaReceiptInvoiceEditData_(payload.data);
    var previous = ledger.records.find(function(record) { return record.requestId === requestId; });
    if (previous) {
      if (previous.type !== 'RECEIPT_INVOICE' || previous.dataJson !== JSON.stringify(data)) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true };
    }
    var receipt = ledger.records.find(function(record) { return record.type === 'RECEIPT' && record.id === data.receiptId; });
    if (!receipt) throw new Error('Recebimento não encontrado neste estudo e classe de acesso.');
    var position = ledger.positions.find(function(item) { return item.id === receipt.id; });
    var current = position ? position.invoice : receipt.data.invoice;
    if (current && JSON.stringify(current) === JSON.stringify(data.invoice)) throw new Error('A nota fiscal informada é igual à atual.');
    var id = 'FNF-' + Utilities.getUuid();
    if (ledger.records.some(function(record) { return record.id === id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
    var row = [id, 'RECEIPT_INVOICE', JSON.stringify(context.studyId), context.restricted, requestId, JSON.stringify(new Date().toISOString()), JSON.stringify(context.access.userEmail), JSON.stringify(data)];
    farmaciaAssertLedgerRowReplayable_(context, ledger, row);
    ledger.sheet.getRange(ledger.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    return { ok: true, id: id, repeated: false };
  });
}

function farmaciaMovementData_(value) {
  value = value || {};
  if (['block', 'release', 'transfer'].indexOf(value.action) === -1) throw new Error('Selecione uma movimentação válida.');
  var from = value.action === 'transfer' ? '' : value.from;
  if ((value.action === 'block' && ['available', 'pending'].indexOf(from) === -1) ||
      (value.action === 'release' && ['blocked', 'pending'].indexOf(from) === -1)) throw new Error('Selecione a situação de origem da quantidade.');
  var result = { positionId: farmaciaText_(value.positionId, 'o registro de estoque', 100),
    revision: farmaciaText_(value.revision, 'a revisão do saldo', 100), action: value.action,
    quantity: farmaciaQuantity_(value.quantity, true), from: from,
    reason: farmaciaText_(value.reason, 'o motivo da movimentação', 500),
    document: farmaciaText_(value.document, 'a referência documental da movimentação', 200) };
  if (!result.quantity) throw new Error('A quantidade deve ser positiva.');
  if (value.action === 'transfer') {
    var ref = value.locationRef || {};
    result.locationRef = { unitId: farmaciaText_(ref.unitId, 'o equipamento de destino', 100), position: farmaciaText_(ref.position, 'a posição de destino', 80) };
    result.location = farmaciaText_(value.location, 'a localização de destino', 200);
  }
  return result;
}

function farmaciaEntryState_(record) {
  var data = record.data, receipt = record.type === 'RECEIPT';
  var blocked = receipt ? (farmaciaExpiredOn_(data.expiry, data.receivedOn) ? data.physical : 0) : data.blocked;
  // Recebimento do Geral grava pending: 0 (entra disponível); o do patrocinador aguarda avaliação.
  var pending = receipt ? (data.pending === 0 ? 0 : data.physical - blocked) : data.pending || 0;
  return Object.assign({}, data, { id: record.id, revision: record.id, registeredAt: record.registeredAt,
    author: record.author, origin: receipt ? 'receipt' : 'initial', initialBlocked: blocked, blocked: blocked, pending: pending,
    available: Math.round((data.physical - blocked - pending) * 1000) / 1000 });
}

function farmaciaApplyMovement_(position, movement, product, id) {
  if (!position || !product || product.data.supplySource !== 'sponsor') throw new Error('Movimentações são exclusivas de produtos do patrocinador deste estudo.');
  if (movement.revision !== position.revision) throw new Error('O saldo mudou. Atualize o estoque antes de movimentar.');
  if (position.transportReserved) throw new Error('Conclua o transporte em andamento antes de movimentar esta entrada.');
  if (position.returned && movement.action === 'release') throw new Error('Produtos retornados pelo participante permanecem em quarentena até a destinação documentada.');
  var quantity = farmaciaQuantity_(movement.quantity, ['mL', 'g'].indexOf(product.data.unit) !== -1);
  if (movement.action === 'transfer') {
    if (quantity !== position.physical) throw new Error('A transferência deve abranger todo o saldo deste registro.');
    if ((position.locationRef && position.locationRef.unitId === movement.locationRef.unitId && position.locationRef.position === movement.locationRef.position) || position.location === movement.location) throw new Error('Selecione uma localização de destino diferente da atual.');
    position.locationRef = movement.locationRef;
    position.location = movement.location;
  } else {
    if (quantity > position[movement.from]) throw new Error('A quantidade excede o saldo na situação selecionada.');
    position[movement.from] = Math.round((position[movement.from] - quantity) * 1000) / 1000;
    var target = movement.action === 'block' ? 'blocked' : 'available';
    position[target] = Math.round((position[target] + quantity) * 1000) / 1000;
  }
  position.revision = id;
}

function farmaciaReceiptKey_(data) {
  return JSON.stringify([data.document, data.productId, data.lot, data.kit]);
}

function farmaciaReadLedger_(context) {
  var sheet = context.ss.getSheetByName(farmaciaLedgerSheetName_(context.studyId));
  if (!sheet || !sheet.getLastRow()) return { sheet: sheet, records: [], products: [], initial: [], positions: [], movements: [], rows: [] };
  var rows = sheet.getDataRange().getValues();
  var ledger = farmaciaParseLedgerRows_(context, sheet, rows);
  ledger.rows = rows;
  return ledger;
}

// Antes da primeira escrita: a linha nova precisa ser aceita pelo mesmo replay das consultas.
// Uma linha que o replay recusa tornaria todo o estoque do estudo/classe ilegível.
function farmaciaAssertLedgerRowReplayable_(context, ledger, row) {
  farmaciaAssertLedgerRowsReplayable_(context, ledger, [row]);
}

// Várias linhas gravadas juntas (guia de dispensação) passam pelo replay como um bloco.
function farmaciaAssertLedgerRowsReplayable_(context, ledger, newRows) {
  var rows = (ledger.rows && ledger.rows.length ? ledger.rows : [FARMACIA_LEDGER_HEADERS_.slice()]).concat(newRows);
  try {
    farmaciaParseLedgerRows_(context, ledger.sheet, rows);
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Não propagar dados brutos do registro recusado ao cliente.
    throw new Error('A operação não passou na validação do histórico do estoque. Nenhum dado foi gravado. Confira os dados informados e os cadastros vinculados.');
  }
}

function farmaciaParseLedgerRows_(context, sheet, rows) {
  if (rows[0].length !== FARMACIA_LEDGER_HEADERS_.length || FARMACIA_LEDGER_HEADERS_.some(function(header, i) { return rows[0][i] !== header; })) {
    throw new Error('Estrutura do estoque da Farmácia divergente. Revise o arquivo antes de prosseguir.');
  }
  // Conjuntos para unicidade em O(1): o replay roda a cada leitura e escrita. Posições e produtos continuam em listas porque as correções os substituem/removem.
  var records = [], products = [], initial = [], positions = [], movements = [];
  var ids = new Set(), requests = new Set(), kits = new Set(), receipts = new Set();
  var lastLifecycleDate = {};
  try {
    rows.slice(1).forEach(function(row) {
      if (row.every(function(cell) { return cell === ''; })) return;
      var scope = JSON.parse(row[2]);
      if (typeof scope !== 'string' || !scope || scope !== scope.trim() || scope === '*' || scope === '@IPS_LOCATIONS' ||
          typeof row[3] !== 'boolean' || (scope === FARMACIA_COMMON_SCOPE_ && row[3])) throw new Error('Contexto inválido.');
      // Nunca desserializar payloads de outros estudos/classes na consulta autorizada.
      if (scope !== context.studyId || row[3] !== context.restricted) return;
      var registeredAt = JSON.parse(row[5]), author = JSON.parse(row[6]), data = JSON.parse(row[7]);
      var prefixes = { PRODUCT: 'FPR-', INITIAL: 'FIN-', RECEIPT: 'FRC-', MOVEMENT: 'FMV-', LIFECYCLE: 'FLC-', ADJUSTMENT: 'FAJ-', REVALIDATION: 'FRV-', PRODUCT_EDIT: 'FCA-', PRODUCT_DELETE: 'FCA-', INITIAL_EDIT: 'FCA-', INITIAL_DELETE: 'FCA-', RECEIPT_INVOICE: 'FNF-' };
      if (typeof row[0] !== 'string' || !/^F(?:PR|IN|RC|MV|CA|LC|AJ|NF|RV)-[A-Za-z0-9_-]+$/.test(row[0]) ||
          !prefixes[row[1]] || row[0].indexOf(prefixes[row[1]]) !== 0 || scope !== context.studyId || row[3] !== context.restricted ||
          typeof row[4] !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(row[4]) ||
          typeof registeredAt !== 'string' || isNaN(Date.parse(registeredAt)) || new Date(registeredAt).toISOString() !== registeredAt ||
          typeof author !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author) ||
          ids.has(row[0]) || requests.has(row[4])) throw new Error('Registro inválido.');
      ids.add(row[0]); requests.add(row[4]);
      var record = { id: row[0], type: row[1], requestId: row[4], registeredAt: registeredAt, author: author, data: data, dataJson: row[7] };
      records.push(record);
      if (record.type === 'PRODUCT') {
        if (JSON.stringify(farmaciaProductData_(data, true)) !== row[7] || products.some(function(item) { return farmaciaProductKey_(item.data) === farmaciaProductKey_(data); }) ||
            (context.studyId === FARMACIA_COMMON_SCOPE_ && data.supplySource === 'sponsor')) throw new Error('Produto duplicado ou inválido.');
        products.push(record);
      } else if (record.type === 'INITIAL' || record.type === 'RECEIPT') {
        var product = products.find(function(item) { return item.id === data.productId; });
        var normalized = record.type === 'INITIAL' ? farmaciaInitialData_(data, product, true) : farmaciaReceiptData_(data, product, context.studyId === FARMACIA_COMMON_SCOPE_);
        if (JSON.stringify(normalized) !== record.dataJson || (data.kit && kits.has(data.kit)) ||
            (record.type === 'INITIAL' && (positions.some(function(item) { return farmaciaSamePosition_(item, data); }) || records.some(function(item, index) {
              return index < records.length - 1 && (item.type === 'INITIAL' || item.type === 'RECEIPT') && farmaciaSamePosition_(item.data, data);
            }))) ||
            (record.type === 'RECEIPT' && receipts.has(farmaciaReceiptKey_(data)))) throw new Error('Entrada duplicada ou inválida.');
        if (data.kit) kits.add(data.kit);
        if (record.type === 'INITIAL') initial.push(record);
        else receipts.add(farmaciaReceiptKey_(data));
        positions.push(farmaciaEntryState_(record)); movements.push(record);
      } else if (record.type === 'LIFECYCLE') {
        if (context.studyId === FARMACIA_COMMON_SCOPE_ || JSON.stringify(farmaciaLifecycleData_(data)) !== record.dataJson) throw new Error('Operação do ciclo inválida.');
        farmaciaApplyLifecycle_({ records: records, products: products, positions: positions, movements: movements, lastLifecycleDate: lastLifecycleDate }, record);
      } else if (record.type === 'RECEIPT_INVOICE') {
        if (JSON.stringify(farmaciaReceiptInvoiceEditData_(data)) !== record.dataJson) throw new Error('Nota fiscal do recebimento inválida.');
        farmaciaApplyReceiptInvoice_({ records: records, positions: positions, movements: movements }, record);
      } else if (record.type === 'ADJUSTMENT') {
        if (context.studyId !== FARMACIA_COMMON_SCOPE_ || JSON.stringify(farmaciaAdjustmentData_(data)) !== record.dataJson) throw new Error('Ajuste de quantidade inválido.');
        farmaciaApplyAdjustment_({ products: products, positions: positions, movements: movements }, record);
      } else if (record.type === 'REVALIDATION') {
        if (JSON.stringify(farmaciaRevalidationData_(data)) !== record.dataJson) throw new Error('Revalidação inválida.');
        farmaciaApplyRevalidation_({ positions: positions, movements: movements }, record);
      } else if (record.type !== 'MOVEMENT') {
        if (JSON.stringify(farmaciaCatalogActionData_(record.type, data)) !== record.dataJson ||
            (record.type === 'PRODUCT_EDIT' && context.studyId === FARMACIA_COMMON_SCOPE_ && data.data.supplySource === 'sponsor')) throw new Error('Correção inválida.');
        farmaciaApplyCatalogAction_({ records: records, products: products, positions: positions, movements: movements }, record);
      } else {
        if (JSON.stringify(farmaciaMovementData_(data)) !== record.dataJson) throw new Error('Movimentação inválida.');
        var position = positions.find(function(item) { return item.id === data.positionId; });
        var source = position && products.find(function(item) { return item.id === position.productId; });
        farmaciaApplyMovement_(position, data, source, record.id);
        movements.push(record);
      }
    });
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Não propagar dados brutos ou identificadores de registros inconsistentes ao cliente.
    throw new Error('Registros do estoque da Farmácia inconsistentes. Nenhum saldo foi alterado.');
  }
  return { sheet: sheet, records: records, products: products, initial: initial, positions: positions, movements: movements, lastLifecycleDate: lastLifecycleDate };
}

function codexAssertFarmaciaProductsAccess_(studyId, restricted) {
  if (typeof restricted !== 'boolean') throw new Error('Selecione uma classe de acesso válida.');
  if (restricted) return codexAssertFarmaciaAccess_('read', studyId, true);
  var access = codexAssertCanRead_();
  var common = studyId === FARMACIA_COMMON_SCOPE_;
  var study = common ? { id: FARMACIA_COMMON_SCOPE_, nome: 'Geral (Farmácia)', codigo: '' } : codexFarmaciaStudyCatalog_().find(function(item) { return item.id === studyId; });
  if (!study) throw new Error('Estudo indisponível para a Farmácia.');
  // Mesma regra de codexFarmaciaGrantFor_: escopo "todos" nunca concede a classe restrita.
  var grant = common ? null : (access.farmaciaStudies || []).find(function(item) { return item.studyId === studyId; }) ||
    (access.farmaciaAllStudies === true ? { studyId: studyId, restricted: false } : null);
  access.farmaciaStudy = study;
  access.farmaciaRestricted = !common && !!grant && grant.restricted === true && codexNormalizeFarmaciaAccess_(access.farmaciaAccess) !== 'none';
  access.farmaciaAccess = (common ? access.farmaciaCommonAccess === 'manage' : !!grant && access.farmaciaAccess === 'manage') ? 'manage' : 'read';
  return access;
}

// Catálogo geral: não devolve dados operacionais. Gestores recebem apenas o bloqueio de unidade por histórico.
function getFarmaciaProdutos(studyId, restricted) {
  var access = codexAssertFarmaciaProductsAccess_(studyId, restricted);
  var ss = farmaciaStorage_();
  var sheet = ss.getSheetByName(farmaciaLedgerSheetName_(studyId));
  var products = [];
  var productsWithStockHistory = {};
  var stockHistoryUnknown = false;
  if (sheet && sheet.getLastRow()) {
    var rows = sheet.getDataRange().getValues();
    var stockRecords = [];
    rows.slice(1).forEach(function(row) {
      if (access.farmaciaAccess !== 'manage' || row[2] !== JSON.stringify(studyId) || row[3] !== restricted || ['INITIAL', 'RECEIPT', 'INITIAL_DELETE'].indexOf(row[1]) === -1) return;
      try {
        var stockData = JSON.parse(row[7]);
        if (!stockData || !(row[1] === 'INITIAL_DELETE' ? stockData.entityId : stockData.productId)) stockHistoryUnknown = true;
        else stockRecords.push({ id: row[0], type: row[1], data: stockData });
      } catch (error) {
        // O catálogo continua consultável; histórico ilegível nunca libera mudança de unidade.
        stockHistoryUnknown = true;
      }
    });
    productsWithStockHistory = farmaciaProductsWithStock_(stockRecords);
    var selected = rows.slice(1).filter(function(row) {
      return row[2] === JSON.stringify(studyId) && row[3] === restricted && ['PRODUCT', 'PRODUCT_EDIT', 'PRODUCT_DELETE'].indexOf(row[1]) !== -1;
    });
    products = farmaciaParseLedgerRows_({ studyId: studyId, restricted: restricted }, sheet, [rows[0]].concat(selected)).products;
  }
  return { study: access.farmaciaStudy, productsOnly: true, configured: true, restricted: restricted, restrictedAllowed: access.farmaciaRestricted === true,
    farmaciaAccess: access.farmaciaAccess, locationsConfigured: false, locationsCanManage: false,
    positions: [], movements: [], storageUnits: [], products: products.map(function(record) {
      var result = { id: record.id, revision: record.revision || record.id, hasStockHistory: stockHistoryUnknown || productsWithStockHistory[record.id] === true };
      ['name','presentation','category','unit','control','productCode','barcode','dosageForm','strength','route','brand','storage','supplySource','materialUse'].forEach(function(key) {
        if (record.data[key] !== undefined) result[key] = record.data[key];
      });
      return result;
    }) };
}

function getFarmaciaEstoque(studyId, restricted) {
  var context = farmaciaContext_(studyId, restricted, 'read');
  var data = context.ss ? farmaciaReadLedger_(context) : { products: [], positions: [], movements: [] };
  var today = farmaciaToday_();
  var locations = farmaciaReadLocations_();
  var productsWithStockHistory = farmaciaProductsWithStock_(data.records || []);
  return { study: context.access.farmaciaStudy, restricted: restricted, configured: !!context.ss,
    locationsConfigured: locations.configured, storageUnits: locations.units,
    locationsCanManage: context.access.role === 'admin' || context.access.role === 'user',
    farmaciaAccess: context.access.farmaciaAccess, products: data.products.map(function(record) {
      return Object.assign({ id: record.id, revision: record.revision || record.id, registeredAt: record.registeredAt, author: record.author }, record.data,
        { hasStockHistory: productsWithStockHistory[record.id] === true });
    }), movements: data.movements.map(function(record) {
      var event = { id: record.id, type: record.type, registeredAt: record.registeredAt, author: record.author, data: record.data };
      if (record.adherenceResult) event.adherenceResult = record.adherenceResult;
      if (record.excursion !== undefined) event.excursion = record.excursion;
      if (record.retroactive) event.retroactive = true;
      if (record.adjustmentDelta !== undefined) event.adjustmentDelta = record.adjustmentDelta;
      return event;
    }), positions: data.positions.map(function(position) {
      var expired = farmaciaExpiredOn_(position.expiry, today);
      return Object.assign({}, position, {
        storageCheck: farmaciaStorageCheck_(data.products.find(function(item) { return item.id === position.productId; }).data, position, locations.units),
        expired: expired, available: expired ? 0 : Math.round((position.available - (position.transportReserved || 0)) * 1000) / 1000,
        inTransit: position.transportReserved || 0,
        pending: expired ? 0 : position.pending,
        blocked: expired ? Math.round((position.physical - (position.transportReserved || 0)) * 1000) / 1000 : position.blocked
      });
    }) };
}

function farmaciaWrite_(payload, type) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-' + type, function() {
    // Autorização e configuração frescas, dentro da seção protegida.
    // Recebimento é rotina do nível Operação; produto, inventário inicial e movimentação
    // (liberar, bloquear, transferir) continuam exclusivos do Responsável pela Farmácia.
    var context = farmaciaContext_(payload.studyId, payload.restricted, type === 'RECEIPT' ? 'operate' : 'manage');
    if (!context.ss) throw new Error('Armazenamento deste estudo e classe ainda não configurado.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    farmaciaAssertRequestId_(requestId);
    var ledger = farmaciaReadLedger_(context);
    var product = ledger.products.find(function(record) { return record.id === (payload.data || {}).productId; });
    var data = type === 'PRODUCT' ? farmaciaProductData_(payload.data) : type === 'MOVEMENT' ? farmaciaMovementData_(payload.data) :
      type === 'RECEIPT' ? farmaciaReceiptData_(payload.data, product, context.studyId === FARMACIA_COMMON_SCOPE_) : farmaciaInitialData_(payload.data, product, true);
    var dataJson = JSON.stringify(data);
    var previous = ledger.records.find(function(record) { return record.requestId === requestId; });
    if (previous) {
      if ((type === 'INITIAL' || type === 'RECEIPT' || (type === 'MOVEMENT' && data.action === 'transfer')) && data.locationRef) {
        data.location = previous.data.location;
        dataJson = JSON.stringify(data);
      }
      if (previous.type !== type || previous.dataJson !== dataJson) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true };
    }
    if (type === 'PRODUCT' && !data.storage) throw new Error('Informe as condições de conservação do produto.');
    if (type === 'PRODUCT' && !data.supplySource) throw new Error('Selecione a origem do fornecimento do produto.');
    if (type === 'PRODUCT' && data.category === 'material' && !data.materialUse) throw new Error('Selecione o uso do material.');
    if (type === 'PRODUCT' && context.studyId === FARMACIA_COMMON_SCOPE_ && data.supplySource === 'sponsor') throw new Error('Produtos do patrocinador devem pertencer ao estoque do estudo.');
    if (type === 'INITIAL' || type === 'RECEIPT' || (type === 'MOVEMENT' && data.action === 'transfer')) {
      var locations = farmaciaReadLocations_();
      var ref = data.locationRef;
      var unit = ref && locations.units.find(function(item) { return item.id === ref.unitId; });
      if (!unit || unit.deleted || unit.positions.indexOf(ref.position) === -1) throw new Error('Selecione um equipamento e uma posição cadastrados.');
      // O rótulo é derivado do catálogo, nunca de texto enviado pelo cliente.
      data.location = unit.code + ' → ' + ref.position;
      dataJson = JSON.stringify(data);
    }
    if (type === 'INITIAL') farmaciaInitialData_(data, product);
    if (type === 'PRODUCT' && ledger.products.some(function(record) { return farmaciaProductKey_(record.data) === farmaciaProductKey_(data); })) {
      throw new Error('Este produto já está cadastrado.');
    }
    if ((type === 'INITIAL' || type === 'RECEIPT') && ledger.records.some(function(record) {
      return (record.type === 'INITIAL' || record.type === 'RECEIPT') &&
        ((type === 'INITIAL' && farmaciaSamePosition_(record.data, data)) || (data.kit && record.data.kit === data.kit));
    })) throw new Error('Esta posição ou kit já possui inventário inicial. Não repita a contagem como nova entrada.');
    if (type === 'INITIAL' && ledger.positions.some(function(position) { return farmaciaSamePosition_(position, data); })) throw new Error('Esta posição já possui saldo. Não repita a contagem como nova entrada.');
    if (type === 'RECEIPT' && (ledger.records.some(function(record) {
      return record.type === 'RECEIPT' && farmaciaReceiptKey_(record.data) === farmaciaReceiptKey_(data);
    }) || ledger.positions.some(function(position) {
      // Lote corrigido depois do recebimento: a chave atual também identifica o mesmo recebimento.
      return position.origin === 'receipt' && farmaciaReceiptKey_(position) === farmaciaReceiptKey_(data);
    }))) throw new Error('Este recebimento já foi registrado. Confira a referência documental.');
    var id = ({ PRODUCT: 'FPR-', INITIAL: 'FIN-', RECEIPT: 'FRC-', MOVEMENT: 'FMV-' })[type] + Utilities.getUuid();
    if (ledger.records.some(function(record) { return record.id === id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
    if (type === 'MOVEMENT') {
      var position = ledger.positions.find(function(item) { return item.id === data.positionId; });
      var movementProduct = position && ledger.products.find(function(item) { return item.id === position.productId; });
      if (position && farmaciaExpiredOn_(position.expiry, farmaciaToday_()) && data.action !== 'transfer') throw new Error(data.action === 'release' ? 'Material vencido permanece bloqueado e não pode ser liberado.' : 'Material vencido já está integralmente bloqueado.');
      farmaciaApplyMovement_(position, data, movementProduct, id);
    }
    var row = [id, type, JSON.stringify(context.studyId), context.restricted, requestId, JSON.stringify(new Date().toISOString()), JSON.stringify(context.access.userEmail), dataJson];
    farmaciaAssertLedgerRowReplayable_(context, ledger, row);
    var sheet = ledger.sheet || context.ss.insertSheet(farmaciaLedgerSheetName_(context.studyId));
    // Uma gravação para cabeçalho + primeiro registro, ou uma linha append-only.
    if (!sheet.getLastRow()) sheet.getRange(1, 1, 2, row.length).setValues([FARMACIA_LEDGER_HEADERS_.slice(), row]);
    else sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    // Histórico no arquivo principal: autor, instante, estudo/classe e payload imutável.
    return { ok: true, id: id, repeated: false };
  });
}

function cadastrarProdutoFarmacia(payload) {
  return farmaciaWrite_(payload, 'PRODUCT');
}

function registrarInventarioInicialFarmacia(payload) {
  return farmaciaWrite_(payload, 'INITIAL');
}

function registrarRecebimentoFarmacia(payload) {
  return farmaciaWrite_(payload, 'RECEIPT');
}

function registrarMovimentacaoFarmacia(payload) {
  return farmaciaWrite_(payload, 'MOVEMENT');
}
