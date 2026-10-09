'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');

function fixture() {
  const values = {};
  const counts = { pdf: 0, draft: 0, save: 0, auth: 0 };
  let fault = '', denied = false;
  const props = { getProperty: k => values[k] || null, getProperties: () => ({ ...values }),
    setProperty: (k, v) => { if (fault === 'storage') throw new Error('quota'); values[k] = v; } };
  const s = runFile('TransporteCodexConfig.gs', {
    normText_: value => String(value || '').trim().toLowerCase(), Logger: { log() {} }, SpreadsheetApp: { flush() {} }, PropertiesService: { getUserProperties: () => props },
    codexWithDocumentLock_: (_label, fn) => fn(),
    codexAssertCanWrite_: () => { counts.auth++; if (denied) throw new Error('Acesso negado'); return { userEmail: 'teste@example.invalid' }; },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, value) => Array.from(crypto.createHash('sha256').update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'), newBlob: text => ({ getBytes: () => Array.from(Buffer.from(text)) }) }
  });
  s.salvarTransporteInterno_ = () => { counts.save++; return { agendaSync: { warnings: ['Confira AWB'] } }; };
  s.transporteValidarManifestoPdf_ = () => ({ hash: 'MODEL-1' });
  s.transporteReadRegistro_ = () => ({});
  s.getTransporteSpreadsheetCodex_ = () => ({});
  s.transporteGenerationSourceHash_ = () => 'SOURCE-1';
  s.transporteMonitorReferencia_ = () => '';
  s.imprimirTodasAbas = () => {
    s.transporteGenerationCheckpoint_({ phase: 'PDF_INTENT', sourceHash: 'SOURCE-1', sourceSheets: ['Modelo'] }); counts.pdf++;
    if (fault === 'pdf-unknown') throw new Error('interrupcao');
    const pdf = { type: 'pdf', fileId: 'PDF-1', courier: 'DHL', fileUrl: 'https://example.invalid/pdf', message: 'PDF gerado.' };
    s.transporteGenerationCheckpoint_({ phase: 'PDF_READY', pdf });
    if (fault === 'pdf-known') throw new Error('interrupcao');
    return pdf;
  };
  s.criarRascunhoTransporte_ = () => {
    if (fault === 'gmail-auth') return { ok: false, error: 'GMAIL_AUTH', message: 'Autorize Gmail.' };
    s.transporteGenerationCheckpoint_({ phase: 'DRAFT_INTENT' }); counts.draft++;
    if (fault === 'draft-unknown') throw new Error('interrupcao');
    const draft = { ok: true, draftId: 'DRAFT-1', message: 'Rascunho criado.' };
    s.transporteGenerationCheckpoint_({ phase: 'DRAFT_READY', draft });
    if (fault === 'draft-known') throw new Error('interrupcao');
    return draft;
  };
  const request = () => s.gerarPdfTransporte({ generationRequestId: 'a'.repeat(32), payload: { idAgenda: 'EVENT', agendaSlot: '1', paciente: 'Pessoa', courier: 'DHL' } });
  return { s, values, counts, request, setFault: v => { fault = v; }, deny: () => { denied = true; } };
}

test('resposta perdida recupera mesmo PDF/rascunho sem salvar nem criar novamente', () => {
  const f = fixture(); const first = f.request(); const saves = f.counts.save;
  const second = f.request();
  assert.equal(second.fileId, first.fileId); assert.equal(second.draftId, first.draftId);
  assert.equal(second.recovered, true); assert.equal(second.agendaSync.warnings[0], 'Confira AWB');
  assert.equal(f.counts.pdf, 1); assert.equal(f.counts.draft, 1); assert.equal(f.counts.save, saves);
  assert.equal(f.s.TRANSPORTE_GENERATION_REQUEST_, null);
});

