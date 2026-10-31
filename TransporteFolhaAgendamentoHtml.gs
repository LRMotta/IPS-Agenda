/* ===== TransporteFolhaAgendamentoHtml.gs =====
 * Folha de Agendamento do fluxo de documentos em HTML (grade). Substitui as abas
 * "Folha de Agendamento" (MARKEN/OCASA) e "Folha de Agendamento (DHL/PINEX)" somente
 * nesse fluxo; o PDF atual (imprimirTodasAbas_) continua usando as abas da planilha.
 *
 * transporteFolhaHtmlDados_ reune as fontes (registro do Transporte, Agenda,
 * LabCentral e spec do PDF) e transporteFolhaHtmlPagina_ so formata. Nada vem das
 * abas da planilha de Transporte, que sera desativada: na geracao pelo Transporte,
 * visita e origem chegam em registro.folhaAgenda (transporteAtualizarRegistroPorAgenda_)
 * e o LabCentral ja esta em memoria. A pagina usa
 * tabelas e contornos: o conversor HtmlService nao aceita flex/grid e nao imprime
 * cores de fundo. Participante sempre por iniciais e Nº de identificacao.
 */

var TRANSPORTE_FOLHA_HTML_SLOTS_ = {
  '1': 'Transporte I', '2': 'Transporte II', '3': 'Transporte III', '4': 'Transporte IV',
  backup: 'Backup I', backup2: 'Backup II'
};

var TRANSPORTE_FOLHA_HTML_DIAS_ = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Linhas para escrita manual nas observacoes (a folha DHL/PINEX tem o bloco de retirada).
var TRANSPORTE_FOLHA_HTML_LINHAS_OBS_ = 8;

var TRANSPORTE_FOLHA_HTML_CSS_ =
  '.fa{width:100%;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9.6pt;line-height:1.3}' +
  '.fa table{border-collapse:collapse;width:100%}' +
  '.fa td{vertical-align:top;padding:0}' +
  '.fa .lbl{font-size:6.6pt;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#555}' +
  '.fa .nota{font-size:7.6pt;color:#444}' +
  '.fa .mono{font-family:"Courier New",Courier,monospace}' +
  '.fa .cab td{vertical-align:middle;padding-bottom:9px;border-bottom:2px solid #000}' +
  '.fa .cab .logo{height:44px;width:auto}' +
  '.fa .titulo{font-size:16pt;font-weight:bold}' +
  '.fa .sub{font-size:8pt;color:#555}' +
  '.fa .hero{border:1.5px solid #000}' +
  '.fa .hero td{padding:11px 12px;border-left:1px solid #bdbdbd}' +
  '.fa .hero td.prim{border-left:0}' +
  '.fa .grande{font-size:16pt;font-weight:bold;line-height:1.15}' +
  '.fa .awb{font-size:13.5pt;font-weight:bold}' +
  '.fa .tipo{display:inline-block;margin-top:3px;padding:2px 8px;border:4px double #000;font-size:10.5pt;font-weight:bold;letter-spacing:.06em}' +
  '.fa .meta{border:1px solid #bdbdbd}' +
  '.fa .meta td{padding:7px 12px;border-left:1px solid #bdbdbd;font-size:9pt}' +
  '.fa .meta td.prim{border-left:0;white-space:nowrap;width:1%}' +
  '.fa .meta .lbl{margin-right:6px}' +
  '.fa .card{border:1px solid #bdbdbd;padding:10px 12px 12px}' +
  '.fa h2{margin:0 0 9px;font-size:7.8pt;font-weight:bold;letter-spacing:.1em;text-transform:uppercase}' +
  '.fa .num{display:inline-block;width:14px;height:14px;line-height:14px;margin-right:6px;border:1.3px solid #000;border-radius:50%;text-align:center;font-size:7pt;letter-spacing:0}' +
  '.fa h2 .aside{float:right;font-weight:normal;letter-spacing:0;text-transform:none;color:#555;font-size:7.6pt}' +
  '.fa .dados td{padding:3.5px 0;font-size:9.6pt}' +
  '.fa .dados td.k{width:104px;color:#555;font-size:8.4pt}' +
  '.fa .dados td.v{font-weight:bold}' +
  '.fa .tab th{text-align:left;font-size:6.6pt;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#555;padding:3px 7px;border-bottom:1.5px solid #000}' +
  '.fa .tab td{padding:6px 7px;border-bottom:1px solid #d0d0d0;font-size:9.6pt}' +
  '.fa .tab .c{text-align:center}' +
  '.fa .tab .r{text-align:right}' +
  '.fa .tab .vazio{color:#888}' +
  '.fa .tab tr.total td{font-weight:bold;border-top:1.5px solid #000;border-bottom:0}' +
  '.fa .tab td.copias{font-weight:bold;font-size:10.5pt}' +
  '.fa .obs p{margin:0 0 2px}' +
  '.fa .linha{border-bottom:1px solid #888;height:25px}' +
  '.fa .assin{border:1.5px solid #000;padding:10px 12px 14px}' +
  '.fa .assin td{vertical-align:bottom;font-size:8pt;color:#444;white-space:nowrap}' +
  '.fa .assin td.campo{border-bottom:1px solid #000;width:30%}' +
  // DHL/PINEX com muitos materiais: o bloco de assinatura exige linhas mais baixas para caber na pagina.
  '.fa.compacto .dados td{padding:1.5px 0}.fa.compacto .tab td{padding:3px 7px}.fa.compacto .linha{height:21px}' +
  '.fa.compacto .hero td{padding:8px 12px}.fa.compacto .card{padding:8px 12px 9px}' +
  '.fa .rodape td{text-align:left;border-top:1px solid #bdbdbd;padding-top:5px;font-size:7.4pt;color:#555;vertical-align:bottom}';

