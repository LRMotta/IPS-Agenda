'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runHtmlScript } = require('./helpers/load-app-script');

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

test('Transporte resolve participante pelo ID estavel mesmo com nome historico divergente', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'function transporteParticipantKey_(',
    'function transporteAgendadoresConfig_('
  );
  const context = vm.createContext({
    Logger: { log: () => {} },
    getParticipantes: () => [{
      id: '81231558',
      idParticipante: '2011250001',
      nome: 'Filipe Muneron da Silva',
      projeto: 'SKYLINE-UC'
    }],
    getProjetos: () => [{
      nomeAbreviado: 'SKYLINE-UC',
      codigo: 'SPY123-201',
      investigador: 'Eduardo Brambilla'
    }],
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

test('ficha vinculada atualiza protocolo e investigador atuais pelo idAgenda', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(
    source,
    'function transporteParticipantKey_(',
    'function transporteAgendadoresConfig_('
  );
  const context = vm.createContext({
    Logger: { log: () => {} },
    getParticipantes: () => [{
      idParticipante: '2011250001',
      nome: 'Filipe Muneron da Silva',
      projeto: 'SKYLINE-UC'
    }],
    getProjetos: () => [{
      nomeAbreviado: 'SKYLINE-UC',
      codigo: 'SPY123-201',
      investigador: 'Eduardo Brambilla'
    }],
    buscarAgendaEventoPorIdTransp_: (id) => {
      assert.equal(id, 'fc1ad99b');
      return {
        participante: 'Filipe Mumeron da Silva',
        idParticipante: '2011250001',
        projeto: 'SKYLINE-UC',
        medico: ''
      };
    }
  });
  vm.runInContext(block, context);

  const registro = context.transporteAtualizarRegistroPorAgenda_({
    idAgenda: 'fc1ad99b',
    paciente: 'Filipe Mumeron da Silva',
    protocolo: 'SPY',
    investigador: ''
  });
  assert.equal(registro.paciente, 'Filipe Muneron da Silva');
  assert.equal(registro.protocolo, 'SKYLINE-UC (SPY123-201)');
  assert.equal(registro.investigador, 'Eduardo Brambilla');
  assert.equal(registro.identificacaoParticipante, '2011250001');
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

test('checklist do Transporte exige o numero de identificacao cadastrado do participante', () => {
  const client = readProjectFile('TransporteApp.html');
  const server = readProjectFile('TransporteCodexConfig.gs');

  assert.match(client, /loadParticipantsOptions\(\);[\s\S]*if \(!opts\.skipCe\)/);
  assert.match(client, /participantesLoaded\) return idCadastro/);
  assert.match(client, /Nº de Identificação do paciente não preenchido no cadastro do participante\./);
  assert.match(client, /out\.push\('Nº de Identificação do paciente'\)/);
  assert.match(server, /missing\.push\('Numero de Identificacao do paciente no cadastro de Participantes'\)/);
});

test('opcoes de participantes do Transporte nao reutilizam cadastro em cache', () => {
  const server = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(server, 'function transporteReadParticipantesOptions_(', 'function getTransporteParticipantesOptions()');

  assert.doesNotMatch(block, /transporteReadCachedJson_/);
  assert.doesNotMatch(block, /transporteWriteCachedJson_/);
  assert.match(block, /getParticipantes\(\)/);
});

test('geracao do PDF revalida a identificacao atual do participante', () => {
  const server = readProjectFile('TransporteCodexConfig.gs');
  const block = sourceBetween(server, 'function imprimirTodasAbas(', 'function transporteOcasaNeedsProforma_(');

  assert.match(block, /payloadFallback = transporteDerivarDadosParticipante_\(options\.payload \|\| \{\}\)/);
  assert.match(block, /identificacaoParticipante: payloadFallback\.identificacaoParticipante \|\| payloadFallback\.idParticipante \|\| ''/);
});

test('PINEX preenche resumo de paciente, tipo, tubos e volume antes do PDF', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const summary = sourceBetween(source, 'function transportePinexSampleSummary_(', 'function atualizarCommercialInvoicePinexB34_(');
  const context = vm.createContext({
    transporteExtrairIniciais: (value) => String(value || '').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').toUpperCase(),
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
  assert.equal(result, 'Patient MSS - 2 tube(s) of human bio sample - Total 1.60 mL / 0 slide(s) / 0 g');
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
  }), /Numero de Identificacao do paciente no cadastro de Participantes/);
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
