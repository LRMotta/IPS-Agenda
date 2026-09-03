'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile, runHtmlScript } = require('./helpers/load-app-script');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function serverCourierContext() {
  const source = readProjectFile('WebApp.gs');
  const block = sourceBetween(source, 'function codexCourierNorm_(', 'function codexCourierTrackingUrl_(');
  const context = vm.createContext({});
  vm.runInContext(block, context);
  return context;
}

test('Agenda e Transporte compartilham a regra de iniciais que ignora particulas', () => {
  const server = runFile('WebApp.gs');
  const transportSource = readProjectFile('TransporteCodexConfig.gs');

  assert.equal(server.extrairIniciais_('Joao dos Santos'), 'J.S.');
  assert.equal(server.extrairIniciais_('Maria da Silva e Souza'), 'M.S.S.');
  assert.equal(server.extrairIniciais_('A. B.'), 'A.B.');
  assert.equal(server.extrairIniciais_(''), '');
  assert.doesNotMatch(transportSource, /function\s+transporteExtrairIniciais\s*\(/);
  assert.doesNotMatch(transportSource, /transporteExtrairIniciais\s*\(/);
  assert.match(transportSource, /extrairIniciais_\s*\(/);
});

test('regras de AWB do navegador e servidor permanecem alinhadas', () => {
  const client = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const server = serverCourierContext();
  const cases = [
    { courier: 'MARKEN', input: 'ab-12 cd 34 ef 56', normalized: 'AB12CD34EF56', valid: true },
    { courier: 'DHL', input: '12.345.678/90', normalized: '1234567890', valid: true },
    { courier: 'OCASA', input: 'a-1234567', normalized: 'A1234567', valid: true },
    { courier: 'OCASA', input: 'PK2WIZ177555', normalized: 'PK2WIZ177555', valid: true },
    { courier: 'DHL', input: '12345', normalized: '12345', valid: false },
    { courier: 'OCASA', input: 'ABC', normalized: 'ABC', valid: false },
    { courier: 'PINEX', input: 'PIN-123 livre', normalized: 'PIN-123 livre', valid: true }
  ];

  cases.forEach((item) => {
    assert.equal(client.normalizeAwb(item.input, item.courier), item.normalized, item.courier);
    assert.equal(server.codexCourierNormalizeAwb_(item.input, item.courier), item.normalized, item.courier);
    assert.equal(client.isValidAwb(item.input, item.courier), item.valid, item.courier);
    assert.equal(server.codexCourierIsValidAwb_(item.input, item.courier), item.valid, item.courier);
  });
});

test('slots da Agenda sao normalizados sem trocar o transporte', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(source, 'function normalizarSlotTransporteCodex_(', '/* ===== END CODEX_TransporteBridge.gs ===== */');
  const context = vm.createContext({
    normText_: (value) => String(value || '').trim().toLowerCase()
  });
  vm.runInContext(block, context);

  assert.equal(context.normalizarSlotTransporteCodex_('I'), '1');
  assert.equal(context.normalizarSlotTransporteCodex_('Transporte II'), '2');
  assert.equal(context.normalizarSlotTransporteCodex_('III'), '3');
  assert.equal(context.normalizarSlotTransporteCodex_('Backup'), 'backup');
});

test('PINEX e canonicalizada antes de selecionar a documentacao', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const normalize = sourceBetween(source, 'function transporteNormalizeCourierFromCodex_(', 'function transporteIsDhl_(');
  const pdfSpec = sourceBetween(source, 'function transportePdfSpec_(', 'function transportePdfActualSheetName_(');
  const context = vm.createContext({
    transporteNorm_: (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    transporteIsDhl_: (value) => String(value || '').toLowerCase().indexOf('dhl') >= 0,
    transportePdfActualSheetName_: (key) => key
  });
  vm.runInContext(normalize + '\n' + pdfSpec, context);

  assert.equal(context.transporteNormalizeCourierFromCodex_('Pinex'), 'PINEX');
  assert.equal(context.transporteNormalizeCourierFromCodex_('pinex'), 'PINEX');
  assert.equal(context.transporteNormalizeCourierFromCodex_('Pinex (Agendamento)'), 'PINEX (Agendamento)');

  const spec = context.transportePdfSpec_(context.transporteNormalizeCourierFromCodex_('Pinex'), 'AMBIENTE', '', {});
  assert.deepEqual(Array.from(spec.ordem), [
    'folhaDhlPinex',
    'invoicePinex',
    'peticaoPinex',
    'usdaStatementPinex',
    'fichaEmergenciaPinex',
    'declaracaoTransp'
  ]);
  assert.deepEqual({ ...spec.copias }, {
    folhaDhlPinex: 1,
    invoicePinex: 3,
    peticaoPinex: 2,
    usdaStatementPinex: 1,
    fichaEmergenciaPinex: 3,
    declaracaoTransp: 3
  });
});

test('pre-agendamento prepara documentos sem sincronizar de volta para a Agenda', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const save = sourceBetween(source, 'function salvarTransporte(', 'function transporteSetEnsaiosPeticao_(');
  assert.doesNotMatch(save, /if \(!options\.rascunho && options\.preencherDocumentos !== false\)/);
  assert.match(save, /if \(options\.preencherDocumentos !== false\)/);
  assert.match(save, /var agendaSync = options\.rascunho\s*\?\s*\{ atualizado: false/);
});

test('volumes da Declaracao de Transporte usam o bloco mesclado J:L', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const read = sourceBetween(source, 'function transporteReadRegistro_(', 'function transporteValidate_(');
  const save = sourceBetween(source, 'function salvarTransporte(', 'function transporteSetEnsaiosPeticao_(');
  const calculations = sourceBetween(source, 'function transporteDeclaracaoFormulaLinha_(', 'function verificarEAtualizarG33Declaracao_(');
  const pinex = sourceBetween(source, 'function atualizarFormularioPinex_(', 'function processarHorarioColeta_(');
  const cleanup = sourceBetween(source, 'function performContentDeletion_(', 'function criarRascunhoEmail_(');

  assert.match(read, /formula:\s*r\[8\]\s*\|\|\s*r\[9\]\s*\|\|\s*r\[10\]/);
  assert.match(save, /transporteSetTopLeftInBlock_\(declaracao, 'J' \+ sheetRow \+ ':L' \+ sheetRow, row\[0\]\)/);
  assert.match(calculations, /getRange\('J' \+ row \+ ':L' \+ row\)/);
  assert.match(pinex, /getRange\('J21:L28'\)/);
  assert.match(cleanup, /'J21:L28'/);
  assert.doesNotMatch(source, /getRange\('K21:K28'\)/);
});

test('formulas de volume usam representacao compacta sem perder decimais significativos', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const serverBlock = sourceBetween(source, 'function codexMatBioFormatNumber_(', 'function codexMatBioParseJson_(');
  const server = vm.createContext({
    codexMatBioUnitKey_: (unit) => String(unit || '').toLowerCase() === 'l' ? 'L' : 'mL'
  });
  vm.runInContext(serverBlock, server);
  const client = runHtmlScript('SharedMatBioCore.html').CodexMatBioCore;
  const segments = [
    { qtd: 1, vol: 0.5 },
    { qtd: 1, vol: 1 },
    { qtd: 1, vol: 1.75 },
    { qtd: 2, vol: 0.25 }
  ];

  assert.equal(server.codexMatBioFormulaFromSegments_(segments, 'mL'), '1\u00d70,5; 1\u00d71,0; 1\u00d71,75; 2\u00d70,25');
  assert.equal(client.formulaFromSegments(segments, 'mL'), '1\u00d70,5; 1\u00d71,0; 1\u00d71,75; 2\u00d70,25');
  assert.equal(server.codexMatBioParseFormula_('1\u00d70,5; 1\u00d71,0; 1\u00d71,75; 2\u00d70,25').total, 3.75);
});

