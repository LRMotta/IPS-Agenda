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


// Utilities do Apps Script com gzip/MD5/base64 reais do Node.
function utilitiesReais() {
  const zlib = require('node:zlib');
  const crypto = require('node:crypto');
  const blob = bytes => ({ getBytes: () => [...bytes], getDataAsString: () => Buffer.from(bytes).toString('utf8') });
  return {
    formatDate: () => '20261105-120000',
    newBlob: d => blob(typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d)),
    gzip: b => blob(zlib.gzipSync(Buffer.from(b.getBytes()))),
    ungzip: b => blob(zlib.gunzipSync(Buffer.from(b.getBytes()))),
    base64Encode: bytes => Buffer.from(bytes).toString('base64'),
    base64Decode: texto => [...Buffer.from(texto, 'base64')].map(b => (b > 127 ? b - 256 : b)),
    computeDigest: (alg, texto) => [...crypto.createHash('md5').update(texto, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' }
  };
}

function cacheSimulado() {
  const itens = new Map();
  return {
    itens,
    get: k => (itens.has(k) ? itens.get(k) : null),
    getAll: ks => Object.fromEntries(ks.filter(k => itens.has(k)).map(k => [k, itens.get(k)])),
    putAll: obj => Object.entries(obj).forEach(([k, v]) => itens.set(k, v)),
    removeAll: ks => ks.forEach(k => itens.delete(k))
  };
}

// So os campos de valor, como a API devolve com TRANSPORTE_DOCS_GRADE_CAMPOS_VALORES_.
function somenteValores(sheet) {
  return {
    properties: { title: sheet.properties.title },
    data: [{ startRow: 0, startColumn: 0, rowData: sheet.data[0].rowData.map(row => ({ values: row.values.map(c => {
      const v = {};
      if (c.formattedValue !== undefined) v.formattedValue = c.formattedValue;
      if (c.effectiveValue) v.effectiveValue = c.effectiveValue;
      if (c.textFormatRuns) v.textFormatRuns = c.textFormatRuns;
      return v;
    }) })) }]
  };
}

function diagnosticoGrade(options = {}) {
  const calls = { fetch: [], fetchAll: [], html: [], files: [], logs: [], avancado: [] };
  const ordem = ['Folha de Agendamento', "Declaração d'Exemplo"];
  const folha = aba([[celula('x'), {}, {}], [{}, {}, {}], [celula('Rótulo'), {}, celula('Pessoa Participante')]], { titulo: ordem[0], larguras: [100, 100, 100] });
  const declaracao = aba([[{ userEnteredValue: { imageValue: { imageProperties: { contentUrl: 'https://img.example/a?key=1' } } } }, celula('Dr(a). Exemplo')]], { titulo: ordem[1] });
  const responder = url => (url.includes('startRow') ? { sheets: [somenteValores(folha), somenteValores(declaracao)] } : { sheets: [folha, declaracao] });
  const pdfText = Array.from({ length: options.paginas || 5 }, () => '<< /Type /Page >>').join('') + '<< /Type /Pages >>';
  const pdfBlob = { name: '', setName(n) { this.name = n; return this; }, getDataAsString: () => pdfText, getBytes: () => [1, 2, 3] };
  const folder = { createFile(blob) { calls.files.push(blob.name); return { getName: () => blob.name, getUrl: () => 'https://drive.example/f' }; } };
  const cache = options.cache || cacheSimulado();
  const ctx = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs'], {
    codexAssertAdmin_: () => { if (options.negar) throw new Error('Acesso permitido apenas para administradores.'); },
    getTransporteSpreadsheetCodex_: () => ({ getId: () => 'planilha-id' }),
    transportePdfSpec_: courier => {
      calls.courier = courier;
      return { ordem, copias: { [ordem[0]]: 1, [ordem[1]]: 4 } };
    },
    ScriptApp: { getOAuthToken: () => 'token-teste' },
    CacheService: { getScriptCache: () => cache },
    UrlFetchApp: {
      fetch: (url, opts) => {
        calls.fetch.push({ url, opts });
        const corpo = options.http
          ? JSON.stringify({ error: { code: options.http, status: 'PERMISSION_DENIED', message: 'texto livre', details: [{ reason: 'SERVICE_DISABLED' }] } })
          : JSON.stringify(responder(url));
        return { getResponseCode: () => options.http || 200, getContentText: () => corpo };
      },
      fetchAll: reqs => {
        calls.fetchAll.push([...reqs].map(r => r.url));
        return reqs.map(() => ({ getResponseCode: () => 200, getBlob: () => ({ getContentType: () => 'image/png', getBytes: () => [65] }) }));
      }
    },
    Utilities: utilitiesReais(),
    HtmlService: { createHtmlOutput: html => { calls.html.push(html); return { getBlob: () => ({ getAs: () => pdfBlob }) }; } },
    MimeType: { PDF: 'application/pdf' },
    DriveApp: { getRootFolder: () => ({ getFoldersByName: () => ({ hasNext: () => true, next: () => folder }) }) },
    Logger: { log: line => calls.logs.push(line) },
    ...(options.servicoAvancado ? {
      Sheets: { Spreadsheets: { get: (id, params) => { calls.avancado.push({ id, params }); return { sheets: [folha, declaracao] }; } } }
    } : {})
  });
  return { ctx, calls, cache };
}

