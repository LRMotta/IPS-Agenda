'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function server(extra = {}) {
  return runFile('TransporteCodexConfig.gs', { Logger: { log() {} }, ...extra });
}

function iterator(items) {
  let index = 0;
  return { hasNext: () => index < items.length, next: () => items[index++] };
}

function downloadFixture({ mime = 'application/pdf', registered = false, inside = false, bytes = [1, 2, 3] } = {}) {
  const calls = { read: 0, write: 0, blob: 0, roots: 0 };
  const root = { getId: () => 'OUTPUT', getParents: () => iterator([]) };
  const projectFolder = { getId: () => 'PROJECT', getParents: () => iterator([root]) };
  const externalFolder = { getId: () => 'EXTERNAL', getParents: () => iterator([]) };
  const file = {
    getId: () => 'PDF-ID', getName: () => 'transporte.pdf', getMimeType: () => mime,
    getParents: () => iterator([inside ? projectFolder : externalFolder]),
    getBlob() {
      calls.blob++;
      return { getBytes: () => bytes, getContentType: () => mime, getName: () => 'blob.pdf' };
    }
  };
  const s = server({
    codexAssertCanRead_() { calls.read++; },
    codexAssertCanWrite_() { calls.write++; throw new Error('readonly não pode escrever'); },
    DriveApp: {
      getFileById(id) { assert.equal(id, 'PDF-ID'); return file; },
      getRootFolder: () => ({
        getFoldersByName(name) {
          calls.roots++;
          assert.equal(name, 'Documentação para Transporte de Amostras');
          return iterator([root]);
        },
        createFolder() { throw new Error('download não deve criar pastas'); }
      })
    },
    Utilities: { base64Encode: values => Buffer.from(values).toString('base64') }
  });
  s.transporteOperacoesRows_ = () => registered ? [{ pdfId: 'PDF-ID' }] : [];
  return { s, calls, file, root, projectFolder };
}

test('download autoriza leitura de PDF registrado sem exigir escrita nem pesquisar pastas', () => {
  const { s, calls } = downloadFixture({ registered: true });
  const result = s.baixarPdfTransporte(' PDF-ID ');
  assert.equal(result.ok, true);
  assert.equal(result.fileId, 'PDF-ID');
  assert.equal(result.fileName, 'transporte.pdf');
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.base64, 'AQID');
  assert.deepEqual(calls, { read: 1, write: 0, blob: 1, roots: 0 });
});

test('download permite PDF manual/PINEX em subpasta por protocolo sem operação registrada', () => {
  const { s, calls } = downloadFixture({ inside: true });
  assert.equal(s.baixarPdfTransporte('PDF-ID').ok, true);
  assert.equal(calls.roots, 1);
  assert.equal(calls.blob, 1);
});

test('download rejeita MIME não PDF e PDF fora do módulo antes de ler bytes', () => {
  const nonPdf = downloadFixture({ registered: true, mime: 'application/vnd.google-apps.spreadsheet' });
  assert.throws(() => nonPdf.s.baixarPdfTransporte('PDF-ID'), /não é um PDF/);
  assert.equal(nonPdf.calls.blob, 0);
  const outside = downloadFixture();
  assert.throws(() => outside.s.baixarPdfTransporte('PDF-ID'), /não registrado/);
  assert.equal(outside.calls.blob, 0);
});

test('download preserva limites de tamanho e interrompe antes do Drive quando acesso é negado', () => {
  for (const bytes of [[], { length: 15 * 1024 * 1024 + 1 }]) {
    const { s } = downloadFixture({ registered: true, bytes });
    assert.throws(() => s.baixarPdfTransporte('PDF-ID'), /PDF vazio|PDF muito grande/);
  }
  const { s, calls } = downloadFixture({ registered: true });
  s.codexAssertCanRead_ = () => { throw new Error('acesso negado'); };
  s.DriveApp.getFileById = () => { throw new Error('Drive foi acessado indevidamente'); };
  assert.throws(() => s.baixarPdfTransporte('PDF-ID'), /acesso negado/);
  assert.equal(calls.blob, 0);
});

