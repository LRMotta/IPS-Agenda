'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

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

function agendaServer(contextValues) {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  return runFile('WebApp.gs', Object.assign({ AgendaServerRules_: rules }, contextValues || {}));
}

function fakeAgendaRows(server, rows, calls = []) {
  return {
    getLastRow: () => rows.length + 1,
    getRange(row, column, numRows = 1, numColumns = 1) {
      calls.push({ row, column, numRows, numColumns });
      const values = rows.slice(row - 2, row - 2 + numRows)
        .map((source) => source.slice(column - 1, column - 1 + numColumns));
      return {
        getValue: () => (values[0] || [])[0] || '',
        getValues: () => values
      };
    }
  };
}

function agendaRow(server, values) {
  const row = Array(server.AGENDA_CFG.lastCol).fill('');
  const i = server.AGENDA_CFG.idx;
  Object.keys(values || {}).forEach((key) => {
    if (key === 'courier1Material') row[i.c1.material] = values[key];
    else if (key === 'courier1Json') row[i.c1.matBio] = values[key];
    else if (key === 'backupMaterial') row[i.cb.material] = values[key];
    else if (Object.prototype.hasOwnProperty.call(i, key) && typeof i[key] === 'number') row[i[key]] = values[key];
  });
  return row;
}

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

test('intervalos da agenda aceitam somente datas ISO validas', () => {
  const server = agendaServer();
  assert.equal(server.agendaParseIsoBoundary_('2026-07-17', 'inicio').getDate(), 17);
  assert.throws(() => server.agendaParseIsoBoundary_('2026-02-30', 'inicio'), /invalida/);
  assert.throws(() => server.agendaParseIsoBoundary_('</script>', 'inicio'), /invalida/);
});

test('carga principal restaura os ultimos 5.000 eventos', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(client, /\.getAgendaEventos\(5000\)/);
  assert.match(server, /function getAgendaEventos\(limite\)/);
  assert.match(server, /Math\.min\(Number\(limite \|\| 80\), lastRow - 1\)/);
});