test('protecao de layout reduz a fonte e bloqueia volume ainda maior antes do PDF', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const helpers = sourceBetween(source, 'function transporteVolumeFormulaFontSize_(', 'function calcularTotalTubos(');
  const pdf = sourceBetween(source, 'function imprimirTodasAbas(', 'function transportePdfSpec_(');
  const formulas = {
    21: '1 x 0,50, 1 x 1,00, 1 x 1,75, 2 x 0,25',
    22: 'x'.repeat(35),
    23: 'x'.repeat(40)
  };
  const fontSizes = {};
  const wrapModes = {};
  const context = vm.createContext({
    transporteDeclaracaoFormulaLinha_: (_sheet, row) => formulas[row] || '',
    transporteParseFormula_: (text) => ({
      segmentos: text === formulas[21]
        ? [{ qtd: 1, vol: 0.5 }, { qtd: 1, vol: 1 }, { qtd: 1, vol: 1.75 }, { qtd: 2, vol: 0.25 }]
        : []
    }),
    transporteFormulaFromSegments_: () => '1\u00d70,5; 1\u00d71,0; 1\u00d71,75; 2\u00d70,25',
    transporteSetTopLeftInBlock_: (_sheet, a1, value) => { formulas[Number(a1.slice(1, 3))] = value; }
  });
  vm.runInContext(helpers, context);
  const sheet = {
    getRange: (a1) => {
      const row = Number(a1.slice(1, 3));
      return {
        setFontSize: (size) => {
          fontSizes[row] = size;
          return {
            setWrap: (wrap) => { wrapModes[row] = wrap; }
          };
        }
      };
    }
  };

  assert.equal(context.transporteVolumeFormulaFontSize_('x'.repeat(30)), 11);
  assert.equal(context.transporteVolumeFormulaFontSize_('x'.repeat(31)), 10);
  assert.equal(context.transporteVolumeFormulaFontSize_('x'.repeat(37)), 9);
  assert.equal(context.transporteVolumeFormulaFontSize_('x'.repeat(43)), 0);
  assert.deepEqual(Array.from(context.transporteAjustarVolumesDeclaracao_(sheet, true)), []);
  assert.equal(formulas[21], '1\u00d70,5; 1\u00d71,0; 1\u00d71,75; 2\u00d70,25');
  assert.equal(fontSizes[21], 11);
  assert.equal(fontSizes[22], 10);
  assert.equal(fontSizes[23], 9);
  assert.equal(wrapModes[23], false);
  formulas[24] = 'x'.repeat(43);
  assert.throws(() => context.transporteAjustarVolumesDeclaracao_(sheet, true), /linha\(s\) 24/);
  assert.match(pdf, /transporteAjustarVolumesDeclaracao_\([\s\S]*, true\);[\s\S]*SpreadsheetApp\.flush\(\);[\s\S]*makeCopy\(/);
});

test('Transporte resolve participante pelo ID estavel mesmo com nome historico divergente', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'function transporteParticipantKey_(',
    'function transporteAgendadoresConfig_('
  );
  const context = vm.createContext({
    Logger: { log: () => {} },
    getCodexSheetDataByName_: (name) => name === 'Participantes'
      ? [
        ['ID', 'Nome', '', '', 'ID Participante', 'Projeto'],
        ['81231558', 'Filipe Muneron da Silva', '', '', '2011250001', 'SKYLINE-UC']
      ]
      : [
        ['ID', 'Nome', 'Codigo', '', '', 'Investigador'],
        ['P1', 'SKYLINE-UC', 'SPY123-201', '', '', 'Eduardo Brambilla']
      ],
    buscarAgendaEventoPorIdTransp_: () => ({
      participante: 'Filipe Mumeron da Silva',
      idParticipante: '2011250001',
      projeto: 'SKYLINE-UC',
      medico: ''
    })
  });
  vm.runInContext(block, context);

  const payload = context.transporteDerivarDadosParticipante_({
    paciente: 'Filipe Mumeron da Silva',
    identificacaoParticipante: '2011250001'
  });
  assert.equal(payload.protocolo, 'SKYLINE-UC');
  assert.equal(payload.investigador, 'Eduardo Brambilla');
  assert.equal(payload.identificacaoParticipante, '2011250001');
});

