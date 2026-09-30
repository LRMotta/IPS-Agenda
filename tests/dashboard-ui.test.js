'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function dashboardContext(values) {
  const context = vm.createContext(Object.assign({
    window: {}, document: { readyState: 'loading', addEventListener() {} },
  }, values));
  vm.runInContext(readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, ''), context);
  return context;
}

test('Dashboard recupera os KPIs após falha e remove gráficos antigos quando a lista fica vazia', () => {
  const elements = Object.fromEntries(['dashKpis', 'kpiProjetos', 'kpiPart', 'kpiAtivos', 'kpiZeroRecrut', 'dashTs']
    .map(id => [id, { textContent: '', style: {} }]));
  Object.defineProperty(elements.dashKpis, 'innerHTML', { set() {
    ['kpiProjetos', 'kpiPart', 'kpiAtivos', 'kpiZeroRecrut'].forEach(id => delete elements[id]);
  } });
  const context = dashboardContext({
    Chart: function() {}, codexNormText: value => String(value || '').toLowerCase(),
    projetoEstaAtivo_: p => p.classificacaoStatus === 'ativo',
    document: { readyState: 'loading', addEventListener() {}, getElementById: id => elements[id], querySelectorAll: () => [] },
  });
  let errorMessage;
  context.mostrarErroDashboard = message => { errorMessage = message; };
  ['bindDashboardKpiClicks', 'moverBlocoAgendaDashboard', 'renderDashboardAgenda', 'renderDashboardEstoque',
    'bindDashboardChartCopyButtons'].forEach(name => { context[name] = () => {}; });
  assert.equal(context.renderDashboard({ erros: ['Erro de leitura'] }), false);
  assert.equal(errorMessage, 'Erro de leitura');
  let destroyed = 0;
  context._dashCharts.chartFase = { destroy() { destroyed++; } };
  assert.equal(context.renderDashboard({ projetos: [], participantes: [] }), true);
  assert.equal(elements.kpiProjetos.textContent, '0');
  assert.equal(destroyed, 1);
  assert.equal(context._dashCharts.chartFase, undefined);
  context.Chart = undefined;
  assert.equal(context.renderDashboard({}), false);
  context.Chart = function() {};
  assert.equal(context.renderDashboard({}), true);
});

test('Dashboard escapa mensagens de erro antes de inseri-las no HTML', () => {
  let html;
  const context = dashboardContext({
    document: { readyState: 'loading', addEventListener() {}, getElementById: id => id === 'page-dashboard'
      ? { insertAdjacentHTML(position, value) { html = value; } } : null },
    esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  });
  context.mostrarErroDashboard('<img src=x onerror=alert(1)>');
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
});

test('Dashboard conserva a soma dos rankings em Outros como o servidor', () => {
  const map = { A: 10, B: 7, C: 3, D: 1 };
  const context = dashboardContext();
  const server = runFile('WebApp.gs');
  const pairs = JSON.parse(JSON.stringify(context.dashAgendaPairs(map, 3)));
  assert.deepEqual(pairs, JSON.parse(JSON.stringify(server.agendaMapToPairs_(map, 3))));
  assert.equal(pairs.reduce((sum, pair) => sum + pair.value, 0), 21);
});

test('Dashboard distingue indisponibilidade de zero e restaura a seção na recuperação', () => {
  const values = [{ textContent: '0' }];
  const charts = [{ style: {} }];
  const classes = new Set();
  const attributes = {};
  const block = { style: {}, setAttribute(key, value) { attributes[key] = value; },
    classList: { toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); } },
    querySelectorAll(selector) { return selector === '.dash-kpi-val' ? values : charts; } };
  const context = dashboardContext({ document: { readyState: 'loading', addEventListener() {}, getElementById: () => block } });
  context.dashboardSectionAvailability_('dashAgendaBlock', false);
  assert.equal(values[0].textContent, 'Dados indisponíveis');
  assert.equal(charts[0].style.display, 'none');
  assert.equal(attributes['data-dashboard-available'], '0');
  context.dashboardSectionAvailability_('dashAgendaBlock', true);
  assert.equal(charts[0].style.display, '');
  assert.equal(attributes['data-dashboard-available'], '1');
  assert.equal(classes.size, 0);
});

