/**
 * Registro de Transporte por envio, na planilha principal.
 *
 * Substitui, para a tela nova, o registro unico da planilha de Transporte
 * (Folha C3:C15, notas e Declaracao). Uma linha por envio, chave `agendaId|slot`,
 * o que permite preparos simultaneos de envios diferentes.
 *
 * - Leitura nunca cria nem altera a aba.
 * - A aba nasce so em caminho de escrita; cabecalhos divergentes bloqueiam antes de gravar.
 * - Gravacao confere a versao dentro do lock e valida o limite de celula antes de escrever.
 * - Nao duplica o que Transporte_Operacoes guarda (PDF, rascunho, e-mail enviado).
 */
var TRANSPORTE_REGISTROS_SHEET_ = 'Transporte_Registros';
var TRANSPORTE_REGISTROS_HEADERS_ = [
  'Chave', 'Agenda_ID', 'Slot', 'Dados_JSON', 'Passo', 'Versao',
  'Atualizado_Em', 'Atualizado_Por', 'Em_Preparo_Por', 'Em_Preparo_Desde'
];
// Limite do Google Sheets por celula.
var TRANSPORTE_REGISTROS_MAX_JSON_ = 50000;

function transporteRegistroChave_(agendaId, slot) {
  var id = String(agendaId === null || agendaId === undefined ? '' : agendaId).trim();
  if (!id || id.indexOf('|') >= 0) throw new Error('ID da Agenda inválido para o registro de Transporte.');
  var slotNormalizado = normalizarSlotTransporteCodex_(slot, true);
  return { chave: id + '|' + slotNormalizado, agendaId: id, slot: slotNormalizado };
}

// Somente leitura: devolve a aba existente ou null. Nunca cria nem migra.
function transporteRegistrosSheetLeitura_() {
  var ss = typeof getCodexSpreadsheet_ === 'function' ? getCodexSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(TRANSPORTE_REGISTROS_SHEET_);
}

function transporteRegistrosValidarCabecalhos_(sh) {
  var n = TRANSPORTE_REGISTROS_HEADERS_.length;
  var headers = sh.getRange(1, 1, 1, n).getValues()[0];
  for (var i = 0; i < n; i++) {
    if (headers[i] !== TRANSPORTE_REGISTROS_HEADERS_[i]) {
      throw new Error('Cabeçalhos de Transporte_Registros incompatíveis. Revise a aba antes de gravar.');
    }
  }
}

// Caminho de escrita: cria a aba (oculta) quando ausente; valida cabecalhos quando existe.
function transporteRegistrosSheetEscrita_() {
  var ss = typeof getCodexSpreadsheet_ === 'function' ? getCodexSpreadsheet_() : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TRANSPORTE_REGISTROS_SHEET_);
  if (sh) {
    transporteRegistrosValidarCabecalhos_(sh);
    return sh;
  }
  sh = ss.insertSheet(TRANSPORTE_REGISTROS_SHEET_);
  sh.getRange(1, 1, 1, TRANSPORTE_REGISTROS_HEADERS_.length).setValues([TRANSPORTE_REGISTROS_HEADERS_]);
  // Chave e ID em texto: evita que IDs como 1417e053 virem notacao cientifica.
  var textoAZ = sh.getRange('A:C');
  if (textoAZ.setNumberFormat) textoAZ.setNumberFormat('@');
  if (sh.setFrozenRows) sh.setFrozenRows(1);
  if (sh.hideSheet) sh.hideSheet();
  return sh;
}

function transporteRegistroLinhaParaObjeto_(row, numeroLinha) {
  var registro = null;
  var texto = String(row[3] || '');
  if (texto) {
    try {
      registro = JSON.parse(texto);
    } catch (e) {
      throw new Error('Registro de Transporte ilegível (linha ' + numeroLinha + '). Revise a aba Transporte_Registros.', { cause: e });
    }
  }
  return {
    existe: true,
    linha: numeroLinha,
    chave: String(row[0] || ''),
    agendaId: String(row[1] || ''),
    slot: String(row[2] || ''),
    registro: registro,
    passo: String(row[4] || ''),
    versao: Number(row[5]) || 0,
    atualizadoEm: row[6] instanceof Date ? row[6].toISOString() : String(row[6] || ''),
    atualizadoPor: String(row[7] || ''),
    emPreparoPor: String(row[8] || ''),
    emPreparoDesde: row[9] instanceof Date ? row[9].toISOString() : String(row[9] || '')
  };
}

