'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { inventarioEscritas, TRANSPORTE_LAYOUT_ABAS_ } = require('../tools/export-transporte-layouts');

const ARQUIVO = readProjectFile('TransporteLayoutsDados.html');
// Objetos do script vem de outro contexto (vm): compare pelo conteudo.
const plano = (v) => JSON.parse(JSON.stringify(v));

function modulo(extra) {
  return runFiles(['TransporteLayoutsModelo.gs'], Object.assign({ Session: { getScriptTimeZone: () => 'America/Sao_Paulo' } }, extra || {}));
}

// RichTextValue/TextStyle do Apps Script no subconjunto que o preenchimento e a planilha em memoria usam.
function construtoresTextoRico() {
  return {
    newTextStyle: () => {
      const e = { bold: null, italic: null, underline: null };
      const b = {
        setBold(v) { e.bold = v; return b; }, setItalic(v) { e.italic = v; return b; }, setUnderline(v) { e.underline = v; return b; },
        build: () => ({ isBold: () => e.bold, isItalic: () => e.italic, isUnderline: () => e.underline })
      };
      return b;
    },
    newRichTextValue: () => {
      let texto = '';
      const trechos = [];
      const b = {
        setText(t) { texto = t; return b; },
        setTextStyle(ini, fim, estilo) { trechos.push({ ini, fim, estilo }); return b; },
        build: () => ({
          getText: () => texto,
          getRuns: () => trechos.map((t) => ({ getTextStyle: () => t.estilo, getStartIndex: () => t.ini, getEndIndex: () => t.fim }))
        })
      };
      return b;
    }
  };
}

function servidor() {
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs',
    'TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteFolhaAgendamentoHtml.gs', 'TransporteLayoutsModelo.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    SpreadsheetApp: construtoresTextoRico(),
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, getAll: () => ({}), putAll() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'PLANILHA-REAL', setProperty() {} }),
      getDocumentProperties: () => ({ getProperty: () => '' })
    }
  });
  s.getMedicos = () => [{ nome: 'Pessoa Investigadora', cpf: '000.000.000-00', cremers: '12345' }];
  s.transporteReadLabCentral_ = () => [{ nomeAbreviado: 'LAB X', nomeCompleto: 'Laboratorio Exemplo', endereco: 'Rua Exemplo 1', cidade: 'Cidade', pais: 'EUA' }];
  s.transporteReadAgendaCourierConfigs_ = () => ({ marken: { nome: 'MARKEN', empresa1: 'Courier Exemplo Ltda', cnpj1: '00.000.000/0001-00' } });
  s.transporteReadProjetosDireto_ = () => [{ nomeAbreviado: 'Estudo X', numeroCE: 'CE-1', expedienteCE: 'EXP-1', tituloCompleto: 'Titulo do Estudo X' }];
  return s;
}

function registroMarken(extra) {
  const materiais = Array(8).fill(null).map(() => ({}));
  materiais[1] = { ativo: true, material: 'Soro', tipo: 'soro', tubos: 2, formula: '2x1,0', total: 2, unit: 'mL' };
  return Object.assign({
    paciente: 'Pessoa Participante Teste', identificacaoParticipante: 'ID-001', protocolo: 'Estudo X',
    investigador: 'Pessoa Investigadora', temperatura: 'CONGELADO', dataColeta: '2026-11-05', dataEnvio: '2026-11-05',
    horaEnvio: '10:00', courier: 'MARKEN', destino: 'LAB X', awb: '123456789012', agendadoPor: 'Equipe',
    observacoes: '', materiais: materiais, solicitarCaixa: 'Sim'
  }, extra || {});
}

function texto(abas, titulo, a1, s) {
  const f = s.transporteLayoutsFaixa_(a1);
  const row = abas[titulo].data[0].rowData[f.r0];
  const cell = row && row.values && row.values[f.c0];
  return cell && cell.formattedValue !== undefined ? cell.formattedValue : '';
}

test('arquivo de layouts traz as 17 abas-modelo e cada uma vira pagina pelo renderizador da grade', () => {
  const s = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteLayoutsModelo.gs'], { Utilities: {} });
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  assert.deepEqual(Object.keys(arquivo.abas).sort(), Object.keys(TRANSPORTE_LAYOUT_ABAS_).sort());
  for (const chave of Object.keys(arquivo.abas)) {
    const sheet = s.transporteLayoutsExpandir_(arquivo, chave);
    assert.equal(sheet.properties.title, TRANSPORTE_LAYOUT_ABAS_[chave]);
    // Formulario PINEX (so na courier "PINEX (Agendamento)", ainda sem formato HTML) passa da
    // altura de uma pagina A4 na grade; o bloqueio de altura deve continuar valendo para ele.
    if (chave === 'formularioPinex') {
      assert.throws(() => s.transporteDocsGradeHtml_(sheet, {}), /excede a altura/);
      continue;
    }
    const html = s.transporteDocsGradeHtml_(sheet, {});
    assert.match(html, /^<table class="grade"/, chave);
  }
});

