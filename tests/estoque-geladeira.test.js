'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runFile, readProjectFile } = require('./helpers/load-app-script');

function fixture(propriedade) {
  const props = { value: propriedade === undefined ? null : propriedade };
  const server = runFiles(['WebApp.gs', 'EstoqueGeladeira.gs'], {
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: () => props.value,
      setProperty: (_key, value) => { props.value = value; }
    }) },
    SpreadsheetApp: { getActiveSpreadsheet() { throw new Error('leu a planilha'); } }
  });
  server.codexAssertCanRead_ = () => {};
  server.codexAssertCanWrite_ = () => {};
  return { server, props };
}

const RPCS_BLOQUEADAS = [
  'getEstoqueBootstrapData', 'salvarItemEstoque', 'excluirItemEstoque', 'salvarPlanejamentoPedidoEstoque',
  'salvarPedidoEstoque', 'excluirPedidoEstoque', 'receberPedidoEstoque', 'registrarMovimentacaoEstoque',
  'transferirKitEstoque', 'conciliarReservaKitLaboratorio', 'getAgendaCandidatosReservaKit', 'vincularReservaKitAgenda',
  'baixarKitsAgendaEvento', 'devolverKitsAgendaEvento', 'salvarPlanejamentoDescarteEstoque', 'efetivarDescarteEstoque',
  'migrarIdsLotesEstoque', 'cancelarReservaKitAgenda', 'ajustarReservaKitAgenda', 'substituirReservaKitAgenda',
  'registrarExcecaoKitEstoque', 'reservarKitsAgendaEvento', 'consultarReservaPreviaJornada', 'reservarKitsPrevisaoJornada'
];

test('Estoque nasce congelado e a propriedade de script religa sem publicar', () => {
  assert.equal(fixture().server.codexEstoqueCongelado_(), true);
  assert.equal(fixture('').server.codexEstoqueCongelado_(), true);
  assert.equal(fixture('false').server.codexEstoqueCongelado_(), false);
  assert.equal(fixture('true').server.codexEstoqueCongelado_(), true);
});

test('falha ao ler a propriedade mantem o padrao do codigo', () => {
  const { server } = fixture();
  server.PropertiesService = { getScriptProperties() { throw new Error('indisponivel'); } };
  assert.equal(server.codexEstoqueCongelado_(), true);
});

test('sem o arquivo da chave o modulo continua ativo', () => {
  const server = runFile('WebApp.gs', { Logger: { log() {} } });
  assert.equal(server.codexEstoqueCongelado_(), false);
  assert.doesNotThrow(() => server.codexAssertEstoqueAtivo_());
});

test('RPCs do Estoque recusam a operacao antes de tocar a planilha', () => {
  const { server } = fixture();
  RPCS_BLOQUEADAS.forEach(nome => {
    assert.throws(() => server[nome]({}), /módulo de Estoque está desativado/, nome);
  });
});

test('toda RPC bloqueada tem a guarda na primeira linha', () => {
  const fonte = readProjectFile('WebApp.gs').replace(/\r\n/g, '\n');
  RPCS_BLOQUEADAS.forEach(nome => {
    assert.match(fonte, new RegExp('function ' + nome + '\\([^)]*\\) \\{\\n  codexAssertEstoqueAtivo_\\(\\);'), nome);
  });
});

test('Agenda nao le o Estoque e devolve estados vazios', () => {
  const { server } = fixture();
  server.getEstoque = () => { throw new Error('leu o Estoque'); };
  assert.equal(server.getAgendaKitsEstoque_(true).length, 0);
  assert.equal(server.getKitsAgendaBaixaStatus('A').baixados, false);
  const reserva = server.getKitsAgendaReservaStatus('A');
  assert.equal(reserva.reservado, false);
  assert.equal(reserva.encerrado, false);
});

test('rotas do Estoque caem na Agenda; as demais nao mudam', () => {
  const { server } = fixture();
  assert.equal(server.codexInitialPage_('estoque-view', false), 'agenda');
  assert.equal(server.codexInitialPage_('estoque', false), 'agenda');
  assert.equal(server.codexInitialPage_('farmacia', false), 'farmacia');
  assert.equal(fixture('false').server.codexInitialPage_('estoque-view', false), 'estoque-view');
});

test('cancelar visita segue liberando reservas com o modulo congelado', () => {
  const { server } = fixture();
  let escritas = 0;
  const sheet = {
    getLastRow: () => 2,
    getRange: () => ({
      getValues: () => [['R1', '', 'A', '', '', '', '', '', '', '', 1, 'Reservado', '', '', '', '', '', '']],
      setValue: () => { escritas++; }
    })
  };
  server.SpreadsheetApp = { getActiveSpreadsheet: () => ({}) };
  server.getSheetByPossibleNames_ = () => sheet;
  server.agendaInvalidateKitsReference_ = () => {};
  assert.equal(server.cancelarReservasKitsAgenda_('A', 'motivo'), 1);
  assert.equal(escritas, 2);
});

test('administrador alterna a chave e invalida a lista de kits', () => {
  const { server, props } = fixture();
  let invalidacoes = 0;
  server.codexAssertAdmin_ = () => {};
  server.agendaInvalidateKitsReference_ = () => { invalidacoes++; };
  assert.equal(server.religarEstoqueModuloAdmin().congelado, false);
  assert.equal(props.value, 'false');
  assert.equal(server.codexEstoqueCongelado_(), false);
  assert.equal(server.congelarEstoqueModuloAdmin().congelado, true);
  assert.equal(props.value, 'true');
  assert.equal(invalidacoes, 2);
});

test('apenas administrador alterna a chave', () => {
  const { server, props } = fixture();
  server.codexAssertAdmin_ = () => { throw new Error('Acesso permitido apenas para administradores.'); };
  assert.throws(() => server.religarEstoqueModuloAdmin(), /administradores/);
  assert.equal(props.value, null);
});
