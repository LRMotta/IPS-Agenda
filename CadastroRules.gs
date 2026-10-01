// Regras puras dos cadastros. Nao acessa planilhas nem servicos Google.
var CadastroRules_ = (function() {
  'use strict';

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function digits(value) {
    return String(value == null ? '' : value).replace(/\D/g, '');
  }

  // IDs tecnicos preservam caixa e zeros; apenas espacos perifericos sao removidos.
  function normalizeId(value) {
    return String(value == null ? '' : value).trim();
  }

  function isValidCpf(value) {
    var cpf = digits(value);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    function digit(base, weight) {
      var total = 0;
      for (var i = 0; i < base.length; i++) total += Number(base.charAt(i)) * (weight - i);
      var rest = total % 11;
      return rest < 2 ? 0 : 11 - rest;
    }
    var first = digit(cpf.slice(0, 9), 10);
    var second = digit(cpf.slice(0, 9) + first, 11);
    return first === Number(cpf.charAt(9)) && second === Number(cpf.charAt(10));
  }

  function requiredProjectFields(data) {
    data = data || {};
    return [
      ['nomeAbreviado', 'Nome do projeto'],
      ['fase', 'Fase'],
      ['status', 'Status'],
      ['especialidade', 'Especialidade'],
      ['investigador', 'Investigador principal']
    ].filter(function(item) {
      return !String(data[item[0]] || '').trim();
    }).map(function(item) { return item[1]; });
  }

  function findProjectDuplicate(data, rows) {
    data = data || {};
    var currentId = normalizeId(data.id);
    var name = normalizeText(data.nomeAbreviado);
    var code = normalizeText(data.codigo);
    rows = rows || [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (currentId && normalizeId(row[0]) === currentId) continue;
      if (name && normalizeText(row[1]) === name) return { field: 'nomeAbreviado', value: row[1] };
      if (code && normalizeText(row[2]) === code) return { field: 'codigo', value: row[2] };
    }
    return null;
  }

  function participantIdOptional(status) {
    var value = normalizeText(status);
    return value === 'pre-triagem' || value === 'falha de pre-triagem';
  }

  function participantAvailableForNewAgenda(status) {
    var value = normalizeText(status);
    return [
      'falha de pre-triagem',
      'falha de triagem',
      'descontinuado',
      'obito'
    ].indexOf(value) === -1;
  }

  function requiredParticipantFields(data) {
    data = data || {};
    var missing = [];
    if (!String(data.nome || '').trim()) missing.push('Nome');
    if (!String(data.projeto || '').trim()) missing.push('Projeto');
    if (!String(data.status || '').trim()) missing.push('Status');
    if (!participantIdOptional(data.status) && !String(data.idParticipante || '').trim()) {
      missing.push('ID do participante');
    }
    return missing;
  }

  function projectExists(project, options) {
    var key = normalizeText(project);
    if (!key) return false;
    return (options || []).some(function(item) {
      var name = item && typeof item === 'object' ? item.nome : item;
      return normalizeText(name) === key;
    });
  }

  function findParticipantDuplicate(data, rows) {
    return scanParticipant(data, rows, { duplicate: true }).duplicate;
  }

  function participantPersonIdColumn(rows) {
    var header = (rows && rows[0]) || [];
    var aliases = ['id pessoa', 'pessoa id', 'id interno pessoa'];
    for (var i = 0; i < header.length; i++) {
      if (aliases.indexOf(normalizeText(header[i])) >= 0) return i;
    }
    return -1;
  }

  function participantMatchResult(row, rowIndex, personIdColumn, matchType) {
    return {
      id: normalizeId(row[0]),
      nome: String(row[1] || ''),
      idParticipante: String(row[4] || ''),
      projeto: String(row[5] || ''),
      idPessoa: personIdColumn >= 0 ? normalizeId(row[personIdColumn]) : '',
      rowIndex: rowIndex,
      matchType: matchType
    };
  }

  function findParticipantNameMatches(data, rows) {
    return scanParticipant(data, rows, { name: true }).nameMatches;
  }

  function findParticipantNameDuplicate(data, rows) {
    var matches = findParticipantNameMatches(data, rows);
    return matches.length ? matches[0] : null;
  }

  function findParticipantCpfMatch(data, rows) {
    // Escolhe uma referencia para a previa, nao comprova unicidade de ID Pessoa.
    // O servidor revalida conflitos sob lock antes de qualquer escrita.
    return scanParticipant(data, rows, { cpf: true }).cpfMatch;
  }

  function analyzeParticipant(data, rows) {
    return scanParticipant(data, rows, { duplicate: true, name: true, cpf: true });
  }

  function scanParticipant(data, rows, checks) {
    data = data || {};
    rows = rows || [];
    var currentId = normalizeId(data.id);
    var project = checks.duplicate ? normalizeText(data.projeto) : '';
    var participantId = checks.duplicate ? normalizeText(data.idParticipante) : '';
    var name = checks.name ? normalizeText(data.nome) : '';
    var cpf = checks.cpf || checks.duplicate ? digits(data.cpf) : '';
    var result = { duplicate: null, nameMatches: [], cpfMatch: null };
    if (!name && !(checks.cpf && cpf) && !(checks.duplicate && project && (cpf || participantId))) return result;
    var personIdColumn = checks.name || checks.cpf ? participantPersonIdColumn(rows) : -1;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (currentId && normalizeId(row[0]) === currentId) continue;
      var sameCpf = !!cpf && (checks.cpf || checks.duplicate) && digits(row[10]) === cpf;
      if (checks.duplicate && !result.duplicate && project) {
        // Preservar prioridade por linha: CPF antes de identificacao nessa linha.
        var sameParticipantId = participantId && normalizeText(row[4]) === participantId;
        if ((sameCpf || sameParticipantId) && normalizeText(row[5]) === project) {
          result.duplicate = sameCpf
            ? { field: 'cpf', value: row[10] }
            : { field: 'idParticipante', value: row[4] };
          if (!checks.name && !checks.cpf) return result;
        }
      }
      if (name && normalizeText(row[1]) === name) {
        result.nameMatches.push(participantMatchResult(row, i, personIdColumn, 'nome'));
      }
      if (checks.cpf && sameCpf && (!result.cpfMatch || !result.cpfMatch.idPessoa)) {
        var match = participantMatchResult(row, i, personIdColumn, 'cpf');
        if (!result.cpfMatch || match.idPessoa) result.cpfMatch = match;
        if (match.idPessoa && !checks.name && !checks.duplicate) return result;
      }
    }
    return result;
  }

  var NO_AGENDA_MATCH = Object.freeze({ matches: false, matchType: 'none', ambiguous: false });
  var CADASTRO_AGENDA_MATCH = Object.freeze({ matches: true, matchType: 'cadastro', ambiguous: false });
  var NUMBER_AGENDA_MATCH = Object.freeze({ matches: true, matchType: 'idParticipante', ambiguous: false });
  var LEGACY_NUMBER_AGENDA_MATCH = Object.freeze({ matches: true, matchType: 'idParticipante', ambiguous: true });
  var NAME_AGENDA_MATCH = Object.freeze({ matches: true, matchType: 'nome', ambiguous: true });

  // Snapshot da referencia: reutilizar durante uma varredura, nunca como cache de dados.
  function createAgendaParticipantMatcher(participant) {
    participant = participant || {};
    var cadastroId = normalizeText(participant.id);
    if (!cadastroId) cadastroId = normalizeText(participant.idCadastro);
    var participantId = normalizeText(participant.idParticipante);
    var project = normalizeText(participant.projeto);
    var name = normalizeText(participant.nome);
    function classify(event) {
      event = event || {};
      var eventCadastroId = normalizeText(event.participantCadastroId);
      if (cadastroId && eventCadastroId) return cadastroId === eventCadastroId ? CADASTRO_AGENDA_MATCH : NO_AGENDA_MATCH;
      var eventParticipantId = normalizeText(event.idParticipante);
      var eventProject = normalizeText(event.projeto);
      if (project && eventProject && project !== eventProject) return NO_AGENDA_MATCH;
      if (participantId && eventParticipantId) {
        if (participantId !== eventParticipantId) return NO_AGENDA_MATCH;
        return project && eventProject ? NUMBER_AGENDA_MATCH : LEGACY_NUMBER_AGENDA_MATCH;
      }
      // Nome pode representar homonimos; o booleano legado continua conservador.
      return name && name === normalizeText(event.participante) ? NAME_AGENDA_MATCH : NO_AGENDA_MATCH;
    }
    return Object.freeze({
      classify: classify,
      matches: function(event) { return classify(event).matches; }
    });
  }

  function agendaEventMatchesParticipant(participant, event) {
    return createAgendaParticipantMatcher(participant).matches(event);
  }

  return Object.freeze({
    normalizeText: normalizeText,
    digits: digits,
    normalizeId: normalizeId,
    isValidCpf: isValidCpf,
    requiredProjectFields: requiredProjectFields,
    findProjectDuplicate: findProjectDuplicate,
    participantIdOptional: participantIdOptional,
    participantAvailableForNewAgenda: participantAvailableForNewAgenda,
    requiredParticipantFields: requiredParticipantFields,
    projectExists: projectExists,
    findParticipantDuplicate: findParticipantDuplicate,
    findParticipantNameMatches: findParticipantNameMatches,
    findParticipantNameDuplicate: findParticipantNameDuplicate,
    findParticipantCpfMatch: findParticipantCpfMatch,
    analyzeParticipant: analyzeParticipant,
    createAgendaParticipantMatcher: createAgendaParticipantMatcher,
    agendaEventMatchesParticipant: agendaEventMatchesParticipant
  });
})();
