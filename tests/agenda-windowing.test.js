'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} nao encontrada`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`Corpo incompleto de ${name}`);
}

function fakeAgenda(server, records) {
  const cfg = server.AGENDA_CFG;
  const rows = records.map((record) => {
    const row = Array(cfg.lastCol).fill('');
    row[cfg.idx.id] = record.id;
    row[cfg.idx.data] = record.data;
    row[cfg.idx.tipo] = 'Visita';
    row[cfg.idx.status] = 'Agendado';
    row[cfg.idx.participante] = record.participante;
    row[cfg.idx.idParticipante] = record.id;
    row[cfg.idx.braco] = 'A';
    return row;
  });
  return {
    getLastRow: () => rows.length + 1,
    getRange(row, column, numRows, numColumns) {
      return {
        getValues: () => rows.slice(row - 2, row - 2 + numRows)
          .map((source) => source.slice(column - 1, column - 1 + numColumns))
      };
    }
  };
}

function agendaServer() {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  return runFile('WebApp.gs', { AgendaServerRules_: rules });
}

test('intervalos da agenda aceitam somente datas ISO validas', () => {
  const server = agendaServer();
  assert.equal(server.agendaParseIsoBoundary_('2026-07-17', 'inicio').getDate(), 17);
  assert.throws(() => server.agendaParseIsoBoundary_('2026-02-30', 'inicio'), /invalida/);
  assert.throws(() => server.agendaParseIsoBoundary_('</script>', 'inicio'), /invalida/);
});

test('carga principal traz os ultimos 5.000 eventos para incluir agendamentos futuros', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(client, /\.getAgendaEventos\(5000\)/);
  assert.doesNotMatch(functionBody(client, 'carregarAgendaEventos'), /getAgendaEventosPorPeriodo/);
  assert.match(server, /function getAgendaEventos\(limite\)/);
  assert.match(functionBody(server, 'getAgendaEventos'), /Math\.min\(Number\(limite \|\| 80\), 5000, lastRow - 1\)/);
});

test('navegacao semanal continua usando a carga integral da Agenda', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const load = functionBody(client, 'carregarAgendaEventos');
  assert.match(functionBody(client, 'agendaNavWeek'), /carregarAgendaEventos\(false\)/);
  assert.doesNotMatch(load, /agendaVisibleWeekIsLoaded/);
  assert.match(load, /\.getAgendaEventos\(5000\)/);
});

test('servidor retorna somente a janela solicitada e informa truncamento', () => {
  const server = agendaServer();
  server.getAgendaSheet_ = () => fakeAgenda(server, [
    { id: '1', data: '2026-07-10', participante: 'Fora' },
    { id: '2', data: '2026-07-14', participante: 'Alpha' },
    { id: '3', data: '2026-07-16', participante: 'Beta' },
    { id: '4', data: '2026-07-18', participante: 'Gamma' },
    { id: '5', data: '2026-07-25', participante: 'Fora' }
  ]);
  const result = server.getAgendaEventosPorPeriodo('2026-07-14', '2026-07-21', 2, true);
  assert.equal(result.total, 3);
  assert.equal(result.items.length, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(Array.from(result.items, (item) => item.id), ['2', '3']);
});

test('pesquisa historica e paginada em lotes sem serializar toda a agenda', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(client, /\.pesquisarAgendaHistorico\(query, cursor, 25\)/);
  assert.match(client, /function agendaHistoricoProxima\(\)/);
  assert.match(client, /function agendaHistoricoAnterior\(\)/);
  assert.match(server, /var batchSize = 200/);
  assert.match(server, /Math\.min\(Number\(pageSize \|\| 25\), 50\)/);
  assert.match(server, /nextCursor/);
});

test('cursor da pesquisa historica nao repete nem perde resultados', () => {
  const server = agendaServer();
  server.getAgendaSheet_ = () => fakeAgenda(server, [
    { id: '1', data: '2026-07-10', participante: 'Alpha' },
    { id: '2', data: '2026-07-11', participante: 'Outro' },
    { id: '3', data: '2026-07-12', participante: 'Alpha' }
  ]);
  const first = server.pesquisarAgendaHistorico('Alpha', null, 1);
  const second = server.pesquisarAgendaHistorico('Alpha', first.nextCursor, 1);
  assert.equal(first.items[0].id, '3');
  assert.equal(second.items[0].id, '1');
  assert.equal(second.nextCursor, null);
});

test('abertura direta busca somente o evento solicitado', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(client, /\.getAgendaEventoPorId\(agendaId\)/);
  assert.match(server, /function getAgendaEventoPorId\(id\)/);
});
