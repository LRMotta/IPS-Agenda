// Regras puras da Agenda usadas no servidor. Mantenha a semantica alinhada a SharedAgendaRules.html.
var AgendaServerRules_ = (function() {
  'use strict';

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function statusKey(eventOrStatus) {
    var status = normalizeText(
      eventOrStatus && typeof eventOrStatus === 'object'
        ? eventOrStatus.status
        : eventOrStatus
    );
    if (status.indexOf('cancel') > -1) return 'cancelado';
    if (status.indexOf('nao agend') > -1) return 'naoagendado';
    if (status.indexOf('confirm') > -1) return 'confirmado';
    if (status.indexOf('envi') > -1) return 'enviado';
    if (status.indexOf('entreg') > -1) return 'entregue';
    if (status.indexOf('realiz') > -1) return 'realizado';
    if (status.indexOf('concl') > -1) return 'concluido';
    if (status.indexOf('reag') > -1) return 'reagendado';
    if (status.indexOf('pend') > -1) return 'pendente';
    return 'agendado';
  }

  function typeKey(eventOrType) {
    var type = normalizeText(
      eventOrType && typeof eventOrType === 'object'
        ? eventOrType.tipo
        : eventOrType
    );
    if (type.indexOf('monitoria') > -1) return 'monitoria';
    if (type === 'siv' || type.indexOf('site initiation') > -1) return 'siv';
    if (type.indexOf('close-out') > -1 || type.indexOf('closeout') > -1) return 'closeout';
    if (type.indexOf('visita') > -1) return 'visita';
    if (type.indexOf('consulta') > -1) return 'consulta';
    if (type.indexOf('imagem') > -1) return 'exame-imagem';
    if (type.indexOf('laborator') > -1) return 'exame-laboratorial';
    if (type.indexOf('amostra') > -1) return 'envio-amostras';
    if (type.indexOf('feriado') > -1) return 'feriado';
    if (type.indexOf('reuniao') > -1) return 'reuniao';
    if (type.indexOf('auditoria') > -1) return 'auditoria';
    return type || 'evento';
  }

  function isCancelled(eventOrStatus) {
    return statusKey(eventOrStatus) === 'cancelado';
  }

  function isStatus(eventOrStatus, expectedStatus) {
    return statusKey(eventOrStatus) === String(expectedStatus || '').toLowerCase();
  }

  function isType(eventOrType, expectedType) {
    return typeKey(eventOrType) === String(expectedType || '').toLowerCase();
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

  function isOperationalPeriod(eventOrType) {
    return isMonitoring(eventOrType) || isSiv(eventOrType);
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

  function hasTransportOperation(eventOrType) {
    var type = typeKey(eventOrType);
    return type === 'visita' || type === 'envio-amostras';
  }

  function isLabCentral(eventOrValue) {
    var value = eventOrValue && typeof eventOrValue === 'object'
      ? eventOrValue.labCentral
      : eventOrValue;
    return value === true || normalizeText(value) === 'sim';
  }

  function isPhoneContact(eventOrType) {
    var type = normalizeText(
      eventOrType && typeof eventOrType === 'object'
        ? eventOrType.tipo
        : eventOrType
    );
    return type.indexOf('contato telefonico') > -1 || type.indexOf('telefon') > -1;
  }

  function typeRequiresLabCentral(eventOrType) {
    if (isPhoneContact(eventOrType)) return false;
    var type = normalizeText(
      eventOrType && typeof eventOrType === 'object'
        ? eventOrType.tipo
        : eventOrType
    );
    return type.indexOf('visita') > -1 || type.indexOf('amostra') > -1;
  }

  function isPostVisitType(eventOrType) {
    return isVisit(eventOrType) || isPhoneContact(eventOrType);
  }

  function formPolicy(eventOrType) {
    var type = typeKey(eventOrType);
    var rawType = normalizeText(
      eventOrType && typeof eventOrType === 'object'
        ? eventOrType.tipo
        : eventOrType
    );
    var monitoring = type === 'monitoria';
    var siv = type === 'siv';
    var operationalPeriod = monitoring || siv;
    var technicalFieldsHidden = ['monitoria', 'siv', 'closeout', 'reuniao', 'feriado', 'auditoria', 'exame-imagem'].indexOf(type) > -1;
    var noLab = technicalFieldsHidden || isPhoneContact(eventOrType);
    return {
      type: type,
      isMonitoring: monitoring,
      isSiv: siv,
      isOperationalPeriod: operationalPeriod,
      isVisit: type === 'visita',
      requiresProject: operationalPeriod,
      requiresMonitorAndRoom: monitoring,
      requiresTime: !operationalPeriod || monitoring,
      labChoiceAllowed: !noLab,
      usesParticipantWorkflow: ['monitoria', 'siv', 'close-out', 'reuniao', 'feriado', 'auditoria', 'exame de imagem'].indexOf(rawType) === -1
    };
  }

  function requestObservationIndicatesSent(observation) {
    var text = normalizeText(observation);
    return (text.indexOf('requi') > -1 || /\breq\b/.test(text)) &&
      (text.indexOf('ok') > -1 || text.indexOf('enviad') > -1);
  }

  function requestIsSent(status, observation) {
    return normalizeText(status).indexOf('enviad') > -1 || requestObservationIndicatesSent(observation);
  }

  function courierStatusKey(statusValue) {
    var status = normalizeText(statusValue);
    if (status === 'nao aplicavel' || status === 'nao se aplica' || status === 'n/a' || status === 'na') return 'naoaplicavel';
    if (status.indexOf('nao agend') > -1) return 'naoagendado';
    if (status.indexOf('cancel') > -1) return 'cancelado';
    if (status.indexOf('confirm') > -1) return 'confirmado';
    if (status.indexOf('envi') > -1) return 'enviado';
    if (status.indexOf('entreg') > -1) return 'entregue';
    if (status.indexOf('colet') > -1) return 'confirmado';
    if (status.indexOf('agend') > -1) return 'agendado';
    if (status.indexOf('pend') > -1) return 'pendente';
    return 'pendente';
  }

  function courierIsNotApplicable(statusValue) {
    return courierStatusKey(statusValue) === 'naoaplicavel';
  }

  function courierIsSentNotDelivered(statusValue) {
    var status = normalizeText(statusValue);
    return status.indexOf('envi') > -1 && status.indexOf('entreg') === -1;
  }

  function courierIsDelivered(statusValue) {
    return courierStatusKey(statusValue) === 'entregue';
  }

  function courierIsDeliveryTerminal(statusValue) {
    var status = courierStatusKey(statusValue);
    return status === 'entregue' || status === 'cancelado' || status === 'naoagendado';
  }

  function courierIsAwaitingConfirmation(statusValue) {
    return normalizeText(statusValue) === 'agendado';
  }

  function courierCanReceiveConfirmation(statusValue) {
    var status = normalizeText(statusValue);
    return ['agendado', 'pendente', 'nao agendado', ''].indexOf(status) > -1;
  }

  function courierNeedsSchedule(statusValue, awb) {
    var status = normalizeText(statusValue);
    return status === 'nao agendado' || status === 'pendente' || (!status && !String(awb || '').trim());
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
    isOperationalPeriod: isOperationalPeriod,
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
    allowsConcurrentEvents: allowsConcurrentEvents,
    notificationAction: notificationAction
  });
})();
