'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function clientCore(values = {}) {
  const context = vm.createContext({ window: {}, ...values });
  for (const file of ['SharedMatBioTypes.html', 'SharedMatBioCore.html']) {
    vm.runInContext(readProjectFile(file).replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, ''), context);
  }
  return context.window.CodexMatBioCore;
}

const server = runFile('TransporteCodexConfig.gs');
const implementations = [clientCore(), Object.fromEntries([
  'parseFormula', 'formulaFromSegments', 'serializeItems', 'normalizeItem', 'groupItems',
  'convertFormulaUnit', 'assertItemsUnit'
].map(name => [name, server['codexMatBio' + name[0].toUpperCase() + name.slice(1) + '_']]))];

test('MatBio cliente e servidor rejeitam formulas parciais, sinais e tubos fracionarios', () => {
  for (const core of implementations) {
    for (const formula of ['-2x5', '2x-5', '2x5 + 3x', '2x5 lixo', '1,5x2', '0x5', '1e3x2']) {
      const result = core.parseFormula(formula);
      assert.equal(result.valid, false, formula);
      assert.equal(result.segmentos.length, 0, 'nenhum subtotal enganoso');
      assert.throws(() => core.serializeItems([{ key: 'soro', formula }]), /fórmula|quantidade|Quantidade/);
    }
    assert.equal(core.parseFormula('2 x 0,5, 1 x 1,5').total, 2.5);
    assert.equal(core.parseFormula('2*0.5; 1×1,5').total, 2.5);
    assert.equal(core.parseFormula('').valid, true);
  }
});

test('MatBio formulas preservam milhares legados e decimais pequenos ao reler e converter', () => {
  for (const core of implementations) {
    const formula = core.formulaFromSegments([{ qtd: 1000, vol: 1000 }, { qtd: 1, vol: 0.001 }], 'mL');
    assert.equal(formula, '1000×1000,0; 1×0,001');
    assert.equal(core.parseFormula(formula).total, 1000000.001);
    assert.equal(core.parseFormula('1.000×2,0').tubos, 1000);
    assert.equal(core.parseFormula('1×1.000,0').total, 1000);
    assert.equal(core.parseFormula('1×0.001').total, 0.001);
    const converted = core.convertFormulaUnit('2×0,001', 'mL', 'L');
    assert.equal(core.parseFormula(converted).total, 0.000002);
    assert.throws(() => core.convertFormulaUnit('2x5', 'g', 'L'), /massa/);
    assert.throws(() => core.convertFormulaUnit('2x5 lixo', 'mL', 'L'), /fórmula/);
  }
});

test('MatBio valida segmentos JSON e nao converte dados invalidos em zero ou null', () => {
  for (const core of implementations) {
    for (const segmentos of [[null], [{ qtd: 'abc', vol: 5 }], [{ qtd: 1.5, vol: 2 }], [{ qtd: 1, vol: Infinity }], [{ qtd: 1, vol: -1 }]]) {
      assert.throws(() => core.serializeItems([{ key: 'soro', segmentos }]), /inválido/);
    }
    const item = core.normalizeItem({ key: 'soro', segmentos: [{ qtd: '2', vol: '0,5' }] });
    assert.equal(item.total, 1);
    assert.equal(item.formula, '2×0,5');
  }
});

test('MatBio bloqueia unidades mistas e exige unidade da Courier mantendo gramas', () => {
  for (const core of implementations) {
    const ml = { key: 'soro', unit: 'mL', formula: '1x500' };
    const liters = { key: 'soro', unit: 'L', formula: '1x0,5' };
    assert.throws(() => core.groupItems([ml, liters]), /Unidades diferentes/);
    assert.throws(() => core.groupItems([liters, ml]), /Unidades diferentes/);
    assert.throws(() => core.assertItemsUnit([ml], 'L'), /Converta/);
    assert.throws(() => core.assertItemsUnit([liters], 'mL'), /Converta/);
    assert.doesNotThrow(() => core.assertItemsUnit([liters, { key: 'fezes', unit: 'g', formula: '2x5' }], 'L'));
    assert.doesNotThrow(() => core.assertItemsUnit([{ key: 'soro', formula: '1x0,5' }], 'L'), 'legado sem unidade segue a Courier');
    assert.equal(core.groupItems([{ key: 'constructor', tipo: 'Legado', formula: '1x2' }])[0].total, 2);
  }
});

test('Agenda para Transporte preserva material sem formula como quantidade ausente', () => {
  for (const courier of ['MARKEN', 'DHL']) {
    const unit = courier === 'DHL' ? 'L' : 'mL';
    const json = server.codexMatBioSerializeItems_([
      { key: 'soro', ensaio: 'Exame sem volume', unit },
      { key: 'outro', tipo: 'Lâminas', ensaio: 'Hematologia', unit }
    ]).json;
    const materiais = server.transporteMateriaisFromCodex_(courier, json, '');
    const ativos = materiais.filter(item => item.ativo);
    assert.equal(ativos.length, 2);
    for (const item of ativos) {
      assert.equal(item.formula, '');
      assert.equal(item.tubos, '');
      assert.equal(item.total, '');
      assert.equal(item.unit, unit);
    }
    assert.equal(ativos[0].ensaio, 'Exame sem volume');
    assert.equal(ativos[1].material, 'Lâminas');
    assert.equal(ativos[1].ensaio, 'Hematologia');
    assert.doesNotThrow(() => server.codexMatBioValidateTransportPayload_({ courier, materiais }));
  }
});