test('layout traz logo e rodape: imagem de celula e rodape flutuante, guardados uma vez', () => {
  const s = modulo();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const ids = Object.keys(arquivo.imagens);
  assert.ok(ids.length >= 2);
  for (const id of ids) assert.match(arquivo.imagens[id], /^data:image\/(png|jpeg);base64,/);
  const imagemCelula = (chave, a1) => {
    const f = s.transporteLayoutsFaixa_(a1);
    const cell = s.transporteLayoutsExpandir_(arquivo, chave).data[0].rowData[f.r0].values[f.c0];
    return cell.userEnteredValue && cell.userEnteredValue.imageValue.imageProperties.contentUrl;
  };
  const logo = imagemCelula('declaracaoTransp', 'A1');
  const rodape = imagemCelula('declaracaoTransp', 'B53');
  assert.match(logo, /^data:image\//);
  assert.match(rodape, /^data:image\//);
  assert.notEqual(logo, rodape);
  // As abas que hoje recebem o rodape da Declaracao (TRANSPORTE_DOCS_GRADE_IMAGENS_CODIGO_) o tem flutuante.
  for (const chave of ['invoiceMarken', 'declaracaoDhl', 'invoicePinex', 'usdaStatementPinex']) {
    const flutuantes = s.transporteLayoutsExpandir_(arquivo, chave).imagensFlutuantes;
    assert.equal(flutuantes.length, 1, chave);
    assert.equal(flutuantes[0].url, rodape, chave);
  }
});

test('layout versionado nao guarda texto em celula gravada pelo codigo (dados de envio)', () => {
  const s = modulo();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const escritas = inventarioEscritas();
  for (const [chave, aba] of Object.entries(arquivo.abas)) {
    const variaveis = new Set(aba.variaveis);
    for (const a1 of escritas[chave] || []) {
      const f = s.transporteLayoutsFaixa_(a1);
      const cell = (aba.layout.celulas[f.r0] || [])[f.c0];
      // Uma gravacao nova em celula com texto fixo exige reexportar o layout.
      assert.ok(!cell || cell.t === undefined, `${chave}!${a1} tem texto no layout e e gravada pelo codigo; reexporte`);
      assert.ok(variaveis.has(a1) || aba.formulas[a1], `${chave}!${a1} nao esta marcada como variavel`);
    }
    for (const a1 of aba.variaveis) {
      const f = s.transporteLayoutsFaixa_(a1);
      const cell = (aba.layout.celulas[f.r0] || [])[f.c0];
      assert.ok(!cell || cell.t === undefined, `${chave}!${a1}`);
    }
  }
  // Lido por HtmlService: nenhum < ou > literal.
  assert.doesNotMatch(ARQUIVO, /[<>]/);
  // Nenhuma identificacao de participante (C3 das folhas) nem AWB no arquivo.
  assert.doesNotMatch(ARQUIVO, /\bID: /);
});

// Utilities.formatDate do Apps Script so para o padrao 'Z' (deslocamento), com fuso real via Intl.
function formatDateFuso(data, fuso, padrao) {
  assert.equal(padrao, 'Z');
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: fuso, timeZoneName: 'longOffset' }).formatToParts(data)
    .find((p) => p.type === 'timeZoneName').value;
  const m = nome.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? m[1] + m[2] + m[3] : '+0000';
}

test('formatador reproduz os formatos de numero e data usados nas abas-modelo (pt_BR)', () => {
  // Como no Apps Script: fuso do script America/Sao_Paulo, independente do fuso da maquina.
  const s = modulo({ Utilities: { formatDate: formatDateFuso } });
  const f = s.transporteLayoutsFormatar_;
  const serial = 46331; // 05/11/2026
  assert.equal(f(serial, { type: 'DATE', pattern: 'dd/MM/yyyy' }), '05/11/2026');
  assert.equal(f(serial, { type: 'DATE', pattern: 'yyyy"-"mm"-"dd' }), '2026-11-05');
  assert.equal(f(serial + 0.4375, { type: 'DATE_TIME', pattern: 'dd/mm/yyyy hh:mm' }), '05/11/2026 10:30');
  assert.equal(f(0.4375, { type: 'TIME', pattern: 'h:mm' }), '10:30');
  assert.equal(f(2, { type: 'NUMBER', pattern: '0.00' }), '2,00');
  assert.equal(f(4, { type: 'NUMBER', pattern: '0.0' }), '4,0');
  assert.equal(f(0.0025, { type: 'NUMBER', pattern: '0.00000' }), '0,00250');
  assert.equal(f(1234.5, { type: 'CURRENCY', pattern: '[$USD ]#,##0.00' }), 'USD 1.234,50');
  assert.equal(f(25, { type: 'CURRENCY', pattern: '"$"#,##0.00' }), '$25,00');
  assert.equal(f(12345, { type: 'NUMBER', pattern: '#,##0' }), '12.345');
  assert.equal(f(2.5, null), '2,5');
  assert.equal(f('texto', { type: 'NUMBER', pattern: '0.00' }), 'texto');
  assert.equal(f(true, null), 'TRUE');
  // Date gravada pelo script: exibida no fuso do negocio (UTC-3).
  assert.equal(f(new Date(Date.UTC(2026, 10, 5, 2, 0)), { type: 'DATE', pattern: 'dd/MM/yyyy' }), '04/11/2026');
  assert.equal(f(new Date(Date.UTC(2026, 10, 5, 13, 0)), { type: 'DATE', pattern: 'dd/MM/yyyy' }), '05/11/2026');
});

test('avaliador cobre as formulas do modelo: referencias, soma, data por extenso e condicoes', () => {
  const s = modulo();
  const valores = {
    'Folha de Agendamento': { C5: 'Pessoa Investigadora', C8: new Date(Date.UTC(2026, 10, 5, 15)), C12: '123' },
    'Declaração de Transporte': { N21: 2, N22: 1.5, N23: '', B49: 'Assinatura', M10: '12345' },
    'Proforma Invoice (OCASA)': { F30: true, H30: false, J30: true }
  };
  const ler = (aba, r, c) => {
    const a1 = s.transporteLayoutsColuna_(c) + (r + 1);
    const v = (valores[aba] || {})[a1];
    return v === undefined ? '' : v;
  };
  const av = (formula, aba) => s.transporteLayoutsAvaliarFormula_(formula, aba || 'Declaração de Transporte', ler);
  assert.equal(av("='Folha de Agendamento'!C5"), 'Pessoa Investigadora');
  assert.equal(av('=SUM(N21:N28)'), 3.5);
  assert.equal(av("='Folha de Agendamento'!C5 & \" M.D.\""), 'Pessoa Investigadora M.D.');
  assert.equal(av('="Caxias do Sul, "&DAY(INDIRECT("\'Folha de Agendamento\'!C8"))&" de "&TEXT(INDIRECT("\'Folha de Agendamento\'!C8");"mmmm")&" de "&YEAR(INDIRECT("\'Folha de Agendamento\'!C8"))&"."'),
    'Caxias do Sul, 5 de novembro de 2026.');
  assert.equal(av('=IF(AND(F30=TRUE; J30=TRUE); "4,0"; IF(OR(F30=TRUE; H30=TRUE); "---"; IF(J30=TRUE; "4,0"; "")))', 'Proforma Invoice (OCASA)'), '4,0');
  assert.equal(av('=IF(AND(B49<>""; M10<>""); "Dr(a). "&B49&" - CREMERS: "&M10; "")'), 'Dr(a). Assinatura - CREMERS: 12345');
  assert.equal(av('= "CREMERS " & M10'), 'CREMERS 12345');
  assert.equal(av('=N23'), '');
  assert.throws(() => av('=VLOOKUP(A1;B1:C2;2)'), /Funcao nao suportada/);
});

