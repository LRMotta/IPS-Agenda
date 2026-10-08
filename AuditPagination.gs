// Recortes de leitura: cache guarda somente limites, contagens e hashes, nunca DTOs.
var CODEX_AUDIT_QUERY_TTL_SECONDS_ = 300;
var CODEX_AUDIT_QUERY_PART_BYTES_ = 90000;
var CODEX_AUDIT_QUERY_BUDGET_BYTES_ = 512 * 1024;
var CODEX_AUDIT_QUERY_SCAN_ROWS_ = 50000;

function codexAuditQueryHash_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
}

function codexAuditQuerySigningKey_() {
  var props = PropertiesService.getScriptProperties();
  var name = 'CODEX_AUDIT_QUERY_SIGNING_KEY_V1';
  var key = props.getProperty(name);
  if (key) return key;
  // Inicialização única. Nenhuma propriedade por página ou consulta.
  return codexWithDocumentLock_('auditQuerySigningKey', function() {
    var current = props.getProperty(name);
    if (!current) {
      current = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty(name, current);
    }
    return current;
  });
}

function codexAuditQueryToken_(envelope) {
  var encoded = Utilities.base64EncodeWebSafe(JSON.stringify(envelope));
  return encoded + '.' + Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(encoded, codexAuditQuerySigningKey_()));
}

function codexAuditQueryDecode_(token) {
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/.test(token)) {
    throw new Error('Consulta de auditoria inválida. Atualize os dados.');
  }
  var parts = token.split('.');
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], codexAuditQuerySigningKey_()));
  if (parts[1] !== expected) throw new Error('Consulta de auditoria inválida. Atualize os dados.');
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
}

function codexAuditQueryExpired_(reason) {
  return { ok: false, refreshRequired: true, reason: reason };
}

function codexAuditQueryRead_(sheet, start, rows, cols, metrics) {
  metrics.readCalls++;
  metrics.cellsRead += rows * cols;
  return sheet.getRange(start, 1, rows, cols).getValues();
}

function codexAuditQueryBuild_(sheet, upperRow, limit, filters, indexes, metrics) {
  var prepared = codexPrepareAuditFilters_(filters);
  var pages = [];
  var ids = [];
  var firstRow = 0;
  var lastRow = 0;
  var users = Object.create(null);
  var modules = Object.create(null);
  var total = 0;
  function finishPage() {
    if (!ids.length) return;
    pages.push({ firstRow: firstRow, lastRow: lastRow, count: ids.length, idDigest: codexAuditQueryHash_(JSON.stringify(ids)) });
    ids = [];
  }
  // Blocos limitam a memória de células; nenhum valor Antes/Depois é lido aqui.
  for (var end = upperRow; end >= 2;) {
    var start = Math.max(2, end - CODEX_AUDIT_QUERY_SCAN_ROWS_ + 1);
    var rows = codexAuditQueryRead_(sheet, start, end - start + 1, 5, metrics);
    for (var index = rows.length - 1; index >= 0; index--) {
      var row = rows[index];
      if (!codexAuditRowMatchesFilters_(row, filters, indexes, prepared)) continue;
      if (!ids.length) firstRow = start + index;
      lastRow = start + index;
      ids.push(String(row[0] || ''));
      total++;
      var user = String(row[indexes.userCol] || '');
      var moduleName = String(row[indexes.moduleCol] || '');
      if (user) users[user] = true;
      if (moduleName) modules[moduleName] = true;
      if (ids.length === limit) finishPage();
    }
    end = start - 1;
  }
  finishPage();
  var summary = { total: total, userCount: Object.keys(users).length, moduleCount: Object.keys(modules).length };
  return { pages: pages, summary: summary, digest: codexAuditQueryHash_(JSON.stringify([summary, pages])) };
}

