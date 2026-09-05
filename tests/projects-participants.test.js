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
  ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status', 'Telefone', 'CPF', 'ID Pessoa'],
  ['1', 'Pessoa A', '', '', 'P-001', 'Estudo Aurora', '', '', 'Ativo', '', '123.456.789-00', 'PES-A'],
  ['2', 'Pessoa B', '', '', 'P-001', 'Projeto Horizonte', '', '', 'Ativo', '', '', 'PES-B']
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
  assert.equal(cadastro.findParticipantDuplicate({ cpf: '12345678900', projeto: 'Estudo Aurora', idParticipante: 'P-999' }, participantRows).field, 'cpf');
  assert.equal(cadastro.findParticipantDuplicate({ cpf: '12345678900', projeto: 'Outro', idParticipante: 'P-999' }, participantRows), null);
  assert.equal(cadastro.findParticipantDuplicate({ projeto: 'Estudo Aurora', idParticipante: 'p-001' }, participantRows).field, 'idParticipante');
  assert.equal(cadastro.findParticipantDuplicate({ projeto: 'Projeto Horizonte', idParticipante: 'P-003' }, participantRows), null);
  assert.equal(cadastro.findParticipantCpfMatch({ cpf: '12345678900', projeto: 'Outro' }, participantRows).id, '1');
  assert.equal(cadastro.findParticipantCpfMatch({ cpf: '12345678900', projeto: 'Outro' }, participantRows).idPessoa, 'PES-A');
});

test('atualizacao do participante ignora o proprio registro', () => {
  const cadastro = rules();
  assert.equal(cadastro.findParticipantDuplicate({ id: '1', projeto: 'Estudo Aurora', idParticipante: 'P-001', cpf: '12345678900' }, participantRows), null);
  assert.equal(cadastro.findParticipantDuplicate({ id: '1', projeto: 'Projeto Horizonte', idParticipante: 'P-001' }, participantRows).field, 'idParticipante');
});

test('nome repetido gera alerta, exceto para o proprio cadastro', () => {
  const cadastro = rules();
  assert.equal(cadastro.findParticipantNameMatches({ nome: 'Pessoa A' }, participantRows).length, 1);
  const duplicate = cadastro.findParticipantNameDuplicate({ nome: 'Pessoa A' }, participantRows);
  assert.equal(duplicate.id, '1');
  assert.equal(duplicate.idParticipante, 'P-001');
  assert.equal(duplicate.idPessoa, 'PES-A');
  assert.equal(duplicate.matchType, 'nome');
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
  assert.match(client, /vincularPessoaCadastroId: selectEl\.value \|\| existing\.id \|\| ''/);
  assert.match(client, /criarPessoaDistinta: true/);
  assert.match(client, /matches\.length > 1/);
  assert.match(modal, /Pessoa já cadastrada/);
  assert.match(modal, /Revisar cadastro/);
  assert.match(modal, /Cadastrar outra pessoa/);
  assert.match(modal, /confirmPartDuplicateSelect/);
  assert.match(modal, /Criar nova participação/);
});

test('servidor preserva protocolo e identificacao de participacao com historico', () => {
  const server = readProjectFile('WebApp.gs');
  const save = sourceBetween(server, 'function salvarDadosParticipante(', 'function corrigirMatrizIdadeParticipantes(');
  assert.match(save, /participantePossuiEventoAgenda_/);
  assert.match(save, /alterouProjeto \|\| alterouIdParticipante/);
  assert.match(save, /Encerre a participação atual e crie uma nova participação/);
  assert.match(save, /codexWriteAuditChanges_\('Cadastros', 'atualizarParticipacaoParticipante'/);
});

test('status encerrado nao fica disponivel para novo agendamento', () => {
  const cadastro = rules();
  assert.equal(cadastro.participantAvailableForNewAgenda('Ativo'), true);
  assert.equal(cadastro.participantAvailableForNewAgenda('Falha de Pré-Triagem'), false);
  assert.equal(cadastro.participantAvailableForNewAgenda('Falha de Triagem'), false);
  assert.equal(cadastro.participantAvailableForNewAgenda('Descontinuado'), false);
  assert.equal(cadastro.participantAvailableForNewAgenda('Óbito'), false);
});

test('modal de participante organiza identificacao e protocolo sem remover a regra do ID', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const styles = readProjectFile('IndexStylesAfterDashboard.html');
  const block = sourceBetween(modal, '<!-- ══ MODAL PARTICIPANTE', '<!-- ══ MODAL MÉDICO');

  const nome = block.indexOf('id="ptNome"');
  const nascimento = block.indexOf('id="ptNasc"');
  const cpf = block.indexOf('id="ptCpf"');
  const pessoaId = block.indexOf('id="ptPessoaId"');
  const status = block.indexOf('id="ptStatus"');
  const identificacao = block.indexOf('id="ptId"');
  const protocolo = block.indexOf('id="ptProjeto"');
  const braco = block.indexOf('id="ptBraco"');

  assert.ok(nome < nascimento && nascimento < cpf && cpf < pessoaId);
  assert.ok(status < identificacao && identificacao < protocolo && protocolo < braco);
  assert.match(block, /class="field" style="margin-bottom:14px;">\s*<div>\s*<label[^>]+for="ptNome"/);
  assert.match(block, /for="ptProjeto">Protocolo<\/label>/);
  assert.match(block, /id="ptIdRequiredStar"/);
  assert.match(block, /id="ptPessoaId"[^>]+readonly/);
  assert.match(block, /Gerado automaticamente ao salvar/);
  assert.match(block, /class="modal-box" style="max-width:900px;"/);
  assert.match(block, /class="field-row participant-protocol-fields"/);
  assert.match(client, /var required = !participanteIdOpcionalPorStatus\(status \? status\.value : ''\)/);
  assert.match(client, /\{ input: 'ptId', error: 'errPtId',[\s\S]*value: idObrigatorio \? idPart : 'ok' \}/);
  assert.match(client, /fields\.classList\.toggle\('has-catalog', !!_bracosParticipanteAtual\.length\)/);
  assert.ok(styles.includes('.participant-protocol-fields{grid-template-columns:repeat(2,minmax(0,1fr));}'));
  assert.ok(styles.includes('.participant-protocol-fields.has-catalog{grid-template-columns:repeat(3,minmax(0,1fr));}'));
  assert.ok(styles.includes('.participant-protocol-fields,.participant-protocol-fields.has-catalog{grid-template-columns:1fr}'));
});

test('cadastro existente reúne participações e oferece nova participação sem duplicar dados pessoais', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const styles = readProjectFile('IndexStylesAfterDashboard.html');
  const server = readProjectFile('WebApp.gs');

  assert.match(modal, /id="ptParticipacoesSection"/);
  assert.match(modal, /Participações em pesquisas/);
  assert.match(modal, /id="btnNovaParticipacaoPessoa"/);
  assert.match(modal, /id="ptPessoaBaseCadastroId"/);
  assert.match(client, /function abrirNovaParticipacaoPessoa\(\)/);
  assert.match(client, /function prepararNovaParticipacaoPessoa_/);
  assert.match(client, /participanteDefinirPessoaSomenteLeitura_\(true\)/);
  assert.match(client, /novaParticipacaoDireta: !!document\.getElementById\('ptPessoaBaseCadastroId'\)\.value/);
  assert.match(styles, /\.participant-participation-row\.is-current/);
  assert.match(server, /Encerre a participação atual antes de criar outra participação para esta pessoa/);
  assert.match(server, /Esta pessoa já possui uma participação ativa em/);
});

test('falha de pré-triagem usa o mesmo chip da falha de triagem', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  assert.match(source, /'falha de triagem':'chip-falhatriagem','falha de pre-triagem':'chip-falhatriagem'/);
});