// Leitura de um envio. Sem aba ou sem linha: { existe: false, versao: 0 }. Uma leitura da aba.
function transporteRegistroLer_(agendaId, slot) {
  var k = transporteRegistroChave_(agendaId, slot);
  var vazio = { existe: false, chave: k.chave, agendaId: k.agendaId, slot: k.slot, registro: null, passo: '', versao: 0, emPreparoPor: '', emPreparoDesde: '' };
  var sh = transporteRegistrosSheetLeitura_();
  if (!sh) return vazio;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return vazio;
  var width = TRANSPORTE_REGISTROS_HEADERS_.length;
  var valores = sh.getRange(1, 1, lastRow, width).getValues();
  transporteRegistrosCabecalhosDe_(valores[0]);
  for (var i = valores.length - 1; i >= 1; i--) {
    if (String(valores[i][0]) === k.chave) return transporteRegistroLinhaParaObjeto_(valores[i], i + 1);
  }
  return vazio;
}

function transporteRegistrosCabecalhosDe_(headers) {
  for (var i = 0; i < TRANSPORTE_REGISTROS_HEADERS_.length; i++) {
    if (headers[i] !== TRANSPORTE_REGISTROS_HEADERS_[i]) {
      throw new Error('Cabeçalhos de Transporte_Registros incompatíveis. Revise a aba antes de usar.');
    }
  }
}

// Valida e serializa antes de qualquer escrita (limite de celula).
function transporteRegistroSerializar_(registro) {
  if (!registro || typeof registro !== 'object' || Array.isArray(registro)) {
    throw new Error('Registro de Transporte inválido.');
  }
  var json = JSON.stringify(registro);
  if (json.length > TRANSPORTE_REGISTROS_MAX_JSON_) {
    throw new Error('O registro deste transporte ficou grande demais para ser salvo (' + json.length + ' de ' +
      TRANSPORTE_REGISTROS_MAX_JSON_ + ' caracteres). Reduza as observações ou os materiais.');
  }
  return json;
}

/**
 * Preparo de um envio por uma pessoa de cada vez.
 *
 * Em_Preparo_Por guarda o e-mail (minusculo) de quem esta preparando e Em_Preparo_Desde o ultimo
 * sinal de atividade dele (reivindicar de novo ou gravar renova). Passado
 * TRANSPORTE_PREPARO_EXPIRA_MS_ sem sinal, o preparo expira e outra pessoa pode assumir.
 * Duas pessoas nunca preparam o mesmo envio; envios diferentes seguem em paralelo.
 */
var TRANSPORTE_PREPARO_EXPIRA_MS_ = 15 * 60 * 1000;

function transporteRegistroUsuario_(usuario) {
  return String(usuario === null || usuario === undefined ? '' : usuario).trim().toLowerCase();
}

function transporteRegistroTempo_(valor) {
  if (valor instanceof Date) return valor.getTime();
  var t = new Date(String(valor || '')).getTime();
  return isNaN(t) ? 0 : t;
}

// Dono ativo de uma linha lida (ou null). agora: Date (injetavel nos testes).
function transporteRegistroDonoAtivo_(linha, agora) {
  if (!linha || !linha.emPreparoPor) return null;
  var ultimo = transporteRegistroTempo_(linha.emPreparoDesde);
  var decorrido = agora.getTime() - ultimo;
  // Sinal ausente, no futuro (alem de 1 min de tolerancia de relogio) ou antigo: preparo expirado.
  if (!ultimo || decorrido < -60000 || decorrido >= TRANSPORTE_PREPARO_EXPIRA_MS_) return null;
  return { por: linha.emPreparoPor, desde: linha.emPreparoDesde };
}

