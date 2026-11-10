/**
 * E-mail de agendamento da courier gerado a partir do registro do envio, sem a planilha de Transporte.
 *
 * Os modelos "Email (MARKEN)" (A1:B9) e "Email (OCASA)" (A1:B10) eram abas com formulas sobre a
 * Folha de Agendamento, a Declaracao de Transporte e a aba Excluir. Aqui o conteudo e os estilos
 * desses modelos ficam em codigo, e os valores variaveis saem do registro. A renderizacao continua
 * a de transporteCodexEmailHtml_, alimentada por uma planilha em memoria com so essas duas abas.
 *
 * Origem dos modelos: copia da planilha "Documentacao para Transporte de Amostras" (2026-11-09).
 */

var TRANSPORTE_EMAIL_MARKEN_ROTULOS_ = [
  'Agendamento', 'Nº HAWB', 'PI', 'Data da Coleta', 'Horário (Janela de 1 a 2 hrs)',
  'Quantidade de volumes', 'Temperatura', 'Enviar Caixa de Transporte', 'Cidade'
];
// Volumes como na Invoice MARKEN (atualizarMarkenVolumes_): 2 em temperatura mista, 1 nos demais casos.
// Substitui o antigo Excluir!B26, valor fixo 1 (corrigido por decisao do usuario em 2026-11-09).
function transporteEmailVolumesMarken_(temperatura) {
  var t = transporteNormalizeTemperaturaFromCodex_(temperatura);
  return t === 'AMBIENTE + CONGELADO' || t === 'AMBIENTE + REFRIGERADO' ? '2' : '1';
}
var TRANSPORTE_EMAIL_MARKEN_CIDADE_ = 'Caxias do Sul';

var TRANSPORTE_EMAIL_OCASA_ROTULOS_ = [
  'Nome da Instituição/Hospital:', 'Endereço:', 'Departamento/setor:', 'Cidade/Estado:',
  'Telefone / Ramal:', 'Protocolo do estudo:', 'Laboratório de Destino:', 'Data:',
  'Horário (intervalo de duas horas):', 'Número da AWB / temperatura'
];
var TRANSPORTE_EMAIL_OCASA_FIXOS_ = [
  'Fundação Universidade de Caxias do Sul\nInstituto de Pesquisas em Saúde',
  'Rua Francisco Getúlio Vargas, 1130, Bairro Petrópolis',
  'Bloco S, Sala 315',
  'Caxias do Sul, RS',
  '55 54 3218 2026'
];

// Data do registro: Date, yyyy-MM-dd ou dd/MM/yyyy. Outro formato segue como texto.
function transporteEmailData_(value) {
  if (value instanceof Date) return value;
  var texto = String(value === null || value === undefined ? '' : value).trim();
  var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  var br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  return texto;
}

function transporteEmailMatriz_(linhas, fn) {
  return linhas.map(function(_linha, i) { return fn(i); });
}

function transporteEmailFolhaMemoria_(a1, dados, estilos) {
  var range = {
    getDisplayValues: function() { return dados.map(function(linha) { return linha.slice(); }); },
    getBackgrounds: function() { return estilos.backgrounds.map(function(linha) { return linha.slice(); }); },
    getFontColors: function() { return estilos.fontColors.map(function(linha) { return linha.slice(); }); },
    getFontWeights: function() { return estilos.fontWeights.map(function(linha) { return linha.slice(); }); },
    getHorizontalAlignments: function() { return estilos.hAlign.map(function(linha) { return linha.slice(); }); }
  };
  return { getRange: function(pedido) {
    if (pedido !== a1) throw new Error('Faixa inesperada no modelo de e-mail em memoria: ' + pedido);
    return range;
  } };
}

function transporteEmailPlanilhaMemoria_(abas) {
  return {
    getId: function() { return 'email-memoria'; },
    getSheetByName: function(nome) { return abas[nome] || null; },
    getSheets: function() { return []; }
  };
}