test('tabela de prestadores reserva uma coluna compacta para telefone', () => {
  const styles = readProjectFile('IndexStyles.html');
  assert.match(styles, /\.prestadores-table th:nth-child\(4\) \{ width: 12%; white-space: nowrap; \}/);
  assert.match(styles, /\.prestadores-table th:nth-child\(5\) \{ width: 16%; \}/);
  assert.match(styles, /\.prestadores-table th:nth-child\(6\) \{ width: 96px; \}/);
});

test('participante oferece endereco, dados bancarios opcionais e bancos configuraveis', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  const block = sourceBetween(modal, '<!-- ══ MODAL PARTICIPANTE', '<!-- ══ MODAL MÉDICO');
  assert.match(block, /> Endereço<\/div>/);
  assert.match(block, /id="ptRua"/);
  assert.match(block, /id="ptNumero"/);
  assert.match(block, /id="ptCidade"/);
  assert.match(block, /id="ptEstado"/);
  assert.match(block, /id="ptCep"/);
  assert.match(block, /> Dados Bancários<\/div>/);
  assert.match(block, /id="ptBanco"/);
  assert.match(block, /id="ptAgencia"/);
  assert.match(block, /id="ptContaCorrente"/);
  assert.match(block, /id="ptTitularConta"/);
  assert.match(block, /id="ptCpfTitular"/);
  assert.match(client, /BANCOS_PART = cfg\.bancos \|\| \[\]/);
  assert.match(client, /Participantes: \['Status', 'Bancos'\]/);
  assert.match(client, /valores = valores\.concat\(grupo \? \(catalogoBloco\[grupo\] \|\| \[\]\) : Object\.keys\(catalogoBloco\)\)/);
  assert.match(client, /banco: document\.getElementById\('ptBanco'\)\.value/);
  assert.match(server, /bancos: getConfigValues_\('Participantes', 'Bancos', \[\]\)/);
  assert.match(server, /function participanteColumnMap_\(sh, createMissing\)/);
  assert.match(server, /function gravarParticipanteCamposNovos_/);
  assert.match(server, /\['idPessoa', 'ID Pessoa'\]/);
  assert.match(server, /function participanteGerarPessoaId_/);
  assert.match(server, /codexWithDocumentLock_\('salvarDadosParticipante'/);
  assert.match(client, /ID Pessoa: /);
});

test('edicao de participante confirma descarte ao fechar o modal', () => {
  const client = readProjectFile('IndexCoreScripts.html');
  const modal = readProjectFile('IndexContentAfterStock.html');
  assert.match(client, /#modalParticipante/);
  assert.match(client, /scope\.id === 'modalParticipante' && scope\.dataset\.editing !== '1'/);
  assert.match(client, /appClearUnsavedChanges\('modalParticipante'\);/);
  assert.match(client, /modalPart\.dataset\.editing = p \? '1' : '0'/);
  assert.match(client, /function fecharModalSeClicouFora\(e,id\) \{ if\(e\.target\.id===id\) fecharOverlay\(id\); \}/);
  assert.match(modal, /Altera&ccedil;&otilde;es n&atilde;o salvas/);
  assert.match(modal, /Deseja sair mesmo assim/);
  assert.match(modal, /Continuar editando/);
  assert.match(modal, /Sair sem salvar/);
});

test('modal de projeto amplia a area e posiciona o titulo na identificacao do protocolo', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const start = modal.indexOf('<div class="modal-overlay" id="modalProjeto"');
  const end = modal.indexOf('<div class="modal-overlay" id="modalBracoProjeto"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = modal.slice(start, end);
  const identificacao = block.indexOf('id="pNome"');
  const titulo = block.indexOf('id="pTituloCompleto"');
  const codigo = block.indexOf('id="pCodigo"');
  const regulatorio = block.indexOf('Dados Regulat');

  assert.match(block, /class="modal-box" style="max-width:900px;"/);
  assert.ok(identificacao < titulo && titulo < codigo);
  assert.ok(regulatorio > titulo);
  assert.equal(block.match(/id="pTituloCompleto"/g).length, 1);
});

test('projeto oferece tres couriers opcionais por ID com finalidade de temperatura', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  const start = modal.indexOf('<div class="modal-overlay" id="modalProjeto"');
  const end = modal.indexOf('<div class="modal-overlay" id="modalBracoProjeto"', start);
  const block = modal.slice(start, end);

  assert.match(block, /Couriers do projeto/);
  assert.match(block, /id="pCourierPrincipal"/);
  assert.match(block, /id="pCourierAdicional1"/);
  assert.match(block, /id="pCourierAdicional2"/);
  assert.match(block, /id="pCourierPrincipalTemperaturas"/);
  assert.match(block, /id="pCourierAdicional1Temperaturas"/);
  assert.match(block, /id="pCourierAdicional2Temperaturas"/);
  assert.match(block, /id="pSituacaoEnvioAmostras"/);
  assert.match(client, /COURIERS_PROJ = \(\(res && res\.couriers\) \|\| \[\]\)\.slice\(\)/);
  assert.match(client, /TEMPERATURAS_PROJ = \(\(res && res\.temperaturas\) \|\| \[\]\)\.slice\(\)/);
  assert.match(client, /function validarProjetoCouriers_/);
  assert.match(client, /courierPrincipalTemperaturas: projetoCourierTemperaturasSelecionadas_/);
  assert.match(client, /function projetoCouriersDetalheHtml_/);
  assert.match(client, /proj-detail-layout/);
  assert.match(client, /Marcos do estudo/);
  assert.match(client, /Logística de amostras/);
  assert.match(server, /Courier principal \(ID\)/);
  assert.match(server, /Temperaturas courier principal/);
  assert.match(server, /Situação envio de amostras/);
  assert.match(server, /out\.couriers = getAgendaCourierRows_\(\)/);
  assert.match(server, /out\.temperaturas = getAgendaTemperaturas_\(\)/);
  assert.match(client, /c\.disponivelProjetos !== false/);
  assert.match(client, /vínculo legado; substitua/);
  assert.match(server, /function courierDisponivelParaProjeto_/);
  assert.match(server, /não pode ser vinculada a projetos/);
});

test('cadastro de courier oferece regras operacionais opcionais de gelo', () => {
  const modal = readProjectFile('IndexExtraModals.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');

  assert.match(modal, /Regras operacionais de gelo/);
  assert.match(modal, /id="courierDisponivelProjetos"/);
  assert.match(modal, /id="courierForneceGeloColeta"/);
  assert.match(modal, /id="courierRestricaoSegunda"/);
  assert.match(modal, /id="courierRestricaoAposFeriado"/);
  assert.match(modal, /id="courierObservacaoOperacional"/);
  assert.match(client, /forneceGeloColeta: document\.getElementById\('courierForneceGeloColeta'\)\.value/);
  assert.match(client, /disponivelProjetos: document\.getElementById\('courierDisponivelProjetos'\)\.value/);
  assert.match(server, /Disponível para projetos/);
  assert.match(server, /Fornece gelo para coleta/);
  assert.match(server, /Restrição às segundas-feiras/);
  assert.match(server, /Restrição após feriado/);
  assert.match(server, /Observação operacional/);
  assert.match(server, /function garantirCourierOperationalColumns_/);
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

test('SoA oferece importacao JSON, mantem cadastro manual e associa visitas a bracos', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(modal, /id="btnImportarSoA"/);
  assert.match(modal, /id="modalSoAImport"/);
  assert.match(modal, /id="soaImportTexto"/);
  assert.match(modal, /id="soaImportArquivo"/);
  assert.match(modal, /id="soaBracosOpcoes"/);
  assert.match(client, /function previsualizarSoAJsonApp/);
  assert.match(client, /function confirmarImportacaoSoAApp/);
  assert.match(client, /function soaSelectedBracos_/);
  assert.match(server, /function validarImportacaoSoA\(payload\)/);
  assert.match(server, /function importarSoAJson\(payload\)/);
  assert.match(server, /Bra.{0,4}os \(IDs\)/);
});

test('SoA permite reordenar visitas por arraste e teclado com salvamento explícito', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(modal, /id="btnSalvarOrdemSoA"/);
  assert.match(modal, /id="btnDescartarOrdemSoA"/);
  assert.match(client, /function soaDragStart_\(event\)/);
  assert.match(client, /function soaOrdemTecla_\(event\)/);
  assert.match(client, /method: 'reordenarSoAVisitas'/);
  assert.match(server, /function reordenarSoAVisitas\(payload\)/);
  assert.match(server, /'Ordem manual'/);
});

