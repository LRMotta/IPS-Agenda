'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, readProjectFile } = require('./helpers/load-app-script');

const d = (s) => new Date(s + 'Z');
function base() { return runFile('CourierLembretes.gs', { Date }); }

test('prazo soma somente 08h a 18h e exclui fins de semana e feriados', () => {
  const s = base();
  assert.equal(s.courierLembreteHoras_(d('2026-09-04T17:00:00'), d('2026-09-08T09:00:00'), { '2026-09-07': true }), 2);
  assert.equal(s.courierLembreteHoras_(d('2026-09-04T18:00:00'), d('2026-09-05T09:00:00'), {}), 0);
});

test('limite D-1 respeita uma hora util minima e antecipa fim de semana/feriado', () => {
  const s = base();
  const c = { lembreteHoras: '4', lembreteLimite: '15:00' };
  const feriados = { '2026-09-07': true };
  assert.equal(s.courierLembreteVencido_(d('2026-09-04T14:30:00'), d('2026-09-04T15:00:00'), '2026-09-08', c, feriados), false);
  assert.equal(s.courierLembreteVencido_(d('2026-09-04T14:00:00'), d('2026-09-04T15:00:00'), '2026-09-08', c, feriados), true);
  assert.equal(s.courierLembreteVencido_(d('2026-09-04T10:00:00'), d('2026-09-04T18:00:00'), '2026-09-08', c, feriados), false);
  assert.equal(s.courierLembreteVencido_(d('2026-09-04T10:00:00'), d('2026-09-04T15:00:00'), '2026-09-04', c, feriados), false);
  assert.equal(s.courierLembreteVencido_(d('2026-09-04T10:00:00'), d('2026-09-04T15:00:00'), '2026-09-08', { lembreteHoras: '' }, feriados), false);
});

