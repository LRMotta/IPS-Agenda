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
    // Mesmo nome de estudo do anexo do rascunho: a busca no Drive feita para o anexo serve tambem ao aviso.
    var arquivo = transporteComunicadoEspecialDaExecucao_(transporteEnvioSsVazio_(), transporteProjetoDisplay_(protocolo));
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
    // So a CE entra aqui (fora a PINEX Agendamento). 'sim'/'nao' vai para o registro: o passo Enviar diz se ela esta no
    // rascunho mesmo depois de reabrir. Valor explicito porque a reconstrucao do registro descarta campos vazios.
    var ceAnexada = courier === 'PINEX (Agendamento)' || transporteIsDhl_(courier) ? '' : (anexos.length ? 'sim' : 'nao');
    if (courier === 'PINEX (Agendamento)' && opcoes.pdfFileId) {
      try { anexos.push(DriveApp.getFileById(opcoes.pdfFileId).getBlob()); } catch (erroPdf) { Logger.log('PDF PINEX nao anexado ao rascunho.'); }
    }
    // Envio internacional: a peticao de fiscalizacao (gerada pelo app, sem assinatura) vai junto da CE.
    var peticaoAnexada = '';
    if (ceAnexada && transporteEnvioInternacional_(registro)) {
      peticaoAnexada = 'nao';
      if (opcoes.peticaoFileId) {
        try { anexos.push(DriveApp.getFileById(opcoes.peticaoFileId).getBlob()); peticaoAnexada = 'sim'; } catch (erroPeticao) { Logger.log('Peticao nao anexada ao rascunho.'); }
      }
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
      subject: email.assunto, recipients: email.destinatarios.join(', '), ceAnexada: ceAnexada, peticaoAnexada: peticaoAnexada, userEmail: guard.userEmail, activeUserEmail: guard.activeUserEmail, requestedByEmail: guard.requestedByEmail };
    transporteGenerationCheckpoint_({ phase: 'DRAFT_READY', draft: resultado });
    return resultado;
  } catch (erro) {
    Logger.log('Erro ao criar rascunho do envio: ' + String(erro && erro.message || erro));
    return { ok: false, message: 'Erro ao criar rascunho: ' + String(erro && erro.message || erro), error: erro && erro.code ? erro.code : 'DRAFT_FAILED' };
  }
}

// Documentos em memoria -> PDF no Drive. Reaproveita o PDF ja confirmado quando o token o trouxe.
function transporteEnvioGerarPdf_(registro, request, usuario, lap) {
  lap = lap || function() {};
  var courier = registro.courier;
  var temperatura = transporteNormalizeTemperaturaFromCodex_(registro.temperatura);
  if (request.record.pdf && request.record.pdf.fileId) return Object.assign({}, request.record.pdf, { reaproveitado: true });
  var docs = transporteDocsDados_(registro);
  lap('pdf_dados');
  var spec = transportePdfSpec_(courier, temperatura, registro.destino, docs.ss);
  if (!spec.ordem.length) throw new Error('Courier sem configuração de PDF: ' + courier);
  if (TRANSPORTE_DOCS_GRADE_COURIERS_HTML_.indexOf(transporteNormalizeCourierFromCodex_(courier)) < 0) {
    throw new Error('O PDF em HTML ainda não está disponível para a courier ' + courier + '.');
  }
  var nome = transportePdfFileName_(registro.awb, transporteParseDate_(registro.dataEnvio), temperatura, courier, '');
  var pasta = transportePdfDestinationFolder_(registro.protocolo);
  lap('pdf_pasta');
  var gerado = transporteDocsGradeGerarPdfHtml_(docs.ss, spec, courier, registro, nome, docs);
  lap('pdf_html');
  var conteudoHash = transportePdfManifestoHash_(gerado.conteudo);
  transporteGenerationCheckpoint_({ phase: 'PDF_INTENT' });
  var arquivo = pasta.createFile(gerado.blob);
  lap('pdf_drive');
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
  lap('pdf_compartilhar');
  pdf.warnings = [];
  return pdf;
}

/**
 * Peticao de fiscalizacao do envio internacional, salva na mesma pasta do Drive que o PDF dos documentos.
 * Repetir a geracao com o mesmo token reaproveita o arquivo. Dado faltando no cadastro nao interrompe a geracao:
 * devolve o aviso, o rascunho sai sem a peticao e o passo Enviar pede para anexa-la.
 */
