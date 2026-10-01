// Apenas contagens e duracoes: nenhum dado do cadastro entra na telemetria.
function feriadoLogPerformance_(stage, started, metrics, success) {
  try {
    var payload = { stage: stage, durationMs: Math.max(0, Date.now() - started), success: success === true };
    ['rowCount', 'cellsRead', 'readCalls', 'cacheHits', 'cacheMisses'].forEach(function(key) {
      if (metrics[key] !== undefined) payload[key] = Math.max(0, Number(metrics[key]) || 0);
    });
    Logger.log('[CODEX_FERIADOS_PERF] ' + JSON.stringify(payload));
  } catch (e) {} // Telemetria nao altera o resultado observado.
}

var FERIADO_HEADERS_ = [
  'ID', 'Data', 'Nome', 'Tipo', 'Abrangência', 'Operação de transporte de amostras sujeita a restrições', 'Ativo', 'Observação', 'Recorrência'
];

function feriadoHeaderIndex_(headers, aliases) {
  var normalized = (headers || []).map(function(value) { return normText_(value); });
  for (var i = 0; i < aliases.length; i++) {
    var index = normalized.indexOf(normText_(aliases[i]));
    if (index >= 0) return index;
  }
  return -1;
}

function feriadoDateIso_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var raw = String(value || '').trim();
  var match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  var year, month, day;
  if (match) {
    year = match[1]; month = Number(match[2]); day = Number(match[3]);
  } else {
    var normalized = normText_(raw);
    match = normalized.match(/^(\d{1,2})\/(\d{1,2}|[a-z]{3,}\.?)\/(\d{4})$/);
    if (!match) return '';
    var months = {
      jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3,
      abr: 4, abril: 4, mai: 5, maio: 5, jun: 6, junho: 6,
      jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9,
      out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12
    };
    year = match[3]; day = Number(match[1]);
    month = Number(match[2]) || months[match[2].replace(/\.$/, '')];
  }
  var iso = year + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
  return CodexCourierRiskRules_.parseIso(iso) ? iso : '';
}

function feriadoSheetForRead_() {
  return getSheetByPossibleNames_(getCodexSpreadsheet_(), ['Feriados', 'Feriado']);
}

function feriadoSchemaHeaderAliases_(header) {
  var aliases = {
    ID: ['ID', 'ID Feriado'],
    Data: ['Data', 'Data do feriado'],
    Nome: ['Nome', 'Feriado', 'Descrição'],
    'Abrangência': ['Abrangência', 'Escopo'],
    'Operação de transporte de amostras sujeita a restrições': ['Operação de transporte de amostras sujeita a restrições', 'Afeta operação/coletas', 'Afeta operação']
  };
  return aliases[header] || [header];
}

function feriadoFieldMap_(headers) {
  var fields = ['id', 'dataIso', 'nome', 'tipo', 'abrangencia', 'afetaOperacao', 'ativo', 'observacao', 'recorrencia'];
  var out = {};
  FERIADO_HEADERS_.forEach(function(header, index) {
    out[fields[index]] = feriadoHeaderIndex_(headers, feriadoSchemaHeaderAliases_(header));
  });
  return out;
}

// Resolva identidade e ambiguidade antes de qualquer alteracao de schema ou dados.
function feriadoFindRowForId_(sh, id, context) {
  if (!sh || sh.getLastRow() < 2) throw new Error('Feriado não encontrado.');
  var headers = context ? context.headers : sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  var idCol = feriadoFieldMap_(headers).id;
  if (idCol < 0) throw new Error('Coluna de ID dos feriados não encontrada.');
  var ids = sh.getRange(2, idCol + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  var rowNumber = 0;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() !== id) continue;
    if (rowNumber) throw new Error('ID de feriado duplicado. Corrija o cadastro antes de editar ou excluir.');
    rowNumber = i + 2;
  }
  if (!rowNumber) throw new Error('Feriado não encontrado.');
  return rowNumber;
}

function feriadoWriteContext_() {
  var ss = getCodexSpreadsheet_();
  var sh = getSheetByPossibleNames_(ss, ['Feriados', 'Feriado']);
  var headers = sh && sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0] : [];
  return { spreadsheet: ss, sheet: sh, headers: headers };
}

function feriadoSheetForWrite_(context) {
  context = context || feriadoWriteContext_();
  var ss = context.spreadsheet;
  var sh = context.sheet;
  if (!sh) sh = ss.insertSheet('Feriados');
  var headers = context.headers;
  if (sh.getLastRow() === 0) {
    headers = FERIADO_HEADERS_.slice();
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var missing = FERIADO_HEADERS_.filter(function(header) {
      return feriadoHeaderIndex_(headers, feriadoSchemaHeaderAliases_(header)) < 0;
    });
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
      headers = headers.concat(missing);
    }
  }
  sh.setFrozenRows(1);
  context.headers = headers;
  context.sheet = sh;
  var idCol = feriadoFieldMap_(headers).id;
  try { if (idCol >= 0) sh.hideColumns(idCol + 1); } catch (e) {}
  return sh;
}