test('PDF conhecido e rascunho conhecido retomam sem duplicar efeitos', () => {
  for (const phase of ['pdf-known', 'draft-known']) {
    const f = fixture(); f.setFault(phase); assert.throws(f.request, /interrupcao/);
    f.setFault(''); const result = f.request();
    assert.equal(result.fileId, 'PDF-1'); assert.equal(result.draftId, 'DRAFT-1');
    assert.equal(f.counts.pdf, 1); assert.equal(f.counts.draft, 1);
  }
});

test('PDF confirmado marca a etapa antes da falha Gmail; replay pode reparar a etapa sem recriar PDF', () => {
  const f = fixture();
  let marked = 0;
  f.s.transporteMarcarDocsGeradosAgenda_ = (_payload, result) => {
    assert.equal(result.fileId, 'PDF-1');
    marked++;
    return { atualizado: true, idAgenda: 'EVENT', slot: '1' };
  };
  f.setFault('draft-unknown');
  assert.throws(f.request, /interrupcao/);
  assert.equal(marked, 1);
  f.setFault('');
  assert.equal(f.request().agendaSync.atualizado, true);
  assert.equal(marked, 2);
  assert.equal(f.counts.pdf, 1);
});

test('criacao incerta de PDF ou draft bloqueia recriacao automatica', () => {
  const f = fixture(); f.setFault('pdf-unknown'); assert.throws(f.request, /interrupcao/);
  f.setFault(''); assert.throws(f.request, /pode ter criado o PDF/); assert.equal(f.counts.pdf, 1);
  const d = fixture(); d.setFault('draft-unknown'); assert.throws(d.request, /interrupcao/);
  d.setFault(''); const result = d.request();
  assert.equal(result.draftErrorCode, 'GENERATION_UNCERTAIN'); assert.equal(result.fileId, 'PDF-1');
  assert.equal(d.counts.pdf, 1); assert.equal(d.counts.draft, 1);
});

test('token nao aceita outro payload e replay exige autorizacao atual', () => {
  const f = fixture(); f.request();
  assert.throws(() => f.s.gerarPdfTransporte({ generationRequestId: 'a'.repeat(32), payload: { paciente: 'Outro' } }), /outros dados/);
  f.deny(); assert.throws(f.request, /Acesso negado/);
  assert.equal(f.counts.pdf, 1);
});

test('falha de armazenamento impede efeitos e mudanca de modelo impede retomar draft', () => {
  const f = fixture(); f.setFault('storage'); assert.throws(f.request, /quota/);
  assert.equal(f.counts.pdf, 0); assert.equal(f.counts.save, 0);
  const d = fixture(); d.setFault('pdf-known'); assert.throws(d.request, /interrupcao/);
  d.setFault(''); d.s.transporteValidarManifestoPdf_ = () => ({ hash: 'MODEL-2' });
  assert.throws(d.request, /modelos mudaram/); assert.equal(d.counts.pdf, 1); assert.equal(d.counts.draft, 0);
});


test('autorizacao Gmail pendente retoma so rascunho e nao cria outro PDF', () => {
  const f = fixture(); f.setFault('gmail-auth'); const partial = f.request();
  assert.equal(partial.draftOk, false); assert.equal(f.counts.pdf, 1); assert.equal(f.counts.draft, 0);
  f.setFault(''); assert.equal(f.request().draftId, 'DRAFT-1');
  assert.equal(f.counts.pdf, 1); assert.equal(f.counts.draft, 1);
});

test('historico compacto conserva marcador e rejeita token retirado sem recriar', () => {
  const f = fixture();
  for (let i = 1; i <= 22; i++) f.s.gerarPdfTransporte({ generationRequestId: i.toString(16).padStart(32, '0'), payload: { courier: 'DHL' } });
  assert.equal(Object.values(f.values).map(JSON.parse).filter(r => r.phase === 'COMPLETE').length, 20);
  assert.throws(() => f.s.gerarPdfTransporte({ generationRequestId: '1'.padStart(32, '0'), payload: { courier: 'DHL' } }), /histórico de recuperação/);
  assert.equal(f.counts.pdf, 22);
});


