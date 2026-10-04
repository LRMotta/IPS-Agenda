'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const logs = [];
  const server = runFiles(['AgendaServerRules.gs', 'WebApp.gs'], {
    Date,
    Logger: { log: message => logs.push(message) },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: {
      newBlob: value => ({ getBytes: () => Buffer.from(value, 'utf8') }),
      formatDate: date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')].join('-')
    }
  });
  server.getAgendaFeriadosOperacionais_ = () => [];
  const cfg = server.AGENDA_CFG;
  function row(id, date, type, status) {
    const result = Array(cfg.lastCol).fill('');
    Object.entries({ id, data: date, tipo: type, status, projeto: 'Projeto A', hora: '09:00',
      participante: 'Participante A', visita: type === 'Visita' ? 'V1' : 'SIV' })
      .forEach(([key, value]) => { result[cfg.idx[key]] = value; });
    return result;
  }
  const rows = [row(123, new Date(2099, 0, 15), 'Visita', 'Agendado'),
    row('SIV-1', new Date(2026, 0, 10), 'SIV', 'Realizado'),
    row('SIV-2', new Date(2026, 0, 11), 'SIV', 'Realizado'),
    row('SIV-CANCELADA', new Date(2026, 0, 12), 'SIV', 'Cancelado')];
  rows[0][cfg.idx.cb.nome] = 'OCASA';
  rows[0][cfg.idx.cb.status] = 'Não Agendado';
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), ...rows]);
  const counts = { display: 0, raw: 0, lastRow: 0, access: 0, sheet: 0 };
  let failDisplay = false;
  const getRange = sheet.getRange.bind(sheet);
  const getLastRow = sheet.getLastRow.bind(sheet);
  sheet.getLastRow = () => { counts.lastRow++; return getLastRow(); };
  sheet.getRange = (...args) => {
    const range = getRange(...args);
    const getValues = range.getValues.bind(range);
    range.getValues = () => { counts.raw++; return getValues(); };
    range.getDisplayValues = () => {
      counts.display++;
      if (failDisplay) { failDisplay = false; throw new Error('leitura formatada indisponível'); }
      return getValues().map(values => values.map((value, col) => {
        if (value instanceof Date) return [String(value.getDate()).padStart(2, '0'),
          String(value.getMonth() + 1).padStart(2, '0'), value.getFullYear()].join('/');
        if (col === cfg.idx.id && typeof value === 'number') return String(value).padStart(5, '0');
        return String(value);
      }));
    };
    return range;
  };
  server.getAgendaSheetForRead_ = () => { counts.sheet++; return sheet; };
  server.codexAssertCanRead_ = () => { counts.access++; };
  const projects = [['ID', 'Nome', 'Código'], ['P1', 'Projeto A', 'PROTOCOLO-A']];
  server.getCodexSheetDataByName_ = name => { assert.equal(name, 'Projetos'); return projects; };
  server.getParticipantesStatsPorProjeto_ = () => ({});
  server.getParticipantesDashboardResumo_ = () => [];
  server.getEstoque = () => [];
  // Isola relógio e serviços auxiliares; classificações e vínculos continuam reais.
  server.prazoHorasPendenciaAgenda_ = () => 12;
  const getProjetos = server.getProjetos;
  let lastProjects;
  server.getProjetos = () => { lastProjects = getProjetos(); return lastProjects; };
  function reset() { Object.keys(counts).forEach(key => { counts[key] = 0; }); logs.length = 0; }
  return { server, sheet, cfg, counts, projects, reset, failNextDisplay: () => { failDisplay = true; },
    lastProjects: () => lastProjects,
    entries: () => logs.filter(line => line.startsWith('[CODEX_PERF] '))
      .map(line => JSON.parse(line.slice('[CODEX_PERF] '.length))) };
}

test('Dashboard compartilha uma leitura formatada e preserva Projetos, pendências e valores brutos', () => {
  const f = fixture();
  const projects = plain(f.server.getProjetos());
  const pending = plain(f.server.getDashboardPendencias_([]));
  const agenda = plain(f.server.getAgendaDashboardResumo_());
  assert.equal(f.counts.display, 2); // Fora do Dashboard, consultas independentes.
  assert.equal(f.counts.sheet, 3);
  assert.equal(projects[0].dataSivInicio, '10/01/2026');
  assert.equal(projects[0].dataSivFim, '11/01/2026');
  assert.equal(pending.transporteBackupNaoAgendado[0].agendaId, '00123');
  f.reset();
  const data = f.server.getDashboardData();
  assert.deepEqual(plain(data.erros), []);
  assert.deepEqual(plain(data.avisos), []);
  assert.deepEqual(plain(f.lastProjects()), projects);
  assert.deepEqual(plain(data.pendencias), pending);
  assert.deepEqual(plain(data.agendaResumo), agenda);
  assert.equal(f.counts.display, 1);
  assert.equal(f.counts.raw, 1);
  assert.equal(f.counts.sheet, 1); // SIV, resumo e pendências compartilham a preparação.
  assert.equal(f.counts.access, 2); // Dashboard e RPC pública de Projetos mantêm autorização.
  assert.equal(f.sheet.writes, 0);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
  assert.equal(f.entries().find(entry => entry.stage === 'pending').instrumentedReadCalls, 0);
  assert.equal(f.entries().find(entry => entry.stage === 'total').instrumentedReadCalls, 2);
  assert.equal(f.entries().at(-1).instrumentedCellsRead, 2 * 4 * f.cfg.lastCol);
});

