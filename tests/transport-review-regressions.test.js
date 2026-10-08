'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const norm = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const participante = { id: 'CAD-A', nome: 'Pessoa A', idParticipante: '123', projeto: 'Projeto A' };

function server(extra = {}) {
  return runFile('TransporteCodexConfig.gs', { Logger: { log() {} }, normText_: norm,
    codexGetAllowedUsers_: () => ({ 'operador@example.invalid': { active: true } }), ...extra });
}

function formSheet(name) {
  const sheet = new FakeSheet(name, []);
  const getRange = sheet.getRange.bind(sheet);
  const notes = {};
  sheet.validationClears = [];
  sheet.blocks = [];
  sheet.getRange = (row, col, height, width) => {
    const a1 = typeof row === 'string' ? row : '';
    if (a1) {
      const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
      assert.ok(match, a1);
      const column = text => [...text].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      row = Number(match[2]);
      col = column(match[1]);
      height = match[4] ? Number(match[4]) - row + 1 : 1;
      width = match[3] ? column(match[3]) - col + 1 : 1;
    }
    const range = getRange(row, col, height, width);
    range.getA1Notation = () => a1;
    range.getNote = () => notes[a1] || '';
    range.setNote = value => { notes[a1] = value; return range; };
    range.clearNote = () => { delete notes[a1]; return range; };
    range.clearDataValidations = () => { sheet.validationClears.push(a1); return range; };
    const setValues = range.setValues.bind(range);
    range.setValues = values => { sheet.blocks.push(a1); return setValues(values); };
    return range;
  };
  return sheet;
}

function saveFixture(withPeticao = false) {
  const folha = formSheet('Folha');
  const declaracao = formSheet('Declaracao');
  const dhl = formSheet('DHL');
  const peticao = withPeticao ? formSheet('Peticao') : null;
  let reads = 0;
  const s = server({ SpreadsheetApp: { flush() {} }, codexCourierRequiresAwb_: () => false, codexCourierAssertDocumentAwb_() {} });
  s.getTransporteSpreadsheetCodex_ = () => ({});
  s.transporteGetSheet_ = (_ss, key) => ({ folhaAgendamento: folha, declaracaoTransp: declaracao, folhaDhlPinex: dhl, peticaoAnuencia: peticao })[key] || null;
  s.transporteReadParticipantesDireto_ = () => { reads++; return [participante]; };
  s.transporteInvestigadorPorProjeto_ = () => 'Investigador';
  s.transporteProjetoDisplay_ = value => value;
  s.transporteLabCentralByDestino_ = () => ({ nome: 'Lab' });
  s.transporteSetTopLeftInBlock_ = (sheet, a1, value) => sheet.getRange(a1.split(':')[0]).setValue(value);
  s.transporteAjustarVolumesDeclaracao_ = () => {};
  if (!withPeticao) s.transporteSetEnsaiosPeticao_ = () => {};
  s.transporteSincronizarAgenda_ = () => ({ atualizado: false });
  const payload = {
    paciente: 'Pessoa antiga', participanteCadastroId: 'CAD-A', identificacaoParticipante: '999',
    protocolo: 'Projeto antigo', investigador: 'Investigador', temperatura: 'AMBIENTE',
    dataColeta: '2026-09-30', dataEnvio: '2026-09-30', horaEnvio: '08:00 - 12:00',
    courier: 'DHL', destino: 'Lab', agendadoPor: 'Usuario', materiais: []
  };
  return { s, folha, declaracao, dhl, peticao, payload, reads: () => reads };
}

