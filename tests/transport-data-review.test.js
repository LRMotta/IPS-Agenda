'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function server(extra = {}) {
  return runFile('TransporteCodexConfig.gs', {
    Logger: { log() {} },
    normText_: value => String(value || '').toLowerCase().trim(),
    ...extra
  });
}

function client() {
  const context = vm.createContext({ window: {} });
  for (const file of ['SharedMatBioTypes.html', 'SharedMatBioCore.html']) {
    vm.runInContext(readProjectFile(file).replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, ''), context);
  }
  return context.window;
}

// Injeção artificial de metadados: estes casos nao sao produzidos por um campo de unidade da UI.
test('dados externos/legados: fallback de unidade e rejeicao estrita cliente e servidor', () => {
  const s = server();
  const c = client();
  for (const unitKey of [s.codexMatBioUnitKey_, c.CodexMatBioCore.unitKey]) {
    for (const unit of ['µL', 'uL', 'mg', 'desconhecida']) {
      assert.equal(unitKey(unit), 'mL');
      assert.throws(() => unitKey(unit, true), /Unidade.*não suportada/);
    }
    for (const [unit, expected] of [[undefined, 'mL'], ['', 'mL'], ['mililitros', 'mL'], ['millilitres', 'mL'], ['litros', 'L'], ['gramas', 'g']]) {
      assert.equal(unitKey(unit, true), expected);
    }
  }
});

test('dados externos/legados: Transporte rejeita unidade raw desconhecida antes de normalizar ou importar', () => {
  const s = server();
  for (const unit of ['µL', 'uL', 'mg']) {
    const material = { ativo: true, material: 'Soro', formula: '1x500', unit };
    assert.throws(() => s.codexMatBioValidateTransportPayload_({ courier: 'MARKEN', materiais: [material] }), /Unidade.*não suportada/);
    assert.equal(material.unit, unit, 'nao substituir a unidade desconhecida por mL');
    assert.equal(material.formula, '1x500');
    const json = JSON.stringify({ items: [{ key: 'soro', tipo: 'Soro', formula: '1x500', unit }] });
    assert.throws(() => s.transporteMateriaisFromCodex_('MARKEN', json, ''), /Unidade.*não suportada/);
    assert.doesNotThrow(() => s.codexMatBioValidateAgendaPayload_({ courier1: { nome: 'MARKEN', matBioJson: json } }), 'Agenda preserva transicao tolerante');
  }
  for (const [courier, unit] of [['MARKEN', 'mL'], ['DHL', 'L']]) {
    const json = JSON.stringify({ items: [{ key: 'soro', formula: '1x0,5' }] });
    const materiais = s.transporteMateriaisFromCodex_(courier, json, '');
    const soro = materiais.find(item => item.ativo && item.material === 'Soro');
    assert.equal(soro.unit, unit, 'unidade ausente segue contrato legado da Courier');
    assert.equal(soro.total, 0.5);
  }
});

test('slots validos selecionam seu courier e slots invalidos nunca caem no Transporte I', () => {
  const s = server();
  const evento = { courier1: { nome: 'MARKEN' }, courier2: { nome: 'DHL' }, courier3: { nome: 'OCASA' }, backup: { nome: 'PINEX' } };
  for (const [slot, expected] of [['1', 'MARKEN'], [' I ', 'MARKEN'], [' 2 ', 'DHL'], ['Transporte II', 'DHL'], ['III', 'OCASA'], ['b', 'PINEX']]) {
    assert.equal(s.transporteAgendaCourierFromEvento_(evento, slot).nome, expected);
  }
  for (const slot of ['4', 'x']) {
    assert.equal(s.normalizarSlotTransporteCodex_(slot), slot, 'leitura conserva o valor legado para revisao');
    assert.throws(() => s.transporteAgendaCourierFromEvento_(evento, slot), /Slot.*inválido/);
    assert.throws(() => s.montarPayloadTransporteCodex({ slot, agenda: evento }), /Slot.*inválido/);
  }
});

test('vinculo Agenda com slot invalido nao limpa valor nem grava nota', () => {
  const s = server();
  let writes = 0;
  const range = { setNote() { writes++; }, clearNote() { writes++; } };
  s.transporteSetValueIfAllowed_ = () => { writes++; };
  for (const slot of ['4', 'x']) {
    assert.throws(() => s.transporteSetAgendaLink_(range, { idAgenda: 'AG-1', agendaSlot: slot }), /Slot.*inválido/);
    assert.equal(writes, 0);
  }
  s.transporteSetAgendaLink_(range, { idAgenda: 'AG-1' });
  assert.equal(writes, 2, 'nota sem slot continua permitida para vinculo legado');
});

test('Bridge nao faz HTTP nem importa dados quando o slot da solicitacao e invalido', () => {
  let fetches = 0;
  let imports = 0;
  const s = server({ UrlFetchApp: { fetch() { fetches++; } } });
  s.codexAssertCanWrite_ = () => {};
  s.buscarAgendaEventoPorIdTransp_ = () => ({ courier1: { nome: 'MARKEN' } });
  s.importarTransporteCodex = () => { imports++; };
  for (const slot of ['4', 'x']) {
    assert.throws(() => s.gerarDocumentacaoTransporteCodex('AG-1', slot), /Slot.*inválido/);
  }
  assert.equal(fetches, 0);
  assert.equal(imports, 0);
});

