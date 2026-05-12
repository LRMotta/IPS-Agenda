// ======================================================
// WEBAPP — PONTO DE ENTRADA
// ======================================================
function doGet(e) {
  var page = e && e.parameter ? e.parameter.page : 'index';

  if (page === 'estoque') {
    var tplEstoque = HtmlService.createTemplateFromFile('EstoqueApp');
    tplEstoque.paginaInicial = e && e.parameter ? (e.parameter.pagina || 'itens') : 'itens';
    return tplEstoque
      .evaluate()
      .setTitle('IPS | UCS')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === 'pedidos') {
    var tplPedidos = HtmlService.createTemplateFromFile('EstoqueApp');
    tplPedidos.paginaInicial = 'pedidos';
    return tplPedidos
      .evaluate()
      .setTitle('IPS | UCS')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === 'estoque-view')
    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('IPS | UCS')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  // default — página principal
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('IPS | UCS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// Retorna a URL base do webapp (usada para navegação entre páginas)
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}


function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSheetByPossibleNames_(ss, names) {
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    if (sh) return sh;
  }
  return null;
}

function readConfigAppRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Config_App');
  if (!sh || sh.getLastRow() < 2) return [];

  function readBlock(startCol, bloco) {
    var out = [];
    var lastRow = sh.getLastRow();
    var values = sh.getRange(2, startCol, Math.max(0, lastRow - 1), 6).getValues();
    values.forEach(function(r, idx) {
      if (!String(r[0] || r[1] || r[2] || '').trim()) return;
      out.push({
        rowIndex: idx + 2,
        startCol: startCol,
        bloco: bloco,
        grupo: String(r[0] || '').trim(),
        chave: String(r[1] || '').trim(),
        valor: String(r[2] || '').trim(),
        ativo: String(r[3] || 'Sim').trim(),
        ordem: r[4] !== '' && r[4] !== null ? Number(r[4]) : '',
        observacao: String(r[5] || '').trim()
      });
    });
    return out;
  }

  return readBlock(1, 'Principal').concat(readBlock(8, 'Apoio')).sort(function(a, b) {
    return String(a.grupo).localeCompare(String(b.grupo)) ||
      String(a.chave).localeCompare(String(b.chave)) ||
      (Number(a.ordem || 0) - Number(b.ordem || 0)) ||
      String(a.valor).localeCompare(String(b.valor));
  });
}

function getEstoqueConfig() {
  var defaults = { laboratorios: [], localizacoes: [], tiposItem: [] };

  try {
    var configRows = readConfigAppRows_().filter(function(r) {
      var ativo = String(r.ativo || 'Sim').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return r.grupo === 'Estoque' && r.valor && ['nao', 'false', '0', 'inativo'].indexOf(ativo) === -1;
    });
    var cfgApp = { laboratorios: [], localizacoes: [], tiposItem: [] };
    configRows.forEach(function(r) {
      var chave = String(r.chave || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (chave.indexOf('laboratorio') === 0) cfgApp.laboratorios.push(r);
      else if (chave.indexOf('localizacao') === 0) cfgApp.localizacoes.push(r);
      else if (chave.indexOf('tipo de item') === 0) cfgApp.tiposItem.push(r);
    });
    function valuesSorted(rows) {
      return rows.sort(function(a, b) {
        return (Number(a.ordem || 0) - Number(b.ordem || 0)) || String(a.valor).localeCompare(String(b.valor));
      }).map(function(r) { return r.valor; });
    }
    return {
      laboratorios: valuesSorted(cfgApp.laboratorios),
      localizacoes: valuesSorted(cfgApp.localizacoes),
      tiposItem: valuesSorted(cfgApp.tiposItem)
    };
  } catch (e) {
    return defaults;
  }
}

function getConfigAppValuesByKeys_(grupos, chaves, fallback) {
  var grupoMap = {};
  var chaveMap = {};
  (grupos || []).forEach(function(g) { grupoMap[normText_(g)] = true; });
  (chaves || []).forEach(function(c) { chaveMap[normText_(c)] = true; });
  var out = [];
  try {
    readConfigAppRows_().forEach(function(r) {
      var ativo = normText_(r.ativo || 'Sim');
      if (ativo === 'nao' || ativo === 'false' || ativo === '0' || ativo === 'inativo') return;
      if (Object.keys(grupoMap).length && !grupoMap[normText_(r.grupo)]) return;
      if (Object.keys(chaveMap).length && !chaveMap[normText_(r.chave)]) return;
      if (r.valor) out.push(r.valor);
    });
    out.sort();
    return out.length ? out : (fallback || []);
  } catch(e) {
    return fallback || [];
  }
}

function normText_(v) {
  return String(v == null ? '' : v).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}



// ══════════════════════════════════════════════════════
//  MENU PRINCIPAL
// ══════════════════════════════════════════════════════
// O WebApp e a interface principal. Nao criamos mais menus no onOpen.



// ══════════════════════════════════════════════════════
//  PARTICIPANTE
// ══════════════════════════════════════════════════════
function abrirFormularioParticipante() {
  const html = HtmlService.createTemplateFromFile('Form_Participante')
    .evaluate().setWidth(720).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

function salvarParticipante(dados) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName('Participantes');
  if (!aba) throw new Error("Aba 'Participantes' não encontrada.");
  const id = 'P-' + new Date().getTime();
  aba.appendRow([
    id, dados.nome, dados.nascimento, dados.idade, dados.identificacao,
    dados.projeto, dados.braco, '', dados.status, dados.telefone, dados.cpf
  ]);
  return 'Sucesso! Participante cadastrado com ID: ' + id;
}

function buscarProjetos() {
  try {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const abas = ss.getSheets();
    let abaProjetos = null;
    for (let i = 0; i < abas.length; i++) {
      if (abas[i].getName().includes('Projetos')) { abaProjetos = abas[i]; break; }
    }
    if (!abaProjetos) return ['ERRO: Aba Projetos não encontrada'];
    const ultimaLinha = abaProjetos.getLastRow();
    if (ultimaLinha < 2) return ['Nenhum projeto na lista'];
    return abaProjetos.getRange(2, 2, ultimaLinha - 1, 1).getValues()
      .map(r => r[0] ? r[0].toString().trim() : '').filter(r => r !== '');
  } catch(e) { return ['Erro de sistema: ' + e.message]; }
}



// ══════════════════════════════════════════════════════
//  MÉDICO
// ══════════════════════════════════════════════════════
function abrirFormularioMedico() {
  const html = HtmlService.createHtmlOutputFromFile('Form_Medico')
    .setWidth(720).setHeight(580);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

/**
 * Cria ou atualiza um médico na aba '🩺 Médicos'.
 * A=id | B=nome | C=especialidade | D=telefone | E=email
 */
function salvarDadosMedico(dados) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('🩺 Médicos');
  if (!sh) throw new Error("Aba '🩺 Médicos' não encontrada.");

  if (dados.id && dados.id !== '') {
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0].toString() === dados.id.toString()) {
        var linha = i + 2;
        sh.getRange(linha, 2).setValue(dados.nome          || '');
        sh.getRange(linha, 3).setValue(dados.especialidade || '');
        sh.getRange(linha, 4).setValue(dados.telefone      || '');
        sh.getRange(linha, 5).setValue(dados.email         || '');
        return 'Médico atualizado com sucesso.';
      }
    }
    throw new Error('Médico com ID "' + dados.id + '" não encontrado.');
  }

  var novoId = 'MED-' + new Date().getTime();
  sh.appendRow([novoId, dados.nome || '', dados.especialidade || '',
                dados.telefone || '', dados.email || '']);
  return 'Médico cadastrado com sucesso.';
}

function getMedicos() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🩺 Médicos');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues()
    .filter(function(r) { return r[1] !== ''; })
    .map(function(r) {
      return { id: r[0], nome: r[1], especialidade: r[2], telefone: r[3], email: r[4] };
    });
}

function buscarMedicos() {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName('🩺 Médicos');
    if (!aba) return [];
    const ultima = aba.getLastRow();
    if (ultima < 2) return [];
    return aba.getRange(2, 2, ultima - 1, 1).getValues()
      .map(r => r[0] ? r[0].toString().trim() : '').filter(r => r !== '');
  } catch(e) { return []; }
}

function excluirMedico(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🩺 Médicos');
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] == id) { sh.deleteRow(i + 2); return 'ok'; }
  }
  throw new Error('Registro não encontrado.');
}



// ══════════════════════════════════════════════════════
//  SOLICITANTE
// ══════════════════════════════════════════════════════
function abrirFormularioSolicitante() {
  const html = HtmlService.createHtmlOutputFromFile('Form_Solicitante')
    .setWidth(720).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

// Mantida para compatibilidade com formulários legados
function salvarSolicitante(dados) {
  return salvarDadosSolicitante(dados);
}

function buscarSolicitantes() {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName('🙋 Solicitantes');
    if (!aba) return [];
    const ultima = aba.getLastRow();
    if (ultima < 2) return [];
    return aba.getRange(2, 2, ultima - 1, 1).getValues()
      .map(r => r[0] ? r[0].toString().trim() : '').filter(r => r !== '');
  } catch(e) { return []; }
}

/**
 * Retorna nome + formação + registro de todos os solicitantes.
 * Usada pelo formulário de Requisição de Exames (WebApp).
 * A=id | B=nome | C=formacao | D=registro
 */
function buscarSolicitantesCompleto() {
  try {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var aba = ss.getSheetByName('🙋 Solicitantes');
    if (!aba || aba.getLastRow() < 2) return [];
    return aba.getRange(2, 2, aba.getLastRow() - 1, 4).getValues()
      .filter(function(row) { return row[0]; })
      .map(function(row) {
        return {
          nome:     row[0].toString().trim(),
          formacao: row[1] ? row[1].toString().trim() : '',
          registro: row[2] ? row[2].toString().trim() : '',
          email:    row[3] ? row[3].toString().trim() : ''
        };
      });
  } catch(e) { return []; }
}

/**
 * Retorna todos os solicitantes para o WebApp.
 * A=id | B=nome | C=formacao | D=registro
 */
function getSolicitantes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getSheetByPossibleNames_(ss, ['🙋 Solicitantes', 'Solicitantes']);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(5, sh.getLastColumn())).getValues()
    .filter(function(r) { return r[1] !== ''; })
    .map(function(r) {
      return {
        id:       r[0] ? r[0].toString() : '',
        nome:     r[1] ? r[1].toString() : '',
        formacao: r[2] ? r[2].toString() : '',
        registro: r[3] ? r[3].toString() : '',
        email:    r[4] ? r[4].toString() : ''
      };
    });
}

/**
 * Cria ou atualiza um solicitante na aba '🙋 Solicitantes'.
 */
function salvarDadosSolicitante(dados) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('🙋 Solicitantes');
  if (!sh) throw new Error("Aba '🙋 Solicitantes' não encontrada.");

  if (dados.id && dados.id !== '') {
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0].toString() === dados.id.toString()) {
        var linha = i + 2;
        sh.getRange(linha, 2).setValue(dados.nome     || '');
        sh.getRange(linha, 3).setValue(dados.formacao || '');
        sh.getRange(linha, 4).setValue(dados.registro || '');
        sh.getRange(linha, 5).setValue(dados.email || '');
        return 'Solicitante atualizado com sucesso.';
      }
    }
    throw new Error('Solicitante com ID "' + dados.id + '" não encontrado.');
  }

  var novoId = 'SOL-' + new Date().getTime();
  sh.appendRow([novoId, dados.nome || '', dados.formacao || '', dados.registro || '', dados.email || '']);
  return 'Solicitante cadastrado com sucesso.';
}

/**
 * Exclui o solicitante com o id informado.
 */
function excluirSolicitante(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🙋 Solicitantes');
  if (!sh || sh.getLastRow() < 2) throw new Error('Nenhum registro encontrado.');
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0].toString() === id.toString()) {
      sh.deleteRow(i + 2);
      return 'ok';
    }
  }
  throw new Error('Solicitante não encontrado.');
}



// ══════════════════════════════════════════════════════
//  PROJETO
// ══════════════════════════════════════════════════════
function abrirFormularioProjeto() {
  const html = HtmlService.createHtmlOutputFromFile('Form_Projeto')
    .setWidth(720).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

function salvarProjeto(dados) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName('Projetos');
  if (!aba) throw new Error("Aba 'Projetos' não encontrada.");
  const id = 'PROJ-' + new Date().getTime();
  aba.appendRow([
    id, dados.nomeAbreviado || '', dados.codigo || '', dados.especialidade || '',
    dados.fase || '', dados.investigador || '', dados.subInvestigador1 || '',
    dados.subInvestigador2 || '', dados.centro || '', dados.patrocinador || '',
    dados.cro || '', dados.coordenador || '', dados.status || ''
  ]);
  return 'Projeto cadastrado com ID: ' + id;
}



// ══════════════════════════════════════════════════════
//  PRESTADOR
// ══════════════════════════════════════════════════════
function abrirFormularioPrestador() {
  const html = HtmlService.createHtmlOutputFromFile('Form_Prestador')
    .setWidth(720).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

function salvarPrestador(dados) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName('🏢 Prestadores');
  if (!aba) throw new Error("Aba '🏢 Prestadores' não encontrada.");
  const id = 'PREST-' + new Date().getTime();
  aba.appendRow([id, dados.empresa || '', dados.endereco || '', dados.email || '']);
  return 'Prestador cadastrado com ID: ' + id;
}



// ══════════════════════════════════════════════════════
//  REQUISIÇÃO DE EXAMES
// ══════════════════════════════════════════════════════
function abrirFormularioRequisicao() {
  const html = HtmlService.createHtmlOutputFromFile('Form_Requisicao')
    .setWidth(720).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

/**
 * Retorna participantes com nascimento, protocolo e médico IP.
 * Chamada pelo WebApp via google.script.run.
 */
function buscarParticipantesRequisicao() {
  try {
    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const abaPartic   = ss.getSheetByName('Participantes');
    const abaProjetos = ss.getSheetByName('Projetos');
    if (!abaPartic) return [];
    const ultima = abaPartic.getLastRow();
    if (ultima < 2) return [];

    // Monta mapa projeto → investigador principal (coluna F = índice 5, investigador = índice 5 na aba Projetos coluna F)
    const projetosMap = {};
    if (abaProjetos && abaProjetos.getLastRow() >= 2) {
      abaProjetos.getRange(2, 1, abaProjetos.getLastRow() - 1, 6).getValues()
        .forEach(function(row) {
          // col B (idx 1) = nome abreviado, col F (idx 5) = investigador principal
          if (row[1]) projetosMap[row[1].toString().trim()] = row[5] ? row[5].toString().trim() : '';
        });
    }

    return abaPartic.getRange(2, 1, ultima - 1, 9).getValues()
      .filter(function(row) { return row[1]; })
      .map(function(row) {
        const projeto    = row[5] ? row[5].toString().trim() : '';
        const nascimento = row[2] instanceof Date
          ? Utilities.formatDate(row[2], 'GMT-3', 'dd/MM/yyyy')
          : (row[2] ? row[2].toString() : '');
        return {
          nome:      row[1].toString().trim(),
          nascimento: nascimento,
          protocolo:  projeto,
          medico:     projetosMap[projeto] || ''
        };
      });
  } catch(e) { return []; }
}

/**
 * Retorna empresa e endereço de todos os prestadores.
 * Chamada pelo WebApp via google.script.run.
 * A=id | B=empresa | C=endereco | D=email
 */
function buscarPrestadoresParaRequisicao() {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName('🏢 Prestadores');
    if (!aba || aba.getLastRow() < 2) return [];
    return aba.getRange(2, 2, aba.getLastRow() - 1, 2).getValues()
      .filter(function(row) { return row[0]; })
      .map(function(row) {
        return {
          empresa:  row[0].toString().trim(),
          endereco: row[1] ? row[1].toString().trim() : ''
        };
      });
  } catch(e) { return []; }
}

function getReqExamesPreloadProjeto(projeto) {
  projeto = String(projeto || '').trim();
  if (!projeto) return [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getSheetByPossibleNames_(ss, ['ReqExames_Preloads', 'Req_Exames_Preloads', 'ReqExames Preloads']);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(42, sh.getLastColumn())).getValues();
  var alvo = normText_(projeto);
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (normText_(row[0]) !== alvo) continue;
    var ativo = String(row[41] || '').trim();
    if (ativo && ['nao', 'não', 'n', 'false', 'inativo'].indexOf(normText_(ativo)) > -1) return [];
    return row.slice(1, 41).map(function(v) { return String(v || '').trim(); }).filter(Boolean);
  }
  return [];
}

function ensureReqExamesConfig_() {
  var sh = getConfigAppSheet_();
  var lastRow = Math.max(sh.getLastRow(), 1);
  var existing = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  var hasCcConfig = existing.some(function(row) {
    return normText_(row[0]) === normText_('Requisição de Exames') &&
      normText_(row[1]) === normText_('E-mails em cópia');
  });
  if (hasCcConfig) return;
  [
    'cbluz@ucs.br',
    'cegarske@ucs.br',
    'dwendt@ucs.br',
    'fmcioato@ucs.br',
    'msilva39@ucs.br',
    'mmmazuchini@ucs.br',
    'mlreis@ucs.br',
    'rcviana@ucs.br',
    'rdsperha@ucs.br'
  ].forEach(function(email, idx) {
    ensureConfigAppRow_(sh, [
      'Requisição de Exames',
      'E-mails em cópia',
      email,
      'Sim',
      idx + 1,
      'CC dos rascunhos enviados ao serviço terceirizado'
    ]);
  });
}

function getReqExamesCcEmails_() {
  ensureReqExamesConfig_();
  var vals = getConfigAppValuesByKeys_(
    ['Requisição de Exames', 'Requisicao de Exames'],
    ['E-mails em cópia', 'Emails em copia', 'CC', 'Cópia'],
    []
  );
  return vals.join(', ');
}

/**
 * Recebe os dados do formulário de requisição do WebApp,
 * preenche a aba "Requisição de Exames", gera o PDF e cria
 * o rascunho de e-mail no Gmail.
 *
 * IMPORTANTE: esta função NÃO usa SpreadsheetApp.getUi() pois
 * getUi() não está disponível no contexto de WebApp (doGet).
 * Erros são lançados via throw e capturados pelo withFailureHandler
 * do frontend.
 */
function gerarRequisicaoPDF(dados) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Requisição de Exames');
  if (!sheet) throw new Error("Aba 'Requisição de Exames' não encontrada.");

  // ── 1. Limpar campos anteriores ──────────────────────────────────────────
  ['I5','E8','E9','E10','E11','H8','H9','H10','J10','B36','H41','H42','H43']
    .forEach(function(cell) { sheet.getRange(cell).clearContent(); });
  sheet.getRange('C14:C33').clearContent();
  sheet.getRange('H14:H33').clearContent();

  // ── 2. Preencher campos ──────────────────────────────────────────────────
  sheet.getRange('E8').setValue(dados.paciente   || '');
  sheet.getRange('E9').setValue(dados.nascimento || '');
  sheet.getRange('H8').setValue(dados.protocolo  || '');
  sheet.getRange('H9').setValue(dados.medico     || '');
  sheet.getRange('E10').setValue(dados.localExame || '');
  sheet.getRange('E11').setValue(dados.endereco   || '');

  if (dados.dataAgendamento) {
    const p = dados.dataAgendamento.split('-');
    sheet.getRange('H10').setValue(new Date(p[0], p[1] - 1, p[2]));
  }
  sheet.getRange('J10').setValue(dados.horario || '');

  const exames = dados.exames || [];
  for (var i = 0; i < 20; i++) {
    sheet.getRange(14 + i, 3).setValue(exames[i]      || '');
    sheet.getRange(14 + i, 8).setValue(exames[20 + i] || '');
  }

  sheet.getRange('B36').setValue(dados.observacoes || '');
  sheet.getRange('I5').setValue(dados.urgente ? 'URGENTE' : '');
  sheet.getRange('H41').setValue(dados.solicitante || '');
  sheet.getRange('H42').setValue(dados.solFormacao || '');
  sheet.getRange('H43').setValue(dados.solRegistro || '');
  SpreadsheetApp.flush();

  // ── 3. Gerar PDF e criar rascunho (versão sem getUi) ─────────────────────
  _exportarPDFWebApp(sheet, ss);

  return 'Rascunho de e-mail criado com sucesso! Verifique sua caixa de rascunhos no Gmail.';
}

/**
 * Versão do exportarPDF sem chamadas a getUi().
 * Usada internamente por gerarRequisicaoPDF (contexto WebApp).
 * Lança erros em vez de exibir alertas.
 * @param {Sheet} sheet - Aba "Requisição de Exames" já preenchida.
 * @param {Spreadsheet} ss - Spreadsheet pai.
 */
function _exportarPDFWebApp(sheet, ss) {
  var nomeLocal         = sheet.getRange('E10').getValue();
  var emailDestinatario = buscarEmailDoLocal(nomeLocal);

  if (!emailDestinatario) {
    throw new Error(
      'E-mail do local "' + nomeLocal + '" não encontrado em "🏢 Prestadores". ' +
      'Cadastre o e-mail do prestador e tente novamente.'
    );
  }

  var dataAgendamento = sheet.getRange('H10').getValue();
  if (!(dataAgendamento instanceof Date) || isNaN(dataAgendamento.getTime())) {
    throw new Error('Data de agendamento inválida. Verifique o campo de data e tente novamente.');
  }

  var dataFormatada   = Utilities.formatDate(dataAgendamento, 'GMT-3', 'dd-MM-yyyy');
  var paciente        = sheet.getRange('E8').getValue();
  var pacienteLimpo   = limparNome(paciente);
  var dataNascRaw     = sheet.getRange('E9').getValue();
  var dataNasc        = (dataNascRaw instanceof Date)
    ? Utilities.formatDate(dataNascRaw, 'GMT-3', 'dd/MM/yyyy') : dataNascRaw;
  var medico          = sheet.getRange('H9').getValue();
  var nomeArquivo     = 'IPS-UCS - ' + pacienteLimpo + ' - ' + dataFormatada + '.pdf';
  var pesquisaClinica = sheet.getRange('H8').getDisplayValue();
  var urgente         = sheet.getRange('I5').getValue();
  var urgenteTag      = urgente
    ? '<span style="background:#e53935;color:white;padding:2px 8px;border-radius:4px;font-weight:700;">URGENTE</span>&nbsp;'
    : '';

  // ── Geração do PDF via Export URL ────────────────────────────────────────
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?';
  var exportOptions =
    'exportFormat=pdf&format=pdf&size=A4&portrait=true&fitw=true' +
    '&sheetnames=false&printtitle=false&pagenumbers=false' +
    '&gridlines=false&fzr=false&gid=' + sheet.getSheetId() +
    '&top_margin=0.15&bottom_margin=0.15&left_margin=0.15&right_margin=0.15&scale=4';
  var token    = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url + exportOptions, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  var pdfBlob = response.getBlob().setName(nomeArquivo);

  // ── Corpo do e-mail ──────────────────────────────────────────────────────
  var tituloEmail =
    'IPS/UCS - Agendamento de Exames - Paciente: ' + pacienteLimpo + ' - Data: ' + dataFormatada;
  var signature = getGmailSignature();
  var corpoEmail = gerarReqExamesEmailHtml_({
    paciente: paciente,
    dataFormatada: dataFormatada,
    dataNasc: dataNasc,
    medico: medico,
    pesquisaClinica: pesquisaClinica,
    urgenteTag: urgenteTag,
    signature: signature
  });

  var ccEmails = getReqExamesCcEmails_();

  var draftOptions = { htmlBody: corpoEmail, attachments: [pdfBlob] };
  if (ccEmails) draftOptions.cc = ccEmails;
  GmailApp.createDraft(emailDestinatario, tituloEmail, '', draftOptions);
}



