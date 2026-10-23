// Consolidação explícita dos arquivos v1. Consultas normais nunca abrem arquivos externos.
function farmaciaMigrationSources_(raw, primaryId) {
  if (!raw) return [];
  var config;
  try { config = JSON.parse(raw); } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Não expor configuração bruta.
    throw new Error('Configuração antiga da Farmácia inválida.');
  }
  if (config && config.version === 2 && config.spreadsheetId === primaryId) return [];
  if (!config || config.version !== 1 || !Array.isArray(config.studies) || config.studies.length > 200 || raw.length > 50000) throw new Error('Configuração antiga da Farmácia inválida.');
  var result = [], files = [], studies = [];
  function add(id, studyId, restricted, locations) {
    if (id === undefined || id === '') return;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(id) || id === primaryId || files.indexOf(id) !== -1) throw new Error('Arquivos antigos da Farmácia inválidos ou duplicados.');
    files.push(id);
    result.push({ id: id, studyId: studyId, restricted: restricted, locations: locations });
  }
  add(config.common, FARMACIA_COMMON_SCOPE_, false, false);
  add(config.locations, '@IPS_LOCATIONS', false, true);
  config.studies.forEach(function(entry) {
    var id = entry && entry.studyId;
    if (typeof id !== 'string' || !id || id !== id.trim() || id.length > 120 || id === '*' || id === FARMACIA_COMMON_SCOPE_ || id === '@IPS_LOCATIONS' || studies.indexOf(id) !== -1) throw new Error('Estudos na configuração antiga inválidos.');
    studies.push(id);
    add(entry.standard, id, false, false);
    add(entry.restricted, id, true, false);
  });
  return result;
}

function farmaciaMigrationRows_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || !sheet.getLastRow()) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows[0].length !== headers.length || headers.some(function(header, i) { return header !== rows[0][i]; })) throw new Error('Estrutura da Farmácia divergente. Migração cancelada.');
  return rows.slice(1).filter(function(row) { return !row.every(function(cell) { return cell === ''; }); });
}

function farmaciaMigrationScope_(row) {
  var scope;
  try { scope = JSON.parse(row[2]); } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- Não expor registros brutos.
    throw new Error('Contexto de registro inválido. Migração cancelada.');
  }
  if (typeof scope !== 'string' || !scope || scope !== scope.trim() || scope === '*' || scope === '@IPS_LOCATIONS' || typeof row[3] !== 'boolean' || (scope === FARMACIA_COMMON_SCOPE_ && row[3])) throw new Error('Contexto de registro inválido. Migração cancelada.');
  return { studyId: scope, restricted: row[3] };
}

function farmaciaMigrationMerge_(target, incoming, locations) {
  var appended = [];
  incoming.forEach(function(row) {
    var context = locations ? '' : JSON.stringify([row[2], row[3]]);
    var idMatch = target.find(function(item) { return item[0] === row[0]; });
    var requestMatch = target.find(function(item) {
      return item[locations ? 2 : 4] === row[locations ? 2 : 4] && (locations || JSON.stringify([item[2], item[3]]) === context);
    });
    if (idMatch || requestMatch) {
      if ((!idMatch || JSON.stringify(idMatch) === JSON.stringify(row)) && (!requestMatch || JSON.stringify(requestMatch) === JSON.stringify(row))) return;
      throw new Error('Colisão de identificador ou operação na Farmácia. Migração cancelada.');
    }
    target.push(row); appended.push(row);
  });
  return appended;
}

function farmaciaMigrationValidateLedger_(rows) {
  var contexts = [], ids = [];
  rows.forEach(function(row) {
    if (ids.indexOf(row[0]) !== -1) throw new Error('Identificador duplicado no destino. Migração cancelada.');
    ids.push(row[0]);
    var context = farmaciaMigrationScope_(row);
    if (!contexts.some(function(item) { return item.studyId === context.studyId && item.restricted === context.restricted; })) contexts.push(context);
  });
  contexts.forEach(function(context) { farmaciaParseLedgerRows_(context, null, [FARMACIA_LEDGER_HEADERS_].concat(rows)); });
}

