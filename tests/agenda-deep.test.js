'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

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