function transporteFolhaHtmlEsc_(value) {
  return transporteDocsHtmlEscape_(value);
}

// Data da planilha ('yyyy-MM-dd' ou Date) -> { texto: 'dd/MM/yyyy', dia: 'Terça' }.
function transporteFolhaHtmlData_(value) {
  if (!value) return { texto: '', dia: '' };
  try {
    var d = transporteDocsHtmlData_(value);
    var semana = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
    return { texto: ('0' + d.dia).slice(-2) + '/' + ('0' + d.mes).slice(-2) + '/' + d.ano, dia: TRANSPORTE_FOLHA_HTML_DIAS_[semana] };
  } catch (e) {
    return { texto: String(value), dia: '' };
  }
}

function transporteFolhaHtmlNumero_(value) {
  var n = Number(value);
  if (value === '' || value === null || value === undefined || !isFinite(n)) return '';
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

function transporteFolhaHtmlSlotLabel_(slot) {
  return TRANSPORTE_FOLHA_HTML_SLOTS_[String(slot || '').trim()] || '';
}

function transporteFolhaHtmlCourierComAssinatura_(courier) {
  var c = transporteNormalizeCourierFromCodex_(courier);
  return c === 'PINEX' || c === 'DHL';
}

/**
 * Materiais ativos da Declaracao (registro.materiais) -> linhas da folha e totais.
 * "Outro" (F30) aparece sem quantidades, como na Declaracao.
 */
function transporteFolhaHtmlMateriais_(materiais) {
  var linhas = [];
  var tubos = 0;
  var totais = {};
  (materiais || []).forEach(function(item) {
    if (!item || !item.ativo) return;
    var outro = Number(item.row) === 30;
    var unidade = outro ? '' : String(item.unit || (typeof codexMatBioItemUnit_ === 'function' ? codexMatBioItemUnit_(item) : 'mL'));
    var nTubos = Number(item.tubos);
    if (!outro && isFinite(nTubos) && item.tubos !== '') tubos += nTubos;
    var total = Number(item.total);
    if (!outro && item.total !== '' && isFinite(total)) totais[unidade] = (totais[unidade] || 0) + total;
    linhas.push({
      material: String(item.material || '').trim(),
      outro: outro,
      ensaio: String(item.ensaio || '').trim(),
      tubos: outro ? '' : String(item.tubos === 0 ? 0 : (item.tubos || '')),
      quantidade: !outro && item.formula ? String(item.formula).trim() + ' ' + unidade : '',
      total: !outro && item.total !== '' && isFinite(total) ? transporteFolhaHtmlNumero_(total) + ' ' + unidade : ''
    });
  });
  var totalTexto = ['mL', 'L', 'g'].filter(function(u) { return totais[u]; }).map(function(u) {
    return transporteFolhaHtmlNumero_(totais[u]) + ' ' + u;
  }).join(' · ');
  return { linhas: linhas, tubos: tubos, total: totalTexto };
}

/**
 * Contexto da Agenda: visita do agendamento e, para envio criado a partir de um
 * Backup, o agendamento de origem. O vinculo estruturado fica no agendamento de
 * origem (Backup_Agendamento_Ref / Backup II). Uma unica busca de texto pelo ID
 * localiza a linha do envio (coluna ID) e as linhas que o citam nas colunas de
 * Backup; so essas linhas sao lidas e o vinculo e confirmado pelo JSON.
 * tempos (opcional) recebe abrirMs, buscaMs e linhasMs. Somente leitura.
 */
function transporteFolhaHtmlAgendaContexto_(idAgenda, tempos) {
  tempos = tempos || {};
  var out = { visita: '', origem: null };
  idAgenda = String(idAgenda || '').trim();
  if (!idAgenda) return out;
  var marca = Date.now();
  var agenda = getAgendaSheetForRead_();
  var ultima = agenda.getLastRow();
  tempos.abrirMs = Date.now() - marca;
  if (ultima < 2) return out;
  var largura = AGENDA_CFG.lastCol;
  var colunasBackup = {};
  colunasBackup[AGENDA_CFG.col.backupAgendaRef] = 'backup';
  if (AGENDA_CFG.col.backup2Dados) colunasBackup[AGENDA_CFG.col.backup2Dados] = 'backup2';

  marca = Date.now();
  var encontrados = agenda.getRange(2, 1, ultima - 1, largura).createTextFinder(idAgenda).matchCase(true).findAll()
    .map(function(range) { return { linha: range.getRow(), coluna: range.getColumn() }; });
  tempos.buscaMs = Date.now() - marca;

  marca = Date.now();
  var linhasLidas = {};
  function linhaValores(n) {
    if (!linhasLidas[n]) linhasLidas[n] = agenda.getRange(n, 1, 1, largura).getValues()[0];
    return linhasLidas[n];
  }
  var linha = 0;
  encontrados.some(function(item) {
    if (item.coluna !== AGENDA_CFG.col.id) return false;
    // A busca e por trecho: confirma o ID exato antes de aceitar a linha.
    if (String(linhaValores(item.linha)[AGENDA_CFG.idx.id] || '').trim() !== idAgenda) return false;
    linha = item.linha;
    return true;
  });
  if (!linha) {
    tempos.linhasMs = Date.now() - marca;
    return out;
  }
  out.visita = String(linhaValores(linha)[AGENDA_CFG.idx.visita] || '').trim();

  encontrados.some(function(item) {
    var slot = colunasBackup[item.coluna];
    if (!slot || item.linha === linha) return false;
    var row = linhaValores(item.linha);
    var backup;
    try { backup = agendaBackupFromRow_(row, slot); } catch (e) { return false; }
    var vinculado = (backup.agendamentos || []).some(function(ref) { return ref && ref.id === idAgenda; });
    if (!vinculado) return false;
    out.origem = {
      slot: slot,
      data: row[AGENDA_CFG.idx.data],
      protocolo: String(row[AGENDA_CFG.idx.projeto] || '').trim(),
      iniciais: extrairIniciais_(row[AGENDA_CFG.idx.participante]),
      visita: String(row[AGENDA_CFG.idx.visita] || '').trim()
    };
    return true;
  });
  tempos.linhasMs = Date.now() - marca;
  tempos.linhasLidas = Object.keys(linhasLidas).length;
  return out;
}

function transporteFolhaHtmlDataAgenda_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return transporteFolhaHtmlData_(Utilities.formatDate(value, 'America/Sao_Paulo', 'yyyy-MM-dd'));
  }
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value || '').trim());
  if (m) return transporteFolhaHtmlData_(m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2));
  return transporteFolhaHtmlData_(value);
}

