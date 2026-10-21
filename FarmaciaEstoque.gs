// Estoque próprio da pesquisa. Arquivos separados por estudo/classe e estoque comum.
var FARMACIA_LEDGER_SHEET_ = 'Farmacia_Registros_v1';
var FARMACIA_LEDGER_HEADERS_ = ['ID', 'Tipo', 'Estudo_JSON', 'Restrito', 'Request_ID', 'Registrado_em_JSON', 'Autor_JSON', 'Dados_JSON'];

function farmaciaToday_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
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

function farmaciaProductData_(value) {
  value = value || {};
  var name = farmaciaText_(value.name, 'o nome do produto', 160);
  var presentation = farmaciaText_(value.presentation, 'a apresentação', 160);
  var unit = farmaciaText_(value.unit, 'a unidade', 30);
  if (['unidade', 'comprimido', 'cápsula', 'frasco', 'ampola', 'seringa', 'kit', 'mL', 'g'].indexOf(unit) === -1 ||
      ['quantity', 'kit'].indexOf(value.control) === -1 || (value.control === 'kit' && unit !== 'kit')) {
    throw new Error('Selecione unidade e tipo de controle válidos. Kits individualizados usam a unidade kit.');
  }
  var result = { name: name, presentation: presentation, unit: unit, control: value.control };
  // Ausência preserva o JSON histórico; nunca presume uma condição de conservação.
  if (Object.prototype.hasOwnProperty.call(value, 'storage')) result.storage = farmaciaConservationData_(value.storage);
  return result;
}

function farmaciaInitialData_(value, product, historical) {
  value = value || {};
  if (!product) throw new Error('Produto não encontrado neste estudo e classe de acesso.');
  var fractional = ['mL', 'g'].indexOf(product.data.unit) !== -1;
  var physical = farmaciaQuantity_(value.physical, fractional);
  var blocked = farmaciaQuantity_(value.blocked, fractional);
  var expiry = farmaciaDate_(value.expiry, 'a validade');
  var countedOn = farmaciaDate_(value.countedOn, 'a data da conferência');
  var kit = farmaciaText_(value.kit, 'o número do kit', 100, product.data.control !== 'kit');
  if (!physical || blocked > physical || countedOn > farmaciaToday_() || value.confirmed !== true ||
      (product.data.control === 'kit' && physical !== 1) || (product.data.control !== 'kit' && kit)) {
    throw new Error('Confira o saldo físico, bloqueado, a data e o tipo de controle. Confirme a contagem física.');
  }
  // Não cria vínculo clínico nem presume que material vencido esteja utilizável.
  if (!historical && expiry < farmaciaToday_() && blocked !== physical) throw new Error('Material vencido deve entrar integralmente bloqueado.');
  var result = { productId: product.id, lot: farmaciaText_(value.lot, 'o lote', 100), expiry: expiry,
    location: farmaciaText_(value.location, 'a localização', 200), kit: kit,
    physical: physical, blocked: blocked, countedOn: countedOn, confirmed: true,
    note: farmaciaText_(value.note, 'a observação', 500, true) };
  if (Object.prototype.hasOwnProperty.call(value, 'locationRef')) {
    var ref = value.locationRef || {};
    result.locationRef = { unitId: farmaciaText_(ref.unitId, 'o equipamento', 100), position: farmaciaText_(ref.position, 'a posição', 80) };
  }
  return result;
}