function fixture() {
  const rows = [{ key: 'evt:1', agendaId: 'evt', slot: '1', gerado: d('2026-09-04T11:00:00'), base: 'base', estado: 'BASE' }];
  const op = { agendaId: 'evt', slot: '1', geradoEm: rows[0].gerado, geradoPor: 'staff@example.invalid', emailEnviadoEm: d('2026-09-04T12:00:00'), gmailMessageId: 'orig', referencia: 'IPS-TRP-EVT-T1' };
  const config = { nome: 'Marken', email: 'courier@example.invalid', lembreteModo: 'Automático', lembreteHoras: '2' };
  const current = { base: 'base', status: 'Agendado', courierStatus: 'Agendado', courier: 'Marken', data: '05/09/2026', feriados: {}, awb: '123' };
  let sent = 0;
  let throwSend = false;
  const props = { COURIER_LEMBRETES_ATIVO: 'true', COURIER_LEMBRETES_CONTA: 'monitor@example.invalid' };
  const thread = { getId: () => 'thread', refresh() {}, getMessages: () => messages };
  const original = {
    getFrom: () => op.geradoPor, getTo: () => 'courier@example.invalid', getCc: () => 'monitor@example.invalid',
    getBcc: () => '', getReplyTo: () => '', getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-T1',
    isDraft: () => false, isInTrash: () => false, getDate: () => op.emailEnviadoEm, getId: () => 'orig', getThread: () => thread
  };
  const messages = [original];
  const s = runFile('CourierLembretes.gs', {
    Date, Session: { getEffectiveUser: () => ({ getEmail: () => 'monitor@example.invalid' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    GmailApp: { getAliases: () => [], getMessageById: () => original, getThreadById: () => thread },
    getAgendaCourierRows_: () => [config], transporteOperacoesRows_: () => [op],
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
    normText_: (v) => String(v).toLowerCase(), parseAgendaDateAny_: () => new Date(),
    Utilities: { formatDate: () => '2026-09-05' },
    transporteMonitorReferencia_: () => 'IPS-TRP-EVT-T1',
    codexWithDocumentLock_: (_name, fn) => fn(), Logger: { log() {} },
    CodexExternalEffects_: { replyCourierReminder(_orig, body) {
      sent++;
      messages.push({ getId: () => 'sent', isDraft: () => false, getDate: () => d('2026-09-04T15:00:00'), getFrom: () => 'monitor@example.invalid', getPlainBody: () => body });
      if (throwSend) throw new Error('timeout after acceptance');
    } }
  });
  s.courierLembreteRows_ = () => rows;
  s.courierLembreteAgenda_ = () => current;
  s.courierLembreteHoraLocal_ = (date) => date;
  s.courierLembreteVencido_ = () => true;
  s.courierLembreteSalvar_ = (item, estado, detalhe, threadId, messageId) => Object.assign(item, { estado, detalhe, thread: threadId || '', message: messageId || '' });
  return { s, rows, op, config, current, props, messages, original, sent: () => sent, failSend: () => { throwSend = true; } };
}

test('envia uma unica cobranca na conversa original e confirma ID da mensagem enviada', () => {
  const f = fixture();
  assert.equal(f.s.courierLembreteExecutar_().enviados, 1);
  assert.equal(f.rows[0].estado, 'ENVIADO');
  assert.equal(f.rows[0].message, 'sent');
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 1);
});

test('timeout depois de aceitar envio nunca resulta em segunda tentativa', () => {
  const f = fixture(); f.failSend();
  f.s.courierLembreteExecutar_();
  assert.equal(f.rows[0].estado, 'INCERTO');
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 1);
});

test('simulacao percorre validacoes sem enviar', () => {
  const f = fixture(); f.config.lembreteModo = 'Simulação';
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
  assert.equal(f.rows[0].estado, 'SIMULACAO');
});

for (const [name, change] of [
  ['kill switch', f => { f.props.COURIER_LEMBRETES_ATIVO = 'false'; }],
  ['outra conta', f => { f.props.COURIER_LEMBRETES_CONTA = 'other@example.invalid'; }],
  ['sem ID da mensagem', f => { f.op.gmailMessageId = ''; }],
  ['sem base historica', f => { f.rows.length = 0; }],
  ['configuracao desativada', f => { f.config.lembreteModo = ''; }],
  ['transporte alterado', f => { f.current.base = 'changed'; }],
  ['confirmado', f => { f.current.courierStatus = 'Confirmado'; }],
  ['cancelado', f => { f.current.status = 'Cancelado'; }],
  ['reagendado', f => { f.current.status = 'Reagendado'; }],
  ['regeneracao sem base atual', f => { f.op.geradoEm = new Date(); }],
  ['resposta nao reconhecida', f => { f.messages.push({ getId: () => 'reply', getDate: () => new Date() }); }],
  ['remetente incorreto', f => { f.original.getFrom = () => 'stranger@example.invalid'; }],
  ['courier destinataria divergente', f => { f.config.email = 'other@example.invalid'; }],
  ['copia oculta', f => { f.original.getBcc = () => 'hidden@example.invalid'; }],
  ['reply-to divergente', f => { f.original.getReplyTo = () => 'hidden@example.invalid'; }],
  ['mensagem com referencia de outro slot', f => { f.original.getPlainBody = () => 'IPS-TRP-EVT-T2'; }],
  ['tentativa duravel anterior', f => { f.rows[0].estado = 'TENTATIVA'; }]
]) test('bloqueia envio: ' + name, () => {
  const f = fixture(); change(f); f.s.courierLembreteExecutar_(); assert.equal(f.sent(), 0);
});

test('mudanca de status na releitura sob lock bloqueia envio', () => {
  const f = fixture();
  f.s.codexWithDocumentLock_ = (_name, fn) => { f.current.courierStatus = 'Confirmado'; return fn(); };
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
});

test('nova resposta entre reserva e envio cancela cobranca', () => {
  const f = fixture();
  f.s.codexWithDocumentLock_ = (_name, fn) => {
    const result = fn();
    f.messages.push({ getId: () => 'reply', getDate: () => new Date() });
    return result;
  };
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
  assert.equal(f.rows[0].estado, 'REVISAO');
});

test('modelo preserva paragrafos e substitui apenas campos conhecidos', () => {
  const f = fixture();
  const body = f.s.courierLembreteTexto_(f.config, f.current, f.op);
  assert.match(body, /Prezados,\n\n/);
  assert.match(body, /Transporte I/);
  assert.match(body, /resposta a este mesmo e-mail/);
  assert.doesNotMatch(body, /\{data\}/);
});

test('RPCs de ativacao e execucao exigem autorizacao antes de efeitos', () => {
  const s = base();
  s.codexAssertAdmin_ = () => { throw new Error('denied'); };
  s.codexAssertAdminOrInstalledTrigger_ = s.codexAssertAdmin_;
  assert.throws(() => s.configurarMonitorLembretesCourier(true), /denied/);
  assert.throws(() => s.monitorarLembretesCourier({}), /denied/);
});

test('pendencias legadas sao somente leitura e nunca inferem envio', () => {
  const s = base();
  s.getCodexSpreadsheet_ = () => ({ getSheetByName: () => null });
  const p = [{ agendaId: 'old', slot: 'Transporte II' }];
  s.courierLembreteAnotarPendencias_(p);
  assert.equal(p[0].lembreteStatus, 'Cobrança manual — sem vínculo rastreável');
});
