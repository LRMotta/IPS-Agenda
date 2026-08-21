'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function agendaKitContext() {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  server.getEstoque = () => [
    { idItem: 'KIT-B', descricao: 'Kit Beta', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '20/12/2026', qtde: 1 },
    { idItem: 'EX-1', descricao: 'Requisição de exame', tipoItem: 'Exame', projeto: 'Estudo A', validade: '01/12/2026', qtde: 5 },
    { idItem: 'KIT-A', descricao: 'Kit Alpha', tipoItem: 'Kit', projeto: 'Estudo A', validade: '30/11/2026', qtde: 2 },
    { idItem: 'KIT-Z', descricao: 'Kit sem saldo', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '01/01/2027', qtde: 0 }
  ];
  return server;
}

test('contrato legado: kits da Agenda filtram itens não-kit e ordenam pelo rótulo', () => {
  const server = agendaKitContext();
  const kits = server.getAgendaKitsEstoque_(true);

  assert.deepEqual(Array.from(kits, kit => kit.id), ['KIT-A', 'KIT-B']);
  assert.equal(kits[0].projeto, 'Estudo A');
  assert.match(kits[0].label, /Kit Alpha/);
  assert.match(kits[0].label, /qtd 2/);
});

test('contrato legado: itens iguais permanecem separados quando mudam validade ou localização', () => {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  const itens = [
    { idItem: 'KIT-1', projeto: 'Estudo A', descricao: 'Kit coleta', tipoItem: 'Kit', validade: '31/12/2026', localizacao: 'Estoque Principal', qtde: 4, status: 'OK' },
    { idItem: 'KIT-1', projeto: 'Estudo A', descricao: 'Kit coleta', tipoItem: 'Kit', validade: '31/12/2026', localizacao: 'Laboratório', qtde: 3, status: 'OK' },
    { idItem: 'KIT-1', projeto: 'Estudo A', descricao: 'Kit coleta', tipoItem: 'Kit', validade: '31/01/2027', localizacao: 'Estoque Principal', qtde: 2, status: 'OK' }
  ];
  const agrupados = server.agruparEstoquePorItemValidade_(itens);

  assert.equal(agrupados.length, 3);
  assert.deepEqual(Array.from(agrupados, item => [item.validade, item.localizacao, item.qtde]), [
    ['31/12/2026', 'Estoque Principal', 4],
    ['31/12/2026', 'Laboratório', 3],
    ['31/01/2027', 'Estoque Principal', 2]
  ]);
});

test('contrato legado: baixa da Agenda registra uma unidade por kit e evita IDs já baixados', () => {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  const chamadas = [];
  server.getKitsAgendaBaixaStatus = () => ({ ids: ['KIT-JA'], baixados: true });
  server.registrarMovimentacaoEstoque = payload => chamadas.push(payload);
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();

  const resultado = server.baixarKitsAgendaEvento({
    agendaId: 'EVT-1',
    projeto: 'Estudo A',
    participante: 'Pessoa A',
    kits: [
      { idItem: 'KIT-JA', label: 'Kit já baixado' },
      { idItem: 'KIT-NOVO', label: 'Kit novo' }
    ]
  });

  assert.equal(resultado.baixados, 1);
  assert.equal(resultado.pulados, 1);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].idItem, 'KIT-NOVO');
  assert.equal(chamadas[0].qtde, 1);
  assert.equal(chamadas[0].agendaId, 'EVT-1');
  assert.equal(chamadas[0].agendaKitAcao, 'baixa');
});

test('excecao operacional registra perda e encerra a reserva correspondente', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Laboratório', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', 'AG-1', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'P-1', 'V1']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de movimento', 'ID_Item', 'Descrição', 'Tipo de item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID_Participante', 'Participante', 'ID_Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque, Reservas_Kits: reservas, Movimentações: mov });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'EXC-1', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.registrarExcecaoKitEstoque({ idItem: 'KIT-1', idLote: 'LOTE-1', localizacao: 'Laboratório', qtde: 1, tipo: 'perda', motivo: 'Avaria no armazenamento' });
  assert.equal(result.reservasAtualizadas, 1);
  assert.equal(estoque.rows[1][6], 1);
  assert.equal(reservas.rows[1][11], 'Perdido');
  assert.equal(mov.rows[1][2], 'Saída - Perda');
});

test('substituição de lote preserva histórico e cria reserva elegível', () => {
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', 'AG-1', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'P-1', 'V1']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'SUB-1', formatDate: value => String(value) }
  });
  server.getEstoque = () => [{ idItem: 'KIT-1', idLote: 'LOTE-2', descricao: 'Kit coleta', validade: '31/12/2026', localizacao: 'Estoque Principal', qtde: 2 }];
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.substituirReservaKitAgenda({ idReserva: 'RES-1', novoIdLote: 'LOTE-2', justificativa: 'Lote original comprometido.' });
  assert.equal(result.ok, true);
  assert.equal(reservas.rows[1][11], 'Substituída');
  assert.equal(reservas.rows.length, 3);
  assert.equal(reservas.rows[2][6], 'LOTE-2');
  assert.equal(reservas.rows[2][11], 'Reservado');
});

test('gestão de reserva exige justificativa e ajusta quantidade com histórico', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Laboratório', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', 'AG-1', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'P-1', 'V1']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Estoque: estoque, Reservas_Kits: reservas }), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'ADJ-1', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  assert.throws(() => server.cancelarReservaKitAgenda({ idReserva: 'RES-1' }), /justificativa/);
  const result = server.ajustarReservaKitAgenda({ idReserva: 'RES-1', qtde: 2, justificativa: 'Visita exige uma unidade adicional.' });
  assert.equal(result.quantidadeAnterior, 1);
  assert.equal(reservas.rows[1][10], 2);
  assert.equal(reservas.rows[2][11], 'Ajustada');
  assert.match(String(reservas.rows[2][14]), /Visita exige/);
});

test('fase 2: ordem configurada do projeto precede o rótulo alfabético na Agenda', () => {
  const server = agendaKitContext();
  server.getEstoque = () => [
    { idItem: 'KIT-B', descricao: 'Kit Beta', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '20/12/2026', qtde: 1, ordem: 20 },
    { idItem: 'KIT-A', descricao: 'Kit Alpha', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1, ordem: 10 },
    { idItem: 'KIT-C', descricao: 'Kit Gamma', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1 }
  ];
  const kits = server.getAgendaKitsEstoque_(true);

  assert.deepEqual(Array.from(kits, kit => kit.id), ['KIT-A', 'KIT-B', 'KIT-C']);
  assert.deepEqual(Array.from(kits, kit => kit.ordem), [10, 20, '']);
});