// ══════════════════════════════════════════════════════
//  PDF, E-MAIL E ORGANIZAÇÃO VISUAL
// ══════════════════════════════════════════════════════
function organizarAbas() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var ordem = [
    'Agenda','Requisição de Exames','Participantes',
    'Projetos','🏢 Prestadores','🩺 Médicos','🙋 Solicitantes'
  ];
  for (var i = 0; i < ordem.length; i++) {
    var sheet = ss.getSheetByName(ordem[i]);
    if (sheet) { ss.setActiveSheet(sheet); ss.moveActiveSheet(i + 1); }
  }
  var agenda = ss.getSheetByName('Agenda');
  if (agenda) ss.setActiveSheet(agenda);
}

function focarDataHoje() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('Agenda');
  if (!aba) return;
  ss.setActiveSheet(aba);
  var rangeDatas = aba.getRange(2, 2, aba.getLastRow(), 1).getValues();
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  for (var i = 0; i < rangeDatas.length; i++) {
    var dataCelula = rangeDatas[i][0];
    if (dataCelula instanceof Date) {
      dataCelula.setHours(0,0,0,0);
      if (dataCelula.getTime() >= hoje.getTime()) {
        aba.getRange(i + 2, 2).activate(); break;
      }
    }
  }
}

function buscarEmailDoLocal(nomeLocal) {
  if (!nomeLocal) return null;
  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var localSheet = ss.getSheetByName('🏢 Prestadores');
  if (!localSheet) return null;
  var data = localSheet.getRange(1, 1, localSheet.getLastRow(), 4).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][1] &&
        data[i][1].toString().trim().toLowerCase() === nomeLocal.toString().trim().toLowerCase()) {
      return data[i][3] ? data[i][3].toString().trim() : null;
    }
  }
  return null;
}

/**
 * Exportação via menu da planilha (mantém alertas de UI).
 * NÃO usar no contexto WebApp — use _exportarPDFWebApp() via gerarRequisicaoPDF().
 */
function exportarPDF() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet       = spreadsheet.getSheetByName('Requisição de Exames');
  var nomeLocal         = sheet.getRange('E10').getValue();
  var emailDestinatario = buscarEmailDoLocal(nomeLocal);

  if (!emailDestinatario) {
    SpreadsheetApp.getUi().alert('E-mail do local "' + nomeLocal + '" não encontrado em "🏢 Prestadores".');
    return;
  }

  var dataAgendamento = sheet.getRange('H10').getValue();
  if (!(dataAgendamento instanceof Date) || isNaN(dataAgendamento.getTime())) {
    SpreadsheetApp.getUi().alert('Data de agendamento inválida.');
    return;
  }

  var dataFormatada   = Utilities.formatDate(dataAgendamento, 'GMT-3', 'dd-MM-yyyy');
  var paciente        = sheet.getRange('E8').getValue();
  var pacienteLimpo   = limparNome(paciente);
  var dataNascRaw     = sheet.getRange('E9').getValue();
  var dataNasc        = (dataNascRaw instanceof Date)
    ? Utilities.formatDate(dataNascRaw, 'GMT-3', 'dd/MM/yyyy') : dataNascRaw;
  var medico          = sheet.getRange('H9').getValue();
  var nomeArquivo     = 'IPS-UCS - ' + pacienteLimpo + ' - ' + dataFormatada + '.pdf';
  var pesquisaClinica = sheet.getRange('H8').getDisplayValue();
  var urgente         = sheet.getRange('I5').getValue();
  var urgenteTag      = urgente
    ? '<span style="background:#e53935;color:white;padding:2px 8px;border-radius:4px;font-weight:700;">URGENTE</span>&nbsp;'
    : '';

  var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheet.getId() + '/export?';
  var exportOptions =
    'exportFormat=pdf&format=pdf&size=A4&portrait=true&fitw=true' +
    '&sheetnames=false&printtitle=false&pagenumbers=false' +
    '&gridlines=false&fzr=false&gid=' + sheet.getSheetId() +
    '&top_margin=0.15&bottom_margin=0.15&left_margin=0.15&right_margin=0.15&scale=4';
  var token    = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url + exportOptions, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  var pdfBlob = response.getBlob().setName(nomeArquivo);

  var tituloEmail =
    'IPS/UCS - Agendamento de Exames - Paciente: ' + pacienteLimpo + ' - Data: ' + dataFormatada;
  var signature = getGmailSignature();
  var corpoEmail = gerarReqExamesEmailHtml_({
    paciente: paciente,
    dataFormatada: dataFormatada,
    dataNasc: dataNasc,
    medico: medico,
    pesquisaClinica: pesquisaClinica,
    urgenteTag: urgenteTag,
    signature: signature
  });

  var ccEmails = getReqExamesCcEmails_();

  var draftOptions = { htmlBody: corpoEmail, attachments: [pdfBlob] };
  if (ccEmails) draftOptions.cc = ccEmails;
  GmailApp.createDraft(emailDestinatario, tituloEmail, '', draftOptions);
  SpreadsheetApp.getUi().alert('✓ Rascunho criado para: ' + emailDestinatario);
}

function limparNome(nome) {
  if (typeof nome !== 'string') return nome;
  nome = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  nome = nome.replace(/[^a-zA-Z0-9 ]/g, '');
  nome = nome.replace(/\s+/g, ' ');
  return nome.trim();
}

function gerarReqExamesEmailHtml_(dados) {
  dados = dados || {};
  var paciente = dados.paciente || '';
  var dataFormatada = dados.dataFormatada || '';
  var rows = [
    ['Nome completo', paciente],
    ['Data de Nascimento', dados.dataNasc || ''],
    ['Médico Solicitante', dados.medico || ''],
    ['Data do Agendamento', dataFormatada],
    ['Pesquisa clínica', dados.pesquisaClinica || '']
  ];
  return gerarHtmlCabecalhoEmail_('Agendamento de Exames', '#2c3e50') +
    '<p>Prezado(a),</p>' +
    '<p>' + (dados.urgenteTag || '') + 'Solicitamos o agendamento dos exames para o(a) paciente ' +
      escHtmlServer_(paciente) + ' para o dia ' + escHtmlServer_(dataFormatada) +
      ', conforme requisição anexa.</p>' +
    '<p><strong>Informações do Paciente:</strong></p>' +
    gerarTabelaEmailGenerica_(rows) +
    '<p>O(a) paciente já possui orientações de preparo para o exame.</p>' +
    '<p>Importante: Informamos que o pagamento deste exame será realizado por meio de nosso processo de faturamento de rotina.</p>' +
    '<p>Agradecemos a atenção e aguardamos a confirmação do agendamento.</p>' +
    '<p>Atenciosamente,</p>' +
    (dados.signature || '') +
    '</div>';
}

function gerarTabelaEmailGenerica_(rows) {
  return '<table style="border-collapse:collapse;margin:10px 0;font-size:13px;">' +
    (rows || []).map(function(r) {
      return '<tr><td style="padding:4px 8px;border:1px solid #ddd;"><b>' + escHtmlServer_(r[0]) + '</b></td>' +
        '<td style="padding:4px 8px;border:1px solid #ddd;">' + escHtmlServer_(r[1]) + '</td></tr>';
    }).join('') + '</table>';
}

function getGmailSignature() {
  try {
    var sendAs = Gmail.Users.Settings.SendAs.list('me').sendAs;
    for (var i = 0; i < sendAs.length; i++) {
      if (sendAs[i].isDefault) {
        var sig      = sendAs[i].signature;
        var imageUrl = 'https://www.ucs.br/ips/wp-content/uploads/2024/08/email_signature_ips2024.png';
        sig = sig.replace(/<img[^>]+src="[^"]+"[^>]*>/gi, '');
        sig += '<img src="' + imageUrl + '" alt="Assinatura">';
        return sig;
      }
    }
  } catch(e) { return ''; }
  return '';
}

function resetarCampos() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Requisição de Exames');
  ['I5','E8','E9','E10','E11','H8','H9','H10','J10',
   'C14:C33','H14:H33','B36','H41','H42','H43']
    .forEach(function(r) { sheet.getRange(r).clearContent(); });
  SpreadsheetApp.getUi().alert('Campos resetados com sucesso.');
}



// ══════════════════════════════════════════════════════
//  AGENDA
// ══════════════════════════════════════════════════════
function abrirNovoEventoComCalendario() {
  var html = HtmlService
    .createHtmlOutputFromFile('NovoEventoAgenda')
    .setWidth(720).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

function getDadosFormularioAgenda() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function listaColB(nomeAba) {
    var sh = ss.getSheetByName(nomeAba);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 2, sh.getLastRow() - 1, 1)
             .getValues().map(function(r){ return r[0]; }).filter(Boolean).sort();
  }
  var hoje = new Date();
  var hojeIso = hoje.getFullYear() + '-' +
                ('0'+(hoje.getMonth()+1)).slice(-2) + '-' +
                ('0'+hoje.getDate()).slice(-2);
  return {
    participantes: listaColB('Participantes'),
    medicos:       listaColB('🩺 Médicos'),
    prestadores:   listaColB('🏢 Prestadores'),
    projetos:      listaColB('Projetos'),
    hojeIso:       hojeIso
  };
}

function getInfoParticipante(nome) {
  if (!nome) return null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Participantes');
  if (!sh || sh.getLastRow() < 2) return null;
  var dados = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  for (var i = 0; i < dados.length; i++) {
    if (dados[i][1] != nome) continue;
    var nascRaw = dados[i][2];
    var nascStr = '';
    if (nascRaw instanceof Date) {
      nascStr = ('0' + nascRaw.getDate()).slice(-2) + '/' +
                ('0' + (nascRaw.getMonth() + 1)).slice(-2) + '/' +
                nascRaw.getFullYear();
    } else if (nascRaw) { nascStr = String(nascRaw); }
    return {
      nascimento: nascStr,
      numId:   String(dados[i][4] || ''),
      projeto: String(dados[i][5] || ''),
      braco:   String(dados[i][6] || '')
    };
  }
  return null;
}

function salvarNovoEventoCompleto(dados) {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = ss.getSheetByName(CFG.abaNome);
  if (!agenda) throw new Error('Aba Agenda não encontrada.');
  var d    = _parseDateHora(dados.data, dados.hora);
  var dCmp = new Date(d); dCmp.setHours(0,0,0,0);
  var lastRow = agenda.getLastRow();
  if (lastRow > 1) {
    var vals = agenda.getRange(2, 1, lastRow - 1, CFG.lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var ld = vals[i][COL_DATA - 1];
      var lt = (vals[i][COL_TIPO - 1] || '').toString().toLowerCase();
      if (ld instanceof Date) {
        var dl = new Date(ld); dl.setHours(0,0,0,0);
        if (dl.getTime() === dCmp.getTime() && lt === 'feriado') {
          return { feriado: true, dataFmt: formatarDataSafe(d) };
        }
      }
    }
  }
  return _gravarLinhaEvento(agenda, d, dados, ss);
}

function salvarNovoEventoComFeriado(dados) {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = ss.getSheetByName(CFG.abaNome);
  if (!agenda) throw new Error('Aba Agenda não encontrada.');
  var d = _parseDateHora(dados.data, dados.hora);
  return _gravarLinhaEvento(agenda, d, dados, ss);
}

function _gravarLinhaEvento(agenda, d, dados, ss) {
  var tipo       = dados.tipo          || '';
  var status     = dados.status        || 'Agendado';
  var part       = dados.participante  || '';
  var projeto    = dados.projeto       || '';
  var visita     = dados.visita        || '';
  var medico     = dados.medico        || '';
  var proced     = dados.procedimentos || '';
  var terc       = dados.servTerc      || '';
  var obs        = dados.obs           || '';
  var labCentral = dados.labCentral    || '';
  var tiposNaoLab = ['monitoria','siv','close-out','reunião','feriado',
                     'auditoria','exame de imagem'];
  if (tiposNaoLab.indexOf(tipo.toLowerCase()) > -1) labCentral = 'Não aplicável';
  if (labCentral.toLowerCase() === 'sim' && !visita) {
    return { erro: 'Para "Laboratório Central = Sim", informe a Visita.' };
  }
  var linhaNova = agenda.getLastRow() + 1;
  var id = Utilities.getUuid().slice(0, 8);
  agenda.getRange(linhaNova, COL_ID         ).setValue(id);
  setAgendaDateValue_(agenda.getRange(linhaNova, COL_DATA), d);
  setAgendaValueAndFormat_(agenda.getRange(linhaNova, COL_HORA), d, 'HH:mm');
  agenda.getRange(linhaNova, COL_TIPO       ).setValue(tipo);
  agenda.getRange(linhaNova, COL_STATUS     ).setValue(status);
  agenda.getRange(linhaNova, COL_PARTICIPANTE).setValue(part);
  agenda.getRange(linhaNova, COL_PROJETO    ).setValue(projeto);
  agenda.getRange(linhaNova, COL_VISITA     ).setValue(visita);
  agenda.getRange(linhaNova, 12             ).setValue(medico);
  agenda.getRange(linhaNova, 13             ).setValue(proced);
  agenda.getRange(linhaNova, CFG.colTerc    ).setValue(terc);
  agenda.getRange(linhaNova, COL_OBS        ).setValue(obs);
  agenda.getRange(linhaNova, CFG.colGatilho ).setValue(labCentral);
  agenda.getRange(linhaNova, 1, 1, CFG.lastCol)
    .setFontFamily('Roboto').setFontSize(10)
    .setFontColor('#434343').setFontWeight('normal');
  agenda.getRange(linhaNova, COL_DATA   ).setFontWeight('bold');
  agenda.getRange(linhaNova, COL_PROJETO).setFontWeight('bold');
  if (status.toLowerCase() === 'cancelado') {
    aplicarLogicaCancelamento(agenda, linhaNova, status);
  }
  var celGatilho = agenda.getRange(linhaNova, CFG.colGatilho);
  verificarNotificacoes({
    source: ss, range: celGatilho, user: Session.getActiveUser()
  }, id, null);
  agenda.getRange(2, 1, agenda.getLastRow() - 1, CFG.lastCol)
    .sort([{ column: COL_DATA, ascending: true }, { column: COL_HORA, ascending: true }]);
  SpreadsheetApp.flush();
  var linhaReal = encontrarLinhaPorId(agenda, id);
  if (linhaReal) {
    agenda.getRange(linhaReal, COL_PARTICIPANTE).activate();
    rastrearEMoverFoco(agenda, id, COL_PARTICIPANTE);
  }
  return { ok: true, id: id };
}

function _parseDateHora(dataIso, horaStr) {
  var base = parseAgendaDateAny_(dataIso);
  if (base) {
    var hh = (horaStr || '00:00').split(':');
    base.setHours(Number(hh[0] || 0), Number(hh[1] || 0), 0, 0);
    return base;
  }
  var p = String(dataIso || '').split('-');
  var h = (horaStr || '00:00').split(':');
  return new Date(+p[0], +p[1]-1, +p[2], +h[0], +h[1]);
}

function parseAgendaDateAny_(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !isNaN(valor.getTime())) return new Date(valor);
  var s = String(valor || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{1,2})\/([a-z]{3,})\.?\/(\d{4})$/);
  if (m) {
    var meses = {
      jan: 0, janeiro: 0, fev: 1, fevereiro: 1, mar: 2, marco: 2,
      abr: 3, abril: 3, mai: 4, maio: 4, jun: 5, junho: 5,
      jul: 6, julho: 6, ago: 7, agosto: 7, set: 8, setembro: 8,
      out: 9, outubro: 9, nov: 10, novembro: 10, dez: 11, dezembro: 11
    };
    var mes = meses[m[2]];
    if (mes !== undefined) return new Date(Number(m[3]), mes, Number(m[1]));
  }
  return null;
}



// ══════════════════════════════════════════════════════
//  UTILITÁRIOS
// ══════════════════════════════════════════════════════
function getUsuarioEmail() {
  try { return Session.getActiveUser().getEmail(); }
  catch(e) { return 'usuário'; }
}



// ════════════════════════════════
//  PROJETOS — funções da webapp
// ════════════════════════════════
function getConfigValues_(grupo, chave, fallback) {
  var rows = readConfigAppRows_().filter(function(r) {
    var ativo = String(r.ativo || 'Sim').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return String(r.grupo || '') === grupo &&
      String(r.chave || '') === chave &&
      String(r.valor || '').trim() &&
      ['nao', 'false', '0', 'inativo'].indexOf(ativo) === -1;
  }).sort(function(a, b) {
    return (Number(a.ordem || 0) - Number(b.ordem || 0)) || String(a.valor).localeCompare(String(b.valor));
  }).map(function(r) { return r.valor; });
  return rows.length ? rows : (fallback || []);
}

function getProjetoFormConfig() {
  return {
    especialidades: getConfigValues_('Médicos', 'Especialidade', []),
    fases: getConfigValues_('Projetos', 'Fase', []),
    patrocinadores: getConfigValues_('Projetos', 'Patrocinador', []),
    cros: getConfigValues_('Projetos', 'CRO', []),
    status: getConfigValues_('Projetos', 'Status', [])
  };
}

function getMedicoFormConfig() {
  return {
    especialidades: getConfigValues_('Médicos', 'Especialidade', [])
  };
}

function getProjetos() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('Projetos');
  if (!aba) return [];
  var dados = aba.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[0]) continue;
    lista.push({
      id:            String(r[0]),
      nomeAbreviado: r[1] || '',
      codigo:        r[2] || '',
      especialidade: r[3] || '',
      fase:          r[4] || '',
      investigador:  r[5] || '',
      subInvestigador1: r[6] || '',
      subInvestigador2: r[7] || '',
      centro:        r[8] || '',
      patrocinador:  r[9] || '',
      cro:           r[10] || '',
      coordenador:   r[11] || '',
      status:        r[12] || ''
    });
  }
  return lista;
}

function isProjetoAtivoEstoque_(status) {
  var s = String(status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return s !== 'concluido' && s !== 'cancelado';
}

function getProjetosAtivosEstoque_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Projetos');
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(13, sh.getLastColumn())).getValues();
  var seen = {}, out = [];
  rows.forEach(function(r) {
    var nome = String(r[1] || r[2] || '').trim();
    if (!nome || !isProjetoAtivoEstoque_(r[12])) return;
    if (!seen[nome]) {
      seen[nome] = 1;
      out.push(nome);
    }
  });
  return out.sort();
}

function salvarDadosProjeto(dados) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('Projetos');
  if (!aba) throw new Error('Aba "Projetos" não encontrada.');

  if (dados.id) {
    var rows = aba.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(dados.id)) {
        aba.getRange(i + 1, 2, 1, 12).setValues([[
          dados.nomeAbreviado || '',
          dados.codigo        || '',
          dados.especialidade || '',
          dados.fase          || '',
          dados.investigador  || '',
          dados.subInvestigador1 || '',
          dados.subInvestigador2 || '',
          dados.centro        || '',
          dados.patrocinador  || '',
          dados.cro           || '',
          dados.coordenador   || '',
          dados.status        || ''
        ]]);
        return 'Projeto atualizado com sucesso!';
      }
    }
    throw new Error('Projeto não encontrado para edição.');
  } else {
    var id = 'PROJ-' + Date.now();
    aba.appendRow([
      id,
      dados.nomeAbreviado || '',
      dados.codigo        || '',
      dados.especialidade || '',
      dados.fase          || '',
      dados.investigador  || '',
      dados.subInvestigador1 || '',
      dados.subInvestigador2 || '',
      dados.centro        || '',
      dados.patrocinador  || '',
      dados.cro           || '',
      dados.coordenador   || '',
      dados.status        || ''
    ]);
    return 'Projeto cadastrado com sucesso!';
  }
}

function excluirProjeto(id) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('Projetos');
  if (!aba) throw new Error('Aba "Projetos" não encontrada.');
  var rows = aba.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      aba.deleteRow(i + 1);
      return 'Excluído com sucesso.';
    }
  }
  throw new Error('Projeto não encontrado.');
}



// ════════════════════════════════
//  PARTICIPANTES — webapp
// ════════════════════════════════
function getParticipantes() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var sh  = ss.getSheetByName('Participantes');
  var rows = sh.getDataRange().getValues();
  var tz  = Session.getScriptTimeZone();

  return rows.slice(1)
    .filter(function(r){ return r[0] !== '' && r[0] !== undefined && r[0] !== null; })
    .map(function(r) {
      function fmtDate(val) {
        if (!val) return '';
        try {
          var d = (val instanceof Date) ? val : new Date(val);
          if (isNaN(d.getTime())) return String(val);
          return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
        } catch(e) { return String(val); }
      }
      return {
        id:             String(r[0]),
        nome:           String(r[1] || ''),
        dataNascimento: fmtDate(r[2]),
        idade:          String(r[3] || ''),
        idParticipante: String(r[4] || ''),
        projeto:        String(r[5] || ''),
        braco:          String(r[6] || ''),
        ultimaVisita:   fmtDate(r[7]),
        status:         String(r[8] || ''),
        telefone:       String(r[9] || ''),
        cpf:            String(r[10] || ''),
        observacoes:    String(r[11] || '')
      };
    });
}

function getParticipanteFormConfig() {
  return {
    status: getConfigValues_('Participantes', 'Status', [])
  };
}

function salvarDadosParticipante(d) {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var sh   = ss.getSheetByName('Participantes');
  var rows = sh.getDataRange().getValues();

  function parseDate(s) {
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      var p = s.split('-');
      return new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      var p = s.split('/');
      return new Date(Number(p[2]), Number(p[1])-1, Number(p[0]));
    }
    return s;
  }

  function calcIdade(nascStr) {
    if (!nascStr) return '';
    var nasc = parseDate(nascStr);
    if (!(nasc instanceof Date) || isNaN(nasc.getTime())) return '';
    var hoje = new Date();
    var idade = hoje.getFullYear() - nasc.getFullYear();
    var m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade;
  }

  var rowData = [
    d.id || '',
    d.nome,
    parseDate(d.dataNascimento),
    calcIdade(d.dataNascimento),
    d.idParticipante,
    d.projeto || '',
    d.braco || '',
    parseDate(d.ultimaVisita),
    d.status,
    d.telefone || '',
    d.cpf || '',
    d.observacoes || ''
  ];

  if (d.id) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        return 'Participante atualizado com sucesso';
      }
    }
    throw new Error('Participante não encontrado (id=' + d.id + ')');
  } else {
    var maxId = 0;
    rows.slice(1).forEach(function(r) {
      var n = parseInt(r[0]);
      if (!isNaN(n) && n > maxId) maxId = n;
    });
    rowData[0] = maxId + 1;
    sh.appendRow(rowData);
    return 'Participante cadastrado com sucesso';
  }
}

