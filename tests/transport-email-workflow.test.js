'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function norm(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function transportServer(extra = {}) {
  const book = extra.book || new FakeSpreadsheet({});
  return runFile('TransporteCodexConfig.gs', {
    getCodexSpreadsheet_: () => book,
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
    normText_: norm,
    ...extra,
    book
  });
}

test('referencia discreta identifica Agenda e slot e a pendencia nasce apos uma hora', () => {
  const book = new FakeSpreadsheet({});
  const server = transportServer({ book });
  const registro = server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'evt-123',
    slot: 'II',
    courier: 'DHL',
    geradoPor: 'usuario@example.invalid',
    pdfId: 'PDF-1',
    pdfNome: 'docs.pdf',
    rascunhoId: 'DRAFT-1',
    rascunhoOk: true
  });

  assert.equal(registro.referencia, 'IPS-TRP-EVT-123-T2');
  assert.match(server.transporteMonitorRefHtml_(registro.referencia), /font-size:9px/);
  assert.equal(server.transporteDocumentosSemEnvioPendencias_(new Date(Date.now() + 59 * 60 * 1000)).length, 0);
  const pendentes = server.transporteDocumentosSemEnvioPendencias_(new Date(Date.now() + 61 * 60 * 1000));
  assert.equal(pendentes.length, 1);
  assert.match(pendentes[0].motivo, /mais de 1 hora/);
});

test('regenerar documentos preserva a evidencia de e-mail do mesmo transporte', () => {
  const book = new FakeSpreadsheet({});
  const server = transportServer({ book });
  const primeiro = server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-REGERAR', slot: '3', courier: 'MARKEN',
    pdfId: 'PDF-ANTIGO', pdfNome: 'antigo.pdf', rascunhoOk: true
  });
  const identificadoEm = new Date('2026-09-11T16:48:00-03:00');
  const enviadoEm = new Date('2026-09-11T16:49:00-03:00');
  const verificadoEm = new Date('2026-09-11T16:50:00-03:00');
  book.getSheetByName('Transporte_Operacoes').getRange(primeiro.row, 12, 1, 5).setValues([[
    identificadoEm, enviadoEm, 'MSG-COM-ANEXOS', 2, verificadoEm
  ]]);

  server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-REGERAR', slot: 'III', courier: 'MARKEN',
    pdfId: 'PDF-NOVO', pdfNome: 'novo.pdf', rascunhoOk: true
  });

  const operacao = server.transporteOperacoesRows_()[0];
  assert.equal(operacao.pdfId, 'PDF-NOVO');
  assert.equal(operacao.pdfNome, 'novo.pdf');
  assert.equal(operacao.gmailMessageId, 'MSG-COM-ANEXOS');
  assert.equal(operacao.anexos, 2);
  assert.equal(operacao.emailIdentificadoEm.getTime(), identificadoEm.getTime());
  assert.equal(operacao.emailEnviadoEm.getTime(), enviadoEm.getTime());
  assert.equal(operacao.ultimaVerificacao.getTime(), verificadoEm.getTime());
  assert.equal(server.transporteDocumentosSemEnvioPendencias_(new Date('2026-09-14T12:00:00-03:00')).length, 0);
});

test('monitor da copia com anexo promove somente status pendente para Agendado', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier', 'ID'],
    ['Agendado', 'DHL', 'Pendente', 'EVT-1']
  ]);
  const audits = [];
  const messageDate = new Date(Date.now() + 2 * 60 * 1000);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1, id: 4 },
      idx: {
        c1: { nome: 1, status: 2 },
        c2: { nome: 3, status: 4 },
        c3: { nome: 5, status: 6 }
      }
    },
    getAgendaSheet_: () => agenda,
    encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    codexWriteAuditChanges_: (...args) => audits.push(args),
    GmailApp: {
      search: () => [{
        getMessages: () => [{
          getSubject: () => 'Agendamento de coleta',
          getPlainBody: () => 'Documentos anexos. Ref. IPS: IPS-TRP-EVT-1-T1',
          getDate: () => messageDate,
          getId: () => 'MSG-1',
          getAttachments: () => [{ getName: () => 'assinado.pdf' }]
        }]
      }]
    }
  });
  server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-1', slot: '1', courier: 'DHL', rascunhoOk: true
  });

  const result = server.transporteMonitorarEnviosPorEmail_();

  assert.equal(result.enviados, 1);
  assert.equal(result.semAnexo, 0);
  assert.equal(agenda.rows[1][2], 'Agendado');
  assert.equal(audits.length, 1);
  assert.ok(server.transporteOperacoesRows_()[0].emailEnviadoEm instanceof Date);
});

