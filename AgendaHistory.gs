// Leitura exclusiva sob demanda. Nunca chamada pelo bootstrap/listagem da Agenda.
function getAgendaHistorico(id, before) {
  codexAssertCanRead_();
  id = String(id == null ? '' : id).trim();
  if (!id || id.length > 200) throw new Error('Informe um agendamento válido.');
  if (before !== undefined && before !== null && (!Number.isInteger(before) || before < 2)) {
    throw new Error('Página inválida. Reabra o histórico.');
  }
  var meta = { rowCount: 0, cellCount: 0 };
  return codexMeasureReadPerformance_('getAgendaHistorico', 'total', meta, function() {
    var sheet = getCodexSpreadsheet_().getSheetByName('Audit_Changes');
    var last = sheet ? sheet.getLastRow() : 0;
    if (before && before > last + 1) throw new Error('O histórico mudou. Reabra a janela para atualizar.');
    var end = before ? before - 1 : last;
    var result = { agendaId: id, rows: [], nextBefore: null, hasMore: false };
    if (end < 2) return result;
    // Orçamento fixo: uma leitura de até 500 x 10 células, sem scan integral/cache de conteúdo.
    var start = Math.max(2, end - 499);
    var values = codexReadValuesMeasured_(sheet.getRange(start, 1, end - start + 1, 10), false);
    meta.rowCount = values.length;
    meta.cellCount = values.length * 10;
    var next = start;
    for (var i = values.length - 1; i >= 0; i--) {
      var row = values[i];
      if (String(row[3] || '') !== 'Agenda' || String(row[5] == null ? '' : row[5]).trim() !== id) continue;
      var item = agendaHistoricoItem_(row);
      if (!item) continue;
      result.rows.push(item);
      if (result.rows.length === 40) { next = start + i; break; }
    }
    result.hasMore = next > 2;
    result.nextBefore = result.hasMore ? next : null;
    return result;
  });
}

function agendaHistoricoItem_(row) {
  var action = String(row[4] || '');
  var actions = {
    criarAgendaEventoConcluido: 'Criação do agendamento',
    atualizarAgendaEventoCompleto: 'Alteração do agendamento',
    cancelarAgendaEvento: 'Cancelamento do agendamento'
  };
  if (!Object.prototype.hasOwnProperty.call(actions, action)) return null;
  var field = String(row[6] || '');
  var fields = ['Agendamento', 'Data', 'Horário', 'Tipo de evento', 'Status', 'Protocolo', 'Visita',
    'Médico', 'Serviço terceirizado', 'Laboratório Central', 'Sala/local', 'Monitor', 'Carro requerido'];
  var identity = ['Participante', 'Número de identificação', 'ID Cadastro Participante'].indexOf(field) >= 0;
  if (!identity && fields.indexOf(field) < 0) return null;
  // Não expor linhas brutas, observações, notas técnicas, nascimento ou identidades anteriores.
  var timestamp = row[1] instanceof Date && !isNaN(row[1].getTime())
    ? Utilities.formatDate(row[1], 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss') : '';
  return {
    timestamp: timestamp || 'Data não disponível',
    email: String(row[2] || '').slice(0, 160),
    action: actions[action], field: identity ? 'Vínculo do participante' : field,
    oldValue: identity ? '' : String(row[7] == null ? '' : row[7]).slice(0, 200),
    newValue: identity ? 'Alterado' : String(row[8] == null ? '' : row[8]).slice(0, 200)
  };
}
