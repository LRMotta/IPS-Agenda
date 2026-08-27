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
  return runFiles(['CourierServerRules.gs', 'Feriados.gs'], {
    normText_: (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    getCodexSpreadsheet_: () => spreadsheet,
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

test('Agenda carrega mapa de projeto, regras de courier e feriados e mostra alerta nao bloqueante', () => {
  const server = readProjectFile('WebApp.gs');
  const agendaRisk = readProjectFile('AgendaCourierRisk.gs');
  const client = readProjectFile('IndexAgendaScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  assert.match(server, /projectCourierMap:\s*getAgendaProjetoCourierMap_\(\)/);
  assert.match(server, /feriados:\s*getAgendaFeriadosOperacionais_\(\)/);
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
