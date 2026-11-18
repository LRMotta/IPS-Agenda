/**
 * Preparo de um envio de Transporte para a tela passo a passo (admin no piloto).
 *
 * Fonte unica: o registro do envio em Transporte_Registros (TransporteRegistros.gs), montado a
 * partir da Agenda. Nenhuma funcao daqui abre a planilha de Transporte. As escritas na Agenda e
 * em planilhas auxiliares acontecem em locks curtos; PDF e rascunho ficam fora do lock, com
 * recuperacao por token (transporteGeneration*). Ver docs/TRANSPORTE_LOCK_POR_ENVIO.md.
 */

// Planilha de Transporte "vazia": quem pergunta por abas do modelo recebe null, nunca a real.
function transporteEnvioSsVazio_() {
  return transporteEmailPlanilhaMemoria_({});
}

/* ---------- Resposta da PINEX ---------- */

/**
 * Le a linha de confirmacao da PINEX, por exemplo:
 * "Confirmação de agendamento - Coleta: 78429 - Frete: 94624 - Protocolo: MB12C0224 - Data da coleta: 11/03/2026".
 * Coleta com 5 ou 6 digitos. Devolve { ok, coleta, frete, protocolo, dataColeta (yyyy-MM-dd), faltando[] }.
 */
function transportePinexParseResposta_(texto) {
  texto = String(texto === null || texto === undefined ? '' : texto);
  function pegar(re) { var m = re.exec(texto); return m ? String(m[1]).trim() : ''; }
  var coleta = pegar(/Coleta\s*:\s*(\d{5,6})(?!\d)/i);
  var frete = pegar(/Frete\s*:\s*(\d+)/i);
  var protocolo = pegar(/Protocolo\s*:\s*([A-Za-z0-9]+)/i);
  var data = /Data\s+da\s+coleta\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(texto);
  var faltando = [];
  if (!coleta) faltando.push('Coleta (5 ou 6 dígitos)');
  if (!frete) faltando.push('Frete');
  if (!protocolo) faltando.push('Protocolo');
  if (!data) faltando.push('Data da coleta');
  return {
    ok: !faltando.length, coleta: coleta, frete: frete, protocolo: protocolo,
    dataColeta: data ? data[3] + '-' + data[2] + '-' + data[1] : '', faltando: faltando
  };
}

/* ---------- Ultima AWB do estudo (passo AWB) ---------- */

/**
 * Ultima AWB usada no estudo com a courier (MARKEN e DHL Ambiente: pacote recebido no inicio do
 * estudo). Leitura sem lock de AWB_Utilizadas; nao altera a aba.
 */
function transporteAwbUltimaDoEstudo_(projeto, courier, temperatura) {
  // DHL: so o Ambiente usa AWB do pacote do estudo; a do congelado vem na resposta da courier e nao serve de dica.
  var soAmbiente = transporteIsDhl_(transporteNormalizeCourierFromCodex_(courier));
  if (soAmbiente && transporteNormalizeTemperaturaFromCodex_(temperatura) !== 'AMBIENTE') return null;
  var sh = getCodexSpreadsheet_().getSheetByName('AWB_Utilizadas');
  if (!sh || sh.getLastRow() < 2) return null;
  var valores = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
  var chaveProjeto = transporteParticipantKey_(transporteProjetoDisplay_(projeto));
  var chaveCourier = transporteNorm_(transporteNormalizeCourierFromCodex_(courier));
  for (var i = valores.length - 1; i >= 0; i--) {
    var linha = valores[i];
    if (transporteNorm_(transporteNormalizeCourierFromCodex_(linha[4])) !== chaveCourier) continue;
    if (soAmbiente && transporteNormalizeTemperaturaFromCodex_(linha[5]) !== 'AMBIENTE') continue;
    if (transporteParticipantKey_(transporteProjetoDisplay_(linha[7])) !== chaveProjeto) continue;
    return { awb: String(linha[0] || ''), data: linha[8] instanceof Date ? linha[8].toISOString() : String(linha[8] || ''), temperatura: String(linha[5] || '') };
  }
  return null;
}

function getTransporteAwbUltima(projeto, courier, temperatura) {
  codexAssertAdmin_();
  return { ok: true, ultima: transporteAwbUltimaDoEstudo_(projeto, courier, temperatura) };
}

