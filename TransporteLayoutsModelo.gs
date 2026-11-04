/* ===== TransporteLayoutsModelo.gs =====
 * Documentacao de Transporte sem a planilha de modelos: o layout das abas-modelo fica
 * congelado em TransporteLayoutsDados.html (gerado por tools/export-transporte-layouts.js,
 * so com texto fixo do modelo) e as MESMAS funcoes de preenchimento de hoje rodam sobre uma
 * planilha em memoria (transporteLayoutsPlanilha_) inicializada com esse layout. As formulas
 * do modelo sao avaliadas na leitura e os valores sao exibidos com o formato numerico da
 * celula, como o Sheets faz (locale pt_BR).
 *
 * A planilha em memoria implementa somente a parte da API de Spreadsheet/Sheet/Range usada
 * pelo preenchimento. Qualquer outro metodo, A1 invalido ou formula fora do subconjunto
 * suportado e registrado em planilha.problemas_ e impede a geracao (transporteDocsDados_),
 * porque varias rotinas de preenchimento engolem erros e so registram em log.
 */

// Nome base diferente do .gs: o Apps Script nao aceita .gs e .html com o mesmo nome.
var TRANSPORTE_LAYOUTS_ARQUIVO_ = 'TransporteLayoutsDados';
var TRANSPORTE_LAYOUTS_MEMO_ = null;
// Enquanto > 0, getTransporteSpreadsheetCodex_ recusa abrir a planilha real.
var TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_ = 0;
var TRANSPORTE_LAYOUTS_MESES_ = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Dia 0 das datas do Sheets (30/12/1899), em UTC.
var TRANSPORTE_LAYOUTS_EPOCA_MS_ = Date.UTC(1899, 11, 30);

/* ---------- Arquivo de layouts ---------- */

// conteudo: texto JSON (testes); sem ele, le o arquivo .html do projeto uma vez por execucao.
function transporteLayoutsCarregar_(conteudo) {
  if (conteudo === undefined && TRANSPORTE_LAYOUTS_MEMO_) return TRANSPORTE_LAYOUTS_MEMO_;
  var texto = conteudo !== undefined ? conteudo
    : HtmlService.createHtmlOutputFromFile(TRANSPORTE_LAYOUTS_ARQUIVO_).getContent();
  var arquivo = JSON.parse(texto);
  if (!arquivo || arquivo.versao !== 1 || !arquivo.abas || !arquivo.formatos) {
    throw new Error('Arquivo de layouts de Transporte invalido.');
  }
  if (conteudo === undefined) TRANSPORTE_LAYOUTS_MEMO_ = arquivo;
  return arquivo;
}

// Aba no formato de spreadsheets.get, pronta para transporteDocsGradeHtml_ (copia nova).
function transporteLayoutsExpandir_(arquivo, chave) {
  var aba = arquivo.abas[chave];
  if (!aba) throw new Error('Layout de Transporte ausente: ' + chave);
  var l = aba.layout;
  var imagens = arquivo.imagens || {};
  function src(id) { return imagens[id] || id; }
  return {
    properties: { title: l.titulo },
    merges: l.mesclas.map(function(m) {
      return { startRowIndex: m[0], endRowIndex: m[1], startColumnIndex: m[2], endColumnIndex: m[3] };
    }),
    area: { colunas: l.area.colunas, linhas: l.area.linhas },
    formatosCondicionais: [],
    imagensFlutuantes: (l.imagensFlutuantes || []).map(function(i) { return Object.assign({}, i, { url: src(i.url) }); }),
    imagensOmitidas: l.imagensOmitidas || 0,
    data: [{
      columnMetadata: l.colunas.map(function(c) { return { pixelSize: c[0], hiddenByUser: !!c[1] }; }),
      rowMetadata: l.linhas.map(function(r) { return { pixelSize: r[0], hiddenByUser: !!r[1] }; }),
      rowData: l.celulas.map(function(row) {
        return { values: row.map(function(c) {
          var out = {};
          if (c.f !== undefined) out.effectiveFormat = JSON.parse(JSON.stringify(arquivo.formatos[c.f]));
          if (c.t !== undefined) out.formattedValue = c.t;
          if (c.e) out.effectiveValue = Object.assign({}, c.e);
          if (c.r) out.textFormatRuns = JSON.parse(JSON.stringify(c.r));
          if (c.v) out.dataValidation = JSON.parse(JSON.stringify(c.v));
          if (c.i) out.userEnteredValue = { imageValue: { imageProperties: { contentUrl: src(c.i) } } };
          return out;
        }) };
      })
    }]
  };
}

/* ---------- Enderecos ---------- */

function transporteLayoutsColuna_(n) {
  var s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

function transporteLayoutsColunaIndice_(letras) {
  var n = 0;
  for (var i = 0; i < letras.length; i++) n = n * 26 + letras.charCodeAt(i) - 64;
  return n - 1;
}

// 'B21:N28' -> { r0, c0, r1, c1 } (base 0, inclusivo).
function transporteLayoutsFaixa_(a1) {
  var m = String(a1 || '').replace(/\$/g, '').match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('Endereco invalido: ' + a1);
  var c0 = transporteLayoutsColunaIndice_(m[1]), r0 = Number(m[2]) - 1;
  return { r0: r0, c0: c0, r1: m[4] ? Number(m[4]) - 1 : r0, c1: m[3] ? transporteLayoutsColunaIndice_(m[3]) : c0 };
}

/* ---------- Formatacao (pt_BR) ---------- */

// Date de qualquer contexto (o simulador roda o script em outro realm).
function transporteLayoutsEhData_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function transporteLayoutsSerialParaData_(serial) {
  return new Date(TRANSPORTE_LAYOUTS_EPOCA_MS_ + Math.round(Number(serial) * 86400000));
}

// Partes de data/hora no fuso do negocio, como o Sheets exibe uma Date gravada pelo script.
function transporteLayoutsPartesData_(data, fusoUtc) {
  var d = fusoUtc ? data : new Date(data.getTime() - transporteLayoutsOffsetMs_(data));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

// Deslocamento do fuso do script (Apps Script: Session.getScriptTimeZone, America/Sao_Paulo).
function transporteLayoutsOffsetMs_(data) {
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function' && typeof Session !== 'undefined') {
    var z = Utilities.formatDate(data, Session.getScriptTimeZone(), 'Z');
    var sinal = z.charAt(0) === '-' ? -1 : 1;
    return sinal * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2))) * 60000 * -1;
  }
  // Fora do Apps Script (simulador): o fuso do processo, o mesmo em que as datas foram criadas.
  return data.getTimezoneOffset() * 60000;
}

function transporteLayoutsDois_(n) { return (n < 10 ? '0' : '') + n; }

