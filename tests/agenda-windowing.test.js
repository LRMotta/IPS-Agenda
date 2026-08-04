'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
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

function validAgendaReferenceData(overrides = {}) {
  return Object.assign({
    participantes: [],
    medicos: [],
    prestadores: [],
    projetos: [],
    laboratorios: [],
    couriers: [],
    courierConfig: {},
    temperaturas: [],
    statusCourier: [],
    laboratoriosDestino: [],
    kitsColeta: [],
    tiposEvento: [],
    salasMonitoria: [],
    status: [],
    procedimentoChips: [],
    monitores: [],
    emailLabAtivo: false,
    hojeIso: '2026-08-02'
  }, overrides);
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

test('janela le primeiro somente datas e usa uma leitura contigua no caminho normal', () => {
  const server = agendaServer();
  const rows = [
    agendaRow(server, { id: 'FORA-1', data: '2026-07-10', idParticipante: 'P-0', braco: 'A' }),
    agendaRow(server, { id: 'EVT-1', data: '2026-07-14', idParticipante: 'P-1', braco: 'A' }),
    agendaRow(server, { id: 'EVT-2', data: '2026-07-16', idParticipante: 'P-2', braco: 'B' }),
    agendaRow(server, { id: 'EVT-3', data: '2026-07-18', idParticipante: 'P-3', braco: 'C' }),
    agendaRow(server, { id: 'FORA-2', data: '2026-07-25', idParticipante: 'P-4', braco: 'D' })
  ];
  const calls = [];
  server.getAgendaSheet_ = () => fakeAgendaRows(server, rows, calls);

  const result = server.getAgendaEventosPorPeriodo('2026-07-14', '2026-07-21', 5000, true);
  assert.deepEqual(Array.from(result.items, (item) => item.id), ['EVT-1', 'EVT-2', 'EVT-3']);
  assert.equal(result.outOfOrder, false);
  assert.deepEqual(calls[0], { row: 2, column: server.AGENDA_CFG.col.data, numRows: rows.length, numColumns: 1 });
  assert.deepEqual(calls.filter((call) => call.numColumns === server.AGENDA_CFG.lastCol), [
    { row: 3, column: 1, numRows: 3, numColumns: server.AGENDA_CFG.lastCol }
  ]);
});

test('janela encontra linhas fora de ordem sem ler registros alheios nem perder eventos', () => {
  const server = agendaServer();
  const rows = [
    agendaRow(server, { id: 'EVT-1', data: '2026-07-14', idParticipante: 'P-1', braco: 'A' }),
    agendaRow(server, { id: 'FORA-1', data: '2026-08-14', idParticipante: 'P-X', braco: 'X' }),
    agendaRow(server, { id: 'EVT-2', data: '2026-07-16', idParticipante: 'P-2', braco: 'B' }),
    agendaRow(server, { id: 'FORA-2', data: '2026-06-10', idParticipante: 'P-Y', braco: 'Y' }),
    agendaRow(server, { id: 'EVT-3', data: '2026-07-18', idParticipante: 'P-3', braco: 'C' })
  ];
  const calls = [];
  server.getAgendaSheet_ = () => fakeAgendaRows(server, rows, calls);

  const result = server.getAgendaEventosPorPeriodo('2026-07-14', '2026-07-21', 5000, true);
  assert.deepEqual(Array.from(result.items, (item) => item.id), ['EVT-1', 'EVT-2', 'EVT-3']);
  assert.equal(result.outOfOrder, true);
  assert.deepEqual(calls.filter((call) => call.numColumns === server.AGENDA_CFG.lastCol).map((call) => call.row), [2, 4, 6]);
});

test('janela aceita mais de 200 eventos e mantem teto equivalente ao caminho legado', () => {
  const server = agendaServer();
  const rows = Array.from({ length: 205 }, (_, index) => agendaRow(server, {
    id: `EVT-${index + 1}`,
    data: '2026-07-15',
    idParticipante: `P-${index + 1}`,
    braco: 'A'
  }));
  server.getAgendaSheet_ = () => fakeAgendaRows(server, rows);
  const result = server.getAgendaEventosPorPeriodo('2026-07-14', '2026-07-21', 5000, true);
  assert.equal(server.AGENDA_WINDOW_MAX_RECORDS_, 5000);
  assert.equal(result.items.length, 205);
  assert.equal(result.total, 205);
  assert.equal(result.truncated, false);
});

test('bootstrap negado interrompe antes de datas, referencias e planilhas', () => {
  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  server.codexGetCurrentUserAccess = () => ({ ok: false, message: 'Acesso negado.' });
  server.agendaGetReferenceData_ = () => { throw new Error('nao deve ler referencias'); };
  server.getAgendaSheet_ = () => { throw new Error('nao deve ler agenda'); };

  const result = server.getAgendaBootstrap('data-invalida', 'tambem-invalida', true);
  assert.equal(result.access.ok, false);
  assert.equal(result.referenceData, null);
  assert.deepEqual(Array.from(result.events), []);
  assert.equal(result.range, null);
  const stages = logs.map((message) => JSON.parse(message.replace(/^\[CODEX_PERF\]\s*/, '')).stage);
  assert.deepEqual(stages, ['access', 'total']);
});

test('bootstrap retorna referencias completas e janela atomica', () => {
  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  const referenceData = validAgendaReferenceData({ participantes: ['Pessoa sigilosa'] });
  let forced = null;
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.agendaGetReferenceData_ = (forceRefresh) => {
    forced = forceRefresh;
    return referenceData;
  };
  server.getAgendaSheet_ = () => fakeAgenda(server, [
    { id: 'EVT-SIGILOSO', data: '2026-07-15', participante: 'Pessoa sigilosa' }
  ]);
  const result = server.getAgendaBootstrap('2026-07-14', '2026-07-21', true);

  assert.equal(forced, true);
  assert.equal(result.referenceData, referenceData);
  assert.equal(result.events.length, 1);
  assert.deepEqual(Object.assign({}, result.range), {
    start: '2026-07-14',
    endExclusive: '2026-07-21',
    loadedStart: '2026-07-14',
    loadedEndExclusive: '2026-07-21',
    total: 1,
    loaded: 1,
    outOfOrder: false
  });
  assert.match(result.revision, /^agenda-bootstrap-v1-[0-9a-f]{8}$/);
  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
  assert.equal(server.CODEX_CACHE_BYPASS_READS_, false);
  const entries = logs.map((message) => JSON.parse(message.replace(/^\[CODEX_PERF\]\s*/, '')));
  assert.deepEqual(entries.map((entry) => entry.stage), ['access', 'reference', 'date_scan', 'row_read', 'hydrate', 'revision', 'total']);
  assert.equal(logs.some((message) => /2026-07|EVT-SIGILOSO|Pessoa sigilosa/.test(message)), false);
  assert.match(readProjectFile('IndexAgendaScripts.html'), /\.getAgendaBootstrap\(requestedRange\.start, requestedRange\.endExclusive, forcar === true\)/);
});

test('feature de janela nasce desligada e somente e anunciada a administradores do canario', () => {
  const property = { value: null };
  const server = agendaServer({
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => property.value })
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://example.invalid/exec' }) }
  });
  let formReads = 0;
  server.codexGetUserOAuthStatus_ = () => ({});
  server.codexGetAppVersion_ = () => ({});
  server.getDadosFormularioAgenda = () => { formReads += 1; return { legado: true }; };
  server.codexGetTeamBirthdays_ = () => [];

  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  const defaultAdmin = server.getAppBootstrapData();
  assert.equal(server.AGENDA_WINDOWED_LOADING_V2, false);
  assert.equal(defaultAdmin.features, undefined);
  assert.deepEqual(Object.assign({}, defaultAdmin.agendaFormData), { legado: true });

  property.value = 'true';
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'readonly' });
  const nonAdmin = server.getAppBootstrapData();
  assert.equal(nonAdmin.features, undefined);
  assert.deepEqual(Object.assign({}, nonAdmin.agendaFormData), { legado: true });

  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  const canary = server.getAppBootstrapData();
  assert.deepEqual(Object.assign({}, canary.features), { agendaWindowedLoadingV2: true });
  assert.equal(canary.agendaFormData, null);
  assert.equal(formReads, 2);
});