test('Gmail confirma ID logo apos criar draft; checkpoint falho conserva fase incerta', () => {
  for (const failCheckpoint of [false, true]) {
    const f = fixture(), s = f.s, events = [];
    s.getTransporteSpreadsheetCodex_ = () => ({});
    s.transporteCodexGetSheet_ = () => ({ getRange: () => ({ getValues: () => [['Estudo'], ['Medico'], ['AMBIENTE'], [''], [''], [''], ['DHL'], ['Lab'], ['AWB']], getDisplayValue: () => '' }) });
    s.transporteProjetoDisplay_ = v => v;
    s.transporteAssertGmailDraftAllowed_ = () => ({ ok: true, userEmail: 'teste@example.invalid', activeUserEmail: 'teste@example.invalid' });
    s.transporteActiveUserEmail_ = s.transporteEffectiveUserEmail_ = () => 'teste@example.invalid';
    s.transporteCodexSaudacao_ = () => 'Bom dia';
    s.transporteCodexFormatDateTitle_ = () => '';
    s.transporteCourierEmailRecipients_ = () => ['courier@example.invalid'];
    s.transporteCodexEmailDhlHtml_ = () => '';
    s.transporteReadSolicitarCaixa_ = () => 'Nao';
    s.transporteDraftCcRecipients_ = () => [];
    s.getGmailSignature = () => '';
    s.transporteMonitorRefHtml_ = () => '';
    s.transporteGmailAuthorizationUrl_ = () => '';
    s.GmailApp = { createDraft: () => { events.push('create'); return { getId: () => { events.push('id'); return 'DRAFT-REAL'; } }; } };
    s.TRANSPORTE_GENERATION_REQUEST_ = { record: {} };
    s.transporteGenerationCheckpoint_ = changes => { events.push(changes.phase); if (failCheckpoint && changes.phase === 'DRAFT_READY') throw new Error('quota'); };
    const result = s.criarRascunhoEmail_({});
    assert.deepEqual(events, ['DRAFT_INTENT', 'create', 'id', 'DRAFT_READY']);
    assert.equal(result.ok, !failCheckpoint);
    if (!failCheckpoint) assert.equal(result.draftId, 'DRAFT-REAL');
    else assert.match(result.message, /quota/);
  }
});


test('mudanca textual no modelo recupera PDF sem criar draft nem duplicar arquivo', () => {
  const f = fixture(); f.setFault('pdf-known'); assert.throws(f.request, /interrupcao/);
  f.setFault(''); f.s.transporteGenerationSourceHash_ = () => 'SOURCE-2';
  const result = f.request();
  assert.equal(result.fileId, 'PDF-1'); assert.equal(result.draftErrorCode, 'RECOVERY_REVIEW_REQUIRED');
  assert.equal(f.counts.pdf, 1); assert.equal(f.counts.draft, 0);
});

test('snapshot dos modelos compara conteudo exibido e merge preserva avisos anteriores', () => {
  const f = fixture();
  // Usa a implementacao real do hash, sem stub da fixture do pipeline.
  const s = runFile('TransporteCodexConfig.gs', { Utilities: f.s.Utilities });
  let text = 'Conteudo A';
  const ss = { getSheetByName: () => ({ getDataRange: () => ({ getDisplayValues: () => [[text]] }) }) };
  const first = s.transporteGenerationSourceHash_(ss, ['Modelo']); text = 'Conteudo B';
  assert.notEqual(s.transporteGenerationSourceHash_(ss, ['Modelo']), first);
  const merged = s.transporteGenerationMergeWarnings_([{ code: 'OLD', message: 'Aviso antigo' }], [{ code: 'OLD', message: 'Repetido' }, { code: 'NEW', message: 'Novo' }]);
  assert.equal(merged.length, 2); assert.equal(merged[0].message, 'Aviso antigo');
});