function farmaciaMigrationPlan_() {
  var ss = getCodexSpreadsheet_();
  var raw = PropertiesService.getScriptProperties().getProperty('FARMACIA_STORAGE_V1') || '';
  var sources = farmaciaMigrationSources_(raw, ss.getId());
  var ledger = farmaciaMigrationRows_(ss, FARMACIA_LEDGER_SHEET_, FARMACIA_LEDGER_HEADERS_);
  var locations = farmaciaMigrationRows_(ss, FARMACIA_LOCATIONS_SHEET_, FARMACIA_LOCATIONS_HEADERS_);
  // Valida o destino sem deduplicar dados que já estão corrompidos nele.
  farmaciaMigrationValidateLedger_(ledger);
  if (locations.length) farmaciaParseLocationRows_({ units: [], records: [] }, [FARMACIA_LOCATIONS_HEADERS_].concat(locations));
  var ledgerAppend = [], locationsAppend = [];
  sources.forEach(function(source) {
    var external = SpreadsheetApp.openById(source.id);
    var name = source.locations ? FARMACIA_LOCATIONS_SHEET_ : FARMACIA_LEDGER_SHEET_;
    if (external.getSheets().some(function(sheet) { return sheet.getName() !== name && sheet.getLastRow() > 0; })) throw new Error('Arquivo antigo contém dados de outros módulos. Migração cancelada.');
    var rows = farmaciaMigrationRows_(external, name, source.locations ? FARMACIA_LOCATIONS_HEADERS_ : FARMACIA_LEDGER_HEADERS_);
    if (source.locations) {
      if (rows.length) farmaciaParseLocationRows_({ units: [], records: [] }, [FARMACIA_LOCATIONS_HEADERS_].concat(rows));
      locationsAppend = locationsAppend.concat(farmaciaMigrationMerge_(locations, rows, true));
    } else {
      rows.forEach(function(row) {
        var context = farmaciaMigrationScope_(row);
        if (context.studyId !== source.studyId || context.restricted !== source.restricted) throw new Error('Arquivo antigo contém outro estudo ou classe. Migração cancelada.');
      });
      if (rows.length) farmaciaParseLedgerRows_(source, null, [FARMACIA_LEDGER_HEADERS_].concat(rows));
      ledgerAppend = ledgerAppend.concat(farmaciaMigrationMerge_(ledger, rows, false));
    }
  });
  farmaciaMigrationValidateLedger_(ledger);
  if (locations.length) farmaciaParseLocationRows_({ units: [], records: [] }, [FARMACIA_LOCATIONS_HEADERS_].concat(locations));
  var fingerprint = codexRecordVersionFromValues_([ss.getId(), raw, JSON.stringify(ledger), JSON.stringify(locations)]);
  return { ss: ss, ledgerAppend: ledgerAppend, locationsAppend: locationsAppend,
    summary: { fingerprint: fingerprint, files: sources.length, ledgerRows: ledger.length, locationRows: locations.length,
      ledgerRowsToImport: ledgerAppend.length, locationRowsToImport: locationsAppend.length } };
}

function getFarmaciaMigracaoPreview() {
  codexAssertAdmin_();
  return farmaciaMigrationPlan_().summary;
}

function farmaciaMigrationAppend_(ss, name, headers, rows) {
  if (!rows.length) return;
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var last = sheet.getLastRow();
  var values = last ? rows : [headers.slice()].concat(rows);
  if (last + values.length > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), last + values.length - sheet.getMaxRows());
  sheet.getRange(last + 1, 1, values.length, headers.length).setValues(values);
}

function migrarFarmaciaParaArquivoPrincipal(payload) {
  codexAssertAdmin_();
  return codexWithDocumentLock_('farmacia-migracao-principal', function() {
    codexAssertAdmin_();
    var plan = farmaciaMigrationPlan_();
    if (!payload || payload.confirm !== true || payload.fingerprint !== plan.summary.fingerprint) throw new Error('Revise a prévia atual da migração antes de confirmar.');
    farmaciaMigrationAppend_(plan.ss, FARMACIA_LEDGER_SHEET_, FARMACIA_LEDGER_HEADERS_, plan.ledgerAppend);
    farmaciaMigrationAppend_(plan.ss, FARMACIA_LOCATIONS_SHEET_, FARMACIA_LOCATIONS_HEADERS_, plan.locationsAppend);
    // Só muda o modo após ambas as escritas; retry reconhece eventos idênticos já copiados.
    PropertiesService.getScriptProperties().setProperty('FARMACIA_STORAGE_V1', JSON.stringify({ version: 2, spreadsheetId: plan.ss.getId() }));
    return { ok: true, ledgerRowsImported: plan.ledgerAppend.length, locationRowsImported: plan.locationsAppend.length };
  });
}