function transporteLayoutsAgrupar_(inteiro) {
  return String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Numero sem formato (Geral): ate 10 casas significativas, virgula decimal.
function transporteLayoutsNumeroGeral_(n) {
  if (!isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e15 || (n !== 0 && Math.abs(n) < 1e-9)) return String(n).replace('.', ',');
  var texto = String(Number(n.toPrecision(15)));
  if (/e/i.test(texto)) return texto.replace('.', ',');
  var partes = texto.split('.');
  if (partes[1] && partes[1].length > 10) partes[1] = String(Number('0.' + partes[1]).toFixed(10)).slice(2).replace(/0+$/, '');
  return partes[0] + (partes[1] ? ',' + partes[1] : '');
}

function transporteLayoutsNumeroPadrao_(n, padrao) {
  var prefixo = '';
  var corpo = String(padrao);
  var lit = corpo.match(/^\[\$([^\]-]*)[^\]]*\]/);
  if (lit) { prefixo = lit[1]; corpo = corpo.slice(lit[0].length); }
  var aspas = corpo.match(/^"([^"]*)"/);
  if (aspas) { prefixo += aspas[1]; corpo = corpo.slice(aspas[0].length); }
  var m = corpo.match(/^(#,##)?(0+|#)(?:\.(0+))?$/);
  if (!m) return null;
  var casas = m[3] ? m[3].length : 0;
  var negativo = n < 0;
  var fixo = Math.abs(n).toFixed(casas).split('.');
  var inteiro = m[1] ? transporteLayoutsAgrupar_(fixo[0]) : fixo[0];
  if (m[2] === '#' && inteiro === '0' && !casas) inteiro = '';
  while (inteiro.length < m[2].length && m[2].charAt(0) === '0') inteiro = '0' + inteiro;
  return (negativo ? '-' : '') + prefixo + inteiro + (casas ? ',' + fixo[1] : '');
}

function transporteLayoutsDataPadrao_(partes, padrao) {
  var out = '';
  var tokens = String(padrao).match(/"[^"]*"|\\.|y+|m+|M+|d+|h+|H+|s+|[^"\\ymMdhHs]+/g) || [];
  tokens.forEach(function(tk, i) {
    var anterior = tokens.slice(0, i).reverse().filter(function(t) { return /^[ymMdhHs]/.test(t); })[0] || '';
    var proximo = tokens.slice(i + 1).filter(function(t) { return /^[ymMdhHs]/.test(t); })[0] || '';
    if (tk.charAt(0) === '"') out += tk.slice(1, -1);
    else if (tk.charAt(0) === '\\') out += tk.charAt(1);
    else if (/^y/.test(tk)) out += tk.length <= 2 ? transporteLayoutsDois_(partes.y % 100) : partes.y;
    else if (/^[mM]/.test(tk)) {
      var minuto = tk.charAt(0) === 'm' && tk.length <= 2 && (/^[hH]/.test(anterior) || /^s/.test(proximo));
      if (minuto) out += tk.length === 2 ? transporteLayoutsDois_(partes.min) : partes.min;
      else if (tk.length >= 4) out += TRANSPORTE_LAYOUTS_MESES_[partes.m - 1];
      else if (tk.length === 3) out += TRANSPORTE_LAYOUTS_MESES_[partes.m - 1].slice(0, 3);
      else out += tk.length === 2 ? transporteLayoutsDois_(partes.m) : partes.m;
    } else if (/^d/.test(tk)) out += tk.length >= 2 ? transporteLayoutsDois_(partes.d) : partes.d;
    else if (/^[hH]/.test(tk)) out += tk.length >= 2 ? transporteLayoutsDois_(partes.h) : partes.h;
    else if (/^s/.test(tk)) out += tk.length >= 2 ? transporteLayoutsDois_(partes.s) : partes.s;
    else out += tk;
  });
  return out;
}

/**
 * Texto exibido de um valor com o numberFormat da celula (effectiveFormat.numberFormat).
 * valor: Date (gravada pelo script), numero (datas do Sheets como serial quando o formato e
 * de data), booleano ou texto.
 */
function transporteLayoutsFormatar_(valor, numberFormat) {
  if (valor === null || valor === undefined || valor === '') return '';
  var nf = numberFormat || {};
  var tipo = nf.type || '';
  if (typeof valor === 'boolean') return valor ? 'TRUE' : 'FALSE';
  if (typeof valor === 'string') return valor;
  if (transporteLayoutsEhData_(valor)) {
    if (isNaN(valor.getTime())) return '';
    var partes = transporteLayoutsPartesData_(valor, false);
    if (nf.pattern && /DATE|TIME/.test(tipo)) return transporteLayoutsDataPadrao_(partes, nf.pattern);
    var temHora = partes.h || partes.min || partes.s;
    return transporteLayoutsDataPadrao_(partes, temHora ? 'dd/MM/yyyy HH:mm:ss' : 'dd/MM/yyyy');
  }
  if (typeof valor === 'number') {
    if (/DATE|TIME/.test(tipo) && nf.pattern) {
      return transporteLayoutsDataPadrao_(transporteLayoutsPartesData_(transporteLayoutsSerialParaData_(valor), true), nf.pattern);
    }
    if (nf.pattern && tipo !== 'TEXT') {
      var formatado = transporteLayoutsNumeroPadrao_(valor, nf.pattern);
      if (formatado !== null) return formatado;
    }
    return transporteLayoutsNumeroGeral_(valor);
  }
  return String(valor);
}

/* ---------- Formulas do modelo ---------- */

/**
 * Avaliador do subconjunto usado nas abas-modelo: referencias ('Aba'!A1, A1, A1:B2),
 * textos, numeros, TRUE/FALSE, &, + - * /, comparacoes (= <> < > <= >=) e as funcoes
 * SUM, IF, AND, OR, DAY, YEAR, TEXT e INDIRECT (argumentos separados por ; ou ,).
 * ler(aba, r, c) devolve o valor da celula (Date, numero, booleano, texto ou '').
 */
