'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');

function fixture() {
  const requests = [], statuses = [], elements = {};
  const document = { getElementById(id) { return elements[id] ||= { value: '', checked: false, disabled: false, hidden: false, innerHTML: '', classList: { contains: () => true } }; } };
  document.getElementById('soaImportBraco').value = 'Braço A';
  document.getElementById('soaImportModo').value = 'adicionar';
  const c = vm.createContext({
    document, _soaProjetoAtual: { codigo: 'ABC' }, _soaImportDadosAtual: null, _soaImportFingerprintAtual: '', _soaImportRevisao: 0, _soaImportEmAndamento: false, _soaImportResultadoAtual: null,
    _soaImportCsvTexto: 'csv', soaPoloExtrair_: text => ({ schema: 'polo-trial-flowchart', texto: text }),
    esc: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), soaOrdemLabel_: String,
    appServerRun: r => requests.push(r), appSetButtonBusy() {}, appSetStatus: (id, message) => statuses.push(message), appErrorMessage: e => e.message,
    fecharOverlay() {}, snack() {}, carregarSoAVisitasProjeto() {}, carregarBracosProjeto() {}
  });
  vm.runInContext(contentAccessibilitySource(['invalidarPreviaImportacaoSoA_', 'soaImportTextoPayload_', 'renderSoAImportPreview_', 'previsualizarSoAJsonApp', 'confirmarImportacaoSoAApp', 'atualizarRevisaoPlanejamentoSoAApp', 'soaPlanningValue_', 'renderPlanejamentoSoA_']), c);
  function preview(extra = {}) { c.previsualizarSoAJsonApp(); requests.at(-1).onSuccess({ ok: true, podeImportar: false, fingerprint: 'signed', visitas: [], planejamento: { braco: 'Braço A', issues: [] }, ...extra }); }
  return { c, e: elements, requests, statuses, preview };
}

test('braço e arquivo são exigidos antes da RPC', () => {
  const { c, e, requests, statuses } = fixture();
  e.soaImportBraco.value = '  ';
  c.previsualizarSoAJsonApp();
  assert.equal(requests.length, 0);
  assert.match(statuses.at(-1), /Informe o nome do braço/);
  e.soaImportBraco.value = 'Braço A';
  c._soaImportCsvTexto = '';
  c.previsualizarSoAJsonApp();
  assert.equal(requests.length, 0);
  assert.match(statuses.at(-1), /Selecione o arquivo CSV/);
});

test('prévia envia o conteúdo extraído e o braço', () => {
  const { c, requests } = fixture();
  c.previsualizarSoAJsonApp();
  const payload = requests.at(-1).args[0];
  assert.equal(requests.at(-1).method, 'validarImportacaoSoA');
  assert.equal(payload.braco, 'Braço A');
  assert.equal(payload.criarBracos, true);
  assert.equal(payload.dados.schema, 'polo-trial-flowchart');
});

test('erro de leitura do arquivo aparece sem chamar o servidor', () => {
  const { c, e, requests } = fixture();
  c.soaPoloExtrair_ = () => { throw new Error('Arquivo <b>inválido</b>'); };
  c.previsualizarSoAJsonApp();
  assert.equal(requests.length, 0);
  assert.match(e.soaImportPreview.innerHTML, /Arquivo &lt;b&gt;inválido/);
});

test('impedimento mantém importação desabilitada', () => {
  const { c, e, requests, preview } = fixture();
  preview({ visitas: [{ codigo: 'V1' }] });
  assert.equal(e.btnImportarSoAConfirm.disabled, true);
  c.confirmarImportacaoSoAApp();
  assert.equal(requests.some(r => r.method === 'importarSoAJson'), false);
});

test('aplicar exige revisão humana e envia fingerprint da prévia', () => {
  const { c, e, requests, preview } = fixture();
  preview({ podeImportar: true, visitas: [{ codigo: 'V1' }] });
  c.confirmarImportacaoSoAApp();
  assert.equal(requests.some(r => r.method === 'importarSoAJson'), false);
  e.soaImportRevisado.checked = true;
  c.atualizarRevisaoPlanejamentoSoAApp();
  assert.equal(e.btnImportarSoAConfirm.disabled, false);
  c.confirmarImportacaoSoAApp();
  const write = requests.at(-1);
  assert.equal(write.method, 'importarSoAJson');
  assert.equal(write.args[0].confirmarRevisaoPlanejamento, true);
  assert.equal(write.args[0].fingerprintPlanejamento, 'signed');
  assert.equal(write.args[0].braco, 'Braço A');
});

test('alterar o braço após a prévia invalida a confirmação mesmo sem evento', () => {
  const { c, e, requests, preview } = fixture();
  preview({ podeImportar: true, visitas: [{ codigo: 'V1' }] });
  e.soaImportRevisado.checked = true;
  e.soaImportBraco.value = 'Braço B';
  c.confirmarImportacaoSoAApp();
  assert.equal(requests.some(r => r.method === 'importarSoAJson'), false);
  assert.equal(c._soaImportDadosAtual, null);
});

test('prévia protege HTML vindo do arquivo', () => {
  const { e, preview } = fixture();
  preview({ visitas: [{ codigo: '<img>', nome: '<script>', observacoes: '<svg>' }], planejamento: { braco: '<b>', issues: [{ message: '<script>', blocking: true }] } });
  const lower = e.soaImportPreview.innerHTML.toLowerCase();
  for (const tag of ['<script', '<svg', '<img', '<b>']) assert.equal(lower.includes(tag), false, tag);
  assert.match(e.soaImportPreview.innerHTML, /&lt;script&gt;/);
});

test('prévia mostra resumo e visitas antes de agrupar impedimentos repetidos', () => {
  const { e, preview } = fixture();
  preview({ totalVisitas: 2, visitas: [{ codigo: 'V1', nome: 'Triagem' }, { codigo: 'V2', nome: 'Inclusão' }], planejamento: { braco: 'Braço A', issues: [{ id: 'a', message: 'Corrija o intervalo.', blocking: true }, { id: 'b', message: 'Corrija o intervalo.', blocking: true }, { id: 'guide', message: 'Conferir condições.', blocking: false }] } });
  const html = e.soaImportPreview.innerHTML;
  assert.ok(html.indexOf('visitas encontradas') < html.indexOf('Pontos de atenção'));
  assert.ok(html.indexOf('Triagem') < html.indexOf('Pontos de atenção'));
  assert.equal((html.match(/2 ocorrências/g) || []).length, 1);
  assert.match(html, /2 impedimento\(s\) · 1 orientação/);
  assert.match(html, /Exportação do Polo Trial<\/strong> · braço Braço A/);
});

test('visitas manuais não sugerem cálculo e as calculadas herdam a base do protocolo', () => {
  const { e, preview } = fixture();
  preview({ visitas: [{ codigo: 'V1', nome: 'Triagem', schedulingMode: 'manual', manualReason: 'Por demanda no Polo Trial.' }, { codigo: 'V2', nome: 'Ciclo 2', baseCalculo: '' }] });
  const html = e.soaImportPreview.innerHTML;
  assert.match(html, /Agendamento manual · Por demanda no Polo Trial/);
  assert.match(html, /Base das datas: Base padrão do protocolo/);
  assert.doesNotMatch(html, /Base das datas: Data prevista/);
});
