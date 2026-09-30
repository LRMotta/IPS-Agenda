'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function measure(sheet) {
  const stats = { reads: 0, writes: 0, formats: 0, lists: 0 };
  let grouped = 0;
  const range = sheet.getRange.bind(sheet);
  const data = sheet.getDataRange.bind(sheet);
  function wrap(r) {
    for (const [method, counter] of [['getValues', 'reads'], ['setValues', 'writes'], ['setNumberFormat', 'formats']]) {
      const original = r[method].bind(r);
      r[method] = (...args) => { if (!grouped) stats[counter]++; return original(...args); };
    }
    return r;
  }
  sheet.getRange = (...args) => wrap(range(...args));
  sheet.getDataRange = () => wrap(data());
  const rangeList = sheet.getRangeList.bind(sheet);
  sheet.getRangeList = (...args) => {
    stats.lists++;
    const list = rangeList(...args);
    for (const [method, counter] of [['setValue', 'writes'], ['setNumberFormat', 'formats']]) {
      const original = list[method].bind(list);
      list[method] = (...values) => { stats[counter]++; grouped++; try { return original(...values); } finally { grouped--; } };
    }
    return list;
  };
  return stats;
}

function context(ss) {
  const locks = { held: false, acquired: 0, released: 0, flushes: 0 };
  let uuid = 0;
  const server = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs'], {
    Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => { assert.equal(locks.held, true); locks.flushes++; } },
    Session: { getActiveUser: () => ({ getEmail: () => 'teste@example.invalid' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Logger: { log: () => {} },
    Utilities: {
      getUuid: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0'),
      formatDate: value => new Date(value).toISOString().slice(0, 10),
      sleep: () => { assert.equal(locks.held, false); }
    },
    LockService: { getDocumentLock: () => null, getScriptLock: () => ({
      tryLock: () => { locks.held = true; locks.acquired++; return true; },
      releaseLock: () => { locks.held = false; locks.released++; }
    }) }
  });
  server.codexAuthorizeWebAppRequest_ = () => ({ ok: true, userEmail: 'teste@example.invalid', role: 'admin' });
  server.codexWriteAuditLog_ = () => {};
  server.clearCodexRuntimeCaches_ = () => {};
  server.clearTransporteOptionsCache_ = () => {};
  server.agendaInvalidateKitsReference_ = () => {};
  return { server, locks };
}

const PROJECT = { nomeAbreviado: 'Projeto A', codigo: 'PA', fase: 'III', status: 'Ativo', especialidade: 'Oncologia', investigador: 'Teste' };

test('Projetos lê, valida e grava sob lock, inclusive exclusão e IDs gerados no mesmo instante', () => {
  const sheet = new FakeSheet('Projetos', [['ID', 'Nome', 'Código']]);
  const { server, locks } = context(new FakeSpreadsheet({ Projetos: sheet }));
  server.Date = class extends Date { static now() { return 123456789; } };
  const original = sheet.getDataRange.bind(sheet);
  sheet.getDataRange = () => { assert.equal(locks.held, true); return original(); };
  server.salvarDadosProjeto(PROJECT);
  server.salvarDadosProjeto({ ...PROJECT, nomeAbreviado: 'Projeto B', codigo: 'PB' });
  assert.notEqual(sheet.rows[1][0], sheet.rows[2][0]);
  const id = sheet.rows[1][0];
  server.salvarDadosProjeto({ ...PROJECT, id, fase: 'IV' });
  assert.equal(sheet.rows[1][4], 'IV');
  server.excluirProjeto(id);
  assert.equal(sheet.rows[1][1], 'Projeto B');
  assert.deepEqual([locks.acquired, locks.released], [4, 4]);
  assert.equal(locks.flushes, 4);
});

test('Projeto concorrente inserido antes da aquisição do lock participa da validação de duplicidade', () => {
  const sheet = new FakeSheet('Projetos', [['ID', 'Nome', 'Código']]);
  const { server, locks } = context(new FakeSpreadsheet({ Projetos: sheet }));
  server.LockService.getScriptLock = () => ({
    tryLock: () => { locks.held = true; sheet.rows.push(['PROJ-OUTRO', 'Projeto A', 'PA']); return true; },
    releaseLock: () => { locks.held = false; }
  });
  assert.throws(() => server.salvarDadosProjeto(PROJECT), /Já existe/);
  assert.equal(sheet.writes, 0);
  assert.equal(sheet.rows.length, 2);
});

