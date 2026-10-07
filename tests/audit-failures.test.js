'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture() {
  const logs = [];
  const fallback = [];
  const server = runFile('WebApp.gs', {
    Logger: { log: value => logs.push(value) },
    console: { error: value => fallback.push(value) }
  });
  server.codexGetActiveUserEmail_ = () => 'privado@example.invalid';
  server.codexGenerateAuditId_ = () => 'AUD-SIMULADO';
  return { server, logs, fallback };
}

const entries = [{ moduleName: 'Cadastro privado', action: 'Acao privada', recordId: 'ID-PRIVADO',
  changes: [{ field: 'CPF', oldValue: 'VALOR-ANTERIOR-PRIVADO', newValue: 'VALOR-NOVO-PRIVADO' }], note: 'NOTA-PRIVADA' }];

function diagnostic(logs, writer, stage) {
  assert.equal(logs.length, 1);
  const prefix = '[CODEX_AUDIT_FAILURE] ';
  assert.equal(logs[0].startsWith(prefix), true);
  const data = JSON.parse(logs[0].slice(prefix.length));
  assert.equal(data.writer, writer);
  assert.equal(data.stage, stage);
  assert.doesNotMatch(logs[0], /privado|PRIVADO|CPF|Acao privada|Cadastro privado/);
  return data;
}

test('Audit_Log ausente produz diagnóstico sem criar aba nem interromper operação', () => {
  const { server, logs } = fixture();
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: () => null });
  assert.doesNotThrow(() => server.codexWriteAuditLog_('Acao privada', 'Cadastro privado', 'ID-PRIVADO'));
  diagnostic(logs, 'codexWriteAuditLog_', 'missing_Audit_Log');
});

test('falhas de abertura, preparação e append do log registram etapa e erro sem dados pessoais', () => {
  for (const stage of ['open_sheet', 'prepare_row', 'append_row']) {
    const { server, logs } = fixture();
    const error = new TypeError('Access denied privado@example.invalid CPF VALOR-NOVO-PRIVADO');
    server.getCodexSpreadsheet_ = () => {
      if (stage === 'open_sheet') throw error;
      return { getSheetByName: () => ({ appendRow: () => { if (stage === 'append_row') throw error; } }) };
    };
    if (stage === 'prepare_row') server.codexGenerateAuditId_ = () => { throw error; };
    assert.doesNotThrow(() => server.codexWriteAuditLog_('Acao privada', 'Cadastro privado', 'ID-PRIVADO'));
    const data = diagnostic(logs, 'codexWriteAuditLog_', stage);
    assert.equal(data.errorType, 'TypeError');
    assert.equal(data.reason, 'permission');
  }
});

test('falhas de preparação, abertura e escrita do lote ficam visíveis sem dados auditados', () => {
  for (const stage of ['prepare_rows', 'open_sheet', 'write_rows']) {
    const { server, logs } = fixture();
    const error = new Error('Quota exceeded NOTA-PRIVADA VALOR-ANTERIOR-PRIVADO');
    if (stage === 'prepare_rows') server.codexGenerateAuditId_ = () => { throw error; };
    server.codexGetAuditChangesSheet_ = () => {
      if (stage === 'open_sheet') throw error;
      return { getLastRow: () => 1, getRange: () => ({ setValues: () => { throw error; } }) };
    };
    assert.doesNotThrow(() => server.codexWriteAuditChangesBatch_(entries));
    const data = diagnostic(logs, 'codexWriteAuditChangesBatch_', stage);
    assert.equal(data.reason, 'quota');
  }
});

test('lote Audit_Log preserva diagnóstico sanitizado e não interrompe operação em falhas', () => {
  for (const stage of ['open_sheet', 'missing_Audit_Log', 'prepare_rows', 'write_rows']) {
    const { server, logs } = fixture();
    const error = new Error('Quota exceeded ID-PRIVADO privado@example.invalid');
    server.getCodexSpreadsheet_ = () => {
      if (stage === 'open_sheet') throw error;
      return { getSheetByName: () => stage === 'missing_Audit_Log' ? null : {
        getLastRow: () => 1, getRange: () => ({ setValues: () => { throw error; } })
      } };
    };
    if (stage === 'prepare_rows') server.codexGenerateAuditId_ = () => { throw error; };
    assert.doesNotThrow(() => server.codexWriteAuditLogBatch_(entries));
    diagnostic(logs, 'codexWriteAuditLogBatch_', stage);
  }
  const { server, logs } = fixture();
  server.getCodexSpreadsheet_ = () => { assert.fail('Lote vazio não deve abrir planilha'); };
  server.codexWriteAuditLogBatch_([]);
  assert.deepEqual(logs, []);
});

test('logs bem-sucedidos e lotes vazios ou sem diferenças não geram diagnóstico de falha', () => {
  const { server, logs } = fixture();
  let writes = 0;
  server.getCodexSpreadsheet_ = () => ({ getSheetByName: () => ({ appendRow: () => writes++ }) });
  server.codexGetAuditChangesSheet_ = () => ({ getLastRow: () => 1, getRange: () => ({ setValues: () => writes++ }) });
  server.codexWriteAuditLog_('Acao privada', 'Cadastro privado', 'ID-PRIVADO');
  server.codexWriteAuditChangesBatch_(entries);
  server.codexWriteAuditChangesBatch_([]);
  server.codexWriteAuditChangesBatch_([{ changes: [{ oldValue: 'igual', newValue: 'igual' }] }]);
  assert.equal(writes, 2);
  assert.equal(logs.length, 0);
});

test('falha do Logger usa console.error sem interromper o chamador ou expor a exceção', () => {
  const { server, fallback } = fixture();
  server.Logger.log = () => { throw new Error('Logger indisponivel'); };
  server.getCodexSpreadsheet_ = () => { throw new Error('Timeout ID-PRIVADO'); };
  assert.doesNotThrow(() => server.codexWriteAuditLog_());
  assert.equal(diagnostic(fallback, 'codexWriteAuditLog_', 'open_sheet').reason, 'timeout');
});
