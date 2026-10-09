'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const message = 'Falta preencher o Nº de Identificação deste participante. Acesse Participantes, complete esse campo no cadastro e tente gerar os documentos novamente.';

for (const [file, name] of [['IndexCoreScripts.html', 'appErrorMessage'], ['TransporteApp.html', 'transportErrorMessage']]) {
  test(`${name} apresenta a orientação de cadastro sem prefixo técnico`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const block = source.match(new RegExp('^( *)function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\1\\}', 'm'));
    assert.ok(block);
    const context = vm.createContext({ appErrorRawText: error => error.message || String(error) });
    vm.runInContext(block[0], context);
    for (const error of [message, { message }, { message: 'Error: ' + message }]) {
      assert.equal(context[name](error), message);
    }
    assert.equal(context[name]({ message: 'Outro aviso.' }), 'Outro aviso.');
  });
}