test('SoA mostra e aplica sugestão revisável com ordem recebida e sugerida', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(modal, /id="btnSugerirOrdemSoA"/);
  assert.match(modal, /id="modalSoAOrdem"/);
  assert.match(modal, /id="soaOrderSuggestionList"/);
  assert.match(client, /function abrirSugestaoOrdemSoAApp\(\)/);
  assert.match(client, /function aplicarSugestaoOrdemSoAApp\(\)/);
  assert.match(client, /Recebida .*sugerida/);
  assert.match(server, /function soaSugerirOrdemExecucao_\(visitas, options\)/);
  assert.match(server, /MESMO_INTERVALO/);
  assert.match(server, /CICLO/);
});

test('SoA replica ciclos somente após prévia e preserva visitas existentes', () => {
  const modal = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(modal, /id="btnReplicarCicloSoA"/);
  assert.match(modal, /id="modalSoAReplicarCiclo"/);
  assert.match(modal, /id="soaCycleModelo"/);
  assert.match(modal, /id="soaCycleDestinos"/);
  assert.match(modal, /id="soaCyclePreview"/);
  assert.match(modal, /vínculos de Kit e Bulk Supply da visita-modelo são copiados/);
  assert.match(client, /function previsualizarReplicacaoCiclosSoAApp\(\)/);
  assert.match(client, /function confirmarReplicacaoCiclosSoAApp\(\)/);
  assert.match(client, /method: 'validarReplicacaoCiclosSoA'/);
  assert.match(client, /method: 'criarCiclosSoAPorReplicacao'/);
  assert.match(client, /assinaturaPrevia/);
  assert.match(server, /function soaPrepareCycleReplication_\(payload\)/);
  assert.match(server, /function validarReplicacaoCiclosSoA\(payload\)/);
  assert.match(server, /function criarCiclosSoAPorReplicacao\(payload\)/);
  assert.match(server, /Visitas já existentes não serão alteradas|serão preservadas sem alteração/);
  assert.match(client, /vínculo\(s\) de estoque/);
  assert.match(client, /modelo de Kit\/Bulk copiado/);
  assert.match(server, /vinculosEstoqueCriados/);
});

test('jornada do participante abre em janela sob demanda e combina SoA, Agenda e prontidão de estoque', () => {
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(client, /data-record-action="journey"/);
  assert.match(client, /function jornadaParticipanteOverlay_\(\)/);
  assert.match(client, /id = 'modalJornadaParticipante'/);
  assert.match(client, /method: 'consultarJornadaParticipante'/);
  assert.match(client, /reservas podem ser feitas por lote na prontidão operacional/i);
  assert.match(server, /function consultarJornadaParticipante\(payload\)/);
  assert.match(server, /function getJornadaParticipante\(payload\)/);
  assert.match(server, /getSoAVisitasProjeto\(projeto\)/);
  assert.match(server, /getKitReservasLinhas_\(\)/);
  assert.match(server, /getEstoque\(\)/);
  assert.match(server, /visitasAplicaveisIds\.indexOf\(visita\.idSoA\)/);
});

