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
  if (CodexCourierRiskRules_.parseIso(raw)) return raw;
  var parsed = parseAgendaDateAny_(raw);
  return parsed ? Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
}

function feriadoSheetForRead_() {
  return getSheetByPossibleNames_(getCodexSpreadsheet_(), ['Feriados', 'Feriado']);
}

function feriadoSchemaHeaderAliases_(header) {
  if (header === 'Operação de transporte de amostras sujeita a restrições') {
    return [header, 'Operacao de transporte de amostras sujeita a restricoes', 'Afeta operação/coletas', 'Afeta operacao/coletas'];
  }
  return [header];
}

function feriadoSheetForWrite_() {
  var ss = getCodexSpreadsheet_();
  var sh = feriadoSheetForRead_();
  if (!sh) sh = ss.insertSheet('Feriados');
  var lastCol = sh.getLastColumn();
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, FERIADO_HEADERS_.length).setValues([FERIADO_HEADERS_]);
  } else {
    var headers = sh.getRange(1, 1, 1, Math.max(lastCol, 1)).getDisplayValues()[0];
    var missing = FERIADO_HEADERS_.filter(function(header) {
      return feriadoHeaderIndex_(headers, feriadoSchemaHeaderAliases_(header)) < 0;
    });
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    }
  }
  sh.setFrozenRows(1);
  try { sh.hideColumns(1); } catch (e) {}
  return sh;
}

function getFeriadosCadastro_() {
  var sh = feriadoSheetForRead_();
  if (!sh || sh.getLastRow() < 2) return [];
  var lastCol = sh.getLastColumn();
  var values = sh.getRange(1, 1, sh.getLastRow(), lastCol).getValues();
  var display = sh.getRange(1, 1, sh.getLastRow(), lastCol).getDisplayValues();
  var headers = display[0];
  var idx = {
    id: feriadoHeaderIndex_(headers, ['ID', 'ID Feriado']),
    data: feriadoHeaderIndex_(headers, ['Data', 'Data do feriado']),
    nome: feriadoHeaderIndex_(headers, ['Nome', 'Feriado', 'Descrição', 'Descricao']),
    tipo: feriadoHeaderIndex_(headers, ['Tipo']),
    abrangencia: feriadoHeaderIndex_(headers, ['Abrangência', 'Abrangencia', 'Escopo']),
    afetaOperacao: feriadoHeaderIndex_(headers, ['Operação de transporte de amostras sujeita a restrições', 'Operacao de transporte de amostras sujeita a restricoes', 'Afeta operação/coletas', 'Afeta operacao/coletas', 'Afeta operação', 'Afeta operacao']),
    ativo: feriadoHeaderIndex_(headers, ['Ativo']),
    observacao: feriadoHeaderIndex_(headers, ['Observação', 'Observacao']),
    recorrencia: feriadoHeaderIndex_(headers, ['Recorrência', 'Recorrencia'])
  };
  var out = [];
  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    var raw = values[rowIndex];
    var shown = display[rowIndex];
    var dataIso = feriadoDateIso_(idx.data >= 0 ? raw[idx.data] : '');
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
  var day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  ['AgendaFormData:v8:', 'AgendaFormData:v9:', 'AgendaFormDataStrict:v2:', 'AgendaFormDataStrict:v3:', 'AgendaBootstrapReferenceData:v1:', 'AgendaBootstrapReferenceData:v2:'].forEach(function(prefix) {
    codexCacheRemove_(prefix + day);
  });
}

function salvarFeriado(dados) {
  codexAssertCanWrite_('salvarFeriado', 'Cadastros', dados && dados.id);
  var item = feriadoValidatePayload_(dados);
  return codexWithDocumentLock_('salvarFeriado', function() {
    var sh = feriadoSheetForWrite_();
    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    var fieldMap = {
      id: feriadoHeaderIndex_(headers, ['ID', 'ID Feriado']),
      dataIso: feriadoHeaderIndex_(headers, ['Data', 'Data do feriado']),
      nome: feriadoHeaderIndex_(headers, ['Nome', 'Feriado', 'Descrição', 'Descricao']),
      tipo: feriadoHeaderIndex_(headers, ['Tipo']),
      abrangencia: feriadoHeaderIndex_(headers, ['Abrangência', 'Abrangencia', 'Escopo']),
      afetaOperacao: feriadoHeaderIndex_(headers, ['Operação de transporte de amostras sujeita a restrições', 'Operacao de transporte de amostras sujeita a restricoes', 'Afeta operação/coletas', 'Afeta operacao/coletas']),
      ativo: feriadoHeaderIndex_(headers, ['Ativo']),
      observacao: feriadoHeaderIndex_(headers, ['Observação', 'Observacao']),
      recorrencia: feriadoHeaderIndex_(headers, ['Recorrência', 'Recorrencia'])
    };
    var rowNumber = 0;
    if (item.id && sh.getLastRow() >= 2) {
      var ids = sh.getRange(2, fieldMap.id + 1, sh.getLastRow() - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === item.id) { rowNumber = i + 2; break; }
      if (!rowNumber) throw new Error('Feriado não encontrado para edição.');
    }
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
    return rowNumber ? 'Feriado atualizado com sucesso.' : 'Feriado cadastrado com sucesso.';
  });
}

function excluirFeriado(id) {
  codexAssertCanWrite_('excluirFeriado', 'Cadastros', id);
  id = String(id || '').trim();
  if (!id) throw new Error('Feriado inválido.');
  return codexWithDocumentLock_('excluirFeriado', function() {
    var sh = feriadoSheetForRead_();
    if (!sh || sh.getLastRow() < 2) throw new Error('Feriado não encontrado.');
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
    var idCol = feriadoHeaderIndex_(headers, ['ID', 'ID Feriado']);
    if (idCol < 0) throw new Error('Coluna de ID dos feriados não encontrada.');
    var ids = sh.getRange(2, idCol + 1, sh.getLastRow() - 1, 1).getDisplayValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === id) {
        sh.deleteRow(i + 2);
        feriadoClearCaches_();
        return 'ok';
      }
    }
    throw new Error('Feriado não encontrado.');
  });
}

function getAgendaFeriadosOperacionais_() {
  var byKey = {};
  var centralDates = {};
  getFeriadosCadastro_().forEach(function(item) {
    if (!CodexCourierRiskRules_.isYes(item.ativo)) return;
    byKey[item.dataIso + '|' + normText_(item.nome) + '|' + normText_(item.recorrencia)] = item;
    centralDates[item.dataIso] = true;
  });
  try {
    var agenda = getAgendaSheetForRead_();
    var count = Math.max(0, agenda.getLastRow() - 1);
    if (count) {
      var dates = agenda.getRange(2, AGENDA_CFG.col.data, count, 1).getValues();
      var types = agenda.getRange(2, AGENDA_CFG.col.tipo, count, 1).getDisplayValues();
      for (var i = 0; i < count; i++) {
        if (!AgendaServerRules_.isType(types[i][0], 'feriado')) continue;
        var dateIso = feriadoDateIso_(dates[i][0]);
        if (!dateIso) continue;
        if (centralDates[dateIso]) continue;
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
  } catch (e) {
    Logger.log('[getAgendaFeriadosOperacionais_] Feriados legados indisponíveis: ' + e.message);
  }
  return Object.keys(byKey).map(function(key) { return byKey[key]; }).sort(function(a, b) {
    return a.dataIso.localeCompare(b.dataIso) || a.nome.localeCompare(b.nome, 'pt-BR');
  });
}