test('Transporte combina ID e projeto quando o identificador se repete entre estudos', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'function transporteParticipantKey_(',
    'function transporteAgendadoresConfig_('
  );
  const participantes = [
    { id: '1', nome: 'Afonso Celso Kramer de Araujo', idParticipante: 'BR100010006', projeto: 'OrigAMI-3' },
    { id: '93', nome: 'Sandro Sbardelotto', idParticipante: 'BR100010006', projeto: 'OrigAMI-2' }
  ];
  const context = vm.createContext({
    Logger: { log: () => {} },
    getParticipantes: () => participantes,
    getProjetos: () => []
  });
  vm.runInContext(block, context);

  const sandro = context.transporteEncontrarParticipante_(participantes, {
    identificacaoParticipante: 'BR100010006',
    paciente: 'Sandro Sbardelotto',
    protocolo: 'OrigAMI-2'
  });
  assert.equal(sandro.nome, 'Sandro Sbardelotto');

  const registro = context.transporteAtualizarRegistroPorAgenda_({
    idAgenda: 'evt-sandro',
    paciente: 'Afonso Celso Kramer de Araujo',
    identificacaoParticipante: 'BR100010006',
    protocolo: 'OrigAMI-3'
  }, {
    participante: 'Sandro Sbardelotto',
    idParticipante: 'BR100010006',
    projeto: 'OrigAMI-2'
  });
  assert.equal(registro.paciente, 'Sandro Sbardelotto');
  assert.equal(registro.protocolo, 'OrigAMI-2');

  const ambiguo = context.transporteEncontrarParticipante_(participantes, {
    identificacaoParticipante: 'BR100010006'
  });
  assert.equal(ambiguo, null);
});

test('Transporte corrige divergencia de um caractere somente quando participante e projeto sao unicos', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'function transporteParticipantKey_(',
    'function transporteAgendadoresConfig_('
  );
  const participantes = [{
    idParticipante: '2011250001',
    nome: 'Filipe Muneron da Silva',
    projeto: 'SKYLINE-UC'
  }];
  const context = vm.createContext({
    Logger: { log: () => {} },
    getParticipantes: () => participantes,
    getProjetos: () => [{ nomeAbreviado: 'SKYLINE-UC', codigo: 'SPY123-201', investigador: 'Eduardo Brambilla' }]
  });
  vm.runInContext(block, context);

  const corrigido = context.transporteDerivarDadosParticipante_({
    paciente: 'Filipe Mumeron da Silva',
    protocolo: 'SKYLINE-UC (SPY123-201)'
  });
  assert.equal(corrigido.identificacaoParticipante, '2011250001');

  participantes.push({
    idParticipante: 'OUTRO-ID',
    nome: 'Filipe Mumeron da Silva',
    projeto: 'OUTRO-ESTUDO'
  });
  const projetoDiferente = context.transporteDerivarDadosParticipante_({
    paciente: 'Filipe Mumeron da Silva',
    protocolo: 'SKYLINE-UC (SPY123-201)'
  });
  assert.equal(projetoDiferente.identificacaoParticipante, '2011250001');

  participantes.push({
    idParticipante: 'PID-DUPLICADO',
    nome: 'Filipe Numeron da Silva',
    projeto: 'SKYLINE-UC'
  });
  const ambiguo = context.transporteDerivarDadosParticipante_({
    paciente: 'Filipe Mumeron da Silva',
    protocolo: 'SKYLINE-UC (SPY123-201)'
  });
  assert.equal(ambiguo.identificacaoParticipante || '', '');
});

test('comparacao segura de projeto nao consulta a planilha para cada participante', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(source, 'function transporteProjetosCorrespondem_(', 'function transporteEncontrarParticipante_(');

  assert.doesNotMatch(block, /transporteProjetoAliases_/);
  assert.doesNotMatch(block, /getProjetos/);
  assert.match(block, /value\.match\(\/\^\(\.\*\?\)/);
});

test('ficha vinculada atualiza protocolo, investigador e laboratorio pelo idAgenda e slot', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'function transporteParticipantKey_(',
    'function transporteAgendadoresConfig_('
  );
  const context = vm.createContext({
    Logger: { log: () => {} },
    getCodexSheetDataByName_: (name) => name === 'Participantes'
      ? [
        ['ID', 'Nome', '', '', 'ID Participante', 'Projeto'],
        ['81231558', 'Filipe Muneron da Silva', '', '', '2011250001', 'SKYLINE-UC']
      ]
      : [
        ['ID', 'Nome', 'Codigo', '', '', 'Investigador'],
        ['P1', 'SKYLINE-UC', 'SPY123-201', '', '', 'Eduardo Brambilla']
      ],
    buscarAgendaEventoPorIdTransp_: (id) => {
      assert.equal(id, 'fc1ad99b');
      return {
        participante: 'Filipe Mumeron da Silva',
        idParticipante: '2011250001',
        projeto: 'SKYLINE-UC',
        medico: '',
        courier2: { destino: 'Lab Agenda II' }
      };
    }
  });
  vm.runInContext(block, context);

  const registro = context.transporteAtualizarRegistroPorAgenda_({
    idAgenda: 'fc1ad99b',
    agendaSlot: '2',
    paciente: 'Filipe Mumeron da Silva',
    protocolo: 'SPY',
    investigador: '',
    destino: 'Lab alterado na tela'
  });
  assert.equal(registro.paciente, 'Filipe Muneron da Silva');
  assert.equal(registro.protocolo, 'SKYLINE-UC (SPY123-201)');
  assert.equal(registro.investigador, 'Eduardo Brambilla');
  assert.equal(registro.identificacaoParticipante, '2011250001');
  assert.equal(registro.destino, 'Lab Agenda II');
  assert.equal(context.transporteAtualizarRegistroPorAgenda_({ destino: 'Lab Manual' }).destino, 'Lab Manual');
});