test('email identificado sem anexo continua pendente e nao muda o status', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier', 'ID'],
    ['Agendado', 'OCASA', 'Não Agendado', 'EVT-2']
  ]);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1, id: 4 },
      idx: {
        c1: { nome: 1, status: 2 },
        c2: { nome: 3, status: 4 },
        c3: { nome: 5, status: 6 }
      }
    },
    getAgendaSheet_: () => agenda,
    encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    GmailApp: {
      search: () => [{
        getMessages: () => [{
          getSubject: () => 'Agendamento',
          getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-2-T1',
          getDate: () => new Date(Date.now() + 60 * 1000),
          getId: () => 'MSG-2',
          getAttachments: () => []
        }]
      }]
    }
  });
  server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-2', slot: '1', courier: 'OCASA', rascunhoOk: true
  });

  const result = server.transporteMonitorarEnviosPorEmail_();

  assert.equal(result.enviados, 0);
  assert.equal(result.semAnexo, 1);
  assert.equal(agenda.rows[1][2], 'Não Agendado');
  const pendentes = server.transporteDocumentosSemEnvioPendencias_(new Date(Date.now() + 61 * 60 * 1000));
  assert.equal(pendentes.length, 1);
  assert.match(pendentes[0].motivo, /sem documentação anexada/);
});

test('DHL sem anexo confirma o envio, promove para Agendado e sai das pendencias', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier', 'ID'],
    ['Agendado', 'DHL', 'Pendente', 'EVT-DHL']
  ]);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1, id: 4 },
      idx: {
        c1: { nome: 1, status: 2 },
        c2: { nome: 3, status: 4 },
        c3: { nome: 5, status: 6 }
      }
    },
    getAgendaSheet_: () => agenda,
    encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    GmailApp: {
      search: () => [{
        getMessages: () => [{
          getSubject: () => 'Agendamento DHL',
          getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-DHL-T1',
          getDate: () => new Date(Date.now() + 60 * 1000),
          getId: () => 'MSG-DHL',
          getAttachments: () => []
        }]
      }]
    }
  });
  server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-DHL', slot: '1', courier: 'DHL', rascunhoOk: true
  });

  const result = server.transporteMonitorarEnviosPorEmail_();

  assert.equal(result.enviados, 1);
  assert.equal(result.semAnexo, 0);
  assert.equal(agenda.rows[1][2], 'Agendado');
  assert.ok(server.transporteOperacoesRows_()[0].emailEnviadoEm instanceof Date);
  assert.equal(server.transporteDocumentosSemEnvioPendencias_(new Date(Date.now() + 61 * 60 * 1000)).length, 0);
});

