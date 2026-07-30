'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function rowWith(size, values) {
  const row = Array(size).fill('');
  Object.entries(values).forEach(([index, value]) => { row[Number(index)] = value; });
  return row;
}

function diagnosticServer(overrides) {
  const sheets = {
    Agenda: new FakeSheet('Agenda', [
      rowWith(9, { 0: 'ID', 1: 'Data', 2: 'Hora', 3: 'Tipo', 4: 'Status', 5: 'Participante', 7: 'ID Participante', 8: 'Projeto' }),
      rowWith(9, { 0: 'AG-1', 1: '2026-07-29', 3: 'Visita', 4: 'Agendado', 5: 'Pessoa Um', 7: 'SUB-1', 8: 'Estudo A' })
    ]),
    Projetos: new FakeSheet('Projetos', [
      rowWith(14, { 0: 'ID', 1: 'Nome abreviado', 2: 'Codigo', 13: 'Status' }),
      rowWith(14, { 0: 'PROJ-1', 1: 'Estudo A', 2: 'EA-01', 13: 'Ativo' })
    ]),
    Participantes: new FakeSheet('Participantes', [
      rowWith(9, { 0: 'ID', 1: 'Nome', 4: 'ID Participante', 5: 'Projeto', 8: 'Status' }),
      rowWith(9, { 0: '1', 1: 'Pessoa Um', 4: 'SUB-1', 5: 'Estudo A', 8: 'Ativo' })
    ]),
    Itens: new FakeSheet('Itens', [
      rowWith(10, { 0: 'ID_Item', 1: 'Projeto', 2: 'Descrição', 3: 'Detalhes Visita / Complemento', 4: 'Tipo de item', 5: 'Localização padrão', 6: 'Estoque mínimo', 7: 'Observações', 8: 'Laboratório', 9: 'Status' }),
      rowWith(10, { 0: 'KIT-1', 1: 'Estudo A', 2: 'Kit coleta', 3: 'Visita 1', 4: 'Kit', 5: 'Sala A', 6: 2, 8: 'Lab A', 9: 'Ativo' })
    ]),
    Estoque: new FakeSheet('Estoque', [
      rowWith(9, { 0: 'ID Item', 2: 'Descricao', 4: 'Validade', 6: 'Quantidade', 8: 'Status' }),
      rowWith(9, { 0: 'KIT-1', 2: 'Kit coleta', 4: '2027-01-01', 6: 2, 8: 'Disponivel' })
    ]),
    Users: new FakeSheet('Users', [
      ['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversario (MM-DD)'],
      ['admin@example.invalid', 'Admin', 'admin', 'Sim', '04-01']
    ]),
    Config_App: new FakeSheet('Config_App', [
      ['Grupo', 'Chave', 'Valor', 'Ativo'],
      ['Agenda', 'Status', 'Agendado', 'Sim']
    ]),
    Audit_Log: new FakeSheet('Audit_Log', [
      ['ID', 'Email', 'Acao', 'Timestamp', 'Modulo', 'Record ID'],
      ['AUD-1', 'admin@example.invalid', 'salvarAgenda', '29/07/2026 10:00:00', 'Agenda', 'AG-1'],
      ['AUD-2', 'admin@example.invalid', 'salvarProjeto', '29/07/2026 11:00:00', 'Cadastros', 'PROJ-1']
    ])
  };
  Object.assign(sheets, overrides || {});
  const server = runFiles(['WebApp.gs', 'DeploymentDiagnostics.gs']);
  server.getCodexSpreadsheet_ = () => new FakeSpreadsheet(sheets);
  return { server, sheets };
}

test('diagnostico operacional confirma versao, estrutura, atividade e vinculos saudaveis', () => {
  const { server } = diagnosticServer();
  const result = server.codexGetOperationalHealthDiagnostics_({
    loadedVersion: server.CODEX_APP_VERSION_,
    watcherActive: true,
    noticeVisible: false
  });

  assert.equal(result.versionSync.matches, true);
  assert.equal(result.structure.items.every((item) => item.ok), true);
  assert.equal(result.integrity.totals.duplicateIds, 0);
  assert.equal(result.integrity.totals.orphanLinks, 0);
  assert.equal(result.activity.items.find((item) => item.key === 'agenda').action, 'salvarAgenda');
  assert.equal(result.overall.status, 'Saudavel');
});

