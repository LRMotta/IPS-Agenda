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