function excluirParticipante(id) {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var sh   = ss.getSheetByName('Participantes');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      return 'Participante excluído';
    }
  }
  throw new Error('Participante não encontrado (id=' + id + ')');
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRESTADORES
// ══════════════════════════════════════════════════════════════════════════════
function getPrestadores() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🏢 Prestadores');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function(r) { return r[1]; })
    .map(function(r) {
      return { id: r[0] || '', empresa: r[1] || '', endereco: r[2] || '', email: r[3] || '' };
    });
}

function salvarDadosPrestador(dados) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🏢 Prestadores');
  if (!sh) throw new Error("Aba 'Prestadores' não encontrada.");
  if (dados.id && dados.id !== '') {
    var ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(dados.id)) {
        var ln = i + 2;
        sh.getRange(ln, 2).setValue(dados.empresa  || '');
        sh.getRange(ln, 3).setValue(dados.endereco || '');
        sh.getRange(ln, 4).setValue(dados.email    || '');
        return 'Prestador atualizado com sucesso.';
      }
    }
    throw new Error('Prestador não encontrado para edição.');
  }
  sh.appendRow([
    'PREST-' + Date.now(),
    dados.empresa  || '',
    dados.endereco || '',
    dados.email    || ''
  ]);
  return 'Prestador cadastrado com sucesso.';
}

function excluirPrestador(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🏢 Prestadores');
  if (!sh || sh.getLastRow() < 2) throw new Error('Nenhum registro encontrado.');
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return 'ok'; }
  }
  throw new Error('Prestador não encontrado.');
}

// ══════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
function getDashboardData() {
  Logger.log('[getDashboardData] Iniciando...');
  var diag = { erros: [], projetos: [], participantes: [] };

  function str(v) { return v == null ? '' : String(v); }

  try {
    var projs = getProjetos() || [];
    Logger.log('[getDashboardData] Projetos: ' + projs.length);
    diag.projetos = projs.map(function(p) {
      return {
        id:            str(p.id),
        nomeAbreviado: str(p.nomeAbreviado),
        codigo:        str(p.codigo),
        especialidade: str(p.especialidade),
        fase:          str(p.fase),
        investigador:  str(p.investigador),
        subInvestigador1: str(p.subInvestigador1),
        subInvestigador2: str(p.subInvestigador2),
        centro:        str(p.centro),
        patrocinador:  str(p.patrocinador),
        cro:           str(p.cro),
        coordenador:   str(p.coordenador),
        status:        str(p.status)
      };
    });
  } catch(e) {
    Logger.log('[getDashboardData] ERRO getProjetos: ' + e.message);
    diag.erros.push('getProjetos: ' + e.message);
  }

  try {
    var partAll = getParticipantes() || [];
    Logger.log('[getDashboardData] Participantes: ' + partAll.length);
    diag.participantes = partAll.map(function(p) {
      return {
        nome:    str(p.nome),
        projeto: str(p.projeto),
        status:  str(p.status)
      };
    });
  } catch(e) {
    Logger.log('[getDashboardData] ERRO getParticipantes: ' + e.message);
    diag.erros.push('getParticipantes: ' + e.message);
  }

  try {
    var estoque = getEstoque() || [];
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    function diasAte(val) {
      if (!val) return 999999;
      var s = String(val).trim();
      var p = s.split('/');
      var d;
      if (p.length === 3) d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
      else {
        p = s.split('-');
        if (p.length === 3) d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      }
      if (!d || isNaN(d.getTime())) return 999999;
      d.setHours(0, 0, 0, 0);
      return Math.floor((d - hoje) / 86400000);
    }
    diag.estoqueResumo = {
      lotes: estoque.length,
      ok: estoque.filter(function(i) { return String(i.status || '').toLowerCase() === 'ok'; }).length,
      baixo: estoque.filter(function(i) { return String(i.status || '').toLowerCase().indexOf('baixo') >= 0; }).length,
      vencidos: estoque.filter(function(i) {
        return diasAte(i.validade) < 0 || String(i.status || '').toLowerCase().indexOf('vencido') >= 0;
      }).length,
      proximosValidade: estoque.filter(function(i) {
        var d = diasAte(i.validade);
        return d >= 0 && d <= 90;
      }).length
    };
  } catch(e) {
    Logger.log('[getDashboardData] ERRO estoque: ' + e.message);
    diag.estoqueResumo = { lotes: 0, ok: 0, baixo: 0, vencidos: 0, proximosValidade: 0 };
  }

  try {
    diag.agendaResumo = getAgendaDashboardResumo_();
  } catch(e) {
    Logger.log('[getDashboardData] ERRO agenda: ' + e.message);
    diag.agendaResumo = {
      totalAno: 0,
      visitasRealizadasAno: 0,
      labCentralAno: 0,
      monitoriaDiasAno: 0,
      visitasMes: [],
      visitasPorProtocolo: [],
      monitoriaPorProtocolo: [],
      visitasPorMedico: [],
      labCentralMes: [],
      visitasPorDiaSemana: [],
      cancelReagPorProtocolo: [],
      courierUsoAno: [],
      antecedenciaMediaPorTipo: []
    };
  }

  Logger.log('[getDashboardData] Retornando. Erros: ' + JSON.stringify(diag.erros));
  return diag;
}

function getAgendaDashboardResumo_() {
  var sh = getAgendaSheet_();
  var lastRow = sh.getLastRow();
  var anoAtual = new Date().getFullYear();
  var meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  var dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
  var resumo = {
    totalAno: 0,
    visitasRealizadasAno: 0,
    labCentralAno: 0,
    monitoriaDiasAno: 0,
    visitasMes: meses.map(function(m) { return { label: m, value: 0 }; }),
    labCentralMes: meses.map(function(m) { return { label: m, value: 0 }; }),
    visitasPorProtocolo: [],
    monitoriaPorProtocolo: [],
    visitasPorMedico: [],
    visitasPorDiaSemana: dias.map(function(d) { return { label: d, value: 0 }; }),
    cancelReagPorProtocolo: [],
    courierUsoAno: [],
    antecedenciaMediaPorTipo: []
  };
  if (lastRow < 2) return resumo;
  var vals = sh.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
  var i = AGENDA_CFG.idx;
  var porProt = {};
  var porMonProtDia = {};
  var porMed = {};
  var cancelReagProt = {};
  var courierUso = {};
  var antecedenciaPorTipo = {};
  var hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  vals.forEach(function(r) {
    var data = r[i.data] instanceof Date ? r[i.data] : new Date(r[i.data]);
    if (!data || isNaN(data.getTime()) || data.getFullYear() !== anoAtual) return;
    var tipo = normText_(r[i.tipo]);
    var status = normText_(r[i.status]);
    var projeto = String(r[i.projeto] || 'Sem protocolo').trim() || 'Sem protocolo';
    var medico = String(r[i.medico] || 'Sem medico').trim() || 'Sem medico';
    var lab = normText_(r[i.labCentral]) === 'sim';
    var isCancelado = status.indexOf('cancel') > -1;
    var isReagendado = status.indexOf('reag') > -1;
    var isMonitoria = tipo.indexOf('monitoria') > -1;
    var isVisita = tipo.indexOf('visita') > -1;
    var isEventoComTransporte = isVisita || tipo.indexOf('envio de amostra') > -1 || tipo.indexOf('amostra') > -1;
    var isRealizada = status.indexOf('realiz') > -1 || status.indexOf('concl') > -1;
    resumo.totalAno++;
    if ((isCancelado || isReagendado) && projeto) {
      cancelReagProt[projeto] = (cancelReagProt[projeto] || 0) + 1;
    }
    if (lab && !isCancelado) {
      resumo.labCentralAno++;
      resumo.labCentralMes[data.getMonth()].value++;
    }
    if (isMonitoria && !isCancelado) {
      var keyMon = projeto + '|' + formatarDataIsoAgenda_(data);
      porMonProtDia[keyMon] = { projeto: projeto };
    }
    if (isVisita && isRealizada && !isCancelado && data.getTime() <= hoje.getTime()) {
      resumo.visitasRealizadasAno++;
      resumo.visitasMes[data.getMonth()].value++;
      resumo.visitasPorDiaSemana[data.getDay()].value++;
      porProt[projeto] = (porProt[projeto] || 0) + 1;
      porMed[medico] = (porMed[medico] || 0) + 1;
      var base = agendaDataRegistroFromControle_(r[i.controle]);
      if (base) {
        base.setHours(0, 0, 0, 0);
        var visita = new Date(data);
        visita.setHours(0, 0, 0, 0);
        var diasAnt = Math.round((visita - base) / 86400000);
        if (diasAnt >= 0 && diasAnt < 730) {
          var tipoLabel = String(r[i.tipo] || 'Visita').trim() || 'Visita';
          if (!antecedenciaPorTipo[tipoLabel]) antecedenciaPorTipo[tipoLabel] = { soma: 0, n: 0 };
          antecedenciaPorTipo[tipoLabel].soma += diasAnt;
          antecedenciaPorTipo[tipoLabel].n++;
        }
      }
    }
    if (isEventoComTransporte && isRealizada && !isCancelado && data.getTime() <= hoje.getTime() && lab) {
      [i.c1, i.c2, i.c3].forEach(function(c) {
        if (!c || c.nome === undefined) return;
        var nomeCourier = String(r[c.nome] || '').trim();
        if (!isCourierNomeValidoAgenda_(nomeCourier)) return;
        courierUso[nomeCourier] = (courierUso[nomeCourier] || 0) + 1;
      });
    }
  });
  var monMap = {};
  Object.keys(porMonProtDia).forEach(function(k) {
    var p = porMonProtDia[k].projeto;
    monMap[p] = (monMap[p] || 0) + 1;
  });
  resumo.monitoriaDiasAno = Object.keys(porMonProtDia).length;
  resumo.visitasPorProtocolo = agendaMapToPairs_(porProt, 15);
  resumo.monitoriaPorProtocolo = agendaMapToPairs_(monMap, 15);
  resumo.visitasPorMedico = agendaMapToPairs_(porMed, 12);
  resumo.cancelReagPorProtocolo = agendaMapToPairs_(cancelReagProt, 15);
  resumo.courierUsoAno = agendaMapToPairs_(courierUso, 12);
  resumo.antecedenciaMediaPorTipo = [];
  return resumo;
}

function isCourierNomeValidoAgenda_(nome) {
  var n = normText_(nome);
  if (!n) return false;
  return ['nao aplicavel', 'na', 'n/a', '-', '--', '---', 'nao se aplica'].indexOf(n) === -1;
}

function agendaDataRegistroFromControle_(controle) {
  var s = String(controle || '');
  var m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}

function agendaMapToPairs_(map, limit) {
  var pairs = Object.keys(map).map(function(k) { return { label: k, value: map[k] }; })
    .sort(function(a, b) { return b.value - a.value || a.label.localeCompare(b.label); });
  limit = limit || 12;
  if (pairs.length <= limit) return pairs;
  var head = pairs.slice(0, limit - 1);
  var rest = pairs.slice(limit - 1).reduce(function(sum, p) { return sum + p.value; }, 0);
  head.push({ label: 'Outros', value: rest });
  return head;
}

// ═══════════════════════════════════════════════════════
//  ESTOQUE — Itens
// ═══════════════════════════════════════════════════════

function getItensEstoque() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var shItens = getSheetByPossibleNames_(ss, ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);
  var shProj  = ss.getSheetByName('Projetos');
  var projetosAtivos = getProjetosAtivosEstoque_();

  var projetos = [];
  if (shProj && shProj.getLastRow() > 1) {
    var projData = shProj.getRange(2, 1, shProj.getLastRow() - 1, shProj.getLastColumn()).getValues();
    var seen = {};
    projData.forEach(function(r) {
      var nome = String(r[1] || r[0] || '').trim();
      if (nome && !seen[nome]) { seen[nome] = 1; projetos.push(nome); }
    });
    projetos.sort();
  }

  if (!shItens || shItens.getLastRow() < 2) {
    return { itens: [], projetos: projetos, projetosAtivos: projetosAtivos };
  }

  var data  = shItens.getDataRange().getValues();
  // Colunas: A=ID_Item B=Projeto C=Descrição D=Tipo E=Localização F=EstoqueMin G=Observações H=Laboratório I=Status

  var itens = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!String(r[2] || '').trim()) continue;
    itens.push({
      id:          String(i + 1),
      idItem:      String(r[0] || ''),
      projeto:     String(r[1] || ''),
      descricao:   String(r[2] || ''),
      tipo:        String(r[3] || ''),
      localizacao: String(r[4] || ''),
      estoqueMin:  (r[5] !== '' && r[5] !== null) ? r[5] : '',
      observacoes: String(r[6] || ''),
      laboratorio: String(r[7] || ''),
      status:      String(r[8] || '')
    });
  }

  var projetosItens = {};
  itens.forEach(function(it) {
    if (it.projeto) projetosItens[it.projeto] = 1;
  });
  if (Object.keys(projetosItens).length) projetos = Object.keys(projetosItens).sort();

  return { itens: itens, projetos: projetos, projetosAtivos: projetosAtivos };
}

// ───────────────────────────────────────────────────────

function salvarItemEstoque(payload) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetByPossibleNames_(ss, ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);

  if (!sheet) {
    sheet = ss.insertSheet('Itens');
    sheet.appendRow([
      'ID_Item', 'Projeto', 'Descrição', 'Tipo de item',
      'Localização padrão', 'Estoque mínimo', 'Observações',
      'Laboratório', 'Status'
    ]);
    var hRange = sheet.getRange(1, 1, 1, 9);
    hRange.setFontWeight('bold').setBackground('#1266f1').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  var estoqueMin = (payload.estoqueMin !== '' && payload.estoqueMin !== null && payload.estoqueMin !== undefined)
    ? Number(payload.estoqueMin) : '';

  if (payload.id) {
    // Edição
    var row = parseInt(payload.id);
    sheet.getRange(row, 2, 1, 8).setValues([[
      payload.projeto, payload.descricao, payload.tipo,
      payload.localizacao, estoqueMin,
      payload.observacoes, payload.laboratorio, payload.status
    ]]);
    return 'Item atualizado com sucesso!';
  } else {
    // Novo — mantém padrão numérico "0001" igual aos existentes
    var seq    = sheet.getLastRow();
    var novoId = ('0000' + seq).slice(-4);
    sheet.appendRow([
      novoId, payload.projeto, payload.descricao, payload.tipo,
      payload.localizacao, estoqueMin,
      payload.observacoes, payload.laboratorio, payload.status
    ]);
    return 'Item cadastrado! ID: ' + novoId;
  }
}

// ───────────────────────────────────────────────────────

function excluirItemEstoque(id) {
  var sheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);
  if (!sheet) throw new Error('Aba "Itens" não encontrada.');
  var row = parseInt(id);
  if (isNaN(row) || row < 2) throw new Error('Linha inválida: ' + id);
  sheet.deleteRow(row);
  return 'Item excluído com sucesso.';
}

// ═══════════════════════════════════════════════════════
//  ESTOQUE — Pedidos  (WebApp.gs — substitua as 3 funções abaixo)
// ═══════════════════════════════════════════════════════

function getPedidosEstoque() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var shPed   = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var shPedIt = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido']);
  var shItens = getSheetByPossibleNames_(ss, ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);
  var tz      = Session.getScriptTimeZone();

  // ── 1. Pedidos (A=ID_Pedido B=Número C=Data D=Projeto E=Lab F=Responsável G=Status H=Obs) ──
  var pedidos = [];
  if (shPed && shPed.getLastRow() > 1) {
    var data = shPed.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!String(r[0]||'').trim()) continue;
      var dataFmt = '', dataISO = '';
      if (r[2]) {
        try {
          dataFmt = Utilities.formatDate(new Date(r[2]), tz, 'dd/MM/yyyy');
          dataISO = Utilities.formatDate(new Date(r[2]), tz, 'yyyy-MM-dd');
        } catch(e) {}
      }
      pedidos.push({
        rowIndex:     i + 1,            // linha real na planilha (para editar/excluir)
        idPedido:     String(r[0]||''), // valor da col A (para vincular com Pedido_Itens)
        numeroPedido: String(r[1]||''),
        data:         dataFmt,          // exibição dd/MM/yyyy
        dataISO:      dataISO,          // yyyy-MM-dd (para input date do formulário)
        projeto:      String(r[3]||''),
        laboratorio:  String(r[4]||''),
        responsavel:  String(r[5]||''),
        status:       String(r[6]||'Pendente'),
        observacoes:  String(r[7]||'')
      });
    }
  }

  // ── 2. Itens de cada pedido (para accordion na tela) ──
  // Pedido_Itens: A=ID_Pedido B=N° C=Projeto D=Descrição E=Tipo F=ID_Item G=QtdSol H=QtdRec I=Status
  var pedidoItensMap = {}; // { "ID_Pedido": [{...}] }
  if (shPedIt && shPedIt.getLastRow() > 1) {
    var piRows = shPedIt.getDataRange().getValues();
    for (var j = 1; j < piRows.length; j++) {
      var r = piRows[j];
      var idP = String(r[0]||'').trim();
      if (!idP) continue;
      if (!pedidoItensMap[idP]) pedidoItensMap[idP] = [];
      pedidoItensMap[idP].push({
        descricao:     String(r[3]||''),
        tipo:          String(r[4]||''),
        idItem:        String(r[5]||''),
        qtdSolicitada: Number(r[6]||0),
        qtdRecebida:   Number(r[7]||0),
        status:        String(r[8]||'Pendente')
      });
    }
  }

  // ── 3. Catálogo de itens para cascata do formulário (Projeto → Lab → Tipo → Item) ──
  // Itens: A=ID_Item B=Projeto C=Descrição D=Tipo … H=Lab I=Status
  var projLabsMap     = {}; // { "ProjetoX": ["Lab1","Lab2"] }
  var projLabItensMap = {}; // { "ProjetoX||Lab1": [{id,descricao,tipo}] }
  var itensCatalogo   = [];
  var projetosSet = {}, projetos = [];
  if (shItens && shItens.getLastRow() > 1) {
    var itRows = shItens.getRange(2, 1, shItens.getLastRow()-1, 9).getValues();
    itRows.forEach(function(r) {
      var id   = String(r[0]||'').trim();
      var proj = String(r[1]||'').trim(); // B Projeto
      var desc = String(r[2]||'').trim(); // C Descrição
      var tipo = String(r[3]||'').trim(); // D Tipo
      var lab  = String(r[7]||'').trim(); // H Lab
      var itemStatus = String(r[8]||'').trim();
      var itemInativo = String(itemStatus).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'inativo';
      if (!proj || !desc || itemInativo) return;
      itensCatalogo.push({id:id, projeto:proj, laboratorio:lab, descricao:desc, tipo:tipo});
      if (!projetosSet[proj]) { projetosSet[proj]=1; projetos.push(proj); }
      if (!projLabsMap[proj]) projLabsMap[proj] = {};
      if (lab) {
        projLabsMap[proj][lab] = 1;
        var key = proj + '||' + lab;
        if (!projLabItensMap[key]) projLabItensMap[key] = [];
        if (!projLabItensMap[key].some(function(x){ return x.id===id; }))
          projLabItensMap[key].push({id:id, descricao:desc, tipo:tipo});
      }
    });
    projetos.sort();
    Object.keys(projLabsMap).forEach(function(p){
      projLabsMap[p] = Object.keys(projLabsMap[p]).sort();
    });
  }

  pedidos.forEach(function(p) {
    var itensPedido = pedidoItensMap[p.idPedido] || [];
    if (!itensPedido.length) return;
    var algumRecebido = itensPedido.some(function(it) { return Number(it.qtdRecebida || 0) > 0; });
    var todosRecebidos = itensPedido.every(function(it) {
      return Number(it.qtdSolicitada || 0) > 0 && Number(it.qtdRecebida || 0) >= Number(it.qtdSolicitada || 0);
    });
    var atualPlanejamento = String(p.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').indexOf('planejamento') >= 0;
    var statusCalc = todosRecebidos ? 'Recebido' : (algumRecebido ? 'Parcial' : (atualPlanejamento ? 'Em planejamento' : 'Pendente'));
    if (p.status !== statusCalc) {
      p.status = statusCalc;
      try { shPed.getRange(p.rowIndex, 7).setValue(statusCalc); } catch(e) {}
    }
  });

  return {
    pedidos:         pedidos,
    pedidoItensMap:  pedidoItensMap,
    projetos:        projetos,
    projLabsMap:     projLabsMap,
    projLabItensMap: projLabItensMap,
    itensCatalogo:   itensCatalogo
  };
}

// ───────────────────────────────────────────────────────

