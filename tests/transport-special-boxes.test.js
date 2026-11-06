'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

function form(name) {
  const sheet = new FakeSheet(name, []), getRange = sheet.getRange.bind(sheet), notes = {};
  sheet.getRange = (row, col, height, width) => {
    if (typeof row === 'string') {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(row);
      const column = text => [...text].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      row = Number(m[2]); col = column(m[1]); height = m[4] ? Number(m[4]) - row + 1 : 1; width = m[3] ? column(m[3]) - col + 1 : 1;
    }
    const range = getRange(row, col, height, width), key = row + ':' + col;
    range.getNote = () => notes[key] || '';
    range.setNote = value => { notes[key] = value; return range; };
    range.clearNote = () => { delete notes[key]; return range; };
    range.clearDataValidations = () => range;
    return range;
  };
  return sheet;
}

function fixture() {
  const folha = form('Folha'), declaracao = form('Declaracao'), invoice = form('Invoice'), email = form('Email'), agenda = form('Agenda');
  const rule = { courierId: 'M1', temperatura: 'AMBIENTE', laboratorioId: 'L1', tipoCaixa: 'BIOSYSTEM' };
  const projects = [['ID', 'Nome', 'Codigo', 'Caixas especiais transporte (JSON)'], ['P1', 'Estudo', 'ABC-1', JSON.stringify([rule])]];
  const payload = { paciente: 'Pessoa', participanteCadastroId: 'CAD1', identificacaoParticipante: '123', protocolo: 'Estudo (ABC-1)', courier: 'MARKEN', temperatura: 'AMBIENTE', destino: 'Lab', materiais: [], agendadoPor: 'Equipe', horaEnvio: '13:00 - 15:00' };
  const s = runFile('TransporteCodexConfig.gs', {
    extrairIniciais_: runFile('WebApp.gs').extrairIniciais_,
    codexCourierIsValidAwbEntry_: runFile('WebApp.gs').codexCourierIsValidAwbEntry_,
    Logger: { log() {} }, normText_: v => String(v || '').toLowerCase().trim(), SpreadsheetApp: { flush() {} },
    getCodexSheetDataByName_: () => projects,
    getAgendaCourierRows_: () => [{ id: 'M1', nome: 'MARKEN' }, { id: 'O1', nome: 'OCASA' }],
    getProjetoCaixasLaboratorios_: () => [{ id: 'L1', nomeAbreviado: 'Lab' }, { id: 'L2', nomeAbreviado: 'Outro Lab' }],
    Utilities: { DigestAlgorithm: { SHA_256: '' }, Charset: { UTF_8: '' }, computeDigest: (_a, value) => crypto.createHash('sha256').update(value).digest(), base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') }
  });
  s.getTransporteSpreadsheetCodex_ = () => ({});
  s.transporteGetSheet_ = s.transporteCodexGetSheet_ = (_ss, key) => ({ folhaAgendamento: folha, declaracaoTransp: declaracao, invoiceMarken: invoice, emailMarken: email })[key] || null;
  s.getCellValueSafe = (sheet, cell) => sheet.getRange(cell).getValue();
  s.transporteCaixaAgendaRange_ = value => value.idAgenda ? agenda.getRange(2, Number(value.agendaSlot)) : null;
  function stubSave() {
    s.transporteReadParticipantesDireto_ = () => [];
    s.transporteAtualizarRegistroPorAgenda_ = value => value;
    s.transporteDerivarDadosParticipante_ = value => value;
    s.transporteValidarObrigatoriosWebApp_ = () => {};
    s.codexMatBioValidateTransportPayload_ = () => {};
    s.transporteProjetoDisplay_ = value => value;
    s.transporteAjustarVolumesDeclaracao_ = () => {};
    s.transporteSetTopLeftInBlock_ = (sheet, a1, value) => sheet.getRange(a1.split(':')[0]).setValue(value);
    s.transporteSincronizarAgenda_ = value => { s.transporteCaixaPersistirAgenda_(value); return {}; };
  }
  function save(options = {}) {
    stubSave();
    return s.salvarTransporteInterno_({ ...payload }, { returnBootstrap: false, returnPreparedRecord: true, preencherDocumentos: false, ...options }).registro;
  }
  const eventos = [], auditorias = [];
  function reavaliar() {
    stubSave();
    s.codexAssertCanWrite_ = action => { eventos.push('autorizar:' + action); };
    s.codexWithDocumentLock_ = (name, fn) => { eventos.push('lock:' + name); return fn(); };
    s.codexWriteAuditChanges_ = (...args) => { auditorias.push(args); };
    return s.reavaliarCaixaTransporte({ ...payload }).registro;
  }
  return { s, folha, declaracao, invoice, email, agenda, projects, rule, payload, save, reavaliar, eventos, auditorias };
}

test('caixa exige a combinação completa e ignora tipo adulterado pelo cliente', () => {
  const { s, payload, projects, rule } = fixture();
  assert.equal(s.transporteCaixaResolver_({}, payload).tipoCaixa, 'BIOSYSTEM');
  for (const change of [{ protocolo: 'Outro' }, { courier: 'OCASA' }, { temperatura: 'CONGELADO' }, { destino: 'Outro Lab' }]) {
    assert.equal(s.transporteCaixaResolver_({}, { ...payload, ...change, caixaTransporte: { tipoCaixa: 'BIOSYSTEM' } }).tipoCaixa, '');
  }
  projects[1][3] = JSON.stringify([{ ...rule, courierId: 'O1', tipoCaixa: 'SEPIO' }]);
  assert.equal(s.transporteCaixaResolver_({}, { ...payload, courier: 'OCASA' }).tipoCaixa, 'SEPIO');
});

test('salvar força caixa BioSystem e reabrir preserva snapshot confirmado após mudar regra', () => {
  const { s, payload, projects, save, folha, email } = fixture();
  payload.solicitarCaixa = 'Não';
  const registro = save();
  assert.equal(registro.solicitarCaixa, 'Sim, BioSystem');
  assert.equal(email.getRange('B8').getValue(), 'Sim, BioSystem');
  assert.equal(registro.caixaTransporte.confirmado, true);
  projects[1][3] = '[]';
  const read = s.transporteReadRegistro_();
  assert.equal(folha.getRange('C3').getValue(), 'P. | ID: 123');
  assert.equal(read.paciente, 'Pessoa');
  assert.equal(read.caixaTransporte.tipoCaixa, 'BIOSYSTEM');
  assert.equal(s.transporteCaixaDoModelo_({}).caixaTransporte.tipoCaixa, 'BIOSYSTEM');
  assert.equal(save().caixaTransporte.tipoCaixa, 'BIOSYSTEM');
  assert.ok(folha.getRange('C15').getNote().includes('BIOSYSTEM'));
});

test('rascunho não congela regra antes da confirmação; transporte comum confirmado preserva padrão', () => {
  const { projects, save, rule } = fixture();
  projects[1][3] = '[]';
  assert.equal(save({ rascunho: true }).caixaTransporte.tipoCaixa, '');
  projects[1][3] = JSON.stringify([rule]);
  assert.equal(save().caixaTransporte.tipoCaixa, 'BIOSYSTEM');
  const regular = fixture();
  regular.projects[1][3] = '[]';
  regular.save();
  regular.projects[1][3] = JSON.stringify([regular.rule]);
  assert.equal(regular.save().caixaTransporte.tipoCaixa, '');
});

test('snapshot por slot conserva nota manual, distingue envios e sobrevive à troca do formulário compartilhado', () => {
  const { s, payload, save, agenda, projects, folha } = fixture();
  payload.idAgenda = 'EVT1'; payload.agendaSlot = '1';
  agenda.getRange(2, 1).setNote('Nota manual');
  save();
  assert.ok(agenda.getRange(2, 1).getNote().startsWith('Nota manual\n'));
  folha.getRange('C15').clearNote();
  projects[1][3] = '[]';
  assert.equal(s.transporteCaixaResolver_({}, payload).tipoCaixa, 'BIOSYSTEM');
  assert.equal(s.transporteCaixaResolver_({}, { ...payload, agendaSlot: '2' }).tipoCaixa, '');
  assert.equal(s.transporteCaixaResolver_({}, { ...payload, destino: 'Outro Lab' }).tipoCaixa, '');
});

test('reavaliar descarta a Crēdo Cube confirmada pela regra atual e conserva a nota manual', () => {
  const { s, payload, projects, rule, save, reavaliar, agenda, folha, email, eventos, auditorias } = fixture();
  projects[1][3] = JSON.stringify([{ ...rule, temperatura: 'REFRIGERADO', tipoCaixa: 'CREDO_CUBE' }]);
  Object.assign(payload, { idAgenda: 'EVT1', agendaSlot: '1', temperatura: 'REFRIGERADO' });
  agenda.getRange(2, 1).setNote('Nota manual');
  assert.equal(save().caixaTransporte.tipoCaixa, 'CREDO_CUBE');
  projects[1][3] = '[]';
  assert.equal(save().caixaTransporte.tipoCaixa, 'CREDO_CUBE', 'alterar o projeto não reclassifica sozinho');

  payload.solicitarCaixa = 'Sim, Crēdo Cube';
  const registro = reavaliar();
  assert.equal(registro.caixaTransporte.tipoCaixa, '');
  assert.equal(registro.caixaTransporte.confirmado, true);
  assert.equal(registro.caixaTransporte.tipoCaixaAnterior, 'CREDO_CUBE');
  assert.ok(registro.caixaTransporte.reavaliadoEm);
  assert.equal(registro.solicitarCaixa, 'Não');
  assert.equal(email.getRange('B8').getValue(), 'Não');
  assert.deepEqual(eventos, ['autorizar:reavaliarCaixaTransporte', 'lock:reavaliarCaixaTransporte']);

  const nota = agenda.getRange(2, 1).getNote();
  assert.ok(nota.startsWith('Nota manual\n'));
  assert.equal(nota.match(/\[IPS_CAIXA_V1\]/g).length, 1);
  assert.equal(s.transporteCaixaNoteRead_(nota).tipoCaixa, '');
  assert.equal(JSON.parse(folha.getRange('C15').getNote()).caixaTransporte.tipoCaixa, '');
  assert.equal(auditorias.length, 1);
  assert.equal(auditorias[0][1], 'reavaliarCaixaTransporte');
  assert.equal(auditorias[0][2], 'EVT1');
  assert.equal(auditorias[0][3][0].field, 'Transporte 1 - Caixa especial');
  assert.equal(auditorias[0][3][0].oldValue, 'Crēdo Cube');
  assert.equal(auditorias[0][3][0].newValue, 'Caixa normal');

  // A nova decisão também fica confirmada: voltar a regra não reclassifica sem nova ação.
  projects[1][3] = JSON.stringify([{ ...rule, temperatura: 'REFRIGERADO', tipoCaixa: 'CREDO_CUBE' }]);
  assert.equal(save().caixaTransporte.tipoCaixa, '');
  assert.equal(reavaliar().caixaTransporte.tipoCaixa, 'CREDO_CUBE');
});

test('salvar com pedido de reavaliação nas opções não reclassifica o envio confirmado', () => {
  const { projects, save } = fixture();
  save();
  projects[1][3] = '[]';
  assert.equal(save({ reavaliarCaixa: true }).caixaTransporte.tipoCaixa, 'BIOSYSTEM');
});

test('reavaliar sem regra válida não grava; nota de caixa inválida não impede a correção', () => {
  const { s, payload, projects, rule, save, reavaliar, agenda, folha, auditorias } = fixture();
  Object.assign(payload, { idAgenda: 'EVT1', agendaSlot: '1' });
  agenda.getRange(2, 1).setNote('Nota manual');
  save();
  const notas = [agenda.getRange(2, 1).getNote(), folha.getRange('C15').getNote()];
  for (const invalida of ['{', JSON.stringify([rule, rule])]) {
    projects[1][3] = invalida;
    assert.throws(reavaliar, /Revise|Mais de uma regra/);
    assert.deepEqual([agenda.getRange(2, 1).getNote(), folha.getRange('C15').getNote()], notas);
  }
  assert.equal(auditorias.length, 0);

  projects[1][3] = '[]';
  agenda.getRange(2, 1).setNote('Nota manual\n[IPS_CAIXA_V1]{[/IPS_CAIXA_V1]');
  assert.throws(save, /inválido/);
  const registro = reavaliar();
  assert.equal(registro.caixaTransporte.tipoCaixa, '');
  assert.ok(agenda.getRange(2, 1).getNote().startsWith('Nota manual\n'));
  assert.equal(s.transporteCaixaNoteRead_(agenda.getRange(2, 1).getNote()).tipoCaixa, '');
});

test('envio sem Agenda reavalia pela nota C15 e não gera auditoria da Agenda', () => {
  const { projects, save, reavaliar, folha, auditorias } = fixture();
  save();
  projects[1][3] = '[]';
  const registro = reavaliar();
  assert.equal(registro.caixaTransporte.tipoCaixa, '');
  assert.equal(registro.caixaTransporte.tipoCaixaAnterior, 'BIOSYSTEM');
  assert.equal(JSON.parse(folha.getRange('C15').getNote()).caixaTransporte.tipoCaixa, '');
  assert.equal(auditorias.length, 0);
});

test('Invoice ambiente BioSystem usa 2 kg; padrão, congelado e Sepio preservam valores existentes', () => {
  const { s, payload, folha, invoice } = fixture();
  folha.getRange('C6').setValue('AMBIENTE');
  const special = { ...payload, caixaTransporte: s.transporteCaixaResolver_({}, payload) };
  s.atualizarMarkenVolumes_({}, special);
  assert.equal(invoice.getRange('T41').getValue(), '2 Kg');
  assert.equal(invoice.getRange('T39').getValue(), 1);
  s.atualizarMarkenVolumes_({}, payload);
  assert.equal(invoice.getRange('T41').getValue(), '1 Kg');
  folha.getRange('C6').setValue('CONGELADO');
  s.atualizarMarkenVolumes_({}, { ...special, temperatura: 'CONGELADO' });
  assert.equal(invoice.getRange('T41').getValue(), '5 Kg');
  assert.equal(s.transporteCaixaBioSystem_({ ...special, courier: 'OCASA', caixaTransporte: { tipoCaixa: 'SEPIO' } }), false);
});

test('JSON inválido alheio não bloqueia o envio, mas o projeto afetado e ambiguidades exigem revisão', () => {
  const { s, projects, payload } = fixture();
  projects.push(['P2', 'Outro estudo', '', '{']);
  assert.equal(s.transporteCaixaResolver_({}, payload).tipoCaixa, 'BIOSYSTEM');
  assert.throws(() => s.transporteCaixaResolver_({}, { ...payload, protocolo: 'Outro estudo' }), /Revise/);
  projects[1][3] = JSON.stringify([JSON.parse(projects[1][3])[0], JSON.parse(projects[1][3])[0]]);
  assert.throws(() => s.transporteCaixaResolver_({}, payload), /Mais de uma regra/);
});

test('BioSystem preenche somente o campo original de caixa e preserva a tabela da courier', () => {
  const { s } = fixture();
  let rows = [['Agendamento', ''], ['Nº HAWB', 'TESTE'], ['PI', 'Investigador'], ['Data da Coleta', '20/10/2026'], ['Horário', '13:00 - 15:00'], ['Quantidade de volumes', '1'], ['Temperatura:', 'Antiga'], ['Enviar Caixa de Transporte', 'Não'], ['Cidade', 'Caxias do Sul']];
  const matrix = value => rows.map(() => [value, value]);
  s.transporteCodexGetSheet_ = () => ({ getRange: () => ({ getDisplayValues: () => rows.map(row => row.slice()), getBackgrounds: () => matrix('#fff'), getFontColors: () => matrix('#000'), getFontWeights: () => matrix('normal'), getHorizontalAlignments: () => matrix('left') }) });
  const html = s.transporteCodexEmailHtml_({}, '', 'MARKEN', 'Bom dia', 'AMBIENTE', 'Sim, BioSystem');
  assert.match(html, />Sim, BioSystem<\/td>/);
  assert.match(html, />AMBIENTE<\/td>/);
  assert.match(html, />Enviar Caixa de Transporte<\/td><td[^>]*>Sim, BioSystem<\/td>/);
  assert.doesNotMatch(html, /Fornecer caixa/);
  assert.equal((html.match(/<tr>/g) || []).length, rows.length);
  assert.equal(rows[7][1], 'Não');
  rows[7][1] = 'Sim';
  const convencional = s.transporteCodexEmailHtml_({}, '', 'MARKEN', 'Bom dia', 'AMBIENTE', false);
  assert.match(convencional, />Enviar Caixa de Transporte<\/td><td[^>]*>Não<\/td>/);
  assert.equal((convencional.match(/<tr>/g) || []).length, 9);
  rows = [['Agendamento', ''], ['Temperatura', 'AMBIENTE']];
  assert.throws(() => s.transporteCodexEmailHtml_({}, '', 'MARKEN', '', 'AMBIENTE', true), /campo de envio de caixa/);
  assert.equal(rows.length, 2);
  rows = [['Coleta', ''], ['Temperatura', ''], ['Fornecer caixa', 'Não'], ['Solicitar caixa', 'Não']];
  assert.throws(() => s.transporteCodexEmailHtml_({}, '', 'MARKEN', '', 'AMBIENTE', true), /campo de envio de caixa/);
});

test('trocar BioSystem por convencional restaura Não no servidor, mesmo com Sim antigo no payload', () => {
  const { s, payload, save, email, invoice } = fixture();
  assert.equal(save().solicitarCaixa, 'Sim, BioSystem');
  s.atualizarMarkenVolumes_({});
  assert.equal(invoice.getRange('T41').getValue(), '2 Kg');
  payload.destino = 'Outro Lab';
  payload.solicitarCaixa = 'Sim';
  const convencional = save();
  assert.equal(convencional.caixaTransporte.tipoCaixa, '');
  assert.equal(convencional.solicitarCaixa, 'Não');
  assert.equal(email.getRange('B8').getValue(), 'Não');
  s.atualizarMarkenVolumes_({});
  assert.equal(invoice.getRange('T41').getValue(), '1 Kg');
});

test('Crēdo Cube vale nas três temperaturas com resposta própria, 5 kg e sem gelo seco', () => {
  for (const temperatura of ['AMBIENTE', 'REFRIGERADO', 'CONGELADO']) {
    const { s, payload, projects, rule, save, folha, declaracao, invoice, email } = fixture();
    projects[1][3] = JSON.stringify([{ ...rule, temperatura, tipoCaixa: 'CREDO_CUBE' }]);
    payload.temperatura = temperatura;
    payload.solicitarCaixa = 'Não';
    const registro = save();
    assert.equal(registro.caixaTransporte.tipoCaixa, 'CREDO_CUBE');
    assert.equal(registro.solicitarCaixa, 'Sim, Crēdo Cube');
    assert.equal(email.getRange('B8').getValue(), 'Sim, Crēdo Cube');
    assert.equal(s.transporteReadSolicitarCaixa_({}, 'MARKEN', temperatura), 'Sim, Crēdo Cube');
    folha.getRange('C6').setValue(temperatura);
    folha.getRange('C10').setValue('MARKEN');
    folha.getRange('C11').setValue('EUROFINS (LANCASTER)');
    const especial = { ...payload, caixaTransporte: registro.caixaTransporte };
    s.atualizarMarkenVolumes_({}, especial);
    assert.equal(invoice.getRange('T41').getValue(), '5 Kg');
    s.verificarEAtualizarG33Declaracao_({}, especial);
    assert.equal(declaracao.getRange('G33').getValue(), '---');
    if (temperatura === 'CONGELADO') {
      s.verificarEAtualizarG33Declaracao_({}, { ...payload, caixaTransporte: { tipoCaixa: '' } });
      assert.equal(declaracao.getRange('G33').getValue(), 10);
    }
  }
});

test('Crēdo Cube não se aplica a outra courier nem a temperatura mista; resposta antiga não persiste', () => {
  const { s, payload, projects, rule } = fixture();
  const caixaTransporte = { tipoCaixa: 'CREDO_CUBE' };
  assert.equal(s.transporteCaixaCredoCube_({ ...payload, courier: 'OCASA', caixaTransporte }), false);
  assert.equal(s.transporteCaixaCredoCube_({ ...payload, temperatura: 'AMBIENTE + CONGELADO', caixaTransporte }), false);
  projects[1][3] = JSON.stringify([{ ...rule, courierId: 'O1', tipoCaixa: 'CREDO_CUBE' }]);
  assert.throws(() => s.transporteCaixaResolver_({}, { ...payload, courier: 'OCASA' }), /Revise/);
  const convencional = { ...payload, temperatura: 'REFRIGERADO', caixaTransporte: { tipoCaixa: '' } };
  assert.equal(s.transporteSolicitarCaixaMarken_(convencional, 'Sim, Crēdo Cube'), 'Não');
  assert.equal(s.transporteSolicitarCaixaMarken_(convencional, 'Sim, BioSystem'), 'Não');
  assert.equal(s.transporteSolicitarCaixaMarken_(convencional, 'Sim'), 'Sim');
  assert.doesNotThrow(() => s.transporteCaixaNoteRead_('[IPS_CAIXA_V1]{"versao":1,"contexto":[],"tipoCaixa":"CREDO_CUBE"}[/IPS_CAIXA_V1]'));
});

test('feriados do prazo da Crēdo Cube só são lidos quando alguma regra usa a caixa', () => {
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  let leituras = 0;
  s.getAgendaFeriadosPendenciasMap_ = () => { leituras++; return { '2026-11-12': true }; };
  assert.equal(s.transporteCaixasFeriados_([{ tipoCaixa: 'BIOSYSTEM' }]), null);
  assert.equal(s.transporteCaixasFeriados_(undefined), null);
  assert.equal(leituras, 0);
  assert.equal(s.transporteCaixasFeriados_([{ tipoCaixa: 'CREDO_CUBE' }])['2026-11-12'], true);
});

test('Pendências citam a caixa especial só quando uma regra combina com o transporte', () => {
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  const regra = { nomeAbreviado: 'Estudo', codigo: 'ABC-1', courier: 'MARKEN', temperatura: 'REFRIGERADO', destino: 'Lab A', tipoCaixa: 'CREDO_CUBE' };
  s.transporteCaixasRegras_ = () => [regra, { nomeAbreviado: 'Outro', erro: 'Revise' }];
  const item = extra => ({ projeto: 'Estudo (ABC-1)', courier: 'Marken', temperatura: 'Refrigerado', destino: 'Lab A', ...extra });
  const pendencias = {
    courierNaoAgendada: [item(), item({ temperatura: 'Congelado' })],
    courierNaoConfirmada: [item({ destino: 'Lab B' })],
    documentacaoTransporteSemEnvio: [item({ courier: 'OCASA' })]
  };
  s.transporteCaixasAnotarPendencias_(pendencias);
  assert.equal(pendencias.courierNaoAgendada[0].caixa, 'Crēdo Cube');
  for (const outro of [pendencias.courierNaoAgendada[1], pendencias.courierNaoConfirmada[0], pendencias.documentacaoTransporteSemEnvio[0]]) assert.equal(outro.caixa, undefined);

  // Regra duplicada não é resolvida por palpite, e sem pendências as regras nem são lidas.
  s.transporteCaixasRegras_ = () => [regra, regra];
  const duplicada = { courierNaoAgendada: [item()] };
  s.transporteCaixasAnotarPendencias_(duplicada);
  assert.equal(duplicada.courierNaoAgendada[0].caixa, undefined);
  s.transporteCaixasRegras_ = () => { throw new Error('nao deveria ler'); };
  assert.doesNotThrow(() => s.transporteCaixasAnotarPendencias_({}));
  // Falha de leitura não derruba a lista.
  assert.doesNotThrow(() => s.transporteCaixasAnotarPendencias_({ courierNaoAgendada: [item()] }));
});

test('hash documental muda com a caixa e nota inválida não é inferida', () => {
  const { s, payload } = fixture();
  const base = s.transportePdfDocumentoHash_({}, payload);
  assert.notEqual(base, s.transportePdfDocumentoHash_({}, { ...payload, caixaTransporte: s.transporteCaixaResolver_({}, payload) }));
  assert.throws(() => s.transporteCaixaNoteRead_('[IPS_CAIXA_V1]{[/IPS_CAIXA_V1]'), /inválido/);
});

test('rascunho BioSystem vai para operações, Crēdo Cube para protocolos; Sepio conserva destinatário e tabela OCASA', () => {
  for (const type of ['BIOSYSTEM', 'CREDO_CUBE', 'SEPIO', '']) {
    const { s, payload, projects, rule, save, email } = fixture();
    if (type === 'SEPIO') { payload.courier = 'OCASA'; projects[1][3] = JSON.stringify([{ ...rule, courierId: 'O1', tipoCaixa: 'SEPIO' }]); }
    if (type === 'CREDO_CUBE') projects[1][3] = JSON.stringify([{ ...rule, tipoCaixa: 'CREDO_CUBE' }]);
    if (!type) projects[1][3] = '[]';
    save();
    const rows = [['Coleta', ''], ['Temperatura', 'AMBIENTE'], ['Fornecer caixa', 'Não']];
    const matrix = value => rows.map(() => [value, value]);
    const model = { getRange: () => ({ getDisplayValues: () => rows.map(row => row.slice()), getBackgrounds: () => matrix('#fff'), getFontColors: () => matrix('#000'), getFontWeights: () => matrix('normal'), getHorizontalAlignments: () => matrix('left') }) };
    const original = s.transporteCodexGetSheet_;
    s.transporteCodexGetSheet_ = (ss, key) => ['emailMarken', 'emailOcasa'].includes(key) ? model : original(ss, key);
    s.transporteCourierEmailRecipients_ = courier => [courier.toLowerCase() + '@example.invalid'];
    s.transporteAssertGmailDraftAllowed_ = () => ({ ok: true });
    s.transporteActiveUserEmail_ = s.transporteEffectiveUserEmail_ = () => 'teste@example.invalid';
    s.transporteCodexSaudacao_ = () => 'Bom dia'; s.transporteCodexFormatDateTitle_ = () => '';
    s.transporteDraftCcRecipients_ = () => ['equipe@example.invalid', 'ExpoBrasil@marken.com']; s.transporteCodexEmailAttachments_ = () => [];
    s.getGmailSignature = () => ''; s.transporteGmailAuthorizationUrl_ = () => '';
    const drafts = [];
    s.GmailApp = { createDraft: (to, _title, _body, options) => { drafts.push({ to, cc: options.cc, html: options.htmlBody }); return { getId: () => 'DRAFT-1' }; } };
    const result = s.criarRascunhoEmail_({ temperaturaPdf: 'AMBIENTE' });
    assert.equal(result.ok, true, result.message);
    const especiais = { BIOSYSTEM: 'operacoes.cs@marken.com', CREDO_CUBE: 'protocolos.credo@marken.com' };
    assert.equal(drafts[0].to, especiais[type] || payload.courier.toLowerCase() + '@example.invalid');
    // Crēdo Cube: equipe segue em cópia, expobrasil não; demais caixas não mudam.
    assert.equal(drafts[0].cc, type === 'CREDO_CUBE' ? 'equipe@example.invalid' : 'equipe@example.invalid, ExpoBrasil@marken.com');
    if (type === 'SEPIO') {
      assert.match(drafts[0].html, />Não<\/td>/);
      assert.equal(email.getRange('B8').getValue(), '');
    } else if (type) assert.match(drafts[0].html, type === 'CREDO_CUBE' ? />Sim, Crēdo Cube<\/td>/ : />Sim, BioSystem<\/td>/);
  }
});

// Geracao nao regrava o formulario que a abertura ou o Salvar acabaram de gravar.
function comContagem() {
  const f = fixture();
  let gravacoes = 0;
  const original = f.s.transporteEscreverCamposModelos_;
  f.s.transporteEscreverCamposModelos_ = (...args) => { gravacoes++; return original(...args); };
  f.s.transporteAwbReservar_ = () => {};
  f.s.transporteAwbAviso_ = () => null;
  Object.assign(f.payload, { idAgenda: 'A1', agendaSlot: '1', awb: '620X41252059' });
  return { ...f, gravacoes: () => gravacoes, gerar: () => f.save({ pularCamposIguais: true }) };
}

test('geracao pula a gravacao quando os campos sao iguais aos ja gravados', () => {
  const f = comContagem();
  f.save();
  assert.equal(f.gravacoes(), 1);
  f.gerar();
  assert.equal(f.gravacoes(), 1);
  assert.ok(JSON.parse(f.folha.getRange('C15').getNote()).assinaturaCampos);
});

test('qualquer campo alterado grava de novo', () => {
  for (const mudanca of [{ awb: '620X99999999' }, { observacoes: 'Novo' }, { destino: 'Outro Lab' }, { horaEnvio: '10:00' }, { temperatura: 'CONGELADO' }, { materiais: [{ ativo: true, tubos: 3 }] }]) {
    const f = comContagem();
    f.save();
    Object.assign(f.payload, mudanca);
    f.gerar();
    assert.equal(f.gravacoes(), 2, JSON.stringify(mudanca));
  }
});

test('outro envio com os mesmos dados nao aproveita a gravacao anterior', () => {
  const f = comContagem();
  f.save();
  f.payload.agendaSlot = '2';
  f.gerar();
  assert.equal(f.gravacoes(), 2);
});

test('Salvar sempre grava, mesmo com campos iguais', () => {
  const f = comContagem();
  f.save();
  f.save();
  assert.equal(f.gravacoes(), 2);
});

test('nota apagada, ilegivel ou sem assinatura grava de novo', () => {
  for (const nota of ['', 'nao e json', '{"idAgenda":"A1"}']) {
    const f = comContagem();
    f.save();
    f.folha.getRange('C15').setNote(nota);
    f.gerar();
    assert.equal(f.gravacoes(), 2, nota);
  }
});

test('Folha divergente da nota grava de novo', () => {
  const f = comContagem();
  f.save();
  f.folha.getRange('C12').setValue('OUTRA-AWB');
  f.gerar();
  assert.equal(f.gravacoes(), 2);
});

test('sem assinatura calculavel a gravacao nunca e pulada', () => {
  const f = comContagem();
  f.s.transportePdfManifestoHash_ = () => { throw new Error('indisponivel'); };
  f.save();
  f.gerar();
  assert.equal(f.gravacoes(), 2);
});

test('caixa confirmada na geracao e registrada mesmo sem regravar os campos', () => {
  const f = comContagem();
  f.save({ rascunho: true });
  f.gerar();
  assert.equal(f.gravacoes(), 1);
  assert.equal(JSON.parse(f.folha.getRange('C15').getNote()).caixaTransporte.confirmado, true);
});