test('impressão do Dashboard identifica o recorte da Agenda e a indisponibilidade', () => {
  let available = true;
  const block = { querySelectorAll: () => [{ closest: () => null }],
    getAttribute: () => available ? '1' : '0' };
  const context = dashboardContext({ document: { readyState: 'loading', addEventListener() {}, getElementById: () => block },
    esc: value => String(value) });
  context.dashboardPrintVisible = () => true;
  context.dashboardPrintKpiCard = () => '<div>3</div>';
  context._dashAgendaPeriod = { tipo: 'mes', ano: 2026, mes: 9 };
  assert.match(context.dashboardPrintAgendaKpis(), /Set\/2026/);
  context._dashAgendaPeriod.tipo = 'global';
  assert.match(context.dashboardPrintAgendaKpis(), /Global/);
  available = false;
  assert.match(context.dashboardPrintAgendaKpis(), /Dados indisponíveis/);
});

test('Dashboard renova dados em memória após o TTL e bloqueia RPCs concorrentes', () => {
  let requests = 0;
  let success;
  const runner = { withSuccessHandler(callback) { success = callback; return this; },
    withFailureHandler() { return this; }, getDashboardData() { requests++; } };
  const context = dashboardContext({ google: { script: { run: runner } },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null } });
  context.dashboardRenderFromSessionCache = () => false;
  context.renderDashboard = () => true;
  context.dashboardStoreSessionCache = () => {};
  context._dashInited = true;
  context._dashLoadedAt = Date.now();
  context.carregarDashboard(false);
  assert.equal(requests, 0);
  context._dashLoadedAt = Date.now() - context.DASHBOARD_SESSION_CACHE_TTL_MS - 100;
  context.carregarDashboard(false);
  context.carregarDashboard(true);
  assert.equal(requests, 1);
  success({});
  assert.equal(context._dashLoading, false);
  assert.ok(context._dashLoadedAt > Date.now() - 1000);
});

test('Dashboard informa falhas parciais de Agenda e Estoque e não as guarda no cache', () => {
  const server = runFile('WebApp.gs', { Logger: { log() {} } });
  server.codexAssertCanRead_ = () => {};
  server.getProjetos = () => [];
  server.getParticipantesDashboardResumo_ = () => [];
  server.getEstoque = () => { throw new Error('falha estoque'); };
  server.getAgendaDashboardResumo_ = () => { throw new Error('falha agenda'); };
  server.getDashboardPendencias_ = () => ({});
  const data = server.getDashboardData();
  assert.equal(data.erros.length, 0);
  assert.equal(data.secoes.estoque, false);
  assert.equal(data.secoes.agenda, false);
  assert.equal(data.avisos.length, 2);
  let stored = 0;
  let removed = 0;
  const storage = { setItem() { stored++; }, removeItem() { removed++; } };
  const context = dashboardContext({ window: { sessionStorage: storage }, sessionStorage: storage });
  context.dashboardStoreSessionCache(data);
  assert.equal(stored, 0);
  assert.equal(removed, 1);
  server.getEstoque = () => [];
  server.getAgendaDashboardResumo_ = () => ({});
  const recovered = server.getDashboardData();
  assert.equal(recovered.secoes.agenda, true);
  assert.equal(recovered.secoes.estoque, true);
  context.dashboardStoreSessionCache(recovered);
  assert.equal(stored, 1);
});

test('servidor classifica status de projeto uma unica vez com normalizacao', () => {
  const server = runFile('WebApp.gs');
  const casos = [
    ['Cancelado', 'cancelado'],
    ['  CANCELADA  ', 'cancelado'],
    ['Projeto cancelado', 'cancelado'],
    ['Concluído', 'concluido'],
    ['Concluída', 'concluido'],
    ['Projeto concluido', 'concluido'],
    ['Recrutamento Aberto', 'ativo'],
    ['Em Acompanhamento', 'ativo'],
    ['', 'ativo']
  ];

  casos.forEach(([status, esperado]) => {
    assert.equal(server.classificarProjetoStatus_(status), esperado, status);
  });
});

