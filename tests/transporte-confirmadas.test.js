'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');

const plano = (v) => JSON.parse(JSON.stringify(v));

class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 9, 2, 12])); } // sexta 02/10/2026
}

const ARQUIVOS = ['AgendaServerRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs', 'TransporteTarefas.gs',
  'TransporteEmails.gs', 'TransporteEnvio.gs', 'TransportePeticionamento.gs', 'CourierLembretes.gs', 'TransporteConfirmadas.gs'];

function mensagem(id, opcoes) {
  const o = Object.assign({ from: 'eu@ucs.example', to: 'coleta@marken.example', cc: '', corpo: '', data: new Date(2026, 9, 1, 10), assunto: 'Pedido de coleta' }, opcoes);
  return {
    getId: () => id, getFrom: () => o.from, getTo: () => o.to, getCc: () => o.cc, getDate: () => o.data,
    isDraft: () => false, isInTrash: () => false, getPlainBody: () => o.corpo, getBody: () => '<p>' + o.corpo + '</p>', getSubject: () => o.assunto,
    getThread: () => o.thread
  };
}

function cenario(ajustar) {
  const enviados = [];
  const auditorias = [];
  const mensagens = [];
  const thread = { getId: () => 'T1', getMessages: () => mensagens };
  const ctx = {
    Date: FakeDate,
    Logger: { log() {} },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Session: { getActiveUser: () => ({ getEmail: () => 'eu@ucs.example' }) },
    GmailApp: {
      getAliases: () => [],
      getMessageById: (id) => { const m = mensagens.find((x) => x.getId() === id); if (!m) throw new Error('sem acesso'); return m; },
      search: () => [thread]
    },
    SpreadsheetApp: { flush() {} }
  };
  const s = runFiles(ARQUIVOS, ctx);
  const i = s.AGENDA_CFG.idx;
  const row = Array(s.AGENDA_CFG.lastCol).fill('');
  row[i.id] = 'ag1'; row[i.data] = '06/10/2026'; row[i.hora] = '09:00'; row[i.status] = 'Agendado';
  row[i.participante] = 'Pessoa'; row[i.projeto] = 'Estudo X'; row[i.visita] = 'V1';
  row[i.c1.nome] = 'MARKEN'; row[i.c1.status] = 'Confirmado'; row[i.c1.awb] = '123456'; row[i.c1.temp] = 'CONGELADO'; row[i.c1.destino] = 'LAB X';
  const sheet = {
    getRange(linha, coluna) {
      return {
        getDisplayValues: () => [row.map((v) => String(v))],
        setValue: (v) => { row[coluna - 1] = v; }
      };
    }
  };
  const ref = 'IPS-TRP-AG1-T1';
  mensagens.push(mensagem('m1', { corpo: 'Pedido ' + ref, thread }));
  mensagens.push(mensagem('m2', { from: 'Marken <coleta@marken.example>', to: 'eu@ucs.example', cc: 'equipe@ucs.example', corpo: 'Confirmado AWB 123456', data: new Date(2026, 9, 1, 15), assunto: 'RE: Pedido de coleta', thread }));
  Object.assign(s, {
    codexAssertAdmin_: () => ({ ok: true, role: 'admin', email: 'eu@ucs.example' }),
    codexAssertCanWrite_: () => ({ ok: true, role: 'admin' }),
    getAgendaSheetForRead_: () => sheet,
    getAgendaSheet_: () => sheet,
    encontrarLinhaPorId: (_sh, id) => (id === 'ag1' ? 2 : null),
    getAgendaCourierRows_: () => [{ nome: 'MARKEN', email: 'coleta@marken.example', emailAmbiente: '', emailCongelado: '' }],
    transporteOperacoesRows_: () => [{ agendaId: 'ag1', slot: '1', gmailMessageId: 'm1' }],
    codexWithDocumentLock_: (_n, fn) => fn(),
    codexWriteAuditChanges_: (...args) => auditorias.push(args),
    agendaInvalidateWindowCache_: () => {},
    courierLembreteAssinaturaHtml_: () => '',
    CodexExternalEffects_: { replyAll: (m, corpo, opcoes) => { enviados.push({ id: m.getId(), corpo, opcoes }); } }
  });
  if (ajustar) ajustar({ s, row, i, mensagens, thread });
  return { s, row, i, enviados, auditorias, mensagens, thread };
}

