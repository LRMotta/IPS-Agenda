/**
 * Geracao dos documentos de um envio a partir do registro (passo "Gerar" da tela nova).
 *
 * Sequencia: posse e versao -> validacoes sem efeito -> AWB (lock curto) -> Agenda (lock curto) ->
 * documentos em memoria, PDF no Drive e rascunho no Gmail, FORA do lock e com recuperacao por token
 * -> Transporte_Operacoes e status da Agenda (locks curtos) -> passo "enviar".
 * Nao abre a planilha de Transporte. Ver docs/TRANSPORTE_LOCK_POR_ENVIO.md.
 */

function transporteEnvioCeStatus_(protocolo) {
  protocolo = String(protocolo || '').trim();
  if (!protocolo) return { checked: false, found: false, message: 'Protocolo não selecionado.' };
  try {
    var arquivo = transporteComunicadoEspecialDaExecucao_(transporteEnvioSsVazio_(), protocolo);
    if (arquivo) return { checked: true, found: true, message: 'CE localizada para o estudo.', name: arquivo.getName(), url: arquivo.getUrl() };
  } catch (erro) {
    Logger.log('CE nao consultada: ' + String(erro && erro.message || erro));
  }
  return { checked: true, found: false, message: 'CE não localizada para o estudo.' };
}

/**
 * Rascunho do e-mail da courier a partir do registro (mesmas regras de criarRascunhoEmail_).
 * opcoes: { requestedByEmail, temperaturaPdf, monitorRef, pdfHash, generationRequestId, pdfFileId }.
 * Nunca lanca por falha de Gmail: devolve { ok:false, ... } para a tela oferecer "Tentar de novo".
 */
function transporteEnvioCriarRascunho_(registro, opcoes) {
  try {
    var guard = transporteAssertGmailDraftAllowed_({ requestedByEmail: opcoes.requestedByEmail || '', agendadoPor: registro.agendadoPor });
    if (!guard.ok) return guard;
    var email = transporteEmailDoRegistro_(registro, { temperaturaPdf: opcoes.temperaturaPdf });
    if (email.semRascunho) {
      return { ok: email.ok, skipped: email.ok, message: email.motivo, error: email.erro || '', userEmail: guard.userEmail, activeUserEmail: guard.activeUserEmail, requestedByEmail: guard.requestedByEmail };
    }
    var courier = registro.courier;
    var remetente = transporteActiveUserEmail_();
    var cc = transporteCaixaCopias_(transporteDraftCcRecipients_(remetente), email.caixaPayload);
    var anexos = (transporteIsDhl_(courier) || courier === 'PINEX (Agendamento)') ? []
      : transporteCodexEmailAttachments_(transporteEnvioSsVazio_(), transporteProjetoDisplay_(registro.protocolo));
    if (courier === 'PINEX (Agendamento)' && opcoes.pdfFileId) {
      try { anexos.push(DriveApp.getFileById(opcoes.pdfFileId).getBlob()); } catch (erroPdf) { Logger.log('PDF PINEX nao anexado ao rascunho.'); }
    }
    var corpo = transporteCodexFixMojibakeText_(transporteCodexEmailWrap_(email.html + '<p>Atenciosamente,</p>') + getGmailSignature() +
      transporteMonitorRefHtml_(opcoes.monitorRef, opcoes.pdfHash, opcoes.generationRequestId));
    var draftOptions = { htmlBody: corpo, attachments: anexos };
    if (cc.length) draftOptions.cc = cc.join(', ');
    transporteGenerationCheckpoint_({ phase: 'DRAFT_INTENT' });
    var rascunho = GmailApp.createDraft(email.destinatarios.join(', '), email.assunto, '', draftOptions);
    var draftId = '';
    try { draftId = rascunho && rascunho.getId ? String(rascunho.getId() || '') : ''; } catch (erroId) { draftId = ''; }
    if (!draftId) throw new Error('Rascunho criado sem confirmação do ID. Confira o Gmail.');
    var resultado = { ok: true, draftId: draftId, temperaturaPdf: email.temperaturaPdf || '', message: 'Rascunho criado com sucesso! Preserve a referência IPS-TRP no corpo ao enviar.',
      subject: email.assunto, recipients: email.destinatarios.join(', '), userEmail: guard.userEmail, activeUserEmail: guard.activeUserEmail, requestedByEmail: guard.requestedByEmail };
    transporteGenerationCheckpoint_({ phase: 'DRAFT_READY', draft: resultado });
    return resultado;
  } catch (erro) {
    Logger.log('Erro ao criar rascunho do envio: ' + String(erro && erro.message || erro));
    return { ok: false, message: 'Erro ao criar rascunho: ' + String(erro && erro.message || erro), error: erro && erro.code ? erro.code : 'DRAFT_FAILED' };
  }
}

