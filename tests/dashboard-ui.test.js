'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

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

test('grafico de coordenadores abre projetos com o coordenador selecionado', () => {
  const dashboard = readProjectFile('IndexDashboard.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const content = readProjectFile('IndexContentAfterDashboard.html');
  assert.match(content, /placeholder="[^"]*coordenador[^"]*"/);
  assert.match(core, /\(p\.coordenador\|\|''\)\.toLowerCase\(\)\.includes\(q\)/);
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