/* ---------- Passos ---------- */

/**
 * PINEX tem duas fases no mesmo transporte da Agenda: (1) 'agendamento' - enviar o Formulario (PINEX (Agendamento))
 * por e-mail; (2) 'resposta' - aguardar a PINEX, que responde o e-mail com os numeros no titulo; (3) 'documentos' -
 * numeros informados, gerar os documentos da PINEX. A fase fica no registro e define a courier usada nos documentos.
 */
function transporteEnvioFamiliaPinex_(courier) {
  return transporteNorm_(courier).indexOf('pinex') >= 0;
}

function transporteEnvioAplicarFasePinex_(registro, anterior) {
  if (!registro || !transporteEnvioFamiliaPinex_(registro.courier)) return registro;
  var fase = 'agendamento';
  if (String(registro.pinexColeta || '').trim()) fase = 'documentos';
  else if ((registro.fasePinex || (anterior && anterior.fasePinex)) === 'resposta') fase = 'resposta';
  registro.fasePinex = fase;
  registro.courier = fase === 'documentos' ? 'PINEX' : 'PINEX (Agendamento)';
  return registro;
}

// Numero (1-based) do passo entre os passos do envio; 0 se o passo nao faz parte deles (ex.: concluido).
function transporteEnvioNumeroPasso_(registro, passo) {
  var indice = transporteEnvioPassos_(registro).indexOf(String(passo || ''));
  return indice >= 0 ? indice + 1 : 0;
}

function transporteEnvioInternacional_(registro) {
  var courier = transporteNormalizeCourierFromCodex_(registro.courier);
  if (courier === 'PINEX') return true;
  if (courier === 'OCASA') return transporteOcasaNeedsProforma_(registro.destino);
  return false;
}

/**
 * Passos na ordem: Conferir -> [AWB ou Numeros PINEX, se faltar] -> Gerar -> Enviar.
 * (O passo ANVISA dos envios internacionais entra com o formulario, na Etapa 8.)
 */
function transporteEnvioPassos_(registro) {
  var courier = transporteNormalizeCourierFromCodex_(registro.courier);
  var passos = ['conferir'];
  // Aguardando a resposta da PINEX: o primeiro passo é colar os números.
  if (registro.fasePinex === 'resposta') return ['pinex_numeros', 'conferir', 'gerar', 'enviar'];
  var precisaAwb = courier !== 'PINEX (Agendamento)' && codexCourierRequiresAwb_(registro.courier) && !String(registro.awb || '').trim();
  if (courier === 'PINEX' && (precisaAwb || !String(registro.pinexColeta || '').trim())) passos.push('pinex_numeros');
  else if (precisaAwb) passos.push('awb');
  passos.push('gerar');
  // Envio internacional: depois de gerar, confere o formulario ANVISA e conclui; o envio a courier so vem depois
  // da GRU e do extrato (Aguardando peticionamento). Com a GRU pronta, so falta anexar e enviar.
  if (transporteEnvioInternacional_(registro) && !registro.peticionamentoEnviadoEm) return passos.concat(['anvisa']);
  if (registro.gruPronta) return ['enviar'];
  // Formulario ja enviado a quem peticiona e GRU ainda nao pronta: nao ha envio a courier. O unico passo e o ANVISA,
  // cuja conclusao e idempotente (nao reenvia o e-mail) e acerta o status da Agenda se ele nao chegou a mudar.
  if (registro.peticionamentoEnviadoEm) return ['anvisa'];
  return passos.concat(['enviar']);
}

/* ---------- Registro a partir da Agenda ---------- */

// Campos que a pessoa preenche no passo a passo e que a reconstrucao pela Agenda nao pode apagar.
var TRANSPORTE_ENVIO_CAMPOS_LOCAIS_ = ['agendadoPor', 'pinexAgendadoPor', 'responsavelEntrega', 'horaEnvio', 'solicitarCaixa',
  'pinexColeta', 'pinexProtocolo', 'observacoes', 'fasePinex', 'passoNumero', 'peticionamentoEnviadoEm', 'peticionamentoEnviadoPor', 'gruPronta', 'gruProntaEm', 'gruProntaPor',
  'geracaoToken', 'rascunhoAssunto', 'rascunhoDestinatarios'];