test('fase SoA: calendario do protocolo ordena visitas e preserva aliases', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes'],
    ['SOA-2', 'Estudo A', 'FU-03', 'Follow-up 3', 20, 'mensal', 30, 'FU 3; Follow up 3', 'Sim', ''],
    ['SOA-1', 'Estudo A', 'T-2', 'Subsequente', 10, 'a cada 6 meses', 180, 'C18; C24', 'Sim', ''],
    ['SOA-3', 'Estudo B', 'V1', 'Baseline', 10, '', '', '', 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  const visitas = server.getSoAVisitasProjeto('estudo a');
  assert.deepEqual(Array.from(visitas, item => item.idSoA), ['SOA-1', 'SOA-2']);
  assert.deepEqual(Array.from(visitas[0].aliases), ['C18', 'C24']);
  assert.equal(visitas[1].intervaloDias, 30);
  assert.equal(visitas[0].ordemSugerida, 1);
  assert.equal(visitas[0].ordemAmbigua, true);
});

test('fase SoA: sugestão garante dependências, ordena irmãos por intervalo e envia fase terminal ao final', () => {
  const server = runFile('WebApp.gs');
  const suggestion = server.soaSugerirOrdemExecucao_([
    { idSoA: 'TRI', nome: 'Triagem', ordem: 1, referencia: '', intervaloDias: '' },
    { idSoA: 'C1D1', nome: 'Dia 1', ordem: 2, referencia: 'RANDOMIZACAO', intervaloDias: 0 },
    { idSoA: 'EOT', nome: 'Final de tratamento', ordem: 3, referencia: 'ULTIMA_DOSE', intervaloDias: 30 },
    { idSoA: 'C1D8', nome: 'Dia 8', ordem: 4, referencia: 'C1D1', intervaloDias: 7 },
    { idSoA: 'C1D2', nome: 'Dia 2', ordem: 5, referencia: 'C1D1', intervaloDias: 1 }
  ]);
  const details = Object.fromEntries(Array.from(suggestion.visitas, item => [item.idSoA, item]));

  assert.deepEqual(Array.from(suggestion.idsSoA), ['TRI', 'C1D1', 'C1D2', 'C1D8', 'EOT']);
  assert.equal(details.EOT.ordemRecebida, 3);
  assert.equal(details.EOT.ordemSugerida, 5);
  assert.equal(details.TRI.ordemAmbigua, true);
  assert.match(details.TRI.motivosOrdem[0], /Sem referência explícita/);
});

test('fase SoA: sugestão destaca empates e ciclos sem inventar sequência', () => {
  const server = runFile('WebApp.gs');
  const alreadyOrdered = server.soaSugerirOrdemExecucao_([
    { idSoA: 'V1', nome: 'V1', ordem: 10, referencia: 'RANDOMIZACAO', intervaloDias: 0 },
    { idSoA: 'V2', nome: 'V2', ordem: 20, referencia: 'V1', intervaloDias: 7 }
  ]);
  assert.equal(alreadyOrdered.mudancas, 0);

  const tied = server.soaSugerirOrdemExecucao_([
    { idSoA: 'A1', nome: 'Braço A', ordem: 1, referencia: 'RANDOMIZACAO', intervaloDias: 0 },
    { idSoA: 'B1', nome: 'Braço B', ordem: 2, referencia: 'RANDOMIZACAO', intervaloDias: 0 }
  ]);
  assert.deepEqual(Array.from(tied.idsSoA), ['A1', 'B1']);
  assert.equal(tied.visitas.every(item => item.ordemAmbigua), true);
  assert.ok(tied.ambiguidades.some(item => item.tipo === 'MESMO_INTERVALO'));

  const cycle = server.soaSugerirOrdemExecucao_([
    { idSoA: 'A', nome: 'A', ordem: 1, referencia: 'B', intervaloDias: 1 },
    { idSoA: 'B', nome: 'B', ordem: 2, referencia: 'A', intervaloDias: 1 }
  ]);
  assert.deepEqual(Array.from(cycle.idsSoA), ['A', 'B']);
  assert.ok(cycle.ambiguidades.some(item => item.tipo === 'CICLO'));
  assert.equal(cycle.visitas.every(item => item.ordemAmbigua), true);
});

test('fase SoA: replicação de ciclos remapeia textos e referências, preserva campos e não sobrescreve existentes', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)', 'Janela dias menos', 'Janela dias mais', 'Bracos (IDs)', 'Ordem manual'],
    ['SOA-C1D1', 'Estudo A', 'C1D1', 'Dia 1 do Ciclo 1', 1, 'Ciclo 1', 0, 'Cycle 1 Day 1', 'Sim', 'modelo', 'RANDOMIZACAO', 0, 0, 'BR-A; BR-C', 'Não'],
    ['SOA-C1D8', 'Estudo A', 'C1D8', 'Dia 8 do Ciclo 1', 2, 'Ciclo 1', 7, 'Cycle 1 Day 8', 'Sim', 'modelo', 'SOA-C1D1', 2, 2, 'BR-A; BR-C', 'Não'],
    ['SOA-C2D1', 'Estudo A', 'C2D1', 'Dia 1 do Ciclo 2', 20, 'Ciclo 2', 0, 'Cycle 2 Day 1', 'Sim', 'ajuste específico', 'RANDOMIZACAO', 1, 1, 'BR-A; BR-C', 'Sim']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  let nextId = 0;
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: { getUuid: () => `NOVO-${++nextId}` }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const payload = { projeto: 'Estudo A', cicloModelo: 1, ciclosDestino: '2–3' };
  const preview = server.validarReplicacaoCiclosSoA(payload);
  const byCode = Object.fromEntries(Array.from(preview.visitas, item => [item.codigo, item]));

  assert.equal(preview.ok, true);
  assert.equal(preview.novas, 3);
  assert.equal(preview.existentes, 1);
  assert.equal(byCode.C2D1.status, 'EXISTENTE_DIFERENTE');
  assert.ok(byCode.C2D1.diferencas.includes('janela'));
  assert.equal(byCode.C2D8.referencia, 'SOA-C2D1');
  assert.equal(byCode.C3D8.referencia, byCode.C3D1.idSoA);
  assert.deepEqual(Array.from(byCode.C3D8.bracoIds), ['BR-A', 'BR-C']);
  assert.deepEqual([byCode.C3D8.intervaloDias, byCode.C3D8.janelaDiasMenos, byCode.C3D8.janelaDiasMais], [7, 2, 2]);
  assert.match(byCode.C3D8.nome, /Ciclo 3/);
  assert.deepEqual(Array.from(byCode.C3D8.aliases), ['Cycle 3 Day 8']);

  const result = server.criarCiclosSoAPorReplicacao({ ...payload, assinaturaPrevia: preview.assinaturaPrevia });
  const saved = server.getSoAVisitasProjeto('Estudo A');
  const savedByCode = Object.fromEntries(Array.from(saved, item => [item.codigo, item]));
  assert.equal(result.criadas, 3);
  assert.equal(saved.length, 6);
  assert.equal(savedByCode.C2D1.observacoes, 'ajuste específico');
  assert.equal(savedByCode.C2D8.referencia, 'SOA-C2D1');
  assert.equal(savedByCode.C3D8.referencia, savedByCode.C3D1.idSoA);
  assert.notEqual(savedByCode.C3D1.idSoA, savedByCode.C3D8.idSoA);
  assert.deepEqual(Array.from(savedByCode.C3D8.bracoIds), ['BR-A', 'BR-C']);
});