test('validação de vínculo termina em árvore de pastas cíclica sem autorizar arquivo externo', () => {
  const { s, file, projectFolder } = downloadFixture();
  projectFolder.getParents = () => iterator([projectFolder]);
  file.getParents = () => iterator([projectFolder]);
  assert.equal(s.transportePdfDownloadPermitido_(file), false);
});

function exportSheet(name, values, hidden = false) {
  return {
    getName: () => name, isSheetHidden: () => hidden,
    getDataRange: () => ({ getDisplayValues: () => values })
  };
}

test('scanner bloqueia nome em aba exportada sem expor dados do participante no erro ou log', () => {
  const logs = [];
  const s = server({ Logger: { log: value => logs.push(value) } });
  const ss = { getSheets: () => [exportSheet('Aba com informações internas', [['Participante: Pessoa Teste da Silva']])] };
  assert.throws(() => s.transportePdfVerificarAnonimizacao_(ss, ['Pessoa Teste da Silva']), error => {
    assert.match(error.message, /PDF bloqueado/);
    assert.doesNotMatch(error.message, /Pessoa Teste|Aba com|Participante:/);
    return true;
  });
  assert.deepEqual(logs, []);
});

test('scanner ignora abas ocultas e aceita iniciais nas abas exportadas', () => {
  const s = server();
  const hidden = exportSheet('Registro interno', [['Pessoa Teste da Silva']], true);
  hidden.getDataRange = () => { throw new Error('scanner leu aba oculta'); };
  const ss = { getSheets: () => [hidden, exportSheet('PDF', [['P.T.S.', 'Outros dados']])] };
  assert.doesNotThrow(() => s.transportePdfVerificarAnonimizacao_(ss, ['', 'Pessoa Teste da Silva']));
});

function cellFixture() {
  const written = [];
  const styles = [];
  const range = { setValue: value => written.push(value), setRichTextValue: value => written.push(value.text) };
  const s = server({ SpreadsheetApp: {
    newRichTextValue: () => {
      const value = { text: '' };
      const builder = { setText(text) { value.text = text; return builder; }, setTextStyle() { return builder; }, build: () => value };
      return builder;
    },
    newTextStyle: () => {
      const builder = { setBold(value) { styles.push(value); return builder; }, setItalic() { return builder; }, setUnderline() { return builder; }, build: () => ({}) };
      return builder;
    }
  } });
  return { s, range, written, styles };
}

test('decode preserva Unicode completo, entidades inválidas e apenas uma camada de escape', () => {
  const { s } = cellFixture();
  assert.equal(s.transporteHtmlDecode_('&#128512; &#x1F600;'), '😀 😀');
  assert.equal(s.transporteHtmlDecode_('&amp;#65; &amp;amp;'), '&#65; &amp;');
  assert.equal(s.transporteHtmlDecode_('&#1114112; &#xD800; &desconhecida;'), '&#1114112; &#xD800; &desconhecida;');
  assert.equal(s.transporteHtmlDecode_('&ccedil;&atilde;o'), 'ção');
});

test('texto simples e RichText decodificam uma camada e protegem fórmulas em texto livre', () => {
  const { s, range, written, styles } = cellFixture();
  s.transporteSetRichTextOrValue_(range, '&#61;1+1');
  s.transporteSetRichTextOrValue_(range, '&amp;#65;');
  s.transporteSetRichTextOrValue_(range, '<b>&amp;#65; &#128512;</b>');
  s.transporteSetRichTextOrValue_(range, '&lt;b&gt;texto literal&lt;/b&gt;');
  assert.deepEqual(written, ["'=1+1", '&#65;', '&#65; 😀', '<b>texto literal</b>']);
  assert.ok(styles.includes(true));
});

test('preenchimento por rótulo não decodifica novamente entidades já escapadas', () => {
  const { s, range, written } = cellFixture();
  const sheet = { getRange: () => range };
  s.transporteGetDisplayValuesCached_ = () => [['Empresa', '']];
  assert.equal(s.transporteSetAdjacentByLabel_(sheet, ['Empresa'], '&amp;#65;'), true);
  assert.deepEqual(written, ['&#65;']);
});