function transporteEnvioGerarPeticao_(registro, request) {
  // PINEX (Agendamento) so gera o Formulario do pre-agendamento; a peticao vem com os documentos, depois dos numeros.
  if (!transporteEnvioInternacional_(registro) || registro.courier === 'PINEX (Agendamento)') return null;
  if (request.record.peticao && request.record.peticao.fileId) return request.record.peticao;
  try {
    var form = transportePeticaoGerar_(registro);
    if (!form.ok) return { erro: 'Petição de fiscalização não gerada: ' + form.erros.join(' ') };
    var arquivo = transportePdfDestinationFolder_(registro.protocolo).createFile(transportePeticaoPdfBlob_(registro, form));
    var peticao = { fileId: String(arquivo.getId()), fileName: String(arquivo.getName ? arquivo.getName() : '') };
    transporteGenerationCheckpoint_({ peticao: peticao });
    return peticao;
  } catch (erro) {
    return { erro: 'Petição de fiscalização não gerada: ' + String(erro && erro.message || erro) };
  }
}

/**
 * Grava o passo seguinte depois de PDF e rascunho prontos. Se o registro mudou de versao durante a geracao sem
 * mudar os dados dos documentos (a propria pessoa clicou em "Sair e continuar depois", por exemplo), grava sobre
 * a versao atual: a geracao nao pode terminar em erro com tudo ja feito. Dados diferentes mantem a recusa.
 */
function transporteEnvioGravarAposGerar_(agendaId, slot, registro, lido, usuario, proximoPasso) {
  try {
    return transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: lido.versao, usuario: usuario, passo: proximoPasso });
  } catch (erro) {
    if (!erro || erro.code !== 'TRANSPORTE_REGISTRO_VERSAO') throw erro;
    var atual = transporteRegistroLer_(agendaId, slot);
    if (!atual.registro || transporteEnvioDadosDocumentoMudaram_(lido.registro, atual.registro)) throw erro;
    return transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: atual.versao, usuario: usuario, passo: proximoPasso });
  }
}

/**
 * Abre (ou retoma) o registro de recuperacao da geracao. Token ausente ou invalido continua recusado.
 * Token de outros dados (o registro mudou em algo que nao reinicia o preparo, como um cadastro): a geracao
 * anterior nao serve mais e comeca outra, em vez de prender o envio no erro. Devolve { request, token }.
 */
function transporteEnvioIniciarGeracao_(token, dadosDoToken, usuario) {
  function novo() { return Utilities.getUuid().replace(/-/g, '').toLowerCase(); }
  function abrir(t) { return transporteGenerationBegin_({ generationRequestId: t, payload: dadosDoToken, criarRascunho: true, requestedByEmail: usuario }); }
  try {
    return { request: abrir(token), token: token };
  } catch (erro) {
    if (!/pertence a outros dados/.test(String(erro && erro.message || ''))) throw erro;
    token = novo();
    return { request: abrir(token), token: token };
  }
}

/**
 * Resposta da geracao para o navegador. O google.script.run entrega null quando o objeto tem um Date (a base de
 * cobranca do monitor tem): a tela voltava ao botao "Gerar" com a versao antiga, embora tudo estivesse feito.
 * A base de cobranca e interna; o resto vai como JSON puro (datas viram texto).
 */
function transporteEnvioRespostaGerar_(resposta) {
  var copia = JSON.parse(JSON.stringify(resposta));
  if (copia.monitorRegistro) delete copia.monitorRegistro.baseCobranca;
  return copia;
}

/**
 * RPC do passo "Gerar". versao: a do registro na tela. generationRequestId: token (32 hex) por tentativa;
 * repetir o mesmo token retoma sem duplicar PDF ou rascunho.
 */
