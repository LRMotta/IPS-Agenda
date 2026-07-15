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
      if (cpf && digits(row[10]) === cpf) return { field: 'cpf', value: row[10] };
      if (participantId && project && normalizeText(row[4]) === participantId && normalizeText(row[5]) === project) {
        return { field: 'idParticipante', value: row[4] };
      }
    }
    return null;
  }

  return Object.freeze({
    normalizeText: normalizeText,
    digits: digits,
    requiredProjectFields: requiredProjectFields,
    findProjectDuplicate: findProjectDuplicate,
    participantIdOptional: participantIdOptional,
    requiredParticipantFields: requiredParticipantFields,
    projectExists: projectExists,
    findParticipantDuplicate: findParticipantDuplicate
  });
})();