function isParticipanteAtivoPlanejamento_(status) {
  var s = String(status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return s === 'ativo' || s === 'em seguimento';
}

function getPlanejamentoPedidoEstoque() {
  var pedidosData = getPedidosEstoque();
  var itens = (pedidosData.itensCatalogo || []).filter(function(it) {
    return String(it.projeto || '').trim() && String(it.descricao || '').trim() && String(it.laboratorio || '').trim();
  });
  var estoque = getEstoque() || [];
  var participantes = getParticipantes() || [];
  var projetoStatusMap = {};
  (getProjetos() || []).forEach(function(p) {
    var nome = String(p.nomeAbreviado || p.codigo || '').trim();
    if (nome) projetoStatusMap[nome] = String(p.status || '');
  });
  var projetosMap = {};
  var pendentesPorItem = {};
  var ultimasVisitasMap = getUltimasVisitasParticipantesAgendaMap_();

  itens.forEach(function(it) {
    if (!projetosMap[it.projeto]) projetosMap[it.projeto] = {
      nome: it.projeto,
      status: projetoStatusMap[it.projeto] || '',
      participantesAtivos: 0,
      participantes: []
    };
  });

  participantes.forEach(function(p) {
    if (!projetosMap[p.projeto]) return;
    if (isParticipanteAtivoPlanejamento_(p.status)) {
      var ultima = ultimasVisitasMap[normText_(p.nome)] || { data: '', visita: '' };
      projetosMap[p.projeto].participantesAtivos++;
      projetosMap[p.projeto].participantes.push({
        nome: p.nome || '',
        ultimaVisitaData: ultima.data || p.ultimaVisita || '',
        ultimaVisitaId: ultima.visita || ''
      });
    }
  });

  Object.keys(pedidosData.pedidoItensMap || {}).forEach(function(idPedido) {
    (pedidosData.pedidoItensMap[idPedido] || []).forEach(function(it) {
      var solicitada = Number(it.qtdSolicitada || 0) || 0;
      var recebida = Number(it.qtdRecebida || 0) || 0;
      var pendente = Math.max(0, solicitada - recebida);
      if (!pendente || !it.idItem) return;
      pendentesPorItem[it.idItem] = (pendentesPorItem[it.idItem] || 0) + pendente;
    });
  });

  var estoquePorItem = {};
  estoque.forEach(function(lote) {
    var ids = String(lote.idItem || '').split(/\s*,\s*/).filter(Boolean);
    ids.forEach(function(id) {
      if (!estoquePorItem[id]) estoquePorItem[id] = [];
      estoquePorItem[id].push({
        validade: lote.validade || '',
        qtde: Number(lote.qtde || 0) || 0,
        localizacao: lote.localizacao || '',
        status: lote.status || '',
        numeroPedido: lote.numeroPedido || ''
      });
    });
  });

  var itensPlanejamento = itens.map(function(it) {
    var lotes = estoquePorItem[it.id] || [];
    var totalEstoque = lotes.reduce(function(total, lote) { return total + (Number(lote.qtde || 0) || 0); }, 0);
    return {
      idItem: it.id,
      projeto: it.projeto,
      laboratorio: it.laboratorio,
      descricao: it.descricao,
      tipo: it.tipo,
      estoqueAtual: totalEstoque,
      pendentePedido: pendentesPorItem[it.id] || 0,
      lotes: lotes
    };
  });

  return {
    projetos: Object.keys(projetosMap).sort().map(function(k) { return projetosMap[k]; }),
    itens: itensPlanejamento,
    solicitantes: getSolicitantes()
  };
}

function salvarPlanejamentoPedidoEstoque(payload) {
  payload = payload || {};
  var projeto = String(payload.projeto || '').trim();
  var itens = (payload.itens || []).filter(function(it) { return Number(it.qtdSolicitada || 0) > 0; });
  if (!projeto) throw new Error('Selecione um projeto.');
  if (!itens.length) throw new Error('Informe pelo menos um item para solicitar.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shPed = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var shPedIt = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido']);
  if (!shPed) throw new Error('Aba "Pedidos" não encontrada.');
  if (!shPedIt) throw new Error('Aba "Pedidos_Itens" não encontrada.');

  var user = Session.getActiveUser().getEmail();
  var dataVal = payload.data ? new Date(payload.data + 'T12:00:00') : new Date();
  var solicitante = String(payload.solicitante || '').trim();
  var obsBase = String(payload.observacoes || '').trim();
  var porLab = {};

  itens.forEach(function(it) {
    var lab = String(it.laboratorio || '').trim();
    if (!lab) throw new Error('Há item sem laboratório definido: ' + (it.descricao || it.idItem || 'item'));
    if (!porLab[lab]) porLab[lab] = [];
    porLab[lab].push(it);
  });

  var labs = Object.keys(porLab).sort();
  var criados = [];
  labs.forEach(function(lab, idx) {
    var seq = shPed.getLastRow();
    var idPedido = 'PED-' + ('0000' + seq).slice(-4);
    var numero = '';
    var obs = obsBase;

    shPed.appendRow([
      idPedido, numero, dataVal, projeto,
      lab, user, 'Em planejamento', obs
    ]);

    var novas = porLab[lab].map(function(it) {
      return [
        idPedido,
        numero,
        projeto,
        String(it.descricao || ''),
        String(it.tipo || ''),
        String(it.idItem || ''),
        Number(it.qtdSolicitada || 0),
        0,
        'Em planejamento',
        ''
      ];
    });
    shPedIt.getRange(shPedIt.getLastRow() + 1, 1, novas.length, 10).setValues(novas);
    criados.push({ idPedido: idPedido, numeroPedido: numero, laboratorio: lab, itens: novas.length });
  });

  var email = String(payload.emailDestino || '').trim();
  var emailErro = '';
  if (email) {
    var pedidosRows = criados.map(function(p) {
      return [p.laboratorio, p.itens + ' item(ns)', 'Em planejamento'];
    });
    var itensHtml = labs.map(function(lab) {
      return '<h3 style="color:#2c3e50;margin:18px 0 6px 0;font-size:15px;">' + escHtmlServer_(lab) + '</h3>' +
        gerarTabelaEmailGenerica_(porLab[lab].map(function(it) {
          return [String(it.descricao || '') + ' (' + String(it.tipo || '') + ')', it.qtdSolicitada];
        }));
    }).join('');
    var bodyHtml = gerarHtmlCabecalhoEmail_('Planejamento de Pedido de Estoque', '#2c3e50') +
      '<p>Foi criada uma lista de planejamento de pedido de estoque para avaliação e posterior solicitação na plataforma do laboratório externo.</p>' +
      gerarTabelaEmailGenerica_([
        ['Projeto', projeto],
        ['Planejado por', user || ''],
        ['Solicitante/responsável pelo pedido externo', solicitante || 'Não informado'],
        ['Status', 'Em planejamento']
      ]) +
      '<h3 style="color:#2c3e50;margin:18px 0 6px 0;font-size:15px;">Pedidos criados</h3>' +
      gerarTabelaEmailGenerica_(pedidosRows) +
      '<h3 style="color:#2c3e50;margin:18px 0 6px 0;font-size:15px;">Itens solicitados</h3>' +
      itensHtml +
      (obsBase ? '<p><b>Observação:</b> ' + escHtmlServer_(obsBase) + '</p>' : '') +
      gerarRodapeEmailAgenda_('Responsável', { getEmail: function() { return user || ''; } }) + '</div>';
    try {
      MailApp.sendEmail({
        to: email,
        subject: 'Planejamento de pedido de estoque - ' + projeto,
        htmlBody: bodyHtml,
        body: 'Planejamento de pedido de estoque - ' + projeto
      });
    } catch(e) {
      emailErro = e.message || String(e);
    }
  }

  return {
    mensagem: criados.length + ' pedido(s) criado(s) com sucesso.',
    pedidos: criados,
    emailEnviado: !!email && !emailErro,
    emailErro: emailErro
  };
}

function salvarPedidoEstoque(payload) {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var shPed   = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var shPedIt = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido']);
  if (!shPed)   throw new Error('Aba "Pedidos" não encontrada.');
  if (!shPedIt) throw new Error('Aba "Pedidos_Itens" não encontrada.');

  var dataVal = payload.data ? new Date(payload.data + 'T12:00:00') : new Date();
  var user    = Session.getActiveUser().getEmail();
  var idPedido;

  if (payload.rowIndex) {
    // ── Edição ──────────────────────────────────────────────────────────
    var row  = parseInt(payload.rowIndex);
    idPedido = String(shPed.getRange(row, 1).getValue()).trim();
    shPed.getRange(row, 2, 1, 7).setValues([[
      payload.numeroPedido, dataVal, payload.projeto,
      payload.laboratorio,  user,    payload.status || 'Pendente',
      payload.observacoes
    ]]);
    // Apaga itens antigos do pedido em Pedido_Itens
    var lastR = shPedIt.getLastRow();
    if (lastR > 1) {
      var ex = shPedIt.getRange(2, 1, lastR-1, 1).getValues();
      var toDel = [];
      for (var k = 0; k < ex.length; k++)
        if (String(ex[k][0]).trim() === idPedido) toDel.push(k+2);
      for (var d = toDel.length-1; d >= 0; d--) shPedIt.deleteRow(toDel[d]);
    }
  } else {
    // ── Novo pedido ──────────────────────────────────────────────────────
    var seq  = shPed.getLastRow();
    idPedido = 'PED-' + ('0000' + seq).slice(-4);
    shPed.appendRow([
      idPedido, payload.numeroPedido, dataVal, payload.projeto,
      payload.laboratorio, user, 'Pendente', payload.observacoes
    ]);
  }

  // Grava itens em Pedido_Itens
  var itens = payload.itens || [];
  if (itens.length > 0) {
    var novas = itens.map(function(it) {
      return [
        idPedido,             // A ID_Pedido
        payload.numeroPedido, // B N° do pedido
        payload.projeto,      // C Projeto
        it.descricao,         // D Descrição do item
        it.tipo,              // E Tipo de item
        it.idItem,            // F ID_Item
        it.qtdSolicitada,     // G Quantidade solicitada
        0,                    // H Quantidade recebida
        'Pendente',           // I Status
        ''                    // J ID_Mov_Estoque
      ];
    });
    shPedIt.getRange(shPedIt.getLastRow()+1, 1, novas.length, 10).setValues(novas);
  }

  return (payload.rowIndex ? 'Pedido atualizado' : 'Pedido cadastrado') + ' com sucesso!';
}

// ───────────────────────────────────────────────────────

function excluirPedidoEstoque(rowIndex, idPedido) {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var shPed   = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var shPedIt = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido']);
  if (!shPed) throw new Error('Aba "Pedidos" não encontrada.');

  // 1. Exclui os itens relacionados em Pedido_Itens
  if (shPedIt && String(idPedido||'').trim()) {
    var lastR = shPedIt.getLastRow();
    if (lastR > 1) {
      var ex = shPedIt.getRange(2, 1, lastR-1, 1).getValues();
      var toDel = [];
      for (var k = 0; k < ex.length; k++)
        if (String(ex[k][0]).trim() === String(idPedido).trim()) toDel.push(k+2);
      for (var d = toDel.length-1; d >= 0; d--) shPedIt.deleteRow(toDel[d]);
    }
  }

  // 2. Exclui a linha do pedido
  var row = parseInt(rowIndex);
  if (isNaN(row) || row < 2) throw new Error('Linha inválida: ' + rowIndex);
  shPed.deleteRow(row);
  return 'Pedido excluído com sucesso.';
}

// ══════════════════════════════════════════════════════
//  RECEBIMENTO DE PEDIDO — atualiza Itens + Pedidos
// ══════════════════════════════════════════════════════
function receberPedidoEstoqueLegacy_(dados) {
  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var shItens    = ss.getSheetByName('Itens');
  var shPedidos  = ss.getSheetByName('Cadastro de Pedidos');
  var shPedItens = ss.getSheetByName('Recebimento de Pedidos'); // aba de itens do pedido
  var shMovim    = ss.getSheetByName('Entrada/Saída de Itens');
  var tz         = Session.getScriptTimeZone();
  var agora      = new Date();
  var userEmail  = '';
  try { userEmail = Session.getActiveUser().getEmail(); } catch(e){}

  if (!shItens)    throw new Error('Aba "Itens" não encontrada.');
  if (!shPedidos)  throw new Error('Aba "Cadastro de Pedidos" não encontrada.');

  var dataReceb  = dados.dataReceb || Utilities.formatDate(agora, tz, 'yyyy-MM-dd');
  var itensRec   = dados.itens || [];   // [{idItem, descricao, qtdRecebida, validade}]

  if (!itensRec.length) throw new Error('Nenhum item para receber.');

  // ── 1. Atualizar Qtde e Validade na aba Itens ────────────────────────────
  // Colunas Itens (linha 1 = cabeçalho):
  // A=ID_Item B=Projeto C=Descricao D=Tipo E=Validade F=Localizacao
  // G=Qtde H=EstoqueMin I=Status J=UltimaAlteracao K=Responsavel
  // L=Qtde_pedida_pendente M=N_Pedido

  var dadosItens = shItens.getDataRange().getValues();
  var colIdItem  = 0; // coluna A (índice 0)
  var colVal     = 4; // E
  var colQtde    = 6; // G
  var colUltAlt  = 9; // J
  var colResp    = 10; // K
  var colQtdPend = 11; // L
  var colNPedido = 12; // M

  itensRec.forEach(function(ir) {
    for (var i = 1; i < dadosItens.length; i++) {
      if (String(dadosItens[i][colIdItem]).trim() === String(ir.idItem).trim()) {
        var linha = i + 1; // linha real na planilha

        // +qtdRecebida
        var qtdAtual = Number(dadosItens[i][colQtde]) || 0;
        shItens.getRange(linha, colQtde + 1).setValue(qtdAtual + Number(ir.qtdRecebida));

        // Validade (se informada)
        if (ir.validade) {
          var pV = ir.validade.split('-');
          if (pV.length === 3) {
            shItens.getRange(linha, colVal + 1).setValue(
              new Date(+pV[0], +pV[1]-1, +pV[2])
            ).setNumberFormat('dd/MM/yyyy');
          }
        }

        // Última alteração
        shItens.getRange(linha, colUltAlt + 1).setValue(agora).setNumberFormat('dd/MM/yyyy HH:mm');
        shItens.getRange(linha, colResp  + 1).setValue(userEmail);

        // Zerar qtd pendente e N° pedido se tudo recebido (opcional — simplificado)
        var qtdPendAtual = Number(dadosItens[i][colQtdPend]) || 0;
        var novaQtdPend  = Math.max(0, qtdPendAtual - Number(ir.qtdRecebida));
        shItens.getRange(linha, colQtdPend + 1).setValue(novaQtdPend);
        if (novaQtdPend === 0) shItens.getRange(linha, colNPedido + 1).setValue('');

        break;
      }
    }
  });

  // ── 2. Registrar movimentação na aba Entrada/Saída (se existir) ──────────
  if (shMovim) {
    itensRec.forEach(function(ir) {
      var pDR = dataReceb.split('-');
      var dtR = pDR.length===3 ? new Date(+pDR[0],+pDR[1]-1,+pDR[2]) : agora;
      shMovim.appendRow([
        Utilities.getUuid().slice(0,8),     // ID mov
        dtR,                                // Data
        'Entrada',                          // Tipo
        ir.idItem,                          // ID_Item
        ir.descricao,                       // Descrição
        Number(ir.qtdRecebida),             // Qtde
        dados.idPedido || '',               // ID Pedido
        dados.observacoes || '',            // Obs
        userEmail                           // Responsável
      ]);
    });
  }

  // ── 3. Atualizar status do pedido na aba Cadastro de Pedidos ─────────────
  // Colunas Pedidos: A=ID_Pedido B=NumeroPedido C=Data D=Projeto E=Lab
  //                  F=Status G=Obs H=Responsavel ...
  // Precisamos determinar se ficou Recebido ou Parcial.
  // Estratégia: todos os itens do pedido → se todos com qtdRecebida >= qtdSolicitada → Recebido, senão Parcial.
  // Como não temos o mapa completo aqui, calculamos pelo rowIndex.

  var rowIdx = parseInt(dados.rowIndex);
  if (!isNaN(rowIdx) && rowIdx >= 1) {
    // Coluna F = status (índice 5, coluna 6)
    // Coluna G = observação (índice 6, coluna 7)
    var colStatusPed = 6; // coluna F (1-based)

    // Checamos os itens do pedido na aba de itens de pedido
    var novoStatus = 'Parcial';
    if (shPedItens) {
      var dadosPedItens = shPedItens.getDataRange().getValues();
      // Colunas esperadas: A=ID_PedidoItem B=ID_Pedido C=ID_Item D=Descricao
      //                    E=Tipo F=QtdSolicitada G=QtdRecebida H=Status
      var colIdPedPI  = 1; // B
      var colQtdSolPI = 5; // F
      var colQtdRecPI = 6; // G
      var colStPI     = 7; // H

      var itensDoPedido = dadosPedItens.filter(function(r, i) {
        return i > 0 && String(r[colIdPedPI]).trim() === String(dados.idPedido).trim();
      });

      // Atualizar qtdRecebida nos itens do pedido
      itensRec.forEach(function(ir) {
        for (var i = 1; i < dadosPedItens.length; i++) {
          if (String(dadosPedItens[i][colIdPedPI]).trim() === String(dados.idPedido).trim()
            && String(dadosPedItens[i][2]).trim() === String(ir.idItem).trim()) {
            var linhaPedIt = i + 1;
            var qtdRecAntes = Number(dadosPedItens[i][colQtdRecPI]) || 0;
            var novaQtdRec  = qtdRecAntes + Number(ir.qtdRecebida);
            shPedItens.getRange(linhaPedIt, colQtdRecPI + 1).setValue(novaQtdRec);
            var qtdSol = Number(dadosPedItens[i][colQtdSolPI]) || 0;
            var stItem = novaQtdRec >= qtdSol ? 'Recebido' : 'Parcial';
            shPedItens.getRange(linhaPedIt, colStPI + 1).setValue(stItem);
            dadosPedItens[i][colQtdRecPI] = novaQtdRec; // atualiza cache
            dadosPedItens[i][colStPI]     = stItem;
            break;
          }
        }
      });

      // Reler itensDoPedido após atualização
      itensDoPedido = dadosPedItens.filter(function(r, i) {
        return i > 0 && String(r[colIdPedPI]).trim() === String(dados.idPedido).trim();
      });

      var todosRec = itensDoPedido.length > 0 && itensDoPedido.every(function(r) {
        return String(r[colStPI]).trim() === 'Recebido';
      });
      novoStatus = todosRec ? 'Recebido' : 'Parcial';
    }

    shPedidos.getRange(rowIdx, colStatusPed).setValue(novoStatus);
  }

  SpreadsheetApp.flush();
  return 'Recebimento registrado com sucesso!';
}

function receberPedidoEstoque(dados) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shCatalogo = getSheetByPossibleNames_(ss, ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);
  var shPedidos = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var shPedItens = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido', 'Recebimento de Pedidos']);
  var shEstoque = getSheetByPossibleNames_(ss, ['Estoque']);
  var shMovim = getSheetByPossibleNames_(ss, ['Movimentações', 'Movimentacoes', 'Entrada/Saída de Itens', 'Entrada/Saida de Itens']);
  var tz = Session.getScriptTimeZone();
  var agora = new Date();
  var userEmail = '';
  try { userEmail = Session.getActiveUser().getEmail(); } catch(e) {}

  if (!shCatalogo) throw new Error('Aba "Itens" não encontrada.');
  if (!shPedidos) throw new Error('Aba "Pedidos" não encontrada.');
  if (!shPedItens) throw new Error('Aba "Pedidos_Itens" não encontrada.');
  if (!shEstoque) {
    shEstoque = ss.insertSheet('Estoque');
    shEstoque.appendRow([
      'ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização',
      'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel',
      'Qtde_pedida_pendente', 'N_Pedido'
    ]);
    shEstoque.setFrozenRows(1);
  }

  var itensRec = dados.itens || [];
  if (!itensRec.length) throw new Error('Nenhum item para receber.');

  var rowPedido = parseInt(dados.rowIndex, 10);
  var numeroPedido = '';
  if (!isNaN(rowPedido) && rowPedido >= 2) {
    numeroPedido = String(shPedidos.getRange(rowPedido, 2).getValue() || '');
  }

  var dataReceb = dados.dataReceb || Utilities.formatDate(agora, tz, 'yyyy-MM-dd');
  var dtReceb = new Date(dataReceb + 'T12:00:00');

  var catalogoRows = shCatalogo.getDataRange().getValues();
  var catalogoMap = {};
  for (var c = 1; c < catalogoRows.length; c++) {
    var cr = catalogoRows[c];
    var idCat = String(cr[0] || '').trim();
    if (!idCat) continue;
    catalogoMap[idCat] = {
      projeto: String(cr[1] || ''),
      descricao: String(cr[2] || ''),
      tipo: String(cr[3] || ''),
      localizacao: String(cr[4] || ''),
      estoqueMin: cr[5] !== '' && cr[5] !== null ? Number(cr[5]) : '',
      status: String(cr[8] || 'Ativo')
    };
  }

  var estoqueRows = shEstoque.getDataRange().getValues();
  itensRec.forEach(function(ir) {
    var idItem = String(ir.idItem || '').trim();
    var qtd = Number(ir.qtdRecebida || 0);
    if (!idItem || qtd <= 0) return;
    var cat = catalogoMap[idItem] || {};
    var validade = ir.validade ? new Date(ir.validade + 'T12:00:00') : '';
    var validadeKey = ir.validade || '';
    var rowEstoque = -1;

    for (var e = 1; e < estoqueRows.length; e++) {
      var er = estoqueRows[e];
      var erVal = '';
      if (er[4]) {
        try { erVal = Utilities.formatDate(new Date(er[4]), tz, 'yyyy-MM-dd'); } catch(ex) { erVal = String(er[4]); }
      }
      if (String(er[0] || '').trim() === idItem && erVal === validadeKey && String(er[12] || '') === numeroPedido) {
        rowEstoque = e + 1;
        break;
      }
    }

    if (rowEstoque > 0) {
      var qtdAtual = Number(shEstoque.getRange(rowEstoque, 7).getValue()) || 0;
      shEstoque.getRange(rowEstoque, 7).setValue(qtdAtual + qtd);
      shEstoque.getRange(rowEstoque, 10).setValue(agora).setNumberFormat('dd/MM/yyyy HH:mm');
      shEstoque.getRange(rowEstoque, 11).setValue(userEmail);
    } else {
      shEstoque.appendRow([
        idItem, cat.projeto || '', ir.descricao || cat.descricao || '', cat.tipo || '',
        validade, cat.localizacao || '', qtd, cat.estoqueMin, 'OK', agora, userEmail, '', numeroPedido
      ]);
      var lr = shEstoque.getLastRow();
      if (validade) shEstoque.getRange(lr, 5).setNumberFormat('dd/MM/yyyy');
      shEstoque.getRange(lr, 10).setNumberFormat('dd/MM/yyyy HH:mm');
    }

    if (shMovim) {
      shMovim.appendRow([
        Utilities.getUuid().slice(0, 8), dtReceb, 'Entrada - Pedido', idItem,
        ir.descricao || cat.descricao || '', cat.tipo || '', cat.projeto || '', qtd,
        validade, cat.localizacao || '', '', '', '', '', userEmail, dados.idPedido || '', dados.observacoes || ''
      ]);
    }
  });

  var pedItensRows = shPedItens.getDataRange().getValues();
  itensRec.forEach(function(ir) {
    var idItem = String(ir.idItem || '').trim();
    var qtdRec = Number(ir.qtdRecebida || 0);
    if (!idItem || qtdRec <= 0) return;
    for (var p = 1; p < pedItensRows.length; p++) {
      var r = pedItensRows[p];
      var idPedidoA = String(r[0] || '').trim();
      var idPedidoB = String(r[1] || '').trim();
      var itemF = String(r[5] || '').trim();
      var itemC = String(r[2] || '').trim();
      var schemaAtual = idPedidoA === String(dados.idPedido || '').trim();
      var schemaLegado = idPedidoB === String(dados.idPedido || '').trim();
      if ((schemaAtual && itemF === idItem) || (schemaLegado && itemC === idItem)) {
        var rowPI = p + 1;
        var colQtdSol = schemaAtual ? 7 : 6;
        var colQtdRec = schemaAtual ? 8 : 7;
        var colStatus = schemaAtual ? 9 : 8;
        var qtdAntes = Number(shPedItens.getRange(rowPI, colQtdRec).getValue()) || 0;
        var novaQtd = qtdAntes + qtdRec;
        var qtdSol = Number(shPedItens.getRange(rowPI, colQtdSol).getValue()) || 0;
        shPedItens.getRange(rowPI, colQtdRec).setValue(novaQtd);
        shPedItens.getRange(rowPI, colStatus).setValue(novaQtd >= qtdSol ? 'Recebido' : 'Parcial');
        break;
      }
    }
  });

  if (!isNaN(rowPedido) && rowPedido >= 2) {
    var allRows = shPedItens.getDataRange().getValues();
    var rowsPedido = allRows.filter(function(r, idx) {
      if (idx === 0) return false;
      return String(r[0] || '').trim() === String(dados.idPedido || '').trim()
          || String(r[1] || '').trim() === String(dados.idPedido || '').trim();
    });
    var todosRecebidos = rowsPedido.length > 0 && rowsPedido.every(function(r) {
      var stAtual = String(r[8] || '').trim();
      var stLegado = String(r[7] || '').trim();
      return stAtual === 'Recebido' || stLegado === 'Recebido';
    });
    shPedidos.getRange(rowPedido, 7).setValue(todosRecebidos ? 'Recebido' : 'Parcial');
  }

  SpreadsheetApp.flush();
  return 'Recebimento registrado com sucesso!';
}

