'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFile, readProjectFile } = require('./helpers/load-app-script');

for (const name of ['enviarEmailAgendamento_', 'enviarEmailReagendamento_', 'enviarEmailCancelamento_']) {
  test(name + ' inclui link direto com ID codificada e HTML seguro', () => {
    const sent = [];
    const server = runFile('WebApp.gs', {
      AGENDA_CFG: { lastCol: 3, idx: { id: 0, projeto: 1, data: 2 } },
      ScriptApp: { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) },
      CodexExternalEffects_: { sendEmail: message => sent.push(message) }
    });
    for (const helper of ['gerarHtmlCabecalhoEmail_', 'gerarTabelaAgendaEmail_', 'gerarHtmlCouriers_', 'gerarRodapeEmailAgenda_', 'agendaCancelamentoMotivoHtml_']) server[helper] = () => '';
    server.agendaTemLogisticaEmail_ = () => false;
    server.gerarListaDestinatarios_ = () => 'test@example.invalid';
    server.formatarDataSafe = () => '01/01/2027';
    const id = 'EVT /&?#"';
    const sheet = { getRange: () => ({ getValues: () => [[id, 'Teste', '2027-01-01']] }) };
    server[name](sheet, 2, {}, '2026-12-01');
    assert.equal(sent.length, 1);
    assert.ok(sent[0].htmlBody.includes('href="https://example.invalid/exec?pagina=agenda&amp;agendaId=' + encodeURIComponent(id) + '"'));
    assert.match(sent[0].htmlBody, />Abrir Agendamento<\/a>/);
    assert.doesNotMatch(sent[0].htmlBody, /Abrir Agenda<\/a>/);
  });
}

for (const mode of ['local', 'outside', 'missing', 'error']) {
  test('link inicial abre evento: ' + mode, () => {
    const source = readProjectFile('IndexAgendaScripts.html');
    const start = source.indexOf('  function agendaAbrirPendenteAposCarga()');
    const end = source.indexOf('  function abrirAgendaRegistroPorId', start);
    const opened = [], errors = [], fetched = [];
    const context = vm.createContext({
      _agendaAbrirAposCarga: 'EVT-42',
      agendaFindEventoLocal_: () => mode === 'local',
      abrirAgendaEdicao: id => opened.push(id),
      snackErro: error => errors.push(error),
      appErrorMessage: error => error.message,
      agendaFetchEventoPorId_: (id, row, success, failure) => {
        fetched.push(id);
        if (mode === 'error') failure(new Error('Falha simulada'));
        else success(mode === 'missing' ? null : { id });
      }
    });
    vm.runInContext(source.slice(start, end), context);
    context.agendaAbrirPendenteAposCarga();
    assert.equal(context._agendaAbrirAposCarga, '');
    assert.deepEqual(opened, ['local', 'outside'].includes(mode) ? ['EVT-42'] : []);
    assert.equal(fetched.length, mode === 'local' ? 0 : 1);
    assert.equal(errors.length, ['missing', 'error'].includes(mode) ? 1 : 0);
  });
}
