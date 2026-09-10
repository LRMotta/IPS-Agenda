'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

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

test('recibo lê somente o participante e o projeto envolvidos, sem os getters globais', () => {
  const calls = [];
  const sheet = (name, rows) => ({
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange(row, column, numRows = 1, numColumns = 1) {
      calls.push({ name, row, column, numRows, numColumns });
      return { getValues: () => rows.slice(row - 1, row - 1 + numRows).map((source) => source.slice(column - 1, column - 1 + numColumns)) };
    }
  });
  const participantHeader = ['ID', 'Nome', '', '', 'ID participante', 'Projeto', '', '', '', '', 'CPF', '', 'Rua', 'Número', 'Cidade', 'Estado', 'CEP', 'Banco', 'Tipo de conta', 'Agência', 'Conta corrente', 'Titular da Conta Corrente', 'CPF do Titular', 'Acompanhantes (JSON)'];
  const participant = Array(participantHeader.length).fill('');
  Object.assign(participant, { 0: 'CAD-1', 1: 'Pessoa A', 4: 'P-001', 5: 'Estudo A', 10: '123.456.789-09', 12: 'Rua A', 13: '10', 14: 'Caxias do Sul', 15: 'RS', 16: '95000-000', 17: 'Banco A', 18: 'Conta corrente', 19: '1234', 20: '5678', 21: 'Pessoa A', 22: '123.456.789-09', 23: JSON.stringify([{ id: 'ACO-1', nome: 'Acompanhante A', banco: 'Banco B' }]) });
  const projectHeader = ['ID', 'Nome', '', '', '', '', '', '', '', '', '', 'Coordenador', '', '', '', '', '', 'Ressarcimento padrão participante', 'Ressarcimento padrão acompanhante'];
  const project = Array(projectHeader.length).fill('');
  Object.assign(project, { 0: 'PROJ-1', 1: 'Estudo A', 11: 'Coordenação A', 17: 100, 18: 80 });
  const server = runFile('WebApp.gs', { AgendaServerRules_: { formPolicy: () => ({ type: 'visita' }) } });
  server.codexGetCurrentUserAccess = () => ({ ok: true });
  server.getAgendaEventoPorId = () => ({ id: 'AG-1', participanteCadastroId: 'CAD-1', participante: 'Pessoa A', idParticipante: 'P-001', projeto: 'Estudo A', tipo: 'Visita', visita: 'V1', data: '10/09/2026', dataIso: '2026-09-10' });
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: (name) => name === 'Participantes' ? sheet(name, [participantHeader, participant]) : sheet(name, [projectHeader, project]) });
  server.getParticipantes = () => { throw new Error('getter global não deve ser chamado'); };
  server.getProjetos = () => { throw new Error('getter global não deve ser chamado'); };

  const result = server.getAgendaReciboData('AG-1', 2);

  assert.equal(JSON.stringify(result.beneficiarios.map((item) => [item.nome, item.tipo, item.valorPadrao])), JSON.stringify([['Pessoa A', 'Participante', 100], ['Acompanhante A', 'Acompanhante', 80]]));
  assert.equal(result.coordenador, 'Coordenação A');
  assert.ok(calls.every((call) => call.numRows === 1 || (call.name === 'Participantes' && call.column === 1) || (call.name === 'Projetos' && call.column === 2)));
});

test('recibo normaliza estado para a sigla e o cadastro exibe apenas UF no pulldown', () => {
  const server = readProjectFile('WebApp.gs');
  const client = readProjectFile('IndexCoreScripts.html');

  assert.match(server, /function agendaReciboEstadoSigla_\(value\)/);
  assert.match(server, /agendaReciboEstadoSigla_\(pessoa\.estado\)/);
  assert.match(server, /SANTACATARINA: 'SC'/);
  assert.match(client, /option\.textContent = item\[0\];/);
  assert.match(client, /option\.setAttribute\('aria-label', item\[1\] \+ ' \(' \+ item\[0\] \+ '\)'\)/);
  assert.doesNotMatch(client, /option\.value = item\[0\]; option\.textContent = item\[0\] \+ ' — ' \+ item\[1\]/);
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
  assert.match(client, /Autorizo o crédito na conta bancária abaixo/);
  assert.match(client, /Rubrica do\(a\) coordenador\(a\) de estudos/);
  assert.match(client, /receipt-signatures/);
  assert.match(client, /Tipo de conta: ' \+ recibo\.tipoConta/);
  assert.match(client, /\.receipt \.place\{text-align:center/);
  assert.match(client, /relacionadas à visita[^\n]+<\/b> do projeto/);
  assert.doesNotMatch(client, /salvarAgendaRecibo|registrarAgendaRecibo/);
});

test('recibo valida CPF do beneficiário e do titular antes de imprimir', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const modal = readProjectFile('IndexExtraModals.html');

  assert.match(client, /function agendaReciboCpfValido_\(value\)/);
  assert.match(client, /function agendaReciboAtualizarValidacaoCpf_\(\)/);
  assert.match(client, /CPF do beneficiário/);
  assert.match(client, /CPF do titular da conta/);
  assert.match(client, /botao\.disabled = !!invalido\.length/);
  assert.match(client, /if \(!agendaReciboAtualizarValidacaoCpf_\(\)\) return;/);
  assert.match(modal, /oninput="agendaReciboFormatarCpfInput\(this\)"/);
});

test('valor do recibo é convertido automaticamente para reais e centavos por extenso', () => {
  const context = receiptValueContext();

  assert.equal(context.agendaReciboValorExtenso_(100), 'cem reais');
  assert.equal(context.agendaReciboValorExtenso_(125.5), 'cento e vinte e cinco reais e cinquenta centavos');
  assert.equal(context.agendaReciboValorExtenso_(0.75), 'setenta e cinco centavos');
  assert.equal(context.agendaReciboValorExtenso_(1000.01), 'mil reais e um centavo');
});