test('formulario de Transporte preserva quantificacao ausente e passa na validacao do servidor', () => {
  const core = clientCore();
  for (const courier of ['MARKEN', 'DHL']) {
    const unit = courier === 'DHL' ? 'L' : 'mL';
    const materiais = core.transportRowsFromItems([
      { key: 'soro', ensaio: 'Sem volume', unit },
      { key: 'outro', tipo: 'Lâminas', ensaio: 'Hematologia', unit },
      { key: 'fezes', formula: '2x0', unit: 'g' }
    ]);
    for (const item of materiais.filter(item => item.ativo && item.material !== 'Fezes')) {
      assert.equal(item.tubos, '');
      assert.equal(item.total, '');
      assert.equal(item.formula, '');
    }
    assert.equal(materiais.find(item => item.material === 'Fezes').tubos, 2);
    assert.equal(materiais.find(item => item.material === 'Fezes').total, 0);
    assert.doesNotThrow(() => server.codexMatBioValidateTransportPayload_({ courier, materiais }));
  }
});

test('Agenda para Transporte conserva formulas quantificadas ao agrupar material sem formula', () => {
  const json = server.codexMatBioSerializeItems_([
    { key: 'soro', ensaio: 'Exame A' },
    { key: 'soro', ensaio: 'Exame B', formula: '2x0' },
    { key: 'outro', tipo: 'Swab especial', formula: '3x1,5' }
  ]).json;
  const materiais = server.transporteMateriaisFromCodex_('MARKEN', json, '');
  assert.doesNotThrow(() => server.codexMatBioValidateTransportPayload_({ courier: 'MARKEN', materiais }));
  const soro = materiais.find(item => item.material === 'Soro');
  assert.equal(soro.tubos, 2);
  assert.equal(soro.total, 0);
  assert.equal(soro.ensaio, 'Exame A; Exame B');
  assert.equal(materiais.find(item => item.material === 'Swab especial').total, 4.5);
  for (const tubos of [0, -1, 1.5, 'abc']) {
    assert.throws(() => server.codexMatBioValidateTransportPayload_({
      courier: 'MARKEN', materiais: [{ ativo: true, material: 'Soro', tubos, total: 1 }]
    }), /inválido/);
  }
});

test('MatBio JSON invalido se distingue de vazio e servidor valida antes das escritas', () => {
  const client = clientCore();
  assert.equal(client.parseJson('').valid, true);
  for (const json of ['{', 'null', '{"items":{}}']) {
    assert.equal(client.parseJson(json).valid, false);
    assert.throws(() => server.codexMatBioParseJson_(json, true), /inválidos/);
  }
  const mixed = JSON.stringify({ items: [{ key: 'soro', unit: 'mL', formula: '1x500' }] });
  assert.throws(() => server.codexMatBioValidateAgendaPayload_({ courier1: { nome: 'DHL', matBioJson: mixed } }), /Converta/);
  assert.doesNotThrow(() => server.codexMatBioValidateAgendaPayload_({ courier1: { nome: 'DHL' } }));
  assert.throws(() => server.codexMatBioValidateTransportPayload_({ courier: 'DHL', materiais: [{ ativo: true, material: 'Soro', unit: 'mL', formula: '1x500' }] }), /revise/);
  const payload = { courier: 'MARKEN', materiais: [{ ativo: true, material: 'Soro', unit: 'mL', formula: '2x5', tubos: 99, total: 999 }] };
  server.codexMatBioValidateTransportPayload_(payload);
  assert.equal(payload.materiais[0].total, 10);
  for (const rpc of ['salvarNovoEventoCompleto', 'salvarNovoEventoComFeriado', 'atualizarAgendaEventoCompleto']) {
    const app = runFile('WebApp.gs', {
      codexMatBioValidateAgendaPayload_: server.codexMatBioValidateAgendaPayload_,
      codexAssertCanWrite_: () => {}, codexWithDocumentLock_: (_name, callback) => callback(),
      codexMeasurePerformance_: (_op, _stage, _meta, callback) => callback(),
      SpreadsheetApp: { getActiveSpreadsheet() { assert.fail('validacao deve anteceder acesso ou escrita'); } }
    });
    app.codexAssertCanWrite_ = () => {};
    app.codexWithDocumentLock_ = (_name, callback) => callback();
    app.codexMeasurePerformance_ = (_op, _stage, _meta, callback) => callback();
    assert.throws(() => app[rpc]({ courier1: { nome: 'DHL', matBioJson: mixed } }), /Converta/);
  }
  const source = readProjectFile('TransporteCodexConfig.gs');
  const save = source.slice(source.indexOf('function salvarTransporteInterno_('));
  assert.ok(save.indexOf('codexMatBioValidateTransportPayload_(payload)') < save.indexOf("'write_fields'"));
});

test('MatBio evita formatar e reanalisar segmentos antes de normalizar e reutiliza formatadores', () => {
  let constructors = 0;
  const core = clientCore({ Intl: { NumberFormat: function(locale, options) {
    constructors++;
    return new Intl.NumberFormat(locale, options);
  } } });
  const items = [{ key: 'soro', segmentos: [{ qtd: 2, vol: 0.5 }] }];
  for (let i = 0; i < 20; i++) assert.equal(core.serializeItems(items).summary, 'Soro: 2 tubo(s), 1,00 mL');
  assert.equal(constructors, 2, 'formatadores de quantidade e total reutilizados entre serializacoes');
  const grouped = core.groupItems([{ ...items[0], ensaio: 'Hemograma;  PCR' }, { ...items[0], ensaio: 'hemograma; PCR' }]);
  assert.equal(grouped[0].ensaio, 'Hemograma; PCR');
  assert.equal(items[0].segmentos[0].vol, 0.5, 'dados da origem permanecem intactos');
});