// Resposta do campo "Enviar Caixa de Transporte" que aplicarSolicitacaoCaixaTransporte_ gravava em B8.
function transporteEmailRespostaCaixaMarken_(registro) {
  var resposta = transporteNormalizeSimNao_(registro.solicitarCaixa, transporteDefaultSolicitarCaixa_('MARKEN'));
  if (registro.caixaTransporte) resposta = transporteSolicitarCaixaMarken_(registro, resposta);
  return resposta;
}

function transporteEmailAbaMarken_(registro, dataColeta) {
  var dados = [
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[0], ''],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[1], registro.awb || ''],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[2], registro.investigador || ''],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[3], transporteCodexFormatData_(dataColeta)],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[4], registro.horaEnvio || ''],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[5], transporteEmailVolumesMarken_(registro.temperatura)],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[6], registro.temperatura || ''],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[7], transporteEmailRespostaCaixaMarken_(registro)],
    [TRANSPORTE_EMAIL_MARKEN_ROTULOS_[8], TRANSPORTE_EMAIL_MARKEN_CIDADE_]
  ];
  var estilos = {
    backgrounds: transporteEmailMatriz_(dados, function(i) { return i === 0 ? ['#00b050', '#00b050'] : ['#2f5496', '#ffffff']; }),
    fontColors: transporteEmailMatriz_(dados, function(i) { return i === 0 ? ['#000000', '#000000'] : ['#ffffff', '#000000']; }),
    fontWeights: transporteEmailMatriz_(dados, function() { return ['bold', 'bold']; }),
    hAlign: transporteEmailMatriz_(dados, function(i) { return i === 0 ? ['center', 'center'] : ['left', 'left']; })
  };
  return transporteEmailFolhaMemoria_('A1:B9', dados, estilos);
}

function transporteEmailAbaOcasa_(registro, dataEnvio, opcoes) {
  var destinoNome = String(registro.destino || '').trim();
  var lab = opcoes.lab !== undefined ? opcoes.lab : transporteLabCentralByDestino_(destinoNome);
  // Mesmas celulas que o preenchimento da Declaracao gravava: D38, D39 e N39.
  var d38 = lab ? (lab.nomeCompleto || lab.nomeAbreviado || destinoNome) : '';
  var d39 = lab ? (lab.endereco || '') : '';
  var n39 = lab ? transporteLabCentralCidadePais_(lab) : '';
  var fixos = TRANSPORTE_EMAIL_OCASA_FIXOS_;
  var valores = fixos.concat([
    registro.protocolo || '',
    d38 + '. ' + d39 + '. ' + n39,
    transporteCodexFormatData_(dataEnvio),
    registro.horaEnvio || '',
    String(registro.awb || '') + ' / ' + String(registro.temperatura || '')
  ]);
  var dados = TRANSPORTE_EMAIL_OCASA_ROTULOS_.map(function(rotulo, i) { return [rotulo, valores[i]]; });
  var estilos = {
    backgrounds: transporteEmailMatriz_(dados, function() { return ['#ffffff', '#ffffff']; }),
    fontColors: transporteEmailMatriz_(dados, function(i) { return ['#000000', i === dados.length - 1 ? '#0000ff' : '#ff0000']; }),
    fontWeights: transporteEmailMatriz_(dados, function() { return ['bold', 'normal']; }),
    hAlign: transporteEmailMatriz_(dados, function() { return ['left', 'left']; })
  };
  return transporteEmailFolhaMemoria_('A1:B10', dados, estilos);
}

/**
 * Assunto, destinatarios e corpo do e-mail de agendamento, a partir do registro.
 * opcoes: { saudacao, temperaturaPdf (MARKEN; deve coincidir com a do registro), lab (OCASA; evita a busca) }.
 * Devolve { courier, assunto, destinatarios[], html, caixaPayload } ou, sem rascunho,
 * { courier, semRascunho: true, motivo, erro }. Nao le planilha de Transporte, Gmail nem Drive.
 */
