
/* ===== BEGIN TransporteCodexConfig.gs ===== */

/**
 * Configuracao do modulo Transporte quando ele roda acoplado ao CODEX.
 *
 * Rode configurarPlanilhaTransporteCodex(urlOuId) uma vez com a URL ou ID da
 * planilha de transporte.
 */

var PASTA_COMUNICADOS_ESPECIAIS_ID = typeof PASTA_COMUNICADOS_ESPECIAIS_ID !== 'undefined'
  ? PASTA_COMUNICADOS_ESPECIAIS_ID
  : '1em1j316UiWg5HQTYtPRHpXzeynqL-i11';
var TRANSPORTE_ADJACENT_LABEL_CACHE_ = {};
// Handle apenas da execucao atual; nao armazena dados nem autorizacao.
var TRANSPORTE_SPREADSHEET_HANDLE_ = null;
var TRANSPORTE_SPREADSHEET_HANDLE_ID_ = '';
var TRANSPORTE_CONFIG_EXECUTION_ = Object.create(null);
var TRANSPORTE_GENERATION_WARNINGS_ = null;

function transporteRegistrarAviso_(code) {
  if (!TRANSPORTE_GENERATION_WARNINGS_) return;
  if (TRANSPORTE_GENERATION_WARNINGS_.some(function(item) { return item.code === code; })) return;
  var descriptions = {
    verificarEAtualizarG33Declaracao_: 'O peso do gelo seco não foi atualizado.',
    atualizarMarkenVolumes_: 'Os volumes e pesos MARKEN não foram atualizados.',
    atualizarInvoiceMarkenAmostras_: 'Os materiais da invoice MARKEN não foram atualizados.',
    atualizarFormularioPinex_: 'O formulário PINEX não foi atualizado.',
    atualizarCommercialInvoicePinexB34_: 'O resumo de materiais PINEX não foi atualizado.',
    LIMPEZA_COPIA_TEMPORARIA: 'A cópia temporária não pôde ser movida para a lixeira.',
    CONFIG_TRANSPORTE: 'A configuração de Transporte não pôde ser consultada.',
    CONFIG_NUMERO_TRANSPORTE: 'Um peso configurado é inválido; foi mantido o valor padrão.',
    CONFIG_CNPJ_TRANSPORTE: 'O CNPJ configurado é inválido; foi mantido o valor padrão.',
    CONFIG_PASTA_CE: 'A pasta de Comunicado Especial configurada é inválida; foi mantida a pasta padrão.'
  };
  TRANSPORTE_GENERATION_WARNINGS_.push({ code: code, message: (descriptions[code] || 'Uma etapa do preenchimento automático não foi concluída.') + ' Confira a documentação antes do envio.' });
}

function transporteConfigValue_(key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(TRANSPORTE_CONFIG_EXECUTION_, key)) {
    var values = [];
    try {
      if (typeof getConfigAppValuesByKeys_ === 'function') values = getConfigAppValuesByKeys_(['Transporte'], [key], []);
    } catch (configError) { transporteRegistrarAviso_('CONFIG_TRANSPORTE'); }
    TRANSPORTE_CONFIG_EXECUTION_[key] = values && values.length ? String(values[0] || '').trim() : '';
  }
  return TRANSPORTE_CONFIG_EXECUTION_[key] || fallback;
}

function transporteConfigNumber_(key, fallback) {
  var raw = transporteConfigValue_(key, String(fallback));
  var value = /^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
  if (isFinite(value) && value > 0) return value;
  transporteRegistrarAviso_('CONFIG_NUMERO_TRANSPORTE');
  return fallback;
}

function transporteCnpjTexto_() {
  var fallback = '88.648.761/0001-03';
  var value = transporteConfigValue_('CNPJ do centro', fallback);
  if (/^\d{14}$/.test(value.replace(/[.\/-]/g, ''))) return value;
  transporteRegistrarAviso_('CONFIG_CNPJ_TRANSPORTE');
  return fallback;
}

function transporteMeasurePerformance_(operation, stage, metadata, callback) {
  if (typeof codexMeasurePerformance_ === 'function') {
    return codexMeasurePerformance_(operation, stage, metadata, callback);
  }
  var startedAt = Date.now();
  var success = false;
  metadata = metadata || {};
  try {
    var result = callback();
    success = true;
    return result;
  } finally {
    try {
      Logger.log('[CODEX_PERF] ' + JSON.stringify({
        operation: String(operation || ''),
        stage: String(stage || ''),
        durationMs: Math.max(0, Date.now() - startedAt),
        rowCount: Math.max(0, Number(metadata.rowCount) || 0),
        success: success
      }));
    } catch (eLog) {
      // O modulo continua funcional mesmo quando o log nao esta disponivel.
    }
  }
}

function configurarPlanilhaTransporteCodex(urlOuId) {
  if (typeof codexAssertAdmin_ === 'function') codexAssertAdmin_();
  var id = extrairIdPlanilhaTransporteCodex_(urlOuId);
  if (!id) throw new Error('Informe a URL ou o ID da planilha de transporte.');
  PropertiesService.getScriptProperties().setProperty('TRANSPORTE_SPREADSHEET_ID_CODEX', id);
  TRANSPORTE_SPREADSHEET_HANDLE_ = null;
  TRANSPORTE_SPREADSHEET_HANDLE_ID_ = '';
  TRANSPORTE_SHEET_LOOKUP_CACHE_ = null;
  transporteClearAdjacentLabelCache_();
  return { ok: true, id: id };
}

function getTransporteSpreadsheetCodex_() {
  var id = PropertiesService.getScriptProperties().getProperty('TRANSPORTE_SPREADSHEET_ID_CODEX') || '';
  if (!id) {
    try {
      id = PropertiesService.getDocumentProperties().getProperty('TRANSPORTE_SPREADSHEET_ID_CODEX') || '';
    } catch (e) {
      id = '';
    }
  }
  if (!id) {
    var vals = getConfigAppValuesByKeys_(
      ['Transporte', 'TRANSP'],
      ['Spreadsheet ID', 'Planilha ID', 'TRANSPORTE_SPREADSHEET_ID_CODEX'],
      []
    );
    id = vals[0] || '';
  }
  id = extrairIdPlanilhaTransporteCodex_(id);
  if (!id) {
    throw new Error('Configure TRANSPORTE_SPREADSHEET_ID_CODEX com o ID ou URL da planilha de transporte.');
  }
  if (TRANSPORTE_SPREADSHEET_HANDLE_ && TRANSPORTE_SPREADSHEET_HANDLE_ID_ === id) return TRANSPORTE_SPREADSHEET_HANDLE_;
  var spreadsheet = SpreadsheetApp.openById(id);
  TRANSPORTE_SPREADSHEET_HANDLE_ = spreadsheet;
  TRANSPORTE_SPREADSHEET_HANDLE_ID_ = id;
  return spreadsheet;
}

function extrairIdPlanilhaTransporteCodex_(urlOuId) {
  var raw = String(urlOuId || '').trim();
  if (!raw) return '';
  var match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  match = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return raw.replace(/['"]/g, '').trim();
}


/* ===== END TransporteCodexConfig.gs ===== */


/* ===== BEGIN CODEX_TransporteBridge.gs ===== */

/**
 * Ponte CODEX -> TRANSP.
 *
 * Configure TRANSPORTE_WEBAPP_URL_CODEX em Script Properties, Document
 * Properties ou Config_App com a URL /exec publicada do WebApp TRANSP.
 */

var TRANSPORTE_WEBAPP_URL_CODEX = typeof TRANSPORTE_WEBAPP_URL_CODEX !== 'undefined' ? TRANSPORTE_WEBAPP_URL_CODEX : '';

function configurarUrlWebAppTransporteCodex(url) {
  if (typeof codexAssertAdmin_ === 'function') codexAssertAdmin_();
  url = String(url || '').trim().replace(/\?.*$/, '').replace(/\/$/, '');
  if (!/^https:\/\/script\.google\.com\/.*\/exec$/i.test(url)) {
    throw new Error('Informe a URL /exec publicada do WebApp TRANSP.');
  }
  PropertiesService.getScriptProperties().setProperty('TRANSPORTE_WEBAPP_URL_CODEX', url);
  return { ok: true, url: url };
}

function gerarDocumentacaoTransporteCodex(idAgenda, slot) {
  if (typeof codexAssertCanWrite_ === 'function') codexAssertCanWrite_('gerarDocumentacaoTransporteCodex', 'Transporte', idAgenda);
  var payload = montarPayloadTransporteParaTransp_(idAgenda, slot);
  codexCourierAssertDocumentAwb_(payload.courier.awb, payload.courier.nome);
  if (typeof importarTransporteCodex === 'function') {
    return { ok: true, data: importarTransporteCodex(payload), modo: 'acoplado' };
  }
  var baseUrl = getTransporteWebAppUrlCodex_();
  if (!baseUrl) {
    throw new Error('Configure TRANSPORTE_WEBAPP_URL_CODEX com a URL /exec publicada do WebApp TRANSP.');
  }

  var response = UrlFetchApp.fetch(baseUrl + '?action=importarCodex', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ apiToken: codexGetWebAppApiToken_(), payload: payload }),
    muteHttpExceptions: true
  });

  var body = response.getContentText();
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(transporteFormatHttpError_(response.getResponseCode(), body, baseUrl));
  }

  var parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch (e) {
    // eslint-disable-next-line preserve-caught-error -- Translate malformed TRANSP responses to a stable integration error.
    throw new Error('TRANSP respondeu em formato inesperado. Confira se a URL aponta para o deploy /exec correto.');
  }
  if (!parsed.ok) throw new Error(parsed.error || 'Falha ao importar transporte no TRANSP.');
  return parsed;
}

function transporteFormatHttpError_(code, body, baseUrl) {
  var texto = String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  var dica = '';
  if (code === 401 || code === 403 || /Page Not Found|unable to open/i.test(texto)) {
    dica = ' A URL configurada para o TRANSP esta inacessivel para UrlFetchApp. Publique o WebApp TRANSP com acesso "Qualquer pessoa com o link" ou "Qualquer pessoa" e atualize TRANSPORTE_WEBAPP_URL_CODEX.';
  }
  return 'TRANSP retornou HTTP ' + code + '.' + dica + (texto ? ' Resposta: ' + texto.slice(0, 240) : '') + ' URL: ' + baseUrl;
}

function testarUrlWebAppTransporteCodex() {
  if (typeof codexAssertAdmin_ === 'function') codexAssertAdmin_();
  var baseUrl = getTransporteWebAppUrlCodex_();
  if (!baseUrl) throw new Error('TRANSPORTE_WEBAPP_URL_CODEX nao configurada.');

  var getResponse = UrlFetchApp.fetch(baseUrl + '?page=transporte', {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true
  });
  var postResponse = UrlFetchApp.fetch(baseUrl + '?action=ping', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ apiToken: codexGetWebAppApiToken_(), payload: { ping: true } }),
    followRedirects: true,
    muteHttpExceptions: true
  });

  return {
    ok: getResponse.getResponseCode() >= 200 && getResponse.getResponseCode() < 300,
    url: baseUrl,
    getCode: getResponse.getResponseCode(),
    getPreview: String(getResponse.getContentText() || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300),
    postCode: postResponse.getResponseCode(),
    postPreview: String(postResponse.getContentText() || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  };
}

function montarContextoTransporteParaTransp_(idAgenda, slot) {
  slot = normalizarSlotTransporteCodex_(slot, true);
  var evento = buscarAgendaEventoPorIdTransp_(idAgenda);
  return {
    evento: evento,
    payload: montarPayloadTransporteParaTransp_(idAgenda, slot, evento)
  };
}

function montarPayloadTransporteParaTransp_(idAgenda, slot, eventoPrecarregado) {
  slot = normalizarSlotTransporteCodex_(slot, true);
  var evento = eventoPrecarregado || buscarAgendaEventoPorIdTransp_(idAgenda);
  var participanteInfo;
  try {
    participanteInfo = agendaInfoParticipanteParaSalvar_({
      participanteCadastroId: evento.participantCadastroId || evento.participanteCadastroId || '',
      nome: evento.participante,
      idParticipante: evento.idParticipante,
      projeto: evento.projeto
    }) || {};
  } catch (e) {
    participanteInfo = {};
  }
  var slotNormalizado = normalizarSlotTransporteCodex_(slot, true);
  var courier = transporteAgendaCourierFromEvento_(evento, slotNormalizado);
  var courierNome = transporteNormalizeCourierFromCodex_(courier.nome || courier.courier || '');

  return {
    slot: slotNormalizado,
    idAgenda: String(idAgenda || ''),
    refInterna: transporteAgendaRefInterna_(idAgenda),
    agenda: evento,
    courier: courier,
    participante: evento.participante || '',
    participanteCadastroId: participanteInfo.id || evento.participantCadastroId || evento.participanteCadastroId || '',
    numId: participanteInfo.numId || evento.idParticipante || '',
    identificacaoParticipante: participanteInfo.numId || evento.idParticipante || '',
    projeto: evento.projeto || '',
    medico: evento.medico || '',
    horaEnvio: transporteJanelaEnvioPadrao_(),
    agendadoPor: transporteAgendadorPadrao_(),
    pinexAgendadoPor: '',
    responsavelEntrega: '',
    solicitarCaixa: transporteDefaultSolicitarCaixa_(courierNome),
    responsavel: ''
  };
}

function transporteAgendaCourierFromEvento_(evento, slot) {
  evento = evento || {};
  slot = normalizarSlotTransporteCodex_(slot, true);
  var map = {
    '1': 'courier1',
    '2': 'courier2',
    '3': 'courier3',
    backup: 'backup'
  };
  var courier = evento[map[slot]] || {};
  if (slot === 'backup' && courier && !courier.temperatura && !courier.temp) {
    var fallbackTemp = (evento.courier1 && (evento.courier1.temperatura || evento.courier1.temp)) ||
      (evento.courier2 && (evento.courier2.temperatura || evento.courier2.temp)) ||
      (evento.courier3 && (evento.courier3.temperatura || evento.courier3.temp)) || '';
    if (fallbackTemp) {
      courier = JSON.parse(JSON.stringify(courier));
      courier.temperatura = fallbackTemp;
    }
  }
  return courier;
}

function transporteJanelaEnvioPadrao_() {
  var opts = [];
  try {
    if (typeof getConfigAppValuesByKeys_ === 'function') {
      opts = getConfigAppValuesByKeys_(
        ['Transporte', 'Agenda'],
        ['Janela de envio', 'Horario de coleta', 'Hor\u00e1rio de coleta'],
        []
      );
    }
  } catch (e) {
    opts = [];
  }
  return opts && opts.length ? String(opts[0] || '').trim() : '13:00 - 15:00';
}

function transporteAgendaRefInterna_(idAgenda) {
  idAgenda = String(idAgenda || '').trim();
  return idAgenda ? 'AGD-' + idAgenda : '';
}

function transporteAgendaLinkFromRef_(refInterna, note) {
  var out = { idAgenda: '', agendaSlot: '' };
  refInterna = String(refInterna || '').trim();
  try {
    var meta = note ? JSON.parse(note) : null;
    if (meta) {
      out.idAgenda = String(meta.idAgenda || '').trim();
      out.participanteCadastroId = String(meta.participanteCadastroId || '').trim();
      out.identificacaoParticipante = String(meta.identificacaoParticipante || '').trim();
      var slotMeta = String(meta.agendaSlot || meta.slot || '').trim();
      out.agendaSlot = slotMeta ? normalizarSlotTransporteCodex_(slotMeta) : '';
    }
  } catch (e) {}
  if (!refInterna) return out;
  var match = refInterna.match(/^AGD-(.+)$/i);
  if (!out.idAgenda) {
    if (match) out.idAgenda = String(match[1] || '').trim();
  }
  if (out.idAgenda && refInterna !== transporteAgendaRefInterna_(out.idAgenda)) {
    out.idAgenda = match ? String(match[1] || '').trim() : '';
    out.agendaSlot = '';
    out.participanteCadastroId = '';
    out.identificacaoParticipante = '';
  }
  return out;
}

function transporteSetAgendaLink_(range, payload) {
  payload = payload || {};
  var idAgenda = String(payload.idAgenda || '').trim();
  var refInterna = String(payload.refInterna || '').trim();
  if (!idAgenda) idAgenda = transporteAgendaLinkFromRef_(refInterna, '').idAgenda;
  var slot = String(payload.agendaSlot || payload.slot || '').trim();
  var slotNormalizado = idAgenda && slot ? normalizarSlotTransporteCodex_(slot, true) : '';
  transporteSetValueIfAllowed_(range, '');
  var cadastroId = String(payload.participanteCadastroId || '').trim();
  var identificacao = String(payload.identificacaoParticipante || payload.idParticipante || '').trim();
  if (idAgenda || cadastroId || identificacao) {
    range.setNote(JSON.stringify({
      idAgenda: idAgenda,
      agendaSlot: slotNormalizado,
      participanteCadastroId: cadastroId,
      identificacaoParticipante: identificacao
    }));
  } else {
    range.clearNote();
  }
}

function transportePreservarVinculoAgendaPayload_(payload, range) {
  payload = payload || {};
  if (String(payload.idAgenda || '').trim() && String(payload.agendaSlot || payload.slot || '').trim()) return payload;
  if (!range) return payload;
  var refAtual = String(payload.refInterna || range.getDisplayValue() || range.getValue() || '').trim();
  var link = transporteAgendaLinkFromRef_(refAtual, range.getNote());
  if (!payload.idAgenda && link.idAgenda) payload.idAgenda = link.idAgenda;
  if (!payload.agendaSlot && !payload.slot && link.agendaSlot) payload.agendaSlot = link.agendaSlot;
  if (!payload.refInterna && payload.idAgenda) payload.refInterna = transporteAgendaRefInterna_(payload.idAgenda);
  return payload;
}

function buscarAgendaEventoPorIdTransp_(idAgenda) {
  if (!idAgenda) throw new Error('ID da Agenda nao informado.');
  var sh = getAgendaSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('Agenda sem registros.');
  var row = encontrarLinhaPorId(sh, idAgenda);
  if (row) {
    return agendaRowToObject_(sh.getRange(row, 1, 1, AGENDA_CFG.lastCol).getValues()[0], row);
  }
  throw new Error('Evento da Agenda nao encontrado: ' + idAgenda);
}

function normalizarSlotTransporteCodex_(slot, strict) {
  var s = normText_(slot || '1');
  if (s === '1' || s === '2' || s === '3') return s;
  if (s === 'i' || s === 'transporte i') return '1';
  if (s === 'ii' || s === 'transporte ii') return '2';
  if (s === 'iii' || s === 'transporte iii') return '3';
  if (s === 'b' || s === 'backup') return 'backup';
  if (strict) throw new Error('Slot de transporte inválido. Reabra a documentação pela Agenda.');
  // Leitura de notas antigas conserva o valor para revisao, sem escolher I.
  return String(slot || '1');
}

var TRANSPORTE_OPERACOES_SHEET_ = 'Transporte_Operacoes';
var TRANSPORTE_OPERACOES_HEADERS_ = [
  'Agenda_ID', 'Slot', 'Referencia', 'Courier', 'Gerado_Em', 'Gerado_Por',
  'PDF_ID', 'PDF_Nome', 'Rascunho_ID', 'Rascunho_Status', 'Rascunho_Erro',
  'Email_Identificado_Em', 'Email_Enviado_Em', 'Gmail_Message_ID', 'Anexos',
  'Ultima_Verificacao', 'PDF_Hash'
];
var TRANSPORTE_PENDENCIA_SEM_ENVIO_MS_ = 60 * 60 * 1000;
var TRANSPORTE_MONITOR_BUSCA_DIAS_ = 30;

function transporteMonitorReferencia_(agendaId, slot) {
  agendaId = String(agendaId || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  slot = normalizarSlotTransporteCodex_(slot);
  if (!agendaId || ['1', '2', '3'].indexOf(slot) === -1) return '';
  return 'IPS-TRP-' + agendaId + '-T' + slot;
}

function transporteMonitorRefHtml_(referencia, pdfHash) {
  referencia = String(referencia || '').trim();
  if (!referencia) return '';
  var documento = String(pdfHash || '').replace(/[^A-Za-z0-9_-]/g, '');
  return '<div style="margin-top:14px;font-size:9px;line-height:1.2;color:#9aa0a6">Ref. IPS: ' + referencia + (documento ? '<br>Doc. IPS: ' + documento : '') + '</div>';
}

function transporteOperacoesSheet_(createIfMissing) {
  var ss = typeof getCodexSpreadsheet_ === 'function'
    ? getCodexSpreadsheet_()
    : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TRANSPORTE_OPERACOES_SHEET_);
  if (!sh && createIfMissing) {
    sh = ss.insertSheet(TRANSPORTE_OPERACOES_SHEET_);
    sh.getRange(1, 1, 1, TRANSPORTE_OPERACOES_HEADERS_.length).setValues([TRANSPORTE_OPERACOES_HEADERS_]);
    if (sh.setFrozenRows) sh.setFrozenRows(1);
    if (sh.hideSheet) sh.hideSheet();
  } else if (sh && createIfMissing) {
    // Migra somente na escrita, mantendo as primeiras 16 colunas intactas.
    var headers = sh.getRange(1, 1, 1, TRANSPORTE_OPERACOES_HEADERS_.length - 1).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] !== TRANSPORTE_OPERACOES_HEADERS_[i]) throw new Error('Cabeçalhos de Transporte_Operacoes incompatíveis. Revise a aba antes de registrar documentos.');
    }
    var hashColumn = TRANSPORTE_OPERACOES_HEADERS_.indexOf('PDF_Hash') + 1;
    var existingHashHeader = sh.getLastColumn() >= hashColumn ? sh.getRange(1, hashColumn).getValue() : '';
    if (existingHashHeader && existingHashHeader !== 'PDF_Hash') throw new Error('A coluna reservada ao hash do PDF já está ocupada. Revise a aba Transporte_Operacoes.');
    if (!existingHashHeader) {
      if (sh.getLastColumn() >= hashColumn) throw new Error('A coluna reservada ao hash contém dados sem cabeçalho. Revise Transporte_Operacoes antes de registrar documentos.');
      if (sh.getMaxColumns && sh.getMaxColumns() < hashColumn) sh.insertColumnsAfter(sh.getMaxColumns(), hashColumn - sh.getMaxColumns());
      sh.getRange(1, hashColumn).setValue('PDF_Hash');
    }
  }
  return sh;
}

function transporteOperacaoDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function transporteOperacoesRows_() {
  var sh = transporteOperacoesSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(sh.getLastColumn(), TRANSPORTE_OPERACOES_HEADERS_.length)).getValues().map(function(row, index) {
    return {
      row: index + 2,
      agendaId: String(row[0] || '').trim(),
      slot: String(row[1] || '').trim(),
      referencia: String(row[2] || '').trim(),
      courier: String(row[3] || '').trim(),
      geradoEm: row[4],
      geradoPor: String(row[5] || '').trim(),
      pdfId: String(row[6] || '').trim(),
      pdfNome: String(row[7] || '').trim(),
      rascunhoId: String(row[8] || '').trim(),
      rascunhoStatus: String(row[9] || '').trim(),
      rascunhoErro: String(row[10] || '').trim(),
      emailIdentificadoEm: row[11],
      emailEnviadoEm: row[12],
      gmailMessageId: String(row[13] || '').trim(),
      anexos: row[14],
      ultimaVerificacao: row[15],
      pdfHash: String(row[16] || '').trim()
    };
  });
}

function transporteRegistrarDocumentacaoGerada_(info) {
  info = info || {};
  var agendaId = String(info.agendaId || '').trim();
  var slot = normalizarSlotTransporteCodex_(info.slot || '');
  var referencia = transporteMonitorReferencia_(agendaId, slot);
  if (!referencia) return { registrado: false, motivo: 'Transporte sem vínculo rastreável com a Agenda' };
  var sh = transporteOperacoesSheet_(true);
  var rows = transporteOperacoesRows_();
  var existente = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].agendaId === agendaId && rows[i].slot === slot) {
      existente = rows[i];
      break;
    }
  }
  var now = new Date();
  var pdfHash = String(info.pdfHash || '').trim();
  // Preserva envio somente quando o conteudo logico do documento e igual.
  // Hash ausente no legado nao comprova equivalencia com o novo documento.
  var mesmoDocumento = existente && pdfHash && existente.pdfHash === pdfHash;
  var evidenciaEnvio = mesmoDocumento
    ? [
      existente.emailIdentificadoEm,
      existente.emailEnviadoEm,
      existente.gmailMessageId,
      existente.anexos,
      existente.ultimaVerificacao
    ]
    : ['', '', '', '', now];
  var values = [[
    agendaId,
    slot,
    referencia,
    String(info.courier || '').trim(),
    now,
    String(info.geradoPor || '').trim(),
    String(info.pdfId || '').trim(),
    String(info.pdfNome || '').trim(),
    String(info.rascunhoId || '').trim(),
    info.rascunhoOk === true ? 'CRIADO' : 'ERRO',
    info.rascunhoOk === true ? '' : String(info.rascunhoErro || 'Rascunho não criado.').trim(),
    evidenciaEnvio[0],
    evidenciaEnvio[1],
    evidenciaEnvio[2],
    evidenciaEnvio[3],
    evidenciaEnvio[4],
    pdfHash
  ]];
  var rowNumber = existente ? existente.row : sh.getLastRow() + 1;
  sh.getRange(rowNumber, 1, 1, TRANSPORTE_OPERACOES_HEADERS_.length).setValues(values);
  try {
    if (typeof courierLembreteRegistrarBase_ === 'function') courierLembreteRegistrarBase_(agendaId, slot, now);
  } catch (lembreteError) {
    // Sem base persistida, a cobrança permanece manual; documentos já gerados continuam válidos.
    Logger.log('Base de cobrança não registrada: ' + String(lembreteError.message || lembreteError));
  }
  return { registrado: true, agendaId: agendaId, slot: slot, referencia: referencia, row: rowNumber };
}

function transporteDocumentosSemEnvioPendencias_(agora) {
  agora = transporteOperacaoDate_(agora) || new Date();
  return transporteOperacoesRows_().filter(function(item) {
    var geradoEm = transporteOperacaoDate_(item.geradoEm);
    var identificadoSemAnexoAceito = transporteOperacaoDate_(item.emailIdentificadoEm) &&
      Number(item.anexos || 0) < 1 && !transporteCourierExigeAnexoEnvio_(item.courier);
    return geradoEm && !transporteOperacaoDate_(item.emailEnviadoEm) && !identificadoSemAnexoAceito &&
      agora.getTime() - geradoEm.getTime() >= TRANSPORTE_PENDENCIA_SEM_ENVIO_MS_;
  }).map(function(item) {
    var identificado = transporteOperacaoDate_(item.emailIdentificadoEm);
    var anexos = Number(item.anexos || 0);
    var motivo = item.rascunhoStatus !== 'CRIADO'
      ? 'PDF gerado, mas o rascunho não foi criado.'
      : (identificado && anexos < 1
        ? 'E-mail identificado, mas sem documentação anexada.'
        : (identificado && anexos > 0
          ? 'E-mail com documentação identificado; atualização da Agenda aguardando nova tentativa.'
          : 'Rascunho criado; envio do e-mail não identificado há mais de 1 hora.'));
    if (!identificado && agora.getTime() - transporteOperacaoDate_(item.geradoEm).getTime() > TRANSPORTE_MONITOR_BUSCA_DIAS_ * 24 * 60 * 60 * 1000) {
      motivo += ' Documentação gerada há mais de 30 dias; mensagens antigas ficam fora da janela de busca automática. Verifique o envio manualmente.';
    }
    return {
      agendaId: item.agendaId,
      slot: item.slot,
      referencia: item.referencia,
      courier: item.courier,
      geradoEm: item.geradoEm,
      motivo: motivo
    };
  });
}

function transporteMensagemAnexos_(message) {
  try {
    return message.getAttachments({ includeInlineImages: false, includeAttachments: true }) || [];
  } catch (e) {
    return message.getAttachments ? (message.getAttachments() || []) : [];
  }
}

function transporteMonitorarEnviosPorEmail_(agendaId) {
  var diagnostico = { threads: 0, mensagensComReferencia: 0, buscaLimitada: false, recusas: [] };
  var result = transporteMonitorarEnviosExecutar_(agendaId, diagnostico);
  result.diagnostico = diagnostico;
  if (typeof Logger !== 'undefined') Logger.log('Monitor de envio: ' + JSON.stringify(result));
  return result;
}

function transporteMonitorContemReferencia_(texto, referencia) {
  var re = transporteMonitorReferenciaRegex_(referencia);
  return !!re && re.test(String(texto || ''));
}

function transporteMonitorReferenciaRegex_(referencia) {
  // Tolera espaços junto aos separadores, sem aceitar ID parcial ou outro slot.
  var ref = String(referencia || '').trim();
  if (!/^IPS-TRP-[A-Z0-9_-]+-T[123]$/i.test(ref)) return null;
  var escaped = ref.split('-').join('\\s*-\\s*');
  return new RegExp('(^|[^A-Z0-9_-])' + escaped + '(?![A-Z0-9_-])', 'i');
}

function transporteMonitorRemetentes_() {
  var allowed = Object.create(null);
  // Users e lido uma vez nesta execucao; nenhum cache concede acesso.
  var users = typeof codexGetAllowedUsers_ === 'function' ? codexGetAllowedUsers_() : {};
  Object.keys(users || {}).forEach(function(email) {
    if (users[email] && users[email].active === true) allowed[transporteNormalizeEmail_(email)] = true;
  });
  var executor = transporteNormalizeEmail_(transporteEffectiveUserEmail_());
  if (executor) allowed[executor] = true;
  return allowed;
}

function transporteMonitorRemetenteElegivel_(message, allowed) {
  var from = typeof message === 'string' ? message.trim() : (message.getFrom ? String(message.getFrom() || '').trim() : '');
  var match = from.match(/^(?:[^<>]*<([^<>]+)>|([^<>\s]+))$/);
  var email = match ? transporteNormalizeEmail_(match[1] || match[2]) : '';
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email) && allowed[email] === true;
}

function transporteAgendaSnapshotMonitor_(agenda) {
  var snapshot = { ids: Object.create(null), rows: Object.create(null) };
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return snapshot;
  agenda.getRange(2, 1, lastRow - 1, agenda.getLastColumn()).getValues().forEach(function(values, index) {
    var row = index + 2;
    var id = String(values[AGENDA_CFG.col.id - 1]);
    if (snapshot.ids[id] === undefined) snapshot.ids[id] = row;
    snapshot.rows[row] = values;
  });
  return snapshot;
}

function transporteMonitorColunaA1_(column) {
  var name = '';
  while (column > 0) { column--; name = String.fromCharCode(65 + column % 26) + name; column = Math.floor(column / 26); }
  return name;
}

function transporteMonitorGravarEvidencias_(sheet, updates) {
  updates.sort(function(a, b) { return a.row - b.row; });
  var column = TRANSPORTE_OPERACOES_HEADERS_.indexOf('Email_Identificado_Em') + 1;
  for (var i = 0; i < updates.length;) {
    var first = updates[i].row;
    var values = [updates[i].values];
    i++;
    while (i < updates.length && updates[i].row === first + values.length) { values.push(updates[i].values); i++; }
    sheet.getRange(first, column, values.length, 5).setValues(values);
  }
}

function transporteOperacaoVersion_(item) {
  return JSON.stringify([
    item.agendaId, item.slot, item.referencia, item.courier,
    transporteOperacaoDate_(item.geradoEm), item.geradoPor, item.pdfId, item.pdfNome,
    item.rascunhoId, item.rascunhoStatus, item.rascunhoErro,
    transporteOperacaoDate_(item.emailIdentificadoEm), transporteOperacaoDate_(item.emailEnviadoEm),
    item.gmailMessageId, item.anexos, transporteOperacaoDate_(item.ultimaVerificacao), item.pdfHash
  ]);
}

function transporteAgendaLinhasPorId_(agenda) {
  var linhas = Object.create(null);
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return linhas;
  agenda.getRange(2, AGENDA_CFG.col.id, lastRow - 1, 1).getValues().forEach(function(row, index) {
    var id = String(row[0]);
    // Preserva a primeira ocorrência e a comparação exata do resolvedor legado.
    if (linhas[id] === undefined) linhas[id] = index + 2;
  });
  return linhas;
}

