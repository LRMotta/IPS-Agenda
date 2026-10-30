/* ===== TransporteDocumentosGrade.gs =====
 * Prova de conceito: renderiza qualquer aba-modelo da planilha de Transporte em
 * HTML a partir da grade devolvida pela API do Sheets (spreadsheets.get com
 * includeGridData). A aba ja preenchida e a fonte do layout e do conteudo; o
 * resultado usa a mesma pagina A4 de transporteDocsHtmlDocumento_.
 *
 * Regras do exportador do Sheets reproduzidas:
 * - colunas/linhas ocultas nao sao impressas;
 * - a area impressa comeca em A1 e vai ate a ultima celula com conteudo;
 *   o ajuste a largura (fitw) so reduz, nunca amplia;
 * - texto em OVERFLOW invade celulas vazias a direita; WRAP quebra; CLIP corta;
 * - caixas de selecao (validacao BOOLEAN) viram caixa com marca preta;
 * - fonte Arial, como transportePdfApplyExportFont_ faz na copia temporaria.
 */

// Pagina do exportador atual: A4, margens 0,5" (topo), 0,25" (laterais), 0,1" (base).
var TRANSPORTE_DOCS_GRADE_LARGURA_PX_ = 745;
var TRANSPORTE_DOCS_GRADE_PAGINA_ = { larguraPx: TRANSPORTE_DOCS_GRADE_LARGURA_PX_, margem: '12.7mm 6.35mm 2.5mm 6.35mm' };

var TRANSPORTE_DOCS_GRADE_BORDAS_ = {
  DOTTED: '1px dotted',
  DASHED: '1px dashed',
  SOLID: '1px solid',
  SOLID_MEDIUM: '2px solid',
  SOLID_THICK: '3px solid',
  DOUBLE: '3px double'
};

function transporteDocsGradeCor_(cor, padrao) {
  if (!cor) return padrao;
  var hex = ['red', 'green', 'blue'].map(function(k) {
    return ('0' + Math.round((cor[k] || 0) * 255).toString(16)).slice(-2);
  }).join('');
  return '#' + hex;
}

function transporteDocsGradeBorda_(borda) {
  if (!borda || !borda.style || borda.style === 'NONE') return '';
  var estilo = TRANSPORTE_DOCS_GRADE_BORDAS_[borda.style] || '1px solid';
  return estilo + ' ' + transporteDocsGradeCor_(borda.color || (borda.colorStyle && borda.colorStyle.rgbColor), '#000000');
}

function transporteDocsGradeTemTexto_(cell) {
  return String(cell && cell.formattedValue || '').trim() !== '';
}

function transporteDocsGradeTemBorda_(cell) {
  var b = cell && cell.effectiveFormat && cell.effectiveFormat.borders;
  return !!b && ['top', 'bottom', 'left', 'right'].some(function(k) { return !!transporteDocsGradeBorda_(b[k]); });
}

function transporteDocsGradeCaixa_(cell) {
  return !!(cell && cell.dataValidation && cell.dataValidation.condition &&
    cell.dataValidation.condition.type === 'BOOLEAN');
}

function transporteDocsGradeImagem_(cell) {
  var img = cell && cell.userEnteredValue && cell.userEnteredValue.imageValue;
  return img && img.imageProperties && img.imageProperties.contentUrl ? img : null;
}

