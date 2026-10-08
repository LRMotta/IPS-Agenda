'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

const d = (s) => new Date(s + 'Z');
function base() { return runFile('CourierLembretes.gs', { Date }); }

test('horario D-1 e o unico gatilho da cobranca', () => {
  const s = base();
  const c = { lembreteLimite: '15:00' };
  const feriados = { '2026-09-07': true };
  assert.equal(s.courierLembreteVencido_(d('2026-09-21T14:30:00'), d('2026-09-21T16:30:00'), '2026-09-24', c, feriados), false);
  assert.equal(s.courierLembreteVencido_(d('2026-09-23T10:00:00'), d('2026-09-23T14:59:00'), '2026-09-24', c, feriados), false);
  assert.equal(s.courierLembreteVencido_(d('2026-09-23T14:30:00'), d('2026-09-23T15:00:00'), '2026-09-24', c, feriados), true);
  assert.equal(s.courierLembreteVencido_(d('2026-09-23T14:30:00'), d('2026-09-23T15:00:00'), '2026-09-24', {}, feriados), false);
  assert.equal(s.courierLembreteVencido_(d('2026-09-04T10:00:00'), d('2026-09-04T15:00:00'), '2026-09-04', c, feriados), false);
});

function fixture() {
  const rows = [{ key: 'evt:1', agendaId: 'evt', slot: '1', gerado: d('2026-09-04T11:00:00'), base: 'base', estado: 'BASE' }];
  const op = { agendaId: 'evt', slot: '1', geradoEm: rows[0].gerado, geradoPor: 'staff@example.invalid', emailEnviadoEm: d('2026-09-04T12:00:00'), gmailMessageId: 'orig', referencia: 'IPS-TRP-EVT-T1' };
  const config = { nome: 'Marken', email: 'courier@example.invalid', lembreteModo: 'Automático', lembreteLimite: '15:00' };
  const current = { base: 'base', status: 'Agendado', courierStatus: 'Agendado', courier: 'Marken', data: '05/09/2026', feriados: {}, awb: '123' };
  let sent = 0;
  let throwSend = false;
  const props = { COURIER_LEMBRETES_ATIVO: 'true', COURIER_LEMBRETES_CONTA: 'monitor@example.invalid' };
  const thread = { getId: () => 'thread', refresh() {}, getMessages: () => messages };
  const original = {
    getFrom: () => op.geradoPor, getTo: () => 'courier@example.invalid', getCc: () => 'monitor@example.invalid',
    getBcc: () => '', getReplyTo: () => '', getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-T1',
    getSubject: () => 'Agendamento de coleta', getAttachments: () => ['documento.pdf'],
    isDraft: () => false, isInTrash: () => false, getDate: () => op.emailEnviadoEm, getId: () => 'orig', getThread: () => thread
  };
  const messages = [original];
  let lastReplyOptions = null;
  const s = runFile('CourierLembretes.gs', {
    Date, Session: { getEffectiveUser: () => ({ getEmail: () => 'monitor@example.invalid' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    GmailApp: { getAliases: () => [], getMessageById: () => original, getThreadById: () => thread },
    getAgendaCourierRows_: () => [config], transporteOperacoesRows_: () => [op],
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
    normText_: (v) => String(v).toLowerCase(), parseAgendaDateAny_: () => new Date(),
    Utilities: { formatDate: () => '2026-09-05' },
    getGmailSignature: () => '<div>Minha assinatura<br>Telefone da equipe</div>',
    transporteMonitorReferencia_: () => 'IPS-TRP-EVT-T1',
    codexWithDocumentLock_: (_name, fn) => fn(), Logger: { log() {} },
    CodexExternalEffects_: { replyCourierReminder(_orig, body, options) {
      sent++;
      lastReplyOptions = options;
      messages.push({ getId: () => 'sent', isDraft: () => false, getDate: () => d('2026-09-04T15:00:00'), getFrom: () => 'monitor@example.invalid', getPlainBody: () => body });
      if (throwSend) throw new Error('timeout after acceptance');
    } }
  });
  s.courierLembreteRows_ = () => rows;
  s.courierLembreteAgendaSnapshot_ = () => ({});
  s.courierLembreteAgenda_ = () => current;
  s.courierLembreteHoraLocal_ = (date) => date;
  s.courierLembreteVencido_ = () => true;
  s.courierLembreteSalvar_ = (item, estado, detalhe, threadId, messageId) => Object.assign(item, { estado, detalhe, thread: threadId || '', message: messageId || '' });
  return { s, rows, op, config, current, props, messages, original, sent: () => sent, replyOptions: () => lastReplyOptions, failSend: () => { throwSend = true; } };
}

test('envia uma unica cobranca na conversa original e confirma ID da mensagem enviada', () => {
  const f = fixture();
  assert.equal(f.s.courierLembreteExecutar_().enviados, 1);
  assert.equal(f.rows[0].estado, 'ENVIADO');
  assert.equal(f.rows[0].message, 'sent');
  assert.equal(f.replyOptions().attachments.length, 1);
  assert.equal(f.replyOptions().attachments[0], 'documento.pdf');
  assert.match(f.replyOptions().htmlBody, /Minha assinatura/);
  assert.match(f.messages[1].getPlainBody(), /--- E-mail original completo ---/);
  assert.match(f.messages[1].getPlainBody(), /Ref\. IPS: IPS-TRP-EVT-T1/);
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
  ['remetente sem endereco', f => { f.original.getFrom = () => 'Nome sem endereço'; }],
  ['remetente ambiguo', f => { f.original.getFrom = () => 'one@example.invalid, two@example.invalid'; }],
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

test('solicitacao de outro integrante recebe cobranca da conta monitorada', () => {
  const f = fixture();
  f.original.getFrom = () => 'Melissa <melissa@example.invalid>';
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 1);
  assert.equal(f.messages[1].getFrom(), f.props.COURIER_LEMBRETES_CONTA);
  assert.equal(f.rows[0].thread, 'thread');
});

test('geracao posterior por outro usuario preserva validacao do envio original', () => {
  const f = fixture();
  const envioOriginal = f.op.emailEnviadoEm;
  f.original.getDate = () => envioOriginal;
  f.original.getFrom = () => 'melissa@example.invalid';
  f.op.geradoEm = d('2026-09-04T14:00:00');
  f.rows[0].gerado = f.op.geradoEm;
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 1);
  assert.equal(f.op.emailEnviadoEm, envioOriginal);
});

test('gerador ausente nao substitui validacao da mensagem vinculada', () => {
  const f = fixture();
  f.original.getFrom = () => 'melissa@example.invalid';
  f.op.geradoPor = '';
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 1);
});

test('data divergente da mensagem vinculada continua bloqueando cobranca', () => {
  const f = fixture();
  f.original.getDate = () => d('2026-09-04T13:00:00');
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
  assert.equal(f.rows[0].detalhe, 'Data do envio não validada');
});

test('historico conserva tabela, estilos, links e citacoes HTML mesmo sem assinatura', () => {
  const f = fixture();
  const html = '<table style="color:red"><tr><td><b>Coleta</b></td></tr></table><a href="https://example.invalid">Documento</a><blockquote><i>Mensagem anterior</i></blockquote>';
  f.original.getBody = () => html;
  f.original.getSubject = () => 'Coleta <teste> & confirmação';
  f.s.getGmailSignature = () => '';
  f.config.lembreteTexto = 'Prezados <equipe> & courier';
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 1);
  assert.ok(f.replyOptions().htmlBody.includes(html));
  assert.match(f.replyOptions().htmlBody, /Prezados &lt;equipe&gt; &amp; courier/);
  assert.match(f.replyOptions().htmlBody, /Coleta &lt;teste&gt; &amp; confirmação/);
  assert.equal(f.replyOptions().inlineImages, undefined);
  assert.match(f.messages[1].getPlainBody(), /Ref\. IPS: IPS-TRP-EVT-T1/);
});

test('HTML original e assinatura permanecem separados do fallback em texto simples', () => {
  const f = fixture();
  f.original.getBody = () => '<strong>Original formatado</strong>';
  f.s.courierLembreteExecutar_();
  assert.match(f.replyOptions().htmlBody, /<div>Minha assinatura<br>Telefone da equipe<\/div>/);
  assert.match(f.replyOptions().htmlBody, /<strong>Original formatado<\/strong>/);
  assert.ok(!f.replyOptions().htmlBody.includes('--- Fim do e-mail original ---'));
});

for (const assinatura of [true, false]) {
  for (const historicoHtml of [true, false]) {
    test('codigos da cobranca usam o estilo do agendamento: assinatura=' + assinatura + ', historico HTML=' + historicoHtml, () => {
      const f = fixture();
      if (!assinatura) f.s.getGmailSignature = () => '';
      if (historicoHtml) f.original.getBody = () => '<strong>Original formatado</strong>';
      const texto = f.s.courierLembreteTexto_(f.config, f.current, f.op, f.original);
      const html = f.s.courierLembreteReplyOptions_(f.original, texto).htmlBody;
      const agendamento = runFile('TransporteCodexConfig.gs').transporteMonitorRefHtml_(f.op.referencia);
      const estilo = agendamento.match(/style="([^"]+)"/)[1];
      const rodape = '<div style="' + estilo + '">Ref. IPS: IPS-TRP-EVT-T1<br>Cobrança IPS: evt:1</div>';
      assert.ok(html.includes(rodape));
      if (assinatura) assert.ok(html.indexOf('Telefone da equipe</div>') < html.indexOf(rodape));
      assert.ok(html.indexOf(rodape) < html.indexOf('--- E-mail original completo ---'));
      assert.match(texto, /Ref\. IPS: IPS-TRP-EVT-T1\nCobrança IPS: evt:1/);
      assert.match(html, historicoHtml ? /<strong>Original formatado<\/strong>/ : /--- Fim do e-mail original ---/);
    });
  }
}

