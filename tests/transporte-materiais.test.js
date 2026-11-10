'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runHtmlScript, readProjectFile } = require('./helpers/load-app-script');
const { FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const plano = (v) => JSON.parse(JSON.stringify(v));
const A = 'ana@example.invalid';
const B = 'bia@example.invalid';

function servidor() {
  const book = new FakeSpreadsheet({});
  const celulas = {};
  const auditoria = [];
  let ativo = false;
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs',
    'TransporteTarefas.gs', 'TransporteEmails.gs', 'TransporteEnvio.gs', 'TransporteMateriais.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    LockService: { getDocumentLock: () => ({ tryLock: () => { ativo = true; return true; }, releaseLock() { ativo = false; } }) }
  });
  s.getCodexSpreadsheet_ = () => book;
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  s.codexAssertAdmin_ = () => ({ ok: true, role: 'admin', email: s.usuarioAtual || A });
  const idx = s.AGENDA_CFG.idx;
  s.getAgendaSheet_ = () => ({ getRange: (linha, coluna) => ({
    getValue: () => celulas[linha + ':' + coluna] || '',
    setValue: (v) => { celulas[linha + ':' + coluna] = v; if (!ativo) throw new Error('escrita na Agenda fora do lock'); }
  }) });
  s.encontrarLinhaPorId = (_agenda, id) => (id === 'ab12cd34' ? 7 : 0);
  s.codexWriteAuditChanges_ = (...args) => { auditoria.push(args); };
  s.agendaInvalidateWindowCache_ = () => {};
  s.celulas = celulas;
  s.auditoria = auditoria;
  s.coluna = (nome, slot) => idx[slot || 'c1'][nome] + 1;
  return s;
}

function registro(extra) {
  return Object.assign({
    paciente: 'Pessoa', protocolo: 'Estudo X', investigador: 'Inv', temperatura: 'CONGELADO', dataEnvio: '2026-11-16', courier: 'MARKEN',
    destino: 'LAB X', awb: '111', idAgenda: 'ab12cd34', agendaSlot: '1', materiais: []
  }, extra || {});
}

function preparar(s) {
  s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: new Date() });
  return s.transporteRegistroGravar_('ab12cd34', '1', registro(), { versaoEsperada: 0, usuario: A }).versao;
}

test('editar materiais grava na Agenda com auditoria, nota e atualiza o registro', () => {
  const s = servidor();
  const v = preparar(s);
  s.celulas['7:' + s.coluna('material')] = 'Soro: 2 tubo(s), 2,00 mL';
  const r = plano(s.editarMateriaisTransporteEnvio('ab12cd34', '1', v, [{ material: 'Soro', formula: '2x1,5' }, { material: 'Plasma', formula: '1x2,0', ensaio: 'PK' }]));
  assert.equal(r.ok, true);
  assert.equal(r.alterado, true);
  assert.equal(r.versao, v + 1);
  const resumo = s.celulas['7:' + s.coluna('material')];
  assert.match(resumo, /Soro.*2 tubo\(s\), 3,00 mL/);
  assert.match(resumo, /Plasma.*PK/);
  const json = JSON.parse(s.celulas['7:' + s.coluna('matBio')]);
  assert.equal(json.v, 1);
  assert.equal(json.items.length, 2);
  assert.deepEqual([json.ajuste.por, json.ajuste.anterior], [A, 'Soro: 2 tubo(s), 2,00 mL']);
  assert.ok(!isNaN(new Date(json.ajuste.em).getTime()));
  assert.equal(s.auditoria.length, 1);
  assert.deepEqual(s.auditoria[0].slice(0, 3), ['Agenda', 'editarMateriaisTransporte', 'ab12cd34']);
  assert.deepEqual(plano(s.auditoria[0][3].map((c) => c.field)), ['Transporte 1 - Materiais', 'Transporte 1 - Materiais estruturados']);
  assert.equal(s.auditoria[0][3][0].oldValue, 'Soro: 2 tubo(s), 2,00 mL');
  assert.equal(s.auditoria[0][4], 'Material ajustado na preparação do transporte');
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.equal(lido.versao, v + 1);
  assert.deepEqual(plano(lido.registro.materiais.filter((m) => m.ativo).map((m) => m.material).sort()), ['Plasma', 'Soro']);
});