test('sem lock disponível, Projeto não lê dados nem inicia gravação', () => {
  const sheet = new FakeSheet('Projetos', [['ID']]);
  const { server } = context(new FakeSpreadsheet({ Projetos: sheet }));
  sheet.getDataRange = () => { throw new Error('leitura fora do lock'); };
  server.LockService.getScriptLock = () => ({ tryLock: () => false });
  assert.throws(() => server.salvarDadosProjeto(PROJECT), /Outra operação/);
  assert.equal(sheet.writes, 0);
});

test('ACL ignora cache persistente e reflete inativação, perfil e permissão de exames diretamente de Users', () => {
  const users = new FakeSheet('Users', [['Email', 'Nome', 'Perfil', 'Ativo', 'Aniversário', 'Formação', 'Registro', 'Pode solicitar exames'], ['teste@example.invalid', 'Teste', 'admin', 'Sim', '', '', '', 'Sim']]);
  const stats = measure(users);
  let cacheCalls = 0;
  const server = runFile('WebApp.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => new FakeSpreadsheet({ Users: users }) },
    CacheService: { getScriptCache: () => { cacheCalls++; return { get: () => JSON.stringify({ 'teste@example.invalid': { role: 'admin', active: true } }) }; } }
  });
  server.codexGetActiveUserEmail_ = () => 'teste@example.invalid';
  server.codexWriteAuditLog_ = () => {};
  assert.equal(server.codexAssertAdmin_().role, 'admin');
  users.rows[1][3] = 'Não';
  assert.throws(() => server.codexAssertCanRead_(), /inativo/);
  users.rows[1][3] = 'Sim'; users.rows[1][2] = 'readonly';
  assert.throws(() => server.codexAssertCanWrite_(), /somente leitura/);
  users.rows[1][2] = 'user'; users.rows[1][7] = 'Não';
  assert.equal(server.codexAssertCanRead_().podeSolicitarExames, 'Não');
  assert.equal(cacheCalls, 0);
  assert.equal(stats.reads, 4);
});

const STOCK_HEADERS = ['ID_Item', 'Projeto', 'Descrição', 'Tipo', 'Validade', 'Localização', 'Qtde', 'EstoqueMin', 'Status', 'UltimaAlteracao', 'Responsavel', 'Qtde_pedida_pendente', 'N_Pedido', 'ID_Lote', 'Accession_Number', 'Extra'];
function receiptFixture(count = 1, existing = true) {
  const cat = new FakeSheet('Itens', [['ID_Item', 'Projeto', 'Descrição', 'Tipo de item', 'Localização padrão', 'Estoque mínimo', 'Laboratório', 'Status']]);
  const pedidos = new FakeSheet('Pedidos', [['ID', 'Número'], ['PED-A', 'N1']]);
  const pi = new FakeSheet('Pedidos_Itens', [['ID', 'Numero', 'Projeto', 'Descrição', 'Tipo', 'ID_Item', 'QtdeSol', 'QtdeRec', 'Status', 'Vínculo']]);
  const stock = new FakeSheet('Estoque', [STOCK_HEADERS]);
  const mov = new FakeSheet('Movimentações', [['ID']]);
  const itens = [];
  for (let i = 0; i < count; i++) {
    const id = 'KIT-' + i;
    cat.rows.push([id, 'Projeto A', 'Kit', 'Kit', 'Laboratório', 2, 'Lab A', 'Ativo']);
    pi.rows.push(['PED-A', 'N1', 'Projeto A', 'Kit', 'Kit', id, 5, 1, 'Parcial', 'MOV-ANTIGO']);
    if (existing) stock.rows.push([id, 'Projeto A', 'Kit', 'Kit', '', 'Laboratório', 1, '=FORMULA', 'OK', '', '', '', 'N1', 'LOTE-' + i, 'ACC-' + i, 'PRESERVAR']);
    itens.push({ idItem: id, qtdRecebida: 2 });
  }
  const sheets = { Itens: cat, Pedidos: pedidos, Pedidos_Itens: pi, Estoque: stock, Movimentações: mov };
  const stats = Object.fromEntries(Object.entries(sheets).map(([key, sheet]) => [key, measure(sheet)]));
  const { server, locks } = context(new FakeSpreadsheet(sheets));
  return { server, locks, sheets, stats, itens };
}