test('rodape da cobranca escapa os codigos sem estilizar o texto personalizado ou o historico', () => {
  const f = fixture();
  f.config.lembreteTexto = 'Ref. IPS: exemplo\nCobrança IPS: exemplo';
  f.op.referencia = '<referencia> & teste';
  f.op.agendaId = '<agenda>&';
  const texto = f.s.courierLembreteTexto_(f.config, f.current, f.op, f.original);
  const html = f.s.courierLembreteReplyOptions_(f.original, texto).htmlBody;
  assert.ok(html.startsWith('Ref. IPS: exemplo<br>Cobrança IPS: exemplo'));
  assert.match(html, />Ref\. IPS: &lt;referencia&gt; &amp; teste<br>Cobrança IPS: &lt;agenda&gt;&amp;:1<\/div>/);
  assert.equal((html.match(/font-size:9px/g) || []).length, 1);
  assert.match(html, /--- E-mail original completo ---<br>Assunto:/);
});

test('mensagem somente texto conserva historico escapado e anexos', () => {
  const f = fixture();
  f.original.getBody = () => '';
  f.original.getPlainBody = () => 'Ref. IPS: IPS-TRP-EVT-T1\n<texto> & dados';
  f.s.courierLembreteExecutar_();
  assert.match(f.replyOptions().htmlBody, /&lt;texto&gt; &amp; dados/);
  assert.equal(f.replyOptions().attachments[0], 'documento.pdf');
});

