'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/agenda-merge-fixture');

function setup() {
  const f = fixture();
  f.c.codexLogPerformance_ = () => {};
  f.c.agendaEmailEnabled_ = () => false;
  f.c.agendaInfoParticipanteParaSalvar_ = () => null;
  return f;
}

for (const method of ['salvarNovoEventoCompleto', 'salvarNovoEventoComFeriado', 'atualizarAgendaEventoCompleto']) {
  test(method + ' rejeita Visita vazia ou com espacos antes de qualquer escrita', () => {
    for (const visita of [undefined, '', ' \t ']) {
      for (const labCentral of ['Não', 'Sim', 'Não aplicável']) {
        const { c, sheet, payload, audits } = setup();
        Object.assign(payload, { visita, labCentral });
        const before = JSON.stringify(sheet.rows);
        const result = c[method](payload);
        assert.equal(result.erro, 'Informe a visita para eventos do tipo Visita.');
        assert.equal(sheet.writes, 0);
        assert.equal(JSON.stringify(sheet.rows), before);
        assert.equal(audits.length, 0);
      }
    }
  });

  test(method + ' aceita visita livre sem calendario SoA e sem Lab Central', () => {
    const { c, i, sheet, payload } = setup();
    Object.assign(payload, { visita: 'Triagem livre', labCentral: 'Não', servTerc: '', courier1: {}, courier2: {}, courier3: {}, backup: {} });
    assert.equal(c[method](payload).ok, true);
    const row = method === 'atualizarAgendaEventoCompleto' ? 1 : 2;
    assert.equal(sheet.rows[row][i.visita], 'Triagem livre');
  });
}

test('edicao exige Visita ao converter outro tipo e permite corrigir registro legado vazio', () => {
  for (const previousType of ['Consulta', 'Visita']) {
    const { c, i, sheet, payload } = setup();
    sheet.rows[1][i.tipo] = previousType;
    sheet.rows[1][i.visita] = '';
    sheet.rows[1][i.labCentral] = 'Não';
    delete payload._recordVersion;
    Object.assign(payload, { visita: '', labCentral: 'Não' });
    assert.match(c.atualizarAgendaEventoCompleto(payload).erro, /Informe a visita/);
    assert.equal(sheet.writes, 0);
    payload.visita = 'V2';
    assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true);
    assert.equal(sheet.rows[1][i.visita], 'V2');
  }
});

test('outros tipos preservam visita opcional e a exigencia anterior de Lab Central = Sim', () => {
  for (const tipo of ['Consulta', 'Envio de amostras', 'Contato telefônico']) {
    const { c, i, sheet, payload } = setup();
    Object.assign(payload, { tipo, visita: '', labCentral: 'Não' });
    assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true, tipo);
    assert.equal(sheet.rows[1][i.visita], '');
  }
  const { c, sheet, payload } = setup();
  Object.assign(payload, { tipo: 'Envio de amostras', visita: '', labCentral: 'Sim' });
  assert.match(c.atualizarAgendaEventoCompleto(payload).erro, /Laboratorio Central = Sim/);
  assert.equal(sheet.writes, 0);
});

for (const method of ['salvarNovoEventoCompleto', 'salvarNovoEventoComFeriado', 'atualizarAgendaEventoCompleto']) {
  test(method + ' rejeita Visita sem participante cadastrado antes de qualquer escrita', () => {
    const casos = [
      { participante: '', participanteCadastroId: '' },
      { participante: '  ', participanteCadastroId: undefined },
      // Referencia provisoria que a interface monta para eventos sem participante.
      { participante: 'legacy-event:4fac5fdb', participanteCadastroId: '' }
    ];
    for (const caso of casos) {
      const { c, sheet, payload, audits } = setup();
      Object.assign(payload, caso, { visita: 'C1', labCentral: 'Não' });
      const before = JSON.stringify(sheet.rows);
      const result = c[method](payload);
      assert.equal(result.erro, 'Selecione o participante cadastrado para eventos do tipo Visita.');
      assert.equal(sheet.writes, 0);
      assert.equal(JSON.stringify(sheet.rows), before);
      assert.equal(audits.length, 0);
    }
  });
}

test('somente Visita exige participante; demais tipos preservam participante opcional', () => {
  const { c } = setup();
  assert.equal(c.AgendaServerRules_.formPolicy('Visita').requiresParticipant, true);
  for (const tipo of ['Consulta', 'Envio de amostras', 'Contato telefônico', 'Monitoria', 'Reunião']) {
    assert.equal(c.AgendaServerRules_.formPolicy(tipo).requiresParticipant, false, tipo);
  }
  for (const tipo of ['Consulta', 'Envio de amostras']) {
    const { c: ctx, payload } = setup();
    Object.assign(payload, { tipo, participante: '', participanteCadastroId: '', visita: '', labCentral: 'Não' });
    assert.equal(ctx.atualizarAgendaEventoCompleto(payload).ok, true, tipo);
  }
});

test('formulario da Agenda exige participante real na Visita', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const client = fs.readFileSync(path.join(__dirname, '..', 'IndexAgendaScripts.html'), 'utf8');
  const markup = fs.readFileSync(path.join(__dirname, '..', 'IndexContentAfterDashboard.html'), 'utf8');
  assert.match(client, /\{ id: 'agParticipante', err: 'errAgParticipante', label: 'participante', required: !!policy\.requiresParticipant \}/);
  assert.match(client, /check\.id === 'agParticipante' && \/\^legacy-event:\/i\.test\(valor\)\) return true/);
  assert.match(client, /\^ag\(Data\|DataFim\|Hora\|Tipo\|Participante\|Visita/);
  assert.match(markup, /id="agParticipanteRequired"/);
  assert.match(markup, /id="errAgParticipante"/);
});
