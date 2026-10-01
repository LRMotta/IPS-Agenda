'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function rules() { return runFile('CadastroRules.gs').CadastroRules_; }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
const header = ['ID', 'Nome', '', '', 'ID Participante', 'Projeto', '', '', 'Status', '', 'CPF', 'ID Pessoa'];
function row(id, name, number, project, cpf, personId) {
  return [id, name, '', '', number, project, '', '', 'Falha de Triagem', '', cpf, personId];
}

test('IDs tecnicos removem espacos, preservam caixa e distinguem zero de ausente', () => {
  const r = rules();
  assert.equal(r.normalizeId(0), '0');
  assert.equal(r.normalizeId(null), '');
  assert.equal(r.normalizeId(' Cad-01 '), 'Cad-01');
  assert.equal(r.findProjectDuplicate({ id: ' 0 ', nomeAbreviado: 'Estudo A' }, [
    ['ID', 'Nome'], [0, 'Estudo A']
  ]), null);
  const rows = [header, row(0, 'Pessoa', 'P-1', 'Estudo A', '123', 'PES-0')];
  const data = { id: ' 0 ', nome: 'Pessoa', idParticipante: 'P-1', projeto: 'Estudo A', cpf: '123' };
  assert.deepEqual(plain(r.analyzeParticipant(data, rows)), { duplicate: null, nameMatches: [], cpfMatch: null });
  assert.equal(r.findParticipantDuplicate(data, rows), null);
  assert.equal(r.findParticipantCpfMatch(data, rows), null);
  assert.deepEqual(plain(r.findParticipantNameMatches(data, rows)), []);
  assert.equal(r.findParticipantCpfMatch({ cpf: '123' }, rows).id, '0');
});

test('analise conjunta preserva ordem de linhas, prioridade de duplicidade e preferencia por ID Pessoa', () => {
  const r = rules();
  const rows = [header,
    row('1', 'Pessoa Á', 'P-1', 'Estudo A', '111', ''),
    row('2', 'Pessoa A', 'P-2', 'Estudo A', '222', ' PES-A '),
    row('3', 'Pessoa A', 'P-3', 'Estudo B', '222', 'PES-B')];
  const data = { nome: 'pessoa a', idParticipante: 'P-1', projeto: 'Estudo A', cpf: '222' };
  const analysis = r.analyzeParticipant(data, rows);
  assert.deepEqual(plain(analysis.duplicate), { field: 'idParticipante', value: 'P-1' });
  assert.deepEqual(Array.from(analysis.nameMatches, match => match.id), ['1', '2', '3']);
  assert.equal(analysis.cpfMatch.id, '2');
  assert.equal(analysis.cpfMatch.idPessoa, 'PES-A');
  assert.deepEqual(plain(analysis.duplicate), plain(r.findParticipantDuplicate(data, rows)));
  assert.deepEqual(plain(analysis.nameMatches), plain(r.findParticipantNameMatches(data, rows)));
  assert.deepEqual(plain(analysis.cpfMatch), plain(r.findParticipantCpfMatch(data, rows)));
  assert.equal(r.analyzeParticipant({ projeto: 'Estudo A', cpf: '222', idParticipante: 'P-2' }, rows).duplicate.field, 'cpf');
  assert.equal(r.findParticipantCpfMatch({ cpf: '111' }, rows).id, '1');
});

test('CPF seleciona primeira linha vinculada e ignora ID Pessoa composto apenas de espacos', () => {
  const r = rules();
  const rows = [header,
    row('1', 'Pessoa', '', 'A', '123', ' '),
    row('2', 'Pessoa', '', 'B', '123', 'PES-A'),
    row('3', 'Pessoa', '', 'C', '123', 'PES-B')];
  assert.equal(r.findParticipantCpfMatch({ cpf: '123' }, rows).id, '2');
  assert.equal(r.analyzeParticipant({ cpf: '123' }, rows).cpfMatch.id, '2');
  // A selecao para previa nao representa resolucao do conflito PES-A/PES-B.
  assert.equal(r.findParticipantCpfMatch({ id: ' 2 ', cpf: '123' }, rows).id, '3');
  assert.equal(r.findParticipantCpfMatch({ cpf: '123' }, [header, rows[1]]).idPessoa, '');
});

test('analise conjunta e consultas individuais toleram schema legado, linhas vazias e valores ausentes', () => {
  const r = rules();
  assert.deepEqual(plain(r.analyzeParticipant(null, null)), { duplicate: null, nameMatches: [], cpfMatch: null });
  const rows = [header.slice(0, 11), null, row('1', 'Pessoa', '', 'A', '', '')];
  assert.equal(r.findParticipantNameMatches({ nome: 'Pessoa' }, rows)[0].idPessoa, '');
  assert.equal(r.findParticipantDuplicate({ idParticipante: 'P-1' }, rows), null);
  assert.equal(r.findParticipantCpfMatch({}, rows), null);
});

