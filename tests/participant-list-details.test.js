'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const headers = ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braço', 'Última visita', 'Status', 'Telefone', 'CPF', 'Obs',
    'Rua', 'Número', 'Cidade', 'UF', 'CEP', 'Banco', 'Tipo Conta', 'Agência', 'Conta Corrente', 'Titular da Conta', 'CPF do titular', 'ID Pessoa', 'Acompanhantes JSON'];
  const row = ['1', 'Pessoa', '', '40', 'PT', 'Aurora', 'A', '', 'Ativo', '54999999999', '12345678909', 'Observação',
    'Rua preservada', '20', 'Caxias', 'RS', '95000000', 'Banco preservado', 'Corrente', '001', '1234', 'Pessoa', '12345678909', 'PES-1',
    JSON.stringify([{ id: 'AC-1', nome: 'Acompanhante', telefone: '54999999999' }])];
  const sheet = new FakeSheet('Participantes', [headers, row]);
  sheet.getSheetId = () => 1;
  const book = new FakeSpreadsheet({ Participantes: sheet });
  let tzCalls = 0;
  const server = runFiles(['CadastroRules.gs', 'WebApp.gs'], { Date,
    Session: { getScriptTimeZone: () => { tzCalls++; return 'America/Sao_Paulo'; } },
    Logger: { log() {} }
  });
  server.codexAssertCanRead_ = () => ({ ok: true });
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true });
  server.getCodexSpreadsheet_ = () => book;
  server.getUltimasVisitasParticipantesAgendaMap_ = () => ({ 'cadastro:1': { visita: 'V1', data: '02/10/2026' } });
  server.getParticipanteFormConfig = () => ({});
  server.getProjetosParticipantesOptions_ = () => [];
  return { server, sheet, row, tzCalls: () => tzCalls };
}

test('bootstrap de participantes preserva tabela e busca, omite detalhes e mantém RPC legada completa', t => {
  const f = fixture();
  const full = plain(f.server.getParticipantes());
  const beforeTz = f.tzCalls();
  // A lista não deve sequer interpretar o JSON dos acompanhantes.
  const parseCompanions = f.server.participanteLerAcompanhantes_;
  f.server.participanteLerAcompanhantes_ = () => { throw new Error('Detalhe fora da listagem'); };
  const slim = plain(f.server.getCadastrosBootstrapData('participantes').data);
  assert.equal(f.tzCalls() - beforeTz, 1);
  const fields = ['id', 'idPessoa', 'nome', 'idParticipante', 'dataNascimento', 'idade', 'cpf', 'projeto', 'braco', 'status', 'telefone', 'observacoes', 'ultimaVisita', 'ultimaVisitaData'];
  assert.deepEqual(Object.keys(slim[0]).sort(), fields.sort());
  fields.forEach(key => assert.equal(slim[0][key], full[0][key], key));
  f.server.participanteLerAcompanhantes_ = parseCompanions;
  const detail = plain(f.server.getParticipanteDetalhes('1'));
  assert.equal(detail.rua, full[0].rua);
  assert.equal(detail.banco, full[0].banco);
  assert.equal(detail.contaCorrente, full[0].contaCorrente);
  assert.deepEqual(detail.acompanhantes, full[0].acompanhantes);
  assert.equal(f.sheet.writes, 0);
  const before = Buffer.byteLength(JSON.stringify(full)), after = Buffer.byteLength(JSON.stringify(slim));
  assert.ok(after < before);
  t.diagnostic(`Mesmo cadastro sintético: ${before} -> ${after} bytes na listagem.`);
});