test('setter de bloco textual protege igualdade preservando placeholders e tipos numéricos', () => {
  const { s, range, written } = cellFixture();
  const block = { clearContent() {}, getCell: () => range };
  s.transporteSetTopLeftInBlock_({ getRange: () => block }, 'A1:B1', '&#61;1+1');
  assert.deepEqual(written, ["'=1+1"]);
  const date = new Date('2026-10-07T12:00:00Z');
  for (const value of [false, 2.5, date, '---', '+55 54 99999-9999', '@nome']) {
    assert.equal(s.transporteTextoLiteralParaCelula_(value), value);
  }
});

test('escritas em lote e ensaios preservam texto literal sem converter números ou datas', () => {
  const s = server();
  const writes = [];
  const date = new Date('2026-10-07T12:00:00Z');
  const range = {
    clearDataValidations() {},
    setValues(values) { writes.push(values); }
  };
  s.transporteSetValuesBlock_(range, [['=1+1'], [2.5], [date], [false]]);
  assert.equal(writes[0][0][0], "'=1+1");
  assert.equal(writes[0][1][0], 2.5);
  assert.equal(writes[0][2][0], date);
  assert.equal(writes[0][3][0], false);
  s.transporteSetEnsaiosPeticao_({ getRange(a1) { assert.equal(a1, 'P30:P35'); return range; } }, [
    { ativo: true, ensaio: '=1+1' }, { ativo: false, ensaio: '=IGNORAR' }, { ativo: true, ensaio: 'Ensaio comum' }
  ]);
  assert.equal(writes[1][0][0], "'=1+1");
  assert.equal(writes[1][1][0], 'Ensaio comum');
  assert.equal(writes[1].length, 6);
});

function draftFixture(active = 'ativo@example.com', effective = active) {
  const s = server();
  s.transporteActiveUserEmail_ = () => active;
  s.transporteEffectiveUserEmail_ = () => effective;
  s.transporteResolveUserEmail_ = value => value === 'Outro responsável' ? 'outro@example.com' : '';
  s.transporteGmailOAuthStatus_ = () => ({ ok: true, required: false });
  return s;
}

test('status do rascunho respeita ok booleano e preserva retorno textual legado', () => {
  const s = draftFixture();
  assert.equal(s.transporteDraftStatus_({ ok: true, message: 'Erro apenas mencionado no histórico' }).ok, true);
  const failed = s.transporteDraftStatus_({ ok: false, message: 'Falha específica', error: 'GMAIL_AUTH_REQUIRED' });
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, 'GMAIL_AUTH_REQUIRED');
  assert.equal(s.transporteDraftStatus_('Criado com sucesso').ok, true);
  assert.equal(s.transporteDraftStatus_('Erro ao criar').errorCode, 'LEGACY_DRAFT_ERROR');
});

test('status conserva identidade do rascunho já criado em outra conta', () => {
  const s = draftFixture();
  const result = s.transporteDraftStatus_({ ok: true, message: 'Criado', draftId: 'DRAFT-EXISTE', userEmail: 'outro@example.com', requestedByEmail: 'ativo@example.com' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'DRAFT_CREATED_IN_OTHER_ACCOUNT');
  assert.equal(result.draftId, 'DRAFT-EXISTE');
  assert.match(result.message, /Rascunho criado na conta/);
});

test('guard diferencia outro responsável, conta executora e identidade não identificada', () => {
  const sameSession = draftFixture();
  const responsible = sameSession.transporteAssertGmailDraftAllowed_({ agendadoPor: 'Outro responsável' });
  assert.equal(responsible.ok, false);
  assert.equal(responsible.error, 'DRAFT_RESPONSIBLE_MISMATCH');
  assert.match(responsible.message, /Agendado por/);
  assert.doesNotMatch(responsible.message, /USER_ACCESSING/);
  const differentSession = draftFixture('ativo@example.com', 'executor@example.com');
  assert.equal(differentSession.transporteAssertGmailDraftAllowed_({}).error, 'EXECUTION_USER_MISMATCH');
  assert.equal(draftFixture('', '').transporteAssertGmailDraftAllowed_({}).error, 'DRAFT_REQUESTER_NOT_RESOLVED');
  assert.equal(sameSession.transporteAssertGmailDraftAllowed_({}).ok, true);
});
