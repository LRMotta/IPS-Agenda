'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

function fixture() {
  const calls = { spreadsheet: 0, sheets: {} };
  const data = {
    Estoque: [['KIT-1', 'Projeto', 'Kit', 'Laboratorio', '', 'IPS', 2, '', 'Disponivel']],
    Transporte_Operacoes: [['EVENT-1', '1', '', 'Courier', '', '', 'PDF-1']],
    Courier_Lembretes: [['EVENT-1:1', 'EVENT-1', '1', '', '', 'REVISAO', '', '', '', 'Revisar envio']]
  };
  const spreadsheet = { getSheetByName(name) {
    const rows = data[name];
    if (!rows) return null;
    const count = calls.sheets[name] || (calls.sheets[name] = { lastRow: 0, reads: 0, ranges: [] });
    return {
      getLastRow() { count.lastRow++; return rows.length + 1; },
      getLastColumn() { return name === 'Transporte_Operacoes' ? 17 : rows[0].length; },
      getRange(...range) {
        count.ranges.push(range);
        return { getValues() { count.reads++; return rows; } };
      }
    };
  } };
  const server = runFiles(['WebApp.gs', 'TransporteCodexConfig.gs', 'CourierLembretes.gs'], {
    SpreadsheetApp: { getActiveSpreadsheet() { calls.spreadsheet++; return spreadsheet; } },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  server.codexReadValuesMeasured_ = range => range.getValues();
  return { server, calls, data };
}

test('Pendencias reutiliza o handle da planilha e consulta a extensao de cada tabela uma unica vez', () => {
  const f = fixture();
  // A autorizacao ja abriu a planilha nesta execucao; nenhum dado de tabela e cacheado.
  f.server.getCodexSpreadsheet_();
  const stock = f.server.getEstoqueResumoParaPendencias_();
  const operations = f.server.transporteOperacoesRows_();
  const pending = [{ agendaId: 'EVENT-1', slot: 'Transporte I' }];
  f.server.courierLembreteAnotarPendencias_(pending);
  assert.equal(f.calls.spreadsheet, 1);
  assert.equal(stock[0].idItem, 'KIT-1');
  assert.equal(stock[0].qtde, 2);
  assert.equal(operations[0].agendaId, 'EVENT-1');
  assert.equal(operations[0].pdfId, 'PDF-1');
  assert.equal(pending[0].lembreteStatus, 'Revisar envio');
  for (const count of Object.values(f.calls.sheets)) {
    assert.equal(count.lastRow, 1);
    assert.equal(count.reads, 1);
  }
  assert.deepEqual(f.calls.sheets.Estoque.ranges, [[2, 1, 1, 9]]);
  assert.deepEqual(f.calls.sheets.Transporte_Operacoes.ranges, [[2, 1, 1, 17]]);
  assert.deepEqual(f.calls.sheets.Courier_Lembretes.ranges, [[2, 1, 1, 10]]);
  // Releitura deve continuar fresca, mesmo dentro da mesma execucao.
  f.data.Estoque[0][6] = 3;
  assert.equal(f.server.getEstoqueResumoParaPendencias_()[0].qtde, 3);
  assert.equal(f.calls.sheets.Estoque.reads, 2);
});

test('Pendencias sem cobrancas a anotar nao acessa a planilha de lembretes', () => {
  const f = fixture();
  f.server.courierLembreteAnotarPendencias_([]);
  f.server.courierLembreteAnotarPendencias_(null);
  assert.equal(f.calls.spreadsheet, 0);
  assert.deepEqual(f.calls.sheets, {});
});

test('tabelas vazias continuam retornando listas vazias sem tentar ler intervalos', () => {
  const f = fixture();
  Object.values(f.data).forEach(rows => { rows.length = 0; });
  assert.equal(f.server.getEstoqueResumoParaPendencias_().length, 0);
  assert.equal(f.server.transporteOperacoesRows_().length, 0);
  assert.equal(f.server.courierLembreteRows_().length, 0);
  for (const count of Object.values(f.calls.sheets)) {
    assert.equal(count.lastRow, 1);
    assert.equal(count.reads, 0);
    assert.equal(count.ranges.length, 0);
  }
});
