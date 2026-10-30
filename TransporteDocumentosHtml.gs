/* ===== TransporteDocumentosHtml.gs =====
 * Prototipo: Declaracao de Transporte e Invoice (MARKEN) renderizadas em HTML
 * a partir de dados ja resolvidos, sem planilha, copia temporaria ou exportacao
 * HTTP. Nao participa do fluxo de geracao: imprimirTodasAbas_ continua sendo a
 * fonte oficial do PDF ate a validacao lado a lado de cada courier.
 *
 * A grade reproduz as larguras de coluna e alturas de linha dos modelos da
 * planilha "Documentacao para Transporte de Amostras" (pixels do Sheets),
 * reduzidas para a largura util da pagina como o exportador faz com fitw=true.
 * O CSS evita flex/grid/transform para funcionar no conversor HtmlService.
 */

// Largura util medida no PDF atual: A4 com margens laterais de ~12 mm.
var TRANSPORTE_DOCS_HTML_LARGURA_PX_ = 701;
// Altura util (297 mm menos as margens de 15,2 mm) com folga de arredondamento.
var TRANSPORTE_DOCS_HTML_ALTURA_PAGINA_PX_ = 1040;

var TRANSPORTE_DOCS_HTML_MATERIAIS_ = [
  { chave: 'sangue', rotulo: 'Sangue', unidade: 'mL',
    invoice: { desc: 'Human Blood for Clinical Trials', hts: '3002.90.5210', pkg: 'Tube(s)' } },
  { chave: 'soro', rotulo: 'Soro', unidade: 'mL',
    invoice: { desc: 'Human Blood Serum for Clinical Trials', hts: '3002.12.0020', pkg: 'Tube(s)' } },
  { chave: 'urina', rotulo: 'Urina', unidade: 'mL',
    invoice: { desc: 'Human Urine for Clinical Trials', hts: '3002.90.5250', pkg: 'Tube(s)' } },
  { chave: 'plasma', rotulo: 'Plasma', unidade: 'mL',
    invoice: { desc: 'Human Blood Plasma for Clinical trials', hts: '3002.12.0010', pkg: 'Tube(s)' } },
  { chave: 'tecido', rotulo: 'Tecido', unidade: 'mL',
    invoice: { desc: 'Human Tissue for Clinical Trials', hts: '3002.90.5250', pkg: 'Vial(s)' } },
  { chave: 'saliva', rotulo: 'Saliva', unidade: 'mL',
    invoice: { desc: 'Human Saliva / Bucal Swab for Clinical Trials', hts: '0511.99.4070', pkg: 'Tube(s)' } },
  { chave: 'fezes', rotulo: 'Fezes', unidade: 'g',
    invoice: { desc: 'Human Stool for Clinical Trials', hts: '0511.99.4070', pkg: 'Vial(s)' } },
  { chave: 'vacina', rotulo: 'Vacina', unidade: 'g',
    invoice: { desc: 'Human Vaccine for Clinical Trials', hts: '3002.41.0000', pkg: 'Vial(s)' } }
];

var TRANSPORTE_DOCS_HTML_MESES_ = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function transporteDocsHtmlEscape_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Textos configuraveis por courier aceitam somente negrito, italico e sublinhado.
function transporteDocsHtmlRichText_(value) {
  return transporteDocsHtmlEscape_(value)
    .replace(/&lt;(\/?)(b|strong|i|em|u)&gt;/gi, function(match, slash, tag) {
      return '<' + slash + tag.toLowerCase() + '>';
    })
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

function transporteDocsHtmlNumero_(value, casas) {
  var n = Number(value);
  if (!isFinite(n)) return '';
  var partes = n.toFixed(casas).split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return partes.join(',');
}

function transporteDocsHtmlData_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return { ano: value.getFullYear(), mes: value.getMonth() + 1, dia: value.getDate() };
  }
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) throw new Error('Data de envio inválida para a documentação: ' + value);
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

function transporteDocsHtmlDataIso_(value) {
  var d = transporteDocsHtmlData_(value);
  return d.ano + '-' + ('0' + d.mes).slice(-2) + '-' + ('0' + d.dia).slice(-2);
}

function transporteDocsHtmlDataExtenso_(value) {
  var d = transporteDocsHtmlData_(value);
  return d.dia + ' de ' + TRANSPORTE_DOCS_HTML_MESES_[d.mes - 1] + ' de ' + d.ano;
}

function transporteDocsHtmlAssinatura_(medico) {
  medico = medico || {};
  return medico.nome && medico.cremers ? 'Dr(a). ' + medico.nome + ' - CREMERS: ' + medico.cremers + '.' : '';
}

// Mesma regra de transporteAplicarAutomacoesTemperatura_ para F32/H32/J32.
function transporteDocsHtmlTemperaturas_(temperatura) {
  var t = String(temperatura || '').trim().toUpperCase();
  return {
    ambiente: t === 'AMBIENTE' || t === 'AMBIENTE + CONGELADO' || t === 'AMBIENTE + REFRIGERADO',
    refrigerado: t === 'REFRIGERADO' || t === 'AMBIENTE + REFRIGERADO',
    congelado: t === 'CONGELADO' || t === 'AMBIENTE + CONGELADO'
  };
}