function codexAuditQueryStore_(envelope, plan, metrics) {
  var ttl = Math.floor((envelope.expiresAt - Date.now()) / 1000);
  if (ttl < 1) return false;
  var chunks = [];
  var chunk = [];
  var bytes = 2;
  var totalBytes = 0;
  var startPage = 0;
  var manifest = [];
  plan.pages.forEach(function(page, index) {
    var pageBytes = codexUtf8ByteLength_(JSON.stringify(page)) + (chunk.length ? 1 : 0);
    if (bytes + pageBytes > CODEX_AUDIT_QUERY_PART_BYTES_ && chunk.length) {
      chunks.push(chunk);
      manifest.push({ start: startPage, count: chunk.length });
      totalBytes += bytes;
      chunk = [];
      bytes = 2;
      startPage = index;
      pageBytes--;
    }
    chunk.push(page);
    bytes += pageBytes;
  });
  if (chunk.length) {
    chunks.push(chunk);
    manifest.push({ start: startPage, count: chunk.length });
    totalBytes += bytes;
  }
  metrics.indexBytes = totalBytes;
  var key = 'AuditQuery:v1:' + envelope.id;
  var metadata = { digest: plan.digest, summary: plan.summary, parts: manifest };
  if (totalBytes + codexUtf8ByteLength_(JSON.stringify(metadata)) > CODEX_AUDIT_QUERY_BUDGET_BYTES_) return false;
  for (var i = 0; i < chunks.length; i++) {
    if (!codexCachePut_(key + ':part:' + i, chunks[i], ttl)) return false;
  }
  return codexCachePut_(key + ':manifest', metadata, ttl);
}

