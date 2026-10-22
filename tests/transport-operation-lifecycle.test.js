'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const { fixture } = require('./helpers/agenda-merge-fixture');

function setup() {
  const f = fixture();
  vm.runInContext(readProjectFile('TransporteCodexConfig.gs'), f.c);
  const audits = [];
  f.c.codexWriteAuditChangesBatch_ = entries => audits.push(...entries);
  f.c.transporteRegistrarDocumentacaoGerada_({ agendaId: 'A', slot: '1', courier: 'Marken', temperaturaPdf: 'Ambiente',
    pdfId: 'PDF-ORIGINAL', rascunhoId: 'DRAFT-ORIGINAL', rascunhoOk: true, awbDocumento: '1234567890', pdfHash: 'HASH-ORIGINAL' });
  return { ...f, audits };
}

test('salvar remocao inativa somente a operacao vinculada e preserva evidencias', () => {
  const f = setup();
  f.c.transporteRegistrarDocumentacaoGerada_({ agendaId: 'A', slot: '2', courier: 'Marken', temperaturaPdf: 'Ambiente', rascunhoOk: true });
  f.payload.courier1 = { nome: '', temperatura: '', status: '', material: '', destino: '', matBioJson: '', awb: '', awbTouched: true };
  assert.equal(f.c.atualizarAgendaEventoCompleto(f.payload).ok, true);
  const op = f.c.transporteOperacoesRows_()[0];
  assert.equal(op.estado, 'INATIVA');
  assert.equal(op.inativacaoMotivo, 'Transporte removido da Agenda');
  assert.equal(op.pdfId, 'PDF-ORIGINAL');
  assert.equal(op.rascunhoId, 'DRAFT-ORIGINAL');
  assert.equal(op.awbDocumento, '1234567890');
  assert.equal(f.c.transporteOperacoesRows_()[1].estado, 'ATIVA');
  assert.ok(op.inativadaEm instanceof Date);
  assert.equal(f.audits.length, 1);
  assert.equal(f.c.transporteReconciliarOperacoesAgenda_(f.sheet.rows[1]), 0);
  assert.equal(f.audits.length, 1, 'inativacao idempotente');
});

for (const field of ['nome', 'temperatura']) {
  test('troca de ' + field + ' inativa documento anterior sem afetar outros slots', () => {
    const f = setup();
    f.payload.courier1[field] = field === 'nome' ? 'DHL' : 'Congelado';
    assert.equal(f.c.atualizarAgendaEventoCompleto(f.payload).ok, true);
    assert.equal(f.c.transporteOperacoesRows_()[0].estado, 'INATIVA');
    assert.match(f.c.transporteOperacoesRows_()[0].inativacaoMotivo, /alterad/);
  });
}

test('alteracao cosmetica e legado sem temperatura nao comprovam mudanca de envio', () => {
  const f = setup();
  const ops = f.c.transporteOperacoesSheet_(false);
  ops.getRange(2, 18).setValue('');
  f.payload.courier1.nome = 'MARKEN';
  f.payload.courier1.temperatura = 'Congelado';
  assert.equal(f.c.atualizarAgendaEventoCompleto(f.payload).ok, true);
  assert.equal(f.c.transporteOperacoesRows_()[0].estado, 'ATIVA');
});

test('cabecalho ocupado bloqueia salvamento antes de qualquer escrita na Agenda', () => {
  const f = setup();
  const ops = f.c.transporteOperacoesSheet_(false);
  ops.getRange(1, 22).setValue('DADO ALHEIO');
  const before = JSON.stringify(f.sheet.rows);
  f.payload.obs = 'Nao pode gravar';
  assert.throws(() => f.c.atualizarAgendaEventoCompleto(f.payload), /coluna reservada/);
  assert.equal(JSON.stringify(f.sheet.rows), before);
});
