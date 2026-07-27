'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function rules() {
  return runFile('CadastroRules.gs').CadastroRules_;
}

const projectRows = [
  ['ID', 'Nome', 'Codigo'],
  ['PROJ-1', 'Estudo Aurora', 'ABC-001'],
  ['PROJ-2', 'Projeto Horizonte', 'XYZ-002']
];

const participantRows = [
  ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status', 'Telefone', 'CPF'],
  ['1', 'Pessoa A', '', '', 'P-001', 'Estudo Aurora', '', '', 'Ativo', '', '123.456.789-00'],
  ['2', 'Pessoa B', '', '', 'P-001', 'Projeto Horizonte', '', '', 'Ativo', '', '']
];

test('criacao de projeto exige os campos criticos', () => {
  const cadastro = rules();
  assert.deepEqual(
    Array.from(cadastro.requiredProjectFields({ nomeAbreviado: 'Novo estudo' })),
    ['Fase', 'Status', 'Especialidade', 'Investigador principal']
  );
});

test('projeto novo nao pode repetir nome ou codigo', () => {
  const cadastro = rules();
  assert.equal(cadastro.findProjectDuplicate({ nomeAbreviado: '  estudo áurora ' }, projectRows).field, 'nomeAbreviado');
  assert.equal(cadastro.findProjectDuplicate({ nomeAbreviado: 'Outro', codigo: 'abc-001' }, projectRows).field, 'codigo');
  assert.equal(cadastro.findProjectDuplicate({ nomeAbreviado: 'Novo', codigo: 'NOV-003' }, projectRows), null);
});

test('atualizacao do projeto ignora o proprio registro mas detecta outro', () => {
  const cadastro = rules();
  assert.equal(cadastro.findProjectDuplicate({ id: 'PROJ-1', nomeAbreviado: 'Estudo Aurora', codigo: 'ABC-001' }, projectRows), null);
  assert.equal(cadastro.findProjectDuplicate({ id: 'PROJ-1', nomeAbreviado: 'Projeto Horizonte' }, projectRows).field, 'nomeAbreviado');
});

test('participante so pode ser vinculado a projeto cadastrado', () => {
  const cadastro = rules();
  const options = [{ nome: 'Estudo Aurora', codigo: 'ABC-001' }];
  assert.equal(cadastro.projectExists('estudo aurora', options), true);
  assert.equal(cadastro.projectExists('Projeto inexistente', options), false);
});

test('ID e obrigatorio salvo nos status de pre-triagem', () => {
  const cadastro = rules();
  assert.equal(cadastro.participantIdOptional('Pré-triagem'), true);
  assert.equal(cadastro.participantIdOptional('Falha de pré-triagem'), true);
  assert.equal(cadastro.participantIdOptional('Ativo'), false);
  assert.deepEqual(
    Array.from(cadastro.requiredParticipantFields({ nome: 'Pessoa', projeto: 'Estudo Aurora', status: 'Ativo' })),
    ['ID do participante']
  );
});

test('participante nao pode repetir CPF nem ID dentro do mesmo projeto', () => {
  const cadastro = rules();
  assert.equal(cadastro.findParticipantDuplicate({ cpf: '12345678900', projeto: 'Outro', idParticipante: 'P-999' }, participantRows).field, 'cpf');
  assert.equal(cadastro.findParticipantDuplicate({ projeto: 'Estudo Aurora', idParticipante: 'p-001' }, participantRows).field, 'idParticipante');
  assert.equal(cadastro.findParticipantDuplicate({ projeto: 'Projeto Horizonte', idParticipante: 'P-003' }, participantRows), null);
});

test('atualizacao do participante ignora o proprio registro', () => {
  const cadastro = rules();
  assert.equal(cadastro.findParticipantDuplicate({ id: '1', projeto: 'Estudo Aurora', idParticipante: 'P-001', cpf: '12345678900' }, participantRows), null);
  assert.equal(cadastro.findParticipantDuplicate({ id: '1', projeto: 'Projeto Horizonte', idParticipante: 'P-001' }, participantRows).field, 'idParticipante');
});

test('tabela de participantes exibe nome e codigo do projeto como no cadastro de projetos', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(source, 'function participanteProjetoCellHtml(', 'function renderTabelaPart(');
  const context = vm.createContext({
    esc: (value) => String(value || ''),
    encontrarProjetoParticipante: (value) => value === 'SKYLINE-UC'
      ? { nome: 'SKYLINE-UC', codigo: 'SPY123-201' }
      : null
  });
  vm.runInContext(block, context);

  const html = context.participanteProjetoCellHtml({ projeto: 'SKYLINE-UC', braco: 'Braço A' });
  assert.match(html, /SKYLINE-UC/);
  assert.match(html, /SPY123-201/);
  assert.match(html, /Bra&ccedil;o: Braço A/);
  assert.match(source, /\+\'<td>\'\+participanteProjetoCellHtml\(p\)\+\'<\/td>\'/);
  assert.match(source, /projetoCadastro && projetoCadastro\.codigo/);
});