test('fase SoA: replicação bloqueia código existente com braços diferentes e exige prévia atual', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)', 'Janela dias menos', 'Janela dias mais', 'Bracos (IDs)'],
    ['SOA-1', 'Estudo A', 'C1D1', 'Dia 1 do Ciclo 1', 1, '', 0, '', 'Sim', '', 'RANDOMIZACAO', 0, 0, 'BR-A'],
    ['SOA-2', 'Estudo A', 'C2D1', 'Dia 1 do Ciclo 2', 2, '', 0, '', 'Sim', '', 'RANDOMIZACAO', 0, 0, 'BR-B']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const conflict = server.validarReplicacaoCiclosSoA({ projeto: 'Estudo A', cicloModelo: 1, ciclosDestino: '2' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflitos, 1);
  assert.match(conflict.erros[0], /braços diferentes/);
  assert.throws(() => server.criarCiclosSoAPorReplicacao({ projeto: 'Estudo A', cicloModelo: 1, ciclosDestino: '2', assinaturaPrevia: conflict.assinaturaPrevia }), /conflitos/);

  const cleanPreview = server.validarReplicacaoCiclosSoA({ projeto: 'Estudo A', cicloModelo: 1, ciclosDestino: '3' });
  soa.appendRow(['SOA-3', 'Estudo A', 'C3D1', 'Dia 1 do Ciclo 3', 3, '', 0, '', 'Sim', '', 'RANDOMIZACAO', 0, 0, 'BR-A']);
  assert.throws(() => server.criarCiclosSoAPorReplicacao({ projeto: 'Estudo A', cicloModelo: 1, ciclosDestino: '3', assinaturaPrevia: cleanPreview.assinaturaPrevia }), /mudou desde a prévia/);
});

test('fase SoA: replicação encadeia referência externa ao ciclo-modelo entre os ciclos de destino', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)', 'Janela dias menos', 'Janela dias mais', 'Bracos (IDs)'],
    ['SOA-C44D1', 'Estudo A', 'C44D1', 'Dia 1 do Ciclo 44', 44, '', 28, '', 'Sim', '', 'SOA-C43D1', 7, 7, 'BR-A'],
    ['SOA-C45D1', 'Estudo A', 'C45D1', 'Dia 1 do Ciclo 45', 45, '', 28, '', 'Sim', '', 'SOA-C44D1', 7, 7, 'BR-A']
  ]);
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Detalhes Visita / Complemento', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações', 'Laboratório', 'Status', 'Visitas aplicáveis (IDs SoA)', 'Braços aplicáveis (IDs)'],
    ['KIT-A', 'Estudo A', 'Kit do ciclo', '', 'Kit', 'Sala A', 0, '', 'Lab A', 'Ativo', 'SOA-C45D1', 'BR-A'],
    ['BULK-A', 'Estudo A', 'Bulk do ciclo', '', 'Bulk Supply', 'Sala A', 0, '', 'Lab B', 'Ativo', 'SOA-C45D1', 'BR-A'],
    ['MAT-A', 'Estudo A', 'Material comum', '', 'Material', 'Sala A', 0, '', 'Lab A', 'Ativo', 'SOA-C45D1', 'BR-A']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa, Itens: itens });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: { getUuid: (() => { let id = 0; return () => `NOVO-${++id}`; })() }
  });
  server.getProjetosAtivosEstoque_ = () => [];
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const payload = { projeto: 'Estudo A', cicloModelo: 45, ciclosDestino: '46–50' };
  const preview = server.validarReplicacaoCiclosSoA(payload);
  const previewByCode = Object.fromEntries(Array.from(preview.visitas, item => [item.codigo, item]));

  assert.equal(preview.ok, true);
  assert.equal(preview.novas, 5);
  assert.equal(preview.modelosEstoque, 2);
  assert.equal(preview.novosVinculosEstoque, 10);
  assert.equal(previewByCode.C46D1.modelosEstoqueReplicados, 2);
  assert.equal(previewByCode.C46D1.referencia, 'SOA-C45D1');
  assert.equal(previewByCode.C47D1.referencia, previewByCode.C46D1.idSoA);
  assert.equal(previewByCode.C48D1.referencia, previewByCode.C47D1.idSoA);
  assert.equal(previewByCode.C49D1.referencia, previewByCode.C48D1.idSoA);
  assert.equal(previewByCode.C50D1.referencia, previewByCode.C49D1.idSoA);

  const result = server.criarCiclosSoAPorReplicacao({ ...payload, assinaturaPrevia: preview.assinaturaPrevia });
  const savedByCode = Object.fromEntries(Array.from(server.getSoAVisitasProjeto('Estudo A'), item => [item.codigo, item]));
  assert.equal(result.vinculosEstoqueCriados, 10);
  assert.equal(savedByCode.C46D1.referencia, savedByCode.C45D1.idSoA);
  assert.equal(savedByCode.C47D1.referencia, savedByCode.C46D1.idSoA);
  assert.equal(savedByCode.C48D1.referencia, savedByCode.C47D1.idSoA);
  assert.equal(savedByCode.C49D1.referencia, savedByCode.C48D1.idSoA);
  assert.equal(savedByCode.C50D1.referencia, savedByCode.C49D1.idSoA);
  const visitasCol = itens.rows[0].indexOf('Visitas aplicáveis (IDs SoA)');
  const expectedLinkedIds = ['SOA-C45D1', savedByCode.C46D1.idSoA, savedByCode.C47D1.idSoA, savedByCode.C48D1.idSoA, savedByCode.C49D1.idSoA, savedByCode.C50D1.idSoA];
  assert.deepEqual(String(itens.rows[1][visitasCol]).split('; '), expectedLinkedIds);
  assert.deepEqual(String(itens.rows[2][visitasCol]).split('; '), expectedLinkedIds);
  assert.equal(itens.rows[3][visitasCol], 'SOA-C45D1');
});

