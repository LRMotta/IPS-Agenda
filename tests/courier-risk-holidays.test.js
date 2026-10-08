'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFiles, runHtmlScript } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function holiday(dataIso, nome, tipo, recorrencia) {
  return { dataIso, nome: nome || 'Feriado', tipo: tipo || 'Feriado', recorrencia: recorrencia || 'Data específica', ativo: 'Sim', afetaOperacao: 'Sim' };
}

function holidayContext(spreadsheet) {
  return runFiles(['CourierServerRules.gs', 'AgendaServerRules.gs', 'Feriados.gs'], {
    normText_: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    getCodexSpreadsheet_: () => spreadsheet,
    AGENDA_CFG: { abaNomes: ['Agenda', 'Agendamentos'], col: { data: 2, tipo: 4 } },
    getSheetByPossibleNames_: (ss, names) => names.map((name) => ss.getSheetByName(name)).find(Boolean) || null,
    parseAgendaDateAny_: () => null,
    Utilities: {
      getUuid: () => 'uuid-1',
      formatDate: (date) => date.toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    codexAssertCanWrite_: () => {},
    codexWithDocumentLock_: (_name, callback) => callback(),
    codexCacheRemove_: () => {},
    agendaInvalidateReferenceDataCache_: () => {},
    Logger: { log: () => {} }
  });
}

test('navegador e servidor classificam as mesmas datas de risco', () => {
  const client = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const server = runFiles(['CourierServerRules.gs']).CodexCourierRiskRules_;
  const holidays = [holiday('2026-06-04', 'Corpus Christi'), holiday('2026-06-05', 'Emenda institucional', 'Emenda institucional'), holiday('2026-12-25', 'Natal', 'Feriado', 'Anual')];
  const rule = { restricaoSegunda: 'Sim', restricaoAposFeriado: 'Sim' };
  ['2026-06-04', '2026-06-05', '2026-06-06', '2026-06-08', '2027-06-04', '2027-12-25', '2027-12-26'].forEach((dateIso) => {
    assert.deepEqual(plain(client.operationalRisk(dateIso, rule, holidays)), plain(server.operationalRisk(dateIso, rule, holidays)), dateIso);
  });
});

test('navegador e servidor limitam gelo seco a temperaturas congeladas', () => {
  const client = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const server = runFiles(['CourierServerRules.gs']).CodexCourierRiskRules_;
  const scenarios = [
    { input: ['Ambiente'], expected: [] },
    { input: ['Refrigerado'], expected: [] },
    { input: ['Ambiente', 'Congelado'], expected: ['Congelado'] },
    { input: 'Ambiente; Frozen', expected: ['Frozen'] }
  ];
  scenarios.forEach(({ input, expected }) => {
    assert.deepEqual(plain(client.dryIceTemperatures(input)), expected);
    assert.deepEqual(plain(server.dryIceTemperatures(input)), expected);
  });
});

test('Agenda nao alerta restricao de gelo para courier vinculada somente a Ambiente', () => {
  const context = runFiles(['CourierServerRules.gs', 'AgendaCourierRisk.gs'], {
    normText_: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    AgendaServerRules_: { isLabCentral: (value) => value === 'Sim' },
    getCodexSheetDataByName_: () => [],
    projetoCourierColumnMap_: () => ({}),
    projetoCourierTemperatureColumnMap_: () => ({}),
    projetoSituacaoEnvioColumn_: () => -1,
    getAgendaFeriadosOperacionais_: () => [],
    getAgendaCourierConfigs_: () => ({}),
    feriadoDateIso_: (value) => value,
    Utilities: { formatDate: (value) => value },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  context.getAgendaProjetoCourierMap_ = () => ({
    'PROJ-1': {
      id: 'PROJ-1',
      nome: 'Projeto misto',
      couriers: [
        { courierId: 'MARKEN', temperaturas: ['Ambiente'] },
        { courierId: 'OCASA', temperaturas: ['Ambiente', 'Congelado'] }
      ]
    }
  });
  context.getAgendaCourierConfigs_ = () => ({
    MARKEN: { id: 'MARKEN', nome: 'Marken', forneceGeloColeta: 'Sim', restricaoSegunda: 'Sim', restricaoAposFeriado: 'Sim' },
    OCASA: { id: 'OCASA', nome: 'Ocasa', forneceGeloColeta: 'Sim', restricaoSegunda: 'Não', restricaoAposFeriado: 'Não' }
  });
  assert.deepEqual(plain(context.agendaOperationalRiskAlerts_({ data: '2026-06-08', projeto: 'PROJ-1', labCentral: 'Sim' })), []);
  context.getAgendaFeriadosOperacionais_ = () => [holiday('2026-09-07', 'Independência do Brasil')];
  assert.deepEqual(plain(context.agendaOperationalRiskAlerts_({ data: '2026-09-08', projeto: 'PROJ-1', labCentral: 'Sim' })), []);
});

test('Agenda alerta apenas a parcela Congelado de um vinculo com varias temperaturas', () => {
  const context = runFiles(['CourierServerRules.gs', 'AgendaCourierRisk.gs'], {
    normText_: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    AgendaServerRules_: { isLabCentral: (value) => value === 'Sim' },
    getCodexSheetDataByName_: () => [],
    projetoCourierColumnMap_: () => ({}),
    projetoCourierTemperatureColumnMap_: () => ({}),
    projetoSituacaoEnvioColumn_: () => -1,
    getAgendaFeriadosOperacionais_: () => [],
    getAgendaCourierConfigs_: () => ({}),
    feriadoDateIso_: (value) => value,
    Utilities: { formatDate: (value) => value },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  context.getAgendaProjetoCourierMap_ = () => ({
    'PROJ-2': { id: 'PROJ-2', couriers: [{ courierId: 'MARKEN', temperaturas: ['Ambiente', 'Congelado'] }] }
  });
  context.getAgendaCourierConfigs_ = () => ({
    MARKEN: { id: 'MARKEN', nome: 'Marken', forneceGeloColeta: 'Sim', restricaoSegunda: 'Sim' }
  });
  const alerts = plain(context.agendaOperationalRiskAlerts_({ data: '2026-06-08', projeto: 'PROJ-2', labCentral: 'Sim' }));
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].temperaturas, ['Congelado']);
  assert.deepEqual(alerts[0].reasons.map((item) => item.code), ['MONDAY_RESTRICTION']);
});

test('alertas operacionais reutilizam referencias do cache do bootstrap quando disponiveis', () => {
  const context = runFiles(['CourierServerRules.gs', 'AgendaCourierRisk.gs'], {
    normText_: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    AgendaServerRules_: { isLabCentral: (value) => value === 'Sim' },
    feriadoDateIso_: (value) => value,
    Utilities: { formatDate: (value) => value },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    agendaReferenceCacheKey_: () => 'agenda-refs',
    codexCacheGet_: () => ({
      projectCourierMap: { 'PROJ-3': { id: 'PROJ-3', couriers: [] } },
      courierConfig: {},
      feriados: []
    })
  });
  let directReads = 0;
  context.getAgendaProjetoCourierMap_ = () => { directReads += 1; return {}; };
  context.getAgendaCourierConfigs_ = () => { directReads += 1; return {}; };
  context.getAgendaFeriadosOperacionais_ = () => { directReads += 1; return []; };

  assert.deepEqual(plain(context.agendaOperationalRiskAlerts_({ data: '2026-06-08', projeto: 'PROJ-3', labCentral: 'Sim' })), []);
  assert.equal(directReads, 0);
});

test('aviso geral de feriado independe de Lab Central e de restricao de transporte', () => {
  for (const labCentral of ['', 'Nao', 'Sim']) {
    for (const afetaOperacao of ['Sim', 'Não']) {
      const item = { ...holiday('2026-10-12', 'Nossa Senhora Aparecida'), afetaOperacao };
      let holidayReads = 0;
      let transportReads = 0;
      const context = runFiles(['CourierServerRules.gs', 'AgendaServerRules.gs', 'AgendaCourierRisk.gs'], {
        feriadoDateIso_: value => value,
        getAgendaFeriadosOperacionais_: () => { holidayReads++; return [item]; },
        getAgendaCourierConfigs_: () => { transportReads++; return {}; }
      });
      context.getAgendaProjetoCourierMap_ = () => { transportReads++; return {}; };
      const alerts = plain(context.agendaOperationalRiskAlerts_({ data: '2026-10-12', labCentral }));
      assert.deepEqual(alerts.map(alert => alert.code), labCentral === 'Sim' && afetaOperacao === 'Sim'
        ? ['HOLIDAY_DATE', 'HOLIDAY_TRANSPORT_RISK'] : ['HOLIDAY_DATE']);
      assert.match(alerts[0].message, /Nossa Senhora Aparecida.*agendamento continua permitido/);
      assert.doesNotMatch(alerts[0].message, /transporte|courier/);
      assert.equal(holidayReads, 1);
      assert.equal(transportReads, labCentral === 'Sim' ? 2 : 0);
    }
  }
});

test('aviso geral respeita recorrencia e inativos em todas as datas de um periodo', () => {
  const context = runFiles(['CourierServerRules.gs', 'AgendaServerRules.gs', 'AgendaCourierRisk.gs'], {
    feriadoDateIso_: value => value,
    getAgendaFeriadosOperacionais_: () => [
      holiday('2025-10-12', 'Anual', 'Feriado', 'Anual'),
      { ...holiday('2026-10-13', 'Inativo'), ativo: 'Não' },
      holiday('2025-10-14', 'Outro ano')
    ]
  });
  const alerts = plain(context.agendaOperationalRiskAlerts_({ labCentral: 'Nao' }, ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']));
  assert.deepEqual(alerts.map(alert => [alert.code, alert.dateIso]), [['HOLIDAY_DATE', '2026-10-12']]);
});

test('sem Lab Central aviso geral reutiliza cache agregado e parcial somente de feriados', () => {
  for (const mode of ['aggregate', 'partial', 'bypass']) {
    let reads = 0;
    const item = holiday('2026-10-12');
    const context = runFiles(['CourierServerRules.gs', 'AgendaServerRules.gs', 'AgendaCourierRisk.gs'], {
      CODEX_CACHE_BYPASS_READS_: mode === 'bypass',
      feriadoDateIso_: value => value,
      agendaReferenceCacheKey_: () => 'refs',
      codexCacheGet_: () => mode === 'aggregate' ? { feriados: [item] } : null,
      agendaReferencePartsForRead_: () => ({ keys: { feriados: 'f' }, cached: mode === 'bypass' ? {} : { f: JSON.stringify({ version: 1, value: [item] }) }, pending: {} }),
      getAgendaFeriadosOperacionais_: () => { reads++; return [item]; },
      getAgendaProjetoCourierMap_: () => { throw new Error('Nao deve ler projetos'); },
      getAgendaCourierConfigs_: () => { throw new Error('Nao deve ler couriers'); }
    });
    assert.equal(context.agendaOperationalRiskAlerts_({ data: '2026-10-12', labCentral: 'Nao' }).length, 1);
    assert.equal(reads, mode === 'bypass' ? 1 : 0);
  }
});

test('feriado de sexta nao cria risco pos-feriado na segunda', () => {
  const rules = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const holidays = [holiday('2026-05-01', 'Dia do Trabalho')];
  const result = rules.operationalRisk('2026-05-04', { restricaoAposFeriado: 'Sim' }, holidays);
  assert.equal(result.risk, false);
  assert.equal(result.previousHoliday, null);
});

test('feriado de quinta afeta sexta e emenda vale somente na data cadastrada', () => {
  const rules = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const holidays = [holiday('2026-06-04', 'Corpus Christi'), holiday('2026-06-05', 'Emenda institucional', 'Emenda institucional')];
  const friday = rules.operationalRisk('2026-06-05', { restricaoAposFeriado: 'Sim' }, holidays);
  assert.deepEqual(plain(friday.reasons.map((item) => item.code)), ['HOLIDAY_DATE', 'DAY_AFTER_HOLIDAY']);
  const nextYear = rules.operationalRisk('2027-06-05', { restricaoAposFeriado: 'Sim' }, holidays);
  assert.equal(nextYear.risk, false);
});

test('feriado anual usa dia e mes em qualquer ano sem tornar emendas recorrentes', () => {
  const rules = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const holidays = [
    holiday('2026-12-25', 'Natal', 'Feriado', 'Anual'),
    holiday('2026-06-05', 'Emenda institucional', 'Emenda institucional')
  ];
  assert.equal(rules.operationalRisk('2030-12-25', {}, holidays).holiday[0].nome, 'Natal');
  assert.equal(rules.operationalRisk('2030-12-26', { restricaoAposFeriado: 'Sim' }, holidays).previousHoliday[0].nome, 'Natal');
  assert.equal(rules.operationalRisk('2030-06-05', {}, holidays).risk, false);
});

test('recorrencia anual de 29 de fevereiro aparece somente em anos bissextos', () => {
  const rules = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const holidays = [holiday('2028-02-29', 'Data institucional', 'Feriado', 'Anual')];
  assert.equal(rules.holidayItemsForDate('2032-02-29', holidays, false).length, 1);
  assert.equal(rules.holidayItemsForDate('2031-02-28', holidays, false).length, 0);
});

test('cadastro ausente permanece legivel e primeira gravacao cria schema opcional', () => {
  const spreadsheet = new FakeSpreadsheet({});
  const context = holidayContext(spreadsheet);

  assert.deepEqual(plain(context.getFeriadosCadastro_()), []);
  assert.equal(spreadsheet.getSheetByName('Feriados'), null);
  context.salvarFeriado({ dataIso: '2026-06-05', nome: 'Emenda institucional', tipo: 'Emenda institucional' });
  const sheet = spreadsheet.getSheetByName('Feriados');
  assert.ok(sheet);
  assert.deepEqual(sheet.rows[0], ['ID', 'Data', 'Nome', 'Tipo', 'Abrangência', 'Operação de transporte de amostras sujeita a restrições', 'Ativo', 'Observação', 'Recorrência']);
  assert.equal(sheet.rows[1][0], 'FER-uuid-1');
  assert.equal(sheet.rows[1][1], '2026-06-05');
  assert.equal(sheet.rows[1][2], 'Emenda institucional');
  assert.equal(sheet.rows[1][5], 'Sim');
  assert.equal(sheet.rows[1][8], 'Data específica');
});

test('schema anterior permanece somente leitura e recebe recorrencia apenas ao salvar', () => {
  const headers = ['ID', 'Data', 'Nome', 'Tipo', 'Abrangência', 'Afeta operação/coletas', 'Ativo', 'Observação'];
  const sheet = new FakeSheet('Feriados', [headers, ['FER-OLD', '2026-12-25', 'Natal', 'Feriado', 'Nacional', 'Sim', 'Sim', '']]);
  const spreadsheet = new FakeSpreadsheet({ Feriados: sheet });
  const context = holidayContext(spreadsheet);

  assert.equal(context.getFeriadosCadastro_()[0].recorrencia, 'Data específica');
  assert.equal(sheet.writes, 0);
  context.salvarFeriado({ id: 'FER-OLD', dataIso: '2026-12-25', nome: 'Natal', tipo: 'Feriado', abrangencia: 'Nacional', recorrencia: 'Anual' });
  assert.equal(sheet.rows[0][8], 'Recorrência');
  assert.equal(sheet.rows[1][8], 'Anual');
  assert.equal(sheet.rows[0].filter((value) => /transporte de amostras/i.test(value)).length, 0);
});

function trackHolidayReads(sheet) {
  const reads = [];
  const getRange = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => {
    const range = getRange(...args);
    return {
      getValues: () => { reads.push({ method: 'values', args }); return range.getValues(); },
      getDisplayValues: () => { reads.push({ method: 'display', args }); return range.getDisplayValues(); }
    };
  };
  return reads;
}

test('datas de feriado rejeitam overflow e sufixos e preservam formatos legados validos', () => {
  const context = holidayContext(new FakeSpreadsheet({}));
  context.parseAgendaDateAny_ = () => { throw new Error('Parser permissivo proibido'); };
  for (const value of ['2026-02-30', '31/04/2026', '2026-13-01', '2026-12-25xxx', '29/fev/2026', '00/12/2026']) {
    assert.equal(context.feriadoDateIso_(value), '', value);
    assert.throws(() => context.salvarFeriado({ dataIso: value, nome: 'Teste' }), /data válida/);
  }
  for (const value of ['2028-02-29', '29/02/2028', '29/fev./2028', '29/fevereiro/2028']) {
    assert.equal(context.feriadoDateIso_(value), '2028-02-29');
  }
  assert.equal(context.feriadoDateIso_('2026-6-5'), '2026-06-05');
});

test('edicao usa aliases legados sem duplicar colunas e oculta o ID reordenado', () => {
  const sheet = new FakeSheet('Feriados', [
    ['Descrição', 'ID Feriado', 'Data do feriado', 'Afeta operação', 'Escopo'],
    ['Natal', 'OLD', '2026-12-25', 'Não', 'Nacional']
  ]);
  const hidden = [];
  sheet.hideColumns = column => { hidden.push(column); };
  const context = holidayContext(new FakeSpreadsheet({ Feriados: sheet }));
  context.salvarFeriado({ id: 'OLD', dataIso: '2026-12-25', nome: 'Natal atualizado', afetaOperacao: 'Não', abrangencia: 'Nacional' });
  assert.equal(sheet.rows[0].length, 9);
  assert.deepEqual(hidden, [2]);
  const item = context.getFeriadosCadastro_()[0];
  assert.equal(item.id, 'OLD');
  assert.equal(item.nome, 'Natal atualizado');
  assert.equal(item.afetaOperacao, 'Não');
  assert.equal(item.abrangencia, 'Nacional');
});

test('ID ausente ou duplicado bloqueia edicao e exclusao antes de qualquer escrita', () => {
  for (const rows of [[], [['ID']], [['ID Feriado', 'Data do feriado', 'Descrição'], ['DUP', '2026-12-25', 'Natal'], [' DUP ', '2026-11-02', 'Finados']]]) {
    const sheet = new FakeSheet('Feriados', rows);
    const context = holidayContext(new FakeSpreadsheet({ Feriados: sheet }));
    const original = plain(sheet.rows);
    for (const id of ['MISSING', 'DUP']) {
      assert.throws(() => context.salvarFeriado({ id, dataIso: '2026-12-25', nome: 'Natal' }), /não encontrado|duplicado/);
      assert.throws(() => context.excluirFeriado(id), /não encontrado|duplicado/);
    }
    assert.equal(sheet.writes, 0);
    assert.deepEqual(sheet.rows, original);
  }
  const spreadsheet = new FakeSpreadsheet({});
  assert.throws(() => holidayContext(spreadsheet).salvarFeriado({ id: 'MISSING', dataIso: '2026-12-25', nome: 'Natal' }), /não encontrado/);
  assert.equal(spreadsheet.getSheetByName('Feriados'), null);
});

test('somente cadastro central ativo alimenta feriados operacionais inclusive anuais', () => {
  const agenda = new FakeSheet('Agenda', [['ID', 'Data', 'Hora', 'Tipo'], ['L', '2027-12-25', '', 'Feriado']]);
  for (const ativo of ['Sim', 'Não']) {
    const context = holidayContext(new FakeSpreadsheet({ Agenda: agenda }));
    context.getFeriadosCadastro_ = () => [{ ...holiday('2026-12-25', 'Natal', 'Feriado', 'Anual'), ativo, afetaOperacao: 'Não' }];
    const items = context.getAgendaFeriadosOperacionais_();
    assert.equal(items.length, ativo === 'Sim' ? 1 : 0);
    assert.equal(context.CodexCourierRiskRules_.operationalRisk('2027-12-25', {}, items).risk, false);
  }
});

test('referencias de feriados nao consultam Agenda mesmo se a aba falhar', () => {
  const agenda = new FakeSheet('Agenda', [['ID', 'Data', 'Hora', 'Tipo'], ['L', '2026-12-25', '', 'Feriado']]);
  agenda.getRange = () => { throw new Error('Agenda nao deve ser lida'); };
  agenda.getLastRow = () => { throw new Error('Metadados da Agenda nao devem ser lidos'); };
  const context = holidayContext(new FakeSpreadsheet({ Agenda: agenda }));
  context.getFeriadosCadastro_ = () => [holiday('2026-11-02')];
  assert.equal(context.getAgendaFeriadosOperacionais_()[0].dataIso, '2026-11-02');
  context.getFeriadosCadastro_ = () => { throw new Error('Cadastro indisponivel'); };
  assert.throws(() => context.getAgendaFeriadosOperacionais_(), /Cadastro indisponivel/);
});


test('bootstrap de feriados nega leitura antes de consultar cadastro ou acesso de apresentacao', () => {
  const context = runFiles(['WebApp.gs']);
  context.codexAssertCanRead_ = () => { throw new Error('Acesso negado'); };
  context.codexGetCurrentUserAccess = () => { throw new Error('Nao deve consultar'); };
  context.getFeriadosCadastro_ = () => { throw new Error('Nao deve ler'); };
  assert.throws(() => context.getCadastrosBootstrapData('feriados'), /Acesso negado/);
  for (const role of ['readonly', 'admin']) {
    context.codexAssertCanRead_ = () => ({ ok: true, role });
    context.codexGetCurrentUserAccess = () => ({ ok: true, role });
    context.getFeriadosCadastro_ = () => [holiday('2026-12-25')];
    assert.equal(context.getCadastrosBootstrapData('feriados').data.length, 1);
  }
});

test('bootstrap autoriza uma vez e preserva apresentacao do perfil', () => {
  const context = runFiles(['WebApp.gs']);
  let calls = 0;
  context.codexAssertCanRead_ = () => { calls++; return { ok: true, role: 'readonly', userEmail: 'teste@example.com', name: 'Teste' }; };
  context.codexGetCurrentUserAccess = () => { throw new Error('Nao deve reautorizar'); };
  context.getFeriadosCadastro_ = () => [];
  const result = context.getCadastrosBootstrapData('feriados');
  assert.equal(calls, 1);
  assert.equal(result.access.email, 'teste@example.com');
  assert.equal(result.access.canWrite, false);
});

test('salvar feriado rele cabeçalhos apenas uma vez e mantem leitura de IDs em bloco', () => {
  const sheet = new FakeSheet('Feriados', [['ID', 'Data', 'Nome'], ['OLD', '2026-12-25', 'Natal']]);
  const getRange = sheet.getRange.bind(sheet);
  const reads = [];
  sheet.getRange = (...args) => {
    const range = getRange(...args);
    const read = range.getDisplayValues.bind(range);
    range.getDisplayValues = () => { reads.push(args); return read(); };
    return range;
  };
  holidayContext(new FakeSpreadsheet({ Feriados: sheet })).salvarFeriado({ id: 'OLD', dataIso: '2026-12-25', nome: 'Natal atualizado' });
  assert.deepEqual(reads, [[1, 1, 1, 3], [2, 1, 1, 1]]);
});

test('telemetria registra volumes sem conteudo do cadastro e tolera falha de log', () => {
  const sheet = new FakeSheet('Feriados', [['ID', 'Data', 'Nome'], ['SECRET-ID', '2026-12-25', 'SECRET-NAME']]);
  const agenda = new FakeSheet('Agenda', [['ID', 'Data', 'Hora', 'Tipo'], ['SECRET', '2026-11-02', '', 'Feriado']]);
  const context = holidayContext(new FakeSpreadsheet({ Feriados: sheet, Agenda: agenda }));
  const logs = [];
  context.Logger.log = line => logs.push(line);
  context.getAgendaFeriadosOperacionais_();
  const payloads = logs.map(line => JSON.parse(line.slice('[CODEX_FERIADOS_PERF] '.length)));
  assert.equal(payloads[0].stage, 'cadastro');
  assert.equal(payloads[0].readCalls, 2);
  assert.equal(payloads[0].cellsRead, 7);
  assert.equal(payloads.length, 1);
  assert.doesNotMatch(logs.join(''), /SECRET|2026-/);
  context.Logger.log = () => { throw new Error('Log indisponivel'); };
  assert.equal(context.getAgendaFeriadosOperacionais_().length, 1);
});

test('risco operacional aproveita cache parcial e recarrega apenas parte ausente ou invalida', () => {
  for (const mode of ['hit', 'missing', 'invalid', 'bypass']) {
    const stored = [];
    const reads = [];
    const keys = { project_courier_map: 'p', courier_config: 'c', feriados: 'f' };
    const cached = { p: JSON.stringify({ version: 1, value: {} }), c: JSON.stringify({ version: 1, value: {} }), f: JSON.stringify({ version: 1, value: [] }) };
    if (mode === 'missing') delete cached.f;
    if (mode === 'invalid') cached.f = JSON.stringify({ version: 2, value: [] });
    const context = runFiles(['AgendaCourierRisk.gs'], {
      CODEX_CACHE_BYPASS_READS_: mode === 'bypass',
      codexCacheGet_: () => null,
      agendaReferenceCacheKey_: () => 'aggregate',
      agendaReferencePartsForRead_: () => ({ keys, cached: mode === 'bypass' ? {} : cached, pending: {} }),
      agendaReferencePartsStore_: parts => stored.push(parts.pending),
      agendaReferenceCacheSerializedBytes_: value => value.length,
      AGENDA_REFERENCE_CACHE_MAX_BYTES_: 95000,
      getAgendaProjetoCourierMap_: () => { reads.push('p'); return {}; },
      getAgendaCourierConfigs_: () => { reads.push('c'); return {}; },
      getAgendaFeriadosOperacionais_: () => { reads.push('f'); return []; }
    });
    context.getAgendaProjetoCourierMap_ = () => { reads.push('p'); return {}; };
    assert.deepEqual(plain(context.agendaOperationalRiskReferences_()), { projectMap: {}, configs: {}, holidays: [] });
    assert.deepEqual(reads, mode === 'hit' ? [] : mode === 'bypass' ? ['p', 'c', 'f'] : ['f']);
    assert.equal(stored.length, 1);
  }
});

test('feriados legados sao ignorados sem leituras ou alteracoes na Agenda', () => {
  const agenda = new FakeSheet('Agendamentos', [
    ['ID', 'Data', 'Hora', 'Tipo'],
    ['A1', '2026-10-12', '08:00', 'Feriado'],
    ['A2', '2026-11-02', '', ' FERIADO Universitário '],
    ['A3', '2026-11-02', '', 'Feriado'],
    ['A4', '2026-11-03', '', 'Visita'],
    ['A5', 'invalid', '', 'Feriado']
  ]);
  const reads = trackHolidayReads(agenda);
  const context = holidayContext(new FakeSpreadsheet({ Agendamentos: agenda }));
  context.getAgendaSheetForRead_ = () => { throw new Error('Nao deve resolver schema opcional'); };
  context.getFeriadosCadastro_ = () => [
    holiday('2026-10-12', 'Cadastro central', 'Feriado', 'Anual'),
    { ...holiday('2026-11-02', 'Inativo'), ativo: 'Não' }
  ];
  const items = plain(context.getAgendaFeriadosOperacionais_());
  assert.equal(items.length, 1);
  assert.equal(items[0].nome, 'Cadastro central');
  assert.equal(items[0].recorrencia, 'Anual');
  assert.deepEqual(reads, []);
  assert.equal(agenda.writes, 0);
});

test('Agenda grande sem cadastro de feriados nao exige nenhuma leitura', () => {
  const agenda = new FakeSheet('Agenda', [
    ['ID', 'Data', 'Hora', 'Tipo'],
    ...Array.from({ length: 1500 }, (_, i) => [String(i), '2026-10-01', '08:00', 'Visita'])
  ]);
  const reads = trackHolidayReads(agenda);
  const context = holidayContext(new FakeSpreadsheet({ Agenda: agenda }));
  assert.deepEqual(plain(context.getAgendaFeriadosOperacionais_()), []);
  assert.deepEqual(reads, []);
  assert.equal(agenda.writes, 0);
});

test('Agenda ausente ou vazia mantem feriados centrais sem leitura ou escrita de schema', () => {
  for (const sheet of [null, new FakeSheet('Agenda', [['ID', 'Data', 'Hora', 'Tipo']])]) {
    const reads = sheet ? trackHolidayReads(sheet) : [];
    const context = holidayContext(new FakeSpreadsheet(sheet ? { Agenda: sheet } : {}));
    context.getFeriadosCadastro_ = () => [holiday('2026-12-25', 'Natal', 'Feriado', 'Anual')];
    assert.equal(context.getAgendaFeriadosOperacionais_()[0].nome, 'Natal');
    assert.deepEqual(reads, []);
    if (sheet) assert.equal(sheet.writes, 0);
  }
});

test('cadastro le somente datas brutas e preserva colunas reordenadas e IDs exibidos', () => {
  const sheet = new FakeSheet('Feriado', [
    ['Nome', 'ID Feriado', 'Data do feriado', 'Recorrência'],
    ['Natal', '0007', new Date('2026-12-25T12:00:00Z'), 'Anual']
  ]);
  const reads = trackHolidayReads(sheet);
  let lastRowCalls = 0;
  sheet.getLastRow = () => { lastRowCalls++; return sheet.rows.length; };
  const context = holidayContext(new FakeSpreadsheet({ Feriado: sheet }));
  context.Date = Date;
  const item = context.getFeriadosCadastro_()[0];
  assert.equal(item.id, '0007');
  assert.equal(item.dataIso, '2026-12-25');
  assert.equal(item.recorrencia, 'Anual');
  assert.equal(lastRowCalls, 1);
  assert.deepEqual(reads, [
    { method: 'display', args: [1, 1, 2, 4] },
    { method: 'values', args: [2, 3, 1, 1] }
  ]);
  assert.equal(sheet.writes, 0);
});

test('apenas alteracoes no modulo Feriados afetam a lista operacional', () => {
  const agenda = new FakeSheet('Agenda', [['ID', 'Data', 'Hora', 'Tipo'], ['A1', '2026-10-12', '', 'Feriado']]);
  const context = holidayContext(new FakeSpreadsheet({ Agenda: agenda }));
  let cadastro = [];
  context.getFeriadosCadastro_ = () => cadastro;
  assert.deepEqual(plain(context.getAgendaFeriadosOperacionais_()), []);
  agenda.rows[1][1] = '2026-11-02';
  assert.deepEqual(plain(context.getAgendaFeriadosOperacionais_()), []);
  cadastro = [holiday('2026-12-25')];
  assert.equal(context.getAgendaFeriadosOperacionais_()[0].dataIso, '2026-12-25');
  cadastro = [];
  assert.deepEqual(plain(context.getAgendaFeriadosOperacionais_()), []);
});

test('prazos de pendencias e courier usam calendario central fresco sem varrer eventos', () => {
  const context = runFiles(['CourierServerRules.gs', 'WebApp.gs', 'CourierLembretes.gs'], { Date });
  let calls = 0;
  let cadastro = [holiday('2026-12-25', 'Natal', 'Feriado', 'Anual'), holiday('2026-10-13')];
  context.getAgendaFeriadosOperacionais_ = () => { calls++; return cadastro; };
  context.getAgendaSheetForRead_ = () => { throw Error('Feriados nao devem ler Agenda'); };
  const forbiddenRows = new Proxy([], { get() { throw Error('Eventos nao devem ser varridos'); } });
  const map = context.getAgendaFeriadosPendenciasMap_(forbiddenRows, {});
  assert.equal(calls, 1);
  assert.equal(map['--12-25'], true);
  assert.equal(map['2026-10-13'], true);
  assert.equal(context.isDiaOperacionalPendencia_(new Date(2026, 9, 13), map), false);
  assert.equal(context.isDiaOperacionalPendencia_(new Date(2027, 9, 13), map), true);
  for (const year of [2026, 2028, 2029]) {
    assert.equal(context.isDiaOperacionalPendencia_(new Date(year, 11, 25), map), false);
    assert.equal(context.courierLembreteDiaUtil_(new Date(year + '-12-25T10:00:00Z'), map), false);
  }
  cadastro = [];
  const fresh = context.getAgendaFeriadosPendenciasMap_();
  assert.equal(calls, 2);
  assert.equal(context.courierLembreteDiaUtil_(new Date('2029-12-25T10:00:00Z'), fresh), true);
  context.getAgendaFeriadosOperacionais_ = () => { throw Error('Cadastro indisponivel'); };
  assert.throws(() => context.getAgendaFeriadosPendenciasMap_(), /Cadastro indisponivel/);
});

test('calendario de prazos respeita restricoes operacionais e aniversario de 29 de fevereiro', () => {
  const context = runFiles(['CourierServerRules.gs', 'WebApp.gs', 'CourierLembretes.gs'], { Date });
  context.getAgendaFeriadosOperacionais_ = () => [
    { ...holiday('2026-10-13'), afetaOperacao: 'Não' },
    holiday('2028-02-29', 'Anual bissexto', 'Feriado', 'Anual')
  ];
  const map = context.getAgendaFeriadosPendenciasMap_();
  assert.equal(context.isDiaOperacionalPendencia_(new Date(2026, 9, 13), map), true);
  assert.equal(context.courierLembreteDiaUtil_(new Date('2028-02-29T10:00:00Z'), map), false);
  assert.equal(context.courierLembreteDiaUtil_(new Date('2027-03-01T10:00:00Z'), map), true);
  assert.equal(context.courierLembreteHorarioD1_('2028-03-01', '15:00', map).toISOString(), '2028-02-28T15:00:00.000Z');
});


test('Agenda carrega mapa de projeto, regras de courier e feriados e mostra alerta nao bloqueante', () => {
  const server = readProjectFile('WebApp.gs');
  const agendaRisk = readProjectFile('AgendaCourierRisk.gs');
  const client = readProjectFile('IndexAgendaScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  assert.match(server, /projectCourierMap:\s*measureReference\('project_courier_map'/);
  assert.match(server, /feriados:\s*measureReference\('feriados'/);
  assert.match(agendaRisk, /function agendaOperationalRiskAlerts_/);
  assert.match(client, /Atenção operacional — o agendamento continua permitido/);
  assert.match(content, /id="agendaCourierRiskAlert"/);
  assert.match(client, /!AgendaRules\.isType\(r\.tipo, 'feriado'\)/);
  assert.match(client, /CodexCourierRules\.holidayItemsForDate/);
  assert.match(client, /fornecimento de gelo seco sujeito a/);
  assert.match(client, /operação de transporte de amostras sujeita a restrições/);
  assert.match(readProjectFile('IndexExtraModals.html'), /id="feriadoRecorrencia"/);
  assert.match(readProjectFile('IndexExtraModals.html'), /Operação de transporte de amostras sujeita a restrições/);
  assert.match(readProjectFile('IndexExtraModals.html'), /<option>Feriado Universitário<\/option>/);
  assert.doesNotMatch(readProjectFile('IndexExtraModals.html'), /<option>Emenda institucional<\/option>/);
  assert.match(readProjectFile('IndexCoreScripts.html'), /tipo === 'Emenda institucional' \? 'Feriado Universitário' : tipo/);
  assert.match(readProjectFile('IndexExtraModals.html'), /class="form-grid feriado-form-grid"/);
  assert.match(readProjectFile('IndexExtraModals.html'), /class="field feriado-paired-field"[^>]*><label[^>]*for="feriadoAbrangencia"/);
  assert.match(readProjectFile('IndexExtraModals.html'), /class="field feriado-paired-field"[^>]*><label[^>]*for="feriadoAfetaOperacao"/);
  assert.match(readProjectFile('IndexStyles.html'), /#modalFeriado \.feriado-guidance\s*\{[^}]*color:\s*var\(--text-muted\)[^}]*font-size:\s*12px/);
  assert.match(readProjectFile('IndexStyles.html'), /#modalFeriado \.feriado-paired-field \.field-label\s*\{[^}]*min-height:\s*28px/);
});

test('menu posiciona Feriados em Sistema sem abrir o grupo Cadastros', () => {
  const nav = readProjectFile('IndexContent.html');
  const scripts = readProjectFile('IndexCoreScripts.html');
  const systemStart = nav.indexOf('<div class="nav-section">Sistema</div>');
  const holidaysItem = nav.indexOf("onclick=\"irPara('feriados')\"");

  assert.ok(systemStart >= 0 && holidaysItem > systemStart);
  assert.doesNotMatch(scripts, /var cadastros = \[[^\]]*'feriados'/);
});
