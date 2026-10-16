'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const helpersRoot = process.env.IPS_AGENDA_TESTS_DIR || __dirname;
const { runFiles } = require(path.join(helpersRoot, 'helpers', 'load-app-script'));
const { FakeSheet, FakeSpreadsheet } = require(path.join(helpersRoot, 'helpers', 'fake-spreadsheet'));
const { fixture: editFixture } = require(path.join(helpersRoot, 'helpers', 'agenda-merge-fixture'));

function reservation(server, id, agendaId, status, quantity) {
  const row = Array(server.KIT_RESERVA_HEADERS_.length).fill('');
  row[0] = id;
  row[2] = agendaId;
  row[5] = 'KIT-1';
  row[6] = 'LOTE-1';
  row[10] = quantity;
  row[11] = status;
  return row;
}

function cancellationFixture() {
  const f = editFixture();
  const reservations = new FakeSheet('Reservas_Kits', [
    Array(f.c.KIT_RESERVA_HEADERS_.length).fill(''),
    reservation(f.c, 'RES-A', 'A', 'Reservado', 2),
    reservation(f.c, 'RES-B', 'B', 'Reservado', 3),
    reservation(f.c, 'RES-C', 'A', 'Consumida', 1)
  ]);
  const spreadsheet = new FakeSpreadsheet({ Agenda: f.sheet, Reservas_Kits: reservations });
  let kitsInvalidated = 0;
  let windowsInvalidated = 0;
  f.c.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;
  f.c.agendaInvalidateKitsReference_ = () => { kitsInvalidated++; };
  f.c.agendaInvalidateDateIndexCache_ = () => { windowsInvalidated++; };
  return { ...f, reservations, kitsInvalidated: () => kitsInvalidated, windowsInvalidated: () => windowsInvalidated };
}

test('cancelamento pela edição completa libera somente reservas ativas do evento e invalida kits', () => {
  const f = cancellationFixture();
  f.payload.status = 'Cancelado';
  f.payload.cancelamento = { categoria: 'Participante', motivo: 'Desistência' };
  assert.equal(f.c.atualizarAgendaEventoCompleto(f.payload).ok, true);
  assert.equal(f.sheet.rows[1][f.i.status], 'Cancelado');
  assert.equal(f.reservations.rows[1][11], 'Cancelada');
  assert.match(f.reservations.rows[1][14], /Desistência/);
  assert.equal(f.reservations.rows[2][11], 'Reservado', 'reserva de outro evento preservada');
  assert.equal(f.reservations.rows[3][11], 'Consumida', 'histórico consumido preservado');
  assert.ok(f.kitsInvalidated() > 0);
  const note = f.reservations.rows[1][14];
  f.c.cancelarReservasKitsAgenda_('A', 'Nova tentativa');
  assert.equal(f.reservations.rows[1][14], note, 'reexecução não duplica o cancelamento');
});

test('edição completa sem cancelamento preserva reservas ativas', () => {
  const f = cancellationFixture();
  f.payload.obs = 'Observação corrigida';
  assert.equal(f.c.atualizarAgendaEventoCompleto(f.payload).ok, true);
  assert.equal(f.reservations.rows[1][11], 'Reservado');
  assert.equal(f.kitsInvalidated(), 0);
});

