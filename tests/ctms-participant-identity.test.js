'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function participantRows() {
  return [
    ['ID', 'Nome', 'Nascimento', 'Idade', 'ID Participante', 'Projeto', 'Braço'],
    ['CAD-1', 'Homônimo', '', '', '', 'Estudo', 'Braço A'],
    ['CAD-2', 'Homônimo', '', '', '', 'Estudo', 'Braço B']
  ];
}

test('CTMS usa exclusivamente o ID informado, mesmo após outro homônimo ou identificação coincidente', () => {
  const server = runFile('WebApp.gs');
  const rows = participantRows();
  for (const idParticipante of ['', 'P-1']) {
    rows[1][4] = rows[2][4] = idParticipante;
    const payload = { idCadastro: ' CAD-2 ', nome: 'Homônimo', projeto: 'Estudo', idParticipante };
    assert.equal(server.jornadaCtmsLocalizarParticipante_(rows, payload), 2);
    assert.equal(server.jornadaCtmsLocalizarParticipante_(rows, { ...payload, idCadastro: 'INEXISTENTE' }), -1);
  }
});

test('consultas CTMS legadas aceitam somente correspondência única e rejeitam IDs duplicados', () => {
  const server = runFile('WebApp.gs');
  const rows = participantRows();
  assert.throws(() => server.jornadaCtmsLocalizarParticipante_(rows, { nome: 'Homônimo', projeto: 'Estudo' }), /ambígua/);
  rows[1][4] = rows[2][4] = 'P-1';
  assert.throws(() => server.jornadaCtmsLocalizarParticipante_(rows, { idParticipante: 'P-1', projeto: 'Estudo' }), /ambígua/);
  rows[1][5] = 'Outro estudo';
  assert.equal(server.jornadaCtmsLocalizarParticipante_(rows, { nome: 'Homônimo', projeto: 'Estudo' }), 2);
  assert.equal(server.jornadaCtmsLocalizarParticipante_(rows, { idParticipante: 'P-1', projeto: 'Estudo' }), 2);
  rows[1][0] = 'CAD-2';
  assert.throws(() => server.jornadaCtmsLocalizarParticipante_(rows, { idCadastro: 'CAD-2' }), /ambígua/);
  server.getCodexSheetDataByName_ = () => rows;
  assert.throws(() => server.jornadaCtmsLerConfigParticipante_({ idCadastro: 'CAD-2' }), /ambígua/);
});

test('CTMS preserva o ID cadastral numérico zero de registros legados', () => {
  const server = runFile('WebApp.gs');
  const rows = participantRows();
  rows[2][0] = 0;
  const payload = { idCadastro: 0, nome: 'Homônimo', projeto: 'Estudo' };
  assert.equal(server.jornadaCtmsLocalizarParticipante_(rows, payload), 2);
  assert.equal(server.jornadaCtmsResolverEscritaParticipante_(rows, payload).payload.idCadastro, '0');
});

function writerFixture(rows = participantRows()) {
  const server = runFile('WebApp.gs');
  const writes = [];
  const previews = [];
  let locked = false;
  let ensured = 0;
  let audits = 0;
  const sheet = {
    getDataRange: () => ({ getValues: () => {
      assert.equal(locked, true);
      return rows.map(row => row.slice());
    } }),
    getRange: (row, column) => ({ setValue: value => {
      assert.equal(locked, true);
      writes.push({ row, column, value });
    } })
  };
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: name => {
    assert.equal(name, 'Participantes');
    return sheet;
  } });
  server.codexWithDocumentLock_ = (_, action) => {
    locked = true;
    try { return action(); } finally { locked = false; }
  };
  server.getSoAVisitasProjeto = () => [];
  server.getBracosProjeto = () => [];
  server.participanteCtmsGarantirColumns_ = () => {
    assert.equal(locked, true);
    ensured++;
    return { bracoId: 7, marcosJson: 8, escolhasJson: 9, aprovacoesJson: 10 };
  };
  server.clearCodexRuntimeCaches_ = () => {};
  server.codexWriteAuditLog_ = () => { audits++; };
  server.codexGetActiveUserEmail_ = () => 'tester@example.invalid';
  server.Utilities = { formatDate: () => '2026-10-07T10:00:00-03:00' };
  server.Session = { getScriptTimeZone: () => 'America/Sao_Paulo' };
  server.getJornadaParticipante = payload => {
    previews.push({ ...payload, locked });
    return { previaCtms: { linhas: [{ idSoA: 'V-1', aprovavel: true, fingerprint: 'atual' }] } };
  };
  return { server, writes, previews, get ensured() { return ensured; }, get audits() { return audits; } };
}