test('laboratorio permanece editavel no Transporte manual e bloqueia quando vem da Agenda', () => {
  const client = readProjectFile('TransporteApp.html');
  const block = sourceBetween(client, 'function transportAgendaContext(', 'function focusAgendaInOpener(');
  const destino = {
    disabled: false,
    title: '',
    classList: {
      values: new Set(),
      toggle(name, enabled) { enabled ? this.values.add(name) : this.values.delete(name); }
    },
    removeAttribute(name) { if (name === 'title') this.title = ''; }
  };
  const agendaContext = {
    title: '',
    classList: { add() {}, remove() {} },
    removeAttribute() {}
  };
  const context = vm.createContext({
    state: { registro: {} },
    document: { getElementById: (id) => id === 'destino' ? destino : agendaContext }
  });
  vm.runInContext(block, context);

  context.renderAgendaContext();
  assert.equal(destino.disabled, false);
  assert.equal(destino.classList.values.has('auto-fill'), false);

  context.state.registro.idAgenda = 'EVT-1';
  context.renderAgendaContext();
  assert.equal(destino.disabled, true);
  assert.equal(destino.classList.values.has('auto-fill'), true);
  assert.match(destino.title, /agendamento de origem/);
  assert.match(client, /select\.auto-fill:disabled/);
});

