/**
 * Tarefas de Transporte para a tela nova (todos os perfis leem; agir exige perfil que edita).
 *
 * Unidade da tarefa: a visita (agendaId). Uma visita com varios transportes e uma tarefa, com a
 * lista de transportes. Um transporte entra na lista "Para fazer" ate 7 dias uteis antes da data (TRANSPORTE_TAREFAS_JANELA_DIAS_UTEIS_)
 * (depois fica em "Mais adiante"); documentos ja gerados e ainda nao enviados aparecem sempre.
 * Backup nao gera tarefa. Somente leitura: nao cria aba, nao adquire lock e nao escreve.
 */
var TRANSPORTE_TAREFAS_JANELA_DIAS_UTEIS_ = 7;
// Status da Agenda em que um envio PINEX ainda pode aguardar os numeros (depois de Confirmado, o registro e antigo).
var TRANSPORTE_TAREFAS_STATUS_PINEX_RESPOSTA_ = ['naoagendado', 'pendente', 'docsgerados', 'agendado'];
var TRANSPORTE_TAREFAS_SLOTS_ = [['1', 'Transporte I', 'c1'], ['2', 'Transporte II', 'c2'], ['3', 'Transporte III', 'c3'], ['4', 'Transporte IV', 'c4']];

/**
 * Resumo do preparo de cada envio, em 1 leitura da aba (o JSON e lido, mas nao interpretado nem devolvido).
 * Devolve { chave: { passo, versao, emPreparoPor, emPreparoDesde } }. Sem aba: {}. Nao altera schema.
 */
function transporteRegistrosResumo_() {
  var sh = transporteRegistrosSheetLeitura_();
  if (!sh) return {};
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return {};
  // Uma leitura so (cabecalho + linhas): cada chamada ao Sheets tem custo fixo maior que o das celulas a mais.
  var valores = sh.getRange(1, 1, lastRow, TRANSPORTE_REGISTROS_HEADERS_.length).getValues();
  transporteRegistrosCabecalhosDe_(valores[0]);
  var out = {};
  for (var n = 1; n < valores.length; n++) {
    var linha = valores[n];
    var chave = String(linha[0] || '');
    if (!chave) continue;
    // Fase da PINEX, GRU e numero do passo vem do texto do JSON por expressao regular: sem parse e sem guardar o JSON.
    var dados = String(linha[3] || '');
    out[chave] = {
      passo: String(linha[4] || ''),
      versao: Number(linha[5]) || 0,
      emPreparoPor: String(linha[8] || '').trim().toLowerCase(),
      emPreparoDesde: linha[9] instanceof Date ? linha[9].toISOString() : String(linha[9] || ''),
      fasePinex: (/"fasePinex":"(\w+)"/.exec(dados) || [])[1] || '',
      gruPronta: /"gruPronta":true/.test(dados),
      passoNumero: Number((/"passoNumero":(\d+)/.exec(dados) || [])[1]) || 0
    };
  }
  return out;
}

// Operacao ativa com PDF gerado e sem e-mail identificado/enviado.
function transporteTarefaDocsPendentes_(operacoes) {
  var porChave = {};
  (operacoes || []).forEach(function(op) {
    if (op.estado === 'INATIVA' || !op.pdfId || op.emailEnviadoEm || op.emailIdentificadoEm) return;
    porChave[op.agendaId + '|' + op.slot] = op;
  });
  return porChave;
}

/**
 * PINEX: o pedido de coleta (Formulario, courier "PINEX (Agendamento)") ja saiu quando uma operacao dele teve o
 * e-mail identificado ou enviado. Vale mesmo inativada: a Agenda guarda "Pinex" e a reconciliacao da Agenda inativa
 * a operacao do Formulario na edicao seguinte da linha (por exemplo, ao lancar a AWB recebida da PINEX).
 */
function transporteTarefaPinexPedidos_(operacoes) {
  var porChave = {};
  (operacoes || []).forEach(function(op) {
    if (!transporteEnvioFamiliaPinex_(op.courier) || normText_(op.courier).indexOf('agendamento') < 0) return;
    if (op.emailEnviadoEm || op.emailIdentificadoEm) porChave[op.agendaId + '|' + op.slot] = true;
  });
  return porChave;
}