test('email com anexo continua elegivel para nova tentativa se a Agenda divergir', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier', 'ID'],
    ['Agendado', 'MARKEN divergente', 'Pendente', 'EVT-3']
  ]);
  const messageDate = new Date(Date.now() + 2 * 60 * 1000);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1, id: 4 },
      idx: {
        c1: { nome: 1, status: 2 },
        c2: { nome: 3, status: 4 },
        c3: { nome: 5, status: 6 }
      }
    },
    getAgendaSheet_: () => agenda,
    encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    GmailApp: {
      search: () => [{
        getMessages: () => [{
          getSubject: () => 'Agendamento de coleta',
          getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-3-T1',
          getDate: () => messageDate,
          getId: () => 'MSG-3',
          getAttachments: () => [{ getName: () => 'assinado.pdf' }]
        }]
      }]
    }
  });
  server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-3', slot: '1', courier: 'MARKEN', rascunhoOk: true
  });

  const primeira = server.transporteMonitorarEnviosPorEmail_();
  assert.equal(primeira.enviados, 0);
  assert.equal(primeira.naoPromovidos, 1);
  assert.equal(server.transporteOperacoesRows_()[0].emailEnviadoEm, '');

  agenda.rows[1][1] = 'MARKEN';
  const segunda = server.transporteMonitorarEnviosPorEmail_();
  assert.equal(segunda.enviados, 1);
  assert.equal(agenda.rows[1][2], 'Agendado');
  assert.ok(server.transporteOperacoesRows_()[0].emailEnviadoEm instanceof Date);
});

test('status Agendado informado manualmente encerra pendencia mesmo com courier divergente', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier', 'ID'],
    ['Agendado', 'PINEX divergente', 'Pendente', 'EVT-MANUAL']
  ]);
  const audits = [];
  const messageDate = new Date(Date.now() + 2 * 60 * 1000);
  let gmailSearches = 0;
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1, id: 4 },
      idx: {
        c1: { nome: 1, status: 2 },
        c2: { nome: 3, status: 4 },
        c3: { nome: 5, status: 6 }
      }
    },
    getAgendaSheet_: () => agenda,
    encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    codexWriteAuditChanges_: (...args) => audits.push(args),
    GmailApp: {
      search: () => {
        gmailSearches += 1;
        return gmailSearches === 1 ? [{
          getMessages: () => [{
            getSubject: () => 'Agendamento de coleta',
            getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-MANUAL-T1',
            getDate: () => messageDate,
            getId: () => 'MSG-MANUAL',
            getAttachments: () => [{ getName: () => 'assinado.pdf' }]
          }]
        }] : [];
      }
    }
  });
  server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-MANUAL', slot: '1', courier: 'PINEX', rascunhoOk: true
  });

  const primeira = server.transporteMonitorarEnviosPorEmail_();
  assert.equal(primeira.enviados, 0);
  assert.equal(primeira.naoPromovidos, 1);

  agenda.rows[1][2] = 'Agendado';
  const segunda = server.transporteMonitorarEnviosPorEmail_();

  assert.equal(segunda.enviados, 1);
  assert.equal(segunda.naoPromovidos, 0);
  assert.equal(agenda.rows[1][2], 'Agendado');
  assert.equal(audits.length, 0);
  assert.equal(gmailSearches, 1, 'a segunda tentativa deve usar o e-mail ja identificado');
  assert.equal(
    new Date(server.transporteOperacoesRows_()[0].emailEnviadoEm).getTime(),
    messageDate.getTime()
  );
  assert.equal(server.transporteDocumentosSemEnvioPendencias_(new Date(Date.now() + 61 * 60 * 1000)).length, 0);
});

test('monitor recupera operacao antiga concluida antes de promover a Agenda', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier', 'ID'],
    ['Agendado', 'MARKEN', 'Pendente', 'EVT-4']
  ]);
  const messageDate = new Date(Date.now() + 2 * 60 * 1000);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1, id: 4 },
      idx: {
        c1: { nome: 1, status: 2 },
        c2: { nome: 3, status: 4 },
        c3: { nome: 5, status: 6 }
      }
    },
    getAgendaSheet_: () => agenda,
    encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    GmailApp: {
      search: () => [{
        getMessages: () => [{
          getSubject: () => 'Agendamento de coleta',
          getPlainBody: () => 'Ref. IPS: IPS-TRP-EVT-4-T1',
          getDate: () => messageDate,
          getId: () => 'MSG-4',
          getAttachments: () => [{ getName: () => 'assinado.pdf' }]
        }]
      }]
    }
  });
  const registro = server.transporteRegistrarDocumentacaoGerada_({
    agendaId: 'EVT-4', slot: '1', courier: 'MARKEN', rascunhoOk: true
  });
  const operacoes = book.getSheetByName('Transporte_Operacoes');
  operacoes.getRange(registro.row, 12, 1, 5).setValues([[
    messageDate, messageDate, 'MSG-4', 1, messageDate
  ]]);

  const result = server.transporteMonitorarEnviosPorEmail_();

  assert.equal(result.enviados, 1);
  assert.equal(agenda.rows[1][2], 'Agendado');
});

