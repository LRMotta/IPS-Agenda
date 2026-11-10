/**
 * Peticionamento (GRU e extrato) dos envios internacionais: OCASA com laboratorio fora do Brasil e PINEX.
 *
 * Fluxo: quem prepara gera os documentos, confere o formulario ANVISA e conclui -> o status da Agenda passa a
 * "Aguardando peticionamento" e sai e-mail automatico (formulario anexo) para os autorizados -> um autorizado
 * salva GRU e extrato na pasta do envio, no servidor, e marca "GRU e extrato prontos" no app (o app nao acessa o
 * servidor) -> a tarefa volta para "Anexar a GRU e o extrato e enviar a courier".
 *
 * Autorizados: Configuracoes, grupo Transporte, chave "Autorizado a peticionar", uma linha por pessoa.
 * A autorizacao e sempre conferida no servidor, pela lista (e-mail normalizado), nunca pela interface.
 */
var TRANSPORTE_PETICIONAMENTO_CHAVE_ = 'Autorizado a peticionar';
var TRANSPORTE_PETICIONAMENTO_STATUS_ = 'Aguardando peticionamento';
var TRANSPORTE_PETICIONAMENTO_STATUS_VOLTA_ = 'Docs gerados';

function transportePeticionamentoEmailNorm_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim().toLowerCase();
}

// Lista de autorizados (e-mails normalizados, sem repeticao), uma linha ou valor por pessoa.
function transportePeticionamentoAutorizados_() {
  var valores = typeof getConfigAppValuesByKeys_ === 'function'
    ? (getConfigAppValuesByKeys_(['Transporte'], [TRANSPORTE_PETICIONAMENTO_CHAVE_], []) || []) : [];
  var vistos = {};
  var lista = [];
  valores.forEach(function(valor) {
    String(valor || '').split(/[;,\n\r]+/).forEach(function(parte) {
      var email = transportePeticionamentoEmailNorm_(parte);
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !vistos[email]) { vistos[email] = true; lista.push(email); }
    });
  });
  return lista;
}

// Piloto: so administrador E presente na lista (nenhum outro perfil usa estas acoes ainda); devolve { email }.
function transportePeticionamentoAssertAutorizado_() {
  var acesso = codexAssertAdmin_();
  var email = transportePeticionamentoEmailNorm_(acesso && acesso.email);
  if (!email || transportePeticionamentoAutorizados_().indexOf(email) < 0) {
    throw new Error('Você não está autorizado a peticionar. Peça a inclusão em Configurações (Transporte: Autorizado a peticionar).');
  }
  return { email: email, acesso: acesso };
}

function transportePeticionamentoDataBr_(valor) {
  var texto = String(valor || '').trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  return m ? m[3] + '/' + m[2] + '/' + m[1] : texto;
}

// Sexo vem do cadastro do participante (campo explicito); sem cadastro ou sem o campo, fica vazio (nunca inferido).
function transportePeticionamentoSexo_(registro) {
  try {
    var participante = agendaParticipantePorReferencia_({
      idCadastro: registro.participanteCadastroId || '', nome: registro.paciente, idParticipante: registro.identificacaoParticipante, projeto: registro.protocolo
    });
    if (!participante) return '';
    var colunas = participanteColumnMap_(getCodexSpreadsheet_().getSheetByName('Participantes'), false);
    return colunas.sexoNascimento === undefined ? '' : String(participante.row[colunas.sexoNascimento] || '').trim();
  } catch (erro) {
    Logger.log('Sexo do participante nao obtido para o peticionamento.');
    return '';
  }
}

// Link direto do app para o agendamento do envio (mesmo padrao dos e-mails da Agenda).
function transportePeticionamentoLink_(agendaId) {
  try {
    return ScriptApp.getService().getUrl() + '?pagina=agenda&agendaId=' + encodeURIComponent(String(agendaId || '').trim());
  } catch (erro) {
    return '';
  }
}

var TRANSPORTE_PETICIONAMENTO_RESERVA_MS_ = 5 * 60 * 1000;