test('projetos, Dashboard e Estoque consomem a classificacao canonica do servidor', () => {
  const server = runFile('WebApp.gs');
  server.codexAssertCanRead_ = () => ({ ok: true, role: 'user' });
  const rows = [
    ['ID', 'Nome', 'Código', '', '', '', '', '', '', '', '', '', '', 'Status'],
    ['1', 'Ativo', '', '', '', '', '', '', '', '', '', '', '', 'Em Acompanhamento'],
    ['2', 'Cancelado', '', '', '', '', '', '', '', '', '', '', '', 'Cancelada'],
    ['3', 'Concluído', '', '', '', '', '', '', '', '', '', '', '', 'Concluída']
  ];
  server.getCodexSheetDataByName_ = () => rows;
  server.getParticipantesStatsPorProjeto_ = () => ({});
  server.getProjetosSivPorProjeto_ = () => ({});
  server.projetoCourierColumnMap_ = () => ({ principal: -1, adicional1: -1, adicional2: -1 });
  server.projetoCourierTemperatureColumnMap_ = () => ({ principal: -1, adicional1: -1, adicional2: -1 });
  server.projetoSituacaoEnvioColumn_ = () => -1;

  const projetos = Array.from(server.getProjetos());
  assert.deepEqual(projetos.map((p) => p.classificacaoStatus), ['ativo', 'cancelado', 'concluido']);
  assert.deepEqual(Array.from(server.getProjetosAtivosEstoque_()), ['Ativo']);

  const dashboard = readProjectFile('IndexDashboard.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const webApp = readProjectFile('WebApp.gs');
  assert.match(webApp, /classificacaoStatus: str\(p\.classificacaoStatus\)/);
  assert.match(core, /filter\(projetoEstaAtivo_\)/);
  assert.match(core, /classificacao === 'cancelado'/);
  assert.match(core, /projetoStatusChip\(p\)/);
  assert.match(dashboard, /proj\.filter\(projetoEstaAtivo_\)/);
  assert.doesNotMatch(dashboard, /function _isProjetoAtivoDash/);
  assert.doesNotMatch(core, /function dashboardProjetoAtivo_/);
});

test('resumo de Projetos exclui cancelados de todos os indicadores ativos', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const rulesBlock = sourceBetween(core, 'function projetoClassificacaoStatus_(', 'function applyDashboardPendingFilter_(');
  const renderBlock = sourceBetween(core, 'function renderProjetos(', 'function filtrarProjetos(');
  const elements = {};
  ['projTotal', 'projFases', 'projEsps', 'projRecrutamento', 'projRecrutamentoPct', 'projConcluidos'].forEach((id) => {
    elements[id] = { textContent: '' };
  });
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id] },
    filtrarProjetos: () => {},
    applyDashboardPendingFilter_: () => {}
  });
  vm.runInContext(rulesBlock + renderBlock, context);

  context.renderProjetos([
    { classificacaoStatus: 'ativo', especialidade: 'Oncologia', participantesAtivos: 2, metaRecrutamento: 5, totalParticipantes: 3, falhasTriagem: 1 },
    { classificacaoStatus: 'ativo', especialidade: 'Cardiologia', participantesAtivos: 1, metaRecrutamento: 4, totalParticipantes: 2, falhasTriagem: 0 },
    { classificacaoStatus: 'cancelado', especialidade: 'Nefrologia', participantesAtivos: 50, metaRecrutamento: 60, totalParticipantes: 70, falhasTriagem: 8 },
    { classificacaoStatus: 'concluido', especialidade: 'Hematologia', participantesAtivos: 40, metaRecrutamento: 50, totalParticipantes: 60, falhasTriagem: 7 }
  ]);

  assert.equal(elements.projTotal.textContent, 4);
  assert.equal(elements.projFases.textContent, 2);
  assert.equal(elements.projConcluidos.textContent, 1);
  assert.equal(elements.projRecrutamento.textContent, '3 pacientes ativo(s)');
  assert.equal(elements.projRecrutamentoPct.textContent, 'Meta 9 | Total 5 | Falhas 1');
});

test('pesquisa de Projetos encontra courier principal ou adicional pelo nome', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const buscaBlock = sourceBetween(core, 'function projetoCorrespondeBusca_(', 'function filtrarProjetos(');
  const courierBlock = sourceBetween(core, 'function projetoCourierNome_(', 'function projetoCouriersDetalheHtml_(');
  const context = vm.createContext({
    COURIERS_PROJ: [
      { id: 'COU-1', nome: 'DHL Express' },
      { id: 'COU-2', nome: 'Marken Brasil' }
    ]
  });
  vm.runInContext(courierBlock + buscaBlock, context);

  assert.equal(context.projetoCorrespondeBusca_({ courierPrincipalId: 'COU-1' }, 'dhl'), true);
  assert.equal(context.projetoCorrespondeBusca_({ courierAdicional2Id: 'COU-2' }, 'marken'), true);
  assert.equal(context.projetoCorrespondeBusca_({ courierPrincipalId: 'COU-1' }, 'marken'), false);
});

