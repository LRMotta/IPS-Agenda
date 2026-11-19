'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

function nota(chave, situacao, extra) {
  const numero = chave.split('|')[0];
  return Object.assign({ chave, notaFiscal: numero, remetente: 'Remetente ' + numero, projetos: ['Projeto fictício'],
    dataRecebimento: '13/11/2026', dataRecebimentoISO: '2026-11-13', itens: [{ descricao: 'Item fictício', quantidade: 2, lote: 'L1' }],
    movimentos: ['700'], movimentoRm: '700', movimentosDivergentes: false, rmPendente: false, pdfId: '', pdfNome: '',
    emailPreparadoEm: '', enviadaManualEm: '', situacao }, extra || {});
}

const NOTAS = [
  nota('111|A', 'rm_pendente', { movimentos: [], movimentoRm: '', rmPendente: true }),
  nota('222|B', 'falta_pdf'),
  nota('333|C', 'pronta', { pdfId: 'pdf-333', pdfNome: 'NF 333.pdf', movimentos: ['701'], movimentoRm: '701' }),
  nota('444|D', 'pronta', { pdfId: 'pdf-444', pdfNome: 'NF 444.pdf', movimentos: ['702'], movimentoRm: '702' }),
  nota('555|E', 'concluida', { pdfId: 'pdf-555', emailPreparadoEm: '10/11/2026 10:00' })
];