function transporteRegistroErro_(codigo, mensagem, extra) {
  var erro = new Error(mensagem);
  erro.code = codigo;
  if (extra) Object.keys(extra).forEach(function(chave) { erro[chave] = extra[chave]; });
  return erro;
}

// Localiza a linha da chave na aba (0 se nao existe). Uma leitura da coluna A.
function transporteRegistroLinhaDaChave_(sh, chave) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var chaves = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = chaves.length - 1; i >= 0; i--) {
    if (String(chaves[i][0]) === chave) return i + 2;
  }
  return 0;
}

/**
 * Grava o registro de um envio com conferencia de versao e de dono do preparo.
 * opcoes: { versaoEsperada (obrigatoria; 0 = envio novo), usuario, passo,
 *           agora (Date; so testes; as rotas expostas ao cliente nunca devem repassa-lo) }.
 * O dono do preparo so muda por transporteEnvioReivindicar_/Liberar_. Devolve perdeuPreparo=true
 * quando quem grava era o dono e o preparo expirou (outra pessoa pode ter assumido).
 * Dentro do lock curto: (1) preparo ativo de outra pessoa recusa a gravacao
 * ('TRANSPORTE_REGISTRO_EM_PREPARO'); (2) versao diferente recusa ('TRANSPORTE_REGISTRO_VERSAO').
 * Quem grava e e o dono ativo renova o preparo. Nada e gravado quando recusa.
 */
function transporteRegistroGravar_(agendaId, slot, registro, opcoes) {
  opcoes = opcoes || {};
  var k = transporteRegistroChave_(agendaId, slot);
  var json = transporteRegistroSerializar_(registro);
  if (opcoes.versaoEsperada === undefined || opcoes.versaoEsperada === null || isNaN(Number(opcoes.versaoEsperada))) {
    throw new Error('Versão esperada do registro de Transporte não informada.');
  }
  var esperada = Number(opcoes.versaoEsperada);
  var usuario = transporteRegistroUsuario_(opcoes.usuario);
  return codexWithDocumentLock_('transporteRegistroGravar', function() {
    var agora = opcoes.agora || new Date();
    var sh = transporteRegistrosSheetEscrita_();
    var width = TRANSPORTE_REGISTROS_HEADERS_.length;
    var linha = transporteRegistroLinhaDaChave_(sh, k.chave);
    var atual = linha ? transporteRegistroLinhaParaObjeto_(sh.getRange(linha, 1, 1, width).getValues()[0], linha) : null;
    var dono = transporteRegistroDonoAtivo_(atual, agora);
    if (dono && dono.por !== usuario) {
      throw transporteRegistroErro_('TRANSPORTE_REGISTRO_EM_PREPARO', 'Este transporte está sendo preparado por outra pessoa agora.', { emPreparoPor: dono.por });
    }
    var versaoAtual = atual ? atual.versao : 0;
    if (versaoAtual !== esperada) {
      throw transporteRegistroErro_('TRANSPORTE_REGISTRO_VERSAO', 'Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.');
    }
    var versao = versaoAtual + 1;
    // Quem era dono, deixou o preparo expirar e grava: avisa que outra pessoa pode assumir.
    var perdeuPreparo = !!(atual && atual.emPreparoPor === usuario && usuario && !dono);
    // Dono ativo: renova o sinal. Preparo expirado nao fica como dono: quem grava sem reivindicar nao o herda.
    var emPreparoPor = dono ? atual.emPreparoPor : '';
    var emPreparoDesde = dono ? agora.toISOString() : '';
    var passo = opcoes.passo !== undefined ? String(opcoes.passo || '') : (atual ? atual.passo : '');
    var valores = [[k.chave, k.agendaId, k.slot, json, passo, versao, agora.toISOString(),
      String(opcoes.usuario || ''), emPreparoPor, emPreparoDesde]];
    var destino = linha || (sh.getLastRow() + 1);
    sh.getRange(destino, 1, 1, width).setValues(valores);
    return { chave: k.chave, linha: destino, versao: versao, atualizadoEm: valores[0][6], passo: passo, perdeuPreparo: perdeuPreparo };
  });
}

