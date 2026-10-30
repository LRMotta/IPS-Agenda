'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

const app = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs']);

const SOLID = { style: 'SOLID', color: {} };

function celula(texto, extra) {
  return Object.assign({ formattedValue: texto, effectiveFormat: { textFormat: { fontSize: 10 } } }, extra || {});
}

// Grade sintetica no formato de spreadsheets.get (includeGridData).
function aba(linhas, opcoes) {
  opcoes = opcoes || {};
  const nCols = opcoes.larguras ? opcoes.larguras.length : 4;
  return {
    properties: { title: opcoes.titulo || 'Modelo' },
    merges: opcoes.merges || [],
    data: [{
      columnMetadata: (opcoes.larguras || Array(nCols).fill(100)).map((pixelSize, i) => ({ pixelSize, hiddenByUser: (opcoes.ocultas || []).includes(i) })),
      rowMetadata: linhas.map(() => ({ pixelSize: 21 })),
      rowData: linhas.map(values => ({ values }))
    }]
  };
}

function colunas(html) {
  return [...html.matchAll(/<col style="width:([\d.]+)px">/g)].map(m => Number(m[1]));
}

test('area impressa comeca em A1, ignora colunas ocultas e so reduz para caber na largura', () => {
  const estreita = app.transporteDocsGradeHtml_(aba([[{}, celula('x')]], { larguras: [50, 100, 300] }));
  assert.deepEqual(colunas(estreita), [50, 100]);

  const larga = app.transporteDocsGradeHtml_(aba([[celula('a'), {}, {}, celula('b')]], { larguras: [500, 500, 900, 486], ocultas: [2] }));
  const larguras = colunas(larga);
  assert.equal(larguras.length, 3);
  assert.ok(Math.abs(larguras.reduce((a, b) => a + b, 0) - 743) < 0.1);
});

test('texto em OVERFLOW ocupa vizinhas vazias (inclusive com borda) e e cortado na primeira ocupada', () => {
  const html = app.transporteDocsGradeHtml_(aba([[
    celula('Rotulo longo', { effectiveFormat: { textFormat: {}, borders: { left: SOLID, bottom: SOLID } } }),
    { effectiveFormat: { borders: { bottom: SOLID, right: SOLID } } },
    celula('valor'),
    {}
  ]]));
  assert.match(html, /<td colspan="2" style="[^"]*overflow:hidden[^"]*border-right:1px solid #000000[^"]*border-bottom:1px solid #000000[^"]*border-left:1px solid #000000[^"]*">Rotulo longo<\/td>/);
  // A coluna D vazia fica fora da area impressa; 'valor' e a ultima celula.
  assert.match(html, /<td style="[^"]*">valor<\/td><\/tr>/);
  assert.equal(colunas(html).length, 3);
});

