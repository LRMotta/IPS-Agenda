/**
 * Diagnostico administrativo de implantacao.
 *
 * Este arquivo compartilha o namespace global do Apps Script com WebApp.gs.
 * As verificacoes devem permanecer read-only, exceto a RPC administrativa
 * limparCodexCachesDiagnostico, que exige confirmacao no cliente e autorizacao.
 */
function getCodexDeploymentDiagnostics(clientContext) {
  var access = codexAssertAdmin_();
  clientContext = clientContext || {};
  var diagnosticStartedAt = Date.now();
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
    auth: {},
    identity: {},
    spreadsheet: {
      ok: false,
      name: '',
      idSuffix: '',
      url: '',
      timeZone: '',
      error: ''
    },
    cache: {},
    transport: {},
    triggers: {},
    mail: {},
    auditRecent: {},
    permissions: {},
    smoke: {},
    operational: {},
    configValidation: {},
    profileHealth: {},
    automationRuns: {},
    timings: [],
    script: {
      timeZone: '',
      expectedExecuteAs: CODEX_APP_EXPECTED_EXECUTE_AS_
    }
  };
  out.auth = codexTimedDiagnostic_(out.timings, 'auth', 'OAuth', codexGetUserOAuthStatus_);
  out.identity = codexTimedDiagnostic_(out.timings, 'identity', 'Identidade', codexGetIdentityDiagnostics_);
  out.cache = codexTimedDiagnostic_(out.timings, 'cache', 'Caches', codexGetCacheDiagnostics_);
  out.transport = codexTimedDiagnostic_(out.timings, 'transport', 'Transporte', codexGetTransportDiagnostics_);
  out.triggers = codexTimedDiagnostic_(out.timings, 'triggers', 'Gatilhos', codexGetTriggersDiagnostics_);
  out.automationRuns = codexTimedDiagnostic_(out.timings, 'automation-runs', 'Historico das automacoes', codexGetAutomationRunDiagnostics_);
  out.mail = codexTimedDiagnostic_(out.timings, 'mail', 'Cota de e-mail', codexGetMailDiagnostics_);
  out.permissions = codexTimedDiagnostic_(out.timings, 'permissions', 'Permissoes criticas', codexGetCriticalPermissionsDiagnostics_);
  out.operational = codexTimedDiagnostic_(out.timings, 'operational', 'Dados e integridade', function() {
    return codexGetOperationalHealthDiagnostics_(clientContext);
  });
  out.configValidation = codexTimedDiagnostic_(out.timings, 'config-validation', 'Config_App essencial', codexBuildConfigAppDiagnostics_);
  out.profileHealth = codexTimedDiagnostic_(out.timings, 'profiles', 'Perfis de acesso', codexGetProfileHealthDiagnostics_);
  out.smoke = codexTimedDiagnostic_(out.timings, 'smoke', 'Smoke checks', function() {
    return codexGetSmokeDiagnostics_({ profileHealth: out.profileHealth });
  });
  out.auditRecent = codexTimedDiagnostic_(out.timings, 'audit', 'Auditoria recente', function() {
    return codexGetRecentAuditIssuesDiagnostics_(out.operational && out.operational.activity);
  });
  try {
    var tz = Session.getScriptTimeZone() || 'America/Sao_Paulo';
    out.script.timeZone = tz;
    out.checkedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  } catch (e0) {
    out.checkedAt = new Date().toISOString();
  }
  try {
    out.webAppUrl = codexTimedDiagnostic_(out.timings, 'webapp-url', 'URL do WebApp', function() {
      return ScriptApp.getService().getUrl();
    });
  } catch (e1) {
    out.webAppUrlError = e1.message || String(e1);
  }
  try {
    var ss = null;
    codexTimedDiagnostic_(out.timings, 'spreadsheet', 'Planilha principal', function() {
      ss = getCodexSpreadsheet_();
      return ss;
    });
    var id = String(ss.getId() || '');
    out.spreadsheet.ok = true;
    out.spreadsheet.name = ss.getName();
    out.spreadsheet.idSuffix = id ? id.slice(-8) : '';
    out.spreadsheet.url = ss.getUrl();
    out.spreadsheet.timeZone = ss.getSpreadsheetTimeZone();
  } catch (e2) {
    out.spreadsheet.error = e2.message || String(e2);
  }
  codexAppendMediumPriorityChecks_(out);
  out.totalDurationMs = Math.max(0, Date.now() - diagnosticStartedAt);
  return out;
}

function codexTimedDiagnostic_(timings, key, label, callback) {
  var startedAt = Date.now();
  var ok = true;
  try {
    var result = callback();
    if (result && result.ok === false) ok = false;
    return result;
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    var durationMs = Math.max(0, Date.now() - startedAt);
    (timings || []).push({
      key: key,
      label: label,
      durationMs: durationMs,
      ok: ok,
      slow: durationMs >= 1500
    });
  }
}

function codexAppendOperationalCheck_(operational, label, ok, detail, severity) {
  operational = operational || {};
  operational.overall = operational.overall || { status: 'Saudavel', ok: true, errors: 0, warnings: 0, checks: [] };
  var overall = operational.overall;
  overall.checks = overall.checks || [];
  severity = severity || (ok ? 'ok' : 'warning');
  if (!ok && severity === 'error') overall.errors = Number(overall.errors || 0) + 1;
  if (!ok && severity !== 'error') overall.warnings = Number(overall.warnings || 0) + 1;
  overall.checks.push({ label: label, ok: !!ok, detail: detail || '', severity: severity });
  overall.ok = Number(overall.errors || 0) === 0 && Number(overall.warnings || 0) === 0;
  overall.status = Number(overall.errors || 0) > 0 ? 'Erro' : (Number(overall.warnings || 0) > 0 ? 'Atencao' : 'Saudavel');
}

