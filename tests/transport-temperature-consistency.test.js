'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function fixture(extra = {}) {
  return runFile('TransporteCodexConfig.gs', {
    Logger: { log() {} }, normText_: value => String(value || '').trim().toLowerCase(),
    SpreadsheetApp: { flush() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      newBlob: value => ({ getBytes: () => Buffer.from(value) })
    }, ...extra
  });
}

function table(s, rows = [['Coleta', ''], ['Temperatura:', 'REFRIGERADO'], ['AWB', 'TESTE'], ['Enviar Caixa de Transporte', 'Não']]) {
  const matrix = value => rows.map(() => [value, value]);
  const range = {
    getDisplayValues: () => rows.map(row => row.slice()),
    getBackgrounds: () => matrix('#abcdef'), getFontColors: () => matrix('#000000'),
    getFontWeights: () => matrix('normal'), getHorizontalAlignments: () => matrix('left')
  };
  const sheet = { getRange: () => range };
  s.transporteCodexGetSheet_ = () => sheet;
  s.transporteCnpjTexto_ = () => '00.000.000/0000-00';
  return sheet;
}

test('MARKEN usa a temperatura da geracao em vez do valor exibido pelo modelo, preservando estilo e fonte', () => {
  for (const temperatura of ['AMBIENTE', 'REFRIGERADO', 'CONGELADO', 'AMBIENTE + CONGELADO', 'AMBIENTE + REFRIGERADO']) {
    const s = fixture();
    const rows = [['Coleta', ''], ['AWB', 'TESTE'], [' Temperatura: ', 'VALOR ANTIGO']];
    table(s, rows);
    const html = s.transporteCodexEmailHtml_({}, 'emailMarken', 'MARKEN', 'Bom dia', temperatura);
    assert.ok(html.includes('>' + temperatura + '</td>'));
    assert.doesNotMatch(html, /VALOR ANTIGO/);
    assert.match(html, /background:#abcdef/);
    assert.match(html, /colspan="2"/);
    assert.equal(rows[2][1], 'VALOR ANTIGO', 'nao escrever na matriz nem na formula do modelo');
  }
});

test('normalizacao conserva temperatura mista ambiente e refrigerado', () => {
  const s = fixture();
  assert.equal(s.transporteNormalizeTemperaturaFromCodex_('Ambiente + Refrigerado'), 'AMBIENTE + REFRIGERADO');
});

test('MARKEN bloqueia modelo ausente, linha ausente ou duplicada e temperatura nao confirmada', () => {
  const s = fixture();
  for (const rows of [[['Coleta', ''], ['AWB', 'TESTE']], [['Coleta', ''], ['Temperatura', 'AMBIENTE'], ['Temperatura:', 'REFRIGERADO']]]) {
    table(s, rows);
    assert.throws(() => s.transporteCodexEmailHtml_({}, 'emailMarken', 'MARKEN', 'Bom dia', 'AMBIENTE'), /temperatura/i);
  }
  table(s);
  assert.throws(() => s.transporteCodexEmailHtml_({}, 'emailMarken', 'MARKEN', 'Bom dia'), /temperatura/i);
  s.transporteCodexGetSheet_ = () => null;
  assert.throws(() => s.transporteCodexEmailHtml_({}, 'emailMarken', 'MARKEN', 'Bom dia', 'AMBIENTE'), /modelo/i);
  assert.equal(s.transporteCodexEmailHtml_({}, 'emailOcasa', 'OCASA', 'Bom dia'), '');
});

function draftFixture() {
  const s = fixture();
  const email = table(s);
  let source = 'AMBIENTE';
  const folha = { getRange: address => ({
    getValues: () => [['Estudo'], ['Medico'], [source], [''], [''], [''], ['MARKEN'], ['Lab'], ['AWB']],
    getDisplayValue: () => address === 'C6' ? source : ''
  }) };
  s.getTransporteSpreadsheetCodex_ = () => ({});
  s.transporteCodexGetSheet_ = (_ss, key) => key === 'folhaAgendamento' ? folha : email;
  s.transporteProjetoDisplay_ = value => value;
  s.transporteAssertGmailDraftAllowed_ = () => ({ ok: true, userEmail: 'teste@example.invalid', activeUserEmail: 'teste@example.invalid' });
  s.transporteEffectiveUserEmail_ = s.transporteActiveUserEmail_ = () => 'teste@example.invalid';
  s.transporteCodexSaudacao_ = () => 'Bom dia'; s.transporteCodexFormatDateTitle_ = () => '';
  s.transporteCourierEmailRecipients_ = () => ['courier@example.invalid'];
  s.transporteDraftCcRecipients_ = () => []; s.transporteCodexEmailAttachments_ = () => [];
  s.getGmailSignature = () => ''; s.transporteGmailAuthorizationUrl_ = () => '';
  const drafts = [], phases = [];
  s.GmailApp = { createDraft: (_to, _subject, _body, options) => { drafts.push(options); return { getId: () => 'DRAFT-2' }; } };
  s.transporteGenerationCheckpoint_ = changes => phases.push(changes);
  return { s, drafts, phases, changeSource: value => { source = value; } };
}

test('rascunho MARKEN corrige tabela antiga e registra temperatura do PDF com ID do rascunho', () => {
  const { s, drafts, phases } = draftFixture();
  s.TRANSPORTE_GENERATION_REQUEST_ = { record: {} };
  const result = s.criarRascunhoEmail_({ temperaturaPdf: 'AMBIENTE' });
  assert.equal(result.ok, true);
  assert.equal(result.temperaturaPdf, 'AMBIENTE');
  assert.equal(drafts.length, 1);
  assert.match(drafts[0].htmlBody, />AMBIENTE<\/td>/);
  assert.doesNotMatch(drafts[0].htmlBody, /REFRIGERADO/);
  assert.equal(phases.at(-1).draft.temperaturaPdf, 'AMBIENTE');
  assert.equal(phases.at(-1).draft.draftId, 'DRAFT-2');
});

test('temperatura divergente ou ausente bloqueia Gmail antes da intencao de criar o rascunho', () => {
  for (const momento of ['antes', 'depois', 'sem-snapshot']) {
    const { s, drafts, phases, changeSource } = draftFixture();
    if (momento === 'antes') changeSource('REFRIGERADO');
    if (momento === 'depois') s.transporteCodexEmailAttachments_ = () => { changeSource('REFRIGERADO'); return []; };
    const result = s.criarRascunhoEmail_(momento === 'sem-snapshot' ? {} : { temperaturaPdf: 'AMBIENTE' });
    assert.equal(result.ok, false, momento);
    assert.equal(result.error, 'TRANSPORT_TEMPERATURE_MISMATCH');
    assert.equal(result.authUrl, '');
    assert.equal(drafts.length, 0);
    assert.equal(phases.length, 0);
  }
});

function generationFixture() {
  const values = {}, pdfs = [], draftOptions = [], operations = [];
  let fail = '';
  const props = { getProperty: key => values[key] || null, getProperties: () => ({ ...values }), setProperty: (key, value) => { values[key] = value; } };
  const s = fixture({
    PropertiesService: { getUserProperties: () => props }, codexWithDocumentLock_: (_label, fn) => fn(),
    codexAssertCanWrite_: () => ({ userEmail: 'teste@example.invalid' })
  });
  s.salvarTransporteInterno_ = () => ({ agendaSync: {} });
  s.transporteValidarManifestoPdf_ = () => ({ hash: 'DADOS', manifesto: { temperatura: 'ambiente' } });
  s.transporteReadRegistro_ = () => ({ idAgenda: 'EVT', agendaSlot: '2' });
  s.getTransporteSpreadsheetCodex_ = () => ({}); s.transporteGenerationSourceHash_ = () => 'MODELO';
  s.imprimirTodasAbas_ = options => {
    pdfs.push(options);
    const pdf = { ok: true, type: 'pdf', courier: 'MARKEN', fileId: 'PDF-2', temperaturaPdf: options.temperaturaPdf };
    s.transporteGenerationCheckpoint_({ phase: 'PDF_READY', sourceHash: 'MODELO', sourceSheets: ['Modelo'], pdf });
    if (fail === 'PDF_READY') throw new Error('interrupcao');
    return pdf;
  };
  s.criarRascunhoTransporte_ = options => {
    draftOptions.push(options);
    s.transporteGenerationCheckpoint_({ phase: 'DRAFT_INTENT' });
    if (fail === 'DRAFT_INTENT') throw new Error('interrupcao');
    const draft = { ok: true, draftId: 'DRAFT-2', temperaturaPdf: options.temperaturaPdf };
    s.transporteGenerationCheckpoint_({ phase: 'DRAFT_READY', draft });
    if (fail === 'DRAFT_READY') throw new Error('interrupcao');
    return draft;
  };
  s.transporteRegistrarDocumentacaoGerada_ = info => { operations.push(info); return { registrado: true }; };
  const options = { generationRequestId: 'b'.repeat(32), payload: { idAgenda: 'EVT', agendaSlot: '2', temperatura: 'AMBIENTE', courier: 'MARKEN' } };
  return { s, values, pdfs, draftOptions, operations, options, request: () => s.gerarPdfTransporte(options), setFailure: value => { fail = value; } };
}

test('geracao do Transporte II passa o mesmo snapshot ao PDF, rascunho e registro de operacoes', () => {
  const f = generationFixture();
  const result = f.request();
  assert.equal(f.pdfs[0].temperaturaPdf, 'AMBIENTE');
  assert.equal(f.draftOptions[0].temperaturaPdf, 'AMBIENTE');
  assert.equal(f.operations[0].temperaturaPdf, 'AMBIENTE');
  assert.equal(f.operations[0].generationRequestId, f.options.generationRequestId);
  assert.equal(result.temperaturaPdf, 'AMBIENTE');
  assert.equal(result.generationRequestId, f.options.generationRequestId);
  assert.equal(f.options.temperaturaPdf, undefined, 'nao modificar opcoes do chamador');
  const record = Object.values(f.values).map(JSON.parse)[0];
  assert.equal(record.temperaturaPdf, 'AMBIENTE');
  assert.equal(record.result.temperaturaPdf, 'AMBIENTE');
  assert.equal(record.result.draftId, 'DRAFT-2');
});

test('recuperacoes conservam temperatura e IDs sem duplicar PDF ou rascunho', () => {
  for (const phase of ['PDF_READY', 'DRAFT_READY', 'DRAFT_INTENT', 'COMPLETE']) {
    const f = generationFixture();
    if (phase !== 'COMPLETE') { f.setFailure(phase); assert.throws(f.request, /interrupcao/); }
    else f.request();
    assert.equal(Object.values(f.values).map(JSON.parse)[0].temperaturaPdf, 'AMBIENTE');
    f.setFailure('');
    const result = f.request();
    assert.equal(result.temperaturaPdf, 'AMBIENTE', phase);
    assert.equal(result.fileId, 'PDF-2');
    assert.equal(f.pdfs.length, 1);
    assert.equal(f.draftOptions.length, 1);
    if (phase === 'DRAFT_INTENT') assert.equal(result.draftErrorCode, 'GENERATION_UNCERTAIN');
    else assert.equal(result.draftId, 'DRAFT-2');
  }
});

test('PDF recuperado com outra temperatura nao pode ser rotulado como a geracao atual', () => {
  const f = generationFixture();
  f.setFailure('PDF_READY'); assert.throws(f.request, /interrupcao/);
  const key = Object.keys(f.values)[0], record = JSON.parse(f.values[key]);
  record.pdf.temperaturaPdf = 'REFRIGERADO'; f.values[key] = JSON.stringify(record);
  f.setFailure('');
  assert.throws(f.request, /temperatura/i);
  assert.equal(f.draftOptions.length, 0);
});

test('schema legado e atual preservam dados e registram temperatura junto aos IDs sem inventar historico', () => {
  for (const columns of [16, 17, 18, 19]) {
    const s = fixture();
    const headers = Array.from(s.TRANSPORTE_OPERACOES_HEADERS_);
    assert.equal(headers[17], 'Temperatura_Geracao');
    assert.equal(headers[18], 'Geracao_ID');
    const sheet = new FakeSheet('Transporte_Operacoes', [headers.slice(0, columns), ['A', '2', 'IPS-TRP-A-T2', 'MARKEN', '', '', 'PDF-ANTIGO']]);
    const book = new FakeSpreadsheet({ Transporte_Operacoes: sheet });
    s.getCodexSpreadsheet_ = () => book;
    const legacy = s.transporteOperacoesRows_()[0];
    assert.equal(legacy.temperaturaPdf, ''); assert.equal(legacy.generationRequestId, '');
    assert.equal(sheet.writes, 0);
    s.transporteRegistrarDocumentacaoGerada_({ agendaId: 'A', slot: '2', courier: 'MARKEN', pdfId: 'PDF-2', rascunhoId: 'DRAFT-2', rascunhoOk: true, temperaturaPdf: 'AMBIENTE', generationRequestId: 'b'.repeat(32) });
    const operation = s.transporteOperacoesRows_()[0];
    assert.equal(operation.temperaturaPdf, 'AMBIENTE'); assert.equal(operation.pdfId, 'PDF-2');
    assert.equal(operation.rascunhoId, 'DRAFT-2'); assert.equal(operation.generationRequestId, 'b'.repeat(32));
    assert.deepEqual(sheet.rows[0], headers);
    assert.notEqual(s.transporteOperacaoVersion_(operation), s.transporteOperacaoVersion_({ ...operation, temperaturaPdf: 'REFRIGERADO' }));
  }
});

test('colisoes na cauda do schema impedem qualquer migracao ou sobrescrita parcial', () => {
  for (const column of [17, 18, 19]) {
    for (const hasHeader of [false, true]) {
      const s = fixture();
      const headers = Array.from(s.TRANSPORTE_OPERACOES_HEADERS_).slice(0, 16);
      const row = ['A', '2', 'IPS-TRP-A-T2'];
      if (hasHeader) headers[column - 1] = 'COLUNA EXISTENTE';
      else row[column - 1] = 'DADO EXISTENTE';
      const sheet = new FakeSheet('Transporte_Operacoes', [headers, row]);
      s.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Transporte_Operacoes: sheet });
      assert.throws(() => s.transporteRegistrarDocumentacaoGerada_({ agendaId: 'A', slot: '2', temperaturaPdf: 'AMBIENTE' }), /ocupada|sem cabeçalho/);
      assert.equal(sheet.writes, 0);
    }
  }
});


