'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, runHtmlScript } = require('./helpers/load-app-script');
const { createAgendaRulesCore } = require('../tools/agenda-rules-core');

function allRules() {
  return [createAgendaRulesCore(), runFile('AgendaServerRules.gs').AgendaServerRules_,
    runHtmlScript('SharedAgendaRules.html').AgendaRules];
}

test('aliases de courier mantem pendencia e elegibilidade sem promover status desconhecido', () => {
  allRules().forEach((rules) => {
    ['Não Agendado', 'naoagendado', 'Não-agendado', 'Não   agendado', 'Não agendada'].forEach((status) => {
      assert.equal(rules.courierNeedsSchedule(status, 'AWB123'), true, status);
      assert.equal(rules.courierCanReceiveConfirmation(status), true, status);
    });
    ['', 'Pendente', 'Agendada'].forEach((status) => assert.equal(rules.courierCanReceiveConfirmation(status), true, status));
    ['Status desconhecido', 'Cancelado', 'Não aplicável', 'Enviado', 'Entregue'].forEach((status) => {
      assert.equal(rules.courierCanReceiveConfirmation(status), false, status);
    });
    assert.equal(rules.courierNeedsSchedule('', 'AWB123'), false);
    assert.equal(rules.courierNeedsSchedule('', ''), true);
    assert.equal(rules.courierNeedsSchedule('Status desconhecido', ''), false);
  });
});

test('docs gerados identifica documentacao sem agendar nem confirmar courier', () => {
  allRules().forEach((rules) => {
    ['Docs gerados', 'docsgerados', 'Documentos gerados'].forEach((status) => {
      assert.equal(rules.courierStatusKey(status), 'docsgerados');
      assert.equal(rules.courierNeedsSchedule(status, 'AWB123'), false);
      assert.equal(rules.courierIsAwaitingConfirmation(status), false);
      assert.equal(rules.courierCanReceiveConfirmation(status), false);
      assert.equal(rules.courierStatusRequiresEventDate(status), false);
    });
    assert.equal(rules.courierStatusKey('Docs gerados; Enviado'), 'enviado');
    assert.equal(rules.courierStatusKey('Docs gerados; Entregue'), 'entregue');
  });
});

test('opcoes de courier incluem Docs gerados mesmo com configuracao legada', () => {
  const server = runFile('WebApp.gs');
  server.getConfigAppValuesByKeys_ = () => ['Não Agendado', 'Agendado', 'Confirmado'];
  assert.deepEqual(Array.from(server.getAgendaCourierStatuses_()), ['Não Agendado', 'Docs gerados', 'Agendado', 'Confirmado']);
  server.getConfigAppValuesByKeys_ = () => ['Não Agendado', 'Docs gerados', 'Agendado'];
  assert.equal(server.getAgendaCourierStatuses_().filter((value) => value === 'Docs gerados').length, 1);
});

test('entrega afirmada prevalece sobre envio e confirmacao e respeita negacoes', () => {
  allRules().forEach((rules) => {
    ['Enviado e entregue', 'Confirmado / Entregue', 'Entregue'].forEach((status) => {
      assert.equal(rules.courierStatusKey(status), 'entregue', status);
      assert.equal(rules.courierIsDelivered(status), true, status);
      assert.equal(rules.courierIsDeliveryTerminal(status), true, status);
      assert.equal(rules.courierIsSentNotDelivered(status), false, status);
    });
    ['Não enviado', 'Não foi enviado', 'Ainda não enviada', 'Não entregue', 'Não foi coletado'].forEach((status) => {
      assert.equal(rules.courierIsSentNotDelivered(status), false, status);
      assert.equal(rules.courierIsDelivered(status), false, status);
      assert.equal(rules.courierStatusRequiresEventDate(status), false, status);
      assert.equal(rules.courierCanReceiveConfirmation(status), false, status);
    });
    assert.equal(rules.courierIsSentNotDelivered('Enviado; ainda não entregue'), true);
    assert.equal(rules.courierIsSentNotDelivered('Cancelado; enviado'), false);
    assert.equal(rules.courierStatusRequiresEventDate('Coletado'), true);
  });
});