function transporteLayoutsAvaliarFormula_(formula, abaAtual, ler) {
  var texto = String(formula || '').replace(/^=/, '');
  var tokens = [];
  var re = /\s*('(?:[^']|'')+'![A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|[A-Za-z_][\w.]*![A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?(?![\w(])|"(?:[^"]|"")*"|\d+(?:[.,]\d+)?(?![\w])|[A-Za-z_][\w.]*(?=\s*\()|TRUE|FALSE|<>|<=|>=|[-+*/&=<>();,])/gy;
  var m;
  var pos = 0;
  while (pos < texto.length) {
    re.lastIndex = pos;
    m = re.exec(texto);
    if (!m) {
      if (/^\s+$/.test(texto.slice(pos))) break;
      throw new Error('Formula nao suportada: ' + formula);
    }
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  var i = 0;
  function espiar() { return tokens[i]; }
  function consumir(esperado) {
    var t = tokens[i++];
    if (esperado !== undefined && t !== esperado) throw new Error('Formula nao suportada: ' + formula);
    return t;
  }
  function referencia(tk) {
    var aba = abaAtual;
    var endereco = tk;
    var ex = tk.lastIndexOf('!');
    if (ex >= 0) {
      aba = tk.slice(0, ex);
      if (aba.charAt(0) === "'") aba = aba.slice(1, -1).replace(/''/g, "'");
      endereco = tk.slice(ex + 1);
    }
    var f = transporteLayoutsFaixa_(endereco);
    if (f.r0 === f.r1 && f.c0 === f.c1) return ler(aba, f.r0, f.c0);
    var valores = [];
    for (var r = f.r0; r <= f.r1; r++) for (var c = f.c0; c <= f.c1; c++) valores.push(ler(aba, r, c));
    return { faixa: valores };
  }
  function numero(v) {
    if (v && v.faixa) throw new Error('Formula nao suportada: ' + formula);
    if (transporteLayoutsEhData_(v)) return (v.getTime() - transporteLayoutsOffsetMs_(v) - TRANSPORTE_LAYOUTS_EPOCA_MS_) / 86400000;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(String(v).replace(',', '.'));
    if (isNaN(n)) throw new Error('Valor nao numerico em formula: ' + formula);
    return n;
  }
  function textoDe(v) {
    if (v && v.faixa) throw new Error('Formula nao suportada: ' + formula);
    if (transporteLayoutsEhData_(v) || typeof v === 'number') return transporteLayoutsNumeroGeral_(numero(v));
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return v === null || v === undefined ? '' : String(v);
  }
  function verdade(v) {
    if (typeof v === 'boolean') return v;
    if (v === '' || v === null || v === undefined) return false;
    if (typeof v === 'number') return v !== 0;
    if (/^(true|false)$/i.test(String(v))) return /^true$/i.test(String(v));
    throw new Error('Valor logico invalido em formula: ' + formula);
  }
  function data(v) {
    if (transporteLayoutsEhData_(v)) return transporteLayoutsPartesData_(v, false);
    if (typeof v === 'number') return transporteLayoutsPartesData_(transporteLayoutsSerialParaData_(v), true);
    throw new Error('Data invalida em formula: ' + formula);
  }
  var funcoes = {
    SUM: function(args) {
      var total = 0;
      args.forEach(function(a) {
        (a && a.faixa ? a.faixa : [a]).forEach(function(v) {
          if (typeof v === 'number') total += v;
          else if (transporteLayoutsEhData_(v)) total += numero(v);
          else if (a && !a.faixa) total += numero(v);
        });
      });
      return total;
    },
    IF: function(args) { return verdade(args[0]) ? args[1] : (args.length > 2 ? args[2] : false); },
    AND: function(args) { return args.every(verdade); },
    OR: function(args) { return args.some(verdade); },
    DAY: function(args) { return data(args[0]).d; },
    YEAR: function(args) { return data(args[0]).y; },
    TEXT: function(args) {
      var v = args[0];
      var padrao = textoDe(args[1]);
      if (transporteLayoutsEhData_(v) || /[dmyhs]/i.test(padrao)) {
        var serial = numero(v);
        return transporteLayoutsFormatar_(serial, { type: 'DATE', pattern: padrao });
      }
      return transporteLayoutsFormatar_(numero(v), { type: 'NUMBER', pattern: padrao });
    },
    INDIRECT: function(args) { return referencia(textoDe(args[0])); }
  };
  // Funcoes avaliadas so no ramo escolhido (IF) ainda leem os dois ramos: as referencias do
  // modelo sao simples e sem efeitos, entao a avaliacao completa e segura.
  function primario() {
    var t = consumir();
    if (t === undefined) throw new Error('Formula nao suportada: ' + formula);
    if (t === '(') { var v = expressao(); consumir(')'); return v; }
    if (t === '-') return -numero(primario());
    if (t === '+') return numero(primario());
    if (t.charAt(0) === '"') return t.slice(1, -1).replace(/""/g, '"');
    if (t === 'TRUE') return true;
    if (t === 'FALSE') return false;
    if (/^\d/.test(t)) return Number(t.replace(',', '.'));
    if (espiar() === '(' && /^[A-Za-z_]/.test(t) && t.indexOf('!') < 0) {
      var nome = t.toUpperCase();
      if (!funcoes[nome]) throw new Error('Funcao nao suportada em formula: ' + nome);
      consumir('(');
      var args = [];
      if (espiar() !== ')') {
        args.push(expressao());
        while (espiar() === ';' || espiar() === ',') { consumir(); args.push(expressao()); }
      }
      consumir(')');
      return funcoes[nome](args);
    }
    return referencia(t);
  }
  function multiplicativo() {
    var v = primario();
    while (espiar() === '*' || espiar() === '/') {
      var op = consumir();
      var d = numero(primario());
      v = op === '*' ? numero(v) * d : numero(v) / d;
    }
    return v;
  }
  function aditivo() {
    var v = multiplicativo();
    while (espiar() === '+' || espiar() === '-') {
      var op = consumir();
      var d = numero(multiplicativo());
      v = op === '+' ? numero(v) + d : numero(v) - d;
    }
    return v;
  }
  function concatenacao() {
    var v = aditivo();
    while (espiar() === '&') { consumir(); v = textoDe(v) + textoDe(aditivo()); }
    return v;
  }
  function comparar(a, b, op) {
    var ta = typeof a, tb = typeof b;
    var x = a, y = b;
    if (transporteLayoutsEhData_(a) || transporteLayoutsEhData_(b) || (ta === 'number' && tb === 'number')) { x = numero(a); y = numero(b); }
    else if (ta === 'boolean' || tb === 'boolean') {
      if (ta !== tb) return op === '<>';
    } else { x = textoDe(a).toLowerCase(); y = textoDe(b).toLowerCase(); }
    switch (op) {
      case '=': return x === y;
      case '<>': return x !== y;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      default: return x >= y;
    }
  }
  function expressao() {
    var v = concatenacao();
    while (['=', '<>', '<', '>', '<=', '>='].indexOf(espiar()) >= 0) {
      var op = consumir();
      v = comparar(v, concatenacao(), op);
    }
    return v;
  }
  var resultado = expressao();
  if (i !== tokens.length) throw new Error('Formula nao suportada: ' + formula);
  if (resultado && resultado.faixa) throw new Error('Formula nao suportada: ' + formula);
  return resultado;
}

/* ---------- Planilha em memoria ---------- */

/**
 * Spreadsheet em memoria com as abas do arquivo de layouts (todas, ou opcoes.chaves).
 * Valores iniciais: texto fixo do modelo e formulas; celulas variaveis comecam vazias.
 * Devolve o objeto "ss" e, em ss.problemas_, o que nao pode ser reproduzido.
 */