test('leitura ignora extensoes legadas sem cabecalho de temperatura ou de geracao', () => {
  const s = fixture();
  const headers = Array.from(s.TRANSPORTE_OPERACOES_HEADERS_).slice(0, 17);
  const row = ['A', '2', 'IPS-TRP-A-T2'];
  row[17] = 'DADO LEGADO'; row[18] = 'OUTRO DADO';
  const sheet = new FakeSheet('Transporte_Operacoes', [headers, row]);
  s.getCodexSpreadsheet_ = () => new FakeSpreadsheet({ Transporte_Operacoes: sheet });
  const operation = s.transporteOperacoesRows_()[0];
  assert.equal(operation.temperaturaPdf, ''); assert.equal(operation.generationRequestId, '');
  assert.equal(sheet.writes, 0);
});

test('bootstrap preserva a opcao mista somente para o transporte que ja a utiliza', () => {
  const s = fixture();
  const options = { temperaturas: ['AMBIENTE', 'REFRIGERADO'] };
  s.transporteReadOptions_ = () => ({ ...options });
  s.transporteValidate_ = () => []; s.transporteExecutionContext_ = () => ({});
  s.transporteGmailOAuthStatus_ = () => ({}); s.transporteDocumentosPorCourier_ = () => [];
  for (const temperatura of ['AMBIENTE + REFRIGERADO', 'AMBIENTE']) {
    const result = s.transporteBuildBootstrap_(null, { temperatura, materiais: [] });
    assert.equal(result.registro.temperatura, temperatura);
    assert.ok(result.options.temperaturas.includes(temperatura));
    assert.equal(result.options.temperaturas.includes('AMBIENTE + REFRIGERADO'), temperatura === 'AMBIENTE + REFRIGERADO');
  }
});

