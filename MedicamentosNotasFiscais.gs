// Notas fiscais dos medicamentos recebidos.
// Agrupa os itens de "💊 Medicamentos" por NF + remetente, registra o Movimento RM uma vez por nota,
// guarda o PDF digitalizado no Drive e prepara (rascunho, nunca envio) o e-mail com as notas e movimentos.
// Os itens continuam na aba de origem; a aba Medicamentos_NF guarda apenas PDF e situação de cada nota.

var MED_NF_SHEET_NAME_ = 'Medicamentos_NF';
var MED_NF_HEADERS_ = [
  'Chave_NF', 'Nota_Fiscal', 'Remetente', 'PDF_ID', 'PDF_Nome', 'PDF_Anexado_Em', 'PDF_Anexado_Por',
  'Email_Preparado_Em', 'Email_Preparado_Por', 'Rascunho_ID', 'Enviada_Manual_Em', 'Enviada_Manual_Por'
];
var MED_NF_CC_FIXO_ = 'ips@ucs.br';
var MED_NF_ASSUNTO_ = 'IPS - NOTAS FISCAIS - REMESSA MEDICAMENTOS';
var MED_NF_PASTA_PADRAO_ = 'IPS - Notas fiscais de medicamentos';
var MED_NF_PDF_MAX_BYTES_ = 10 * 1024 * 1024;
// O Gmail limita a mensagem a 25 MB já codificada em base64 (+33%); 18 MB de anexos cabem com folga.
var MED_NF_EMAIL_MAX_BYTES_ = 18 * 1024 * 1024;
var MED_NF_DESTINATARIOS_PROP_ = 'MED_NF_ULTIMOS_DESTINATARIOS';

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

