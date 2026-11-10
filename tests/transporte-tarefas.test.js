'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

const plano = (v) => JSON.parse(JSON.stringify(v));

class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 9, 2, 12])); } // sexta 02/10/2026
}

function servidor() {
  const s = runFiles(['AgendaServerRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs', 'TransporteTarefas.gs', 'TransporteEmails.gs', 'TransporteEnvio.gs', 'TransportePeticionamento.gs'], {
    Date: FakeDate,
    Logger: { log() {} },
    Utilities: { formatDate: (d) => [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0'), d.getFullYear()].join('/') }
  });
  s.getConfigAppValuesByKeys_ = () => ['autorizada@example.invalid'];
  return s;
}

function linha(s, id, data, couriers, extra, ajustar) {
  const cfg = s.AGENDA_CFG;
  const i = cfg.idx;
  const row = Array(cfg.lastCol).fill('');
  row[i.id] = id; row[i.data] = data; row[i.hora] = '09:00'; row[i.status] = 'Agendado';
  row[i.participante] = 'Pessoa ' + id; row[i.projeto] = 'Estudo X'; row[i.visita] = 'V1';
  ['c1', 'c2', 'c3', 'c4'].forEach((slot) => { row[i[slot].nome] = ''; });
  (couriers || []).forEach((c, n) => {
    const slot = i['c' + (n + 1)];
    row[slot.nome] = c.nome; row[slot.status] = c.status || 'Não Agendado'; row[slot.awb] = c.awb || '';
    row[slot.temp] = c.temp || 'CONGELADO'; row[slot.destino] = 'LAB X';
  });
  Object.entries(extra || {}).forEach(([k, v]) => { row[i[k]] = v; });
  if (ajustar) ajustar(row, i);
  return row;
}

function construir(s, linhas, extra) {
  const hoje = new FakeDate();
  return plano(s.transporteTarefasConstruir_(Object.assign({
    hoje, agora: hoje, feriados: { '2026-10-05': true }, linhas, operacoes: [], preparos: {}, nomes: {}
  }, extra || {})));
}

test('Preparar: um transporte, vários transportes e visitas fora da janela', () => {
  const s = servidor();
  const r = construir(s, [
    linha(s, 'a1', '06/10/2026', [{ nome: 'OCASA' }]),
    linha(s, 'a2', '07/10/2026', [{ nome: 'MARKEN' }, { nome: 'DHL', temp: 'AMBIENTE' }]),
    linha(s, 'a3', '15/10/2026', [{ nome: 'OCASA' }]), // 8º dia útil: mais adiante (janela de 7)
    linha(s, 'a4', '30/11/2026', [{ nome: 'OCASA' }, { nome: 'MARKEN' }])
  ]);
  assert.deepEqual(r.tarefas.map((t) => [t.agendaId, t.titulo, t.transportes.length]), [['a1', 'Preparar o transporte', 1], ['a2', 'Preparar 2 transportes', 2]]);
  assert.deepEqual([r.maisAdiante.transportes, r.maisAdiante.visitas, r.maisAdiante.primeiraData], [3, 2, '15/10/2026']);
});

test('ignora cancelados, passados, sem courier, não aplicável e transportes já agendados; backup não vira tarefa', () => {
  const s = servidor();
  const r = construir(s, [
    linha(s, 'c1', '06/10/2026', [{ nome: 'OCASA' }], { status: 'Cancelado' }),
    linha(s, 'c2', '01/10/2026', [{ nome: 'OCASA' }]),
    linha(s, 'c3', '06/10/2026', []),
    linha(s, 'c4', '06/10/2026', [{ nome: 'Não aplicável' }]),
    linha(s, 'c5', '06/10/2026', [{ nome: 'OCASA', status: 'Agendado', awb: '123' }]),
    linha(s, 'c6', '06/10/2026', [{ nome: 'OCASA', status: 'Enviado', awb: '123' }]),
    linha(s, 'c7', '06/10/2026', [], { 'cb.nome': 'x' })
  ]);
  assert.deepEqual(r.tarefas, []);
  assert.deepEqual(r.maisAdiante.transportes, 0);
});

test('documentos gerados sem e-mail enviado viram "Enviar o pedido de coleta", mesmo fora da janela', () => {
  const s = servidor();
  const operacao = (agendaId, slot, extra) => Object.assign({ agendaId, slot, estado: '', pdfId: 'PDF', emailEnviadoEm: '', emailIdentificadoEm: '' }, extra || {});
  const r = construir(s, [
    linha(s, 'd1', '06/10/2026', [{ nome: 'MARKEN', status: 'Docs gerados', awb: '111' }]),
    linha(s, 'd2', '30/11/2026', [{ nome: 'OCASA', status: 'Não Agendado', awb: '222' }]),
    linha(s, 'd3', '06/10/2026', [{ nome: 'OCASA', status: 'Docs gerados', awb: '333' }]),
    linha(s, 'd4', '07/10/2026', [{ nome: 'OCASA', status: 'Não Agendado', awb: '444' }])
  ], { operacoes: [operacao('d2', '1'), operacao('d3', '1', { emailEnviadoEm: new Date() }), operacao('d4', '1', { estado: 'INATIVA' })] });
  assert.deepEqual(r.tarefas.map((t) => [t.agendaId, t.titulo]), [
    ['d1', 'Enviar o pedido de coleta à courier'], ['d3', 'Enviar o pedido de coleta à courier'], ['d4', 'Preparar o transporte'], ['d2', 'Enviar o pedido de coleta à courier']
  ].map((x) => x));
  // d3 tem status Docs gerados mesmo com e-mail enviado: continua pedindo o envio até a Agenda mudar de status.
  assert.equal(r.tarefas.find((t) => t.agendaId === 'd2').transportes[0].situacao, 'enviar_doc');
  assert.equal(r.tarefas.find((t) => t.agendaId === 'd4').transportes[0].situacao, 'preparar');
});

test('PINEX (Agendamento) pede a coleta; título prioriza preparar, depois PINEX, depois enviar', () => {
  const s = servidor();
  const r = construir(s, [
    linha(s, 'p1', '06/10/2026', [{ nome: 'PINEX (Agendamento)' }]),
    linha(s, 'p2', '06/10/2026', [{ nome: 'PINEX (Agendamento)' }, { nome: 'OCASA' }]),
    linha(s, 'p3', '06/10/2026', [{ nome: 'MARKEN', status: 'Docs gerados', awb: '9' }, { nome: 'PINEX (Agendamento)' }])
  ]);
  assert.deepEqual(r.tarefas.map((t) => [t.agendaId, t.titulo]), [['p1', 'Pedir a coleta à PINEX'], ['p2', 'Preparar o transporte'], ['p3', 'Pedir a coleta à PINEX']]);
});

test('prazo reaproveita o cálculo das Pendências e as etiquetas de preparo vêm do resumo', () => {
  const s = servidor();
  const ativo = new FakeDate().toISOString();
  const r = construir(s, [linha(s, 'e1', '02/10/2026', [{ nome: 'OCASA' }]), linha(s, 'e2', '09/10/2026', [{ nome: 'OCASA' }])], {
    preparos: { 'e1|1': { passo: 'gerar', passoNumero: 2, versao: 1, emPreparoPor: 'ana@example.invalid', emPreparoDesde: ativo } },
    nomes: { 'ana@example.invalid': 'Ana' }
  });
  const e1 = r.tarefas.find((t) => t.agendaId === 'e1');
  assert.equal(e1.comPessoa, 'Ana');
  assert.equal(e1.parouNoPasso, 2);
  assert.ok(['Atrasada', 'Agora', 'Em 1h'].includes(e1.prazoLabel) || /^Em \d+h$/.test(e1.prazoLabel), e1.prazoLabel);
  assert.equal(r.tarefas.find((t) => t.agendaId === 'e2').prazoLabel, '');
  assert.equal(r.tarefas.find((t) => t.agendaId === 'e2').comPessoa, '');
});

test('RPC: só administrador, sem lock, sem escrita, e uma leitura de cada fonte', () => {
  const s = servidor();
  const chamadas = [];
  s.codexBootstrapTraceId_ = () => 'trace';
  s.codexMeasureReadPerformance_ = (_op, _etapa, _meta, fn) => fn();
  s.codexWithDocumentLock_ = () => { throw new Error('lock proibido'); };
  s.getDashboardAgendaSheetForRead_ = () => { chamadas.push('agenda'); return {}; };
  s.getDashboardAgendaDisplayRows_ = () => { chamadas.push('linhas'); return [linha(s, 'r1', '06/10/2026', [{ nome: 'OCASA' }])]; };
  s.getAgendaFeriadosPendenciasMap_ = () => { chamadas.push('feriados'); return {}; };
  s.transporteOperacoesRows_ = () => { chamadas.push('operacoes'); return []; };
  s.transporteRegistrosResumo_ = () => { chamadas.push('registros'); return {}; };
  s.codexGetAllowedUsers_ = () => ({});
  s.codexAssertAdmin_ = () => { chamadas.push('admin'); throw new Error('Acesso permitido apenas para administradores.'); };
  assert.throws(() => s.getTransporteTarefas({}), /apenas para administradores/);
  assert.deepEqual(chamadas, ['admin']);
  chamadas.length = 0;
  s.codexAssertAdmin_ = () => { chamadas.push('admin'); return { ok: true, role: 'admin', email: 'Admin@Example.Invalid' }; };
  const resposta = plano(s.getTransporteTarefas({}));
  assert.deepEqual(chamadas, ['admin', 'agenda', 'linhas', 'feriados', 'operacoes', 'registros']);
  assert.equal(resposta.ok, true);
  assert.equal(resposta.usuario, 'admin@example.invalid');
  assert.equal(resposta.janelaDiasUteis, 7);
  assert.equal(resposta.podePeticionar, false, 'admin fora da lista de peticionamento');
  s.getConfigAppValuesByKeys_ = () => ['ADMIN@example.invalid'];
  assert.equal(plano(s.getTransporteTarefas({})).podePeticionar, true);
  assert.deepEqual(resposta.tarefas.map((t) => t.titulo), ['Preparar o transporte']);
});

test('resumo dos preparos lê só as colunas necessárias, ignora o JSON e não altera a aba', () => {
  const s = servidor();
  const cab = ['Chave', 'Agenda_ID', 'Slot', 'Dados_JSON', 'Passo', 'Versao', 'Atualizado_Em', 'Atualizado_Por', 'Em_Preparo_Por', 'Em_Preparo_Desde'];
  const rows = [cab, ['k1|1', 'k1', '1', '{"x":1}', '3', 2, '', 'u', 'ANA@example.invalid', '2026-10-02T10:00:00.000Z'],
    ['k2|1', 'k2', '1', '{"courier":"PINEX (Agendamento)","fasePinex":"resposta"}', 'pinex_numeros', 4, '', 'u', '', ''], ['', '', '', '', '', '', '', '', '', '']];
  const faixas = [];
  const sh = {
    getLastRow: () => rows.length, writes: 0,
    getRange: (r, c, n, w) => { faixas.push([r, c, n, w]); return { getValues: () => rows.slice(r - 1, r - 1 + n).map((x) => x.slice(c - 1, c - 1 + w)) }; }
  };
  s.transporteRegistrosSheetLeitura_ = () => sh;
  // A validação dos cabeçalhos faz sua própria leitura da linha 1.
  const resumo = plano(s.transporteRegistrosResumo_());
  assert.deepEqual(resumo, {
    'k1|1': { passo: '3', versao: 2, emPreparoPor: 'ana@example.invalid', emPreparoDesde: '2026-10-02T10:00:00.000Z', fasePinex: '', gruPronta: false, passoNumero: 0 },
    'k2|1': { passo: 'pinex_numeros', versao: 4, emPreparoPor: '', emPreparoDesde: '', fasePinex: 'resposta', gruPronta: false, passoNumero: 0 }
  });
    s.transporteRegistrosSheetLeitura_ = () => null;
  assert.deepEqual(plano(s.transporteRegistrosResumo_()), {});
});

test('Mais adiante: semanas em ordem, itens por data e quando viram tarefa', () => {
  const s = servidor();
  const r = construir(s, [
    linha(s, 'm1', '19/10/2026', [{ nome: 'OCASA' }]),   // segunda
    linha(s, 'm2', '16/10/2026', [{ nome: 'MARKEN' }]),  // sexta anterior
    linha(s, 'm3', '16/10/2026', [{ nome: 'DHL', temp: 'AMBIENTE' }]),
    linha(s, 'm4', '06/10/2026', [{ nome: 'OCASA' }])    // dentro da janela: tarefa, não adiante
  ]);
  assert.deepEqual(r.maisAdiante.semanas.map((w) => [w.rotulo, w.itens.map((i) => i.agendaId)]),
    [['Semana de 12/10 a 18/10', ['m2', 'm3']], ['Semana de 19/10 a 25/10', ['m1']]]);
  // Hoje: sexta 02/10; segunda 05/10 é feriado. Janela de 7: 8º dia útil anterior a 16/10 (sex): 16,15,14,13,12,09,08,07 -> 07/10.
  assert.equal(r.maisAdiante.semanas[0].itens[0].viraTarefaEm, '07/10/2026');
  // 19/10 (seg): 19,16,15,14,13,12,09,08 -> 08/10.
  assert.equal(r.maisAdiante.semanas[1].itens[0].viraTarefaEm, '08/10/2026');
  const item = r.maisAdiante.semanas[0].itens[0];
  assert.deepEqual([item.slotRotulo, item.courier, item.temperatura, item.destino, item.situacao], ['Transporte I', 'MARKEN', 'CONGELADO', 'LAB X', 'preparar']);
  assert.deepEqual(r.tarefas.map((t) => t.agendaId), ['m4']);
});

test('Acompanhar: confirmação da courier, PINEX e em trânsito, com as regras das Pendências', () => {
  const s = servidor();
  s.codexCourierTrackingUrl_ = (awb, courier) => (courier === 'DHL' ? 'https://rastreio.example.invalid/' + awb : '');
  const r = construir(s, [
    linha(s, 'c1', '06/10/2026', [{ nome: 'OCASA', status: 'Agendado', awb: '111' }]),
    linha(s, 'c2', '07/10/2026', [{ nome: 'Pinex', status: 'Não Agendado' }]),
    linha(s, 'c3', '28/09/2026', [{ nome: 'DHL', status: 'Enviado', awb: '222', temp: 'AMBIENTE' }]),   // passada: trânsito continua
    linha(s, 'c4', '28/09/2026', [{ nome: 'OCASA', status: 'Agendado', awb: '333' }]),                // passada: não aguarda mais confirmação
    linha(s, 'c5', '06/10/2026', [{ nome: 'OCASA', status: 'Entregue', awb: '444' }]),
    linha(s, 'c6', '06/10/2026', [{ nome: 'OCASA', status: 'Enviado', awb: '555' }], { status: 'Cancelado' })
  ], { preparos: { 'c2|1': { passo: 'pinex_numeros', versao: 4, emPreparoPor: '', emPreparoDesde: '', fasePinex: 'resposta' } } });
  assert.deepEqual(r.acompanhar.confirmacao.map((i) => [i.agendaId, i.slotRotulo, i.awb]), [['c1', 'Transporte I', '111']]);
  assert.deepEqual(r.acompanhar.pinex.map((i) => [i.agendaId, i.slot]), [['c2', '1']]);
  assert.deepEqual(r.tarefas.map((x) => [x.agendaId, x.titulo]), [['c2', 'Informar os números da PINEX']], 'também vira tarefa em Para fazer');
  assert.deepEqual(r.acompanhar.transito.map((i) => [i.agendaId, i.slot, i.slotRotulo, i.awb, i.trackingUrl]), [['c3', '1', 'Transporte I', '222', 'https://rastreio.example.invalid/222']]);
  // Enviada em 28/09 e hoje é 02/10: 4 dias corridos (a contagem da aba Em trânsito).
  assert.equal(r.acompanhar.transito[0].diasDesdeEnvio, 4);
  // A data é a do envio já feito: em trânsito não há prazo, nem "Atrasada" (como no cartão das Pendências).
  assert.deepEqual([r.acompanhar.transito[0].prazoHoras, r.acompanhar.transito[0].prazoLabel], [null, '']);
});

test('Backups não agendados: Backup e Backup II, qualquer data, com prazo e sem virar tarefa', () => {
  const s = servidor();
  // Backup II persiste em uma coluna própria; aqui ela existe no fim da linha, como nos testes de Backup II.
  Object.assign(s.AGENDA_CFG.idx, { backup2Dados: 53 });
  s.AGENDA_CFG.lastCol = Math.max(s.AGENDA_CFG.lastCol, 54);
  const comBackup = (nome, status) => (row, i) => { row[i.cb.nome] = nome; row[i.cb.status] = status; row[i.cb.temp] = 'AMBIENTE'; row[i.cb.destino] = 'LAB Z'; };
  const r = construir(s, [
    linha(s, 'b1', '06/10/2026', [], {}, comBackup('OCASA', 'Não Agendado')),
    linha(s, 'b2', '20/09/2026', [], {}, comBackup('MARKEN', 'Não Agendado')),
    linha(s, 'b3', '06/10/2026', [], {}, comBackup('OCASA', 'Agendado')),
    linha(s, 'b4', '06/10/2026', [], {}, (row, i) => { row[i.backup2Dados] = JSON.stringify({ nome: 'DHL', temperatura: 'CONGELADO', status: 'Não Agendado', destino: 'LAB W' }); })
  ]);
  assert.deepEqual(r.backups.map((b) => [b.agendaId, b.slotRotulo, b.courier, b.temperatura, b.destino]).sort(), [
    ['b1', 'Backup', 'OCASA', 'AMBIENTE', 'LAB Z'], ['b2', 'Backup', 'MARKEN', 'AMBIENTE', 'LAB Z'], ['b4', 'Backup II', 'DHL', 'CONGELADO', 'LAB W']]);
  assert.deepEqual(r.tarefas, []);
  assert.ok(r.backups.every((b) => 'prazoHoras' in b && 'prazoLabel' in b && b.participante));
  // A tela destaca dia, mês e dia da semana a partir de dataOrdem (meia-noite local da data da visita).
  const b2 = r.backups.find((b) => b.agendaId === 'b2');
  assert.equal(b2.dataOrdem, new Date(2026, 8, 20).getTime());
});

test('RPC devolve acompanhar, mais adiante e backups da mesma leitura da Agenda', () => {
  const s = servidor();
  let leituras = 0;
  s.codexBootstrapTraceId_ = () => 't';
  s.codexMeasureReadPerformance_ = (_a, _b, _c, fn) => fn();
  s.codexAssertAdmin_ = () => ({ ok: true, email: 'a@example.invalid' });
  s.getDashboardAgendaSheetForRead_ = () => ({});
  s.getDashboardAgendaDisplayRows_ = () => { leituras++; return [linha(s, 'r1', '30/11/2026', [{ nome: 'OCASA' }])]; };
  s.getAgendaFeriadosPendenciasMap_ = () => ({});
  s.transporteOperacoesRows_ = () => [];
  s.transporteRegistrosResumo_ = () => ({});
  s.codexGetAllowedUsers_ = () => ({});
  const r = plano(s.getTransporteTarefas({}));
  assert.equal(leituras, 1);
  assert.deepEqual(Object.keys(r.acompanhar), ['peticionamento', 'confirmacao', 'pinex', 'transito']);
  assert.deepEqual([r.backups, r.maisAdiante.semanas.length], [[], 1]);
});

test('PINEX por fase: pedir a coleta, aguardar a resposta e preparar os documentos', () => {
  const s = servidor();
  const preparos = {
    'p2|1': { passo: 'pinex_numeros', versao: 3, emPreparoPor: '', emPreparoDesde: '', fasePinex: 'resposta' },
    'p3|1': { passo: 'conferir', versao: 5, emPreparoPor: '', emPreparoDesde: '', fasePinex: 'documentos' }
  };
  const r = construir(s, [
    linha(s, 'p1', '06/10/2026', [{ nome: 'Pinex' }]),
    linha(s, 'p2', '06/10/2026', [{ nome: 'PINEX (Agendamento)' }]),
    linha(s, 'p3', '06/10/2026', [{ nome: 'Pinex' }])
  ], { preparos });
  assert.deepEqual(r.tarefas.map((x) => [x.agendaId, x.titulo]), [['p1', 'Pedir a coleta à PINEX'], ['p2', 'Informar os números da PINEX'], ['p3', 'Preparar o transporte']]);
  assert.deepEqual(r.acompanhar.pinex.map((x) => x.agendaId), ['p2']);
  assert.equal(r.tarefas[1].transportes[0].situacao, 'pinex_numeros');
});

test('PINEX aguardando resposta: a tarefa respeita a janela de dias úteis e fora dela fica em Mais adiante', () => {
  const s = servidor();
  const preparos = { 'q1|1': { passo: 'pinex_numeros', passoNumero: 1, versao: 3, emPreparoPor: '', emPreparoDesde: '', fasePinex: 'resposta', gruPronta: false },
    'q2|1': { passo: 'pinex_numeros', passoNumero: 1, versao: 3, emPreparoPor: '', emPreparoDesde: '', fasePinex: 'resposta', gruPronta: false } };
  const r = construir(s, [linha(s, 'q1', '06/10/2026', [{ nome: 'Pinex' }]), linha(s, 'q2', '30/11/2026', [{ nome: 'Pinex' }])], { preparos });
  assert.deepEqual(r.tarefas.map((x) => [x.agendaId, x.titulo, x.parouNoPasso]), [['q1', 'Informar os números da PINEX', 1]]);
  assert.deepEqual(r.maisAdiante.semanas.flatMap((w) => w.itens.map((i) => [i.agendaId, i.situacao])), [['q2', 'pinex_numeros']]);
});

test('"Parou no passo N" vem do número gravado com o passo e some quando o passo não é numerável', () => {
  const s = servidor();
  const preparos = { 'n1|1': { passo: 'gerar', passoNumero: 3, versao: 2, emPreparoPor: '', emPreparoDesde: '', fasePinex: '', gruPronta: false },
    'n2|1': { passo: 'concluido', passoNumero: 0, versao: 2, emPreparoPor: '', emPreparoDesde: '', fasePinex: '', gruPronta: false } };
  const r = construir(s, [linha(s, 'n1', '06/10/2026', [{ nome: 'OCASA' }]), linha(s, 'n2', '06/10/2026', [{ nome: 'OCASA' }]), linha(s, 'n3', '06/10/2026', [{ nome: 'OCASA' }])], { preparos });
  assert.deepEqual(r.tarefas.map((x) => [x.agendaId, x.parouNoPasso]), [['n1', 3], ['n2', 0], ['n3', 0]]);
});