function gerarDocumentosTransporteEnvio(agendaId, slot, versao, generationRequestId) {
  // Etapas no log ([CODEX_PERF] gerarDocumentosTransporteEnvio): so nome e duracao, para medir a geracao em producao.
  var lap = transporteLapStart_('gerarDocumentosTransporteEnvio');
  var access = transporteAssertOperador_();
  var usuario = transporteEnvioUsuario_(access);
  lap('acesso');
  var posse = transporteEnvioReivindicar_(agendaId, slot, usuario);
  lap('reivindicar');
  if (!posse.ok) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_EM_PREPARO', 'Este transporte está sendo preparado por outra pessoa agora.', { emPreparoPor: posse.emPreparoPor });
  var lido = transporteRegistroLer_(agendaId, slot);
  lap('ler_registro');
  if (!lido.registro) throw new Error('Abra o envio antes de gerar os documentos.');
  if (lido.versao !== Number(versao)) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_VERSAO', 'Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.');
  var registro = JSON.parse(JSON.stringify(lido.registro));
  if (registro.caixaTransporte) registro.caixaTransporte.confirmado = true;
  // Validacoes sem efeito externo, antes de qualquer AWB, arquivo ou rascunho.
  transporteValidarObrigatoriosWebApp_(registro);
  transporteValidarDataEnvioMinima_(registro.dataEnvio);
  codexMatBioValidateTransportPayload_(registro);
  lap('validar');
  // O token identifica os DADOS do envio: o numero do passo e os dados da propria geracao (token, rascunho)
  // mudam a cada gravacao e nao entram no hash.
  var dadosDoToken = JSON.parse(JSON.stringify(registro));
  delete dadosDoToken.passoNumero;
  TRANSPORTE_ENVIO_CAMPOS_GERACAO_.concat(TRANSPORTE_ENVIO_CAMPOS_DESATUALIZADO_).forEach(function(campo) { delete dadosDoToken[campo]; });
  // O token mora no registro do envio: outro navegador ou computador retoma a mesma geracao. O da tela so vale
  // na primeira tentativa, quando o registro ainda nao tem um.
  var inicio = transporteEnvioIniciarGeracao_(String(lido.registro.geracaoToken || generationRequestId || ''), dadosDoToken, usuario);
  var request = inicio.request;
  generationRequestId = inicio.token;
  lap('iniciar_geracao');
  if (registro.geracaoToken !== generationRequestId) {
    // Guardado antes de qualquer arquivo: se a execucao morrer no meio, a proxima tentativa encontra o token.
    var comToken = Object.assign({}, lido.registro, { geracaoToken: generationRequestId });
    // Sem mudar a versao: se a geracao falhar adiante, a tela tenta de novo com a versao que ja tem.
    transporteRegistroGravar_(agendaId, slot, comToken, { versaoEsperada: lido.versao, usuario: usuario, manterVersao: true });
    lido.registro = comToken;
    registro.geracaoToken = generationRequestId;
    lap('gravar_token');
  }
  request.record.generationRequestId = generationRequestId;
  TRANSPORTE_GENERATION_REQUEST_ = request;
  TRANSPORTE_GENERATION_WARNINGS_ = [];
  try {
    var repetido = transporteGenerationReplay_(request.record);
    // O resultado guardado traz a versao da epoca; a tela precisa da atual para continuar gravando.
    if (repetido) return transporteEnvioRespostaGerar_(Object.assign({ ok: true }, repetido, { versao: lido.versao }));
    // AWB e Agenda: escritas curtas, em lock, antes de qualquer arquivo.
    lap('replay');
    transporteAwbReservarEnvio_(agendaId, slot, usuario, { strict: true });
    lap('awb');
    codexWithDocumentLock_('transporteEnvioSincronizarAgenda', function() { return transporteSincronizarAgenda_(registro); });
    lap('agenda');
    var pdf = transporteEnvioGerarPdf_(registro, request, usuario, lap);
    var temperaturaPdf = transporteNormalizeTemperaturaFromCodex_(registro.temperatura);
    var docHash = transportePdfManifestoHash_({ dados: transporteGenerationCanonical_(registro), conteudo: pdf.conteudoPdfHash });
    var monitorRef = transporteMonitorReferencia_(registro.idAgenda, registro.agendaSlot);
    var peticao = transporteEnvioGerarPeticao_(registro, request);
    lap('peticao');
    var rascunho = request.record.draft || transporteEnvioCriarRascunho_(registro, {
      requestedByEmail: usuario, temperaturaPdf: temperaturaPdf, monitorRef: monitorRef, pdfHash: docHash,
      generationRequestId: generationRequestId, pdfFileId: pdf.fileId, peticaoFileId: peticao && peticao.fileId ? peticao.fileId : ''
    });
    lap('rascunho');
    var resultado = Object.assign({}, pdf, {
      draftOk: !!rascunho.ok, draftId: rascunho.draftId || '', draftError: rascunho.ok ? '' : String(rascunho.message || rascunho.error || ''),
      draftSkipped: !!rascunho.skipped, draftMessage: rascunho.message || '', monitorRef: monitorRef, manifestoPdfHash: docHash,
      draftSubject: rascunho.ok ? String(rascunho.subject || '') : '', draftRecipients: rascunho.ok ? String(rascunho.recipients || '') : '',
      draftCe: rascunho.ok ? String(rascunho.ceAnexada || '') : '',
      draftPeticao: rascunho.ok ? String(rascunho.peticaoAnexada || '') : '',
      peticaoFileId: peticao && peticao.fileId ? peticao.fileId : '', peticaoFileName: peticao && peticao.fileName ? peticao.fileName : '',
      peticaoWarning: peticao && peticao.erro ? peticao.erro : '',
      ce: transporteEnvioCeStatus_(registro.protocolo)
    });
    lap('ce_status');
    // Assunto e destinatarios ficam no registro: o passo Enviar aponta o rascunho certo mesmo em outro dia ou computador.
    if (rascunho.ok && rascunho.subject) {
      registro.rascunhoAssunto = String(rascunho.subject);
      registro.rascunhoDestinatarios = String(rascunho.recipients || '');
      if (rascunho.ceAnexada) registro.rascunhoCe = String(rascunho.ceAnexada);
      else delete registro.rascunhoCe;
      if (rascunho.peticaoAnexada) registro.rascunhoPeticao = String(rascunho.peticaoAnexada);
      else delete registro.rascunhoPeticao;
    }
    // A peticao salva no Drive: o passo Enviar aponta o arquivo se for preciso anexa-la a mao.
    if (peticao && peticao.fileId) {
      registro.peticaoArquivoId = String(peticao.fileId);
      registro.peticaoArquivoNome = String(peticao.fileName || '');
    }
    // O PDF tambem: o passo Enviar pede para imprimir e precisa do link mesmo depois de reabrir o envio.
    if (pdf.fileId) {
      registro.pdfArquivoId = String(pdf.fileId);
      registro.pdfArquivoNome = String(pdf.fileName || '');
    }
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
    lap('monitor');
    try {
      var sincronia = codexWithDocumentLock_('transporteEnvioDocsGerados', function() { return transporteMarcarDocsGeradosAgenda_(registro, pdf); });
      if (sincronia) resultado.agendaSync = sincronia;
    } catch (erroAgenda) {
      resultado.agendaWarning = 'Documentos gerados, mas o status da Agenda não foi atualizado: ' + String(erroAgenda && erroAgenda.message || erroAgenda);
    }
    lap('status_agenda');
    // Envio internacional: o proximo passo e o formulario ANVISA; o e-mail a courier so depois da GRU e do extrato.
    var proximoPasso = transporteEnvioInternacional_(registro) && !registro.peticionamentoEnviadoEm ? 'anvisa' : 'enviar';
    registro.passoNumero = transporteEnvioNumeroPasso_(registro, proximoPasso);
    var gravado = transporteEnvioGravarAposGerar_(agendaId, slot, registro, lido, usuario, proximoPasso);
    lap('gravar_registro');
    resultado.versao = gravado.versao;
    resultado.passo = proximoPasso;
    if (rascunho.ok || rascunho.skipped) transporteGenerationCheckpoint_({ phase: 'COMPLETE', result: resultado, pdf: null, draft: null });
    return transporteEnvioRespostaGerar_(Object.assign({ ok: true }, resultado));
  } finally {
    TRANSPORTE_GENERATION_REQUEST_ = null;
    TRANSPORTE_GENERATION_WARNINGS_ = null;
  }
}

