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
  const getProjetos = server.getProjetosDados_;
  let lastProjects;
  server.getProjetosDados_ = incluirSiv => { lastProjects = getProjetos(incluirSiv); return lastProjects; };
  function reset() { Object.keys(counts).forEach(key => { counts[key] = 0; }); logs.length = 0; }
  return { server, sheet, cfg, counts, projects, reset, failNextDisplay: () => { failDisplay = true; },
    lastProjects: () => lastProjects,
    entries: () => logs.filter(line => line.startsWith('[CODEX_PERF] '))
      .map(line => JSON.parse(line.slice('[CODEX_PERF] '.length))) };
}

test('Dashboard elimina SIV e pendências sem alterar os campos consumidos pelos gráficos', () => {
  const f = fixture();
  const projects = plain(f.server.getProjetos());
  const pending = plain(f.server.getDashboardPendencias_([]));
  const agenda = plain(f.server.getAgendaDashboardResumo_());
  assert.equal(projects[0].dataSivInicio, '10/01/2026');
  assert.equal(projects[0].dataSivFim, '11/01/2026');
  assert.equal(pending.transporteBackupNaoAgendado[0].agendaId, '00123');
  f.reset();
  f.server.getDashboardPendencias_ = () => { throw new Error('cálculo não utilizado'); };
  f.server.getProjetosSivPorProjeto_ = () => { throw new Error('SIV não utilizada'); };
  const data = f.server.getDashboardData();
  assert.deepEqual(plain(data.erros), []);
  assert.deepEqual(plain(data.avisos), []);
  Object.keys(data.projetos[0]).forEach(key => assert.deepEqual(plain(data.projetos[0][key]), projects[0][key], key));
  assert.equal(Object.hasOwn(data, 'pendencias'), false);
  assert.deepEqual(plain(data.agendaResumo), agenda);
  assert.equal(f.counts.display, 0);
  assert.equal(f.counts.raw, 1);
  assert.equal(f.counts.sheet, 1);
  assert.equal(f.counts.access, 2);
  assert.equal(f.sheet.writes, 0);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
  assert.equal(f.entries().some(entry => ['pending', 'projects_siv'].includes(entry.stage)), false);
  assert.equal(f.entries().at(-1).instrumentedReadCalls, 1);
  assert.equal(f.entries().at(-1).instrumentedCellsRead, 4 * f.cfg.lastCol);
});

test('Projetos público conserva SIV mesmo recebendo argumento false e Pendências mantém dados atuais', () => {
  const f = fixture();
  f.server.getDashboardData();
  f.sheet.rows[1][f.cfg.idx.id] = 789;
  assert.equal(f.server.getDashboardPendencias_([]).transporteBackupNaoAgendado[0].agendaId, '00789');
  assert.equal(f.server.getProjetos(false)[0].dataSivFim, '11/01/2026');
  assert.equal(f.counts.display, 2);
  assert.equal(f.counts.raw, 1);
  assert.equal(f.counts.sheet, 3);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
});

test('cada Dashboard consulta novamente a Agenda e restaura contexto externo', () => {
  const f = fixture();
  const outer = { rows: null, sheet: { marker: 'outer' }, traceId: 'outer-trace' };
  f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_ = outer;
  const first = plain(f.server.getDashboardData({ traceId: 'inner-trace' }));
  f.sheet.rows.splice(1);
  const second = f.server.getDashboardData();
  assert.notDeepEqual(plain(second.agendaResumo), first.agendaResumo);
  assert.deepEqual(plain(second.erros), []);
  assert.equal(f.counts.sheet, 2);
  assert.equal(f.counts.raw, 1);
  assert.equal(f.counts.display, 0);
  assert.equal(f.counts.lastRow, 2);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, outer);
  assert.equal(outer.sheet.marker, 'outer');
  const stages = f.entries().filter(entry => entry.stage.startsWith('projects_') && entry.traceId === 'inner-trace');
  assert.deepEqual(stages.map(entry => entry.stage), ['projects_sheet', 'projects_participants_stats']);
});

test('falha de leitura formatada não afeta Dashboard e consultas independentes podem recuperar', () => {
  const f = fixture();
  f.failNextDisplay();
  assert.equal(f.server.getDashboardData().erros.length, 0);
  assert.equal(f.counts.display, 0);
  assert.throws(() => f.server.getProjetos(), /leitura formatada indisponível/);
  assert.equal(f.server.getDashboardPendencias_([]).counts.transporteBackupNaoAgendado, 1);
  assert.equal(f.counts.display, 2);
});

test('falha de Agenda conserva Projetos e uma nova RPC recupera a leitura', () => {
  const f = fixture();
  let attempts = 0;
  f.server.getAgendaSheetForRead_ = () => {
    if (++attempts === 1) throw new Error('preparação indisponível');
    return f.sheet;
  };
  const data = f.server.getDashboardData();
  assert.equal(attempts, 1);
  assert.equal(data.projetos.length, 1);
  assert.equal(data.secoes.agenda, false);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
  assert.equal(f.server.getDashboardData().secoes.agenda, true);
  assert.equal(attempts, 2);
});

test('contexto é descartado se uma exceção interrompe a RPC', () => {
  const f = fixture();
  f.server.Logger.log = message => {
    if (message.startsWith('[getDashboardData] Retornando.')) throw new Error('falha inesperada');
  };
  assert.throws(() => f.server.getDashboardData(), /falha inesperada/);
  assert.equal(f.server.CODEX_DASHBOARD_AGENDA_DISPLAY_CONTEXT_, null);
  f.sheet.rows[1][f.cfg.idx.id] = 999;
  assert.equal(f.server.getDashboardPendencias_([]).transporteBackupNaoAgendado[0].agendaId, '00999');
  assert.equal(f.counts.display, 1);
});

test('acesso negado impede Dashboard e ambos os caminhos de Projetos antes de leituras', () => {
  const f = fixture();
  f.server.codexAssertCanRead_ = () => { throw new Error('acesso negado'); };
  for (const call of [() => f.server.getDashboardData(), () => f.server.getProjetos(), () => f.server.getProjetosDados_(false)]) {
    assert.throws(call, /acesso negado/);
  }
  assert.equal(f.counts.sheet, 0);
  assert.equal(f.counts.display, 0);
  assert.equal(f.counts.raw, 0);
});
