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
  assert.equal(canvasIds.length, 16);
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