// Dados da geracao em curso (token de recuperacao e rascunho criado). Valem para um conjunto de dados: quando a
// Agenda muda e o preparo recomeca, sao descartados e a geracao seguinte nasce do zero.
var TRANSPORTE_ENVIO_CAMPOS_GERACAO_ = ['geracaoToken', 'rascunhoAssunto', 'rascunhoDestinatarios'];

// Campos que o navegador pode gravar por salvarTransporteEnvio. Os de controle (fase da PINEX, numero do passo,
// peticionamento, GRU) so mudam pelas rotas do servidor que os decidem.
var TRANSPORTE_ENVIO_CAMPOS_TELA_ = ['agendadoPor', 'pinexAgendadoPor', 'responsavelEntrega', 'horaEnvio', 'solicitarCaixa',
  'pinexColeta', 'pinexProtocolo', 'observacoes', 'awb'];

// Dados que vem da Agenda e entram nos documentos e no e-mail. Se mudam, o que ja foi conferido ou gerado nao vale mais.
var TRANSPORTE_ENVIO_CAMPOS_DOCUMENTO_ = ['dataEnvio', 'dataColeta', 'courier', 'temperatura', 'destino', 'awb', 'protocolo', 'paciente'];

function transporteEnvioDadosDocumentoMudaram_(antigo, novo) {
  if (!antigo || !novo) return false;
  function texto(valor) { return String(valor === null || valor === undefined ? '' : valor).trim(); }
  function materiais(registro) {
    return JSON.stringify(transporteGenerationCanonical_((registro.materiais || []).filter(function(m) { return m && m.ativo && m.material; })));
  }
  return TRANSPORTE_ENVIO_CAMPOS_DOCUMENTO_.some(function(campo) { return texto(antigo[campo]) !== texto(novo[campo]); }) ||
    materiais(antigo) !== materiais(novo);
}

function transporteEnvioMesclarLocais_(novo, antigo) {
  if (!antigo) return novo;
  TRANSPORTE_ENVIO_CAMPOS_LOCAIS_.forEach(function(campo) {
    if (String(antigo[campo] || '').trim()) novo[campo] = antigo[campo];
  });
  // A AWB da Agenda prevalece; a digitada no passo AWB so vale enquanto a Agenda nao tem uma.
  if (!String(novo.awb || '').trim() && String(antigo.awb || '').trim()) {
    novo.awb = antigo.awb;
    novo.pinexAwb = antigo.pinexAwb || antigo.awb;
  }
  return novo;
}

/**
 * Registro do envio montado so com a Agenda e os cadastros (mesmos passos do pre-preenchimento
 * pela Agenda, sem gravar na planilha de Transporte).
 */
function transporteEnvioMontarRegistro_(agendaId, slot) {
  var contexto = montarContextoTransporteParaTransp_(agendaId, slot);
  var payload = montarPayloadTransporteCodex(contexto.payload);
  var opcoes = { obrigatorio: false, participantes: [], adiarProjetoDisplay: true };
  try {
    opcoes.participantes = transporteReadParticipantesDireto_(contexto.leituraParticipantes);
  } catch (erro) {
    Logger.log('Cadastro de participantes indisponivel ao abrir o envio.');
  }
  payload = transporteAtualizarRegistroPorAgenda_(payload, contexto.evento, opcoes);
  payload = transporteDerivarDadosParticipante_(payload, opcoes);
  payload.protocolo = transporteProjetoDisplay_(payload.protocolo || '');
  payload.caixaTransporte = transporteCaixaResolver_(transporteEnvioSsVazio_(), payload, false);
  if (transporteNormalizeCourierFromCodex_(payload.courier) === 'MARKEN') {
    payload.solicitarCaixa = transporteSolicitarCaixaMarken_(payload, payload.solicitarCaixa);
  }
  return transporteRegistroPreparado_(payload);
}

function transporteEnvioAvisos_(registro) {
  var avisos = [];
  var courier = transporteNormalizeCourierFromCodex_(registro.courier);
  if (!String(registro.destino || '').trim()) avisos.push('Destino não definido na Agenda.');
  if (courier === 'PINEX' && String(registro.pinexColeta || '').trim() && !/^\d{5,6}$/.test(String(registro.pinexColeta))) {
    avisos.push('PINEX COL. N° deve conter 5 ou 6 dígitos.');
  }
  return avisos;
}

