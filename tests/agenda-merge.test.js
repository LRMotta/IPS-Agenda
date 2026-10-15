'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { fixture, material } = require('./helpers/agenda-merge-fixture');

test('salvamento combina observacao local e medico remoto com auditoria somente da escrita efetiva', () => {
  const { c, i, sheet, payload, audits } = fixture();
  payload.obs = 'Observação local';
  sheet.rows[1][i.medico] = 'Médico remoto';
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.merged, true);
  assert.equal(sheet.rows[1][i.obs], 'Observação local');
  assert.equal(sheet.rows[1][i.medico], 'Médico remoto');
  assert.ok(result.preservedFields.includes('Médico'));
  assert.match(audits[0][4], /simultâneas preservadas/);
  assert.equal(audits[0][3].some(change => change.field === 'Médico'), false);
});

test('material local combina com status automatico sem regredir transporte', () => {
  const { c, i, sheet, payload } = fixture();
  payload.courier1.matBioJson = material('Local'); payload.courier1.material = 'Material local';
  sheet.rows[1][i.c1.status] = 'Agendado';
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(sheet.rows[1][i.c1.status], 'Agendado');
  assert.equal(sheet.rows[1][i.c1.matBio], payload.courier1.matBioJson);
});

test('materiais de transportes diferentes sao independentes e ausencias opcionais nao apagam dados', () => {
  const { c, i, sheet, payload } = fixture();
  payload.courier1.matBioJson = material('I'); payload.courier1.material = 'I';
  sheet.rows[1][i.c2.matBio] = material('II'); sheet.rows[1][i.c2.material] = 'II';
  sheet.rows[1][i.obs] = 'Remota'; delete payload.obs;
  assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true);
  assert.equal(sheet.rows[1][i.c2.matBio], material('II'));
  assert.equal(sheet.rows[1][i.obs], 'Remota');
});

test('material do mesmo transporte e atomico; rejeicao nao grava nenhuma parte', () => {
  const { c, i, sheet, payload } = fixture();
  payload.courier1.matBioJson = material('Local');
  sheet.rows[1][i.c1.matBio] = material('Remoto');
  const before = JSON.stringify(sheet.rows);
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.conflito, true);
  assert.ok(result.diagnostic.overlappingFields.includes('Transporte I - Material biológico'));
  assert.equal(sheet.writes, 0);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('mesmo valor final pode convergir sem conflito', () => {
  const { c, i, sheet, payload } = fixture();
  payload.obs = sheet.rows[1][i.obs] = 'Mesmo resultado';
  assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true);
});

test('contexto, configuracao de envio e vinculo de backup protegem dependencias', () => {
  for (const change of ['participante', 'status', 'courier', 'link']) {
    const { c, i, sheet, payload } = fixture();
    payload[change === 'link' ? 'backup' : 'courier1'].matBioJson = material('Local');
    if (change === 'participante') sheet.rows[1][i.participante] = 'Outra pessoa';
    if (change === 'status') sheet.rows[1][i.status] = 'Cancelado';
    if (change === 'courier') sheet.rows[1][i.c1.nome] = 'Outro courier';
    if (change === 'link') sheet.rows[1][i.backupAgendaRef] = '{"id":"OUTRO"}';
    const result = c.atualizarAgendaEventoCompleto(payload);
    assert.equal(result.conflito, true, change);
    assert.equal(sheet.writes, 0, change);
  }
});

test('token adulterado, expirado, de outra conta, base, registro ou schema nunca libera escrita', () => {
  for (const mode of ['adulterado', 'expirado', 'conta', 'base', 'registro', 'schema', 'legado']) {
    const f = fixture(); const { c, i, sheet, payload } = f;
    payload.obs = 'Local'; sheet.rows[1][i.medico] = 'Remoto';
    if (mode === 'adulterado') payload._editMergeToken = 'x' + payload._editMergeToken.slice(1);
    if (mode === 'expirado') {
      const now = c.Date.now; c.Date.now = () => now() + 25 * 60 * 60 * 1000;
      try { assert.equal(c.atualizarAgendaEventoCompleto(payload).conflito, true); } finally { c.Date.now = now; }
      continue;
    }
    if (mode === 'conta') f.setEmail('outro@exemplo.invalid');
    if (mode === 'base') f.setSpreadsheet('OUTRA-BASE');
    if (mode === 'registro') payload.id = 'B';
    if (mode === 'schema') c.AGENDA_CFG.idx.cb.temp = 54;
    if (mode === 'legado') delete payload._editMergeToken;
    assert.equal(c.atualizarAgendaEventoCompleto(payload).conflito, true, mode);
    assert.equal(sheet.writes, 0, mode);
  }
});

test('conjunto combinado passa novamente pela validacao antes de qualquer escrita', () => {
  const { c, i, sheet, payload } = fixture();
  payload.obs = 'Local'; sheet.rows[1][i.medico] = 'Remoto';
  let calls = 0;
  c.agendaValidarMaterialBioPayload_ = () => { if (++calls === 2) throw new Error('Validação após combinação'); };
  assert.throws(() => c.atualizarAgendaEventoCompleto(payload), /Validação após combinação/);
  assert.equal(calls, 2); assert.equal(sheet.writes, 0);
});

test('requisicao e conclusoes remotas sao preservadas sem reverter booleanos', () => {
  const { c, i, sheet, payload } = fixture();
  payload.obs = 'Local'; sheet.rows[1][i.reqStatus] = 'Enviado'; sheet.rows[1][i.poloTrial] = '2026-10-15T10:00:00';
  assert.equal(c.atualizarAgendaEventoCompleto(payload).ok, true);
  assert.equal(sheet.rows[1][i.reqStatus], 'Enviado');
  assert.equal(sheet.rows[1][i.poloTrial], '2026-10-15T10:00:00');
});

test('Gerar docs devolve registro combinado e nova referencia para atualizar o formulario', () => {
  const { c, i, sheet, payload } = fixture();
  payload.transporteDocumentosSlot = '1'; payload.obs = 'Local'; sheet.rows[1][i.c1.status] = 'Agendado';
  const result = c.atualizarAgendaEventoCompleto(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mergedEvent.courier1.status, 'Agendado');
  assert.equal(result.mergedEvent.editMergeToken, result.editMergeToken);
  assert.ok(result.editMergeToken);
});

test('falha de auditoria nao altera a rejeicao nem grava dados em conflito assinado', () => {
  const { c, i, sheet, payload } = fixture();
  payload.obs = 'Local'; sheet.rows[1][i.obs] = 'Remota';
  c.codexWriteAuditChanges_ = () => { throw new Error('Auditoria indisponível'); };
  c.codexLogAuditFailure_ = () => {};
  assert.equal(c.atualizarAgendaEventoCompleto(payload).conflito, true);
  assert.equal(sheet.writes, 0);
});

test('metadados desconhecidos de materiais nao sao descartados por uma combinacao', () => {
  const { c, i, sheet, payload } = fixture();
  payload.courier1.matBioJson = material('Local');
  const remote = JSON.parse(material('Local')); remote.items[0].referenciaAdicional = 'Metadado remoto';
  sheet.rows[1][i.c1.matBio] = JSON.stringify(remote);
  assert.equal(c.atualizarAgendaEventoCompleto(payload).conflito, true);
  assert.equal(sheet.writes, 0);
});