test('diagnostico operacional evidencia versao antiga, IDs duplicados e vinculos orfaos', () => {
  const { server, sheets } = diagnosticServer();
  sheets.Agenda.rows.push(rowWith(9, {
    0: 'AG-1', 1: '2026-07-30', 3: 'Visita', 4: 'Agendado',
    5: 'Pessoa Inexistente', 7: 'SUB-404', 8: 'Projeto Inexistente'
  }));

  const result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: 'versao-antiga', watcherActive: false });

  assert.equal(result.versionSync.matches, false);
  assert.equal(result.integrity.totals.duplicateIds, 1);
  assert.equal(result.integrity.totals.orphanLinks, 1);
  assert.ok(result.overall.errors >= 1);
  assert.ok(result.overall.warnings >= 1);
  assert.equal(result.overall.status, 'Erro');
});

test('diagnostico estrutural informa aba ou cabecalho obrigatorio ausente', () => {
  const { server } = diagnosticServer({
    Estoque: new FakeSheet('Estoque', [['ID Item', '', 'Descricao']])
  });
  const result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });
  const estoque = result.structure.items.find((item) => item.key === 'estoque');

  assert.equal(estoque.ok, false);
  assert.ok(estoque.missingHeaders.some((header) => header.startsWith('Validade')));
  assert.ok(estoque.missingHeaders.some((header) => header.startsWith('Quantidade')));
  assert.equal(result.overall.status, 'Erro');
});

test('rotulos personalizados na posicao funcional viram alerta, nao erro estrutural', () => {
  const { server } = diagnosticServer({
    Users: new FakeSheet('Users', [
      ['E-mail autorizado', 'Nome completo', 'Perfil de acesso', 'Liberado', 'Nascimento sem ano'],
      ['admin@example.invalid', 'Admin', 'admin', 'Sim', '04-01']
    ])
  });
  const result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });
  const users = result.structure.items.find((item) => item.key === 'users');

  assert.equal(users.ok, true);
  assert.equal(users.warning, true);
  assert.equal(result.overall.errors, 0);
  assert.ok(result.overall.warnings >= 1);
});

test('rotulos reais de participantes e usuarios sao reconhecidos sem alerta', () => {
  const { server } = diagnosticServer({
    Participantes: new FakeSheet('Participantes', [
      rowWith(9, { 0: 'ID_Participante', 1: 'Nome', 4: 'ID Participante', 5: 'Projeto', 8: 'Status' }),
      rowWith(9, { 0: '1', 1: 'Pessoa Um', 4: 'SUB-1', 5: 'Estudo A', 8: 'Ativo' })
    ]),
    Users: new FakeSheet('Users', [
      ['Email', 'Nome', 'Função', 'Ativo', 'Aniversario'],
      ['admin@example.invalid', 'Admin', 'admin', 'Sim', '04-01']
    ])
  });
  const result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });

  assert.equal(result.structure.items.find((item) => item.key === 'participantes').warning, false);
  assert.equal(result.structure.items.find((item) => item.key === 'users').warning, false);
});

test('coluna obrigatoria deslocada continua sendo erro estrutural', () => {
  const { server } = diagnosticServer({
    Users: new FakeSheet('Users', [
      ['Nome', 'Email', 'Perfil', 'Ativo', 'Aniversario'],
      ['Admin', 'admin@example.invalid', 'admin', 'Sim', '04-01']
    ])
  });
  const result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });
  const users = result.structure.items.find((item) => item.key === 'users');

  assert.equal(users.ok, false);
  assert.ok(users.missingHeaders.some((header) => header.startsWith('Email')));
  assert.ok(users.headerNotes.some((note) => note.includes('coluna 2')));
  assert.equal(result.overall.status, 'Erro');
});

test('estoque permite repetir ID do item entre lotes e valida o cadastro de origem', () => {
  const { server, sheets } = diagnosticServer();
  sheets.Estoque.rows.push(rowWith(9, {
    0: 'KIT-1', 1: 'Estudo A', 2: 'Kit coleta', 4: '2027-06-01', 6: 3, 8: 'Disponivel'
  }));
  const result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });
  const estoque = result.integrity.items.find((item) => item.key === 'estoque-referencias');

  assert.equal(estoque.ok, true);
  assert.equal(result.integrity.totals.duplicateIds, 0);
  assert.equal(result.integrity.items.some((item) => item.key === 'estoque-ids'), false);
});

