/**
 * Edicao explicita dos materiais de um envio, na preparacao do transporte.
 *
 * Os materiais vem do laboratorio e ficam bloqueados na tela; so esta RPC os altera, e grava na AGENDA
 * (campos Material e Material estruturado do slot), deixando auditoria (Audit_Changes) e uma nota visivel
 * junto ao material, dentro do JSON estruturado: { v: 1, items, ajuste: { por, em, anterior } }.
 * A sincronizacao automatica da Agenda (transporteSincronizarAgenda_) continua so preenchendo campos vazios.
 */
var TRANSPORTE_MATERIAIS_NOTA_ = 'Material ajustado na preparação do transporte';

function transporteMateriaisSlotAgenda_(slot) {
  slot = normalizarSlotTransporteCodex_(slot, true);
  if (slot === 'backup2') throw new Error('Edite o material do Backup II diretamente na Agenda.');
  var idx = { '1': AGENDA_CFG.idx.c1, '2': AGENDA_CFG.idx.c2, '3': AGENDA_CFG.idx.c3, '4': AGENDA_CFG.idx.c4, backup: AGENDA_CFG.idx.cb }[slot];
  if (!idx || idx.material === undefined || idx.matBio === undefined || idx.material < 0) throw new Error('Slot de transporte sem campo de material na Agenda.');
  return { slot: slot, idx: idx, rotulo: slot === 'backup' ? 'Backup' : 'Transporte ' + slot };
}

// Itens enviados pela tela -> { summary, json } validados pelas mesmas regras do restante do app.
function transporteMateriaisValidarEdicao_(courier, entrada) {
  if (!Array.isArray(entrada)) throw new Error('Materiais inválidos.');
  if (entrada.length > 8) throw new Error('Informe no máximo 8 materiais.');
  var vistos = {};
  var itens = entrada.map(function(bruto) {
    bruto = bruto || {};
    var cfg = codexMatBioTypeConfig_(bruto.material);
    if (!cfg || cfg.outro) throw new Error('Material não reconhecido: ' + String(bruto.material || '') + '.');
    if (vistos[cfg.key]) throw new Error('Material repetido: ' + cfg.label + '.');
    vistos[cfg.key] = true;
    return { ativo: true, material: cfg.label, formula: String(bruto.formula || '').trim(), ensaio: String(bruto.ensaio || '').trim() };
  });
  codexMatBioValidateTransportPayload_({ courier: courier, materiais: itens });
  return transporteMateriaisParaAgenda_(itens);
}

function transporteMateriaisJsonComAjuste_(json, ajuste) {
  var base = json ? JSON.parse(json) : { v: 1, items: [] };
  base.ajuste = ajuste;
  return JSON.stringify(base);
}

// Mesmos itens, ignorando a nota: so o conteudo decide se houve alteracao.
function transporteMateriaisItensDoJson_(json) {
  try { return JSON.stringify((JSON.parse(String(json || '')) || {}).items || []); } catch (erro) { return ''; }
}

/**
 * RPC "Editar materiais". versao: a do registro na tela. materiais: [{ material, formula ('2x1,5'), ensaio }].
 * Exige o preparo do envio, grava na Agenda com auditoria e atualiza o registro do envio.
 */
function editarMateriaisTransporteEnvio(agendaId, slot, versao, materiais) {
  var access = codexAssertAdmin_();
  var usuario = transporteEnvioUsuario_(access);
  var alvo = transporteMateriaisSlotAgenda_(slot);
  return codexWithDocumentLock_('editarMateriaisTransporteEnvio', function() {
    var agora = new Date();
    var atual = transporteEnvioConferirDono_(agendaId, alvo.slot, usuario, agora);
    if (atual.versao !== Number(versao)) throw transporteRegistroErro_('TRANSPORTE_REGISTRO_VERSAO', 'Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.');
    var registro = JSON.parse(JSON.stringify(atual.registro));
    var novo = transporteMateriaisValidarEdicao_(registro.courier, materiais);
    var agenda = getAgendaSheet_();
    var linha = encontrarLinhaPorId(agenda, agendaId);
    if (!linha) throw new Error('Agendamento não encontrado para editar o material.');
    var idx = alvo.idx;
    var celulas = [agenda.getRange(linha, idx.material + 1).getValue(), agenda.getRange(linha, idx.matBio + 1).getValue()];
    var resumoAnterior = String(celulas[0] || '').trim();
    var jsonAnterior = String(celulas[1] || '').trim();
    if (transporteMateriaisItensDoJson_(jsonAnterior) === transporteMateriaisItensDoJson_(novo.json) && resumoAnterior === novo.summary) {
      return { ok: true, alterado: false, versao: atual.versao, registro: registro };
    }
    var ajuste = { por: usuario, em: agora.toISOString(), anterior: resumoAnterior || 'Nenhum material informado' };
    var jsonNovo = transporteMateriaisJsonComAjuste_(novo.json, ajuste);
    agenda.getRange(linha, idx.material + 1).setValue(novo.summary);
    agenda.getRange(linha, idx.matBio + 1).setValue(jsonNovo);
    codexWriteAuditChanges_('Agenda', 'editarMateriaisTransporte', agendaId, [
      { field: alvo.rotulo + ' - Materiais', oldValue: resumoAnterior, newValue: novo.summary },
      { field: alvo.rotulo + ' - Materiais estruturados', oldValue: jsonAnterior, newValue: jsonNovo }
    ], TRANSPORTE_MATERIAIS_NOTA_);
    if (typeof agendaInvalidateWindowCache_ === 'function') agendaInvalidateWindowCache_();
    registro.materiais = transporteMateriaisFromCodex_(transporteNormalizeCourierFromCodex_(registro.courier), jsonNovo, novo.summary);
    var gravado = transporteRegistroGravar_(agendaId, alvo.slot, registro, { versaoEsperada: atual.versao, usuario: usuario, agora: agora });
    return { ok: true, alterado: true, versao: gravado.versao, registro: registro, ajuste: ajuste };
  });
}