async function fixture(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/*', (request) => request.abort());
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS | Notas fiscais</title>' + readProjectFile('IndexStyles.html') +
    readProjectFile('IndexStylesAfterDashboard.html') + '<style>.material-symbols-outlined{font-size:0!important}</style></head><body>' +
    readProjectFile('IndexContent.html') + readProjectFile('IndexContentAfterDashboard.html') + readProjectFile('IndexContentAfterStock.html') + '</body></html>');
  await page.addScriptTag({ content: `
    var pending=[], snacks=[];
    function abrirOverlay(id){document.getElementById(id).classList.add('open');}
    function fecharModalSeClicouFora(event,id){if(event.target.id===id)fecharOverlay(id);}
    function snack(message){snacks.push(message);}
    function snackErro(message){snacks.push('erro:'+appErrorMessage(message));}
    function projetoChip(p){return '<span class="chip chip-blue">'+esc(p)+'</span>';}
    function carregarMedicamentos(){}
    var APP_ACCESSIBLE_DIALOGS=[], APP_CONTENT_ACCESSIBILITY_READY=false, APP_UNSAVED_SCOPES={}, APP_UNSAVED_ON_CANCEL=null;
    function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function appErrorMessage(error){return error && error.message || String(error);}
    function runner(success,failure){return new Proxy({}, {get(target,method){
      if(method==='withSuccessHandler')return fn=>runner(fn,failure);
      if(method==='withFailureHandler')return fn=>runner(success,fn);
      return (...args)=>pending.push({method,args,success,failure});
    }});}
    var google={script:{run:runner()}};
    ${contentAccessibilitySource(['appServerRun', 'appSetButtonBusy', 'bindTableRecordActions', 'abrirConfirmacaoDestrutiva',
      'appDialogFocusable', 'appFocusDialog', 'appSyncContentFieldAccessibility', 'appSyncAccessibleDialogs', 'appAccessibleDialogKeydown',
      'appInitContentAccessibility', 'appHasUnsavedChanges', 'appMarkUnsavedChanges', 'appClearUnsavedChanges', 'appEditableDirtyScope',
      'appConfirmNavigationIfDirty', 'appOpenUnsavedConfirm', 'fecharConfirmUnsaved', 'fecharOverlay', 'appSetStatus', 'appSetInlineStatusMessage', 'appFilePickerSync'])}
    appInitContentAccessibility();
  ` });
  await page.addScriptTag({ content: readProjectFile('IndexMedicamentosNfScripts.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '') });
  await page.evaluate(() => { document.getElementById('page-medicamentos').classList.add('active'); });
  return { page, errors };
}

async function responder(page, method, result) {
  await page.evaluate(([m, r]) => {
    const call = window.pending.filter((p) => p.method === m).at(-1);
    call.success(r);
  }, [method, result]);
}

test('notas fiscais: filtros, movimento, seleção e rascunho do e-mail em desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const { page, errors } = await fixture(browser, width);
      await page.getByRole('button', { name: /Notas fiscais/ }).click();
      await responder(page, 'getMedicamentosNotasFiscais', { notas: NOTAS, copiaFixa: 'ips@ucs.br', ultimosDestinatarios: 'financeiro@ucs.br' });
      assert.equal(await page.locator('#medItensView').isHidden(), true);
      assert.equal(await page.locator('#bodyMedNotas tr').count(), 1, 'filtro inicial: RM pendente');
      assert.equal(await page.locator('#medNfPendentesCount').innerText(), '1');

      await page.getByRole('button', { name: 'Informar movimento RM da NF 111' }).click();
      await page.locator('#modalMedNfMovimento').getByLabel(/Movimento RM/).fill('703');
      await page.locator('#btnMedNfSalvarMov').click();
      const mov = await page.evaluate(() => window.pending.filter((p) => p.method === 'salvarMovimentoRmNotaFiscal').at(-1).args[0]);
      assert.deepEqual(mov, { chave: '111|A', movimentoRm: '703', movimentosAtuais: '' });
      await page.evaluate(() => window.pending.filter((p) => p.method === 'salvarMovimentoRmNotaFiscal').at(-1).failure({ message: 'O movimento desta nota mudou. Atualize a lista antes de salvar.' }));
      assert.match(await page.locator('#statusMedNfMov').innerText(), /mudou/);
      await page.locator('#modalMedNfMovimento .modal-close').click();

      await page.locator('[data-med-nf-filtro="pronta"]').click();
      assert.equal(await page.locator('#bodyMedNotas tr').count(), 2);
      assert.equal(await page.locator('#btnMedNfPrepararEmail').isDisabled(), true);
      await page.getByLabel('Selecionar todas as notas listadas').check();
      assert.match(await page.locator('#medNfSelecaoInfo').innerText(), /2 notas/);
      assert.equal(await page.locator('#btnMedNfPrepararEmail').isDisabled(), false);
      await page.locator('#btnMedNfPrepararEmail').click();
      assert.equal(await page.locator('#medNfEmailPara').inputValue(), 'financeiro@ucs.br');
      assert.equal(await page.locator('#medNfEmailPreview').innerText(), 'NF 333 - Movimento 701\nNF 444 - Movimento 702');
      assert.match(await page.locator('#medNfEmailCc').innerText(), /ips@ucs\.br/);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'medicamentos-nf-email-' + width + '.png') });
      await page.locator('#btnMedNfCriarRascunho').click();
      const email = await page.evaluate(() => window.pending.filter((p) => p.method === 'prepararEmailNotasFiscais').at(-1).args[0]);
      assert.deepEqual(email, { chaves: ['333|C', '444|D'], destinatarios: 'financeiro@ucs.br' });
      await responder(page, 'prepararEmailNotasFiscais', { ok: true, message: 'Rascunho criado no Gmail com 2 notas fiscais.' });
      assert.equal(await page.locator('#modalMedNfEmail').evaluate((el) => el.classList.contains('open')), false);
      assert.match(await page.locator('#medNfSelecaoInfo').innerText(), /Nenhuma/);

      // Seleção com nota sem PDF não permite e-mail, mas permite marcar como enviada.
      await page.locator('[data-med-nf-filtro="falta_pdf"]').click();
      await page.getByLabel('Selecionar NF 222').check();
      assert.equal(await page.locator('#btnMedNfPrepararEmail').isDisabled(), true);
      assert.equal(await page.locator('#btnMedNfMarcarEnviadas').isDisabled(), false);
      await page.locator('[data-med-nf-filtro="todas"]').click();
      await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'medicamentos-nf-lista-' + width + '.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);

      // Arquivo com o número da NF no nome sugere a nota automaticamente.
      await page.getByRole('button', { name: /Anexar PDFs/ }).click();
      // Seletor de arquivo no visual do app: nada do botão nativo do navegador aparece.
      assert.ok((await page.locator('#medNfPdfsInput').boundingBox()).width <= 1);
      assert.equal(await page.locator('label.file-picker-btn[for="medNfPdfsInput"]').isVisible(), true);
      assert.equal(await page.locator('#medNfPdfsInputNome').innerText(), 'Nenhum arquivo selecionado');
      await page.locator('#medNfPdfsInput').setInputFiles([{ name: 'NF 0222 digitalizada.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }]);
      assert.equal(await page.locator('[data-med-nf-arquivo="0"]').inputValue(), '222|B');
      assert.equal(await page.locator('#medNfPdfsInputNome').innerText(), 'NF 0222 digitalizada.pdf');
      await page.screenshot({ animations: 'disabled', path: path.join(artifacts, 'medicamentos-nf-anexar-' + width + '.png') });
      await page.locator('#btnMedNfAnexar').click();
      await page.waitForFunction(() => window.pending.some((p) => p.method === 'anexarPdfNotaFiscal'));
      const anexo = await page.evaluate(() => window.pending.filter((p) => p.method === 'anexarPdfNotaFiscal').at(-1).args[0]);
      assert.equal(anexo.chave, '222|B');
      assert.equal(Buffer.from(anexo.conteudoBase64, 'base64').toString(), '%PDF-1.4');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
