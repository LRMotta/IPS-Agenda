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
  function save(options = {}) {
    s.transporteReadParticipantesDireto_ = () => [];
    s.transporteAtualizarRegistroPorAgenda_ = value => value;
    s.transporteDerivarDadosParticipante_ = value => value;
    s.transporteValidarObrigatoriosWebApp_ = () => {};
    s.codexMatBioValidateTransportPayload_ = () => {};
    s.transporteProjetoDisplay_ = value => value;
    s.transporteAjustarVolumesDeclaracao_ = () => {};
    s.transporteSetTopLeftInBlock_ = (sheet, a1, value) => sheet.getRange(a1.split(':')[0]).setValue(value);
    s.transporteSincronizarAgenda_ = value => { s.transporteCaixaPersistirAgenda_(value); return {}; };
    return s.salvarTransporteInterno_({ ...payload }, { returnBootstrap: false, returnPreparedRecord: true, preencherDocumentos: false, ...options }).registro;
  }
  return { s, folha, declaracao, invoice, email, agenda, projects, rule, payload, save };
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
  assert.equal(registro.solicitarCaixa, 'Sim');
  assert.equal(email.getRange('B8').getValue(), 'Sim');
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
  const html = s.transporteCodexEmailHtml_({}, '', 'MARKEN', 'Bom dia', 'AMBIENTE', true);
  assert.match(html, />Sim<\/td>/);
  assert.match(html, />AMBIENTE<\/td>/);
  assert.match(html, />Enviar Caixa de Transporte<\/td><td[^>]*>Sim<\/td>/);
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
  assert.equal(save().solicitarCaixa, 'Sim');
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

test('hash documental muda com a caixa e nota inválida não é inferida', () => {
  const { s, payload } = fixture();
  const base = s.transportePdfDocumentoHash_({}, payload);
  assert.notEqual(base, s.transportePdfDocumentoHash_({}, { ...payload, caixaTransporte: s.transporteCaixaResolver_({}, payload) }));
  assert.throws(() => s.transporteCaixaNoteRead_('[IPS_CAIXA_V1]{[/IPS_CAIXA_V1]'), /inválido/);
});

test('rascunho BioSystem vai para operações; Sepio conserva destinatário e tabela OCASA', () => {
  for (const type of ['BIOSYSTEM', 'SEPIO', '']) {
    const { s, payload, projects, rule, save, email } = fixture();
    if (type === 'SEPIO') { payload.courier = 'OCASA'; projects[1][3] = JSON.stringify([{ ...rule, courierId: 'O1', tipoCaixa: 'SEPIO' }]); }
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
    s.transporteDraftCcRecipients_ = () => []; s.transporteCodexEmailAttachments_ = () => [];
    s.getGmailSignature = () => ''; s.transporteGmailAuthorizationUrl_ = () => '';
    const drafts = [];
    s.GmailApp = { createDraft: (to, _title, _body, options) => { drafts.push({ to, html: options.htmlBody }); return { getId: () => 'DRAFT-1' }; } };
    const result = s.criarRascunhoEmail_({ temperaturaPdf: 'AMBIENTE' });
    assert.equal(result.ok, true, result.message);
    assert.equal(drafts[0].to, type === 'BIOSYSTEM' ? 'operacoes.cs@marken.com' : payload.courier.toLowerCase() + '@example.invalid');
    if (type === 'SEPIO') {
      assert.match(drafts[0].html, />Não<\/td>/);
      assert.equal(email.getRange('B8').getValue(), '');
    } else if (type) assert.match(drafts[0].html, />Sim<\/td>/);
  }
});
