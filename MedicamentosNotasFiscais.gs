// Notas fiscais dos materiais recebidos (Cadastro | Medicamentos e Cadastro | Equipamentos).
// Agrupa os itens de cada aba por NF + remetente, registra o Movimento RM uma vez por nota,
// guarda o PDF digitalizado no Drive e prepara (rascunho, nunca envio) o e-mail com as notas e movimentos.
// Os itens continuam na aba de origem; Medicamentos_NF e Equipamentos_NF guardam apenas PDF e situação de cada nota.

var MED_NF_SHEET_NAME_ = 'Medicamentos_NF';
var MED_NF_HEADERS_ = [
  'Chave_NF', 'Nota_Fiscal', 'Remetente', 'PDF_ID', 'PDF_Nome', 'PDF_Anexado_Em', 'PDF_Anexado_Por',
  'Email_Preparado_Em', 'Email_Preparado_Por', 'Rascunho_ID', 'Enviada_Manual_Em', 'Enviada_Manual_Por'
];
var MED_NF_CC_FIXO_ = 'ips@ucs.br';
var MED_NF_ASSUNTO_ = 'IPS - NOTAS FISCAIS - REMESSA MEDICAMENTOS';
var MED_NF_PASTA_PADRAO_ = 'IPS - Notas fiscais de medicamentos';
var MED_NF_PASTA_PROP_ = 'MED_NF_PASTA_ID';
var MED_NF_PDF_MAX_BYTES_ = 10 * 1024 * 1024;
// O Gmail limita a mensagem a 25 MB já codificada em base64 (+33%); 18 MB de anexos cabem com folga.
var MED_NF_EMAIL_MAX_BYTES_ = 18 * 1024 * 1024;
var MED_NF_DESTINATARIOS_PROP_ = 'MED_NF_ULTIMOS_DESTINATARIOS';

var EQP_NF_SHEET_NAME_ = 'Equipamentos_NF';
var EQP_NF_ASSUNTO_ = 'IPS - NOTAS FISCAIS - REMESSA EQUIPAMENTOS';
var EQP_NF_PASTA_PADRAO_ = 'IPS - Notas fiscais de equipamentos';
var EQP_NF_PASTA_PROP_ = 'EQP_NF_PASTA_ID';
var EQP_NF_DESTINATARIOS_PROP_ = 'EQP_NF_ULTIMOS_DESTINATARIOS';

// Colunas (base 0) de cada aba de origem. "identificador" é o lote (medicamentos) ou o n° de série (equipamentos).
var MED_NF_TIPOS_ = {
  medicamentos: {
    lerAba: function(ss) { return getMedicamentosSheet_(ss, true); },
    totalColunas: 16,
    col: { data: 1, projeto: 2, registroRm: 3, notaFiscal: 4, remetente: 5, movimento: 6, descricao: 7, quantidade: 8, identificador: 9 },
    campoIdentificador: 'lote',
    abaControle: MED_NF_SHEET_NAME_,
    assunto: MED_NF_ASSUNTO_,
    material: 'medicamentos',
    configGrupo: 'Medicamentos',
    pastaPadrao: MED_NF_PASTA_PADRAO_,
    pastaProp: MED_NF_PASTA_PROP_,
    destinatariosProp: MED_NF_DESTINATARIOS_PROP_
  },
  equipamentos: {
    lerAba: function(ss) { return getEquipamentosSheet_(ss, true); },
    totalColunas: 18,
    col: { data: 1, projeto: 2, registroRm: 4, notaFiscal: 5, remetente: 6, movimento: 7, descricao: 9, quantidade: 10, identificador: 11 },
    campoIdentificador: 'serie',
    abaControle: EQP_NF_SHEET_NAME_,
    assunto: EQP_NF_ASSUNTO_,
    material: 'equipamentos',
    configGrupo: 'Equipamentos',
    pastaPadrao: EQP_NF_PASTA_PADRAO_,
    pastaProp: EQP_NF_PASTA_PROP_,
    destinatariosProp: EQP_NF_DESTINATARIOS_PROP_
  }
};