test('imagens inline usam Content-ID MIME mesmo com nomes iguais e partes aninhadas', () => {
  const s = runFile('CourierLembretes.gs', {
    Utilities: { base64Decode: value => [...Buffer.from(value, 'base64')], newBlob: (bytes, type) => ({ bytes, type }) }
  });
  const raw = [
    'Content-Type: multipart/related; boundary="outer"', '', '--outer',
    'Content-Type: multipart/alternative; boundary="inner"', '', '--inner',
    'Content-Type: text/html', '', '<img src="cid:logo1">', '--inner--', '--outer',
    'Content-Type: image/png; name="logo.png"', 'Content-ID: <logo2>', 'Content-Transfer-Encoding: base64', '', 'Ag==', '--outer',
    'Content-Type: image/png;', ' name="logo.png"', 'Content-ID:', ' <logo1>', 'Content-Transfer-Encoding: base64', '', 'AQ==', '--outer--'
  ].join('\r\n');
  const result = s.courierLembreteHistoricoHtml_({ getRawContent: () => raw }, '<img src="cid:logo1"><img src="cid:logo2"><img src="cid:logo1">');
  assert.equal(result.html, '<img src="cid:courierHistorico0"><img src="cid:courierHistorico1"><img src="cid:courierHistorico0">');
  assert.deepEqual(result.inlineImages.courierHistorico0.bytes, [1]);
  assert.deepEqual(result.inlineImages.courierHistorico1.bytes, [2]);
  assert.equal(result.inlineImages.courierHistorico0.type, 'image/png');
  const original = {
    getRawContent: () => raw, getBody: () => '<img src="cid:logo1"><img src="cid:logo2">',
    getPlainBody: () => 'Histórico', getAttachments: () => ['documento.pdf']
  };
  const options = s.courierLembreteReplyOptions_(original, 'Cobrança' + s.courierLembreteOriginalTexto_(original));
  assert.match(options.htmlBody, /src="cid:courierHistorico0"/);
  assert.deepEqual(options.inlineImages.courierHistorico0.bytes, [1]);
  assert.equal(options.attachments[0], 'documento.pdf');
  assert.throws(() => s.courierLembreteHistoricoHtml_({ getRawContent: () => raw.replace('<logo2>', '<logo1>') }, '<img src="cid:logo1">'), /ambígua/);
  assert.throws(() => s.courierLembreteHistoricoHtml_({ getRawContent: () => raw.replace(/base64/g, 'quoted-printable') }, '<img src="cid:logo1">'), /não suportada/);
});

