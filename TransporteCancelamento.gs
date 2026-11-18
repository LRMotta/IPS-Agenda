/**
 * Cancelamento de transporte confirmado (tela nova de Transporte, aba "Confirmadas").
 *
 * Fluxo: a tela pede a previa (conversa, destinatarios e texto sugerido); a pessoa confirma na caixa; o servidor
 * responde a todos na ultima mensagem da conversa sobre o transporte e grava "Cancelado" no status do transporte.
 * So status Confirmado, de hoje em diante; "Coletado" fica fora (a amostra ja saiu).
 * O e-mail sai da caixa do Gmail de quem confirma: a conversa precisa estar nela.
 */
var TRANSPORTE_CANCELAMENTO_BUSCA_DIAS_ = 120;

function transporteCancelamentoSlot_(slot) {
  slot = String(slot || '').trim();
  var achado = TRANSPORTE_TAREFAS_SLOTS_.filter(function(s) { return s[0] === slot; })[0];
  return achado ? { slot: achado[0], rotulo: achado[1], cfg: AGENDA_CFG.idx[achado[2]] } : null;
}

// Status que pode ser cancelado por esta tela: Confirmado (nao "Coletado", que tambem e chave 'confirmado').
function transporteCancelamentoStatusPermitido_(statusTexto) {
  return AgendaServerRules_.courierStatusKey(statusTexto) === 'confirmado' && normText_(statusTexto).indexOf('colet') < 0;
}

/**
 * Dados do transporte na linha da Agenda (valores exibidos). Devolve { erro } quando nao pode ser cancelado.
 * hoje: Date (meia-noite local) para comparar a data do envio.
 */
function transporteCancelamentoDadosLinha_(row, slotInfo, hoje) {
  var i = AGENDA_CFG.idx;
  var c = slotInfo.cfg;
  var dados = {
    agendaId: String(row[i.id] || '').trim(), slot: slotInfo.slot, slotRotulo: slotInfo.rotulo,
    courier: String(row[c.nome] || '').trim(), status: String(row[c.status] || '').trim(),
    awb: String(row[c.awb] || '').trim(), temperatura: String(row[c.temp] || '').trim(), destino: String(row[c.destino] || '').trim(),
    data: String(row[i.data] || '').trim(), hora: String(row[i.hora] || '').trim(),
    participante: String(row[i.participante] || '').trim(), projeto: String(row[i.projeto] || '').trim(), visita: String(row[i.visita] || '').trim()
  };
  if (AgendaServerRules_.isCancelled(normText_(row[i.status]))) return { erro: 'O agendamento foi cancelado. Atualize a lista.' };
  if (!isCourierNomeValidoAgenda_(dados.courier)) return { erro: 'Este transporte não tem courier.' };
  if (!transporteCancelamentoStatusPermitido_(dados.status)) {
    return { conflito: true, erro: 'O status deste transporte não é mais "Confirmado" (agora: ' + (dados.status || 'vazio') + '). Atualize a lista.' };
  }
  var data = parseAgendaDateAny_(row[i.data]);
  if (!data) return { erro: 'A data deste envio não é válida na Agenda.' };
  data.setHours(0, 0, 0, 0);
  if (data.getTime() < hoje.getTime()) return { erro: 'A data deste envio já passou: não há coleta a cancelar.' };
  return dados;
}

function transporteCancelamentoTextoPadrao_(dados) {
  var quando = dados.data + (dados.hora ? ', às ' + dados.hora : '');
  return 'Prezados,\n\nSolicitamos o cancelamento da coleta agendada para ' + quando + (dados.awb ? ' (AWB ' + dados.awb + ')' : '') +
    '. Pedimos, por gentileza, que desconsiderem a solicitação anterior e confirmem o cancelamento em resposta a este e-mail.\n\nAtenciosamente,';
}

// Marcador no rodape: comprova o envio e evita repetir o e-mail ao tentar de novo.
function transporteCancelamentoMarcador_(agendaId, slot) {
  return 'Cancelamento IPS: ' + agendaId + ':' + slot;
}