test('planilha em memoria segue a semantica do Sheets usada pelo preenchimento', () => {
  const s = modulo();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const ss = s.transporteLayoutsPlanilha_(arquivo);
  const decl = ss.getSheetByName('Declaração de Transporte');
  // Texto fixo do modelo e formula avaliada na leitura.
  assert.equal(decl.getRange('B7').getDisplayValue(), 'DECLARAÇÃO DE TRANSPORTE');
  decl.getRange('N21:N22').setValues([[2], ['1,5']]);
  assert.equal(decl.getRange('F31').getValue(), 3.5);
  assert.equal(decl.getRange('F31').getDisplayValue(), '3,50');
  // '=' vira formula; apostrofo inicial e texto literal; numero simples vira numero.
  decl.getRange('D36').setValue("'=nao e formula");
  assert.equal(decl.getRange('D36').getValue(), '=nao e formula');
  decl.getRange('D36').setValue('=F31');
  assert.equal(decl.getRange('D36').getValue(), 3.5);
  // J10:K10 e mesclada: setValue na faixa so guarda a ancora (comprovado no diagnostico em
  // producao, que apontou K10, O39:P39 e C49:P49 da Declaracao quando todas eram gravadas).
  decl.getRange('J10:K10').setValue('000');
  assert.deepEqual(plano(decl.getRange('J10:K10').getValues()), [[0, '']]);
  decl.getRange('B49:P49').setValue('Assinatura');
  assert.deepEqual(plano(decl.getRange('B49:D49').getValues()), [['Assinatura', '', '']]);
  decl.getRange('J21:L21').clearContent();
  decl.getRange('J21:L21').getCell(1, 1).setValue('2×1,0');
  assert.deepEqual(plano(decl.getRange('J21:L21').getValues()), [['2×1,0', '', '']]);
  decl.getRangeList(['F32', 'H32']).setValue(true);
  assert.equal(decl.getRange('H32').getValue(), true);
  decl.getRange('F30').setNote('nota');
  assert.equal(decl.getRange('F30').getNote(), 'nota');
  assert.equal(ss.problemas_.length, 0);
  // Metodo fora do subconjunto: registrado para bloquear a geracao.
  assert.throws(() => decl.getRange('A1').setBackground('#fff'), /nao suportado/);
  assert.match(ss.problemas_.join(' '), /Range\.setBackground/);
});

test('transporteDocsDados_ preenche com as rotinas atuais sem abrir a planilha de Transporte', () => {
  const s = servidor();
  let aberturas = 0;
  s.SpreadsheetApp.openById = () => { aberturas++; throw new Error('planilha real'); };
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const dados = s.transporteDocsDados_(registroMarken(), { arquivo });
  assert.equal(aberturas, 0);
  const abas = dados.abas();
  const t = (aba, a1) => texto(abas, aba, a1, s);
  assert.equal(t('Folha de Agendamento', 'C3'), 'P.P.T. | ID: ID-001');
  assert.equal(t('Folha de Agendamento', 'C8'), '05/11/2026');
  // Formulas entre abas e cadastros.
  assert.equal(t('Folha de Agendamento (DHL/PINEX)', 'C8'), '05/11/2026');
  assert.equal(t('Declaração de Transporte', 'D10'), 'Pessoa Investigadora');
  assert.equal(t('Declaração de Transporte', 'J10'), '000.000.000-00');
  assert.equal(t('Declaração de Transporte', 'C22'), 'Soro ');
  assert.equal(t('Declaração de Transporte', 'H22'), '2');
  assert.equal(t('Declaração de Transporte', 'N22'), '2,00');
  assert.equal(t('Declaração de Transporte', 'F31'), '2,00');
  assert.equal(t('Declaração de Transporte (DHL)', 'M9'), 'Caxias do Sul, 5 de novembro de 2026.');
  assert.equal(t('Invoice (MARKEN)', 'O10'), '2026-11-05');
  assert.equal(t('Invoice (MARKEN)', 'E19'), 'Laboratorio Exemplo');
  assert.equal(t('Petição de Anuência de Exportação', 'I16'), 'Courier Exemplo Ltda');
  assert.equal(t('Petição de Anuência de Exportação', 'F38'), 'CE-1');
  // Temperatura: caixas da Declaracao e da Peticao.
  const caixa = (aba, a1) => {
    const f = s.transporteLayoutsFaixa_(a1);
    return abas[aba].data[0].rowData[f.r0].values[f.c0].effectiveValue.boolValue;
  };
  assert.deepEqual(['F32', 'H32', 'J32'].map((a1) => caixa('Declaração de Transporte', a1)), [false, false, true]);
  assert.deepEqual(['G28', 'K28', 'N28'].map((a1) => caixa('Petição de Anuência de Exportação', a1)), [false, true, false]);
  // As abas do PDF MARKEN renderizam como paginas da grade.
  const spec = s.transportePdfSpec_('MARKEN', 'CONGELADO', 'LAB X', dados.ss);
  assert.deepEqual(plano(spec.ordem), ['Folha de Agendamento', 'Declaração de Transporte', 'Petição de Anuência de Exportação', 'Invoice (MARKEN)', 'Ficha de Emergência (MARKEN)']);
  for (const titulo of spec.ordem) assert.match(s.transporteDocsGradeHtml_(abas[titulo], {}), /^<table class="grade"/, titulo);
});

