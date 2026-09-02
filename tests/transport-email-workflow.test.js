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

test('monitor da copia com anexo promove somente status pendente para Agendado', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier'],
    ['Agendado', 'DHL', 'Pendente']
  ]);
  const audits = [];
  const messageDate = new Date(Date.now() + 2 * 60 * 1000);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1 },
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
    ['Status evento', 'Courier', 'Status courier'],
    ['Agendado', 'OCASA', 'Não Agendado']
  ]);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1 },
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

test('email com anexo continua elegivel para nova tentativa se a Agenda divergir', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier'],
    ['Agendado', 'MARKEN divergente', 'Pendente']
  ]);
  const messageDate = new Date(Date.now() + 2 * 60 * 1000);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1 },
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

test('monitor recupera operacao antiga concluida antes de promover a Agenda', () => {
  const rules = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const book = new FakeSpreadsheet({});
  const agenda = new FakeSheet('Agenda', [
    ['Status evento', 'Courier', 'Status courier'],
    ['Agendado', 'MARKEN', 'Pendente']
  ]);
  const messageDate = new Date(Date.now() + 2 * 60 * 1000);
  const server = transportServer({
    book,
    AgendaServerRules_: rules,
    AGENDA_CFG: {
      col: { status: 1 },
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
  assert.ok(
    generate.indexOf('salvarTransporteInterno_(options.payload') < generate.indexOf("'copy_export_drive'"),
    'o payload deve ser reaplicado antes da exportacao'
  );
});

test('salvar Transporte nao presume envio e o rascunho inclui referencia depois da assinatura', () => {
  const source = readProjectFile('TransporteCodexConfig.gs');
  assert.match(source, /var statusNovo = String\(payload\.statusCourier \|\| payload\.status \|\| ''\)/);
  assert.doesNotMatch(source, /payload\.statusCourier \|\| payload\.status \|\| 'Agendado'/);
  assert.match(source, /getGmailSignature\(\) \+ transporteMonitorRefHtml_\(refInterna\)/);
  assert.match(source, /in:anywhere -in:drafts newer_than:30d/);
});