// Fase PINEX do registro; sem registro (ou parado no Formulario) e com o pedido ja enviado, a AWB da Agenda separa
// "aguardando os numeros" de "numeros recebidos, gerar os documentos".
function transporteTarefaFasePinex_(preparo, pedidoEnviado, awb) {
  var fase = (preparo && preparo.fasePinex) || '';
  if (pedidoEnviado && (!fase || fase === 'agendamento')) return String(awb || '').trim() ? 'documentos' : 'resposta';
  return fase;
}

function transporteTarefaTitulo_(situacoes, gruPronta) {
  if (gruPronta && situacoes.indexOf('enviar_doc') >= 0 && situacoes.indexOf('preparar') < 0) return 'Anexar a GRU e o extrato e enviar à courier';
  var preparar = situacoes.filter(function(s) { return s === 'preparar'; }).length;
  if (preparar === 1) return 'Preparar o transporte';
  if (preparar > 1) return 'Preparar ' + preparar + ' transportes';
  if (situacoes.indexOf('pinex_pedir') >= 0) return 'Pedir a coleta à PINEX';
  if (situacoes.indexOf('pinex_numeros') >= 0) return 'Informar os números da PINEX';
  return 'Enviar o pedido de coleta à courier';
}

function transporteTarefaPrazoLabel_(horas) {
  if (horas === null || horas === undefined || !isFinite(Number(horas)) || Number(horas) > 24) return '';
  var h = Number(horas);
  if (h < 0) return 'Atrasada';
  if (h < 1) return 'Agora';
  if (h < 2) return 'Em 1h';
  return 'Em ' + Math.round(h) + 'h';
}

function transporteTarefaFmtData_(d) {
  return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
}