// Estilo inline de texto; base permite emitir somente o que difere da celula.
function transporteDocsGradeEstiloTexto_(tf, escala, base) {
  tf = tf || {};
  base = base || {};
  var out = [];
  function diff(chave, valor, css) { if (valor !== undefined && valor !== base[chave]) out.push(css); }
  diff('bold', tf.bold, 'font-weight:' + (tf.bold ? 'bold' : 'normal'));
  diff('italic', tf.italic, 'font-style:' + (tf.italic ? 'italic' : 'normal'));
  var deco = [tf.underline ? 'underline' : '', tf.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
  var decoBase = [base.underline ? 'underline' : '', base.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
  if ((tf.underline !== undefined || tf.strikethrough !== undefined) && deco !== decoBase) out.push('text-decoration:' + deco);
  if (tf.fontSize && tf.fontSize !== base.fontSize) out.push('font-size:' + (tf.fontSize * escala).toFixed(2) + 'pt');
  var cor = tf.foregroundColor || (tf.foregroundColorStyle && tf.foregroundColorStyle.rgbColor);
  if (cor) {
    var hex = transporteDocsGradeCor_(cor, '#000000');
    var corBase = base.foregroundColor || (base.foregroundColorStyle && base.foregroundColorStyle.rgbColor);
    if (hex !== transporteDocsGradeCor_(corBase, '#000000') || !base.__cell) out.push('color:' + hex);
  }
  return out.join(';');
}

function transporteDocsGradeTextoHtml_(texto) {
  return transporteDocsHtmlEscape_(texto).replace(/\r?\n/g, '<br>');
}

// Texto com formatacao mista (textFormatRuns): cada trecho herda o formato da celula.
function transporteDocsGradeConteudo_(cell, escala) {
  var texto = String(cell.formattedValue || '');
  var runs = cell.textFormatRuns;
  if (!runs || !runs.length) return transporteDocsGradeTextoHtml_(texto);
  var base = (cell.effectiveFormat && cell.effectiveFormat.textFormat) || {};
  return runs.map(function(run, i) {
    var inicio = run.startIndex || 0;
    var fim = i + 1 < runs.length ? runs[i + 1].startIndex : texto.length;
    var trecho = transporteDocsGradeTextoHtml_(texto.substring(inicio, fim));
    var estilo = transporteDocsGradeEstiloTexto_(Object.assign({}, base, run.format || {}), escala, Object.assign({ __cell: true }, base));
    return estilo ? '<span style="' + estilo + '">' + trecho + '</span>' : trecho;
  }).join('');
}

/**
 * Mesclagens e area impressa (exportador do Sheets): sempre a partir de A1 ate a
 * ultima coluna/linha com texto, borda, caixa, imagem ou ancora de imagem flutuante,
 * incluindo mesclagens. Devolve { mesclas, cobertas, c1, rFim } com indices de
 * base 0 (c1/rFim = -1 se vazia).
 */
function transporteDocsGradeArea_(sheet) {
  var data = (sheet.data || [])[0] || {};
  var linhasDados = data.rowData || [];
  var nLinhas = Math.max(linhasDados.length, (data.rowMetadata || []).length);
  var nColunas = (data.columnMetadata || []).length;
  linhasDados.forEach(function(row) { nColunas = Math.max(nColunas, (row.values || []).length); });
  function cel(r, c) { var row = linhasDados[r]; return (row && row.values && row.values[c]) || {}; }

  var mesclas = {};
  var cobertas = {};
  (sheet.merges || []).forEach(function(m) {
    var r0 = m.startRowIndex || 0, c0 = m.startColumnIndex || 0;
    mesclas[r0 + ':' + c0] = { rs: m.endRowIndex - r0, cs: m.endColumnIndex - c0 };
    for (var r = r0; r < m.endRowIndex; r++) {
      for (var c = c0; c < m.endColumnIndex; c++) if (r !== r0 || c !== c0) cobertas[r + ':' + c] = true;
    }
  });

  var c1 = -1, rFim = -1;
  for (var r = 0; r < nLinhas; r++) {
    for (var c = 0; c < nColunas; c++) {
      if (cobertas[r + ':' + c]) continue;
      var cell = cel(r, c);
      var m = mesclas[r + ':' + c];
      var span = m ? m.cs : 1;
      var conteudo = transporteDocsGradeTemTexto_(cell) || transporteDocsGradeTemBorda_(cell) ||
        transporteDocsGradeCaixa_(cell) || transporteDocsGradeImagem_(cell);
      if (!conteudo) continue;
      c1 = Math.max(c1, c + span - 1);
      rFim = Math.max(rFim, r + (m ? m.rs : 1) - 1);
    }
  }
  (sheet.imagensFlutuantes || []).forEach(function(img) {
    c1 = Math.max(c1, img.c);
    rFim = Math.max(rFim, img.r);
  });
  return { mesclas: mesclas, cobertas: cobertas, c1: c1, rFim: rFim };
}

/**
 * sheet: objeto de spreadsheets.get (properties, merges, data[0]) e, opcionalmente,
 * imagensFlutuantes: [{ r, c, x, y, w, h, url }] (ancora de base 0, pixels do Sheets).
 * opcoes.imagemSrc(url): converte a URL da imagem (ex.: data URI em cache).
 * Devolve o HTML de uma pagina (tabela), pronto para transporteDocsHtmlDocumento_.
 */
function transporteDocsGradeHtml_(sheet, opcoes) {
  opcoes = opcoes || {};
  var data = (sheet.data || [])[0] || {};
  var linhasDados = data.rowData || [];
  var colMeta = data.columnMetadata || [];
  var rowMeta = data.rowMetadata || [];
  function cel(r, c) { var row = linhasDados[r]; return (row && row.values && row.values[c]) || {}; }
  function colOculta(c) { return !!(colMeta[c] && colMeta[c].hiddenByUser); }
  function linhaOculta(r) { return !!(rowMeta[r] && rowMeta[r].hiddenByUser); }
  function largura(c) { return colOculta(c) ? 0 : ((colMeta[c] && colMeta[c].pixelSize) || 100); }
  function altura(r) { return (rowMeta[r] && rowMeta[r].pixelSize) || 21; }
  function srcImagem(url) { return typeof opcoes.imagemSrc === 'function' ? opcoes.imagemSrc(url) : url; }

  var area = transporteDocsGradeArea_(sheet);
  var mesclas = area.mesclas, cobertas = area.cobertas;
  var c0 = 0, c1 = area.c1, rFim = area.rFim;
  if (c1 < 0) throw new Error('Aba sem conteúdo imprimível: ' + ((sheet.properties || {}).title || ''));

  var colunas = [];
  for (var cc = c0; cc <= c1; cc++) if (!colOculta(cc)) colunas.push(cc);
  var larguraFonte = colunas.reduce(function(acc, c) { return acc + largura(c); }, 0);
  // fitw do exportador so reduz: abas estreitas saem em tamanho natural.
  var escala = Math.min(1, (TRANSPORTE_DOCS_GRADE_LARGURA_PX_ - 2) / larguraFonte);
  // O exportador comprime linhas e fontes em ~0,97 em relacao a largura ajustada
  // (medido no PDF atual: alturas e largura de texto).
  var escalaV = escala * 0.97;
  var escalaFonte = escala * 0.97;

  function visiveisEntre(a, b) {
    var n = 0;
    for (var c = a; c <= b; c++) if (c >= c0 && c <= c1 && !colOculta(c)) n++;
    return n;
  }
  var absorvidas = {};
  // No Sheets o texto invade vizinhas sem conteudo, mesmo quando elas tem borda.
  function vazia(r, c) {
    if (cobertas[r + ':' + c] || mesclas[r + ':' + c] || absorvidas[r + ':' + c]) return false;
    var cell = cel(r, c);
    return !transporteDocsGradeTemTexto_(cell) && !transporteDocsGradeCaixa_(cell) && !transporteDocsGradeImagem_(cell);
  }
  function formatoTexto(r, c) {
    var cell = cel(r, c);
    var fmt = cell.effectiveFormat || {};
    var caixa = transporteDocsGradeCaixa_(cell);
    var numero = cell.effectiveValue && cell.effectiveValue.numberValue !== undefined;
    return {
      alinhamento: fmt.horizontalAlignment || (caixa ? 'CENTER' : (numero ? 'RIGHT' : 'LEFT')),
      quebra: fmt.wrapStrategy || 'OVERFLOW_CELL'
    };
  }

  // Mesclagem com a origem em linha ou coluna oculta continua visivel no Sheets:
  // ela e exibida na primeira linha/coluna visivel do intervalo.
  var realocadas = {};
  Object.keys(mesclas).forEach(function(chave) {
    var partes = chave.split(':');
    var r0 = Number(partes[0]), k0 = Number(partes[1]), m = mesclas[chave];
    if (!linhaOculta(r0) && !colOculta(k0)) return;
    var rv = -1, cv = -1;
    for (var r = r0; r < r0 + m.rs && r <= rFim && rv < 0; r++) if (!linhaOculta(r)) rv = r;
    for (var c = k0; c < k0 + m.cs && c <= c1 && cv < 0; c++) if (!colOculta(c)) cv = c;
    if (rv >= 0 && cv >= 0) realocadas[rv + ':' + cv] = { r: r0, c: k0 };
  });

  // Texto em OVERFLOW alinhado a direita invade as vazias a esquerda; centralizado
  // invade os dois lados por igual. So as celulas necessarias ao comprimento estimado
  // do texto sao ocupadas, e a linha e preparada antes da emissao das celulas.
  var extensoes = {};
  function prepararTransbordo(r) {
    for (var c = c0; c <= c1; c++) {
      if (colOculta(c) || cobertas[r + ':' + c] || mesclas[r + ':' + c] || absorvidas[r + ':' + c]) continue;
      var cell = cel(r, c);
      if (!transporteDocsGradeTemTexto_(cell)) continue;
      var f = formatoTexto(r, c);
      if (f.quebra !== 'OVERFLOW_CELL' || (f.alinhamento !== 'RIGHT' && f.alinhamento !== 'CENTER')) continue;
      var tf = (cell.effectiveFormat || {}).textFormat || {};
      var excesso = transporteDocsHtmlLarguraTextoPx_(cell.formattedValue, tf.fontSize || 10, tf.bold) - (largura(c) - 4);
      if (excesso <= 0) continue;
      var ext = { esquerda: [], direita: [] };
      if (f.alinhamento === 'RIGHT') {
        for (var k = c - 1; k >= c0 && excesso > 0 && vazia(r, k); k--) {
          absorvidas[r + ':' + k] = true;
          ext.esquerda.push(k);
          excesso -= largura(k);
        }
      } else {
        for (var esq = c - 1, dir = c + 1; excesso > 0 && esq >= c0 && dir <= c1 && vazia(r, esq) && vazia(r, dir); esq--, dir++) {
          absorvidas[r + ':' + esq] = true;
          absorvidas[r + ':' + dir] = true;
          ext.esquerda.push(esq);
          ext.direita.push(dir);
          excesso -= largura(esq) + largura(dir);
        }
      }
      if (ext.esquerda.length) extensoes[r + ':' + c] = ext;
    }
  }

  var excessoLinha = {};
  var html = ['<table class="grade" style="width:' + (larguraFonte * escala).toFixed(1) + 'px"><colgroup>'];
  colunas.forEach(function(c) { html.push('<col style="width:' + (largura(c) * escala).toFixed(2) + 'px">'); });
  html.push('</colgroup>');

  // Imagens sobre a grade: cada uma vai numa linha de altura zero logo antes da linha
  // da ancora (ou da primeira visivel depois dela), posicionada pelo deslocamento na
  // celula. Ancorar na linha, e nao no topo da tabela, evita que o crescimento das
  // linhas de texto acima no HTML desloque a imagem.
  var flutuantesPorLinha = {};
  (sheet.imagensFlutuantes || []).forEach(function(img) {
    var linha = img.r;
    while (linha <= rFim && linhaOculta(linha)) linha++;
    var x = img.x || 0;
    for (var ic = c0; ic < img.c; ic++) x += largura(ic);
    var posicao = 'position:absolute;left:' + (x * escala).toFixed(1) + 'px;top:' + ((img.y || 0) * escalaV).toFixed(1) +
      'px;width:' + (img.w * escala).toFixed(1) + 'px;height:' + (img.h * escalaV).toFixed(1) + 'px';
    (flutuantesPorLinha[linha] = flutuantesPorLinha[linha] || []).push(
      '<img src="' + transporteDocsHtmlEscape_(srcImagem(img.url)) + '" alt="" style="' + posicao + '">');
  });
  function linhaFlutuantes(linha) {
    if (!flutuantesPorLinha[linha]) return;
    html.push('<tr style="height:0"><td colspan="' + colunas.length + '" style="padding:0;border:0;height:0;line-height:0">' +
      '<div style="position:relative;height:0">' + flutuantesPorLinha[linha].join('') + '</div></td></tr>');
  }

  for (var lr = 0; lr <= rFim; lr++) {
    if (linhaOculta(lr)) continue;
    prepararTransbordo(lr);
    linhaFlutuantes(lr);
    html.push('<tr style="height:' + (altura(lr) * escalaV).toFixed(2) + 'px">');
    for (var lc = c0; lc <= c1; lc++) {
      if (colOculta(lc)) continue;
      var realocada = realocadas[lr + ':' + lc];
      if (realocada) { html.push(transporteDocsGradeCelulaHtml_(realocada.r, realocada.c, lr)); continue; }
      if (cobertas[lr + ':' + lc] || absorvidas[lr + ':' + lc]) continue;
      html.push(transporteDocsGradeCelulaHtml_(lr, lc, lr));
    }
    html.push('</tr>');
  }
  linhaFlutuantes(rFim + 1);
  html.push('</table>');

  var alturaTotal = 0;
  for (var ar = 0; ar <= rFim; ar++) if (!linhaOculta(ar)) alturaTotal += (altura(ar) + (excessoLinha[ar] || 0)) * escalaV;
  transporteDocsHtmlValidarAltura_(alturaTotal, (sheet.properties || {}).title);

  return html.join('');

  // rExib: linha em que a celula e emitida (difere de r quando a origem da mesclagem esta oculta).
  function transporteDocsGradeCelulaHtml_(r, c, rExib) {
    var cell = cel(r, c);
    var fmt = cell.effectiveFormat || {};
    var tf = fmt.textFormat || {};
    var m = mesclas[r + ':' + c];
    var cs = m ? visiveisEntre(c, Math.min(c + m.cs - 1, c1)) : 1;
    var rs = 1;
    if (m) {
      rs = 0;
      for (var k = r; k < r + m.rs && k <= rFim; k++) if (!linhaOculta(k)) rs++;
      rs = Math.max(rs, 1);
    }
    var imagem = transporteDocsGradeImagem_(cell);
    var caixa = transporteDocsGradeCaixa_(cell);
    var texto = transporteDocsGradeTemTexto_(cell);
    var f = formatoTexto(r, c);
    var alinhamento = f.alinhamento;
    var quebra = f.quebra;
    var borda = transporteDocsGradeTemBorda_(cell);

    // Texto em OVERFLOW alinhado a esquerda ocupa as vazias seguintes, como no Sheets.
    // O texto e cortado na primeira celula ocupada, que delimita o trecho absorvido.
    // As bordas do trecho combinam: esquerda da primeira celula, direita da ultima,
    // superior/inferior quando qualquer celula do trecho as tiver.
    var absorveu = false;
    var bordas = Object.assign({}, fmt.borders || {});
    var colunasTrecho = [c];
    function absorver(k, lado) {
      if (!colOculta(k)) cs++;
      absorveu = true;
      var bp = (cel(r, k).effectiveFormat || {}).borders || {};
      bordas[lado] = bp[lado];
      ['top', 'bottom'].forEach(function(b) { if (!transporteDocsGradeBorda_(bordas[b]) && transporteDocsGradeBorda_(bp[b])) bordas[b] = bp[b]; });
      colunasTrecho.push(k);
    }
    var ext = extensoes[r + ':' + c];
    var larguraEsq = 0, larguraDir = 0;
    if (ext) {
      ext.esquerda.forEach(function(k) { absorver(k, 'left'); larguraEsq += largura(k); });
      ext.direita.forEach(function(k) { absorver(k, 'right'); larguraDir += largura(k); });
    } else if (!m && texto && quebra === 'OVERFLOW_CELL' && alinhamento === 'LEFT') {
      for (var prox = c + 1; prox <= c1 && vazia(r, prox); prox++) {
        absorvidas[r + ':' + prox] = true;
        absorver(prox, 'right');
      }
    }
    if (absorveu) borda = ['top', 'bottom', 'left', 'right'].some(function(k) { return !!transporteDocsGradeBorda_(bordas[k]); });

    var estilo = [];
    var estiloTexto = transporteDocsGradeEstiloTexto_(tf, escalaFonte, {});
    if (estiloTexto) estilo.push(estiloTexto);
    estilo.push('text-align:' + { LEFT: 'left', CENTER: 'center', RIGHT: 'right' }[alinhamento]);
    estilo.push('vertical-align:' + ({ TOP: 'top', MIDDLE: 'middle', BOTTOM: 'bottom' }[fmt.verticalAlignment] || 'bottom'));
    if (quebra === 'WRAP' || quebra === 'LEGACY_WRAP') estilo.push('white-space:normal');
    if (quebra === 'CLIP' || borda || m || absorveu) estilo.push('overflow:hidden');
    // Recuo lateral de 2 px na escala da pagina: com o padding nominal do Sheets
    // (3 px) linhas que cabem no PDF atual quebravam. Texto centralizado que invade
    // larguras diferentes dos dois lados recebe recuo para manter o centro da origem.
    var pad = fmt.padding || {};
    var recuo = { left: 2, right: 2 };
    if (larguraDir && larguraEsq !== larguraDir) recuo[larguraEsq > larguraDir ? 'left' : 'right'] += Math.abs(larguraEsq - larguraDir) * escala;
    estilo.push('padding:' + ['top', 'right', 'bottom', 'left'].map(function(k) {
      var vertical = k === 'top' || k === 'bottom';
      return vertical ? ((pad[k] === undefined ? 2 : pad[k]) * escala).toFixed(1) + 'px' : (recuo[k] === 2 ? '2px' : recuo[k].toFixed(1) + 'px');
    }).join(' '));
    ['top', 'right', 'bottom', 'left'].forEach(function(k) {
      var b = transporteDocsGradeBorda_(bordas[k]);
      if (b) estilo.push('border-' + k + ':' + b);
    });

    if (texto && !imagem && !caixa) {
      // Altura que o texto ocupara no HTML (estimada); o que passar das linhas da
      // celula faz a linha crescer e entra na conferencia da altura da pagina.
      var larguraTrecho = 0, alturaTrecho = 0;
      if (m) {
        for (var mc = c; mc < c + m.cs && mc <= c1; mc++) larguraTrecho += largura(mc);
      } else {
        colunasTrecho.forEach(function(k) { larguraTrecho += largura(k); });
      }
      for (var mr = r; mr < r + (m ? m.rs : 1) && mr <= rFim; mr++) if (!linhaOculta(mr)) alturaTrecho += altura(mr);
      var necessaria = transporteDocsHtmlAlturaTextoPx_(cell.formattedValue, larguraTrecho - 4, tf.fontSize || 10, tf.bold,
        quebra === 'WRAP' || quebra === 'LEGACY_WRAP') + 4;
      if (necessaria > alturaTrecho) excessoLinha[rExib] = Math.max(excessoLinha[rExib] || 0, necessaria - alturaTrecho);
    }

    var conteudo = '';
    if (imagem) {
      var larguraCel = 0, alturaCel = 0;
      for (var ic = c; ic < c + (m ? m.cs : 1); ic++) if (ic >= c0 && ic <= c1) larguraCel += largura(ic);
      for (var ir = r; ir < r + (m ? m.rs : 1); ir++) if (!linhaOculta(ir)) alturaCel += altura(ir);
      conteudo = '<img src="' + transporteDocsHtmlEscape_(srcImagem(imagem.imageProperties.contentUrl)) + '" alt="" style="max-width:' + (larguraCel * escala).toFixed(1) +
        'px;max-height:' + (alturaCel * escalaV).toFixed(1) + 'px">';
    } else if (caixa) {
      conteudo = transporteDocsHtmlCheckbox_(!!(cell.effectiveValue && cell.effectiveValue.boolValue));
    } else if (texto) {
      conteudo = transporteDocsGradeConteudo_(cell, escalaFonte);
    }
    return '<td' + (cs > 1 ? ' colspan="' + cs + '"' : '') + (rs > 1 ? ' rowspan="' + rs + '"' : '') +
      ' style="' + estilo.join(';') + '">' + conteudo + '</td>';
  }
}

/**
 * Monta o documento com as copias na ordem informada.
 * abas: mapa titulo -> sheet (spreadsheets.get); documentos: [{ aba, copias, html? }].
 * html substitui a renderizacao da aba (Folha de Agendamento: transporteFolhaHtmlParaGrade_).
 */
function transporteDocsGradeMontar_(abas, documentos, opcoes) {
  var paginas = [];
  (documentos || []).forEach(function(doc) {
    var sheet = abas[doc.aba];
    if (!sheet && !doc.html) throw new Error('Aba necessária não encontrada: ' + doc.aba);
    var pagina = doc.html || transporteDocsGradeHtml_(sheet, opcoes);
    for (var i = 0; i < Math.max(1, Number(doc.copias) || 1); i++) paginas.push(pagina);
  });
  if (!paginas.length) throw new Error('Nenhum documento informado para a documentação HTML.');
  return transporteDocsHtmlDocumento_(paginas, TRANSPORTE_DOCS_GRADE_PAGINA_);
}

/* ===== Leitura da grade: layout em cache + valores a cada geracao =====
 * O layout das abas-modelo (larguras, alturas, mesclagens, formatos, caixas e
 * imagens) quase nunca muda, mas e a parte pesada da leitura. Ele e lido uma vez,
 * recortado a area impressa, sem nenhum texto ou valor, compactado (gzip) e
 * guardado no cache do script em pedacos. A cada geracao so os valores da area
 * impressa sao lidos e aplicados sobre o layout.
 * Formatos que mudam a cada geracao nao podem vir do cache: as faixas com
 * formatacao condicional e as que o preenchimento formata por codigo
 * (TRANSPORTE_DOCS_GRADE_FORMATOS_CODIGO_) tem o formato relido junto com os valores.
 * Alterou o modelo? Execute limparCacheLayoutTransporteHtml(): a revisao do layout
 * muda para todas as abas e couriers (sem isso o cache expira em 6 h).
 */
var TRANSPORTE_DOCS_GRADE_CACHE_VERSAO_ = 'tdg4';
var TRANSPORTE_DOCS_GRADE_CACHE_TTL_S_ = 21600;
var TRANSPORTE_DOCS_GRADE_CACHE_PEDACO_ = 90000;
var TRANSPORTE_DOCS_GRADE_REVISAO_PROP_ = 'TRANSPORTE_DOCS_GRADE_LAYOUT_REV';

// Chave da aba (transporteCodexGetSheet_) -> faixas formatadas por codigo a cada geracao.
// declaracaoTransp: transporteAjustarVolumesDeclaracao_ define fonte e quebra dos volumes.
var TRANSPORTE_DOCS_GRADE_FORMATOS_CODIGO_ = {
  declaracaoTransp: ['J21:L28']
};

// Chave da aba -> chave da aba de origem da imagem flutuante enviada por upload (sem
// origem legivel). A imagem usada e a de celula mais abaixo na aba de origem (o
// rodape), na posicao e no tamanho da flutuante. So vale quando a aba tem exatamente
// uma imagem assim; as demais continuam sinalizadas como omitidas.
// invoiceMarken: o rodape "CAMPUS SEDE" e a mesma imagem de B53 da Declaracao.
var TRANSPORTE_DOCS_GRADE_IMAGENS_CODIGO_ = {
  invoiceMarken: 'declaracaoTransp'
};

// Courier -> abas (chaves) em que o contato de emergencia do modelo e trocado pelo
// da courier. A MARKEN pediu a troca somente na Ficha de Emergencia; nas demais
// abas e couriers o texto do modelo e mantido.
var TRANSPORTE_DOCS_GRADE_CONTATO_ABAS_ = {
  MARKEN: ['fichaEmergenciaMarken']
};

var TRANSPORTE_DOCS_GRADE_CAMPOS_ = 'sheets(properties(title),merges,conditionalFormats(ranges),' +
  'data(columnMetadata(pixelSize,hiddenByUser),' +
  'rowMetadata(pixelSize,hiddenByUser),rowData(values(formattedValue,effectiveValue(numberValue,boolValue),' +
  'effectiveFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding,borders),' +
  'textFormatRuns,dataValidation(condition(type)),userEnteredValue))))';

var TRANSPORTE_DOCS_GRADE_CAMPOS_VALORES_ = 'sheets(properties(title),data(startRow,startColumn,' +
  'rowData(values(formattedValue,effectiveValue(numberValue,boolValue),textFormatRuns))))';

var TRANSPORTE_DOCS_GRADE_CAMPOS_FORMATOS_ = 'sheets(properties(title),data(startRow,startColumn,' +
  'rowData(values(effectiveFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding,borders)))))';

// Status/motivo do erro da API (ex.: PERMISSION_DENIED / SERVICE_DISABLED), sem o texto livre.
function transporteDocsGradeMotivoErro_(texto) {
  try {
    var erro = JSON.parse(texto).error || {};
    var motivo = ((erro.details || []).filter(function(d) { return d && d.reason; })[0] || {}).reason;
    return [erro.status, motivo].filter(Boolean).join(' / ');
  } catch (e) {
    return '';
  }
}

function transporteDocsGradeLetraColuna_(n) {
  var s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// 'Aba' inteira, ou 'Aba'!A1:<coluna><linha> quando colunas/linhas sao informadas.
function transporteDocsGradeIntervaloAba_(titulo, colunas, linhas) {
  var aba = "'" + String(titulo).replace(/'/g, "''") + "'";
  return colunas && linhas ? aba + '!A1:' + transporteDocsGradeLetraColuna_(colunas) + linhas : aba;
}

// Faixa de base 0 (fim exclusivo) em notacao A1 com o nome da aba.
function transporteDocsGradeFaixaA1_(titulo, faixa) {
  return "'" + String(titulo).replace(/'/g, "''") + "'!" +
    transporteDocsGradeLetraColuna_(faixa.c0 + 1) + (faixa.r0 + 1) + ':' +
    transporteDocsGradeLetraColuna_(faixa.c1) + faixa.r1;
}

/**
 * spreadsheets.get com grade, pela REST (UrlFetchApp) e, quando ela e recusada,
 * pelo servico avancado Sheets. Nenhuma das duas devolve imagens dentro das
 * celulas: elas vem de transporteDocsGradeImagensCelulas_. Devolve { dados, bytes, via }.
 */
function transporteDocsGradeLer_(spreadsheetId, ranges, campos, token) {
  return transporteDocsGradeLerVarios_(spreadsheetId, [{ ranges: ranges, campos: campos }], token)[0];
}

// Varias leituras independentes; com mais de uma, as requisicoes saem em paralelo.
function transporteDocsGradeLerVarios_(spreadsheetId, pedidos, token) {
  var requisicoes = pedidos.map(function(pedido) {
    return {
      url: 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) +
        '?includeGridData=true&fields=' + encodeURIComponent(pedido.campos) +
        pedido.ranges.map(function(r) { return '&ranges=' + encodeURIComponent(r); }).join(''),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  });
  var respostas = requisicoes.length === 1
    ? [UrlFetchApp.fetch(requisicoes[0].url, { headers: requisicoes[0].headers, muteHttpExceptions: true })]
    : UrlFetchApp.fetchAll(requisicoes);
  return respostas.map(function(resp, i) {
    var codigo = resp.getResponseCode();
    var texto = resp.getContentText();
    if (codigo === 200) return { dados: JSON.parse(texto), bytes: texto.length, via: 'rest' };
    var motivo = transporteDocsGradeMotivoErro_(texto);
    var erro = 'HTTP ' + codigo + (motivo ? ': ' + motivo : '');
    if (typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets) {
      var dados = Sheets.Spreadsheets.get(spreadsheetId, { ranges: pedidos[i].ranges, includeGridData: true, fields: pedidos[i].campos });
      return { dados: dados, bytes: JSON.stringify(dados).length, via: 'avancado (REST ' + erro + ')' };
    }
    throw new Error('Leitura da grade falhou (' + erro + ').');
  });
}

/**
 * Layout da aba sem texto nem valores: recortado a area impressa atual e com as
 * imagens das celulas convertidas em data URI (imagens que falharem sao omitidas).
 */
function transporteDocsGradeLayout_(sheet, imagens) {
  var area = transporteDocsGradeArea_(sheet);
  if (area.c1 < 0) throw new Error('Aba sem conteúdo imprimível: ' + ((sheet.properties || {}).title || ''));
  var colunas = area.c1 + 1, linhas = area.rFim + 1;
  var data = (sheet.data || [])[0] || {};
  var rowData = (data.rowData || []).slice(0, linhas).map(function(row) {
    return { values: (row.values || []).slice(0, colunas).map(function(cell) {
      var out = {};
      if (cell.effectiveFormat) out.effectiveFormat = cell.effectiveFormat;
      if (cell.dataValidation) out.dataValidation = cell.dataValidation;
      var img = transporteDocsGradeImagem_(cell);
      var src = img && imagens && imagens[img.imageProperties.contentUrl];
      if (src) out.userEnteredValue = { imageValue: { imageProperties: { contentUrl: src } } };
      return out;
    }) };
  });
  // Formatacao condicional depende dos valores: so a faixa (recortada a area) vai ao cache.
  var condicionais = [];
  (sheet.conditionalFormats || []).forEach(function(regra) {
    (regra.ranges || []).forEach(function(g) {
      var faixa = {
        r0: g.startRowIndex || 0, r1: Math.min(g.endRowIndex === undefined ? linhas : g.endRowIndex, linhas),
        c0: g.startColumnIndex || 0, c1: Math.min(g.endColumnIndex === undefined ? colunas : g.endColumnIndex, colunas)
      };
      if (faixa.r1 > faixa.r0 && faixa.c1 > faixa.c0) condicionais.push(faixa);
    });
  });
  // Imagens sobre a grade: so as incorporadas (data URI) vao ao cache; as demais
  // ficam contadas em imagensOmitidas para o diagnostico nao as perder em silencio.
  var flutuantes = [];
  var omitidas = Number(sheet.imagensFlutuantesSemOrigem) || 0;
  (sheet.imagensFlutuantes || []).forEach(function(img) {
    var src = imagens && imagens[img.url];
    if (src) flutuantes.push({ r: img.r, c: img.c, x: img.x, y: img.y, w: img.w, h: img.h, url: src });
    else omitidas++;
  });
  return {
    properties: { title: (sheet.properties || {}).title },
    merges: sheet.merges || [],
    area: { colunas: colunas, linhas: linhas },
    formatosCondicionais: condicionais,
    imagensFlutuantes: flutuantes,
    imagensOmitidas: omitidas,
    data: [{
      columnMetadata: (data.columnMetadata || []).slice(0, colunas),
      rowMetadata: (data.rowMetadata || []).slice(0, linhas),
      rowData: rowData
    }]
  };
}

// Aplica texto, valores e formatacao mista lidos a cada geracao sobre o layout (modifica o layout).
function transporteDocsGradeAplicarValores_(layout, valores) {
  var dados = (valores.data || [])[0] || {};
  var r0 = dados.startRow || 0, c0 = dados.startColumn || 0;
  var rows = layout.data[0].rowData;
  (dados.rowData || []).forEach(function(row, i) {
    (row.values || []).forEach(function(v, j) {
      if (!v || (v.formattedValue === undefined && !v.effectiveValue)) return;
      var r = r0 + i, c = c0 + j;
      while (rows.length <= r) rows.push({ values: [] });
      var celulas = rows[r].values || (rows[r].values = []);
      while (celulas.length <= c) celulas.push({});
      var cell = celulas[c] || (celulas[c] = {});
      if (v.formattedValue !== undefined) cell.formattedValue = v.formattedValue;
      if (v.effectiveValue) cell.effectiveValue = v.effectiveValue;
      if (v.textFormatRuns) cell.textFormatRuns = v.textFormatRuns;
    });
  });
  return layout;
}

// Substitui o formato das celulas relidas (todas as faixas da aba) no layout (modifica o layout).
function transporteDocsGradeAplicarFormatos_(layout, formatos) {
  var rows = layout.data[0].rowData;
  (formatos.data || []).forEach(function(dados) {
    var r0 = dados.startRow || 0, c0 = dados.startColumn || 0;
    (dados.rowData || []).forEach(function(row, i) {
      (row.values || []).forEach(function(v, j) {
        var r = r0 + i, c = c0 + j;
        while (rows.length <= r) rows.push({ values: [] });
        var celulas = rows[r].values || (rows[r].values = []);
        while (celulas.length <= c) celulas.push({});
        var cell = celulas[c] || (celulas[c] = {});
        if (v && v.effectiveFormat) cell.effectiveFormat = v.effectiveFormat;
        else delete cell.effectiveFormat;
      });
    });
  });
  return layout;
}

// Faixas A1 (com o nome da aba) cujo formato e relido a cada geracao.
function transporteDocsGradeFaixasDinamicas_(layout, faixasCodigo) {
  var titulo = layout.properties.title;
  return (layout.formatosCondicionais || []).map(function(faixa) {
    return transporteDocsGradeFaixaA1_(titulo, faixa);
  }).concat((faixasCodigo || []).map(function(a1) {
    return "'" + String(titulo).replace(/'/g, "''") + "'!" + a1;
  }));
}

// Titulo real da aba -> faixas de TRANSPORTE_DOCS_GRADE_FORMATOS_CODIGO_.
function transporteDocsGradeFormatosCodigo_(ss) {
  var out = {};
  if (typeof transportePdfActualSheetName_ !== 'function') return out;
  Object.keys(TRANSPORTE_DOCS_GRADE_FORMATOS_CODIGO_).forEach(function(chave) {
    var titulo = transportePdfActualSheetName_(chave, ss);
    if (titulo) out[titulo] = (out[titulo] || []).concat(TRANSPORTE_DOCS_GRADE_FORMATOS_CODIGO_[chave]);
  });
  return out;
}

function transporteDocsGradeRevisao_(propriedades) {
  return String(propriedades.getProperty(TRANSPORTE_DOCS_GRADE_REVISAO_PROP_) || '0');
}

function transporteDocsGradeCacheChave_(spreadsheetId, titulo, revisao) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, spreadsheetId + '|' + titulo + '|' + (revisao || '0'), Utilities.Charset.UTF_8);
  return TRANSPORTE_DOCS_GRADE_CACHE_VERSAO_ + ':' + digest.map(function(b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// Grava o layout compactado em pedacos (limite de 100 KB por item do CacheService).
function transporteDocsGradeCacheSalvar_(cache, chave, layout) {
  var texto = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(layout), 'application/json')).getBytes());
  var itens = {};
  var n = Math.ceil(texto.length / TRANSPORTE_DOCS_GRADE_CACHE_PEDACO_);
  for (var i = 0; i < n; i++) itens[chave + ':' + i] = texto.substr(i * TRANSPORTE_DOCS_GRADE_CACHE_PEDACO_, TRANSPORTE_DOCS_GRADE_CACHE_PEDACO_);
  itens[chave] = String(n);
  cache.putAll(itens, TRANSPORTE_DOCS_GRADE_CACHE_TTL_S_);
  return texto.length;
}

// Devolve o layout ou null quando ausente, incompleto ou ilegivel.
function transporteDocsGradeCacheLer_(cache, chave) {
  var n = Number(cache.get(chave));
  if (!n) return null;
  var chaves = [];
  for (var i = 0; i < n; i++) chaves.push(chave + ':' + i);
  var pedacos = cache.getAll(chaves);
  if (chaves.some(function(k) { return !pedacos[k]; })) return null;
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(chaves.map(function(k) { return pedacos[k]; }).join('')), 'application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8'));
  } catch (e) {
    return null;
  }
}

function transporteDocsGradeUrlsImagens_(sheets) {
  var urls = {};
  sheets.forEach(function(sheet) {
    var linhas = ((sheet.data || [])[0] || {}).rowData || [];
    linhas.forEach(function(row) {
      (row.values || []).forEach(function(cell) {
        var img = transporteDocsGradeImagem_(cell);
        if (img) urls[img.imageProperties.contentUrl] = true;
      });
    });
    (sheet.imagensFlutuantes || []).forEach(function(img) { urls[img.url] = true; });
  });
  return Object.keys(urls);
}

/**
 * Imagens sobre a grade (OverGridImage): ancora, deslocamento e tamanho em pixels do
 * Sheets. getUrl so existe para imagens inseridas por URL; as enviadas por upload
 * nao tem origem legivel: sao contadas (semOrigem) e a posicao fica em
 * posicoesSemOrigem, para a imagem de origem de TRANSPORTE_DOCS_GRADE_IMAGENS_CODIGO_.
 */
function transporteDocsGradeImagensFlutuantes_(sh) {
  var out = { imagens: [], semOrigem: 0, posicoesSemOrigem: [] };
  if (typeof sh.getImages !== 'function') return out;
  sh.getImages().forEach(function(img) {
    var url;
    try { url = String(img.getUrl() || ''); } catch (e) { url = ''; }
    if (!/^https:\/\//i.test(url)) {
      out.semOrigem++;
      var posicao = transporteDocsGradePosicaoImagem_(img);
      if (posicao) out.posicoesSemOrigem.push(posicao);
      return;
    }
    var comOrigem = transporteDocsGradePosicaoImagem_(img);
    if (!comOrigem) { out.semOrigem++; return; }
    comOrigem.url = url;
    out.imagens.push(comOrigem);
  });
  return out;
}

// Ancora (base 0), deslocamento e tamanho; null se a imagem nao informar a posicao.
function transporteDocsGradePosicaoImagem_(img) {
  try {
    var ancora = img.getAnchorCell();
    return {
      r: ancora.getRow() - 1, c: ancora.getColumn() - 1,
      x: img.getAnchorCellXOffset(), y: img.getAnchorCellYOffset(),
      w: img.getWidth(), h: img.getHeight()
    };
  } catch (e) {
    return null;
  }
}

// Titulo real da aba -> titulo real da aba de origem (TRANSPORTE_DOCS_GRADE_IMAGENS_CODIGO_).
function transporteDocsGradeImagensCodigo_(ss) {
  var out = {};
  if (typeof transportePdfActualSheetName_ !== 'function') return out;
  Object.keys(TRANSPORTE_DOCS_GRADE_IMAGENS_CODIGO_).forEach(function(chave) {
    var titulo = transportePdfActualSheetName_(chave, ss);
    var origem = transportePdfActualSheetName_(TRANSPORTE_DOCS_GRADE_IMAGENS_CODIGO_[chave], ss);
    if (titulo && origem) out[titulo] = origem;
  });
  return out;
}

// URL da imagem de celula mais abaixo (o rodape) entre as encontradas na aba.
function transporteDocsGradeImagemRodape_(celulas) {
  var rodape = null;
  (celulas || []).forEach(function(img) { if (!rodape || img.r > rodape.r) rodape = img; });
  return rodape ? rodape.url : '';
}

// O token do usuario so acompanha downloads de hosts do Google.
function transporteDocsGradeHostGoogle_(url) {
  return /^https:\/\/([a-z0-9-]+\.)*(googleusercontent|google|googleapis)\.com(\/|$)/i.test(String(url || ''));
}

/**
 * Imagens dentro das celulas: a API publica do Sheets nao devolve imageValue,
 * mas getValues do SpreadsheetApp devolve CellImage (getContentUrl). Indices de
 * base 0 a partir de A1. Usado so ao (re)montar o layout.
 */
function transporteDocsGradeImagensCelulas_(sh) {
  var tipo = SpreadsheetApp.ValueType && SpreadsheetApp.ValueType.IMAGE;
  var achadas = [];
  sh.getDataRange().getValues().forEach(function(linha, r) {
    linha.forEach(function(v, c) {
      if (!v || typeof v !== 'object' || v.valueType !== tipo || typeof v.getContentUrl !== 'function') return;
      var url = v.getContentUrl();
      if (url) achadas.push({ r: r, c: c, url: url });
    });
  });
  return achadas;
}

function transporteDocsGradeMarcarImagem_(sheet, r, c, url) {
  transporteDocsGradeCelula_(sheet, r, c).userEnteredValue = { imageValue: { imageProperties: { contentUrl: url } } };
}

// Baixa as imagens em paralelo e devolve url -> data URI (falhas ficam fora do mapa).
function transporteDocsGradeImagensDataUri_(urls, token) {
  var mapa = {};
  if (!urls.length) return mapa;
  var respostas = UrlFetchApp.fetchAll(urls.map(function(url) {
    var req = { url: url, muteHttpExceptions: true };
    if (transporteDocsGradeHostGoogle_(url)) req.headers = { Authorization: 'Bearer ' + token };
    return req;
  }));
  respostas.forEach(function(resp, i) {
    if (resp.getResponseCode() !== 200) return;
    var blob = resp.getBlob();
    mapa[urls[i]] = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
  });
  return mapa;
}

/**
 * Carrega as abas prontas para transporteDocsGradeMontar_ (mapa titulo -> sheet).
 * ss: planilha (SpreadsheetApp); opcoes.cache (padrao: cache do script);
 * opcoes.ignorarCache rele o layout.
 * Devolve { abas, tempos, info }; info tem so contagens, tamanhos e a via usada.
 */
function transporteDocsGradeCarregar_(ss, titulos, opcoes) {
  opcoes = opcoes || {};
  var spreadsheetId = ss.getId();
  var cache = opcoes.cache || CacheService.getScriptCache();
  var revisao = transporteDocsGradeRevisao_(opcoes.propriedades || PropertiesService.getScriptProperties());
  var formatosCodigo = opcoes.formatosCodigo || transporteDocsGradeFormatosCodigo_(ss);
  var imagensCodigo = opcoes.imagensCodigo || transporteDocsGradeImagensCodigo_(ss);
  var token = ScriptApp.getOAuthToken();
  var tempos = {};
  // A copia do fluxo atual e exportada em pt_BR; aqui os textos ja vem formatados no
  // idioma da planilha de origem, que nao e alterado por uma leitura.
  var info = { layoutsDoCache: 0, locale: typeof ss.getSpreadsheetLocale === 'function' ? ss.getSpreadsheetLocale() : '' };
  var marca = Date.now();
  var layouts = {};
  var faltando = [];
  titulos.forEach(function(titulo) {
    var layout = opcoes.ignorarCache ? null : transporteDocsGradeCacheLer_(cache, transporteDocsGradeCacheChave_(spreadsheetId, titulo, revisao));
    if (layout) layouts[titulo] = layout; else faltando.push(titulo);
  });
  info.layoutsDoCache = titulos.length - faltando.length;
  tempos.cacheLerMs = Date.now() - marca;

  if (faltando.length) {
    marca = Date.now();
    var leitura = transporteDocsGradeLer_(spreadsheetId, faltando.map(function(t) { return transporteDocsGradeIntervaloAba_(t); }),
      TRANSPORTE_DOCS_GRADE_CAMPOS_, token);
    tempos.layoutLerMs = Date.now() - marca;
    info.bytesLayoutLido = leitura.bytes;
    info.viaLayout = leitura.via;
    var sheets = leitura.dados.sheets || [];

    marca = Date.now();
    var celulasPorAba = {};
    var celulasDaAba = function(titulo) {
      if (!celulasPorAba[titulo]) {
        var sh = ss.getSheetByName(titulo);
        celulasPorAba[titulo] = sh ? transporteDocsGradeImagensCelulas_(sh) : [];
      }
      return celulasPorAba[titulo];
    };
    var flutuantesPorAba = {};
    sheets.forEach(function(sheet) {
      var titulo = sheet.properties.title;
      var sh = ss.getSheetByName(titulo);
      if (!sh) return;
      celulasDaAba(titulo).forEach(function(img) {
        transporteDocsGradeMarcarImagem_(sheet, img.r, img.c, img.url);
      });
      flutuantesPorAba[titulo] = transporteDocsGradeImagensFlutuantes_(sh);
    });
    sheets.forEach(function(sheet) {
      var titulo = sheet.properties.title;
      var flutuantes = flutuantesPorAba[titulo];
      if (!flutuantes) return;
      var origem = imagensCodigo[titulo];
      if (origem && flutuantes.semOrigem === 1 && flutuantes.posicoesSemOrigem.length === 1) {
        var url = transporteDocsGradeImagemRodape_(celulasDaAba(origem));
        if (url) {
          flutuantes.imagens.push(Object.assign({ url: url }, flutuantes.posicoesSemOrigem[0]));
          flutuantes.semOrigem = 0;
        }
      }
      sheet.imagensFlutuantes = flutuantes.imagens;
      sheet.imagensFlutuantesSemOrigem = flutuantes.semOrigem;
    });
    var urls = transporteDocsGradeUrlsImagens_(sheets);
    var imagens = transporteDocsGradeImagensDataUri_(urls, token);
    info.imagens = urls.length;
    info.imagensIncorporadas = Object.keys(imagens).length;
    tempos.imagensMs = Date.now() - marca;

    marca = Date.now();
    info.bytesCache = 0;
    sheets.forEach(function(sheet) {
      var titulo = sheet.properties.title;
      layouts[titulo] = transporteDocsGradeLayout_(sheet, imagens);
      info.bytesCache += transporteDocsGradeCacheSalvar_(cache, transporteDocsGradeCacheChave_(spreadsheetId, titulo, revisao), layouts[titulo]);
    });
    tempos.cacheGravarMs = Date.now() - marca;
  }

  marca = Date.now();
  var ranges = [];
  var faixasFormato = [];
  titulos.forEach(function(titulo) {
    var layout = layouts[titulo];
    if (!layout) throw new Error('Aba necessária não encontrada: ' + titulo);
    ranges.push(transporteDocsGradeIntervaloAba_(titulo, layout.area.colunas, layout.area.linhas));
    faixasFormato = faixasFormato.concat(transporteDocsGradeFaixasDinamicas_(layout, formatosCodigo[titulo]));
  });
  var pedidos = [{ ranges: ranges, campos: TRANSPORTE_DOCS_GRADE_CAMPOS_VALORES_ }];
  if (faixasFormato.length) pedidos.push({ ranges: faixasFormato, campos: TRANSPORTE_DOCS_GRADE_CAMPOS_FORMATOS_ });
  var leituras = transporteDocsGradeLerVarios_(spreadsheetId, pedidos, token);
  var valores = leituras[0];
  tempos.valoresLerMs = Date.now() - marca;
  info.bytesValores = valores.bytes;
  info.viaValores = valores.via;
  info.faixasFormatoDinamico = faixasFormato.length;
  info.imagensOmitidas = titulos.reduce(function(acc, titulo) { return acc + (Number(layouts[titulo].imagensOmitidas) || 0); }, 0);
  if (leituras[1]) {
    info.bytesFormatos = leituras[1].bytes;
    info.viaFormatos = leituras[1].via;
  }

  var abas = {};
  (valores.dados.sheets || []).forEach(function(sheet) {
    var titulo = sheet.properties.title;
    if (layouts[titulo]) abas[titulo] = transporteDocsGradeAplicarValores_(layouts[titulo], sheet);
  });
  if (leituras[1]) {
    (leituras[1].dados.sheets || []).forEach(function(sheet) {
      var titulo = sheet.properties.title;
      if (abas[titulo]) transporteDocsGradeAplicarFormatos_(abas[titulo], sheet);
    });
  }
  return { abas: abas, tempos: tempos, info: info };
}

// Para administradores: invalida o layout em cache de todas as abas apos alterar o modelo.
// A revisao nova muda todas as chaves; os itens antigos expiram sozinhos.
function limparCacheLayoutTransporteHtml() {
  codexAssertAdmin_();
  var revisao = String(Date.now());
  PropertiesService.getScriptProperties().setProperty(TRANSPORTE_DOCS_GRADE_REVISAO_PROP_, revisao);
  var resultado = { ok: true, revisao: revisao };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}

function transporteDocsGradeCelula_(sheet, r, c) {
  var data = sheet.data[0];
  var rows = data.rowData || (data.rowData = []);
  while (rows.length <= r) rows.push({ values: [] });
  var celulas = rows[r].values || (rows[r].values = []);
  while (celulas.length <= c) celulas.push({});
  return celulas[c] || (celulas[c] = {});
}

function transporteDocsGradeDefinirTexto_(cell, texto) {
  cell.formattedValue = texto;
  delete cell.effectiveValue;
  delete cell.textFormatRuns;
}

/**
 * Protecoes em memoria antes do HTML, como imprimirTodasAbas_ faz na copia
 * temporaria: identificacao documental em C3 das folhas, C15 (metadados internos)
 * vazio e bloqueio se restar o nome do participante. O contato de emergencia da
 * courier so e trocado nas abas de contexto.contatoAbas (TRANSPORTE_DOCS_GRADE_CONTATO_ABAS_).
 * abas: mapa titulo -> sheet ja com valores; contexto: { folhas: [titulos com C3],
 * folhaC15, identificacao, contatoEmergencia, contatoAbas, nomes }. Notas nao sao lidas na grade.
 * Devolve [{ aba, valores }] (textos impressos), base para o hash do conteudo.
 */
function transporteDocsGradeProtegerConteudo_(abas, contexto) {
  contexto = contexto || {};
  (contexto.folhas || []).forEach(function(titulo) {
    if (abas[titulo]) transporteDocsGradeDefinirTexto_(transporteDocsGradeCelula_(abas[titulo], 2, 2), contexto.identificacao || '');
  });
  if (contexto.folhaC15 && abas[contexto.folhaC15]) {
    transporteDocsGradeDefinirTexto_(transporteDocsGradeCelula_(abas[contexto.folhaC15], 14, 2), '');
  }
  var normalizar = function(v) { return transportePdfManifestText_(v); };
  var nomes = (contexto.nomes || []).map(normalizar).filter(Boolean);
  var conteudo = [];
  Object.keys(abas).forEach(function(titulo) {
    var trocarContato = !!contexto.contatoEmergencia && (contexto.contatoAbas || []).indexOf(titulo) >= 0;
    var linhas = ((abas[titulo].data || [])[0] || {}).rowData || [];
    var valores = linhas.map(function(row) {
      return (row.values || []).map(function(cell) {
        var texto = String(cell && cell.formattedValue || '');
        // Mesma localizacao de transporteAplicarContatoEmergenciaPdf_.
        var digitos = texto.replace(/\D/g, '');
        if (trocarContato && (texto.indexOf('{{TRANSPORTE_CONTATO_EMERGENCIA}}') >= 0 ||
            digitos.indexOf('970953241') !== -1 || digitos.indexOf('999091656') !== -1)) {
          texto = contexto.contatoEmergencia;
          transporteDocsGradeDefinirTexto_(cell, texto);
        }
        var normalizado = normalizar(texto);
        if (nomes.some(function(nome) { return normalizado.indexOf(nome) >= 0; })) {
          // Nunca incluir nome, aba, celula ou conteudo no erro/log.
          throw new Error('PDF bloqueado: identificação nominal ainda presente em uma aba exportada. Revise o modelo de documentação.');
        }
        return texto;
      });
    });
    conteudo.push({ aba: titulo, valores: valores });
  });
  return conteudo;
}

// Contexto de transporteDocsGradeProtegerConteudo_ com as mesmas fontes de imprimirTodasAbas_ (somente leitura).
function transporteDocsGradeContextoProtecao_(ss, courier, payload) {
  var folhas = ['folhaAgendamento', 'folhaDhlPinex'].map(function(chave) {
    return transportePdfActualSheetName_(chave, ss);
  }).filter(Boolean);
  return {
    folhas: folhas,
    folhaC15: transportePdfActualSheetName_('folhaAgendamento', ss),
    identificacao: transporteParticipanteDocumento_(payload).texto,
    contatoEmergencia: transporteContatoEmergenciaTexto_(courier),
    contatoAbas: (TRANSPORTE_DOCS_GRADE_CONTATO_ABAS_[transporteNormalizeCourierFromCodex_(courier)] || []).map(function(chave) {
      return transportePdfActualSheetName_(chave, ss);
    }).filter(Boolean),
    nomes: [payload.paciente, payload.participante]
  };
}

/* ===== Diagnostico: leitura da grade real no Apps Script =====
 * Executar manualmente no editor (somente administradores). Le as abas MARKEN da
 * planilha de Transporte sem alterar nada, duas vezes: a frio (relendo o layout e
 * gravando o cache) e a quente (layout do cache + valores). Monta o HTML da leitura
 * a quente e converte em PDF salvo na pasta privada de diagnostico. Antes do HTML
 * aplica as mesmas protecoes da copia temporaria do PDF atual
 * (transporteDocsGradeProtegerConteudo_), com o participante do registro atual.
 * O log contem somente contagens, tamanhos, tempos e o hash do conteudo.
 */
function diagnosticarGradeTransporteHtml() {
  codexAssertAdmin_();
  var tempos = {};
  var inicio = Date.now();
  var ss = getTransporteSpreadsheetCodex_();
  var spec = transportePdfSpec_('MARKEN', '', '', ss);
  var payload = transporteDerivarDadosParticipante_(transporteReadRegistro_(), { obrigatorio: true });
  var contexto = transporteDocsGradeContextoProtecao_(ss, 'MARKEN', payload);

  var marca = Date.now();
  var frio = transporteDocsGradeCarregar_(ss, spec.ordem, { ignorarCache: true });
  tempos.frioMs = Date.now() - marca;
  marca = Date.now();
  var quente = transporteDocsGradeCarregar_(ss, spec.ordem, {});
  tempos.quenteMs = Date.now() - marca;

  marca = Date.now();
  var conteudo = transporteDocsGradeProtegerConteudo_(quente.abas, contexto);
  tempos.protecaoMs = Date.now() - marca;

  marca = Date.now();
  // A Folha de Agendamento deste fluxo e o modelo HTML proprio, nao a aba da planilha.
  // Logo e destino vem das abas ja carregadas (quente.abas).
  tempos.folhaEtapas = {};
  var folha = transporteFolhaHtmlParaGrade_(ss, Object.assign({}, payload, { courier: 'MARKEN' }), spec, {
    tempos: tempos.folhaEtapas
  }, quente.abas);
  tempos.folhaMs = Date.now() - marca;
  var html = transporteDocsGradeMontar_(quente.abas, spec.ordem.map(function(titulo) {
    return { aba: titulo, copias: spec.copias[titulo], html: folha.abas.indexOf(titulo) >= 0 ? folha.html : '' };
  }), {});
  tempos.htmlMs = Date.now() - marca;

  marca = Date.now();
  var stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd-HHmmss');
  var blob = HtmlService.createHtmlOutput(html).getBlob().getAs(MimeType.PDF)
    .setName('diagnostico-grade-marken-' + stamp + '.pdf');
  tempos.conversaoMs = Date.now() - marca;
  var paginas = transporteDocsHtmlContarPaginasPdf_(blob);
  var paginasEsperadas = spec.ordem.reduce(function(acc, titulo) { return acc + spec.copias[titulo]; }, 0);

  marca = Date.now();
  var root = DriveApp.getRootFolder();
  var pastas = root.getFoldersByName(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
  var pasta = pastas.hasNext() ? pastas.next() : root.createFolder(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
  var arquivo = pasta.createFile(blob);
  tempos.driveMs = Date.now() - marca;
  tempos.totalMs = Date.now() - inicio;

  var avisos = [];
  if (quente.info.locale && quente.info.locale !== 'pt_BR') avisos.push('LOCALE_DIFERENTE_DE_PT_BR');
  if (quente.info.imagensOmitidas) avisos.push('IMAGEM_NAO_INCORPORADA');
  var resultado = {
    ok: paginas === paginasEsperadas && quente.info.layoutsDoCache === spec.ordem.length && !avisos.length,
    paginas: paginas,
    paginasEsperadas: paginasEsperadas,
    avisos: avisos,
    conteudoHash: transportePdfManifestoHash_(conteudo),
    abasMontadas: Object.keys(quente.abas).length,
    frio: { tempos: frio.tempos, info: frio.info },
    quente: { tempos: quente.tempos, info: quente.info },
    bytesHtml: html.length,
    bytesPdf: blob.getBytes().length,
    tempos: tempos,
    fileName: arquivo.getName(),
    fileUrl: arquivo.getUrl()
  };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}