test('cliente mantem caminho legado fora do canario e integra bootstrap apenas sob a feature', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const load = functionBody(client, 'carregarAgendaEventos');
  const init = functionBody(client, 'initAgendaV1');
  assert.match(load, /!options\.forceLegacyFull && agendaWindowedLoadingAtivo_\(\)/);
  assert.match(load, /carregarAgendaEventosPorJanela_\(forcar, callback, options\)/);
  assert.match(load, /\.getAgendaEventos\(5000\)/);
  assert.match(init, /if \(agendaWindowedLoadingAtivo_\(\)\) return/);
  assert.match(init, /agendaCarregarFormDataLegado_\(\)/);
});

test('janela cliente cobre tres semanas, valida resposta atomica e rejeita truncamento', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const context = vm.createContext({
    Date,
    _agendaWeekOffset: 0,
    _agendaWindowedRange: null,
    agendaIso: (date) => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-')
  });
  ['agendaReferenceDataValidation_', 'agendaWeekStartForOffset_', 'agendaWindowForWeekOffset_', 'agendaWindowContainsWeekOffset_',
    'agendaBootstrapReferenceDataValido_', 'agendaBootstrapWindowValido_'].forEach((name) => {
    vm.runInContext(`function ${name}(${name === 'agendaReferenceDataValidation_' || name === 'agendaBootstrapReferenceDataValido_' ? 'data' : name === 'agendaWeekStartForOffset_' || name === 'agendaWindowForWeekOffset_' || name === 'agendaWindowContainsWeekOffset_' ? 'weekOffset' : 'response, requestedRange'}) {${functionBody(client, name)}}`, context);
  });

  const range = context.agendaWindowForWeekOffset_(0);
  const start = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.endExclusive}T12:00:00`);
  assert.equal((end - start) / 86400000, 21);
  context._agendaWindowedRange = range;
  assert.equal(context.agendaWindowContainsWeekOffset_(-1), true);
  assert.equal(context.agendaWindowContainsWeekOffset_(0), true);
  assert.equal(context.agendaWindowContainsWeekOffset_(1), true);
  assert.equal(context.agendaWindowContainsWeekOffset_(2), false);

  const response = {
    access: { ok: true },
    referenceData: validAgendaReferenceData(),
    events: [],
    range: {
      start: range.start,
      endExclusive: range.endExclusive,
      loadedStart: range.start,
      loadedEndExclusive: range.endExclusive,
      total: 0,
      loaded: 0
    },
    revision: 'agenda-bootstrap-v1-12345678',
    truncated: false,
    complete: true,
    partialError: false
  };
  assert.equal(context.agendaBootstrapWindowValido_(response, range), true);
  response.truncated = true;
  response.complete = false;
  assert.equal(context.agendaBootstrapWindowValido_(response, range), false);
});

test('cliente preserva janela anterior, descarta respostas tardias e faz fallback completo na sessao', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const windowLoad = functionBody(client, 'carregarAgendaEventosPorJanela_');
  const fallback = functionBody(client, 'agendaFallbackCargaCompleta_');
  const navigation = functionBody(client, 'agendaNavigateToWeekOffset_');
  assert.match(windowLoad, /var requestId = \+\+_agendaEventosRequestId/);
  assert.match(windowLoad, /if \(requestId !== _agendaEventosRequestId\) \{[\s\S]*options\.onComplete/);
  assert.match(windowLoad, /agendaBootstrapWindowValido_\(response, requestedRange\)/);
  assert.match(windowLoad, /agendaFallbackCargaCompleta_\(callback, options, agendaBootstrapFallbackCode_/);
  assert.match(windowLoad, /agendaFallbackCargaCompleta_\(callback, options, 'rpc_failure'\)/);
  assert.match(fallback, /_agendaWindowedLoadingDisabledForSession = true/);
  assert.match(fallback, /forceLegacyFull: true/);
  assert.match(fallback, /silent: _agendaEventos\.length > 0/);
  assert.match(navigation, /agendaWindowContainsWeekOffset_\(targetWeekOffset\)/);
  assert.match(navigation, /carregarAgendaEventosPorJanela_\(false, applyNavigation/);
  assert.doesNotMatch(windowLoad, /_agendaEventos\s*=.*before.*agendaBootstrapWindowValido_/s);
});

test('falha do bootstrap e relancada e restaura o bypass de cache da execucao', () => {
  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  const failure = new Error('falha contendo dado sensivel');
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.agendaGetReferenceData_ = () => { throw failure; };

  assert.throws(
    () => server.getAgendaBootstrap('2026-07-14', '2026-07-21', true),
    (error) => error === failure
  );
  assert.equal(server.CODEX_CACHE_BYPASS_READS_, false);
  const entries = logs.map((message) => JSON.parse(message.replace(/^\[CODEX_PERF\]\s*/, '')));
  assert.deepEqual(entries.map((entry) => [entry.stage, entry.success]), [
    ['access', true],
    ['reference', false],
    ['total', false]
  ]);
  assert.equal(logs.some((message) => message.includes('dado sensivel')), false);
});

test('barreira do formulario valida todos os datasets antes de alterar selects', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const context = vm.createContext({ Object, Array });
  vm.runInContext(`function agendaReferenceDataValidation_(data) {${functionBody(client, 'agendaReferenceDataValidation_')}}`, context);

  assert.equal(context.agendaReferenceDataValidation_(validAgendaReferenceData()).ok, true);
  const missing = validAgendaReferenceData();
  delete missing.projetos;
  assert.deepEqual(Object.assign({}, context.agendaReferenceDataValidation_(missing)), {
    ok: false,
    code: 'reference_incomplete'
  });
  assert.equal(context.agendaReferenceDataValidation_(validAgendaReferenceData({ couriers: null })).code, 'invalid_payload');

  const apply = functionBody(client, 'applyAgendaFormData');
  const update = functionBody(client, 'atualizarAgendaFormDataOpcoes');
  assert.ok(apply.indexOf('agendaReferenceDataValidation_(d)') < apply.indexOf('agendaCurrentValues'));
  assert.ok(apply.indexOf('if (!validation.ok) return false') < apply.indexOf('setAgendaFormDataState'));
  assert.ok(apply.indexOf('_agendaReferenceDataConfirmed = false') < apply.indexOf('agendaFormDataAplicacaoBloqueadaPorEdicao'));
  assert.ok(apply.lastIndexOf('_agendaReferenceDataConfirmed = true') > apply.indexOf("preencherAgendaSelect('agParticipante'"));
  assert.ok(update.indexOf('if (!validation.ok) return false') < update.indexOf('setAgendaFormDataState'));
  assert.ok(update.lastIndexOf('_agendaReferenceDataConfirmed = true') > update.indexOf("preencherAgendaSelect('agParticipante'"));
});

test('barreira mantem o formulario fechado e libera somente a ultima abertura solicitada', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const calls = [];
  const context = vm.createContext({
    Object,
    Array,
    _agendaReferenceDataConfirmed: false,
    _agendaDados: null,
    _agendaFormReadyQueue: [],
    agendaMostrarFormularioBloqueado_: () => calls.push('blocked'),
    agendaFallbackCargaCompleta_: () => calls.push('fallback')
  });
  ['agendaReferenceDataValidation_', 'agendaFormularioEstaPronto_', 'agendaComFormularioPronto_', 'agendaLiberarFilaFormulario_']
    .forEach((name) => {
      const args = name === 'agendaReferenceDataValidation_' ? 'data' : name === 'agendaComFormularioPronto_' ? 'callback' : '';
      vm.runInContext(`function ${name}(${args}) {${functionBody(client, name)}}`, context);
    });
  context.agendaComFormularioPronto_(() => calls.push('first'));
  context.agendaComFormularioPronto_(() => calls.push('second'));
  assert.deepEqual(calls, ['blocked', 'fallback', 'blocked', 'fallback']);
  context._agendaDados = validAgendaReferenceData();
  context._agendaReferenceDataConfirmed = true;
  context.agendaLiberarFilaFormulario_();
  assert.deepEqual(calls, ['blocked', 'fallback', 'blocked', 'fallback', 'second']);
});

test('criacao, edicao, link direto e outros modulos passam pela prontidao central', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const pending = readProjectFile('IndexPendenciasScripts.html');
  const transport = readProjectFile('TransporteApp.html');
  assert.match(functionBody(client, 'toggleAgendaCreate'), /agendaComFormularioPronto_\(function\(\)/);
  assert.match(functionBody(client, 'abrirAgendaCreatePanelNovo'), /agendaComFormularioPronto_\(agendaAbrirCreatePanelNovoPronto_\)/);
  assert.match(functionBody(client, 'abrirAgendaEdicao'), /agendaComFormularioPronto_\(function\(\)/);
  assert.match(functionBody(client, 'abrirAgendaEdicaoComRegistro_'), /agendaComFormularioPronto_\(function\(\)/);
  assert.match(functionBody(client, 'agendaAbrirPendenteAposCarga'), /abrirAgendaEdicao\(id\)/);
  assert.match(pending, /abrirAgendaEdicao\(agendaId\)/);
  assert.match(transport, /openerWin\.abrirAgendaRegistroPorId\(agendaId\)/);
});

test('fallback do formulario usa carga completa, legado validado e somente codigos permitidos', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const fallback = functionBody(client, 'agendaFallbackCargaCompleta_');
  const legacy = functionBody(client, 'agendaCarregarFormDataLegado_');
  assert.match(fallback, /forceLegacyFull: true/);
  assert.match(fallback, /agendaCarregarFormDataLegado_\(\{ fallbackAttempt: true \}\)/);
  assert.match(legacy, /agendaReferenceDataValidation_\(d\)/);
  assert.match(legacy, /validation\.ok && applyAgendaFormData\(d\)/);
  assert.match(legacy, /if \(!options\.fallbackAttempt\) agendaFallbackCargaCompleta_/);
  assert.match(legacy, /\.getDadosFormularioAgenda\(true\)/);

  const strictCalls = [];
  const strictServer = agendaServer({
    Utilities: { formatDate: () => '20260804' },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  strictServer.agendaGetDadosFormularioAgendaCached_ = (key, forceRefresh, strict) => {
    strictCalls.push({ key, forceRefresh, strict });
    return {};
  };
  strictServer.getDadosFormularioAgenda();
  strictServer.getDadosFormularioAgenda(true);
  assert.deepEqual(strictCalls, [
    { key: 'AgendaFormData:v7:20260804', forceRefresh: false, strict: false },
    { key: 'AgendaFormDataStrict:v1:20260804', forceRefresh: false, strict: true }
  ]);
  assert.match(functionBody(readProjectFile('WebApp.gs'), 'getAppBootstrapData'), /getDadosFormularioAgenda\(true\)/);

  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  assert.equal(server.agendaWindowFallbackLog('truncated'), true);
  assert.equal(server.agendaWindowFallbackLog('segredo-nao-permitido'), true);
  assert.deepEqual(logs.map((message) => JSON.parse(message.replace(/^\[CODEX_AGENDA_FALLBACK\]\s*/, '')).code), [
    'truncated',
    'invalid_payload'
  ]);
  assert.equal(logs.some((message) => message.includes('segredo-nao-permitido')), false);
});

test('validacao distingue listas vazias validas de datasets ausentes ou com falha', () => {
  const server = agendaServer();
  const valid = validAgendaReferenceData();
  assert.equal(server.agendaValidateReferenceData_(valid), valid);
  const missing = validAgendaReferenceData();
  delete missing.participantes;
  assert.throws(() => server.agendaValidateReferenceData_(missing), /participantes/);
  assert.throws(() => server.agendaValidateReferenceData_(validAgendaReferenceData({ monitores: null })), /monitores/);
  assert.throws(() => server.agendaValidateReferenceData_(validAgendaReferenceData({ courierConfig: [] })), /courierConfig/);
});

test('referencias do bootstrap preservam campos, aliases e ordem do formulario atual', () => {
  const server = agendaServer({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  server.getSheetByPossibleNames_ = () => ({ getLastRow: () => 1 });
  server.getProjetoOptions_ = () => [];
  server.getAgendaLaboratorios_ = () => [];
  server.getAgendaCouriers_ = () => [];
  server.getAgendaCourierConfigs_ = () => ({});
  server.getAgendaTemperaturas_ = () => [];
  server.getAgendaCourierStatuses_ = () => [];
  server.getAgendaLabDestinos_ = () => [];
  server.getAgendaKitsEstoque_ = () => [];
  server.getAgendaEventTypes_ = () => [];
  server.getAgendaMonitoriaSalas_ = () => [];
  server.getAgendaStatuses_ = () => [];
  server.getAgendaProcedimentoChips_ = () => [];
  server.getMonitores = () => [];
  server.agendaEmailEnabled_ = () => false;

  const result = server.agendaBuildDadosFormularioAgenda_(true);
  assert.deepEqual(Object.keys(result), [
    'participantes', 'medicos', 'prestadores', 'projetos', 'laboratorios', 'couriers',
    'courierConfig', 'temperaturas', 'statusCourier', 'laboratoriosDestino', 'kitsColeta',
    'tiposEvento', 'salasMonitoria', 'status', 'procedimentoChips', 'monitores',
    'emailLabAtivo', 'hojeIso'
  ]);
  assert.match(functionBody(readProjectFile('WebApp.gs'), 'getDadosFormularioAgenda'), /agendaGetDadosFormularioAgendaCached_\(cacheKey, false, false\)/);
  server.getSheetByPossibleNames_ = () => null;
  assert.throws(() => server.agendaBuildDadosFormularioAgenda_(true), /Dataset obrigatorio/);
});

test('bootstrap torna truncamento impeditivo e nao declara intervalo incompleto como carregado', () => {
  const server = agendaServer();
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.agendaGetReferenceData_ = () => validAgendaReferenceData();
  server.agendaGetEventosPorPeriodo_ = () => ({
    items: [{ id: 'EVT-1', rowIndex: 2, recordVersion: 'R1', editRecordVersion: 'E1' }],
    total: 5001,
    truncated: true,
    outOfOrder: false
  });

  const result = server.getAgendaBootstrap('2026-07-14', '2026-07-21', false);
  assert.equal(result.truncated, true);
  assert.equal(result.complete, false);
  assert.equal(result.range.loadedStart, '');
  assert.equal(result.range.loadedEndExclusive, '');
  assert.equal(result.range.total, 5001);
  assert.equal(result.range.loaded, 1);
});

test('forceRefresh ignora o cache proprio sem remove-lo globalmente', () => {
  const server = agendaServer();
  let reads = 0;
  let writes = 0;
  server.codexCacheGet_ = () => {
    reads += 1;
    return { origem: 'cache' };
  };
  server.codexCachePut_ = () => { writes += 1; };
  server.agendaBuildDadosFormularioAgenda_ = () => ({ origem: 'planilha' });

  assert.equal(server.agendaGetDadosFormularioAgendaCached_('chave', false, false).origem, 'cache');
  assert.equal(server.agendaGetDadosFormularioAgendaCached_('chave', true, true).origem, 'planilha');
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.doesNotMatch(functionBody(readProjectFile('WebApp.gs'), 'agendaGetDadosFormularioAgendaCached_'), /codexCacheRemove_|remove\(/);
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

test('projeto do participante sincroniza o autocomplete por nome, codigo ou ID estavel', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const body = functionBody(client, 'setAgendaSelectValue');
  const option = {
    value: 'Projeto Alpha',
    text: 'Projeto Alpha — PA',
    getAttribute: (name) => ({ 'data-codigo': 'PA', 'data-id': 'PROJ-1' })[name] || ''
  };
  const select = {
    options: [option],
    value: '',
    insertAdjacentHTML: () => { throw new Error('nao deve criar alias avulso'); }
  };
  const syncCalls = [];
  const context = vm.createContext({
    document: { getElementById: () => select },
    normAgenda: (value) => String(value || '').trim().toLowerCase(),
    esc: (value) => String(value || ''),
    sincronizarAutocompleteProjeto: (id) => syncCalls.push(id)
  });
  vm.runInContext(`function setAgendaSelectValue(id, value) {${body}}`, context);

  context.setAgendaSelectValue('agProjeto', 'PA');
  assert.equal(select.value, 'Projeto Alpha');
  context.setAgendaSelectValue('agProjeto', 'PROJ-1');
  assert.equal(select.value, 'Projeto Alpha');
  assert.deepEqual(syncCalls, ['agProjeto', 'agProjeto']);
  assert.match(functionBody(client, 'preencherAgendaSelect'), /data-codigo/);
  assert.match(functionBody(client, 'preencherAgendaSelect'), /data-id/);
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
  const readyOpen = functionBody(client, 'agendaAbrirEdicaoPronta_');
  assert.match(client, /function abrirAgendaEdicao\(id, rowIndex\)/);
  assert.match(open, /agendaComFormularioPronto_/);
  assert.match(readyOpen, /agendaFindEventoLocal_\(id, rowIndex\)/);
  assert.match(readyOpen, /agendaFetchEventoPorId_\(id, rowIndex/);
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
  server.getCodexSheetDataByName_ = (name) => name === 'Projetos'
    ? [['Id', 'Nome', 'Codigo'], ['PROJ-1', 'Projeto Alpha', 'PA']]
    : [[]];

  const response = server.getAgendaMateriaisAnteriores({ participanteId: 'PART-1', excluirEventoId: 'EVT-7', limite: 80 });
  assert.equal(response.limit, 5);
  assert.deepEqual(Array.from(response.items, (item) => item.id), ['EVT-5', 'EVT-4', 'EVT-3', 'EVT-2', 'EVT-1']);
  assert.equal(response.items[0].idParticipante, 'PART-1');
  assert.equal(response.items[0].projetoId, 'PROJ-1');
  assert.equal(response.items[0].courier1.material, 'Material 5');
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