test('participantes do Transporte sao exibidos em ordem alfabetica pt-BR', () => {
  const source = readProjectFile('TransporteApp.html');
  const block = sourceBetween(source, 'function sortRowsByText(', 'function fillSelectRows(');
  const context = vm.createContext({});
  vm.runInContext(block, context);

  const original = [
    { nome: 'Zelia' },
    { nome: 'ana' },
    { nome: 'Álvaro' },
    { nome: 'Bruno 10' },
    { nome: 'Bruno 2' }
  ];
  const ordenados = context.sortRowsByText(original, 'nome').map((item) => item.nome);

  assert.deepEqual(Array.from(ordenados), ['Álvaro', 'ana', 'Bruno 2', 'Bruno 10', 'Zelia']);
  assert.deepEqual(original.map((item) => item.nome), ['Zelia', 'ana', 'Álvaro', 'Bruno 10', 'Bruno 2']);
  assert.match(source, /fillSelectRows\('paciente', sortRowsByText\(state\.options\.participantes, 'nome'\)/);
  assert.match(source, /fillSelectRows\('paciente', sortRowsByText\(o\.participantes \|\| \[\], 'nome'\)/);
});

test('Transporte exige e exibe o numero de identificacao vindo da coluna E de Participantes', () => {
  const client = readProjectFile('TransporteApp.html');
  const server = readProjectFile('TransporteCodexConfig.gs');
  const webApp = readProjectFile('WebApp.gs');

  assert.match(client, /loadParticipantsOptions\(\);[\s\S]*if \(!opts\.skipCe\)/);
  assert.match(client, /participantesLoaded\) return idCadastro/);
  assert.match(webApp, /idParticipante:\s*String\(r\[4\] \|\| ''\)/);
  assert.match(server, /idParticipante: String\(p\.idParticipante \|\| p\.numId \|\| ''\)\.trim\(\)/);
  assert.match(client, /id="identificacaoParticipante"[^>]*readonly/);
  assert.match(client, /id="identificacaoParticipante"[^>]*placeholder="Preenchido pelo participante"/);
  assert.match(client, /form-grid study-grid/);
  assert.match(client, /\.form-grid\.study-grid\s*\{[^}]*grid-template-columns:minmax\(0,1\.2fr\) minmax\(180px,\.8fr\) minmax\(0,1\.2fr\)/);
  assert.match(client, /@media \(max-width:680px\)[\s\S]*\.form-grid\.study-grid\s*\{\s*grid-template-columns:1fr/);
  assert.match(client, /info\.idParticipante \|\| info\.numId/);
  assert.match(client, /out\.push\('Nº de Identificação do paciente'\)/);
  assert.match(server, /missing\.push\('Numero de Identificacao do paciente na coluna E da aba Participantes'\)/);
});

test('campo de identificacao usa o ID do participante selecionado sem confundir nomes divergentes', () => {
  const client = readProjectFile('TransporteApp.html');
  const block = sourceBetween(client, 'function selectedParticipantInfo(', 'function projectDisplay(');
  const patientField = { value: 'Filipe Muneron da Silva' };
  const idField = { value: '' };
  const context = vm.createContext({
    state: {
      registro: { paciente: 'Filipe Mumeron da Silva' },
      options: {
        participantesLoaded: true,
        participantes: [{ nome: 'Filipe Muneron da Silva', idParticipante: '2011250001' }]
      }
    },
    norm: (value) => String(value || '').trim().toLowerCase(),
    document: {
      getElementById: (id) => id === 'paciente' ? patientField : idField
    },
    renderDerived: () => {},
    loadCeStatus: () => {},
    projectDisplay: (value) => value
  });
  vm.runInContext(block, context);

  assert.equal(context.selectedParticipantIdentification(), '2011250001');
  patientField.value = 'Filipe Mumeron da Silva';
  assert.equal(context.selectedParticipantIdentification(), '');
});

test('opcoes de participantes do Transporte nao reutilizam cadastro em cache', () => {
  const server = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(server, 'function transporteReadParticipantesOptions_(', 'function getTransporteParticipantesOptions()');

  assert.doesNotMatch(block, /transporteReadCachedJson_/);
  assert.doesNotMatch(block, /transporteWriteCachedJson_/);
  assert.match(block, /transporteReadParticipantesDireto_\(\)/);
});

test('Transporte busca ID na coluna e le somente uma linha completa da Agenda', () => {
  const calls = [];
  const rows = [
    ['EVT-1', 'primeiro'],
    ['EVT-2', 'segundo']
  ];
  const sheet = {
    getLastRow: () => 3,
    getRange(row, column, numRows = 1, numColumns = 1) {
      calls.push({ row, column, numRows, numColumns });
      const values = rows.slice(row - 2, row - 2 + numRows)
        .map((source) => Array.from({ length: numColumns }, (_, index) => source[column - 1 + index] || ''));
      return { getValues: () => values };
    }
  };
  const server = runFile('TransporteCodexConfig.gs', {
    Logger: { log: () => {} },
    AGENDA_CFG: { lastCol: 51, idx: { id: 0 }, col: { id: 1 } },
    getAgendaSheet_: () => sheet,
    encontrarLinhaPorId: (agenda, id) => {
      const ids = agenda.getRange(2, 1, agenda.getLastRow() - 1, 1).getValues();
      const offset = ids.findIndex((row) => String(row[0]) === String(id));
      return offset >= 0 ? offset + 2 : null;
    },
    agendaRowToObject_: (row, rowIndex) => ({ id: row[0], rowIndex })
  });

  assert.equal(server.buscarAgendaEventoPorIdTransp_('EVT-2').id, 'EVT-2');
  assert.equal(calls.filter((call) => call.numColumns === 1 && call.numRows === 2).length, 1);
  assert.equal(calls.filter((call) => call.numColumns === 51 && call.numRows === 1).length, 1);
  calls.length = 0;
  assert.throws(() => server.buscarAgendaEventoPorIdTransp_('INEXISTENTE'), /nao encontrado/);
  assert.equal(calls.filter((call) => call.numColumns === 51).length, 0);
});

test('bootstrap vindo da Agenda importa e rele o mesmo slot sob um unico lock', () => {
  const server = runFile('TransporteCodexConfig.gs', {
    Logger: { log: () => {} },
    normText_: (value) => String(value || '').trim().toLowerCase()
  });
  let agendaReads = 0;
  let lockDepth = 0;
  const steps = [];
  const evento = { id: 'EVT-1', participante: 'Participante', projeto: 'Projeto' };
  server.codexAssertCanWrite_ = () => {};
  server.SpreadsheetApp = { flush: () => {
    assert.equal(lockDepth, 1);
    steps.push('flush');
  } };
  server.codexWithDocumentLock_ = (label, fn) => {
    assert.equal(label, 'getTransporteBootstrapFromAgenda');
    assert.equal(lockDepth, 0);
    lockDepth += 1;
    try {
      return fn();
    } finally {
      lockDepth -= 1;
    }
  };
  server.buscarAgendaEventoPorIdTransp_ = () => { agendaReads += 1; return evento; };
  server.montarPayloadTransporteParaTransp_ = (id, slot, received) => {
    assert.equal(lockDepth, 1);
    assert.equal(received, evento);
    return { idAgenda: id, slot, refInterna: `AGD-${id}` };
  };
  server.importarTransporteCodexInterno_ = (payload, context) => {
    assert.equal(lockDepth, 1);
    assert.equal(context.evento, evento);
    steps.push('import');
    return { rascunho: true };
  };
  server.transporteBuildBootstrap_ = (received) => {
    assert.equal(lockDepth, 1);
    assert.equal(received, evento);
    steps.push('read');
    return { registro: {} };
  };

  const data = server.getTransporteBootstrapFromAgenda('EVT-1', '2');
  assert.equal(agendaReads, 1);
  assert.deepEqual(steps, ['import', 'flush', 'read']);
  assert.equal(lockDepth, 0);
  assert.equal(data.registro.idAgenda, 'EVT-1');
  assert.equal(data.registro.agendaSlot, '2');
});

test('bootstrap comum nao le a planilha durante outra gravacao de Transporte', () => {
  const server = runFile('TransporteCodexConfig.gs', {
    Logger: { log: () => {} }
  });
  let lockDepth = 0;
  server.codexWithDocumentLock_ = (label, fn) => {
    assert.equal(label, 'getTransporteBootstrap');
    lockDepth += 1;
    try {
      return fn();
    } finally {
      lockDepth -= 1;
    }
  };
  server.transporteBuildBootstrap_ = () => {
    assert.equal(lockDepth, 1);
    return { registro: { materiais: [] } };
  };

  const data = server.getTransporteBootstrap();
  assert.deepEqual(data.registro.materiais, []);
  assert.equal(lockDepth, 0);
});

test('peticao identifica apenas linhas com material e limpa identificacao do envio anterior', () => {
  const server = runFile('TransporteCodexConfig.gs', { Logger: { log: () => {} } });
  const cells = {};
  const peticao = {
    getRangeList: () => ({ setValue() {} }),
    getRange: (a1) => ({
      setValue(value) { cells[a1] = value; },
      setValues(values) { cells[a1] = Array.from(values, (row) => row[0]); }
    })
  };
  server.transporteGetSheet_ = () => peticao;
  server.codexMatBioUnit_ = () => 'mL';
  const materiais = [
    { ativo: true, material: 'Sangue', total: 4, ensaio: 'Quantiferon gold' },
    { ativo: true, material: 'Soro', total: 2.5, ensaio: 'hsCRP 10292' },
    { ativo: true, material: 'Urina', total: 7, ensaio: 'Urinalise' },
    { ativo: true, material: 'Plasma', total: 1, ensaio: 'Plasma' },
    { ativo: true, material: 'Saliva', total: 1, ensaio: 'Saliva' },
    { ativo: true, material: 'Fezes', total: 10, unit: 'g', ensaio: 'Fezes' }
  ];
  function preencher(items, iniciais = 'D.S.', identificacaoParticipante = '10325') {
    server.preencherPeticaoAnuenciaWebApp_({}, {
      temperatura: 'AMBIENTE', iniciais, identificacaoParticipante, materiais: items
    });
  }
  // Mesma planilha: seis materiais, depois dois, um e nenhum.
  for (const quantidade of [6, 2, 1, 0]) {
    preencher(materiais.slice(0, quantidade));
    assert.deepEqual(cells['B30:B35'], Array.from({ length: 6 }, (_, i) => i < quantidade ? 'D.S.' : ''));
    assert.deepEqual(cells['G30:G35'], Array.from({ length: 6 }, (_, i) => i < quantidade ? '10325' : ''));
    assert.equal(cells['K30:K35'].filter(Boolean).length, quantidade);
    assert.equal(cells['P30:P35'].filter(Boolean).length, quantidade);
    if (quantidade === 2) {
      assert.deepEqual(cells['K30:K35'], ['Sangue: 4,00 mL', 'Soro: 2,50 mL', '', '', '', '']);
      assert.deepEqual(cells['P30:P35'], ['Quantiferon gold', 'hsCRP 10292', '', '', '', '']);
    }
  }
  preencher([{ ...materiais[0], ativo: false }]);
  assert.deepEqual(cells['B30:B35'], ['', '', '', '', '', '']);
  assert.deepEqual(cells['G30:G35'], ['', '', '', '', '', '']);
  const laminas = { ativo: true, material: 'Outro', formula: '2 laminas', ensaio: 'Hematologia' };
  for (const items of [[laminas], [materiais[0], laminas]]) {
    preencher(items, 'A.B.', 'TESTE-2');
    assert.deepEqual(cells['B30:B35'], ['A.B.', '', '', '', '', '']);
    assert.deepEqual(cells['G30:G35'], ['TESTE-2', '', '', '', '', '']);
    assert.equal(cells['K30:K35'].filter(Boolean).length, 1);
  }
});

test('bloqueio do PDF rejeita ensaio de outro slot antes da exportacao', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'function transportePdfManifestText_(',
    'function gerarPdfTransporte('
  );
  const payload = {
    idAgenda: 'EVT-1',
    agendaSlot: '1',
    courier: 'OCASA',
    temperatura: 'AMBIENTE',
    destino: 'DASA (BARUERI)',
    materiais: [
      { ativo: true, material: 'Sangue', ensaio: 'Hematologia' },
      { ativo: true, material: 'Soro', ensaio: 'Bioquimica' },
      { ativo: true, material: 'Urina', ensaio: 'Urinalise' }
    ]
  };
  let ensaiosPlanilha = [['Hematologia'], ['Bioquimica'], ['Urinalise'], [''], [''], ['']];
  const peticao = {
    getRange: (a1) => ({
      getValues: () => a1 === 'K30:K35'
        ? [['Sangue'], ['Soro'], ['Urina'], [''], [''], ['']]
        : ensaiosPlanilha
    })
  };
  const context = vm.createContext({
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm, text) => [String(text).length % 256],
      base64EncodeWebSafe: (bytes) => `hash-${bytes[0]}`
    },
    transporteNorm_: (value) => String(value == null ? '' : value)
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    transporteNormalizeCourierFromCodex_: (value) => String(value || '').trim().toUpperCase(),
    transporteNormalizeTemperaturaFromCodex_: (value) => String(value || '').trim().toUpperCase(),
    normalizarSlotTransporteCodex_: (value) => String(value || ''),
    transporteAgendaLinkFromRef_: () => ({ idAgenda: '', agendaSlot: '' }),
    transportePeticaoMaterialRows_: (materiais) => {
      const rows = materiais.map((item) => [item.material, item.ensaio]);
      while (rows.length < 6) rows.push(['', '']);
      return rows;
    },
    getTransporteSpreadsheetCodex_: () => ({}),
    transporteReadRegistro_: () => ({
      idAgenda: 'EVT-1', agendaSlot: '1', courier: 'OCASA',
      temperatura: 'AMBIENTE', destino: 'DASA (BARUERI)'
    }),
    transporteGetSheet_: () => peticao
  });
  vm.runInContext(block, context);

  const ok = context.transporteValidarManifestoPdf_({ payload });
  assert.match(ok.hash, /^hash-/);
  assert.throws(
    () => context.transporteValidarManifestoPdf_({}),
    /vinculado a Agenda.*Nenhum PDF foi gerado/
  );

  ensaiosPlanilha = [['Paxgene'], ['HIV/LTS ser'], ['LTESHBV/HCV/HIV'], [''], [''], ['']];
  assert.throws(
    () => context.transporteValidarManifestoPdf_({ payload }),
    /Bloqueio de seguranca do PDF:.*materiais e ensaios.*Nenhum PDF foi gerado/
  );
});