// Documentos em memoria -> PDF no Drive. Reaproveita o PDF ja confirmado quando o token o trouxe.
function transporteEnvioGerarPdf_(registro, request, usuario) {
  var courier = registro.courier;
  var temperatura = transporteNormalizeTemperaturaFromCodex_(registro.temperatura);
  if (request.record.pdf && request.record.pdf.fileId) return Object.assign({}, request.record.pdf, { reaproveitado: true });
  var docs = transporteDocsDados_(registro);
  var spec = transportePdfSpec_(courier, temperatura, registro.destino, docs.ss);
  if (!spec.ordem.length) throw new Error('Courier sem configuração de PDF: ' + courier);
  if (TRANSPORTE_DOCS_GRADE_COURIERS_HTML_.indexOf(transporteNormalizeCourierFromCodex_(courier)) < 0) {
    throw new Error('O PDF em HTML ainda não está disponível para a courier ' + courier + '.');
  }
  var nome = transportePdfFileName_(registro.awb, transporteParseDate_(registro.dataEnvio), temperatura, courier, '');
  var pasta = transportePdfDestinationFolder_(registro.protocolo);
  var gerado = transporteDocsGradeGerarPdfHtml_(docs.ss, spec, courier, registro, nome, docs);
  var conteudoHash = transportePdfManifestoHash_(gerado.conteudo);
  transporteGenerationCheckpoint_({ phase: 'PDF_INTENT' });
  var arquivo = pasta.createFile(gerado.blob);
  var pdfId = arquivo.getId();
  var pdf = {
    ok: true, type: 'pdf', fileId: pdfId, fileName: gerado.blob.getName(), courier: courier, conteudoPdfHash: conteudoHash,
    temperaturaPdf: temperatura, generationRequestId: request.record.generationRequestId || '',
    fileUrl: 'https://drive.google.com/file/d/' + encodeURIComponent(pdfId) + '/view',
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(pdfId),
    message: 'PDF gerado no Drive: ' + gerado.blob.getName(), folderUrl: pasta.getUrl(), folderName: pasta.getName(),
    warnings: [{ code: 'PDF_RECOVERY_PARTIAL', message: 'PDF recuperado após interrupção. Confira o compartilhamento no Drive e a CE antes do envio.' }]
  };
  transporteGenerationCheckpoint_({ phase: 'PDF_READY', pdf: pdf });
  pdf.driveAccess = transporteShareGeneratedPdfWithActiveUser_(arquivo, pasta);
  pdf.warnings = [];
  return pdf;
}

/**
 * RPC do passo "Gerar". versao: a do registro na tela. generationRequestId: token (32 hex) por tentativa;
 * repetir o mesmo token retoma sem duplicar PDF ou rascunho.
 */