test('jornada do participante calcula e exibe a janela em torno da data ideal', () => {
  const server = runFile('WebApp.gs');
  const client = readProjectFile('IndexCoreScripts.html');
  const jornadaHtml = sourceBetween(client, 'function jornadaParticipanteHtml_', 'var _jornadaParticipanteAtual');
  const context = vm.createContext({ esc: (value) => String(value || '') });
  vm.runInContext(jornadaHtml, context);

  const janela = server.jornadaCalcularJanelaVisita_(new Date(2027, 1, 10), 7, 7);
  assert.equal(janela.inicio.getDate(), 3);
  assert.equal(janela.fim.getDate(), 17);

  const html = context.jornadaParticipanteHtml_({
    possuiSoA: true,
    visitas: [{
      codigo: 'C39D1', nome: 'Dia 1 do Ciclo 39', estado: 'PREVISTA', dataAlvo: '10/fev./2027',
      janelaInicio: '03/fev./2027', janelaFim: '17/fev./2027', kits: []
    }],
    eventosLivres: []
  });

  assert.match(html, /jornada-step-date">10\/fev\.\/2027/);
  assert.match(html, /Janela: 03\/fev\.\/2027 – 17\/fev\.\/2027/);
});

test('jornada oferece prévia CTMS lado a lado sem substituir o cálculo atual', () => {
  const client = readProjectFile('IndexCoreScripts.html');
  const styles = readProjectFile('IndexStyles.html');
  const server = readProjectFile('WebApp.gs');
  const jornadaHtml = sourceBetween(client, 'function jornadaParticipanteHtml_', 'var _jornadaParticipanteAtual');
  const context = vm.createContext({ esc: (value) => String(value || '') });
  vm.runInContext(jornadaHtml, context);
  const html = context.jornadaParticipanteHtml_({
    possuiSoA: true,
    visitas: [],
    eventosLivres: [],
    previaCtms: { somenteLeitura: true }
  });

  assert.match(html, /Prévia CTMS/);
  assert.match(html, /abrirPreviaCtmsJornada/);
  assert.match(client, /Prévia lado a lado do motor CTMS/);
  assert.match(client, /Projeto em modo de prévia/);
  assert.match(client, /Somente comparações aprovadas alimentam Jornada, janelas, alertas e estoque/);
  assert.match(client, /function definirAprovacaoCtmsJornada\(button\)/);
  assert.match(client, /Revisão CTMS pendente/);
  assert.match(client, /CTMS aprovado/);
  assert.match(server, /jornadaCtmsAplicarAoOperacional_\(visitasJornada, previaCtms, hoje\)[\s\S]*?jornadaVisitasPrevisaoSeisMeses_\(visitasJornada, hoje\)[\s\S]*?var dataAlvo = visita\.dataAlvoObj/);
  assert.match(client, /Marcos e escolhas/);
  assert.match(client, /Cálculo atual/);
  assert.match(client, /Motor CTMS/);
  assert.match(client, /Mostrar somente diferenças e revisões/);
  assert.match(client, /function filtrarPreviaCtmsJornada\(somenteAtencao\)/);
  assert.match(client, /MUDARIA: signed \? 'Mudaria '/);
  assert.match(client, /Diferença histórica/);
  assert.match(client, /Requer revisão/);
  assert.match(styles, /\.jornada-ctms-columns/);
  assert.match(styles, /\.jornada-ctms-impact/);
  assert.match(styles, /\.jornada-ctms-filter/);
  assert.match(styles, /grid-template-columns:minmax\(0,\.8fr\) minmax\(0,1\.2fr\)/);
});

test('cadastro SoA configura base amigável, papel no cronograma e referências alternativas', () => {
  const content = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const server = readProjectFile('WebApp.gs');

  assert.match(content, /id="soaBaseCalculo"/);
  assert.match(content, /id="pSoABaseCalculoPadrao"/);
  assert.match(content, /Usar a regra do protocolo/);
  assert.match(content, /id="soaAplicarBaseEquivalentes"/);
  assert.match(content, /value="MANTER_DATAS_PREVISTAS">Manter datas previstas/);
  assert.match(content, /value="RECALCULAR_VISITA_REALIZADA">Recalcular pela visita realizada/);
  assert.match(content, /id="soaPapelCronograma"/);
  assert.match(content, /id="soaReferenciaAlternativa"/);
  assert.match(content, /value="SELECAO_MANUAL">Seleção manual/);
  assert.match(client, /baseCalculo: baseCalculo/);
  assert.match(client, /soaBaseCalculoPadrao: document\.getElementById\('pSoABaseCalculoPadrao'\)\.value/);
  assert.match(client, /aplicarBaseEquivalentes: document\.getElementById\('soaAplicarBaseEquivalentes'\)\.checked/);
  assert.match(client, /referenciaAlternativa: referenciaAlternativa/);
  assert.match(client, /function soaReferenciaAlternativaChange_\(\)/);
  assert.match(client, /criterion\.value = 'SELECAO_MANUAL'/);
  assert.match(server, /'Base para o cálculo'/);
  assert.match(server, /soaNormalizarBaseCalculo_/);
  assert.match(server, /Base padrão do cronograma SoA/);
  assert.match(server, /function soaCycleEquivalentKey_\(visita\)/);
});

test('motor CTMS puro separa previsão fixa da recalculada pela realização', () => {
  const server = runFile('WebApp.gs');
  const visitas = [
    { idSoA: 'A', codigo: 'C1D1', nome: 'Ciclo 1 Dia 1', ordem: 1, referencia: 'RANDOMIZACAO', intervaloDias: 0, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'MARCO_CALCULO', ativo: true },
    { idSoA: 'B', codigo: 'C1D8-FIXA', nome: 'Dia 8 fixo', ordem: 2, referencia: 'A', intervaloDias: 7, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'VISITA_CALCULADA', ativo: true },
    { idSoA: 'C', codigo: 'C1D8-ROLANTE', nome: 'Dia 8 rolante', ordem: 3, referencia: 'A', intervaloDias: 7, baseCalculoEfetiva: 'RECALCULAR_VISITA_REALIZADA', papelCronograma: 'VISITA_CALCULADA', ativo: true }
  ];
  const result = server.jornadaCtmsCalcularPreviaPura_({
    projeto: 'MonumenTAL-3', participante: 'P-1', visitas,
    marcos: { RANDOMIZACAO: '2026-01-01' },
    eventos: [{ idSoA: 'A', visita: 'Ciclo 1 Dia 1', data: '2026-01-10', concluida: true, cancelada: false }]
  });
  const rows = Object.fromEntries(Array.from(result.linhas, row => [row.idSoA, row]));

  assert.equal(rows.A.dataPrevistaIso, '2026-01-01');
  assert.equal(rows.A.dataRealizadaIso, '2026-01-10');
  assert.equal(rows.B.dataPrevistaIso, '2026-01-08');
  assert.equal(rows.B.origemBase, 'PREVISÃO DE A');
  assert.equal(rows.C.dataPrevistaIso, '2026-01-17');
  assert.equal(rows.C.origemBase, 'REALIZAÇÃO DE A');
  assert.equal(result.somenteLeitura, true);
  assert.equal(result.motorAtivo, false);
});

test('motor CTMS não usa agendamento como realização e mantém previsão rolante provisória', () => {
  const server = runFile('WebApp.gs');
  const result = server.jornadaCtmsCalcularPreviaPura_({
    visitas: [
      { idSoA: 'A', nome: 'Marco', ordem: 1, referencia: 'RANDOMIZACAO', intervaloDias: 0, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'MARCO_CALCULO', ativo: true },
      { idSoA: 'B', nome: 'Seguimento', ordem: 2, referencia: 'A', intervaloDias: 7, baseCalculoEfetiva: 'RECALCULAR_VISITA_REALIZADA', papelCronograma: 'VISITA_CALCULADA', ativo: true }
    ],
    marcos: { RANDOMIZACAO: '2026-02-01' },
    eventos: [{ idSoA: 'A', visita: 'Marco', data: '2026-02-04', concluida: false, cancelada: false }]
  });
  const rows = Object.fromEntries(Array.from(result.linhas, row => [row.idSoA, row]));

  assert.equal(rows.A.dataAgendadaIso, '2026-02-04');
  assert.equal(rows.A.dataRealizadaIso, '');
  assert.equal(rows.B.dataPrevistaIso, '2026-02-08');
  assert.equal(rows.B.statusCalculo, 'PROVISORIA');
  assert.equal(rows.B.origemBase, 'PREVISÃO PROVISÓRIA DE A');
});

test('motor CTMS classifica impacto, diferença em dias e resumo de decisão', () => {
  const server = runFile('WebApp.gs');
  const same = server.jornadaCtmsClassificarImpacto_({
    dataPrevistaIso: '2026-04-10', statusCalculo: 'CALCULADA', provisoria: false,
    atual: { dataAlvoIso: '2026-04-10', estado: 'PREVISTA' }
  });
  const changed = server.jornadaCtmsClassificarImpacto_({
    dataPrevistaIso: '2026-04-15', statusCalculo: 'CALCULADA', provisoria: false,
    atual: { dataAlvoIso: '2026-04-10', estado: 'PREVISTA' }
  });
  const historical = server.jornadaCtmsClassificarImpacto_({
    dataPrevistaIso: '2026-04-08', statusCalculo: 'CALCULADA', provisoria: false,
    atual: { dataAlvoIso: '2026-04-10', estado: 'REALIZADA' }
  });
  const review = server.jornadaCtmsClassificarImpacto_({
    dataPrevistaIso: '', statusCalculo: 'PENDENTE', provisoria: false,
    atual: { dataAlvoIso: '2026-04-10', estado: 'PREVISTA' }
  });
  const provisionalSame = server.jornadaCtmsClassificarImpacto_({
    dataPrevistaIso: '2026-04-10', statusCalculo: 'PROVISORIA', provisoria: true,
    atual: { dataAlvoIso: '2026-04-10', estado: 'PREVISTA' }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(same)), {
    tipo: 'SEM_MUDANCA', diferencaDias: 0, requerAtencao: false,
    motivo: 'A data CTMS coincide com o cálculo atual.'
  });
  assert.equal(changed.tipo, 'MUDARIA');
  assert.equal(changed.diferencaDias, 5);
  assert.match(changed.motivo, /5 dia\(s\).*depois/);
  assert.equal(historical.tipo, 'DIVERGENCIA_HISTORICA');
  assert.equal(historical.diferencaDias, -2);
  assert.match(historical.motivo, /histórico não será alterado/);
  assert.equal(review.tipo, 'REVISAO');
  assert.equal(review.requerAtencao, true);
  assert.equal(provisionalSame.tipo, 'SEM_MUDANCA');
  assert.equal(provisionalSame.requerAtencao, true);
  assert.match(provisionalSame.motivo, /depende da realização/);
});

test('motor CTMS exige escolha manual, filtra braço e fica restrito aos projetos piloto', () => {
  const server = runFile('WebApp.gs');
  const result = server.jornadaCtmsCalcularPreviaPura_({
    bracoId: 'BR-A',
    visitas: [
      { idSoA: 'A', nome: 'Marco A', ordem: 1, referencia: 'RANDOMIZACAO', intervaloDias: 0, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'MARCO_CALCULO', ativo: true, bracoIds: ['BR-A'] },
      { idSoA: 'B', nome: 'Alternativa', ordem: 2, referencia: 'A', referenciaAlternativa: 'PROGRESSAO_DOENCA', criterioReferencias: 'SELECAO_MANUAL', intervaloDias: 5, baseCalculoEfetiva: 'RECALCULAR_VISITA_REALIZADA', papelCronograma: 'VISITA_CALCULADA', ativo: true, bracoIds: ['BR-A'] },
      { idSoA: 'OUTRO', nome: 'Outro braço', ordem: 3, referencia: 'A', intervaloDias: 9, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'VISITA_CALCULADA', ativo: true, bracoIds: ['BR-B'] }
    ],
    marcos: { RANDOMIZACAO: '2026-03-01', PROGRESSAO_DOENCA: '2026-04-01' }
  });

  assert.deepEqual(Array.from(result.linhas, row => row.idSoA), ['A', 'B']);
  assert.equal(result.linhas[1].statusCalculo, 'PENDENTE');
  assert.match(result.linhas[1].avisos.join(' '), /seleção manual/);
  assert.equal(server.jornadaCtmsProjetoPiloto_('MonumenTAL-3'), true);
  assert.equal(server.jornadaCtmsProjetoPiloto_('CONFIRMATION-HF'), true);
  assert.equal(server.jornadaCtmsProjetoPiloto_('Outro protocolo'), false);
});

test('marcos e escolhas CTMS são individuais e a ativação continua manual no projeto', () => {
  const content = readProjectFile('IndexContentAfterStock.html');
  const client = readProjectFile('IndexCoreScripts.html');
  const serverSource = readProjectFile('WebApp.gs');
  const server = runFile('WebApp.gs');

  assert.match(content, /id="pCtmsJornadaAtivo"/);
  assert.match(content, /Não — somente prévia/);
  assert.match(client, /ctmsJornadaAtivo: document\.getElementById\('pCtmsJornadaAtivo'\)\.value === 'Sim'/);
  assert.match(client, /function abrirConfiguracaoCtmsJornada\(\)/);
  assert.match(client, /method: 'salvarConfiguracaoCtmsParticipante'/);
  assert.match(serverSource, /header: 'CTMS Braço ID'/);
  assert.match(serverSource, /header: 'CTMS Marcos \(JSON\)'/);
  assert.match(serverSource, /header: 'CTMS Escolhas \(JSON\)'/);
  assert.match(serverSource, /header: 'CTMS Aprovações \(JSON\)'/);
  assert.match(serverSource, /codexAssertCanWrite_\('salvarConfiguracaoCtmsParticipante'/);
  assert.match(serverSource, /codexAssertCanWrite_\('definirAprovacaoCtmsParticipante'/);

  const config = server.jornadaCtmsMontarConfiguracao_([
    { idSoA: 'A', nome: 'Marco', referencia: 'RANDOMIZACAO', ativo: true, bracoIds: ['BR-A'] },
    { idSoA: 'B', codigo: 'V2', nome: 'Seguimento', referencia: 'A', referenciaAlternativa: 'PROGRESSAO_DOENCA', criterioReferencias: 'SELECAO_MANUAL', ativo: true, bracoIds: ['BR-A'] },
    { idSoA: 'C', nome: 'Outro braço', referencia: 'INCLUSAO', ativo: true, bracoIds: ['BR-B'] }
  ], [{ idBraco: 'BR-A', nome: 'Braço A' }, { idBraco: 'BR-B', nome: 'Braço B' }], {
    bracoId: 'BR-A', marcos: { RANDOMIZACAO: '2026-03-01' }, escolhasReferencias: { B: 'A' }
  }, '');
  assert.deepEqual(Array.from(config.marcosNecessarios, item => item.chave), ['RANDOMIZACAO', 'PROGRESSAO_DOENCA']);
  assert.deepEqual(Array.from(config.escolhasNecessarias, item => item.idSoA), ['B']);
  assert.equal(config.escolhasReferencias.B, 'A');

  assert.throws(() => server.jornadaCtmsNormalizarConfigParticipante_({ bracoId: 'BR-X' }, [], [{ idBraco: 'BR-A' }]), /não pertence/);
  assert.throws(() => server.jornadaCtmsNormalizarConfigParticipante_({ marcos: { RANDOMIZACAO: '2026-02-31' } }, [], []), /inválida/);
});

test('ativação CTMS altera somente previsões futuras calculadas e preserva Agenda e histórico', () => {
  const server = runFile('WebApp.gs');
  const visitas = [
    { idSoA: 'R', estado: 'REALIZADA', dataAlvoIso: '2026-01-01' },
    { idSoA: 'A', estado: 'AGENDADA', dataAlvoIso: '2026-01-05' },
    { idSoA: 'P', estado: 'PREVISTA', dataAlvoIso: '2026-01-10' },
    { idSoA: 'X', estado: 'A_PROGRAMAR', dataAlvoIso: '' }
  ];
  const previa = { motorAtivo: true, linhas: [
    { idSoA: 'R', statusCalculo: 'CALCULADA', dataPrevistaIso: '2026-02-01', dataPrevista: '01/02/2026' },
    { idSoA: 'A', statusCalculo: 'CALCULADA', dataPrevistaIso: '2026-02-05', dataPrevista: '05/02/2026' },
    { idSoA: 'P', statusCalculo: 'CALCULADA', dataPrevistaIso: '2026-02-10', dataPrevista: '10/02/2026', janelaInicio: '08/02/2026', janelaFim: '12/02/2026', aprovada: true },
    { idSoA: 'X', statusCalculo: 'PENDENTE', dataPrevistaIso: '' }
  ] };
  const result = server.jornadaCtmsAplicarAoOperacional_(visitas, previa, new Date(2026, 1, 9));
  assert.equal(result[0].dataAlvoIso, '2026-01-01');
  assert.equal(result[1].dataAlvoIso, '2026-01-05');
  assert.equal(result[2].dataAlvoIso, '2026-02-10');
  assert.equal(result[2].fontePrevisao, 'CTMS');
  assert.equal(result[2].ctmsComparacao.integrada, true);
  assert.equal(result[2].emJanela, true);
  assert.equal(result[2].atrasada, false);
  assert.equal(result[3].estado, 'A_PROGRAMAR');
  assert.equal(visitas[2].dataAlvoIso, '2026-01-10');
});

test('participante legado sem colunas CTMS continua legível e sem mutação', () => {
  const server = runFile('WebApp.gs');
  server.getCodexSheetDataByName_ = () => [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto'],
    ['CAD-1', 'Pessoa', '', '', 'P-1', 'Projeto A']
  ];
  const config = server.jornadaCtmsLerConfigParticipante_({ idCadastro: 'CAD-1' });
  assert.deepEqual(JSON.parse(JSON.stringify(config)), { bracoId: '', marcos: {}, escolhasReferencias: {}, aprovacoes: {} });
});

test('aprovação CTMS fica vinculada à comparação e expira quando o cálculo muda', () => {
  const server = runFile('WebApp.gs');
  const visitas = [{ idSoA: 'A', nome: 'Marco', ordem: 1, referencia: 'RANDOMIZACAO', intervaloDias: 0, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'MARCO_CALCULO', ativo: true }];
  const input = {
    projeto: 'MonumenTAL-3', participante: 'P-1', motorAtivo: true, visitas,
    marcos: { RANDOMIZACAO: '2026-03-01' },
    legacyVisitas: [{ idSoA: 'A', estado: 'A_PROGRAMAR', dataAlvoIso: '', dataAlvo: '' }]
  };
  const pending = server.jornadaCtmsCalcularPreviaPura_(input);
  assert.equal(pending.linhas[0].aprovavel, true);
  assert.equal(pending.linhas[0].aprovada, false);
  assert.equal(pending.resumo.pendentesAprovacao, 1);

  const approved = server.jornadaCtmsCalcularPreviaPura_(Object.assign({}, input, {
    aprovacoes: { A: { fingerprint: pending.linhas[0].fingerprint, aprovadoEm: '2026-08-28T10:00:00-03:00', aprovadoPor: 'qa@example.org' } }
  }));
  assert.equal(approved.linhas[0].aprovada, true);
  assert.equal(approved.resumo.aprovadas, 1);

  const changed = server.jornadaCtmsCalcularPreviaPura_(Object.assign({}, input, {
    marcos: { RANDOMIZACAO: '2026-03-02' },
    aprovacoes: { A: { fingerprint: pending.linhas[0].fingerprint } }
  }));
  assert.equal(changed.linhas[0].aprovada, false);
  assert.equal(changed.linhas[0].aprovacaoObsoleta, true);
  assert.notEqual(changed.linhas[0].fingerprint, pending.linhas[0].fingerprint);
});

test('CTMS ativo sem aprovação anota alerta mas não altera jornada, janela ou estoque', () => {
  const server = runFile('WebApp.gs');
  const original = [{ idSoA: 'P', estado: 'PREVISTA', dataAlvoIso: '2026-01-10', dataAlvo: '10/01/2026', dataAlvoObj: new Date(2026, 0, 10), janelaInicio: '08/01/2026', janelaFim: '12/01/2026' }];
  const previa = { motorAtivo: true, linhas: [{ idSoA: 'P', statusCalculo: 'CALCULADA', dataPrevistaIso: '2026-02-10', dataPrevista: '10/02/2026', janelaInicio: '08/02/2026', janelaFim: '12/02/2026', aprovada: false, aprovavel: true, impacto: { motivo: 'Mudaria a data.' } }] };
  const result = server.jornadaCtmsAplicarAoOperacional_(original, previa, new Date(2026, 1, 9));
  assert.equal(result[0].dataAlvoIso, '2026-01-10');
  assert.equal(result[0].fontePrevisao, undefined);
  assert.equal(result[0].ctmsComparacao.integrada, false);
  assert.equal(result[0].ctmsComparacao.aprovavel, true);
  assert.equal(original[0].ctmsComparacao, undefined);
});

test('motor CTMS resolve primeiro e último marco e preserva visita legada sem regra', () => {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => { throw new Error('motor puro não pode acessar planilhas'); } }
  });
  const visitas = [
    { idSoA: 'A', nome: 'Marco inicial', ordem: 1, referencia: 'RANDOMIZACAO', intervaloDias: 0, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'MARCO_CALCULO', ativo: true },
    { idSoA: 'FIRST', nome: 'Primeiro marco', ordem: 2, referencia: 'A', referenciaAlternativa: 'PROGRESSAO_DOENCA', criterioReferencias: 'PRIMEIRO_OCORRER', intervaloDias: 2, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'VISITA_CALCULADA', ativo: true },
    { idSoA: 'LAST', nome: 'Último marco', ordem: 3, referencia: 'A', referenciaAlternativa: 'PROGRESSAO_DOENCA', criterioReferencias: 'ULTIMO_OCORRER', intervaloDias: 2, baseCalculoEfetiva: 'MANTER_DATAS_PREVISTAS', papelCronograma: 'VISITA_CALCULADA', ativo: true },
    { idSoA: 'LEGACY', nome: 'Visita legada', ordem: 4, referencia: 'A', intervaloDias: 10, baseCalculoEfetiva: '', papelCronograma: '', ativo: true }
  ];
  const before = JSON.stringify(visitas);
  const result = server.jornadaCtmsCalcularPreviaPura_({
    visitas,
    marcos: { RANDOMIZACAO: '2026-03-01', PROGRESSAO_DOENCA: '2026-04-01' },
    legacyVisitas: [{ idSoA: 'LEGACY', dataAlvo: '11/03/2026', dataAlvoIso: '2026-03-11', estado: 'PREVISTA' }]
  });
  const rows = Object.fromEntries(Array.from(result.linhas, row => [row.idSoA, row]));

  assert.equal(rows.FIRST.referenciaUtilizada, 'A');
  assert.equal(rows.FIRST.dataPrevistaIso, '2026-03-03');
  assert.equal(rows.LAST.referenciaUtilizada, 'PROGRESSAO_DOENCA');
  assert.equal(rows.LAST.dataPrevistaIso, '2026-04-03');
  assert.equal(rows.LEGACY.statusCalculo, 'SEM_REGRA');
  assert.equal(rows.LEGACY.dataPrevistaIso, '');
  assert.equal(rows.LEGACY.atual.dataAlvoIso, '2026-03-11');
  assert.equal(JSON.stringify(visitas), before);
});

