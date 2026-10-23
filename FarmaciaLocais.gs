// Catálogo físico compartilhado. Não contém ocupação, estudos, produtos ou tratamentos.
var FARMACIA_LOCATIONS_SHEET_ = 'Farmacia_Locais_v1';
var FARMACIA_LOCATIONS_HEADERS_ = ['ID', 'Tipo', 'Request_ID', 'Registrado_em_JSON', 'Autor_JSON', 'Dados_JSON'];

function getFarmaciaCatalogo() {
  var access = codexAssertCanRead_();
  var catalog = farmaciaReadLocations_();
  return farmaciaCatalogSnapshot_(catalog, access);
}

function farmaciaCatalogSnapshot_(catalog, access) {
  return { locationsConfigured: catalog.configured, locationsCanManage: access.role === 'admin' || access.role === 'user',
    storageUnits: catalog.units };
}

function farmaciaTemperatureRange_(min, max) {
  if (min === null && max === null) return { min: null, max: null };
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) ||
      min < -200 || max > 100 || min >= max || !Number.isInteger(min * 10) || !Number.isInteger(max * 10)) {
    throw new Error('Informe limites de temperatura válidos, mínimo menor que máximo, com até uma casa decimal.');
  }
  return { min: min, max: max };
}

function farmaciaConservationData_(value) {
  if (!value || typeof value !== 'object') throw new Error('Informe as condições de conservação e sua referência.');
  var range = farmaciaTemperatureRange_(value.min, value.max);
  return { min: range.min, max: range.max,
    instructions: farmaciaText_(value.instructions, 'as instruções de conservação', 500, range.min !== null),
    source: farmaciaText_(value.source, 'a referência documental', 250),
    version: farmaciaText_(value.version, 'a versão ou data da referência', 100) };
}

function farmaciaLocationData_(value) {
  value = value || {};
  if (['cabinet', 'refrigerator', 'freezer', 'other'].indexOf(value.type) === -1) throw new Error('Selecione o tipo de equipamento.');
  if (['active', 'maintenance', 'unavailable'].indexOf(value.status) === -1) throw new Error('Selecione uma situação válida.');
  if (!Array.isArray(value.positions) || !value.positions.length || value.positions.length > 100) throw new Error('Informe de 1 a 100 posições.');
  var positions = value.positions.map(function(position) { return farmaciaText_(position, 'a posição', 80); });
  if (new Set(positions.map(function(position) { return position.toLowerCase(); })).size !== positions.length) throw new Error('Há posições duplicadas.');
  var range = farmaciaTemperatureRange_(value.min, value.max);
  var result = { code: farmaciaText_(value.code, 'o código interno do equipamento', 60), type: value.type,
    model: farmaciaText_(value.model, 'o fabricante e modelo', 160, true), room: farmaciaText_(value.room, 'a sala', 120),
    min: range.min, max: range.max,
    sensor: farmaciaText_(value.sensor, 'o identificador do sensor', 100, true), status: value.status, positions: positions };
  // Opcional para preservar o JSON canônico dos registros anteriores no replay.
  if (Object.prototype.hasOwnProperty.call(value, 'layout')) {
    if (value.layout === null) result.layout = null;
    else {
      var layout = value.layout;
      if (!layout || !Number.isInteger(layout.columns) || !Number.isInteger(layout.drawersPerColumn) ||
          layout.columns < 1 || layout.drawersPerColumn < 1 || layout.columns * layout.drawersPerColumn !== positions.length) {
        throw new Error('Confira as colunas e gavetas por coluna: o total deve corresponder às posições cadastradas (até 100).');
      }
      result.layout = { columns: layout.columns, drawersPerColumn: layout.drawersPerColumn };
    }
  }
  return result;
}

function farmaciaLocationStatusData_(value) {
  value = value || {};
  if (['active', 'maintenance', 'unavailable'].indexOf(value.status) === -1 || !Number.isInteger(value.revision) || value.revision < 1) throw new Error('Situação ou revisão do equipamento inválida.');
  return { unitId: farmaciaText_(value.unitId, 'o equipamento', 100), revision: value.revision,
    status: value.status, reason: farmaciaText_(value.reason, 'o motivo da alteração', 250) };
}

function farmaciaProbeData_(value) {
  value = value || {};
  var result = { unitId: farmaciaText_(value.unitId, 'o equipamento da sonda', 100),
    code: farmaciaText_(value.code, 'o número interno da sonda', 80),
    serial: farmaciaText_(value.serial, 'o número de série da sonda', 120),
    model: farmaciaText_(value.model, 'o fabricante e modelo da sonda', 160),
    point: farmaciaText_(value.point, 'o ponto de instalação da sonda', 120, true) };
  if (Object.prototype.hasOwnProperty.call(value, 'calibration')) result.calibration = farmaciaCalibrationData_(value.calibration);
  return result;
}

