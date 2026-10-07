'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture(values, maxRows) {
  const reads = [], selections = [];
  const sheet = values === null ? null : {
    getLastRow: () => values.length,
    getRange(row, column, numRows = 1, numColumns = 1) {
      assert.ok(numRows > 0, 'intervalo deve ter linhas');
      assert.ok(row + numRows - 1 <= maxRows, 'intervalo deve respeitar limite físico');
      assert.equal(column, 2);
      assert.equal(numColumns, 1);
      return {
        getValues() {
          reads.push({ row, numRows });
          return values.slice(row - 1, row - 1 + numRows).map(value => [value]);
        },
        activate() { selections.push(row); }
      };
    }
  };
  let authorized = false;
  const server = runFile('WebApp.gs', {
    Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName(name) { assert.equal(authorized, true); assert.equal(name, 'Agenda'); return sheet; },
      setActiveSheet(value) { assert.equal(value, sheet); }
    }) }
  });
  server.codexAssertCanWrite_ = () => { authorized = true; };
  return { server, reads, selections };
}

test('focarDataHoje não lê intervalo quando Agenda está ausente, vazia ou só com cabeçalho', () => {
  for (const values of [null, [], ['Data']]) {
    const { server, reads, selections } = fixture(values, 1);
    server.focarDataHoje();
    assert.deepEqual(reads, []);
    assert.deepEqual(selections, []);
  }
});

test('focarDataHoje lê até a última linha física e seleciona primeira data a partir de hoje', () => {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const { server, reads, selections } = fixture(['Data', yesterday, today, tomorrow], 4);
  server.focarDataHoje();
  assert.deepEqual(reads, [{ row: 2, numRows: 3 }]);
  assert.deepEqual(selections, [3]);
});

test('focarDataHoje alcança registro na última linha e ignora células sem data', () => {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const { server, reads, selections } = fixture(['Data', '', 'não é data', tomorrow], 4);
  server.focarDataHoje();
  assert.deepEqual(reads, [{ row: 2, numRows: 3 }]);
  assert.deepEqual(selections, [4]);
});

test('focarDataHoje não seleciona registro quando todas as datas são passadas', () => {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const { server, selections } = fixture(['Data', yesterday], 2);
  server.focarDataHoje();
  assert.deepEqual(selections, []);
});