test('classificacao por token preserva tipos conhecidos e impede falsos positivos dentro de palavras', () => {
  const s = server();
  const c = client();
  for (const key of [s.codexMatBioKey_, c.CodexMatBioTypes.key]) {
    for (const value of ['sorologia', 'teste urinario', 'serumina', 'vacinal']) assert.equal(key(value), 'outro', value);
    for (const [value, expected] of [['Soro', 'soro'], ['soro - aliquota A', 'soro'], ['análise de urina', 'urina'], ['blood plasma', 'plasma'], ['plasma EDTA', 'plasma'], ['urine micro panel', 'urina']]) {
      assert.equal(key(value), expected, value);
    }
  }
  const custom = [{ key: 'outro', tipo: 'Sorologia', formula: '1x0,5', ensaio: 'Exame A', unit: 'mL' }];
  const json = s.codexMatBioSerializeItems_(custom).json;
  const materiais = s.transporteMateriaisFromCodex_('MARKEN', json, '');
  const sorologia = materiais.find(item => item.ativo && item.material === 'Sorologia');
  assert.equal(sorologia.total, 0.5);
  assert.equal(sorologia.ensaio, 'Exame A');
  assert.equal(JSON.parse(s.transporteMateriaisParaAgenda_(materiais).json).items[0].key, 'outro');
});

test('manifesto usa total formatado e conversao preserva volumes menores que seis casas decimais', () => {
  const s = server();
  const row = total => s.transportePeticaoMaterialRows_([{ ativo: true, material: 'Soro', formula: '1x0,3', total, unit: 'mL', ensaio: 'Exame' }]);
  const first = s.transportePdfManifesto_({ courier: 'MARKEN' }, row(0.3));
  const second = s.transportePdfManifesto_({ courier: 'MARKEN' }, row(0.1 + 0.2));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const c = client();
  for (const [convert, parse] of [[s.codexMatBioConvertFormulaUnit_, s.codexMatBioParseFormula_], [c.CodexMatBioCore.convertFormulaUnit, c.CodexMatBioCore.parseFormula]]) {
    const parsed = parse(convert('2x0,000001', 'mL', 'L'));
    assert.equal(parsed.valid, true);
    assert.equal(parsed.total, 2e-9, 'arredondar conversao a seis casas apagaria material');
  }
});

test('handle da planilha e reutilizado por ID e configuracao limpa caches da execucao', () => {
  let currentId = 'PLANILHA-A';
  const handles = { 'PLANILHA-A': {}, 'PLANILHA-B': {} };
  const opens = [];
  const properties = { getProperty: () => currentId, setProperty: (_key, value) => { currentId = value; } };
  const s = server({ PropertiesService: { getScriptProperties: () => properties }, SpreadsheetApp: { openById(id) { opens.push(id); return handles[id]; } } });
  assert.equal(s.getTransporteSpreadsheetCodex_(), handles['PLANILHA-A']);
  assert.equal(s.getTransporteSpreadsheetCodex_(), handles['PLANILHA-A']);
  assert.equal(opens.length, 1);
  currentId = 'PLANILHA-B';
  assert.equal(s.getTransporteSpreadsheetCodex_(), handles['PLANILHA-B']);
  assert.deepEqual(opens, ['PLANILHA-A', 'PLANILHA-B']);
  s.TRANSPORTE_SHEET_LOOKUP_CACHE_ = { antigo: true };
  s.TRANSPORTE_ADJACENT_LABEL_CACHE_ = { antigo: true };
  s.configurarPlanilhaTransporteCodex('https://docs.google.com/spreadsheets/d/PLANILHA-A/edit');
  assert.equal(s.TRANSPORTE_SPREADSHEET_HANDLE_, null);
  assert.equal(s.TRANSPORTE_SHEET_LOOKUP_CACHE_, null);
  assert.equal(Object.keys(s.TRANSPORTE_ADJACENT_LABEL_CACHE_).length, 0);
  assert.equal(s.getTransporteSpreadsheetCodex_(), handles['PLANILHA-A']);
  assert.deepEqual(opens, ['PLANILHA-A', 'PLANILHA-B', 'PLANILHA-A']);
});

test('falha de openById nao memoriza handle e permite nova tentativa na mesma execucao', () => {
  let opens = 0;
  const handle = {};
  const s = server({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'PLANILHA-A' }) },
    SpreadsheetApp: { openById() { if (++opens === 1) throw new Error('Falha transitoria'); return handle; } }
  });
  assert.throws(() => s.getTransporteSpreadsheetCodex_(), /Falha transitoria/);
  assert.equal(s.TRANSPORTE_SPREADSHEET_HANDLE_, null);
  assert.equal(s.getTransporteSpreadsheetCodex_(), handle);
  assert.equal(s.getTransporteSpreadsheetCodex_(), handle);
  assert.equal(opens, 2);
});

test('CE exige marcador inteiro e protocolo correspondente sem confundir palavras contendo ce', () => {
  const s = server();
  const matches = name => s.transporteComunicadoEspecialFileMatches_(s.transporteParticipantKey_(name), ['projeto-a']);
  for (const name of ['projeto-a_CE.pdf', 'CE - projeto-a.pdf', 'Comunicado - projeto-a.pdf', 'ComunicadoEspecial projeto-a.pdf']) assert.equal(matches(name), true, name);
  for (const name of ['projeto-a_invoice.pdf', 'projeto-a recebido.pdf', 'projeto-a recente.pdf', 'outro-projeto_CE.pdf', 'projeto-a_CELULA.pdf']) assert.equal(matches(name), false, name);
});
