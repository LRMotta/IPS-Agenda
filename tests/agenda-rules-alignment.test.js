'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, runHtmlScript, readProjectFile } = require('./helpers/load-app-script');
const { createAgendaRulesCore } = require('../tools/agenda-rules-core');
const { renderTarget } = require('../tools/generate-agenda-rules');

function rules() {
  return { server: runFile('AgendaServerRules.gs').AgendaServerRules_, client: runHtmlScript('SharedAgendaRules.html').AgendaRules };
}

const types = [
  ['Visita', 'visita', true, true, 'ag-type-visita', 'event_available'],
  ['Visita de monitoria', 'monitoria', false, false, 'ag-type-monitoria', 'visibility'],
  ['Monitoria com envio de amostras', 'monitoria', false, false, 'ag-type-monitoria', 'visibility'],
  ['Site initiation visita', 'siv', false, false, 'ag-type-siv', 'flag'],
  ['Close-out visita', 'closeout', false, false, 'ag-type-closeout', 'lock'],
  ['Closeout', 'closeout', false, false, 'ag-type-closeout', 'lock'],
  ['Consulta de retorno', 'consulta', false, true, 'ag-type-consulta', 'event'],
  ['Exame de imagem com envio de amostras', 'exame-imagem', false, false, 'ag-type-imagem', 'image_search'],
  ['Exames laboratoriais', 'exame-laboratorial', false, true, 'ag-type-lab', 'biotech'],
  ['Envio de amostras', 'envio-amostras', true, true, 'ag-type-amostras', 'local_shipping'],
  ['Feriado', 'feriado', false, false, 'ag-type-feriado', 'event_busy'],
  ['Reunião', 'reuniao', false, false, 'ag-type-reuniao', 'groups'],
  ['Auditoria', 'auditoria', false, false, 'ag-type-auditoria', 'fact_check'],
  ['Contato telefônico', 'contato telefonico', false, true, 'ag-type-default', 'call'],
  ['Evento personalizado', 'evento personalizado', false, true, 'ag-type-default', 'event']
];

test('tipo canonico alinha laboratorio, participantes e apresentacao inclusive aliases compostos', () => {
  const { server, client } = rules();
  types.forEach(([label, key, lab, participant, css, icon]) => {
    [label, key, { tipo: label }].forEach((value) => {
      [server, client].forEach((rule) => {
        assert.equal(rule.typeKey(value), key, label);
        assert.equal(rule.typeRequiresLabCentral(value), lab, label);
        assert.equal(rule.formPolicy(value).requiresLabCentral, lab, label);
        assert.equal(rule.formPolicy(value).usesParticipantWorkflow, participant, label);
      });
      assert.equal(client.typeClass(value), css, label);
      assert.equal(client.typeIcon(value), icon, label);
      const a = server.formPolicy(value);
      const b = client.formPolicy(value);
      Object.keys(a).forEach((property) => assert.equal(b[property], a[property], label + ':' + property));
    });
  });
});

test('status e courier preservam suas chaves canonicas em normalizacoes repetidas', () => {
  const { server, client } = rules();
  ['Agendado', 'Cancelada', 'Realizada', 'Concluído', 'Reagendado', 'Pendente',
    'Não Agendado', 'naoagendado', 'Não-agendado', 'Confirmado', 'Enviado', 'Entregue', '', null].forEach((value) => {
    assert.equal(client.statusKey(value), server.statusKey(value), String(value));
    [server, client].forEach((rule) => {
      const key = rule.statusKey(value);
      assert.equal(rule.statusKey(key), key, String(value));
      assert.equal(rule.statusKey({ status: key }), key, String(value));
    });
  });
  [server, client].forEach((rule) => {
    assert.equal(rule.statusKey('naoagendado'), 'naoagendado');
    ['Não aplicável', 'naoaplicavel', 'N/A', 'Não Agendado', 'naoagendado', 'Coletado', 'Entregue', 'Pendente'].forEach((value) => {
      const key = rule.courierStatusKey(value);
      assert.equal(rule.courierStatusKey(key), key, value);
      assert.equal(client.courierStatusKey(value), server.courierStatusKey(value), value);
    });
  });
});