test('vinculos aceitam nome ou codigo do mesmo projeto e detalham linha orfa', () => {
  const { server, sheets } = diagnosticServer();
  sheets.Participantes.rows[1][5] = 'EA-01';
  let result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });
  assert.equal(result.integrity.totals.orphanLinks, 0);

  sheets.Participantes.rows.push(rowWith(9, { 0: '2', 1: 'Pessoa Dois', 4: 'SUB-2', 5: 'Projeto removido', 8: 'Ativo' }));
  result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });
  const orphan = result.integrity.items.find((item) => item.key === 'participante-projeto');
  assert.match(orphan.detail, /linha 3: Projeto removido/);
});

test('detalhes de integridade preservam a linha real mesmo com linha vazia', () => {
  const { server, sheets } = diagnosticServer();
  sheets.Agenda.rows.splice(2, 0, rowWith(9, {}));
  sheets.Agenda.rows.push(rowWith(9, {
    0: 'AG-1', 1: '2026-07-30', 3: 'Visita', 4: 'Agendado', 5: 'Pessoa Um', 7: 'SUB-1', 8: 'Estudo A'
  }));
  const result = server.codexGetOperationalHealthDiagnostics_({ loadedVersion: server.CODEX_APP_VERSION_, watcherActive: true });
  const agendaIds = result.integrity.items.find((item) => item.key === 'agenda-ids');

  assert.match(agendaIds.detail, /linhas 2 e 4/);
});

test('cliente envia contexto da versao e renderiza os novos paineis', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');

  assert.match(core, /getCodexDeploymentDiagnostics\(diagClientContext\(\)\)/);
  assert.match(core, /loadedVersion:\s*APP_LOADED_VERSION/);
  ['diagOverall', 'diagHealthSummary', 'diagVersionSync', 'diagModuleActivity', 'diagStructureChecks', 'diagIntegrityChecks']
    .forEach((id) => assert.match(content, new RegExp(`id="${id}"`)));
});

test('leitura estrutural limita dados as colunas usadas e preserva todos os cabecalhos', () => {
  const server = runFiles(['WebApp.gs', 'DeploymentDiagnostics.gs']);
  const headers = Array.from({ length: 40 }, (_, index) => 'Coluna ' + (index + 1));
  headers[0] = 'ID';
  headers[8] = 'Projeto';
  const sheet = new FakeSheet('Agenda', [headers, Array.from({ length: 40 }, (_, index) => 'v' + index)]);
  const calls = [];
  const originalGetRange = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => {
    calls.push(args);
    return originalGetRange(...args);
  };

  const result = server.codexReadDiagnosticTable_(new FakeSpreadsheet({ Agenda: sheet }), {
    names: ['Agenda'],
    required: [
      { index: 0, label: 'ID', aliases: ['ID'] },
      { index: 8, label: 'Projeto', aliases: ['Projeto'] }
    ]
  });

  assert.equal(result.headers.length, 40);
  assert.equal(result.rows[0].length, 9);
  assert.deepEqual(calls[0], [1, 1, 1, 40]);
  assert.deepEqual(calls[1], [2, 1, 1, 9]);
});

test('diagnostico fica isolado em modulo proprio sem duplicar funcoes no WebApp', () => {
  const web = readProjectFile('WebApp.gs');
  const diagnostics = readProjectFile('DeploymentDiagnostics.gs');

  assert.doesNotMatch(web, /^function getCodexDeploymentDiagnostics\s*\(/m);
  assert.doesNotMatch(web, /^function codexGetOperationalHealthDiagnostics_\s*\(/m);
  assert.match(diagnostics, /^function getCodexDeploymentDiagnostics\s*\(/m);
  assert.match(diagnostics, /^function codexGetOperationalHealthDiagnostics_\s*\(/m);
  assert.match(diagnostics, /^function limparCodexCachesDiagnostico\s*\(/m);
});
