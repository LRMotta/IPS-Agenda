// Leitura exclusiva sob demanda. Nunca chamada pelo bootstrap/listagem da Agenda.
function getAgendaHistorico(id, before) {
  codexAssertCanRead_();
  id = String(id == null ? '' : id).trim();
  if (!id || id.length > 200) throw new Error('Informe um agendamento válido.');
  if (before !== undefined && before !== null && (!Number.isInteger(before) || before < 2)) {
    throw new Error('Página inválida. Reabra o histórico.');
  }
  var meta = { rowCount: 0, cellCount: 0, readCalls: 0, searchRows: 0, matchCount: 0 };
  return codexMeasureReadPerformance_('getAgendaHistorico', 'total', meta, function() {
    var sheet = getCodexSpreadsheet_().getSheetByName('Audit_Changes');
    var last = sheet ? sheet.getLastRow() : 0;
    if (before && before > last + 1) throw new Error('O histórico mudou. Reabra a janela para atualizar.');
    var end = before ? before - 1 : last;
    var result = { agendaId: id, rows: [], nextBefore: null, hasMore: false };
    if (end < 2) return result;
    // Busca nativa apenas na coluna Record ID. Não transfere a coluna inteira nem
    // cria um índice persistido. O custo da busca no Sheets ainda depende da fonte.
    // Escapar o ID preserva correspondência literal, aceitando espaços legados.
    var escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var positions = sheet.getRange(2, 6, end - 1, 1)
      .createTextFinder('^\\s*' + escapedId + '\\s*$')
      .matchEntireCell(true).matchCase(true).useRegularExpression(true).findAll()
      .map(function(range) { return range.getRow(); })
      .sort(function(a, b) { return b - a; });
    meta.searchRows = end - 1;
    meta.matchCount = positions.length;
    var lastReturned = null;
    for (var offset = 0; offset < positions.length;) {
      var high = positions[offset];
      var low = high;
      var finish = offset + 1;
      // Unir ocorrências próximas reduz RPCs sem ler o intervalo global entre
      // primeiro/último match. Cada faixa tem no máximo 160 linhas e lacuna de 8.
      while (finish < positions.length && low - positions[finish] <= 8 && high - positions[finish] < 160) {
        low = positions[finish++];
      }
      var values = codexReadValuesMeasured_(sheet.getRange(low, 1, high - low + 1, 10), false);
      meta.rowCount += values.length;
      meta.cellCount += values.length * 10;
      meta.readCalls++;
      for (var index = offset; index < finish; index++) {
        var physicalRow = positions[index];
        var row = values[physicalRow - low];
        // Revalidar a identidade depois de localizar: nunca devolver outro registro
        // se uma manutenção manual reordenar a Auditoria durante a consulta.
        if (!row || String(row[5] == null ? '' : row[5]).trim() !== id) {
          throw new Error('O histórico mudou. Reabra a janela para atualizar.');
        }
        if (String(row[3] || '').trim() !== 'Agenda') continue;
        var item = agendaHistoricoItem_(row);
        if (!item) continue;
        // Lookahead elegível: o cursor exclui só a última linha DEVOLVIDA.
        // Assim, o próximo item não se perde e nunca há página intermediária vazia.
        if (result.rows.length === 40) {
          result.hasMore = true;
          result.nextBefore = lastReturned;
          return result;
        }
        result.rows.push(item);
        lastReturned = physicalRow;
      }
      offset = finish;
    }
    return result;
  });
}

