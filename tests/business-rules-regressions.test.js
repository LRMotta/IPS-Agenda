'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');
const { fixture } = require('./helpers/agenda-merge-fixture');

test('merge conserva identidade hidratada assinada quando somente obs e médico mudam', () => {
  const { c, i, sheet, payload } = fixture();
  c.getInfoParticipante = () => null;
  for (const key of ['participanteCadastroId', 'idParticipante', 'braco']) sheet.rows[1][i[key]] = '';
  const event = c.agendaRowToObject_(sheet.rows[1], 2);
  Object.assign(event, { participanteCadastroId: 'CAD-A', idParticipante: '001', braco: 'Braço A' });
  Object.assign(payload, c.agendaMergePayloadFromEvent_(event), {
    _recordVersion: event.recordVersion, _editRecordVersion: event.editRecordVersion,
    _editMergeToken: c.agendaIssueMergeToken_(sheet.rows[1], event)
  });
  payload.obs = 'Observação local';
  sheet.rows[1][i.medico] = 'Médico remoto';
  assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true);
  assert.equal(sheet.rows[1][i.participanteCadastroId], 'CAD-A');
  assert.equal(sheet.rows[1][i.idParticipante], '001');
  assert.equal(sheet.rows[1][i.braco], 'Braço A');
});

test('merge usa a mesma requisição legada exibida no formulário e conserva envio ao editar obs', () => {
  const { c, i, sheet, payload } = fixture();
  sheet.rows[1][i.obs] = 'Requisição enviada';
  const event = c.agendaRowToObject_(sheet.rows[1], 2);
  assert.equal(event.statusRequisicao, 'Requisição Enviada');
  Object.assign(payload, c.agendaMergePayloadFromEvent_(event), {
    _recordVersion: event.recordVersion, _editRecordVersion: event.editRecordVersion,
    _editMergeToken: c.agendaIssueMergeToken_(sheet.rows[1], event)
  });
  assert.equal(c.agendaMergePayloadFromRow_(sheet.rows[1]).statusRequisicao, event.statusRequisicao);
  payload.obs = 'Nova observação';
  sheet.rows[1][i.servTerc] = 'Prestador remoto';
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(sheet.rows[1][i.reqStatus], 'Requisição Enviada');
  assert.equal(sheet.rows[1][i.servTerc], 'Prestador remoto');
});

test('AWB sem URL mantém zeros iniciais como texto', () => {
  const c = runFiles(['WebApp.gs']);
  c.agendaAwbReservarCelula_ = () => {}; // Este caso isola o formato da celula; unicidade possui regressao propria.
  for (const awb of ['012345', '000000']) {
    let format = '', value = '';
    const range = {
      setNumberFormat: next => { format = next; },
      setValue: next => { value = format === '@' ? next : String(Number(next)); },
      getDisplayValue: () => value
    };
    c.agendaSetAwbValue_(range, awb, 'PINEX (Agendamento)');
    assert.equal(value, awb);
    assert.equal(format, '@');
  }
});

test('Lab Central inativo limpa também destino e material estruturado do Backup', () => {
  const c = runFiles(['AgendaServerRules.gs', 'WebApp.gs']);
  const i = c.AGENDA_CFG.idx;
  c.agendaSetCourierLinha_ = () => {};
  c.agendaSetBackupLinha_ = () => {};
  const dados = { tipo: 'Visita', backup: { destino: 'Lab antigo', matBioJson: '{"items":[1]}' }, courier2: { destino: 'Destino II', matBioJson: 'Material II' } };
  for (const lab of ['Não', '', 'Sim']) {
    const sheet = new FakeSheet('Agenda', [[], Array(c.AGENDA_CFG.lastCol).fill('')]);
    c.agendaGravarTransportesDoEvento_(sheet, 2, dados, lab);
    assert.equal(sheet.rows[1][i.cb.destino], lab === 'Sim' ? dados.backup.destino : '');
    assert.equal(sheet.rows[1][i.cb.matBio], lab === 'Sim' ? dados.backup.matBioJson : '');
    assert.equal(sheet.rows[1][i.c2.destino], 'Destino II');
    assert.equal(dados.backup.destino, 'Lab antigo');
  }
});

test('Jornada envia a base de cada marco exibido inclusive datas inicialmente vazias', () => {
  const source = readProjectFile('IndexCoreScripts.html');
  const start = source.indexOf('function salvarConfiguracaoCtmsJornada()');
  const end = source.indexOf('\nfunction ', start + 1);
  let submitted;
  const c = vm.createContext({
    window: { _jornadaParticipanteConsulta: {} },
    _jornadaParticipanteAtual: { id: 'CAD-A', projeto: 'Estudo' },
    _jornadaParticipanteDados: { previaCtms: { configuracao: { marcos: { RANDOMIZACAO: '2026-09-01' } } } },
    document: {
      getElementById: () => null,
      querySelectorAll: selector => selector === '[data-ctms-marco]' ? [
        { getAttribute: () => 'RANDOMIZACAO', value: '2026-09-02' },
        { getAttribute: () => 'ULTIMA_DOSE', value: '2026-10-01' }
      ] : []
    },
    appSetButtonBusy() {}, appServerRun: request => { submitted = request.args[0]; }
  });
  vm.runInContext(source.slice(start, end), c);
  c.salvarConfiguracaoCtmsJornada();
  assert.deepEqual({ ...submitted.marcosParticipacaoBase }, { RANDOMIZACAO: '2026-09-01', ULTIMA_DOSE: '' });
  assert.equal(submitted.marcos.RANDOMIZACAO, '2026-09-02');
});