test('chips de status compartilham a chave e os estilos da Agenda', () => {
  const { client } = rules();
  const css = readProjectFile('IndexStylesAfterDashboard.html');
  ['Cancelada', 'Realizada', 'Concluído', 'Pendente', 'Não Agendado', 'Reagendado',
    'Agendado', 'Confirmado', 'Enviado', 'Entregue'].forEach((status) => {
    const key = client.statusKey(status);
    assert.equal(client.statusChipClass(status), 'ag-ch-' + key);
    assert.equal(client.statusChipClass({ status }), 'ag-ch-' + key);
    assert.equal(client.visualClass({ status }), key);
    assert.ok(css.includes('.ag-ch-' + key), status);
  });
  const source = readProjectFile('IndexAgendaScripts.html');
  const operationalChip = source.slice(source.indexOf('function agendaStatusChipOp('), source.indexOf('function agendaStatusClass('));
  assert.match(operationalChip, /AgendaRules\.statusChipClass\(status\)/);
  assert.doesNotMatch(operationalChip, /agendaStatusClass/);
});

test('comparacoes normalizam aliases e espacos sem aceitar fallback para esperado desconhecido', () => {
  const { server, client } = rules();
  [server, client].forEach((rule) => {
    assert.equal(rule.isStatus('Concluído', ' Concluído '), true);
    assert.equal(rule.isStatus({ status: 'Cancelada' }, 'Cancelado'), true);
    assert.equal(rule.isStatus('Não Agendado', 'naoagendado'), true);
    assert.equal(rule.isStatus('Agendado', 'status desconhecido'), false);
    assert.equal(rule.isStatus('Enviado', 'status desconhecido enviado'), false);
    assert.equal(rule.isStatus('Agendado', 'desagendado'), false);
    assert.equal(rule.isStatus('Agendado', ''), false);
    assert.equal(rule.isStatus('Agendado', null), false);
    assert.equal(rule.isType('Visita', ' Visita '), true);
    assert.equal(rule.isType('Site initiation', 'SIV'), true);
    assert.equal(rule.isType('Closeout', 'Close-out'), true);
    assert.equal(rule.isType('Exames laboratoriais', 'exame-laboratorial'), true);
    assert.equal(rule.isType('Reunião', 'REUNIÃO'), true);
    assert.equal(rule.isType('Evento personalizado', ' Evento personalizado '), true);
    assert.equal(rule.isType('evento', ''), false);
    assert.equal(rule.isType('Visita', 'tipo desconhecido'), false);
  });
});

test('rotulos tratam objetos e contagem textual e permitem plurais personalizados', () => {
  const { client } = rules();
  assert.equal(client.typePluralLabel('Visita', '1'), 'Visita');
  assert.equal(client.typePluralLabel({ tipo: 'Visita' }, 2), 'Visitas');
  assert.equal(client.typePluralLabel({ tipo: 'Evento personalizado' }, 1), 'Evento personalizado');
  assert.equal(client.typePluralLabel({ tipo: 'Evento personalizado' }, 2), 'Evento personalizados');
  assert.equal(client.typePluralLabel('Reunião', 2), 'Reuniões');
  assert.equal(client.typePluralLabel('Feriado', '1'), 'Feriado');
  assert.equal(client.typePluralLabel(null, 1), 'Evento');
  assert.equal(client.typePluralLabel({}, 2), 'Eventos');
  assert.equal(client.typePluralLabel('procedimento', '1', { singular: 'Procedimento', plural: 'Procedimentos' }), 'Procedimento');
  assert.equal(client.typePluralLabel({ tipo: 'sessao', singular: 'Sessão', plural: 'Sessões' }, 2), 'Sessões');
  assert.equal(client.typePluralLabel('sessao', 2, { singular: 'Sessão', plural: 'Sessões' }), 'Sessões');
  assert.equal(client.typePluralLabel('customizado', 2, 'Atendimento'), 'Atendimentos');
});

test('acoes desconhecidas sao recusadas e acao conhecida continua bloqueada no cancelamento', () => {
  const { client } = rules();
  ['', null, 'adicionar-google-agendaa', 'excluir-evento'].forEach((action) => {
    assert.equal(client.canPerform({ status: 'Agendado' }, action), false);
    assert.equal(client.canPerform({ status: 'Cancelado' }, action), false);
  });
  assert.equal(client.canPerform({ status: 'Agendado' }, ' ADICIONAR-GOOGLE-AGENDA '), true);
  assert.equal(client.canPerform({ status: 'Cancelada' }, client.Action.ADD_TO_GOOGLE_CALENDAR), false);
});