test('aprovação CTMS formata timestamp no fuso configurado do script', () => {
  const fixture = writerFixture();
  fixture.server.Session.getScriptTimeZone = () => 'Etc/UTC';
  fixture.server.Utilities.formatDate = (_date, timezone, format) => {
    assert.equal(timezone, 'Etc/UTC');
    assert.equal(format, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return '2026-10-07T13:00:00Z';
  };
  fixture.server.definirAprovacaoCtmsParticipante_({
    idCadastro: 'CAD-2', projeto: 'Estudo', idSoA: 'V-1', fingerprint: 'atual', aprovar: true
  });
  assert.equal(JSON.parse(fixture.writes[0].value)['V-1'].aprovadoEm, '2026-10-07T13:00:00Z');
});

const actions = [
  { method: 'salvarConfiguracaoCtmsParticipante_', extra: { marcos: { RANDOMIZACAO: '2026-10-01' } } },
  { method: 'definirAprovacaoCtmsParticipante_', extra: { idSoA: 'V-1', fingerprint: 'atual', aprovar: true } },
  { method: 'definirAprovacaoCtmsParticipante_', extra: { idSoA: 'V-1', aprovar: false } }
];

for (const action of actions) {
  const label = action.method + (action.extra.idSoA ? (action.extra.aprovar ? ' aprovar' : ' revogar') : '');
  test(label + ' exige ID único e projeto correspondente antes de qualquer escrita ou prévia', () => {
    for (const invalid of [
      { idCadastro: '', error: /ID do cadastro/ },
      { idCadastro: 'INEXISTENTE', error: /não encontrado/ },
      { idCadastro: 'CAD-2', projeto: 'Outro estudo', error: /não pertence/ },
      { idCadastro: 'CAD-2', duplicate: true, error: /ambígua/ }
    ]) {
      const rows = participantRows();
      if (invalid.duplicate) rows[1][0] = 'CAD-2';
      const fixture = writerFixture(rows);
      const payload = { nome: 'Homônimo', projeto: 'Estudo', ...action.extra, idCadastro: invalid.idCadastro };
      if (invalid.projeto) payload.projeto = invalid.projeto;
      assert.throws(() => fixture.server[action.method](payload), invalid.error);
      assert.equal(fixture.ensured, 0);
      assert.equal(fixture.audits, 0);
      assert.deepEqual(fixture.writes, []);
      assert.deepEqual(fixture.previews, []);
    }
  });

  test(label + ' grava somente na participação correta e usa seus dados na jornada', () => {
    const rows = participantRows();
    rows[2][10] = JSON.stringify({ 'V-1': { fingerprint: 'atual' }, 'V-2': { fingerprint: 'preservado' } });
    const fixture = writerFixture(rows);
    fixture.server[action.method]({
      idCadastro: 'CAD-2', nome: 'Nome obsoleto', idParticipante: 'Identificação obsoleta',
      projeto: 'Estudo', braco: 'Braço obsoleto', ...action.extra
    });
    assert.equal(fixture.writes.length, action.extra.idSoA ? 1 : 3);
    assert.ok(fixture.writes.every(write => write.row === 3));
    for (const preview of fixture.previews) {
      assert.equal(preview.idCadastro, 'CAD-2');
      assert.equal(preview.nome, 'Homônimo');
      assert.equal(preview.idParticipante, '');
      assert.equal(preview.braco, 'Braço B');
      assert.equal(preview.projeto, 'Estudo');
    }
    if (action.extra.idSoA) {
      assert.equal(fixture.previews[0].locked, true);
      const approvals = JSON.parse(fixture.writes[0].value);
      assert.equal(approvals['V-2'].fingerprint, 'preservado');
      assert.equal(!!approvals['V-1'], action.extra.aprovar);
    } else {
      assert.deepEqual(JSON.parse(fixture.writes[1].value), action.extra.marcos);
    }
  });
}

test('aprovação com identidade válida continua rejeitando comparação CTMS obsoleta', () => {
  const fixture = writerFixture();
  assert.throws(() => fixture.server.definirAprovacaoCtmsParticipante_({
    idCadastro: 'CAD-2', projeto: 'Estudo', idSoA: 'V-1', aprovar: true, fingerprint: 'obsoleto'
  }), /mudou/);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.ensured, 0);
});