test('cada nova RPC lê novamente e chamadas independentes não herdam a matriz do Dashboard', () => {
  const f = fixture();
  assert.equal(f.server.getDashboardData().pendencias.transporteBackupNaoAgendado[0].agendaId, '00123');
  f.sheet.rows[1][f.cfg.idx.id] = 456;
  assert.equal(f.server.getDashboardData().pendencias.transporteBackupNaoAgendado[0].agendaId, '00456');
  assert.equal(f.counts.display, 2);
  assert.equal(f.counts.sheet, 2); // Uma nova preparação por RPC, sem cache entre consultas.
  f.sheet.rows[1][f.cfg.idx.id] = 789;
  assert.equal(f.server.getDashboardPendencias_([]).transporteBackupNaoAgendado[0].agendaId, '00789');
  f.server.getProjetos();
  assert.equal(f.counts.display, 4);
  assert.equal(f.counts.sheet, 4);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
});

test('Agenda vazia é reaproveitada sem leituras de faixa nem nova consulta de última linha em pendências', () => {
  const f = fixture();
  f.sheet.rows.splice(1);
  const data = f.server.getDashboardData();
  assert.deepEqual(plain(data.erros), []);
  assert.equal(data.pendencias.counts.transporteBackupNaoAgendado, 0);
  assert.equal(f.counts.display, 0);
  assert.equal(f.counts.raw, 0);
  assert.equal(f.counts.lastRow, 2); // Leitura formatada em Projetos + resumo bruto da Agenda.
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
});

test('falha de leitura em Projetos não é memorizada e pendências pode recuperar a leitura', () => {
  const f = fixture();
  f.failNextDisplay();
  const data = f.server.getDashboardData();
  assert.match(data.erros[0], /getProjetos: leitura formatada indisponível/);
  assert.equal(data.pendencias.counts.transporteBackupNaoAgendado, 1);
  assert.equal(f.counts.display, 2);
  assert.equal(f.entries().find(entry => entry.stage === 'projects').success, false);
  assert.equal(f.entries().find(entry => entry.stage === 'pending').success, true);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
  assert.equal(f.server.getDashboardData().erros.length, 0);
  assert.equal(f.counts.display, 3);
});

test('a matriz é descartada mesmo quando uma exceção interrompe a RPC após o carregamento', () => {
  const f = fixture();
  f.server.Logger.log = message => {
    if (message.startsWith('[getDashboardData] Retornando.')) throw new Error('falha inesperada');
  };
  assert.throws(() => f.server.getDashboardData(), /falha inesperada/);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
  f.sheet.rows[1][f.cfg.idx.id] = 999;
  assert.equal(f.server.getDashboardPendencias_([]).transporteBackupNaoAgendado[0].agendaId, '00999');
  assert.equal(f.counts.display, 2);
});

test('acesso negado não cria contexto nem lê a Agenda', () => {
  const f = fixture();
  f.server.codexAssertCanRead_ = () => { throw new Error('acesso negado'); };
  assert.throws(() => f.server.getDashboardData(), /acesso negado/);
  assert.throws(() => f.server.getProjetos(), /acesso negado/);
  assert.equal(f.counts.display, 0);
  assert.equal(f.counts.raw, 0);
  assert.equal(f.counts.lastRow, 0);
  assert.equal(f.counts.sheet, 0);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
});

test('Dashboard repete preparação após falha e conserva o resultado parcial de SIV', () => {
  const f = fixture();
  let attempts = 0;
  f.server.getAgendaSheetForRead_ = () => {
    attempts++;
    if (attempts === 1) throw new Error('preparação indisponível');
    return f.sheet;
  };
  const data = f.server.getDashboardData();
  assert.equal(attempts, 2);
  assert.equal(data.projetos.length, 1);
  assert.equal(data.secoes.agenda, true);
  assert.equal(data.pendencias.counts.transporteBackupNaoAgendado, 1);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
});

test('preparação ausente não fica memorizada e contexto aninhado é restaurado', () => {
  const f = fixture();
  const outer = { rows: null, sheet: { marker: 'outer' }, traceId: 'outer-trace' };
  f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_ = outer;
  let attempts = 0;
  f.server.getAgendaSheetForRead_ = () => ++attempts === 1 ? null : f.sheet;
  const data = f.server.getDashboardData({ traceId: 'inner-trace' });
  assert.equal(attempts, 2);
  assert.equal(data.secoes.agenda, true);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, outer);
  assert.equal(outer.sheet.marker, 'outer');
  const stages = f.entries().filter(entry => entry.stage.startsWith('projects_'));
  assert.deepEqual(stages.map(entry => entry.stage), ['projects_sheet', 'projects_participants_stats', 'projects_siv']);
  assert.equal(stages.every(entry => entry.traceId === 'inner-trace' && entry.success), true);
});

test('pendências carrega a matriz quando não há projetos que iniciem a leitura', () => {
  const f = fixture();
  f.projects.length = 0;
  const data = f.server.getDashboardData();
  assert.equal(data.projetos.length, 0);
  assert.equal(data.pendencias.counts.transporteBackupNaoAgendado, 1);
  assert.equal(f.counts.display, 1);
  assert.equal(f.counts.raw, 1);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
});