function agendaHistoricoItem_(row) {
  var action = String(row[4] || '').trim();
  var actions = {
    criarAgendaEventoConcluido: 'Criação do agendamento',
    atualizarAgendaEventoCompleto: 'Alteração do agendamento',
    cancelarAgendaEvento: 'Cancelamento do agendamento',
    atualizarStatusRequisicaoAgenda: 'Atualização da requisição',
    atualizarStatusBackupAgenda: 'Atualização do backup',
    confirmarEntregaTransportePendencia: 'Confirmação da entrega',
    monitorarEntregasDhlAgendadas: 'Atualização automática da entrega',
    monitorarConfirmacoesCourierAgendadas: 'Confirmação automática do transporte',
    transporteMonitorarEnviosPorEmail: 'Atualização da documentação enviada',
    salvarTransporte: 'Atualização pela tela de Transporte',
    gerarPdfTransporte: 'Geração dos documentos de transporte',
    vincularBackupAoAgendamento: 'Vínculo do backup',
    vincularBackupAVisitaFutura: 'Vínculo do backup a outra visita',
    sincronizarBackupAwb: 'Sincronização da AWB do backup'
  };
  if (!Object.prototype.hasOwnProperty.call(actions, action)) return null;
  var field = String(row[6] || '').trim().replace(/^Transporte backup - /, 'Backup - ').replace(/ - Materiais$/, ' - Material').replace(/^Transporte ([123]) - /, function(_all, slot) {
    return 'Transporte ' + ({ '1': 'I', '2': 'II', '3': 'III' })[slot] + ' - ';
  });
  var fields = ['Agendamento', 'Data', 'Horário', 'Tipo de evento', 'Status', 'Protocolo', 'Visita',
    'Médico', 'Serviço terceirizado', 'Laboratório Central', 'Controle Lab Central', 'Sala/local',
    'Monitor', 'Carro requerido', 'Kit', 'Status Requisição', 'Polo Trial concluído', 'eCRF concluída',
    'Monitoria', 'SIV', 'Auditoria', 'Close-out', 'Backup - Agendamento', 'Backup - AWB do agendamento vinculado'];
  var transport = /^(Transporte (I|II|III)|Backup) - (Courier|Temperatura|Status|AWB|Material|Materiais estruturados|Destino)$/.test(field);
  var identity = ['Participante', 'Número de identificação', 'ID Cadastro Participante'].indexOf(field) >= 0;
  if (!identity && !transport && fields.indexOf(field) < 0) return null;
  // Não expor notas técnicas, nascimento, identidades anteriores ou JSON bruto.
  var item = {
    timestamp: agendaHistoricoData_(row[1]), email: String(row[2] || '').slice(0, 160),
    action: actions[action], field: identity ? 'Vínculo do participante' : field,
    oldValue: '', newValue: '', summary: ''
  };
  if (identity) item.summary = 'Vínculo do participante alterado.';
  else if (field === 'Backup - Agendamento') item.summary = 'Vínculo do backup alterado.';
  else if (/ - Materiais estruturados$/.test(field)) item.summary = 'Detalhes dos materiais foram atualizados.';
  else if (/^\s*[\[{]/.test(String(row[7] || '')) || /^\s*[\[{]/.test(String(row[8] || ''))) {
    item.summary = 'Detalhes registrados foram alterados.';
  } else {
    item.oldValue = String(row[7] == null ? '' : row[7]).slice(0, 500);
    item.newValue = String(row[8] == null ? '' : row[8]).slice(0, 500);
  }
  // Esta ação é gravada no ID da ORIGEM, mas os campos Transporte I/II/III
  // descrevem o DESTINO do backup. Explicitar isso, sem atribuí-los à visita atual.
  if (action === 'vincularBackupAVisitaFutura' && /^Transporte /.test(field)) {
    item.field = 'Agendamento de destino · ' + field;
  }
  item.field = item.field.replace(/Materiais estruturados$/, 'Detalhes dos materiais');
  return item;
}

function agendaHistoricoData_(value) {
  var date = value instanceof Date ? value : null;
  var text = String(value || '').trim();
  if (!date && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) date = new Date(text);
  if (date && !isNaN(date.getTime())) return Utilities.formatDate(date, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
  // Datas textuais legadas são exibidas como registradas; não inferir hora ausente.
  return /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$/.test(text) ? text : 'Data não disponível';
}