test('geracao de PDF reaplica o payload no mesmo lock antes de exportar', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  const generate = source.slice(
    source.indexOf('function gerarPdfTransporte(options)'),
    source.indexOf('function transporteDriveAccessWarning_(')
  );
  assert.match(generate, /codexWithDocumentLock_\('gerarPdfTransporte'/);
  assert.match(generate, /if \(options\.payload\)[\s\S]*salvarTransporteInterno_\(options\.payload/);
  assert.match(generate, /transporteValidarManifestoPdf_\(options\)/);
  assert.ok(
    generate.indexOf('salvarTransporteInterno_(options.payload') < generate.indexOf("'copy_export_drive'"),
    'o payload deve ser reaplicado antes da exportacao'
  );
  assert.ok(
    generate.indexOf('transporteValidarManifestoPdf_(options)') < generate.indexOf("'copy_export_drive'"),
    'o manifesto deve ser validado antes de criar a copia do PDF'
  );
});

test('salvar Transporte nao presume envio e o rascunho inclui referencia depois da assinatura', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  assert.match(source, /var statusNovo = String\(payload\.statusCourier \|\| payload\.status \|\| ''\)/);
  assert.doesNotMatch(source, /payload\.statusCourier \|\| payload\.status \|\| 'Agendado'/);
  assert.match(source, /getGmailSignature\(\) \+ transporteMonitorRefHtml_\(refInterna\)/);
  assert.match(source, /in:anywhere -in:drafts newer_than:30d/);
});

function monitorFixture({ body = 'ips - trp - EVT-TEST - t1', courier = 'DHL', draft = false, attachments = [], status = 'Não Agendado' } = {}) {
  const agenda = new FakeSheet('Agenda', [['Evento', 'Courier', 'Status', 'ID'], ['Agendado', courier, status, 'EVT-TEST']]);
  const logs = [];
  const message = {
    getSubject: () => body, getPlainBody: () => '', isDraft: () => draft,
    getDate: () => new Date(Date.now() + 60000), getId: () => 'MSG-TEST', getAttachments: () => attachments
  };
  const server = transportServer({
    AgendaServerRules_: runFile('AgendaServerRules.gs').AgendaServerRules_,
    AGENDA_CFG: { col: { status: 1, id: 4 }, idx: { c1: { nome: 1, status: 2 }, c2: { nome: 3, status: 4 }, c3: { nome: 5, status: 6 } } },
    getAgendaSheet_: () => agenda, encontrarLinhaPorId: () => 2,
    codexWithDocumentLock_: (_label, fn) => fn(),
    Logger: { log: text => logs.push(text) },
    GmailApp: { search: () => [{ getMessages: () => [message] }] }
  });
  server.transporteRegistrarDocumentacaoGerada_({ agendaId: 'EVT-TEST', slot: '1', courier, rascunhoOk: true });
  return { server, agenda, message, logs };
}