function codexAppendMediumPriorityChecks_(data) {
  var operational = data.operational || {};
  var config = data.configValidation || {};
  var missingConfig = (config.items || []).filter(function(item) { return !item.ok; });
  var configOk = config.ok !== false && missingConfig.length === 0 && Number(config.duplicateValues || 0) === 0;
  var configDetail = config.error || (missingConfig.length
    ? 'Sem valores ativos: ' + missingConfig.map(function(item) { return item.label; }).join(', ')
    : (Number(config.duplicateValues || 0) > 0
      ? Number(config.duplicateValues || 0) + ' valor(es) duplicado(s).'
      : (Number(config.usingDefaults || 0) > 0
        ? 'Configuracoes essenciais validas; ' + Number(config.usingDefaults || 0) + ' grupo(s) usam os valores padrao do aplicativo.'
        : 'Todas as configuracoes essenciais possuem valor ativo.')));
  codexAppendOperationalCheck_(operational, 'Config_App essencial', configOk, configDetail, 'warning');

  var triggers = data.triggers || {};
  if (triggers.error) codexAppendOperationalCheck_(operational, 'Leitura dos gatilhos', false, triggers.error, 'warning');
  (triggers.expected || []).forEach(function(item) {
    codexAppendOperationalCheck_(operational, 'Gatilho: ' + item.label, item.count === 1,
      item.count === 0 ? 'Ausente.' : (item.count > 1 ? item.count + ' instalacoes encontradas; mantenha apenas uma.' : 'Instalado uma vez.'), 'warning');
  });

  var profiles = data.profileHealth || {};
  if (profiles.error) codexAppendOperationalCheck_(operational, 'Leitura dos perfis', false, profiles.error, 'warning');
  codexAppendOperationalCheck_(operational, 'Perfis: e-mails duplicados', Number(profiles.duplicateEmails || 0) === 0,
    Number(profiles.duplicateEmails || 0) + ' e-mail(s) duplicado(s)' + (profiles.duplicateExamples && profiles.duplicateExamples.length ? ' | ' + profiles.duplicateExamples.join('; ') : ''), 'error');
  codexAppendOperationalCheck_(operational, 'Perfis: nomes obrigatorios', Number(profiles.missingNames || 0) === 0,
    Number(profiles.missingNames || 0) + ' usuario(s) sem nome', 'warning');
  codexAppendOperationalCheck_(operational, 'Perfis: e-mails obrigatorios', Number(profiles.missingEmails || 0) === 0,
    Number(profiles.missingEmails || 0) + ' usuario(s) sem e-mail', 'error');
  codexAppendOperationalCheck_(operational, 'Perfis: aniversarios validos', Number(profiles.invalidBirthdays || 0) === 0,
    Number(profiles.invalidBirthdays || 0) + ' aniversario(s) invalido(s)', 'warning');

  (data.automationRuns && data.automationRuns.items || []).forEach(function(item) {
    if (item.status === 'Falha' || item.status === 'Possivel interrupcao') {
      codexAppendOperationalCheck_(operational, 'Automacao: ' + item.label, false,
        [item.status, item.finishedAt || item.startedAt, item.message].filter(Boolean).join(' | '), 'warning');
    }
  });
  if (data.automationRuns && data.automationRuns.error) {
    codexAppendOperationalCheck_(operational, 'Historico das automacoes', false, data.automationRuns.error, 'warning');
  }
  data.operational = operational;
}

function codexGetOperationalHealthDiagnostics_(clientContext) {
  clientContext = clientContext || {};
  var publishedVersion = String(CODEX_APP_VERSION_ || '');
  var loadedVersion = String(clientContext.loadedVersion || '');
  var out = {
    overall: { status: 'Saudavel', ok: true, errors: 0, warnings: 0, checks: [] },
    versionSync: {
      loadedVersion: loadedVersion,
      publishedVersion: publishedVersion,
      matches: !!loadedVersion && loadedVersion === publishedVersion,
      watcherActive: !!clientContext.watcherActive,
      noticeVisible: !!clientContext.noticeVisible,
      status: ''
    },
    structure: { items: [], error: '' },
    activity: { items: [], error: '' },
    integrity: { items: [], totals: { duplicateIds: 0, missingIds: 0, orphanLinks: 0 }, error: '' }
  };
  out.versionSync.status = !loadedVersion
    ? 'Versao carregada nao informada'
    : (out.versionSync.matches ? 'Sincronizada' : 'Atualizacao pendente');

  try {
    var ss = getCodexSpreadsheet_();
    var specs = codexDiagnosticSheetSpecs_();
    var tables = {};
    specs.forEach(function(spec) {
      var table = codexReadDiagnosticTable_(ss, spec);
      tables[spec.key] = table;
      out.structure.items.push({
        key: spec.key,
        label: spec.label,
        sheetName: table.sheetName,
        present: table.present,
        ok: table.present && !table.missingHeaders.length,
        warning: table.present && !table.missingHeaders.length && !!table.headerNotes.length,
        rows: table.rows.length,
        missingHeaders: table.missingHeaders,
        headerNotes: table.headerNotes,
        status: !table.present ? 'Aba ausente' : (table.missingHeaders.length ? 'Colunas obrigatorias ausentes' : (table.headerNotes.length ? 'OK com rotulos personalizados' : 'OK'))
      });
    });
    out.integrity = codexBuildIntegrityDiagnostics_(tables);
    out.activity = codexBuildActivityDiagnostics_(ss);
  } catch (e) {
    out.structure.error = e.message || String(e);
  }

  function addCheck(label, ok, detail, severity) {
    severity = severity || (ok ? 'ok' : 'warning');
    if (!ok && severity === 'error') out.overall.errors++;
    if (!ok && severity !== 'error') out.overall.warnings++;
    out.overall.checks.push({ label: label, ok: !!ok, detail: detail || '', severity: severity });
  }
  addCheck('Versao cliente x servidor', out.versionSync.matches,
    out.versionSync.status + (loadedVersion ? ' | cliente ' + loadedVersion + ' | servidor ' + publishedVersion : ''), 'warning');
  addCheck('Monitor de nova versao', out.versionSync.watcherActive,
    out.versionSync.watcherActive ? 'Monitor ativo no navegador.' : 'Monitor nao confirmado nesta sessao.', 'warning');
  (out.structure.items || []).forEach(function(item) {
    addCheck('Estrutura: ' + item.label, item.ok,
      item.status + (item.missingHeaders.length ? ' | ' + item.missingHeaders.join(', ') : ''), 'error');
    if (item.warning) addCheck('Rotulos: ' + item.label, false, item.headerNotes.join(' | '), 'warning');
  });
  (out.integrity.items || []).forEach(function(item) {
    addCheck('Integridade: ' + item.label, item.ok, item.detail,
      item.duplicateIds > 0 || item.missingIds > 0 ? 'error' : 'warning');
  });
  if (out.structure.error) addCheck('Leitura estrutural', false, out.structure.error, 'error');
  if (out.integrity.error) addCheck('Leitura de integridade', false, out.integrity.error, 'error');
  if (out.activity.error) addCheck('Leitura de atividade', false, out.activity.error, 'warning');
  out.overall.ok = out.overall.errors === 0 && out.overall.warnings === 0;
  out.overall.status = out.overall.errors > 0 ? 'Erro' : (out.overall.warnings > 0 ? 'Atencao' : 'Saudavel');
  return out;
}

