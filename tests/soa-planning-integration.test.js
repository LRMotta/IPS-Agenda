'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { planningIntegration } = require('./helpers/soa-planning-integration');
const { readProjectFile } = require('./helpers/load-app-script');

test('planejamento completo usa escritor e leitores reais, cria braços, resolve referências e não duplica', () => {
  const { server: s, spreadsheet, canonical } = planningIntegration();
  const payload = { projeto: 'Estudo local', dados: canonical, criarBracos: true };
  const preview = s.validarImportacaoSoA(payload);
  assert.equal(preview.podeImportar, true, JSON.stringify(preview.alertas));
  assert.equal(spreadsheet.getSheets().length, 0);
  payload.confirmarRevisaoPlanejamento = true;
  payload.fingerprintPlanejamento = preview.fingerprint;
  const result = s.importarSoAJson(payload);
  assert.equal(result.adicionadas, 2);
  const visits = s.getSoAVisitasProjeto(payload.projeto);
  assert.equal(visits.length, 2);
  assert.equal(visits[1].referencia, visits[0].idSoA);
  assert.equal(visits[1].baseCalculo, 'RECALCULAR_VISITA_REALIZADA');
  assert.equal(visits[1].janelaDiasMais, 2);
  assert.equal(s.getBracosProjeto(payload.projeto).length, 1);
  payload.fingerprintPlanejamento = s.validarImportacaoSoA(payload).fingerprint;
  assert.equal(s.importarSoAJson(payload).adicionadas, 0);
  assert.equal(s.getSoAVisitasProjeto(payload.projeto).length, 2);
  assert.equal(s.listarPlanejamentosSoA(payload.projeto).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(s.carregarPlanejamentoSoA(payload.projeto, result.planejamentoId).dados)), canonical);
});

test('o exemplo real de oito regras fica somente em rascunho e conserva todas as fontes', () => {
  const { server: s, spreadsheet, poc } = planningIntegration();
  const p = { projeto: 'BGB-43395-302', dados: poc };
  const preview = s.validarImportacaoSoA(p);
  assert.equal(preview.ok, true);
  assert.equal(preview.planejamento.rules.length, 8);
  assert.equal(preview.podeImportar, false);
  const saved = s.salvarPlanejamentoSoA(p);
  assert.equal(spreadsheet.getSheets().length, 1);
  assert.equal(s.getSoAVisitasProjeto(p.projeto).length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(s.carregarPlanejamentoSoA(p.projeto, saved.id).dados)), poc);
  assert.throws(() => s.importarSoAJson({ ...p, confirmarRevisaoPlanejamento: true, fingerprintPlanejamento: preview.fingerprint }), /pendente/);
});

test('instruções para IA disponíveis na interface correspondem ao contrato documentado', () => {
  const script = readProjectFile('SharedSoAPlanningImport.html').replace(/^<script>/i, '').replace(/<\/script>\s*$/i, '');
  const context = vm.createContext({});
  vm.runInContext(script, context);
  assert.equal(context.soaGuiaExtracaoTexto_().trim(), readProjectFile('docs/INSTRUCOES_EXTRACAO_IA.txt').trim());
  assert.match(readProjectFile('Index.html'), /include\('SharedSoAPlanningImport'\)/);
});

test('atualizar preserva dados opcionais omitidos, estado inativo e IDs históricos', () => {
  const { server: s, spreadsheet, canonical } = planningIntegration();
  const p = { projeto: 'Estudo local', dados: canonical, criarBracos: true };
  p.confirmarRevisaoPlanejamento = true;
  p.fingerprintPlanejamento = s.validarImportacaoSoA(p).fingerprint;
  s.importarSoAJson(p);
  const sheet = spreadsheet.getSheetByName('SoA_Visitas');
  const id = sheet.rows[1][0];
  sheet.rows[1][7] = 'Nome histórico';
  sheet.rows[1][8] = 'Não';
  sheet.rows[1][9] = 'Observação prévia';
  delete canonical.visits[0].aliases;
  canonical.visits[0].name = 'Nome revisado';
  p.modo = 'atualizar';
  p.fingerprintPlanejamento = s.validarImportacaoSoA(p).fingerprint;
  s.importarSoAJson(p);
  assert.equal(sheet.rows[1][0], id);
  assert.equal(sheet.rows[1][3], 'Nome revisado');
  assert.equal(sheet.rows[1][7], 'Nome histórico');
  assert.equal(sheet.rows[1][8], 'Não');
  assert.equal(sheet.rows[1][9], 'Observação prévia');
  sheet.rows[1][5] = 'A cada ciclo';
  assert.equal(s.validarImportacaoSoA(p).podeImportar, false);
});

test('visitas comuns valem para todos os braços e valores nulos permanecem pendentes', () => {
  const { server: s, canonical } = planningIntegration();
  canonical.visits.forEach(v => { v.arm_ids = []; });
  const p = { projeto: 'Estudo local', dados: canonical };
  assert.equal(s.validarImportacaoSoA(p).podeImportar, true);
  canonical.visits[0].timing.offset_days = null;
  const preview = s.validarImportacaoSoA(p);
  assert.equal(preview.ok, true);
  assert.equal(preview.podeImportar, false);
  assert.equal(s.salvarPlanejamentoSoA(p).ok, true);
});

test('extração reconhece decisão de interrupção como marco próprio do EOT', () => {
  const { server: s, canonical } = planningIntegration();
  canonical.visits[0].timing.anchor = 'decision_to_permanently_discontinue';
  canonical.visits[0].timing.offset_days = 7;
  const preview = s.validarImportacaoSoA({ projeto: 'Estudo local', dados: canonical });
  assert.equal(preview.podeImportar, true);
  assert.equal(preview.visitas[0].referencia, 'DECISAO_INTERRUPCAO_TRATAMENTO');
});