test('monitor compartilha IDs por fase e refaz o indice sob lock apos mover linhas', () => {
  const { server, agenda, message } = monitorFixture();
  agenda.rows.push(['Agendado', 'DHL', 'Pendente', 'EVT-B']);
  server.transporteRegistrarDocumentacaoGerada_({ agendaId: 'EVT-B', slot: '1', courier: 'DHL', rascunhoOk: true });
  const old = new Date(Date.now() - 60000);
  // Duas operações já identificadas passam pela pré-checagem de recuperação.
  for (const row of [2, 3]) {
    server.book.getSheetByName('Transporte_Operacoes').getRange(row, 12, 1, 5).setValues([[old, old, 'ANTIGA', 0, old]]);
  }
  message.getSubject = () => 'IPS-TRP-EVT-TEST-T1 IPS-TRP-EVT-B-T1';
  const reads = { before: 0, locked: 0 };
  let locked = false;
  const getRange = agenda.getRange.bind(agenda);
  agenda.getRange = (...args) => {
    const range = getRange(...args);
    if (args[0] === 2 && args[1] === 4 && args[3] === 1) {
      const getValues = range.getValues.bind(range);
      range.getValues = () => { reads[locked ? 'locked' : 'before']++; return getValues(); };
    }
    return range;
  };
  server.encontrarLinhaPorId = () => { throw new Error('Busca individual de IDs proibida no monitor'); };
  server.codexWithDocumentLock_ = (_label, fn) => {
    // Simula alteração durante a busca Gmail: muda a linha e cancela o outro evento.
    agenda.rows.splice(1, 0, ['Agendado', 'DHL', 'Pendente', 'OUTRO']);
    agenda.rows[3][0] = 'Cancelado';
    locked = true;
    try { return fn(); } finally { locked = false; }
  };
  const result = server.transporteMonitorarEnviosPorEmail_();
  assert.equal(result.enviados, 1);
  assert.equal(result.naoPromovidos, 1);
  assert.deepEqual(reads, { before: 1, locked: 1 });
  assert.equal(agenda.rows[1][2], 'Pendente');
  assert.equal(agenda.rows[2][2], 'Agendado');
  assert.equal(agenda.rows[3][2], 'Pendente');
});

test('indice da Agenda preserva comparacao exata, primeira ocorrencia e IDs especiais', () => {
  const server = transportServer({ AGENDA_CFG: { col: { id: 1 } } });
  const agenda = new FakeSheet('Agenda', [['ID'], [123], ['123'], ['00123'], ['__proto__'], ['constructor'], [' EVT ']]);
  const ids = server.transporteAgendaLinhasPorId_(agenda);
  assert.equal(ids['123'], 2);
  assert.equal(ids['00123'], 4);
  assert.equal(ids.__proto__, 5);
  assert.equal(ids.constructor, 6);
  assert.equal(ids[' EVT '], 7);
  assert.equal(ids.EVT, undefined);
  assert.equal(ids.AUSENTE, undefined);
  assert.equal(Object.keys(server.transporteAgendaLinhasPorId_(new FakeSheet('Agenda', [['ID']]))).length, 0);
});

test('monitor reconhece caixa e espacos, filtra AgendaId e registra contagens', () => {
  const { server, agenda, logs } = monitorFixture();
  assert.equal(server.transporteMonitorarEnviosPorEmail_('OUTRO').verificados, 0);
  assert.equal(agenda.rows[1][2], 'Não Agendado');
  const result = server.transporteMonitorarEnviosPorEmail_('EVT-TEST');
  assert.equal(result.enviados, 1);
  assert.equal(result.diagnostico.mensagensComReferencia, 1);
  assert.equal(result.diagnostico.threads, 1);
  assert.equal(agenda.rows[1][2], 'Agendado');
  assert.ok(logs.some(text => text.includes('mensagensComReferencia')));
});

test('referencia exige identidade inteira e slot exato', () => {
  const { server } = monitorFixture();
  for (const text of ['IPS-TRP-EVT-TEST-T10', 'IPS-TRP-EVT-TEST-T2', 'XIPS-TRP-EVT-TEST-T1', 'IPS-TRP-EVT-TEST-T1-extra']) {
    assert.equal(server.transporteMonitorContemReferencia_(text, 'IPS-TRP-EVT-TEST-T1'), false, text);
  }
  assert.equal(server.transporteMonitorContemReferencia_('[ips - trp - evt-test - t1]', 'IPS-TRP-EVT-TEST-T1'), true);
});