test('documento montado como na geracao: a Folha impressa e a nova Folha em HTML, nao a aba da grade', () => {
  const s = servidor();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const registro = registroMarken();
  const dados = s.transporteDocsDados_(registro, { arquivo });
  const spec = s.transportePdfSpec_('MARKEN', 'CONGELADO', 'LAB X', dados.ss);
  // Mesma montagem de transporteDocsGradeGerarPdfHtml_.
  const folha = s.transporteFolhaHtmlParaGrade_(dados.ss, Object.assign({}, registro, { courier: 'MARKEN' }), spec,
    { logoSrc: 'data:image/png;base64,AAAA', agendaContexto: { visita: '', origem: null }, agora: '04/11/2026 15:00' });
  assert.deepEqual(plano(folha.abas), ['Folha de Agendamento']);
  const abas = dados.abas(spec.ordem);
  const html = s.transporteDocsGradeMontar_(abas, spec.ordem.map((titulo) => ({
    aba: titulo, copias: 1, html: folha.abas.indexOf(titulo) >= 0 ? folha.html : ''
  })), {});
  const paginas = html.split('<div class="pagina">').slice(1);
  assert.equal(paginas.length, 5);
  assert.ok(paginas[0].startsWith(folha.html), 'a primeira pagina e a Folha em HTML');
  assert.doesNotMatch(paginas[0], /<table class="grade"/);
  for (const pagina of paginas.slice(1)) assert.match(pagina, /^<table class="grade"/);
  assert.doesNotMatch(html, /Pessoa Participante Teste/);
});

test('transporteDocsDados_ bloqueia a planilha real e restaura os avisos da geracao', () => {
  const s = servidor();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const anteriores = [];
  s.TRANSPORTE_GENERATION_WARNINGS_ = anteriores;
  s.preencherDhlWebApp_ = () => { s.getTransporteSpreadsheetCodex_(); };
  assert.throws(() => s.transporteDocsDados_(registroMarken(), { arquivo }), /nao pode ser aberta durante a geracao em memoria/);
  assert.equal(s.TRANSPORTE_GENERATION_WARNINGS_, anteriores);
  assert.equal(s.TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_, 0);
  // Rotina que engole o erro e so registra aviso tambem impede a geracao.
  s.preencherDhlWebApp_ = () => { s.transporteRegistrarAviso_('atualizarMarkenVolumes_'); };
  assert.throws(() => s.transporteDocsDados_(registroMarken(), { arquivo }), /avisos de preenchimento: atualizarMarkenVolumes_/);
  assert.equal(anteriores.length, 0);
});

test('comparacao do diagnostico aponta so enderecos das celulas divergentes', () => {
  const s = modulo();
  const real = [{ aba: 'A', valores: [['x', 'y'], ['z']] }, { aba: 'B', valores: [['1']] }];
  const memoria = [{ aba: 'A', valores: [['x', 'Y'], ['z', 'extra']] }];
  const r = plano(s.transporteLayoutsCompararConteudo_(real, memoria));
  assert.deepEqual(r, {
    A: { ausente: false, divergentes: 2, enderecos: ['B1', 'B2'] },
    B: { ausente: true, divergentes: 0, enderecos: [] }
  });
});

test('diagnostico em producao compara grade real e memoria sem registrar valores de celula', () => {
  const s = servidor();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const registro = registroMarken();
  // "Planilha real" do teste: outra planilha em memoria preenchida com o mesmo envio.
  const realSs = s.transporteDocsDados_(registro, { arquivo }).ss;
  const logs = [];
  s.Logger = { log: (m) => logs.push(String(m)) };
  s.codexAssertAdmin_ = () => {};
  s.getTransporteSpreadsheetCodex_ = () => realSs;
  s.transporteReadRegistro_ = () => JSON.parse(JSON.stringify(registro));
  s.transporteDerivarDadosParticipante_ = (r) => r;
  s.transporteLayoutsCarregar_ = () => arquivo;
  s.transporteDocsGradeCarregar_ = (ss, titulos) => ({ abas: ss.exportarAbas_(titulos), info: {} });
  s.reqExamesLogoSrc_ = () => 'data:image/png;base64,AAAA';
  s.transporteFolhaHtmlAgendaContexto_ = () => ({ visita: '', origem: null });
  s.transporteDocsHtmlContarPaginasPdf_ = () => 17;
  s.Utilities = {
    formatDate: () => '20261104-150000',
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_alg, valor) => Array.from(require('node:crypto').createHash('sha256').update(valor).digest()),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url')
  };
  const blob = { setName() { return blob; }, getBytes: () => [1, 2, 3] };
  s.HtmlService = { createHtmlOutput: () => ({ getBlob: () => ({ getAs: () => blob }) }) };
  s.MimeType = { PDF: 'application/pdf' };
  const pasta = { createFile: () => ({ getName: () => 'diag.pdf', getUrl: () => 'https://example.invalid/diag' }) };
  s.DriveApp = { getRootFolder: () => ({ getFoldersByName: () => ({ hasNext: () => true, next: () => pasta }) }) };
  const r = s.diagnosticarDocsDadosTransporteHtml();
  assert.equal(r.celulasDivergentes, 0, JSON.stringify(r.comparacao));
  assert.equal(r.ok, true, JSON.stringify(r.avisos));
  assert.equal(r.hashReal, r.hashMemoria);
  assert.equal(r.pdf.paginas, 17);
  assert.equal(logs.length, 1);
  // Uma celula diferente na planilha real aparece pelo endereco, sem o valor.
  realSs.getSheetByName('Declaração de Transporte').getRange('D36').setValue('Valor alterado na planilha real');
  const divergente = s.diagnosticarDocsDadosTransporteHtml();
  assert.equal(divergente.ok, false);
  assert.equal(divergente.celulasDivergentes, 1);
  assert.deepEqual(plano(divergente.comparacao['Declaração de Transporte'].enderecos), ['D36']);
  assert.ok(!logs[1].includes('Valor alterado'));
  for (const dado of ['Pessoa Participante Teste', 'P.P.T.', 'ID-001', '123456789012', 'Pessoa Investigadora']) {
    assert.ok(!logs[0].includes(dado), 'log nao pode conter ' + dado);
  }
});