function transporteMonitorarEnviosExecutar_(agendaId, diagnostico) {
  var agendaPrecheck = null;
  var snapshotPrecheck = null;
  var exigeAnexoCache = Object.create(null);
  function exigeAnexo(courier) {
    var key = transporteNorm_(courier);
    if (exigeAnexoCache[key] === undefined) exigeAnexoCache[key] = transporteCourierExigeAnexoEnvio_(courier);
    return exigeAnexoCache[key];
  }
  function linhaAgendaPrecheck(id) {
    agendaPrecheck = agendaPrecheck || getAgendaSheet_();
    snapshotPrecheck = snapshotPrecheck || transporteAgendaSnapshotMonitor_(agendaPrecheck);
    return id ? (snapshotPrecheck.ids[String(id)] || 0) : 0;
  }
  var pendentes = transporteOperacoesRows_().filter(function(item) {
    if (agendaId && item.agendaId !== agendaId) return false;
    if (!item.referencia) { diagnostico.recusas.push({ agendaId: item.agendaId, slot: item.slot, motivo: 'Referência ausente' }); return false; }
    if (!transporteOperacaoDate_(item.emailEnviadoEm)) {
      // Se o e-mail ja foi identificado em uma execucao anterior, a confirmacao
      // manual da Agenda deve encerrar a pendencia sem depender de o Gmail
      // devolver novamente a mesma mensagem entre os 100 resultados recentes.
      var identificadoEm = transporteOperacaoDate_(item.emailIdentificadoEm);
      var anexosIdentificados = Math.max(0, Math.floor(Number(item.anexos || 0) || 0));
      var documentacaoAceita = anexosIdentificados > 0 || !exigeAnexo(item.courier);
      if (identificadoEm && documentacaoAceita) {
        var slotMapManual = { '1': AGENDA_CFG.idx.c1, '2': AGENDA_CFG.idx.c2, '3': AGENDA_CFG.idx.c3 };
        var idxManual = slotMapManual[item.slot];
        var linhaManual = idxManual ? linhaAgendaPrecheck(item.agendaId) : 0;
        if (linhaManual) {
          var statusEventoManual = snapshotPrecheck.rows[linhaManual][AGENDA_CFG.col.status - 1];
          var statusManual = snapshotPrecheck.rows[linhaManual][idxManual.status];
          if (!AgendaServerRules_.isCancelled(statusEventoManual) && AgendaServerRules_.courierStatusKey(statusManual) === 'agendado') {
            item.confirmacaoManual = {
              date: identificadoEm,
              messageId: item.gmailMessageId,
              anexos: new Array(anexosIdentificados)
            };
          }
        }
      }
      return true;
    }
    // Recupera operações que versões anteriores concluíram antes de conseguir
    // promover a Agenda. Depois que o status chega a Agendado, elas deixam de
    // entrar naturalmente nas próximas execuções.
    if (!transporteOperacaoDate_(item.emailIdentificadoEm) || (Number(item.anexos || 0) < 1 && exigeAnexo(item.courier))) return false;
    var slotMap = { '1': AGENDA_CFG.idx.c1, '2': AGENDA_CFG.idx.c2, '3': AGENDA_CFG.idx.c3 };
    var idx = slotMap[item.slot];
    if (!idx) return false;
    var linha = linhaAgendaPrecheck(item.agendaId);
    if (!linha) return false;
    var statusEvento = snapshotPrecheck.rows[linha][AGENDA_CFG.col.status - 1];
    if (AgendaServerRules_.isCancelled(statusEvento)) return false;
    var statusAtual = snapshotPrecheck.rows[linha][idx.status];
    var precisaReprocessar = ['naoagendado', 'pendente'].indexOf(AgendaServerRules_.courierStatusKey(statusAtual)) !== -1;
    if (precisaReprocessar) item.reprocessar = true;
    return precisaReprocessar;
  });
  if (!pendentes.length) return { ok: true, verificados: 0, enviados: 0, semAnexo: 0 };
  var referencias = {};
  var referenciaRegex = {};
  var documentoRegex = {};
  var encontrados = {};
  pendentes.forEach(function(item) {
    var ref = item.referencia.toUpperCase();
    if (item.confirmacaoManual) encontrados[ref] = item.confirmacaoManual;
    else {
      referencias[ref] = item;
      referenciaRegex[ref] = transporteMonitorReferenciaRegex_(ref);
      if (item.pdfHash) documentoRegex[ref] = new RegExp('Doc\\.\\s*IPS:\\s*' + String(item.pdfHash).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_-])', 'i');
    }
  });
  // Excluir rascunhos e essencial quando a propria conta monitora e agenda.
  // Uma confirmacao manual baseada em e-mail ja identificado nao precisa
  // consultar o Gmail outra vez.
  var threads = [];
  var remetentes = Object.keys(referencias).length ? transporteMonitorRemetentes_() : {};
  if (Object.keys(referencias).length) {
    // Lotes limitados evitam uma consulta por operação e expõem truncamento.
    for (var offset = 0; offset < 500; offset += 100) {
      var pagina = GmailApp.search('in:anywhere -in:drafts newer_than:30d {"Ref. IPS:" "IPS-TRP" "IPS TRP"}', offset, 100);
      threads = threads.concat(pagina);
      if (pagina.length < 100) break;
      if (offset === 400) diagnostico.buscaLimitada = true;
    }
  }
  diagnostico.threads = threads.length;
  threads.forEach(function(thread) {
    thread.getMessages().forEach(function(message) {
      if (message.isDraft && message.isDraft()) return;
      var from = message.getFrom ? String(message.getFrom() || '') : '';
      if (!transporteMonitorRemetenteElegivel_(from, remetentes)) {
        diagnostico.remetentesRecusados = (diagnostico.remetentesRecusados || 0) + 1;
        return;
      }
      var corpo = [message.getSubject(), message.getPlainBody()].join('\n');
      var temReferencia = false;
      var messageDate = message.getDate ? message.getDate() : new Date();
      Object.keys(referencias).forEach(function(ref) {
        if (!referenciaRegex[ref] || !referenciaRegex[ref].test(corpo)) return;
        if (!temReferencia) { diagnostico.mensagensComReferencia++; temReferencia = true; }
        var item = referencias[ref];
        var geradoEm = transporteOperacaoDate_(item.geradoEm);
        // Documentos com hash nunca reutilizam a tolerancia legada de 5 min:
        // um envio da revisao anterior nao comprova o documento novo.
        var inicioElegivel = geradoEm ? (item.pdfHash ? Math.floor(geradoEm.getTime() / 1000) * 1000 : geradoEm.getTime() - 5 * 60 * 1000) : 0;
        if (geradoEm && messageDate.getTime() < inicioElegivel) { diagnostico.recusas.push({ agendaId: item.agendaId, slot: item.slot, motivo: 'Mensagem anterior à geração' }); return; }
        if (item.pdfHash && !documentoRegex[ref].test(corpo)) {
          diagnostico.recusas.push({ agendaId: item.agendaId, slot: item.slot, motivo: 'Marcador do documento atual ausente ou divergente; revise o envio manualmente' });
          return;
        }
        var anexos = transporteMensagemAnexos_(message);
        var atual = encontrados[ref];
        var exigeDocumentacao = exigeAnexo(item.courier);
        var aceita = anexos.length > 0 || !exigeDocumentacao;
        var atualAceita = atual && (atual.anexos.length > 0 || !exigeDocumentacao);
        if (!atual || (aceita && !atualAceita) || (aceita === atualAceita && messageDate.getTime() > atual.date.getTime())) {
          encontrados[ref] = {
            date: messageDate,
            messageId: message.getId(),
            remetente: from,
            anexos: anexos
          };
        }
      });
    });
  });
  pendentes.forEach(function(item) {
    if (!encontrados[item.referencia.toUpperCase()]) diagnostico.recusas.push({ agendaId: item.agendaId, slot: item.slot, motivo: 'Referência não encontrada em mensagem elegível na conta executora (janela de 30 dias)' });
  });
  if (!Object.keys(encontrados).length) {
    return { ok: true, verificados: pendentes.length, enviados: 0, semAnexo: 0 };
  }
  return codexWithDocumentLock_('transporteMonitorarEnviosPorEmail', function() {
    // Configuracao pode mudar durante a busca Gmail; revalida por fase.
    exigeAnexoCache = Object.create(null);
    if (typeof CODEX_AGENDA_COURIER_ROWS_CACHE_ !== 'undefined') CODEX_AGENDA_COURIER_ROWS_CACHE_ = null;
    var remetentesAtuais = Object.keys(referencias).length ? transporteMonitorRemetentes_() : {};
    var sh = transporteOperacoesSheet_(false);
    // Uma leitura do log sob lock revalida todos os candidatos do lote.
    var operacoesAtuais = {};
    transporteOperacoesRows_().forEach(function(item) { operacoesAtuais[item.row] = item; });
    var agenda = agendaPrecheck || getAgendaSheet_();
    // Recria sob lock: o índice anterior à busca Gmail pode ter ficado obsoleto.
    var snapshotAgenda = null;
    var statusCells = [];
    var audits = [];
    var evidenciaUpdates = [];
    var enviados = [];
    var semAnexo = [];
    var naoPromovidos = [];
    pendentes.forEach(function(item) {
      var match = encontrados[item.referencia.toUpperCase()];
      if (!match || !sh) return;
      if (match.remetente && !transporteMonitorRemetenteElegivel_(match.remetente, remetentesAtuais)) {
        diagnostico.recusas.push({ agendaId: item.agendaId, slot: item.slot, motivo: 'Remetente deixou de ser elegível durante a busca' });
        return;
      }
      var atual = operacoesAtuais[item.row];
      if (!atual || transporteOperacaoVersion_(atual) !== transporteOperacaoVersion_(item) || (transporteOperacaoDate_(atual.emailEnviadoEm) && !item.reprocessar)) {
        diagnostico.recusas.push({ agendaId: item.agendaId, slot: item.slot, motivo: 'Operação alterada ou concluída durante a busca' });
        return;
      }
      var attachmentCount = match.anexos.length;
      var exigeAnexoEnvio = exigeAnexo(item.courier);
      var evidencia = [
        match.date,
        '',
        match.messageId,
        attachmentCount,
        new Date()
      ];
      evidenciaUpdates.push({ row: item.row, values: evidencia });
      if (attachmentCount < 1 && exigeAnexoEnvio) {
        semAnexo.push({ agendaId: item.agendaId, slot: item.slot, messageId: match.messageId });
        return;
      }
      var slotMap = { '1': AGENDA_CFG.idx.c1, '2': AGENDA_CFG.idx.c2, '3': AGENDA_CFG.idx.c3 };
      var idx = slotMap[item.slot];
      if (idx && !snapshotAgenda) snapshotAgenda = transporteAgendaSnapshotMonitor_(agenda);
      var linha = idx && item.agendaId ? (snapshotAgenda.ids[String(item.agendaId)] || 0) : 0;
      if (!idx || !linha) {
        naoPromovidos.push({ agendaId: item.agendaId, slot: item.slot, messageId: match.messageId, motivo: !idx ? 'Slot inválido' : 'Agendamento não encontrado' });
        return;
      }
      var valoresAgenda = snapshotAgenda.rows[linha];
      var statusEvento = valoresAgenda[AGENDA_CFG.col.status - 1];
      if (AgendaServerRules_.isCancelled(statusEvento)) {
        naoPromovidos.push({ agendaId: item.agendaId, slot: item.slot, messageId: match.messageId, motivo: 'Agendamento cancelado' });
        return;
      }
      var statusAnterior = String(valoresAgenda[idx.status] || '').trim();
      var statusKey = AgendaServerRules_.courierStatusKey(statusAnterior);
      // Uma confirmação manual na Agenda é autoritativa para encerrar a
      // pendência. O courier histórico só precisa coincidir quando o monitor
      // ainda vai promover automaticamente o status.
      if (statusKey === 'agendado') {
        evidencia[TRANSPORTE_OPERACOES_HEADERS_.indexOf('Email_Enviado_Em') - TRANSPORTE_OPERACOES_HEADERS_.indexOf('Email_Identificado_Em')] = match.date;
        enviados.push({ agendaId: item.agendaId, slot: item.slot, messageId: match.messageId, anexos: attachmentCount });
        return;
      }
      var courierAtual = String(valoresAgenda[idx.nome] || '').trim();
      if (item.courier && normText_(courierAtual) !== normText_(item.courier)) {
        naoPromovidos.push({ agendaId: item.agendaId, slot: item.slot, messageId: match.messageId, motivo: 'Courier da Agenda diverge da documentação gerada' });
        return;
      }
      if (['naoagendado', 'pendente'].indexOf(statusKey) === -1) {
        naoPromovidos.push({ agendaId: item.agendaId, slot: item.slot, messageId: match.messageId, motivo: 'Status atual não permite promoção automática: ' + (statusAnterior || 'vazio') });
        return;
      }
      statusCells.push(transporteMonitorColunaA1_(idx.status + 1) + linha);
      valoresAgenda[idx.status] = 'Agendado';
      audits.push({ moduleName: 'Agenda', action: 'transporteMonitorarEnviosPorEmail', recordId: item.agendaId, changes: [{
          field: 'Transporte ' + item.slot + ' - Status',
          oldValue: statusAnterior,
          newValue: 'Agendado'
        }], note: 'Envio identificado no Gmail | Ref. ' + item.referencia + ' | Gmail message ' + match.messageId });
      // Somente conclui a operação depois que o vínculo com a Agenda foi
      // validado. Assim, uma divergência transitória continua elegível para
      // nova tentativa no próximo ciclo do monitor.
      evidencia[TRANSPORTE_OPERACOES_HEADERS_.indexOf('Email_Enviado_Em') - TRANSPORTE_OPERACOES_HEADERS_.indexOf('Email_Identificado_Em')] = match.date;
      enviados.push({ agendaId: item.agendaId, slot: item.slot, messageId: match.messageId, anexos: attachmentCount });
    });
    diagnostico.recusas = diagnostico.recusas.concat(naoPromovidos, semAnexo.map(function(item) { return Object.assign({}, item, { motivo: 'Anexos ausentes; courier exige documentação' }); }));
    if (statusCells.length) {
      agenda.getRangeList(statusCells).setValue('Agendado');
      if (typeof agendaInvalidateDateIndexCache_ === 'function') agendaInvalidateDateIndexCache_();
    }
    if (audits.length && typeof codexWriteAuditChangesBatch_ === 'function') codexWriteAuditChangesBatch_(audits);
    else if (typeof codexWriteAuditChanges_ === 'function') audits.forEach(function(entry) {
      codexWriteAuditChanges_(entry.moduleName, entry.action, entry.recordId, entry.changes, entry.note);
    });
    transporteMonitorGravarEvidencias_(sh, evidenciaUpdates);
    // Agenda e evidencias devem estar visiveis antes da proxima consulta.
    if (statusCells.length || evidenciaUpdates.length) SpreadsheetApp.flush();
    return {
      ok: true,
      verificados: pendentes.length,
      enviados: enviados.length,
      semAnexo: semAnexo.length,
      naoPromovidos: naoPromovidos.length,
      itens: enviados,
      itensSemAnexo: semAnexo,
      itensNaoPromovidos: naoPromovidos
    };
  });
}


/* ===== END CODEX_TransporteBridge.gs ===== */


/* ===== BEGIN TransporteWebApp.gs ===== */

var TRANSPORTE_SHEET_NAMES = {
  folhaAgendamento: ['Folha de Agendamento'],
  folhaDhlPinex: ['Folha de Agendamento (DHL/PINEX)', 'Folha de Agendamento (DHLPINEX)'],
  declaracaoTransp: ['DeclaraÃƒÂ§ÃƒÂ£o de Transporte', 'DeclaraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o de Transporte'],
  peticaoAnuencia: ['PetiÃƒÂ§ÃƒÂ£o de AnuÃƒÂªncia de ExportaÃƒÂ§ÃƒÂ£o', 'PetiÃƒÂ§ÃƒÂ£o de AnuÃƒÂªncia de ExportaÃƒÂ§'],
  invoiceDhl: ['Invoice (DHL)'],
  declaracaoTranspDhl: ['DeclaraÃƒÂ§ÃƒÂ£o de Transporte (DHL)', 'DeclaraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o de Transporte (DHL)'],
  protocolos: ['Protocolos'],
  formularioPinex: ['FormulÃƒÂ¡rio (PINEX)', 'FormulÃƒÆ’Ã‚Â¡rio (PINEX)']
};

function codexMatBioTypes_() {
  return [
    { key: 'sangue', label: 'Sangue', unit: 'mL', aliases: ['sangue', 'sangue total', 'blood', 'whole blood'] },
    { key: 'soro', label: 'Soro', unit: 'mL', aliases: ['soro', 'serum'] },
    { key: 'urina', label: 'Urina', unit: 'mL', aliases: ['urina', 'urine', 'urine micro panel', 'urinalysis'] },
    { key: 'plasma', label: 'Plasma', unit: 'mL', aliases: ['plasma', 'plasma edta', 'edta plasma', 'k2 edta plasma', 'k3 edta plasma', 'blood plasma'] },
    { key: 'tecido', label: 'Tecido', unit: 'mL', aliases: ['tecido', 'tissue', 'biopsia', 'biopsy'] },
    { key: 'saliva', label: 'Saliva', unit: 'mL', aliases: ['saliva'] },
    { key: 'fezes', label: 'Fezes', unit: 'g', aliases: ['fezes', 'stool'] },
    { key: 'vacina', label: 'Vacina', unit: 'g', aliases: ['vacina', 'vaccine'] }
  ];
}

function codexMatBioNorm_(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function codexMatBioKeys_() {
  return codexMatBioTypes_().map(function(t) { return t.key; });
}

function codexMatBioLabels_() {
  return codexMatBioTypes_().map(function(t) { return t.label; });
}

function codexMatBioLabelMap_() {
  var out = {};
  codexMatBioTypes_().forEach(function(t) { out[t.key] = t.label; });
  return out;
}

function codexMatBioTypeConfig_(value) {
  var n = codexMatBioNorm_(value);
  if (!n) return null;
  var types = codexMatBioTypes_();
  for (var i = 0; i < types.length; i++) {
    var t = types[i];
    if (n === codexMatBioNorm_(t.key) || n === codexMatBioNorm_(t.label)) return t;
    var aliases = t.aliases || [];
    for (var j = 0; j < aliases.length; j++) {
      if (n === codexMatBioNorm_(aliases[j])) return t;
    }
  }
  return null;
}

function codexMatBioKey_(value) {
  var cfg = codexMatBioTypeConfig_(value);
  if (cfg) return cfg.key;
  var n = ' ' + codexMatBioNorm_(value).replace(/[^a-z0-9]+/g, ' ') + ' ';
  var types = codexMatBioTypes_();
  for (var i = 0; i < types.length; i++) {
    var aliases = types[i].aliases || [];
    for (var j = 0; j < aliases.length; j++) {
      var term = ' ' + codexMatBioNorm_(aliases[j]).replace(/[^a-z0-9]+/g, ' ') + ' ';
      if (term.trim() && n.indexOf(term) >= 0) return types[i].key;
    }
  }
  return 'outro';
}

function codexMatBioUnit_(keyOrLabel, fallback) {
  var cfg = codexMatBioTypeConfig_(keyOrLabel);
  return cfg ? cfg.unit : (fallback || 'mL');
}

var TRANSPORTE_MATERIAL_TYPES = codexMatBioTypes_();
var TRANSPORTE_MATERIAIS = codexMatBioLabels_();
var TRANSPORTE_MATERIAL_KEYS = codexMatBioKeys_();
var TRANSPORTE_MATERIAL_ALIASES = codexMatBioLabelMap_();

TRANSPORTE_SHEET_NAMES.declaracaoTransp = ['DeclaraÃ§Ã£o de Transporte', 'Declaracao de Transporte']
  .concat(TRANSPORTE_SHEET_NAMES.declaracaoTransp || []);
TRANSPORTE_SHEET_NAMES.peticaoAnuencia = ['PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o', 'Peticao de Anuencia de Exportacao']
  .concat(TRANSPORTE_SHEET_NAMES.peticaoAnuencia || []);
TRANSPORTE_SHEET_NAMES.declaracaoTranspDhl = ['DeclaraÃ§Ã£o de Transporte (DHL)', 'Declaracao de Transporte (DHL)']
  .concat(TRANSPORTE_SHEET_NAMES.declaracaoTranspDhl || []);
TRANSPORTE_SHEET_NAMES.formularioPinex = ['FormulÃ¡rio (PINEX)', 'Formulario (PINEX)']
  .concat(TRANSPORTE_SHEET_NAMES.formularioPinex || []);
TRANSPORTE_SHEET_NAMES.declaracaoTransp = ['Declara\u00e7\u00e3o de Transporte', 'Declaracao de Transporte']
  .concat(TRANSPORTE_SHEET_NAMES.declaracaoTransp || []);
TRANSPORTE_SHEET_NAMES.peticaoAnuencia = ['Peti\u00e7\u00e3o de Anu\u00eancia de Exporta\u00e7\u00e3o', 'Peticao de Anuencia de Exportacao']
  .concat(TRANSPORTE_SHEET_NAMES.peticaoAnuencia || []);
TRANSPORTE_SHEET_NAMES.declaracaoTranspDhl = ['Declara\u00e7\u00e3o de Transporte (DHL)', 'Declaracao de Transporte (DHL)']
  .concat(TRANSPORTE_SHEET_NAMES.declaracaoTranspDhl || []);
TRANSPORTE_SHEET_NAMES.formularioPinex = ['Formul\u00e1rio (PINEX)', 'Formulario (PINEX)']
  .concat(TRANSPORTE_SHEET_NAMES.formularioPinex || []);
TRANSPORTE_SHEET_NAMES.proformaOcasa = ['Proforma Invoice (OCASA)'];
TRANSPORTE_SHEET_NAMES.invoiceMarken = ['Invoice (MARKEN)'];
TRANSPORTE_SHEET_NAMES.declaracaoDhl = ['Declara\u00e7\u00e3o (DHL)', 'Declaracao (DHL)'];
TRANSPORTE_SHEET_NAMES.emailOcasa = ['Email (OCASA)', 'E-mail (OCASA)'];
TRANSPORTE_SHEET_NAMES.emailMarken = ['Email (MARKEN)', 'E-mail (MARKEN)'];
TRANSPORTE_SHEET_NAMES.emailDhl = ['Email (DHL)', 'E-mail (DHL)'];
TRANSPORTE_SHEET_NAMES.emailPinex = ['Email (PINEX)', 'E-mail (PINEX)'];
TRANSPORTE_SHEET_NAMES.fichaEmergenciaMarken = ['Ficha de Emerg\u00eancia (MARKEN)', 'Ficha de Emergencia (MARKEN)'];
TRANSPORTE_SHEET_NAMES.fichaEmergenciaOcasa = ['Ficha de Emerg\u00eancia (OCASA)', 'Ficha de Emergencia (OCASA)'];
TRANSPORTE_SHEET_NAMES.telefonesUteisOcasa = ['Telefones \u00dateis (OCASA)', 'Telefones Uteis (OCASA)'];
TRANSPORTE_SHEET_NAMES.invoicePinex = ['Commercial Invoice (PINEX)'];
TRANSPORTE_SHEET_NAMES.usdaStatementPinex = ['USDA Statement (PINEX)'];
TRANSPORTE_SHEET_NAMES.peticaoPinex = ['Peti\u00e7\u00e3o de Anu\u00eancia de Exporta\u00e7\u00e3o (PINEX)', 'Peticao de Anuencia de Exportacao (PINEX)'];
TRANSPORTE_SHEET_NAMES.fichaEmergenciaPinex = ['Ficha de Emerg\u00eancia (PINEX)', 'Ficha de Emergencia (PINEX)'];

var TRANSPORTE_SHEET_LOOKUP_CACHE_ = null;

function transporteGetSheet_(ss, key, required) {
  var names = TRANSPORTE_SHEET_NAMES[key] || [key];
  var sh = transporteFindSheetByNames_(ss, names);
  if (sh) return sh;
  if (required) throw new Error('Aba nao encontrada: ' + names.join(' ou '));
  return null;
}

function transporteFindSheetByNames_(ss, names) {
  names = Array.isArray(names) ? names : [names];
  for (var i = 0; i < names.length; i++) {
    var direct = ss.getSheetByName(names[i]);
    if (direct) return direct;
  }
  var wanted = {};
  names.forEach(function(name) {
    wanted[transporteSheetNameKey_(name)] = true;
  });
  var lookup = transporteSheetLookup_(ss);
  var keys = Object.keys(wanted);
  for (var j = 0; j < keys.length; j++) {
    if (lookup[keys[j]]) return lookup[keys[j]];
  }
  return null;
}

function transporteSheetLookup_(ss) {
  var ssKey = ss.getId ? ss.getId() : 'default';
  if (!TRANSPORTE_SHEET_LOOKUP_CACHE_) TRANSPORTE_SHEET_LOOKUP_CACHE_ = {};
  if (!TRANSPORTE_SHEET_LOOKUP_CACHE_[ssKey]) {
    TRANSPORTE_SHEET_LOOKUP_CACHE_[ssKey] = {};
    ss.getSheets().forEach(function(sheet) {
      TRANSPORTE_SHEET_LOOKUP_CACHE_[ssKey][transporteSheetNameKey_(sheet.getName())] = sheet;
    });
  }
  return TRANSPORTE_SHEET_LOOKUP_CACHE_[ssKey];
}

function transporteSheetNameKey_(value) {
  return transporteNorm_(value).replace(/[^a-z0-9]+/g, '');
}

function transporteNorm_(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function transporteMaterialKey_(value) {
  return codexMatBioKey_(value);
}

// Normaliza metadados, sem converter numeros. A UI fixa a unidade por tipo/courier;
// strict protege dados estruturados externos/legados, nao um campo livre de unidade.
function codexMatBioUnitKey_(unit, strict) {
  var n = codexMatBioNorm_(unit || 'mL');
  if (n === 'l' || n === 'lt' || n === 'litro' || n === 'litros' || n === 'liter' || n === 'liters') return 'L';
  if (n === 'g' || n === 'grama' || n === 'gramas' || n === 'gram' || n === 'grams') return 'g';
  if (strict && ['ml', 'mililitro', 'mililitros', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].indexOf(n) < 0) {
    throw new Error('Unidade de material biológico não suportada. Revise a unidade antes de preparar os documentos.');
  }
  return 'mL';
}

function codexMatBioFormatNumber_(value, decimals) {
    var num = Number(value || 0);
    if (!isFinite(num)) num = 0;
    decimals = decimals === undefined ? 2 : decimals;
    return codexMatBioNumberFormatter_(decimals, decimals, true).format(num);
  }

  function codexMatBioFormulaText_(qtd, vol, decimals) {
    var segmento = codexMatBioValidateSegments_([{ qtd: qtd, vol: vol }])[0];
    // A formula e relida ao salvar/copiar: nao inserir milhares nem arredondar volumes.
    var text = String(segmento.vol), parts = text.split(/e/i);
    if (parts.length === 2) {
      var digits = parts[0].replace('.', ''), point = parts[0].split('.')[0].length + Number(parts[1]);
      text = point <= 0 ? '0.' + '0'.repeat(-point) + digits
        : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point);
    }
    return String(segmento.qtd) + '×' + (text.indexOf('.') < 0 ? text + ',0' : text.replace('.', ','));
  }

  function codexMatBioValidateSegments_(segmentos) {
    var tubos = 0, total = 0;
    return segmentos.map(function(segmento) {
      if (!segmento || typeof segmento !== 'object') throw new Error('Segmento de material biológico inválido.');
      function numeric(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string' && /^\d+(?:[.,]\d+)?$/.test(value.trim())) return Number(value.trim().replace(',', '.'));
        return NaN;
      }
      var qtd = numeric(segmento.qtd), vol = numeric(segmento.vol);
      if (!Number.isSafeInteger(qtd) || qtd <= 0 || !isFinite(vol) || vol < 0) throw new Error('Quantidade ou volume de material biológico inválido.');
      tubos += qtd; total += qtd * vol;
      if (!Number.isSafeInteger(tubos) || !isFinite(total)) throw new Error('Quantidade ou volume fora do limite.');
      return { qtd: qtd, vol: vol };
    });
  }

  function codexMatBioFormulaFromSegments_(segmentos, unit) {
    var decimals = codexMatBioUnitKey_(unit) === 'L' ? 5 : 2;
    return (segmentos || []).map(function(segmento) {
      return codexMatBioFormulaText_(segmento.qtd, segmento.vol, decimals);
    }).join('; ');
  }

  function codexMatBioCalculationDisplay_(formula, unit) {
    var parsed = codexMatBioParseFormula_(formula);
    var key = codexMatBioUnitKey_(unit);
    return {
      parsed: parsed,
      unit: key,
      tubosText: !parsed.valid ? 'Revise a fórmula' : parsed.tubos ? codexMatBioFormatNumber_(parsed.tubos, 0) : '-',
      totalText: !parsed.valid ? 'Inválido' : (parsed.total ? codexMatBioFormatNumber_(parsed.total, key === 'L' ? 5 : 2) : '-') + ' ' + key
    };
  }

  function codexMatBioConvertFormulaUnit_(text, fromUnit, toUnit) {
    fromUnit = codexMatBioUnitKey_(fromUnit); toUnit = codexMatBioUnitKey_(toUnit);
    if (fromUnit === toUnit) return String(text || '');
    if (fromUnit === 'g' || toUnit === 'g') throw new Error('Não é possível converter massa em volume.');
    var parsed = codexMatBioParseFormula_(text);
    if (!parsed.valid) throw new Error(parsed.error);
    if (!parsed.segmentos.length) return String(text || '');
    var factor = fromUnit === 'mL' ? 1 / 1000 : 1000;
    return codexMatBioFormulaFromSegments_(parsed.segmentos.map(function(segmento) {
      return { qtd: segmento.qtd, vol: segmento.vol * factor };
    }), toUnit);
  }

  function codexMatBioParseFormula_(text) {
    var input = String(text == null ? '' : text).trim();
    var segmentos = [], tubos = 0, total = 0;
    // A virgula tambem separa segmentos no formato legado: 2 x 0,5, 1 x 1,5.
    var number = '(?:[1-9]\\d{0,2}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)';
    var re = new RegExp('(' + number + ')\\s*[xX\\u00d7*]\\s*(' + number + ')', 'g');
    var end = 0, m, error = '';
    while ((m = re.exec(input)) !== null) {
      var gap = input.slice(end, m.index);
      if ((!segmentos.length && gap.trim()) || (segmentos.length && !/^\s*[;, +\n]\s*$/.test(gap))) {
        error = 'Revise a fórmula completa de tubos e volume.'; break;
      }
      var qtd = codexMatBioFormulaNumber_(m[1], true), vol = codexMatBioFormulaNumber_(m[2], false);
      if (!Number.isSafeInteger(qtd) || qtd <= 0 || !isFinite(vol) || vol < 0) {
        error = 'Informe uma quantidade inteira positiva de tubos e um volume válido.'; break;
      }
      tubos += qtd; total += qtd * vol;
      if (!Number.isSafeInteger(tubos) || !isFinite(total)) { error = 'Quantidade ou volume fora do limite.'; break; }
      segmentos.push({ qtd: qtd, vol: vol }); end = re.lastIndex;
    }
    if (!error && (input.slice(end).trim() || (input && !segmentos.length))) error = 'Revise a fórmula completa de tubos e volume.';
    return error ? { tubos: 0, total: 0, segmentos: [], valid: false, error: error }
      : { tubos: tubos, total: total, segmentos: segmentos, valid: true, error: '' };
  }

  function codexMatBioFormulaNumber_(value, quantity) {
    var text = String(value);
    // Tubos aceitam milhares legados; no volume, um ponto isolado e decimal.
    // Milhares no volume continuam aceitos com virgula decimal ou varios grupos.
    if ((quantity || text.indexOf(',') >= 0 || text.split('.').length > 2)
        && /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(text)) text = text.replace(/\./g, '');
    return Number(text.replace(',', '.'));
  }

  var CODEX_MATBIO_NUMBER_FORMATTERS_ = Object.create(null);
  function codexMatBioNumberFormatter_(min, max, grouping) {
    var key = min + '|' + max + '|' + grouping;
    if (!CODEX_MATBIO_NUMBER_FORMATTERS_[key]) CODEX_MATBIO_NUMBER_FORMATTERS_[key] = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping
    });
    return CODEX_MATBIO_NUMBER_FORMATTERS_[key];
  }

  function codexMatBioParseJsonResult_(json) {
    if (!String(json || '').trim()) return { items: [], valid: true, error: '' };
    try {
      var obj = JSON.parse(String(json));
      if (!obj || !Array.isArray(obj.items)) throw new Error('Formato de materiais inválido.');
      return { items: obj.items, valid: true, error: '' };
    } catch (e) {
      return { items: [], valid: false, error: 'Dados estruturados de material biológico inválidos. Revise antes de salvar.' };
    }
  }

  function codexMatBioAssertItemsUnit_(items, volumeUnit) {
    (items || []).forEach(function(raw) {
      var cfg = codexMatBioTypeConfig_(raw && (raw.key || raw.tipo));
      var expected = cfg && cfg.unit === 'g' ? 'g' : codexMatBioUnitKey_(volumeUnit);
      var item = codexMatBioNormalizeItem_(raw && Object.assign({}, raw, { unit: raw.unit || expected }), true);
      if (item.segmentos.length && item.unit !== expected) throw new Error('Material ' + item.tipo + ': a fórmula está em ' + item.unit + '. Converta ou revise os volumes para ' + expected + ' antes de salvar.');
    });
  }

  function codexMatBioPushUnique_(list, value) {
    value = String(value || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    var n = codexMatBioNorm_(value);
    var exists = list.some(function(item) { return codexMatBioNorm_(item) === n; });
    if (!exists) list.push(value);
  }

  function codexMatBioNormalizeItem_(item, skipFormula) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Material biológico inválido.');
    var cfg = codexMatBioTypeConfig_(item.key || item.tipo);
    var key = cfg ? cfg.key : (item.key || 'outro');
    var tipo = cfg && !cfg.outro ? cfg.label : String(item.tipo || (cfg && cfg.label) || '').trim();
    var unit = codexMatBioUnitKey_(item.unit || (cfg && cfg.unit) || 'mL');
    if (item.segmentos !== undefined && !Array.isArray(item.segmentos)) throw new Error('Segmentos de material biológico inválidos.');
    var sourceSegments = item.segmentos || [];
    var parsed = sourceSegments.length ? null : codexMatBioParseFormula_(item.formula || '');
    if (parsed && !parsed.valid) throw new Error(parsed.error);
    var segmentos = codexMatBioValidateSegments_(sourceSegments.length ? sourceSegments : parsed.segmentos);
    var tubos = 0, total = 0;
    segmentos.forEach(function(segmento) { tubos += segmento.qtd; total += segmento.qtd * segmento.vol; });
    return { key: key, tipo: tipo, ensaio: String(item.ensaio || '').trim(),
      formula: skipFormula ? '' : codexMatBioFormulaFromSegments_(segmentos, unit), tubos: tubos, total: total, unit: unit, segmentos: segmentos };
  }

  function codexMatBioGroupItems_(items) {
    var order = [];
    var groups = Object.create(null);
    (items || []).forEach(function(raw) {
      var item = codexMatBioNormalizeItem_(raw, true);
      if (!item.tipo && !item.segmentos.length) return;
      var groupKey = item.key === 'outro' ? item.key + '|' + codexMatBioNorm_(item.tipo) : item.key;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: item.key,
          tipo: item.tipo,
          unit: item.unit,
          segmentos: [],
          tubos: 0, total: 0, ensaios: [], ensaiosSeen: Object.create(null)
        };
        order.push(groupKey);
      }
      groups[groupKey].tubos += item.tubos; groups[groupKey].total += item.total;
      if (!Number.isSafeInteger(groups[groupKey].tubos) || !isFinite(groups[groupKey].total)) throw new Error('Quantidade ou volume fora do limite.');
      if (groups[groupKey].unit !== item.unit) throw new Error('Unidades diferentes para o mesmo material. Revise a conversão antes de salvar.');
      item.segmentos.forEach(function(segmento) { groups[groupKey].segmentos.push(segmento); });
      String(item.ensaio || '').split(/\s*;\s*/).forEach(function(ensaio) {
        ensaio = ensaio.replace(/\s+/g, ' ').trim();
        var normalized = codexMatBioNorm_(ensaio);
        if (ensaio && !groups[groupKey].ensaiosSeen[normalized]) {
          groups[groupKey].ensaiosSeen[normalized] = true; groups[groupKey].ensaios.push(ensaio);
        }
      });
    });
    return order.map(function(key) {
      var group = groups[key];
      var tubos = group.tubos, total = group.total;
      return {
        key: group.key,
        tipo: group.tipo,
        ensaio: group.ensaios.join('; '),
        formula: codexMatBioFormulaFromSegments_(group.segmentos, group.unit),
        tubos: tubos,
        total: total,
        unit: codexMatBioUnitKey_(group.unit),
        segmentos: group.segmentos
      };
    });
  }

  function codexMatBioSummaryFromItems_(items) {
    return (items || []).map(function(item) {
      var label = item.tipo + (item.ensaio ? ' (' + item.ensaio + ')' : '');
      if (!item.segmentos || !item.segmentos.length) return label;
      var unit = codexMatBioUnitKey_(item.unit);
      return label + ': ' + codexMatBioFormatNumber_(item.tubos, 0) + ' tubo(s), ' + codexMatBioFormatNumber_(item.total, unit === 'L' ? 5 : 2) + ' ' + unit;
    }).join('; ');
  }

  function codexMatBioSerializeItems_(items) {
    var grouped = codexMatBioGroupItems_(items);
    return {
      items: grouped,
      json: grouped.length ? JSON.stringify({ v: 1, items: grouped }) : '',
      summary: codexMatBioSummaryFromItems_(grouped)
    };
  }


function codexMatBioParseJson_(json, strict) {
  var result = codexMatBioParseJsonResult_(json);
  if (strict && !result.valid) throw new Error(result.error);
  return result.items;
}


function codexMatBioCourierUnit_(courier) {
  return codexMatBioNorm_(courier).indexOf('dhl') >= 0 ? 'L' : 'mL';
}

function codexMatBioValidateAgendaPayload_(dados) {
  ['courier1', 'courier2', 'courier3', 'backup'].forEach(function(slot) {
    var courier = dados && dados[slot];
    if (!courier) return;
    var json = courier.matBioJson !== undefined ? courier.matBioJson : courier.materialJson;
    if (json === undefined || !String(json || '').trim()) return;
    var items = codexMatBioParseJson_(json, true);
    codexMatBioAssertItemsUnit_(items, codexMatBioCourierUnit_(courier.nome));
    codexMatBioGroupItems_(items);
  });
}

function codexMatBioValidateTransportPayload_(payload) {
  var materials = payload.materiais || [];
  if (!Array.isArray(materials)) throw new Error('Materiais de Transporte inválidos.');
  materials.forEach(function(item) {
    if (!item || item.ativo !== true) return;
    item.ensaio = String(item.ensaio || item.exame || item.nomeExame || '').trim();
    var cfg = codexMatBioTypeConfig_(item.material), expected = cfg && cfg.unit === 'g' ? 'g' : codexMatBioCourierUnit_(payload.courier);
    var unit = codexMatBioUnitKey_(item.unit || expected, true);
    var parsed = codexMatBioParseFormula_(item.formula || '');
    if (!parsed.valid) throw new Error(parsed.error);
    if (parsed.segmentos.length && unit !== expected) throw new Error('Material ' + item.material + ': revise os volumes para ' + expected + ' antes de salvar.');
    if (parsed.segmentos.length) {
      item.tubos = parsed.tubos; item.total = parsed.total;
      item.formula = codexMatBioFormulaFromSegments_(parsed.segmentos, unit);
    } else if ((item.tubos !== undefined && item.tubos !== null && item.tubos !== '')
        || (item.total !== undefined && item.total !== null && item.total !== '')) {
      if (item.tubos === undefined || item.tubos === null || item.tubos === ''
          || item.total === undefined || item.total === null || item.total === '') {
        throw new Error('Informe a quantidade e o volume total do material ' + item.material + ', ou deixe ambos vazios.');
      }
      var numeric = codexMatBioValidateSegments_([{ qtd: item.tubos, vol: item.total }])[0];
      var tubos = numeric.qtd, total = numeric.vol;
      codexMatBioValidateSegments_([{ qtd: tubos, vol: total / tubos }]);
      if (unit !== expected) throw new Error('Revise a unidade do material ' + item.material + ' para ' + expected + '.');
      item.tubos = tubos; item.total = total;
    }
    item.unit = unit;
  });
}

function transporteFormatNumberPt_(value, decimals) {
  return codexMatBioFormatNumber_(value, decimals);
}

function transporteFormulaFromSegments_(segments, unit) {
  return codexMatBioFormulaFromSegments_(segments, unit);
}

function transporteParseFormula_(text) {
  return codexMatBioParseFormula_(text);
}

function transporteNumber_(value, quantity) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  // Mesma regra das fórmulas: ponto isolado é decimal no volume;
  // quantidades preservam milhares legados como "1.000".
  var n = codexMatBioFormulaNumber_(String(value).trim(), quantity === true);
  return isFinite(n) ? n : 0;
}

function transporteTotalMaterial_(item) {
  item = item || {};
  if (item.total !== null && item.total !== undefined && item.total !== '') {
    return transporteNumber_(item.total);
  }
  return transporteParseFormula_(item.formula).total;
}

function transporteTubosMaterial_(item) {
  item = item || {};
  if (item.tubos !== null && item.tubos !== undefined && item.tubos !== '') {
    return transporteNumber_(item.tubos, true);
  }
  return transporteParseFormula_(item.formula).tubos;
}

function transporteTotalEmLitros_(item) {
  var total = transporteTotalMaterial_(item);
  var unit = transporteNorm_(item && item.unit);
  if (unit === 'l') return total;
  if (unit === 'ml') return total / 1000;
  return total;
}

function transporteParseMatBioJson_(json) {
  return codexMatBioParseJson_(json);
}

function transporteMatBioUnitKey_(unit) {
  return codexMatBioUnitKey_(unit);
}