/**
 * Reune os dados da folha. registro: transporteReadRegistro_ ja derivado
 * (transporteDerivarDadosParticipante_). spec: transportePdfSpec_ do envio.
 * opcoes.agendaContexto / opcoes.labCentral / opcoes.agora permitem testes sem servicos;
 * opcoes.tempos (opcional) recebe a duracao de cada leitura.
 */
function transporteFolhaHtmlDados_(ss, registro, spec, opcoes) {
  opcoes = opcoes || {};
  registro = registro || {};
  var courier = transporteNormalizeCourierFromCodex_(registro.courier);
  var dhlPinex = transporteFolhaHtmlCourierComAssinatura_(courier);
  var titulosFolha = ['folhaAgendamento', 'folhaDhlPinex'].map(function(chave) {
    return ss ? transportePdfActualSheetName_(chave, ss) : '';
  }).filter(Boolean);
  var tempos = opcoes.tempos || {};
  var marca = Date.now();
  tempos.agenda = {};
  // Sem registro.folhaAgenda (ex.: diagnostico que le o registro da planilha) a Agenda e lida aqui.
  var agendaCtx = opcoes.agendaContexto || registro.folhaAgenda || transporteFolhaHtmlAgendaContexto_(registro.idAgenda, tempos.agenda);
  tempos.agendaDoRegistro = !opcoes.agendaContexto && !!registro.folhaAgenda;
  tempos.agendaMs = Date.now() - marca;
  marca = Date.now();
  var lab = opcoes.labCentral !== undefined ? opcoes.labCentral : transporteLabCentralByDestino_(registro.destino);
  tempos.labMs = Date.now() - marca;
  var participante = transporteParticipanteDocumento_(registro);
  var envio = transporteFolhaHtmlData_(registro.dataEnvio);
  var origem = null;
  if (agendaCtx.origem) {
    var dataOrigem = transporteFolhaHtmlDataAgenda_(agendaCtx.origem.data);
    origem = {
      backup: transporteFolhaHtmlSlotLabel_(agendaCtx.origem.slot),
      data: dataOrigem.texto,
      dia: dataOrigem.dia,
      protocolo: agendaCtx.origem.protocolo,
      iniciais: agendaCtx.origem.iniciais,
      visita: agendaCtx.origem.visita
    };
  }
  var cidade = lab ? String(lab.cidade || '').trim() : '';
  return {
    geradoEm: opcoes.agora || Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'),
    dataEnvio: envio.texto,
    diaEnvio: envio.dia,
    janela: String(registro.horaEnvio || '').trim(),
    courier: courier,
    caixa: courier === 'MARKEN' || courier === 'OCASA' ? String(registro.solicitarCaixa || '').trim() : '',
    pinexColeta: courier === 'PINEX' ? String(registro.pinexColeta || '').trim() : '',
    awb: String((dhlPinex && registro.pinexAwb) || registro.awb || '').trim(),
    agendadoPor: String((dhlPinex && registro.pinexAgendadoPor) || registro.agendadoPor || '').trim(),
    temperatura: transporteNormalizeTemperaturaFromCodex_(registro.temperatura) || String(registro.temperatura || '').trim(),
    transporte: transporteFolhaHtmlSlotLabel_(registro.agendaSlot),
    origem: origem,
    protocolo: String(registro.protocolo || '').trim(),
    investigador: String(registro.investigador || '').trim(),
    iniciais: participante.iniciais,
    identificacao: participante.identificacao,
    visita: agendaCtx.visita || '',
    dataColeta: transporteFolhaHtmlData_(registro.dataColeta).texto,
    laboratorio: String((lab && (lab.nomeCompleto || lab.nomeAbreviado)) || registro.destino || '').trim(),
    endereco: lab ? String(lab.endereco || '').trim() : '',
    cidade: cidade,
    pais: lab ? String(lab.pais || '').trim() : '',
    materiais: transporteFolhaHtmlMateriais_(registro.materiais),
    documentos: ((spec && spec.ordem) || []).map(function(titulo) {
      return { nome: titulosFolha.indexOf(titulo) >= 0 ? 'Folha de Agendamento' : titulo, copias: spec.copias[titulo] || 1 };
    }),
    observacoes: String(registro.observacoes || '').trim(),
    assinaturaCourier: dhlPinex
  };
}