// Mesma faixa de transporteVolumeFormulaFontSize_: acima de 42 caracteres a
// geracao e bloqueada, como em transporteAjustarVolumesDeclaracao_(..., true).
// Campos livres de largura fixa: reduz a fonte proporcionalmente quando o texto
// passa do numero de caracteres que cabe no tamanho base (minimo de 7 pt).
function transporteDocsHtmlFonteAjustada_(texto, base, caracteresNoBase) {
  var length = String(texto || '').trim().length;
  if (length <= caracteresNoBase) return base;
  return Math.max(7, Math.floor(base * caracteresNoBase / length * 10) / 10);
}

function transporteDocsHtmlFonteVolume_(texto) {
  var length = String(texto || '').trim().length;
  if (length <= 30) return 11;
  if (length <= 36) return 10;
  if (length <= 42) return 9;
  return 0;
}

function transporteDocsHtmlMateriais_(dados) {
  var porChave = {};
  (dados.materiais || []).forEach(function(item) {
    var chave = String(item && item.tipo || '').trim().toLowerCase();
    if (chave) porChave[chave] = item;
  });
  var excedidas = [];
  var linhas = TRANSPORTE_DOCS_HTML_MATERIAIS_.map(function(def, index) {
    var item = porChave[def.chave];
    var formula = item ? String(item.formula || '').trim() : '';
    var fonte = transporteDocsHtmlFonteVolume_(formula);
    if (!fonte) excedidas.push(21 + index);
    return {
      def: def,
      marcado: !!item,
      tubos: item && item.tubos ? item.tubos : '',
      formula: formula,
      fonte: fonte || 9,
      total: item && item.total !== '' && item.total != null ? Number(item.total) : null
    };
  });
  if (excedidas.length) {
    throw new Error('Os volumes da Declaração de Transporte excedem o espaço seguro na(s) linha(s) ' +
      excedidas.join(', ') + '. Agrupe ou revise os volumes antes de gerar a documentação.');
  }
  return linhas;
}