test('aba Confirmadas: Confirmado de qualquer data, sem prazo vermelho; ações conforme a data; Coletado e Agendado ficam fora', () => {
  const s = runFiles(ARQUIVOS, { Date: FakeDate, Logger: { log() {} }, Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) } });
  const i = s.AGENDA_CFG.idx;
  const linha = (id, data, status) => {
    const r = Array(s.AGENDA_CFG.lastCol).fill('');
    r[i.id] = id; r[i.data] = data; r[i.hora] = '09:00'; r[i.status] = 'Agendado'; r[i.participante] = 'P ' + id;
    r[i.c1.nome] = 'MARKEN'; r[i.c1.status] = status; r[i.c1.awb] = '9' + id.length;
    ['c2', 'c3', 'c4'].forEach((c) => { r[i[c].nome] = ''; });
    return r;
  };
  const hoje = new FakeDate();
  const r = plano(s.transporteTarefasConstruir_({ hoje, agora: hoje, feriados: {}, operacoes: [], preparos: {}, nomes: {}, linhas: [
    linha('a', '06/10/2026', 'Confirmado'),
    linha('b', '02/10/2026', 'Confirmado'),
    linha('c', '01/10/2026', 'Confirmado'),
    linha('d', '06/10/2026', 'Coletado'),
    linha('e', '06/10/2026', 'Agendado'),
    linha('f', '06/10/2026', 'Cancelado')
  ] }));
  // Futura: só cancelar. Hoje: enviar e cancelar. Passada (coleta feita, falta marcar): só enviar.
  assert.deepEqual(r.acompanhar.confirmadas.map((x) => [x.agendaId, x.slotRotulo, x.podeEnviar, x.podeCancelar, x.prazoLabel]).sort(),
    [['a', 'Transporte I', false, true, ''], ['b', 'Transporte I', true, true, ''], ['c', 'Transporte I', true, false, '']]);
  assert.deepEqual(r.acompanhar.confirmacao.map((x) => x.agendaId), ['e']);
  assert.deepEqual(r.tarefas, []);
});

test('prévia: responde à última mensagem com a courier entre os destinatários e sugere o texto', () => {
  const { s } = cenario();
  const p = plano(s.getTransporteCancelamento('ag1', '1'));
  assert.equal(p.ok, true);
  assert.equal(p.mensagemId, 'm2');
  assert.deepEqual(p.destinatarios, ['coleta@marken.example', 'equipe@ucs.example']);
  assert.match(p.texto, /cancelamento da coleta agendada para 06\/10\/2026, às 09:00 \(AWB 123456\)/);
});

test('confirmar: envia o texto padrão em resposta a todos, grava Cancelado e audita', () => {
  const { s, row, i, enviados, auditorias } = cenario();
  const r = plano(s.cancelarTransporteConfirmado('ag1', '1', 'm2'));
  assert.equal(r.ok, true);
  assert.equal(r.emailEnviado, true);
  assert.equal(row[i.c1.status], 'Cancelado');
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].id, 'm2');
  assert.match(enviados[0].corpo, /^Prezados,\n\nSolicitamos o cancelamento da coleta agendada para 06\/10\/2026, às 09:00 \(AWB 123456\)[\s\S]*Ref\. IPS: IPS-TRP-AG1-T1\nCancelamento IPS: ag1:1/);
  assert.match(enviados[0].opcoes.htmlBody, /Cancelamento IPS: ag1:1/);
  assert.equal(auditorias.length, 1);
  assert.deepEqual(plano(auditorias[0][3]), [{ field: 'Transporte I - Status', oldValue: 'Confirmado', newValue: 'Cancelado' }]);
});

test('mensagem nova na conversa depois da prévia: não envia nem grava', () => {
  const { s, row, i, enviados, mensagens, thread } = cenario();
  mensagens.push(mensagem('m3', { from: 'coleta@marken.example', to: 'eu@ucs.example', corpo: 'Atualização AWB 123456', data: new Date(2026, 9, 2, 9), thread }));
  const r = plano(s.cancelarTransporteConfirmado('ag1', '1', 'm2'));
  assert.equal(r.conflito, true);
  assert.equal(enviados.length, 0);
  assert.equal(row[i.c1.status], 'Confirmado');
});

test('status mudou (Coletado) ou data passada: recusa sem e-mail', () => {
  const coletado = cenario(({ row, i }) => { row[i.c1.status] = 'Coletado'; });
  assert.equal(plano(coletado.s.cancelarTransporteConfirmado('ag1', '1', 'm2')).conflito, true);
  assert.equal(coletado.enviados.length, 0);
  const passado = cenario(({ row, i }) => { row[i.data] = '01/10/2026'; });
  assert.match(plano(passado.s.getTransporteCancelamento('ag1', '1')).erro, /já passou/);
});