function transportePeticionamentoAssunto_(registro) {
  return '[PETICIONAMENTO] ' + String(registro.protocolo || '').trim() + ' - AWB ' + String(registro.awb || '').trim() +
    ' - Envio ' + transportePeticionamentoDataBr_(registro.dataEnvio);
}

/**
 * Corpo do e-mail de peticionamento. Data e dia da semana sao os do TRANSPORTE (nao os da visita).
 * linhaAgenda: linha da Agenda (para a logistica); opcoes: { sexo, link, solicitante }.
 */
function transportePeticionamentoHtml_(registro, linhaAgenda, opcoes) {
  opcoes = opcoes || {};
  var i = AGENDA_CFG.idx;
  var dataTransporte = transporteEmailData_(registro.dataEnvio);
  var diaSemana = dataTransporte instanceof Date ? agendaDiaSemanaEmail_(dataTransporte) : 'Não informado';
  var linhas = [
    ['Data do transporte', transportePeticionamentoDataBr_(registro.dataEnvio)],
    ['Dia da Semana', diaSemana],
    ['Protocolo', registro.protocolo || ''],
    ['Participante', (registro.paciente || '') + ' (' + extrairIniciais_(registro.paciente) + ')'],
    ['Sexo', opcoes.sexo || 'Não informado'],
    ['Número de Identificação', registro.identificacaoParticipante || ''],
    ['Visita', linhaAgenda ? (linhaAgenda[i.visita] || '') : '']
  ];
  var tabela = '<table style="border-collapse:collapse;margin:10px 0;font-size:13px">' + linhas.map(function(l) {
    return '<tr><td style="padding:4px 8px;border:1px solid #ddd"><b>' + escHtmlServer_(l[0]) + '</b></td><td style="padding:4px 8px;border:1px solid #ddd">' + escHtmlServer_(l[1]) + '</td></tr>';
  }).join('') + '</table>';
  var corpo = gerarHtmlCabecalhoEmail_('Peticionamento - Envio de Amostras', '#2c3e50') +
    '<p>Há um envio internacional aguardando o peticionamento (GRU e extrato). O formulário da ANVISA segue em anexo.</p>' + tabela +
    (linhaAgenda ? gerarHtmlCouriers_(linhaAgenda) : '') +
    (opcoes.link ? '<p><a href="' + escHtmlServer_(opcoes.link) + '">Abrir o envio no app</a></p>' : '') +
    '<p>Depois de salvar a GRU e o extrato na pasta do envio, marque <b>GRU e extrato prontos</b> no app.</p>';
  return corpo + gerarRodapeEmailAgenda_('Solicitado por', { getEmail: function() { return opcoes.solicitante || ''; } }) + '</div>';
}

// Altera o status do transporte na Agenda (slots I a IV) sob lock, com auditoria. esperados: status atuais aceitos.
function transportePeticionamentoDefinirStatusAgenda_(agendaId, slot, novoStatus, esperados, motivo) {
  slot = normalizarSlotTransporteCodex_(slot, true);
  var idx = { '1': AGENDA_CFG.idx.c1, '2': AGENDA_CFG.idx.c2, '3': AGENDA_CFG.idx.c3, '4': AGENDA_CFG.idx.c4 }[slot];
  if (!idx) throw new Error('O peticionamento vale só para os Transportes I a IV.');
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, agendaId);
  if (!linha) throw new Error('Agendamento não encontrado.');
  var celula = agenda.getRange(linha, idx.status + 1);
  var anterior = String(celula.getValue() || '').trim();
  var chave = AgendaServerRules_.courierStatusKey(anterior);
  if (esperados.indexOf(chave) < 0) {
    throw new Error('O status atual do transporte na Agenda (' + (anterior || 'vazio') + ') não permite esta ação. Atualize a tela.');
  }
  if (anterior === novoStatus) return { alterado: false, anterior: anterior };
  celula.setValue(novoStatus);
  if (typeof agendaInvalidateDateIndexCache_ === 'function') agendaInvalidateDateIndexCache_();
  if (typeof agendaInvalidateWindowCache_ === 'function') agendaInvalidateWindowCache_();
  codexWriteAuditChanges_('Agenda', 'peticionamentoTransporte', agendaId, [{ field: 'Transporte ' + slot + ' - Status', oldValue: anterior, newValue: novoStatus }], motivo);
  return { alterado: true, anterior: anterior };
}

