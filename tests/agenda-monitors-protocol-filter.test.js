'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function monitorFilterContext(protocol, monitors) {
  const source = readProjectFile('IndexAgendaScripts.html');
  const start = source.indexOf('  function agendaMonitorProjetos(');
  const end = source.indexOf('  function preencherAgendaMonitoresSelects(', start);
  assert.notEqual(start, -1, 'função de vínculos de monitor não encontrada');
  assert.notEqual(end, -1, 'função de preenchimento de monitores não encontrada');
  const context = vm.createContext({
    _agendaDados: { monitores: monitors },
    document: {
      getElementById(id) {
        return id === 'agProjeto' ? { value: protocol } : { value: 'SIV' };
      }
    },
    normAgenda(value) { return String(value || '').trim().toLocaleLowerCase('pt-BR'); }
  });
  vm.runInContext(source.slice(start, end), context, { filename: 'IndexAgendaScripts.html' });
  return context;
}

test('SIV lista somente monitores vinculados ao protocolo selecionado', () => {
  const context = monitorFilterContext('XENITH-UC', [
    { nome: 'Vanessa Turaça', projetos: ['Outro protocolo'] },
    { nome: 'Bruno Silva', projetos: [' xenith-uc '] },
    { nome: 'Ana Lima', projeto1: 'XENITH-UC', projeto2: 'Protocolo secundário' },
    { nome: 'Carla Souza', projetos: ['Protocolo secundário'] }
  ]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.agendaMonitoresFiltradosPorProjeto().map((monitor) => monitor.nome))),
    ['Ana Lima', 'Bruno Silva']
  );
});
