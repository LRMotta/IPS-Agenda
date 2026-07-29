'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');
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
  const server = runFile('WebApp.gs');
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
  assert.equal(result.integrity.totals.orphanLinks, 2);
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
  assert.ok(estoque.missingHeaders.includes('Validade'));
  assert.ok(estoque.missingHeaders.includes('Quantidade'));
  assert.equal(result.overall.status, 'Erro');
});

test('cliente envia contexto da versao e renderiza os novos paineis', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');

  assert.match(core, /getCodexDeploymentDiagnostics\(diagClientContext\(\)\)/);
  assert.match(core, /loadedVersion:\s*APP_LOADED_VERSION/);
  ['diagOverall', 'diagHealthSummary', 'diagVersionSync', 'diagModuleActivity', 'diagStructureChecks', 'diagIntegrityChecks']
    .forEach((id) => assert.match(content, new RegExp(`id="${id}"`)));
});
