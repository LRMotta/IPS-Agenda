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
 * ultima coluna/linha com texto, borda, caixa ou imagem, incluindo mesclagens.
 * Devolve { mesclas, cobertas, c1, rFim } com indices de base 0 (c1/rFim = -1 se vazia).
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
  return { mesclas: mesclas, cobertas: cobertas, c1: c1, rFim: rFim };
}

/**
 * sheet: objeto de spreadsheets.get (properties, merges, data[0]).
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
  // No Sheets o texto invade vizinhas sem conteudo, mesmo quando elas tem borda.
  function vazia(r, c) {
    if (cobertas[r + ':' + c] || mesclas[r + ':' + c]) return false;
    var cell = cel(r, c);
    return !transporteDocsGradeTemTexto_(cell) && !transporteDocsGradeCaixa_(cell) && !transporteDocsGradeImagem_(cell);
  }

  var html = ['<table class="grade" style="width:' + (larguraFonte * escala).toFixed(1) + 'px"><colgroup>'];
  colunas.forEach(function(c) { html.push('<col style="width:' + (largura(c) * escala).toFixed(2) + 'px">'); });
  html.push('</colgroup>');
  var absorvidas = {};
  for (var lr = 0; lr <= rFim; lr++) {
    if (linhaOculta(lr)) continue;
    html.push('<tr style="height:' + (altura(lr) * escalaV).toFixed(2) + 'px">');
    for (var lc = c0; lc <= c1; lc++) {
      if (colOculta(lc) || cobertas[lr + ':' + lc] || absorvidas[lr + ':' + lc]) continue;
      html.push(transporteDocsGradeCelulaHtml_(lr, lc));
    }
    html.push('</tr>');
  }
  html.push('</table>');
  return html.join('');

  function transporteDocsGradeCelulaHtml_(r, c) {
    var cell = cel(r, c);
    var fmt = cell.effectiveFormat || {};
    var tf = fmt.textFormat || {};
    var m = mesclas[r + ':' + c];
    var cs = m ? visiveisEntre(c, Math.min(c + m.cs - 1, c1)) : 1;
    var rs = 1;
    if (m) {
      for (var k = r + 1; k < r + m.rs && k <= rFim; k++) if (!linhaOculta(k)) rs++;
    }
    var imagem = transporteDocsGradeImagem_(cell);
    var caixa = transporteDocsGradeCaixa_(cell);
    var texto = transporteDocsGradeTemTexto_(cell);
    var numero = cell.effectiveValue && cell.effectiveValue.numberValue !== undefined;
    var alinhamento = fmt.horizontalAlignment || (caixa ? 'CENTER' : (numero ? 'RIGHT' : 'LEFT'));
    var quebra = fmt.wrapStrategy || 'OVERFLOW_CELL';
    var borda = transporteDocsGradeTemBorda_(cell);

    // Texto em OVERFLOW alinhado a esquerda ocupa as vazias seguintes, como no Sheets.
    // O texto e cortado na primeira celula ocupada, que delimita o trecho absorvido.
    // As bordas do trecho combinam: esquerda da origem, direita da ultima absorvida,
    // superior/inferior quando qualquer celula do trecho as tiver.
    var absorveu = false;
    var bordas = Object.assign({}, fmt.borders || {});
    if (!m && texto && quebra === 'OVERFLOW_CELL' && alinhamento === 'LEFT') {
      for (var prox = c + 1; prox <= c1 && vazia(r, prox); prox++) {
        absorvidas[r + ':' + prox] = true;
        if (!colOculta(prox)) cs++;
        absorveu = true;
        var bp = (cel(r, prox).effectiveFormat || {}).borders || {};
        bordas.right = bp.right;
        ['top', 'bottom'].forEach(function(k) { if (!transporteDocsGradeBorda_(bordas[k]) && transporteDocsGradeBorda_(bp[k])) bordas[k] = bp[k]; });
      }
      borda = ['top', 'bottom', 'left', 'right'].some(function(k) { return !!transporteDocsGradeBorda_(bordas[k]); });
    }

    var estilo = [];
    var estiloTexto = transporteDocsGradeEstiloTexto_(tf, escalaFonte, {});
    if (estiloTexto) estilo.push(estiloTexto);
    estilo.push('text-align:' + { LEFT: 'left', CENTER: 'center', RIGHT: 'right' }[alinhamento]);
    estilo.push('vertical-align:' + ({ TOP: 'top', MIDDLE: 'middle', BOTTOM: 'bottom' }[fmt.verticalAlignment] || 'bottom'));
    if (quebra === 'WRAP' || quebra === 'LEGACY_WRAP') estilo.push('white-space:normal');
    if (quebra === 'CLIP' || borda || m || absorveu) estilo.push('overflow:hidden');
    // Recuo lateral de 2 px na escala da pagina: com o padding nominal do Sheets
    // (3 px) linhas que cabem no PDF atual quebravam.
    var pad = fmt.padding || {};
    estilo.push('padding:' + ['top', 'right', 'bottom', 'left'].map(function(k) {
      var vertical = k === 'top' || k === 'bottom';
      return vertical ? ((pad[k] === undefined ? 2 : pad[k]) * escala).toFixed(1) + 'px' : '2px';
    }).join(' '));
    ['top', 'right', 'bottom', 'left'].forEach(function(k) {
      var b = transporteDocsGradeBorda_(bordas[k]);
      if (b) estilo.push('border-' + k + ':' + b);
    });

    var conteudo = '';
    if (imagem) {
      var larguraCel = 0, alturaCel = 0;
      for (var ic = c; ic < c + (m ? m.cs : 1); ic++) if (ic >= c0 && ic <= c1) larguraCel += largura(ic);
      for (var ir = r; ir < r + (m ? m.rs : 1); ir++) if (!linhaOculta(ir)) alturaCel += altura(ir);
      var src = typeof opcoes.imagemSrc === 'function' ? opcoes.imagemSrc(imagem.imageProperties.contentUrl) : imagem.imageProperties.contentUrl;
      conteudo = '<img src="' + transporteDocsHtmlEscape_(src) + '" alt="" style="max-width:' + (larguraCel * escala).toFixed(1) +
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
 * abas: mapa titulo -> sheet (spreadsheets.get); documentos: [{ aba, copias }].
 */
