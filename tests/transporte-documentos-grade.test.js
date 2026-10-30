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
  const calls = { fetch: [], fetchAll: [], html: [], files: [], logs: [], avancado: [], getValues: [] };
  const propriedades = options.propriedades || new Map();
  const ordem = ['Folha de Agendamento', "Declaração d'Exemplo"];
  const folha = aba([[celula('x'), {}, {}], [{}, {}, {}], [celula('Rótulo'), {}, celula('Pessoa Participante')]], { titulo: ordem[0], larguras: [100, 100, 100] });
  // A API publica nao devolve imagens de celula: o logo (A1) vem como CellImage do SpreadsheetApp.
  const declaracao = aba([[{ effectiveFormat: { borders: { bottom: SOLID } } }, celula('Dr(a). Exemplo')]], { titulo: ordem[1] });
  const celulaImagem = { valueType: 'IMAGE', getContentUrl: () => 'https://lh3.googleusercontent.com/a?key=1' };
  const ss = {
    getId: () => 'planilha-id',
    getSpreadsheetLocale: () => options.locale || 'pt_BR',
    getSheetByName: nome => ({ getDataRange: () => ({ getValues: () => {
      calls.getValues.push(nome);
      return nome === ordem[1] ? [[celulaImagem, 'Dr(a). Exemplo']] : [['x', '', ''], ['', '', ''], ['Rótulo', '', 'Pessoa Participante']];
    } }) })
  };
  const formatosDeclaracao = { properties: { title: ordem[1] }, data: [{ startRow: 20, startColumn: 9, rowData: [{ values: [{ effectiveFormat: { textFormat: { fontSize: 9 } } }] }] }] };
  const responder = url => {
    if (url.includes('effectiveFormat') && url.includes('startRow')) return { sheets: [formatosDeclaracao] };
    return url.includes('startRow') ? { sheets: [somenteValores(folha), somenteValores(declaracao)] } : { sheets: [folha, declaracao] };
  };
  const respostaPlanilha = (url, opts) => {
    calls.fetch.push({ url, opts });
    const corpo = options.http
      ? JSON.stringify({ error: { code: options.http, status: 'PERMISSION_DENIED', message: 'texto livre', details: [{ reason: 'SERVICE_DISABLED' }] } })
      : JSON.stringify(responder(url));
    return { getResponseCode: () => options.http || 200, getContentText: () => corpo };
  };
  const pdfText = Array.from({ length: options.paginas || 5 }, () => '<< /Type /Page >>').join('') + '<< /Type /Pages >>';
  const pdfBlob = { name: '', setName(n) { this.name = n; return this; }, getDataAsString: () => pdfText, getBytes: () => [1, 2, 3] };
  const folder = { createFile(blob) { calls.files.push(blob.name); return { getName: () => blob.name, getUrl: () => 'https://drive.example/f' }; } };
  const cache = options.cache || cacheSimulado();
  const ctx = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteFolhaAgendamentoHtml.gs'], {
    codexAssertAdmin_: () => { if (options.negar) throw new Error('Acesso permitido apenas para administradores.'); },
    getTransporteSpreadsheetCodex_: () => ss,
    SpreadsheetApp: { ValueType: { IMAGE: 'IMAGE' } },
    transportePdfSpec_: courier => {
      calls.courier = courier;
      return { ordem, copias: { [ordem[0]]: 1, [ordem[1]]: 4 } };
    },
    transportePdfActualSheetName_: chave => ({ folhaAgendamento: ordem[0], declaracaoTransp: ordem[1] })[chave] || '',
    transporteReadRegistro_: () => ({ paciente: 'Pessoa Participante' }),
    transporteDerivarDadosParticipante_: (payload, opts) => {
      calls.derivar = opts;
      return Object.assign({ identificacaoParticipante: '007' }, payload);
    },
    transporteParticipanteDocumento_: payload => ({ iniciais: 'P.P.', identificacao: payload.identificacaoParticipante, texto: 'P.P. | ID: ' + payload.identificacaoParticipante }),
    transporteNormalizeTemperaturaFromCodex_: v => String(v || '').toUpperCase(),
    transporteLabCentralByDestino_: () => null,
    transporteContatoEmergenciaTexto_: courier => 'Emergência ' + courier, transporteNormalizeCourierFromCodex_: courier => String(courier).toUpperCase(),
    transportePdfManifestText_: v => String(v == null ? '' : v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(),
    transportePdfManifestoHash_: m => 'hash:' + JSON.stringify(m).length,
    ScriptApp: { getOAuthToken: () => 'token-teste' },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (propriedades.has(k) ? propriedades.get(k) : null),
      setProperty: (k, v) => propriedades.set(k, v)
    }) },
    UrlFetchApp: {
      fetch: respostaPlanilha,
      fetchAll: reqs => {
        const imagens = [...reqs].filter(r => !r.url.startsWith('https://sheets.googleapis.com/'));
        if (imagens.length) calls.fetchAll.push(imagens.map(r => r.url + ' ' + (r.headers ? r.headers.Authorization : 'sem-token')));
        return reqs.map(r => (r.url.startsWith('https://sheets.googleapis.com/')
          ? respostaPlanilha(r.url, r)
          : { getResponseCode: () => 200, getBlob: () => ({ getContentType: () => 'image/png', getBytes: () => [65] }) }));
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
  return { ctx, calls, cache, ss, propriedades };
}

test('diagnostico le o layout uma vez, guarda sem texto no cache e na segunda leitura busca so os valores', () => {
  const { ctx, calls, cache } = diagnosticoGrade();
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(calls.courier, 'MARKEN');
  // Layout a frio + (valores + formatos dinamicos) a frio e a quente.
  assert.equal(calls.fetch.length, 5);
  const [layout, valoresFrio, formatosFrio, valoresQuente, formatosQuente] = calls.fetch.map(f => f.url);
  assert.match(layout, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/planilha-id\?includeGridData=true&fields=sheets\(properties\(title\)%2Cmerges/);
  assert.match(layout, /&ranges='Folha%20de%20Agendamento'&ranges='Declara%C3%A7%C3%A3o%20d''Exemplo'$/);
  assert.match(valoresQuente, /startRow/);
  assert.doesNotMatch(valoresQuente, /effectiveFormat|merges/);
  assert.match(valoresQuente, /&ranges='Folha%20de%20Agendamento'!A1%3AC3&ranges='Declara%C3%A7%C3%A3o%20d''Exemplo'!A1%3AB1$/);
  assert.equal(valoresFrio, valoresQuente);
  // Faixa formatada por codigo (volumes da Declaracao) relida a cada geracao, so com formatos.
  assert.equal(formatosFrio, formatosQuente);
  assert.match(formatosQuente, /effectiveFormat/);
  assert.doesNotMatch(formatosQuente, /formattedValue/);
  assert.match(formatosQuente, /&ranges='Declara%C3%A7%C3%A3o%20d''Exemplo'!J21%3AL28$/);
  assert.equal(calls.derivar.obrigatorio, true);
  calls.fetch.forEach(f => assert.equal(f.opts.headers.Authorization, 'Bearer token-teste'));
  assert.deepEqual(calls.fetchAll, [['https://lh3.googleusercontent.com/a?key=1 Bearer token-teste']]);
  // SpreadsheetApp so e consultado para montar o layout (leitura a frio).
  assert.deepEqual(calls.getValues, ['Folha de Agendamento', "Declaração d'Exemplo"]);

  const contadores = [...cache.itens.keys()].filter(k => !/:\d+$/.test(k));
  assert.equal(contadores.length, 2);
  contadores.forEach(chave => {
    const n = Number(cache.itens.get(chave));
    const texto = Array.from({ length: n }, (_, i) => cache.itens.get(chave + ':' + i)).join('');
    const layoutGuardado = require('node:zlib').gunzipSync(Buffer.from(texto, 'base64')).toString('utf8');
    assert.match(layoutGuardado, /effectiveFormat|columnMetadata/);
    assert.doesNotMatch(layoutGuardado, /Pessoa|Dr\(a\)|Rótulo|formattedValue|googleusercontent/);
  });

  const html = calls.html[0];
  assert.equal((html.match(/<div class="pagina">/g) || []).length, 5);
  assert.match(html, /src="data:image\/png;base64,QQ=="/);
  assert.match(html, /Dr\(a\)\. Exemplo/);
  assert.doesNotMatch(html, /Pessoa Participante/);
  // A Folha de Agendamento deste fluxo e o modelo HTML proprio (iniciais e ID em linhas separadas).
  assert.match(html, /Folha de Agendamento de Envio/);
  assert.match(html, />Participante<\/td><td class="v mono">P\.P\.<\/td><\/tr><tr><td class="k">ID<\/td><td class="v mono">007</);
  assert.equal(r.ok, true);
  // Etapas da folha separadas no log para localizar leituras lentas.
  assert.deepEqual(Object.keys(r.tempos.folhaEtapas).sort(), ['agenda', 'agendaMs', 'destinoDaGrade', 'labMs', 'logoDaGrade', 'logoMs', 'paginaMs']);
  // Neste modelo a unica imagem e da Declaracao: a folha nao a usa como logo.
  assert.equal(r.tempos.folhaEtapas.logoDaGrade, false);
  assert.deepEqual([...r.avisos], []);
  assert.match(r.conteudoHash, /^hash:/);
  assert.equal(r.quente.info.faixasFormatoDinamico, 1);
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
  const { ctx, calls, cache, ss } = diagnosticoGrade();
  ctx.transporteDocsGradeCarregar_(ss, ['Folha de Agendamento', "Declaração d'Exemplo"], {});
  const pedaco = [...cache.itens.keys()].find(k => /:0$/.test(k));
  cache.itens.set(pedaco, 'nao-e-gzip');
  const r = ctx.transporteDocsGradeCarregar_(ss, ['Folha de Agendamento', "Declaração d'Exemplo"], {});
  assert.equal(r.info.layoutsDoCache, 1);
  assert.equal(calls.fetch.filter(f => !f.url.includes('startRow')).length, 2);
  assert.equal(Object.keys(r.abas).length, 2);
});

test('limpar cache muda a revisao do layout e a proxima leitura rele o modelo de todas as abas', () => {
  const { ctx, calls, ss, propriedades } = diagnosticoGrade();
  const titulos = ['Folha de Agendamento', "Declaração d'Exemplo"];
  const leiturasLayout = () => calls.fetch.filter(f => !f.url.includes('startRow')).length;
  ctx.transporteDocsGradeCarregar_(ss, titulos, {});
  assert.equal(ctx.transporteDocsGradeCarregar_(ss, titulos, {}).info.layoutsDoCache, 2);
  assert.equal(leiturasLayout(), 1);
  const r = ctx.limparCacheLayoutTransporteHtml();
  assert.equal(r.ok, true);
  assert.equal(propriedades.get('TRANSPORTE_DOCS_GRADE_LAYOUT_REV'), r.revisao);
  assert.equal(ctx.transporteDocsGradeCarregar_(ss, titulos, {}).info.layoutsDoCache, 0);
  assert.equal(leiturasLayout(), 2);
  const negado = diagnosticoGrade({ negar: true });
  assert.throws(() => negado.ctx.limparCacheLayoutTransporteHtml(), /administradores/);
  assert.equal(negado.propriedades.size, 0);
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
  assert.match(calls.avancado[0].params.fields, /^sheets\(properties\(title\),merges,conditionalFormats\(ranges\),data\(/);
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

test('formato relido na geracao substitui o do layout em cache (fonte dos volumes e formatacao condicional)', () => {
  const sheet = aba([[celula('Volumes', { effectiveFormat: { textFormat: { fontSize: 11 } } }), celula('fim')]]);
  sheet.conditionalFormats = [{ ranges: [{ sheetId: 1, startRowIndex: 0, endRowIndex: 99, startColumnIndex: 1 }] }];
  const layout = app.transporteDocsGradeLayout_(JSON.parse(JSON.stringify(sheet)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(layout.formatosCondicionais)), [{ r0: 0, r1: 1, c0: 1, c1: 2 }]);
  assert.deepEqual([...app.transporteDocsGradeFaixasDinamicas_(layout, ['J21:L28'])], ["'Modelo'!B1:B1", "'Modelo'!J21:L28"]);

  app.transporteDocsGradeAplicarValores_(layout, somenteValores(sheet));
  const emCache = app.transporteDocsGradeHtml_(JSON.parse(JSON.stringify(layout)));
  assert.match(emCache, /font-size:10\.67pt[^>]*>Volumes</);
  app.transporteDocsGradeAplicarFormatos_(layout, { data: [{ startRow: 0, startColumn: 0, rowData: [{ values: [{ effectiveFormat: { textFormat: { fontSize: 9, bold: true } } }] }] }] });
  const relido = app.transporteDocsGradeHtml_(layout);
  assert.match(relido, /font-weight:bold;font-size:8\.73pt[^>]*>Volumes</);
});

test('aba mais alta que uma pagina A4 bloqueia em vez de ser cortada sem aviso', () => {
  const linhas = Array.from({ length: 40 }, () => [celula('x')]);
  const alta = aba(linhas, { titulo: 'Invoice longa', larguras: [100] });
  assert.ok(app.transporteDocsGradeHtml_(JSON.parse(JSON.stringify(alta))).length > 0);
  alta.data[0].rowMetadata[0].pixelSize = 21 * 40;
  assert.throws(() => app.transporteDocsGradeHtml_(alta), /"Invoice longa" excede a altura de uma página A4 no HTML \(\d+ px de 1040 px\)/);
  // Linhas ocultas nao contam, como no exportador.
  alta.data[0].rowMetadata[0].hiddenByUser = true;
  assert.ok(app.transporteDocsGradeHtml_(alta).length > 0);
});

function abasParaProtecao() {
  const folha = aba([
    [celula('Folha')], [celula('')], [{}, {}, celula('Maria Exemplo')],
    ...Array.from({ length: 11 }, () => [celula('')]),
    [{}, {}, celula('{"caixaTransporte":{}}')]
  ], { titulo: 'Folha', larguras: [100, 100, 100] });
  const declaracao = aba([[celula('Telefone de Emergência (24H): +55 54 99909-1656')], [celula('{{TRANSPORTE_CONTATO_EMERGENCIA}}')], [celula('Dr(a). Exemplo')]], { titulo: 'Declaração' });
  return { Folha: folha, 'Declaração': declaracao };
}

const appProtecao = runFiles(['TransporteCodexConfig.gs', 'TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs']);

test('protecao em memoria reproduz a copia temporaria: C3 documental, C15 vazio e contato da courier', () => {
  const abas = abasParaProtecao();
  const conteudo = appProtecao.transporteDocsGradeProtegerConteudo_(abas, {
    folhas: ['Folha', 'Folha DHL ausente'], folhaC15: 'Folha', identificacao: 'M.E. | ID: 12',
    contatoEmergencia: 'Telefone de Emergência (24H): 55 11 0000-0000', contatoAbas: ['Declaração'], nomes: ['Maria Exemplo', '']
  });
  const folha = abas.Folha.data[0].rowData;
  assert.equal(folha[2].values[2].formattedValue, 'M.E. | ID: 12');
  assert.equal(folha[14].values[2].formattedValue, '');
  const declaracao = abas['Declaração'].data[0].rowData;
  assert.equal(declaracao[0].values[0].formattedValue, 'Telefone de Emergência (24H): 55 11 0000-0000');
  assert.equal(declaracao[1].values[0].formattedValue, 'Telefone de Emergência (24H): 55 11 0000-0000');
  assert.equal(declaracao[2].values[0].formattedValue, 'Dr(a). Exemplo');
  assert.deepEqual([...conteudo.map(c => c.aba)], ['Folha', 'Declaração']);
  assert.equal(conteudo[0].valores[2][2], 'M.E. | ID: 12');
  const html = appProtecao.transporteDocsGradeMontar_(abas, [{ aba: 'Folha', copias: 1 }, { aba: 'Declaração', copias: 1 }], {});
  assert.doesNotMatch(html, /Maria Exemplo|caixaTransporte|99909/);
});

test('contato de emergencia so e trocado nas abas indicadas para a courier', () => {
  const abas = abasParaProtecao();
  appProtecao.transporteDocsGradeProtegerConteudo_(abas, {
    folhas: ['Folha'], folhaC15: 'Folha', identificacao: 'M.E. | ID: 12',
    contatoEmergencia: 'Telefone de Emergência (24H): 55 11 0000-0000', contatoAbas: ['Ficha'], nomes: []
  });
  const declaracao = abas['Declaração'].data[0].rowData;
  assert.equal(declaracao[0].values[0].formattedValue, 'Telefone de Emergência (24H): +55 54 99909-1656');
  assert.equal(declaracao[1].values[0].formattedValue, '{{TRANSPORTE_CONTATO_EMERGENCIA}}');
  // MARKEN: somente a Ficha de Emergencia.
  assert.deepEqual([...appProtecao.TRANSPORTE_DOCS_GRADE_CONTATO_ABAS_.MARKEN], ['fichaEmergenciaMarken']);
});

test('protecao bloqueia quando o nome do participante continua em outra celula, sem expor o nome', () => {
  const abas = abasParaProtecao();
  abas['Declaração'].data[0].rowData[2].values[0].formattedValue = 'Participante: MARIA  exemplo';
  assert.throws(() => appProtecao.transporteDocsGradeProtegerConteudo_(abas, {
    folhas: ['Folha'], folhaC15: 'Folha', identificacao: 'M.E. | ID: 12', contatoEmergencia: '', nomes: ['Maria Exemplo']
  }), err => /^PDF bloqueado: identificação nominal/.test(err.message) && !/maria/i.test(err.message));
});

test('locale diferente de pt_BR e sinalizado no diagnostico', () => {
  const { ctx } = diagnosticoGrade({ locale: 'en_US' });
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(r.ok, false);
  assert.deepEqual([...r.avisos], ['LOCALE_DIFERENTE_DE_PT_BR']);
});

test('texto a direita invade so as vazias necessarias a esquerda; centralizado invade os dois lados mantendo o centro', () => {
  const longo = 'Texto longo alinhado';
  const direita = app.transporteDocsGradeHtml_(aba([[
    celula('a'), {}, {}, celula(longo, { effectiveFormat: { textFormat: { fontSize: 10 }, horizontalAlignment: 'RIGHT' } })
  ]], { larguras: [50, 60, 80, 60] }));
  // 'Texto longo alinhado' (~125 px) cabe em C + D: a coluna B continua livre e o
  // texto 'a', alinhado a esquerda, a ocupa como antes.
  assert.match(direita, /<td colspan="2" style="[^"]*text-align:left[^"]*">a<\/td><td colspan="2" style="[^"]*text-align:right[^"]*overflow:hidden[^"]*">Texto longo alinhado<\/td>/);

  const centro = app.transporteDocsGradeHtml_(aba([[
    {}, {}, celula(longo, { effectiveFormat: { textFormat: { fontSize: 10 }, horizontalAlignment: 'CENTER' } }), {}, celula('fim')
  ]], { larguras: [40, 30, 50, 60, 40] }));
  // Um lado de cada vez: B e D; D e 30 px mais larga, entao a direita recebe o recuo extra.
  assert.match(centro, /<td style="[^"]*"><\/td><td colspan="3" style="[^"]*text-align:center[^"]*padding:[\d.]+px 32\.0px [\d.]+px 2px[^"]*">Texto longo alinhado<\/td><td style="[^"]*">fim<\/td>/);

  // Sem espaco livre dos dois lados, o centralizado nao invade (o Sheets corta).
  const bloqueado = app.transporteDocsGradeHtml_(aba([[
    celula('x'), celula(longo, { effectiveFormat: { textFormat: { fontSize: 10 }, horizontalAlignment: 'CENTER' } }), {}, celula('y')
  ]], { larguras: [40, 50, 60, 40] }));
  assert.doesNotMatch(bloqueado, /colspan/);

  // Texto curto a direita nao absorve nada; o alinhado a esquerda segue como antes.
  const curto = app.transporteDocsGradeHtml_(aba([[{}, celula('12', { effectiveValue: { numberValue: 12 } })]], { larguras: [50, 60] }));
  assert.doesNotMatch(curto, /colspan/);
});

test('mesclagem com origem em linha ou coluna oculta aparece na primeira linha/coluna visivel', () => {
  const linhas = [[celula('Titulo mesclado'), {}, celula('fim')], [{}, {}, {}], [{}, {}, {}]];
  const sheet = aba(linhas, { larguras: [80, 80, 80], merges: [{ startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 2 }] });
  sheet.data[0].rowMetadata[0].hiddenByUser = true;
  const html = app.transporteDocsGradeHtml_(sheet);
  assert.match(html, /<tr[^>]*><td colspan="2" rowspan="2"[^>]*>Titulo mesclado<\/td><td[^>]*><\/td><\/tr><tr[^>]*><td[^>]*><\/td><\/tr><\/table>/);

  const porColuna = aba(linhas.map(l => l.slice()), { larguras: [80, 80, 80], ocultas: [0], merges: [{ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 }] });
  assert.match(app.transporteDocsGradeHtml_(porColuna), /<tr[^>]*><td style="[^"]*">Titulo mesclado<\/td><td style="[^"]*">fim<\/td><\/tr>/);
});

test('imagens flutuantes sao posicionadas pela ancora e deslocamento, na escala da pagina', () => {
  const sheet = aba([[celula('a'), {}, celula('b')], [{}, {}, {}]], { larguras: [100, 100, 100] });
  sheet.imagensFlutuantes = [{ r: 1, c: 1, x: 10, y: 4, w: 120, h: 40, url: 'https://lh3.googleusercontent.com/logo' }];
  const html = app.transporteDocsGradeHtml_(sheet, { imagemSrc: url => url + '#src' });
  // A imagem vai numa linha de altura zero logo antes da linha da ancora (linha 2),
  // deslocada so dentro dela: o crescimento das linhas acima no HTML nao a desloca.
  assert.match(html, /^<table[\s\S]*<\/tr><tr style="height:0"><td colspan="3" style="padding:0;border:0;height:0;line-height:0"><div style="position:relative;height:0"><img src="https:\/\/lh3\.googleusercontent\.com\/logo#src" alt="" style="position:absolute;left:110\.0px;top:3\.9px;width:120\.0px;height:38\.8px"><\/div><\/td><\/tr><tr style="height:[^"]*">(<td[^>]*>[^<]*<\/td>)+<\/tr><\/table>$/);
  // Ancora em linha oculta: vai para a primeira linha visivel depois dela.
  const oculta = aba([[celula('a')], [celula('b')], [celula('c')]], { larguras: [100] });
  oculta.data[0].rowMetadata[1].hiddenByUser = true;
  oculta.imagensFlutuantes = [{ r: 1, c: 0, x: 0, y: 0, w: 10, h: 10, url: 'u' }];
  assert.match(app.transporteDocsGradeHtml_(oculta), /<\/tr><tr style="height:0">[\s\S]*<\/tr><tr style="height:[^"]*"><td[^>]*>c<\/td><\/tr><\/table>$/);
  // Sem imagens flutuantes o HTML continua so a tabela.
  assert.match(app.transporteDocsGradeHtml_(aba([[celula('a')]])), /^<table/);
});

test('leitura a frio incorpora imagens flutuantes com origem, conta as demais e so envia o token a hosts Google', () => {
  const { ctx, calls, ss } = diagnosticoGrade();
  const original = ss.getSheetByName;
  ss.getSheetByName = nome => Object.assign(original(nome), nome !== 'Folha de Agendamento' ? {} : {
    getImages: () => [
      { getUrl: () => 'https://exemplo.org/logo.png', getAnchorCell: () => ({ getRow: () => 1, getColumn: () => 2 }), getAnchorCellXOffset: () => 3, getAnchorCellYOffset: () => 0, getWidth: () => 50, getHeight: () => 20 },
      { getUrl: () => null, getAnchorCell: () => ({ getRow: () => 1, getColumn: () => 1 }) }
    ]
  });
  const r = ctx.transporteDocsGradeCarregar_(ss, ['Folha de Agendamento', "Declaração d'Exemplo"], {});
  assert.deepEqual(calls.fetchAll.flat().sort(), ['https://exemplo.org/logo.png sem-token', 'https://lh3.googleusercontent.com/a?key=1 Bearer token-teste']);
  const folha = r.abas['Folha de Agendamento'];
  assert.equal(folha.imagensFlutuantes.length, 1);
  assert.equal(folha.imagensFlutuantes[0].url, 'data:image/png;base64,QQ==');
  assert.equal(r.info.imagensOmitidas, 1);
  // A contagem vem do layout: a leitura a quente (cache) continua sinalizando.
  assert.equal(ctx.transporteDocsGradeCarregar_(ss, ['Folha de Agendamento', "Declaração d'Exemplo"], {}).info.imagensOmitidas, 1);
  assert.match(ctx.transporteDocsGradeMontar_(r.abas, [{ aba: 'Folha de Agendamento', copias: 1 }], {}), /position:absolute/);
});

test('imagem flutuante sem origem usa o rodape (imagem de celula mais abaixo) da aba de origem, na mesma posicao', () => {
  const { ctx, ss } = diagnosticoGrade();
  const original = ss.getSheetByName;
  const semOrigem = { getUrl: () => '', getAnchorCell: () => ({ getRow: () => 2, getColumn: () => 1 }), getAnchorCellXOffset: () => 0, getAnchorCellYOffset: () => 0, getWidth: () => 200, getHeight: () => 60 };
  ss.getSheetByName = nome => Object.assign(original(nome), { getImages: () => nome === 'Folha de Agendamento' ? [semOrigem] : [] });
  const opcoes = { imagensCodigo: { 'Folha de Agendamento': "Declaração d'Exemplo" } };
  // So a Folha e lida: a imagem da aba de origem vem da propria planilha.
  const r = ctx.transporteDocsGradeCarregar_(ss, ['Folha de Agendamento'], opcoes);
  assert.equal(r.info.imagensOmitidas, 0);
  const img = r.abas['Folha de Agendamento'].imagensFlutuantes;
  assert.deepEqual(JSON.parse(JSON.stringify(img)), [{ r: 1, c: 0, x: 0, y: 0, w: 200, h: 60, url: 'data:image/png;base64,QQ==' }]);
  const quente = ctx.transporteDocsGradeCarregar_(ss, ['Folha de Agendamento'], opcoes);
  assert.equal(quente.info.layoutsDoCache, 1);
  assert.match(ctx.transporteDocsGradeMontar_(quente.abas, [{ aba: 'Folha de Agendamento', copias: 1 }], {}),
    /<img src="data:image\/png;base64,QQ==" alt="" style="position:absolute;left:0\.0px;/);
  // Duas imagens sem origem na mesma aba: nenhuma e substituida e ambas ficam sinalizadas.
  ss.getSheetByName = nome => Object.assign(original(nome), { getImages: () => nome === 'Folha de Agendamento' ? [semOrigem, semOrigem] : [] });
  const duas = ctx.transporteDocsGradeCarregar_(ss, ['Folha de Agendamento'], Object.assign({ ignorarCache: true }, opcoes));
  assert.equal(duas.info.imagensOmitidas, 2);
  assert.equal(duas.abas['Folha de Agendamento'].imagensFlutuantes.length, 0);
  assert.equal(ctx.transporteDocsGradeImagemRodape_([{ r: 0, url: 'logo' }, { r: 52, url: 'rodape' }, { r: 3, url: 'x' }]), 'rodape');
});

test('texto quebrado que faz a linha crescer alem da pagina bloqueia mesmo com alturas nominais que cabem', () => {
  const paragrafo = 'Texto de declaracao que ocupa varias linhas quando quebrado na largura da coluna. '.repeat(30);
  const linhas = Array.from({ length: 40 }, () => [celula('x')]);
  const cabe = aba(linhas, { titulo: 'Declaracao', larguras: [300] });
  assert.ok(app.transporteDocsGradeHtml_(JSON.parse(JSON.stringify(cabe))).length > 0);
  linhas[0] = [celula(paragrafo, { effectiveFormat: { textFormat: { fontSize: 10 }, wrapStrategy: 'WRAP' } })];
  assert.throws(() => app.transporteDocsGradeHtml_(aba(linhas, { titulo: 'Declaracao', larguras: [300] })), /"Declaracao" excede a altura/);
  // O mesmo texto sem quebra fica numa linha so e nao cresce.
  linhas[0] = [celula(paragrafo, { effectiveFormat: { textFormat: { fontSize: 10 }, wrapStrategy: 'CLIP' } })];
  assert.ok(app.transporteDocsGradeHtml_(aba(linhas, { titulo: 'Declaracao', larguras: [300] })).length > 0);
});

test('estimativa de texto da Arial distingue largura de caracteres e conta linhas explicitas', () => {
  assert.ok(app.transporteDocsHtmlLarguraTextoPx_('MMMM', 10) > app.transporteDocsHtmlLarguraTextoPx_('iiii', 10) * 2);
  assert.ok(app.transporteDocsHtmlLarguraTextoPx_('abc', 10, true) > app.transporteDocsHtmlLarguraTextoPx_('abc', 10));
  assert.equal(app.transporteDocsHtmlAlturaTextoPx_('a\nb\nc', 1000, 12, false, false), 3 * 12 * 96 / 72 * 1.15);
  assert.equal(app.transporteDocsHtmlAlturaTextoPx_('palavra '.repeat(20), 100, 10, false, true) > 4 * 10 * 96 / 72 * 1.15, true);
});

test('diagnostico sinaliza imagem que nao pode ser incorporada', () => {
  const { ctx, ss } = diagnosticoGrade();
  const original = ss.getSheetByName;
  ss.getSheetByName = nome => Object.assign(original(nome), { getImages: () => [{ getUrl: () => '', getAnchorCell: () => ({}) }] });
  const r = ctx.diagnosticarGradeTransporteHtml();
  assert.equal(r.ok, false);
  assert.deepEqual([...r.avisos], ['IMAGEM_NAO_INCORPORADA']);
});
