'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function fixture(logs = [], changes = []) {
  const log = new FakeSheet('Audit_Log', [Array(6).fill('header'), ...logs]);
  const change = new FakeSheet('Audit_Changes', [Array(10).fill('header'), ...changes]);
  const book = new FakeSpreadsheet({ Audit_Log: log, Audit_Changes: change });
  const server = runFiles(['CadastroRules.gs', 'WebApp.gs'], { Date,
    Utilities: { formatDate(date, zone, format) {
      assert.equal(zone, 'America/Sao_Paulo');
      assert.equal(format, 'dd/MM/yyyy HH:mm');
      return date.toISOString();
    } }, Logger: { log() {} }
  });
  server.getCodexSpreadsheet_ = () => book;
  return { server, log, change };
}
const logRow = (action, date, id = '1', module = 'Cadastros', user = 'autor@exemplo.org') => ['AUD', user, action, date, module, id];
const changeRow = (date, action = 'atualizarParticipacaoParticipante', id = '1') => ['AUD', date, 'editor@exemplo.org', 'Cadastros', action, id];

test('histórico usa ID exato, módulo e eventos concluídos; ordem física não altera datas', () => {
  const f = fixture([
    logRow('criarParticipacaoParticipante', new Date('2026-10-02T12:00:00Z')),
    logRow('criarParticipacaoParticipante', new Date('2026-10-01T12:00:00Z')),
    logRow('salvarDadosParticipante', new Date('2026-10-15T12:00:00Z')),
    logRow('criarParticipacaoParticipante', new Date('2020-01-01T12:00:00Z'), '2'),
    logRow('criarParticipacaoParticipante', new Date('2020-01-01T12:00:00Z'), '1', 'Agenda'),
    logRow('atualizarCadastroParticipanteConcluido', new Date('2026-10-13T12:00:00Z'))
  ], [changeRow(new Date('2026-10-12T12:00:00Z')), changeRow(new Date('2026-10-10T12:00:00Z'))]);
  const result = f.server.participanteHistoricoCadastro_('1');
  assert.equal(result.cadastro.dataHora, '2026-10-01T12:00:00.000Z');
  assert.equal(result.cadastro.responsavel, 'autor@exemplo.org');
  assert.equal(result.ultimaAtualizacao.dataHora, '2026-10-13T12:00:00.000Z');
  assert.equal(f.log.writes + f.change.writes, 0);
});

test('histórico legado não inventa criação e ignora tentativas, ações alheias e datas inválidas', () => {
  const f = fixture([
    logRow('salvarDadosParticipante', new Date()),
    logRow('criarParticipacaoParticipante', '01/10/2026 12:00'),
    logRow('criarParticipacaoParticipante', new Date('inválida'))
  ], [changeRow(new Date('2026-10-12T12:00:00Z')), changeRow(new Date(), 'atualizarProjeto'), changeRow(new Date(), 'atualizarMarcosParticipacao', '11')]);
  const result = f.server.participanteHistoricoCadastro_('1');
  assert.equal(result.cadastro, null);
  assert.equal(result.ultimaAtualizacao.responsavel, 'editor@exemplo.org');
  assert.equal(result.indisponivel, false);
});

test('auditoria ausente ou indisponível não bloqueia a ficha e leitura não cria abas', () => {
  const f = fixture();
  f.server.getCodexSpreadsheet_ = () => new FakeSpreadsheet({});
  assert.equal(f.server.participanteHistoricoCadastro_('1').cadastro, null);
  f.server.getCodexSpreadsheet_ = () => { throw new Error('permission'); };
  const result = f.server.participanteHistoricoCadastro_('1');
  assert.equal(result.indisponivel, true);
  assert.equal(result.cadastro, null);
});