function farmaciaStorage_(studyId, restricted) {
  var raw = PropertiesService.getScriptProperties().getProperty('FARMACIA_STORAGE_V1');
  if (!raw) return null;
  if (raw.length > 50000) throw new Error('Configuração de armazenamento da Farmácia inválida.');
  var config;
  try { config = JSON.parse(raw); } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- A resposta pública não deve expor o conteúdo bruto da configuração.
    throw new Error('Configuração de armazenamento da Farmácia inválida.');
  }
  if (!config || config.version !== 1 || !Array.isArray(config.studies) || config.studies.length > 200) {
    throw new Error('Configuração de armazenamento da Farmácia inválida.');
  }
  var primary = getCodexSpreadsheet_().getId();
  var seenStudies = [], seenFiles = [], selected = '';
  if (config.locations !== undefined && config.locations !== '') {
    if (typeof config.locations !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(config.locations) || config.locations === primary) throw new Error('Configuração do catálogo de locais inválida.');
    seenFiles.push(config.locations);
    if (studyId === '@IPS_LOCATIONS' && restricted === false) selected = config.locations;
  }
  if (config.common !== undefined && config.common !== '') {
    if (typeof config.common !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(config.common) || config.common === primary) {
      throw new Error('Configuração do arquivo exclusivo do estoque comum inválida.');
    }
    if (seenFiles.indexOf(config.common) !== -1) throw new Error('Os arquivos da Farmácia devem ser exclusivos por estudo, classe e catálogo de locais.');
    seenFiles.push(config.common);
    if (studyId === FARMACIA_COMMON_SCOPE_ && restricted === false) selected = config.common;
  }
  config.studies.forEach(function(entry) {
    if (!entry || typeof entry.studyId !== 'string' || !entry.studyId || entry.studyId !== entry.studyId.trim() ||
        entry.studyId === '*' || entry.studyId === '@IPS_LOCATIONS' || entry.studyId === FARMACIA_COMMON_SCOPE_ || seenStudies.indexOf(entry.studyId) !== -1) throw new Error('Configuração de armazenamento da Farmácia inválida.');
    seenStudies.push(entry.studyId);
    ['standard', 'restricted'].forEach(function(kind) {
      var id = entry[kind];
      if (id === undefined || id === '') return;
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(id) || id === primary || seenFiles.indexOf(id) !== -1) {
        throw new Error('Os arquivos da Farmácia devem ser exclusivos por estudo e classe, separados da planilha principal.');
      }
      seenFiles.push(id);
      if (entry.studyId === studyId && kind === (restricted ? 'restricted' : 'standard')) selected = id;
    });
  });
  if (!selected) return null;
  var storage = SpreadsheetApp.openById(selected);
  var allowedSheet = studyId === '@IPS_LOCATIONS' ? FARMACIA_LOCATIONS_SHEET_ : FARMACIA_LEDGER_SHEET_;
  if (storage.getSheets().some(function(sheet) { return sheet.getName() !== allowedSheet && sheet.getLastRow() > 0; })) {
    throw new Error('O armazenamento da Farmácia deve usar um arquivo dedicado, sem dados de outros módulos.');
  }
  return storage;
}

function farmaciaContext_(studyId, restricted, permission) {
  if (typeof restricted !== 'boolean') throw new Error('Selecione uma classe de acesso válida.');
  if (studyId === FARMACIA_COMMON_SCOPE_ && restricted) throw new Error('O estoque comum não possui classe restrita.');
  var access = studyId === FARMACIA_COMMON_SCOPE_ ? codexAssertFarmaciaCommonAccess_(permission) : codexAssertFarmaciaAccess_(permission, studyId, restricted);
  return { access: access, studyId: studyId, restricted: restricted, ss: farmaciaStorage_(studyId, restricted) };
}

function farmaciaProductKey_(data) {
  return JSON.stringify([data.name.toLowerCase(), data.presentation.toLowerCase(), data.unit, data.control]);
}

function farmaciaPositionKey_(data) {
  return JSON.stringify([data.productId, data.lot, data.locationRef ? [data.locationRef.unitId, data.locationRef.position] : data.location, data.kit]);
}

function farmaciaSamePosition_(a, b) {
  return farmaciaPositionKey_(a) === farmaciaPositionKey_(b) ||
    (a.productId === b.productId && a.lot === b.lot && a.kit === b.kit && a.location === b.location);
}