function transporteLayoutsPlanilha_(arquivo, opcoes) {
  opcoes = opcoes || {};
  var chaves = opcoes.chaves || Object.keys(arquivo.abas);
  var problemas = [];
  var abas = {};
  var ordem = [];

  function problema(texto) {
    if (problemas.indexOf(texto) < 0) problemas.push(texto);
  }

  function novaAba(chave) {
    var aba = arquivo.abas[chave];
    var l = aba.layout;
    var celulas = {};
    l.celulas.forEach(function(row, r) {
      row.forEach(function(c, col) {
        var cel = { f: c.f };
        if (c.t !== undefined) {
          // Texto fixo do modelo: exibido exatamente como o Sheets o exportou.
          cel.t = c.t;
          cel.tFixo = true;
          if (c.e && c.e.numberValue !== undefined) cel.v = c.e.numberValue;
          else if (c.e && c.e.boolValue !== undefined) cel.v = c.e.boolValue;
          else cel.v = c.t;
          if (c.r) cel.runs = c.r;
        }
        if (c.v) cel.validacao = c.v;
        celulas[r + ':' + col] = cel;
      });
    });
    Object.keys(aba.formulas || {}).forEach(function(a1) {
      var f = transporteLayoutsFaixa_(a1);
      var cel = celulas[f.r0 + ':' + f.c0] || (celulas[f.r0 + ':' + f.c0] = {});
      cel.formula = aba.formulas[a1];
      delete cel.v; delete cel.t; delete cel.runs;
    });
    // Celulas cobertas por mesclagem (todas menos a ancora): o Sheets descarta o que se grava nelas.
    var cobertas = {};
    (l.mesclas || []).forEach(function(m) {
      for (var r = m[0]; r < m[1]; r++) {
        for (var c = m[2]; c < m[3]; c++) if (r !== m[0] || c !== m[2]) cobertas[r + ':' + c] = true;
      }
    });
    var estado = { chave: chave, titulo: aba.titulo, l: l, celulas: celulas, cobertas: cobertas, avaliando: {} };
    estado.api = criarSheet(estado);
    return estado;
  }

  function celula(estado, r, c, criar) {
    var k = r + ':' + c;
    if (!estado.celulas[k] && criar) estado.celulas[k] = {};
    return estado.celulas[k] || null;
  }

  function formatoNumero(estado, cel) {
    if (cel && cel.nf) return cel.nf;
    var base = cel && cel.f !== undefined ? arquivo.formatos[cel.f] : null;
    return base && base.numberFormat ? base.numberFormat : null;
  }

  function valorDe(estado, r, c) {
    var cel = celula(estado, r, c, false);
    if (!cel) return '';
    if (cel.formula) {
      var k = r + ':' + c;
      if (estado.avaliando[k]) { problema('Referencia circular em ' + estado.titulo + '!' + transporteLayoutsColuna_(c) + (r + 1)); return ''; }
      estado.avaliando[k] = true;
      try {
        return transporteLayoutsAvaliarFormula_(cel.formula, estado.titulo, lerPorTitulo);
      } catch (e) {
        problema(e.message + ' (' + estado.titulo + '!' + transporteLayoutsColuna_(c) + (r + 1) + ')');
        return '';
      } finally {
        delete estado.avaliando[k];
      }
    }
    return cel.v === undefined ? '' : cel.v;
  }

  function textoExibido(estado, r, c) {
    var cel = celula(estado, r, c, false);
    if (!cel) return '';
    if (!cel.formula && cel.tFixo) return cel.t;
    var v = valorDe(estado, r, c);
    // Referencia a celula vazia aparece vazia no Sheets (nao 0).
    return transporteLayoutsFormatar_(v, formatoNumero(estado, cel));
  }

  function lerPorTitulo(titulo, r, c) {
    var estado = null;
    Object.keys(abas).some(function(k) { if (abas[k].titulo === titulo) { estado = abas[k]; return true; } return false; });
    if (!estado) { problema('Formula referencia aba sem layout: ' + titulo); return ''; }
    return valorDe(estado, r, c);
  }

  // Interpretacao de setValue: '=' vira formula, apostrofo inicial vira texto literal; em
  // celulas sem formato Texto, numeros simples (virgula decimal) viram numero, como no Sheets.
  function gravar(estado, r, c, valor) {
    var cel = celula(estado, r, c, true);
    delete cel.formula; delete cel.runs; delete cel.t; delete cel.tFixo;
    if (valor === null || valor === undefined) valor = '';
    // setValue numa faixa mesclada (ex.: J10:K10) so guarda o valor na ancora, como no Sheets.
    if (estado.cobertas[r + ':' + c]) { cel.v = ''; return; }
    if (typeof valor === 'string') {
      var nf = formatoNumero(estado, cel);
      if (valor.charAt(0) === '=') { cel.formula = valor; delete cel.v; return; }
      if (valor.charAt(0) === "'") { cel.v = valor.slice(1); cel.t = cel.v; cel.tFixo = true; return; }
      if (!(nf && nf.type === 'TEXT') && /^-?\d+(,\d+)?$/.test(valor.trim()) && valor.trim().length < 16) {
        cel.v = Number(valor.trim().replace(',', '.'));
        return;
      }
      cel.v = valor;
      cel.t = valor;
      cel.tFixo = true;
      return;
    }
    if (typeof valor === 'object' && !transporteLayoutsEhData_(valor)) { problema('Valor nao suportado na planilha em memoria'); valor = String(valor); }
    cel.v = valor;
  }

  function protegido(nome, fn) {
    return function() {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        problema(nome + ': ' + (e && e.message || e));
        throw e;
      }
    };
  }

  function naoSuportado(alvo, tipo) {
    if (typeof Proxy !== 'function') return alvo;
    return new Proxy(alvo, {
      get: function(obj, prop) {
        if (prop in obj || typeof prop === 'symbol' || prop === 'toJSON' || prop === 'then') return obj[prop];
        problema('Metodo nao suportado na planilha em memoria: ' + tipo + '.' + String(prop));
        return function() { throw new Error('Metodo nao suportado na planilha em memoria: ' + tipo + '.' + String(prop)); };
      }
    });
  }

  function criarRange(estado, r0, c0, nr, nc) {
    function cada(fn) { for (var r = 0; r < nr; r++) for (var c = 0; c < nc; c++) fn(r0 + r, c0 + c, r, c); }
    function matriz(fn) {
      var out = [];
      for (var r = 0; r < nr; r++) { var linha = []; for (var c = 0; c < nc; c++) linha.push(fn(r0 + r, c0 + c)); out.push(linha); }
      return out;
    }
    var range = {
      getRow: function() { return r0 + 1; },
      getColumn: function() { return c0 + 1; },
      getNumRows: function() { return nr; },
      getNumColumns: function() { return nc; },
      getLastRow: function() { return r0 + nr; },
      getLastColumn: function() { return c0 + nc; },
      getSheet: function() { return estado.api; },
      getA1Notation: function() {
        var ini = transporteLayoutsColuna_(c0) + (r0 + 1);
        return nr === 1 && nc === 1 ? ini : ini + ':' + transporteLayoutsColuna_(c0 + nc - 1) + (r0 + nr);
      },
      getCell: protegido('Range.getCell', function(r, c) {
        if (r < 1 || c < 1 || r > nr || c > nc) throw new Error('Celula fora do intervalo');
        return criarRange(estado, r0 + r - 1, c0 + c - 1, 1, 1);
      }),
      getValue: function() { return valorDe(estado, r0, c0); },
      getValues: function() { return matriz(function(r, c) { return valorDe(estado, r, c); }); },
      getDisplayValue: function() { return textoExibido(estado, r0, c0); },
      getDisplayValues: function() { return matriz(function(r, c) { return textoExibido(estado, r, c); }); },
      getFormula: function() { var cel = celula(estado, r0, c0, false); return cel && cel.formula || ''; },
      getNote: function() { var cel = celula(estado, r0, c0, false); return cel && cel.nota || ''; },
      setValue: protegido('Range.setValue', function(v) { cada(function(r, c) { gravar(estado, r, c, v); }); return range; }),
      setValues: protegido('Range.setValues', function(valores) {
        if (!valores || valores.length !== nr || valores.some(function(l) { return !l || l.length !== nc; })) {
          throw new Error('Dimensoes de setValues diferentes do intervalo ' + range.getA1Notation());
        }
        cada(function(r, c, i, j) { gravar(estado, r, c, valores[i][j]); });
        return range;
      }),
      clearContent: function() { cada(function(r, c) { gravar(estado, r, c, ''); }); return range; },
      setNote: function(nota) { cada(function(r, c) { celula(estado, r, c, true).nota = String(nota || ''); }); return range; },
      clearNote: function() { cada(function(r, c) { var cel = celula(estado, r, c, false); if (cel) delete cel.nota; }); return range; },
      clearDataValidations: function() { cada(function(r, c) { var cel = celula(estado, r, c, true); cel.validacao = null; }); return range; },
      setFontSize: function(tamanho) { cada(function(r, c) { celula(estado, r, c, true).fonte = Number(tamanho); }); return range; },
      setWrap: function(quebra) { cada(function(r, c) { celula(estado, r, c, true).quebra = !!quebra; }); return range; },
      setNumberFormat: function(padrao) {
        cada(function(r, c) {
          var p = String(padrao || '');
          celula(estado, r, c, true).nf = p === '@' ? { type: 'TEXT' } : { type: /[dy]|h:|m\/|\/m/i.test(p) ? 'DATE' : 'NUMBER', pattern: p };
        });
        return range;
      },
      setRichTextValue: protegido('Range.setRichTextValue', function(rich) {
        var texto = String(rich.getText());
        var runs = [];
        (rich.getRuns ? rich.getRuns() : []).forEach(function(run) {
          var estilo = run.getTextStyle();
          var formato = {};
          if (estilo.isBold && estilo.isBold() !== null) formato.bold = !!estilo.isBold();
          if (estilo.isItalic && estilo.isItalic() !== null) formato.italic = !!estilo.isItalic();
          if (estilo.isUnderline && estilo.isUnderline() !== null) formato.underline = !!estilo.isUnderline();
          runs.push({ startIndex: run.getStartIndex(), format: formato });
        });
        cada(function(r, c) {
          gravar(estado, r, c, "'" + texto);
          if (runs.length) celula(estado, r, c, true).runs = runs;
        });
        return range;
      })
    };
    return naoSuportado(range, 'Range');
  }

  function criarSheet(estado) {
    function ultimo(eixo) {
      var max = 0;
      Object.keys(estado.celulas).forEach(function(k) {
        var cel = estado.celulas[k];
        if (!cel.formula && (cel.v === undefined || cel.v === '')) return;
        var p = k.split(':');
        max = Math.max(max, Number(p[eixo]) + 1);
      });
      return max;
    }
    var sheet = {
      getName: function() { return estado.titulo; },
      getSheetName: function() { return estado.titulo; },
      getParent: function() { return ss; },
      getLastRow: function() { return ultimo(0); },
      getLastColumn: function() { return ultimo(1); },
      getMaxRows: function() { return Math.max(estado.l.area.linhas, estado.l.linhas.length); },
      getMaxColumns: function() { return Math.max(estado.l.area.colunas, estado.l.colunas.length); },
      isSheetHidden: function() { return true; },
      getRange: protegido('Sheet.getRange', function(a, b, c, d) {
        if (typeof a === 'string') {
          var f = transporteLayoutsFaixa_(a);
          return criarRange(estado, f.r0, f.c0, f.r1 - f.r0 + 1, f.c1 - f.c0 + 1);
        }
        if (!(a >= 1) || !(b >= 1)) throw new Error('Linha/coluna invalida');
        return criarRange(estado, a - 1, b - 1, c || 1, d || 1);
      }),
      getRangeList: protegido('Sheet.getRangeList', function(lista) {
        var ranges = (lista || []).map(function(a1) { return sheet.getRange(a1); });
        return naoSuportado({
          getRanges: function() { return ranges; },
          setValue: function(v) { ranges.forEach(function(r) { r.setValue(v); }); },
          clearContent: function() { ranges.forEach(function(r) { r.clearContent(); }); }
        }, 'RangeList');
      }),
      getDataRange: function() {
        return criarRange(estado, 0, 0, Math.max(1, sheet.getLastRow()), Math.max(1, sheet.getLastColumn()));
      },
      getImages: function() { return []; }
    };
    return naoSuportado(sheet, 'Sheet');
  }

  chaves.forEach(function(chave) {
    abas[chave] = novaAba(chave);
    ordem.push(chave);
  });

  var ss = naoSuportado({
    problemas_: problemas,
    getId: function() { return 'TRANSPORTE_LAYOUTS_EM_MEMORIA'; },
    getName: function() { return 'Documentação para Transporte de Amostras (em memória)'; },
    getSpreadsheetLocale: function() { return 'pt_BR'; },
    getSheets: function() { return ordem.map(function(k) { return abas[k].api; }); },
    getSheetByName: function(nome) {
      var k = ordem.filter(function(chave) { return abas[chave].titulo === nome; })[0];
      return k ? abas[k].api : null;
    },
    /**
     * Abas no formato de transporteDocsGradeMontar_ (mapa titulo -> sheet): layout expandido
     * com os textos exibidos, valores e formatos alterados pelo preenchimento.
     */
    exportarAbas_: function(titulos) {
      var out = {};
      ordem.forEach(function(k) {
        var estado = abas[k];
        if (titulos && titulos.indexOf(estado.titulo) < 0) return;
        var sheet = transporteLayoutsExpandir_(arquivo, k);
        var linhas = sheet.data[0].rowData;
        Object.keys(estado.celulas).forEach(function(chave) {
          var p = chave.split(':');
          var r = Number(p[0]), c = Number(p[1]);
          if (r >= sheet.area.linhas || c >= sheet.area.colunas) return;
          while (linhas.length <= r) linhas.push({ values: [] });
          var vals = linhas[r].values || (linhas[r].values = []);
          while (vals.length <= c) vals.push({});
          var destino = vals[c] || (vals[c] = {});
          var cel = estado.celulas[chave];
          var v = valorDe(estado, r, c);
          var texto = textoExibido(estado, r, c);
          if (texto === '' && v === '') { delete destino.formattedValue; delete destino.effectiveValue; }
          else {
            destino.formattedValue = texto;
            if (typeof v === 'boolean') destino.effectiveValue = { boolValue: v };
            else if (typeof v === 'number') destino.effectiveValue = { numberValue: v };
            else delete destino.effectiveValue;
          }
          if (cel.runs) destino.textFormatRuns = cel.runs; else delete destino.textFormatRuns;
          if (cel.validacao === null) delete destino.dataValidation;
          if (cel.fonte !== undefined || cel.quebra !== undefined || cel.nf) {
            var ef = destino.effectiveFormat || (destino.effectiveFormat = {});
            if (cel.fonte !== undefined) ef.textFormat = Object.assign({}, ef.textFormat, { fontSize: cel.fonte });
            if (cel.quebra !== undefined) ef.wrapStrategy = cel.quebra ? 'WRAP' : 'OVERFLOW_CELL';
            if (cel.nf) ef.numberFormat = cel.nf;
          }
        });
        out[estado.titulo] = sheet;
      });
      return out;
    }
  }, 'Spreadsheet');
  return ss;
}