test('jornada inicia na primeira visita registrada pelo IPS e não reinicia a prontidão em etapas históricas', () => {
  const server = runFile('WebApp.gs');
  const visitas = server.jornadaVisitasDesdeInicioOperacional_([
    { idSoA: 'TRIAGEM', nome: 'Visita de Triagem', temEventoIPS: false },
    { idSoA: 'C1D1', nome: 'Dia 1 do Ciclo 1', temEventoIPS: false },
    { idSoA: 'C39D1', nome: 'Dia 1 do Ciclo 39', temEventoIPS: true },
    { idSoA: 'C40D1', nome: 'Dia 1 do Ciclo 40', temEventoIPS: true },
    { idSoA: 'C41D1', nome: 'Dia 1 do Ciclo 41', temEventoIPS: false }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(visitas.map(visita => visita.idSoA))), ['C39D1', 'C40D1', 'C41D1']);
  assert.deepEqual(JSON.parse(JSON.stringify(server.jornadaVisitasDesdeInicioOperacional_([
    { idSoA: 'TRIAGEM', temEventoIPS: false }, { idSoA: 'C1D1', temEventoIPS: false }
  ]).map(visita => visita.idSoA))), ['TRIAGEM', 'C1D1']);
});

test('conciliação mantém todas as visitas ativas do SoA, mesmo antes do início operacional da jornada', () => {
  const server = runFile('WebApp.gs');
  const client = readProjectFile('IndexCoreScripts.html');
  const visitasJornada = server.jornadaVisitasDesdeInicioOperacional_([
    { idSoA: 'TRI', nome: 'Triagem', ativo: true, temEventoIPS: false },
    { idSoA: 'D180', nome: 'Day 180', ativo: true, temEventoIPS: true },
    { idSoA: 'EOS', nome: 'Final do Estudo', ativo: true, temEventoIPS: false }
  ]);
  const visitasConciliacao = server.jornadaVisitasParaConciliacao_([
    { idSoA: 'TRI', nome: 'Triagem', ativo: true },
    { idSoA: 'D180', nome: 'Day 180', ativo: true },
    { idSoA: 'EOS', nome: 'Final do Estudo', ativo: true },
    { idSoA: 'INATIVA', nome: 'Visita inativa', ativo: false }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(visitasJornada.map(visita => visita.idSoA))), ['D180', 'EOS']);
  assert.deepEqual(JSON.parse(JSON.stringify(visitasConciliacao.map(visita => visita.idSoA))), ['TRI', 'D180', 'EOS']);
  assert.match(client, /var visitas = dados\.visitasConciliacao \|\| dados\.visitas \|\| \[\];/);
});

