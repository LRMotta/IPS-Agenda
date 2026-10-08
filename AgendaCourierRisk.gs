function agendaProjetoTemperaturasRead_(value) {
  var seen = {};
  return String(value || '').split(/[;,]/).map(function(item) { return String(item || '').trim(); }).filter(function(item) {
    var key = normText_(item);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function getAgendaProjetoCourierMap_() {
  var rows = getCodexSheetDataByName_('Projetos');
  if (!rows.length) return {};
  var courierCols = projetoCourierColumnMap_(rows[0]);
  var tempCols = projetoCourierTemperatureColumnMap_(rows[0]);
  var situacaoCol = projetoSituacaoEnvioColumn_(rows[0]);
  var out = {};
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var id = String(row[0] || '').trim();
    if (!id) continue;
    var links = [
      [courierCols.principal, tempCols.principal],
      [courierCols.adicional1, tempCols.adicional1],
      [courierCols.adicional2, tempCols.adicional2]
    ].map(function(pair) {
      var courierId = pair[0] >= 0 ? String(row[pair[0]] || '').trim() : '';
      return courierId ? { courierId: courierId, temperaturas: pair[1] >= 0 ? agendaProjetoTemperaturasRead_(row[pair[1]]) : [] } : null;
    }).filter(Boolean);
    out[id] = {
      id: id,
      nome: String(row[1] || '').trim(),
      codigo: String(row[2] || '').trim(),
      situacaoEnvioAmostras: situacaoCol >= 0 ? String(row[situacaoCol] || '').trim() : '',
      couriers: links
    };
  }
  return out;
}

function agendaProjetoCourierRecord_(projectMap, value) {
  var raw = String(value || '').trim();
  if (!raw) return null;
  if (projectMap && projectMap[raw]) return projectMap[raw];
  var normalized = normText_(raw);
  var keys = Object.keys(projectMap || {});
  for (var i = 0; i < keys.length; i++) {
    var record = projectMap[keys[i]] || {};
    if (normText_(record.nome) === normalized || normText_(record.codigo) === normalized) return record;
  }
  return null;
}

function agendaCourierConfigById_(configs, courierId) {
  var keys = Object.keys(configs || {});
  for (var i = 0; i < keys.length; i++) {
    var config = configs[keys[i]] || {};
    if (String(config.id || '').trim() === String(courierId || '').trim()) return config;
  }
  return null;
}

// O bootstrap da Agenda ja mantem estas tres referencias em cache e as invalida
// quando Projetos, couriers ou feriados mudam. Reutiliza-las no salvamento evita
// reler tres abas sem transformar o cache em fonte autoritativa: na ausencia de
// uma entrada valida, a leitura continua vindo diretamente das fontes.
function agendaOperationalRiskReferences_(holidaysOnly) {
  var started = Date.now();
  var cached = null;
  try {
    if (!(typeof CODEX_CACHE_BYPASS_READS_ !== 'undefined' && CODEX_CACHE_BYPASS_READS_) && typeof codexCacheGet_ === 'function' && typeof agendaReferenceCacheKey_ === 'function') {
      cached = codexCacheGet_(agendaReferenceCacheKey_());
    }
  } catch (e) {}
  if (cached && (holidaysOnly || (cached.projectCourierMap && cached.courierConfig)) && Array.isArray(cached.feriados)) {
    if (typeof feriadoLogPerformance_ === 'function') feriadoLogPerformance_('risk_reference_aggregate', started, { cacheHits: holidaysOnly ? 1 : 3, cacheMisses: 0 }, true);
    return {
      projectMap: holidaysOnly ? {} : cached.projectCourierMap,
      configs: holidaysOnly ? {} : cached.courierConfig,
      holidays: cached.feriados
    };
  }
  var metrics = { cacheHits: 0, cacheMisses: 0 };
  var parts = null;
  if (typeof agendaReferencePartsForRead_ === 'function') parts = agendaReferencePartsForRead_(false);
  function readPart(name, validate, load) {
    var key = parts && parts.keys[name];
    if (key && parts.cached[key]) {
      try {
        var entry = JSON.parse(parts.cached[key]);
        if (entry && entry.version === 1 && validate(entry.value)) {
          metrics.cacheHits++;
          return entry.value;
        }
      } catch (e) {}
    }
    metrics.cacheMisses++;
    var value = load();
    if (key && typeof agendaReferenceCacheSerializedBytes_ === 'function') {
      var serialized = JSON.stringify({ version: 1, value: value });
      if (agendaReferenceCacheSerializedBytes_(serialized) <= AGENDA_REFERENCE_CACHE_MAX_BYTES_) parts.pending[key] = serialized;
    }
    return value;
  }
  var success = false;
  try {
    var objectValid = function(value) { return !!value && typeof value === 'object' && !Array.isArray(value); };
    var result = {
      projectMap: holidaysOnly ? {} : readPart('project_courier_map', objectValid, getAgendaProjetoCourierMap_),
      configs: holidaysOnly ? {} : readPart('courier_config', objectValid, function() { return getAgendaCourierConfigs_(false); }),
      holidays: readPart('feriados', Array.isArray, getAgendaFeriadosOperacionais_)
    };
    if (parts && typeof agendaReferencePartsStore_ === 'function') agendaReferencePartsStore_(parts);
    success = true;
    return result;
  } finally {
    if (typeof feriadoLogPerformance_ === 'function') feriadoLogPerformance_('risk_reference_parts', started, metrics, success);
  }
}

function agendaOperationalRiskAlerts_(dados, dates) {
  dados = dados || {};
  var labCentral = AgendaServerRules_.isLabCentral(dados.labCentral);
  // O aviso geral precisa apenas de Feriados; sem Lab Central, evitar ler Projetos/couriers.
  var references = agendaOperationalRiskReferences_(!labCentral);
  var projectMap = references.projectMap;
  var project = agendaProjetoCourierRecord_(projectMap, dados.projeto);
  var holidays = CodexCourierRiskRules_.createHolidayIndex(references.holidays);
  var configs = references.configs;
  var dateValues = (dates && dates.length ? dates : [dados.data]).map(function(value) {
    if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return feriadoDateIso_(value);
  }).filter(Boolean);
  var alerts = [];
  dateValues.forEach(function(dateIso) {
    var generalHolidays = CodexCourierRiskRules_.holidayItemsForDate(dateIso, holidays, false);
    if (generalHolidays.length) {
      alerts.push({
        code: 'HOLIDAY_DATE',
        dateIso: dateIso,
        message: 'A data selecionada é feriado: ' + generalHolidays.map(function(item) { return item.nome || item.tipo || 'Feriado'; }).join(', ') + '. O agendamento continua permitido.'
      });
    }
    if (!labCentral) return;
    var generalRisk = CodexCourierRiskRules_.operationalRisk(dateIso, {}, holidays);
    if (generalRisk.holiday) {
      alerts.push({
        code: 'HOLIDAY_TRANSPORT_RISK',
        dateIso: dateIso,
        message: 'A data selecionada é feriado ou fechamento operacional. Operação de transporte de amostras sujeita a restrições. Confirme os procedimentos especiais necessários.'
      });
    }
    (project && project.couriers || []).forEach(function(link) {
      var dryIceTemperatures = CodexCourierRiskRules_.dryIceTemperatures(link.temperaturas);
      if (!dryIceTemperatures.length) return;
      var config = agendaCourierConfigById_(configs, link.courierId);
      if (!config) return;
      var risk = CodexCourierRiskRules_.operationalRisk(dateIso, config, holidays);
      var courierReasons = risk.reasons.filter(function(reason) { return reason.code !== 'HOLIDAY_DATE'; });
      if (!courierReasons.length) return;
      alerts.push({
        code: 'COURIER_DATE_RISK',
        dateIso: dateIso,
        courierId: link.courierId,
        courier: config.nome || config.courier || link.courierId,
        temperaturas: dryIceTemperatures,
        forneceGeloColeta: config.forneceGeloColeta || '',
        reasons: courierReasons,
        observacaoOperacional: config.observacaoOperacional || ''
      });
    });
  });
  return alerts;
}
