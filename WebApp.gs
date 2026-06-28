// ======================================================
// WEBAPP — PONTO DE ENTRADA
// ======================================================
var CODEX_ACL_SHEET_NAME_ = 'Users';
var CODEX_ACL_CACHE_KEY_ = 'UsersAclEmails:v2';
var CODEX_ACL_CACHE_SECONDS_ = 120;
var CODEX_USER_ROLES_ = { admin: true, user: true, readonly: true };
var CODEX_API_TOKEN_REQUEST_ = false;
var CODEX_DOCUMENT_LOCK_REENTRANT_DEPTH_ = 0;
var CODEX_APP_VERSION_ = '2026.06.28-fase4-ux-operacional';
var CODEX_APP_BUILD_LABEL_ = 'Fase 4 - UX operacional em Agenda e Transporte';
var CODEX_APP_BUILD_DATE_ = '2026-06-28';
var CODEX_APP_EXPECTED_EXECUTE_AS_ = 'USER_ACCESSING';

function doGet(e) {
  var access = codexAuthorizeWebAppRequestSafe_(e);
  if (!access.ok) return codexAccessDeniedOutput_(access);

  var page = e && e.parameter ? e.parameter.page : 'index';

  if (page === 'dashboard') {
    var tplDashboard = HtmlService.createTemplateFromFile('Index');
    tplDashboard.includeEstoque = false;
    tplDashboard.includeDashboard = true;
    tplDashboard.paginaInicial = 'dashboard';
    tplDashboard.buscaInicial = '';
    tplDashboard.dashboardFiltroInicial = '';
    tplDashboard.dashboardFiltroKeys = '';
    return tplDashboard
      .evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('IPS | UCS')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === 'estoque' || page === 'pedidos' || page === 'estoque-view') {
    var tplEstoque = HtmlService.createTemplateFromFile('Index');
    tplEstoque.includeEstoque = true;
    tplEstoque.includeDashboard = false;
    tplEstoque.paginaInicial = page === 'pedidos'
      ? 'pedidos'
      : (page === 'estoque-view' ? 'visualizacao' : (e && e.parameter ? (e.parameter.pagina || 'itens') : 'itens'));
    tplEstoque.buscaInicial = e && e.parameter ? (e.parameter.busca || '') : '';
    tplEstoque.dashboardFiltroInicial = '';
    tplEstoque.dashboardFiltroKeys = '';
    return tplEstoque
      .evaluate()
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setTitle('IPS | UCS')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
      .setTitle('IPS | Transporte de Mat. Biologico')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // default — página principal
  var tplIndex = HtmlService.createTemplateFromFile('Index');
  tplIndex.includeEstoque = false;
  tplIndex.includeDashboard = false;
  tplIndex.paginaInicial = e && e.parameter ? (e.parameter.pagina || 'agenda') : 'agenda';
  tplIndex.buscaInicial = '';
  tplIndex.dashboardFiltroInicial = e && e.parameter ? (e.parameter.dashFiltro || '') : '';
  tplIndex.dashboardFiltroKeys = e && e.parameter ? (e.parameter.dashKeys || '') : '';
  return tplIndex
    .evaluate()
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setTitle('IPS | UCS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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

function getAppBootstrapData() {
  var out = {
    access: codexGetCurrentUserAccess(),
    auth: codexGetUserOAuthStatus_(),
    appVersion: codexGetAppVersion_(),
    webAppUrl: '',
    agendaFormData: null,
    errors: {}
  };
  try {
    out.webAppUrl = ScriptApp.getService().getUrl();
  } catch (e1) {
    out.errors.webAppUrl = e1.message || String(e1);
  }
  try {
    out.agendaFormData = getDadosFormularioAgenda();
  } catch (e2) {
    out.errors.agendaFormData = e2.message || String(e2);
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

function getCodexDeploymentDiagnostics() {
  var access = codexAssertAdmin_();
  var out = {
    ok: true,
    appVersion: codexGetAppVersion_(),
    checkedAt: '',
    access: {
      email: access.userEmail || '',
      name: access.name || '',
      role: access.role || ''
    },
    webAppUrl: '',
    auth: codexGetUserOAuthStatus_(),
    identity: codexGetIdentityDiagnostics_(),
    spreadsheet: {
      ok: false,
      name: '',
      idSuffix: '',
      url: '',
      timeZone: '',
      sheets: [],
      error: ''
    },
    cache: codexGetCacheDiagnostics_(),
    script: {
      timeZone: '',
      expectedExecuteAs: CODEX_APP_EXPECTED_EXECUTE_AS_
    }
  };
  try {
    var tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
    out.script.timeZone = tz;
    out.checkedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  } catch (e0) {
    out.checkedAt = new Date().toISOString();
  }
  try {
    out.webAppUrl = ScriptApp.getService().getUrl();
  } catch (e1) {
    out.webAppUrlError = e1.message || String(e1);
  }
  try {
    var ss = getCodexSpreadsheet_();
    var id = String(ss.getId() || '');
    out.spreadsheet.ok = true;
    out.spreadsheet.name = ss.getName();
    out.spreadsheet.idSuffix = id ? id.slice(-8) : '';
    out.spreadsheet.url = ss.getUrl();
    out.spreadsheet.timeZone = ss.getSpreadsheetTimeZone();
    out.spreadsheet.sheets = ss.getSheets().map(function(sh) { return sh.getName(); }).slice(0, 40);
  } catch (e2) {
    out.spreadsheet.error = e2.message || String(e2);
  }
  return out;
}

function codexGetCacheDiagnostics_() {
  var out = {
    configRowsCachePresent: false,
    agendaBootstrapCachePresent: false,
    lastConfigInvalidationAt: '',
    lastConfigInvalidationBy: '',
    lastConfigInvalidationSource: '',
    configRowsApprox: '',
    error: ''
  };
  try {
    out.configRowsCachePresent = !!codexCacheGet_('ConfigAppRows:v2');
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    out.agendaBootstrapCachePresent = !!codexCacheGet_('AgendaFormData:v6:' + today);
    var props = PropertiesService.getScriptProperties();
    out.lastConfigInvalidationAt = String(props.getProperty('CODEX_CONFIG_CACHE_INVALIDATED_AT') || '');
    out.lastConfigInvalidationBy = String(props.getProperty('CODEX_CONFIG_CACHE_INVALIDATED_BY') || '');
    out.lastConfigInvalidationSource = String(props.getProperty('CODEX_CONFIG_CACHE_INVALIDATED_SOURCE') || '');
    var sh = getCodexSpreadsheet_().getSheetByName('Config_App');
    if (sh) out.configRowsApprox = Math.max(0, sh.getLastRow() - 1);
  } catch (e) {
    out.error = e.message || String(e);
  }
  return out;
}

function limparCodexCachesDiagnostico() {
  var access = codexAssertAdmin_();
  clearConfigAppDefaultsCache_('Diagnostico');
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('CODEX_CONFIG_CACHE_INVALIDATED_BY', access.userEmail || '');
  } catch (e) {}
  return getCodexDeploymentDiagnostics();
}

function codexGetUserOAuthStatus_() {
  var scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://mail.google.com/',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/script.send_mail'
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
  } else if (page === 'projetos') {
    out.config = getProjetoFormConfig();
    out.data = getProjetos();
    out.medicos = getMedicos();
    out.solicitantes = getSolicitantes();
  } else if (page === 'monitores') {
    out.data = getMonitores();
    out.projetos = getProjetosMonitoria_();
  } else if (page === 'equipamentos') {
    out.data = getEquipamentosFornecidos();
  } else if (page === 'medicamentos') {
    out.data = getMedicamentosRecebidos();
  } else if (page === 'medicos') {
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
  else if (page === 'relatorios' || page === 'estoque-view') out.data = getEstoque();
  else throw new Error('Bootstrap de estoque nao suportado: ' + page);
  return out;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
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
      role: user.role,
      message: 'Seu usuario esta inativo neste sistema.'
    };
  }

  return {
    ok: true,
    userEmail: userEmail,
    name: user.name || '',
    firstName: codexFirstName_(user.name, userEmail),
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
  return {
    ok: !!access.ok,
    email: access.userEmail || '',
    name: access.name || '',
    firstName: access.firstName || codexFirstName_(access.name, access.userEmail),
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
  if (lastRow < 2) return;
  var vals = sh.getRange(2, 1, lastRow - 1, 8).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    var expiresAt = vals[i][6];
    var expired = expiresAt instanceof Date ? expiresAt.getTime() < now.getTime() : true;
    if (expired) sh.deleteRow(i + 2);
  }
}

function codexGetRecordVersion_(moduleName, recordId) {
  moduleName = String(moduleName || '').trim();
  recordId = String(recordId || '').trim();
  if (!recordId) return '';
  if (normText_(moduleName) === 'agenda') {
    var agenda = getAgendaSheet_();
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
    codexCleanupEditPresence_(sh, now);
    var version = codexGetRecordVersion_(moduleName, recordId);
    var email = codexNormalizeEmail_(access.userEmail || access.email || codexGetActiveUserEmail_()) || 'usuario';
    var name = access.name || access.firstName || email;
    var lastRow = sh.getLastRow();
    var vals = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, 8).getValues() : [];
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
    return { ok: true, module: moduleName, recordId: recordId, sessionId: sessionId, version: version, editors: editors, ttlSeconds: ttlSeconds };
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
    codexCleanupEditPresence_(sh, new Date());
    var email = codexNormalizeEmail_(access.userEmail || access.email || codexGetActiveUserEmail_()) || 'usuario';
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true };
    var vals = sh.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      var r = vals[i];
      if (String(r[0] || '') === moduleName &&
          String(r[1] || '') === recordId &&
          codexNormalizeEmail_(r[2]) === email &&
          String(r[4] || '') === sessionId) {
        sh.deleteRow(i + 2);
      }
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

function getAuditRowsPage_(sheetName, colCount, limit, offset, mapper) {
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) {
    return { rows: [], total: 0, limit: Math.max(1, Math.min(Number(limit || 100), 500)), offset: 0, hasMore: false };
  }
  limit = Math.max(1, Math.min(Number(limit || 100), 500));
  offset = Math.max(0, Number(offset || 0));
  var lastRow = sh.getLastRow();
  var total = lastRow - 1;
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

function getAuditLog(limit) {
  return getAuditLogPage(limit, 0).rows;
}

function getAuditLogPage(limit, offset) {
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
  });
}

function getAuditChanges(limit) {
  return getAuditChangesPage(limit, 0).rows;
}

function getAuditChangesPage(limit, offset) {
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
  });
}