function getFeriadosCadastro_() {
  var started = Date.now();
  var metrics = { rowCount: 0, readCalls: 0, cellsRead: 0 };
  var success = false;
  try {
    var result = feriadoReadCadastro_(metrics);
    success = true;
    return result;
  } finally { feriadoLogPerformance_('cadastro', started, metrics, success); }
}

function feriadoReadCadastro_(metrics) {
  var sh = feriadoSheetForRead_();
  var lastRow = sh ? sh.getLastRow() : 0;
  if (lastRow < 2) return [];
  var lastCol = sh.getLastColumn();
  var display = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  metrics.rowCount = lastRow - 1;
  metrics.readCalls = 1;
  metrics.cellsRead = lastRow * lastCol;
  var headers = display[0];
  var idx = feriadoFieldMap_(headers);
  // Somente Data precisa do valor bruto (Date). Os demais campos preservam
  // a representacao exibida, inclusive IDs com formatacao no cadastro legado.
  var dates = idx.dataIso >= 0 ? sh.getRange(2, idx.dataIso + 1, lastRow - 1, 1).getValues() : [];
  if (idx.dataIso >= 0) { metrics.readCalls++; metrics.cellsRead += lastRow - 1; }
  var out = [];
  for (var rowIndex = 1; rowIndex < display.length; rowIndex++) {
    var shown = display[rowIndex];
    var dataIso = feriadoDateIso_(idx.dataIso >= 0 ? dates[rowIndex - 1][0] : '');
    var nome = idx.nome >= 0 ? String(shown[idx.nome] || '').trim() : '';
    if (!dataIso && !nome) continue;
    out.push({
      id: idx.id >= 0 ? String(shown[idx.id] || '').trim() : '',
      dataIso: dataIso,
      data: dataIso,
      nome: nome || 'Feriado',
      tipo: idx.tipo >= 0 ? String(shown[idx.tipo] || '').trim() : 'Feriado',
      abrangencia: idx.abrangencia >= 0 ? String(shown[idx.abrangencia] || '').trim() : '',
      afetaOperacao: idx.afetaOperacao >= 0 ? String(shown[idx.afetaOperacao] || '').trim() || 'Sim' : 'Sim',
      ativo: idx.ativo >= 0 ? String(shown[idx.ativo] || '').trim() || 'Sim' : 'Sim',
      observacao: idx.observacao >= 0 ? String(shown[idx.observacao] || '').trim() : '',
      recorrencia: idx.recorrencia >= 0 ? String(shown[idx.recorrencia] || '').trim() || 'Data específica' : 'Data específica',
      legado: false,
      rowIndex: rowIndex + 1
    });
  }
  return out.sort(function(a, b) { return a.dataIso.localeCompare(b.dataIso) || a.nome.localeCompare(b.nome, 'pt-BR'); });
}

function feriadoValidatePayload_(dados) {
  dados = dados || {};
  var dataIso = feriadoDateIso_(dados.dataIso || dados.data);
  var nome = String(dados.nome || '').trim();
  if (!dataIso) throw new Error('Informe uma data válida para o feriado ou emenda.');
  if (!nome) throw new Error('Informe o nome do feriado ou emenda.');
  var tipo = String(dados.tipo || 'Feriado').trim() || 'Feriado';
  var afetaOperacao = String(dados.afetaOperacao || 'Sim').trim() || 'Sim';
  var ativo = String(dados.ativo || 'Sim').trim() || 'Sim';
  var recorrencia = String(dados.recorrencia || 'Data específica').trim() || 'Data específica';
  if (['Sim', 'Não'].indexOf(afetaOperacao) < 0) throw new Error('Operação de transporte de amostras sujeita a restrições deve ser Sim ou Não.');
  if (['Sim', 'Não'].indexOf(ativo) < 0) throw new Error('Ativo deve ser Sim ou Não.');
  if (['Data específica', 'Anual'].indexOf(recorrencia) < 0) throw new Error('Recorrência deve ser Data específica ou Anual.');
  return {
    id: String(dados.id || '').trim(),
    dataIso: dataIso,
    nome: nome,
    tipo: tipo,
    abrangencia: String(dados.abrangencia || '').trim(),
    afetaOperacao: afetaOperacao,
    ativo: ativo,
    observacao: String(dados.observacao || '').trim(),
    recorrencia: recorrencia
  };
}

function feriadoClearCaches_() {
  agendaInvalidateReferenceDataCache_(['feriados']);
  var day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  ['AgendaFormData:v8:', 'AgendaFormData:v9:', 'AgendaFormDataStrict:v2:', 'AgendaFormDataStrict:v3:', 'AgendaBootstrapReferenceData:v1:', 'AgendaBootstrapReferenceData:v2:'].forEach(function(prefix) {
    codexCacheRemove_(prefix + day);
  });
}

