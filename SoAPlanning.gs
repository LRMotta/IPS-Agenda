/* Versioned AI extraction intake. Raw documents are immutable; executable v1 is deliberately narrow. */
var SOA_PLANNING_SHEET_ = 'SoA_Planejamentos';
function soaPlanningHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function soaPlanningObject_(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function soaPlanningTimingEqual_(a, b) {
  var keys = Object.keys(a).concat(Object.keys(b));
  return keys.every(function(key) { return a[key] === b[key]; });
}
function soaPlanningProjects_() {
  // Identity only: a preview does not need participant statistics, SIV or other project details.
  return (getCodexSheetDataByName_('Projetos') || []).slice(1).filter(function(row) {
    return row[0];
  }).map(function(row) {
    return { id: String(row[0]), nomeAbreviado: String(row[1] || ''), codigo: String(row[2] || '') };
  });
}
function soaPlanningDocument_(payload) {
  var parsed = soaImportParsePayload_(payload);
  var raw = JSON.stringify(parsed.dados);
  if (raw.length > 300000) throw new Error('O planejamento excede 300.000 caracteres.');
  if (!soaPlanningObject_(parsed.dados)) throw new Error('Informe um objeto de planejamento.');
  parsed.raw = raw;
  return parsed;
}
function soaPlanningObservation_(note, scheduling) {
  if (!scheduling) return note;
  var suffix = '\nProgramação: ' + (scheduling.mode === 'milestone' ? 'marco pela própria visita realizada. ' : 'manual, sem previsão automática. ') + scheduling.reason;
  return String(note || '').split('\n').indexOf(suffix.trim()) >= 0 ? note : String(note || '') + suffix;
}
function soaPlanningSourceValid_(source) {
  return soaPlanningObject_(source) && typeof source.file === 'string' && !!source.file.trim() &&
    Number.isSafeInteger(source.printed_page) && source.printed_page > 0 && typeof source.section === 'string' && !!source.section.trim();
}
function soaPlanningPrepare_(payload) {
  var p = soaPlanningDocument_(payload), d = p.dados, issues = [], errors = [];
  var catalog = d.schema === 'ips-agenda-study-planning' && d.schema_version === '1.1.0';
  function issue(id, message, structural) { issues.push({ id: id, message: message, blocking: true }); if (structural) errors.push(message); }
  function notice(id, message) { issues.push({ id: id, message: message, blocking: false }); }
  function keys(obj, allowed, path) { Object.keys(obj).forEach(function(k) { if (allowed.indexOf(k) < 0) issue(path + '.' + k, 'Campo não suportado: ' + path + '.' + k + '. Preservado no rascunho.'); }); }
  var poc = d.schema === 'ips-agenda-study-planning-poc';
  if (!poc && d.schema !== 'ips-agenda-study-planning') issue('schema', 'Formato de planejamento não suportado.', true);
  if (!catalog && d.schema_version !== (poc ? '0.1.0' : '1.0.0')) issue('version', 'Versão de planejamento não suportada.', true);
  if (!soaPlanningObject_(d.study) || typeof d.study.protocol_id !== 'string' || !d.study.protocol_id.trim() || typeof d.study.protocol_version !== 'string' || !d.study.protocol_version.trim()) issue('study', 'Informe identificação e versão do protocolo.', true);
  if (soaPlanningObject_(d.study)) keys(d.study, ['protocol_id','protocol_version','sponsor','budget_version','metadata'], 'study');
  if (d.import_mode !== undefined && ['preview_only', 'review'].indexOf(d.import_mode) < 0) issue('mode', 'Modo de importação inválido.', true);
  if (d.approved_for_clinical_scheduling !== undefined && typeof d.approved_for_clinical_scheduling !== 'boolean') issue('approval', 'Indicador de aprovação inválido.', true);
  if (poc || d.import_mode === 'preview_only') issue('draft', 'Este documento permite somente prévia e rascunho.');
  if (!Array.isArray(d.rules)) issue('rules', 'Informe rules como lista, mesmo quando vazia.', true);
  var rules = Array.isArray(d.rules) ? d.rules : [];
  var timingRules = Object.create(null), ruleIds = Object.create(null);
  var anchorReferences = { randomization_date: 'RANDOMIZACAO', inclusion_date: 'INCLUSAO', last_dose: 'ULTIMA_DOSE', end_of_treatment_date: 'FIM_TRATAMENTO', decision_to_permanently_discontinue: 'DECISAO_INTERRUPCAO_TRATAMENTO', progression_date: 'PROGRESSAO_DOENCA' };
  rules.forEach(function(r, i) {
    if (!soaPlanningObject_(r)) { issue('rule-object-' + i, 'Regra inválida.', true); return; }
    if (ruleIds[r.id]) issue('rule-duplicate-' + i, 'Regra duplicada.', true);
    ruleIds[r.id] = true;
    if (catalog && r.handling === 'manual') {
      keys(r, ['id','kind','source','status','description','name','note','metadata','handling','reason','visit_ids','scope'], 'rules.' + i);
      var linked = Array.isArray(r.visit_ids) && r.visit_ids.length && r.visit_ids.every(function(id) {
        return (Array.isArray(d.visits) ? d.visits : []).some(function(v) {
          return v && v.id === id && v.scheduling && ['manual','milestone'].indexOf(v.scheduling.mode) >= 0;
        });
      });
      // Dose checks are not scheduling instructions: the SoA engine never administers treatment.
      var administration = r.scope === 'administration' && r.kind === 'minimum_interval' &&
        Array.isArray(r.visit_ids) && r.visit_ids.length && r.visit_ids.every(function(id) {
          return (Array.isArray(d.visits) ? d.visits : []).some(function(v) { return v && v.id === id; });
        });
      if (!soaPlanningSourceValid_(r.source) || typeof r.description !== 'string' || !r.description.trim() ||
          typeof r.reason !== 'string' || !r.reason.trim() || r.status !== 'requires_review' || (!linked && !administration)) {
        issue('manual-rule-' + i, 'A regra manual exige fonte, explicação e visitas por decisão manual: ' + (r.name || r.id || i) + '.');
      } else notice('manual-rule-' + i, 'Conferência manual preservada: ' + (r.name || r.id) + '. ' + r.reason);
      return;
    }
    if (r.kind !== 'visit_timing' || r.status !== 'extracted' || !soaPlanningObject_(r.timing) || !soaPlanningObject_(r.source)) { issue('rules-review-' + i, 'Regra exige revisão: ' + (r.id || i) + '. Recorrências e condições permanecem no rascunho.'); return; }
    keys(r, ['id','kind','timing','source','status','note','metadata'], 'rules.' + i);
    if (timingRules[r.id]) issue('rule-duplicate-' + i, 'Regra duplicada.', true);
    timingRules[r.id] = r;
  });
  rules.forEach(function(r, i) { if (!soaPlanningObject_(r) || typeof r.id !== 'string' || !r.id.trim()) issue('rule-' + i, 'Regra sem identificação válida.', true); });
  if (/^\s*=/.test(p.projeto)) issue('project-formula', 'Identificação do projeto inválida.', true);
  var projects = soaPlanningProjects_();
  var selected = projects.filter(function(x) { return normText_(x.nomeAbreviado) === normText_(p.projeto); });
  if (selected.length !== 1 || !d.study || ![selected[0].codigo, selected[0].nomeAbreviado].some(function(x) { return x && normText_(x) === normText_(d.study.protocol_id); })) issue('project', 'A identificação do protocolo não corresponde ao projeto selecionado.');
  var existingArms = getBracosProjeto(p.projeto), existingVisits = getSoAVisitasProjeto(p.projeto);
  var arms = Array.isArray(d.arms) ? d.arms : [], visits = Array.isArray(d.visits) ? d.visits : [], armMap = Object.create(null), ids = Object.create(null), missing = [];
  if (!poc) {
    keys(d, ['schema','schema_version','import_mode','approved_for_clinical_scheduling','study','arms','visits','rules','metadata'], 'document');
    if (!Array.isArray(d.arms) || !Array.isArray(d.visits)) issue('collections', 'Informe listas de braços e visitas.', true);
  }
  if (!visits.length) issue('visits', 'O documento ainda não contém visitas para aplicação.');
  arms.forEach(function(a, i) {
    if (!soaPlanningObject_(a) || typeof a.id !== 'string' || !a.id.trim() || typeof a.name !== 'string' || !a.name.trim()) { issue('arm-' + i, 'Braço sem ID ou nome válido.', true); return; }
    if (/^\s*=/.test(a.name)) issue('arm-formula-' + i, 'Nome de braço não pode iniciar uma fórmula.');
    keys(a, ['id','name','metadata'], 'arms.' + a.id);
    if (armMap[a.id] || arms.some(function(other, n) { return n < i && normText_(other && other.name) === normText_(a.name); })) issue('arm-duplicate-' + i, 'Braços duplicados.', true);
    var matches = existingArms.filter(function(x) { return normText_(x.nome) === normText_(a.name); });
    if (matches.length > 1 || (matches.length && matches[0].ativo === false)) issue('arm-match-' + i, 'Braço ambíguo ou inativo: ' + a.name);
    armMap[a.id] = matches.length ? matches[0].idBraco : 'BRACO-PLAN-' + soaPlanningHash_(p.projeto + '|' + a.id).slice(0, 24);
    if (!matches.length) missing.push(a.name);
  });
  arms.forEach(function(a,i) { if (a && !visits.some(function(v) { return v && Array.isArray(v.arm_ids) && (!v.arm_ids.length || v.arm_ids.indexOf(a.id) >= 0); })) issue('unused-arm-' + i, 'Braço sem visita vinculada.'); });
  if (missing.length && !p.criarBracos) issue('missing-arms', 'Autorize criar os braços ausentes: ' + missing.join(', '));
  visits = visits.map(function(original) {
    if (!soaPlanningObject_(original)) return original;
    var v = JSON.parse(JSON.stringify(original));
    if (v.rule_ids !== undefined) {
      if (!Array.isArray(v.rule_ids) || v.rule_ids.length > 1 || v.rule_ids.some(function(id) { return typeof id !== 'string' || !timingRules[id]; })) issue('rule-link-' + v.id, 'Informe no máximo uma regra temporal suportada por visita.');
      else if (v.rule_ids.length) {
        var rule = timingRules[v.rule_ids[0]];
        if (v.timing && !soaPlanningTimingEqual_(v.timing, rule.timing)) issue('rule-conflict-' + v.id, 'A regra e a visita apresentam tempos diferentes.');
        v.timing = v.timing || rule.timing;
        v.source = v.source || rule.source;
      }
    }
    return v;
  });
  rules.forEach(function(r,i) { if (r && timingRules[r.id] && !visits.some(function(v) { return v && Array.isArray(v.rule_ids) && v.rule_ids.indexOf(r.id) >= 0; })) issue('unused-rule-' + i, 'Regra temporal sem visita vinculada.'); });
  var normalized = [];
  visits.forEach(function(v, i) {
    if (!soaPlanningObject_(v)) { issue('visit-' + i, 'Visita inválida.', true); return; }
    keys(v, ['id','code','name','arm_ids','order','aliases','timing','source','status','note','rule_ids','metadata'].concat(catalog ? ['scheduling'] : []), 'visits.' + i);
    ['id','code','name'].forEach(function(k) { if (typeof v[k] !== 'string' || !v[k].trim()) issue('visit-' + i + k, 'Visita exige ' + k + '.', true); });
    if (ids[v.id]) issue('duplicate-' + i, 'ID de visita duplicado.', true);
    if (!Array.isArray(v.arm_ids) || v.arm_ids.some(function(id) { return typeof id !== 'string' || !armMap[id]; }) || new Set(Array.isArray(v.arm_ids) ? v.arm_ids : []).size !== (Array.isArray(v.arm_ids) ? v.arm_ids : []).length) issue('scope-' + i, 'Braços da visita ausentes, duplicados ou desconhecidos.', true);
    var t = soaPlanningObject_(v.timing) ? v.timing : {};
    if (catalog && v.timing !== undefined && !soaPlanningObject_(v.timing)) issue('timing-object-' + i, 'Informe os dados de prazo como objeto.', true);
    var scheduling = catalog && soaPlanningObject_(v.scheduling) ? v.scheduling : {};
    var schedulingMode = scheduling.mode === undefined ? 'calculated' : scheduling.mode;
    var manual = catalog && ['manual','milestone'].indexOf(schedulingMode) >= 0;
    if (catalog) {
      if (v.scheduling !== undefined && !soaPlanningObject_(v.scheduling)) issue('scheduling-' + i, 'Modo de programação inválido.', true);
      keys(scheduling, ['mode','reason'], 'scheduling.' + i);
      if (['manual','milestone','calculated'].indexOf(schedulingMode) < 0) issue('scheduling-mode-' + i, 'Modo de programação não suportado.');
      if (manual && (typeof scheduling.reason !== 'string' || !scheduling.reason.trim())) issue('scheduling-reason-' + i, 'Explique como programar a visita ' + (v.code || i) + ' manualmente.');
      if (manual && (v.rule_ids || []).length) issue('manual-timing-rule-' + i, 'Uma visita manual não pode executar regra temporal compartilhada.');
      if (manual && v.status !== 'extracted' && v.status !== 'requires_review') issue('manual-status-' + i, 'Estado de revisão inválido para ' + (v.code || i) + '.');
      if (schedulingMode === 'milestone' && Object.keys(t).length) issue('milestone-timing-' + i, 'O marco usa a própria data realizada, sem deslocamento ou tolerância presumidos.');
    }
    keys(t, ['anchor','anchor_visit_id','offset_days','window_before_days','window_after_days','basis'], 'timing.' + i);
    if (!manual) {
    ['offset_days','window_before_days','window_after_days'].forEach(function(k) { if (typeof t[k] !== 'number' || !Number.isSafeInteger(t[k]) || t[k] < 0) issue('timing-' + i + k, 'Visita exige ' + k + ' inteiro não negativo.', t[k] !== undefined && t[k] !== null); });
    if (['planned','performed'].indexOf(t.basis) < 0) issue('basis-' + i, 'Informe se a referência usa a data prevista ou realizada.');
    if (t.anchor !== 'visit' && !Object.prototype.hasOwnProperty.call(anchorReferences, t.anchor)) issue('anchor-' + i, 'Referência temporal ausente ou não suportada.');
    if (t.anchor !== 'visit' && t.anchor_visit_id !== undefined) issue('extra-anchor-' + i, 'Referência de visita incompatível com o marco.');
    if (v.status !== 'extracted') issue('review-' + i, 'Visita exige revisão: ' + (v.name || i));
    } else {
      ['offset_days','window_before_days','window_after_days'].forEach(function(k) {
        if (t[k] !== undefined && t[k] !== null && (typeof t[k] !== 'number' || !Number.isSafeInteger(t[k]) || t[k] < 0)) issue('manual-timing-' + i + k, 'Valor documental inválido em ' + (v.code || i) + '.', true);
      });
      notice('manual-visit-' + i, (schedulingMode === 'milestone' ? 'Marco inicial: ' : 'Programação manual: ') + (v.code || i) + '. ' + scheduling.reason);
    }
    if (!soaPlanningObject_(v.source) || typeof v.source.file !== 'string' || !v.source.file.trim() || typeof v.source.printed_page !== 'number' || !isFinite(v.source.printed_page) || v.source.printed_page < 1 || Math.floor(v.source.printed_page) !== v.source.printed_page || typeof v.source.section !== 'string' || !v.source.section.trim()) issue('source-' + i, 'Visita exige documento, página e seção da fonte.');
    if (typeof v.order !== 'number' || !isFinite(v.order) || v.order < 0 || Math.floor(v.order) !== v.order) issue('order-' + i, 'Ordem da visita inválida.', v.order !== undefined);
    if (v.aliases !== undefined && (!Array.isArray(v.aliases) || v.aliases.some(function(x) { return typeof x !== 'string'; }))) issue('aliases-' + i, 'Aliases devem ser uma lista de textos.', true);
    if (v.note !== undefined && typeof v.note !== 'string') issue('note-' + i, 'Observação inválida.', true);
    var bracoIds = (Array.isArray(v.arm_ids) ? v.arm_ids : []).map(function(id) { return armMap[id] || ''; }).sort();
    var matches = existingVisits.filter(function(x) { return normText_(x.codigo) === normText_(v.code) && soaArmSignature_(x.bracoIds) === soaArmSignature_(bracoIds); });
    if (matches.length > 1) issue('match-' + i, 'Há mais de uma visita cadastrada com o mesmo código e braços.');
    if (matches[0] && p.modo === 'atualizar' && (matches[0].referenciaAlternativa || matches[0].criterioReferencias || matches[0].repeticao)) issue('existing-complex-' + i, 'A visita ' + v.code + ' já possui repetição ou referências alternativas. Revise esse cadastro antes de substituir sua regra.');
    if (normalized.some(function(x) { return normText_(x.codigo) === normText_(v.code) && soaArmSignature_(x.bracoIds) === soaArmSignature_(bracoIds); })) issue('code-' + i, 'Código e braços repetidos no documento.', true);
    if ([v.code,v.name,v.note].concat(Array.isArray(v.aliases) ? v.aliases : []).some(function(value) { return typeof value === 'string' && /^\s*=/.test(value); })) issue('formula-' + i, 'Texto de visita não pode iniciar uma fórmula.');
    var id = matches.length ? matches[0].idSoA : 'SOA-PLAN-' + soaPlanningHash_(p.projeto + '|' + v.id + '|' + normText_(v.code) + '|' + soaArmSignature_(bracoIds)).slice(0, 24);
    if (existingVisits.some(function(x) { return x.idSoA === id && matches.indexOf(x) < 0; })) issue('id-conflict-' + i, 'Identificação de visita conflita com o catálogo.');
    ids[v.id] = id;
    var previous = matches[0] || {};
    normalized.push({
      idSoA: id, projeto: p.projeto, codigo: v.code || '', nome: v.name || '', ordem: v.order,
      intervaloDias: manual ? '' : t.offset_days, janelaDiasMenos: manual ? '' : t.window_before_days, janelaDiasMais: manual ? '' : t.window_after_days,
      bracoIds: bracoIds,
      bracoNomes: arms.filter(function(a) { return a && (Array.isArray(v.arm_ids) ? v.arm_ids : []).indexOf(a.id) >= 0; }).map(function(a) { return a.name; }),
      aliases: v.aliases === undefined ? soaDelimitedIds_(previous.aliases) : (Array.isArray(v.aliases) ? v.aliases : []),
      observacoes: soaPlanningObservation_(v.note === undefined ? String(previous.observacoes || '') : v.note, manual ? scheduling : null),
      source: v.source, repeticao: previous.repeticao || '', ativo: previous.ativo !== false,
      referencia: manual ? '' : (anchorReferences[t.anchor] || ''),
      baseCalculo: manual || !t.basis ? '' : (t.basis === 'performed' ? 'RECALCULAR_VISITA_REALIZADA' : 'MANTER_DATAS_PREVISTAS'),
      schedulingMode: manual ? schedulingMode : 'calculated', manualReason: manual ? scheduling.reason : '',
      papelCronograma: manual ? (schedulingMode === 'milestone' ? 'MARCO_CALCULO' : 'NAO_PARTICIPA_CALCULO') : 'VISITA_CALCULADA', referenciaAlternativa: previous.referenciaAlternativa || '',
      criterioReferencias: previous.criterioReferencias || '', existente: !!matches.length, ordemManual: !!previous.ordemManual
    });
  });
  visits.forEach(function(v, i) {
    if (!soaPlanningObject_(v) || (catalog && v.scheduling && v.scheduling.mode === 'manual') || !v.timing || v.timing.anchor !== 'visit') return;
    var target = visits.filter(function(x) { return x && x.id === v.timing.anchor_visit_id; })[0];
    if (!target || target === v || !Array.isArray(target.arm_ids) || !Array.isArray(v.arm_ids) || (target.arm_ids.length && (!v.arm_ids.length || v.arm_ids.some(function(a) { return target.arm_ids.indexOf(a) < 0; })))) issue('reference-' + i, 'Referência de visita ausente, circular ou incompatível com os braços.');
    if (normalized[i]) normalized[i].referencia = ids[v.timing.anchor_visit_id] || '';
    if (catalog && target && target.scheduling && target.scheduling.mode === 'manual') issue('manual-reference-' + i, 'Use um marco de cálculo, e não uma visita manual, como referência de ' + (v.code || i) + '.');
    var seen = Object.create(null), cursor = v;
    while (cursor && cursor.timing && cursor.timing.anchor === 'visit') { if (seen[cursor.id]) { issue('cycle-' + i, 'Há um ciclo nas referências de visitas.'); break; } seen[cursor.id] = true; cursor = visits.filter(function(x) { return x && x.id === cursor.timing.anchor_visit_id; })[0]; }
  });
  var fingerprint = soaPlanningHash_(JSON.stringify([p.raw,p.projeto,p.modo,p.criarBracos,selected,existingArms,existingVisits]));
  return {ok:!errors.length,projeto:p.projeto,modo:p.modo,criarBracos:p.criarBracos,missingBracos:missing,bracosExistentes:existingArms,erros:errors,alertas:issues.map(function(x) { return x.message; }),revisaoNecessaria:[],visitas:normalized,totalVisitas:visits.length,novasVisitas:normalized.filter(function(x) { return !x.existente; }).length,atualizacoes:p.modo === 'atualizar' ? normalized.filter(function(x) { return x.existente; }).length : 0,ignoradas:p.modo !== 'atualizar' ? normalized.filter(function(x) { return x.existente; }).length : 0,ordensManuaisPreservadas:normalized.filter(function(x) { return x.ordemManual; }).length,podeImportar:!issues.some(function(x) { return x.blocking; }),fingerprint:fingerprint,planejamento:{schema:d.schema,version:d.schema_version,study:d.study || {},rules:rules,issues:issues,draftOnly:!!(poc || d.import_mode === 'preview_only')}};
}
function soaPlanningSheet_(create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getSheetByName(SOA_PLANNING_SHEET_);
  if (!sheet && create) { sheet = ss.insertSheet(SOA_PLANNING_SHEET_); sheet.getRange(1,1,1,6).setValues([['ID','Projeto JSON','Data','Parte','Total','JSON fragmento']]); }
  return sheet;
}
function soaPlanningArchive_(payload) {
  var p = soaPlanningDocument_(payload), id = soaPlanningHash_(p.projeto + '\n' + p.raw), sheet = soaPlanningSheet_(false);
  var rows = sheet ? sheet.getDataRange().getValues() : [];
  if (rows.some(function(r) { return r[0] === id && r[1] === JSON.stringify(p.projeto); })) { carregarPlanejamentoSoA(p.projeto,id); return {ok:true,id:id}; }
  sheet = sheet || soaPlanningSheet_(true);
  var chunks = [], size = 20000, total = Math.ceil(p.raw.length / size), at = new Date().toISOString();
  for (var i = 0; i < total; i++) chunks.push([id,JSON.stringify(p.projeto),at,i,total,JSON.stringify(p.raw.slice(i*size,(i+1)*size))]);
  sheet.getRange(sheet.getLastRow()+1,1,chunks.length,6).setValues(chunks);
  return {ok:true,id:id};
}
function salvarPlanejamentoSoA(payload) {
  codexAssertCanWrite_('salvarPlanejamentoSoA','Cadastros',payload && payload.projeto || 'SoA');
  return codexWithDocumentLock_('salvarPlanejamentoSoA',function() { var prepared = soaPlanningPrepare_(payload); if (!prepared.ok) throw new Error(prepared.erros.join(' ')); return soaPlanningArchive_(payload); });
}
function listarPlanejamentosSoA(projeto) {
  codexAssertCanRead_();
  var sheet = soaPlanningSheet_(false);
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).filter(function(r) { return r[1] === JSON.stringify(String(projeto || '').trim()) && Number(r[3]) === 0; }).map(function(r) { return {id:String(r[0]),created_at:String(r[2]),label:'Planejamento ' + String(r[2])}; }).reverse();
}
function carregarPlanejamentoSoA(projeto,id) {
  codexAssertCanRead_();
  var sheet = soaPlanningSheet_(false), rows = sheet ? sheet.getDataRange().getValues().slice(1).filter(function(r) { return r[0] === id && r[1] === JSON.stringify(String(projeto || '').trim()); }) : [];
  rows.sort(function(a,b) { return Number(a[3])-Number(b[3]); });
  if (!rows.length || rows.length !== Number(rows[0][4]) || rows.some(function(r,i) { return Number(r[3]) !== i || Number(r[4]) !== rows.length; })) throw new Error('Rascunho ausente ou incompleto.');
  var raw = rows.map(function(r) { return JSON.parse(r[5]); }).join('');
  if (soaPlanningHash_(String(projeto || '').trim() + '\n' + raw) !== id) throw new Error('A integridade do rascunho não pôde ser confirmada.');
  return {dados:JSON.parse(raw),id:id};
}
function soaPlanningApply_(payload) {
  var prepared = soaPlanningPrepare_(payload);
  if (!prepared.ok || !prepared.podeImportar) throw new Error('Planejamento pendente: ' + prepared.alertas.join(' '));
  if (payload.confirmarRevisaoPlanejamento !== true || payload.fingerprintPlanejamento !== prepared.fingerprint) throw new Error('Valide novamente e confirme a revisão do planejamento antes de aplicar.');
  var archived = soaPlanningArchive_(payload);
  var created = soaCreateImportArms_(prepared.projeto,prepared.missingBracos);
  // Re-read the catalog after creation to resolve stable existing arm IDs.
  var final = soaPlanningPrepare_(payload);
  if (!final.podeImportar) throw new Error('O catálogo mudou durante a importação. Valide novamente.');
  final.visitas = final.visitas.filter(function(v) { return !v.existente || final.modo === 'atualizar'; });
  soaWriteImportRows_(final);
  return {ok:true,msg:'Calendário SoA importado e extração arquivada.',planejamentoId:archived.id,adicionadas:final.novasVisitas,atualizadas:final.atualizacoes,ignoradas:final.ignoradas,bracosCriados:created.length,ordensManuaisPreservadas:final.ordensManuaisPreservadas,alertas:[],revisaoNecessaria:[]};
}