function getAuditPage(type, limit, offset) {
  type = String(type || 'log') === 'changes' ? 'changes' : 'log';
  var page = type === 'changes' ? getAuditChangesPage(limit, offset) : getAuditLogPage(limit, offset);
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

function getUsersAdminList() {
  codexAssertAdmin_();
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(4, sh.getLastColumn())).getValues();
  return rows.map(function(r, idx) {
    var email = codexNormalizeEmail_(r[0]);
    var name = codexNormalizeUserName_(r[1]);
    if (!email) return null;
    return {
      rowIndex: idx + 2,
      email: email,
      name: name,
      firstName: codexFirstName_(name, email),
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

function salvarUsuarioAdmin(payload) {
  var access = codexAssertAdmin_();
  payload = payload || {};
  var email = codexNormalizeEmail_(payload.email);
  var name = codexNormalizeUserName_(payload.name);
  var role = codexNormalizeRole_(payload.role);
  var ativo = codexNormalizeActive_(payload.ativo) ? 'Sim' : 'Não';
  if (!email) throw new Error('Informe o e-mail do usuário.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  if (email === codexNormalizeEmail_(access.userEmail) && (role !== 'admin' || ativo !== 'Sim')) {
    throw new Error('Você não pode remover seu próprio acesso administrativo.');
  }

  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_);
  if (!sh) throw new Error('Aba Users não encontrada.');
  var rowIndex = Number(payload.rowIndex || 0);
  var lastRow = sh.getLastRow();
  var rows = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, Math.max(4, sh.getLastColumn())).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    var existingEmail = codexNormalizeEmail_(rows[i][0]);
    var existingRow = i + 2;
    if (existingEmail === email && existingRow !== rowIndex) {
      throw new Error('Este e-mail já está cadastrado na aba Users.');
    }
  }
  if (!rowIndex || rowIndex < 2) rowIndex = Math.max(2, lastRow + 1);
  var rowAnterior = rowIndex <= lastRow ? sh.getRange(rowIndex, 1, 1, 4).getValues()[0] : ['', '', '', ''];
  sh.getRange(rowIndex, 1, 1, 4).setValues([[email, name, role, ativo]]);
  codexCacheRemove_(CODEX_ACL_CACHE_KEY_);
  codexWriteAuditLog_('salvarUsuarioAdmin', 'Sistema', email);
  codexWriteAuditChanges_('Sistema', 'salvarUsuarioAdmin', email, [
    { field: 'Usuário - E-mail', oldValue: rowAnterior[0], newValue: email },
    { field: 'Usuário - Nome', oldValue: rowAnterior[1], newValue: name },
    { field: 'Usuário - Perfil', oldValue: rowAnterior[2], newValue: role },
    { field: 'Usuário - Ativo', oldValue: rowAnterior[3], newValue: ativo }
  ], rowAnterior[0] ? 'Alteração de usuário/permissão' : 'Cadastro de usuário/permissão');
  return { ok: true, rowIndex: rowIndex, email: email, name: name, firstName: codexFirstName_(name, email), role: role, ativo: ativo };
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
  return { ok: true, rowIndex: rowIndex, email: email, ativo: 'Não' };
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

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(4, sh.getLastColumn())).getValues();
  var users = {};
  values.forEach(function(row) {
    var email = codexNormalizeEmail_(row[0]);
    if (!email || users[email]) return;
    var name = codexNormalizeUserName_(row[1]);
    users[email] = {
      name: name,
      firstName: codexFirstName_(name, email),
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
}

function codexCacheGet_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function codexCachePut_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds || CODEX_CACHE_TTL_SECONDS_);
  } catch (e) {}
}

function codexCacheRemove_(key) {
  try {
    CacheService.getScriptCache().remove(key);
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
  if (!CODEX_SHEET_DATA_CACHE_[key]) {
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
  if (CODEX_CONFIG_APP_ROWS_CACHE_) return CODEX_CONFIG_APP_ROWS_CACHE_;
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

function agendaTipoExigeLabCentralServer_(tipo) {
  var n = normText_(tipo);
  if (agendaTipoContatoTelefonicoServer_(tipo)) return false;
  return n.indexOf('visita') > -1 || n.indexOf('amostra') > -1;
}

function agendaTipoContatoTelefonicoServer_(tipo) {
  var n = normText_(tipo);
  return n.indexOf('contato telefonico') > -1 || n.indexOf('telefon') > -1;
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
        sh.getRange(linha, 4).setValue(dados.cpf           || '');
        sh.getRange(linha, 5).setValue(dados.cremers       || '');
        sh.getRange(linha, 6).setValue(dados.telefone      || '');
        sh.getRange(linha, 7).setValue(dados.email         || '');
        return 'Médico atualizado com sucesso.';
      }
    }
    throw new Error('Médico com ID "' + dados.id + '" não encontrado.');
  }

  var novoId = 'MED-' + new Date().getTime();
  sh.appendRow([novoId, dados.nome || '', dados.especialidade || '',
                dados.cpf || '', dados.cremers || '',
                dados.telefone || '', dados.email || '']);
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
    if (ids[i][0] == id) { sh.deleteRow(i + 2); return 'ok'; }
  }
  throw new Error('Registro não encontrado.');
}



// ══════════════════════════════════════════════════════
//  SOLICITANTE
// ══════════════════════════════════════════════════════
// Mantida para compatibilidade com formulários legados
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
  var preload = reqExamesPreloadReadProjeto_(projeto, null, tipoServico, true);
  var exames = preload && preload.active ? preload.exames : [];
  return {
    projeto: String(projeto || '').trim(),
    tipoServico: String(tipoServico || '').trim(),
    chave: reqExamesPreloadKey_(projeto, tipoServico),
    exames: exames,
    hash: reqExamesPreloadHash_(exames),
    exists: !!(preload && preload.rowIndex),
    active: !(preload && !preload.active)
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
  if (agendaDateIsBeforeToday_(dados.dataAgendamento)) {
    throw new Error('Requisicoes de Exame nao podem ser marcadas para uma data anterior a hoje.');
  }
  var solicitanteEmail = reqExamesSolicitanteEmail_(dados.solicitante);
  if (!dados.requestedByEmail && access && access.userEmail) dados.requestedByEmail = access.userEmail;
  if (solicitanteEmail) dados.requestedByEmail = solicitanteEmail;
  const ss    = reqExamesOpenSpreadsheetForWrite_();
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

  var exames = (Array.isArray(dados.exames) ? dados.exames : [])
    .map(function(exame) { return String(exame || '').trim(); })
    .filter(Boolean)
    .slice(0, 40);
  var slotsExames = [];
  for (var i = 0; i < 20; i++) {
    slotsExames.push(reqExamesCelulaGravavel_(sheet, 14 + i, 3));
  }
  for (var j = 0; j < 20; j++) {
    slotsExames.push(reqExamesCelulaGravavel_(sheet, 14 + j, 8));
  }
  slotsExames.forEach(function(slot, index) {
    slot.clearContent();
    slot.setValue(exames[index] || '');
  });

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
  _exportarPDFWebApp(sheet, ss, { requestedByEmail: dados.requestedByEmail || '' });

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
    statusWarning: statusSync.warning,
    statusSync: statusSync
  };
}

