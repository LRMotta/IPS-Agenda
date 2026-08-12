'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function rules() {
  return runFile('CadastroRules.gs').CadastroRules_;
}

const projectRows = [
  ['ID', 'Nome', 'Codigo'],
  ['PROJ-1', 'Estudo Aurora', 'ABC-001'],
  ['PROJ-2', 'Projeto Horizonte', 'XYZ-002']
];

const participantRows = [
  ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status', 'Telefone', 'CPF'],
  ['1', 'Pessoa A', '', '', 'P-001', 'Estudo Aurora', '', '', 'Ativo', '', '123.456.789-00'],
  ['2', 'Pessoa B', '', '', 'P-001', 'Projeto Horizonte', '', '', 'Ativo', '', '']
];

test('criacao de projeto exige os campos criticos', () => {
  const cadastro = rules();
  assert.deepEqual(
    Array.from(cadastro.requiredProjectFields({ nomeAbreviado: 'Novo estudo' })),
    ['Fase', 'Status', 'Especialidade', 'Investigador principal']
  );
});

test('cadastro de medicos usa somente especialidades do ConfigApp', () => {
  const server = readProjectFile('WebApp.gs');
  const client = readProjectFile('IndexCoreScripts.html');

  assert.match(server, /page === 'medicos'[\s\S]*?out\.config = getMedicoFormConfig\(\);[\s\S]*?out\.data = getMedicos\(\);/);
  assert.match(server, /var especialidadesConfig = getConfigValues_\('Médicos', 'Especialidade', \[\]\);/);
  assert.match(server, /especialidadesConfig\.indexOf\(especialidade\) === -1/);
  assert.match(client, /var ESPS = \[\];/);
  assert.match(client, /ESPS = \(\(res && res\.config && res\.config\.especialidades\) \|\| \[\]\)\.slice\(\);/);
  assert.doesNotMatch(client, /'Anestesiologia','Cardiologia'/);
});

test('projeto novo nao pode repetir nome ou codigo', () => {
  const cadastro = rules();
  assert.equal(cadastro.findProjectDuplicate({ nomeAbreviado: '  estudo áurora ' }, projectRows).field, 'nomeAbreviado');
  assert.equal(cadastro.findProjectDuplicate({ nomeAbreviado: 'Outro', codigo: 'abc-001' }, projectRows).field, 'codigo');
  assert.equal(cadastro.findProjectDuplicate({ nomeAbreviado: 'Novo', codigo: 'NOV-003' }, projectRows), null);
});

test('atualizacao do projeto ignora o proprio registro mas detecta outro', () => {
  const cadastro = rules();
  assert.equal(cadastro.findProjectDuplicate({ id: 'PROJ-1', nomeAbreviado: 'Estudo Aurora', codigo: 'ABC-001' }, projectRows), null);
  assert.equal(cadastro.findProjectDuplicate({ id: 'PROJ-1', nomeAbreviado: 'Projeto Horizonte' }, projectRows).field, 'nomeAbreviado');
});

test('participante so pode ser vinculado a projeto cadastrado', () => {
  const cadastro = rules();
  const options = [{ nome: 'Estudo Aurora', codigo: 'ABC-001' }];
  assert.equal(cadastro.projectExists('estudo aurora', options), true);
  assert.equal(cadastro.projectExists('Projeto inexistente', options), false);
});

test('ID e obrigatorio salvo nos status de pre-triagem', () => {
  const cadastro = rules();
  assert.equal(cadastro.participantIdOptional('Pré-triagem'), true);
  assert.equal(cadastro.participantIdOptional('Falha de pré-triagem'), true);
  assert.equal(cadastro.participantIdOptional('Ativo'), false);
  assert.deepEqual(
    Array.from(cadastro.requiredParticipantFields({ nome: 'Pessoa', projeto: 'Estudo Aurora', status: 'Ativo' })),
    ['ID do participante']
  );
});

