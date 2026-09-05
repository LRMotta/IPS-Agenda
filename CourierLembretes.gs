// Cobranças automáticas: vínculo explícito, uma tentativa durável e resposta na conversa original.
var COURIER_LEMBRETES_SHEET_ = 'Courier_Lembretes';
var COURIER_LEMBRETES_HEADERS_ = ['Chave', 'Agenda_ID', 'Slot', 'Gerado_Em', 'Base', 'Estado', 'Atualizado_Em', 'Thread_ID', 'Mensagem_ID', 'Detalhe'];

function configurarMonitorLembretesCourier(ativo) {
  codexAssertAdmin_();
  if (typeof ativo !== 'boolean') throw new Error('Informe ativação ou pausa.');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('COURIER_LEMBRETES_ATIVO', 'false');
  if (!ativo) return { mensagem: 'Todas as cobranças pausadas.' };
  var email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('Não foi possível identificar a conta monitorada.');
  GmailApp.getAliases(); // Exige autorização antes de instalar/ativar.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'monitorarLembretesCourier') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('monitorarLembretesCourier').timeBased().everyMinutes(15).create();
  props.setProperty('COURIER_LEMBRETES_CONTA', email);
  props.setProperty('COURIER_LEMBRETES_ATIVO', 'true');
  return { mensagem: 'Monitor ativo em ' + email + '. Respeita o modo e o prazo salvos em cada courier.' };
}

function courierLembreteRows_() {
  var sh = getCodexSpreadsheet_().getSheetByName(COURIER_LEMBRETES_SHEET_);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().map(function(r, n) {
    return { row: n + 2, key: String(r[0]), agendaId: String(r[1]), slot: String(r[2]), gerado: r[3], base: String(r[4]), estado: String(r[5]), atualizado: r[6], thread: String(r[7]), message: String(r[8]), detalhe: String(r[9]) };
  });
}

function courierLembreteSalvar_(item, estado, detalhe, thread, message) {
  var ss = getCodexSpreadsheet_();
  var sh = ss.getSheetByName(COURIER_LEMBRETES_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(COURIER_LEMBRETES_SHEET_);
    sh.getRange(1, 1, 1, 10).setValues([COURIER_LEMBRETES_HEADERS_]);
    sh.hideSheet();
  }
  item.row = item.row || sh.getLastRow() + 1;
  item.estado = estado;
  item.atualizado = new Date();
  item.thread = thread || item.thread || '';
  item.message = message || item.message || '';
  item.detalhe = detalhe || '';
  sh.getRange(item.row, 1, 1, 10).setValues([[item.key, item.agendaId, item.slot, item.gerado, item.base, estado, item.atualizado, item.thread, item.message, item.detalhe]]);
  SpreadsheetApp.flush();
}

function courierLembreteAgenda_(id, slot) {
  var sh = getAgendaSheetForRead_();
  var rows = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, AGENDA_CFG.lastCol).getDisplayValues();
  var idx = AGENDA_CFG.idx;
  var matches = rows.filter(function(r) { return String(r[idx.id]).trim() === id; });
  var cfg = { '1': idx.c1, '2': idx.c2, '3': idx.c3 }[slot];
  if (matches.length !== 1 || !cfg) return null;
  var row = matches[0];
  var keys = ['id', 'data', 'hora', 'tipo', 'participante', 'projeto', 'visita'];
  var base = keys.map(function(k) { return row[idx[k]] || ''; });
  Object.keys(cfg).sort().forEach(function(k) { if (k !== 'status') base.push(k, row[cfg[k]] || ''); });
  return { base: JSON.stringify(base), status: row[idx.status], courierStatus: row[cfg.status], courier: row[cfg.nome], awb: row[cfg.awb], data: row[idx.data], feriados: getAgendaFeriadosPendenciasMap_(rows, idx) };
}