// Mesma selecao de atualizarInvoiceMarkenAmostras_: ordem da Declaracao, ate 5 itens.
function transporteDocsHtmlItensInvoice_(materiais, outroTipo) {
  var outro = String(outroTipo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  var comLaminas = outro.indexOf('lamina') !== -1 && outro.indexOf('hematologia') !== -1;
  return materiais.filter(function(linha) { return linha.marcado; }).slice(0, 5).map(function(linha) {
    var inv = linha.def.invoice;
    return {
      unidades: linha.tubos,
      pkg: linha.def.chave === 'sangue' && comLaminas ? 'Tube(s) + Slides' : inv.pkg,
      desc: inv.desc,
      hts: inv.hts,
      valor: 10
    };
  });
}

/* --- Grade --------------------------------------------------------------
 * colunasPx: larguras das colunas do modelo (A ate a ultima), em pixels.
 * linhas: [{ h: alturaPx, cells: [celula] }], celula com col (indice 0 = A),
 * cs/rs (mesclagem), html, e estilo: b, i, fs (pt), al (l/c/r), va (t/m/b),
 * bd ('TBLR' bordas), wrap. Celulas nao declaradas ficam vazias.
 * Como no PDF atual, a primeira e a ultima coluna (vazias) ficam fora da area
 * impressa e o restante ocupa toda a largura util.
 */
function transporteDocsHtmlGrade_(colunasPx, linhas) {
  var colunas = colunasPx.slice(1, -1);
  // 2 px de folga para a borda direita colapsada nao ser cortada pela pagina.
  var largura = TRANSPORTE_DOCS_HTML_LARGURA_PX_ - 2;
  var escala = largura / colunas.reduce(function(a, b) { return a + b; }, 0);
  var ocupadas = {};
  var html = ['<table class="grade" style="width:' + largura + 'px"><colgroup>'];
  colunas.forEach(function(w) { html.push('<col style="width:' + (w * escala).toFixed(2) + 'px">'); });
  html.push('</colgroup>');
  linhas.forEach(function(linha, r) {
    var porColuna = {};
    (linha.cells || []).forEach(function(original) {
      var cell = Object.assign({}, original);
      var inicio = Math.max(cell.col - 1, 0);
      var fim = Math.min(cell.col - 1 + (cell.cs || 1), colunas.length);
      cell.cs = fim - inicio;
      if (cell.cs > 0) porColuna[inicio] = cell;
    });
    // 0,97: o exportador do Sheets comprime levemente as linhas (medido no PDF atual).
    html.push('<tr style="height:' + (linha.h * escala * 0.97).toFixed(2) + 'px">');
    for (var c = 0; c < colunas.length; c++) {
      if (ocupadas[r + ':' + c]) continue;
      var cell = porColuna[c];
      if (!cell) { html.push('<td></td>'); continue; }
      var cs = cell.cs || 1;
      var rs = cell.rs || 1;
      for (var rr = 0; rr < rs; rr++) {
        for (var cc = 0; cc < cs; cc++) if (rr || cc) ocupadas[(r + rr) + ':' + (c + cc)] = true;
      }
      var style = [];
      if (cell.fs) style.push('font-size:' + (cell.fs * escala).toFixed(2) + 'pt');
      if (cell.b) style.push('font-weight:bold');
      if (cell.i) style.push('font-style:italic');
      if (cell.al) style.push('text-align:' + { l: 'left', c: 'center', r: 'right' }[cell.al]);
      if (cell.va) style.push('vertical-align:' + { t: 'top', m: 'middle', b: 'bottom' }[cell.va]);
      if (cell.wrap) style.push('white-space:normal');
      String(cell.bd || '').split('').forEach(function(side) {
        var prop = { T: 'top', B: 'bottom', L: 'left', R: 'right' }[side];
        if (prop) style.push('border-' + prop + ':1px solid #000');
      });
      // Como no Sheets, texto em caixa com borda e cortado em vez de invadir a vizinha.
      if (cell.bd) style.push('overflow:hidden');
      html.push('<td' + (cs > 1 ? ' colspan="' + cs + '"' : '') + (rs > 1 ? ' rowspan="' + rs + '"' : '') +
        (style.length ? ' style="' + style.join(';') + '"' : '') + '>' + (cell.html || '') + '</td>');
    }
    html.push('</tr>');
  });
  html.push('</table>');
  return html.join('');
}

function transporteDocsHtmlCheckbox_(marcado) {
  return '<span class="cb">' + (marcado ? '&#10003;' : '&nbsp;') + '</span>';
}

function transporteDocsHtmlLogo_(logoSrc) {
  return logoSrc ? '<img class="logo" src="' + transporteDocsHtmlEscape_(logoSrc) + '" alt="">' : '';
}

function transporteDocsHtmlRodape_() {
  return '<div class="rodape"><b>CAMPUS SEDE</b><br>' +
    'Rua Francisco Getúlio Vargas, 1130 – Bairro Petrópolis – Bloco S – Sala 315 – CEP 95070-560 – Caxias do Sul – RS – Brasil<br>' +
    'Ou: Caixa Postal 1352 – CEP 95020-972 – Caxias do Sul – RS – Brasil<br>' +
    'Telefone / Telefax (54) 3218.2737 – www.ucs.br/ips<br>' +
    'Entidade Mantenedora: Fundação Universidade de Caxias do Sul – CNPJ 88 648 761/0001-03 – CGCTE 029/0089530</div>';
}

var TRANSPORTE_DOCS_HTML_B14_PADRAO_ = 'conformidade com as regulamentações da <b>IATA vigente</b> e ' +
  '<b>Resolução 5947 / ANTT de 01/06/2021 do Ministério dos Transportes</b>.';

function transporteDocsHtmlDeclaracao_(dados, opcoes) {
  var e = transporteDocsHtmlEscape_;
  var medico = dados.medico || {};
  var destino = dados.destino || {};
  var materiais = transporteDocsHtmlMateriais_(dados);
  var temps = transporteDocsHtmlTemperaturas_(dados.temperatura);
  var colunas = [30, 30, 56, 91, 25, 27, 71, 27, 108, 27, 94, 104, 92, 88, 73, 19, 30];
  var total = materiais.reduce(function(acc, linha) { return acc + (linha.total || 0); }, 0);
  var gelo = dados.geloSecoKg === '' || dados.geloSecoKg == null ? '---' : transporteDocsHtmlNumero_(dados.geloSecoKg, 1);
  var p = function(col, cs, html, extra) { return Object.assign({ col: col, cs: cs, html: html, fs: 11 }, extra || {}); };
  var linhas = [
    { h: 30, cells: [{ col: 0, cs: 17, rs: 4, html: transporteDocsHtmlLogo_(opcoes.logoSrc), al: 'c', va: 'b' }] },
    { h: 25 }, { h: 25 }, { h: 25 }, { h: 21 }, { h: 30 },
    { h: 21, cells: [p(1, 15, 'DECLARAÇÃO DE TRANSPORTE', { fs: 16, b: true, al: 'c' })] },
    { h: 23 }, { h: 23 },
    { h: 24, cells: [
      p(1, 2, 'Eu, <b>Dr(a).</b>', { va: 'b' }),
      p(3, 4, e(medico.nome), { b: true, al: 'c', va: 'b', fs: transporteDocsHtmlFonteAjustada_(medico.nome, 11, 26) }),
      p(7, 2, 'portador do CPF N°', { va: 'b' }),
      p(9, 2, e(medico.cpf), { b: true, va: 'b' }),
      p(11, 1, 'e CREMERS N°', { va: 'b' }),
      p(12, 1, e(medico.cremers), { b: true, al: 'c', va: 'b' }),
      p(13, 3, 'informo que não pratico', { va: 'b' })
    ] },
    { h: 60, cells: [p(1, 15, 'de modo habitual, operações relativas a circulação de mercadorias, prestação de serviços de transporte interestadual ou intermunicipal e ou de comunicação, não estando enquadrado como contribuinte sujeito ao ICMS - Imposto de Circulação de Mercadorias e Serviços. Face ao acima exposto, declaro estar enviando amostras de material biológico sem a emissão da respectiva nota fiscal.', { wrap: true, va: 't' })] },
    { h: 30, cells: [p(1, 15, '“Dispensada emissão de NF conforme Resposta Consulta Tributária Nº 9060 de 05/04/2016”.', { va: 'm' })] },
    { h: 21, cells: [p(1, 15, '<b>Declaro</b> ainda, que este material não está classificado como artigo restrito para transportes aéreo ou rodoviário e que está sendo efetuado em', { va: 'm' })] },
    { h: 21, cells: [p(1, 15, transporteDocsHtmlRichText_(dados.conteudoDeclaracao || TRANSPORTE_DOCS_HTML_B14_PADRAO_), { va: 'b' })] },
    { h: 49, cells: [p(1, 15, 'Por fim, informo que estes materiais se encontram adequadamente acondicionados para suportar os riscos normais de carregamento, descarregamento e transporte conforme a regulamentação em vigor.', { wrap: true, va: 'm' })] },
    { h: 26, cells: [p(1, 15, 'Descrição do conteúdo:', { b: true, va: 'b' })] },
    { h: 21, cells: [p(1, 15, 'Biological Substance, Category B (Substância Biológica, Categoria B) – UN3373', { va: 'm' })] },
    { h: 21, cells: [p(1, 15, 'Tipo de Embalagem:', { b: true, va: 'b' })] },
    { h: 21, cells: [p(1, 15, e(dados.tipoEmbalagem || 'Conforme disposto na instrução de embalagem 650 da IATA 2026 e Resolução 5947/ANTT de 01/06/2021 do Ministério dos Transportes.'), { va: 'm' })] },
    { h: 28, cells: [p(1, 15, 'Tipo de Substância:', { b: true, va: 'm' })] }
  ];
  materiais.forEach(function(linha) {
    var u = linha.def.unidade;
    linhas.push({ h: 21, cells: [
      { col: 1, html: transporteDocsHtmlCheckbox_(linha.marcado), al: 'c', va: 'm' },
      p(2, 2, e(linha.def.rotulo), { va: 'm' }),
      p(7, 1, e(linha.tubos), { b: true, al: 'r', va: 'm' }),
      p(8, 1, 'Qtde. de tubos', { va: 'm' }),
      p(9, 3, e(linha.formula), { b: true, al: 'r', va: 'm', fs: linha.fonte }),
      p(12, 1, u + ' por tubo', { va: 'm' }),
      p(13, 1, linha.total == null ? '' : transporteDocsHtmlNumero_(linha.total, 2), { b: true, al: 'r', va: 'm' }),
      p(14, 1, u + ' Total', { al: 'c', va: 'm' })
    ] });
  });
  linhas.push(
    { h: 40, cells: [p(1, 15, '***Material Biológico. Não expor ao Raio-X***', { b: true, va: 'm' })] },
    { h: 25, cells: [p(1, 4, 'Outro tipo, especifique:', { b: true, va: 'm' }), p(5, 11, e(dados.outroTipo), { b: true, va: 'm' })] },
    { h: 25, cells: [p(1, 3, 'Quantidade total:', { b: true, va: 'm' }), p(5, 2, transporteDocsHtmlNumero_(total, 2), { b: true, al: 'r', va: 'm' }), p(7, 2, 'mL/g', { b: true, va: 'm' })] },
    { h: 25, cells: [
      p(1, 4, 'Temperatura de Transporte:', { b: true, va: 'm' }),
      { col: 5, html: transporteDocsHtmlCheckbox_(temps.ambiente), al: 'c', va: 'm' }, p(6, 1, 'Ambiente', { va: 'm' }),
      { col: 7, html: transporteDocsHtmlCheckbox_(temps.refrigerado), al: 'c', va: 'm' }, p(8, 1, 'Refrigerado', { va: 'm' }),
      { col: 9, html: transporteDocsHtmlCheckbox_(temps.congelado), al: 'c', va: 'm' }, p(10, 1, 'Congelado', { va: 'm' })
    ] },
    { h: 25, cells: [p(1, 4, 'Quantidade de Gelo Seco:', { b: true, va: 'm' }), p(6, 1, e(gelo), { b: true, al: 'c', va: 'm' }), p(7, 2, 'kg / volume', { va: 'm' })] },
    { h: 25, cells: [p(1, 2, 'Finalidade:', { b: true, va: 'm' }), p(3, 13, 'Pesquisa Científica devidamente aprovada pelos respectivos órgãos competentes.', { va: 'm' })] },
    { h: 25, cells: [p(1, 5, 'Valor para efeito de Transporte:', { b: true, va: 'm' }), p(6, 1, e(dados.valorTransporte || 'R$ 15,00'), { va: 'm' })] },
    { h: 25, cells: [p(1, 2, 'AWB N°', { b: true, va: 'm' }), p(3, 2, e(dados.awb), { va: 'm' })] },
    { h: 25, cells: [p(1, 15, 'Destinatário:', { b: true, va: 'm' })] },
    { h: 25, cells: [p(1, 2, 'Local:', { b: true, va: 'b' }), p(3, 13, e(destino.nome), { va: 'b' })] },
    { h: 25, cells: [p(1, 2, 'Endereço:', { b: true, va: 'm' }), p(3, 9, e(destino.endereco), { va: 'm' }), p(12, 1, 'Cidade:', { b: true, va: 'm' }), p(13, 3, e(destino.cidadePais), { va: 'm' })] },
    { h: 30, cells: [p(1, 15, 'Por ser esta a expressão da verdade, firmo o presente e assumo inteira responsabilidade pela veracidade das declarações aqui prestadas.', { va: 'b' })] },
    { h: 33, cells: [p(1, 15, 'Caxias do Sul, ' + transporteDocsHtmlDataExtenso_(dados.dataEnvio), { al: 'c', va: 'b' })] },
    { h: 21 }, { h: 21 }, { h: 21 }, { h: 21 }, { h: 21 }, { h: 20 },
    { h: 25, cells: [{ col: 5, cs: 8, bd: 'B' }] },
    { h: 20, cells: [p(1, 15, e(transporteDocsHtmlAssinatura_(medico)), { b: true, al: 'c', va: 'b' })] },
    { h: 20, cells: [p(1, 15, 'Universidade de Caxias do Sul (UCS) - Instituto de Pesquisas em Saúde (IPS)', { al: 'c', va: 'b' })] },
    { h: 20, cells: [p(1, 15, e(dados.contatoEmergencia), { b: true, al: 'c', va: 'b' })] },
    { h: 21 },
    { h: 73, cells: [{ col: 1, cs: 15, html: transporteDocsHtmlRodape_(), al: 'c', va: 'b' }] }
  );
  return transporteDocsHtmlGrade_(colunas, linhas);
}

function transporteDocsHtmlInvoiceMarken_(dados, opcoes) {
  var e = transporteDocsHtmlEscape_;
  var destino = dados.destino || {};
  var inv = dados.invoice || {};
  var assinatura = transporteDocsHtmlAssinatura_(dados.medico);
  var data = transporteDocsHtmlDataIso_(dados.dataEnvio);
  var itens = transporteDocsHtmlItensInvoice_(transporteDocsHtmlMateriais_(dados), dados.outroTipo);
  var totalValor = itens.reduce(function(acc, item) { return acc + item.valor; }, 0);
  var usd = function(v) { return 'USD ' + transporteDocsHtmlNumero_(v, 2); };
  var colunas = [30, 30, 56, 20, 71, 25, 27, 71, 27, 108, 10, 10, 94, 30, 77, 27, 67, 20, 68, 73, 19, 30];
  var p = function(col, cs, html, extra) { return Object.assign({ col: col, cs: cs, html: html, fs: 11, va: 'm' }, extra || {}); };
  // Rotulo (B:D) e valor (E:K) a esquerda; rotulo (M:N) e valor (O:U) a direita.
  var esq = function(rotulo, valor, bdRotulo, bdValor, extra) {
    return [p(1, 3, rotulo, Object.assign({ b: true, bd: bdRotulo }, extra || {})), p(4, 7, valor, Object.assign({ bd: bdValor }, extra || {}))];
  };
  var dir = function(rotulo, valor, bdRotulo, bdValor, extra) {
    return [p(12, 2, rotulo, Object.assign({ b: true, bd: bdRotulo }, extra || {})), p(14, 7, valor, Object.assign({ bd: bdValor, al: 'c' }, extra || {}))];
  };
  var titulo = function(col, cs, texto) { return p(col, cs, texto, { fs: 16, i: true, bd: 'TBLR' }); };
  var linhas = [
    { h: 30, cells: [{ col: 0, cs: 22, rs: 4, html: transporteDocsHtmlLogo_(opcoes.logoSrc), al: 'c', va: 'b' }] },
    { h: 25 }, { h: 25 }, { h: 25 }, { h: 21 }, { h: 30 },
    { h: 21, cells: [p(1, 20, 'INVOICE', { fs: 22, al: 'c', va: 'b' })] },
    { h: 23 },
    { h: 36, cells: [titulo(1, 10, 'FROM:'), titulo(12, 9, 'INFORMATION:')] },
    { h: 21, cells: esq('Name:', 'Fundação Universidade de Caxias do Sul (FUCS)', 'BLR', 'BR').concat(dir('DATE:', e(data), 'TBLR', 'TBR')) },
    { h: 21, cells: [p(1, 3, 'Contact:', { b: true, bd: 'BLR' }), p(4, 7, e(assinatura), { bd: 'BR', fs: transporteDocsHtmlFonteAjustada_(assinatura, 11, 46) })].concat(dir('HAWB:', e(dados.awb), 'BLR', 'BR')) },
    { h: 21, cells: [p(1, 3, 'Address:', { b: true, bd: 'LBR', rs: 2, va: 't' }), p(4, 7, 'Rua Francisco Getúlio Vargas, 1130', { bd: 'R' })]
      .concat(dir('N° of packages:', e(inv.packages), 'TBLR', 'TBR')) },
    { h: 21, cells: [p(4, 7, 'Bloco S - Sala 315 - Caxias do Sul - RS - Brazil', { bd: 'BR' }), p(12, 2, 'Terms of Sale:', { b: true, bd: 'LR' }), p(14, 7, 'DDP', { bd: 'BR', al: 'c', rs: 2 })] },
    { h: 21, cells: esq('Zip:', '95070-560', 'BLR', 'BR').concat([p(12, 2, '(Incoterm):', { b: true, bd: 'BLR' })]) },
    { h: 21, cells: [p(1, 3, 'Phone:', { b: true, bd: 'LBR', rs: 2, va: 't' }), p(4, 7, '55 54 3218-2737', { bd: 'R' }),
      p(12, 2, 'Country of origin:', { b: true, bd: 'BLR', rs: 2, fs: 10 }), p(14, 7, 'Brazil', { bd: 'BR', al: 'c', rs: 2 })] },
    { h: 21, cells: [p(4, 7, '55 54 999091 1656', { bd: 'BR' })] },
    { h: 21, cells: esq('Tax ID / CNPJ:', '88.648.761/0001-03', 'BLR', 'BR').concat([p(12, 2, 'Reason for Export:', { b: true, bd: 'TLR', fs: 9.5 }), p(14, 7, 'Samples for testing purpose only.', { bd: 'TR', al: 'c' })]) },
    { h: 36, cells: [titulo(1, 10, 'SOLD TO:'), titulo(12, 9, 'SHIP TO:')] }
  ];
  var destinoLinhas = [
    ['Name:', e(destino.nome)],
    ['Contact:', e(destino.contato)]
  ];
  destinoLinhas.forEach(function(par) {
    linhas.push({ h: 21, cells: esq(par[0], par[1], 'BLR', 'BR', { wrap: true }).concat(dir(par[0], par[1], 'BLR', 'BR', { al: 'l', wrap: true })) });
  });
  linhas.push(
    { h: 21, cells: [p(1, 3, 'Address:', { b: true, bd: 'LBR', rs: 2, va: 't' }), p(4, 7, e(destino.endereco), { bd: 'R' }),
      p(12, 2, 'Address:', { b: true, bd: 'LBR', rs: 2, va: 't' }), p(14, 7, e(destino.endereco), { bd: 'R', al: 'l' })] },
    { h: 21, cells: [p(4, 7, e(destino.cidadePais), { bd: 'BR' }), p(14, 7, e(destino.cidadePais), { bd: 'BR', al: 'l' })] },
    { h: 21, cells: esq('Zip:', e(destino.zip), 'BLR', 'BR').concat(dir('Zip:', e(destino.zip), 'TBLR', 'TBR', { al: 'l' })) },
    { h: 21, cells: esq('Phone:', e(destino.telefone), 'BLR', 'BR').concat(dir('Phone:', e(destino.telefone), 'TBLR', 'TBR', { al: 'l' })) },
    { h: 21 },
    { h: 21, cells: [
      p(1, 2, 'Units', { b: true, al: 'c', bd: 'TBLR' }), p(3, 3, 'U/M', { b: true, al: 'c', bd: 'TBLR' }),
      p(6, 9, 'Description of Goods / Part No', { b: true, al: 'c', bd: 'TBLR' }),
      p(15, 4, 'Harm. Code', { b: true, al: 'c', bd: 'TBLR' }), p(19, 2, 'Total Value', { b: true, al: 'c', bd: 'TBLR' })
    ] }
  );
  for (var i = 0; i < 5; i++) {
    var item = itens[i] || {};
    linhas.push({ h: 25, cells: [
      p(1, 2, e(item.unidades), { al: 'c', bd: 'BLR' }), p(3, 3, e(item.pkg), { al: 'c', bd: 'BLR' }),
      p(6, 9, e(item.desc), { bd: 'BLR' }), p(15, 4, e(item.hts), { al: 'c', bd: 'BLR' }),
      p(19, 2, item.valor ? usd(item.valor) : '', { al: 'c', bd: 'BR' })
    ] });
  }
  // 9,7 pt: as linhas fixas do CDC cabem na caixa como no modelo (10 pt no Sheets).
  var texto = function(html, bd) { return p(1, 10, html, { fs: 9.7, bd: bd }); };
  var total = function(rotulo, valor) { return [p(12, 7, rotulo, { b: true, bd: 'TBLR' }), p(19, 2, valor, { al: 'c', bd: 'TBLR' })]; };
  linhas.push(
    { h: 21 }, { h: 25 },
    { h: 25, cells: [texto('<b>Declaration Statement:</b>', 'TLR')] },
    { h: 21, cells: [texto('<b>FDA statement:</b> Human material for lab testing.', 'LR')].concat(total('Invoice Line Total:', usd(totalValor))) },
    { h: 21, cells: [texto('<b>USDA statement:</b> Human material containing no animal material.', 'LR')].concat(total('Total Invoice Amount:', usd(totalValor))) },
    { h: 21, cells: [texto('<b>CDC Statement:</b> It\'s confirmed that the above samples contain no infectious', 'LR')] },
    { h: 21, cells: [texto('fluids, solids or other matter. The shipment contains human specimen', 'LR')] },
    { h: 21, cells: [texto('samples from patients participating in clinical trials and does not contain', 'LR')].concat(total('Total Number of Packages', e(inv.packages))) },
    { h: 21, cells: [texto('a known infectious substance. All subjects are screened as a requirement', 'LR')].concat(total('Currency:', 'USD')) },
    { h: 21, cells: [texto('participate in the trial. The specimen samples are being transported to', 'LR')].concat(total('Total Weight:', e(inv.totalWeight))) },
    { h: 21, cells: [texto('undergo routine screening tests for the purposes of initial diagnosis.', 'BLR')] },
    { h: 16 }, { h: 20 }, { h: 25 }, { h: 50 }, { h: 50 }, { h: 25 }, { h: 20 },
    { h: 20, cells: [
      p(1, 2, 'SHIPPER:', { b: true, bd: 'TBLR' }), p(3, 8, e(assinatura), { bd: 'TBLR', fs: transporteDocsHtmlFonteAjustada_(assinatura, 11, 44) }),
      p(12, 3, 'DATE:', { b: true, bd: 'TBLR' }), p(15, 6, e(data), { bd: 'TBR' })
    ] },
    { h: 20 }, { h: 21 },
    { h: 73, cells: [{ col: 1, cs: 20, html: transporteDocsHtmlRodape_(), al: 'c', va: 'b' }] }
  );
  return transporteDocsHtmlGrade_(colunas, linhas);
}

var TRANSPORTE_DOCS_HTML_RENDERERS_ = {
  declaracaoTransp: transporteDocsHtmlDeclaracao_,
  invoiceMarken: transporteDocsHtmlInvoiceMarken_
};

/**
 * Monta um unico HTML com as copias na ordem informada.
 * documentos: [{ chave: 'declaracaoTransp' | 'invoiceMarken', copias: n, dados?: {...} }]
 * (dados por documento substituem os gerais; usado pelo diagnostico).
 * opcoes.logoSrc: data URI ou URL do logo (no Apps Script, reqExamesLogoSrc_()).
 */
function transporteDocsHtmlMontar_(dados, documentos, opcoes) {
  dados = dados || {};
  opcoes = opcoes || {};
  var paginas = [];
  (documentos || []).forEach(function(doc) {
    var render = TRANSPORTE_DOCS_HTML_RENDERERS_[doc.chave];
    if (!render) throw new Error('Documento sem modelo HTML: ' + doc.chave);
    // A pagina e renderizada uma vez; as copias repetem o mesmo trecho.
    var pagina = render(doc.dados || dados, opcoes);
    for (var i = 0; i < Math.max(1, Number(doc.copias) || 1); i++) paginas.push(pagina);
  });
  if (!paginas.length) throw new Error('Nenhum documento informado para a documentação HTML.');
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4;margin:12.7mm 12.2mm 2.5mm 12.2mm}' +
    'html,body{margin:0;padding:0;background:#fff}' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#000}' +
    '.pagina{width:' + TRANSPORTE_DOCS_HTML_LARGURA_PX_ + 'px;height:' + TRANSPORTE_DOCS_HTML_ALTURA_PAGINA_PX_ + 'px;overflow:hidden;page-break-after:always;break-after:page}' +
    '.pagina:last-child{page-break-after:auto;break-after:auto}' +
    '.grade{border-collapse:collapse;table-layout:fixed}' +
    '.grade td{padding:0 2px;white-space:nowrap;overflow:visible;font-size:7.8pt;line-height:1.15;vertical-align:bottom}' +
    '.logo{height:66px;width:auto}' +
    // O conversor HtmlService nao imprime cores de fundo: a marcacao usa so traco preto.
    '.cb{display:inline-block;width:9px;height:9px;border:1px solid #000;border-radius:1px;font-size:8pt;line-height:9px;text-align:center;font-weight:bold;color:#000}' +
    '.rodape{font-size:5.6pt;line-height:1.3;text-align:center;white-space:normal}' +
    '</style></head><body>' +
    paginas.map(function(pagina) { return '<div class="pagina">' + pagina + '</div>'; }).join('') +
    '</body></html>';
}

