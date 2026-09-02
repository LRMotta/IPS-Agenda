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
    var currentId = String(data.id || '');
    var name = normalizeText(data.nomeAbreviado);
    var code = normalizeText(data.codigo);
    rows = rows || [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (currentId && String(row[0] || '') === currentId) continue;
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
    data = data || {};
    var currentId = String(data.id || '');
    var project = normalizeText(data.projeto);
    var participantId = normalizeText(data.idParticipante);
    var cpf = digits(data.cpf);
    rows = rows || [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (currentId && String(row[0] || '') === currentId) continue;
      if (cpf && project && digits(row[10]) === cpf && normalizeText(row[5]) === project) {
        return { field: 'cpf', value: row[10] };
      }
      if (participantId && project && normalizeText(row[4]) === participantId && normalizeText(row[5]) === project) {
        return { field: 'idParticipante', value: row[4] };
      }
    }
    return null;
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
      id: String(row[0] || ''),
      nome: String(row[1] || ''),
      idParticipante: String(row[4] || ''),
      projeto: String(row[5] || ''),
      idPessoa: personIdColumn >= 0 ? String(row[personIdColumn] || '') : '',
      rowIndex: rowIndex,
      matchType: matchType
    };
  }

  function findParticipantNameMatches(data, rows) {
    data = data || {};
    var currentId = String(data.id || '');
    var name = normalizeText(data.nome);
    if (!name) return [];
    rows = rows || [];
    var personIdColumn = participantPersonIdColumn(rows);
    var matches = [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (currentId && String(row[0] || '') === currentId) continue;
      if (normalizeText(row[1]) !== name) continue;
      matches.push(participantMatchResult(row, i, personIdColumn, 'nome'));
    }
    return matches;
  }

  function findParticipantNameDuplicate(data, rows) {
    var matches = findParticipantNameMatches(data, rows);
    return matches.length ? matches[0] : null;
  }

  function findParticipantCpfMatch(data, rows) {
    data = data || {};
    var currentId = String(data.id || '');
    var cpf = digits(data.cpf);
    if (!cpf) return null;
    rows = rows || [];
    var personIdColumn = participantPersonIdColumn(rows);
    var firstMatch = null;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      if (currentId && String(row[0] || '') === currentId) continue;
      if (digits(row[10]) !== cpf) continue;
      var match = participantMatchResult(row, i, personIdColumn, 'cpf');
      if (match.idPessoa) return match;
      if (!firstMatch) firstMatch = match;
    }
    return firstMatch;
  }

  function agendaEventMatchesParticipant(participant, event) {
    participant = participant || {};
    event = event || {};
    var cadastroId = normalizeText(participant.id);
    var eventCadastroId = normalizeText(event.participantCadastroId);
    if (cadastroId && eventCadastroId) return cadastroId === eventCadastroId;

    var participantId = normalizeText(participant.idParticipante);
    var eventParticipantId = normalizeText(event.idParticipante);
    var project = normalizeText(participant.projeto);
    var eventProject = normalizeText(event.projeto);
    if (participantId && eventParticipantId) {
      return participantId === eventParticipantId && (!project || !eventProject || project === eventProject);
    }

    var name = normalizeText(participant.nome);
    var eventName = normalizeText(event.participante);
    return !!name && name === eventName && (!project || !eventProject || project === eventProject);
  }

  return Object.freeze({
    normalizeText: normalizeText,
    digits: digits,
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
    agendaEventMatchesParticipant: agendaEventMatchesParticipant
  });
})();