test('participante nao pode repetir CPF nem ID dentro do mesmo projeto', () => {
  const cadastro = rules();
  assert.equal(cadastro.findParticipantDuplicate({ cpf: '12345678900', projeto: 'Outro', idParticipante: 'P-999' }, participantRows).field, 'cpf');
  assert.equal(cadastro.findParticipantDuplicate({ projeto: 'Estudo Aurora', idParticipante: 'p-001' }, participantRows).field, 'idParticipante');
  assert.equal(cadastro.findParticipantDuplicate({ projeto: 'Projeto Horizonte', idParticipante: 'P-003' }, participantRows), null);
});

test('atualizacao do participante ignora o proprio registro', () => {
  const cadastro = rules();
  assert.equal(cadastro.findParticipantDuplicate({ id: '1', projeto: 'Estudo Aurora', idParticipante: 'P-001', cpf: '12345678900' }, participantRows), null);
  assert.equal(cadastro.findParticipantDuplicate({ id: '1', projeto: 'Projeto Horizonte', idParticipante: 'P-001' }, participantRows).field, 'idParticipante');
});

test('nome repetido gera alerta, exceto para o proprio cadastro', () => {
  const cadastro = rules();
  const duplicate = cadastro.findParticipantNameDuplicate({ nome: 'Pessoa A' }, participantRows);
  assert.equal(duplicate.id, '1');
  assert.equal(duplicate.idParticipante, 'P-001');
  assert.equal(cadastro.findParticipantNameDuplicate({ id: '1', nome: 'Pessoa A' }, participantRows), null);
});

test('evento da Agenda impede exclusao do participante rastreado', () => {
  const cadastro = rules();
  const participant = { id: '81', nome: 'Pessoa A', idParticipante: 'P-001', projeto: 'Estudo Aurora' };
  assert.equal(cadastro.agendaEventMatchesParticipant(participant, {
    participante: 'Nome antigo', idParticipante: 'P-001', projeto: 'Estudo Aurora'
  }), true);
  assert.equal(cadastro.agendaEventMatchesParticipant(participant, {
    participante: 'Pessoa A', idParticipante: 'P-002', projeto: 'Estudo Aurora'
  }), false);
  assert.equal(cadastro.agendaEventMatchesParticipant(
    { id: '81', nome: 'Pessoa sem triagem', projeto: 'Estudo Aurora' },
    { participante: 'Pessoa sem triagem', projeto: 'Estudo Aurora' }
  ), true);
});

test('servidor bloqueia exclusao quando encontra evento na Agenda', () => {
  const server = readProjectFile('WebApp.gs');
  const block = sourceBetween(server, 'function excluirParticipante(', '// ════════════════════════════════\n//  MONITORES');
  assert.match(block, /participanteReferenciaCadastro_\(rows\[i\]\)/);
  assert.match(block, /codexWithDocumentLock_\('excluirParticipante'/);
  assert.match(block, /CadastroRules_\.agendaEventMatchesParticipant/);
  assert.match(block, /existe pelo menos um evento registrado para ele na Agenda/);
  assert.ok(block.indexOf('possuiEvento') < block.indexOf('sh.deleteRow'));
});

test('alerta de nome repetido orienta quando um novo cadastro e apropriado', () => {
  const client = readProjectFile('IndexCoreScripts.html');
  const modal = readProjectFile('IndexContentAfterStock.html');
  assert.match(client, /r && r\.requiresNameConfirmation/);
  assert.match(client, /salvarPartApp\(\{ confirmarNomeDuplicado: true \}\)/);
  assert.match(modal, /Participante já cadastrado/);
  assert.match(modal, /Revisar cadastro/);
  assert.match(modal, /Cadastrar mesmo assim/);
});

test('modal de participante organiza identificacao e protocolo sem remover a regra do ID', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(modal, '<!-- ══ MODAL PARTICIPANTE', '<!-- ══ MODAL MÉDICO');

  const nome = block.indexOf('id="ptNome"');
  const nascimento = block.indexOf('id="ptNasc"');
  const cpf = block.indexOf('id="ptCpf"');
  const status = block.indexOf('id="ptStatus"');
  const identificacao = block.indexOf('id="ptId"');
  const protocolo = block.indexOf('id="ptProjeto"');
  const braco = block.indexOf('id="ptBraco"');

  assert.ok(nome < nascimento && nascimento < cpf);
  assert.ok(status < identificacao && identificacao < protocolo && protocolo < braco);
  assert.match(block, /class="field" style="margin-bottom:14px;">\s*<div>\s*<label[^>]+for="ptNome"/);
  assert.match(block, /for="ptProjeto">Protocolo<\/label>/);
  assert.match(block, /id="ptIdRequiredStar"/);
  assert.match(client, /var required = !participanteIdOpcionalPorStatus\(status \? status\.value : ''\)/);
  assert.match(client, /\{ input: 'ptId', error: 'errPtId',[\s\S]*value: idObrigatorio \? idPart : 'ok' \}/);
});