test('recebimento de 1 ou 50 itens faz quatro leituras e seis gravações, preservando extensões e vínculos', () => {
  for (const count of [1, 50]) {
    const f = receiptFixture(count);
    f.server.receberPedidoEstoque({ idPedido: 'PED-A', rowIndex: 2, itens: f.itens });
    assert.equal(Object.values(f.stats).reduce((sum, value) => sum + value.reads, 0), 4);
    assert.equal(Object.values(f.stats).reduce((sum, value) => sum + value.writes, 0), 6);
    for (let i = 1; i <= count; i++) {
      assert.equal(f.sheets.Estoque.rows[i][6], 3);
      assert.equal(f.sheets.Estoque.rows[i][7], '=FORMULA');
      assert.equal(f.sheets.Estoque.rows[i][14], 'ACC-' + (i - 1));
      assert.equal(f.sheets.Estoque.rows[i][15], 'PRESERVAR');
      assert.equal(f.sheets.Pedidos_Itens.rows[i][7], 3);
      assert.equal(f.sheets.Pedidos_Itens.rows[i][9], 'MOV-ANTIGO');
    }
    assert.equal(f.sheets.Movimentações.rows.length, count + 1);
    assert.equal(f.sheets.Pedidos.rows[1][6], 'Parcial');
    assert.deepEqual([f.locks.acquired, f.locks.released], [1, 1]);
  }
});

test('recebimento agrega entradas repetidas no mesmo lote em memória e mantém movimentações individuais', () => {
  const f = receiptFixture(1, false);
  f.server.receberPedidoEstoque({ idPedido: 'PED-A', rowIndex: 2, itens: [{ idItem: 'KIT-0', qtdRecebida: 2 }, { idItem: 'KIT-0', qtdRecebida: 2 }] });
  assert.equal(f.sheets.Estoque.rows.length, 2);
  assert.equal(f.sheets.Estoque.rows[1][6], 4);
  assert.equal(f.sheets.Pedidos_Itens.rows[1][7], 5);
  assert.equal(f.sheets.Pedidos.rows[1][6], 'Recebido');
  assert.equal(f.sheets.Movimentações.rows.length, 3);
  assert.equal(f.stats.Estoque.writes, 1);
});

test('recebimento inválido não cria schema nem grava parcialmente o primeiro item válido', () => {
  const f = receiptFixture(2);
  f.sheets.Estoque.rows[0] = STOCK_HEADERS.slice(0, 13);
  const before = JSON.stringify(f.sheets);
  assert.throws(() => f.server.receberPedidoEstoque({ idPedido: 'PED-A', rowIndex: 2, itens: [f.itens[0], { idItem: 'NÃO EXISTE', qtdRecebida: 1 }] }), /Item não encontrado/);
  assert.equal(JSON.stringify(f.sheets), before);
  assert.equal(Object.values(f.stats).reduce((sum, value) => sum + value.writes, 0), 0);
});

test('recebimento aceita schema legado de Pedido_Itens e localiza pedido por ID com linha antiga', () => {
  const f = receiptFixture();
  f.sheets.Pedidos.rows.unshift(['Ignorar']);
  f.sheets.Pedidos_Itens.rows[1] = ['PI-1', 'PED-A', 'KIT-0', 'Kit', 'Kit', 5, 1, 'Parcial', 'LEGADO'];
  f.server.receberPedidoEstoque({ idPedido: 'PED-A', rowIndex: 2, itens: [{ idItem: 'KIT-0', qtdRecebida: 4 }] });
  assert.equal(f.sheets.Pedidos_Itens.rows[1][6], 5);
  assert.equal(f.sheets.Pedidos_Itens.rows[1][7], 'Recebido');
  assert.equal(f.sheets.Pedidos_Itens.rows[1][8], 'LEGADO');
  assert.equal(f.sheets.Pedidos.rows[2][6], 'Recebido');
});

