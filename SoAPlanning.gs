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
  if (parsed.dados.schema === SOA_POLO_SCHEMA_) {
    // The extract stays archived as received; validation runs on its catalog conversion.
    parsed.polo = soaPoloPlanning_(parsed.dados, parsed.projeto, parsed.braco);
    parsed.dados = parsed.polo.documento;
  }
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
  var p = soaPlanningDocument_(payload), d = p.dados, issues = [], errors = [], polo = !!p.polo;
  var catalog = d.schema === 'ips-agenda-study-planning' && d.schema_version === '1.1.0';
  function issue(id, message, structural) { issues.push({ id: id, message: message, blocking: true }); if (structural) errors.push(message); }
  function notice(id, message) { issues.push({ id: id, message: message, blocking: false }); }
  function keys(obj, allowed, path) { Object.keys(obj).forEach(function(k) { if (allowed.indexOf(k) < 0) issue(path + '.' + k, 'Campo não suportado: ' + path + '.' + k + '. Preservado no rascunho.'); }); }
  var poc = d.schema === 'ips-agenda-study-planning-poc';
  if (polo) p.polo.issues.forEach(function(item) { issue(item.id, item.message); });
  if (!poc && d.schema !== 'ips-agenda-study-planning') issue('schema', 'Formato de planejamento não suportado.', true);
  if (!catalog && d.schema_version !== (poc ? '0.1.0' : '1.0.0')) issue('version', 'Versão de planejamento não suportada.', true);
  if (!soaPlanningObject_(d.study) || typeof d.study.protocol_id !== 'string' || !d.study.protocol_id.trim() || typeof d.study.protocol_version !== 'string' || !d.study.protocol_version.trim()) issue('study', 'Informe identificação e versão do protocolo.', true);
  if (soaPlanningObject_(d.study)) keys(d.study, ['protocol_id','protocol_version','sponsor','budget_version','metadata'], 'study');
  if (d.import_mode !== undefined && ['preview_only', 'review'].indexOf(d.import_mode) < 0) issue('mode', 'Modo de importação inválido.', true);
  if (d.approved_for_clinical_scheduling !== undefined && typeof d.approved_for_clinical_scheduling !== 'boolean') issue('approval', 'Indicador de aprovação inválido.', true);
  if (poc || d.import_mode === 'preview_only') issue('draft', 'Este documento permite somente prévia e rascunho.');
  if (!Array.isArray(d.rules)) issue('rules', 'Informe rules como lista, mesmo quando vazia.', true);
  var rules = Array.isArray(d.rules) ? d.rules : [];
  var timingRules = Object.create(null), manualRules = Object.create(null), ruleIds = Object.create(null);
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
      } else {
        manualRules[r.id] = r;
        notice('manual-rule-' + i, 'Conferência manual preservada: ' + (r.name || r.id) + '. ' + r.reason);
      }
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
      var timingIds = Array.isArray(v.rule_ids) ? v.rule_ids.filter(function(id) { return typeof id === 'string' && timingRules[id]; }) : [];
      if (!Array.isArray(v.rule_ids) || timingIds.length > 1 || v.rule_ids.some(function(id) {
        return typeof id !== 'string' || (!timingRules[id] && !(manualRules[id] && manualRules[id].visit_ids.indexOf(v.id) >= 0));
      })) issue('rule-link-' + v.id, 'Informe regras válidas e no máximo uma regra temporal suportada por visita.');
      else if (timingIds.length) {
        var rule = timingRules[timingIds[0]];
        if (v.timing && !soaPlanningTimingEqual_(v.timing, rule.timing)) issue('rule-conflict-' + v.id, 'A regra e a visita apresentam tempos diferentes.');
        v.timing = v.timing || rule.timing;
        v.source = v.source || rule.source;
      }
    }
    return v;
  });
  rules.forEach(function(r,i) { if (r && timingRules[r.id] && !visits.some(function(v) { return v && Array.isArray(v.rule_ids) && v.rule_ids.indexOf(r.id) >= 0; })) issue('unused-rule-' + i, 'Regra temporal sem visita vinculada.'); });
  var normalized = [], normalizedByIndex = [];
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
      if (manual && Array.isArray(v.rule_ids) && v.rule_ids.some(function(id) { return timingRules[id]; })) issue('manual-timing-rule-' + i, 'Uma visita manual não pode executar regra temporal compartilhada.');
      if (manual && v.status !== 'extracted' && v.status !== 'requires_review') issue('manual-status-' + i, 'Estado de revisão inválido para ' + (v.code || i) + '.');
      if (schedulingMode === 'milestone' && Object.keys(t).length) issue('milestone-timing-' + i, 'O marco usa a própria data realizada, sem deslocamento ou tolerância presumidos.');
    }
    keys(t, ['anchor','anchor_visit_id','offset_days','window_before_days','window_after_days','basis'], 'timing.' + i);
    if (!manual) {
    ['offset_days','window_before_days','window_after_days'].forEach(function(k) { if (typeof t[k] !== 'number' || !Number.isSafeInteger(t[k]) || t[k] < 0) issue('timing-' + i + k, 'Visita exige ' + k + ' inteiro não negativo.', t[k] !== undefined && t[k] !== null); });
    if (!polo && ['planned','performed'].indexOf(t.basis) < 0) issue('basis-' + i, 'Informe se a referência usa a data prevista ou realizada.');
    if (t.anchor !== 'visit' && !Object.prototype.hasOwnProperty.call(anchorReferences, t.anchor)) issue('anchor-' + i, 'Referência temporal ausente ou não suportada.');
    if (t.anchor !== 'visit' && t.anchor_visit_id !== undefined) issue('extra-anchor-' + i, 'Referência de visita incompatível com o marco.');
    if (v.status !== 'extracted') issue('review-' + i, 'Visita exige revisão: ' + (v.name || i));
    } else {
      ['offset_days','window_before_days','window_after_days'].forEach(function(k) {
        if (t[k] !== undefined && t[k] !== null && (typeof t[k] !== 'number' || !Number.isSafeInteger(t[k]) || t[k] < 0)) issue('manual-timing-' + i + k, 'Valor documental inválido em ' + (v.code || i) + '.', true);
      });
      notice('manual-visit-' + i, (schedulingMode === 'milestone' ? 'Marco inicial: ' : 'Programação manual: ') + (v.code || i) + '. ' + scheduling.reason);
    }
    if (!polo && (!soaPlanningObject_(v.source) || typeof v.source.file !== 'string' || !v.source.file.trim() || typeof v.source.printed_page !== 'number' || !isFinite(v.source.printed_page) || v.source.printed_page < 1 || Math.floor(v.source.printed_page) !== v.source.printed_page || typeof v.source.section !== 'string' || !v.source.section.trim())) issue('source-' + i, 'Visita exige documento, página e seção da fonte.');
    if (typeof v.order !== 'number' || !isFinite(v.order) || v.order < 0 || Math.floor(v.order) !== v.order) issue('order-' + i, 'Ordem da visita inválida.', v.order !== undefined);
    if (v.aliases !== undefined && (!Array.isArray(v.aliases) || v.aliases.some(function(x) { return typeof x !== 'string'; }))) issue('aliases-' + i, 'Aliases devem ser uma lista de textos.', true);
    if (v.note !== undefined && typeof v.note !== 'string') issue('note-' + i, 'Observação inválida.', true);
    var bracoIds = (Array.isArray(v.arm_ids) ? v.arm_ids : []).map(function(id) { return armMap[id] || ''; }).sort();
    var matches = polo ? soaPoloExistingMatches_(v, bracoIds, existingVisits) : existingVisits.filter(function(x) { return normText_(x.codigo) === normText_(v.code) && soaArmSignature_(x.bracoIds) === soaArmSignature_(bracoIds); });
    // A Polo export has no stable IDs: an existing visit keeps its identity and arm scope.
    var kept = polo && matches.length === 1 ? matches[0] : null;
    var visitCode = kept ? kept.codigo : v.code;
    if (kept) bracoIds = soaUniqueIds_(kept.bracoIds).sort();
    if (matches.length > 1) issue('match-' + i, 'Há mais de uma visita cadastrada com o mesmo código e braços.');
    if (matches[0] && p.modo === 'atualizar' && (matches[0].referenciaAlternativa || matches[0].criterioReferencias || matches[0].repeticao)) issue('existing-complex-' + i, 'A visita ' + v.code + ' já possui repetição ou referências alternativas. Revise esse cadastro antes de substituir sua regra.');
    if (normalized.some(function(x) { return normText_(x.codigo) === normText_(visitCode) && soaArmSignature_(x.bracoIds) === soaArmSignature_(bracoIds); })) issue('code-' + i, 'Código e braços repetidos no documento.', true);
    if ([v.code,v.name,v.note].concat(Array.isArray(v.aliases) ? v.aliases : []).some(function(value) { return typeof value === 'string' && /^\s*=/.test(value); })) issue('formula-' + i, 'Texto de visita não pode iniciar uma fórmula.');
    var id = matches.length ? matches[0].idSoA : 'SOA-PLAN-' + soaPlanningHash_(p.projeto + '|' + v.id + '|' + normText_(v.code) + '|' + soaArmSignature_(bracoIds)).slice(0, 24);
    if (existingVisits.some(function(x) { return x.idSoA === id && matches.indexOf(x) < 0; })) issue('id-conflict-' + i, 'Identificação de visita conflita com o catálogo.');
    ids[v.id] = id;
    var previous = matches[0] || {};
    normalized.push({
      idSoA: id, projeto: p.projeto, codigo: visitCode || '', nome: kept ? kept.nome : (v.name || ''), ordem: v.order,
      intervaloDias: manual ? '' : t.offset_days, janelaDiasMenos: manual ? '' : t.window_before_days, janelaDiasMais: manual ? '' : t.window_after_days,
      bracoIds: bracoIds,
      bracoNomes: bracoIds.length ? arms.filter(function(a) { return a && (Array.isArray(v.arm_ids) ? v.arm_ids : []).indexOf(a.id) >= 0; }).map(function(a) { return a.name; }) : [],
      aliases: kept ? soaUniqueIds_(soaDelimitedIds_(kept.aliases).concat(v.aliases || [])) : (v.aliases === undefined ? soaDelimitedIds_(previous.aliases) : (Array.isArray(v.aliases) ? v.aliases : [])),
      observacoes: soaPlanningObservation_(v.note === undefined ? String(previous.observacoes || '') : v.note, manual ? scheduling : null),
      source: v.source, repeticao: previous.repeticao || '', ativo: previous.ativo !== false,
      referencia: manual ? '' : (anchorReferences[t.anchor] || ''),
      baseCalculo: polo ? String(previous.baseCalculo || '') : (manual || !t.basis ? '' : (t.basis === 'performed' ? 'RECALCULAR_VISITA_REALIZADA' : 'MANTER_DATAS_PREVISTAS')),
      schedulingMode: manual ? schedulingMode : 'calculated', manualReason: manual ? scheduling.reason : '',
      papelCronograma: manual ? (schedulingMode === 'milestone' ? 'MARCO_CALCULO' : 'NAO_PARTICIPA_CALCULO') : 'VISITA_CALCULADA', referenciaAlternativa: previous.referenciaAlternativa || '',
      criterioReferencias: previous.criterioReferencias || '', existente: !!matches.length, ordemManual: !!previous.ordemManual
    });
    normalizedByIndex[i] = normalized[normalized.length - 1];
  });
  visits.forEach(function(v, i) {
    if (!soaPlanningObject_(v) || (catalog && v.scheduling && v.scheduling.mode === 'manual') || !v.timing || v.timing.anchor !== 'visit') return;
    var target = visits.filter(function(x) { return x && x.id === v.timing.anchor_visit_id; })[0];
    if (!target || target === v || !Array.isArray(target.arm_ids) || !Array.isArray(v.arm_ids) || (target.arm_ids.length && (!v.arm_ids.length || v.arm_ids.some(function(a) { return target.arm_ids.indexOf(a) < 0; })))) issue('reference-' + i, 'Referência de visita ausente, circular ou incompatível com os braços.');
    if (normalizedByIndex[i]) normalizedByIndex[i].referencia = ids[v.timing.anchor_visit_id] || '';
    if (catalog && target && target.scheduling && target.scheduling.mode === 'manual') issue('manual-reference-' + i, 'Use um marco de cálculo, e não uma visita manual, como referência de ' + (v.code || i) + '.');
    var seen = Object.create(null), cursor = v;
    while (cursor && cursor.timing && cursor.timing.anchor === 'visit') { if (seen[cursor.id]) { issue('cycle-' + i, 'Há um ciclo nas referências de visitas.'); break; } seen[cursor.id] = true; cursor = visits.filter(function(x) { return x && x.id === cursor.timing.anchor_visit_id; })[0]; }
  });
  if (polo) {
    // The export never states this rule, so visits inherit the project's reviewed default.
    if (normalized.some(function(x) { return x.schedulingMode === 'calculated' && !x.baseCalculo; }) && !getProjetoBaseCalculoPadrao_(p.projeto)) {
      issue('polo-base', 'Defina e salve a Base padrão do cronograma do protocolo antes de importar.');
    }
    var commonKept = normalized.filter(function(x) { return x.existente && !x.bracoIds.length; }).length;
    if (commonKept) notice('polo-common', commonKept + ' visita(s) já cadastrada(s) para todos os braços continuam comuns.');
  }
  var fingerprint = soaPlanningHash_(JSON.stringify([p.raw,p.projeto,p.modo,p.criarBracos,p.braco,selected,existingArms,existingVisits]));
  return {ok:!errors.length,projeto:p.projeto,modo:p.modo,criarBracos:p.criarBracos,missingBracos:missing,bracosExistentes:existingArms,erros:errors,alertas:issues.map(function(x) { return x.message; }),revisaoNecessaria:[],visitas:normalized,totalVisitas:visits.length,novasVisitas:normalized.filter(function(x) { return !x.existente; }).length,atualizacoes:p.modo === 'atualizar' ? normalized.filter(function(x) { return x.existente; }).length : 0,ignoradas:p.modo !== 'atualizar' ? normalized.filter(function(x) { return x.existente; }).length : 0,ordensManuaisPreservadas:normalized.filter(function(x) { return x.ordemManual; }).length,podeImportar:!issues.some(function(x) { return x.blocking; }),fingerprint:fingerprint,planejamento:{schema:d.schema,version:d.schema_version,study:d.study || {},rules:rules,issues:issues,draftOnly:!!(poc || d.import_mode === 'preview_only'),origem:polo ? 'polo' : '',braco:polo ? p.braco : ''}};
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
  return {ok:true,msg:'Cronograma de Avaliações importado e arquivado.',planejamentoId:archived.id,adicionadas:final.novasVisitas,atualizadas:final.atualizacoes,ignoradas:final.ignoradas,bracosCriados:created.length,ordensManuaisPreservadas:final.ordensManuaisPreservadas,alertas:[],revisaoNecessaria:[]};
}