test('sem mudança de conteúdo nada é escrito; recusas deixam Agenda e registro intactos', () => {
  const s = servidor();
  const v = preparar(s);
  const primeiro = plano(s.editarMateriaisTransporteEnvio('ab12cd34', '1', v, [{ material: 'Soro', formula: '2x1,5' }]));
  assert.equal(primeiro.alterado, true);
  const mesmo = plano(s.editarMateriaisTransporteEnvio('ab12cd34', '1', primeiro.versao, [{ material: 'Soro', formula: '2x1,5' }]));
  assert.equal(mesmo.alterado, false);
  assert.equal(s.auditoria.length, 1);
  const antes = JSON.stringify(s.celulas);
  assert.throws(() => s.editarMateriaisTransporteEnvio('ab12cd34', '1', 1, [{ material: 'Soro', formula: '1x1' }]), (e) => e.code === 'TRANSPORTE_REGISTRO_VERSAO');
  assert.throws(() => s.editarMateriaisTransporteEnvio('ab12cd34', '1', primeiro.versao, [{ material: 'Gelatina', formula: '1x1' }]), /não reconhecido/);
  assert.throws(() => s.editarMateriaisTransporteEnvio('ab12cd34', '1', primeiro.versao, [{ material: 'Soro', formula: '1x1' }, { material: 'soro', formula: '1x1' }]), /repetido/);
  assert.throws(() => s.editarMateriaisTransporteEnvio('ab12cd34', '1', primeiro.versao, [{ material: 'Soro', formula: 'abc' }]));
  assert.throws(() => s.editarMateriaisTransporteEnvio('ab12cd34', '1', primeiro.versao, 'texto'), /inválidos/);
  assert.throws(() => s.editarMateriaisTransporteEnvio('ab12cd34', 'backup2', 0, []), /Backup II/);
  assert.equal(JSON.stringify(s.celulas), antes);
  assert.equal(s.auditoria.length, 1);
});

test('só quem tem o preparo edita o material', () => {
  const s = servidor();
  const v = preparar(s);
  s.usuarioAtual = B;
  assert.throws(() => s.editarMateriaisTransporteEnvio('ab12cd34', '1', v, [{ material: 'Soro', formula: '1x1' }]), (e) => e.code === 'TRANSPORTE_REGISTRO_EM_PREPARO');
  assert.deepEqual(s.celulas, {});
  assert.throws(() => s.editarMateriaisTransporteEnvio('zzzz9999', '1', 0, []), /não encontrado/);
});

test('esvaziar os materiais mantém a nota com o valor anterior', () => {
  const s = servidor();
  const v = preparar(s);
  s.celulas['7:' + s.coluna('material')] = 'Urina: 1 tubo(s), 10,00 mL';
  const r = plano(s.editarMateriaisTransporteEnvio('ab12cd34', '1', v, []));
  assert.equal(r.alterado, true);
  const json = JSON.parse(s.celulas['7:' + s.coluna('matBio')]);
  assert.deepEqual([json.items, json.ajuste.anterior], [[], 'Urina: 1 tubo(s), 10,00 mL']);
});

test('a nota do ajuste chega à Agenda: parser compartilhado, cartão do transporte e histórico', () => {
  const core = runHtmlScript('SharedMatBioCore.html').CodexMatBioCore;
  const json = JSON.stringify({ v: 1, items: [], ajuste: { por: A, em: '2026-11-09T10:00:00.000Z', anterior: 'Soro: 1 tubo(s), 1,00 mL' } });
  const lido = core.parseJson(json);
  assert.equal(lido.valid, true);
  assert.deepEqual(plano(lido.ajuste), { por: A, em: '2026-11-09T10:00:00.000Z', anterior: 'Soro: 1 tubo(s), 1,00 mL' });
  assert.equal(core.parseJson(JSON.stringify({ v: 1, items: [] })).ajuste, null);
  assert.equal(core.parseJson('').valid, true);
  const agenda = readProjectFile('IndexAgendaScripts.html');
  assert.ok(agenda.includes('function agendaMatBioAjusteHtml(ajuste)'));
  assert.ok(agenda.includes("Material ajustado na preparação do transporte"));
  assert.ok(agenda.includes('var nota = agendaMatBioAjusteHtml(data.ajuste);'));
  assert.ok(readProjectFile('AgendaHistory.gs').includes("editarMateriaisTransporte: 'Material ajustado na preparação do transporte'"));
});