test('salvar e reabrir preserva todos os ensaios e materiais personalizados sem alterar notas manuais', () => {
  const { s, declaracao, peticao, payload } = saveFixture(true);
  payload.materiais = s.TRANSPORTE_MATERIAIS.map((material, index) => ({
    ativo: true, material, formula: '1x0', ensaio: 'Ensaio ' + (index + 1), unit: s.codexMatBioUnit_(s.transporteMaterialKey_(material), 'mL') === 'g' ? 'g' : 'L'
  }));
  payload.materiais.push({ ativo: true, material: 'Liquor', ensaio: 'PCR A', formula: '2x0,003', unit: 'L' },
    { ativo: true, material: 'Swab', ensaio: 'PCR B', formula: '', unit: 'L' });
  delete payload.materiais[6].ensaio;
  payload.materiais[6].exame = 'Ensaio 7';
  delete payload.materiais[9].ensaio;
  payload.materiais[9].nomeExame = 'PCR B';
  declaracao.getRange('F30').setNote('Nota manual');
  s.transporteReadSolicitarCaixa_ = () => false;
  s.transporteDateOut_ = () => '2026-09-30';
  s.salvarTransporteInterno_(payload, { returnBootstrap: false, preencherDocumentos: false });
  const read = s.transporteReadRegistro_().materiais;
  assert.equal(read.length, 10);
  for (let i = 0; i < 8; i++) {
    assert.equal(read[i].ensaio, 'Ensaio ' + (i + 1));
    assert.equal(read[i].total, 0);
  }
  assert.equal(read[8].material, 'Liquor');
  assert.equal(read[8].ensaio, 'PCR A');
  assert.equal(read[8].total, 0.006);
  assert.equal(read[9].material, 'Swab');
  assert.equal(read[9].ensaio, 'PCR B');
  assert.ok(declaracao.getRange('F30').getNote().startsWith('Nota manual\n'));
  s.salvarTransporteInterno_(payload, { returnBootstrap: false, preencherDocumentos: false });
  assert.equal((declaracao.getRange('F30').getNote().match(/\[CODEX_TRANSPORTE_MATERIAIS_V1\]/g) || []).length, 1);
  declaracao.getRange('F30').setValue('Material alterado manualmente');
  declaracao.getRange('J21').setValue('2x1');
  peticao.getRange('P31').setValue('Ensaio editado manualmente');
  const edited = s.transporteReadRegistro_().materiais;
  assert.equal(edited[8].material, 'Material alterado manualmente');
  assert.equal(edited[8].formula, '');
  assert.equal(edited[0].ensaio, 'Ensaio 1', 'mantem a leitura da Peticao apos editar a formula');
  assert.equal(edited[1].ensaio, 'Ensaio editado manualmente');
  assert.equal(edited[6].ensaio, 'Ensaio 7');
});

test('metadados excessivos sao rejeitados antes da primeira escrita', () => {
  const { s, folha, declaracao, dhl, payload } = saveFixture();
  payload.materiais = s.transporteMateriaisFromCodex_('DHL', '', 'A'.repeat(46000));
  assert.throws(() => s.salvarTransporteInterno_(payload, { returnBootstrap: false, preencherDocumentos: false }), /limite de armazenamento/);
  assert.equal(folha.writes + declaracao.writes + dhl.writes, 0);
});

for (const action of ['limparTransporte', 'sincronizarTransporte']) {
  test(action + ' protege todas as escritas e a releitura com o mesmo lock', () => {
    let locked = false;
    let calls = 0;
    const s = server({
      codexAssertCanWrite_() { assert.equal(locked, false); },
      codexWithDocumentLock_: (_label, fn) => { locked = true; try { return fn(); } finally { locked = false; } },
      SpreadsheetApp: { flush() { assert.equal(locked, true); } }
    });
    s.performContentDeletion_ = () => { assert.equal(locked, true); calls++; return 'OK'; };
    s.transporteSincronizarDependencias_ = () => { assert.equal(locked, true); calls++; };
    s.getTransporteBootstrap = () => { assert.equal(locked, true); return { registro: {} }; };
    s[action]();
    assert.equal(calls, action === 'limparTransporte' ? 2 : 1);
    assert.equal(locked, false);
  });
}

test('cadastro inexistente e falha de leitura bloqueiam o salvamento antes de qualquer escrita', () => {
  for (const failure of ['ausente', 'leitura']) {
    const { s, folha, declaracao, dhl, payload } = saveFixture();
    if (failure === 'ausente') payload.participanteCadastroId = 'INEXISTENTE';
    else s.transporteReadParticipantesDireto_ = () => { throw new Error('Leitura indisponivel'); };
    assert.throws(() => s.salvarTransporteInterno_(payload, { returnBootstrap: false }), failure === 'ausente' ? /inequívoca/ : /Leitura indisponivel/);
    assert.equal(folha.writes + declaracao.writes + dhl.writes, 0);
  }
});

test('participacao ambigua e identificacao ausente no cadastro bloqueiam a validacao definitiva', () => {
  const s = server();
  s.transporteReadParticipantesDireto_ = () => [participante, { ...participante, id: 'CAD-B' }];
  assert.throws(() => s.transporteDerivarDadosParticipante_({ paciente: 'Pessoa A', protocolo: 'Projeto A' }, { obrigatorio: true }), /inequívoca/);
  s.transporteReadParticipantesDireto_ = () => [{ ...participante, idParticipante: '' }];
  assert.throws(() => s.transporteDerivarDadosParticipante_({ participanteCadastroId: 'CAD-A', identificacaoParticipante: '999' }, { obrigatorio: true }), /coluna E/);
});

