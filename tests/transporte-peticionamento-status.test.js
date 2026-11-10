'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile, runHtmlScript } = require('./helpers/load-app-script');
const { dashboardAgendaFixture } = require('./helpers/dashboard-agenda-fixture');

const plano = (v) => JSON.parse(JSON.stringify(v));
const STATUS = ['Aguardando peticionamento', 'aguardando peticionamento', 'AGUARDANDO PETICIONAMENTO (GRU e extrato)'];

test('"Aguardando peticionamento" tem chave própria, igual no servidor e no cliente', () => {
  const servidor = runFile('AgendaServerRules.gs').AgendaServerRules_;
  const cliente = runHtmlScript('SharedAgendaRules.html').AgendaRules || runHtmlScript('SharedAgendaRules.html').CodexAgendaRules;
  for (const texto of STATUS) {
    assert.equal(servidor.courierStatusKey(texto), 'peticionamento', texto);
    if (cliente) assert.equal(cliente.courierStatusKey(texto), 'peticionamento', texto);
    assert.equal(servidor.courierNeedsSchedule(texto, ''), false, 'não é "não agendada"');
    assert.equal(servidor.courierIsAwaitingConfirmation(texto), false, 'não é "aguardando confirmação"');
    assert.equal(servidor.courierIsSentNotDelivered(texto), false, 'não é "enviado"');
    assert.equal(servidor.courierCanReceiveConfirmation(texto), false, 'o monitor não promove automaticamente');
    assert.equal(servidor.courierIsDeliveryTerminal(texto), false);
    assert.equal(servidor.courierIsDelivered(texto), false);
    assert.equal(servidor.courierIsNotApplicable(texto), false);
  }
  // Os demais status não mudaram.
  for (const [texto, chave] of [['Não Agendado', 'naoagendado'], ['Docs gerados', 'docsgerados'], ['Agendado', 'agendado'], ['Enviado', 'enviado'], ['', 'pendente']]) {
    assert.equal(servidor.courierStatusKey(texto), chave, texto);
  }
});

test('Pendências ignoram o status: nada de "não agendada", "não confirmada", "em trânsito" nem documentação sem envio', () => {
  const f = dashboardAgendaFixture();
  f.sheet.rows.splice(1);
  f.server.getAgendaFeriadosPendenciasMap_ = () => ({});
  f.server.transporteDocumentosSemEnvioPendencias_ = () => [{ agendaId: 'p1', slot: '1', referencia: 'DOC' }];
  const r = f.row('06/10/2026', 'Visita', 'Agendado', { id: 'p1', hora: '09:00', participante: 'Pessoa' });
  const i = f.server.AGENDA_CFG.idx;
  r[i.c1.nome] = 'OCASA'; r[i.c1.status] = 'Aguardando peticionamento'; r[i.c1.awb] = '123';
  r[i.c2.nome] = '';
  f.sheet.rows.push(r);
  const pendencias = plano(f.server.getDashboardPendencias_([]));
  for (const chave of ['courierNaoAgendada', 'courierNaoConfirmada', 'awbEnviadaNaoEntregue', 'documentacaoTransporteSemEnvio']) {
    assert.deepEqual(pendencias[chave], [], chave);
  }
  assert.equal(pendencias.counts.courierNaoAgendada, 0);
});

test('Transporte (piloto): vai para Acompanhar, nunca para Para fazer', () => {
  const { runFiles } = require('./helpers/load-app-script');
  class Hoje extends Date { constructor(...a) { super(...(a.length ? a : [2026, 9, 2, 12])); } }
  const s = runFiles(['AgendaServerRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs', 'TransporteTarefas.gs', 'TransporteEmails.gs', 'TransporteEnvio.gs'],
    { Date: Hoje, Logger: { log() {} }, Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) } });
  const cfg = s.AGENDA_CFG, idx = cfg.idx;
  const linha = Array(cfg.lastCol).fill('');
  Object.assign(linha, {});
  linha[idx.id] = 'g1'; linha[idx.data] = '06/10/2026'; linha[idx.hora] = '09:00'; linha[idx.status] = 'Agendado'; linha[idx.participante] = 'Pessoa'; linha[idx.projeto] = 'Estudo X'; linha[idx.visita] = 'V1';
  linha[idx.c1.nome] = 'OCASA'; linha[idx.c1.status] = 'Aguardando peticionamento'; linha[idx.c1.awb] = '123'; linha[idx.c1.temp] = 'CONGELADO'; linha[idx.c1.destino] = 'LAB X';
  const hoje = new Hoje();
  const r = plano(s.transporteTarefasConstruir_({ hoje, agora: hoje, feriados: {}, linhas: [linha], operacoes: [], preparos: {}, nomes: {} }));
  assert.deepEqual(r.tarefas, []);
  assert.deepEqual(r.acompanhar.peticionamento.map((x) => [x.agendaId, x.slotRotulo, x.awb]), [['g1', 'Transporte I', '123']]);
  assert.deepEqual([r.acompanhar.confirmacao, r.acompanhar.transito, r.backups], [[], [], []]);
});

test('o status é uma opção da lista de status de courier da Agenda, logo depois de "Docs gerados"', () => {
  const f = dashboardAgendaFixture();
  f.server.getConfigAppValuesByKeys_ = (_g, _k, padrao) => padrao.slice();
  const lista = plano(f.server.getAgendaCourierStatuses_());
  assert.ok(lista.indexOf('Aguardando peticionamento') === lista.indexOf('Docs gerados') + 1, lista.join('|'));
  // Configuração que já traz o status não duplica.
  f.server.getConfigAppValuesByKeys_ = () => ['Não Agendado', 'Docs gerados', 'Aguardando peticionamento', 'Agendado'];
  assert.deepEqual(plano(f.server.getAgendaCourierStatuses_()), ['Não Agendado', 'Docs gerados', 'Aguardando peticionamento', 'Agendado']);
});
