'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');
const { fakeDocumentLock } = require('./helpers/fake-document-lock');

const HEADERS = ['ID', 'Nome', 'Especialidade', 'CPF', 'CREMERS', 'Telefone', 'Email'];
const RECORD = ['MED-1', 'Médico anterior', 'Cardiologia', '00123456789', '0123', '00551199999999', 'medico@example.invalid'];

function fixture(rows = [HEADERS, RECORD], context = {}) {
  const sheet = rows === null ? null : new FakeSheet('🩺 Médicos', rows);
  const lock = fakeDocumentLock();
  const server = runFile('WebApp.gs', { LockService: lock.LockService, ...context });
  const ss = new FakeSpreadsheet(sheet ? { '🩺 Médicos': sheet } : {});
  server.getCodexSpreadsheet_ = () => {
    assert.equal(lock.state.held, true, 'fonte lida dentro do lock');
    return ss;
  };
  server.codexAssertCanWrite_ = () => { assert.equal(lock.state.held, true, 'autorização após espera'); };
  server.getConfigValues_ = () => ['Cardiologia'];
  const invalidations = [];
  server.clearCodexRuntimeCaches_ = parts => invalidations.push(Array.from(parts));
  if (sheet) {
    const getRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...args) => {
      assert.equal(lock.state.held, true);
      if (args[2] !== undefined) assert.ok(args[2] > 0, 'range deve ter ao menos uma linha');
      const range = getRange(...args);
      const setValues = range.setValues.bind(range);
      range.setValues = values => {
        assert.equal(lock.state.held, true);
        for (const column of [4, 6]) {
          if (column >= args[1] && column < args[1] + (args[3] || 1)) {
            assert.ok(sheet.numberFormats.some(format => format.row === args[0] && format.column === column && format.format === '@'),
              'CPF/telefone formatados como texto antes de gravar');
            assert.equal(typeof values[0][column - args[1]], 'string');
          }
        }
        return setValues(values);
      };
      return range;
    };
  }
  return { server, sheet, lock: lock.state, invalidations };
}

test('edição/exclusão sem registros e aba ausente retornam erro de negócio sem gravação', () => {
  for (const rows of [[], [HEADERS], null]) {
    const { server, sheet, lock, invalidations } = fixture(rows);
    const expected = rows === null ? /Aba.*não encontrada/ : /não encontrado/;
    assert.throws(() => server.salvarDadosMedico({ id: 'MED-1', especialidade: 'Cardiologia' }), expected);
    assert.throws(() => server.excluirMedico('MED-1'), expected);
    assert.equal(sheet ? sheet.writes : 0, 0);
    assert.deepEqual(invalidations, []);
    assert.equal(lock.released, 2);
  }
});

test('cadastro novo na aba só com cabeçalho grava uma linha e preserva zeros de CPF e telefone', () => {
  const { server, sheet, invalidations } = fixture([HEADERS]);
  assert.match(server.salvarDadosMedico({ nome: 'Novo médico', especialidade: 'Cardiologia', cpf: '00123456789', telefone: '00551199999999' }), /cadastrado/);
  assert.equal(sheet.writes, 1);
  assert.match(sheet.rows[1][0], /^MED-\d+$/);
  assert.deepEqual(sheet.rows[1].slice(1), ['Novo médico', 'Cardiologia', '00123456789', '', '00551199999999', '']);
  assert.deepEqual(invalidations, [['medicos']]);
});

test('edição grava B:G em uma única escrita, preserva ID e campos opcionais omitidos', () => {
  const { server, sheet, invalidations } = fixture();
  assert.match(server.salvarDadosMedico({ id: 'MED-1', nome: 'Atualizado', especialidade: 'Cardiologia' }), /atualizado/);
  assert.equal(sheet.writes, 1);
  assert.deepEqual(sheet.rows[1], ['MED-1', 'Atualizado', ...RECORD.slice(2)]);
  assert.deepEqual(invalidations, [['medicos']]);
});

test('valores numéricos viram texto sem inventar zeros e campos explicitamente vazios são limpos', () => {
  const { server, sheet } = fixture();
  server.salvarDadosMedico({ id: 'MED-1', especialidade: 'Cardiologia', cpf: 123456789, telefone: 0, email: '', cremers: null });
  assert.equal(sheet.rows[1][3], '123456789');
  assert.equal(sheet.rows[1][5], '0');
  assert.equal(sheet.rows[1][4], '');
  assert.equal(sheet.rows[1][6], '');
});

for (const operation of ['save', 'delete']) {
  const execute = server => operation === 'save'
    ? server.salvarDadosMedico({ id: 'MED-1', nome: 'Atualizado', especialidade: 'Cardiologia' })
    : server.excluirMedico('MED-1');

  test(operation + ' localiza ID após espera pelo lock, mesmo com linha deslocada', () => {
    const other = ['MED-2', 'Outro médico', 'Cardiologia', '', '', '', ''];
    const { server, sheet, lock, invalidations } = fixture([HEADERS, RECORD, other]);
    lock.onAcquire = () => { [sheet.rows[1], sheet.rows[2]] = [sheet.rows[2], sheet.rows[1]]; };
    execute(server);
    assert.deepEqual(sheet.rows[1], other);
    if (operation === 'save') {
      assert.equal(sheet.rows[2][0], 'MED-1');
      assert.equal(sheet.rows[2][1], 'Atualizado');
    } else assert.equal(sheet.rows.length, 2);
    assert.equal(lock.acquired, 1);
    assert.equal(lock.released, 1);
    assert.deepEqual(invalidations, [['medicos']]);
  });

  test(operation + ' bloqueia sem lock ou com acesso revogado e sempre libera o lock adquirido', () => {
    const { server, sheet, lock, invalidations } = fixture();
    lock.available = false;
    assert.throws(() => execute(server), /Outra operação está gravando/);
    lock.available = true;
    lock.onAcquire = () => { server.codexAssertCanWrite_ = () => { throw new Error('Acesso revogado'); }; };
    assert.throws(() => execute(server), /Acesso revogado/);
    assert.equal(sheet.writes, 0);
    assert.deepEqual(sheet.rows[1], RECORD);
    assert.deepEqual(invalidations, []);
    assert.equal(lock.released, 1);
    assert.equal(lock.held, false);
  });
}

test('especialidade inválida, payload ausente e IDs inexistentes não causam escrita ou formatação', () => {
  const { server, sheet } = fixture();
  assert.throws(() => server.salvarDadosMedico(), /especialidade ativa/);
  assert.throws(() => server.salvarDadosMedico({ id: 'MED-1', especialidade: 'Inválida' }), /especialidade ativa/);
  assert.throws(() => server.salvarDadosMedico({ id: 'MED-9', especialidade: 'Cardiologia' }), /não encontrado/);
  for (const id of [undefined, null, '', 'MED-9']) assert.throws(() => server.excluirMedico(id), /não encontrado/);
  assert.equal(sheet.writes, 0);
  assert.deepEqual(sheet.numberFormats, []);
});

test('cadastros sequenciais no mesmo milissegundo não duplicam IDs', () => {
  class FixedDate extends Date { static now() { return 123; } }
  const { server, sheet } = fixture([HEADERS], { Date: FixedDate });
  server.salvarDadosMedico({ nome: 'Um', especialidade: 'Cardiologia' });
  server.salvarDadosMedico({ nome: 'Dois', especialidade: 'Cardiologia' });
  assert.deepEqual(sheet.rows.slice(1).map(row => row[0]), ['MED-123', 'MED-124']);
});
