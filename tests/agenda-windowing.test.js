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

test('versao editavel usa valores semanticos e ignora representacoes auxiliares equivalentes', () => {
  const server = agendaServer();
  const before = agendaRow(server, {
    id: 'EVT-SEMANTICO',
    status: 'Realizado',
    poloTrial: '2026-08-13T10:00:00',
    courier1Material: 'Soro',
    courier1Json: '{"volume":2,"unidade":"mL"}'
  });
  const after = agendaRow(server, {
    id: 'EVT-SEMANTICO',
    status: 'Realizado',
    poloTrial: '2026-08-13T10:01:00',
    courier1Material: 'Soro',
    courier1Json: '{"unidade":"mL","volume":2}'
  });

  assert.notEqual(server.agendaRecordVersionFromRow_(before), server.agendaRecordVersionFromRow_(after));
  assert.equal(server.agendaEditableRecordVersionFromRow_(before), server.agendaEditableRecordVersionFromRow_(after));
});

test('versao editavel continua detectando alteracao real no formulario', () => {
  const server = agendaServer();
  const before = agendaRow(server, { id: 'EVT-REAL', status: 'Enviado' });
  const after = agendaRow(server, { id: 'EVT-REAL', status: 'Entregue' });

  assert.notEqual(server.agendaEditableRecordVersionFromRow_(before), server.agendaEditableRecordVersionFromRow_(after));
});

