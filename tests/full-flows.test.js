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
    between(web, 'function participanteCampoKey_', 'function salvarDadosParticipante(') + '\n' +
    between(web, 'var PROJETO_COURIER_FIELDS_', 'function excluirProjeto(') + '\n' +
    between(web, 'function participanteReferenciaCadastro_(', 'function corrigirMatrizIdadeParticipantes(');
  const counters = { cache: 0, transportCache: 0 };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    codexAssertCanWrite_: () => ({ ok: true }),
    clearTransporteOptionsCache_: () => { counters.transportCache++; },
    clearCodexRuntimeCaches_: () => { counters.cache++; },
    getProjetosParticipantesOptions_: () => projectOptions || [],
    getAgendaTemperaturas_: () => ['Ambiente', 'Refrigerado', 'Congelado'],
    normText_: (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    Date
  });
  vm.runInContext(source, context);
  return { context, counters };
}

function courierContext(sheet) {
  const web = readProjectFile('WebApp.gs');
  const source = between(web, 'var COURIER_HEADERS_', 'function codexSanitizeCourierHtml_');
  const context = vm.createContext({
    codexAssertCanWrite_: () => ({ ok: true }),
    codexSanitizeCourierHtml_: (value) => String(value || ''),
    limparCacheCourier_: () => {},
    normText_: (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: () => '20260819120000' },
    Date,
    Math
  });
  vm.runInContext(source, context);
  context.getCourierSheet_ = () => sheet;
  return context;
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

test('projeto grava couriers por ID e temperatura em colunas opcionais por cabecalho', () => {
  const sheet = new FakeSheet('Projetos', [
    ['ID', 'Nome', 'Codigo', 'Especialidade', 'Fase', 'Investigador']
  ]);
  const { context } = cadastroContext(new FakeSpreadsheet({ Projetos: sheet }));
  const payload = Object.assign({}, validProject, {
    courierPrincipalId: 'COU-MARKEN',
    courierPrincipalTemperaturas: ['Ambiente', 'Congelado'],
    courierAdicional1Id: 'COU-DHL',
    courierAdicional1Temperaturas: ['Refrigerado'],
    courierAdicional2Id: '',
    courierAdicional2Temperaturas: [],
    situacaoEnvioAmostras: 'Sim'
  });

  assert.equal(context.salvarDadosProjeto(payload), 'Projeto cadastrado com sucesso!');
  const headers = sheet.rows[0];
  const row = sheet.rows[1];
  assert.equal(row[headers.indexOf('Courier principal (ID)')], 'COU-MARKEN');
  assert.equal(row[headers.indexOf('Temperaturas courier principal')], 'Ambiente; Congelado');
  assert.equal(row[headers.indexOf('Courier adicional 1 (ID)')], 'COU-DHL');
  assert.equal(row[headers.indexOf('Temperaturas courier adicional 1')], 'Refrigerado');
  assert.equal(row[headers.indexOf('Situação envio de amostras')], 'Sim');
});

test('schema legado de projetos continua salvavel sem criar campos opcionais', () => {
  const sheet = new FakeSheet('Projetos', [
    ['ID', 'Nome', 'Codigo', 'Especialidade', 'Fase', 'Investigador']
  ]);
  const { context } = cadastroContext(new FakeSpreadsheet({ Projetos: sheet }));

  assert.equal(context.projetoCourierColumnMap_(sheet.rows[0]).principal, -1);
  assert.equal(context.projetoCourierTemperatureColumnMap_(sheet.rows[0]).principal, -1);
  assert.equal(context.salvarDadosProjeto(validProject), 'Projeto cadastrado com sucesso!');
  assert.equal(sheet.rows[0].indexOf('Courier principal (ID)'), -1);
  assert.equal(sheet.rows[0].indexOf('Temperaturas courier principal'), -1);
});

test('projeto rejeita courier repetida e temperatura sem courier antes de escrever', () => {
  const duplicateSheet = new FakeSheet('Projetos', [['ID', 'Nome', 'Codigo']]);
  const duplicate = cadastroContext(new FakeSpreadsheet({ Projetos: duplicateSheet })).context;
  assert.throws(() => duplicate.salvarDadosProjeto(Object.assign({}, validProject, {
    courierPrincipalId: 'COU-1', courierAdicional1Id: 'COU-1'
  })), /couriers diferentes/);
  assert.equal(duplicateSheet.writes, 0);

  const temperatureSheet = new FakeSheet('Projetos', [['ID', 'Nome', 'Codigo']]);
  const temperature = cadastroContext(new FakeSpreadsheet({ Projetos: temperatureSheet })).context;
  assert.throws(() => temperature.salvarDadosProjeto(Object.assign({}, validProject, {
    courierPrincipalId: '', courierPrincipalTemperaturas: ['Congelado']
  })), /courier correspondente/);
  assert.equal(temperatureSheet.writes, 0);
});

test('projeto registra explicitamente ausencia de envio sem exigir couriers', () => {
  const sheet = new FakeSheet('Projetos', [['ID', 'Nome', 'Codigo']]);
  const { context } = cadastroContext(new FakeSpreadsheet({ Projetos: sheet }));

  assert.equal(context.salvarDadosProjeto(Object.assign({}, validProject, {
    situacaoEnvioAmostras: 'Não',
    courierPrincipalId: '', courierPrincipalTemperaturas: []
  })), 'Projeto cadastrado com sucesso!');
  const statusCol = sheet.rows[0].indexOf('Situação envio de amostras');
  assert.equal(sheet.rows[1][statusCol], 'Não');

  const invalidSheet = new FakeSheet('Projetos', [['ID', 'Nome', 'Codigo']]);
  const invalid = cadastroContext(new FakeSpreadsheet({ Projetos: invalidSheet })).context;
  assert.throws(() => invalid.salvarDadosProjeto(Object.assign({}, validProject, {
    situacaoEnvioAmostras: 'Não', courierPrincipalId: 'COU-1', courierPrincipalTemperaturas: ['Ambiente']
  })), /sem envio de amostras/);
  assert.equal(invalidSheet.writes, 0);
});

test('courier grava regras operacionais em cabecalhos opcionais sem exigir migracao previa', () => {
  const headers = [
    'ID_Courier', 'Courier', 'Empresa 1', 'CNPJ 1', 'Telefone 1', 'Fax 1',
    'Empresa 2', 'CNPJ 2', 'Telefone 2', 'Fax 2', 'Declaração', 'E-mail',
    'E-mail ambiente', 'E-mail congelado', 'Monitorar confirmação', 'E-mail confirmação',
    'Texto confirmação', 'Status confirmação'
  ];
  const sheet = new FakeSheet('Courier', [headers, ['COU-1', 'Marken']]);
  const context = courierContext(sheet);

  assert.equal(context.salvarCourier({
    id: 'COU-1', nome: 'Marken', forneceGeloColeta: 'Sim', restricaoSegunda: 'Sim',
    restricaoAposFeriado: 'Sim', observacaoOperacional: 'Confirmar disponibilidade.'
  }), 'Courier atualizada com sucesso.');

  const atualizados = sheet.rows[0];
  const row = sheet.rows[1];
  assert.equal(row[atualizados.indexOf('Fornece gelo para coleta')], 'Sim');
  assert.equal(row[atualizados.indexOf('Restrição às segundas-feiras')], 'Sim');
  assert.equal(row[atualizados.indexOf('Restrição após feriado')], 'Sim');
  assert.equal(row[atualizados.indexOf('Observação operacional')], 'Confirmar disponibilidade.');
});

test('cliente legado atualiza courier sem criar colunas operacionais', () => {
  const headers = [
    'ID_Courier', 'Courier', 'Empresa 1', 'CNPJ 1', 'Telefone 1', 'Fax 1',
    'Empresa 2', 'CNPJ 2', 'Telefone 2', 'Fax 2', 'Declaração', 'E-mail',
    'E-mail ambiente', 'E-mail congelado', 'Monitorar confirmação', 'E-mail confirmação',
    'Texto confirmação', 'Status confirmação'
  ];
  const sheet = new FakeSheet('Courier', [headers, ['COU-1', 'Marken']]);
  const context = courierContext(sheet);

  assert.equal(context.salvarCourier({ id: 'COU-1', nome: 'Marken atualizada' }), 'Courier atualizada com sucesso.');
  assert.equal(sheet.rows[0].indexOf('Fornece gelo para coleta'), -1);
  assert.equal(sheet.rows[1][1], 'Marken atualizada');
});

test('courier rejeita regra operacional fora de Sim ou Nao antes de escrever', () => {
  const headers = Array.from({ length: 18 }, (_, index) => index === 0 ? 'ID_Courier' : (index === 1 ? 'Courier' : 'Campo ' + index));
  const sheet = new FakeSheet('Courier', [headers, ['COU-1', 'Marken']]);
  const context = courierContext(sheet);

  assert.throws(() => context.salvarCourier({
    id: 'COU-1', nome: 'Marken', forneceGeloColeta: 'Talvez'
  }), /Use Sim ou Não/);
  assert.equal(sheet.writes, 0);
});

test('participante persiste endereco e dados bancarios opcionais sem deslocar o legado', () => {
  const sheet = new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status', 'Telefone', 'CPF', 'Obs'],
    [4, 'Pessoa Existente', '', '', 'P-004', 'Novo Estudo', '', '', 'Ativo', '', '', '']
  ]);
  const { context } = cadastroContext(new FakeSpreadsheet({ Participantes: sheet }), [{ nome: 'Novo Estudo' }]);
  const payload = {
    nome: 'Pessoa Nova', idParticipante: 'P-005', projeto: 'Novo Estudo', status: 'Ativo',
    rua: 'Rua das Flores', numero: '123', cidade: 'Caxias do Sul', estado: 'RS', cep: '95000-000',
    banco: 'Banco de Teste', agencia: '001', contaCorrente: '12345-6',
    titularConta: 'Pessoa Nova', cpfTitular: '111.222.333-44'
  };

  assert.equal(context.salvarDadosParticipante(payload), 'Participante cadastrado com sucesso');
  const headers = sheet.rows[0];
  const created = sheet.rows[2];
  assert.equal(headers[12], 'Rua');
  assert.equal(headers[21], 'CPF do Titular');
  assert.equal(created[headers.indexOf('Rua')], 'Rua das Flores');
  assert.equal(created[headers.indexOf('Banco')], 'Banco de Teste');
  assert.equal(created[headers.indexOf('CPF do Titular')], '111.222.333-44');
});