function codexDiagnosticSheetSpecs_() {
  return [
    { key: 'agenda', label: 'Agenda', names: AGENDA_CFG.abaNomes, required: [
      { index: 0, label: 'ID', aliases: ['id', 'id agenda', 'agenda id'] },
      { index: 1, label: 'Data', aliases: ['data'] },
      { index: 3, label: 'Tipo', aliases: ['tipo', 'tipo de evento'] },
      { index: 4, label: 'Status', aliases: ['status'] },
      { index: 5, label: 'Participante', aliases: ['participante', 'nome participante'] },
      { index: 7, label: 'ID Participante', aliases: ['id participante', 'identificacao participante', 'numero identificacao', 'numero de identificacao', 'n identificacao'] },
      { index: 8, label: 'Projeto', aliases: ['projeto', 'protocolo'] }
    ] },
    { key: 'projetos', label: 'Projetos', names: ['Projetos'], required: [
      { index: 0, label: 'ID', aliases: ['id', 'id projeto'] },
      { index: 1, label: 'Nome abreviado', aliases: ['nome abreviado', 'projeto', 'nome'] },
      { index: 2, label: 'Codigo', aliases: ['codigo', 'codigo projeto', 'codigo do projeto', 'protocolo', 'protocolo do estudo'] },
      { index: 13, label: 'Status', aliases: ['status'] }
    ] },
    { key: 'participantes', label: 'Participantes', names: ['Participantes'], required: [
      { index: 0, label: 'ID cadastro', aliases: ['id', 'id cadastro', 'id cadastro participante', 'id interno', 'codigo cadastro', 'id participante'] },
      { index: 1, label: 'Nome', aliases: ['nome', 'participante'] },
      { index: 4, label: 'ID participante', aliases: ['id participante', 'identificacao', 'numero identificacao', 'numero de identificacao', 'n identificacao'] },
      { index: 5, label: 'Projeto', aliases: ['projeto', 'protocolo'] },
      { index: 8, label: 'Status', aliases: ['status'] }
    ] },
    { key: 'itens', label: 'Estoque - Cadastro de itens', names: ['Itens', 'Cadastro de Itens', 'Cadastro de Itens de Estoque'], required: [
      { index: 0, label: 'ID item', aliases: ['id item', 'id'] },
      { index: 1, label: 'Projeto', aliases: ['projeto'] },
      { index: 2, label: 'Descricao', aliases: ['descricao', 'descricao do item', 'item'] },
      { index: 3, label: 'Detalhes Visita / Complemento', aliases: ['detalhes visita complemento', 'detalhes visita', 'complemento'] },
      { index: 4, label: 'Tipo', aliases: ['tipo', 'tipo de item'] },
      { index: 9, label: 'Status', aliases: ['status', 'ativo'] }
    ] },
    { key: 'estoque', label: 'Estoque - Lotes', names: ['Estoque'], required: [
      { index: 0, label: 'ID item', aliases: ['id item', 'id'] },
      { index: 2, label: 'Descricao', aliases: ['descricao', 'descricao do item', 'item'] },
      { index: 4, label: 'Validade', aliases: ['validade', 'data validade'] },
      { index: 6, label: 'Quantidade', aliases: ['quantidade', 'qtde', 'saldo'] },
      { index: 8, label: 'Status', aliases: ['status'] }
    ] },
    { key: 'users', label: 'Usuarios', names: [CODEX_ACL_SHEET_NAME_ || 'Users'], required: [
      { index: 0, label: 'Email', aliases: ['email', 'e-mail', 'email usuario', 'e-mail usuario', 'email autorizado'] },
      { index: 1, label: 'Nome', aliases: ['nome'] },
      { index: 2, label: 'Perfil', aliases: ['perfil', 'perfil de acesso', 'nivel de acesso', 'funcao', 'role'] },
      { index: 3, label: 'Ativo', aliases: ['ativo', 'active'] },
      { index: 4, label: 'Aniversario', aliases: ['aniversario mm-dd', 'aniversario', 'birthday'] }
    ] },
    { key: 'config', label: 'Config_App', names: ['Config_App'], required: [
      { index: 0, label: 'Grupo', aliases: ['grupo'] },
      { index: 1, label: 'Chave', aliases: ['chave'] },
      { index: 2, label: 'Valor', aliases: ['valor'] },
      { index: 3, label: 'Ativo', aliases: ['ativo'] }
    ] }
  ];
}

function codexReadDiagnosticTable_(ss, spec) {
  var sh = null;
  for (var n = 0; n < (spec.names || []).length; n++) {
    sh = ss.getSheetByName(spec.names[n]);
    if (sh) break;
  }
  if (!sh) return { present: false, sheetName: '', headers: [], rows: [], missingHeaders: (spec.required || []).map(function(x) { return x.label; }), headerNotes: [] };
  var lastRow = sh.getLastRow();
  var lastColumn = sh.getLastColumn();
  var headers = lastColumn ? sh.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  var dataColumnCount = (spec.required || []).reduce(function(max, req) {
    return Math.max(max, Number(req.index || 0) + 1);
  }, 1);
  dataColumnCount = Math.min(Math.max(1, dataColumnCount), Math.max(1, lastColumn));
  var rows = lastRow > 1 && lastColumn
    ? sh.getRange(2, 1, lastRow - 1, dataColumnCount).getValues()
    : [];
  var missing = [];
  var headerNotes = [];
  (spec.required || []).forEach(function(req) {
    var actual = String(headers[req.index] || '').trim();
    if (codexDiagnosticHeaderMatches_(actual, req.aliases || [])) return;
    var foundAt = -1;
    for (var i = 0; i < headers.length; i++) {
      if (codexDiagnosticHeaderMatches_(headers[i], req.aliases || [])) { foundAt = i; break; }
    }
    if (foundAt >= 0) {
      missing.push(req.label + ' (esperada na coluna ' + (req.index + 1) + ')');
      headerNotes.push(req.label + ' localizada na coluna ' + (foundAt + 1) + ', mas a aplicacao le a coluna ' + (req.index + 1));
      return;
    }
    if (actual) {
      headerNotes.push(req.label + ' usa o rotulo "' + actual + '" na coluna ' + (req.index + 1));
      return;
    }
    missing.push(req.label + ' (coluna ' + (req.index + 1) + ')');
  });
  return {
    present: true,
    sheetName: sh.getName(),
    headers: headers,
    rows: rows.map(function(row, index) {
      row.__codexDiagnosticRow = index + 2;
      return row;
    }).filter(function(row) { return row.some(function(value) { return value !== '' && value !== null && value !== undefined; }); }),
    missingHeaders: missing,
    headerNotes: headerNotes
  };
}

