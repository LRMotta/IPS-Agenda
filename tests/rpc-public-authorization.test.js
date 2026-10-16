'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runFile } = require('./helpers/load-app-script');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

const queries = [
  { name: 'getTransporteParticipantesOptions', helper: 'transporteReadParticipantesOptions_', args: [], result: [{ id: 'P-1' }] },
  { name: 'getTransporteBootstrap', helper: 'transporteBuildBootstrap_', args: [], result: { registro: { materiais: [] } }, locked: true },
  { name: 'getTransporteCeStatus', helper: 'transporteCeStatus_', args: ['Estudo'], result: { checked: true, found: true } }
];
const accessCases = [
  { label: 'ausente em Users', ok: false, role: '', message: 'Acesso negado.' },
  { label: 'inativo', ok: false, role: 'user', message: 'Usuario inativo.' },
  { label: 'readonly', ok: true, role: 'readonly' },
  { label: 'user', ok: true, role: 'user' },
  { label: 'admin', ok: true, role: 'admin' }
];

function fixture(access) {
  const lock = fakeDocumentLock();
  const s = runFiles(['WebApp.gs', 'TransporteCodexConfig.gs'], {
    LockService: lock.LockService,
    Logger: { log() {} }
  });
  const state = { access: { ...access }, calls: [], authorizations: 0 };
  s.codexAuthorizeWebAppRequest_ = () => { state.authorizations++; return state.access; };
  s.codexWriteAuditLog_ = () => {};
  queries.forEach(query => {
    s[query.helper] = (...args) => {
      assert.equal(lock.state.held, !!query.locked);
      assert.deepEqual(args, query.args);
      state.calls.push(query.name);
      return query.result;
    };
  });
  s.imprimirTodasAbas_ = options => {
    assert.equal(lock.state.held, true);
    state.calls.push('imprimirTodasAbas');
    return { ok: true, marker: options.marker };
  };
  // Qualquer entrada no exportador antigo antes da autorizacao fica observavel.
  s.transporteDerivarDadosParticipante_ = () => { state.calls.push('participante'); return {}; };
  return { s, state, lock };
}

for (const access of accessCases) {
  test('consultas de Transporte autorizam antes dos dados: ' + access.label, () => {
    for (const query of queries) {
      const { s, state, lock } = fixture(access);
      if (access.ok) {
        assert.equal(s[query.name](...query.args), query.result);
        assert.deepEqual(state.calls, [query.name]);
        assert.equal(state.authorizations, query.locked ? 2 : 1);
        assert.equal(lock.state.acquired, query.locked ? 1 : 0);
      } else {
        assert.throws(() => s[query.name](...query.args), /Acesso negado|inativo/);
        assert.deepEqual(state.calls, []);
        assert.equal(lock.state.acquired, 0);
      }
      assert.equal(lock.state.held, false);
    }
  });

  test('impressao direta exige escrita antes dos efeitos: ' + access.label, () => {
    const { s, state, lock } = fixture(access);
    if (access.ok && ['admin', 'user'].includes(access.role)) {
      assert.deepEqual(s.imprimirTodasAbas({ marker: 'TESTE' }), { ok: true, marker: 'TESTE' });
      assert.deepEqual(state.calls, ['imprimirTodasAbas']);
      assert.equal(state.authorizations, 2);
      assert.equal(lock.state.acquired, 1);
      assert.equal(lock.state.released, 1);
    } else {
      assert.throws(() => s.imprimirTodasAbas({ payload: {} }), /Acesso negado|inativo|somente leitura/);
      assert.deepEqual(state.calls, []);
      assert.equal(lock.state.acquired, 0);
    }
  });
}

test('bootstrap e impressao revalidam acesso revogado durante a espera pelo lock', () => {
  for (const name of ['getTransporteBootstrap', 'imprimirTodasAbas']) {
    const { s, state, lock } = fixture({ ok: true, role: 'user' });
    lock.state.onAcquire = () => { state.access = { ok: false, message: 'Acesso revogado.' }; };
    assert.throws(() => s[name]({ payload: {} }), /Acesso revogado/);
    assert.deepEqual(state.calls, []);
    assert.equal(state.authorizations, 2);
    assert.equal(lock.state.released, 1);
  }
});

test('impressao bloqueia perfil rebaixado para readonly enquanto aguardava o lock', () => {
  const { s, state, lock } = fixture({ ok: true, role: 'user' });
  lock.state.onAcquire = () => { state.access = { ok: true, role: 'readonly' }; };
  assert.throws(() => s.imprimirTodasAbas({ payload: {} }), /somente leitura/);
  assert.deepEqual(state.calls, []);
  assert.equal(lock.state.released, 1);
});

test('helpers de notificacao, foco e calculo nao sao RPCs publicas', () => {
  const s = runFiles(['WebApp.gs', 'TransporteCodexConfig.gs']);
  for (const name of ['verificarNotificacoes', 'rastrearEMoverFoco', 'calcularTotalTubos', 'calcularExpressaoLinha']) {
    assert.equal(typeof s[name], 'undefined', name);
    assert.equal(typeof s[name + '_'], 'function', name + '_');
  }
  assert.equal(typeof s.transporteBuildBootstrap_, 'function');
});

test('consultas e impressao falham fechadas se o guard nao estiver disponivel', () => {
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  for (const { name, helper, args } of queries) {
    s[helper] = () => assert.fail('Consulta sem autorizacao: ' + name);
    assert.throws(() => s[name](...args), /codexAssertCanRead_ is not defined/);
  }
  s.imprimirTodasAbas_ = () => assert.fail('Impressao sem autorizacao');
  assert.throws(() => s.imprimirTodasAbas({ payload: {} }), /codexAssertCanWrite_ is not defined/);
});
