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

function agendaOperationalRiskAlerts_(dados, dates) {
  dados = dados || {};
  if (!AgendaServerRules_.isLabCentral(dados.labCentral)) return [];
  var projectMap = getAgendaProjetoCourierMap_();
  var project = agendaProjetoCourierRecord_(projectMap, dados.projeto);
  var holidays = getAgendaFeriadosOperacionais_();
  var configs = getAgendaCourierConfigs_(false);
  var dateValues = (dates && dates.length ? dates : [dados.data]).map(function(value) {
    if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return feriadoDateIso_(value);
  }).filter(Boolean);
  var alerts = [];
  dateValues.forEach(function(dateIso) {
    var generalRisk = CodexCourierRiskRules_.operationalRisk(dateIso, {}, holidays);
    if (generalRisk.holiday) {
      alerts.push({
        code: 'HOLIDAY_DATE',
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
