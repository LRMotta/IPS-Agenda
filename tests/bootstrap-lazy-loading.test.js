'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} nao encontrada`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`Corpo incompleto de ${name}`);
}

test('bootstrap global nao carrega dados exclusivos do formulario da Agenda', () => {
  const server = readProjectFile('WebApp.gs');
  const bootstrap = functionBody(server, 'getAppBootstrapData');
  assert.doesNotMatch(bootstrap, /getDadosFormularioAgenda\s*\(/);
  assert.doesNotMatch(bootstrap, /agendaFormData\s*:/);
  assert.match(bootstrap, /codexGetCurrentUserAccess\s*\(/);
  assert.match(bootstrap, /codexGetUserOAuthStatus_\s*\(/);
  assert.match(bootstrap, /codexGetAppVersion_\s*\(/);
});

test('Agenda continua carregando o formulario sob demanda ao ser aberta', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const init = functionBody(client, 'initAgendaV1');
  assert.match(init, /carregarAgendaEventos\(false, agendaAbrirPendenteAposCarga\)/);
  assert.match(init, /\.getDadosFormularioAgenda\(\)/);
  assert.match(init, /withSuccessHandler\(applyAgendaFormData\)/);
});