test('catálogo opcional de braços fica no projeto e sugere opções no participante', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(modal, /id="pBracosProjetoList"/);
  assert.match(modal, /id="modalBracoProjeto"/);
  assert.match(modal, /id="ptBracoOpcao"/);
  assert.match(modal, /catálogo.*não bloqueia/i);
  assert.match(client, /function carregarBracosProjeto/);
  assert.match(client, /function carregarBracosParticipante/);
  assert.match(client, /function aplicarBracoProjetoSelecionado/);
  assert.match(server, /function getBracosProjeto\(projeto\)/);
  assert.match(server, /function salvarBracoProjeto\(payload\)/);
  assert.match(server, /function excluirBracoProjeto\(idBraco\)/);
});

test('tabela de participantes exibe nome e codigo do projeto como no cadastro de projetos', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(source, 'function participanteProjetoCellHtml(', 'function renderTabelaPart(');
  const context = vm.createContext({
    esc: (value) => String(value || ''),
    encontrarProjetoParticipante: (value) => value === 'SKYLINE-UC'
      ? { nome: 'SKYLINE-UC', codigo: 'SPY123-201' }
      : null
  });
  vm.runInContext(block, context);

  const html = context.participanteProjetoCellHtml({ projeto: 'SKYLINE-UC', braco: 'Braço A' });
  assert.match(html, /SKYLINE-UC/);
  assert.match(html, /SPY123-201/);
  assert.match(html, /Bra&ccedil;o: Braço A/);
  assert.match(source, /\+\'<td>\'\+participanteProjetoCellHtml\(p\)\+\'<\/td>\'/);
  assert.match(source, /projetoCadastro && projetoCadastro\.codigo/);
});

test('listagem de participantes recebe e exibe a data da ultima visita realizada', () => {
  const serverSource = readProjectFile('WebApp.gs');
  const getParticipantesBlock = sourceBetween(serverSource, 'function getParticipantes()', 'function getParticipanteFormConfig()');
  const serverContext = vm.createContext({
    getCodexSheetDataByName_: () => [
      ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status'],
      ['1', 'Pessoa A', '', '', 'P-001', 'Estudo Aurora', '', '', 'Ativo']
    ],
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: () => '01/01/2000' },
    normText_: (value) => String(value || '').trim().toLowerCase(),
    getUltimasVisitasParticipantesAgendaMap_: () => ({
      'pessoa a': { data: '21/07/2026', visita: 'Visit 3 Week 3' }
    })
  });
  vm.runInContext(getParticipantesBlock, serverContext);
  const participantes = serverContext.getParticipantes();
  assert.equal(participantes[0].ultimaVisita, 'Visit 3 Week 3');
  assert.equal(participantes[0].ultimaVisitaData, '21/07/2026');

  const clientSource = readProjectFile('IndexCoreScripts.html');
  const cellBlock = sourceBetween(clientSource, 'function participanteUltimaVisitaCellHtml(', 'function renderTabelaPart(');
  const clientContext = vm.createContext({ esc: (value) => String(value || '') });
  vm.runInContext(cellBlock, clientContext);
  const html = clientContext.participanteUltimaVisitaCellHtml(participantes[0]);
  assert.match(html, /Visit 3 Week 3/);
  assert.match(html, /21\/07\/2026/);
  assert.ok(html.indexOf('Visit 3 Week 3') < html.indexOf('21/07/2026'));
});
