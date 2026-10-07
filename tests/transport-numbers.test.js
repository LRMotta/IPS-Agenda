'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

test('números de Transporte preservam ponto decimal e concordam com volumes das fórmulas', () => {
  const server = runFile('TransporteCodexConfig.gs');
  for (const [text, expected] of [
    ['0.5', 0.5], ['2.5', 2.5], ['0.001', 0.001], ['0.500', 0.5],
    ['1.234', 1.234], ['1.500', 1.5], ['0,5', 0.5], ['2,5', 2.5],
    ['1.234,5', 1234.5], ['1.000.000', 1000000], ['1.000.000,25', 1000000.25]
  ]) {
    assert.equal(server.transporteNumber_(text), expected, text);
    assert.equal(server.transporteTotalMaterial_({ total: text }), expected, text);
    assert.equal(server.transporteCodexVolume_(text), String(expected).replace('.', ','), text);
    assert.equal(server.transporteParseFormula_('1x' + text).total, expected, text);
    assert.equal(server.transporteNumber_(' ' + text + ' '), expected, text);
  }
  assert.equal(server.transporteTotalMaterial_({ formula: '2x0.5' }), 1);
  assert.equal(server.transporteTotalMaterial_({ total: '0', formula: '2x0.5' }), 0);
});

test('quantidade de tubos preserva milhares legados sem remover pontos decimais indiscriminadamente', () => {
  const server = runFile('TransporteCodexConfig.gs');
  for (const [text, expected] of [['1.000', 1000], ['1.234', 1234], ['1.000.000', 1000000], ['1234', 1234]]) {
    assert.equal(server.transporteTubosMaterial_({ tubos: text }), expected, text);
    assert.equal(server.transporteParseFormula_(text + 'x0.5').tubos, expected, text);
  }
  assert.equal(server.transporteTubosMaterial_({ formula: '1.000x0.5' }), 1000);
  for (const text of ['0.5', '2.5', '0,5', '2,5']) {
    assert.equal(server.transporteTubosMaterial_({ tubos: text }), Number(text.replace(',', '.')));
    assert.throws(() => server.codexMatBioValidateTransportPayload_({
      courier: 'MARKEN', materiais: [{ ativo: true, material: 'Soro', tubos: text, total: '0.5' }]
    }), /inválido/);
  }
});

test('parser de Transporte mantém fallback de vazios e inválidos e valores numéricos finitos', () => {
  const server = runFile('TransporteCodexConfig.gs');
  for (const value of [null, undefined, '', ' ', 'abc', '1.2.3', '1,2,3', Infinity, NaN, 'Infinity']) {
    assert.equal(server.transporteNumber_(value), 0, String(value));
  }
  for (const value of [0, 0.5, 2.5, 0.000002, 1234.5]) {
    assert.equal(server.transporteNumber_(value), value);
    assert.equal(server.transporteNumber_(value, true), value);
  }
});

test('DHL grava litros e tubos corretos com strings decimais e milhares legados', () => {
  const server = runFile('TransporteCodexConfig.gs');
  const writes = {};
  function sheet(name) {
    return {
      getRange: cell => ({
        setValue: value => { writes[name + ':' + cell] = value; }, clearContent() {}
      }),
      getRangeList: () => ({ setNumberFormat() {}, setValue() {} })
    };
  }
  const invoice = sheet('invoice');
  const declaracao = sheet('declaracao');
  server.transporteGetSheet_ = (_ss, name) => name === 'invoiceDhl' ? invoice : declaracao;
  server.transporteParseDate_ = () => new Date('2026-10-07T12:00:00Z');
  server.preencherDhlWebApp_({}, {
    courier: 'DHL', temperatura: 'AMBIENTE', materiais: [
      { ativo: true, material: 'Soro', tubos: '1.000', total: '0.5', unit: 'mL' },
      { ativo: true, material: 'Urina', tubos: '2', total: '2.5', unit: 'L' },
      { ativo: false, material: 'Saliva', tubos: '1', total: '99.9', unit: 'L' }
    ]
  });
  assert.equal(writes['invoice:J30'], 1002);
  assert.equal(writes['declaracao:F18'], 0.0005);
  assert.equal(writes['declaracao:F19'], 2.5);
  assert.equal(writes['declaracao:F20'], '');
});

test('PINEX usa parser real para volumes decimais textuais e quantidade agrupada', () => {
  const server = runFile('TransporteCodexConfig.gs');
  server.extrairIniciais_ = () => 'P.T.';
  const checked = Array.from({ length: 8 }, (_, i) => [i === 1 || i === 4]);
  const tubos = Array.from({ length: 8 }, (_, i) => [i === 1 ? '1.000' : '0']);
  const volumes = Array.from({ length: 8 }, (_, i) => [i === 1 ? '0.5' : i === 4 ? '2.5' : '0']);
  assert.equal(server.transportePinexSampleSummary_('Pessoa Teste', checked, tubos, volumes, '2 slides'),
    'Patient P.T. - 1000 tube(s) of human bio sample - Total 0.50 mL / 2 slide(s) / 2.50 g');
});
