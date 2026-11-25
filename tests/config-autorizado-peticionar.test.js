'use strict';

// A lista "Autorizado a peticionar" não existia em Config_App e o formulário só oferecia chaves já cadastradas:
// não havia como criar a primeira linha pelo app, e o e-mail [PETICIONAMENTO] nunca saía.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function catalogo(configApp) {
  const fonte = readProjectFile('IndexCoreScripts.html');
  const trecho = (inicio, fim) => fonte.slice(fonte.indexOf(inicio), fonte.indexOf(fim, fonte.indexOf(inicio)));
  const context = vm.createContext({ _configApp: configApp });
  vm.runInContext(trecho('var CONFIG_APP_CHAVES_DISPONIVEIS = {', 'function carregarConfigApp('), context);
  vm.runInContext(trecho('function configValoresUnicos(', 'function preencherSelectConfig('), context);
  return context.configValoresUnicos;
}

test('formulário oferece Transporte / Autorizado a peticionar mesmo sem nenhuma linha cadastrada', () => {
  const valores = catalogo([{ bloco: 'Principal', grupo: 'Transporte', chave: 'Agendado por', valor: 'Pessoa' }]);
  assert.ok(valores('Principal').includes('Transporte'));
  assert.deepEqual(valores('Principal', 'Transporte'), ['Agendado por', 'Autorizado a peticionar']);
  // Também com Config_App sem nenhuma linha de Transporte.
  assert.ok(catalogo([])('Principal', 'Transporte').includes('Autorizado a peticionar'));
  // Sem repetir quando a lista já tem linhas.
  const comLinha = catalogo([{ bloco: 'Principal', grupo: 'Transporte', chave: 'Autorizado a peticionar', valor: 'a@ucs.br' }]);
  assert.deepEqual(comLinha('Principal', 'Transporte'), ['Autorizado a peticionar']);
});

test('a chave do formulário é exatamente a que o servidor lê', () => {
  const servidor = readProjectFile('TransportePeticionamento.gs');
  const chave = /var TRANSPORTE_PETICIONAMENTO_CHAVE_ = '([^']+)'/.exec(servidor)[1];
  assert.ok(catalogo([])('Principal', 'Transporte').includes(chave));
});
