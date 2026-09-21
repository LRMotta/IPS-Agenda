'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile, runHtmlScript } = require('./helpers/load-app-script');

function rules() {
  return runFile('AgendaServerRules.gs').AgendaServerRules_;
}

test('eventos no mesmo dia e horario sao permitidos', () => {
  assert.equal(rules().allowsConcurrentEvents(), true);
});

test('visita aceita fluxo de transporte e exige horario', () => {
  const agenda = rules();
  const policy = agenda.formPolicy('Visita');
  assert.equal(policy.requiresTime, true);
  assert.equal(policy.isVisit, true);
  assert.equal(agenda.hasTransportOperation('Visita'), true);
});

test('monitoria exige projeto, monitor, local e horario', () => {
  const policy = rules().formPolicy('Monitoria');
  assert.equal(policy.requiresProject, true);
  assert.equal(policy.requiresMonitorAndRoom, true);
  assert.equal(policy.requiresTime, true);
  assert.equal(policy.isOperationalPeriod, true);
});

test('SIV exige projeto, permite periodo e nao exige horario', () => {
  const policy = rules().formPolicy('SIV');
  assert.equal(policy.requiresProject, true);
  assert.equal(policy.isOperationalPeriod, true);
  assert.equal(policy.requiresTime, false);
});

test('auditoria aceita periodo de multiplos dias sem virar monitoria', () => {
  const agenda = rules();
  const policy = agenda.formPolicy('Auditoria');
  assert.equal(policy.isMultiDay, true);
  assert.equal(policy.isOperationalPeriod, false);
  assert.equal(policy.requiresProject, false);
  assert.equal(policy.requiresMonitorAndRoom, false);
  assert.equal(policy.requiresTime, true);
  assert.equal(agenda.isMultiDay('Auditoria'), true);
});

test('notificacao inicial ocorre somente para Lab Central ainda nao avisado', () => {
  const agenda = rules();
  assert.equal(agenda.notificationAction({ labCentral: 'Sim', status: 'Agendado', control: '' }), 'agendamento');
  assert.equal(agenda.notificationAction({ labCentral: 'Nao', status: 'Agendado', control: '' }), '');
});

test('mudanca de data notificada gera reagendamento', () => {
  const agenda = rules();
  assert.equal(agenda.notificationAction({ labCentral: 'Sim', status: 'Agendado', control: 'Notificado 10/07/2026', dateChanged: true }), 'reagendamento');
  assert.equal(agenda.notificationAction({ labCentral: 'Sim', status: 'Agendado', control: 'Notificado 10/07/2026', dateChanged: false }), '');
});

test('cancelamento avisado gera uma notificacao de cancelamento', () => {
  const agenda = rules();
  assert.equal(agenda.notificationAction({ labCentral: 'Sim', status: 'Cancelado', control: 'Notificado 10/07/2026' }), 'cancelamento');
  assert.equal(agenda.notificationAction({ labCentral: 'Sim', status: 'Cancelado', control: 'Cancelado' }), '');
});

test('cliente e servidor restringem estados fisicos do courier antes da visita', () => {
  const server = rules();
  const client = runHtmlScript('SharedAgendaRules.html').AgendaRules;
  ['Coletado', 'Enviado', 'Entregue'].forEach((status) => {
    assert.equal(server.courierStatusRequiresEventDate(status), true, status);
    assert.equal(client.courierStatusRequiresEventDate(status), true, status);
  });
  ['Não Agendado', 'Pendente', 'Agendado', 'Confirmado', 'Cancelado'].forEach((status) => {
    assert.equal(server.courierStatusRequiresEventDate(status), false, status);
    assert.equal(client.courierStatusRequiresEventDate(status), false, status);
  });
});

test('exames de imagem e laboratoriais exigem servico terceirizado e nao permitem Lab Central', () => {
  const server = rules();
  const client = runHtmlScript('SharedAgendaRules.html').AgendaRules;
  const source = readProjectFile('IndexAgendaScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const styles = readProjectFile('IndexStylesAfterDashboard.html');
  const webApp = readProjectFile('WebApp.gs');

  ['Exame de imagem', 'Exames laboratoriais'].forEach((tipo) => {
    assert.equal(server.formPolicy(tipo).labChoiceAllowed, false, tipo);
    assert.equal(client.formPolicy(tipo).labChoiceAllowed, false, tipo);
    assert.equal(server.formPolicy(tipo).requiresThirdPartyService, true, tipo);
    assert.equal(client.formPolicy(tipo).requiresThirdPartyService, true, tipo);
  });
  assert.equal(server.formPolicy('Visita').requiresThirdPartyService, false);
  assert.match(source, /id: 'agPrestador', err: 'errAgPrestador'/);
  assert.match(source, /policy\.requiresThirdPartyService/);
  assert.match(source, /agLabCentralDisabledHint/);
  assert.match(content, /id="agLabCentralDisabledHint"/);
  assert.match(styles, /#agLabCentral:disabled\{background:#f2f5fa/);
  assert.match(webApp, /policy\.requiresThirdPartyService[\s\S]*Informe o servi[cç]o terceirizado/);
  assert.match(webApp, /function atualizarAgendaEventoCompleto[\s\S]*policy\.requiresThirdPartyService[\s\S]*Informe o servi[cç]o terceirizado/);
});

test('agenda exibe envios individuais no minipainel e reaproveita o chip AWB da persiana', () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  const styles = readProjectFile('IndexStylesAfterDashboard.html');
  const awbHtml = source.slice(source.indexOf('function agendaAwbHtml'), source.indexOf('function agendaTrackingUrl'));
  const sidePanel = source.slice(source.indexOf('function agendaSidePanelHtml'), source.indexOf('function agendaCourierEntries_'));
  const logisticsRow = source.slice(source.indexOf('function agendaLogisticaLinhaHtml_'), source.indexOf('function agendaCourierEntries_'));

  assert.match(source, /function agendaCourierEntries_\(r\)/);
  assert.match(source, /courier: r\.courier1/);
  assert.match(source, /courier: r\.courier2/);
  assert.match(source, /courier: r\.courier3/);
  assert.match(source, /courier: r\.backup/);
  assert.match(source, /label: 'Transporte I'/);
  assert.match(source, /label: 'Transporte II'/);
  assert.match(source, /label: 'Transporte III'/);
  assert.match(source, /data-logistics-count/);
  assert.match(source, /agendaToggleDetail/);
  assert.doesNotMatch(awbHtml, /agendaLogisticaRastreioHtml_/);
  assert.match(sidePanel, /entries\.map\(agendaLogisticaLinhaHtml_\)/);
  assert.doesNotMatch(sidePanel, /summary\.statuses/);
  assert.match(logisticsRow, /agendaAwbHtml\(courier\.awb, courier\.nome\)/);
  assert.match(logisticsRow, /ag-st-chip ag-ch-/);
  assert.doesNotMatch(source, /agendaLogisticaRastreioHtml_/);
  assert.doesNotMatch(source, /abrirPendenciaTracking\(event/);
  assert.doesNotMatch(source, /travel_explore/);
  assert.doesNotMatch(source, /X acompanhados/);
  assert.doesNotMatch(source, /agendaToggleLogisticaPopover/);
  assert.doesNotMatch(source, /ag-log-popover/);
  assert.doesNotMatch(styles, /ag-log-popover/);
  assert.doesNotMatch(styles, /logistics-popover-open/);
  assert.match(styles, /\.ag-log-row/);
  assert.match(styles, /\.ag-log-row-awb \.ag-awb/);
});