test('fase SoA: replicação bloqueia referência deslocada que não existe', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)'],
    ['SOA-C40D1', 'Estudo A', 'C40D1', 'Dia 1 do Ciclo 40', 40, '', 28, '', 'Sim', '', 'RANDOMIZACAO'],
    ['SOA-C45D1', 'Estudo A', 'C45D1', 'Dia 1 do Ciclo 45', 45, '', 28, '', 'Sim', '', 'SOA-C40D1']
  ]);
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ SoA_Visitas: soa }) } });
  const preview = server.validarReplicacaoCiclosSoA({ projeto: 'Estudo A', cicloModelo: 45, ciclosDestino: '46' });

  assert.equal(preview.ok, false);
  assert.equal(preview.podeGravar, false);
  assert.match(preview.erros[0], /referência deslocada C41D1 não foi encontrada/);
});

test('fase SoA: replicação não cria chave cega quando o ciclo aparece somente em campo auxiliar', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes'],
    ['SOA-1', 'Estudo A', 'D1', 'Dia de tratamento', 1, 'Ciclo 1', 0, '', 'Sim', '']
  ]);
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ SoA_Visitas: soa }) } });
  const preview = server.validarReplicacaoCiclosSoA({ projeto: 'Estudo A', cicloModelo: 1, ciclosDestino: '2' });
  assert.equal(preview.ok, false);
  assert.equal(preview.conflitos, 1);
  assert.match(preview.erros[0], /não identifica o Ciclo 1/);
});

test('fase SoA: reordenação manual valida a lista completa, persiste em lote e não altera outro projeto', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes'],
    ['SOA-1', 'Estudo A', 'V1', 'Baseline', 1, '', '', '', 'Sim', ''],
    ['SOA-B', 'Estudo B', 'V1', 'Outra visita', 7, '', '', '', 'Sim', ''],
    ['SOA-2', 'Estudo A', 'V2', 'Semana 4', 2, '', '', '', 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  assert.throws(() => server.reordenarSoAVisitas({ projeto: 'Estudo A', idsSoA: ['SOA-2'] }), /lista de visitas mudou/i);
  assert.equal(soa.rows[0].includes('Ordem manual'), false);

  const result = server.reordenarSoAVisitas({ projeto: 'Estudo A', idsSoA: ['SOA-2', 'SOA-1'] });
  const ordemManualCol = soa.rows[0].indexOf('Ordem manual');
  const visitas = server.getSoAVisitasProjeto('Estudo A');
  assert.equal(result.total, 2);
  assert.deepEqual(Array.from(visitas, item => item.idSoA), ['SOA-2', 'SOA-1']);
  assert.deepEqual(Array.from(visitas, item => item.ordem), [1, 2]);
  assert.deepEqual(Array.from(visitas, item => item.ordemManual), [true, true]);
  assert.equal(soa.rows[2][4], 7);
  assert.equal(soa.rows[2][ordemManualCol], '');
});

test('fase SoA: referência e janelas opcionais são lidas sem exigir migração dos legados', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)', 'Janela dias menos', 'Janela dias mais'],
    ['SOA-1', 'Estudo A', 'V1', 'Randomização', 10, '', '', '', 'Sim', '', '', '', ''],
    ['SOA-2', 'Estudo A', 'V2', 'Seguimento', 20, 'mensal', 28, '', 'Sim', '', 'SOA-1', 3, 5]
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  const visitas = server.getSoAVisitasProjeto('Estudo A');

  assert.equal(visitas[1].referencia, 'SOA-1');
  assert.equal(visitas[1].janelaDiasMenos, 3);
  assert.equal(visitas[1].janelaDiasMais, 5);
  assert.equal(visitas[0].janelaDiasMenos, '');
});

test('fase SoA: salvar janela adiciona cabeçalhos ao schema legado e mantém a linha editável', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes'],
    ['SOA-1', 'Estudo A', 'V1', 'Baseline', 10, '', '', '', 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  server.salvarSoAVisita({
    idSoA: 'SOA-1', projeto: 'Estudo A', codigo: 'V1', nome: 'Baseline', ordem: 10,
    intervaloDias: 0, referencia: 'RANDOMIZACAO', janelaDiasMenos: 3, janelaDiasMais: 5
  });

  assert.equal(soa.rows[0][10], 'Referência (após)');
  assert.equal(soa.rows[0][11], 'Janela dias menos');
  assert.equal(soa.rows[0][12], 'Janela dias mais');
  assert.equal(soa.rows[1][10], 'RANDOMIZACAO');
  assert.equal(soa.rows[1][11], 3);
  assert.equal(soa.rows[1][12], 5);
  assert.throws(() => server.salvarSoAVisita({ projeto: 'Estudo A', nome: 'V2', janelaDiasMais: -1 }), /janela de dias mais/);
});

test('fase SoA: associação opcional de braços é lida e preservada sem quebrar linhas legadas', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)', 'Janela dias menos', 'Janela dias mais'],
    ['SOA-1', 'Estudo A', 'V1', 'Comum', 1, '', '', '', 'Sim', '', '', '', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  server.salvarSoAVisita({ idSoA: 'SOA-1', projeto: 'Estudo A', nome: 'Comum', bracoIds: ['BR-2', 'BR-1', 'BR-2'] });
  const visitas = server.getSoAVisitasProjeto('Estudo A');
  assert.deepEqual(Array.from(visitas[0].bracoIds), ['BR-2', 'BR-1']);
  assert.equal(soa.rows[0][13], 'Braços (IDs)');
  assert.equal(soa.rows[1][13], 'BR-2; BR-1');
});