test('rankings de patrocinador e investigador exibem os 15 principais resultados', () => {
  const dashboard = readProjectFile('IndexDashboard.html');
  assert.match(dashboard, /var patPairs = _topDashResults\(patKeys, patMap, 15\);/);
  assert.match(dashboard, /var ipPairs = _topDashResults\(ipKeys, ipMap, 15\);/);
  assert.match(dashboard, /var head = pairs\.slice\(0, topCount\);/);
  assert.match(dashboard, /head\.push\(\{ label: 'Outros', value: rest \}\);/);
});

test('todos os gráficos do dashboard recebem cópia isolada em PNG', () => {
  const dashboard = readProjectFile('IndexDashboard.html');
  const content = readProjectFile('IndexDashboardContent.html');
  const canvasIds = Array.from(content.matchAll(/<canvas id="([^"]+)"/g), (match) => match[1]);
  assert.equal(canvasIds.length, 17);
  assert.equal(new Set(canvasIds).size, canvasIds.length);
  assert.match(dashboard, /function copiarGraficoDashboard\(canvasId, button\)/);
  assert.match(dashboard, /new ClipboardItem\(\{ 'image\/png': blob \}\)/);
  assert.match(dashboard, /querySelectorAll\('#page-dashboard canvas\[id\]'\)/);
  assert.match(dashboard, /button\.setAttribute\('data-canvas-id', canvas\.id\)/);
  assert.match(dashboard, /copiarGraficoDashboard\(canvas\.id, button\)/);
  assert.match(dashboard, /bindDashboardChartCopyButtons\(\);/);
});

test('impressao usa somente o titulo gerencial dos graficos', () => {
  const dashboard = readProjectFile('IndexDashboard.html');
  assert.match(dashboard, /function dashboardPrintChartTitleText\(title\)/);
  assert.match(dashboard, /dashboardChartTitleElement\(canvas\)/);
  assert.match(dashboard, /querySelectorAll\('\.material-symbols-outlined, \.dash-chart-copy'\)/);
  assert.match(dashboard, /dashboardPrintChartTitleText\(prev\)/);
});

test('Dashboard agrega a cidade e UF dos participantes com status Ativo', () => {
  const server = runFile('WebApp.gs');
  server.getCodexSheetDataByName_ = () => [
    ['ID', 'Nome', '', '', '', 'Projeto', '', '', 'Status', '', '', '', '', '', 'Cidade', 'UF'],
    ['1', 'Pessoa A', '', '', '', 'Estudo A', '', '', 'Ativo', '', '', '', '', '', 'Caxias do Sul', 'RS'],
    ['2', 'Pessoa B', '', '', '', 'Estudo A', '', '', 'Em seguimento', '', '', '', '', '', 'Caxias do Sul', 'RS']
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(server.getParticipantesDashboardResumo_())), [
    { nome: 'Pessoa A', projeto: 'Estudo A', status: 'Ativo', cidade: 'Caxias do Sul', estado: 'RS' },
    { nome: 'Pessoa B', projeto: 'Estudo A', status: 'Em seguimento', cidade: 'Caxias do Sul', estado: 'RS' }
  ]);

  const dashboard = readProjectFile('IndexDashboard.html');
  const content = readProjectFile('IndexDashboardContent.html');
  const cityBlock = sourceBetween(dashboard, 'function dashboardParticipantCityPairs(', 'function dashboardProjectStat(');
  const context = vm.createContext({
    _isParticipanteAtivoDash: (p) => String(p.status || '').toLowerCase() === 'ativo',
    _sortDesc: (map) => Object.keys(map).sort((a, b) => map[b] - map[a]),
    _topDashResults: (keys, map, limit) => keys.slice(0, limit).map((key) => ({ label: key, value: map[key] }))
  });
  vm.runInContext(cityBlock, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.dashboardParticipantCityPairs([
    { status: 'Ativo', cidade: 'Caxias do Sul', estado: 'RS' },
    { status: 'Ativo', cidade: 'Caxias do Sul', estado: 'rs' },
    { status: 'Em seguimento', cidade: 'Bento Gonçalves', estado: 'RS' },
    { status: 'Ativo', cidade: '', estado: 'RS' }
  ]))), [{ label: 'Caxias do Sul/RS', value: 2 }]);
  assert.match(content, /id="chartPartCidade"/);
  assert.match(content, /Cidade de Origem dos Participantes Ativos/);
  assert.match(dashboard, /dashboardParticipantCityPairs\(part\)/);
  assert.match(dashboard, /_barH\('chartPartCidade'/);
});