function backendFixture() {
  const entries = new Map();
  const events = [];
  let locked = false;
  const cache = {
    get: key => entries.get(key) || null,
    getAll: keys => Object.fromEntries(keys.filter(key => entries.has(key)).map(key => [key, entries.get(key)])),
    put: (key, value) => entries.set(key, value),
    putAll: values => Object.entries(values).forEach(([key, value]) => entries.set(key, value)),
    remove: key => { events.push('invalidate:' + key); entries.delete(key); },
    removeAll: keys => keys.forEach(key => cache.remove(key))
  };
  const server = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs'], {
    Date,
    CacheService: { getScriptCache: () => cache },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}), flush: () => { events.push('flush'); } },
    Utilities: {
      getUuid: randomUUID,
      newBlob: value => ({ getBytes: () => Buffer.from(value, 'utf8') }),
      formatDate: (value, _timezone, format) => {
        const date = value instanceof Date ? value : new Date(value);
        const iso = date.toISOString();
        if (format === 'yyyyMMdd') return iso.slice(0, 10).replaceAll('-', '');
        if (format === 'HH:mm') return iso.slice(11, 16);
        return iso.slice(0, 10);
      }
    },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo', getActiveUser: () => ({ getEmail: () => 'teste@example.invalid' }) }
  });
  const cfg = server.AGENDA_CFG;
  const row = Array(cfg.lastCol).fill('');
  row[cfg.idx.id] = 'A';
  row[cfg.idx.data] = new Date(2026, 8, 15, 8);
  row[cfg.idx.hora] = '08:00';
  row[cfg.idx.tipo] = 'Visita';
  row[cfg.idx.status] = 'Realizado';
  row[cfg.idx.participante] = 'Pessoa de teste';
  row[cfg.idx.projeto] = 'Estudo A';
  row[cfg.idx.visita] = 'V1';
  row[cfg.idx.servTerc] = 'Prestador A';
  row[cfg.idx.c1.nome] = 'MARKEN';
  row[cfg.idx.c1.status] = 'Enviado';
  row[cfg.idx.c1.awb] = '123456789012';
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), row]);
  server.getAgendaSheet_ = server.getAgendaSheetForRead_ = () => sheet;
  server.codexAssertCanWrite_ = server.codexAssertAdmin_ = () => {};
  server.codexWithDocumentLock_ = (_label, callback) => {
    locked = true;
    try { return callback(); } finally { locked = false; }
  };
  server.codexWriteAuditChanges_ = server.verificarNotificacoes_ = () => {};
  server.agendaSetAwbValue_ = (range, value) => range.setValue(value);
  server.agendaAtualizarBackupAwbVinculado_ = () => ({ atualizado: 0 });
  server.agendaHydrateParticipantFields_ = () => {};
  server.cancelarReservasKitsAgenda_ = () => 0;
  const windowKey = server.agendaWindowCacheKey_(2, '2026-09-14', '2026-09-21', 5000);
  const generation = server.agendaWindowCacheGeneration_(false);
  const lastVisitKey = ['AgendaLastVisits', 'v1', generation, 2, '20260915'].join(':');
  assert.equal(server.agendaWindowCachePut_(windowKey, { items: [{ id: 'A', status: 'antigo' }] }), true);
  assert.equal(server.agendaWindowCachePut_(lastVisitKey, { map: { pessoa: { visita: 'antiga' } } }), true);
  events.length = 0;
  return {
    server, cfg, sheet, cache, events, windowKey, lastVisitKey,
    assertInvalidated() {
      assert.equal(server.agendaWindowCacheGet_(windowKey), null, 'janela anterior não deve ser servida');
      assert.equal(server.agendaWindowCacheGet_(lastVisitKey), null, 'últimas visitas da geração anterior não devem ser servidas');
      assert.equal(server.agendaWindowCachePut_(windowKey, { obsolete: true }), false, 'leitor antigo não pode republicar');
      const invalidatedAt = events.findIndex(event => event === 'invalidate:' + server.AGENDA_WINDOW_CACHE_GENERATION_KEY_);
      const flushedAt = events.indexOf('flush');
      assert.ok(flushedAt >= 0 && invalidatedAt > flushedAt, 'invalidação deve ocorrer depois da persistência');
      assert.notEqual(server.agendaWindowCacheKey_(2, '2026-09-14', '2026-09-21', 5000), windowKey);
    },
    underLock(callback) { return server.codexWithDocumentLock_('teste', callback); },
    isLocked: () => locked
  };
}

const mutations = [
  ['cancelamento dedicado', f => f.server.cancelarAgendaEvento('A', { categoria: 'Participante', motivo: 'Desistência' })],
  ['requisição com prestador', f => f.server.atualizarStatusRequisicaoAgenda('A', true)],
  ['requisição sem prestador', f => {
    f.sheet.rows[1][f.cfg.idx.servTerc] = '';
    f.sheet.rows[1][f.cfg.idx.reqStatus] = 'Requisição Enviada';
    return f.server.atualizarStatusRequisicaoAgenda('A', false);
  }],
  ['status do backup', f => f.server.atualizarStatusBackupAgenda('A', 'Adicionado à Agenda')],
  ['entrega nas Pendências', f => f.server.confirmarEntregaTransportePendencia('A', '1', '123456789012')],
  ['conclusão de Polo Trial/eCRF antigas', f => f.server.concluirPendenciasPoloTrialEcrfAntigas('2026-09-30', false)],
  ['vínculo final do backup', f => f.underLock(() => f.server.agendaVincularBackupAoAgendamento_(f.sheet, 'A', 'B', new Date(2026, 8, 16, 9)))],
  ['finalização do lote de monitoria', f => f.underLock(() => f.server.agendaFinalizarLoteMonitoria_(f.sheet, null, 1))],
  ['sincronização do Transporte', f => {
    f.sheet.rows[1][f.cfg.idx.c1.status] = 'Não Agendado';
    f.sheet.rows[1][f.cfg.idx.c1.awb] = '';
    return f.underLock(() => f.server.transporteSincronizarAgenda_({ idAgenda: 'A', agendaSlot: '1', awb: '123456789012', statusCourier: 'Agendado', destino: 'Laboratório A' }));
  }]
];

