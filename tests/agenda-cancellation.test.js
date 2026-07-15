'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, runHtmlScript } = require('./helpers/load-app-script');

test('servidor reconhece variacoes de status cancelado', () => {
  const context = runFile('AgendaServerRules.gs');
  const rules = context.AgendaServerRules_;

  ['Cancelado', 'CANCELADA', 'cancelamento confirmado'].forEach((status) => {
    assert.equal(rules.isCancelled(status), true, status);
    assert.equal(rules.isTerminalStatus(status), true, status);
  });
  assert.equal(rules.isCancelled('Reagendado'), false);
});

test('interface mantem cancelados visiveis, mas bloqueia efeitos indevidos', () => {
  const rules = runHtmlScript('SharedAgendaRules.html').AgendaRules;
  const event = { status: 'Cancelado', tipo: 'Visita', labCentral: 'Sim' };

  assert.equal(rules.isVisibleIn(event, rules.Context.LIST), true);
  assert.equal(rules.isVisibleIn(event, rules.Context.WEEK), true);
  assert.equal(rules.isVisibleIn(event, rules.Context.TRANSPORT), true);
  assert.equal(rules.isVisibleIn(event, rules.Context.REQUESTS), false);
  assert.equal(rules.canPerform(event, rules.Action.ADD_TO_GOOGLE_CALENDAR), false);
  assert.equal(rules.countsIn(event, 'cancelamentos'), true);
  assert.equal(rules.countsIn(event, 'dashboard-transportes-realizados'), false);
  assert.equal(rules.countsIn(event, 'lab-central'), false);
});

test('servidor e interface classificam os mesmos status da mesma forma', () => {
  const server = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const client = runHtmlScript('SharedAgendaRules.html').AgendaRules;
  const statuses = ['Agendado', 'Cancelado', 'Realizado', 'Concluido', 'Reagendado', 'Nao agendado'];

  statuses.forEach((status) => {
    assert.equal(client.statusKey(status), server.statusKey(status), status);
  });
});