function codexDiagnosticHeaderMatches_(value, aliases) {
  var actual = codexDiagnosticKey_(value);
  var compact = actual.replace(/\s+/g, '');
  if (!actual) return false;
  return (aliases || []).some(function(alias) {
    var expected = codexDiagnosticKey_(alias);
    var expectedCompact = expected.replace(/\s+/g, '');
    if (!expected) return false;
    if (actual === expected || compact === expectedCompact) return true;
    return expectedCompact.length >= 5 && (compact.indexOf(expectedCompact) >= 0 || expectedCompact.indexOf(compact) >= 0);
  });
}

function codexDiagnosticKey_(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function codexDiagnosticRowNumber_(row, offset) {
  return Number(row && row.__codexDiagnosticRow) || offset + 2;
}

function codexDiagnosticIdStats_(rows, index) {
  var seen = {};
  var duplicates = {};
  var missing = 0;
  var examples = [];
  (rows || []).forEach(function(row, offset) {
    var rowNumber = codexDiagnosticRowNumber_(row, offset);
    var hasData = row.some(function(value) { return value !== '' && value !== null && value !== undefined; });
    if (!hasData) return;
    var id = String(row[index] || '').trim();
    if (!id) {
      missing++;
      if (examples.length < 5) examples.push('linha ' + rowNumber + ': ID ausente');
      return;
    }
    var key = codexDiagnosticKey_(id);
    if (seen[key]) {
      duplicates[key] = true;
      if (examples.length < 5) examples.push('ID ' + id + ': linhas ' + seen[key] + ' e ' + rowNumber);
    } else {
      seen[key] = rowNumber;
    }
  });
  return { duplicateIds: Object.keys(duplicates).length, missingIds: missing, examples: examples };
}

function codexBuildIntegrityDiagnostics_(tables) {
  var out = { items: [], totals: { duplicateIds: 0, missingIds: 0, orphanLinks: 0 }, error: '' };
  try {
    ['agenda', 'projetos', 'participantes', 'itens'].forEach(function(key) {
      var table = tables[key] || { present: false, rows: [] };
      if (!table.present) return;
      var stats = codexDiagnosticIdStats_(table.rows, 0);
      out.totals.duplicateIds += stats.duplicateIds;
      out.totals.missingIds += stats.missingIds;
      var label = key === 'itens' ? 'Cadastro de itens' : (key === 'agenda' ? 'Agenda' : key.charAt(0).toUpperCase() + key.slice(1));
      out.items.push({
        key: key + '-ids', label: label + ' - IDs',
        ok: stats.duplicateIds === 0 && stats.missingIds === 0,
        duplicateIds: stats.duplicateIds, missingIds: stats.missingIds, orphanLinks: 0,
        detail: stats.duplicateIds + ' duplicado(s) | ' + stats.missingIds + ' ausente(s)' + (stats.examples.length ? ' | ' + stats.examples.join('; ') : '')
      });
    });
    var projectKeys = {};
    ((tables.projetos || {}).rows || []).forEach(function(row, offset) {
      var projectId = codexDiagnosticKey_(row[0]) || 'linha-' + codexDiagnosticRowNumber_(row, offset);
      [row[0], row[1], row[2]].forEach(function(value) { var key = codexDiagnosticKey_(value); if (key) projectKeys[key] = projectId; });
    });
    function resolveProject(value) { return projectKeys[codexDiagnosticKey_(value)] || ''; }
    var participantKeys = {};
    ((tables.participantes || {}).rows || []).forEach(function(row) {
      var idKey = codexDiagnosticKey_(row[4]);
      var projectKey = resolveProject(row[5]);
      if (idKey) participantKeys[idKey + '|' + projectKey] = true;
    });
    var participantProjectOrphans = 0;
    var participantProjectExamples = [];
    ((tables.participantes || {}).rows || []).forEach(function(row, offset) {
      var rawProject = String(row[5] || '').trim();
      if (rawProject && !resolveProject(rawProject)) {
        participantProjectOrphans++;
        if (participantProjectExamples.length < 5) participantProjectExamples.push('linha ' + codexDiagnosticRowNumber_(row, offset) + ': ' + rawProject);
      }
    });
    var agendaProjectOrphans = 0;
    var agendaParticipantOrphans = 0;
    var agendaProjectExamples = [];
    var agendaParticipantExamples = [];
    ((tables.agenda || {}).rows || []).forEach(function(row, offset) {
      var rawProject = String(row[8] || '').trim();
      var projectKey = resolveProject(rawProject);
      var participantIdKey = codexDiagnosticKey_(row[7]);
      if (rawProject && !projectKey) {
        agendaProjectOrphans++;
        if (agendaProjectExamples.length < 5) agendaProjectExamples.push('linha ' + codexDiagnosticRowNumber_(row, offset) + ': ' + rawProject);
      }
      if (participantIdKey && projectKey && !participantKeys[participantIdKey + '|' + projectKey]) {
        agendaParticipantOrphans++;
        if (agendaParticipantExamples.length < 5) agendaParticipantExamples.push('linha ' + codexDiagnosticRowNumber_(row, offset) + ': ' + String(row[7] || ''));
      }
    });
    var itemKeys = {};
    ((tables.itens || {}).rows || []).forEach(function(row) { var key = codexDiagnosticKey_(row[0]); if (key) itemKeys[key] = true; });
    var stockItemOrphans = 0;
    var stockItemExamples = [];
    var stockMissingIds = 0;
    var hasItemCatalog = Object.keys(itemKeys).length > 0;
    ((tables.estoque || {}).rows || []).forEach(function(row, offset) {
      var rawId = String(row[0] || '').trim();
      var idKey = codexDiagnosticKey_(rawId);
      if (!idKey) { stockMissingIds++; return; }
      if (hasItemCatalog && !itemKeys[idKey]) {
        stockItemOrphans++;
        if (stockItemExamples.length < 5) stockItemExamples.push('linha ' + codexDiagnosticRowNumber_(row, offset) + ': ' + rawId);
      }
    });
    if ((tables.estoque || {}).present) {
      out.totals.missingIds += stockMissingIds;
      out.items.push({ key: 'estoque-referencias', label: 'Estoque - referencias de item', ok: stockMissingIds === 0,
        duplicateIds: 0, missingIds: stockMissingIds, orphanLinks: 0,
        detail: stockMissingIds + ' referencia(s) sem ID; repeticoes por lote/validade sao permitidas' });
    }
    [
      { key: 'participante-projeto', label: 'Participantes x Projetos', count: participantProjectOrphans, examples: participantProjectExamples },
      { key: 'agenda-projeto', label: 'Agenda x Projetos', count: agendaProjectOrphans, examples: agendaProjectExamples },
      { key: 'agenda-participante', label: 'Agenda x Participantes', count: agendaParticipantOrphans, examples: agendaParticipantExamples },
      { key: 'estoque-item', label: 'Estoque x Cadastro de itens', count: stockItemOrphans, examples: stockItemExamples }
    ].forEach(function(item) {
      out.totals.orphanLinks += item.count;
      out.items.push({ key: item.key, label: item.label, ok: item.count === 0, duplicateIds: 0, missingIds: 0,
        orphanLinks: item.count, detail: item.count + ' vinculo(s) orfao(s)' + (item.examples.length ? ' | ' + item.examples.join('; ') : '') });
    });
  } catch (e) {
    out.error = e.message || String(e);
  }
  return out;
}

function codexBuildActivityDiagnostics_(ss) {
  var out = { items: [], recentAuditIssues: [], auditScannedRows: 0, error: '' };
  try {
    var sh = ss.getSheetByName('Audit_Log');
    if (!sh || sh.getLastRow() < 2) return out;
    var count = Math.min(500, sh.getLastRow() - 1);
    var startRow = sh.getLastRow() - count + 1;
    var rows = sh.getRange(startRow, 1, count, 6).getValues().reverse();
    var auditSample = rows.slice(0, 60);
    out.auditScannedRows = auditSample.length;
    out.recentAuditIssues = auditSample.filter(function(row) {
      var action = normText_(row[2]);
      return action.indexOf('acesso') > -1 || action.indexOf('negado') > -1 || action.indexOf('erro') > -1 || action.indexOf('falha') > -1;
    }).slice(0, 8).map(function(row) {
      return {
        id: String(row[0] || ''),
        email: String(row[1] || ''),
        action: String(row[2] || ''),
        timestamp: codexDiagnosticFormatDate_(row[3]),
        module: String(row[4] || ''),
        recordId: String(row[5] || '')
      };
    });
    var groups = [
      { key: 'agenda', label: 'Agenda', aliases: ['agenda'] },
      { key: 'cadastros', label: 'Projetos e Participantes', aliases: ['cadastros'] },
      { key: 'estoque', label: 'Estoque', aliases: ['estoque'] },
      { key: 'transporte', label: 'Transporte', aliases: ['transporte'] },
      { key: 'sistema', label: 'Sistema e configuracoes', aliases: ['sistema'] }
    ];
    groups.forEach(function(group) {
      var found = rows.find(function(row) {
        var moduleKey = codexDiagnosticKey_(row[4]);
        return group.aliases.some(function(alias) { return moduleKey.indexOf(codexDiagnosticKey_(alias)) >= 0; });
      });
      out.items.push({ key: group.key, label: group.label, found: !!found,
        timestamp: found ? codexDiagnosticFormatDate_(found[3]) : '',
        action: found ? String(found[2] || '') : '', user: found ? String(found[1] || '') : '' });
    });
  } catch (e) {
    out.error = e.message || String(e);
  }
  return out;
}

function codexDiagnosticFormatDate_(value) {
  if (!value) return '';
  try {
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
    }
  } catch (e) {}
  return String(value || '');
}