// Sem tipo, vale Medicamentos (contrato original das RPCs). Tipo desconhecido é recusado.
function medNfTipo_(tipo) {
  var nome = tipo == null || tipo === '' ? 'medicamentos' : String(tipo);
  if (!Object.prototype.hasOwnProperty.call(MED_NF_TIPOS_, nome)) throw new Error('Tipo de nota fiscal inválido.');
  return MED_NF_TIPOS_[nome];
}

function medNfNumero_(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '').replace(/^0+/, '');
}

// Primeira palavra do remetente, sem acentos e sem sigla inicial ("ISP- Innovative ..." = "Innovative ...").
// Absorve variações de digitação do mesmo remetente e separa NFs de mesmo número de remetentes diferentes.
function medNfRemetenteChave_(valor) {
  var texto = String(valor == null ? '' : valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  texto = texto.replace(/^\s*[A-Z]{2,5}\s*-\s*(?=[A-Z])/, '');
  return texto.replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')[0] || '';
}

function medNfChave_(notaFiscal, remetente) {
  var numero = medNfNumero_(notaFiscal);
  return numero ? numero + '|' + medNfRemetenteChave_(remetente) : '';
}

function medNfChaveLinha_(r, cfg) {
  return medNfChave_(r[cfg.col.notaFiscal], r[cfg.col.remetente]);
}

function medNfTexto_(valor) {
  return String(valor == null ? '' : valor).trim();
}

function medNfMetaPorChave_(metaRows) {
  var mapa = {};
  (metaRows || []).forEach(function(row, idx) {
    var chave = medNfTexto_(row[0]);
    if (chave) mapa[chave] = { values: row, rowIndex: idx + 2 };
  });
  return mapa;
}

function medNfSituacao_(nota) {
  if (nota.emailPreparadoEm || nota.enviadaManualEm) return 'concluida';
  if (nota.rmPendente) return 'rm_pendente';
  if (!nota.pdfId) return 'falta_pdf';
  return 'pronta';
}

// rows: linhas de dados da aba de origem (sem cabeçalho); metaRows: linhas da aba de controle do tipo.
function medNfAgrupar_(rows, metaRows, cfg) {
  cfg = cfg || medNfTipo_();
  var c = cfg.col;
  var meta = medNfMetaPorChave_(metaRows);
  var grupos = {};
  var ordem = [];
  (rows || []).forEach(function(r, idx) {
    var chave = medNfChaveLinha_(r, cfg);
    if (!chave) return;
    if (!grupos[chave]) {
      grupos[chave] = { chave: chave, linhas: [] };
      ordem.push(chave);
    }
    grupos[chave].linhas.push({ rowIndex: idx + 2, values: r });
  });
  return ordem.map(function(chave) {
    var linhas = grupos[chave].linhas;
    var maisRecente = linhas[0];
    var projetos = [];
    var movimentos = [];
    var rmPendente = false;
    linhas.forEach(function(linha) {
      var r = linha.values;
      var data = r[c.data] instanceof Date ? r[c.data].getTime() : 0;
      var dataAtual = maisRecente.values[c.data] instanceof Date ? maisRecente.values[c.data].getTime() : 0;
      if (data > dataAtual) maisRecente = linha;
      var projeto = medNfTexto_(r[c.projeto]);
      if (projeto && projetos.indexOf(projeto) < 0) projetos.push(projeto);
      var movimento = medNfTexto_(r[c.movimento]);
      if (!movimento) rmPendente = true;
      else if (movimentos.indexOf(movimento) < 0) movimentos.push(movimento);
    });
    var m = meta[chave] ? meta[chave].values : [];
    var nota = {
      chave: chave,
      notaFiscal: medNfTexto_(maisRecente.values[c.notaFiscal]),
      remetente: medNfTexto_(maisRecente.values[c.remetente]),
      projetos: projetos,
      dataRecebimento: fmtEquipDate_(maisRecente.values[c.data]),
      dataRecebimentoISO: fmtEquipISO_(maisRecente.values[c.data]),
      itens: linhas.map(function(linha) {
        var r = linha.values;
        var item = { descricao: medNfTexto_(r[c.descricao]), quantidade: r[c.quantidade] === '' || r[c.quantidade] === null ? '' : r[c.quantidade] };
        item[cfg.campoIdentificador] = medNfTexto_(r[c.identificador]);
        return item;
      }),
      movimentos: movimentos,
      movimentoRm: movimentos.length === 1 && !rmPendente ? movimentos[0] : '',
      movimentosDivergentes: movimentos.length > 1,
      rmPendente: rmPendente,
      pdfId: medNfTexto_(m[3]),
      pdfNome: medNfTexto_(m[4]),
      pdfAnexadoEm: fmtEquipDate_(m[5], 'dd/MM/yyyy HH:mm'),
      pdfAnexadoPor: medNfTexto_(m[6]),
      emailPreparadoEm: fmtEquipDate_(m[7], 'dd/MM/yyyy HH:mm'),
      emailPreparadoPor: medNfTexto_(m[8]),
      enviadaManualEm: fmtEquipDate_(m[10], 'dd/MM/yyyy HH:mm'),
      enviadaManualPor: medNfTexto_(m[11])
    };
    nota.situacao = medNfSituacao_(nota);
    return nota;
  }).sort(function(a, b) {
    return String(b.dataRecebimentoISO || '').localeCompare(String(a.dataRecebimentoISO || '')) ||
      String(a.notaFiscal).localeCompare(String(b.notaFiscal));
  });
}

function medNfLerItens_(ss, cfg) {
  var sh = cfg.lerAba(ss);
  if (!sh || sh.getLastRow() < 2) return { sheet: sh, rows: [] };
  return { sheet: sh, rows: sh.getRange(2, 1, sh.getLastRow() - 1, cfg.totalColunas).getValues() };
}

function medNfLerMeta_(ss, cfg) {
  var sh = ss.getSheetByName(cfg.abaControle);
  if (!sh || sh.getLastRow() < 2) return { sheet: sh, rows: [] };
  return { sheet: sh, rows: sh.getRange(2, 1, sh.getLastRow() - 1, MED_NF_HEADERS_.length).getValues() };
}

function medNfLerNotas_(ss, cfg) {
  return medNfAgrupar_(medNfLerItens_(ss, cfg).rows, medNfLerMeta_(ss, cfg).rows, cfg);
}

function medNfUltimosDestinatarios_(cfg) {
  try {
    return String(PropertiesService.getUserProperties().getProperty(cfg.destinatariosProp) || '');
  } catch (e) {
    return '';
  }
}

function medNfListar_(cfg) {
  codexAssertCanRead_();
  return {
    notas: medNfLerNotas_(getCodexSpreadsheet_(), cfg),
    copiaFixa: MED_NF_CC_FIXO_,
    ultimosDestinatarios: medNfUltimosDestinatarios_(cfg)
  };
}

function getMedicamentosNotasFiscais() {
  return medNfListar_(medNfTipo_('medicamentos'));
}

function getEquipamentosNotasFiscais() {
  return medNfListar_(medNfTipo_('equipamentos'));
}

function medNfChavesPayload_(payload) {
  var chaves = (payload && payload.chaves) || [];
  if (!Array.isArray(chaves) || !chaves.length) throw new Error('Selecione ao menos uma nota fiscal.');
  if (chaves.length > 200) throw new Error('Selecione no máximo 200 notas fiscais por vez.');
  var vistas = {};
  return chaves.map(function(chave) {
    chave = medNfTexto_(chave);
    if (!/^\d+\|[A-Z0-9]*$/.test(chave)) throw new Error('Nota fiscal inválida. Atualize a lista.');
    return chave;
  }).filter(function(chave) {
    if (vistas[chave]) return false;
    vistas[chave] = true;
    return true;
  });
}

function medNfNotasSelecionadas_(notas, chaves) {
  var porChave = {};
  notas.forEach(function(nota) { porChave[nota.chave] = nota; });
  return chaves.map(function(chave) {
    if (!porChave[chave]) throw new Error('Uma das notas fiscais não foi encontrada. Atualize a lista.');
    return porChave[chave];
  });
}

// Grava campos da aba de controle para várias notas em uma única escrita. Chamar dentro do document lock.
function medNfGravarMeta_(ss, notas, campos, cfg) {
  cfg = cfg || medNfTipo_();
  var sh = ss.getSheetByName(cfg.abaControle);
  if (!sh) {
    sh = ss.insertSheet(cfg.abaControle);
    sh.getRange(1, 1, 1, MED_NF_HEADERS_.length).setValues([MED_NF_HEADERS_.slice()]);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, MED_NF_HEADERS_.length).setValues([MED_NF_HEADERS_.slice()]);
  }
  var lidos = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, MED_NF_HEADERS_.length).getValues() : [];
  var meta = medNfMetaPorChave_(lidos);
  notas.forEach(function(nota) {
    var existente = meta[nota.chave];
    var row = existente ? existente.values : MED_NF_HEADERS_.map(function() { return ''; });
    row[0] = nota.chave;
    row[1] = nota.notaFiscal;
    row[2] = nota.remetente;
    Object.keys(campos).forEach(function(header) {
      var col = MED_NF_HEADERS_.indexOf(header);
      if (col < 3) throw new Error('Campo de nota fiscal desconhecido: ' + header);
      row[col] = campos[header];
    });
    if (!existente) {
      lidos.push(row);
      meta[nota.chave] = { values: row, rowIndex: lidos.length + 1 };
    }
  });
  if (lidos.length) sh.getRange(2, 1, lidos.length, MED_NF_HEADERS_.length).setValues(lidos);
}