test('rascunho em conversa retornada pelo Gmail nao comprova envio', () => {
  const { server, agenda } = monitorFixture({ draft: true });
  const result = server.transporteMonitorarEnviosPorEmail_();
  assert.equal(result.enviados, 0);
  assert.equal(result.diagnostico.mensagensComReferencia, 0);
  assert.match(result.diagnostico.recusas[0].motivo, /não encontrada/);
  assert.equal(agenda.rows[1][2], 'Não Agendado');
});

test('monitor pagina Gmail e encontra referencia alem dos primeiros 100 resultados', () => {
  const { server, message } = monitorFixture();
  const offsets = [];
  server.GmailApp.search = (_query, offset, limit) => {
    offsets.push(offset); assert.equal(limit, 100);
    return offset === 0 ? Array.from({ length: 100 }, () => ({ getMessages: () => [] })) : [{ getMessages: () => [message] }];
  };
  const result = server.transporteMonitorarEnviosPorEmail_();
  assert.equal(result.enviados, 1);
  assert.deepEqual(offsets, [0, 100]);
});

test('recupera operacao DHL concluida anteriormente sem anexo e status ainda pendente', () => {
  const { server, agenda } = monitorFixture();
  const old = new Date(Date.now() - 60000);
  server.book.getSheetByName('Transporte_Operacoes').getRange(2, 12, 1, 5).setValues([[old, old, 'ANTIGA', 0, old]]);
  assert.equal(server.transporteMonitorarEnviosPorEmail_().enviados, 1);
  assert.equal(agenda.rows[1][2], 'Agendado');
});

test('diagnostico explica anexos ausentes, divergencia e status incompatível', () => {
  for (const scenario of [
    { courier: 'OCASA', motivo: /Anexos ausentes/ },
    { status: 'Confirmado', motivo: /Status atual/ },
    { diverge: true, motivo: /Courier da Agenda diverge/ }
  ]) {
    const { server, agenda } = monitorFixture(scenario);
    if (scenario.diverge) agenda.rows[1][1] = 'MARKEN';
    const result = server.transporteMonitorarEnviosPorEmail_();
    assert.equal(result.enviados, 0);
    assert.ok(result.diagnostico.recusas.some(item => scenario.motivo.test(item.motivo)));
  }
});

test('mensagem posterior sem anexo nao oculta envio anterior com documentos', () => {
  const { server, message } = monitorFixture({ courier: 'OCASA', attachments: [{}] });
  const reply = { ...message, getDate: () => new Date(Date.now() + 120000), getAttachments: () => [], getId: () => 'RESPOSTA' };
  server.GmailApp.search = () => [{ getMessages: () => [message, reply] }];
  const result = server.transporteMonitorarEnviosPorEmail_();
  assert.equal(result.enviados, 1);
  assert.equal(result.itens[0].messageId, 'MSG-TEST');
});

test('diagnostico manual exige administrador e restringe a execucao ao AgendaId', () => {
  const server = runFile('WebApp.gs');
  let reads = 0;
  server.codexAssertAdmin_ = () => { throw new Error('NEGADO'); };
  server.getAgendaSheetForRead_ = () => { reads++; return {}; };
  assert.throws(() => server.testarMonitorConfirmacaoManual('EVT-TEST'), /NEGADO/);
  assert.equal(reads, 0);
  server.codexAssertAdmin_ = () => {};
  assert.throws(() => server.testarMonitorConfirmacaoManual(''), /Informe o AgendaId/);
  server.encontrarLinhaPorId = () => 2;
  const row = [];
  row[server.AGENDA_CFG.idx.cb.nome] = 'MARKEN';
  server.getAgendaSheetForRead_ = () => ({ getRange: () => ({ getValues: () => [row] }) });
  server.transporteMonitorarEnviosPorEmail_ = id => { assert.equal(id, 'EVT-TEST'); return { verificados: 1 }; };
  server.Logger = { log() {} };
  const result = server.testarMonitorConfirmacaoManual('EVT-TEST');
  assert.match(result.avisos[0].motivo, /Backup/);
});