/* Polo Trial Flowchart export. The browser sends only visit fields; nothing financial reaches this code. */
var SOA_POLO_SCHEMA_ = 'polo-trial-flowchart';
var SOA_POLO_ANCHORS_ = { 'randomizacao': 'randomization_date', 'inclusao': 'inclusion_date', 'fim do tratamento': 'end_of_treatment_date', 'ultima dose': 'last_dose', 'progressao da doenca': 'progression_date' };
var SOA_POLO_VISIT_FIELDS_ = ['label', 'note', 'interval', 'unit', 'after', 'reference', 'window_before', 'window_after'];
var SOA_POLO_END_VISIT_ = /fim do (tratamento|estudo)|end of (treatment|study)|\bEO[TS]\b|follow[\s-]?up|acompanhamento|seguimento/i;
function soaPoloInteger_(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return { empty: true };
  return /^-?\d+$/.test(text) ? { value: Number(text) } : { invalid: true };
}
function soaPoloNames_(label) {
  // Observed exports use "PT / EN" and "EN \ PT"; a label without a separator stays whole.
  var parts = label.split(/\s+[/\\]\s+/).map(function(part) { return part.trim(); }).filter(Boolean);
  var name = parts.length < 2 ? label : (/\s\\\s/.test(label) ? parts[1] : parts[0]);
  return { name: name, parts: parts, aliases: soaUniqueIds_(parts.concat(label).filter(function(item) { return item !== name; })) };
}
function soaPoloCode_(label, names) {
  var match = label.match(/\bC(\d+)D(\d+)\b/i) || label.match(/^C(\d+)\b.*?\bD(\d+)\b/i);
  if (match) return 'C' + Number(match[1]) + 'D' + Number(match[2]);
  match = label.match(/\b(?:Ciclo|Cycle)\s*0*(\d+)\b/i);
  if (match) return 'C' + Number(match[1]);
  var acronym = names.parts.filter(function(part) { return /^[A-Z]{2,6}$/.test(part); })[0];
  if (acronym) return acronym;
  var words = normText_(names.parts[0]).toUpperCase().split(/[^A-Z0-9]+/).filter(function(word) { return word && ['DE', 'DO', 'DA', 'DOS', 'DAS', 'OF', 'THE'].indexOf(word) < 0; });
  return words.length < 2 ? (words[0] || 'VISITA') : words.map(function(word) { return /^\d+$/.test(word) ? word : word.charAt(0); }).join('');
}
function soaPoloNote_(value) {
  return String(value || '').replace(/\[\d+\]\s*Invoiceable\.?/gi, '').trim();
}
function soaPoloRows_(source) {
  if (source.schema_version !== '1.0.0') throw new Error('Versão de exportação do Polo Trial não suportada.');
  var visits = source.visits;
  if (!Array.isArray(visits) || !visits.length || visits.length > 200) throw new Error('O arquivo não contém uma lista válida de visitas.');
  return visits.map(function(visit) {
    if (!soaPlanningObject_(visit) || Object.keys(visit).some(function(key) { return SOA_POLO_VISIT_FIELDS_.indexOf(key) < 0; })) throw new Error('A exportação contém um campo de visita não suportado.');
    var row = {};
    SOA_POLO_VISIT_FIELDS_.forEach(function(key) { row[key] = String(visit[key] == null ? '' : visit[key]).trim(); });
    if (!row.label) throw new Error('Há uma visita sem nome no arquivo.');
    return row;
  });
}
function soaPoloClassify_(row, issue) {
  var after = normText_(row.after), interval = soaPoloInteger_(row.interval);
  var before = soaPoloInteger_(row.window_before), later = soaPoloInteger_(row.window_after);
  var unit = normText_(row.unit), factor = /^dia/.test(unit) ? 1 : (/^semana/.test(unit) ? 7 : 0);
  row.mode = 'calculated';
  if ([interval, before, later].some(function(item) { return item.invalid; })) issue('Número inválido no intervalo ou na janela de ' + row.label + '.');
  if (after === 'por demanda') { row.mode = 'manual'; row.reason = 'Por demanda no Polo Trial.'; return; }
  if (after !== 'visita' && !SOA_POLO_ANCHORS_[after]) { row.mode = 'manual'; row.reason = 'Referência não reconhecida.'; issue('Valor não reconhecido em "Após" na visita ' + row.label + ': ' + (row.after || 'vazio') + '.'); return; }
  if (interval.empty || interval.invalid) { row.mode = 'manual'; row.reason = 'Intervalo ausente.'; if (interval.empty) issue('Informe o intervalo de ' + row.label + ' no Polo Trial.'); return; }
  row.anchor = after === 'visita' ? 'visit' : SOA_POLO_ANCHORS_[after];
  row.offset = interval.value * factor;
  row.before = before.value;
  row.later = later.value;
  if (!factor) { row.mode = 'manual'; row.reason = 'Unidade não convertida em dias: ' + (row.unit || 'não informada') + '.'; }
  else if (before.empty || later.empty || before.invalid || later.invalid) { row.mode = 'manual'; row.reason = 'Janela não informada no Polo Trial.'; }
  else if (interval.value < 0 || before.value < 0 || later.value < 0) { row.mode = 'manual'; row.reason = 'Intervalo ou janela negativos não são calculados automaticamente.'; }
  else if (SOA_POLO_END_VISIT_.test(row.label)) { row.mode = 'manual'; row.reason = 'Visita de encerramento ou acompanhamento: confira a referência com o protocolo.'; }
}
function soaPoloTimingNote_(row) {
  var parts = [];
  if (row.after) parts.push('após ' + row.after + (row.reference ? ' ' + row.reference : ''));
  if (row.interval) parts.push(('intervalo ' + row.interval + ' ' + row.unit).trim());
  if ((row.window_before && row.window_before !== '0') || (row.window_after && row.window_after !== '0')) parts.push('janela −' + (row.window_before || '?') + '/+' + (row.window_after || '?'));
  return 'Polo Trial: ' + parts.join(', ') + '.';
}
function soaPoloDay_(row, seen) {
  if (row.mode === 'milestone') return 0;
  if (row.mode !== 'calculated') return null;
  if (row.anchor === 'randomization_date' || row.anchor === 'inclusion_date') return row.offset;
  if (row.anchor !== 'visit' || !row.target || seen.indexOf(row) >= 0) return null;
  var base = soaPoloDay_(row.target, seen.concat(row));
  return base === null ? null : base + row.offset;
}
function soaPoloCheckSequence_(rows, issue) {
  var last = null;
  rows.map(function(row) {
    var match = row.code.match(/^C(\d+)(?:D(\d+))?$/);
    return match && row.day !== null ? { row: row, cycle: Number(match[1]), date: Number(match[2] || 1) } : null;
  }).filter(Boolean).sort(function(a, b) { return a.cycle - b.cycle || a.date - b.date; }).forEach(function(item) {
    if (last && item.row.day <= last.row.day) issue(item.row.code + ' cai no dia ' + item.row.day + ', sem avançar em relação a ' + last.row.code + ' (dia ' + last.row.day + '). Corrija o intervalo no Polo Trial e exporte novamente.');
    else last = item;
  });
}
function soaPoloRank_(row) {
  if (/screening|triagem/i.test(row.label) && !/fail|falha/i.test(row.label)) return 0;
  if (row.day !== null) return 1;
  return SOA_POLO_END_VISIT_.test(row.label) ? 2 : 3;
}
function soaPoloPlanning_(source, projeto, braco) {
  if (!braco) throw new Error('Informe o nome do braço.');
  if (braco.length > 120) throw new Error('O nome do braço deve ter até 120 caracteres.');
  var rows = soaPoloRows_(source), issues = [], byLabel = Object.create(null), codes = Object.create(null);
  function issue(message) { issues.push({ id: 'polo-' + issues.length, message: message }); }
  rows.forEach(function(row, index) {
    var key = normText_(row.label);
    if (byLabel[key]) issue('Visita repetida no arquivo: ' + row.label + '.');
    byLabel[key] = row;
    row.index = index;
    row.names = soaPoloNames_(row.label);
    var code = soaPoloCode_(row.label, row.names), candidate = code, attempt = 1;
    while (codes[candidate]) candidate = code + '-' + (++attempt);
    codes[candidate] = true;
    row.code = candidate;
    row.id = 'polo_' + (index + 1);
    soaPoloClassify_(row, issue);
  });
  rows.forEach(function(row) {
    if (normText_(row.after) !== 'visita') return;
    row.target = byLabel[normText_(row.reference)];
    if (!row.target) { row.mode = 'manual'; row.reason = 'Visita de referência não encontrada.'; issue('Visita de referência não encontrada para ' + row.label + ': ' + (row.reference || 'vazia') + '.'); }
  });
  // A "Por demanda" visit that others count from is dated by its own realization.
  rows.forEach(function(row) {
    if (normText_(row.after) === 'por demanda' && rows.some(function(other) { return other.target === row; })) { row.mode = 'milestone'; row.reason = 'Outras visitas contam a partir da realização desta visita.'; }
  });
  var changed = true;
  while (changed) {
    changed = false;
    rows.forEach(function(row) {
      if (row.mode === 'calculated' && row.target && row.target.mode === 'manual') { row.mode = 'manual'; row.reason = 'Depende de visita sem cálculo automático: ' + row.target.label + '.'; changed = true; }
    });
  }
  rows.forEach(function(row) { row.day = soaPoloDay_(row, []); });
  soaPoloCheckSequence_(rows, issue);
  var ordered = rows.slice().sort(function(a, b) {
    return soaPoloRank_(a) - soaPoloRank_(b) || (soaPoloRank_(a) === 1 ? a.day - b.day : 0) || a.index - b.index;
  });
  var visits = ordered.map(function(row, position) {
    var manual = row.mode !== 'calculated', note = soaPoloNote_(row.note);
    var timing = manual ? {} : { anchor: row.anchor, offset_days: row.offset, window_before_days: row.before, window_after_days: row.later };
    if (!manual && row.anchor === 'visit') timing.anchor_visit_id = row.target.id;
    var visit = { id: row.id, code: row.code, name: row.names.name, arm_ids: ['braco'], order: position + 1, aliases: row.names.aliases, timing: timing,
      source: { file: 'Exportação do Polo Trial', section: 'Flowchart' }, status: manual ? 'requires_review' : 'extracted',
      note: manual ? [note, soaPoloTimingNote_(row)].filter(Boolean).join('\n') : note };
    if (manual) visit.scheduling = { mode: row.mode, reason: row.reason };
    return visit;
  });
  return { issues: issues, documento: { schema: 'ips-agenda-study-planning', schema_version: '1.1.0', import_mode: 'review', approved_for_clinical_scheduling: false,
    study: { protocol_id: projeto, protocol_version: 'Exportação do Polo Trial' }, arms: [{ id: 'braco', name: braco }], visits: visits, rules: [] } };
}
function soaPoloExistingMatches_(visit, bracoIds, existingVisits) {
  var names = [visit.name].concat(visit.aliases || []).map(normText_);
  function same(item) {
    return normText_(item.codigo) === normText_(visit.code) || names.indexOf(normText_(item.codigo)) >= 0 || names.indexOf(normText_(item.nome)) >= 0 ||
      soaDelimitedIds_(item.aliases).some(function(alias) { return names.indexOf(normText_(alias)) >= 0; });
  }
  var signature = soaArmSignature_(bracoIds);
  var sameArm = existingVisits.filter(function(item) { return soaArmSignature_(item.bracoIds) === signature && same(item); });
  return sameArm.length ? sameArm : existingVisits.filter(function(item) { return !soaUniqueIds_(item.bracoIds).length && same(item); });
}