// medRows: linhas de dados de "💊 Medicamentos" (sem cabeçalho); metaRows: linhas de Medicamentos_NF.
function medNfAgrupar_(medRows, metaRows) {
  var meta = medNfMetaPorChave_(metaRows);
  var grupos = {};
  var ordem = [];
  (medRows || []).forEach(function(r, idx) {
    var chave = medNfChave_(r[4], r[5]);
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
      var data = r[1] instanceof Date ? r[1].getTime() : 0;
      var dataAtual = maisRecente.values[1] instanceof Date ? maisRecente.values[1].getTime() : 0;
      if (data > dataAtual) maisRecente = linha;
      var projeto = medNfTexto_(r[2]);
      if (projeto && projetos.indexOf(projeto) < 0) projetos.push(projeto);
      var movimento = medNfTexto_(r[6]);
      if (!movimento) rmPendente = true;
      else if (movimentos.indexOf(movimento) < 0) movimentos.push(movimento);
    });
    var m = meta[chave] ? meta[chave].values : [];
    var nota = {
      chave: chave,
      notaFiscal: medNfTexto_(maisRecente.values[4]),
      remetente: medNfTexto_(maisRecente.values[5]),
      projetos: projetos,
      dataRecebimento: fmtEquipDate_(maisRecente.values[1]),
      dataRecebimentoISO: fmtEquipISO_(maisRecente.values[1]),
      itens: linhas.map(function(linha) {
        var r = linha.values;
        return { descricao: medNfTexto_(r[7]), quantidade: r[8] === '' || r[8] === null ? '' : r[8], lote: medNfTexto_(r[9]) };
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

function medNfLerMedicamentos_(ss) {
  var sh = getMedicamentosSheet_(ss, true);
  if (!sh || sh.getLastRow() < 2) return { sheet: sh, rows: [] };
  return { sheet: sh, rows: sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues() };
}

function medNfLerMeta_(ss) {
  var sh = ss.getSheetByName(MED_NF_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return { sheet: sh, rows: [] };
  return { sheet: sh, rows: sh.getRange(2, 1, sh.getLastRow() - 1, MED_NF_HEADERS_.length).getValues() };
}

function medNfLerNotas_(ss) {
  return medNfAgrupar_(medNfLerMedicamentos_(ss).rows, medNfLerMeta_(ss).rows);
}

function medNfUltimosDestinatarios_() {
  try {
    return String(PropertiesService.getUserProperties().getProperty(MED_NF_DESTINATARIOS_PROP_) || '');
  } catch (e) {
    return '';
  }
}

function getMedicamentosNotasFiscais() {
  codexAssertCanRead_();
  return {
    notas: medNfLerNotas_(getCodexSpreadsheet_()),
    copiaFixa: MED_NF_CC_FIXO_,
    ultimosDestinatarios: medNfUltimosDestinatarios_()
  };
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

// Grava campos de Medicamentos_NF para várias notas em uma única escrita. Chamar dentro do document lock.
function medNfGravarMeta_(ss, notas, campos) {
  var sh = ss.getSheetByName(MED_NF_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(MED_NF_SHEET_NAME_);
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

function salvarMovimentoRmNotaFiscal(payload) {
  payload = payload || {};
  var chave = medNfChavesPayload_({ chaves: [payload.chave] })[0];
  codexAssertCanWrite_('salvarMovimentoRmNotaFiscal', 'Cadastros', chave);
  var movimento = medNfTexto_(payload.movimentoRm);
  if (!movimento) throw new Error('Informe o número do movimento no RM.');
  if (movimento.length > 40) throw new Error('O número do movimento deve ter no máximo 40 caracteres.');
  var esperado = medNfTexto_(payload.movimentosAtuais);
  return codexWithDocumentLock_('salvarMovimentoRmNotaFiscal', function() {
    var ss = getCodexSpreadsheet_();
    var lidos = medNfLerMedicamentos_(ss);
    var nota = medNfNotasSelecionadas_(medNfAgrupar_(lidos.rows, []), [chave])[0];
    // Outra pessoa pode ter informado o movimento depois que a lista foi carregada.
    if (nota.movimentos.join(' / ') !== esperado) throw new Error('O movimento desta nota mudou. Atualize a lista antes de salvar.');
    var linhas = [];
    lidos.rows.forEach(function(r, idx) { if (medNfChave_(r[4], r[5]) === chave) linhas.push(idx + 2); });
    // Duas RangeLists: os itens de uma NF não são contíguos na aba.
    lidos.sheet.getRangeList(linhas.map(function(row) { return 'D' + row; })).setValue('Sim');
    lidos.sheet.getRangeList(linhas.map(function(row) { return 'G' + row; })).setValue(movimento);
    return { ok: true, itens: linhas.length, message: 'Movimento ' + movimento + ' registrado na NF ' + nota.notaFiscal + '.' };
  });
}

function medNfPastaId_(valor) {
  valor = medNfTexto_(valor);
  var url = valor.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (url) return url[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(valor) ? valor : '';
}

// Pasta compartilhada configurável em Config_App (grupo Medicamentos, chave "Pasta das notas fiscais").
// Sem configuração, usa uma pasta no Meu Drive de quem anexa.
function medNfPastaDestino_() {
  var configurada = getConfigAppValuesByKeys_(['Medicamentos'], ['Pasta das notas fiscais'], [])[0] || '';
  var id = medNfPastaId_(configurada);
  if (configurada && !id) throw new Error('A pasta das notas fiscais configurada é inválida. Revise a Configuração.');
  if (id) return DriveApp.getFolderById(id);
  var root = DriveApp.getRootFolder();
  var pastas = root.getFoldersByName(MED_NF_PASTA_PADRAO_);
  return pastas.hasNext() ? pastas.next() : root.createFolder(MED_NF_PASTA_PADRAO_);
}

function medNfNomeArquivo_(nota) {
  return ('NF ' + nota.notaFiscal + ' - ' + nota.remetente).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) + '.pdf';
}

function anexarPdfNotaFiscal(payload) {
  payload = payload || {};
  var chave = medNfChavesPayload_({ chaves: [payload.chave] })[0];
  codexAssertCanWrite_('anexarPdfNotaFiscal', 'Cadastros', chave);
  var conteudo = String(payload.conteudoBase64 || '');
  if (!conteudo) throw new Error('Selecione o arquivo PDF da nota fiscal.');
  if (conteudo.length > Math.ceil(MED_NF_PDF_MAX_BYTES_ / 3) * 4 + 4) throw new Error('O PDF deve ter no máximo 10 MB.');
  var bytes = Utilities.base64Decode(conteudo);
  if (!bytes.length || bytes.length > MED_NF_PDF_MAX_BYTES_) throw new Error('O PDF deve ter no máximo 10 MB.');
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') throw new Error('O arquivo selecionado não é um PDF.');
  var ss = getCodexSpreadsheet_();
  var nota = medNfNotasSelecionadas_(medNfLerNotas_(ss), [chave])[0];
  var arquivo = medNfPastaDestino_().createFile(Utilities.newBlob(bytes, 'application/pdf', medNfNomeArquivo_(nota)));
  var usuario = getUsuarioEmail();
  return codexWithDocumentLock_('anexarPdfNotaFiscal', function() {
    medNfGravarMeta_(ss, [nota], {
      PDF_ID: arquivo.getId(),
      PDF_Nome: arquivo.getName(),
      PDF_Anexado_Em: new Date(),
      PDF_Anexado_Por: usuario
    });
    return { ok: true, pdfId: arquivo.getId(), message: 'PDF anexado à NF ' + nota.notaFiscal + '.' };
  });
}

function marcarNotasFiscaisEnviadas(payload) {
  var chaves = medNfChavesPayload_(payload);
  codexAssertCanWrite_('marcarNotasFiscaisEnviadas', 'Cadastros', chaves.join(','));
  var usuario = getUsuarioEmail();
  return codexWithDocumentLock_('marcarNotasFiscaisEnviadas', function() {
    var ss = getCodexSpreadsheet_();
    var notas = medNfNotasSelecionadas_(medNfLerNotas_(ss), chaves);
    var semMovimento = notas.filter(function(nota) { return nota.rmPendente; });
    if (semMovimento.length) throw new Error('Informe o movimento RM antes de marcar como enviada: NF ' + semMovimento.map(function(n) { return n.notaFiscal; }).join(', ') + '.');
    medNfGravarMeta_(ss, notas, { Enviada_Manual_Em: new Date(), Enviada_Manual_Por: usuario });
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

function medNfCorpoEmailHtml_(notas, assinatura) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' +
    '<p>Olá,</p>' +
    '<p>Segue em anexo as notas fiscais de medicamentos recebidos no IPS e seus respectivos números de movimento no RM.</p>' +
    '<p>' + medNfLinhasEmail_(notas).map(escHtmlServer_).join('<br>') + '</p>' +
    '<p>Atenciosamente,</p>' +
    (assinatura ? '<div>' + assinatura + '</div>' : '') +
    '</div>';
}

function medNfCorpoEmailTexto_(notas) {
  return ['Olá,', '', 'Segue em anexo as notas fiscais de medicamentos recebidos no IPS e seus respectivos números de movimento no RM.', '']
    .concat(medNfLinhasEmail_(notas), ['', 'Atenciosamente,']).join('\n');
}

function prepararEmailNotasFiscais(payload) {
  payload = payload || {};
  var chaves = medNfChavesPayload_(payload);
  codexAssertCanWrite_('prepararEmailNotasFiscais', 'Cadastros', chaves.join(','));
  var destinatarios = medNfDestinatarios_(payload.destinatarios);
  var ss = getCodexSpreadsheet_();
  var notas = medNfNotasSelecionadas_(medNfLerNotas_(ss), chaves);
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
  var rascunho = GmailApp.createDraft(destinatarios.join(', '), MED_NF_ASSUNTO_, medNfCorpoEmailTexto_(notas), {
    htmlBody: medNfCorpoEmailHtml_(notas, getGmailSignature()),
    cc: MED_NF_CC_FIXO_,
    attachments: anexos
  });
  var draftId = '';
  try { draftId = String(rascunho.getId() || ''); } catch (e) { draftId = ''; }
  try {
    PropertiesService.getUserProperties().setProperty(MED_NF_DESTINATARIOS_PROP_, destinatarios.join(', '));
  } catch (e) {
    // Preferência de conveniência: a falha não desfaz o rascunho já criado.
  }
  var usuario = getUsuarioEmail();
  codexWithDocumentLock_('prepararEmailNotasFiscais', function() {
    medNfGravarMeta_(ss, notas, { Email_Preparado_Em: new Date(), Email_Preparado_Por: usuario, Rascunho_ID: draftId });
  });
  return {
    ok: true,
    draftId: draftId,
    quantidade: notas.length,
    message: 'Rascunho criado no Gmail com ' + notas.length + (notas.length === 1 ? ' nota fiscal' : ' notas fiscais') + '. Revise e envie pelo Gmail.'
  };
}