test('visita telefonica dispensa transporte e laboratorio em ambos os runtimes', () => {
  const { client, server } = rules();
  [client, server].forEach((rule) => {
    ['Visita — contato telefônico', 'Contato telefônico', { tipo: 'Visita - contato telefônico' }].forEach((value) => {
      assert.equal(rule.hasTransportOperation(value), false);
      assert.equal(rule.typeRequiresLabCentral(value), false);
      assert.equal(rule.formPolicy(value).labChoiceAllowed, false);
      assert.equal(rule.formPolicy(value, true).technicalFieldsAvailable, false);
    });
    assert.equal(rule.hasTransportOperation('Visita'), true);
    assert.equal(rule.hasTransportOperation('Envio de amostras'), true);
  });
  assert.equal(client.countsIn({ tipo: 'Visita — contato telefônico', status: 'Realizado' }, 'dashboard-transportes-realizados'), false);
});

test('gravacao de telefone nao altera transporte historico e visita comum mantem slots e sincronizacao', () => {
  const { server: agendaRules } = rules();
  const server = runFile('WebApp.gs', { AgendaServerRules_: agendaRules });
  const calls = [];
  server.agendaSetCourierLinha_ = (sheet, row, slot, courier, options) => calls.push({ slot, courier, skip: options && options.skipBackupAwbSync });
  server.agendaSetBackupLinha_ = (sheet, row, backup) => calls.push({ backup });
  server.agendaSetTransporteExtraLinha_ = (sheet, row, data) => calls.push({ extra: data });
  const sheet = { getRange() { throw new Error('Nao deve acessar planilha real'); } };
  const data = { tipo: 'Visita — contato telefônico', courier1: { awb: 'historico', nome: 'Courier' }, backup: { nome: 'Backup' } };
  server.agendaGravarTransportesDoEvento_(sheet, 2, data, 'Sim', true);
  assert.deepEqual(calls, []);
  assert.equal(data.courier1.awb, 'historico');
  data.tipo = 'Visita';
  server.agendaGravarTransportesDoEvento_(sheet, 2, data, 'Sim', true);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].slot, server.AGENDA_CFG.idx.c1);
  assert.equal(calls[0].skip, true);
  assert.equal(calls[1].slot, server.AGENDA_CFG.idx.c2);
  assert.equal(calls[2].slot, server.AGENDA_CFG.idx.c3);
  assert.equal(calls[3].backup, data.backup);
  assert.equal(calls[4].extra, data);
  calls.length = 0;
  server.agendaGravarTransportesDoEvento_(sheet, 2, data, 'Não');
  assert.equal(calls[0].skip, false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[3].backup)), {});
});

test('blocos gerados correspondem a fonte unica e detectam edicao manual divergente', () => {
  const { server, client } = rules();
  const core = createAgendaRulesCore();
  ['AgendaServerRules.gs', 'SharedAgendaRules.html'].forEach((file) => {
    const source = readProjectFile(file);
    assert.equal(renderTarget(source), source, file);
    const changed = source.replace("plural: 'Visitas'", "plural: 'ROTULO DIVERGENTE'");
    assert.notEqual(changed, source);
    assert.equal(renderTarget(changed), source, file);
  });
  assert.throws(() => renderTarget('arquivo sem bloco gerado'), /ausente/);
  types.forEach(([label]) => {
    [core, client, server].forEach((rule) => {
      assert.equal(rule.typeKey(label), core.typeKey(label));
      assert.deepEqual(JSON.parse(JSON.stringify(rule.formPolicy(label))), core.formPolicy(label));
    });
  });
});