/* --- Diagnostico do conversor HtmlService ---------------------------------
 * Executar manualmente no editor do Apps Script (somente administradores):
 * gera um PDF com dados ficticios em "IPS - Diagnostico PDF HTML" no Meu Drive
 * de quem executa. Nao le nem altera planilhas, Agenda ou Transporte.
 * Conteudo: Declaracao x4 + Invoice MARKEN x4 (caso MARKEN tipico) seguidas de
 * Declaracao x1 + Invoice x1 com textos longos, cinco materiais e temperatura
 * mista. Comparar o PDF com o atual e conferir paginas = paginasEsperadas.
 */
var TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_ = 'IPS - Diagnóstico PDF HTML';

function transporteDocsHtmlDadosDiagnostico_() {
  var base = {
    courier: 'MARKEN',
    temperatura: 'CONGELADO',
    dataEnvio: '2026-11-05',
    awb: 'DIAG-0000000',
    medico: { nome: 'Pessoa Investigadora Exemplo', cpf: '000.000.000-00', cremers: '00000' },
    destino: {
      nome: 'Laboratório Central Exemplo Specimen Processing',
      endereco: '1000 Example Drive',
      cidadePais: 'Indianapolis, IN, USA',
      zip: '00000',
      telefone: '(000) 0000000',
      contato: ''
    },
    materiais: [{ tipo: 'plasma', tubos: 4, formula: '4×1,0', total: 4 }],
    outroTipo: '',
    geloSecoKg: 4,
    contatoEmergencia: 'Telefone de Emergência (24H): +55 54 99909-1656',
    invoice: { packages: 1, totalWeight: '5 Kg' }
  };
  var limite = Object.assign({}, base, {
    temperatura: 'AMBIENTE + CONGELADO',
    medico: { nome: 'Maria Aparecida dos Santos Albuquerque', cpf: '000.000.000-00', cremers: '00000' },
    destino: Object.assign({}, base.destino, {
      nome: 'Laboratório Central Exemplo de Nome Muito Longo Specimen Processing Unit',
      contato: 'Pessoa de Contato do Laboratório Exemplo'
    }),
    materiais: [
      { tipo: 'sangue', tubos: 2, formula: '2×4,0', total: 8 },
      { tipo: 'soro', tubos: 6, formula: '3×2,0 + 3×1,5 + 0×1,0', total: 10.5 },
      { tipo: 'urina', tubos: 1, formula: '1×10,0', total: 10 },
      { tipo: 'plasma', tubos: 14, formula: '4×1,0 + 4×0,5 + 4×2,0 + 1×1,0 + 1×0,5', total: 14.5 },
      { tipo: 'fezes', tubos: 1, formula: '1×5,0', total: 5 }
    ],
    outroTipo: 'Lâminas de hematologia (2)',
    geloSecoKg: 10,
    invoice: { packages: 2, totalWeight: '6 Kg' }
  });
  return [
    { chave: 'declaracaoTransp', copias: 4, dados: base },
    { chave: 'invoiceMarken', copias: 4, dados: base },
    { chave: 'declaracaoTransp', copias: 1, dados: limite },
    { chave: 'invoiceMarken', copias: 1, dados: limite }
  ];
}