test('diagnostico le o layout uma vez, guarda sem texto no cache e na segunda leitura busca so os valores', () => {
  const { ctx, calls, cache } = diagnosticoGrade();
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(calls.courier, 'MARKEN');
  // Layout a frio + valores a frio + valores a quente.
  assert.equal(calls.fetch.length, 3);
  const [layout, valoresFrio, valoresQuente] = calls.fetch.map(f => f.url);
  assert.match(layout, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/planilha-id\?includeGridData=true&fields=sheets\(properties\(title\)%2Cmerges/);
  assert.match(layout, /&ranges='Folha%20de%20Agendamento'&ranges='Declara%C3%A7%C3%A3o%20d''Exemplo'$/);
  assert.match(valoresQuente, /startRow/);
  assert.doesNotMatch(valoresQuente, /effectiveFormat|merges/);
  assert.match(valoresQuente, /&ranges='Folha%20de%20Agendamento'!A1%3AC3&ranges='Declara%C3%A7%C3%A3o%20d''Exemplo'!A1%3AB1$/);
  assert.equal(valoresFrio, valoresQuente);
  calls.fetch.forEach(f => assert.equal(f.opts.headers.Authorization, 'Bearer token-teste'));
  assert.deepEqual(calls.fetchAll, [['https://img.example/a?key=1']]);

  const contadores = [...cache.itens.keys()].filter(k => !/:\d+$/.test(k));
  assert.equal(contadores.length, 2);
  contadores.forEach(chave => {
    const n = Number(cache.itens.get(chave));
    const texto = Array.from({ length: n }, (_, i) => cache.itens.get(chave + ':' + i)).join('');
    const layoutGuardado = require('node:zlib').gunzipSync(Buffer.from(texto, 'base64')).toString('utf8');
    assert.match(layoutGuardado, /effectiveFormat|columnMetadata/);
    assert.doesNotMatch(layoutGuardado, /Pessoa|Dr\(a\)|Rótulo|formattedValue|img\.example/);
  });

  const html = calls.html[0];
  assert.equal((html.match(/<div class="pagina">/g) || []).length, 5);
  assert.match(html, /src="data:image\/png;base64,QQ=="/);
  assert.match(html, /Dr\(a\)\. Exemplo/);
  assert.doesNotMatch(html, /Pessoa Participante/);
  assert.match(html, /\[participante\]/);
  assert.equal(r.ok, true);
  assert.equal(r.abasMontadas, 2);
  assert.equal(r.frio.info.layoutsDoCache, 0);
  assert.equal(r.frio.info.viaLayout, 'rest');
  assert.equal(r.frio.info.imagensIncorporadas, 1);
  assert.ok(r.frio.info.bytesCache > 0);
  assert.equal(r.quente.info.layoutsDoCache, 2);
  assert.equal(r.quente.tempos.layoutLerMs, undefined);
  assert.deepEqual(calls.files, ['diagnostico-grade-marken-20261105-120000.pdf']);
  ['frioMs', 'quenteMs', 'htmlMs', 'conversaoMs', 'driveMs', 'totalMs'].forEach(k => assert.equal(typeof r.tempos[k], 'number', k));
  assert.equal(calls.logs.length, 1);
  assert.doesNotMatch(calls.logs[0], /Pessoa|Participante|Dr\(a\)|token|@|base64/);
});

test('cache incompleto ou ilegivel e relido da planilha', () => {
  const { ctx, calls, cache } = diagnosticoGrade();
  ctx.transporteDocsGradeCarregar_('planilha-id', ['Folha de Agendamento', "Declaração d'Exemplo"], {});
  const pedaco = [...cache.itens.keys()].find(k => /:0$/.test(k));
  cache.itens.set(pedaco, 'nao-e-gzip');
  const r = ctx.transporteDocsGradeCarregar_('planilha-id', ['Folha de Agendamento', "Declaração d'Exemplo"], {});
  assert.equal(r.info.layoutsDoCache, 1);
  assert.equal(calls.fetch.filter(f => !f.url.includes('startRow')).length, 2);
  assert.equal(Object.keys(r.abas).length, 2);
});

test('limpar cache remove o contador e os pedacos de cada aba MARKEN', () => {
  const { ctx, cache } = diagnosticoGrade();
  ctx.transporteDocsGradeCarregar_('planilha-id', ['Folha de Agendamento', "Declaração d'Exemplo"], {});
  assert.ok(cache.itens.size > 0);
  const r = ctx.limparCacheLayoutTransporteHtml();
  assert.equal(cache.itens.size, 0);
  assert.equal(r.chavesRemovidas, 4);
});

test('diagnostico exige administrador e para em erro HTTP sem servico avancado, sem gerar arquivo', () => {
  const negado = diagnosticoGrade({ negar: true });
  assert.throws(() => negado.ctx.diagnosticarGradeTransporteHtml(), /administradores/);
  assert.equal(negado.calls.fetch.length, 0);

  const falha = diagnosticoGrade({ http: 403 });
  assert.throws(() => falha.ctx.diagnosticarGradeTransporteHtml(), /^Error: Leitura da grade falhou \(HTTP 403: PERMISSION_DENIED \/ SERVICE_DISABLED\)\.$/);
  assert.equal(falha.calls.files.length, 0);
  assert.equal(falha.calls.logs.length, 0);
});

test('REST recusada recorre ao servico avancado Sheets com os mesmos intervalos e campos', () => {
  const { ctx, calls } = diagnosticoGrade({ http: 403, servicoAvancado: true });
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(calls.avancado[0].id, 'planilha-id');
  assert.deepEqual([...calls.avancado[0].params.ranges], ["'Folha de Agendamento'", "'Declaração d''Exemplo'"]);
  assert.equal(calls.avancado[0].params.includeGridData, true);
  assert.match(calls.avancado[0].params.fields, /^sheets\(properties\(title\),merges,data\(/);
  assert.match(calls.avancado[1].params.fields, /startRow/);
  assert.equal(r.frio.info.viaLayout, 'avancado (REST HTTP 403: PERMISSION_DENIED / SERVICE_DISABLED)');
  assert.equal(r.paginas, 5);
  assert.doesNotMatch(calls.html[0], /Pessoa Participante/);
});

test('diagnostico sinaliza quebra de pagina divergente', () => {
  const { ctx } = diagnosticoGrade({ paginas: 4 });
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(r.ok, false);
  assert.equal(r.paginasEsperadas, 5);
});

test('intervalos usam a area impressa com colunas em letras e apostrofo escapado', () => {
  assert.equal(app.transporteDocsGradeLetraColuna_(1), 'A');
  assert.equal(app.transporteDocsGradeLetraColuna_(26), 'Z');
  assert.equal(app.transporteDocsGradeLetraColuna_(27), 'AA');
  assert.equal(app.transporteDocsGradeLetraColuna_(39), 'AM');
  assert.equal(app.transporteDocsGradeIntervaloAba_("Aba d'X", 17, 53), "'Aba d''X'!A1:Q53");
  assert.equal(app.transporteDocsGradeIntervaloAba_('Aba'), "'Aba'");
});

test('layout com valores aplicados reproduz o HTML da grade completa', () => {
  const sheet = aba([
    [celula('Titulo', { effectiveFormat: { textFormat: { bold: true, fontSize: 12 }, borders: { bottom: SOLID } } }), {}, { effectiveFormat: { borders: { right: SOLID } } }],
    [{ dataValidation: { condition: { type: 'BOOLEAN' } }, effectiveValue: { boolValue: true }, formattedValue: 'TRUE' }, celula('12', { effectiveValue: { numberValue: 12 } }), {}],
    [{}, {}, {}, { effectiveFormat: { textFormat: { fontSize: 10 } } }]
  ], { larguras: [80, 90, 100, 50], merges: [{ startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 3 }] });
  const completo = app.transporteDocsGradeHtml_(JSON.parse(JSON.stringify(sheet)));
  const layout = app.transporteDocsGradeLayout_(JSON.parse(JSON.stringify(sheet)), {});
  assert.deepEqual({ ...layout.area }, { colunas: 3, linhas: 2 });
  assert.doesNotMatch(JSON.stringify(layout), /Titulo|formattedValue|effectiveValue/);
  const reconstruido = app.transporteDocsGradeHtml_(app.transporteDocsGradeAplicarValores_(JSON.parse(JSON.stringify(layout)), somenteValores(sheet)));
  assert.equal(reconstruido, completo);
});