function transporteFolhaHtmlDado_(rotulo, valor, classe) {
  return '<tr><td class="k">' + rotulo + '</td><td class="v' + (classe ? ' ' + classe : '') + '">' + valor + '</td></tr>';
}

function transporteFolhaHtmlTitulo_(n, texto, aside) {
  return '<h2><span class="num">' + n + '</span>' + texto + (aside ? '<span class="aside">' + aside + '</span>' : '') + '</h2>';
}

/**
 * HTML de uma pagina (largura da grade), pronto para transporteDocsHtmlDocumento_.
 * opcoes.logoSrc: logo do cabecalho (reqExamesLogoSrc_).
 */
function transporteFolhaHtmlPagina_(dados, opcoes) {
  dados = dados || {};
  opcoes = opcoes || {};
  var e = transporteFolhaHtmlEsc_;
  var h = [];
  var m = dados.materiais || { linhas: [] };
  var compacto = !!dados.assinaturaCourier && m.linhas.length > 3;
  var espaco = '<div style="height:' + (compacto ? 8 : 14) + 'px"></div>';
  h.push('<style>' + TRANSPORTE_FOLHA_HTML_CSS_ + '</style><div class="fa' + (compacto ? ' compacto' : '') + '">');

  h.push('<table class="cab"><tr>' +
    (opcoes.logoSrc ? '<td style="width:185px"><img class="logo" src="' + e(opcoes.logoSrc) + '" alt=""></td>' : '') +
    '<td><div class="titulo">Folha de Agendamento de Envio</div><div class="sub">Transporte de material biológico · uso interno da equipe</div></td>' +
    '<td style="text-align:right;white-space:nowrap"><div class="nota">Gerado em</div><div class="mono" style="font-weight:bold;font-size:10pt">' + e(dados.geradoEm) + '</div></td>' +
    '</tr></table>');

  var notaEnvio = [dados.diaEnvio ? e(dados.diaEnvio) : '', dados.janela ? 'retirada <b>' + e(dados.janela) + '</b>' : ''].filter(Boolean);
  var notaCourier = dados.pinexColeta ? 'COL. Nº <b class="mono">' + e(dados.pinexColeta) + '</b>' :
    (dados.caixa ? 'Caixa de transporte: <b>' + e(dados.caixa) + '</b>' : '');
  h.push(espaco + '<table class="hero"><tr>' +
    '<td class="prim" style="width:24%"><div class="lbl">Envio</div><div class="grande">' + e(dados.dataEnvio || '—') + '</div>' +
      '<div class="nota">' + notaEnvio.join(' · ') + '</div></td>' +
    '<td style="width:20%"><div class="lbl">Courier</div><div class="grande">' + e(dados.courier || '—') + '</div><div class="nota">' + notaCourier + '</div></td>' +
    '<td style="width:30%"><div class="lbl">AWB</div><div class="awb mono">' + e(dados.awb || '—') + '</div>' +
      (dados.agendadoPor ? '<div class="nota">Agendado por <b>' + e(dados.agendadoPor) + '</b></div>' : '') + '</td>' +
    '<td><div class="lbl">Tipo de transporte</div>' + (dados.temperatura ? '<span class="tipo">' + e(dados.temperatura) + '</span>' : '—') + '</td>' +
    '</tr></table>');

  if (dados.transporte || dados.origem) {
    var celulas = [];
    if (dados.transporte) celulas.push('<span class="lbl">Transporte</span><b>' + e(dados.transporte) + '</b>');
    if (dados.origem) {
      var o = dados.origem;
      var ref = [o.protocolo, o.iniciais, o.visita].filter(Boolean).map(e);
      celulas.push('<span class="lbl">Origem</span>Criado a partir do <b>' + e(o.backup || 'Backup') + '</b>' +
        (o.data ? ' do agendamento de <b>' + e(o.data) + (o.dia ? ' (' + e(o.dia.slice(0, 3).toLowerCase()) + ')' : '') + '</b>' : '') +
        (ref.length ? ' · ' + ref.join(' · ') : ''));
    }
    // Com Transporte e Origem, o Transporte fica estreito a esquerda e a Origem quebra linha se preciso.
    h.push('<div style="height:10px"></div><table class="meta"><tr>' + celulas.map(function(c, i) {
      if (i > 0) return '<td>' + c + '</td>';
      return '<td' + (celulas.length > 1 && dados.transporte ? ' class="prim"' : ' style="border-left:0"') + '>' + c + '</td>';
    }).join('') + '</tr></table>');
  }

  var estudo = '<table class="dados">' +
    transporteFolhaHtmlDado_('Protocolo', e(dados.protocolo)) +
    transporteFolhaHtmlDado_('Investigador', e(dados.investigador)) +
    transporteFolhaHtmlDado_('Participante', e(dados.iniciais), 'mono') +
    transporteFolhaHtmlDado_('ID', e(dados.identificacao), 'mono') +
    (dados.visita ? transporteFolhaHtmlDado_('Visita', e(dados.visita)) : '') +
    transporteFolhaHtmlDado_('Data da coleta', e(dados.dataColeta)) + '</table>';
  var endereco = [dados.endereco, dados.cidade].filter(Boolean).map(e).join('<br>');
  var destino = '<table class="dados">' +
    transporteFolhaHtmlDado_('Laboratório', e(dados.laboratorio)) +
    (endereco ? transporteFolhaHtmlDado_('Endereço', endereco) : '') +
    (dados.pais ? transporteFolhaHtmlDado_('País', e(dados.pais)) : '') + '</table>';
  h.push(espaco + transporteFolhaHtmlDuasColunas_(
    transporteFolhaHtmlTitulo_(1, 'Estudo e participante') + estudo,
    transporteFolhaHtmlTitulo_(2, 'Destino') + destino));

  var linhasMat = m.linhas.map(function(l) {
    return '<tr><td>' + (l.outro ? '<b>Outro:</b> ' + e(l.material) : '<b>' + e(l.material) + '</b>') + '</td>' +
      '<td' + (l.ensaio ? '>' + e(l.ensaio) : ' class="vazio">—') + '</td>' +
      '<td class="c' + (l.tubos ? '">' + e(l.tubos) : ' vazio">—') + '</td>' +
      '<td class="c' + (l.quantidade ? '">' + e(l.quantidade) : ' vazio">—') + '</td>' +
      '<td class="r' + (l.total ? '">' + e(l.total) : ' vazio">—') + '</td></tr>';
  }).join('');
  if (!linhasMat) linhasMat = '<tr><td colspan="5" class="vazio">Nenhum material marcado na Declaração de Transporte.</td></tr>';
  var totalMat = m.linhas.length ? '<tr class="total"><td colspan="2">' + m.linhas.length + (m.linhas.length === 1 ? ' material' : ' materiais') +
    '</td><td class="c">' + (m.tubos || '') + '</td><td></td><td class="r">' + e(m.total) + '</td></tr>' : '';
  h.push(espaco + '<div class="card">' +
    transporteFolhaHtmlTitulo_(3, 'Materiais biológicos', 'conforme Declaração de Transporte') +
    '<table class="tab"><tr><th style="width:24%">Material</th><th>Ensaio</th><th class="c" style="width:10%">Tubos</th>' +
    '<th class="c" style="width:22%">Quantidade por tubo</th><th class="r" style="width:13%">Total</th></tr>' +
    linhasMat + totalMat + '</table></div>');

  var docs = '<table class="tab"><tr><th>Documento</th><th class="r">Cópias</th></tr>' +
    (dados.documentos || []).map(function(d) {
      return '<tr><td>' + e(d.nome) + '</td><td class="r copias">' + e(d.copias) + '</td></tr>';
    }).join('') + '</table>';
  var nLinhas = TRANSPORTE_FOLHA_HTML_LINHAS_OBS_ - (dados.observacoes ? Math.min(4, Math.ceil(dados.observacoes.length / 60)) : 0) -
    (dados.assinaturaCourier ? 2 : 0) - (compacto ? 2 : 0);
  var obs = (dados.observacoes ? '<p>' + e(dados.observacoes).replace(/\n/g, '<br>') + '</p>' : '');
  for (var i = 0; i < Math.max(2, nLinhas); i++) obs += '<div class="linha"></div>';
  h.push(espaco + transporteFolhaHtmlDuasColunas_(
    transporteFolhaHtmlTitulo_(4, 'Documentos neste PDF') + docs,
    '<div class="obs">' + transporteFolhaHtmlTitulo_(5, 'Observações') + obs + '</div>'));

  if (dados.assinaturaCourier) {
    h.push(espaco + '<div class="assin"><h2>Recebido pelo agente do courier</h2>' +
      '<div class="nota" style="margin-bottom:10px">Exigido para PINEX e DHL. Preenchido pelo agente no momento da retirada.</div>' +
      '<table><tr><td style="width:1%;padding-right:6px">Nome do agente</td><td class="campo"></td>' +
      '<td style="width:1%;padding:0 6px 0 16px">Data / hora</td><td class="campo" style="width:18%"></td>' +
      '<td style="width:1%;padding:0 6px 0 16px">Assinatura</td><td class="campo"></td></tr></table></div>');
  }

  h.push('<div style="height:12px"></div><table class="rodape"><tr><td>IPS Agenda · Transporte</td></tr></table></div>');
  return h.join('');
}

