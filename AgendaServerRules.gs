// Regras puras da Agenda usadas no servidor. Mantenha a semantica alinhada a SharedAgendaRules.html.
var AgendaServerRules_ = (function() {
  'use strict';

  // BEGIN GENERATED AGENDA RULES — editar tools/agenda-rules-core.js

  var typeDefinitions = Object.freeze([
    { key: 'monitoria', contains: ['monitoria'], singular: 'Monitoria', plural: 'Monitorias', css: 'ag-type-monitoria', icon: 'visibility', operational: true, multiDay: true, hidden: true, monitorAndRoom: true },
    { key: 'siv', exact: ['siv'], contains: ['site initiation'], singular: 'SIV', plural: 'SIV', css: 'ag-type-siv', icon: 'flag', operational: true, multiDay: true, hidden: true, noTime: true, visual: ' type-siv' },
    { key: 'closeout', contains: ['close-out', 'closeout'], singular: 'Close-out', plural: 'Close-outs', css: 'ag-type-closeout', icon: 'lock', hidden: true },
    { key: 'visita', contains: ['visita'], singular: 'Visita', plural: 'Visitas', css: 'ag-type-visita', icon: 'event_available', transport: true },
    { key: 'consulta', contains: ['consulta'], singular: 'Consulta', plural: 'Consultas', css: 'ag-type-consulta', icon: 'event', doctor: true },
    { key: 'exame-imagem', contains: ['imagem'], singular: 'Exame de imagem', plural: 'Exames de imagem', css: 'ag-type-imagem', icon: 'image_search', hidden: true, thirdParty: true },
    { key: 'exame-laboratorial', contains: ['laborator'], singular: 'Exame laboratorial', plural: 'Exames laboratoriais', css: 'ag-type-lab', icon: 'biotech', thirdParty: true, noLab: true },
    { key: 'envio-amostras', contains: ['amostra'], singular: 'Envio de amostras', plural: 'Envios de amostras', css: 'ag-type-amostras', icon: 'local_shipping', transport: true, technicalOnCreate: true },
    { key: 'feriado', contains: ['feriado'], singular: 'Feriado', plural: 'Feriados', css: 'ag-type-feriado', icon: 'event_busy', hidden: true, general: true },
    { key: 'reuniao', contains: ['reuniao'], singular: 'Reunião', plural: 'Reuniões', css: 'ag-type-reuniao', icon: 'groups', hidden: true, general: true },
    { key: 'auditoria', contains: ['auditoria'], singular: 'Auditoria', plural: 'Auditorias', css: 'ag-type-auditoria', icon: 'fact_check', hidden: true, general: true, multiDay: true },
    { key: 'contato telefonico', contains: ['telefon'], singular: 'Contato telefônico', plural: 'Contatos telefônicos', css: 'ag-type-default', icon: 'call', phone: true }
  ].map(function(definition) {
    if (definition.contains) Object.freeze(definition.contains);
    if (definition.exact) Object.freeze(definition.exact);
    return Object.freeze(definition);
  }));

  function normalizeText(value) {
    return String(value == null ? '' : value).normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  function normalizedType(value) {
    return normalizeText(value && typeof value === 'object' ? value.tipo : value);
  }

  function definitionForType(value) {
    return definitionForNormalizedType(normalizedType(value));
  }

  function definitionForNormalizedType(text) {
    for (var i = 0; i < typeDefinitions.length; i++) {
      var definition = typeDefinitions[i];
      if (text === definition.key || (definition.exact && definition.exact.indexOf(text) > -1)) return definition;
      var parts = definition.contains || [];
      for (var j = 0; j < parts.length; j++) {
        if (text.indexOf(parts[j]) > -1) return definition;
      }
    }
    return null;
  }

  function typeKey(value) {
    var definition = definitionForType(value);
    return definition ? definition.key : normalizedType(value) || 'evento';
  }

  function withoutNegatedStatusAssertions(text) {
    // Nao remover "nao agendado": ele possui uma chave de dominio propria.
    return text.replace(/\b(?:nao|nunca)\s+(?:(?:foi|foram|esta|estao|sera|serao)\s+)?(?:cancel\w*|envi\w*|entreg\w*|colet\w*|confirm\w*|realiz\w*|concl\w*|reag\w*)/g, '');
  }

  function recognizedStatus(text) {
    text = withoutNegatedStatusAssertions(text);
    if (text.indexOf('cancel') > -1) return 'cancelado';
    if (/nao[\s-]*agend/.test(text)) return 'naoagendado';
    if (text.indexOf('confirm') > -1) return 'confirmado';
    if (text.indexOf('envi') > -1) return 'enviado';
    if (text.indexOf('entreg') > -1) return 'entregue';
    if (text.indexOf('realiz') > -1) return 'realizado';
    if (text.indexOf('concl') > -1) return 'concluido';
    if (text.indexOf('reag') > -1) return 'reagendado';
    if (text.indexOf('pend') > -1) return 'pendente';
    if (text.indexOf('agend') > -1) return 'agendado';
    return '';
  }

  function statusKey(value) {
    var text = normalizeText(value && typeof value === 'object' ? value.status : value);
    return recognizedStatus(text) || 'agendado';
  }

  function isStatus(value, expected) {
    var text = normalizeText(expected).replace(/[\s-]+/g, '');
    var key = recognizedStatus(text);
    // A expectativa deve ser uma chave/rotulo conhecido, nao texto livre ou fallback.
    var known = !!key && (text === key || text === key.replace(/o$/, 'a'));
    return known && statusKey(value) === key;
  }

  function isType(value, expected) {
    return !!normalizedType(expected) && typeKey(value) === typeKey(expected);
  }

  function isPhoneContact(value) {
    return normalizedType(value).indexOf('telefon') > -1;
  }

  function hasTransportOperation(value) {
    var definition = definitionForType(value);
    return !!(definition && definition.transport) && !isPhoneContact(value);
  }

  function typeRequiresLabCentral(value) {
    return hasTransportOperation(value);
  }

  function formPolicy(value, isEditing) {
    // Classificar uma vez: todas as politicas derivam do mesmo tipo normalizado.
    var text = normalizedType(value);
    var definition = definitionForNormalizedType(text) || {};
    var phone = text.indexOf('telefon') > -1;
    return {
      type: definition.key || text || 'evento',
      isMonitoring: !!definition.monitorAndRoom,
      isSiv: definition.key === 'siv',
      isOperationalPeriod: !!definition.operational,
      isMultiDay: !!definition.multiDay,
      isVisit: definition.key === 'visita',
      hideGeneralEvent: !!definition.general,
      hideDetails: !!definition.hidden && definition.key !== 'exame-imagem',
      technicalFieldsAvailable: (!!isEditing || !!definition.technicalOnCreate) && !definition.hidden && !phone,
      labChoiceAllowed: !definition.hidden && !definition.noLab && !phone,
      requiresThirdPartyService: !!definition.thirdParty,
      requiresLabCentral: !!definition.transport && !phone,
      usesParticipantWorkflow: !definition.hidden,
      requiresProject: !!definition.operational,
      requiresMonitorAndRoom: !!definition.monitorAndRoom,
      requiresDoctor: !!definition.doctor,
      requiresTime: !definition.noTime
    };
  }

  function typePluralLabel(value, count, fallback) {
    var singular = Number(count) === 1;
    var definition = definitionForType(value);
    if (definition) return singular ? definition.singular : definition.plural;
    // Tipos personalizados podem fornecer rotulos explicitos sem alterar seu ID/tipo.
    var labels = fallback && typeof fallback === 'object' ? fallback : value && typeof value === 'object' ? value : {};
    var rawType = value && typeof value === 'object' ? value.tipo : value;
    var label = String(labels.singular || (typeof fallback === 'string' && fallback.trim() ? fallback : rawType) || 'Evento').trim() || 'Evento';
    return singular ? label : String(labels.plural || label + 's');
  }

  function typeClass(value) {
    var definition = definitionForType(value);
    return definition ? definition.css : 'ag-type-default';
  }

  function typeIcon(value) {
    var definition = definitionForType(value);
    return definition ? definition.icon : 'event';
  }

  function typeVisualClass(value) {
    var definition = definitionForType(value);
    return definition && definition.visual || '';
  }

  function requestSentPattern(requiresLabel) {
    var label = '(?:a\\s+)?(?:requisicao|requisicoes|req)\\s*[:=-]?\\s*';
    var assertion = '(?:(?:ja\\s+)?(?:foi|foram)\\s+)?(?:enviad[ao]s?|ok)';
    var date = '(?:\\s*(?:[-–]\\s*|em\\s+)?\\d{1,2}[/.–-](?:\\d{1,2}|[a-z]{3}\\.?)[/.–-]\\d{2,4}(?:\\s+\\d{1,2}:\\d{2})?)?';
    return new RegExp('^' + (requiresLabel ? label : '(?:' + label + ')?') + assertion + date + '$');
  }

  // Sem flag global: reutilizar os padroes nao deixa estado entre chamadas.
  var requestObservationSentPattern = requestSentPattern(true);
  var requestStatusSentPattern = requestSentPattern(false);

  function requestSentConfirmation(text, requiresLabel) {
    return (requiresLabel ? requestObservationSentPattern : requestStatusSentPattern).test(text);
  }

  function requestObservationIndicatesSent(observation) {
    // Somente afirmacoes explicitas: texto livre ambiguo nao confirma nem migra envio.
    var text = normalizeText(observation).replace(/\breq\.(?=\s)/g, 'req');
    var clauses = text.split(/[;\n]|\.(?=\s|$)/);
    var confirmed = false;
    for (var i = 0; i < clauses.length; i++) {
      var clause = clauses[i].trim();
      if (!clause) continue;
      if (/\b(?:requisicao|requisicoes|req)\b/.test(clause)) {
        if (!requestSentConfirmation(clause, true)) return false;
        confirmed = true;
      } else if (/\b(?:nao|nunca|ainda|sera|serao|talvez)\b.*\benviad[ao]s?\b/.test(clause) &&
        !/^(?:(?:o|a|os|as)\s+)?(?:transportes?|amostras?|couriers?|coletas?)\b/.test(clause)) {
        // Negacao sem outro sujeito explicito pode se referir a requisicao anterior.
        return false;
      }
    }
    return confirmed;
  }

  function requestIsSent(eventOrStatus, observation) {
    var status = eventOrStatus && typeof eventOrStatus === 'object'
      ? eventOrStatus.statusRequisicao
      : eventOrStatus;
    var obs = eventOrStatus && typeof eventOrStatus === 'object'
      ? eventOrStatus.obs
      : observation;
    var text = normalizeText(status).replace(/\breq\.(?=\s)/g, 'req');
    // O campo explicito e autoritativo; observacoes sao fallback apenas para legado vazio.
    return text ? requestSentConfirmation(text, false) : requestObservationIndicatesSent(obs);
  }

  function courierAffirmativeStatus(statusValue) {
    // Uma negacao nao comprova envio, entrega, coleta ou confirmacao.
    // Preservar outras afirmacoes: "Enviado; ainda nao entregue" continua enviado.
    return withoutNegatedStatusAssertions(normalizeText(statusValue));
  }

  function recognizedCourierStatus(status) {
    if (status === 'naoaplicavel' || status === 'nao aplicavel' || status === 'nao se aplica' || status === 'n/a' || status === 'na') return 'naoaplicavel';
    if (/nao[\s-]*agend/.test(status)) return 'naoagendado';
    if (status.indexOf('cancel') > -1) return 'cancelado';
    // Entrega e envio prevalecem sobre estados anteriores em rotulos compostos.
    if (status.indexOf('entreg') > -1) return 'entregue';
    if (status.indexOf('envi') > -1) return 'enviado';
    if (status.indexOf('confirm') > -1) return 'confirmado';
    if (status.indexOf('colet') > -1) return 'confirmado';
    if (status === 'docsgerados' || /^docs?\s+gerad/.test(status) || /^documentos?\s+gerad/.test(status)) return 'docsgerados';
    if (status.indexOf('agend') > -1) return 'agendado';
    if (status.indexOf('pend') > -1) return 'pendente';
    return '';
  }

  function courierStatusKey(statusValue) {
    return recognizedCourierStatus(courierAffirmativeStatus(statusValue)) || 'pendente';
  }

  function courierIsNotApplicable(statusValue) {
    return courierStatusKey(statusValue) === 'naoaplicavel';
  }

  function courierIsSentNotDelivered(statusValue) {
    return courierStatusKey(statusValue) === 'enviado';
  }

  function courierIsDelivered(statusValue) {
    return courierStatusKey(statusValue) === 'entregue';
  }

  function courierIsDeliveryTerminal(statusValue) {
    var status = courierStatusKey(statusValue);
    return status === 'entregue' || status === 'cancelado' || status === 'naoagendado';
  }

  function courierIsAwaitingConfirmation(statusValue) {
    return recognizedCourierStatus(courierAffirmativeStatus(statusValue)) === 'agendado';
  }

  function courierCanReceiveConfirmation(statusValue) {
    if (!normalizeText(statusValue)) return true;
    // Nao usar o fallback "pendente" para autorizar mutacoes em texto desconhecido.
    var status = recognizedCourierStatus(courierAffirmativeStatus(statusValue));
    return ['agendado', 'pendente', 'naoagendado'].indexOf(status) > -1;
  }

  function courierNeedsSchedule(statusValue, awb) {
    if (!normalizeText(statusValue)) return !String(awb || '').trim();
    var status = recognizedCourierStatus(courierAffirmativeStatus(statusValue));
    return status === 'naoagendado' || status === 'pendente';
  }

  function courierStatusRequiresEventDate(statusValue) {
    var status = courierAffirmativeStatus(statusValue);
    return status.indexOf('colet') > -1 || status.indexOf('envi') > -1 || status.indexOf('entreg') > -1;
  }
  // END GENERATED AGENDA RULES

  function isCancelled(eventOrStatus) {
    return statusKey(eventOrStatus) === 'cancelado';
  }

  function isRescheduled(eventOrStatus) {
    return statusKey(eventOrStatus) === 'reagendado';
  }

  function isRealized(eventOrStatus) {
    return statusKey(eventOrStatus) === 'realizado';
  }

  function isConcluded(eventOrStatus) {
    return statusKey(eventOrStatus) === 'concluido';
  }

  function isCompleted(eventOrStatus) {
    var status = statusKey(eventOrStatus);
    return status === 'realizado' || status === 'concluido';
  }

  function isSiv(eventOrType) {
    return isType(eventOrType, 'siv');
  }

  function isCloseout(eventOrType) {
    return isType(eventOrType, 'closeout');
  }

  function isOperationalPeriod(eventOrType) {
    return isMonitoring(eventOrType) || isSiv(eventOrType);
  }

  function isMultiDay(eventOrType) {
    return isOperationalPeriod(eventOrType) || isType(eventOrType, 'auditoria');
  }

  function isTerminalStatus(eventOrStatus) {
    return isCancelled(eventOrStatus) || isCompleted(eventOrStatus);
  }

  function sameStatus(a, b) {
    return normalizeText(a) === normalizeText(b);
  }

  function sameType(a, b) {
    return normalizeText(a) === normalizeText(b);
  }

  function isMonitoring(eventOrType) {
    return typeKey(eventOrType) === 'monitoria';
  }

  function isVisit(eventOrType) {
    return typeKey(eventOrType) === 'visita';
  }

  function isLabCentral(eventOrValue) {
    var value = eventOrValue && typeof eventOrValue === 'object'
      ? eventOrValue.labCentral
      : eventOrValue;
    return value === true || normalizeText(value) === 'sim';
  }

  function isPostVisitType(eventOrType) {
    return isVisit(eventOrType) || isPhoneContact(eventOrType);
  }

  // A Agenda representa uma equipe em varios locais. Eventos simultaneos sao validos.
  function allowsConcurrentEvents() {
    return true;
  }

  function notificationAction(state) {
    state = state || {};
    var labCentral = isLabCentral(state.labCentral);
    var cancelled = isCancelled(state.status);
    var control = normalizeText(state.control);
    var alreadyNotified = control.indexOf('notificado') > -1 || control.indexOf('reagendado') > -1;
    if (labCentral && !cancelled && !alreadyNotified) return 'agendamento';
    if (labCentral && !cancelled && state.dateChanged === true && alreadyNotified) return 'reagendamento';
    if (cancelled && alreadyNotified) return 'cancelamento';
    return '';
  }

  return Object.freeze({
    normalizeText: normalizeText,
    statusKey: statusKey,
    typeKey: typeKey,
    isCancelled: isCancelled,
    isStatus: isStatus,
    isType: isType,
    isRescheduled: isRescheduled,
    isRealized: isRealized,
    isConcluded: isConcluded,
    isCompleted: isCompleted,
    isSiv: isSiv,
    isCloseout: isCloseout,
    isOperationalPeriod: isOperationalPeriod,
    isMultiDay: isMultiDay,
    isTerminalStatus: isTerminalStatus,
    sameStatus: sameStatus,
    sameType: sameType,
    isMonitoring: isMonitoring,
    isVisit: isVisit,
    hasTransportOperation: hasTransportOperation,
    isLabCentral: isLabCentral,
    isPhoneContact: isPhoneContact,
    typeRequiresLabCentral: typeRequiresLabCentral,
    isPostVisitType: isPostVisitType,
    formPolicy: formPolicy,
    requestObservationIndicatesSent: requestObservationIndicatesSent,
    requestIsSent: requestIsSent,
    courierStatusKey: courierStatusKey,
    courierIsNotApplicable: courierIsNotApplicable,
    courierIsSentNotDelivered: courierIsSentNotDelivered,
    courierIsDelivered: courierIsDelivered,
    courierIsDeliveryTerminal: courierIsDeliveryTerminal,
    courierIsAwaitingConfirmation: courierIsAwaitingConfirmation,
    courierCanReceiveConfirmation: courierCanReceiveConfirmation,
    courierNeedsSchedule: courierNeedsSchedule,
    courierStatusRequiresEventDate: courierStatusRequiresEventDate,
    allowsConcurrentEvents: allowsConcurrentEvents,
    notificationAction: notificationAction
  });
})();