test('fase SoA: importador cria braços, resolve referências por código e mantém visitas comuns', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes']
  ]);
  const bracos = new FakeSheet('Projeto_Bracos', [
    ['ID_Braco', 'Projeto', 'Nome do braço', 'Ordem', 'Ativo', 'Observações']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa, Projeto_Bracos: bracos });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  const payload = {
    projeto: 'Estudo A',
    dados: {
      projeto: { nomeAbreviado: 'Estudo A' },
      visitasComuns: [{ codigo: 'V1', nome: 'Baseline', ordem: 1, intervaloDias: null, referenciaTipo: 'RANDOMIZACAO', aliases: ['V0'] }],
      variantesPorBraco: [{ braco: 'BraÃ§o A', visitas: [{ codigo: 'V2', nome: 'Semana 4', ordem: 2, intervaloDias: 28, referenciaTipo: 'VISITA_ESPECIFICA', referenciaCodigo: 'V1', janelaDiasMenos: 3, janelaDiasMais: 5 }] }]
    },
    modo: 'adicionar', criarBracos: true
  };
  const preview = server.validarImportacaoSoA(payload);
  assert.equal(preview.ok, true);
  assert.deepEqual(Array.from(preview.missingBracos), ['BraÃ§o A']);
  assert.deepEqual(Array.from(preview.visitas, item => [item.ordemRecebida, item.ordemSugerida]), [[1, 1], [2, 2]]);
  assert.equal(preview.mudancasOrdemSugerida, 0);
  const result = server.importarSoAJson(payload);
  assert.equal(result.ok, true);
  assert.equal(result.bracosCriados, 1);
  assert.equal(result.adicionadas, 2);
  const visitas = server.getSoAVisitasProjeto('Estudo A');
  assert.equal(visitas.length, 2);
  assert.equal(visitas[0].referencia, 'RANDOMIZACAO');
  assert.equal(visitas[1].referencia, visitas[0].idSoA);
  assert.equal(visitas[1].bracoIds.length, 1);
  assert.equal(server.getBracosProjeto('Estudo A').length, 1);
});

test('fase SoA: importador no modo adicionar não duplica visitas já existentes', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)', 'Janela dias menos', 'Janela dias mais', 'BraÃ§os (IDs)'],
    ['SOA-1', 'Estudo A', 'V1', 'Baseline', 1, '', '', '', 'Sim', '', 'RANDOMIZACAO', '', '', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  const payload = { projeto: 'Estudo A', dados: { projeto: { nomeAbreviado: 'Estudo A' }, visitasComuns: [{ codigo: 'V1', nome: 'Baseline', ordem: 1, referenciaTipo: 'RANDOMIZACAO' }] }, modo: 'adicionar', criarBracos: true };
  const result = server.importarSoAJson(payload);
  assert.equal(result.ignoradas, 1);
  assert.equal(soa.rows.length, 2);
});

test('fase SoA: importação em modo atualizar preserva ordem manual e atualiza os demais campos', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes', 'Referencia (apos)', 'Janela dias menos', 'Janela dias mais', 'Bracos (IDs)', 'Ordem manual'],
    ['SOA-1', 'Estudo A', 'V1', 'Baseline antiga', 20, '', '', '', 'Sim', '', 'RANDOMIZACAO', '', '', '', 'Sim'],
    ['SOA-2', 'Estudo A', 'V2', 'Semana antiga', 30, '', '', '', 'Sim', '', 'SOA-1', '', '', '', 'Não']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  const payload = {
    projeto: 'Estudo A', modo: 'atualizar', criarBracos: true,
    dados: { projeto: { nomeAbreviado: 'Estudo A' }, visitasComuns: [
      { codigo: 'V1', nome: 'Baseline atualizada', ordem: 1, referenciaTipo: 'RANDOMIZACAO' },
      { codigo: 'V2', nome: 'Semana atualizada', ordem: 2, referenciaTipo: 'VISITA_ESPECIFICA', referenciaCodigo: 'V1' },
      { codigo: 'V3', nome: 'Visita nova', ordem: 3, referenciaTipo: 'VISITA_ESPECIFICA', referenciaCodigo: 'V2' }
    ] }
  };

  const preview = server.validarImportacaoSoA(payload);
  const result = server.importarSoAJson(payload);
  const visitas = server.getSoAVisitasProjeto('Estudo A');
  const porCodigo = Object.fromEntries(Array.from(visitas, item => [item.codigo, item]));
  assert.equal(preview.ordensManuaisPreservadas, 1);
  assert.equal(result.ordensManuaisPreservadas, 1);
  assert.equal(porCodigo.V1.ordem, 20);
  assert.equal(porCodigo.V1.nome, 'Baseline atualizada');
  assert.equal(porCodigo.V2.ordem, 2);
  assert.equal(porCodigo.V2.nome, 'Semana atualizada');
  assert.equal(porCodigo.V3.ordem, 31);
});

test('fase SoA: salvar visita atualiza registro existente sem duplicar', () => {
  const soa = new FakeSheet('SoA_Visitas', [
    ['ID_SoA', 'Projeto', 'Codigo da visita', 'Nome padrao da visita', 'Ordem', 'Repeticao', 'Intervalo (dias)', 'Aliases', 'Ativo', 'Observacoes'],
    ['SOA-1', 'Estudo A', 'V1', 'Baseline', 10, '', '', '', 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ SoA_Visitas: soa });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  server.salvarSoAVisita({ idSoA: 'SOA-1', projeto: 'Estudo A', codigo: 'V1', nome: 'Baseline atualizado', ordem: 5, aliases: 'V0; Triagem' });
  assert.equal(soa.rows.length, 2);
  assert.equal(soa.rows[1][3], 'Baseline atualizado');
  assert.equal(soa.rows[1][7], 'V0; Triagem');
  assert.equal(soa.rows[0][14], 'Ordem manual');
  assert.equal(soa.rows[1][14], 'Sim');
});

test('fase braços: catálogo do projeto ordena opções sem alterar a compatibilidade legada', () => {
  const bracos = new FakeSheet('Projeto_Bracos', [
    ['ID_Braco', 'Projeto', 'Nome do braço', 'Ordem', 'Ativo', 'Observações'],
    ['BR-2', 'Estudo A', 'Placebo', 20, 'Sim', ''],
    ['BR-1', 'Estudo A', 'Braço A', 10, 'Sim', ''],
    ['BR-3', 'Estudo A', 'Descontinuado', 30, 'Não', ''],
    ['BR-4', 'Estudo B', 'Controle', 10, 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Projeto_Bracos: bracos });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  const lista = server.getBracosProjeto('estudo a');
  assert.deepEqual(Array.from(lista, item => item.nome), ['Braço A', 'Placebo', 'Descontinuado']);
  assert.equal(lista.filter(item => item.ativo).length, 2);
});

test('fase braços: atualização do catálogo não duplica o braço', () => {
  const bracos = new FakeSheet('Projeto_Bracos', [
    ['ID_Braco', 'Projeto', 'Nome do braço', 'Ordem', 'Ativo', 'Observações'],
    ['BR-1', 'Estudo A', 'Braço A', 10, 'Sim', '']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Projeto_Bracos: bracos });
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet } });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  server.salvarBracoProjeto({ idBraco: 'BR-1', projeto: 'Estudo A', nome: 'Braço A atualizado', ordem: 5 });
  assert.equal(bracos.rows.length, 2);
  assert.equal(bracos.rows[1][2], 'Braço A atualizado');
});