test('mesclagens, caixas de selecao, texto misto e imagens seguem a grade', () => {
  const html = app.transporteDocsGradeHtml_(aba([
    [{ userEnteredValue: { imageValue: { imageProperties: { contentUrl: 'https://img.example/logo?key=1' } } } }, {}, {}, celula('fim')],
    [{}, {}, {}, {}],
    [
      { dataValidation: { condition: { type: 'BOOLEAN' } }, effectiveValue: { boolValue: true }, formattedValue: 'TRUE' },
      { dataValidation: { condition: { type: 'BOOLEAN' } }, effectiveValue: { boolValue: false }, formattedValue: 'FALSE' },
      celula('Eu, Dr(a).', { effectiveFormat: { textFormat: { bold: true, fontSize: 10 }, wrapStrategy: 'WRAP' }, textFormatRuns: [{ startIndex: 0, format: { bold: false } }, { startIndex: 4 }] }),
      {}
    ]
  ], { merges: [{ startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 3 }] }), {
    imagemSrc: url => url === 'https://img.example/logo?key=1' ? 'data:image/png;base64,AAAA' : 'erro'
  });
  assert.match(html, /<td colspan="3" rowspan="2"[^>]*><img src="data:image\/png;base64,AAAA"/);
  assert.equal((html.match(/<span class="cb">&#10003;<\/span>/g) || []).length, 1);
  assert.equal((html.match(/<span class="cb">&nbsp;<\/span>/g) || []).length, 1);
  assert.doesNotMatch(html, />TRUE<|>FALSE</);
  assert.match(html, /font-weight:bold[^"]*white-space:normal[^>]*><span style="font-weight:normal">Eu, <\/span>Dr\(a\).<\/td>/);
});

test('conteudo da planilha e escapado e quebras de linha viram <br>', () => {
  const html = app.transporteDocsGradeHtml_(aba([[celula('<script>x()</script>\nlinha 2')]]));
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;x\(\)&lt;\/script&gt;<br>linha 2/);
});

test('documento repete a pagina por copia, usa a pagina do exportador e exige abas existentes', () => {
  const abas = { A: aba([[celula('a')]], { titulo: 'A' }), B: aba([[celula('b')]], { titulo: 'B' }) };
  const html = app.transporteDocsGradeMontar_(abas, [{ aba: 'A', copias: 4 }, { aba: 'B', copias: 2 }], {});
  assert.equal((html.match(/<div class="pagina">/g) || []).length, 6);
  assert.match(html, /@page\{size:A4;margin:12\.7mm 6\.35mm 2\.5mm 6\.35mm\}/);
  assert.match(html, /\.pagina\{width:745px;/);
  assert.throws(() => app.transporteDocsGradeMontar_(abas, [{ aba: 'C', copias: 1 }], {}), /não encontrada: C/);
  assert.throws(() => app.transporteDocsGradeHtml_(aba([[{}, {}]])), /sem conteúdo/);
});

function diagnosticoGrade(options = {}) {
  const calls = { fetch: [], fetchAll: [], html: [], files: [], logs: [] };
  const ordem = ['Folha de Agendamento', "Declaração d'Exemplo"];
  const folha = aba([[celula('x'), {}, {}], [{}, {}, {}], [celula('Rótulo'), {}, celula('Pessoa Participante')]], { titulo: ordem[0], larguras: [100, 100, 100] });
  const declaracao = aba([[{ userEnteredValue: { imageValue: { imageProperties: { contentUrl: 'https://img.example/a?key=1' } } } }, celula('Dr(a). Exemplo')]], { titulo: ordem[1] });
  const pdfText = Array.from({ length: options.paginas || 5 }, () => '<< /Type /Page >>').join('') + '<< /Type /Pages >>';
  const pdfBlob = { name: '', setName(n) { this.name = n; return this; }, getDataAsString: () => pdfText, getBytes: () => [1, 2, 3] };
  const folder = { createFile(blob) { calls.files.push(blob.name); return { getName: () => blob.name, getUrl: () => 'https://drive.example/f' }; } };
  const ctx = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs'], {
    codexAssertAdmin_: () => { if (options.negar) throw new Error('Acesso permitido apenas para administradores.'); },
    getTransporteSpreadsheetCodex_: () => ({
      getId: () => 'planilha-id',
      getSheetByName: nome => ({ getImages: () => (nome === ordem[1] ? [{}, {}] : []) })
    }),
    transportePdfSpec_: (courier) => {
      calls.courier = courier;
      return { ordem, copias: { [ordem[0]]: 1, [ordem[1]]: 4 } };
    },
    ScriptApp: { getOAuthToken: () => 'token-teste' },
    UrlFetchApp: {
      fetch: (url, opts) => {
        calls.fetch.push({ url, opts });
        const corpo = options.http
          ? JSON.stringify({ error: { code: options.http, status: 'PERMISSION_DENIED', message: 'texto livre', details: [{ reason: 'SERVICE_DISABLED' }] } })
          : JSON.stringify({ sheets: [folha, declaracao] });
        return { getResponseCode: () => options.http || 200, getContentText: () => corpo };
      },
      fetchAll: reqs => {
        calls.fetchAll.push([...reqs].map(r => r.url));
        return reqs.map(() => ({ getResponseCode: () => 200, getBlob: () => ({ getContentType: () => 'image/png', getBytes: () => [0] }) }));
      }
    },
    Utilities: { formatDate: () => '20261105-120000', base64Encode: () => 'QQ==' },
    HtmlService: { createHtmlOutput: html => { calls.html.push(html); return { getBlob: () => ({ getAs: () => pdfBlob }) }; } },
    MimeType: { PDF: 'application/pdf' },
    DriveApp: { getRootFolder: () => ({ getFoldersByName: () => ({ hasNext: () => true, next: () => folder }) }) },
    Logger: { log: line => calls.logs.push(line) },
    ...(options.servicoAvancado ? {
      Sheets: { Spreadsheets: { get: (id, params) => { calls.avancado = { id, params }; return { sheets: [folha, declaracao] }; } } }
    } : {})
  });
  return { ctx, calls };
}

test('diagnostico da grade le as abas MARKEN pela API, incorpora imagens e mascara o participante', () => {
  const { ctx, calls } = diagnosticoGrade();
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(calls.courier, 'MARKEN');
  assert.equal(calls.fetch.length, 1);
  const { url, opts } = calls.fetch[0];
  assert.match(url, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/planilha-id\?includeGridData=true&fields=/);
  assert.match(url, /&ranges='Folha%20de%20Agendamento'&ranges='Declara%C3%A7%C3%A3o%20d''Exemplo'$/);
  assert.equal(opts.headers.Authorization, 'Bearer token-teste');
  assert.deepEqual(calls.fetchAll, [['https://img.example/a?key=1']]);
  const html = calls.html[0];
  assert.equal((html.match(/<div class="pagina">/g) || []).length, 5);
  assert.match(html, /src="data:image\/png;base64,QQ=="/);
  assert.doesNotMatch(html, /Pessoa Participante/);
  assert.match(html, /\[participante\]/);
  assert.equal(r.ok, true);
  assert.equal(r.abasLidas, 2);
  assert.equal(r.imagensIncorporadas, 1);
  assert.deepEqual({ ...r.imagensFlutuantes }, { 'Folha de Agendamento': 0, "Declaração d'Exemplo": 2 });
  assert.deepEqual(calls.files, ['diagnostico-grade-marken-20261105-120000.pdf']);
  ['abasMs', 'leituraMs', 'imagensMs', 'htmlMs', 'conversaoMs', 'driveMs', 'totalMs'].forEach(k => assert.equal(typeof r.tempos[k], 'number', k));
  assert.equal(calls.logs.length, 1);
  assert.doesNotMatch(calls.logs[0], /Pessoa|Participante|Dr\(a\)|token|@/);
});

test('diagnostico da grade exige administrador e para em erro HTTP sem gerar arquivo', () => {
  const negado = diagnosticoGrade({ negar: true });
  assert.throws(() => negado.ctx.diagnosticarGradeTransporteHtml(), /administradores/);
  assert.equal(negado.calls.fetch.length, 0);

  const falha = diagnosticoGrade({ http: 403 });
  assert.throws(() => falha.ctx.diagnosticarGradeTransporteHtml(), /^Error: Leitura da grade falhou \(HTTP 403: PERMISSION_DENIED \/ SERVICE_DISABLED\)\.$/);
  assert.equal(falha.calls.files.length, 0);
  assert.equal(falha.calls.logs.length, 0);
});

test('diagnostico da grade sinaliza quebra de pagina divergente', () => {
  const { ctx } = diagnosticoGrade({ paginas: 4 });
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(r.ok, false);
  assert.equal(r.paginasEsperadas, 5);
});

test('diagnostico da grade usa o servico avancado Sheets quando habilitado, com os mesmos intervalos e campos', () => {
  const { ctx, calls } = diagnosticoGrade({ servicoAvancado: true });
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.avancado.id, 'planilha-id');
  assert.deepEqual([...calls.avancado.params.ranges], ["'Folha de Agendamento'", "'Declaração d''Exemplo'"]);
  assert.equal(calls.avancado.params.includeGridData, true);
  assert.match(calls.avancado.params.fields, /^sheets\(properties\(title\),merges,data\(/);
  assert.equal(r.ok, true);
  assert.equal(r.abasLidas, 2);
  assert.ok(r.bytesGrade > 0);
  assert.doesNotMatch(calls.html[0], /Pessoa Participante/);
});