test('jornada limita a prontidão às próximas visitas calculáveis em até seis meses', () => {
  const server = runFile('WebApp.gs');
  const hoje = new Date(2026, 7, 21);
  const visitas = server.jornadaVisitasPrevisaoSeisMeses_([
    { idSoA: 'C33', estado: 'AGENDADA', dataAlvoObj: new Date(2026, 7, 26) },
    { idSoA: 'C34', estado: 'PREVISTA', dataAlvoObj: new Date(2027, 1, 21) },
    { idSoA: 'C35', estado: 'PREVISTA', dataAlvoObj: new Date(2027, 1, 22) },
    { idSoA: 'C32', estado: 'REALIZADA', dataAlvoObj: new Date(2026, 7, 1) }
  ], hoje);

  assert.deepEqual(JSON.parse(JSON.stringify(visitas.map(visita => visita.idSoA))), ['C33', 'C34']);
  assert.equal(server.jornadaLimitePrevisao_(hoje).getMonth(), 1);
});

test('jornada oferece reserva antecipada por lote com vínculo posterior à Agenda', () => {
  const client = readProjectFile('IndexCoreScripts.html');
  const styles = readProjectFile('IndexStyles.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(client, /function abrirReservaPreviaJornada\(idSoA\)/);
  assert.match(client, /method: 'consultarReservaPreviaJornada'/);
  assert.match(client, /method: 'reservarKitsPrevisaoJornada'/);
  assert.match(client, /visitasProntidao/);
  assert.match(server, /function consultarReservaPreviaJornada\(payload\)/);
  assert.match(server, /function reservarKitsPrevisaoJornada\(payload\)/);
  assert.match(server, /jornada: getJornadaParticipante\(/);
  assert.match(server, /próximos 6 meses/);
  assert.match(server, /Agenda_ID|agendaId/);
  assert.doesNotMatch(client, /btn-(?:primary|secondary)/);
  assert.match(client, /ag-tb-btn primary/);
  assert.match(styles, /jornada-history-row/);
  assert.match(styles, /jornada-reserve-actions \.ag-tb-btn/);
});

test('jornada reconhece a reserva persistida e exibe quantidade e lote no cartão', () => {
  const server = runFile('WebApp.gs');
  const reservaAtiva = {
    idReserva: 'RES-41', idItem: '2', idLote: 'LOTE-41', qtde: 1,
    status: 'Reservado', visitaPrevista: 'Dia 1 do Ciclo 41'
  };
  const reservas = [
    { idReserva: 'RES-ANTIGA', idItem: '2', idLote: 'LOTE-40', qtde: 1, status: 'Substituída', visitaPrevista: 'Dia 1 do Ciclo 41' },
    reservaAtiva
  ];
  const encontradas = server.jornadaReservasModeloVisita_(
    reservas,
    { idItem: 2 },
    { nome: 'Dia 1 do Ciclo 41', codigo: 'C41D1', aliases: [] }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(encontradas)), [reservaAtiva]);

  const client = readProjectFile('IndexCoreScripts.html');
  const jornadaHtml = sourceBetween(client, 'function jornadaParticipanteHtml_', 'var _jornadaParticipanteAtual');
  const context = vm.createContext({ esc: value => String(value == null ? '' : value) });
  vm.runInContext(jornadaHtml, context);
  const html = context.jornadaParticipanteHtml_({
    possuiSoA: true,
    visitas: [],
    visitasProntidao: [{
      idSoA: 'C41D1', nome: 'Dia 1 do Ciclo 41', estado: 'PREVISTA', dataAlvo: '16/set./2026',
      kits: [{ idReserva: 'RES-41', idItem: '2', descricao: 'T-3 Disease Evaluation', reservado: true, qtdeReservada: 1, lote: 'LOTE-41', validade: '30/09/2026', reservaValida: true }]
    }],
    eventosLivres: []
  });

  assert.match(html, /chip chip-green jornada-kit-status">Reservado/);
  assert.match(html, /Quantidade: 1 · Lote LOTE-41 · validade 30\/09\/2026/);
  assert.doesNotMatch(html, />Reservar<\/button>/);
  assert.match(html, /> Gerenciar<\/button>/);
});

test('gestão da reserva na jornada reutiliza ajuste, substituição e cancelamento auditáveis', () => {
  const client = readProjectFile('IndexCoreScripts.html');
  assert.match(client, /function abrirGestaoReservaJornada\(idSoA, idItem\)/);
  assert.match(client, /method: trocouLote \? 'substituirReservaKitAgenda' : 'ajustarReservaKitAgenda'/);
  assert.match(client, /method: 'cancelarReservaKitAgenda'/);
  assert.match(client, /retornarJornada: true/);
  assert.match(client, /Toda alteração exige justificativa e preserva o histórico/);
  assert.match(client, /abrirConfirmacaoDestrutiva/);
});

test('gestão da reserva escolhe ajuste ou substituição conforme o lote selecionado', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(source, 'function salvarGestaoReservaJornada()', 'function cancelarGestaoReservaJornada()');
  function executar(lote) {
    let request;
    const elements = {
      jornadaGestaoLote: { value: lote },
      jornadaGestaoQuantidade: { value: '2' },
      jornadaGestaoJustificativa: { value: 'Correção operacional.' },
      statusGestaoReservaJornada: { textContent: '' },
      btnSalvarGestaoReservaJornada: { disabled: false }
    };
    const context = vm.createContext({
      window: { _jornadaGestaoReserva: { contexto: { braco: 'A' }, kit: { idReserva: 'RES-41', lote: 'LOTE-41', qtdeReservada: 1 } } },
      document: { getElementById: id => elements[id] || null },
      appServerRun: opts => { request = opts; },
      jornadaAplicarRespostaAtualizada_: () => {},
      isFinite,
      Object,
      String,
      Number
    });
    vm.runInContext(block, context);
    context.salvarGestaoReservaJornada();
    return request;
  }

  const ajuste = executar('LOTE-41');
  assert.equal(ajuste.method, 'ajustarReservaKitAgenda');
  assert.equal(ajuste.args[0].retornarJornada, true);
  const substituicao = executar('LOTE-42');
  assert.equal(substituicao.method, 'substituirReservaKitAgenda');
  assert.equal(substituicao.args[0].novoIdLote, 'LOTE-42');
});

test('consulta de reserva da jornada migra IDs de lotes legados antes de listar opções', () => {
  const server = runFile('WebApp.gs');
  let migrou = false;
  let leituras = 0;
  server.codexAssertCanWrite_ = () => {};
  server.jornadaReservaPreviaContexto_ = () => ({
    dataVisita: new Date(2026, 8, 23),
    modelos: [{ idItem: 'KIT-LEGADO', descricao: 'Kit legado', laboratorio: '' }]
  });
  server.migrarIdsLotesEstoque = () => { migrou = true; };
  server.getEstoque = () => {
    leituras++;
    return [{
      idItem: 'KIT-LEGADO', idLote: migrou ? 'LOTE-GERADO' : '', validade: '30/11/2026',
      qtdeDisponivel: 2, accessionNumber: ''
    }];
  };

  const result = server.consultarReservaPreviaJornada({ participanteId: 'P-1', idSoA: 'SOA-1' });

  assert.deepEqual(JSON.parse(JSON.stringify(result.kits[0].lotes)), [{
    idLote: 'LOTE-GERADO', validade: '30/11/2026', qtdeDisponivel: 2, accessionNumber: ''
  }]);
  assert.equal(leituras, 2, 'o estoque deve ser relido depois da migração');
  assert.match(readProjectFile('IndexCoreScripts.html'), /\(kit\.lotes \|\| \[\]\)\.filter\(function\(lote\) \{ return String\(lote && lote\.idLote/);
});

test('telefones dos cadastros usam o padrão brasileiro', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(source, 'function formatarTelefoneBrasileiro(valor)', 'var SEARCH_CLEAR_HANDLERS');
  const context = vm.createContext({ String });
  vm.runInContext(block, context);

  assert.equal(context.formatarTelefoneBrasileiro('54999123456'), '(54) 99912 3456');
  assert.equal(context.formatarTelefoneBrasileiro('5432123456'), '(54) 3212 3456');
  assert.equal(context.formatarTelefoneBrasileiro('+55 54 99912-3456'), '(54) 99912 3456');
  assert.match(readProjectFile('IndexContentAfterStock.html'), /ptTelefone[\s\S]*inputmode="tel"/);
  assert.match(readProjectFile('IndexContentAfterStock.html'), /mTel[\s\S]*inputmode="tel"/);
  assert.match(readProjectFile('IndexExtraModals.html'), /prestTelefone[\s\S]*inputmode="tel"/);
  assert.match(source, /p\.telefone \? formatarTelefoneBrasileiro\(p\.telefone\)/);
});

test('reserva prévia da jornada envia os lotes visivelmente selecionados no modal', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(source, 'function jornadaKitsSelecionadosParaReserva_()', 'function salvarConcilicaoVisitasParticipante()');
  const status = { textContent: '' };
  const button = { disabled: false };
  const selected = [
    { dataset: { jornadaItem: 'KIT-42' }, value: 'LOTE-A', selectedIndex: 0, options: [{ getAttribute: () => 'ACC-A' }], parentNode: { querySelector: () => ({ value: '2' }) } },
    { dataset: { jornadaItem: 'KIT-43' }, value: 'LOTE-B', selectedIndex: 0, options: [{ getAttribute: () => 'ACC-B' }], parentNode: { querySelector: () => ({ value: '1' }) } }
  ];
  let request;
  const context = vm.createContext({
    window: { _jornadaReservaPrevia: { contexto: { participanteId: 'P-42' } } },
    document: { getElementById: (id) => id === 'jornadaReservaPreviaConteudo' ? { querySelectorAll: () => selected } : id === 'statusReservaPreviaJornada' ? status : id === 'btnConfirmarReservaJornada' ? button : null },
    appServerRun: (opts) => { request = opts; },
    isFinite,
    Object,
    Array
  });
  vm.runInContext(block, context);

  context.confirmarReservaPreviaJornada();

  assert.equal(button.disabled, true);
  assert.equal(status.textContent, 'Reservando lotes…');
  assert.equal(request.method, 'reservarKitsPrevisaoJornada');
  assert.deepEqual(JSON.parse(JSON.stringify(request.args[0].kits)), [
    { idItem: 'KIT-42', idLote: 'LOTE-A', qtde: 2, accessionNumber: 'ACC-A' },
    { idItem: 'KIT-43', idLote: 'LOTE-B', qtde: 1, accessionNumber: 'ACC-B' }
  ]);
});

test('reserva prévia atualiza a jornada com a resposta da própria gravação', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(source, 'function jornadaAplicarRespostaAtualizada_', 'function salvarConcilicaoVisitasParticipante()');
  const content = { innerHTML: '' };
  const selected = [{
    dataset: { jornadaItem: 'KIT-42', jornadaReservaIndex: '0' }, value: 'LOTE-A', selectedIndex: 0,
    options: [{ getAttribute: () => '' }], parentNode: { querySelector: () => ({ value: '1' }) }
  }];
  let request;
  let reabriu = false;
  const context = vm.createContext({
    window: { _jornadaReservaPrevia: { contexto: { participanteId: 'P-42' } } },
    document: { getElementById: id => id === 'jornadaReservaPreviaConteudo' ? { querySelectorAll: () => selected } : id === 'jornadaParticipanteConteudo' ? content : id === 'jornadaReservaQuantidade_0' ? { value: '1' } : { textContent: '', disabled: false } },
    appServerRun: opts => { request = opts; },
    jornadaParticipanteHtml_: dados => 'JORNADA:' + dados.marcador,
    abrirJornadaParticipante: () => { reabriu = true; },
    snack: () => {},
    isFinite,
    Object,
    Array,
    String,
    Number
  });
  vm.runInContext(block, context);

  context.confirmarReservaPreviaJornada();
  request.onSuccess({ msg: '1 kit reservado.', jornada: { marcador: 'ATUALIZADA' } });

  assert.equal(content.innerHTML, 'JORNADA:ATUALIZADA');
  assert.equal(context._jornadaParticipanteDados.marcador, 'ATUALIZADA');
  assert.equal(reabriu, false);
});

test('reserva prévia da jornada coleta os lotes visíveis mesmo após o conteúdo ser refeito', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const block = sourceBetween(source, 'function jornadaKitsSelecionadosParaReserva_()', 'function salvarConcilicaoVisitasParticipante()');
  const selected = [{
    dataset: { jornadaItem: 'KIT-44', jornadaReservaIndex: '0' }, value: '', selectedIndex: 0,
    options: [{ value: 'LOTE-C', getAttribute: (name) => name === 'data-accession' ? 'ACC-C' : 'LOTE-C' }],
    getAttribute: (name) => name === 'data-jornada-reserva-index' ? '0' : '', parentNode: null
  }];
  const context = vm.createContext({
    document: {
      getElementById: (id) => id === 'jornadaReservaPreviaConteudo' ? { querySelectorAll: () => [] } : id === 'jornadaReservaQuantidade_0' ? { value: '3' } : null,
      querySelectorAll: () => selected
    },
    Array,
    String,
    Number
  });
  vm.runInContext(block, context);

  assert.deepEqual(JSON.parse(JSON.stringify(context.jornadaKitsSelecionadosParaReserva_())), [
    { idItem: 'KIT-44', idLote: 'LOTE-C', qtde: 3, accessionNumber: 'ACC-C' }
  ]);
});