function transporteDocsGradeMontar_(abas, documentos, opcoes) {
  var paginas = [];
  (documentos || []).forEach(function(doc) {
    var sheet = abas[doc.aba];
    if (!sheet) throw new Error('Aba necessária não encontrada: ' + doc.aba);
    var pagina = transporteDocsGradeHtml_(sheet, opcoes);
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
 * Alterou o modelo? Execute limparCacheLayoutTransporteHtml() (ou aguarde 6 h).
 */
var TRANSPORTE_DOCS_GRADE_CACHE_VERSAO_ = 'tdg1';
var TRANSPORTE_DOCS_GRADE_CACHE_TTL_S_ = 21600;
var TRANSPORTE_DOCS_GRADE_CACHE_PEDACO_ = 90000;

var TRANSPORTE_DOCS_GRADE_CAMPOS_ = 'sheets(properties(title),merges,data(columnMetadata(pixelSize,hiddenByUser),' +
  'rowMetadata(pixelSize,hiddenByUser),rowData(values(formattedValue,effectiveValue(numberValue,boolValue),' +
  'effectiveFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding,borders),' +
  'textFormatRuns,dataValidation(condition(type)),userEnteredValue))))';

var TRANSPORTE_DOCS_GRADE_CAMPOS_VALORES_ = 'sheets(properties(title),data(startRow,startColumn,' +
  'rowData(values(formattedValue,effectiveValue(numberValue,boolValue),textFormatRuns))))';

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

/**
 * spreadsheets.get com grade. A chamada REST devolve as imagens das celulas
 * (imageValue), que o servico avancado Sheets descarta; o servico avancado fica
 * como alternativa quando a REST e recusada. Devolve { dados, bytes, via }.
 */
function transporteDocsGradeLer_(spreadsheetId, ranges, campos, token) {
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) +
    '?includeGridData=true&fields=' + encodeURIComponent(campos) +
    ranges.map(function(r) { return '&ranges=' + encodeURIComponent(r); }).join('');
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  var codigo = resp.getResponseCode();
  var texto = resp.getContentText();
  if (codigo === 200) return { dados: JSON.parse(texto), bytes: texto.length, via: 'rest' };
  var motivo = transporteDocsGradeMotivoErro_(texto);
  var erro = 'HTTP ' + codigo + (motivo ? ': ' + motivo : '');
  if (typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets) {
    var dados = Sheets.Spreadsheets.get(spreadsheetId, { ranges: ranges, includeGridData: true, fields: campos });
    return { dados: dados, bytes: JSON.stringify(dados).length, via: 'avancado (REST ' + erro + ')' };
  }
  throw new Error('Leitura da grade falhou (' + erro + ').');
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
  return {
    properties: { title: (sheet.properties || {}).title },
    merges: sheet.merges || [],
    area: { colunas: colunas, linhas: linhas },
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

function transporteDocsGradeCacheChave_(spreadsheetId, titulo) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, spreadsheetId + '|' + titulo, Utilities.Charset.UTF_8);
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
  });
  return Object.keys(urls);
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
  var data = sheet.data[0];
  var rows = data.rowData || (data.rowData = []);
  while (rows.length <= r) rows.push({ values: [] });
  var celulas = rows[r].values || (rows[r].values = []);
  while (celulas.length <= c) celulas.push({});
  var cell = celulas[c] || (celulas[c] = {});
  cell.userEnteredValue = { imageValue: { imageProperties: { contentUrl: url } } };
}