test('recebimento inicializa Estoque vazio após validar o pedido e os itens', () => {
  const f = receiptFixture(1, false);
  f.sheets.Estoque.rows = [];
  f.server.receberPedidoEstoque({ idPedido: 'PED-A', rowIndex: 2, itens: f.itens });
  assert.equal(f.sheets.Estoque.rows[0][0], 'ID_Item');
  assert.equal(f.sheets.Estoque.rows[0][13], 'ID_Lote');
  assert.equal(f.sheets.Estoque.rows[1][0], 'KIT-0');
  assert.equal(f.sheets.Estoque.rows[1][6], 2);
  assert.ok(f.sheets.Estoque.rows[1][13]);
});

function automationFixture(count = 20) {
  const agenda = new FakeSheet('Agenda', [[]]);
  const audit = new FakeSheet('Audit_Changes', [[]]);
  const { server, locks } = context(new FakeSpreadsheet({ Agenda: agenda, Audit_Changes: audit }));
  const idx = server.AGENDA_CFG.idx;
  agenda.rows[0] = Array(server.AGENDA_CFG.lastCol).fill('');
  for (let n = 0; n < count; n++) {
    const row = Array(server.AGENDA_CFG.lastCol).fill('');
    row[idx.id] = 'AG-' + n; row[idx.tipo] = 'Visita'; row[idx.data] = new Date('2020-01-01T12:00:00');
    row[idx.status] = 'Agendado'; row[idx.c1.nome] = 'DHL'; row[idx.c1.awb] = String(1000000000 + n); row[idx.c1.status] = 'Agendado';
    agenda.rows.push(row);
  }
  const stats = measure(agenda); const auditStats = measure(audit);
  const invalidations = [];
  server.getAgendaSheet_ = () => agenda;
  server.getDhlTrackingApiKey_ = () => 'SIMULADO';
  server.codexGetAuditChangesSheet_ = () => audit;
  server.codexGetActiveUserEmail_ = () => 'teste@example.invalid';
  server.agendaInvalidateDateIndexCache_ = () => { assert.equal(locks.held, true); assert.ok(locks.flushes > 0); invalidations.push('invalidate'); };
  server.consultarEntregaDhl_ = () => { assert.equal(locks.held, false); return { entregue: true, status: 'Delivered' }; };
  server.getCourierConfirmationRules_ = () => ({ dhl: { courier: 'DHL', statusConfirmacao: 'Confirmado' } });
  server.buscarConfirmacoesCourierNoGmail_ = (_rule, pending) => { assert.equal(locks.held, false); return Object.keys(pending).map(awbKey => ({ awbKey, messageId: 'MSG-' + awbKey })); };
  server.buscarConfirmacoesCourierPorReferenciaNoGmail_ = () => [];
  return { server, locks, agenda, audit, idx, stats, auditStats, invalidations };
}

test('monitor DHL revalida após HTTP, escreve status e auditoria em lote e invalida janelas', () => {
  const f = automationFixture();
  const result = f.server.monitorarEntregasDhlAgendadas_({ maxConsultas: 20 });
  assert.equal(result.entregues, 20);
  assert.equal(f.stats.reads, 4);
  assert.equal(f.stats.writes, 1);
  assert.equal(f.auditStats.writes, 1);
  assert.equal(f.audit.rows.length, 21);
  assert.equal(f.audit.rows[1][7], 'Agendado');
  assert.equal(f.audit.rows[1][8], 'Entregue');
  assert.equal(f.invalidations.length, 1);
  assert.equal(f.agenda.rows.every((row, i) => !i || row[f.idx.c1.status] === 'Entregue'), true);
});

