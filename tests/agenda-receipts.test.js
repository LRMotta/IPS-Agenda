'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function receiptValueContext() {
  const source = readProjectFile('IndexAgendaScripts.html');
  const start = source.indexOf('function agendaReciboGrupoExtenso_');
  const end = source.indexOf('function agendaReciboPrintHtml_', start);
  const context = vm.createContext({ Math, Number, isFinite });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('Agenda oferece recibo somente para visita ou consulta com participante e usa RPC protegida', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const server = readProjectFile('WebApp.gs');
  const modal = readProjectFile('IndexExtraModals.html');

  assert.match(client, /var reciboTipo = AgendaRules\.formPolicy\(r\)\.type/);
  assert.match(client, /r\.participante && \['visita', 'consulta'\]\.indexOf\(reciboTipo\) >= 0/);
  assert.match(client, /\.getAgendaReciboData\(agendaId, rowIndex \|\| undefined\)/);
  assert.match(server, /function getAgendaReciboData\(id, rowIndex\)/);
  assert.match(server, /var access = codexGetCurrentUserAccess\(\)/);
  assert.match(server, /\['visita', 'consulta'\]\.indexOf\(tipoEvento\) < 0/);
  assert.match(server, /participanteCadastroId/);
  assert.match(server, /coordenador: String\(projeto\.coordenador/);
  assert.match(modal, /id="modalAgendaRecibo"/);
  assert.match(modal, /id="agendaReciboBeneficiario"/);
  assert.match(modal, /id="agendaReciboDataEcrf"/);
  assert.match(modal, /id="agendaReciboCoordenador"/);
  assert.match(modal, /id="agendaReciboTipoConta"/);
});

test('beneficiários incluem participante e somente acompanhantes cadastrados', () => {
  const server = readProjectFile('WebApp.gs');
  const client = readProjectFile('IndexAgendaScripts.html');

  assert.match(server, /var beneficiarios = \[beneficiario\(participante, 'Participante'/);
  assert.match(server, /\(participante\.acompanhantes \|\| \[\]\)\.forEach/);
  assert.match(server, /beneficiario\(acompanhante, 'Acompanhante'/);
  assert.match(server, /tipoConta: String\(pessoa\.tipoConta/);
  assert.match(client, /data\.beneficiarios\.map/);
  assert.match(client, /pessoa\.valorPadrao/);
  assert.match(client, /agendaReciboTipoConta/);
});

test('recibo permite revisão e gera impressão sem persistir dados', () => {
  const client = readProjectFile('IndexAgendaScripts.html');

  assert.match(client, /agendaReciboValorNumero_/);
  assert.match(client, /agendaReciboPrintHtml_/);
  assert.match(client, /agendaAbrirJanelaImpressao/);
  assert.match(client, /1ª via — Financeiro UCS/);
  assert.match(client, /2ª via — IPS\/UCS/);
  assert.match(client, /3ª via — Participante\/Acompanhante/);
  assert.match(client, /getPatientDisplayLogoSrc/);
  assert.match(client, /receipt-copy/);
  assert.match(client, /var viaIps = viaIndex === 1/);
  assert.match(client, /viaIps \? 'participante nº '/);
  assert.match(client, /!viaIps && recibo\.endereco/);
  assert.match(client, /viaIps \? '' : '<div class="bank/);
  assert.match(client, /Rubrica do\(a\) coordenador\(a\) de estudos/);
  assert.match(client, /receipt-signatures/);
  assert.match(client, /Tipo de conta: ' \+ recibo\.tipoConta/);
  assert.match(client, /\.receipt \.place\{text-align:center/);
  assert.match(client, /relacionadas à visita[^\n]+<\/b> do projeto/);
  assert.doesNotMatch(client, /salvarAgendaRecibo|registrarAgendaRecibo/);
});

test('valor do recibo é convertido automaticamente para reais e centavos por extenso', () => {
  const context = receiptValueContext();

  assert.equal(context.agendaReciboValorExtenso_(100), 'cem reais');
  assert.equal(context.agendaReciboValorExtenso_(125.5), 'cento e vinte e cinco reais e cinquenta centavos');
  assert.equal(context.agendaReciboValorExtenso_(0.75), 'setenta e cinco centavos');
  assert.equal(context.agendaReciboValorExtenso_(1000.01), 'mil reais e um centavo');
});
