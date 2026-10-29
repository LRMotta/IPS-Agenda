'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFile } = require('./helpers/load-app-script');
const { FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const SLOTS = [['1', 'Transporte I'], ['2', 'Transporte II'], ['3', 'Transporte III'], ['4', 'Transporte IV']];

// Linha da Agenda: sete colunas por slot (nome, temp, status, awb, material, destino, matBio), a partir da 1.
function agendaFixture() {
  const block = n => ({ nome: n * 7, temp: n * 7 + 1, status: n * 7 + 2, awb: n * 7 + 3, material: n * 7 + 4, destino: n * 7 + 5, matBio: n * 7 + 6 });
  const idx = { c1: block(0), c2: block(1), c3: block(2), c4: block(3), cb: { nome: 28, temp: 29, status: 30, material: 31, destino: 32, matBio: 33 } };
  const row = new Array(34).fill('');
  SLOTS.forEach(([slot], n) => {
    row[idx['c' + slot].nome] = 'DHL';
    row[idx['c' + slot].status] = 'Não agendado';
    row[idx['c' + slot].awb] = '10000000' + (n + 1) + '0';
  });
  const audits = [];
  const globals = {
    AGENDA_CFG: { idx, col: { status: 1 } },
    AgendaServerRules_: { isCancelled: () => false, courierStatusKey: v => norm(v).replace(/\s/g, '') },
    getAgendaSheet_: () => ({
      getLastColumn: () => row.length,
      getRange: (_line, col, _h, count) => count ? { getDisplayValues: () => [row.slice()] } : { setValue: v => { row[col - 1] = v; } }
    }),
    encontrarLinhaPorId: () => 2,
    agendaInvalidateDateIndexCache_() {},
    codexWriteAuditChanges_: (...args) => audits.push(args)
  };
  return { idx, row, audits, globals };
}

function fixture() {
  const agenda = agendaFixture();
  const book = new FakeSpreadsheet({});
  const bases = [];
  let registro = {};
  const s = runFile('TransporteCodexConfig.gs', {
    ...agenda.globals,
    getCodexSpreadsheet_: () => book,
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
    Logger: { log() {} },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, value) => Array.from(crypto.createHash('sha256').update(value).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'), newBlob: text => ({ getBytes: () => Array.from(Buffer.from(text)) }) },
    normText_: norm,
    normalizarAwbCourier_: v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    codexWithDocumentLock_: (_label, fn) => fn(),
    codexAssertCanWrite_: () => ({ userEmail: 'teste@example.invalid' }),
    courierLembreteRegistrarBase_: (id, slot) => bases.push([id, slot])
  });
  s.salvarTransporteInterno_ = () => ({ agendaSync: {} });
  s.transporteValidarManifestoPdf_ = () => ({ hash: 'MODEL', manifesto: { awb: 'AWB', temperatura: 'Ambiente' } });
  s.transporteReadRegistro_ = () => registro;
  s.imprimirTodasAbas_ = () => ({ ok: true, type: 'pdf', fileId: 'PDF-' + registro.agendaSlot, fileName: 'docs.pdf', courier: 'DHL', conteudoPdfHash: 'C' + registro.agendaSlot });
  s.criarRascunhoTransporte_ = () => ({ ok: true, draftId: 'DRAFT-' + registro.agendaSlot, message: 'Rascunho criado.' });
  const gerar = (slot, awb) => {
    registro = { idAgenda: 'EVT', agendaSlot: slot };
    return s.gerarPdfTransporte({ payload: { idAgenda: 'EVT', agendaSlot: slot, courier: 'DHL', awb, paciente: 'Pessoa' } });
  };
  return { s, agenda, bases, gerar, operacoes: () => s.transporteOperacoesRows_() };
}

test('geracao de ponta a ponta atualiza somente o slot gerado, de I a IV', () => {
  const f = fixture();
  const { idx, row } = f.agenda;
  SLOTS.forEach(([slot], n) => {
    const antes = SLOTS.map(([other]) => row[idx['c' + other].status]);
    const result = f.gerar(slot, '10000000' + (n + 1) + '0');
    assert.equal(result.type, 'pdf');
    assert.equal(result.draftOk, true);
    assert.deepEqual(Array.from(result.agendaSync.campos), ['Transporte ' + slot + ' - Status']);
    SLOTS.forEach(([other], m) => {
      const esperado = other === slot ? 'Docs gerados' : (m < n ? 'Docs gerados' : antes[m]);
      assert.equal(row[idx['c' + other].status], esperado, `slot ${other} apos gerar ${slot}`);
    });
  });
  assert.equal(f.agenda.audits.length, 4);
});

test('cada slot registra a operacao, a referencia IPS-TRP e a base de cobranca proprios', () => {
  const f = fixture();
  SLOTS.forEach(([slot], n) => f.gerar(slot, '10000000' + (n + 1) + '0'));
  const operacoes = f.operacoes();
  assert.deepEqual(operacoes.map(o => o.slot).sort(), ['1', '2', '3', '4']);
  operacoes.forEach(o => {
    assert.equal(o.referencia, 'IPS-TRP-EVT-T' + o.slot);
    assert.equal(o.pdfId, 'PDF-' + o.slot);
    assert.equal(o.rascunhoId, 'DRAFT-' + o.slot);
    assert.equal(o.estado, 'ATIVA');
  });
  assert.deepEqual(f.bases.map(b => b.join(':')).sort(), ['EVT:1', 'EVT:2', 'EVT:3', 'EVT:4']);
});

test('regenerar o mesmo slot reaproveita a operacao e AWB divergente nao promove nenhum slot', () => {
  const f = fixture();
  f.gerar('4', '1000000040');
  f.gerar('4', '1000000040');
  assert.equal(f.operacoes().filter(o => o.slot === '4').length, 1);
  const outro = fixture();
  const resultado = outro.gerar('3', '9999999999');
  assert.equal(resultado.agendaSync.atualizado, undefined);
  SLOTS.forEach(([slot]) => assert.equal(outro.agenda.row[outro.agenda.idx['c' + slot].status], 'Não agendado'));
});

test('Backup gera documentos sem registrar acompanhamento nem promover o status', () => {
  const f = fixture();
  const resultado = f.gerar('backup', '1000000010');
  assert.equal(resultado.type, 'pdf');
  assert.match(resultado.monitorWarning, /Backup/);
  assert.equal(f.operacoes().length, 0);
  assert.equal(f.bases.length, 0);
  SLOTS.forEach(([slot]) => assert.equal(f.agenda.row[f.agenda.idx['c' + slot].status], 'Não agendado'));
});
