'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function sheet(values, notes) {
  return {
    values: { ...values }, notes: { ...notes },
    clearNotes() { this.notes = {}; },
    getRange(address) {
      const owner = this;
      return {
        clearContent() { delete owner.values[address]; return this; },
        clearNote() { delete owner.notes[address]; return this; }
      };
    }
  };
}

test('PDF remove notas de todas as abas temporarias preservando materiais e notas na origem', () => {
  const marker = '[CODEX_TRANSPORTE_MATERIAIS_V1]\n{"courier":"OCASA"}\n[/CODEX_TRANSPORTE_MATERIAIS_V1]';
  const source = sheet({ F30: 'Plasma', J21: '1x1,0' }, { F30: marker, A1: 'Nota manual' });
  const declaration = sheet(source.values, source.notes);
  const booking = sheet({ C15: 'Referencia interna', C10: 'OCASA' }, { C15: 'Vinculo Agenda' });
  const petition = sheet({ K35: 'Materiais' }, { K35: 'Materiais adicionais' });
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  const temporary = { getSheets: () => [booking, declaration, petition] };
  s.transporteCodexGetSheet_ = (ss, key) => {
    assert.equal(ss, temporary);
    return key === 'folhaAgendamento' ? booking : null;
  };

  s.transportePdfOcultarMetadadosInternos_(temporary);

  for (const item of temporary.getSheets()) assert.deepEqual(item.notes, {});
  assert.deepEqual(declaration.values, source.values);
  assert.deepEqual(booking.values, { C10: 'OCASA' });
  assert.equal(source.notes.F30, marker);
  assert.equal(source.notes.A1, 'Nota manual');
});

test('limpeza de notas funciona sem folha de agendamento e propaga falhas', () => {
  const s = runFile('TransporteCodexConfig.gs', { Logger: { log() {} } });
  s.transporteCodexGetSheet_ = () => null;
  const pinex = sheet({ A1: 'Formulario PINEX' }, { A1: 'Nota interna' });
  s.transportePdfOcultarMetadadosInternos_({ getSheets: () => [pinex] });
  assert.deepEqual(pinex.notes, {});
  assert.throws(() => s.transportePdfOcultarMetadadosInternos_({
    getSheets: () => [{ clearNotes() { throw new Error('Falha na limpeza'); } }]
  }), /Falha na limpeza/);
});