// Le o status atual do transporte (sem escrever) e recusa se nao estiver entre os aceitos.
function transportePeticionamentoStatusPermitido_(agendaId, slot, esperados) {
  var linha = transportePeticionamentoLinhaAgenda_(agendaId);
  if (!linha) throw new Error('Agendamento não encontrado.');
  var idx = { '1': AGENDA_CFG.idx.c1, '2': AGENDA_CFG.idx.c2, '3': AGENDA_CFG.idx.c3, '4': AGENDA_CFG.idx.c4 }[normalizarSlotTransporteCodex_(slot, true)];
  if (!idx) throw new Error('O peticionamento vale só para os Transportes I a IV.');
  var atual = String(linha[idx.status] || '').trim();
  if (esperados.indexOf(AgendaServerRules_.courierStatusKey(atual)) < 0) {
    throw new Error('O status atual do transporte na Agenda (' + (atual || 'vazio') + ') não permite esta ação. Atualize a tela.');
  }
}

/**
 * Conclui o passo ANVISA: gera o PDF do formulario, envia o e-mail aos autorizados (uma vez) e so entao muda o status
 * para "Aguardando peticionamento". Falha no e-mail mantem a tarefa com "Tentar de novo" e NAO muda o status.
 * Idempotente: a data do envio fica no registro e uma repeticao nao reenvia.
 */