test('fase 2: lotes com mesma validade mantêm identidade distinta na lista de kits', () => {
  const server = agendaKitContext();
  server.getEstoque = () => [
    { idItem: 'KIT-A', idLote: 'LOTE-1', descricao: 'Kit Alpha', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1 },
    { idItem: 'KIT-A', idLote: 'LOTE-2', descricao: 'Kit Alpha', tipoItem: 'Kit coleta', projeto: 'Estudo A', validade: '30/11/2026', qtde: 1 }
  ];

  const kits = server.getAgendaKitsEstoque_(true);
  assert.equal(kits.length, 2);
  assert.deepEqual(Array.from(kits, kit => kit.idLote), ['LOTE-1', 'LOTE-2']);
});

test('fase 2: salvar item adiciona a coluna de ordem sem deslocar o layout legado', () => {
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Detalhes Visita / Complemento', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações', 'Laboratório', 'Status'],
    ['0001', 'Estudo A', 'Kit coleta', 'V1', 'Kit', 'Estoque Principal', 0, '', 'Lab A', 'Ativo']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet }
  });
  server.getProjetosAtivosEstoque_ = () => [];
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();

  server.salvarItemEstoque({
    id: '2', projeto: 'Estudo A', descricao: 'Kit coleta', tipo: 'Kit',
    localizacao: 'Estoque Principal', estoqueMin: 0, observacoes: '',
    laboratorio: 'Lab A', status: 'Ativo', ordem: 10
  });

  assert.equal(itens.rows[0][10], 'Ordem de utilização');
  assert.equal(itens.rows[1][3], 'V1');
  assert.equal(itens.rows[1][10], 10);
});

test('fase 2: migração de lotes cria ID_Lote sem alterar linhas existentes', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '30/11/2026', 'Estoque Principal', 4, 0, 'OK', '', 'a@ucs.br', '', 'PED-1'],
    ['KIT-2', 'Estudo A', 'Kit coleta 2', 'Kit', '31/12/2026', 'Laboratório', 2, 0, 'OK', '', 'a@ucs.br', '', 'PED-2']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => {}
    },
    Utilities: { getUuid: () => 'UUID-LOTE-1' }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();

  const result = server.migrarIdsLotesEstoque();

  assert.equal(result.preenchidos, 2);
  assert.equal(estoque.rows[0][13], 'ID_Lote');
  assert.equal(estoque.rows[1][13], 'UUID-LOTE-1');
  assert.equal(estoque.rows[2][13], 'UUID-LOTE-1');
});

test('fase 3: reserva manual vincula agenda ao lote sem reduzir saldo físico', () => {
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações', 'Laboratório', 'Status', 'Ordem de utilização'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', 'Estoque Principal', 0, '', 'Lab A', 'Ativo', 10]
  ]);
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', '31/12/2026', 'Estoque Principal', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens, Estoque: estoque, Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'RES-1', formatDate: value => {
      const d = new Date(value);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    } }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.reservarKitsAgendaEvento({
    agendaId: 'EVT-1', projeto: 'Estudo A', participante: 'Pessoa A', participanteId: 'PART-1', data: '2026-12-15',
    kits: [{ idItem: 'KIT-1', idLote: 'LOTE-1', qtde: 1 }]
  });

  assert.equal(result.reservados, 1);
  assert.equal(reservas.rows.length, 2);
  assert.equal(reservas.rows[1][15], 'PART-1');
  assert.equal(server.getKitsAgendaReservaStatus('EVT-1').reservado, true);
  const lote = server.getEstoque().find(item => item.idLote === 'LOTE-1');
  assert.equal(lote.qtdeFisica, 3);
  assert.equal(lote.qtdeReservada, 1);
  assert.equal(lote.qtdeDisponivel, 2);
});

test('fase 7: baixa seleciona o lote informado quando existem validades iguais', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Estoque Principal', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-A'],
    ['KIT-1', 'Estudo A', 'Kit coleta', 'Kit', '31/12/2026', 'Estoque Principal', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-B']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de Movimento', 'ID_Item', 'Descrição', 'Tipo de Item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID Participante', 'Participante', 'ID Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque, Movimentações: mov });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'MOV-LOTE', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  server.registrarMovimentacaoEstoque({
    idItem: 'KIT-1', idLote: 'LOTE-B', qtde: 1, tipoMovimento: 'Saida - Visita',
    projeto: 'Estudo A', localizacao: 'Estoque Principal', origem: 'Agenda kit EVT-1'
  });

  assert.equal(estoque.rows[1][6], 2);
  assert.equal(estoque.rows[2][6], 1);
  assert.equal(mov.rows[1][10], 'LOTE-B');
});