function transporteMateriaisFromCodex_(courier, matBioJson, materialLegacy) {
  var parsedItems = codexMatBioParseJson_(matBioJson, true);
  parsedItems.forEach(function(item) {
    if (item && item.unit) codexMatBioUnitKey_(item.unit, true);
  });
  codexMatBioAssertItemsUnit_(parsedItems, codexMatBioCourierUnit_(courier));
  var byKey = Object.create(null);
  var otherKeys = [];
  parsedItems.forEach(function(item) {
    item = item || {};
    var key = transporteMaterialKey_(item.key || item.tipo);
    var label = key === 'outro' ? String(item.tipo || 'Outro tipo').trim() : TRANSPORTE_MATERIAL_ALIASES[key];
    var groupKey = key === 'outro' ? key + '|' + codexMatBioNorm_(label) : key;
    var baseUnit = codexMatBioUnit_(key, 'mL');
    var unit = item.unit ? transporteMatBioUnitKey_(item.unit) : (baseUnit === 'g' ? 'g' : (transporteNorm_(courier).indexOf('dhl') >= 0 ? 'L' : 'mL'));
    var formula = Array.isArray(item.segmentos) && item.segmentos.length
      ? transporteFormulaFromSegments_(item.segmentos, unit)
      : (item.formula || '');
    var normalized = codexMatBioNormalizeItem_({ key: key, tipo: label, formula: formula, unit: unit });
    var calc = normalized;
    var total = item.total !== undefined && item.total !== null && item.total !== '' ? Number(item.total) : calc.total;
    var tubos = item.tubos !== undefined && item.tubos !== null && item.tubos !== '' ? Number(item.tubos) : calc.tubos;
    if (!byKey[groupKey]) {
      byKey[groupKey] = { ativo: true, material: label, tubos: 0, total: 0, formulas: [], ensaios: [], unit: unit };
      if (key === 'outro') otherKeys.push(groupKey);
    }
    byKey[groupKey].tubos += tubos || 0;
    byKey[groupKey].total += total || 0;
    if (formula) byKey[groupKey].formulas.push(formula);
    if (item.ensaio) byKey[groupKey].ensaios.push(String(item.ensaio).trim());
  });

  if (!parsedItems.length && materialLegacy) {
    byKey.outro = {
      ativo: true,
      material: String(materialLegacy).trim(),
      tubos: '',
      total: '',
      formulas: [],
      ensaios: [],
      unit: transporteNorm_(courier).indexOf('dhl') >= 0 ? 'L' : 'mL'
    };
    otherKeys.push('outro');
  }

  var rows = TRANSPORTE_MATERIAL_KEYS.map(function(key) {
    var item = byKey[key];
    // Sem formula, os zeros da normalizacao indicam ausencia de quantificacao.
    // Preserve o material/ensaio sem envia-los como uma quantidade invalida.
    return item ? {
      ativo: true,
      material: TRANSPORTE_MATERIAL_ALIASES[key],
      tubos: item.formulas.length ? item.tubos : '',
      formula: item.formulas.join(', '),
      total: item.formulas.length ? item.total : '',
      ensaio: item.ensaios.join('; '),
      unit: item.unit
    } : {
      ativo: false,
      material: TRANSPORTE_MATERIAL_ALIASES[key],
      tubos: '',
      formula: '',
      total: '',
      ensaio: '',
      unit: codexMatBioUnit_(key, 'mL') === 'g' ? 'g' : (transporteNorm_(courier).indexOf('dhl') >= 0 ? 'L' : 'mL')
    };
  });
  otherKeys.forEach(function(key) {
    var item = byKey[key];
    rows.push({
      ativo: true,
      material: item.material,
      tubos: item.formulas.length ? item.tubos : '',
      formula: item.formulas.join(', '),
      total: item.formulas.length ? item.total : '',
      ensaio: item.ensaios.join('; '),
      unit: item.unit
    });
  });
  return rows;
}

function transporteNormalizeCourierFromCodex_(value) {
  var n = transporteNorm_(value);
  if (n === 'dhl' || n.indexOf('dhl') >= 0) return 'DHL';
  if (n === 'marken') return 'MARKEN';
  if (n === 'ocasa') return 'OCASA';
  // Todo o fluxo de documentos compara PINEX por valor canonico. Preservar a
  // capitalizacao vinda da Agenda (por exemplo, "Pinex") faz o PDF cair no
  // pacote generico de documentos.
  if (n.indexOf('pinex') >= 0) {
    return n.indexOf('agendamento') >= 0 ? 'PINEX (Agendamento)' : 'PINEX';
  }
  return String(value || '').trim();
}

function transporteIsDhl_(value) {
  return transporteNorm_(value).indexOf('dhl') >= 0;
}

function transporteSortCouriers_(couriers) {
  var ordem = {
    'marken': 10,
    'ocasa': 20,
    'dhl': 30,
    'pinex': 40,
    'pinex (agendamento)': 50
  };
  var seen = {};
  return (couriers || []).map(function(courier) {
    return transporteNormalizeCourierFromCodex_(courier);
  }).filter(function(courier) {
    var key = transporteNorm_(courier);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  }).sort(function(a, b) {
    var ao = ordem[transporteNorm_(a)] || 999;
    var bo = ordem[transporteNorm_(b)] || 999;
    return ao - bo || String(a).localeCompare(String(b));
  });
}

function transporteReadAgendaCourierConfigs_() {
  try {
    if (typeof getAgendaCourierConfigs_ === 'function') return getAgendaCourierConfigs_() || {};
  } catch (e) {
    Logger.log('Configuracoes de courier da Agenda nao carregadas: ' + e.message);
  }
  return {};
}

function transporteCourierConfig_(courier) {
  var configs = transporteReadAgendaCourierConfigs_();
  var normalized = transporteNormalizeCourierFromCodex_(courier);
  return configs[transporteNorm_(normalized)] || configs[transporteNorm_(courier)] || {};
}

function transporteCourierExigeAnexoEnvio_(courier) {
  var cfg = transporteCourierConfig_(courier);
  var regra = {
    nome: cfg.nome || cfg.courier || courier,
    exigeAnexoEnvio: cfg.exigeAnexoEnvio
  };
  if (typeof courierExigeAnexoEnvio_ === 'function') return courierExigeAnexoEnvio_(regra);
  var informado = transporteNorm_(regra.exigeAnexoEnvio);
  if (informado === 'sim') return true;
  if (informado === 'nao') return false;
  return transporteNorm_(regra.nome).indexOf('dhl') === -1;
}

function transporteSetAdjacentByLabel_(sheet, labels, value, occurrence) {
  if (!sheet || value === null || value === undefined || String(value).trim() === '') return false;
  labels = labels || [];
  occurrence = occurrence || 1;
  var wanted = labels.map(function(label) { return transporteNorm_(label); }).filter(Boolean);
  if (!wanted.length) return false;
  var values = transporteGetDisplayValuesCached_(sheet);
  var found = 0;
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var cell = transporteNorm_(values[r][c]);
      if (!cell) continue;
      var ok = wanted.some(function(label) { return cell === label || cell.indexOf(label) >= 0; });
      if (!ok) continue;
      found++;
      if (found !== occurrence) continue;
      if (c + 1 >= values[r].length) return false;
      var target = sheet.getRange(r + 1, c + 2);
      transporteSetRichTextOrValue_(target, value);
      return true;
    }
  }
  return false;
}

function transporteGetDisplayValuesCached_(sheet) {
  var key;
  try {
    key = sheet.getParent().getId() + ':' + sheet.getSheetId() + ':' + sheet.getLastRow() + ':' + sheet.getLastColumn();
  } catch (e) {
    key = String(sheet.getName ? sheet.getName() : 'sheet');
  }
  if (!TRANSPORTE_ADJACENT_LABEL_CACHE_[key]) {
    TRANSPORTE_ADJACENT_LABEL_CACHE_[key] = sheet.getDataRange().getDisplayValues();
  }
  return TRANSPORTE_ADJACENT_LABEL_CACHE_[key];
}

function transporteClearAdjacentLabelCache_() {
  TRANSPORTE_ADJACENT_LABEL_CACHE_ = {};
}

function transporteSetRichTextOrValue_(range, value) {
  if (!range || value === null || value === undefined) return false;
  // O parser RichText decodifica cada token uma unica vez.
  var rich = transporteHtmlToRichText_(value);
  if (rich) range.setRichTextValue(rich);
  else range.setValue(transporteTextoLiteralParaCelula_(transporteSanitizeForCell_(value)));
  return true;
}

function transporteTextoLiteralParaCelula_(value) {
  // Range.setValue/setValues interpreta '=' como formula. Numeros, datas,
  // booleanos, placeholders e calculos internos conservam seus tipos.
  return typeof value === 'string' && value.charAt(0) === '=' ? "'" + value : value;
}

function transporteSanitizeForCell_(value) {
  if (typeof value !== 'string') return value;
  return transporteHtmlDecode_(value);
}

function transporteHtmlDecode_(text) {
  var map = {
    'nbsp': '\u00A0', 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"',
    'apos': "'",
    // Portugues e Latin-1
    'ccedil': '\u00e7', 'Ccedil': '\u00c7',
    'atilde': '\u00e3', 'Atilde': '\u00c3',
    'otilde': '\u00f5', 'Otilde': '\u00d5',
    'eacute': '\u00e9', 'Eacute': '\u00c9',
    'ecirc':  '\u00ea', 'Ecirc':  '\u00ca',
    'egrave': '\u00e8', 'Egrave': '\u00c8',
    'oacute': '\u00f3', 'Oacute': '\u00d3',
    'ocirc':  '\u00f4', 'Ocirc':  '\u00d4',
    'ograve': '\u00f2', 'Ograve': '\u00d2',
    'aacute': '\u00e1', 'Aacute': '\u00c1',
    'agrave': '\u00e0', 'Agrave': '\u00c0',
    'acirc':  '\u00e2', 'Acirc':  '\u00c2',
    'auml':   '\u00e4', 'Auml':   '\u00c4',
    'aring':  '\u00e5', 'Aring':  '\u00c5',
    'iacute': '\u00ed', 'Iacute': '\u00cd',
    'icirc':  '\u00ee', 'Icirc':  '\u00ce',
    'igrave': '\u00ec', 'Igrave': '\u00cc',
    'iuml':   '\u00ef', 'Iuml':   '\u00cf',
    'uacute': '\u00fa', 'Uacute': '\u00da',
    'ucirc':  '\u00fb', 'Ucirc':  '\u00db',
    'ugrave': '\u00f9', 'Ugrave': '\u00d9',
    'uuml':   '\u00fc', 'Uuml':   '\u00dc',
    'ntilde': '\u00f1', 'Ntilde': '\u00d1',
    'szlig':  '\u00df',
    // Pontuacao e tipografia
    'mdash': '\u2014', 'ndash': '\u2013',
    'lsquo': '\u2018', 'rsquo': '\u2019',
    'ldquo': '\u201c', 'rdquo': '\u201d',
    'laquo': '\u00ab', 'raquo': '\u00bb',
    'deg':   '\u00b0', 'micro': '\u00b5',
    'times': '\u00d7', 'divide': '\u00f7',
    'copy':  '\u00a9', 'reg':   '\u00ae',
    'trade': '\u2122', 'euro':  '\u20ac',
    'pound': '\u00a3', 'sect':  '\u00a7',
    'para':  '\u00b6', 'ordf':  '\u00aa',
    'ordm':  '\u00ba', 'sup1':  '\u00b9',
    'sup2':  '\u00b2', 'sup3':  '\u00b3'
  };
  return String(text == null ? '' : text).replace(/&(?:([a-zA-Z]+)|#(\d+)|#x([0-9a-fA-F]+));/g, function(m, entity, code, hex) {
    if (entity) return map[entity] !== undefined ? map[entity] : m;
    var point = hex ? parseInt(hex, 16) : Number(code);
    if (!isFinite(point) || point < 0 || point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF)) return m;
    return String.fromCodePoint(point);
  });
}

function transporteHtmlToRichText_(html) {
  html = String(html || '');
  if (!/<\/?[a-z][\s\S]*>/i.test(html)) return null;
  var tokens = html.replace(/<br\s*\/?>/gi, '\n').split(/(<[^>]+>)/g);
  var text = '';
  var ranges = [];
  var style = { bold: false, italic: false, underline: false };
  tokens.forEach(function(token) {
    if (!token) return;
    if (token.charAt(0) === '<') {
      var tag = token.replace(/[<>]/g, '').replace(/\/.*/, function(m) { return m; }).trim().toLowerCase();
      var close = /^<\//.test(token);
      if (/^\/?b\b|^\/?strong\b/.test(tag)) style.bold = !close;
      else if (/^\/?i\b|^\/?em\b/.test(tag)) style.italic = !close;
      else if (/^\/?u\b/.test(tag)) style.underline = !close;
      else if (/^\/?(div|p)\b/.test(tag) && close && text && text.slice(-1) !== '\n') text += '\n';
      return;
    }
    var plain = transporteHtmlDecode_(token);
    if (!plain) return;
    var start = text.length;
    text += plain;
    var end = text.length;
    if (style.bold || style.italic || style.underline) {
      ranges.push({ start: start, end: end, bold: style.bold, italic: style.italic, underline: style.underline });
    }
  });
  text = text.replace(/\n+$/g, '');
  if (!text) return null;
  var builder = SpreadsheetApp.newRichTextValue().setText(text);
  ranges.forEach(function(r) {
    if (r.start >= text.length) return;
    var end = Math.min(r.end, text.length);
    if (end <= r.start) return;
    var textStyle = SpreadsheetApp.newTextStyle()
      .setBold(r.bold)
      .setItalic(r.italic)
      .setUnderline(r.underline)
      .build();
    builder.setTextStyle(r.start, end, textStyle);
  });
  return builder.build();
}

function transporteAplicarCourierConfig_(ss, courier) {
  try {
    var cfg = transporteCourierConfig_(courier);
    if (!cfg || !cfg.nome) return;
    var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
    var declaracao = transporteGetSheet_(ss, 'declaracaoTransp', false);

    if (declaracao && cfg.conteudoDeclaracao) {
      transporteSetRichTextOrValue_(declaracao.getRange('B14'), cfg.conteudoDeclaracao);
    }

    if (peticao) {
      transporteSetTopLeftInBlock_(peticao, 'I16:R16', cfg.empresa1);
      transporteSetTopLeftInBlock_(peticao, 'D17:H17', cfg.cnpj1);
      transporteSetTopLeftInBlock_(peticao, 'K17:N17', cfg.telefone1);
      transporteSetTopLeftInBlock_(peticao, 'P17:R17', cfg.fax1);
      transporteSetTopLeftInBlock_(peticao, 'I18:R18', cfg.empresa2);
      transporteSetTopLeftInBlock_(peticao, 'D19:H19', cfg.cnpj2);
      transporteSetTopLeftInBlock_(peticao, 'K19:N19', cfg.telefone2);
      transporteSetTopLeftInBlock_(peticao, 'P19:R19', cfg.fax2);
    }

  } catch (e) {
    Logger.log('Configuracao de courier nao aplicada no Transporte: ' + e.message);
  }
}

function transportePreencherPeticaoMedico_(ss, payload) {
  payload = payload || {};
  var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
  if (!peticao) return;
  var medicoNome = String(payload.investigador || '').trim();
  if (!medicoNome) {
    var folha = transporteGetSheet_(ss, 'folhaAgendamento', false);
    medicoNome = folha ? String(getCellValueSafe(folha, 'C5') || '').trim() : '';
  }
  var medico = transporteMedicoByNome_(medicoNome);
  if (medico) {
    transporteSetTopLeftInBlock_(peticao, 'F14:K14', medico.nome || medicoNome);
    transporteSetTopLeftInBlock_(peticao, 'N14:R14', medico.cremers || '');
    var assinatura = (medico.nome && medico.cremers)
      ? 'Dr(a). ' + medico.nome + ' - CREMERS: ' + medico.cremers
      : '';
    transporteSetTopLeftInBlock_(peticao, 'B50:I50', assinatura);
  } else {
    transporteSetTopLeftInBlock_(peticao, 'F14:K14', '');
    transporteSetTopLeftInBlock_(peticao, 'N14:R14', '');
    transporteSetTopLeftInBlock_(peticao, 'B50:I50', '');
  }
}

function transporteSetTopLeftInBlock_(sheet, a1, value) {
  var range = sheet.getRange(a1);
  range.clearContent();
  value = String(transporteSanitizeForCell_(value) || '').trim();
  if (value) range.getCell(1, 1).setValue(transporteTextoLiteralParaCelula_(value));
}

function transporteNormalizeTemperaturaFromCodex_(value) {
  var n = transporteNorm_(value);
  if (n.indexOf('congel') >= 0 && n.indexOf('ambient') >= 0) return 'AMBIENTE + CONGELADO';
  if (n.indexOf('congel') >= 0) return 'CONGELADO';
  if (n.indexOf('refrig') >= 0) return 'REFRIGERADO';
  if (n.indexOf('ambient') >= 0) return 'AMBIENTE';
  return String(value || '').trim().toUpperCase();
}

function transporteReadLabCentralDireto_() {
  // Uso interno de Transporte já autorizado, inclusive importação por credencial.
  // Não chama getLabCentralSheet_: uma consulta não deve criar/alterar schema.
  var rows = getCodexSheetDataByName_('LabCentral') || [];
  return rows.slice(1).filter(function(r) { return r[0] || r[1] || r[2]; }).map(function(r) {
    return {
      id: String(r[0] || ''), nomeAbreviado: String(r[1] || ''), nomeCompleto: String(r[2] || ''),
      endereco: String(r[3] || ''), cidade: String(r[4] || ''), cep: String(r[5] || ''),
      telefone: String(r[6] || ''), contato: String(r[7] || ''), pais: String(r[8] || ''), cdcPermit: String(r[9] || '')
    };
  });
}

function transporteReadLabCentral_() {
  if (typeof getLabCentral === 'function') {
    try {
      return getLabCentral() || [];
    } catch (e) {
      // A integração POST não possui identidade Users; consulta privada restrita ao Transporte.
      if (typeof getCodexSheetDataByName_ !== 'function') throw e;
    }
  }
  return transporteReadLabCentralDireto_();
}

function transporteLabCentralByDestino_(destino) {
  destino = String(destino || '').trim();
  if (!destino) return null;
  var destinoKey = transporteNorm_(destino);
  try {
    var labs = transporteReadLabCentral_();
    for (var i = 0; i < labs.length; i++) {
      var lab = labs[i] || {};
      var curto = String(lab.nomeAbreviado || '').trim();
      var completo = String(lab.nomeCompleto || '').trim();
      if (transporteNorm_(curto) === destinoKey || transporteNorm_(completo) === destinoKey) {
        return lab;
      }
    }
  } catch (e) {
    Logger.log('LabCentral nao localizado para destino: ' + e.message);
  }
  return null;
}

function transporteLabCentralDestinoPadrao_() {
  try {
    var labs = transporteReadLabCentral_();
    for (var i = 0; i < labs.length; i++) {
      var nome = String(labs[i].nomeAbreviado || labs[i].nomeCompleto || '').trim();
      if (nome) return nome;
    }
  } catch (e) {
    Logger.log('LabCentral padrao nao carregado: ' + e.message);
  }
  return '';
}

function transporteLabCentralCidadePais_(lab) {
  lab = lab || {};
  var cidade = String(lab.cidade || '').trim();
  var pais = String(lab.pais || '').trim();
  if (!cidade) return pais;
  if (!pais || transporteNorm_(cidade).indexOf(transporteNorm_(pais)) >= 0) return cidade;
  return cidade + ', ' + pais;
}

function transporteMedicoNomeKey_(nome) {
  return transporteNorm_(String(nome || '')
    .replace(/^\s*dr(?:a|\(a\))?\.?\s*/i, '')
    .trim());
}

function transporteMedicoByNome_(nome) {
  var key = transporteMedicoNomeKey_(nome);
  if (!key) return null;
  try {
    var medicos = [];
    if (typeof getMedicos === 'function') {
      try {
        medicos = getMedicos() || [];
      } catch (eGetMedicos) {
        Logger.log('getMedicos falhou no Transporte; usando leitura direta: ' + eGetMedicos.message);
      }
    }
    if (!medicos.length) medicos = transporteReadMedicosDireto_();
    for (var i = 0; i < medicos.length; i++) {
      var medico = medicos[i] || {};
      if (transporteMedicoNomeKey_(medico.nome) === key) return medico;
    }
  } catch (e) {
    Logger.log('Medico nao localizado para Transporte: ' + e.message);
  }
  return null;
}

function transporteReadMedicosDireto_() {
  var out = [];
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var sh = null;
    for (var i = 0; i < sheets.length; i++) {
      if (transporteNorm_(sheets[i].getName()).indexOf('medico') >= 0) {
        sh = sheets[i];
        break;
      }
    }
    if (!sh || sh.getLastRow() < 2) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(sh.getLastColumn(), 7)).getValues().forEach(function(r) {
      if (!String(r[1] || '').trim()) return;
      out.push({
        id: r[0],
        nome: r[1],
        especialidade: r[2],
        cpf: r[3],
        cremers: r[4],
        telefone: r[5],
        email: r[6]
      });
    });
  } catch (e) {
    Logger.log('Cadastro de medicos nao lido diretamente: ' + e.message);
  }
  return out;
}

function transportePreencherDeclaracaoCadastros_(ss, payload) {
  payload = payload || {};
  var declaracao = transporteGetSheet_(ss, 'declaracaoTransp', false);
  if (!declaracao) return;

  var medicoNome = String(payload.investigador || getCellValueSafe(declaracao, 'D10') || '').trim();
  var medico = transporteMedicoByNome_(medicoNome);
  if (medico) {
    declaracao.getRange('J10:K10').setValue(medico.cpf || '');
    declaracao.getRange('M10').setValue(medico.cremers || '');
    var assinatura = (medico.nome && medico.cremers)
      ? 'Dr(a). ' + medico.nome + ' - CREMERS: ' + medico.cremers + '.'
      : '';
    declaracao.getRange('B49:P49').setValue(assinatura);
  } else {
    declaracao.getRange('J10:K10').clearContent();
    declaracao.getRange('M10').clearContent();
    declaracao.getRange('B49:P49').clearContent();
  }

  var destinoNome = String(payload.destino || getCellValueSafe(declaracao, 'D38') || '').trim();
  var lab = transporteLabCentralByDestino_(destinoNome);
  if (lab) {
    declaracao.getRange('D38').setValue(lab.nomeCompleto || lab.nomeAbreviado || destinoNome);
    declaracao.getRange('D39').setValue(lab.endereco || '');
    declaracao.getRange('N39:P39').setValue(transporteLabCentralCidadePais_(lab));
  } else {
    declaracao.getRange('D38').clearContent();
    declaracao.getRange('D39').clearContent();
    declaracao.getRange('N39:P39').clearContent();
  }
}

function transporteDateOut_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return value ? String(value) : '';
}

function transporteTimeOut_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }
  return value ? String(value) : '';
}

function transporteParseDate_(value) {
  if (!value) return '';
  if (value instanceof Date) return value;
  var parts = String(value).split('-');
  if (parts.length === 3) return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return value;
}

function transporteParticipantKey_(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function transporteReadProjetosDireto_() {
  var rows = typeof getCodexSheetDataByName_ === 'function'
    ? (getCodexSheetDataByName_('Projetos') || [])
    : [];
  return rows.slice(1).filter(function(r) {
    return r[0] !== '' && r[0] !== undefined && r[0] !== null;
  }).map(function(r) {
    return {
      nomeAbreviado: String(r[1] || '').trim(),
      codigo: String(r[2] || '').trim(),
      investigador: String(r[5] || '').trim(),
      numeroCE: String(r[14] || '').trim(),
      expedienteCE: String(r[15] || '').trim(),
      tituloCompleto: String(r[16] || '').trim()
    };
  });
}

function transporteProjetoInvestigadorMap_() {
  var map = {};
  function put(nome, investigador) {
    nome = String(nome || '').trim();
    investigador = String(investigador || '').trim();
    if (!nome || !investigador) return;
    map[nome] = investigador;
    map[transporteParticipantKey_(nome)] = investigador;
  }
  try {
    transporteReadProjetosDireto_().forEach(function(p) {
      var investigador = String(p.investigador || '').trim();
      [p.nomeAbreviado, p.codigo].forEach(function(nome) {
        put(nome, investigador);
      });
    });
    if (Object.keys(map).length) return map;
  } catch (eProjetos) {
    Logger.log('Projetos nao carregados no Transporte: ' + eProjetos.message);
  }
  try {
    var ss = getTransporteSpreadsheetCodex_();
    var sh = ss.getSheetByName('Projetos');
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(6, sh.getLastColumn())).getValues()
        .forEach(function(r) {
          var investigador = String(r[5] || '').trim();
          [r[1], r[2]].forEach(function(nome) {
            put(nome, investigador);
          });
        });
    }
  } catch (eSheet) {
    Logger.log('Mapa de investigadores nao carregado no Transporte: ' + eSheet.message);
  }
  return map;
}

function transporteInvestigadorPorProjeto_(projeto, map) {
  projeto = String(projeto || '').trim();
  if (!projeto) return '';
  map = map || transporteProjetoInvestigadorMap_();
  return String(map[projeto] || map[transporteParticipantKey_(projeto)] || '').trim();
}

function transporteProjetoInfo_(projeto) {
  projeto = String(projeto || '').trim();
  var alvo = transporteParticipantKey_(projeto);
  if (!alvo) return null;
  var rows = [];
  try {
    rows = transporteReadProjetosDireto_();
  } catch (eProjetos) {
    Logger.log('Projetos nao carregados para nome de transporte: ' + eProjetos.message);
  }
  if (!rows.length) {
    try {
      var ss = getTransporteSpreadsheetCodex_();
      var sh = ss.getSheetByName('Projetos');
      if (sh && sh.getLastRow() > 1) {
        rows = sh.getRange(2, 2, sh.getLastRow() - 1, Math.min(16, sh.getLastColumn() - 1)).getValues().map(function(r) {
          return {
            nomeAbreviado: String(r[0] || '').trim(),
            codigo: String(r[1] || '').trim(),
            numeroCE: String(r[13] || '').trim(),
            expedienteCE: String(r[14] || '').trim(),
            tituloCompleto: String(r[15] || '').trim()
          };
        });
      }
    } catch (eSheet) {
      Logger.log('Aba Projetos nao carregada para nome de transporte: ' + eSheet.message);
    }
  }
  for (var i = 0; i < rows.length; i++) {
    var nome = rows[i].nomeAbreviado;
    var codigo = rows[i].codigo;
    var display = nome ? (codigo ? nome + ' (' + codigo + ')' : nome) : codigo;
    var reverseDisplay = nome && codigo ? codigo + ' (' + nome + ')' : '';
    var aliases = [nome, codigo, display, reverseDisplay].filter(Boolean).map(transporteParticipantKey_);
    if (aliases.indexOf(alvo) >= 0) {
      return {
        nomeAbreviado: nome,
        codigo: codigo,
        display: display || projeto,
        numeroCE: rows[i].numeroCE || '',
        expedienteCE: rows[i].expedienteCE || '',
        tituloCompleto: rows[i].tituloCompleto || ''
      };
    }
  }
  var paren = projeto.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (paren) {
    var a = paren[1].trim();
    var b = paren[2].trim();
    var codeLikeA = /[0-9]/.test(a) && /[-/]/.test(a);
    var nomeParen = codeLikeA ? b : a;
    var codigoParen = codeLikeA ? a : b;
    return {
      nomeAbreviado: nomeParen,
      codigo: codigoParen,
      display: nomeParen + (codigoParen ? ' (' + codigoParen + ')' : '')
    };
  }
  return null;
}

function transporteProjetoDisplay_(projeto) {
  var info = transporteProjetoInfo_(projeto);
  return info && info.display ? info.display : String(projeto || '').trim();
}

function transporteProjetoAliases_(projeto) {
  projeto = String(projeto || '').trim();
  var aliases = [];
  function add(v) {
    v = String(v || '').trim();
    if (v && aliases.indexOf(v) < 0) aliases.push(v);
  }
  add(projeto);
  var info = transporteProjetoInfo_(projeto);
  if (info) {
    add(info.nomeAbreviado);
    add(info.codigo);
    add(info.display);
    if (info.nomeAbreviado && info.codigo) add(info.codigo + ' (' + info.nomeAbreviado + ')');
  }
  var paren = projeto.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (paren) {
    add(paren[1]);
    add(paren[2]);
  }
  return aliases;
}

function transporteParticipanteIdEstavel_(participante) {
  participante = participante || {};
  return String(participante.idParticipante || participante.numId || participante.id || '').trim();
}

function transporteParticipanteCadastroId_(participante) {
  participante = participante || {};
  return String(participante.participanteCadastroId || participante.idCadastro || participante.id || '').trim();
}

function transporteReadParticipantesDireto_() {
  if (typeof getCodexSheetDataByName_ === 'function') {
    var rows = getCodexSheetDataByName_('Participantes') || [];
    return rows.slice(1).filter(function(r) {
      return r[0] !== '' && r[0] !== undefined && r[0] !== null;
    }).map(function(r) {
      return {
        id: String(r[0] || '').trim(),
        nome: String(r[1] || '').trim(),
        idParticipante: String(r[4] || '').trim(),
        projeto: String(r[5] || '').trim(),
        braco: String(r[6] || '').trim(),
        status: String(r[8] || '').trim()
      };
    });
  }
  return typeof getParticipantes === 'function' ? (getParticipantes() || []) : [];
}