// codexAuthorizeWebAppRequest_ entrega o e-mail em userEmail; email fica como fallback legado.
function transporteEnvioUsuario_(access) {
  var email = String(access && (access.userEmail || access.email) || '').trim().toLowerCase();
  if (!email) throw new Error('Usuário não identificado.');
  return email;
}

function transporteEnvioRespostaOcupado_(preparo, nomes) {
  var nome = (nomes && nomes[preparo.emPreparoPor]) || preparo.emPreparoPor;
  return { ok: false, motivo: 'EM_PREPARO', comPessoa: nome, comEmail: preparo.emPreparoPor,
    mensagem: 'Com ' + nome + ' agora. Este transporte está sendo preparado por outra pessoa.' };
}

/**
 * Abre (ou retoma) o envio: assume o preparo, le o registro e, enquanto os documentos ainda nao
 * foram gerados, reconstroi os dados da Agenda preservando o que a pessoa ja preencheu.
 */
function getTransporteEnvio(agendaId, slot) {
  // Etapas no log ([CODEX_PERF] getTransporteEnvio) para medir a abertura em producao.
  var lap = transporteLapStart_('getTransporteEnvio');
  var access = codexAssertAdmin_();
  lap('acesso');
  var usuario = transporteEnvioUsuario_(access);
  var claim = transporteEnvioReivindicar_(agendaId, slot, usuario);
  lap('reivindicar');
  if (!claim.ok) return transporteEnvioRespostaOcupado_({ emPreparoPor: claim.emPreparoPor }, transporteTarefasNomes_());
  // A linha ja foi lida dentro do lock da reivindicacao: sem segunda leitura da aba.
  var lido = { registro: claim.registro || null, passo: claim.passo || '', versao: claim.versao };
  // Com os documentos gerados, o registro e o que foi impresso: so volta a seguir a Agenda se ela mudou.
  var comDocumentos = !!lido.registro && ['anvisa', 'enviar', 'concluido', 'peticionando'].indexOf(lido.passo) >= 0;
  var registro = lido.registro;
  var versao = lido.versao;
  var passoInicial = lido.passo || 'conferir';
  var dadosAtualizados = false;
  var avisosAgenda = [];
  var montado = null;
  if (comDocumentos) {
    try {
      montado = transporteEnvioAplicarFasePinex_(transporteEnvioMesclarLocais_(transporteEnvioMontarRegistro_(agendaId, slot), lido.registro), lido.registro);
      lap('montar_agenda');
    } catch (erroMontar) {
      // Sem a Agenda (linha removida, cadastro indisponivel), o envio abre como estava.
      Logger.log('Envio com documentos aberto sem comparar com a Agenda.');
      montado = null;
    }
    if (montado && transporteEnvioDadosDocumentoMudaram_(lido.registro, montado)) {
      if (lido.registro.peticionamentoEnviadoEm) {
        // O formulario ANVISA ja seguiu para quem peticiona: refazer e decisao de pessoas, nao do sistema.
        avisosAgenda.push('Os dados deste transporte mudaram na Agenda depois do formulário ANVISA. Confira com quem peticiona antes de enviar à courier.');
      } else {
        comDocumentos = false;
      }
    }
  }
  if (!comDocumentos) {
    if (!montado) {
      montado = transporteEnvioMesclarLocais_(transporteEnvioMontarRegistro_(agendaId, slot), lido.registro);
      lap('montar_agenda');
      // Pedido de coleta a PINEX ja enviado fora do passo a passo (Transporte_Operacoes): comeca pelos numeros.
      if (transporteEnvioFamiliaPinex_(montado.courier) && (!montado.fasePinex || montado.fasePinex === 'agendamento') &&
          transporteTarefaPinexPedidos_(transporteOperacoesRows_())[agendaId + '|' + slot]) montado.fasePinex = 'resposta';
      montado = transporteEnvioAplicarFasePinex_(montado, lido.registro);
      lap('fase_pinex');
    }
    registro = montado;
    if (!lido.passo && registro.fasePinex === 'resposta') passoInicial = 'pinex_numeros';
    // Ja conferido (ou com documentos) e a Agenda mudou: a pessoa confere de novo e os documentos sao refeitos.
    if (lido.registro && ['gerar', 'anvisa', 'enviar', 'concluido'].indexOf(lido.passo) >= 0 &&
        transporteEnvioDadosDocumentoMudaram_(lido.registro, registro)) {
      passoInicial = 'conferir';
      dadosAtualizados = true;
      TRANSPORTE_ENVIO_CAMPOS_GERACAO_.forEach(function(campo) { delete registro[campo]; });
    }
    if (!lido.registro || dadosAtualizados || JSON.stringify(lido.registro) !== JSON.stringify(registro)) {
      registro.passoNumero = transporteEnvioNumeroPasso_(registro, passoInicial);
      var gravado = transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: lido.versao, usuario: usuario, passo: passoInicial });
      versao = gravado.versao;
      lap('gravar');
    }
  }
  return {
    ok: true, registro: registro, versao: versao, passo: passoInicial, passos: transporteEnvioPassos_(registro),
    internacional: transporteEnvioInternacional_(registro), avisos: transporteEnvioAvisos_(registro).concat(avisosAgenda),
    // Os documentos anteriores, se existem, foram feitos com outros dados: o token de geracao foi descartado acima.
    dadosAtualizados: dadosAtualizados
  };
}