test('fase 3: transferência move o lote entre localizações com uma operação compartilhada', () => {
  const itens = new FakeSheet('Itens', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Observações', 'Laboratório', 'Status'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', 'Estoque Principal', 0, '', 'Lab A', 'Ativo']
  ]);
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', '31/12/2026', 'Estoque Principal', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de Movimento', 'ID_Item', 'Descrição', 'Tipo de Item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID Participante', 'Participante', 'ID Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Itens: itens, Estoque: estoque, Movimentações: mov });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'TRANS-1', formatDate: value => {
      const d = new Date(value);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    } }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();
  const reservasTransferencia = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista']
  ]);
  server.getKitReservasSheet_ = () => reservasTransferencia;

  assert.throws(() => server.transferirKitEstoque({
    idItem: 'KIT-1', idLote: 'LOTE-1', origem: 'Estoque Principal', destino: 'Laboratório', qtde: 1
  }), /deve ser reservado/);

  const result = server.transferirKitEstoque({
    idItem: 'KIT-1', idLote: 'LOTE-1', origem: 'Estoque Principal', destino: 'Laboratório', qtde: 2,
    reserva: {
      participanteId: 'PART-1', participante: 'Pessoa A', projeto: 'Estudo A',
      visitaPrevista: 'T-2', dataVisita: '2026-12-15'
    }
  });

  assert.equal(result.quantidade, 2);
  assert.equal(estoque.rows.length, 3);
  assert.equal(estoque.rows[1][6], 1);
  assert.equal(estoque.rows[2][5], 'Laboratório');
  assert.equal(estoque.rows[2][6], 2);
  assert.equal(mov.rows.length, 3);
  assert.equal(mov.rows[1][0], mov.rows[2][0]);
  assert.equal(mov.rows[1][2], 'Saída - Transferência');
  assert.equal(mov.rows[2][2], 'Entrada - Transferência');
  assert.equal(reservasTransferencia.rows.length, 2);
  assert.equal(reservasTransferencia.rows[1][4], 'Pessoa A');
  assert.equal(reservasTransferencia.rows[1][15], 'PART-1');
  assert.equal(reservasTransferencia.rows[1][16], 'T-2');
});

test('fase 5: concilia kit já no Laboratório sem movimentar o saldo físico', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['KIT-1', 'Estudo A', 'Kit coleta V1', 'Kit', '31/12/2026', 'Laboratório', 2, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-1']
  ]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Estoque: estoque, Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'RES-CONCILIADA', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.conciliarReservaKitLaboratorio({
    idItem: 'KIT-1', idLote: 'LOTE-1', qtde: 2, participanteId: 'PART-1', participante: 'Pessoa A',
    projeto: 'Estudo A', visitaPrevista: 'Follow-up 1', dataVisita: '2026-12-15'
  });

  assert.equal(result.ok, true);
  assert.equal(estoque.rows[1][6], 2);
  assert.equal(reservas.rows.length, 2);
  assert.equal(reservas.rows[1][4], 'Pessoa A');
  assert.equal(reservas.rows[1][9], 'Laboratório');
  assert.equal(reservas.rows[1][10], 2);
  assert.equal(reservas.rows[1][16], 'Follow-up 1');
});

test('fase 5: Bulk Supply não exige reserva de participante', () => {
  const estoque = new FakeSheet('Estoque', [
    ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote'],
    ['BULK-1', 'Estudo A', 'Slides', 'Bulk Supply', '31/12/2026', 'Estoque Principal', 3, 0, 'OK', '', 'a@ucs.br', '', '', 'LOTE-B']
  ]);
  const mov = new FakeSheet('Movimentações', [
    ['ID_Mov', 'Data/Hora', 'Tipo de Movimento', 'ID_Item', 'Descrição', 'Tipo de Item', 'Projeto', 'Qtde', 'Validade', 'Localização', 'Lote', 'ID Participante', 'Participante', 'ID Visita', 'Responsável', 'Origem', 'Observação']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Estoque: estoque, Movimentações: mov }), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'TRANS-BULK', formatDate: value => String(value) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const result = server.transferirKitEstoque({
    idItem: 'BULK-1', idLote: 'LOTE-B', origem: 'Estoque Principal', destino: 'Laboratório', qtde: 1
  });

  assert.equal(result.ok, true);
  assert.equal(estoque.rows[1][6], 2);
  assert.equal(estoque.rows[2][5], 'Laboratório');
  assert.equal(estoque.rows[2][6], 1);
});

test('painel de alertas classifica reservas, validade e baixas sem conciliação', () => {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  const alertas = server.montarAlertasEstoque_([
    {
      tipoItem: 'Kit',
      projeto: 'Estudo A',
      descricao: 'Kit vencido',
      lotes: [{ validade: '01/01/2026', qtdeFisica: 2, localizacao: 'Estoque Principal', idLote: 'L-1' }]
    }
  ], [
    { idReserva: 'R-1', projeto: 'Estudo A', participante: 'Pessoa A', descricao: 'Kit A', semVisitaConciliada: true },
    { idReserva: 'R-2', projeto: 'Estudo A', participante: 'Pessoa B', descricao: 'Kit B', proxima: true },
    { idReserva: 'R-3', projeto: 'Estudo A', participante: 'Pessoa C', descricao: 'Kit C', validadeInsuficiente: true }
  ], [
    { idItem: 'KIT-BAIXADO', descricao: 'Kit baixado', projeto: 'Estudo A', agendaId: 'AG-1', qtde: 1 }
  ], new Date(2026, 7, 12));

  assert.equal(alertas.reservasSemVisita.count, 1);
  assert.equal(alertas.visitasProximas.count, 1);
  assert.equal(alertas.validadeInsuficiente.count, 1);
  assert.equal(alertas.kitsVencidos.count, 1);
  assert.equal(alertas.kitsBaixadosSemConciliacao.count, 1);
  assert.equal(alertas.total, 5);
});

test('piloto importa reserva existente sem movimentar o saldo e sinaliza conferência física pendente', () => {
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista', 'Accession_Number']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Reservas_Kits: reservas }), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();
  server.getKitReservasSheet_ = () => reservas;
  server.getKitReservasLinhas_ = () => [];
  server.getEstoqueLinhas_ = () => [{ idItem: 'KIT-1', projeto: 'Estudo A', descricao: 'Kit coleta V1', tipoItem: 'Kit', idLote: 'LOTE-1', validade: '31/12/2026', localizacao: 'Laboratório', qtde: 3, accessionNumber: '' }];
  server.gerarIdLoteEstoque_ = () => 'RES-NEW';

  const result = server.importarReservasOperacionais({ linhas: [{ projeto: 'Estudo A', participante: 'Pessoa A', participanteId: 'P-1', idItem: 'KIT-1', idLote: 'LOTE-1', visitaPrevista: 'V1', dataVisita: '15/12/2026', qtde: 1 }] });

  assert.equal(result.importados, 1);
  assert.equal(reservas.rows.length, 2);
  assert.equal(reservas.rows[1][11], 'Reservado');
  assert.match(String(reservas.rows[1][14]), /Conferência física pendente/);
  assert.equal(reservas.rows[1][9], 'Laboratório');
});