function codexGetCacheDiagnostics_() {
  var out = {
    configRowsCachePresent: false,
    agendaBootstrapCachePresent: false,
    transporteOptionsCachePresent: false,
    items: [],
    lastConfigInvalidationAt: '',
    lastConfigInvalidationBy: '',
    lastConfigInvalidationSource: '',
    configRowsApprox: '',
    error: ''
  };
  try {
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
    var keys = [
      { key: 'ConfigAppRows:v2', label: 'Config_App' },
      { key: 'AgendaFormData:v6:' + today, label: 'Agenda bootstrap hoje' },
      { key: 'TRANSPORTE_OPTIONS_BASE_V6', label: 'Transporte options', reader: 'transporte' },
      { key: 'TRANSPORTE_PARTICIPANTES_OPTIONS_V1', label: 'Transporte participantes', reader: 'transporte' }
    ];
    out.items = keys.map(function(item) {
      return codexCacheItemDiagnostics_(item.key, item.label, item.reader);
    });
    out.configRowsCachePresent = !!out.items[0].present;
    out.agendaBootstrapCachePresent = !!out.items[1].present;
    out.transporteOptionsCachePresent = !!out.items[2].present;
    out.transporteOptionsCacheStatus = out.items[2].statusLabel || (out.items[2].present ? 'Disponivel' : 'Nao carregado');
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

function codexCacheMetaKey_(key) {
  return 'CODEX_CACHE_META_' + Utilities.base64EncodeWebSafe(String(key || '')).replace(/=+$/g, '');
}

function codexCacheItemDiagnostics_(key, label, reader) {
  var meta = {};
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(codexCacheMetaKey_(key));
    meta = raw ? JSON.parse(raw) : {};
  } catch (e) {
    meta = { error: e.message || String(e) };
  }
  var present = codexCacheItemPresent_(key, reader);
  var now = new Date().getTime();
  var expiresAtMs = Number(meta.expiresAtMs || 0);
  var expiredMeta = !!(expiresAtMs && expiresAtMs < now);
  var optional = reader === 'transporte';
  var statusLabel = present
    ? (expiredMeta ? 'Disponivel; metadados antigos' : 'Disponivel')
    : (optional ? 'Nao carregado nesta sessao' : 'Ausente');
  return {
    key: key,
    label: label || key,
    present: present,
    optional: optional,
    statusLabel: statusLabel,
    createdAt: String(meta.createdAt || ''),
    expiresAt: String(meta.expiresAt || ''),
    ageMinutes: meta.createdAtMs ? Math.max(0, Math.round((now - Number(meta.createdAtMs)) / 60000)) : '',
    expiresInMinutes: expiresAtMs && !expiredMeta ? Math.round((expiresAtMs - now) / 60000) : '',
    metaStatus: statusLabel,
    error: String(meta.error || '')
  };
}

function codexCacheItemPresent_(key, reader) {
  if (reader === 'transporte' && typeof transporteReadCachedJson_ === 'function') {
    return !!transporteReadCachedJson_(key);
  }
  return !!codexCacheGet_(key);
}

function codexGetTransportDiagnostics_() {
  var out = { status: '', url: '', responseCode: '', mode: '', message: '', error: '' };
  try {
    var acoplado = typeof salvarTransporte === 'function' &&
      typeof gerarPdfTransporte === 'function' &&
      typeof getTransporteBootstrapFromAgenda === 'function';
    if (acoplado) {
      out.status = 'OK (acoplado)';
      out.mode = 'acoplado';
      out.message = 'Transporte roda dentro do CODEX; URL externa nao e necessaria.';
      return out;
    }
    if (typeof getTransporteWebAppUrlCodex_ !== 'function') {
      out.status = 'Indisponivel';
      out.error = 'Leitor getTransporteWebAppUrlCodex_ nao encontrado.';
      return out;
    }
    out.url = String(getTransporteWebAppUrlCodex_() || '').trim();
    if (!out.url) {
      out.status = 'URL ausente';
      out.message = 'Necessaria apenas quando o Transporte roda como WebApp externo.';
      return out;
    }
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/i.test(out.url)) {
      out.status = 'URL invalida';
      return out;
    }
    out.status = 'URL valida';
    if (typeof testarUrlWebAppTransporteCodex === 'function') {
      var res = testarUrlWebAppTransporteCodex();
      out.mode = 'fetch';
      out.responseCode = res && res.getCode;
      out.status = res && res.ok ? 'OK' : 'Fetch com alerta';
      out.message = res && res.ok
        ? 'GET/POST responderam.'
        : 'URL preenchida, mas a chamada leve nao confirmou acesso total.';
      out.getPreview = res && res.getPreview || '';
      out.postCode = res && res.postCode || '';
      out.postPreview = res && res.postPreview || '';
    }
  } catch (e) {
    out.status = out.url ? 'Fetch falhou' : 'URL ausente';
    out.error = e.message || String(e);
  }
  return out;
}