test('detalhe autoriza antes da leitura e rejeita ID ausente, inexistente, duplicado ou linha reordenada', () => {
  const f = fixture();
  f.server.codexAssertCanRead_ = () => { throw new Error('NEGADO'); };
  f.server.getCodexSpreadsheet_ = () => { throw new Error('Leitura proibida'); };
  assert.throws(() => f.server.getParticipanteDetalhes('1'), /NEGADO/);
  const g = fixture();
  assert.throws(() => g.server.getParticipanteDetalhes(''), /Informe/);
  assert.throws(() => g.server.getParticipanteDetalhes('OUTRO'), /não encontrado/);
  g.sheet.rows.push(g.row.slice());
  assert.throws(() => g.server.getParticipanteDetalhes('1'), /duplicado/);
  g.sheet.rows.pop();
  const getRange = g.sheet.getRange.bind(g.sheet);
  g.sheet.getRange = (...args) => {
    if (args[0] === 2 && args[3] > 1) g.sheet.rows[1][0] = 'OUTRO';
    return getRange(...args);
  };
  assert.throws(() => g.server.getParticipanteDetalhes('1'), /mudou durante/);
  assert.equal(g.sheet.writes, 0);
});

function clientFixture() {
  const requests = [], rendered = [], disabled = [];
  const modal = { dataset: {}, setAttribute() {}, classList: { remove() {} } };
  const status = { textContent: '', appendChild(el) { this.retry = el; } };
  const fields = { modalParticipante: modal, modalPartTitle: {}, statusPart: status, editPartId: { value: '1' } };
  const c = vm.createContext({
    _participanteDetalhesConsulta: null, _participanteDetalhesPendente: false, _participanteEdicaoAtual: null,
    document: { getElementById: id => fields[id], createElement: () => ({}) },
    appServerRun: opts => requests.push(opts), appErrorMessage: e => e.message, snackErro() {},
    participanteBloquearDetalhes_: busy => disabled.push(busy),
    abrirFormPartPreenchido_: p => rendered.push(p), appConfirmNavigationIfDirty: () => true,
    appClearUnsavedChanges() {}, participanteStatusEncerrado_: () => true,
    prepararNovaParticipacaoPessoa_: p => { c.newParticipation = p; }
  });
  const source = readProjectFile('IndexCoreScripts.html');
  for (const name of ['abrirFormPart', 'abrirNovaParticipacaoPessoa', 'salvarPartApp', 'fecharOverlay']) {
    const match = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
    assert.ok(match, name);
    vm.runInContext(match[0], c);
  }
  return { c, requests, rendered, disabled, fields, status };
}

test('edição só aplica detalhe atual; trocar, fechar ou abrir novo descarta respostas anteriores', () => {
  const { c, requests, rendered } = clientFixture();
  c.abrirFormPart({ id: '1' });
  c.abrirFormPart({ id: '2' });
  requests[0].onSuccess({ id: '1', banco: 'Obsoleto' });
  requests[0].onFailure(new Error('Obsoleto'));
  assert.equal(rendered.filter(Boolean).length, 0);
  requests[1].onSuccess({ id: '2', banco: 'Atual' });
  assert.equal(c._participanteEdicaoAtual.banco, 'Atual');
  c.abrirFormPart({ id: '1' });
  c.fecharOverlay('modalParticipante');
  requests[2].onSuccess({ id: '1' });
  assert.equal(rendered.filter(Boolean).length, 1);
  c.abrirFormPart({ id: '1' });
  c.abrirFormPart(null);
  requests[3].onSuccess({ id: '1' });
  assert.equal(c._participanteEdicaoAtual, null);
  assert.equal(rendered.filter(Boolean).length, 1);
});

test('falha ou ID divergente bloqueia salvar e oferece retry; nova participação usa o detalhe completo', () => {
  const { c, requests, status, fields } = clientFixture();
  c.abrirFormPart({ id: '1' });
  requests[0].onSuccess({ id: '2', banco: 'Outro' });
  assert.equal(c._participanteDetalhesPendente, true);
  assert.equal(c._participanteEdicaoAtual, null);
  c.salvarPartApp(); // Deve retornar antes de acessar campos vazios ou enviar mutação.
  assert.equal(requests.length, 1);
  status.retry.onclick();
  const detail = { id: '1', status: 'Descontinuado', banco: 'Banco', rua: 'Rua', idPessoa: 'PES-1', acompanhantes: [{ id: 'AC-1' }] };
  requests[1].onSuccess(detail);
  fields.editPartId.value = '1';
  c.abrirNovaParticipacaoPessoa();
  assert.equal(c.newParticipation, detail);
});
