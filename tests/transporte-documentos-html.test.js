'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

const app = runFile('TransporteDocumentosHtml.gs');

function dados(extra) {
  return Object.assign({
    courier: 'MARKEN',
    temperatura: 'CONGELADO',
    dataEnvio: '2026-11-05',
    awb: '620X00000000',
    medico: { nome: 'Pessoa Exemplo', cpf: '000.000.000-00', cremers: '123' },
    destino: { nome: 'Lab Exemplo', endereco: '1 Example Drive', cidadePais: 'Cidade, US', zip: '00000', telefone: '(000) 0000000' },
    materiais: [{ tipo: 'plasma', tubos: 4, formula: '4×1,0', total: 4 }],
    geloSecoKg: 4,
    contatoEmergencia: 'Telefone de Emergência (24H): +55 54 99909-1656',
    invoice: { packages: 1, totalWeight: '5 Kg' }
  }, extra || {});
}

function paginas(html) {
  return (html.match(/<div class="pagina">/g) || []).length;
}

test('monta as copias na ordem informada, uma pagina por copia', () => {
  const html = app.transporteDocsHtmlMontar_(dados(), [
    { chave: 'declaracaoTransp', copias: 4 },
    { chave: 'invoiceMarken', copias: 4 }
  ], {});
  assert.equal(paginas(html), 8);
  const ordem = html.split('<div class="pagina">').slice(1).map(p => (p.includes('>INVOICE<') ? 'I' : 'D')).join('');
  assert.equal(ordem, 'DDDDIIII');
  assert.throws(() => app.transporteDocsHtmlMontar_(dados(), [{ chave: 'peticaoAnuencia', copias: 1 }], {}), /sem modelo HTML/);
});

test('dados do usuario sao escapados e o texto do courier aceita so formatacao simples', () => {
  const html = app.transporteDocsHtmlMontar_(dados({
    awb: '<img src=x onerror=alert(1)>',
    destino: { nome: '"><script>x()</script>' },
    conteudoDeclaracao: 'texto <b>forte</b> <a href="javascript:x">link</a> <script>y()</script>'
  }), [{ chave: 'declaracaoTransp', copias: 1 }, { chave: 'invoiceMarken', copias: 1 }], {});
  assert.doesNotMatch(html, /<script|<img src=x|<a href/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /texto <b>forte<\/b> &lt;a href=&quot;javascript:x&quot;&gt;link&lt;\/a&gt;/);
});

test('temperaturas marcam as mesmas caixas da automacao da planilha', () => {
  const casos = {
    AMBIENTE: [true, false, false],
    REFRIGERADO: [false, true, false],
    CONGELADO: [false, false, true],
    'AMBIENTE + CONGELADO': [true, false, true],
    'AMBIENTE + REFRIGERADO': [true, true, false]
  };
  Object.entries(casos).forEach(([temperatura, esperado]) => {
    const t = app.transporteDocsHtmlTemperaturas_(temperatura);
    assert.deepEqual([t.ambiente, t.refrigerado, t.congelado], esperado, temperatura);
  });
});

test('itens da invoice seguem a ordem da declaracao, limite de 5 e regra de laminas', () => {
  const tipos = ['vacina', 'fezes', 'saliva', 'tecido', 'plasma', 'urina', 'soro', 'sangue'];
  const materiais = app.transporteDocsHtmlMateriais_({ materiais: tipos.map(tipo => ({ tipo, tubos: 1, formula: '1×1,0', total: 1 })) });
  const itens = app.transporteDocsHtmlItensInvoice_(materiais, 'Lâminas de hematologia');
  assert.equal(itens.length, 5);
  assert.deepEqual([...itens.map(i => i.hts)], ['3002.90.5210', '3002.12.0020', '3002.90.5250', '3002.12.0010', '3002.90.5250']);
  assert.equal(itens[0].pkg, 'Tube(s) + Slides');
  assert.equal(app.transporteDocsHtmlItensInvoice_(materiais, '')[0].pkg, 'Tube(s)');
});