function transporteEmailDoRegistro_(registro, opcoes) {
  opcoes = opcoes || {};
  registro = registro || {};
  var courier = registro.courier;
  var projeto = transporteProjetoDisplay_(registro.protocolo);
  var dataColeta = transporteEmailData_(registro.dataColeta);
  var dataEnvio = transporteEmailData_(registro.dataEnvio);
  var laboratorio = registro.destino;
  var awb = registro.awb;
  var temperatura = registro.temperatura;
  var saudacao = opcoes.saudacao || transporteCodexSaudacao_();
  var temperaturaConfirmada;
  if (courier === 'MARKEN' || opcoes.temperaturaPdf) {
    temperaturaConfirmada = transporteValidarTemperaturaGeracao_(opcoes.temperaturaPdf || temperatura, temperatura);
    temperatura = temperaturaConfirmada;
  }
  var assunto = courier === 'PINEX (Agendamento)'
    ? projeto + ' - ' + transporteCodexFormatDateTitle_(dataEnvio) + ' - ' + laboratorio + ' - AGENDAMENTO DE COLETA'
    : projeto + ' - ' + awb + ' - ' + transporteCodexFormatDateTitle_(dataEnvio) + ' - ' + laboratorio + ' - AGENDAMENTO DE COLETA';
  var destinatarios;
  var html;
  var caixaPayload = null;
  if (courier === 'PINEX (Agendamento)') {
    destinatarios = transporteCourierEmailRecipients_(courier, temperatura);
    html = '<p>Prezados,</p><p>' + saudacao + ',</p><p>Seguem anexos os dados para agendamento de coleta (CNPJ : ' + transporteCodexEmailEsc_(transporteCnpjTexto_()) + ').</p>';
  } else if (courier === 'OCASA') {
    destinatarios = transporteCourierEmailRecipients_(courier, temperatura);
    var ssOcasa = transporteEmailPlanilhaMemoria_({ 'Email (OCASA)': transporteEmailAbaOcasa_(registro, dataEnvio, opcoes) });
    html = transporteCodexEmailHtml_(ssOcasa, 'emailOcasa', 'OCASA', saudacao);
  } else if (courier === 'MARKEN') {
    caixaPayload = registro.caixaTransporte ? registro : null;
    destinatarios = transporteCaixaCredoCube_(caixaPayload) ? ['protocolos.credo@marken.com']
      : (transporteCaixaBioSystem_(caixaPayload) ? ['operacoes.cs@marken.com'] : transporteCourierEmailRecipients_(courier, temperatura));
    var ssMarken = transporteEmailPlanilhaMemoria_({ 'Email (MARKEN)': transporteEmailAbaMarken_(registro, dataColeta) });
    html = transporteCodexEmailHtml_(ssMarken, 'emailMarken', 'MARKEN', saudacao, temperaturaConfirmada, transporteCaixaRespostaEspecial_(caixaPayload));
  } else if (transporteIsDhl_(courier)) {
    destinatarios = transporteCourierEmailRecipients_(courier, temperatura);
    html = transporteCodexEmailDhlHtml_(projeto, dataColeta, registro.horaEnvio, dataEnvio, registro.investigador, laboratorio, awb, temperatura,
      transporteDefaultSolicitarCaixa_(courier), saudacao, String(registro.refInterna || ''));
  } else if (courier === 'PINEX') {
    return { courier: courier, semRascunho: true, ok: true, motivo: 'Rascunho nao criado para PINEX; anexe os documentos na thread original do agendamento.' };
  } else {
    return { courier: courier, semRascunho: true, ok: false, erro: 'COURIER_DRAFT_NOT_CONFIGURED', motivo: 'Transportadora sem rascunho configurado: ' + (courier || '-') };
  }
  return { courier: courier, assunto: assunto, destinatarios: destinatarios, html: html, caixaPayload: caixaPayload, temperaturaPdf: temperaturaConfirmada };
}
