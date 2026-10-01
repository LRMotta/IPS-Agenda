'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, runHtmlScript } = require('./helpers/load-app-script');
const { createAgendaRulesCore } = require('../tools/agenda-rules-core');

function bothRules() {
  return [runFile('AgendaServerRules.gs').AgendaServerRules_, runHtmlScript('SharedAgendaRules.html').AgendaRules, createAgendaRulesCore()];
}

test('requisicoes exigem confirmacao explicita, sem inferir envio de texto ambiguo', () => {
  const pending = [
    'Requisição não enviada', 'Requisição será enviada amanhã',
    'Requisição pendente; transporte enviado', 'Requisição pendente; transporte OK',
    'Requisição enviada?', 'Confirmar se a requisição foi enviada',
    'Requisição enviada anteriormente; requisição não enviada hoje',
    'Requisição enviada; não enviada', 'Requisição enviada ou pendente',
    'Requisição enviada se o prestador confirmar', 'Requisição sem envio',
    'Requisição enviada amanhã', 'Requisição', 'Transporte enviado', '', null
  ];
  bothRules().forEach((rules) => pending.forEach((obs) => {
    assert.equal(rules.requestObservationIndicatesSent(obs), false, String(obs));
    assert.equal(rules.requestIsSent('', obs), false, String(obs));
  }));
});

test('confirmacoes legadas explicitas e status com data continuam reconhecidos', () => {
  const sent = ['Requisição enviada', 'REQUISIÇÃO OK', 'Req OK', 'Req. enviada',
    'A requisição foi enviada', 'Requisição já foi enviada',
    'Requisição: enviada', 'Requisição Enviada - 01/out/2026 09:30',
    'Requisição Enviada - 01/out./2026 09:30',
    'Requisição enviada em 01/10/2026', 'Transporte pendente; requisição enviada'];
  bothRules().forEach((rules) => {
    sent.forEach((obs) => assert.equal(rules.requestIsSent('', obs), true, obs));
    ['Enviado', 'Enviada', 'Requisição Enviada - 01/out./2026 09:30'].forEach((status) => {
      assert.equal(rules.requestIsSent(status, ''), true, status);
    });
  });
});

test('status explicito prevalece sobre observacao legada de envio', () => {
  bothRules().forEach((rules) => {
    ['Pendente', 'Não enviada', 'Não enviado', 'Será enviada', 'Cancelada'].forEach((status) => {
      assert.equal(rules.requestIsSent(status, 'Requisição OK'), false, status);
    });
    assert.equal(rules.requestIsSent('Enviado', 'Requisição pendente'), true);
    assert.equal(rules.requestIsSent('   ', 'Requisição OK'), true);
  });
  const client = bothRules()[1];
  assert.equal(client.requestIsSent({ statusRequisicao: 'Pendente', obs: 'Requisição OK' }), false);
  assert.equal(client.requestIsSent({ statusRequisicao: '', obs: 'Req. OK' }), true);
});

test('negacao de transporte ou amostras nao invalida confirmacao explicita da requisicao', () => {
  const sent = ['Requisição enviada; transporte não enviado',
    'Requisição OK. Amostras ainda não enviadas',
    'Transporte não enviado; requisição enviada',
    'Requisição enviada; o courier ainda não enviado',
    'Requisição enviada; a coleta não enviada'];
  bothRules().forEach((rules) => sent.forEach((obs) => {
    assert.equal(rules.requestObservationIndicatesSent(obs), true, obs);
    assert.equal(rules.requestIsSent('', obs), true, obs);
  }));
  bothRules().forEach((rules) => {
    ['Requisição enviada; não enviada', 'Requisição enviada; ela não foi enviada',
      'Transporte enviado; requisição não enviada',
      'Requisição enviada; transporte pendente e requisição não enviada'].forEach((obs) => {
      assert.equal(rules.requestIsSent('', obs), false, obs);
    });
  });
});

test('alinhamento legado nao grava envio para negacao, previsao ou transporte', () => {
  const server = runFile('WebApp.gs', { AgendaServerRules_: bothRules()[0] });
  server.codexCacheGet_ = () => null;
  server.codexCachePut_ = () => {};
  const cfg = server.AGENDA_CFG;
  const observations = ['Requisição não enviada', 'Requisição será enviada amanhã',
    'Requisição pendente; transporte enviado', 'Requisição OK', 'Requisição enviada'];
  const rows = observations.map((obs, index) => {
    const row = Array(cfg.lastCol).fill('');
    row[cfg.idx.servTerc] = 'Prestador';
    row[cfg.idx.obs] = obs;
    row[cfg.idx.reqStatus] = index === 4 ? 'Pendente' : '';
    return row;
  });
  const reads = [];
  const writes = [];
  const sheet = {
    getLastRow: () => rows.length + 1,
    getRangeList(ranges) {
      return { setValue(value) { writes.push({ ranges: Array.from(ranges), value }); } };
    },
    getRange(row, col, count, width) {
      return {
        getValues() {
          reads.push({ row, col, count, width });
          return rows.map((values) => values.slice());
        },
        setValue(value) { writes.push({ row, col, value }); }
      };
    }
  };
  server.alinharStatusRequisicaoLegadoAgenda_(sheet);
  assert.deepEqual(reads, [{ row: 2, col: 1, count: rows.length, width: cfg.lastCol }]);
  assert.deepEqual(writes, [{ ranges: ['R5C' + cfg.col.reqStatus], value: 'Requisição Enviada' }]);
  observations.slice(0, 3).forEach((obs) => {
    assert.equal(server.agendaStatusRequisicaoDisplay_('', obs), '');
  });
  assert.equal(server.agendaStatusRequisicaoDisplay_('', 'Req OK'), 'Requisição Enviada');
  assert.equal(server.agendaRequisicaoEnviada_('Pendente', 'Requisição OK'), false);
});
