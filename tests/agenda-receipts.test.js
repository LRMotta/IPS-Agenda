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

function receiptPrintContext() {
  const source = readProjectFile('IndexAgendaScripts.html');
  const start = source.indexOf('function agendaReciboGrupoExtenso_');
  const end = source.indexOf('function agendaCourierCards', start);
  const context = vm.createContext({
    Math,
    Number,
    isFinite,
    document: { querySelector: () => null },
    getPatientDisplayLogoSrc: () => 'logo.png',
    esc: (value) => String(value == null ? '' : value),
    agendaPrintShell: ({ body }) => '<html><head><style></style></head><body class="portrait">' + body + '</body></html>'
  });
  vm.runInContext(source.slice(start, end), context);
  context.agendaReciboFormatarValor_ = (value) => String(value);
  context.agendaReciboDataBr_ = (value) => String(value || '');
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

test('recibo fica no menu de ações e sai dos detalhes, preservando elegibilidade e referência do evento', () => {
  const source = readProjectFile('IndexAgendaScripts.html');
  const context = vm.createContext({
    esc: value => String(value || ''),
    agendaUsaDisplayOperacional_: () => false,
    agendaDisplayPayload: row => ({ participante: row.participante }),
    agendaCourierCards: () => '',
    agendaPostVisitDetailHtml: () => ''
  });
  context.window = context;
  vm.runInContext(readProjectFile('SharedAgendaRules.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, ''), context);
  const menuStart = source.indexOf('  function agendaActionMenuHtml_');
  const menuEnd = source.indexOf('  function agendaInstallActionMenuDismissHandlers_', menuStart);
  const detailStart = source.indexOf('  function agendaDetailHtml');
  const detailEnd = source.indexOf('  var _agendaReciboData', detailStart);
  vm.runInContext(source.slice(menuStart, menuEnd) + source.slice(detailStart, detailEnd), context);

  for (const tipo of ['Visita', 'Consulta']) {
    for (const past of [false, true]) {
      const row = { id: 'AG-123', rowIndex: 42, tipo, participante: 'Pessoa', status: 'Agendado' };
      const menu = context.agendaActionMenuHtml_(row, 'test', past);
      assert.match(menu, /role="menuitem"[^>]*agendaCloseActionMenus\(\);abrirAgendaRecibo\('AG-123',42\)/);
      assert.match(menu, /receipt_long.*Gerar recibo/);
      assert.ok(menu.indexOf('Gerar recibo') > menu.indexOf('Gerar Display'));
      assert.doesNotMatch(context.agendaDetailHtml(row), /Gerar recibo|abrirAgendaRecibo/);
    }
  }
  for (const row of [
    { tipo: 'Visita', participante: '' },
    { tipo: 'Consulta', participante: '' },
    { tipo: 'Monitoria', participante: 'Pessoa' },
    { tipo: 'SIV', participante: 'Pessoa' }
  ]) {
    assert.doesNotMatch(context.agendaActionMenuHtml_(row, 'test', false), /Gerar recibo|abrirAgendaRecibo/);
  }
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
  Object.assign(participant, { 0: 'CAD-1', 1: 'Pessoa A', 4: 'P-001', 5: 'Estudo A', 9: '(54) 99999-0101', 10: '123.456.789-09', 12: 'Rua A', 13: '10', 14: 'Caxias do Sul', 15: 'RS', 16: '95000-000', 17: 'Banco A', 18: 'Conta corrente', 19: '1234', 20: '5678', 21: 'Pessoa A', 22: '123.456.789-09', 23: JSON.stringify([{ id: 'ACO-1', nome: 'Acompanhante A', banco: 'Banco B', telefone: '(54) 99999-0202' }, { id: 'ACO-2', nome: 'Sem telefone' }]) });
  const projectHeader = ['ID', 'Nome', '', '', '', '', '', '', '', '', '', 'Coordenador', '', '', '', '', '', 'Ressarcimento padrão participante', 'Ressarcimento padrão acompanhante'];
  const project = Array(projectHeader.length).fill('');
  Object.assign(project, { 0: 'PROJ-1', 1: 'Estudo A', 11: 'Coordenação A', 17: 100, 18: 80 });
  const server = runFile('WebApp.gs', { AgendaServerRules_: { formPolicy: () => ({ type: 'visita' }) } });
  server.codexGetCurrentUserAccess = () => ({ ok: true });
  server.agendaLerEventoPorId_ = () => ({ id: 'AG-1', participanteCadastroId: 'CAD-1', participante: 'Pessoa A', idParticipante: 'P-001', projeto: 'Estudo A', tipo: 'Visita', visita: 'V1', data: '10/09/2026', dataIso: '2026-09-10' });
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: (name) => name === 'Participantes' ? sheet(name, [participantHeader, participant]) : sheet(name, [projectHeader, project]) });
  server.getParticipantes = () => { throw new Error('getter global não deve ser chamado'); };
  server.getProjetos = () => { throw new Error('getter global não deve ser chamado'); };

  const result = server.getAgendaReciboData('AG-1', 2);

  assert.equal(JSON.stringify(result.beneficiarios.map((item) => [item.nome, item.tipo, item.valorPadrao, item.telefone])), JSON.stringify([['Pessoa A', 'Participante', 100, '(54) 99999-0101'], ['Acompanhante A', 'Acompanhante', 80, '(54) 99999-0202'], ['Sem telefone', 'Acompanhante', 80, '']]));
  assert.equal(result.coordenador, 'Coordenação A');
  assert.ok(calls.every((call) => call.numRows === 1 || (call.name === 'Participantes' && call.column === 1) || (call.name === 'Projetos' && call.column === 2)));
});

test('telemetria do servidor separa etapas do recibo sem dados pessoais e registra falhas', () => {
  const logs = [];
  let now = 1000;
  const server = runFile('WebApp.gs', {
    Logger: { log: value => logs.push(JSON.parse(value.replace('[CODEX_PERF] ', ''))) },
    AgendaServerRules_: { formPolicy: () => ({ type: 'visita' }) }
  });
  server.Date = { now: () => now };
  server.codexGetCurrentUserAccess = () => { now += 10; return { ok: true }; };
  server.agendaLerEventoPorId_ = () => { now += 20; return { id: 'PRIVATE-ID', participante: 'PRIVATE-NAME', projeto: 'PRIVATE-PROJECT' }; };
  server.agendaReciboParticipante_ = () => { now += 30; return { nome: 'PRIVATE-NAME', cpf: 'PRIVATE-CPF', banco: 'PRIVATE-BANK' }; };
  server.agendaReciboProjeto_ = () => { now += 40; return {}; };
  const result = server.getAgendaReciboData('PRIVATE-ID', 2);
  assert.equal(result.beneficiarios[0].cpf, 'PRIVATE-CPF');
  assert.deepEqual(logs.map(log => [log.stage, log.durationMs, log.success]), [
    ['authorize', 10, true], ['event', 20, true], ['participant', 30, true], ['project', 40, true], ['total', 100, true]
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|cpf|banco|agendaId|rowIndex/);

  logs.length = 0;
  server.agendaReciboParticipante_ = () => { now += 30; throw new Error('PRIVATE-ERROR'); };
  assert.throws(() => server.getAgendaReciboData('PRIVATE-ID', 2), /PRIVATE-ERROR/);
  assert.deepEqual(logs.slice(-2).map(log => [log.stage, log.success]), [['participant', false], ['total', false]]);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/);
  server.Logger.log = () => { throw new Error('logger unavailable'); };
  server.agendaReciboParticipante_ = () => ({ nome: 'PRIVATE-NAME' });
  assert.equal(server.getAgendaReciboData('PRIVATE-ID', 2).beneficiarios.length, 1);
});

function receiptLookupContext() {
  const calls = [];
  const logs = [];
  const server = runFile('WebApp.gs', {
    Logger: { log: value => logs.push(JSON.parse(value.replace('[CODEX_PERF] ', ''))) },
    AgendaServerRules_: { formPolicy: () => ({ type: 'visita' }) }
  });
  const event = { id: 'AG-1', participanteCadastroId: 'CAD-1', participante: 'Pessoa', projeto: 'Estudo', idParticipante: 'P-1', braco: '' };
  const rows = [Array(server.AGENDA_CFG.lastCol).fill(''), Array(server.AGENDA_CFG.lastCol).fill('')];
  rows[0][server.AGENDA_CFG.idx.id] = 'OTHER';
  rows[1][server.AGENDA_CFG.idx.id] = 'AG-1';
  server.getAgendaSheetForRead_ = () => {
    calls.push('sheet');
    return { getLastRow: () => 3, getRange(row, column, numRows, numColumns) {
      calls.push(['read', row, column, numRows, numColumns]);
      return { getValues: () => rows.slice(row - 2, row - 2 + numRows).map(values => values.slice(column - 1, column - 1 + numColumns)) };
    } };
  };
  server.agendaRowToObject_ = (_values, row) => ({ ...event, rowIndex: row });
  server.encontrarLinhaPorId = (_sheet, id) => {
    calls.push('locate_fallback');
    return id === 'AG-1' ? 3 : 0;
  };
  server.agendaHydrateParticipantFields_ = items => {
    calls.push('hydrate');
    items[0].idParticipante = items[0].idParticipante || 'P-LEGACY';
    items[0].braco = 'Braço A';
  };
  server.codexGetCurrentUserAccess = () => { calls.push('receipt_authorize'); return { ok: true, role: 'readonly' }; };
  server.codexAssertCanRead_ = () => { calls.push('event_authorize'); return { ok: true, role: 'readonly' }; };
  server.agendaReciboParticipante_ = () => { calls.push('participant'); return { id: 'CAD-1', nome: 'Pessoa', acompanhantes: [{ id: 'ACO-1', nome: 'Acompanhante' }] }; };
  server.agendaReciboProjeto_ = () => { calls.push('project'); return {}; };
  return { server, calls, logs, event };
}

test('recibo autoriza uma vez, le uma linha da Agenda e dispensa o indice geral com identidade completa', () => {
  const { server, calls, logs } = receiptLookupContext();
  const result = server.getAgendaReciboData('AG-1', 3);
  assert.equal(result.idParticipante, 'P-1');
  assert.equal(result.beneficiarios.length, 2);
  assert.deepEqual(calls.filter(call => typeof call === 'string'), ['receipt_authorize', 'sheet', 'participant', 'project']);
  assert.deepEqual(calls.filter(Array.isArray), [['read', 3, 1, 1, server.AGENDA_CFG.lastCol]]);
  assert.ok(logs.some(log => log.stage === 'hydrate_skipped_receipt'));

  calls.length = 0;
  const publicEvent = server.getAgendaEventoPorId('AG-1', 3);
  assert.equal(publicEvent.braco, 'Braço A');
  assert.deepEqual(calls.filter(call => typeof call === 'string'), ['event_authorize', 'sheet', 'hydrate']);
});

test('recibo conserva hidratacao de legados e identidades incompletas', () => {
  for (const field of ['participanteCadastroId', 'participante', 'projeto', 'idParticipante']) {
    const { server, event, calls } = receiptLookupContext();
    event[field] = '';
    const result = server.agendaLerEventoPorId_('AG-1', 3, { receipt: true });
    assert.ok(calls.includes('hydrate'), field);
    if (field === 'idParticipante') assert.equal(result.idParticipante, 'P-LEGACY');
  }
});

test('recibo rejeita acesso antes de ler e revalida ID quando a linha sugerida esta desatualizada', () => {
  const { server, calls } = receiptLookupContext();
  assert.equal(server.getAgendaReciboData('AG-1', 2).agendaId, 'AG-1');
  assert.ok(calls.includes('locate_fallback'));
  assert.deepEqual(calls.filter(Array.isArray).map(call => call[1]), [2, 3]);
  calls.length = 0;
  assert.throws(() => server.getAgendaReciboData('MISSING', 2), /nao encontrado/);
  assert.ok(!calls.includes('participant'));
  calls.length = 0;
  server.codexGetCurrentUserAccess = () => ({ ok: false, message: 'Denied' });
  assert.throws(() => server.getAgendaReciboData('AG-1', 3), /Denied/);
  assert.deepEqual(calls, []);
  server.codexAssertCanRead_ = () => { throw new Error('Denied'); };
  assert.throws(() => server.getAgendaEventoPorId('AG-1', 3), /Denied/);
  assert.deepEqual(calls, []);
});

test('telemetria do cliente separa RPC e preenchimento, ignora retornos antigos e tolera logger indisponivel', () => {
  const { context } = receiptFormContext();
  const logs = [];
  const pending = [];
  let now = 1000;
  context.Date = { now: () => now };
  context.console = { info: value => logs.push(JSON.parse(value.replace('[CODEX_PERF] ', ''))) };
  context.abrirOverlay = () => { now += 5; };
  context.google = { script: { run: {
    withSuccessHandler(success) {
      return { withFailureHandler(failure) {
        return { getAgendaReciboData: () => pending.push({ success, failure }) };
      } };
    }
  } } };
  context.agendaReciboPreencher_ = () => { now += 7; };
  context.agendaReciboFalha_ = () => {};
  context.abrirAgendaRecibo('PRIVATE-ID', 42);
  now += 100;
  pending[0].success({ beneficiarios: [{ nome: 'PRIVATE-NAME', cpf: 'PRIVATE-CPF' }] });
  assert.deepEqual(logs.map(log => [log.stage, log.durationMs, log.stageDurationMs]), [
    ['click', 0, 0], ['modal_open', 5, 5], ['rpc_complete', 105, 100], ['form_ready', 112, 7]
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|agendaId|rowIndex|cpf/);
  context.abrirAgendaRecibo('PRIVATE-ID', 42);
  pending[0].success({ beneficiarios: [{ nome: 'PRIVATE-NAME' }] });
  assert.equal(logs.at(-1).stage, 'stale_response');
  pending[1].failure(new Error('PRIVATE-ERROR'));
  assert.equal(logs.at(-1).stage, 'rpc_failure');
  assert.equal(logs.at(-1).success, false);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/);
  context.console.info = () => { throw new Error('console unavailable'); };
  assert.doesNotThrow(() => context.abrirAgendaRecibo('PRIVATE-ID', 42));
  assert.doesNotThrow(() => pending[2].success({ beneficiarios: [{}] }));
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
  assert.match(client, /viaIps && !isAcompanhante \? 'participante nº '/);
  assert.match(client, /\(!viaIps \|\| isAcompanhante\) && \(recibo\.endereco \|\| recibo\.telefone\)/);
  assert.match(client, /viaIps \? '' : '<div class="bank/);
  assert.match(client, /Autorizo o crédito na conta bancária abaixo/);
  assert.match(client, /Rubrica do\(a\) coordenador\(a\) de estudos/);
  assert.match(client, /receipt-signatures/);
  assert.match(client, /Tipo de conta: ' \+ recibo\.tipoConta/);
  assert.match(client, /\.receipt \.place\{text-align:center/);
  assert.match(client, /var classeQuebraPagina = viaIndex < vias\.length - 1 \? ' receipt-page-break' : ''/);
  assert.match(client, /\.receipt-page-break\{break-after:page;page-break-after:always\}/);
  assert.match(client, /receipt-signatures\{display:grid[^']*align-items:start/);
  assert.match(client, /\.receipt \.signature\{[^']*margin:54px auto 0/);
  assert.match(client, /\.receipt \.signature b\{font-size:13px\}/);
  assert.doesNotMatch(client, /\.receipt \.coordinator-rubric b\{font-size:11px\}/);
  assert.match(client, /isAcompanhante \? 'ao acompanhamento na visita' : 'à visita'/);
  assert.doesNotMatch(client, /salvarAgendaRecibo|registrarAgendaRecibo/);
});

test('recibo de acompanhante mantém identificação na assinatura e sem quebra após a última via', () => {
  const context = receiptPrintContext();
  const data = { idParticipante: 'P-001', participante: 'Participante', visita: 'V1', projeto: 'Estudo' };
  const recibo = { tipo: 'Acompanhante', nome: 'Acompanhante', cpf: '111', valor: 80, dataVisita: '10/09/2026', dataEmissao: '23/09/2026', coordenador: 'Coordenação' };

  const html = context.agendaReciboPrintHtml_(data, recibo);

  assert.doesNotMatch(html, /Acompanhante de participante de pesquisa clínica/);
  assert.equal((html.match(/<small>Acompanhante de Participante de Pesquisa<\/small>/g) || []).length, 3);
  assert.equal((html.match(/class="receipt receipt-copy receipt-page-break"/g) || []).length, 2);
  assert.equal((html.match(/class="receipt receipt-copy"/g) || []).length, 1);
  assert.match(html, /align-items:start/);
  assert.match(html, /font-size:13px/);
  assert.match(html, /\.receipt-subtitle\{[^}]*font-size:11px/);
  assert.match(html, /margin:54px auto 0/);
});

test('todas as vias do acompanhante identificam quem recebe e assina, preservando o participante separado', () => {
  const context = receiptPrintContext();
  const data = { idParticipante: 'P-001', participante: 'Pessoa do estudo', visita: 'V1', projeto: 'Estudo' };
  const recibo = { tipo: 'Acompanhante', nome: 'Pessoa acompanhante', cpf: '111', endereco: 'Rua Teste, 10', telefone: '54999990000', banco: 'Banco Teste', valor: 80 };
  const html = context.agendaReciboPrintHtml_(data, recibo);
  const vias = html.match(/<section\b[^>]*>[\s\S]*?<\/section>/g);
  assert.equal(vias.length, 3);
  vias.forEach((via, index) => {
    assert.match(via, /Eu, <b>Pessoa acompanhante<\/b>, CPF <b>111<\/b>, na condição de acompanhante do participante de pesquisa identificado abaixo, declaro ter recebido/);
    assert.match(via, /relacionadas ao acompanhamento na visita <b>V1<\/b>/);
    assert.match(via, /Endereço do acompanhante:<\/b> Rua Teste, 10/);
    assert.match(via, /Telefone do acompanhante:<\/b> 54999990000/);
    assert.match(via, /<b>Pessoa acompanhante<\/b><small>Acompanhante de Participante de Pesquisa<\/small>/);
    assert.doesNotMatch(via, /Eu, <b>participante nº|<b>Participante nº/);
    assert.match(via, /Rubrica do\(a\) coordenador\(a\) de estudos/);
    if (index === 1) {
      assert.match(via, /Participante do estudo:<\/b> nº P-001/);
      assert.doesNotMatch(via, /Pessoa do estudo|Dados bancários/);
    } else {
      assert.match(via, /Participante do estudo:<\/b> Pessoa do estudo · ID P-001/);
      assert.match(via, /Dados bancários/);
    }
  });
  assert.match(vias[2], /3ª via — Acompanhante/);
});

test('recibo do participante mantém texto e identificação por número na via IPS', () => {
  const context = receiptPrintContext();
  const html = context.agendaReciboPrintHtml_({ idParticipante: 'P-001' }, { tipo: 'Participante', nome: 'Pessoa do estudo', cpf: '111', endereco: 'Rua Teste', telefone: '54999990000', valor: 80 });
  const vias = html.match(/<section\b[^>]*>[\s\S]*?<\/section>/g);
  assert.match(vias[1], /Eu, <b>participante nº P-001<\/b>, declaro ter recebido/);
  assert.match(vias[1], /<b>Participante nº P-001<\/b><\/div>/);
  assert.doesNotMatch(vias[1], /CPF|Endereço|Telefone|Dados bancários/);
  assert.match(vias[0], /Endereço do beneficiário/);
  assert.match(vias[2], /3ª via — Participante\/Acompanhante/);
  assert.match(html, /relacionadas à visita/);
  assert.doesNotMatch(html, /na condição de acompanhante|ao acompanhamento na visita/);
});

test('recibos exibem o subtítulo do beneficiário abaixo do título nas três vias', () => {
  const context = receiptPrintContext();
  for (const [tipo, subtitulo] of [
    ['Participante', 'Participante de Pesquisa'],
    ['Acompanhante', 'Acompanhante de Participante de Pesquisa']
  ]) {
    const html = context.agendaReciboPrintHtml_({}, { tipo, nome: 'Beneficiário', valor: 80 });
    const titulo = '<h2>RECIBO DE RESSARCIMENTO</h2><div class="receipt-subtitle">' + subtitulo + '</div>';
    assert.equal(html.split(titulo).length - 1, 3);
    assert.match(html, /\.receipt-subtitle\{[^}]*text-transform:uppercase/);
  }
});

test('recibo valida CPF do beneficiário e do titular antes de imprimir', () => {
  const client = readProjectFile('IndexAgendaScripts.html');
  const modal = readProjectFile('IndexExtraModals.html');

  assert.match(client, /function agendaReciboCpfValido_\(value\)/);
  assert.match(client, /function agendaReciboAtualizarValidacaoCpf_\(\)/);
  assert.match(client, /CPF do beneficiário/);
  assert.match(client, /CPF do titular da conta/);
  assert.match(client, /botao\.disabled = !!invalido\.length \|\| !pessoa \|\| telefoneAusente/);
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

function receiptFormContext() {
  const elements = {};
  function element() {
    return {
      value: '', textContent: '', style: {}, children: [], classList: { toggle() {} },
      appendChild(child) { this.children.push(child); },
      replaceChildren() { this.children = []; },
      querySelectorAll() {
        const inputs = [];
        function visit(node) { if (node.type === 'radio') inputs.push(node); node.children.forEach(visit); }
        visit(this); return inputs;
      },
      setAttribute() {}
    };
  }
  const source = readProjectFile('IndexAgendaScripts.html');
  const context = vm.createContext({
    document: { getElementById: id => elements[id] || (elements[id] = element()), createElement: element },
    formatarTelefoneBrasileiro: value => String(value), agendaIsoFromBr: () => '2026-09-30',
    agendaAbrirJanelaImpressao: () => { throw new Error('Não deveria imprimir sem escolha'); }
  });
  vm.runInContext(source.slice(source.indexOf('var _agendaReciboData ='), source.indexOf('function agendaReciboDataBr_')), context);
  context.agendaHojeIso_ = () => '2026-09-30';
  return { context, elements };
}

test('recibo exige escolha explícita com acompanhantes, troca todos os dados e mantém validação de CPF', () => {
  const { context, elements } = receiptFormContext();
  const data = { beneficiarios: [
    { nome: 'Participante', tipo: 'Participante', telefone: '111', valorPadrao: 120 },
    { nome: 'Acompanhante', tipo: 'Acompanhante', telefone: '222', valorPadrao: 80, cpf: '529.982.247-25', banco: 'Banco B' },
    { nome: 'Sem contato', tipo: 'Acompanhante', valorPadrao: 80 }
  ] };
  context._agendaReciboData = data;
  context.agendaReciboPreencher_(data);
  assert.equal(elements.agendaReciboBeneficiario.value, '');
  assert.equal(elements.agendaReciboTelefone.value, '');
  assert.equal(elements.btnImprimirAgendaRecibo.disabled, true);
  assert.equal(context.agendaReciboAtualizarValidacaoCpf_(), false);
  context.imprimirAgendaRecibo();
  assert.match(elements.agendaReciboStatus.textContent, /Escolha o recebedor/);

  const radios = elements.agendaReciboOpcoes.querySelectorAll('input');
  radios[1].onchange();
  assert.equal(elements.agendaReciboTelefone.value, '222');
  assert.equal(elements.agendaReciboBanco.value, 'Banco B');
  assert.match(elements.agendaReciboImprimirLabel.textContent, /acompanhante/);
  assert.equal(elements.btnImprimirAgendaRecibo.disabled, false);
  elements.agendaReciboCpf.value = '111';
  assert.equal(context.agendaReciboAtualizarValidacaoCpf_(), false);
  assert.equal(elements.btnImprimirAgendaRecibo.disabled, true);
  radios[2].onchange();
  assert.equal(elements.agendaReciboTelefone.value, '');
  assert.equal(elements.agendaReciboBanco.value, '');
  assert.equal(elements.agendaReciboTelefone.required, true);
  assert.equal(elements.btnImprimirAgendaRecibo.disabled, true);
  assert.match(elements.agendaReciboStatus.textContent, /Informe o telefone do acompanhante/);
  context.imprimirAgendaRecibo();
  elements.agendaReciboTelefone.value = '   ';
  assert.equal(context.agendaReciboAtualizarValidacaoCpf_(), false);
  elements.agendaReciboTelefone.value = '(54) 99999-0303';
  assert.equal(context.agendaReciboAtualizarValidacaoCpf_(), true);
  assert.equal(elements.btnImprimirAgendaRecibo.disabled, false);
  radios[0].onchange();
  assert.equal(elements.agendaReciboTelefone.value, '111');
  assert.match(elements.agendaReciboImprimirLabel.textContent, /participante/);
  assert.equal(elements.agendaReciboTelefone.required, false);
  context.agendaReciboPreencher_(data);
  assert.equal(elements.agendaReciboBeneficiario.value, '');
  assert.equal(elements.btnImprimirAgendaRecibo.disabled, true);
  context._agendaReciboData = { beneficiarios: [data.beneficiarios[0]] };
  context.agendaReciboPreencher_(context._agendaReciboData);
  assert.equal(elements.agendaReciboBeneficiario.value, '0');
  assert.equal(elements.btnImprimirAgendaRecibo.disabled, false);
});

test('telefone do acompanhante fica nas três vias como texto seguro; participante mantém duas vias identificadas', () => {
  const context = receiptPrintContext();
  context.esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = context.agendaReciboPrintHtml_({ idParticipante: 'P-1' }, {
    tipo: 'Acompanhante', nome: 'Pessoa', endereco: 'Rua Teste', telefone: '<img src=x onerror=alert(1)>', valor: 80
  });
  const copies = html.match(/<section[\s\S]*?<\/section>/g);
  copies.forEach(copy => {
    assert.match(copy, /Endereço do acompanhante:[\s\S]*Telefone do acompanhante:/);
    assert.match(copy, /&lt;img/);
    assert.doesNotMatch(copy, /<img src=x/);
  });
  const phoneOnly = context.agendaReciboPrintHtml_({}, { telefone: '222', valor: 80 });
  assert.equal((phoneOnly.match(/Telefone do beneficiário:/g) || []).length, 2);
});