test('carga tardia do formulario preserva os selects de um agendamento aberto', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const apply = functionBody(client, 'applyAgendaFormData');
  const lock = functionBody(client, 'agendaFormDataAplicacaoBloqueadaPorEdicao');
  assert.match(apply, /agendaCurrentValues\(agendaFormDataSelectIds\(\)\)/);
  assert.match(apply, /agendaFormDataAplicacaoBloqueadaPorEdicao\(\)/);
  assert.match(apply, /agendaRestoreValues\(atuais\)/);
  assert.match(lock, /_agendaEditId/);
  assert.match(lock, /classList\.contains\('open'\)/);
  assert.match(client, /function agendaEditValuesFromRecord_\(r\)/);
  assert.match(client, /function agendaRestoreEditRecordValues_\(restaurarTransportes\)/);
  assert.match(client, /agendaRestoreEditRecordValues_\(true\)/);
  assert.match(client, /agendaRestoreEditRecordValues_\(false\)/);
  assert.match(client, /sincronizarAutocompleteProjeto\('agProjeto'\)/);
  assert.match(client, /agendaEditTransportValuesFromRecord_\(r\)/);
  assert.match(client, /preencherAgendaCourierEdit\('agC1'/);
  assert.match(client, /preencherAgendaCourierEdit\('agC3'/);
  assert.match(client, /agendaMatBioLoad\('agBackup'/);
});

test('autocomplete de projeto nao converte os demais selects da Agenda', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const init = functionBody(core, 'iniciarAutocompletesProjetoDinamicos');
  assert.match(init, /ativarAutocompletesProjetoDinamicos\(select\.parentNode \|\| document\)/);
  assert.doesNotMatch(init, /if \(select\) ativarAutocompleteProjeto\(select\.id\)/);
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
  assert.match(client, /function agendaFetchEventoPorId_\(id, rowIndex, onSuccess, onFailure\)/);
  assert.match(client, /\.getAgendaEventoPorId\(id, rowIndex \|\| undefined\)/);
  assert.match(client, /agendaFetchEventoPorId_\(agendaId, 0/);
  assert.match(server, /function getAgendaEventoPorId\(id, rowIndex\)/);
});

test('abertura direta valida rowIndex e le somente a linha completa solicitada', () => {
  const server = agendaServer({ Logger: { log: () => {} } });
  const rows = [Array(server.AGENDA_CFG.lastCol).fill(''), Array(server.AGENDA_CFG.lastCol).fill('')];
  rows[0][server.AGENDA_CFG.idx.id] = 'EVT-1';
  rows[1][server.AGENDA_CFG.idx.id] = 'EVT-2';
  rows[1][server.AGENDA_CFG.idx.idParticipante] = 'P-2';
  rows[1][server.AGENDA_CFG.idx.braco] = 'A';
  const calls = [];
  const sheet = {
    getLastRow: () => 3,
    getRange(row, column, numRows = 1, numColumns = 1) {
      calls.push({ row, column, numRows, numColumns });
      const values = rows.slice(row - 2, row - 2 + numRows)
        .map((source) => source.slice(column - 1, column - 1 + numColumns));
      return {
        getValue: () => (values[0] || [])[0] || '',
        getValues: () => values
      };
    }
  };
  server.getAgendaSheet_ = () => sheet;

  const event = server.getAgendaEventoPorId('EVT-2', 3);
  assert.equal(event.id, 'EVT-2');
  assert.equal(calls.some((call) => call.row === 2 && call.numRows === 2 && call.numColumns === 1), false);
  assert.equal(calls.filter((call) => call.numColumns === server.AGENDA_CFG.lastCol).length, 1);
});

test('abertura direta sem rowIndex procura apenas na coluna de IDs e preserva evento inexistente', () => {
  const server = agendaServer({ Logger: { log: () => {} } });
  const rows = [Array(server.AGENDA_CFG.lastCol).fill(''), Array(server.AGENDA_CFG.lastCol).fill('')];
  rows[0][server.AGENDA_CFG.idx.id] = 'EVT-1';
  rows[1][server.AGENDA_CFG.idx.id] = 'EVT-2';
  rows[0][server.AGENDA_CFG.idx.idParticipante] = 'P-1';
  rows[0][server.AGENDA_CFG.idx.braco] = 'A';
  const calls = [];
  const sheet = {
    getLastRow: () => 3,
    getRange(row, column, numRows = 1, numColumns = 1) {
      calls.push({ row, column, numRows, numColumns });
      const values = rows.slice(row - 2, row - 2 + numRows)
        .map((source) => source.slice(column - 1, column - 1 + numColumns));
      return {
        getValue: () => (values[0] || [])[0] || '',
        getValues: () => values
      };
    }
  };
  server.getAgendaSheet_ = () => sheet;

  assert.equal(server.getAgendaEventoPorId('EVT-1').id, 'EVT-1');
  assert.equal(calls.filter((call) => call.column === server.AGENDA_CFG.col.id && call.numColumns === 1 && call.numRows === 2).length, 1);
  assert.equal(calls.filter((call) => call.numColumns === server.AGENDA_CFG.lastCol).length, 1);
  calls.length = 0;
  assert.equal(server.getAgendaEventoPorId('INEXISTENTE'), null);
  assert.equal(calls.filter((call) => call.numColumns === server.AGENDA_CFG.lastCol).length, 0);
});

test('instrumentacao registra somente metadados e relanca a falha original', () => {
  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  assert.equal(server.codexMeasurePerformance_('operacao', 'etapa', { rowCount: 7, segredo: 'nao-logar' }, () => 'ok'), 'ok');
  const failure = new Error('conteudo sensivel');
  assert.throws(() => server.codexMeasurePerformance_('operacao', 'falha', { rowCount: 3 }, () => { throw failure; }), (error) => error === failure);

  const entries = logs.map((message) => JSON.parse(message.replace(/^\[CODEX_PERF\]\s*/, '')));
  assert.deepEqual(Object.keys(entries[0]).sort(), ['durationMs', 'operation', 'rowCount', 'stage', 'success']);
  assert.equal(entries[0].success, true);
  assert.equal(entries[1].success, false);
  assert.equal(logs.some((message) => message.includes('segredo') || message.includes('conteudo sensivel')), false);
});

test('edicao usa o registro por ID, carrega contexto operacional e revalida em segundo plano', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const open = functionBody(client, 'abrirAgendaEdicao');
  assert.match(client, /function abrirAgendaEdicao\(id, rowIndex\)/);
  assert.match(open, /agendaFindEventoLocal_\(id, rowIndex\)/);
  assert.match(open, /agendaFetchEventoPorId_\(id, rowIndex/);
  assert.match(client, /function agendaAbrirEdicaoResolvida_\(r, id\)/);
  assert.match(client, /agendaLoadPeriodoOperacional_\(r/);
  assert.match(client, /\.getAgendaEventoPorId\(id, r\.rowIndex\)/);
  assert.match(client, /function abrirAgendaEdicaoComRegistro_\(r\)/);
  assert.match(client, /function agendaMergeEditRecord_\(fresh, fallback\)/);
  assert.match(client, /agendaMergeEditRecord_\(registroAtualizado, r\)/);
  assert.match(client, /abrirAgendaEdicao.*Number\(r\.rowIndex \|\| 0\)/);
  assert.match(client, /var versaoAberta/);
  assert.match(client, /Feche e reabra a edicao antes de salvar/);
});

test('materiais anteriores usam consulta especifica, IDs estaveis e no maximo cinco visitas', () => {
  const server = agendaServer({ Logger: { log: () => {} } });
  const i = server.AGENDA_CFG.idx;
  const rows = [];
  for (let day = 1; day <= 7; day += 1) {
    const values = {
      id: `EVT-${day}`,
      data: `2026-07-0${day}`,
      hora: '08:00',
      tipo: 'Visita',
      status: 'Agendado',
      participante: 'Paciente Historico',
      idParticipante: day === 6 ? '' : 'PART-1',
      projeto: day % 2 ? 'Projeto Alpha' : 'PA',
      visita: `V${day}`,
      courier1Material: `Material ${day}`
    };
    rows.push(agendaRow(server, values));
  }
  rows.push(agendaRow(server, {
    id: 'OUTRO', data: '2026-07-08', hora: '08:00', tipo: 'Visita', status: 'Agendado',
    participante: 'Outro', idParticipante: 'PART-2', projeto: 'Projeto Alpha', courier1Material: 'Ignorar'
  }));
  const calls = [];
  server.getAgendaSheet_ = () => fakeAgendaRows(server, rows, calls);
  server.getCodexSheetDataByName_ = (name) => name === 'Participantes'
    ? [['Id', 'Nome', '', '', 'ID Participante'], ['CAD-1', 'Paciente Historico', '', '', 'PART-1']]
    : [['Id', 'Nome', 'Codigo'], ['PROJ-1', 'Projeto Alpha', 'PA']];

  const response = server.getAgendaMateriaisAnteriores({ participanteId: 'PART-1', excluirEventoId: 'EVT-7', limite: 80 });
  assert.equal(response.limit, 5);
  assert.deepEqual(Array.from(response.items, (item) => item.id), ['EVT-6', 'EVT-5', 'EVT-4', 'EVT-3', 'EVT-2']);
  assert.equal(response.items[0].idParticipante, 'PART-1');
  assert.equal(response.items[0].projetoId, 'PROJ-1');
  assert.equal(response.items[0].courier1.material, 'Material 6');
  assert.equal(calls.some((call) => call.row === 2 && call.numRows === rows.length && call.numColumns === server.AGENDA_CFG.lastCol), false);
  assert.equal(calls.some((call) => call.column === 1 && call.numColumns === server.AGENDA_CFG.col.visita), true);
  assert.equal(calls.some((call) => call.column === i.c1.material + 1 && call.numColumns === i.cb.matBio - i.c1.material + 1), true);
});

test('materiais anteriores por projeto aceitam nome e codigo sem devolver mais de cinco registros', () => {
  const server = agendaServer({ Logger: { log: () => {} } });
  const rows = [
    agendaRow(server, { id: 'NOME', data: '2026-07-01', tipo: 'Visita', projeto: 'Projeto Alpha', backupMaterial: 'A' }),
    agendaRow(server, { id: 'CODIGO', data: '2026-07-02', tipo: 'Visita', projeto: 'PA', backupMaterial: 'B' }),
    agendaRow(server, { id: 'OUTRO', data: '2026-07-03', tipo: 'Visita', projeto: 'Outro Projeto', backupMaterial: 'C' })
  ];
  server.getAgendaSheet_ = () => fakeAgendaRows(server, rows);
  server.getCodexSheetDataByName_ = (name) => name === 'Projetos'
    ? [['Id', 'Nome', 'Codigo'], ['PROJ-1', 'Projeto Alpha', 'PA'], ['PROJ-2', 'Outro Projeto', 'OP']]
    : [[]];
  const response = server.getAgendaMateriaisAnteriores({ projetoId: 'PROJ-1', limite: 5 });
  assert.deepEqual(Array.from(response.items, (item) => item.id), ['CODIGO', 'NOME']);
  assert.equal(response.items.every((item) => item.projetoId === 'PROJ-1'), true);
});

test('periodo operacional por ID preserva dias consecutivos e regra de cancelamento de SIV', () => {
  const server = agendaServer({ Logger: { log: () => {} } });
  const rows = [
    agendaRow(server, { id: 'M1', data: '2026-07-01', tipo: 'Monitoria', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'M2', data: '2026-07-02', tipo: 'Monitoria', status: 'Cancelado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'M3', data: '2026-07-03', tipo: 'Monitoria', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'M5', data: '2026-07-05', tipo: 'Monitoria', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'S1', data: '2026-08-01', tipo: 'SIV', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'S2', data: '2026-08-02', tipo: 'SIV', status: 'Cancelado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'S3', data: '2026-08-03', tipo: 'SIV', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' })
  ];
  const calls = [];
  server.getAgendaSheet_ = () => fakeAgendaRows(server, rows, calls);
  server.getCodexSheetDataByName_ = () => [['Id', 'Nome', 'Codigo'], ['PROJ-1', 'Projeto Alpha', 'PA']];

  const monitoria = server.getAgendaPeriodoOperacionalPorEventoId('M2', 3);
  assert.deepEqual(Array.from(monitoria.ids), ['M1', 'M2', 'M3']);
  assert.equal(monitoria.inicio, '2026-07-01');
  assert.equal(monitoria.fim, '2026-07-03');
  assert.equal(monitoria.projetoId, 'PROJ-1');
  const siv = server.getAgendaPeriodoOperacionalPorEventoId('S1', 6);
  assert.deepEqual(Array.from(siv.ids), ['S1']);
  assert.equal(siv.inicio, '2026-08-01');
  assert.equal(siv.fim, '2026-08-01');
  assert.equal(calls.some((call) => call.row === 2 && call.numRows === rows.length && call.numColumns === server.AGENDA_CFG.lastCol), false);
});

test('cliente preserva carga completa mas consumidores usam consultas especificas com fallback', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  assert.match(client, /\.getAgendaEventos\(5000\)/);
  assert.match(client, /\.getAgendaMateriaisAnteriores\([\s\S]*limite: 5/);
  assert.match(client, /\.slice\(-5\)\.reverse\(\)/);
  assert.doesNotMatch(client, /\.slice\(-80\)\.reverse\(\)/);
  assert.match(client, /function agendaMatBioFindPreviousEvent_\(id\)/);
  assert.match(client, /function agendaLoadPeriodoOperacional_\(r, onSuccess, onFailure\)/);
  assert.match(client, /\.getAgendaPeriodoOperacionalPorEventoId\(id, r\.rowIndex\)/);
  assert.match(client, /function abrirDisplayMonitoriaAgendaCard\(id, rowIndex\)/);
  assert.match(client, /function agendaEventoAtualEditado_\(\)/);
  assert.match(client, /return _agendaEditRecord \|\| agendaFindEventoLocal_\(_agendaEditId\)/);
});

test('consulta exige medico no cliente e no servidor', () => {
  const clientRules = readProjectFile('SharedAgendaRules.html');
  const serverRules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const client = readProjectFile('IndexAgendaScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(clientRules, /requiresDoctor: type === 'consulta'/);
  assert.equal(serverRules.formPolicy('Consulta').requiresDoctor, true);
  assert.equal(serverRules.formPolicy('Visita').requiresDoctor, false);
  assert.match(content, /id="agMedicoRequired"/);
  assert.match(content, /id="errAgMedico"/);
  assert.match(client, /if \(policy\.requiresDoctor\)/);
  assert.match(client, /validarAgendaCampo\('agMedico', 'errAgMedico'/);
  assert.match(server, /if \(policy\.requiresDoctor && !String\(dados\.medico \|\| ''\)\.trim\(\)\)/);
});
