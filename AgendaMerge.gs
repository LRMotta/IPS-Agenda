// Referencia assinada para comparacao de tres estados. Nenhum dado em cache e
// usado como fonte atual; toda decisao ocorre com a linha fresca sob o lock.
function agendaMergeSigningKey_() {
  var props = PropertiesService.getScriptProperties();
  var name = 'AGENDA_MERGE_SIGNING_KEY_V1';
  var key = props.getProperty(name);
  if (key) return key;
  return codexWithDocumentLock_('agendaMergeSigningKey', function() {
    var current = props.getProperty(name);
    if (!current) {
      current = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty(name, current);
    }
    return current;
  });
}

function agendaMergeFields_() {
  var fields = [
    { label: 'Identidade e contexto do agendamento', context: true,
      keys: ['tipo', 'status', 'participante', 'participanteCadastroId', 'participanteId', 'nascimento', 'projeto', 'braco', 'visita', 'labCentral'] },
    { label: 'Data e horário', keys: ['data', 'hora'] },
    { label: 'Médico', keys: ['medico'] },
    { label: 'Procedimentos', keys: ['procedimentos'] },
    { label: 'Observações', keys: ['obs'] },
    { label: 'Kit', keys: ['kit'] },
    { label: 'Serviço terceirizado e requisição', keys: ['servTerc', 'statusRequisicao'] },
    { label: 'Monitor e local', keys: ['monitorName', 'salaMonitoria'] },
    { label: 'Polo Trial concluído', keys: ['poloTrialConcluido'], boolean: true },
    { label: 'eCRF concluída', keys: ['ecrfConcluida'], boolean: true },
    { label: 'Carro requerido', keys: ['carroRequerido'], boolean: true }
  ];
  ['courier1', 'courier2', 'courier3', 'backup', 'backup2'].forEach(function(slot, index) {
    var label = ['Transporte I', 'Transporte II', 'Transporte III', 'Backup', 'Backup II'][index];
    fields.push({ label: label + ' - Dados do envio', slot: slot, config: true, keys: ['nome', 'temperatura', 'awb', 'destino'] });
    fields.push({ label: label + ' - Status', slot: slot, keys: ['status'] });
    fields.push({ label: label + ' - Material biológico', slot: slot, material: true, keys: ['material', 'matBioJson'] });
  });
  fields.push({ label: 'Backup - Agendamento vinculado', keys: ['_backupLink'], readOnly: true, slotLink: 'backup' });
  fields.push({ label: 'Backup II - Agendamento vinculado', keys: ['_backup2Link'], readOnly: true, slotLink: 'backup2' });
  return fields;
}

function agendaMergePayloadFromEvent_(event) {
  var p = {};
  agendaMergeFields_().forEach(function(field) {
    field.keys.forEach(function(key) {
      if (field.readOnly) return;
      if (field.slot) {
        if (!p[field.slot]) p[field.slot] = {};
        p[field.slot][key] = (event[field.slot] || {})[key];
      } else p[key] = event[key];
    });
  });
  p.data = event.dataIso || event.data || '';
  p.participanteId = event.idParticipante || '';
  return p;
}

function agendaMergePayloadFromRow_(row) {
  var p = agendaMergePayloadFromEvent_(agendaRowToObject_(row, 0));
  var i = AGENDA_CFG.idx;
  // Preservar inclusive dados historicos ocultos na interface e campos auxiliares.
  p.statusRequisicao = agendaStatusRequisicaoDisplay_(row[i.reqStatus], row[i.obs]);
  p._backupLink = String(row[i.backupAgendaRef] || '');
  p.backup = { nome: String(row[i.cb.nome] || ''), temperatura: String(row[i.cb.temp] || ''),
    status: String(row[i.cb.status] || ''), material: String(row[i.cb.material] || ''),
    destino: String(row[i.cb.destino] || ''), matBioJson: String(row[i.cb.matBio] || ''), awb: '' };
  p.backup2 = agendaBackup2FromRow_(row);
  p._backup2Link = JSON.stringify(p.backup2.agendamentos || (p.backup2.agendamento ? [p.backup2.agendamento] : []));
  return p;
}