function salvarFeriado(dados) {
  codexAssertCanWrite_('salvarFeriado', 'Cadastros', dados && dados.id);
  var item = feriadoValidatePayload_(dados);
  return codexWithDocumentLock_('salvarFeriado', function() {
    var started = Date.now();
    var context = feriadoWriteContext_();
    var rowNumber = item.id ? feriadoFindRowForId_(context.sheet, item.id, context) : 0;
    var sh = feriadoSheetForWrite_(context);
    var headers = context.headers;
    var lastCol = headers.length;
    var fieldMap = feriadoFieldMap_(headers);
    if (!item.id) item.id = 'FER-' + Utilities.getUuid();
    var row = rowNumber
      ? sh.getRange(rowNumber, 1, 1, lastCol).getValues()[0]
      : new Array(lastCol).fill('');
    Object.keys(fieldMap).forEach(function(key) {
      if (fieldMap[key] >= 0) row[fieldMap[key]] = item[key] || '';
    });
    if (rowNumber) sh.getRange(rowNumber, 1, 1, lastCol).setValues([row]);
    else sh.appendRow(row);
    sh.getRange(rowNumber || sh.getLastRow(), fieldMap.dataIso + 1).setNumberFormat('@');
    feriadoClearCaches_();
    feriadoLogPerformance_('save_locked', started, { rowCount: 1 }, true);
    return rowNumber ? 'Feriado atualizado com sucesso.' : 'Feriado cadastrado com sucesso.';
  });
}

function excluirFeriado(id) {
  codexAssertCanWrite_('excluirFeriado', 'Cadastros', id);
  id = String(id || '').trim();
  if (!id) throw new Error('Feriado inválido.');
  return codexWithDocumentLock_('excluirFeriado', function() {
    var sh = feriadoSheetForRead_();
    var rowNumber = feriadoFindRowForId_(sh, id);
    sh.deleteRow(rowNumber);
    feriadoClearCaches_();
    return 'ok';
  });
}

function getAgendaFeriadosOperacionais_() {
  var byKey = {};
  var centralDates = {};
  var centralAnnualDays = {};
  getFeriadosCadastro_().forEach(function(item) {
    if (!CodexCourierRiskRules_.parseIso(item.dataIso)) return;
    // O cadastro central prevalece tambem quando inativo ou sem restricao.
    if (CodexCourierRiskRules_.isAnnualHoliday(item)) centralAnnualDays[item.dataIso.slice(5)] = true;
    else centralDates[item.dataIso] = true;
    if (!CodexCourierRiskRules_.isYes(item.ativo)) return;
    byKey[item.dataIso + '|' + normText_(item.nome) + '|' + normText_(item.recorrencia)] = item;
  });
  var legacyStarted = Date.now();
  var legacyMetrics = { rowCount: 0, cellsRead: 0, readCalls: 0 };
  var legacySuccess = false;
  try {
    // Data e Tipo sao colunas fixas. Nao resolva o schema dos campos opcionais
    // de transporte/participante para esta leitura de referencia.
    var agenda = getSheetByPossibleNames_(getCodexSpreadsheet_(), AGENDA_CFG.abaNomes);
    var count = agenda ? Math.max(0, agenda.getLastRow() - 1) : 0;
    if (count) {
      // Uma unica leitura em bloco substitui as leituras separadas de datas
      // e tipos. Tipo e textual; a classificacao compartilhada aceita as
      // grafias legadas. Inclui todas as datas, sem restringir feriados anuais.
      var firstCol = Math.min(AGENDA_CFG.col.data, AGENDA_CFG.col.tipo);
      var lastCol = Math.max(AGENDA_CFG.col.data, AGENDA_CFG.col.tipo);
      var rows = agenda.getRange(2, firstCol, count, lastCol - firstCol + 1).getValues();
      legacyMetrics.rowCount = count;
      legacyMetrics.cellsRead = count * (lastCol - firstCol + 1);
      legacyMetrics.readCalls = 1;
      for (var i = 0; i < count; i++) {
        if (!AgendaServerRules_.isType(rows[i][AGENDA_CFG.col.tipo - firstCol], 'feriado')) continue;
        var dateIso = feriadoDateIso_(rows[i][AGENDA_CFG.col.data - firstCol]);
        if (!dateIso) continue;
        if (centralDates[dateIso] || centralAnnualDays[dateIso.slice(5)]) continue;
        var key = dateIso + '|feriado';
        if (!byKey[key]) byKey[key] = {
          id: 'LEGACY-' + dateIso,
          dataIso: dateIso,
          data: dateIso,
          nome: 'Feriado',
          tipo: 'Feriado',
          abrangencia: '',
          afetaOperacao: 'Sim',
          ativo: 'Sim',
          observacao: 'Registro legado da Agenda.',
          recorrencia: 'Data específica',
          legado: true
        };
      }
    }
    legacySuccess = true;
  } catch (e) {
    Logger.log('[getAgendaFeriadosOperacionais_] Feriados legados indisponíveis: ' + e.message);
    throw new Error('Não foi possível consultar os feriados legados da Agenda. A lista operacional pode estar incompleta; tente atualizar novamente.', { cause: e });
  } finally { feriadoLogPerformance_('legacy', legacyStarted, legacyMetrics, legacySuccess); }
  return Object.keys(byKey).map(function(key) { return byKey[key]; }).sort(function(a, b) {
    return a.dataIso.localeCompare(b.dataIso) || a.nome.localeCompare(b.nome, 'pt-BR');
  });
}