function transporteNomeDivergeUmCaractere_(a, b) {
  a = transporteParticipantKey_(a);
  b = transporteParticipantKey_(b);
  if (!a || !b || a === b || Math.abs(a.length - b.length) > 1) return false;
  var i = 0;
  var j = 0;
  var diferencas = 0;
  while (i < a.length && j < b.length) {
    if (a.charAt(i) === b.charAt(j)) {
      i++;
      j++;
      continue;
    }
    diferencas++;
    if (diferencas > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < a.length || j < b.length) diferencas++;
  return diferencas === 1;
}

function transporteProjetosCorrespondem_(a, b) {
  function aliasesLocais(value) {
    value = String(value || '').trim();
    var aliases = [];
    function add(item) {
      item = transporteParticipantKey_(item);
      if (item && aliases.indexOf(item) < 0) aliases.push(item);
    }
    add(value);
    var paren = value.match(/^(.*?)\s*\((.*?)\)\s*$/);
    if (paren) {
      add(paren[1]);
      add(paren[2]);
    }
    return aliases;
  }
  var aliasesA = aliasesLocais(a);
  var aliasesB = aliasesLocais(b);
  return aliasesA.some(function(alias) { return alias && aliasesB.indexOf(alias) >= 0; });
}

function transporteEncontrarParticipante_(participantes, referencia) {
  participantes = participantes || [];
  referencia = referencia || {};
  var nome = String(referencia.paciente || referencia.participante || referencia.nome || '').trim();
  var nomeKey = transporteParticipantKey_(nome);
  var projetoReferencia = String(referencia.protocolo || referencia.projeto || '').trim();
  var cadastroId = String(referencia.participanteCadastroId || referencia.idCadastro || '').trim();
  var idEstavel = String(
    referencia.identificacaoParticipante || referencia.idParticipante || referencia.numId || ''
  ).trim();
  if (cadastroId) {
    var candidatosCadastro = participantes.filter(function(participante) {
      return transporteParticipanteCadastroId_(participante) === cadastroId;
    });
    return candidatosCadastro.length === 1 ? candidatosCadastro[0] : null;
  }
  if (idEstavel) {
    var idKey = transporteParticipantKey_(idEstavel);
    var candidatosId = [];
    for (var i = 0; i < participantes.length; i++) {
      if (transporteParticipantKey_(transporteParticipanteIdEstavel_(participantes[i])) === idKey) {
        candidatosId.push(participantes[i]);
      }
    }
    if (projetoReferencia) {
      candidatosId = candidatosId.filter(function(candidato) {
        return transporteProjetosCorrespondem_(candidato && candidato.projeto, projetoReferencia);
      });
    }
    if (candidatosId.length === 1) return candidatosId[0];
    if (nomeKey && candidatosId.length > 1) {
      var candidatosNome = candidatosId.filter(function(candidato) {
        return transporteParticipantKey_(candidato && (candidato.nome || candidato.participante)) === nomeKey;
      });
      if (candidatosNome.length === 1) return candidatosNome[0];
    }
    return null;
  }

  if (!nome) return null;
  var exato = null;
  for (var j = 0; j < participantes.length; j++) {
    var participanteExato = participantes[j] || {};
    if (transporteParticipantKey_(participanteExato.nome || participanteExato.participante) !== nomeKey) continue;
    if (projetoReferencia && !transporteProjetosCorrespondem_(participanteExato.projeto, projetoReferencia)) continue;
    if (exato) return null;
    exato = participanteExato;
  }
  if (exato) return exato;
  if (!projetoReferencia) return null;
  var aproximado = null;
  for (var k = 0; k < participantes.length; k++) {
    var candidato = participantes[k] || {};
    if (!transporteProjetosCorrespondem_(candidato.projeto, projetoReferencia)) continue;
    if (!transporteNomeDivergeUmCaractere_(candidato.nome || candidato.participante, nome)) continue;
    if (aproximado) return null;
    aproximado = candidato;
  }
  return aproximado;
}

function transporteDestinoAgenda_(evento, slot) {
  evento = evento || {};
  var slotKey = String(slot || '').trim().toLowerCase();
  var slotMap = {
    '1': 'courier1',
    i: 'courier1',
    'transporte i': 'courier1',
    '2': 'courier2',
    ii: 'courier2',
    'transporte ii': 'courier2',
    '3': 'courier3',
    iii: 'courier3',
    'transporte iii': 'courier3',
    backup: 'backup',
    b: 'backup'
  };
  var courierKey = slotMap[slotKey];
  if (!courierKey) return '';
  var courier = evento[courierKey] || {};
  return String(courier.destino || courier.laboratorioDestino || '').trim();
}

function transporteAtualizarRegistroPorAgenda_(registro, eventoPrecarregado, options) {
  registro = registro || {};
  options = options || {};
  var idAgenda = String(registro.idAgenda || '').trim();
  if (!idAgenda) return registro;
  try {
    var evento = eventoPrecarregado || buscarAgendaEventoPorIdTransp_(idAgenda) || {};
    var referencia = {
      participanteCadastroId: evento.participantCadastroId || evento.participanteCadastroId || '',
      identificacaoParticipante: evento.idParticipante || registro.identificacaoParticipante || registro.idParticipante || '',
      paciente: evento.participante || registro.paciente || registro.participante || '',
      protocolo: evento.projeto || registro.protocolo || registro.projeto || ''
    };
    var participantes = options.participantes || transporteReadParticipantesDireto_();
    var participante = transporteEncontrarParticipante_(participantes, referencia);
    if (options.obrigatorio && !participante) {
      throw new Error('Participante vinculado à Agenda não encontrado de forma inequívoca no cadastro. Reabra o Transporte pela Agenda.');
    }
    var projeto = String(evento.projeto || (participante && participante.projeto) || registro.protocolo || '').trim();
    var investigador = String(
      transporteInvestigadorPorProjeto_(projeto) ||
      evento.medico ||
      (participante && (participante.investigador || participante.medico)) ||
      registro.investigador || ''
    ).trim();
    var destinoAgenda = transporteDestinoAgenda_(evento, registro.agendaSlot || registro.slot);

    registro.protocolo = transporteProjetoDisplay_(projeto) || registro.protocolo || '';
    registro.investigador = investigador || registro.investigador || '';
    if (destinoAgenda) registro.destino = destinoAgenda;
    registro.identificacaoParticipante = String(
      evento.idParticipante ||
      (participante && transporteParticipanteIdEstavel_(participante)) ||
      registro.identificacaoParticipante ||
      registro.idParticipante || ''
    ).trim();
    registro.paciente = String(
      (participante && participante.nome) ||
      evento.participante ||
      registro.paciente ||
      registro.participante || ''
    ).trim();
    registro.participanteCadastroId = (participante && transporteParticipanteCadastroId_(participante)) || referencia.participanteCadastroId || registro.participanteCadastroId || '';
  } catch (e) {
    if (options.obrigatorio) throw e;
    Logger.log('Dados vinculados da Agenda nao atualizados no Transporte: ' + e.message);
  }
  return registro;
}

function transporteDerivarDadosParticipante_(payload, options) {
  payload = payload || {};
  options = options || {};
  var nome = String(payload.paciente || payload.participante || '').trim();
  var idEstavel = String(payload.identificacaoParticipante || payload.idParticipante || payload.numId || '').trim();
  if (!nome && !idEstavel && !payload.participanteCadastroId && !options.obrigatorio) return payload;
  try {
    var participantes = options.participantes || transporteReadParticipantesDireto_();
    var participante = transporteEncontrarParticipante_(participantes, payload);
    if (!participante) {
      if (options.obrigatorio) throw new Error('Participante não encontrado de forma inequívoca no cadastro. Reabra o Transporte e selecione a participação correta.');
      return payload;
    }
    if (options.obrigatorio && !String(participante.idParticipante || participante.numId || '').trim()) {
      throw new Error('Numero de Identificacao ausente na coluna E da aba Participantes. Atualize o cadastro antes de gerar documentos.');
    }
    var projeto = String(participante.projeto || '').trim();
    var investigador = String(transporteInvestigadorPorProjeto_(projeto) || participante.investigador || payload.investigador || '').trim();
    payload.protocolo = projeto || payload.protocolo || '';
    payload.investigador = investigador || payload.investigador || '';
    payload.identificacaoParticipante = String(participante.idParticipante || participante.numId || payload.identificacaoParticipante || '').trim();
    payload.participanteCadastroId = transporteParticipanteCadastroId_(participante) || payload.participanteCadastroId || '';
    payload.paciente = String(participante.nome || participante.participante || payload.paciente || payload.participante || '').trim();
  } catch (e) {
    if (options.obrigatorio) throw e;
    Logger.log('Dados do participante nao derivados no Transporte: ' + e.message);
  }
  return payload;
}

function transporteAgendadoresConfig_() {
  if (typeof getConfigAppValuesByKeys_ !== 'function') return [];
  return getConfigAppValuesByKeys_(
    ['Transporte', 'Agenda'],
    ['Agendado por', 'Responsavel pelo agendamento', 'Respons\u00e1vel pelo agendamento'],
    []
  );
}

function transporteAgendadorPadrao_() {
  var agendadores = transporteAgendadoresConfig_();
  if (!agendadores.length) return '';
  var email = transporteNormalizeEmail_(transporteActiveUserEmail_());
  var nomes = [];
  if (email) nomes.push(email);
  try {
    if (email && typeof codexGetAllowedUsers_ === 'function') {
      var user = (codexGetAllowedUsers_() || {})[email] || {};
      if (user.name) nomes.push(user.name);
      if (user.firstName) nomes.push(user.firstName);
    }
  } catch (e) {}
  var keys = nomes.map(transporteNorm_).filter(Boolean);
  for (var i = 0; i < agendadores.length; i++) {
    var option = String(agendadores[i] || '').trim();
    var optKey = transporteNorm_(option);
    var optEmail = transporteNormalizeEmail_(option);
    for (var j = 0; j < keys.length; j++) {
      if (optKey === keys[j] || optEmail === keys[j] || (keys[j].length >= 3 && optKey.indexOf(keys[j]) >= 0)) {
        return option;
      }
    }
  }
  return '';
}

function transporteOptionsCache_() {
  try {
    return CacheService.getDocumentCache() || CacheService.getScriptCache();
  } catch (e) {
    return null;
  }
}

function transporteReadCachedJson_(key) {
  try {
    var cache = transporteOptionsCache_();
    var raw = cache ? cache.get(key) : '';
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function transporteWriteCachedJson_(key, value, seconds) {
  try {
    var cache = transporteOptionsCache_();
    if (!cache) return;
    var raw = JSON.stringify(value);
    var ttl = seconds || 300;
    if (raw.length < 95000) {
      cache.put(key, raw, ttl);
      if (typeof codexCacheMetaKey_ === 'function') {
        var now = new Date();
        var expires = new Date(now.getTime() + ttl * 1000);
        PropertiesService.getScriptProperties().setProperty(codexCacheMetaKey_(key), JSON.stringify({
          key: key,
          createdAt: Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
          createdAtMs: now.getTime(),
          expiresAt: Utilities.formatDate(expires, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
          expiresAtMs: expires.getTime(),
          ttlSeconds: ttl
        }));
      }
    }
  } catch (e) {
    Logger.log('Cache do Transporte ignorado para ' + key + ': ' + e.message);
  }
}

function transporteReadParticipantesOptions_() {
  var participantes;
  var investigadoresPorProjeto = transporteProjetoInvestigadorMap_();
  try {
      participantes = transporteReadParticipantesDireto_().map(function(p) {
        var projeto = String(p.projeto || '').trim();
        return {
          participanteCadastroId: transporteParticipanteCadastroId_(p),
          nome: String(p.nome || p.participante || '').trim(),
          idParticipante: String(p.idParticipante || p.numId || '').trim(),
          projeto: projeto,
          investigador: String(transporteInvestigadorPorProjeto_(projeto, investigadoresPorProjeto) || p.investigador || p.medico || '').trim(),
          status: String(p.status || '').trim()
        };
      }).filter(function(p) { return p.nome; });
  } catch (ePart) {
    Logger.log('Participantes nao carregados no Transporte: ' + ePart.message);
    return [];
  }
  return participantes;
}

function getTransporteParticipantesOptions() {
  return transporteReadParticipantesOptions_();
}

function transporteReadProjetosOptions_() {
  var projetos = [];
  try {
    projetos = transporteReadProjetosDireto_().filter(function(p) { return p.nomeAbreviado || p.codigo; });
  } catch (eProjetos) {
    Logger.log('Projetos nao carregados nas opcoes do Transporte: ' + eProjetos.message);
  }
  return projetos;
}

function transporteReadOptions_(opts) {
  opts = opts || {};
  var includeParticipants = opts.includeParticipants === true;
  var cached = transporteReadCachedJson_('TRANSPORTE_OPTIONS_BASE_V6');
  if (cached) {
    cached.couriers = transporteSortCouriers_(cached.couriers || []);
    cached.participantes = includeParticipants ? transporteReadParticipantesOptions_() : [];
    cached.projetos = cached.projetos || transporteReadProjetosOptions_();
    return cached;
  }
  var out = {
    protocolos: [],
    projetos: [],
    destinos: [],
    investigadores: [],
    participantes: [],
    agendadores: [],
    janelasEnvio: [],
    responsaveisEntrega: [],
    couriers: ['MARKEN', 'OCASA', 'DHL', 'PINEX', 'PINEX (Agendamento)'],
    temperaturas: ['AMBIENTE', 'REFRIGERADO', 'CONGELADO', 'AMBIENTE + CONGELADO']
  };
  out.projetos = transporteReadProjetosOptions_();

  if (typeof ensureConfigAppDefaultsCached_ === 'function') {
    ensureConfigAppDefaultsCached_();
  }
  if (typeof getAgendaCouriers_ === 'function') {
    try {
      var agendaCouriers = getAgendaCouriers_();
      if (agendaCouriers && agendaCouriers.length) {
        out.couriers = agendaCouriers.map(function(c) {
          return transporteNormalizeCourierFromCodex_(c);
        });
      }
    } catch (eCouriers) {
      Logger.log('Couriers da Agenda nao carregadas no Transporte: ' + eCouriers.message);
    }
  }
  if (typeof getConfigAppValuesByKeys_ === 'function') {
    out.agendadores = transporteAgendadoresConfig_();
    out.janelasEnvio = getConfigAppValuesByKeys_(
      ['Transporte', 'Agenda'],
      ['Janela de envio', 'Horario de coleta', 'Hor\u00e1rio de coleta'],
      ['13:00 - 15:00']
    );
    out.responsaveisEntrega = getConfigAppValuesByKeys_(
      ['Transporte', 'Agenda'],
      ['Responsavel pela Entrega das Amostras', 'ResponsÃ¡vel pela Entrega das Amostras', 'Responsavel entrega amostras', 'ResponsÃ¡vel entrega amostras'],
      []
    );
    if (!out.responsaveisEntrega.length) out.responsaveisEntrega = out.agendadores.slice();
  }
  if (typeof getLabCentral === 'function') {
    try {
      var labsCentrais = getLabCentral() || [];
      if (labsCentrais.length) {
        out.destinos = labsCentrais.map(function(lab) {
          return {
            nome: lab.nomeAbreviado || lab.nomeCompleto || '',
            completo: lab.nomeCompleto || lab.nomeAbreviado || '',
            endereco: lab.endereco || '',
            cidade: transporteLabCentralCidadePais_(lab),
            cep: lab.cep || '',
            pais: lab.pais || '',
            cdcPermit: lab.cdcPermit || '',
            telefone: lab.telefone || '',
            contato: lab.contato || ''
          };
        }).filter(function(lab) { return lab.nome; }).sort(function(a, b) {
          return String(a.nome).localeCompare(String(b.nome));
        });
      }
    } catch (eLabs) {
      Logger.log('LabCentral nao carregado no Transporte: ' + eLabs.message);
    }
  }

    out.couriers = transporteSortCouriers_(out.couriers);
  transporteWriteCachedJson_('TRANSPORTE_OPTIONS_BASE_V6', out, 300);
  out.participantes = includeParticipants ? transporteReadParticipantesOptions_() : [];
  return out;
}

function transporteMaterialPersistido_(item) {
  item = item || {};
  var formula = String(item.formula || '');
  var parsed = transporteParseFormula_(formula);
  return {
    ativo: item.ativo === true,
    tubos: item.tubos !== undefined && item.tubos !== null && item.tubos !== '' ? item.tubos : (parsed.segmentos.length ? parsed.tubos : ''),
    formula: formula,
    total: item.total !== undefined && item.total !== null && item.total !== '' ? item.total : (parsed.segmentos.length ? parsed.total : '')
  };
}

function transporteOutrosMateriaisTexto_(materiais) {
  return (materiais || []).slice(8).filter(function(item) { return item && item.ativo === true; }).map(function(item) {
    return [item.material, item.ensaio, item.formula].filter(Boolean).join(' - ');
  }).join('; ');
}

function transporteMateriaisNote_(oldNote, payload, peticao) {
  // Metadados preservam o editor completo sem alterar o layout dos documentos.
  // O texto visivel e os valores das linhas impedem usar dados antigos apos edicao manual.
  var marker = /\n?\[CODEX_TRANSPORTE_MATERIAIS_V1\]\n[^\n]*\n\[\/CODEX_TRANSPORTE_MATERIAIS_V1\]/g;
  var original = String(oldNote || '').replace(marker, '');
  var materiais = payload.materiais || [];
  var seq = 0;
  var snapshots = materiais.slice(0, 8).map(function(item) {
    var snapshot = transporteMaterialPersistido_(item);
    snapshot.compareEnsaio = !!peticao && snapshot.ativo && seq < 6;
    if (snapshot.ativo) seq++;
    snapshot.ensaio = String(item.ensaio || item.exame || item.nomeExame || '').trim();
    return snapshot;
  });
  var meta = { courier: String(payload.courier || ''), outrosTexto: transporteOutrosMateriaisTexto_(materiais), materiais: materiais, snapshots: snapshots };
  var note = original + (original ? '\n' : '') + '[CODEX_TRANSPORTE_MATERIAIS_V1]\n' + JSON.stringify(meta) + '\n[/CODEX_TRANSPORTE_MATERIAIS_V1]';
  if (note.length > 45000) throw new Error('Materiais de Transporte excedem o limite de armazenamento. Reduza as descrições.');
  return note;
}

function transporteRestaurarMateriaisNote_(materiais, note, courier, outrosTexto) {
  var match = String(note || '').match(/\[CODEX_TRANSPORTE_MATERIAIS_V1\]\n([^\n]*)\n\[\/CODEX_TRANSPORTE_MATERIAIS_V1\]/);
  if (!match) return materiais;
  var meta;
  try { meta = JSON.parse(match[1]); } catch (e) { return materiais; }
  if (!meta || meta.courier !== String(courier || '') || !Array.isArray(meta.materiais) || !Array.isArray(meta.snapshots)) return materiais;
  materiais.slice(0, 8).forEach(function(item, index) {
    var snapshot = meta.snapshots[index], stored = meta.materiais[index];
    if (!snapshot || !stored || String(item.material) !== String(stored.material)) return;
    if ((!snapshot.compareEnsaio || String(item.ensaio || '') === snapshot.ensaio)
        && ['ativo', 'tubos', 'formula', 'total'].every(function(key) { return String(item[key]) === String(snapshot[key]); })) {
      item.ensaio = String(stored.ensaio || stored.exame || stored.nomeExame || '');
      item.unit = stored.unit;
    }
  });
  if (meta.outrosTexto === outrosTexto) {
    materiais = materiais.slice(0, 8).concat(meta.materiais.slice(8).filter(function(item) { return item && item.ativo === true; }));
  }
  return materiais;
}

function transporteReadRegistro_() {
  var ss = getTransporteSpreadsheetCodex_();
  var folha = transporteGetSheet_(ss, 'folhaAgendamento', true);
  var declaracao = transporteGetSheet_(ss, 'declaracaoTransp', false);
  var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
  var folhaDhl = transporteGetSheet_(ss, 'folhaDhlPinex', false);
  var formularioPinex = transporteGetSheet_(ss, 'formularioPinex', false);

  var cfg = folha.getRange('C3:C15').getValues().map(function(r) { return r[0]; });
  var agendaLink = transporteAgendaLinkFromRef_(cfg[12], folha.getRange('C15').getNote());
  var dhl = folhaDhl ? folhaDhl.getRange('C12:C14').getValues().map(function(r) { return r[0]; }) : ['', '', ''];
  var materiais = [];

  if (declaracao) {
    var rows = declaracao.getRange('B21:N28').getValues();
    rows.forEach(function(r, idx) {
      materiais.push({
        row: idx + 21,
        ativo: r[0] === true,
        material: String(r[1] || TRANSPORTE_MATERIAIS[idx] || '').trim(),
        tubos: r[6] || '',
        formula: r[8] || r[9] || r[10] || '',
        total: r[12] === 0 ? 0 : (r[12] || ''),
        ensaio: ''
      });
    });
    if (peticao) {
      var ensaios = peticao.getRange('P30:P35').getValues().map(function(r) { return String(r[0] || '').trim(); });
      var seq = 0;
      materiais.forEach(function(item) {
        if (!item.ativo || seq >= ensaios.length) return;
        item.ensaio = ensaios[seq] || '';
        seq++;
      });
    }
    var outroMaterial = String(getCellValueSafe(declaracao, 'F30') || '').trim();
    if (outroMaterial) {
      materiais.push({
        row: 30,
        ativo: true,
        material: outroMaterial,
        tubos: '',
        formula: '',
        total: '',
        ensaio: ''
      });
    }
    materiais = transporteRestaurarMateriaisNote_(materiais, declaracao.getRange('F30').getNote(), cfg[7], outroMaterial);
  } else {
    TRANSPORTE_MATERIAIS.forEach(function(m, idx) {
      materiais.push({ row: idx + 21, ativo: false, material: m, tubos: '', formula: '', total: '', ensaio: '' });
    });
  }

  return {
    paciente: cfg[0] || '',
    participanteCadastroId: agendaLink.participanteCadastroId || '',
    identificacaoParticipante: agendaLink.identificacaoParticipante || '',
    protocolo: cfg[1] || '',
    investigador: cfg[2] || '',
    temperatura: cfg[3] || '',
    dataColeta: transporteDateOut_(cfg[4]),
    dataEnvio: transporteDateOut_(cfg[5]),
    horaEnvio: cfg[6] || '',
    courier: cfg[7] || '',
    destino: cfg[8] || '',
    awb: cfg[9] || '',
    agendadoPor: cfg[10] || '',
    observacoes: cfg[11] || '',
    refInterna: cfg[12] || '',
    idAgenda: agendaLink.idAgenda,
    agendaSlot: agendaLink.agendaSlot,
    solicitarCaixa: transporteReadSolicitarCaixa_(ss, cfg[7], cfg[3]),
    responsavelEntrega: formularioPinex ? String(formularioPinex.getRange('D32').getValue() || '').trim() : '',
    pinexAwb: dhl[0] || '',
    pinexColeta: dhl[1] || '',
    pinexAgendadoPor: dhl[2] || '',
    materiais: materiais
  };
}

function transporteValidate_(registro) {
  var issues = [];
  var courier = transporteNormalizeCourierFromCodex_(registro.courier);
  var awb = String(registro.awb || '').trim();

  if (!registro.agendadoPor) issues.push({ type: 'danger', text: 'ResponsÃƒÂ¡vel pelo agendamento nÃƒÂ£o informado.' });
  if (!registro.protocolo) issues.push({ type: 'danger', text: 'Protocolo nÃƒÂ£o informado.' });
  if (!registro.destino) issues.push({ type: 'warn', text: 'Destino/laboratÃƒÂ³rio ainda nÃƒÂ£o selecionado.' });
  if (!registro.horaEnvio) issues.push({ type: 'danger', text: 'Janela de envio nao informada.' });
  var awbCheck = codexCourierNormalizeAwb_(awb, courier);
  if (awbCheck && !codexCourierIsValidAwb_(awbCheck, courier)) {
    issues.push({ type: 'warn', text: codexCourierAwbValidationMessage_(courier) });
  }
  if (courier === 'PINEX' && !String(registro.pinexColeta || '').match(/^\d{6}$/)) {
    issues.push({ type: 'warn', text: 'PINEX COL. NÂ° deve conter 6 digitos para envio PINEX.' });
  }
  if (!registro.materiais.some(function(m) { return m.ativo; })) {
    issues.push({ type: 'warn', text: 'Nenhum material biolÃƒÂ³gico marcado na declaraÃƒÂ§ÃƒÂ£o.' });
  }
  return issues;
}

function transporteNormalizeOcasaAwb_(awb) {
  return codexCourierNormalizeAwb_(awb, 'OCASA');
}

function transporteIsValidOcasaAwb_(awb) {
  return codexCourierIsValidOcasaAwb_(awb);
}

function transporteBuildBootstrap_(eventoPrecarregado) {
  return transporteMeasurePerformance_('getTransporteBootstrap', 'total', { rowCount: 1 }, function() {
    var registro = transporteMeasurePerformance_('getTransporteBootstrap', 'record', { rowCount: 1 }, function() {
      return transporteReadRegistro_();
    });
    registro = transporteMeasurePerformance_('getTransporteBootstrap', 'agenda_update', { rowCount: eventoPrecarregado ? 0 : 1 }, function() {
      return transporteAtualizarRegistroPorAgenda_(registro, eventoPrecarregado);
    });
    var options = transporteMeasurePerformance_('getTransporteBootstrap', 'options', { rowCount: 0 }, function() {
      return transporteReadOptions_({ includeParticipants: false });
    });
    var ativos = registro.materiais.filter(function(m) { return m.ativo; });
    var totalTubos = ativos.reduce(function(sum, m) { return sum + (Number(m.tubos) || 0); }, 0);
    var totalVolume = ativos.reduce(function(sum, m) { return sum + (Number(m.total) || 0); }, 0);

    return transporteMeasurePerformance_('getTransporteBootstrap', 'validate', { rowCount: 1 }, function() {
      return {
        access: typeof codexGetCurrentUserAccess === 'function' ? codexGetCurrentUserAccess() : null,
        runtime: transporteExecutionContext_(),
        registro: registro,
        options: options,
        auth: typeof codexGetUserOAuthStatus_ === 'function' ? codexGetUserOAuthStatus_() : transporteGmailOAuthStatus_(),
        issues: transporteValidate_(registro),
        resumo: {
          materiaisAtivos: ativos.length,
          totalTubos: totalTubos,
          totalVolume: totalVolume,
          documentos: transporteDocumentosPorCourier_(registro.courier, registro.temperatura, registro.destino)
        }
      };
    });
  });
}

function getTransporteBootstrap() {
  return codexWithDocumentLock_('getTransporteBootstrap', function() {
    return transporteBuildBootstrap_();
  });
}

function getTransporteBootstrapFromAgenda(idAgenda, slot) {
  if (typeof codexAssertCanWrite_ === 'function') codexAssertCanWrite_('getTransporteBootstrapFromAgenda', 'Transporte', idAgenda);
  idAgenda = String(idAgenda || '').trim();
  if (!idAgenda) throw new Error('Agendamento nao informado para preparar o transporte.');
  return codexWithDocumentLock_('getTransporteBootstrapFromAgenda', function() {
    return transporteMeasurePerformance_('getTransporteBootstrapFromAgenda', 'total', { rowCount: 1 }, function() {
      var contexto = transporteMeasurePerformance_('getTransporteBootstrapFromAgenda', 'payload', { rowCount: 1 }, function() {
        return montarContextoTransporteParaTransp_(idAgenda, slot);
      });
      var payload = contexto.payload;
      codexCourierAssertDocumentAwb_(payload.courier.awb, payload.courier.nome);
      var importResult = transporteMeasurePerformance_('getTransporteBootstrapFromAgenda', 'import_prepare', { rowCount: 1 }, function() {
        return importarTransporteCodexInterno_(payload, contexto);
      });
      // A planilha de Transporte e compartilhada. A releitura precisa ocorrer
      // no mesmo lock da importacao para nao combinar materiais de um slot com
      // ensaios que outra aba gravou logo depois.
      SpreadsheetApp.flush();
      var data = transporteMeasurePerformance_('getTransporteBootstrapFromAgenda', 'bootstrap', { rowCount: 1 }, function() {
        return transporteBuildBootstrap_(contexto.evento);
      });
      data.registro = Object.assign({}, data.registro || {}, {
        idAgenda: payload.idAgenda || idAgenda,
        agendaSlot: normalizarSlotTransporteCodex_(payload.slot || slot || ''),
        refInterna: payload.refInterna || transporteAgendaRefInterna_(idAgenda)
      });
      data.importResult = importResult;
      return data;
    });
  });
}

function transporteDocumentosPorCourier_(courier, temperatura, destino) {
  var c = String(courier || '');
  if (c === 'OCASA' && transporteOcasaNeedsProforma_(destino)) return ['Folha de Agendamento', 'DeclaraÃ§Ã£o de Transporte', 'PetiÃ§Ã£o ANVISA', 'Proforma OCASA', 'Ficha de EmergÃªncia OCASA', 'Telefones Ãšteis OCASA'];
  if (c === 'OCASA') return ['Folha de Agendamento', 'DeclaraÃ§Ã£o de Transporte', 'PetiÃ§Ã£o ANVISA', 'Ficha de EmergÃªncia OCASA', 'Telefones Ãšteis OCASA'];
  if (c === 'MARKEN') return ['Folha de Agendamento', 'DeclaraÃ§Ã£o de Transporte', 'PetiÃ§Ã£o ANVISA', 'Invoice MARKEN', 'Ficha de EmergÃªncia MARKEN'];
  if (c === 'PINEX (Agendamento)') return ['FormulÃƒÂ¡rio PINEX'];
  if (c === 'PINEX') return ['Folha DHL/PINEX', 'Commercial Invoice PINEX', 'PetiÃƒÂ§ÃƒÂ£o PINEX', 'USDA Statement', 'Ficha de EmergÃƒÂªncia PINEX', 'DeclaraÃƒÂ§ÃƒÂ£o de Transporte'];
  if (transporteIsDhl_(c)) return ['Folha DHL/PINEX', 'DeclaraÃƒÂ§ÃƒÂ£o DHL', 'Invoice DHL', 'DeclaraÃƒÂ§ÃƒÂ£o de Transporte DHL'];
  return ['Folha de Agendamento', 'DeclaraÃƒÂ§ÃƒÂ£o de Transporte'];
}

function salvarTransporte(payload, options) {
  if (typeof codexAssertCanWrite_ === 'function') codexAssertCanWrite_('salvarTransporte', 'Transporte', payload && (payload.idAgenda || payload.id || payload.paciente));
  return codexWithDocumentLock_('salvarTransporte', function() {
    return transporteMeasurePerformance_('salvarTransporte', 'total', { rowCount: 1 }, function() {
      return salvarTransporteInterno_(payload, options);
    });
  });
}

function salvarTransporteInterno_(payload, options) {
  var ss;
  var folha;
  var declaracao;
  var folhaDhl;
  var peticao;
  var materiaisNote;
  transporteMeasurePerformance_('salvarTransporte', 'read_prepare', { rowCount: 1 }, function() {
    ss = getTransporteSpreadsheetCodex_();
    folha = transporteGetSheet_(ss, 'folhaAgendamento', true);
    declaracao = transporteGetSheet_(ss, 'declaracaoTransp', true);
    folhaDhl = transporteGetSheet_(ss, 'folhaDhlPinex', false);
    peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
    payload = payload || {};
    options = options || {};
    transportePreservarVinculoAgendaPayload_(payload, folha.getRange('C15'));
    var participanteOptions = { obrigatorio: !options.rascunho, participantes: [] };
    try {
      participanteOptions.participantes = transporteReadParticipantesDireto_();
    } catch (participanteReadError) {
      if (participanteOptions.obrigatorio) throw participanteReadError;
      Logger.log('Cadastro indisponivel durante pre-preenchimento do Transporte: ' + participanteReadError.message);
    }
    payload = transporteAtualizarRegistroPorAgenda_(payload, options.agendaEvento, participanteOptions);
    payload = transporteDerivarDadosParticipante_(payload, participanteOptions);
    if (payload.idAgenda && String(payload.agendaSlot || payload.slot || '').trim()) {
      normalizarSlotTransporteCodex_(payload.agendaSlot || payload.slot, true);
    }
    if (!options.rascunho) transporteValidarObrigatoriosWebApp_(payload);
    codexMatBioValidateTransportPayload_(payload);
    materiaisNote = transporteMateriaisNote_(declaracao.getRange('F30').getNote(), payload, peticao);
    payload.protocolo = transporteProjetoDisplay_(payload.protocolo || '');
  });

  transporteMeasurePerformance_('salvarTransporte', 'write_fields', { rowCount: 1 }, function() {
    transporteSetValuesBlock_(folha.getRange('C3:C14'), [
      payload.paciente || '', payload.protocolo || '',
      payload.investigador || '', payload.temperatura || '',
      transporteParseDate_(payload.dataColeta), transporteParseDate_(payload.dataEnvio),
      payload.horaEnvio || '', payload.courier || '', payload.destino || '',
      payload.awb || '', payload.agendadoPor || '', payload.observacoes || ''
    ].map(function(value) { return [value === null || value === undefined ? '' : value]; }));
  transporteSetAgendaLink_(folha.getRange('C15'), payload);

  if (folhaDhl) {
    transporteSetValuesBlock_(folhaDhl.getRange('C12:C14'), [
      [payload.pinexAwb || payload.awb || ''],
      [payload.courier === 'PINEX' ? (payload.pinexColeta || '') : ''],
      [payload.pinexAgendadoPor || payload.agendadoPor || '']
    ]);
  }

  var materiais = payload.materiais || [];
  var ativos = [];
  var tubos = [];
  var formulas = [];
  var totais = [];
  for (var i = 0; i < 8; i++) {
    var item = materiais[i] || {};
    var persisted = transporteMaterialPersistido_(item);
    ativos.push([persisted.ativo]);
    tubos.push([persisted.tubos]);
    formulas.push([persisted.formula]);
    totais.push([persisted.total]);
  }
  declaracao.getRange('B21:B28').setValues(ativos);
  declaracao.getRange('H21:H28').setValues(tubos);
  formulas.forEach(function(row, idx) {
    // Cada linha possui seu proprio bloco mesclado J:L; preservar a ancora.
    var sheetRow = idx + 21;
    transporteSetTopLeftInBlock_(declaracao, 'J' + sheetRow + ':L' + sheetRow, row[0]);
  });
  transporteAjustarVolumesDeclaracao_(declaracao, false);
  declaracao.getRange('N21:N28').setValues(totais);
  var outrosTexto = transporteOutrosMateriaisTexto_(materiais);
  if (outrosTexto) {
    declaracao.getRange('F30').setValue(transporteTextoLiteralParaCelula_(outrosTexto));
  } else {
    declaracao.getRange('F30').clearContent();
  }
  declaracao.getRange('F30').setNote(materiaisNote);
    transporteSetEnsaiosPeticao_(peticao, materiais);
  });

  // O pre-agendamento vindo da Agenda tambem precisa preparar as abas da
  // courier. "rascunho" apenas impede a escrita de volta na Agenda abaixo;
  // nao deve impedir o preenchimento da documentacao na planilha Transporte.
  transporteMeasurePerformance_('salvarTransporte', 'prepare_documents', { rowCount: 1 }, function() {
    if (options.preencherDocumentos !== false) {
      transporteAplicarAutomacoesTemperatura_(ss, payload);
      aplicarSolicitacaoCaixaTransporte_(ss, payload);
      transporteAplicarCourierConfig_(ss, payload.courier);
      transportePreencherPeticaoMedico_(ss, payload);
      transportePreencherDeclaracaoCadastros_(ss, payload);
      if (payload.courier === 'PINEX') atualizarCommercialInvoicePinexB34_(ss);
      preencherDadosProtocoloPeticaoWebApp_(ss, payload);
      preencherPeticaoAnuenciaWebApp_(ss, payload);
      if (payload.courier !== 'MARKEN') atualizarInvoiceMarkenAmostras_(ss);
      preencherDhlWebApp_(ss, payload);
    }
  });
  transporteMeasurePerformance_('salvarTransporte', 'flush', { rowCount: 1 }, function() {
    SpreadsheetApp.flush();
  });
  var agendaSync = options.rascunho
    ? { atualizado: false, motivo: 'Pré-preenchimento ainda não confirmado' }
    : transporteMeasurePerformance_('salvarTransporte', 'agenda_sync', { rowCount: 1 }, function() {
      return transporteSincronizarAgenda_(payload);
    });
  if (options.returnBootstrap === false) {
    return { ok: true, rascunho: options.rascunho === true, agendaSync: agendaSync };
  }
  return options.rascunho
    ? { rascunho: true, mensagem: 'Transporte pre-preenchido. Complete e salve na tela de Transporte.' }
    : transporteBuildBootstrap_();
}

function transporteSetEnsaiosPeticao_(peticao, materiais) {
  if (!peticao) return;
  var ensaios = [];
  (materiais || []).forEach(function(item) {
    if (!item || item.ativo !== true) return;
    var ensaio = String(item.ensaio || item.exame || item.nomeExame || '').trim();
    if (ensaios.length < 6) ensaios.push([ensaio]);
  });
  while (ensaios.length < 6) ensaios.push(['']);
  peticao.getRange('P30:P35').setValues(ensaios.map(function(row) { return [transporteTextoLiteralParaCelula_(row[0])]; }));
}

function transporteDefaultSolicitarCaixa_(courier) {
  courier = transporteNormalizeCourierFromCodex_(courier);
  if (courier === 'MARKEN') return 'N\u00e3o';
  if (courier === 'PINEX (Agendamento)' || transporteIsDhl_(courier)) return 'Sim';
  return '';
}

function transporteNormalizeSimNao_(value, fallback) {
  var raw = String(value || '').trim();
  if (!raw) raw = fallback || '';
  var n = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return n === 'sim' || n === 's' || n === 'yes' ? 'Sim' : (n === 'nao' || n === 'n' || n === 'no' ? 'N\u00e3o' : transporteCodexFixMojibakeText_(raw));
}

function transporteInvertSimNao_(value) {
  return transporteNormalizeSimNao_(value, 'N\u00e3o') === 'Sim' ? 'N\u00e3o' : 'Sim';
}

function transporteReadSolicitarCaixa_(ss, courier, temperatura) {
  courier = transporteNormalizeCourierFromCodex_(courier);
  var fallback = transporteDefaultSolicitarCaixa_(courier);
  if (courier === 'MARKEN') {
    var email = transporteGetSheet_(ss, 'emailMarken', false);
    return email ? transporteNormalizeSimNao_(email.getRange('B8').getValue(), fallback) : fallback;
  }
  if (courier === 'PINEX (Agendamento)') {
    var form = transporteGetSheet_(ss, 'formularioPinex', false);
    if (!form) return fallback;
    var temp = transporteNormalizeTemperaturaFromCodex_(temperatura);
    var cell = temp === 'AMBIENTE' ? 'D35' : 'D34';
    var stored = transporteNormalizeSimNao_(form.getRange(cell).getValue(), '');
    return stored ? transporteInvertSimNao_(stored) : fallback;
  }
  return fallback;
}

function aplicarSolicitacaoCaixaTransporte_(ss, payload) {
  payload = payload || {};
  var courier = transporteNormalizeCourierFromCodex_(payload.courier);
  var temperatura = transporteNormalizeTemperaturaFromCodex_(payload.temperatura);
  var resposta = transporteNormalizeSimNao_(payload.solicitarCaixa, transporteDefaultSolicitarCaixa_(courier));

  if (courier === 'MARKEN') {
    var emailMarken = transporteGetSheet_(ss, 'emailMarken', false);
    if (emailMarken) emailMarken.getRange('B8').setValue(resposta);
  }

  if (courier === 'PINEX (Agendamento)') {
    var formulario = transporteGetSheet_(ss, 'formularioPinex', false);
    if (formulario) {
      formulario.getRange('D32').setValue(transporteTextoLiteralParaCelula_(String(payload.responsavelEntrega || '').trim()));
      var inversa = transporteInvertSimNao_(resposta);
      if (temperatura === 'AMBIENTE') {
        formulario.getRange('D35').setValue(inversa);
        formulario.getRange('D34').clearContent();
      } else if (temperatura === 'CONGELADO' || temperatura === 'REFRIGERADO' || temperatura === 'AMBIENTE + CONGELADO' || temperatura === 'AMBIENTE + REFRIGERADO') {
        formulario.getRange('D34').setValue(inversa);
        formulario.getRange('D35').clearContent();
      }
    }
  } else {
    var formularioLimpar = transporteGetSheet_(ss, 'formularioPinex', false);
    if (formularioLimpar) formularioLimpar.getRange('D32').clearContent();
  }
}

function transporteValidarObrigatoriosWebApp_(payload) {
  payload = payload || {};
  var missing = [];
  if (!String(payload.paciente || '').trim()) missing.push('Paciente');
  if (String(payload.paciente || '').trim() && !String(payload.identificacaoParticipante || payload.idParticipante || '').trim()) {
    missing.push('Numero de Identificacao do paciente na coluna E da aba Participantes');
  }
  if (!String(payload.protocolo || '').trim()) missing.push('Protocolo');
  if (!String(payload.investigador || '').trim()) missing.push('Investigador');
  if (!String(payload.destino || '').trim()) missing.push('Laboratorio de destino');
  if (!String(payload.temperatura || '').trim()) missing.push('Temperatura');
  if (!String(payload.courier || '').trim()) missing.push('Courier');
  if (!String(payload.horaEnvio || '').trim()) missing.push('Janela de envio');
  if (!String(payload.agendadoPor || '').trim()) missing.push('Agendado por');
  if (payload.courier === 'PINEX') {
    var investigadorPinex = transporteMedicoByNome_(payload.investigador);
    if (!investigadorPinex || !String(investigadorPinex.cremers || '').trim()) {
      missing.push('CREMERS do Investigador Principal no cadastro de Medicos');
    }
  }
  if (payload.courier === 'PINEX (Agendamento)' && !String(payload.responsavelEntrega || '').trim()) {
    missing.push('Responsavel pela Entrega das Amostras');
  }
  if (codexCourierRequiresAwb_(payload.courier) && !String(payload.awb || '').trim()) {
    missing.push('AWB / codigo');
  }
  if (!String(payload.dataEnvio || '').trim()) missing.push('Data de envio');
  if (missing.length) throw new Error('Preencha os campos obrigatorios: ' + missing.join(', ') + '.');
  codexCourierAssertDocumentAwb_(payload.awb, payload.courier);
  if (String(payload.destino || '').trim() && !transporteLabCentralByDestino_(payload.destino)) {
    throw new Error('Laboratorio de destino nao encontrado no cadastro LabCentral: ' + payload.destino + '.');
  }
}

function transporteValidarDataEnvioMinima_(dataEnvio) {
  var data = transporteParseDate_(dataEnvio);
  if (!(data instanceof Date) || isNaN(data.getTime())) {
    throw new Error('Data de envio invalida.');
  }
  var hoje = new Date();
  data.setHours(0, 0, 0, 0);
  hoje.setHours(0, 0, 0, 0);
  if (data.getTime() < hoje.getTime()) {
    throw new Error('Data de envio deve ser igual ou posterior a data de hoje.');
  }
}

function transporteSetValueIfAllowed_(range, value) {
  var a1 = '';
  try {
    a1 = range.getA1Notation();
    range.clearDataValidations();
  } catch (validationClearError) {
    Logger.log('Validacao da planilha nao removida em ' + (a1 || 'celula') + ': ' + validationClearError.message);
  }
  if (value === null || value === undefined || value === '') {
    range.setValue('');
    return;
  }
  try {
    a1 = range.getA1Notation();
    if (value instanceof Date || a1 === 'C7' || a1 === 'C8' || a1 === 'C9' || a1 === 'C15') {
      range.setValue(value);
      return;
    }
  } catch (e) {
    Logger.log('Gravacao direta do WebApp em ' + (a1 || range.getA1Notation()) + ': ' + e.message);
  }
  try {
    range.setValue(value);
  } catch (setError) {
    if (/valida/i.test(String(setError && setError.message || setError))) {
      Logger.log('Valor ignorado por validacao em ' + range.getA1Notation() + ': ' + value);
      return;
    }
    throw setError;
  }
}

function transporteSetValuesBlock_(range, values) {
  // Mesma remocao de validacoes usada pelo formulario, sem alterar formatos.
  // Falhas de escrita em lote interrompem o fluxo; nao reportar sucesso parcial.
  range.clearDataValidations();
  range.setValues(values.map(function(row) { return row.map(transporteTextoLiteralParaCelula_); }));
}

function preencherDhlWebApp_(ss, payload) {
  payload = payload || {};
  var courier = transporteNormalizeCourierFromCodex_(payload.courier);
  if (!transporteIsDhl_(courier)) return;

  var invoice = transporteGetSheet_(ss, 'invoiceDhl', false);
  var declaracaoDhl = transporteGetSheet_(ss, 'declaracaoTranspDhl', false);
  var temperatura = transporteNormalizeTemperaturaFromCodex_(payload.temperatura);
  var materiais = payload.materiais || [];
  var litros = { sangueSoro: 0, urina: 0, saliva: 0, outros: 0 };
  var tubos = 0;

  materiais.forEach(function(item) {
    if (!item || item.ativo !== true) return;
    var key = transporteMaterialKey_(item.material || item.tipo || item.key);
    var totalLitros = transporteTotalEmLitros_(item);
    tubos += transporteTubosMaterial_(item);
    if (key === 'sangue' || key === 'soro') litros.sangueSoro += totalLitros;
    else if (key === 'urina') litros.urina += totalLitros;
    else if (key === 'saliva') litros.saliva += totalLitros;
    else litros.outros += totalLitros;
  });

  if (invoice) {
    invoice.getRange('P10').setValue(transporteParseDate_(payload.dataEnvio || payload.dataColeta));
    invoice.getRange('J30').setValue(tubos || '');
  }

  if (declaracaoDhl) {
    declaracaoDhl.getRangeList(['F18:F21']).setNumberFormat('0.00000');
    declaracaoDhl.getRangeList(['K28', 'E29', 'K30']).setValue(false);
    declaracaoDhl.getRange('M29').clearContent();
    if (temperatura === 'AMBIENTE') {
      declaracaoDhl.getRange('K30').setValue(true);
      declaracaoDhl.getRange('M29').setValue('---');
    } else if (temperatura === 'REFRIGERADO') {
      declaracaoDhl.getRange('E29').setValue(true);
      declaracaoDhl.getRange('M29').setValue('---');
    } else if (temperatura === 'CONGELADO' || temperatura === 'AMBIENTE + CONGELADO') {
      declaracaoDhl.getRange('K28').setValue(true);
      declaracaoDhl.getRange('M29').setValue('Gelo Seco: 4 kg');
    }
    declaracaoDhl.getRange('F18').setValue(litros.sangueSoro || '');
    declaracaoDhl.getRange('F19').setValue(litros.urina || '');
    declaracaoDhl.getRange('F20').setValue(litros.saliva || '');
    declaracaoDhl.getRange('F21').setValue(litros.outros || '');
  }
}

function transportePeticaoMaterialRows_(materiais) {
  var rows = [];
  var laminasHematologia = '';

  (materiais || []).forEach(function(item) {
    if (!item || item.ativo !== true) return;
    var materialRaw = String(item.material || '').trim();
    var ensaioRaw = String(item.ensaio || item.exame || item.nomeExame || '').trim();
    var formulaRaw = String(item.formula || '').trim();
    var outroTexto = [formulaRaw, ensaioRaw, materialRaw].filter(Boolean).join(' ');
    var materialNorm = transporteNorm_(materialRaw + ' ' + ensaioRaw + ' ' + formulaRaw);
    if (transporteMaterialKey_(materialRaw) === 'outro' &&
        materialNorm.indexOf('lamina') >= 0 &&
        materialNorm.indexOf('hematologia') >= 0) {
      var matchLaminas = outroTexto.match(/(\d+)\s*(?:l[aÃ¢Ã£]mina|lamina|slide)/i);
      laminasHematologia = matchLaminas && matchLaminas[1]
        ? matchLaminas[1] + ' lÃ¢mina' + (Number(matchLaminas[1]) === 1 ? '' : 's')
        : outroTexto;
      return;
    }
    if (rows.length >= 6) return;
    var unit = item.unit || codexMatBioUnit_(transporteMaterialKey_(item.material), 'mL');
    var decimals = unit === 'L' ? 5 : (unit === 'g' ? 2 : 2);
    var total = item.total !== '' && item.total !== null && item.total !== undefined
      ? item.total
      : transporteParseFormula_(item.formula).total;
    var materialTexto = String(item.material || '').trim();
    if (materialTexto && (String(item.formula || '').trim() || transporteNumber_(total) > 0)) {
      materialTexto += ': ' + transporteFormatNumberPt_(total, decimals) + ' ' + unit;
    }
    rows.push([materialTexto, ensaioRaw]);
  });

  if (laminasHematologia) {
    var sangueIdx = -1;
    for (var s = 0; s < rows.length; s++) {
      if (transporteNorm_(rows[s][0]).indexOf('sangue') === 0) {
        sangueIdx = s;
        break;
      }
    }
    if (sangueIdx >= 0) {
      rows[sangueIdx][0] = String(rows[sangueIdx][0] || 'Sangue').trim() + ' + ' + laminasHematologia;
    } else if (rows.length < 6) {
      rows.push([laminasHematologia, 'Hematologia']);
    }
  }

  while (rows.length < 6) rows.push(['', '']);
  return rows;
}

function preencherPeticaoAnuenciaWebApp_(ss, payload) {
  payload = payload || {};
  var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
  if (!peticao) return;

  var temperatura = transporteNormalizeTemperaturaFromCodex_(payload.temperatura);
  peticao.getRangeList(['G28', 'N28', 'K28']).setValue(false);
  if (temperatura === 'AMBIENTE') peticao.getRange('G28').setValue(true);
  if (temperatura === 'CONGELADO' || temperatura === 'AMBIENTE + CONGELADO') peticao.getRange('K28').setValue(true);
  if (temperatura === 'REFRIGERADO') peticao.getRange('N28').setValue(true);

  var iniciais = String(payload.iniciais || '').trim() || extrairIniciais_(payload.paciente || payload.participante);
  var identificacao = String(payload.identificacaoParticipante || payload.idParticipante || payload.numeroIdentificacao || '').trim();
  if (!identificacao && typeof getInfoParticipante === 'function') {
    try {
      var participanteInfo = getInfoParticipante(payload.paciente || payload.participante);
      identificacao = String((participanteInfo && participanteInfo.numId) || '').trim();
    } catch (eInfo) {
      identificacao = '';
    }
  }
  var rows = transportePeticaoMaterialRows_(payload.materiais || []).map(function(row) {
    // O helper completa seis linhas; identificacao pertence apenas a material preenchido.
    var temMaterial = String(row[0] || '').trim() !== '';
    return [temMaterial ? iniciais : '', temMaterial ? identificacao : '', row[0], row[1]];
  });
  peticao.getRange('B30:B35').setValues(rows.map(function(r) { return [r[0]]; }));
  peticao.getRange('G30:G35').setValues(rows.map(function(r) { return [r[1]]; }));
  peticao.getRange('K30:K35').setValues(rows.map(function(r) { return [r[2]]; }));
  peticao.getRange('P30:P35').setValues(rows.map(function(r) { return [r[3]]; }));
}

function preencherDadosProtocoloPeticaoWebApp_(ss, payload) {
  payload = payload || {};
  var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
  if (!peticao) return;

  var protocoloNome = String(payload.protocolo || '').trim();
  var destinoNome = String(payload.destino || '').trim();
  var projetoInfo = transporteProjetoInfo_(protocoloNome);

  if (projetoInfo) {
    peticao.getRange('F38').setValue(projetoInfo.numeroCE || '');
    peticao.getRange('F39').setValue(projetoInfo.expedienteCE || '');
    peticao.getRange('F40').setValue(projetoInfo.display || transporteProjetoDisplay_(protocoloNome));
    peticao.getRange('F41').setValue(projetoInfo.tituloCompleto || '');
  } else if (protocoloNome) {
    peticao.getRange('F40').setValue(transporteProjetoDisplay_(protocoloNome));
  }

  if (destinoNome) {
    var labCentral = transporteLabCentralByDestino_(destinoNome);
    if (labCentral) {
      peticao.getRange('B44').setValue(labCentral.nomeCompleto || labCentral.nomeAbreviado || destinoNome);
      peticao.getRange('B45').setValue(labCentral.endereco || '');
      peticao.getRange('B46').setValue(transporteLabCentralCidadePais_(labCentral));
    } else {
      Logger.log('LabCentral nao encontrado para destino da Peticao: ' + destinoNome);
    }
  }
}

function atualizarInvoiceMarkenAmostras_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var declaracao = transporteGetSheet_(ss, 'declaracaoTransp', false);
    var invoice = transporteGetSheet_(ss, 'invoiceMarken', false);
    if (!declaracao || !invoice) return;

    var checked = declaracao.getRange('B21:B28').getValues();
    var tubos = declaracao.getRange('H21:H28').getValues();
    var f30 = String(getCellValueSafe(declaracao, 'F30') || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var hasSlides = f30.indexOf('lamina') !== -1 && f30.indexOf('hematologia') !== -1;
    var itens = {
      21: { desc: 'Human Blood for Clinical Trials', hts: '3002.90.5210', val: 10, pkg: hasSlides ? 'Tube(s) + Slides' : 'Tube(s)' },
      22: { desc: 'Human Blood Serum for Clinical Trials', hts: '3002.12.0020', val: 10, pkg: 'Tube(s)' },
      23: { desc: 'Human Urine for Clinical Trials', hts: '3002.90.5250', val: 10, pkg: 'Tube(s)' },
      24: { desc: 'Human Blood Plasma for Clinical trials', hts: '3002.12.0010', val: 10, pkg: 'Tube(s)' },
      25: { desc: 'Human Tissue for Clinical Trials', hts: '3002.90.5250', val: 10, pkg: 'Vial(s)' },
      26: { desc: 'Human Saliva / Bucal Swab for Clinical Trials', hts: '0511.99.4070', val: 10, pkg: 'Tube(s)' },
      27: { desc: 'Human Stool for Clinical Trials', hts: '0511.99.4070', val: 10, pkg: 'Vial(s)' },
      28: { desc: 'Human Vaccine for Clinical Trials', hts: '3002.41.0000', val: 10, pkg: 'Vial(s)' }
    };
    var dataB = [[''], [''], [''], [''], ['']];
    var dataD = [[''], [''], [''], [''], ['']];
    var dataG = [[''], [''], [''], [''], ['']];
    var dataP = [[''], [''], [''], [''], ['']];
    var dataT = [[''], [''], [''], [''], ['']];
    var out = 0;
    for (var i = 0; i < checked.length && out < 5; i++) {
      if (checked[i][0] !== true) continue;
      var row = 21 + i;
      var item = itens[row];
      if (!item) continue;
      dataB[out][0] = tubos[i][0] || '';
      dataD[out][0] = item.pkg;
      dataG[out][0] = item.desc;
      dataP[out][0] = item.hts;
      dataT[out][0] = item.val;
      out++;
    }
    invoice.getRange('B27:B31').setValues(dataB);
    invoice.getRange('D27:D31').setValues(dataD);
    invoice.getRange('G27:G31').setValues(dataG);
    invoice.getRange('P27:P31').setValues(dataP);
    invoice.getRange('T27:T31').setValues(dataT);
  } catch (error) {
    transporteRegistrarAviso_('atualizarInvoiceMarkenAmostras_');
    Logger.log('Falha de preenchimento em atualizarInvoiceMarkenAmostras_.');
  }
}

function transporteAplicarAutomacoesTemperatura_(ss, payload) {
  payload = payload || {};
  ss = ss || getTransporteSpreadsheetCodex_();
  var temperatura = transporteNormalizeTemperaturaFromCodex_(payload.temperatura);
  var courier = String(payload.courier || '').trim();
  var declaracao = transporteGetSheet_(ss, 'declaracaoTransp', false);
  var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
  var isPinexLike = courier === 'PINEX' || courier === 'PINEX (Agendamento)';
  var formularioPinex = isPinexLike ? transporteGetSheet_(ss, 'formularioPinex', false) : null;

  if (declaracao) {
    declaracao.getRangeList(['F32', 'H32', 'J32']).setValue(false);
    if (temperatura === 'AMBIENTE') declaracao.getRange('F32').setValue(true);
    if (temperatura === 'REFRIGERADO') declaracao.getRange('H32').setValue(true);
    if (temperatura === 'CONGELADO') declaracao.getRange('J32').setValue(true);
    if (temperatura === 'AMBIENTE + CONGELADO') {
      declaracao.getRange('F32').setValue(true);
      declaracao.getRange('J32').setValue(true);
    }
    if (temperatura === 'AMBIENTE + REFRIGERADO') {
      declaracao.getRange('F32').setValue(true);
      declaracao.getRange('H32').setValue(true);
    }
  }

  if (peticao) {
    peticao.getRangeList(['G28', 'N28', 'K28']).setValue(false);
    if (temperatura === 'AMBIENTE') peticao.getRange('G28').setValue(true);
    if (temperatura === 'REFRIGERADO') peticao.getRange('N28').setValue(true);
    if (temperatura === 'CONGELADO') peticao.getRange('K28').setValue(true);
    if (temperatura === 'AMBIENTE + CONGELADO') {
      peticao.getRange('G28').setValue(true);
      peticao.getRange('K28').setValue(true);
    }
    if (temperatura === 'AMBIENTE + REFRIGERADO') {
      peticao.getRange('G28').setValue(true);
      peticao.getRange('N28').setValue(true);
    }
  }

  if (formularioPinex) {
    var pinexTemp = [['---'], ['---'], ['---']];
    if (temperatura === 'AMBIENTE' || temperatura === 'AMBIENTE + CONGELADO' || temperatura === 'AMBIENTE + REFRIGERADO') pinexTemp[0][0] = 1;
    if (temperatura === 'CONGELADO') pinexTemp[1][0] = 1;
    if (temperatura === 'REFRIGERADO' || temperatura === 'AMBIENTE + CONGELADO' || temperatura === 'AMBIENTE + REFRIGERADO') pinexTemp[2][0] = 1;
    formularioPinex.getRange('D37:D39').setValues(pinexTemp);
  }

  atualizarPesoGeloDeclaracao_(ss);
  if (courier === 'MARKEN') {
    atualizarMarkenVolumes_(ss);
    atualizarInvoiceMarkenAmostras_(ss);
  }
  if (courier === 'OCASA') {
    atualizarOcasaProformaTipoAmostra_(ss);
  }
  if (courier === 'PINEX') {
    atualizarCommercialInvoicePinex_(ss);
    atualizarCommercialInvoicePinexB33_(ss);
    atualizarCommercialInvoicePinexB34_(ss);
    atualizarCommercialInvoicePinexTemperatura_(ss);
    atualizarPeticaoPinexTemperatura_(ss);
    atualizarCommercialInvoicePinexE48_(ss);
  } else if (courier === 'PINEX (Agendamento)') {
    atualizarFormularioPinex_(ss);
  }
}

function montarPayloadTransporteCodex(codexPayload) {
  codexPayload = codexPayload || {};
  var agenda = codexPayload.agenda || codexPayload.evento || codexPayload;
  var slot = normalizarSlotTransporteCodex_(codexPayload.slot || codexPayload.transporte || '1', true);
  var slotMap = {
    '1': 'courier1',
    i: 'courier1',
    'transporte i': 'courier1',
    '2': 'courier2',
    ii: 'courier2',
    'transporte ii': 'courier2',
    '3': 'courier3',
    iii: 'courier3',
    'transporte iii': 'courier3',
    backup: 'backup',
    b: 'backup'
  };
  var courierKey = slotMap[slot];
  var courier = Object.assign({}, agenda[courierKey] || {}, codexPayload.courier || {});
  var courierNome = transporteNormalizeCourierFromCodex_(courier.nome || courier.courier);
  var temperatura = transporteNormalizeTemperaturaFromCodex_(courier.temperatura || courier.temp);
  var materiais = transporteMateriaisFromCodex_(courierNome, courier.matBioJson || courier.materialJson, courier.material);
  var dataIso = agenda.dataIso || agenda.data || codexPayload.dataColeta || codexPayload.data;
  var identificacao = codexPayload.identificacaoParticipante || codexPayload.numId || agenda.idParticipante || '';

  return {
    paciente: agenda.participante || codexPayload.participante || '',
    participanteCadastroId: codexPayload.participanteCadastroId || agenda.participantCadastroId || agenda.participanteCadastroId || '',
    participante: agenda.participante || codexPayload.participante || '',
    iniciais: codexPayload.iniciais || extrairIniciais_(agenda.participante || codexPayload.participante),
    identificacaoParticipante: identificacao,
    idParticipante: identificacao,
    protocolo: transporteProjetoDisplay_(agenda.projeto || codexPayload.projeto || ''),
    investigador: agenda.medico || codexPayload.medico || '',
    temperatura: temperatura,
    dataColeta: dataIso,
    dataEnvio: dataIso,
    horaEnvio: codexPayload.horaEnvio || '',
    courier: courierNome,
    destino: courier.destino || courier.laboratorioDestino || '',
    awb: courier.awb || '',
    solicitarCaixa: codexPayload.solicitarCaixa || transporteDefaultSolicitarCaixa_(courierNome),
    agendadoPor: codexPayload.agendadoPor || codexPayload.responsavel || transporteAgendadorPadrao_(),
    pinexAgendadoPor: codexPayload.pinexAgendadoPor || codexPayload.agendadoPor || codexPayload.responsavel || transporteAgendadorPadrao_(),
    responsavelEntrega: codexPayload.responsavelEntrega || '',
    observacoes: '',
    idAgenda: codexPayload.idAgenda || agenda.id || '',
    agendaSlot: normalizarSlotTransporteCodex_(slot),
    refInterna: codexPayload.refInterna || transporteAgendaRefInterna_(codexPayload.idAgenda || agenda.id || ''),
    materiais: materiais
  };
}

function transporteMateriaisParaAgenda_(materiais) {
  var items = [];
  (materiais || []).forEach(function(item) {
    if (!item || item.ativo !== true) return;
    var key = transporteMaterialKey_(item.material);
    var tipo = key === 'outro'
      ? String(item.material || 'Outro tipo').trim()
      : String(TRANSPORTE_MATERIAL_ALIASES[key] || item.material || '').trim();
    var unit = transporteMatBioUnitKey_(item.unit || codexMatBioUnit_(key, 'mL'));
    var formula = String(item.formula || '').trim();
    var calc = transporteParseFormula_(formula);
    var tubos = transporteTubosMaterial_(item);
    var total = transporteTotalMaterial_(item);
    var segmentos = calc.segmentos;
    if (!segmentos.length && tubos > 0 && total > 0) {
      segmentos = [{ qtd: tubos, vol: total / tubos }];
      formula = transporteFormulaFromSegments_(segmentos, unit);
    }
    if (!tipo) return;
    items.push({
      key: key,
      tipo: tipo,
      ensaio: String(item.ensaio || item.exame || '').trim(),
      formula: formula,
      tubos: tubos,
      total: total,
      unit: unit,
      segmentos: segmentos
    });
  });
  var serialized = codexMatBioSerializeItems_(items);
  return {
    summary: serialized.summary,
    json: serialized.json
  };
}

function transporteSincronizarAgenda_(payload) {
  payload = payload || {};
  var awb = String(payload.awb || '').trim();
  var link = transporteAgendaLinkFromRef_(payload.refInterna || '', '');
  var idAgenda = String(payload.idAgenda || link.idAgenda || '').trim();
  var slotRaw = String(payload.agendaSlot || payload.slot || '').trim();
  var slot = slotRaw ? normalizarSlotTransporteCodex_(slotRaw) : '';
  if (!idAgenda) return { atualizado: false, motivo: 'Sem vínculo com a Agenda' };
  if (!slot) return { atualizado: false, motivo: 'Vínculo legado sem identificação do transporte' };
  if (typeof getAgendaSheet_ !== 'function' || typeof encontrarLinhaPorId !== 'function') {
    return { atualizado: false, motivo: 'Agenda indisponível neste projeto' };
  }
  var slotMap = {
    '1': AGENDA_CFG.idx.c1,
    '2': AGENDA_CFG.idx.c2,
    '3': AGENDA_CFG.idx.c3,
    backup: AGENDA_CFG.idx.cb
  };
  var idx = slotMap[slot];
  if (!idx) throw new Error('Slot de transporte inválido para sincronizar a AWB: ' + slot + '.');
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, idAgenda);
  if (!linha) throw new Error('Os dados foram salvos no Transporte, mas o agendamento ' + idAgenda + ' não foi encontrado.');
  var changes = [];
  var warnings = [];
  var courier = String(agenda.getRange(linha, idx.nome + 1).getDisplayValue() || '').trim();
  function preencherSeVazio(field, column, value) {
    value = String(value || '').trim();
    if (!value) return;
    var cell = agenda.getRange(linha, column);
    var anterior = String(cell.getDisplayValue() || cell.getValue() || '').trim();
    if (anterior) return;
    cell.setValue(value);
    changes.push({ field: field, oldValue: '', newValue: value });
  }
  preencherSeVazio('Transporte ' + slot + ' - Destino', idx.destino + 1, payload.destino);
  if (idx.temp !== undefined) preencherSeVazio('Transporte ' + slot + ' - Temperatura', idx.temp + 1, payload.temperatura);
  // Salvar/preparar documentos não comprova que o e-mail foi enviado.
  // O monitor da cópia recebida promove o slot para Agendado depois do envio.
  var statusNovo = String(payload.statusCourier || payload.status || '').trim();
  if (statusNovo) {
    var statusCell = agenda.getRange(linha, idx.status + 1);
    var statusAnterior = String(statusCell.getDisplayValue() || statusCell.getValue() || '').trim();
    var statusAnteriorNorm = normText_(statusAnterior);
    if (!statusAnterior || statusAnteriorNorm === 'nao agendado') {
      statusCell.setValue(statusNovo);
      changes.push({ field: 'Transporte ' + slot + ' - Status', oldValue: statusAnterior, newValue: statusNovo });
    }
  }

  var materialAgenda = transporteMateriaisParaAgenda_(payload.materiais || []);
  var materialAtual = String(agenda.getRange(linha, idx.material + 1).getDisplayValue() || '').trim();
  var materialJsonAtual = String(agenda.getRange(linha, idx.matBio + 1).getDisplayValue() || '').trim();
  if (!materialAtual && materialAgenda.summary) {
    agenda.getRange(linha, idx.material + 1).setValue(materialAgenda.summary);
    changes.push({ field: 'Transporte ' + slot + ' - Materiais', oldValue: '', newValue: materialAgenda.summary });
  }
  if (!materialJsonAtual && materialAgenda.json) {
    agenda.getRange(linha, idx.matBio + 1).setValue(materialAgenda.json);
    changes.push({ field: 'Transporte ' + slot + ' - Materiais estruturados', oldValue: '', newValue: materialAgenda.summary || materialAgenda.json });
  }

  if (awb && idx.awb !== undefined) {
    var range = agenda.getRange(linha, idx.awb + 1);
    var awbAnterior = String(range.getDisplayValue() || range.getValue() || '').trim();
    var awbAnteriorNorm = normalizarAwbCourier_(awbAnterior);
    var awbNovaNorm = normalizarAwbCourier_(awb);
    if (!awbAnterior) {
      if (typeof agendaSetAwbValue_ === 'function') agendaSetAwbValue_(range, awb, courier);
      else range.setValue(awb);
      changes.push({ field: 'Transporte ' + slot + ' - AWB', oldValue: '', newValue: awb });
    } else if (awbAnteriorNorm !== awbNovaNorm) {
      warnings.push('Agenda ja possui AWB diferente para o transporte ' + slot + ' (' + awbAnterior + '). A AWB do Transporte (' + awb + ') nao foi sobrescrita automaticamente.');
    }
  }
  if (slot === '1' && awb && idx.awb !== undefined && typeof agendaAtualizarBackupAwbVinculado_ === 'function') {
    var awbAtualRange = agenda.getRange(linha, idx.awb + 1);
    var awbAtual = String(awbAtualRange.getDisplayValue() || awbAtualRange.getValue() || '').trim();
    agendaAtualizarBackupAwbVinculado_(agenda, linha, awbAtual);
  }
  if (typeof codexWriteAuditChanges_ === 'function' && changes.length) {
    codexWriteAuditChanges_('Agenda', 'salvarTransporte', idAgenda, changes, 'Dados sincronizados pela tela de Transporte de Amostras');
  }
  SpreadsheetApp.flush();
  return { atualizado: changes.length > 0, idAgenda: idAgenda, slot: slot, awb: awb, campos: changes.map(function(c) { return c.field; }), warnings: warnings };
}

function importarTransporteCodex(codexPayload, contextoInterno) {
  var payload = montarPayloadTransporteCodex(codexPayload);
  return salvarTransporte(payload, {
    rascunho: true,
    agendaEvento: contextoInterno && contextoInterno.evento ? contextoInterno.evento : null
  });
}

function importarTransporteCodexInterno_(codexPayload, contextoInterno) {
  var payload = montarPayloadTransporteCodex(codexPayload);
  return salvarTransporteInterno_(payload, {
    rascunho: true,
    agendaEvento: contextoInterno && contextoInterno.evento ? contextoInterno.evento : null
  });
}

function transporteSincronizarDependencias_(options) {
  options = options || {};
  var ss = getTransporteSpreadsheetCodex_();
  var registro = transporteReadRegistro_();
  var payload = {
    paciente: registro.paciente,
    protocolo: registro.protocolo,
    investigador: registro.investigador,
    temperatura: registro.temperatura,
    dataColeta: registro.dataColeta,
    dataEnvio: registro.dataEnvio,
    horaEnvio: registro.horaEnvio,
    courier: registro.courier,
    destino: registro.destino,
    awb: registro.awb,
    agendadoPor: registro.agendadoPor,
    observacoes: registro.observacoes,
    materiais: registro.materiais
  };
  transporteAplicarAutomacoesTemperatura_(ss, payload);
  aplicarSolicitacaoCaixaTransporte_(ss, payload);
  transporteAplicarCourierConfig_(ss, payload.courier);
  transportePreencherPeticaoMedico_(ss, payload);
  transportePreencherDeclaracaoCadastros_(ss, payload);
  if (payload.courier === 'PINEX') atualizarCommercialInvoicePinexB34_(ss);
  preencherDadosProtocoloPeticaoWebApp_(ss, payload);
  preencherPeticaoAnuenciaWebApp_(ss, payload);
  preencherDhlWebApp_(ss, payload);
  if (options.visibilidade) {
    try {
    if (typeof manageSheetVisibilityUnified_ === 'function') manageSheetVisibilityUnified_(ss, false);
    } catch (e2) {
    Logger.log('Visibilidade nao sincronizada: ' + e2.message);
    }
  }
}

function sincronizarTransporte() {
  if (typeof codexAssertCanWrite_ === 'function') codexAssertCanWrite_('sincronizarTransporte', 'Transporte', '');
  return codexWithDocumentLock_('sincronizarTransporte', function() {
    transporteSincronizarDependencias_({ visibilidade: false });
    // A releitura do bootstrap depende das formulas das abas atualizadas.
    SpreadsheetApp.flush();
    return getTransporteBootstrap();
  });
}

function limparTransporte() {
  if (typeof codexAssertCanWrite_ === 'function') codexAssertCanWrite_('limparTransporte', 'Transporte', '');
  return codexWithDocumentLock_('limparTransporte', function() {
    var result = typeof performContentDeletion_ === 'function' ? performContentDeletion_() : 'WARN_SOME_ERRORS';
    transporteSincronizarDependencias_({ visibilidade: false });
    // Persistir as dependencias recalculadas antes de reler o formulario.
    SpreadsheetApp.flush();
    return { result: result, data: getTransporteBootstrap() };
  });
}

function executarSandboxTransporteCodex(options) {
  if (typeof codexAssertAdmin_ === 'function') codexAssertAdmin_();
  options = options || {};
  if (options.gerarPdfs !== false) options.gerarPdfs = true;
  if (options.criarRascunhos !== false) options.criarRascunhos = true;
  var marker = String(options.marker || ('CODEXTEST-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss')));
  var couriers = options.couriers || ['MARKEN', 'OCASA', 'DHL', 'PINEX', 'PINEX (Agendamento)'];
  var results = [];
  for (var i = 0; i < couriers.length; i++) {
    var courier = couriers[i];
    var payload = transporteSandboxPayload_(marker, courier);
    var item = { marker: marker, courier: courier };
    try {
      item.salvar = salvarTransporte(payload);
      if (options.gerarPdfs) {
        item.pdf = gerarPdfTransporte({ marker: marker, courier: courier, criarRascunho: options.criarRascunhos, payload: payload });
        if (options.criarRascunhos) item.rascunho = 'Gerado automaticamente apos PDF.';
      } else if (options.criarRascunhos) {
        item.rascunho = criarRascunhoTransporte_();
      }
      if (String(item.pdf || '').indexOf('Erro') === 0 || String(item.rascunho || '').indexOf('Erro') === 0) {
        item.error = [item.pdf, item.rascunho].filter(function(v) {
          return String(v || '').indexOf('Erro') === 0;
        }).join(' | ');
      }
    } catch (e) {
      item.error = e.message || String(e);
    }
    results.push(item);
  }
  var cleanup = options.limpar === false ? null : limparSandboxCodex(marker);
  return { ok: !results.some(function(r) { return r.error; }), marker: marker, results: results, cleanup: cleanup };
}

function executarSandboxTransporteCodexCompleto() {
  if (typeof codexAssertAdmin_ === 'function') codexAssertAdmin_();
  return executarSandboxTransporteCodex({
    gerarPdfs: true,
    criarRascunhos: true,
    limpar: true
  });
}

function transporteSandboxPayload_(marker, courier) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var destinoPadrao = transporteLabCentralDestinoPadrao_();
  var awbMap = {
    MARKEN: '123456789012',
    OCASA: 'T1234567',
    DHL: '1234567890',
    PINEX: '12345678',
    'PINEX (Agendamento)': ''
  };
  return {
    paciente: marker + ' Paciente Teste',
    protocolo: marker + ' PROTO',
    investigador: 'Investigador ' + marker,
    temperatura: courier === 'DHL' ? 'REFRIGERADO' : 'AMBIENTE',
    dataColeta: today,
    dataEnvio: today,
    horaEnvio: '13:00 - 15:00',
    courier: courier,
    destino: destinoPadrao,
    awb: awbMap[courier] || '12345678',
    pinexColeta: courier === 'PINEX' ? '123456' : '',
    agendadoPor: marker,
    responsavelEntrega: courier === 'PINEX (Agendamento)' ? marker : '',
    observacoes: marker + ' rotina sandbox',
    materiais: [{
      ativo: true,
      material: 'Sangue',
      tubos: 2,
      formula: courier === 'DHL' ? '2 x 0,0010' : '2 x 1',
      total: courier === 'DHL' ? 0.002 : 2,
      ensaio: 'Hemograma ' + marker,
      unit: courier === 'DHL' ? 'L' : 'mL'
    }]
  };
}