// ===================== ESTOQUE - Movimentações =====================

function getMovimentacoesSheet_(ss) {
  var sh = getSheetByPossibleNames_(ss, ['Movimentações', 'Movimentacoes', 'Entrada/Saída de Itens', 'Entrada/Saida de Itens']);
  if (!sh) {
    sh = ss.insertSheet('Movimentações');
    sh.appendRow([
      'ID_Mov', 'Data/hora', 'Tipo de movimento', 'ID_Item', 'Descrição',
      'Tipo de item', 'Projeto', 'Qtde.', 'Validade', 'Localização', 'Lote',
      'ID_Participante', 'Participante', 'ID_Visita', 'Responsável',
      'Origem', 'Observação'
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getMovimentacoesEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = getMovimentacoesSheet_(ss);
  var tz = Session.getScriptTimeZone();
  var movs = [];

  function fmtDateTime(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm');
    } catch(e) { return String(v); }
  }

  function fmtDate(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    } catch(e) { return String(v); }
  }

  if (shMov && shMov.getLastRow() > 1) {
    var data = shMov.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!String(r[0] || r[2] || r[4] || '').trim()) continue;
      var schemaAtual = r.length >= 17 && (
        String(data[0][5] || '').toLowerCase().indexOf('tipo') >= 0 ||
        String(r[5] || '').toLowerCase().indexOf('kit') >= 0 ||
        String(r[5] || '').toLowerCase().indexOf('bulk') >= 0
      );
      movs.push({
        idMov: String(r[0] || ''),
        dataHora: fmtDateTime(r[1]),
        tipoMovimento: String(r[2] || ''),
        idItem: String(r[3] || ''),
        descricao: String(r[4] || ''),
        tipoItem: schemaAtual ? String(r[5] || '') : '',
        projeto: schemaAtual ? String(r[6] || '') : '',
        qtde: schemaAtual ? (r[7] !== '' && r[7] !== null ? Number(r[7]) : '') : (r[5] !== '' && r[5] !== null ? Number(r[5]) : ''),
        validade: schemaAtual ? fmtDate(r[8]) : '',
        localizacao: schemaAtual ? String(r[9] || '') : '',
        lote: schemaAtual ? String(r[10] || '') : '',
        idParticipante: schemaAtual ? String(r[11] || '') : '',
        participante: schemaAtual ? String(r[12] || '') : '',
        idVisita: schemaAtual ? String(r[13] || '') : '',
        responsavel: schemaAtual ? String(r[14] || '') : String(r[8] || ''),
        origem: schemaAtual ? String(r[15] || '') : String(r[6] || ''),
        observacao: schemaAtual ? String(r[16] || '') : String(r[7] || '')
      });
    }
  }

  movs.reverse();
  return { movimentacoes: movs, estoque: getEstoque() };
}

function registrarMovimentacaoEstoque(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shEstoque = getSheetByPossibleNames_(ss, ['Estoque']);
  if (!shEstoque) throw new Error('Aba "Estoque" não encontrada.');
  var shMov = getMovimentacoesSheet_(ss);
  var tz = Session.getScriptTimeZone();
  var agora = new Date();
  var userEmail = '';
  try { userEmail = Session.getActiveUser().getEmail(); } catch(e) {}

  var idItem = String(payload.idItem || '').trim();
  var qtd = Number(payload.qtde || 0);
  if (!idItem) throw new Error('Selecione um item.');
  if (qtd <= 0) throw new Error('Informe uma quantidade válida.');

  var tipoMov = String(payload.tipoMovimento || 'Saída - Ajuste/Descarte');
  var isEntrada = tipoMov.toLowerCase().indexOf('entrada') === 0;
  var dataBase = payload.data ? new Date(payload.data + 'T12:00:00') : agora;
  var validadeKey = String(payload.validade || '').trim();
  var locKey = String(payload.localizacao || '').trim();
  var rows = shEstoque.getDataRange().getValues();
  var rowEstoque = -1;

  function estoqueValKey(v) {
    if (!v) return '';
    try { return Utilities.formatDate(new Date(v), tz, 'dd/MM/yyyy'); } catch(e) { return String(v); }
  }

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[0] || '').trim() !== idItem) continue;
    var sameValidade = !validadeKey || estoqueValKey(r[4]) === validadeKey;
    var sameLocal = !locKey || String(r[5] || '').trim() === locKey;
    if (sameValidade && sameLocal) {
      rowEstoque = i + 1;
      break;
    }
  }
  if (rowEstoque < 2) throw new Error('Item/lote não encontrado no estoque.');

  var qtdAtual = Number(shEstoque.getRange(rowEstoque, 7).getValue()) || 0;
  var novaQtd = isEntrada ? qtdAtual + qtd : qtdAtual - qtd;
  if (novaQtd < 0) throw new Error('Quantidade maior que o saldo disponível.');
  shEstoque.getRange(rowEstoque, 7).setValue(novaQtd);
  shEstoque.getRange(rowEstoque, 10).setValue(agora).setNumberFormat('dd/MM/yyyy HH:mm');
  shEstoque.getRange(rowEstoque, 11).setValue(userEmail);

  var er = shEstoque.getRange(rowEstoque, 1, 1, Math.max(shEstoque.getLastColumn(), 13)).getValues()[0];
  shMov.appendRow([
    Utilities.getUuid().slice(0, 8), dataBase, tipoMov, idItem,
    payload.descricao || er[2] || '', payload.tipoItem || er[3] || '',
    payload.projeto || er[1] || '', qtd, er[4] || '',
    payload.localizacao || er[5] || '', payload.lote || '', '',
    payload.participante || '', payload.idVisita || '', userEmail,
    payload.origem || 'Movimentação manual', payload.observacao || ''
  ]);
  var lr = shMov.getLastRow();
  shMov.getRange(lr, 2).setNumberFormat('dd/MM/yyyy HH:mm');
  if (er[4]) shMov.getRange(lr, 9).setNumberFormat('dd/MM/yyyy');
  SpreadsheetApp.flush();
  return 'Movimentação registrada com sucesso.';
}

function baixarKitsAgendaEvento(payload) {
  payload = payload || {};
  var agendaId = String(payload.agendaId || '').trim();
  var kits = payload.kits || [];
  if (!agendaId) throw new Error('Agendamento nao informado.');
  if (!kits.length) throw new Error('Nenhum kit selecionado para baixa.');

  var origemBase = 'Agenda kit ' + agendaId;
  var jaBaixados = {};
  getKitsAgendaBaixaStatus(agendaId).ids.forEach(function(id) { jaBaixados[id] = true; });

  var baixados = 0;
  var pulados = 0;
  kits.forEach(function(kit) {
    var ids = String(kit.idItem || '').split(',').map(function(x) { return x.trim(); }).filter(Boolean);
    if (!ids.length) return;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (jaBaixados[id]) {
        pulados++;
        return;
      }
      try {
        registrarMovimentacaoEstoque({
          idItem: id,
          qtde: 1,
          tipoMovimento: 'Saida - Visita',
          projeto: payload.projeto || '',
          participante: payload.participante || '',
          idVisita: payload.visita || agendaId,
          data: payload.data || '',
          origem: origemBase,
          observacao: 'Baixa de kit selecionado na Agenda: ' + String(kit.label || id)
        });
        jaBaixados[id] = true;
        baixados++;
        return;
      } catch(e) {
        if (i === ids.length - 1) throw e;
      }
    }
  });
  return {
    ok: true,
    baixados: baixados,
    pulados: pulados,
    msg: baixados + ' kit(s) baixado(s)' + (pulados ? ' e ' + pulados + ' ja registrado(s).' : '.')
  };
}

function getKitsAgendaBaixaStatus(agendaId) {
  agendaId = String(agendaId || '').trim();
  if (!agendaId) return { baixados: false, ids: [] };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = getMovimentacoesSheet_(ss);
  var saldo = {};
  var origemBase = 'Agenda kit ' + agendaId;
  var origemDev = 'Agenda kit devolucao ' + agendaId;
  if (shMov.getLastRow() > 1) {
    var vals = shMov.getRange(2, 1, shMov.getLastRow() - 1, Math.max(17, shMov.getLastColumn())).getValues();
    vals.forEach(function(r) {
      var idItem = String(r[3] || '').trim();
      var origem = String(r[15] || '').trim();
      if (!idItem) return;
      if (origem.indexOf(origemBase) === 0) saldo[idItem] = (saldo[idItem] || 0) + Number(r[7] || 0);
      if (origem.indexOf(origemDev) === 0) saldo[idItem] = (saldo[idItem] || 0) - Number(r[7] || 0);
    });
  }
  var ids = Object.keys(saldo).filter(function(id) { return saldo[id] > 0; });
  return { baixados: ids.length > 0, ids: ids };
}

function devolverKitsAgendaEvento(payload) {
  payload = payload || {};
  var agendaId = String(payload.agendaId || '').trim();
  if (!agendaId) throw new Error('Agendamento nao informado.');
  var status = getKitsAgendaBaixaStatus(agendaId);
  if (!status.baixados) throw new Error('Nao ha kits baixados para devolver.');
  var origemDev = 'Agenda kit devolucao ' + agendaId;
  var devolvidos = 0;
  status.ids.forEach(function(id) {
    registrarMovimentacaoEstoque({
      idItem: id,
      qtde: 1,
      tipoMovimento: 'Entrada - Devolucao de kit da Agenda',
      projeto: payload.projeto || '',
      participante: payload.participante || '',
      idVisita: payload.visita || agendaId,
      data: payload.data || '',
      origem: origemDev,
      observacao: 'Devolucao de kit baixado pela Agenda'
    });
    devolvidos++;
  });
  return { ok: true, devolvidos: devolvidos, msg: devolvidos + ' kit(s) devolvido(s) ao estoque.' };
}

function getDescartesEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shDesc = getSheetByPossibleNames_(ss, ['Descartes_Estoque']);
  var shItens = getSheetByPossibleNames_(ss, ['Descartes_Itens']);
  var tz = Session.getScriptTimeZone();
  function fmtDate(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    } catch(e) { return String(v); }
  }
  var descartes = [];
  if (shDesc && shDesc.getLastRow() > 1) {
    shDesc.getRange(2, 1, shDesc.getLastRow() - 1, Math.max(9, shDesc.getLastColumn())).getValues().forEach(function(r, idx) {
      if (!r[0]) return;
      descartes.push({
        rowIndex: idx + 2, idDescarte: String(r[0] || ''), data: fmtDate(r[1]),
        projeto: String(r[2] || ''), solicitante: String(r[3] || ''),
        email: String(r[4] || ''), status: String(r[5] || ''),
        responsavel: String(r[6] || ''), observacoes: String(r[7] || ''),
        dataEfetivacao: fmtDate(r[8])
      });
    });
  }
  var itensMap = {};
  if (shItens && shItens.getLastRow() > 1) {
    shItens.getRange(2, 1, shItens.getLastRow() - 1, Math.max(10, shItens.getLastColumn())).getValues().forEach(function(r, idx) {
      var id = String(r[0] || '');
      if (!id) return;
      if (!itensMap[id]) itensMap[id] = [];
      itensMap[id].push({
        rowIndex: idx + 2, idDescarte: id, idItem: String(r[1] || ''),
        descricao: String(r[2] || ''), tipo: String(r[3] || ''),
        validade: fmtDate(r[4]), localizacao: String(r[5] || ''),
        qtdDescartar: Number(r[6] || 0), qtdDescartada: Number(r[7] || 0),
        status: String(r[8] || ''), motivo: String(r[9] || '')
      });
    });
  }
  return { descartes: descartes, itensMap: itensMap, estoque: getEstoque() || [], solicitantes: getSolicitantes() || [] };
}

function salvarPlanejamentoDescarteEstoque(payload) {
  payload = payload || {};
  var projeto = String(payload.projeto || '').trim();
  var itens = (payload.itens || []).filter(function(it) { return Number(it.qtdDescartar || 0) > 0; });
  if (!projeto) throw new Error('Selecione um projeto.');
  if (!itens.length) throw new Error('Informe pelo menos um item para descarte.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shDesc = getSheetByPossibleNames_(ss, ['Descartes_Estoque']);
  var shItens = getSheetByPossibleNames_(ss, ['Descartes_Itens']);
  if (!shDesc) throw new Error('Aba "Descartes_Estoque" nao encontrada.');
  if (!shItens) throw new Error('Aba "Descartes_Itens" nao encontrada.');
  var userEmail = '';
  try { userEmail = Session.getActiveUser().getEmail(); } catch(e) {}
  var dataVal = payload.data ? new Date(payload.data + 'T12:00:00') : new Date();
  var id = 'DESC-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  shDesc.appendRow([id, dataVal, projeto, payload.solicitante || '', payload.email || '', 'Em planejamento', userEmail, payload.observacoes || '', '']);
  shDesc.getRange(shDesc.getLastRow(), 2).setNumberFormat('dd/MM/yyyy');
  var rows = itens.map(function(it) {
    return [id, it.idItem || '', it.descricao || '', it.tipo || '', parseDateBrOrBlank_(it.validade), it.localizacao || '', Number(it.qtdDescartar || 0), 0, 'Em planejamento', it.motivo || payload.observacoes || ''];
  });
  var start = shItens.getLastRow() + 1;
  shItens.getRange(start, 1, rows.length, 10).setValues(rows);
  rows.forEach(function(r, i) { if (r[4]) shItens.getRange(start + i, 5).setNumberFormat('dd/MM/yyyy'); });
  return 'Lista de descarte criada: ' + id;
}

function efetivarDescarteEstoque(idDescarte) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shDesc = getSheetByPossibleNames_(ss, ['Descartes_Estoque']);
  var shItens = getSheetByPossibleNames_(ss, ['Descartes_Itens']);
  if (!shDesc || !shItens) throw new Error('Abas de descarte nao encontradas.');
  var id = String(idDescarte || '').trim();
  if (!id) throw new Error('Informe a lista de descarte.');
  var rowDesc = -1;
  var descRows = shDesc.getRange(2, 1, Math.max(shDesc.getLastRow() - 1, 0), Math.max(9, shDesc.getLastColumn())).getValues();
  for (var i = 0; i < descRows.length; i++) {
    if (String(descRows[i][0] || '') === id) { rowDesc = i + 2; break; }
  }
  if (rowDesc < 2) throw new Error('Lista de descarte nao encontrada.');
  if (normText_(shDesc.getRange(rowDesc, 6).getValue()).indexOf('efetivado') >= 0) return 'Descarte ja estava efetivado.';
  var projeto = String(shDesc.getRange(rowDesc, 3).getValue() || '');
  var obs = String(shDesc.getRange(rowDesc, 8).getValue() || '');
  var itemRows = shItens.getRange(2, 1, Math.max(shItens.getLastRow() - 1, 0), Math.max(10, shItens.getLastColumn())).getValues();
  var atualizados = 0;
  itemRows.forEach(function(r, idx) {
    if (String(r[0] || '') !== id) return;
    var row = idx + 2;
    var qtd = Number(r[6] || 0);
    if (qtd <= 0) return;
    registrarMovimentacaoEstoque({
      tipoMovimento: 'Sa\u00edda - Ajuste/Descarte',
      idItem: String(r[1] || ''), descricao: String(r[2] || ''),
      tipoItem: String(r[3] || ''), projeto: projeto, qtde: qtd,
      validade: formatarDataSafe(r[4]), localizacao: String(r[5] || ''),
      origem: 'Lista de descarte ' + id, observacao: obs || 'Descarte efetivado'
    });
    shItens.getRange(row, 8).setValue(qtd);
    shItens.getRange(row, 9).setValue('Efetivado');
    atualizados++;
  });
  shDesc.getRange(rowDesc, 6).setValue('Efetivado');
  shDesc.getRange(rowDesc, 9).setValue(new Date()).setNumberFormat('dd/MM/yyyy');
  return 'Descarte efetivado: ' + atualizados + ' item(ns).';
}

function parseDateBrOrBlank_(valor) {
  if (!valor) return '';
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor;
  var s = String(valor || '').trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : d;
}

// Overrides com strings Unicode estáveis para evitar falhas por encoding ao localizar a aba.
function getMovimentacoesSheet_(ss) {
  var sh = getSheetByPossibleNames_(ss, ['Movimenta\u00e7\u00f5es', 'Movimentacoes', 'Entrada/Sa\u00edda de Itens', 'Entrada/Saida de Itens']);
  if (!sh) {
    sh = ss.insertSheet('Movimenta\u00e7\u00f5es');
    sh.appendRow([
      'ID_Mov', 'Data/hora', 'Tipo de movimento', 'ID_Item', 'Descri\u00e7\u00e3o',
      'Tipo de item', 'Projeto', 'Qtde.', 'Validade', 'Localiza\u00e7\u00e3o', 'Lote',
      'ID_Participante', 'Participante', 'ID_Visita', 'Respons\u00e1vel',
      'Origem', 'Observa\u00e7\u00e3o'
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getMovimentacoesEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = getMovimentacoesSheet_(ss);
  var tz = Session.getScriptTimeZone();
  var movs = [];

  function fmtDateTime(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm');
    } catch(e) { return String(v); }
  }

  function fmtDate(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    } catch(e) { return String(v); }
  }

  if (shMov && shMov.getLastRow() > 1) {
    var data = shMov.getDataRange().getValues();
    var schemaAtual = shMov.getLastColumn() >= 17;
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      if (!String(r[0] || r[2] || r[4] || '').trim()) continue;
      movs.push({
        idMov: String(r[0] || ''),
        dataHora: fmtDateTime(r[1]),
        tipoMovimento: String(r[2] || ''),
        idItem: String(r[3] || ''),
        descricao: String(r[4] || ''),
        tipoItem: schemaAtual ? String(r[5] || '') : '',
        projeto: schemaAtual ? String(r[6] || '') : '',
        qtde: schemaAtual ? (r[7] !== '' && r[7] !== null ? Number(r[7]) : '') : (r[5] !== '' && r[5] !== null ? Number(r[5]) : ''),
        validade: schemaAtual ? fmtDate(r[8]) : '',
        localizacao: schemaAtual ? String(r[9] || '') : '',
        lote: schemaAtual ? String(r[10] || '') : '',
        idParticipante: schemaAtual ? String(r[11] || '') : '',
        participante: schemaAtual ? String(r[12] || '') : '',
        idVisita: schemaAtual ? String(r[13] || '') : '',
        responsavel: schemaAtual ? String(r[14] || '') : String(r[8] || ''),
        origem: schemaAtual ? String(r[15] || '') : String(r[6] || ''),
        observacao: schemaAtual ? String(r[16] || '') : String(r[7] || '')
      });
    }
  }

  movs.reverse();
  var itensData = getItensEstoque();
  return {
    movimentacoes: movs,
    estoque: getEstoque(),
    projetos: itensData.projetos || [],
    itensCatalogo: itensData.itens || []
  };
}

function normalizeHeaderV2_(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '').trim();
}

function findMovimentacoesSheetV2_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = normalizeHeaderV2_(sheets[i].getName());
    if (name === 'movimentacoes' || name === 'entradasaidadeitens') return sheets[i];
  }
  return null;
}

function getMovimentacoesEstoqueV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = findMovimentacoesSheetV2_(ss);
  var tz = Session.getScriptTimeZone();
  var movs = [];
  var diag = { sheet: shMov ? shMov.getName() : '', lastRow: shMov ? shMov.getLastRow() : 0, lastColumn: shMov ? shMov.getLastColumn() : 0, headerRow: 0 };

  function fmtDateTime(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm');
    } catch(e) { return String(v); }
  }

  function fmtDate(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    } catch(e) { return String(v); }
  }

  function valueAt(row, idx) {
    return idx >= 0 && idx < row.length ? row[idx] : '';
  }

  if (shMov && shMov.getLastRow() > 0) {
    var data = shMov.getDataRange().getValues();
    var headerIndex = -1;
    var col = {};
    for (var h = 0; h < data.length; h++) {
      var map = {};
      for (var c = 0; c < data[h].length; c++) {
        var key = normalizeHeaderV2_(data[h][c]);
        if (key) map[key] = c;
      }
      if (map.idmov !== undefined && (map.datahora !== undefined || map.tipodemovimento !== undefined || map.descricao !== undefined)) {
        headerIndex = h;
        col = map;
        break;
      }
    }
    if (headerIndex < 0) {
      headerIndex = 2;
      col = { idmov: 0, datahora: 1, tipodemovimento: 2, iditem: 3, descricao: 4, tipodeitem: 5, projeto: 6, qtde: 7, validade: 8, localizacao: 9, lote: 10, idparticipante: 11, participante: 12, idvisita: 13, responsavel: 14, origem: 15, observacao: 16 };
    }
    diag.headerRow = headerIndex + 1;
    for (var rIdx = headerIndex + 1; rIdx < data.length; rIdx++) {
      var r = data[rIdx];
      var idMov = valueAt(r, col.idmov);
      var tipoMov = valueAt(r, col.tipodemovimento);
      var desc = valueAt(r, col.descricao);
      var dataHora = valueAt(r, col.datahora);
      if (!String(idMov || tipoMov || desc || dataHora || '').trim()) continue;
      movs.push({
        idMov: String(idMov || ''),
        dataHora: fmtDateTime(dataHora),
        tipoMovimento: String(tipoMov || ''),
        idItem: String(valueAt(r, col.iditem) || ''),
        descricao: String(desc || ''),
        tipoItem: String(valueAt(r, col.tipodeitem) || ''),
        projeto: String(valueAt(r, col.projeto) || ''),
        qtde: valueAt(r, col.qtde) !== '' && valueAt(r, col.qtde) !== null ? Number(valueAt(r, col.qtde)) : '',
        validade: fmtDate(valueAt(r, col.validade)),
        localizacao: String(valueAt(r, col.localizacao) || ''),
        lote: String(valueAt(r, col.lote) || ''),
        idParticipante: String(valueAt(r, col.idparticipante) || ''),
        participante: String(valueAt(r, col.participante) || ''),
        idVisita: String(valueAt(r, col.idvisita) || ''),
        responsavel: String(valueAt(r, col.responsavel) || ''),
        origem: String(valueAt(r, col.origem) || ''),
        observacao: String(valueAt(r, col.observacao) || '')
      });
    }
  }
  movs.reverse();
  var itensData = getItensEstoque();
  return {
    movimentacoes: movs,
    estoque: getEstoque(),
    projetos: itensData.projetos || [],
    itensCatalogo: itensData.itens || [],
    participantes: getParticipantes(),
    diag: diag
  };
}