test('DHL revalida AWB, courier, status e ID antes de gravar após reordenação', () => {
  const f = automationFixture(6);
  let calls = 0;
  f.server.consultarEntregaDhl_ = () => {
    if (++calls === 6) {
      f.agenda.rows[1][f.idx.c1.awb] = '9999999999';
      f.agenda.rows[3][f.idx.id] = 'AG-1';
      f.agenda.rows[4][f.idx.c1.status] = 'Cancelado';
      f.agenda.rows[5][f.idx.c1.nome] = 'MARKEN';
      f.agenda.rows = [f.agenda.rows[0], ...f.agenda.rows.slice(1).reverse()];
    }
    return { entregue: true };
  };
  const result = f.server.monitorarEntregasDhlAgendadas_({ maxConsultas: 6 });
  assert.equal(result.entregues, 1);
  assert.equal(result.itens[0].agendaId, 'AG-5');
  assert.equal(f.agenda.rows[1][f.idx.c1.status], 'Entregue');
  assert.equal(f.agenda.rows[6][f.idx.c1.status], 'Agendado');
});

test('monitor Gmail confirma em lote, preserva Message ID na auditoria e não repete confirmação', () => {
  const f = automationFixture();
  const result = f.server.monitorarConfirmacoesCourierAgendadas_();
  assert.equal(result.confirmados, 20);
  assert.equal(f.stats.reads, 4);
  assert.equal(f.stats.writes, 1);
  assert.equal(f.auditStats.writes, 1);
  assert.match(f.audit.rows[1][9], /Gmail message MSG-/);
  assert.equal(f.server.monitorarConfirmacoesCourierAgendadas_().confirmados, 0);
  assert.equal(f.auditStats.writes, 1);
});

test('extração de AWB por referência mantém o slot, propaga ao vínculo de Backup e registra duas mudanças', () => {
  const f = automationFixture(2);
  f.agenda.rows[1][f.idx.c1.awb] = '';
  f.agenda.rows[1][f.idx.c1.temp] = 'Ambiente';
  f.agenda.rows[2][f.idx.c1.nome] = '';
  f.agenda.rows[2][f.idx.backupAgendaRef] = JSON.stringify({ id: 'AG-0', slot: 'I', awb: '' });
  f.server.getCourierConfirmationRules_ = () => ({ dhl: { courier: 'DHL', statusConfirmacao: 'Confirmado', extrairAwbPorReferencia: true } });
  f.server.buscarConfirmacoesCourierNoGmail_ = () => [];
  f.server.buscarConfirmacoesCourierPorReferenciaNoGmail_ = (_rule, pending) => Object.keys(pending).map(refKey => ({
    refKey, messageId: 'MSG-REF', awbs: { ambiente: '1234567890', todos: ['1234567890'] }
  }));
  // A apresentação RichText já tem cobertura própria; exercita aqui o vínculo real de Backup.
  f.server.agendaSetAwbValue_ = (range, awb, courier) => { assert.equal(courier, 'DHL'); range.setValue(awb); };
  const result = f.server.monitorarConfirmacoesCourierAgendadas_();
  assert.equal(result.confirmados, 1);
  assert.equal(f.agenda.rows[1][f.idx.c1.awb], '1234567890');
  assert.equal(f.agenda.rows[1][f.idx.c1.status], 'Confirmado');
  assert.equal(JSON.parse(f.agenda.rows[2][f.idx.backupAgendaRef]).awb, '1234567890');
  const changes = f.audit.rows.slice(1).filter(row => row[4] === 'monitorarConfirmacoesCourierAgendadas');
  assert.equal(changes.length, 2);
  assert.match(changes[0][9], /Ref\. AGD-AG-0.*MSG-REF/);
  assert.equal(f.server.monitorarConfirmacoesCourierAgendadas_().confirmados, 0);
});

test('promoção diária só grava alvos elegíveis em RangeList e preserva terminais e futuros', () => {
  const f = automationFixture(20);
  f.agenda.rows[2][f.idx.status] = 'Cancelado';
  f.agenda.rows[3][f.idx.data] = new Date('2099-01-01T12:00:00');
  const result = f.server.marcarAgendaPassadaComoRealizada_();
  assert.equal(result.atualizados, 18);
  assert.equal(f.stats.reads, 1);
  assert.equal(f.stats.writes, 1);
  assert.equal(f.agenda.rows[2][f.idx.status], 'Cancelado');
  assert.equal(f.agenda.rows[3][f.idx.status], 'Agendado');
  assert.equal(f.invalidations.length, 1);
});
