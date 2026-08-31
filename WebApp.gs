// ======================================================
// WEBAPP — PONTO DE ENTRADA
// ======================================================
var CODEX_ACL_SHEET_NAME_ = 'Users';
var CODEX_ACL_CACHE_KEY_ = 'UsersAclEmails:v3';
var CODEX_ACL_CACHE_SECONDS_ = 120;
var CODEX_USER_ROLES_ = { admin: true, user: true, readonly: true };
var CODEX_API_TOKEN_REQUEST_ = false;
var CODEX_DOCUMENT_LOCK_REENTRANT_DEPTH_ = 0;
// Atualize versão, rótulo e data a cada entrega do WebApp.
var CODEX_APP_VERSION_ = '2026.07.15-agenda-print-cancelled';
var CODEX_APP_BUILD_LABEL_ = 'Eventos cancelados destacados nos impressos';
var CODEX_APP_BUILD_DATE_ = '2026-07-15';
var CODEX_APP_EXPECTED_EXECUTE_AS_ = 'USER_ACCESSING';

function codexJsonForScript_(value) {
  var json = JSON.stringify(value);
  if (typeof json !== 'string') json = 'null';
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function doGet(e) {
  var access = codexAuthorizeWebAppRequestSafe_(e);
  if (!access.ok) return codexAccessDeniedOutput_(access);

  var page = e && e.parameter ? e.parameter.page : 'index';

  if (page === 'dashboard') {
    var tplDashboard = HtmlService.createTemplateFromFile('Index');
    tplDashboard.includeEstoque = false;
    tplDashboard.includeDashboard = true;
    tplDashboard.paginaInicial = 'dashboard';
    tplDashboard.agendaAbrirInicial = '';
    tplDashboard.buscaInicial = '';
    tplDashboard.dashboardFiltroInicial = '';
    tplDashboard.dashboardFiltroKeys = '';
    return tplDashboard
      .evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('IPS | UCS');
  }

  if (page === 'estoque' || page === 'pedidos' || page === 'estoque-view') {
    var tplEstoque = HtmlService.createTemplateFromFile('Index');
    tplEstoque.includeEstoque = true;
    tplEstoque.includeDashboard = false;
    tplEstoque.paginaInicial = page === 'pedidos'
      ? 'pedidos'
      : (page === 'estoque-view' ? 'visualizacao' : (e && e.parameter ? (e.parameter.pagina || 'itens') : 'itens'));
    tplEstoque.agendaAbrirInicial = '';
    tplEstoque.buscaInicial = e && e.parameter ? (e.parameter.busca || '') : '';
    tplEstoque.dashboardFiltroInicial = '';
    tplEstoque.dashboardFiltroKeys = '';
    return tplEstoque
      .evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('IPS | UCS');
  }

  if (page === 'transporte') {
    var tplTransporte = HtmlService.createTemplateFromFile('TransporteApp');
    tplTransporte.initialTransporteArgs = {
      agendaId: e && e.parameter ? String(e.parameter.agendaId || '') : '',
      slot: e && e.parameter ? String(e.parameter.slot || '') : ''
    };
    return tplTransporte
      .evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('IPS | Transporte de Mat. Biologico');
  }

  // default — página principal
  var tplIndex = HtmlService.createTemplateFromFile('Index');
  tplIndex.includeEstoque = false;
  tplIndex.includeDashboard = false;
  tplIndex.paginaInicial = e && e.parameter ? (e.parameter.pagina || 'agenda') : 'agenda';
  tplIndex.agendaAbrirInicial = e && e.parameter ? String(e.parameter.agendaId || '') : '';
  tplIndex.buscaInicial = '';
  tplIndex.dashboardFiltroInicial = e && e.parameter ? (e.parameter.dashFiltro || '') : '';
  tplIndex.dashboardFiltroKeys = e && e.parameter ? (e.parameter.dashKeys || '') : '';
  return tplIndex
    .evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('IPS | UCS');
}

// Mantida junto à superfície RPC do Web App: alguns deployments legados não
// expõem de forma confiável funções adicionadas ao fim do arquivo extenso.
// A implementação permanece abaixo, ao lado dos helpers de Agenda/SoA.
function consultarJornadaParticipante(payload) {
  return getJornadaParticipante(payload);
}

function consultarConcilicaoVisitasParticipante(payload) {
  return getConcilicaoVisitasParticipante(payload);
}

function salvarConcilicaoVisitasParticipante(payload) {
  codexAssertCanWrite_('salvarConcilicaoVisitasParticipante', 'Agenda', (payload && (payload.idParticipante || payload.nome || payload.projeto)) || '');
  return salvarConcilicaoVisitasParticipante_(payload);
}

function salvarConfiguracaoCtmsParticipante(payload) {
  codexAssertCanWrite_('salvarConfiguracaoCtmsParticipante', 'Cadastros', (payload && (payload.idCadastro || payload.idParticipante || payload.nome)) || '');
  return salvarConfiguracaoCtmsParticipante_(payload);
}

function definirAprovacaoCtmsParticipante(payload) {
  codexAssertCanWrite_('definirAprovacaoCtmsParticipante', 'Cadastros', (payload && (payload.idCadastro || payload.idParticipante || payload.nome)) || '');
  return definirAprovacaoCtmsParticipante_(payload);
}


// Retorna a URL base do webapp (usada para navegação entre páginas)
function doPost(e) {
  var access = codexAuthorizeWebAppRequestSafe_(e);
  if (!access.ok) {
    return codexJsonResponse_({
      ok: false,
      error: access.message || 'Acesso negado.',
      userEmail: access.userEmail || ''
    }, 403);
  }

  var action = e && e.parameter ? String(e.parameter.action || '') : '';
  var payload = {};
  try {
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return codexJsonResponse_({ ok: false, error: 'JSON invalido: ' + err.message }, 400);
  }

  try {
    if (action === 'importarCodex') {
      if (typeof importarTransporteCodex !== 'function') {
        throw new Error('Funcao importarTransporteCodex nao encontrada.');
      }
      CODEX_API_TOKEN_REQUEST_ = access.userEmail === 'api-token';
      try {
        return codexJsonResponse_({ ok: true, data: importarTransporteCodex(payload) });
      } finally {
        CODEX_API_TOKEN_REQUEST_ = false;
      }
    }

    if (action === 'ping') {
      return codexJsonResponse_({ ok: true, data: 'pong' });
    }

    return codexJsonResponse_({ ok: false, error: 'Acao POST nao suportada: ' + action }, 404);
  } catch (err2) {
    return codexJsonResponse_({ ok: false, error: err2.message || String(err2) }, 500);
  }
}

function codexAuthorizeWebAppRequestSafe_(e) {
  try {
    return codexAuthorizeWebAppRequest_(e);
  } catch (err) {
    return {
      ok: false,
      userEmail: codexNormalizeEmail_(codexGetActiveUserEmail_()),
      role: '',
      message: 'Nao foi possivel validar seu acesso. Se o WebApp estiver publicado como "usuario acessando", confirme que sua conta tem acesso a planilha principal do sistema e tente novamente. Detalhe: ' + (err.message || String(err))
    };
  }
}

function codexJsonResponse_(body, statusCode) {
  body = body || {};
  if (statusCode) body.statusCode = statusCode;
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

var AGENDA_WINDOWED_LOADING_V2 = false;

function agendaWindowedLoadingV2GlobalEnabled_() {
  var configured = '';
  try {
    configured = PropertiesService.getScriptProperties().getProperty('AGENDA_WINDOWED_LOADING_V2');
  } catch (e) {
    configured = '';
  }
  if (configured === null || String(configured).trim() === '') return AGENDA_WINDOWED_LOADING_V2 === true;
  return String(configured).trim().toLowerCase() === 'true';
}

function ativarAgendaWindowedLoadingV2Admin() {
  codexAssertAdmin_();
  PropertiesService.getScriptProperties().setProperty('AGENDA_WINDOWED_LOADING_V2', 'true');
  Logger.log('[CODEX_AGENDA_CANARY] ' + JSON.stringify({ operation: 'activate', success: true, adminOnly: true }));
  return { globalEnabled: true, adminOnly: true };
}

function desativarAgendaWindowedLoadingV2Admin() {
  codexAssertAdmin_();
  PropertiesService.getScriptProperties().setProperty('AGENDA_WINDOWED_LOADING_V2', 'false');
  Logger.log('[CODEX_AGENDA_CANARY] ' + JSON.stringify({ operation: 'deactivate', success: true, adminOnly: true }));
  return { globalEnabled: false, adminOnly: true };
}

function agendaWindowedLoadingV2EnabledForAccess_(access) {
  return agendaWindowedLoadingV2GlobalEnabled_() && !!access && access.ok === true && access.role === 'admin';
}

function agendaWindowFallbackLog(code) {
  var access = codexGetCurrentUserAccess();
  if (!access || !access.ok) throw new Error((access && access.message) || 'Acesso negado.');
  var allowed = {
    reference_incomplete: true,
    invalid_payload: true,
    rpc_failure: true,
    range_mismatch: true,
    truncated: true
  };
  code = String(code || '').trim();
  if (!allowed[code]) code = 'invalid_payload';
  Logger.log('[CODEX_AGENDA_FALLBACK] ' + JSON.stringify({ code: code }));
  return true;
}

function getAppBootstrapData() {
  var access = codexGetCurrentUserAccess();
  var agendaWindowedLoadingEnabled = agendaWindowedLoadingV2EnabledForAccess_(access);
  var out = {
    access: access,
    auth: codexGetUserOAuthStatus_(),
    appVersion: codexGetAppVersion_(),
    webAppUrl: '',
    agendaFormData: null,
    teamBirthdays: [],
    errors: {}
  };
  if (agendaWindowedLoadingEnabled) {
    out.features = { agendaWindowedLoadingV2: true };
  }
  try {
    out.webAppUrl = ScriptApp.getService().getUrl();
  } catch (e1) {
    out.errors.webAppUrl = e1.message || String(e1);
  }
  if (!agendaWindowedLoadingEnabled) {
    try {
      out.agendaFormData = getDadosFormularioAgenda(true);
    } catch (e2) {
      out.errors.agendaFormData = e2.message || String(e2);
    }
  }
  try {
    if (out.access && out.access.ok) out.teamBirthdays = codexGetTeamBirthdays_();
  } catch (e3) {
    out.errors.teamBirthdays = e3.message || String(e3);
  }
  return out;
}

function codexGetAppVersion_() {
  return {
    version: CODEX_APP_VERSION_,
    label: CODEX_APP_BUILD_LABEL_,
    buildDate: CODEX_APP_BUILD_DATE_,
    expectedExecuteAs: CODEX_APP_EXPECTED_EXECUTE_AS_
  };
}

function getAppRuntimeInfo() {
  return {
    appVersion: codexGetAppVersion_(),
    checkedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')
  };
}

function getConfigBootstrapData() {
  return {
    access: codexGetCurrentUserAccess(),
    config: getConfigApp()
  };
}

function getCadastrosBootstrapData(page) {
  page = String(page || '').trim().toLowerCase();
  var out = {
    access: codexGetCurrentUserAccess(),
    page: page,
    data: null,
    config: null
  };
  if (page === 'participantes') {
    out.config = getParticipanteFormConfig();
    out.data = getParticipantes();
    out.projetos = getProjetosParticipantesOptions_();
  } else if (page === 'projetos') {
    out.config = getProjetoFormConfig();
    out.data = getProjetos();
    out.medicos = getMedicos();
    out.solicitantes = getSolicitantes();
    out.couriers = getAgendaCourierRows_();
    out.temperaturas = getAgendaTemperaturas_();
  } else if (page === 'monitores') {
    out.data = getMonitores();
    out.projetos = getProjetosMonitoria_();
  } else if (page === 'equipamentos') {
    out.data = getEquipamentosFornecidos();
  } else if (page === 'medicamentos') {
    out.data = getMedicamentosRecebidos();
  } else if (page === 'medicos') {
    out.config = getMedicoFormConfig();
    out.data = getMedicos();
  } else if (page === 'solicitantes') {
    out.data = getSolicitantes();
  } else if (page === 'prestadores') {
    out.config = {
      tiposServico: getPrestadorTipoServicoOptions_()
    };
    out.data = getPrestadores();
  } else if (page === 'labcentral') {
    out.data = getLabCentral();
  } else if (page === 'couriers') {
    out.config = {
      statusCourier: getAgendaCourierStatuses_()
    };
    out.data = getCouriersCadastro();
  } else if (page === 'feriados') {
    out.data = getFeriadosCadastro_();
  } else {
    throw new Error('Bootstrap de cadastro nao suportado: ' + page);
  }
  return out;
}

function getEstoqueBootstrapData(page) {
  page = String(page || 'itens').trim().toLowerCase();
  var out = {
    access: codexGetCurrentUserAccess(),
    page: page,
    config: getEstoqueConfig(),
    data: null
  };
  if (page === 'pedidos') out.data = getPedidosEstoque();
  else if (page === 'itens') out.data = getItensEstoque();
  else if (page === 'descartes') out.data = getDescartesEstoque();
  else if (page === 'movimentacoes') out.data = getMovimentacoesEstoque();
  else if (page === 'relatorios') out.data = getEstoque();
  else if (page === 'estoque-view') {
    out.data = getEstoqueVisualizacao();
    out.alertas = montarAlertasEstoque_(out.data, null, getKitsBaixadosSemConciliacao_());
    out.piloto = getEstoquePilotoData_();
    out.participantes = getParticipantes().map(function(participante) {
      return {
        id: participante.id,
        nome: participante.nome,
        idParticipante: participante.idParticipante,
        projeto: participante.projeto,
        status: participante.status
      };
    });
  }
  else throw new Error('Bootstrap de estoque nao suportado: ' + page);
  return out;
}

function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    throw new Error('Falha ao incluir arquivo HTML "' + filename + '": ' + (err.message || String(err)));
  }
}

function codexLoggerSummary_(label, payload) {
  payload = payload || {};
  var parts = [String(label || 'Log')];
  ['ok', 'mensagem', 'apiKeyConfigurada'].forEach(function(key) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
      parts.push(key + '=' + payload[key]);
    }
  });
  ['pendentes', 'entregues', 'erros', 'regras', 'buscas'].forEach(function(key) {
    if (Array.isArray(payload[key])) parts.push(key + '=' + payload[key].length);
  });
  Logger.log(parts.join(' | '));
}

function codexAuthorizeWebAppRequest_(e) {
  if (e && e.parameter && codexIsValidWebAppApiToken_(e.parameter.token)) {
    return { ok: true, userEmail: 'api-token', name: 'API', firstName: 'API', role: 'admin', message: '' };
  }

  var userEmail = codexNormalizeEmail_(codexGetActiveUserEmail_());
  if (!userEmail) {
    return {
      ok: false,
      userEmail: '',
      message: 'Nao foi possivel identificar seu e-mail. Acesse com uma conta institucional autorizada.',
      debugAuth: codexShouldShowAuthDebug_(e) ? codexGetIdentityDiagnostics_() : null,
      authUrl: codexGetIdentityAuthorizationUrl_()
    };
  }

  var users = codexGetAllowedUsers_();
  if (!Object.keys(users).length) {
    return {
      ok: false,
      userEmail: userEmail,
      message: 'Lista de usuarios autorizados nao configurada.'
    };
  }

  var user = users[userEmail];
  if (!user) {
    return {
      ok: false,
      userEmail: userEmail,
      role: '',
      message: 'Seu e-mail nao esta autorizado neste sistema.'
    };
  }

  if (!user.active) {
    return {
      ok: false,
      userEmail: userEmail,
      name: user.name || '',
      firstName: codexFirstName_(user.name, userEmail),
      birthday: user.birthday || '',
      role: user.role,
      message: 'Seu usuario esta inativo neste sistema.'
    };
  }

  return {
    ok: true,
    userEmail: userEmail,
    name: user.name || '',
    firstName: codexFirstName_(user.name, userEmail),
    birthday: user.birthday || '',
    formacao: user.formacao || '',
    registroProfissional: user.registroProfissional || '',
    podeSolicitarExames: user.podeSolicitarExames || 'Sim',
    role: user.role,
    message: ''
  };
}

function codexGetActiveUserEmail_() {
  try {
    var active = Session.getActiveUser().getEmail();
    if (active) return active;
  } catch (e) {}
  try {
    var effective = Session.getEffectiveUser().getEmail();
    if (effective) return effective;
  } catch (e2) {}
  try {
    var response = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      var info = JSON.parse(response.getContentText() || '{}');
      if (info && info.email) return info.email;
    }
  } catch (e3) {}
  return '';
}

function codexShouldShowAuthDebug_(e) {
  return !!(e && e.parameter && String(e.parameter.debugAuth || '') === '1');
}

function codexGetIdentityDiagnostics_() {
  var out = {
    activeUserEmail: '',
    activeUserError: '',
    effectiveUserEmail: '',
    effectiveUserError: '',
    userinfoEmail: '',
    userinfoStatus: '',
    userinfoError: '',
    deploymentHint: 'USER_ACCESSING esperado'
  };
  try {
    out.activeUserEmail = String(Session.getActiveUser().getEmail() || '');
  } catch (e1) {
    out.activeUserError = e1.message || String(e1);
  }
  try {
    out.effectiveUserEmail = String(Session.getEffectiveUser().getEmail() || '');
  } catch (e2) {
    out.effectiveUserError = e2.message || String(e2);
  }
  try {
    var response = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    out.userinfoStatus = String(response.getResponseCode());
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      var info = JSON.parse(response.getContentText() || '{}');
      out.userinfoEmail = String((info && info.email) || '');
    } else {
      out.userinfoError = String(response.getContentText() || '').slice(0, 300);
    }
  } catch (e3) {
    out.userinfoError = e3.message || String(e3);
  }
  return out;
}

function codexGetIdentityAuthorizationUrl_() {
  try {
    var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, [
      'https://www.googleapis.com/auth/userinfo.email'
    ]);
    if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
      return info.getAuthorizationUrl();
    }
  } catch (e) {}
  return '';
}

function codexNormalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function codexNormalizeRole_(role) {
  role = String(role || '').trim().toLowerCase();
  return CODEX_USER_ROLES_[role] ? role : 'user';
}

function codexNormalizeUserName_(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function codexNormalizeBirthday_(value) {
  if (value === null || value === undefined || value === '') return '';
  var month = 0;
  var day = 0;
  var isDate = Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
  if (isDate) {
    var dateParts = '';
    try {
      dateParts = Utilities.formatDate(value, Session.getScriptTimeZone(), 'MM-dd');
    } catch (e) {
      dateParts = ('0' + (value.getMonth() + 1)).slice(-2) + '-' + ('0' + value.getDate()).slice(-2);
    }
    var legacyDateMatch = dateParts.match(/^(\d{2})-(\d{2})$/);
    month = legacyDateMatch ? Number(legacyDateMatch[1]) : 0;
    day = legacyDateMatch ? Number(legacyDateMatch[2]) : 0;
  } else if (value && typeof value === 'object') {
    month = Number(value.month || value.mes || 0);
    day = Number(value.day || value.dia || 0);
    if (!month && !day) return '';
  } else {
    var raw = String(value || '').trim();
    var isoMatch = raw.match(/^(\d{1,2})-(\d{1,2})$/);
    var brMatch = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (isoMatch) {
      month = Number(isoMatch[1]);
      day = Number(isoMatch[2]);
    } else if (brMatch) {
      day = Number(brMatch[1]);
      month = Number(brMatch[2]);
    }
  }
  var maxDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!month || !day || month < 1 || month > 12 || day < 1 || day > maxDays[month - 1]) {
    throw new Error('Informe um aniversário válido.');
  }
  return ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
}

function codexBirthdayParts_(value) {
  var normalized = '';
  try { normalized = codexNormalizeBirthday_(value); } catch (e) { normalized = ''; }
  if (!normalized) return { birthday: '', birthdayMonth: '', birthdayDay: '', birthdayLabel: '' };
  var parts = normalized.split('-');
  var month = Number(parts[0]);
  var day = Number(parts[1]);
  return {
    birthday: normalized,
    birthdayMonth: month,
    birthdayDay: day,
    birthdayLabel: ('0' + day).slice(-2) + '/' + ('0' + month).slice(-2)
  };
}

function codexEnsureUsersProfileColumns_(sheet) {
  if (!sheet) throw new Error('Aba Users não encontrada.');
  var specs = [
    { column: 5, letter: 'E', header: 'Aniversário (MM-DD)', aliases: ['anivers', 'birthday'] },
    { column: 6, letter: 'F', header: 'Formação', aliases: ['formacao', 'formação'] },
    { column: 7, letter: 'G', header: 'Registro no Conselho Profissional', aliases: ['registro no conselho', 'registro profissional'] },
    { column: 8, letter: 'H', header: 'Pode solicitar exames', aliases: ['pode solicitar exames', 'solicitar exames'] }
  ];
  var missing = [];
  specs.forEach(function(spec) {
    var current = String(sheet.getRange(1, spec.column).getValue() || '').trim();
    if (!current) {
      missing.push(spec);
      return;
    }
    var normalized = codexNormalizeTextForSort_(current);
    var matches = spec.aliases.some(function(alias) {
      return normalized.indexOf(codexNormalizeTextForSort_(alias)) !== -1;
    });
    if (!matches) {
      throw new Error('A coluna ' + spec.letter + ' da aba Users já está em uso. Reserve-a para ' + spec.header + ' antes de salvar perfis.');
    }
  });
  missing.forEach(function(spec) {
    sheet.getRange(1, spec.column).setValue(spec.header);
  });
}

function codexSetUserBirthdaysAsText_(sheet, startRow, birthdays) {
  birthdays = Array.isArray(birthdays) ? birthdays : [];
  if (!sheet || !birthdays.length) return;
  var range = sheet.getRange(startRow, 5, birthdays.length, 1);
  range.setNumberFormat('@');
  range.setValues(birthdays.map(function(value) {
    return [String(value || '')];
  }));
}

function codexNormalizeTextForSort_(value) {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function codexFirstName_(name, email) {
  name = codexNormalizeUserName_(name);
  if (name) return name.split(' ')[0];
  email = codexNormalizeEmail_(email);
  return email ? email.split('@')[0].split(/[._-]/)[0] : '';
}

function codexNormalizeActive_(value) {
  var raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return true;
  var normalized = raw.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return ['nao', 'não', 'no', 'false', '0', 'inativo', 'inactive'].indexOf(normalized) === -1;
}

function codexGetCurrentUserAccess() {
  var access = codexAuthorizeWebAppRequestSafe_();
  var birthday = codexBirthdayParts_(access.birthday || '');
  return {
    ok: !!access.ok,
    email: access.userEmail || '',
    name: access.name || '',
    firstName: access.firstName || codexFirstName_(access.name, access.userEmail),
    birthday: birthday.birthday,
    birthdayMonth: birthday.birthdayMonth,
    birthdayDay: birthday.birthdayDay,
    formacao: access.formacao || '',
    registroProfissional: access.registroProfissional || '',
    podeSolicitarExames: access.podeSolicitarExames || 'Sim',
    role: access.role || '',
    canWrite: !!access.ok && access.role !== 'readonly',
    message: access.message || ''
  };
}

function codexAssertCanWrite_(actionName, moduleName, recordId) {
  if (CODEX_API_TOKEN_REQUEST_) {
    return { ok: true, userEmail: 'api-token', name: 'API', firstName: 'API', role: 'admin' };
  }
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  if (access.role === 'readonly') {
    codexWriteAuditLog_('ACESSO_NEGADO_READONLY', moduleName || codexInferAuditModule_(actionName || 'readonly'), recordId || '');
    throw new Error('Seu perfil e somente leitura. Esta acao nao esta autorizada.');
  }
  actionName = actionName || codexGetCallerFunctionName_();
  codexWriteAuditLog_(actionName, moduleName || codexInferAuditModule_(actionName), recordId || '');
  return access;
}

function codexAssertAdmin_() {
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  if (access.role !== 'admin') throw new Error('Acesso permitido apenas para administradores.');
  return access;
}

function codexNormalizeCanRequestExams_(value) {
  return codexNormalizeActive_(value) ? 'Sim' : 'Não';
}

function codexUserProfileFormations_() {
  return getConfigAppValuesByKeys_(['Profissionais', 'Usuários', 'Usuarios', 'Solicitantes'], ['Formação', 'Formacao'], []);
}

function codexNormalizeUserFormation_(value) {
  var formation = String(value || '').replace(/\s+/g, ' ').trim();
  if (!formation) return '';
  if (codexUserProfileFormations_().indexOf(formation) === -1) {
    throw new Error('Selecione uma formação ativa cadastrada no ConfigApp.');
  }
  return formation;
}

function codexNormalizeProfessionalRegistration_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function codexIsInstalledTriggerInvocation_(event, handlerName) {
  var triggerUid = event && event.triggerUid ? String(event.triggerUid) : '';
  if (!triggerUid || !handlerName) return false;
  try {
    return ScriptApp.getProjectTriggers().some(function(trigger) {
      var uid = trigger.getUniqueId ? String(trigger.getUniqueId() || '') : '';
      var handler = trigger.getHandlerFunction ? String(trigger.getHandlerFunction() || '') : '';
      return uid === triggerUid && handler === handlerName;
    });
  } catch (e) {
    return false;
  }
}

function codexAssertAdminOrInstalledTrigger_(event, handlerName) {
  if (codexIsInstalledTriggerInvocation_(event, handlerName)) {
    return { ok: true, userEmail: 'installed-trigger', role: 'admin', trigger: true };
  }
  return codexAssertAdmin_();
}

function codexGetCallerFunctionName_() {
  try {
    var stack = String((new Error()).stack || '');
    var lines = stack.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '');
      if (line.indexOf('codexAssertCanWrite_') !== -1 && lines[i + 1]) {
        var next = String(lines[i + 1]).trim();
        var match = next.match(/^at\s+([^\s(]+)/);
        return match ? match[1] : next;
      }
    }
  } catch (e) {}
  return 'ACAO_PROTEGIDA';
}

function codexWithDocumentLock_(label, fn) {
  // Cross-request concurrency is handled by LockService. This depth is only a
  // same-execution reentrancy guard for nested writes that already hold the lock.
  if (CODEX_DOCUMENT_LOCK_REENTRANT_DEPTH_ > 0) return fn();
  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(30000);
    if (!acquired) {
      throw new Error('Outra operação está gravando no sistema. Aguarde alguns segundos e tente novamente.');
    }
    CODEX_DOCUMENT_LOCK_REENTRANT_DEPTH_++;
    return fn();
  } finally {
    if (acquired) CODEX_DOCUMENT_LOCK_REENTRANT_DEPTH_ = Math.max(0, CODEX_DOCUMENT_LOCK_REENTRANT_DEPTH_ - 1);
    if (acquired) lock.releaseLock();
  }
}

function codexIsDocumentLockBusyError_(error) {
  return String(error && error.message || error || '').indexOf('Outra operação está gravando no sistema') !== -1;
}

function codexNormalizeRecordValueForVersion_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (value === null || typeof value === 'undefined') return '';
  return String(value);
}

function codexRecordVersionFromValues_(values) {
  var normalized = (values || []).map(codexNormalizeRecordValueForVersion_);
  var text = JSON.stringify(normalized);
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36) + '-' + text.length.toString(36);
}

function agendaRecordVersionFromRow_(row) {
  return codexRecordVersionFromValues_(row || []);
}

function agendaCanonicalJsonForVersion_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  function sortValue(current) {
    if (Array.isArray(current)) return current.map(sortValue);
    if (!current || typeof current !== 'object') return current;
    var sorted = {};
    Object.keys(current).sort().forEach(function(key) {
      sorted[key] = sortValue(current[key]);
    });
    return sorted;
  }
  try {
    return JSON.stringify(sortValue(JSON.parse(text)));
  } catch (e) {
    return text;
  }
}

function agendaEditableRecordVersionValuesFromRow_(row) {
  row = row || [];
  var i = AGENDA_CFG.idx;
  function text(idx) {
    return idx >= 0 ? String(row[idx] == null ? '' : row[idx]).trim() : '';
  }
  function date(idx) {
    return formatarDataIsoAgenda_(row[idx]) || text(idx);
  }
  function courier(cfg) {
    return [
      text(cfg.nome), text(cfg.temp), text(cfg.status), text(cfg.awb),
      text(cfg.material), text(cfg.destino), agendaCanonicalJsonForVersion_(row[cfg.matBio])
    ];
  }
  return [
    text(i.id), date(i.data), formatarHoraSafe_(row[i.hora]), text(i.tipo), text(i.status),
    text(i.participante), date(i.nasc), text(i.idParticipante), text(i.projeto), text(i.braco),
    text(i.visita), text(i.medico), text(i.procedimentos), text(i.servTerc), text(i.obs),
    text(i.labCentral), text(i.kit)
  ].concat(
    courier(i.c1), courier(i.c2), courier(i.c3), courier(i.cb),
    [
      text(i.monitorName), row[i.poloTrial] ? '1' : '', row[i.ecrf] ? '1' : '',
      text(i.salaMonitoria), agendaBooleanValue_(row[i.carroRequerido]) ? '1' : '',
      text(i.backupAgendaRef)
    ]
  );
}

function agendaEditableRecordVersionFromRow_(row) {
  return codexRecordVersionFromValues_(agendaEditableRecordVersionValuesFromRow_(row));
}

function codexGetEditPresenceSheet_() {
  var ss = getCodexSpreadsheet_();
  var name = 'Edit_Presence';
  var headers = ['Module', 'Record ID', 'User Email', 'User Name', 'Session ID', 'Opened At', 'Expires At', 'Version'];
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function codexCleanupEditPresence_(sh, now) {
  now = now || new Date();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var vals = sh.getRange(2, 1, lastRow - 1, 8).getValues();
  var active = vals.filter(function(row) {
    var expiresAt = row[6];
    var expired = expiresAt instanceof Date ? expiresAt.getTime() < now.getTime() : true;
    return !expired;
  });
  if (active.length !== vals.length) {
    codexReplaceEditPresenceRows_(sh, active, lastRow);
  }
  return active;
}

function codexReplaceEditPresenceRows_(sh, rows, lastRow) {
  rows = rows || [];
  lastRow = Number(lastRow || sh.getLastRow());
  if (lastRow >= 2) sh.getRange(2, 1, lastRow - 1, 8).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 8).setValues(rows);
}

function codexGetRecordVersion_(moduleName, recordId) {
  moduleName = String(moduleName || '').trim();
  recordId = String(recordId || '').trim();
  if (!recordId) return '';
  if (normText_(moduleName) === 'agenda') {
    var agenda = getAgendaSheetForRead_();
    var linha = encontrarLinhaPorId(agenda, recordId);
    if (!linha) return '';
    var row = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
    return agendaRecordVersionFromRow_(row);
  }
  return '';
}

function codexOpenEditPresence(moduleName, recordId, sessionId) {
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  moduleName = String(moduleName || '').trim();
  recordId = String(recordId || '').trim();
  sessionId = String(sessionId || '').trim();
  if (!moduleName || !recordId || !sessionId) return { editors: [], version: '' };
  try {
    return codexWithDocumentLock_('codexOpenEditPresence', function() {
    var sh = codexGetEditPresenceSheet_();
    var now = new Date();
    var ttlSeconds = 6 * 60;
    var expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    var vals = codexCleanupEditPresence_(sh, now);
    var version = codexGetRecordVersion_(moduleName, recordId);
    var editVersion = '';
    if (normText_(moduleName) === 'agenda') {
      var agenda = getAgendaSheetForRead_();
      var linhaAgenda = encontrarLinhaPorId(agenda, recordId);
      if (linhaAgenda) {
        editVersion = agendaEditableRecordVersionFromRow_(agenda.getRange(linhaAgenda, 1, 1, AGENDA_CFG.lastCol).getValues()[0]);
      }
    }
    var email = codexNormalizeEmail_(access.userEmail || access.email || codexGetActiveUserEmail_()) || 'usuario';
    var name = access.name || access.firstName || email;
    var targetRow = 0;
    var editors = [];
    vals.forEach(function(r, idx) {
      var sameRecord = String(r[0] || '') === moduleName && String(r[1] || '') === recordId;
      if (!sameRecord) return;
      var sameSession = codexNormalizeEmail_(r[2]) === email && String(r[4] || '') === sessionId;
      if (sameSession) {
        targetRow = idx + 2;
        return;
      }
      if (codexNormalizeEmail_(r[2]) !== email) {
        editors.push({
          email: String(r[2] || ''),
          name: String(r[3] || ''),
          sessionId: String(r[4] || ''),
          openedAt: r[5] instanceof Date ? Utilities.formatDate(r[5], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : String(r[5] || ''),
          expiresAt: r[6] instanceof Date ? Utilities.formatDate(r[6], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') : String(r[6] || ''),
          version: String(r[7] || '')
        });
      }
    });
    var row = [moduleName, recordId, email, name, sessionId, now, expiresAt, version];
    if (targetRow) sh.getRange(targetRow, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return { ok: true, module: moduleName, recordId: recordId, sessionId: sessionId, version: version, editVersion: editVersion, editors: editors, ttlSeconds: ttlSeconds };
    });
  } catch (e) {
    if (codexIsDocumentLockBusyError_(e)) {
      return { ok: false, lockBusy: true, editors: [], version: '', message: e.message || String(e) };
    }
    throw e;
  }
}

function codexReleaseEditPresence(moduleName, recordId, sessionId) {
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) return { ok: false };
  moduleName = String(moduleName || '').trim();
  recordId = String(recordId || '').trim();
  sessionId = String(sessionId || '').trim();
  if (!moduleName || !recordId || !sessionId) return { ok: true };
  return codexWithDocumentLock_('codexReleaseEditPresence', function() {
    var sh = codexGetEditPresenceSheet_();
    var vals = codexCleanupEditPresence_(sh, new Date());
    var email = codexNormalizeEmail_(access.userEmail || access.email || codexGetActiveUserEmail_()) || 'usuario';
    var remaining = vals.filter(function(r) {
      return !(String(r[0] || '') === moduleName &&
          String(r[1] || '') === recordId &&
          codexNormalizeEmail_(r[2]) === email &&
          String(r[4] || '') === sessionId);
    });
    if (remaining.length !== vals.length) {
      codexReplaceEditPresenceRows_(sh, remaining);
    }
    return { ok: true };
  });
}

function codexInferAuditModule_(action) {
  var a = String(action || codexGetCallerFunctionName_() || '').toLowerCase();
  if (a.indexOf('agenda') !== -1 || a.indexOf('evento') !== -1 || a.indexOf('requisicao') !== -1) return 'Agenda';
  if (a.indexOf('estoque') !== -1 || a.indexOf('pedido') !== -1 || a.indexOf('movimentacao') !== -1 || a.indexOf('descarte') !== -1) return 'Estoque';
  if (a.indexOf('transporte') !== -1 || a.indexOf('pdftransporte') !== -1) return 'Transporte';
  if (a.indexOf('config') !== -1 || a.indexOf('labcentral') !== -1 || a.indexOf('courier') !== -1) return 'Sistema';
  if (a.indexOf('medico') !== -1 || a.indexOf('solicitante') !== -1 || a.indexOf('participante') !== -1 || a.indexOf('projeto') !== -1 || a.indexOf('prestador') !== -1 || a.indexOf('equipamento') !== -1 || a.indexOf('medicamento') !== -1) return 'Cadastros';
  return 'Sistema';
}

function codexWriteAuditLog_(action, moduleName, recordId) {
  try {
    var ss = getCodexSpreadsheet_();
    var sh = ss.getSheetByName('Audit_Log');
    if (!sh) return;
    var userEmail = codexNormalizeEmail_(codexGetActiveUserEmail_()) || 'api-token';
    sh.appendRow([
      codexGenerateAuditId_(),
      userEmail,
      String(action || 'ACAO_PROTEGIDA'),
      new Date(),
      String(moduleName || 'Sistema'),
      String(recordId || '')
    ]);
  } catch (e) {}
}

function codexGetAuditChangesSheet_() {
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName('Audit_Changes');
  var headers = ['Audit ID', 'Timestamp', 'User Email', 'Módulo', 'Ação', 'Record ID', 'Campo', 'Valor anterior', 'Valor novo', 'Motivo/observação'];
  if (!sh) {
    sh = ss.insertSheet('Audit_Changes');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function codexAuditValue_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function codexWriteAuditChanges_(moduleName, action, recordId, changes, note) {
  try {
    changes = (changes || []).filter(function(c) {
      return c && codexAuditValue_(c.oldValue) !== codexAuditValue_(c.newValue);
    });
    if (!changes.length) return;
    var sh = codexGetAuditChangesSheet_();
    var now = new Date();
    var userEmail = codexNormalizeEmail_(codexGetActiveUserEmail_()) || 'api-token';
    var rows = changes.map(function(c) {
      return [
        codexGenerateAuditId_(),
        now,
        userEmail,
        String(moduleName || 'Sistema'),
        String(action || 'ACAO_PROTEGIDA'),
        String(recordId || ''),
        String(c.field || ''),
        codexAuditValue_(c.oldValue),
        codexAuditValue_(c.newValue),
        String(note || c.note || '')
      ];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } catch (e) {}
}

function codexGenerateAuditId_() {
  return 'AUD-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 9000 + 1000);
}

function codexNormalizeAuditFilterText_(value) {
  return codexNormalizeTextForSort_(value);
}

function codexParseAuditFilterDate_(value, endOfDay) {
  value = String(value || '').trim();
  if (!value) return null;
  var m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (endOfDay) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  }
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function codexHasAuditFilters_(filters) {
  filters = filters || {};
  return !!(
    String(filters.user || '').trim() ||
    String(filters.startDate || '').trim() ||
    String(filters.endDate || '').trim() ||
    String(filters.action || '').trim()
  );
}

function codexAuditRowDate_(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function codexAuditRowMatchesFilters_(row, filters, indexes) {
  filters = filters || {};
  indexes = indexes || {};
  var user = codexNormalizeAuditFilterText_(filters.user);
  var action = codexNormalizeAuditFilterText_(filters.action);
  if (user && codexNormalizeAuditFilterText_(row[indexes.userCol] || '').indexOf(user) === -1) return false;
  if (action && codexNormalizeAuditFilterText_(row[indexes.actionCol] || '').indexOf(action) === -1) return false;
  var startDate = codexParseAuditFilterDate_(filters.startDate, false);
  var endDate = codexParseAuditFilterDate_(filters.endDate, true);
  if (startDate || endDate) {
    var rowDate = codexAuditRowDate_(row[indexes.dateCol]);
    if (!rowDate) return false;
    if (startDate && rowDate.getTime() < startDate.getTime()) return false;
    if (endDate && rowDate.getTime() > endDate.getTime()) return false;
  }
  return true;
}

function getAuditRowsPage_(sheetName, colCount, limit, offset, mapper, filters, indexes) {
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) {
    return { rows: [], total: 0, limit: Math.max(1, Math.min(Number(limit || 100), 500)), offset: 0, hasMore: false };
  }
  limit = Math.max(1, Math.min(Number(limit || 100), 500));
  offset = Math.max(0, Number(offset || 0));
  var lastRow = sh.getLastRow();
  var total = lastRow - 1;
  if (codexHasAuditFilters_(filters)) {
    var allRows = sh.getRange(2, 1, total, colCount).getValues();
    allRows.reverse();
    allRows = allRows.filter(function(row) {
      return codexAuditRowMatchesFilters_(row, filters, indexes);
    });
    var users = {};
    var modules = {};
    allRows.forEach(function(row) {
      var user = String(row[indexes.userCol] || '');
      var moduleName = String(row[indexes.moduleCol] || '');
      if (user) users[user] = true;
      if (moduleName) modules[moduleName] = true;
    });
    total = allRows.length;
    var pageRows = allRows.slice(offset, offset + limit).map(mapper);
    return {
      rows: pageRows,
      total: total,
      limit: limit,
      offset: offset,
      hasMore: offset + pageRows.length < total,
      userCount: Object.keys(users).length,
      moduleCount: Object.keys(modules).length
    };
  }
  var endRow = lastRow - offset;
  if (endRow < 2) {
    return { rows: [], total: total, limit: limit, offset: offset, hasMore: false };
  }
  var startRow = Math.max(2, endRow - limit + 1);
  var rows = sh.getRange(startRow, 1, endRow - startRow + 1, colCount).getValues();
  rows.reverse();
  rows = rows.map(mapper);
  return {
    rows: rows,
    total: total,
    limit: limit,
    offset: offset,
    hasMore: offset + rows.length < total
  };
}

function codexAssertSelfProfileWrite_() {
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  codexWriteAuditLog_('salvarMeuPerfil', 'Sistema', access.userEmail || '');
  return access;
}

function getAuditLog(limit) {
  return getAuditLogPage(limit, 0).rows;
}

function getAuditLogPage(limit, offset, filters) {
  codexAssertAdmin_();
  return getAuditRowsPage_('Audit_Log', 6, limit, offset, function(r) {
    return {
      id: String(r[0] || ''),
      email: String(r[1] || ''),
      action: String(r[2] || ''),
      timestamp: r[3] instanceof Date ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss') : String(r[3] || ''),
      module: String(r[4] || ''),
      recordId: String(r[5] || '')
    };
  }, filters, { userCol: 1, actionCol: 2, dateCol: 3, moduleCol: 4 });
}

function getAuditChanges(limit) {
  return getAuditChangesPage(limit, 0).rows;
}

function getAuditChangesPage(limit, offset, filters) {
  codexAssertAdmin_();
  return getAuditRowsPage_('Audit_Changes', 10, limit, offset, function(r) {
    return {
      id: String(r[0] || ''),
      timestamp: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss') : String(r[1] || ''),
      email: String(r[2] || ''),
      module: String(r[3] || ''),
      action: String(r[4] || ''),
      recordId: String(r[5] || ''),
      field: String(r[6] || ''),
      oldValue: String(r[7] || ''),
      newValue: String(r[8] || ''),
      note: String(r[9] || '')
    };
  }, filters, { userCol: 2, actionCol: 4, dateCol: 1, moduleCol: 3 });
}

function getAuditPage(type, limit, offset, filters) {
  type = String(type || 'log') === 'changes' ? 'changes' : 'log';
  var page = type === 'changes' ? getAuditChangesPage(limit, offset, filters) : getAuditLogPage(limit, offset, filters);
  page.type = type;
  return page;
}

function getAuditData(limit) {
  codexAssertAdmin_();
  return {
    log: getAuditLog(limit),
    changes: getAuditChanges(limit)
  };
}

function codexGetTeamBirthdays_() {
  var users = codexGetAllowedUsers_();
  return Object.keys(users || {}).map(function(email) {
    var user = users[email] || {};
    var birthday = codexBirthdayParts_(user.birthday || '');
    if (!user.active || !birthday.birthday || !user.name) return null;
    return {
      name: user.name,
      firstName: user.firstName || codexFirstName_(user.name, email),
      birthday: birthday.birthday,
      month: birthday.birthdayMonth,
      day: birthday.birthdayDay
    };
  }).filter(Boolean).sort(function(a, b) {
    if (a.birthday !== b.birthday) return a.birthday < b.birthday ? -1 : 1;
    return codexNormalizeTextForSort_(a.name).localeCompare(codexNormalizeTextForSort_(b.name));
  });
}

function getAniversariosEquipe() {
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  return codexGetTeamBirthdays_();
}

function getMeuPerfil() {
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  var profile = codexGetUserProfileByEmail_(access.userEmail) || access;
  var birthday = codexBirthdayParts_(profile.birthday || '');
  return {
    email: access.userEmail || '',
    name: profile.name || access.name || '',
    firstName: profile.firstName || access.firstName || codexFirstName_(profile.name || access.name, access.userEmail),
    role: access.role || '',
    formacao: profile.formacao || '',
    registroProfissional: profile.registroProfissional || '',
    podeSolicitarExames: profile.podeSolicitarExames || 'Sim',
    formacoes: codexUserProfileFormations_(),
    birthday: birthday.birthday,
    birthdayMonth: birthday.birthdayMonth,
    birthdayDay: birthday.birthdayDay
  };
}

function codexGetUserProfileByEmail_(email) {
  email = codexNormalizeEmail_(email);
  if (!email) return null;
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(8, sh.getLastColumn())).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (codexNormalizeEmail_(rows[i][0]) !== email) continue;
    var name = codexNormalizeUserName_(rows[i][1]);
    var birthday = codexBirthdayParts_(rows[i][4]);
    return {
      email: email,
      name: name,
      firstName: codexFirstName_(name, email),
      formacao: String(rows[i][5] || '').trim(),
      registroProfissional: String(rows[i][6] || '').trim(),
      podeSolicitarExames: codexNormalizeCanRequestExams_(rows[i][7]),
      birthday: birthday.birthday,
      birthdayMonth: birthday.birthdayMonth,
      birthdayDay: birthday.birthdayDay
    };
  }
  return null;
}

function salvarMeuPerfil(payload) {
  var access = codexAssertSelfProfileWrite_();
  payload = payload || {};
  var name = codexNormalizeUserName_(payload.name);
  var birthday = codexNormalizeBirthday_(payload.birthday || {
    month: payload.birthdayMonth,
    day: payload.birthdayDay
  });
  var formacao = codexNormalizeUserFormation_(payload.formacao);
  var registroProfissional = codexNormalizeProfessionalRegistration_(payload.registroProfissional);
  if (!name) throw new Error('Informe seu nome completo.');

  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) throw new Error('Usuário não encontrado.');
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(8, sh.getLastColumn())).getValues();
  var email = codexNormalizeEmail_(access.userEmail);
  var rowOffset = -1;
  for (var i = 0; i < rows.length; i++) {
    if (codexNormalizeEmail_(rows[i][0]) === email) {
      rowOffset = i;
      break;
    }
  }
  if (rowOffset < 0) throw new Error('Usuário não encontrado.');
  codexEnsureUsersProfileColumns_(sh);
  var rowIndex = rowOffset + 2;
  var oldName = rows[rowOffset][1];
  var oldBirthday = rows[rowOffset][4];
  var oldFormacao = rows[rowOffset][5];
  var oldRegistro = rows[rowOffset][6];
  sh.getRange(rowIndex, 2, 1, 3).setValues([[name, rows[rowOffset][2], rows[rowOffset][3]]]);
  codexSetUserBirthdaysAsText_(sh, rowIndex, [birthday]);
  sh.getRange(rowIndex, 6, 1, 2).setValues([[formacao, registroProfissional]]);
  codexCacheRemove_(CODEX_ACL_CACHE_KEY_);
  codexWriteAuditChanges_('Sistema', 'salvarMeuPerfil', email, [
    { field: 'Usuário - Nome', oldValue: oldName, newValue: name },
    { field: 'Usuário - Aniversário', oldValue: oldBirthday, newValue: birthday },
    { field: 'Usuário - Formação', oldValue: oldFormacao, newValue: formacao },
    { field: 'Usuário - Registro profissional', oldValue: oldRegistro, newValue: registroProfissional }
  ], 'Atualização do próprio perfil');
  var parts = codexBirthdayParts_(birthday);
  return {
    ok: true,
    email: email,
    name: name,
    firstName: codexFirstName_(name, email),
    role: access.role || '',
    formacao: formacao,
    registroProfissional: registroProfissional,
    podeSolicitarExames: codexNormalizeCanRequestExams_(rows[rowOffset][7]),
    birthday: parts.birthday,
    birthdayMonth: parts.birthdayMonth,
    birthdayDay: parts.birthdayDay,
    teamBirthdays: codexGetTeamBirthdays_()
  };
}

function salvarPerfisUsuariosAdmin(payload) {
  codexAssertAdmin_();
  payload = payload || {};
  var updates = Array.isArray(payload.users) ? payload.users : [];
  if (!updates.length) throw new Error('Nenhum perfil foi informado.');
  if (updates.length > 500) throw new Error('A carga rápida aceita no máximo 500 usuários por vez.');

  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) throw new Error('Aba Users não encontrada.');
  var lastRow = sh.getLastRow();
  var rows = sh.getRange(2, 1, lastRow - 1, Math.max(8, sh.getLastColumn())).getValues();
  var changes = [];
  var seenRows = {};

  updates.forEach(function(update) {
    var rowIndex = Number(update && update.rowIndex || 0);
    if (rowIndex < 2 || rowIndex > lastRow) throw new Error('Usuário inválido na carga rápida.');
    if (seenRows[rowIndex]) throw new Error('Usuário duplicado na carga rápida.');
    seenRows[rowIndex] = true;
    var offset = rowIndex - 2;
    var email = codexNormalizeEmail_(rows[offset][0]);
    var name = codexNormalizeUserName_(update.name);
    var birthday = codexNormalizeBirthday_(update.birthday || {
      month: update.birthdayMonth,
      day: update.birthdayDay
    });
    var formacao = codexNormalizeUserFormation_(update.formacao);
    var registroProfissional = codexNormalizeProfessionalRegistration_(update.registroProfissional);
    var podeSolicitarExames = codexNormalizeCanRequestExams_(update.podeSolicitarExames);
    if (!email) throw new Error('Usuário sem e-mail na linha ' + rowIndex + '.');
    if (!name) throw new Error('Informe o nome completo de ' + email + '.');
    changes.push({
      rowIndex: rowIndex,
      email: email,
      oldName: rows[offset][1],
      oldBirthday: rows[offset][4],
      oldFormacao: rows[offset][5],
      oldRegistro: rows[offset][6],
      oldPodeSolicitar: codexNormalizeCanRequestExams_(rows[offset][7]),
      name: name,
      birthday: birthday,
      formacao: formacao,
      registroProfissional: registroProfissional,
      podeSolicitarExames: podeSolicitarExames
    });
    rows[offset][1] = name;
    rows[offset][4] = birthday;
    rows[offset][5] = formacao;
    rows[offset][6] = registroProfissional;
    rows[offset][7] = podeSolicitarExames;
  });

  codexEnsureUsersProfileColumns_(sh);
  sh.getRange(2, 1, rows.length, 4).setValues(rows.map(function(row) { return row.slice(0, 4); }));
  codexSetUserBirthdaysAsText_(sh, 2, rows.map(function(row) { return row[4]; }));
  sh.getRange(2, 6, rows.length, 3).setValues(rows.map(function(row) { return row.slice(5, 8); }));
  codexCacheRemove_(CODEX_ACL_CACHE_KEY_);
  changes.forEach(function(change) {
    codexWriteAuditLog_('salvarPerfisUsuariosAdmin', 'Sistema', change.email);
    codexWriteAuditChanges_('Sistema', 'salvarPerfisUsuariosAdmin', change.email, [
      { field: 'Usuário - Nome', oldValue: change.oldName, newValue: change.name },
      { field: 'Usuário - Aniversário', oldValue: change.oldBirthday, newValue: change.birthday },
      { field: 'Usuário - Formação', oldValue: change.oldFormacao, newValue: change.formacao },
      { field: 'Usuário - Registro profissional', oldValue: change.oldRegistro, newValue: change.registroProfissional },
      { field: 'Usuário - Pode solicitar exames', oldValue: change.oldPodeSolicitar, newValue: change.podeSolicitarExames }
    ], 'Carga rápida de perfis');
  });
  return { ok: true, updated: changes.length, teamBirthdays: codexGetTeamBirthdays_() };
}

function getUsersAdminList() {
  codexAssertAdmin_();
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(8, sh.getLastColumn())).getValues();
  return rows.map(function(r, idx) {
    var email = codexNormalizeEmail_(r[0]);
    var name = codexNormalizeUserName_(r[1]);
    if (!email) return null;
    var birthday = codexBirthdayParts_(r[4]);
    return {
      rowIndex: idx + 2,
      email: email,
      name: name,
      firstName: codexFirstName_(name, email),
      birthday: birthday.birthday,
      birthdayMonth: birthday.birthdayMonth,
      birthdayDay: birthday.birthdayDay,
      birthdayLabel: birthday.birthdayLabel,
      formacao: String(r[5] || '').trim(),
      registroProfissional: String(r[6] || '').trim(),
      podeSolicitarExames: codexNormalizeCanRequestExams_(r[7]),
      role: codexNormalizeRole_(r[2]),
      ativo: codexNormalizeActive_(r[3]) ? 'Sim' : 'Não'
    };
  }).filter(Boolean).sort(function(a, b) {
    var an = codexNormalizeTextForSort_(a.name || a.firstName || a.email);
    var bn = codexNormalizeTextForSort_(b.name || b.firstName || b.email);
    if (an < bn) return -1;
    if (an > bn) return 1;
    return a.email < b.email ? -1 : (a.email > b.email ? 1 : 0);
  });
}

function getUsersAdminBootstrap() {
  return {
    users: getUsersAdminList(),
    formacoes: codexUserProfileFormations_()
  };
}

function salvarUsuarioAdmin(payload) {
  var access = codexAssertAdmin_();
  payload = payload || {};
  var email = codexNormalizeEmail_(payload.email);
  var name = codexNormalizeUserName_(payload.name);
  var birthday = codexNormalizeBirthday_(payload.birthday || {
    month: payload.birthdayMonth,
    day: payload.birthdayDay
  });
  var formacao = codexNormalizeUserFormation_(payload.formacao);
  var registroProfissional = codexNormalizeProfessionalRegistration_(payload.registroProfissional);
  var podeSolicitarExames = codexNormalizeCanRequestExams_(payload.podeSolicitarExames);
  var role = codexNormalizeRole_(payload.role);
  var ativo = codexNormalizeActive_(payload.ativo) ? 'Sim' : 'Não';
  if (!email) throw new Error('Informe o e-mail do usuário.');
  if (!name) throw new Error('Informe o nome completo do usuário.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  if (email === codexNormalizeEmail_(access.userEmail) && (role !== 'admin' || ativo !== 'Sim')) {
    throw new Error('Você não pode remover seu próprio acesso administrativo.');
  }

  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh) throw new Error('Aba Users não encontrada.');
  var rowIndex = Number(payload.rowIndex || 0);
  var lastRow = sh.getLastRow();
  var rows = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, Math.max(8, sh.getLastColumn())).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    var existingEmail = codexNormalizeEmail_(rows[i][0]);
    var existingRow = i + 2;
    if (existingEmail === email && existingRow !== rowIndex) {
      throw new Error('Este e-mail já está cadastrado na aba Users.');
    }
  }
  if (!rowIndex || rowIndex < 2) rowIndex = Math.max(2, lastRow + 1);
  codexEnsureUsersProfileColumns_(sh);
  var rowAnterior = rowIndex <= lastRow ? sh.getRange(rowIndex, 1, 1, 8).getValues()[0] : ['', '', '', '', '', '', '', ''];
  sh.getRange(rowIndex, 1, 1, 4).setValues([[email, name, role, ativo]]);
  codexSetUserBirthdaysAsText_(sh, rowIndex, [birthday]);
  sh.getRange(rowIndex, 6, 1, 3).setValues([[formacao, registroProfissional, podeSolicitarExames]]);
  codexCacheRemove_(CODEX_ACL_CACHE_KEY_);
  codexWriteAuditLog_('salvarUsuarioAdmin', 'Sistema', email);
  codexWriteAuditChanges_('Sistema', 'salvarUsuarioAdmin', email, [
    { field: 'Usuário - E-mail', oldValue: rowAnterior[0], newValue: email },
    { field: 'Usuário - Nome', oldValue: rowAnterior[1], newValue: name },
    { field: 'Usuário - Perfil', oldValue: rowAnterior[2], newValue: role },
    { field: 'Usuário - Ativo', oldValue: rowAnterior[3], newValue: ativo },
    { field: 'Usuário - Aniversário', oldValue: rowAnterior[4], newValue: birthday },
    { field: 'Usuário - Formação', oldValue: rowAnterior[5], newValue: formacao },
    { field: 'Usuário - Registro profissional', oldValue: rowAnterior[6], newValue: registroProfissional },
    { field: 'Usuário - Pode solicitar exames', oldValue: codexNormalizeCanRequestExams_(rowAnterior[7]), newValue: podeSolicitarExames }
  ], rowAnterior[0] ? 'Alteração de usuário/permissão' : 'Cadastro de usuário/permissão');
  return { ok: true, rowIndex: rowIndex, email: email, name: name, firstName: codexFirstName_(name, email), role: role, ativo: ativo, birthday: birthday, formacao: formacao, registroProfissional: registroProfissional, podeSolicitarExames: podeSolicitarExames, teamBirthdays: codexGetTeamBirthdays_() };
}

function inativarUsuarioAdmin(rowIndex) {
  var access = codexAssertAdmin_();
  rowIndex = Number(rowIndex || 0);
  if (rowIndex < 2) throw new Error('Usuário inválido.');
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh || rowIndex > sh.getLastRow()) throw new Error('Usuário não encontrado.');
  var email = codexNormalizeEmail_(sh.getRange(rowIndex, 1).getValue());
  if (email === codexNormalizeEmail_(access.userEmail)) {
    throw new Error('Você não pode inativar seu próprio usuário administrador.');
  }
  var ativoAnterior = sh.getRange(rowIndex, 4).getValue();
  sh.getRange(rowIndex, 4).setValue('Não');
  codexCacheRemove_(CODEX_ACL_CACHE_KEY_);
  codexWriteAuditLog_('inativarUsuarioAdmin', 'Sistema', email);
  codexWriteAuditChanges_('Sistema', 'inativarUsuarioAdmin', email, [{
    field: 'Usuário - Ativo',
    oldValue: ativoAnterior,
    newValue: 'Não'
  }], 'Inativação de usuário/permissão');
  return { ok: true, rowIndex: rowIndex, email: email, ativo: 'Não', teamBirthdays: codexGetTeamBirthdays_() };
}

function codexIsValidWebAppApiToken_(token) {
  token = String(token || '').trim();
  if (!token) return false;
  var expected = '';
  try {
    expected = String(PropertiesService.getScriptProperties().getProperty('CODEX_WEBAPP_API_TOKEN') || '').trim();
  } catch (e) {
    expected = '';
  }
  return !!expected && token === expected;
}

function codexGetWebAppApiTokenQuery_() {
  try {
    var token = String(PropertiesService.getScriptProperties().getProperty('CODEX_WEBAPP_API_TOKEN') || '').trim();
    return token ? '&token=' + encodeURIComponent(token) : '';
  } catch (e) {
    return '';
  }
}

function codexGetAllowedUsers_() {
  var cached = codexCacheGet_(CODEX_ACL_CACHE_KEY_);
  if (cached && typeof cached === 'object' && !Array.isArray(cached)) return cached;

  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return {};

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(8, sh.getLastColumn())).getValues();
  var users = {};
  values.forEach(function(row) {
    var email = codexNormalizeEmail_(row[0]);
    if (!email || users[email]) return;
    var name = codexNormalizeUserName_(row[1]);
    var birthday = codexBirthdayParts_(row[4]);
    users[email] = {
      name: name,
      firstName: codexFirstName_(name, email),
      birthday: birthday.birthday,
      birthdayMonth: birthday.birthdayMonth,
      birthdayDay: birthday.birthdayDay,
      formacao: String(row[5] || '').trim(),
      registroProfissional: String(row[6] || '').trim(),
      podeSolicitarExames: codexNormalizeCanRequestExams_(row[7]),
      role: codexNormalizeRole_(row[2]),
      active: codexNormalizeActive_(row[3])
    };
  });
  codexCachePut_(CODEX_ACL_CACHE_KEY_, users, CODEX_ACL_CACHE_SECONDS_);
  return users;
}

function codexAccessDeniedOutput_(access) {
  var user = access && access.userEmail ? access.userEmail : 'nao identificado';
  var message = access && access.message ? access.message : 'Acesso negado.';
  var debugHtml = codexAuthDebugHtml_(access && access.debugAuth);
  var authHtml = codexAuthUrlHtml_(access && access.authUrl);
  return HtmlService
    .createHtmlOutput(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<style>body{font-family:Arial,sans-serif;margin:48px;color:#1f2937}' +
      '.box{max-width:760px;border:1px solid #e5e7eb;padding:24px;border-radius:8px}' +
      'h1{font-size:22px;margin:0 0 12px;color:#991b1b}p{line-height:1.5}' +
      'pre{white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:12px}</style>' +
      '</head><body><main class="box">' +
      '<h1>Acesso negado</h1>' +
      '<p>' + codexEscapeHtml_(message) + '</p>' +
      '<p><strong>E-mail:</strong> ' + codexEscapeHtml_(user) + '</p>' +
      authHtml +
      debugHtml +
      '</main></body></html>'
    )
    .setTitle('Acesso negado');
}

function codexAuthDebugHtml_(debug) {
  if (!debug) return '';
  return '<h2 style="font-size:16px;margin:24px 0 8px;">Diagnostico de identidade</h2>' +
    '<pre>' + codexEscapeHtml_(JSON.stringify(debug, null, 2)) + '</pre>';
}

function codexAuthUrlHtml_(url) {
  if (!url) return '';
  return '<p><a href="' + codexEscapeHtml_(url) + '" target="_blank" rel="noopener">' +
    'Autorizar acesso do WebApp</a></p>';
}

function codexEscapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

var CODEX_ACTIVE_SPREADSHEET_CACHE_ = null;
var CODEX_CONFIG_APP_ROWS_CACHE_ = null;
// Cache apenas da execucao atual do Apps Script. Nao persiste entre requisicoes;
// CacheService e limpo separadamente em clearCodexRuntimeCaches_().
var CODEX_SHEET_DATA_CACHE_ = {};
var CODEX_AGENDA_COURIER_ROWS_CACHE_ = null;
var CODEX_LAB_CENTRAL_CACHE_ = null;
var CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
var CODEX_CACHE_BYPASS_READS_ = false;
var CODEX_CACHE_TTL_SECONDS_ = 300;

function getCodexSpreadsheet_() {
  if (!CODEX_ACTIVE_SPREADSHEET_CACHE_) {
    CODEX_ACTIVE_SPREADSHEET_CACHE_ = SpreadsheetApp.getActiveSpreadsheet();
  }
  return CODEX_ACTIVE_SPREADSHEET_CACHE_;
}

function clearCodexRuntimeCaches_() {
  CODEX_CONFIG_APP_ROWS_CACHE_ = null;
  CODEX_SHEET_DATA_CACHE_ = {};
  CODEX_AGENDA_COURIER_ROWS_CACHE_ = null;
  CODEX_LAB_CENTRAL_CACHE_ = null;
  CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
  codexCacheRemove_(CODEX_ACL_CACHE_KEY_);
  codexCacheRemove_('ConfigAppRows:v2');
  codexCacheRemove_('AgendaFormData:v2:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormData:v3:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormData:v4:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormData:v5:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormData:v6:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormData:v7:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormData:v8:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormData:v9:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormDataStrict:v2:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaFormDataStrict:v3:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaBootstrapReferenceData:v1:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
  codexCacheRemove_('AgendaBootstrapReferenceData:v2:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
}

function codexCacheGet_(key) {
  if (CODEX_CACHE_BYPASS_READS_) return null;
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function codexCachePut_(key, value, seconds) {
  try {
    var ttl = seconds || CODEX_CACHE_TTL_SECONDS_;
    CacheService.getScriptCache().put(key, JSON.stringify(value), ttl);
    var now = new Date();
    var expires = new Date(now.getTime() + ttl * 1000);
    PropertiesService.getScriptProperties().setProperty(codexCacheMetaKey_(key), JSON.stringify({
      key: key,
      createdAt: Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      createdAtMs: now.getTime(),
      expiresAt: Utilities.formatDate(expires, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      expiresAtMs: expires.getTime(),
      ttlSeconds: ttl
    }));
  } catch (e) {}
}

function codexCacheRemove_(key) {
  try {
    CacheService.getScriptCache().remove(key);
    PropertiesService.getScriptProperties().deleteProperty(codexCacheMetaKey_(key));
  } catch (e) {}
}

function getCodexSheetDataByName_(sheetName) {
  var sh = getCodexSpreadsheet_().getSheetByName(sheetName);
  return getCodexSheetDataFromSheet_(sh);
}

function getCodexSheetDataFromSheet_(sh) {
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (!lastRow || !lastCol) return [];
  var key = sh.getSheetId() + ':' + lastRow + ':' + lastCol;
  if (CODEX_CACHE_BYPASS_READS_ || !CODEX_SHEET_DATA_CACHE_[key]) {
    CODEX_SHEET_DATA_CACHE_[key] = sh.getDataRange().getValues();
  }
  return CODEX_SHEET_DATA_CACHE_[key];
}

function getTransporteWebAppUrlCodex_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('TRANSPORTE_WEBAPP_URL_CODEX') || '';
  if (!url) {
    try {
      url = PropertiesService.getDocumentProperties().getProperty('TRANSPORTE_WEBAPP_URL_CODEX') || '';
    } catch (e) {
      url = '';
    }
  }
  if (!url) {
    var vals = getConfigAppValuesByKeys_(
      ['Transporte', 'TRANSP', 'Apps'],
      ['WebApp URL', 'URL WebApp', 'TRANSPORTE_WEBAPP_URL_CODEX'],
      []
    );
    url = vals[0] || '';
  }
  if (!url && typeof TRANSPORTE_WEBAPP_URL_CODEX !== 'undefined') {
    url = TRANSPORTE_WEBAPP_URL_CODEX;
  }
  return String(url || '').trim().replace(/\?.*$/, '').replace(/\/$/, '');
}

function getSheetByPossibleNames_(ss, names) {
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    if (sh) return sh;
  }
  return null;
}

function readConfigAppRows_() {
  if (CODEX_CONFIG_APP_ROWS_CACHE_ && !CODEX_CACHE_BYPASS_READS_) return CODEX_CONFIG_APP_ROWS_CACHE_;
  var cached = codexCacheGet_('ConfigAppRows:v2');
  if (cached) {
    CODEX_CONFIG_APP_ROWS_CACHE_ = cached;
    return CODEX_CONFIG_APP_ROWS_CACHE_;
  }

  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName('Config_App');
  var lastRow = sh ? sh.getLastRow() : 0;
  if (!sh || lastRow < 2) {
    CODEX_CONFIG_APP_ROWS_CACHE_ = [];
    return CODEX_CONFIG_APP_ROWS_CACHE_;
  }

  function readBlock(startCol, bloco) {
    var out = [];
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

  CODEX_CONFIG_APP_ROWS_CACHE_ = readBlock(1, 'Principal').concat(readBlock(8, 'Apoio')).sort(function(a, b) {
    return String(a.grupo).localeCompare(String(b.grupo)) ||
      String(a.chave).localeCompare(String(b.chave)) ||
      (Number(a.ordem || 0) - Number(b.ordem || 0)) ||
      String(a.valor).localeCompare(String(b.valor));
  });
  codexCachePut_('ConfigAppRows:v2', CODEX_CONFIG_APP_ROWS_CACHE_);
  return CODEX_CONFIG_APP_ROWS_CACHE_;
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
  var rows = [];
  var matched = false;
  try {
    readConfigAppRows_().forEach(function(r) {
      if (Object.keys(grupoMap).length && !grupoMap[normText_(r.grupo)]) return;
      if (Object.keys(chaveMap).length && !chaveMap[normText_(r.chave)]) return;
      matched = true;
      var ativo = normText_(r.ativo || 'Sim');
      if (ativo === 'nao' || ativo === 'false' || ativo === '0' || ativo === 'inativo') return;
      if (r.valor) rows.push(r);
    });
    rows.sort(function(a, b) {
      var ao = a.ordem !== '' && a.ordem !== null && a.ordem !== undefined ? Number(a.ordem) : 999999;
      var bo = b.ordem !== '' && b.ordem !== null && b.ordem !== undefined ? Number(b.ordem) : 999999;
      return ao - bo || String(a.valor).localeCompare(String(b.valor));
    });
    return rows.length || matched ? rows.map(function(r) { return r.valor; }) : (fallback || []);
  } catch(e) {
    return fallback || [];
  }
}

function normText_(v) {
  return String(v == null ? '' : v).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function agendaStatusRealizado_(status) {
  return AgendaServerRules_.isRealized(status);
}

function agendaTipoExigeLabCentralServer_(tipo) {
  return AgendaServerRules_.typeRequiresLabCentral(tipo);
}

function agendaTipoContatoTelefonicoServer_(tipo) {
  return AgendaServerRules_.isPhoneContact(tipo);
}



// ══════════════════════════════════════════════════════
//  MENU PRINCIPAL
// ══════════════════════════════════════════════════════
// O WebApp e a interface principal. Nao criamos mais menus no onOpen.



// ══════════════════════════════════════════════════════
//  PARTICIPANTE
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  MÉDICO
// ══════════════════════════════════════════════════════
/**
 * Cria ou atualiza um médico na aba '🩺 Médicos'.
 * A=id | B=nome | C=especialidade | D=CPF | E=CREMERS | F=telefone | G=email
 */
function salvarDadosMedico(dados) {
  codexAssertCanWrite_('salvarDadosMedico', 'Cadastros', dados && dados.id);
  dados = dados || {};
  var especialidade = String(dados.especialidade || '').trim();
  var especialidadesConfig = getConfigValues_('Médicos', 'Especialidade', []);
  if (!especialidade || especialidadesConfig.indexOf(especialidade) === -1) {
    throw new Error('Selecione uma especialidade ativa cadastrada no ConfigApp.');
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('🩺 Médicos');
  if (!sh) throw new Error("Aba '🩺 Médicos' não encontrada.");

  if (dados.id && dados.id !== '') {
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0].toString() === dados.id.toString()) {
        var linha = i + 2;
        sh.getRange(linha, 2).setValue(dados.nome          || '');
        sh.getRange(linha, 3).setValue(especialidade);
        sh.getRange(linha, 4).setValue(dados.cpf           || '');
        sh.getRange(linha, 5).setValue(dados.cremers       || '');
        sh.getRange(linha, 6).setValue(dados.telefone      || '');
        sh.getRange(linha, 7).setValue(dados.email         || '');
        clearCodexRuntimeCaches_();
        return 'Médico atualizado com sucesso.';
      }
    }
    throw new Error('Médico com ID "' + dados.id + '" não encontrado.');
  }

  var novoId = 'MED-' + new Date().getTime();
  sh.appendRow([novoId, dados.nome || '', especialidade,
                dados.cpf || '', dados.cremers || '',
                dados.telefone || '', dados.email || '']);
  clearCodexRuntimeCaches_();
  return 'Médico cadastrado com sucesso.';
}

function getMedicos() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🩺 Médicos');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues()
    .filter(function(r) { return r[1] !== ''; })
    .map(function(r) {
      return {
        id: r[0],
        nome: r[1],
        especialidade: r[2],
        cpf: r[3],
        cremers: r[4],
        telefone: r[5],
        email: r[6]
      };
    });
}

function excluirMedico(id) {
  codexAssertCanWrite_('excluirMedico', 'Cadastros', id);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🩺 Médicos');
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] == id) {
      sh.deleteRow(i + 2);
      clearCodexRuntimeCaches_();
      return 'ok';
    }
  }
  throw new Error('Registro não encontrado.');
}



// ══════════════════════════════════════════════════════
//  SOLICITANTE
// ══════════════════════════════════════════════════════
// Contrato mantido para compatibilidade com o formulário de requisição.
function codexGetExamRequesterUsers_() {
  var users = codexGetAllowedUsers_();
  return Object.keys(users).map(function(email) {
    var user = users[email] || {};
    if (!user.active || codexNormalizeCanRequestExams_(user.podeSolicitarExames) !== 'Sim') return null;
    return {
      id: email,
      nome: user.name || codexFirstName_(user.name, email),
      formacao: user.formacao || '',
      registro: user.registroProfissional || '',
      email: email
    };
  }).filter(function(user) { return user && user.nome; }).sort(function(a, b) {
    return codexNormalizeTextForSort_(a.nome).localeCompare(codexNormalizeTextForSort_(b.nome));
  });
}

/**
 * Retorna nome + formação + registro dos usuários autorizados a solicitar exames.
 * Usada pelo formulário de Requisição de Exames (WebApp).
 */
function buscarSolicitantesCompleto() {
  var access = codexAuthorizeWebAppRequest_();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  return codexGetExamRequesterUsers_();
}

/**
 * Retorna todos os solicitantes para o WebApp.
 * A=id | B=nome | C=formacao | D=registro
 */
function getSolicitantes() {
  return codexGetExamRequesterUsers_();
}

/**
 * Cria ou atualiza um solicitante na aba '🙋 Solicitantes'.
 */
function salvarDadosSolicitante(dados) {
  codexAssertCanWrite_('salvarDadosSolicitante', 'Cadastros', dados && dados.id);
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
  codexAssertCanWrite_('excluirSolicitante', 'Cadastros', id);
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
// ══════════════════════════════════════════════════════
//  PRESTADOR
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  REQUISIÇÃO DE EXAMES
// ══════════════════════════════════════════════════════
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
          ? formatarDataMesCurtoPt_(row[2])
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
 * A=id | B=empresa | C=endereco | D=email | E=tipo de serviço
 */
function buscarPrestadoresParaRequisicao() {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName('🏢 Prestadores');
    if (!aba || aba.getLastRow() < 2) return [];
    var tipoCol = ensurePrestadoresTipoServicoColumn_(aba);
    return aba.getRange(2, 1, aba.getLastRow() - 1, Math.max(4, tipoCol)).getValues()
      .filter(function(row) { return row[1]; })
      .map(function(row) {
        return {
          empresa:  row[1].toString().trim(),
          endereco: row[2] ? row[2].toString().trim() : '',
          tipoServico: row[tipoCol - 1] ? row[tipoCol - 1].toString().trim() : ''
        };
      });
  } catch(e) { return []; }
}

function getReqExamesPreloadProjeto(projeto, tipoServico) {
  var preload = reqExamesPreloadReadProjeto_(projeto, null, tipoServico);
  return preload && preload.active ? preload.exames : [];
}

function getReqExamesPreloadProjetoContext(projeto, tipoServico) {
  var exact = reqExamesPreloadReadProjeto_(projeto, null, tipoServico, true);
  var preload = exact || reqExamesPreloadReadProjeto_(projeto, null, tipoServico);
  return {
    projeto: String(projeto || '').trim(),
    tipoServico: String(tipoServico || '').trim(),
    chave: preload ? preload.chave : reqExamesPreloadKey_(projeto, tipoServico),
    exames: preload && preload.active ? preload.exames : [],
    hash: preload ? preload.hash : reqExamesPreloadHash_([]),
    exists: !!(preload && preload.rowIndex),
    exactExists: !!(exact && exact.rowIndex && exact.active),
    fallbackUsed: !!(preload && preload.rowIndex && (!exact || exact.rowIndex !== preload.rowIndex))
  };
}

function getReqExamesPreloadProjetoEditor(projeto, tipoServico) {
  var exact = reqExamesPreloadReadProjeto_(projeto, null, tipoServico, true);
  var preload = exact || reqExamesPreloadReadProjeto_(projeto, null, tipoServico);
  var exames = preload && preload.active ? preload.exames : [];
  return {
    projeto: String(projeto || '').trim(),
    tipoServico: String(tipoServico || '').trim(),
    chave: preload ? preload.chave : reqExamesPreloadKey_(projeto, tipoServico),
    exames: exames,
    hash: reqExamesPreloadHash_(exames),
    exists: !!(preload && preload.rowIndex),
    active: !(preload && !preload.active),
    exactExists: !!(exact && exact.rowIndex && exact.active),
    fallbackUsed: !!(preload && preload.rowIndex && (!exact || exact.rowIndex !== preload.rowIndex))
  };
}

function salvarReqExamesPreloadProjeto(projeto, exames, expectedHash, tipoServico) {
  codexAssertCanWrite_('salvarReqExamesPreloadProjeto', 'Requisição de Exames', projeto);
  projeto = String(projeto || '').trim();
  tipoServico = String(tipoServico || '').trim();
  if (!projeto) throw new Error('Informe o projeto para salvar o preload.');
  exames = (exames || []).map(function(v) {
    return String(v || '').trim();
  }).filter(Boolean).slice(0, 40);

  return codexWithDocumentLock_('salvarReqExamesPreloadProjeto', function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = getSheetByPossibleNames_(ss, ['ReqExames_Preloads', 'Req_Exames_Preloads', 'ReqExames Preloads']);
    if (!sh) sh = ss.insertSheet('ReqExames_Preloads');
    ensureReqExamesPreloadSheet_(sh);

    var lastRow = sh.getLastRow();
    var chave = reqExamesPreloadKey_(projeto, tipoServico);
    var preloadAtual = reqExamesPreloadReadProjeto_(projeto, sh, tipoServico, true);
    var atuais = preloadAtual && preloadAtual.active ? preloadAtual.exames : [];
    var hashAtual = reqExamesPreloadHash_(atuais);
    if (preloadAtual && preloadAtual.rowIndex && (!expectedHash || expectedHash !== hashAtual)) {
      return {
        ok: false,
        conflict: true,
        projeto: projeto,
        tipoServico: tipoServico,
        chave: chave,
        exames: atuais,
        hash: hashAtual,
        message: 'Os exames padrão deste projeto foram alterados por outro usuário. Carregue a versão atual antes de salvar.'
      };
    }

    var row = [chave].concat(exames);
    while (row.length < 41) row.push('');
    row.push('Sim');

    if (preloadAtual && preloadAtual.rowIndex) {
      sh.getRange(preloadAtual.rowIndex, 1, 1, 42).setValues([row]);
      return { ok: true, projeto: projeto, tipoServico: tipoServico, chave: chave, exames: exames, hash: reqExamesPreloadHash_(exames), message: 'Exames padrão atualizados.' };
    }
    sh.getRange(lastRow + 1, 1, 1, 42).setValues([row]);
    return { ok: true, projeto: projeto, tipoServico: tipoServico, chave: chave, exames: exames, hash: reqExamesPreloadHash_(exames), message: 'Exames padrão cadastrados.' };
  });
}

function reqExamesPreloadKey_(projeto, tipoServico) {
  projeto = String(projeto || '').trim();
  tipoServico = String(tipoServico || '').trim();
  return tipoServico ? (projeto + ' | ' + tipoServico) : projeto;
}

function reqExamesPreloadReadProjeto_(projeto, sh, tipoServico, exactOnly) {
  projeto = String(projeto || '').trim();
  tipoServico = String(tipoServico || '').trim();
  if (!projeto) return null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  sh = sh || getSheetByPossibleNames_(ss, ['ReqExames_Preloads', 'Req_Exames_Preloads', 'ReqExames Preloads']);
  if (!sh || sh.getLastRow() < 2) return null;
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(42, sh.getLastColumn())).getValues();
  var chaves = [reqExamesPreloadKey_(projeto, tipoServico)];
  if (tipoServico && !exactOnly) chaves.push(projeto);
  var alvoMap = {};
  chaves.forEach(function(chave) { alvoMap[normText_(chave)] = true; });
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!alvoMap[normText_(row[0])]) continue;
    var ativo = String(row[41] || '').trim();
    var inactive = ativo && ['nao', 'não', 'n', 'false', 'inativo'].indexOf(normText_(ativo)) > -1;
    var exames = row.slice(1, 41).map(function(v) { return String(v || '').trim(); }).filter(Boolean);
    return {
      rowIndex: i + 2,
      projeto: projeto,
      tipoServico: normText_(row[0]) === normText_(reqExamesPreloadKey_(projeto, tipoServico)) ? tipoServico : '',
      chave: String(row[0] || '').trim(),
      exames: exames,
      active: !inactive,
      hash: reqExamesPreloadHash_(inactive ? [] : exames)
    };
  }
  return null;
}

function reqExamesPreloadHash_(exames) {
  exames = (exames || []).map(function(v) {
    return String(v || '').trim();
  }).filter(Boolean).slice(0, 40);
  var text = exames.join('\n');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    var v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function ensureReqExamesPreloadSheet_(sh) {
  if (sh.getMaxColumns() < 42) {
    sh.insertColumnsAfter(sh.getMaxColumns(), 42 - sh.getMaxColumns());
  }
  var headers = ['Projeto'];
  for (var i = 1; i <= 40; i++) headers.push('Exame ' + i);
  headers.push('Ativo');
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
}

function getReqExamesCcEmails_() {
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
  var access = codexAssertCanWrite_('gerarRequisicaoPDF', 'Agenda', dados && (dados.paciente || dados.protocolo));
  dados = dados || {};
  if (access && access.userEmail !== 'api-token' && codexNormalizeCanRequestExams_(access.podeSolicitarExames) !== 'Sim') {
    throw new Error('Seu usuário não está autorizado a solicitar exames. Procure um administrador do sistema.');
  }
  if (agendaDateIsBeforeToday_(dados.dataAgendamento)) {
    throw new Error('Requisicoes de Exame nao podem ser marcadas para uma data anterior a hoje.');
  }
  var solicitanteEmail = reqExamesSolicitanteEmail_(dados.solicitante);
  if (!solicitanteEmail) {
    throw new Error('Selecione um usuário ativo autorizado a solicitar exames.');
  }
  if (!dados.requestedByEmail && access && access.userEmail) dados.requestedByEmail = access.userEmail;
  if (solicitanteEmail) dados.requestedByEmail = solicitanteEmail;
  const ss    = reqExamesOpenSpreadsheetForWrite_();
  const sheet = ss.getSheetByName('Requisição de Exames');
  if (!sheet) throw new Error("Aba 'Requisição de Exames' não encontrada.");

  // ── 1. Limpar campos anteriores ──────────────────────────────────────────
  ['I5','E8','E9','E10','E11','H8','H9','H10','J10','B36','H41','H42','H43']
    .forEach(function(cell) { sheet.getRange(cell).clearContent(); });

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

  var exames = (Array.isArray(dados.exames) ? dados.exames : [])
    .map(function(exame) { return String(exame || '').trim(); })
    .filter(Boolean)
    .slice(0, 40);
  var usarPdfCompatibilidade = reqExamesPdfCompatibilidadePorTextoLongo_(exames);
  var slotsExames = reqExamesPreencherGradeExames_(sheet, exames);

  sheet.getRange('B36').setValue(dados.observacoes || '');
  sheet.getRange('I5').setValue(dados.urgente ? 'URGENTE' : '');
  sheet.getRange('H41').setValue(dados.solicitante || '');
  sheet.getRange('H42').setValue(dados.solFormacao || '');
  sheet.getRange('H43').setValue(dados.solRegistro || '');
  SpreadsheetApp.flush();

  var examesGravados = slotsExames
    .map(function(slot) { return String(slot.getDisplayValue() || '').trim(); })
    .filter(Boolean);
  if (examesGravados.length !== exames.length) {
    throw new Error(
      'Não foi possível preencher todos os exames na requisição. ' +
      'Esperados: ' + exames.length + '; gravados: ' + examesGravados.length + '.'
    );
  }

  // ── 3. Gerar PDF e criar rascunho (versão sem getUi) ─────────────────────
  var pdfResult = _exportarPDFWebApp(sheet, ss, {
    requestedByEmail: dados.requestedByEmail || '',
    preferHtml: true,
    htmlModoCompatibilidade: usarPdfCompatibilidade
  });

  var statusResult = null;
  var statusSync = {
    attempted: false,
    ok: false,
    semPrestador: false,
    message: '',
    warning: ''
  };
  if (String(dados.agendaId || '').trim()) {
    statusSync.attempted = true;
    try {
      statusResult = atualizarStatusRequisicaoAgenda(String(dados.agendaId).trim(), true);
      if (statusResult && statusResult.semPrestador) {
        statusSync.semPrestador = true;
        statusSync.warning = 'Rascunho criado, mas o status não foi atualizado porque o agendamento está sem prestador.';
      } else {
        statusSync.ok = !!(statusResult && statusResult.statusRequisicao);
        statusSync.message = statusSync.ok ? 'Status da Agenda atualizado.' : '';
      }
    } catch (statusError) {
      statusSync.warning = 'Rascunho criado, mas não foi possível atualizar o status da Agenda: ' + statusError.message;
    }
  }

  return {
    ok: true,
    message: 'Rascunho de e-mail criado com sucesso! Verifique sua caixa de rascunhos no Gmail.',
    preloadCreated: false,
    preloadWarning: '',
    statusRequisicao: statusResult && statusResult.statusRequisicao ? statusResult.statusRequisicao : '',
    recordVersion: statusResult && statusResult.recordVersion ? statusResult.recordVersion : '',
    editRecordVersion: statusResult && statusResult.editRecordVersion ? statusResult.editRecordVersion : '',
    statusWarning: statusSync.warning,
    pdfContingencia: !!(pdfResult && pdfResult.contingencia),
    pdfMode: pdfResult && pdfResult.modo ? pdfResult.modo : '',
    pdfWarning: pdfResult && pdfResult.aviso ? pdfResult.aviso : '',
    statusSync: statusSync
  };
}

function reqExamesCelulaGravavel_(sheet, row, column) {
  var cell = sheet.getRange(row, column);
  var mergedRanges = cell.getMergedRanges();
  if (!mergedRanges.length) return cell;
  return mergedRanges[0].getCell(1, 1);
}

function reqExamesRangeGravavel_(sheet, row, column) {
  var cell = sheet.getRange(row, column);
  var mergedRanges = cell.getMergedRanges();
  return mergedRanges.length ? mergedRanges[0] : cell;
}

function reqExamesPreencherGradeExames_(sheet, exames) {
  var baseRow = 14;
  var linhas = 20;
  var baseHeight = 38;
  var leftSlots = [];
  var rightSlots = [];
  reqExamesAssertGradeModelo_(sheet);
  sheet.setRowHeights(baseRow, linhas, baseHeight);

  for (var i = 0; i < linhas; i++) {
    var row = baseRow + i;
    var leftText = exames[i] || '';
    var rightText = exames[linhas + i] || '';
    var leftRange = reqExamesRangeGravavel_(sheet, row, 3);
    var rightRange = reqExamesRangeGravavel_(sheet, row, 7);
    var leftCell = leftRange.getCell(1, 1);
    var rightCell = rightRange.getCell(1, 1);
    leftCell.clearContent();
    rightCell.clearContent();
    leftRange.setWrap(true).setVerticalAlignment('middle').setFontSize(reqExamesFontSizeExame_(leftText));
    rightRange.setWrap(true).setVerticalAlignment('middle').setFontSize(reqExamesFontSizeExame_(rightText));
    leftCell.setValue(leftText);
    rightCell.setValue(rightText);
    leftSlots.push(leftCell);
    rightSlots.push(rightCell);
  }

  return leftSlots.concat(rightSlots).slice(0, exames.length);
}

function reqExamesPdfCompatibilidadePorTextoLongo_(exames) {
  return (exames || []).some(function(exame) {
    return String(exame || '').length > 64;
  });
}

function reqExamesAssertGradeModelo_(sheet) {
  for (var i = 0; i < 20; i++) {
    var row = 14 + i;
    reqExamesAssertSlotMesclado_(sheet, row, 3, 3, 'C' + row + ':E' + row);
    reqExamesAssertSlotMesclado_(sheet, row, 7, 4, 'G' + row + ':J' + row);
  }
}

function reqExamesAssertSlotMesclado_(sheet, row, column, expectedColumns, label) {
  var cell = sheet.getRange(row, column);
  var mergedRanges = cell.getMergedRanges();
  if (!mergedRanges.length) {
    throw new Error('O modelo da Requisicao de Exames perdeu a mesclagem esperada em ' + label + '. Repare o modelo da planilha e tente novamente.');
  }
  var merged = mergedRanges[0];
  var ok = merged.getRow() === row &&
    merged.getColumn() === column &&
    merged.getNumRows() === 1 &&
    merged.getNumColumns() >= expectedColumns;
  if (!ok) {
    throw new Error('O modelo da Requisicao de Exames esta com mesclagem inesperada em ' + label + '. Repare o modelo da planilha e tente novamente.');
  }
}

function reqExamesFontSizeExame_(text) {
  var len = String(text || '').length;
  if (len > 110) return 7;
  if (len > 64) return 8;
  return 10;
}

function reqExamesLinhasEstimadas_(text) {
  text = String(text || '').trim();
  if (!text) return 1;
  return text.split(/\r?\n/).reduce(function(total, parte) {
    return total + Math.max(1, Math.ceil(String(parte || '').length / 48));
  }, 0);
}

/**
 * Versão do exportarPDF sem chamadas a getUi().
 * Usada internamente por gerarRequisicaoPDF (contexto WebApp).
 * Lança erros em vez de exibir alertas.
 * @param {Sheet} sheet - Aba "Requisição de Exames" já preenchida.
 * @param {Spreadsheet} ss - Spreadsheet pai.
 */
function _exportarPDFWebApp(sheet, ss, options) {
  options = options || {};
  reqExamesAssertGmailDraftAllowed_(options.requestedByEmail || '');
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

  var dataFormatada   = formatarDataMesCurtoPt_(dataAgendamento);
  var dataArquivo     = formatarDataMesCurtoPt_(dataAgendamento, '-');
  var paciente        = sheet.getRange('E8').getValue();
  var pacienteLimpo   = limparNome(paciente);
  var dataNascRaw     = sheet.getRange('E9').getValue();
  var dataNasc        = (dataNascRaw instanceof Date)
    ? formatarDataMesCurtoPt_(dataNascRaw) : dataNascRaw;
  var medico          = sheet.getRange('H9').getValue();
  var nomeArquivo     = 'IPS-UCS - ' + pacienteLimpo + ' - ' + dataArquivo + '.pdf';
  var pesquisaClinica = sheet.getRange('H8').getDisplayValue();
  var urgente         = sheet.getRange('I5').getValue();
  var urgenteTag      = urgente
    ? '<span style="background:#e53935;color:white;padding:2px 8px;border-radius:4px;font-weight:700;">URGENTE</span>&nbsp;'
    : '';

  // ── Geração do PDF via Export URL ────────────────────────────────────────
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?';
  var exportOptions = reqExamesPdfExportOptions_(sheet.getSheetId());
  var pdfResult = reqExamesExportPdfBlob_(url + exportOptions, nomeArquivo, {
    sheet: sheet,
    preferHtml: !!options.preferHtml,
    htmlModoCompatibilidade: !!options.htmlModoCompatibilidade
  });
  var pdfBlob = pdfResult && pdfResult.blob ? pdfResult.blob : pdfResult;

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
  return pdfResult;
}

function reqExamesPdfExportOptions_(sheetId) {
  return 'exportFormat=pdf&format=pdf&size=A4&portrait=true&fitw=true' +
    '&sheetnames=false&printtitle=false&pagenumbers=false' +
    '&gridlines=false&fzr=false&gid=' + sheetId +
    '&r1=0&c1=0&r2=43&c2=10' +
    '&top_margin=0.15&bottom_margin=0.15&left_margin=0.15&right_margin=0.15&scale=4';
}

function reqExamesExportPdfBlob_(url, nomeArquivo, options) {
  options = options || {};
  if (options.preferHtml && options.sheet) {
    return {
      blob: reqExamesExportPdfBlobViaHtml_(options.sheet, nomeArquivo, { institucional: true, compatibilidade: !!options.htmlModoCompatibilidade }),
      modo: 'html-institucional',
      contingencia: false,
      aviso: ''
    };
  }
  try {
    return {
      blob: reqExamesFetchPdfBlob_(url, nomeArquivo),
      modo: 'google-sheets',
      contingencia: false,
      aviso: ''
    };
  } catch (primaryError) {
    Logger.log('ReqExames PDF: exportador Google Sheets falhou: ' + (primaryError && primaryError.message ? primaryError.message : String(primaryError)));
    if (!options.sheet) throw primaryError;
    try {
      return {
        blob: reqExamesExportPdfBlobViaWorkingCopy_(options.sheet, nomeArquivo),
        modo: 'planilha-temporaria',
        contingencia: false,
        aviso: ''
      };
    } catch (fallbackError) {
      Logger.log('ReqExames PDF: planilha temporaria falhou: ' + (fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError)));
      try {
        return {
          blob: reqExamesExportPdfBlobViaHtml_(options.sheet, nomeArquivo, { contingencia: true }),
          modo: 'html-contingencia',
          contingencia: true,
          aviso: 'O rascunho foi criado com PDF em modo de contingencia porque o exportador do Google Sheets falhou. Confira o anexo antes de enviar.'
        };
      } catch (htmlError) {
        throw new Error(
          primaryError.message +
          ' Fallback por planilha temporaria isolada tambem falhou: ' + fallbackError.message +
          ' Fallback HTML tambem falhou: ' + htmlError.message
        );
      }
    }
  }
}

function reqExamesFetchPdfBlob_(url, nomeArquivo) {
  var token = ScriptApp.getOAuthToken();
  var lastStatus = 0;
  var lastMessage = '';
  var transientCodes = { 429: true, 500: true, 502: true, 503: true, 504: true };

  for (var attempt = 1; attempt <= 5; attempt++) {
    if (attempt === 1) Utilities.sleep(900);
    var response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    lastStatus = response.getResponseCode();
    var blob = response.getBlob();
    var bytes = blob.getBytes();
    var contentType = String(response.getHeaders()['Content-Type'] || response.getHeaders()['content-type'] || blob.getContentType() || '').toLowerCase();

    if (lastStatus >= 200 && lastStatus < 300 && bytes && bytes.length >= 1000 && contentType.indexOf('pdf') !== -1) {
      return blob.setName(nomeArquivo);
    }

    lastMessage = reqExamesExportErrorSnippet_(response);
    if (!transientCodes[lastStatus] || attempt === 5) break;
    Utilities.sleep(900 * attempt);
  }

  throw new Error(
    'Nao foi possivel gerar o PDF da requisicao pelo Google Sheets agora' +
    (lastStatus ? ' (HTTP ' + lastStatus + ')' : '') +
    '. Tente novamente em alguns instantes. Se persistir, verifique permissoes/autorizacao do WebApp e a disponibilidade do Google Docs.' +
    (lastMessage ? ' Detalhe tecnico: ' + lastMessage : '')
  );
}

function reqExamesExportPdfBlobViaWorkingCopy_(sheet, nomeArquivo) {
  var workingCopyFile = null;
  try {
    SpreadsheetApp.flush();
    Utilities.sleep(900);
    var workingSS = SpreadsheetApp.create(nomeArquivo + ' - TEMP_REQ_PDF');
    workingCopyFile = DriveApp.getFileById(workingSS.getId());
    var workingSheet = sheet.copyTo(workingSS).setName(sheet.getName());
    workingSS.setActiveSheet(workingSheet);
    workingSS.moveActiveSheet(1);
    workingSS.getSheets().forEach(function(tempSheet) {
      if (tempSheet.getSheetId() !== workingSheet.getSheetId()) workingSS.deleteSheet(tempSheet);
    });
    SpreadsheetApp.flush();
    Utilities.sleep(1200);
    var url = 'https://docs.google.com/spreadsheets/d/' + workingSS.getId() + '/export?' +
      reqExamesPdfExportOptions_(workingSheet.getSheetId());
    return reqExamesFetchPdfBlob_(url, nomeArquivo);
  } finally {
    if (workingCopyFile) {
      try {
        workingCopyFile.setTrashed(true);
      } catch (trashError) {
        Logger.log('Copia temporaria da requisicao nao movida para lixeira: ' + trashError.toString());
      }
    }
  }
}

function reqExamesExportPdfBlobViaHtml_(sheet, nomeArquivo, options) {
  options = options || {};
  var dataAgendamento = sheet.getRange('H10').getValue();
  var exames = sheet.getRange('C14:C33').getDisplayValues()
    .concat(sheet.getRange('G14:G33').getDisplayValues())
    .map(function(row) { return String(row[0] || '').trim(); })
    .filter(Boolean);
  var html = reqExamesPdfHtml_({
    urgente: sheet.getRange('I5').getDisplayValue(),
    paciente: sheet.getRange('E8').getDisplayValue(),
    nascimento: sheet.getRange('E9').getDisplayValue(),
    protocolo: sheet.getRange('H8').getDisplayValue(),
    medico: sheet.getRange('H9').getDisplayValue(),
    localExame: sheet.getRange('E10').getDisplayValue(),
    endereco: sheet.getRange('E11').getDisplayValue(),
    dataAgendamento: dataAgendamento instanceof Date ? formatarDataMesCurtoPt_(dataAgendamento) : sheet.getRange('H10').getDisplayValue(),
    horario: sheet.getRange('J10').getDisplayValue(),
    observacoes: sheet.getRange('B36').getDisplayValue(),
    solicitante: sheet.getRange('H41').getDisplayValue(),
    solFormacao: sheet.getRange('H42').getDisplayValue(),
    solRegistro: sheet.getRange('H43').getDisplayValue(),
    exames: exames,
    contingencia: !!options.contingencia,
    compatibilidade: !!options.compatibilidade
  });
  return HtmlService.createHtmlOutput(html)
    .getBlob()
    .getAs(MimeType.PDF)
    .setName(nomeArquivo);
}

function reqExamesLogoUrl_() {
  return 'https://i0.wp.com/www.ucs.br/ips/wp-content/uploads/2024/08/logo_ips_2024_2.png?ssl=1';
}

function reqExamesLogoSrc_() {
  try {
    var response = UrlFetchApp.fetch(reqExamesLogoUrl_(), { muteHttpExceptions: true });
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      var blob = response.getBlob();
      return 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    }
  } catch (e) {
    Logger.log('ReqExames PDF: logo externo nao incorporado: ' + (e && e.message ? e.message : String(e)));
  }
  return reqExamesLogoUrl_();
}

function reqExamesRodapeInstitucionalHtml_() {
  return '<strong>CAMPUS SEDE</strong><br>' +
    'Rua Francisco Getulio Vargas, 1130 - Bairro Petropolis - Bloco S - Sala 315 - CEP 95070-560 - Caxias do Sul - RS - Brasil<br>' +
    'Ou: Caixa Postal 1352 - CEP 95020-972 - Caxias do Sul - RS - Brasil<br>' +
    'Telefone / Telefax (54) 3218.2737 - www.ucs.br/ips<br>' +
    'Entidade Mantenedora: Fundacao Universidade de Caxias do Sul - CNPJ 88 648 761/0001-03 - CGCTE 029/0089530';
}

function reqExamesPdfHtml_(dados) {
  dados = dados || {};
  function h(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var exames = dados.exames || [];
  var rows = [];
  var solFormacao = String(dados.solFormacao || '').trim();
  var solRegistro = String(dados.solRegistro || '').trim();
  for (var i = 0; i < 20; i++) {
    var leftIndex = i;
    var rightIndex = i + 20;
    rows.push(
      '<tr>' +
        '<td class="exam-num">' + (leftIndex + 1) + '</td>' +
        '<td class="exam-text">' + h(exames[leftIndex] || '') + '</td>' +
        '<td class="exam-num">' + (rightIndex + 1) + '</td>' +
        '<td class="exam-text">' + h(exames[rightIndex] || '') + '</td>' +
      '</tr>'
    );
  }
  var obs = h(dados.observacoes || '');
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>' +
    '@import url("https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap");' +
    '@page{size:A4;margin:8mm 9mm 11mm 9mm}' +
    '*{box-sizing:border-box}' +
    'body{font-family:Roboto,Arial,Helvetica,sans-serif;color:#000;font-size:10.5px;line-height:1.2;margin:0;padding:0 0 12mm 0}' +
    '.brand{text-align:center;margin:0 0 14px 0}.brand img{height:62px;max-width:360px;object-fit:contain}' +
    'h1{text-align:center;font-size:14px;margin:4px 0 20px 0;text-transform:uppercase;font-weight:700}' +
    '.urgent{color:#b91c1c;font-weight:bold;text-align:center;margin:-8px 0 10px 0}' +
    '.meta-table{width:100%;border-collapse:collapse;margin:0 0 14px 0;table-layout:fixed}' +
    '.meta-table td{border:0;padding:0 7px 7px 0;vertical-align:top}' +
    '.meta-label{font-weight:700;white-space:nowrap}.meta-value{overflow-wrap:anywhere;word-break:break-word}' +
    '.meta-lbl-left{width:134px}.meta-val-left{width:250px}.meta-lbl-right{width:92px}.meta-date{width:54px}.meta-time{width:58px}' +
    '.label{font-weight:bold}.value{overflow-wrap:anywhere;word-break:break-word}' +
    '.exam-table{width:100%;border-collapse:collapse;table-layout:fixed;margin:6px 0 12px 0;border:1px solid #000}' +
    '.exam-table th{border:1px solid #000;padding:5px 4px;text-align:center;font-size:12px;text-transform:uppercase}' +
    '.exam-table td{border:1px solid #000;padding:4px 5px;vertical-align:middle;height:23px}' +
    '.exam-num{text-align:center;font-weight:bold;padding-left:2px!important;padding-right:2px!important}.exam-text{overflow-wrap:anywhere;word-break:break-word}' +
    '.obs-box{border:1px solid #000;min-height:64px;margin-top:12px;overflow-wrap:anywhere;word-break:break-word}' +
    '.obs-head{border-bottom:1px solid #000;font-weight:700;text-transform:uppercase;padding:3px 5px}.obs-body{padding:5px;min-height:44px}' +
    '.sol-card{width:210px;margin:18px 70px 0 auto;text-align:center;font-size:10.5px;line-height:1.35}.sol-name{font-weight:700}.sol-detail{margin-top:2px}' +
    '.footer{position:fixed;left:0;right:0;bottom:0;text-align:center;font-size:7.3px;line-height:1.02;color:#000;background:#fff;padding-top:2px}' +
    '</style></head><body>' +
    '<div class="brand"><img src="' + h(reqExamesLogoSrc_()) + '"></div>' +
    '<h1>Requisição Eletrônica de Exames</h1>' +
    (dados.urgente ? '<div class="urgent">URGENTE</div>' : '') +
    '<table class="meta-table">' +
      '<tr><td class="meta-label meta-lbl-left">Paciente:</td><td class="meta-value meta-val-left">' + h(dados.paciente) + '</td><td class="meta-label meta-lbl-right">Protocolo:</td><td class="meta-value" colspan="3">' + h(dados.protocolo) + '</td></tr>' +
      '<tr><td class="meta-label meta-lbl-left">Data de Nascimento:</td><td class="meta-value meta-val-left">' + h(dados.nascimento) + '</td><td class="meta-label meta-lbl-right">Médico:</td><td class="meta-value" colspan="3">' + h(dados.medico) + '</td></tr>' +
      '<tr><td class="meta-label meta-lbl-left">Convênio:</td><td class="meta-value" colspan="5">Instituto de Pesquisas em Saúde - Universidade de Caxias do Sul</td></tr>' +
      '<tr><td class="meta-label meta-lbl-left">Local do exame:</td><td class="meta-value meta-val-left">' + h(dados.localExame) + '</td><td class="meta-label meta-date">Data:</td><td class="meta-value">' + h(dados.dataAgendamento) + '</td><td class="meta-label meta-time">Horário:</td><td class="meta-value">' + h(dados.horario) + '</td></tr>' +
      '<tr><td class="meta-label meta-lbl-left">Endereço:</td><td class="meta-value" colspan="5">' + h(dados.endereco) + '</td></tr>' +
    '</table>' +
    '<table class="exam-table"><colgroup><col style="width:28px"><col><col style="width:28px"><col></colgroup><thead><tr><th colspan="4">Relação de Exames e/ou Procedimentos</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
    '<div class="obs-box"><div class="obs-head">Observações</div><div class="obs-body">' + (obs || '&nbsp;') + '</div></div>' +
    '<div class="sol-card">' +
      '<div class="sol-name">' + h(dados.solicitante) + '</div>' +
      (solFormacao ? '<div class="sol-detail">' + h(solFormacao) + '</div>' : '') +
      (solRegistro ? '<div class="sol-detail">' + h(solRegistro) + '</div>' : '') +
    '</div>' +
    '<div class="footer">' + reqExamesRodapeInstitucionalHtml_() + '</div>' +
    '</body></html>';
}

function reqExamesExportErrorSnippet_(response) {
  try {
    var text = String(response.getContentText() || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';
    return text.slice(0, 220);
  } catch (e) {
    return '';
  }
}

function reqExamesAssertGmailDraftAllowed_(requestedByEmail) {
  var requested = codexNormalizeEmail_(requestedByEmail || '');
  if (!requested) {
    try {
      var access = codexAuthorizeWebAppRequestSafe_();
      requested = codexNormalizeEmail_(access && access.userEmail);
    } catch (e1) {
      requested = '';
    }
  }
  var active = codexNormalizeEmail_(codexGetActiveUserEmail_());
  var effective = codexNormalizeEmail_(reqExamesEffectiveUserEmail_());
  if (!requested) requested = active;
  if (requested && effective && requested !== effective) {
    throw new Error('Rascunho nao criado: o WebApp esta executando como ' + effective + ', mas o usuario solicitante e ' + requested + '. Publique a implantacao como USER_ACCESSING para criar o rascunho no Gmail do usuario.');
  }
  if (active && effective && active !== effective) {
    throw new Error('Rascunho nao criado: o WebApp esta executando como ' + effective + ', mas o usuario ativo e ' + active + '. Publique a implantacao como USER_ACCESSING para criar o rascunho no Gmail do usuario.');
  }
  var auth = reqExamesGmailOAuthStatus_();
  if (auth.required) {
    throw new Error('Rascunho nao criado: autorizacao do Gmail pendente. Abra o link de autorizacao e tente novamente: ' + (auth.url || ''));
  }
  if (auth.ok === false) {
    throw new Error('Rascunho nao criado: nao foi possivel verificar a autorizacao do Gmail. ' + (auth.error || ''));
  }
}

function reqExamesOpenSpreadsheetForWrite_() {
  var ss = null;
  try {
    ss = getCodexSpreadsheet_();
  } catch (e) {
    throw reqExamesSpreadsheetPermissionError_(e, 'abrir a planilha principal');
  }
  reqExamesAssertSpreadsheetEditAccess_(ss);
  return ss;
}

function reqExamesAssertSpreadsheetEditAccess_(ss) {
  var email = '';
  try {
    email = Session.getEffectiveUser().getEmail();
  } catch (e0) {
    email = '';
  }
  try {
    var file = DriveApp.getFileById(ss.getId());
    var access = email ? file.getAccess(email) : '';
    var accessText = String(access || '').toUpperCase();
    if (accessText === 'EDIT' || accessText === 'OWNER') return true;
    throw new Error('Acesso atual: ' + String(access || 'desconhecido'));
  } catch (e) {
    throw reqExamesSpreadsheetPermissionError_(e, 'editar a planilha principal');
  }
}

function reqExamesSpreadsheetPermissionError_(err, action) {
  var email = '';
  try {
    email = Session.getEffectiveUser().getEmail();
  } catch (e0) {
    email = '';
  }
  return new Error(
    'Nao foi possivel gerar a Requisicao de Exames porque o WebApp agora executa como o usuario acessando, ' +
    'mas a conta ' + (email || 'atual') + ' nao tem permissao para ' + (action || 'usar') + ' a planilha principal. ' +
    'Compartilhe a planilha principal do CODEX com esse usuario como Editor e tente novamente. Detalhe: ' +
    ((err && err.message) || String(err))
  );
}

function reqExamesSolicitanteEmail_(nome) {
  nome = normText_(nome || '');
  if (!nome) return '';
  try {
    var solicitantes = buscarSolicitantesCompleto() || [];
    for (var i = 0; i < solicitantes.length; i++) {
      var item = solicitantes[i] || {};
      if (normText_(item.nome || '') === nome) {
        return codexNormalizeEmail_(item.email || '');
      }
    }
  } catch (e) {}
  return '';
}

function reqExamesEffectiveUserEmail_() {
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim();
  } catch (e) {
    return '';
  }
}

function reqExamesGmailOAuthStatus_() {
  var scopes = [
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/script.send_mail',
    'https://www.googleapis.com/auth/gmail.settings.basic'
  ];
  try {
    var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, scopes);
    var status = info.getAuthorizationStatus();
    var required = status === ScriptApp.AuthorizationStatus.REQUIRED;
    return {
      ok: true,
      required: required,
      status: String(status || ''),
      url: required ? info.getAuthorizationUrl() : '',
      scopes: scopes
    };
  } catch (e) {
    return {
      ok: false,
      required: false,
      status: 'UNKNOWN',
      url: '',
      error: e.message || String(e),
      scopes: scopes
    };
  }
}



// ══════════════════════════════════════════════════════
//  PDF, E-MAIL E ORGANIZAÇÃO VISUAL
// ══════════════════════════════════════════════════════
function organizarAbas() {
  codexAssertAdmin_();
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
  codexAssertCanWrite_('focarDataHoje', 'Sistema', '');
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
  codexAssertCanWrite_('exportarPDF', 'RequisicaoExames', '');
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

  var dataFormatada   = formatarDataMesCurtoPt_(dataAgendamento);
  var dataArquivo     = formatarDataMesCurtoPt_(dataAgendamento, '-');
  var paciente        = sheet.getRange('E8').getValue();
  var pacienteLimpo   = limparNome(paciente);
  var dataNascRaw     = sheet.getRange('E9').getValue();
  var dataNasc        = (dataNascRaw instanceof Date)
    ? formatarDataMesCurtoPt_(dataNascRaw) : dataNascRaw;
  var medico          = sheet.getRange('H9').getValue();
  var nomeArquivo     = 'IPS-UCS - ' + pacienteLimpo + ' - ' + dataArquivo + '.pdf';
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
    '&r1=0&c1=0&r2=43&c2=10' +
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
  var html = gerarHtmlCabecalhoEmail_('Agendamento de Exames', '#2c3e50') +
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
    (dados.signature ? '<div style="margin-top:12px;">' + dados.signature + '</div>' : '') +
    '</div>';
  return aplicarEspacamentoEmailRequisicao_(html);
}

function aplicarEspacamentoEmailRequisicao_(html) {
  return String(html || '')
    .replace(/<p(\s[^>]*)?>/gi, function(tag, attrs) {
      attrs = attrs || '';
      if (/style\s*=/i.test(attrs)) {
        return '<p' + attrs.replace(/style=(["'])(.*?)\1/i, function(_, quote, style) {
          return 'style=' + quote + 'margin:0 0 18px 0;line-height:1.65;' + style.replace(/margin\s*:[^;]+;?/gi, '').replace(/line-height\s*:[^;]+;?/gi, '') + quote;
        }) + '>';
      }
      return '<p' + attrs + ' style="margin:0 0 18px 0;line-height:1.65;">';
    })
    .replace(/<table(\s[^>]*)?>/gi, function(tag, attrs) {
      attrs = attrs || '';
      if (/style\s*=/i.test(attrs)) {
        return '<table' + attrs.replace(/style=(["'])(.*?)\1/i, function(_, quote, style) {
          return 'style=' + quote + 'margin:20px 0 22px 0;' + style.replace(/margin\s*:[^;]+;?/gi, '') + quote;
        }) + '>';
      }
      return '<table' + attrs + ' style="margin:20px 0 22px 0;">';
    });
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
    var sendAs = Gmail.Users.Settings.SendAs.list('me').sendAs || [];
    for (var i = 0; i < sendAs.length; i++) {
      if (sendAs[i].isDefault) {
        return sendAs[i].signature || '';
      }
    }
  } catch(e) { return ''; }
  return '';
}

function resetarCampos() {
  codexAssertCanWrite_('resetarCampos', 'RequisicaoExames', '');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Requisição de Exames');
  ['I5','E8','E9','E10','E11','H8','H9','H10','J10',
   'C14:C33','G14:G33','B36','H41','H42','H43']
    .forEach(function(r) { sheet.getRange(r).clearContent(); });
  SpreadsheetApp.getUi().alert('Campos resetados com sucesso.');
}



// ══════════════════════════════════════════════════════
//  AGENDA
// ══════════════════════════════════════════════════════
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

function classificarProjetoStatus_(status) {
  var normalizado = normText_(status);
  if (normalizado.indexOf('concluid') >= 0) return 'concluido';
  if (normalizado.indexOf('cancelad') >= 0) return 'cancelado';
  return 'ativo';
}

function getProjetos() {
  var dados = getCodexSheetDataByName_('Projetos');
  if (!dados.length) return [];
  var courierCols = projetoCourierColumnMap_(dados[0] || []);
  var courierTempCols = projetoCourierTemperatureColumnMap_(dados[0] || []);
  var situacaoEnvioCol = projetoSituacaoEnvioColumn_(dados[0] || []);
  var soaConfigCols = projetoSoAConfigColumnMap_(dados[0] || []);
  var statsPorProjeto = getParticipantesStatsPorProjeto_();
  var sivPorProjeto = getProjetosSivPorProjeto_();
  var lista = [];
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (!r[0]) continue;
    var nomeProjeto = String(r[1] || '');
    var nomeNorm = normText_(nomeProjeto);
    var codigoNorm = normText_(r[2]);
    var statsNome = statsPorProjeto[nomeNorm] || {};
    var statsCodigo = codigoNorm && codigoNorm !== nomeNorm ? (statsPorProjeto[codigoNorm] || {}) : {};
    var sivNome = sivPorProjeto[nomeNorm] || {};
    var sivCodigo = codigoNorm && codigoNorm !== nomeNorm ? (sivPorProjeto[codigoNorm] || {}) : {};
    var siv = !sivNome.dataObj ? sivCodigo : (!sivCodigo.dataObj ? sivNome : (sivNome.dataObj >= sivCodigo.dataObj ? sivNome : sivCodigo));
    var ativos = (statsNome.ativos || 0) + (statsCodigo.ativos || 0);
    var falhasTriagem = (statsNome.falhasTriagem || 0) + (statsCodigo.falhasTriagem || 0);
    var totalParticipantes = (statsNome.total || 0) + (statsCodigo.total || 0);
    var meta = Number(r[12] || 0);
    var classificacaoStatus = classificarProjetoStatus_(r[13]);
    lista.push({
      id:            String(r[0]),
      nomeAbreviado: nomeProjeto,
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
      metaRecrutamento: r[12] || '',
      participantesAtivos: ativos,
      falhasTriagem: falhasTriagem,
      totalParticipantes: totalParticipantes,
      percentualRecrutamento: meta > 0 ? Math.round((ativos * 1000) / meta) / 10 : '',
      status:        r[13] || '',
      classificacaoStatus: classificacaoStatus,
      numeroCE:      r[14] || '',
      expedienteCE:  r[15] || '',
      tituloCompleto:r[16] || '',
      courierPrincipalId: courierCols.principal >= 0 ? String(r[courierCols.principal] || '').trim() : '',
      courierAdicional1Id: courierCols.adicional1 >= 0 ? String(r[courierCols.adicional1] || '').trim() : '',
      courierAdicional2Id: courierCols.adicional2 >= 0 ? String(r[courierCols.adicional2] || '').trim() : '',
      courierPrincipalTemperaturas: courierTempCols.principal >= 0 ? String(r[courierTempCols.principal] || '').trim() : '',
      courierAdicional1Temperaturas: courierTempCols.adicional1 >= 0 ? String(r[courierTempCols.adicional1] || '').trim() : '',
      courierAdicional2Temperaturas: courierTempCols.adicional2 >= 0 ? String(r[courierTempCols.adicional2] || '').trim() : '',
      situacaoEnvioAmostras: situacaoEnvioCol >= 0 ? String(r[situacaoEnvioCol] || '').trim() : '',
      soaBaseCalculoPadrao: soaConfigCols.baseCalculoPadrao >= 0 ? soaNormalizarBaseCalculo_(r[soaConfigCols.baseCalculoPadrao]) : '',
      ctmsJornadaAtivo: soaConfigCols.ctmsJornadaAtivo >= 0 && ['sim', 'true', '1'].indexOf(normText_(r[soaConfigCols.ctmsJornadaAtivo])) >= 0,
      dataSiv:       siv.data || '',
      dataSivInicio: siv.inicio || siv.data || '',
      dataSivFim:    siv.fim || siv.data || ''
    });
  }
  return lista;
}

// ════════════════════════════════
//  CALENDÁRIO SoA — visitas por protocolo
// ════════════════════════════════
var SOA_VISITAS_HEADERS_ = [
  'ID_SoA', 'Projeto', 'Código da visita', 'Nome padrão da visita',
  'Ordem', 'Repetição', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observações',
  'Referência (após)', 'Janela dias menos', 'Janela dias mais', 'Braços (IDs)',
  'Ordem manual', 'Base para o cálculo', 'Papel no cronograma',
  'Referência alternativa', 'Critério entre referências'
];

var SOA_BASES_CALCULO_ = {
  MANTER_DATAS_PREVISTAS: 'Manter datas previstas',
  RECALCULAR_VISITA_REALIZADA: 'Recalcular pela visita realizada'
};

var SOA_PAPEIS_CRONOGRAMA_ = {
  NAO_PARTICIPA_CALCULO: 'Não participa do cálculo',
  MARCO_CALCULO: 'Marco de cálculo',
  VISITA_CALCULADA: 'Visita calculada'
};

var SOA_CRITERIOS_REFERENCIAS_ = {
  SELECAO_MANUAL: 'Seleção manual',
  PRIMEIRO_OCORRER: 'O primeiro que ocorrer',
  ULTIMO_OCORRER: 'O último que ocorrer'
};

function soaHeaderIndex_(headerMap, names, fallback) {
  for (var i = 0; i < names.length; i++) {
    var index = headerMap[normalizeHeader_(names[i])];
    if (index !== undefined) return index;
  }
  return fallback;
}

function soaHeaderMap_(headers) {
  var map = {};
  (headers || []).forEach(function(header, index) {
    map[normalizeHeader_(header)] = index;
  });
  return map;
}

function soaDelimitedIds_(value) {
  if (Array.isArray(value)) return value.map(function(item) { return String(item || '').trim(); }).filter(Boolean);
  return String(value || '').split(/[;|,\n]/).map(function(item) { return String(item || '').trim(); }).filter(Boolean);
}

function soaUniqueIds_(values) {
  var seen = {};
  return soaDelimitedIds_(values).filter(function(value) {
    if (seen[value]) return false;
    seen[value] = true;
    return true;
  });
}

function soaArmSignature_(ids) {
  return soaUniqueIds_(ids).sort().join('|');
}

function soaOrdemManual_(value) {
  return value === true || normText_(value) === 'sim';
}

function soaNormalizarBaseCalculo_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var normalized = normText_(raw).replace(/[^a-z0-9]+/g, '');
  if (normalized === 'manterdatasprevistas' || normalized === 'fixaprotocolar') return 'MANTER_DATAS_PREVISTAS';
  if (normalized === 'recalcularpelavisitrealizada' || normalized === 'recalcularvisitarealizada' || normalized === 'rolantevisitarealizada' || normalized === 'rolantepelavisitrealizada') return 'RECALCULAR_VISITA_REALIZADA';
  return '';
}

function soaCycleEquivalentKey_(visita) {
  var values = [visita && visita.codigo, visita && visita.nome];
  for (var i = 0; i < values.length; i++) {
    var value = normText_(values[i]).replace(/\s+/g, ' ').trim();
    if (!value) continue;
    var matched = false;
    value = value.replace(/\bciclo\s*\d+\b/g, function() { matched = true; return 'ciclo #'; });
    value = value.replace(/\bcycle\s*\d+\b/g, function() { matched = true; return 'cycle #'; });
    value = value.replace(/\bc\s*\d+\s*d\s*(\d+)\b/g, function(_all, day) { matched = true; return 'c#d' + day; });
    if (matched) return value.replace(/[^a-z0-9#]+/g, '');
  }
  return '';
}

function soaNormalizarPapelCronograma_(value) {
  var normalized = normText_(value).replace(/[^a-z0-9]+/g, '');
  if (!normalized) return '';
  if (normalized === 'naoparticipadocalculo' || normalized === 'naoparticipacalculo' || normalized === 'anterioraocronogramacalculado') return 'NAO_PARTICIPA_CALCULO';
  if (normalized === 'marcodecalculo' || normalized === 'marcocalculo') return 'MARCO_CALCULO';
  if (normalized === 'visitacalculada') return 'VISITA_CALCULADA';
  return '';
}

function soaNormalizarCriterioReferencias_(value) {
  var normalized = normText_(value).replace(/[^a-z0-9]+/g, '');
  if (!normalized) return '';
  if (normalized === 'selecaomanual') return 'SELECAO_MANUAL';
  if (normalized === 'primeiroocorrer' || normalized === 'oprimeiroqueocorrer') return 'PRIMEIRO_OCORRER';
  if (normalized === 'ultimoocorrer' || normalized === 'oultimoqueocorrer') return 'ULTIMO_OCORRER';
  return '';
}

function soaSugerirOrdemExecucao_(visitas, options) {
  options = options || {};
  var referenciasConhecidas = {};
  (options.referenciasConhecidas || []).forEach(function(id) { referenciasConhecidas[String(id || '').trim()] = true; });
  var especiais = {
    INCLUSAO: 'inicio', RANDOMIZACAO: 'inicio',
    ULTIMA_DOSE: 'terminal', FIM_TRATAMENTO: 'terminal', PROGRESSAO_DOENCA: 'terminal',
    OUTRA: 'outra'
  };
  var ambiguidades = [];
  var ambiguidadeKeys = {};
  var nodes = (visitas || []).map(function(visita, index) {
    var id = String(visita && visita.idSoA || '').trim() || ('__SOA_ORDEM_' + index);
    var ordem = visita && visita.ordem;
    var ordemNumero = ordem === '' || ordem === null || ordem === undefined ? null : Number(ordem);
    var intervalo = visita && visita.intervaloDias;
    var intervaloNumero = intervalo === '' || intervalo === null || intervalo === undefined ? null : Number(intervalo);
    return {
      id: id,
      visita: visita || {},
      index: index,
      ordemRecebida: ordemNumero !== null && isFinite(ordemNumero) ? ordemNumero : '',
      prioridadeRecebida: ordemNumero !== null && isFinite(ordemNumero) ? ordemNumero : 1000000 + index,
      intervalo: intervaloNumero !== null && isFinite(intervaloNumero) ? intervaloNumero : null,
      referencia: String(visita && visita.referencia || '').trim(),
      referenciaAlternativa: String(visita && visita.referenciaAlternativa || '').trim(),
      saidas: {},
      entrada: 0,
      motivos: []
    };
  });
  var byId = {};
  nodes.forEach(function(node) { byId[node.id] = node; });

  function addAmbiguidade(tipo, mensagem, affected) {
    var ids = (affected || []).map(function(node) { return node.id; }).sort();
    var key = tipo + '|' + ids.join('|') + '|' + mensagem;
    if (ambiguidadeKeys[key]) return;
    ambiguidadeKeys[key] = true;
    ambiguidades.push({ tipo: tipo, mensagem: mensagem, idsSoA: ids });
    (affected || []).forEach(function(node) {
      if (node.motivos.indexOf(mensagem) === -1) node.motivos.push(mensagem);
    });
  }

  function addEdge(from, to) {
    if (!from || !to || from.id === to.id || from.saidas[to.id]) return;
    from.saidas[to.id] = true;
    to.entrada++;
  }

  nodes.forEach(function(node) {
    var referencias = [node.referencia, node.referenciaAlternativa].filter(Boolean);
    referencias.forEach(function(referencia) {
      if (byId[referencia]) addEdge(byId[referencia], node);
      else if (referencia === 'VISITA_ANTERIOR') addAmbiguidade('VISITA_ANTERIOR', '“Visita anterior” depende da ordem recebida e precisa de revisão.', [node]);
      else if (referencia === 'OUTRA') addAmbiguidade('REFERENCIA_ESPECIAL', 'A referência especial “Outra” não determina uma posição de execução.', [node]);
      else if (!especiais[referencia]) {
        if (referenciasConhecidas[referencia]) addAmbiguidade('REFERENCIA_FORA_PREVIA', 'A referência já existe fora desta prévia; a posição relativa foi mantida.', [node]);
        else addAmbiguidade('REFERENCIA_AUSENTE', 'A referência ' + referencia + ' não está disponível para ordenar esta visita.', [node]);
      }
    });
    if (!referencias.length) {
      addAmbiguidade('SEM_REFERENCIA', 'Sem referência explícita; a posição recebida foi mantida como desempate.', [node]);
    }
  });

  var siblings = {};
  nodes.forEach(function(node) {
    if (!node.referencia) return;
    if (!siblings[node.referencia]) siblings[node.referencia] = [];
    siblings[node.referencia].push(node);
  });
  Object.keys(siblings).forEach(function(referencia) {
    var group = siblings[referencia];
    if (group.length < 2 || referencia === 'VISITA_ANTERIOR' || referencia === 'OUTRA') return;
    var withInterval = group.filter(function(node) { return node.intervalo !== null; });
    var withoutInterval = group.filter(function(node) { return node.intervalo === null; });
    if (withoutInterval.length) {
      addAmbiguidade('INTERVALO_AUSENTE', 'Há visitas com a mesma referência sem intervalo; a posição recebida foi mantida entre elas.', withoutInterval);
    }
    var byInterval = {};
    withInterval.forEach(function(node) {
      var key = String(node.intervalo);
      if (!byInterval[key]) byInterval[key] = [];
      byInterval[key].push(node);
    });
    var intervals = Object.keys(byInterval).map(Number).sort(function(a, b) { return a - b; });
    intervals.forEach(function(interval) {
      if (byInterval[String(interval)].length > 1) {
        addAmbiguidade('MESMO_INTERVALO', 'Visitas com a mesma referência e o mesmo intervalo não têm sequência determinística.', byInterval[String(interval)]);
      }
    });
    for (var intervalIndex = 0; intervalIndex < intervals.length - 1; intervalIndex++) {
      var current = byInterval[String(intervals[intervalIndex])];
      var next = byInterval[String(intervals[intervalIndex + 1])];
      current.forEach(function(from) { next.forEach(function(to) { addEdge(from, to); }); });
    }
  });

  var rootCache = {};
  function specialRoot(node, stack) {
    if (rootCache[node.id] !== undefined) return rootCache[node.id];
    stack = stack || {};
    if (stack[node.id]) return '';
    stack[node.id] = true;
    if (especiais[node.referencia]) {
      rootCache[node.id] = node.referencia;
    } else if (byId[node.referencia]) {
      rootCache[node.id] = specialRoot(byId[node.referencia], stack);
    } else {
      rootCache[node.id] = '';
    }
    delete stack[node.id];
    return rootCache[node.id];
  }
  var inicio = [];
  var terminal = [];
  var terminaisPorRaiz = {};
  nodes.forEach(function(node) {
    var root = specialRoot(node, {});
    if (root === 'INCLUSAO' || root === 'RANDOMIZACAO') inicio.push(node);
    if (root === 'ULTIMA_DOSE' || root === 'FIM_TRATAMENTO' || root === 'PROGRESSAO_DOENCA') {
      terminal.push(node);
      if (!terminaisPorRaiz[root]) terminaisPorRaiz[root] = [];
      terminaisPorRaiz[root].push(node);
    }
  });
  inicio.forEach(function(from) { terminal.forEach(function(to) { addEdge(from, to); }); });
  var gruposTerminais = ['ULTIMA_DOSE', 'FIM_TRATAMENTO', 'PROGRESSAO_DOENCA'].filter(function(key) { return terminaisPorRaiz[key]; });
  if (gruposTerminais.length > 1) {
    addAmbiguidade('FASES_TERMINAIS', 'Há marcos terminais alternativos; a sequência entre esses grupos precisa de revisão.', gruposTerminais.reduce(function(all, key) { return all.concat(terminaisPorRaiz[key]); }, []));
  }

  function compareReceived(a, b) {
    return a.prioridadeRecebida - b.prioridadeRecebida || a.index - b.index;
  }
  var queue = nodes.filter(function(node) { return node.entrada === 0; }).sort(compareReceived);
  var ordered = [];
  while (queue.length) {
    var currentNode = queue.shift();
    ordered.push(currentNode);
    Object.keys(currentNode.saidas).forEach(function(targetId) {
      var target = byId[targetId];
      target.entrada--;
      if (target.entrada === 0) {
        queue.push(target);
        queue.sort(compareReceived);
      }
    });
  }
  if (ordered.length < nodes.length) {
    var remaining = nodes.filter(function(node) { return ordered.indexOf(node) === -1; }).sort(compareReceived);
    addAmbiguidade('CICLO', 'Há um ciclo de referências; essas visitas permaneceram na ordem recebida.', remaining);
    ordered = ordered.concat(remaining);
  }
  var suggestedById = {};
  ordered.forEach(function(node, index) { suggestedById[node.id] = index + 1; });
  var detalhes = nodes.map(function(node) {
    return {
      idSoA: node.id,
      ordemRecebida: node.ordemRecebida,
      ordemSugerida: suggestedById[node.id],
      ordemAmbigua: node.motivos.length > 0,
      motivosOrdem: node.motivos.slice()
    };
  });
  var receivedSequence = nodes.slice().sort(compareReceived);
  return {
    idsSoA: ordered.map(function(node) { return node.id; }),
    visitas: detalhes,
    ambiguidades: ambiguidades,
    mudancas: ordered.filter(function(node, index) { return !receivedSequence[index] || receivedSequence[index].id !== node.id; }).length
  };
}

function soaEnsureHeaders_(sheet) {
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0] || [];
  if (!headers.length || !headers.some(function(header) { return String(header || '').trim(); })) {
    sheet.getRange(1, 1, 1, SOA_VISITAS_HEADERS_.length).setValues([SOA_VISITAS_HEADERS_]);
    return SOA_VISITAS_HEADERS_.slice();
  }
  var map = soaHeaderMap_(headers);
  var missing = SOA_VISITAS_HEADERS_.filter(function(header) {
    var aliases = normalizeHeader_(header) === normalizeHeader_('Base para o cálculo')
      ? ['Base para o cálculo', 'Base para o calculo', 'Tipo de referência', 'Tipo de referencia', 'Tipo de cálculo da referência', 'Tipo de calculo da referencia']
      : [header];
    return aliases.every(function(alias) { return map[normalizeHeader_(alias)] === undefined; });
  });
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }
  return headers;
}

function getSoAVisitasSheet_(createIfMissing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetByPossibleNames_(ss, ['SoA_Visitas', 'Calendario_SoA', 'Calendário SoA']);
  if (!sheet && createIfMissing) {
    if (!ss || typeof ss.insertSheet !== 'function') throw new Error('Não foi possível criar a aba do calendário SoA.');
    sheet = ss.insertSheet('SoA_Visitas');
    sheet.getRange(1, 1, 1, SOA_VISITAS_HEADERS_.length).setValues([SOA_VISITAS_HEADERS_]);
  }
  return sheet;
}

function getSoAVisitasProjeto(projeto) {
  var projetoNorm = normText_(projeto);
  if (!projetoNorm) return [];
  var sheet = getSoAVisitasSheet_(false);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getDataRange().getValues();
  var map = soaHeaderMap_(rows[0] || []);
  var c = {
    id: soaHeaderIndex_(map, ['ID_SoA'], 0), projeto: soaHeaderIndex_(map, ['Projeto'], 1),
    codigo: soaHeaderIndex_(map, ['Código da visita', 'Codigo da visita'], 2),
    nome: soaHeaderIndex_(map, ['Nome padrão da visita', 'Nome padrao da visita'], 3),
    ordem: soaHeaderIndex_(map, ['Ordem'], 4), repeticao: soaHeaderIndex_(map, ['Repetição', 'Repeticao'], 5),
    intervalo: soaHeaderIndex_(map, ['Intervalo (dias)', 'Intervalo dias'], 6),
    aliases: soaHeaderIndex_(map, ['Aliases', 'Apelidos'], 7), ativo: soaHeaderIndex_(map, ['Ativo', 'Status'], 8),
    observacoes: soaHeaderIndex_(map, ['Observações', 'Observacoes'], 9),
    referencia: soaHeaderIndex_(map, ['Referência (após)', 'Referencia (apos)', 'Referência da visita', 'Anchor'], 10),
    janelaMenos: soaHeaderIndex_(map, ['Janela dias menos', 'Janela antes (dias)', 'Janela menos'], 11),
    janelaMais: soaHeaderIndex_(map, ['Janela dias mais', 'Janela depois (dias)', 'Janela mais'], 12),
    bracos: soaHeaderIndex_(map, ['Braços (IDs)', 'Bracos (IDs)', 'Braços', 'Bracos'], 13),
    ordemManual: soaHeaderIndex_(map, ['Ordem manual'], 14),
    baseCalculo: soaHeaderIndex_(map, ['Base para o cálculo', 'Base para o calculo', 'Tipo de referência', 'Tipo de referencia', 'Tipo de cálculo da referência', 'Tipo de calculo da referencia']),
    papelCronograma: soaHeaderIndex_(map, ['Papel no cronograma']),
    referenciaAlternativa: soaHeaderIndex_(map, ['Referência alternativa', 'Referencia alternativa']),
    criterioReferencias: soaHeaderIndex_(map, ['Critério entre referências', 'Criterio entre referencias'])
  };
  var baseCalculoPadrao = getProjetoBaseCalculoPadrao_(projeto);
  var visitas = rows.slice(1).map(function(row) {
    var aliases = String(row[c.aliases] || '').split(/[;|\n]/).map(function(value) { return String(value || '').trim(); }).filter(Boolean);
    var ordemRaw = row[c.ordem];
    var intervaloRaw = row[c.intervalo];
    var janelaMenosRaw = row[c.janelaMenos];
    var janelaMaisRaw = row[c.janelaMais];
    var baseCalculo = soaNormalizarBaseCalculo_(row[c.baseCalculo]);
    return {
      idSoA: String(row[c.id] || '').trim(),
      projeto: String(row[c.projeto] || '').trim(),
      codigo: String(row[c.codigo] || '').trim(),
      nome: String(row[c.nome] || '').trim(),
      ordem: ordemRaw === '' || ordemRaw === null || ordemRaw === undefined ? '' : Number(ordemRaw),
      repeticao: String(row[c.repeticao] || '').trim(),
      intervaloDias: intervaloRaw === '' || intervaloRaw === null || intervaloRaw === undefined ? '' : Number(intervaloRaw),
      aliases: aliases,
      ativo: String(row[c.ativo] || 'Sim').trim() !== 'Não' && String(row[c.ativo] || 'Sim').trim().toLowerCase() !== 'nao',
      observacoes: String(row[c.observacoes] || '').trim(),
      referencia: String(row[c.referencia] || '').trim(),
      janelaDiasMenos: janelaMenosRaw === '' || janelaMenosRaw === null || janelaMenosRaw === undefined ? '' : Number(janelaMenosRaw),
      janelaDiasMais: janelaMaisRaw === '' || janelaMaisRaw === null || janelaMaisRaw === undefined ? '' : Number(janelaMaisRaw),
      bracoIds: soaUniqueIds_(row[c.bracos]),
      ordemManual: soaOrdemManual_(row[c.ordemManual]),
      baseCalculo: baseCalculo,
      baseCalculoEfetiva: baseCalculo || baseCalculoPadrao,
      baseCalculoHerdada: !baseCalculo && !!baseCalculoPadrao,
      papelCronograma: soaNormalizarPapelCronograma_(row[c.papelCronograma]),
      referenciaAlternativa: String(row[c.referenciaAlternativa] || '').trim(),
      criterioReferencias: soaNormalizarCriterioReferencias_(row[c.criterioReferencias])
    };
  }).filter(function(item) {
    return item.nome && normText_(item.projeto) === projetoNorm;
  }).sort(function(a, b) {
    var ao = a.ordem === '' || !isFinite(a.ordem) ? 999999 : a.ordem;
    var bo = b.ordem === '' || !isFinite(b.ordem) ? 999999 : b.ordem;
    return ao - bo || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
  });
  var sugestao = soaSugerirOrdemExecucao_(visitas);
  var sugestaoPorId = {};
  sugestao.visitas.forEach(function(item) { sugestaoPorId[item.idSoA] = item; });
  visitas.forEach(function(item) {
    var ordem = sugestaoPorId[item.idSoA] || {};
    item.ordemRecebida = ordem.ordemRecebida;
    item.ordemSugerida = ordem.ordemSugerida;
    item.ordemAmbigua = ordem.ordemAmbigua === true;
    item.motivosOrdem = ordem.motivosOrdem || [];
    item.ciclos = soaCycleNumbersFromVisit_(item);
  });
  return visitas;
}

function agendaSoAFiltrarSugestoesParticipante_(visitas, eventos, conciliacoesPorAgendaId) {
  var concluidasVinculadas = {};
  var historicasSemVinculo = 0;
  var vinculadas = {};
  (eventos || []).forEach(function(evento) {
    if (!evento || evento.cancelada) return;
    var idSoA = String((conciliacoesPorAgendaId || {})[String(evento.id || '')] || '').trim();
    if (idSoA) {
      vinculadas[idSoA] = true;
      if (evento.concluida) concluidasVinculadas[idSoA] = true;
    } else if (evento.concluida) {
      historicasSemVinculo++;
    }
  });
  var ultimoIndiceVinculado = -1;
  (visitas || []).forEach(function(visita, indice) {
    if (visita && visita.ativo !== false && visita.nome && vinculadas[String(visita.idSoA || '')]) ultimoIndiceVinculado = indice;
  });
  var sugestoes = (visitas || []).filter(function(visita, indice) {
    if (!visita || visita.ativo === false || !visita.nome) return false;
    if (ultimoIndiceVinculado >= 0) return indice > ultimoIndiceVinculado;
    return !concluidasVinculadas[String(visita.idSoA || '')];
  });
  return {
    visitas: sugestoes,
    concluidasOcultadas: Object.keys(concluidasVinculadas).length,
    historicasSemVinculo: historicasSemVinculo,
    visitasAnterioresOcultadas: ultimoIndiceVinculado + 1
  };
}

function getAgendaVisitasSoASugeridas(payload) {
  payload = payload || {};
  var projeto = String(payload.projeto || '').trim();
  var participante = String(payload.participante || '').trim();
  var participanteId = String(payload.participanteId || '').trim();
  var agendaIdExcluido = String(payload.agendaId || '').trim();
  var visitas = getSoAVisitasProjeto(projeto).filter(function(visita) { return visita && visita.ativo !== false && visita.nome; });
  if (!participante || !projeto) return agendaSoAFiltrarSugestoesParticipante_(visitas, [], {});

  var participanteNorm = normText_(participante);
  var participanteIdNorm = normText_(participanteId);
  var projetoNorm = normText_(projeto);
  var agenda = getAgendaSheetForRead_();
  var eventos = [];
  if (agenda && agenda.getLastRow() >= 2) {
    var rows = agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol).getValues();
    rows.forEach(function(row) {
      var idx = AGENDA_CFG.idx;
      var agendaId = String(row[idx.id] || '').trim();
      if (!AgendaServerRules_.isVisit(row[idx.tipo]) || agendaId === agendaIdExcluido || AgendaServerRules_.isCancelled(row[idx.status])) return;
      var mesmoParticipante = participanteIdNorm && normText_(row[idx.idParticipante]) === participanteIdNorm;
      if (!mesmoParticipante) mesmoParticipante = normText_(row[idx.participante]) === participanteNorm;
      if (!mesmoParticipante || normText_(row[idx.projeto]) !== projetoNorm) return;
      eventos.push({ id: agendaId, concluida: AgendaServerRules_.isCompleted(row[idx.status]), cancelada: false });
    });
  }
  return agendaSoAFiltrarSugestoesParticipante_(visitas, eventos, getAgendaSoAConciliacoesPorAgendaId_(eventos.map(function(evento) { return evento.id; })));
}

function soaCycleNumbersFromText_(value) {
  var text = String(value || '');
  var found = {};
  var numbers = [];
  function collect(regex) {
    var match;
    while ((match = regex.exec(text)) !== null) {
      var number = Number(match[1]);
      if (!isFinite(number) || number < 1 || Math.floor(number) !== number || found[number]) continue;
      found[number] = true;
      numbers.push(number);
    }
  }
  collect(/\b(?:ciclo|cycle)\s*0*(\d+)\b/gi);
  collect(/\bC0*(\d+)D\d+\b/gi);
  return numbers.sort(function(a, b) { return a - b; });
}

function soaCycleNumbersFromVisit_(visit) {
  var found = {};
  var values = [visit && visit.codigo, visit && visit.nome, visit && visit.repeticao].concat(visit && visit.aliases || []);
  values.forEach(function(value) {
    soaCycleNumbersFromText_(value).forEach(function(number) { found[number] = true; });
  });
  return Object.keys(found).map(Number).sort(function(a, b) { return a - b; });
}

function soaCycleReplaceText_(value, sourceCycle, targetCycle) {
  var text = String(value || '');
  var source = String(Number(sourceCycle));
  var target = String(Number(targetCycle));
  var escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp('\\b(Ciclo\\s*)0*' + escaped + '\\b', 'gi'), function(_match, prefix) { return prefix + target; });
  text = text.replace(new RegExp('\\b(Cycle\\s*)0*' + escaped + '\\b', 'gi'), function(_match, prefix) { return prefix + target; });
  text = text.replace(new RegExp('\\b(C)0*' + escaped + '(?=D\\d+\\b)', 'gi'), function(_match, prefix) { return prefix + target; });
  return text;
}

function soaCycleParseTargets_(value, sourceCycle) {
  var raw = Array.isArray(value) ? value.join(',') : String(value || '');
  raw = raw.replace(/[–—−]/g, '-').trim();
  if (!raw) throw new Error('Informe ao menos um ciclo de destino.');
  var found = {};
  var targets = [];
  raw.split(/[;,\s]+/).filter(Boolean).forEach(function(token) {
    var range = token.match(/^(\d+)-(\d+)$/);
    var start = range ? Number(range[1]) : Number(token);
    var end = range ? Number(range[2]) : start;
    if (!isFinite(start) || !isFinite(end) || start < 1 || end < 1 || Math.floor(start) !== start || Math.floor(end) !== end || start > 999 || end > 999) {
      throw new Error('Use ciclos inteiros entre 1 e 999, por exemplo 2–12.');
    }
    if (end < start) throw new Error('O intervalo de ciclos ' + token + ' está invertido.');
    for (var cycle = start; cycle <= end; cycle++) {
      if (cycle === Number(sourceCycle) || found[cycle]) continue;
      found[cycle] = true;
      targets.push(cycle);
      if (targets.length > 100) throw new Error('Gere no máximo 100 ciclos por operação.');
    }
  });
  if (!targets.length) throw new Error('Os destinos devem incluir ao menos um ciclo diferente do modelo.');
  return targets.sort(function(a, b) { return a - b; });
}

function soaCycleComparable_(visit) {
  return JSON.stringify([
    normText_(visit.codigo), normText_(visit.nome), String(visit.repeticao || '').trim(),
    visit.intervaloDias === '' ? '' : Number(visit.intervaloDias),
    visit.janelaDiasMenos === '' ? '' : Number(visit.janelaDiasMenos),
    visit.janelaDiasMais === '' ? '' : Number(visit.janelaDiasMais),
    soaArmSignature_(visit.bracoIds), String(visit.referencia || '').trim(), String(visit.baseCalculo || '').trim(),
    String(visit.papelCronograma || '').trim(), String(visit.referenciaAlternativa || '').trim(), String(visit.criterioReferencias || '').trim(),
    soaDelimitedIds_(visit.aliases).map(normText_).join('|'), visit.ativo === false ? false : true,
    String(visit.observacoes || '').trim()
  ]);
}

function soaPrepareCycleReplication_(payload) {
  payload = payload || {};
  var projeto = String(payload.projeto || '').trim();
  var sourceCycle = Number(payload.cicloModelo);
  if (!projeto) throw new Error('Informe o projeto do calendário SoA.');
  if (!isFinite(sourceCycle) || sourceCycle < 1 || Math.floor(sourceCycle) !== sourceCycle) throw new Error('Selecione um ciclo-modelo válido.');
  var targetCycles = soaCycleParseTargets_(payload.ciclosDestino, sourceCycle);
  var existing = getSoAVisitasProjeto(projeto);
  var model = existing.filter(function(visit) { return soaCycleNumbersFromVisit_(visit).indexOf(sourceCycle) !== -1; });
  if (!model.length) throw new Error('O Ciclo ' + sourceCycle + ' não possui visitas reconhecíveis para replicar.');
  var modelById = {};
  model.forEach(function(visit) { modelById[String(visit.idSoA || '')] = visit; });
  var existingById = {};
  existing.forEach(function(visit) { if (visit.idSoA) existingById[String(visit.idSoA)] = visit; });
  var maxOrder = existing.reduce(function(max, visit) {
    var order = Number(visit.ordem);
    return isFinite(order) ? Math.max(max, order) : max;
  }, 0);
  var generated = [];
  var warnings = [];
  var errors = [];
  var nextOrder = maxOrder;
  var plansByTarget = {};

  targetCycles.forEach(function(targetCycle) {
    plansByTarget[targetCycle] = model.map(function(sourceVisit, index) {
      var code = soaCycleReplaceText_(sourceVisit.codigo, sourceCycle, targetCycle);
      var name = soaCycleReplaceText_(sourceVisit.nome, sourceCycle, targetCycle);
      var arms = soaUniqueIds_(sourceVisit.bracoIds);
      var unchangedKey = code ? normText_(code) === normText_(sourceVisit.codigo) : normText_(name) === normText_(sourceVisit.nome);
      var exact = existing.filter(function(visit) {
        if (code) return normText_(visit.codigo) === normText_(code) && soaArmSignature_(visit.bracoIds) === soaArmSignature_(arms);
        return normText_(visit.nome) === normText_(name) && soaArmSignature_(visit.bracoIds) === soaArmSignature_(arms);
      })[0] || null;
      var codeConflict = code && !exact ? existing.filter(function(visit) {
        return normText_(visit.codigo) === normText_(code) && soaArmSignature_(visit.bracoIds) !== soaArmSignature_(arms);
      })[0] || null : null;
      return {
        source: sourceVisit,
        index: index,
        codigo: code,
        nome: name,
        bracoIds: arms,
        existente: unchangedKey ? null : exact,
        conflito: codeConflict,
        chaveSemCiclo: unchangedKey,
        provisionalId: '__NOVO_C' + targetCycle + '_' + String(sourceVisit.idSoA || index)
      };
    });
  });

  function planTargetId_(plan) {
    return plan.existente ? plan.existente.idSoA : plan.provisionalId;
  }

  function resolveShiftedReference_(sourceVisit, referenceValue, targetCycle, idMap, label) {
    var referenceId = String(referenceValue || '');
    if (modelById[referenceId]) return idMap[referenceId];
    var referenceVisit = existingById[referenceId];
    if (!referenceVisit) return referenceId;
    var referenceCycles = soaCycleNumbersFromVisit_(referenceVisit);
    if (!referenceCycles.length) return referenceId;
    if (referenceCycles.length !== 1) {
      errors.push('A ' + (label || 'referência') + ' de ' + (sourceVisit.codigo || sourceVisit.nome) + ' contém mais de um ciclo e não pode ser remapeada automaticamente.');
      return referenceId;
    }
    var shiftedCycle = referenceCycles[0] + (targetCycle - sourceCycle);
    if (shiftedCycle < 1) {
      errors.push('A ' + (label || 'referência') + ' de ' + (sourceVisit.codigo || sourceVisit.nome) + ' resultaria em um ciclo inválido no destino ' + targetCycle + '.');
      return referenceId;
    }
    var shiftedCode = soaCycleReplaceText_(referenceVisit.codigo, referenceCycles[0], shiftedCycle);
    var shiftedName = soaCycleReplaceText_(referenceVisit.nome, referenceCycles[0], shiftedCycle);
    var armSignature = soaArmSignature_(referenceVisit.bracoIds);
    var matches = [];
    existing.forEach(function(candidate) {
      var sameKey = shiftedCode ? normText_(candidate.codigo) === normText_(shiftedCode) : normText_(candidate.nome) === normText_(shiftedName);
      if (sameKey && soaArmSignature_(candidate.bracoIds) === armSignature) matches.push(String(candidate.idSoA || ''));
    });
    Object.keys(plansByTarget).forEach(function(cycle) {
      plansByTarget[cycle].forEach(function(plan) {
        var sameKey = shiftedCode ? normText_(plan.codigo) === normText_(shiftedCode) : normText_(plan.nome) === normText_(shiftedName);
        if (sameKey && soaArmSignature_(plan.bracoIds) === armSignature) matches.push(String(planTargetId_(plan) || ''));
      });
    });
    matches = soaUniqueIds_(matches);
    if (matches.length === 1) return matches[0];
    var targetLabel = shiftedCode || shiftedName || ('Ciclo ' + shiftedCycle);
    errors.push(matches.length
      ? 'A ' + (label || 'referência') + ' deslocada ' + targetLabel + ' é ambígua e precisa ser revisada.'
      : 'A ' + (label || 'referência') + ' deslocada ' + targetLabel + ' não foi encontrada; revise o ciclo antes de criar as visitas.');
    return referenceId;
  }

  targetCycles.forEach(function(targetCycle) {
    var plans = plansByTarget[targetCycle];
    var idMap = {};
    plans.forEach(function(plan) { idMap[String(plan.source.idSoA || '')] = planTargetId_(plan); });
    var targetExisting = 0;
    plans.forEach(function(plan) {
      var sourceVisit = plan.source;
      var reference = resolveShiftedReference_(sourceVisit, sourceVisit.referencia, targetCycle, idMap, 'referência');
      var alternativeReference = resolveShiftedReference_(sourceVisit, sourceVisit.referenciaAlternativa, targetCycle, idMap, 'referência alternativa');
      var draft = {
        idSoA: plan.existente ? plan.existente.idSoA : plan.provisionalId,
        projeto: projeto,
        cicloDestino: targetCycle,
        codigo: plan.codigo,
        nome: plan.nome,
        ordem: plan.existente ? plan.existente.ordem : (plan.conflito ? plan.conflito.ordem : (plan.chaveSemCiclo ? '' : ++nextOrder)),
        repeticao: soaCycleReplaceText_(sourceVisit.repeticao, sourceCycle, targetCycle),
        intervaloDias: sourceVisit.intervaloDias,
        aliases: (sourceVisit.aliases || []).map(function(alias) { return soaCycleReplaceText_(alias, sourceCycle, targetCycle); }),
        ativo: sourceVisit.ativo !== false,
        observacoes: String(sourceVisit.observacoes || ''),
        referencia: reference,
        referenciaCodigo: '',
        referenciaAlternativa: alternativeReference,
        baseCalculo: sourceVisit.baseCalculo || '',
        papelCronograma: sourceVisit.papelCronograma || '',
        criterioReferencias: sourceVisit.criterioReferencias || '',
        janelaDiasMenos: sourceVisit.janelaDiasMenos,
        janelaDiasMais: sourceVisit.janelaDiasMais,
        bracoIds: plan.bracoIds.slice(),
        origemIdSoA: sourceVisit.idSoA,
        origemCodigo: sourceVisit.codigo,
        status: 'NOVA',
        diferencas: []
      };
      if (plan.chaveSemCiclo) {
        draft.status = 'CONFLITO';
        draft.diferencas = ['O código ou nome principal não contém o número do ciclo para substituir.'];
        errors.push('A visita ' + (sourceVisit.codigo || sourceVisit.nome) + ' não identifica o Ciclo ' + sourceCycle + ' no código ou nome principal.');
      } else if (plan.conflito) {
        draft.status = 'CONFLITO';
        draft.existenteIdSoA = plan.conflito.idSoA;
        draft.diferencas = ['O código já existe com outra associação de braços.'];
        errors.push('O código ' + (draft.codigo || draft.nome) + ' já existe no Ciclo ' + targetCycle + ' com braços diferentes.');
        targetExisting++;
      } else if (plan.existente) {
        draft.status = soaCycleComparable_(draft) === soaCycleComparable_(plan.existente) ? 'EXISTENTE_IGUAL' : 'EXISTENTE_DIFERENTE';
        draft.existenteIdSoA = plan.existente.idSoA;
        if (normText_(draft.nome) !== normText_(plan.existente.nome)) draft.diferencas.push('nome');
        if (String(draft.intervaloDias) !== String(plan.existente.intervaloDias)) draft.diferencas.push('intervalo');
        if (String(draft.janelaDiasMenos) !== String(plan.existente.janelaDiasMenos) || String(draft.janelaDiasMais) !== String(plan.existente.janelaDiasMais)) draft.diferencas.push('janela');
        if (soaArmSignature_(draft.bracoIds) !== soaArmSignature_(plan.existente.bracoIds)) draft.diferencas.push('braços');
        if (String(draft.referencia) !== String(plan.existente.referencia)) draft.diferencas.push('referência');
        if (String(draft.baseCalculo || '') !== String(plan.existente.baseCalculo || '')) draft.diferencas.push('base do cálculo');
        if (String(draft.papelCronograma || '') !== String(plan.existente.papelCronograma || '')) draft.diferencas.push('papel no cronograma');
        if (String(draft.referenciaAlternativa || '') !== String(plan.existente.referenciaAlternativa || '')) draft.diferencas.push('referência alternativa');
        if (String(draft.criterioReferencias || '') !== String(plan.existente.criterioReferencias || '')) draft.diferencas.push('critério entre referências');
        if (String(draft.repeticao) !== String(plan.existente.repeticao)) draft.diferencas.push('repetição');
        if (soaDelimitedIds_(draft.aliases).map(normText_).join('|') !== soaDelimitedIds_(plan.existente.aliases).map(normText_).join('|')) draft.diferencas.push('aliases');
        if ((draft.ativo === false) !== (plan.existente.ativo === false)) draft.diferencas.push('status');
        if (String(draft.observacoes) !== String(plan.existente.observacoes)) draft.diferencas.push('observações');
        targetExisting++;
      }
      generated.push(draft);
    });
    if (targetExisting) warnings.push('Ciclo ' + targetCycle + ': ' + targetExisting + ' visita(s) já existente(s) serão preservadas sem alteração.');
  });

  var newVisits = generated.filter(function(visit) { return visit.status === 'NOVA'; });
  var stockItems = getItensEstoque().itens.filter(function(item) {
    return normText_(item.projeto) === normText_(projeto) && estoqueTipoPermiteVinculoSoA_(item.tipo);
  });
  var stockLinkPlans = [];
  stockItems.forEach(function(item) {
    var sourceIds = {};
    soaUniqueIds_(item.visitasAplicaveisIds).forEach(function(id) { sourceIds[id] = true; });
    var targetVisits = newVisits.filter(function(visit) { return sourceIds[String(visit.origemIdSoA || '')]; });
    if (!targetVisits.length) return;
    stockLinkPlans.push({
      rowNumber: Number(item.id),
      idItem: item.idItem,
      descricao: item.descricao,
      tipo: item.tipo,
      visitasAtuaisIds: soaUniqueIds_(item.visitasAplicaveisIds),
      destinosProvisoriosIds: targetVisits.map(function(visit) { return visit.idSoA; })
    });
    targetVisits.forEach(function(visit) {
      visit.modelosEstoqueReplicados = Number(visit.modelosEstoqueReplicados || 0) + 1;
    });
  });
  var stockLinkCount = stockLinkPlans.reduce(function(total, plan) { return total + plan.destinosProvisoriosIds.length; }, 0);
  var signatureData = generated.map(function(visit) {
    return [visit.cicloDestino, visit.origemIdSoA, visit.codigo, visit.nome, visit.referencia, visit.status, visit.existenteIdSoA || '', visit.modelosEstoqueReplicados || 0, soaCycleComparable_(visit)];
  });
  var stockSignature = stockLinkPlans.map(function(plan) { return [plan.rowNumber, plan.idItem, plan.visitasAtuaisIds, plan.destinosProvisoriosIds]; });
  var signature = JSON.stringify([projeto, sourceCycle, targetCycles, signatureData, stockSignature]);
  return {
    ok: errors.length === 0,
    podeGravar: errors.length === 0 && newVisits.length > 0,
    projeto: projeto,
    cicloModelo: sourceCycle,
    ciclosDestino: targetCycles,
    visitasModelo: model.length,
    visitas: generated,
    novas: newVisits.length,
    existentes: generated.filter(function(visit) { return visit.status.indexOf('EXISTENTE_') === 0; }).length,
    conflitos: generated.filter(function(visit) { return visit.status === 'CONFLITO'; }).length,
    modelosEstoque: stockLinkPlans.length,
    novosVinculosEstoque: stockLinkCount,
    vinculosEstoque: stockLinkPlans,
    avisos: warnings,
    erros: errors,
    assinaturaPrevia: signature
  };
}

function validarReplicacaoCiclosSoA(payload) {
  return soaPrepareCycleReplication_(payload);
}

function criarCiclosSoAPorReplicacao(payload) {
  payload = payload || {};
  codexAssertCanWrite_('criarCiclosSoAPorReplicacao', 'Cadastros', payload.projeto || 'SoA');
  return codexWithDocumentLock_('criarCiclosSoAPorReplicacao', function() {
    var prepared = soaPrepareCycleReplication_(payload);
    if (!prepared.ok) throw new Error('A replicação contém conflitos: ' + prepared.erros.join(' '));
    if (!payload.assinaturaPrevia || String(payload.assinaturaPrevia) !== prepared.assinaturaPrevia) {
      throw new Error('O calendário mudou desde a prévia. Gere uma nova prévia antes de gravar.');
    }
    if (!prepared.podeGravar) throw new Error('Não há visitas novas para gravar.');
    var sheet = getSoAVisitasSheet_(true);
    var headers = soaEnsureHeaders_(sheet);
    var map = soaHeaderMap_(headers);
    var newVisits = prepared.visitas.filter(function(visit) { return visit.status === 'NOVA'; });
    var estoqueSheet = null;
    var estoqueVisitasCol = -1;
    if (prepared.novosVinculosEstoque) {
      estoqueSheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);
      if (!estoqueSheet || estoqueSheet.getLastRow() < 2) throw new Error('O cadastro de itens mudou desde a prévia. Gere uma nova prévia antes de gravar.');
      var estoqueHeaders = estoqueSheet.getRange(1, 1, 1, estoqueSheet.getLastColumn()).getValues()[0];
      estoqueVisitasCol = getItensEstoqueColumnMap_(estoqueHeaders).visitasAplicaveis;
      if (estoqueVisitasCol < 0) throw new Error('A coluna de visitas aplicáveis dos itens não foi encontrada.');
      prepared.vinculosEstoque.forEach(function(plan) {
        if (!isFinite(plan.rowNumber) || plan.rowNumber < 2 || plan.rowNumber > estoqueSheet.getLastRow()) {
          throw new Error('O cadastro de itens mudou desde a prévia. Gere uma nova prévia antes de gravar.');
        }
      });
    }
    var realIds = {};
    newVisits.forEach(function(visit) { realIds[visit.idSoA] = 'SOA-' + gerarIdLoteEstoque_(); });
    var rows = newVisits.map(function(visit) {
      var row = Array(headers.length).fill('');
      function put(names, value, fallback) {
        var index = soaHeaderIndex_(map, names, fallback);
        if (index !== undefined && index >= 0) row[index] = value;
      }
      put(['ID_SoA'], realIds[visit.idSoA], 0);
      put(['Projeto'], visit.projeto, 1);
      put(['Código da visita', 'Codigo da visita'], visit.codigo, 2);
      put(['Nome padrão da visita', 'Nome padrao da visita'], visit.nome, 3);
      put(['Ordem'], visit.ordem, 4);
      put(['Repetição', 'Repeticao'], visit.repeticao, 5);
      put(['Intervalo (dias)', 'Intervalo dias'], visit.intervaloDias, 6);
      put(['Aliases', 'Apelidos'], soaDelimitedIds_(visit.aliases).join('; '), 7);
      put(['Ativo', 'Status'], visit.ativo === false ? 'Não' : 'Sim', 8);
      put(['Observações', 'Observacoes'], visit.observacoes, 9);
      put(['Referência (após)', 'Referencia (apos)', 'Referência da visita', 'Anchor'], realIds[visit.referencia] || visit.referencia, 10);
      put(['Janela dias menos', 'Janela antes (dias)', 'Janela menos'], visit.janelaDiasMenos, 11);
      put(['Janela dias mais', 'Janela depois (dias)', 'Janela mais'], visit.janelaDiasMais, 12);
      put(['Braços (IDs)', 'Bracos (IDs)', 'Braços', 'Bracos'], visit.bracoIds.join('; '), 13);
      put(['Ordem manual'], 'Não', 14);
      put(['Base para o cálculo', 'Base para o calculo', 'Tipo de referência', 'Tipo de referencia', 'Tipo de cálculo da referência', 'Tipo de calculo da referencia'], visit.baseCalculo || '');
      put(['Papel no cronograma'], visit.papelCronograma || '');
      put(['Referência alternativa', 'Referencia alternativa'], visit.referenciaAlternativa || '');
      put(['Critério entre referências', 'Criterio entre referencias'], visit.criterioReferencias || '');
      return row;
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    prepared.vinculosEstoque.forEach(function(plan) {
      var destinosReais = plan.destinosProvisoriosIds.map(function(id) { return realIds[id] || id; });
      var finalIds = soaUniqueIds_(plan.visitasAtuaisIds.concat(destinosReais));
      estoqueSheet.getRange(plan.rowNumber, estoqueVisitasCol + 1).setValue(finalIds.join('; '));
    });
    if (prepared.novosVinculosEstoque) CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return {
      ok: true,
      msg: rows.length + ' visita(s) criada(s) por replicação e ' + prepared.novosVinculosEstoque + ' vínculo(s) de estoque copiado(s).',
      criadas: rows.length,
      preservadas: prepared.existentes,
      vinculosEstoqueCriados: prepared.novosVinculosEstoque
    };
  });
}

function salvarSoAVisita(payload) {
  payload = payload || {};
  codexAssertCanWrite_('salvarSoAVisita', 'Cadastros', payload.idSoA || payload.projeto || 'SoA');
  var projeto = String(payload.projeto || '').trim();
  var nome = String(payload.nome || payload.nomePadrao || '').trim();
  if (!projeto) throw new Error('Informe o projeto do calendário SoA.');
  if (!nome) throw new Error('Informe o nome padrão da visita.');
  var ordem = payload.ordem === '' || payload.ordem === null || payload.ordem === undefined ? '' : Number(payload.ordem);
  if (ordem !== '' && (!isFinite(ordem) || ordem < 0 || Math.floor(ordem) !== ordem)) throw new Error('A ordem deve ser um número inteiro maior ou igual a zero.');
  var intervalo = payload.intervaloDias === '' || payload.intervaloDias === null || payload.intervaloDias === undefined ? '' : Number(payload.intervaloDias);
  if (intervalo !== '' && (!isFinite(intervalo) || intervalo < 0 || Math.floor(intervalo) !== intervalo)) throw new Error('O intervalo deve ser um número inteiro de dias.');
  var referencia = String(payload.referencia || '').trim();
  var baseCalculoRaw = String(payload.baseCalculo || payload.tipoCalculoReferencia || payload.tipoReferenciaCalculo || '').trim();
  var baseCalculo = soaNormalizarBaseCalculo_(baseCalculoRaw);
  var baseCalculoEfetiva = baseCalculo || getProjetoBaseCalculoPadrao_(projeto);
  var papelCronogramaRaw = String(payload.papelCronograma || '').trim();
  var papelCronograma = soaNormalizarPapelCronograma_(papelCronogramaRaw);
  var referenciaAlternativa = String(payload.referenciaAlternativa || '').trim();
  var criterioReferenciasRaw = String(payload.criterioReferencias || '').trim();
  var criterioReferencias = soaNormalizarCriterioReferencias_(criterioReferenciasRaw);
  if (baseCalculoRaw && !baseCalculo) throw new Error('A base para o cálculo deve ser Manter datas previstas ou Recalcular pela visita realizada.');
  if (papelCronogramaRaw && !papelCronograma) throw new Error('O papel no cronograma é inválido.');
  if (criterioReferenciasRaw && !criterioReferencias) throw new Error('O critério entre referências é inválido.');
  if (baseCalculo && !referencia) throw new Error('Selecione a referência antes de definir a base para o cálculo.');
  if (papelCronograma === 'VISITA_CALCULADA' && (!referencia || !baseCalculoEfetiva)) throw new Error('Uma visita calculada exige referência e uma base para o cálculo, própria ou herdada do protocolo.');
  if (referenciaAlternativa && (!referencia || !criterioReferencias)) throw new Error('A referência alternativa exige referência principal e critério entre referências.');
  if (criterioReferencias && !referenciaAlternativa) throw new Error('Selecione uma referência alternativa antes de definir o critério entre referências.');
  if (referenciaAlternativa && referenciaAlternativa === referencia) throw new Error('A referência alternativa deve ser diferente da referência principal.');
  var janelaMenos = payload.janelaDiasMenos === '' || payload.janelaDiasMenos === null || payload.janelaDiasMenos === undefined ? '' : Number(payload.janelaDiasMenos);
  if (janelaMenos !== '' && (!isFinite(janelaMenos) || janelaMenos < 0 || Math.floor(janelaMenos) !== janelaMenos)) throw new Error('A janela de dias menos deve ser um número inteiro maior ou igual a zero.');
  var janelaMais = payload.janelaDiasMais === '' || payload.janelaDiasMais === null || payload.janelaDiasMais === undefined ? '' : Number(payload.janelaDiasMais);
  if (janelaMais !== '' && (!isFinite(janelaMais) || janelaMais < 0 || Math.floor(janelaMais) !== janelaMais)) throw new Error('A janela de dias mais deve ser um número inteiro maior ou igual a zero.');
  var bracoIds = soaUniqueIds_(payload.bracoIds || payload.bracos);
  var aplicarBaseEquivalentes = payload.aplicarBaseEquivalentes === true;
  var equivalenciaKey = aplicarBaseEquivalentes ? soaCycleEquivalentKey_({ codigo: payload.codigo, nome: nome }) : '';
  if (aplicarBaseEquivalentes && !equivalenciaKey) throw new Error('Não foi possível identificar visitas equivalentes em outros ciclos. Desmarque a aplicação em lote ou revise o código da visita.');
  return codexWithDocumentLock_('salvarSoAVisita', function() {
    var sheet = getSoAVisitasSheet_(true);
    var headers = soaEnsureHeaders_(sheet);
    var map = soaHeaderMap_(headers);
    var rows = sheet.getDataRange().getValues();
    var id = String(payload.idSoA || '').trim() || ('SOA-' + gerarIdLoteEstoque_());
    var existingRowIndex = -1;
    for (var existingIndex = 1; existingIndex < rows.length; existingIndex++) {
      if (String(rows[existingIndex][0] || '').trim() === id) {
        existingRowIndex = existingIndex;
        break;
      }
    }
    var ordemManual = ordem !== '';
    if (existingRowIndex >= 0) {
      var ordemIndex = soaHeaderIndex_(map, ['Ordem'], 4);
      var ordemManualIndex = soaHeaderIndex_(map, ['Ordem manual'], 14);
      var ordemAnterior = rows[existingRowIndex][ordemIndex];
      var ordemAnteriorNormalizada = ordemAnterior === '' || ordemAnterior === null || ordemAnterior === undefined ? '' : Number(ordemAnterior);
      ordemManual = soaOrdemManual_(rows[existingRowIndex][ordemManualIndex]) || ordemAnteriorNormalizada !== ordem;
    }
    var aliases = Array.isArray(payload.aliases) ? payload.aliases.join('; ') : String(payload.aliases || '').split(/[;|\n]/).map(function(value) { return String(value || '').trim(); }).filter(Boolean).join('; ');
    var row = Array(headers.length).fill('');
    function put(names, value, fallback) {
      var index = soaHeaderIndex_(map, names, fallback);
      if (index !== undefined && index >= 0) row[index] = value;
    }
    put(['ID_SoA'], id, 0);
    put(['Projeto'], projeto, 1);
    put(['Código da visita', 'Codigo da visita'], String(payload.codigo || '').trim(), 2);
    put(['Nome padrão da visita', 'Nome padrao da visita'], nome, 3);
    put(['Ordem'], ordem, 4);
    put(['Repetição', 'Repeticao'], String(payload.repeticao || '').trim(), 5);
    put(['Intervalo (dias)', 'Intervalo dias'], intervalo, 6);
    put(['Aliases', 'Apelidos'], aliases, 7);
    put(['Ativo', 'Status'], payload.ativo === false ? 'Não' : 'Sim', 8);
    put(['Observações', 'Observacoes'], String(payload.observacoes || '').trim(), 9);
    put(['Referência (após)', 'Referencia (apos)', 'Referência da visita', 'Anchor'], referencia, 10);
    put(['Janela dias menos', 'Janela antes (dias)', 'Janela menos'], janelaMenos, 11);
    put(['Janela dias mais', 'Janela depois (dias)', 'Janela mais'], janelaMais, 12);
    put(['Braços (IDs)', 'Bracos (IDs)', 'Braços', 'Bracos'], bracoIds.join('; '), 13);
    put(['Ordem manual'], ordemManual ? 'Sim' : 'Não', 14);
    put(['Base para o cálculo', 'Base para o calculo', 'Tipo de referência', 'Tipo de referencia', 'Tipo de cálculo da referência', 'Tipo de calculo da referencia'], baseCalculo);
    put(['Papel no cronograma'], papelCronograma);
    put(['Referência alternativa', 'Referencia alternativa'], referenciaAlternativa);
    put(['Critério entre referências', 'Criterio entre referencias'], criterioReferencias);
    var rowValues = [row];
    var msg;
    if (existingRowIndex >= 0) {
      sheet.getRange(existingRowIndex + 1, 1, 1, headers.length).setValues(rowValues);
      msg = 'Visita SoA atualizada.';
    } else {
      sheet.appendRow(rowValues[0]);
      msg = 'Visita SoA adicionada.';
    }
    var equivalentesAtualizadas = 0;
    if (aplicarBaseEquivalentes) {
      var rowsAtualizadas = sheet.getDataRange().getValues();
      var baseIndex = soaHeaderIndex_(map, ['Base para o cálculo', 'Base para o calculo', 'Tipo de referência', 'Tipo de referencia', 'Tipo de cálculo da referência', 'Tipo de calculo da referencia']);
      var projetoIndex = soaHeaderIndex_(map, ['Projeto'], 1);
      var idIndex = soaHeaderIndex_(map, ['ID_SoA'], 0);
      var codigoIndex = soaHeaderIndex_(map, ['Código da visita', 'Codigo da visita'], 2);
      var nomeIndex = soaHeaderIndex_(map, ['Nome padrão da visita', 'Nome padrao da visita'], 3);
      rowsAtualizadas.slice(1).forEach(function(currentRow, index) {
        if (String(currentRow[idIndex] || '').trim() === id) return;
        if (normText_(currentRow[projetoIndex]) !== normText_(projeto)) return;
        if (soaCycleEquivalentKey_({ codigo: currentRow[codigoIndex], nome: currentRow[nomeIndex] }) !== equivalenciaKey) return;
        sheet.getRange(index + 2, baseIndex + 1).setValue(baseCalculo);
        equivalentesAtualizadas++;
      });
      msg += ' Regra aplicada a ' + equivalentesAtualizadas + ' visita(s) equivalente(s) dos demais ciclos.';
    }
    return { idSoA: id, msg: msg, equivalentesAtualizadas: equivalentesAtualizadas };
  });
}

function reordenarSoAVisitas(payload) {
  payload = payload || {};
  var projeto = String(payload.projeto || '').trim();
  var idsInformados = Array.isArray(payload.idsSoA) ? payload.idsSoA.map(function(id) { return String(id || '').trim(); }).filter(Boolean) : [];
  codexAssertCanWrite_('reordenarSoAVisitas', 'Cadastros', projeto || 'SoA');
  if (!projeto) throw new Error('Informe o projeto do calendário SoA.');
  if (!idsInformados.length) throw new Error('Informe a nova ordem das visitas.');
  if (soaUniqueIds_(idsInformados).length !== idsInformados.length) throw new Error('A nova ordem contém visitas duplicadas.');
  return codexWithDocumentLock_('reordenarSoAVisitas', function() {
    var sheet = getSoAVisitasSheet_(false);
    if (!sheet || sheet.getLastRow() < 2) throw new Error('Calendário SoA não encontrado.');
    var rowsAntes = sheet.getDataRange().getValues();
    var mapAntes = soaHeaderMap_(rowsAntes[0] || []);
    var cAntes = {
      id: soaHeaderIndex_(mapAntes, ['ID_SoA'], 0),
      projeto: soaHeaderIndex_(mapAntes, ['Projeto'], 1),
      nome: soaHeaderIndex_(mapAntes, ['Nome padrão da visita', 'Nome padrao da visita'], 3)
    };
    var projetoNorm = normText_(projeto);
    var idsAtuais = rowsAntes.slice(1).filter(function(row) {
      return normText_(row[cAntes.projeto]) === projetoNorm && String(row[cAntes.nome] || '').trim();
    }).map(function(row) { return String(row[cAntes.id] || '').trim(); });
    if (idsAtuais.some(function(id) { return !id; })) throw new Error('Há uma visita sem ID técnico; corrija-a antes de reordenar.');
    var atuais = {};
    idsAtuais.forEach(function(id) { atuais[id] = true; });
    var mesmaLista = idsAtuais.length === idsInformados.length && idsInformados.every(function(id) { return atuais[id]; });
    if (!mesmaLista) throw new Error('A lista de visitas mudou. Recarregue o calendário antes de salvar a ordem.');

    var headers = soaEnsureHeaders_(sheet);
    var rows = sheet.getDataRange().getValues();
    var map = soaHeaderMap_(headers);
    var idCol = soaHeaderIndex_(map, ['ID_SoA'], 0);
    var projetoCol = soaHeaderIndex_(map, ['Projeto'], 1);
    var ordemCol = soaHeaderIndex_(map, ['Ordem'], 4);
    var ordemManualCol = soaHeaderIndex_(map, ['Ordem manual'], 14);
    var novaOrdem = {};
    idsInformados.forEach(function(id, index) { novaOrdem[id] = index + 1; });
    for (var i = 1; i < rows.length; i++) {
      if (normText_(rows[i][projetoCol]) !== projetoNorm) continue;
      var id = String(rows[i][idCol] || '').trim();
      if (!novaOrdem[id]) continue;
      rows[i][ordemCol] = novaOrdem[id];
      rows[i][ordemManualCol] = 'Sim';
    }
    sheet.getRange(2, 1, rows.length - 1, headers.length).setValues(rows.slice(1));
    return { ok: true, msg: 'Ordem das visitas salva.', total: idsInformados.length };
  });
}

function soaImportParsePayload_(payload) {
  payload = payload || {};
  var dados = payload.dados || payload.data || payload.json;
  if (typeof dados === 'string') {
    try { dados = JSON.parse(dados); } catch (e) { throw new Error('O JSON do calendário SoA é inválido.'); }
  }
  if (!dados || typeof dados !== 'object') throw new Error('Informe um objeto JSON de calendário SoA.');
  var projeto = String(payload.projeto || '').trim();
  if (!projeto) throw new Error('Informe o projeto para importar o calendário SoA.');
  return { projeto: projeto, dados: dados, modo: String(payload.modo || 'adicionar').trim().toLowerCase(), criarBracos: payload.criarBracos !== false };
}

function soaImportVisitSignature_(visit) {
  return JSON.stringify([
    normText_(visit.codigo), normText_(visit.nome), visit.intervaloDias == null ? '' : visit.intervaloDias,
    String(visit.repeticao || '').trim(), String(visit.referenciaTipo || '').trim().toUpperCase(),
    String(visit.referenciaCodigo || '').trim(), visit.janelaDiasMenos == null ? '' : visit.janelaDiasMenos,
    visit.janelaDiasMais == null ? '' : visit.janelaDiasMais, soaDelimitedIds_(visit.aliases).join(';'),
    visit.ativo === false ? false : true, visit.condicional === true, String(visit.observacoes || '').trim(),
    String(visit.baseCalculo || visit.tipoCalculoReferencia || visit.tipoReferenciaCalculo || '').trim(),
    String(visit.papelCronograma || '').trim(), String(visit.referenciaAlternativaTipo || '').trim().toUpperCase(),
    String(visit.referenciaAlternativaCodigo || '').trim(), String(visit.criterioReferencias || '').trim()
  ]);
}

function soaImportEntries_(dados) {
  var groups = [];
  var indexes = {};
  function add(visit, scope, armName) {
    if (!visit || typeof visit !== 'object') return;
    var key = scope + '|' + normText_(visit.codigo || visit.nome) + '|' + soaImportVisitSignature_(visit);
    var group = indexes[key];
    if (!group) {
      group = { visit: visit, scope: scope, armNames: [], index: groups.length };
      indexes[key] = group;
      groups.push(group);
    }
    if (armName && !group.armNames.some(function(name) { return normText_(name) === normText_(armName); })) group.armNames.push(String(armName).trim());
  }
  (Array.isArray(dados.visitasComuns) ? dados.visitasComuns : []).forEach(function(visit) { add(visit, 'common', ''); });
  (Array.isArray(dados.variantesPorBraco) ? dados.variantesPorBraco : []).forEach(function(variant) {
    var armName = variant && (variant.braco || variant.nome || variant.nomeBraco);
    if (!armName) return;
    (Array.isArray(variant.visitas) ? variant.visitas : []).forEach(function(visit) { add(visit, 'variant', armName); });
  });
  groups.sort(function(a, b) {
    var ao = Number(a.visit.ordem); var bo = Number(b.visit.ordem);
    ao = isFinite(ao) ? ao : 999999; bo = isFinite(bo) ? bo : 999999;
    return ao - bo || a.index - b.index;
  });
  return groups;
}

function soaImportReferenceType_(visit, alternativa) {
  var type = String((alternativa ? visit.referenciaAlternativaTipo : visit.referenciaTipo) || '').trim().toUpperCase();
  var code = alternativa ? visit.referenciaAlternativaCodigo : visit.referenciaCodigo;
  if (!type && code) type = 'VISITA_ESPECIFICA';
  return type;
}

function soaImportArmPlan_(projeto, groups) {
  var existing = getBracosProjeto(projeto);
  var byName = {};
  existing.forEach(function(arm) { byName[normText_(arm.nome)] = arm; });
  var names = [];
  groups.forEach(function(group) {
    group.armNames.forEach(function(name) {
      if (!names.some(function(item) { return normText_(item) === normText_(name); })) names.push(name);
    });
  });
  var missing = names.filter(function(name) { return !byName[normText_(name)]; });
  return { existing: existing, byName: byName, names: names, missing: missing };
}

function soaImportReferenceId_(group, groups, errors, alternativa) {
  var visit = group.visit || {};
  var type = soaImportReferenceType_(visit, alternativa);
  if (!type) return '';
  if (type !== 'VISITA_ESPECIFICA') return type;
  var code = String((alternativa ? visit.referenciaAlternativaCodigo : visit.referenciaCodigo) || '').trim();
  var codeField = alternativa ? 'referenciaAlternativaCodigo' : 'referenciaCodigo';
  if (!code) { errors.push('A visita ' + (visit.codigo || visit.nome || '?') + ' exige ' + codeField + '.'); return ''; }
  var candidates = groups.filter(function(candidate) { return normText_(candidate.visit.codigo) === normText_(code); });
  if (!candidates.length) { errors.push('A ' + (alternativa ? 'referência alternativa ' : 'referência ') + code + ' da visita ' + (visit.codigo || visit.nome || '?') + ' não foi encontrada.'); return ''; }
  var targetArms = soaUniqueIds_(group.bracoIds);
  var candidate = candidates.filter(function(item) {
    var candidateArms = soaUniqueIds_(item.bracoIds);
    return !targetArms.length || !candidateArms.length || targetArms.some(function(id) { return candidateArms.indexOf(id) !== -1; });
  })[0] || candidates[0];
  return candidate.idSoA || '';
}

function soaImportPrepare_(payload) {
  var parsed = soaImportParsePayload_(payload);
  var dados = parsed.dados;
  var projectInfo = dados.projeto || {};
  var projectName = String(projectInfo.nomeAbreviado || '').trim();
  var projectCode = String(projectInfo.codigoProjeto || '').trim();
  var targetMatches = !projectName || normText_(projectName) === normText_(parsed.projeto) || normText_(projectCode) === normText_(parsed.projeto);
  var baseCalculoPadrao = getProjetoBaseCalculoPadrao_(parsed.projeto);
  var errors = [];
  var warnings = Array.isArray(dados.alertas) ? dados.alertas.map(String) : [];
  var review = Array.isArray(dados.revisaoNecessaria) ? dados.revisaoNecessaria : [];
  var reviewByCode = {};
  review.forEach(function(item) {
    var code = typeof item === 'string' ? item : (item && item.codigo);
    var reason = typeof item === 'string' ? item : (item && item.motivo);
    if (code && reason) reviewByCode[normText_(code)] = String(reason);
  });
  if (!targetMatches) errors.push('O JSON pertence ao projeto ' + projectName + ' (' + projectCode + '), mas o projeto selecionado é ' + parsed.projeto + '.');
  var groups = soaImportEntries_(dados);
  if (!groups.length) errors.push('O JSON não contém visitas em visitasComuns ou variantesPorBraco.');
  var armPlan = soaImportArmPlan_(parsed.projeto, groups);
  if (armPlan.missing.length && !parsed.criarBracos) errors.push('Braços não cadastrados: ' + armPlan.missing.join(', ') + '.');
  groups.forEach(function(group) {
    var visit = group.visit || {};
    if (!String(visit.nome || '').trim()) errors.push('Há uma visita sem nome.');
    group.bracoIds = group.armNames.map(function(name) {
      var existing = armPlan.byName[normText_(name)];
      return existing ? existing.idBraco : '__NOVO__' + normText_(name);
    });
    group.idSoA = 'SOA-' + gerarIdLoteEstoque_();
    group.codigo = String(visit.codigo || '').trim();
    group.nome = String(visit.nome || '').trim();
  });
  var existingVisits = getSoAVisitasProjeto(parsed.projeto);
  var modo = parsed.modo === 'atualizar' ? 'atualizar' : 'adicionar';
  groups.forEach(function(group) {
    var match = existingVisits.filter(function(item) {
      return group.codigo && normText_(item.codigo) === normText_(group.codigo) && soaArmSignature_(item.bracoIds) === soaArmSignature_(group.bracoIds);
    })[0];
    group.existente = match || null;
    if (match) group.idSoA = match.idSoA;
    group.pular = !!(match && modo !== 'atualizar');
  });
  groups.forEach(function(group) {
    group.referencia = soaImportReferenceId_(group, groups, errors, false);
    group.referenciaAlternativa = soaImportReferenceId_(group, groups, errors, true);
  });
  var visitas = groups.filter(function(group) { return !group.pular; }).map(function(group) {
    var visit = group.visit;
    var baseCalculoInformada = ['baseCalculo', 'tipoCalculoReferencia', 'tipoReferenciaCalculo'].some(function(key) { return Object.prototype.hasOwnProperty.call(visit, key); });
    var baseCalculoRaw = baseCalculoInformada ? String(visit.baseCalculo || visit.tipoCalculoReferencia || visit.tipoReferenciaCalculo || '').trim() : '';
    var baseCalculo = baseCalculoInformada ? soaNormalizarBaseCalculo_(baseCalculoRaw) : String(group.existente && group.existente.baseCalculo || '');
    var papelInformado = Object.prototype.hasOwnProperty.call(visit, 'papelCronograma');
    var papelRaw = papelInformado ? String(visit.papelCronograma || '').trim() : '';
    var papelCronograma = papelInformado ? soaNormalizarPapelCronograma_(papelRaw) : String(group.existente && group.existente.papelCronograma || '');
    var criterioInformado = Object.prototype.hasOwnProperty.call(visit, 'criterioReferencias');
    var criterioRaw = criterioInformado ? String(visit.criterioReferencias || '').trim() : '';
    var criterioReferencias = criterioInformado ? soaNormalizarCriterioReferencias_(criterioRaw) : String(group.existente && group.existente.criterioReferencias || '');
    var referenciaAlternativaInformada = Object.prototype.hasOwnProperty.call(visit, 'referenciaAlternativaTipo') || Object.prototype.hasOwnProperty.call(visit, 'referenciaAlternativaCodigo');
    var referenciaAlternativa = referenciaAlternativaInformada ? group.referenciaAlternativa : String(group.existente && group.existente.referenciaAlternativa || '');
    return {
      idSoA: group.idSoA,
      projeto: parsed.projeto,
      codigo: group.codigo,
      nome: group.nome,
      ordem: visit.ordem === null || visit.ordem === undefined || visit.ordem === '' ? '' : Number(visit.ordem),
      repeticao: String(visit.repeticao || '').trim(),
      intervaloDias: visit.intervaloDias === null || visit.intervaloDias === undefined || visit.intervaloDias === '' ? '' : Number(visit.intervaloDias),
      aliases: Array.isArray(visit.aliases) ? visit.aliases : soaDelimitedIds_(visit.aliases),
      ativo: visit.ativo !== false,
      observacoes: [String(visit.observacoes || '').trim(), reviewByCode[normText_(group.codigo)] ? 'Revisão necessária: ' + reviewByCode[normText_(group.codigo)] : ''].filter(Boolean).join(' '),
      referencia: group.referencia,
      baseCalculo: baseCalculo,
      baseCalculoEfetiva: baseCalculo || baseCalculoPadrao,
      baseCalculoInvalida: !!(baseCalculoRaw && !baseCalculo),
      papelCronograma: papelCronograma,
      papelCronogramaInvalido: !!(papelRaw && !papelCronograma),
      referenciaAlternativa: referenciaAlternativa,
      criterioReferencias: criterioReferencias,
      criterioReferenciasInvalido: !!(criterioRaw && !criterioReferencias),
      janelaDiasMenos: visit.janelaDiasMenos === null || visit.janelaDiasMenos === undefined || visit.janelaDiasMenos === '' ? '' : Number(visit.janelaDiasMenos),
      janelaDiasMais: visit.janelaDiasMais === null || visit.janelaDiasMais === undefined || visit.janelaDiasMais === '' ? '' : Number(visit.janelaDiasMais),
      bracoIds: soaUniqueIds_(group.bracoIds),
      bracoNomes: group.armNames,
      existente: !!group.existente,
      ordemManual: !!(group.existente && group.existente.ordemManual),
      condicional: visit.condicional === true,
      origem: String(visit.origem || '').trim()
    };
  });
  var invalidNumbers = visitas.filter(function(item) {
    return (item.ordem !== '' && (!isFinite(item.ordem) || item.ordem < 0 || Math.floor(item.ordem) !== item.ordem)) ||
      (item.intervaloDias !== '' && (!isFinite(item.intervaloDias) || item.intervaloDias < 0 || Math.floor(item.intervaloDias) !== item.intervaloDias)) ||
      (item.janelaDiasMenos !== '' && (!isFinite(item.janelaDiasMenos) || item.janelaDiasMenos < 0 || Math.floor(item.janelaDiasMenos) !== item.janelaDiasMenos)) ||
      (item.janelaDiasMais !== '' && (!isFinite(item.janelaDiasMais) || item.janelaDiasMais < 0 || Math.floor(item.janelaDiasMais) !== item.janelaDiasMais));
  });
  if (invalidNumbers.length) errors.push('Há intervalos, ordens ou janelas que não são números inteiros maiores ou iguais a zero.');
  if (visitas.some(function(item) { return item.baseCalculoInvalida; })) errors.push('Há base para o cálculo inválida; use MANTER_DATAS_PREVISTAS ou RECALCULAR_VISITA_REALIZADA.');
  if (visitas.some(function(item) { return item.papelCronogramaInvalido; })) errors.push('Há papel no cronograma inválido.');
  if (visitas.some(function(item) { return item.criterioReferenciasInvalido; })) errors.push('Há critério entre referências inválido.');
  if (visitas.some(function(item) { return item.baseCalculo && !item.referencia; })) errors.push('Há visita com base para o cálculo definida, mas sem referência selecionada.');
  if (visitas.some(function(item) { return item.papelCronograma === 'VISITA_CALCULADA' && (!item.referencia || !item.baseCalculoEfetiva); })) errors.push('Há visita calculada sem referência ou base para o cálculo própria ou herdada do protocolo.');
  if (visitas.some(function(item) { return item.referenciaAlternativa && (!item.referencia || !item.criterioReferencias); })) errors.push('Há referência alternativa sem referência principal ou critério entre referências.');
  if (visitas.some(function(item) { return item.criterioReferencias && !item.referenciaAlternativa; })) errors.push('Há critério entre referências sem referência alternativa.');
  if (visitas.some(function(item) { return item.referenciaAlternativa && item.referenciaAlternativa === item.referencia; })) errors.push('A referência alternativa deve ser diferente da referência principal.');
  var sugestaoOrdem = soaSugerirOrdemExecucao_(visitas, {
    referenciasConhecidas: existingVisits.map(function(item) { return item.idSoA; })
  });
  var sugestaoOrdemPorId = {};
  sugestaoOrdem.visitas.forEach(function(item) { sugestaoOrdemPorId[item.idSoA] = item; });
  visitas.forEach(function(item) {
    var ordem = sugestaoOrdemPorId[item.idSoA] || {};
    item.ordemRecebida = ordem.ordemRecebida;
    item.ordemSugerida = ordem.ordemSugerida;
    item.ordemAmbigua = ordem.ordemAmbigua === true;
    item.motivosOrdem = ordem.motivosOrdem || [];
  });
  return {
    ok: errors.length === 0,
    projeto: parsed.projeto,
    projetoJson: projectInfo,
    modo: modo,
    criarBracos: parsed.criarBracos,
    missingBracos: armPlan.missing,
    bracosExistentes: armPlan.existing,
    alertas: warnings,
    revisaoNecessaria: review,
    erros: errors,
    visitas: visitas,
    totalVisitas: groups.length,
    novasVisitas: groups.filter(function(group) { return !group.existente; }).length,
    atualizacoes: groups.filter(function(group) { return !!group.existente && modo === 'atualizar'; }).length,
    ignoradas: groups.filter(function(group) { return group.pular; }).length,
    ordensManuaisPreservadas: visitas.filter(function(item) { return item.existente && item.ordemManual; }).length,
    mudancasOrdemSugerida: sugestaoOrdem.mudancas,
    ambiguidadesOrdem: sugestaoOrdem.ambiguidades
  };
}

function validarImportacaoSoA(payload) {
  return soaImportPrepare_(payload);
}

function soaCreateImportArms_(projeto, names) {
  if (!names.length) return [];
  var sheet = getProjetoBracosSheet_(true);
  var rows = sheet.getDataRange().getValues();
  var maxOrder = rows.slice(1).reduce(function(max, row) { var value = Number(row[3]); return isFinite(value) ? Math.max(max, value) : max; }, 0);
  var created = [];
  names.forEach(function(name, index) {
    var id = 'BRACO-' + gerarIdLoteEstoque_();
    sheet.appendRow([id, projeto, name, maxOrder + index + 1, 'Sim', 'Importado do calendário SoA.']);
    created.push({ idBraco: id, nome: name });
  });
  return created;
}

function soaWriteImportRows_(prepared) {
  var sheet = getSoAVisitasSheet_(true);
  var headers = soaEnsureHeaders_(sheet);
  var map = soaHeaderMap_(headers);
  var rows = sheet.getDataRange().getValues();
  var byId = {};
  for (var i = 1; i < rows.length; i++) byId[String(rows[i][0] || '').trim()] = i + 1;
  var projetoCol = soaHeaderIndex_(map, ['Projeto'], 1);
  var ordemCol = soaHeaderIndex_(map, ['Ordem'], 4);
  var ordemManualIndex = soaHeaderIndex_(map, ['Ordem manual'], 14);
  var projetoNorm = normText_(prepared.projeto);
  var temOrdemManualNoProjeto = false;
  var maiorOrdemProjeto = 0;
  rows.slice(1).forEach(function(row) {
    if (normText_(row[projetoCol]) !== projetoNorm) return;
    var ordemExistente = Number(row[ordemCol]);
    if (isFinite(ordemExistente)) maiorOrdemProjeto = Math.max(maiorOrdemProjeto, ordemExistente);
    if (soaOrdemManual_(row[ordemManualIndex])) temOrdemManualNoProjeto = true;
  });
  function put(row, names, value, fallback) {
    var index = soaHeaderIndex_(map, names, fallback);
    if (index !== undefined && index >= 0) row[index] = value;
  }
  prepared.visitas.forEach(function(visit) {
    var rowNumber = byId[visit.idSoA];
    var row = rowNumber ? (sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0] || Array(headers.length).fill('')) : Array(headers.length).fill('');
    var preservarOrdemManual = !!rowNumber && soaOrdemManual_(row[ordemManualIndex]);
    var ordemImportada = !rowNumber && temOrdemManualNoProjeto ? ++maiorOrdemProjeto : visit.ordem;
    put(row, ['ID_SoA'], visit.idSoA, 0); put(row, ['Projeto'], visit.projeto, 1);
    put(row, ['Código da visita', 'Codigo da visita'], visit.codigo, 2); put(row, ['Nome padrão da visita', 'Nome padrao da visita'], visit.nome, 3);
    if (!preservarOrdemManual) put(row, ['Ordem'], ordemImportada, 4);
    put(row, ['Repetição', 'Repeticao'], visit.repeticao, 5); put(row, ['Intervalo (dias)', 'Intervalo dias'], visit.intervaloDias, 6);
    put(row, ['Aliases', 'Apelidos'], visit.aliases.join('; '), 7); put(row, ['Ativo', 'Status'], visit.ativo === false ? 'Não' : 'Sim', 8);
    put(row, ['Observações', 'Observacoes'], visit.observacoes, 9); put(row, ['Referência (após)', 'Referencia (apos)', 'Referência da visita', 'Anchor'], visit.referencia, 10);
    put(row, ['Janela dias menos', 'Janela antes (dias)', 'Janela menos'], visit.janelaDiasMenos, 11); put(row, ['Janela dias mais', 'Janela depois (dias)', 'Janela mais'], visit.janelaDiasMais, 12);
    put(row, ['Braços (IDs)', 'Bracos (IDs)', 'Braços', 'Bracos'], soaUniqueIds_(visit.bracoIds).join('; '), 13);
    put(row, ['Ordem manual'], preservarOrdemManual ? 'Sim' : 'Não', 14);
    put(row, ['Base para o cálculo', 'Base para o calculo', 'Tipo de referência', 'Tipo de referencia', 'Tipo de cálculo da referência', 'Tipo de calculo da referencia'], visit.baseCalculo || '');
    put(row, ['Papel no cronograma'], visit.papelCronograma || '');
    put(row, ['Referência alternativa', 'Referencia alternativa'], visit.referenciaAlternativa || '');
    put(row, ['Critério entre referências', 'Criterio entre referencias'], visit.criterioReferencias || '');
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]); else sheet.appendRow(row);
  });
}

function importarSoAJson(payload) {
  payload = payload || {};
  codexAssertCanWrite_('importarSoAJson', 'Cadastros', payload.projeto || 'SoA');
  return codexWithDocumentLock_('importarSoAJson', function() {
    var parsed = soaImportParsePayload_(payload);
    var prepared = soaImportPrepare_(payload);
    if (!prepared.ok) throw new Error('Importação SoA inválida: ' + prepared.erros.join(' '));
    var createdArms = soaCreateImportArms_(parsed.projeto, prepared.missingBracos);
    var finalPayload = { projeto: parsed.projeto, dados: parsed.dados, modo: parsed.modo, criarBracos: false };
    var finalPrepared = soaImportPrepare_(finalPayload);
    if (!finalPrepared.ok) throw new Error('Importação SoA inválida após preparar os braços: ' + finalPrepared.erros.join(' '));
    soaWriteImportRows_(finalPrepared);
    return {
      ok: true,
      msg: 'Calendário SoA importado.',
      adicionadas: finalPrepared.visitas.filter(function(item) { return !item.existente; }).length,
      atualizadas: finalPrepared.atualizacoes,
      ignoradas: finalPrepared.ignoradas,
      bracosCriados: createdArms.length,
      ordensManuaisPreservadas: finalPrepared.ordensManuaisPreservadas,
      alertas: finalPrepared.alertas,
      revisaoNecessaria: finalPrepared.revisaoNecessaria
    };
  });
}

function excluirSoAVisita(idSoA) {
  codexAssertCanWrite_('excluirSoAVisita', 'Cadastros', idSoA);
  var id = String(idSoA || '').trim();
  if (!id) throw new Error('Visita SoA inválida.');
  return codexWithDocumentLock_('excluirSoAVisita', function() {
    var sheet = getSoAVisitasSheet_(false);
    if (!sheet || sheet.getLastRow() < 2) throw new Error('Visita SoA não encontrada.');
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === id) {
        sheet.deleteRow(i + 1);
        return 'Visita SoA excluída.';
      }
    }
    throw new Error('Visita SoA não encontrada.');
  });
}

// ════════════════════════════════
//  BRAÇOS DO ESTUDO — catálogo opcional por protocolo
// ════════════════════════════════
var PROJETO_BRACOS_HEADERS_ = ['ID_Braco', 'Projeto', 'Nome do braço', 'Ordem', 'Ativo', 'Observações'];

function getProjetoBracosSheet_(createIfMissing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetByPossibleNames_(ss, ['Projeto_Bracos', 'Bracos_Projeto', 'Braços_Projeto']);
  if (!sheet && createIfMissing) {
    if (!ss || typeof ss.insertSheet !== 'function') throw new Error('Não foi possível criar a aba do catálogo de braços.');
    sheet = ss.insertSheet('Projeto_Bracos');
    sheet.getRange(1, 1, 1, PROJETO_BRACOS_HEADERS_.length).setValues([PROJETO_BRACOS_HEADERS_]);
  }
  return sheet;
}

function getBracosProjeto(projeto) {
  var projetoNorm = normText_(projeto);
  if (!projetoNorm) return [];
  var sheet = getProjetoBracosSheet_(false);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0] || [];
  var map = {};
  headers.forEach(function(header, index) { map[normalizeHeader_(header)] = index; });
  function col(names, fallback) {
    for (var i = 0; i < names.length; i++) {
      var index = map[normalizeHeader_(names[i])];
      if (index !== undefined) return index;
    }
    return fallback;
  }
  var c = {
    id: col(['ID_Braco'], 0), projeto: col(['Projeto'], 1), nome: col(['Nome do braço', 'Nome do braco', 'Braço', 'Braco'], 2),
    ordem: col(['Ordem'], 3), ativo: col(['Ativo', 'Status'], 4), observacoes: col(['Observações', 'Observacoes'], 5)
  };
  return rows.slice(1).map(function(row) {
    var ordemRaw = row[c.ordem];
    var ativo = String(row[c.ativo] || 'Sim').trim();
    return {
      idBraco: String(row[c.id] || '').trim(),
      projeto: String(row[c.projeto] || '').trim(),
      nome: String(row[c.nome] || '').trim(),
      ordem: ordemRaw === '' || ordemRaw === null || ordemRaw === undefined ? '' : Number(ordemRaw),
      ativo: ativo.toLowerCase() !== 'não' && ativo.toLowerCase() !== 'nao',
      observacoes: String(row[c.observacoes] || '').trim()
    };
  }).filter(function(item) {
    return item.nome && normText_(item.projeto) === projetoNorm;
  }).sort(function(a, b) {
    var ao = a.ordem === '' || !isFinite(a.ordem) ? 999999 : a.ordem;
    var bo = b.ordem === '' || !isFinite(b.ordem) ? 999999 : b.ordem;
    return ao - bo || a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
  });
}

function salvarBracoProjeto(payload) {
  payload = payload || {};
  codexAssertCanWrite_('salvarBracoProjeto', 'Cadastros', payload.idBraco || payload.projeto || 'Braço');
  var projeto = String(payload.projeto || '').trim();
  var nome = String(payload.nome || '').trim();
  if (!projeto) throw new Error('Informe o projeto do braço.');
  if (!nome) throw new Error('Informe o nome do braço.');
  var ordem = payload.ordem === '' || payload.ordem === null || payload.ordem === undefined ? '' : Number(payload.ordem);
  if (ordem !== '' && (!isFinite(ordem) || ordem < 0 || Math.floor(ordem) !== ordem)) throw new Error('A ordem deve ser um número inteiro maior ou igual a zero.');
  return codexWithDocumentLock_('salvarBracoProjeto', function() {
    var sheet = getProjetoBracosSheet_(true);
    var rows = sheet.getDataRange().getValues();
    var id = String(payload.idBraco || '').trim() || ('BRACO-' + gerarIdLoteEstoque_());
    var rowValues = [[id, projeto, nome, ordem, payload.ativo === false ? 'Não' : 'Sim', String(payload.observacoes || '').trim()]];
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === id) {
        sheet.getRange(i + 1, 1, 1, PROJETO_BRACOS_HEADERS_.length).setValues(rowValues);
        return { idBraco: id, msg: 'Braço atualizado.' };
      }
    }
    sheet.appendRow(rowValues[0]);
    return { idBraco: id, msg: 'Braço adicionado.' };
  });
}

function excluirBracoProjeto(idBraco) {
  codexAssertCanWrite_('excluirBracoProjeto', 'Cadastros', idBraco);
  var id = String(idBraco || '').trim();
  if (!id) throw new Error('Braço inválido.');
  return codexWithDocumentLock_('excluirBracoProjeto', function() {
    var sheet = getProjetoBracosSheet_(false);
    if (!sheet || sheet.getLastRow() < 2) throw new Error('Braço não encontrado.');
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === id) {
        sheet.deleteRow(i + 1);
        return 'Braço excluído.';
      }
    }
    throw new Error('Braço não encontrado.');
  });
}

function getProjetosSivPorProjeto_() {
  var grupos = {};
  var out = {};
  var sh;
  try {
    sh = getAgendaSheetForRead_();
  } catch (e) {
    return out;
  }
  if (!sh || sh.getLastRow() < 2) return out;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, AGENDA_CFG.lastCol).getDisplayValues();
  var i = AGENDA_CFG.idx;
  rows.forEach(function(r) {
    var projeto = String(r[i.projeto] || '').trim();
    if (!projeto) return;
    var tipo = normText_(r[i.tipo]);
    var visita = normText_(r[i.visita]);
    if (!AgendaServerRules_.isSiv(tipo) && visita.indexOf('siv') === -1 && visita.indexOf('iniciacao do centro') === -1) return;
    var status = normText_(r[i.status]);
    if (AgendaServerRules_.isCancelled(status)) return;
    if (!AgendaServerRules_.isCompleted(status)) return;
    var dataObj = parseAgendaDateAny_(r[i.data]);
    if (!dataObj) return;
    dataObj.setHours(0, 0, 0, 0);
    var key = normText_(projeto);
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push({ data: String(r[i.data] || ''), dataObj: dataObj });
  });
  Object.keys(grupos).forEach(function(key) {
    var rows = grupos[key].sort(function(a, b) {
      return a.dataObj.getTime() - b.dataObj.getTime();
    });
    var inicio = null;
    var fim = null;
    var melhor = null;
    rows.forEach(function(item) {
      if (!inicio || !agendaDatasConsecutivas_(fim.dataObj, item.dataObj)) {
        inicio = item;
      }
      fim = item;
      melhor = {
        data: fim.data,
        inicio: inicio.data,
        fim: fim.data,
        dataObj: fim.dataObj
      };
    });
    if (melhor) out[key] = melhor;
  });
  return out;
}

function getParticipantesStatsPorProjeto_() {
  var out = {};
  var rows = getCodexSheetDataByName_('Participantes').slice(1);
  if (!rows.length) return out;
  rows.forEach(function(r) {
    var projeto = String(r[5] || '').trim();
    if (!projeto) return;
    var st = normText_(r[8]);
    var key = normText_(projeto);
    if (!out[key]) out[key] = { total: 0, ativos: 0, falhasTriagem: 0 };
    out[key].total++;
    if (st === 'ativo' || st === 'em seguimento') out[key].ativos++;
    if ((st.indexOf('falha') >= 0 && st.indexOf('triagem') >= 0) || st.indexOf('screen fail') >= 0) {
      out[key].falhasTriagem++;
    }
  });
  return out;
}

function getProjetosAtivosEstoque_() {
  var rows = getCodexSheetDataByName_('Projetos').slice(1);
  if (!rows.length) return [];
  var seen = {}, out = [];
  rows.forEach(function(r) {
    var nome = String(r[1] || r[2] || '').trim();
    if (!nome || classificarProjetoStatus_(r[13]) !== 'ativo') return;
    if (!seen[nome]) {
      seen[nome] = 1;
      out.push(nome);
    }
  });
  return out.sort();
}

function getProjetosParticipantesOptions_() {
  return getProjetoOptions_();
}

function getProjetoOptions_() {
  var rows = getCodexSheetDataByName_('Projetos').slice(1);
  var seen = {}, out = [];
  rows.forEach(function(r) {
    var nome = String(r[1] || r[2] || '').trim();
    if (!nome || seen[nome]) return;
    seen[nome] = true;
    out.push({ id: String(r[0] || '').trim(), nome: nome, codigo: String(r[2] || '').trim() });
  });
  return out.sort(function(a, b) { return a.nome.localeCompare(b.nome); });
}

var PROJETO_COURIER_FIELDS_ = [
  { key: 'courierPrincipalId', header: 'Courier principal (ID)', aliases: ['Courier principal ID', 'ID Courier principal'] },
  { key: 'courierAdicional1Id', header: 'Courier adicional 1 (ID)', aliases: ['Courier adicional 1 ID', 'ID Courier adicional 1'] },
  { key: 'courierAdicional2Id', header: 'Courier adicional 2 (ID)', aliases: ['Courier adicional 2 ID', 'ID Courier adicional 2'] }
];

var PROJETO_COURIER_TEMPERATURE_FIELDS_ = [
  { key: 'courierPrincipalTemperaturas', legacyKey: 'courierPrincipalTemperatura', courierKey: 'courierPrincipalId', header: 'Temperaturas courier principal', aliases: ['Temperatura courier principal', 'Temperatura Courier principal'] },
  { key: 'courierAdicional1Temperaturas', legacyKey: 'courierAdicional1Temperatura', courierKey: 'courierAdicional1Id', header: 'Temperaturas courier adicional 1', aliases: ['Temperatura courier adicional 1', 'Temperatura Courier adicional 1'] },
  { key: 'courierAdicional2Temperaturas', legacyKey: 'courierAdicional2Temperatura', courierKey: 'courierAdicional2Id', header: 'Temperaturas courier adicional 2', aliases: ['Temperatura courier adicional 2', 'Temperatura Courier adicional 2'] }
];

var PROJETO_SITUACAO_ENVIO_FIELD_ = {
  key: 'situacaoEnvioAmostras',
  header: 'Situação envio de amostras',
  aliases: ['Situacao envio de amostras', 'Envio de amostras']
};

var PROJETO_SOA_CONFIG_FIELDS_ = [{
  key: 'soaBaseCalculoPadrao',
  header: 'Base padrão do cronograma SoA',
  aliases: ['Base padrao do cronograma SoA', 'Base padrão SoA', 'Base padrao SoA']
}, {
  key: 'ctmsJornadaAtivo',
  header: 'CTMS ativo na Jornada',
  aliases: ['CTMS ativo', 'Motor CTMS ativo', 'Ativar CTMS na Jornada']
}];

function projetoSoAConfigColumnMap_(headers) {
  var normalized = (headers || []).map(function(header) { return normText_(header); });
  var map = { baseCalculoPadrao: -1, ctmsJornadaAtivo: -1 };
  PROJETO_SOA_CONFIG_FIELDS_.forEach(function(field) {
    var names = [field.header].concat(field.aliases || []);
    var index = -1;
    for (var i = 0; i < names.length && index < 0; i++) index = normalized.indexOf(normText_(names[i]));
    map[field.key === 'soaBaseCalculoPadrao' ? 'baseCalculoPadrao' : field.key] = index;
  });
  return map;
}

function projetoSoAConfigPayloadPresente_(dados) {
  return Object.prototype.hasOwnProperty.call(dados || {}, 'soaBaseCalculoPadrao');
}

function validarProjetoSoAConfig_(dados) {
  if (!projetoSoAConfigPayloadPresente_(dados)) return '';
  var raw = String(dados.soaBaseCalculoPadrao || '').trim();
  var normalized = soaNormalizarBaseCalculo_(raw);
  if (raw && !normalized) throw new Error('A base padrão do cronograma deve ser Manter datas previstas ou Recalcular pela visita realizada.');
  return normalized;
}

function garantirProjetoSoAConfigColumn_(aba, fieldKey) {
  var lastCol = Math.max(aba.getLastColumn(), 1);
  var headers = aba.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var map = projetoSoAConfigColumnMap_(headers);
  var mapKey = fieldKey === 'soaBaseCalculoPadrao' ? 'baseCalculoPadrao' : fieldKey;
  if (map[mapKey] >= 0) return map[mapKey];
  var field = PROJETO_SOA_CONFIG_FIELDS_.filter(function(item) { return item.key === fieldKey; })[0];
  if (!field) throw new Error('Configuração SoA desconhecida: ' + fieldKey + '.');
  var index = headers.length;
  aba.getRange(1, index + 1).setValue(field.header);
  return index;
}

function gravarProjetoSoAConfig_(aba, rowNumber, dados) {
  if (projetoSoAConfigPayloadPresente_(dados)) {
    var baseColumn = garantirProjetoSoAConfigColumn_(aba, 'soaBaseCalculoPadrao');
    aba.getRange(rowNumber, baseColumn + 1).setValue(validarProjetoSoAConfig_(dados));
  }
  if (Object.prototype.hasOwnProperty.call(dados || {}, 'ctmsJornadaAtivo')) {
    var ativo = dados.ctmsJornadaAtivo === true || ['sim', 'true', '1'].indexOf(normText_(dados.ctmsJornadaAtivo)) >= 0;
    var ctmsColumn = garantirProjetoSoAConfigColumn_(aba, 'ctmsJornadaAtivo');
    aba.getRange(rowNumber, ctmsColumn + 1).setValue(ativo ? 'Sim' : 'Não');
  }
}

function projetoCtmsJornadaAtivo_(projeto) {
  var projetoNorm = normText_(projeto);
  if (!projetoNorm) return false;
  var ss = getCodexSpreadsheet_();
  var sheet = ss && ss.getSheetByName('Projetos');
  if (!sheet || sheet.getLastRow() < 2) return false;
  var rows = sheet.getDataRange().getValues();
  var columns = projetoSoAConfigColumnMap_(rows[0] || []);
  if (columns.ctmsJornadaAtivo < 0) return false;
  for (var i = 1; i < rows.length; i++) {
    if (normText_(rows[i][1]) !== projetoNorm && normText_(rows[i][2]) !== projetoNorm) continue;
    return ['sim', 'true', '1'].indexOf(normText_(rows[i][columns.ctmsJornadaAtivo])) >= 0;
  }
  return false;
}

function getProjetoBaseCalculoPadrao_(projeto) {
  var projetoNorm = normText_(projeto);
  if (!projetoNorm) return '';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName('Projetos');
  if (!sheet || sheet.getLastRow() < 2) return '';
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return '';
  var columns = projetoSoAConfigColumnMap_(rows[0] || []);
  if (columns.baseCalculoPadrao < 0) return '';
  for (var i = 1; i < rows.length; i++) {
    if (normText_(rows[i][1]) === projetoNorm || normText_(rows[i][2]) === projetoNorm) {
      return soaNormalizarBaseCalculo_(rows[i][columns.baseCalculoPadrao]);
    }
  }
  return '';
}

function projetoCourierColumnMap_(headers) {
  var normalized = (headers || []).map(function(header) { return normText_(header); });
  function find(field) {
    var names = [field.header].concat(field.aliases || []);
    for (var i = 0; i < names.length; i++) {
      var index = normalized.indexOf(normText_(names[i]));
      if (index >= 0) return index;
    }
    return -1;
  }
  return {
    principal: find(PROJETO_COURIER_FIELDS_[0]),
    adicional1: find(PROJETO_COURIER_FIELDS_[1]),
    adicional2: find(PROJETO_COURIER_FIELDS_[2])
  };
}

function projetoCourierTemperatureColumnMap_(headers) {
  var normalized = (headers || []).map(function(header) { return normText_(header); });
  function find(field) {
    var names = [field.header].concat(field.aliases || []);
    for (var i = 0; i < names.length; i++) {
      var index = normalized.indexOf(normText_(names[i]));
      if (index >= 0) return index;
    }
    return -1;
  }
  return {
    principal: find(PROJETO_COURIER_TEMPERATURE_FIELDS_[0]),
    adicional1: find(PROJETO_COURIER_TEMPERATURE_FIELDS_[1]),
    adicional2: find(PROJETO_COURIER_TEMPERATURE_FIELDS_[2])
  };
}

function projetoSituacaoEnvioColumn_(headers) {
  var normalized = (headers || []).map(function(header) { return normText_(header); });
  var names = [PROJETO_SITUACAO_ENVIO_FIELD_.header].concat(PROJETO_SITUACAO_ENVIO_FIELD_.aliases || []);
  for (var i = 0; i < names.length; i++) {
    var index = normalized.indexOf(normText_(names[i]));
    if (index >= 0) return index;
  }
  return -1;
}

function projetoCourierPayloadPresente_(dados) {
  return PROJETO_COURIER_FIELDS_.concat(PROJETO_COURIER_TEMPERATURE_FIELDS_).concat([PROJETO_SITUACAO_ENVIO_FIELD_]).some(function(field) {
    return Object.prototype.hasOwnProperty.call(dados || {}, field.key) || (field.legacyKey && Object.prototype.hasOwnProperty.call(dados || {}, field.legacyKey));
  });
}

function normalizarProjetoTemperaturas_(value) {
  var raw = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  var permitidas = getAgendaTemperaturas_();
  var porNome = {};
  permitidas.forEach(function(item) { porNome[normText_(item)] = String(item); });
  var usadas = {};
  return raw.map(function(item) {
    var texto = String(item || '').trim();
    if (!texto) return '';
    var normalizada = normText_(texto);
    if (!porNome[normalizada]) throw new Error('Temperatura não cadastrada para a Agenda: ' + texto + '.');
    if (usadas[normalizada]) return '';
    usadas[normalizada] = true;
    return porNome[normalizada];
  }).filter(Boolean);
}

function projetoTemperaturasPayload_(dados, field) {
  if (Object.prototype.hasOwnProperty.call(dados || {}, field.key)) return normalizarProjetoTemperaturas_(dados[field.key]);
  if (field.legacyKey && Object.prototype.hasOwnProperty.call(dados || {}, field.legacyKey)) return normalizarProjetoTemperaturas_(dados[field.legacyKey]);
  return [];
}

function validarProjetoCourierIds_(dados) {
  var opcoes = arguments.length > 1 && arguments[1] ? arguments[1] : {};
  var legadosPorCampo = opcoes.legadosPorCampo || {};
  var couriersPorId = {};
  getAgendaCourierRows_().forEach(function(courier) {
    var id = String(courier && courier.id || '').trim();
    if (id) couriersPorId[id] = courier;
  });
  var ids = PROJETO_COURIER_FIELDS_.map(function(field) {
    var id = String((dados || {})[field.key] || '').trim();
    if (!id) return '';
    var courier = couriersPorId[id];
    if (!courier) {
      if (String(legadosPorCampo[field.key] || '') === id) return id;
      throw new Error('Courier não cadastrada: ' + id + '.');
    }
    if (!courier.disponivelProjetos && String(legadosPorCampo[field.key] || '') !== id) {
      throw new Error('A courier ' + String(courier.nome || courier.courier || id) + ' não pode ser vinculada a projetos.');
    }
    return id;
  }).filter(Boolean);
  var usados = {};
  for (var i = 0; i < ids.length; i++) {
    if (usados[ids[i]]) throw new Error('Selecione couriers diferentes para o projeto.');
    usados[ids[i]] = true;
  }
  PROJETO_COURIER_TEMPERATURE_FIELDS_.forEach(function(field) {
    var temperaturas = projetoTemperaturasPayload_(dados, field);
    var courierId = String((dados || {})[field.courierKey] || '').trim();
    if (temperaturas.length && !courierId) throw new Error('Selecione a courier correspondente antes de informar a temperatura.');
  });
  var situacao = String((dados || {}).situacaoEnvioAmostras || '').trim();
  if (situacao && situacao !== 'Sim' && situacao !== 'Não') throw new Error('Use Sim ou Não para a situação do envio de amostras.');
  if (situacao === 'Não' && ids.length) throw new Error('Um projeto sem envio de amostras não pode ter courier vinculada.');
}

function garantirProjetoCourierColumns_(aba) {
  var lastCol = Math.max(aba.getLastColumn(), 1);
  var headers = aba.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var normalized = headers.map(function(header) { return normText_(header); });
  var map = {};
  PROJETO_COURIER_FIELDS_.concat(PROJETO_COURIER_TEMPERATURE_FIELDS_).concat([PROJETO_SITUACAO_ENVIO_FIELD_]).forEach(function(field) {
    var names = [field.header].concat(field.aliases || []);
    var index = -1;
    for (var i = 0; i < names.length && index < 0; i++) index = normalized.indexOf(normText_(names[i]));
    if (index < 0) {
      index = headers.length;
      aba.getRange(1, index + 1).setValue(field.header);
      headers.push(field.header);
      normalized.push(normText_(field.header));
    }
    map[field.key] = index;
  });
  return map;
}

function gravarProjetoCourierIds_(aba, rowNumber, dados) {
  if (!projetoCourierPayloadPresente_(dados)) return;
  var columns = garantirProjetoCourierColumns_(aba);
  PROJETO_COURIER_FIELDS_.concat(PROJETO_COURIER_TEMPERATURE_FIELDS_).concat([PROJETO_SITUACAO_ENVIO_FIELD_]).forEach(function(field) {
    var presente = Object.prototype.hasOwnProperty.call(dados, field.key) || (field.legacyKey && Object.prototype.hasOwnProperty.call(dados, field.legacyKey));
    if (!presente) return;
    var value = PROJETO_COURIER_TEMPERATURE_FIELDS_.indexOf(field) >= 0
      ? projetoTemperaturasPayload_(dados, field).join('; ')
      : String(dados[field.key] || '').trim();
    aba.getRange(rowNumber, columns[field.key] + 1).setValue(value);
  });
}

function salvarDadosProjeto(dados) {
  codexAssertCanWrite_('salvarDadosProjeto', 'Cadastros', dados && dados.id);
  dados = dados || {};
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('Projetos');
  if (!aba) throw new Error('Aba "Projetos" não encontrada.');
  var rows = aba.getDataRange().getValues();
  var ausentes = CadastroRules_.requiredProjectFields(dados);
  if (ausentes.length) throw new Error('Preencha os campos obrigatórios: ' + ausentes.join(', ') + '.');
  var duplicado = CadastroRules_.findProjectDuplicate(dados, rows);
  if (duplicado) {
    throw new Error(duplicado.field === 'codigo'
      ? 'Já existe um projeto cadastrado com este código.'
      : 'Já existe um projeto cadastrado com este nome abreviado.');
  }
  var couriersLegadosPorCampo = {};
  if (dados.id && rows.length) {
    var courierColsExistentes = projetoCourierColumnMap_(rows[0] || []);
    for (var linhaLegada = 1; linhaLegada < rows.length; linhaLegada++) {
      if (String(rows[linhaLegada][0]) !== String(dados.id)) continue;
      couriersLegadosPorCampo.courierPrincipalId = courierColsExistentes.principal >= 0 ? String(rows[linhaLegada][courierColsExistentes.principal] || '').trim() : '';
      couriersLegadosPorCampo.courierAdicional1Id = courierColsExistentes.adicional1 >= 0 ? String(rows[linhaLegada][courierColsExistentes.adicional1] || '').trim() : '';
      couriersLegadosPorCampo.courierAdicional2Id = courierColsExistentes.adicional2 >= 0 ? String(rows[linhaLegada][courierColsExistentes.adicional2] || '').trim() : '';
      break;
    }
  }
  if (projetoCourierPayloadPresente_(dados)) validarProjetoCourierIds_(dados, { legadosPorCampo: couriersLegadosPorCampo });
  if (projetoSoAConfigPayloadPresente_(dados)) validarProjetoSoAConfig_(dados);

  if (dados.id) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(dados.id)) {
        aba.getRange(i + 1, 2, 1, 16).setValues([[
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
          dados.metaRecrutamento || '',
          dados.status        || '',
          dados.numeroCE      || '',
          dados.expedienteCE  || '',
          dados.tituloCompleto || ''
        ]]);
        gravarProjetoCourierIds_(aba, i + 1, dados);
        gravarProjetoSoAConfig_(aba, i + 1, dados);
        clearTransporteOptionsCache_();
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
      dados.metaRecrutamento || '',
      dados.status        || '',
      dados.numeroCE      || '',
      dados.expedienteCE  || '',
      dados.tituloCompleto || ''
    ]);
    gravarProjetoCourierIds_(aba, aba.getLastRow(), dados);
    gravarProjetoSoAConfig_(aba, aba.getLastRow(), dados);
    clearTransporteOptionsCache_();
    return 'Projeto cadastrado com sucesso!';
  }
}

function excluirProjeto(id) {
  codexAssertCanWrite_('excluirProjeto', 'Cadastros', id);
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('Projetos');
  if (!aba) throw new Error('Aba "Projetos" não encontrada.');
  var rows = aba.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      aba.deleteRow(i + 1);
      clearTransporteOptionsCache_();
      return 'Excluído com sucesso.';
    }
  }
  throw new Error('Projeto não encontrado.');
}



// ════════════════════════════════
//  PARTICIPANTES — webapp
// ════════════════════════════════
function participanteCampoKey_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function participanteColumnMap_(sh, createMissing) {
  if (!sh) return {};
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var definitions = [
    ['rua', 'Rua'], ['numero', 'Número'], ['cidade', 'Cidade'], ['estado', 'Estado'], ['cep', 'CEP'],
    ['banco', 'Banco'], ['agencia', 'Agência'], ['contaCorrente', 'Conta corrente'],
    ['titularConta', 'Titular da Conta Corrente'], ['cpfTitular', 'CPF do Titular']
  ];
  var aliases = {
    rua: ['rua', 'endereco'], numero: ['numero', 'n'], cidade: ['cidade'], estado: ['estado', 'uf'], cep: ['cep'],
    banco: ['banco', 'nomedobanco'], agencia: ['agencia'], contaCorrente: ['contacorrente', 'conta'],
    titularConta: ['titulardacontacorrente', 'titulardaconta'], cpfTitular: ['cpfdotitular']
  };
  var map = {};
  headers.forEach(function(header, index) {
    var key = participanteCampoKey_(header);
    definitions.forEach(function(definition) {
      if (map[definition[0]] !== undefined) return;
      if ((aliases[definition[0]] || [participanteCampoKey_(definition[1])]).indexOf(key) >= 0) map[definition[0]] = index;
    });
  });
  if (!createMissing) return map;
  definitions.forEach(function(definition) {
    if (map[definition[0]] !== undefined) return;
    lastCol++;
    if (typeof sh.getMaxColumns === 'function' && sh.getMaxColumns() < lastCol) sh.insertColumnsAfter(sh.getMaxColumns(), lastCol - sh.getMaxColumns());
    sh.getRange(1, lastCol).setValue(definition[1]);
    map[definition[0]] = lastCol - 1;
  });
  return map;
}

function gravarParticipanteCamposNovos_(sh, rowNumber, d, columns) {
  var values = {
    rua: d.rua || '', numero: d.numero || '', cidade: d.cidade || '', estado: d.estado || '', cep: d.cep || '',
    banco: d.banco || '', agencia: d.agencia || '', contaCorrente: d.contaCorrente || '',
    titularConta: d.titularConta || '', cpfTitular: d.cpfTitular || ''
  };
  Object.keys(values).forEach(function(key) {
    if (columns[key] !== undefined) sh.getRange(rowNumber, columns[key] + 1).setValue(values[key]);
  });
}

var PARTICIPANTE_CTMS_FIELDS_ = [
  { key: 'bracoId', header: 'CTMS Braço ID', aliases: ['CTMS Braco ID', 'Braço CTMS ID', 'Braco CTMS ID'] },
  { key: 'marcosJson', header: 'CTMS Marcos (JSON)', aliases: ['Marcos CTMS', 'CTMS Marcos'] },
  { key: 'escolhasJson', header: 'CTMS Escolhas (JSON)', aliases: ['Escolhas CTMS', 'CTMS Escolhas'] },
  { key: 'aprovacoesJson', header: 'CTMS Aprovações (JSON)', aliases: ['CTMS Aprovacoes (JSON)', 'Aprovações CTMS', 'Aprovacoes CTMS'] }
];

function participanteCtmsColumnMapFromHeaders_(headers) {
  var normalized = (headers || []).map(participanteCampoKey_);
  var map = { bracoId: -1, marcosJson: -1, escolhasJson: -1, aprovacoesJson: -1 };
  PARTICIPANTE_CTMS_FIELDS_.forEach(function(field) {
    var names = [field.header].concat(field.aliases || []).map(participanteCampoKey_);
    for (var i = 0; i < normalized.length; i++) {
      if (names.indexOf(normalized[i]) >= 0) { map[field.key] = i; break; }
    }
  });
  return map;
}

function participanteCtmsGarantirColumns_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var map = participanteCtmsColumnMapFromHeaders_(headers);
  PARTICIPANTE_CTMS_FIELDS_.forEach(function(field) {
    if (map[field.key] >= 0) return;
    lastCol++;
    if (typeof sh.getMaxColumns === 'function' && sh.getMaxColumns() < lastCol) sh.insertColumnsAfter(sh.getMaxColumns(), lastCol - sh.getMaxColumns());
    sh.getRange(1, lastCol).setValue(field.header);
    map[field.key] = lastCol - 1;
  });
  return map;
}

function participanteCtmsJsonObject_(value) {
  if (!String(value || '').trim()) return {};
  try {
    var parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function jornadaCtmsLocalizarParticipante_(rows, payload) {
  payload = payload || {};
  var idCadastro = String(payload.idCadastro || '').trim();
  var idParticipante = normText_(payload.idParticipante);
  var projeto = normText_(payload.projeto);
  var nome = normText_(payload.nome);
  for (var i = 1; i < (rows || []).length; i++) {
    var row = rows[i] || [];
    if (idCadastro && String(row[0] || '').trim() === idCadastro) return i;
    if (idParticipante && projeto && normText_(row[4]) === idParticipante && normText_(row[5]) === projeto) return i;
    if (!idParticipante && nome && projeto && normText_(row[1]) === nome && normText_(row[5]) === projeto) return i;
  }
  return -1;
}

function jornadaCtmsLerConfigParticipante_(payload) {
  var rows = getCodexSheetDataByName_('Participantes');
  if (!rows.length) return { bracoId: '', marcos: {}, escolhasReferencias: {}, aprovacoes: {} };
  var rowIndex = jornadaCtmsLocalizarParticipante_(rows, payload);
  if (rowIndex < 1) return { bracoId: '', marcos: {}, escolhasReferencias: {}, aprovacoes: {} };
  var columns = participanteCtmsColumnMapFromHeaders_(rows[0] || []);
  var row = rows[rowIndex] || [];
  return {
    bracoId: columns.bracoId >= 0 ? String(row[columns.bracoId] || '').trim() : '',
    marcos: columns.marcosJson >= 0 ? participanteCtmsJsonObject_(row[columns.marcosJson]) : {},
    escolhasReferencias: columns.escolhasJson >= 0 ? participanteCtmsJsonObject_(row[columns.escolhasJson]) : {},
    aprovacoes: columns.aprovacoesJson >= 0 ? participanteCtmsJsonObject_(row[columns.aprovacoesJson]) : {}
  };
}

var JORNADA_CTMS_MARCOS_ = [
  { chave: 'RANDOMIZACAO', label: 'Randomização' },
  { chave: 'INCLUSAO', label: 'Inclusão' },
  { chave: 'ULTIMA_DOSE', label: 'Última dose' },
  { chave: 'FIM_TRATAMENTO', label: 'Fim do tratamento' },
  { chave: 'PROGRESSAO_DOENCA', label: 'Progressão da doença' },
  { chave: 'OUTRA', label: 'Outra data de referência' }
];

function jornadaCtmsMontarConfiguracao_(visitas, bracos, config, bracoIdEfetivo) {
  config = config || {};
  var bracoId = String(config.bracoId || bracoIdEfetivo || '').trim();
  var ativas = (visitas || []).filter(function(visita) {
    if (!visita || visita.ativo === false) return false;
    var ids = soaUniqueIds_(visita.bracoIds || []);
    return !ids.length || (!!bracoId && ids.indexOf(bracoId) >= 0);
  });
  var marcosUsados = {};
  var escolhasNecessarias = [];
  ativas.forEach(function(visita) {
    [visita.referencia, visita.referenciaAlternativa].forEach(function(referencia) {
      referencia = String(referencia || '').trim();
      if (jornadaCtmsReferenciaEspecial_(referencia)) marcosUsados[referencia] = true;
    });
    if (String(visita.criterioReferencias || '').trim() !== 'SELECAO_MANUAL' || !visita.referenciaAlternativa) return;
    escolhasNecessarias.push({
      idSoA: String(visita.idSoA || ''),
      codigo: String(visita.codigo || ''),
      nome: String(visita.nome || ''),
      opcoes: [
        { valor: String(visita.referencia || ''), label: String(visita.referencia || '') },
        { valor: String(visita.referenciaAlternativa || ''), label: String(visita.referenciaAlternativa || '') }
      ]
    });
  });
  return {
    bracoId: bracoId,
    bracos: (bracos || []).map(function(braco) { return { idBraco: String(braco.idBraco || ''), nome: String(braco.nome || '') }; }),
    marcos: config.marcos || {},
    marcosNecessarios: JORNADA_CTMS_MARCOS_.filter(function(marco) { return marcosUsados[marco.chave]; }),
    escolhasReferencias: config.escolhasReferencias || {},
    escolhasNecessarias: escolhasNecessarias
  };
}

function jornadaCtmsNormalizarConfigParticipante_(payload, visitas, bracos) {
  payload = payload || {};
  var bracoId = String(payload.bracoId || '').trim();
  var bracoIds = (bracos || []).map(function(braco) { return String(braco.idBraco || ''); });
  if (bracoId && bracoIds.indexOf(bracoId) < 0) throw new Error('O braço CTMS selecionado não pertence a este projeto.');
  var marcos = {};
  Object.keys(payload.marcos || {}).forEach(function(key) {
    var value = String(payload.marcos[key] || '').trim();
    if (!value) return;
    if (!jornadaCtmsReferenciaEspecial_(key)) throw new Error('O marco CTMS ' + key + ' não é reconhecido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || jornadaCtmsDateIso_(value) !== value) throw new Error('A data do marco ' + key + ' é inválida.');
    marcos[key] = value;
  });
  var manuais = {};
  (visitas || []).forEach(function(visita) {
    if (String(visita.criterioReferencias || '').trim() === 'SELECAO_MANUAL' && visita.referenciaAlternativa) {
      manuais[String(visita.idSoA || '')] = [String(visita.referencia || ''), String(visita.referenciaAlternativa || '')];
    }
  });
  var escolhas = {};
  Object.keys(payload.escolhasReferencias || {}).forEach(function(idSoA) {
    var value = String(payload.escolhasReferencias[idSoA] || '').trim();
    if (!value) return;
    if (!manuais[idSoA] || manuais[idSoA].indexOf(value) < 0) throw new Error('A escolha CTMS da visita ' + idSoA + ' não corresponde às referências permitidas.');
    escolhas[idSoA] = value;
  });
  return { bracoId: bracoId, marcos: marcos, escolhasReferencias: escolhas };
}

function salvarConfiguracaoCtmsParticipante_(payload) {
  payload = payload || {};
  var projeto = String(payload.projeto || '').trim();
  if (!projeto) throw new Error('Informe o projeto do participante.');
  var visitas = getSoAVisitasProjeto(projeto);
  var bracos = getBracosProjeto(projeto);
  var config = jornadaCtmsNormalizarConfigParticipante_(payload, visitas, bracos);
  codexWithDocumentLock_('salvar configuração CTMS do participante', function() {
    var sh = getCodexSpreadsheet_().getSheetByName('Participantes');
    if (!sh) throw new Error('Aba Participantes não encontrada.');
    var rows = sh.getDataRange().getValues();
    var rowIndex = jornadaCtmsLocalizarParticipante_(rows, payload);
    if (rowIndex < 1) throw new Error('Participante não encontrado para salvar a configuração CTMS.');
    if (normText_(rows[rowIndex][5]) !== normText_(projeto)) throw new Error('O participante não pertence ao projeto informado.');
    var columns = participanteCtmsGarantirColumns_(sh);
    var rowNumber = rowIndex + 1;
    sh.getRange(rowNumber, columns.bracoId + 1).setValue(config.bracoId);
    sh.getRange(rowNumber, columns.marcosJson + 1).setValue(Object.keys(config.marcos).length ? JSON.stringify(config.marcos) : '');
    sh.getRange(rowNumber, columns.escolhasJson + 1).setValue(Object.keys(config.escolhasReferencias).length ? JSON.stringify(config.escolhasReferencias) : '');
    clearCodexRuntimeCaches_();
  });
  return {
    ok: true,
    msg: 'Marcos e escolhas CTMS salvos para o participante.',
    jornada: getJornadaParticipante({ idCadastro: payload.idCadastro, nome: payload.nome, idParticipante: payload.idParticipante, projeto: projeto, braco: payload.braco })
  };
}

function definirAprovacaoCtmsParticipante_(payload) {
  payload = payload || {};
  var idSoA = String(payload.idSoA || '').trim();
  var fingerprint = String(payload.fingerprint || '').trim();
  var aprovar = payload.aprovar === true;
  if (!idSoA) throw new Error('Informe a visita CTMS a revisar.');
  codexWithDocumentLock_('definir aprovação CTMS do participante', function() {
    var jornadaAtual = getJornadaParticipante(payload);
    var previa = jornadaAtual && jornadaAtual.previaCtms;
    var row = previa && (previa.linhas || []).filter(function(item) { return String(item.idSoA || '') === idSoA; })[0];
    if (!row) throw new Error('A comparação CTMS não está mais disponível. Reabra a prévia.');
    if (aprovar && (!row.aprovavel || !fingerprint || fingerprint !== row.fingerprint)) {
      throw new Error('A comparação CTMS mudou ou não pode ser aprovada. Reabra a prévia e revise novamente.');
    }
    var sh = getCodexSpreadsheet_().getSheetByName('Participantes');
    if (!sh) throw new Error('Aba Participantes não encontrada.');
    var rows = sh.getDataRange().getValues();
    var rowIndex = jornadaCtmsLocalizarParticipante_(rows, payload);
    if (rowIndex < 1) throw new Error('Participante não encontrado para registrar a aprovação CTMS.');
    if (normText_(rows[rowIndex][5]) !== normText_(payload.projeto)) throw new Error('O participante não pertence ao projeto informado.');
    var columns = participanteCtmsGarantirColumns_(sh);
    var aprovacoes = participanteCtmsJsonObject_(rows[rowIndex][columns.aprovacoesJson]);
    if (aprovar) {
      aprovacoes[idSoA] = {
        fingerprint: row.fingerprint,
        aprovadoEm: Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ssXXX"),
        aprovadoPor: codexGetActiveUserEmail_()
      };
    } else {
      delete aprovacoes[idSoA];
    }
    sh.getRange(rowIndex + 1, columns.aprovacoesJson + 1).setValue(Object.keys(aprovacoes).length ? JSON.stringify(aprovacoes) : '');
    clearCodexRuntimeCaches_();
  });
  codexWriteAuditLog_('definirAprovacaoCtmsParticipante', 'Cadastros', idSoA + ':' + (aprovar ? 'aprovada' : 'revogada'));
  return {
    ok: true,
    msg: aprovar ? 'Comparação CTMS aprovada.' : 'Aprovação CTMS revogada.',
    jornada: getJornadaParticipante(payload)
  };
}

function getParticipantes() {
  var rows = getCodexSheetDataByName_('Participantes');
  if (!rows.length) return [];
  var header = rows[0] || [];
  var columns = {};
  header.forEach(function(value, index) { columns[participanteCampoKey_(value)] = index; });
  function valueFor(r, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var index = columns[aliases[i]];
      if (index !== undefined) return r[index] || '';
    }
    return '';
  }
  var tz  = Session.getScriptTimeZone();
  var ultimaVisitaMap = getUltimasVisitasParticipantesAgendaMap_();

  return rows.slice(1)
    .filter(function(r){ return r[0] !== '' && r[0] !== undefined && r[0] !== null; })
    .map(function(r) {
      var ultimaVisita = ultimaVisitaMap[normText_(r[1])] || { data: '', visita: '---' };
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
        ultimaVisita:   String(ultimaVisita.visita || '---'),
        ultimaVisitaData: String(ultimaVisita.data || ''),
        status:         String(r[8] || ''),
        telefone:       String(r[9] || ''),
        cpf:            String(r[10] || ''),
        observacoes:    String(r[11] || ''),
        rua:            String(valueFor(r, ['rua', 'endereco']) || ''),
        numero:         String(valueFor(r, ['numero', 'n']) || ''),
        cidade:         String(valueFor(r, ['cidade']) || ''),
        estado:         String(valueFor(r, ['estado', 'uf']) || ''),
        cep:            String(valueFor(r, ['cep']) || ''),
        banco:          String(valueFor(r, ['banco', 'nomedobanco']) || ''),
        agencia:        String(valueFor(r, ['agencia']) || ''),
        contaCorrente:  String(valueFor(r, ['contacorrente', 'conta']) || ''),
        titularConta:   String(valueFor(r, ['titulardacontacorrente', 'titulardaconta']) || ''),
        cpfTitular:     String(valueFor(r, ['cpfdotitular']) || '')
      };
    });
}

function getParticipanteFormConfig() {
  return {
    status: getConfigValues_('Participantes', 'Status', []),
    bancos: getConfigValues_('Participantes', 'Bancos', [])
  };
}

function participanteReferenciaCadastro_(row) {
  row = row || [];
  return {
    idCadastro: String(row[0] || '').trim(),
    nome: String(row[1] || '').trim(),
    idParticipante: String(row[4] || '').trim(),
    projeto: String(row[5] || '').trim()
  };
}

function participanteReferenciaKey_(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function participanteTabelaReferencias_(sh) {
  if (!sh || sh.getLastRow() < 1) return null;
  var values = sh.getDataRange().getValues();
  var maxHeaderRows = Math.min(values.length, 10);
  var nomeAliases = ['participante', 'paciente', 'nomedoparticipante', 'nomedopaciente'];
  var idAliases = ['idparticipante', 'numerodeidentificacao', 'nodeidentificacao', 'identificacaoparticipante'];
  var projetoAliases = ['projeto', 'protocolo', 'estudo'];
  var cadastroAliases = ['idcadastroparticipante', 'participantecadastroid', 'idinternoparticipante'];

  function aliasIndex(map, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      if (map[aliases[i]] !== undefined) return map[aliases[i]];
    }
    return -1;
  }

  for (var r = 0; r < maxHeaderRows; r++) {
    var map = {};
    for (var c = 0; c < values[r].length; c++) {
      var key = participanteReferenciaKey_(values[r][c]);
      if (key) map[key] = c;
    }
    var nomeCol = aliasIndex(map, nomeAliases);
    if (nomeCol < 0) continue;
    var idCol = aliasIndex(map, idAliases);
    var projetoCol = aliasIndex(map, projetoAliases);
    var cadastroCol = aliasIndex(map, cadastroAliases);
    if (idCol < 0 && projetoCol < 0 && cadastroCol < 0) continue;
    return {
      values: values,
      headerRow: r,
      nomeCol: nomeCol,
      idCol: idCol,
      projetoCol: projetoCol,
      cadastroCol: cadastroCol
    };
  }
  return null;
}

function sincronizarNomeParticipanteReferencias_(ss, anterior, atual) {
  anterior = anterior || {};
  atual = atual || {};
  var idCadastro = String(atual.idCadastro || anterior.idCadastro || '').trim();
  var nomeNovo = String(atual.nome || '').trim();
  if (!ss || !idCadastro || !nomeNovo) return { atualizadas: 0, abas: [] };

  var sheets = typeof ss.getSheets === 'function' ? ss.getSheets() : [];
  var atualizadas = 0;
  var abas = [];
  var oldNameKey = participanteReferenciaKey_(anterior.nome);
  var idsValidos = {};
  [anterior.idParticipante, atual.idParticipante].forEach(function(value) {
    var key = participanteReferenciaKey_(value);
    if (key) idsValidos[key] = true;
  });
  var projetosValidos = {};
  [anterior.projeto, atual.projeto].forEach(function(value) {
    var key = participanteReferenciaKey_(value);
    if (key) projetosValidos[key] = true;
  });

  sheets.forEach(function(sh) {
    if (!sh || participanteReferenciaKey_(sh.getName && sh.getName()) === 'participantes') return;
    var table = participanteTabelaReferencias_(sh);
    if (!table) return;
    var cadastroCol = table.cadastroCol;
    var matchedRows = [];
    for (var r = table.headerRow + 1; r < table.values.length; r++) {
      var row = table.values[r] || [];
      var rowCadastro = cadastroCol >= 0 ? String(row[cadastroCol] || '').trim() : '';
      var rowNomeKey = participanteReferenciaKey_(row[table.nomeCol]);
      var rowIdKey = table.idCol >= 0 ? participanteReferenciaKey_(row[table.idCol]) : '';
      var rowProjetoKey = table.projetoCol >= 0 ? participanteReferenciaKey_(row[table.projetoCol]) : '';
      var projetoCompativel = !rowProjetoKey || !Object.keys(projetosValidos).length || !!projetosValidos[rowProjetoKey];
      var legadoCompativel = projetoCompativel && (
        (rowIdKey && idsValidos[rowIdKey]) ||
        (oldNameKey && rowNomeKey === oldNameKey && !!rowProjetoKey)
      );
      if (rowCadastro !== idCadastro && (rowCadastro || !legadoCompativel)) continue;
      matchedRows.push(r);
    }
    if (!matchedRows.length) return;
    if (cadastroCol < 0) {
      cadastroCol = table.values.reduce(function(max, row) { return Math.max(max, row.length); }, 0);
      sh.getRange(table.headerRow + 1, cadastroCol + 1).setValue('ID Cadastro Participante');
    }

    matchedRows.forEach(function(r) {
      sh.getRange(r + 1, table.nomeCol + 1).setValue(nomeNovo);
      if (table.idCol >= 0 && String(atual.idParticipante || '').trim()) {
        sh.getRange(r + 1, table.idCol + 1).setValue(String(atual.idParticipante).trim());
      }
      sh.getRange(r + 1, cadastroCol + 1).setValue(idCadastro);
      atualizadas++;
    });
    abas.push(String(sh.getName ? sh.getName() : ''));
  });
  return { atualizadas: atualizadas, abas: abas };
}

function salvarDadosParticipante(d) {
  codexAssertCanWrite_('salvarDadosParticipante', 'Cadastros', d && d.id);
  d = d || {};
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var sh   = ss.getSheetByName('Participantes');
  if (!sh) throw new Error('Aba "Participantes" não encontrada.');
  var rows = sh.getDataRange().getValues();
  var editRowIndex = -1;
  if (d.id) {
    for (var editIdx = 1; editIdx < rows.length; editIdx++) {
      if (String(rows[editIdx][0]) === String(d.id)) {
        editRowIndex = editIdx;
        break;
      }
    }
    if (editRowIndex < 0) throw new Error('Participante não encontrado (id=' + d.id + ')');
    var existing = rows[editRowIndex] || [];
    if (!String(d.projeto || '').trim()) d.projeto = String(existing[5] || '').trim();
    if (!String(d.status || '').trim()) d.status = String(existing[8] || '').trim();
    if (!String(d.idParticipante || '').trim()) d.idParticipante = String(existing[4] || '').trim();
  }
  var projeto = String(d.projeto || '').trim();
  var projetos = getProjetosParticipantesOptions_();
  var ausentes = CadastroRules_.requiredParticipantFields(d);
  if (ausentes.length) throw new Error('Preencha os campos obrigatórios: ' + ausentes.join(', ') + '.');
  if (!CadastroRules_.projectExists(projeto, projetos)) {
    throw new Error('Selecione um projeto cadastrado para o participante.');
  }
  var duplicado = CadastroRules_.findParticipantDuplicate(d, rows);
  if (duplicado) {
    throw new Error(duplicado.field === 'cpf'
      ? 'Já existe um participante cadastrado com este CPF.'
      : 'Já existe um participante com este ID vinculado ao mesmo projeto.');
  }
  var nomeDuplicado = CadastroRules_.findParticipantNameDuplicate(d, rows);
  if (nomeDuplicado && d.confirmarNomeDuplicado !== true) {
    return {
      requiresNameConfirmation: true,
      title: 'Participante já cadastrado',
      message: 'Já existe um participante cadastrado com este nome. Revise os dados antes de continuar. Um novo cadastro é recomendado somente quando o participante recebeu um novo número de identificação/triagem ou passou a participar de outro protocolo.',
      existing: nomeDuplicado
    };
  }

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

  var participantColumns = participanteColumnMap_(sh, true);

  var rowStart = [
    d.id || '',
    d.nome,
    parseDate(d.dataNascimento)
  ];
  var rowAfterIdade = [
    d.idParticipante,
    projeto,
    d.braco || '',
    parseDate(d.ultimaVisita),
    d.status,
    d.telefone || '',
    d.cpf || '',
    d.observacoes || ''
  ];

  if (d.id) {
    var referenciaAnterior = participanteReferenciaCadastro_(rows[editRowIndex]);
    sh.getRange(editRowIndex + 1, 1, 1, rowStart.length).setValues([rowStart]);
    sh.getRange(editRowIndex + 1, 5, 1, rowAfterIdade.length).setValues([rowAfterIdade]);
    gravarParticipanteCamposNovos_(sh, editRowIndex + 1, d, participantColumns);
    if (editRowIndex + 1 > 2) sh.getRange(editRowIndex + 1, 4).clearContent();
    var referenciaAtual = participanteReferenciaCadastro_([
      d.id, d.nome, parseDate(d.dataNascimento), '', d.idParticipante,
      projeto, d.braco || ''
    ]);
    sincronizarNomeParticipanteReferencias_(ss, referenciaAnterior, referenciaAtual);
    clearCodexRuntimeCaches_();
    if (typeof clearTransporteOptionsCache_ === 'function') clearTransporteOptionsCache_();
    return 'Participante atualizado com sucesso';
  } else {
    var maxId = 0;
    rows.slice(1).forEach(function(r) {
      var n = parseInt(r[0]);
      if (!isNaN(n) && n > maxId) maxId = n;
    });
    rowStart[0] = maxId + 1;
    var targetRow = sh.getLastRow() + 1;
    sh.getRange(targetRow, 1, 1, rowStart.length).setValues([rowStart]);
    sh.getRange(targetRow, 5, 1, rowAfterIdade.length).setValues([rowAfterIdade]);
    gravarParticipanteCamposNovos_(sh, targetRow, d, participantColumns);
    clearCodexRuntimeCaches_();
    if (typeof clearTransporteOptionsCache_ === 'function') clearTransporteOptionsCache_();
    return 'Participante cadastrado com sucesso';
  }
}

function corrigirMatrizIdadeParticipantes() {
  codexAssertCanWrite_('corrigirMatrizIdadeParticipantes', 'Cadastros', 'Participantes');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Participantes');
  if (!sh) throw new Error('Aba Participantes nao encontrada.');
  var lastRow = sh.getLastRow();
  if (lastRow >= 3) sh.getRange(3, 4, lastRow - 2, 1).clearContent();
  var formula = '=ARRAYFORMULA(IF(ISNUMBER(C2:C);DATEDIF(C2:C;TODAY();"Y");""))';
  var d2 = sh.getRange(2, 4);
  if (!String(d2.getFormula() || '').trim()) d2.setFormula(formula);
  return 'Matriz de idade dos participantes corrigida.';
}

function excluirParticipante(id) {
  codexAssertCanWrite_('excluirParticipante', 'Cadastros', id);
  return codexWithDocumentLock_('excluirParticipante', function() {
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var sh   = ss.getSheetByName('Participantes');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      var participante = participanteReferenciaCadastro_(rows[i]);
      var agenda = getAgendaSheet_();
      if (agenda && agenda.getLastRow() >= 2) {
        var agendaRows = agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol).getValues();
        var possuiEvento = agendaRows.some(function(row) {
          return CadastroRules_.agendaEventMatchesParticipant(participante, {
            participante: row[AGENDA_CFG.idx.participante],
            idParticipante: row[AGENDA_CFG.idx.idParticipante],
            projeto: row[AGENDA_CFG.idx.projeto]
          });
        });
        if (possuiEvento) {
          throw new Error('Não é possível excluir este participante porque existe pelo menos um evento registrado para ele na Agenda. Exclua ou desvincule os eventos antes de tentar novamente.');
        }
      }
      sh.deleteRow(i + 1);
      clearCodexRuntimeCaches_();
      if (typeof clearTransporteOptionsCache_ === 'function') clearTransporteOptionsCache_();
      return 'Participante excluído';
    }
  }
  throw new Error('Participante não encontrado (id=' + id + ')');
  });
}

// ════════════════════════════════
//  MONITORES — webapp
// ════════════════════════════════
function getProjetosMonitoria_() {
  return getProjetoOptions_();
}

function getMonitores() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Monitores');
  if (!sh) throw new Error('Aba "Monitores" não encontrada.');
  var rows = getCodexSheetDataFromSheet_(sh);
  if (!rows.length) return [];
  return rows.slice(1)
    .filter(function(r) { return r[0] !== '' && r[0] !== undefined && r[0] !== null; })
    .map(function(r) {
      var projetosDetalhes = [
        { projeto: String(r[4] || '').trim(), unblinded: String(r[5] || '').trim() },
        { projeto: String(r[6] || '').trim(), unblinded: String(r[7] || '').trim() },
        { projeto: String(r[8] || '').trim(), unblinded: String(r[9] || '').trim() },
        { projeto: String(r[10] || '').trim(), unblinded: String(r[11] || '').trim() }
      ].filter(function(p) { return p.projeto; });
      return {
        id: String(r[0] || ''),
        nome: String(r[1] || ''),
        email: String(r[2] || ''),
        telefone: String(r[3] || ''),
        projeto1: String(r[4] || ''),
        unblinded1: String(r[5] || ''),
        projeto2: String(r[6] || ''),
        unblinded2: String(r[7] || ''),
        projeto3: String(r[8] || ''),
        unblinded3: String(r[9] || ''),
        projeto4: String(r[10] || ''),
        unblinded4: String(r[11] || ''),
        projetos: projetosDetalhes.map(function(p) { return p.projeto; }),
        projetosDetalhes: projetosDetalhes
      };
    })
    .sort(function(a, b) {
      var nomeA = String((a && a.nome) || '').trim();
      var nomeB = String((b && b.nome) || '').trim();
      return nomeA.localeCompare(nomeB, 'pt-BR', { sensitivity: 'base' }) ||
        String((a && a.id) || '').localeCompare(String((b && b.id) || ''));
    });
}

function normalizarMonitorUnblinded_(projeto, valor) {
  if (!String(projeto || '').trim()) return '';
  var v = String(valor || '').trim().toLowerCase();
  return v === 'sim' || v === 'yes' || v === 'true' || v === '1' ? 'Sim' : 'Não';
}

function salvarDadosMonitor(d) {
  codexAssertCanWrite_('salvarDadosMonitor', 'Cadastros', d && d.id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Monitores');
  if (!sh) throw new Error('Aba "Monitores" não encontrada.');

  var rowData = [
    d.id || '',
    d.nome || '',
    d.email || '',
    d.telefone || '',
    d.projeto1 || '',
    normalizarMonitorUnblinded_(d.projeto1, d.unblinded1),
    d.projeto2 || '',
    normalizarMonitorUnblinded_(d.projeto2, d.unblinded2),
    d.projeto3 || '',
    normalizarMonitorUnblinded_(d.projeto3, d.unblinded3),
    d.projeto4 || '',
    normalizarMonitorUnblinded_(d.projeto4, d.unblinded4)
  ];

  if (d.id) {
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        sh.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
        clearCodexRuntimeCaches_();
        return 'Monitor atualizado com sucesso.';
      }
    }
    throw new Error('Monitor não encontrado para edição.');
  }

  rowData[0] = 'MON-' + Date.now();
  sh.appendRow(rowData);
  clearCodexRuntimeCaches_();
  return 'Monitor cadastrado com sucesso.';
}

function excluirMonitor(id) {
  codexAssertCanWrite_('excluirMonitor', 'Cadastros', id);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Monitores');
  if (!sh || sh.getLastRow() < 2) throw new Error('Nenhum monitor encontrado.');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      clearCodexRuntimeCaches_();
      return 'Monitor excluído.';
    }
  }
  throw new Error('Monitor não encontrado.');
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRESTADORES
// ══════════════════════════════════════════════════════════════════════════════
function getPrestadorTipoServicoOptions_() {
  garantirPrestadorTipoServicoDefaults_();
  return getConfigAppValuesByKeys_(
    ['Prestadores', 'Requisição de Exames', 'Requisicao de Exames'],
    ['Tipo de Serviço', 'Tipos de Serviço', 'Tipo de servico', 'Tipos de servico'],
    ['Análises clínicas', 'Serviço de imagem', 'Outros']
  );
}

function garantirPrestadorTipoServicoDefaults_() {
  var sh = getConfigAppSheet_();
  var defaults = ['Análises clínicas', 'Serviço de imagem', 'Outros'];
  var existing = {};
  var lastRow = Math.max(sh.getLastRow(), 1);
  if (lastRow >= 2) {
    [[1, 'Principal'], [8, 'Apoio']].forEach(function(block) {
      var values = sh.getRange(2, block[0], lastRow - 1, 6).getValues();
      values.forEach(function(r) {
        if (normText_(r[0]) === 'prestadores' && normText_(r[1]) === 'tipo de servico') {
          existing[normText_(r[2])] = true;
        }
      });
    });
  }
  var target = 2;
  if (lastRow >= 2) {
    sh.getRange(2, 8, lastRow - 1, 1).getValues().forEach(function(r, idx) {
      if (String(r[0] || '').trim()) target = idx + 3;
    });
  }
  var inserted = false;
  defaults.forEach(function(value, idx) {
    if (existing[normText_(value)]) return;
    sh.getRange(target, 8, 1, 6).setValues([[
      'Prestadores',
      'Tipo de Serviço',
      value,
      'Sim',
      idx + 1,
      'Tipos usados para classificar prestadores e selecionar preloads de requisição.'
    ]]);
    target++;
    inserted = true;
  });
  if (inserted) {
    CODEX_CONFIG_APP_ROWS_CACHE_ = null;
    try { codexCacheRemove_('ConfigAppRows:v2'); } catch (e) {}
  }
}

function ensurePrestadoresTipoServicoColumn_(sh) {
  if (!sh) return 5;
  var lastCol = Math.max(sh.getLastColumn(), 4);
  if (sh.getMaxColumns() < 5) sh.insertColumnsAfter(sh.getMaxColumns(), 5 - sh.getMaxColumns());
  var headers = sh.getRange(1, 1, 1, Math.max(lastCol, 5)).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (normText_(headers[i]) === 'tipo de servico') return i + 1;
  }
  if (!String(headers[4] || '').trim()) {
    sh.getRange(1, 5).setValue('Tipo de Serviço');
    return 5;
  }
  var target = headers.length + 1;
  if (sh.getMaxColumns() < target) sh.insertColumnsAfter(sh.getMaxColumns(), target - sh.getMaxColumns());
  sh.getRange(1, target).setValue('Tipo de Serviço');
  return target;
}

function prestadorTelefoneColumn_(sh, criar) {
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 4)).getValues()[0];
  for (var i = 0; i < headers.length; i++) if (normText_(headers[i]) === 'telefone') return i + 1;
  if (!criar) return 0;
  var target = headers.length + 1;
  if (sh.getMaxColumns() < target) sh.insertColumnsAfter(sh.getMaxColumns(), target - sh.getMaxColumns());
  sh.getRange(1, target).setValue('Telefone');
  return target;
}

function getPrestadores() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🏢 Prestadores');
  if (!sh) return [];
  var tipoCol = ensurePrestadoresTipoServicoColumn_(sh);
  var telefoneCol = prestadorTelefoneColumn_(sh, false);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(4, tipoCol, telefoneCol)).getValues()
    .filter(function(r) { return r[1]; })
    .map(function(r) {
      return { id: r[0] || '', empresa: r[1] || '', endereco: r[2] || '', email: r[3] || '', tipoServico: r[tipoCol - 1] || '', telefone: telefoneCol ? r[telefoneCol - 1] || '' : '' };
    });
}

function salvarDadosPrestador(dados) {
  codexAssertCanWrite_('salvarDadosPrestador', 'Cadastros', dados && dados.id);
  dados = dados || {};
  if (!String(dados.empresa || '').trim()) throw new Error('Informe a empresa do prestador.');
  if (!String(dados.email || '').trim()) throw new Error('Informe o e-mail do prestador.');
  if (!String(dados.tipoServico || '').trim()) throw new Error('Informe o tipo de serviço do prestador.');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🏢 Prestadores');
  if (!sh) throw new Error("Aba 'Prestadores' não encontrada.");
  var tipoCol = ensurePrestadoresTipoServicoColumn_(sh);
  var telefoneCol = prestadorTelefoneColumn_(sh, true);
  if (dados.id && dados.id !== '') {
    var ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(dados.id)) {
        var ln = i + 2;
        sh.getRange(ln, 2).setValue(dados.empresa  || '');
        sh.getRange(ln, 3).setValue(dados.endereco || '');
        sh.getRange(ln, 4).setValue(dados.email    || '');
        sh.getRange(ln, tipoCol).setValue(dados.tipoServico || '');
        sh.getRange(ln, telefoneCol).setValue(dados.telefone || '');
        return 'Prestador atualizado com sucesso.';
      }
    }
    throw new Error('Prestador não encontrado para edição.');
  }
  var row = ['PREST-' + Date.now(), dados.empresa || '', dados.endereco || '', dados.email || ''];
  while (row.length < tipoCol) row.push('');
  row[tipoCol - 1] = dados.tipoServico || '';
  while (row.length < telefoneCol) row.push('');
  row[telefoneCol - 1] = dados.telefone || '';
  sh.appendRow(row);
  return 'Prestador cadastrado com sucesso.';
}

function excluirPrestador(id) {
  codexAssertCanWrite_('excluirPrestador', 'Cadastros', id);
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
        metaRecrutamento: str(p.metaRecrutamento),
        participantesAtivos: p.participantesAtivos || 0,
        falhasTriagem: p.falhasTriagem || 0,
        totalParticipantes: p.totalParticipantes || 0,
        percentualRecrutamento: p.percentualRecrutamento || '',
        status:        str(p.status),
        classificacaoStatus: str(p.classificacaoStatus)
      };
    });
  } catch(e) {
    Logger.log('[getDashboardData] ERRO getProjetos: ' + e.message);
    diag.erros.push('getProjetos: ' + e.message);
  }

  try {
    var partAll = getParticipantesDashboardResumo_() || [];
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

  var estoque = [];
  try {
    estoque = getEstoque() || [];
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
      eventosPeriodo: [],
      antecedenciaMediaPorTipo: []
    };
  }
  try {
    diag.pendencias = getDashboardPendencias_(estoque);
  } catch(e) {
    Logger.log('[getDashboardData] ERRO pendencias: ' + e.message);
    diag.pendencias = getDashboardPendenciasVazio_();
  }

  Logger.log('[getDashboardData] Retornando. Erros: ' + JSON.stringify(diag.erros));
  return diag;
}

function getPendenciasOperacionais() {
  var access = codexGetCurrentUserAccess();
  if (!access.ok) throw new Error(access.message || 'Acesso negado.');
  var estoque = [];
  try {
    estoque = getEstoqueResumoParaPendencias_() || [];
  } catch(e) {
    Logger.log('[getPendenciasOperacionais] ERRO estoque: ' + e.message);
  }
  return {
    access: access,
    pendencias: getDashboardPendencias_(estoque)
  };
}

function getParticipantesDashboardResumo_() {
  var rows = getCodexSheetDataByName_('Participantes');
  if (!rows.length) return [];
  return rows.slice(1)
    .filter(function(r) { return r[0] !== '' && r[0] !== undefined && r[0] !== null; })
    .map(function(r) {
      return {
        nome: String(r[1] || ''),
        projeto: String(r[5] || ''),
        status: String(r[8] || '')
      };
    });
}

function getEstoqueResumoParaPendencias_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Estoque');
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = Session.getScriptTimeZone();
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
  function fmtDate(v) {
    if (!v) return '';
    try {
      var d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return Utilities.formatDate(d, tz, 'dd/MM/yyyy');
    } catch(e) {
      return String(v);
    }
  }
  return data
    .filter(function(r) { return r[0] || r[2]; })
    .map(function(r) {
      return {
        idItem: String(r[0] || ''),
        projeto: String(r[1] || ''),
        descricao: String(r[2] || ''),
        tipoItem: String(r[3] || ''),
        validade: fmtDate(r[4]),
        localizacao: String(r[5] || ''),
        qtde: r[6] !== '' && r[6] !== null ? Number(r[6]) : '',
        status: String(r[8] || '')
      };
    });
}

function getDashboardPendenciasVazio_() {
  return {
    courierNaoAgendada: [],
    documentacaoTransporteSemEnvio: [],
    transporteBackupNaoAgendado: [],
    courierNaoConfirmada: [],
    awbEnviadaNaoEntregue: [],
    requisicaoExamesPendente: [],
    posVisitaPoloTrialPendente: [],
    posVisitaEcrfPendente: [],
    kitsVencendo: [],
    counts: {
      courierNaoAgendada: 0,
      documentacaoTransporteSemEnvio: 0,
      transporteBackupNaoAgendado: 0,
      courierNaoConfirmada: 0,
      awbEnviadaNaoEntregue: 0,
      requisicaoExamesPendente: 0,
      posVisitaPoloTrialPendente: 0,
      posVisitaEcrfPendente: 0,
      kitsVencendo: 0
    }
  };
}

function getDashboardPendencias_(estoque) {
  var out = getDashboardPendenciasVazio_();
  var agenda = getAgendaSheetForRead_();
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  var posVisitaCorte = parseAgendaDateAny_('2026-05-23');
  if (posVisitaCorte) posVisitaCorte.setHours(23, 59, 59, 999);
  var i = AGENDA_CFG.idx;
  if (agenda.getLastRow() >= 2) {
    var vals = agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol).getDisplayValues();
    var feriados = getAgendaFeriadosPendenciasMap_(vals, i);
    var agendaPorId = {};
    vals.forEach(function(r) {
      var agendaIdAtual = String(r[i.id] || '').trim();
      if (agendaIdAtual) agendaPorId[agendaIdAtual] = r;
      var statusEvento = normText_(r[i.status]);
      var tipoEvento = normText_(r[i.tipo]);
      if (AgendaServerRules_.isCancelled(statusEvento)) return;
      var concluidoPorStatus = AgendaServerRules_.isConcluded(statusEvento);
      var isPosVisita = agendaStatusRealizado_(r[i.status]);
      var dataObj = parseAgendaDateAny_(r[i.data]);
      var isPastDate = false;
      if (dataObj) {
        dataObj.setHours(0, 0, 0, 0);
        isPastDate = dataObj.getTime() < hoje.getTime();
      }
      var base = {
        agendaId: String(r[i.id] || ''),
        data: String(r[i.data] || ''),
        hora: String(r[i.hora] || ''),
        prazoHoras: prazoHorasPendenciaAgenda_(r[i.data], r[i.hora], feriados),
        participante: String(r[i.participante] || ''),
        projeto: String(r[i.projeto] || ''),
        visita: String(r[i.visita] || ''),
        tipo: String(r[i.tipo] || '')
      };
      [
        { label: 'Transporte I', cfg: i.c1 },
        { label: 'Transporte II', cfg: i.c2 },
        { label: 'Transporte III', cfg: i.c3 }
      ].forEach(function(slot) {
        var nome = String(r[slot.cfg.nome] || '').trim();
        if (!isCourierNomeValidoAgenda_(nome)) return;
        var st = normText_(r[slot.cfg.status]);
        if (agendaCourierStatusNaoAplicavel_(st)) return;
        if (!agendaCourierStatusEnviadoNaoEntregue_(st)) return;
        var awb = String(r[slot.cfg.awb] || '').trim();
        out.counts.awbEnviadaNaoEntregue++;
        out.awbEnviadaNaoEntregue.push(Object.assign({}, base, {
          slot: slot.label,
          courier: nome,
          temperatura: String(r[slot.cfg.temp] || '').trim(),
          statusCourier: String(r[slot.cfg.status] || ''),
          awb: awb,
          trackingUrl: agendaTrackingUrl_(awb, nome)
        }));
      });
      if (concluidoPorStatus) return;
      var exigePosVisita = AgendaServerRules_.isPostVisitType(tipoEvento);
      if (isPosVisita && exigePosVisita && (!r[i.poloTrial] || !r[i.ecrf])) {
        var dataPosVisita = parseAgendaDateAny_(r[i.data]);
        if (dataPosVisita) dataPosVisita.setHours(0, 0, 0, 0);
        if (posVisitaCorte && dataPosVisita && dataPosVisita.getTime() <= posVisitaCorte.getTime()) return;
        var posVisitaItem = {
          agendaId: String(r[i.id] || ''),
          data: String(r[i.data] || ''),
          hora: String(r[i.hora] || ''),
          participante: String(r[i.participante] || ''),
          projeto: String(r[i.projeto] || ''),
          visita: String(r[i.visita] || ''),
          status: String(r[i.status] || '')
        };
        if (!r[i.poloTrial]) {
          out.counts.posVisitaPoloTrialPendente++;
          out.posVisitaPoloTrialPendente.push(posVisitaItem);
        }
        if (!r[i.ecrf]) {
          out.counts.posVisitaEcrfPendente++;
          out.posVisitaEcrfPendente.push(posVisitaItem);
        }
      }
      if (isPosVisita || isPastDate) return;
      if (String(r[i.servTerc] || '').trim() && !agendaRequisicaoEnviada_(r[i.reqStatus], r[i.obs])) {
        out.counts.requisicaoExamesPendente++;
        out.requisicaoExamesPendente.push(Object.assign({}, base, {
          prestador: String(r[i.servTerc] || '')
        }));
      }
      var backupNome = String(r[i.cb.nome] || '').trim();
      var backupStatus = String(r[i.cb.status] || '').trim();
      if (isCourierNomeValidoAgenda_(backupNome) &&
          AgendaServerRules_.courierStatusKey(backupStatus) === 'naoagendado') {
        out.counts.transporteBackupNaoAgendado++;
        out.transporteBackupNaoAgendado.push(Object.assign({}, base, {
          slot: 'Transporte de Amostras Backup',
          courier: backupNome,
          temperatura: String(r[i.cb.temp] || '').trim(),
          statusCourier: backupStatus
        }));
      }
      [
        { label: 'Transporte I', cfg: i.c1 },
        { label: 'Transporte II', cfg: i.c2 },
        { label: 'Transporte III', cfg: i.c3 }
      ].forEach(function(slot) {
        var nome = String(r[slot.cfg.nome] || '').trim();
        if (!isCourierNomeValidoAgenda_(nome)) return;
        var st = normText_(r[slot.cfg.status]);
        if (agendaCourierStatusNaoAplicavel_(st)) return;
        var awb = String(r[slot.cfg.awb] || '').trim();
        var item = Object.assign({}, base, {
          slot: slot.label,
          courier: nome,
          temperatura: String(r[slot.cfg.temp] || '').trim(),
          statusCourier: String(r[slot.cfg.status] || ''),
          awb: awb
        });
        if (AgendaServerRules_.courierNeedsSchedule(st, awb)) {
          out.counts.courierNaoAgendada++;
          out.courierNaoAgendada.push(item);
        } else if (AgendaServerRules_.courierIsAwaitingConfirmation(st)) {
          out.counts.courierNaoConfirmada++;
          out.courierNaoConfirmada.push(item);
        }
      });
    });
    var docsPendentes = typeof transporteDocumentosSemEnvioPendencias_ === 'function'
      ? transporteDocumentosSemEnvioPendencias_(new Date())
      : [];
    docsPendentes.forEach(function(doc) {
      var r = agendaPorId[String(doc.agendaId || '').trim()];
      if (!r || AgendaServerRules_.isCancelled(r[i.status])) return;
      var slotKey = String(doc.slot || '').trim();
      var slotCfg = slotKey === '1' ? i.c1 : (slotKey === '2' ? i.c2 : (slotKey === '3' ? i.c3 : null));
      if (!slotCfg) return;
      var statusCourier = String(r[slotCfg.status] || '').trim();
      var statusKey = AgendaServerRules_.courierStatusKey(statusCourier);
      if (['naoagendado', 'pendente', 'agendado'].indexOf(statusKey) === -1) return;
      var base = {
        agendaId: String(r[i.id] || ''),
        data: String(r[i.data] || ''),
        hora: String(r[i.hora] || ''),
        prazoHoras: prazoHorasPendenciaAgenda_(r[i.data], r[i.hora], feriados),
        participante: String(r[i.participante] || ''),
        projeto: String(r[i.projeto] || ''),
        visita: String(r[i.visita] || ''),
        tipo: String(r[i.tipo] || '')
      };
      var slotLabel = 'Transporte ' + (slotKey === '1' ? 'I' : (slotKey === '2' ? 'II' : 'III'));
      ['courierNaoAgendada', 'courierNaoConfirmada'].forEach(function(key) {
        var antes = out[key].length;
        out[key] = out[key].filter(function(item) {
          return !(item.agendaId === base.agendaId && item.slot === slotLabel);
        });
        out.counts[key] = Math.max(0, out.counts[key] - (antes - out[key].length));
      });
      out.counts.documentacaoTransporteSemEnvio++;
      out.documentacaoTransporteSemEnvio.push(Object.assign({}, base, {
        slot: slotLabel,
        courier: String(r[slotCfg.nome] || doc.courier || '').trim(),
        temperatura: String(r[slotCfg.temp] || '').trim(),
        statusCourier: statusCourier,
        referencia: String(doc.referencia || ''),
        geradoEm: String(doc.geradoEm || ''),
        motivo: String(doc.motivo || 'Documentos gerados; envio do e-mail não identificado.')
      }));
    });
  }
  (estoque || []).forEach(function(it) {
    var tipo = normText_(it.tipoItem || it.tipo || '');
    var desc = normText_(it.descricao || '');
    var pareceKit = tipo.indexOf('kit') > -1 || tipo.indexOf('coleta') > -1 ||
      (desc.indexOf('kit') > -1 && desc.indexOf('coleta') > -1);
    if (!pareceKit) return;
    var dias = diasAteValidadeDashboard_(it.validade);
    if (dias === null || dias < 0 || dias > 90) return;
    out.counts.kitsVencendo++;
    out.kitsVencendo.push({
      idItem: String(it.idItem || ''),
      projeto: String(it.projeto || ''),
      descricao: String(it.descricao || ''),
      validade: String(it.validade || ''),
      dias: dias,
      qtde: it.qtde,
      localizacao: String(it.localizacao || '')
    });
  });
  ordenarPendenciasAgendaPorUrgencia_(out.courierNaoAgendada);
  ordenarPendenciasAgendaPorUrgencia_(out.documentacaoTransporteSemEnvio);
  ordenarPendenciasAgendaPorUrgencia_(out.transporteBackupNaoAgendado);
  ordenarPendenciasAgendaPorUrgencia_(out.courierNaoConfirmada);
  ordenarPendenciasAgendaPorUrgencia_(out.awbEnviadaNaoEntregue);
  ordenarPendenciasAgendaPorUrgencia_(out.requisicaoExamesPendente);
  ordenarPendenciasAgendaPorDataHora_(out.posVisitaPoloTrialPendente);
  ordenarPendenciasAgendaPorDataHora_(out.posVisitaEcrfPendente);
  out.kitsVencendo.sort(function(a, b) { return Number(a.dias || 0) - Number(b.dias || 0); });
  return out;
}

function ordenarPendenciasAgendaPorDataHora_(lista) {
  (lista || []).sort(function(a, b) {
    var da = parseAgendaDateAny_(a && a.data);
    var db = parseAgendaDateAny_(b && b.data);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String((a && a.hora) || '').localeCompare(String((b && b.hora) || ''));
  });
}

function agendaCourierStatusNaoAplicavel_(status) {
  return AgendaServerRules_.courierIsNotApplicable(status);
}

function agendaCourierStatusEnviadoNaoEntregue_(status) {
  return AgendaServerRules_.courierIsSentNotDelivered(status);
}

function prazoHorasPendenciaAgenda_(data, hora, feriados) {
  var d = parseAgendaDateAny_(data);
  if (!d) return null;
  var h = String(hora || '').match(/(\d{1,2})[:h](\d{2})/i);
  d.setHours(h ? Number(h[1]) : 23, h ? Number(h[2]) : 59, 0, 0);
  var diff = horasOperacionaisAtePendencia_(new Date(), d, feriados || {});
  if (diff === null || diff === undefined || isNaN(diff)) return null;
  return Math.round(diff * 10) / 10;
}

function getAgendaFeriadosPendenciasMap_(rows, idx) {
  var out = {};
  (rows || []).forEach(function(r) {
    if (!AgendaServerRules_.isType(r[idx.tipo], 'feriado')) return;
    var d = parseAgendaDateAny_(r[idx.data]);
    if (d) out[agendaPendenciaDateKey_(d)] = true;
  });
  return out;
}

function agendaPendenciaDateKey_(d) {
  return [
    d.getFullYear(),
    ('0' + (d.getMonth() + 1)).slice(-2),
    ('0' + d.getDate()).slice(-2)
  ].join('-');
}

function isDiaOperacionalPendencia_(d, feriados) {
  var day = d.getDay();
  if (day === 0 || day === 6) return false;
  return !feriados[agendaPendenciaDateKey_(d)];
}

function horasOperacionaisAtePendencia_(inicio, fim, feriados) {
  if (!inicio || !fim || isNaN(inicio.getTime()) || isNaN(fim.getTime())) return null;
  if (fim.getTime() < inicio.getTime()) return -horasOperacionaisAtePendencia_(fim, inicio, feriados);
  var cursor = new Date(inicio);
  var total = 0;
  while (cursor.getTime() < fim.getTime()) {
    var fimDia = new Date(cursor);
    fimDia.setHours(23, 59, 59, 999);
    var fimTrecho = fim.getTime() < fimDia.getTime() ? fim : fimDia;
    if (isDiaOperacionalPendencia_(cursor, feriados || {})) {
      total += Math.max(0, fimTrecho.getTime() - cursor.getTime()) / 3600000;
    }
    cursor = new Date(fimDia.getTime() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return total;
}

function ordenarPendenciasAgendaPorUrgencia_(lista) {
  (lista || []).sort(function(a, b) {
    var ap = a && a.prazoHoras !== null && a.prazoHoras !== undefined ? Number(a.prazoHoras) : null;
    var bp = b && b.prazoHoras !== null && b.prazoHoras !== undefined ? Number(b.prazoHoras) : null;
    var au = ap !== null && !isNaN(ap) && ap <= 24;
    var bu = bp !== null && !isNaN(bp) && bp <= 24;
    if (au !== bu) return au ? -1 : 1;
    var ah = ap !== null && !isNaN(ap) ? ap : 999999;
    var bh = bp !== null && !isNaN(bp) ? bp : 999999;
    return ah - bh;
  });
}

function diasAteValidadeDashboard_(validade) {
  var d = parseAgendaDateAny_(validade);
  if (!d) return null;
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - hoje.getTime()) / 86400000);
}

function getAgendaDashboardResumo_() {
  var sh = getAgendaSheetForRead_();
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
    eventosPeriodo: [],
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
    agendaDashboardProcessRow_(r, {
      idx: i,
      anoAtual: anoAtual,
      hoje: hoje,
      resumo: resumo,
      porProt: porProt,
      porMonProtDia: porMonProtDia,
      porMed: porMed,
      cancelReagProt: cancelReagProt,
      courierUso: courierUso,
      antecedenciaPorTipo: antecedenciaPorTipo
    });
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

function agendaDashboardProcessRow_(r, ctx) {
  var i = ctx.idx;
  var data = parseAgendaDateAny_(r[i.data]) || (r[i.data] instanceof Date ? r[i.data] : new Date(r[i.data]));
  if (!data || isNaN(data.getTime())) return;
  var rowInfo = agendaDashboardRowInfo_(r, i, data);
  ctx.resumo.eventosPeriodo.push(rowInfo.evento);
  if (data.getFullYear() !== ctx.anoAtual) return;
  ctx.resumo.totalAno++;
  agendaDashboardCountStatus_(rowInfo, ctx);
  agendaDashboardCountLabCentral_(rowInfo, ctx.resumo);
  agendaDashboardCountMonitoria_(rowInfo, ctx.porMonProtDia);
  agendaDashboardCountVisita_(r, rowInfo, ctx);
  agendaDashboardCountCourier_(r, rowInfo, ctx);
}

function agendaDashboardRowInfo_(r, i, data) {
  var tipo = normText_(r[i.tipo]);
  var status = normText_(r[i.status]);
  var projeto = String(r[i.projeto] || 'Sem protocolo').trim() || 'Sem protocolo';
  var medico = String(r[i.medico] || 'Sem medico').trim() || 'Sem medico';
  var lab = AgendaServerRules_.isLabCentral(r[i.labCentral]);
  var isVisita = AgendaServerRules_.isVisit(tipo);
  var couriersEvento = agendaDashboardCouriersEvento_(r, i);
  var info = {
    data: data,
    tipo: tipo,
    status: status,
    projeto: projeto,
    medico: medico,
    lab: lab,
    isCancelado: AgendaServerRules_.isCancelled(status),
    isReagendado: AgendaServerRules_.isRescheduled(status),
    isMonitoria: AgendaServerRules_.isMonitoring(tipo),
    isVisita: isVisita,
    isEventoComTransporte: AgendaServerRules_.hasTransportOperation(tipo),
    isRealizada: AgendaServerRules_.isCompleted(status)
  };
  info.evento = {
    dataIso: formatarDataIsoAgenda_(data),
    ano: data.getFullYear(),
    mes: data.getMonth() + 1,
    tipo: String(r[i.tipo] || ''),
    status: String(r[i.status] || ''),
    projeto: projeto,
    medico: medico,
    labCentral: lab,
    isCancelado: info.isCancelado,
    isReagendado: info.isReagendado,
    isMonitoria: info.isMonitoria,
    isVisita: info.isVisita,
    isRealizada: info.isRealizada,
    isEventoComTransporte: info.isEventoComTransporte,
    couriers: couriersEvento
  };
  return info;
}

function agendaDashboardCouriersEvento_(r, i) {
  var couriersEvento = [];
  [i.c1, i.c2, i.c3].forEach(function(c) {
    if (!c || c.nome === undefined) return;
    var nomeCourier = String(r[c.nome] || '').trim();
    if (isCourierNomeValidoAgenda_(nomeCourier)) couriersEvento.push(nomeCourier);
  });
  return couriersEvento;
}

function agendaDashboardCountStatus_(info, ctx) {
  if ((info.isCancelado || info.isReagendado) && info.projeto) {
    ctx.cancelReagProt[info.projeto] = (ctx.cancelReagProt[info.projeto] || 0) + 1;
  }
}

function agendaDashboardCountLabCentral_(info, resumo) {
  if (!info.lab || info.isCancelado) return;
  resumo.labCentralAno++;
  resumo.labCentralMes[info.data.getMonth()].value++;
}

function agendaDashboardCountMonitoria_(info, porMonProtDia) {
  if (!info.isMonitoria || info.isCancelado) return;
  var keyMon = info.projeto + '|' + formatarDataIsoAgenda_(info.data);
  porMonProtDia[keyMon] = { projeto: info.projeto };
}

function agendaDashboardCountVisita_(r, info, ctx) {
  if (!info.isVisita || !info.isRealizada || info.isCancelado || info.data.getTime() > ctx.hoje.getTime()) return;
  ctx.resumo.visitasRealizadasAno++;
  ctx.resumo.visitasMes[info.data.getMonth()].value++;
  ctx.resumo.visitasPorDiaSemana[info.data.getDay()].value++;
  ctx.porProt[info.projeto] = (ctx.porProt[info.projeto] || 0) + 1;
  ctx.porMed[info.medico] = (ctx.porMed[info.medico] || 0) + 1;
  agendaDashboardCountAntecedencia_(r, info, ctx);
}

function agendaDashboardCountAntecedencia_(r, info, ctx) {
  var base = agendaDataRegistroFromControle_(r[ctx.idx.controle]);
  if (!base) return;
  base.setHours(0, 0, 0, 0);
  var visita = new Date(info.data);
  visita.setHours(0, 0, 0, 0);
  var diasAnt = Math.round((visita - base) / 86400000);
  if (diasAnt < 0 || diasAnt >= 730) return;
  var tipoLabel = String(r[ctx.idx.tipo] || 'Visita').trim() || 'Visita';
  if (!ctx.antecedenciaPorTipo[tipoLabel]) ctx.antecedenciaPorTipo[tipoLabel] = { soma: 0, n: 0 };
  ctx.antecedenciaPorTipo[tipoLabel].soma += diasAnt;
  ctx.antecedenciaPorTipo[tipoLabel].n++;
}

function agendaDashboardCountCourier_(r, info, ctx) {
  if (!info.isEventoComTransporte || !info.isRealizada || info.isCancelado || info.data.getTime() > ctx.hoje.getTime() || !info.lab) return;
  [ctx.idx.c1, ctx.idx.c2, ctx.idx.c3].forEach(function(c) {
    if (!c || c.nome === undefined) return;
    var nomeCourier = String(r[c.nome] || '').trim();
    if (!isCourierNomeValidoAgenda_(nomeCourier)) return;
    ctx.courierUso[nomeCourier] = (ctx.courierUso[nomeCourier] || 0) + 1;
  });
}

function isCourierNomeValidoAgenda_(nome) {
  var n = normText_(nome);
  if (!n) return false;
  return ['nao aplicavel', 'n/a', '-', '--', '---', 'nao se aplica'].indexOf(n) === -1;
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

function getItensEstoqueColumnMap_(headers) {
  var normalized = (headers || []).map(function(h) { return normText_(h); });
  function find(aliases, fallbackIdx) {
    for (var a = 0; a < aliases.length; a++) {
      var idx = normalized.indexOf(normText_(aliases[a]));
      if (idx >= 0) return idx;
    }
    return fallbackIdx;
  }
  var detalhes = find(['Detalhes Visita / Complemento', 'Detalhes Visita', 'Complemento'], -1);
  var usaLayoutComDetalhes = detalhes >= 0;
  return {
    idItem: find(['ID_Item', 'ID Item', 'ID'], 0),
    projeto: find(['Projeto'], 1),
    descricao: find(['Descrição', 'Descricao', 'Descrição do item', 'Descricao do item', 'Item'], 2),
    detalhesVisita: detalhes,
    tipo: find(['Tipo', 'Tipo de item', 'Tipo item'], usaLayoutComDetalhes ? 4 : 3),
    localizacao: find(['Localização padrão', 'Localizacao padrao', 'Localização', 'Localizacao', 'Local'], usaLayoutComDetalhes ? 5 : 4),
    estoqueMin: find(['Estoque mínimo', 'Estoque minimo', 'EstoqueMin', 'Mínimo', 'Minimo'], usaLayoutComDetalhes ? 6 : 5),
    observacoes: find(['Observações', 'Observacoes', 'Observação', 'Observacao', 'Obs'], usaLayoutComDetalhes ? 7 : 6),
    laboratorio: find(['Laboratório', 'Laboratorio', 'Lab'], usaLayoutComDetalhes ? 8 : 7),
    status: find(['Status', 'Ativo'], usaLayoutComDetalhes ? 9 : 8),
    ordem: find(['Ordem de utilização', 'Ordem de utilizacao', 'Ordem de uso', 'Ordem'], -1),
    visitasAplicaveis: find([
      'Visitas aplicáveis (IDs SoA)', 'Visitas aplicaveis (IDs SoA)',
      'Visitas aplicáveis', 'Visitas aplicaveis'
    ], -1),
    bracosAplicaveis: find([
      'Braços aplicáveis (IDs)', 'Bracos aplicaveis (IDs)',
      'Braços aplicáveis', 'Bracos aplicaveis'
    ], -1)
  };
}

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
  var c = getItensEstoqueColumnMap_(data[0] || []);

  var itens = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!String(r[c.descricao] || '').trim()) continue;
    itens.push({
      id:          String(i + 1),
      idItem:      String(r[c.idItem] || ''),
      projeto:     String(r[c.projeto] || ''),
      descricao:   String(r[c.descricao] || ''),
      detalhesVisita: c.detalhesVisita >= 0 ? String(r[c.detalhesVisita] || '') : '',
      tipo:        String(r[c.tipo] || ''),
      localizacao: String(r[c.localizacao] || ''),
      estoqueMin:  (r[c.estoqueMin] !== '' && r[c.estoqueMin] !== null) ? r[c.estoqueMin] : '',
      observacoes: String(r[c.observacoes] || ''),
      laboratorio: String(r[c.laboratorio] || ''),
      status:      String(r[c.status] || ''),
      ordem:       c.ordem >= 0 && r[c.ordem] !== '' && r[c.ordem] !== null ? Number(r[c.ordem]) : '',
      visitasAplicaveisIds: c.visitasAplicaveis >= 0 ? soaUniqueIds_(r[c.visitasAplicaveis]) : [],
      bracosAplicaveisIds: c.bracosAplicaveis >= 0 ? soaUniqueIds_(r[c.bracosAplicaveis]) : []
    });
  }

  var projetosItens = {};
  itens.forEach(function(it) {
    if (it.projeto) projetosItens[it.projeto] = 1;
  });
  if (Object.keys(projetosItens).length) projetos = Object.keys(projetosItens).sort();

  // A ordem de utilização organiza os itens dentro de cada projeto. Itens sem
  // ordem permanecem ao final, com descrição como desempate estável.
  itens.sort(function(a, b) {
    var projetoCmp = String(a.projeto || '').localeCompare(String(b.projeto || ''), 'pt-BR');
    if (projetoCmp) return projetoCmp;
    var aSemOrdem = a.ordem === '' || !isFinite(Number(a.ordem));
    var bSemOrdem = b.ordem === '' || !isFinite(Number(b.ordem));
    if (aSemOrdem !== bSemOrdem) return aSemOrdem ? 1 : -1;
    if (!aSemOrdem && Number(a.ordem) !== Number(b.ordem)) return Number(a.ordem) - Number(b.ordem);
    return String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR');
  });

  return { itens: itens, projetos: projetos, projetosAtivos: projetosAtivos };
}

function estoqueTipoPermiteVinculoSoA_(tipo) {
  var normalizado = normText_(tipo);
  return normalizado.indexOf('kit') >= 0 || normalizado.indexOf('bulk') >= 0;
}

function estoqueOrdenarVisitasSoAPorProjeto_(visitas, ids) {
  var ordemPorId = {};
  (visitas || []).forEach(function(visita, index) {
    var id = String(visita && visita.idSoA || '').trim();
    if (id) ordemPorId[id] = index;
  });
  return soaUniqueIds_(ids).sort(function(a, b) {
    return ordemPorId[a] - ordemPorId[b];
  });
}

function getModelosEstoqueSoAPorProjeto(projeto) {
  var projetoNorm = normText_(projeto);
  if (!projetoNorm) return [];
  return getItensEstoque().itens.filter(function(item) {
    return normText_(item.projeto) === projetoNorm &&
      estoqueTipoPermiteVinculoSoA_(item.tipo) &&
      item.visitasAplicaveisIds && item.visitasAplicaveisIds.length;
  }).map(function(item) {
    return {
      idItem: item.idItem,
      descricao: item.descricao,
      tipo: item.tipo,
      laboratorio: item.laboratorio,
      status: item.status,
      visitasAplicaveisIds: item.visitasAplicaveisIds.slice(),
      bracosAplicaveisIds: item.bracosAplicaveisIds.slice()
    };
  });
}

// ───────────────────────────────────────────────────────

function salvarItemEstoque(payload) {
  payload = payload || {};
  codexAssertCanWrite_('salvarItemEstoque', 'Estoque', payload && (payload.idItem || payload.id));
  return codexWithDocumentLock_('salvarItemEstoque', function() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetByPossibleNames_(ss, ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);

  var estoqueMin = (payload.estoqueMin !== '' && payload.estoqueMin !== null && payload.estoqueMin !== undefined)
    ? Number(payload.estoqueMin) : '';
  var ordem = (payload.ordem !== '' && payload.ordem !== null && payload.ordem !== undefined)
    ? Number(payload.ordem) : '';
  if (ordem !== '' && (!isFinite(ordem) || Math.floor(ordem) !== ordem || ordem < 0)) {
    throw new Error('A ordem de utilização deve ser um número inteiro maior ou igual a zero.');
  }
  var visitasAplicaveisIds = Object.prototype.hasOwnProperty.call(payload, 'visitasAplicaveisIds')
    ? soaUniqueIds_(payload.visitasAplicaveisIds) : null;
  var bracosAplicaveisIds = Object.prototype.hasOwnProperty.call(payload, 'bracosAplicaveisIds')
    ? soaUniqueIds_(payload.bracosAplicaveisIds) : null;
  var visitasProjeto = null;
  if (bracosAplicaveisIds && bracosAplicaveisIds.length) {
    if (!estoqueTipoPermiteVinculoSoA_(payload.tipo)) {
      throw new Error('Somente modelos de Kit ou Bulk Supply podem ser específicos por braço.');
    }
    var bracosProjeto = getBracosProjeto(payload.projeto);
    var idsBracosProjeto = {};
    bracosProjeto.forEach(function(braco) {
      if (braco.idBraco) idsBracosProjeto[String(braco.idBraco)] = true;
    });
    var bracosInvalidos = bracosAplicaveisIds.filter(function(id) { return !idsBracosProjeto[id]; });
    if (bracosInvalidos.length) {
      throw new Error('Um ou mais braços selecionados não pertencem ao projeto informado. Atualize o cadastro e tente novamente.');
    }
  }
  if (visitasAplicaveisIds && visitasAplicaveisIds.length) {
    if (!estoqueTipoPermiteVinculoSoA_(payload.tipo)) {
      throw new Error('Somente modelos de Kit ou Bulk Supply podem ser vinculados a visitas.');
    }
    visitasProjeto = getSoAVisitasProjeto(payload.projeto);
    var idsProjeto = {};
    visitasProjeto.forEach(function(visita) {
      if (visita.idSoA) idsProjeto[String(visita.idSoA)] = true;
    });
    var idsInvalidos = visitasAplicaveisIds.filter(function(id) { return !idsProjeto[id]; });
    if (idsInvalidos.length) {
      throw new Error('Uma ou mais visitas selecionadas não pertencem ao projeto informado. Atualize o cadastro e tente novamente.');
    }
    visitasAplicaveisIds = estoqueOrdenarVisitasSoAPorProjeto_(visitasProjeto, visitasAplicaveisIds);
  }

  if (!sheet) {
    sheet = ss.insertSheet('Itens');
    sheet.appendRow([
      'ID_Item', 'Projeto', 'Descrição', 'Detalhes Visita / Complemento',
      'Tipo de item', 'Localização padrão', 'Estoque mínimo',
      'Observações', 'Laboratório', 'Status', 'Ordem de utilização'
    ]);
    var hRange = sheet.getRange(1, 1, 1, 10);
    hRange.setFontWeight('bold').setBackground('#1266f1').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

    var lastColumn = Math.max(sheet.getLastColumn(), 10);
    var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    var c = getItensEstoqueColumnMap_(headers);
    if (c.ordem < 0) {
      var ordemCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, ordemCol).setValue('Ordem de utilização');
      lastColumn = Math.max(lastColumn, ordemCol);
      headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
      c = getItensEstoqueColumnMap_(headers);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'visitasAplicaveisIds') && c.visitasAplicaveis < 0) {
      var visitasCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, visitasCol).setValue('Visitas aplicáveis (IDs SoA)');
      lastColumn = Math.max(lastColumn, visitasCol);
      headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
      c = getItensEstoqueColumnMap_(headers);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'bracosAplicaveisIds') && c.bracosAplicaveis < 0) {
      var bracosCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, bracosCol).setValue('Braços aplicáveis (IDs)');
      lastColumn = Math.max(lastColumn, bracosCol);
      headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
      c = getItensEstoqueColumnMap_(headers);
    }

  function applyPayload(rowValues) {
    rowValues[c.projeto] = payload.projeto;
    rowValues[c.descricao] = payload.descricao;
    if (c.detalhesVisita >= 0 && payload.detalhesVisita !== undefined) rowValues[c.detalhesVisita] = payload.detalhesVisita;
    rowValues[c.tipo] = payload.tipo;
    rowValues[c.localizacao] = payload.localizacao;
    rowValues[c.estoqueMin] = estoqueMin;
    rowValues[c.observacoes] = payload.observacoes;
    rowValues[c.laboratorio] = payload.laboratorio;
    rowValues[c.status] = payload.status;
    if (c.ordem >= 0) rowValues[c.ordem] = ordem;
    if (c.visitasAplicaveis >= 0 && visitasAplicaveisIds !== null) {
      rowValues[c.visitasAplicaveis] = visitasAplicaveisIds.join('; ');
    }
    if (c.bracosAplicaveis >= 0 && bracosAplicaveisIds !== null) {
      rowValues[c.bracosAplicaveis] = bracosAplicaveisIds.join('; ');
    }
    return rowValues;
  }

  if (payload.id) {
    // Edição
    var row = parseInt(payload.id);
    var rowValues = sheet.getRange(row, 1, 1, lastColumn).getValues()[0];
    sheet.getRange(row, 1, 1, lastColumn).setValues([applyPayload(rowValues)]);
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return 'Item atualizado com sucesso!';
  } else {
    // Novo — mantém padrão numérico "0001" igual aos existentes
    var novoId = gerarProximoIdItemEstoque_(sheet);
    var newRow = [];
    while (newRow.length < lastColumn) newRow.push('');
    newRow[c.idItem] = novoId;
    sheet.appendRow(applyPayload(newRow));
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return 'Item cadastrado! ID: ' + novoId;
  }
  });
}

function gerarProximoIdItemEstoque_(sheet) {
  var existing = {};
  var maxSeq = 0;
  if (sheet && sheet.getLastRow() > 1) {
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    ids.forEach(function(r) {
      var id = String(r[0] || '').trim();
      if (!id) return;
      existing[id] = true;
      if (/^\d+$/.test(id)) maxSeq = Math.max(maxSeq, Number(id));
    });
  }
  var seq = maxSeq + 1;
  var novoId = padIdItemEstoque_(seq);
  while (existing[novoId]) {
    seq++;
    novoId = padIdItemEstoque_(seq);
  }
  return novoId;
}

function padIdItemEstoque_(seq) {
  var out = String(Number(seq || 0));
  while (out.length < 4) out = '0' + out;
  return out;
}

// ───────────────────────────────────────────────────────

function excluirItemEstoque(id) {
  codexAssertCanWrite_('excluirItemEstoque', 'Estoque', id);
  return codexWithDocumentLock_('excluirItemEstoque', function() {
    var sheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque']);
    if (!sheet) throw new Error('Aba "Itens" não encontrada.');
    var idItem = typeof id === 'object' && id ? String(id.idItem || id.id || '').trim() : String(id || '').trim();
    var rowIndex = typeof id === 'object' && id ? Number(id.rowIndex || 0) : 0;
    var row = 0;
    if (idItem) {
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
        for (var i = 0; i < ids.length; i++) {
          if (String(ids[i][0] || '').trim() === idItem) {
            row = i + 2;
            break;
          }
        }
      }
      if (!row) throw new Error('Item não encontrado: ' + idItem);
    } else if (rowIndex >= 2) {
      row = rowIndex;
    } else {
      throw new Error('ID do item não informado.');
    }
    sheet.deleteRow(row);
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return 'Item excluído com sucesso.';
  });
}

// ═══════════════════════════════════════════════════════
//  ESTOQUE — Pedidos  (WebApp.gs — substitua as 3 funções abaixo)
// ═══════════════════════════════════════════════════════

function getPedidosEstoque() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var shPed   = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var shPedIt = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido']);
  var tz      = Session.getScriptTimeZone();
  var extraCols = shPed ? ensureEstoquePedidoExtraColumns_(shPed) : {};

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
        observacoes:  String(r[7]||''),
        courier:      String(r[(extraCols.courier || 0) - 1]||''),
        rastreio:     String(r[(extraCols.rastreio || 0) - 1]||''),
        numeroLab:    String(r[(extraCols.numeroLab || 0) - 1]||'')
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
  var projLabsMap     = {}; // { "ProjetoX": ["Lab1","Lab2"] }
  var projLabItensMap = {}; // { "ProjetoX||Lab1": [{id,descricao,tipo}] }
  var itensCatalogo   = [];
  var projetosSet = {}, projetos = [];
  var itensData = getItensEstoque();
  (itensData.itens || []).forEach(function(it) {
      var id   = String(it.idItem || it.id || '').trim();
      var proj = String(it.projeto || '').trim();
      var desc = String(it.descricao || '').trim();
      var tipo = String(it.tipo || '').trim();
      var lab  = String(it.laboratorio || '').trim();
      var itemStatus = String(it.status || '').trim();
      var itemInativo = String(itemStatus).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === 'inativo';
      if (!proj || !desc || itemInativo) return;
      itensCatalogo.push({id:id, projeto:proj, laboratorio:lab, descricao:desc, tipo:tipo, observacoes:String(it.observacoes || '')});
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
    itensCatalogo:   itensCatalogo,
    couriers:        getAgendaCouriers_()
  };
}

// ───────────────────────────────────────────────────────

function ensureEstoquePedidoExtraColumns_(sh) {
  if (!sh) return { courier: 9, rastreio: 10, numeroLab: 11 };
  var lastCol = Math.max(sh.getLastColumn(), 8);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  function findCol(aliases) {
    for (var i = 0; i < headers.length; i++) {
      var n = normText_(headers[i]);
      for (var a = 0; a < aliases.length; a++) {
        if (n === normText_(aliases[a])) return i + 1;
      }
    }
    return 0;
  }
  function ensureCol(key, label, aliases) {
    var col = findCol(aliases);
    if (col) {
      map[key] = col;
      return;
    }
    var target = sh.getLastColumn() + 1;
    if (sh.getMaxColumns() < target) sh.insertColumnsAfter(sh.getMaxColumns(), target - sh.getMaxColumns());
    sh.getRange(1, target).setValue(label);
    headers.push(label);
    map[key] = target;
  }
  ensureCol('courier', 'Courier', ['Courier', 'Transportadora', 'Courier pedido']);
  ensureCol('rastreio', 'Rastreio', ['Rastreio', 'AWB', 'Tracking', 'Número de rastreio', 'Numero de rastreio', 'Codigo de rastreio']);
  ensureCol('numeroLab', 'Número do laboratório', ['Número do laboratório', 'Numero do laboratorio', 'Nº laboratório', 'N laboratorio', 'ID laboratório', 'ID laboratorio', 'Pedido laboratório', 'Pedido laboratorio']);
  return map;
}

function setEstoquePedidoTrackingRichText_(sh, row, col, rastreio, courier) {
  rastreio = String(rastreio || '').trim();
  if (!sh || !row || !col) return;
  var range = sh.getRange(row, col);
  if (!rastreio) {
    range.setValue('');
    return;
  }
  var url = agendaTrackingUrl_(rastreio, courier);
  if (url) {
    range.setRichTextValue(
      SpreadsheetApp.newRichTextValue()
        .setText(rastreio)
        .setLinkUrl(url)
        .build()
    );
  } else {
    range.setValue(rastreio);
  }
}

function isParticipanteAtivoPlanejamento_(status) {
  var s = String(status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return s === 'ativo' || s === 'em seguimento';
}

function getPlanejamentoPedidoEstoque() {
  var pedidosData = getPedidosEstoque();
  var itens = (pedidosData.itensCatalogo || []).filter(function(it) {
    return String(it.projeto || '').trim() && String(it.descricao || '').trim();
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
      observacoes: it.observacoes || '',
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
  codexAssertCanWrite_('salvarPlanejamentoPedidoEstoque', 'Estoque', payload && payload.idPlanejamento);
  return codexWithDocumentLock_('salvarPlanejamentoPedidoEstoque', function() {
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
  var extraCols = ensureEstoquePedidoExtraColumns_(shPed);

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
    var rowPedido = shPed.getLastRow();
    shPed.getRange(rowPedido, extraCols.courier).setValue('');
    shPed.getRange(rowPedido, extraCols.rastreio).setValue('');
    shPed.getRange(rowPedido, extraCols.numeroLab).setValue('');

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
  });
}

function salvarPedidoEstoque(payload) {
  codexAssertCanWrite_('salvarPedidoEstoque', 'Estoque', payload && (payload.idPedido || payload.numeroPedido));
  return codexWithDocumentLock_('salvarPedidoEstoque', function() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var shPed   = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var shPedIt = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido']);
  if (!shPed)   throw new Error('Aba "Pedidos" não encontrada.');
  if (!shPedIt) throw new Error('Aba "Pedidos_Itens" não encontrada.');
  var extraCols = ensureEstoquePedidoExtraColumns_(shPed);

  var dataVal = payload.data ? new Date(payload.data + 'T12:00:00') : new Date();
  var user    = Session.getActiveUser().getEmail();
  var idPedido;
  var rowPedido;

  if (payload.rowIndex) {
    // ── Edição ──────────────────────────────────────────────────────────
    var row  = parseInt(payload.rowIndex);
    rowPedido = row;
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
    rowPedido = shPed.getLastRow();
  }

  shPed.getRange(rowPedido, extraCols.courier).setValue(String(payload.courier || '').trim());
  setEstoquePedidoTrackingRichText_(shPed, rowPedido, extraCols.rastreio, payload.rastreio, payload.courier);
  shPed.getRange(rowPedido, extraCols.numeroLab).setValue(String(payload.numeroLab || '').trim());

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
  });
}

// ───────────────────────────────────────────────────────

function excluirPedidoEstoque(rowIndex, idPedido) {
  codexAssertCanWrite_('excluirPedidoEstoque', 'Estoque', idPedido || rowIndex);
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

function receberPedidoEstoque(dados) {
  codexAssertCanWrite_('receberPedidoEstoque', 'Estoque', dados && (dados.idPedido || dados.rowIndex));
  return codexWithDocumentLock_('receberPedidoEstoque', function() {
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
      'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'
    ]);
    shEstoque.setFrozenRows(1);
  }
  var estoqueLoteCols = ensureEstoqueLoteIdColumn_(shEstoque);

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
  var catalogoCols = getItensEstoqueColumnMap_(catalogoRows[0] || []);
  var catalogoMap = {};
  for (var c = 1; c < catalogoRows.length; c++) {
    var cr = catalogoRows[c];
    var idCat = String(cr[catalogoCols.idItem] || '').trim();
    if (!idCat) continue;
    catalogoMap[idCat] = {
      projeto: String(cr[catalogoCols.projeto] || ''),
      descricao: String(cr[catalogoCols.descricao] || ''),
      tipo: String(cr[catalogoCols.tipo] || ''),
      localizacao: String(cr[catalogoCols.localizacao] || ''),
      estoqueMin: cr[catalogoCols.estoqueMin] !== '' && cr[catalogoCols.estoqueMin] !== null ? Number(cr[catalogoCols.estoqueMin]) : '',
      status: String(cr[catalogoCols.status] || 'Ativo')
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
      if (!String(shEstoque.getRange(rowEstoque, estoqueLoteCols.idLote + 1).getValue() || '').trim()) {
        shEstoque.getRange(rowEstoque, estoqueLoteCols.idLote + 1).setValue(gerarIdLoteEstoque_());
      }
    } else {
      shEstoque.appendRow([
        idItem, cat.projeto || '', ir.descricao || cat.descricao || '', cat.tipo || '',
        validade, cat.localizacao || '', qtd, cat.estoqueMin, 'OK', agora, userEmail, '', numeroPedido,
        gerarIdLoteEstoque_()
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
  CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
  return 'Recebimento registrado com sucesso!';
  });
}

// ===================== ESTOQUE - Movimentações =====================

function estoqueValidadeKey_(valor, tz) {
  if (!valor) return '';
  tz = tz || Session.getScriptTimeZone();
  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, tz, 'dd/MM/yyyy');
  }
  var texto = String(valor || '').trim();
  var br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return ('0' + Number(br[1])).slice(-2) + '/' + ('0' + Number(br[2])).slice(-2) + '/' + br[3];
  var iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return ('0' + Number(iso[3])).slice(-2) + '/' + ('0' + Number(iso[2])).slice(-2) + '/' + iso[1];
  var data = new Date(texto);
  return isNaN(data.getTime()) ? texto : Utilities.formatDate(data, tz, 'dd/MM/yyyy');
}

function estoqueLocalKey_(valor) {
  return normText_(String(valor || '').replace(/\s+/g, ' ').trim());
}

function registrarMovimentacaoEstoque(payload) {
  codexAssertCanWrite_('registrarMovimentacaoEstoque', 'Estoque', payload && (payload.idItem || payload.itemId));
  return codexWithDocumentLock_('registrarMovimentacaoEstoque', function() {
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
  var validadeKey = estoqueValidadeKey_(payload.validade, tz);
  var locKey = estoqueLocalKey_(payload.localizacao);
  var requestedLote = String(payload.idLote || payload.lote || '').trim();
  var rows = shEstoque.getDataRange().getValues();
  var estoqueColumns = getEstoqueColumnMap_(rows[0] || []);
  var requestedAccession = String(payload.accessionNumber || '').trim();
  var rowEstoque = -1;

  var requestedRow = Number(payload.estoqueRow || 0);
  if (requestedRow >= 2 && requestedRow <= rows.length) {
    var requestedData = rows[requestedRow - 1] || [];
    var requestedMatches = String(requestedData[estoqueColumns.idItem] || '').trim() === idItem &&
      (!validadeKey || estoqueValidadeKey_(requestedData[estoqueColumns.validade], tz) === validadeKey) &&
      (!locKey || estoqueLocalKey_(requestedData[estoqueColumns.localizacao]) === locKey) &&
      (!requestedLote || String(requestedData[estoqueColumns.idLote] || '').trim() === requestedLote) &&
      (!requestedAccession || String(requestedData[estoqueColumns.accessionNumber] || '').trim() === requestedAccession);
    if (requestedMatches) rowEstoque = requestedRow;
  }

  for (var i = 1; rowEstoque < 0 && i < rows.length; i++) {
    var r = rows[i];
    if (String(r[estoqueColumns.idItem] || '').trim() !== idItem) continue;
    var sameValidade = !validadeKey || estoqueValidadeKey_(r[estoqueColumns.validade], tz) === validadeKey;
    var sameLocal = !locKey || estoqueLocalKey_(r[estoqueColumns.localizacao]) === locKey;
    var sameLote = !requestedLote || String(r[estoqueColumns.idLote] || '').trim() === requestedLote;
    var sameAccession = !requestedAccession || String(r[estoqueColumns.accessionNumber] || '').trim() === requestedAccession;
    if (sameValidade && sameLocal && sameLote && sameAccession) {
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

  var er = shEstoque.getRange(rowEstoque, 1, 1, Math.max(shEstoque.getLastColumn(), 15)).getValues()[0];
  var movMetaCols = ensureMovimentacoesAgendaMetadataColumns_(shMov);
  movMetaCols = ensureMovimentacoesAccessionColumn_(shMov);
  var movRow = [
    Utilities.getUuid().slice(0, 8), dataBase, tipoMov, idItem,
    payload.descricao || er[2] || '', payload.tipoItem || er[3] || '',
    payload.projeto || er[1] || '', qtd, er[4] || '',
    payload.localizacao || er[5] || '', payload.lote || payload.idLote || er[13] || '', '',
    payload.participante || '', payload.idVisita || '', userEmail,
    payload.origem || 'Movimentação manual', payload.observacao || ''
  ];
  while (movRow.length <= movMetaCols.accessionnumber) movRow.push('');
  movRow[movMetaCols.accessionnumber] = String(payload.accessionNumber || er[estoqueColumns.accessionNumber] || '').trim();
  if (payload.agendaId) movRow[movMetaCols.agendaid] = String(payload.agendaId || '').trim();
  if (payload.agendaKitAcao) movRow[movMetaCols.agendakitacao] = String(payload.agendaKitAcao || '').trim();
  shMov.appendRow(movRow);
  var lr = shMov.getLastRow();
  shMov.getRange(lr, 2).setNumberFormat('dd/MM/yyyy HH:mm');
  if (er[4]) shMov.getRange(lr, 9).setNumberFormat('dd/MM/yyyy');
  SpreadsheetApp.flush();
  CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
  return 'Movimentação registrada com sucesso.';
  });
}

function atualizarStatusReservasAgendaItens_(agendaId, itens, novoStatus, statusOrigem) {
  agendaId = String(agendaId || '').trim();
  novoStatus = String(novoStatus || '').trim();
  if (!agendaId || !novoStatus || !Array.isArray(itens) || !itens.length) return 0;
  var sheet = null;
  try {
    sheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Reservas_Kits', 'Reservas de Kits']);
  } catch (e) { return 0; }
  if (!sheet) return 0;
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, KIT_RESERVA_HEADERS_.length).getValues();
  var atualizados = 0;
  var usados = {};
  var origens = Array.isArray(statusOrigem) ? statusOrigem.map(function(v) { return normText_(v); }) : [normText_(statusOrigem || 'Reservado')];
  (itens || []).forEach(function(item) {
    var idItem = String(item && item.idItem || '').trim();
    var idLote = String(item && item.idLote || '').trim();
    var accessionNumber = String(item && item.accessionNumber || '').trim();
    var quantidade = Math.max(1, Number(item && item.qtde || 1) || 1);
    if (!idItem) return;
    for (var i = 0; i < rows.length && quantidade > 0; i++) {
      if (usados[i]) continue;
      var row = rows[i];
      if (String(row[2] || '').trim() !== agendaId) continue;
      if (String(row[5] || '').trim() !== idItem) continue;
      if (idLote && String(row[6] || '').trim() !== idLote) continue;
      if (accessionNumber && String(row[17] || '').trim() !== accessionNumber) continue;
      if (origens.indexOf(normText_(row[11] || 'Reservado')) < 0) continue;
      var rowQty = Math.max(0, Number(row[10] || 0) || 0);
      if (!rowQty) continue;
      if (rowQty <= quantidade) {
        sheet.getRange(i + 2, 12).setValue(novoStatus);
        usados[i] = true;
        quantidade -= rowQty;
        atualizados++;
      } else {
        sheet.getRange(i + 2, 11).setValue(rowQty - quantidade);
        var historico = row.slice(0, KIT_RESERVA_HEADERS_.length);
        historico[0] = gerarIdLoteEstoque_();
        historico[1] = new Date();
        historico[10] = quantidade;
        historico[11] = novoStatus;
        historico[14] = String(historico[14] || '') + ' · Atualização automática da Agenda';
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, KIT_RESERVA_HEADERS_.length).setValues([historico]);
        quantidade = 0;
        atualizados++;
      }
    }
  });
  return atualizados;
}

function transferirKitEstoque(payload) {
  codexAssertCanWrite_('transferirKitEstoque', 'Estoque', payload && (payload.idItem || payload.idLote));
  return codexWithDocumentLock_('transferirKitEstoque', function() {
    payload = payload || {};
    var idItem = String(payload.idItem || '').trim();
    var idLote = String(payload.idLote || '').trim();
    var origem = String(payload.origem || '').trim();
    var destino = String(payload.destino || '').trim();
    var qtd = Number(payload.qtde || 0);
    var reserva = payload.reserva || null;
    var destinoLaboratorio = estoqueEhLaboratorio_(destino);
    if (!idItem || !idLote || !origem || !destino || origem === destino) throw new Error('Informe item, lote, origem e destino diferentes.');
    if (qtd <= 0 || !isFinite(qtd)) throw new Error('Informe uma quantidade válida.');
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getSheetByPossibleNames_(ss, ['Estoque']);
    if (!sheet) throw new Error('Aba "Estoque" não encontrada.');
    var map = ensureEstoqueLoteIdColumn_(sheet);
    var rows = sheet.getDataRange().getValues();
    var sourceRow = -1;
    var destinationRow = -1;
    var source = null;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (String(row[map.idItem] || '').trim() !== idItem || String(row[map.idLote] || '').trim() !== idLote) continue;
      var local = estoqueLocalKey_(row[map.localizacao]);
      if (local === estoqueLocalKey_(origem)) { sourceRow = i + 1; source = row; }
      if (local === estoqueLocalKey_(destino)) destinationRow = i + 1;
    }
    if (sourceRow < 2 || !source) throw new Error('Lote não encontrado na localização de origem.');
    var reservaObrigatoria = destinoLaboratorio && estoqueTipoEhKit_(source[map.tipo]);
    if (reservaObrigatoria && (!reserva || typeof reserva !== 'object')) {
      throw new Error('Todo kit transferido ao Laboratório deve ser reservado para um participante.');
    }
    var visitaReserva = null;
    if (reservaObrigatoria) {
      var participanteReserva = String(reserva.participante || '').trim();
      var participanteIdReserva = String(reserva.participanteId || '').trim();
      var visitaPrevistaReserva = String(reserva.visitaPrevista || '').trim();
      visitaReserva = parseAgendaDateAny_(reserva.dataVisita);
      if (!participanteReserva || !participanteIdReserva || !visitaPrevistaReserva) {
        throw new Error('Informe o participante, a visita prevista e a identificação do participante para reservar no Laboratório.');
      }
      if (!visitaReserva || isNaN(visitaReserva.getTime())) throw new Error('Informe uma data válida para a visita prevista.');
      visitaReserva.setHours(0, 0, 0, 0);
      var validadeReserva = parseDateBrOrBlank_(source[map.validade]);
      var validadeMinimaReserva = new Date(visitaReserva.getTime());
      validadeMinimaReserva.setDate(validadeMinimaReserva.getDate() + 10);
      if (!validadeReserva || isNaN(validadeReserva.getTime()) || validadeReserva < validadeMinimaReserva) {
        throw new Error('O lote selecionado não possui validade suficiente para a visita prevista.');
      }
    }
    var reservas = getKitReservasResumo_();
    var validade = estoqueValidadeKey_(source[map.validade]);
    var chaveReserva = kitReservaChave_(idItem, idLote, validade, origem, source[map.accessionNumber]);
    var reservado = Number(reservas[chaveReserva] || 0);
    var saldo = Number(source[map.qtde] || 0) || 0;
    if (qtd > Math.max(0, saldo - reservado)) throw new Error('Quantidade maior que o saldo disponível na origem.');
    var shReservas = reservaObrigatoria ? getKitReservasSheet_() : null;
    if (destinationRow < 2) {
      var novo = source.slice();
      while (novo.length < Math.max(sheet.getLastColumn(), map.idLote + 1)) novo.push('');
      novo[map.localizacao] = destino;
      novo[map.qtde] = 0;
      destinationRow = sheet.getLastRow() + 1;
      sheet.getRange(destinationRow, 1, 1, novo.length).setValues([novo]);
    }
    var destinoAtual = Number(sheet.getRange(destinationRow, map.qtde + 1).getValue() || 0) || 0;
    sheet.getRange(sourceRow, map.qtde + 1).setValue(saldo - qtd);
    sheet.getRange(destinationRow, map.qtde + 1).setValue(destinoAtual + qtd);
    var agora = new Date();
    var userEmail = '';
    try { userEmail = Session.getActiveUser().getEmail(); } catch (e) {}
    sheet.getRange(sourceRow, map.ultimaAlteracao + 1).setValue(agora);
    sheet.getRange(destinationRow, map.ultimaAlteracao + 1).setValue(agora);
    if (map.responsavel >= 0) {
      sheet.getRange(sourceRow, map.responsavel + 1).setValue(userEmail);
      sheet.getRange(destinationRow, map.responsavel + 1).setValue(userEmail);
    }
    var shMov = getMovimentacoesSheet_(ss);
    var opId = 'TRANS-' + gerarIdLoteEstoque_();
    var origemTexto = 'Transferência ' + opId;
    var meta = ensureMovimentacoesAgendaMetadataColumns_(shMov);
    meta = ensureMovimentacoesAccessionColumn_(shMov);
    function append(tipo, local, quantidade) {
      var mov = [
        opId, agora, tipo, idItem, source[map.descricao] || '', source[map.tipo] || '',
        source[map.projeto] || '', quantidade, source[map.validade] || '', local, idLote,
        reservaObrigatoria ? String(reserva.participanteId || '') : '', reservaObrigatoria ? String(reserva.participante || '') : '',
        reservaObrigatoria ? String(reserva.agendaId || reserva.visitaPrevista || '') : '', userEmail, origemTexto,
        reservaObrigatoria ? 'Transferência com reserva para participante' : 'Transferência entre estoques'
      ];
      while (mov.length <= meta.accessionnumber) mov.push('');
      mov[meta.accessionnumber] = String((reserva && reserva.accessionNumber) || source[map.accessionNumber] || '').trim();
      shMov.appendRow(mov);
      var lr = shMov.getLastRow();
      if (meta.agendaid !== undefined) shMov.getRange(lr, meta.agendaid + 1).setValue(reservaObrigatoria ? String(reserva.agendaId || '') : '');
    }
    append('Saída - Transferência', origem, qtd);
    append('Entrada - Transferência', destino, qtd);
    if (reservaObrigatoria) {
      var reservaRow = [
        gerarIdLoteEstoque_(), agora, String(reserva.agendaId || ''), String(reserva.projeto || source[map.projeto] || ''), String(reserva.participante || ''),
        idItem, idLote, source[map.descricao] || '', source[map.validade] || '', destino, qtd, 'Reservado', visitaReserva,
        userEmail, String(reserva.observacoes || payload.observacao || ''), String(reserva.participanteId || ''), String(reserva.visitaPrevista || ''),
        String(reserva.accessionNumber || source[map.accessionNumber] || '')
      ];
      shReservas.getRange(shReservas.getLastRow() + 1, 1, 1, KIT_RESERVA_HEADERS_.length).setValues([reservaRow]);
    }
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return {
      ok: true, operacaoId: opId, quantidade: qtd, origem: origem, destino: destino,
      msg: reservaObrigatoria ? 'Kit reservado e transferido ao Laboratório.' : 'Transferência registrada com sucesso.'
    };
  });
}

function conciliarReservaKitLaboratorio(payload) {
  codexAssertCanWrite_('conciliarReservaKitLaboratorio', 'Estoque', payload && (payload.idItem || payload.idLote));
  return codexWithDocumentLock_('conciliarReservaKitLaboratorio', function() {
    payload = payload || {};
    var idItem = String(payload.idItem || '').trim();
    var idLote = String(payload.idLote || '').trim();
    var participanteId = String(payload.participanteId || '').trim();
    var participante = String(payload.participante || '').trim();
    var visitaPrevista = String(payload.visitaPrevista || '').trim();
    var quantidade = Number(payload.qtde || 0);
    if (!idItem || !idLote) throw new Error('Informe o item e o lote a conciliar.');
    if (!participanteId || !participante || !visitaPrevista) {
      throw new Error('Informe o participante e a visita prevista para conciliar o kit.');
    }
    if (!isFinite(quantidade) || quantidade <= 0 || quantidade % 1 !== 0) {
      throw new Error('Informe uma quantidade inteira válida.');
    }

    var visita = parseAgendaDateAny_(payload.dataVisita);
    if (!visita || isNaN(visita.getTime())) throw new Error('Informe uma data válida para a visita prevista.');
    visita.setHours(0, 0, 0, 0);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var shEstoque = getSheetByPossibleNames_(ss, ['Estoque']);
    if (!shEstoque) throw new Error('Aba "Estoque" não encontrada.');
    var map = ensureEstoqueLoteIdColumn_(shEstoque);
    var rows = shEstoque.getDataRange().getValues();
    var lote = null;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (String(row[map.idItem] || '').trim() === idItem && String(row[map.idLote] || '').trim() === idLote && estoqueEhLaboratorio_(row[map.localizacao])) {
        lote = row;
        break;
      }
    }
    if (!lote) throw new Error('O lote informado não está no Laboratório.');
    if (!estoqueTipoEhKit_(lote[map.tipo])) throw new Error('Somente kits de coleta exigem conciliação de reserva.');

    var validade = parseDateBrOrBlank_(lote[map.validade]);
    var validadeMinima = new Date(visita.getTime());
    validadeMinima.setDate(validadeMinima.getDate() + 10);
    if (!validade || isNaN(validade.getTime()) || validade < validadeMinima) {
      throw new Error('O lote selecionado não possui validade suficiente para a visita prevista.');
    }

    var chave = kitReservaChave_(idItem, idLote, estoqueValidadeKey_(lote[map.validade]), lote[map.localizacao], lote[map.accessionNumber]);
    var reservado = Number(getKitReservasResumo_()[chave] || 0);
    var saldoLaboratorio = Number(lote[map.qtde] || 0) || 0;
    if (quantidade > Math.max(0, saldoLaboratorio - reservado)) {
      throw new Error('Quantidade maior que os kits do lote ainda sem reserva nominada no Laboratório.');
    }

    var responsavel = '';
    try { responsavel = Session.getActiveUser().getEmail(); } catch (e) {}
    var shReservas = getKitReservasSheet_();
    var reservaRow = [
      gerarIdLoteEstoque_(), new Date(), String(payload.agendaId || ''), String(payload.projeto || lote[map.projeto] || ''), participante,
      idItem, idLote, lote[map.descricao] || '', lote[map.validade] || '', lote[map.localizacao] || '', quantidade, 'Reservado', visita,
      responsavel, String(payload.observacoes || 'Conciliação de kit já presente no Laboratório.'), participanteId, visitaPrevista,
      String(payload.accessionNumber || lote[map.accessionNumber] || '')
    ];
    shReservas.getRange(shReservas.getLastRow() + 1, 1, 1, KIT_RESERVA_HEADERS_.length).setValues([reservaRow]);
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return { ok: true, quantidade: quantidade, msg: 'Reserva conciliada no Laboratório.' };
  });
}

function getAgendaCandidatosReservaKit(payload) {
  payload = payload || {};
  var idReserva = String(payload.idReserva || '').trim();
  if (!idReserva) throw new Error('Reserva não informada.');
  var access = codexGetCurrentUserAccess();
  if (!access || !access.ok) throw new Error((access && access.message) || 'Acesso negado.');

  var reserva = getKitReservasLinhas_().filter(function(item) { return item.idReserva === idReserva; })[0];
  if (!reserva) throw new Error('Reserva não encontrada.');
  if (String(reserva.agendaId || '').trim()) return { vinculada: true, candidatos: [] };

  var shAgenda = getAgendaSheetForRead_();
  var lastRow = shAgenda.getLastRow();
  if (lastRow < 2) return { vinculada: false, candidatos: [] };
  var values = shAgenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
  var participanteId = normText_(reserva.participanteId);
  var participanteNome = normText_(reserva.participante);
  var projeto = normText_(reserva.projeto);
  var dataReferencia = parseAgendaDateAny_(reserva.dataVisita);
  if (dataReferencia) dataReferencia.setHours(0, 0, 0, 0);
  var candidatos = [];
  values.forEach(function(row, index) {
    var id = String(row[AGENDA_CFG.idx.id] || '').trim();
    var nome = String(row[AGENDA_CFG.idx.participante] || '').trim();
    var idAgendaParticipante = String(row[AGENDA_CFG.idx.idParticipante] || '').trim();
    var projetoAgenda = String(row[AGENDA_CFG.idx.projeto] || '').trim();
    var status = String(row[AGENDA_CFG.idx.status] || '').trim();
    var data = parseAgendaDateAny_(row[AGENDA_CFG.idx.data]);
    if (!data || AgendaServerRules_.isCancelled(status)) return;
    var participanteCompativel = participanteId && normText_(idAgendaParticipante)
      ? participanteId === normText_(idAgendaParticipante)
      : participanteNome === normText_(nome);
    if (!participanteCompativel || (projeto && projeto !== normText_(projetoAgenda))) return;
    data.setHours(0, 0, 0, 0);
    candidatos.push({
      id: id || '__ROW__' + (index + 2), agendaId: id, semId: !id, rowIndex: index + 2, data: formatarDataMesCurtoPt_(data), dataIso: formatarDataIsoAgenda_(data),
      visita: String(row[AGENDA_CFG.idx.visita] || '').trim() || 'Visita sem nome',
      participante: nome, idParticipante: idAgendaParticipante, projeto: projetoAgenda, status: status,
      distancia: dataReferencia ? Math.abs(data.getTime() - dataReferencia.getTime()) : 0
    });
  });
  candidatos.sort(function(a, b) { return a.distancia - b.distancia || a.dataIso.localeCompare(b.dataIso) || a.rowIndex - b.rowIndex; });
  return { vinculada: false, candidatos: candidatos.slice(0, 80) };
}

function vincularReservaKitAgenda(payload) {
  codexAssertCanWrite_('vincularReservaKitAgenda', 'Estoque', payload && payload.idReserva);
  return codexWithDocumentLock_('vincularReservaKitAgenda', function() {
    payload = payload || {};
    var idReserva = String(payload.idReserva || '').trim();
    var agendaId = String(payload.agendaId || '').trim();
    var rowIndex = Number(payload.rowIndex || 0);
    if (!idReserva || (!agendaId && rowIndex < 2)) throw new Error('Informe a reserva e a visita da Agenda.');
    var shReservas = getKitReservasSheet_();
    var rowsReservas = shReservas.getRange(2, 1, Math.max(0, shReservas.getLastRow() - 1), KIT_RESERVA_HEADERS_.length).getValues();
    var linhaReserva = -1;
    var reserva = null;
    rowsReservas.forEach(function(row, index) {
      if (String(row[0] || '').trim() === idReserva) {
        linhaReserva = index + 2;
        reserva = {
          participante: String(row[4] || '').trim(), idItem: String(row[5] || '').trim(), idLote: String(row[6] || '').trim(),
          validade: row[8], localizacao: String(row[9] || '').trim(), qtde: Number(row[10] || 0) || 0,
          projeto: String(row[3] || '').trim(), agendaId: String(row[2] || '').trim(), dataVisita: row[12], participanteId: String(row[15] || '').trim()
        };
      }
    });
    if (linhaReserva < 2 || !reserva) throw new Error('Reserva não encontrada.');
    if (reserva.agendaId && reserva.agendaId !== agendaId) throw new Error('Esta reserva já está vinculada a outra visita.');

    var shAgenda = getAgendaSheetForRead_();
    var linhaAgenda = agendaLocalizarLinhaPorId_(shAgenda, agendaId, rowIndex);
    if (!linhaAgenda) throw new Error('Visita da Agenda não encontrada.');
    var agendaRow = shAgenda.getRange(linhaAgenda, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
    if (!agendaId) {
      agendaId = 'AG-' + gerarIdLoteEstoque_();
      shAgenda.getRange(linhaAgenda, AGENDA_CFG.col.id).setValue(agendaId);
      agendaRow[AGENDA_CFG.idx.id] = agendaId;
    }
    var agendaParticipanteId = String(agendaRow[AGENDA_CFG.idx.idParticipante] || '').trim();
    var agendaParticipante = String(agendaRow[AGENDA_CFG.idx.participante] || '').trim();
    var agendaProjeto = String(agendaRow[AGENDA_CFG.idx.projeto] || '').trim();
    if ((reserva.participanteId && agendaParticipanteId && normText_(reserva.participanteId) !== normText_(agendaParticipanteId)) ||
        (!agendaParticipanteId && normText_(reserva.participante) !== normText_(agendaParticipante)) ||
        (reserva.projeto && normText_(reserva.projeto) !== normText_(agendaProjeto))) {
      throw new Error('A visita selecionada não corresponde ao participante ou projeto da reserva.');
    }
    var dataAgenda = parseAgendaDateAny_(agendaRow[AGENDA_CFG.idx.data]);
    if (!dataAgenda || isNaN(dataAgenda.getTime())) throw new Error('A visita selecionada não possui uma data válida.');
    dataAgenda.setHours(0, 0, 0, 0);
    var validade = parseDateBrOrBlank_(reserva.validade);
    var validadeMinima = new Date(dataAgenda.getTime());
    validadeMinima.setDate(validadeMinima.getDate() + 10);
    if (!validade || validade < validadeMinima) throw new Error('A validade do lote não cobre a data real da visita com a margem de 10 dias.');
    shReservas.getRange(linhaReserva, 3).setValue(agendaId);
    shReservas.getRange(linhaReserva, 13).setValue(dataAgenda);
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return { ok: true, agendaId: agendaId, dataVisita: formatarDataMesCurtoPt_(dataAgenda), msg: 'Reserva vinculada à visita da Agenda.' };
  });
}

function baixarKitsAgendaEvento(payload) {
  codexAssertCanWrite_('baixarKitsAgendaEvento', 'Estoque', payload && payload.agendaId);
  return codexWithDocumentLock_('baixarKitsAgendaEvento', function() {
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
          idLote: String(kit.idLote || '').trim(),
          lote: String(kit.idLote || '').trim(),
          accessionNumber: String(kit.accessionNumber || '').trim(),
          tipoMovimento: 'Saida - Visita',
          projeto: payload.projeto || '',
          participante: payload.participante || '',
          idVisita: payload.visita || agendaId,
          data: payload.data || '',
          origem: origemBase,
          agendaId: agendaId,
          agendaKitAcao: 'baixa',
          observacao: 'Baixa de kit selecionado na Agenda: ' + String(kit.label || id)
        });
        jaBaixados[id] = true;
        baixados++;
        atualizarStatusReservasAgendaItens_(agendaId, [{ idItem: id, idLote: String(kit.idLote || '').trim(), accessionNumber: String(kit.accessionNumber || '').trim(), qtde: 1 }], 'Baixado', 'Reservado');
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
  });
}

function getKitsAgendaBaixaStatus(agendaId) {
  agendaId = String(agendaId || '').trim();
  if (!agendaId) return { baixados: false, ids: [] };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = getMovimentacoesSheet_(ss);
  var saldo = {};
  var origemBase = 'Agenda kit ' + agendaId;
  var origemDev = 'Agenda kit devolucao ' + agendaId;
  var movMetaCols = movimentacoesHeaderInfo_(shMov).map || {};
  if (shMov.getLastRow() > 1) {
    var vals = shMov.getRange(2, 1, shMov.getLastRow() - 1, Math.max(17, shMov.getLastColumn())).getValues();
    vals.forEach(function(r) {
      var idItem = String(r[3] || '').trim();
      var origem = String(r[15] || '').trim();
      var rowAgendaId = movMetaCols.agendaid !== undefined ? String(r[movMetaCols.agendaid] || '').trim() : '';
      var rowAgendaKitAcao = movMetaCols.agendakitacao !== undefined ? normalizeHeader_(r[movMetaCols.agendakitacao]) : '';
      if (!idItem) return;
      if (rowAgendaId) {
        if (rowAgendaId === agendaId && rowAgendaKitAcao === 'baixa') saldo[idItem] = (saldo[idItem] || 0) + Number(r[7] || 0);
        if (rowAgendaId === agendaId && rowAgendaKitAcao === 'devolucao') saldo[idItem] = (saldo[idItem] || 0) - Number(r[7] || 0);
        return;
      }
      if (origem.indexOf(origemBase) === 0) saldo[idItem] = (saldo[idItem] || 0) + Number(r[7] || 0);
      if (origem.indexOf(origemDev) === 0) saldo[idItem] = (saldo[idItem] || 0) - Number(r[7] || 0);
    });
  }
  var ids = Object.keys(saldo).filter(function(id) { return saldo[id] > 0; });
  return { baixados: ids.length > 0, ids: ids };
}

function devolverKitsAgendaEvento(payload) {
  codexAssertCanWrite_('devolverKitsAgendaEvento', 'Estoque', payload && payload.agendaId);
  return codexWithDocumentLock_('devolverKitsAgendaEvento', function() {
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
      idLote: '',
      lote: '',
      tipoMovimento: 'Entrada - Devolucao de kit da Agenda',
      projeto: payload.projeto || '',
      participante: payload.participante || '',
      idVisita: payload.visita || agendaId,
      data: payload.data || '',
      origem: origemDev,
      agendaId: agendaId,
      agendaKitAcao: 'devolucao',
      observacao: 'Devolucao de kit baixado pela Agenda'
    });
    atualizarStatusReservasAgendaItens_(agendaId, [{ idItem: id, qtde: 1 }], 'Devolvido', 'Baixado');
    devolvidos++;
  });
  return { ok: true, devolvidos: devolvidos, msg: devolvidos + ' kit(s) devolvido(s) ao estoque.' };
  });
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
  codexAssertCanWrite_('salvarPlanejamentoDescarteEstoque', 'Estoque', payload && payload.idDescarte);
  return codexWithDocumentLock_('salvarPlanejamentoDescarteEstoque', function() {
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
  });
}

function efetivarDescarteEstoque(idDescarte) {
  codexAssertCanWrite_('efetivarDescarteEstoque', 'Estoque', idDescarte);
  return codexWithDocumentLock_('efetivarDescarteEstoque', function() {
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
  var itensParaEfetivar = [];
  var itensInvalidos = [];
  var itensJaEfetivados = 0;
  itemRows.forEach(function(r, idx) {
    if (String(r[0] || '') !== id) return;
    var row = idx + 2;
    var qtdPlanejada = Number(r[6] || 0);
    var qtdJaDescartada = Math.max(0, Number(r[7] || 0));
    var jaEfetivado = normText_(r[8]).indexOf('efetivado') >= 0 || (qtdPlanejada > 0 && qtdJaDescartada >= qtdPlanejada);
    if (jaEfetivado) {
      itensJaEfetivados++;
      return;
    }
    if (!isFinite(qtdPlanejada) || qtdPlanejada <= 0) {
      itensInvalidos.push(row);
      return;
    }
    var qtdPendente = qtdPlanejada - qtdJaDescartada;
    if (qtdPendente <= 0) {
      itensJaEfetivados++;
      return;
    }
    itensParaEfetivar.push({ row: row, dados: r, qtd: qtdPendente, qtdPlanejada: qtdPlanejada, qtdJaDescartada: qtdJaDescartada });
  });
  if (!itensParaEfetivar.length) {
    if (itensJaEfetivados > 0 && !itensInvalidos.length) {
      shDesc.getRange(rowDesc, 6).setValue('Efetivado');
      shDesc.getRange(rowDesc, 9).setValue(new Date()).setNumberFormat('dd/MM/yyyy');
      return 'Descarte ja estava efetivado: ' + itensJaEfetivados + ' item(ns).';
    }
    throw new Error('Nenhum item com quantidade valida para efetivar neste descarte. Revise as quantidades antes de concluir.');
  }
  if (itensInvalidos.length) {
    throw new Error('Existem itens com quantidade zero ou invalida no descarte (linha(s) ' + itensInvalidos.join(', ') + '). Corrija antes de efetivar.');
  }
  var shEstoque = getSheetByPossibleNames_(ss, ['Estoque']);
  if (!shEstoque) throw new Error('Aba "Estoque" nao encontrada.');
  var estoqueMap = ensureEstoqueLoteIdColumn_(shEstoque);
  var tz = Session.getScriptTimeZone();
  var estoqueRows = shEstoque.getDataRange().getValues();
  var reservadoPorLinha = {};
  var planos = [];

  itensParaEfetivar.forEach(function(item) {
    var r = item.dados;
    var ids = String(r[1] || '').split(/\s*,\s*/).map(function(v) { return v.trim(); }).filter(Boolean);
    var validadeKey = estoqueValidadeKey_(r[4], tz);
    var localKey = estoqueLocalKey_(r[5]);
    var restante = item.qtd;
    var baixas = [];

    for (var e = 1; e < estoqueRows.length && restante > 0; e++) {
      var er = estoqueRows[e] || [];
      var idEstoque = String(er[0] || '').trim();
      if (ids.indexOf(idEstoque) < 0) continue;
      if (validadeKey && estoqueValidadeKey_(er[4], tz) !== validadeKey) continue;
      if (localKey && estoqueLocalKey_(er[5]) !== localKey) continue;
      var rowEstoque = e + 1;
      var disponivel = Math.max(0, Number(er[6] || 0) - Number(reservadoPorLinha[rowEstoque] || 0));
      if (!disponivel) continue;
      var retirar = Math.min(restante, disponivel);
      baixas.push({
        rowEstoque: rowEstoque,
        idItem: idEstoque,
        descricao: String(er[2] || r[2] || ''),
        tipoItem: String(er[3] || r[3] || ''),
        validade: estoqueValidadeKey_(er[4], tz),
        localizacao: String(er[5] || r[5] || ''),
        idLote: String(er[estoqueMap.idLote] || '').trim(),
        qtde: retirar
      });
      reservadoPorLinha[rowEstoque] = Number(reservadoPorLinha[rowEstoque] || 0) + retirar;
      restante -= retirar;
    }

    if (restante > 0) {
      var identificacao = String(r[2] || r[1] || 'Item');
      var encontrado = item.qtd - restante;
      throw new Error('Saldo do item/lote insuficiente para efetivar o descarte: ' + identificacao + '. Solicitado: ' + item.qtd + '; localizado: ' + encontrado + '.');
    }
    planos.push({ item: item, baixas: baixas });
  });

  var atualizados = 0;
  planos.forEach(function(plano) {
    plano.baixas.forEach(function(baixa) {
      registrarMovimentacaoEstoque({
        tipoMovimento: 'Sa\u00edda - Ajuste/Descarte',
        estoqueRow: baixa.rowEstoque,
        idItem: baixa.idItem,
        descricao: baixa.descricao,
        tipoItem: baixa.tipoItem,
        projeto: projeto,
        qtde: baixa.qtde,
        validade: baixa.validade,
        localizacao: baixa.localizacao,
        idLote: baixa.idLote,
        origem: 'Lista de descarte ' + id,
        observacao: obs || 'Descarte efetivado'
      });
      if (baixa.idLote && typeof atualizarReservasPorLote_ === 'function') {
        atualizarReservasPorLote_({ idItem: baixa.idItem, idLote: baixa.idLote, localizacao: baixa.localizacao, qtde: baixa.qtde, novoStatus: 'Descartado', observacao: 'Descarte efetivado · ' + id });
      }
    });
    shItens.getRange(plano.item.row, 8).setValue(plano.item.qtdPlanejada);
    shItens.getRange(plano.item.row, 9).setValue('Efetivado');
    atualizados++;
  });
  shDesc.getRange(rowDesc, 6).setValue('Efetivado');
  shDesc.getRange(rowDesc, 9).setValue(new Date()).setNumberFormat('dd/MM/yyyy');
  return 'Descarte efetivado: ' + atualizados + ' item(ns).';
  });
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
  return getMovimentacoesEstoque();
}

// ===================== ESTOQUE - Visualização =====================
function getEstoqueColumnMap_(headers) {
  var normalized = (headers || []).map(function(h) { return normalizeHeader_(h); });
  function find(aliases, fallbackIdx) {
    for (var i = 0; i < aliases.length; i++) {
      var key = normalizeHeader_(aliases[i]);
      var idx = normalized.indexOf(key);
      if (idx >= 0) return idx;
    }
    return fallbackIdx;
  }
  return {
    idItem: find(['ID_Item', 'ID Item', 'ID'], 0),
    projeto: find(['Projeto'], 1),
    descricao: find(['Descrição', 'Descricao', 'Item'], 2),
    tipo: find(['Tipo', 'Tipo de item'], 3),
    validade: find(['Validade', 'Data de validade'], 4),
    localizacao: find(['Localização', 'Localizacao', 'Local'], 5),
    qtde: find(['Qtde', 'Quantidade', 'Saldo'], 6),
    estoqueMin: find(['EstoqueMin', 'Estoque mínimo', 'Estoque minimo', 'Mínimo', 'Minimo'], 7),
    status: find(['Status'], 8),
    ultimaAlteracao: find(['UltimaAlteracao', 'Última alteração', 'Ultima alteracao'], 9),
    responsavel: find(['Responsavel', 'Responsável'], 10),
    qtdePedidaPendente: find(['Qtde_pedida_pendente', 'Quantidade pedida pendente'], 11),
    numeroPedido: find(['N_Pedido', 'Número do pedido', 'Numero do pedido'], 12),
    idLote: find(['ID_Lote', 'ID Lote', 'Identificador do lote'], 13),
    accessionNumber: find(['Accession_Number', 'Accession Number', 'AccessionNumber', 'Número de accession', 'Numero de accession'], 14)
  };
}

function ensureEstoqueLoteIdColumn_(sheet) {
  if (!sheet) throw new Error('Aba "Estoque" não encontrada.');
  var lastColumn = Math.max(sheet.getLastColumn(), 13);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var map = getEstoqueColumnMap_(headers);
  if (!(map.idLote >= 0 && map.idLote < headers.length && normalizeHeader_(headers[map.idLote]) === 'idlote')) {
    var target = sheet.getLastColumn() + 1;
    sheet.getRange(1, target).setValue('ID_Lote');
    headers = sheet.getRange(1, 1, 1, Math.max(target, 14)).getValues()[0];
    map = getEstoqueColumnMap_(headers);
  }
  if (!(map.accessionNumber >= 0 && map.accessionNumber < headers.length && normalizeHeader_(headers[map.accessionNumber]) === 'accessionnumber')) {
    var accessionTarget = sheet.getLastColumn() + 1;
    sheet.getRange(1, accessionTarget).setValue('Accession_Number');
    headers = sheet.getRange(1, 1, 1, Math.max(accessionTarget, 15)).getValues()[0];
    map = getEstoqueColumnMap_(headers);
  }
  return map;
}

function gerarIdLoteEstoque_() {
  try { return Utilities.getUuid(); } catch (e) {
    return 'LOTE-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000000);
  }
}

function migrarIdsLotesEstoque() {
  codexAssertCanWrite_('migrarIdsLotesEstoque', 'Estoque', 'ID_Lote');
  return codexWithDocumentLock_('migrarIdsLotesEstoque', function() {
    var sheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Estoque']);
    if (!sheet || sheet.getLastRow() < 1) throw new Error('Aba "Estoque" não encontrada.');
    var map = ensureEstoqueLoteIdColumn_(sheet);
    var preenchidos = 0;
    var existentes = 0;
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var values = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), map.idLote + 1)).getValues();
      values.forEach(function(row, index) {
        var temLinha = String(row[map.idItem] || '').trim() || String(row[map.descricao] || '').trim();
        if (!temLinha) return;
        if (String(row[map.idLote] || '').trim()) {
          existentes++;
          return;
        }
        sheet.getRange(index + 2, map.idLote + 1).setValue(gerarIdLoteEstoque_());
        preenchidos++;
      });
    }
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return { ok: true, preenchidos: preenchidos, existentes: existentes, coluna: map.idLote + 1 };
  });
}

function getEstoqueLinhas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Estoque");
  if (!sh || sh.getLastRow() < 2) return [];
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 15)).getValues()[0];
  var columns = getEstoqueColumnMap_(headers);
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 15)).getValues();
  var tz = Session.getScriptTimeZone();
  var catalogo = getItensEstoque().itens || [];
  var catalogoPorId = {};
  var catalogoPorDescricao = {};

  function catalogoKey(projeto, descricao, tipo) {
    return [projeto, descricao, tipo].map(function(v) {
      return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }).join('||');
  }

  catalogo.forEach(function(item) {
    var id = String(item.idItem || '').trim();
    if (id) catalogoPorId[id] = item;
    catalogoPorDescricao[catalogoKey(item.projeto, item.descricao, item.tipo)] = item;
  });

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
      var idItem = String(r[columns.idItem] || '');
      var projeto = String(r[columns.projeto] || '');
      var descricao = String(r[columns.descricao] || '');
      var tipoItem = String(r[columns.tipo] || '');
      var itemCatalogo = catalogoPorId[idItem.trim()] || catalogoPorDescricao[catalogoKey(projeto, descricao, tipoItem)] || {};
      return {
        idItem:           idItem,
        projeto:          projeto,
        descricao:        descricao,
        tipoItem:         tipoItem,
        validade:         fmtDate(r[columns.validade]),
        localizacao:      String(r[columns.localizacao]  || ''),
        qtde:             r[columns.qtde]  !== '' && r[columns.qtde]  !== null ? Number(r[columns.qtde])  : '',
        estoqueMinimo:    r[columns.estoqueMin]  !== '' && r[columns.estoqueMin]  !== null ? Number(r[columns.estoqueMin])  : '',
        status:           String(r[columns.status]  || ''),
        ultimaAlteracao:  fmtDate(r[columns.ultimaAlteracao]),
        responsavel:      String(r[columns.responsavel] || ''),
        qtdePedidaPendente: r[columns.qtdePedidaPendente] !== '' && r[columns.qtdePedidaPendente] !== null ? Number(r[columns.qtdePedidaPendente]) : '',
        numeroPedido:     String(r[columns.numeroPedido] || ''),
        idLote:           String(r[columns.idLote] || ''),
        accessionNumber:  String(r[columns.accessionNumber] || '').trim(),
        observacoes:      String(itemCatalogo.observacoes || ''),
        detalhesVisita:   String(itemCatalogo.detalhesVisita || ''),
        ordem:            itemCatalogo.ordem !== undefined && itemCatalogo.ordem !== '' ? Number(itemCatalogo.ordem) : ''
      };
    });

  return itens;
}

function getEstoque() {
  var itens = agruparEstoquePorItemValidade_(getEstoqueLinhas_());
  var reservas = getKitReservasResumo_();
  itens.forEach(function(item) {
    var chave = kitReservaChave_(item.idItem, item.idLote, item.validade, item.localizacao, item.accessionNumber);
    var reservado = Number(reservas[chave] || 0);
    item.qtdeFisica = Number(item.qtde || 0) || 0;
    item.qtdeReservada = reservado;
    item.qtdeDisponivel = Math.max(0, item.qtdeFisica - reservado);
  });
  return itens;
}

var KIT_RESERVA_HEADERS_ = [
  'ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante',
  'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde',
  'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante',
  'Visita_Prevista', 'Accession_Number'
];

function getKitReservasSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getSheetByPossibleNames_(ss, ['Reservas_Kits', 'Reservas de Kits']);
  if (!sh) {
    sh = ss.insertSheet('Reservas_Kits');
    sh.getRange(1, 1, 1, KIT_RESERVA_HEADERS_.length).setValues([KIT_RESERVA_HEADERS_]);
  } else {
    var headers = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    var existentes = {};
    headers.forEach(function(header) { existentes[normalizeHeader_(header)] = true; });
    KIT_RESERVA_HEADERS_.forEach(function(header) {
      if (existentes[normalizeHeader_(header)]) return;
      sh.getRange(1, sh.getLastColumn() + 1).setValue(header);
      existentes[normalizeHeader_(header)] = true;
    });
  }
  return sh;
}

function kitReservaChave_(idItem, idLote, validade, localizacao, accessionNumber) {
  return [idItem, idLote, validade, localizacao, accessionNumber].map(function(v) {
    return String(v || '').trim().toLowerCase();
  }).join('|');
}

function getKitReservasLinhas_() {
  var sh = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Reservas_Kits', 'Reservas de Kits']);
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = Session.getScriptTimeZone();
  function fmtDate(v) {
    if (!v) return '';
    if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz, 'dd/MM/yyyy');
    return String(v || '');
  }
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(KIT_RESERVA_HEADERS_.length, sh.getLastColumn())).getValues()
    .filter(function(r) { return String(r[0] || '').trim(); })
    .map(function(r) {
      return {
        idReserva: String(r[0] || ''), agendaId: String(r[2] || ''), projeto: String(r[3] || ''),
        participante: String(r[4] || ''), idItem: String(r[5] || ''), idLote: String(r[6] || ''),
        descricao: String(r[7] || ''), validade: fmtDate(r[8]), localizacao: String(r[9] || ''),
        qtde: Number(r[10] || 0) || 0, status: String(r[11] || 'Reservado'),
        dataVisita: fmtDate(r[12]), responsavel: String(r[13] || ''), observacoes: String(r[14] || ''),
        participanteId: String(r[15] || ''), visitaPrevista: String(r[16] || ''),
        accessionNumber: String(r[17] || '').trim()
      };
    });
}

var KIT_CONFERENCIA_HEADERS_ = [
  'ID_Conferencia', 'Data_Conferencia', 'ID_Reserva', 'Projeto', 'Participante',
  'ID_Participante', 'ID_Item', 'ID_Lote', 'Accession_Number', 'Descrição',
  'Validade', 'Qtde_Esperada', 'Qtde_Conferida', 'Divergencia', 'Status',
  'Responsável', 'Observações'
];

function getKitConferenciasSheet_(create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getSheetByPossibleNames_(ss, ['Conferencias_Laboratorio', 'Conferências Laboratório', 'Conferencias Laboratorio']);
  if (!sh && create !== false) {
    sh = ss.insertSheet('Conferencias_Laboratorio');
    sh.getRange(1, 1, 1, KIT_CONFERENCIA_HEADERS_.length).setValues([KIT_CONFERENCIA_HEADERS_]);
  }
  if (!sh) return null;
  var headers = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var existentes = {};
  headers.forEach(function(header) { existentes[normalizeHeader_(header)] = true; });
  KIT_CONFERENCIA_HEADERS_.forEach(function(header) {
    if (existentes[normalizeHeader_(header)]) return;
    sh.getRange(1, sh.getLastColumn() + 1).setValue(header);
    existentes[normalizeHeader_(header)] = true;
  });
  return sh;
}

function getKitConferenciasLinhas_() {
  var sh = getKitConferenciasSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(KIT_CONFERENCIA_HEADERS_.length, sh.getLastColumn())).getValues()
    .filter(function(row) { return String(row[0] || '').trim(); })
    .map(function(row) {
      return {
        idConferencia: String(row[0] || '').trim(),
        dataConferencia: row[1] || '',
        idReserva: String(row[2] || '').trim(),
        projeto: String(row[3] || '').trim(),
        participante: String(row[4] || '').trim(),
        participanteId: String(row[5] || '').trim(),
        idItem: String(row[6] || '').trim(),
        idLote: String(row[7] || '').trim(),
        accessionNumber: String(row[8] || '').trim(),
        descricao: String(row[9] || '').trim(),
        validade: row[10] || '',
        qtdeEsperada: Number(row[11] || 0) || 0,
        qtdeConferida: Number(row[12] || 0) || 0,
        divergencia: Number(row[13] || 0) || 0,
        status: String(row[14] || '').trim(),
        responsavel: String(row[15] || '').trim(),
        observacoes: String(row[16] || '').trim()
      };
    });
}

function getEstoquePilotoData_() {
  var reservas = getKitReservasLinhas_().filter(function(reserva) {
    return normText_(reserva.status || 'Reservado') === 'reservado' && estoqueEhLaboratorio_(reserva.localizacao);
  });
  var conferencias = getKitConferenciasLinhas_();
  var conferenciaPorReserva = {};
  conferencias.forEach(function(conferencia) {
    if (conferencia.idReserva) conferenciaPorReserva[conferencia.idReserva] = conferencia;
  });
  var projetos = {};
  var reservasComConferencia = reservas.map(function(reserva) {
    var conferencia = conferenciaPorReserva[reserva.idReserva] || null;
    projetos[reserva.projeto || 'Sem projeto'] = true;
    return {
      idReserva: reserva.idReserva,
      projeto: reserva.projeto,
      participante: reserva.participante,
      participanteId: reserva.participanteId,
      idItem: reserva.idItem,
      idLote: reserva.idLote,
      accessionNumber: reserva.accessionNumber,
      descricao: reserva.descricao,
      validade: reserva.validade,
      visitaPrevista: reserva.visitaPrevista,
      dataVisita: reserva.dataVisita,
      qtdeEsperada: reserva.qtde,
      qtdeConferida: conferencia ? conferencia.qtdeConferida : '',
      divergencia: conferencia ? conferencia.divergencia : '',
      conferenciaStatus: conferencia ? conferencia.status : 'Pendente',
      conferenciaObservacoes: conferencia ? conferencia.observacoes : ''
    };
  });

  var lotesSemReserva = [];
  var visualizacao = getEstoqueVisualizacao() || [];
  visualizacao.forEach(function(item) {
    (item.lotes || []).forEach(function(lote) {
      if (!estoqueEhLaboratorio_(lote.localizacao)) return;
      var disponivel = Math.max(0, Number(lote.qtdeDisponivel !== undefined ? lote.qtdeDisponivel : (Number(lote.qtde || 0) - Number(lote.qtdeReservada || 0))) || 0);
      if (!disponivel) return;
      lotesSemReserva.push({
        projeto: item.projeto || lote.projeto || '',
        idItem: item.idItem || '',
        descricao: item.descricao || lote.descricao || '',
        idLote: lote.idLote || '',
        accessionNumber: lote.accessionNumber || '',
        validade: lote.validade || '',
        qtdeSistemaSemReserva: disponivel
      });
    });
  });
  return {
    projetos: Object.keys(projetos).filter(Boolean).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); }),
    reservas: reservasComConferencia,
    lotesSemReserva: lotesSemReserva,
    resumo: {
      reservas: reservasComConferencia.length,
      kitsEsperados: reservasComConferencia.reduce(function(total, reserva) { return total + Number(reserva.qtdeEsperada || 0); }, 0),
      conferidos: reservasComConferencia.filter(function(reserva) { return reserva.conferenciaStatus === 'Conferido'; }).length,
      divergencias: reservasComConferencia.filter(function(reserva) { return reserva.conferenciaStatus === 'Divergência'; }).length,
      pendentes: reservasComConferencia.filter(function(reserva) { return reserva.conferenciaStatus === 'Pendente'; }).length,
      lotesSemReserva: lotesSemReserva.length
    }
  };
}

function registrarConferenciaLaboratorio(payload) {
  codexAssertCanWrite_('registrarConferenciaLaboratorio', 'Estoque', payload && (payload.idReserva || payload.idLote || payload.idItem));
  return codexWithDocumentLock_('registrarConferenciaLaboratorio', function() {
    payload = payload || {};
    var idReserva = String(payload.idReserva || '').trim();
    var quantidade = Number(payload.qtdeConferida);
    if (!isFinite(quantidade) || quantidade < 0 || quantidade % 1 !== 0) throw new Error('Informe uma quantidade física inteira, igual ou maior que zero.');
    var reservas = getKitReservasLinhas_();
    var reserva = idReserva ? reservas.filter(function(item) { return item.idReserva === idReserva && normText_(item.status || '') === 'reservado'; })[0] : null;
    if (idReserva && !reserva) throw new Error('Reserva ativa não encontrada.');
    if (reserva && !estoqueEhLaboratorio_(reserva.localizacao)) throw new Error('A reserva informada não está atribuída ao Laboratório.');
    var idItem = String(payload.idItem || (reserva && reserva.idItem) || '').trim();
    var idLote = String(payload.idLote || (reserva && reserva.idLote) || '').trim();
    if (!idItem || !idLote) throw new Error('Informe o item e o lote da conferência.');
    var esperado = Number(payload.qtdeEsperada !== undefined ? payload.qtdeEsperada : (reserva && reserva.qtde)) || 0;
    var divergencia = quantidade - esperado;
    var status = divergencia === 0 ? 'Conferido' : 'Divergência';
    var observacoes = String(payload.observacoes || '').trim();
    var responsavel = '';
    try { responsavel = Session.getActiveUser().getEmail() || ''; } catch(e) {}
    var sheet = getKitConferenciasSheet_(true);
    var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, KIT_CONFERENCIA_HEADERS_.length).getValues() : [];
    var linha = -1;
    rows.forEach(function(row, index) {
      if (idReserva && String(row[2] || '').trim() === idReserva) linha = index + 2;
    });
    var values = [[
      linha > 1 ? String(rows[linha - 2][0] || '') : gerarIdLoteEstoque_(), new Date(), idReserva,
      String(payload.projeto || (reserva && reserva.projeto) || '').trim(),
      String(payload.participante || (reserva && reserva.participante) || '').trim(),
      String(payload.participanteId || (reserva && reserva.participanteId) || '').trim(), idItem, idLote,
      String(payload.accessionNumber || (reserva && reserva.accessionNumber) || '').trim(),
      String(payload.descricao || (reserva && reserva.descricao) || '').trim(),
      payload.validade || (reserva && reserva.validade) || '', esperado, quantidade, divergencia, status, responsavel, observacoes
    ]];
    if (linha > 1) sheet.getRange(linha, 1, 1, KIT_CONFERENCIA_HEADERS_.length).setValues(values);
    else sheet.getRange(sheet.getLastRow() + 1, 1, 1, KIT_CONFERENCIA_HEADERS_.length).setValues(values);
    SpreadsheetApp.flush();
    return { ok: true, status: status, divergencia: divergencia, msg: status === 'Conferido' ? 'Conferência registrada.' : 'Conferência registrada com divergência.' };
  });
}

function importarReservasOperacionais(payload) {
  codexAssertCanWrite_('importarReservasOperacionais', 'Estoque', 'Piloto Laboratório');
  return codexWithDocumentLock_('importarReservasOperacionais', function() {
    payload = payload || {};
    var linhasEntrada = Array.isArray(payload.linhas) ? payload.linhas : [];
    if (!linhasEntrada.length) throw new Error('Cole ao menos uma reserva para importar.');
    if (linhasEntrada.length > 500) throw new Error('O piloto aceita no máximo 500 reservas por importação.');
    var estoque = getEstoqueLinhas_() || [];
    var reservasSheet = getKitReservasSheet_();
    var reservasAtivas = getKitReservasLinhas_().filter(function(reserva) { return normText_(reserva.status || 'Reservado') === 'reservado'; });
    var responsavel = '';
    try { responsavel = Session.getActiveUser().getEmail() || ''; } catch(e) {}
    var linhas = [], erros = [], ignorados = [], avisos = [];
    function texto(value) { return String(value === undefined || value === null ? '' : value).trim(); }
    function norm(value) { return normText_(texto(value)); }
    function resolveLote(item) {
      var candidatos = estoque.filter(function(lote) {
        if (item.idItem && texto(lote.idItem) !== item.idItem) return false;
        if (!item.idItem && item.descricao && norm(lote.descricao) !== norm(item.descricao)) return false;
        if (item.projeto && norm(lote.projeto) !== norm(item.projeto)) return false;
        if (!estoqueEhLaboratorio_(item.localizacao || lote.localizacao)) return false;
        if (item.idLote && texto(lote.idLote) !== item.idLote) return false;
        if (item.accessionNumber && texto(lote.accessionNumber) !== item.accessionNumber) return false;
        if (item.validade && estoqueValidadeKey_(lote.validade) !== estoqueValidadeKey_(item.validade)) return false;
        return true;
      });
      return candidatos;
    }
    linhasEntrada.forEach(function(raw, index) {
      var linha = raw || {};
      var item = {
        projeto: texto(linha.projeto), participante: texto(linha.participante), participanteId: texto(linha.participanteId || linha.idParticipante),
        idItem: texto(linha.idItem), descricao: texto(linha.descricao), idLote: texto(linha.idLote), accessionNumber: texto(linha.accessionNumber),
        visitaPrevista: texto(linha.visitaPrevista || linha.visita), dataVisita: texto(linha.dataVisita || linha.data), validade: texto(linha.validade),
        qtde: Number(linha.qtde || linha.quantidade || 0), localizacao: 'Laboratório', agendaId: texto(linha.agendaId), observacoes: texto(linha.observacoes)
      };
      var numeroLinha = index + 2;
      if (!item.projeto || !item.participante) { erros.push('Linha ' + numeroLinha + ': projeto e participante são obrigatórios.'); return; }
      if (!isFinite(item.qtde) || item.qtde <= 0 || item.qtde % 1 !== 0) { erros.push('Linha ' + numeroLinha + ': quantidade deve ser um inteiro maior que zero.'); return; }
      var candidatos = resolveLote(item);
      if (!candidatos.length) { erros.push('Linha ' + numeroLinha + ': item/lote não localizado no Laboratório.'); return; }
      if (candidatos.length > 1) { erros.push('Linha ' + numeroLinha + ': informe ID_Lote ou validade para identificar o lote.'); return; }
      var lote = candidatos[0];
      if (!estoqueTipoEhKit_(lote.tipoItem)) { erros.push('Linha ' + numeroLinha + ': somente kits podem entrar na migração de reservas.'); return; }
      var duplicada = reservasAtivas.some(function(reserva) {
        return reserva.idItem === lote.idItem && reserva.idLote === lote.idLote && reserva.accessionNumber === (item.accessionNumber || lote.accessionNumber || '') &&
          norm(reserva.participante) === norm(item.participante) && norm(reserva.visitaPrevista) === norm(item.visitaPrevista);
      });
      if (duplicada) { ignorados.push('Linha ' + numeroLinha + ': reserva já existente para o participante e visita.'); return; }
      var qtdeFisica = Number(lote.qtde || 0) || 0;
      var qtdeReservada = reservasAtivas.filter(function(reserva) {
        return reserva.idItem === lote.idItem && reserva.idLote === lote.idLote && reserva.accessionNumber === (item.accessionNumber || lote.accessionNumber || '');
      }).reduce(function(total, reserva) { return total + Number(reserva.qtde || 0); }, 0);
      if (item.qtde > Math.max(0, qtdeFisica - qtdeReservada)) {
        avisos.push('Linha ' + numeroLinha + ': quantidade acima do saldo de sistema no Laboratório; conferir fisicamente.');
      }
      var observacoes = ['Migração operacional', 'Conferência física pendente'].concat(item.observacoes ? [item.observacoes] : []).join(' · ');
      linhas.push([
        gerarIdLoteEstoque_(), new Date(), item.agendaId, item.projeto, item.participante, lote.idItem, lote.idLote,
        lote.descricao, parseDateBrOrBlank_(item.validade || lote.validade) || item.validade || lote.validade, 'Laboratório', item.qtde,
        'Reservado', parseDateBrOrBlank_(item.dataVisita) || item.dataVisita, responsavel, observacoes, item.participanteId,
        item.visitaPrevista, item.accessionNumber || lote.accessionNumber || ''
      ]);
      reservasAtivas.push({ idItem: lote.idItem, idLote: lote.idLote, accessionNumber: item.accessionNumber || lote.accessionNumber || '', participante: item.participante, visitaPrevista: item.visitaPrevista, qtde: item.qtde });
    });
    if (linhas.length) reservasSheet.getRange(reservasSheet.getLastRow() + 1, 1, linhas.length, KIT_RESERVA_HEADERS_.length).setValues(linhas);
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return { ok: true, importados: linhas.length, ignorados: ignorados, erros: erros, avisos: avisos, msg: linhas.length + ' reserva(s) importada(s).' };
  });
}

function getKitReservasResumo_() {
  var out = {};
  getKitReservasLinhas_().forEach(function(r) {
    if (normText_(r.status || 'Reservado') !== 'reservado') return;
    var chave = kitReservaChave_(r.idItem, r.idLote, r.validade, r.localizacao, r.accessionNumber);
    out[chave] = Number(out[chave] || 0) + r.qtde;
  });
  return out;
}

function estoqueEhLaboratorio_(localizacao) {
  return estoqueLocalKey_(localizacao).indexOf('laboratorio') >= 0;
}

function estoqueTipoEhKit_(tipo) {
  return normText_(tipo).indexOf('kit') >= 0;
}

function getKitReservasPainel_() {
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  var limiteProximas = new Date(hoje.getTime());
  limiteProximas.setDate(limiteProximas.getDate() + 14);
  return getKitReservasLinhas_().filter(function(reserva) {
    return normText_(reserva.status || 'Reservado') === 'reservado';
  }).map(function(reserva) {
    var validade = parseDateBrOrBlank_(reserva.validade);
    var visita = parseAgendaDateAny_(reserva.dataVisita);
    if (validade && !isNaN(validade.getTime())) validade.setHours(0, 0, 0, 0);
    if (visita && !isNaN(visita.getTime())) visita.setHours(0, 0, 0, 0);
    var validadeMinima = visita && !isNaN(visita.getTime()) ? new Date(visita.getTime()) : null;
    if (validadeMinima) validadeMinima.setDate(validadeMinima.getDate() + 10);
    var vencida = !!(validade && validade < hoje);
    var validadeInsuficiente = !!(validadeMinima && (!validade || validade < validadeMinima));
    var proxima = !!(visita && visita >= hoje && visita <= limiteProximas);
    return {
      idReserva: reserva.idReserva,
      agendaId: reserva.agendaId,
      projeto: reserva.projeto,
      participante: reserva.participante,
      participanteId: reserva.participanteId,
      visitaPrevista: reserva.visitaPrevista,
      idItem: reserva.idItem,
      idLote: reserva.idLote,
      descricao: reserva.descricao,
      validade: reserva.validade,
      localizacao: reserva.localizacao,
      qtde: reserva.qtde,
      dataVisita: reserva.dataVisita,
      responsavel: reserva.responsavel,
      observacoes: reserva.observacoes,
      accessionNumber: reserva.accessionNumber,
      noLaboratorio: estoqueEhLaboratorio_(reserva.localizacao),
      proxima: proxima,
      vencida: vencida,
      validadeInsuficiente: validadeInsuficiente,
      semVisitaConciliada: !String(reserva.agendaId || '').trim()
    };
  });
}

function atualizarReservasPorLote_(payload) {
  payload = payload || {};
  var idItem = String(payload.idItem || '').trim();
  var idLote = String(payload.idLote || '').trim();
  var accessionNumber = String(payload.accessionNumber || '').trim();
  var localizacao = estoqueLocalKey_(payload.localizacao);
  var novoStatus = String(payload.novoStatus || '').trim();
  var quantidade = Math.max(0, Number(payload.qtde || 0) || 0);
  if (!idItem || !idLote || !novoStatus || !quantidade) return 0;
  var sheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Reservas_Kits', 'Reservas de Kits']);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, KIT_RESERVA_HEADERS_.length).getValues();
  var atualizados = 0;
  var observacao = String(payload.observacao || '').trim();
  for (var i = 0; i < rows.length && quantidade > 0; i++) {
    var row = rows[i] || [];
    if (String(row[5] || '').trim() !== idItem || String(row[6] || '').trim() !== idLote) continue;
    if (accessionNumber && String(row[17] || '').trim() !== accessionNumber) continue;
    if (localizacao && estoqueLocalKey_(row[9]) !== localizacao) continue;
    if (normText_(row[11] || 'Reservado') !== 'reservado') continue;
    var rowQty = Math.max(0, Number(row[10] || 0) || 0);
    if (!rowQty) continue;
    var retirar = Math.min(rowQty, quantidade);
    if (retirar === rowQty) {
      sheet.getRange(i + 2, 12).setValue(novoStatus);
      if (observacao) sheet.getRange(i + 2, 15).setValue(String(row[14] || '') + ' · ' + observacao);
    } else {
      sheet.getRange(i + 2, 11).setValue(rowQty - retirar);
      var historico = row.slice(0, KIT_RESERVA_HEADERS_.length);
      historico[0] = gerarIdLoteEstoque_();
      historico[1] = new Date();
      historico[10] = retirar;
      historico[11] = novoStatus;
      historico[14] = String(historico[14] || '') + (observacao ? ' · ' + observacao : '');
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, KIT_RESERVA_HEADERS_.length).setValues([historico]);
    }
    quantidade -= retirar;
    atualizados++;
  }
  return atualizados;
}

function cancelarReservaKitAgenda(payload) {
  codexAssertCanWrite_('cancelarReservaKitAgenda', 'Estoque', payload && payload.idReserva);
  return codexWithDocumentLock_('cancelarReservaKitAgenda', function() {
    payload = payload || {};
    var idReserva = String(payload.idReserva || '').trim();
    var justificativa = String(payload.motivo || payload.justificativa || '').trim();
    if (!idReserva) throw new Error('Reserva não informada.');
    if (!justificativa) throw new Error('Informe a justificativa do cancelamento.');
    var sheet = getKitReservasSheet_();
    if (sheet.getLastRow() < 2) throw new Error('Reserva não encontrada.');
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, KIT_RESERVA_HEADERS_.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() !== idReserva) continue;
      if (normText_(rows[i][11] || '') !== 'reservado') throw new Error('Somente reservas ativas podem ser canceladas.');
      sheet.getRange(i + 2, 12).setValue('Cancelada');
      sheet.getRange(i + 2, 15).setValue(String(rows[i][14] || '') + ' · Cancelamento: ' + justificativa);
      SpreadsheetApp.flush();
      CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
      var resultado = { ok: true, idReserva: idReserva, status: 'Cancelada', msg: 'Reserva cancelada. Se o kit estiver no Laboratório, faça a devolução física separadamente.' };
      if (payload.retornarJornada) resultado.jornada = getJornadaParticipante({
        nome: String(rows[i][4] || ''), idParticipante: String(rows[i][15] || ''),
        projeto: String(rows[i][3] || ''), braco: payload.braco || ''
      });
      return resultado;
    }
    throw new Error('Reserva não encontrada.');
  });
}

function ajustarReservaKitAgenda(payload) {
  codexAssertCanWrite_('ajustarReservaKitAgenda', 'Estoque', payload && payload.idReserva);
  return codexWithDocumentLock_('ajustarReservaKitAgenda', function() {
    payload = payload || {};
    var idReserva = String(payload.idReserva || '').trim();
    var justificativa = String(payload.justificativa || payload.motivo || '').trim();
    var novaQuantidade = Number(payload.qtde);
    if (!idReserva) throw new Error('Reserva não informada.');
    if (!justificativa) throw new Error('Informe a justificativa do ajuste.');
    if (!isFinite(novaQuantidade) || novaQuantidade <= 0 || novaQuantidade % 1 !== 0) throw new Error('Informe uma quantidade inteira maior que zero.');
    var sheet = getKitReservasSheet_();
    if (sheet.getLastRow() < 2) throw new Error('Reserva não encontrada.');
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, KIT_RESERVA_HEADERS_.length).getValues();
    var linha = -1;
    var reserva = null;
    rows.forEach(function(row, index) {
      if (String(row[0] || '').trim() === idReserva) { linha = index + 2; reserva = row; }
    });
    if (linha < 2 || !reserva) throw new Error('Reserva não encontrada.');
    if (normText_(reserva[11] || '') !== 'reservado') throw new Error('Somente reservas ativas podem ser ajustadas.');
    var quantidadeAnterior = Number(reserva[10] || 0) || 0;
    if (novaQuantidade === quantidadeAnterior) throw new Error('A nova quantidade é igual à quantidade atual.');
    var estoque = getEstoque() || [];
    var lote = estoque.filter(function(item) {
      return String(item.idItem || '').trim() === String(reserva[5] || '').trim() &&
        String(item.idLote || '').trim() === String(reserva[6] || '').trim() &&
        estoqueLocalKey_(item.localizacao) === estoqueLocalKey_(reserva[9]);
    })[0];
    if (!lote) throw new Error('O lote da reserva não foi localizado no estoque.');
    var resumo = getKitReservasResumo_();
    var chave = kitReservaChave_(lote.idItem, lote.idLote, lote.validade, lote.localizacao, lote.accessionNumber);
    var disponivelSemAtual = Math.max(0, Number(lote.qtde || 0) - Number(resumo[chave] || 0) + quantidadeAnterior);
    if (novaQuantidade > disponivelSemAtual) throw new Error('Saldo insuficiente para aumentar a reserva. Disponível para esta reserva: ' + disponivelSemAtual + '.');
    sheet.getRange(linha, 11).setValue(novaQuantidade);
    sheet.getRange(linha, 15).setValue(String(reserva[14] || '') + ' · Quantidade ajustada de ' + quantidadeAnterior + ' para ' + novaQuantidade + ': ' + justificativa);
    var historico = reserva.slice(0, KIT_RESERVA_HEADERS_.length);
    historico[0] = gerarIdLoteEstoque_();
    historico[1] = new Date();
    historico[10] = quantidadeAnterior;
    historico[11] = 'Ajustada';
    historico[14] = 'Quantidade anterior: ' + quantidadeAnterior + ' · Nova quantidade: ' + novaQuantidade + ' · ' + justificativa;
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, KIT_RESERVA_HEADERS_.length).setValues([historico]);
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    var resultado = { ok: true, idReserva: idReserva, quantidadeAnterior: quantidadeAnterior, quantidade: novaQuantidade, msg: 'Quantidade da reserva ajustada.' };
    if (payload.retornarJornada) resultado.jornada = getJornadaParticipante({
      nome: String(reserva[4] || ''), idParticipante: String(reserva[15] || ''),
      projeto: String(reserva[3] || ''), braco: payload.braco || ''
    });
    return resultado;
  });
}

function cancelarReservasKitsAgenda_(agendaId, justificativa) {
  agendaId = String(agendaId || '').trim();
  justificativa = String(justificativa || 'Cancelamento da visita na Agenda').trim();
  if (!agendaId) return 0;
  var sheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Reservas_Kits', 'Reservas de Kits']);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, KIT_RESERVA_HEADERS_.length).getValues();
  var atualizados = 0;
  rows.forEach(function(row, index) {
    if (String(row[2] || '').trim() !== agendaId || normText_(row[11] || '') !== 'reservado') return;
    sheet.getRange(index + 2, 12).setValue('Cancelada');
    sheet.getRange(index + 2, 15).setValue(String(row[14] || '') + ' · Cancelamento da visita na Agenda: ' + justificativa);
    atualizados++;
  });
  return atualizados;
}

function substituirReservaKitAgenda(payload) {
  codexAssertCanWrite_('substituirReservaKitAgenda', 'Estoque', payload && payload.idReserva);
  return codexWithDocumentLock_('substituirReservaKitAgenda', function() {
    payload = payload || {};
    var idReserva = String(payload.idReserva || '').trim();
    var novoLoteId = String(payload.novoIdLote || payload.idLote || '').trim();
    var justificativa = String(payload.justificativa || payload.motivo || '').trim();
    var quantidadeSolicitada = Number(payload.qtde || 0);
    if (!idReserva || !novoLoteId) throw new Error('Informe a reserva e o novo lote.');
    if (!justificativa) throw new Error('Informe a justificativa da substituição.');
    var sheet = getKitReservasSheet_();
    if (sheet.getLastRow() < 2) throw new Error('Reserva não encontrada.');
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, KIT_RESERVA_HEADERS_.length).getValues();
    var linha = -1;
    var reserva = null;
    rows.forEach(function(row, index) {
      if (String(row[0] || '').trim() === idReserva) { linha = index + 2; reserva = row; }
    });
    if (linha < 2 || !reserva) throw new Error('Reserva não encontrada.');
    if (normText_(reserva[11] || '') !== 'reservado') throw new Error('Somente reservas ativas podem ter o lote substituído.');
    if (String(reserva[6] || '').trim() === novoLoteId) throw new Error('Selecione um lote diferente do atual.');
    var estoque = getEstoque() || [];
    var novo = estoque.filter(function(item) {
      return String(item.idItem || '').trim() === String(reserva[5] || '').trim() && String(item.idLote || '').trim() === novoLoteId;
    })[0];
    if (!novo) throw new Error('O novo lote não foi localizado no estoque.');
    var visita = parseAgendaDateAny_(reserva[12]);
    var validade = parseDateBrOrBlank_(novo.validade);
    if (!visita || !validade) throw new Error('A reserva e o novo lote precisam ter datas válidas.');
    visita.setHours(0, 0, 0, 0);
    var validadeMinima = new Date(visita.getTime());
    validadeMinima.setDate(validadeMinima.getDate() + 10);
    if (validade < validadeMinima) throw new Error('O novo lote não possui validade suficiente para a visita prevista.');
    var chave = kitReservaChave_(novo.idItem, novo.idLote, novo.validade, novo.localizacao, novo.accessionNumber);
    var reservado = Number(getKitReservasResumo_()[chave] || 0);
    var disponivel = Math.max(0, Number(novo.qtde || 0) - reservado);
    var quantidade = quantidadeSolicitada > 0 ? quantidadeSolicitada : (Number(reserva[10] || 0) || 0);
    if (!isFinite(quantidade) || quantidade % 1 !== 0) throw new Error('Informe uma quantidade inteira válida para a nova reserva.');
    if (quantidade <= 0 || quantidade > disponivel) throw new Error('Saldo insuficiente no novo lote para substituir a reserva.');
    var agora = new Date();
    sheet.getRange(linha, 12).setValue('Substituída');
    sheet.getRange(linha, 15).setValue(String(reserva[14] || '') + ' · Substituída pelo lote ' + novoLoteId + ': ' + justificativa);
    var novaLinha = [
      gerarIdLoteEstoque_(), agora, reserva[2], reserva[3], reserva[4], novo.idItem, novo.idLote,
      novo.descricao, parseDateBrOrBlank_(novo.validade) || novo.validade, novo.localizacao, quantidade,
      'Reservado', visita, reserva[13], 'Substituição da reserva ' + idReserva + ': ' + justificativa, reserva[15], reserva[16],
      String(novo.accessionNumber || '')
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, KIT_RESERVA_HEADERS_.length).setValues([novaLinha]);
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    var resultado = { ok: true, antiga: idReserva, nova: novaLinha[0], msg: 'Lote substituído e nova reserva criada.' };
    if (payload.retornarJornada) resultado.jornada = getJornadaParticipante({
      nome: String(novaLinha[4] || ''), idParticipante: String(novaLinha[15] || ''),
      projeto: String(novaLinha[3] || ''), braco: payload.braco || ''
    });
    return resultado;
  });
}

function registrarExcecaoKitEstoque(payload) {
  codexAssertCanWrite_('registrarExcecaoKitEstoque', 'Estoque', payload && payload.idItem);
  return codexWithDocumentLock_('registrarExcecaoKitEstoque', function() {
    payload = payload || {};
    var tipo = normText_(payload.tipo || '').replace(/\s+/g, '');
    var tipos = { perda: { status: 'Perdido', movimento: 'Saída - Perda' }, descarte: { status: 'Descartado', movimento: 'Saída - Descarte' }, vencimento: { status: 'Vencido', movimento: 'Saída - Vencimento' } };
    if (!tipos[tipo]) throw new Error('Tipo de exceção inválido.');
    var idItem = String(payload.idItem || '').trim();
    var idLote = String(payload.idLote || '').trim();
    var quantidade = Number(payload.qtde || 0);
    if (!idItem || !idLote || !isFinite(quantidade) || quantidade <= 0) throw new Error('Informe item, lote e quantidade.');
    var sheet = getSheetByPossibleNames_(SpreadsheetApp.getActiveSpreadsheet(), ['Estoque']);
    if (!sheet) throw new Error('Aba "Estoque" não encontrada.');
    var map = ensureEstoqueLoteIdColumn_(sheet);
    var rows = sheet.getDataRange().getValues();
    var rowIndex = -1;
    var row = null;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][map.idItem] || '').trim() !== idItem || String(rows[i][map.idLote] || '').trim() !== idLote) continue;
      if (payload.localizacao && estoqueLocalKey_(rows[i][map.localizacao]) !== estoqueLocalKey_(payload.localizacao)) continue;
      rowIndex = i + 1; row = rows[i]; break;
    }
    if (rowIndex < 2 || !row) throw new Error('Item/lote não encontrado no estoque.');
    var saldo = Number(row[map.qtde] || 0) || 0;
    if (quantidade > saldo) throw new Error('Quantidade maior que o saldo físico do lote.');
    if (tipo === 'vencimento') {
      var validade = parseDateBrOrBlank_(row[map.validade]);
      var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      if (!validade || validade >= hoje) throw new Error('O lote ainda não está vencido; registre perda ou descarte se necessário.');
    }
    registrarMovimentacaoEstoque({
      estoqueRow: rowIndex, idItem: idItem, idLote: idLote, qtde: quantidade,
      tipoMovimento: tipos[tipo].movimento, descricao: row[map.descricao] || '', tipoItem: row[map.tipo] || '',
      projeto: row[map.projeto] || '', validade: row[map.validade] || '', localizacao: row[map.localizacao] || '',
      accessionNumber: row[map.accessionNumber] || '',
      origem: 'Exceção operacional', observacao: String(payload.motivo || '')
    });
    if (quantidade >= saldo && map.status >= 0) sheet.getRange(rowIndex, map.status + 1).setValue(tipos[tipo].status);
    var reservasAtualizadas = atualizarReservasPorLote_({ idItem: idItem, idLote: idLote, accessionNumber: row[map.accessionNumber], localizacao: row[map.localizacao], qtde: quantidade, novoStatus: tipos[tipo].status, observacao: tipos[tipo].status + ' · ' + String(payload.motivo || 'Exceção operacional') });
    SpreadsheetApp.flush();
    return { ok: true, tipo: tipo, quantidade: quantidade, reservasAtualizadas: reservasAtualizadas, msg: 'Exceção registrada: ' + tipos[tipo].status + '.' };
  });
}

function getKitsAgendaReservaStatus(agendaId) {
  agendaId = String(agendaId || '').trim();
  if (!agendaId) return { reservado: false, reservas: [] };
  var todas = getKitReservasLinhas_().filter(function(r) { return r.agendaId === agendaId; });
  var reservas = todas.filter(function(r) {
    return normText_(r.status || 'Reservado') === 'reservado';
  });
  var historico = todas.filter(function(r) {
    return ['baixado', 'consumido', 'cancelada', 'perdido', 'descartado', 'vencido'].indexOf(normText_(r.status || '')) >= 0;
  });
  return { reservado: reservas.length > 0, encerrado: historico.length > 0, reservas: reservas };
}

function reservarKitsAgendaEvento(payload) {
  codexAssertCanWrite_('reservarKitsAgendaEvento', 'Estoque', payload && payload.agendaId);
  return codexWithDocumentLock_('reservarKitsAgendaEvento', function() {
    payload = payload || {};
    var agendaId = String(payload.agendaId || '').trim();
    var kits = Array.isArray(payload.kits) ? payload.kits : [];
    if (!agendaId) throw new Error('Agendamento nao informado.');
    if (!kits.length) throw new Error('Nenhum kit selecionado para reserva.');
    var visita = parseAgendaDateAny_(payload.data);
    if (!visita || isNaN(visita.getTime())) throw new Error('Informe uma data valida para a visita.');
    visita.setHours(0, 0, 0, 0);
    var validadeMinima = new Date(visita.getTime());
    validadeMinima.setDate(validadeMinima.getDate() + 10);
    var statusAtual = getKitsAgendaReservaStatus(agendaId);
    if (statusAtual.reservado) throw new Error('Esta visita ja possui kits reservados.');
    var participanteId = String(payload.participanteId || '').trim();
    if (!participanteId) {
      try {
        var agendaSheet = getAgendaSheetForRead_();
        var agendaRows = agendaSheet && agendaSheet.getLastRow() > 1
          ? agendaSheet.getRange(2, 1, agendaSheet.getLastRow() - 1, AGENDA_CFG.lastCol).getValues()
          : [];
        for (var agendaIndex = 0; agendaIndex < agendaRows.length; agendaIndex++) {
          if (String(agendaRows[agendaIndex][AGENDA_CFG.idx.id] || '').trim() !== agendaId) continue;
          participanteId = String(agendaRows[agendaIndex][AGENDA_CFG.idx.idParticipante] || '').trim();
          break;
        }
      } catch (e) {}
    }
    var estoque = getEstoque() || [];
    var reservasResumo = getKitReservasResumo_();
    var sheet = getKitReservasSheet_();
    var responsavel = Session.getActiveUser().getEmail() || '';
    var linhas = [];
    kits.forEach(function(kit) {
      var idItem = String(kit.idItem || '').trim();
      var idLote = String(kit.idLote || '').trim();
      var qtd = Number(kit.qtde || 1);
      if (!idItem || !idLote || !isFinite(qtd) || qtd <= 0) throw new Error('Kit sem lote ou quantidade valida para reserva.');
      var lote = estoque.filter(function(item) { return String(item.idItem || '') === idItem && String(item.idLote || '') === idLote; })[0];
      if (!lote) throw new Error('Lote selecionado nao foi localizado no estoque.');
      var validade = parseDateBrOrBlank_(lote.validade);
      if (!validade || isNaN(validade.getTime()) || validade < validadeMinima) {
        throw new Error('O lote ' + String(lote.descricao || idItem) + ' nao possui validade suficiente para a data da visita.');
      }
      var chave = kitReservaChave_(lote.idItem, lote.idLote, lote.validade, lote.localizacao, lote.accessionNumber);
      var disponivel = Math.max(0, Number(lote.qtde || 0) - Number(reservasResumo[chave] || 0));
      if (qtd > disponivel) throw new Error('Saldo disponivel insuficiente para reservar ' + String(lote.descricao || idItem) + '.');
      reservasResumo[chave] = Number(reservasResumo[chave] || 0) + qtd;
      linhas.push([
        gerarIdLoteEstoque_(), new Date(), agendaId, payload.projeto || lote.projeto || '', payload.participante || '',
        lote.idItem, lote.idLote, lote.descricao, parseDateBrOrBlank_(lote.validade) || lote.validade,
        lote.localizacao, qtd, 'Reservado', visita, responsavel, payload.observacoes || '',
        participanteId, payload.visita || '', String(kit.accessionNumber || lote.accessionNumber || '')
      ]);
    });
    if (linhas.length) sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, KIT_RESERVA_HEADERS_.length).setValues(linhas);
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return { ok: true, reservados: linhas.length, msg: linhas.length + ' kit(s) reservado(s) para a visita.' };
  });
}

function getEstoquePedidosPendentesPorItem_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shPedidos = getSheetByPossibleNames_(ss, ['Pedidos', 'Cadastro de Pedidos']);
  var sh = getSheetByPossibleNames_(ss, ['Pedidos_Itens', 'Pedido_Itens', 'Pedido Itens', 'Itens do Pedido']);
  var out = {};
  if (!shPedidos || shPedidos.getLastRow() < 2 || !sh || sh.getLastRow() < 2) return out;

  var pedidosElegiveis = {};
  var pedidosRows = shPedidos.getDataRange().getValues();
  for (var p = 1; p < pedidosRows.length; p++) {
    var pedidoId = String(pedidosRows[p][0] || '').trim();
    if (!pedidoId) continue;
    var statusPedido = String(pedidosRows[p][6] || 'Pendente')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    // Planejamentos ainda não são pedidos efetivamente realizados e não devem
    // compor a quantidade pedida exibida no estoque.
    pedidosElegiveis[pedidoId] = statusPedido.indexOf('planej') < 0 &&
      statusPedido.indexOf('cancel') < 0 && statusPedido.indexOf('rascunho') < 0;
  }

  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var idPedido = String(r[0] || '').trim();
    if (!pedidosElegiveis[idPedido]) continue;
    var idItem = String(r[5] || '').trim();
    if (!idItem) continue;
    var pendente = Math.max(0, (Number(r[6] || 0) || 0) - (Number(r[7] || 0) || 0));
    if (!pendente) continue;
    if (!out[idItem]) out[idItem] = { quantidade: 0, numerosPedido: [] };
    out[idItem].quantidade += pendente;
    var numeroPedido = String(r[1] || '').trim();
    if (numeroPedido && out[idItem].numerosPedido.indexOf(numeroPedido) < 0) {
      out[idItem].numerosPedido.push(numeroPedido);
    }
  }
  return out;
}

function getEstoqueVisualizacao() {
  var catalogo = getItensEstoque().itens || [];
  var estoque = getEstoqueLinhas_() || [];
  var reservas = getKitReservasResumo_();
  var reservasPainel = getKitReservasPainel_();
  var pendentes = getEstoquePedidosPendentesPorItem_();
  var lotesPorItem = {};
  var reservasPorItem = {};
  var ordemIdsEstoque = [];

  reservasPainel.forEach(function(reserva) {
    var id = String(reserva.idItem || '').trim();
    if (!id) return;
    if (!reservasPorItem[id]) reservasPorItem[id] = [];
    reservasPorItem[id].push(reserva);
  });

  estoque.forEach(function(lote) {
    var ids = String(lote.idItem || '').split(/\s*,\s*/).filter(Boolean);
    if (!ids.length) ids = ['__SEM_ID__' + ordemIdsEstoque.length];
    ids.forEach(function(id) {
      if (!lotesPorItem[id]) {
        lotesPorItem[id] = [];
        ordemIdsEstoque.push(id);
      }
      var reservaChave = kitReservaChave_(lote.idItem, lote.idLote, lote.validade, lote.localizacao, lote.accessionNumber);
      var qtdeFisica = Number(lote.qtde || 0) || 0;
      var qtdeReservada = Number(reservas[reservaChave] || 0);
      lotesPorItem[id].push({
        projeto: lote.projeto || '',
        descricao: lote.descricao || '',
        tipoItem: lote.tipoItem || '',
        validade: lote.validade || '',
        localizacao: lote.localizacao || '',
        qtde: qtdeFisica,
        qtdeFisica: qtdeFisica,
        qtdeReservada: qtdeReservada,
        qtdeDisponivel: Math.max(0, qtdeFisica - qtdeReservada),
        estoqueMinimo: lote.estoqueMinimo,
        status: lote.status || '',
        qtdePedidaPendente: lote.qtdePedidaPendente,
        numeroPedido: lote.numeroPedido || '',
        idLote: lote.idLote || '',
        accessionNumber: lote.accessionNumber || '',
        ultimaAlteracao: lote.ultimaAlteracao || '',
        responsavel: lote.responsavel || '',
        observacoes: lote.observacoes || '',
        detalhesVisita: lote.detalhesVisita || ''
      });
    });
  });

  function statusConsolidado(total, minimo) {
    total = Number(total || 0) || 0;
    minimo = Number(minimo || 0) || 0;
    if (total <= 0 || (minimo > 0 && total <= minimo)) return 'Crítico';
    if (minimo > 0 && total <= minimo * 1.5) return 'Estoque baixo';
    return 'OK';
  }

  function montarItem(item, id, lotes) {
    lotes = lotes || [];
    var reservasItem = reservasPorItem[id] || [];
    var total = lotes.reduce(function(soma, lote) {
      return soma + (Number(lote.qtde || 0) || 0);
    }, 0);
    var reservado = lotes.reduce(function(soma, lote) {
      return soma + (Number(lote.qtdeReservada || 0) || 0);
    }, 0);
    var minimo = item.estoqueMin !== undefined && item.estoqueMin !== ''
      ? Number(item.estoqueMin || 0) || 0
      : lotes.reduce(function(maior, lote) { return Math.max(maior, Number(lote.estoqueMinimo || 0) || 0); }, 0);
    var estoquePrincipal = lotes.reduce(function(soma, lote) {
      return soma + (estoqueEhLaboratorio_(lote.localizacao) ? 0 : (Number(lote.qtde || 0) || 0));
    }, 0);
    var estoqueLaboratorio = total - estoquePrincipal;
    var itemEhKit = estoqueTipoEhKit_(item.tipo || item.tipoItem || (lotes[0] && lotes[0].tipoItem) || '');
    var reservasLaboratorio = reservasItem.reduce(function(soma, reserva) {
      return soma + (reserva.noLaboratorio ? Number(reserva.qtde || 0) || 0 : 0);
    }, 0);
    var pedido = pendentes[id] || null;
    return {
      idItem: id.indexOf('__SEM_ID__') === 0 ? '' : id,
      projeto: item.projeto || '',
      descricao: item.descricao || '',
      tipoItem: item.tipo || item.tipoItem || '',
      laboratorio: item.laboratorio || '',
      observacoes: item.observacoes || '',
      detalhesVisita: item.detalhesVisita || '',
      cadastroStatus: item.status || '',
      estoqueMinimo: minimo,
      estoqueAtual: total,
      qtde: total,
      qtdeFisica: total,
      estoquePrincipal: estoquePrincipal,
      estoqueLaboratorio: estoqueLaboratorio,
      qtdeReservadaLaboratorio: reservasLaboratorio,
      qtdeNaoConciliadaLaboratorio: itemEhKit ? Math.max(0, estoqueLaboratorio - reservasLaboratorio) : 0,
      qtdeReservada: reservado,
      qtdeDisponivel: Math.max(0, total - reservado),
      status: statusConsolidado(itemEhKit ? estoquePrincipal : total, minimo),
      qtdePedidaPendente: pedido ? pedido.quantidade : 0,
      numerosPedidoPendente: pedido ? pedido.numerosPedido : [],
      lotes: lotes,
      reservasLaboratorio: reservasItem
    };
  }

  var vistos = {};
  var itens = catalogo.map(function(item) {
    var id = String(item.idItem || '').trim();
    vistos[id] = true;
    return montarItem(item, id, lotesPorItem[id] || []);
  });

  ordemIdsEstoque.forEach(function(id) {
    if (vistos[id]) return;
    var lotes = lotesPorItem[id] || [];
    var primeiro = lotes[0] || {};
    itens.push(montarItem({
      projeto: primeiro.projeto || '',
      descricao: primeiro.descricao || '',
      tipoItem: primeiro.tipoItem || '',
      laboratorio: '',
      observacoes: primeiro.observacoes || '',
      detalhesVisita: primeiro.detalhesVisita || '',
      estoqueMin: primeiro.estoqueMinimo || ''
    }, id, lotes));
  });

  function ordemTipo(item) {
    var tipo = String(item.tipoItem || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (tipo.indexOf('kit') >= 0) return 0;
    if (tipo.indexOf('bulk') >= 0) return 1;
    return 2;
  }

  itens.sort(function(a, b) {
    var projetoCmp = String(a.projeto || '').localeCompare(String(b.projeto || ''), 'pt-BR', { sensitivity: 'base' });
    if (projetoCmp) return projetoCmp;
    var tipoCmp = ordemTipo(a) - ordemTipo(b);
    if (tipoCmp) return tipoCmp;
    return [a.descricao, a.idItem].join('||').localeCompare(
      [b.descricao, b.idItem].join('||'), 'pt-BR', { sensitivity: 'base' }
    );
  });
  return itens;
}

function montarAlertasEstoque_(itens, reservas, kitsBaixados, hoje) {
  itens = itens || [];
  if (!reservas) {
    reservas = [];
    itens.forEach(function(item) {
      (item.reservasLaboratorio || []).forEach(function(reserva) { reservas.push(reserva); });
    });
  }
  kitsBaixados = kitsBaixados || [];
  hoje = hoje instanceof Date ? new Date(hoje.getTime()) : new Date();
  hoje.setHours(0, 0, 0, 0);
  var alertas = {
    reservasSemVisita: [],
    visitasProximas: [],
    validadeInsuficiente: [],
    kitsVencidos: [],
    kitsBaixadosSemConciliacao: []
  };
  var vistosReservas = {};

  function reservaDetalhe(reserva) {
    return {
      idReserva: String(reserva.idReserva || ''),
      projeto: String(reserva.projeto || ''),
      participante: String(reserva.participante || 'Participante não informado'),
      descricao: String(reserva.descricao || reserva.idItem || 'Kit'),
      visita: String(reserva.visitaPrevista || 'Visita não identificada'),
      dataVisita: String(reserva.dataVisita || ''),
      validade: String(reserva.validade || ''),
      qtde: Number(reserva.qtde || 0) || 0,
      localizacao: String(reserva.localizacao || '')
    };
  }

  (reservas || []).forEach(function(reserva) {
    if (!reserva || !reserva.idReserva || vistosReservas[reserva.idReserva]) return;
    vistosReservas[reserva.idReserva] = true;
    var detalhe = reservaDetalhe(reserva);
    if (reserva.semVisitaConciliada) alertas.reservasSemVisita.push(detalhe);
    if (reserva.proxima) alertas.visitasProximas.push(detalhe);
    if (reserva.validadeInsuficiente) alertas.validadeInsuficiente.push(detalhe);
  });

  itens.forEach(function(item) {
    if (!estoqueTipoEhKit_(item.tipoItem || item.tipo || '')) return;
    (item.lotes || []).forEach(function(lote) {
      var quantidade = Number(lote.qtdeFisica !== undefined ? lote.qtdeFisica : lote.qtde) || 0;
      var validade = parseDateBrOrBlank_(lote.validade);
      if (!quantidade || !validade || isNaN(validade.getTime())) return;
      validade.setHours(0, 0, 0, 0);
      if (validade >= hoje) return;
      alertas.kitsVencidos.push({
        projeto: String(item.projeto || ''),
        descricao: String(item.descricao || item.idItem || 'Kit'),
        validade: String(lote.validade || ''),
        localizacao: String(lote.localizacao || ''),
        qtde: quantidade,
        idLote: String(lote.idLote || '')
      });
    });
  });

  (kitsBaixados || []).forEach(function(kit) {
    if (!kit) return;
    alertas.kitsBaixadosSemConciliacao.push({
      projeto: String(kit.projeto || ''),
      descricao: String(kit.descricao || kit.idItem || 'Kit'),
      participante: String(kit.participante || 'Participante não identificado'),
      visita: String(kit.visita || kit.agendaId || 'Visita não identificada'),
      dataVisita: String(kit.dataVisita || ''),
      validade: String(kit.validade || ''),
      qtde: Number(kit.qtde || 0) || 0,
      idItem: String(kit.idItem || ''),
      idLote: String(kit.idLote || '')
    });
  });

  Object.keys(alertas).forEach(function(chave) {
    alertas[chave] = {
      count: alertas[chave].length,
      items: alertas[chave]
    };
  });
  alertas.total = Object.keys(alertas).reduce(function(total, chave) {
    return chave === 'total' ? total : total + Number(alertas[chave].count || 0);
  }, 0);
  return alertas;
}

function getKitsBaixadosSemConciliacao_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shMov = getSheetByPossibleNames_(ss, ['Movimentações', 'Entradas e Saídas de Itens']);
  if (!shMov || shMov.getLastRow() < 2) return [];
  var info = movimentacoesHeaderInfo_(shMov);
  var map = info.map || {};
  var headerRow = info.row || 1;
  var lastColumn = Math.max(shMov.getLastColumn(), 17);
  var rows = shMov.getRange(headerRow + 1, 1, shMov.getLastRow() - headerRow, lastColumn).getValues();
  var reservas = getKitReservasLinhas_();
  var out = [];
  var vistos = {};
  function cell(row, key, fallback) {
    return map[key] !== undefined ? row[map[key]] : row[fallback];
  }
  function texto(row, key, fallback) {
    return String(cell(row, key, fallback) || '').trim();
  }
  function numero(row, key, fallback) {
    return Number(cell(row, key, fallback) || 0) || 0;
  }
  function reservaConciliada(agendaId, idItem, idLote) {
    return reservas.some(function(reserva) {
      if (String(reserva.agendaId || '').trim() !== agendaId) return false;
      if (String(reserva.idItem || '').trim() !== idItem) return false;
      if (idLote && String(reserva.idLote || '').trim() && String(reserva.idLote || '').trim() !== idLote) return false;
      return ['baixado', 'consumido'].indexOf(normText_(reserva.status || '')) >= 0;
    });
  }
  rows.forEach(function(row) {
    var idItem = texto(row, 'iditem', 3);
    var agendaId = texto(row, 'agendaid', 17);
    var acao = normText_(texto(row, 'agendakitacao', 18));
    var tipo = normText_(texto(row, 'tipodemovimento', 2));
    var origem = texto(row, 'origem', 15);
    if (!idItem || (acao !== 'baixa' && !(tipo.indexOf('saida') >= 0 && origem.indexOf('Agenda kit ') === 0))) return;
    if (!agendaId) {
      var match = origem.match(/^Agenda kit\s+([^\s]+)/i);
      agendaId = match ? String(match[1] || '').trim() : '';
    }
    var idLote = texto(row, 'lote', 10);
    var key = [agendaId, idItem, idLote].join('|');
    if (vistos[key] || reservaConciliada(agendaId, idItem, idLote)) return;
    vistos[key] = true;
    out.push({
      agendaId: agendaId,
      idItem: idItem,
      idLote: idLote,
      projeto: texto(row, 'projeto', 6),
      descricao: texto(row, 'descricao', 4),
      participante: texto(row, 'participante', 12),
      visita: texto(row, 'idvisita', 13),
      dataVisita: texto(row, 'data', 1),
      validade: texto(row, 'validade', 8),
      qtde: numero(row, 'qtde', 7)
    });
  });
  return out;
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
      norm(it.status),
      norm(it.idLote),
      norm(it.accessionNumber)
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
    'Origem', 'Observa\u00e7\u00e3o', 'Agenda_ID', 'Agenda_Kit_Acao', 'Accession_Number'
  ]);
  sh.setFrozenRows(1);
  return sh;
}

function movimentacoesHeaderInfo_(sh) {
  var values = sh.getDataRange().getDisplayValues();
  for (var r = 0; r < values.length; r++) {
    var map = {};
    for (var c = 0; c < values[r].length; c++) {
      var key = normalizeHeader_(values[r][c]);
      if (key) map[key] = c;
    }
    if (map.idmov !== undefined && (map.tipodemovimento !== undefined || map.descricao !== undefined)) {
      return { row: r + 1, map: map };
    }
  }
  return { row: 1, map: {} };
}

function ensureMovimentacoesAgendaMetadataColumns_(sh) {
  var info = movimentacoesHeaderInfo_(sh);
  var map = info.map || {};
  var headerRow = info.row || 1;
  var lastCol = Math.max(sh.getLastColumn(), 17);

  function ensureHeader(key, label) {
    if (map[key] !== undefined) return map[key];
    lastCol++;
    sh.getRange(headerRow, lastCol).setValue(label);
    map[key] = lastCol - 1;
    return map[key];
  }

  ensureHeader('agendaid', 'Agenda_ID');
  ensureHeader('agendakitacao', 'Agenda_Kit_Acao');
  return map;
}

function ensureMovimentacoesAccessionColumn_(sh) {
  var info = movimentacoesHeaderInfo_(sh);
  var map = info.map || {};
  if (map.accessionnumber !== undefined) return map;
  var headerRow = info.row || 1;
  var target = sh.getLastColumn() + 1;
  sh.getRange(headerRow, target).setValue('Accession_Number');
  map.accessionnumber = target - 1;
  return map;
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
        accessionNumber: String(firstNonEmpty_(r, [col.accessionnumber, -1]) || '').trim(),
        idParticipante: String(firstNonEmpty_(r, [col.idparticipante, 11]) || ''),
        participante: String(firstNonEmpty_(r, [col.participante, 12]) || ''),
        idVisita: String(firstNonEmpty_(r, [col.idvisita, 13]) || ''),
        responsavel: String(firstNonEmpty_(r, [col.responsavel, 14]) || ''),
        origem: String(firstNonEmpty_(r, [col.origem, 15]) || ''),
        observacao: String(firstNonEmpty_(r, [col.observacao, 16]) || '')
      });
    }
    diag.headerRow = headerIndex + 1;
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
  return getProjetoOptions_();
}

function getSolicitantesEquipamentos_() {
  var sh = getSheetByPossibleNames_(getCodexSpreadsheet_(), ['🙋 Solicitantes', 'Solicitantes']);
  var seen = {};
  return getCodexSheetDataFromSheet_(sh).slice(1).map(function(r) {
    return String(r[1] || '').trim();
  }).filter(function(nome) {
    if (!nome || seen[nome]) return false;
    seen[nome] = 1;
    return true;
  }).sort();
}

function getEquipamentosFornecidos() {
  var ss = getCodexSpreadsheet_();
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
  codexAssertCanWrite_('salvarEquipamentoFornecido', 'Cadastros', payload && (payload.id || payload.rowIndex));
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
  codexAssertCanWrite_('excluirEquipamentoFornecido', 'Cadastros', rowIndex);
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
  var ss = getCodexSpreadsheet_();
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
  codexAssertCanWrite_('salvarMedicamentoRecebido', 'Cadastros', payload && (payload.id || payload.rowIndex));
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
// AGENDA WEBAPP V1 - estrutura atual com 52 colunas
// Mantem a documentacao de transporte separada.
// ============================================================================
var AGENDA_CFG = {
  abaNomes: ['\uD83D\uDCC5 Agenda', 'Agenda'],
  lastCol: 52,
  col: {
    id: 1, data: 2, hora: 3, tipo: 4, status: 5, participante: 6,
    nasc: 7, idParticipante: 8, projeto: 9, braco: 10, visita: 11,
    medico: 12, procedimentos: 13, servTerc: 14, obs: 15,
    labCentral: 16, controle: 17, kit: 18, reqStatus: 45, monitorName: 46,
    poloTrial: 47, ecrf: 48, salaMonitoria: 49, carroRequerido: 50,
    backupAgendaRef: 51, backupTemperatura: 52
  },
  idx: {
    id: 0, data: 1, hora: 2, tipo: 3, status: 4, participante: 5,
    nasc: 6, idParticipante: 7, projeto: 8, braco: 9, visita: 10,
    medico: 11, procedimentos: 12, servTerc: 13, obs: 14,
    labCentral: 15, controle: 16, kit: 17,
    c1: { nome: 18, temp: 19, status: 20, awb: 21, material: 22, destino: 36, matBio: 40 },
    c2: { nome: 23, temp: 24, status: 25, awb: 26, material: 27, destino: 37, matBio: 41 },
    c3: { nome: 28, temp: 29, status: 30, awb: 31, material: 32, destino: 38, matBio: 42 },
    cb: { nome: 33, status: 34, material: 35, destino: 39, matBio: 43, temp: 51 },
    reqStatus: 44, monitorName: 45, poloTrial: 46, ecrf: 47, salaMonitoria: 48, carroRequerido: 49,
    backupAgendaRef: 50
  }
};

var CFG = typeof CFG !== 'undefined' ? CFG : {
  abaNome: '\uD83D\uDCC5 Agenda',
  lastCol: 52,
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
  var ss = getCodexSpreadsheet_();
  var sh = getSheetByPossibleNames_(ss, AGENDA_CFG.abaNomes);
  if (!sh) throw new Error('Aba Agenda nao encontrada.');
  ensureAgendaDestinoLabColumns_(sh);
  alinharStatusRequisicaoLegadoAgenda_(sh);
  return sh;
}

function getAgendaSheetForRead_() {
  var sh = getSheetByPossibleNames_(getCodexSpreadsheet_(), AGENDA_CFG.abaNomes);
  if (!sh) throw new Error('Aba Agenda nao encontrada.');
  agendaResolveBackupTemperaturaColumnForRead_(sh);
  return sh;
}

function agendaFindBackupTemperaturaColumn_(sh) {
  var aliases = ['backup - temperatura', 'backup temperatura', 'temperatura backup'];
  var lastColumn = Number(sh && sh.getLastColumn && sh.getLastColumn()) || 0;
  if (lastColumn < 1) return 0;
  var headers = sh.getRange(1, 1, 1, lastColumn).getValues()[0] || [];
  for (var i = 0; i < headers.length; i++) {
    if (aliases.indexOf(normText_(headers[i])) >= 0) {
      return i + 1;
    }
  }
  return 0;
}

function agendaUseBackupTemperaturaColumn_(column) {
  column = Math.max(0, Number(column) || 0);
  AGENDA_CFG.col.backupTemperatura = column;
  AGENDA_CFG.idx.cb.temp = column ? column - 1 : -1;
  AGENDA_CFG.lastCol = Math.max(AGENDA_CFG.col.backupAgendaRef, column);
  CFG.lastCol = AGENDA_CFG.lastCol;
  return column;
}

function agendaResolveBackupTemperaturaColumnForRead_(sh) {
  return agendaUseBackupTemperaturaColumn_(agendaFindBackupTemperaturaColumn_(sh));
}

function agendaEnsureBackupTemperaturaColumn_(sh) {
  var label = 'Backup - Temperatura';
  var column = agendaFindBackupTemperaturaColumn_(sh);
  if (!column) {
    var lastColumn = Math.max(Number(sh.getLastColumn && sh.getLastColumn()) || 0, AGENDA_CFG.col.backupAgendaRef);
    column = lastColumn + 1;
    if (typeof sh.getMaxColumns === 'function' && sh.getMaxColumns() < column) {
      sh.insertColumnsAfter(sh.getMaxColumns(), column - sh.getMaxColumns());
    }
    sh.getRange(1, column).setValue(label);
  }
  return agendaUseBackupTemperaturaColumn_(column);
}

function ensureAgendaDestinoLabColumns_(sh) {
  var backupTemperaturaCol = agendaEnsureBackupTemperaturaColumn_(sh);
  var schemaCacheKey = 'AgendaSchemaEnsured:v6:' + backupTemperaturaCol;
  if (codexCacheGet_(schemaCacheKey)) return;
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
    { col: AGENDA_CFG.idx.cb.matBio + 1, label: 'Material biológico estruturado Backup' },
    { col: AGENDA_CFG.col.reqStatus, label: 'Status_Requisicao' },
    { col: AGENDA_CFG.col.monitorName, label: 'Monitor_Name' },
    { col: AGENDA_CFG.col.poloTrial, label: 'Polo_Trial_Concluido' },
    { col: AGENDA_CFG.col.ecrf, label: 'eCRF_Concluida' },
    { col: AGENDA_CFG.col.salaMonitoria, label: 'Sala_Monitoria' },
    { col: AGENDA_CFG.col.carroRequerido, label: 'Carro_Requerido' },
    { col: AGENDA_CFG.col.backupAgendaRef, label: 'Backup_Agendamento_Ref' }
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
  codexCachePut_(schemaCacheKey, true, 21600);
}

function getAgendaEventTypes_() {
  return getConfigAppValuesByKeys_(
    ['Agenda'],
    ['Tipo de evento', 'Tipos de evento'],
    ['Visita', 'Monitoria', 'Envio de amostras', 'Exame de imagem',
     'Exames laboratoriais', 'Contato telefônico', 'Feriado', 'SIV', 'Close-out', 'Reuniao', 'Auditoria']
  );
}

function getAgendaMonitoriaSalas_() {
  return getConfigAppValuesByKeys_(
    ['Agenda'],
    ['Sala de monitoria', 'Salas de monitoria', 'Local da monitoria'],
    []
  );
}

function getAgendaStatuses_() {
  var valores = getConfigAppValuesByKeys_(
    ['Agenda'],
    ['Status'],
    ['Agendado', 'Realizado', 'Concluído', 'Cancelado', 'Reagendado', 'Pendente']
  );
  var temConcluido = valores.some(function(v) { return AgendaServerRules_.isConcluded(v); });
  if (!temConcluido) valores.push('Concluído');
  return valores;
}

function getAgendaLaboratorios_() {
  return getConfigAppValuesByKeys_(
    ['Agenda', 'Estoque'],
    ['Laboratorio', 'Laboratorio central', 'Lab central'],
    []
  );
}

function getAgendaCourierRows_() {
  if (CODEX_AGENDA_COURIER_ROWS_CACHE_ && !CODEX_CACHE_BYPASS_READS_) return CODEX_AGENDA_COURIER_ROWS_CACHE_;
  var sh = getSheetByPossibleNames_(getCodexSpreadsheet_(), ['Courier', 'Couriers']);
  var lastRow = sh ? sh.getLastRow() : 0;
  if (!sh || lastRow < 2) {
    CODEX_AGENDA_COURIER_ROWS_CACHE_ = [];
    return CODEX_AGENDA_COURIER_ROWS_CACHE_;
  }
  var lastCol = Math.max(sh.getLastColumn(), COURIER_HEADERS_.length || 11);
  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function(h) {
    return normText_(h);
  });
  function headerValue(row, aliases) {
    aliases = aliases || [];
    for (var i = 0; i < aliases.length; i++) {
      var idx = headers.indexOf(normText_(aliases[i]));
      if (idx >= 0) return String(row[idx] || '').trim();
    }
    return '';
  }
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  var out = [];
  values.forEach(function(r) {
    var courier = String(r[1] || '').trim();
    if (!courier) return;
    var disponivelProjetosInformado = headerValue(r, ['Disponível para projetos', 'Disponivel para projetos', 'Vinculável a projetos', 'Vinculavel a projetos']);
    out.push({
      id: String(r[0] || '').trim(),
      nome: courier,
      courier: courier,
      empresa1: String(r[2] || '').trim(),
      cnpj1: String(r[3] || '').trim(),
      telefone1: String(r[4] || '').trim(),
      fax1: String(r[5] || '').trim(),
      empresa2: String(r[6] || '').trim(),
      cnpj2: String(r[7] || '').trim(),
      telefone2: String(r[8] || '').trim(),
      fax2: String(r[9] || '').trim(),
      conteudoDeclaracao: codexSanitizeCourierHtml_(r[10]),
      email: headerValue(r, ['E-mail', 'Email', 'Destinatarios', 'Destinatários', 'E-mails', 'Emails']),
      emailAmbiente: headerValue(r, ['E-mail ambiente', 'Email ambiente', 'Destinatarios ambiente', 'Destinatários ambiente']),
      emailCongelado: headerValue(r, ['E-mail congelado', 'Email congelado', 'Destinatarios congelado', 'Destinatários congelado']),
      monitorConfirmacao: headerValue(r, ['Monitorar confirmação', 'Monitorar confirmacao', 'Monitor confirmacao', 'Monitorar e-mail confirmação']),
      emailConfirmacao: headerValue(r, ['E-mail confirmação', 'Email confirmação', 'E-mail confirmacao', 'Email confirmacao', 'Remetente confirmação', 'Remetente confirmacao']),
      textoConfirmacao: headerValue(r, ['Texto confirmação', 'Texto confirmacao', 'Chave confirmação', 'Chave confirmacao']),
      statusConfirmacao: headerValue(r, ['Status confirmação', 'Status confirmacao', 'Status ao confirmar']),
      forneceGeloColeta: headerValue(r, ['Fornece gelo para coleta', 'Fornece gelo']),
      restricaoSegunda: headerValue(r, ['Restrição às segundas-feiras', 'Restricao as segundas-feiras', 'Restrição segunda-feira']),
      restricaoAposFeriado: headerValue(r, ['Restrição após feriado', 'Restricao apos feriado']),
      observacaoOperacional: headerValue(r, ['Observação operacional', 'Observacao operacional']),
      disponivelProjetos: courierDisponivelParaProjeto_({ nome: courier, disponivelProjetos: disponivelProjetosInformado })
    });
  });
  CODEX_AGENDA_COURIER_ROWS_CACHE_ = out;
  return CODEX_AGENDA_COURIER_ROWS_CACHE_;
}

function agendaCourierDefaultConfig_(nome) {
  var n = normText_(nome);
  return {
    nome: nome,
    unidade: n.indexOf('dhl') >= 0 ? 'L' : 'mL',
    conversionRequired: n.indexOf('dhl') >= 0
  };
}

function getAgendaCouriers_() {
  var courierRows = getAgendaCourierRows_();
  if (courierRows.length) {
    return courierRows.map(function(r) { return r.nome; });
  }
  return getConfigAppValuesByKeys_(
    ['Agenda', 'Logistica', 'Log\u00EDstica'],
    ['Courier', 'Couriers', 'Courier agenda', 'Nome do courier'],
    ['Marken', 'OCASA', 'DHL']
  );
}

function getAgendaCourierConfigs_(strict) {
  var out = {};
  var courierRows = getAgendaCourierRows_();
  if (courierRows.length) {
    courierRows.forEach(function(row) {
      var key = normText_(row.nome);
      out[key] = agendaCourierDefaultConfig_(row.nome);
      Object.keys(row).forEach(function(k) {
        out[key][k] = row[k];
      });
    });
  } else {
    getAgendaCouriers_().forEach(function(nome) {
      out[normText_(nome)] = agendaCourierDefaultConfig_(nome);
    });
  }

  Object.keys(out).forEach(function(key) {
    if (key.indexOf('dhl') >= 0) {
      out[key].unidade = 'L';
      out[key].conversionRequired = true;
    }
  });
  try {
    readConfigAppRows_().forEach(function(r) {
      var grupoOk = ['agenda', 'logistica'].indexOf(normText_(r.grupo)) > -1;
      var chaveOk = ['courier', 'couriers', 'courier agenda', 'nome do courier'].indexOf(normText_(r.chave)) > -1;
      if (!grupoOk || !chaveOk || !r.valor) return;
      var ativo = normText_(r.ativo || 'Sim');
      if (ativo === 'nao' || ativo === 'false' || ativo === '0' || ativo === 'inativo') return;
      var key = normText_(r.valor);
      if (!out[key]) out[key] = agendaCourierDefaultConfig_(r.valor);
      var obs = String(r.observacao || '');
      var m = obs.match(/(?:unidade|unit)\s*[:=]\s*(L|mL)\b/i);
      if (m) out[key].unidade = String(m[1]).toUpperCase() === 'L' ? 'L' : 'mL';
      out[key].conversionRequired = out[key].unidade === 'L';
    });
  } catch(e) {
    if (strict) throw e;
  }
  return out;
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
    ['N\u00E3o Agendado', 'Pendente', 'Agendado', 'Adicionado \u00E0 Agenda', 'Confirmado', 'Coletado', 'Enviado', 'Entregue', 'Cancelado']
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

function getAgendaLabDestinos_(strict) {
  var seen = {};
  try {
    return getLabCentral().map(function(lab) {
      return String(lab.nomeAbreviado || '').trim();
    }).filter(function(nome) {
      var key = normText_(nome);
      if (!nome || seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(function(a, b) {
      return a.localeCompare(b);
    });
  } catch (e) {
    if (strict) throw e;
    Logger.log('getAgendaLabDestinos_: nao foi possivel carregar LabCentral: ' + e.message);
    return [];
  }
}

function getAgendaKitsEstoque_(strict) {
  try {
    if (CODEX_AGENDA_KITS_ESTOQUE_CACHE_ && !CODEX_CACHE_BYPASS_READS_) return CODEX_AGENDA_KITS_ESTOQUE_CACHE_;
    var itens = getEstoque() || [];
    var seen = {};
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = itens.filter(function(it) {
      var tipo = normText_(it.tipoItem || it.tipo || '');
      var desc = normText_(it.descricao || '');
      var saldo = Number(it.qtdeDisponivel !== undefined ? it.qtdeDisponivel : it.qtde);
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
      if (it.accessionNumber) label += ' | Accession ' + String(it.accessionNumber).trim();
      if (it.qtdeDisponivel !== undefined && it.qtdeDisponivel !== '') label += ' | disponível ' + it.qtdeDisponivel;
      else if (it.qtde !== undefined && it.qtde !== '') label += ' | qtd ' + it.qtde;
      return {
        id: String(it.idItem || it.id || label),
        label: label,
        projeto: String(it.projeto || ''),
        projetoNorm: normText_(it.projeto || ''),
        validade: validade,
        qtde: it.qtde,
        idLote: String(it.idLote || ''),
        accessionNumber: String(it.accessionNumber || ''),
        ordem: it.ordem !== undefined && it.ordem !== '' ? Number(it.ordem) : ''
      };
    }).filter(function(it) {
      var key = [it.id, it.projeto, it.validade, it.idLote, it.accessionNumber].join('|');
      if (!it.label || seen[key]) return false;
      seen[key] = 1;
      return true;
    }).sort(function(a, b) {
      var aSemOrdem = a.ordem === '' || !isFinite(Number(a.ordem));
      var bSemOrdem = b.ordem === '' || !isFinite(Number(b.ordem));
      if (aSemOrdem !== bSemOrdem) return aSemOrdem ? 1 : -1;
      if (!aSemOrdem && Number(a.ordem) !== Number(b.ordem)) return Number(a.ordem) - Number(b.ordem);
      return a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' });
    });
    return CODEX_AGENDA_KITS_ESTOQUE_CACHE_;
  } catch(e) {
    if (strict) throw e;
    return [];
  }
}

function agendaBuildDadosFormularioAgenda_(strict) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function listaColB(nomesAba) {
    var sh = getSheetByPossibleNames_(ss, nomesAba);
    var lastRow = sh ? sh.getLastRow() : 0;
    if (!sh) {
      if (strict) throw new Error('Dataset obrigatorio da Agenda indisponivel.');
      return [];
    }
    if (lastRow < 2) return [];
    return sh.getRange(2, 2, lastRow - 1, 1).getValues()
      .map(function(r) { return String(r[0] || '').trim(); })
      .filter(Boolean)
      .sort();
  }
  var hoje = new Date();
  var hojeIso = hoje.getFullYear() + '-' +
    ('0' + (hoje.getMonth() + 1)).slice(-2) + '-' +
    ('0' + hoje.getDate()).slice(-2);
  if (strict && !getSheetByPossibleNames_(ss, ['Projetos'])) {
    throw new Error('Dataset obrigatorio da Agenda indisponivel: projetos.');
  }
  var result = {
    participantes: agendaParticipantesFormulario_(ss, strict),
    medicos: listaColB(['\uD83E\uDE7A M\u00E9dicos', 'Medicos', 'M\u00E9dicos']),
    prestadores: listaColB(['\uD83C\uDFE2 Prestadores', 'Prestadores']),
    projetos: getProjetoOptions_(),
    laboratorios: getAgendaLaboratorios_(),
    couriers: getAgendaCouriers_(),
    courierConfig: getAgendaCourierConfigs_(strict),
    projectCourierMap: getAgendaProjetoCourierMap_(),
    feriados: getAgendaFeriadosOperacionais_(),
    temperaturas: getAgendaTemperaturas_(),
    statusCourier: getAgendaCourierStatuses_(),
    laboratoriosDestino: getAgendaLabDestinos_(strict),
    kitsColeta: getAgendaKitsEstoque_(strict),
    tiposEvento: getAgendaEventTypes_(),
    salasMonitoria: getAgendaMonitoriaSalas_(),
    status: getAgendaStatuses_(),
    procedimentoChips: getAgendaProcedimentoChips_(),
    monitores: getMonitores(),
    emailLabAtivo: agendaEmailEnabled_(),
    hojeIso: hojeIso
  };
  return result;
}

// Dados exibidos imediatamente ao escolher um participante. A ultima visita
// continua sendo atualizada em segundo plano, pois exige consultar a Agenda.
function agendaParticipanteDisponivelFormulario_(status) {
  var statusNorm = normText_(status);
  return statusNorm !== 'obito' && statusNorm !== 'descontinuado';
}

function agendaParticipantesFormulario_(ss, strict) {
  var sh = getSheetByPossibleNames_(ss, ['Participantes']);
  var lastRow = sh ? sh.getLastRow() : 0;
  if (!sh) {
    if (strict) throw new Error('Dataset obrigatorio da Agenda indisponivel: participantes.');
    return [];
  }
  if (lastRow < 2) return [];
  return sh.getRange(2, 1, lastRow - 1, Math.max(7, sh.getLastColumn())).getValues()
    .filter(function(row) { return agendaParticipanteDisponivelFormulario_(row[8]); })
    .map(function(row) {
      var nascimento = row[2];
      return {
        nome: String(row[1] || '').trim(),
        nascimento: formatarDataSafe(nascimento),
        idade: calcularIdadeAgenda_(nascimento),
        numId: String(row[4] || '').trim(),
        projeto: String(row[5] || '').trim(),
        braco: String(row[6] || '').trim()
      };
    })
    .filter(function(p) { return !!p.nome; })
    .sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }); });
}

function agendaGetDadosFormularioAgendaCached_(cacheKey, forceRefresh, strict) {
  var cached = forceRefresh ? null : codexCacheGet_(cacheKey);
  if (cached) return cached;
  var result = agendaBuildDadosFormularioAgenda_(strict);
  codexCachePut_(cacheKey, result);
  return result;
}

function getDadosFormularioAgenda(strictValidation) {
  var strict = strictValidation === true;
  var cacheKey = (strict ? 'AgendaFormDataStrict:v4:' : 'AgendaFormData:v10:') +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  if (strict) return agendaGetDadosFormularioAgendaCached_(cacheKey, false, true);
  return agendaGetDadosFormularioAgendaCached_(cacheKey, false, false);
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
      ultimaVisitaDataIso: ultima.dataIso,
      ultimaVisitaId: ultima.visita
    };
  }
  return null;
}

function getUltimaVisita(pacienteID) {
  return getUltimaVisitaFromMap_(pacienteID, getUltimasVisitasPorPacienteId_());
}

function getUltimaVisitaFromMap_(pacienteID, mapa) {
  var key = normText_(pacienteID);
  if (!key) return '---';
  return String((mapa || {})[key] || '---');
}

function getUltimasVisitasPorPacienteId_() {
  var out = {};
  try {
    var agenda = getAgendaSheetForRead_();
    var lastRow = agenda.getLastRow();
    if (lastRow < 2) return out;
    var vals = agenda.getRange(2, 1, lastRow - 1, Math.max(AGENDA_CFG.lastCol, 11)).getValues();
    vals.forEach(function(r) {
      var categoria = normText_(r[3]);       // Col D: Categoria / Tipo de evento
      var status = normText_(r[4]);          // Col E: Status
      var paciente = normText_(r[5]);        // Col F: Paciente / Participante
      if (!paciente || !AgendaServerRules_.isVisit(categoria)) return;
      if (!AgendaServerRules_.isCompleted(status)) return;
      var data = agendaDateFromValue_(r[1]); // Col B: Data
      if (!data) return;
      var visita = String(r[10] == null ? '' : r[10]).trim(); // Col K: Nome da visita
      if (!visita) visita = '---';
      if (!out[paciente] || data.getTime() > out[paciente].data.getTime()) {
        out[paciente] = { data: data, visita: visita };
      }
    });
  } catch(e) {
    return {};
  }
  Object.keys(out).forEach(function(k) {
    out[k] = String(out[k].visita || '---');
  });
  return out;
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

function jornadaCalcularJanelaVisita_(dataIdeal, janelaDiasMenos, janelaDiasMais) {
  if (!dataIdeal) return { inicio: null, fim: null };
  var base = new Date(typeof dataIdeal.getTime === 'function' ? dataIdeal.getTime() : dataIdeal);
  if (isNaN(base.getTime())) return { inicio: null, fim: null };
  var diasAntes = Math.abs(Number(janelaDiasMenos) || 0);
  var diasDepois = Math.abs(Number(janelaDiasMais) || 0);
  var inicio = new Date(base.getTime()); inicio.setDate(inicio.getDate() - diasAntes);
  var fim = new Date(base.getTime()); fim.setDate(fim.getDate() + diasDepois);
  return { inicio: inicio, fim: fim };
}

// Primeira etapa do motor CTMS: cálculo puro e comparativo, sem substituir a
// Jornada operacional. O piloto fica restrito aos dois protocolos revisados.
var JORNADA_CTMS_PREVIEW_PROJECTS_ = ['monumental3', 'confirmationhf'];

function jornadaCtmsProjetoPiloto_(projeto) {
  var key = normText_(projeto).replace(/[^a-z0-9]+/g, '');
  return JORNADA_CTMS_PREVIEW_PROJECTS_.indexOf(key) >= 0;
}

function jornadaCtmsDate_(value) {
  if (!value) return null;
  if (value instanceof Date || (value && typeof value.getTime === 'function')) {
    var cloned = new Date(value.getTime());
    cloned.setHours(0, 0, 0, 0);
    return isNaN(cloned.getTime()) ? null : cloned;
  }
  var raw = String(value || '').trim();
  var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  var parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function jornadaCtmsDateIso_(value) {
  var date = jornadaCtmsDate_(value);
  if (!date) return '';
  function pad(number) { return String(number).padStart(2, '0'); }
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function jornadaCtmsDateLabel_(value) {
  var date = jornadaCtmsDate_(value);
  if (!date) return '';
  function pad(number) { return String(number).padStart(2, '0'); }
  return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + '/' + date.getFullYear();
}

function jornadaCtmsAddDays_(value, days) {
  var date = jornadaCtmsDate_(value);
  if (!date) return null;
  date.setDate(date.getDate() + (Number(days) || 0));
  return date;
}

function jornadaCtmsEventoParaVisita_(visita, eventos) {
  var id = String(visita && visita.idSoA || '').trim();
  var labels = [visita && visita.nome, visita && visita.codigo]
    .concat((visita && visita.aliases) || []).map(normText_).filter(Boolean);
  var candidatos = (eventos || []).filter(function(evento) {
    if (!evento || evento.cancelada || !jornadaCtmsDate_(evento.data || evento.dataIso)) return false;
    if (id && String(evento.idSoA || '').trim() === id) return true;
    return !String(evento.idSoA || '').trim() && labels.indexOf(normText_(evento.visita)) >= 0;
  });
  candidatos.sort(function(a, b) {
    return Number(!!b.concluida) - Number(!!a.concluida) ||
      jornadaCtmsDate_(b.data || b.dataIso).getTime() - jornadaCtmsDate_(a.data || a.dataIso).getTime();
  });
  return candidatos[0] || null;
}

function jornadaCtmsReferenciaEspecial_(value) {
  return ['RANDOMIZACAO', 'INCLUSAO', 'ULTIMA_DOSE', 'FIM_TRATAMENTO', 'PROGRESSAO_DOENCA', 'OUTRA']
    .indexOf(String(value || '').trim()) >= 0;
}

function jornadaCtmsClassificarImpacto_(row) {
  row = row || {};
  var atual = row.atual || {};
  var dataAtual = jornadaCtmsDate_(atual.dataAlvoIso || atual.dataAlvo);
  var dataCtms = jornadaCtmsDate_(row.dataPrevistaIso || row.dataPrevista);
  var estadoAtual = String(atual.estado || '').trim();
  var statusCalculo = String(row.statusCalculo || '').trim();
  var diferencaDias = null;
  if (dataAtual && dataCtms) diferencaDias = Math.round((dataCtms.getTime() - dataAtual.getTime()) / 86400000);

  if (statusCalculo === 'PENDENTE' || statusCalculo === 'SEM_REGRA' || !dataCtms) {
    return {
      tipo: 'REVISAO', diferencaDias: diferencaDias, requerAtencao: true,
      motivo: dataAtual ? 'A Jornada atual possui data, mas o motor CTMS ainda não resolveu uma referência segura.' : 'O motor CTMS ainda não possui dados suficientes para calcular esta visita.'
    };
  }
  if (!dataAtual) {
    return {
      tipo: 'MUDARIA', diferencaDias: null, requerAtencao: true,
      motivo: 'O motor CTMS calcula uma data onde a Jornada atual ainda não possui previsão.'
    };
  }
  if (diferencaDias === 0) {
    return {
      tipo: 'SEM_MUDANCA', diferencaDias: 0, requerAtencao: !!row.provisoria,
      motivo: row.provisoria ? 'A data coincide, mas ainda depende da realização da visita de referência.' : 'A data CTMS coincide com o cálculo atual.'
    };
  }
  var direcao = diferencaDias > 0 ? 'depois' : 'antes';
  var quantidade = Math.abs(diferencaDias);
  if (estadoAtual === 'REALIZADA') {
    return {
      tipo: 'DIVERGENCIA_HISTORICA', diferencaDias: diferencaDias, requerAtencao: true,
      motivo: 'A data realizada ficou ' + quantidade + ' dia(s) ' + direcao + ' da previsão CTMS. O histórico não será alterado.'
    };
  }
  return {
    tipo: 'MUDARIA', diferencaDias: diferencaDias, requerAtencao: true,
    motivo: 'O motor CTMS deslocaria esta visita em ' + quantidade + ' dia(s) para ' + direcao + ' do cálculo atual.'
  };
}

function jornadaCtmsFingerprint_(row) {
  row = row || {};
  var atual = row.atual || {};
  var raw = [
    'v1', row.idSoA, row.dataPrevistaIso, row.janelaInicio, row.janelaFim,
    row.referenciaUtilizada, row.baseCalculo, row.statusCalculo, row.provisoria ? '1' : '0',
    atual.dataAlvoIso, atual.estado, atual.janelaInicio, atual.janelaFim
  ].map(function(value) { return String(value == null ? '' : value); }).join('|');
  var hash = 2166136261;
  for (var i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'ctms-v1-' + ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function jornadaCtmsCalcularPreviaPura_(input) {
  input = input || {};
  var avisos = [];
  var avisoKeys = {};
  function warn(message) {
    message = String(message || '').trim();
    if (!message || avisoKeys[message]) return;
    avisoKeys[message] = true;
    avisos.push(message);
  }
  var bracoId = String(input.bracoId || '').trim();
  var todas = (input.visitas || []).filter(function(visita) { return visita && visita.ativo !== false; });
  var temVariantes = todas.some(function(visita) { return (visita.bracoIds || []).length; });
  var visitas = todas.filter(function(visita) {
    var ids = soaUniqueIds_(visita.bracoIds || []);
    if (!ids.length) return true;
    return !!bracoId && ids.indexOf(bracoId) >= 0;
  });
  if (temVariantes && !bracoId) warn('O participante não possui braço padronizado; a prévia mostra somente visitas comuns a todos os braços.');

  var porId = {};
  visitas.forEach(function(visita) { porId[String(visita.idSoA || '')] = visita; });
  var ordem = soaSugerirOrdemExecucao_(visitas);
  (ordem.ambiguidades || []).forEach(function(item) { warn(item.mensagem); });

  var eventosPorId = {};
  visitas.forEach(function(visita) {
    eventosPorId[String(visita.idSoA || '')] = jornadaCtmsEventoParaVisita_(visita, input.eventos || []);
  });

  var marcos = {};
  Object.keys(input.marcos || {}).forEach(function(key) {
    var date = jornadaCtmsDate_(input.marcos[key]);
    if (date) marcos[String(key || '').trim()] = { date: date, origem: 'MARCO_INFORMADO' };
  });
  var candidatosMarcos = {};
  visitas.forEach(function(visita) {
    var referencia = String(visita.referencia || '').trim();
    var evento = eventosPorId[String(visita.idSoA || '')];
    if (!jornadaCtmsReferenciaEspecial_(referencia) || referencia === 'OUTRA' ||
        visita.papelCronograma !== 'MARCO_CALCULO' || !evento || !evento.concluida) return;
    var base = jornadaCtmsAddDays_(evento.data || evento.dataIso, -(Number(visita.intervaloDias) || 0));
    if (!base) return;
    if (!candidatosMarcos[referencia]) candidatosMarcos[referencia] = {};
    candidatosMarcos[referencia][jornadaCtmsDateIso_(base)] = base;
  });
  Object.keys(candidatosMarcos).forEach(function(key) {
    if (marcos[key]) return;
    var dates = Object.keys(candidatosMarcos[key]);
    if (dates.length === 1) marcos[key] = { date: candidatosMarcos[key][dates[0]], origem: 'VISITA_MARCO_REALIZADA' };
    else warn('O marco ' + key + ' possui datas candidatas divergentes e permaneceu sem resolução automática.');
  });

  var resultados = {};
  var escolhas = input.escolhasReferencias || {};
  function referenceCandidate(reference) {
    reference = String(reference || '').trim();
    if (!reference) return null;
    if (jornadaCtmsReferenciaEspecial_(reference)) {
      var marco = marcos[reference];
      return marco ? { id: reference, prevista: marco.date, realizada: marco.date, origem: marco.origem } : null;
    }
    var result = resultados[reference];
    if (!result || result.papelCronograma === 'NAO_PARTICIPA_CALCULO') return null;
    return { id: reference, prevista: result._dataPrevista, realizada: result._dataRealizada, origem: 'VISITA_SOA' };
  }
  function chooseReference(visita, primary, alternative, rowWarnings) {
    if (!visita.referenciaAlternativa) return primary;
    var criterio = String(visita.criterioReferencias || '').trim();
    if (criterio === 'SELECAO_MANUAL') {
      var selected = String(escolhas[String(visita.idSoA || '')] || '').trim();
      if (!selected) {
        rowWarnings.push('A referência exige seleção manual para este participante.');
        return null;
      }
      if (selected === String(visita.referencia || '')) return primary;
      if (selected === String(visita.referenciaAlternativa || '')) return alternative;
      rowWarnings.push('A seleção manual não corresponde às referências configuradas.');
      return null;
    }
    if (!primary || !alternative) {
      rowWarnings.push('Uma das referências configuradas ainda não possui data resolvida.');
      return null;
    }
    var primaryOccurrence = primary.realizada || primary.prevista;
    var alternativeOccurrence = alternative.realizada || alternative.prevista;
    if (!primaryOccurrence || !alternativeOccurrence) return null;
    if (criterio === 'PRIMEIRO_OCORRER') return primaryOccurrence <= alternativeOccurrence ? primary : alternative;
    if (criterio === 'ULTIMO_OCORRER') return primaryOccurrence >= alternativeOccurrence ? primary : alternative;
    rowWarnings.push('O critério entre referências não está configurado.');
    return null;
  }

  (ordem.idsSoA || []).forEach(function(id) {
    var visita = porId[id];
    if (!visita) return;
    var evento = eventosPorId[id];
    var dataEvento = evento && jornadaCtmsDate_(evento.data || evento.dataIso);
    var dataRealizada = evento && evento.concluida ? dataEvento : null;
    var dataAgendada = evento && !evento.concluida ? dataEvento : null;
    var rowWarnings = [];
    var baseCalculo = String(visita.baseCalculoEfetiva || visita.baseCalculo || '').trim();
    var primary = referenceCandidate(visita.referencia);
    var alternative = referenceCandidate(visita.referenciaAlternativa);
    var chosen = chooseReference(visita, primary, alternative, rowWarnings);
    var prevista = null;
    var origemBase = '';
    var provisoria = false;

    if (!baseCalculo) {
      rowWarnings.push('Visita sem regra CTMS; o cálculo atual permanece como referência.');
    } else if (!visita.referencia) {
      if (visita.papelCronograma === 'MARCO_CALCULO' && dataRealizada) {
        prevista = dataRealizada;
        origemBase = 'PRÓPRIA VISITA REALIZADA';
      } else {
        rowWarnings.push('Visita CTMS sem referência configurada.');
      }
    } else if (!chosen) {
      rowWarnings.push('A referência ' + String(visita.referencia || '') + ' ainda não possui data resolvida.');
    } else {
      var baseDate = null;
      if (baseCalculo === 'MANTER_DATAS_PREVISTAS') {
        baseDate = chosen.prevista;
        origemBase = 'PREVISÃO DE ' + chosen.id;
      } else if (baseCalculo === 'RECALCULAR_VISITA_REALIZADA') {
        baseDate = chosen.realizada || chosen.prevista;
        provisoria = !chosen.realizada && !!chosen.prevista;
        origemBase = (chosen.realizada ? 'REALIZAÇÃO DE ' : 'PREVISÃO PROVISÓRIA DE ') + chosen.id;
      }
      if (baseDate) prevista = jornadaCtmsAddDays_(baseDate, visita.intervaloDias);
      else rowWarnings.push('A base escolhida não possui data utilizável.');
    }
    var janela = jornadaCalcularJanelaVisita_(prevista, visita.janelaDiasMenos, visita.janelaDiasMais);
    resultados[id] = {
      idSoA: id,
      codigo: String(visita.codigo || ''),
      nome: String(visita.nome || ''),
      ordem: visita.ordem,
      baseCalculo: baseCalculo,
      papelCronograma: String(visita.papelCronograma || ''),
      referenciaConfigurada: String(visita.referencia || ''),
      referenciaAlternativa: String(visita.referenciaAlternativa || ''),
      referenciaUtilizada: chosen && chosen.id || '',
      origemBase: origemBase,
      provisoria: provisoria,
      dataPrevistaIso: jornadaCtmsDateIso_(prevista),
      dataPrevista: jornadaCtmsDateLabel_(prevista),
      dataAgendadaIso: jornadaCtmsDateIso_(dataAgendada),
      dataAgendada: jornadaCtmsDateLabel_(dataAgendada),
      dataRealizadaIso: jornadaCtmsDateIso_(dataRealizada),
      dataRealizada: jornadaCtmsDateLabel_(dataRealizada),
      janelaInicio: jornadaCtmsDateLabel_(janela.inicio),
      janelaFim: jornadaCtmsDateLabel_(janela.fim),
      statusCalculo: !baseCalculo ? 'SEM_REGRA' : (prevista ? (provisoria ? 'PROVISORIA' : 'CALCULADA') : 'PENDENTE'),
      avisos: rowWarnings,
      _dataPrevista: prevista,
      _dataRealizada: dataRealizada
    };
  });

  var legacyMap = {};
  (input.legacyVisitas || []).forEach(function(visita) { legacyMap[String(visita.idSoA || '')] = visita; });
  var aprovacoes = input.aprovacoes || {};
  var visibleIds = (input.idsVisiveis || []).map(String);
  var rows = (ordem.idsSoA || []).map(function(id) { return resultados[id]; }).filter(function(row) {
    return row && (!visibleIds.length || visibleIds.indexOf(String(row.idSoA || '')) >= 0);
  }).map(function(row) {
    var legacy = legacyMap[row.idSoA] || {};
    row.atual = {
      dataAlvo: String(legacy.dataAlvo || ''),
      dataAlvoIso: String(legacy.dataAlvoIso || ''),
      estado: String(legacy.estado || ''),
      janelaInicio: String(legacy.janelaInicio || ''),
      janelaFim: String(legacy.janelaFim || '')
    };
    row.impacto = jornadaCtmsClassificarImpacto_(row);
    row.fingerprint = jornadaCtmsFingerprint_(row);
    row.aprovavel = (row.statusCalculo === 'CALCULADA' || row.statusCalculo === 'PROVISORIA') &&
      row.atual.estado !== 'REALIZADA' && row.atual.estado !== 'AGENDADA';
    var aprovacao = aprovacoes[row.idSoA] || null;
    var fingerprintAprovado = typeof aprovacao === 'string' ? aprovacao : String(aprovacao && aprovacao.fingerprint || '');
    row.aprovada = !!(row.aprovavel && fingerprintAprovado && fingerprintAprovado === row.fingerprint);
    row.aprovacaoObsoleta = !!(fingerprintAprovado && fingerprintAprovado !== row.fingerprint);
    row.aprovacao = row.aprovada ? {
      aprovadoEm: String(aprovacao && aprovacao.aprovadoEm || ''),
      aprovadoPor: String(aprovacao && aprovacao.aprovadoPor || '')
    } : null;
    delete row._dataPrevista;
    delete row._dataRealizada;
    return row;
  });
  rows.forEach(function(row) { (row.avisos || []).forEach(warn); });
  var resumoImpacto = {
    semMudanca: rows.filter(function(row) { return row.impacto.tipo === 'SEM_MUDANCA'; }).length,
    divergencias: rows.filter(function(row) { return row.impacto.tipo === 'MUDARIA' || row.impacto.tipo === 'DIVERGENCIA_HISTORICA'; }).length,
    revisao: rows.filter(function(row) { return row.impacto.tipo === 'REVISAO'; }).length,
    atencao: rows.filter(function(row) { return row.impacto.requerAtencao; }).length
  };
  return {
    somenteLeitura: true,
    motorAtivo: input.motorAtivo === true,
    projeto: String(input.projeto || ''),
    participante: String(input.participante || ''),
    linhas: rows,
    avisos: avisos,
    resumo: {
      total: rows.length,
      calculadas: rows.filter(function(row) { return row.statusCalculo === 'CALCULADA'; }).length,
      provisorias: rows.filter(function(row) { return row.statusCalculo === 'PROVISORIA'; }).length,
      pendentes: rows.filter(function(row) { return row.statusCalculo === 'PENDENTE' || row.statusCalculo === 'SEM_REGRA'; }).length,
      semMudanca: resumoImpacto.semMudanca,
      divergencias: resumoImpacto.divergencias,
      revisao: resumoImpacto.revisao,
      atencao: resumoImpacto.atencao,
      aprovadas: rows.filter(function(row) { return row.aprovada; }).length,
      pendentesAprovacao: rows.filter(function(row) { return row.aprovavel && !row.aprovada; }).length,
      aprovacoesObsoletas: rows.filter(function(row) { return row.aprovacaoObsoleta; }).length
    }
  };
}

function jornadaCtmsAplicarAoOperacional_(visitas, previa, hoje) {
  previa = previa || {};
  hoje = jornadaCtmsDate_(hoje || new Date());
  var porId = {};
  (previa.linhas || []).forEach(function(row) { porId[String(row.idSoA || '')] = row; });
  return (visitas || []).map(function(visita) {
    var row = porId[String(visita && visita.idSoA || '')];
    if (!visita || !row) return visita;
    var atualizado = {};
    Object.keys(visita).forEach(function(key) { atualizado[key] = visita[key]; });
    atualizado.ctmsComparacao = {
      aprovada: row.aprovada === true,
      aprovavel: row.aprovavel === true,
      obsoleta: row.aprovacaoObsoleta === true,
      integrada: false,
      dataSugerida: row.dataPrevista,
      motivo: row.impacto && row.impacto.motivo || ''
    };
    if (!previa || previa.motorAtivo !== true || row.aprovada !== true || visita.estado === 'REALIZADA' || visita.estado === 'AGENDADA' ||
        (row.statusCalculo !== 'CALCULADA' && row.statusCalculo !== 'PROVISORIA') || !row.dataPrevistaIso) return atualizado;
    atualizado.estado = 'PREVISTA';
    atualizado.dataAlvo = row.dataPrevista;
    atualizado.dataAlvoIso = row.dataPrevistaIso;
    atualizado.dataAlvoObj = jornadaCtmsDate_(row.dataPrevistaIso);
    atualizado.janelaInicio = row.janelaInicio;
    atualizado.janelaFim = row.janelaFim;
    atualizado.fontePrevisao = 'CTMS';
    atualizado.ctmsComparacao.integrada = true;
    var janelaInicio = jornadaCtmsDate_(row.janelaInicio);
    var janelaFim = jornadaCtmsDate_(row.janelaFim);
    atualizado.emJanela = !!(janelaInicio && janelaFim && hoje >= janelaInicio && hoje <= janelaFim);
    atualizado.atrasada = !!(janelaFim && hoje > janelaFim);
    return atualizado;
  });
}

// A Agenda IPS passou a ser a fonte operacional em 2026. Quando já existe uma
// visita do participante registrada a partir desse marco, não devemos trazer
// etapas anteriores do SoA para a linha do tempo ou para a prontidão: elas não
// foram migradas e fariam a operação começar novamente pela Triagem.
function jornadaVisitasDesdeInicioOperacional_(visitas) {
  visitas = Array.isArray(visitas) ? visitas : [];
  var primeiroRegistroIps = -1;
  for (var i = 0; i < visitas.length; i++) {
    if (visitas[i] && visitas[i].temEventoIPS) {
      primeiroRegistroIps = i;
      break;
    }
  }
  return primeiroRegistroIps >= 0 ? visitas.slice(primeiroRegistroIps) : visitas;
}

// A conciliação é uma revisão explícita do histórico. Diferentemente da linha
// do tempo operacional, ela precisa manter todas as visitas ativas do SoA como
// destinos possíveis, inclusive as anteriores ao primeiro registro no IPS.
function jornadaVisitasParaConciliacao_(visitas) {
  return (Array.isArray(visitas) ? visitas : []).filter(function(visita) {
    return visita && visita.ativo !== false && String(visita.idSoA || '').trim() && String(visita.nome || '').trim();
  });
}

function jornadaLimitePrevisao_(hoje) {
  var limite = new Date((hoje || new Date()).getTime());
  limite.setHours(23, 59, 59, 999);
  limite.setMonth(limite.getMonth() + 6);
  return limite;
}

function jornadaVisitasPrevisaoSeisMeses_(visitas, hoje) {
  hoje = new Date((hoje || new Date()).getTime());
  hoje.setHours(0, 0, 0, 0);
  var limite = jornadaLimitePrevisao_(hoje);
  return (visitas || []).filter(function(visita) {
    var data = visita && visita.dataAlvoObj;
    return visita && visita.estado !== 'REALIZADA' && data && data >= hoje && data <= limite;
  });
}

function jornadaReservasModeloVisita_(reservas, modelo, visita) {
  var labels = [visita && visita.nome, visita && visita.codigo]
    .concat((visita && visita.aliases) || [])
    .map(normText_).filter(Boolean);
  return (reservas || []).filter(function(reserva) {
    return normText_(reserva.status || 'Reservado') === 'reservado' &&
      String(reserva.idItem || '') === String(modelo.idItem || '') &&
      labels.indexOf(normText_(reserva.visitaPrevista)) >= 0;
  });
}

function getJornadaParticipante(payload) {
  payload = payload || {};
  var nome = String(payload.nome || '').trim();
  var participanteId = String(payload.idParticipante || '').trim();
  var projeto = String(payload.projeto || '').trim();
  if (!nome || !projeto) throw new Error('Informe o participante e o projeto para consultar a jornada.');
  var projetoNorm = normText_(projeto);
  var participanteNorm = normText_(nome);
  var participanteIdNorm = normText_(participanteId);
  var agenda = getAgendaSheetForRead_();
  var eventos = [];
  if (agenda && agenda.getLastRow() >= 2) {
    var rows = agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol).getValues();
    rows.forEach(function(row) {
      var idx = AGENDA_CFG.idx;
      if (!AgendaServerRules_.isVisit(row[idx.tipo])) return;
      var mesmoParticipante = participanteIdNorm && normText_(row[idx.idParticipante]) === participanteIdNorm;
      if (!mesmoParticipante) mesmoParticipante = normText_(row[idx.participante]) === participanteNorm;
      if (!mesmoParticipante || normText_(row[idx.projeto]) !== projetoNorm) return;
      var data = agendaDateFromValue_(row[idx.data]);
      if (!data || isNaN(data.getTime())) return;
      eventos.push({
        id: String(row[idx.id] || ''), visita: String(row[idx.visita] || '').trim(), data: data,
        dataIso: formatarDataIsoAgenda_(data), dataLabel: formatarDataSafe(row[idx.data]),
        status: String(row[idx.status] || ''), concluida: AgendaServerRules_.isCompleted(row[idx.status]),
        cancelada: AgendaServerRules_.isCancelled(row[idx.status])
      });
    });
  }
  var conciliacoes = getAgendaSoAConciliacoesPorAgendaId_(eventos.map(function(evento) { return evento.id; }));
  eventos.forEach(function(evento) { evento.idSoA = String(conciliacoes[evento.id] || ''); });
  eventos.sort(function(a, b) { return a.data.getTime() - b.data.getTime(); });
  var eventosAnteriores = eventos.filter(function(evento) { return !agendaSoAEventoFazParteDoIPS_(evento); });
  eventos = eventos.filter(agendaSoAEventoFazParteDoIPS_);
  var visitas = getSoAVisitasProjeto(projeto);
  var porId = {};
  visitas.forEach(function(visita) { porId[String(visita.idSoA || '')] = visita; });
  function eventoParaVisita(visita) {
    var labels = [visita.nome, visita.codigo].concat(visita.aliases || []).map(normText_).filter(Boolean);
    return eventos.filter(function(evento) { return String(evento.idSoA || '') === String(visita.idSoA || '') || labels.indexOf(normText_(evento.visita)) >= 0; })
      .sort(function(a, b) { return Number(b.concluida) - Number(a.concluida) || b.data.getTime() - a.data.getTime(); })[0] || null;
  }
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  var jornadaPorId = {};
  visitas.forEach(function(visita) {
    var evento = eventoParaVisita(visita);
    var dataAlvo = evento && !evento.cancelada ? new Date(evento.data.getTime()) : null;
    if (!dataAlvo && visita.referencia && porId[visita.referencia] && jornadaPorId[visita.referencia] && jornadaPorId[visita.referencia].dataAlvoObj) {
      dataAlvo = new Date(jornadaPorId[visita.referencia].dataAlvoObj.getTime());
      dataAlvo.setDate(dataAlvo.getDate() + (Number(visita.intervaloDias) || 0));
    }
    var janela = jornadaCalcularJanelaVisita_(dataAlvo, visita.janelaDiasMenos, visita.janelaDiasMais);
    var janelaInicio = janela.inicio, janelaFim = janela.fim;
    var estado = evento && evento.concluida ? 'REALIZADA' : evento && !evento.cancelada ? 'AGENDADA' : dataAlvo ? 'PREVISTA' : 'A_PROGRAMAR';
    jornadaPorId[visita.idSoA] = {
      idSoA: visita.idSoA, codigo: visita.codigo, nome: visita.nome, ordem: visita.ordem,
      estado: estado, agendaId: evento && evento.id || '', dataAlvo: dataAlvo ? formatarDataSafe(dataAlvo) : '',
      dataAlvoIso: dataAlvo ? formatarDataIsoAgenda_(dataAlvo) : '', dataAlvoObj: dataAlvo,
      temEventoIPS: !!evento,
      janelaInicio: janelaInicio ? formatarDataSafe(janelaInicio) : '', janelaFim: janelaFim ? formatarDataSafe(janelaFim) : '',
      emJanela: !!(janelaInicio && janelaFim && hoje >= janelaInicio && hoje <= janelaFim),
      atrasada: !!(janelaFim && hoje > janelaFim && estado !== 'REALIZADA'),
      referencia: visita.referencia || '', intervaloDias: visita.intervaloDias
    };
  });
  var bracos = getBracosProjeto(projeto);
  var braco = bracos.filter(function(item) { return normText_(item.nome) === normText_(payload.braco); })[0] || {};
  var configCtms = jornadaCtmsLerConfigParticipante_({
    idCadastro: payload.idCadastro,
    nome: nome,
    idParticipante: participanteId,
    projeto: projeto
  });
  var bracoIdCtms = String(configCtms.bracoId || braco.idBraco || '').trim();
  var ctmsAtivo = projetoCtmsJornadaAtivo_(projeto);
  var modelosProjeto = getModelosEstoqueSoAPorProjeto(projeto);
  var reservas = getKitReservasLinhas_().filter(function(reserva) {
    var mesmoId = participanteIdNorm && normText_(reserva.participanteId) === participanteIdNorm;
    return (mesmoId || normText_(reserva.participante) === participanteNorm) &&
      normText_(reserva.projeto) === projetoNorm && normText_(reserva.status || 'Reservado') === 'reservado';
  });
  var estoque = getEstoque();
  var visitasJornada = jornadaVisitasDesdeInicioOperacional_(visitas.map(function(visita) { return jornadaPorId[visita.idSoA]; }));
  var previaCtms = null;
  if (jornadaCtmsProjetoPiloto_(projeto) || ctmsAtivo) {
    previaCtms = jornadaCtmsCalcularPreviaPura_({
      projeto: projeto,
      participante: nome,
      bracoId: bracoIdCtms,
      marcos: configCtms.marcos,
      escolhasReferencias: configCtms.escolhasReferencias,
      aprovacoes: configCtms.aprovacoes,
      motorAtivo: ctmsAtivo,
      visitas: visitas,
      eventos: eventos,
      legacyVisitas: visitasJornada,
      idsVisiveis: visitasJornada.map(function(visita) { return String(visita.idSoA || ''); })
    });
    previaCtms.projetoAtivo = ctmsAtivo;
    previaCtms.configuracao = jornadaCtmsMontarConfiguracao_(visitas, bracos, configCtms, braco.idBraco || '');
    visitasJornada = jornadaCtmsAplicarAoOperacional_(visitasJornada, previaCtms, hoje);
  }
  var bracoIdOperacional = ctmsAtivo && previaCtms && previaCtms.resumo.aprovadas > 0 ? bracoIdCtms : String(braco.idBraco || '');
  var modelos = modelosProjeto.filter(function(modelo) {
    return !modelo.bracosAplicaveisIds.length || modelo.bracosAplicaveisIds.indexOf(bracoIdOperacional) >= 0;
  });
  var visitasProntidao = jornadaVisitasPrevisaoSeisMeses_(visitasJornada, hoje);
  visitasJornada.forEach(function(visita) {
    if (visita.estado !== 'REALIZADA') {
      var modelosVisita = modelos.filter(function(modelo) { return modelo.visitasAplicaveisIds.indexOf(visita.idSoA) >= 0; });
      visita.kits = modelosVisita.map(function(modelo) {
      var reservasKit = jornadaReservasModeloVisita_(reservas, modelo, visita);
      var reserva = reservasKit[0] || null;
      var dataAlvo = visita.dataAlvoObj;
      var lotes = estoque.filter(function(item) { return String(item.idItem || '') === String(modelo.idItem || '') && Number(item.qtdeDisponivel) > 0; });
      var estoqueValido = !dataAlvo || lotes.some(function(lote) { var validade = agendaDateFromValue_(lote.validade); return validade && validade >= dataAlvo; });
      var validadeReserva = reserva && agendaDateFromValue_(reserva.validade);
      var reservaValida = !!(reserva && (!dataAlvo || (validadeReserva && validadeReserva >= dataAlvo)));
      var pedidos = lotes.map(function(lote) { return String(lote.numeroPedido || '').trim(); }).filter(Boolean);
      return {
        idItem: modelo.idItem, descricao: modelo.descricao, tipo: modelo.tipo, laboratorio: modelo.laboratorio,
        reservado: !!reserva, lote: reserva && reserva.idLote || '', validade: reserva && reserva.validade || '',
        idReserva: reserva && reserva.idReserva || '', statusReserva: reserva && reserva.status || '',
        qtdeReserva: reserva ? (Number(reserva.qtde) || 0) : 0,
        qtdeReservada: reservasKit.reduce(function(total, item) { return total + (Number(item.qtde) || 0); }, 0),
        reservaValida: reserva ? reservaValida : null, estoqueDisponivel: estoqueValido,
        pedidoAberto: pedidos[0] || '', risco: reserva ? !reservaValida : !estoqueValido
      };
      });
    } else {
      visita.kits = [];
    }
    delete visita.dataAlvoObj;
    delete visita.temEventoIPS;
  });
  var historicoLivre = eventos.filter(function(evento) { return !evento.cancelada && !eventos.some(function(outro) { return outro !== evento && outro.id === evento.id; }); });
  var conciliacao = agendaSoAMontarConcilicaoVisitas_(eventos, visitas);
  return {
    participante: { idCadastro: String(payload.idCadastro || ''), nome: nome, idParticipante: participanteId, projeto: projeto, braco: payload.braco || '' },
    possuiSoA: visitas.length > 0, visitas: visitasJornada,
    visitasConciliacao: jornadaVisitasParaConciliacao_(visitas),
    visitasProntidao: visitasProntidao,
    horizontePrevisao: formatarDataSafe(jornadaLimitePrevisao_(hoje)),
    eventosLivres: historicoLivre.map(function(evento) { return { visita: evento.visita, data: evento.dataLabel, status: evento.status, concluida: evento.concluida, idSoA: evento.idSoA || '' }; }),
    eventosAnteriores: eventosAnteriores.map(function(evento) { return { visita: evento.visita, data: evento.dataLabel, status: evento.status }; }),
    conciliacao: conciliacao,
    alertasCtms: previaCtms ? {
      projetoAtivo: ctmsAtivo,
      aprovadas: Number(previaCtms.resumo.aprovadas || 0),
      pendentes: Number(previaCtms.resumo.pendentesAprovacao || 0),
      obsoletas: Number(previaCtms.resumo.aprovacoesObsoletas || 0)
    } : null,
    previaCtms: previaCtms
  };
}

function jornadaReservaPreviaContexto_(payload) {
  payload = payload || {};
  var projeto = String(payload.projeto || '').trim();
  var participante = String(payload.participante || '').trim();
  var participanteId = String(payload.participanteId || '').trim();
  var idSoA = String(payload.idSoA || '').trim();
  var visita = String(payload.visita || '').trim();
  var dataVisita = agendaDateFromValue_(payload.dataVisita);
  if (!projeto || !participante || !participanteId || !idSoA || !visita || !dataVisita || isNaN(dataVisita.getTime())) {
    throw new Error('Informe participante, visita SoA e data estimada para reservar.');
  }
  dataVisita.setHours(0, 0, 0, 0);
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  if (dataVisita < hoje || dataVisita > jornadaLimitePrevisao_(hoje)) {
    throw new Error('A reserva antecipada está disponível somente para os próximos 6 meses.');
  }
  var visitaSoA = getSoAVisitasProjeto(projeto).filter(function(item) { return String(item.idSoA || '') === idSoA; })[0];
  if (!visitaSoA) throw new Error('A visita informada não pertence ao SoA deste projeto.');
  var braco = getBracosProjeto(projeto).filter(function(item) { return normText_(item.nome) === normText_(payload.braco); })[0] || {};
  var modelos = getModelosEstoqueSoAPorProjeto(projeto).filter(function(modelo) {
    return estoqueTipoEhKit_(modelo.tipo) && modelo.visitasAplicaveisIds.indexOf(idSoA) >= 0 &&
      (!modelo.bracosAplicaveisIds.length || modelo.bracosAplicaveisIds.indexOf(braco.idBraco) >= 0);
  });
  return { projeto: projeto, participante: participante, participanteId: participanteId, idSoA: idSoA, visita: visitaSoA.nome || visita, dataVisita: dataVisita, modelos: modelos };
}

function consultarReservaPreviaJornada(payload) {
  codexAssertCanWrite_('consultarReservaPreviaJornada', 'Estoque', payload && (payload.participanteId || payload.idSoA));
  var contexto = jornadaReservaPreviaContexto_(payload);
  // Linhas legadas de estoque podem existir sem ID_Lote. A reserva usa esse ID
  // como identidade estável; migre somente quando um dos modelos desta visita
  // ainda aponta para um lote sem ID e então releia os dados já normalizados.
  var estoque = getEstoque();
  var modelosPorId = {};
  contexto.modelos.forEach(function(modelo) { modelosPorId[String(modelo.idItem || '')] = true; });
  if (estoque.some(function(lote) { return modelosPorId[String(lote.idItem || '')] && !String(lote.idLote || '').trim(); })) {
    migrarIdsLotesEstoque();
    estoque = getEstoque();
  }
  var validadeMinima = new Date(contexto.dataVisita.getTime()); validadeMinima.setDate(validadeMinima.getDate() + 10);
  return {
    dataVisita: formatarDataIsoAgenda_(contexto.dataVisita),
    limite: formatarDataIsoAgenda_(jornadaLimitePrevisao_(new Date())),
    kits: contexto.modelos.map(function(modelo) {
      return {
        idItem: modelo.idItem, descricao: modelo.descricao, laboratorio: modelo.laboratorio || '',
        lotes: estoque.filter(function(lote) {
          var validade = agendaDateFromValue_(lote.validade);
          return String(lote.idItem || '') === String(modelo.idItem || '') && Number(lote.qtdeDisponivel) > 0 && validade && validade >= validadeMinima;
        }).map(function(lote) {
          return { idLote: lote.idLote, validade: formatarDataSafe(lote.validade), qtdeDisponivel: Number(lote.qtdeDisponivel) || 0, accessionNumber: lote.accessionNumber || '' };
        })
      };
    })
  };
}

function reservarKitsPrevisaoJornada(payload) {
  codexAssertCanWrite_('reservarKitsPrevisaoJornada', 'Estoque', payload && (payload.participanteId || payload.idSoA));
  return codexWithDocumentLock_('reservarKitsPrevisaoJornada', function() {
    var contexto = jornadaReservaPreviaContexto_(payload);
    var kits = Array.isArray(payload.kits) ? payload.kits : [];
    if (!kits.length) throw new Error('Selecione ao menos um lote para reservar.');
    var modelosPorItem = {};
    contexto.modelos.forEach(function(modelo) { modelosPorItem[String(modelo.idItem || '')] = modelo; });
    var estoque = getEstoque();
    var resumo = getKitReservasResumo_();
    var reservasAtuais = getKitReservasLinhas_();
    var validadeMinima = new Date(contexto.dataVisita.getTime()); validadeMinima.setDate(validadeMinima.getDate() + 10);
    var responsavel = Session.getActiveUser().getEmail() || '';
    var linhas = [];
    kits.forEach(function(kit) {
      var idItem = String(kit.idItem || '').trim();
      var idLote = String(kit.idLote || '').trim();
      var qtde = Number(kit.qtde || 1);
      if (!modelosPorItem[idItem] || !idLote || !isFinite(qtde) || qtde <= 0 || qtde % 1 !== 0) throw new Error('A seleção de kit para reserva é inválida.');
      if (reservasAtuais.some(function(reserva) {
        return normText_(reserva.status) === 'reservado' && String(reserva.participanteId || '') === contexto.participanteId &&
          normText_(reserva.projeto) === normText_(contexto.projeto) && String(reserva.idItem || '') === idItem &&
          normText_(reserva.visitaPrevista) === normText_(contexto.visita);
      })) throw new Error('Já existe uma reserva ativa deste kit para esta visita.');
      var lote = estoque.filter(function(item) { return String(item.idItem || '') === idItem && String(item.idLote || '') === idLote; })[0];
      if (!lote) throw new Error('O lote selecionado não foi localizado no estoque.');
      var validade = agendaDateFromValue_(lote.validade);
      if (!validade || validade < validadeMinima) throw new Error('O lote selecionado não possui validade suficiente para a data prevista.');
      var chave = kitReservaChave_(lote.idItem, lote.idLote, lote.validade, lote.localizacao, lote.accessionNumber);
      var disponivel = Math.max(0, Number(lote.qtde || 0) - Number(resumo[chave] || 0));
      if (qtde > disponivel) throw new Error('Saldo disponível insuficiente para reservar ' + String(lote.descricao || idItem) + '.');
      resumo[chave] = Number(resumo[chave] || 0) + qtde;
      linhas.push([gerarIdLoteEstoque_(), new Date(), '', contexto.projeto, contexto.participante,
        lote.idItem, lote.idLote, lote.descricao, validade, lote.localizacao, qtde, 'Reservado', contexto.dataVisita,
        responsavel, String(payload.observacoes || 'Reserva antecipada na Jornada do Participante.'), contexto.participanteId,
        contexto.visita, String(kit.accessionNumber || lote.accessionNumber || '')]);
    });
    var sheet = getKitReservasSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, KIT_RESERVA_HEADERS_.length).setValues(linhas);
    SpreadsheetApp.flush();
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return {
      ok: true,
      reservados: linhas.length,
      msg: linhas.length + ' kit(s) reservado(s). Vincule à Agenda quando a visita for agendada.',
      jornada: getJornadaParticipante({
        nome: contexto.participante,
        idParticipante: contexto.participanteId,
        projeto: contexto.projeto,
        braco: payload.braco || ''
      })
    };
  });
}

var AGENDA_SOA_CONCILIACAO_HEADERS_ = ['Agenda_ID', 'ID_SoA', 'Projeto', 'Participante_ID', 'Participante', 'Visita_original', 'Conciliado_em', 'Responsável'];
var AGENDA_SOA_INICIO_IPS_ = new Date(2026, 0, 1);

function getAgendaSoAConciliacaoSheet_(createIfMissing) {
  var ss = getCodexSpreadsheet_();
  var sheet = getSheetByPossibleNames_(ss, ['Agenda_SoA_Conciliacao', 'Agenda SoA Conciliacao']);
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet('Agenda_SoA_Conciliacao');
    sheet.getRange(1, 1, 1, AGENDA_SOA_CONCILIACAO_HEADERS_.length).setValues([AGENDA_SOA_CONCILIACAO_HEADERS_]);
  }
  return sheet;
}

function getAgendaSoAConciliacoesPorAgendaId_(ids) {
  var wanted = {};
  (ids || []).forEach(function(id) { id = String(id || '').trim(); if (id) wanted[id] = true; });
  if (!Object.keys(wanted).length) return {};
  var sheet = getAgendaSoAConciliacaoSheet_(false);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, AGENDA_SOA_CONCILIACAO_HEADERS_.length).getValues();
  var out = {};
  rows.forEach(function(row) {
    var agendaId = String(row[0] || '').trim();
    var idSoA = String(row[1] || '').trim();
    if (agendaId && idSoA && wanted[agendaId]) out[agendaId] = idSoA;
  });
  return out;
}

function agendaSoAEventoFazParteDoIPS_(evento) {
  return evento && evento.data && evento.data.getTime() >= AGENDA_SOA_INICIO_IPS_.getTime();
}

function agendaSoASugerirVisita_(nomeOriginal, visitas) {
  var nome = normText_(nomeOriginal).replace(/\s+/g, '');
  if (!nome) return null;
  var candidatos = (visitas || []).filter(function(visita) {
    var labels = [visita.nome, visita.codigo].concat(visita.aliases || []).map(function(label) { return normText_(label).replace(/\s+/g, ''); });
    return labels.indexOf(nome) >= 0;
  });
  if (candidatos.length === 1) return { idSoA: candidatos[0].idSoA, nivel: 'ALTA', motivo: 'Nome ou código equivalente' };
  var cicloDia = nome.match(/^c(\d+)d(\d+)$/i);
  if (!cicloDia) return null;
  var alvo = 'dia' + cicloDia[2] + 'dociclo' + cicloDia[1];
  candidatos = (visitas || []).filter(function(visita) {
    return normText_(visita.nome).replace(/\s+/g, '') === alvo;
  });
  return candidatos.length === 1 ? { idSoA: candidatos[0].idSoA, nivel: 'SUGESTÃO', motivo: 'Padrão CxDy reconhecido; revise antes de aplicar' } : null;
}

function agendaSoAMontarConcilicaoVisitas_(eventos, visitas) {
  var porNome = {};
  (eventos || []).forEach(function(evento) {
    if (!evento || evento.cancelada || evento.idSoA || !String(evento.visita || '').trim()) return;
    var chave = normText_(evento.visita);
    if (!chave) return;
    if (!porNome[chave]) porNome[chave] = { visitaOriginal: evento.visita, quantidade: 0, agendaIds: [], sugestao: agendaSoASugerirVisita_(evento.visita, visitas) };
    porNome[chave].quantidade++;
    if (evento.id) porNome[chave].agendaIds.push(evento.id);
  });
  return Object.keys(porNome).map(function(chave) { return porNome[chave]; })
    .sort(function(a, b) { return b.quantidade - a.quantidade || String(a.visitaOriginal).localeCompare(String(b.visitaOriginal), 'pt-BR'); });
}

function getConcilicaoVisitasParticipante(payload) {
  return getJornadaParticipante(payload).conciliacao || [];
}

function salvarConcilicaoVisitasParticipante_(payload) {
  payload = payload || {};
  var nome = String(payload.nome || '').trim();
  var participanteId = String(payload.idParticipante || '').trim();
  var projeto = String(payload.projeto || '').trim();
  var mapeamentos = Array.isArray(payload.mapeamentos) ? payload.mapeamentos : [];
  codexAssertCanWrite_('salvarConcilicaoVisitasParticipante', 'Agenda', participanteId || nome || projeto);
  if (!nome || !projeto || !mapeamentos.length) throw new Error('Informe participante, projeto e ao menos uma conciliação.');
  var visitasProjeto = getSoAVisitasProjeto(projeto);
  var visitasPorId = {};
  visitasProjeto.forEach(function(visita) { visitasPorId[String(visita.idSoA || '')] = visita; });
  var porNome = {};
  mapeamentos.forEach(function(item) {
    var visitaOriginal = String(item && item.visitaOriginal || '').trim();
    var idSoA = String(item && item.idSoA || '').trim();
    if (!visitaOriginal || !idSoA || !visitasPorId[idSoA]) throw new Error('Há uma visita SoA inválida na conciliação.');
    porNome[normText_(visitaOriginal)] = idSoA;
  });
  return codexWithDocumentLock_('salvarConcilicaoVisitasParticipante', function() {
    var agenda = getAgendaSheetForRead_();
    var rows = agenda.getLastRow() >= 2 ? agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol).getValues() : [];
    var idx = AGENDA_CFG.idx;
    var participanteNorm = normText_(nome);
    var participanteIdNorm = normText_(participanteId);
    var projetoNorm = normText_(projeto);
    var encontrados = [];
    rows.forEach(function(row) {
      if (!AgendaServerRules_.isVisit(row[idx.tipo]) || AgendaServerRules_.isCancelled(row[idx.status])) return;
      var data = agendaDateFromValue_(row[idx.data]);
      var mesmoId = participanteIdNorm && normText_(row[idx.idParticipante]) === participanteIdNorm;
      if ((!mesmoId && normText_(row[idx.participante]) !== participanteNorm) || normText_(row[idx.projeto]) !== projetoNorm || !data || !agendaSoAEventoFazParteDoIPS_({ data: data })) return;
      var idSoA = porNome[normText_(row[idx.visita])];
      var agendaId = String(row[idx.id] || '').trim();
      if (idSoA && agendaId) encontrados.push({ agendaId: agendaId, idSoA: idSoA, visitaOriginal: String(row[idx.visita] || '').trim() });
    });
    var sheet = getAgendaSoAConciliacaoSheet_(true);
    var existentes = {};
    if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, AGENDA_SOA_CONCILIACAO_HEADERS_.length).getValues().forEach(function(row, index) { if (row[0]) existentes[String(row[0])] = index + 2; });
    var agora = new Date();
    var responsavel = codexGetActiveUserEmail_();
    encontrados.forEach(function(item) {
      var values = [[item.agendaId, item.idSoA, projeto, participanteId, nome, item.visitaOriginal, agora, responsavel]];
      if (existentes[item.agendaId]) sheet.getRange(existentes[item.agendaId], 1, 1, AGENDA_SOA_CONCILIACAO_HEADERS_.length).setValues(values);
      else sheet.getRange(sheet.getLastRow() + 1, 1, 1, AGENDA_SOA_CONCILIACAO_HEADERS_.length).setValues(values);
    });
    return { ok: true, conciliados: encontrados.length, ignoradosSemId: mapeamentos.length && !encontrados.length ? 1 : 0, msg: encontrados.length + ' visita(s) conciliada(s) sem alterar o nome original.' };
  });
}

function agendaDateIsBeforeToday_(valor) {
  var d = parseAgendaDateAny_(valor);
  if (!d || isNaN(d.getTime())) return false;
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime() < hoje.getTime();
}

function agendaDateIsAfterToday_(valor) {
  var d = parseAgendaDateAny_(valor);
  if (!d || isNaN(d.getTime())) return false;
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime() > hoje.getTime();
}

function agendaRealizadoFuturoErro_(status, datas) {
  if (!AgendaServerRules_.isCompleted(status)) return '';
  datas = Array.isArray(datas) ? datas : [datas];
  for (var i = 0; i < datas.length; i++) {
    if (agendaDateIsAfterToday_(datas[i])) {
      return 'Eventos futuros nao podem ser marcados como Realizado ou Concluido.';
    }
  }
  return '';
}

function agendaCourierStatusFuturoErro_(dados, dataEvento, rowAnterior) {
  if (!agendaDateIsAfterToday_(dataEvento)) return '';
  dados = dados || {};
  var idx = AGENDA_CFG.idx;
  var slots = [
    { label: 'Transporte I', value: dados.courier1, oldIdx: idx.c1.status },
    { label: 'Transporte II', value: dados.courier2, oldIdx: idx.c2.status },
    { label: 'Transporte III', value: dados.courier3, oldIdx: idx.c3.status },
    { label: 'Transporte Backup', value: dados.backup, oldIdx: idx.cb.status }
  ];
  for (var i = 0; i < slots.length; i++) {
    var statusNovo = String(slots[i].value && slots[i].value.status || '').trim();
    if (!AgendaServerRules_.courierStatusRequiresEventDate(statusNovo)) continue;
    var statusAnterior = rowAnterior ? String(rowAnterior[slots[i].oldIdx] || '').trim() : '';
    if (rowAnterior && normText_(statusNovo) === normText_(statusAnterior)) continue;
    return slots[i].label + ' nao pode ser marcado como ' + statusNovo + ' antes da data da visita.';
  }
  return '';
}

function isAgendaTipoVisita_(tipo) {
  return AgendaServerRules_.formPolicy(tipo).usesParticipantWorkflow;
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
    var agenda = getAgendaSheetForRead_();
    var lastRow = agenda.getLastRow();
    if (lastRow < 2) return out;
    var vals = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
    var idx = AGENDA_CFG.idx;
    var hoje = new Date();
    hoje.setHours(23, 59, 59, 999);
    vals.forEach(function(r) {
      var participante = normText_(r[idx.participante]);
      if (!participante) return;
      if (!AgendaServerRules_.isVisit(r[idx.tipo])) return;
      var status = normText_(r[idx.status]);
      if (!AgendaServerRules_.isCompleted(status)) return;
      var dt = agendaDateFromValue_(r[idx.data]);
      if (!dt || dt.getTime() > hoje.getTime()) return;
      if (!out[participante] || dt.getTime() > out[participante].dataObj.getTime()) {
        out[participante] = {
          dataObj: dt,
          data: formatarDataSafe(r[idx.data]),
          dataIso: formatarDataIsoAgenda_(dt),
          visita: String(r[idx.visita] || '---')
        };
      }
    });
    Object.keys(out).forEach(function(k) {
      out[k] = { data: out[k].data, dataIso: out[k].dataIso, visita: out[k].visita };
    });
    return out;
  } catch(e) {
    return out;
  }
}

function agendaVisitaCriadaNaMesmaData_(agenda, dados, dataEvento) {
  dados = dados || {};
  if (!AgendaServerRules_.isVisit(dados.tipo)) return null;
  var participante = String(dados.participante || '').trim();
  if (!participante || !agenda || agenda.getLastRow() < 2) return null;
  var dataIso = formatarDataIsoAgenda_(dataEvento || dados.data);
  if (!dataIso) return null;

  var referencia = {
    nome: participante,
    idParticipante: String(dados.participanteId || dados.idParticipante || '').trim(),
    projeto: String(dados.projeto || '').trim()
  };
  var idx = AGENDA_CFG.idx;
  var rows = agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol).getValues();
  var encontradas = rows.filter(function(row) {
    if (!AgendaServerRules_.isVisit(row[idx.tipo])) return false;
    if (formatarDataIsoAgenda_(row[idx.data]) !== dataIso) return false;
    return CadastroRules_.agendaEventMatchesParticipant(referencia, {
      participante: row[idx.participante],
      idParticipante: row[idx.idParticipante],
      projeto: row[idx.projeto]
    });
  });
  if (!encontradas.length) return null;
  return {
    visitaMesmaData: true,
    data: dataIso,
    quantidade: encontradas.length,
    mensagem: 'Já existe uma visita criada para este participante nesta data.'
  };
}

function salvarNovoEventoCompleto(dados) {
  codexAssertCanWrite_('salvarNovoEventoCompleto', 'Agenda', dados && dados.id);
  return codexWithDocumentLock_('salvarNovoEventoCompleto', function() {
  dados = dados || {};
  dados.status = 'Agendado';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var backupOrigemId = String(dados.backupOrigemAgendaId || '').trim();
  if (backupOrigemId && !agendaRowNumberById_(agenda, backupOrigemId)) {
    return { erro: 'O agendamento de origem do backup não foi encontrado. Atualize a Agenda e tente novamente.' };
  }
  var erroTemperaturaBackup = agendaNovoEnvioBackupTemperaturaErro_(dados);
  if (erroTemperaturaBackup) return { erro: erroTemperaturaBackup };
  var policy = AgendaServerRules_.formPolicy(dados.tipo);
  var isMonitoria = policy.isMonitoring;
  var isPeriodo = policy.isOperationalPeriod;
  if (policy.requiresTime && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  var d = _parseDateHora(dados.data, dados.hora);
  var erroCourierFuturo = agendaCourierStatusFuturoErro_(dados, d, null);
  if (erroCourierFuturo) return { erro: erroCourierFuturo };
  var visitaMesmaData = agendaVisitaCriadaNaMesmaData_(agenda, dados, d);
  if (visitaMesmaData && dados.salvarVisitaMesmaDataConfirmado !== true) return visitaMesmaData;
  if (isMonitoria && !String(dados.salaMonitoria || '').trim()) {
    return { erro: 'Informe o local (sala) da monitoria.' };
  }
  if (policy.isSiv && !String(dados.projeto || '').trim()) {
    return { erro: 'Informe o projeto/protocolo do SIV.' };
  }
  if (isMonitoria && !String(dados.monitorName || '').trim()) {
    return { erro: 'Informe ao menos um monitor.' };
  }
  var datasPeriodo = isPeriodo ? agendaDatasPeriodo_(dados.data, dados.dataFim, agendaTipoPeriodoLabel_(dados.tipo)) : [d];
  var erroRealizadoFuturo = agendaRealizadoFuturoErro_(dados.status, datasPeriodo);
  if (erroRealizadoFuturo) return { erro: erroRealizadoFuturo };
  var operationalAlerts = agendaOperationalRiskAlerts_(dados, datasPeriodo);
  if (isPeriodo) {
    var ids = [];
    for (var k = 0; k < datasPeriodo.length; k++) {
      var dadosDia = agendaCloneDados_(dados);
      var resDia = _gravarLinhaEvento(agenda, agendaDateWithHora_(datasPeriodo[k], dados.hora), dadosDia, ss);
      if (resDia && resDia.erro) return resDia;
      if (resDia && resDia.id) ids.push(resDia.id);
    }
    var resultadoPeriodo = { ok: true, id: ids[0] || '', ids: ids, count: ids.length, tipo: agendaTipoPeriodoLabel_(dados.tipo), emailLabAtivo: agendaEmailEnabled_(), operationalAlerts: operationalAlerts };
    agendaVincularBackupAoAgendamento_(agenda, backupOrigemId, resultadoPeriodo.id, datasPeriodo[0]);
    return resultadoPeriodo;
  }
  var resultado = _gravarLinhaEvento(agenda, d, dados, ss);
  if (resultado && resultado.ok) agendaVincularBackupAoAgendamento_(agenda, backupOrigemId, resultado.id, d);
  if (resultado && resultado.ok) resultado.operationalAlerts = operationalAlerts;
  return resultado;
  });
}

function salvarNovoEventoComFeriado(dados) {
  codexAssertCanWrite_('salvarNovoEventoComFeriado', 'Agenda', dados && dados.id);
  return codexWithDocumentLock_('salvarNovoEventoComFeriado', function() {
  dados = dados || {};
  dados.status = 'Agendado';
  var agenda = getAgendaSheet_();
  var backupOrigemId = String(dados.backupOrigemAgendaId || '').trim();
  if (backupOrigemId && !agendaRowNumberById_(agenda, backupOrigemId)) {
    return { erro: 'O agendamento de origem do backup não foi encontrado. Atualize a Agenda e tente novamente.' };
  }
  var erroTemperaturaBackup = agendaNovoEnvioBackupTemperaturaErro_(dados);
  if (erroTemperaturaBackup) return { erro: erroTemperaturaBackup };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var policy = AgendaServerRules_.formPolicy(dados.tipo);
  if (policy.requiresTime && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  if (policy.isOperationalPeriod) {
    if (policy.isSiv && !String(dados.projeto || '').trim()) {
      return { erro: 'Informe o projeto/protocolo do SIV.' };
    }
    if (policy.isMonitoring && !String(dados.monitorName || '').trim()) {
      return { erro: 'Informe ao menos um monitor.' };
    }
    if (policy.isMonitoring && !String(dados.salaMonitoria || '').trim()) {
      return { erro: 'Informe o local (sala).' };
    }
    var datas = agendaDatasPeriodo_(dados.data, dados.dataFim, agendaTipoPeriodoLabel_(dados.tipo));
    var erroRealizadoFuturo = agendaRealizadoFuturoErro_(dados.status, datas);
    if (erroRealizadoFuturo) return { erro: erroRealizadoFuturo };
    var ids = [];
    for (var i = 0; i < datas.length; i++) {
      var resDia = _gravarLinhaEvento(agenda, agendaDateWithHora_(datas[i], dados.hora), agendaCloneDados_(dados), ss);
      if (resDia && resDia.erro) return resDia;
      if (resDia && resDia.id) ids.push(resDia.id);
    }
    var resultadoPeriodo = { ok: true, id: ids[0] || '', ids: ids, count: ids.length, tipo: agendaTipoPeriodoLabel_(dados.tipo), emailLabAtivo: agendaEmailEnabled_() };
    agendaVincularBackupAoAgendamento_(agenda, backupOrigemId, resultadoPeriodo.id, datas[0]);
    return resultadoPeriodo;
  }
  var d = _parseDateHora(dados.data, dados.hora);
  var erroCourierFuturo = agendaCourierStatusFuturoErro_(dados, d, null);
  if (erroCourierFuturo) return { erro: erroCourierFuturo };
  var visitaMesmaData = agendaVisitaCriadaNaMesmaData_(agenda, dados, d);
  if (visitaMesmaData && dados.salvarVisitaMesmaDataConfirmado !== true) return visitaMesmaData;
  var erroRealizadoFuturoUnico = agendaRealizadoFuturoErro_(dados.status, d);
  if (erroRealizadoFuturoUnico) return { erro: erroRealizadoFuturoUnico };
  var resultado = _gravarLinhaEvento(agenda, d, dados, ss);
  if (resultado && resultado.ok) agendaVincularBackupAoAgendamento_(agenda, backupOrigemId, resultado.id, d);
  return resultado;
  });
}

function agendaDatasPeriodoMonitoria_(dataInicio, dataFim) {
  return agendaDatasPeriodo_(dataInicio, dataFim, 'monitoria');
}

function agendaTipoPeriodo_(tipo) {
  return AgendaServerRules_.isOperationalPeriod(tipo);
}

function agendaTipoPeriodoLabel_(tipo) {
  return AgendaServerRules_.isSiv(tipo) ? 'SIV' : 'Monitoria';
}

function agendaDatasPeriodo_(dataInicio, dataFim, label) {
  label = label || 'evento';
  var ini = parseAgendaDateAny_(dataInicio);
  var fim = parseAgendaDateAny_(dataFim || dataInicio);
  if (!ini || isNaN(ini.getTime())) throw new Error('Informe a Data de Inicio da ' + label + '.');
  if (!fim || isNaN(fim.getTime())) throw new Error('Informe a Data Final da ' + label + '.');
  ini.setHours(0, 0, 0, 0);
  fim.setHours(0, 0, 0, 0);
  if (fim.getTime() < ini.getTime()) throw new Error('Data Final deve ser igual ou posterior a Data de Inicio.');
  var out = [];
  var d = new Date(ini);
  while (d.getTime() <= fim.getTime()) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 1);
    if (out.length > 370) throw new Error('Periodo de ' + label + ' muito longo. Revise as datas.');
  }
  return out;
}

function agendaDateWithHora_(data, horaStr) {
  var d = new Date(data);
  var h = String(horaStr || '00:00').split(':');
  d.setHours(Number(h[0] || 0), Number(h[1] || 0), 0, 0);
  return d;
}

function agendaCloneDados_(dados) {
  var clone = {};
  Object.keys(dados || {}).forEach(function(k) {
    var v = dados[k];
    clone[k] = v && typeof v === 'object' && !(v instanceof Date) ? JSON.parse(JSON.stringify(v)) : v;
  });
  return clone;
}

function agendaPeriodoRowsDoPeriodo_(agenda, linha, rowRef, tipoPeriodo) {
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return [];
  var idx = AGENDA_CFG.idx;
  var ref = rowRef || agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var tipoPeriodoValue = tipoPeriodo || ref[idx.tipo];
  var candidatos = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues()
    .map(function(row, i) {
      var data = parseAgendaDateAny_(row[idx.data]);
      if (!data) return null;
      data.setHours(0, 0, 0, 0);
      if (!AgendaServerRules_.sameType(row[idx.tipo], tipoPeriodoValue)) return null;
      if (normText_(row[idx.projeto]) !== normText_(ref[idx.projeto])) return null;
      if (AgendaServerRules_.isOperationalPeriod(tipoPeriodoValue)) {
        if (normText_(row[idx.monitorName]) !== normText_(ref[idx.monitorName])) return null;
        if (normText_(row[idx.salaMonitoria]) !== normText_(ref[idx.salaMonitoria])) return null;
      }
      return { rowIndex: i + 2, row: row, data: data };
    })
    .filter(Boolean)
    .sort(function(a, b) {
      var diff = a.data.getTime() - b.data.getTime();
      return diff || (a.rowIndex - b.rowIndex);
    });
  var pos = -1;
  for (var i = 0; i < candidatos.length; i++) {
    if (candidatos[i].rowIndex === linha) {
      pos = i;
      break;
    }
  }
  if (pos < 0) return [{ rowIndex: linha, row: ref, data: parseAgendaDateAny_(ref[idx.data]) }];
  var start = pos;
  var end = pos;
  while (start > 0 && agendaDatasConsecutivas_(candidatos[start - 1].data, candidatos[start].data)) start--;
  while (end < candidatos.length - 1 && agendaDatasConsecutivas_(candidatos[end].data, candidatos[end + 1].data)) end++;
  return candidatos.slice(start, end + 1);
}

function agendaMonitoriaRowsDoPeriodo_(agenda, linha, rowRef) {
  return agendaPeriodoRowsDoPeriodo_(agenda, linha, rowRef, 'monitoria');
}

function agendaDatasConsecutivas_(a, b) {
  if (!a || !b) return false;
  var da = new Date(a);
  var db = new Date(b);
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000) === 1;
}

function agendaWriteMonitoriaRow_(agenda, linha, dataDia, dados, rowAnterior) {
  agendaWritePeriodoRow_(agenda, linha, dataDia, dados, rowAnterior, 'monitoria');
}

function agendaWritePeriodoRow_(agenda, linha, dataDia, dados, rowAnterior, tipoPeriodo) {
  var d = agendaDateWithHora_(dataDia, dados.hora);
  var status = String(dados.status || 'Agendado').trim();
  var erroRealizadoFuturo = agendaRealizadoFuturoErro_(status, d);
  if (erroRealizadoFuturo) throw new Error(erroRealizadoFuturo);
  var policy = AgendaServerRules_.formPolicy(tipoPeriodo || dados.tipo);
  var isPeriodoComMonitor = policy.isOperationalPeriod;
  var isMonitoria = policy.isMonitoring;
  var tipoLabel = String(dados.tipo || (isMonitoria ? 'Monitoria' : 'SIV')).trim();
  agenda.getRange(linha, AGENDA_CFG.col.data, 1, AGENDA_CFG.col.kit - AGENDA_CFG.col.data + 1).setValues([[
    formatAgendaDatePt_(d),
    formatAgendaHora_(d),
    tipoLabel,
    status,
    '',
    '',
    '',
    dados.projeto || '',
    '',
    '',
    '',
    '',
    '',
    dados.obs || '',
    'Não aplicável',
    rowAnterior[AGENDA_CFG.idx.controle] || '',
    ''
  ]]);
  agenda.getRange(linha, AGENDA_CFG.col.reqStatus, 1, 6).setValues([[
    '',
    isPeriodoComMonitor ? (dados.monitorName || '') : '',
    rowAnterior[AGENDA_CFG.idx.poloTrial] || '',
    rowAnterior[AGENDA_CFG.idx.ecrf] || '',
    isPeriodoComMonitor ? (dados.salaMonitoria || '') : '',
    false
  ]]);
  // A conversao para periodo operacional limpa explicitamente os transportes.
  // O setter exige a mesma intencao explicita usada quando o usuario toca a AWB.
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c1, { awb: '', awbTouched: true });
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c2, { awb: '', awbTouched: true });
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c3, { awb: '', awbTouched: true });
  agendaSetBackupLinha_(agenda, linha, {});
  agendaSetTransporteExtraLinha_(agenda, linha, {});
  if (AgendaServerRules_.isCancelled(status)) aplicarLogicaCancelamento_(agenda, linha, status);
}

function agendaAtualizarPeriodoMonitoria_(agenda, ss, linha, rowAnterior, dados) {
  return agendaAtualizarPeriodoEvento_(agenda, ss, linha, rowAnterior, dados, 'monitoria');
}

function agendaAtualizarPeriodoEvento_(agenda, ss, linha, rowAnterior, dados, tipoPeriodo) {
  var label = agendaTipoPeriodoLabel_(tipoPeriodo || dados.tipo);
  var datas = agendaDatasPeriodo_(dados.data, dados.dataFim, label);
  var atuais = agendaPeriodoRowsDoPeriodo_(agenda, linha, rowAnterior, tipoPeriodo || dados.tipo);
  var ids = [];
  var atualizar = Math.min(atuais.length, datas.length);
  for (var i = 0; i < atualizar; i++) {
    var item = atuais[i];
    var antes = item.row;
    agendaWritePeriodoRow_(agenda, item.rowIndex, datas[i], dados, antes, tipoPeriodo || dados.tipo);
    var depois = agenda.getRange(item.rowIndex, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
    var idAtual = String(depois[AGENDA_CFG.idx.id] || antes[AGENDA_CFG.idx.id] || '').trim();
    if (idAtual) ids.push(idAtual);
    codexWriteAuditChanges_('Agenda', 'atualizarAgendaEventoCompleto', idAtual || dados.id, agendaAuditChangesFromRows_(antes, depois), 'Alteração de período de ' + label);
  }
  var remover = atuais.slice(datas.length).sort(function(a, b) { return b.rowIndex - a.rowIndex; });
  remover.forEach(function(item) {
    var idRemovido = String(item.row[AGENDA_CFG.idx.id] || '').trim();
    agenda.deleteRow(item.rowIndex);
    codexWriteAuditChanges_('Agenda', 'atualizarAgendaEventoCompleto', idRemovido || dados.id, [{
      field: label,
      oldValue: formatarDataSafe(item.row[AGENDA_CFG.idx.data]),
      newValue: ''
    }], 'Data removida do período de ' + label);
  });
  for (var j = atuais.length; j < datas.length; j++) {
    var clone = agendaCloneDados_(dados);
    var res = _gravarLinhaEvento(agenda, agendaDateWithHora_(datas[j], dados.hora), clone, ss);
    if (res && res.id) ids.push(res.id);
  }
  if (agenda.getLastRow() > 2) {
    agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol)
      .sort([{ column: AGENDA_CFG.col.data, ascending: true }, { column: AGENDA_CFG.col.hora, ascending: true }]);
  }
  SpreadsheetApp.flush();
  return { ok: true, id: ids[0] || dados.id, ids: ids, count: datas.length, tipo: label, atualizado: true, emailLabAtivo: agendaEmailEnabled_() };
}

function agendaAuditFields_() {
  var i = AGENDA_CFG.idx;
  return [
    { field: 'Data', idx: i.data },
    { field: 'Horário', idx: i.hora },
    { field: 'Tipo de evento', idx: i.tipo },
    { field: 'Status', idx: i.status },
    { field: 'Participante', idx: i.participante },
    { field: 'Data de nascimento', idx: i.nasc },
    { field: 'Número de identificação', idx: i.idParticipante },
    { field: 'Protocolo', idx: i.projeto },
    { field: 'Visita', idx: i.visita },
    { field: 'Médico', idx: i.medico },
    { field: 'Serviço terceirizado', idx: i.servTerc },
    { field: 'Laboratório Central', idx: i.labCentral },
    { field: 'Controle Lab Central', idx: i.controle },
    { field: 'Kit', idx: i.kit },
    { field: 'Transporte I - Courier', idx: i.c1.nome },
    { field: 'Transporte I - Temperatura', idx: i.c1.temp },
    { field: 'Transporte I - Status', idx: i.c1.status },
    { field: 'Transporte I - AWB', idx: i.c1.awb },
    { field: 'Transporte I - Material', idx: i.c1.material },
    { field: 'Transporte I - Destino', idx: i.c1.destino },
    { field: 'Transporte II - Courier', idx: i.c2.nome },
    { field: 'Transporte II - Temperatura', idx: i.c2.temp },
    { field: 'Transporte II - Status', idx: i.c2.status },
    { field: 'Transporte II - AWB', idx: i.c2.awb },
    { field: 'Transporte II - Material', idx: i.c2.material },
    { field: 'Transporte II - Destino', idx: i.c2.destino },
    { field: 'Transporte III - Courier', idx: i.c3.nome },
    { field: 'Transporte III - Temperatura', idx: i.c3.temp },
    { field: 'Transporte III - Status', idx: i.c3.status },
    { field: 'Transporte III - AWB', idx: i.c3.awb },
    { field: 'Transporte III - Material', idx: i.c3.material },
    { field: 'Transporte III - Destino', idx: i.c3.destino },
    { field: 'Backup - Courier', idx: i.cb.nome },
    { field: 'Backup - Temperatura', idx: i.cb.temp },
    { field: 'Backup - Status', idx: i.cb.status },
    { field: 'Backup - Material', idx: i.cb.material },
    { field: 'Backup - Destino', idx: i.cb.destino },
    { field: 'Status Requisição', idx: i.reqStatus },
    { field: 'Monitor', idx: i.monitorName },
    { field: 'Sala/local', idx: i.salaMonitoria },
    { field: 'Carro requerido', idx: i.carroRequerido },
    { field: 'Polo Trial concluído', idx: i.poloTrial },
    { field: 'eCRF concluída', idx: i.ecrf }
  ];
}

function agendaNormalizeCancelamentoMotivo_(dados) {
  dados = dados || {};
  var categoria = String(dados.categoria || '').trim();
  var motivo = String(dados.motivo || '').trim();
  var motivoBase = String(dados.motivoBase || '').trim();
  if (motivo.length > 255) motivo = motivo.slice(0, 255);
  if (motivoBase.length > 255) motivoBase = motivoBase.slice(0, 255);
  return {
    categoria: categoria,
    motivo: motivo,
    motivoBase: motivoBase
  };
}

function agendaCancelamentoMotivoTexto_(dados) {
  var info = agendaNormalizeCancelamentoMotivo_(dados);
  if (!info.categoria || !info.motivo) return '';
  var partes = ['Cancelamento'];
  partes.push('Categoria: ' + info.categoria);
  if (info.motivoBase && info.motivoBase !== info.motivo) partes.push('Opção: ' + info.motivoBase);
  partes.push('Motivo: ' + info.motivo);
  return partes.join(' | ');
}

function agendaAppendCancelamentoMotivo_(obs, dados) {
  var texto = agendaCancelamentoMotivoTexto_(dados);
  if (!texto) throw new Error('Informe o motivo do cancelamento antes de cancelar a visita.');
  obs = String(obs || '').trim();
  var semMotivoAnterior = obs
    .split(/\r?\n/)
    .filter(function(linha) { return normText_(linha).indexOf('cancelamento | categoria:') !== 0; })
    .join('\n')
    .trim();
  return semMotivoAnterior ? (semMotivoAnterior + '\n' + texto) : texto;
}

function agendaExtractCancelamentoMotivo_(obs) {
  var linhas = String(obs || '').split(/\r?\n/);
  for (var i = linhas.length - 1; i >= 0; i--) {
    var linha = String(linhas[i] || '').trim();
    if (normText_(linha).indexOf('cancelamento | categoria:') === 0) return linha;
  }
  return '';
}

function agendaCancelamentoMotivoHtml_(obs) {
  var texto = agendaExtractCancelamentoMotivo_(obs);
  if (!texto) return '';
  return '<div style="background:#fff3cd;padding:10px;border-left:5px solid #c0392b;margin:12px 0;">' +
    '<p style="margin:0;"><b>Motivo do cancelamento:</b> ' + escHtmlServer_(texto.replace(/^Cancelamento\s*\|\s*/i, '')) + '</p>' +
    '</div>';
}

function agendaPostVisitValue_(value, previous) {
  if (value === true || String(value || '').trim() === 'Sim') return previous || new Date();
  if (String(value || '').trim()) return value;
  return '';
}

function agendaStatusConcluido_(status) {
  return AgendaServerRules_.isConcluded(status);
}

function agendaPostVisitConcluidoPorStatus_(status, tipo) {
  return agendaStatusConcluido_(status) && AgendaServerRules_.isPostVisitType(tipo);
}

function agendaBooleanValue_(value) {
  if (value === true || value === 1) return true;
  var normalized = normText_(value);
  return normalized === 'sim' || normalized === 'true' || normalized === '1' ||
    normalized === 'yes' || normalized === 'on';
}

function agendaNascimentoFromDados_(dados, rowAnterior) {
  dados = dados || {};
  var nascimento = String(dados.nascimento || '').trim();
  if (nascimento) return nascimento;

  var i = AGENDA_CFG.idx;
  var participante = String(dados.participante || '').trim();
  if (rowAnterior && participante && participante === String(rowAnterior[i.participante] || '').trim()) {
    nascimento = String(rowAnterior[i.nasc] || '').trim();
    if (nascimento) return nascimento;
  }

  if (!participante) return '';
  var info = getInfoParticipante(participante);
  return info && info.nascimento ? info.nascimento : '';
}

function agendaIdParticipanteFromDados_(dados, rowAnterior) {
  dados = dados || {};
  var participante = String(dados.participante || '').trim();
  if (!participante) return '';
  var idInformado = String(dados.idParticipante || '').trim();
  if (idInformado) return idInformado;
  var i = AGENDA_CFG.idx;
  if (rowAnterior && participante === String(rowAnterior[i.participante] || '').trim()) {
    var idAnterior = String(rowAnterior[i.idParticipante] || '').trim();
    if (idAnterior) return idAnterior;
  }
  var info = getInfoParticipante(participante);
  return info ? String(info.numId || '').trim() : '';
}

// Em Visitas e Consultas, o projeto e uma propriedade do participante
// cadastrado. Isso protege o vinculo mesmo quando a RPC nao passa pela Agenda.
function agendaSincronizarProjetoDoParticipante_(dados, policy) {
  dados = dados || {};
  if (!policy || (!policy.isVisit && policy.type !== 'consulta')) return null;
  var participante = String(dados.participante || '').trim();
  if (!participante) return null;
  var info = getInfoParticipante(participante);
  var projeto = String(info && info.projeto || '').trim();
  if (!projeto) return { erro: 'O participante selecionado nao possui projeto/protocolo cadastrado.' };
  dados.projeto = projeto;
  return null;
}

function agendaBracoFromDados_(dados, rowAnterior) {
  dados = dados || {};
  var participante = String(dados.participante || '').trim();
  if (!participante) return '';
  var bracoInformado = String(dados.braco || '').trim();
  if (bracoInformado) return bracoInformado;
  var i = AGENDA_CFG.idx;
  if (rowAnterior && participante === String(rowAnterior[i.participante] || '').trim()) {
    var bracoAnterior = String(rowAnterior[i.braco] || '').trim();
    if (bracoAnterior) return bracoAnterior;
  }
  var info = getInfoParticipante(participante);
  return info ? String(info.braco || '').trim() : '';
}

function agendaAuditChangesFromRows_(oldRow, newRow) {
  oldRow = oldRow || [];
  newRow = newRow || [];
  return agendaAuditFields_().map(function(def) {
    return {
      field: def.field,
      oldValue: oldRow[def.idx],
      newValue: newRow[def.idx]
    };
  }).filter(function(c) {
    return codexAuditValue_(c.oldValue) !== codexAuditValue_(c.newValue);
  });
}

function atualizarAgendaEventoCompleto(dados) {
  codexAssertCanWrite_('atualizarAgendaEventoCompleto', 'Agenda', dados && dados.id);
  return codexWithDocumentLock_('atualizarAgendaEventoCompleto', function() {
  dados = dados || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var linha = agendaLocalizarLinhaPorId_(agenda, String(dados.id || '').trim(), dados._rowIndex);
  if (!linha) throw new Error('Agendamento nao encontrado para edicao.');
  var rowAnterior = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var versaoAtual = agendaRecordVersionFromRow_(rowAnterior);
  var versaoEsperada = String(dados._recordVersion || '').trim();
  var versaoEditavelAtual = agendaEditableRecordVersionFromRow_(rowAnterior);
  var versaoEditavelEsperada = String(dados._editRecordVersion || '').trim();
  var conflitoApenasAuxiliar = versaoEsperada && versaoEsperada !== versaoAtual &&
    versaoEditavelEsperada && versaoEditavelEsperada === versaoEditavelAtual;
  if (versaoEsperada && versaoEsperada !== versaoAtual && !conflitoApenasAuxiliar) {
    return {
      conflito: true,
      erro: 'Este agendamento foi alterado desde que voce abriu. Atualize a Agenda antes de salvar para evitar sobrescrever informacoes.',
      id: dados.id,
      currentVersion: versaoAtual,
      currentEditVersion: versaoEditavelAtual
    };
  }
  var tipo = String(dados.tipo || '').trim();
  var status = String(dados.status || 'Agendado').trim();
  var labCentral = String(dados.labCentral || '').trim();
  var policy = AgendaServerRules_.formPolicy(tipo);
  var isMonitoria = policy.isMonitoring;
  var isSiv = policy.isSiv;
  var isPeriodo = policy.isOperationalPeriod;
  var projetoParticipanteErro = agendaSincronizarProjetoDoParticipante_(dados, policy);
  if (projetoParticipanteErro) return projetoParticipanteErro;
  if (policy.requiresTime && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  if (policy.requiresDoctor && !String(dados.medico || '').trim()) {
    return { erro: 'Informe o médico responsável pela consulta.' };
  }
  var d = _parseDateHora(dados.data, dados.hora);
  var erroCourierFuturo = agendaCourierStatusFuturoErro_(dados, d, rowAnterior);
  if (erroCourierFuturo) return { erro: erroCourierFuturo };
  var datasValidacaoStatus = isPeriodo
    ? agendaDatasPeriodo_(dados.data, dados.dataFim, agendaTipoPeriodoLabel_(dados.tipo))
    : [d];
  var erroRealizadoFuturo = agendaRealizadoFuturoErro_(status, datasValidacaoStatus);
  if (erroRealizadoFuturo) return { erro: erroRealizadoFuturo };
  dados.carroRequerido = policy.isVisit && agendaBooleanValue_(dados.carroRequerido);
  if (isMonitoria) {
    if (!String(dados.projeto || '').trim()) {
      return { erro: 'Informe o projeto/protocolo da monitoria.' };
    }
    if (!String(dados.salaMonitoria || '').trim()) {
      return { erro: 'Informe o local (sala) da monitoria.' };
    }
    if (!String(dados.monitorName || '').trim()) {
      return { erro: 'Informe ao menos um monitor.' };
    }
    dados.participante = '';
    dados.visita = '';
    dados.medico = '';
    dados.procedimentos = '';
    dados.servTerc = '';
    dados.statusRequisicao = '';
    labCentral = 'Não aplicável';
    return agendaAtualizarPeriodoMonitoria_(agenda, ss, linha, rowAnterior, dados);
  } else if (isSiv) {
    if (!String(dados.projeto || '').trim()) {
      return { erro: 'Informe o projeto/protocolo do SIV.' };
    }
    dados.participante = '';
    dados.visita = '';
    dados.medico = '';
    dados.procedimentos = '';
    dados.servTerc = '';
    dados.statusRequisicao = '';
    labCentral = 'Não aplicável';
    return agendaAtualizarPeriodoEvento_(agenda, ss, linha, rowAnterior, dados, 'siv');
  } else {
    dados.monitorName = '';
    dados.salaMonitoria = '';
  }
  if (!String(dados.servTerc || '').trim()) dados.statusRequisicao = '';
  if (!policy.labChoiceAllowed) labCentral = 'N\u00E3o aplic\u00E1vel';
  if (agendaTipoExigeLabCentralServer_(tipo) && !labCentral) {
    return { erro: 'Informe se haverá Laboratório Central.' };
  }
  if (AgendaServerRules_.isLabCentral(labCentral) && !String(dados.visita || '').trim()) {
    return { erro: 'Para "Laboratorio Central = Sim", informe a Visita.' };
  }
  dados.labCentral = labCentral;
  var operationalAlerts = agendaOperationalRiskAlerts_(dados, datasValidacaoStatus);
  var dataNovaPassada = agendaDateIsBeforeToday_(d);
  var dataAnteriorPassada = agendaDateIsBeforeToday_(rowAnterior[AGENDA_CFG.idx.data]);
  var marcandoLabPassado = dataNovaPassada && AgendaServerRules_.isLabCentral(labCentral) &&
    (!AgendaServerRules_.isLabCentral(rowAnterior[AGENDA_CFG.idx.labCentral]) || !dataAnteriorPassada);
  var marcandoReqPassada = dataNovaPassada && String(dados.servTerc || '').trim() &&
    (!String(rowAnterior[AGENDA_CFG.idx.servTerc] || '').trim() || !dataAnteriorPassada);
  if (marcandoLabPassado) {
    return { erro: 'Lab Central = Sim nao pode ser marcado para uma data anterior a hoje.' };
  }
  if (marcandoReqPassada) {
    return { erro: 'Requisicoes de Exame nao podem ser marcadas para uma data anterior a hoje.' };
  }
  if (AgendaServerRules_.isCancelled(status) && !AgendaServerRules_.isCancelled(rowAnterior[AGENDA_CFG.idx.status])) {
    dados.obs = agendaAppendCancelamentoMotivo_(dados.obs, dados.cancelamento);
  }
  var dataAnterior = agenda.getRange(linha, AGENDA_CFG.col.data).getValue();
  if (datasAgendaDiferentes_(dataAnterior, d) && dados.reagendamentoConfirmado !== true) {
    return { erro: 'Confirme a troca de data antes de salvar o reagendamento.' };
  }
  var horaNova = formatAgendaHora_(d);
  var deveOrdenarAgenda =
    datasAgendaDiferentes_(dataAnterior, d) ||
    normText_(formatarHoraSafe_(rowAnterior[AGENDA_CFG.idx.hora])) !== normText_(horaNova);
  var deveVerificarNotificacoes =
    datasAgendaDiferentes_(dataAnterior, d) ||
    AgendaServerRules_.isLabCentral(rowAnterior[AGENDA_CFG.idx.labCentral]) !== AgendaServerRules_.isLabCentral(labCentral) ||
    !AgendaServerRules_.sameStatus(rowAnterior[AGENDA_CFG.idx.status], status);
  var postVisitConcluidoPorStatus = agendaPostVisitConcluidoPorStatus_(status, tipo);
  var dataConclusaoPostVisit = new Date();
  var poloTrialValor = postVisitConcluidoPorStatus
    ? (rowAnterior[AGENDA_CFG.idx.poloTrial] || dataConclusaoPostVisit)
    : agendaPostVisitValue_(dados.poloTrialConcluido, rowAnterior[AGENDA_CFG.idx.poloTrial]);
  var ecrfValor = postVisitConcluidoPorStatus
    ? (rowAnterior[AGENDA_CFG.idx.ecrf] || dataConclusaoPostVisit)
    : agendaPostVisitValue_(dados.ecrfConcluida, rowAnterior[AGENDA_CFG.idx.ecrf]);

  agenda.getRange(linha, AGENDA_CFG.col.data, 1, AGENDA_CFG.col.kit - AGENDA_CFG.col.data + 1).setValues([[
    formatAgendaDatePt_(d),
    horaNova,
    tipo,
    status,
    dados.participante || '',
    agendaNascimentoFromDados_(dados, rowAnterior),
    agendaIdParticipanteFromDados_(dados, rowAnterior),
    dados.projeto || '',
    agendaBracoFromDados_(dados, rowAnterior),
    dados.visita || '',
    dados.medico || '',
    dados.procedimentos || '',
    dados.servTerc || '',
    dados.obs || '',
    labCentral,
    rowAnterior[AGENDA_CFG.idx.controle] || '',
    dados.kit || ''
  ]]);
  agenda.getRange(linha, AGENDA_CFG.col.reqStatus, 1, 6).setValues([[
    conflitoApenasAuxiliar ? (rowAnterior[AGENDA_CFG.idx.reqStatus] || '') : (dados.statusRequisicao || ''),
    dados.monitorName || '',
    poloTrialValor,
    ecrfValor,
    dados.salaMonitoria || '',
    dados.carroRequerido
  ]]);
  SpreadsheetApp.flush();
  var carroSalvo = agendaBooleanValue_(agenda.getRange(linha, AGENDA_CFG.col.carroRequerido).getValue());
  if (carroSalvo !== dados.carroRequerido) {
    throw new Error('Não foi possível salvar a indicação de carro na Agenda.');
  }
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c1, dados.courier1);
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c2, dados.courier2);
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c3, dados.courier3);
  agendaSetBackupLinha_(agenda, linha,
    policy.labChoiceAllowed && AgendaServerRules_.isLabCentral(labCentral) ? dados.backup : {});
  agendaSetTransporteExtraLinha_(agenda, linha, dados);
  if (AgendaServerRules_.isCancelled(status)) aplicarLogicaCancelamento_(agenda, linha, status);
  if (deveVerificarNotificacoes) {
    verificarNotificacoes(
      { source: ss, range: agenda.getRange(linha, AGENDA_CFG.col.labCentral), user: Session.getActiveUser() },
      dados.id,
      dataAnterior,
      agenda,
      linha
    );
  }
  var rowAtual = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  codexWriteAuditChanges_('Agenda', 'atualizarAgendaEventoCompleto', dados.id, agendaAuditChangesFromRows_(rowAnterior, rowAtual), 'Alteração de agendamento');
  if (deveOrdenarAgenda && agenda.getLastRow() > 2) {
    agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol)
      .sort([{ column: AGENDA_CFG.col.data, ascending: true }, { column: AGENDA_CFG.col.hora, ascending: true }]);
  }
  SpreadsheetApp.flush();
  var linhaAtualizada = encontrarLinhaPorId(agenda, dados.id) || linha;
  rowAtual = agenda.getRange(linhaAtualizada, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  return {
    ok: true,
    id: dados.id,
    atualizado: true,
    carroRequerido: carroSalvo,
    operationalAlerts: operationalAlerts,
    recordVersion: agendaRecordVersionFromRow_(rowAtual),
    editRecordVersion: agendaEditableRecordVersionFromRow_(rowAtual)
  };
  });
}

function cancelarAgendaEvento(id, cancelamento) {
  codexAssertCanWrite_('cancelarAgendaEvento', 'Agenda', id);
  return codexWithDocumentLock_('cancelarAgendaEvento', function() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, id);
  if (!linha) throw new Error('Agendamento nao encontrado para cancelamento.');
  var rowAnterior = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var obsAtual = String(rowAnterior[AGENDA_CFG.idx.obs] || '');
  var tipoAnteriorCancelamento = normText_(rowAnterior[AGENDA_CFG.idx.tipo] || '');
  var cancelamentoSiv = tipoAnteriorCancelamento === 'siv' || tipoAnteriorCancelamento.indexOf('site initiation') > -1;
  var obsComCancelamento = cancelamentoSiv
    ? obsAtual
    : agendaAppendCancelamentoMotivo_(obsAtual, cancelamento);
  agenda.getRange(linha, AGENDA_CFG.col.status).setValue('Cancelado');
  agenda.getRange(linha, AGENDA_CFG.col.obs).setValue(obsComCancelamento);
  aplicarLogicaCancelamento_(agenda, linha, 'Cancelado');
  verificarNotificacoes(
    { source: ss, range: agenda.getRange(linha, AGENDA_CFG.col.labCentral), user: Session.getActiveUser() },
    id,
    null,
    agenda,
    linha
  );
  var rowAtual = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var reservasCanceladas = typeof cancelarReservasKitsAgenda_ === 'function' ? cancelarReservasKitsAgenda_(id, obsComCancelamento || 'Cancelamento da visita na Agenda') : 0;
  codexWriteAuditChanges_('Agenda', 'cancelarAgendaEvento', id, agendaAuditChangesFromRows_(rowAnterior, rowAtual), 'Cancelamento de agendamento');
  SpreadsheetApp.flush();
  return { ok: true, id: id, status: 'Cancelado', reservasCanceladas: reservasCanceladas };
  });
}

function atualizarStatusRequisicaoAgenda(agendaId, enviado) {
  codexAssertCanWrite_('atualizarStatusRequisicaoAgenda', 'Agenda', agendaId);
  return codexWithDocumentLock_('atualizarStatusRequisicaoAgenda', function() {
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, agendaId);
  if (!linha) throw new Error('Agendamento nao encontrado para atualizar requisicao.');
  var prestador = String(agenda.getRange(linha, AGENDA_CFG.col.servTerc).getValue() || '').trim();
  var statusAnterior = agenda.getRange(linha, AGENDA_CFG.col.reqStatus).getValue();
  if (!prestador) {
    agenda.getRange(linha, AGENDA_CFG.col.reqStatus).setValue('');
    codexWriteAuditChanges_('Agenda', 'atualizarStatusRequisicaoAgenda', agendaId, [{
      field: 'Status Requisição',
      oldValue: statusAnterior,
      newValue: ''
    }], 'Prestador terceirizado removido');
    SpreadsheetApp.flush();
    var rowSemPrestador = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
    return { ok: true, id: agendaId, statusRequisicao: '', semPrestador: true, recordVersion: agendaRecordVersionFromRow_(rowSemPrestador), editRecordVersion: agendaEditableRecordVersionFromRow_(rowSemPrestador) };
  }
  var valor = '';
  if (enviado) {
    valor = 'Requisição Enviada - ' + formatarDataHoraMesCurtoPt_(new Date());
  }
  agenda.getRange(linha, AGENDA_CFG.col.reqStatus).setValue(valor);
  codexWriteAuditChanges_('Agenda', 'atualizarStatusRequisicaoAgenda', agendaId, [{
    field: 'Status Requisição',
    oldValue: statusAnterior,
    newValue: valor
  }], 'Atualização de status da requisição');
  SpreadsheetApp.flush();
  var rowAtual = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  return { ok: true, id: agendaId, statusRequisicao: valor, recordVersion: agendaRecordVersionFromRow_(rowAtual), editRecordVersion: agendaEditableRecordVersionFromRow_(rowAtual) };
  });
}

function atualizarStatusBackupAgenda(agendaId, status, recordVersion) {
  codexAssertCanWrite_('atualizarStatusBackupAgenda', 'Agenda', agendaId);
  return codexWithDocumentLock_('atualizarStatusBackupAgenda', function() {
  agendaId = String(agendaId || '').trim();
  status = String(status || '').trim();
  if (!agendaId) return { erro: 'Agendamento nao informado.' };
  if (!status) return { erro: 'Status do backup nao informado.' };
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, agendaId);
  if (!linha) return { erro: 'Agendamento nao encontrado.' };
  var rowAnterior = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var versaoEsperada = String(recordVersion || '').trim();
  var versaoAtual = agendaRecordVersionFromRow_(rowAnterior);
  if (versaoEsperada && versaoEsperada !== versaoAtual) {
    return {
      conflito: true,
      erro: 'Este agendamento foi alterado desde que voce abriu. Atualize a Agenda antes de criar o envio do backup.',
      id: agendaId,
      currentVersion: versaoAtual,
      currentEditVersion: agendaEditableRecordVersionFromRow_(rowAnterior)
    };
  }
  var statusAnterior = String(rowAnterior[AGENDA_CFG.idx.cb.status] || '');
  if (statusAnterior !== status) {
    agenda.getRange(linha, AGENDA_CFG.idx.cb.status + 1).setValue(status);
    codexWriteAuditChanges_('Agenda', 'atualizarStatusBackupAgenda', agendaId, [{
      field: 'Backup - Status',
      oldValue: statusAnterior,
      newValue: status
    }], 'Backup marcado como convertido em novo agendamento');
  }
  SpreadsheetApp.flush();
  var rowAtual = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  return {
    ok: true,
    id: agendaId,
    status: String(rowAtual[AGENDA_CFG.idx.cb.status] || ''),
    recordVersion: agendaRecordVersionFromRow_(rowAtual),
    editRecordVersion: agendaEditableRecordVersionFromRow_(rowAtual)
  };
  });
}

function marcarAgendaPassadaComoRealizada(event) {
  codexAssertAdminOrInstalledTrigger_(event, 'marcarAgendaPassadaComoRealizada');
  return marcarAgendaPassadaComoRealizada_();
}

function marcarAgendaPassadaComoRealizada_() {
  return codexWithDocumentLock_('marcarAgendaPassadaComoRealizada', function() {
  var agenda = getAgendaSheet_();
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return { atualizados: 0 };
  var vals = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  var atualizados = 0;
  vals.forEach(function(r, idx) {
    var status = r[AGENDA_CFG.idx.status];
    if (AgendaServerRules_.isTerminalStatus(status)) return;
    var dt = agendaDateFromValue_(r[AGENDA_CFG.idx.data]);
    if (!dt) return;
    dt.setHours(0, 0, 0, 0);
    if (dt.getTime() <= hoje.getTime()) {
      agenda.getRange(idx + 2, AGENDA_CFG.col.status).setValue('Realizado');
      atualizados++;
    }
  });
  return { atualizados: atualizados };
  });
}

function concluirPendenciasPoloTrialEcrfAntigas(dataCorteIso, dryRun) {
  codexAssertAdmin_();
  return codexWithDocumentLock_('concluirPendenciasPoloTrialEcrfAntigas', function() {
  if (!dataCorteIso) {
    throw new Error('Informe a data de corte no formato AAAA-MM-DD. Ex.: concluirPendenciasPoloTrialEcrfAntigas("2026-05-23", true)');
  }
  var corte = parseAgendaDateAny_(dataCorteIso) || new Date(dataCorteIso);
  if (!corte || isNaN(corte.getTime())) {
    throw new Error('Data de corte invalida. Use o formato AAAA-MM-DD.');
  }
  corte.setHours(23, 59, 59, 999);

  var agenda = getAgendaSheet_();
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) {
    return { ok: true, dryRun: !!dryRun, corte: dataCorteIso, linhas: [], linhasAfetadas: 0, poloTrial: 0, ecrf: 0, celulasAtualizadas: 0, exemplos: [] };
  }

  var vals = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
  var i = AGENDA_CFG.idx;
  var agora = new Date();
  var updates = [];
  var exemplos = [];
  var totalPolo = 0;
  var totalEcrf = 0;

  vals.forEach(function(r, idx) {
    var statusEvento = r[i.status];
    if (!AgendaServerRules_.isRealized(statusEvento)) return;

    var tipoEvento = r[i.tipo];
    var exigePosVisita = AgendaServerRules_.isPostVisitType(tipoEvento);
    if (!exigePosVisita) return;

    var dataEvento = agendaDateFromValue_(r[i.data]) || parseAgendaDateAny_(r[i.data]);
    if (!dataEvento || isNaN(dataEvento.getTime())) return;
    dataEvento.setHours(0, 0, 0, 0);
    if (dataEvento.getTime() > corte.getTime()) return;

    var rowNumber = idx + 2;
    var marcou = false;
    if (!r[i.poloTrial]) {
      updates.push({ row: rowNumber, col: AGENDA_CFG.col.poloTrial });
      totalPolo++;
      marcou = true;
    }
    if (!r[i.ecrf]) {
      updates.push({ row: rowNumber, col: AGENDA_CFG.col.ecrf });
      totalEcrf++;
      marcou = true;
    }
    if (marcou && exemplos.length < 10) {
      exemplos.push({
        linha: rowNumber,
        id: String(r[i.id] || ''),
        data: formatarDataSafe(r[i.data]),
        projeto: String(r[i.projeto] || ''),
        participante: String(r[i.participante] || ''),
        visita: String(r[i.visita] || '')
      });
    }
  });

  if (!dryRun) {
    updates.forEach(function(u) {
      agenda.getRange(u.row, u.col).setValue(agora);
    });
    SpreadsheetApp.flush();
  }

  var linhasMap = {};
  updates.forEach(function(u) {
    linhasMap[u.row] = true;
  });
  var linhasAfetadas = Object.keys(linhasMap).map(function(row) {
    return Number(row);
  }).sort(function(a, b) {
    return a - b;
  });

  return {
    ok: true,
    dryRun: !!dryRun,
    corte: dataCorteIso,
    linhas: linhasAfetadas,
    linhasAfetadas: linhasAfetadas.length,
    poloTrial: totalPolo,
    ecrf: totalEcrf,
    celulasAtualizadas: updates.length,
    exemplos: exemplos
  };
  });
}

function simularConclusaoPendenciasPoloTrialEcrfAntigas() {
  return concluirPendenciasPoloTrialEcrfAntigas('2026-05-23', true);
}

function executarConclusaoPendenciasPoloTrialEcrfAntigas() {
  codexAssertAdmin_();
  return concluirPendenciasPoloTrialEcrfAntigas('2026-05-23', false);
}

function instalarGatilhoAgendaRealizadoFimDoDia() {
  codexAssertAdmin_();
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && ['marcarAgendaPassadaComoRealizada', 'marcarAgendaPassadaComoRealizada_'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('marcarAgendaPassadaComoRealizada_')
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
  var policy = AgendaServerRules_.formPolicy(tipo);
  var isMonitoria = policy.isMonitoring;
  var isSiv = policy.isSiv;
  var isPeriodo = policy.isOperationalPeriod;
  var projetoParticipanteErro = agendaSincronizarProjetoDoParticipante_(dados, policy);
  if (projetoParticipanteErro) return projetoParticipanteErro;
  if (policy.requiresTime && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  if (policy.requiresDoctor && !String(dados.medico || '').trim()) {
    return { erro: 'Informe o médico responsável pela consulta.' };
  }
  var erroRealizadoFuturo = agendaRealizadoFuturoErro_(status, d);
  if (erroRealizadoFuturo) return { erro: erroRealizadoFuturo };
  dados.carroRequerido = policy.isVisit && agendaBooleanValue_(dados.carroRequerido);
  if (isMonitoria) {
    if (!String(dados.projeto || '').trim()) {
      return { erro: 'Informe o projeto/protocolo da monitoria.' };
    }
    if (!String(dados.salaMonitoria || '').trim()) {
      return { erro: 'Informe o local (sala) da monitoria.' };
    }
    if (!String(dados.monitorName || '').trim()) {
      return { erro: 'Informe ao menos um monitor.' };
    }
    dados.participante = '';
    dados.visita = '';
    dados.medico = '';
    dados.procedimentos = '';
    dados.servTerc = '';
    dados.statusRequisicao = '';
    labCentral = 'Não aplicável';
  } else if (isSiv) {
    if (!String(dados.projeto || '').trim()) {
      return { erro: 'Informe o projeto/protocolo do SIV.' };
    }
    dados.participante = '';
    dados.visita = '';
    dados.medico = '';
    dados.procedimentos = '';
    dados.servTerc = '';
    dados.statusRequisicao = '';
    labCentral = 'Não aplicável';
  } else {
    dados.monitorName = '';
    dados.salaMonitoria = '';
  }
  if (!String(dados.servTerc || '').trim()) dados.statusRequisicao = '';
  if (!policy.labChoiceAllowed) labCentral = 'N\u00E3o aplic\u00E1vel';
  if (agendaTipoExigeLabCentralServer_(tipo) && !labCentral) {
    return { erro: 'Informe se haverá Laboratório Central.' };
  }
  if (AgendaServerRules_.isLabCentral(labCentral) && !String(dados.visita || '').trim()) {
    return { erro: 'Para "Laboratorio Central = Sim", informe a Visita.' };
  }
  if (agendaDateIsBeforeToday_(d) && AgendaServerRules_.isLabCentral(labCentral)) {
    return { erro: 'Lab Central = Sim nao pode ser marcado para uma data anterior a hoje.' };
  }
  if (agendaDateIsBeforeToday_(d) && String(dados.servTerc || '').trim()) {
    return { erro: 'Requisicoes de Exame nao podem ser marcadas para uma data anterior a hoje.' };
  }

  var linhaNova = agenda.getLastRow() + 1;
  var id = Utilities.getUuid().slice(0, 8);
  agenda.getRange(linhaNova, AGENDA_CFG.col.id).setValue(id);
  setAgendaDateValue_(agenda.getRange(linhaNova, AGENDA_CFG.col.data), d);
  agenda.getRange(linhaNova, AGENDA_CFG.col.hora).setValue(formatAgendaHora_(d));
  agenda.getRange(linhaNova, AGENDA_CFG.col.tipo).setValue(tipo);
  agenda.getRange(linhaNova, AGENDA_CFG.col.status).setValue(status);
  agenda.getRange(linhaNova, AGENDA_CFG.col.participante).setValue(dados.participante || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.nasc).setValue(agendaNascimentoFromDados_(dados));
  agenda.getRange(linhaNova, AGENDA_CFG.col.idParticipante).setValue(agendaIdParticipanteFromDados_(dados));
  agenda.getRange(linhaNova, AGENDA_CFG.col.projeto).setValue(dados.projeto || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.braco).setValue(agendaBracoFromDados_(dados));
  agenda.getRange(linhaNova, AGENDA_CFG.col.visita).setValue(dados.visita || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.medico).setValue(dados.medico || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.procedimentos).setValue(dados.procedimentos || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.servTerc).setValue(dados.servTerc || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.obs).setValue(dados.obs || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.labCentral).setValue(labCentral);
  agenda.getRange(linhaNova, AGENDA_CFG.col.kit).setValue(dados.kit || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.reqStatus).setValue(dados.statusRequisicao || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.monitorName).setValue(dados.monitorName || '');
  var postVisitConcluidoNovo = agendaPostVisitConcluidoPorStatus_(status, tipo);
  var dataConclusaoPostVisitNova = new Date();
  agenda.getRange(linhaNova, AGENDA_CFG.col.poloTrial).setValue(postVisitConcluidoNovo
    ? dataConclusaoPostVisitNova
    : agendaPostVisitValue_(dados.poloTrialConcluido, ''));
  agenda.getRange(linhaNova, AGENDA_CFG.col.ecrf).setValue(postVisitConcluidoNovo
    ? dataConclusaoPostVisitNova
    : agendaPostVisitValue_(dados.ecrfConcluida, ''));
  agenda.getRange(linhaNova, AGENDA_CFG.col.salaMonitoria).setValue(dados.salaMonitoria || '');
  agenda.getRange(linhaNova, AGENDA_CFG.col.carroRequerido).setValue(dados.carroRequerido);
  SpreadsheetApp.flush();
  var carroSalvo = agendaBooleanValue_(agenda.getRange(linhaNova, AGENDA_CFG.col.carroRequerido).getValue());
  if (carroSalvo !== dados.carroRequerido) {
    throw new Error('Não foi possível salvar a indicação de carro na Agenda.');
  }
  agendaSetCourierLinha_(agenda, linhaNova, AGENDA_CFG.idx.c1, dados.courier1);
  agendaSetCourierLinha_(agenda, linhaNova, AGENDA_CFG.idx.c2, dados.courier2);
  agendaSetCourierLinha_(agenda, linhaNova, AGENDA_CFG.idx.c3, dados.courier3);
  agendaSetBackupLinha_(agenda, linhaNova,
    policy.labChoiceAllowed && AgendaServerRules_.isLabCentral(labCentral) ? dados.backup : {});
  agendaSetTransporteExtraLinha_(agenda, linhaNova, dados);
  agenda.getRange(linhaNova, 1, 1, AGENDA_CFG.lastCol)
    .setFontFamily('Roboto')
    .setFontSize(10)
    .setFontColor('#434343')
    .setFontWeight('normal');
  agenda.getRange(linhaNova, AGENDA_CFG.col.data).setFontWeight('bold');
  agenda.getRange(linhaNova, AGENDA_CFG.col.projeto).setFontWeight('bold');
  if (AgendaServerRules_.isCancelled(status)) aplicarLogicaCancelamento_(agenda, linhaNova, status);

  verificarNotificacoes(
    { source: ss, range: agenda.getRange(linhaNova, AGENDA_CFG.col.labCentral), user: Session.getActiveUser() },
    id,
    null,
    agenda,
    linhaNova
  );

  if (agenda.getLastRow() > 2) {
    agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol)
      .sort([{ column: AGENDA_CFG.col.data, ascending: true }, { column: AGENDA_CFG.col.hora, ascending: true }]);
  }
  SpreadsheetApp.flush();
  return { ok: true, id: id, emailLabAtivo: agendaEmailEnabled_(), carroRequerido: carroSalvo };
}

function agendaSetCourierLinha_(agenda, linha, idx, courier) {
  courier = courier || {};
  var courierNome = courier.nome || courier.courier || '';
  var materialSummary = agendaMaterialSummaryFromJson_(courier.matBioJson || courier.materialJson, courier.material);
  agenda.getRange(linha, idx.nome + 1, 1, 3).setValues([[
    courierNome,
    courier.temperatura || courier.temp || '',
    courier.status || ''
  ]]);
  agenda.getRange(linha, idx.material + 1).setValue(materialSummary);
  // A tela pode estar desatualizada ou carregar temporariamente uma AWB vazia.
  // O contrato novo so altera a celula quando o usuario tocou o campo. Clientes
  // legados ainda podem preencher uma AWB, mas nunca limpar uma existente com
  // um vazio incidental.
  var hasAwb = Object.prototype.hasOwnProperty.call(courier, 'awb') && courier.awb !== undefined;
  var hasTouchedFlag = Object.prototype.hasOwnProperty.call(courier, 'awbTouched');
  var shouldUpdateAwb = hasAwb && (hasTouchedFlag
    ? courier.awbTouched === true
    : String(courier.awb || '').trim() !== '');
  if (shouldUpdateAwb) {
    agendaSetAwbValue_(agenda.getRange(linha, idx.awb + 1), courier.awb || '', courierNome);
  }
}

function agendaMaterialSummaryFromJson_(matBioJson, fallback) {
  var fallbackText = String(fallback || '').trim();
  if (!matBioJson) return fallbackText;
  if (typeof codexMatBioParseJson_ !== 'function' || typeof codexMatBioSerializeItems_ !== 'function') return fallbackText;
  var items = codexMatBioParseJson_(matBioJson);
  if (!items.length) return fallbackText;
  var serialized = codexMatBioSerializeItems_(items);
  return serialized.summary || fallbackText;
}

function agendaSetAwbValue_(range, awb, courier) {
  awb = String(awb || '').trim();
  if (!awb) {
    range.clearContent();
    return;
  }
  var url = agendaTrackingUrl_(awb, courier);
  if (url) {
    range.setRichTextValue(
      SpreadsheetApp.newRichTextValue()
        .setText(awb)
        .setLinkUrl(url)
        .build()
    );
  } else {
    range.setValue(awb);
  }
  if (String(range.getDisplayValue() || '').trim() !== awb) {
    throw new Error('Não foi possível salvar a AWB "' + awb + '" na Agenda.');
  }
}

function codexCourierNorm_(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function codexCourierAwbRule_(courier) {
  var n = codexCourierNorm_(courier);
  if (n.indexOf('marken') >= 0) return { key: 'marken', len: 12, mode: 'alnum', label: 'MARKEN' };
  if (n.indexOf('dhl') >= 0) return { key: 'dhl', len: 10, mode: 'digits', label: 'DHL' };
  if (n.indexOf('ocasa') >= 0) return { key: 'ocasa', len: 12, mode: 'ocasa', label: 'OCASA' };
  if (n.indexOf('pinex') >= 0) return { key: n === 'pinex' ? 'pinex' : 'pinex-agendamento', mode: 'free', label: 'PINEX' };
  return { key: '', mode: 'free', label: String(courier || '') };
}

function codexCourierNormalizeAwb_(awb, courier) {
  var rule = codexCourierAwbRule_(courier);
  var value = String(awb || '').trim();
  if (rule.mode === 'alnum' || rule.mode === 'ocasa') value = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  else if (rule.mode === 'digits') value = value.replace(/\D/g, '');
  if (rule.len) value = value.slice(0, rule.len);
  return value;
}

function codexCourierIsValidOcasaAwb_(awb) {
  awb = String(awb || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[A-Z][0-9]{7}$/.test(awb) || /^PK2[A-Z0-9]{9}$/.test(awb);
}

function codexCourierIsValidAwb_(awb, courier) {
  var rule = codexCourierAwbRule_(courier);
  var value = codexCourierNormalizeAwb_(awb, courier);
  if (!value) return true;
  if (rule.mode === 'ocasa') return codexCourierIsValidOcasaAwb_(value);
  return !rule.len || value.length === rule.len;
}

function codexCourierAwbValidationMessage_(courier) {
  var rule = codexCourierAwbRule_(courier);
  if (rule.mode === 'ocasa') return 'AWB OCASA deve ter 1 letra + 7 digitos ou PK2 + 9 caracteres alfanumericos.';
  if (!rule.len) return '';
  return 'AWB ' + rule.label + ' deve ter ' + rule.len + (rule.mode === 'alnum' ? ' caracteres alfanumericos.' : ' digitos.');
}

function codexCourierTrackingUrl_(awb, courier) {
  var rule = codexCourierAwbRule_(courier);
  var value = codexCourierNormalizeAwb_(awb, courier);
  if (!value) return '';
  if (rule.key === 'pinex') {
    return 'https://pinextracking.com.br/#tracking-code';
  }
  if (rule.key === 'marken' && codexCourierIsValidAwb_(value, courier)) {
    return 'https://online.marken.com/FastTrack/Shipment?inputTrack=' + encodeURIComponent(value);
  }
  if (rule.key === 'ocasa' && codexCourierIsValidOcasaAwb_(value)) {
    return 'https://tracking.ocasa.com/Tracking/index?client=&airbillnumber=' + encodeURIComponent(value) + '&i=18&url=ocasa';
  }
  if (rule.key === 'dhl' && codexCourierIsValidAwb_(value, courier)) {
    return 'https://www.dhl.com/br-en/home/tracking.html?tracking-id=' + encodeURIComponent(value) + '&submit=1';
  }
  if (rule.key) return '';
  var fallback = String(awb || '').trim();
  if (/^620X[0-9]{8}$/i.test(fallback)) {
    return 'https://online.marken.com/FastTrack/Shipment?inputTrack=' + encodeURIComponent(fallback);
  }
  if (/^[A-Z][0-9]{7}$/i.test(fallback) || /^PK2[A-Z0-9]{9}$/i.test(fallback)) {
    return 'https://tracking.ocasa.com/Tracking/index?client=&airbillnumber=' + encodeURIComponent(fallback.toUpperCase()) + '&i=18&url=ocasa';
  }
  if (/^[0-9]{10}$/.test(fallback)) {
    return 'https://www.dhl.com/br-en/home/tracking.html?tracking-id=' + encodeURIComponent(fallback) + '&submit=1';
  }
  return '';
}

function agendaTrackingUrl_(awb, courier) {
  return codexCourierTrackingUrl_(awb, courier);
}

function agendaIsPinexCourier_(courier) {
  return codexCourierNorm_(courier) === 'pinex';
}

var DHL_TRACKING_API_URL_ = 'https://api-eu.dhl.com/track/shipments';
var DHL_TRACKING_API_KEY_PROPERTY_ = 'DHL_TRACKING_API_KEY';
var DHL_TRACKING_MAX_CONSULTAS_POR_EXECUCAO_ = 45;

function configurarDhlTrackingApiKey(apiKey) {
  codexAssertAdmin_();
  apiKey = String(apiKey || '').trim();
  if (!apiKey) throw new Error('Informe a API Key da DHL.');
  PropertiesService.getScriptProperties().setProperty(DHL_TRACKING_API_KEY_PROPERTY_, apiKey);
  return { ok: true, property: DHL_TRACKING_API_KEY_PROPERTY_ };
}

function getDhlTrackingApiKey_() {
  return String(PropertiesService.getScriptProperties().getProperty(DHL_TRACKING_API_KEY_PROPERTY_) || '').trim();
}

function monitorarEntregasDhlAgendadas(options) {
  codexAssertAdminOrInstalledTrigger_(options, 'monitorarEntregasDhlAgendadas');
  return codexRunTrackedAutomation_('monitorarEntregasDhlAgendadas', function() {
    return monitorarEntregasDhlAgendadas_(options);
  });
}

function monitorarEntregasDhlAgendadas_(options) {
  options = options || {};
  var apiKey = getDhlTrackingApiKey_();
  if (!apiKey) {
    return {
      ok: false,
      verificados: 0,
      entregues: 0,
      mensagem: 'Configure a Script Property ' + DHL_TRACKING_API_KEY_PROPERTY_ + ' antes de ativar o monitor DHL.'
    };
  }

  var agenda = getAgendaSheet_();
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return { ok: true, verificados: 0, entregues: 0 };

  var range = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol);
  var values = range.getValues();
  var display = range.getDisplayValues();
  var pendentes = getAgendaDhlAwbsPendentesEntrega_(values, display);
  var awbs = Object.keys(pendentes);
  if (!awbs.length) {
    return { ok: true, verificados: 0, entregues: 0, mensagem: 'Nenhuma AWB DHL pendente de entrega.' };
  }

  var limiteSolicitado = Number(options.maxConsultas || DHL_TRACKING_MAX_CONSULTAS_POR_EXECUCAO_);
  if (!isFinite(limiteSolicitado) || limiteSolicitado < 1) limiteSolicitado = DHL_TRACKING_MAX_CONSULTAS_POR_EXECUCAO_;
  var maxConsultas = Math.max(1, Math.min(limiteSolicitado, awbs.length));
  var detectadas = [];
  var erros = [];
  for (var i = 0; i < maxConsultas; i++) {
    var awb = awbs[i];
    var resposta;
    try {
      resposta = consultarEntregaDhl_(awb, apiKey);
    } catch (e) {
      erros.push({ awb: awb, erro: e.message });
      if (i < maxConsultas - 1) Utilities.sleep(5200);
      continue;
    }
    if (i < maxConsultas - 1) Utilities.sleep(5200);
    if (resposta.entregue) detectadas.push({ awb: awb, resposta: resposta, itens: pendentes[awb] || [] });
  }

  var entregues = [];
  if (detectadas.length) {
    entregues = codexWithDocumentLock_('monitorarEntregasDhlAgendadas', function() {
      var agendaAtual = getAgendaSheet_();
      var atualizados = [];
      detectadas.forEach(function(detectada) {
        detectada.itens.forEach(function(item) {
          var linhaAtual = agendaLocalizarLinhaPorId_(agendaAtual, item.agendaId, item.row);
          if (!linhaAtual) return;
          var courierAtual = agendaAtual.getRange(linhaAtual, item.nameCol).getValue();
          var awbAtual = agendaAtual.getRange(linhaAtual, item.awbCol).getDisplayValue() ||
            agendaAtual.getRange(linhaAtual, item.awbCol).getValue();
          var statusRange = agendaAtual.getRange(linhaAtual, item.statusCol);
          var statusAnterior = statusRange.getValue();
          if (normText_(courierAtual).indexOf('dhl') === -1 ||
              normalizarAwbCourier_(awbAtual) !== detectada.awb ||
              AgendaServerRules_.courierIsDeliveryTerminal(statusAnterior)) return;
          statusRange.setValue('Entregue');
          atualizados.push({
            agendaId: item.agendaId,
            row: linhaAtual,
            slot: item.slot,
            awb: item.awb,
            courier: item.courier,
            statusDhl: detectada.resposta.status || '',
            timestampEntrega: detectada.resposta.timestampEntrega || ''
          });
          codexWriteAuditChanges_('Agenda', 'monitorarEntregasDhlAgendadas', item.agendaId || item.awb, [{
            field: item.slot + ' - Status',
            oldValue: statusAnterior,
            newValue: 'Entregue'
          }], 'Entrega automática DHL | AWB ' + item.awb +
            (detectada.resposta.status ? ' | Status DHL ' + detectada.resposta.status : '') +
            (detectada.resposta.timestampEntrega ? ' | Entrega ' + detectada.resposta.timestampEntrega : ''));
        });
      });
      SpreadsheetApp.flush();
      return atualizados;
    });
  }
  return {
    ok: true,
    verificados: maxConsultas,
    pendentes: awbs.length,
    entregues: entregues.length,
    itens: entregues,
    erros: erros
  };
}

function diagnosticarMonitorEntregasDhl() {
  codexAssertAdmin_();
  var agenda = getAgendaSheetForRead_();
  var lastRow = agenda.getLastRow();
  var result = {
    apiKeyConfigurada: !!getDhlTrackingApiKey_(),
    pendentes: [],
    mensagem: ''
  };
  if (lastRow < 2) {
    codexLoggerSummary_('diagnosticarMonitorEntregasDhl', result);
    return result;
  }
  var range = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol);
  var pendentes = getAgendaDhlAwbsPendentesEntrega_(range.getValues(), range.getDisplayValues());
  Object.keys(pendentes).forEach(function(awb) {
    pendentes[awb].forEach(function(item) {
      result.pendentes.push({
        awb: item.awb,
        courier: item.courier,
        statusAtual: item.statusAtual,
        agendaId: item.agendaId,
        row: item.row,
        slot: item.slot
      });
    });
  });
  result.mensagem = result.pendentes.length
    ? 'AWBs DHL candidatas a consulta: ' + result.pendentes.length
    : 'Nenhuma AWB DHL pendente de entrega.';
  codexLoggerSummary_('diagnosticarMonitorEntregasDhl', result);
  return result;
}

function getAgendaDhlAwbsPendentesEntrega_(values, display) {
  var out = {};
  var idx = AGENDA_CFG.idx;
  var slots = [
    { key: 'c1', label: 'Transporte I', cfg: idx.c1 },
    { key: 'c2', label: 'Transporte II', cfg: idx.c2 },
    { key: 'c3', label: 'Transporte III', cfg: idx.c3 }
  ];
  values.forEach(function(row, i) {
    slots.forEach(function(slot) {
      var courier = String(row[slot.cfg.nome] || '').trim();
      if (normText_(courier).indexOf('dhl') === -1) return;
      var status = normText_(row[slot.cfg.status]);
      if (AgendaServerRules_.courierIsDeliveryTerminal(status)) return;
      var awb = String(display[i][slot.cfg.awb] || row[slot.cfg.awb] || '').trim();
      var awbKey = normalizarAwbCourier_(awb);
      if (!/^[0-9]{10}$/.test(awbKey)) return;
      if (!out[awbKey]) out[awbKey] = [];
      out[awbKey].push({
        agendaId: String(row[idx.id] || '').trim(),
        row: i + 2,
        slot: slot.label,
        nameCol: slot.cfg.nome + 1,
        statusCol: slot.cfg.status + 1,
        awbCol: slot.cfg.awb + 1,
        courier: courier,
        awb: awb,
        statusAtual: String(row[slot.cfg.status] || '').trim()
      });
    });
  });
  return out;
}

function consultarEntregaDhl_(awb, apiKey) {
  var url = DHL_TRACKING_API_URL_ + '?trackingNumber=' + encodeURIComponent(awb);
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'DHL-API-Key': apiKey,
      'Accept': 'application/json'
    }
  });
  var code = response.getResponseCode();
  var body = response.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error('DHL API retornou HTTP ' + code + ' para AWB ' + awb + '.');
  }
  var payload = body ? JSON.parse(body) : {};
  return interpretarRespostaEntregaDhl_(payload);
}

function interpretarRespostaEntregaDhl_(payload) {
  var shipment = payload && payload.shipments && payload.shipments.length ? payload.shipments[0] : {};
  var status = shipment.status || {};
  var statusText = [
    status.statusCode,
    status.status,
    status.description
  ].filter(Boolean).join(' | ');
  var entregue = dhlStatusIndicaEntrega_(statusText);
  var timestampEntrega = status.timestamp || '';
  var events = shipment.events || [];
  events.forEach(function(ev) {
    var eventText = [
      ev.statusCode,
      ev.status,
      ev.description,
      ev.type
    ].filter(Boolean).join(' | ');
    if (dhlStatusIndicaEntrega_(eventText)) {
      entregue = true;
      if (!timestampEntrega) timestampEntrega = ev.timestamp || ev.date || '';
      if (!statusText) statusText = eventText;
    }
  });
  return {
    entregue: entregue,
    status: statusText,
    timestampEntrega: timestampEntrega
  };
}

function dhlStatusIndicaEntrega_(texto) {
  var n = normText_(texto);
  return n.indexOf('delivered') >= 0 ||
    n.indexOf('entregue') >= 0 ||
    n.indexOf('delivery confirmed') >= 0 ||
    n.indexOf('shipment delivered') >= 0;
}

function monitorarConfirmacoesCourierAgendadas(event) {
  codexAssertAdminOrInstalledTrigger_(event, 'monitorarConfirmacoesCourierAgendadas');
  return codexRunTrackedAutomation_('monitorarConfirmacoesCourierAgendadas', function() {
    return monitorarConfirmacoesCourierAgendadas_();
  });
}

function monitorarConfirmacoesCourierAgendadas_() {
  var envios = { ok: true, verificados: 0, enviados: 0, semAnexo: 0 };
  try {
    if (typeof transporteMonitorarEnviosPorEmail_ === 'function') envios = transporteMonitorarEnviosPorEmail_();
  } catch (envioError) {
    envios = { ok: false, erro: envioError.message || String(envioError) };
    Logger.log('Monitor de envios de transporte: ' + envios.erro);
  }
  var regras = getCourierConfirmationRules_();
  var ruleKeys = Object.keys(regras);
  if (!ruleKeys.length) return { ok: true, verificados: 0, confirmados: 0, envios: envios, mensagem: 'Nenhuma regra ativa.' };
  var agenda = getAgendaSheet_();
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return { ok: true, verificados: 0, confirmados: 0, envios: envios };

  var range = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol);
  var values = range.getValues();
  var display = range.getDisplayValues();
  var pendentes = getAgendaCourierAwbsPendentesConfirmacao_(values, display, regras);
  var pendentesRef = getAgendaCourierRefsPendentesConfirmacao_(values, display, regras);
  var awbs = Object.keys(pendentes);
  var refs = Object.keys(pendentesRef);
  if (!awbs.length && !refs.length) return { ok: true, verificados: 0, confirmados: 0, envios: envios, mensagem: 'Nenhum courier pendente de confirmação.' };

  var encontradosPorRegra = [];
  ruleKeys.forEach(function(ruleKey) {
    var regra = regras[ruleKey];
    encontradosPorRegra.push({
      ruleKey: ruleKey,
      regra: regra,
      awbs: buscarConfirmacoesCourierNoGmail_(regra, pendentes),
      refs: buscarConfirmacoesCourierPorReferenciaNoGmail_(regra, pendentesRef)
    });
  });

  var temConfirmacao = encontradosPorRegra.some(function(item) {
    return item.awbs.length || item.refs.length;
  });
  if (!temConfirmacao) {
    return { ok: true, verificados: awbs.length + refs.length, confirmados: 0, itens: [], envios: envios };
  }
  var confirmados = codexWithDocumentLock_('monitorarConfirmacoesCourierAgendadas', function() {
    var agendaAtual = getAgendaSheet_();
    var atualizados = [];
    var processados = {};
    encontradosPorRegra.forEach(function(resultado) {
      resultado.awbs.forEach(function(match) {
        (pendentes[match.awbKey] || []).forEach(function(item) {
          if (item.ruleKey !== resultado.ruleKey) return;
          var linhaAtual = agendaLocalizarLinhaPorId_(agendaAtual, item.agendaId, item.row);
          var chave = linhaAtual + ':' + item.statusCol;
          if (!linhaAtual || processados[chave]) return;
          var courierAtual = agendaAtual.getRange(linhaAtual, item.nameCol).getValue();
          var awbAtual = agendaAtual.getRange(linhaAtual, item.awbCol).getDisplayValue() ||
            agendaAtual.getRange(linhaAtual, item.awbCol).getValue();
          var statusAnterior = agendaAtual.getRange(linhaAtual, item.statusCol).getValue();
          if (getCourierConfirmationRuleKey_(regras, courierAtual) !== resultado.ruleKey ||
              normalizarAwbCourier_(awbAtual) !== match.awbKey ||
              !AgendaServerRules_.courierIsAwaitingConfirmation(statusAnterior)) return;
          var novoStatus = resultado.regra.statusConfirmacao || 'Confirmado';
          agendaAtual.getRange(linhaAtual, item.statusCol).setValue(novoStatus);
          processados[chave] = true;
          atualizados.push({
            agendaId: item.agendaId,
            row: linhaAtual,
            slot: item.slot,
            awb: item.awb,
            courier: item.courier,
            messageId: match.messageId
          });
          codexWriteAuditChanges_('Agenda', 'monitorarConfirmacoesCourierAgendadas', item.agendaId || item.awb, [{
            field: item.slot + ' - Status',
            oldValue: statusAnterior,
            newValue: novoStatus
          }], 'Confirmação automática por e-mail ' + item.courier + ' | AWB ' + item.awb + ' | Gmail message ' + match.messageId);
        });
      });
      resultado.refs.forEach(function(match) {
        (pendentesRef[match.refKey] || []).forEach(function(item) {
          if (item.ruleKey !== resultado.ruleKey) return;
          var linhaAtual = agendaLocalizarLinhaPorId_(agendaAtual, item.agendaId, item.row);
          var chave = linhaAtual + ':' + item.statusCol;
          if (!linhaAtual || processados[chave]) return;
          var courierAtual = agendaAtual.getRange(linhaAtual, item.nameCol).getValue();
          var statusAnterior = agendaAtual.getRange(linhaAtual, item.statusCol).getValue();
          var awbRange = agendaAtual.getRange(linhaAtual, item.awbCol);
          var awbAnterior = awbRange.getDisplayValue() || awbRange.getValue();
          if (getCourierConfirmationRuleKey_(regras, courierAtual) !== resultado.ruleKey ||
              normalizarAwbCourier_(awbAnterior) ||
              !AgendaServerRules_.courierCanReceiveConfirmation(statusAnterior)) return;
          var awbExtraida = escolherAwbConfirmacaoCourier_(resultado.regra, item, match.awbs);
          if (!awbExtraida) return;
          var novoStatus = resultado.regra.statusConfirmacao || 'Confirmado';
          agendaSetAwbValue_(awbRange, awbExtraida, item.courier);
          agendaAtual.getRange(linhaAtual, item.statusCol).setValue(novoStatus);
          processados[chave] = true;
          atualizados.push({
            agendaId: item.agendaId,
            row: linhaAtual,
            slot: item.slot,
            awb: awbExtraida,
            courier: item.courier,
            messageId: match.messageId,
            refInterna: item.refInterna
          });
          codexWriteAuditChanges_('Agenda', 'monitorarConfirmacoesCourierAgendadas', item.agendaId || awbExtraida, [{
            field: item.slot + ' - AWB',
            oldValue: awbAnterior,
            newValue: awbExtraida
          }, {
            field: item.slot + ' - Status',
            oldValue: statusAnterior,
            newValue: novoStatus
          }], 'Confirmação automática por e-mail ' + item.courier + ' | Ref. ' + item.refInterna + ' | AWB ' + awbExtraida + ' | Gmail message ' + match.messageId);
        });
      });
    });
    SpreadsheetApp.flush();
    return atualizados;
  });
  return { ok: true, verificados: awbs.length + refs.length, confirmados: confirmados.length, itens: confirmados, envios: envios };
}

function diagnosticarMonitorConfirmacoesCourier() {
  codexAssertAdmin_();
  var regras = getCourierConfirmationRules_();
  var agenda = getAgendaSheetForRead_();
  var lastRow = agenda.getLastRow();
  var result = {
    regras: Object.keys(regras).map(function(k) {
      return {
        courier: regras[k].courier,
        emailConfirmacao: regras[k].emailConfirmacao,
        textoConfirmacao: regras[k].textoConfirmacao,
        queries: montarGmailQueriesConfirmacaoCourier_(regras[k])
      };
    }),
    pendentes: [],
    buscas: []
  };
  if (lastRow < 2) {
    codexLoggerSummary_('diagnosticarMonitorConfirmacoesCourier', result);
    return result;
  }
  var range = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol);
  var pendentes = getAgendaCourierAwbsPendentesConfirmacao_(range.getValues(), range.getDisplayValues(), regras);
  Object.keys(pendentes).forEach(function(awbKey) {
    pendentes[awbKey].forEach(function(item) {
      result.pendentes.push({
        awb: item.awb,
        courier: item.courier,
        agendaId: item.agendaId,
        row: item.row,
        slot: item.slot
      });
    });
  });
  Object.keys(regras).forEach(function(ruleKey) {
    montarGmailQueriesConfirmacaoCourier_(regras[ruleKey]).forEach(function(query) {
      var threads = GmailApp.search(query, 0, 20);
      result.buscas.push({
        courier: regras[ruleKey].courier,
        query: query,
        threads: threads.length
      });
    });
  });
  codexLoggerSummary_('diagnosticarMonitorConfirmacoesCourier', result);
  return result;
}

function getAgendaCourierAwbsPendentesConfirmacao_(values, display, regras) {
  var out = {};
  var idx = AGENDA_CFG.idx;
  var slots = [
    { key: 'c1', label: 'Transporte I', cfg: idx.c1 },
    { key: 'c2', label: 'Transporte II', cfg: idx.c2 },
    { key: 'c3', label: 'Transporte III', cfg: idx.c3 }
  ];
  values.forEach(function(row, i) {
    slots.forEach(function(slot) {
      var courier = String(row[slot.cfg.nome] || '').trim();
      var ruleKey = getCourierConfirmationRuleKey_(regras, courier);
      if (!ruleKey) return;
      var status = row[slot.cfg.status];
      if (!AgendaServerRules_.courierIsAwaitingConfirmation(status)) return;
      var awb = String(display[i][slot.cfg.awb] || row[slot.cfg.awb] || '').trim();
      var awbKey = normalizarAwbCourier_(awb);
      if (!awbKey) return;
      if (!out[awbKey]) out[awbKey] = [];
      out[awbKey].push({
        ruleKey: ruleKey,
        agendaId: String(row[idx.id] || '').trim(),
        row: i + 2,
        slot: slot.label,
        nameCol: slot.cfg.nome + 1,
        statusCol: slot.cfg.status + 1,
        awbCol: slot.cfg.awb + 1,
        courier: courier,
        awb: awb
      });
    });
  });
  return out;
}

function getAgendaCourierRefsPendentesConfirmacao_(values, display, regras) {
  var out = {};
  var idx = AGENDA_CFG.idx;
  var slots = [
    { key: 'c1', label: 'Transporte I', cfg: idx.c1 },
    { key: 'c2', label: 'Transporte II', cfg: idx.c2 },
    { key: 'c3', label: 'Transporte III', cfg: idx.c3 }
  ];
  values.forEach(function(row, i) {
    var agendaId = String(row[idx.id] || '').trim();
    if (!agendaId) return;
    var referencias = [];
    var refInterna = agendaCourierRefInterna_(agendaId);
    var refInternaKey = normalizarAwbCourier_(refInterna);
    if (refInternaKey) referencias.push({ key: refInternaKey, valor: refInterna });
    slots.forEach(function(anchorSlot) {
      var anchorCourier = String(row[anchorSlot.cfg.nome] || '').trim();
      var anchorRuleKey = getCourierConfirmationRuleKey_(regras, anchorCourier);
      var anchorRegra = anchorRuleKey ? regras[anchorRuleKey] : null;
      if (!anchorRegra || !anchorRegra.extrairAwbPorReferencia) return;
      var anchorAwb = String(display[i][anchorSlot.cfg.awb] || row[anchorSlot.cfg.awb] || '').trim();
      var anchorKey = normalizarAwbCourier_(anchorAwb);
      if (!anchorKey || referencias.some(function(ref) { return ref.key === anchorKey; })) return;
      referencias.push({ key: anchorKey, valor: anchorAwb });
    });
    slots.forEach(function(slot) {
      var courier = String(row[slot.cfg.nome] || '').trim();
      var ruleKey = getCourierConfirmationRuleKey_(regras, courier);
      var regra = ruleKey ? regras[ruleKey] : null;
      if (!regra || !regra.extrairAwbPorReferencia) return;
      var status = row[slot.cfg.status];
      if (!AgendaServerRules_.courierCanReceiveConfirmation(status)) return;
      var awb = String(display[i][slot.cfg.awb] || row[slot.cfg.awb] || '').trim();
      if (normalizarAwbCourier_(awb)) return;
      var item = {
        ruleKey: ruleKey,
        agendaId: agendaId,
        refInterna: refInterna,
        row: i + 2,
        slot: slot.label,
        nameCol: slot.cfg.nome + 1,
        statusCol: slot.cfg.status + 1,
        awbCol: slot.cfg.awb + 1,
        courier: courier,
        temperatura: String(row[slot.cfg.temp] || '').trim()
      };
      referencias.forEach(function(ref) {
        if (!out[ref.key]) out[ref.key] = [];
        out[ref.key].push(item);
      });
    });
  });
  return out;
}

function agendaCourierRefInterna_(agendaId) {
  agendaId = String(agendaId || '').trim();
  return agendaId ? 'AGD-' + agendaId : '';
}

function getCourierConfirmationRuleKey_(regras, courier) {
  var key = normText_(courier);
  if (!key) return '';
  if (regras[key]) return key;
  var keys = Object.keys(regras || {});
  for (var i = 0; i < keys.length; i++) {
    if (key.indexOf(keys[i]) >= 0 || keys[i].indexOf(key) >= 0) return keys[i];
  }
  return '';
}

function getCourierConfirmationRules_() {
  var out = {};
  getAgendaCourierRows_().forEach(function(c) {
    var key = normText_(c.nome);
    if (!key) return;
    var defaults = courierConfirmationDefaults_(c.nome);
    var isDhl = !!defaults.extrairAwbPorReferencia;
    var ativoRaw = normText_(c.monitorConfirmacao);
    var ativo = ativoRaw ? ['sim', 's', 'yes', 'true', '1', 'ativo'].indexOf(ativoRaw) >= 0 : !!defaults.monitorConfirmacao;
    if (!ativo) return;
    var email = String(c.emailConfirmacao || defaults.emailConfirmacao || '').trim();
    var texto = String(c.textoConfirmacao || defaults.textoConfirmacao || '').trim();
    if (!email || !texto) return;
    out[key] = {
      courier: c.nome,
      emailConfirmacao: email,
      textoConfirmacao: texto,
      textosConfirmacao: codexCourierConfirmationTexts_(texto, defaults, isDhl),
      statusConfirmacao: String(c.statusConfirmacao || defaults.statusConfirmacao || '').trim() || 'Confirmado',
      extrairAwbPorReferencia: isDhl,
      diasBusca: 7
    };
  });
  return out;
}

function codexCourierConfirmationTexts_(texto, defaults, isDhl) {
  var textos = [texto];
  defaults = defaults || {};
  if (Array.isArray(defaults.textosConfirmacao)) {
    textos = textos.concat(defaults.textosConfirmacao);
  } else if (defaults.textoConfirmacao) {
    textos.push(defaults.textoConfirmacao);
  }
  if (isDhl) textos = textos.concat(['Agendamento realizado para', 'Coleta programada para']);
  return textos;
}

function textosConfirmacaoCourier_(regra) {
  regra = regra || {};
  var textos = Array.isArray(regra.textosConfirmacao)
    ? regra.textosConfirmacao.slice()
    : [regra.textoConfirmacao];
  var out = [];
  textos.forEach(function(texto) {
    String(texto || '').split(/\r?\n|\|\||\s;\s/).forEach(function(parte) {
      var normalizado = normalizarTextoMonitorCourier_(parte);
      if (normalizado && out.indexOf(normalizado) === -1) out.push(normalizado);
    });
  });
  return out;
}

function contemTextoConfirmacaoCourier_(alvo, textos) {
  if (!textos || !textos.length) return true;
  return textos.some(function(texto) { return alvo.indexOf(texto) !== -1; });
}

function buscarConfirmacoesCourierNoGmail_(regra, pendentes) {
  var out = [];
  var textosRegra = textosConfirmacaoCourier_(regra);
  montarGmailQueriesConfirmacaoCourier_(regra).forEach(function(query) {
    var threads = GmailApp.search(query, 0, 100);
    threads.forEach(function(thread) {
      thread.getMessages().forEach(function(msg) {
        var alvo = normalizarTextoMonitorCourier_([
          msg.getSubject(),
          msg.getPlainBody(),
          msg.getAttachments().map(function(a) { return a.getName(); }).join(' ')
        ].join(' '));
        if (!contemTextoConfirmacaoCourier_(alvo, textosRegra)) return;
        Object.keys(pendentes).forEach(function(awbKey) {
          if (alvo.indexOf(awbKey.toLowerCase()) === -1) return;
          out.push({ awbKey: awbKey, messageId: msg.getId(), query: query });
        });
      });
    });
  });
  return out;
}

function buscarConfirmacoesCourierPorReferenciaNoGmail_(regra, pendentesRef) {
  var out = [];
  if (!regra.extrairAwbPorReferencia) return out;
  var textosRegra = textosConfirmacaoCourier_(regra);
  montarGmailQueriesConfirmacaoCourier_(regra).forEach(function(query) {
    var threads = GmailApp.search(query, 0, 100);
    threads.forEach(function(thread) {
      var partes = [];
      var lastMessageId = '';
      thread.getMessages().forEach(function(msg) {
        lastMessageId = msg.getId();
        partes.push([
          msg.getSubject(),
          msg.getPlainBody(),
          msg.getAttachments().map(function(a) { return a.getName(); }).join(' ')
        ].join(' '));
      });
      var corpoThread = partes.join(' ');
      var alvo = normalizarTextoMonitorCourier_(corpoThread);
      if (!contemTextoConfirmacaoCourier_(alvo, textosRegra)) return;
      var awbs = extrairAwbsDhlConfirmacao_(corpoThread);
      Object.keys(pendentesRef).forEach(function(refKey) {
        if (alvo.indexOf(refKey.toLowerCase()) === -1) return;
        out.push({ refKey: refKey, messageId: lastMessageId || thread.getId(), query: query, awbs: awbs });
      });
    });
  });
  return out;
}

function extrairAwbsDhlConfirmacao_(texto) {
  var out = { ambiente: '', congelado: '', todos: [] };
  texto = String(texto || '');
  var reRotulo = /(ambiente|congelado)\s*(?:w\s*b|awb|wb)?\s*[:#-]?\s*([0-9]{10})/gi;
  var m;
  while ((m = reRotulo.exec(texto)) !== null) {
    var tipo = normText_(m[1]);
    var awb = String(m[2] || '').trim();
    if (!awb) continue;
    if (tipo.indexOf('congel') >= 0 && !out.congelado) out.congelado = awb;
    else if (tipo.indexOf('ambient') >= 0 && !out.ambiente) out.ambiente = awb;
    if (out.todos.indexOf(awb) === -1) out.todos.push(awb);
  }
  var reNumeros = /\b([0-9]{10})\b/g;
  while ((m = reNumeros.exec(texto)) !== null) {
    if (out.todos.indexOf(m[1]) === -1) out.todos.push(m[1]);
  }
  return out;
}

function escolherAwbConfirmacaoCourier_(regra, item, awbs) {
  awbs = awbs || {};
  var temp = normText_(item && item.temperatura);
  if (temp.indexOf('congel') >= 0 && awbs.congelado) return awbs.congelado;
  if (temp.indexOf('ambient') >= 0 && awbs.ambiente) return awbs.ambiente;
  if (awbs.todos && awbs.todos.length === 1) return awbs.todos[0];
  if (temp.indexOf('congel') >= 0) return awbs.congelado || '';
  if (temp.indexOf('ambient') >= 0) return awbs.ambiente || '';
  return '';
}

function montarGmailQueriesConfirmacaoCourier_(regra) {
  var remetentes = String(regra.emailConfirmacao || '').split(/[;,]/).map(function(v) {
    return String(v || '').trim();
  }).filter(Boolean);
  if (!remetentes.length) remetentes = [String(regra.emailConfirmacao || '').trim()].filter(Boolean);
  return remetentes.map(function(v) {
    return 'from:' + v.replace(/\s+/g, '') + ' newer_than:' + (regra.diasBusca || 7) + 'd';
  });
}

function normalizarAwbCourier_(awb) {
  return String(awb || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizarTextoMonitorCourier_(texto) {
  return normalizarAwbCourier_(texto).toLowerCase();
}

function instalarGatilhoMonitorConfirmacaoCouriers() {
  codexAssertAdmin_();
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && ['monitorarConfirmacoesCourierAgendadas', 'monitorarConfirmacoesCourierAgendadas_'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('monitorarConfirmacoesCourierAgendadas_')
    .timeBased()
    .everyMinutes(15)
    .create();
  return { ok: true, intervaloMinutos: 15 };
}

function removerGatilhoMonitorConfirmacaoCouriers() {
  codexAssertAdmin_();
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && ['monitorarConfirmacoesCourierAgendadas', 'monitorarConfirmacoesCourierAgendadas_'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removidos++;
    }
  });
  return { ok: true, removidos: removidos };
}

function instalarGatilhoMonitorEntregasDhl() {
  codexAssertAdmin_();
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && ['monitorarEntregasDhlAgendadas', 'monitorarEntregasDhlAgendadas_'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('monitorarEntregasDhlAgendadas_')
    .timeBased()
    .everyHours(4)
    .create();
  return { ok: true, intervaloHoras: 4 };
}

function removerGatilhoMonitorEntregasDhl() {
  codexAssertAdmin_();
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && ['monitorarEntregasDhlAgendadas', 'monitorarEntregasDhlAgendadas_'].indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      removidos++;
    }
  });
  return { ok: true, removidos: removidos };
}

function agendaSetBackupLinha_(agenda, linha, backup) {
  backup = backup || {};
  var idx = AGENDA_CFG.idx.cb;
  var materialSummary = agendaMaterialSummaryFromJson_(backup.matBioJson || backup.materialJson, backup.material);
  agenda.getRange(linha, idx.nome + 1, 1, 3).setValues([[
    backup.nome || '',
    backup.status || '',
    materialSummary
  ]]);
  agenda.getRange(linha, AGENDA_CFG.col.backupTemperatura).setValue(backup.temperatura || backup.temp || '');
  if (normText_(backup.status) !== normText_('Adicionado à Agenda')) {
    agenda.getRange(linha, AGENDA_CFG.col.backupAgendaRef).clearContent();
  }
}

function agendaNovoEnvioBackupTemperaturaErro_(dados) {
  dados = dados || {};
  if (!String(dados.backupOrigemAgendaId || '').trim()) return '';
  var transporteI = dados.courier1 || {};
  if (!String(transporteI.temperatura || transporteI.temp || '').trim()) {
    return 'Informe a Temperatura do Transporte de Amostras I antes de salvar o novo envio.';
  }
  return '';
}

function agendaRowNumberById_(agenda, agendaId) {
  agendaId = String(agendaId || '').trim();
  if (!agendaId || agenda.getLastRow() < 2) return 0;
  var ids = agenda.getRange(2, AGENDA_CFG.col.id, agenda.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === agendaId) return i + 2;
  }
  return 0;
}

function agendaBackupAgendaRefFromCell_(value) {
  if (!value) return null;
  var ref = value;
  if (typeof value === 'string') {
    try {
      ref = JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  if (!ref || typeof ref !== 'object' || !String(ref.id || '').trim()) return null;
  return {
    id: String(ref.id || '').trim(),
    data: String(ref.data || '').trim(),
    dataIso: String(ref.dataIso || '').trim(),
    hora: String(ref.hora || '').trim()
  };
}

function agendaVincularBackupAoAgendamento_(agenda, origemId, destinoId, dataHora) {
  origemId = String(origemId || '').trim();
  destinoId = String(destinoId || '').trim();
  if (!origemId || !destinoId) return null;
  var linhaOrigem = agendaRowNumberById_(agenda, origemId);
  if (!linhaOrigem) throw new Error('O agendamento de origem do backup não foi encontrado.');
  var statusCell = agenda.getRange(linhaOrigem, AGENDA_CFG.idx.cb.status + 1);
  var refCell = agenda.getRange(linhaOrigem, AGENDA_CFG.col.backupAgendaRef);
  var statusAnterior = String(statusCell.getValue() || '');
  var refAnterior = String(refCell.getValue() || '');
  var ref = {
    id: destinoId,
    data: formatarDataSafe(dataHora),
    dataIso: formatarDataIsoAgenda_(dataHora),
    hora: formatAgendaHora_(dataHora)
  };
  var refJson = JSON.stringify(ref);
  statusCell.setValue('Adicionado à Agenda');
  refCell.setValue(refJson);
  codexWriteAuditChanges_('Agenda', 'vincularBackupAoAgendamento', origemId, [
    { field: 'Backup - Status', oldValue: statusAnterior, newValue: 'Adicionado à Agenda' },
    { field: 'Backup - Agendamento', oldValue: refAnterior, newValue: refJson }
  ], 'Backup vinculado ao novo agendamento ' + destinoId);
  SpreadsheetApp.flush();
  return ref;
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
  agenda.getRange(linha, startCol, 1, row.length).setValues([row.map(function(value) {
    return String(value || '');
  })]);
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

function formatAgendaDateTimeSafe_(value) {
  if (!value) return '';
  try {
    var d = value instanceof Date ? value : new Date(value);
    if (d && !isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    }
  } catch (e) {}
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

function codexMeasurePerformance_(operation, stage, metadata, callback) {
  var startedAt = Date.now();
  var success = false;
  metadata = metadata || {};
  try {
    var result = callback();
    success = true;
    return result;
  } finally {
    try {
      Logger.log('[CODEX_PERF] ' + JSON.stringify({
        operation: String(operation || ''),
        stage: String(stage || ''),
        durationMs: Math.max(0, Date.now() - startedAt),
        rowCount: Math.max(0, Number(metadata.rowCount) || 0),
        success: success
      }));
    } catch (eLog) {
      // A telemetria nunca pode alterar o resultado da operacao observada.
    }
  }
}

function getAgendaEventos(limite) {
  var totalMeta = { rowCount: 0 };
  return codexMeasurePerformance_('getAgendaEventos', 'total', totalMeta, function() {
    var sh = codexMeasurePerformance_('getAgendaEventos', 'sheet', { rowCount: 0 }, function() {
      return getAgendaSheetForRead_();
    });
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return [];
    var max = Math.min(Number(limite || 80), lastRow - 1);
    var start = Math.max(2, lastRow - max + 1);
    var readMeta = { rowCount: lastRow - start + 1 };
    var vals = codexMeasurePerformance_('getAgendaEventos', 'read', readMeta, function() {
      return sh.getRange(start, 1, readMeta.rowCount, AGENDA_CFG.lastCol).getValues();
    });
    totalMeta.rowCount = vals.length;
    return codexMeasurePerformance_('getAgendaEventos', 'convert_hydrate', { rowCount: vals.length }, function() {
      var idsPorParticipante = {};
      var bracosPorParticipante = {};
      getCodexSheetDataByName_('Participantes').slice(1).forEach(function(r) {
        var nome = normText_(r[1]);
        if (nome && !idsPorParticipante[nome]) idsPorParticipante[nome] = String(r[4] || '').trim();
        if (nome && !bracosPorParticipante[nome]) bracosPorParticipante[nome] = String(r[6] || '').trim();
      });
      return vals.map(function(r, i) {
        var evento = agendaRowToObject_(r, start + i);
        if (!evento.idParticipante && evento.participante) {
          evento.idParticipante = idsPorParticipante[normText_(evento.participante)] || '';
        }
        if (!evento.braco && evento.participante) {
          evento.braco = bracosPorParticipante[normText_(evento.participante)] || '';
        }
        return evento;
      }).reverse();
    });
  });
}

var AGENDA_WINDOW_MAX_RECORDS_ = 5000;

function agendaMeasureWindowStage_(measureStage, stage, metadata, callback) {
  return measureStage ? measureStage(stage, metadata, callback) : callback();
}

function agendaWindowResultIsValid_(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Array.isArray(value.items) && typeof value.total === 'number' && value.total >= value.items.length &&
    typeof value.truncated === 'boolean';
}

function agendaGetEventosPorPeriodo_(inicioIso, fimIso, limite, ignorarCache, measureStage) {
  var inicio = agendaParseIsoBoundary_(inicioIso, 'inicio');
  var fim = agendaParseIsoBoundary_(fimIso, 'fim');
  if (fim.getTime() <= inicio.getTime()) throw new Error('Periodo da Agenda invalido.');
  if ((fim.getTime() - inicio.getTime()) / 86400000 > 31) throw new Error('O periodo visivel nao pode exceder 31 dias.');
  var requestedLimit = Number(limite || 150);
  if (!isFinite(requestedLimit)) requestedLimit = 150;
  var max = Math.max(1, Math.min(Math.floor(requestedLimit), AGENDA_WINDOW_MAX_RECORDS_));
  var sh = getAgendaSheetForRead_();
  var lastRow = sh.getLastRow();
  var cacheKey = ['AgendaWindow:v2', lastRow, inicioIso, fimIso, max].join(':');
  var scanMeta = { rowCount: Math.max(0, lastRow - 1) };
  var scan = agendaMeasureWindowStage_(measureStage, 'date_scan', scanMeta, function() {
    var cached = ignorarCache ? null : agendaWindowCacheGet_(cacheKey);
    if (cached && !agendaWindowResultIsValid_(cached)) cached = null;
    if (cached) return { cached: cached };
    if (lastRow < 2) return { segments: [], total: 0, outOfOrder: false };
    var datas = sh.getRange(2, AGENDA_CFG.col.data, lastRow - 1, 1).getValues();
    var offsets = [];
    for (var d = 0; d < datas.length; d++) {
      var data = parseAgendaDateAny_(datas[d][0]);
      if (!data || isNaN(data.getTime())) continue;
      data.setHours(0, 0, 0, 0);
      if (data.getTime() >= inicio.getTime() && data.getTime() < fim.getTime()) offsets.push(d);
    }
    var segments = [];
    offsets.forEach(function(offset) {
      var previous = segments.length ? segments[segments.length - 1] : null;
      if (previous && previous.lastOffset + 1 === offset) {
        previous.lastOffset = offset;
        previous.count++;
      } else {
        segments.push({ firstOffset: offset, lastOffset: offset, count: 1 });
      }
    });
    return { segments: segments, total: offsets.length, outOfOrder: segments.length > 1 };
  });

  var readMeta = { rowCount: scan.cached ? Math.min(scan.cached.items.length, max) : Math.min(scan.total, max) };
  var rows = agendaMeasureWindowStage_(measureStage, 'row_read', readMeta, function() {
    if (scan.cached) return { cachedItems: scan.cached.items };
    var remaining = max;
    var out = [];
    (scan.segments || []).forEach(function(segment) {
      if (remaining <= 0) return;
      var count = Math.min(segment.count, remaining);
      var startRow = segment.firstOffset + 2;
      var values = sh.getRange(startRow, 1, count, AGENDA_CFG.lastCol).getValues();
      values.forEach(function(row, index) {
        out.push({ row: row, rowIndex: startRow + index });
      });
      remaining -= count;
    });
    return { rows: out };
  });

  var hydrateMeta = { rowCount: readMeta.rowCount };
  var items = agendaMeasureWindowStage_(measureStage, 'hydrate', hydrateMeta, function() {
    if (rows.cachedItems) return rows.cachedItems;
    var hydrated = (rows.rows || []).map(function(entry) {
      return agendaRowToObject_(entry.row, entry.rowIndex);
    });
    agendaHydrateParticipantFields_(hydrated);
    return hydrated;
  });

  var result = scan.cached || {
    items: items,
    total: scan.total,
    truncated: scan.total > items.length,
    outOfOrder: !!scan.outOfOrder
  };
  if (!agendaWindowResultIsValid_(result)) throw new Error('Dataset de eventos da Agenda invalido.');
  if (!scan.cached) agendaWindowCachePut_(cacheKey, result);
  return result;
}

function getAgendaEventosPorPeriodo(inicioIso, fimIso, limite, ignorarCache) {
  return agendaGetEventosPorPeriodo_(inicioIso, fimIso, limite, ignorarCache, null);
}

function agendaComparisonCanonicalize_(value) {
  if (Array.isArray(value)) return value.map(agendaComparisonCanonicalize_);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function(out, key) {
      out[key] = agendaComparisonCanonicalize_(value[key]);
      return out;
    }, {});
  }
  return value;
}

function agendaComparisonHash_(value) {
  var input = JSON.stringify(agendaComparisonCanonicalize_(value));
  var hash = 2166136261;
  for (var i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function agendaComparisonBuckets_(items) {
  return (items || []).reduce(function(buckets, item) {
    var id = String(item && item.id || '');
    if (!buckets[id]) buckets[id] = [];
    buckets[id].push(agendaComparisonHash_(item));
    return buckets;
  }, {});
}

function agendaCompareEventCollections_(windowItems, fullItems) {
  var windowBuckets = agendaComparisonBuckets_(windowItems);
  var fullBuckets = agendaComparisonBuckets_(fullItems);
  var keys = Object.keys(windowBuckets).concat(Object.keys(fullBuckets)).filter(function(key, index, all) {
    return all.indexOf(key) === index;
  });
  var missingCount = 0;
  var extraCount = 0;
  var criticalMismatchCount = 0;
  var duplicateIdCount = 0;
  keys.forEach(function(key) {
    var windowHashes = (windowBuckets[key] || []).slice().sort();
    var fullHashes = (fullBuckets[key] || []).slice().sort();
    if (windowHashes.length > 1 || fullHashes.length > 1) duplicateIdCount++;
    if (fullHashes.length > windowHashes.length) missingCount += fullHashes.length - windowHashes.length;
    if (windowHashes.length > fullHashes.length) extraCount += windowHashes.length - fullHashes.length;
    var paired = Math.min(windowHashes.length, fullHashes.length);
    for (var i = 0; i < paired; i++) {
      if (windowHashes[i] !== fullHashes[i]) criticalMismatchCount++;
    }
  });
  return {
    idsEqual: missingCount === 0 && extraCount === 0,
    criticalFieldsEqual: missingCount === 0 && extraCount === 0 && criticalMismatchCount === 0,
    missingCount: missingCount,
    extraCount: extraCount,
    criticalMismatchCount: criticalMismatchCount,
    duplicateIdCount: duplicateIdCount
  };
}

function compararAgendaWindowComCargaCompleta(inicioIso, fimIso) {
  codexAssertAdmin_();
  var startedAt = Date.now();
  var result;
  try {
    var inicio = agendaParseIsoBoundary_(inicioIso, 'inicio');
    var fim = agendaParseIsoBoundary_(fimIso, 'fim');
    var rangeDays = (fim.getTime() - inicio.getTime()) / 86400000;
    if (rangeDays <= 0 || rangeDays > 31) throw new Error('Periodo da Agenda invalido.');

    var windowStartedAt = Date.now();
    var windowData = agendaGetEventosPorPeriodo_(inicioIso, fimIso, AGENDA_WINDOW_MAX_RECORDS_, true, null);
    var windowDurationMs = Date.now() - windowStartedAt;

    var fullStartedAt = Date.now();
    var fullEvents = getAgendaEventos(AGENDA_WINDOW_MAX_RECORDS_);
    var fullDurationMs = Date.now() - fullStartedAt;
    var fullFiltered = fullEvents.filter(function(item) {
      return item && item.dataIso >= inicioIso && item.dataIso < fimIso;
    });
    var sourceRows = Math.max(0, getAgendaSheetForRead_().getLastRow() - 1);
    var legacyTruncated = sourceRows > AGENDA_WINDOW_MAX_RECORDS_;
    var comparison = agendaCompareEventCollections_(windowData.items, fullFiltered);
    result = {
      ok: !windowData.truncated && !legacyTruncated && comparison.idsEqual && comparison.criticalFieldsEqual,
      rangeDays: rangeDays,
      windowCount: windowData.items.length,
      windowTotal: windowData.total,
      fullFilteredCount: fullFiltered.length,
      fullReadCount: fullEvents.length,
      windowTruncated: !!windowData.truncated,
      legacyTruncated: legacyTruncated,
      outOfOrder: !!windowData.outOfOrder,
      idsEqual: comparison.idsEqual,
      criticalFieldsEqual: comparison.criticalFieldsEqual,
      missingCount: comparison.missingCount,
      extraCount: comparison.extraCount,
      criticalMismatchCount: comparison.criticalMismatchCount,
      duplicateIdCount: comparison.duplicateIdCount,
      durationMs: {
        window: windowDurationMs,
        full: fullDurationMs,
        total: Date.now() - startedAt
      }
    };
    Logger.log('[CODEX_AGENDA_COMPARE] ' + JSON.stringify(result));
    return result;
  } catch (error) {
    Logger.log('[CODEX_AGENDA_COMPARE] ' + JSON.stringify({
      ok: false,
      success: false,
      durationMs: Date.now() - startedAt
    }));
    throw error;
  }
}

function compararAgendaWindowAtual() {
  codexAssertAdmin_();
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  var inicioSemanaAtual = new Date(hoje);
  inicioSemanaAtual.setDate(inicioSemanaAtual.getDate() - ((inicioSemanaAtual.getDay() + 6) % 7));
  var inicio = new Date(inicioSemanaAtual);
  inicio.setDate(inicio.getDate() - 7);
  var fim = new Date(inicio);
  fim.setDate(fim.getDate() + 21);
  var timezone = Session.getScriptTimeZone();
  return compararAgendaWindowComCargaCompleta(
    Utilities.formatDate(inicio, timezone, 'yyyy-MM-dd'),
    Utilities.formatDate(fim, timezone, 'yyyy-MM-dd')
  );
}

function agendaValidateReferenceData_(referenceData) {
  if (!referenceData || typeof referenceData !== 'object' || Array.isArray(referenceData)) {
    throw new Error('Dados de referencia da Agenda invalidos.');
  }
  var arrayFields = [
    'participantes', 'medicos', 'prestadores', 'projetos', 'laboratorios', 'couriers',
    'temperaturas', 'statusCourier', 'laboratoriosDestino', 'kitsColeta', 'tiposEvento',
    'salasMonitoria', 'status', 'procedimentoChips', 'monitores', 'feriados'
  ];
  arrayFields.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(referenceData, field) || !Array.isArray(referenceData[field])) {
      throw new Error('Dataset obrigatorio da Agenda invalido: ' + field + '.');
    }
  });
  if (!Object.prototype.hasOwnProperty.call(referenceData, 'courierConfig') ||
      !referenceData.courierConfig || typeof referenceData.courierConfig !== 'object' ||
      Array.isArray(referenceData.courierConfig)) {
    throw new Error('Dataset obrigatorio da Agenda invalido: courierConfig.');
  }
  if (!Object.prototype.hasOwnProperty.call(referenceData, 'projectCourierMap') ||
      !referenceData.projectCourierMap || typeof referenceData.projectCourierMap !== 'object' ||
      Array.isArray(referenceData.projectCourierMap)) {
    throw new Error('Dataset obrigatorio da Agenda invalido: projectCourierMap.');
  }
  if (typeof referenceData.emailLabAtivo !== 'boolean') {
    throw new Error('Dataset obrigatorio da Agenda invalido: emailLabAtivo.');
  }
  if (typeof referenceData.hojeIso !== 'string') {
    throw new Error('Dataset obrigatorio da Agenda invalido: hojeIso.');
  }
  return referenceData;
}

function agendaReferenceRowCount_(referenceData) {
  return Object.keys(referenceData || {}).reduce(function(total, key) {
    return total + (Array.isArray(referenceData[key]) ? referenceData[key].length : 0);
  }, 0);
}

function agendaGetReferenceData_(forceRefresh) {
  var cacheKey = 'AgendaBootstrapReferenceData:v2:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  return agendaValidateReferenceData_(
    agendaGetDadosFormularioAgendaCached_(cacheKey, !!forceRefresh, true)
  );
}

function getAgendaReferenceDataFresh() {
  var access = codexGetCurrentUserAccess();
  if (!access || !access.ok) throw new Error((access && access.message) || 'Acesso negado.');
  var previousCacheBypass = CODEX_CACHE_BYPASS_READS_;
  CODEX_CACHE_BYPASS_READS_ = true;
  try {
    return agendaGetReferenceData_(true);
  } finally {
    CODEX_CACHE_BYPASS_READS_ = previousCacheBypass;
  }
}

function agendaBootstrapRevision_(referenceData, items, inicioIso, fimIso) {
  var input = JSON.stringify({
    range: [inicioIso, fimIso],
    referenceData: referenceData,
    events: (items || []).map(function(item) {
      return [item.rowIndex, item.id, item.recordVersion, item.editRecordVersion];
    })
  });
  var hash = 2166136261;
  for (var i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'agenda-bootstrap-v1-' + ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function agendaDeniedBootstrap_(access) {
  return {
    access: access,
    referenceData: null,
    events: [],
    range: null,
    revision: '',
    truncated: false,
    complete: false,
    partialError: false
  };
}

function getAgendaBootstrap(inicioIso, fimIso, forceRefresh) {
  var totalMeta = { rowCount: 0 };
  return codexMeasurePerformance_('getAgendaBootstrap', 'total', totalMeta, function() {
    var accessMeta = { rowCount: 0 };
    var access = codexMeasurePerformance_('getAgendaBootstrap', 'access', accessMeta, function() {
      var currentAccess = codexGetCurrentUserAccess();
      accessMeta.rowCount = currentAccess && currentAccess.ok ? 1 : 0;
      return currentAccess;
    });
    if (!access || !access.ok) return agendaDeniedBootstrap_(access || { ok: false });

    var refreshRequested = forceRefresh === true;
    var previousCacheBypass = CODEX_CACHE_BYPASS_READS_;
    CODEX_CACHE_BYPASS_READS_ = refreshRequested;
    try {
      var referenceMeta = { rowCount: 0 };
      var referenceData = codexMeasurePerformance_('getAgendaBootstrap', 'reference', referenceMeta, function() {
        var data = agendaGetReferenceData_(refreshRequested);
        referenceMeta.rowCount = agendaReferenceRowCount_(data);
        return data;
      });
      var measureWindow = function(stage, metadata, callback) {
        return codexMeasurePerformance_('getAgendaBootstrap', stage, metadata, callback);
      };
      var windowData = agendaGetEventosPorPeriodo_(
        inicioIso,
        fimIso,
        AGENDA_WINDOW_MAX_RECORDS_,
        refreshRequested,
        measureWindow
      );
      totalMeta.rowCount = windowData.items.length;
      var revision = codexMeasurePerformance_(
        'getAgendaBootstrap',
        'revision',
        { rowCount: windowData.items.length },
        function() {
          return agendaBootstrapRevision_(referenceData, windowData.items, inicioIso, fimIso);
        }
      );
      var complete = !windowData.truncated;
      return {
        access: access,
        referenceData: referenceData,
        events: windowData.items,
        range: {
          start: inicioIso,
          endExclusive: fimIso,
          loadedStart: complete ? inicioIso : '',
          loadedEndExclusive: complete ? fimIso : '',
          total: windowData.total,
          loaded: windowData.items.length,
          outOfOrder: !!windowData.outOfOrder
        },
        revision: revision,
        truncated: !!windowData.truncated,
        complete: complete,
        partialError: false
      };
    } finally {
      CODEX_CACHE_BYPASS_READS_ = previousCacheBypass;
    }
  });
}

function agendaWindowCacheGet_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function agendaWindowCachePut_(key, value) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), 45);
  } catch (e) {
    // Respostas muito grandes apenas deixam de ser cacheadas; a janela segue limitada.
  }
}

function pesquisarAgendaHistorico(query, cursor, pageSize) {
  query = String(query || '').trim();
  if (query.length < 2) throw new Error('Informe pelo menos 2 caracteres para pesquisar.');
  var sh = getAgendaSheetForRead_();
  var lastRow = sh.getLastRow();
  var size = Math.max(1, Math.min(Number(pageSize || 25), 50));
  var scanEnd = cursor == null || cursor === '' ? lastRow : Math.min(lastRow, Math.max(2, Number(cursor) || lastRow));
  var needle = normText_(query);
  var items = [];
  var nextCursor = null;
  var batchSize = 200;
  searchLoop:
  while (scanEnd >= 2) {
    var batchStart = Math.max(2, scanEnd - batchSize + 1);
    var vals = sh.getRange(batchStart, 1, scanEnd - batchStart + 1, AGENDA_CFG.lastCol).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (normText_(vals[i].map(function(value) { return String(value || ''); }).join(' ')).indexOf(needle) === -1) continue;
      if (items.length >= size) {
        nextCursor = batchStart + i;
        break searchLoop;
      }
      items.push(agendaRowToObject_(vals[i], batchStart + i));
    }
    scanEnd = batchStart - 1;
  }
  agendaHydrateParticipantFields_(items);
  return { items: items, nextCursor: nextCursor, hasMore: nextCursor != null, pageSize: size };
}

function getAgendaMateriaisAnteriores(criteria) {
  criteria = criteria || {};
  var totalMeta = { rowCount: 0 };
  return codexMeasurePerformance_('getAgendaMateriaisAnteriores', 'total', totalMeta, function() {
    var participanteId = String(criteria.participanteId || '').trim();
    var projetoId = String(criteria.projetoId || '').trim();
    var excluirEventoId = String(criteria.excluirEventoId || '').trim();
    var limite = Math.max(1, Math.min(Number(criteria.limite || 5), 5));
    if (!participanteId && !projetoId) return { items: [], limit: limite };

    var projeto = projetoId ? agendaProjetoIdentidade_(projetoId) : null;
    if (projetoId && (!projeto || !projeto.id)) return { items: [], limit: limite };

    var sh = getAgendaSheetForRead_();
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { items: [], limit: limite };
    var rowCount = lastRow - 1;
    totalMeta.rowCount = rowCount;
    var scanMeta = { rowCount: rowCount };
    var scan = codexMeasurePerformance_('getAgendaMateriaisAnteriores', 'scan', scanMeta, function() {
      return {
        base: sh.getRange(2, 1, rowCount, AGENDA_CFG.col.visita).getValues(),
        logistics: sh.getRange(2, AGENDA_CFG.idx.c1.material + 1, rowCount, AGENDA_CFG.idx.cb.matBio - AGENDA_CFG.idx.c1.material + 1).getValues()
      };
    });

    var projetoAliases = {};
    if (projeto) {
      [projeto.nome, projeto.codigo].forEach(function(value) {
        var key = normText_(value);
        if (key) projetoAliases[key] = true;
      });
    }
    var candidatos = [];
    for (var i = 0; i < scan.base.length; i++) {
      var base = scan.base[i];
      var id = String(base[AGENDA_CFG.idx.id] || '').trim();
      if (!id || (excluirEventoId && id === excluirEventoId)) continue;
      if (participanteId) {
        var idLinha = String(base[AGENDA_CFG.idx.idParticipante] || '').trim();
        var participanteCompativel = normText_(idLinha) === normText_(participanteId);
        if (!participanteCompativel) continue;
      } else if (!projetoAliases[normText_(base[AGENDA_CFG.idx.projeto])]) {
        continue;
      }
      var row = Array(AGENDA_CFG.lastCol).fill('');
      for (var b = 0; b < base.length; b++) row[b] = base[b];
      var logistics = scan.logistics[i] || [];
      for (var l = 0; l < logistics.length; l++) row[AGENDA_CFG.idx.c1.material + l] = logistics[l];
      if (!agendaLinhaTemMaterialAnterior_(row)) continue;
      candidatos.push({ row: row, rowIndex: i + 2 });
    }
    candidatos.sort(function(a, b) {
      var aKey = formatarDataIsoAgenda_(a.row[AGENDA_CFG.idx.data]) + ' ' + formatarHoraSafe_(a.row[AGENDA_CFG.idx.hora]);
      var bKey = formatarDataIsoAgenda_(b.row[AGENDA_CFG.idx.data]) + ' ' + formatarHoraSafe_(b.row[AGENDA_CFG.idx.hora]);
      return bKey.localeCompare(aKey) || (a.rowIndex - b.rowIndex);
    });
    var selecionados = candidatos.slice(0, limite);
    var projetoIdsPorAlias = {};
    getCodexSheetDataByName_('Projetos').slice(1).forEach(function(row) {
      var idProjeto = String(row[0] || '').trim();
      if (!idProjeto) return;
      [row[1], row[2]].forEach(function(alias) {
        var key = normText_(alias);
        if (key) projetoIdsPorAlias[key] = idProjeto;
      });
    });
    return codexMeasurePerformance_('getAgendaMateriaisAnteriores', 'convert', { rowCount: selecionados.length }, function() {
      return {
        items: selecionados.map(function(item) {
          var projetoResolvidoId = (projeto && projeto.id) || projetoIdsPorAlias[normText_(item.row[AGENDA_CFG.idx.projeto])] || '';
          return agendaMaterialAnteriorFromRow_(item.row, item.rowIndex, participanteId, projetoResolvidoId);
        }),
        limit: limite
      };
    });
  });
}

function agendaProjetoIdentidade_(reference) {
  var needle = normText_(reference);
  if (!needle) return null;
  var rows = getCodexSheetDataByName_('Projetos').slice(1);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (normText_(row[0]) !== needle && normText_(row[1]) !== needle && normText_(row[2]) !== needle) continue;
    return {
      id: String(row[0] || '').trim(),
      nome: String(row[1] || '').trim(),
      codigo: String(row[2] || '').trim()
    };
  }
  return null;
}

function agendaLinhaTemMaterialAnterior_(row) {
  var i = AGENDA_CFG.idx;
  return [i.c1, i.c2, i.c3, i.cb].some(function(slot) {
    var json = String(row[slot.matBio] || '').trim();
    if (json) {
      if (typeof codexMatBioParseJson_ === 'function') return codexMatBioParseJson_(json).length > 0;
      try {
        var parsed = JSON.parse(json);
        var items = Array.isArray(parsed) ? parsed : parsed && parsed.items;
        return Array.isArray(items) && items.length > 0;
      } catch (e) {
        return false;
      }
    }
    return !!String(row[slot.material] || '').trim();
  });
}

function agendaMaterialAnteriorFromRow_(row, rowIndex, participanteId, projetoId) {
  var evento = agendaRowToObject_(row, rowIndex);
  function material(slot) {
    slot = slot || {};
    return { material: String(slot.material || ''), matBioJson: String(slot.matBioJson || '') };
  }
  return {
    id: evento.id,
    rowIndex: evento.rowIndex,
    participante: evento.participante,
    idParticipante: evento.idParticipante || String(participanteId || ''),
    projeto: evento.projeto,
    projetoId: String(projetoId || ''),
    data: evento.data,
    dataIso: evento.dataIso,
    hora: evento.hora,
    tipo: evento.tipo,
    visita: evento.visita,
    courier1: material(evento.courier1),
    courier2: material(evento.courier2),
    courier3: material(evento.courier3),
    backup: material(evento.backup)
  };
}

function getAgendaPeriodoOperacionalPorEventoId(id, rowIndex) {
  var totalMeta = { rowCount: 0 };
  return codexMeasurePerformance_('getAgendaPeriodoOperacionalPorEventoId', 'total', totalMeta, function() {
    id = String(id || '').trim();
    if (!id) return null;
    var sh = getAgendaSheetForRead_();
    var linha = agendaLocalizarLinhaPorId_(sh, id, rowIndex);
    if (!linha) return null;
    var ref = sh.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
    var tipo = String(ref[AGENDA_CFG.idx.tipo] || '');
    var dataRef = formatarDataIsoAgenda_(ref[AGENDA_CFG.idx.data]);
    if (!AgendaServerRules_.isOperationalPeriod(tipo)) {
      return { eventoId: id, ids: [id], inicio: dataRef, fim: dataRef, tipo: tipo, projetoId: '', rowCount: 1 };
    }

    var lastRow = sh.getLastRow();
    var count = Math.max(0, lastRow - 1);
    totalMeta.rowCount = count;
    if (!count) return null;
    var scan = codexMeasurePerformance_('getAgendaPeriodoOperacionalPorEventoId', 'scan', { rowCount: count }, function() {
      return {
        base: sh.getRange(2, 1, count, AGENDA_CFG.col.projeto).getValues(),
        monitors: sh.getRange(2, AGENDA_CFG.col.monitorName, count, 1).getValues(),
        rooms: sh.getRange(2, AGENDA_CFG.col.salaMonitoria, count, 1).getValues()
      };
    });
    var isSiv = AgendaServerRules_.isSiv(tipo);
    var candidatos = [];
    for (var i = 0; i < scan.base.length; i++) {
      var base = scan.base[i];
      if (!AgendaServerRules_.sameType(base[AGENDA_CFG.idx.tipo], tipo)) continue;
      if (isSiv && AgendaServerRules_.isCancelled(base[AGENDA_CFG.idx.status])) continue;
      if (normText_(base[AGENDA_CFG.idx.projeto]) !== normText_(ref[AGENDA_CFG.idx.projeto])) continue;
      if (normText_((scan.monitors[i] || [])[0]) !== normText_(ref[AGENDA_CFG.idx.monitorName])) continue;
      if (normText_((scan.rooms[i] || [])[0]) !== normText_(ref[AGENDA_CFG.idx.salaMonitoria])) continue;
      var data = parseAgendaDateAny_(base[AGENDA_CFG.idx.data]);
      var eventoId = String(base[AGENDA_CFG.idx.id] || '').trim();
      if (!data || !eventoId) continue;
      data.setHours(0, 0, 0, 0);
      candidatos.push({ id: eventoId, rowIndex: i + 2, data: data, dataIso: formatarDataIsoAgenda_(data) });
    }
    candidatos.sort(function(a, b) { return a.data.getTime() - b.data.getTime() || a.rowIndex - b.rowIndex; });
    var pos = candidatos.findIndex(function(item) { return item.id === id && (!rowIndex || item.rowIndex === Number(rowIndex)); });
    if (pos < 0) pos = candidatos.findIndex(function(item) { return item.id === id; });
    if (pos < 0) return { eventoId: id, ids: [id], inicio: dataRef, fim: dataRef, tipo: tipo, projetoId: '', rowCount: 1 };
    var start = pos;
    var end = pos;
    while (start > 0 && agendaDatasConsecutivas_(candidatos[start - 1].data, candidatos[start].data)) start--;
    while (end < candidatos.length - 1 && agendaDatasConsecutivas_(candidatos[end].data, candidatos[end + 1].data)) end++;
    var periodo = candidatos.slice(start, end + 1);
    var projeto = agendaProjetoIdentidade_(ref[AGENDA_CFG.idx.projeto]);
    return {
      eventoId: id,
      ids: periodo.map(function(item) { return item.id; }),
      inicio: periodo[0].dataIso,
      fim: periodo[periodo.length - 1].dataIso,
      tipo: isSiv ? 'SIV' : 'Monitoria',
      projetoId: projeto ? projeto.id : '',
      rowCount: periodo.length
    };
  });
}

function agendaLocalizarLinhaPorId_(sh, id, rowIndex, metadata) {
  var hintedRow = Number(rowIndex) || 0;
  if (hintedRow >= 2 && hintedRow <= sh.getLastRow() && String(sh.getRange(hintedRow, AGENDA_CFG.col.id).getValue() || '') === id) {
    return hintedRow;
  }
  if (metadata) metadata.rowCount = Math.max(0, sh.getLastRow() - 1);
  return encontrarLinhaPorId(sh, id);
}

function getAgendaEventoPorId(id, rowIndex) {
  var totalMeta = { rowCount: 0 };
  return codexMeasurePerformance_('getAgendaEventoPorId', 'total', totalMeta, function() {
    id = String(id || '').trim();
    if (!id) return null;
    var sh = getAgendaSheetForRead_();
    var locateMeta = { rowCount: 0 };
    var row = codexMeasurePerformance_('getAgendaEventoPorId', 'locate', locateMeta, function() {
      return agendaLocalizarLinhaPorId_(sh, id, rowIndex, locateMeta);
    });
    if (!row) return null;
    var item = codexMeasurePerformance_('getAgendaEventoPorId', 'read', { rowCount: 1 }, function() {
      return agendaRowToObject_(sh.getRange(row, 1, 1, AGENDA_CFG.lastCol).getValues()[0], row);
    });
    totalMeta.rowCount = 1;
    codexMeasurePerformance_('getAgendaEventoPorId', 'hydrate', { rowCount: 1 }, function() {
      agendaHydrateParticipantFields_([item]);
    });
    return item;
  });
}

function agendaRowsToObjects_(vals, start) {
  var items = vals.map(function(r, i) { return agendaRowToObject_(r, start + i); });
  agendaHydrateParticipantFields_(items);
  return items;
}

function agendaHydrateParticipantFields_(items) {
  var precisaComplemento = (items || []).some(function(evento) {
    return evento && evento.participante && (!evento.idParticipante || !evento.braco);
  });
  if (!precisaComplemento) return items;
  var idsPorParticipante = {};
  var bracosPorParticipante = {};
  getCodexSheetDataByName_('Participantes').slice(1).forEach(function(r) {
    var nome = normText_(r[1]);
    if (nome && !idsPorParticipante[nome]) idsPorParticipante[nome] = String(r[4] || '').trim();
    if (nome && !bracosPorParticipante[nome]) bracosPorParticipante[nome] = String(r[6] || '').trim();
  });
  items.forEach(function(evento) {
    if (!evento.idParticipante && evento.participante) {
      evento.idParticipante = idsPorParticipante[normText_(evento.participante)] || '';
    }
    if (!evento.braco && evento.participante) {
      evento.braco = bracosPorParticipante[normText_(evento.participante)] || '';
    }
  });
  return items;
}

function agendaParseIsoBoundary_(value, label) {
  value = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Data de ' + label + ' invalida.');
  var parts = value.split('-').map(Number);
  var date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) {
    throw new Error('Data de ' + label + ' invalida.');
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function agendaRowToObject_(r, rowIndex) {
  var i = AGENDA_CFG.idx;
  var backupAplicavel = AgendaServerRules_.formPolicy(r[i.tipo]).labChoiceAllowed &&
    AgendaServerRules_.isLabCentral(r[i.labCentral]);
  return {
    rowIndex: rowIndex,
    id: String(r[i.id] || ''),
    recordVersion: agendaRecordVersionFromRow_(r),
    editRecordVersion: agendaEditableRecordVersionFromRow_(r),
    data: formatarDataSafe(r[i.data]),
    dataIso: formatarDataIsoAgenda_(r[i.data]),
    hora: formatarHoraSafe_(r[i.hora]),
    tipo: String(r[i.tipo] || ''),
    status: String(r[i.status] || ''),
    participante: String(r[i.participante] || ''),
    nascimento: formatarDataSafe(r[i.nasc]),
    idade: calcularIdadeAgenda_(r[i.nasc]),
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
    statusRequisicao: agendaStatusRequisicaoDisplay_(r[i.reqStatus], r[i.obs]),
    monitorName: String(r[i.monitorName] || ''),
    salaMonitoria: String(r[i.salaMonitoria] || ''),
    poloTrialConcluido: !!r[i.poloTrial],
    poloTrialData: formatAgendaDateTimeSafe_(r[i.poloTrial]),
    ecrfConcluida: !!r[i.ecrf],
    ecrfData: formatAgendaDateTimeSafe_(r[i.ecrf]),
    carroRequerido: agendaBooleanValue_(r[i.carroRequerido]),
    courier1: agendaCourierToObject_(r, i.c1),
    courier2: agendaCourierToObject_(r, i.c2),
    courier3: agendaCourierToObject_(r, i.c3),
    backup: {
      nome: backupAplicavel ? String(r[i.cb.nome] || '') : '',
      temperatura: backupAplicavel ? String(r[i.cb.temp] || '') : '',
      status: backupAplicavel ? String(r[i.cb.status] || '') : '',
      material: backupAplicavel ? agendaMaterialSummaryFromJson_(r[i.cb.matBio], r[i.cb.material]) : '',
      destino: backupAplicavel ? String(r[i.cb.destino] || '') : '',
      matBioJson: backupAplicavel ? String(r[i.cb.matBio] || '') : '',
      agendamento: backupAplicavel ? agendaBackupAgendaRefFromCell_(r[i.backupAgendaRef]) : null
    }
  };
}

function agendaCourierToObject_(r, c) {
  return {
    nome: String(r[c.nome] || ''),
    temperatura: String(r[c.temp] || ''),
    status: String(r[c.status] || ''),
    awb: String(r[c.awb] || ''),
    material: agendaMaterialSummaryFromJson_(r[c.matBio], r[c.material]),
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

function verificarNotificacoes(e, idAtivo, dataAnterior, sheetAtiva, linhaAtiva) {
  // Nas rotinas da WebApp, a aba e a linha ja foram localizadas e gravadas.
  // Reutiliza-las evita reabrir a Agenda, executar migracoes e varrer todos os IDs
  // novamente dentro da mesma operacao, o que pode provocar falhas transitorias do
  // servico Planilhas quando o WebApp executa como USER_ACCESSING.
  var sheet = sheetAtiva || getAgendaSheet_();
  var linha = Number(linhaAtiva || 0) || (idAtivo ? encontrarLinhaPorId(sheet, idAtivo) : e.range.getRow());
  if (!linha) return;
  var gatilho = sheet.getRange(linha, AGENDA_CFG.col.labCentral).getValue();
  var status = sheet.getRange(linha, AGENDA_CFG.col.status).getValue();
  var controle = String(sheet.getRange(linha, AGENDA_CFG.col.controle).getValue() || '');
  var dataAtual = sheet.getRange(linha, AGENDA_CFG.col.data).getValue();
  var mudouData = datasAgendaDiferentes_(dataAnterior, dataAtual);
  var notificationAction = AgendaServerRules_.notificationAction({
    labCentral: gatilho,
    status: status,
    control: controle,
    dateChanged: mudouData
  });
  if (notificationAction === 'agendamento') {
    if (agendaEmailEnabled_()) {
      enviarEmailAgendamento_(sheet, linha, e.user);
      sheet.getRange(linha, AGENDA_CFG.col.controle).setValue('Notificado ' + formatarDataSafe(sheet.getRange(linha, AGENDA_CFG.col.data).getValue()));
    } else {
      sheet.getRange(linha, AGENDA_CFG.col.controle).setValue('Pendente notificacao - modo teste');
    }
  } else if (notificationAction === 'reagendamento') {
    if (agendaEmailEnabled_()) enviarEmailReagendamento_(sheet, linha, e.user, dataAnterior);
    sheet.getRange(linha, AGENDA_CFG.col.controle).setValue('Reagendado ' + formatarDataSafe(dataAtual));
  } else if (notificationAction === 'cancelamento') {
    if (agendaEmailEnabled_()) enviarEmailCancelamento_(sheet, linha, e.user);
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

function aplicarLogicaCancelamento_(sheet, linha, status) {
  var range = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol);
  if (AgendaServerRules_.isCancelled(status)) {
    range.setFontColor('#999999').setFontLine('line-through').setBackground('#eeeeee');
  } else {
    range.setFontColor('#434343').setFontLine('none').setBackground(null);
  }
}

function enviarEmailAgendamento_(sheet, linha, usuario) {
  var dados = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var i = AGENDA_CFG.idx;
  var webAppUrl = ScriptApp.getService().getUrl();
  var assunto = '[AGENDAMENTO] ' + (dados[i.projeto] || '') + ' - Visita com Envio ao Lab Central';
  var body = gerarHtmlCabecalhoEmail_('Agendamento - Envio de Amostras ao Lab Central', '#2c3e50') +
    '<p>Foi realizado um novo agendamento de visita clínica que requer envio ao laboratório:</p>' +
    gerarTabelaAgendaEmail_(dados, true) +
    (agendaTemLogisticaEmail_(dados)
      ? gerarHtmlCouriers_(dados)
      : '<p>As informações de courier e transporte serão atualizadas na Agenda assim que estiverem disponíveis.</p>') +
    '<p><a href="' + webAppUrl + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Responsável', usuario) + '</div>';
  CodexExternalEffects_.sendEmail({ to: gerarListaDestinatarios_(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function enviarEmailCancelamento_(sheet, linha, usuario) {
  var dados = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var i = AGENDA_CFG.idx;
  var webAppUrl = ScriptApp.getService().getUrl();
  var assunto = '[CANCELAMENTO] ' + (dados[i.projeto] || '') + ' - Visita com Envio ao Lab Central';
  var body = gerarHtmlCabecalhoEmail_('CANCELAMENTO DE VISITA / ENVIO', '#c0392b') +
    '<p>A seguinte visita foi <b>REMOVIDA</b> do fluxo de envio ao Lab Central:</p>' +
    agendaCancelamentoMotivoHtml_(dados[i.obs]) +
    gerarTabelaAgendaEmail_(dados, true, 'Data Original') + gerarHtmlCouriers_(dados) +
    '<p><a href="' + webAppUrl + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Cancelado por', usuario) + '</div>';
  CodexExternalEffects_.sendEmail({ to: gerarListaDestinatarios_(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function enviarEmailReagendamento_(sheet, linha, usuario, dataAnteriorRaw) {
  var dados = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var i = AGENDA_CFG.idx;
  var webAppUrl = ScriptApp.getService().getUrl();
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
    gerarTabelaAgendaEmail_(dados, true) + gerarHtmlCouriers_(dados) +
    '<p><a href="' + webAppUrl + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Alterado por', usuario) + '</div>';
  CodexExternalEffects_.sendEmail({ to: gerarListaDestinatarios_(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function ipsEmailLogoUrl_() {
  return 'https://i0.wp.com/www.ucs.br/ips/wp-content/uploads/2024/08/logo_ips_2024_2.png?fit=300%2C80&ssl=1';
}

function gerarHtmlCabecalhoEmail_(titulo, cor) {
  return '<div style="font-family:Arial;color:#333;line-height:1.45;">' +
    '<style>p{margin:0 0 12px 0;} table{margin:12px 0 16px 0;}</style>' +
    '<img src="' + ipsEmailLogoUrl_() + '" style="max-height:60px;margin-bottom:20px;">' +
    '<h2 style="color:' + (cor || '#2c3e50') + ';">' + escHtmlServer_(titulo) + '</h2>';
}

function gerarTabelaAgendaEmail_(dados, incluirDataNascimento, rotuloData) {
  var i = AGENDA_CFG.idx;
  var nascimento = incluirDataNascimento ? (formatarDataSafe(dados[i.nasc]) || agendaNascimentoFromDados_({
    participante: dados[i.participante]
  })) : '';
  var rows = [
    [rotuloData || 'Data', formatarDataSafe(dados[i.data])],
    ['Tipo de Evento', dados[i.tipo] || ''],
    ['Protocolo', dados[i.projeto] || ''],
    ['Participante', (dados[i.participante] || '') + ' (' + extrairIniciais_(dados[i.participante]) + ')']
  ];
  if (incluirDataNascimento) rows.push(['Data de Nascimento', nascimento]);
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

function agendaTemLogisticaEmail_(dados) {
  var i = AGENDA_CFG.idx;
  function nomeValido(c) {
    var nome = String(dados[c.nome] || '').trim();
    return !!nome && ['---', 'Nao aplicavel', 'Não aplicável'].indexOf(nome) === -1;
  }
  return nomeValido(i.c1) || nomeValido(i.c2) || nomeValido(i.c3) || nomeValido(i.cb);
}

function gerarHtmlCouriers_(dados) {
  var i = AGENDA_CFG.idx;
  var html = '<div style="background:#f8f9fa;padding:14px;border-radius:5px;border:1px solid #ddd">' +
    '<h3 style="margin-top:0;color:#333">Informações de Logística / Transportes de Amostras</h3>';
  function addC(n, c) {
    if (!dados[c.nome] || ['---', 'Nao aplicavel', 'N\u00E3o aplic\u00E1vel'].indexOf(String(dados[c.nome])) > -1) return '';
    var material = agendaMaterialSummaryFromJson_(dados[c.matBio], dados[c.material]);
    return '<p style="margin:5px 0"><b>Transporte de Amostras ' + n + ':</b> ' + escHtmlServer_(dados[c.nome]) +
      ' | <b>Destino:</b> ' + escHtmlServer_(dados[c.destino] || '') +
      ' | <b>Temp:</b> ' + escHtmlServer_(dados[c.temp]) +
      ' | <b>Status:</b> ' + escHtmlServer_(dados[c.status]) +
      ' | <b>AWB:</b> ' + escHtmlServer_(dados[c.awb] || 'Pendente') +
      ' | <b>Material:</b> ' + escHtmlServer_(material) + '</p>';
  }
  html += addC(1, i.c1) + addC(2, i.c2) + addC(3, i.c3);
  if (dados[i.cb.nome] && String(dados[i.cb.nome]) !== 'N\u00E3o aplic\u00E1vel') {
    var backupMaterial = agendaMaterialSummaryFromJson_(dados[i.cb.matBio], dados[i.cb.material]);
    html += '<p style="margin:5px 0;border-top:1px solid #ccc;padding-top:5px"><b>Amostra Backup:</b> ' +
      escHtmlServer_(dados[i.cb.nome]) + ' | <b>Status:</b> ' + escHtmlServer_(dados[i.cb.status]) +
      ' | <b>Destino:</b> ' + escHtmlServer_(dados[i.cb.destino] || '') +
      ' | <b>Material:</b> ' + escHtmlServer_(backupMaterial) + '</p>';
  }
  return html + '</div>';
}

function gerarRodapeEmailAgenda_(label, usuario) {
  return '<hr><p style="font-size:11px;color:#777;">' + escHtmlServer_(label) + ': ' +
    escHtmlServer_(usuario && usuario.getEmail ? usuario.getEmail() : 'Desconhecido') + '</p>';
}

function extrairIniciais_(nome) {
  var raw = String(nome == null ? '' : nome).trim();
  if (!raw) return '';
  if (/^[A-Za-z\u00C0-\u00FF](?:\.[A-Za-z\u00C0-\u00FF])+\.?$/.test(raw.replace(/\s+/g, ''))) {
    return raw.replace(/\s+/g, '').toUpperCase().replace(/\.?$/, '.');
  }
  var ignorar = {
    de: true,
    da: true,
    das: true,
    do: true,
    dos: true,
    e: true
  };
  return raw
    .replace(/[.,;:()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(function(part) {
      var normalized = String(part || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return part && !ignorar[normalized];
    })
    .map(function(part) {
      return part.charAt(0).toUpperCase() + '.';
    })
    .join('');
}

function gerarListaDestinatarios_(usuario) {
  var destinatarios = [];
  var vals = getConfigAppValuesByKeys_(['Agenda'], ['Destinatarios email lab central', 'Destinatarios e-mail lab central'], []);
  vals.forEach(function(v) {
    String(v || '').split(/[;,]/).forEach(function(email) {
      email = String(email || '').trim();
      if (email) destinatarios.push(email);
    });
  });

  var user = '';
  try {
    user = usuario && usuario.getEmail ? usuario.getEmail() : '';
  } catch (eUser) {
    user = '';
  }
  if (!user) {
    try {
      user = getUsuarioEmail();
    } catch (eGetUser) {
      user = '';
    }
  }
  if (!user) {
    try {
      user = Session.getActiveUser().getEmail();
    } catch (eSession) {
      user = '';
    }
  }
  if (user) destinatarios.push(user);

  var users = codexGetAllowedUsers_();
  var vistos = {};
  destinatarios = destinatarios.filter(function(email) {
    var key = String(email || '').trim().toLowerCase();
    if (!key || vistos[key]) return false;
    if (users[key] && !users[key].active) return false;
    vistos[key] = true;
    return true;
  });
  return destinatarios.join(',');
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
    return formatarDataMesCurtoPt_(valor);
  }
  return String(valor);
}

function formatarDataMesCurtoPt_(valor, separador) {
  if (!valor) return '';
  var sep = separador || '/';
  if (!(valor instanceof Date)) {
    var texto = String(valor || '').trim().toLowerCase();
    var partes = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (partes) {
      return ('0' + Number(partes[1])).slice(-2) + sep + ['jan.','fev.','mar.','abr.','mai.','jun.','jul.','ago.','set.','out.','nov.','dez.'][Number(partes[2]) - 1] + sep + partes[3];
    }
    partes = texto.match(/^(\d{1,2})\/([a-z.]{3,5})\/(\d{4})$/i);
    if (partes) {
      var mapa = { 'jan':1,'jan.':1,'fev':2,'fev.':2,'mar':3,'mar.':3,'abr':4,'abr.':4,'mai':5,'mai.':5,'jun':6,'jun.':6,'jul':7,'jul.':7,'ago':8,'ago.':8,'set':9,'set.':9,'out':10,'out.':10,'nov':11,'nov.':11,'dez':12,'dez.':12 };
      var mesNum = mapa[partes[2]];
      if (mesNum) return ('0' + Number(partes[1])).slice(-2) + sep + ['jan.','fev.','mar.','abr.','mai.','jun.','jul.','ago.','set.','out.','nov.','dez.'][mesNum - 1] + sep + partes[3];
    }
  }
  var d = valor instanceof Date ? valor : new Date(valor);
  if (!(d instanceof Date) || isNaN(d.getTime())) return String(valor);

  var meses = ['jan.','fev.','mar.','abr.','mai.','jun.','jul.','ago.','set.','out.','nov.','dez.'];
  var tz = Session.getScriptTimeZone();
  var dia = Utilities.formatDate(d, tz, 'dd');
  var mes = meses[Number(Utilities.formatDate(d, tz, 'M')) - 1] || '';
  var ano = Utilities.formatDate(d, tz, 'yyyy');
  return dia + sep + mes + sep + ano;
}

function formatarDataHoraMesCurtoPt_(valor) {
  if (!valor) return '';
  var d = valor instanceof Date ? valor : new Date(valor);
  if (!(d instanceof Date) || isNaN(d.getTime())) return String(valor);
  return formatarDataMesCurtoPt_(d) + ' ' + Utilities.formatDate(d, Session.getScriptTimeZone(), 'HH:mm');
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
  codexAssertCanWrite_('excluirMedicamentoRecebido', 'Cadastros', rowIndex);
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
  return {
    itens: readConfigAppRows_().filter(function(r) {
      return !isAgendaLabDestinoConfig_(r);
    })
  };
}

function isAgendaLabDestinoConfig_(row) {
  return normText_(row && row.grupo) === 'agenda' &&
    ['laboratorio destino', 'laboratorio de destino', 'lab destino', 'laboratorio central destino'].indexOf(normText_(row && row.chave)) >= 0;
}

function clearConfigAppDefaultsCache_(source) {
  codexAssertCanWrite_('clearConfigAppDefaultsCache', 'Sistema', '');
  clearCodexRuntimeCaches_();
  clearTransporteOptionsCache_();
  codexMarkConfigCacheInvalidated_(source || 'Config_App');
}

function codexMarkConfigCacheInvalidated_(source) {
  try {
    var access = codexGetCurrentUserAccess();
    var props = PropertiesService.getScriptProperties();
    props.setProperty('CODEX_CONFIG_CACHE_INVALIDATED_AT', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'));
    props.setProperty('CODEX_CONFIG_CACHE_INVALIDATED_BY', access && access.email ? access.email : '');
    props.setProperty('CODEX_CONFIG_CACHE_INVALIDATED_SOURCE', String(source || ''));
  } catch (e) {}
}

function clearTransporteOptionsCache_() {
  try {
    CacheService.getScriptCache().remove('CONFIG_APP_DEFAULTS_ENSURED_V1');
    CacheService.getScriptCache().remove('CONFIG_APP_DEFAULTS_ENSURED_V2');
    CacheService.getScriptCache().remove('CONFIG_APP_DEFAULTS_ENSURED_V3');
    CacheService.getScriptCache().remove('CONFIG_APP_DEFAULTS_ENSURED_V4');
    CacheService.getScriptCache().remove('CONFIG_APP_DEFAULTS_ENSURED_V5');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V2');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V3');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V4');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V5');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V6');
    CacheService.getScriptCache().remove('TRANSPORTE_PARTICIPANTES_OPTIONS_V1');
  } catch (e) {}
  try {
    var docCache = CacheService.getDocumentCache();
    if (docCache) {
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V2');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V3');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V4');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V5');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V6');
      docCache.remove('TRANSPORTE_PARTICIPANTES_OPTIONS_V1');
    }
  } catch (e2) {}
}

function getConfigAppSheet_() {
  var ss = getCodexSpreadsheet_();
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
  codexAssertCanWrite_('salvarConfigAppItem', 'Sistema', payload && payload.rowIndex);
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
    var rowAnterior = sh.getRange(rowIndex, startCol, 1, 6).getValues()[0];
    sh.getRange(rowIndex, startCol, 1, 6).setValues([row]);
    codexWriteAuditChanges_('Sistema', 'salvarConfigAppItem', row[0] + '/' + row[1], [
      { field: 'Config_App - Grupo', oldValue: rowAnterior[0], newValue: row[0] },
      { field: 'Config_App - Chave', oldValue: rowAnterior[1], newValue: row[1] },
      { field: 'Config_App - Valor', oldValue: rowAnterior[2], newValue: row[2] },
      { field: 'Config_App - Ativo', oldValue: rowAnterior[3], newValue: row[3] },
      { field: 'Config_App - Ordem', oldValue: rowAnterior[4], newValue: row[4] },
      { field: 'Config_App - Observação', oldValue: rowAnterior[5], newValue: row[5] }
    ], 'Alteração de configuração');
    clearConfigAppDefaultsCache_('salvarConfigAppItem');
    return 'Configuração atualizada com sucesso.';
  }

  var lastRow = Math.max(sh.getLastRow(), 1);
  var values = sh.getRange(2, startCol, Math.max(1, lastRow - 1), 1).getValues();
  var target = 2;
  values.forEach(function(r, idx) {
    if (String(r[0] || '').trim()) target = idx + 3;
  });
  sh.getRange(target, startCol, 1, 6).setValues([row]);
  codexWriteAuditChanges_('Sistema', 'salvarConfigAppItem', row[0] + '/' + row[1], [
    { field: 'Config_App - Grupo', oldValue: '', newValue: row[0] },
    { field: 'Config_App - Chave', oldValue: '', newValue: row[1] },
    { field: 'Config_App - Valor', oldValue: '', newValue: row[2] },
    { field: 'Config_App - Ativo', oldValue: '', newValue: row[3] },
    { field: 'Config_App - Ordem', oldValue: '', newValue: row[4] },
    { field: 'Config_App - Observação', oldValue: '', newValue: row[5] }
  ], 'Cadastro de configuração');
  clearConfigAppDefaultsCache_('salvarConfigAppItem');
  return 'Configuração cadastrada com sucesso.';
}

function excluirConfigAppItem(rowIndex, startCol) {
  codexAssertCanWrite_('excluirConfigAppItem', 'Sistema', rowIndex);
  var sh = getConfigAppSheet_();
  var row = parseInt(rowIndex, 10);
  var col = parseInt(startCol, 10);
  if (col !== 1 && col !== 8) throw new Error('Bloco de configuração inválido.');
  if (!row || row < 2 || row > sh.getLastRow()) throw new Error('Configuração não encontrada.');

  var values = sh.getRange(row, col, 1, 6).getValues()[0];
  sh.getRange(row, col, 1, 6).clearContent();
  codexWriteAuditChanges_('Sistema', 'excluirConfigAppItem', values[0] + '/' + values[1], [
    { field: 'Config_App - Grupo', oldValue: values[0], newValue: '' },
    { field: 'Config_App - Chave', oldValue: values[1], newValue: '' },
    { field: 'Config_App - Valor', oldValue: values[2], newValue: '' },
    { field: 'Config_App - Ativo', oldValue: values[3], newValue: '' },
    { field: 'Config_App - Ordem', oldValue: values[4], newValue: '' },
    { field: 'Config_App - Observação', oldValue: values[5], newValue: '' }
  ], 'Exclusão de configuração');
  clearConfigAppDefaultsCache_('excluirConfigAppItem');
  return 'Configuração excluída com sucesso.';
}

function alinharStatusRequisicaoLegadoAgenda_(sh) {
  var cacheKey = 'AgendaLegacyReqAligned:v2';
  if (codexCacheGet_(cacheKey)) return;
  if (!sh || sh.getLastRow() < 2) {
    codexCachePut_(cacheKey, true, 21600);
    return;
  }
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, AGENDA_CFG.lastCol).getValues();
  var updates = [];
  rows.forEach(function(r, idx) {
    var prestador = String(r[AGENDA_CFG.idx.servTerc] || '').trim();
    var atual = String(r[AGENDA_CFG.idx.reqStatus] || '').trim();
    if (prestador && agendaObsIndicaRequisicaoOk_(r[AGENDA_CFG.idx.obs]) && !atual) {
      updates.push({ row: idx + 2, value: 'Requisição Enviada' });
    }
  });
  updates.forEach(function(u) {
    sh.getRange(u.row, AGENDA_CFG.col.reqStatus).setValue(u.value);
  });
  codexCachePut_(cacheKey, true, 21600);
}

function agendaObsIndicaRequisicaoOk_(obs) {
  return AgendaServerRules_.requestObservationIndicatesSent(obs);
}

function agendaRequisicaoEnviada_(status, obs) {
  return AgendaServerRules_.requestIsSent(status, obs);
}

function agendaStatusRequisicaoDisplay_(status, obs) {
  status = String(status || '').trim();
  if (status) return status;
  return agendaObsIndicaRequisicaoOk_(obs) ? 'Requisição Enviada' : '';
}

// ============================================================================
//  LABORATÓRIOS CENTRAIS
// ============================================================================
function getLabCentralSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('LabCentral');
  var headers = ['ID_Lab', 'Nome abreviado', 'Nome completo', 'Endereço', 'Cidade', 'CEP', 'Telefone', 'Contato', 'País', 'CDC Permit'];
  if (!sh) {
    sh = ss.insertSheet('LabCentral');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return sh;
  }
  if (sh.getLastColumn() < headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function getLabCentral() {
  if (CODEX_LAB_CENTRAL_CACHE_ && !CODEX_CACHE_BYPASS_READS_) return CODEX_LAB_CENTRAL_CACHE_;
  var sh = getLabCentralSheet_();
  var lastRow = sh ? sh.getLastRow() : 0;
  if (!sh || lastRow < 2) {
    CODEX_LAB_CENTRAL_CACHE_ = [];
    return CODEX_LAB_CENTRAL_CACHE_;
  }
  CODEX_LAB_CENTRAL_CACHE_ = sh.getRange(2, 1, lastRow - 1, 10).getValues()
    .filter(function(r) { return r[0] || r[1] || r[2]; })
    .map(function(r) {
      return {
        id: String(r[0] || ''),
        nomeAbreviado: String(r[1] || ''),
        nomeCompleto: String(r[2] || ''),
        endereco: String(r[3] || ''),
        cidade: String(r[4] || ''),
        cep: String(r[5] || ''),
        telefone: String(r[6] || ''),
        contato: String(r[7] || ''),
        pais: String(r[8] || ''),
        cdcPermit: String(r[9] || '')
      };
    });
  return CODEX_LAB_CENTRAL_CACHE_;
}

function gerarNovoIdLabCentral_(sh) {
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function(r) { return String(r[0] || ''); }) : [];
  var id;
  do {
    id = 'LAB-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
  } while (ids.indexOf(id) !== -1);
  return id;
}

function salvarLabCentral(dados) {
  codexAssertCanWrite_('salvarLabCentral', 'Sistema', dados && dados.id);
  dados = dados || {};
  if (!String(dados.nomeAbreviado || '').trim()) throw new Error('Informe o nome abreviado.');
  if (!String(dados.nomeCompleto || '').trim()) throw new Error('Informe o nome completo.');
  var sh = getLabCentralSheet_();
  var row = [
    String(dados.id || '').trim(),
    String(dados.nomeAbreviado || '').trim(),
    String(dados.nomeCompleto || '').trim(),
    String(dados.endereco || '').trim(),
    String(dados.cidade || '').trim(),
    String(dados.cep || '').trim(),
    String(dados.telefone || '').trim(),
    String(dados.contato || '').trim(),
    String(dados.pais || '').trim(),
    String(dados.cdcPermit || '').trim()
  ];
  if (row[0]) {
    var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === row[0]) {
        sh.getRange(i + 2, 1, 1, 10).setValues([row]);
        limparCacheLabCentral_();
        return 'Laboratório central atualizado com sucesso.';
      }
    }
    throw new Error('Laboratório central não encontrado para edição.');
  }
  row[0] = gerarNovoIdLabCentral_(sh);
  sh.appendRow(row);
  limparCacheLabCentral_();
  return 'Laboratório central cadastrado com sucesso.';
}

function excluirLabCentral(id) {
  codexAssertCanWrite_('excluirLabCentral', 'Sistema', id);
  var sh = getLabCentralSheet_();
  if (!id || sh.getLastRow() < 2) throw new Error('Laboratório central não encontrado.');
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sh.deleteRow(i + 2);
      limparCacheLabCentral_();
      return 'ok';
    }
  }
  throw new Error('Laboratório central não encontrado.');
}

function limparCacheLabCentral_() {
  CODEX_LAB_CENTRAL_CACHE_ = null;
  CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
  try {
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V2');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V3');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V4');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V5');
    CacheService.getScriptCache().remove('TRANSPORTE_OPTIONS_BASE_V6');
    codexCacheRemove_('AgendaFormData:v2:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormData:v3:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormData:v4:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormData:v5:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormData:v6:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormData:v7:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormData:v8:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormData:v9:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaFormDataStrict:v3:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    codexCacheRemove_('AgendaBootstrapReferenceData:v2:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd'));
    var docCache = CacheService.getDocumentCache();
    if (docCache) {
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V2');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V3');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V4');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V5');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V6');
    }
  } catch (e) {}
}

// ============================================================================
//  COURIERS
// ============================================================================
var COURIER_HEADERS_ = [
  'ID_Courier',
  'Courier',
  'Empresa de Remessa Express/Courier (1)',
  'CNPJ (1)',
  'Telefone (1)',
  'Fax(1)',
  'Empresa de Remessa Express/Courier (2)',
  'CNPJ (2)',
  'Telefone (2)',
  'Fax (2)',
  'Conteúdo da Declaração de Transporte',
  'E-mail',
  'E-mail ambiente',
  'E-mail congelado',
  'Monitorar confirmação',
  'E-mail confirmação',
  'Texto confirmação',
  'Status confirmação'
];

var COURIER_OPERATIONAL_FIELDS_ = [
  { key: 'disponivelProjetos', header: 'Disponível para projetos', aliases: ['Disponivel para projetos', 'Vinculável a projetos', 'Vinculavel a projetos'] },
  { key: 'forneceGeloColeta', header: 'Fornece gelo para coleta', aliases: ['Fornece gelo'] },
  { key: 'restricaoSegunda', header: 'Restrição às segundas-feiras', aliases: ['Restricao as segundas-feiras', 'Restrição segunda-feira'] },
  { key: 'restricaoAposFeriado', header: 'Restrição após feriado', aliases: ['Restricao apos feriado'] },
  { key: 'observacaoOperacional', header: 'Observação operacional', aliases: ['Observacao operacional'] }
];

function courierDisponivelParaProjeto_(courier) {
  courier = courier || {};
  if (typeof courier.disponivelProjetos === 'boolean') return courier.disponivelProjetos;
  var informado = normText_(courier.disponivelProjetos);
  if (informado === 'sim') return true;
  if (informado === 'nao') return false;
  return normText_(courier.nome || courier.courier) !== 'pinex (agendamento)';
}

function courierConfirmationDefaults_(nome) {
  var n = normText_(nome);
  if (n.indexOf('marken') >= 0) {
    return {
      monitorConfirmacao: 'Sim',
      emailConfirmacao: 'expobrasil@marken.com',
      textoConfirmacao: 'Confirmamos o agendamento da retirada conforme informações abaixo. || Agendamento da retirada confirmado conforme solicitado.',
      textosConfirmacao: [
        'Confirmamos o agendamento da retirada conforme informações abaixo.',
        'Agendamento da retirada confirmado conforme solicitado.'
      ],
      statusConfirmacao: 'Confirmado',
      extrairAwbPorReferencia: false
    };
  }
  if (n.indexOf('ocasa') >= 0) {
    return {
      monitorConfirmacao: 'Sim',
      emailConfirmacao: 'ocasa.com',
      textoConfirmacao: 'Informamos que sua coleta foi devidamente agendada. Solicitamos, por gentileza, que verifique atentamente as informações abaixo:',
      statusConfirmacao: 'Confirmado',
      extrairAwbPorReferencia: false
    };
  }
  if (n.indexOf('dhl') >= 0) {
    return {
      monitorConfirmacao: 'Sim',
      emailConfirmacao: 'wmxbrasil@dhl.com',
      textoConfirmacao: 'Agendamento realizado para',
      statusConfirmacao: 'Confirmado',
      extrairAwbPorReferencia: true
    };
  }
  return {};
}

function getCourierSheet_() {
  var ss = getCodexSpreadsheet_();
  var sh = getSheetByPossibleNames_(ss, ['Courier', 'Couriers']);
  if (!sh) sh = ss.insertSheet('Courier');
  if (sh.getLastColumn() < COURIER_HEADERS_.length) {
    sh.getRange(1, 1, 1, COURIER_HEADERS_.length).setValues([COURIER_HEADERS_]);
  }
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, COURIER_HEADERS_.length).setValues([COURIER_HEADERS_]);
  try { sh.hideColumns(1); } catch (e) {}
  sh.setFrozenRows(1);
  return sh;
}

function getCouriersCadastro() {
  garantirIdsCouriers_();
  try {
    garantirCourierConfirmationDefaults_();
  } catch (e) {
    Logger.log('[getCouriersCadastro] Defaults de confirmação não persistidos: ' + e.message);
  }
  return getAgendaCourierRows_();
}

function garantirCourierConfirmationDefaults_() {
  var sh = getCourierSheet_();
  if (!sh || sh.getLastRow() < 2) return;
  var numRows = sh.getLastRow() - 1;
  var values = sh.getRange(2, 1, numRows, COURIER_HEADERS_.length).getValues();
  var changed = false;
  values.forEach(function(row) {
    var defaults = courierConfirmationDefaults_(row[1]);
    if (!defaults.monitorConfirmacao) return;
    if (!String(row[14] || '').trim()) { row[14] = defaults.monitorConfirmacao; changed = true; }
    if (!String(row[15] || '').trim()) { row[15] = defaults.emailConfirmacao; changed = true; }
    if (!String(row[16] || '').trim()) { row[16] = defaults.textoConfirmacao; changed = true; }
    if (!String(row[17] || '').trim()) { row[17] = defaults.statusConfirmacao; changed = true; }
  });
  if (changed) {
    sh.getRange(2, 1, numRows, COURIER_HEADERS_.length).setValues(values);
    limparCacheCourier_();
  }
}

function garantirIdsCouriers_() {
  var sh = getCourierSheet_();
  if (!sh || sh.getLastRow() < 2) return;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  var changed = false;
  var used = {};
  values.forEach(function(r) {
    var id = String(r[0] || '').trim();
    if (id) used[id] = true;
  });
  values.forEach(function(r, idx) {
    if (String(r[0] || '').trim() || !String(r[1] || '').trim()) return;
    var id;
    do {
      id = 'COU-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
    } while (used[id]);
    used[id] = true;
    values[idx][0] = id;
    changed = true;
  });
  if (changed) {
    sh.getRange(2, 1, values.length, 2).setValues(values);
    limparCacheCourier_();
  }
}

function gerarNovoIdCourier_(sh) {
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function(r) { return String(r[0] || ''); }) : [];
  var id;
  do {
    id = 'COU-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
  } while (ids.indexOf(id) !== -1);
  return id;
}

function courierOperationalPayloadPresente_(dados) {
  return COURIER_OPERATIONAL_FIELDS_.some(function(field) {
    return Object.prototype.hasOwnProperty.call(dados || {}, field.key);
  });
}

function courierOperationalValue_(field, value) {
  var raw = String(value || '').trim();
  if (field.key === 'observacaoOperacional' || !raw) return raw;
  var normalized = normText_(raw);
  if (normalized === 'sim') return 'Sim';
  if (normalized === 'nao') return 'Não';
  throw new Error('Use Sim ou Não nos campos de regras operacionais da courier.');
}

function validarCourierOperationalFields_(dados) {
  if (!courierOperationalPayloadPresente_(dados)) return;
  COURIER_OPERATIONAL_FIELDS_.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(dados, field.key)) courierOperationalValue_(field, dados[field.key]);
  });
}

function garantirCourierOperationalColumns_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var normalized = headers.map(function(header) { return normText_(header); });
  var map = {};
  COURIER_OPERATIONAL_FIELDS_.forEach(function(field) {
    var names = [field.header].concat(field.aliases || []);
    var index = -1;
    for (var i = 0; i < names.length && index < 0; i++) index = normalized.indexOf(normText_(names[i]));
    if (index < 0) {
      index = headers.length;
      sh.getRange(1, index + 1).setValue(field.header);
      headers.push(field.header);
      normalized.push(normText_(field.header));
    }
    map[field.key] = index;
  });
  return map;
}

function gravarCourierOperationalFields_(sh, rowNumber, dados) {
  if (!courierOperationalPayloadPresente_(dados)) return;
  var columns = garantirCourierOperationalColumns_(sh);
  COURIER_OPERATIONAL_FIELDS_.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(dados, field.key)) return;
    sh.getRange(rowNumber, columns[field.key] + 1).setValue(courierOperationalValue_(field, dados[field.key]));
  });
}

function salvarCourier(dados) {
  codexAssertCanWrite_('salvarCourier', 'Sistema', dados && dados.id);
  dados = dados || {};
  var nome = String(dados.nome || dados.courier || '').trim();
  if (!nome) throw new Error('Informe o nome da courier.');
  validarCourierOperationalFields_(dados);
  var defaults = courierConfirmationDefaults_(nome);
  var monitorConfirmacao = String(dados.monitorConfirmacao || defaults.monitorConfirmacao || '').trim();
  var sh = getCourierSheet_();
  var row = [
    String(dados.id || '').trim(),
    nome,
    String(dados.empresa1 || '').trim(),
    String(dados.cnpj1 || '').trim(),
    String(dados.telefone1 || '').trim(),
    String(dados.fax1 || '').trim(),
    String(dados.empresa2 || '').trim(),
    String(dados.cnpj2 || '').trim(),
    String(dados.telefone2 || '').trim(),
    String(dados.fax2 || '').trim(),
    codexSanitizeCourierHtml_(dados.conteudoDeclaracao),
    String(dados.email || '').trim(),
    String(dados.emailAmbiente || '').trim(),
    String(dados.emailCongelado || '').trim(),
    monitorConfirmacao,
    String(dados.emailConfirmacao || defaults.emailConfirmacao || '').trim(),
    String(dados.textoConfirmacao || defaults.textoConfirmacao || '').trim(),
    String(dados.statusConfirmacao || defaults.statusConfirmacao || '').trim()
  ];
  if (row[0]) {
    var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === row[0]) {
        sh.getRange(i + 2, 1, 1, COURIER_HEADERS_.length).setValues([row]);
        gravarCourierOperationalFields_(sh, i + 2, dados);
        limparCacheCourier_();
        return 'Courier atualizada com sucesso.';
      }
    }
    throw new Error('Courier não encontrada para edição.');
  }
  row[0] = gerarNovoIdCourier_(sh);
  sh.appendRow(row);
  gravarCourierOperationalFields_(sh, sh.getLastRow(), dados);
  limparCacheCourier_();
  return 'Courier cadastrada com sucesso.';
}

function codexSanitizeCourierHtml_(value) {
  var input = String(value || '').replace(/\u0000/g, '');
  var allowed = { b: true, strong: true, i: true, em: true, u: true, br: true, p: true };
  var output = '';
  var lastIndex = 0;
  var tagPattern = /<[^>]*>/g;
  var match;

  function escapeText(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  while ((match = tagPattern.exec(input)) !== null) {
    output += escapeText(input.slice(lastIndex, match.index));
    var parsed = /^<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>$/i.exec(match[0]);
    if (parsed && allowed[parsed[2].toLowerCase()]) {
      var closing = parsed[1] === '/';
      var tagName = parsed[2].toLowerCase();
      if (tagName === 'br') {
        output += '<br>';
      } else {
        output += closing ? '</' + tagName + '>' : '<' + tagName + '>';
      }
    } else {
      output += escapeText(match[0]);
    }
    lastIndex = tagPattern.lastIndex;
  }

  output += escapeText(input.slice(lastIndex));
  return output.trim();
}

function excluirCourier(id) {
  codexAssertCanWrite_('excluirCourier', 'Sistema', id);
  var sh = getCourierSheet_();
  if (!id || sh.getLastRow() < 2) throw new Error('Courier não encontrada.');
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      sh.deleteRow(i + 2);
      limparCacheCourier_();
      return 'ok';
    }
  }
  throw new Error('Courier não encontrada.');
}

function limparCacheCourier_() {
  clearCodexRuntimeCaches_();
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('TRANSPORTE_OPTIONS_BASE_V3');
    cache.remove('TRANSPORTE_OPTIONS_BASE_V4');
    cache.remove('TRANSPORTE_OPTIONS_BASE_V5');
    cache.remove('TRANSPORTE_OPTIONS_BASE_V6');
    var docCache = CacheService.getDocumentCache();
    if (docCache) {
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V3');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V4');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V5');
      docCache.remove('TRANSPORTE_OPTIONS_BASE_V6');
    }
  } catch (e) {}
}