test('vinculo da Agenda nao resolvido impede reutilizar a participacao antiga do formulario', () => {
  const { s, folha, declaracao, dhl, payload } = saveFixture();
  payload.idAgenda = 'EVT-1';
  payload.agendaSlot = '1';
  s.buscarAgendaEventoPorIdTransp_ = () => ({ participante: 'Pessoa B', idParticipante: '456', projeto: 'Projeto B' });
  assert.throws(() => s.salvarTransporteInterno_(payload, { returnBootstrap: false }), /vinculado à Agenda.*inequívoca/);
  assert.equal(folha.writes + declaracao.writes + dhl.writes, 0);
});

test('ponte da Agenda consulta participante por cadastro e projeto sem calcular historico', () => {
  let received;
  const s = server({
    agendaInfoParticipanteParaSalvar_: ref => { received = ref; return participante; },
    getInfoParticipante() { throw new Error('Historico desnecessario'); }
  });
  s.transporteJanelaEnvioPadrao_ = () => '';
  s.transporteAgendadorPadrao_ = () => '';
  const payload = s.montarPayloadTransporteParaTransp_('EVT-1', '1', {
    participante: 'Pessoa A', participantCadastroId: 'CAD-A', idParticipante: '123', projeto: 'Projeto A', courier1: { nome: 'DHL' }
  });
  assert.equal(received.participanteCadastroId, 'CAD-A');
  assert.equal(received.projeto, 'Projeto A');
  assert.equal(payload.participanteCadastroId, 'CAD-A');
});

test('pre-preenchimento incompleto permanece disponivel para revisao', () => {
  const { s, folha, payload } = saveFixture();
  payload.participanteCadastroId = 'INEXISTENTE';
  const result = s.salvarTransporteInterno_(payload, { rascunho: true, returnBootstrap: false, preencherDocumentos: false });
  assert.equal(result.rascunho, true);
  assert.ok(folha.writes > 0);
});

test('salvamento deriva cadastro atual uma vez e grava os campos em blocos mantendo datas e metadados', () => {
  const { s, folha, dhl, payload, reads } = saveFixture();
  s.salvarTransporteInterno_(payload, { returnBootstrap: false, preencherDocumentos: false });
  assert.equal(reads(), 1);
  assert.equal(folha.getRange('C3').getValue(), 'Pessoa A');
  assert.equal(folha.getRange('C4').getValue(), 'Projeto A');
  assert.equal(folha.getRange('C9').getValue(), '08:00 - 12:00');
  assert.equal(Object.prototype.toString.call(folha.getRange('C7').getValue()), '[object Date]');
  assert.equal(folha.blocks.filter(a1 => a1 === 'C3:C14').length, 1);
  assert.deepEqual(folha.validationClears, ['C3:C14', 'C15']);
  assert.deepEqual(dhl.blocks, ['C12:C14']);
  const meta = s.transporteAgendaLinkFromRef_('', folha.getRange('C15').getNote());
  assert.equal(meta.idAgenda, '');
  assert.equal(meta.participanteCadastroId, 'CAD-A');
  assert.equal(meta.identificacaoParticipante, '123');
});

test('legado sem ID interno continua resolvendo por identificacao e projeto', () => {
  const s = server();
  s.transporteReadParticipantesDireto_ = () => [participante];
  s.transporteInvestigadorPorProjeto_ = () => '';
  const payload = s.transporteDerivarDadosParticipante_({ paciente: 'Nome historico', identificacaoParticipante: '123', protocolo: 'Projeto A' }, { obrigatorio: true });
  assert.equal(payload.participanteCadastroId, 'CAD-A');
  assert.equal(payload.paciente, 'Pessoa A');
});

test('PDF interrompe antes de acessar Drive quando a participacao nao pode ser resolvida', () => {
  let driveCalls = 0;
  const s = server({ DriveApp: { getFileById() { driveCalls++; throw new Error('Drive proibido'); } } });
  s.transporteReadParticipantesDireto_ = () => [];
  assert.match(s.imprimirTodasAbas({ payload: { paciente: 'Pessoa A', participanteCadastroId: 'INEXISTENTE' } }), /Erro ao gerar PDF:.*inequívoca/);
  assert.equal(driveCalls, 0);
});

test('manifesto bloqueia AWB, paciente, identificacao e protocolo divergentes', () => {
  const s = server();
  const payload = { idAgenda: 'EVT-1', agendaSlot: '1', courier: 'DHL', paciente: 'Pessoa A', identificacaoParticipante: '123', participanteCadastroId: 'CAD-A', protocolo: 'Projeto A', awb: 'AWB-A', materiais: [] };
  let atual = payload;
  s.getTransporteSpreadsheetCodex_ = () => ({});
  s.transporteReadRegistro_ = () => atual;
  s.transportePdfMaterialRowsPlanilha_ = () => [];
  s.transportePeticaoMaterialRows_ = () => [];
  s.transportePdfManifestoHash_ = () => 'hash';
  assert.equal(s.transporteValidarManifestoPdf_({ payload }).manifesto.versao, 2);
  for (const field of ['awb', 'paciente', 'identificacaoParticipante', 'participanteCadastroId', 'protocolo']) {
    atual = { ...payload, [field]: 'DIVERGENTE' };
    assert.throws(() => s.transporteValidarManifestoPdf_({ payload }), new RegExp('Bloqueio de seguranca.*' + field));
  }
});

