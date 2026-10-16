'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function readFixture(sheets = {}) {
  const spreadsheet = new FakeSpreadsheet(sheets);
  const mutations = [];
  function forbid(target, name) {
    target[name] = () => {
      mutations.push(name);
      throw new Error('Leitura tentou alterar planilha: ' + name);
    };
  }
  forbid(spreadsheet, 'insertSheet');
  for (const sheet of Object.values(sheets)) {
    for (const method of ['appendRow', 'insertColumnsAfter', 'deleteRow', 'deleteRows', 'setFrozenRows', 'hideColumns']) {
      forbid(sheet, method);
    }
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      const range = getRange(...args);
      for (const method of ['setValue', 'setValues', 'clearContent', 'setNumberFormat']) forbid(range, method);
      return range;
    };
  }
  const server = runFile('WebApp.gs', {
    Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Logger: { log() {} }
  });
  server.codexAssertCanRead_ = () => ({ ok: true, role: 'viewer' });
  server.getCodexSpreadsheet_ = () => spreadsheet;
  server.codexCacheGet_ = () => null;
  server.codexCachePut_ = () => {};
  server.codexReadValuesMeasured_ = (range, display) => display ? range.getDisplayValues() : range.getValues();
  server.getProjetosEquipamentos_ = () => [];
  server.getSolicitantesEquipamentos_ = () => [];
  const before = JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([name, sheet]) => [name, sheet.rows])));
  return {
    server, spreadsheet, mutations,
    assertUnchanged() {
      assert.deepEqual(mutations, [], 'Mesmo tentativas de escrita capturadas pela RPC são proibidas.');
      assert.equal(JSON.stringify(Object.fromEntries(Object.entries(spreadsheet.sheets).map(([name, sheet]) => [name, sheet.rows]))), before);
    }
  };
}

for (const rpc of ['getPrestadores', 'buscarPrestadoresParaRequisicao']) {
  test(rpc + ': schema legado de quatro colunas permanece somente leitura', () => {
    const sheet = new FakeSheet('🏢 Prestadores', [
      ['ID', 'Empresa', 'Endereço', 'Email'],
      ['PREST-01', 'Prestador legado', 'Endereço histórico', 'legado@example.invalid']
    ]);
    const f = readFixture({ '🏢 Prestadores': sheet });
    const result = f.server[rpc]();
    assert.equal(result.length, 1);
    assert.equal(result[0].empresa, 'Prestador legado');
    assert.equal(result[0].tipoServico, '');
    f.assertUnchanged();
  });

  test(rpc + ': não interpreta coluna E alheia como tipo de serviço', () => {
    const sheet = new FakeSheet('🏢 Prestadores', [
      ['ID', 'Empresa', 'Endereço', 'Email', 'Observações', 'Telefone'],
      ['PREST-01', 'Prestador legado', 'Endereço histórico', 'legado@example.invalid', 'Preservar anotação', '54999990000']
    ]);
    const f = readFixture({ '🏢 Prestadores': sheet });
    const result = f.server[rpc]();
    assert.equal(result.length, 1);
    assert.equal(result[0].tipoServico, '');
    if (rpc === 'getPrestadores') assert.equal(result[0].telefone, '54999990000');
    f.assertUnchanged();
  });

  test(rpc + ': encontra tipo de serviço deslocado sem acrescentar coluna', () => {
    const sheet = new FakeSheet('🏢 Prestadores', [
      ['ID', 'Empresa', 'Endereço', 'Email', 'Observações', 'Tipo de Serviço', 'Telefone'],
      ['PREST-01', 'Prestador imagem', 'Endereço', 'imagem@example.invalid', 'Preservar', 'Serviço de imagem', '54999990000']
    ]);
    const f = readFixture({ '🏢 Prestadores': sheet });
    const result = f.server[rpc]();
    assert.equal(result[0].tipoServico, 'Serviço de imagem');
    if (rpc === 'getPrestadores') assert.equal(result[0].telefone, '54999990000');
    f.assertUnchanged();
  });
}

test('opções de prestadores usam fallback sem criar Config_App ausente', () => {
  const f = readFixture();
  assert.deepEqual(plain(f.server.getPrestadorTipoServicoOptions_()), ['Análises clínicas', 'Serviço de imagem', 'Outros']);
  f.assertUnchanged();
});

test('opções configuradas e inativas de prestadores não são resemeadas pela leitura', () => {
  const config = new FakeSheet('Config_App', [
    ['Grupo', 'Chave', 'Valor', 'Ativo', 'Ordem', 'Observação'],
    ['Prestadores', 'Tipo de Serviço', 'Tipo exclusivo', 'Sim', 1, ''],
    ['Prestadores', 'Tipo de Serviço', 'Análises clínicas', 'Não', 2, '']
  ]);
  const f = readFixture({ Config_App: config });
  assert.deepEqual(plain(f.server.getPrestadorTipoServicoOptions_()).sort(), ['Tipo exclusivo', 'Serviço de imagem', 'Outros'].sort());
  f.assertUnchanged();
});