test('atualizacao do Transporte usa evento fornecido e preserva fallback de busca', () => {
  const server = runFile('TransporteCodexConfig.gs', { Logger: { log: () => {} } });
  let agendaReads = 0;
  const evento = { participante: 'Nome', idParticipante: 'P-1', projeto: 'Projeto', medico: 'Medico' };
  server.buscarAgendaEventoPorIdTransp_ = () => { agendaReads += 1; return evento; };
  server.transporteReadParticipantesDireto_ = () => [];
  server.transporteEncontrarParticipante_ = () => null;
  server.transporteInvestigadorPorProjeto_ = () => 'Medico';
  server.transporteProjetoDisplay_ = (value) => value;

  server.transporteAtualizarRegistroPorAgenda_({ idAgenda: 'EVT-1', materiais: [] }, evento);
  assert.equal(agendaReads, 0);
  server.transporteAtualizarRegistroPorAgenda_({ idAgenda: 'EVT-1', materiais: [] });
  assert.equal(agendaReads, 1);
});

test('opcoes de projetos do Transporte usam leitura direta sem estatisticas da Agenda', () => {
  let getProjetosCalls = 0;
  const server = runFile('TransporteCodexConfig.gs', {
    Logger: { log: () => {} },
    getProjetos: () => { getProjetosCalls += 1; throw new Error('nao deve ser chamado'); },
    getCodexSheetDataByName_: (name) => {
      assert.equal(name, 'Projetos');
      return [
        ['ID', 'Nome', 'Codigo', '', '', 'Investigador', '', '', '', '', '', '', '', 'Status', 'Numero CE', 'Expediente CE', 'Titulo'],
        ['P2', 'Projeto B', 'B-2', '', '', 'Medico B', '', '', '', '', '', '', '', 'Ativo', 'CE-2', 'EXP-2', 'Titulo B'],
        ['P1', 'Projeto A', 'A-1', '', '', 'Medico A', '', '', '', '', '', '', '', 'Ativo', 'CE-1', 'EXP-1', 'Titulo A']
      ];
    }
  });

  const options = server.transporteReadProjetosOptions_();
  assert.equal(getProjetosCalls, 0);
  assert.deepEqual(Array.from(options, (item) => item.nomeAbreviado), ['Projeto B', 'Projeto A']);
  assert.deepEqual({ ...options[0] }, {
    nomeAbreviado: 'Projeto B',
    codigo: 'B-2',
    investigador: 'Medico B',
    numeroCE: 'CE-2',
    expedienteCE: 'EXP-2',
    tituloCompleto: 'Titulo B'
  });
});

