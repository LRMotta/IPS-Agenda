'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fixture: mergeFixture } = require('./helpers/agenda-merge-fixture');

function fixture() {
  const agenda = new FakeSheet('Agenda', [Array(60).fill('')]);
  const folha = new FakeSheet('Folha de Agendamento', Array.from({ length: 15 }, () => ['', '', '']));
  let note = '';
  const range = folha.getRange.bind(folha);
  folha.getRange = (address, ...args) => {
    if (typeof address === 'number') return range(address, ...args);
    const r = address === 'C3:C15' ? range(3, 3, 13, 1) : range(15, 3);
    r.getNote = () => note;
    r.setNote = value => { note = value; return r; };
    r.clearNote = () => { note = ''; return r; };
    return r;
  };
  const ss = new FakeSpreadsheet({ Agenda: agenda, 'Folha de Agendamento': folha });
  let locked = false, releases = 0, seq = 0;
  const c = runFiles(['AgendaServerRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    LockService: { getDocumentLock: () => ({ tryLock: () => { assert.equal(locked, false); locked = true; return true; }, releaseLock: () => { locked = false; releases++; } }) },
    Utilities: { getUuid: () => (++seq).toString(16).padStart(32, '0'), formatDate: () => '21/10/2026' }
  });
  c.getAgendaSheetForRead_ = () => agenda;
  c.getTransporteSpreadsheetCodex_ = () => ss;
  const i = c.AGENDA_CFG.idx;
  function row(id, awb = '', slot = 1, status = 'Agendado') {
    const r = Array(60).fill('');
    Object.assign(r, { [i.id]: id, [i.participante]: 'Pessoa ' + id, [i.projeto]: 'Estudo', [i.data]: '21/10/2026', [i.status]: status });
    const s = [i.c1, i.c2, i.c3][slot - 1];
    r[s.awb] = awb; r[s.nome] = 'MARKEN'; r[s.temp] = slot === 1 ? 'AMBIENTE' : 'CONGELADO';
    agenda.rows.push(r);
    return r;
  }
  const lockedCall = fn => c.codexWithDocumentLock_('teste-awb', fn);
  return { c, agenda, folha, ss, i, row, lockedCall, releases: () => releases };
}

test('mesma AWB em temperaturas/slots distintos e bloqueada antes de qualquer escrita', () => {
  const f = fixture();
  f.row('A');
  const before = JSON.stringify(f.agenda.rows);
  assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, {
    courier1: { awb: '620X41337652', temperatura: 'AMBIENTE' },
    courier2: { awb: '620x41337652', temperatura: 'CONGELADO' }
  }, 'A')), /AWB.*outro envio/);
  assert.equal(JSON.stringify(f.agenda.rows), before);
  assert.equal(f.ss.getSheetByName('AWB_Utilizadas'), null);
  assert.equal(f.releases(), 1);
});

test('unicidade global inclui outro courier, registros antigos e cancelados', () => {
  const f = fixture();
  f.row('A', '620X41337652', 2, 'Cancelado');
  assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, {
    courier3: { awb: ' 620x-41337652 ', nome: 'OUTRA COURIER' }
  }, 'B')), /Transporte II.*CONGELADO.*Pessoa A.*Cancelado.*Agendamento A/);
});

test('editar e reagendar o mesmo envio conserva a AWB, limpeza nao libera o historico', () => {
  const f = fixture();
  const r = f.row('A', '0012345678');
  f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { data: '30/10/2026', courier1: { awb: '0012345678' } }, 'A', r));
  const ledger = f.ss.getSheetByName('AWB_Utilizadas');
  assert.equal(ledger.rows.length, 2);
  f.lockedCall(() => f.c.agendaSetAwbValue_(f.agenda.getRange(2, f.i.c1.awb + 1), '', 'MARKEN'));
  assert.equal(r[f.i.c1.awb], '');
  assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: '0012345678' } }, 'B')), /já foi utilizada/);
  assert.equal(ledger.rows.length, 2, 'nao duplica reserva e conserva zeros iniciais');
});

test('substituir uma AWB preserva a anterior como utilizada', () => {
  const f = fixture();
  const r = f.row('A', 'ANTIGA');
  f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: 'NOVA', awbTouched: true } }, 'A', r));
  r[f.i.c1.awb] = 'NOVA';
  assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: 'ANTIGA' } }, 'B')), /já foi utilizada/);
  assert.equal(f.ss.getSheetByName('AWB_Utilizadas').rows.length, 3);
});

test('intencao de AWB omitida ou nao tocada preserva o valor atual', () => {
  const f = fixture();
  const r = f.row('A', 'PROPRIA');
  f.row('B', 'OCUPADA');
  assert.doesNotThrow(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: 'OCUPADA', awbTouched: false } }, 'A', r)));
  assert.equal(f.ss.getSheetByName('AWB_Utilizadas').rows.filter(row => row[0] === 'OCUPADA').length, 1);
});