function gerarDocumentosTransporteEnvio(agendaId, slot, versao, generationRequestId) {
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  var posse = transporteEnvioReivindicar_(agendaId, slot, usuario);
  if (!posse.ok) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_EM_PREPARO', 'Este transporte está sendo preparado por outra pessoa agora.', { emPreparoPor: posse.emPreparoPor });
  var lido = transporteRegistroLer_(agendaId, slot);
  if (!lido.registro) throw new Error('Abra o envio antes de gerar os documentos.');
  if (lido.versao !== Number(versao)) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_VERSAO', 'Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.');
  var registro = JSON.parse(JSON.stringify(lido.registro));
  if (registro.caixaTransporte) registro.caixaTransporte.confirmado = true;
  // Validacoes sem efeito externo, antes de qualquer AWB, arquivo ou rascunho.
  transporteValidarObrigatoriosWebApp_(registro);
  transporteValidarDataEnvioMinima_(registro.dataEnvio);
  codexMatBioValidateTransportPayload_(registro);
  // O token identifica os DADOS do envio: o numero do passo muda a cada gravacao e nao entra no hash.
  var dadosDoToken = JSON.parse(JSON.stringify(registro));
  delete dadosDoToken.passoNumero;
  var request = transporteGenerationBegin_({ generationRequestId: generationRequestId, payload: dadosDoToken, criarRascunho: true, requestedByEmail: usuario });
  request.record.generationRequestId = String(generationRequestId || '');
  TRANSPORTE_GENERATION_REQUEST_ = request;
  TRANSPORTE_GENERATION_WARNINGS_ = [];
  try {
    var repetido = transporteGenerationReplay_(request.record);
    if (repetido) return Object.assign({ ok: true }, repetido);
    // AWB e Agenda: escritas curtas, em lock, antes de qualquer arquivo.
    transporteAwbReservarEnvio_(agendaId, slot, usuario, { strict: true });
    codexWithDocumentLock_('transporteEnvioSincronizarAgenda', function() { return transporteSincronizarAgenda_(registro); });
    var pdf = transporteEnvioGerarPdf_(registro, request, usuario);
    var temperaturaPdf = transporteNormalizeTemperaturaFromCodex_(registro.temperatura);
    var docHash = transportePdfManifestoHash_({ dados: transporteGenerationCanonical_(registro), conteudo: pdf.conteudoPdfHash });
    var monitorRef = transporteMonitorReferencia_(registro.idAgenda, registro.agendaSlot);
    var rascunho = request.record.draft || transporteEnvioCriarRascunho_(registro, {
      requestedByEmail: usuario, temperaturaPdf: temperaturaPdf, monitorRef: monitorRef, pdfHash: docHash,
      generationRequestId: generationRequestId, pdfFileId: pdf.fileId
    });
    var resultado = Object.assign({}, pdf, {
      draftOk: !!rascunho.ok, draftId: rascunho.draftId || '', draftError: rascunho.ok ? '' : String(rascunho.message || rascunho.error || ''),
      draftSkipped: !!rascunho.skipped, draftMessage: rascunho.message || '', monitorRef: monitorRef, manifestoPdfHash: docHash,
      ce: transporteEnvioCeStatus_(registro.protocolo)
    });
    // Documentacao registrada para o monitor de e-mails (PINEX e Backup nao promovem status).
    if (monitorRef && transporteNormalizeCourierFromCodex_(registro.courier) !== 'PINEX') {
      try {
        resultado.monitorRegistro = transporteOperacaoRegistrarEnvio_({
          agendaId: registro.idAgenda, slot: registro.agendaSlot, courier: registro.courier, geradoPor: usuario, pdfId: pdf.fileId,
          pdfNome: pdf.fileName, pdfHash: docHash, awbDocumento: registro.awb, temperaturaPdf: temperaturaPdf,
          generationRequestId: generationRequestId, rascunhoId: rascunho.draftId || '', rascunhoOk: !!rascunho.ok, rascunhoErro: rascunho.ok ? '' : String(rascunho.message || '')
        }, usuario);
      } catch (erroMonitor) {
        resultado.monitorWarning = 'Não foi possível registrar o acompanhamento do envio: ' + String(erroMonitor && erroMonitor.message || erroMonitor);
      }
    }
    try {
      var sincronia = codexWithDocumentLock_('transporteEnvioDocsGerados', function() { return transporteMarcarDocsGeradosAgenda_(registro, pdf); });
      if (sincronia) resultado.agendaSync = sincronia;
    } catch (erroAgenda) {
      resultado.agendaWarning = 'Documentos gerados, mas o status da Agenda não foi atualizado: ' + String(erroAgenda && erroAgenda.message || erroAgenda);
    }
    // Envio internacional: o proximo passo e o formulario ANVISA; o e-mail a courier so depois da GRU e do extrato.
    var proximoPasso = transporteEnvioInternacional_(registro) && !registro.peticionamentoEnviadoEm ? 'anvisa' : 'enviar';
    registro.passoNumero = transporteEnvioNumeroPasso_(registro, proximoPasso);
    var gravado = transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: lido.versao, usuario: usuario, passo: proximoPasso });
    resultado.versao = gravado.versao;
    resultado.passo = proximoPasso;
    if (rascunho.ok || rascunho.skipped) transporteGenerationCheckpoint_({ phase: 'COMPLETE', result: resultado, pdf: null, draft: null });
    return Object.assign({ ok: true }, resultado);
  } finally {
    TRANSPORTE_GENERATION_REQUEST_ = null;
    TRANSPORTE_GENERATION_WARNINGS_ = null;
  }
}

/** "Pronto, enviei": encerra o preparo do envio. O monitor existente reconhece o envio pelo Gmail. */
function concluirEnvioTransporte(agendaId, slot, versao) {
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  var lido = transporteRegistroLer_(agendaId, slot);
  // PINEX, fase 1: o Formulario foi enviado; agora o transporte aguarda a resposta da PINEX com os numeros.
  if (lido.registro && lido.registro.fasePinex === 'agendamento') {
    if (lido.versao !== Number(versao)) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_VERSAO', 'Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.');
    var aguardando = Object.assign({}, lido.registro, { fasePinex: 'resposta' });
    aguardando.passoNumero = transporteEnvioNumeroPasso_(aguardando, 'pinex_numeros');
    var gravado = transporteRegistroGravar_(agendaId, slot, aguardando, { versaoEsperada: lido.versao, usuario: usuario, passo: 'pinex_numeros' });
    transporteEnvioLiberar_(agendaId, slot, usuario);
    return { ok: true, versao: gravado.versao, aguardaPinex: true };
  }
  var resposta = salvarTransporteEnvio(agendaId, slot, versao, {}, 'concluido');
  transporteEnvioLiberar_(agendaId, slot, usuario);
  return { ok: true, versao: resposta.versao };
}

/** "Sair e continuar depois": guarda o passo e libera o preparo para a outra pessoa poder assumir. */
function sairEnvioTransporte(agendaId, slot, versao, passo) {
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  var resposta = salvarTransporteEnvio(agendaId, slot, versao, {}, passo);
  transporteEnvioLiberar_(agendaId, slot, usuario);
  return { ok: true, versao: resposta.versao, passo: resposta.passo };
}
