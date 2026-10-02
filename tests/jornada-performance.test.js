'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

// Every service surface below is local. The counters measure Sheets read blocks,
// not production duration, and deliberately include the nested readiness reads.
function fixture() {
  const reads = {};
  const tables = {
    Projetos: [['ID', 'Nome', 'Codigo', 'CTMS Jornada ativo'], ['PROJ', 'Aurora', 'A', 'Nao']],
    Participantes: [['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto'], ['P', 'Pessoa', '', '', 'PT', 'Aurora']],
    SoA_Visitas: [['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem'], ['S', 'Aurora', 'V1', 'Visita 1', 1]],
    Itens: [['ID_Item', 'Projeto', 'Descricao', 'Tipo'], ['I', 'Aurora', 'Kit', 'Kit']],
    Estoque: [['ID', 'Projeto', 'Descricao'], ['E', 'Aurora', 'Kit']],
    Reservas_Kits: [['ID_Reserva'], ['R']]
  };
  const sheets = {};
  Object.entries(tables).forEach(([name, rows], index) => {
    function record(values) {
      reads[name] = (reads[name] || 0) + 1;
      return values;
    }
    sheets[name] = {
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(...rows.map(row => row.length), 1),
      getSheetId: () => index + 1,
      getDataRange: () => ({ getValues: () => record(rows) }),
      getRange: (row, col, count, width) => ({ getValues: () => record(rows.slice(row - 1, row - 1 + count)
        .map(values => Array.from({ length: width }, (_, i) => values[col - 1 + i] ?? ''))) })
    };
  });
  const spreadsheet = { getSheetByName: name => sheets[name] || null };
  const server = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs'], {
    Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: () => '' }
  });
  server.codexAssertCanRead_ = () => ({ ok: true });
  server.getCodexSpreadsheet_ = () => spreadsheet;
  server.getAgendaSheetForRead_ = () => null;
  server.getAgendaSoAConciliacoesPorAgendaId_ = () => ({});
  server.getSoAVisitasSheet_ = () => sheets.SoA_Visitas;
  server.getProjetoBracosSheet_ = () => null;
  const payload = { idCadastro: 'P', nome: 'Pessoa', idParticipante: 'PT', projeto: 'Aurora' };
  return { server, payload, reads, tables };
}

test('Jornada compartilha Projetos, catálogo e reservas entre cálculo e prontidão na mesma RPC', () => {
  const f = fixture();
  const result = f.server.getJornadaParticipante(f.payload);
  assert.equal(result.visitas.length, 1);
  assert.equal(result.participante.idCadastro, 'P');
  assert.equal(f.reads.Projetos, 1);
  assert.equal(f.reads.Itens, 1);
  assert.equal(f.reads.Reservas_Kits, 1);
});

test('histórico sob demanda preserva a Jornada e carrega apenas visitas anteriores da mesma participação', () => {
  const f = fixture();
  const cfg = f.server.AGENDA_CFG;
  cfg.idx.participanteCadastroId = cfg.lastCol++;
  function row(id, year, overrides = {}) {
    const values = Array(cfg.lastCol).fill('');
    const fields = { id, tipo: 'Visita', projeto: 'Aurora', participante: 'Pessoa',
      participanteCadastroId: 'P', idParticipante: 'PT', visita: 'V1', data: new Date(year, 0, 1), status: 'Realizado', ...overrides };
    Object.entries(fields).forEach(([key, value]) => { values[cfg.idx[key]] = value; });
    return values;
  }
  const rows = Array.from({ length: 61 }, (_, i) => row('OLD-' + i, 2025));
  rows.push(row('CURRENT', 2026), row('OTHER', 2025, { participanteCadastroId: 'OUTRO' }), row('NOT-VISIT', 2025, { tipo: 'Consulta' }));
  f.server.getAgendaSheetForRead_ = () => ({ getLastRow: () => rows.length + 1,
    getRange: () => ({ getValues: () => rows }) });
  f.server.formatarDataSafe = date => String(date.getFullYear());
  const full = f.server.getJornadaParticipante(f.payload);
  const lazy = f.server.getJornadaParticipante({ ...f.payload, historicoAnteriorSobDemanda: true });
  assert.equal(full.eventosAnteriores.length, 61);
  assert.equal(lazy.eventosAnteriores.length, 0);
  assert.equal(lazy.eventosAnterioresTotal, 61);
  assert.equal(JSON.stringify(full.visitas), JSON.stringify(lazy.visitas));
  assert.equal(JSON.stringify(full.eventosLivres), JSON.stringify(lazy.eventosLivres));
  const historico = f.server.consultarHistoricoAnteriorJornada(f.payload);
  assert.equal(historico.eventos.length, 61);
  assert.equal(JSON.stringify(historico.eventos), JSON.stringify(full.eventosAnteriores));
  f.server.codexAssertCanRead_ = () => { throw new Error('NEGADO'); };
  f.server.getAgendaSheetForRead_ = () => { throw new Error('Não pode ler'); };
  assert.throws(() => f.server.consultarHistoricoAnteriorJornada(f.payload), /NEGADO/);
});

test('snapshot de prontidão pertence à consulta e é relido na próxima Jornada', () => {
  const f = fixture();
  f.server.getJornadaParticipante(f.payload);
  f.server.getJornadaParticipante(f.payload);
  assert.equal(f.reads.Projetos, 2);
  assert.equal(f.reads.Itens, 2);
  assert.equal(f.reads.Reservas_Kits, 2);
});

test('falha de consulta libera o contexto temporário sem alterar leitores externos', () => {
  const f = fixture();
  const failure = new Error('falha simulada');
  f.server.getAgendaSheetForRead_ = () => { throw failure; };
  assert.throws(() => f.server.getJornadaParticipante(f.payload), error => error === failure);
  assert.equal(f.server.CODEX_JORNADA_READ_CONTEXT_, null);
  // Outside Jornada the public catalogue retains its form reference lists.
  const catalog = f.server.getItensEstoque();
  assert.deepEqual(Array.from(catalog.projetos), ['Aurora']);
  assert.deepEqual(Array.from(catalog.projetosAtivos), ['Aurora']);
});