test('alteracao de nome propaga pelas referencias usando o ID da coluna A', () => {
  const participantes = new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status'],
    [81231558, 'Filipe Mumeron da Silva', '', '', '2011250001', 'SKYLINE-UC', '', '', 'Ativo']
  ]);
  const agenda = new FakeSheet('Agenda', [
    ['ID', 'Data', 'Hora', 'Tipo', 'Status', 'Participante', 'Nascimento', 'ID Participante', 'Projeto'],
    ['EVT-1', '', '', 'Visita', 'Agendado', 'Filipe Mumeron da Silva', '', '2011250001', 'SKYLINE-UC'],
    ['EVT-2', '', '', 'Visita', 'Agendado', 'Homônimo de outro estudo', '', '2011250001', 'OUTRO-ESTUDO']
  ]);
  const movimentos = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/hora', 'Tipo de movimento', 'ID_Item', 'Descrição', 'Tipo de item', 'Projeto', 'Qtde.', 'Validade', 'Localização', 'Lote', 'ID_Participante', 'Participante'],
    ['MOV-1', '', 'Saída - Visita', '', '', '', 'SKYLINE-UC', 1, '', '', '', '2011250001', 'Filipe Mumeron da Silva']
  ]);
  const ss = new FakeSpreadsheet({ Participantes: participantes, Agenda: agenda, Movimentações: movimentos });
  const { context } = cadastroContext(ss, [{ nome: 'SKYLINE-UC' }]);

  assert.equal(context.salvarDadosParticipante({
    id: 81231558,
    nome: 'Filipe Muneron da Silva',
    idParticipante: '2011250001',
    projeto: 'SKYLINE-UC',
    status: 'Ativo'
  }), 'Participante atualizado com sucesso');

  assert.equal(agenda.rows[1][5], 'Filipe Muneron da Silva');
  assert.equal(agenda.rows[1][7], '2011250001');
  assert.equal(agenda.rows[1][9], '81231558');
  assert.equal(agenda.rows[2][5], 'Homônimo de outro estudo');
  assert.equal(movimentos.rows[1][12], 'Filipe Muneron da Silva');
  assert.equal(movimentos.rows[1][13], '81231558');
});