test('opção customizada inativa não impede padrões ausentes virtuais sem escrita', () => {
  const config = new FakeSheet('Config_App', [
    ['Grupo', 'Chave', 'Valor', 'Ativo', 'Ordem', 'Observação'],
    ['Prestadores', 'Tipo de Serviço', 'Tipo exclusivo', 'Não', 1, '']
  ]);
  const f = readFixture({ Config_App: config });
  assert.deepEqual(plain(f.server.getPrestadorTipoServicoOptions_()), ['Análises clínicas', 'Serviço de imagem', 'Outros']);
  f.assertUnchanged();
});

test('três padrões de prestadores explicitamente inativos permanecem vazios sem escrita', () => {
  const config = new FakeSheet('Config_App', [
    ['Grupo', 'Chave', 'Valor', 'Ativo', 'Ordem', 'Observação'],
    ['Prestadores', 'Tipo de Serviço', 'Análises clínicas', 'Não', 1, ''],
    ['Prestadores', 'Tipo de Serviço', 'Serviço de imagem', 'Não', 2, ''],
    ['Prestadores', 'Tipo de Serviço', 'Outros', 'Não', 3, '']
  ]);
  const f = readFixture({ Config_App: config });
  assert.deepEqual(plain(f.server.getPrestadorTipoServicoOptions_()), []);
  f.assertUnchanged();
});

for (const [rpc, resultKey, sheetName, headersKey, idKey, descriptionIndex] of [
  ['getEquipamentosFornecidos', 'equipamentos', 'Equipamentos', 'EQUIPAMENTOS_HEADERS_', 'idEquipamentoRec', 9],
  ['getMedicamentosRecebidos', 'medicamentos', 'Medicamentos', 'MEDICAMENTOS_HEADERS_', 'idMedicamentoRec', 7]
]) {
  test(rpc + ': aba ausente retorna lista vazia sem criação', () => {
    const f = readFixture();
    const result = f.server[rpc]();
    assert.deepEqual(plain(result[resultKey]), []);
    assert.deepEqual(plain(result.config), { laboratorios: [], localizacoes: [], tiposItem: [] });
    f.assertUnchanged();
  });

  test(rpc + ': aba existente vazia não recebe cabeçalho durante leitura', () => {
    const sheet = new FakeSheet(sheetName, []);
    const f = readFixture({ [sheetName]: sheet });
    assert.deepEqual(plain(f.server[rpc]()[resultKey]), []);
    f.assertUnchanged();
  });

  test(rpc + ': leitura preserva IDs estáveis e registros históricos', () => {
    const f = readFixture();
    const row = Array(f.server[headersKey].length).fill('');
    row[0] = 'REC-HISTORICO';
    row[2] = 'Projeto legado';
    row[descriptionIndex] = 'Descrição histórica';
    const sheet = new FakeSheet(sheetName, [Array.from(f.server[headersKey]), row]);
    const real = readFixture({ [sheetName]: sheet });
    const result = real.server[rpc]()[resultKey];
    assert.equal(result.length, 1);
    assert.equal(result[0][idKey], 'REC-HISTORICO');
    assert.equal(result[0].rowIndex, 2);
    real.assertUnchanged();
  });
}

test('cadastro courier ausente é consultado sem criar aba nem schema', () => {
  const f = readFixture();
  assert.deepEqual(plain(f.server.getCouriersCadastro()), []);
  f.assertUnchanged();
});

test('cadastro courier legado preserva ID ausente e usa padrões de confirmação sem persistência', () => {
  const sheet = new FakeSheet('Couriers', [
    ['ID', 'Courier', 'Empresa'],
    ['', 'Marken', 'Empresa histórica'],
    ['COU-ESTAVEL', 'DHL', 'Empresa estável']
  ]);
  const f = readFixture({ Couriers: sheet });
  const result = f.server.getCouriersCadastro();
  assert.equal(result.length, 2);
  assert.equal(result[0].id, '', 'Ausência de ID exige migração explícita; a leitura não inventa identidade.');
  assert.equal(result[1].id, 'COU-ESTAVEL');
  const rules = f.server.getCourierConfirmationRules_();
  assert.equal(rules.marken.emailConfirmacao, 'expobrasil@marken.com');
  assert.equal(rules.marken.statusConfirmacao, 'Confirmado');
  assert.equal(rules.dhl.emailConfirmacao, 'wmxbrasil@dhl.com');
  assert.equal(rules.dhl.extrairAwbPorReferencia, true);
  f.assertUnchanged();
});

test('cadastro courier respeita confirmação desativada e valores explícitos', () => {
  const constants = runFile('WebApp.gs');
  const row = Array(constants.COURIER_HEADERS_.length).fill('');
  row[0] = 'COU-ESTAVEL';
  row[1] = 'Marken';
  row[14] = 'Não';
  row[15] = 'custom@example.invalid';
  row[16] = 'Texto configurado';
  row[17] = 'Agendado';
  const sheet = new FakeSheet('Courier', [Array.from(constants.COURIER_HEADERS_), row]);
  const f = readFixture({ Courier: sheet });
  const result = f.server.getCouriersCadastro();
  assert.equal(result[0].monitorConfirmacao, 'Não');
  assert.equal(result[0].emailConfirmacao, 'custom@example.invalid');
  assert.equal(result[0].textoConfirmacao, 'Texto configurado');
  assert.deepEqual(plain(f.server.getCourierConfirmationRules_()), {});
  f.assertUnchanged();
});