test('Transporte le participantes sem calcular historico de visitas', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(source, 'function transporteReadParticipantesDireto_(', 'function transporteNomeDivergeUmCaractere_(');
  const context = vm.createContext({
    getCodexSheetDataByName_: () => [
      ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status'],
      ['81231558', 'Filipe Muneron da Silva', '', '', '2011250001', 'SKYLINE-UC', '', '', 'Ativo']
    ],
    getParticipantes: () => { throw new Error('listagem completa nao deve ser chamada'); }
  });
  vm.runInContext(block, context);

  const participantes = context.transporteReadParticipantesDireto_();
  assert.equal(participantes.length, 1);
  assert.equal(participantes[0].idParticipante, '2011250001');
  assert.equal(participantes[0].projeto, 'SKYLINE-UC');
});

test('geracao do PDF revalida a identificacao atual do participante', () => {
  const server = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(server, 'function imprimirTodasAbas(', 'function transporteOcasaNeedsProforma_(');

  assert.match(block, /payloadFallback = transporteDerivarDadosParticipante_\(options\.payload \|\| \{\}\)/);
  assert.match(block, /identificacaoParticipante: payloadFallback\.identificacaoParticipante \|\| payloadFallback\.idParticipante \|\| ''/);
});

test('PDF de Transporte usa margens laterais de 0.25 polegada e ajuste a largura', () => {
  const server = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(server, 'function imprimirTodasAbas(', 'function transporteOcasaNeedsProforma_(');

  assert.match(block, /'fitw=true'/);
  assert.match(block, /'left_margin=0\.25'/);
  assert.match(block, /'right_margin=0\.25'/);
});

test('PINEX preenche resumo de paciente, tipo, tubos e volume antes do PDF', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const summary = sourceBetween(source, 'function transportePinexSampleSummary_(', 'function atualizarCommercialInvoicePinexB34_(');
  const context = vm.createContext({
    extrairIniciais_: (value) => String(value || '').split(/\s+/).filter(Boolean).map((part) => part[0] + '.').join('').toUpperCase(),
    transporteNumber_: (value) => Number(String(value == null || value === '' ? 0 : value).replace(',', '.')) || 0,
    transporteNorm_: (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  });
  vm.runInContext(summary, context);

  const result = context.transportePinexSampleSummary_(
    'Maria Silva Souza',
    [[false], [true], [false], [false], [false], [false], [false], [false]],
    [[0], [2], [0], [0], [0], [0], [0], [0]],
    [[0], [1.6], [0], [0], [0], [0], [0], [0]],
    ''
  );
  assert.equal(result, 'Patient M.S.S. - 2 tube(s) of human bio sample - Total 1.60 mL / 0 slide(s) / 0 g');
});

test('PINEX identifica o investigador principal e inclui o CREMERS', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const summary = sourceBetween(source, 'function transportePinexInvestigatorSummary_(', 'function atualizarCommercialInvoicePinexB34_(');
  const invoiceUpdate = sourceBetween(source, 'function atualizarCommercialInvoicePinexB34_(', 'function atualizarCommercialInvoicePinexTemperatura_(');
  const context = vm.createContext({});
  vm.runInContext(summary, context);

  assert.equal(
    context.transportePinexInvestigatorSummary_('Catarine Silva Medeiros', '33123'),
    'Investigador Principal: Dr(a). Catarine Silva Medeiros - CREMERS: 33123.'
  );
  assert.equal(
    context.transportePinexInvestigatorSummary_('Dr(a). Catarine Silva Medeiros', 'CRM/RS 33123'),
    'Investigador Principal: Dr(a). Catarine Silva Medeiros - CREMERS: 33123.'
  );
  assert.match(invoiceUpdate, /transporteMedicoByNome_\(investigador\)/);
  assert.match(invoiceUpdate, /transportePinexInvestigatorSummary_\(/);
});

test('cadastro do investigador PINEX aceita nome com ou sem titulo medico', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const keyHelper = sourceBetween(source, 'function transporteMedicoNomeKey_(', 'function transporteMedicoByNome_(');
  const context = vm.createContext({
    transporteNorm_: (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  });
  vm.runInContext(keyHelper, context);

  assert.equal(context.transporteMedicoNomeKey_('Catarine Silva Medeiros'), 'catarine silva medeiros');
  assert.equal(context.transporteMedicoNomeKey_('Dra. Catarine Silva Medeiros'), 'catarine silva medeiros');
  assert.equal(context.transporteMedicoNomeKey_('Dr(a). Catarine Silva Medeiros'), 'catarine silva medeiros');
});

test('PINEX atualiza o investigador novamente depois de preencher o cadastro medico', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const save = sourceBetween(source, 'function salvarTransporte(', 'function transporteSetEnsaiosPeticao_(');
  const sync = sourceBetween(source, 'function transporteSincronizarDependencias_(', 'function sincronizarTransporte(');
  const pdf = sourceBetween(source, 'function imprimirTodasAbas(', 'function transportePdfSpec_(');

  [save, sync, pdf].forEach((block) => {
    assert.match(block, /transportePreencherDeclaracaoCadastros_\([\s\S]*atualizarCommercialInvoicePinexB34_\(/);
  });
});

test('contato de emergencia da PINEX nao vaza para as demais couriers', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'var TRANSPORTE_CONTATO_EMERGENCIA_PINEX_',
    'function imprimirTodasAbas('
  );
  let writtenContact = '';
  const contactCell = {
    isPartOfMerge: () => false,
    setValue: (value) => { writtenContact = value; }
  };
  const contactSheet = {
    getSheetId: () => 123,
    getDataRange: () => ({
      getDisplayValues: () => [['telefone de emergencia: 55 11 97095-3241 - Thais']],
      getCell: () => contactCell
    })
  };
  const context = vm.createContext({
    Logger: { log: () => {} },
    transporteCodexGetSheet_: () => contactSheet,
    transporteNormalizeCourierFromCodex_: (courier) => String(courier || '').trim().toUpperCase()
  });
  vm.runInContext(block, context);

  assert.equal(
    context.transporteContatoEmergenciaTexto_('Pinex'),
    'telefone de emerg\u00eancia (24H): 55 11 97095-3241 - thais thabata leite lopes'
  );
  assert.equal(
    context.transporteContatoEmergenciaTexto_('MARKEN'),
    'Telefone de Emerg\u00eancia (24H): +55 54 99909-1656'
  );
  assert.equal(
    context.transporteContatoEmergenciaTexto_('OCASA'),
    'Telefone de Emerg\u00eancia (24H): +55 54 99909-1656'
  );
  assert.equal(
    context.transporteContatoEmergenciaTexto_('DHL'),
    'Telefone de Emerg\u00eancia (24H): +55 54 99909-1656'
  );
  assert.equal(context.transporteAplicarContatoEmergenciaPdf_({}, 'MARKEN', { ordem: ['doc'] }), 1);
  assert.equal(writtenContact, 'Telefone de Emerg\u00eancia (24H): +55 54 99909-1656');
  assert.match(source, /transporteAplicarContatoEmergenciaPdf_\(workingSS, courier, spec\)/);
});