function limparSandboxCodex(marker) {
  if (typeof codexAssertAdmin_ === 'function') codexAssertAdmin_();
  marker = String(marker || 'CODEXTEST');
  var out = { marker: marker, agendaRowsDeleted: 0, configRowsDeleted: 0, transporte: null };
  try {
    out.transporte = limparTransporte();
  } catch (e) {
    out.transporteError = e.message || String(e);
  }
  try {
    if (typeof getAgendaSheet_ === 'function') {
      var agenda = getAgendaSheet_();
      var lastRow = agenda.getLastRow();
      var lastCol = agenda.getLastColumn();
      if (lastRow > 1 && lastCol > 0) {
        var rows = agenda.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
        for (var i = rows.length - 1; i >= 0; i--) {
          if (rows[i].join(' ').indexOf(marker) >= 0) {
            agenda.deleteRow(i + 2);
            out.agendaRowsDeleted++;
          }
        }
      }
    }
  } catch (e2) {
    out.agendaError = e2.message || String(e2);
  }
  try {
    if (typeof getConfigAppSheet_ === 'function') {
      var cfg = getConfigAppSheet_();
      var lastCfgRow = cfg.getLastRow();
      var lastCfgCol = cfg.getLastColumn();
      if (lastCfgRow > 1 && lastCfgCol > 0) {
        var cfgRows = cfg.getRange(2, 1, lastCfgRow - 1, Math.min(13, lastCfgCol)).getDisplayValues();
        for (var j = cfgRows.length - 1; j >= 0; j--) {
          if (cfgRows[j].join(' ').indexOf(marker) >= 0) {
            cfg.deleteRow(j + 2);
            out.configRowsDeleted++;
          }
        }
      }
    }
  } catch (e3) {
    out.configError = e3.message || String(e3);
  }
  return out;
}

function transportePdfManifestText_(value) {
  return transporteNorm_(value).replace(/\s+/g, ' ');
}

function transportePdfManifesto_(registro, materialRows) {
  registro = registro || {};
  var slotRaw = String(registro.agendaSlot || registro.slot || '').trim();
  return {
    versao: 2,
    agendaId: String(registro.idAgenda || registro.agendaId || '').trim().toUpperCase(),
    slot: slotRaw ? normalizarSlotTransporteCodex_(slotRaw) : '',
    courier: transportePdfManifestText_(transporteNormalizeCourierFromCodex_(registro.courier || registro.nomeCourier || '')),
    temperatura: transportePdfManifestText_(transporteNormalizeTemperaturaFromCodex_(registro.temperatura || registro.temp || '')),
    destino: transportePdfManifestText_(registro.destino || registro.laboratorioDestino || ''),
    awb: String(registro.awb || '').trim(),
    paciente: transportePdfManifestText_(registro.paciente || registro.participante || ''),
    identificacaoParticipante: String(registro.identificacaoParticipante || registro.idParticipante || '').trim(),
    participanteCadastroId: String(registro.participanteCadastroId || '').trim(),
    protocolo: transportePdfManifestText_(registro.protocolo || registro.projeto || ''),
    materiais: (materialRows || []).map(function(row) {
      return [
        transportePdfManifestText_(row && row[0]),
        transportePdfManifestText_(row && row[1])
      ];
    })
  };
}

function transportePdfManifestoHash_(manifesto) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(manifesto || {}),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function transportePdfDocumentoHash_(manifesto, registro) {
  registro = registro || {};
  // O manifesto compara os rotulos impressos; o hash de envio tambem guarda
  // precisao, quantidades, datas e textos que podem mudar o documento.
  return transportePdfManifestoHash_({
    versao: 1,
    manifesto: manifesto,
    dataColeta: transporteDateOut_(registro.dataColeta),
    dataEnvio: transporteDateOut_(registro.dataEnvio),
    horaEnvio: String(registro.horaEnvio || '').trim(),
    investigador: String(registro.investigador || '').trim(),
    agendadoPor: String(registro.agendadoPor || '').trim(),
    observacoes: String(registro.observacoes || '').trim(),
    solicitarCaixa: registro.solicitarCaixa,
    responsavelEntrega: String(registro.responsavelEntrega || '').trim(),
    pinexAwb: String(registro.pinexAwb || '').trim(),
    pinexColeta: String(registro.pinexColeta || '').trim(),
    pinexAgendadoPor: String(registro.pinexAgendadoPor || '').trim(),
    materiais: (registro.materiais || []).filter(function(item) { return item && item.ativo === true; }).map(function(item) {
      return [String(item.material || ''), String(item.unit || ''), String(item.formula || ''),
        item.tubos, item.total, String(item.ensaio || item.exame || item.nomeExame || '')];
    })
  });
}

function transportePdfMaterialRowsPlanilha_(ss) {
  var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
  if (!peticao) return [];
  var materiais = peticao.getRange('K30:K35').getValues();
  var ensaios = peticao.getRange('P30:P35').getValues();
  return materiais.map(function(row, idx) {
    return [row[0], ensaios[idx] && ensaios[idx][0]];
  });
}

function transporteValidarManifestoPdf_(options) {
  options = options || {};
  var ss = getTransporteSpreadsheetCodex_();
  var registroAtual = transporteReadRegistro_();
  var manifestoAtual = transportePdfManifesto_(registroAtual, transportePdfMaterialRowsPlanilha_(ss));
  var payload = options.payload || null;

  if (!payload) {
    if (manifestoAtual.agendaId || manifestoAtual.slot) {
      throw new Error(
        'Bloqueio de seguranca do PDF: o Transporte esta vinculado a Agenda, mas a solicitacao nao trouxe o payload do slot. ' +
        'Reabra a documentacao pela Agenda e tente novamente. Nenhum PDF foi gerado.'
      );
    }
    return { hash: transportePdfDocumentoHash_(manifestoAtual, registroAtual), manifesto: manifestoAtual, modo: 'manual' };
  }

  var linkPayload = transporteAgendaLinkFromRef_(payload.refInterna || '', '');
  var registroEsperado = Object.assign({}, payload, {
    idAgenda: payload.idAgenda || linkPayload.idAgenda || '',
    agendaSlot: payload.agendaSlot || payload.slot || linkPayload.agendaSlot || ''
  });
  var manifestoEsperado = transportePdfManifesto_(
    registroEsperado,
    transportePeticaoMaterialRows_(payload.materiais || [])
  );
  if (JSON.stringify(manifestoEsperado) !== JSON.stringify(manifestoAtual)) {
    var divergencias = [];
    ['agendaId', 'slot', 'courier', 'temperatura', 'destino', 'awb', 'paciente', 'identificacaoParticipante', 'participanteCadastroId', 'protocolo'].forEach(function(campo) {
      if (manifestoEsperado[campo] !== manifestoAtual[campo]) divergencias.push(campo);
    });
    if (JSON.stringify(manifestoEsperado.materiais) !== JSON.stringify(manifestoAtual.materiais)) {
      divergencias.push('materiais e ensaios');
    }
    throw new Error(
      'Bloqueio de seguranca do PDF: os dados gravados divergem do transporte aberto' +
      (divergencias.length ? ' (' + divergencias.join(', ') + ')' : '') +
      '. Recarregue o transporte e confira os dados. Nenhum PDF foi gerado.'
    );
  }
  return {
    hash: transportePdfDocumentoHash_(manifestoEsperado, registroAtual),
    manifesto: manifestoEsperado,
    modo: manifestoEsperado.agendaId ? 'agenda' : 'manual'
  };
}

// Estado duravel por executor. Nunca usar cache para decidir recriacao de artefatos.
var TRANSPORTE_GENERATION_REQUEST_ = null;

function transporteGenerationCanonical_(value) {
  if (Array.isArray(value)) return value.map(transporteGenerationCanonical_);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).sort().forEach(function(key) { result[key] = transporteGenerationCanonical_(value[key]); });
    return result;
  }
  return value;
}

function transporteGenerationPersist_(context, changes) {
  var next = Object.assign({}, context.record, changes, { updatedAt: Date.now() });
  var text = JSON.stringify(next);
  // Reserva margem abaixo dos 9 KB por propriedade, incluindo texto UTF-8.
  if (Utilities.newBlob(text).getBytes().length > 8000) throw new Error('Resultado de geração excedeu o limite de recuperação. Confira os artefatos antes de gerar novamente.');
  context.props.setProperty(context.key, text);
  context.record = next; // Somente avanca apos persistencia confirmada.
}

function transporteGenerationCheckpoint_(changes) {
  if (TRANSPORTE_GENERATION_REQUEST_) transporteGenerationPersist_(TRANSPORTE_GENERATION_REQUEST_, changes);
}