function hashUtilities() {
  return {
    formatDate: () => '20261104-150000',
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_alg, valor) => Array.from(require('node:crypto').createHash('sha256').update(valor).digest()),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url')
  };
}

test('modo sombra compara com a grade real, aponta enderecos e nunca interrompe a geracao', () => {
  const s = servidor();
  s.Utilities = hashUtilities();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  s.transporteLayoutsCarregar_ = () => arquivo;
  const registro = registroMarken();
  const realSs = s.transporteDocsDados_(registro, { arquivo }).ss;
  const spec = s.transportePdfSpec_('MARKEN', 'CONGELADO', 'LAB X', realSs);
  const conteudoReal = () => s.transporteDocsGradeProtegerConteudo_(realSs.exportarAbas_(spec.ordem),
    s.transporteDocsGradeContextoProtecao_(realSs, 'MARKEN', registro));

  const igual = s.transporteDocsDadosSombra_(registro, spec, realSs, 'MARKEN', conteudoReal());
  assert.equal(igual.ok, true, JSON.stringify(igual));
  assert.equal(igual.divergentes, 0);
  assert.equal(igual.hashIgual, true);
  assert.equal(igual.courier, 'MARKEN');

  realSs.getSheetByName('Invoice (MARKEN)').getRange('O12').setValue('99');
  const diferente = s.transporteDocsDadosSombra_(registro, spec, realSs, 'MARKEN', conteudoReal());
  assert.equal(diferente.ok, false);
  assert.deepEqual(plano(diferente.abas), { 'Invoice (MARKEN)': { divergentes: 1, ausente: false, enderecos: ['O12'] } });

  // Falha do caminho novo: resumo com erro truncado, sem lancar.
  s.transporteDocsDados_ = () => { throw new Error('falha simulada ' + 'x'.repeat(400)); };
  const erro = s.transporteDocsDadosSombra_(registro, spec, realSs, 'MARKEN', conteudoReal());
  assert.equal(erro.ok, false);
  assert.match(erro.erro, /^falha simulada/);
  assert.ok(erro.erro.length <= 160);
  for (const r of [igual, diferente, erro]) {
    const json = JSON.stringify(r);
    for (const dado of ['Pessoa Participante Teste', 'P.P.T.', 'ID-001', '123456789012']) assert.ok(!json.includes(dado), dado);
  }
});

test('geracao HTML registra o modo sombra no log sem mudar o PDF entregue', () => {
  const fonte = readProjectFile('TransporteCodexConfig.gs').replace(/\r\n/g, '\n');
  const ramo = fonte.slice(fonte.indexOf('if (formatoHtml) {'), fonte.indexOf('} else {', fonte.indexOf('if (formatoHtml) {')));
  assert.match(ramo, /blob = gerado\.blob;[\s\S]*transporteDocsDadosSombra_\(payloadFallback, spec, ss, courier, conteudoPdf\)/);
  assert.match(ramo, /\[TRANSPORTE_SOMBRA\]/);
  // O PDF e o hash entregues continuam os da grade.
  assert.doesNotMatch(ramo, /blob = [^g]|conteudoPdf = (?!gerado\.conteudo)/);
});

function linhaAgenda(s, campos) {
  const i = s.AGENDA_CFG.idx;
  const r = Array(s.AGENDA_CFG.lastCol).fill('');
  r[i.id] = campos.id; r[i.data] = campos.data; r[i.participante] = 'Pessoa Participante Teste';
  r[i.projeto] = 'Estudo X'; r[i.medico] = 'Pessoa Investigadora'; r[i.idParticipante] = 'ID-001';
  r[i.c1.nome] = campos.courier || 'MARKEN'; r[i.c1.temp] = 'CONGELADO'; r[i.c1.status] = campos.status || 'Entregue';
  r[i.c1.awb] = campos.awb === undefined ? '123456789012' : campos.awb; r[i.c1.destino] = 'LAB X';
  r[i.c1.matBio] = JSON.stringify({ items: [{ key: 'soro', formula: '2x1,0' }] });
  return r;
}

test('lote seleciona envios anteriores com AWB das couriers em HTML, mais recentes primeiro', () => {
  const s = servidor();
  const hoje = new Date(2026, 10, 4, 12);
  const rows = [
    linhaAgenda(s, { id: 'A', data: new Date(2026, 9, 20) }),
    linhaAgenda(s, { id: 'B', data: new Date(2026, 10, 3) }),
    linhaAgenda(s, { id: 'C', data: new Date(2026, 10, 4) }),           // hoje: fora
    linhaAgenda(s, { id: 'D', data: new Date(2026, 6, 1) }),            // antes de 3 meses: fora
    linhaAgenda(s, { id: 'E', data: new Date(2026, 9, 1), awb: '' }),   // sem AWB: fora
    linhaAgenda(s, { id: 'F', data: new Date(2026, 9, 2), courier: 'PINEX (Agendamento)' }) // sem HTML: fora
  ];
  const envios = s.transporteLayoutsLoteEnvios_(rows, hoje, 3);
  assert.deepEqual(plano(envios.map((e) => e.id + ':' + e.slot + ':' + e.courier)), ['B:1:MARKEN', 'A:1:MARKEN']);
});