function getMovimentacoesEstoqueV3() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = ss.getSheetByName('Movimenta\u00e7\u00f5es') || ss.getSheetByName('Movimentacoes');
  var tz = Session.getScriptTimeZone();
  var movs = [];
  var diag = { sheet: shMov ? shMov.getName() : '', lastRow: shMov ? shMov.getLastRow() : 0, lastColumn: shMov ? shMov.getLastColumn() : 0, headerRow: 3 };

  function fmtDateTime(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm');
    } catch(e) { return String(v); }
  }

  function fmtDate(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    } catch(e) { return String(v); }
  }

  if (shMov && shMov.getLastRow() >= 4) {
    var rows = shMov.getRange(4, 1, shMov.getLastRow() - 3, 17).getValues();
    rows.forEach(function(r) {
      if (!String(r[0] || r[2] || r[4] || '').trim()) return;
      movs.push({
        idMov: String(r[0] || ''),
        dataHora: fmtDateTime(r[1]),
        tipoMovimento: String(r[2] || ''),
        idItem: String(r[3] || ''),
        descricao: String(r[4] || ''),
        tipoItem: String(r[5] || ''),
        projeto: String(r[6] || ''),
        qtde: r[7] !== '' && r[7] !== null ? Number(r[7]) : '',
        validade: fmtDate(r[8]),
        localizacao: String(r[9] || ''),
        lote: String(r[10] || ''),
        idParticipante: String(r[11] || ''),
        participante: String(r[12] || ''),
        idVisita: String(r[13] || ''),
        responsavel: String(r[14] || ''),
        origem: String(r[15] || ''),
        observacao: String(r[16] || '')
      });
    });
  }

  movs.reverse();
  var itensData = getItensEstoque();
  return {
    movimentacoes: movs,
    estoque: getEstoque(),
    projetos: itensData.projetos || [],
    itensCatalogo: itensData.itens || [],
    participantes: getParticipantes(),
    diag: diag
  };
}

// ===================== ESTOQUE - Visualização =====================
function getEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Estoque");
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues();
  var tz = Session.getScriptTimeZone();

  var itens = data
    .filter(function(r) { return r[0] || r[2]; }) // ignora linhas totalmente vazias
    .map(function(r) {
      function fmtDate(v) {
        if (!v) return '';
        try {
          var d = v instanceof Date ? v : new Date(v);
          if (isNaN(d.getTime())) return String(v);
          return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
        } catch(e) { return String(v); }
      }
      return {
        idItem:           String(r[0]  || ''),
        projeto:          String(r[1]  || ''),
        descricao:        String(r[2]  || ''),
        tipoItem:         String(r[3]  || ''),
        validade:         fmtDate(r[4]),
        localizacao:      String(r[5]  || ''),
        qtde:             r[6]  !== '' && r[6]  !== null ? Number(r[6])  : '',
        estoqueMinimo:    r[7]  !== '' && r[7]  !== null ? Number(r[7])  : '',
        status:           String(r[8]  || ''),
        ultimaAlteracao:  fmtDate(r[9]),
        responsavel:      String(r[10] || ''),
        qtdePedidaPendente: r[11] !== '' && r[11] !== null ? Number(r[11]) : '',
        numeroPedido:     String(r[12] || '')
      };
    });

  return agruparEstoquePorItemValidade_(itens);
}

function agruparEstoquePorItemValidade_(itens) {
  var mapa = {};
  function norm(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  function pushUnique(list, value) {
    value = String(value || '').trim();
    if (!value) return;
    value.split(/\s*,\s*/).forEach(function(v) {
      v = String(v || '').trim();
      if (v && list.indexOf(v) < 0) list.push(v);
    });
  }

  itens.forEach(function(it) {
    var key = [
      norm(it.projeto),
      norm(it.descricao),
      norm(it.tipoItem),
      norm(it.validade),
      norm(it.localizacao),
      norm(it.status)
    ].join('||');

    if (!mapa[key]) {
      mapa[key] = {
        item: Object.assign({}, it),
        ids: [],
        pedidos: [],
        responsaveis: []
      };
      mapa[key].item.qtde = 0;
      mapa[key].item.qtdePedidaPendente = 0;
    }

    var g = mapa[key];
    g.item.qtde += Number(it.qtde || 0) || 0;
    g.item.qtdePedidaPendente += Number(it.qtdePedidaPendente || 0) || 0;
    if ((Number(it.estoqueMinimo || 0) || 0) > (Number(g.item.estoqueMinimo || 0) || 0)) {
      g.item.estoqueMinimo = it.estoqueMinimo;
    }
    if (String(it.ultimaAlteracao || '') > String(g.item.ultimaAlteracao || '')) {
      g.item.ultimaAlteracao = it.ultimaAlteracao;
    }
    pushUnique(g.ids, it.idItem);
    pushUnique(g.pedidos, it.numeroPedido);
    pushUnique(g.responsaveis, it.responsavel);
  });

  return Object.keys(mapa).map(function(key) {
    var g = mapa[key];
    g.item.idItem = g.ids.join(', ');
    g.item.numeroPedido = g.pedidos.join(', ');
    g.item.responsavel = g.responsaveis.join(', ');
    return g.item;
  });
}

// Override final: detecta a tabela real da aba Movimentações mesmo com título/filtros acima.
function getMovimentacoesSheet_(ss) {
  var wanted = ['movimentacoes', 'entradasaidadeitens'];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var normName = normalizeHeader_(sheets[i].getName());
    if (wanted.indexOf(normName) >= 0) return sheets[i];
  }
  var sh = ss.insertSheet('Movimenta\u00e7\u00f5es');
  sh.appendRow([
    'ID_Mov', 'Data/hora', 'Tipo de movimento', 'ID_Item', 'Descri\u00e7\u00e3o',
    'Tipo de item', 'Projeto', 'Qtde.', 'Validade', 'Localiza\u00e7\u00e3o', 'Lote',
    'ID_Participante', 'Participante', 'ID_Visita', 'Respons\u00e1vel',
    'Origem', 'Observa\u00e7\u00e3o'
  ]);
  sh.setFrozenRows(1);
  return sh;
}

function normalizeHeader_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function getMovimentacoesEstoque() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = getMovimentacoesSheet_(ss);
  var tz = Session.getScriptTimeZone();
  var movs = [];

  function fmtDateTime(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy HH:mm');
    } catch(e) { return String(v); }
  }

  function fmtDate(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    } catch(e) { return String(v); }
  }

  function firstNonEmpty_(row, indexes) {
    for (var i = 0; i < indexes.length; i++) {
      var idx = indexes[i];
      if (idx >= 0 && row[idx] !== '' && row[idx] !== null && row[idx] !== undefined) return row[idx];
    }
    return '';
  }

  if (shMov && shMov.getLastRow() > 0) {
    var data = shMov.getDataRange().getValues();
    var headerIndex = -1;
    var col = {};
    for (var h = 0; h < data.length; h++) {
      var map = {};
      for (var c = 0; c < data[h].length; c++) {
        var key = normalizeHeader_(data[h][c]);
        if (key) map[key] = c;
      }
      if (map.idmov >= 0 && (map.tipodemovimento >= 0 || map.descricao >= 0)) {
        headerIndex = h;
        col = map;
        break;
      }
    }

    if (headerIndex < 0) {
      headerIndex = 0;
      col = {
        idmov: 0, datahora: 1, tipodemovimento: 2, iditem: 3, descricao: 4,
        tipodeitem: 5, projeto: 6, qtde: 7, validade: 8, localizacao: 9,
        lote: 10, idparticipante: 11, participante: 12, idvisita: 13,
        responsavel: 14, origem: 15, observacao: 16
      };
    }

    for (var rIdx = headerIndex + 1; rIdx < data.length; rIdx++) {
      var r = data[rIdx];
      var idMov = firstNonEmpty_(r, [col.idmov, 0]);
      var tipoMov = firstNonEmpty_(r, [col.tipodemovimento, 2]);
      var desc = firstNonEmpty_(r, [col.descricao, 4]);
      if (!String(idMov || tipoMov || desc || '').trim()) continue;

      movs.push({
        idMov: String(idMov || ''),
        dataHora: fmtDateTime(firstNonEmpty_(r, [col.datahora, 1])),
        tipoMovimento: String(tipoMov || ''),
        idItem: String(firstNonEmpty_(r, [col.iditem, 3]) || ''),
        descricao: String(desc || ''),
        tipoItem: String(firstNonEmpty_(r, [col.tipodeitem, 5]) || ''),
        projeto: String(firstNonEmpty_(r, [col.projeto, 6]) || ''),
        qtde: firstNonEmpty_(r, [col.qtde, 7]) !== '' ? Number(firstNonEmpty_(r, [col.qtde, 7])) : '',
        validade: fmtDate(firstNonEmpty_(r, [col.validade, 8])),
        localizacao: String(firstNonEmpty_(r, [col.localizacao, 9]) || ''),
        lote: String(firstNonEmpty_(r, [col.lote, 10]) || ''),
        idParticipante: String(firstNonEmpty_(r, [col.idparticipante, 11]) || ''),
        participante: String(firstNonEmpty_(r, [col.participante, 12]) || ''),
        idVisita: String(firstNonEmpty_(r, [col.idvisita, 13]) || ''),
        responsavel: String(firstNonEmpty_(r, [col.responsavel, 14]) || ''),
        origem: String(firstNonEmpty_(r, [col.origem, 15]) || ''),
        observacao: String(firstNonEmpty_(r, [col.observacao, 16]) || '')
      });
    }
  }

  movs.reverse();
  var itensData = getItensEstoque();
  return {
    movimentacoes: movs,
    estoque: getEstoque(),
    projetos: itensData.projetos || [],
    itensCatalogo: itensData.itens || []
  };
}

// ============================================================================
//  EQUIPAMENTOS FORNECIDOS
// ============================================================================

var EQUIPAMENTOS_HEADERS_ = [
  'ID_Equipamento_Rec', 'Data de recebimento', 'Projeto', 'Cadastro na UCS', 'Registro no RM',
  'N° da Nota Fiscal', 'Remetente', 'N° do Movimento RM', 'Código TOTVS',
  'Descrição do item', 'Quantidade', 'N° de série', 'Responsável pelo recebimento',
  'Localização', 'Observações', 'Data de devolução',
  'Data e hora da criação do registro', 'Responsável pelo registro'
];

function gerarCodigoRegistro_(prefixo) {
  return (prefixo || 'REG') + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase();
}

function getEquipamentosSheet_(ss) {
  var sh = getSheetByPossibleNames_(ss, ['\uD83D\uDDA5\uFE0F Equipamentos', 'Equipamentos']);
  if (!sh) {
    sh = ss.insertSheet('\uD83D\uDDA5\uFE0F Equipamentos');
    sh.appendRow(EQUIPAMENTOS_HEADERS_);
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(EQUIPAMENTOS_HEADERS_);
    sh.setFrozenRows(1);
  }
  return sh;
}

function fmtEquipDate_(v, pattern) {
  if (!v) return '';
  try {
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), pattern || 'dd/MM/yyyy');
  } catch (e) {
    return String(v);
  }
}

function fmtEquipISO_(v) {
  if (!v) return '';
  try {
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (e) {
    return '';
  }
}

function parseEquipDate_(v) {
  if (!v) return '';
  if (v instanceof Date) return v;
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : d;
}

function getProjetosEquipamentos_() {
  var seen = {};
  return (getProjetos() || []).map(function(p) {
    return String(p.nomeAbreviado || p.codigo || p.id || '').trim();
  }).filter(function(nome) {
    if (!nome || seen[nome]) return false;
    seen[nome] = 1;
    return true;
  }).sort();
}

function getSolicitantesEquipamentos_() {
  var seen = {};
  return (getSolicitantes() || []).map(function(s) {
    return String(s.nome || '').trim();
  }).filter(function(nome) {
    if (!nome || seen[nome]) return false;
    seen[nome] = 1;
    return true;
  }).sort();
}

function getEquipamentosFornecidos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getEquipamentosSheet_(ss);
  var equipamentos = [];

  if (sh.getLastRow() > 1) {
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(18, sh.getLastColumn())).getValues();
    data.forEach(function(r, idx) {
      if (!String(r[2] || r[9] || r[11] || '').trim()) return;
      equipamentos.push({
        rowIndex: idx + 2,
        idEquipamentoRec: String(r[0] || ''),
        dataRecebimento: fmtEquipDate_(r[1]),
        dataRecebimentoISO: fmtEquipISO_(r[1]),
        projeto: String(r[2] || ''),
        cadastroUcs: String(r[3] || 'Não'),
        registroRm: String(r[4] || 'Não'),
        notaFiscal: String(r[5] || ''),
        remetente: String(r[6] || ''),
        movimentoRm: String(r[7] || ''),
        codigoTotvs: String(r[8] || ''),
        descricao: String(r[9] || ''),
        quantidade: r[10] !== '' && r[10] !== null ? Number(r[10]) : '',
        numeroSerie: String(r[11] || ''),
        responsavelRecebimento: String(r[12] || ''),
        localizacao: String(r[13] || ''),
        observacoes: String(r[14] || ''),
        dataDevolucao: fmtEquipDate_(r[15]),
        dataDevolucaoISO: fmtEquipISO_(r[15]),
        criadoEm: fmtEquipDate_(r[16], 'dd/MM/yyyy HH:mm'),
        responsavelRegistro: String(r[17] || '')
      });
    });
  }

  return {
    equipamentos: equipamentos.reverse(),
    projetos: getProjetosEquipamentos_(),
    solicitantes: getSolicitantesEquipamentos_(),
    config: getEstoqueConfig()
  };
}

function salvarEquipamentoFornecido(payload) {
  payload = payload || {};
  if (!String(payload.projeto || '').trim()) throw new Error('Selecione um projeto.');
  if (!String(payload.descricao || '').trim()) throw new Error('Informe a descrição do equipamento.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getEquipamentosSheet_(ss);
  var rowIndex = parseInt(payload.rowIndex, 10);
  var usuario = getUsuarioEmail();
  var idRegistro = gerarCodigoRegistro_('EQP');
  var criadoEm = new Date();
  var responsavelRegistro = usuario;

  if (rowIndex && rowIndex >= 2 && rowIndex <= sh.getLastRow()) {
    var existing = sh.getRange(rowIndex, 1, 1, 18).getValues()[0];
    idRegistro = existing[0] || idRegistro;
    criadoEm = existing[16] || criadoEm;
    responsavelRegistro = existing[17] || responsavelRegistro;
  }

  var row = [
    idRegistro,
    parseEquipDate_(payload.dataRecebimento),
    String(payload.projeto || '').trim(),
    String(payload.cadastroUcs || 'Não'),
    String(payload.registroRm || 'Não'),
    String(payload.notaFiscal || '').trim(),
    String(payload.remetente || '').trim(),
    String(payload.movimentoRm || '').trim(),
    String(payload.codigoTotvs || '').trim(),
    String(payload.descricao || '').trim(),
    payload.quantidade !== '' && payload.quantidade !== null && payload.quantidade !== undefined ? Number(payload.quantidade) : '',
    String(payload.numeroSerie || '').trim(),
    String(payload.responsavelRecebimento || '').trim(),
    String(payload.localizacao || '').trim(),
    String(payload.observacoes || '').trim(),
    parseEquipDate_(payload.dataDevolucao),
    criadoEm,
    responsavelRegistro
  ];

  if (rowIndex && rowIndex >= 2 && rowIndex <= sh.getLastRow()) {
    sh.getRange(rowIndex, 1, 1, 18).setValues([row]);
    return 'Equipamento atualizado com sucesso.';
  }

  sh.appendRow(row);
  return 'Equipamento cadastrado com sucesso.';
}

function excluirEquipamentoFornecido(rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getEquipamentosSheet_(ss);
  var row = parseInt(rowIndex, 10);
  if (!row || row < 2 || row > sh.getLastRow()) throw new Error('Registro de equipamento não encontrado.');
  sh.deleteRow(row);
  return 'Equipamento excluído com sucesso.';
}

// ============================================================================
//  MEDICAMENTOS RECEBIDOS
// ============================================================================

var MEDICAMENTOS_HEADERS_ = [
  'ID_Medicamento_Rec', 'Data de recebimento', 'Projeto', 'Registro no RM',
  'N° da Nota Fiscal', 'Remetente', 'N° do Movimento RM', 'Descrição do item',
  'Quantidade', 'Lote', 'Validade', 'Responsável pelo recebimento', 'Localização',
  'Observações', 'Data e hora da criação do registro', 'Responsável pelo registro'
];

function getMedicamentosSheet_(ss) {
  var sh = getSheetByPossibleNames_(ss, ['\uD83D\uDC8A Medicamentos', 'Medicamentos']);
  if (!sh) {
    sh = ss.insertSheet('\uD83D\uDC8A Medicamentos');
    sh.appendRow(MEDICAMENTOS_HEADERS_);
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(MEDICAMENTOS_HEADERS_);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getMedicamentosRecebidos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getMedicamentosSheet_(ss);
  var medicamentos = [];

  if (sh.getLastRow() > 1) {
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(16, sh.getLastColumn())).getValues();
    data.forEach(function(r, idx) {
      if (!String(r[2] || r[7] || r[9] || '').trim()) return;
      medicamentos.push({
        rowIndex: idx + 2,
        idMedicamentoRec: String(r[0] || ''),
        dataRecebimento: fmtEquipDate_(r[1]),
        dataRecebimentoISO: fmtEquipISO_(r[1]),
        projeto: String(r[2] || ''),
        registroRm: String(r[3] || 'Não'),
        notaFiscal: String(r[4] || ''),
        remetente: String(r[5] || ''),
        movimentoRm: String(r[6] || ''),
        descricao: String(r[7] || ''),
        quantidade: r[8] !== '' && r[8] !== null ? Number(r[8]) : '',
        lote: String(r[9] || ''),
        validade: fmtEquipDate_(r[10]),
        validadeISO: fmtEquipISO_(r[10]),
        responsavelRecebimento: String(r[11] || ''),
        localizacao: String(r[12] || ''),
        observacoes: String(r[13] || ''),
        criadoEm: fmtEquipDate_(r[14], 'dd/MM/yyyy HH:mm'),
        responsavelRegistro: String(r[15] || '')
      });
    });
  }

  return {
    medicamentos: medicamentos.reverse(),
    projetos: getProjetosEquipamentos_(),
    solicitantes: getSolicitantesEquipamentos_(),
    config: getEstoqueConfig()
  };
}

function salvarMedicamentoRecebido(payload) {
  payload = payload || {};
  if (!String(payload.projeto || '').trim()) throw new Error('Selecione um projeto.');
  if (!String(payload.descricao || '').trim()) throw new Error('Informe a descrição do medicamento.');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getMedicamentosSheet_(ss);
  var rowIndex = parseInt(payload.rowIndex, 10);
  var usuario = getUsuarioEmail();
  var idRegistro = gerarCodigoRegistro_('MED');
  var criadoEm = new Date();
  var responsavelRegistro = usuario;

  if (rowIndex && rowIndex >= 2 && rowIndex <= sh.getLastRow()) {
    var existing = sh.getRange(rowIndex, 1, 1, 16).getValues()[0];
    idRegistro = existing[0] || idRegistro;
    criadoEm = existing[14] || criadoEm;
    responsavelRegistro = existing[15] || responsavelRegistro;
  }

  var row = [
    idRegistro,
    parseEquipDate_(payload.dataRecebimento),
    String(payload.projeto || '').trim(),
    String(payload.registroRm || 'Não'),
    String(payload.notaFiscal || '').trim(),
    String(payload.remetente || '').trim(),
    String(payload.movimentoRm || '').trim(),
    String(payload.descricao || '').trim(),
    payload.quantidade !== '' && payload.quantidade !== null && payload.quantidade !== undefined ? Number(payload.quantidade) : '',
    String(payload.lote || '').trim(),
    parseEquipDate_(payload.validade),
    String(payload.responsavelRecebimento || '').trim(),
    String(payload.localizacao || '').trim(),
    String(payload.observacoes || '').trim(),
    criadoEm,
    responsavelRegistro
  ];

  if (rowIndex && rowIndex >= 2 && rowIndex <= sh.getLastRow()) {
    sh.getRange(rowIndex, 1, 1, 16).setValues([row]);
    return 'Medicamento atualizado com sucesso.';
  }

  sh.appendRow(row);
  return 'Medicamento cadastrado com sucesso.';
}

// ============================================================================
// AGENDA WEBAPP V1 - estrutura atual com 36 colunas
// Mantem a documentacao de transporte separada.
// ============================================================================
var AGENDA_CFG = {
  abaNomes: ['\uD83D\uDCC5 Agenda', 'Agenda'],
  lastCol: 44,
  col: {
    id: 1, data: 2, hora: 3, tipo: 4, status: 5, participante: 6,
    nasc: 7, idParticipante: 8, projeto: 9, braco: 10, visita: 11,
    medico: 12, procedimentos: 13, servTerc: 14, obs: 15,
    labCentral: 16, controle: 17, kit: 18
  },
  idx: {
    id: 0, data: 1, hora: 2, tipo: 3, status: 4, participante: 5,
    nasc: 6, idParticipante: 7, projeto: 8, braco: 9, visita: 10,
    medico: 11, procedimentos: 12, servTerc: 13, obs: 14,
    labCentral: 15, controle: 16, kit: 17,
    c1: { nome: 18, temp: 19, status: 20, awb: 21, material: 22, destino: 36, matBio: 40 },
    c2: { nome: 23, temp: 24, status: 25, awb: 26, material: 27, destino: 37, matBio: 41 },
    c3: { nome: 28, temp: 29, status: 30, awb: 31, material: 32, destino: 38, matBio: 42 },
    cb: { nome: 33, status: 34, material: 35, destino: 39, matBio: 43 }
  }
};

var CFG = typeof CFG !== 'undefined' ? CFG : {
  abaNome: '\uD83D\uDCC5 Agenda',
  lastCol: 44,
  colTerc: 14,
  colGatilho: 16,
  colControle: 17,
  colKit: 18
};

var COL_ID = typeof COL_ID !== 'undefined' ? COL_ID : AGENDA_CFG.col.id;
var COL_DATA = typeof COL_DATA !== 'undefined' ? COL_DATA : AGENDA_CFG.col.data;
var COL_HORA = typeof COL_HORA !== 'undefined' ? COL_HORA : AGENDA_CFG.col.hora;
var COL_TIPO = typeof COL_TIPO !== 'undefined' ? COL_TIPO : AGENDA_CFG.col.tipo;
var COL_STATUS = typeof COL_STATUS !== 'undefined' ? COL_STATUS : AGENDA_CFG.col.status;
var COL_PARTICIPANTE = typeof COL_PARTICIPANTE !== 'undefined' ? COL_PARTICIPANTE : AGENDA_CFG.col.participante;
var COL_PROJETO = typeof COL_PROJETO !== 'undefined' ? COL_PROJETO : AGENDA_CFG.col.projeto;
var COL_VISITA = typeof COL_VISITA !== 'undefined' ? COL_VISITA : AGENDA_CFG.col.visita;
var COL_OBS = typeof COL_OBS !== 'undefined' ? COL_OBS : AGENDA_CFG.col.obs;

function getAgendaSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getSheetByPossibleNames_(ss, AGENDA_CFG.abaNomes);
  if (!sh) throw new Error('Aba Agenda nao encontrada.');
  ensureAgendaDestinoLabColumns_(sh);
  return sh;
}