function transporteGenerationBegin_(options) {
  var token = String(options.generationRequestId || '');
  if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Identificador de geração inválido. Reabra o Transporte.');
  if (!options.payload || typeof options.payload !== 'object') throw new Error('A recuperação da geração exige os dados do Transporte.');
  var props = PropertiesService.getUserProperties();
  var key = 'TRP_GEN_V1:' + token;
  var hash = transportePdfManifestoHash_(transporteGenerationCanonical_({ payload: options.payload, criarRascunho: options.criarRascunho !== false, courier: options.courier || '', marker: options.marker || '', requestedByEmail: options.requestedByEmail || '' }));
  var raw = props.getProperty(key);
  var record = raw ? JSON.parse(raw) : null;
  if (record && ['READY', 'PDF_INTENT', 'PDF_READY', 'DRAFT_INTENT', 'DRAFT_READY', 'COMPLETE', 'RETIRED'].indexOf(record.phase) < 0) throw new Error('Registro de recuperação inválido. Confira os artefatos antes de uma nova geração.');
  if (record && record.hash !== hash) throw new Error('Esta solicitação de geração pertence a outros dados. Inicie uma nova geração.');
  if (!record) {
    var all = props.getProperties();
    var keys = Object.keys(all).filter(function(k) { return k.indexOf('TRP_GEN_V1:') === 0; });
    if (keys.length >= 1000) throw new Error('Histórico de recuperação cheio. Solicite revisão do armazenamento antes de gerar novos documentos.');
    // Mantem marcadores para impedir que tokens antigos voltem a criar arquivos.
    var completed = keys.map(function(k) { return { key: k, record: JSON.parse(all[k]) }; }).filter(function(item) { return item.record.phase === 'COMPLETE'; }).sort(function(a, b) { return a.record.updatedAt - b.record.updatedAt; });
    completed.slice(0, Math.max(0, completed.length - 19)).forEach(function(item) {
      props.setProperty(item.key, JSON.stringify({ hash: item.record.hash, phase: 'RETIRED', updatedAt: item.record.updatedAt }));
    });
    record = { hash: hash, phase: 'READY', updatedAt: Date.now() };
    var context = { props: props, key: key, record: record };
    transporteGenerationPersist_(context, {});
    return context;
  }
  return { props: props, key: key, record: record };
}

function transporteGenerationSourceHash_(ss, names) {
  return transportePdfManifestoHash_(names.map(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Modelo de documentação não localizado durante a recuperação.');
    return { name: name, values: sheet.getDataRange().getDisplayValues() };
  }));
}

function transporteGenerationMergeWarnings_(previous, current) {
  var seen = {};
  return (previous || []).concat(current || []).filter(function(item) {
    var key = item.code || item.message;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function transporteGenerationReplay_(record) {
  if (record.phase === 'RETIRED') throw new Error('O resultado antigo saiu do histórico de recuperação. Confira os documentos e use Nova geração se precisar recriá-los.');
  if (record.phase === 'PDF_INTENT') throw new Error('A geração anterior pode ter criado o PDF, mas não confirmou seu ID. Confira o Drive antes de iniciar Nova geração.');
  if (record.phase === 'DRAFT_INTENT') {
    var result = Object.assign({}, record.pdf, { draftOk: false, draftErrorCode: 'GENERATION_UNCERTAIN', draftError: 'O rascunho pode ter sido criado. Confira o Gmail antes de iniciar Nova geração.', recovered: true });
    result.message = 'PDF recuperado. ' + result.draftError;
    return result;
  }
  if (record.phase === 'COMPLETE') return Object.assign({}, record.result, { recovered: true });
  return null;
}

function gerarPdfTransporte(options) {
  return codexWithDocumentLock_('gerarPdfTransporte', function() {
    TRANSPORTE_GENERATION_WARNINGS_ = [];
    try {
      var result = transporteMeasurePerformance_('gerarPdfTransporte', 'total', { rowCount: 1 }, function() {
      var access = typeof codexAssertCanWrite_ === 'function'
        ? codexAssertCanWrite_('gerarPdfTransporte', 'Transporte', options && options.id)
        : null;
      options = options || {};
      if (options.generationRequestId) {
        if (!access) throw new Error('Não foi possível autorizar a recuperação da geração.');
        TRANSPORTE_GENERATION_REQUEST_ = transporteGenerationBegin_(options);
        var replay = transporteGenerationReplay_(TRANSPORTE_GENERATION_REQUEST_.record);
        if (replay) return replay;
      }
      return gerarPdfTransporteInterno_(options, access);
      });
      if (result && typeof result === 'object') {
        if (!result.recovered) {
          result.warnings = transporteGenerationMergeWarnings_(result.warnings, TRANSPORTE_GENERATION_WARNINGS_);
        }
        if (!result.recovered && result.warnings.length) result.message = (result.message || 'PDF gerado.') + ' ' + result.warnings.map(function(item) { return item.message; }).join(' ');
      }
      if (TRANSPORTE_GENERATION_REQUEST_ && !result.recovered) {
        if (TRANSPORTE_GENERATION_REQUEST_.record.phase === 'DRAFT_INTENT') {
          result.draftOk = false;
          result.draftErrorCode = 'GENERATION_UNCERTAIN';
          result.draftError = 'O rascunho pode ter sido criado. Confira o Gmail antes de iniciar Nova geração.';
          result.message = 'PDF gerado. ' + result.draftError;
        } else if (result.draftOk !== false || result.draftId) {
          transporteGenerationCheckpoint_({ phase: 'COMPLETE', result: result, pdf: null, draft: null });
        }
      }
      return result;
    } finally {
      TRANSPORTE_GENERATION_REQUEST_ = null;
      TRANSPORTE_GENERATION_WARNINGS_ = null;
      // Sincronizacao e registro dependem destas escritas antes de outro RPC.
      SpreadsheetApp.flush();
    }
  });
}

function gerarPdfTransporteInterno_(options, access) {
  transporteMeasurePerformance_('gerarPdfTransporte', 'prepare', { rowCount: 1 }, function() {
    if (typeof imprimirTodasAbas !== 'function') throw new Error('FunÃƒÂ§ÃƒÂ£o imprimirTodasAbas nÃƒÂ£o encontrada.');
  });
  options = options || {};
  if (!options.requestedByEmail && access && access.userEmail) options.requestedByEmail = access.userEmail;
  if (options.criarRascunho !== false) options.criarRascunho = true;
  // A planilha de Transporte e compartilhada entre as telas. Reaplicar o
  // payload dentro do mesmo lock da exportacao impede que outra aba troque o
  // slot/courier entre o salvamento do formulario e a geracao do PDF.
  var savedTransport;
  if (options.payload) {
    savedTransport = salvarTransporteInterno_(options.payload, {
      returnBootstrap: false,
      preencherDocumentos: true
    });
  }
  SpreadsheetApp.flush();
  var manifestoPdf = transporteMeasurePerformance_('gerarPdfTransporte', 'manifest_validate', { rowCount: 1 }, function() {
    return transporteValidarManifestoPdf_(options);
  });
  var request = TRANSPORTE_GENERATION_REQUEST_;
  if (request && request.record.manifestHash && request.record.manifestHash !== manifestoPdf.hash) throw new Error('Os dados ou modelos mudaram desde o PDF recuperado. Confira o PDF e inicie Nova geração.');
  if (request && request.record.pdf && !request.record.draft) {
    if (!request.record.sourceHash || !request.record.sourceSheets || transporteGenerationSourceHash_(getTransporteSpreadsheetCodex_(), request.record.sourceSheets) !== request.record.sourceHash) {
      return Object.assign({}, request.record.pdf, { recovered: true, draftOk: false, draftErrorCode: 'RECOVERY_REVIEW_REQUIRED',
        draftError: 'O PDF foi recuperado, mas os modelos não puderam ser confirmados. Confira a documentação antes de uma nova geração.',
        message: 'PDF recuperado. A criação do rascunho não foi retomada porque os modelos não puderam ser confirmados.' });
    }
  }
  transporteGenerationCheckpoint_({ manifestHash: manifestoPdf.hash });
  var result = request && request.record.pdf ? Object.assign({}, request.record.pdf) : transporteMeasurePerformance_('gerarPdfTransporte', 'copy_export_drive', { rowCount: 1 }, function() {
    return imprimirTodasAbas(options);
  });
  // O exportador legado retorna texto; a RPC deve sinalizar falha ao cliente.
  if (typeof result === 'string' && /^Erro\b/i.test(result)) throw new Error(result);
  if (result && typeof result === 'object' && savedTransport) result.agendaSync = savedTransport.agendaSync;
  if (result && typeof result === 'object') result.manifestoPdfHash = result.conteudoPdfHash
    ? transportePdfManifestoHash_({ dados: manifestoPdf.hash, conteudo: result.conteudoPdfHash }) : manifestoPdf.hash;
  if (request) transporteGenerationCheckpoint_({ pdf: Object.assign({}, result, { warnings: transporteGenerationMergeWarnings_(result.warnings, TRANSPORTE_GENERATION_WARNINGS_) }) });
  var courier = result && typeof result === 'object' ? String(result.courier || options.courier || '').trim() : String(options.courier || '').trim();
  var driveAccessWarning = result && typeof result === 'object' ? transporteDriveAccessWarning_(result.driveAccess) : '';
  var registroMonitor;
  try {
    registroMonitor = transporteReadRegistro_() || {};
  } catch (registroMonitorError) {
    registroMonitor = {};
  }
  var monitorRef = transporteMonitorReferencia_(registroMonitor.idAgenda, registroMonitor.agendaSlot);
  if (driveAccessWarning && result && typeof result === 'object') result.driveAccessWarning = driveAccessWarning;
  if (courier === 'PINEX' || normalizarSlotTransporteCodex_(registroMonitor.agendaSlot) === 'backup') {
    var avisoManual = 'PINEX ou Backup: o envio não promove automaticamente o status. Atualize o transporte manualmente na Agenda.';
    Logger.log(avisoManual);
    if (result && typeof result === 'object') {
      result.monitorWarning = avisoManual;
      result.message = (result.message || 'PDF gerado.') + ' ' + avisoManual;
    }
  }
  if (courier === 'PINEX') options.criarRascunho = false;
  if (options.criarRascunho) {
    var draft = transporteMeasurePerformance_('gerarPdfTransporte', 'draft', { rowCount: 1 }, function() {
      if (request && request.record.draft) return request.record.draft;
      return criarRascunhoTransporte_(result && typeof result === 'object' ? {
        pdfFileId: result.fileId,
        requestedByEmail: options.requestedByEmail || '',
        agendadoPor: options.payload && options.payload.agendadoPor ? options.payload.agendadoPor : '',
        monitorRef: monitorRef,
        pdfHash: result.manifestoPdfHash
      } : {
        requestedByEmail: options.requestedByEmail || '',
        agendadoPor: options.payload && options.payload.agendadoPor ? options.payload.agendadoPor : '',
        monitorRef: monitorRef
      });
    });
    var draftStatus = transporteDraftStatus_(draft);
    if (result && typeof result === 'object') {
      result.draftOk = draftStatus.ok;
      result.draftMessage = draftStatus.message;
      result.draftError = draftStatus.ok ? '' : draftStatus.message;
      result.draftErrorCode = draftStatus.errorCode || '';
      result.draftAuthUrl = draftStatus.authUrl || '';
      result.draftId = draftStatus.draftId || '';
      result.draftUserEmail = draftStatus.userEmail || '';
      result.draftActiveUserEmail = draftStatus.activeUserEmail || '';
      result.draftRequestedByEmail = draftStatus.requestedByEmail || '';
      result.monitorRef = monitorRef;
      if (monitorRef && courier !== 'PINEX') {
        try {
          result.monitorRegistro = transporteRegistrarDocumentacaoGerada_({
            agendaId: registroMonitor.idAgenda,
            slot: registroMonitor.agendaSlot,
            courier: courier,
            geradoPor: options.requestedByEmail || draftStatus.requestedByEmail || '',
            pdfId: result.fileId,
            pdfNome: result.fileName,
            pdfHash: result.manifestoPdfHash,
            rascunhoId: draftStatus.draftId,
            rascunhoOk: draftStatus.ok,
            rascunhoErro: draftStatus.message
          });
        } catch (monitorError) {
          result.monitorWarning = 'Não foi possível registrar o acompanhamento do envio: ' + monitorError.message;
        }
      }
      result.message = (result.message || 'PDF gerado.') + (draftStatus.ok
        ? ' Rascunho: ' + draftStatus.message
        : (draftStatus.draftId ? ' ATENCAO: o rascunho criado requer revisão. ' : ' ATENCAO: o PDF foi gerado, mas o rascunho de e-mail nao foi criado. ') + draftStatus.message);
      if (driveAccessWarning) result.message += ' ' + driveAccessWarning;
      return result;
    }
    return result + (draftStatus.ok ? ' Rascunho: ' + draftStatus.message : ' Atencao: rascunho de e-mail nao criado: ' + draftStatus.message);
  }
  if (driveAccessWarning && result && typeof result === 'object') result.message = (result.message || 'PDF gerado.') + ' ' + driveAccessWarning;
  return result || 'Rotina de PDF executada. Verifique o Drive e os alertas do Apps Script.';
}

function transporteDriveAccessWarning_(driveAccess) {
  if (!driveAccess || typeof driveAccess !== 'object') return '';
  var details = [driveAccess.fileShareError, driveAccess.folderShareError].filter(function(v) {
    return String(v || '').trim();
  }).join(' | ');
  if (!details) return '';
  return 'ATENCAO: o Drive nao conseguiu compartilhar arquivo/pasta sem notificacao. ' + details;
}

function transporteDraftStatus_(draft) {
  if (draft && typeof draft === 'object') {
    var draftUserEmail = String(draft.userEmail || '');
    var activeUserEmail = String(draft.activeUserEmail || draft.requestedByEmail || transporteActiveUserEmail_() || '');
    var requestedByEmail = String(draft.requestedByEmail || activeUserEmail || '');
    var ok = typeof draft.ok === 'boolean' ? draft.ok : String(draft.message || '').indexOf('Erro') !== 0;
    var errorCode = String(draft.error || '');
    var message = String(draft.message || draft.error || '');
    if (ok && draftUserEmail && requestedByEmail && draftUserEmail.toLowerCase() !== requestedByEmail.toLowerCase()) {
      ok = false;
      errorCode = 'DRAFT_CREATED_IN_OTHER_ACCOUNT';
      message = 'Rascunho criado na conta efetiva ' + draftUserEmail + ', nao na conta solicitante ' + requestedByEmail + '. Verifique se o deploy publicado esta como USER_ACCESSING.';
    }
    return {
      ok: ok,
      errorCode: ok ? '' : errorCode,
      message: message,
      authUrl: String(draft.authUrl || ''),
      draftId: String(draft.draftId || ''),
      userEmail: draftUserEmail,
      activeUserEmail: activeUserEmail,
      requestedByEmail: requestedByEmail
    };
  }
  var msg = String(draft || '');
  return {
    ok: msg.indexOf('Erro') !== 0,
    errorCode: msg.indexOf('Erro') === 0 ? 'LEGACY_DRAFT_ERROR' : '',
    message: msg,
    authUrl: '',
    draftId: '',
    userEmail: transporteEffectiveUserEmail_(),
    activeUserEmail: transporteActiveUserEmail_()
  };
}

function baixarPdfTransporte(fileId) {
  if (typeof codexAssertCanRead_ === 'function') codexAssertCanRead_();
  fileId = String(fileId || '').trim();
  if (!fileId) throw new Error('ID do PDF nao informado.');
  var file = DriveApp.getFileById(fileId);
  if (file.getMimeType() !== 'application/pdf') throw new Error('O arquivo informado não é um PDF de Transporte.');
  if (!transportePdfDownloadPermitido_(file)) throw new Error('PDF não registrado no módulo Transporte nem localizado na pasta de documentação.');
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  if (!bytes || !bytes.length) throw new Error('PDF vazio ou indisponivel para download.');
  if (bytes.length > 15 * 1024 * 1024) {
    throw new Error('PDF muito grande para download direto pelo WebApp. Use Abrir no Drive.');
  }
  return {
    ok: true,
    fileId: fileId,
    fileName: file.getName() || blob.getName() || 'documentacao-transporte.pdf',
    mimeType: blob.getContentType() || 'application/pdf',
    base64: Utilities.base64Encode(bytes)
  };
}

function transportePdfDownloadPermitido_(file) {
  var fileId = file.getId();
  if (transporteOperacoesRows_().some(function(item) { return item.pdfId === fileId; })) return true;
  // Descobre a pasta sem cria-la. PINEX/Backup/manual usam subpastas por protocolo.
  var roots = Object.create(null);
  var folders = DriveApp.getRootFolder().getFoldersByName('Documentação para Transporte de Amostras');
  while (folders.hasNext()) roots[folders.next().getId()] = true;
  if (!Object.keys(roots).length) return false;
  var pending = [{ item: file, depth: 0 }];
  var visited = Object.create(null);
  while (pending.length) {
    var current = pending.shift();
    if (current.depth >= 20) continue;
    var parents = current.item.getParents();
    while (parents.hasNext()) {
      var parent = parents.next();
      var id = parent.getId();
      if (roots[id]) return true;
      if (!visited[id]) { visited[id] = true; pending.push({ item: parent, depth: current.depth + 1 }); }
    }
  }
  return false;
}

function criarRascunhoTransporte_(options) {
  if (typeof criarRascunhoEmail_ !== 'function') throw new Error('FunÃƒÂ§ÃƒÂ£o criarRascunhoEmail nÃƒÂ£o encontrada.');
  return criarRascunhoEmail_(options || {});
}


/* ===== END TransporteWebApp.gs ===== */


/* ===== BEGIN TransporteOcasaProforma.gs ===== */

/**
 * Atualizacoes locais do TRANSP quando o modulo roda acoplado ao CODEX.
 *
 * Esta versao cobre a Proforma Invoice (OCASA) sem exigir a copia completa do
 * arquivo legado AutomaÃƒÂ§oes.gs.
 */

function atualizarAbasDependentesDeclaracao_(ss) {
  ss = ss || getTransporteSpreadsheetCodex_();
  try {
    var folha = transporteGetSheet_(ss, 'folhaAgendamento', false);
    var courier = folha ? String(getCellValueSafe(folha, 'C10') || '').trim() : '';
    transporteAplicarCourierConfig_(ss, courier);
  } catch (e) {
    Logger.log('Courier config nao aplicada em atualizarAbasDependentesDeclaracao_: ' + e.message);
  }
  atualizarOcasaProformaTipoAmostra_(ss);
}

function atualizarOcasaProformaTipoAmostra_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var declaracaoSheet = transporteGetSheet_(ss, 'declaracaoTransp', false);
    var proformaOcasaSheet = transporteGetSheet_(ss, 'proformaOcasa', false);
    if (!declaracaoSheet || !proformaOcasaSheet) {
      Logger.log('atualizarOcasaProformaTipoAmostra_: abas necessarias nao encontradas.');
      return;
    }
    var sampleTypes = {
      21: 'Blood',
      22: 'Serum',
      23: 'Urine',
      24: 'Plasma',
      25: 'Tissue',
      26: 'Saliva',
      27: 'Stool',
      28: 'Vaccine'
    };
    var checkboxes = declaracaoSheet.getRange('B21:B28').getValues();
    var checkedSamples = [];
    for (var i = 0; i < checkboxes.length; i++) {
      var row = i + 21;
      if (checkboxes[i][0] === true && sampleTypes[row]) checkedSamples.push(sampleTypes[row]);
    }
    proformaOcasaSheet.getRange('B27:P27').clearContent();
    proformaOcasaSheet.getRange('B27').setValue(checkedSamples.join(', '));
  } catch (error) {
    transporteRegistrarAviso_('atualizarOcasaProformaTipoAmostra_');
    Logger.log('Falha de preenchimento em atualizarOcasaProformaTipoAmostra_.');
  }
}


/* ===== END TransporteOcasaProforma.gs ===== */


/* ===== BEGIN TransporteCodexAutomacoes.gs ===== */

/**
 * Blocos do TRANSP adaptados para o CODEX acoplado.
 *
 * Objetivo: manter as rotinas que alimentam documentos, sem depender da
 * planilha ativa nem do pacote legado completo de automacoes visuais.
 */

function transporteCodexSheetNames_() {
  return {
    folhaAgendamento: ['Folha de Agendamento'],
    folhaDhlPinex: ['Folha de Agendamento (DHL/PINEX)', 'Folha de Agendamento (DHLPINEX)'],
    declaracaoTransp: ['DeclaraÃƒÂ§ÃƒÂ£o de Transporte', 'DeclaraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o de Transporte'],
    peticaoAnuencia: ['PetiÃƒÂ§ÃƒÂ£o de AnuÃƒÂªncia de ExportaÃƒÂ§ÃƒÂ£o', 'PetiÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o de AnuÃƒÆ’Ã‚Âªncia de ExportaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o'],
    proformaOcasa: ['Proforma Invoice (OCASA)'],
    invoiceMarken: ['Invoice (MARKEN)'],
    declaracaoDhl: ['DeclaraÃƒÂ§ÃƒÂ£o (DHL)', 'DeclaraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o (DHL)'],
    invoiceDhl: ['Invoice (DHL)'],
    declaracaoTranspDhl: ['DeclaraÃƒÂ§ÃƒÂ£o de Transporte (DHL)', 'DeclaraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o de Transporte (DHL)'],
    emailOcasa: ['Email (OCASA)'],
    emailMarken: ['Email (MARKEN)'],
    emailDhl: ['Email (DHL)', 'E-mail (DHL)'],
    emailPinex: ['Email (PINEX)', 'E-mail (PINEX)'],
    fichaEmergenciaMarken: ['Ficha de EmergÃƒÂªncia (MARKEN)', 'Ficha de EmergÃƒÆ’Ã‚Âªncia (MARKEN)'],
    fichaEmergenciaOcasa: ['Ficha de EmergÃƒÂªncia (OCASA)', 'Ficha de EmergÃƒÆ’Ã‚Âªncia (OCASA)'],
    telefonesUteisOcasa: ['Telefones ÃƒÅ¡teis (OCASA)', 'Telefones ÃƒÆ’Ã…Â¡teis (OCASA)'],
    formularioPinex: ['FormulÃƒÂ¡rio (PINEX)', 'FormulÃƒÆ’Ã‚Â¡rio (PINEX)'],
    invoicePinex: ['Commercial Invoice (PINEX)'],
    usdaStatementPinex: ['USDA Statement (PINEX)'],
    peticaoPinex: ['PetiÃƒÂ§ÃƒÂ£o de AnuÃƒÂªncia de ExportaÃƒÂ§ÃƒÂ£o (PINEX)', 'PetiÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o de AnuÃƒÆ’Ã‚Âªncia de ExportaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o (PINEX)'],
    fichaEmergenciaPinex: ['Ficha de EmergÃƒÂªncia (PINEX)', 'Ficha de EmergÃƒÆ’Ã‚Âªncia (PINEX)']
  };
}

function transporteCodexGetSheet_(ss, keyOrNames, required) {
  ss = ss || getTransporteSpreadsheetCodex_();
  var map = TRANSPORTE_SHEET_NAMES || transporteCodexSheetNames_();
  var names = Array.isArray(keyOrNames) ? keyOrNames : (map[keyOrNames] || [keyOrNames]);
  names = transporteCodexSheetAliases_(keyOrNames, names);
  var sh = transporteFindSheetByNames_(ss, names);
  if (sh) return sh;
  if (required) throw new Error('Aba nao encontrada: ' + names.join(' ou '));
  return null;
}

function transporteCodexSheetAliases_(keyOrNames, names) {
  var key = Array.isArray(keyOrNames) ? '' : String(keyOrNames || '');
  if (TRANSPORTE_SHEET_NAMES && TRANSPORTE_SHEET_NAMES[key]) {
    names = TRANSPORTE_SHEET_NAMES[key].concat(names || []);
  }
  var extra = {
    declaracaoTransp: ['DeclaraÃ§Ã£o de Transporte', 'Declaracao de Transporte'],
    peticaoAnuencia: ['PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o', 'Peticao de Anuencia de Exportacao'],
    declaracaoDhl: ['DeclaraÃ§Ã£o (DHL)', 'Declaracao (DHL)'],
    declaracaoTranspDhl: ['DeclaraÃ§Ã£o de Transporte (DHL)', 'Declaracao de Transporte (DHL)'],
    emailDhl: ['Email (DHL)', 'E-mail (DHL)'],
    emailPinex: ['Email (PINEX)', 'E-mail (PINEX)'],
    fichaEmergenciaMarken: ['Ficha de EmergÃªncia (MARKEN)', 'Ficha de Emergencia (MARKEN)'],
    fichaEmergenciaOcasa: ['Ficha de EmergÃªncia (OCASA)', 'Ficha de Emergencia (OCASA)'],
    telefonesUteisOcasa: ['Telefones Ãšteis (OCASA)', 'Telefones Uteis (OCASA)'],
    formularioPinex: ['FormulÃ¡rio (PINEX)', 'Formulario (PINEX)'],
    peticaoPinex: ['PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o (PINEX)', 'Peticao de Anuencia de Exportacao (PINEX)'],
    fichaEmergenciaPinex: ['Ficha de EmergÃªncia (PINEX)', 'Ficha de Emergencia (PINEX)']
  }[key] || [];
  var seen = Object.create(null);
  return extra.concat(names || []).filter(function(name) {
    if (seen[name]) return false;
    seen[name] = true;
    return true;
  });
}

function getSheetRobust(ss, keyOrName, required) {
  return transporteCodexGetSheet_(ss || getTransporteSpreadsheetCodex_(), keyOrName, required);
}

function getSheetOrLog(ss, keyOrName) {
  var sh = transporteCodexGetSheet_(ss || getTransporteSpreadsheetCodex_(), keyOrName, false);
  if (!sh) Logger.log('Aba nao encontrada: ' + keyOrName);
  return sh;
}

function getCellValueSafe(sheet, cell) {
  try {
    return sheet ? sheet.getRange(cell).getValue() : '';
  } catch (error) {
    transporteRegistrarAviso_('LEITURA_CAMPO_DOCUMENTO');
    Logger.log('Falha ao ler campo do documento.');
    return '';
  }
}

function transporteCodexFormatDateTitle_(date) {
  return transporteCodexFormatDateTitlePt_(date);
}

function transporteCodexFormatDateTitlePt_(date) {
  if (!(date instanceof Date)) return String(date || '');
  var months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  return String(date.getDate()).padStart(2, '0') + months[date.getMonth()] + date.getFullYear();
}

function transporteCodexFormatData_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return value == null ? '' : String(value);
}

function transporteCodexEmailText_(value) {
  var text = transporteCodexFixMojibakeText_(transporteCodexFormatData_(value));
  var fixes = {
    'necessarios': 'necess\u00e1rios',
    'Laboratorio': 'Laborat\u00f3rio',
    'Codigo': 'C\u00f3digo',
    'Declaracao': 'Declara\u00e7\u00e3o',
    'Peticao': 'Peti\u00e7\u00e3o',
    'Anuencia': 'Anu\u00eancia',
    'Exportacao': 'Exporta\u00e7\u00e3o',
    'Emergencia': 'Emerg\u00eancia',
    'Uteis': '\u00dateis',
    'Formulario': 'Formul\u00e1rio',
    'biologico': 'biol\u00f3gico',
    'Biologico': 'Biol\u00f3gico'
  };
  Object.keys(fixes).forEach(function(from) {
    text = text.replace(new RegExp('\\b' + from + '\\b', 'g'), fixes[from]);
  });
  return text;
}

function transporteCodexFixMojibakeText_(value) {
  var text = value == null ? '' : String(value);
  if (!/[\u00c2\u00c3\u00e2]/.test(text)) return text;
  var pairs = [
    ['\u00c3\u0192\u00c2\u00a1', '\u00e1'],
    ['\u00c3\u0192\u00c2\u00a0', '\u00e0'],
    ['\u00c3\u0192\u00c2\u00a2', '\u00e2'],
    ['\u00c3\u0192\u00c2\u00a3', '\u00e3'],
    ['\u00c3\u0192\u00c2\u00a9', '\u00e9'],
    ['\u00c3\u0192\u00c2\u00aa', '\u00ea'],
    ['\u00c3\u0192\u00c2\u00ad', '\u00ed'],
    ['\u00c3\u0192\u00c2\u00b3', '\u00f3'],
    ['\u00c3\u0192\u00c2\u00b4', '\u00f4'],
    ['\u00c3\u0192\u00c2\u00b5', '\u00f5'],
    ['\u00c3\u0192\u00c2\u00ba', '\u00fa'],
    ['\u00c3\u0192\u00c2\u00a7', '\u00e7'],
    ['\u00c3\u0192\u00c2\u0081', '\u00c1'],
    ['\u00c3\u0192\u00c2\u0083', '\u00c3'],
    ['\u00c3\u0192\u00c2\u0089', '\u00c9'],
    ['\u00c3\u0192\u00c2\u009a', '\u00da'],
    ['\u00c3\u00a1', '\u00e1'],
    ['\u00c3\u00a0', '\u00e0'],
    ['\u00c3\u00a2', '\u00e2'],
    ['\u00c3\u00a3', '\u00e3'],
    ['\u00c3\u00a9', '\u00e9'],
    ['\u00c3\u00aa', '\u00ea'],
    ['\u00c3\u00ad', '\u00ed'],
    ['\u00c3\u00b3', '\u00f3'],
    ['\u00c3\u00b4', '\u00f4'],
    ['\u00c3\u00b5', '\u00f5'],
    ['\u00c3\u00ba', '\u00fa'],
    ['\u00c3\u00bc', '\u00fc'],
    ['\u00c3\u00a7', '\u00e7'],
    ['\u00c3\u0081', '\u00c1'],
    ['\u00c3\u0083', '\u00c3'],
    ['\u00c3\u0089', '\u00c9'],
    ['\u00c3\u009a', '\u00da'],
    ['\u00c2\u00ba', '\u00ba'],
    ['\u00c2\u00aa', '\u00aa'],
    ['\u00e2\u0080\u0093', '\u2013'],
    ['\u00e2\u0080\u0094', '\u2014'],
    ['N\u00c3\u0192\u00c6\u2019O', 'N\u00e3o']
  ];
  for (var pass = 0; pass < 2; pass++) {
    pairs.forEach(function(pair) {
      text = text.replace(new RegExp(pair[0], 'g'), pair[1]);
    });
  }
  return text;
}

function transporteCodexEmailEsc_(value) {
  return String(transporteCodexEmailText_(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function transporteCodexEmailCellHtml_(value, tipo) {
  var text = transporteCodexEmailText_(value);
  var html = transporteCodexEmailEsc_(text);
  if (tipo !== 'OCASA') return html;
  html = html.replace(/(Funda(?:\u00e7|\u00c3\u00a7|&ccedil;|c)(?:\u00e3|\u00c3\u00a3|a)o Universidade de Caxias do Sul)\s+(Instituto de Pesquisas em Sa(?:\u00fa|\u00c3\u00ba|&uacute;|u)de)/i, '$1<br>$2');
  html = html.replace(/(Labcorp Central Lab Services LP Specimen Processing)\s+(8211 Scicor Drive\.?\s*Indianapolis,\s*IN,\s*USA)/i, '$1<br>$2');
  return html;
}

function transporteCodexVolume_(value) {
  var n = transporteNumber_(value);
  return n ? String(n).replace('.', ',') : '0';
}

function transporteDeclaracaoFormulaLinha_(sheet, row) {
  var values = sheet.getRange('J' + row + ':L' + row).getValues()[0] || [];
  return values[0] || values[1] || values[2] || '';
}

function transporteVolumeFormulaFontSize_(text) {
  var length = String(text || '').trim().length;
  if (length <= 30) return 11;
  if (length <= 36) return 10;
  if (length <= 42) return 9;
  return 0;
}

function transporteAjustarVolumesDeclaracao_(declaracao, failOnOverflow) {
  if (!declaracao) return [];
  var overflowRows = [];
  for (var row = 21; row <= 28; row++) {
    var text = transporteDeclaracaoFormulaLinha_(declaracao, row);
    var parsed = transporteParseFormula_(text);
    if (parsed.segmentos && parsed.segmentos.length) {
      var compactText = transporteFormulaFromSegments_(parsed.segmentos, 'mL');
      if (compactText !== text) {
        transporteSetTopLeftInBlock_(declaracao, 'J' + row + ':L' + row, compactText);
        text = compactText;
      }
    }
    var fontSize = transporteVolumeFormulaFontSize_(text);
    if (!fontSize) {
      overflowRows.push(row);
      fontSize = 9;
    }
    declaracao.getRange('J' + row + ':L' + row)
      .setFontSize(fontSize)
      .setWrap(false);
  }
  if (failOnOverflow && overflowRows.length) {
    throw new Error(
      'Os volumes da Declara\u00e7\u00e3o de Transporte excedem o espa\u00e7o seguro na(s) linha(s) ' +
      overflowRows.join(', ') + '. Agrupe ou revise os volumes antes de gerar a documenta\u00e7\u00e3o.'
    );
  }
  return overflowRows;
}

function calcularTotalTubos(row) {
  try {
    var ss = getTransporteSpreadsheetCodex_();
    var sheet = transporteCodexGetSheet_(ss, 'declaracaoTransp', true);
    var texto = transporteDeclaracaoFormulaLinha_(sheet, row);
    var parsed = transporteParseFormula_(texto);
    if (String(texto || '').trim()) sheet.getRange('H' + row).setValue(parsed.tubos || 0);
    else sheet.getRange('H' + row).clearContent();
  } catch (error) {
    transporteRegistrarAviso_('calcularTotalTubos');
    Logger.log('Falha de preenchimento em calcularTotalTubos.');
  }
}

function calcularExpressaoLinha(row) {
  try {
    var ss = getTransporteSpreadsheetCodex_();
    var sheet = transporteCodexGetSheet_(ss, 'declaracaoTransp', true);
    var texto = transporteDeclaracaoFormulaLinha_(sheet, row);
    var parsed = transporteParseFormula_(texto);
    if (String(texto || '').trim()) sheet.getRange('N' + row).setValue(parsed.total || 0);
    else sheet.getRange('N' + row).clearContent();
  } catch (error) {
    transporteRegistrarAviso_('calcularExpressaoLinha');
    Logger.log('Falha de preenchimento em calcularExpressaoLinha.');
  }
}

function verificarEAtualizarG33Declaracao_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var declaracao = transporteCodexGetSheet_(ss, 'declaracaoTransp', false);
    if (!folha || !declaracao) return;
    var courier = String(getCellValueSafe(folha, 'C10') || '').trim();
    var temperatura = String(getCellValueSafe(folha, 'C6') || '').trim();
    var laboratorio = String(getCellValueSafe(folha, 'C11') || '').trim();
    var valor = '---';
    if (courier === 'MARKEN' &&
        (temperatura === 'CONGELADO' || temperatura === 'AMBIENTE + CONGELADO') &&
        laboratorio === 'EUROFINS (LANCASTER)') {
      valor = transporteConfigNumber_('Gelo MARKEN EUROFINS (kg)', 10);
    } else if (temperatura === 'CONGELADO' || temperatura === 'AMBIENTE + CONGELADO') {
      valor = (courier === 'PINEX' || courier === 'PINEX (Agendamento)')
        ? transporteConfigNumber_('Gelo PINEX (kg)', 2) : transporteConfigNumber_('Gelo padrão (kg)', 4);
    }
    declaracao.getRange('G33').setValue(valor);
  } catch (error) {
    transporteRegistrarAviso_('verificarEAtualizarG33Declaracao_');
    Logger.log('Falha de preenchimento em verificarEAtualizarG33Declaracao_.');
  }
}

function atualizarMarkenVolumes_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var invoice = transporteCodexGetSheet_(ss, 'invoiceMarken', false);
    if (!folha || !invoice) return;
    var temperatura = String(getCellValueSafe(folha, 'C6') || '').trim();
    var volumes = '';
    var peso = '';
    if (temperatura === 'AMBIENTE' || temperatura === 'CONGELADO' || temperatura === 'REFRIGERADO') volumes = 1;
    if (temperatura === 'AMBIENTE + CONGELADO' || temperatura === 'AMBIENTE + REFRIGERADO') volumes = 2;
    if (temperatura === 'AMBIENTE') peso = transporteConfigNumber_('Peso MARKEN ambiente (kg)', 1) + ' Kg';
    else if (temperatura === 'CONGELADO' || temperatura === 'REFRIGERADO') peso = transporteConfigNumber_('Peso MARKEN refrigerado/congelado (kg)', 5) + ' Kg';
    else if (temperatura === 'AMBIENTE + CONGELADO' || temperatura === 'AMBIENTE + REFRIGERADO') peso = transporteConfigNumber_('Peso MARKEN misto (kg)', 6) + ' Kg';
    invoice.getRange('O12').setValue(volumes);
    invoice.getRange('T39').setValue(volumes);
    invoice.getRange('T41').setValue(peso);
  } catch (error) {
    transporteRegistrarAviso_('atualizarMarkenVolumes_');
    Logger.log('Falha de preenchimento em atualizarMarkenVolumes_.');
  }
}

function atualizarEmailMarkenB8_(ss) {
  // Este no-op preserva o retorno incondicional existente.
  return;
}