// Baixa as imagens em paralelo e devolve url -> data URI (falhas ficam fora do mapa).
function transporteDocsGradeImagensDataUri_(urls, token) {
  var mapa = {};
  if (!urls.length) return mapa;
  var respostas = UrlFetchApp.fetchAll(urls.map(function(url) {
    return { url: url, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
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
  var token = ScriptApp.getOAuthToken();
  var tempos = {};
  var info = { layoutsDoCache: 0 };
  var marca = Date.now();
  var layouts = {};
  var faltando = [];
  titulos.forEach(function(titulo) {
    var layout = opcoes.ignorarCache ? null : transporteDocsGradeCacheLer_(cache, transporteDocsGradeCacheChave_(spreadsheetId, titulo));
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
    sheets.forEach(function(sheet) {
      var sh = ss.getSheetByName(sheet.properties.title);
      if (!sh) return;
      transporteDocsGradeImagensCelulas_(sh).forEach(function(img) {
        transporteDocsGradeMarcarImagem_(sheet, img.r, img.c, img.url);
      });
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
      info.bytesCache += transporteDocsGradeCacheSalvar_(cache, transporteDocsGradeCacheChave_(spreadsheetId, titulo), layouts[titulo]);
    });
    tempos.cacheGravarMs = Date.now() - marca;
  }

  marca = Date.now();
  var ranges = titulos.map(function(titulo) {
    var layout = layouts[titulo];
    if (!layout) throw new Error('Aba necessária não encontrada: ' + titulo);
    return transporteDocsGradeIntervaloAba_(titulo, layout.area.colunas, layout.area.linhas);
  });
  var valores = transporteDocsGradeLer_(spreadsheetId, ranges, TRANSPORTE_DOCS_GRADE_CAMPOS_VALORES_, token);
  tempos.valoresLerMs = Date.now() - marca;
  info.bytesValores = valores.bytes;
  info.viaValores = valores.via;

  var abas = {};
  (valores.dados.sheets || []).forEach(function(sheet) {
    var titulo = sheet.properties.title;
    if (layouts[titulo]) abas[titulo] = transporteDocsGradeAplicarValores_(layouts[titulo], sheet);
  });
  return { abas: abas, tempos: tempos, info: info };
}

// Para administradores: descarta o layout em cache das abas MARKEN apos alterar o modelo.
function limparCacheLayoutTransporteHtml() {
  codexAssertAdmin_();
  var ss = getTransporteSpreadsheetCodex_();
  var cache = CacheService.getScriptCache();
  var chaves = [];
  transportePdfSpec_('MARKEN', '', '', ss).ordem.forEach(function(titulo) {
    var chave = transporteDocsGradeCacheChave_(ss.getId(), titulo);
    var n = Number(cache.get(chave)) || 0;
    chaves.push(chave);
    for (var i = 0; i < n; i++) chaves.push(chave + ':' + i);
  });
  cache.removeAll(chaves);
  var resultado = { ok: true, chavesRemovidas: chaves.length };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}

function transporteDocsGradeMascararCelula_(sheet, linha, coluna, texto) {
  var row = (((sheet.data || [])[0] || {}).rowData || [])[linha];
  var cell = row && row.values && row.values[coluna];
  if (cell && transporteDocsGradeTemTexto_(cell)) {
    cell.formattedValue = texto;
    delete cell.textFormatRuns;
  }
}

/* ===== Diagnostico: leitura da grade real no Apps Script =====
 * Executar manualmente no editor (somente administradores). Le as abas MARKEN da
 * planilha de Transporte sem alterar nada, duas vezes: a frio (relendo o layout e
 * gravando o cache) e a quente (layout do cache + valores). Monta o HTML da leitura
 * a quente e converte em PDF salvo na pasta privada de diagnostico. A
 * identificacao do participante (C3 da Folha) e mascarada, como a anonimizacao
 * do PDF atual faz. O log contem somente contagens, tamanhos e tempos.
 */
function diagnosticarGradeTransporteHtml() {
  codexAssertAdmin_();
  var tempos = {};
  var inicio = Date.now();
  var ss = getTransporteSpreadsheetCodex_();
  var spec = transportePdfSpec_('MARKEN', '', '', ss);

  var marca = Date.now();
  var frio = transporteDocsGradeCarregar_(ss, spec.ordem, { ignorarCache: true });
  tempos.frioMs = Date.now() - marca;
  marca = Date.now();
  var quente = transporteDocsGradeCarregar_(ss, spec.ordem, {});
  tempos.quenteMs = Date.now() - marca;

  var folha = quente.abas[spec.ordem[0]];
  if (folha) transporteDocsGradeMascararCelula_(folha, 2, 2, '[participante]');

  marca = Date.now();
  var html = transporteDocsGradeMontar_(quente.abas, spec.ordem.map(function(titulo) {
    return { aba: titulo, copias: spec.copias[titulo] };
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

  var resultado = {
    ok: paginas === paginasEsperadas && quente.info.layoutsDoCache === spec.ordem.length,
    paginas: paginas,
    paginasEsperadas: paginasEsperadas,
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