function transportePeticionamentoConcluir_(agendaId, slot, versao, usuario, opcoes) {
  opcoes = opcoes || {};
  var agora = opcoes.agora || new Date();
  var lido = transporteRegistroLer_(agendaId, slot);
  if (!lido.registro) throw new Error('Abra o envio antes de concluir o formulário ANVISA.');
  if (lido.versao !== Number(versao)) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_VERSAO', 'Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.');
  transporteEnvioConferirDono_(agendaId, slot, usuario, agora);
  var registro = JSON.parse(JSON.stringify(lido.registro));
  if (!transporteEnvioInternacional_(registro)) throw new Error('Este envio não é internacional: não há formulário ANVISA.');
  var form = transportePeticaoGerar_(registro);
  if (!form.ok) throw new Error(form.erros.join(' '));
  var destinatarios = transportePeticionamentoAutorizados_();
  if (!destinatarios.length) throw new Error('Cadastre os autorizados a peticionar em Configurações (Transporte: Autorizado a peticionar).');
  // Confere o status ANTES de qualquer efeito externo (revalidado de novo dentro do lock, depois do e-mail).
  transportePeticionamentoStatusPermitido_(agendaId, slot, ['docsgerados', 'peticionamento']);
  if (!registro.peticionamentoEnviadoEm) {
    var linhaAgenda = opcoes.linhaAgenda !== undefined ? opcoes.linhaAgenda : transportePeticionamentoLinhaAgenda_(agendaId);
    var pdf = HtmlService.createHtmlOutput(form.html).getBlob().getAs(MimeType.PDF).setName('Peticao_Fiscalizacao_' + String(registro.awb || '').replace(/[^A-Za-z0-9_-]/g, '') + '.pdf');
    var mensagem = {
      to: destinatarios.join(','), subject: transportePeticionamentoAssunto_(registro),
      htmlBody: transportePeticionamentoHtml_(registro, linhaAgenda, {
        sexo: opcoes.sexo !== undefined ? opcoes.sexo : transportePeticionamentoSexo_(registro),
        link: opcoes.link !== undefined ? opcoes.link : transportePeticionamentoLink_(agendaId), solicitante: usuario
      }),
      attachments: [pdf], name: 'IPS | UCS'
    };
    // Reserva a intencao de envio no registro, sob lock curto: duas chamadas simultaneas nao enviam dois e-mails.
    // O envio em si roda fora do lock. Se o processo morrer entre enviar e gravar, a reserva expira em 5 min.
    var reserva = codexWithDocumentLock_('transportePeticionamentoReserva', function() {
      var atual = transporteRegistroLer_(agendaId, slot);
      if (atual.versao !== lido.versao) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_VERSAO', 'Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.');
      var corrente = atual.registro;
      var iniciado = Date.parse(corrente.peticionamentoEnvioIniciadoEm || '') || 0;
      if (iniciado && agora.getTime() - iniciado < TRANSPORTE_PETICIONAMENTO_RESERVA_MS_) {
        throw transporteRegistroErro_('PETICIONAMENTO_ENVIO_EM_ANDAMENTO', 'O e-mail de peticionamento já está sendo enviado. Aguarde alguns segundos e atualize a tela.');
      }
      var reservado = Object.assign({}, corrente, { peticionamentoEnvioIniciadoEm: agora.toISOString() });
      return { versao: transporteRegistroGravar_(agendaId, slot, reservado, { versaoEsperada: atual.versao, usuario: usuario, agora: agora }).versao, registro: reservado };
    });
    try {
      CodexExternalEffects_.sendEmail(mensagem);
    } catch (erroEnvio) {
      // Falha: libera a reserva para "Tentar de novo"; o status e o resto do registro nao mudam.
      var versaoAtual = reserva.versao;
      try {
        var semReserva = Object.assign({}, reserva.registro);
        delete semReserva.peticionamentoEnvioIniciadoEm;
        versaoAtual = transporteRegistroGravar_(agendaId, slot, semReserva, { versaoEsperada: reserva.versao, usuario: usuario, agora: agora }).versao;
      } catch (erroLiberar) {
        Logger.log('Reserva do e-mail de peticionamento nao liberada; expira sozinha.');
      }
      // A tela precisa da versao nova para "Tentar de novo" (a reserva e a liberacao mudam a versao).
      erroEnvio.falhaEmail = true;
      erroEnvio.versaoAtual = versaoAtual;
      throw erroEnvio;
    }
    var enviado = Object.assign({}, reserva.registro, { peticionamentoEnviadoEm: agora.toISOString(), peticionamentoEnviadoPor: usuario, gruPronta: false });
    delete enviado.peticionamentoEnvioIniciadoEm;
    // Guarda o envio antes do status: uma falha seguinte nao reenvia o e-mail na repeticao.
    lido.versao = transporteRegistroGravar_(agendaId, slot, enviado, { versaoEsperada: reserva.versao, usuario: usuario, agora: agora, passo: 'peticionando' }).versao;
  }
  codexWithDocumentLock_('transportePeticionamentoStatus', function() {
    transportePeticionamentoDefinirStatusAgenda_(agendaId, slot, TRANSPORTE_PETICIONAMENTO_STATUS_, ['docsgerados', 'peticionamento'], 'Formulário ANVISA conferido; aguardando GRU e extrato');
  });
  return { ok: true, versao: lido.versao, destinatarios: destinatarios, avisos: form.avisos };
}

function transportePeticionamentoLinhaAgenda_(agendaId) {
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, agendaId);
  return linha ? agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0] : null;
}

/** RPC do passo ANVISA (admin no piloto): formulario conferido, e-mail enviado e status em "Aguardando peticionamento". */
function concluirAnvisaTransporteEnvio(agendaId, slot, versao) {
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  var resultado;
  try {
    resultado = transportePeticionamentoConcluir_(agendaId, slot, versao, usuario, {});
  } catch (erro) {
    // Falha de e-mail nao e excecao para a tela: ela mostra o erro, mantem o passo e tenta de novo com a versao atual.
    if (erro && erro.falhaEmail) return { ok: false, erro: 'Não foi possível enviar o e-mail de peticionamento: ' + String(erro.message || erro), versao: erro.versaoAtual };
    throw erro;
  }
  transporteEnvioLiberar_(agendaId, slot, usuario);
  return resultado;
}