function atualizarPeticaoAnuencia_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var declaracao = transporteCodexGetSheet_(ss, 'declaracaoTransp', false);
    var peticao = transporteCodexGetSheet_(ss, 'peticaoAnuencia', false);
    var invoiceMarken = transporteCodexGetSheet_(ss, 'invoiceMarken', false);
    if (!declaracao) return;

    var checked = declaracao.getRange('B21:B28').getValues();
    var volumes = declaracao.getRange('N21:N28').getValues();
    var nomes = ['Sangue', 'Soro', 'Urina', 'Plasma', 'Tecido', 'Saliva', 'Fezes', 'Vacina'];
    var unidades = ['mL', 'mL', 'mL', 'mL', 'g', 'mL', 'g', 'mL'];
    var todasLinhas = [];
    for (var i = 0; i < checked.length; i++) {
      if (checked[i][0] !== true) continue;
      todasLinhas.push(nomes[i] + ': ' + transporteCodexVolume_(volumes[i][0]) + ' ' + unidades[i]);
    }
    var outros = String(getCellValueSafe(declaracao, 'F30') || '').trim();
    if (outros) todasLinhas.push(outros);
    var linhas = todasLinhas.slice(0, 6);
    var truncadas = todasLinhas.slice(6);
    while (linhas.length < 6) linhas.push('');

    if (truncadas.length) {
      Logger.log('atualizarPeticaoAnuencia_: ' + truncadas.length + ' material(is) excedente(s) nao exibido(s) em K30:K35: ' + truncadas.join('; '));
    }
    if (peticao) {
      var peticaoRange = peticao.getRange('K30:K35');
      peticaoRange.setValues(linhas.map(function(v) { return [v]; }));
      peticaoRange.clearNote();
      if (truncadas.length) {
        peticao.getRange('K35').setNote('Materiais adicionais nao exibidos no limite de 6 linhas: ' + truncadas.join('; '));
      }
    }
    if (invoiceMarken) {
      invoiceMarken.getRange('G36').setValue(todasLinhas.filter(Boolean).join('; '));
      invoiceMarken.getRange('M28').setValue(todasLinhas.filter(Boolean).join('; '));
    }
  } catch (error) {
    transporteRegistrarAviso_('atualizarPeticaoAnuencia_');
    Logger.log('Falha de preenchimento em atualizarPeticaoAnuencia_.');
  }
}

function atualizarFormularioPinex_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var declaracao = transporteCodexGetSheet_(ss, 'declaracaoTransp', false);
    var formulario = transporteCodexGetSheet_(ss, 'formularioPinex', false);
    if (!folha || !declaracao || !formulario) return;

    var iniciais = extrairIniciais_(getCellValueSafe(folha, 'C3'));
    var temperatura = getCellValueSafe(folha, 'C6');
    var checked = declaracao.getRange('B21:B28').getValues();
    var formulas = declaracao.getRange('J21:L28').getValues().map(function(row) {
      return [row[0] || row[1] || row[2] || ''];
    });
    var nomes = ['Sangue', 'Soro', 'Urina', 'Plasma', 'Tecido', 'Saliva', 'Fezes', 'Vacina'];
    var values = [];

    for (var i = 0; i < checked.length; i++) {
      if (checked[i][0] !== true) continue;
      var parsed = transporteParseFormula_(formulas[i][0]);
      var unidade = (nomes[i] === 'Tecido' || nomes[i] === 'Fezes') ? 'g' : 'mL';
      if (parsed.segmentos && parsed.segmentos.length) {
        parsed.segmentos.forEach(function(seg) {
          values.push([
            iniciais || '',
            temperatura || '',
            nomes[i],
            seg.qtd || '',
            transporteFormatNumberPt_(seg.vol, 1) + ' ' + unidade
          ]);
        });
      } else {
        values.push([iniciais || '', temperatura || '', nomes[i], parsed.tubos || '', parsed.total ? transporteFormatNumberPt_(parsed.total, 1) + ' ' + unidade : '']);
      }
    }

    var outros = String(getCellValueSafe(declaracao, 'F30') || '').trim();
    if (outros) {
      var matchLaminas = outros.match(/(\d+)\s*(?:l[aÃ¢Ã£]mina|lamina|slide)/i);
      if (transporteNorm_(outros).indexOf('lamina') >= 0 && matchLaminas) {
        values.push([iniciais || '', temperatura || '', 'LÃ¢mina', Number(matchLaminas[1]) || matchLaminas[1], '---']);
      } else {
        values.push([iniciais || '', temperatura || '', outros, '', '---']);
      }
    }
    while (values.length < 20) values.push(['', '', '', '', '']);
    formulario.getRange('A42:E61').setValues(values.slice(0, 20));
    processarHorarioColeta_(ss, folha, getCellValueSafe(folha, 'C9'));
  } catch (error) {
    transporteRegistrarAviso_('atualizarFormularioPinex_');
    Logger.log('Falha de preenchimento em atualizarFormularioPinex_.');
  }
}

function processarHorarioColeta_(ss, folhaSheet, value) {
  try {
    var formulario = transporteCodexGetSheet_(ss || getTransporteSpreadsheetCodex_(), 'formularioPinex', false);
    if (!formulario) return;
    var match = String(value || '').match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
    formulario.getRange('D21').setValue(match ? match[1] : '');
    formulario.getRange('D22').setValue(match ? match[2] : '');
  } catch (error) {
    transporteRegistrarAviso_('processarHorarioColeta_');
    Logger.log('Falha de preenchimento em processarHorarioColeta_.');
  }
}

function atualizarCommercialInvoicePinex_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var invoice = transporteCodexGetSheet_(ss, 'invoicePinex', false);
    if (!folha || !invoice) return;
    var data = getCellValueSafe(folha, 'C8');
    if (!(data instanceof Date)) {
      invoice.getRangeList(['E8', 'E9']).clearContent();
      return;
    }
    invoice.getRange('E8').setValue(Utilities.formatDate(data, Session.getScriptTimeZone(), 'MMMM dd, yyyy'));
    var seguinte = new Date(data.getTime());
    seguinte.setDate(seguinte.getDate() + 1);
    seguinte.setHours(14, 0, 0, 0);
    invoice.getRange('E9').setValue(Utilities.formatDate(seguinte, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
  } catch (error) {
    transporteRegistrarAviso_('atualizarCommercialInvoicePinex_');
    Logger.log('Falha de preenchimento em atualizarCommercialInvoicePinex_.');
  }
}

function atualizarCommercialInvoicePinexB33_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var declaracao = transporteCodexGetSheet_(ss, 'declaracaoTransp', false);
    var invoice = transporteCodexGetSheet_(ss, 'invoicePinex', false);
    if (!folha || !declaracao || !invoice) return;
    var paciente = String(getCellValueSafe(folha, 'C3') || '').trim();
    var checked = declaracao.getRange('B21:B28').getValues();
    var tubosPorMaterial = declaracao.getRange('H21:H28').getValues();
    var volumes = declaracao.getRange('N21:N28').getValues();
    var outros = String(getCellValueSafe(declaracao, 'F30') || '');
    invoice.getRange('B33').setValue(transportePinexSampleSummary_(paciente, checked, tubosPorMaterial, volumes, outros));
  } catch (error) {
    transporteRegistrarAviso_('atualizarCommercialInvoicePinexB33_');
    Logger.log('Falha de preenchimento em atualizarCommercialInvoicePinexB33_.');
  }
}

function transportePinexSampleSummary_(paciente, checked, tubosPorMaterial, volumes, outros) {
  var iniciais = extrairIniciais_(paciente) || String(paciente || '').trim();
  var pacienteResumo = iniciais ? 'Patient ' + iniciais : 'Patient';
  var unidadesGramas = { 4: true, 6: true };
  var totalTubos = 0;
  var totalMl = 0;
  var totalG = 0;

  for (var i = 0; i < 8; i++) {
    if (!checked[i] || checked[i][0] !== true) continue;
    var tubos = transporteNumber_(tubosPorMaterial[i] && tubosPorMaterial[i][0], true);
    var volume = transporteNumber_(volumes[i] && volumes[i][0]);
    totalTubos += tubos;
    if (unidadesGramas[i]) totalG += volume;
    else totalMl += volume;
  }

  outros = String(outros || '');
  var outrosNorm = transporteNorm_(outros);
  var slideMatch = outros.match(/(\d+)\s*(?:slides?|l[aÃ¢Ã£]?minas?|laminas?)/i);
  var slides = (outrosNorm.indexOf('lamina') >= 0 || outrosNorm.indexOf('slide') >= 0) && slideMatch
    ? transporteNumber_(slideMatch[1], true)
    : 0;
  function formatEn(value) {
    var number = transporteNumber_(value);
    return number ? number.toFixed(2) : '0';
  }

  return pacienteResumo + ' - ' + totalTubos + ' tube(s) of human bio sample - Total ' + formatEn(totalMl) +
    ' mL / ' + slides + ' slide(s) / ' + formatEn(totalG) + ' g';
}

function transportePinexInvestigatorSummary_(investigador, conselho) {
  var nome = String(investigador || '').trim();
  if (!nome) return '';
  var nomeComTitulo = /^dr(?:\(a\))?\.?\s/i.test(nome) ? nome : 'Dr(a). ' + nome;
  var cremers = String(conselho || '').trim()
    .replace(/^(?:CREMERS|CRM\s*\/?\s*RS)\s*[:.-]?\s*/i, '');
  return 'Investigador Principal: ' + nomeComTitulo +
    (cremers ? ' - CREMERS: ' + cremers : '') + '.';
}

function atualizarCommercialInvoicePinexB34_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var declaracao = transporteCodexGetSheet_(ss, 'declaracaoTransp', false);
    var invoice = transporteCodexGetSheet_(ss, 'invoicePinex', false);
    if (!folha || !invoice) return;
    var investigador = String(getCellValueSafe(folha, 'C5') || '').trim();
    var medico = transporteMedicoByNome_(investigador);
    var conselho = String((medico && medico.cremers) ||
      (declaracao ? getCellValueSafe(declaracao, 'M10') : '') || '').trim();
    invoice.getRange('B34').setValue(transportePinexInvestigatorSummary_(
      (medico && medico.nome) || investigador,
      conselho
    ));
  } catch (error) {
    transporteRegistrarAviso_('atualizarCommercialInvoicePinexB34_');
    Logger.log('Falha de preenchimento em atualizarCommercialInvoicePinexB34_.');
  }
}

function atualizarCommercialInvoicePinexTemperatura_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var invoice = transporteCodexGetSheet_(ss, 'invoicePinex', false);
    if (!folha || !invoice) return;
    var temperatura = String(getCellValueSafe(folha, 'C6') || '').trim();
    var texto = '';
    var volumes = '';
    if (temperatura === 'AMBIENTE') {
      texto = 'Ambient';
      volumes = 1;
    } else if (temperatura === 'REFRIGERADO') {
      texto = 'Refrigerated';
      volumes = 1;
    } else if (temperatura === 'CONGELADO') {
      texto = 'Frozen';
      volumes = 1;
    } else if (temperatura === 'AMBIENTE + CONGELADO') {
      texto = 'Ambient + Frozen';
      volumes = 2;
    } else if (temperatura === 'AMBIENTE + REFRIGERADO') {
      texto = 'Ambient + Refrigerated';
      volumes = 2;
    }
    invoice.getRange('E44').setValue(texto);
    invoice.getRange('E46').setValue(volumes);
  } catch (error) {
    transporteRegistrarAviso_('atualizarCommercialInvoicePinexTemperatura_');
    Logger.log('Falha de preenchimento em atualizarCommercialInvoicePinexTemperatura_.');
  }
}

function atualizarPinexColNumero_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var folhaDhl = transporteCodexGetSheet_(ss, 'folhaDhlPinex', false);
    if (!folha || !folhaDhl) return;
    var courier = String(getCellValueSafe(folha, 'C10') || '').trim();
    if (courier === 'PINEX' || courier === 'PINEX (Agendamento)') return;
    folhaDhl.getRange('C13').setValue('---');
  } catch (error) {
    transporteRegistrarAviso_('atualizarPinexColNumero_');
    Logger.log('Falha de preenchimento em atualizarPinexColNumero_.');
  }
}

function atualizarPeticaoPinexTemperatura_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var peticao = transporteCodexGetSheet_(ss, 'peticaoPinex', false);
    if (!folha || !peticao) return;
    var temperatura = String(getCellValueSafe(folha, 'C6') || '').trim();
    peticao.getRangeList(['G31', 'L31', 'O31']).setValue(false);
    if (temperatura === 'AMBIENTE') peticao.getRange('G31').setValue(true);
    if (temperatura === 'CONGELADO') peticao.getRange('L31').setValue(true);
    if (temperatura === 'REFRIGERADO') peticao.getRange('O31').setValue(true);
    if (temperatura === 'AMBIENTE + CONGELADO') peticao.getRangeList(['G31', 'L31']).setValue(true);
    if (temperatura === 'AMBIENTE + REFRIGERADO') peticao.getRangeList(['G31', 'O31']).setValue(true);
  } catch (error) {
    transporteRegistrarAviso_('atualizarPeticaoPinexTemperatura_');
    Logger.log('Falha de preenchimento em atualizarPeticaoPinexTemperatura_.');
  }
}

function atualizarPesoGeloDeclaracao_(ss) {
  return verificarEAtualizarG33Declaracao_(ss);
}

function atualizarCommercialInvoicePinexE48_(ss) {
  try {
    ss = ss || getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var folhaDhl = transporteCodexGetSheet_(ss, 'folhaDhlPinex', false);
    var invoice = transporteCodexGetSheet_(ss, 'invoicePinex', false);
    if (!folha || !invoice) return;
    var courier = folhaDhl ? String(getCellValueSafe(folhaDhl, 'C10') || '').trim() : String(getCellValueSafe(folha, 'C10') || '').trim();
    var temperatura = String(getCellValueSafe(folha, 'C6') || '').trim();
    var valor = courier === 'PINEX' && (temperatura === 'CONGELADO' || temperatura === 'AMBIENTE + CONGELADO')
      ? transporteConfigNumber_('Peso PINEX congelado (kg)', 4) : transporteConfigNumber_('Peso PINEX padrão (kg)', 1);
    invoice.getRange('E48').setValue(valor);
  } catch (error) {
    transporteRegistrarAviso_('atualizarCommercialInvoicePinexE48_');
    Logger.log('Falha de preenchimento em atualizarCommercialInvoicePinexE48_.');
  }
}

function manageSheetVisibilityUnified_(ss, enableAudit) {
  return transporteCodexManageVisibility_(ss || getTransporteSpreadsheetCodex_());
}

function transporteCodexManageVisibility_(ss) {
  try {
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    if (!folha) return false;
    var courier = String(getCellValueSafe(folha, 'C10') || '').trim();
    var temperatura = String(getCellValueSafe(folha, 'C6') || '').trim();
    var keep = ['Folha de Agendamento'];
    if (courier === 'OCASA') {
      keep = keep.concat(['DeclaraÃƒÂ§ÃƒÂ£o de Transporte', 'PetiÃƒÂ§ÃƒÂ£o de AnuÃƒÂªncia de ExportaÃƒÂ§ÃƒÂ£o', 'Ficha de EmergÃƒÂªncia (OCASA)', 'Telefones ÃƒÅ¡teis (OCASA)']);
      if (temperatura.indexOf('CONGELADO') === -1) keep.push('Proforma Invoice (OCASA)');
    } else if (courier === 'MARKEN') {
      keep = keep.concat(['DeclaraÃƒÂ§ÃƒÂ£o de Transporte', 'PetiÃƒÂ§ÃƒÂ£o de AnuÃƒÂªncia de ExportaÃƒÂ§ÃƒÂ£o', 'Ficha de EmergÃƒÂªncia (MARKEN)']);
      if (temperatura.indexOf('CONGELADO') === -1) keep.push('Invoice (MARKEN)');
    } else if (transporteIsDhl_(courier)) {
      keep = keep.concat(['Folha de Agendamento (DHL/PINEX)', 'DeclaraÃƒÂ§ÃƒÂ£o (DHL)', 'Invoice (DHL)', 'DeclaraÃƒÂ§ÃƒÂ£o de Transporte (DHL)']);
    } else if (courier === 'PINEX') {
      keep = keep.concat(['Folha de Agendamento (DHL/PINEX)', 'Commercial Invoice (PINEX)', 'PetiÃƒÂ§ÃƒÂ£o de AnuÃƒÂªncia de ExportaÃƒÂ§ÃƒÂ£o (PINEX)', 'USDA Statement (PINEX)', 'Ficha de EmergÃƒÂªncia (PINEX)', 'DeclaraÃƒÂ§ÃƒÂ£o de Transporte']);
    } else if (courier === 'PINEX (Agendamento)') {
      keep = keep.concat(['FormulÃƒÂ¡rio (PINEX)']);
    } else {
      keep = keep.concat(['DeclaraÃƒÂ§ÃƒÂ£o de Transporte']);
    }

    keep = keep.concat(transporteCodexVisibilityNamesByCourierUtf8_(courier, temperatura));
    var normalizedKeep = transporteCodexExpandVisibilityNames_(keep).map(transporteSheetNameKey_);
    var sheets = ss.getSheets();
    var visibleCount = sheets.filter(function(sheet) { return !sheet.isSheetHidden(); }).length;
    sheets.forEach(function(sheet) {
      var shouldShow = normalizedKeep.indexOf(transporteSheetNameKey_(sheet.getName())) >= 0;
      try {
        if (shouldShow) {
          if (sheet.isSheetHidden()) {
            sheet.showSheet();
            visibleCount++;
          }
        } else if (!sheet.isSheetHidden() && visibleCount > 1) {
          sheet.hideSheet();
          visibleCount--;
        }
      } catch (e) {
        Logger.log('Visibilidade ignorada em ' + sheet.getName() + ': ' + e.message);
      }
    });
    return true;
  } catch (error) {
    transporteRegistrarAviso_('manageSheetVisibilityUnified_');
    Logger.log('Falha de preenchimento em manageSheetVisibilityUnified_.');
    return false;
  }
}

function transporteCodexExpandVisibilityNames_(names) {
  var aliases = {
    'DeclaraÃ§Ã£o de Transporte': ['DeclaraÃ§Ã£o de Transporte', 'Declaracao de Transporte'],
    'PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o': ['PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o', 'Peticao de Anuencia de Exportacao'],
    'Ficha de EmergÃªncia (OCASA)': ['Ficha de EmergÃªncia (OCASA)', 'Ficha de Emergencia (OCASA)'],
    'Ficha de EmergÃªncia (MARKEN)': ['Ficha de EmergÃªncia (MARKEN)', 'Ficha de Emergencia (MARKEN)'],
    'Telefones Ãšteis (OCASA)': ['Telefones Ãšteis (OCASA)', 'Telefones Uteis (OCASA)'],
    'DeclaraÃ§Ã£o (DHL)': ['DeclaraÃ§Ã£o (DHL)', 'Declaracao (DHL)'],
    'DeclaraÃ§Ã£o de Transporte (DHL)': ['DeclaraÃ§Ã£o de Transporte (DHL)', 'Declaracao de Transporte (DHL)'],
    'PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o (PINEX)': ['PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o (PINEX)', 'Peticao de Anuencia de Exportacao (PINEX)'],
    'Ficha de EmergÃªncia (PINEX)': ['Ficha de EmergÃªncia (PINEX)', 'Ficha de Emergencia (PINEX)'],
    'FormulÃ¡rio (PINEX)': ['FormulÃ¡rio (PINEX)', 'Formulario (PINEX)']
  };
  var out = [];
  (names || []).forEach(function(name) {
    out.push(name);
    var key = transporteSheetNameKey_(name);
    Object.keys(aliases).forEach(function(aliasName) {
      if (transporteSheetNameKey_(aliasName) === key) out = out.concat(aliases[aliasName]);
    });
  });
  return out;
}

function transporteCodexVisibilityNamesByCourier_(courier, temperatura) {
  var keep;
  if (courier === 'OCASA') {
    keep = ['DeclaraÃ§Ã£o de Transporte', 'PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o', 'Ficha de EmergÃªncia (OCASA)', 'Telefones Ãšteis (OCASA)'];
    if (String(temperatura || '').indexOf('CONGELADO') === -1) keep.push('Proforma Invoice (OCASA)');
  } else if (courier === 'MARKEN') {
    keep = ['DeclaraÃ§Ã£o de Transporte', 'PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o', 'Ficha de EmergÃªncia (MARKEN)'];
    if (String(temperatura || '').indexOf('CONGELADO') === -1) keep.push('Invoice (MARKEN)');
  } else if (transporteIsDhl_(courier)) {
    keep = ['Folha de Agendamento (DHL/PINEX)', 'DeclaraÃ§Ã£o (DHL)', 'Invoice (DHL)', 'DeclaraÃ§Ã£o de Transporte (DHL)'];
  } else if (courier === 'PINEX') {
    keep = ['Folha de Agendamento (DHL/PINEX)', 'Commercial Invoice (PINEX)', 'PetiÃ§Ã£o de AnuÃªncia de ExportaÃ§Ã£o (PINEX)', 'USDA Statement (PINEX)', 'Ficha de EmergÃªncia (PINEX)', 'DeclaraÃ§Ã£o de Transporte'];
  } else if (courier === 'PINEX (Agendamento)') {
    keep = ['FormulÃ¡rio (PINEX)'];
  } else {
    keep = ['DeclaraÃ§Ã£o de Transporte'];
  }
  return keep;
}

function transporteCodexVisibilityNamesByCourierUtf8_(courier, temperatura) {
  var temp = String(temperatura || '');
  if (courier === 'OCASA') {
    var ocasa = ['Declara\u00e7\u00e3o de Transporte', 'Peti\u00e7\u00e3o de Anu\u00eancia de Exporta\u00e7\u00e3o', 'Ficha de Emerg\u00eancia (OCASA)', 'Telefones \u00dateis (OCASA)'];
    if (temp.indexOf('CONGELADO') === -1) ocasa.push('Proforma Invoice (OCASA)');
    return ocasa;
  }
  if (courier === 'MARKEN') {
    var marken = ['Declara\u00e7\u00e3o de Transporte', 'Peti\u00e7\u00e3o de Anu\u00eancia de Exporta\u00e7\u00e3o', 'Ficha de Emerg\u00eancia (MARKEN)'];
    if (temp.indexOf('CONGELADO') === -1) marken.push('Invoice (MARKEN)');
    return marken;
  }
  if (transporteIsDhl_(courier)) {
    return ['Folha de Agendamento (DHL/PINEX)', 'Declara\u00e7\u00e3o (DHL)', 'Invoice (DHL)', 'Declara\u00e7\u00e3o de Transporte (DHL)'];
  }
  if (courier === 'PINEX') {
    return ['Folha de Agendamento (DHL/PINEX)', 'Commercial Invoice (PINEX)', 'Peti\u00e7\u00e3o de Anu\u00eancia de Exporta\u00e7\u00e3o (PINEX)', 'USDA Statement (PINEX)', 'Ficha de Emerg\u00eancia (PINEX)', 'Declara\u00e7\u00e3o de Transporte'];
  }
  if (courier === 'PINEX (Agendamento)') return ['Formul\u00e1rio (PINEX)'];
  return ['Declara\u00e7\u00e3o de Transporte'];
}

function performContentDeletion_() {
  var ss = getTransporteSpreadsheetCodex_();
  var erro = false;
  try {
    var declaracao = transporteCodexGetSheet_(ss, 'declaracaoTransp', false);
    if (declaracao) {
      declaracao.getRangeList(['H21:H28', 'J21:L28', 'N21:N28', 'F30', 'F32', 'H32', 'J32']).clearContent();
      declaracao.getRange('B21:B28').setValue(false);
    }
  } catch (e1) {
    erro = true;
    Logger.log('Erro limpando DeclaraÃƒÂ§ÃƒÂ£o: ' + e1.toString());
  }
  try {
    var peticao = transporteCodexGetSheet_(ss, 'peticaoAnuencia', false);
    if (peticao) {
      peticao.getRangeList(['K28', 'N28', 'B30:R35', 'F38:F41', 'B44:B46']).clearContent();
      peticao.getRange('G28').setValue(false);
    }
  } catch (e2) {
    erro = true;
    Logger.log('Erro limpando PetiÃƒÂ§ÃƒÂ£o: ' + e2.toString());
  }
  try {
    var proforma = transporteCodexGetSheet_(ss, 'proformaOcasa', false);
    if (proforma) proforma.getRange('B27').clearContent();
    var invoiceDhl = transporteCodexGetSheet_(ss, 'invoiceDhl', false);
    if (invoiceDhl) invoiceDhl.getRangeList(['P10', 'J30']).clearContent();
    var declaracaoDhl = transporteCodexGetSheet_(ss, 'declaracaoTranspDhl', false);
    if (declaracaoDhl) declaracaoDhl.getRangeList(['F18', 'F19', 'F20', 'F21']).clearContent();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    if (folha) {
      folha.getRange('C3:C15').clearContent();
      folha.getRange('C15').clearNote();
    }
    var folhaDhl = transporteCodexGetSheet_(ss, 'folhaDhlPinex', false);
    if (folhaDhl) folhaDhl.getRange('C13').clearContent();
    var formulario = transporteCodexGetSheet_(ss, 'formularioPinex', false);
    if (formulario) formulario.getRange('A42:E61').clearContent();
  } catch (e3) {
    erro = true;
    Logger.log('Erro limpando abas secundarias: ' + e3.toString());
  }
  SpreadsheetApp.flush();
  return erro ? 'WARN_SOME_ERRORS' : 'OK';
}

function criarRascunhoEmail_(options) {
  try {
    options = options || {};
    var ss = getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', true);
    var cfg = folha.getRange('C4:C12').getValues();
    var projeto = transporteProjetoDisplay_(cfg[0][0]);
    var investigador = cfg[1][0];
    var temperatura = cfg[2][0];
    var dataColeta = cfg[3][0];
    var dataEnvio = cfg[4][0];
    var janelaEnvio = cfg[5][0];
    var courier = cfg[6][0];
    var laboratorio = cfg[7][0];
    var awb = cfg[8][0];
    var agendadoPor = String(options.agendadoPor || folha.getRange('C13').getDisplayValue() || '').trim();
    var refInterna = String(options.monitorRef || folha.getRange('C15').getDisplayValue() || '').trim();
    var draftGuard = transporteAssertGmailDraftAllowed_({
      requestedByEmail: options.requestedByEmail || '',
      agendadoPor: agendadoPor
    });
    if (!draftGuard.ok) return draftGuard;
    var activeEmail = draftGuard.activeUserEmail || transporteActiveUserEmail_();
    var effectiveEmail = draftGuard.userEmail || transporteEffectiveUserEmail_();
    var requestedByEmail = draftGuard.requestedByEmail || '';
    var saudacao = transporteCodexSaudacao_();
    var assunto = courier === 'PINEX (Agendamento)'
      ? projeto + ' - ' + transporteCodexFormatDateTitle_(dataEnvio) + ' - ' + laboratorio + ' - AGENDAMENTO DE COLETA'
      : projeto + ' - ' + awb + ' - ' + transporteCodexFormatDateTitle_(dataEnvio) + ' - ' + laboratorio + ' - AGENDAMENTO DE COLETA';
    var destinatarios = [];
    var html = '';
    if (courier === 'PINEX (Agendamento)') {
      destinatarios = transporteCourierEmailRecipients_(courier, temperatura);
      html = '<p>Prezados,</p><p>' + saudacao + ',</p><p>Seguem anexos os dados para agendamento de coleta (CNPJ : ' + transporteCodexEmailEsc_(transporteCnpjTexto_()) + ').</p>';
    } else if (courier === 'OCASA') {
      destinatarios = transporteCourierEmailRecipients_(courier, temperatura);
      html = transporteCodexEmailHtml_(ss, 'emailOcasa', 'OCASA', saudacao);
    } else if (courier === 'MARKEN') {
      destinatarios = transporteCourierEmailRecipients_(courier, temperatura);
      html = transporteCodexEmailHtml_(ss, 'emailMarken', 'MARKEN', saudacao) || transporteCodexEmailFallbackHtml_(projeto, dataEnvio, laboratorio, awb, courier, saudacao);
    } else if (transporteIsDhl_(courier)) {
      destinatarios = transporteCourierEmailRecipients_(courier, temperatura);
      html = transporteCodexEmailDhlHtml_(projeto, dataColeta, janelaEnvio, dataEnvio, investigador, laboratorio, awb, temperatura, transporteReadSolicitarCaixa_(ss, courier, temperatura), saudacao);
    } else if (courier === 'PINEX') {
      return {
        ok: true,
        skipped: true,
        message: 'Rascunho nao criado para PINEX; anexe os documentos na thread original do agendamento.',
        userEmail: effectiveEmail,
        activeUserEmail: activeEmail,
        requestedByEmail: requestedByEmail
      };
    } else {
      return {
        ok: false,
        message: 'Transportadora sem rascunho configurado: ' + (courier || '-'),
        error: 'COURIER_DRAFT_NOT_CONFIGURED',
        userEmail: effectiveEmail,
        activeUserEmail: activeEmail,
        requestedByEmail: requestedByEmail
      };
    }
    var remetente = transporteActiveUserEmail_();
    var cc = transporteDraftCcRecipients_(remetente);
    var attachments = (transporteIsDhl_(courier) || courier === 'PINEX (Agendamento)') ? [] : transporteCodexEmailAttachments_(ss, projeto);
    if (courier === 'PINEX (Agendamento)' && options.pdfFileId) {
      try {
        attachments.push(DriveApp.getFileById(options.pdfFileId).getBlob());
      } catch (pdfAttachError) {
        Logger.log('PDF PINEX nao anexado ao rascunho: ' + pdfAttachError.toString());
      }
    }
    var htmlBody = transporteCodexFixMojibakeText_(transporteCodexEmailWrap_(html + '<p>Atenciosamente,</p>') + getGmailSignature() + transporteMonitorRefHtml_(refInterna, options.pdfHash));
    var draftOptions = {
      htmlBody: htmlBody,
      attachments: attachments
    };
    if (cc.length) draftOptions.cc = cc.join(', ');
    transporteGenerationCheckpoint_({ phase: 'DRAFT_INTENT' });
    var draft = GmailApp.createDraft(destinatarios.join(', '), assunto, '', draftOptions);
    var draftId = '';
    try {
      draftId = draft && draft.getId ? String(draft.getId() || '') : '';
    } catch (draftIdError) {
      draftId = '';
    }
    if (TRANSPORTE_GENERATION_REQUEST_) {
      if (!draftId) throw new Error('Rascunho criado sem confirmação do ID. Confira o Gmail.');
      transporteGenerationCheckpoint_({ phase: 'DRAFT_READY', draft: { ok: true, draftId: draftId, message: 'Rascunho recuperado.', userEmail: effectiveEmail, activeUserEmail: activeEmail, requestedByEmail: requestedByEmail } });
    }
    return {
      ok: true,
      message: 'Rascunho criado com sucesso! Preserve a referência IPS-TRP no corpo ao enviar.',
      draftId: draftId,
      monitorRef: refInterna,
      subject: assunto,
      recipients: destinatarios.join(', '),
      userEmail: transporteEffectiveUserEmail_(),
      activeUserEmail: transporteActiveUserEmail_(),
      requestedByEmail: requestedByEmail
    };
  } catch (error) {
    Logger.log('Erro em criarRascunhoEmail: ' + error.toString());
    return {
      ok: false,
      message: 'Erro ao criar rascunho: ' + error.toString(),
      error: error.toString(),
      authUrl: transporteGmailAuthorizationUrl_(),
      userEmail: transporteEffectiveUserEmail_(),
      activeUserEmail: transporteActiveUserEmail_(),
      requestedByEmail: options && options.requestedByEmail ? transporteNormalizeEmail_(options.requestedByEmail) : ''
    };
  }
}

function transporteGmailAuthorizationUrl_() {
  var status = transporteGmailOAuthStatus_();
  return status.required ? status.url : '';
}

function transporteDraftCcRecipients_(remetente) {
  var configured = [];
  if (typeof getConfigAppValuesByKeys_ === 'function') {
    configured = getConfigAppValuesByKeys_(
      ['Transporte', 'Agenda'],
      [
        'CC rascunho courier',
        'CC rascunho e-mail courier',
        'Destinatarios CC courier',
        'Destinatários CC courier',
        'E-mails em copia courier',
        'E-mails em cópia courier'
      ],
      []
    );
  }
  var source = configured || [];
  var remetenteNorm = transporteNormalizeEmail_(remetente);
  var seen = {};
  var out = [];
  source.forEach(function(value) {
    String(value || '').split(/[;,]/).forEach(function(email) {
      email = String(email || '').trim();
      var key = transporteNormalizeEmail_(email);
      if (!key || key === remetenteNorm || seen[key]) return;
      seen[key] = true;
      out.push(email);
    });
  });
  return out;
}

function transporteAssertGmailDraftAllowed_(options) {
  options = options || {};
  var activeEmail = transporteNormalizeEmail_(transporteActiveUserEmail_());
  var effectiveEmail = transporteNormalizeEmail_(transporteEffectiveUserEmail_());
  var agendadoPor = String(options.agendadoPor || '').trim();
  var responsavelEmail = transporteResolveUserEmail_(agendadoPor);
  var sessionEmail = transporteNormalizeEmail_(options.requestedByEmail || activeEmail || effectiveEmail);
  var requestedByEmail = transporteNormalizeEmail_(responsavelEmail || sessionEmail);

  if (!requestedByEmail) {
    return {
      ok: false,
      message: 'O rascunho nao foi criado porque nao foi possivel identificar o e-mail do responsavel pelo agendamento nem o e-mail do usuario conectado. Cadastre/selecione um usuario com e-mail em "Agendado por" ou autorize novamente o WebApp.',
      error: 'DRAFT_REQUESTER_NOT_RESOLVED',
      authUrl: '',
      userEmail: effectiveEmail,
      activeUserEmail: activeEmail,
      requestedByEmail: ''
    };
  }
  if (activeEmail && effectiveEmail && activeEmail !== effectiveEmail) {
    return {
      ok: false,
      message: 'O rascunho nao foi criado porque a conta executora difere do usuário conectado. Confira a implantação USER_ACCESSING e autorize novamente o WebApp.',
      error: 'EXECUTION_USER_MISMATCH',
      authUrl: '',
      userEmail: effectiveEmail,
      activeUserEmail: activeEmail,
      requestedByEmail: requestedByEmail
    };
  }
  if (effectiveEmail && requestedByEmail !== effectiveEmail) {
    return {
      ok: false,
      message: responsavelEmail ? 'O rascunho não foi criado porque "Agendado por" corresponde a outro usuário. O responsável deve abrir o Transporte na própria conta para criar o rascunho no seu Gmail.' : 'O rascunho não foi criado porque a conta solicitante difere da conta executora. Reabra o Transporte na conta solicitante.',
      error: responsavelEmail ? 'DRAFT_RESPONSIBLE_MISMATCH' : 'DRAFT_REQUESTER_MISMATCH',
      authUrl: '',
      userEmail: effectiveEmail,
      activeUserEmail: activeEmail,
      requestedByEmail: requestedByEmail
    };
  }
  var gmailAuth = transporteGmailOAuthStatus_();
  if (gmailAuth.required) {
    return {
      ok: false,
      message: 'Autorizacao do Gmail pendente para criar rascunhos. Abra o link de autorizacao e tente gerar novamente.',
      error: 'GMAIL_AUTH_REQUIRED',
      authUrl: gmailAuth.url || '',
      userEmail: effectiveEmail,
      activeUserEmail: activeEmail,
      requestedByEmail: requestedByEmail
    };
  }
  if (gmailAuth.ok === false) {
    return {
      ok: false,
      message: 'Nao foi possivel verificar a autorizacao do Gmail: ' + (gmailAuth.error || 'erro desconhecido'),
      error: 'GMAIL_AUTH_CHECK_FAILED',
      authUrl: gmailAuth.url || '',
      userEmail: effectiveEmail,
      activeUserEmail: activeEmail,
      requestedByEmail: requestedByEmail
    };
  }
  return {
    ok: true,
    message: '',
    authUrl: '',
    userEmail: effectiveEmail,
    activeUserEmail: activeEmail,
    requestedByEmail: requestedByEmail
  };
}

function transporteResolveUserEmail_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var direct = transporteNormalizeEmail_(raw);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct)) return direct;
  var wanted = transporteNorm_(raw);
  try {
    if (typeof codexGetAllowedUsers_ === 'function') {
      var acl = codexGetAllowedUsers_() || {};
      var keys = Object.keys(acl);
      for (var j = 0; j < keys.length; j++) {
        var item = acl[keys[j]] || {};
        var fullName = transporteNorm_(item.name || '');
        var firstName = transporteNorm_(item.firstName || '');
        if (fullName === wanted || firstName === wanted || (wanted.length >= 3 && fullName.indexOf(wanted) >= 0)) {
          return transporteNormalizeEmail_(keys[j]);
        }
      }
    }
  } catch (aclError) {
    Logger.log('ACL nao resolvida para rascunho de transporte: ' + aclError.toString());
  }
  return '';
}

function transporteGmailOAuthStatus_() {
  var scopes = [
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/gmail.settings.basic'
  ];
  try {
    var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, scopes);
    var status = info.getAuthorizationStatus();
    var required = status === ScriptApp.AuthorizationStatus.REQUIRED;
    return {
      ok: true,
      required: required,
      status: String(status || ''),
      url: required ? info.getAuthorizationUrl() : '',
      scopes: scopes
    };
  } catch (e) {
    Logger.log('Status de autorizacao Gmail nao obtido: ' + e.toString());
    return {
      ok: false,
      required: false,
      status: 'UNKNOWN',
      url: '',
      error: e.message || String(e),
      scopes: scopes
    };
  }
}