test('falha no envio não grava Cancelado; nova tentativa com o marcador já na conversa não repete o e-mail', () => {
  const { s, row, i, mensagens, thread } = cenario();
  s.CodexExternalEffects_ = { replyAll: () => { throw new Error('Gmail indisponível'); } };
  assert.throws(() => s.cancelarTransporteConfirmado('ag1', '1', 'm2'), /Gmail indisponível/);
  assert.equal(row[i.c1.status], 'Confirmado');
  // O Gmail aceitou a mensagem antes do erro: o marcador aparece na conversa.
  mensagens.push(mensagem('m4', { corpo: 'Texto\n\nCancelamento IPS: ag1:1', data: new Date(2026, 9, 2, 10), thread }));
  const enviados = [];
  s.CodexExternalEffects_ = { replyAll: () => enviados.push(1) };
  const previa = plano(s.getTransporteCancelamento('ag1', '1'));
  assert.equal(previa.jaEnviado, true);
  const r = plano(s.cancelarTransporteConfirmado('ag1', '1', ''));
  assert.equal(r.ok, true);
  assert.equal(r.emailEnviado, false);
  assert.equal(enviados.length, 0);
  assert.equal(row[i.c1.status], 'Cancelado');
});

test('sem conversa com a courier no Gmail de quem cancela: orienta cancelar pelo Gmail', () => {
  const { s, enviados } = cenario(({ s: srv, mensagens }) => {
    mensagens.length = 0;
    srv.transporteOperacoesRows_ = () => [];
  });
  assert.match(plano(s.getTransporteCancelamento('ag1', '1')).erro, /Não encontrei/);
  assert.match(plano(s.cancelarTransporteConfirmado('ag1', '1', 'm2')).erro, /Não encontrei/);
  assert.equal(enviados.length, 0);
});

test('contratos: RPCs públicas com admin no servidor, chamadas pela tela, botão vermelho e caixa de confirmação', () => {
  const fonte = readProjectFile('TransporteConfirmadas.gs');
  assert.match(fonte, /^function getTransporteCancelamento\(agendaId, slot\) \{\n  codexAssertAdmin_\(\);/m);
  assert.match(fonte, /^function cancelarTransporteConfirmado\(agendaId, slot, mensagemId\) \{\n  codexAssertAdmin_\(\);\n  codexAssertCanWrite_\(/m);
  assert.doesNotMatch(fonte, /(?<!CodexExternalEffects_)\.replyAll\(/,'o envio passa pelo adaptador simulável');
  assert.match(fonte, /CodexExternalEffects_\.replyAll\(/);
  const tela = readProjectFile('IndexTransporteCentralScripts.html');
  assert.ok(tela.includes('.getTransporteCancelamento('));
  assert.ok(tela.includes('.cancelarTransporteConfirmado('));
  assert.match(tela, /transpCentralBotao\('vermelho', 'cancel', 'Cancelar'/);
  const modais = readProjectFile('IndexExtraModals.html');
  assert.match(modais, /id="modalCancelarTransporteCentral"[^>]*data-accessible-dialog/);
  assert.match(modais, /Deseja mesmo cancelar este transporte\?/);
  assert.match(modais, /class="btn-danger tc-canc-confirmar"/);
  assert.ok(readProjectFile('IndexTransporteCentralContent.html').includes('data-tc-tab="confirmadas"'));
});

test('marcar como enviada: grava Enviado e audita; recusa antes da data, com status ou AWB diferentes', () => {
  const { s, row, i, auditorias, enviados } = cenario(({ row: r, i: idx }) => { r[idx.data] = '02/10/2026'; });
  s.agendaDateIsAfterToday_ = (d) => d.getTime() > new Date(2026, 9, 2, 23, 59).getTime();
  assert.equal(plano(s.marcarTransporteConfirmadoEnviado('ag1', '1', '999')).conflito, true, 'AWB diferente');
  assert.equal(row[i.c1.status], 'Confirmado');
  const r = plano(s.marcarTransporteConfirmadoEnviado('ag1', '1', '123456'));
  assert.equal(r.ok, true);
  assert.equal(row[i.c1.status], 'Enviado');
  assert.equal(enviados.length, 0, 'não envia e-mail');
  assert.deepEqual(plano(auditorias[0][3]), [{ field: 'Transporte I - Status', oldValue: 'Confirmado', newValue: 'Enviado' }]);
  assert.equal(plano(s.marcarTransporteConfirmadoEnviado('ag1', '1', '123456')).conflito, true, 'já não está Confirmado');
  const futuro = cenario();
  futuro.s.agendaDateIsAfterToday_ = (d) => d.getTime() > new Date(2026, 9, 2, 23, 59).getTime();
  assert.match(plano(futuro.s.marcarTransporteConfirmadoEnviado('ag1', '1', '123456')).erro, /a partir da data da visita/);
  assert.equal(futuro.row[i.c1.status], 'Confirmado');
  const fonte = readProjectFile('TransporteConfirmadas.gs');
  assert.match(fonte, /^function marcarTransporteConfirmadoEnviado\(agendaId, slot, awb\) \{\n  codexAssertAdmin_\(\);\n  codexAssertCanWrite_\(/m);
  assert.ok(readProjectFile('IndexTransporteCentralScripts.html').includes('.marcarTransporteConfirmadoEnviado('));
});
