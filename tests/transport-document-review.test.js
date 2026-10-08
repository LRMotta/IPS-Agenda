'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');

function server(extra = {}) {
  return runFile('TransporteCodexConfig.gs', {
    Logger: { log() {} },
    normText_: value => String(value || '').trim().toLowerCase(),
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url')
    },
    ...extra
  });
}

test('hash do documento detecta quantidade, precisao, datas, observacao e responsavel DHL/PINEX', () => {
  const s = server();
  const registro = { dataEnvio: '2026-10-08', dataColeta: '2026-10-07', pinexAgendadoPor: 'Equipe A',
    materiais: [{ ativo: true, material: 'Soro', tubos: 1, total: 0.001, formula: '1x0,001', unit: 'L' }] };
  const original = s.transportePdfDocumentoHash_({}, registro);
  for (const change of [
    { pinexAgendadoPor: 'Equipe B' }, { dataEnvio: '2026-10-09' }, { observacoes: 'Nova observacao' },
    { materiais: [{ ...registro.materiais[0], tubos: 2 }] },
    { materiais: [{ ...registro.materiais[0], total: 0.001001 }] }
  ]) assert.notEqual(s.transportePdfDocumentoHash_({}, { ...registro, ...change }), original);
  assert.equal(s.transportePdfDocumentoHash_({}, registro), original);
});

function automation(s, values) {
  const writes = {};
  const folha = {};
  const document = { getRange: address => ({ setValue: value => { writes[address] = value; } }) };
  s.transporteCodexGetSheet_ = (_ss, key) => key === 'folhaAgendamento' ? folha : document;
  s.getCellValueSafe = (_sheet, cell) => values[cell] || '';
  return writes;
}

test('defaults e configuracoes de gelo/peso usam a mesma matriz nas duas funcoes legadas', () => {
  const cases = [
    ['MARKEN', 'CONGELADO', 'EUROFINS (LANCASTER)', 10], ['PINEX', 'CONGELADO', '', 2],
    ['PINEX (Agendamento)', 'AMBIENTE + CONGELADO', '', 2], ['OCASA', 'CONGELADO', '', 4],
    ['MARKEN', 'AMBIENTE', '', '---']
  ];
  for (const [courier, temp, lab, expected] of cases) {
    const s = server();
    const writes = automation(s, { C10: courier, C6: temp, C11: lab });
    s.verificarEAtualizarG33Declaracao_({});
    assert.equal(writes.G33, expected);
    s.atualizarPesoGeloDeclaracao_({});
    assert.equal(writes.G33, expected);
  }
  const s = server({ getConfigAppValuesByKeys_: (_groups, keys) => ({ 'Gelo MARKEN EUROFINS (kg)': ['12,5'], 'Peso MARKEN ambiente (kg)': ['3'] })[keys[0]] || [] });
  const values = { C10: 'MARKEN', C6: 'CONGELADO', C11: 'EUROFINS (LANCASTER)' };
  const writes = automation(s, values);
  s.atualizarPesoGeloDeclaracao_({});
  assert.equal(writes.G33, 12.5);
  values.C6 = 'AMBIENTE';
  s.atualizarMarkenVolumes_({});
  assert.equal(writes.T41, '3 Kg');
});

test('contatos e CNPJ configurados conservam fallback e HTML escapado', () => {
  const s = server({ getConfigAppValuesByKeys_: (_groups, keys) => ({
    'Contato de emergência centro': ['Centro <teste>'], 'Contato de emergência PINEX': ['PINEX <teste>'],
    'CNPJ do centro': ['12.345.678/0001-90']
  })[keys[0]] || [] });
  assert.equal(s.transporteContatoEmergenciaTexto_('DHL'), 'Centro <teste>');
  assert.equal(s.transporteContatoEmergenciaTexto_('PINEX'), 'PINEX <teste>');
  assert.match(s.transporteCodexEmailFallbackHtml_('Estudo', '', '', '', 'MARKEN', ''), /12\.345\.678\/0001-90/);
  const invalid = server({ getConfigAppValuesByKeys_: () => ['=1+1'] });
  invalid.TRANSPORTE_GENERATION_WARNINGS_ = [];
  assert.equal(invalid.transporteCnpjTexto_(), '88.648.761/0001-03');
  assert.equal(invalid.transporteConfigNumber_('peso', 4), 4);
  assert.equal(invalid.TRANSPORTE_GENERATION_WARNINGS_.length, 2);
});

