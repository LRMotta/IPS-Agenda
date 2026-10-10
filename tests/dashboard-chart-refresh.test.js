'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function fixture() {
  const counts = { created: 0, destroyed: 0, updated: 0, resized: 0 };
  const nodes = {};
  const ids = ['chartFase', 'chartEsp', 'chartProjStatus', 'chartCRO', 'chartPartProj', 'chartPartCidade', 'chartPat', 'chartIP', 'chartCoord'];
  for (const id of ids) {
    const canvas = nodes[id] = { id, width: 320, height: 220, clientWidth: 320, clientHeight: 220, closest: () => null };
    canvas.getContext = () => ({ canvas, clearRect() {}, fillText() {} });
  }
  for (const id of ['kpiProjetos', 'kpiPart', 'kpiAtivos', 'kpiZeroRecrut', 'dashTs']) nodes[id] = { textContent: '' };
  const context = vm.createContext({ window: {}, Date, Math,
    document: { readyState: 'loading', addEventListener() {}, getElementById: id => nodes[id] || null,
      querySelectorAll: selector => selector.includes('canvas') ? ids.map(id => nodes[id]) : [] },
    codexNormText: value => String(value || '').toLowerCase(), projetoEstaAtivo_: p => p.status === 'Ativo',
    Chart: function(ctx, config) {
      counts.created++; this.canvas = ctx.canvas; this.config = config; this.data = config.data; this.options = config.options;
      this.width = 320; this.height = 220;
      this.destroy = () => { counts.destroyed++; };
      this.update = mode => { assert.equal(mode, 'none'); counts.updated++; };
      this.resize = () => { this.width = this.canvas.clientWidth; this.height = this.canvas.clientHeight; counts.resized++; };
    },
  });
  vm.runInContext(readProjectFile('IndexDashboard.html').replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, ''), context);
  context.bindDashboardKpiClicks = context.bindDashboardChartCopyButtons = context.renderDashboardAgenda = context.renderDashboardEstoque = () => {};
  const payload = () => ({ projetos: [{ id: 'P1', nomeAbreviado: 'Estudo', status: 'Ativo', fase: 'III', especialidade: 'Clínica',
    cro: 'ORPC', patrocinador: 'Patrocinador', investigador: 'Investigador', coordenador: 'Coordenador' }],
    participantesResumo: { total: 1, ativos: 1, porProjeto: { estudo: { total: 1, ativos: 1, ativosStrict: 1 } }, cidades: { Cidade: 1 } } });
  return { context, counts, nodes, payload };
}

test('Dashboard idêntico conserva todas as instâncias sem redraw; atualização altera apenas séries afetadas', () => {
  const f = fixture();
  f.context.renderDashboard(f.payload());
  const charts = { ...f.context._dashCharts };
  assert.equal(f.counts.created, 9);
  f.context.renderDashboard({ ...f.payload(), _dashboardCachedAt: Date.now() });
  assert.deepEqual(f.counts, { created: 9, destroyed: 0, updated: 0, resized: 0 });
  for (const id of Object.keys(charts)) assert.equal(f.context._dashCharts[id], charts[id]);
  const updated = f.payload();
  updated.participantesResumo.cidades.Cidade = 2;
  f.context.renderDashboard(updated);
  assert.equal(f.counts.updated, 1);
  assert.equal(f.context._dashCharts.chartPartCidade.data.datasets[0].data[0], 2);
  assert.equal(f.counts.created, 9);
  f.context.renderDashboard({ projetos: [], participantes: [] });
  assert.equal(f.counts.destroyed, 9);
  assert.equal(Object.keys(f.context._dashCharts).length, 0);
  f.context.renderDashboard(f.payload());
  assert.equal(f.counts.created, 18);
});

test('assinatura considera rótulos completos, callback, empilhamento e cores', () => {
  const f = fixture();
  let selected;
  const callback = label => { selected = label; };
  const first = 'A'.repeat(80) + ' primeiro', second = 'A'.repeat(80) + ' segundo';
  const draw = (label, color = 'blue', stacked = false, click = callback) =>
    f.context._barH('chartCoord', [label], [{ label: 'Projetos', data: [2], backgroundColor: color }], click, stacked);
  draw(first);
  const chart = f.context._dashCharts.chartCoord;
  draw(first);
  assert.equal(f.counts.updated, 0);
  draw(second);
  chart.options.onClick({}, [{ index: 0 }]);
  assert.equal(selected, second);
  assert.equal(chart.options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]), second);
  draw(second, 'red', true);
  assert.equal(chart.options.scales.x.stacked, true);
  assert.equal(chart.data.datasets[0].backgroundColor, 'red');
  draw(second, 'red', true, label => { selected = 'novo: ' + label; });
  chart.options.onClick({}, [{ index: 0 }]);
  assert.equal(selected, 'novo: ' + second);
  assert.equal(f.counts.updated, 3);
});

test('doughnut reaproveita valores; mudança de categorias recria para não transferir ocultações da legenda', () => {
  const f = fixture();
  f.context._doughnut('chartFase', ['III'], [1]);
  const chart = f.context._dashCharts.chartFase;
  f.context._doughnut('chartFase', ['III'], [1]);
  assert.equal(f.counts.updated, 0);
  f.context._doughnut('chartFase', ['III'], [2]);
  assert.equal(f.context._dashCharts.chartFase, chart);
  assert.equal(f.counts.updated, 1);
  f.context._doughnut('chartFase', ['IV'], [2]);
  assert.notEqual(f.context._dashCharts.chartFase, chart);
  assert.equal(f.counts.destroyed, 1);
});

test('dados iguais permitem ajustar canvas em resize sem reconstruir a instância', () => {
  const f = fixture();
  f.context._doughnut('chartFase', ['III'], [1]);
  f.nodes.chartFase.clientWidth = 640;
  f.context._doughnut('chartFase', ['III'], [1]);
  assert.equal(f.counts.resized, 1);
  assert.equal(f.counts.created, 1);
  assert.equal(f.counts.updated, 0);
});
