'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fakeSheet(name, values) {
  const calls = { reads: [], rangeLists: [], cellWrites: 0 };
  const width = values.reduce((max, row) => Math.max(max, row.length), 0);
  const sheet = {
    calls,
    values,
    getName: () => name,
    getLastRow: () => values.length,
    getLastColumn: () => width,
    getDataRange: () => { throw new Error('nao deve ler a aba inteira sem conferir o cabecalho'); },
    getRange(row, col, numRows, numCols) {
      return {
        getValues() {
          calls.reads.push([row, col, numRows || 1, numCols || 1]);
          return values.slice(row - 1, row - 1 + (numRows || 1)).map(r => {
            const out = [];
            for (let c = 0; c < (numCols || 1); c++) out.push(r[col - 1 + c] === undefined ? '' : r[col - 1 + c]);
            return out;
          });
        },
        setValue(value) {
          calls.cellWrites++;
          values[row - 1][col - 1] = value;
        }
      };
    },
    getRangeList(a1s) {
      return {
        setValue(value) {
          calls.rangeLists.push(Array.from(a1s));
          a1s.forEach(a1 => {
            const m = /^([A-Z]+)(\d+)$/.exec(a1);
            const col = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
            const row = Number(m[2]);
            while (values[row - 1].length < col) values[row - 1].push('');
            values[row - 1][col - 1] = value;
          });
        }
      };
    }
  };
  return sheet;
}

function server() {
  return runFile('WebApp.gs', {});
}

test('sincronizacao de referencias le so o cabecalho de abas sem colunas de participante', () => {
  const app = server();
  const auditRows = [['Audit ID', 'Record ID', 'Campo', 'Valor novo']];
  for (let i = 0; i < 500; i++) auditRows.push(['AUD-' + i, '7', 'Nome', 'Ana']);
  const audit = fakeSheet('Audit_Changes', auditRows);
  const agenda = fakeSheet('Agenda', [
    ['Data', 'Participante', 'ID Participante', 'Projeto', 'ID Cadastro Participante'],
    ['2026-11-01', 'Ana', 'CPF-1', 'P1', '7'],
    ['2026-11-02', 'Bruno', 'B-1', 'P1', '8'],
    ['2026-11-03', 'Ana', 'CPF-1', 'P1', ''],
    ['2026-11-04', 'Ana', 'CPF-1', 'P1', '7']
  ]);
  const participantes = fakeSheet('Participantes', [['ID', 'Nome']]);
  const ss = { getSheets: () => [participantes, audit, agenda] };

  const result = app.sincronizarNomeParticipanteReferencias_(ss,
    { idCadastro: '7', nome: 'Ana', idParticipante: 'CPF-1', projeto: 'P1' },
    { idCadastro: '7', nome: 'Ana Souza', idParticipante: '1001', projeto: 'P1' });

  // Auditoria: somente o cabeçalho (10 linhas) foi lido.
  assert.deepEqual(audit.calls.reads, [[1, 1, 10, 4]]);
  assert.equal(participantes.calls.reads.length, 0);
  assert.equal(result.atualizadas, 3);
  assert.deepEqual(Array.from(result.abas), ['Agenda']);
  assert.equal(result.leituras, 2);

  // Uma escrita por coluna, sem chamadas célula a célula.
  assert.equal(agenda.calls.cellWrites, 0);
  assert.deepEqual(agenda.calls.rangeLists, [['B2', 'B4', 'B5'], ['C2', 'C4', 'C5'], ['E2', 'E4', 'E5']]);
  assert.deepEqual(agenda.values[1].slice(1), ['Ana Souza', '1001', 'P1', '7']);
  assert.deepEqual(agenda.values[2].slice(1), ['Bruno', 'B-1', 'P1', '8']);
  assert.deepEqual(agenda.values[3].slice(1), ['Ana Souza', '1001', 'P1', '7']);
});

test('sincronizacao cria coluna de cadastro quando ausente e aceita aba pequena', () => {
  const app = server();
  const sheet = fakeSheet('Transporte', [
    ['Paciente', 'Protocolo'],
    ['Ana', 'P1']
  ]);
  const result = app.sincronizarNomeParticipanteReferencias_({ getSheets: () => [sheet] },
    { idCadastro: '7', nome: 'Ana', idParticipante: '', projeto: 'P1' },
    { idCadastro: '7', nome: 'Ana Souza', idParticipante: '', projeto: 'P1' });
  assert.equal(result.atualizadas, 1);
  assert.equal(sheet.calls.reads.length, 1, 'aba com ate 10 linhas reaproveita a leitura do cabecalho');
  assert.equal(sheet.values[0][2], 'ID Cadastro Participante');
  assert.deepEqual(sheet.values[1], ['Ana Souza', 'P1', '7']);
});
