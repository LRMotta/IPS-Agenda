'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function setup() {
  const projects = new FakeSheet('Projetos', [['ID', 'Nome'], ['P1', 'Projeto']]);
  const labs = new FakeSheet('LabCentral', [['ID', 'Nome'], ['L1', 'Lab Um'], ['L2', 'Lab Dois']]);
  const ss = new FakeSpreadsheet({ Projetos: projects, LabCentral: labs });
  const server = runFiles(['CadastroRules.gs', 'WebApp.gs'], { SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_name, callback) => callback();
  server.clearTransporteOptionsCache_ = () => {};
  server.clearCodexRuntimeCaches_ = () => {};
  server.getAgendaCourierRows_ = () => [{ id: 'M1', nome: 'Marken', disponivelProjetos: true }, { id: 'O1', nome: 'Ocasa', disponivelProjetos: true }];
  return { server, projects, labs };
}

test('salvar projeto rejeita regras inválidas antes de gravar dados ou criar cabeçalho', () => {
  const { server, projects } = setup();
  const before = JSON.stringify(projects.rows);
  const payload = { id: 'P1', nomeAbreviado: 'Projeto', fase: 'III', status: 'Ativo', especialidade: 'Oncologia', investigador: 'IP', caixasTransporteJson: JSON.stringify([{ courierId: 'M1', laboratorioId: 'L1', temperatura: 'Congelado', tipoCaixa: 'BIOSYSTEM' }]) };
  assert.throws(() => server.salvarDadosProjeto(payload), /sempre em temperatura Ambiente/);
  assert.equal(JSON.stringify(projects.rows), before);
  payload.caixasTransporteJson = JSON.stringify([{ courierId: 'M1', laboratorioId: 'L1', temperatura: 'Ambiente', tipoCaixa: 'BIOSYSTEM' }]);
  server.salvarDadosProjeto(payload);
  const col = server.projetoCaixasTransporteColumn_(projects.rows[0]);
  const stored = projects.rows[1][col];
  delete payload.caixasTransporteJson;
  server.salvarDadosProjeto(payload);
  assert.equal(projects.rows[1][col], stored);
});

test('regras de caixas usam IDs, limitam courier/temperatura e rejeitam conflito', () => {
  const { server } = setup();
  const bio = { courierId: 'M1', laboratorioId: 'L1', temperatura: 'Ambiente', tipoCaixa: 'BioSystem' };
  const sep = { courierId: 'O1', laboratorioId: 'L2', temperatura: 'AMBIENTE', tipoCaixa: 'SEPIO' };
  const regras = JSON.parse(server.normalizarProjetoCaixasTransporte_([bio, sep]));
  assert.equal(regras.length, 2);
  assert.equal(regras[0].temperatura, 'AMBIENTE');
  assert.equal(regras[0].tipoCaixa, 'BIOSYSTEM');
  for (const change of [{ temperatura: 'Congelado' }, { courierId: 'O1' }, { laboratorioId: 'Lab Um' }, { laboratorioId: '__proto__' }, { laboratorioId: 'constructor' }, { tipoCaixa: 'OUTRA' }, { courierId: 'inexistente' }]) {
    assert.throws(() => server.normalizarProjetoCaixasTransporte_([{ ...bio, ...change }]));
  }
  assert.throws(() => server.normalizarProjetoCaixasTransporte_([bio, bio]), /Já existe/);
  assert.throws(() => server.normalizarProjetoCaixasTransporte_('{'), /inválidas/);
  assert.equal(server.normalizarProjetoCaixasTransporte_(''), '[]');
});

test('leitura de laboratórios não modifica schema e escrita opcional preserva omitidos', () => {
  const { server, projects, labs } = setup();
  assert.equal(server.getProjetoCaixasLaboratorios_()[0].nomeAbreviado, 'Lab Um');
  assert.equal(labs.rows[0].length, 2);
  server.gravarProjetoCaixasTransporte_(projects, 2, {});
  assert.equal(projects.rows[0].length, 2);
  server.gravarProjetoCaixasTransporte_(projects, 2, { caixasTransporteJson: '[]' });
  const col = server.projetoCaixasTransporteColumn_(projects.rows[0]);
  assert.equal(projects.rows[1][col], '[]');
  server.gravarProjetoCaixasTransporte_(projects, 2, {});
  assert.equal(projects.rows[1][col], '[]');
});