function codexGetDataCountsDiagnostics_() {
  try {
    var ss = getCodexSpreadsheet_();
    var items = [
      codexSheetCountDiagnostic_(ss, 'Agenda', function() { return typeof getAgendaSheet_ === 'function' ? getAgendaSheet_() : ss.getSheetByName('Agenda'); }),
      codexSheetCountDiagnostic_(ss, 'Courier/Couriers', function() { return typeof getCourierSheet_ === 'function' ? getCourierSheet_() : (ss.getSheetByName('Courier') || ss.getSheetByName('Couriers')); }),
      codexSheetCountDiagnostic_(ss, 'LabCentral', function() { return ss.getSheetByName('LabCentral'); }),
      codexSheetCountDiagnostic_(ss, 'Users', function() { return ss.getSheetByName(CODEX_ACL_SHEET_NAME_ || 'Users'); }),
      codexSheetCountDiagnostic_(ss, 'Config_App', function() { return ss.getSheetByName('Config_App'); })
    ];
    return { items: items, error: '' };
  } catch (e) {
    return { items: [], error: e.message || String(e) };
  }
}

function codexSheetCountDiagnostic_(ss, label, resolver) {
  try {
    var sh = resolver ? resolver() : ss.getSheetByName(label);
    if (!sh) return { label: label, ok: false, rows: 0, lastRow: 0, lastColumn: 0, status: 'Aba ausente' };
    var lastRow = sh.getLastRow();
    return {
      label: label,
      sheetName: sh.getName(),
      ok: true,
      rows: Math.max(0, lastRow - 1),
      lastRow: lastRow,
      lastColumn: sh.getLastColumn(),
      status: lastRow > 1 ? 'OK' : 'Sem dados'
    };
  } catch (e) {
    return { label: label, ok: false, rows: 0, status: 'Erro', error: e.message || String(e) };
  }
}

function codexConfigRowIsActive_(row) {
  var active = normText_(row && row.ativo || 'Sim');
  return ['nao', 'false', '0', 'inativo'].indexOf(active) === -1;
}

function codexReadConfigAppRowsForDiagnostics_() {
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName('Config_App');
  var lastRow = sh ? sh.getLastRow() : 0;
  if (!sh || lastRow < 2) return [];
  var out = [];
  [[1, 'Principal'], [8, 'Apoio']].forEach(function(block) {
    var values = sh.getRange(2, block[0], lastRow - 1, 6).getValues();
    values.forEach(function(row, offset) {
      if (!String(row[0] || row[1] || row[2] || '').trim()) return;
      out.push({
        rowIndex: offset + 2,
        bloco: block[1],
        grupo: String(row[0] || '').trim(),
        chave: String(row[1] || '').trim(),
        valor: String(row[2] || '').trim(),
        ativo: String(row[3] || 'Sim').trim()
      });
    });
  });
  return out;
}

function codexBuildConfigAppDiagnostics_() {
  var out = { ok: true, items: [], missing: 0, usingDefaults: 0, duplicateValues: 0, error: '' };
  try {
    var rows = codexReadConfigAppRowsForDiagnostics_();
    var requirements = [
      { label: 'Agenda / Tipos de evento', groups: ['Agenda'], keys: ['Tipo de evento', 'Tipos de evento'], fallbackCount: 11 },
      { label: 'Agenda / Status', groups: ['Agenda'], keys: ['Status'], fallbackCount: 6 },
      { label: 'Estoque / Laboratorios', groups: ['Estoque'], keys: ['Laboratorio'], keyPrefix: true },
      { label: 'Estoque / Localizacoes', groups: ['Estoque'], keys: ['Localizacao'], keyPrefix: true },
      { label: 'Estoque / Tipos de item', groups: ['Estoque'], keys: ['Tipo de item'], keyPrefix: true }
    ];
    requirements.forEach(function(requirement) {
      var groups = {};
      var keys = {};
      requirement.groups.forEach(function(value) { groups[normText_(value)] = true; });
      requirement.keys.forEach(function(value) { keys[normText_(value)] = true; });
      var values = [];
      var matched = false;
      var seen = {};
      var duplicates = [];
      rows.forEach(function(row) {
        var rowKey = normText_(row.chave);
        var keyMatches = !!keys[rowKey] || (requirement.keyPrefix && Object.keys(keys).some(function(key) { return rowKey.indexOf(key) === 0; }));
        if (!groups[normText_(row.grupo)] || !keyMatches) return;
        matched = true;
        if (!codexConfigRowIsActive_(row)) return;
        var value = String(row.valor || '').trim();
        if (!value) return;
        var valueKey = normText_(value);
        if (seen[valueKey] && duplicates.indexOf(value) === -1) duplicates.push(value);
        seen[valueKey] = true;
        values.push(value);
      });
      var usesFallback = !matched && !!requirement.fallbackCount;
      var ok = values.length > 0 || usesFallback;
      if (!ok) out.missing++;
      if (usesFallback) out.usingDefaults++;
      out.duplicateValues += duplicates.length;
      out.items.push({
        label: requirement.label,
        ok: ok,
        count: values.length,
        configured: values.length > 0,
        usesFallback: usesFallback,
        duplicateValues: duplicates,
        detail: usesFallback
          ? 'Usando ' + requirement.fallbackCount + ' valor(es) padrao do aplicativo.'
          : (ok ? values.length + ' valor(es) ativo(s)' + (duplicates.length ? ' | duplicados: ' + duplicates.join(', ') : '') : (matched ? 'A configuracao existe, mas nao possui valor ativo.' : 'Nenhum valor ativo configurado.'))
      });
    });
    out.ok = out.missing === 0;
  } catch (e) {
    out.ok = false;
    out.error = e.message || String(e);
  }
  return out;
}