// Letra da coluna (base 0) para a notação A1; as abas de origem têm menos de 26 colunas.
function medNfLetraColuna_(col) {
  return String.fromCharCode(65 + col);
}

function salvarMovimentoRmNotaFiscal(payload) {
  payload = payload || {};
  var cfg = medNfTipo_(payload.tipo);
  var chave = medNfChavesPayload_({ chaves: [payload.chave] })[0];
  codexAssertCanWrite_('salvarMovimentoRmNotaFiscal', 'Cadastros', chave);
  var movimento = medNfTexto_(payload.movimentoRm);
  if (!movimento) throw new Error('Informe o número do movimento no RM.');
  if (movimento.length > 40) throw new Error('O número do movimento deve ter no máximo 40 caracteres.');
  var esperado = medNfTexto_(payload.movimentosAtuais);
  return codexWithDocumentLock_('salvarMovimentoRmNotaFiscal', function() {
    var ss = getCodexSpreadsheet_();
    var lidos = medNfLerItens_(ss, cfg);
    var nota = medNfNotasSelecionadas_(medNfAgrupar_(lidos.rows, [], cfg), [chave])[0];
    // Outra pessoa pode ter informado o movimento depois que a lista foi carregada.
    if (nota.movimentos.join(' / ') !== esperado) throw new Error('O movimento desta nota mudou. Atualize a lista antes de salvar.');
    var linhas = [];
    lidos.rows.forEach(function(r, idx) { if (medNfChaveLinha_(r, cfg) === chave) linhas.push(idx + 2); });
    var colRm = medNfLetraColuna_(cfg.col.registroRm);
    var colMov = medNfLetraColuna_(cfg.col.movimento);
    // Duas RangeLists: os itens de uma NF não são contíguos na aba.
    lidos.sheet.getRangeList(linhas.map(function(row) { return colRm + row; })).setValue('Sim');
    lidos.sheet.getRangeList(linhas.map(function(row) { return colMov + row; })).setValue(movimento);
    return { ok: true, itens: linhas.length, message: 'Movimento ' + movimento + ' registrado na NF ' + nota.notaFiscal + '.' };
  });
}