test('lote compara copia temporaria e memoria sem gravar na Agenda nem tocar a planilha real', () => {
  const s = servidor();
  s.Utilities = Object.assign(hashUtilities(), { getUuid: () => 'UUID' });
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  s.transporteLayoutsCarregar_ = () => arquivo;
  s.codexAssertAdmin_ = () => {};
  const hojeMenos = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x; };
  const rows = [linhaAgenda(s, { id: 'EV1', data: hojeMenos(10) }), linhaAgenda(s, { id: 'EV2', data: hojeMenos(40), status: 'Entregue' })];
  const antes = JSON.stringify(rows);
  // Agenda somente leitura: qualquer gravacao quebraria (nao ha setters).
  const agenda = {
    getName: () => 'Agenda', getLastRow: () => rows.length + 1, getLastColumn: () => s.AGENDA_CFG.lastCol,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 2, r - 2 + (nr || 1)).map((l) => l.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => rows[r - 2][c - 1], getNote: () => ''
    })
  };
  s.getAgendaSheet_ = () => agenda;
  s.transporteReadParticipantesDireto_ = () => [];
  s.transporteDerivarDadosParticipante_ = (p) => p;
  s.transporteCaixasRegras_ = () => [];
  let aberturasReais = 0;
  s.getTransporteSpreadsheetCodex_ = () => {
    if (s.TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_ > 0) throw new Error('planilha real bloqueada');
    aberturasReais++;
    // Sem metodos de gravacao: so localizar o arquivo e consultas somente leitura do registro.
    return { getId: () => 'REAL' };
  };
  const eventos = [];
  const temp = { getId: () => 'COPIA', setSharing: () => eventos.push('privada'), setTrashed: (v) => eventos.push('lixeira:' + v) };
  s.DriveApp = { Access: { PRIVATE: 'P' }, Permission: { NONE: 'N' }, getRootFolder: () => ({}),
    getFileById: (id) => { assert.equal(id, 'REAL'); return { makeCopy: () => { eventos.push('copia'); return temp; } }; } };
  // A "copia" e outra planilha em memoria; a grade dela e lida sem a API do Sheets.
  const copia = s.transporteLayoutsPlanilha_(arquivo);
  // A copia real mantem o texto padrao do modelo em B14 (a courier sem conteudo cadastrado nao o regrava).
  s.transporteGetSheet_(copia, 'declaracaoTransp', false).getRange('B14').setValue('conformidade com as regulamentações da IATA vigente e Resolução 5947 / ANTT de 01/06/2021 do Ministério dos Transportes.');
  s.SpreadsheetApp = Object.assign(construtoresTextoRico(), { openById: (id) => { assert.equal(id, 'COPIA'); return copia; }, flush: () => eventos.push('flush') });
  s.transporteDocsGradeCarregar_ = (ss, titulos) => { assert.equal(ss, copia); return { abas: ss.exportarAbas_(titulos), info: {} }; };
  const logs = [];
  s.Logger = { log: (m) => logs.push(String(m)) };
  const r = s.diagnosticarDocsDadosLoteTransporteHtml({ meses: 3, limite: 5 });
  assert.equal(r.processados, 2, JSON.stringify(r));
  assert.equal(r.comErro, 0, JSON.stringify(r.envios));
  assert.equal(r.iguais, 2, JSON.stringify(r.envios));
  assert.equal(r.ok, true);
  assert.equal(r.copiaTemporaria, 'lixeira');
  assert.deepEqual(eventos.filter((e) => e !== 'flush'), ['copia', 'privada', 'lixeira:true']);
  // Fora dos preenchimentos, a planilha real so e consultada (localizar o arquivo e, como no
  // salvamento normal, o investigador por projeto); durante eles fica bloqueada (sem erros acima).
  assert.ok(aberturasReais >= 1);
  assert.equal(JSON.stringify(rows), antes, 'Agenda inalterada (status Entregue preservado)');
  assert.equal(s.TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_, 0);
  for (const dado of ['Pessoa Participante Teste', 'P.P.T.', 'ID-001', '123456789012', 'Pessoa Investigadora']) {
    assert.ok(!logs.join('').includes(dado), 'log nao pode conter ' + dado);
  }
});

test('filtro de courier do lote restringe a selecao e recusa courier sem PDF em HTML', () => {
  const s = servidor();
  const hoje = new Date(2026, 10, 4, 12);
  const rows = [
    linhaAgenda(s, { id: 'M', data: new Date(2026, 10, 3), courier: 'MARKEN' }),
    linhaAgenda(s, { id: 'D', data: new Date(2026, 10, 2), courier: 'DHL' }),
    linhaAgenda(s, { id: 'P', data: new Date(2026, 10, 1), courier: 'PINEX' }),
    linhaAgenda(s, { id: 'O', data: new Date(2026, 9, 30), courier: 'OCASA' })
  ];
  const ids = (couriers) => plano(s.transporteLayoutsLoteEnvios_(rows, hoje, 3, s.transporteLayoutsLoteCouriers_(couriers)).map((e) => e.id));
  assert.deepEqual(ids(['DHL', 'PINEX']), ['D', 'P']);
  assert.deepEqual(ids('dhl'), ['D']);
  assert.deepEqual(ids('PINEX; OCASA'), ['P', 'O']);
  assert.deepEqual(ids(undefined), ['M', 'D', 'P', 'O']);
  assert.throws(() => s.transporteLayoutsLoteCouriers_(['PINEX (Agendamento)']), /sem PDF em HTML no filtro/);
  // Atalhos do editor passam o filtro.
  const recebidos = [];
  s.diagnosticarDocsDadosLoteTransporteHtml = (o) => { recebidos.push(plano(o.couriers)); return {}; };
  s.diagnosticarDocsDadosLoteTransporteHtmlDhlPinex();
  s.diagnosticarDocsDadosLoteTransporteHtmlDhl();
  s.diagnosticarDocsDadosLoteTransporteHtmlPinex();
  assert.deepEqual(recebidos, [['DHL', 'PINEX'], ['DHL'], ['PINEX']]);
});