test('falha ao recuperar imagem inline impede envio real', () => {
  const f = fixture();
  f.original.getBody = () => '<img src="cid:ausente">';
  f.original.getRawContent = () => '';
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
  assert.notEqual(f.rows[0].estado, 'ENVIADO');
});

for (const field of ['geradoEm', 'referencia', 'geradoPor', 'courier', 'gmailMessageId', 'emailEnviadoEm']) {
  test('operacao alterada antes da reserva bloqueia envio: ' + field, () => {
    const f = fixture();
    let latest = f.op;
    f.s.transporteOperacoesRows_ = () => [latest];
    f.s.codexWithDocumentLock_ = (_name, fn) => {
      latest = { ...f.op, [field]: field.endsWith('Em') ? d('2026-09-04T14:00:00') : 'alterado' };
      return fn();
    };
    f.s.courierLembreteExecutar_();
    assert.equal(f.sent(), 0);
    assert.equal(f.rows[0].estado, 'BASE');
  });
}

test('operacoes duplicadas bloqueiam envio sem selecionar a primeira', () => {
  const f = fixture();
  f.s.transporteOperacoesRows_ = () => [f.op, { ...f.op }];
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
});

test('nova base persistida antes da reserva nao e sobrescrita', () => {
  const f = fixture();
  f.s.codexWithDocumentLock_ = (_name, fn) => {
    f.rows[0] = { ...f.rows[0], base: 'nova-base', gerado: d('2026-09-04T14:00:00') };
    return fn();
  };
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
  assert.equal(f.rows[0].base, 'nova-base');
  assert.equal(f.rows[0].estado, 'BASE');
});

for (const [name, change] of [
  ['confirmacao', f => { f.current.courierStatus = 'Confirmado'; }],
  ['cancelamento', f => { f.current.status = 'Cancelado'; }],
  ['dados', f => { f.current.base = 'changed'; }],
  ['operacao', f => { f.s.transporteOperacoesRows_ = () => [{ ...f.op, gmailMessageId: 'nova' }]; }],
  ['pausa', f => { f.props.COURIER_LEMBRETES_ATIVO = 'false'; }],
  ['conta', f => { f.props.COURIER_LEMBRETES_CONTA = 'other@example.invalid'; }],
  ['configuracao', f => { f.s.getAgendaCourierRows_ = () => [{ ...f.config, lembreteModo: 'Simulação' }]; }],
  ['horario ou feriado', f => { f.s.courierLembreteVencido_ = () => false; }],
  ['resposta Gmail', f => { f.messages.push({ getId: () => 'reply', getDate: () => new Date() }); }]
]) test('revalida depois de recuperar anexos: ' + name, () => {
  const f = fixture();
  f.original.getAttachments = () => { change(f); return ['documento.pdf']; };
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
  assert.equal(f.rows[0].estado, 'REVISAO');
});

test('uma leitura inicial da Agenda atende varios candidatos ainda fora do prazo', () => {
  const f = fixture();
  let leituras = 0;
  const snapshot = {};
  f.rows.push({ ...f.rows[0], key: 'evt:2', slot: '2' });
  f.s.transporteOperacoesRows_ = () => [f.op, { ...f.op, slot: '2' }];
  f.s.courierLembreteAgendaSnapshot_ = () => { leituras++; return snapshot; };
  f.s.courierLembreteAgenda_ = (_id, _slot, supplied) => {
    assert.equal(supplied, snapshot);
    return f.current;
  };
  f.s.courierLembreteVencido_ = () => false;
  f.s.courierLembreteExecutar_();
  assert.equal(leituras, 1);
  assert.equal(f.sent(), 0);
});