for (const [label, mutate] of mutations) {
  test(label + ' invalida snapshots mesmo sem mudar getLastRow', () => {
    const f = backendFixture();
    const before = f.sheet.getLastRow();
    mutate(f);
    assert.equal(f.sheet.getLastRow(), before);
    f.assertInvalidated();
  });
}

test('prévia de conclusão de pendências não escreve nem invalida a geração', () => {
  const f = backendFixture();
  const result = f.server.concluirPendenciasPoloTrialEcrfAntigas('2026-09-30', true);
  assert.equal(result.celulasAtualizadas, 2);
  assert.equal(f.sheet.writes, 0);
  assert.equal(f.events.includes('flush'), false);
  assert.notEqual(f.server.agendaWindowCacheGet_(f.windowKey), null);
});

test('transporte sincroniza AWB de backup vinculado e invalida mesmo sem mudanças no slot principal', () => {
  const f = backendFixture();
  let propagated = false;
  f.server.agendaAtualizarBackupAwbVinculado_ = () => {
    propagated = true;
    return { atualizado: 1 };
  };
  const result = f.underLock(() => f.server.transporteSincronizarAgenda_({ idAgenda: 'A', agendaSlot: '1', awb: '123456789012' }));
  assert.equal(result.atualizado, false);
  assert.equal(propagated, true);
  f.assertInvalidated();
});

test('falha da notificação após cancelar pela edição completa não retém reserva ativa', () => {
  const f = cancellationFixture();
  f.payload.status = 'Cancelado';
  f.payload.cancelamento = { categoria: 'Participante', motivo: 'Desistência' };
  f.c.verificarNotificacoes_ = () => { throw new Error('Falha simulada na notificação'); };
  assert.throws(() => f.c.atualizarAgendaEventoCompleto(f.payload), /Falha simulada/);
  assert.equal(f.sheet.rows[1][f.i.status], 'Cancelado');
  assert.equal(f.reservations.rows[1][11], 'Cancelada');
  assert.ok(f.kitsInvalidated() > 0);
  assert.ok(f.windowsInvalidated() > 0);
});

test('falha da notificação no cancelamento dedicado não deixa snapshots antigos disponíveis', () => {
  const f = backendFixture();
  f.server.verificarNotificacoes_ = () => { throw new Error('Falha simulada na notificação'); };
  assert.throws(() => f.server.cancelarAgendaEvento('A', { categoria: 'Participante', motivo: 'Desistência' }), /Falha simulada/);
  assert.equal(f.sheet.rows[1][f.cfg.idx.status], 'Cancelado');
  f.assertInvalidated();
});

test('cancelamento invalida snapshot repovoado durante a notificação antes de gravar Controle', () => {
  const f = backendFixture();
  let duringNotificationKey;
  f.server.verificarNotificacoes_ = () => {
    duringNotificationKey = f.server.agendaWindowCacheKey_(2, '2026-09-14', '2026-09-21', 5000);
    assert.equal(f.server.agendaWindowCachePut_(duringNotificationKey, { items: [{ id: 'A', controle: 'Notificado' }] }), true);
    f.sheet.getRange(2, f.cfg.col.controle).setValue('Cancelado');
  };
  f.server.cancelarAgendaEvento('A', { categoria: 'Participante', motivo: 'Desistência' });
  assert.equal(f.sheet.rows[1][f.cfg.idx.controle], 'Cancelado');
  assert.equal(f.server.agendaWindowCacheGet_(duringNotificationKey), null, 'escrita de Controle também invalida snapshot concorrente');
});