test('preenchimento DHL na memoria: formato numerico por RangeList e litros na Declaracao de Transporte (DHL)', () => {
  const s = servidor();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const registro = registroMarken({ courier: 'DHL', temperatura: 'CONGELADO' });
  // Antes: "Metodo nao suportado na planilha em memoria: RangeList.setNumberFormat" (diagnostico em lote, DHL).
  const dados = s.transporteDocsDados_(registro, { arquivo });
  const abas = dados.abas();
  const t = (a1) => texto(abas, 'Declaração de Transporte (DHL)', a1, s);
  assert.equal(t('F18'), '0,00200');
  assert.equal(t('M29'), 'Gelo Seco: 4 kg');
  const spec = s.transportePdfSpec_('DHL', 'CONGELADO', 'LAB X', dados.ss);
  for (const titulo of spec.ordem) {
    if (titulo === 'Folha de Agendamento (DHL/PINEX)') continue; // impressa pela Folha em HTML
    assert.match(s.transporteDocsGradeHtml_(abas[titulo], {}), /^<table class="grade"/, titulo);
  }
});

function utilitiesFormatDate(data, fuso, padrao) {
  if (padrao === 'Z') return formatDateFuso(data, fuso, padrao);
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric', month: 'long', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(data).map((p) => [p.type, p.value]));
  const mes = String(new Intl.DateTimeFormat('en-US', { timeZone: fuso, month: '2-digit' }).format(data));
  return padrao.replace('MMMM', partes.month).replace('yyyy', partes.year).replace('MM', mes).replace('dd', partes.day)
    .replace('HH', partes.hour).replace('mm', partes.minute);
}

test('preenchimento PINEX na memoria roda sem operacao nao suportada e renderiza as abas do PDF', () => {
  const s = servidor();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  // Utilities.formatDate do Apps Script (fuso real via Intl) para os formatos usados pelo PINEX.
  // Como no Apps Script, o fuso do script e o mesmo em que as datas sao criadas.
  s.Session = { getScriptTimeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone };
  s.Utilities = Object.assign({}, s.Utilities, { formatDate: utilitiesFormatDate });
  const registro = registroMarken({ courier: 'PINEX', temperatura: 'CONGELADO', pinexColeta: '123456', pinexAwb: '123456789012' });
  const dados = s.transporteDocsDados_(registro, { arquivo });
  const abasPinex = dados.abas();
  assert.equal(texto(abasPinex, 'Commercial Invoice (PINEX)', 'E8', s), 'November 05, 2026');
  assert.equal(texto(abasPinex, 'Commercial Invoice (PINEX)', 'E9', s), '06/11/2026 14:00');
  assert.equal(dados.ss.problemas_.length, 0, dados.ss.problemas_.join('; '));
  const abas = dados.abas();
  const spec = s.transportePdfSpec_('PINEX', 'CONGELADO', 'LAB X', dados.ss);
  assert.deepEqual(plano(spec.ordem), ['Folha de Agendamento (DHL/PINEX)', 'Commercial Invoice (PINEX)',
    'Petição de Anuência de Exportação (PINEX)', 'USDA Statement (PINEX)', 'Ficha de Emergência (PINEX)', 'Declaração de Transporte']);
  for (const titulo of spec.ordem.slice(1)) assert.match(s.transporteDocsGradeHtml_(abas[titulo], {}), /^<table class="grade"/, titulo);
});

test('B14 da Declaracao: texto padrao do modelo sem conteudo cadastrado; o cadastrado prevalece', () => {
  const arquivo = servidor().transporteLayoutsCarregar_(ARQUIVO);
  const b14 = (s, registro) => {
    s.Session = { getScriptTimeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone };
    s.Utilities = Object.assign({}, s.Utilities, { formatDate: utilitiesFormatDate });
    return texto(s.transporteDocsDados_(registro, { arquivo }).abas(), 'Declaração de Transporte', 'B14', s);
  };
  const padrao = 'conformidade com as regulamentações da IATA vigente e Resolução 5947 / ANTT de 01/06/2021 do Ministério dos Transportes.';
  // O layout congelado nao traz B14 (celula gravada pelo preenchimento).
  assert.equal(b14(servidor(), registroMarken({ courier: 'PINEX', pinexColeta: '1', pinexAwb: '123456789012' })), padrao);
  assert.equal(b14(servidor(), registroMarken()), padrao);
  const s = servidor();
  s.transporteReadAgendaCourierConfigs_ = () => ({ marken: { nome: 'MARKEN', conteudoDeclaracao: 'conteudo <b>da courier</b>' } });
  assert.equal(b14(s, registroMarken()), 'conteudo da courier');
});

test('geracao em memoria: so HTML, couriers validadas e courier igual a do registro', () => {
  const s = servidor();
  const ativa = (formato, courier, extra) => s.transporteDocsMemoriaAtiva_(Object.assign({ formato, payload: { courier } }, extra));
  for (const courier of ['MARKEN', 'OCASA', 'DHL']) assert.equal(ativa('html', courier), true, courier);
  // PINEX segue pela grade ate ser validada pelo diagnostico em lote.
  assert.equal(ativa('html', 'PINEX'), false);
  assert.equal(ativa('html', 'PINEX (Agendamento)'), false);
  assert.equal(ativa('', 'MARKEN'), false);
  assert.equal(ativa('html', 'MARKEN', { courier: 'OCASA' }), false);
  assert.equal(ativa('html', 'MARKEN', { courier: 'MARKEN' }), true);
});