// Dia em que o transporte vira tarefa: o (janela + 1)o dia operacional mais recente ate a data.
function transporteTarefaDataVira_(data, feriados) {
  var cursor = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  var achados = 0;
  for (var voltas = 0; voltas < 400; voltas++) {
    if (isDiaOperacionalPendencia_(cursor, feriados || {})) {
      achados++;
      if (achados === TRANSPORTE_TAREFAS_JANELA_DIAS_UTEIS_ + 1) return cursor;
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return cursor;
}

function transporteTarefaSemana_(data) {
  var segunda = new Date(data.getFullYear(), data.getMonth(), data.getDate() - ((data.getDay() + 6) % 7));
  var domingo = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6);
  return { chave: transporteTarefaFmtData_(segunda), rotulo: 'Semana de ' + transporteTarefaFmtData_(segunda).slice(0, 5) + ' a ' + transporteTarefaFmtData_(domingo).slice(0, 5), ordem: segunda.getTime() };
}

/**
 * Acompanhamento de uma linha da Agenda (mesmas regras das Pendencias, sem nova leitura):
 * Backups nao agendados (qualquer data), transportes enviados e nao entregues (qualquer data) e
 * transportes agendados aguardando confirmacao (so de hoje em diante) e confirmados (qualquer data).
 */
function transporteAcompanharLinha_(r, ctx, saida, hoje, pinexPedidos) {
  var i = AGENDA_CFG.idx;
  var data = parseAgendaDateAny_(r[i.data]);
  if (data) data.setHours(0, 0, 0, 0);
  var passada = !!data && data.getTime() < hoje.getTime();
  var prazoHoras;
  var calculado = false;
  function base() {
    if (!calculado) { prazoHoras = prazoHorasPendenciaAgenda_(r[i.data], r[i.hora], ctx.feriados); calculado = true; }
    return {
      agendaId: String(r[i.id] || '').trim(), data: String(r[i.data] || ''), hora: String(r[i.hora] || ''),
      // Data numerica (meia-noite local) para a tela destacar dia, mes e dia da semana; null sem data valida.
      dataOrdem: data ? data.getTime() : null,
      prazoHoras: prazoHoras, prazoLabel: transporteTarefaPrazoLabel_(prazoHoras),
      participante: String(r[i.participante] || ''), projeto: String(r[i.projeto] || ''), visita: String(r[i.visita] || '')
    };
  }
  var backupNome = String(r[i.cb.nome] || '').trim();
  if (isCourierNomeValidoAgenda_(backupNome) && AgendaServerRules_.courierStatusKey(String(r[i.cb.status] || '')) === 'naoagendado') {
    saida.backups.push(Object.assign(base(), { slotRotulo: 'Backup', courier: backupNome, temperatura: String(r[i.cb.temp] || '').trim(),
      destino: String(r[i.cb.destino] || '').trim(), statusCourier: String(r[i.cb.status] || '').trim() }));
  }
  var backup2 = agendaBackup2FromRow_(r);
  if (isCourierNomeValidoAgenda_(backup2.nome) && AgendaServerRules_.courierStatusKey(backup2.status) === 'naoagendado') {
    saida.backups.push(Object.assign(base(), { slotRotulo: 'Backup II', courier: backup2.nome, temperatura: backup2.temperatura,
      destino: backup2.destino, statusCourier: backup2.status }));
  }
  TRANSPORTE_TAREFAS_SLOTS_.forEach(function(slot) {
    var cfg = i[slot[2]];
    var nome = String(r[cfg.nome] || '').trim();
    if (!isCourierNomeValidoAgenda_(nome)) return;
    var statusTexto = String(r[cfg.status] || '');
    var status = AgendaServerRules_.courierStatusKey(statusTexto);
    if (status === 'naoaplicavel') return;
    var awb = String(r[cfg.awb] || '').trim();
    var familiaPinex = transporteEnvioFamiliaPinex_(nome);
    var chavePinex = String(r[i.id] || '').trim() + '|' + slot[0];
    var fase = familiaPinex ? transporteTarefaFasePinex_((ctx.preparos || {})[chavePinex], !!(pinexPedidos || {})[chavePinex], awb) : '';
    if (status === 'peticionamento') {
      // GRU e extrato pendentes: acompanhamento (a acao "GRU e extrato prontos" e dos autorizados a peticionar).
      saida.peticionamento.push(Object.assign(base(), { slot: slot[0], slotRotulo: slot[1], courier: nome, temperatura: String(r[cfg.temp] || '').trim(),
        destino: String(r[cfg.destino] || '').trim(), awb: awb, statusCourier: statusTexto }));
    } else if (status === 'enviado') {
      // Dias corridos desde a data do envio na Agenda (null sem data valida ou com data futura).
      var diasDesdeEnvio = data && data.getTime() <= hoje.getTime() ? Math.round((hoje.getTime() - data.getTime()) / 86400000) : null;
      saida.transito.push(Object.assign(base(), { slot: slot[0], slotRotulo: slot[1], courier: nome, temperatura: String(r[cfg.temp] || '').trim(),
        destino: String(r[cfg.destino] || '').trim(), awb: awb, trackingUrl: agendaTrackingUrl_(awb, nome), statusCourier: statusTexto,
        diasDesdeEnvio: diasDesdeEnvio,
        // A data e a do envio, ja feito: nao ha prazo a cumprir. Como no cartao "AWB enviada nao entregue" das
        // Pendencias (sem prioridade), o item em transito nunca fica vermelho nem "Atrasada".
        prazoHoras: null, prazoLabel: '' }));
    } else if (familiaPinex && fase === 'resposta' && !passada && TRANSPORTE_TAREFAS_STATUS_PINEX_RESPOSTA_.indexOf(status) >= 0) {
      // Como na tarefa: um registro parado em "resposta" nao esconde o transporte ja Confirmado (vai para Confirmadas).
      saida.pinex.push(Object.assign(base(), { slot: slot[0], slotRotulo: slot[1], courier: nome, temperatura: String(r[cfg.temp] || '').trim(),
        destino: String(r[cfg.destino] || '').trim(), awb: awb, statusCourier: statusTexto }));
    } else if (status === 'agendado' && !passada) {
      var aguardando = Object.assign(base(), { slot: slot[0], slotRotulo: slot[1], courier: nome, temperatura: String(r[cfg.temp] || '').trim(),
        destino: String(r[cfg.destino] || '').trim(), awb: awb, statusCourier: statusTexto });
      saida.confirmacao.push(aguardando);
    } else if (status === 'confirmado' && normText_(statusTexto).indexOf('colet') < 0) {
      // Retirada confirmada pela courier e ainda nao feita (qualquer data): aba "Confirmadas". "Coletado" fica fora.
      // Marcar como enviada so a partir da data da visita; cancelar so de hoje em diante.
      // Sem prazo nem vermelho: a coleta esta combinada, nao ha nada atrasado a fazer.
      saida.confirmadas.push(Object.assign(base(), { slot: slot[0], slotRotulo: slot[1], courier: nome, temperatura: String(r[cfg.temp] || '').trim(),
        destino: String(r[cfg.destino] || '').trim(), awb: awb, trackingUrl: agendaTrackingUrl_(awb, nome), statusCourier: statusTexto,
        podeEnviar: !!data && data.getTime() <= hoje.getTime(), podeCancelar: !!data && !passada, prazoHoras: null, prazoLabel: '' }));
    }
  });
}

/**
 * Nucleo puro (testavel): linhas da Agenda + operacoes + resumo dos preparos -> tarefas.
 * ctx: { hoje: Date, feriados: map, linhas: [], operacoes: [], preparos: {}, agora: Date, nomes: { email: nome } }.
 */
function transporteTarefasConstruir_(ctx) {
  var i = AGENDA_CFG.idx;
  var hoje = new Date(ctx.hoje.getFullYear(), ctx.hoje.getMonth(), ctx.hoje.getDate());
  var docs = transporteTarefaDocsPendentes_(ctx.operacoes);
  var pinexPedidos = transporteTarefaPinexPedidos_(ctx.operacoes);
  var tarefas = [];
  var adiante = { transportes: 0, visitas: 0, primeiraData: '' };
  var primeiraAdiante = null;
  var adianteItens = [];
  var acompanhar = { peticionamento: [], confirmacao: [], pinex: [], transito: [], confirmadas: [], backups: [] };
  (ctx.linhas || []).forEach(function(r) {
    var agendaId = String(r[i.id] || '').trim();
    if (!agendaId) return;
    if (AgendaServerRules_.isCancelled(normText_(r[i.status]))) return;
    transporteAcompanharLinha_(r, ctx, acompanhar, hoje, pinexPedidos);
    var data = parseAgendaDateAny_(r[i.data]);
    if (!data) return;
    data.setHours(0, 0, 0, 0);
    if (data.getTime() < hoje.getTime()) return;
    var dentro = diasUteisAtePendencia_(hoje, data, ctx.feriados, TRANSPORTE_TAREFAS_JANELA_DIAS_UTEIS_) <= TRANSPORTE_TAREFAS_JANELA_DIAS_UTEIS_;
    var transportes = [];
    var transportesAdiante = 0;
    TRANSPORTE_TAREFAS_SLOTS_.forEach(function(slot) {
      var cfg = i[slot[2]];
      var nome = String(r[cfg.nome] || '').trim();
      if (!isCourierNomeValidoAgenda_(nome)) return;
      var statusTexto = String(r[cfg.status] || '');
      var status = AgendaServerRules_.courierStatusKey(statusTexto);
      if (status === 'naoaplicavel') return;
      var awb = String(r[cfg.awb] || '').trim();
      var chaveEnvio = agendaId + '|' + slot[0];
      var situacao = '';
      var pedidoPinex = transporteEnvioFamiliaPinex_(nome) && !!pinexPedidos[chaveEnvio];
      var fasePinex = transporteEnvioFamiliaPinex_(nome) ? transporteTarefaFasePinex_(ctx.preparos[chaveEnvio], pedidoPinex, awb) : '';
      // Aguardando a resposta da PINEX: tarefa "Informar os números da PINEX" (o item tambem fica em Acompanhar).
      var pinexResposta = fasePinex === 'resposta' && TRANSPORTE_TAREFAS_STATUS_PINEX_RESPOSTA_.indexOf(status) >= 0;
      var preparoEnvio = ctx.preparos[chaveEnvio] || null;
      if (pinexResposta) situacao = 'pinex_numeros';
      // Envio internacional parado no formulario ANVISA (por concluir, ou ja enviado sem o status da Agenda ter
      // mudado, por falha na troca): falta concluir o passo ANVISA, nao enviar a courier.
      else if (preparoEnvio && ['anvisa', 'peticionando'].indexOf(preparoEnvio.passo) >= 0 && status === 'docsgerados') situacao = 'preparar';
      // Status Agendado: o pedido de coleta ja saiu (o monitor so promove a Agendado ao achar o e-mail enviado). Um PDF
      // gerado depois disso, como o da DHL congelado com a WB recebida na resposta da courier, e para imprimir: sem tarefa.
      else if (docs[chaveEnvio] && ['naoagendado', 'pendente', 'docsgerados'].indexOf(status) >= 0) situacao = 'enviar_doc';
      // PINEX com o pedido de coleta ja enviado e a AWB recebida, sem documento pendente: "Docs gerados" e do
      // Formulario ja usado. Falta gerar os documentos da PINEX.
      // A PINEX nao registra operacao no monitor: com os documentos dela ja gerados no passo a passo (GRU pronta, ou
      // passo de envio), o que falta e enviar, nao preparar.
      else if (pedidoPinex && fasePinex === 'documentos' && ['naoagendado', 'pendente', 'docsgerados'].indexOf(status) >= 0) {
        situacao = preparoEnvio && (preparoEnvio.gruPronta || ['enviar', 'concluido'].indexOf(preparoEnvio.passo) >= 0) ? 'enviar_doc' : 'preparar';
      }
      else if (status === 'docsgerados') situacao = 'enviar_doc';
      else if (AgendaServerRules_.courierNeedsSchedule(statusTexto, awb)) {
        situacao = transporteEnvioFamiliaPinex_(nome) && fasePinex !== 'documentos' ? 'pinex_pedir' : 'preparar';
      }
      if (!situacao) return;
      if (!dentro && situacao !== 'enviar_doc') {
        transportesAdiante++;
        adianteItens.push({ agendaId: agendaId, data: String(r[i.data] || ''), hora: String(r[i.hora] || ''), dataOrdem: data.getTime(),
          participante: String(r[i.participante] || ''), projeto: String(r[i.projeto] || ''), visita: String(r[i.visita] || ''),
          slot: slot[0], slotRotulo: slot[1], courier: nome, temperatura: String(r[cfg.temp] || '').trim(), destino: String(r[cfg.destino] || '').trim(),
          situacao: situacao, viraTarefaEm: transporteTarefaFmtData_(transporteTarefaDataVira_(data, ctx.feriados)) });
        return;
      }
      var preparo = ctx.preparos[chaveEnvio] || null;
      var dono = preparo ? transporteRegistroDonoAtivo_({ emPreparoPor: preparo.emPreparoPor, emPreparoDesde: preparo.emPreparoDesde }, ctx.agora) : null;
      transportes.push({
        slot: slot[0], slotRotulo: slot[1], courier: nome, temperatura: String(r[cfg.temp] || '').trim(),
        destino: String(r[cfg.destino] || '').trim(), awb: awb, situacao: situacao,
        passo: preparo ? preparo.passo : '', passoNumero: preparo ? preparo.passoNumero : 0, gruPronta: !!(preparo && preparo.gruPronta),
        comPessoa: dono ? ((ctx.nomes && ctx.nomes[dono.por]) || dono.por) : '',
        comEmail: dono ? dono.por : ''
      });
    });
    if (transportesAdiante) {
      adiante.transportes += transportesAdiante;
      adiante.visitas++;
      if (!primeiraAdiante || data.getTime() < primeiraAdiante.getTime()) primeiraAdiante = data;
    }
    if (!transportes.length) return;
    var prazoHoras = prazoHorasPendenciaAgenda_(r[i.data], r[i.hora], ctx.feriados);
    var situacoes = transportes.map(function(t) { return t.situacao; });
    var comPessoa = transportes.filter(function(t) { return t.comPessoa; })[0];
    var parou = transportes.filter(function(t) { return t.passoNumero > 0; })[0];
    tarefas.push({
      agendaId: agendaId, data: String(r[i.data] || ''), hora: String(r[i.hora] || ''),
      dataOrdem: data.getTime(), prazoHoras: prazoHoras, prazoLabel: transporteTarefaPrazoLabel_(prazoHoras),
      participante: String(r[i.participante] || ''), projeto: String(r[i.projeto] || ''), visita: String(r[i.visita] || ''),
      titulo: transporteTarefaTitulo_(situacoes, transportes.some(function(t) { return t.gruPronta; })), transportes: transportes,
      comPessoa: comPessoa ? comPessoa.comPessoa : '', comEmail: comPessoa ? comPessoa.comEmail : '',
      parouNoPasso: parou ? parou.passoNumero : 0,
      // Nome do passo (conferir, gerar, enviar...): a etiqueta diz onde parou, nao so o numero.
      parouNoPassoNome: parou ? String(parou.passo || '') : ''
    });
  });
  tarefas.sort(function(a, b) {
    if (a.dataOrdem !== b.dataOrdem) return a.dataOrdem - b.dataOrdem;
    return String(a.hora).localeCompare(String(b.hora));
  });
  if (primeiraAdiante) adiante.primeiraData = transporteTarefaFmtData_(primeiraAdiante);
  // Mais adiante: semanas em ordem, itens por data e hora.
  var porSemana = {};
  adianteItens.forEach(function(item) {
    var semana = transporteTarefaSemana_(new Date(item.dataOrdem));
    if (!porSemana[semana.chave]) porSemana[semana.chave] = { chave: semana.chave, rotulo: semana.rotulo, ordem: semana.ordem, itens: [] };
    porSemana[semana.chave].itens.push(item);
  });
  adiante.semanas = Object.keys(porSemana).map(function(k) { return porSemana[k]; }).sort(function(a, b) { return a.ordem - b.ordem; });
  adiante.semanas.forEach(function(s) {
    s.itens.sort(function(a, b) { return a.dataOrdem - b.dataOrdem || String(a.hora).localeCompare(String(b.hora)); });
  });
  ['peticionamento', 'confirmacao', 'pinex', 'transito', 'confirmadas', 'backups'].forEach(function(chave) { ordenarPendenciasAgendaPorUrgencia_(acompanhar[chave]); });
  return { tarefas: tarefas, maisAdiante: adiante, acompanhar: { peticionamento: acompanhar.peticionamento, confirmacao: acompanhar.confirmacao, pinex: acompanhar.pinex, transito: acompanhar.transito, confirmadas: acompanhar.confirmadas }, backups: acompanhar.backups };
}

// Antecedencia para pedir a caixa a courier, em dias uteis ate a coleta (a coleta conta). As demais caixas nao tem prazo.
var TRANSPORTE_CAIXA_PRAZO_DIAS_UTEIS_ = { CREDO_CUBE: 2, EXTREME_AMBIENT: 3 };

// Ultimo dia util em que ainda ha `dias` dias uteis depois dele ate a coleta (mesma conta de diasUteisAtePendencia_).
function transporteCaixaPedirAte_(coleta, dias, feriados) {
  function anterior(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); }
  // Conta para tras a partir da coleta (inclusive) ate o dia util de numero `dias`; o prazo e o dia util antes dele.
  var cursor = new Date(coleta.getFullYear(), coleta.getMonth(), coleta.getDate());
  var contados = isDiaOperacionalPendencia_(cursor, feriados || {}) ? 1 : 0;
  for (var voltas = 0; voltas < 400 && contados < dias; voltas++) {
    cursor = anterior(cursor);
    if (isDiaOperacionalPendencia_(cursor, feriados || {})) contados++;
  }
  cursor = anterior(cursor);
  for (var extra = 0; extra < 400 && !isDiaOperacionalPendencia_(cursor, feriados || {}); extra++) cursor = anterior(cursor);
  return cursor;
}