test('contextos e indicadores conhecidos preservam contratos e chaves desconhecidas sao recusadas', () => {
  const { client } = rules();
  const cancelled = { tipo: 'Visita', status: 'Cancelada', labCentral: 'Sim' };
  const realized = { tipo: 'Visita', status: 'Realizado', labCentral: 'Sim' };
  assert.ok(Object.isFrozen(client.Indicator));
  ['', null, 'requisicoess', 'contexto desconhecido'].forEach((context) => {
    assert.equal(client.isVisibleIn(realized, context), false, String(context));
    assert.equal(client.isVisibleIn(cancelled, context), false, String(context));
  });
  Object.keys(client.Context).forEach((key) => {
    const value = client.Context[key];
    assert.equal(client.isVisibleIn(realized, ' ' + value.toUpperCase() + ' '), true, key);
    assert.equal(client.isVisibleIn(cancelled, value), key !== 'DAILY_HEADER' && key !== 'REQUESTS', key);
  });
  ['', null, 'dashboard-visitas-realizada', 'indicador desconhecido'].forEach((indicator) => {
    assert.equal(client.countsIn(realized, indicator), false, String(indicator));
    assert.equal(client.countsIn({ tipo: 'Reunião', status: 'Agendado' }, indicator), false, String(indicator));
  });
  const expectations = { CANCELLATIONS: false, DAILY_HEADER: true, DASHBOARD_CANCELLATIONS_RESCHEDULES: false,
    DASHBOARD_MONITORING: false, DASHBOARD_COMPLETED_VISITS: true, DASHBOARD_COMPLETED_TRANSPORT: true,
    DASHBOARD_LAB_CENTRAL: true, LAB_CENTRAL: true };
  Object.keys(expectations).forEach((key) => {
    assert.ok(client.Indicator[key], key);
    assert.equal(client.countsIn(realized, ' ' + client.Indicator[key].toUpperCase() + ' '), expectations[key], key);
    assert.equal(client.countsIn(cancelled, client.Indicator[key]), key === 'CANCELLATIONS' || key === 'DASHBOARD_CANCELLATIONS_RESCHEDULES', key);
  });
});

test('courier compartilha todas as regras e preserva contratos legados apos geracao', () => {
  const { server, client } = rules();
  const core = createAgendaRulesCore();
  const statuses = ['', null, 'Agendado', 'Pendente', 'Não Agendado', 'Cancelado',
    'Não aplicável', 'Coletado', 'Enviado', 'Entregue', 'Enviado e entregue', 'Status desconhecido'];
  const unary = ['courierStatusKey', 'courierIsNotApplicable', 'courierIsSentNotDelivered',
    'courierIsDelivered', 'courierIsDeliveryTerminal', 'courierIsAwaitingConfirmation',
    'courierCanReceiveConfirmation', 'courierStatusRequiresEventDate'];
  statuses.forEach((status) => {
    unary.forEach((method) => {
      assert.equal(server[method](status), core[method](status), method + ':' + status);
      assert.equal(client[method](status), core[method](status), method + ':' + status);
    });
    ['', 'AWB123'].forEach((awb) => {
      assert.equal(server.courierNeedsSchedule(status, awb), core.courierNeedsSchedule(status, awb));
      assert.equal(client.courierNeedsSchedule(status, awb), core.courierNeedsSchedule(status, awb));
    });
  });
  assert.equal(core.courierCanReceiveConfirmation('Agendado'), true);
  assert.equal(core.courierCanReceiveConfirmation('Entregue'), false);
  assert.equal(core.courierNeedsSchedule('', ''), true);
  assert.equal(core.courierNeedsSchedule('', 'AWB123'), false);
  assert.equal(core.courierIsSentNotDelivered('Enviado e entregue'), false);
  assert.equal(core.courierStatusRequiresEventDate('Coletado'), true);
  assert.equal(core.courierStatusRequiresEventDate('Agendado'), false);
});

test('chamadores da Agenda e Dashboard referenciam contextos e indicadores existentes', () => {
  const { client } = rules();
  ['IndexAgendaScripts.html', 'IndexDashboard.html'].forEach((file) => {
    const source = readProjectFile(file);
    for (const match of source.matchAll(/AgendaRules\.(Context|Indicator)\.([A-Z_]+)/g)) {
      assert.equal(typeof client[match[1]][match[2]], 'string', file + ':' + match[0]);
    }
    assert.doesNotMatch(source, /AgendaRules\.countsIn\([^,\n]+,\s*['"]/);
  });
});