/**
 * Sinal de atividade da tela: renova o preparo de quem esta com o envio aberto (ou o retoma, se expirou e
 * ninguem assumiu). Outra pessoa com o preparo ativo: { ok: false, comPessoa }.
 */
function renovarPreparoTransporteEnvio(agendaId, slot) {
  var usuario = transporteEnvioUsuario_(codexAssertAdmin_());
  var posse = transporteEnvioReivindicar_(agendaId, slot, usuario);
  if (!posse.ok) return transporteEnvioRespostaOcupado_({ emPreparoPor: posse.emPreparoPor }, transporteTarefasNomes_());
  return { ok: true, versao: posse.versao };
}

var TRANSPORTE_ENVIO_PASSOS_VALIDOS_ = ['conferir', 'awb', 'pinex_numeros', 'gerar', 'anvisa', 'enviar', 'concluido'];

/**
 * Salva campos preenchidos pela pessoa e o passo atual. versao = a que a tela recebeu; conflito
 * recusa. campos: somente os de TRANSPORTE_ENVIO_CAMPOS_LOCAIS_ e a AWB (enquanto a Agenda nao tem).
 */
function salvarTransporteEnvio(agendaId, slot, versao, campos, passo) {
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  var salvo = transporteEnvioSalvar_(agendaId, slot, versao, campos, passo, usuario);
  return { ok: true, versao: salvo.versao, passo: salvo.passo, passos: salvo.passos, perdeuPreparo: salvo.perdeuPreparo };
}

// Nucleo de salvarTransporteEnvio, tambem usado pelas rotas do servidor (resposta da PINEX, sair, concluir).
// antesDeGravar(registro) (opcional): ultima conferencia do registro ja mesclado; lanca para nao gravar nada.
function transporteEnvioSalvar_(agendaId, slot, versao, campos, passo, usuario, antesDeGravar) {
  campos = campos && typeof campos === 'object' ? campos : {};
  if (passo === null) passo = undefined; // google.script.run entrega null no lugar de undefined
  if (passo !== undefined && passo !== null && TRANSPORTE_ENVIO_PASSOS_VALIDOS_.indexOf(String(passo)) < 0) throw new Error('Passo inválido.');
  var lido = transporteRegistroLer_(agendaId, slot);
  if (!lido.registro) throw new Error('Abra o envio antes de salvar.');
  var registro = Object.assign({}, lido.registro);
  TRANSPORTE_ENVIO_CAMPOS_TELA_.forEach(function(campo) {
    if (campos[campo] !== undefined) registro[campo] = String(campos[campo] === null ? '' : campos[campo]).trim();
  });
  if (campos.awb !== undefined) {
    registro.awb = codexCourierNormalizeAwb_(registro.awb, registro.courier) || registro.awb;
    registro.pinexAwb = registro.awb;
    if (registro.awb) codexCourierAssertDocumentAwb_(registro.awb, registro.courier);
  }
  if (registro.pinexColeta && !/^\d{5,6}$/.test(registro.pinexColeta)) throw new Error('PINEX COL. N° deve conter 5 ou 6 dígitos.');
  transporteEnvioAplicarFasePinex_(registro, lido.registro);
  if (passo !== undefined) registro.passoNumero = transporteEnvioNumeroPasso_(registro, passo);
  if (registro.solicitarCaixa) registro.solicitarCaixa = transporteNormalizeSimNao_(registro.solicitarCaixa, transporteDefaultSolicitarCaixa_(registro.courier));
  if (typeof antesDeGravar === 'function') antesDeGravar(registro);
  var gravado = transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: versao, usuario: usuario, passo: passo === undefined ? undefined : String(passo) });
  // registro: so para as rotas do servidor, que assim nao releem a aba depois de gravar.
  return { ok: true, versao: gravado.versao, passo: gravado.passo, passos: transporteEnvioPassos_(registro), perdeuPreparo: gravado.perdeuPreparo, registro: registro };
}