function medNfPastaId_(valor) {
  valor = medNfTexto_(valor);
  var url = valor.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (url) return url[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(valor) ? valor : '';
}

// Pasta compartilhada do tipo: Config_App (grupo do tipo, chave "Pasta das notas fiscais") ou, na falta dela,
// a propriedade do script do tipo (MED_NF_PASTA_ID / EQP_NF_PASTA_ID, com ID ou link da pasta).
// Sem nenhuma, usa uma pasta no Meu Drive de quem anexa.
function medNfPastaDestino_(cfg) {
  cfg = cfg || medNfTipo_();
  var configurada = getConfigAppValuesByKeys_([cfg.configGrupo], ['Pasta das notas fiscais'], [])[0] ||
    PropertiesService.getScriptProperties().getProperty(cfg.pastaProp) || '';
  var id = medNfPastaId_(configurada);
  if (configurada && !id) throw new Error('A pasta das notas fiscais configurada é inválida. Revise a Configuração.');
  if (id) return DriveApp.getFolderById(id);
  var root = DriveApp.getRootFolder();
  var pastas = root.getFoldersByName(cfg.pastaPadrao);
  return pastas.hasNext() ? pastas.next() : root.createFolder(cfg.pastaPadrao);
}

function medNfNomeArquivo_(nota) {
  return ('NF ' + nota.notaFiscal + ' - ' + nota.remetente).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) + '.pdf';
}

