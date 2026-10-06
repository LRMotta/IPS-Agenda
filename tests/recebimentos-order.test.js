'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet } = require('./helpers/fake-spreadsheet');

for (const [rpc, key, sheetGetter, headersKey, idKey] of [
  ['getEquipamentosFornecidos', 'equipamentos', 'getEquipamentosSheet_', 'EQUIPAMENTOS_HEADERS_', 'idEquipamentoRec'],
  ['getMedicamentosRecebidos', 'medicamentos', 'getMedicamentosSheet_', 'MEDICAMENTOS_HEADERS_', 'idMedicamentoRec']
]) {
  test(rpc + ' ordena por recebimento decrescente e preserva referencias sem escrever', () => {
    const server = runFile('WebApp.gs', {
      Date,
      Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
      Utilities: {
        formatDate: (date, timezone, pattern) => {
          assert.equal(timezone, 'America/Sao_Paulo');
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
          }).formatToParts(date);
          const part = (type) => parts.find((item) => item.type === type).value;
          return pattern === 'yyyy-MM-dd'
            ? `${part('year')}-${part('month')}-${part('day')}`
            : `${part('day')}/${part('month')}/${part('year')}`;
        }
      }
    });
    const rows = [
      ['REC-1', new Date('2026-10-06T12:00:00Z'), 'Projeto A'],
      ['REC-2', new Date('2026-09-01T12:00:00Z'), 'Projeto A'],
      ['REC-3', '', 'Projeto A'],
      ['REC-4', new Date('2026-10-06T18:00:00Z'), 'Projeto A'],
      ['REC-5', 'data invalida', 'Projeto A'],
      ['REC-6', new Date('2025-12-31T12:00:00Z'), 'Projeto A'],
      ['REC-7', new Date('2026-10-07T01:00:00Z'), 'Projeto A']
    ];
    const sheet = new FakeSheet(key, [Array.from(server[headersKey]), ...rows]);
    const before = JSON.stringify(sheet.rows);
    server.codexAssertCanRead_ = () => {};
    server.getCodexSpreadsheet_ = () => ({});
    server[sheetGetter] = () => sheet;
    server.getProjetosEquipamentos_ = () => [];
    server.getSolicitantesEquipamentos_ = () => [];
    server.getEstoqueConfig = () => ({});

    const result = Array.from(server[rpc]()[key]);
    assert.deepEqual(result.map((item) => item[idKey]),
      ['REC-7', 'REC-4', 'REC-1', 'REC-2', 'REC-6', 'REC-5', 'REC-3']);
    for (const item of result) assert.equal(sheet.rows[item.rowIndex - 1][0], item[idKey]);
    assert.equal(result[0].dataRecebimentoISO, '2026-10-06');
    assert.equal(sheet.writes, 0);
    assert.equal(JSON.stringify(sheet.rows), before);
  });
}
