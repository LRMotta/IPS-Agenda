'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { inventarioEscritas, TRANSPORTE_LAYOUT_ABAS_ } = require('../tools/export-transporte-layouts');

const ARQUIVO = readProjectFile('TransporteLayoutsModelo.html');
// Objetos do script vem de outro contexto (vm): compare pelo conteudo.
const plano = (v) => JSON.parse(JSON.stringify(v));

function modulo(extra) {
  return runFiles(['TransporteLayoutsModelo.gs'], Object.assign({ Session: { getScriptTimeZone: () => 'America/Sao_Paulo' } }, extra || {}));
}

function servidor() {
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs',
    'TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteLayoutsModelo.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    SpreadsheetApp: {},
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

test('formatador reproduz os formatos de numero e data usados nas abas-modelo (pt_BR)', () => {
  const s = modulo();
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
  // setValue em faixa grava todas as celulas; getCell(1,1) so a ancora.
  decl.getRange('J10:K10').setValue('000');
  assert.deepEqual(plano(decl.getRange('J10:K10').getValues()), [[0, 0]]);
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