test('edicao preserva projeto, status e identificacao quando o formulario nao os devolve', () => {
  const participantes = new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status'],
    [81231558, 'Filipe Mumeron da Silva', '', '', '2011250001', 'SKYLINE-UC', '', '', 'Ativo']
  ]);
  const { context } = cadastroContext(new FakeSpreadsheet({ Participantes: participantes }), [{ nome: 'SKYLINE-UC' }]);

  assert.equal(context.salvarDadosParticipante({
    id: 81231558,
    nome: 'Filipe Muneron da Silva'
  }), 'Participante atualizado com sucesso');
  assert.equal(participantes.rows[1][4], '2011250001');
  assert.equal(participantes.rows[1][5], 'SKYLINE-UC');
  assert.equal(participantes.rows[1][8], 'Ativo');
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

test('nome repetido exige confirmacao antes de permitir novo cadastro legitimo', () => {
  const participantes = new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status'],
    [1, 'Pessoa A', '', '', 'P-001', 'Novo Estudo', '', '', 'Ativo']
  ]);
  const { context } = cadastroContext(new FakeSpreadsheet({ Participantes: participantes }), [{ nome: 'Novo Estudo' }, { nome: 'Outro Estudo' }]);
  const payload = { nome: 'Pessoa A', idParticipante: 'P-900', projeto: 'Outro Estudo', status: 'Ativo' };

  const warning = context.salvarDadosParticipante(payload);
  assert.equal(warning.requiresNameConfirmation, true);
  assert.match(warning.message, /novo número de identificação\/triagem/i);
  assert.equal(participantes.rows.length, 2);

  assert.equal(context.salvarDadosParticipante(Object.assign({}, payload, { confirmarNomeDuplicado: true })), 'Participante cadastrado com sucesso');
  assert.equal(participantes.rows.length, 3);
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
    aplicarLogicaCancelamento_: () => {},
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
