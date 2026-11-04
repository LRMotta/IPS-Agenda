'use strict';
// Congela o layout das abas-modelo da planilha de Transporte em TransporteLayoutsModelo.html.
//
// Uso:
//   node tools/export-transporte-layouts.js <atual.json> <outra-copia.json> [saida]
//
// <atual.json>: spreadsheets.get (includeGridData) das abas-modelo da planilha em uso, com
//   merges, columnMetadata/rowMetadata e, por celula, formattedValue, userEnteredValue,
//   effectiveValue, effectiveFormat (textFormat, alinhamentos, wrapStrategy, padding, borders,
//   numberFormat), textFormatRuns e dataValidation.condition.type.
// <outra-copia.json>: formattedValue/userEnteredValue das mesmas abas em outra copia da planilha,
//   preenchida com OUTRO envio (ex.: a copia de seguranca). Serve para separar texto do modelo
//   de dado de envio.
//
// Uma celula so entra com texto no layout quando e texto fixo do modelo: nao tem formula, nao e
// gravada pelo codigo de preenchimento (inventario estatico abaixo + TRANSPORTE_LAYOUT_DINAMICAS_)
// e tem o mesmo texto nas duas copias. Celulas gravadas pelo codigo so mantem o texto quando ele
// e igual nas duas copias (valor que o codigo nunca troca na pratica); as demais ficam vazias.
// Qualquer celula fixa que difira entre as copias interrompe a exportacao: nenhum dado de envio
// pode entrar no arquivo versionado.
// Imagens (logo e rodape) nao vem da API do Sheets; ficam em "imagens" quando exportadas pelo
// Apps Script (exportarImagensLayoutTransporteHtml) e informadas no 4o argumento.

const fs = require('node:fs');
const path = require('node:path');
const { runFiles, readProjectFile } = require('../tests/helpers/load-app-script');

// Abas-modelo dos PDFs (chave de transporteCodexSheetNames_ -> titulo atual).
const TRANSPORTE_LAYOUT_ABAS_ = {
  folhaAgendamento: 'Folha de Agendamento',
  folhaDhlPinex: 'Folha de Agendamento (DHL/PINEX)',
  declaracaoTransp: 'Declaração de Transporte',
  invoicePinex: 'Commercial Invoice (PINEX)',
  declaracaoDhl: 'Declaração (DHL)',
  invoiceDhl: 'Invoice (DHL)',
  peticaoAnuencia: 'Petição de Anuência de Exportação',
  invoiceMarken: 'Invoice (MARKEN)',
  fichaEmergenciaMarken: 'Ficha de Emergência (MARKEN)',
  proformaOcasa: 'Proforma Invoice (OCASA)',
  declaracaoTranspDhl: 'Declaração de Transporte (DHL)',
  peticaoPinex: 'Petição de Anuência de Exportação (PINEX)',
  usdaStatementPinex: 'USDA Statement (PINEX)',
  fichaEmergenciaPinex: 'Ficha de Emergência (PINEX)',
  fichaEmergenciaOcasa: 'Ficha de Emergência (OCASA)',
  telefonesUteisOcasa: 'Telefones Úteis (OCASA)',
  formularioPinex: 'Formulário (PINEX)'
};

// Gravacoes que a busca estatica nao encontra (lacos e indices calculados).
const TRANSPORTE_LAYOUT_DINAMICAS_ = {
  // Volumes: transporteSetTopLeftInBlock_(declaracao, 'J' + linha + ':L' + linha) em salvarTransporteInterno_.
  declaracaoTransp: ['J21:L28'],
  // Identificacao documental (transportePdfAnonimizarParticipante_ / salvarTransporteInterno_).
  folhaAgendamento: ['C3:C15'],
  folhaDhlPinex: ['C3:C15']
};

// Textos fixos revisados no modelo depois da outra copia (copia antiga). So sao aceitos quando o
// texto atual e exatamente o informado; qualquer outra diferenca continua bloqueando.
const TRANSPORTE_LAYOUT_ROTULOS_REVISADOS_ = {
  folhaAgendamento: { B3: 'PARTICIPANTE:' },
  folhaDhlPinex: { B3: 'PARTICIPANTE:' }
};