function anexarPdfNotaFiscal(payload) {
  payload = payload || {};
  var cfg = medNfTipo_(payload.tipo);
  var chave = medNfChavesPayload_({ chaves: [payload.chave] })[0];
  codexAssertCanWrite_('anexarPdfNotaFiscal', 'Cadastros', chave);
  var conteudo = String(payload.conteudoBase64 || '');
  if (!conteudo) throw new Error('Selecione o arquivo PDF da nota fiscal.');
  if (conteudo.length > Math.ceil(MED_NF_PDF_MAX_BYTES_ / 3) * 4 + 4) throw new Error('O PDF deve ter no máximo 10 MB.');
  var bytes = Utilities.base64Decode(conteudo);
  if (!bytes.length || bytes.length > MED_NF_PDF_MAX_BYTES_) throw new Error('O PDF deve ter no máximo 10 MB.');
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') throw new Error('O arquivo selecionado não é um PDF.');
  var ss = getCodexSpreadsheet_();
  var nota = medNfNotasSelecionadas_(medNfLerNotas_(ss, cfg), [chave])[0];
  var arquivo = medNfPastaDestino_(cfg).createFile(Utilities.newBlob(bytes, 'application/pdf', medNfNomeArquivo_(nota)));
  var usuario = getUsuarioEmail();
  return codexWithDocumentLock_('anexarPdfNotaFiscal', function() {
    medNfGravarMeta_(ss, [nota], {
      PDF_ID: arquivo.getId(),
      PDF_Nome: arquivo.getName(),
      PDF_Anexado_Em: new Date(),
      PDF_Anexado_Por: usuario
    }, cfg);
    return { ok: true, pdfId: arquivo.getId(), message: 'PDF anexado à NF ' + nota.notaFiscal + '.' };
  });
}

function marcarNotasFiscaisEnviadas(payload) {
  var cfg = medNfTipo_(payload && payload.tipo);
  var chaves = medNfChavesPayload_(payload);
  codexAssertCanWrite_('marcarNotasFiscaisEnviadas', 'Cadastros', chaves.join(','));
  var usuario = getUsuarioEmail();
  return codexWithDocumentLock_('marcarNotasFiscaisEnviadas', function() {
    var ss = getCodexSpreadsheet_();
    var notas = medNfNotasSelecionadas_(medNfLerNotas_(ss, cfg), chaves);
    var semMovimento = notas.filter(function(nota) { return nota.rmPendente; });
    if (semMovimento.length) throw new Error('Informe o movimento RM antes de marcar como enviada: NF ' + semMovimento.map(function(n) { return n.notaFiscal; }).join(', ') + '.');
    medNfGravarMeta_(ss, notas, { Enviada_Manual_Em: new Date(), Enviada_Manual_Por: usuario }, cfg);
    return { ok: true, quantidade: notas.length, message: notas.length + (notas.length === 1 ? ' nota marcada como enviada.' : ' notas marcadas como enviadas.') };
  });
}

function medNfDestinatarios_(valor) {
  var lista = String(valor == null ? '' : valor).split(/[,;\s]+/).map(function(email) { return email.trim().toLowerCase(); }).filter(Boolean);
  if (!lista.length) throw new Error('Informe ao menos um destinatário.');
  if (lista.length > 20) throw new Error('Informe no máximo 20 destinatários.');
  var unicos = [];
  lista.forEach(function(email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('E-mail inválido: ' + email);
    if (email !== MED_NF_CC_FIXO_ && unicos.indexOf(email) < 0) unicos.push(email);
  });
  if (!unicos.length) throw new Error('Informe ao menos um destinatário além de ' + MED_NF_CC_FIXO_ + '.');
  return unicos;
}

