'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');

function importFixture() {
  const requests = [], readers = [];
  const elements = Object.fromEntries(['soaImportTexto', 'soaImportModo', 'soaImportCriarBracos',
    'soaImportPreview', 'btnImportarSoAConfirm', 'btnPreviewSoA', 'modalSoAImport'].map(id => [id, {
    value: '', checked: true, disabled: false, classList: { contains: () => true }
  }]));
  elements.soaImportTexto.value = JSON.stringify({ visitas: [{ codigo: 'V1' }] });
  elements.soaImportModo.value = 'adicionar';
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    _soaProjetoAtual: { nomeAbreviado: 'Projeto local' },
    _soaImportDadosAtual: null, _soaImportFingerprintAtual: '', _soaImportRevisao: 0, _soaImportEmAndamento: false,
    appServerRun: options => requests.push(options),
    appSetButtonBusy: (button, busy) => { button.disabled = busy; },
    appSetStatus() {}, appErrorMessage: error => error.message,
    renderSoAImportPreview_: result => { elements.btnImportarSoAConfirm.disabled = !result || !result.ok || !result.visitas.length; },
    FileReader: function() { readers.push(this); this.readAsText = () => {}; },
    fecharOverlay() {}, snack() {}, carregarSoAVisitasProjeto() {}, carregarBracosProjeto() {}
  });
  vm.runInContext(contentAccessibilitySource(['invalidarPreviaImportacaoSoA_', 'soaImportTextoPayload_',
    'previsualizarSoAJsonApp', 'confirmarImportacaoSoAApp', 'lerSoAArquivoApp']), context);
  function preview() {
    context.previsualizarSoAJsonApp();
    requests.at(-1).onSuccess({ ok: true, visitas: [{ codigo: 'V1' }] });
  }
  return { context, elements, requests, readers, preview };
}

for (const field of ['soaImportTexto', 'soaImportModo', 'soaImportCriarBracos']) {
  test('importação bloqueia mudança após prévia em ' + field + ', inclusive sem evento DOM', () => {
    const { context: c, elements: el, requests, preview } = importFixture();
    preview();
    if (field === 'soaImportTexto') el[field].value = '{"visitas":[{"codigo":"V2"}]}';
    else if (field === 'soaImportModo') el[field].value = 'atualizar';
    else el[field].checked = false;
    c.confirmarImportacaoSoAApp();
    assert.equal(requests.filter(r => r.method === 'importarSoAJson').length, 0);
    assert.equal(el.btnImportarSoAConfirm.disabled, true);
    assert.equal(c._soaImportDadosAtual, null);
  });
}

test('prévia antiga não habilita confirmação nem substitui prévia nova', () => {
  const { context: c, elements: el, requests } = importFixture();
  c.previsualizarSoAJsonApp();
  el.soaImportModo.value = 'atualizar';
  c.invalidarPreviaImportacaoSoA_();
  requests[0].onSuccess({ ok: true, visitas: [{}] });
  assert.equal(el.btnImportarSoAConfirm.disabled, true);
  c.previsualizarSoAJsonApp();
  requests[1].onSuccess({ ok: true, visitas: [{}] });
  requests[0].onFailure(new Error('Resposta antiga'));
  assert.equal(el.btnImportarSoAConfirm.disabled, false);
  assert.equal(c._soaImportDadosAtual.modo, 'atualizar');
});

test('prévia inválida ou vazia nunca autoriza importação', () => {
  for (const result of [{ ok: false, visitas: [{}] }, { ok: true, visitas: [] }]) {
    const { context: c, requests } = importFixture();
    c.previsualizarSoAJsonApp();
    requests[0].onSuccess(result);
    c.confirmarImportacaoSoAApp();
    assert.equal(requests.some(r => r.method === 'importarSoAJson'), false);
  }
});

test('importação envia snapshot revisado e impede envio duplicado enquanto a RPC está em voo', () => {
  const { context: c, requests, preview } = importFixture();
  preview();
  const reviewed = c._soaImportFingerprintAtual;
  c.confirmarImportacaoSoAApp();
  c.confirmarImportacaoSoAApp();
  const writes = requests.filter(r => r.method === 'importarSoAJson');
  assert.equal(writes.length, 1);
  assert.equal(JSON.stringify(writes[0].args[0]), reviewed);
  c._soaImportDadosAtual.dados.visitas[0].codigo = 'ALTERADO';
  assert.equal(JSON.stringify(writes[0].args[0]), reviewed);
  writes[0].onFailure(new Error('Falha simulada'));
  assert.equal(c._soaImportEmAndamento, false);
});

test('arquivo antigo não sobrescreve digitação ou seleção de arquivo mais recente', () => {
  const { context: c, elements: el, readers } = importFixture();
  const event = { target: { files: [{}] } };
  c.lerSoAArquivoApp(event);
  el.soaImportTexto.value = 'Texto digitado';
  c.invalidarPreviaImportacaoSoA_();
  readers[0].result = 'Arquivo antigo'; readers[0].onload();
  assert.equal(el.soaImportTexto.value, 'Texto digitado');
  c.lerSoAArquivoApp(event);
  c.lerSoAArquivoApp(event);
  readers[2].result = 'Arquivo novo'; readers[2].onload();
  readers[1].result = 'Arquivo anterior'; readers[1].onload();
  assert.equal(el.soaImportTexto.value, 'Arquivo novo');
  assert.equal(el.btnImportarSoAConfirm.disabled, true);
});

test('todos os diálogos e relações acessíveis do fragmento têm destinos válidos', () => {
  const html = readProjectFile('IndexContentAfterStock.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  const dialogs = [...html.matchAll(/<div class="modal-overlay"[^>]*>\s*(<div[^>]*>)/g)];
  assert.equal(dialogs.length, 22);
  for (const [overlay, box] of dialogs) {
    assert.match(overlay, /data-accessible-dialog/);
    assert.match(box, /role="dialog"/);
  }
  for (const relation of html.matchAll(/(?:for|aria-controls|aria-describedby|aria-labelledby)="([^"]+)"/g)) {
    for (const id of relation[1].split(' ')) assert.ok(ids.includes(id), id);
  }
  for (const button of html.matchAll(/<button class="modal-close"[^>]*>/g)) assert.match(button[0], /aria-label="[^"]+"/);
});