test('analise conjunta extrai o CPF de cada linha uma vez e preserva resultados sem mutar dados', () => {
  const r = rules();
  let reads = 0;
  const rows = [header];
  for (let i = 0; i < 100; i++) {
    rows.push(row(String(i), 'Pessoa ' + i, 'P-' + i, 'B', {
      toString() { reads++; return '12345678900'; }
    }, ''));
  }
  const data = Object.freeze({ nome: 'Novo', idParticipante: 'Novo', projeto: 'A', cpf: '99999999999' });
  rows.forEach(Object.freeze);
  Object.freeze(rows);
  r.findParticipantDuplicate(data, rows);
  r.findParticipantNameMatches(data, rows);
  r.findParticipantCpfMatch(data, rows);
  assert.equal(reads, 200);
  reads = 0;
  r.analyzeParticipant(data, rows);
  assert.equal(reads, 100);
});

test('matcher classifica identidade e ambiguidade preservando a protecao de historicos', () => {
  const r = rules();
  const participant = { id: 'CAD-1', nome: 'Pessoa Á', idParticipante: 'P-1', projeto: 'A' };
  const matcher = r.createAgendaParticipantMatcher(participant);
  const cases = [
    [{ participantCadastroId: 'CAD-1', projeto: 'B', idParticipante: 'P-2' }, true, 'cadastro', false],
    [{ participantCadastroId: 'CAD-2', participante: 'Pessoa A', projeto: 'A', idParticipante: 'P-1' }, false, 'none', false],
    [{ idParticipante: 'P-1', projeto: 'A', participante: 'Nome antigo' }, true, 'idParticipante', false],
    [{ idParticipante: 'P-1', projeto: '' }, true, 'idParticipante', true],
    [{ idParticipante: 'P-1', projeto: 'B' }, false, 'none', false],
    [{ participante: 'Pessoa A', projeto: 'A' }, true, 'nome', true],
    [{ participante: 'Pessoa A', projeto: '' }, true, 'nome', true],
    [{ participante: 'Pessoa A', projeto: 'A', idParticipante: 'P-2' }, false, 'none', false],
    [null, false, 'none', false]
  ];
  for (const [event, matches, matchType, ambiguous] of cases) {
    assert.deepEqual(plain(matcher.classify(event)), { matches, matchType, ambiguous });
    assert.equal(matcher.matches(event), matches);
    assert.equal(r.agendaEventMatchesParticipant(participant, event), matches);
  }
  assert.equal(r.createAgendaParticipantMatcher({ nome: 'Pessoa', projeto: 'A' }).matches({
    participante: 'Pessoa', projeto: 'A', idParticipante: 'P-1'
  }), true);
  assert.equal(r.createAgendaParticipantMatcher({ idParticipante: 'P-1' }).classify({
    idParticipante: 'P-1', projeto: 'A'
  }).ambiguous, true);
});

test('matcher prepara referencia uma vez e preserva seu snapshot durante a varredura', () => {
  const r = rules();
  let reads = 0;
  const participant = {};
  for (const [key, value] of Object.entries({ id: 'CAD-1', nome: 'Pessoa', idParticipante: 'P-1', projeto: 'A' })) {
    participant[key] = { toString() { reads++; return value; } };
  }
  const matcher = r.createAgendaParticipantMatcher(participant);
  assert.equal(reads, 4);
  participant.nome = 'Outro nome';
  for (let i = 0; i < 100; i++) assert.equal(matcher.matches({ participante: 'Pessoa', projeto: 'A' }), true);
  assert.equal(reads, 4);
  assert.equal(Object.isFrozen(matcher), true);
  assert.equal(Object.isFrozen(matcher.classify({ participante: 'Pessoa', projeto: 'A' })), true);
});

test('matcher aceita alias idCadastro dos resolvedores sem substituir id explicito', () => {
  const r = rules();
  const reference = { idCadastro: 0, nome: 'Pessoa', idParticipante: 'P-1', projeto: 'A' };
  assert.equal(r.agendaEventMatchesParticipant(reference, {
    participantCadastroId: '0', participante: 'Nome antigo', idParticipante: 'P-9', projeto: 'B'
  }), true);
  assert.equal(r.agendaEventMatchesParticipant(reference, {
    participantCadastroId: 'CAD-2', participante: 'Pessoa', idParticipante: 'P-1', projeto: 'A'
  }), false);
  assert.equal(r.agendaEventMatchesParticipant(reference, {
    participante: 'Pessoa', idParticipante: 'P-1', projeto: 'A'
  }), true);
  assert.equal(r.agendaEventMatchesParticipant({ ...reference, id: 'CAD-1' }, { participantCadastroId: '0' }), false);
  assert.equal(r.agendaEventMatchesParticipant({ ...reference, id: ' ' }, { participantCadastroId: '0' }), true);
  assert.equal(r.agendaEventMatchesParticipant({ id: 0, idCadastro: 'CAD-1' }, { participantCadastroId: '0' }), true);
});