function medNfLinhasEmail_(notas) {
  return notas.map(function(nota) { return 'NF ' + nota.notaFiscal + ' - Movimento ' + nota.movimentoRm; });
}

function medNfFraseEmail_(cfg) {
  return 'Segue em anexo as notas fiscais de ' + cfg.material + ' recebidos no IPS e seus respectivos números de movimento no RM.';
}

function medNfCorpoEmailHtml_(notas, assinatura, cfg) {
  cfg = cfg || medNfTipo_();
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<p>Olá,</p>' +
    '<p>' + medNfFraseEmail_(cfg) + '</p>' +
    '<p>' + medNfLinhasEmail_(notas).map(escHtmlServer_).join('<br>') + '</p>' +
    '<p>Atenciosamente,</p>' +
    (assinatura ? '<div>' + assinatura + '</div>' : '') +
    '</div>';
}

function medNfCorpoEmailTexto_(notas, cfg) {
  cfg = cfg || medNfTipo_();
  return ['Olá,', '', medNfFraseEmail_(cfg), '']
    .concat(medNfLinhasEmail_(notas), ['', 'Atenciosamente,']).join('\n');
}

function prepararEmailNotasFiscais(payload) {
  payload = payload || {};
  var cfg = medNfTipo_(payload.tipo);
  var chaves = medNfChavesPayload_(payload);
  codexAssertCanWrite_('prepararEmailNotasFiscais', 'Cadastros', chaves.join(','));
  var destinatarios = medNfDestinatarios_(payload.destinatarios);
  var ss = getCodexSpreadsheet_();
  var notas = medNfNotasSelecionadas_(medNfLerNotas_(ss, cfg), chaves);
  var incompletas = notas.filter(function(nota) { return nota.rmPendente || nota.movimentosDivergentes || !nota.pdfId; });
  if (incompletas.length) {
    throw new Error('Estas notas ainda precisam de movimento RM único e PDF: NF ' + incompletas.map(function(n) { return n.notaFiscal; }).join(', ') + '.');
  }
  var total = 0;
  var anexos = notas.map(function(nota) {
    var blob;
    try {
      blob = DriveApp.getFileById(nota.pdfId).getBlob();
    } catch (e) {
      throw new Error('Não foi possível abrir o PDF da NF ' + nota.notaFiscal + '. Confira o acesso ao arquivo ou anexe-o novamente.', { cause: e });
    }
    total += blob.getBytes().length;
    return blob.setName(('NF ' + nota.notaFiscal).replace(/[\\/:*?"<>|]+/g, ' ') + '.pdf');
  });
  if (total > MED_NF_EMAIL_MAX_BYTES_) {
    throw new Error('Os PDFs somam ' + Math.ceil(total / 1048576) + ' MB e passam do limite do Gmail. Prepare o e-mail em duas partes.');
  }
  var rascunho = GmailApp.createDraft(destinatarios.join(', '), cfg.assunto, medNfCorpoEmailTexto_(notas, cfg), {
    htmlBody: medNfCorpoEmailHtml_(notas, getGmailSignature(), cfg),
    cc: MED_NF_CC_FIXO_,
    attachments: anexos
  });
  var draftId = '';
  try { draftId = String(rascunho.getId() || ''); } catch (e) { draftId = ''; }
  try {
    PropertiesService.getUserProperties().setProperty(cfg.destinatariosProp, destinatarios.join(', '));
  } catch (e) {
    // Preferência de conveniência: a falha não desfaz o rascunho já criado.
  }
  var usuario = getUsuarioEmail();
  codexWithDocumentLock_('prepararEmailNotasFiscais', function() {
    medNfGravarMeta_(ss, notas, { Email_Preparado_Em: new Date(), Email_Preparado_Por: usuario, Rascunho_ID: draftId }, cfg);
  });
  return {
    ok: true,
    draftId: draftId,
    quantidade: notas.length,
    message: 'Rascunho criado no Gmail com ' + notas.length + (notas.length === 1 ? ' nota fiscal' : ' notas fiscais') + '. Revise e envie pelo Gmail.'
  };
}