function codexBuildProfileDiagnostics_(rows) {
  var out = {
    ok: true,
    total: 0,
    active: 0,
    activeAdmins: 0,
    inactive: 0,
    missingNames: 0,
    missingEmails: 0,
    invalidBirthdays: 0,
    duplicateEmails: 0,
    duplicateExamples: [],
    issueExamples: []
  };
  var emails = {};
  (rows || []).forEach(function(row, offset) {
    if (!(row || []).some(function(value) { return value !== '' && value !== null && value !== undefined; })) return;
    var rowNumber = offset + 2;
    var email = codexNormalizeEmail_(row[0]);
    var name = codexNormalizeUserName_(row[1]);
    var active = codexNormalizeActive_(row[3]);
    var role = codexNormalizeRole_(row[2]);
    var birthday = row[4];
    out.total++;
    if (active) {
      out.active++;
      if (role === 'admin') out.activeAdmins++;
    } else out.inactive++;
    if (!email) {
      out.missingEmails++;
      if (out.issueExamples.length < 5) out.issueExamples.push('linha ' + rowNumber + ': e-mail ausente');
    } else if (emails[email]) {
      out.duplicateEmails++;
      if (out.duplicateExamples.length < 5) out.duplicateExamples.push(email + ' (linhas ' + emails[email] + ' e ' + rowNumber + ')');
    } else {
      emails[email] = rowNumber;
    }
    if (!name) {
      out.missingNames++;
      if (out.issueExamples.length < 5) out.issueExamples.push('linha ' + rowNumber + ': nome ausente');
    }
    if (birthday !== '' && birthday !== null && birthday !== undefined) {
      try { codexNormalizeBirthday_(birthday); }
      catch (e) {
        out.invalidBirthdays++;
        if (out.issueExamples.length < 5) out.issueExamples.push('linha ' + rowNumber + ': aniversario invalido');
      }
    }
  });
  out.ok = out.duplicateEmails === 0 && out.missingNames === 0 && out.missingEmails === 0 && out.invalidBirthdays === 0;
  return out;
}

function codexGetProfileHealthDiagnostics_() {
  try {
    var ss = getCodexSpreadsheet_();
    var sh = ss.getSheetByName(CODEX_ACL_SHEET_NAME_ || 'Users');
    if (!sh || sh.getLastRow() < 2) return codexBuildProfileDiagnostics_([]);
    return codexBuildProfileDiagnostics_(sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(5, sh.getLastColumn())).getValues());
  } catch (e) {
    return { ok: false, total: 0, active: 0, activeAdmins: 0, inactive: 0, missingNames: 0, missingEmails: 0, invalidBirthdays: 0, duplicateEmails: 0, duplicateExamples: [], issueExamples: [], error: e.message || String(e) };
  }
}

function codexGetTriggersDiagnostics_() {
  var out = { ok: false, triggers: [], expected: [], missing: 0, duplicates: 0, monitorConfirmacaoCouriersAtivo: false, monitorEntregasDhlAtivo: false, error: '' };
  try {
    out.triggers = ScriptApp.getProjectTriggers().map(function(t) {
      var source = '';
      var eventType = '';
      try { source = t.getTriggerSource ? String(t.getTriggerSource()) : ''; } catch (eSource) {}
      try { eventType = t.getEventType ? String(t.getEventType()) : ''; } catch (eEvent) {}
      var fn = t.getHandlerFunction ? String(t.getHandlerFunction() || '') : '';
      if (fn === 'monitorarConfirmacoesCourierAgendadas' || fn === 'monitorarConfirmacoesCourierAgendadas_') out.monitorConfirmacaoCouriersAtivo = true;
      if (fn === 'monitorarEntregasDhlAgendadas' || fn === 'monitorarEntregasDhlAgendadas_') out.monitorEntregasDhlAtivo = true;
      return { handler: fn, source: source, eventType: eventType, uid: t.getUniqueId ? String(t.getUniqueId() || '') : '' };
    });
    [
      { key: 'courier', label: 'Confirmacoes de courier', aliases: ['monitorarConfirmacoesCourierAgendadas', 'monitorarConfirmacoesCourierAgendadas_'] },
      { key: 'dhl', label: 'Entregas DHL', aliases: ['monitorarEntregasDhlAgendadas', 'monitorarEntregasDhlAgendadas_'] }
    ].forEach(function(expected) {
      var count = out.triggers.filter(function(trigger) { return expected.aliases.indexOf(trigger.handler) >= 0; }).length;
      if (count === 0) out.missing++;
      if (count > 1) out.duplicates += count - 1;
      out.expected.push({ key: expected.key, label: expected.label, handlers: expected.aliases, count: count, ok: count === 1 });
    });
    out.ok = out.missing === 0 && out.duplicates === 0;
  } catch (e) {
    out.error = e.message || String(e);
  }
  return out;
}

function codexAutomationRunKey_(handler) {
  return 'CODEX_AUTOMATION_RUN_' + String(handler || '').replace(/[^A-Za-z0-9_]/g, '_');
}

function codexAutomationResultSummary_(result) {
  result = result || {};
  return ['verificados', 'confirmados', 'entregues', 'pendentes'].map(function(key) {
    return result[key] === undefined || result[key] === null ? '' : key + '=' + result[key];
  }).filter(Boolean).join(' | ');
}

function codexSaveAutomationRun_(handler, state) {
  try {
    PropertiesService.getScriptProperties().setProperty(codexAutomationRunKey_(handler), JSON.stringify(state || {}));
  } catch (e) {
    // O historico nao pode impedir a automacao principal.
  }
}