function codexGetAuditSnapshotPage_(access, type, limit, offset, filters, query) {
  var metrics = { type: type === 'changes' ? 'changes' : 'log', readCalls: 0, cellsRead: 0, cacheHit: false, rebuilt: false, indexBytes: 0 };
  var startedAt = Date.now();
  var success = false;
  try {
    type = metrics.type;
    limit = Math.max(1, Math.min(Number(limit || 100), 500));
    offset = Math.max(0, Number(offset || 0));
    if (!isFinite(limit) || Math.floor(limit) !== limit || !isFinite(offset) || Math.floor(offset) !== offset || offset % limit !== 0) {
      throw new Error('Página de auditoria inválida.');
    }
    var email = codexNormalizeEmail_(access.userEmail || access.email || codexGetActiveUserEmail_());
    if (!email) throw new Error('Não foi possível identificar o administrador.');
    var owner = codexAuditQueryHash_(email);
    var prepared = codexPrepareAuditFilters_(filters);
    var signature = codexAuditQueryHash_(JSON.stringify(prepared));
    var suppliedToken = query.forceRefresh ? '' : (query.snapshotId || '');
    var envelope = suppliedToken ? codexAuditQueryDecode_(suppliedToken) : null;
    if (envelope) {
      if (envelope.owner !== owner || envelope.type !== type || envelope.limit !== limit || envelope.signature !== signature) {
        throw new Error('Consulta de auditoria incompatível. Atualize os dados.');
      }
      if (Date.now() >= envelope.expiresAt) return codexAuditQueryExpired_('expired');
    }
    var ss = getCodexSpreadsheet_();
    var sheet = ss.getSheetByName(type === 'changes' ? 'Audit_Changes' : 'Audit_Log');
    var lastRow = sheet ? sheet.getLastRow() : 0;
    var filtered = codexHasAuditFilters_(filters);
    var cols = type === 'changes' ? 10 : 6;
    var mapper = type === 'changes' ? codexAuditChangesRowDto_ : codexAuditLogRowDto_;
    var indexes = type === 'changes' ? { userCol: 2, actionCol: 4, dateCol: 1, moduleCol: 3 }
      : { userCol: 1, actionCol: 2, dateCol: 3, moduleCol: 4 };
    if (envelope && (!sheet || envelope.spreadsheet !== ss.getId() || envelope.sheet !== sheet.getSheetId() || lastRow < envelope.upperRow)) {
      return codexAuditQueryExpired_('source_changed');
    }
    if (!sheet || lastRow < 2) {
      success = true;
      return { ok: true, rows: [], total: 0, limit: limit, offset: 0, hasMore: false, type: type, paginationVersion: 2 };
    }
    if (!envelope) {
      envelope = { id: Utilities.getUuid(), owner: owner, type: type, limit: limit, signature: signature,
        spreadsheet: ss.getId(), sheet: sheet.getSheetId(), upperRow: lastRow,
        createdAt: Date.now(), expiresAt: Date.now() + CODEX_AUDIT_QUERY_TTL_SECONDS_ * 1000 };
    }
    var rows = [];
    var summary;
    if (!filtered) {
      // Caminho barato: somente a página, ancorada na última linha da consulta.
      summary = { total: envelope.upperRow - 1 };
      var end = envelope.upperRow - offset;
      if (end >= 2) {
        var start = Math.max(2, end - limit + 1);
        rows = codexAuditQueryRead_(sheet, start, end - start + 1, cols, metrics).reverse();
      }
    } else {
      var pageIndex = offset / limit;
      var cached = envelope.digest ? codexCacheGet_('AuditQuery:v1:' + envelope.id + ':manifest') : null;
      var bookmark = null;
      var haveIndex = false;
      if (cached && cached.digest === envelope.digest) {
        summary = cached.summary;
        if (offset >= summary.total) haveIndex = true;
        else {
          for (var part = 0; part < cached.parts.length; part++) {
            var info = cached.parts[part];
            if (pageIndex < info.start || pageIndex >= info.start + info.count) continue;
            var pages = codexCacheGet_('AuditQuery:v1:' + envelope.id + ':part:' + part);
            bookmark = pages && pages[pageIndex - info.start];
            haveIndex = !!bookmark;
            break;
          }
        }
      }
      metrics.cacheHit = haveIndex;
      if (!haveIndex) {
        metrics.rebuilt = !!envelope.digest;
        var plan = codexAuditQueryBuild_(sheet, envelope.upperRow, limit, filters, indexes, metrics);
        if (envelope.digest && envelope.digest !== plan.digest) return codexAuditQueryExpired_('source_changed');
        envelope.digest = plan.digest;
        summary = plan.summary;
        bookmark = plan.pages[pageIndex];
        metrics.cacheStored = codexAuditQueryStore_(envelope, plan, metrics);
      }
      if (bookmark) {
        rows = codexAuditQueryRead_(sheet, bookmark.lastRow, bookmark.firstRow - bookmark.lastRow + 1, cols, metrics).reverse();
        rows = rows.filter(function(row) { return codexAuditRowMatchesFilters_(row, filters, indexes, prepared); });
        var ids = rows.map(function(row) { return String(row[0] || ''); });
        if (rows.length !== bookmark.count || codexAuditQueryHash_(JSON.stringify(ids)) !== bookmark.idDigest) {
          return codexAuditQueryExpired_('source_changed');
        }
      }
    }
    if (Date.now() >= envelope.expiresAt) return codexAuditQueryExpired_('expired');
    var token = suppliedToken || codexAuditQueryToken_(envelope);
    // Mesmo sem cache, o token assinado permite reconstruir exatamente o recorte.
    var output = { ok: true, rows: rows.map(mapper), total: summary.total, limit: limit, offset: offset,
      hasMore: offset + rows.length < summary.total, type: type, paginationVersion: 2,
      snapshotId: token, createdAt: envelope.createdAt, expiresAt: envelope.expiresAt };
    if (filtered) {
      output.userCount = summary.userCount;
      output.moduleCount = summary.moduleCount;
    }
    success = true;
    return output;
  } finally {
    // Somente métricas técnicas; nunca incluir token, filtros, e-mail ou IDs.
    try {
      metrics.durationMs = Date.now() - startedAt;
      metrics.success = success;
      Logger.log('[CODEX_AUDIT_PAGE] ' + JSON.stringify(metrics));
    } catch (eLog) {}
  }
}
