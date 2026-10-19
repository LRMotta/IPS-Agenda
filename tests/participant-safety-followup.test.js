'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const FOLLOWUP = 'Em acompanhamento de segurança';
function fixture(status = FOLLOWUP) {
  const sheet = new FakeSheet('Participantes', [
    ['ID','Nome','Nascimento','Idade','ID Participante','Projeto','Braço','Última visita','Status','Telefone','CPF','Obs','ID Pessoa','CTMS Marcos (JSON)'],
    ['1','Pessoa teste','','','D-1','DUET','','',status,'','52998224725','','PES-1','{"ULTIMA_DOSE":"2026-10-01"}']
  ]);
  const book = new FakeSpreadsheet({ Participantes: sheet });
  const s = runFiles(['CadastroRules.gs','WebApp.gs'], {
    Date, SpreadsheetApp: { getActiveSpreadsheet: () => book },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'test-id' }
  });
  s.codexAssertCanWrite_ = s.codexAssertCanRead_ = () => {};
  s.codexWithDocumentLock_ = (_, action) => action();
  s.codexLogPerformance_ = s.codexWriteAuditChanges_ = s.codexWriteAuditLog_ = () => {};
  s.clearCodexRuntimeCaches_ = s.clearTransporteOptionsCache_ = () => {};
  s.brasilNormalizarLocalidade_ = () => {};
  s.getProjetosParticipantesOptions_ = () => ['DUET', 'SPY', 'Outro'];
  s.participantePossuiEventoAgenda_ = () => true;
  s.getSheetByPossibleNames_ = () => sheet;
  const payload = { sexoNascimento: 'Não informado', nome: 'Pessoa teste', cpf: '52998224725', projeto: 'SPY', idParticipante: 'S-1', status: 'Triagem', novaParticipacaoDireta: true, vincularPessoaCadastroId: '1' };
  return { s, sheet, book, payload };
}

test('acompanhamento permite Agenda e outra participação; óbito e status desconhecido não liberam participação', () => {
  const { s } = fixture();
  const client = vm.createContext({ normSelectValue: s.normText_ });
  const fn = readProjectFile('IndexCoreScripts.html').match(/function participantePodeNovaParticipacao_\([^]*?\n\}/)[0];
  vm.runInContext(fn, client);
  for (const [status, allowed] of [[FOLLOWUP,true], [' EM ACOMPANHAMENTO DE SEGURANCA ',true], ['Descontinuado',true], ['Falha de Pré-Triagem',true], ['Falha de Triagem',true], ['Óbito',false], ['Ativo',false], ['Triagem',false], ['Em tratamento',false], ['',false], ['Desconhecido',false]]) {
    assert.equal(s.CadastroRules_.participantAllowsNewParticipation(status), allowed, status);
    assert.equal(client.participantePodeNovaParticipacao_(status), allowed, status);
  }
  assert.equal(s.CadastroRules_.participantAvailableForNewAgenda(FOLLOWUP), true);
  assert.equal(s.CadastroRules_.participantAvailableForNewAgenda('Óbito'), false);
});

test('configuração oferece novo status sem gravar ConfigApp nem duplicar opção existente', () => {
  const { s, sheet } = fixture();
  const values = ['Ativo', 'Descontinuado'];
  s.getConfigValues_ = (_, field) => field === 'Status' ? values : ['Banco'];
  const cfg = s.getParticipanteFormConfig();
  assert.deepEqual(Array.from(cfg.status), [...values, FOLLOWUP]);
  assert.deepEqual(values, ['Ativo', 'Descontinuado']);
  values.push('Em acompanhamento de seguranca');
  assert.equal(s.getParticipanteFormConfig().status.length, 3);
  assert.equal(sheet.writes, 0);
});

test('nova participação SPY preserva DUET, ID Pessoa, marcos e ambas as opções na Agenda', () => {
  const { s, sheet, book, payload } = fixture();
  const before = sheet.rows[1].slice();
  assert.match(s.salvarDadosParticipante(payload), /cadastrado/);
  assert.deepEqual(sheet.rows[1].slice(0, before.length), before);
  const personColumn = sheet.rows[0].indexOf('ID Pessoa');
  assert.equal(sheet.rows[2][personColumn], 'PES-1');
  assert.equal(String(sheet.rows[2][0]), '2');
  assert.equal(sheet.rows[2][4], 'S-1');
  assert.equal(sheet.rows[2][5], 'SPY');
  assert.equal(sheet.rows[2][13] || '', '');
  const options = s.agendaParticipantesFormulario_(book, true);
  assert.deepEqual(Array.from(options, p => p.projeto), ['DUET', 'SPY']);
  assert.deepEqual(Array.from(options, p => p.id), ['1', '2']);
  assert.equal(s.CadastroRules_.agendaEventMatchesParticipant({id:'2',nome:payload.nome,idParticipante:'S-1',projeto:'SPY'}, {participantCadastroId:'1',participante:payload.nome,projeto:'DUET'}), false);
});

test('confirmação de CPF duplicado também permite vínculo ao acompanhamento', () => {
  const { s, sheet, payload } = fixture();
  delete payload.novaParticipacaoDireta;
  const confirmation = s.salvarDadosParticipante({...payload});
  assert.equal(confirmation.requiresNameConfirmation, true);
  assert.equal(sheet.writes, 0);
  assert.match(s.salvarDadosParticipante({...payload, confirmarNomeDuplicado: true}), /cadastrado/);
  assert.equal(sheet.rows[2][sheet.rows[0].indexOf('ID Pessoa')], 'PES-1');
});

test('origem ativa ou com óbito é bloqueada sem escrita, inclusive via confirmação alternativa', () => {
  for (const status of ['Ativo', 'Triagem', 'Óbito']) {
    for (const direct of [true, false]) {
      const { s, sheet, payload } = fixture(status);
      payload.novaParticipacaoDireta = direct;
      payload.confirmarNomeDuplicado = true;
      assert.throws(() => s.salvarDadosParticipante(payload), /Encerre|óbito/);
      assert.equal(sheet.writes, 0);
    }
  }
});

test('regra revalida todas as participações da pessoa sob lock, inclusive óbito e alteração concorrente', () => {
  for (const status of ['Ativo', 'Óbito']) {
    const { s, sheet, payload } = fixture();
    s.codexWithDocumentLock_ = (_, action) => {
      sheet.rows.push(['2','Pessoa teste','','','O-1','Outro','','',status,'','52998224725','','PES-1']);
      return action();
    };
    assert.throws(() => s.salvarDadosParticipante(payload), /ativa em Outro|óbito/);
    assert.equal(sheet.writes, 0);
  }
  const { s, sheet, payload } = fixture();
  s.codexWithDocumentLock_ = (_, action) => { sheet.rows[1][8] = 'Ativo'; return action(); };
  assert.throws(() => s.salvarDadosParticipante(payload), /Encerre/);
  assert.equal(sheet.writes, 0);
});

test('novo status mantém bloqueio de duplicidade no mesmo protocolo e de troca de protocolo com histórico', () => {
  const { s, sheet, payload } = fixture();
  assert.throws(() => s.salvarDadosParticipante({...payload, projeto:'DUET', idParticipante:'D-2'}), /CPF/);
  assert.throws(() => s.salvarDadosParticipante({...payload, id:'1', novaParticipacaoDireta:false}), /marcos|eventos na Agenda/);
  assert.equal(sheet.writes, 0);
});