function farmaciaCalibrationData_(value) {
  value = value || {};
  if (['current', 'pending', 'out_of_service'].indexOf(value.status) === -1) throw new Error('Selecione a situação da calibração.');
  var calibratedOn = value.calibratedOn ? farmaciaDate_(value.calibratedOn, 'a data da calibração') : '';
  var validUntil = value.validUntil ? farmaciaDate_(value.validUntil, 'a validade da calibração') : '';
  var certificate = farmaciaText_(value.certificate, 'a referência do certificado', 250, value.status !== 'current');
  if ((value.status === 'current' && (!calibratedOn || !validUntil)) || calibratedOn > farmaciaToday_() ||
      (calibratedOn && validUntil && calibratedOn > validUntil)) throw new Error('Confira as datas da calibração e a validade documentada, sem presumir um prazo.');
  return {status:value.status,calibratedOn:calibratedOn,validUntil:validUntil,certificate:certificate,note:farmaciaText_(value.note,'a observação da calibração',500,true)};
}

function farmaciaCalibrationUpdateData_(value) {
  value = value || {};
  if (!Number.isInteger(value.revision) || value.revision < 1) throw new Error('Revisão da sonda inválida.');
  return {unitId:farmaciaText_(value.unitId,'o equipamento',100),probeId:farmaciaText_(value.probeId,'a sonda',100),revision:value.revision,calibration:farmaciaCalibrationData_(value.calibration)};
}

function farmaciaProbeDuplicate_(units, data) {
  return units.some(function(unit) {
    return unit.probes.some(function(probe) { return probe.code.toLowerCase() === data.code.toLowerCase() || probe.serial.toLowerCase() === data.serial.toLowerCase(); });
  });
}

function farmaciaReadLocations_() {
  // Metadados físicos não contêm informações de estudos. Sem arquivo dedicado,
  // usa a planilha do app; a aba e os cabeçalhos só são criados ao salvar sob lock.
  // Configuração inválida continua falhando antes do fallback.
  var ss = farmaciaStorage_('@IPS_LOCATIONS', false) || getCodexSpreadsheet_();
  var sheet = ss && ss.getSheetByName(FARMACIA_LOCATIONS_SHEET_);
  var result = { configured: !!ss, ss: ss, sheet: sheet, units: [], records: [], rows: [] };
  if (!sheet || !sheet.getLastRow()) return result;
  var rows = sheet.getDataRange().getValues();
  return farmaciaParseLocationRows_(result, rows);
}