/**
 * Caixa especial de cada transporte do Para fazer e do Em breve, pela regra do projeto (como nas Pendencias):
 * { tipo, rotulo, pedirAte, atrasado }. Serve para conferir a disponibilidade antes do envio; nao le a nota da Agenda.
 */
function transporteTarefasAnotarCaixas_(resultado, regras, feriados, hoje) {
  regras = (regras || []).filter(function(regra) { return !regra.erro; });
  if (!regras.length) return;
  var inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  function anotar(t, projeto, dataOrdem) {
    var regra = transporteCaixaRegraPara_(regras, { projeto: projeto, courier: t.courier, temperatura: t.temperatura, destino: t.destino });
    if (!regra || !TRANSPORTE_CAIXA_ROTULOS_[regra.tipoCaixa]) return;
    var caixa = { tipo: regra.tipoCaixa, rotulo: TRANSPORTE_CAIXA_ROTULOS_[regra.tipoCaixa], pedirAte: '', atrasado: false };
    var dias = TRANSPORTE_CAIXA_PRAZO_DIAS_UTEIS_[regra.tipoCaixa];
    if (dias && typeof dataOrdem === 'number' && isFinite(dataOrdem)) {
      var coleta = new Date(dataOrdem);
      caixa.pedirAte = transporteTarefaFmtData_(transporteCaixaPedirAte_(coleta, dias, feriados));
      caixa.atrasado = diasUteisAtePendencia_(inicio, coleta, feriados, dias) < dias;
    }
    t.caixa = caixa;
  }
  (resultado.tarefas || []).forEach(function(tarefa) {
    (tarefa.transportes || []).forEach(function(t) { anotar(t, tarefa.projeto, tarefa.dataOrdem); });
  });
  ((resultado.maisAdiante && resultado.maisAdiante.semanas) || []).forEach(function(semana) {
    (semana.itens || []).forEach(function(item) { anotar(item, item.projeto, item.dataOrdem); });
  });
}