/** "Pronto, enviei": encerra o preparo do envio. O monitor existente reconhece o envio pelo Gmail. */
function concluirEnvioTransporte(agendaId, slot, versao) {
  var access = transporteAssertOperador_();
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
  // Envio internacional antes da GRU e do extrato (ou sem o formulario ANVISA concluido): nao ha o que enviar ainda.
  if (lido.registro && transporteEnvioPassos_(lido.registro).indexOf('enviar') < 0) {
    throw new Error('Este transporte ainda não está no passo de envio à courier. Conclua o formulário ANVISA e aguarde a GRU e o extrato.');
  }
  // "Pronto, enviei" encerra o aviso de documentos desatualizados: o e-mail novo seguiu para a courier.
  var resposta = transporteEnvioSalvar_(agendaId, slot, versao, {}, 'concluido', usuario, function(registro) {
    TRANSPORTE_ENVIO_CAMPOS_DESATUALIZADO_.forEach(function(campo) { delete registro[campo]; });
  });
  transporteEnvioLiberar_(agendaId, slot, usuario);
  return { ok: true, versao: resposta.versao };
}

/** "Sair e continuar depois": guarda o passo e libera o preparo para a outra pessoa poder assumir. */
function sairEnvioTransporte(agendaId, slot, versao, passo) {
  var access = transporteAssertOperador_();
  var usuario = transporteEnvioUsuario_(access);
  var resposta;
  try {
    resposta = salvarTransporteEnvio(agendaId, slot, versao, {}, passo);
  } finally {
    // Mesmo sem conseguir guardar o passo, quem saiu nao fica como dono do preparo.
    transporteEnvioLiberar_(agendaId, slot, usuario);
  }
  return { ok: true, versao: resposta.versao, passo: resposta.passo };
}