/**
 * Assume (ou renova) o preparo de um envio para o usuario. Cria a linha, sem registro, se ainda
 * nao existe. Outra pessoa com preparo ativo: { ok: false, emPreparoPor }. Nao altera a versao
 * (ela conta so mudancas nos dados). Lock curto.
 */
function transporteEnvioReivindicar_(agendaId, slot, usuario, opcoes) {
  opcoes = opcoes || {};
  var k = transporteRegistroChave_(agendaId, slot);
  var quem = transporteRegistroUsuario_(usuario);
  if (!quem) throw new Error('Usuário do preparo não identificado.');
  return codexWithDocumentLock_('transporteEnvioReivindicar', function() {
    var agora = opcoes.agora || new Date();
    var sh = transporteRegistrosSheetEscrita_();
    var width = TRANSPORTE_REGISTROS_HEADERS_.length;
    var linha = transporteRegistroLinhaDaChave_(sh, k.chave);
    var atual = linha ? transporteRegistroLinhaParaObjeto_(sh.getRange(linha, 1, 1, width).getValues()[0], linha) : null;
    var dono = transporteRegistroDonoAtivo_(atual, agora);
    if (dono && dono.por !== quem) return { ok: false, emPreparoPor: dono.por, versao: atual.versao };
    if (!atual) {
      sh.getRange(sh.getLastRow() + 1, 1, 1, width).setValues([[k.chave, k.agendaId, k.slot, '', '', 0, agora.toISOString(), quem, quem, agora.toISOString()]]);
      return { ok: true, versao: 0, assumiu: true };
    }
    // Atualiza so os campos do dono; o resto da linha (dados, passo, versao) fica como esta.
    sh.getRange(linha, 9, 1, 2).setValues([[quem, agora.toISOString()]]);
    return { ok: true, versao: atual.versao, assumiu: !dono };
  });
}

// Libera o preparo se ele ainda e do usuario (ou ja expirou). Nao mexe nos dados.
function transporteEnvioLiberar_(agendaId, slot, usuario, opcoes) {
  opcoes = opcoes || {};
  var k = transporteRegistroChave_(agendaId, slot);
  var quem = transporteRegistroUsuario_(usuario);
  return codexWithDocumentLock_('transporteEnvioLiberar', function() {
    var agora = opcoes.agora || new Date();
    var sh = transporteRegistrosSheetLeitura_();
    if (!sh) return { ok: true, liberou: false };
    transporteRegistrosValidarCabecalhos_(sh);
    var linha = transporteRegistroLinhaDaChave_(sh, k.chave);
    if (!linha) return { ok: true, liberou: false };
    var atual = transporteRegistroLinhaParaObjeto_(sh.getRange(linha, 1, 1, TRANSPORTE_REGISTROS_HEADERS_.length).getValues()[0], linha);
    var dono = transporteRegistroDonoAtivo_(atual, agora);
    if (dono && dono.por !== quem) return { ok: false, emPreparoPor: dono.por };
    if (!atual.emPreparoPor) return { ok: true, liberou: false };
    sh.getRange(linha, 9, 1, 2).setValues([['', '']]);
    return { ok: true, liberou: true };
  });
}