function agendaMergeMaterialKey_(courier) {
  var json = String(courier.matBioJson || courier.materialJson || '').trim();
  if (!json) return ['texto', String(courier.material || '').trim()];
  try {
    var parsed = JSON.parse(json);
    var items = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(items)) return ['json', agendaCanonicalJsonForVersion_(json)];
    var normalized = items.map(function(item) {
      var extras = {};
      Object.keys(item).forEach(function(key) {
        if (['key', 'tipo', 'ensaio', 'unit', 'segmentos', 'tubos', 'total', 'formula'].indexOf(key) < 0) extras[key] = item[key];
      });
      var segments = (item.segmentos || []).map(function(segment) {
        var extra = {};
        Object.keys(segment).forEach(function(key) { if (key !== 'qtd' && key !== 'vol') extra[key] = segment[key]; });
        return [Number(segment.qtd), Number(segment.vol), agendaCanonicalJsonForVersion_(JSON.stringify(extra))];
      });
      return [String(item.key || ''), String(item.tipo || '').trim(), String(item.ensaio || '').trim(),
        String(item.unit || 'mL'), segments, Number(item.tubos || 0), Number(item.total || 0), segments.length ? '' : String(item.formula || '').trim(), agendaCanonicalJsonForVersion_(JSON.stringify(extras))];
    });
    normalized.sort(function(a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
    var extraEnvelope = {};
    if (!Array.isArray(parsed)) Object.keys(parsed).forEach(function(key) { if (key !== 'items' && key !== 'v') extraEnvelope[key] = parsed[key]; });
    return normalized.length ? ['items', parsed.v || 1, normalized, agendaCanonicalJsonForVersion_(JSON.stringify(extraEnvelope))] : ['texto', String(courier.material || '').trim()];
  } catch (error) { return ['json', json]; }
}

function agendaMergeFieldKey_(payload, field) {
  var values = field.slot ? (payload[field.slot] || {}) : payload;
  if (field.material) return JSON.stringify(agendaMergeMaterialKey_(values));
  return JSON.stringify(field.keys.map(function(key) {
    var value = values[key];
    if (field.boolean) return agendaBooleanValue_(value);
    if (key === 'nascimento' || key === 'data') return formatarDataIsoAgenda_(value) || String(value || '').trim();
    if (key === '_backupLink' || key === '_backup2Link') return agendaCanonicalJsonForVersion_(value);
    return String(value == null ? '' : value).trim();
  }));
}

function agendaIssueMergeToken_(row, event) {
  try {
    var raw = agendaMergePayloadFromRow_(row);
    var form = agendaMergePayloadFromEvent_(event);
    form._backupLink = raw._backupLink;
    form._backup2Link = raw._backup2Link;
    var envelope = { v: 1, id: String(event.id), email: codexNormalizeEmail_(codexGetActiveUserEmail_()),
      spreadsheet: getCodexSpreadsheet_().getId(), expires: Date.now() + 24 * 60 * 60 * 1000,
      schema: [AGENDA_CFG.lastCol, AGENDA_CFG.idx.cb.temp, AGENDA_CFG.idx.participanteCadastroId, AGENDA_CFG.idx.backup2Dados],
      version: agendaRecordVersionFromRow_(row), editVersion: agendaEditableRecordVersionFromRow_(row), raw: raw, form: form };
    if (!envelope.email) return '';
    var text = Utilities.base64EncodeWebSafe(JSON.stringify(envelope));
    return text + '.' + Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, agendaMergeSigningKey_()));
  } catch (error) { return ''; } // Falha conservadora: a edicao abre, mas nao combina dados.
}

function agendaReadMergeToken_(dados) {
  try {
    var token = dados._editMergeToken;
    if (typeof token !== 'string' || token.length > 180000 || !/^[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/.test(token)) return null;
    var parts = token.split('.');
    var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], agendaMergeSigningKey_()));
    if (parts[1] !== expected) return null;
    var base = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (base.v !== 1 || base.id !== String(dados.id) || base.version !== String(dados._recordVersion || '') ||
        base.editVersion !== String(dados._editRecordVersion || '') || base.expires < Date.now() ||
        base.email !== codexNormalizeEmail_(codexGetActiveUserEmail_()) || base.spreadsheet !== getCodexSpreadsheet_().getId() ||
        JSON.stringify(base.schema) !== JSON.stringify([AGENDA_CFG.lastCol, AGENDA_CFG.idx.cb.temp, AGENDA_CFG.idx.participanteCadastroId, AGENDA_CFG.idx.backup2Dados]) || !base.raw || !base.form) return null;
    return base;
  } catch (error) { return null; }
}