// Conta objetos /Type /Page (exclui /Pages) nos bytes do PDF gerado.
function transporteDocsHtmlContarPaginasPdf_(blob) {
  var texto = blob.getDataAsString('ISO-8859-1');
  return (texto.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
}

function diagnosticarPdfTransporteHtml() {
  codexAssertAdmin_();
  var tempos = {};
  var inicio = Date.now();
  var documentos = transporteDocsHtmlDadosDiagnostico_();
  var paginasEsperadas = documentos.reduce(function(acc, doc) { return acc + doc.copias; }, 0);
  var marca = Date.now();
  var logoSrc = typeof reqExamesLogoSrc_ === 'function' ? reqExamesLogoSrc_() : '';
  tempos.logoMs = Date.now() - marca;
  marca = Date.now();
  var html = transporteDocsHtmlMontar_({}, documentos, { logoSrc: logoSrc });
  tempos.htmlMs = Date.now() - marca;
  marca = Date.now();
  var stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd-HHmmss');
  var blob = HtmlService.createHtmlOutput(html).getBlob().getAs(MimeType.PDF)
    .setName('diagnostico-transporte-html-' + stamp + '.pdf');
  tempos.conversaoMs = Date.now() - marca;
  var paginas = transporteDocsHtmlContarPaginasPdf_(blob);
  marca = Date.now();
  var root = DriveApp.getRootFolder();
  var pastas = root.getFoldersByName(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
  var pasta = pastas.hasNext() ? pastas.next() : root.createFolder(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
  var arquivo = pasta.createFile(blob);
  tempos.driveMs = Date.now() - marca;
  tempos.totalMs = Date.now() - inicio;
  var resultado = {
    ok: paginas === paginasEsperadas,
    paginas: paginas,
    paginasEsperadas: paginasEsperadas,
    bytes: blob.getBytes().length,
    logoIncorporado: /^data:image\//i.test(logoSrc),
    tempos: tempos,
    fileName: arquivo.getName(),
    fileUrl: arquivo.getUrl()
  };
  // Sem dados pessoais: somente contagens, tempos e o link do arquivo ficticio.
  Logger.log(JSON.stringify(resultado));
  return resultado;
}