/** Pré-visualização do formulario para conferir e imprimir (HTML), sem efeito externo. */
function getTransporteFormularioAnvisa(agendaId, slot) {
  codexAssertAdmin_();
  var lido = transporteRegistroLer_(agendaId, slot);
  if (!lido.registro) throw new Error('Abra o envio antes de ver o formulário ANVISA.');
  var form = transportePeticaoGerar_(lido.registro);
  return Object.assign({ ok: form.ok, versao: lido.versao }, form);
}

/**
 * "GRU e extrato prontos": so autorizados (lista). Revalida, sob lock, que o envio esta aguardando o peticionamento,
 * devolve o status a "Docs gerados" (o monitor de e-mails promove depois do envio) e marca a tarefa de anexar e enviar.
 */
function marcarGruExtratoProntosTransporte(agendaId, slot) {
  var autorizado = transportePeticionamentoAssertAutorizado_();
  return codexWithDocumentLock_('marcarGruExtratoProntosTransporte', function() {
    // Revalida a lista dentro do lock: a autorizacao pode ter mudado desde a leitura.
    if (transportePeticionamentoAutorizados_().indexOf(autorizado.email) < 0) throw new Error('Você não está autorizado a peticionar.');
    var lido = transporteRegistroLer_(agendaId, slot);
    if (!lido.registro || !lido.registro.peticionamentoEnviadoEm) throw new Error('Este envio não está aguardando peticionamento.');
    // Confere o status antes de gravar; depois grava o registro e so entao troca o status. Se a troca falhar,
    // o registro volta ao que era: Agenda e registro nunca ficam em estados diferentes.
    transportePeticionamentoStatusPermitido_(agendaId, slot, ['peticionamento']);
    var registro = Object.assign({}, lido.registro, { gruPronta: true, gruProntaEm: new Date().toISOString(), gruProntaPor: autorizado.email });
    var gravado = transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: lido.versao, usuario: autorizado.email, passo: 'enviar' });
    var troca;
    try {
      troca = transportePeticionamentoDefinirStatusAgenda_(agendaId, slot, TRANSPORTE_PETICIONAMENTO_STATUS_VOLTA_, ['peticionamento'], 'GRU e extrato prontos, marcado por ' + autorizado.email);
    } catch (erroStatus) {
      try {
        transporteRegistroGravar_(agendaId, slot, lido.registro, { versaoEsperada: gravado.versao, usuario: autorizado.email, passo: lido.passo });
      } catch (erroDesfazer) {
        Logger.log('Registro do peticionamento nao restaurado apos falha do status.');
      }
      throw erroStatus;
    }
    return { ok: true, versao: gravado.versao, statusAnterior: troca.anterior };
  });
}

/** Lista minima para os autorizados: so o necessario para peticionar (sem acesso ao restante do modulo). */
function getTransportePeticionamentos() {
  transportePeticionamentoAssertAutorizado_();
  var agenda = getDashboardAgendaSheetForRead_();
  var linhas = getDashboardAgendaDisplayRows_(agenda);
  var i = AGENDA_CFG.idx;
  var itens = [];
  linhas.forEach(function(r) {
    if (AgendaServerRules_.isCancelled(normText_(r[i.status]))) return;
    TRANSPORTE_TAREFAS_SLOTS_.forEach(function(slot) {
      var cfg = i[slot[2]];
      if (!isCourierNomeValidoAgenda_(String(r[cfg.nome] || '').trim())) return;
      if (AgendaServerRules_.courierStatusKey(String(r[cfg.status] || '')) !== 'peticionamento') return;
      itens.push({ agendaId: String(r[i.id] || '').trim(), slot: slot[0], slotRotulo: slot[1], data: String(r[i.data] || ''), projeto: String(r[i.projeto] || ''),
        participante: extrairIniciais_(r[i.participante]), courier: String(r[cfg.nome] || '').trim(), awb: String(r[cfg.awb] || '').trim(), destino: String(r[cfg.destino] || '').trim() });
    });
  });
  return { ok: true, itens: itens };
}