function transporteFolhaHtmlDuasColunas_(esquerda, direita) {
  return '<table><tr><td class="card" style="width:49%">' + esquerda + '</td><td style="width:2%"></td>' +
    '<td class="card" style="width:49%">' + direita + '</td></tr></table>';
}

// Mesma regra da protecao da grade: nenhum nome de participante pode chegar ao PDF.
function transporteFolhaHtmlValidarSemNome_(html, nomes) {
  var texto = transportePdfManifestText_(String(html || '').replace(/<[^>]*>/g, ' '));
  var encontrados = (nomes || []).map(function(nome) { return transportePdfManifestText_(nome); }).filter(Boolean);
  if (encontrados.some(function(nome) { return texto.indexOf(nome) >= 0; })) {
    throw new Error('PDF bloqueado: identificação nominal presente na Folha de Agendamento. Revise os dados do envio.');
  }
  return html;
}

/**
 * Pagina da folha para o fluxo da grade, com a protecao de identificacao nominal.
 * O logo vem da URL (reqExamesLogoSrc_, em cache), nunca das abas da planilha.
 * Devolve { abas: titulos substituidos, html }.
 */
function transporteFolhaHtmlParaGrade_(ss, registro, spec, opcoes) {
  opcoes = Object.assign({}, opcoes || {});
  var tempos = opcoes.tempos || {};
  var abas = ['folhaAgendamento', 'folhaDhlPinex'].map(function(chave) {
    return transportePdfActualSheetName_(chave, ss);
  }).filter(function(titulo) { return titulo && (spec.ordem || []).indexOf(titulo) >= 0; });
  // Sem folha no spec (PINEX Agendamento: so o Formulario), nada e lido nem montado.
  if (!abas.length) return { abas: [], html: '' };
  var marca = Date.now();
  if (!opcoes.logoSrc && typeof reqExamesLogoSrc_ === 'function') opcoes.logoSrc = reqExamesLogoSrc_();
  tempos.logoMs = Date.now() - marca;

  var dados = transporteFolhaHtmlDados_(ss, registro, spec, opcoes);
  marca = Date.now();
  var html = transporteFolhaHtmlPagina_(dados, opcoes);
  tempos.paginaMs = Date.now() - marca;
  transporteFolhaHtmlValidarSemNome_(html, [registro.paciente, registro.participante]);
  return { abas: abas, html: html };
}
