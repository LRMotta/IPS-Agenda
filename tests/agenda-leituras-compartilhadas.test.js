'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

function servidor() {
  return runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs'], {
    Logger: { log() {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, getAll: () => ({}), putAll() {}, remove() {}, removeAll() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty() {} }) }
  });
}

// Aba minima: so conta as leituras (por faixa) e permite trocar as linhas.
function abaAgenda(s, ids) {
  const largura = s.AGENDA_CFG.lastCol;
  const aba = {
    linhas: ids.map((id) => { const r = Array(largura).fill(''); r[s.AGENDA_CFG.idx.id] = id; return r; }),
    leituras: [],
    getName: () => 'Agenda',
    getLastRow: () => aba.linhas.length + 1,
    getLastColumn: () => largura,
    getRange(row, col, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => { aba.leituras.push([row, col, nr, nc]); return aba.linhas.slice(row - 2, row - 2 + nr).map((l) => l.slice(col - 1, col - 1 + nc)); },
        getValue: () => { aba.leituras.push([row, col, 1, 1]); return (aba.linhas[row - 2] || [])[col - 1]; }
      };
    }
  };
  return aba;
}

test('getAgendaSheet_ garante o esquema uma vez por execucao e refaz para outra planilha', () => {
  const s = servidor();
  let garantias = 0;
  const aba = { getName: () => 'Agenda' };
  let planilha = { id: 1 };
  s.getCodexSpreadsheet_ = () => planilha;
  s.getSheetByPossibleNames_ = () => aba;
  s.ensureAgendaDestinoLabColumns_ = () => { garantias++; };
  s.alinharStatusRequisicaoLegadoAgenda_ = () => {};
  assert.equal(s.getAgendaSheet_(), aba);
  assert.equal(s.getAgendaSheet_(), aba);
  assert.equal(s.getAgendaSheet_(), aba);
  assert.equal(garantias, 1);
  planilha = { id: 2 };
  s.getAgendaSheet_();
  assert.equal(garantias, 2);
});

test('encontrarLinhaPorId confere so a celula da linha lembrada e rele a coluna se ela mudou', () => {
  const s = servidor();
  const aba = abaAgenda(s, ['A', 'B', 'C']);
  assert.equal(s.encontrarLinhaPorId(aba, 'C'), 4);
  aba.leituras = [];
  assert.equal(s.encontrarLinhaPorId(aba, 'C'), 4);
  assert.deepEqual(aba.leituras.map((l) => l.slice(2)), [[1, 1]], 'segunda busca le uma celula');
  // Linha inserida acima: a celula lembrada nao confere e a coluna e lida de novo.
  aba.linhas.unshift(aba.linhas[0].map(() => ''));
  aba.linhas[0][s.AGENDA_CFG.idx.id] = 'NOVO';
  assert.equal(s.encontrarLinhaPorId(aba, 'C'), 5);
  // Excluido: nao devolve a linha antiga.
  aba.linhas = aba.linhas.filter((l) => l[s.AGENDA_CFG.idx.id] !== 'C');
  assert.equal(s.encontrarLinhaPorId(aba, 'C'), null);
  // Outra aba nao herda a memoria.
  const outra = abaAgenda(s, ['C']);
  assert.equal(s.encontrarLinhaPorId(outra, 'C'), 2);
});

test('contexto de AWB reaproveita a leitura do registro so no escopo, sob lock e com a mesma aba', () => {
  const s = servidor();
  s.LockService = { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  s.getCodexSpreadsheet_ = () => ({ getSheetByName: () => null });
  const aba = abaAgenda(s, ['A', 'B']);
  aba.linhas[1][s.AGENDA_CFG.idx.c1.awb] = '123456789012';
  // Referencia: contexto montado com leitura propria, fora do escopo.
  const referencia = JSON.stringify(s.codexWithDocumentLock_('ref', () => s.agendaAwbContexto_(aba)).entries);
  aba.leituras = [];
  const leiturasCompletas = () => aba.leituras.filter((l) => l[0] === 2 && l[1] === 1 && l[2] === 2).length;
  const lerComoRegistro = () => s.codexAgendaGuardarLinhas_(aba, aba.getLastRow(), aba.getRange(2, 1, 2, s.AGENDA_CFG.lastCol).getValues());

  // No escopo e sob lock: o contexto usa a leitura guardada (uma leitura completa ao todo).
  s.codexWithDocumentLock_('teste', () => s.codexAgendaLeituraCompartilhada_(() => {
    lerComoRegistro();
    const ctx = s.agendaAwbContexto_(aba);
    // Mesmo contexto de AWB que a leitura propria produziria.
    assert.equal(JSON.stringify(ctx.entries), referencia);
  }));
  assert.equal(leiturasCompletas(), 1);

  // Consumo unico: um segundo contexto (sem cache de AWB) le a Agenda de novo.
  aba.leituras = [];
  s.codexWithDocumentLock_('teste', () => s.codexAgendaLeituraCompartilhada_(() => {
    lerComoRegistro();
    s.agendaAwbContexto_(aba);
    s.CODEX_AWB_CONTEXT_ = null;
    s.agendaAwbContexto_(aba);
  }));
  assert.equal(leiturasCompletas(), 2);

  // Aba com outra quantidade de linhas: a leitura guardada e descartada.
  aba.leituras = [];
  s.codexWithDocumentLock_('teste', () => s.codexAgendaLeituraCompartilhada_(() => {
    lerComoRegistro();
    aba.linhas.push(aba.linhas[0].slice());
    s.agendaAwbContexto_(aba);
  }));
  assert.equal(aba.leituras.filter((l) => l[0] === 2 && l[1] === 1).length, 2);

  // Fora do escopo nada e guardado; fora do lock o escopo nem abre.
  aba.leituras = [];
  s.codexWithDocumentLock_('teste', () => { lerComoRegistro(); s.agendaAwbContexto_(aba); });
  assert.equal(aba.leituras.filter((l) => l[0] === 2 && l[1] === 1).length, 2);
  s.codexAgendaLeituraCompartilhada_(() => { assert.equal(s.CODEX_AGENDA_LINHAS_ESCOPO_, null); });
  // O lock zera o escopo na saida.
  assert.equal(s.CODEX_AGENDA_LINHAS_ESCOPO_, null);
});

test('salvamento abre o escopo da leitura compartilhada so na preparacao, antes das gravacoes', () => {
  const fonte = require('./helpers/load-app-script').readProjectFile('TransporteCodexConfig.gs').replace(/\r\n/g, '\n');
  const inicio = fonte.indexOf('function salvarTransporteInterno_(');
  const corpo = fonte.slice(inicio, fonte.indexOf('\nfunction ', inicio + 10));
  const escopo = corpo.indexOf('transporteAgendaLeituraCompartilhada_(function()');
  const fim = corpo.indexOf("lap('rp_awb');\n  }); });");
  assert.ok(escopo > 0 && fim > escopo, 'escopo envolve read_prepare ate a AWB');
  assert.ok(corpo.indexOf("'write_fields'") > fim, 'gravacoes ficam fora do escopo');
  assert.ok(corpo.indexOf('transporteSincronizarAgenda_') > fim, 'sincronizacao com a Agenda fica fora do escopo');
});