// Destinatarios de "responder a todos": remetente, Para e Cc, sem a propria conta.
function transporteCancelamentoDestinatarios_(mensagem, own) {
  var de = courierLembreteEmails_(mensagem.getFrom());
  var para = courierLembreteEmails_(mensagem.getTo() + ',' + mensagem.getCc());
  var todos = (own.indexOf(de[0]) >= 0 ? [] : de).concat(para);
  return todos.filter(function(email, n) { return own.indexOf(email) < 0 && todos.indexOf(email) === n; });
}

/**
 * Ultima mensagem sobre o transporte na caixa de quem confirma: a conversa do pedido de coleta (Gmail_Message_ID
 * do monitor) e as conversas que citam a referencia IPS ou a AWB. Vale a mais recente cujo "responder a todos"
 * chega a um endereco da courier cadastrado. Sem nenhuma, devolve { erro }.
 */
function transporteCancelamentoConversa_(dados, operacoes, config) {
  var referencia = transporteMonitorReferencia_(dados.agendaId, dados.slot);
  var marcador = transporteCancelamentoMarcador_(dados.agendaId, dados.slot);
  var conta = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var own = [conta].concat(GmailApp.getAliases().map(function(s) { return String(s).toLowerCase(); }));
  var couriers = courierLembreteEnderecosCourier_(config);
  if (!couriers.length) return { erro: 'A courier ' + dados.courier + ' não tem e-mail cadastrado. Cancele pelo Gmail.' };
  var threads = {};
  (operacoes || []).forEach(function(op) {
    if (op.agendaId !== dados.agendaId || String(op.slot) !== dados.slot || !op.gmailMessageId) return;
    try {
      var t = GmailApp.getMessageById(op.gmailMessageId).getThread();
      threads[t.getId()] = t;
    } catch (e) {
      // Pedido enviado de outra caixa: segue pela busca.
    }
  });
  var termos = ['"' + referencia + '"'].concat(dados.awb ? ['"' + dados.awb.replace(/"/g, '') + '"'] : []);
  GmailApp.search('{' + termos.join(' ') + '} newer_than:' + TRANSPORTE_CANCELAMENTO_BUSCA_DIAS_ + 'd', 0, 10).forEach(function(t) { threads[t.getId()] = t; });
  var melhor = null;
  var jaEnviado = null;
  Object.keys(threads).forEach(function(id) {
    threads[id].getMessages().forEach(function(m) {
      if (m.isDraft() || m.isInTrash()) return;
      if (own.indexOf(courierLembreteEmails_(m.getFrom())[0]) >= 0 && String(m.getPlainBody() || '').indexOf(marcador) >= 0) {
        if (!jaEnviado || m.getDate() > jaEnviado.getDate()) jaEnviado = m;
        return;
      }
      var destinatarios = transporteCancelamentoDestinatarios_(m, own);
      if (!destinatarios.some(function(email) { return couriers.indexOf(email) >= 0; })) return;
      if (!melhor || m.getDate() > melhor.mensagem.getDate()) melhor = { mensagem: m, destinatarios: destinatarios };
    });
  });
  if (jaEnviado) return { jaEnviado: jaEnviado, own: own };
  if (!melhor) {
    return { erro: 'Não encontrei, no seu Gmail, a conversa deste transporte com a ' + dados.courier + '. Cancele pelo Gmail e mude o status na Agenda.' };
  }
  return { mensagem: melhor.mensagem, destinatarios: melhor.destinatarios, own: own };
}

function transporteCancelamentoConfig_(courier) {
  var lista = getAgendaCourierRows_().filter(function(c) { return normText_(c.nome) === normText_(courier); });
  return lista.length === 1 ? lista[0] : null;
}

function transporteCancelamentoLerLinha_(agendaId, sheet) {
  var linha = encontrarLinhaPorId(sheet, agendaId);
  if (!linha) return null;
  return { linha: linha, row: sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getDisplayValues()[0] };
}

function transporteCancelamentoHoje_() {
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return hoje;
}

/** Previa da caixa de confirmacao. Somente leitura (sem lock). */
function getTransporteCancelamento(agendaId, slot) {
  codexAssertAdmin_();
  agendaId = String(agendaId || '').trim();
  var slotInfo = transporteCancelamentoSlot_(slot);
  if (!agendaId || !slotInfo) return { erro: 'Transporte não informado.' };
  var lido = transporteCancelamentoLerLinha_(agendaId, getAgendaSheetForRead_());
  if (!lido) return { erro: 'Agendamento não encontrado.' };
  var dados = transporteCancelamentoDadosLinha_(lido.row, slotInfo, transporteCancelamentoHoje_());
  if (dados.erro) return dados;
  var config = transporteCancelamentoConfig_(dados.courier);
  if (!config) return { erro: 'Courier ' + dados.courier + ' não encontrada no cadastro de couriers.' };
  var conversa = transporteCancelamentoConversa_(dados, transporteOperacoesRows_(), config);
  if (conversa.erro) return { erro: conversa.erro, dados: dados };
  if (conversa.jaEnviado) {
    return { ok: true, jaEnviado: true, dados: dados, enviadoEm: conversa.jaEnviado.getDate().toISOString(), assunto: String(conversa.jaEnviado.getSubject() || '') };
  }
  var m = conversa.mensagem;
  return {
    ok: true, dados: dados, mensagemId: m.getId(), assunto: String(m.getSubject() || ''), de: String(m.getFrom() || ''),
    recebidaEm: m.getDate().toISOString(), destinatarios: conversa.destinatarios, texto: transporteCancelamentoTextoPadrao_(dados)
  };
}

// Corpo da resposta: texto da pessoa, assinatura do Gmail, rodape discreto e historico citado.
function transporteCancelamentoCorpo_(texto, dados, original) {
  var referencia = transporteMonitorReferencia_(dados.agendaId, dados.slot);
  var rodape = 'Ref. IPS: ' + referencia + '\n' + transporteCancelamentoMarcador_(dados.agendaId, dados.slot);
  var assinaturaHtml = courierLembreteAssinaturaHtml_();
  var assinatura = courierLembreteHtmlToPlain_(assinaturaHtml);
  var plano = texto + (assinatura ? '\n' + assinatura : '') + '\n\n' + rodape + courierLembreteOriginalTexto_(original);
  var html = courierLembreteEscapeHtml_(texto) + (assinaturaHtml ? '<br>' + assinaturaHtml : '') +
    '<div style="margin-top:14px;font-size:9px;line-height:1.2;color:#9aa0a6">' + courierLembreteEscapeHtml_(rodape) + '</div>';
  var options = { htmlBody: html };
  var htmlOriginal = String(original.getBody() || '').trim();
  var historico = null;
  try {
    historico = htmlOriginal ? courierLembreteHistoricoHtml_(original, htmlOriginal) : null;
  } catch (e) {
    // Imagem do historico nao recuperavel: cita o texto simples, sem bloquear o cancelamento.
    historico = null;
  }
  if (historico) {
    var cabecalho = courierLembreteOriginalTexto_(original).split('\n\n').slice(0, 2).join('\n\n');
    options.htmlBody += courierLembreteEscapeHtml_(cabecalho + '\n\n') +
      '<blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">' + historico.html + '</blockquote>';
    if (Object.keys(historico.inlineImages).length) options.inlineImages = historico.inlineImages;
  } else {
    options.htmlBody += courierLembreteEscapeHtml_(courierLembreteOriginalTexto_(original));
  }
  return { plano: plano, options: options };
}

/**
 * Envia o pedido de cancelamento (responder a todos na mensagem da previa) e grava "Cancelado" no transporte.
 * mensagemId: a mensagem mostrada na caixa; se chegou outra depois, pede para reabrir. O texto e sempre o padrao
 * (transporteCancelamentoTextoPadrao_), montado aqui: nada do texto vem do navegador.
 */
function cancelarTransporteConfirmado(agendaId, slot, mensagemId) {
  codexAssertAdmin_();
  codexAssertCanWrite_('cancelarTransporteConfirmado', 'Agenda', agendaId);
  agendaId = String(agendaId || '').trim();
  mensagemId = String(mensagemId || '').trim();
  var slotInfo = transporteCancelamentoSlot_(slot);
  if (!agendaId || !slotInfo) return { erro: 'Transporte não informado.' };
  // Conversa e destinatarios fora do lock (Gmail); a Agenda e revalidada dentro dele.
  var previa = transporteCancelamentoLerLinha_(agendaId, getAgendaSheetForRead_());
  if (!previa) return { erro: 'Agendamento não encontrado.' };
  var dadosPrevia = transporteCancelamentoDadosLinha_(previa.row, slotInfo, transporteCancelamentoHoje_());
  if (dadosPrevia.erro) return dadosPrevia;
  var config = transporteCancelamentoConfig_(dadosPrevia.courier);
  if (!config) return { erro: 'Courier ' + dadosPrevia.courier + ' não encontrada no cadastro de couriers.' };
  var conversa = transporteCancelamentoConversa_(dadosPrevia, transporteOperacoesRows_(), config);
  if (conversa.erro) return { erro: conversa.erro };
  if (!conversa.jaEnviado && conversa.mensagem.getId() !== mensagemId) {
    return { conflito: true, erro: 'Chegou um e-mail novo nesta conversa. Abra o cancelamento de novo para responder à mensagem mais recente.' };
  }
  var corpo = conversa.jaEnviado ? null : transporteCancelamentoCorpo_(transporteCancelamentoTextoPadrao_(dadosPrevia), dadosPrevia, conversa.mensagem);
  return codexWithDocumentLock_('cancelarTransporteConfirmado', function() {
    var agenda = getAgendaSheet_();
    var atual = transporteCancelamentoLerLinha_(agendaId, agenda);
    if (!atual) return { erro: 'Agendamento não encontrado.' };
    var dados = transporteCancelamentoDadosLinha_(atual.row, slotInfo, transporteCancelamentoHoje_());
    if (dados.erro) return dados;
    if (dados.status !== dadosPrevia.status || normalizarAwbCourier_(dados.awb) !== normalizarAwbCourier_(dadosPrevia.awb) || normText_(dados.courier) !== normText_(dadosPrevia.courier)) {
      return { conflito: true, erro: 'O transporte mudou enquanto a caixa estava aberta. Atualize a lista.' };
    }
    var enviadoId = '';
    if (corpo) {
      // Falha no envio: nada foi gravado na Agenda.
      CodexExternalEffects_.replyAll(conversa.mensagem, corpo.plano, corpo.options);
      enviadoId = conversa.mensagem.getId();
    }
    agenda.getRange(atual.linha, slotInfo.cfg.status + 1).setValue('Cancelado');
    codexWriteAuditChanges_('Agenda', 'cancelarTransporteConfirmado', agendaId, [{
      field: slotInfo.rotulo + ' - Status', oldValue: dados.status, newValue: 'Cancelado'
    }], (corpo ? 'Cancelamento pedido à courier por e-mail (resposta à mensagem ' + enviadoId + ')' : 'Cancelamento já enviado à courier nesta conversa') +
      (dados.awb ? ' | AWB ' + dados.awb : ''));
    // Persistir sob lock antes de invalidar o cache da janela da Agenda (mesmo padrao de confirmarEntregaTransportePendencia).
    SpreadsheetApp.flush();
    agendaInvalidateWindowCache_();
    return { ok: true, agendaId: agendaId, slot: slotInfo.slot, status: 'Cancelado', emailEnviado: !!corpo, jaEnviado: !corpo };
  });
}