/* ---------- Dados dos documentos ---------- */

/**
 * Preenche as abas-modelo em memoria com as mesmas rotinas do salvamento
 * (transporteEscreverCamposModelos_ e transportePrepararDocumentosModelos_) e o bloqueio de
 * volumes da geracao. registro: o registro preparado por salvarTransporteInterno_
 * (returnPreparedRecord). Nao le nem grava a planilha de Transporte: o acesso a ela fica
 * bloqueado durante o preenchimento.
 * Falha se a planilha em memoria nao reproduzir alguma operacao ou se o preenchimento
 * registrar aviso (rotinas que engolem erros), para nunca gerar documento incompleto.
 * Devolve { ss, abas(titulos) } com abas no formato de transporteDocsGradeMontar_.
 */
function transporteDocsDados_(registro, opcoes) {
  opcoes = opcoes || {};
  registro = registro || {};
  var arquivo = opcoes.arquivo || transporteLayoutsCarregar_();
  var ss = transporteLayoutsPlanilha_(arquivo);
  var avisosAnteriores = TRANSPORTE_GENERATION_WARNINGS_;
  var avisos = [];
  TRANSPORTE_GENERATION_WARNINGS_ = avisos;
  TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_++;
  var erro = null;
  try {
    var peticao = transporteGetSheet_(ss, 'peticaoAnuencia', false);
    transporteEscreverCamposModelos_(ss, registro, transporteMateriaisNote_('', registro, peticao));
    transportePrepararDocumentosModelos_(ss, registro);
    transporteAjustarVolumesDeclaracao_(transporteGetSheet_(ss, 'declaracaoTransp', false), true);
  } catch (e) {
    erro = e;
  } finally {
    TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_--;
    TRANSPORTE_GENERATION_WARNINGS_ = avisosAnteriores;
  }
  // Problemas da planilha em memoria explicam um erro do preenchimento: vem primeiro.
  if (ss.problemas_.length) {
    throw new Error('A documentação em memória não reproduziu o modelo: ' + ss.problemas_.slice(0, 5).join('; '));
  }
  if (erro) throw erro;
  if (avisos.length) {
    throw new Error('A documentação em memória registrou avisos de preenchimento: ' +
      avisos.map(function(a) { return a.code; }).join(', '));
  }
  return {
    ss: ss,
    abas: function(titulos) { return ss.exportarAbas_(titulos); }
  };
}

/* ---------- Exportacao das imagens do modelo (administradores) ----------
 * Executar manualmente no editor. A API do Sheets nao devolve imagens de celula nem
 * imagens sobre a grade; esta funcao le as das abas-modelo (somente leitura), com as mesmas
 * regras do PDF em HTML pela grade (transporteDocsGradeImagensCelulas_, ...Flutuantes_ e
 * TRANSPORTE_DOCS_GRADE_IMAGENS_CODIGO_), e grava um JSON na pasta privada de diagnostico:
 * { chave: { celulas: [{ r, c, src }], flutuantes: [{ r, c, x, y, w, h, src }] } }, com src
 * em data URI. Esse arquivo e o 4o argumento de tools/export-transporte-layouts.js.
 * Imagens do modelo sao logotipos e rodapes institucionais; o log so tem contagens.
 */