function reqExamesCelulaGravavel_(sheet, row, column) {
  var cell = sheet.getRange(row, column);
  var mergedRanges = cell.getMergedRanges();
  if (!mergedRanges.length) return cell;
  return mergedRanges[0].getCell(1, 1);
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
  var pdfBlob = reqExamesExportPdfBlob_(url + exportOptions, nomeArquivo, { sheet: sheet });

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

function reqExamesPdfExportOptions_(sheetId) {
  return 'exportFormat=pdf&format=pdf&size=A4&portrait=true&fitw=true' +
    '&sheetnames=false&printtitle=false&pagenumbers=false' +
    '&gridlines=false&fzr=false&gid=' + sheetId +
    '&r1=0&c1=0&r2=43&c2=10' +
    '&top_margin=0.15&bottom_margin=0.15&left_margin=0.15&right_margin=0.15&scale=4';
}

function reqExamesExportPdfBlob_(url, nomeArquivo, options) {
  options = options || {};
  try {
    return reqExamesFetchPdfBlob_(url, nomeArquivo);
  } catch (primaryError) {
    if (!options.sheet) throw primaryError;
    try {
      return reqExamesExportPdfBlobViaWorkingCopy_(options.sheet, nomeArquivo);
    } catch (fallbackError) {
      try {
        return reqExamesExportPdfBlobViaHtml_(options.sheet, nomeArquivo);
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

function reqExamesExportPdfBlobViaHtml_(sheet, nomeArquivo) {
  var dataAgendamento = sheet.getRange('H10').getValue();
  var exames = sheet.getRange('C14:C33').getDisplayValues()
    .concat(sheet.getRange('H14:H33').getDisplayValues())
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
    exames: exames
  });
  return HtmlService.createHtmlOutput(html)
    .getBlob()
    .getAs(MimeType.PDF)
    .setName(nomeArquivo);
}

function reqExamesPdfHtml_(dados) {
  dados = dados || {};
  function h(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var exames = dados.exames || [];
  var examesHtml = exames.length
    ? exames.map(function(exame) { return '<li>' + h(exame) + '</li>'; }).join('')
    : '<li>Nenhum exame informado.</li>';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>' +
    '@page{size:A4;margin:16mm 14mm}body{font-family:Arial,sans-serif;color:#111827;font-size:12px}' +
    'h1{font-size:18px;margin:0 0 4px;text-align:center}h2{font-size:13px;margin:18px 0 8px;border-bottom:1px solid #d1d5db;padding-bottom:4px}' +
    '.sub{text-align:center;color:#4b5563;margin-bottom:16px}.urgent{color:#b91c1c;font-weight:bold;text-align:center;margin:8px 0}' +
    'table{width:100%;border-collapse:collapse;margin:8px 0}td{border:1px solid #d1d5db;padding:6px;vertical-align:top}.label{width:26%;background:#f3f4f6;font-weight:bold}' +
    'ul{columns:2;margin:8px 0 0 18px;padding:0}li{break-inside:avoid;margin:0 0 5px}.obs{min-height:46px}.foot{margin-top:28px;font-size:11px;color:#4b5563}' +
    '</style></head><body>' +
    '<h1>Requisicao de Exames</h1><div class="sub">IPS/UCS - PDF de contingencia gerado pelo WebApp</div>' +
    (dados.urgente ? '<div class="urgent">URGENTE</div>' : '') +
    '<h2>Dados do participante e agendamento</h2><table>' +
    '<tr><td class="label">Paciente</td><td>' + h(dados.paciente) + '</td><td class="label">Nascimento</td><td>' + h(dados.nascimento) + '</td></tr>' +
    '<tr><td class="label">Protocolo</td><td>' + h(dados.protocolo) + '</td><td class="label">Medico</td><td>' + h(dados.medico) + '</td></tr>' +
    '<tr><td class="label">Local do exame</td><td>' + h(dados.localExame) + '</td><td class="label">Data/Horario</td><td>' + h(dados.dataAgendamento) + ' ' + h(dados.horario) + '</td></tr>' +
    '<tr><td class="label">Endereco</td><td colspan="3">' + h(dados.endereco) + '</td></tr>' +
    '</table><h2>Exames solicitados</h2><ul>' + examesHtml + '</ul>' +
    '<h2>Observacoes</h2><table><tr><td class="obs">' + h(dados.observacoes) + '</td></tr></table>' +
    '<h2>Solicitante</h2><table>' +
    '<tr><td class="label">Nome</td><td>' + h(dados.solicitante) + '</td><td class="label">Formacao/Registro</td><td>' + h(dados.solFormacao) + ' ' + h(dados.solRegistro) + '</td></tr>' +
    '</table><div class="foot">Este PDF foi gerado por contingencia porque o exportador PDF do Google Sheets retornou erro interno HTTP 500.</div>' +
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Requisição de Exames');
  ['I5','E8','E9','E10','E11','H8','H9','H10','J10',
   'C14:C33','H14:H33','B36','H41','H42','H43']
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

function getProjetos() {
  var dados = getCodexSheetDataByName_('Projetos');
  if (!dados.length) return [];
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
      numeroCE:      r[14] || '',
      expedienteCE:  r[15] || '',
      tituloCompleto:r[16] || '',
      dataSiv:       siv.data || ''
    });
  }
  return lista;
}

function getProjetosSivPorProjeto_() {
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
    if (tipo !== 'siv' && visita.indexOf('siv') === -1 && visita.indexOf('iniciacao do centro') === -1) return;
    var status = normText_(r[i.status]);
    if (status.indexOf('cancel') > -1) return;
    if (status.indexOf('realiz') === -1 && status.indexOf('concl') === -1) return;
    var dataObj = parseAgendaDateAny_(r[i.data]);
    if (!dataObj) return;
    var key = normText_(projeto);
    if (!out[key] || dataObj > out[key].dataObj) {
      out[key] = { data: String(r[i.data] || ''), dataObj: dataObj };
    }
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

function isProjetoAtivoEstoque_(status) {
  var s = String(status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return s !== 'concluido' && s !== 'cancelado';
}

function getProjetosAtivosEstoque_() {
  var rows = getCodexSheetDataByName_('Projetos').slice(1);
  if (!rows.length) return [];
  var seen = {}, out = [];
  rows.forEach(function(r) {
    var nome = String(r[1] || r[2] || '').trim();
    if (!nome || !isProjetoAtivoEstoque_(r[13])) return;
    if (!seen[nome]) {
      seen[nome] = 1;
      out.push(nome);
    }
  });
  return out.sort();
}

function salvarDadosProjeto(dados) {
  codexAssertCanWrite_('salvarDadosProjeto', 'Cadastros', dados && dados.id);
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('Projetos');
  if (!aba) throw new Error('Aba "Projetos" não encontrada.');

  if (dados.id) {
    var rows = aba.getDataRange().getValues();
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
function getParticipantes() {
  var rows = getCodexSheetDataByName_('Participantes');
  if (!rows.length) return [];
  var tz  = Session.getScriptTimeZone();
  var ultimaVisitaMap = getUltimasVisitasPorPacienteId_();

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
        ultimaVisita:   getUltimaVisitaFromMap_(r[1], ultimaVisitaMap),
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
  codexAssertCanWrite_('salvarDadosParticipante', 'Cadastros', d && d.id);
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

  var rowStart = [
    d.id || '',
    d.nome,
    parseDate(d.dataNascimento)
  ];
  var rowAfterIdade = [
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
        sh.getRange(i + 1, 1, 1, rowStart.length).setValues([rowStart]);
        sh.getRange(i + 1, 5, 1, rowAfterIdade.length).setValues([rowAfterIdade]);
        if (i + 1 > 2) sh.getRange(i + 1, 4).clearContent();
        clearCodexRuntimeCaches_();
        if (typeof clearTransporteOptionsCache_ === 'function') clearTransporteOptionsCache_();
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
    rowStart[0] = maxId + 1;
    var targetRow = sh.getLastRow() + 1;
    sh.getRange(targetRow, 1, 1, rowStart.length).setValues([rowStart]);
    sh.getRange(targetRow, 5, 1, rowAfterIdade.length).setValues([rowAfterIdade]);
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
  var ss   = SpreadsheetApp.getActiveSpreadsheet();
  var sh   = ss.getSheetByName('Participantes');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sh.deleteRow(i + 1);
      clearCodexRuntimeCaches_();
      if (typeof clearTransporteOptionsCache_ === 'function') clearTransporteOptionsCache_();
      return 'Participante excluído';
    }
  }
  throw new Error('Participante não encontrado (id=' + id + ')');
}

// ════════════════════════════════
//  MONITORES — webapp
// ════════════════════════════════
function getProjetosMonitoria_() {
  var seen = {};
  return getProjetos().map(function(p) {
    return String(p.nomeAbreviado || p.codigo || '').trim();
  }).filter(function(nome) {
    if (!nome || seen[nome]) return false;
    seen[nome] = 1;
    return true;
  }).sort();
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
        return 'Monitor atualizado com sucesso.';
      }
    }
    throw new Error('Monitor não encontrado para edição.');
  }

  rowData[0] = 'MON-' + Date.now();
  sh.appendRow(rowData);
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

function getPrestadores() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🏢 Prestadores');
  if (!sh) return [];
  var tipoCol = ensurePrestadoresTipoServicoColumn_(sh);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(4, tipoCol)).getValues()
    .filter(function(r) { return r[1]; })
    .map(function(r) {
      return { id: r[0] || '', empresa: r[1] || '', endereco: r[2] || '', email: r[3] || '', tipoServico: r[tipoCol - 1] || '' };
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
  if (dados.id && dados.id !== '') {
    var ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(dados.id)) {
        var ln = i + 2;
        sh.getRange(ln, 2).setValue(dados.empresa  || '');
        sh.getRange(ln, 3).setValue(dados.endereco || '');
        sh.getRange(ln, 4).setValue(dados.email    || '');
        sh.getRange(ln, tipoCol).setValue(dados.tipoServico || '');
        return 'Prestador atualizado com sucesso.';
      }
    }
    throw new Error('Prestador não encontrado para edição.');
  }
  var row = ['PREST-' + Date.now(), dados.empresa || '', dados.endereco || '', dados.email || ''];
  while (row.length < tipoCol) row.push('');
  row[tipoCol - 1] = dados.tipoServico || '';
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
        status:        str(p.status)
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
    courierNaoConfirmada: [],
    awbEnviadaNaoEntregue: [],
    requisicaoExamesPendente: [],
    posVisitaPoloTrialPendente: [],
    posVisitaEcrfPendente: [],
    kitsVencendo: [],
    counts: {
      courierNaoAgendada: 0,
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
  var agenda = getAgendaSheet_();
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  var posVisitaCorte = parseAgendaDateAny_('2026-05-23');
  if (posVisitaCorte) posVisitaCorte.setHours(23, 59, 59, 999);
  var i = AGENDA_CFG.idx;
  if (agenda.getLastRow() >= 2) {
    var vals = agenda.getRange(2, 1, agenda.getLastRow() - 1, AGENDA_CFG.lastCol).getDisplayValues();
    var feriados = getAgendaFeriadosPendenciasMap_(vals, i);
    vals.forEach(function(r) {
      var statusEvento = normText_(r[i.status]);
      var tipoEvento = normText_(r[i.tipo]);
      if (statusEvento.indexOf('cancel') > -1) return;
      var concluidoPorStatus = statusEvento.indexOf('concl') > -1;
      var isPosVisita = statusEvento.indexOf('realiz') > -1;
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
      var exigePosVisita = tipoEvento.indexOf('visita') > -1 || agendaTipoContatoTelefonicoServer_(r[i.tipo]);
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
        if (st === 'nao agendado' || st === 'pendente' || (!st && !awb)) {
          out.counts.courierNaoAgendada++;
          out.courierNaoAgendada.push(item);
        } else if (st === 'agendado') {
          out.counts.courierNaoConfirmada++;
          out.courierNaoConfirmada.push(item);
        }
      });
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
  var st = normText_(status);
  return st === 'nao aplicavel' || st === 'nao se aplica' || st === 'n/a' || st === 'na';
}

function agendaCourierStatusEnviadoNaoEntregue_(status) {
  var st = normText_(status);
  return st.indexOf('envi') > -1 && st.indexOf('entreg') === -1;
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
    if (normText_(r[idx.tipo]) !== 'feriado') return;
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
  var lab = normText_(r[i.labCentral]) === 'sim';
  var isVisita = tipo.indexOf('visita') > -1;
  var couriersEvento = agendaDashboardCouriersEvento_(r, i);
  var info = {
    data: data,
    tipo: tipo,
    status: status,
    projeto: projeto,
    medico: medico,
    lab: lab,
    isCancelado: status.indexOf('cancel') > -1,
    isReagendado: status.indexOf('reag') > -1,
    isMonitoria: tipo.indexOf('monitoria') > -1,
    isVisita: isVisita,
    isEventoComTransporte: isVisita || tipo.indexOf('envio de amostra') > -1 || tipo.indexOf('amostra') > -1,
    isRealizada: status.indexOf('realiz') > -1 || status.indexOf('concl') > -1
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
  codexAssertCanWrite_('salvarItemEstoque', 'Estoque', payload && (payload.idItem || payload.id));
  return codexWithDocumentLock_('salvarItemEstoque', function() {
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
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
    return 'Item atualizado com sucesso!';
  } else {
    // Novo — mantém padrão numérico "0001" igual aos existentes
    var novoId = gerarProximoIdItemEstoque_(sheet);
    sheet.appendRow([
      novoId, payload.projeto, payload.descricao, payload.tipo,
      payload.localizacao, estoqueMin,
      payload.observacoes, payload.laboratorio, payload.status
    ]);
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
  CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
  return 'Recebimento registrado com sucesso!';
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
  var rows = shEstoque.getDataRange().getValues();
  var rowEstoque = -1;

  var requestedRow = Number(payload.estoqueRow || 0);
  if (requestedRow >= 2 && requestedRow <= rows.length) {
    var requestedData = rows[requestedRow - 1] || [];
    var requestedMatches = String(requestedData[0] || '').trim() === idItem &&
      (!validadeKey || estoqueValidadeKey_(requestedData[4], tz) === validadeKey) &&
      (!locKey || estoqueLocalKey_(requestedData[5]) === locKey);
    if (requestedMatches) rowEstoque = requestedRow;
  }

  for (var i = 1; rowEstoque < 0 && i < rows.length; i++) {
    var r = rows[i];
    if (String(r[0] || '').trim() !== idItem) continue;
    var sameValidade = !validadeKey || estoqueValidadeKey_(r[4], tz) === validadeKey;
    var sameLocal = !locKey || estoqueLocalKey_(r[5]) === locKey;
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
  CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = null;
  return 'Movimentação registrada com sucesso.';
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
        origem: 'Lista de descarte ' + id,
        observacao: obs || 'Descarte efetivado'
      });
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
  var seen = {};
  return getCodexSheetDataByName_('Projetos').slice(1).map(function(r) {
    return String(r[1] || r[2] || r[0] || '').trim();
  }).filter(function(nome) {
    if (!nome || seen[nome]) return false;
    seen[nome] = 1;
    return true;
  }).sort();
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
// AGENDA WEBAPP V1 - estrutura atual com 36 colunas
// Mantem a documentacao de transporte separada.
// ============================================================================
var AGENDA_CFG = {
  abaNomes: ['\uD83D\uDCC5 Agenda', 'Agenda'],
  lastCol: 50,
  col: {
    id: 1, data: 2, hora: 3, tipo: 4, status: 5, participante: 6,
    nasc: 7, idParticipante: 8, projeto: 9, braco: 10, visita: 11,
    medico: 12, procedimentos: 13, servTerc: 14, obs: 15,
    labCentral: 16, controle: 17, kit: 18, reqStatus: 45, monitorName: 46,
    poloTrial: 47, ecrf: 48, salaMonitoria: 49, carroRequerido: 50
  },
  idx: {
    id: 0, data: 1, hora: 2, tipo: 3, status: 4, participante: 5,
    nasc: 6, idParticipante: 7, projeto: 8, braco: 9, visita: 10,
    medico: 11, procedimentos: 12, servTerc: 13, obs: 14,
    labCentral: 15, controle: 16, kit: 17,
    c1: { nome: 18, temp: 19, status: 20, awb: 21, material: 22, destino: 36, matBio: 40 },
    c2: { nome: 23, temp: 24, status: 25, awb: 26, material: 27, destino: 37, matBio: 41 },
    c3: { nome: 28, temp: 29, status: 30, awb: 31, material: 32, destino: 38, matBio: 42 },
    cb: { nome: 33, status: 34, material: 35, destino: 39, matBio: 43 },
    reqStatus: 44, monitorName: 45, poloTrial: 46, ecrf: 47, salaMonitoria: 48, carroRequerido: 49
  }
};

var CFG = typeof CFG !== 'undefined' ? CFG : {
  abaNome: '\uD83D\uDCC5 Agenda',
  lastCol: 50,
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
  ensureAgendaDestinoLabColumns_(sh);
  return sh;
}

function ensureAgendaDestinoLabColumns_(sh) {
  var schemaCacheKey = 'AgendaSchemaEnsured:v3';
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
    { col: AGENDA_CFG.col.carroRequerido, label: 'Carro_Requerido' }
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

function getAgendaCourierRows_() {
  if (CODEX_AGENDA_COURIER_ROWS_CACHE_) return CODEX_AGENDA_COURIER_ROWS_CACHE_;
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
      conteudoDeclaracao: String(r[10] || '').trim(),
      email: headerValue(r, ['E-mail', 'Email', 'Destinatarios', 'Destinatários', 'E-mails', 'Emails']),
      emailAmbiente: headerValue(r, ['E-mail ambiente', 'Email ambiente', 'Destinatarios ambiente', 'Destinatários ambiente']),
      emailCongelado: headerValue(r, ['E-mail congelado', 'Email congelado', 'Destinatarios congelado', 'Destinatários congelado']),
      monitorConfirmacao: headerValue(r, ['Monitorar confirmação', 'Monitorar confirmacao', 'Monitor confirmacao', 'Monitorar e-mail confirmação']),
      emailConfirmacao: headerValue(r, ['E-mail confirmação', 'Email confirmação', 'E-mail confirmacao', 'Email confirmacao', 'Remetente confirmação', 'Remetente confirmacao']),
      textoConfirmacao: headerValue(r, ['Texto confirmação', 'Texto confirmacao', 'Chave confirmação', 'Chave confirmacao']),
      statusConfirmacao: headerValue(r, ['Status confirmação', 'Status confirmacao', 'Status ao confirmar'])
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

function getAgendaCourierConfigs_() {
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
  } catch(e) {}
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
    ['N\u00E3o Agendado', 'Pendente', 'Agendado', 'Confirmado', 'Coletado', 'Enviado', 'Entregue', 'Cancelado']
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
    Logger.log('getAgendaLabDestinos_: nao foi possivel carregar LabCentral: ' + e.message);
    return [];
  }
}

function getAgendaKitsEstoque_() {
  try {
    if (CODEX_AGENDA_KITS_ESTOQUE_CACHE_) return CODEX_AGENDA_KITS_ESTOQUE_CACHE_;
    var itens = getEstoque() || [];
    var seen = {};
    CODEX_AGENDA_KITS_ESTOQUE_CACHE_ = itens.filter(function(it) {
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
    return CODEX_AGENDA_KITS_ESTOQUE_CACHE_;
  } catch(e) {
    return [];
  }
}

function getDadosFormularioAgenda() {
  var cacheKey = 'AgendaFormData:v6:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var cached = codexCacheGet_(cacheKey);
  if (cached) return cached;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function listaColB(nomesAba) {
    var sh = getSheetByPossibleNames_(ss, nomesAba);
    var lastRow = sh ? sh.getLastRow() : 0;
    if (!sh || lastRow < 2) return [];
    return sh.getRange(2, 2, lastRow - 1, 1).getValues()
      .map(function(r) { return String(r[0] || '').trim(); })
      .filter(Boolean)
      .sort();
  }
  var hoje = new Date();
  var hojeIso = hoje.getFullYear() + '-' +
    ('0' + (hoje.getMonth() + 1)).slice(-2) + '-' +
    ('0' + hoje.getDate()).slice(-2);
  var result = {
    participantes: listaColB(['Participantes']),
    medicos: listaColB(['\uD83E\uDE7A M\u00E9dicos', 'Medicos', 'M\u00E9dicos']),
    prestadores: listaColB(['\uD83C\uDFE2 Prestadores', 'Prestadores']),
    projetos: listaColB(['Projetos']),
    laboratorios: getAgendaLaboratorios_(),
    couriers: getAgendaCouriers_(),
    courierConfig: getAgendaCourierConfigs_(),
    temperaturas: getAgendaTemperaturas_(),
    statusCourier: getAgendaCourierStatuses_(),
    laboratoriosDestino: getAgendaLabDestinos_(),
    kitsColeta: getAgendaKitsEstoque_(),
    tiposEvento: getAgendaEventTypes_(),
    salasMonitoria: getAgendaMonitoriaSalas_(),
    status: getAgendaStatuses_(),
    procedimentoChips: getAgendaProcedimentoChips_(),
    monitores: getMonitores(),
    emailLabAtivo: agendaEmailEnabled_(),
    hojeIso: hojeIso
  };
  codexCachePut_(cacheKey, result);
  return result;
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
      if (!paciente || categoria !== 'visita') return;
      if (status !== 'realizado' && status !== 'concluido') return;
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

function agendaDateIsBeforeToday_(valor) {
  var d = parseAgendaDateAny_(valor);
  if (!d || isNaN(d.getTime())) return false;
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime() < hoje.getTime();
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
      if (normText_(r[idx.tipo]) !== 'visita') return;
      var status = normText_(r[idx.status]);
      if (status !== 'realizado' && status !== 'concluido') return;
      var dt = agendaDateFromValue_(r[idx.data]);
      if (!dt || dt.getTime() > hoje.getTime()) return;
      if (!out[participante] || dt.getTime() > out[participante].dataObj.getTime()) {
        out[participante] = {
          dataObj: dt,
          data: formatarDataSafe(r[idx.data]),
          visita: String(r[idx.visita] || '---')
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
  codexAssertCanWrite_('salvarNovoEventoCompleto', 'Agenda', dados && dados.id);
  return codexWithDocumentLock_('salvarNovoEventoCompleto', function() {
  dados = dados || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var isMonitoria = normText_(dados.tipo) === 'monitoria';
  if (!isMonitoria && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  var d = _parseDateHora(dados.data, dados.hora);
  if (isMonitoria && !String(dados.salaMonitoria || '').trim()) {
    return { erro: 'Informe o local (sala) da monitoria.' };
  }
  var datasMonitoria = isMonitoria ? agendaDatasPeriodoMonitoria_(dados.data, dados.dataFim) : [d];
  var lastRow = agenda.getLastRow();
  if (lastRow > 1) {
    var vals = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues();
    for (var i = 0; i < vals.length; i++) {
      var ld = vals[i][AGENDA_CFG.idx.data];
      var lt = normText_(vals[i][AGENDA_CFG.idx.tipo]);
      if (lt !== 'feriado') continue;
      var dl = parseAgendaDateAny_(ld);
      if (dl) {
        dl.setHours(0, 0, 0, 0);
        for (var j = 0; j < datasMonitoria.length; j++) {
          var dCmp = new Date(datasMonitoria[j]);
          dCmp.setHours(0, 0, 0, 0);
          if (dl.getTime() === dCmp.getTime()) {
            return { feriado: true, dataFmt: formatarDataSafe(datasMonitoria[j]) };
          }
        }
      }
    }
  }
  if (isMonitoria) {
    var ids = [];
    for (var k = 0; k < datasMonitoria.length; k++) {
      var dadosDia = agendaCloneDados_(dados);
      var resDia = _gravarLinhaEvento(agenda, agendaDateWithHora_(datasMonitoria[k], dados.hora), dadosDia, ss);
      if (resDia && resDia.id) ids.push(resDia.id);
    }
    return { ok: true, id: ids[0] || '', ids: ids, count: ids.length, emailLabAtivo: agendaEmailEnabled_() };
  }
  return _gravarLinhaEvento(agenda, d, dados, ss);
  });
}

function salvarNovoEventoComFeriado(dados) {
  codexAssertCanWrite_('salvarNovoEventoComFeriado', 'Agenda', dados && dados.id);
  return codexWithDocumentLock_('salvarNovoEventoComFeriado', function() {
  dados = dados || {};
  var agenda = getAgendaSheet_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (normText_(dados.tipo) !== 'monitoria' && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  if (normText_(dados.tipo) === 'monitoria') {
    if (!String(dados.salaMonitoria || '').trim()) {
      return { erro: 'Informe o local (sala) da monitoria.' };
    }
    var datas = agendaDatasPeriodoMonitoria_(dados.data, dados.dataFim);
    var ids = [];
    datas.forEach(function(dataDia) {
      var resDia = _gravarLinhaEvento(agenda, agendaDateWithHora_(dataDia, dados.hora), agendaCloneDados_(dados), ss);
      if (resDia && resDia.id) ids.push(resDia.id);
    });
    return { ok: true, id: ids[0] || '', ids: ids, count: ids.length, emailLabAtivo: agendaEmailEnabled_() };
  }
  return _gravarLinhaEvento(agenda, _parseDateHora(dados.data, dados.hora), dados, ss);
  });
}

function agendaDatasPeriodoMonitoria_(dataInicio, dataFim) {
  var ini = parseAgendaDateAny_(dataInicio);
  var fim = parseAgendaDateAny_(dataFim || dataInicio);
  if (!ini || isNaN(ini.getTime())) throw new Error('Informe a Data de Inicio da monitoria.');
  if (!fim || isNaN(fim.getTime())) throw new Error('Informe a Data Final da monitoria.');
  ini.setHours(0, 0, 0, 0);
  fim.setHours(0, 0, 0, 0);
  if (fim.getTime() < ini.getTime()) throw new Error('Data Final deve ser igual ou posterior a Data de Inicio.');
  var out = [];
  var d = new Date(ini);
  while (d.getTime() <= fim.getTime()) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 1);
    if (out.length > 370) throw new Error('Periodo de monitoria muito longo. Revise as datas.');
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

function agendaMonitoriaRowsDoPeriodo_(agenda, linha, rowRef) {
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return [];
  var idx = AGENDA_CFG.idx;
  var ref = rowRef || agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var candidatos = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol).getValues()
    .map(function(row, i) {
      var data = parseAgendaDateAny_(row[idx.data]);
      if (!data) return null;
      data.setHours(0, 0, 0, 0);
      if (normText_(row[idx.tipo]) !== 'monitoria') return null;
      if (normText_(row[idx.projeto]) !== normText_(ref[idx.projeto])) return null;
      if (normText_(row[idx.monitorName]) !== normText_(ref[idx.monitorName])) return null;
      if (normText_(row[idx.salaMonitoria]) !== normText_(ref[idx.salaMonitoria])) return null;
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

function agendaDatasConsecutivas_(a, b) {
  if (!a || !b) return false;
  var da = new Date(a);
  var db = new Date(b);
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000) === 1;
}

function agendaWriteMonitoriaRow_(agenda, linha, dataDia, dados, rowAnterior) {
  var d = agendaDateWithHora_(dataDia, dados.hora);
  var status = String(dados.status || 'Agendado').trim();
  agenda.getRange(linha, AGENDA_CFG.col.data, 1, AGENDA_CFG.col.kit - AGENDA_CFG.col.data + 1).setValues([[
    formatAgendaDatePt_(d),
    formatAgendaHora_(d),
    String(dados.tipo || 'Monitoria').trim(),
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
    dados.monitorName || '',
    rowAnterior[AGENDA_CFG.idx.poloTrial] || '',
    rowAnterior[AGENDA_CFG.idx.ecrf] || '',
    dados.salaMonitoria || '',
    false
  ]]);
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c1, {});
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c2, {});
  agendaSetCourierLinha_(agenda, linha, AGENDA_CFG.idx.c3, {});
  agendaSetBackupLinha_(agenda, linha, {});
  agendaSetTransporteExtraLinha_(agenda, linha, {});
  if (normText_(status) === 'cancelado') aplicarLogicaCancelamento(agenda, linha, status);
}

function agendaAtualizarPeriodoMonitoria_(agenda, ss, linha, rowAnterior, dados) {
  var datas = agendaDatasPeriodoMonitoria_(dados.data, dados.dataFim);
  var atuais = agendaMonitoriaRowsDoPeriodo_(agenda, linha, rowAnterior);
  var ids = [];
  var atualizar = Math.min(atuais.length, datas.length);
  for (var i = 0; i < atualizar; i++) {
    var item = atuais[i];
    var antes = item.row;
    agendaWriteMonitoriaRow_(agenda, item.rowIndex, datas[i], dados, antes);
    var depois = agenda.getRange(item.rowIndex, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
    var idAtual = String(depois[AGENDA_CFG.idx.id] || antes[AGENDA_CFG.idx.id] || '').trim();
    if (idAtual) ids.push(idAtual);
    codexWriteAuditChanges_('Agenda', 'atualizarAgendaEventoCompleto', idAtual || dados.id, agendaAuditChangesFromRows_(antes, depois), 'Alteração de período de monitoria');
  }
  var remover = atuais.slice(datas.length).sort(function(a, b) { return b.rowIndex - a.rowIndex; });
  remover.forEach(function(item) {
    var idRemovido = String(item.row[AGENDA_CFG.idx.id] || '').trim();
    agenda.deleteRow(item.rowIndex);
    codexWriteAuditChanges_('Agenda', 'atualizarAgendaEventoCompleto', idRemovido || dados.id, [{
      field: 'Monitoria',
      oldValue: formatarDataSafe(item.row[AGENDA_CFG.idx.data]),
      newValue: ''
    }], 'Data removida do período de monitoria');
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
  return { ok: true, id: ids[0] || dados.id, ids: ids, count: datas.length, atualizado: true, emailLabAtivo: agendaEmailEnabled_() };
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
    { field: 'Backup - Status', idx: i.cb.status },
    { field: 'Backup - Material', idx: i.cb.material },
    { field: 'Backup - Destino', idx: i.cb.destino },
    { field: 'Status Requisição', idx: i.reqStatus },
    { field: 'Monitor', idx: i.monitorName },
    { field: 'Sala da monitoria', idx: i.salaMonitoria },
    { field: 'Carro requerido', idx: i.carroRequerido },
    { field: 'Polo Trial concluído', idx: i.poloTrial },
    { field: 'eCRF concluída', idx: i.ecrf }
  ];
}

function agendaPostVisitValue_(value, previous) {
  if (value === true || String(value || '').trim() === 'Sim') return previous || new Date();
  if (String(value || '').trim()) return value;
  return '';
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
  var linha = encontrarLinhaPorId(agenda, dados.id);
  if (!linha) throw new Error('Agendamento nao encontrado para edicao.');
  var rowAnterior = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var versaoAtual = agendaRecordVersionFromRow_(rowAnterior);
  var versaoEsperada = String(dados._recordVersion || '').trim();
  if (versaoEsperada && versaoEsperada !== versaoAtual) {
    return {
      conflito: true,
      erro: 'Este agendamento foi alterado por outro usuario desde que voce abriu. Atualize a Agenda antes de salvar para evitar sobrescrever informacoes.',
      id: dados.id,
      currentVersion: versaoAtual
    };
  }
  var tipo = String(dados.tipo || '').trim();
  var status = String(dados.status || 'Agendado').trim();
  var labCentral = String(dados.labCentral || '').trim();
  var isMonitoria = normText_(tipo) === 'monitoria';
  if (!isMonitoria && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  var d = _parseDateHora(dados.data, dados.hora);
  dados.carroRequerido = normText_(tipo).indexOf('visita') > -1 && agendaBooleanValue_(dados.carroRequerido);
  if (isMonitoria) {
    if (!String(dados.projeto || '').trim()) {
      return { erro: 'Informe o projeto/protocolo da monitoria.' };
    }
    if (!String(dados.salaMonitoria || '').trim()) {
      return { erro: 'Informe o local (sala) da monitoria.' };
    }
    dados.participante = '';
    dados.visita = '';
    dados.medico = '';
    dados.procedimentos = '';
    dados.servTerc = '';
    dados.statusRequisicao = '';
    labCentral = 'Não aplicável';
    return agendaAtualizarPeriodoMonitoria_(agenda, ss, linha, rowAnterior, dados);
  } else {
    dados.monitorName = '';
    dados.salaMonitoria = '';
  }
  if (!String(dados.servTerc || '').trim()) dados.statusRequisicao = '';
  var tiposNaoLab = ['monitoria', 'siv', 'close-out', 'reuniao', 'feriado', 'auditoria', 'exame de imagem', 'contato telefonico'];
  if (tiposNaoLab.indexOf(normText_(tipo)) > -1) labCentral = 'N\u00E3o aplic\u00E1vel';
  if (agendaTipoExigeLabCentralServer_(tipo) && !labCentral) {
    return { erro: 'Informe se haverá Laboratório Central.' };
  }
  if (normText_(labCentral) === 'sim' && !String(dados.visita || '').trim()) {
    return { erro: 'Para "Laboratorio Central = Sim", informe a Visita.' };
  }
  var dataNovaPassada = agendaDateIsBeforeToday_(d);
  var dataAnteriorPassada = agendaDateIsBeforeToday_(rowAnterior[AGENDA_CFG.idx.data]);
  var marcandoLabPassado = dataNovaPassada && normText_(labCentral) === 'sim' &&
    (normText_(rowAnterior[AGENDA_CFG.idx.labCentral]) !== 'sim' || !dataAnteriorPassada);
  var marcandoReqPassada = dataNovaPassada && String(dados.servTerc || '').trim() &&
    (!String(rowAnterior[AGENDA_CFG.idx.servTerc] || '').trim() || !dataAnteriorPassada);
  if (marcandoLabPassado) {
    return { erro: 'Lab Central = Sim nao pode ser marcado para uma data anterior a hoje.' };
  }
  if (marcandoReqPassada) {
    return { erro: 'Requisicoes de Exame nao podem ser marcadas para uma data anterior a hoje.' };
  }
  var dataAnterior = agenda.getRange(linha, AGENDA_CFG.col.data).getValue();
  var horaNova = formatAgendaHora_(d);
  var deveOrdenarAgenda =
    datasAgendaDiferentes_(dataAnterior, d) ||
    normText_(formatarHoraSafe_(rowAnterior[AGENDA_CFG.idx.hora])) !== normText_(horaNova);
  var deveVerificarNotificacoes =
    datasAgendaDiferentes_(dataAnterior, d) ||
    normText_(rowAnterior[AGENDA_CFG.idx.labCentral]) !== normText_(labCentral) ||
    normText_(rowAnterior[AGENDA_CFG.idx.status]) !== normText_(status);

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
    dados.statusRequisicao || '',
    dados.monitorName || '',
    agendaPostVisitValue_(dados.poloTrialConcluido, rowAnterior[AGENDA_CFG.idx.poloTrial]),
    agendaPostVisitValue_(dados.ecrfConcluida, rowAnterior[AGENDA_CFG.idx.ecrf]),
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
  agendaSetBackupLinha_(agenda, linha, dados.backup);
  agendaSetTransporteExtraLinha_(agenda, linha, dados);
  if (normText_(status) === 'cancelado') aplicarLogicaCancelamento(agenda, linha, status);
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
  return { ok: true, id: dados.id, atualizado: true, carroRequerido: carroSalvo, recordVersion: agendaRecordVersionFromRow_(rowAtual) };
  });
}

function cancelarAgendaEvento(id) {
  codexAssertCanWrite_('cancelarAgendaEvento', 'Agenda', id);
  return codexWithDocumentLock_('cancelarAgendaEvento', function() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agenda = getAgendaSheet_();
  var linha = encontrarLinhaPorId(agenda, id);
  if (!linha) throw new Error('Agendamento nao encontrado para cancelamento.');
  var rowAnterior = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  agenda.getRange(linha, AGENDA_CFG.col.status).setValue('Cancelado');
  aplicarLogicaCancelamento(agenda, linha, 'Cancelado');
  verificarNotificacoes(
    { source: ss, range: agenda.getRange(linha, AGENDA_CFG.col.labCentral), user: Session.getActiveUser() },
    id,
    null,
    agenda,
    linha
  );
  var rowAtual = agenda.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  codexWriteAuditChanges_('Agenda', 'cancelarAgendaEvento', id, agendaAuditChangesFromRows_(rowAnterior, rowAtual), 'Cancelamento de agendamento');
  SpreadsheetApp.flush();
  return { ok: true, id: id, status: 'Cancelado' };
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
    return { ok: true, id: agendaId, statusRequisicao: '', semPrestador: true, recordVersion: agendaRecordVersionFromRow_(rowSemPrestador) };
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
  return { ok: true, id: agendaId, statusRequisicao: valor, recordVersion: agendaRecordVersionFromRow_(rowAtual) };
  });
}

function marcarAgendaPassadaComoRealizada() {
  return codexWithDocumentLock_('marcarAgendaPassadaComoRealizada', function() {
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
  });
}

function concluirPendenciasPoloTrialEcrfAntigas(dataCorteIso, dryRun) {
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
    var statusEvento = normText_(r[i.status]);
    if (statusEvento.indexOf('realiz') < 0) return;

    var tipoEvento = normText_(r[i.tipo]);
    var exigePosVisita = tipoEvento.indexOf('visita') > -1 || agendaTipoContatoTelefonicoServer_(r[i.tipo]);
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
  return concluirPendenciasPoloTrialEcrfAntigas('2026-05-23', false);
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
  var isMonitoria = normText_(tipo) === 'monitoria';
  if (!isMonitoria && !String(dados.hora || '').trim()) {
    return { erro: 'Informe o horario do agendamento.' };
  }
  dados.carroRequerido = normText_(tipo).indexOf('visita') > -1 && agendaBooleanValue_(dados.carroRequerido);
  if (isMonitoria) {
    if (!String(dados.projeto || '').trim()) {
      return { erro: 'Informe o projeto/protocolo da monitoria.' };
    }
    if (!String(dados.salaMonitoria || '').trim()) {
      return { erro: 'Informe o local (sala) da monitoria.' };
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
  var tiposNaoLab = ['monitoria', 'siv', 'close-out', 'reuniao', 'feriado', 'auditoria', 'exame de imagem', 'contato telefonico'];
  if (tiposNaoLab.indexOf(normText_(tipo)) > -1) labCentral = 'N\u00E3o aplic\u00E1vel';
  if (agendaTipoExigeLabCentralServer_(tipo) && !labCentral) {
    return { erro: 'Informe se haverá Laboratório Central.' };
  }
  if (normText_(labCentral) === 'sim' && !String(dados.visita || '').trim()) {
    return { erro: 'Para "Laboratorio Central = Sim", informe a Visita.' };
  }
  if (agendaDateIsBeforeToday_(d) && normText_(labCentral) === 'sim') {
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
  agenda.getRange(linha, idx.nome + 1, 1, 5).setValues([[
    courierNome,
    courier.temperatura || courier.temp || '',
    courier.status || '',
    '',
    courier.material || ''
  ]]);
  agendaSetAwbValue_(agenda.getRange(linha, idx.awb + 1), courier.awb || '', courierNome);
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

function agendaTrackingUrl_(awb, courier) {
  awb = String(awb || '').trim();
  if (agendaIsPinexCourier_(courier)) {
    return 'https://pinextracking.com.br/#tracking-code';
  }
  if (/^620X[0-9]{8}$/i.test(awb)) {
    return 'https://online.marken.com/FastTrack/Shipment?inputTrack=' + encodeURIComponent(awb);
  }
  if (/^[A-Z][0-9]{7}$/i.test(awb) || /^PK2[A-Z0-9]{9}$/i.test(awb)) {
    return 'https://tracking.ocasa.com/Tracking/index?client=&airbillnumber=' + encodeURIComponent(awb) + '&i=18&url=ocasa';
  }
  if (/^[0-9]{10}$/.test(awb)) {
    return 'https://www.dhl.com/br-en/home/tracking.html?tracking-id=' + encodeURIComponent(awb) + '&submit=1';
  }
  return '';
}

function agendaIsPinexCourier_(courier) {
  return normText_(courier) === 'pinex';
}

var DHL_TRACKING_API_URL_ = 'https://api-eu.dhl.com/track/shipments';
var DHL_TRACKING_API_KEY_PROPERTY_ = 'DHL_TRACKING_API_KEY';
var DHL_TRACKING_MAX_CONSULTAS_POR_EXECUCAO_ = 45;

function configurarDhlTrackingApiKey(apiKey) {
  apiKey = String(apiKey || '').trim();
  if (!apiKey) throw new Error('Informe a API Key da DHL.');
  PropertiesService.getScriptProperties().setProperty(DHL_TRACKING_API_KEY_PROPERTY_, apiKey);
  return { ok: true, property: DHL_TRACKING_API_KEY_PROPERTY_ };
}

function getDhlTrackingApiKey_() {
  return String(PropertiesService.getScriptProperties().getProperty(DHL_TRACKING_API_KEY_PROPERTY_) || '').trim();
}

function monitorarEntregasDhlAgendadas(options) {
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

  return codexWithDocumentLock_('monitorarEntregasDhlAgendadas', function() {
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
    var entregues = [];
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
      if (!resposta.entregue) {
        continue;
      }
      (pendentes[awb] || []).forEach(function(item) {
        var statusRange = agenda.getRange(item.row, item.statusCol);
        var statusAnterior = statusRange.getValue();
        if (normText_(statusAnterior) === 'entregue') return;
        statusRange.setValue('Entregue');
        entregues.push({
          agendaId: item.agendaId,
          row: item.row,
          slot: item.slot,
          awb: item.awb,
          courier: item.courier,
          statusDhl: resposta.status || '',
          timestampEntrega: resposta.timestampEntrega || ''
        });
        codexWriteAuditChanges_('Agenda', 'monitorarEntregasDhlAgendadas', item.agendaId || item.awb, [{
          field: item.slot + ' - Status',
          oldValue: statusAnterior,
          newValue: 'Entregue'
        }], 'Entrega automática DHL | AWB ' + item.awb +
          (resposta.status ? ' | Status DHL ' + resposta.status : '') +
          (resposta.timestampEntrega ? ' | Entrega ' + resposta.timestampEntrega : ''));
      });
    }

    SpreadsheetApp.flush();
    return {
      ok: true,
      verificados: maxConsultas,
      pendentes: awbs.length,
      entregues: entregues.length,
      itens: entregues,
      erros: erros
    };
  });
}

function diagnosticarMonitorEntregasDhl() {
  var agenda = getAgendaSheet_();
  var lastRow = agenda.getLastRow();
  var result = {
    apiKeyConfigurada: !!getDhlTrackingApiKey_(),
    pendentes: [],
    mensagem: ''
  };
  if (lastRow < 2) {
    Logger.log(JSON.stringify(result));
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
  Logger.log(JSON.stringify(result));
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
      if (['entregue', 'cancelado', 'nao agendado'].indexOf(status) >= 0) return;
      var awb = String(display[i][slot.cfg.awb] || row[slot.cfg.awb] || '').trim();
      var awbKey = normalizarAwbCourier_(awb);
      if (!/^[0-9]{10}$/.test(awbKey)) return;
      if (!out[awbKey]) out[awbKey] = [];
      out[awbKey].push({
        agendaId: String(row[idx.id] || '').trim(),
        row: i + 2,
        slot: slot.label,
        statusCol: slot.cfg.status + 1,
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

function monitorarConfirmacoesCourierAgendadas() {
  var regras = getCourierConfirmationRules_();
  var ruleKeys = Object.keys(regras);
  if (!ruleKeys.length) return { ok: true, verificados: 0, confirmados: 0, mensagem: 'Nenhuma regra ativa.' };
  return codexWithDocumentLock_('monitorarConfirmacoesCourierAgendadas', function() {

  var agenda = getAgendaSheet_();
  var lastRow = agenda.getLastRow();
  if (lastRow < 2) return { ok: true, verificados: 0, confirmados: 0 };

  var range = agenda.getRange(2, 1, lastRow - 1, AGENDA_CFG.lastCol);
  var values = range.getValues();
  var display = range.getDisplayValues();
  var pendentes = getAgendaCourierAwbsPendentesConfirmacao_(values, display, regras);
  var pendentesRef = getAgendaCourierRefsPendentesConfirmacao_(values, display, regras);
  var awbs = Object.keys(pendentes);
  var refs = Object.keys(pendentesRef);
  if (!awbs.length && !refs.length) return { ok: true, verificados: 0, confirmados: 0, mensagem: 'Nenhum courier pendente de confirmação.' };

  var confirmados = [];
  ruleKeys.forEach(function(ruleKey) {
    var regra = regras[ruleKey];
    var encontrados = buscarConfirmacoesCourierNoGmail_(regra, pendentes);
    encontrados.forEach(function(match) {
      var itens = pendentes[match.awbKey] || [];
      itens.forEach(function(item) {
        if (item.ruleKey !== ruleKey || item.confirmado) return;
        var statusAnterior = agenda.getRange(item.row, item.statusCol).getValue();
        if (normText_(statusAnterior) !== 'agendado') return;
        var novoStatus = regra.statusConfirmacao || 'Confirmado';
        agenda.getRange(item.row, item.statusCol).setValue(novoStatus);
        item.confirmado = true;
        confirmados.push({
          agendaId: item.agendaId,
          row: item.row,
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
    var encontradosRef = buscarConfirmacoesCourierPorReferenciaNoGmail_(regra, pendentesRef);
    encontradosRef.forEach(function(match) {
      var itensRef = pendentesRef[match.refKey] || [];
      itensRef.forEach(function(item) {
        if (item.ruleKey !== ruleKey || item.confirmado) return;
        var statusAnteriorRef = agenda.getRange(item.row, item.statusCol).getValue();
        var statusNorm = normText_(statusAnteriorRef);
        if (['agendado', 'pendente', 'nao agendado', ''].indexOf(statusNorm) === -1) return;
        var awbExtraida = escolherAwbConfirmacaoCourier_(regra, item, match.awbs);
        if (!awbExtraida) return;
        var awbAnterior = agenda.getRange(item.row, item.awbCol).getDisplayValue() || agenda.getRange(item.row, item.awbCol).getValue();
        var novoStatusRef = regra.statusConfirmacao || 'Confirmado';
        agendaSetAwbValue_(agenda.getRange(item.row, item.awbCol), awbExtraida, item.courier);
        agenda.getRange(item.row, item.statusCol).setValue(novoStatusRef);
        item.confirmado = true;
        confirmados.push({
          agendaId: item.agendaId,
          row: item.row,
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
          oldValue: statusAnteriorRef,
          newValue: novoStatusRef
        }], 'Confirmação automática por e-mail ' + item.courier + ' | Ref. ' + item.refInterna + ' | AWB ' + awbExtraida + ' | Gmail message ' + match.messageId);
      });
    });
  });

  SpreadsheetApp.flush();
  return { ok: true, verificados: awbs.length + refs.length, confirmados: confirmados.length, itens: confirmados };
  });
}

function diagnosticarMonitorConfirmacoesCourier() {
  var regras = getCourierConfirmationRules_();
  var agenda = getAgendaSheet_();
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
    Logger.log(JSON.stringify(result));
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
  Logger.log(JSON.stringify(result));
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
      var status = normText_(row[slot.cfg.status]);
      if (status !== 'agendado') return;
      var awb = String(display[i][slot.cfg.awb] || row[slot.cfg.awb] || '').trim();
      var awbKey = normalizarAwbCourier_(awb);
      if (!awbKey) return;
      if (!out[awbKey]) out[awbKey] = [];
      out[awbKey].push({
        ruleKey: ruleKey,
        agendaId: String(row[idx.id] || '').trim(),
        row: i + 2,
        slot: slot.label,
        statusCol: slot.cfg.status + 1,
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
      var status = normText_(row[slot.cfg.status]);
      if (['agendado', 'pendente', 'nao agendado', ''].indexOf(status) === -1) return;
      var awb = String(display[i][slot.cfg.awb] || row[slot.cfg.awb] || '').trim();
      if (normalizarAwbCourier_(awb)) return;
      var item = {
        ruleKey: ruleKey,
        agendaId: agendaId,
        refInterna: refInterna,
        row: i + 2,
        slot: slot.label,
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
      textosConfirmacao: isDhl
        ? [texto, 'Agendamento realizado para', 'Coleta programada para']
        : [texto],
      statusConfirmacao: String(c.statusConfirmacao || defaults.statusConfirmacao || '').trim() || 'Confirmado',
      extrairAwbPorReferencia: isDhl,
      diasBusca: 7
    };
  });
  return out;
}

function textosConfirmacaoCourier_(regra) {
  regra = regra || {};
  var textos = Array.isArray(regra.textosConfirmacao)
    ? regra.textosConfirmacao.slice()
    : [regra.textoConfirmacao];
  var out = [];
  textos.forEach(function(texto) {
    String(texto || '').split(/\r?\n|\|\|/).forEach(function(parte) {
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
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'monitorarConfirmacoesCourierAgendadas') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('monitorarConfirmacoesCourierAgendadas')
    .timeBased()
    .everyMinutes(15)
    .create();
  return { ok: true, intervaloMinutos: 15 };
}

function removerGatilhoMonitorConfirmacaoCouriers() {
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'monitorarConfirmacoesCourierAgendadas') {
      ScriptApp.deleteTrigger(t);
      removidos++;
    }
  });
  return { ok: true, removidos: removidos };
}

function instalarGatilhoMonitorEntregasDhl() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'monitorarEntregasDhlAgendadas') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('monitorarEntregasDhlAgendadas')
    .timeBased()
    .everyHours(4)
    .create();
  return { ok: true, intervaloHoras: 4 };
}

function removerGatilhoMonitorEntregasDhl() {
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === 'monitorarEntregasDhlAgendadas') {
      ScriptApp.deleteTrigger(t);
      removidos++;
    }
  });
  return { ok: true, removidos: removidos };
}

function agendaSetBackupLinha_(agenda, linha, backup) {
  backup = backup || {};
  var idx = AGENDA_CFG.idx.cb;
  agenda.getRange(linha, idx.nome + 1, 1, 3).setValues([[
    backup.nome || '',
    backup.status || '',
    backup.material || ''
  ]]);
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

function getAgendaEventos(limite) {
  var sh = getAgendaSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var max = Math.min(Number(limite || 80), lastRow - 1);
  var start = Math.max(2, lastRow - max + 1);
  var vals = sh.getRange(start, 1, lastRow - start + 1, AGENDA_CFG.lastCol).getValues();
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
}

function agendaRowToObject_(r, rowIndex) {
  var i = AGENDA_CFG.idx;
  return {
    rowIndex: rowIndex,
    id: String(r[i.id] || ''),
    recordVersion: agendaRecordVersionFromRow_(r),
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

function verificarNotificacoes(e, idAtivo, dataAnterior, sheetAtiva, linhaAtiva) {
  // Nas rotinas da WebApp, a aba e a linha ja foram localizadas e gravadas.
  // Reutiliza-las evita reabrir a Agenda, executar migracoes e varrer todos os IDs
  // novamente dentro da mesma operacao, o que pode provocar falhas transitorias do
  // servico Planilhas quando o WebApp executa como USER_ACCESSING.
  var sheet = sheetAtiva || getAgendaSheet_();
  var linha = Number(linhaAtiva || 0) || (idAtivo ? encontrarLinhaPorId(sheet, idAtivo) : e.range.getRow());
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
  var webAppUrl = ScriptApp.getService().getUrl();
  var assunto = '[AGENDAMENTO] ' + (dados[i.projeto] || '') + ' - Visita com Envio ao Lab Central';
  var body = gerarHtmlCabecalhoEmail_('Agendamento - Envio de Amostras ao Lab Central', '#2c3e50') +
    '<p>Foi realizado um novo agendamento de visita clínica que requer envio ao laboratório:</p>' +
    gerarTabelaAgendaEmail_(dados, true) +
    '<p>As informações de courier e transporte serão atualizadas na Agenda assim que estiverem disponíveis.</p>' +
    '<p><a href="' + webAppUrl + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Responsável', usuario) + '</div>';
  MailApp.sendEmail({ to: gerarListaDestinatarios(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function enviarEmailCancelamento(sheet, linha, usuario) {
  var dados = sheet.getRange(linha, 1, 1, AGENDA_CFG.lastCol).getValues()[0];
  var i = AGENDA_CFG.idx;
  var webAppUrl = ScriptApp.getService().getUrl();
  var assunto = '[CANCELAMENTO] ' + (dados[i.projeto] || '') + ' - Visita com Envio ao Lab Central';
  var body = gerarHtmlCabecalhoEmail_('CANCELAMENTO DE VISITA / ENVIO', '#c0392b') +
    '<p>A seguinte visita foi <b>REMOVIDA</b> do fluxo de envio ao Lab Central:</p>' +
    gerarTabelaAgendaEmail_(dados, true, 'Data Original') + gerarHtmlCouriers(dados) +
    '<p><a href="' + webAppUrl + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Cancelado por', usuario) + '</div>';
  MailApp.sendEmail({ to: gerarListaDestinatarios(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
}

function enviarEmailReagendamento(sheet, linha, usuario, dataAnteriorRaw) {
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
    gerarTabelaAgendaEmail_(dados, true) + gerarHtmlCouriers(dados) +
    '<p><a href="' + webAppUrl + '">Abrir Agenda</a></p>' +
    gerarRodapeEmailAgenda_('Alterado por', usuario) + '</div>';
  MailApp.sendEmail({ to: gerarListaDestinatarios(usuario), subject: assunto, htmlBody: body, name: 'Agendamento de Visitas' });
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

  var vistos = {};
  destinatarios = destinatarios.filter(function(email) {
    var key = String(email || '').trim().toLowerCase();
    if (!key || vistos[key]) return false;
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
  obs = normText_(obs);
  return (obs.indexOf('requi') > -1 || /\breq\b/.test(obs)) &&
    (obs.indexOf('ok') > -1 || obs.indexOf('enviad') > -1);
}

function agendaRequisicaoEnviada_(status, obs) {
  return normText_(status).indexOf('enviad') > -1 || agendaObsIndicaRequisicaoOk_(obs);
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
  if (CODEX_LAB_CENTRAL_CACHE_) return CODEX_LAB_CENTRAL_CACHE_;
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

function courierConfirmationDefaults_(nome) {
  var n = normText_(nome);
  if (n.indexOf('marken') >= 0) {
    return {
      monitorConfirmacao: 'Sim',
      emailConfirmacao: 'expobrasil@marken.com',
      textoConfirmacao: 'Confirmamos o agendamento da retirada conforme informações abaixo.',
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

function salvarCourier(dados) {
  codexAssertCanWrite_('salvarCourier', 'Sistema', dados && dados.id);
  dados = dados || {};
  var nome = String(dados.nome || dados.courier || '').trim();
  if (!nome) throw new Error('Informe o nome da courier.');
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
    String(dados.conteudoDeclaracao || '').trim(),
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
        limparCacheCourier_();
        return 'Courier atualizada com sucesso.';
      }
    }
    throw new Error('Courier não encontrada para edição.');
  }
  row[0] = gerarNovoIdCourier_(sh);
  sh.appendRow(row);
  limparCacheCourier_();
  return 'Courier cadastrada com sucesso.';
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

