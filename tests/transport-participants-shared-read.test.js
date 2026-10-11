'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const sheet = new FakeSheet('Participantes', [
    ['ID', 'Nome', 'Nascimento', '', 'Identificacao', 'Projeto', 'Braco', '', 'Status'],
    ['CAD-A', 'Pessoa A', '1990-01-01', '', '123', 'Projeto A', 'Controle', '', 'Inativo'],
    ['CAD-B', 'Pessoa A', '', '', '123', 'Projeto B', '', '', 'Ativo'],
    ['CAD-C', 'Pessoa C', '', '', '', 'Projeto A', '', '', 'Ativo'],
    ['', 'Sem cadastro', '', '', '', '', '', '', ''],
    ['CAD-D', 'Duplicado', '', '', '456', 'Projeto A', '', '', 'Ativo'],
    ['CAD-E', 'Duplicado', '', '', '456', 'Projeto A', '', '', 'Ativo']
  ]);
  let reads = 0;
  let failFirst = false;
  const getRange = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => {
    const range = getRange(...args);
    const getValues = range.getValues.bind(range);
    range.getValues = () => {
      reads++;
      if (failFirst) { failFirst = false; throw new Error('Falha transitoria'); }
      return getValues();
    };
    return range;
  };
  const s = runFiles(['CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs'], {
    Logger: { log() {} }, SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Participantes: sheet }) }
  });
  s.getCodexSheetDataByName_ = () => sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  s.formatarDataSafe = value => String(value || '');
  s.transporteJanelaEnvioPadrao_ = () => '08:00 - 12:00';
  s.transporteAgendadorPadrao_ = () => 'Usuario';
  s.transporteInvestigadorPorProjeto_ = () => 'Investigador';
  s.transporteProjetoDisplay_ = value => value;
  s.buscarAgendaEventoPorIdTransp_ = () => ({
    participante: 'Pessoa A', participantCadastroId: 'CAD-A', idParticipante: '123', projeto: 'Projeto A', courier1: { nome: 'DHL' }
  });
  return { s, sheet, reads: () => reads, failNext: () => { failFirst = true; } };
}

test('leitura compartilhada preserva todos os campos e reduz duas leituras a uma por abertura', () => {
  const { s, reads } = fixture();
  const evento = s.buscarAgendaEventoPorIdTransp_();
  const beforePayload = plain(s.montarPayloadTransporteParaTransp_('EVT-1', '1', evento));
  const beforeParticipants = plain(s.transporteReadParticipantesDireto_());
  assert.equal(reads(), 2);
  const context = s.montarContextoTransporteParaTransp_('EVT-1', '1');
  assert.deepEqual(plain(context.payload), beforePayload);
  assert.deepEqual(plain(s.transporteReadParticipantesDireto_(context.leituraParticipantes)), beforeParticipants);
  assert.equal(reads(), 3);
  assert.equal(beforeParticipants[0].status, 'Inativo');
  let received;
  s.salvarTransporteInterno_ = (payload, options, leituraParticipantes) => {
    received = { ...options, leituraParticipantes };
    const participantes = s.transporteReadParticipantesDireto_(leituraParticipantes);
    return s.transporteDerivarDadosParticipante_(payload, { participantes, obrigatorio: false });
  };
  const result = s.importarTransporteCodexInterno_(context.payload, context, { preencherDocumentos: false, returnPreparedRecord: true });
  assert.equal(received.leituraParticipantes, context.leituraParticipantes);
  assert.equal(received.preencherDocumentos, false);
  assert.equal(received.returnPreparedRecord, true);
  assert.equal(result.participanteCadastroId, 'CAD-A');
  assert.equal(result.identificacaoParticipante, '123');
  assert.equal(reads(), 3);
});

test('referencias historicas, nomes iguais, campos ausentes e ambiguidades mantem o resultado', () => {
  const { s } = fixture();
  for (const ref of [
    { idCadastro: 'CAD-A' }, { nome: 'Pessoa A', projeto: 'Projeto B' },
    { idParticipante: '123', projeto: 'Projeto A' }, { nome: 'Pessoa C', projeto: 'Projeto A' },
    { nome: 'Pessoa A' }, { idParticipante: '456', projeto: 'Projeto A' },
    { idCadastro: 'INEXISTENTE' }, {}
  ]) {
    const before = plain(s.agendaInfoParticipanteParaSalvar_(ref));
    const snapshot = {};
    assert.deepEqual(plain(s.agendaInfoParticipanteParaSalvar_(ref, snapshot)), before);
    assert.deepEqual(plain(s.agendaInfoParticipanteParaSalvar_(ref, snapshot)), before);
  }
  assert.equal(s.agendaInfoParticipanteParaSalvar_({ nome: 'Pessoa A' }), null);
  assert.equal(s.agendaInfoParticipanteParaSalvar_({ idParticipante: '456', projeto: 'Projeto A' }), null);
});

test('cada abertura relê o cadastro atual e falha inicial permite tentar novamente', () => {
  const { s, sheet, reads, failNext } = fixture();
  const first = s.montarContextoTransporteParaTransp_('EVT-1', '1');
  sheet.rows[1][4] = '789';
  const second = s.montarContextoTransporteParaTransp_('EVT-1', '1');
  assert.equal(first.payload.numId, '123');
  assert.equal(second.payload.numId, '789');
  assert.notEqual(first.leituraParticipantes, second.leituraParticipantes);
  assert.equal(reads(), 2);
  failNext();
  const failed = s.montarContextoTransporteParaTransp_('EVT-1', '1');
  assert.equal(failed.leituraParticipantes.rows, undefined);
  assert.equal(s.transporteReadParticipantesDireto_(failed.leituraParticipantes)[0].idParticipante, '789');
  assert.equal(reads(), 4);
});

test('cadastro vazio e caminho manual continuam disponiveis sem compartilhar uma leitura falha', () => {
  const { s, sheet } = fixture();
  sheet.rows = sheet.rows.slice(0, 1);
  const context = s.montarContextoTransporteParaTransp_('EVT-1', '1');
  assert.equal(context.leituraParticipantes.rows, undefined);
  assert.deepEqual(plain(s.transporteReadParticipantesDireto_(context.leituraParticipantes)), []);
  assert.deepEqual(plain(s.transporteReadParticipantesDireto_()), []);
});