test('salvamento envia a linha aberta e o servidor revalida ID e rowIndex', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  const save = functionBody(client, 'salvarAgendaEvento');
  const update = functionBody(server, 'atualizarAgendaEventoCompleto');

  assert.match(save, /payload\._rowIndex\s*=\s*Number\(eventoEditado\s*&&\s*eventoEditado\.rowIndex/);
  assert.match(update, /agendaLocalizarLinhaPorId_\(agenda,\s*String\(dados\.id[^,]+,\s*dados\._rowIndex\)/);
});

test('monitores externos consultam Gmail e DHL antes de adquirir o bloqueio de escrita', () => {
  const source = readProjectFile('WebApp.gs');
  const dhl = functionBody(source, 'monitorarEntregasDhlAgendadas_');
  const courier = functionBody(source, 'monitorarConfirmacoesCourierAgendadas_');

  assert.ok(dhl.indexOf('consultarEntregaDhl_') < dhl.indexOf("codexWithDocumentLock_('monitorarEntregasDhlAgendadas'"));
  assert.ok(courier.indexOf('buscarConfirmacoesCourierNoGmail_') < courier.indexOf("codexWithDocumentLock_('monitorarConfirmacoesCourierAgendadas'"));
  assert.match(dhl, /agendaLocalizarLinhaPorId_\(agendaAtual/);
  assert.match(courier, /agendaLocalizarLinhaPorId_\(agendaAtual/);
});

function validAgendaReferenceData(overrides = {}) {
  return Object.assign({
    participantes: [],
    medicos: [],
    prestadores: [],
    projetos: [],
    laboratorios: [],
    couriers: [],
    courierConfig: {},
    projectCourierMap: {},
    feriados: [],
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

test('consultas da Agenda usam getter sem migracoes ou escritas na planilha', () => {
  const server = readProjectFile('WebApp.gs');
  const readGetter = functionBody(server, 'getAgendaSheetForRead_');
  const writeGetter = functionBody(server, 'getAgendaSheet_');
  const readFunctions = [
    'getAgendaEventos',
    'agendaGetEventosPorPeriodo_',
    'pesquisarAgendaHistorico',
    'getAgendaMateriaisAnteriores',
    'getAgendaPeriodoOperacionalPorEventoId',
    'getAgendaEventoPorId',
    'getDashboardPendencias_',
    'getAgendaDashboardResumo_',
    'getUltimasVisitasParticipantesAgendaMap_'
  ];

  assert.match(readGetter, /agendaResolveBackupTemperaturaColumnForRead_\(sh\)/);
  assert.doesNotMatch(readGetter, /ensureAgendaDestinoLabColumns_|alinharStatusRequisicaoLegadoAgenda_|setValue|insertColumns/);
  assert.match(writeGetter, /ensureAgendaDestinoLabColumns_\(sh\)/);
  assert.match(writeGetter, /alinharStatusRequisicaoLegadoAgenda_\(sh\)/);
  readFunctions.forEach((name) => {
    assert.match(functionBody(server, name), /getAgendaSheetForRead_\(\)/, `${name} deve usar leitura sem efeitos externos`);
  });
});

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
  server.getAgendaSheetForRead_ = () => fakeAgenda(server, [
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
  server.getAgendaSheetForRead_ = () => fakeAgendaRows(server, rows, calls);

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
  server.getAgendaSheetForRead_ = () => fakeAgendaRows(server, rows, calls);

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
  server.getAgendaSheetForRead_ = () => fakeAgendaRows(server, rows);
  const result = server.getAgendaEventosPorPeriodo('2026-07-14', '2026-07-21', 5000, true);
  assert.equal(server.AGENDA_WINDOW_MAX_RECORDS_, 5000);
  assert.equal(result.items.length, 205);
  assert.equal(result.total, 205);
  assert.equal(result.truncated, false);
});

test('comparacao administrativa confirma IDs e campos sem expor o payload', () => {
  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  const rows = [
    agendaRow(server, { id: 'EVT-SIGILOSO-1', data: '2026-07-15', participante: 'Pessoa sigilosa', idParticipante: 'P-1', braco: 'A' }),
    agendaRow(server, { id: 'EVT-SIGILOSO-2', data: '2026-08-15', participante: 'Outra pessoa', idParticipante: 'P-2', braco: 'B' })
  ];
  let authorized = 0;
  server.codexAssertAdmin_ = () => { authorized += 1; return { ok: true, role: 'admin' }; };
  server.getAgendaSheetForRead_ = () => fakeAgendaRows(server, rows);
  server.getCodexSheetDataByName_ = () => [[]];

  const result = server.compararAgendaWindowComCargaCompleta('2026-07-14', '2026-07-21');

  assert.equal(authorized, 1);
  assert.equal(result.ok, true);
  assert.equal(result.windowCount, 1);
  assert.equal(result.fullFilteredCount, 1);
  assert.equal(result.idsEqual, true);
  assert.equal(result.criticalFieldsEqual, true);
  assert.equal(result.windowTruncated, false);
  assert.equal(result.legacyTruncated, false);
  assert.equal(typeof result.durationMs.window, 'number');
  const serialized = JSON.stringify({ result, logs });
  assert.doesNotMatch(serialized, /2026-07|EVT-SIGILOSO|Pessoa sigilosa|Outra pessoa|P-1/);
});

test('comparacao administrativa detecta evento ou campo divergente e preserva falhas', () => {
  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  server.codexAssertAdmin_ = () => ({ ok: true, role: 'admin' });
  server.agendaGetEventosPorPeriodo_ = () => ({
    items: [{ id: 'MESMO-ID', status: 'Cancelado' }, { id: 'EXTRA', status: 'Agendado' }],
    total: 2,
    truncated: false,
    outOfOrder: false
  });
  server.getAgendaEventos = () => [{ id: 'MESMO-ID', dataIso: '2026-07-15', status: 'Agendado' }];
  server.getAgendaSheetForRead_ = () => ({ getLastRow: () => 2 });

  const result = server.compararAgendaWindowComCargaCompleta('2026-07-14', '2026-07-21');
  assert.equal(result.ok, false);
  assert.equal(result.idsEqual, false);
  assert.equal(result.criticalFieldsEqual, false);
  assert.equal(result.extraCount, 1);
  assert.equal(result.criticalMismatchCount, 1);

  server.agendaGetEventosPorPeriodo_ = () => { throw new Error('falha original'); };
  assert.throws(
    () => server.compararAgendaWindowComCargaCompleta('2026-07-14', '2026-07-21'),
    /falha original/
  );
  assert.match(logs.at(-1), /"success":false/);
  assert.doesNotMatch(logs.at(-1), /falha original|2026-07/);
});

test('comparacao administrativa atual usa exatamente tres semanas sem parametros', () => {
  const server = agendaServer({
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: {
      formatDate: (date) => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-')
    }
  });
  let authorized = 0;
  let received = null;
  server.codexAssertAdmin_ = () => { authorized += 1; return { ok: true, role: 'admin' }; };
  server.compararAgendaWindowComCargaCompleta = (inicio, fim) => {
    received = { inicio, fim };
    return { ok: true };
  };

  const result = server.compararAgendaWindowAtual();
  const inicio = new Date(`${received.inicio}T00:00:00`);
  const fim = new Date(`${received.fim}T00:00:00`);
  assert.equal(result.ok, true);
  assert.equal(authorized, 1);
  assert.equal(inicio.getDay(), 1);
  assert.equal((fim.getTime() - inicio.getTime()) / 86400000, 21);
  assert.ok(Date.now() >= inicio.getTime());
  assert.ok(Date.now() < fim.getTime());
});

test('bootstrap negado interrompe antes de datas, referencias e planilhas', () => {
  const logs = [];
  const server = agendaServer({ Logger: { log: (message) => logs.push(message) } });
  server.codexGetCurrentUserAccess = () => ({ ok: false, message: 'Acesso negado.' });
  server.agendaGetReferenceData_ = () => { throw new Error('nao deve ler referencias'); };
  server.getAgendaSheetForRead_ = () => { throw new Error('nao deve ler agenda'); };

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
  server.getAgendaSheetForRead_ = () => fakeAgenda(server, [
    { id: 'EVT-SIGILOSO', data: '2026-07-15', participante: 'Pessoa sigilosa' }
  ]);
  const result = server.getAgendaBootstrap('2026-07-14', '2026-07-21', true);

  assert.equal(forced, true);
  assert.equal(typeof result, 'object');
  assert.equal(typeof result.access, 'object');
  assert.equal(result.access.ok, true);
  assert.equal(result.referenceData, referenceData);
  assert.equal(typeof result.referenceData, 'object');
  Object.keys(validAgendaReferenceData()).forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(result.referenceData, key), true, `referenceData.${key}`);
  });
  assert.equal(Array.isArray(result.events), true);
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
  assert.equal(typeof result.revision, 'string');
  assert.equal(typeof result.complete, 'boolean');
  assert.equal(typeof result.truncated, 'boolean');
  assert.equal(typeof result.partialError, 'boolean');
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

test('kill switch do canario altera somente a flag global e exige administrador', () => {
  const property = { value: null, writes: [] };
  const logs = [];
  const server = agendaServer({
    Logger: { log: (message) => logs.push(message) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => property.value,
        setProperty: (key, value) => {
          property.value = value;
          property.writes.push({ key, value });
        }
      })
    }
  });
  let authorized = 0;
  server.codexAssertAdmin_ = () => { authorized += 1; return { ok: true, role: 'admin' }; };

  assert.deepEqual(Object.assign({}, server.ativarAgendaWindowedLoadingV2Admin()), { globalEnabled: true, adminOnly: true });
  assert.equal(server.agendaWindowedLoadingV2GlobalEnabled_(), true);
  assert.deepEqual(Object.assign({}, server.desativarAgendaWindowedLoadingV2Admin()), { globalEnabled: false, adminOnly: true });
  assert.equal(server.agendaWindowedLoadingV2GlobalEnabled_(), false);
  assert.equal(authorized, 2);
  assert.deepEqual(property.writes, [
    { key: 'AGENDA_WINDOWED_LOADING_V2', value: 'true' },
    { key: 'AGENDA_WINDOWED_LOADING_V2', value: 'false' }
  ]);
  assert.equal(logs.every((entry) => /\[CODEX_AGENDA_CANARY\]/.test(entry)), true);
  assert.equal(logs.some((entry) => /@|nome|userEmail|participant/i.test(entry)), false);
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
    _agendaEventosScope: 'full',
    _agendaEventosRange: null,
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
  context._agendaEventosScope = 'window';
  context._agendaEventosRange = { inicio: range.start, fim: range.endExclusive };
  assert.equal(context.agendaWindowContainsWeekOffset_(-1), true);
  assert.equal(context.agendaWindowContainsWeekOffset_(0), true);
  assert.equal(context.agendaWindowContainsWeekOffset_(1), true);
  assert.equal(context.agendaWindowContainsWeekOffset_(2), false);

  [-520, -52, 52, 520].forEach((offset) => {
    const arbitrary = context.agendaWindowForWeekOffset_(offset);
    const arbitraryStart = new Date(`${arbitrary.start}T12:00:00`);
    const arbitraryEnd = new Date(`${arbitrary.endExclusive}T12:00:00`);
    assert.equal((arbitraryEnd - arbitraryStart) / 86400000, 21);
  });

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

test('cache de janelas vive somente em memoria, clona eventos e mantem as tres mais recentes', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const context = vm.createContext({
    JSON,
    Object,
    _agendaWindowMemoryCache: {},
    _agendaWindowMemoryCacheOrder: [],
    AGENDA_WINDOW_MEMORY_CACHE_LIMIT: 3,
    agendaBootstrapWindowValido_: (response, range) => !!response && response.complete === true &&
      response.truncated === false && response.range.start === range.start &&
      response.range.endExclusive === range.endExclusive
  });
  [
    'agendaWindowMemoryCacheKey_', 'agendaWindowMemoryCacheCloneResponse_',
    'agendaWindowMemoryCacheRemoveKey_', 'agendaWindowMemoryCachePut_',
    'agendaWindowMemoryCacheGet_', 'agendaWindowMemoryCacheClear_',
    'agendaWindowMemoryCacheUpdateReferenceData_'
  ].forEach((name) => {
    const arg = name === 'agendaWindowMemoryCacheKey_' ? 'range' :
      name === 'agendaWindowMemoryCacheGet_' ? 'requestedRange' :
      name === 'agendaWindowMemoryCacheCloneResponse_' ? 'response' :
      name === 'agendaWindowMemoryCacheRemoveKey_' ? 'key' :
      name === 'agendaWindowMemoryCacheUpdateReferenceData_' ? 'referenceData' :
      name === 'agendaWindowMemoryCachePut_' ? 'response, requestedRange' : '';
    vm.runInContext(`function ${name}(${arg}) {${functionBody(client, name)}}`, context);
  });
  const range = (start, end) => ({ start, endExclusive: end });
  const response = (start, end, id) => ({
    access: { ok: true },
    referenceData: validAgendaReferenceData(),
    events: [{ id, status: 'Agendado', courier1: { awb: '' } }],
    range: { start, endExclusive: end, loadedStart: start, loadedEndExclusive: end, total: 1, loaded: 1 },
    revision: `rev-${id}`,
    truncated: false,
    complete: true,
    partialError: false
  });
  const aRange = range('2026-07-27', '2026-08-17');
  const a = response(aRange.start, aRange.endExclusive, 'A');
  assert.equal(context.agendaWindowMemoryCachePut_(a, aRange), true);
  a.events[0].status = 'ALTERADO-FORA';
  const firstRead = context.agendaWindowMemoryCacheGet_(aRange);
  assert.equal(firstRead.events[0].status, 'Agendado');
  firstRead.events[0].courier1.awb = 'ALTERADO-LOCAL';
  assert.equal(context.agendaWindowMemoryCacheGet_(aRange).events[0].courier1.awb, '');

  [
    ['2026-08-10', '2026-08-31', 'B'],
    ['2026-08-24', '2026-09-14', 'C'],
    ['2026-09-07', '2026-09-28', 'D']
  ].forEach(([start, end, id]) => context.agendaWindowMemoryCachePut_(response(start, end, id), range(start, end)));
  assert.equal(context._agendaWindowMemoryCacheOrder.length, 3);
  assert.equal(context.agendaWindowMemoryCacheGet_(aRange), null);
  assert.equal(Object.keys(context._agendaWindowMemoryCache).length, 3);
  const referenciasNovas = validAgendaReferenceData({ medicos: ['Médico recém-cadastrado'] });
  context.agendaWindowMemoryCacheUpdateReferenceData_(referenciasNovas);
  assert.equal(Object.values(context._agendaWindowMemoryCache).every((entry) => entry.referenceData === referenciasNovas), true);
  context.agendaWindowMemoryCacheClear_();
  assert.equal(Object.keys(context._agendaWindowMemoryCache).length, 0);
  assert.equal(context._agendaWindowMemoryCacheOrder.length, 0);

  const cacheSource = [
    functionBody(client, 'agendaWindowMemoryCachePut_'),
    functionBody(client, 'agendaWindowMemoryCacheGet_'),
    functionBody(client, 'agendaWindowMemoryCacheClear_'),
    functionBody(client, 'agendaWindowMemoryCacheUpdateReferenceData_')
  ].join('\n');
  assert.doesNotMatch(cacheSource, /localStorage|sessionStorage|CacheService|google\.script/);
});

test('voltar a uma janela validada reaplica eventos sem nova RPC', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  let rpcReads = 0;
  let applied = null;
  let rendered = 0;
  let callbacks = 0;
  const cached = {
    referenceData: validAgendaReferenceData(),
    events: [{ id: 'CACHE-1' }],
    range: { loadedStart: '2026-07-27', loadedEndExclusive: '2026-08-17' },
    truncated: false
  };
  const context = vm.createContext({
    Number,
    document: { getElementById: () => null },
    google: { script: { get run() { rpcReads += 1; throw new Error('RPC inesperada'); } } },
    _agendaEventos: [{ id: 'OUTRA-JANELA' }],
    _agendaWeekOffset: 0,
    _agendaEventosRequestId: 0,
    agendaUpdatePeriod: () => {},
    agendaWindowForWeekOffset_: () => ({ start: '2026-07-27', endExclusive: '2026-08-17' }),
    agendaWindowMemoryCacheGet_: () => cached,
    agendaWindowMemoryCacheClear_: () => { throw new Error('cache nao deve ser limpo'); },
    agendaFormularioEstaPronto_: () => true,
    applyAgendaFormData: () => { throw new Error('referencias ja estavam prontas'); },
    agendaReferenceDataValidation_: () => ({ ok: true }),
    agendaAplicarEventos_: (events, scope, range, truncated) => { applied = { events, scope, range, truncated }; },
    renderAgendaOperacional: () => { rendered += 1; },
    agendaFallbackCargaCompleta_: () => { throw new Error('fallback inesperado'); }
  });
  vm.runInContext(`function carregarAgendaEventosPorJanela_(forcar, callback, options) {${functionBody(client, 'carregarAgendaEventosPorJanela_')}}`, context);

  context.carregarAgendaEventosPorJanela_(false, () => { callbacks += 1; }, {
    targetWeekOffset: 0,
    onComplete: () => { callbacks += 1; }
  });
  assert.equal(rpcReads, 0);
  assert.equal(context._agendaEventosRequestId, 1);
  assert.deepEqual(Array.from(applied.events, (item) => item.id), ['CACHE-1']);
  assert.equal(applied.scope, 'window');
  assert.deepEqual(Object.assign({}, applied.range), { inicio: '2026-07-27', fim: '2026-08-17' });
  assert.equal(applied.truncated, false);
  assert.equal(rendered, 1);
  assert.equal(callbacks, 2);
});

test('escopo explicito nunca confunde janela nao truncada com colecao completa', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const context = vm.createContext({
    _agendaEventosScope: 'full',
    _agendaEventosRange: null,
    _agendaEventosTruncated: false
  });
  vm.runInContext(`function agendaSetEventosScope_(scope, range, truncated) {${functionBody(client, 'agendaSetEventosScope_')}}`, context);
  vm.runInContext(`function agendaEventosSaoColecaoCompleta_() {${functionBody(client, 'agendaEventosSaoColecaoCompleta_')}}`, context);

  context.agendaSetEventosScope_('window', { inicio: '2026-08-01', fim: '2026-08-22' }, false);
  assert.equal(context._agendaEventosScope, 'window');
  assert.deepEqual(Object.assign({}, context._agendaEventosRange), { inicio: '2026-08-01', fim: '2026-08-22' });
  assert.equal(context._agendaEventosTruncated, false);
  assert.equal(context.agendaEventosSaoColecaoCompleta_(), false);

  context.agendaSetEventosScope_('full', null, true);
  assert.equal(context.agendaEventosSaoColecaoCompleta_(), false);
  context.agendaSetEventosScope_('full', null, false);
  assert.equal(context.agendaEventosSaoColecaoCompleta_(), true);
  assert.equal(context._agendaEventosRange, null);
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
  assert.match(windowLoad, /agendaAplicarEventos_\(response\.events, 'window'/);
  assert.match(fallback, /_agendaWindowedLoadingDisabledForSession = true/);
  assert.match(fallback, /forceLegacyFull: true/);
  assert.match(fallback, /silent: _agendaEventos\.length > 0/);
  assert.doesNotMatch(fallback, /_agendaEventosScope\s*=\s*'full'/);
  assert.doesNotMatch(fallback, /_agendaEventosRange\s*=\s*null/);
  assert.match(navigation, /agendaWindowContainsWeekOffset_\(targetWeekOffset\)/);
  assert.match(navigation, /carregarAgendaEventosPorJanela_\(false, applyNavigation/);
  assert.doesNotMatch(windowLoad, /_agendaEventos\s*=.*before.*agendaBootstrapWindowValido_/s);
});

test('resposta atrasada nao substitui a janela solicitada mais recentemente', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const requests = [];
  const applied = [];
  let cacheClears = 0;
  const runFactory = () => {
    const request = {};
    return {
      withSuccessHandler(handler) { request.success = handler; return this; },
      withFailureHandler(handler) { request.failure = handler; return this; },
      getAgendaBootstrap(start, endExclusive, forceRefresh) {
        request.start = start;
        request.endExclusive = endExclusive;
        request.forceRefresh = forceRefresh;
        requests.push(request);
      }
    };
  };
  const context = vm.createContext({
    Number,
    document: { getElementById: () => null },
    google: { script: { get run() { return runFactory(); } } },
    _agendaEventos: [{ id: 'ANTERIOR' }],
    _agendaWeekOffset: 0,
    _agendaEventosRequestId: 0,
    agendaUpdatePeriod: () => {},
    agendaWindowForWeekOffset_: (offset) => ({ start: `inicio-${offset}`, endExclusive: `fim-${offset}` }),
    agendaWindowMemoryCacheGet_: () => null,
    agendaWindowMemoryCachePut_: () => true,
    agendaWindowMemoryCacheClear_: () => { cacheClears += 1; },
    agendaFormularioEstaPronto_: () => true,
    agendaBootstrapWindowValido_: () => true,
    applyAgendaFormData: () => true,
    agendaReferenceDataValidation_: () => ({ ok: true }),
    agendaAplicarEventos_: (events) => applied.push(events.map((item) => item.id)),
    renderAgendaOperacional: () => {},
    agendaFallbackCargaCompleta_: () => { throw new Error('fallback inesperado'); }
  });
  vm.runInContext(`function carregarAgendaEventosPorJanela_(forcar, callback, options) {${functionBody(client, 'carregarAgendaEventosPorJanela_')}}`, context);

  context.carregarAgendaEventosPorJanela_(false, null, { targetWeekOffset: 1 });
  context.carregarAgendaEventosPorJanela_(true, null, { targetWeekOffset: 8 });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].forceRefresh, true);
  assert.equal(cacheClears, 1);
  requests[1].success({ referenceData: {}, events: [{ id: 'NOVA' }], range: { loadedStart: 'inicio-8', loadedEndExclusive: 'fim-8' }, truncated: false });
  requests[0].success({ referenceData: {}, events: [{ id: 'ATRASADA' }], range: { loadedStart: 'inicio-1', loadedEndExclusive: 'fim-1' }, truncated: false });
  assert.deepEqual(applied, [['NOVA']]);
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

test('novo agendamento abre sem aguardar a revalidacao remota e ignora cliques repetidos', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const toggle = functionBody(client, 'toggleAgendaCreate');
  const open = functionBody(client, 'agendaAbrirCreatePanelNovoPronto_');
  assert.match(toggle, /agendaCreatePanelJaAberto_\(\)\) return/);
  assert.match(toggle, /agendaAbrirCreatePanelNovoPronto_\(\);\s*agendaRevalidarFormDataEmBackground\(true\);/);
  assert.doesNotMatch(toggle, /onComplete/);
  assert.match(open, /agendaCreatePanelJaAberto_\(\)\) return/);
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
      { key: 'AgendaFormData:v9:20260804', forceRefresh: false, strict: false },
      { key: 'AgendaFormDataStrict:v3:20260804', forceRefresh: false, strict: true }
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

test('atualizacao administrativa renova somente referencias e preserva as janelas de eventos', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const notify = functionBody(client, 'notificarAgendaReferenciasAlteradas');
  const refresh = functionBody(client, 'agendaAtualizarReferenciasPendentes_');
  const configInvalidation = functionBody(client, 'invalidarAgendaConfigCache');
  const applyOptions = functionBody(client, 'atualizarAgendaFormDataOpcoes');

  assert.match(notify, /referenceDataDirty = true/);
  assert.match(notify, /APP_BOOTSTRAP_DATA\.agendaFormData = null/);
  assert.match(refresh, /getAgendaReferenceDataFresh\(\)/);
  assert.match(refresh, /atualizarAgendaFormDataOpcoes\(data, \{ preservarValoresAtuais: true \}\)/);
  assert.match(refresh, /agendaWindowMemoryCacheUpdateReferenceData_\(data\)/);
  assert.doesNotMatch(refresh, /carregarAgendaEventos|agendaWindowMemoryCacheClear_/);
  assert.match(applyOptions, /if \(options\.preservarValoresAtuais\)[\s\S]*agendaRestoreValues\(atuais\)[\s\S]*else[\s\S]*agendaRestoreEditRecordValues_\(true\)/);
  assert.match(configInvalidation, /invalidateCadastroBootstrapCache\(\)/);
  assert.match(functionBody(core, 'salvarMedicoApp'), /notificarAgendaReferenciasAlteradas\(\)/);
  assert.match(functionBody(core, 'atualizarAgendaMonitoresAposCadastro'), /notificarAgendaReferenciasAlteradas/);
});

test('servidor invalida todos os caches de referencias e oferece leitura fresca autorizada', () => {
  const removed = [];
  const server = agendaServer({
    Utilities: { formatDate: () => '20260817' },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  server.codexCacheRemove_ = (key) => removed.push(key);
  server.clearCodexRuntimeCaches_();
  assert.ok(removed.includes('AgendaFormDataStrict:v3:20260817'));
  assert.ok(removed.includes('AgendaBootstrapReferenceData:v2:20260817'));

  let forceRefresh = null;
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.agendaGetReferenceData_ = (force) => {
    forceRefresh = force;
    return validAgendaReferenceData();
  };
  const result = server.getAgendaReferenceDataFresh();
  assert.equal(forceRefresh, true);
  assert.deepEqual(Array.from(result.medicos), []);
  assert.equal(server.CODEX_CACHE_BYPASS_READS_, false);

  server.codexGetCurrentUserAccess = () => ({ ok: false, message: 'Negado' });
  assert.throws(() => server.getAgendaReferenceDataFresh(), /Negado/);
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
  server.getAgendaProjetoCourierMap_ = () => ({});
  server.getAgendaFeriadosOperacionais_ = () => [];
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
    'courierConfig', 'projectCourierMap', 'feriados', 'temperaturas', 'statusCourier', 'laboratoriosDestino', 'kitsColeta',
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
  server.getAgendaSheetForRead_ = () => fakeAgenda(server, [
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

test('link para evento fora da janela busca por ID e abre o registro retornado', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const calls = [];
  const context = vm.createContext({
    String,
    _agendaAbrirAposCarga: '',
    irPara: (page) => calls.push(['page', page]),
    agendaFindEventoLocal_: () => null,
    agendaFetchEventoPorId_: (id, rowIndex, onSuccess) => {
      calls.push(['fetch', id, rowIndex]);
      onSuccess({ id, rowIndex: 999 });
    },
    agendaAbrirPendenteAposCarga: () => calls.push(['open']),
    snackErro: (message) => calls.push(['error', message]),
    appErrorMessage: (error) => String(error)
  });
  vm.runInContext(`function abrirAgendaRegistroPorId(agendaId) {${functionBody(client, 'abrirAgendaRegistroPorId')}}`, context);

  assert.equal(context.abrirAgendaRegistroPorId('EVT-FORA'), true);
  assert.deepEqual(calls, [
    ['page', 'agenda'],
    ['fetch', 'EVT-FORA', 0],
    ['open']
  ]);
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

test('projeto de visita ou consulta fica bloqueado no autocomplete enquanto o participante e carregado', () => {
  const agenda = readProjectFile('IndexAgendaScripts.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const participantChange = functionBody(agenda, 'onAgendaParticipanteChange');
  assert.match(participantChange, /atualizarAgendaProjetoLock\(\);/);
  assert.match(participantChange, /getElementById\('agParticipante'\).*value !== nome/);
  assert.match(functionBody(agenda, 'agendaTipoVisitaSelecionado'), /agendaTipoVisitaOuConsulta/);
  assert.match(functionBody(agenda, 'atualizarAgendaProjetoLock'), /sincronizarAutocompleteProjeto\('agProjeto'\)/);
  const sync = functionBody(core, 'sincronizarAutocompleteProjeto');
  assert.match(sync, /input\.disabled = !!select\.disabled/);
  assert.match(sync, /input\.classList\.toggle\('auto-fill', select\.classList\.contains\('auto-fill'\)\)/);
  assert.match(sync, /selectId === 'agProjeto' && select\.disabled/);
  assert.match(sync, /Preenchido pelo participante/);
  assert.match(readProjectFile('IndexContentAfterDashboard.html'), /for="agProjeto">Protocolo/);
});

test('Agenda sugere visitas SoA por projeto sem bloquear visita livre ou projetos legados', () => {
  const agenda = readProjectFile('IndexAgendaScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const load = functionBody(agenda, 'atualizarAgendaVisitasSoA');
  assert.match(content, /id="agVisita"[^>]*list="agVisitaSoAList"/);
  assert.match(content, /id="agVisitaSoAList"/);
  assert.match(content, /Informe uma visita livre/);
  assert.match(load, /method: 'getSoAVisitasProjeto'/);
  assert.match(load, /visita livre continua permitida/i);
  assert.match(load, /projeto não possui calendário SoA/i);
  assert.match(functionBody(agenda, 'onAgendaProjetoChange'), /atualizarAgendaVisitasSoA\(\)/);
  assert.match(functionBody(agenda, 'atualizarAgendaFormDataOpcoes'), /atualizarAgendaVisitasSoA\(\)/);
});

test('resumo do participante e exibido de imediato e atualiza a ultima visita em segundo plano', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  const change = functionBody(client, 'onAgendaParticipanteChange');
  assert.match(change, /agendaParticipanteInfoPrecarregada_\(nome\)/);
  assert.match(change, /agendaAplicarParticipanteInfo_\(infoPrecarregada\)/);
  assert.match(change, /_ultimaVisitaPendente/);
  assert.match(functionBody(client, 'agendaParticipanteInfoHtml_'), /ag-part-info-row/);
  assert.match(functionBody(client, 'agendaParticipanteInfoHtml_'), /Nascimento/);
  assert.match(functionBody(client, 'agendaParticipanteInfoHtml_'), /Intervalo desde a última visita/);
  assert.match(functionBody(client, 'agendaIntervaloDesdeUltimaVisita_'), /ultimaVisitaDataIso/);
  assert.match(functionBody(client, 'agendaIntervaloDesdeUltimaVisita_'), /86400000/);
  assert.match(functionBody(server, 'agendaParticipantesFormulario_'), /calcularIdadeAgenda_/);
  assert.match(functionBody(server, 'agendaBuildDadosFormularioAgenda_'), /participantes: agendaParticipantesFormulario_/);
  assert.match(functionBody(server, 'getInfoParticipante'), /ultimaVisitaDataIso/);
  assert.match(readProjectFile('IndexContentAfterDashboard.html'), /atualizarAgendaIntervaloUltimaVisita\(\)/);
});

test('modal de agendamento acomoda o resumo completo em telas desktop', () => {
  const styles = readProjectFile('IndexStylesAfterDashboard.html');
  assert.match(styles, /\.ag-create-box\{[^}]*width:min\(1280px,96vw\)/);
});

test('campos automáticos desabilitados mantêm a mesma cor azul', () => {
  const styles = readProjectFile('IndexStyles.html');
  assert.match(styles, /select\.f-input\.auto-fill:disabled\s*\{[^}]*color: #1a5276/);
  assert.match(styles, /-webkit-text-fill-color: #1a5276/);
});

test('edição de agendamento também carrega o resumo do participante', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const edit = functionBody(client, 'agendaAbrirEdicaoComRegistroPronto_');
  assert.match(edit, /onAgendaParticipanteChange\(\)/);
});

test('cancelamento de SIV não exige motivo', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(functionBody(client, 'agendaExigeMotivoCancelamento_'), /AgendaRules\.isSiv/);
  assert.match(functionBody(client, 'cancelarAgendaEvento'), /AgendaRules\.isSiv/);
  assert.match(functionBody(server, 'cancelarAgendaEvento'), /tipoAnteriorCancelamento/);
});

test('novo agendamento fixa o status em Agendado e bloqueia estados finais no futuro', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  const statusLock = functionBody(client, 'atualizarAgendaStatusNovoLock_');
  assert.match(statusLock, /setAgendaSelectValue\('agStatus', 'Agendado'\)/);
  assert.match(statusLock, /statusEl\.disabled = novo/);
  assert.match(statusLock, /classList\.toggle\('auto-fill', novo\)/);
  assert.match(functionBody(client, 'validarAgendaRealizadoFuturo'), /AgendaRules\.isCompleted/);
  assert.match(functionBody(server, 'agendaRealizadoFuturoErro_'), /AgendaServerRules_\.isCompleted/);
  assert.match(functionBody(server, 'salvarNovoEventoCompleto'), /dados\.status = 'Agendado'/);
  assert.match(functionBody(server, 'salvarNovoEventoComFeriado'), /dados\.status = 'Agendado'/);
});

test('servidor substitui o projeto informado pelo projeto do participante em visitas e consultas', () => {
  const server = agendaServer();
  server.getInfoParticipante = (nome) => nome === 'Pessoa A' ? { projeto: 'Projeto Correto' } : null;
  const dados = { participante: 'Pessoa A', projeto: 'Projeto Indevido' };
  const erro = server.agendaSincronizarProjetoDoParticipante_(dados, { isVisit: true });
  assert.equal(erro, null);
  assert.equal(dados.projeto, 'Projeto Correto');
  const consulta = { participante: 'Pessoa A', projeto: 'Projeto Indevido' };
  assert.equal(server.agendaSincronizarProjetoDoParticipante_(consulta, { isVisit: false, type: 'consulta' }), null);
  assert.equal(consulta.projeto, 'Projeto Correto');
  assert.equal(server.agendaSincronizarProjetoDoParticipante_({ participante: 'Pessoa A', projeto: 'Livre' }, { isVisit: false, type: 'evento' }), null);
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
  server.getAgendaSheetForRead_ = () => sheet;

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
  server.getAgendaSheetForRead_ = () => sheet;

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

test('edicao busca o registro atual por ID antes de abrir e carrega o contexto operacional', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const open = functionBody(client, 'abrirAgendaEdicao');
  const readyOpen = functionBody(client, 'agendaAbrirEdicaoPronta_');
  const contextualOpen = functionBody(client, 'agendaAbrirEdicaoComContexto_');
  assert.match(client, /function abrirAgendaEdicao\(id, rowIndex\)/);
  assert.match(open, /agendaComFormularioPronto_/);
  assert.match(readyOpen, /agendaFetchEventoPorId_\(id, rowIndex/);
  assert.match(client, /function agendaAbrirEdicaoResolvida_\(r, id\)/);
  assert.match(client, /agendaLoadPeriodoOperacional_\(r/);
  assert.match(client, /function abrirAgendaEdicaoComRegistro_\(r\)/);
  assert.match(contextualOpen, /abrirAgendaEdicaoComRegistro_\(r\)/);
  assert.doesNotMatch(contextualOpen, /getAgendaEventoPorId|versaoAberta|Feche e reabra/);
  assert.match(client, /abrirAgendaEdicao.*Number\(r\.rowIndex \|\| 0\)/);
});

test('edicao nao abre a versao armazenada em cache quando existe uma linha atual no servidor', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const calls = [];
  const cached = { id: 'EVT-1', rowIndex: 7, recordVersion: 'cache-antigo' };
  const fresh = { id: 'EVT-1', rowIndex: 7, recordVersion: 'servidor-atual' };
  const context = vm.createContext({
    agendaFindEventoLocal_: () => cached,
    agendaFetchEventoPorId_: (id, rowIndex, onSuccess) => {
      calls.push(['fetch', id, rowIndex]);
      onSuccess(fresh);
    },
    agendaAbrirEdicaoResolvida_: (row, id) => calls.push(['open', row, id]),
    snackErro: (message) => calls.push(['error', message]),
    appErrorMessage: (error) => String(error)
  });
  vm.runInContext(`function agendaAbrirEdicaoPronta_(id, rowIndex) {${functionBody(client, 'agendaAbrirEdicaoPronta_')}}`, context);

  context.agendaAbrirEdicaoPronta_('EVT-1', 7);

  assert.deepEqual(calls, [
    ['fetch', 'EVT-1', 7],
    ['open', fresh, 'EVT-1']
  ]);
});

test('versao editavel ignora somente alteracoes auxiliares toleradas pela Agenda', () => {
  const server = agendaServer();
  const base = agendaRow(server, {
    id: 'EVT-1',
    participante: 'Participante A',
    controle: 'Pendente',
    reqStatus: ''
  });
  const auxiliar = base.slice();
  auxiliar[server.AGENDA_CFG.idx.controle] = 'Notificado';
  auxiliar[server.AGENDA_CFG.idx.reqStatus] = 'Enviado';
  const negocio = base.slice();
  negocio[server.AGENDA_CFG.idx.participante] = 'Participante B';

  assert.notEqual(server.agendaRecordVersionFromRow_(base), server.agendaRecordVersionFromRow_(auxiliar));
  assert.equal(server.agendaEditableRecordVersionFromRow_(base), server.agendaEditableRecordVersionFromRow_(auxiliar));
  assert.notEqual(server.agendaEditableRecordVersionFromRow_(base), server.agendaEditableRecordVersionFromRow_(negocio));
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
  server.getAgendaSheetForRead_ = () => fakeAgendaRows(server, rows, calls);
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
  server.getAgendaSheetForRead_ = () => fakeAgendaRows(server, rows);
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
    agendaRow(server, { id: 'M1', data: '2026-07-31', tipo: 'Monitoria', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'M2', data: '2026-08-01', tipo: 'Monitoria', status: 'Cancelado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'M3', data: '2026-08-02', tipo: 'Monitoria', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'M5', data: '2026-08-04', tipo: 'Monitoria', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'S1', data: '2026-08-01', tipo: 'SIV', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'S2', data: '2026-08-02', tipo: 'SIV', status: 'Cancelado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' }),
    agendaRow(server, { id: 'S3', data: '2026-08-03', tipo: 'SIV', status: 'Agendado', projeto: 'PA', monitorName: 'Monitor A', salaMonitoria: 'Sala 1' })
  ];
  const calls = [];
  server.getAgendaSheetForRead_ = () => fakeAgendaRows(server, rows, calls);
  server.getCodexSheetDataByName_ = () => [['Id', 'Nome', 'Codigo'], ['PROJ-1', 'Projeto Alpha', 'PA']];

  const monitoria = server.getAgendaPeriodoOperacionalPorEventoId('M2', 3);
  assert.deepEqual(Array.from(monitoria.ids), ['M1', 'M2', 'M3']);
  assert.equal(monitoria.inicio, '2026-07-31');
  assert.equal(monitoria.fim, '2026-08-02');
  assert.equal(monitoria.projetoId, 'PROJ-1');
  const siv = server.getAgendaPeriodoOperacionalPorEventoId('S1', 6);
  assert.deepEqual(Array.from(siv.ids), ['S1']);
  assert.equal(siv.inicio, '2026-08-01');
  assert.equal(siv.fim, '2026-08-01');
  assert.equal(calls.some((call) => call.row === 2 && call.numRows === rows.length && call.numColumns === server.AGENDA_CFG.lastCol), false);
});

test('cliente preserva carga completa mas consumidores usam consultas especificas com fallback', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const materialPrevious = functionBody(client, 'agendaMatBioPreviousEvents_');
  const materialLoad = functionBody(client, 'agendaMatBioLoadPreviousOptions_');
  const materialRecovery = functionBody(client, 'agendaMatBioRecoverFromSpecificFailure_');
  const monitorPayload = functionBody(client, 'agendaMonitoriaDisplayPayload');
  const periodFromRow = functionBody(client, 'agendaPeriodoFromRow');
  const periodFallback = functionBody(client, 'agendaPeriodoFallbackLocal_');
  const periodLoad = functionBody(client, 'agendaLoadPeriodoOperacional_');
  const fullLoad = functionBody(client, 'carregarAgendaEventos');
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
  assert.match(materialPrevious, /agendaEventosSaoColecaoCompleta_\(\) \? agendaMatBioFallbackEvents_\(\) : \[\]/);
  assert.match(materialLoad, /agendaEventosSaoColecaoCompleta_\(\).*agendaMatBioHistoryEquivalent_/s);
  assert.match(materialLoad, /!response \|\| !Array\.isArray\(response\.items\)/);
  assert.match(materialRecovery, /agendaFallbackCargaCompleta_\(aplicarFallbackCompleto, \{ silent: true \}, code\)/);
  assert.match(monitorPayload, /var periodo = agendaPeriodoFromRow\(r\)/);
  assert.doesNotMatch(monitorPayload, /agendaMonitoriaPeriodo\(|agendaSivPeriodo\(/);
  assert.match(periodFromRow, /agendaEventosSaoColecaoCompleta_\(\).*agendaMonitoriaPeriodoFromRow/s);
  assert.match(periodFallback, /agendaEventosSaoColecaoCompleta_\(\).*agendaMonitoriaPeriodoFromRow/s);
  assert.match(periodLoad, /agendaEventosSaoColecaoCompleta_\(\).*String\(local\.inicio/s);
  assert.match(periodLoad, /agendaFallbackCargaCompleta_\(function\(\)/);
  assert.match(periodLoad, /agendaFindEventoLocal_\(id, r\.rowIndex\) \|\| r/);
  assert.match(periodLoad, /if \(!periodo\) \{[\s\S]*recuperarConsultaEspecifica\(new Error/);
  assert.match(periodLoad, /\.withFailureHandler\(function\(error\) \{[\s\S]*recuperarConsultaEspecifica\(error\)/);
  assert.match(fullLoad, /agendaAplicarEventos_\(rows, 'full', null, false\)/);
  assert.doesNotMatch(client, /_agendaWindowedRange/);
});

test('compatibilidades da janela usam fontes autoritativas fora do periodo visivel', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const directOpen = functionBody(client, 'abrirAgendaRegistroPorId');
  const materialPrevious = functionBody(client, 'agendaMatBioPreviousEvents_');
  const periodLoad = functionBody(client, 'agendaLoadPeriodoOperacional_');
  const historyLoad = functionBody(client, 'agendaCarregarHistorico');

  assert.match(directOpen, /agendaFetchEventoPorId_\(agendaId, 0/);
  assert.match(functionBody(client, 'agendaFetchEventoPorId_'), /\.getAgendaEventoPorId\(id, rowIndex \|\| undefined\)/);
  assert.match(materialPrevious, /agendaEventosSaoColecaoCompleta_\(\) \? agendaMatBioFallbackEvents_\(\) : \[\]/);
  assert.match(client, /\.getAgendaMateriaisAnteriores\([\s\S]*limite: 5/);
  assert.match(periodLoad, /\.getAgendaPeriodoOperacionalPorEventoId\(id, r\.rowIndex\)/);
  assert.match(historyLoad, /\.pesquisarAgendaHistorico\(query, cursor, 25\)/);
});

test('fallback concorrente aciona uma unica carga completa e desliga a janela na sessao', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  let fullLoads = 0;
  let pendingCallback = null;
  let pendingOptions = null;
  let cacheClears = 0;
  const context = vm.createContext({
    _agendaFallbackEventWaiters: [],
    _agendaWindowedLoadingDisabledForSession: false,
    _agendaEventosRequestId: 0,
    _agendaFallbackCargaEmAndamento: false,
    _agendaEventos: [{ id: 'VISIBLE' }],
    agendaRegistrarFallback_: () => {},
    agendaFormularioEstaPronto_: () => true,
    agendaCarregarFormDataLegado_: () => {},
    agendaWindowMemoryCacheClear_: () => { cacheClears += 1; },
    carregarAgendaEventos: (force, callback, options) => {
      assert.equal(force, true);
      assert.equal(options.forceLegacyFull, true);
      fullLoads += 1;
      pendingCallback = callback;
      pendingOptions = options;
    }
  });
  vm.runInContext(`function agendaFallbackCargaCompleta_(callback, options, code) {${functionBody(client, 'agendaFallbackCargaCompleta_')}}`, context);

  context.agendaFallbackCargaCompleta_(() => {}, { silent: true }, 'truncated');
  context.agendaFallbackCargaCompleta_(() => {}, { silent: true }, 'rpc_failure');
  assert.equal(fullLoads, 1);
  assert.equal(cacheClears, 2);
  assert.equal(context._agendaWindowedLoadingDisabledForSession, true);
  assert.equal(context._agendaFallbackCargaEmAndamento, true);
  pendingCallback();
  pendingOptions.onComplete();
  assert.equal(context._agendaFallbackCargaEmAndamento, false);
});

test('mutacoes recarregam o escopo corrente sem cache e Transporte avisa a Agenda', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const transport = readProjectFile('TransporteApp.html');
  const refresh = functionBody(client, 'agendaRecarregarJanelaAtual_');
  const windowLoad = functionBody(client, 'carregarAgendaEventosPorJanela_');
  const publicRefresh = functionBody(client, 'recarregarAgendaJanelaAtual');
  const save = functionBody(client, 'salvarAgendaEvento');
  const cancel = functionBody(client, 'cancelarAgendaEvento');
  const requestUpdate = functionBody(client, 'marcarAgendaRequisicaoEnviadaLocal');
  const transportSave = functionBody(transport, 'saveData');
  const transportSaveAndRun = functionBody(transport, 'saveAndRun');
  const transportSync = functionBody(transport, 'syncData');

  assert.match(refresh, /carregarAgendaEventos\(true, callback, options \|\| \{\}\)/);
  assert.match(windowLoad, /if \(forcar === true\) \{[\s\S]*agendaWindowMemoryCacheClear_\(\)/);
  assert.match(publicRefresh, /agendaRecarregarJanelaAtual_\(null, \{ silent: true \}\)/);
  assert.match(save, /agendaRecarregarJanelaAtual_\(\)/);
  assert.match(cancel, /withSuccessHandler\(function\(\) \{ agendaRecarregarJanelaAtual_\(\); \}\)/);
  assert.match(requestUpdate, /aplicarStatusRequisicaoAgendaLocal\([\s\S]*agendaRecarregarJanelaAtual_\(null, \{ silent: true \}\)/);
  assert.match(functionBody(transport, 'refreshAgendaInOpener'), /transportAgendaContext\(\)\.id[\s\S]*openerWin\.recarregarAgendaJanelaAtual\(\)/);
  assert.match(transportSave, /refreshAgendaInOpener\(\)/);
  assert.match(transportSaveAndRun, /refreshAgendaInOpener\(\)/);
  assert.match(transportSync, /refreshAgendaInOpener\(\)/);
});

test('compatibilidade nao altera contratos publicos de Transporte ou documentos', () => {
  const server = readProjectFile('TransporteCodexConfig.gs');
  const transport = readProjectFile('TransporteApp.html');
  assert.match(server, /function getTransporteBootstrapFromAgenda\(idAgenda, slot\)/);
  assert.match(server, /function getTransporteBootstrap\(\)/);
  assert.match(server, /function importarTransporteCodex\(codexPayload, contextoInterno\)/);
  assert.match(server, /function salvarTransporte\(payload, options\)/);
  assert.match(server, /function gerarPdfTransporte\(options\)/);
  assert.match(transport, /serverCall\('salvarTransporte', \[payload, \{ returnBootstrap: false, preencherDocumentos: false \}\]/);
  assert.match(transport, /serverCall\('sincronizarTransporte', \[\]/);
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