// Replaying validated rows in memory also prepares the post-write response without another Sheets read.
function farmaciaParseLocationRows_(result, rows) {
  result.rows = rows;
  if (rows[0].length !== FARMACIA_LOCATIONS_HEADERS_.length || FARMACIA_LOCATIONS_HEADERS_.some(function(header, i) { return rows[0][i] !== header; })) throw new Error('Estrutura do catálogo de locais divergente.');
  var ids = [], requests = [];
  try {
    rows.slice(1).forEach(function(row) {
      if (row.every(function(cell) { return cell === ''; })) return;
      var data = JSON.parse(row[5]), author = JSON.parse(row[4]), at = JSON.parse(row[3]);
      // Descontinuados no equipamento; aceita também registros antigos com campos vazios.
      var equipmentData = row[1] === 'UNIT' ? data : row[1] === 'CATALOG_EDIT' && data.kind === 'unit' ? data.values : null;
      if (equipmentData) { delete equipmentData.source; delete equipmentData.version; }
      if (typeof row[0] !== 'string' || !/^FLR-[A-Za-z0-9_-]+$/.test(row[0]) || ids.indexOf(row[0]) !== -1 ||
          typeof row[2] !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(row[2]) || requests.indexOf(row[2]) !== -1 ||
          typeof at !== 'string' || isNaN(Date.parse(at)) || new Date(at).toISOString() !== at ||
          typeof author !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author)) throw new Error('Registro inválido.');
      ids.push(row[0]); requests.push(row[2]);
      if (row[1] === 'UNIT') {
        if (JSON.stringify(farmaciaLocationData_(data)) !== JSON.stringify(data) || result.units.some(function(unit) { return unit.code.toLowerCase() === data.code.toLowerCase(); })) throw new Error('Equipamento inválido.');
        result.units.push(Object.assign({ id: row[0], revision: 1, author: author, registeredAt: at, probes: [] }, data));
      } else if (row[1] === 'PROBE') {
        if (JSON.stringify(farmaciaProbeData_(data)) !== row[5] || farmaciaProbeDuplicate_(result.units, data)) throw new Error('Sonda inválida ou duplicada.');
        var equipment = result.units.find(function(item) { return item.id === data.unitId; });
        if (!equipment) throw new Error('Equipamento da sonda não encontrado.');
        equipment.probes.push(Object.assign({id:row[0],revision:1,author:author,registeredAt:at,calibrationAuthor:author,calibrationRegisteredAt:at,calibrationHistory:[]},data));
      } else if (row[1] === 'CALIBRATION') {
        if (JSON.stringify(farmaciaCalibrationUpdateData_(data)) !== row[5]) throw new Error('Calibração inválida.');
        var owner = result.units.find(function(item) { return item.id === data.unitId; });
        var probe = owner && owner.probes.find(function(item) { return item.id === data.probeId; });
        if (!probe || probe.deleted || probe.revision !== data.revision) throw new Error('Revisão da sonda inválida.');
        if (probe.calibration) probe.calibrationHistory.unshift({calibration:probe.calibration,author:probe.calibrationAuthor || probe.author,registeredAt:probe.calibrationRegisteredAt || probe.registeredAt});
        probe.calibrationAuthor = author; probe.calibrationRegisteredAt = at;
        probe.calibration = data.calibration; probe.revision++; probe.author = author; probe.registeredAt = at;
      } else if (row[1] === 'CATALOG_EDIT' || row[1] === 'CATALOG_DELETE') {
        if (JSON.stringify(farmaciaCatalogChangeData_(data,row[1])) !== JSON.stringify(data)) throw new Error('Alteração inválida.');
        farmaciaApplyCatalogChange_(result.units,data,row[1],author,at);
      } else if (row[1] === 'STATUS') {
        if (JSON.stringify(farmaciaLocationStatusData_(data)) !== row[5]) throw new Error('Situação inválida.');
        var unit = result.units.find(function(item) { return item.id === data.unitId; });
        if (!unit || unit.deleted || unit.revision !== data.revision) throw new Error('Revisão inválida.');
        unit.status = data.status; unit.revision++; unit.author = author; unit.registeredAt = at;
      } else throw new Error('Tipo inválido.');
      result.records.push({ id: row[0], type: row[1], requestId: row[2], dataJson: row[5] });
    });
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Não expor o conteúdo bruto de registros inconsistentes.
    throw new Error('Registros do catálogo de locais inconsistentes. Revise o arquivo.');
  }
  result.units.forEach(function(unit) {
    unit.probes.forEach(function(probe) {
      var calibration = probe.calibration;
      probe.calibrationStatus = !calibration ? 'pending' : calibration.status === 'current' && calibration.validUntil < farmaciaToday_() ? 'expired' : calibration.status;
    });
  });
  return result;
}