// Dentro do lock: recusa quando outra pessoa tem o preparo ativo do envio (sem dono ativo, segue).
function transporteEnvioConferirDono_(agendaId, slot, usuario, agora) {
  var k = transporteRegistroChave_(agendaId, slot);
  var quem = transporteRegistroUsuario_(usuario);
  if (!quem) throw new Error('Usuário do preparo não identificado.');
  var sh = transporteRegistrosSheetLeitura_();
  if (!sh) throw new Error('Registro de Transporte não encontrado para este envio.');
  transporteRegistrosValidarCabecalhos_(sh);
  var linha = transporteRegistroLinhaDaChave_(sh, k.chave);
  if (!linha) throw new Error('Registro de Transporte não encontrado para este envio.');
  var atual = transporteRegistroLinhaParaObjeto_(sh.getRange(linha, 1, 1, TRANSPORTE_REGISTROS_HEADERS_.length).getValues()[0], linha);
  var dono = transporteRegistroDonoAtivo_(atual, agora);
  if (dono && dono.por !== quem) {
    throw transporteRegistroErro_('TRANSPORTE_REGISTRO_EM_PREPARO', 'Este transporte está sendo preparado por outra pessoa agora.', { emPreparoPor: dono.por });
  }
  return atual;
}

/**
 * Reserva de AWB do envio, em lock curto e fora da geracao de PDF/rascunho.
 * Usa a AWB do registro GRAVADO (nunca a do navegador) e recusa se outra pessoa preparar o envio.
 * Mesmo contrato de unicidade de transporteAwbReservar_ (docs/AWB_UNICIDADE.md), sem a
 * preservacao do formulario manual da planilha de Transporte, que nao existe neste fluxo.
 * AWB vazia nao reserva nada. opcoes: { strict (padrao true), agora }.
 */
function transporteAwbReservarEnvio_(agendaId, slot, usuario, opcoes) {
  opcoes = opcoes || {};
  return codexWithDocumentLock_('transporteAwbReservarEnvio', function() {
    var atual = transporteEnvioConferirDono_(agendaId, slot, usuario, opcoes.agora || new Date());
    var registro = atual.registro;
    if (!registro) throw new Error('Registro de Transporte não encontrado para este envio.');
    if (!String(registro.awb || '').trim()) return { reservada: false };
    var idAgenda = String(registro.idAgenda || '').trim();
    if (!idAgenda) throw new Error('Envio sem vínculo com a Agenda: a AWB não pode ser reservada.');
    var context = agendaAwbContextoFocado_(getAgendaSheetForRead_(), registro.awb, [idAgenda]);
    agendaAwbReservar_(context, [transporteAwbRegistro_(registro)], opcoes.strict !== false);
    return { reservada: true, awb: registro.awb };
  });
}

/**
 * Marca a documentacao gerada em Transporte_Operacoes sob lock curto (idempotente por Agenda ID e slot
 * para o mesmo PDF) e recusa se outra pessoa prepara o envio. A base de cobranca, que le a Agenda
 * inteira, roda depois de liberar o lock; falha nela nao desfaz o registro.
 */
function transporteOperacaoRegistrarEnvio_(info, usuario, opcoes) {
  opcoes = opcoes || {};
  info = info || {};
  var resultado = codexWithDocumentLock_('transporteOperacaoRegistrarEnvio', function() {
    transporteEnvioConferirDono_(info.agendaId, info.slot, usuario, opcoes.agora || new Date());
    return transporteRegistrarDocumentacaoGerada_(Object.assign({}, info, { adiarBaseCobranca: true }));
  });
  var base = resultado && resultado.baseCobranca;
  if (base && typeof courierLembreteRegistrarBase_ === 'function') {
    try {
      codexWithDocumentLock_('transporteOperacaoBaseCobranca', function() {
        courierLembreteRegistrarBase_(base.agendaId, base.slot, base.now, base.vinculoIniciadoEm);
      });
    } catch (lembreteError) {
      Logger.log('Base de cobrança não registrada: ' + String(lembreteError.message || lembreteError));
    }
  }
  return resultado;
}

// Dados dos documentos a partir do registro do envio. Nao abre a planilha de Transporte.
function transporteRegistroDocsDados_(agendaId, slot, opcoes) {
  var lido = transporteRegistroLer_(agendaId, slot);
  if (!lido.existe || !lido.registro) throw new Error('Registro de Transporte não encontrado para este envio.');
  return transporteDocsDados_(lido.registro, opcoes);
}