test('volumes acima do espaco seguro bloqueiam a geracao como na planilha', () => {
  assert.equal(app.transporteDocsHtmlFonteVolume_('x'.repeat(30)), 11);
  assert.equal(app.transporteDocsHtmlFonteVolume_('x'.repeat(36)), 10);
  assert.equal(app.transporteDocsHtmlFonteVolume_('x'.repeat(42)), 9);
  assert.throws(() => app.transporteDocsHtmlMontar_(dados({
    materiais: [{ tipo: 'soro', tubos: 9, formula: 'x'.repeat(43), total: 9 }]
  }), [{ chave: 'declaracaoTransp', copias: 1 }], {}), /linha\(s\) 22/);
});

test('datas, totais e assinatura seguem os formatos dos modelos', () => {
  assert.equal(app.transporteDocsHtmlDataExtenso_('2026-03-05'), '5 de março de 2026');
  assert.equal(app.transporteDocsHtmlDataIso_(new Date(2026, 10, 5)), '2026-11-05');
  assert.throws(() => app.transporteDocsHtmlDataIso_('05/11/2026'), /Data de envio inv/);
  assert.equal(app.transporteDocsHtmlNumero_(1234.5, 2), '1.234,50');
  assert.equal(app.transporteDocsHtmlAssinatura_({ nome: 'A', cremers: '1' }), 'Dr(a). A - CREMERS: 1.');
  assert.equal(app.transporteDocsHtmlAssinatura_({ nome: 'A' }), '');
  const html = app.transporteDocsHtmlMontar_(dados({ geloSecoKg: null }), [{ chave: 'declaracaoTransp', copias: 1 }, { chave: 'invoiceMarken', copias: 1 }], {});
  assert.match(html, />---</);
  assert.match(html, /Caxias do Sul, 5 de novembro de 2026/);
  assert.equal((html.match(/USD 10,00/g) || []).length, 3);
});

function diagnosticoComSimuladores(options = {}) {
  const calls = { html: [], folders: [], files: [], logs: [] };
  const pdfText = options.pdfText || Array.from({ length: 10 }, () => '<< /Type /Page >>').join('') + '<< /Type /Pages >>';
  const pdfBlob = {
    name: '',
    setName(name) { this.name = name; return this; },
    getDataAsString: () => pdfText,
    getBytes: () => new Array(pdfText.length).fill(0)
  };
  const folder = {
    createFile(blob) { calls.files.push(blob.name); return { getName: () => blob.name, getUrl: () => 'https://drive.example/file' }; }
  };
  const ctx = runFile('TransporteDocumentosHtml.gs', {
    codexAssertAdmin_: () => {
      if (options.negar) throw new Error('Acesso permitido apenas para administradores.');
      return { ok: true, role: 'admin', userEmail: 'admin@example.com' };
    },
    reqExamesLogoSrc_: () => 'data:image/png;base64,AAAA',
    HtmlService: { createHtmlOutput: html => { calls.html.push(html); return { getBlob: () => ({ getAs: () => pdfBlob }) }; } },
    MimeType: { PDF: 'application/pdf' },
    Utilities: { formatDate: () => '20261105-120000' },
    DriveApp: {
      getRootFolder: () => ({
        getFoldersByName: name => { calls.folders.push(name); return { hasNext: () => !!options.pastaExiste, next: () => folder }; },
        createFolder: name => { calls.folders.push('create:' + name); return folder; }
      })
    },
    Logger: { log: line => calls.logs.push(line) }
  });
  return { ctx, calls };
}

test('diagnostico gera PDF ficticio, confere paginas e nao registra e-mail no log', () => {
  const { ctx, calls } = diagnosticoComSimuladores();
  const r = ctx.diagnosticarPdfTransporteHtml();
  assert.equal(r.ok, true);
  assert.equal(r.paginas, 10);
  assert.equal(r.paginasEsperadas, 10);
  assert.equal(r.logoIncorporado, true);
  assert.equal(paginas(calls.html[0]), 10);
  assert.deepEqual(calls.folders, ['IPS - Diagnóstico PDF HTML', 'create:IPS - Diagnóstico PDF HTML']);
  assert.deepEqual(calls.files, ['diagnostico-transporte-html-20261105-120000.pdf']);
  assert.equal(calls.logs.length, 1);
  assert.doesNotMatch(calls.logs[0], /@|Pessoa|Maria/);
  ['logoMs', 'htmlMs', 'conversaoMs', 'driveMs', 'totalMs'].forEach(k => assert.equal(typeof r.tempos[k], 'number', k));
});