function farmaciaWriteLocation_(payload, type) {
  payload = payload || {};
  var operation = 'farmacia-location-' + type, startedAt = Date.now(), success = false, rowCount = 0;
  try {
  var result = codexWithDocumentLock_(operation, function() {
    var access = codexAssertCanWrite_('farmacia-location-' + type, 'Farmacia_Locais');
    var readStartedAt = Date.now();
    var catalog = farmaciaReadLocations_();
    rowCount = catalog.records.length;
    codexLogPerformance_(operation, 'read_catalog', Date.now() - readStartedAt, { rowCount: rowCount }, true);
    if (!catalog.configured) throw new Error('Catálogo de locais ainda não configurado.');
    var requestId = farmaciaText_(payload.requestId, 'o identificador da operação', 100);
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(requestId)) throw new Error('Identificador da operação inválido.');
    var data = type === 'CATALOG_EDIT' || type === 'CATALOG_DELETE' ? farmaciaCatalogChangeData_(payload.data,type) : type === 'UNIT' ? farmaciaLocationData_(payload.data) : type === 'PROBE' ? farmaciaProbeData_(payload.data) : type === 'CALIBRATION' ? farmaciaCalibrationUpdateData_(payload.data) : farmaciaLocationStatusData_(payload.data);
    var dataJson = JSON.stringify(data);
    var previous = catalog.records.find(function(record) { return record.requestId === requestId; });
    if (previous) {
      if (previous.type !== type || previous.dataJson !== dataJson) throw new Error('Esta operação já foi usada com outros dados.');
      return { ok: true, id: previous.id, repeated: true, catalog: farmaciaCatalogSnapshot_(catalog, access) };
    }
    if (type === 'UNIT' && catalog.units.some(function(unit) { return unit.code.toLowerCase() === data.code.toLowerCase(); })) throw new Error('Código de equipamento já cadastrado.');
    if (type === 'PROBE') {
      if (!data.calibration) throw new Error('Informe a situação de calibração da sonda.');
      if (!catalog.units.some(function(unit) { return unit.id === data.unitId && !unit.deleted; })) throw new Error('Equipamento da sonda não encontrado.');
      if (farmaciaProbeDuplicate_(catalog.units, data)) throw new Error('Número interno ou número de série da sonda já cadastrado em um equipamento.');
    }
    if (type === 'CALIBRATION') {
      var owner = catalog.units.find(function(item) { return item.id === data.unitId; });
      var probe = owner && owner.probes.find(function(item) { return item.id === data.probeId; });
      if (!probe || probe.revision !== data.revision) throw new Error('A sonda mudou. Atualize o estoque antes de alterar a calibração.');
    }
    if (type === 'STATUS') {
      var unit = catalog.units.find(function(item) { return item.id === data.unitId; });
      if (!unit || unit.revision !== data.revision) throw new Error('O equipamento mudou. Atualize o estoque antes de alterar sua situação.');
    }
    if (type === 'CATALOG_EDIT' || type === 'CATALOG_DELETE') farmaciaApplyCatalogChange_(catalog.units,data,type,access.userEmail,new Date().toISOString());
    var id = 'FLR-' + Utilities.getUuid();
    if (catalog.records.some(function(record) { return record.id === id; })) throw new Error('Identificador não exclusivo. Tente novamente.');
    var row = [id, type, requestId, JSON.stringify(new Date().toISOString()), JSON.stringify(access.userEmail), dataJson];
    var rows = catalog.rows.length ? catalog.rows.concat([row]) : [FARMACIA_LOCATIONS_HEADERS_.slice(), row];
    var updated = farmaciaParseLocationRows_({ configured: true, units: [], records: [] }, rows);
    var snapshot = farmaciaCatalogSnapshot_(updated, access);
    var persistStartedAt = Date.now();
    var sheet = catalog.sheet || catalog.ss.insertSheet(FARMACIA_LOCATIONS_SHEET_);
    var lastRow = catalog.rows.length;
    if (!lastRow) sheet.getRange(1, 1, 2, row.length).setValues([FARMACIA_LOCATIONS_HEADERS_.slice(), row]);
    else sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
    codexLogPerformance_(operation, 'persist', Date.now() - persistStartedAt, { rowCount: rowCount + 1 }, true);
    return { ok: true, id: id, repeated: false, catalog: snapshot };
  }, { operation: operation });
  success = true;
  return result;
  } finally {
    codexLogPerformance_(operation, 'total', Date.now() - startedAt, { rowCount: rowCount }, success);
  }
}

function cadastrarLocalFarmacia(payload) {
  return farmaciaWriteLocation_(payload, 'UNIT');
}

function atualizarSituacaoLocalFarmacia(payload) {
  return farmaciaWriteLocation_(payload, 'STATUS');
}

function cadastrarSondaFarmacia(payload) {
  return farmaciaWriteLocation_(payload, 'PROBE');
}

function atualizarCalibracaoSondaFarmacia(payload) {
  return farmaciaWriteLocation_(payload, 'CALIBRATION');
}

function farmaciaStorageCheck_(product, position, units) {
  var ref = position.locationRef;
  var unit = ref && units.find(function(item) { return item.id === ref.unitId; });
  if (!unit || unit.positions.indexOf(ref.position) === -1) return { status: 'pending', message: 'Localização histórica ou sem vínculo com o catálogo. Conferir.' };
  if (unit.status !== 'active') return { status: 'unavailable', message: 'Equipamento em manutenção ou indisponível. Revisar armazenamento.' };
  var storage = product.storage;
  if (!storage || storage.min === null || unit.min === null) return { status: 'pending', message: 'Faixa documental pendente. Conferir condições de conservação.' };
  if (unit.min < storage.min || unit.max > storage.max) return { status: 'incompatible', message: 'Faixa do equipamento incompatível com a faixa do produto. Revisar armazenamento.' };
  return { status: 'compatible', message: 'Faixas cadastradas compatíveis. Não comprova temperatura medida nem outras condições.' };
}