function ensureAgendaDestinoLabColumns_(sh) {
  if (sh.getMaxColumns() < AGENDA_CFG.lastCol) {
    sh.insertColumnsAfter(sh.getMaxColumns(), AGENDA_CFG.lastCol - sh.getMaxColumns());
  }
  var headers = [
    { col: AGENDA_CFG.idx.c1.destino + 1, label: 'Laboratório destino I' },
    { col: AGENDA_CFG.idx.c2.destino + 1, label: 'Laboratório destino II' },
    { col: AGENDA_CFG.idx.c3.destino + 1, label: 'Laboratório destino III' },
    { col: AGENDA_CFG.idx.cb.destino + 1, label: 'Laboratório destino Backup' },
    { col: AGENDA_CFG.idx.c1.matBio + 1, label: 'Material biológico estruturado I' },
    { col: AGENDA_CFG.idx.c2.matBio + 1, label: 'Material biológico estruturado II' },
    { col: AGENDA_CFG.idx.c3.matBio + 1, label: 'Material biológico estruturado III' },
    { col: AGENDA_CFG.idx.cb.matBio + 1, label: 'Material biológico estruturado Backup' }
  ];
  headers.forEach(function(h) {
    var cell = sh.getRange(1, h.col);
    try {
      if (!String(cell.getValue() || '').trim()) cell.setValue(h.label);
    } catch (e) {
      // Algumas planilhas usam colunas tipadas e bloqueiam alteracao direta do cabecalho.
      // A coluna ja existe; nesse caso seguimos sem interromper o salvamento da Agenda.
    }
  });
}

function getAgendaEventTypes_() {
  return getConfigAppValuesByKeys_(
    ['Agenda'],
    ['Tipo de evento', 'Tipos de evento'],
    ['Visita', 'Monitoria', 'Envio de amostras', 'Exame de imagem',
     'Exames laboratoriais', 'Feriado', 'SIV', 'Close-out', 'Reuniao', 'Auditoria']
  );
}

function getAgendaStatuses_() {
  return getConfigAppValuesByKeys_(
    ['Agenda'],
    ['Status'],
    ['Agendado', 'Realizado', 'Cancelado', 'Reagendado', 'Pendente']
  );
}

function getAgendaLaboratorios_() {
  return getConfigAppValuesByKeys_(
    ['Agenda', 'Estoque'],
    ['Laboratorio', 'Laboratorio central', 'Lab central'],
    []
  );
}

function getAgendaCouriers_() {
  return getConfigAppValuesByKeys_(
    ['Agenda', 'Logistica', 'Log\u00EDstica'],
    ['Courier', 'Couriers', 'Courier agenda', 'Nome do courier'],
    ['Marken', 'OCASA', 'DHL']
  );
}

function getAgendaTemperaturas_() {
  return getConfigAppValuesByKeys_(
    ['Agenda', 'Logistica', 'Log\u00EDstica'],
    ['Temperatura', 'Temperatura courier'],
    ['Ambiente', 'Refrigerado', 'Congelado']
  );
}

function getAgendaCourierStatuses_() {
  return getConfigAppValuesByKeys_(
    ['Agenda', 'Logistica', 'Log\u00EDstica'],
    ['Status courier', 'Status do courier', 'Courier status'],
    ['N\u00E3o Agendado', 'Pendente', 'Agendado', 'Coletado', 'Enviado', 'Entregue', 'Cancelado']
  );
}

function getAgendaProcedimentoChips_() {
  var vals = getConfigAppValuesByKeys_(
    ['Agenda'],
    ['Procedimento chip', 'Procedimentos chip', 'Chip procedimento', 'Chips procedimentos'],
    ['Consulta', 'Sinais Vitais', 'Coleta', 'Questionário', 'Medicação/IP', 'ECG', 'TC', 'PK', 'ADA', 'ctDNA', 'Lab Central', 'Contato telefônico']
  );
  var out = [];
  vals.forEach(function(v) {
    var n = normText_(v);
    if (n === 'pk/tk/ctdna' || n === 'pk tk ctdna') {
      ['PK', 'ADA', 'ctDNA'].forEach(function(x) {
        if (out.indexOf(x) === -1) out.push(x);
      });
      return;
    }
    if (out.indexOf(v) === -1) out.push(v);
  });
  return out;
}

function getAgendaLabDestinos_() {
  return getConfigAppValuesByKeys_(
    ['Agenda', 'Logistica', 'Log\u00EDstica'],
    ['Laboratório destino', 'Laboratorio destino', 'Laboratório de destino', 'Laboratorio de destino', 'Lab destino', 'Laboratório central destino', 'Laboratorio central destino'],
    [
      'IQVIA (VALENCIA)',
      'IQVIA (MARIETTA)',
      'LABCORP (INDIANAPOLIS)',
      'LABCORP (TORRANCE)',
      'DASA (BARUERI)',
      'HEMATOGENIX (TINLEY PARK)',
      'PPD GLOBAL (HIGHLAND HEIGHTS)',
      'ICON (FARMINGDALE)',
      'CELLCARTA (NAPERVILLE)',
      'CENTOGENE (ROSTOCK)',
      'FOUNDATION MEDICINE (BOSTON)',
      'EUROFINS (LANCASTER)',
      'EUROFINS (LEOLA)',
      'GBA CENTRAL LAB (SCHWENTINENTAL)'
    ]
  );
}

function getAgendaKitsEstoque_() {
  try {
    var itens = getEstoque() || [];
    var seen = {};
    return itens.filter(function(it) {
      var tipo = normText_(it.tipoItem || it.tipo || '');
      var desc = normText_(it.descricao || '');
      var saldo = Number(it.qtde);
      var temSaldo = it.qtde === undefined || it.qtde === '' || isNaN(saldo) || saldo > 0;
      var pareceKit = tipo.indexOf('kit') > -1 || tipo.indexOf('coleta') > -1 ||
        (desc.indexOf('kit') > -1 && desc.indexOf('coleta') > -1);
      var fluxoExterno = tipo.indexOf('exame') > -1 || tipo.indexOf('servico') > -1 ||
        desc.indexOf('requisicao') > -1 || desc.indexOf('servico terceirizado') > -1;
      return temSaldo && pareceKit && !fluxoExterno;
    }).map(function(it) {
      var validade = formatarDataSafe(it.validade || it.dataValidade || '');
      var label = String(it.descricao || it.idItem || it.id || 'Kit de coleta').trim();
      if (validade) label += ' | validade ' + validade;
      if (it.qtde !== undefined && it.qtde !== '') label += ' | qtd ' + it.qtde;
      return {
        id: String(it.idItem || it.id || label),
        label: label,
        projeto: String(it.projeto || ''),
        projetoNorm: normText_(it.projeto || ''),
        validade: validade,
        qtde: it.qtde
      };
    }).filter(function(it) {
      var key = [it.id, it.projeto, it.validade].join('|');
      if (!it.label || seen[key]) return false;
      seen[key] = 1;
      return true;
    }).sort(function(a, b) { return a.label.localeCompare(b.label); });
  } catch(e) {
    return [];
  }
}

function abrirNovoEventoComCalendario() {
  var html = HtmlService.createHtmlOutputFromFile('NovoEventoAgenda')
    .setWidth(720)
    .setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, ' ');
}

function getDadosFormularioAgenda() {
  ensureProjetoStatusConfig_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function listaColB(nomesAba) {
    var sh = getSheetByPossibleNames_(ss, nomesAba);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues()
      .map(function(r) { return String(r[0] || '').trim(); })
      .filter(Boolean)
      .sort();
  }
  var hoje = new Date();
  var hojeIso = hoje.getFullYear() + '-' +
    ('0' + (hoje.getMonth() + 1)).slice(-2) + '-' +
    ('0' + hoje.getDate()).slice(-2);
  return {
    participantes: listaColB(['Participantes']),
    medicos: listaColB(['\uD83E\uDE7A M\u00E9dicos', 'Medicos', 'M\u00E9dicos']),
    prestadores: listaColB(['\uD83C\uDFE2 Prestadores', 'Prestadores']),
    projetos: listaColB(['Projetos']),
    laboratorios: getAgendaLaboratorios_(),
    couriers: getAgendaCouriers_(),
    temperaturas: getAgendaTemperaturas_(),
    statusCourier: getAgendaCourierStatuses_(),
    laboratoriosDestino: getAgendaLabDestinos_(),
    kitsColeta: getAgendaKitsEstoque_(),
    tiposEvento: getAgendaEventTypes_(),
    status: getAgendaStatuses_(),
    procedimentoChips: getAgendaProcedimentoChips_(),
    emailLabAtivo: agendaEmailEnabled_(),
    hojeIso: hojeIso
  };
}

function getInfoParticipante(nome) {
  if (!nome) return null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Participantes');
  if (!sh || sh.getLastRow() < 2) return null;
  var dados = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(7, sh.getLastColumn())).getValues();
  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i][1] || '').trim() !== String(nome || '').trim()) continue;
    var nascRaw = dados[i][2];
    var ultima = getUltimaVisitaParticipanteAgenda_(nome);
    return {
      nascimento: formatarDataSafe(nascRaw),
      idade: calcularIdadeAgenda_(nascRaw),
      numId: String(dados[i][4] || ''),
      projeto: String(dados[i][5] || ''),
      braco: String(dados[i][6] || ''),
      ultimaVisitaData: ultima.data,
      ultimaVisitaId: ultima.visita
    };
  }
  return null;
}

function calcularIdadeAgenda_(valor) {
  var nasc = agendaDateFromValue_(valor);
  if (!nasc) return '';
  var hoje = new Date();
  var idade = hoje.getFullYear() - nasc.getFullYear();
  var antesAniversario = hoje.getMonth() < nasc.getMonth() ||
    (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate());
  if (antesAniversario) idade--;
  return idade >= 0 ? idade : '';
}

function agendaDateFromValue_(valor) {
  return parseAgendaDateAny_(valor);
}

function isAgendaTipoVisita_(tipo) {
  var t = normText_(tipo);
  if (!t) return true;
  return ['monitoria', 'siv', 'close-out', 'reuniao', 'feriado', 'auditoria', 'exame de imagem']
    .indexOf(t) === -1;
}

function getUltimaVisitaParticipanteAgenda_(nome) {
  var vazio = { data: '', visita: '' };
  try {
    return getUltimasVisitasParticipantesAgendaMap_()[normText_(nome)] || vazio;
  } catch(e) {
    return vazio;
  }
}

function getUltimasVisitasParticipantesAgendaMap_() {
  var out = {};
  try {
    var agenda = getAgendaSheet_();
    var lastRow = agenda.getLastRow();
    if (lastRow < 2) return out;
    var vals = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
    var idx = AGENDA_CFG.idx;
    var hoje = new Date();
    hoje.setHours(23, 59, 59, 999);
    vals.forEach(function(r) {
      var participante = normText_(r[idx.participante]);
      if (!participante) return;
      if (!isAgendaTipoVisita_(r[idx.tipo])) return;
      var dt = agendaDateFromValue_(r[idx.data]);
      if (!dt || dt.getTime() > hoje.getTime()) return;
      if (!out[participante] || dt.getTime() > out[participante].dataObj.getTime()) {
        out[participante] = {
          dataObj: dt,
          data: formatarDataSafe(r[idx.data]),
          visita: String(r[idx.visita] || '')
        };
      }
    });
    Object.keys(out).forEach(function(k) {
      out[k] = { data: out[k].data, visita: out[k].visita };
    });
    return out;
  } catch(e) {
    return out;
  }
}

function salvarNovoEventoCompleto(dados) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var d = _parseDateHora(dados.data, dados.hora);
  var dCmp = new Date(d);
  dCmp.setHours(0, 0, 0, 0);
  var lastRow = agenda.getLastRow();
  if (lastRow > 1) {
    var vals = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var ld = vals[i][AGENDA_CFG.idx.data];
      var lt = normText_(vals[i][AGENDA_CFG.idx.tipo]);
      if (ld instanceof Date) {
        var dl = new Date(ld);
        dl.setHours(0, 0, 0, 0);
        if (dl.getTime() === dCmp.getTime() && lt === 'feriado') {
          return { feriado: true, dataFmt: formatarDataSafe(d) };
        }
      }
    }
  }
  return _gravarLinhaEvento(agenda, d, dados, ss);
}

function salvarNovoEventoComFeriado(dados) {
  return _gravarLinhaEvento(getAgendaSheet_(), _parseDateHora(dados.data, dados.hora), dados, SpreadsheetApp.getActiveSpreadsheet());
}

function atualizarAgendaEventoCompleto(dados) {
  dados = dados || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, dados.id);
  if (!linha) throw new Error('Agendamento nao encontrado para edicao.');
  var d = _parseDateHora(dados.data, dados.hora);
  var tipo = String(dados.tipo || '').trim();
  var status = String(dados.status || 'Agendado').trim();
  var labCentral = String(dados.labCentral || '').trim();
  var tiposNaoLab = ['monitoria', 'siv', 'close-out', 'reuniao', 'feriado', 'auditoria', 'exame de imagem'];
  if (tiposNaoLab.indexOf(normText_(tipo)) > -1) labCentral = 'N\u00E3o aplic\u00E1vel';
  if (normText_(labCentral) === 'sim' && !String(dados.visita || '').trim()) {
    return { erro: 'Para "Laboratorio Central = Sim", informe a Visita.' };
  }
  var dataAnterior = agenda.getRange(linha, AGENDA_CFG.col.data).getValue();

  setAgendaDateValue_(agenda.getRange(linha, AGENDA_CFG.col.data), d);
  agenda.getRange(linha, AGENDA_CFG.col.hora).setValue(formatAgendaHora_(d));
  agenda.getRange(linha, AGENDA_CFG.col.tipo).setValue(tipo);
  agenda.getRange(linha, AGENDA_CFG.col.status).setValue(status);
  agenda.getRange(linha, AGENDA_CFG.col.participante).setValue(dados.participante || '');
  agenda.getRange(linha, AGENDA_CFG.col.projeto).setValue(dados.projeto || '');
  agenda.getRange(linha, AGENDA_CFG.col.visita).setValue(dados.visita || '');
  agenda.getRange(linha, AGENDA_CFG.col.medico).setValue(dados.medico || '');
  agenda.getRange(linha, AGENDA_CFG.col.procedimentos).setValue(dados.procedimentos || '');
  agenda.getRange(linha, AGENDA_CFG.col.servTerc).setValue(dados.servTerc || '');
  agenda.getRange(linha, AGENDA_CFG.col.obs).setValue(dados.obs || '');
  agenda.getRange(linha, AGENDA_CFG.col.labCentral).setValue(labCentral);
  agenda.getRange(linha, AGENDA_CFG.col.kit).setValue(dados.kit || '');
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c1, dados.courier1);
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c2, dados.courier2);
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c3, dados.courier3);
  agendaSetBackupLinha_(agenda, linha, dados.backup);
  agendaSetTransporteExtraLinha_(agenda, linha, dados);
  if (normText_(status) === 'cancelado') aplicarLogicaCancelamento(agenda, linha, status);
  verificarNotificacoes({ source: ss, range: agenda.getRange(linha, AGENDA_CFG.col.labCentral), user: Session.getActiveUser() }, dados.id, dataAnterior);
  if (agenda.getLastRow() > 2) {
    agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol)
      .sort([{ column: AGENDA_CFG.col.data, ascending: true }, { column: AGENDA_CFG.col.hora, ascending: true }]);
  }
  SpreadsheetApp.flush();
  return { ok: true, id: dados.id, atualizado: true };
}

function cancelarAgendaEvento(id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, id);
  if (!linha) throw new Error('Agendamento nao encontrado para cancelamento.');
  agenda.getRange(linha, AGENDA_CFG.col.status).setValue('Cancelado');
  aplicarLogicaCancelamento(agenda, linha, 'Cancelado');
  verificarNotificacoes({ source: ss, range: agenda.getRange(linha, AGENDA_CFG.col.labCentral), user: Session.getActiveUser() }, id, null);
  SpreadsheetApp.flush();
  return { ok: true, id: id, status: 'Cancelado' };
}

function marcarAgendaPassadaComoRealizada() {
  var agenda = getAgendaSheet_();
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return { atualizados: 0 };
  var vals = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  var atualizados = 0;
  vals.forEach(function(r, idx) {
    var status = normText_(r[AGENDA_CFG.idx.status]);
    if (status === 'realizado' || status === 'cancelado' || status === 'concluido') return;
    var dt = agendaDateFromValue_(r[AGENDA_CFG.idx.data]);
    if (!dt) return;
    dt.setHours(0, 0, 0, 0);
    if (dt.getTime() <= hoje.getTime()) {
      agenda.getRange(idx + 2, AGENDA_CFG.col.status).setValue('Realizado');
      atualizados++;
    }
  });
  return { atualizados: atualizados };
}

function instalarGatilhoAgendaRealizadoFimDoDia() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'marcarAgendaPassadaComoRealizada') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('marcarAgendaPassadaComoRealizada')
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .create();
  return { ok: true };
}

function _gravarLinhaEvento(agenda, d, dados, ss) {
  var tipo = String(dados.tipo || '').trim();
  var status = String(dados.status || 'Agendado').trim();
  var labCentral = String(dados.labCentral || '').trim();
  var tiposNaoLab = ['monitoria', 'siv', 'close-out', 'reuniao', 'feriado', 'auditoria', 'exame de imagem'];
  if (tiposNaoLab.indexOf(normText_(tipo)) > -1) labCentral = 'N\u00E3o aplic\u00E1vel';
  if (normText_(labCentral) === 'sim' && !String(dados.visita || '').trim()) {
    return { erro: 'Para "Laboratorio Central = Sim", informe a Visita.' };
  }

  var linhaNova = agenda.getLastRow() + 1;
  var id = Utilities.getUuid().slice(0, 8);
  agenda.getRange(linhaNova, AGENDA_CFG.col.id).setValue(id);
  setAgendaDateValue_(agenda.getRange(linhaNova, AGENDA_CFG.col.data), d);
  agenda.getRange(linhaNova, AGENDA_CFG.col.hora).setValue(formatAgendaHora_(d));
  agenda.getRange(linhaNova, AGENDA_CFG.col.tipo).setValue(tipo);
  agenda.getRange(linhaNova, AGENDA_CFG.col.status).setValue(status);
  agenda.getRange(linhaNova, AGENDA_CFG.col.participante).setValue(dados.participante || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.projeto).setValue(dados.projeto || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.visita).setValue(dados.visita || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.medico).setValue(dados.medico || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.procedimentos).setValue(dados.procedimentos || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.servTerc).setValue(dados.servTerc || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.obs).setValue(dados.obs || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.labCentral).setValue(labCentral);
  agenda.getRange(linhaNova, AGENDA_CFG.col.kit).setValue(dados.kit || '');
  agendaSetCourierLinha_(agenda, linhaNova, AGENDA_CFG.idx.c1, dados.courier1);
  agendaSetCourierLinha_(agenda, linhaNova, AGENDA_CFG.idx.c2, dados.courier2);
  agendaSetCourierLinha_(agenda, linhaNova, AGENDA_CFG.idx.c3, dados.courier3);
  agendaSetBackupLinha_(agenda, linhaNova, dados.backup);
  agendaSetTransporteExtraLinha_(agenda, linhaNova, dados);
  agenda.getRange(linhaNova, 1, 1, AGENDA_CFG.lastCol)
    .setFontFamily('Roboto')
    .setFontSize(10)
    .setFontColor('#434343')
    .setFontWeight('normal');
  agenda.getRange(linhaNova, AGENDA_CFG.col.data).setFontWeight('bold');
  agenda.getRange(linhaNova, AGENDA_CFG.col.projeto).setFontWeight('bold');
  if (normText_(status) === 'cancelado') aplicarLogicaCancelamento(agenda, linhaNova, status);

  verificarNotificacoes({ source: ss, range: agenda.getRange(linhaNova, AGENDA_CFG.col.labCentral), user: Session.getActiveUser() }, id, null);

  if (agenda.getLastRow() > 2) {
    agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol)
      .sort([{ column: AGENDA_CFG.col.data, ascending: true }, { column: AGENDA_CFG.col.hora, ascending: true }]);
  }
  SpreadsheetApp.flush();
  return { ok: true, id: id, emailLabAtivo: agendaEmailEnabled_() };
}

function agendaSetCourierLinha_(agenda, linha, idx, courier) {
  courier = courier || {};
  agenda.getRange(linha, idx.nome + 1).setValue(courier.nome || '');
  agenda.getRange(linha, idx.temp + 1).setValue(courier.temperatura || courier.temp || '');
  agenda.getRange(linha, idx.status + 1).setValue(courier.status || '');
  agendaSetAwbValue_(agenda.getRange(linha, idx.awb + 1), courier.awb || '');
  agenda.getRange(linha, idx.material + 1).setValue(courier.material || '');
  if (idx.destino !== undefined) agenda.getRange(linha, idx.destino + 1).setValue(courier.destino || courier.laboratorioDestino || '');
  if (idx.matBio !== undefined) agenda.getRange(linha, idx.matBio + 1).setValue(courier.matBioJson || courier.materialJson || '');
}

function agendaSetAwbValue_(range, awb) {
  awb = String(awb || '').trim();
  if (!awb) {
    range.clearContent();
    return;
  }
  var url = agendaTrackingUrl_(awb);
  if (url) range.setFormula('=HYPERLINK("' + url + '"; "' + awb + '")');
  else range.setValue(awb);
}

function agendaTrackingUrl_(awb) {
  awb = String(awb || '').trim();
  if (/^620X[0-9]{8}$/i.test(awb)) {
    return 'https://online.marken.com/FastTrack/Shipment?inputTrack=' + encodeURIComponent(awb);
  }
  if (/^T[0-9]{7}$/i.test(awb)) {
    return 'https://tracking.ocasa.com/Tracking/index?client=&airbillnumber=' + encodeURIComponent(awb) + '&i=18&url=ocasa';
  }
  if (/^[0-9]{10}$/.test(awb)) {
    return 'https://www.dhl.com/br-en/home/tracking.html?tracking-id=' + encodeURIComponent(awb) + '&submit=1';
  }
  return '';
}