test('Dashboard conta participantes atendidos uma vez por recorte da Agenda', () => {
  const dashboard = readProjectFile('IndexDashboard.html');
  const content = readProjectFile('IndexDashboardContent.html');
  const block = sourceBetween(dashboard, 'function dashAgendaParticipantesAtendidos(', 'function renderDashboardAgendaPeriodoResumo(');
  const context = vm.createContext({});
  vm.runInContext(block, context);

  const realizados = [
    { participanteKey: 'cadastro:1', realizado: true },
    { participanteKey: 'cadastro:1', realizado: true },
    { participanteKey: 'projeto:abc|id:22', realizado: true },
    { participanteKey: 'cadastro:3', realizado: false },
    { participanteKey: '', realizado: true }
  ];
  assert.equal(context.dashAgendaParticipantesAtendidos(realizados, (row) => row.realizado), 2);
  assert.match(content, /id="dashAgendaParticipantesAtendidos"/);
  assert.match(content, /Participantes atendidos/);
});

test('Dashboard identifica participante por cadastro e preserva fallback legado por protocolo', () => {
  const server = runFile('WebApp.gs');
  const idx = { participanteCadastroId: 0, projeto: 1, idParticipante: 2, participante: 3 };

  assert.equal(server.agendaDashboardParticipantKey_(['CAD-81', 'Estudo A', 'P-10', 'Pessoa A'], idx), 'cadastro:cad-81');
  assert.equal(server.agendaDashboardParticipantKey_(['', 'Estudo A', 'P-10', 'Pessoa A'], idx), 'projeto:estudo a|id:p-10');
  assert.equal(server.agendaDashboardParticipantKey_(['', 'Estudo A', '', 'Pessoa A'], idx), 'projeto:estudo a|nome:pessoa a');
  assert.equal(server.agendaDashboardParticipantKey_(['', 'Estudo A', '', ''], idx), '');
});

test('grafico de coordenadores abre projetos com o coordenador selecionado', () => {
  const dashboard = readProjectFile('IndexDashboard.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  assert.match(content, /placeholder="[^"]*coordenador[^"]*"/);
  assert.match(core, /p\.coordenador/);
  assert.match(core, /projetoCorrespondeBusca_\(p, q\)/);
  assert.match(core, /filtro !== 'coordenador'/);
  assert.match(core, /normSelectValue\(p && p\.coordenador\) === coordenador/);
  assert.match(dashboard, /function dashOpenCoordinator\(coordenador\)/);
  assert.match(dashboard, /dashOpenMainWithFilter\('projetos', 'coordenador', coordenador\)/);
  assert.match(dashboard, /_barH\('chartCoord',[\s\S]*dashOpenCoordinator\);/);
});

test('projetos disponibiliza impressao da lista exibida', () => {
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const core = readProjectFile('IndexCoreScripts.html');
  assert.match(content, /class="btn-new proj-print-btn"/);
  assert.match(content, /onclick="imprimirProjetos\(\)"/);
  assert.match(core, /function imprimirProjetos\(\)/);
  assert.match(core, /querySelectorAll\('tr\.proj-main'\)/);
  assert.match(core, /slice\.call\(cells, 0, 8\)/);
  assert.match(core, /querySelectorAll\('\.proj-toggle, \.row-avatar'\)/);
  assert.match(core, /querySelectorAll\('button, \.material-symbols-outlined'\)/);
  assert.match(core, /window\.open\('', '_blank'\)/);
});

test('impressao de Projetos separa os indicadores de recrutamento por linha', () => {
  const core = readProjectFile('IndexCoreScripts.html');
  const formatter = sourceBetween(core, 'function recrutamentoProjetoImpressaoHtml_(', '\n\nvar FASE_COLORS');
  const context = vm.createContext({ esc: (value) => String(value) });
  vm.runInContext(formatter, context);

  const html = context.recrutamentoProjetoImpressaoHtml_('1 pacientes ativo(s)12,5%Total: 7Meta: —');
  assert.match(html, />1 pacientes ativo\(s\) \(12,5%\)<\/div>/);
  assert.match(html, />Total: 7<\/div>/);
  assert.match(html, />Meta: —<\/div>/);
  assert.doesNotMatch(html, /Total: 7Meta:/);

  const concluido = context.recrutamentoProjetoImpressaoHtml_('Projeto concluído Total: 7 Falha triagem: 1');
  assert.match(concluido, />Projeto concluído<\/div>/);
  assert.match(concluido, />Total: 7<\/div>/);
  assert.match(concluido, />Falha triagem: 1<\/div>/);
});