test('duplicidade legada permite corrigir outros dados, avisa e bloqueia novos documentos', () => {
  const f = fixture();
  const r = f.row('A', '620X41337652');
  f.row('B', '620X41337652', 2);
  const warnings = f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: '620X41337652' } }, 'A', r));
  assert.equal(warnings.length, 1);
  const registro = { idAgenda: 'A', agendaSlot: '1', awb: '620X41337652' };
  const writes = f.ss.getSheetByName('AWB_Utilizadas').writes;
  assert.match(f.c.transporteAwbAviso_(registro).text, /Transporte II.*Pessoa B/);
  assert.equal(f.ss.getSheetByName('AWB_Utilizadas').writes, writes, 'aviso e somente leitura');
  assert.throws(() => f.lockedCall(() => f.c.transporteAwbReservar_(registro, true)), /já foi utilizada/);
});

test('reservas sob lock impedem duas gravacoes concorrentes de ocuparem a mesma AWB', () => {
  const f = fixture();
  f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: '1234567890' } }, 'A'));
  assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: '1234567890' } }, 'B')), /já foi utilizada/);
  assert.equal(f.releases(), 2);
});

test('envio manual conserva identidade ao editar e bloqueia reuso apos limpar o formulario', () => {
  const f = fixture();
  const payload = { awb: '0012345678', paciente: 'Manual', courier: 'DHL' };
  f.lockedCall(() => f.c.transporteAwbReservar_(payload, true));
  assert.match(payload.envioId, /^[a-f0-9]{32}$/);
  f.lockedCall(() => f.c.transporteAwbReservar_(payload, true));
  assert.throws(() => f.lockedCall(() => f.c.transporteAwbReservar_({ awb: '0012345678', paciente: 'Outro envio' }, true)), /já foi utilizada/);
  assert.equal(f.ss.getSheetByName('AWB_Utilizadas').rows.length, 2);
});

test('atribuicao automatica pelo setter tambem rejeita AWB ocupada sem alterar a celula', () => {
  const f = fixture();
  f.row('A', '620X41337652');
  f.row('B');
  const cell = f.agenda.getRange(3, f.i.c2.awb + 1);
  assert.throws(() => f.lockedCall(() => f.c.agendaSetAwbValue_(cell, '620X41337652', 'MARKEN')), /já foi utilizada/);
  assert.equal(cell.getValue(), '');
});

test('historico com schema invalido impede gravacao e nao sofre reparo automatico', () => {
  const f = fixture();
  f.ss.sheets.AWB_Utilizadas = new FakeSheet('AWB_Utilizadas', [['Cabecalho desconhecido']]);
  assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: 'NOVA' } }, 'A')), /histórico de AWBs/);
  assert.equal(f.ss.sheets.AWB_Utilizadas.writes, 0);
});

test('Transporte III ocupado bloqueia I, II e Backup de qualquer outro envio', () => {
  const f = fixture();
  f.row('A', '620X41337652', 3);
  for (const slot of ['1', '2', 'backup']) {
    assert.throws(() => f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'B', agendaSlot: slot, awb: '620X41337652' }, true)), /Transporte III/);
  }
});

test('AWB atribuida ao Backup tambem fica indisponivel nos Transportes I, II e III', () => {
  const f = fixture();
  f.row('A');
  f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'A', agendaSlot: 'backup', awb: '620X41337652' }, true));
  for (const slot of [1, 2, 3]) {
    assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { ['courier' + slot]: { awb: '620X41337652' } }, 'B')), /Backup/);
  }
});

test('Backup vinculado a I, II ou III espelha a mesma remessa sem permitir um terceiro uso', () => {
  for (const [slot, roman] of [[1, 'I'], [2, 'II'], [3, 'III']]) {
    const f = fixture();
    const origin = f.row('ORIGEM');
    f.row('DESTINO', '620X41337652', slot);
    origin[f.i.backupAgendaRef] = JSON.stringify({ id: 'DESTINO', slot: roman, awb: '620X41337652' });
    assert.doesNotThrow(() => f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'ORIGEM', agendaSlot: 'backup', awb: '620X41337652' }, true)));
    assert.doesNotThrow(() => f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'DESTINO', agendaSlot: String(slot), awb: '620X41337652' }, true)));
    assert.throws(() => f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'TERCEIRO', agendaSlot: 'backup', awb: '620X41337652' }, true)), /já foi utilizada/);
    origin[f.i.backupAgendaRef] = '';
    assert.doesNotThrow(() => f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'DESTINO', agendaSlot: String(slot), awb: '620X41337652' }, true)), 'retirar o espelho nao cria uma segunda remessa no historico');
  }
});