// Variavel de planilha -> aba, nos trechos em que o nome da variavel nao e a chave.
const TRANSPORTE_LAYOUT_ALIAS_VARIAVEL_ = { formulario: 'formularioPinex', peticao: 'peticaoAnuencia', declaracao: 'declaracaoTransp', folha: 'folhaAgendamento', folhaDhl: 'folhaDhlPinex' };

function coluna(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

function colunaIndice(letras) {
  return [...letras].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function expandirFaixa(a1, destino) {
  const m = String(a1).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('Faixa invalida: ' + a1);
  const c0 = colunaIndice(m[1]), r0 = Number(m[2]);
  const c1 = m[3] ? colunaIndice(m[3]) : c0, r1 = m[4] ? Number(m[4]) : r0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) destino.add(coluna(c) + r);
}

// Celulas gravadas pelo codigo de preenchimento: getRange('A1') seguido de set*/clear* e os
// auxiliares de escrita, atribuidos a aba pela variavel obtida com transporte(Codex)GetSheet_.
function inventarioEscritas() {
  const fontes = fs.readdirSync(path.join(__dirname, '..')).filter((f) => f.endsWith('.gs'));
  const saida = {};
  for (const arquivo of fontes) {
    let funcao = '';
    const variaveis = {};
    for (const linha of readProjectFile(arquivo).split(/\r?\n/)) {
      const f = linha.match(/^function (\w+)/);
      if (f) funcao = f[1];
      const g = linha.match(/(\w+)\s*=\s*transporte(?:Codex)?GetSheet_\(\s*[^,]+,\s*'(\w+)'/);
      if (g) variaveis[funcao + ':' + g[1]] = g[2];
      const padroes = [
        /(\w+)\.getRange\('([A-Z]+\d+(?::[A-Z]+\d+)?)'\)\.(?:set\w+|clear\w*)/g,
        /(?:transporteSetTopLeftInBlock_|transporteSetValueIfAllowed_|transporteSetRichTextOrValue_|transporteSetValuesBlock_)\((\w+)(?:\.getRange\()?,?\s*'([A-Z]+\d+(?::[A-Z]+\d+)?)'/g
      ];
      for (const padrao of padroes) {
        let m;
        while ((m = padrao.exec(linha))) {
          const aba = variaveis[funcao + ':' + m[1]] || TRANSPORTE_LAYOUT_ALIAS_VARIAVEL_[m[1]] || m[1];
          if (!TRANSPORTE_LAYOUT_ABAS_[aba]) continue;
          expandirFaixa(m[2], saida[aba] || (saida[aba] = new Set()));
        }
      }
    }
  }
  Object.keys(TRANSPORTE_LAYOUT_DINAMICAS_).forEach((aba) => {
    TRANSPORTE_LAYOUT_DINAMICAS_[aba].forEach((a1) => expandirFaixa(a1, saida[aba] || (saida[aba] = new Set())));
  });
  return saida;
}

function celulasPorEndereco(sheet) {
  const out = {};
  (sheet.data || []).forEach((d) => {
    (d.rowData || []).forEach((row, i) => (row.values || []).forEach((v, j) => {
      if (v) out[coluna((d.startColumn || 0) + j) + ((d.startRow || 0) + i + 1)] = v;
    }));
  });
  return out;
}

function porTitulo(dump) {
  const out = {};
  (dump.sheets || []).forEach((s) => { out[s.properties.title] = s; });
  return out;
}

function formulaDe(cell) {
  return cell && cell.userEnteredValue && cell.userEnteredValue.formulaValue;
}

// Formato compacto lido por transporteLayoutsExpandir_ (TransporteLayoutsModelo.gs):
// effectiveFormat vira indice em formatos; mesclas viram [linha0, linha1, coluna0, coluna1].
function compactar(layout, formatos) {
  const data = layout.data[0];
  return {
    titulo: layout.properties.title,
    area: layout.area,
    mesclas: (layout.merges || []).map((m) => [m.startRowIndex || 0, m.endRowIndex, m.startColumnIndex || 0, m.endColumnIndex]),
    imagensFlutuantes: (layout.imagensFlutuantes || []).map((i) => ({ r: i.r, c: i.c, x: i.x, y: i.y, w: i.w, h: i.h, url: i.url })),
    imagensOmitidas: layout.imagensOmitidas || 0,
    colunas: (data.columnMetadata || []).map((c) => [c.pixelSize || 0, c.hiddenByUser ? 1 : 0]),
    linhas: (data.rowMetadata || []).map((r) => [r.pixelSize || 0, r.hiddenByUser ? 1 : 0]),
    celulas: (data.rowData || []).map((row) => (row.values || []).map((cell) => {
      const out = {};
      if (cell.effectiveFormat) {
        const chave = JSON.stringify(cell.effectiveFormat);
        if (formatos.indice[chave] === undefined) { formatos.indice[chave] = formatos.lista.length; formatos.lista.push(cell.effectiveFormat); }
        out.f = formatos.indice[chave];
      }
      if (cell.formattedValue !== undefined) out.t = cell.formattedValue;
      if (cell.effectiveValue) out.e = cell.effectiveValue;
      if (cell.textFormatRuns) out.r = cell.textFormatRuns;
      if (cell.dataValidation) out.v = cell.dataValidation;
      if (cell.userEnteredValue && cell.userEnteredValue.imageValue) out.i = cell.userEnteredValue.imageValue.imageProperties.contentUrl;
      return out;
    }))
  };
}

function exportar(atual, outra, imagens) {
  const app = runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs'], { Utilities: {} });
  const escritas = inventarioEscritas();
  const abasAtual = porTitulo(atual), abasOutra = porTitulo(outra);
  const abas = {};
  const resumo = {};
  const formatos = { lista: [], indice: {} };
  // Cada imagem entra uma vez em arquivo.imagens; o layout guarda so o id.
  const tabelaImagens = {};
  const idsImagens = {};
  function idImagem(src) {
    if (!/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(String(src || ''))) throw new Error('Imagem invalida: use data URI PNG, JPEG ou GIF.');
    if (!idsImagens[src]) { idsImagens[src] = 'img' + Object.keys(tabelaImagens).length; tabelaImagens[idsImagens[src]] = src; }
    return idsImagens[src];
  }
  Object.keys(TRANSPORTE_LAYOUT_ABAS_).forEach((chave) => {
    const titulo = TRANSPORTE_LAYOUT_ABAS_[chave];
    const sheet = abasAtual[titulo];
    if (!sheet) throw new Error('Aba ausente na leitura atual: ' + titulo);
    const outraCelulas = celulasPorEndereco(abasOutra[titulo] || {});
    const gravadas = escritas[chave] || new Set();
    const imgOrig = (imagens && imagens[chave]) || null;
    const img = imgOrig && {
      celulas: (imgOrig.celulas || []).map((i) => Object.assign({}, i, { src: idImagem(i.src) })),
      flutuantes: (imgOrig.flutuantes || []).map((f) => Object.assign({}, f, { src: idImagem(f.src) }))
    };
    // Layout como o cache de producao (sem texto); imagens de celula entram antes do recorte da area.
    const base = JSON.parse(JSON.stringify(sheet));
    (img && img.celulas || []).forEach((i) => {
      const data = base.data[0];
      while ((data.rowData = data.rowData || []).length <= i.r) data.rowData.push({ values: [] });
      const vals = data.rowData[i.r].values || (data.rowData[i.r].values = []);
      while (vals.length <= i.c) vals.push({});
      vals[i.c] = Object.assign({}, vals[i.c], { userEnteredValue: { imageValue: { imageProperties: { contentUrl: i.src } } } });
    });
    if (img) base.imagensFlutuantes = (img.flutuantes || []).map((f) => Object.assign({ url: f.src }, f));
    const mapaImagens = {};
    (img && img.celulas || []).forEach((i) => { mapaImagens[i.src] = i.src; });
    (img && img.flutuantes || []).forEach((f) => { mapaImagens[f.src] = f.src; });
    const layout = app.transporteDocsGradeLayout_(base, mapaImagens);
    const linhas = layout.data[0].rowData;
    const formulas = {};
    const variaveis = [];
    const contagem = { fixas: 0, formulas: 0, variaveis: 0 };
    const celulas = celulasPorEndereco(sheet);
    Object.keys(celulas).forEach((a1) => {
      const cell = celulas[a1];
      const m = a1.match(/^([A-Z]+)(\d+)$/);
      const r = Number(m[2]) - 1, c = colunaIndice(m[1]);
      if (r >= layout.area.linhas || c >= layout.area.colunas) return;
      const destino = linhas[r] && linhas[r].values && linhas[r].values[c];
      if (!destino) return;
      const formula = formulaDe(cell);
      if (formula) {
        formulas[a1] = formula;
        contagem.formulas++;
        return;
      }
      if (cell.formattedValue === undefined) return;
      const outraTexto = outraCelulas[a1] && outraCelulas[a1].formattedValue;
      const revisado = (TRANSPORTE_LAYOUT_ROTULOS_REVISADOS_[chave] || {})[a1];
      const igual = outraTexto === cell.formattedValue || (revisado !== undefined && revisado === cell.formattedValue);
      // Gravada pelo codigo: sempre vazia. Duas copias iguais (a mesma courier, o mesmo
      // responsavel) nao provam que o valor e do modelo.
      if (gravadas.has(a1)) { variaveis.push(a1); contagem.variaveis++; return; }
      if (!igual) {
        throw new Error('Celula fixa difere entre as copias: ' + titulo + '!' + a1 +
          '. Inclua-a em TRANSPORTE_LAYOUT_DINAMICAS_ (gravada pelo codigo) ou confira o modelo.');
      } else {
        contagem.fixas++;
      }
      destino.formattedValue = cell.formattedValue;
      if (cell.effectiveValue) destino.effectiveValue = cell.effectiveValue;
      if (cell.textFormatRuns) destino.textFormatRuns = cell.textFormatRuns;
    });
    // Gravadas pelo codigo e vazias agora: tambem sao variaveis.
    gravadas.forEach((a1) => { if (variaveis.indexOf(a1) < 0 && !formulas[a1]) variaveis.push(a1); });
    abas[chave] = { titulo: titulo, layout: compactar(layout, formatos), formulas: formulas, variaveis: variaveis.sort() };
    resumo[chave] = Object.assign(contagem, { imagens: img ? img.celulas.length + img.flutuantes.length : 0 });
  });
  return {
    arquivo: {
      versao: 1,
      origem: { revisionId: atual.revisionId || '' },
      imagens: imagens ? tabelaImagens : {},
      formatos: formatos.lista,
      abas: abas
    },
    resumo: resumo
  };
}

if (require.main === module) {
  const [atualArq, outraArq, saidaArg, imagensArq] = process.argv.slice(2);
  if (!atualArq || !outraArq) {
    console.error('Uso: node tools/export-transporte-layouts.js <atual.json> <outra-copia.json> [saida] [imagens.json]');
    process.exit(1);
  }
  const ler = (arq) => JSON.parse(fs.readFileSync(arq, 'utf8'));
  const { arquivo, resumo } = exportar(ler(atualArq), ler(outraArq), imagensArq ? ler(imagensArq) : null);
  const saida = saidaArg || path.join(__dirname, '..', 'TransporteLayoutsModelo.html');
  // Sem < e > literais: o arquivo e lido por HtmlService.createHtmlOutputFromFile.
  fs.writeFileSync(saida, JSON.stringify(arquivo).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') + '\n');
  console.table(resumo);
  console.log('Gravado: ' + saida + ' (' + fs.statSync(saida).size + ' bytes)');
}

module.exports = { exportar, compactar, inventarioEscritas, TRANSPORTE_LAYOUT_ABAS_ };