test('jornada concilia em lote nomes históricos desde 2026 sem renomear a Agenda', () => {
  const server = runFile('WebApp.gs');
  const client = readProjectFile('IndexCoreScripts.html');
  const sugestao = server.agendaSoASugerirVisita_('C34D1', [{ idSoA: 'SOA-C34D1', nome: 'Dia 1 do Ciclo 34', codigo: '' }]);

  assert.deepEqual(JSON.parse(JSON.stringify(sugestao)), {
    idSoA: 'SOA-C34D1', nivel: 'SUGESTÃO', motivo: 'Padrão CxDy reconhecido; revise antes de aplicar'
  });
  assert.match(server.AGENDA_SOA_CONCILIACAO_HEADERS_.join('|'), /Agenda_ID\|ID_SoA\|Projeto/);
  assert.match(server.agendaSoAEventoFazParteDoIPS_.toString(), /AGENDA_SOA_INICIO_IPS_/);
  assert.match(client, /function abrirConcilicaoVisitasParticipante\(\)/);
  assert.match(client, /method: 'salvarConcilicaoVisitasParticipante'/);
  assert.match(client, /Histórico anterior ao início do IPS em 2026/);
  assert.match(server.consultarConcilicaoVisitasParticipante.toString(), /getConcilicaoVisitasParticipante/);
  assert.match(server.salvarConcilicaoVisitasParticipante.toString(), /salvarConcilicaoVisitasParticipante_/);
});