test('avisos de automacao chegam ao resultado sem PII e sao limpos antes da geracao seguinte', () => {
  let locked = false;
  let flushes = 0;
  const s = server({
    codexWithDocumentLock_: (_name, callback) => { locked = true; try { return callback(); } finally { locked = false; } },
    SpreadsheetApp: { flush() { assert.equal(locked, true); flushes++; } },
    codexAssertCanWrite_: () => ({ userEmail: 'teste@example.invalid' })
  });
  s.gerarPdfTransporteInterno_ = () => {
    s.transporteCodexGetSheet_ = () => { throw new Error('Falha com Pessoa Teste Sensivel'); };
    s.atualizarPesoGeloDeclaracao_({});
    return { ok: true, type: 'pdf', message: 'PDF gerado.' };
  };
  const first = s.gerarPdfTransporte({});
  assert.equal(first.warnings.length, 1);
  assert.match(first.message, /peso do gelo seco/);
  assert.doesNotMatch(JSON.stringify(first), /Pessoa Teste Sensivel/);
  assert.equal(s.TRANSPORTE_GENERATION_WARNINGS_, null);
  s.gerarPdfTransporteInterno_ = () => ({ ok: true, message: 'PDF gerado.' });
  assert.equal(s.gerarPdfTransporte({}).warnings.length, 0);
  assert.equal(flushes, 2);
});

function pdfFixture({ nominal = false, extraViewer = false, notesFailure = false, content = 'Conteudo do documento' } = {}) {
  const events = [];
  const actor = { getEmail: () => 'executor@example.invalid' };
  const temporary = {
    getId: () => 'TEMP-ID', setSharing: () => events.push('private'), getOwner: () => actor,
    getSharingAccess: () => 'PRIVATE', getEditors: () => [],
    getViewers: () => extraViewer ? [{ getEmail: () => 'terceiro@example.invalid' }] : [],
    setTrashed: value => { assert.equal(value, true); events.push('trash'); }
  };
  const copy = { getSheets: () => [{ getName: () => 'PDF', isSheetHidden: () => false,
    clearNotes: () => { if (notesFailure) throw new Error('Falha ao limpar notas'); events.push('notes'); },
    getDataRange: () => ({ getDisplayValues: () => [[nominal ? 'Pessoa Teste da Silva' : 'P.T.S.', content]] }) }] };
  const blob = { getBytes: () => Array(1001).fill(0), setName(value) { this.name = value; }, getName() { return this.name; } };
  const output = { createFile: () => ({ getId: () => 'PDF-ID', getUrl: () => 'https://example.invalid/pdf' }), getName: () => 'Saida', getUrl: () => 'https://example.invalid/folder' };
  const root = {};
  const s = server({
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' }, getRootFolder: () => root,
      getFileById: () => ({ makeCopy: (name, folder) => { assert.equal(folder, root); assert.equal(name, 'IPS-TEMP-PDF-OPAQUE'); events.push('copy'); return temporary; } }) },
    SpreadsheetApp: { flush: () => events.push('flush') }, ScriptApp: { getOAuthToken: () => 'TEST-TOKEN' },
    UrlFetchApp: { fetch: () => { events.push('fetch'); return { getResponseCode: () => 200, getAllHeaders: () => ({ 'Content-Type': 'application/pdf' }), getBlob: () => blob }; } }
  });
  s.Utilities.getUuid = () => 'OPAQUE';
  s.Utilities.sleep = () => {};
  const payload = { paciente: 'Pessoa Teste da Silva', identificacaoParticipante: 'ID', protocolo: 'Estudo', courier: 'DHL' };
  const folha = { getRange: () => ({ getValues: () => [[payload.paciente], ['Estudo'], ['Investigador'], ['AMBIENTE'], [''], [''], [''], ['DHL'], ['Lab'], ['AWB'], ['Equipe'], ['']] }) };
  s.transporteDerivarDadosParticipante_ = () => payload;
  s.getTransporteSpreadsheetCodex_ = () => ({ getId: () => 'SOURCE' });
  s.transporteCodexGetSheet_ = (ss, key) => ss !== copy && key === 'folhaAgendamento' ? folha : null;
  s.transportePdfSpec_ = () => ({ ordem: ['PDF'] });
  s.transportePdfDestinationFolder_ = () => output;
  s.transportePdfOpenWorkingCopy_ = () => copy;
  s.transportePdfAnonimizarParticipante_ = () => events.push('anon');
  s.transporteShareGeneratedPdfWithActiveUser_ = () => ({});
  s.transporteCeStatus_ = () => ({ checked: true, found: false });
  for (const name of ['transporteValidarObrigatoriosWebApp_', 'transporteValidarDataEnvioMinima_', 'transporteAplicarAutomacoesTemperatura_', 'aplicarSolicitacaoCaixaTransporte_', 'transporteAplicarCourierConfig_', 'transportePreencherPeticaoMedico_', 'transportePreencherDeclaracaoCadastros_', 'preencherDadosProtocoloPeticaoWebApp_', 'preencherDhlWebApp_', 'transporteAjustarVolumesDeclaracao_', 'transportePdfPruneDuplicateAndOrder_', 'transporteAplicarContatoEmergenciaPdf_']) s[name] = () => {};
  s.transporteReadSolicitarCaixa_ = () => 'Sim';
  return { s, events };
}