function courierLembreteRegistrarBase_(agendaId, slot, gerado) {
  // Chamado somente durante geração nova. Nunca preenche vínculos do histórico.
  var atual = courierLembreteAgenda_(agendaId, slot);
  if (!atual) return;
  var key = agendaId + ':' + slot;
  var item = courierLembreteRows_().filter(function(r) { return r.key === key; })[0];
  if (item && ['TENTATIVA', 'ENVIADO', 'INCERTO'].indexOf(item.estado) >= 0) return;
  item = item || { key: key, agendaId: agendaId, slot: slot };
  item.gerado = gerado;
  item.base = atual.base;
  item.thread = '';
  item.message = '';
  courierLembreteSalvar_(item, 'BASE', 'Aguardando envio da solicitação');
}

function courierLembreteHoraLocal_(date) {
  return new Date(Utilities.formatDate(date, 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss") + 'Z');
}

function courierLembreteDiaUtil_(date, feriados) {
  return date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !feriados[date.toISOString().slice(0, 10)];
}

function courierLembreteHoras_(inicio, fim, feriados) {
  if (fim <= inicio || fim - inicio > 31 * 86400000) return 0;
  var cursor = new Date(inicio);
  cursor.setUTCHours(0, 0, 0, 0);
  var total = 0;
  while (cursor <= fim) {
    if (courierLembreteDiaUtil_(cursor, feriados)) {
      total += Math.max(0, Math.min(+fim, +cursor + 18 * 3600000) - Math.max(+inicio, +cursor + 8 * 3600000));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total / 3600000;
}

function courierLembreteVencido_(inicio, agora, coletaIso, config, feriados) {
  var horas = Number(config.lembreteHoras);
  if (!(horas > 0 && horas <= 80) || !courierLembreteDiaUtil_(agora, feriados) || agora.getUTCHours() < 8 || agora.getUTCHours() >= 18) return false;
  if (coletaIso <= agora.toISOString().slice(0, 10)) return false;
  var decorrido = courierLembreteHoras_(inicio, agora, feriados);
  if (decorrido >= horas) return true;
  if (!/^(0[8-9]|1[0-7]):[0-5]\d$/.test(config.lembreteLimite || '') || decorrido < 1) return false;
  var limite = new Date(coletaIso + 'T00:00:00Z');
  do { limite.setUTCDate(limite.getUTCDate() - 1); } while (!courierLembreteDiaUtil_(limite, feriados));
  var h = config.lembreteLimite.split(':');
  limite.setUTCHours(Number(h[0]), Number(h[1]), 0, 0);
  return agora >= limite;
}

function courierLembreteEmails_(value) {
  return (String(value || '').toLowerCase().match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []).filter(function(v, i, arr) { return arr.indexOf(v) === i; }).sort();
}

function courierLembreteValidarConversa_(original, op, config, own) {
  var ref = transporteMonitorReferencia_(op.agendaId, op.slot);
  var from = courierLembreteEmails_(original.getFrom());
  var to = courierLembreteEmails_(original.getTo() + ',' + original.getCc());
  var couriers = courierLembreteEmails_([config.email, config.emailAmbiente, config.emailCongelado].join(','));
  if (!ref || !op.geradoPor || from.length !== 1 || from[0] !== String(op.geradoPor).toLowerCase()) return 'Remetente original não validado';
  if (!couriers.some(function(email) { return to.indexOf(email) >= 0; })) return 'Destinatário da courier não validado';
  if (!to.concat(from).some(function(email) { return own.indexOf(email) >= 0; })) return 'Conversa fora da conta monitorada';
  if (courierLembreteEmails_(original.getBcc()).length) return 'Conversa com cópia oculta — revisar destinatários';
  var reply = courierLembreteEmails_(original.getReplyTo());
  if (reply.some(function(email) { return from.concat(to).indexOf(email) < 0; })) return 'Endereço de resposta divergente';
  var body = original.getPlainBody();
  if (body.indexOf(ref) < 0 || original.isDraft() || original.isInTrash()) return 'Solicitação original não validada';
  if (original.getDate() < new Date(op.geradoEm) || Math.abs(+original.getDate() - +new Date(op.emailEnviadoEm)) > 1000) return 'Data do envio não validada';
  var messages = original.getThread().getMessages();
  if (messages.some(function(m) { return m.getId() !== original.getId() && m.getDate() >= original.getDate(); })) return 'Resposta ou nova mensagem recebida — revisar';
  return '';
}

function courierLembreteTexto_(config, atual, op) {
  var template = config.lembreteTexto || 'Prezados,\n\nAté o momento, não identificamos a confirmação da coleta prevista para {data}, referente ao {transporte} (AWB: {awb}). Poderiam, por gentileza, confirmar o agendamento?\n\nPara mantermos o histórico centralizado e evitarmos desencontro de informações, pedimos que qualquer confirmação, alteração ou cancelamento seja informada como resposta a este mesmo e-mail.\n\nAtenciosamente,\nEquipe IPS';
  var vars = { data: atual.data, transporte: 'Transporte ' + ({ '1': 'I', '2': 'II', '3': 'III' }[op.slot]), referencia: op.referencia, awb: atual.awb || 'não informada' };
  return template.replace(/\{(data|transporte|referencia|awb)\}/g, function(_, k) { return vars[k]; }) + '\n\nRef. IPS: ' + op.referencia + '\nCobrança IPS: ' + op.agendaId + ':' + op.slot;
}

function monitorarLembretesCourier(event) {
  codexAssertAdminOrInstalledTrigger_(event, 'monitorarLembretesCourier');
  return codexRunTrackedAutomation_('monitorarLembretesCourier', function() { return courierLembreteExecutar_(); });
}

function courierLembreteExecutar_() {
  var props = PropertiesService.getScriptProperties();
  var conta = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (props.getProperty('COURIER_LEMBRETES_ATIVO') !== 'true' || conta !== props.getProperty('COURIER_LEMBRETES_CONTA')) return { pausado: true };
  // Conta única autorizada: lock de usuário evita sobreposição sem bloquear a Agenda.
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return { ocupado: true };
  try {
    var own = [conta].concat(GmailApp.getAliases().map(function(s) { return s.toLowerCase(); }));
    var configs = getAgendaCourierRows_();
    var ops = transporteOperacoesRows_();
    var itens = courierLembreteRows_();
    var enviados = 0;
    var tentativas = 0;
    var iniciou = Date.now();
    for (var n = 0; n < itens.length && tentativas < 5 && Date.now() - iniciou < 180000; n++) {
      var item = itens[n];
      if (['TENTATIVA', 'ENVIADO', 'INCERTO', 'REVISAO'].indexOf(item.estado) >= 0) continue;
      var op = ops.filter(function(o) { return o.agendaId === item.agendaId && o.slot === item.slot; })[0];
      if (!op || !op.emailEnviadoEm || !op.gmailMessageId || +new Date(op.geradoEm) !== +new Date(item.gerado)) continue;
      var atual = courierLembreteAgenda_(item.agendaId, item.slot);
      if (!atual || !AgendaServerRules_.courierIsAwaitingConfirmation(atual.courierStatus)) continue;
      if (AgendaServerRules_.isCancelled(atual.status) || AgendaServerRules_.isConcluded(atual.status) || AgendaServerRules_.isRescheduled(atual.status) || normText_(atual.status) !== 'agendado') continue;
      if (atual.base !== item.base) { courierLembreteSalvar_(item, 'REVISAO', 'Dados do transporte alterados — revisar'); continue; }
      var config = configs.filter(function(c) { return normText_(c.nome) === normText_(atual.courier); });
      if (config.length !== 1 || ['Simulação', 'Automático'].indexOf(config[0].lembreteModo) < 0) continue;
      config = config[0];
      if (item.estado === 'SIMULACAO' && config.lembreteModo === 'Simulação') continue;
      var coleta = parseAgendaDateAny_(atual.data);
      if (!coleta) continue;
      var coletaIso = Utilities.formatDate(coleta, 'America/Sao_Paulo', 'yyyy-MM-dd');
      if (!courierLembreteVencido_(courierLembreteHoraLocal_(new Date(op.emailEnviadoEm)), courierLembreteHoraLocal_(new Date()), coletaIso, config, atual.feriados)) continue;
      tentativas++;
      try {
        var original = GmailApp.getMessageById(op.gmailMessageId);
        var motivo = courierLembreteValidarConversa_(original, op, config, own);
        var threadId = original.getThread().getId();
        if (itens.some(function(other) { return other.thread === threadId && ['TENTATIVA', 'ENVIADO', 'INCERTO'].indexOf(other.estado) >= 0; })) motivo = 'Já existe cobrança nesta conversa — revisar';
        if (motivo) { courierLembreteSalvar_(item, 'REVISAO', motivo, threadId); continue; }
        if (config.lembreteModo === 'Simulação') { courierLembreteSalvar_(item, 'SIMULACAO', 'Simulação: cobrança seria enviada', threadId); continue; }
        var reservado = codexWithDocumentLock_('courierLembreteReservar', function() {
          var fresh = courierLembreteAgenda_(item.agendaId, item.slot);
          if (!fresh || fresh.base !== item.base || fresh.status !== atual.status || !AgendaServerRules_.courierIsAwaitingConfirmation(fresh.courierStatus)) return false;
          courierLembreteSalvar_(item, 'TENTATIVA', 'Envio em verificação; não repetir automaticamente', threadId);
          return true;
        });
        if (!reservado) continue;
        // Reconsulta imediatamente antes do efeito externo; nunca reutiliza um snapshot Gmail antigo.
        original = GmailApp.getMessageById(op.gmailMessageId);
        motivo = courierLembreteValidarConversa_(original, op, config, own);
        CODEX_AGENDA_COURIER_ROWS_CACHE_ = null;
        var configFinal = getAgendaCourierRows_().filter(function(c) { return normText_(c.nome) === normText_(atual.courier); });
        if (configFinal.length !== 1 || JSON.stringify(configFinal[0]) !== JSON.stringify(config)) motivo = 'Configuração da courier alterada — revisar';
        if (motivo || props.getProperty('COURIER_LEMBRETES_ATIVO') !== 'true') {
          courierLembreteSalvar_(item, 'REVISAO', motivo || 'Monitor pausado antes do envio', threadId);
          continue;
        }
        var texto = courierLembreteTexto_(config, atual, op);
        CodexExternalEffects_.replyCourierReminder(original, texto);
        // replyAll retorna a mensagem original; só o e-mail enviado comprova o novo ID.
        var thread = GmailApp.getThreadById(threadId);
        thread.refresh();
        var sent = thread.getMessages().filter(function(m) {
          return m.getId() !== original.getId() && !m.isDraft() && m.getDate() >= original.getDate() && own.indexOf(courierLembreteEmails_(m.getFrom())[0]) >= 0 && m.getPlainBody().indexOf('Cobrança IPS: ' + item.key) >= 0;
        });
        if (sent.length === 1) {
          courierLembreteSalvar_(item, 'ENVIADO', 'Cobrança enviada', threadId, sent[0].getId());
          enviados++;
        } else courierLembreteSalvar_(item, 'INCERTO', 'Envio a verificar — não repetir automaticamente', threadId);
      } catch (e) {
        // Timeout pode ocorrer após Gmail aceitar a mensagem. Nunca reenvia a tentativa.
        courierLembreteSalvar_(item, item.estado === 'TENTATIVA' ? 'INCERTO' : 'REVISAO', 'Falha na verificação ou envio — revisão necessária');
        Logger.log('Cobrança courier ' + item.key + ': ' + String(e.message || e));
      }
    }
    return { enviados: enviados, verificados: tentativas };
  } finally { lock.releaseLock(); }
}

function courierLembreteAnotarPendencias_(pendencias) {
  var rows = courierLembreteRows_();
  (pendencias || []).forEach(function(p) {
    var slot = { 'Transporte I': '1', 'Transporte II': '2', 'Transporte III': '3' }[p.slot];
    var item = rows.filter(function(r) { return r.agendaId === p.agendaId && r.slot === slot; })[0];
    p.lembreteStatus = !item ? 'Cobrança manual — sem vínculo rastreável' : 'Aguardando confirmação';
    if (!item) return;
    if (item.estado === 'ENVIADO') p.lembreteStatus = 'Cobrança enviada em ' + Utilities.formatDate(new Date(item.atualizado), 'America/Sao_Paulo', 'dd/MM HH:mm');
    else if (['TENTATIVA', 'INCERTO'].indexOf(item.estado) >= 0) p.lembreteStatus = 'Envio a verificar — não repetir';
    else if (item.estado === 'REVISAO' || item.estado === 'SIMULACAO') p.lembreteStatus = item.detalhe;
  });
}