test('piloto registra conferência física e mantém divergência explícita', () => {
  const conferencias = new FakeSheet('Conferencias_Laboratorio', [
    ['ID_Conferencia', 'Data_Conferencia', 'ID_Reserva', 'Projeto', 'Participante', 'ID_Participante', 'ID_Item', 'ID_Lote', 'Accession_Number', 'Descrição', 'Validade', 'Qtde_Esperada', 'Qtde_Conferida', 'Divergencia', 'Status', 'Responsável', 'Observações']
  ]);
  const reserva = { idReserva: 'RES-1', projeto: 'Estudo A', participante: 'Pessoa A', participanteId: 'P-1', idItem: 'KIT-1', idLote: 'LOTE-1', descricao: 'Kit coleta', validade: '31/12/2026', localizacao: 'Laboratório', qtde: 2, status: 'Reservado', accessionNumber: '' };
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({}), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }) }
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_acao, callback) => callback();
  server.getKitReservasLinhas_ = () => [reserva];
  server.getKitConferenciasSheet_ = () => conferencias;
  server.gerarIdLoteEstoque_ = () => 'CONF-1';

  const result = server.registrarConferenciaLaboratorio({ idReserva: 'RES-1', qtdeConferida: 1 });

  assert.equal(result.status, 'Divergência');
  assert.equal(result.divergencia, -1);
  assert.equal(conferencias.rows[1][14], 'Divergência');
  assert.equal(conferencias.rows[1][13], -1);
});

test('rastreabilidade individual mantém Accession Number opcional e separado do lote', () => {
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) }
  });
  const headers = ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote', 'Accession_Number'];
  const map = server.getEstoqueColumnMap_(headers);
  assert.equal(map.idLote, 13);
  assert.equal(map.accessionNumber, 14);
  assert.equal(server.getEstoqueColumnMap_(['ID_Item', 'ID_Lote', 'Accession Number']).accessionNumber, 2);
  const agrupados = server.agruparEstoquePorItemValidade_([
    { projeto: 'Estudo A', descricao: 'Kit', tipoItem: 'Kit', validade: '31/12/2026', localizacao: 'Principal', status: 'OK', idLote: 'L-1', accessionNumber: 'ACC-1', qtde: 1 },
    { projeto: 'Estudo A', descricao: 'Kit', tipoItem: 'Kit', validade: '31/12/2026', localizacao: 'Principal', status: 'OK', idLote: 'L-1', accessionNumber: 'ACC-2', qtde: 1 }
  ]);
  assert.equal(agrupados.length, 2);
});

test('fase 6: encontra visita da Agenda por participante e projeto sem exigir o mesmo rótulo de visita', () => {
  const agendaHeaders = Array.from({ length: 51 }, (_, index) => 'C' + (index + 1));
  const agendaRow = Array.from({ length: 51 }, () => '');
  agendaRow[0] = 'AG-42';
  agendaRow[1] = '2026-12-15';
  agendaRow[3] = 'Visita';
  agendaRow[4] = 'Agendado';
  agendaRow[5] = 'Pessoa A';
  agendaRow[7] = 'PART-1';
  agendaRow[8] = 'Estudo A';
  agendaRow[10] = 'Visita 4 - nome do SoA';
  const agenda = new FakeSheet('Agenda', [agendaHeaders, agendaRow]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-1', '', '', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'PART-1', 'Follow-up 3']
  ]);
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Agenda: agenda, Reservas_Kits: reservas }), flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { formatDate: value => String(value) }
  });
  server.getAgendaSheetForRead_ = () => agenda;
  server.getKitReservasSheet_ = () => reservas;
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.AgendaServerRules_ = { isCancelled: status => String(status || '').toLowerCase() === 'cancelado' };
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const encontrados = server.getAgendaCandidatosReservaKit({ idReserva: 'RES-1' });
  assert.equal(encontrados.candidatos.length, 1);
  assert.equal(encontrados.candidatos[0].id, 'AG-42');
  assert.equal(encontrados.candidatos[0].visita, 'Visita 4 - nome do SoA');

  const result = server.vincularReservaKitAgenda({ idReserva: 'RES-1', agendaId: 'AG-42', rowIndex: 2 });
  assert.equal(result.ok, true);
  assert.equal(reservas.rows[1][2], 'AG-42');
});

test('fase 6: visita histórica sem ID recebe identificador interno ao vincular a reserva', () => {
  const agendaHeaders = Array.from({ length: 51 }, (_, index) => 'C' + (index + 1));
  const agendaRow = Array.from({ length: 51 }, () => '');
  agendaRow[1] = '2026-12-15'; agendaRow[3] = 'Visita'; agendaRow[4] = 'Agendado'; agendaRow[5] = 'Pessoa A'; agendaRow[7] = 'PART-1'; agendaRow[8] = 'Estudo A'; agendaRow[10] = 'FU 3';
  const agenda = new FakeSheet('Agenda', [agendaHeaders, agendaRow]);
  const reservas = new FakeSheet('Reservas_Kits', [
    ['ID_Reserva', 'Data_Reserva', 'Agenda_ID', 'Projeto', 'Participante', 'ID_Item', 'ID_Lote', 'Descrição', 'Validade', 'Localização', 'Qtde', 'Status', 'Data_Visita', 'Responsável', 'Observações', 'ID_Participante', 'Visita_Prevista'],
    ['RES-2', '', '', 'Estudo A', 'Pessoa A', 'KIT-1', 'LOTE-1', 'Kit coleta', '31/12/2026', 'Laboratório', 1, 'Reservado', '15/12/2026', '', '', 'PART-1', 'Follow-up 3']
  ]);
  const spreadsheet = new FakeSpreadsheet({ Agenda: agenda, Reservas_Kits: reservas });
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@ucs.br' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: { getUuid: () => 'HIST-1', formatDate: value => String(value) }
  });
  server.getAgendaSheetForRead_ = () => agenda;
  server.getKitReservasSheet_ = () => reservas;
  server.codexGetCurrentUserAccess = () => ({ ok: true, role: 'admin' });
  server.AgendaServerRules_ = { isCancelled: status => String(status || '').toLowerCase() === 'cancelado' };
  server.codexAssertCanWrite_ = () => {};
  server.codexWithDocumentLock_ = (_action, callback) => callback();

  const candidatos = server.getAgendaCandidatosReservaKit({ idReserva: 'RES-2' }).candidatos;
  assert.equal(candidatos[0].semId, true);
  const result = server.vincularReservaKitAgenda({ idReserva: 'RES-2', rowIndex: 2 });
  assert.equal(result.ok, true);
  assert.equal(agenda.rows[1][0], 'AG-HIST-1');
  assert.equal(reservas.rows[1][2], 'AG-HIST-1');
});
