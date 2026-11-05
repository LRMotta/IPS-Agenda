'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runFile, readProjectFile } = require('./helpers/load-app-script');

test('formato do PDF: planilha e o padrao, html e aceito e valor desconhecido falha', () => {
  const s = runFile('TransporteCodexConfig.gs', {});
  assert.equal(s.transporteFormatoPdfHtml_(undefined), false);
  assert.equal(s.transporteFormatoPdfHtml_(''), false);
  assert.equal(s.transporteFormatoPdfHtml_('planilha'), false);
  assert.equal(s.transporteFormatoPdfHtml_(' HTML '), true);
  assert.throws(() => s.transporteFormatoPdfHtml_('docx'), /Formato de PDF invalido/);
});

function ambiente(paginasDoPdf, extra) {
  const avisos = [];
  const blob = { setName(nome) { this.nome = nome; return this; } };
  const stubs = Object.assign({
    transporteNormalizeCourierFromCodex_: c => String(c).toUpperCase(),
    transporteDocsGradeContextoProtecao_: () => ({}),
    transporteDocsGradeCarregar_: () => ({ abas: { A: {} }, info: {} }),
    transporteDocsGradeProtegerConteudo_: () => [{ aba: 'A', valores: [['x']] }],
    transporteFolhaHtmlParaGrade_: () => ({ abas: [], html: '' }),
    transporteDocsGradeMontar_: () => '<div class="pagina"></div><div class="pagina"></div>',
    transporteDocsHtmlContarPaginasPdf_: () => paginasDoPdf,
    transporteRegistrarAviso_: code => avisos.push(code),
  }, extra || {});
  const app = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs'], {
    HtmlService: { createHtmlOutput: () => ({ getBlob: () => ({ getAs: () => blob }) }) },
    MimeType: { PDF: 'application/pdf' }
  });
  // Os arquivos definem as funcoes reais; os stubs entram depois do carregamento.
  Object.assign(app, stubs);
  return { app, avisos, blob };
}

const spec = { ordem: ['A'], copias: { A: 2 } };

test('geracao em HTML devolve o PDF nomeado e o conteudo protegido', () => {
  const { app, blob } = ambiente(2);
  const r = app.transporteDocsGradeGerarPdfHtml_({}, spec, 'dhl', {}, 'arquivo');
  assert.equal(r.blob, blob);
  assert.equal(blob.nome, 'arquivo.pdf');
  assert.deepEqual(JSON.parse(JSON.stringify(r.conteudo)), [{ aba: 'A', valores: [['x']] }]);
});

test('geracao em HTML falha quando o numero de paginas diverge do esperado', () => {
  const { app } = ambiente(3);
  assert.throws(() => app.transporteDocsGradeGerarPdfHtml_({}, spec, 'DHL', {}, 'arquivo'), /3 paginas \(esperado: 2\)/);
});

test('geracao em HTML avisa quando uma imagem nao foi incorporada', () => {
  const { app, avisos } = ambiente(2, { transporteDocsGradeCarregar_: () => ({ abas: { A: {} }, info: { imagensOmitidas: 1 } }) });
  app.transporteDocsGradeGerarPdfHtml_({}, spec, 'PINEX', {}, 'arquivo');
  assert.deepEqual(avisos, ['PDF_HTML_IMAGEM_OMITIDA']);
});

test('geracao em HTML usa a memoria sem ler a grade da planilha real', () => {
  const ssMemoria = {};
  let folhaSs;
  const { app } = ambiente(2, {
    transporteDocsGradeCarregar_: () => { throw new Error('grade real lida'); },
    transporteDocsMemoriaCarregar_: () => ({ abas: { A: {} }, info: {} }),
    transporteFolhaHtmlParaGrade_: (ss) => { folhaSs = ss; return { abas: [], html: '' }; },
  });
  app.transporteDocsGradeGerarPdfHtml_({}, spec, 'MARKEN', {}, 'arquivo', { ss: ssMemoria });
  assert.equal(folhaSs, ssMemoria);
});

test('couriers do novo formato coincidem com as do diagnostico', () => {
  const { app } = ambiente(2);
  assert.deepEqual([...app.TRANSPORTE_DOCS_GRADE_COURIERS_HTML_], ['MARKEN', 'OCASA', 'DHL', 'PINEX', 'PINEX (Agendamento)']);
});

test('interface: botao HTML separado, formato na chave de idempotencia e botao atual preservado', () => {
  const html = readProjectFile('TransporteApp.html');
  assert.match(html, /id="btnPdfTransport" onclick="runPdf\(''\)"/);
  assert.match(html, /id="btnPdfTransportHtml" onclick="runPdf\('html'\)"/);
  assert.match(html, /transportPdfFormat \? ':' \+ transportPdfFormat : ''/);
  assert.match(html, /formato: transportPdfFormat \|\| undefined/);
  const codigo = readProjectFile('TransporteCodexConfig.gs');
  assert.match(codigo, /transporteFormatoPdfHtml_\(options\.formato\)/);
});