function exportarImagensLayoutTransporteHtml() {
  codexAssertAdmin_();
  var ss = getTransporteSpreadsheetCodex_();
  var token = ScriptApp.getOAuthToken();
  var origemCodigo = transporteDocsGradeImagensCodigo_(ss);
  var saida = {};
  var resumo = {};
  var celulasPorTitulo = {};
  function celulasDe(titulo) {
    if (!celulasPorTitulo[titulo]) {
      var sh = ss.getSheetByName(titulo);
      celulasPorTitulo[titulo] = sh ? transporteDocsGradeImagensCelulas_(sh) : [];
    }
    return celulasPorTitulo[titulo];
  }
  var chaves = Object.keys(transporteCodexSheetNames_()).filter(function(k) { return !/^email/i.test(k); });
  var urls = {};
  chaves.forEach(function(chave) {
    var sh = transporteCodexGetSheet_(ss, chave, false);
    if (!sh) return;
    var titulo = sh.getName();
    var flutuantes = transporteDocsGradeImagensFlutuantes_(sh);
    var origem = origemCodigo[titulo];
    if (origem && flutuantes.semOrigem === 1 && flutuantes.posicoesSemOrigem.length === 1) {
      var url = transporteDocsGradeImagemRodape_(celulasDe(origem));
      if (url) {
        flutuantes.imagens.push(Object.assign({ url: url }, flutuantes.posicoesSemOrigem[0]));
        flutuantes.semOrigem = 0;
      }
    }
    saida[chave] = {
      celulas: celulasDe(titulo).map(function(i) { return { r: i.r, c: i.c, url: i.url }; }),
      flutuantes: flutuantes.imagens.map(function(i) { return { r: i.r, c: i.c, x: i.x, y: i.y, w: i.w, h: i.h, url: i.url }; }),
      semOrigem: flutuantes.semOrigem
    };
    saida[chave].celulas.concat(saida[chave].flutuantes).forEach(function(i) { urls[i.url] = true; });
  });
  var dataUris = transporteDocsGradeImagensDataUri_(Object.keys(urls), token);
  var faltando = 0;
  Object.keys(saida).forEach(function(chave) {
    ['celulas', 'flutuantes'].forEach(function(tipo) {
      saida[chave][tipo] = saida[chave][tipo].map(function(i) {
        var src = dataUris[i.url];
        if (!src) faltando++;
        var out = Object.assign({}, i, { src: src || '' });
        delete out.url;
        return out;
      }).filter(function(i) { return i.src; });
    });
    resumo[chave] = { celulas: saida[chave].celulas.length, flutuantes: saida[chave].flutuantes.length, semOrigem: saida[chave].semOrigem };
  });
  var root = DriveApp.getRootFolder();
  var pastas = root.getFoldersByName(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
  var pasta = pastas.hasNext() ? pastas.next() : root.createFolder(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
  var stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd-HHmmss');
  var arquivo = pasta.createFile(Utilities.newBlob(JSON.stringify(saida), 'application/json', 'imagens-layout-transporte-' + stamp + '.json'));
  arquivo.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  var resultado = { ok: !faltando, imagensNaoBaixadas: faltando, abas: resumo, fileName: arquivo.getName(), fileUrl: arquivo.getUrl() };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}

/* ---------- Diagnostico em producao (administradores) ----------
 * Executar manualmente no editor: diagnosticarDocsDadosTransporteHtml().
 * Le o envio que esta hoje na planilha de Transporte (somente leitura) e gera os mesmos
 * documentos de dois jeitos: pela grade da planilha real (como o botao "Gerar PDF (HTML)")
 * e pela planilha em memoria (transporteDocsDados_). Compara o texto impresso de cada aba,
 * celula a celula, depois das mesmas protecoes (identificacao, contato de emergencia e
 * bloqueio de nome), e salva o PDF da planilha em memoria na pasta privada de diagnostico.
 * Usa a courier do proprio envio: so assim as duas fontes descrevem o mesmo envio.
 * O log e o retorno tem so contagens, tempos, titulos de aba e enderecos (A1) divergentes,
 * nunca valores de celula.
 */
var TRANSPORTE_LAYOUTS_DIAGNOSTICO_MAX_ENDERECOS_ = 30;

// Celulas com texto diferente entre duas listas de transporteDocsGradeProtegerConteudo_.
function transporteLayoutsCompararConteudo_(real, memoria) {
  var porAba = {};
  (memoria || []).forEach(function(item) { porAba[item.aba] = item.valores; });
  var out = {};
  (real || []).forEach(function(item) {
    var a = item.valores || [];
    var b = porAba[item.aba];
    if (!b) { out[item.aba] = { ausente: true, divergentes: 0, enderecos: [] }; return; }
    var linhas = Math.max(a.length, b.length);
    var enderecos = [];
    var total = 0;
    for (var r = 0; r < linhas; r++) {
      var la = a[r] || [], lb = b[r] || [];
      var colunas = Math.max(la.length, lb.length);
      for (var c = 0; c < colunas; c++) {
        if (String(la[c] || '') === String(lb[c] || '')) continue;
        total++;
        if (enderecos.length < TRANSPORTE_LAYOUTS_DIAGNOSTICO_MAX_ENDERECOS_) enderecos.push(transporteLayoutsColuna_(c) + (r + 1));
      }
    }
    out[item.aba] = { ausente: false, divergentes: total, enderecos: enderecos };
  });
  return out;
}

function diagnosticarDocsDadosTransporteHtml() {
  codexAssertAdmin_();
  var tempos = {};
  var inicio = Date.now();
  var marca = Date.now();
  var ss = getTransporteSpreadsheetCodex_();
  var registro = transporteDerivarDadosParticipante_(transporteReadRegistro_(), { obrigatorio: true });
  var courier = transporteNormalizeCourierFromCodex_(registro.courier);
  var spec = transportePdfSpec_(registro.courier, registro.temperatura || '', registro.destino || '', ss);
  var contexto = transporteDocsGradeContextoProtecao_(ss, courier, registro);
  tempos.registroMs = Date.now() - marca;

  // Fonte atual: abas ja preenchidas da planilha real.
  marca = Date.now();
  var real = transporteDocsGradeCarregar_(ss, spec.ordem, {});
  var conteudoReal = transporteDocsGradeProtegerConteudo_(real.abas, contexto);
  tempos.gradeRealMs = Date.now() - marca;

  // Fonte nova: layout congelado + preenchimento em memoria.
  marca = Date.now();
  var arquivo = transporteLayoutsCarregar_();
  tempos.layoutMs = Date.now() - marca;
  marca = Date.now();
  var dados = transporteDocsDados_(registro, { arquivo: arquivo });
  tempos.preenchimentoMs = Date.now() - marca;
  marca = Date.now();
  var abasMemoria = dados.abas(spec.ordem);
  var conteudoMemoria = transporteDocsGradeProtegerConteudo_(abasMemoria, contexto);
  tempos.exportarAbasMs = Date.now() - marca;

  marca = Date.now();
  var comparacao = transporteLayoutsCompararConteudo_(conteudoReal, conteudoMemoria);
  var divergentes = Object.keys(comparacao).reduce(function(acc, aba) { return acc + comparacao[aba].divergentes + (comparacao[aba].ausente ? 1 : 0); }, 0);
  tempos.comparacaoMs = Date.now() - marca;

  // PDF da planilha em memoria, montado como na geracao (Folha em HTML).
  var avisos = [];
  var pdf = null;
  if (TRANSPORTE_DOCS_GRADE_COURIERS_HTML_.indexOf(courier) >= 0) {
    marca = Date.now();
    var folha = transporteFolhaHtmlParaGrade_(dados.ss, Object.assign({}, registro, { courier: courier }), spec, {});
    var html = transporteDocsGradeMontar_(abasMemoria, spec.ordem.map(function(titulo) {
      return { aba: titulo, copias: spec.copias[titulo], html: folha.abas.indexOf(titulo) >= 0 ? folha.html : '' };
    }), {});
    tempos.htmlMs = Date.now() - marca;
    marca = Date.now();
    var stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMdd-HHmmss');
    var blob = HtmlService.createHtmlOutput(html).getBlob().getAs(MimeType.PDF)
      .setName('diagnostico-memoria-' + courier.toLowerCase() + '-' + stamp + '.pdf');
    tempos.conversaoMs = Date.now() - marca;
    var paginas = transporteDocsHtmlContarPaginasPdf_(blob);
    var esperadas = spec.ordem.reduce(function(acc, titulo) { return acc + spec.copias[titulo]; }, 0);
    marca = Date.now();
    var root = DriveApp.getRootFolder();
    var pastas = root.getFoldersByName(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
    var pasta = pastas.hasNext() ? pastas.next() : root.createFolder(TRANSPORTE_DOCS_HTML_PASTA_DIAGNOSTICO_);
    var arquivoPdf = pasta.createFile(blob);
    tempos.driveMs = Date.now() - marca;
    if (paginas !== esperadas) avisos.push('PAGINAS_DIFERENTES');
    pdf = { paginas: paginas, paginasEsperadas: esperadas, bytes: blob.getBytes().length, fileName: arquivoPdf.getName(), fileUrl: arquivoPdf.getUrl() };
  } else {
    avisos.push('COURIER_SEM_FORMATO_HTML');
  }
  tempos.totalMs = Date.now() - inicio;

  var resultado = {
    ok: divergentes === 0 && !avisos.length,
    courier: courier,
    abas: spec.ordem.length,
    celulasDivergentes: divergentes,
    comparacao: comparacao,
    hashReal: transportePdfManifestoHash_(conteudoReal),
    hashMemoria: transportePdfManifestoHash_(conteudoMemoria),
    avisos: avisos,
    pdf: pdf,
    tempos: tempos
  };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}

/* ---------- Modo sombra na geracao real (fase 3) ----------
 * Chamado pelo botao "Gerar PDF (HTML)" depois de gerar o PDF pela grade: repete o
 * preenchimento na planilha em memoria com o mesmo registro e compara o texto impresso, apos
 * as mesmas protecoes. Nao altera o PDF entregue e nunca interrompe a geracao: qualquer erro
 * vira so um resumo no log. O resumo tem contagens, titulos de aba, enderecos (A1) e, em
 * caso de erro, a mensagem truncada; nunca valores de celula.
 */
var TRANSPORTE_LAYOUTS_SOMBRA_MAX_ENDERECOS_ = 10;

function transporteDocsDadosSombra_(registro, spec, ss, courier, conteudoReal) {
  var inicio = Date.now();
  var resumo = { ok: false, courier: '', divergentes: 0, abas: {} };
  try {
    resumo.courier = transporteNormalizeCourierFromCodex_(courier);
    var contexto = transporteDocsGradeContextoProtecao_(ss, resumo.courier, registro);
    var dados = transporteDocsDados_(registro);
    var conteudoMemoria = transporteDocsGradeProtegerConteudo_(dados.abas(spec.ordem), contexto);
    var comparacao = transporteLayoutsCompararConteudo_(conteudoReal, conteudoMemoria);
    Object.keys(comparacao).forEach(function(aba) {
      var c = comparacao[aba];
      var n = c.divergentes + (c.ausente ? 1 : 0);
      resumo.divergentes += n;
      if (n) resumo.abas[aba] = { divergentes: c.divergentes, ausente: c.ausente, enderecos: c.enderecos.slice(0, TRANSPORTE_LAYOUTS_SOMBRA_MAX_ENDERECOS_) };
    });
    resumo.hashIgual = transportePdfManifestoHash_(conteudoReal) === transportePdfManifestoHash_(conteudoMemoria);
    resumo.ok = resumo.divergentes === 0 && resumo.hashIgual;
  } catch (e) {
    resumo.erro = String(e && e.message || e).slice(0, 160);
  }
  resumo.ms = Date.now() - inicio;
  return resumo;
}

/* ---------- Diagnostico em lote com envios anteriores (administradores) ----------
 * Executar no editor: diagnosticarDocsDadosLoteTransporteHtml() ou, para escolher o recorte,
 * diagnosticarDocsDadosLoteTransporteHtml({ meses: 3, limite: 8, pular: 0, couriers: ['DHL', 'PINEX'] }).
 * couriers (opcional) restringe a selecao a parte das couriers com PDF em HTML.
 * Reconstroi envios ja feitos a partir da Agenda (eventos com AWB nos ultimos meses, das
 * couriers com PDF em HTML), como a tela da Agenda monta o Transporte, e compara dois caminhos
 * com o mesmo registro:
 * - rotinas atuais sobre uma COPIA TEMPORARIA da planilha de Transporte (privada, no Meu Drive,
 *   na lixeira ao final) lida pela grade, como o botao "Gerar PDF (HTML)";
 * - a planilha em memoria (transporteDocsDados_).
 * Isolamento: nada e gravado na Agenda (status, AWB, materiais, caixa), nao ha reserva de AWB,
 * rascunho, e-mail, monitor de courier nem PDF; a planilha de Transporte real fica bloqueada
 * durante os preenchimentos. A copia e reaproveitada entre os envios, como a planilha real.
 * O log e o retorno tem so ID do agendamento, slot, courier, mes, contagens, enderecos (A1) e
 * tempos; nunca valores de celula.
 */
var TRANSPORTE_LAYOUTS_LOTE_ORCAMENTO_MS_ = 270000;

function transporteLayoutsDataIso_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// Couriers do filtro (nomes normalizados), so entre as com PDF em HTML; sem filtro, todas elas.
function transporteLayoutsLoteCouriers_(filtro) {
  var lista = Array.isArray(filtro) ? filtro : (filtro ? String(filtro).split(/[,;]/) : []);
  var escolhidas = lista.map(function(c) { return transporteNormalizeCourierFromCodex_(String(c || '').trim()); }).filter(Boolean);
  if (!escolhidas.length) return TRANSPORTE_DOCS_GRADE_COURIERS_HTML_.slice();
  var invalidas = escolhidas.filter(function(c) { return TRANSPORTE_DOCS_GRADE_COURIERS_HTML_.indexOf(c) < 0; });
  if (invalidas.length) {
    throw new Error('Courier sem PDF em HTML no filtro: ' + invalidas.join(', ') + '. Use: ' + TRANSPORTE_DOCS_GRADE_COURIERS_HTML_.join(', ') + '.');
  }
  return escolhidas;
}

// Envios das couriers escolhidas (padrao: todas com PDF em HTML), com AWB, entre `meses` atras
// e ontem, mais recentes primeiro.
function transporteLayoutsLoteEnvios_(rows, hoje, meses, couriers) {
  couriers = couriers || TRANSPORTE_DOCS_GRADE_COURIERS_HTML_;
  var de = transporteLayoutsDataIso_(new Date(hoje.getFullYear(), hoje.getMonth() - meses, hoje.getDate()));
  var ate = transporteLayoutsDataIso_(hoje);
  var envios = [];
  rows.forEach(function(row, i) {
    if (!String(row[AGENDA_CFG.idx.id] || '').trim()) return;
    var evento = agendaRowToObject_(row, i + 2);
    if (!evento.dataIso || evento.dataIso < de || evento.dataIso >= ate) return;
    ['1', '2', '3', '4'].forEach(function(slot) {
      var c = evento['courier' + slot] || {};
      var courier = transporteNormalizeCourierFromCodex_(c.nome);
      if (couriers.indexOf(courier) < 0 || !String(c.awb || '').trim()) return;
      envios.push({ linha: i, slot: slot, courier: courier, dataIso: evento.dataIso, id: evento.id });
    });
  });
  envios.sort(function(a, b) { return a.dataIso < b.dataIso ? 1 : (a.dataIso > b.dataIso ? -1 : 0); });
  return envios;
}

// Registro preparado como salvarTransporteInterno_ faz, sem gravar na Agenda nem reservar AWB.
function transporteLayoutsLoteRegistro_(rows, item, participantes, ss) {
  var evento = agendaRowToObject_(rows[item.linha], item.linha + 2);
  evento.transporteOrigens = {};
  evento.transporteDatasColeta = transporteDatasColetaAgenda_(rows, rows[item.linha], item.slot, evento.transporteOrigens);
  var payload = montarPayloadTransporteCodex({ agenda: evento, slot: item.slot, idAgenda: evento.id });
  var opcoes = { obrigatorio: false, participantes: participantes, adiarProjetoDisplay: true };
  payload = transporteAtualizarRegistroPorAgenda_(payload, evento, opcoes);
  payload = transporteDerivarDadosParticipante_(payload, opcoes);
  payload.protocolo = transporteProjetoDisplay_(payload.protocolo || '');
  payload.caixaTransporte = transporteCaixaResolver_(ss, payload);
  payload.caixaTransporte.confirmado = true;
  if (transporteNormalizeCourierFromCodex_(payload.courier) === 'MARKEN' && transporteNormalizeTemperaturaFromCodex_(payload.temperatura) === 'AMBIENTE') {
    payload.solicitarCaixa = transporteCaixaBioSystem_(payload) ? 'Sim' : 'Não';
  }
  return transporteRegistroPreparado_(payload);
}

// CacheService em memoria: o layout da copia temporaria nao vai para o cache do script.
function transporteLayoutsCacheMemoria_() {
  var itens = {};
  function tem(k) { return Object.prototype.hasOwnProperty.call(itens, k); }
  return {
    get: function(k) { return tem(k) ? itens[k] : null; },
    getAll: function(ks) { var out = {}; ks.forEach(function(k) { if (tem(k)) out[k] = itens[k]; }); return out; },
    put: function(k, v) { itens[k] = v; },
    putAll: function(obj) { Object.keys(obj).forEach(function(k) { itens[k] = obj[k]; }); }
  };
}

// Preenche a copia com as rotinas atuais e le o texto impresso pela grade.
function transporteLayoutsLoteGrade_(copia, registro, spec, contexto, cache) {
  var peticao = transporteGetSheet_(copia, 'peticaoAnuencia', false);
  transporteEscreverCamposModelos_(copia, registro, transporteMateriaisNote_('', registro, peticao));
  transportePrepararDocumentosModelos_(copia, registro);
  transporteAjustarVolumesDeclaracao_(transporteGetSheet_(copia, 'declaracaoTransp', false), true);
  // A grade e lida pela API do Sheets: as formulas da copia precisam estar recalculadas.
  SpreadsheetApp.flush();
  var carregado = transporteDocsGradeCarregar_(copia, spec.ordem, { cache: cache });
  return transporteDocsGradeProtegerConteudo_(carregado.abas, contexto);
}

// Compara um envio do lote; r recebe o resultado (sem valores de celula).
function transporteLayoutsLoteComparar_(r, rows, item, participantes, copia, arquivo, cache) {
  var t0 = Date.now();
  var registro = transporteLayoutsLoteRegistro_(rows, item, participantes, copia);
  var spec = transportePdfSpec_(registro.courier, registro.temperatura || '', registro.destino || '', copia);
  var contexto = transporteDocsGradeContextoProtecao_(copia, item.courier, registro);
  var avisosAnteriores = TRANSPORTE_GENERATION_WARNINGS_;
  var avisos = [];
  var real;
  TRANSPORTE_GENERATION_WARNINGS_ = avisos;
  TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_++;
  try {
    real = transporteLayoutsLoteGrade_(copia, registro, spec, contexto, cache);
  } finally {
    TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_--;
    TRANSPORTE_GENERATION_WARNINGS_ = avisosAnteriores;
  }
  r.gradeMs = Date.now() - t0;
  if (avisos.length) r.avisosRotinasAtuais = avisos.map(function(a) { return a.code; });
  var t1 = Date.now();
  var memoria = transporteDocsGradeProtegerConteudo_(transporteDocsDados_(registro, { arquivo: arquivo }).abas(spec.ordem), contexto);
  r.memoriaMs = Date.now() - t1;
  var comparacao = transporteLayoutsCompararConteudo_(real, memoria);
  r.abas = spec.ordem.length;
  r.divergentes = 0;
  Object.keys(comparacao).forEach(function(aba) {
    var c = comparacao[aba];
    var n = c.divergentes + (c.ausente ? 1 : 0);
    r.divergentes += n;
    if (n) (r.porAba || (r.porAba = {}))[aba] = { divergentes: c.divergentes, ausente: c.ausente, enderecos: c.enderecos.slice(0, TRANSPORTE_LAYOUTS_SOMBRA_MAX_ENDERECOS_) };
  });
  r.hashIgual = transportePdfManifestoHash_(real) === transportePdfManifestoHash_(memoria);
  r.ok = r.divergentes === 0 && r.hashIgual;
}

function diagnosticarDocsDadosLoteTransporteHtml(opcoes) {
  codexAssertAdmin_();
  // No editor, Executar passa um objeto de evento: so um objeto com estas chaves conta.
  opcoes = opcoes && typeof opcoes === 'object' && !opcoes.authMode ? opcoes : {};
  var meses = Number(opcoes.meses) > 0 ? Number(opcoes.meses) : 3;
  var limite = Number(opcoes.limite) > 0 ? Number(opcoes.limite) : 8;
  var pular = Number(opcoes.pular) > 0 ? Number(opcoes.pular) : 0;
  var couriers = transporteLayoutsLoteCouriers_(opcoes.couriers);
  var inicio = Date.now();
  var agenda = getAgendaSheet_();
  var ultimaLinha = agenda.getLastRow();
  var rows = ultimaLinha > 1 ? agenda.getRange(2, 1, ultimaLinha - 1, AGENDA_CFG.lastCol).getValues() : [];
  var envios = transporteLayoutsLoteEnvios_(rows, new Date(), meses, couriers);
  var selecionados = envios.slice(pular, pular + limite);
  var participantes = transporteReadParticipantesDireto_();
  var arquivo = transporteLayoutsCarregar_();
  var origem = DriveApp.getFileById(getTransporteSpreadsheetCodex_().getId());
  var cache = transporteLayoutsCacheMemoria_();
  var resultados = [];
  var copiaArquivo = null;
  var limpeza = 'nao criada';
  try {
    copiaArquivo = origem.makeCopy('IPS-TEMP-DIAG-' + Utilities.getUuid(), DriveApp.getRootFolder());
    copiaArquivo.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    var copia = SpreadsheetApp.openById(copiaArquivo.getId());
    selecionados.forEach(function(item) {
      var r = { idAgenda: item.id, slot: item.slot, courier: item.courier, mes: item.dataIso.slice(0, 7) };
      resultados.push(r);
      if (Date.now() - inicio > TRANSPORTE_LAYOUTS_LOTE_ORCAMENTO_MS_) { r.pulado = 'tempo'; return; }
      try {
        transporteLayoutsLoteComparar_(r, rows, item, participantes, copia, arquivo, cache);
      } catch (e) {
        r.ok = false;
        r.erro = String(e && e.message || e).slice(0, 160);
      }
    });
  } finally {
    if (copiaArquivo) {
      try { copiaArquivo.setTrashed(true); limpeza = 'lixeira'; } catch (eLimpeza) { limpeza = 'FALHOU: mova IPS-TEMP-DIAG-* do Meu Drive para a lixeira'; }
    }
  }
  var processados = resultados.filter(function(r) { return !r.pulado; });
  var resultado = {
    ok: processados.length > 0 && processados.every(function(r) { return r.ok; }),
    couriers: couriers,
    encontrados: envios.length,
    processados: processados.length,
    iguais: processados.filter(function(r) { return r.ok; }).length,
    comDivergencia: processados.filter(function(r) { return r.divergentes > 0; }).length,
    comErro: processados.filter(function(r) { return r.erro; }).length,
    proximoPular: pular + processados.length < envios.length ? pular + processados.length : null,
    copiaTemporaria: limpeza,
    totalMs: Date.now() - inicio,
    envios: resultados
  };
  Logger.log(JSON.stringify(resultado));
  return resultado;
}

// Atalhos para o editor (Executar nao aceita argumentos): so as couriers indicadas.
function diagnosticarDocsDadosLoteTransporteHtmlDhlPinex() {
  return diagnosticarDocsDadosLoteTransporteHtml({ couriers: ['DHL', 'PINEX'] });
}

function diagnosticarDocsDadosLoteTransporteHtmlDhl() {
  return diagnosticarDocsDadosLoteTransporteHtml({ couriers: ['DHL'] });
}

function diagnosticarDocsDadosLoteTransporteHtmlPinex() {
  return diagnosticarDocsDadosLoteTransporteHtml({ couriers: ['PINEX'] });
}