function farmaciaReadLedger_(context) {
  var sheet = context.ss.getSheetByName(FARMACIA_LEDGER_SHEET_);
  if (!sheet || !sheet.getLastRow()) return { sheet: sheet, records: [], products: [], initial: [] };
  var rows = sheet.getDataRange().getValues();
  if (rows[0].length !== FARMACIA_LEDGER_HEADERS_.length || FARMACIA_LEDGER_HEADERS_.some(function(header, i) { return rows[0][i] !== header; })) {
    throw new Error('Estrutura do estoque da Farmácia divergente. Revise o arquivo antes de prosseguir.');
  }
  var records = [], products = [], initial = [], ids = [], requests = [], productKeys = [], positions = [], kits = [];
  try {
    rows.slice(1).forEach(function(row) {
      if (row.every(function(cell) { return cell === ''; })) return;
      var scope = JSON.parse(row[2]), registeredAt = JSON.parse(row[5]), author = JSON.parse(row[6]), data = JSON.parse(row[7]);
      if (typeof row[0] !== 'string' || !/^F(?:PR|IN)-[A-Za-z0-9_-]+$/.test(row[0]) ||
          ['PRODUCT', 'INITIAL'].indexOf(row[1]) === -1 || row[0].indexOf(row[1] === 'PRODUCT' ? 'FPR-' : 'FIN-') !== 0 || scope !== context.studyId || row[3] !== context.restricted ||
          typeof row[4] !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(row[4]) ||
          typeof registeredAt !== 'string' || isNaN(Date.parse(registeredAt)) || new Date(registeredAt).toISOString() !== registeredAt ||
          typeof author !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author) ||
          ids.indexOf(row[0]) !== -1 || requests.indexOf(row[4]) !== -1) throw new Error('Registro inválido.');
      ids.push(row[0]); requests.push(row[4]);
      var record = { id: row[0], type: row[1], requestId: row[4], registeredAt: registeredAt, author: author, data: data, dataJson: row[7] };
      records.push(record);
      if (record.type === 'PRODUCT') {
        if (JSON.stringify(farmaciaProductData_(data)) !== row[7] || productKeys.indexOf(farmaciaProductKey_(data)) !== -1) throw new Error('Produto duplicado ou inválido.');
        productKeys.push(farmaciaProductKey_(data)); products.push(record);
      }
    });
    records.filter(function(record) { return record.type === 'INITIAL'; }).forEach(function(record) {
      var data = record.data, product = products.find(function(item) { return item.id === data.productId; });
      var normalized = farmaciaInitialData_(data, product, true);
      if (JSON.stringify(normalized) !== record.dataJson || positions.indexOf(farmaciaPositionKey_(data)) !== -1 || initial.some(function(item) { return farmaciaSamePosition_(item.data, data); }) ||
          (data.kit && kits.indexOf(data.kit) !== -1)) throw new Error('Posição ou kit duplicado.');
      positions.push(farmaciaPositionKey_(data)); if (data.kit) kits.push(data.kit);
      initial.push(record);
    });
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Não propagar dados brutos ou identificadores de registros inconsistentes ao cliente.
    throw new Error('Registros do estoque da Farmácia inconsistentes. Nenhum saldo foi alterado.');
  }
  return { sheet: sheet, records: records, products: products, initial: initial };
}

function getFarmaciaEstoque(studyId, restricted) {
  var context = farmaciaContext_(studyId, restricted, 'read');
  var data = context.ss ? farmaciaReadLedger_(context) : { products: [], initial: [] };
  var today = farmaciaToday_();
  var locations = farmaciaReadLocations_();
  return { study: context.access.farmaciaStudy, restricted: restricted, configured: !!context.ss,
    locationsConfigured: locations.configured, storageUnits: locations.units,
    locationsCanManage: context.access.role === 'admin' || context.access.role === 'user',
    farmaciaAccess: context.access.farmaciaAccess, products: data.products.map(function(record) {
      return Object.assign({ id: record.id, registeredAt: record.registeredAt, author: record.author }, record.data);
    }), positions: data.initial.map(function(record) {
      var expired = record.data.expiry < today;
      return Object.assign({ id: record.id, registeredAt: record.registeredAt, author: record.author }, record.data, {
        storageCheck: farmaciaStorageCheck_(data.products.find(function(item) { return item.id === record.data.productId; }).data, record.data, locations.units),
        expired: expired, available: expired ? 0 : Math.round((record.data.physical - record.data.blocked) * 1000) / 1000,
        blocked: expired ? record.data.physical : record.data.blocked, initialBlocked: record.data.blocked
      });
    }) };
}