test('Agenda sem candidatos rastreaveis nao e carregada', () => {
  const f = fixture();
  f.op.gmailMessageId = '';
  f.s.courierLembreteAgendaSnapshot_ = () => { throw new Error('leitura desnecessaria'); };
  f.s.courierLembreteExecutar_();
  assert.equal(f.sent(), 0);
});

test('releitura da Agenda consulta apenas IDs e linha atual, com feriados centrais frescos', () => {
  const ranges = [];
  const idx = { id: 2, data: 3, tipo: 4, hora: 5, participante: 6, projeto: 7, visita: 8, status: 9, c1: { nome: 10, status: 11, awb: 12 } };
  const rows = [
    ['', '', 'evt', '08/09/2026', 'Visita', '10:00', 'P', 'Proj', 'V1', 'Agendado', 'Marken', 'Agendado', '123'],
    ['', '', 'feriado', '07/09/2026', 'Feriado']
  ];
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRange(row, col, height, width) {
      ranges.push({ row, col, height, width });
      return { getDisplayValues: () => rows.slice(row - 2, row - 2 + height).map(r => Array.from({ length: width }, (_, i) => r[col - 1 + i] || '')) };
    }
  };
  let feriados = 0;
  const s = runFile('CourierLembretes.gs', {
    getAgendaSheetForRead_: () => sheet, AGENDA_CFG: { idx, lastCol: 13 },
    getAgendaFeriadosPendenciasMap_: (...args) => {
      feriados++;
      assert.equal(args.length, 0);
      return { '2026-09-07': true };
    }
  });
  const snapshot = s.courierLembreteAgendaSnapshot_(false);
  const initial = s.courierLembreteAgenda_('evt', '1', snapshot);
  s.courierLembreteAgenda_('evt', '1', snapshot);
  assert.equal(ranges.length, 1);
  assert.equal(feriados, 1);
  rows[0][11] = 'Confirmado';
  const fresh = s.courierLembreteAgenda_('evt', '1');
  assert.equal(fresh.courierStatus, 'Confirmado');
  assert.equal(fresh.base, initial.base);
  assert.equal(fresh.feriados['2026-09-07'], true);
  assert.deepEqual(ranges.slice(1), [
    { row: 2, col: 3, height: 2, width: 1 },
    { row: 2, col: 1, height: 1, width: 13 }
  ]);
  rows.push([...rows[0]]);
  assert.equal(s.courierLembreteAgenda_('evt', '1'), null);
  assert.equal(ranges.length, 4); // ID duplicado dispensa leitura da linha inteira.
});

test('flush ocorre somente na reserva duravel anterior ao efeito externo', () => {
  const calls = [];
  const sheet = { getRange: () => ({ setValues: () => calls.push('write') }) };
  const s = runFile('CourierLembretes.gs', {
    Date, getCodexSpreadsheet_: () => ({ getSheetByName: () => sheet }),
    SpreadsheetApp: { flush: () => calls.push('flush') }
  });
  const item = { row: 2, key: 'evt:1', agendaId: 'evt', slot: '1', gerado: d('2026-09-04T11:00:00'), base: 'base' };
  s.courierLembreteSalvar_(item, 'TENTATIVA', 'reservado');
  assert.deepEqual(calls, ['write', 'flush']);
  calls.length = 0;
  for (const state of ['BASE', 'SIMULACAO', 'REVISAO', 'ENVIADO', 'INCERTO']) s.courierLembreteSalvar_(item, state, 'estado');
  assert.deepEqual(calls, ['write', 'write', 'write', 'write', 'write']);
});

test('modelo preserva paragrafos e substitui apenas campos conhecidos', () => {
  const f = fixture();
  const body = f.s.courierLembreteTexto_(f.config, f.current, f.op);
  assert.match(body, /Prezados,\n\n/);
  assert.doesNotMatch(body, /Transporte I/);
  assert.match(body, /coleta prevista para 05\/09\/2026 \(AWB: 123\)/);
  assert.match(body, /Minha assinatura\nTelefone da equipe/);
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