test('automacao PINEX atualiza os dados completos da Commercial Invoice', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const automation = sourceBetween(source, 'function transporteAplicarAutomacoesTemperatura_(', 'function montarPayloadTransporteCodex(');
  assert.match(automation, /if \(courier === 'PINEX'\)[\s\S]*atualizarCommercialInvoicePinex_\(ss\)/);
  assert.match(automation, /if \(courier === 'PINEX'\)[\s\S]*atualizarCommercialInvoicePinexB33_\(ss\)/);
  assert.match(automation, /if \(courier === 'PINEX'\)[\s\S]*atualizarCommercialInvoicePinexB34_\(ss\)/);
});

test('salvamento definitivo exige os dados criticos de Transporte', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(source, 'function transporteValidarObrigatoriosWebApp_(', 'function transporteValidarDataEnvioMinima_(');
  const context = vm.createContext({
    transporteLabCentralByDestino_: (destino) => destino === 'Lab Central Teste' ? { nome: destino } : null,
    transporteMedicoByNome_: (nome) => nome === 'Investigador com CREMERS'
      ? { nome, cremers: '12345' }
      : { nome, cremers: '' }
  });
  vm.runInContext(block, context);

  assert.throws(() => context.transporteValidarObrigatoriosWebApp_({}), /Paciente.*Protocolo.*Investigador.*Laboratorio de destino/);
  assert.throws(() => context.transporteValidarObrigatoriosWebApp_({
    paciente: 'Participante sem identificacao',
    protocolo: 'Projeto Teste',
    investigador: 'Investigador Teste',
    destino: 'Lab Central Teste',
    temperatura: 'CONGELADO',
    courier: 'DHL',
    horaEnvio: '08:00-12:00',
    agendadoPor: 'Usuario Teste',
    dataEnvio: '2026-07-20'
  }), /Numero de Identificacao do paciente na coluna E da aba Participantes/);
  assert.doesNotThrow(() => context.transporteValidarObrigatoriosWebApp_({
    paciente: 'Participante Teste',
    identificacaoParticipante: 'P-001',
    protocolo: 'Projeto Teste',
    investigador: 'Investigador Teste',
    destino: 'Lab Central Teste',
    temperatura: 'CONGELADO',
    courier: 'DHL',
    horaEnvio: '08:00-12:00',
    agendadoPor: 'Usuario Teste',
    dataEnvio: '2026-07-20'
  }));
  assert.throws(() => context.transporteValidarObrigatoriosWebApp_({
    paciente: 'Participante Teste', identificacaoParticipante: 'P-001', protocolo: 'Projeto Teste', investigador: 'Investigador Teste',
    destino: 'Lab inexistente', temperatura: 'AMBIENTE', courier: 'DHL',
    horaEnvio: '08:00-12:00', agendadoPor: 'Usuario Teste', dataEnvio: '2026-07-20'
  }), /nao encontrado no cadastro LabCentral/);
  assert.throws(() => context.transporteValidarObrigatoriosWebApp_({
    paciente: 'Participante Teste', identificacaoParticipante: 'P-001', protocolo: 'Projeto Teste', investigador: 'Investigador sem CREMERS',
    destino: 'Lab Central Teste', temperatura: 'CONGELADO', courier: 'PINEX',
    horaEnvio: '08:00-12:00', agendadoPor: 'Usuario Teste', dataEnvio: '2026-07-20', awb: '12345678'
  }), /CREMERS do Investigador Principal/);
  assert.doesNotThrow(() => context.transporteValidarObrigatoriosWebApp_({
    paciente: 'Participante Teste', identificacaoParticipante: 'P-001', protocolo: 'Projeto Teste', investigador: 'Investigador com CREMERS',
    destino: 'Lab Central Teste', temperatura: 'CONGELADO', courier: 'PINEX',
    horaEnvio: '08:00-12:00', agendadoPor: 'Usuario Teste', dataEnvio: '2026-07-20', awb: '12345678'
  }));
});

test('AWB existente na Agenda nunca e sobrescrita automaticamente', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const sync = sourceBetween(source, 'function transporteSincronizarAgenda_(', 'function importarTransporteCodex(');
  assert.match(sync, /if \(!awbAnterior\)/);
  assert.match(sync, /awbAnteriorNorm !== awbNovaNorm/);
  assert.match(sync, /nao foi sobrescrita automaticamente/);
});

test('data de envio anterior a hoje e rejeitada antes da documentacao', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(source, 'function transporteValidarDataEnvioMinima_(', 'function transporteSetValueIfAllowed_(');
  const context = vm.createContext({
    Date,
    transporteParseDate_: (value) => new Date(value)
  });
  vm.runInContext(block, context);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  assert.throws(() => context.transporteValidarDataEnvioMinima_(yesterday), /igual ou posterior/);
  assert.doesNotThrow(() => context.transporteValidarDataEnvioMinima_(today));
  assert.doesNotThrow(() => context.transporteValidarDataEnvioMinima_(tomorrow));
});