test('referencia legada do Backup sem slot continua sendo o mesmo Transporte I', () => {
  const f = fixture();
  f.row('A')[f.i.backupAgendaRef] = JSON.stringify({ id: 'B', awb: 'AWB-LEGADA' });
  f.row('B', 'AWB-LEGADA');
  assert.doesNotThrow(() => f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'A', agendaSlot: 'backup', awb: 'AWB-LEGADA' }, true)));
});

test('AWB lembrada apenas pelo vinculo historico de Backup tambem bloqueia reutilizacao', () => {
  const f = fixture();
  f.row('A')[f.i.backupAgendaRef] = JSON.stringify({ id: 'ENVIO-ANTIGO', slot: 'III', awb: 'AWB-ANTIGA' });
  assert.throws(() => f.lockedCall(() => f.c.transporteAwbReservar_({ idAgenda: 'B', agendaSlot: '1', awb: 'AWB-ANTIGA' }, true)), /Transporte III.*ENVIO-ANTIGO/);
});

test('RPC de geracao rejeita duplicidade legada antes de gravar formulario, PDF ou Gmail', () => {
  const f = fixture();
  f.row('A', '620X41337652');
  f.row('B', '620X41337652', 3);
  const declaracao = new FakeSheet('Declaracao', []);
  declaracao.getRange = () => ({ getNote: () => '' });
  const getSheet = f.c.transporteGetSheet_;
  f.c.transporteGetSheet_ = (ss, key, required) => key === 'declaracaoTransp' ? declaracao : key === 'folhaAgendamento' ? getSheet(ss, key, required) : null;
  f.c.codexAssertCanWrite_ = () => ({ userEmail: 'teste@example.invalid' });
  for (const name of ['transporteAtualizarRegistroPorAgenda_', 'transporteDerivarDadosParticipante_', 'transporteProjetoDisplay_']) f.c[name] = value => value;
  f.c.transporteReadParticipantesDireto_ = () => [];
  f.c.transporteMateriaisNote_ = () => '';
  f.c.transporteValidarObrigatoriosWebApp_ = f.c.codexMatBioValidateTransportPayload_ = () => {};
  f.c.transporteCaixaResolver_ = () => ({});
  f.c.transporteCaixaBioSystem_ = () => false;
  let exports = 0;
  f.c.imprimirTodasAbas_ = () => { exports++; };
  assert.throws(() => f.c.gerarPdfTransporte({ payload: { idAgenda: 'B', agendaSlot: '3', awb: '620X41337652' } }), /já foi utilizada/);
  assert.equal(exports, 0);
  assert.equal(f.folha.writes + declaracao.writes + f.agenda.writes, 0);
  assert.equal(f.ss.getSheetByName('AWB_Utilizadas'), null);
});

test('Limpar preserva AWB de formulario manual legado antes de esvazia-lo', () => {
  const f = fixture();
  f.folha.rows[11][2] = 'AWB-MANUAL';
  f.c.codexAssertCanWrite_ = () => {};
  f.c.performContentDeletion_ = () => { f.folha.rows[11][2] = ''; return 'OK'; };
  f.c.transporteSincronizarDependencias_ = () => {};
  f.c.getTransporteBootstrap = () => ({});
  f.c.limparTransporte();
  assert.equal(f.folha.rows[11][2], '');
  assert.throws(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier3: { awb: 'AWB-MANUAL' } }, 'B')), /já foi utilizada/);
});

test('prevalidacao de criacao nao reserva ID de evento que ainda nao foi gravado', () => {
  const f = fixture();
  f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: 'NOVA' } }, 'ID-NAO-GRAVADO', null, true));
  assert.equal(f.ss.getSheetByName('AWB_Utilizadas'), null);
  assert.doesNotThrow(() => f.lockedCall(() => f.c.agendaAwbValidarPayload_(f.agenda, { courier1: { awb: 'NOVA' } }, 'ID-REAL')));
});

test('RPC de edicao rejeita AWB de outro envio antes de salvar observacoes ou campos do evento', () => {
  const { c, i, sheet, payload } = mergeFixture();
  const other = sheet.rows[1].slice();
  other[i.id] = 'B'; other[i.c1.awb] = 'OCUPADA';
  sheet.rows.push(other);
  const before = JSON.stringify(sheet.rows);
  payload.obs = 'Esta alteracao deve continuar no formulario';
  payload.courier2.awb = 'OCUPADA'; payload.courier2.awbTouched = true;
  assert.throws(() => c.atualizarAgendaEventoCompleto(payload), /já foi utilizada/);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('RPC de edicao devolve aviso de duplicidade legada junto da correcao de outros dados', () => {
  const { c, i, sheet, payload } = mergeFixture();
  const other = sheet.rows[1].slice();
  other[i.id] = 'B';
  sheet.rows.push(other);
  payload.obs = 'Outra correcao permitida';
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.ok, true);
  assert.match(result.awbWarnings[0], /Agendamento B/);
  assert.equal(sheet.rows[1][i.obs], payload.obs);
});