function agendaSetBackupLinha_(agenda, linha, backup) {
  backup = backup || {};
  var idx = AGENDA_CFG.idx.cb;
  agenda.getRange(linha, idx.nome + 1).setValue(backup.nome || '');
  agenda.getRange(linha, idx.status + 1).setValue(backup.status || '');
  agenda.getRange(linha, idx.material + 1).setValue(backup.material || '');
  if (idx.destino !== undefined) agenda.getRange(linha, idx.destino + 1).setValue(backup.destino || backup.laboratorioDestino || '');
  if (idx.matBio !== undefined) agenda.getRange(linha, idx.matBio + 1).setValue(backup.matBioJson || backup.materialJson || '');
}

function agendaSetTransporteExtraLinha_(agenda, linha, dados) {
  dados = dados || {};
  var c1 = dados.courier1 || {};
  var c2 = dados.courier2 || {};
  var c3 = dados.courier3 || {};
  var cb = dados.backup || {};
  var row = [
    c1.destino || c1.laboratorioDestino || '',
    c2.destino || c2.laboratorioDestino || '',
    c3.destino || c3.laboratorioDestino || '',
    cb.destino || cb.laboratorioDestino || '',
    c1.matBioJson || c1.materialJson || '',
    c2.matBioJson || c2.materialJson || '',
    c3.matBioJson || c3.materialJson || '',
    cb.matBioJson || cb.materialJson || ''
  ];
  var startCol = AGENDA_CFG.idx.c1.destino + 1;
  row.forEach(function(value, offset) {
    agenda.getRange(linha, startCol + offset).setValue(String(value || ''));
  });
}

function columnToLetter_(col) {
  var letter = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

function setAgendaDateValue_(range, value) {
  range.setValue(formatAgendaDatePt_(value));
}

function formatAgendaDatePt_(value) {
  var d = parseAgendaDateAny_(value);
  if (!d || isNaN(d.getTime())) return String(value || '');
  var meses = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
  return ('0' + d.getDate()).slice(-2) + '/' + meses[d.getMonth()] + '/' + d.getFullYear();
}

function formatAgendaHora_(value) {
  var d = value instanceof Date ? value : new Date(value);
  if (d && !isNaN(d.getTime())) {
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  return String(value || '');
}

function setAgendaValueAndFormat_(range, value, format) {
  range.setValue(value);
  try {
    range.setNumberFormat(format);
  } catch (e) {
    // Colunas tipadas/tabelas do Google Sheets podem bloquear formato manual.
  }
}

function getAgendaEventos(limite) {
  var sh = getAgendaSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var max = Math.min(Number(limite || 80), lastRow - 1);
  var start = Math.max(2, lastRow - max + 1);
  var vals = sh.getRange(start, 1, lastRow - start + 1, AGENDA_CFG.lastCol).getValues();
  return vals.map(function(r, i) { return agendaRowToObject_(r, start + i); }).reverse();
}

function agendaRowToObject_(r, rowIndex) {
  var i = AGENDA_CFG.idx;
  return {
    rowIndex: rowIndex,
    id: String(r[i.id] || ''),
    data: formatarDataSafe(r[i.data]),
    dataIso: formatarDataIsoAgenda_(r[i.data]),
    hora: formatarHoraSafe_(r[i.hora]),
    tipo: String(r[i.tipo] || ''),
    status: String(r[i.status] || ''),
    participante: String(r[i.participante] || ''),
    nascimento: formatarDataSafe(r[i.nasc]),
    idParticipante: String(r[i.idParticipante] || ''),
    projeto: String(r[i.projeto] || ''),
    braco: String(r[i.braco] || ''),
    visita: String(r[i.visita] || ''),
    medico: String(r[i.medico] || ''),
    procedimentos: String(r[i.procedimentos] || ''),
    servTerc: String(r[i.servTerc] || ''),
    obs: String(r[i.obs] || ''),
    labCentral: String(r[i.labCentral] || ''),
    controle: String(r[i.controle] || ''),
    kit: String(r[i.kit] || ''),
    courier1: agendaCourierToObject_(r, i.c1),
    courier2: agendaCourierToObject_(r, i.c2),
    courier3: agendaCourierToObject_(r, i.c3),
    backup: {
      nome: String(r[i.cb.nome] || ''),
      status: String(r[i.cb.status] || ''),
      material: String(r[i.cb.material] || ''),
      destino: String(r[i.cb.destino] || ''),
      matBioJson: String(r[i.cb.matBio] || '')
    }
  };
}

function agendaCourierToObject_(r, c) {
  return {
    nome: String(r[c.nome] || ''),
    temperatura: String(r[c.temp] || ''),
    status: String(r[c.status] || ''),
    awb: String(r[c.awb] || ''),
    material: String(r[c.material] || ''),
    destino: String(r[c.destino] || ''),
    matBioJson: String(r[c.matBio] || '')
  };
}

function formatarDataIsoAgenda_(v) {
  if (!v) return '';
  var d = parseAgendaDateAny_(v) || new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function agendaEmailEnabled_() {
  var vals = getConfigAppValuesByKeys_(['Agenda'], ['Enviar emails lab central'], []);
  return vals.length > 0 && normText_(vals[0]) === 'sim';
}

function verificarNotificacoes(e, idAtivo, dataAnterior) {
  var sheet = getAgendaSheet_();
  var linha = idAtivo ? encontrarLinhaPorId(sheet, idAtivo) : e.range.getRow();
  if (!linha) return;
  var gatilho = normText_(sheet.getRange(linha, AGENDA_CFG.col.labCentral).getValue());
  var status = normText_(sheet.getRange(linha, AGENDA_CFG.col.status).getValue());
  var controle = String(sheet.getRange(linha, AGENDA_CFG.col.controle).getValue() || '');
  var dataAtual = sheet.getRange(linha, AGENDA_CFG.col.data).getValue();
  var mudouData = datasAgendaDiferentes_(dataAnterior, dataAtual);
  if (gatilho === 'sim' && status !== 'cancelado' && controle.indexOf('Notificado') === -1) {
    if (agendaEmailEnabled_()) {
      enviarEmailAgendamento(sheet, linha, e.user);
      sheet.getRange(linha, AGENDA_CFG.col.controle).setValue('Notificado ' + formatarDataSafe(sheet.getRange(linha, AGENDA_CFG.col.data).getValue()));
    } else {
      sheet.getRange(linha, AGENDA_CFG.col.controle).setValue('Pendente notificacao - modo teste');
    }
  } else if (gatilho === 'sim' && status !== 'cancelado' && mudouData && controle.indexOf('Notificado') > -1) {
    if (agendaEmailEnabled_()) enviarEmailReagendamento(sheet, linha, e.user, dataAnterior);
    sheet.getRange(linha, AGENDA_CFG.col.controle).setValue('Reagendado ' + formatarDataSafe(dataAtual));
  } else if (status === 'cancelado' && (controle.indexOf('Notificado') > -1 || controle.indexOf('Reagendado') > -1)) {
    if (agendaEmailEnabled_()) enviarEmailCancelamento(sheet, linha, e.user);
    sheet.getRange(linha, AGENDA_CFG.col.controle).setValue('Cancelado');
  }
}

function datasAgendaDiferentes_(a, b) {
  if (!a || !b) return false;
  var da = a instanceof Date ? new Date(a) : new Date(a);
  var db = b instanceof Date ? new Date(b) : new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return da.getTime() !== db.getTime();
}

function aplicarLogicaCancelamento(sheet, linha, status) {
  var range = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol);
  if (normText_(status) === 'cancelado') {
    range.setFontColor('#999999').setFontLine('line-through').setBackground('#eeeeee');
  } else {
    range.setFontColor('#434343').setFontLine('none').setBackground(null);
  }
}

function enviarEmailAgendamento(sheet, linha, usuario) {
  var dados = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var i = AGENDA_CFG.idx;
  var assunto = '[AGENDAMENTO] ' + (dados[i.projeto] || '') + ' - Visita com Envio ao Lab Central';
  var body = gerarHtmlCabecalhoEmail_('Agendamento - Envio de Amostras ao Lab Central', '#2c3e50') +
    '<p>Foi realizado um novo agendamento de visita clínica que requer envio ao laboratório:</p>' +
    gerarTabelaAgendaEmail_(dados, true) +
    '<p>As informações de courier e transporte serão atualizadas na Agenda assim que estiverem disponíveis.</p>' +
    '<p><a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">Clique aqui para abrir a Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Responsável', usuario) + '</div>';
  MailApp.sendEmail({ to: gerarListaDestinatarios(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function enviarEmailCancelamento(sheet, linha, usuario) {
  var dados = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var i = AGENDA_CFG.idx;
  var assunto = '[CANCELAMENTO] ' + (dados[i.projeto] || '') + ' - Visita com Envio ao Lab Central';
  var body = gerarHtmlCabecalhoEmail_('CANCELAMENTO DE VISITA / ENVIO', '#c0392b') +
    '<p>A seguinte visita foi <b>REMOVIDA</b> do fluxo de envio ao Lab Central:</p>' +
    gerarTabelaAgendaEmail_(dados, true, 'Data Original') + gerarHtmlCouriers(dados) +
    '<p><a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Cancelado por', usuario) + '</div>';
  MailApp.sendEmail({ to: gerarListaDestinatarios(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function enviarEmailReagendamento(sheet, linha, usuario, dataAnteriorRaw) {
  var dados = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var i = AGENDA_CFG.idx;
  var dataV = formatarDataSafe(dados[i.data]);
  var textoDataAnterior = dataAnteriorRaw
    ? '<p style="margin:0 0 8px 0;"><b>Data anterior:</b> ' + escHtmlServer_(formatarDataSafe(dataAnteriorRaw)) + '</p>'
    : '';
  var assunto = '[ALTERAÇÃO DE DATA] ' + (dados[i.projeto] || '') + ' - Visita com Envio ao Lab Central';
  var body = gerarHtmlCabecalhoEmail_('ATENÇÃO: DATA DA VISITA ALTERADA', '#d35400') +
    '<div style="background:#fff3cd;padding:10px;border-left:5px solid #d35400;margin-bottom:15px;">' +
      textoDataAnterior +
      '<p style="margin:0;"><b>NOVA DATA:</b> ' + escHtmlServer_(dataV) + '</p>' +
    '</div>' +
    '<p>Verifique a necessidade de ajustar o agendamento dos transportes de amostras já existentes:</p>' +
    gerarTabelaAgendaEmail_(dados, true) + gerarHtmlCouriers(dados) +
    '<p><a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Alterado por', usuario) + '</div>';
  MailApp.sendEmail({ to: gerarListaDestinatarios(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function ipsEmailLogoUrl_() {
  return 'https://i0.wp.com/www.ucs.br/ips/wp-content/uploads/2024/08/logo_ips_2024_2.png?fit=300%2C80&ssl=1';
}

function gerarHtmlCabecalhoEmail_(titulo, cor) {
  return '<div style="font-family:Arial;color:#333;">' +
    '<img src="' + ipsEmailLogoUrl_() + '" style="max-height:60px;margin-bottom:20px;">' +
    '<h2 style="color:' + (cor || '#2c3e50') + ';">' + escHtmlServer_(titulo) + '</h2>';
}

function gerarTabelaAgendaEmail_(dados, incluirDataNascimento, rotuloData) {
  var i = AGENDA_CFG.idx;
  var rows = [
    [rotuloData || 'Data', formatarDataSafe(dados[i.data])],
    ['Tipo de Evento', dados[i.tipo] || ''],
    ['Protocolo', dados[i.projeto] || ''],
    ['Participante', (dados[i.participante] || '') + ' (' + extrairIniciais_(dados[i.participante]) + ')']
  ];
  if (incluirDataNascimento) rows.push(['Data de Nascimento', formatarDataSafe(dados[i.nasc])]);
  rows.push(
    ['Número de Identificação', dados[i.idParticipante] || ''],
    ['Braço/Grupo', dados[i.braco] || 'N/A'],
    ['Visita', dados[i.visita] || '']
  );
  return '<table style="border-collapse:collapse;margin:10px 0;font-size:13px">' +
    rows.map(function(r) {
      return '<tr><td style="padding:4px 8px;border:1px solid #ddd"><b>' + escHtmlServer_(r[0]) + '</b></td>' +
        '<td style="padding:4px 8px;border:1px solid #ddd">' + escHtmlServer_(r[1]) + '</td></tr>';
    }).join('') + '</table>';
}

function gerarHtmlCouriers(dados) {
  var i = AGENDA_CFG.idx;
  var html = '<div style="background:#f8f9fa;padding:14px;border-radius:5px;border:1px solid #ddd">' +
    '<h3 style="margin-top:0;color:#333">Informações de Logística / Transportes de Amostras</h3>';
  function addC(n, c) {
    if (!dados[c.nome] || ['---', 'Nao aplicavel', 'N\u00E3o aplic\u00E1vel'].indexOf(String(dados[c.nome])) > -1) return '';
    return '<p style="margin:5px 0"><b>Transporte de Amostras ' + n + ':</b> ' + escHtmlServer_(dados[c.nome]) +
      ' | <b>Destino:</b> ' + escHtmlServer_(dados[c.destino] || '') +
      ' | <b>Temp:</b> ' + escHtmlServer_(dados[c.temp]) +
      ' | <b>Status:</b> ' + escHtmlServer_(dados[c.status]) +
      ' | <b>AWB:</b> ' + escHtmlServer_(dados[c.awb] || 'Pendente') +
      ' | <b>Material:</b> ' + escHtmlServer_(dados[c.material] || '') + '</p>';
  }
  html += addC(1, i.c1) + addC(2, i.c2) + addC(3, i.c3);
  if (dados[i.cb.nome] && String(dados[i.cb.nome]) !== 'N\u00E3o aplic\u00E1vel') {
    html += '<p style="margin:5px 0;border-top:1px solid #ccc;padding-top:5px"><b>Amostra Backup:</b> ' +
      escHtmlServer_(dados[i.cb.nome]) + ' | <b>Status:</b> ' + escHtmlServer_(dados[i.cb.status]) +
      ' | <b>Destino:</b> ' + escHtmlServer_(dados[i.cb.destino] || '') +
      ' | <b>Material:</b> ' + escHtmlServer_(dados[i.cb.material] || '') + '</p>';
  }
  return html + '</div>';
}

function gerarRodapeEmailAgenda_(label, usuario) {
  return '<hr><p style="font-size:11px;color:#777;">' + escHtmlServer_(label) + ': ' +
    escHtmlServer_(usuario && usuario.getEmail ? usuario.getEmail() : 'Desconhecido') + '</p>';
}

function extrairIniciais_(nome) {
  return String(nome || '').trim().split(/\s+/).filter(Boolean).map(function(p) {
    return p.charAt(0).toUpperCase();
  }).join('');
}

function gerarListaDestinatarios(usuario) {
  var vals = getConfigAppValuesByKeys_(['Agenda'], ['Destinatarios email lab central', 'Destinatarios e-mail lab central'], []);
  if (vals.length) return vals.join(',');
  var user = usuario && usuario.getEmail ? usuario.getEmail() : getUsuarioEmail();
  return user || Session.getActiveUser().getEmail();
}

function encontrarLinhaPorId(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return null;
  var ids = sheet.getRange(2, AGENDA_CFG.col.id, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return null;
}

function rastrearEMoverFoco(sheet, id, col) {
  var linha = encontrarLinhaPorId(sheet, id);
  if (linha) sheet.getRange(linha, col || AGENDA_CFG.col.participante).activate();
}

function formatarDataSafe(valor) {
  if (!valor) return '';
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(valor);
}

function formatarHoraSafe_(valor) {
  if (!valor) return '';
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(valor);
}

function escHtmlServer_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excluirMedicamentoRecebido(rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getMedicamentosSheet_(ss);
  var row = parseInt(rowIndex, 10);
  if (!row || row < 2 || row > sh.getLastRow()) throw new Error('Registro de medicamento não encontrado.');
  sh.deleteRow(row);
  return 'Medicamento excluído com sucesso.';
}

// ============================================================================
//  CONFIGURAÇÕES DO APP
// ============================================================================

function getConfigApp() {
  ensureProjetoStatusConfig_();
  ensureReqExamesConfig_();
  return { itens: readConfigAppRows_() };
}

function ensureProjetoStatusConfig_() {
  var sh = getConfigAppSheet_();
  var defaults = [
    ['Projetos', 'Status', 'Recrutamento aberto', 'Sim', 10, 'Status padrao para projetos ativos'],
    ['Projetos', 'Status', 'Em andamento', 'Sim', 20, 'Status padrao para projetos ativos'],
    ['Projetos', 'Status', 'Etapa regulatoria', 'Sim', 30, 'Projeto ainda sem inclusao ativa'],
    ['Projetos', 'Status', 'Concluido', 'Sim', 90, 'Projeto encerrado'],
    ['Agenda', 'Courier', 'Marken', 'Sim', 10, 'Courier disponivel para logistica da Agenda'],
    ['Agenda', 'Courier', 'OCASA', 'Sim', 20, 'Courier disponivel para logistica da Agenda'],
    ['Agenda', 'Courier', 'DHL', 'Sim', 30, 'Courier disponivel para logistica da Agenda'],
    ['Agenda', 'Temperatura', 'Ambiente', 'Sim', 10, 'Temperatura para transporte de amostras'],
    ['Agenda', 'Temperatura', 'Refrigerado', 'Sim', 20, 'Temperatura para transporte de amostras'],
    ['Agenda', 'Temperatura', 'Congelado', 'Sim', 30, 'Temperatura para transporte de amostras'],
    ['Agenda', 'Status courier', 'N\u00E3o Agendado', 'Sim', 5, 'Status logistico do courier'],
    ['Agenda', 'Status courier', 'Pendente', 'Sim', 10, 'Status logistico do courier'],
    ['Agenda', 'Status courier', 'Agendado', 'Sim', 20, 'Status logistico do courier'],
    ['Agenda', 'Status courier', 'Coletado', 'Sim', 30, 'Status logistico do courier'],
    ['Agenda', 'Status courier', 'Enviado', 'Sim', 40, 'Status logistico do courier'],
    ['Agenda', 'Status courier', 'Entregue', 'Sim', 50, 'Status logistico do courier'],
    ['Agenda', 'Status courier', 'Cancelado', 'Sim', 90, 'Status logistico do courier'],
    ['Agenda', 'Procedimento chip', 'Consulta', 'Sim', 10, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'Sinais Vitais', 'Sim', 20, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'Coleta', 'Sim', 30, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'Questionário', 'Sim', 40, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'Medicação/IP', 'Sim', 50, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'ECG', 'Sim', 60, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'TC', 'Sim', 70, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'PK', 'Sim', 80, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'ADA', 'Sim', 90, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'ctDNA', 'Sim', 100, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'Lab Central', 'Sim', 110, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Procedimento chip', 'Contato telefônico', 'Sim', 120, 'Chip rapido do campo Procedimentos'],
    ['Agenda', 'Laboratório destino', 'IQVIA (VALENCIA)', 'Sim', 10, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'IQVIA (MARIETTA)', 'Sim', 20, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'LABCORP (INDIANAPOLIS)', 'Sim', 30, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'LABCORP (TORRANCE)', 'Sim', 40, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'DASA (BARUERI)', 'Sim', 50, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'HEMATOGENIX (TINLEY PARK)', 'Sim', 60, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'PPD GLOBAL (HIGHLAND HEIGHTS)', 'Sim', 70, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'ICON (FARMINGDALE)', 'Sim', 80, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'CELLCARTA (NAPERVILLE)', 'Sim', 90, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'CENTOGENE (ROSTOCK)', 'Sim', 100, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'FOUNDATION MEDICINE (BOSTON)', 'Sim', 110, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'EUROFINS (LANCASTER)', 'Sim', 120, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'EUROFINS (LEOLA)', 'Sim', 130, 'Laboratório de destino para transporte de amostras'],
    ['Agenda', 'Laboratório destino', 'GBA CENTRAL LAB (SCHWENTINENTAL)', 'Sim', 140, 'Laboratório de destino para transporte de amostras']
  ];
  defaults.forEach(function(row) {
    ensureConfigAppRow_(sh, row);
  });
}

function ensureConfigAppRow_(sh, row) {
  var lastRow = Math.max(sh.getLastRow(), 1);
  var values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 3).getValues() : [];
  var grupo = normText_(row[0]);
  var chave = normText_(row[1]);
  var valor = normText_(row[2]);
  for (var i = 0; i < values.length; i++) {
    if (normText_(values[i][0]) === grupo && normText_(values[i][1]) === chave && normText_(values[i][2]) === valor) return;
  }
  var target = 2;
  var colA = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  colA.forEach(function(r, idx) {
    if (String(r[0] || '').trim()) target = idx + 3;
  });
  sh.getRange(target, 1, 1, 6).setValues([row]);
}

function getConfigAppSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Config_App');
  if (!sh) {
    sh = ss.insertSheet('Config_App');
    var headers = ['Grupo', 'Chave', 'Valor', 'Ativo', 'Ordem', 'Observação'];
    sh.getRange(1, 1, 1, 6).setValues([headers]);
    sh.getRange(1, 8, 1, 6).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function salvarConfigAppItem(payload) {
  payload = payload || {};
  if (!String(payload.grupo || '').trim()) throw new Error('Informe o grupo.');
  if (!String(payload.chave || '').trim()) throw new Error('Informe a chave.');
  if (!String(payload.valor || '').trim()) throw new Error('Informe o valor.');

  var sh = getConfigAppSheet_();
  var rowIndex = parseInt(payload.rowIndex, 10);
  var startCol = parseInt(payload.startCol, 10);
  if (startCol !== 1 && startCol !== 8) startCol = payload.bloco === 'Apoio' ? 8 : 1;
  var row = [
    String(payload.grupo || '').trim(),
    String(payload.chave || '').trim(),
    String(payload.valor || '').trim(),
    String(payload.ativo || 'Sim').trim(),
    payload.ordem !== '' && payload.ordem !== null && payload.ordem !== undefined ? Number(payload.ordem) : '',
    String(payload.observacao || '').trim()
  ];

  if (rowIndex && rowIndex >= 2) {
    sh.getRange(rowIndex, startCol, 1, 6).setValues([row]);
    return 'Configuração atualizada com sucesso.';
  }

  var lastRow = Math.max(sh.getLastRow(), 1);
  var values = sh.getRange(2, startCol, Math.max(1, lastRow - 1), 1).getValues();
  var target = 2;
  values.forEach(function(r, idx) {
    if (String(r[0] || '').trim()) target = idx + 3;
  });
  sh.getRange(target, startCol, 1, 6).setValues([row]);
  return 'Configuração cadastrada com sucesso.';
}

function excluirConfigAppItem(rowIndex, startCol) {
  var sh = getConfigAppSheet_();
  var row = parseInt(rowIndex, 10);
  var col = parseInt(startCol, 10);
  if (col !== 1 && col !== 8) throw new Error('Bloco de configuração inválido.');
  if (!row || row < 2 || row > sh.getLastRow()) throw new Error('Configuração não encontrada.');
  sh.getRange(row, col, 1, 6).clearContent();
  return 'Configuração excluída com sucesso.';
}