test('SoA exibe modelos de Kit e Bulk Supply por visita e laboratório', () => {
  const client = readProjectFile('IndexCoreScripts.html');
  const estoque = readProjectFile('IndexEstoqueScripts.html');
  const server = readProjectFile('WebApp.gs');
  assert.match(client, /function soaModelosEstoqueHtml_\(modelos\)/);
  assert.match(client, /method: 'getModelosEstoqueSoAPorProjeto'/);
  assert.match(client, /modelo\.laboratorio/);
  assert.match(client, /modelo\.bracosAplicaveisIds/);
  assert.match(client, /todos os braços/);
  assert.match(estoque, /Visitas SoA aplicáveis/);
  assert.match(server, /function estoqueTipoPermiteVinculoSoA_\(tipo\)/);
  assert.match(server, /function getModelosEstoqueSoAPorProjeto\(projeto\)/);
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
  const getParticipantesBlock = sourceBetween(serverSource, 'function participanteCampoKey_', 'function getParticipanteFormConfig()');
  const serverContext = vm.createContext({
    codexAuthorizeWebAppRequest_: () => ({ ok: true }),
    getCodexSheetDataByName_: () => [
      ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braco', 'Ultima visita', 'Status', 'Telefone', 'CPF', 'Obs', 'ID Pessoa'],
      ['1', 'Pessoa A', '', '', 'P-001', 'Estudo Aurora', '', '', 'Ativo', '', '', '', 'PES-A']
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
  assert.equal(participantes[0].idPessoa, 'PES-A');

  const clientSource = readProjectFile('IndexCoreScripts.html');
  const cellBlock = sourceBetween(clientSource, 'function participanteUltimaVisitaCellHtml(', 'function renderTabelaPart(');
  const clientContext = vm.createContext({ esc: (value) => String(value || '') });
  vm.runInContext(cellBlock, clientContext);
  const html = clientContext.participanteUltimaVisitaCellHtml(participantes[0]);
  assert.match(html, /Visit 3 Week 3/);
  assert.match(html, /21\/07\/2026/);
  assert.ok(html.indexOf('Visit 3 Week 3') < html.indexOf('21/07/2026'));
});
