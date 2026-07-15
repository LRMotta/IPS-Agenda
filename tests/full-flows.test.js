'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function cadastroContext(spreadsheet, projectOptions) {
  const web = readProjectFile('WebApp.gs');
  const source = readProjectFile('CadastroRules.gs') + '\n' +
    between(web, 'function salvarDadosProjeto(', 'function excluirProjeto(') + '\n' +
    between(web, 'function salvarDadosParticipante(', 'function corrigirMatrizIdadeParticipantes(');
  const counters = { cache: 0, transportCache: 0 };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    codexAssertCanWrite_: () => ({ ok: true }),
    clearTransporteOptionsCache_: () => { counters.transportCache++; },
    clearCodexRuntimeCaches_: () => { counters.cache++; },
    getProjetosParticipantesOptions_: () => projectOptions || [],
    Date
  });
  vm.runInContext(source, context);
  return { context, counters };
}

const validProject = {
  nomeAbreviado: 'Novo Estudo', codigo: 'NOV-01', fase: 'III', status: 'Ativo',
  especialidade: 'Oncologia', investigador: 'Investigador Teste'
};

test('fluxo completo cria e atualiza projeto em planilha simulada', () => {
  const sheet = new FakeSheet('Projetos', [
    ['ID', 'Nome', 'Codigo', 'Especialidade', 'Fase', 'Investigador'],
    ['PROJ-1', 'Estudo Existente', 'EX-01', 'Cardiologia', 'II', 'Investigador A']
  ]);
  const { context, counters } = cadastroContext(new FakeSpreadsheet({ Projetos: sheet }));

  assert.equal(context.salvarDadosProjeto(validProject), 'Projeto cadastrado com sucesso!');
  assert.equal(sheet.rows.length, 3);
  assert.match(String(sheet.rows[2][0]), /^PROJ-/);
  const createdId = sheet.rows[2][0];
  assert.equal(counters.transportCache, 1);

  assert.equal(context.salvarDadosProjeto(Object.assign({}, validProject, { id: createdId, fase: 'IV' })), 'Projeto atualizado com sucesso!');
  assert.equal(sheet.rows[2][4], 'IV');
  assert.equal(counters.transportCache, 2);
});

test('duplicidade de projeto interrompe o fluxo antes de qualquer escrita', () => {
  const sheet = new FakeSheet('Projetos', [
    ['ID', 'Nome', 'Codigo'],
    ['PROJ-1', 'Novo Estudo', 'EX-01']
  ]);
  const { context } = cadastroContext(new FakeSpreadsheet({ Projetos: sheet }));
  assert.throws(() => context.salvarDadosProjeto(validProject), /nome abreviado/);
  assert.equal(sheet.writes, 0);
  assert.equal(sheet.rows.length, 2);
});

test('fluxo completo cria e atualiza participante vinculado', () => {
  const sheet = new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status', 'Telefone', 'CPF', 'Obs'],
    [4, 'Pessoa Existente', '', '', 'P-004', 'Novo Estudo', '', '', 'Ativo', '', '', '']
  ]);
  const options = [{ nome: 'Novo Estudo', codigo: 'NOV-01' }];
  const { context, counters } = cadastroContext(new FakeSpreadsheet({ Participantes: sheet }), options);
  const participant = {
    nome: 'Pessoa Nova', dataNascimento: '1990-05-10', idParticipante: 'P-005',
    projeto: 'Novo Estudo', status: 'Ativo', cpf: '11122233344'
  };

  assert.equal(context.salvarDadosParticipante(participant), 'Participante cadastrado com sucesso');
  assert.equal(sheet.rows[2][0], 5);
  assert.equal(sheet.rows[2][5], 'Novo Estudo');
  assert.equal(counters.cache, 1);

  assert.equal(context.salvarDadosParticipante(Object.assign({}, participant, { id: 5, telefone: '555-0100' })), 'Participante atualizado com sucesso');
  assert.equal(sheet.rows[2][9], '555-0100');
  assert.equal(counters.cache, 2);
});

test('vinculo ou duplicidade invalida nao altera participantes', () => {
  const rows = [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status', 'Telefone', 'CPF'],
    [1, 'Pessoa A', '', '', 'P-001', 'Novo Estudo', '', '', 'Ativo', '', '12345678900']
  ];
  const sheet = new FakeSheet('Participantes', rows);
  const { context } = cadastroContext(new FakeSpreadsheet({ Participantes: sheet }), [{ nome: 'Novo Estudo' }]);

  assert.throws(() => context.salvarDadosParticipante({ nome: 'Pessoa B', idParticipante: 'P-002', projeto: 'Inexistente', status: 'Ativo' }), /projeto cadastrado/);
  assert.equal(sheet.writes, 0);
  assert.throws(() => context.salvarDadosParticipante({ nome: 'Pessoa B', idParticipante: 'P-001', projeto: 'Novo Estudo', status: 'Ativo' }), /mesmo projeto/);
  assert.equal(sheet.writes, 0);
});