for (const change of ['geracao', 'courier', 'evidencia']) {
  test('monitor descarta resultado quando ' + change + ' muda durante a busca Gmail', () => {
    const book = new FakeSpreadsheet({});
    const agenda = new FakeSheet('Agenda', [['Evento', 'Courier', 'Status', 'ID'], ['Agendado', 'DHL', 'Pendente', 'EVT-1']]);
    const messageDate = new Date(Date.now() + 1000);
    const s = server({
      getCodexSpreadsheet_: () => book,
      SpreadsheetApp: { flush() {} },
      AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
      AGENDA_CFG: { col: { status: 1, id: 4 }, idx: { c1: { nome: 1, status: 2 } } },
      getAgendaSheet_: () => agenda, encontrarLinhaPorId: () => 2,
      codexWithDocumentLock_: (_label, fn) => {
        const log = book.getSheetByName('Transporte_Operacoes');
        if (change === 'geracao') {
          log.getRange(2, 5).setValue(new Date(messageDate.getTime() + 600000));
          log.getRange(2, 7).setValue('PDF-NOVO');
        } else if (change === 'courier') log.getRange(2, 4).setValue('OCASA');
        else log.getRange(2, 14).setValue('MENSAGEM-NOVA');
        return fn();
      },
      GmailApp: { search: () => [{ getMessages: () => [{
        getFrom: () => 'operador@example.invalid', getSubject: () => '', getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-1-T1',
        getDate: () => messageDate, getId: () => 'MENSAGEM-ANTIGA', getAttachments: () => []
      }] }] }
    });
    s.transporteRegistrarDocumentacaoGerada_({ agendaId: 'EVT-1', slot: '1', courier: 'DHL', pdfId: 'PDF-ORIGINAL', rascunhoOk: true });
    const result = s.transporteMonitorarEnviosPorEmail_();
    assert.equal(result.enviados, 0);
    assert.equal(agenda.rows[1][2], 'Pendente');
    assert.match(result.diagnostico.recusas[0].motivo, /alterada/);
    assert.notEqual(s.transporteOperacoesRows_()[0].gmailMessageId, 'MENSAGEM-ANTIGA');
  });
}

test('monitor le o log em dois blocos e a linha da Agenda uma vez para tres slots', () => {
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Evento', 'Courier I', 'Status I', 'Courier II', 'Status II', 'Courier III', 'Status III', 'ID'],
    ['Agendado', 'DHL', 'Pendente', 'DHL', 'Pendente', 'DHL', 'Pendente', 'EVT-1']
  ]);
  let agendaReads = 0;
  let logReads = 0;
  const countReads = (sheet, onRead) => {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      const range = getRange(...args);
      const getValues = range.getValues.bind(range);
      range.getValues = () => { onRead(); return getValues(); };
      return range;
    };
  };
  const s = server({
    getCodexSpreadsheet_: () => book, SpreadsheetApp: { flush() {} },
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
    AGENDA_CFG: { col: { status: 1, id: 8 }, idx: { c1: { nome: 1, status: 2 }, c2: { nome: 3, status: 4 }, c3: { nome: 5, status: 6 } } },
    getAgendaSheet_: () => agenda, encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    GmailApp: { search: () => [{ getMessages: () => [{
      getFrom: () => 'operador@example.invalid', getSubject: () => '', getPlainBody: () => 'IPS-TRP-EVT-1-T1 IPS-TRP-EVT-1-T2 IPS-TRP-EVT-1-T3',
      getDate: () => new Date(Date.now() + 1000), getId: () => 'MSG', getAttachments: () => []
    }] }] }
  });
  for (const slot of ['1', '2', '3']) {
    s.transporteRegistrarDocumentacaoGerada_({ agendaId: 'EVT-1', slot, courier: 'DHL', rascunhoOk: true });
  }
  countReads(book.getSheetByName('Transporte_Operacoes'), () => logReads++);
  countReads(agenda, () => agendaReads++);
  const result = s.transporteMonitorarEnviosPorEmail_();
  assert.equal(result.enviados, 3);
  assert.equal(logReads, 2);
  assert.equal(agendaReads, 1, 'IDs e valores dos tres slots vêm do mesmo snapshot sob lock');
  assert.deepEqual(agenda.rows[1], ['Agendado', 'DHL', 'Agendado', 'DHL', 'Agendado', 'DHL', 'Agendado', 'EVT-1']);
});