function transporteCodexEmailWrap_(html) {
  return '<div class="transporte-email-body" style="font-family:Arial,sans-serif;line-height:1.75;color:#222;">'
    + '<style>.transporte-email-body p{margin:0 0 22px 0;line-height:1.75;}.transporte-email-body table{margin:22px 0 24px 0;}.transporte-email-body td{line-height:1.45;}</style>'
    + transporteCodexEmailInlineTableSpacing_(transporteCodexEmailInlineParagraphSpacing_(html || ''))
    + '</div>';
}

function transporteCodexEmailInlineParagraphSpacing_(html) {
  return String(html || '').replace(/<p(\s[^>]*)?>/gi, function(tag, attrs) {
    attrs = attrs || '';
    if (/style\s*=/i.test(attrs)) {
      return '<p' + attrs.replace(/style=(["'])(.*?)\1/i, function(_, quote, style) {
        return 'style=' + quote + 'margin:0 0 22px 0;line-height:1.75;' + style.replace(/margin\s*:[^;]+;?/gi, '').replace(/line-height\s*:[^;]+;?/gi, '') + quote;
      }) + '>';
    }
    return '<p' + attrs + ' style="margin:0 0 22px 0;line-height:1.75;">';
  });
}

function transporteCodexEmailInlineTableSpacing_(html) {
  return String(html || '').replace(/<table(\s[^>]*)?>/gi, function(tag, attrs) {
    attrs = attrs || '';
    if (/style\s*=/i.test(attrs)) {
      return '<table' + attrs.replace(/style=(["'])(.*?)\1/i, function(_, quote, style) {
        return 'style=' + quote + 'margin:22px 0 24px 0;' + style.replace(/margin\s*:[^;]+;?/gi, '') + quote;
      }) + '>';
    }
    return '<table' + attrs + ' style="margin:22px 0 24px 0;">';
  });
}

function transporteCodexEmailAttachments_(ss, projeto) {
  var attachments = [];
  try {
    var file = transporteCodexFindComunicadoEspecial_(ss, projeto);
    if (file) attachments.push(file.getBlob());
  } catch (error) {
    Logger.log('Comunicado Especial nao anexado: ' + error.toString());
  }
  return attachments;
}

function transporteCeStatus_(projeto) {
  projeto = String(projeto || '').trim();
  if (!projeto) return { checked: false, found: false, message: 'Protocolo nao selecionado.' };
  var cacheKey = 'TRANSPORTE_CE_STATUS_' + transporteParticipantKey_(transporteProjetoDisplay_(projeto)).slice(0, 80);
  var cached = transporteReadCachedJson_(cacheKey);
  if (cached && cached.found) return cached;
  var status = { checked: true, found: false, message: 'CE nao localizada para o estudo.' };
  try {
    var file = transporteCodexFindComunicadoEspecial_(getTransporteSpreadsheetCodex_(), projeto);
    if (file) {
      status.found = true;
      status.message = 'CE localizada para o estudo.';
      status.name = file.getName();
      status.url = file.getUrl();
    }
  } catch (error) {
    status.message = 'Nao foi possivel verificar a CE: ' + error.message;
  }
  if (status.found) transporteWriteCachedJson_(cacheKey, status, 600);
  return status;
}

function getTransporteCeStatus(projeto) {
  return transporteCeStatus_(projeto);
}

function transporteCourierEmailRecipients_(courier, temperatura) {
  var cfg = transporteCourierConfig_(courier);
  var tempCourierConfig = String(temperatura || '').trim();
  var rawCourierConfig;
  if (transporteNormalizeCourierFromCodex_(courier) === 'MARKEN') {
    rawCourierConfig = (tempCourierConfig === 'CONGELADO' || tempCourierConfig === 'AMBIENTE + CONGELADO')
      ? (cfg.emailCongelado || cfg.email || '')
      : (cfg.emailAmbiente || cfg.email || '');
  } else {
    rawCourierConfig = cfg.email || cfg.emailAmbiente || cfg.emailCongelado || '';
  }
  var recipientsCourierConfig = [];
  String(rawCourierConfig || '').split(/[;,]/).forEach(function(email) {
    email = email.trim();
    if (email) recipientsCourierConfig.push(email);
  });
  if (recipientsCourierConfig.length) return recipientsCourierConfig;
  throw new Error('Cadastre o e-mail da courier "' + String(courier || '-') + '" antes de criar o rascunho.');
}

function transporteCodexFindComunicadoEspecial_(ss, projeto) {
  projeto = String(projeto || '').trim();
  if (!projeto) return null;
  var aliases = transporteProjetoAliases_(projeto);
  var aliasKeys = aliases.map(transporteParticipantKey_);
  var protocolos = transporteGetSheet_(ss || getTransporteSpreadsheetCodex_(), 'protocolos', false);
  if (protocolos && protocolos.getLastRow() > 1) {
    var rows = protocolos.getRange(2, 1, protocolos.getLastRow() - 1, Math.min(6, protocolos.getLastColumn())).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (aliasKeys.indexOf(transporteParticipantKey_(rows[i][0])) < 0) continue;
      var link = String(rows[i][5] || '').trim();
      var id = transporteCodexDriveIdFromUrl_(link);
      if (id) return DriveApp.getFileById(id);
      break;
    }
  }
  var pastaCeId = transporteConfigValue_('Pasta de Comunicados Especiais ID', PASTA_COMUNICADOS_ESPECIAIS_ID);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(pastaCeId)) { pastaCeId = PASTA_COMUNICADOS_ESPECIAIS_ID; transporteRegistrarAviso_('CONFIG_PASTA_CE'); }
  if (pastaCeId) {
    var folder = DriveApp.getFolderById(pastaCeId);
    for (var a = 0; a < aliases.length; a++) {
      var files = folder.getFilesByName(aliases[a] + '_CE.pdf');
      if (files.hasNext()) return files.next();
    }
    var wanted = aliases.map(function(alias) {
      return transporteParticipantKey_(alias + '_CE.pdf');
    });
    var found = transporteFindComunicadoEspecialInFolder_(folder, wanted, aliasKeys, 2);
    if (found) return found;
  }
  return null;
}

function transporteFindComunicadoEspecialInFolder_(folder, wanted, aliasKeys, depth) {
  var allFiles = folder.getFiles();
  while (allFiles.hasNext()) {
    var file = allFiles.next();
    var fileKey = transporteParticipantKey_(file.getName());
    if (wanted.indexOf(fileKey) >= 0) return file;
    if (transporteComunicadoEspecialFileMatches_(fileKey, aliasKeys)) return file;
  }
  if (depth <= 0) return null;
  var folders = folder.getFolders();
  while (folders.hasNext()) {
    var child = folders.next();
    var found = transporteFindComunicadoEspecialInFolder_(child, wanted, aliasKeys, depth - 1);
    if (found) return found;
  }
  return null;
}

function transporteComunicadoEspecialFileMatches_(fileKey, aliasKeys) {
  fileKey = String(fileKey || '');
  if (!fileKey) return false;
  var hasCeMarker = /(^|[^a-z0-9])ce([^a-z0-9]|$)/.test(fileKey) ||
    fileKey.indexOf('comunicadoespecial') >= 0 ||
    /(^|[^a-z0-9])comunicado([^a-z0-9]|$)/.test(fileKey);
  if (!hasCeMarker) return false;
  for (var i = 0; i < (aliasKeys || []).length; i++) {
    var aliasKey = String(aliasKeys[i] || '');
    if (aliasKey.length < 3) continue;
    if (fileKey.indexOf(aliasKey) >= 0) return true;
  }
  return false;
}

function transporteCodexDriveIdFromUrl_(url) {
  url = String(url || '');
  var match = url.match(/[-\w]{25,}/);
  return match ? match[0] : '';
}

function transporteCodexSaudacao_() {
  var hora = new Date().getHours();
  return hora < 12 ? 'Bom dia' : (hora < 18 ? 'Boa tarde' : 'Boa noite');
}

function transporteCodexEmailHtml_(ss, sheetKey, tipo, saudacao) {
  var sheet = transporteCodexGetSheet_(ss, sheetKey, false);
  if (!sheet) return '';
  var range = sheet.getRange(tipo === 'OCASA' ? 'A1:B10' : 'A1:B9');
  var dados = range.getDisplayValues();
  var backgrounds = range.getBackgrounds();
  var fontColors = range.getFontColors();
  var fontWeights = range.getFontWeights();
  var hAlign = range.getHorizontalAlignments();
  var cnpjTexto = tipo === 'MARKEN' ? ' (CNPJ : ' + transporteCodexEmailEsc_(transporteCnpjTexto_()) + ')' : '';
  var html = '<p>Prezados,</p><p>' + transporteCodexEmailEsc_(saudacao || transporteCodexSaudacao_()) + ',</p><p>Seguem dados para agendamento de coleta' + cnpjTexto + ':</p><table style="border-collapse:collapse;font-size:12px;border:1px solid #000;">';
  dados.forEach(function(row, r) {
    html += '<tr>';
    if (tipo === 'MARKEN' && r === 0) {
      var headStyle = [
        'border:1px solid #000',
        'padding:3px',
        'background:' + (backgrounds[r][0] || '#ffffff'),
        'color:' + (fontColors[r][0] || '#000000'),
        'font-weight:' + (fontWeights[r][0] || 'bold'),
        'text-align:center',
        'line-height:1.45'
      ].join(';');
      html += '<td colspan="2" style="' + headStyle + '">' + transporteCodexEmailEsc_(row[0]) + '</td></tr>';
      return;
    }
    row.forEach(function(cell, c) {
      var style = [
        'border:1px solid #000',
        'padding:3px',
        'background:' + (backgrounds[r][c] || '#ffffff'),
        'color:' + (fontColors[r][c] || '#000000'),
        'font-weight:' + (fontWeights[r][c] || 'normal'),
        'text-align:' + (hAlign[r][c] || 'left'),
        'line-height:1.45'
      ].join(';');
      html += '<td style="' + style + '">' + transporteCodexEmailCellHtml_(cell, tipo) + '</td>';
    });
    html += '</tr>';
  });
  return html + '</table><p style="margin:22px 0 22px 0;line-height:1.75;">Os documentos necess\u00e1rios para o agendamento est\u00e3o anexados a este e-mail.</p>';
}

function transporteCodexEmailDhlHtml_(projeto, dataColeta, janelaEnvio, dataEnvio, investigador, laboratorio, awb, temperatura, solicitarCaixa, saudacao) {
  var registro;
  try {
    registro = transporteReadRegistro_() || {};
  } catch (e) {
    registro = {};
  }
  var refInterna = String(registro.refInterna || '').trim();
  var rows = [
    ['Projeto', projeto || '-'],
    ['Janela de Envio', janelaEnvio || '-'],
    ['Data de envio', transporteCodexFormatData_(dataEnvio) || '-'],
    ['Investigador Principal', investigador || '-'],
    ['Laborat\u00f3rio destino', laboratorio || '-'],
    ['Temperatura', temperatura || '-'],
    ['AWB / C\u00f3digo', awb || '-'],
    ['Solicitar Caixa de Transporte', transporteNormalizeSimNao_(solicitarCaixa, 'Sim')]
  ];
  if (refInterna) rows.push(['Ref. interna', refInterna]);
  var html = '<p>Prezados,</p><p>' + transporteCodexEmailEsc_(saudacao || transporteCodexSaudacao_()) + ',</p><p>Seguem dados para agendamento de coleta (CNPJ : ' + transporteCodexEmailEsc_(transporteCnpjTexto_()) + '):</p><table style="border-collapse:collapse;font-size:12px;border:1px solid #000;">';
  rows.forEach(function(row) {
    html += '<tr><td style="border:1px solid #000;padding:3px;font-weight:bold;line-height:1.45;">' + transporteCodexEmailEsc_(row[0]) + '</td><td style="border:1px solid #000;padding:3px;line-height:1.45;">' + transporteCodexEmailEsc_(row[1]) + '</td></tr>';
  });
  return html + '</table>';
}

function transportePdfOcultarMetadadosInternos_(ss) {
  if (!ss) return;
  // Somente na copia temporaria: notas internas nao podem virar paginas de
  // impressao, inclusive nas vias duplicadas da Declaracao de Transporte.
  // Falha na limpeza deve interromper a exportacao, sem ocultar o erro.
  ss.getSheets().forEach(function(sheet) { sheet.clearNotes(); });
  var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
  if (!folha) return;
  try {
    folha.getRange('C15').clearContent().clearNote();
  } catch (e) {
    Logger.log('Metadados internos do transporte nao ocultados no PDF: ' + e.message);
  }
}

function transporteCodexEmailFallbackHtml_(projeto, dataEnvio, laboratorio, awb, courier, saudacao) {
  var rows = [
    ['Projeto', projeto || '-'],
    ['Courier', courier || '-'],
    ['Data de envio', transporteCodexFormatData_(dataEnvio) || '-'],
    ['Laborat\u00f3rio destino', laboratorio || '-'],
    ['AWB / C\u00f3digo', awb || '-']
  ];
  var cnpjTexto = courier === 'MARKEN' ? ' (CNPJ : ' + transporteCodexEmailEsc_(transporteCnpjTexto_()) + ')' : '';
  var html = '<p>Prezados,</p><p>' + transporteCodexEmailEsc_(saudacao || transporteCodexSaudacao_()) + ',</p><p>Seguem dados para agendamento de coleta' + cnpjTexto + ':</p><table border="1" style="border-collapse:collapse;font-size:12px">';
  rows.forEach(function(row) {
    html += '<tr><td style="padding:3px;font-weight:bold;line-height:1.45;">' + transporteCodexEmailEsc_(row[0]) + '</td><td style="padding:3px;line-height:1.45;">' + transporteCodexEmailEsc_(row[1]) + '</td></tr>';
  });
  return html + '</table><p style="margin:22px 0 22px 0;line-height:1.75;">Os documentos necess\u00e1rios para o agendamento est\u00e3o anexados a este e-mail.</p>';
}

var TRANSPORTE_CONTATO_EMERGENCIA_PINEX_ = 'telefone de emerg\u00eancia (24H): 55 11 97095-3241 - thais thabata leite lopes';
var TRANSPORTE_CONTATO_EMERGENCIA_CENTRO_ = 'Telefone de Emerg\u00eancia (24H): +55 54 99909-1656';

function transporteContatoEmergenciaTexto_(courier) {
  return transporteNormalizeCourierFromCodex_(courier) === 'PINEX'
    ? transporteConfigValue_('Contato de emergência PINEX', TRANSPORTE_CONTATO_EMERGENCIA_PINEX_)
    : transporteConfigValue_('Contato de emergência centro', TRANSPORTE_CONTATO_EMERGENCIA_CENTRO_);
}

function transporteAplicarContatoEmergenciaPdf_(ss, courier, spec) {
  if (!ss) return 0;
  var contato = transporteContatoEmergenciaTexto_(courier);
  var sheetKeys = spec && spec.ordem ? spec.ordem : [];
  var sheetsSeen = {};
  var atualizadas = 0;

  sheetKeys.forEach(function(key) {
    var sheet = transporteCodexGetSheet_(ss, key, false);
    if (!sheet) return;
    var sheetId = String(sheet.getSheetId());
    if (sheetsSeen[sheetId]) return;
    sheetsSeen[sheetId] = true;

    var dataRange = sheet.getDataRange();
    var values = dataRange.getDisplayValues();
    for (var row = 0; row < values.length; row++) {
      for (var col = 0; col < values[row].length; col++) {
        var digits = String(values[row][col] || '').replace(/\D/g, '');
        var marker = String(values[row][col] || '').indexOf('{{TRANSPORTE_CONTATO_EMERGENCIA}}') >= 0;
        if (!marker && digits.indexOf('970953241') === -1 && digits.indexOf('999091656') === -1) continue;
        var cell = dataRange.getCell(row + 1, col + 1);
        if (cell.isPartOfMerge()) {
          var merged = cell.getMergedRanges();
          if (merged.length) cell = merged[0].getCell(1, 1);
        }
        cell.setValue(transporteTextoLiteralParaCelula_(contato));
        atualizadas++;
      }
    }
  });

  if (!atualizadas) {
    Logger.log('Contato de emergencia nao localizado nas abas do PDF para a courier ' + String(courier || '-'));
  }
  return atualizadas;
}

function imprimirTodasAbas(options) {
  var workingCopyFile = null;
  try {
    options = options || {};
    var payloadFallback = transporteDerivarDadosParticipante_(options.payload || transporteReadRegistro_(), { obrigatorio: true });
    var ss = getTransporteSpreadsheetCodex_();
    var folha = transporteCodexGetSheet_(ss, 'folhaAgendamento', false);
    var marker = String(options.marker || '').trim();
    if (!folha) throw new Error('Aba Folha de Agendamento nao encontrada.');
    var cfg = folha.getRange('C3:C14').getValues().map(function(r) { return r[0]; });
    var paciente = cfg[0] || payloadFallback.paciente;
    var protocolo = String(cfg[1] || payloadFallback.protocolo || '').trim() || 'PASTA_PADRAO';
    var investigador = cfg[2] || payloadFallback.investigador;
    var temperatura = String(cfg[3] || payloadFallback.temperatura || '').trim();
    var dataColeta = cfg[4] || transporteParseDate_(payloadFallback.dataColeta);
    var dataEnvio = cfg[5] || transporteParseDate_(payloadFallback.dataEnvio);
    var horaEnvio = String(cfg[6] || payloadFallback.horaEnvio || '').trim();
    var courier = String(options.courier || payloadFallback.courier || cfg[7] || 'Transporte').trim();
    var destino = String(cfg[8] || payloadFallback.destino || '').trim();
    var awb = String(cfg[9] || payloadFallback.awb || '').trim();
    var responsavel = String(cfg[10] || payloadFallback.agendadoPor || '').trim();
    var observacoes = cfg[11] || payloadFallback.observacoes;
    var formPinex = transporteCodexGetSheet_(ss, 'formularioPinex', false);
    var responsavelEntrega = String((formPinex ? getCellValueSafe(formPinex, 'D32') : '') || payloadFallback.responsavelEntrega || '').trim();
    transporteValidarObrigatoriosWebApp_({
      paciente: paciente,
      identificacaoParticipante: payloadFallback.identificacaoParticipante || payloadFallback.idParticipante || '',
      protocolo: protocolo,
      investigador: investigador,
      destino: destino,
      dataEnvio: dataEnvio,
      temperatura: temperatura,
      courier: courier,
      horaEnvio: horaEnvio,
      agendadoPor: responsavel,
      responsavelEntrega: responsavelEntrega,
      awb: awb
    });
    transporteValidarDataEnvioMinima_(dataEnvio);

    var spec = transportePdfSpec_(courier, temperatura, destino, ss);
    if (!spec.ordem.length) throw new Error('Courier sem configuracao de PDF: ' + courier);
    var payloadForAutomation = {
      courier: courier,
      temperatura: temperatura,
      dataEnvio: dataEnvio,
      awb: awb,
      responsavelEntrega: responsavelEntrega,
      solicitarCaixa: payloadFallback.solicitarCaixa || transporteReadSolicitarCaixa_(ss, courier, temperatura)
    };
    transporteAplicarAutomacoesTemperatura_(ss, {
      courier: courier,
      temperatura: temperatura,
      dataEnvio: dataEnvio,
      awb: awb
    });
    aplicarSolicitacaoCaixaTransporte_(ss, payloadForAutomation);
    transporteAplicarCourierConfig_(ss, courier);
    transportePreencherPeticaoMedico_(ss, {
      investigador: investigador
    });
    transportePreencherDeclaracaoCadastros_(ss, {
      investigador: investigador,
      destino: destino
    });
    if (transporteNormalizeCourierFromCodex_(courier) === 'PINEX') {
      atualizarCommercialInvoicePinexB34_(ss);
    }
    preencherDadosProtocoloPeticaoWebApp_(ss, {
      protocolo: protocolo,
      destino: destino
    });
    if (payloadFallback && payloadFallback.materiais) {
      preencherPeticaoAnuenciaWebApp_(ss, payloadFallback);
    }
    preencherDhlWebApp_(ss, payloadFallback);
    transporteAjustarVolumesDeclaracao_(transporteCodexGetSheet_(ss, 'declaracaoTransp', false), true);

    SpreadsheetApp.flush();
    var token = ScriptApp.getOAuthToken();
    var nomeArquivo = transportePdfFileName_(awb, dataEnvio, temperatura, courier, marker);
    var pastaDestino = transportePdfDestinationFolder_(protocolo);
    // A copia com dados internos fica no Meu Drive do executor, fora da pasta
    // de saida compartilhada, com nome opaco e compartilhamento privado.
    workingCopyFile = DriveApp.getFileById(ss.getId()).makeCopy('IPS-TEMP-PDF-' + Utilities.getUuid(), DriveApp.getRootFolder());
    workingCopyFile.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    transportePdfVerificarCopiaPrivada_(workingCopyFile);
    var workingSS = transporteMeasurePerformance_('gerarPdfTransporte', 'working_copy_open', { rowCount: 0 }, function() {
      return transportePdfOpenWorkingCopy_(workingCopyFile.getId());
    });
    transporteAplicarContatoEmergenciaPdf_(workingSS, courier, spec);
    transportePdfAnonimizarParticipante_(workingSS, payloadFallback, ss);
    transportePdfOcultarMetadadosInternos_(workingSS);
    transporteMeasurePerformance_('gerarPdfTransporte', 'working_copy_prepare', { rowCount: spec.ordem.length }, function() {
      transportePdfPruneDuplicateAndOrder_(workingSS, spec);
    });
    SpreadsheetApp.flush();
    var conteudoPdf = transportePdfVerificarAnonimizacao_(workingSS, [paciente, payloadFallback.paciente, payloadFallback.participante]);
    var conteudoPdfHash = transportePdfManifestoHash_(conteudoPdf);
    Utilities.sleep(700);

    var url = 'https://docs.google.com/spreadsheets/d/' + workingCopyFile.getId() + '/export?' + [
      'format=pdf',
      'exportFormat=pdf',
      'size=A4',
      'portrait=true',
      'fitw=true',
      'top_margin=0.5',
      'bottom_margin=0.1',
      'left_margin=0.25',
      'right_margin=0.25',
      'sheetnames=false',
      'printtitle=false',
      'pagenumbers=false',
      'gridlines=false',
      'fzr=false'
    ].join('&');
    var response = transporteMeasurePerformance_('gerarPdfTransporte', 'pdf_fetch', { rowCount: 0 }, function() {
      return UrlFetchApp.fetch(url, {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
    });
    var code = response.getResponseCode();
    var headers = response.getAllHeaders ? response.getAllHeaders() : {};
    var contentType = String(headers['Content-Type'] || headers['content-type'] || '');
    if (code < 200 || code >= 300) {
      throw new Error('Exportacao PDF falhou HTTP ' + code + ': ' + response.getContentText().slice(0, 200));
    }
    var blob = response.getBlob();
    if (blob.getBytes().length < 1000 || (contentType && contentType.indexOf('pdf') === -1)) {
      throw new Error('Exportacao retornou conteudo inesperado: ' + contentType + ' (' + blob.getBytes().length + ' bytes)');
    }
    blob.setName(nomeArquivo + '.pdf');
    if (TRANSPORTE_GENERATION_REQUEST_) {
      var sourceSheets = ss.getSheets().map(function(sheet) { return sheet.getName(); }).filter(function(name) { return spec.ordem.indexOf(name) >= 0 || /email/i.test(name); }).sort();
      if (!sourceSheets.length) throw new Error('Não foi possível confirmar os modelos para recuperação da geração.');
      transporteGenerationCheckpoint_({ sourceSheets: sourceSheets, sourceHash: transporteGenerationSourceHash_(ss, sourceSheets) });
    }
    transporteGenerationCheckpoint_({ phase: 'PDF_INTENT' });
    var pdfFile = pastaDestino.createFile(blob);
    var pdfId = pdfFile.getId();
    transporteGenerationCheckpoint_({ phase: 'PDF_READY', pdf: {
      ok: true, type: 'pdf', fileId: pdfId, fileName: blob.getName(), courier: courier, conteudoPdfHash: conteudoPdfHash,
      fileUrl: 'https://drive.google.com/file/d/' + encodeURIComponent(pdfId) + '/view',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(pdfId),
      message: 'PDF recuperado. Confira o acesso ao arquivo no Drive.',
      warnings: [{ code: 'PDF_RECOVERY_PARTIAL', message: 'PDF recuperado após interrupção. Confira o compartilhamento no Drive e a CE antes do envio.' }]
    } });
    var driveAccess = transporteShareGeneratedPdfWithActiveUser_(pdfFile, pastaDestino);
    var downloadUrl = 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(pdfFile.getId());
    var printUrl = 'https://drive.google.com/file/d/' + encodeURIComponent(pdfFile.getId()) + '/view';
    var ceStatus = transporteCeStatus_(protocolo);
    var ceFileId = ceStatus && ceStatus.url ? transporteCodexDriveIdFromUrl_(ceStatus.url) : '';
    var cePrintUrl = ceFileId
      ? 'https://drive.google.com/file/d/' + encodeURIComponent(ceFileId) + '/preview'
      : '';
    return {
      ok: true,
      type: 'pdf',
      conteudoPdfHash: conteudoPdfHash,
      message: 'PDF gerado no Drive: ' + blob.getName(),
      fileName: blob.getName(),
      courier: courier,
      fileId: pdfFile.getId(),
      fileUrl: pdfFile.getUrl(),
      downloadUrl: downloadUrl,
      printUrl: printUrl,
      ce: ceStatus || { checked: true, found: false, message: 'CE nao localizada para o estudo.' },
      cePrintUrl: cePrintUrl,
      folderUrl: pastaDestino.getUrl(),
      folderName: pastaDestino.getName(),
      driveAccess: driveAccess
    };
  } catch (error) {
    Logger.log('Erro em imprimirTodasAbas: ' + error.toString());
    return 'Erro ao gerar PDF: ' + error.toString();
  } finally {
    if (workingCopyFile) {
      try {
        workingCopyFile.setTrashed(true);
      } catch (trashError) {
        transporteRegistrarAviso_('LIMPEZA_COPIA_TEMPORARIA');
        Logger.log('Erro ao mover copia temporaria para lixeira: ' + trashError.toString());
      }
    }
  }
}

function transporteOcasaNeedsProforma_(destino) {
  var lab = transporteLabCentralByDestino_(destino);
  if (lab) {
    var pais = transporteNorm_(lab.pais || '');
    return !(pais === 'brasil' || pais === 'brazil');
  }
  return true;
}

function transportePdfSpec_(courier, temperatura, destino, ss) {
  var c = String(courier || '');
  var t = String(temperatura || '');
  var ordem = [];
  var copias = {};
  function add(key, count) {
    var name = transportePdfActualSheetName_(key, ss);
    if (!name) throw new Error('Aba necessaria nao encontrada: ' + key);
    ordem.push(name);
    copias[name] = count || 1;
  }
  if (c === 'PINEX (Agendamento)') {
    add('formularioPinex', 1);
  } else if (c === 'PINEX') {
    add('folhaDhlPinex', 1);
    add('invoicePinex', 3);
    add('peticaoPinex', 2);
    add('usdaStatementPinex', 1);
    add('fichaEmergenciaPinex', 3);
    add('declaracaoTransp', 3);
  } else if (transporteIsDhl_(c)) {
    add('folhaDhlPinex', 1);
    add('declaracaoDhl', 1);
    add('invoiceDhl', 2);
    add('declaracaoTranspDhl', 2);
  } else {
    add('folhaAgendamento', 1);
    add('declaracaoTransp', 4);
    add('peticaoAnuencia', 4);
    if (c === 'MARKEN') {
      add('invoiceMarken', 4);
      add('fichaEmergenciaMarken', 4);
    }
    if (c === 'OCASA') {
      if (transporteOcasaNeedsProforma_(destino)) add('proformaOcasa', 4);
      add('fichaEmergenciaOcasa', 4);
      add('telefonesUteisOcasa', 4);
    }
  }
  return { ordem: ordem, copias: copias };
}

function transportePdfActualSheetName_(key, ss) {
  var sh = transporteCodexGetSheet_(ss || getTransporteSpreadsheetCodex_(), key, false);
  return sh ? sh.getName() : '';
}

function transportePdfDestinationFolder_(protocolo) {
  var root = DriveApp.getRootFolder();
  var folderName = 'Documenta\u00e7\u00e3o para Transporte de Amostras';
  var folders = root.getFoldersByName(folderName);
  var parent = folders.hasNext() ? folders.next() : root.createFolder(folderName);
  var subName = String(protocolo || 'PASTA_PADRAO').trim() || 'PASTA_PADRAO';
  var subFolders = parent.getFoldersByName(subName);
  return subFolders.hasNext() ? subFolders.next() : parent.createFolder(subName);
}

function transporteShareGeneratedPdfWithActiveUser_(pdfFile, folder) {
  var email = transporteActiveUserEmail_();
  var out = {
    userEmail: email,
    fileShared: false,
    folderShared: false,
    ownerEmail: '',
    fileShareError: '',
    folderShareError: '',
    notified: false
  };
  if (!pdfFile || !email) return out;
  try {
    var owner = pdfFile.getOwner && pdfFile.getOwner();
    out.ownerEmail = owner && owner.getEmail ? String(owner.getEmail() || '').trim() : '';
  } catch (ownerError) {
    out.ownerEmail = '';
  }
  if (out.ownerEmail && out.ownerEmail.toLowerCase() === email.toLowerCase()) return out;
  try {
    out.fileShared = transporteAddDriveViewerNoNotify_(pdfFile.getId(), email);
  } catch (fileShareError) {
    out.fileShareError = fileShareError.toString();
    Logger.log('PDF de transporte nao compartilhado com ' + email + ': ' + out.fileShareError);
  }
  try {
    if (folder && folder.getId) {
      out.folderShared = transporteAddDriveViewerNoNotify_(folder.getId(), email);
    }
  } catch (folderShareError) {
    out.folderShareError = folderShareError.toString();
    Logger.log('Pasta de transporte nao compartilhada com ' + email + ': ' + out.folderShareError);
  }
  return out;
}

function transporteAllowedUserNames_() {
  var out = [];
  try {
    if (typeof codexGetAllowedUsers_ !== 'function') return out;
    var acl = codexGetAllowedUsers_() || {};
    Object.keys(acl).forEach(function(email) {
      var user = acl[email] || {};
      if (user.active === false) return;
      var name = String(user.name || user.firstName || email || '').trim();
      if (name) out.push(name);
    });
  } catch (e) {}
  return out;
}

function transporteMergeUniqueOptions_(primary, secondary) {
  var seen = {};
  var out = [];
  (primary || []).concat(secondary || []).forEach(function(value) {
    value = String(value || '').trim();
    if (!value) return;
    var key = transporteNorm_(value);
    if (seen[key]) return;
    seen[key] = true;
    out.push(value);
  });
  return out;
}

function transporteAddDriveViewerNoNotify_(fileId, email) {
  fileId = String(fileId || '').trim();
  email = String(email || '').trim();
  if (!fileId || !email) return false;
  if (typeof Drive === 'undefined' || !Drive.Permissions || !Drive.Permissions.create) {
    throw new Error('Servico avancado do Drive indisponivel para compartilhar sem notificacao.');
  }
  try {
    Drive.Permissions.create({
      role: 'reader',
      type: 'user',
      emailAddress: email
    }, fileId, {
      sendNotificationEmail: false,
      supportsAllDrives: true
    });
    return true;
  } catch (error) {
    var msg = String(error && error.message ? error.message : error);
    if (msg.indexOf('already exists') >= 0 || msg.indexOf('The user already has access') >= 0) return true;
    throw error;
  }
}

function transporteActiveUserEmail_() {
  try {
    if (typeof codexGetActiveUserEmail_ === 'function') {
      var codexEmail = String(codexGetActiveUserEmail_() || '').trim();
      if (codexEmail) return codexEmail;
    }
  } catch (e1) {}
  try {
    return String(Session.getActiveUser().getEmail() || '').trim();
  } catch (e2) {}
  return '';
}

function transporteNormalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function transporteEffectiveUserEmail_() {
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim();
  } catch (e) {}
  return transporteActiveUserEmail_();
}

function transporteExecutionContext_() {
  return {
    activeUserEmail: transporteActiveUserEmail_(),
    effectiveUserEmail: transporteEffectiveUserEmail_()
  };
}

function transportePdfFileName_(awb, dataEnvio, temperatura, courier, marker) {
  var date = dataEnvio instanceof Date ? dataEnvio : new Date();
  var data = transporteCodexFormatDateTitlePt_(date);
  var tipo = String(temperatura || 'AMBIENTE').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  var prefix = courier === 'PINEX (Agendamento)' ? '' : (String(awb || '').trim() + '_');
  var test = marker ? String(marker).replace(/[^A-Za-z0-9_-]+/g, '_') + '_' : '';
  return (test + prefix + data + '_' + tipo).replace(/^_+|_+$/g, '');
}

function transportePdfOpenWorkingCopy_(fileId) {
  var lastError = null;
  for (var i = 0; i < 4; i++) {
    try {
      var workingSS = SpreadsheetApp.openById(fileId);
      try {
        workingSS.setSpreadsheetLocale('pt_BR');
        SpreadsheetApp.flush();
      } catch (localeError) {
        Logger.log('Locale pt_BR nao aplicado na copia temporaria do PDF: ' + localeError.message);
      }
      return workingSS;
    } catch (error) {
      lastError = error;
      Utilities.sleep(i === 0 ? 300 : 700);
    }
  }
  throw lastError || new Error('Copia temporaria do PDF nao abriu.');
}

function transportePdfVerificarCopiaPrivada_(file) {
  var owner = file.getOwner();
  var ownerEmail = owner && owner.getEmail ? transporteNormalizeEmail_(owner.getEmail()) : '';
  var users = file.getEditors().concat(file.getViewers());
  if (!ownerEmail || file.getSharingAccess() !== DriveApp.Access.PRIVATE || users.some(function(user) {
    return transporteNormalizeEmail_(user.getEmail()) !== ownerEmail;
  })) throw new Error('A cópia temporária não pôde ser confirmada como privada. Nenhum PDF foi exportado.');
}

function transportePdfAnonimizarParticipante_(workingSS, payloadFallback, sourceSS) {
  var paciente = String((payloadFallback && (payloadFallback.paciente || payloadFallback.participante)) || '').trim();
  var folhas = ['folhaAgendamento', 'folhaDhlPinex'].map(function(key) {
    return transportePdfActualSheetName_(key, sourceSS);
  }).filter(Boolean);
  folhas.forEach(function(name) {
    var sh = transporteFindSheetByNames_(workingSS, [name]);
    if (!sh) return;
    var atual = String(getCellValueSafe(sh, 'C3') || paciente || '').trim();
    sh.getRange('C3').setValue(extrairIniciais_(atual) || atual);
  });
}

function transportePdfVerificarAnonimizacao_(workingSS, nomes) {
  var names = (nomes || []).map(transportePdfManifestText_).filter(function(value) { return !!value; });
  var conteudo = [];
  workingSS.getSheets().forEach(function(sheet) {
    if (sheet.isSheetHidden()) return;
    var rows = sheet.getDataRange().getDisplayValues();
    conteudo.push({ aba: sheet.getName(), valores: rows });
    rows.forEach(function(row) {
      row.forEach(function(value) {
        var text = transportePdfManifestText_(value);
        if (names.some(function(name) { return text.indexOf(name) >= 0; })) {
          // Nunca incluir nome, aba, celula ou conteudo no erro/log.
          throw new Error('PDF bloqueado: identificação nominal ainda presente em uma aba exportada. Revise o modelo de documentação.');
        }
      });
    });
  });
  return conteudo;
}

function transportePdfPruneDuplicateAndOrder_(workingSS, spec) {
  var keep = {};
  spec.ordem.forEach(function(name) { keep[transporteSheetNameKey_(name)] = true; });

  var keptCount = 0;
  spec.ordem.forEach(function(name) {
    var sheet = transporteFindSheetByNames_(workingSS, [name]);
    if (sheet) {
      sheet.showSheet();
      keptCount++;
    }
  });
  if (!keptCount) {
    throw new Error('Nenhuma aba configurada para o PDF foi encontrada na copia temporaria.');
  }

  workingSS.getSheets().forEach(function(sheet) {
    if (keep[transporteSheetNameKey_(sheet.getName())]) {
      sheet.showSheet();
    } else {
      sheet.hideSheet();
    }
  });
  SpreadsheetApp.flush();

  spec.ordem.forEach(function(name) {
    var sheet = transporteFindSheetByNames_(workingSS, [name]);
    var count = spec.copias[name] || 1;
    if (!sheet) return;
    sheet.showSheet();
    transportePdfApplyExportFont_(sheet);
    if (count <= 1) return;
    for (var i = 2; i <= count; i++) {
      var copy = sheet.copyTo(workingSS).setName(name + ' (' + i + ')');
      copy.showSheet();
    }
  });
  SpreadsheetApp.flush();

  var pos = 1;
  spec.ordem.forEach(function(name) {
    var count = spec.copias[name] || 1;
    for (var i = 1; i <= count; i++) {
      var sheetName = i === 1 ? name : name + ' (' + i + ')';
      var sh = workingSS.getSheetByName(sheetName);
      if (sh) {
        sh.showSheet();
        workingSS.setActiveSheet(sh);
        workingSS.moveActiveSheet(pos++);
      }
    }
  });
}

function transportePdfApplyExportFont_(sheet) {
  try {
    sheet.getDataRange().setFontFamily('Arial');
  } catch (e) {
    Logger.log('Fonte Arial nao aplicada em ' + sheet.getName() + ': ' + e.message);
  }
}


/* ===== END TransporteCodexAutomacoes.gs ===== */
