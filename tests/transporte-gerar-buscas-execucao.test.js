'use strict';

// A geracao dos documentos pergunta pela CE (anexo e aviso) e pela pasta do estudo (PDF e peticao) mais de uma vez.
// Dentro da mesma execucao, cada busca no Drive acontece uma vez so, inclusive quando a CE nao existe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function servidor() {
  const chamadas = { ce: 0, pastas: 0 };
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  s.transporteCodexFindComunicadoEspecial_ = (_ss, projeto) => {
    chamadas.ce++;
    return projeto === 'Com CE' ? { getName: () => 'Com CE_CE.pdf' } : null;
  };
  const pasta = (nome) => ({
    getFoldersByName: (sub) => { chamadas.pastas++; return { hasNext: () => true, next: () => pasta(sub) }; },
    createFolder: (sub) => pasta(sub), getName: () => nome
  });
  s.DriveApp = { getRootFolder: () => pasta('raiz') };
  s.chamadas = chamadas;
  return s;
}

const memoria = { getId: () => 'email-memoria' };

test('CE ausente: a busca no Drive roda uma vez por execucao', () => {
  const s = servidor();
  assert.equal(s.transporteComunicadoEspecialDaExecucao_(memoria, 'Sem CE'), null);
  assert.equal(s.transporteComunicadoEspecialDaExecucao_(memoria, 'Sem CE'), null);
  assert.equal(s.chamadas.ce, 1);
});

test('CE encontrada continua reaproveitada; outra planilha faz a propria busca', () => {
  const s = servidor();
  assert.equal(s.transporteComunicadoEspecialDaExecucao_(memoria, 'Com CE').getName(), 'Com CE_CE.pdf');
  assert.equal(s.transporteComunicadoEspecialDaExecucao_(memoria, 'Com CE').getName(), 'Com CE_CE.pdf');
  assert.equal(s.chamadas.ce, 1);
  // A planilha real tem a aba Protocolos com o link da CE: a ausencia na planilha em memoria nao vale para ela.
  s.transporteComunicadoEspecialDaExecucao_(memoria, 'Sem CE');
  s.transporteComunicadoEspecialDaExecucao_({ getId: () => 'planilha-real' }, 'Sem CE');
  assert.equal(s.chamadas.ce, 3);
});

test('pasta do estudo: PDF e peticao da mesma geracao usam uma busca so', () => {
  const s = servidor();
  const a = s.transportePdfDestinationFolder_('Estudo X');
  const b = s.transportePdfDestinationFolder_('Estudo X');
  assert.equal(a, b);
  assert.equal(a.getName(), 'Estudo X');
  assert.equal(s.chamadas.pastas, 2);
  s.transportePdfDestinationFolder_('Estudo Y');
  assert.equal(s.chamadas.pastas, 4);
});