test('negacao de realizacao ou cancelamento nao torna evento terminal', () => {
  allRules().slice(1).forEach((rules) => {
    ['Não realizado', 'Não foi realizada', 'Ainda não concluído', 'Não cancelado'].forEach((status) => {
      assert.equal(rules.isCompleted(status), false, status);
      assert.equal(rules.isCancelled(status), false, status);
      assert.equal(rules.isTerminalStatus(status), false, status);
    });
    assert.equal(rules.isCancelled('Não realizado; cancelado'), true);
    assert.equal(rules.statusKey('Não Agendado'), 'naoagendado');
    assert.equal(rules.isCompleted('Realizada'), true);
  });
});

test('notificacao le um bloco por evento e reutiliza a data depois do envio', () => {
  ['agendamento', 'reagendamento', 'cancelamento', 'nenhuma'].forEach((action) => {
    const server = runFile('WebApp.gs', { AgendaServerRules_: allRules()[1] });
    const cfg = server.AGENDA_CFG;
    const data = new Date(2026, 9, 1);
    const row = Array(cfg.lastCol).fill('');
    row[cfg.idx.data] = data;
    row[cfg.idx.labCentral] = 'Sim';
    row[cfg.idx.status] = action === 'cancelamento' ? 'Cancelado' : 'Agendado';
    row[cfg.idx.controle] = action === 'agendamento' ? '' : 'Notificado 30/09/2026';
    const reads = [];
    const writes = [];
    const sent = [];
    const sheet = { getRange(line, col, count, width) {
      return {
        getValues() { reads.push({ line, col, count, width }); return [row.slice(col - 1, col - 1 + width)]; },
        getValue() { assert.fail('Leitura individual redundante'); },
        setValue(value) { writes.push({ col, value }); }
      };
    } };
    server.agendaEmailEnabled_ = () => true;
    server.datasAgendaDiferentes_ = () => action === 'reagendamento';
    server.formatarDataSafe = (value) => { assert.equal(value, data); return '01/10/2026'; };
    server.enviarEmailAgendamento_ = () => sent.push('agendamento');
    server.enviarEmailReagendamento_ = () => sent.push('reagendamento');
    server.enviarEmailCancelamento_ = () => sent.push('cancelamento');
    server.verificarNotificacoes({ user: {} }, 'ID', null, sheet, 2);
    assert.deepEqual(reads, [{ line: 2, col: cfg.col.data, count: 1, width: cfg.col.controle - cfg.col.data + 1 }]);
    assert.deepEqual(sent, action === 'nenhuma' ? [] : [action]);
    assert.equal(writes.length, action === 'nenhuma' ? 0 : 1);
  });
});

test('alinhamento legado faz uma leitura e uma escrita em lote para 1 ou 50 alvos', () => {
  [1, 50].forEach((count) => {
    const server = runFile('WebApp.gs', { AgendaServerRules_: allRules()[1] });
    const cfg = server.AGENDA_CFG;
    let cached = false;
    const calls = { lastRow: 0, reads: 0, writes: 0 };
    const rows = Array.from({ length: count * 2 }, (_, index) => {
      const row = Array(cfg.lastCol).fill('');
      row[cfg.idx.servTerc] = 'Prestador';
      row[cfg.idx.obs] = 'Requisição OK';
      if (index % 2) row[cfg.idx.reqStatus] = 'Pendente';
      return row;
    });
    server.codexCacheGet_ = () => cached;
    server.codexCachePut_ = () => { cached = true; };
    const sheet = {
      getLastRow() { calls.lastRow++; return rows.length + 1; },
      getRange() { return { getValues() { calls.reads++; return rows; } }; },
      getRangeList(ranges) {
        assert.deepEqual(Array.from(ranges), Array.from({ length: count }, (_, index) => 'R' + (index * 2 + 2) + 'C' + cfg.col.reqStatus));
        return { setValue(value) { calls.writes++; assert.equal(value, 'Requisição Enviada'); } };
      }
    };
    server.alinharStatusRequisicaoLegadoAgenda_(sheet);
    assert.deepEqual(calls, { lastRow: 1, reads: 1, writes: 1 });
    server.alinharStatusRequisicaoLegadoAgenda_(sheet);
    assert.deepEqual(calls, { lastRow: 1, reads: 1, writes: 1 });
  });
});