/**
 * Numeros da PINEX: Coleta vai em PINEX COL. Nº e Frete na AWB (HAWB = Frete e suposicao a confirmar no
 * primeiro envio PINEX real). dados = { coleta, awb }: so o numero da coleta; a AWB so quando o envio ainda
 * nao tem (a da Agenda prevalece). Se a pessoa colar a linha inteira da PINEX ("Coleta: 78429 - Frete: ...")
 * no campo, ou mandar texto (chamada antiga), os numeros sao lidos dela, com o Protocolo, e a data da coleta
 * e conferida com a do envio.
 */
function registrarRespostaPinexEnvio(agendaId, slot, versao, dados) {
  var usuario = transporteEnvioUsuario_(codexAssertAdmin_());
  var objeto = !!dados && typeof dados === 'object';
  var coleta = String(objeto ? dados.coleta || '' : dados || '').trim();
  var awb = objeto ? String(dados.awb || '').trim() : '';
  var leitura = null;
  if (!objeto || /coleta\s*:/i.test(coleta)) {
    leitura = transportePinexParseResposta_(coleta);
    if (!objeto && !leitura.ok) return { ok: false, mensagem: 'Não encontrei: ' + leitura.faltando.join(', ') + '. Cole a linha completa da PINEX.' };
    coleta = leitura.coleta;
    if (!awb) awb = leitura.frete;
  }
  if (!/^\d{5,6}$/.test(coleta)) return { ok: false, mensagem: 'O número da coleta da PINEX tem 5 ou 6 dígitos.' };
  var campos = { pinexColeta: coleta };
  if (awb) campos.awb = awb;
  if (leitura && leitura.protocolo) campos.pinexProtocolo = leitura.protocolo;
  // Uma leitura da aba (a do salvar): o registro gravado volta na resposta, sem reler antes nem depois.
  var salvo;
  try {
    salvo = transporteEnvioSalvar_(agendaId, slot, versao, campos, 'conferir', usuario, function(registro) {
      if (!String(registro.awb || '').trim()) throw transporteRegistroErro_('TRANSPORTE_PINEX_SEM_AWB', 'Informe também o Frete (AWB) da PINEX.');
    });
  } catch (erro) {
    if (erro && erro.code === 'TRANSPORTE_PINEX_SEM_AWB') return { ok: false, mensagem: erro.message, pedirAwb: true };
    throw erro;
  }
  var avisos = [];
  var dataEnvio = salvo.registro.dataEnvio ? String(salvo.registro.dataEnvio).slice(0, 10) : '';
  if (leitura && leitura.dataColeta && /^\d{4}-\d{2}-\d{2}$/.test(dataEnvio) && dataEnvio !== leitura.dataColeta) {
    avisos.push('A PINEX marcou a coleta para ' + leitura.dataColeta.split('-').reverse().join('/') + ', diferente da data do envio (' + dataEnvio.split('-').reverse().join('/') + ').');
  }
  return Object.assign({}, salvo, { leitura: leitura || { coleta: coleta, frete: salvo.registro.awb || '', protocolo: '' }, avisos: avisos });
}