function transporteTarefasNomes_() {
  var nomes = {};
  try {
    var acl = typeof codexGetAllowedUsers_ === 'function' ? (codexGetAllowedUsers_() || {}) : {};
    Object.keys(acl).forEach(function(email) {
      var item = acl[email] || {};
      nomes[String(email).trim().toLowerCase()] = String(item.firstName || item.name || '').trim();
    });
  } catch (e) {
    Logger.log('Nomes do preparo de Transporte nao carregados.');
  }
  return nomes;
}

/**
 * RPC da tela nova. Qualquer perfil autorizado; sem lock; uma leitura da Agenda, uma de
 * Transporte_Operacoes e duas colunas de Transporte_Registros.
 */
function getTransporteTarefas(request) {
  var access = codexAssertCanRead_();
  var traceId = codexBootstrapTraceId_(request);
  function medir(etapa, linhas, fn) {
    return codexMeasureReadPerformance_('getTransporteTarefas', etapa, { traceId: traceId, rowCount: linhas }, fn);
  }
  return codexMeasureReadPerformance_('getTransporteTarefas', 'total', { traceId: traceId, rowCount: 0 }, function() {
    var agenda = medir('agenda_sheet', 0, function() { return getDashboardAgendaSheetForRead_(); });
    var linhas = medir('agenda_read', 0, function() { return getDashboardAgendaDisplayRows_(agenda); });
    var feriados = medir('holidays', 0, function() { return getAgendaFeriadosPendenciasMap_(); });
    var operacoes = medir('operacoes', 0, function() { return transporteOperacoesRows_(); });
    var preparos = medir('registros', 0, function() { return transporteRegistrosResumo_(); });
    var agora = new Date();
    var resultado = medir('classify', linhas.length, function() {
      return transporteTarefasConstruir_({ hoje: agora, agora: agora, feriados: feriados, linhas: linhas, operacoes: operacoes,
        preparos: preparos, nomes: transporteTarefasNomes_() });
    });
    // Regras de caixa (Projetos, couriers e laboratorios) so quando ha transporte a anotar. Informacao auxiliar:
    // falha na leitura nao derruba a lista.
    var comItens = resultado.tarefas.length || (resultado.maisAdiante.semanas || []).length;
    if (comItens) {
      medir('caixas', 0, function() {
        try {
          transporteTarefasAnotarCaixas_(resultado, transporteCaixasRegras_(), feriados, agora);
        } catch (erroCaixas) {
          Logger.log('Caixas especiais nao anotadas nas tarefas de Transporte: ' + erroCaixas.message);
        }
      });
    }
    var usuario = String(access.userEmail || access.email || '').trim().toLowerCase();
    return {
      ok: true, usuario: usuario, geradoEm: agora.toISOString(),
      janelaDiasUteis: TRANSPORTE_TAREFAS_JANELA_DIAS_UTEIS_, tarefas: resultado.tarefas, maisAdiante: resultado.maisAdiante,
      acompanhar: resultado.acompanhar, backups: resultado.backups,
      // So quem esta na lista de peticionamento ve e usa "GRU e extrato prontos" (a autorizacao real e do servidor, na acao).
      podePeticionar: transportePeticionamentoAutorizados_().indexOf(usuario) >= 0
    };
  });
}
