'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

test('requisicao exige o prestador antes do solicitante e oferece selecao com previa', () => {
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const providerPosition = content.indexOf('id="rqPrestador"');
  const solicitorPosition = content.indexOf('id="rqSolicitante"');

  assert.ok(providerPosition >= 0);
  assert.ok(solicitorPosition >= 0);
  assert.ok(providerPosition < solicitorPosition);
  assert.match(content, /onclick="abrirReqPreloadSelecao\(\)"/);
  assert.match(content, /id="modalReqPreloadSelect"/);
  assert.match(content, /id="reqPreloadSelectionPreview"/);
  assert.match(content, /id="rqPrestadorTipo"[^>]+readonly/);
  assert.doesNotMatch(content, /id="btnCriarReqParticipante"/);
  assert.doesNotMatch(core, /btnCriarReqParticipante|abrirReqExamesDoParticipante/);
  assert.match(core, /getReqExamesPreloadProjetoLists/);
  assert.match(core, /salvarReqExamesPreloadLista/);
  assert.doesNotMatch(core, /method:\s*'getReqExamesPreloadProjetoContext'/);
});

test('pendencia abre o Req. Exames com o agendamento carregado diretamente', () => {
  const pendencias = readProjectFile('IndexPendenciasScripts.html');
  assert.match(pendencias, /irPara\('requisicao'\)/);
  assert.match(pendencias, /agendaFindEventoLocal_\(/);
  assert.match(pendencias, /agendaFetchEventoPorId_\(/);
  assert.match(pendencias, /aplicarAgendaNaRequisicao\(dados, 0\)/);
  assert.doesNotMatch(pendencias, /abrirAgendaEdicao\(agendaId\)/);
});