function codexRunTrackedAutomation_(handler, callback) {
  var startedAt = new Date();
  var startedMs = startedAt.getTime();
  codexSaveAutomationRun_(handler, { handler: handler, status: 'Executando', startedAt: startedAt.toISOString(), finishedAt: '', durationMs: 0, message: '', summary: '' });
  try {
    var result = callback();
    var finishedAt = new Date();
    var failed = result && result.ok === false;
    codexSaveAutomationRun_(handler, {
      handler: handler,
      status: failed ? 'Falha' : 'Sucesso',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedMs),
      message: String(result && result.mensagem || ''),
      summary: codexAutomationResultSummary_(result)
    });
    return result;
  } catch (e) {
    var failedAt = new Date();
    codexSaveAutomationRun_(handler, {
      handler: handler,
      status: 'Falha',
      startedAt: startedAt.toISOString(),
      finishedAt: failedAt.toISOString(),
      durationMs: Math.max(0, failedAt.getTime() - startedMs),
      message: e.message || String(e),
      summary: ''
    });
    throw e;
  }
}

function codexGetAutomationRunDiagnostics_() {
  var out = { ok: true, items: [], error: '' };
  try {
    var props = PropertiesService.getScriptProperties();
    [
      { handler: 'monitorarConfirmacoesCourierAgendadas', label: 'Confirmacoes de courier' },
      { handler: 'monitorarEntregasDhlAgendadas', label: 'Entregas DHL' }
    ].forEach(function(def) {
      var raw = props.getProperty(codexAutomationRunKey_(def.handler));
      var state = {};
      if (raw) {
        try { state = JSON.parse(raw) || {}; }
        catch (eParse) { state = { status: 'Historico invalido', message: eParse.message || String(eParse) }; }
      }
      var status = state.status || 'Nunca registrado';
      if (status === 'Executando' && state.startedAt && Date.now() - new Date(state.startedAt).getTime() > 30 * 60 * 1000) status = 'Possivel interrupcao';
      out.items.push({
        handler: def.handler,
        label: def.label,
        status: status,
        startedAt: state.startedAt || '',
        finishedAt: state.finishedAt || '',
        durationMs: Number(state.durationMs || 0),
        message: state.message || '',
        summary: state.summary || '',
        ok: status === 'Sucesso' || status === 'Nunca registrado'
      });
      if (status === 'Falha' || status === 'Possivel interrupcao' || status === 'Historico invalido') out.ok = false;
    });
  } catch (e) {
    out.ok = false;
    out.error = e.message || String(e);
  }
  return out;
}

function codexGetMailDiagnostics_() {
  var out = { ok: false, remainingDailyQuota: '', status: '', error: '' };
  try {
    out.remainingDailyQuota = MailApp.getRemainingDailyQuota();
    out.status = 'OK';
    out.ok = true;
  } catch (e) {
    out.status = 'Falha';
    out.error = e.message || String(e);
  }
  return out;
}

function codexGetRecentAuditIssuesDiagnostics_(activity) {
  var out = { items: [], scannedRows: 0, sampleLimit: 60, matchTerms: ['acesso', 'negado', 'erro', 'falha'], error: '' };
  if (activity && Array.isArray(activity.recentAuditIssues)) {
    out.items = activity.recentAuditIssues.slice(0, 8);
    out.scannedRows = Number(activity.auditScannedRows || 0);
    out.reusedOperationalSample = true;
    return out;
  }
  try {
    var page = getAuditRowsPage_('Audit_Log', 6, 60, 0, function(r) {
      return {
        id: String(r[0] || ''),
        email: String(r[1] || ''),
        action: String(r[2] || ''),
        timestamp: r[3] instanceof Date ? Utilities.formatDate(r[3], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss') : String(r[3] || ''),
        module: String(r[4] || ''),
        recordId: String(r[5] || '')
      };
    });
    out.scannedRows = (page.rows || []).length;
    out.items = (page.rows || []).filter(function(r) {
      var a = normText_(r.action);
      return a.indexOf('acesso') > -1 || a.indexOf('negado') > -1 || a.indexOf('erro') > -1 || a.indexOf('falha') > -1;
    }).slice(0, 8);
  } catch (e) {
    out.error = e.message || String(e);
  }
  return out;
}

function codexGetCriticalPermissionsDiagnostics_() {
  var out = { drive: { ok: false, status: '', error: '' }, calendar: { ok: false, status: '', error: '' } };
  try {
    DriveApp.getRootFolder().getName();
    out.drive.ok = true;
    out.drive.status = 'OK';
  } catch (eDrive) {
    out.drive.status = 'Falha';
    out.drive.error = eDrive.message || String(eDrive);
  }
  try {
    CalendarApp.getDefaultCalendar().getName();
    out.calendar.ok = true;
    out.calendar.status = 'OK';
  } catch (eCal) {
    out.calendar.status = 'Falha';
    out.calendar.error = eCal.message || String(eCal);
  }
  return out;
}

function codexGetSmokeDiagnostics_(context) {
  context = context || {};
  var out = { checks: [] };
  function add(label, ok, detail, status) {
    out.checks.push({ label: label, ok: !!ok, status: status || (ok ? 'OK' : 'Atencao'), detail: detail || '' });
  }
  var profiles = context.profileHealth || {};
  var admins = Number(profiles.activeAdmins || 0);
  add('Existe ao menos 1 admin ativo', !profiles.error && admins > 0,
    profiles.error || admins + ' admin(s) ativo(s)', profiles.error ? 'Erro' : undefined);
  try {
    var ss = getCodexSpreadsheet_();
    var labSheet = ss.getSheetByName('LabCentral');
    var labRows = labSheet ? Math.max(0, labSheet.getLastRow() - 1) : 0;
    add('LabCentral tem laboratorios', labRows > 0, labRows + ' laboratorio(s)');
  } catch (eLab) {
    add('LabCentral tem laboratorios', false, eLab.message || String(eLab), 'Erro');
  }
  try {
    var ssCourier = getCodexSpreadsheet_();
    var courierSheet = ssCourier.getSheetByName('Courier') || ssCourier.getSheetByName('Couriers');
    var courierRows = courierSheet ? Math.max(0, courierSheet.getLastRow() - 1) : 0;
    add('Couriers cadastradas', courierRows > 0, courierRows + ' courier(s)');
  } catch (eCour) {
    add('Couriers cadastradas', false, eCour.message || String(eCour), 'Erro');
  }
  return out;
}

function limparCodexCachesDiagnostico(clientContext) {
  var access = codexAssertAdmin_();
  clearConfigAppDefaultsCache_('Diagnostico');
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('CODEX_CONFIG_CACHE_INVALIDATED_BY', access.userEmail || '');
  } catch (e) {}
  return getCodexDeploymentDiagnostics(clientContext || {});
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
