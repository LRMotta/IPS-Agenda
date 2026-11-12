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
function transporteAwbUltimaDoEstudo_(projeto, courier) {
  var sh = getCodexSpreadsheet_().getSheetByName('AWB_Utilizadas');
  if (!sh || sh.getLastRow() < 2) return null;
  var valores = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
  var chaveProjeto = transporteParticipantKey_(transporteProjetoDisplay_(projeto));
  var chaveCourier = transporteNorm_(transporteNormalizeCourierFromCodex_(courier));
  for (var i = valores.length - 1; i >= 0; i--) {
    var linha = valores[i];
    if (transporteNorm_(transporteNormalizeCourierFromCodex_(linha[4])) !== chaveCourier) continue;
    if (transporteParticipantKey_(transporteProjetoDisplay_(linha[7])) !== chaveProjeto) continue;
    return { awb: String(linha[0] || ''), data: linha[8] instanceof Date ? linha[8].toISOString() : String(linha[8] || ''), temperatura: String(linha[5] || '') };
  }
  return null;
}

function getTransporteAwbUltima(projeto, courier) {
  codexAssertAdmin_();
  return { ok: true, ultima: transporteAwbUltimaDoEstudo_(projeto, courier) };
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
  return passos.concat(['enviar']);
}

/* ---------- Registro a partir da Agenda ---------- */

// Campos que a pessoa preenche no passo a passo e que a reconstrucao pela Agenda nao pode apagar.
var TRANSPORTE_ENVIO_CAMPOS_LOCAIS_ = ['agendadoPor', 'pinexAgendadoPor', 'responsavelEntrega', 'horaEnvio', 'solicitarCaixa',
  'pinexColeta', 'pinexProtocolo', 'observacoes', 'fasePinex', 'passoNumero', 'peticionamentoEnviadoEm', 'peticionamentoEnviadoPor', 'gruPronta', 'gruProntaEm', 'gruProntaPor'];

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

function transporteEnvioUsuario_(access) {
  var email = String(access && access.email || '').trim().toLowerCase();
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
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  var claim = transporteEnvioReivindicar_(agendaId, slot, usuario);
  if (!claim.ok) return transporteEnvioRespostaOcupado_({ emPreparoPor: claim.emPreparoPor }, transporteTarefasNomes_());
  var lido = transporteRegistroLer_(agendaId, slot);
  var emAndamento = lido.registro && ['gerar', 'anvisa', 'enviar', 'concluido', 'peticionando'].indexOf(lido.passo) >= 0;
  var registro = lido.registro;
  var versao = lido.versao;
  var passoInicial = lido.passo || 'conferir';
  if (!emAndamento) {
    var montado = transporteEnvioMesclarLocais_(transporteEnvioMontarRegistro_(agendaId, slot), lido.registro);
    // Pedido de coleta a PINEX ja enviado fora do passo a passo (Transporte_Operacoes): comeca pelos numeros.
    if (transporteEnvioFamiliaPinex_(montado.courier) && (!montado.fasePinex || montado.fasePinex === 'agendamento') &&
        transporteTarefaPinexPedidos_(transporteOperacoesRows_())[agendaId + '|' + slot]) montado.fasePinex = 'resposta';
    registro = transporteEnvioAplicarFasePinex_(montado, lido.registro);
    if (!lido.passo && registro.fasePinex === 'resposta') passoInicial = 'pinex_numeros';
    if (!lido.registro || JSON.stringify(lido.registro) !== JSON.stringify(registro)) {
      registro.passoNumero = transporteEnvioNumeroPasso_(registro, passoInicial);
      var gravado = transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: lido.versao, usuario: usuario, passo: passoInicial });
      versao = gravado.versao;
    }
  }
  return {
    ok: true, registro: registro, versao: versao, passo: passoInicial, passos: transporteEnvioPassos_(registro),
    internacional: transporteEnvioInternacional_(registro), avisos: transporteEnvioAvisos_(registro)
  };
}

var TRANSPORTE_ENVIO_PASSOS_VALIDOS_ = ['conferir', 'awb', 'pinex_numeros', 'gerar', 'anvisa', 'enviar', 'concluido'];

/**
 * Salva campos preenchidos pela pessoa e o passo atual. versao = a que a tela recebeu; conflito
 * recusa. campos: somente os de TRANSPORTE_ENVIO_CAMPOS_LOCAIS_ e a AWB (enquanto a Agenda nao tem).
 */
function salvarTransporteEnvio(agendaId, slot, versao, campos, passo) {
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  campos = campos && typeof campos === 'object' ? campos : {};
  if (passo === null) passo = undefined; // google.script.run entrega null no lugar de undefined
  if (passo !== undefined && passo !== null && TRANSPORTE_ENVIO_PASSOS_VALIDOS_.indexOf(String(passo)) < 0) throw new Error('Passo inválido.');
  var lido = transporteRegistroLer_(agendaId, slot);
  if (!lido.registro) throw new Error('Abra o envio antes de salvar.');
  var registro = Object.assign({}, lido.registro);
  TRANSPORTE_ENVIO_CAMPOS_LOCAIS_.concat(['awb']).forEach(function(campo) {
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
  var gravado = transporteRegistroGravar_(agendaId, slot, registro, { versaoEsperada: versao, usuario: usuario, passo: passo === undefined ? undefined : String(passo) });
  return { ok: true, versao: gravado.versao, passo: gravado.passo, passos: transporteEnvioPassos_(registro), perdeuPreparo: gravado.perdeuPreparo };
}

/**
 * Cola a resposta da PINEX: Coleta vai em PINEX COL. Nº, Frete na AWB, Protocolo so no registro.
 * Avisa se a data da coleta difere da data do envio. HAWB = Frete e suposicao a confirmar no primeiro
 * envio PINEX real.
 */
function registrarRespostaPinexEnvio(agendaId, slot, versao, texto) {
  codexAssertAdmin_();
  var lido = transporteRegistroLer_(agendaId, slot);
  var leitura = transportePinexParseResposta_(texto);
  if (!leitura.ok) return { ok: false, mensagem: 'Não encontrei: ' + leitura.faltando.join(', ') + '. Cole a linha completa da PINEX.' };
  var resposta = salvarTransporteEnvio(agendaId, slot, versao, { pinexColeta: leitura.coleta, awb: leitura.frete, pinexProtocolo: leitura.protocolo }, 'conferir');
  var avisos = [];
  var dataEnvio = lido.registro && lido.registro.dataEnvio ? String(lido.registro.dataEnvio).slice(0, 10) : '';
  if (dataEnvio && /^\d{4}-\d{2}-\d{2}$/.test(dataEnvio) && dataEnvio !== leitura.dataColeta) {
    avisos.push('A PINEX marcou a coleta para ' + leitura.dataColeta.split('-').reverse().join('/') + ', diferente da data do envio (' + dataEnvio.split('-').reverse().join('/') + ').');
  }
  var atualizado = transporteRegistroLer_(agendaId, slot);
  return Object.assign({}, resposta, { leitura: leitura, avisos: avisos, registro: atualizado.registro, passos: transporteEnvioPassos_(atualizado.registro) });
}
