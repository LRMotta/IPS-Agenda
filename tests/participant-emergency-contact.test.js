'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function fixture(extraHeaders, extraValues) {
  const headers = ['ID','Nome','Nascimento','Idade','ID Participante','Projeto','Braço','Última visita','Status','Telefone','CPF','Obs','ID Pessoa'].concat(extraHeaders || []);
  const row = ['1','Pessoa','','','P1','Estudo','A','','Ativo','(54) 99999-0000','52998224725','','PES1'].concat(extraValues || []);
  const sheet = new FakeSheet('Participantes', [headers, row]);
  const book = new FakeSpreadsheet({ Participantes: sheet });
  const server = runFiles(['CadastroRules.gs','WebApp.gs'], {
    Date, SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} }, Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'unique-test-id', formatDate: d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexAssertCanRead_ = () => {};
  server.codexWithDocumentLock_ = (_, f) => f();
  server.codexLogPerformance_ = () => {};
  server.getProjetosParticipantesOptions_ = () => ['Estudo'];
  server.brasilNormalizarLocalidade_ = () => {};
  server.clearCodexRuntimeCaches_ = () => {};
  server.clearTransporteOptionsCache_ = () => {};
  server.codexWriteAuditChanges_ = () => {};
  server.participantePossuiEventoAgenda_ = () => false;
  server.getCodexSpreadsheet_ = () => book;
  const payload = { sexoNascimento: 'Não informado', id: '1', nome: 'Pessoa', idParticipante: 'P1', projeto: 'Estudo', braco: 'A', status: 'Ativo', cpf: '52998224725', telefone: '(54) 99999-0000', idPessoa: 'PES1' };
  const cell = label => sheet.rows[1][sheet.rows[0].indexOf(label)];
  return { server, sheet, payload, cell };
}

const LABELS = ['Contato de emergência', 'Grau de proximidade do contato de emergência', 'Telefone do contato de emergência'];

test('contato de emergência cria as colunas, grava e volta no cadastro', () => {
  const { server, sheet, payload, cell } = fixture();
  payload.contatoEmergenciaNome = '  Maria Souza ';
  payload.contatoEmergenciaGrau = 'Filho(a)';
  payload.contatoEmergenciaTelefone = '(54) 98888-1111';
  assert.match(server.salvarDadosParticipante(payload), /atualizado/);
  LABELS.forEach(label => assert.ok(sheet.rows[0].indexOf(label) >= 0, label));
  assert.equal(cell(LABELS[0]), 'Maria Souza');
  assert.equal(cell(LABELS[1]), 'Filho(a)');
  assert.equal(cell(LABELS[2]), '(54) 98888-1111');
  const dto = server.participanteDadosDaLinha_(sheet.rows[1], sheet.rows[0], { data: '', visita: '---' }, false);
  assert.equal(dto.contatoEmergenciaNome, 'Maria Souza');
  assert.equal(dto.contatoEmergenciaGrau, 'Filho(a)');
  assert.equal(dto.contatoEmergenciaTelefone, '(54) 98888-1111');
});

test('cliente que omite o contato de emergência preserva o valor gravado', () => {
  const { server, payload, cell } = fixture(LABELS, ['João', 'Irmão/Irmã', '(54) 97777-2222']);
  assert.match(server.salvarDadosParticipante(payload), /atualizado/);
  assert.equal(cell(LABELS[0]), 'João');
  assert.equal(cell(LABELS[1]), 'Irmão/Irmã');
  assert.equal(cell(LABELS[2]), '(54) 97777-2222');
});

test('contato de emergência é opcional e pode ser apagado pelo formulário', () => {
  const { server, payload, cell } = fixture(LABELS, ['João', 'Irmão/Irmã', '(54) 97777-2222']);
  Object.assign(payload, { contatoEmergenciaNome: '', contatoEmergenciaGrau: '', contatoEmergenciaTelefone: '' });
  assert.match(server.salvarDadosParticipante(payload), /atualizado/);
  LABELS.forEach(label => assert.equal(cell(label), ''));
});

test('formulário do participante oferece e envia o contato de emergência como dado da pessoa', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  assert.match(modal, /> Contato de emergência<\/div>/);
  ['ptEmergenciaNome', 'ptEmergenciaGrau', 'ptEmergenciaTelefone'].forEach(id => assert.match(modal, new RegExp('id="' + id + '"')));
  assert.match(client, /contatoEmergenciaNome: document\.getElementById\('ptEmergenciaNome'\)\.value\.trim\(\)/);
  assert.match(client, /contatoEmergenciaGrau: document\.getElementById\('ptEmergenciaGrau'\)\.value\.trim\(\)/);
  assert.match(client, /contatoEmergenciaTelefone: document\.getElementById\('ptEmergenciaTelefone'\)\.value\.trim\(\)/);
  assert.match(client, /participanteDefinirPessoaSomenteLeitura_\(locked\) \{\s*\[[^\]]*'ptEmergenciaNome','ptEmergenciaGrau','ptEmergenciaTelefone'\]/);
  assert.match(client, /ptEmergenciaNome'\)\.value=participante\.contatoEmergenciaNome/);
});