test('diagnostico sinaliza quebra de pagina divergente e reutiliza a pasta existente', () => {
  const { ctx, calls } = diagnosticoComSimuladores({ pdfText: '<< /Type /Page >><< /Type /Pages >>', pastaExiste: true });
  const r = ctx.diagnosticarPdfTransporteHtml();
  assert.equal(r.ok, false);
  assert.equal(r.paginas, 1);
  assert.deepEqual(calls.folders, ['IPS - Diagnóstico PDF HTML']);
});

test('diagnostico exige administrador antes de gerar qualquer arquivo', () => {
  const { ctx, calls } = diagnosticoComSimuladores({ negar: true });
  assert.throws(() => ctx.diagnosticarPdfTransporteHtml(), /administradores/);
  assert.equal(calls.html.length, 0);
  assert.equal(calls.files.length, 0);
});

test('caso limite do diagnostico cabe nas regras de volume e nos 5 itens da invoice', () => {
  const docs = app.transporteDocsHtmlDadosDiagnostico_();
  const limite = docs[2].dados;
  const materiais = app.transporteDocsHtmlMateriais_(limite);
  assert.ok(materiais.some(m => m.fonte < 11));
  assert.equal(app.transporteDocsHtmlItensInvoice_(materiais, limite.outroTipo).length, 5);
});

test('campos livres reduzem a fonte proporcionalmente, com minimo de 7 pt', () => {
  assert.equal(app.transporteDocsHtmlFonteAjustada_('x'.repeat(26), 11, 26), 11);
  assert.equal(app.transporteDocsHtmlFonteAjustada_('x'.repeat(52), 11, 26), 7);
  assert.equal(app.transporteDocsHtmlFonteAjustada_('x'.repeat(30), 11, 26), 9.5);
  const html = app.transporteDocsHtmlMontar_(dados({ medico: { nome: 'x'.repeat(39), cpf: '0', cremers: '1' } }), [{ chave: 'declaracaoTransp', copias: 1 }], {});
  // 11 * 26 / 39 = 7,3 pt no Sheets, reduzido pela escala da pagina (~0,75).
  assert.match(html, /font-size:5\.47pt;font-weight:bold;text-align:center;vertical-align:bottom">x{39}</);
});

test('caixas marcadas nao dependem de cor de fundo, que o conversor HtmlService nao imprime', () => {
  const html = app.transporteDocsHtmlMontar_(dados(), [{ chave: 'declaracaoTransp', copias: 1 }], {});
  const cssCaixa = html.match(/\.cb\{[^}]*\}/)[0];
  assert.doesNotMatch(cssCaixa, /background/);
  assert.match(cssCaixa, /color:#000/);
  assert.deepEqual([...new Set(html.match(/background:[^;}]+/g))], ['background:#fff']);
  assert.equal((html.match(/<span class="cb">&#10003;<\/span>/g) || []).length, 2);
});

test('volumes sao compactados como em transporteAjustarVolumesDeclaracao_ antes do limite de 42 caracteres', () => {
  const { runFiles } = require('./helpers/load-app-script');
  const comRegras = runFiles(['TransporteCodexConfig.gs', 'TransporteDocumentosHtml.gs']);
  const formula = '2 x 4.0 + 2 x 4.0 + 2 x 4.0 + 2 x 4.0 + 2 x 4.0';
  assert.ok(formula.length > 42);
  const linha = comRegras.transporteDocsHtmlMateriais_({ materiais: [{ tipo: 'soro', tubos: 10, formula, total: 40 }] })[1];
  assert.equal(linha.formula, '2×4,0; 2×4,0; 2×4,0; 2×4,0; 2×4,0');
  assert.equal(linha.fonte, 10);
  // Sem as regras de volume carregadas, o texto segue como informado.
  assert.throws(() => app.transporteDocsHtmlMateriais_({ materiais: [{ tipo: 'soro', tubos: 10, formula, total: 40 }] }), /linha\(s\) 22/);
});
