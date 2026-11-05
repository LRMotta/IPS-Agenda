'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture() {
  const leituras = [];
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  s.transporteReadRegistro_ = () => ({ materiais: [], temperatura: 'AMBIENTE + REFRIGERADO' });
  s.transporteAtualizarRegistroPorAgenda_ = registro => registro;
  s.transporteReadOptions_ = () => { leituras.push('options'); return { temperaturas: ['AMBIENTE'] }; };
  s.transporteCaixasRegras_ = () => { leituras.push('regras'); return []; };
  s.transporteCaixasFeriados_ = () => { leituras.push('feriados'); return null; };
  s.transporteExecutionContext_ = () => ({});
  s.transporteGmailOAuthStatus_ = () => ({});
  s.transporteValidate_ = () => [];
  s.transporteDocumentosPorCourier_ = () => [];
  return { s, leituras };
}

test('abertura nao le as referencias no caminho do envio', () => {
  const { s, leituras } = fixture();
  const data = s.transporteBuildBootstrap_(null, null, { awbAdiada: true, semReferencias: true });
  assert.deepEqual(leituras, []);
  assert.deepEqual(Object.keys(data.options), []);
});

test('quem nao pede separacao continua recebendo as listas completas', () => {
  const { s, leituras } = fixture();
  const data = s.transporteBuildBootstrap_(null, null, { awbAdiada: true });
  assert.deepEqual(leituras, ['options', 'regras', 'feriados']);
  assert.deepEqual(Array.from(data.options.temperaturas), ['AMBIENTE', 'AMBIENTE + REFRIGERADO']);
});

test('acesso ja autorizado e reaproveitado na resposta, sem nova autorizacao', () => {
  const { s } = fixture();
  s.codexAccessPresentation_ = acesso => ({ email: acesso.userEmail });
  s.codexGetCurrentUserAccess = () => { throw new Error('nao deveria autorizar de novo'); };
  const data = s.transporteBuildBootstrap_(null, null, { awbAdiada: true, semReferencias: true, acesso: { userEmail: 'a@b' } });
  assert.equal(data.access.email, 'a@b');
});

test('sem acesso informado a resposta autoriza como antes', () => {
  const { s } = fixture();
  s.codexGetCurrentUserAccess = () => ({ email: 'atual' });
  assert.equal(s.transporteBuildBootstrap_(null, null, { awbAdiada: true }).access.email, 'atual');
});