function agendaTryMergeEdit_(dados, row) {
  var base = agendaReadMergeToken_(dados);
  if (!base) return { ok: false, reason: 'REFERENCIA_ASSINADA_INDISPONIVEL', fields: [] };
  var current = agendaMergePayloadFromRow_(row);
  var incoming = Object.assign({}, base.form, dados);
  if (Object.prototype.hasOwnProperty.call(dados, 'idParticipante')) incoming.participanteId = dados.idParticipante;
  ['courier1', 'courier2', 'courier3', 'backup', 'backup2'].forEach(function(slot) {
    incoming[slot] = Object.assign({}, base.form[slot] || {}, dados[slot] || {});
    var courier = dados[slot] || {};
    if (courier.temp !== undefined && courier.temperatura === undefined) incoming[slot].temperatura = courier.temp;
    if (courier.materialJson !== undefined && courier.matBioJson === undefined) incoming[slot].matBioJson = courier.materialJson;
    if (courier.awbTouched === false) incoming[slot].awb = (base.form[slot] || {}).awb || '';
  });
  if ([base.form.tipo, current.tipo, incoming.tipo].some(function(tipo) { return AgendaServerRules_.isMultiDay(tipo); })) {
    return { ok: false, reason: 'PERIODO_MULTIPLO_REQUER_REVISAO', fields: ['Período do agendamento'] };
  }
  var states = agendaMergeFields_().map(function(field) {
    var clientKey = agendaMergeFieldKey_(incoming, field);
    var currentKey = agendaMergeFieldKey_(current, field);
    return { field: field, local: !field.readOnly && clientKey !== agendaMergeFieldKey_(base.form, field),
      remote: currentKey !== agendaMergeFieldKey_(base.raw, field), same: clientKey === currentKey };
  });
  var conflicts = [];
  function add(field) { if (conflicts.indexOf(field.label) < 0) conflicts.push(field.label); }
  states.forEach(function(state) {
    if (state.local && state.remote && !state.same) add(state.field);
    if (state.field.context && ((state.local && states.some(function(s) { return s !== state && s.remote; })) ||
        (state.remote && states.some(function(s) { return s !== state && s.local; })))) add(state.field);
    if (state.field.config && states.some(function(s) {
      return s !== state && (s.field.slot === state.field.slot || s.field.slotLink === state.field.slot) &&
        ((state.local && s.remote) || (state.remote && s.local));
    })) add(state.field);
    if (state.field.slotLink && state.remote && states.some(function(s) { return s.field.slot === state.field.slotLink && s.local; })) add(state.field);
  });
  if (conflicts.length) return { ok: false, reason: 'ALTERACOES_SOBREPOSTAS_OU_DEPENDENTES', fields: conflicts };
  var merged = Object.assign({}, dados);
  ['courier1', 'courier2', 'courier3', 'backup', 'backup2'].forEach(function(slot) { merged[slot] = Object.assign({}, incoming[slot]); });
  // Vinculos sao dados do servidor; nao aceitar referencias injetadas no payload.
  delete merged.backup2.agendamento;
  delete merged.backup2.agendamentos;
  states.forEach(function(state) {
    var field = state.field;
    if (field.readOnly) return;
    // Sem alteracao na identidade da linha, conservar os complementos hidratados
    // da referencia assinada, inclusive em eventos legados com campos vazios.
    var chosen = state.local || (field.context && !state.remote) ? incoming : current;
    field.keys.forEach(function(key) {
      if (field.slot) merged[field.slot][key] = (chosen[field.slot] || {})[key];
      else merged[key] = chosen[key];
    });
  });
  // O gravador legado prioriza idParticipante sobre participanteId.
  merged.idParticipante = merged.participanteId;
  merged.statusRequisicao = merged.statusRequisicao || '';
  return { ok: true, dados: merged, preserved: states.filter(function(s) { return s.remote && !s.local; }).map(function(s) { return s.field.label; }) };
}