function servidorManifesto() {
  const s = servidor();
  s.Session = { getScriptTimeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone };
  s.Utilities = Object.assign({}, s.Utilities, { formatDate: utilitiesFormatDate });
  s.transportePdfManifestoHash_ = (v) => JSON.stringify(v);
  // A validacao em memoria nunca pode abrir a planilha real.
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha real aberta'); };
  return s;
}

test('manifesto do PDF valida o registro contra a planilha em memoria, sem abrir a real', () => {
  const s = servidorManifesto();
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const registro = registroMarken({ idAgenda: 'EVT1', agendaSlot: '1', caixaTransporte: null });
  const dados = s.transporteDocsDados_(registro, { arquivo });
  const manifesto = s.transporteValidarManifestoPdf_({ payload: registro }, dados.ss);
  assert.equal(manifesto.modo, 'agenda');
  assert.equal(manifesto.manifesto.awb, '123456789012');
  assert.throws(() => s.transporteValidarManifestoPdf_({ payload: Object.assign({}, registro, { awb: '999999999999' }) }, dados.ss),
    /Bloqueio de seguranca do PDF.*awb/);
  const outrosMateriais = registro.materiais.map((m, i) => (i === 1 ? Object.assign({}, m, { ensaio: 'Outro ensaio' }) : m));
  assert.throws(() => s.transporteValidarManifestoPdf_({ payload: Object.assign({}, registro, { materiais: outrosMateriais }) }, dados.ss),
    /materiais e ensaios/);
});

test('falha na memoria prepara as abas reais e devolve null para seguir pela grade', () => {
  const s = servidor();
  const real = { id: 'REAL' };
  const preparadas = [];
  s.getTransporteSpreadsheetCodex_ = () => real;
  s.transportePrepararDocumentosModelos_ = (ss, registro) => preparadas.push([ss, registro]);
  s.transporteDocsDados_ = () => { throw new Error('A documentação em memória não reproduziu o modelo'); };
  const registro = { courier: 'MARKEN' };
  assert.equal(s.transporteDocsMemoriaPreparar_(registro), null);
  assert.deepEqual(preparadas, [[real, registro]]);
  const dados = { ss: {} };
  s.transporteDocsDados_ = () => dados;
  assert.equal(s.transporteDocsMemoriaPreparar_(registro), dados);
  assert.equal(preparadas.length, 1);
});

test('imagens omitidas do layout chegam ao aviso da geracao em memoria', () => {
  const s = modulo();
  const docs = { abas: (titulos) => ({ [titulos[0]]: { imagensOmitidas: 2 }, B: {} }) };
  const carregado = s.transporteDocsMemoriaCarregar_(docs, ['A']);
  assert.equal(carregado.info.imagensOmitidas, 2);
});

function geracao(memoria) {
  const s = servidor();
  const chamadas = { flush: 0 };
  s.SpreadsheetApp = { flush: () => { chamadas.flush++; } };
  s.salvarTransporteInterno_ = (_payload, opcoes) => { chamadas.salvar = opcoes; return { registro: { courier: 'MARKEN' }, agendaSync: {} }; };
  s.transporteDocsMemoriaPreparar_ = () => memoria;
  s.transporteValidarManifestoPdf_ = (_o, ss) => { chamadas.manifestoSs = ss; return { hash: 'h', manifesto: {} }; };
  s.imprimirTodasAbas_ = (_o, interno) => { chamadas.interno = interno; return { type: 'pdf', courier: 'MARKEN', fileId: 'PDF' }; };
  s.transporteMarcarDocsGeradosAgenda_ = () => null;
  s.transporteMonitorReferencia_ = () => '';
  s.transportePdfManifestoHash_ = () => 'h';
  s.transporteReadRegistro_ = () => { chamadas.leuRegistroReal = true; return {}; };
  s.gerarPdfTransporteInterno_({ payload: { courier: 'MARKEN' }, formato: 'html', criarRascunho: false }, {});
  return chamadas;
}

test('geracao em HTML nao prepara as abas reais e entrega a memoria ao exportador', () => {
  const docs = { ss: { id: 'MEMORIA' } };
  const c = geracao(docs);
  assert.equal(c.salvar.preencherDocumentos, false);
  assert.equal(c.salvar.camposRascunho, true);
  assert.equal(c.manifestoSs, docs.ss);
  assert.equal(c.interno.docsMemoria, docs);
  assert.equal(c.flush, 0);
  assert.equal(c.leuRegistroReal, undefined);
});

test('geracao em HTML volta ao fluxo da planilha quando a memoria falha', () => {
  const c = geracao(null);
  assert.equal(c.manifestoSs, undefined);
  assert.equal(c.interno.docsMemoria, undefined);
  assert.equal(c.flush, 1);
  assert.equal(c.leuRegistroReal, true);
});

test('salvamento da geracao em memoria grava na planilha real o destino lido pelo e-mail OCASA', () => {
  const codigo = readProjectFile('TransporteCodexConfig.gs');
  assert.match(codigo, /options\.camposRascunho === true\) transportePreencherDeclaracaoCadastros_\(ss, payload\)/);
});

test('layout da Ficha OCASA guarda as faixas vermelhas laterais (regerar exige backgroundColor no dump)', () => {
  const s = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteLayoutsModelo.gs'], { Utilities: {} });
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const sheet = s.transporteLayoutsExpandir_(arquivo, 'fichaEmergenciaOcasa');
  const celula = (r, c) => sheet.data[0].rowData[r].values[c];
  for (const [r, c] of [[0, 0], [1, 0], [0, 6]]) assert.equal(s.transporteDocsGradeFundo_(celula(r, c)), '#ff0000');
  assert.equal(s.transporteDocsGradeArea_(sheet).c1, 6);
  assert.equal((s.transporteDocsGradeHtml_(sheet, {}).match(/data:image\/gif/g) || []).length, 3);
});