function farmaciaWrite_(payload, type) {
  payload = payload || {};
  return codexWithDocumentLock_('farmacia-' + type, function() {
    // Autorização e configuração frescas, dentro da seção protegida.
    var context = farmaciaContext_(payload.studyId, payload.restricted, 'manage');
    if (!context.ss) throw new Error('Armazenamento deste estudo e classe ainda não configurado.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(requestId)) throw new Error('Identificador da operação inválido.');
    var ledger = farmaciaReadLedger_(context);
    var data = type === 'PRODUCT' ? farmaciaProductData_(payload.data) : farmaciaInitialData_(payload.data,
      ledger.products.find(function(record) { return record.id === (payload.data || {}).productId; }), true);
    var dataJson = JSON.stringify(data);
    var previous = ledger.records.find(function(record) { return record.requestId === requestId; });
    if (previous) {
      if (type === 'INITIAL' && data.locationRef) {
        data.location = previous.data.location;
        dataJson = JSON.stringify(data);
      }
      if (previous.type !== type || previous.dataJson !== dataJson) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true };
    }
    if (type === 'PRODUCT' && !data.storage) throw new Error('Informe as condições de conservação, referência documental e versão do produto.');
    if (type === 'INITIAL') {
      var locations = farmaciaReadLocations_();
      var ref = data.locationRef;
      var unit = ref && locations.units.find(function(item) { return item.id === ref.unitId; });
      if (!unit || unit.positions.indexOf(ref.position) === -1) throw new Error('Selecione um equipamento e uma posição cadastrados.');
      // O rótulo é derivado do catálogo, nunca de texto enviado pelo cliente.
      data.location = unit.code + ' → ' + ref.position;
      dataJson = JSON.stringify(data);
    }
    if (type === 'INITIAL') farmaciaInitialData_(data, ledger.products.find(function(record) { return record.id === data.productId; }));
    if (type === 'PRODUCT' && ledger.products.some(function(record) { return farmaciaProductKey_(record.data) === farmaciaProductKey_(data); })) {
      throw new Error('Este produto já está cadastrado.');
    }
    if (type === 'INITIAL' && ledger.initial.some(function(record) {
      return farmaciaSamePosition_(record.data, data) || (data.kit && record.data.kit === data.kit);
    })) throw new Error('Esta posição ou kit já possui inventário inicial. Não repita a contagem como nova entrada.');
    var id = (type === 'PRODUCT' ? 'FPR-' : 'FIN-') + Utilities.getUuid();
    if (ledger.records.some(function(record) { return record.id === id; })) throw new Error('Não foi possível gerar um identificador único. Tente novamente.');
    var row = [id, type, JSON.stringify(context.studyId), context.restricted, requestId, JSON.stringify(new Date().toISOString()), JSON.stringify(context.access.userEmail), dataJson];
    var sheet = ledger.sheet || context.ss.insertSheet(FARMACIA_LEDGER_SHEET_);
    // Uma gravação para cabeçalho + primeiro registro, ou uma linha append-only.
    if (!sheet.getLastRow()) sheet.getRange(1, 1, 2, row.length).setValues([FARMACIA_LEDGER_HEADERS_.slice(), row]);
    else sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    // Auditoria detalhada permanece no arquivo segregado: autor, instante e payload imutável.
    return { ok: true, id: id, repeated: false };
  });
}

function cadastrarProdutoFarmacia(payload) {
  return farmaciaWrite_(payload, 'PRODUCT');
}

function registrarInventarioInicialFarmacia(payload) {
  return farmaciaWrite_(payload, 'INITIAL');
}