test('diagnostico de rascunho sem PDF valida snapshot preparado sob lock', () => {
  const s = fixture(); let locked = false;
  const payload = { courier: 'MARKEN', temperatura: 'AMBIENTE' };
  s.transporteSandboxPayload_ = () => payload; s.salvarTransporte = () => ({});
  s.codexWithDocumentLock_ = (_label, fn) => { locked = true; try { return fn(); } finally { locked = false; } };
  s.transporteValidarManifestoPdf_ = options => { assert.equal(locked, true); assert.equal(options.payload, payload); return { manifesto: { temperatura: 'AMBIENTE' } }; };
  s.criarRascunhoTransporte_ = options => { assert.equal(locked, true); assert.equal(options.temperaturaPdf, 'AMBIENTE'); return { ok: true }; };
  const result = s.executarSandboxTransporteCodex({ marker: 'TESTE-LOCAL', gerarPdfs: false, criarRascunhos: true, couriers: ['MARKEN'], limpar: false });
  assert.equal(result.ok, true); assert.equal(result.results[0].rascunho.ok, true);
});


test('rascunho MARKEN preexistente sem comprovacao de temperatura exige revisao e conserva IDs', () => {
  for (const temperaturaPdf of [undefined, 'REFRIGERADO']) {
    const f = generationFixture();
    f.setFailure('DRAFT_READY'); assert.throws(f.request, /interrupcao/);
    const key = Object.keys(f.values)[0], record = JSON.parse(f.values[key]);
    record.draft.temperaturaPdf = temperaturaPdf; f.values[key] = JSON.stringify(record);
    f.setFailure('');
    const result = f.request();
    assert.equal(result.fileId, 'PDF-2'); assert.equal(result.draftId, 'DRAFT-2');
    assert.equal(result.draftOk, false); assert.equal(result.draftErrorCode, 'RECOVERY_REVIEW_REQUIRED');
    assert.equal(f.pdfs.length, 1); assert.equal(f.draftOptions.length, 1);
  }
});
