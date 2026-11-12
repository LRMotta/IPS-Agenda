'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/agenda-merge-fixture');
const { runFile, runHtmlScript } = require('./helpers/load-app-script');

const BLOQUEADOS = ['Visita', 'Consulta', 'Exame de imagem', 'Exame laboratorial'];
const LIVRES = ['Envio de amostras', 'Contato telefônico', 'Reunião'];

function isoOffset(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function setup() {
  const f = fixture();
  f.c.codexLogPerformance_ = () => {};
  f.c.agendaEmailEnabled_ = () => false;
  f.c.agendaInfoParticipanteParaSalvar_ = () => null;
  // O fixture desliga a comparacao com hoje; aqui ela precisa ser real.
  f.c.agendaDateIsBeforeToday_ = valor => {
    const d = f.c.parseAgendaDateAny_(valor);
    if (!d || isNaN(d.getTime())) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return d.getTime() < hoje.getTime();
  };
  return f;
}

function payloadPara(payload, tipo, data) {
  return Object.assign(payload, {
    tipo, data, visita: 'V1', medico: 'Médico teste', servTerc: 'Prestador teste',
    labCentral: 'Não', courier1: {}, courier2: {}, courier3: {}, backup: {}, reagendamentoConfirmado: true
  });
}

test('regras compartilhadas marcam Visita, Consulta e Exames como sem data passada', () => {
  const server = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const client = runHtmlScript('SharedAgendaRules.html').AgendaRules;
  for (const tipo of BLOQUEADOS) {
    assert.equal(server.formPolicy(tipo).forbidsPastDate, true, tipo);
    assert.equal(client.formPolicy(tipo).forbidsPastDate, true, tipo);
  }
  for (const tipo of LIVRES.concat(['Monitoria', 'SIV', 'Auditoria'])) {
    assert.equal(server.formPolicy(tipo).forbidsPastDate, false, tipo);
    assert.equal(client.formPolicy(tipo).forbidsPastDate, false, tipo);
  }
});

for (const method of ['salvarNovoEventoCompleto', 'salvarNovoEventoComFeriado']) {
  test(method + ' rejeita Visita, Consulta e Exames em data passada antes de escrever', () => {
    for (const tipo of BLOQUEADOS) {
      const { c, sheet, payload, audits } = setup();
      payloadPara(payload, tipo, isoOffset(-365));
      const before = JSON.stringify(sheet.rows);
      const result = c[method](payload);
      assert.match(String(result.erro || ''), /data anterior a hoje.*Confira o dia e o ano/, tipo);
      assert.equal(sheet.writes, 0, tipo);
      assert.equal(JSON.stringify(sheet.rows), before, tipo);
      assert.equal(audits.length, 0, tipo);
    }
  });

  test(method + ' aceita hoje e datas futuras, e tipos livres no passado', () => {
    for (const [tipo, offset] of [['Visita', 0], ['Consulta', 30], ['Envio de amostras', -3], ['Contato telefônico', -3]]) {
      const { c, payload } = setup();
      payloadPara(payload, tipo, isoOffset(offset));
      // Requisicao de exame em data passada tem trava propria; fora do escopo aqui.
      if (offset < 0) payload.servTerc = '';
      const result = c[method](payload);
      assert.equal(result.ok, true, tipo + ' ' + offset + ': ' + result.erro);
    }
  });
}

test('edicao bloqueia reagendar Visita para data passada', () => {
  const { c, sheet, payload } = setup();
  payloadPara(payload, 'Visita', isoOffset(-2));
  const before = JSON.stringify(sheet.rows);
  assert.match(c.atualizarAgendaEventoCompleto(payload).erro, /data anterior a hoje/);
  assert.equal(sheet.writes, 0);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('edicao de evento ja passado sem trocar data nem tipo continua permitida', () => {
  const { c, i, sheet, payload } = setup();
  const passado = isoOffset(-5);
  sheet.rows[1][i.data] = c._parseDateHora(passado, '08:00');
  delete payload._recordVersion;
  payloadPara(payload, 'Visita', passado);
  payload.obs = 'Observacao corrigida depois da visita';
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.ok, true, result.erro);
});

test('edicao bloqueia converter evento passado para Visita', () => {
  const { c, i, sheet, payload } = setup();
  const passado = isoOffset(-5);
  sheet.rows[1][i.data] = c._parseDateHora(passado, '08:00');
  sheet.rows[1][i.tipo] = 'Envio de amostras';
  delete payload._recordVersion;
  payloadPara(payload, 'Visita', passado);
  assert.match(c.atualizarAgendaEventoCompleto(payload).erro, /data anterior a hoje/);
  assert.equal(sheet.writes, 0);
});