function agendaCancellationContext(sheet) {
  const web = readProjectFile('WebApp.gs');
  const helpers = between(web, 'function agendaNormalizeCancelamentoMotivo_(', 'function agendaPostVisitValue_(');
  const cancellation = between(web, 'function cancelarAgendaEvento(', 'function atualizarStatusRequisicaoAgenda(');
  const calls = { notifications: 0, audits: 0 };
  const context = vm.createContext({
    AGENDA_CFG: { lastCol: 5, idx: { status: 1, obs: 2, labCentral: 3 }, col: { status: 2, obs: 3, labCentral: 4 } },
    normText_: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(),
    codexAssertCanWrite_: () => ({ ok: true }),
    codexWithDocumentLock_: (_name, callback) => callback(),
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}), flush: () => {} },
    getAgendaSheet_: () => sheet,
    encontrarLinhaPorId: (_sheet, id) => id === 'EVT-1' ? 2 : 0,
    aplicarLogicaCancelamento: () => {},
    verificarNotificacoes: () => { calls.notifications++; },
    codexWriteAuditChanges_: () => { calls.audits++; },
    agendaAuditChangesFromRows_: () => [{ field: 'Status' }],
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@example.invalid' }) }
  });
  vm.runInContext(helpers + '\n' + cancellation, context);
  return { context, calls };
}

test('fluxo completo cancela evento, registra motivo, notifica e audita', () => {
  const sheet = new FakeSheet('Agenda', [
    ['ID', 'Status', 'Obs', 'Lab', 'Outro'],
    ['EVT-1', 'Agendado', 'Observacao anterior', 'Sim', '']
  ]);
  const { context, calls } = agendaCancellationContext(sheet);
  const result = context.cancelarAgendaEvento('EVT-1', { categoria: 'Participante', motivo: 'Desistencia' });

  assert.equal(result.ok, true);
  assert.equal(sheet.rows[1][1], 'Cancelado');
  assert.match(sheet.rows[1][2], /Categoria: Participante.*Motivo: Desistencia/);
  assert.equal(calls.notifications, 1);
  assert.equal(calls.audits, 1);
});

test('cancelamento sem motivo nao escreve nem notifica', () => {
  const sheet = new FakeSheet('Agenda', [
    ['ID', 'Status', 'Obs', 'Lab', 'Outro'],
    ['EVT-1', 'Agendado', '', 'Sim', '']
  ]);
  const { context, calls } = agendaCancellationContext(sheet);
  assert.throws(() => context.cancelarAgendaEvento('EVT-1', {}), /motivo do cancelamento/);
  assert.equal(sheet.writes, 0);
  assert.equal(sheet.rows[1][1], 'Agendado');
  assert.equal(calls.notifications, 0);
});

function transportSyncContext(sheet) {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const sync = between(source, 'function transporteSincronizarAgenda_(', 'function importarTransporteCodex(');
  const context = vm.createContext({
    AGENDA_CFG: { idx: {
      c1: { nome: 0, temp: 1, status: 2, awb: 3, material: 4, matBio: 5, destino: 6 },
      c2: { nome: 7, temp: 8, status: 9, awb: 10, material: 11, matBio: 12, destino: 13 },
      c3: { nome: 14, temp: 15, status: 16, awb: 17, material: 18, matBio: 19, destino: 20 },
      cb: { nome: 21, temp: 22, status: 23, awb: 24, material: 25, matBio: 26, destino: 27 }
    } },
    transporteAgendaLinkFromRef_: () => ({ idAgenda: '', agendaSlot: '' }),
    normalizarSlotTransporteCodex_: (slot) => String(slot),
    getAgendaSheet_: () => sheet,
    encontrarLinhaPorId: () => 2,
    transporteMateriaisParaAgenda_: () => ({ summary: '', json: '' }),
    normalizarAwbCourier_: (value) => String(value || '').replace(/\W/g, '').toUpperCase(),
    normText_: (value) => String(value || '').trim().toLowerCase(),
    agendaSetAwbValue_: (range, value) => range.setValue(value),
    codexWriteAuditChanges_: () => {},
    SpreadsheetApp: { flush: () => {} }
  });
  vm.runInContext(sync, context);
  return context;
}

test('fluxo completo sincroniza Transporte sem sobrescrever AWB existente', () => {
  const row = Array(28).fill('');
  row[0] = 'DHL';
  row[2] = 'Nao agendado';
  row[3] = '1111111111';
  const sheet = new FakeSheet('Agenda', [Array(28).fill(''), row]);
  const context = transportSyncContext(sheet);
  const result = context.transporteSincronizarAgenda_({
    idAgenda: 'EVT-1', agendaSlot: '1', awb: '2222222222', destino: 'Lab Teste',
    temperatura: 'CONGELADO', status: 'Agendado', materiais: []
  });

  assert.equal(sheet.rows[1][3], '1111111111');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /nao foi sobrescrita/);
  assert.equal(sheet.rows[1][2], 'Agendado');
  assert.equal(sheet.rows[1][6], 'Lab Teste');
});