test('PDF usa copia privada opaca, verifica conteudo antes de fetch e limpa em sucesso ou bloqueio', () => {
  for (const options of [{}, { nominal: true }, { extraViewer: true }, { notesFailure: true }]) {
    const { s, events } = pdfFixture(options);
    const result = s.imprimirTodasAbas({ payload: {} });
    if (options.nominal || options.extraViewer || options.notesFailure) {
      assert.match(result, /Erro ao gerar PDF/);
      assert.equal(events.includes('fetch'), false);
      assert.doesNotMatch(result, /Pessoa Teste da Silva|terceiro@example/);
    } else {
      assert.equal(result.ok, true);
      assert.equal(typeof result.conteudoPdfHash, 'string');
      assert.ok(events.indexOf('anon') < events.indexOf('fetch'));
      assert.ok(events.includes('notes'));
      assert.ok(events.indexOf('notes') < events.indexOf('fetch'));
    }
    assert.equal(events.at(-1), 'trash');
  }
});

test('hash do conteudo impresso muda com template e permanece igual para copia identica', () => {
  const first = pdfFixture().s.imprimirTodasAbas({ payload: {} }).conteudoPdfHash;
  assert.equal(pdfFixture().s.imprimirTodasAbas({ payload: {} }).conteudoPdfHash, first);
  assert.notEqual(pdfFixture({ content: 'Peso atualizado no modelo' }).s.imprimirTodasAbas({ payload: {} }).conteudoPdfHash, first);
});

test('geracao entrega ao rascunho e ao monitor o mesmo hash do documento exportado', () => {
  const s = server({ SpreadsheetApp: { flush() {} } });
  s.transporteValidarManifestoPdf_ = () => ({ hash: 'DADOS' });
  s.imprimirTodasAbas = () => ({ ok: true, courier: 'DHL', fileId: 'PDF', conteudoPdfHash: 'CONTEUDO' });
  s.transporteReadRegistro_ = () => ({ idAgenda: 'EVT', agendaSlot: '1' });
  let draftHash;
  let monitorHash;
  s.criarRascunhoTransporte_ = options => { draftHash = options.pdfHash; return { ok: true, message: 'Criado', draftId: 'DRAFT' }; };
  s.transporteRegistrarDocumentacaoGerada_ = info => { monitorHash = info.pdfHash; return { registrado: true }; };
  const result = s.gerarPdfTransporteInterno_({ requestedByEmail: 'teste@example.invalid' }, {});
  assert.ok(draftHash);
  assert.equal(draftHash, result.manifestoPdfHash);
  assert.equal(monitorHash, draftHash);
});


test('RPC de PDF converte erro legado do exportador em falha', () => {
  const s = server({ SpreadsheetApp: { flush() {} } });
  s.transporteValidarManifestoPdf_ = () => ({ hash: 'hash' });
  s.imprimirTodasAbas = () => 'Erro ao gerar PDF: PDF bloqueado: identificação nominal ainda presente';
  assert.throws(() => s.gerarPdfTransporteInterno_({}), /PDF bloqueado: identificação nominal/);
});


test('geracao salva uma vez e devolve avisos de sincronizacao da Agenda', () => {
  const s = server({ SpreadsheetApp: { flush() {} } });
  let saves = 0;
  s.salvarTransporteInterno_ = () => { saves++; return { agendaSync: { warnings: ['AWB diferente'] } }; };
  s.transporteValidarManifestoPdf_ = () => ({ hash: 'hash' });
  s.imprimirTodasAbas = () => ({ type: 'pdf', courier: 'PINEX', fileId: 'PDF' });
  s.transporteReadRegistro_ = () => ({});
  s.transporteMonitorReferencia_ = () => '';
  const result = s.gerarPdfTransporteInterno_({ payload: {} });
  assert.equal(saves, 1);
  assert.equal(result.agendaSync.warnings[0], 'AWB diferente');
});


test('exportador confirma ID antes de compartilhamento e conserva intencao quando checkpoint falha', () => {
  const { s } = pdfFixture();
  const phases = [];
  s.transporteGenerationCheckpoint_ = changes => { phases.push(changes.phase); };
  s.transporteShareGeneratedPdfWithActiveUser_ = () => { assert.deepEqual(phases, ['PDF_INTENT', 'PDF_READY']); throw new Error('share-failure'); };
  assert.match(s.imprimirTodasAbas({ payload: {} }), /share-failure/);
  const broken = pdfFixture().s;
  const persisted = [];
  broken.transporteGenerationCheckpoint_ = changes => { if (changes.phase === 'PDF_READY') throw new Error('quota'); persisted.push(changes.phase); };
  assert.match(broken.imprimirTodasAbas({ payload: {} }), /quota/);
  assert.deepEqual(persisted, ['PDF_INTENT']);
});
