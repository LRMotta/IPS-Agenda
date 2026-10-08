'use strict';
/* global window, document */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { transportBrowserFixture, participants } = require('../helpers/transport-browser-fixture');
const { runFile } = require('../helpers/load-app-script');

let browser;
before(async () => {
  // Browser plugin not available: usa Playwright existente e RPCs simuladas, sem rede.
  browser = await loadPlaywright().chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function scenario(run, options = {}) {
  const page = await browser.newPage({ viewport: options.viewport || { width: 1280, height: 900 } });
  page.setDefaultTimeout(4000);
  try {
    const errors = await transportBrowserFixture(page, options);
    assert.equal(await page.title(), 'Transporte — teste local');
    assert.ok((await page.locator('body').innerText()).includes('Transporte de Amostras'));
    await run(page);
    assert.deepEqual(errors, [], 'sem erros de JavaScript ou console');
  } finally { await page.close(); }
}

test('Transporte: busca limita DOM, cancela Escape pendente e teclado resolve debounce', async () => {
  const catalog = Array.from({ length: 2000 }, (_, i) => ({ id: 'CAD-' + i, nome: 'Pessoa ' + i, projeto: 'Estudo A', idParticipante: String(i) }));
  await scenario(async page => {
    const search = page.locator('#pacienteSearch');
    assert.equal(await page.locator('#paciente').getAttribute('type'), 'hidden');
    assert.equal(await page.locator('#paciente option').count(), 0);
    await search.click();
    assert.equal(await page.locator('#pacienteSearchList [role="option"]').count(), 50);
    assert.match(await page.locator('#pacienteSearchList').innerText(), /Refine a busca/);
    await search.fill('pessoa 1999');
    await search.press('Escape');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#pacienteSearchList').isVisible(), false);
    assert.equal(await page.evaluate(() => window.transportParticipantSearchTimer), null);
    await search.fill('pessoa 1999');
    await search.press('Enter');
    assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-1999');
  }, { participants: catalog });
});

test('Transporte: ciclo derivado coleta uma vez e salvar descarrega formula pendente', async () => {
  await scenario(async page => {
    const counts = await page.evaluate(() => {
      const payload = window.collectPayload, materials = window.collectMaterials;
      let p = 0, m = 0;
      window.collectPayload = function(...args) { p++; return payload(...args); };
      window.collectMaterials = function(...args) { m++; return materials(...args); };
      window.renderDerived();
      window.collectPayload = payload; window.collectMaterials = materials;
      return { p, m };
    });
    assert.deepEqual(counts, { p: 1, m: 1 });
    await page.evaluate(() => {
      window.renderMatBioEditor([{ key: 'soro', formula: '1x5', unit: 'mL' }]);
      window.transportClearUnsaved();
      const input = document.querySelector('.ag-mat-formula');
      input.value = '2x7';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (!window.transportHasUnsavedChanges || window.transportMatBioTimer === null) throw new Error('edicao deve marcar imediatamente e agendar recalculo');
      window.saveData();
    });
    const call = await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte'));
    assert.equal(call.args[0].materiais.find(item => item.material === 'Soro').total, 14);
    assert.equal(await page.evaluate(() => window.transportMatBioTimer), null);
  });
});

test('Transporte: AWB excedente permanece completa e sinaliza comprimento invalido', async () => {
  await scenario(async page => {
    await page.evaluate(() => window.selectCourier('MARKEN'));
    const input = page.locator('#awb');
    await input.fill('AB12CD34EF567');
    assert.equal(await input.inputValue(), 'AB12CD34EF567');
    assert.equal(await input.evaluate(el => el.checkValidity()), false);
    await input.fill('ab-12 cd34 ef56');
    assert.equal(await input.inputValue(), 'AB12CD34EF56');
    assert.equal(await input.evaluate(el => el.checkValidity()), true);
  });
});

test('Transporte: formulario fixa unidade e rejeita rotulos digitados na formula', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => {
        window.selectCourier('MARKEN');
        window.renderMatBioEditor([]);
      });
      const row = page.locator('.ag-mat-line').first();
      // O unico select da linha escolhe material; inputs sao descricao, formula e ensaio.
      assert.equal(await row.locator('select').count(), 1);
      assert.equal(await row.locator('input').count(), 3);
      await row.locator('.ag-mat-type-select').selectOption('soro');
      const formula = row.locator('.ag-mat-formula');
      await formula.fill('1x500');
      assert.equal(await row.getAttribute('data-formula-unit'), 'mL');
      for (const unit of ['mL', 'L', 'g', 'uL', 'µL', 'mg']) {
        await formula.fill('1x500 ' + unit);
        assert.equal(await formula.getAttribute('aria-invalid'), 'true', unit);
        assert.equal(await row.getAttribute('data-formula-unit'), 'mL', 'texto nao escolhe unidade');
        await page.evaluate(() => window.saveData());
      }
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'salvarTransporte').length), 0);
      await formula.fill('1x500');
      assert.equal(await formula.getAttribute('aria-invalid'), 'false');
      await page.waitForFunction(() => window.transportMatBioTimer === null);
      assert.equal(await row.locator('.ag-mat-total-line').innerText(), '500,00 mL');
    }, { viewport: { width, height: 900 } });
  }
});

test('Transporte: troca para DHL bloqueia volumes pendentes e conversao explicita libera a gravacao', async () => {
  await scenario(async page => {
    await page.evaluate(() => {
      window.renderMatBioEditor([{ key: 'soro', formula: '1x500', unit: 'mL' }, { key: 'fezes', formula: '2x5', unit: 'g' }]);
      window.selectCourier('DHL');
    });
    const first = page.locator('.ag-mat-line').first();
    assert.equal(await first.locator('.ag-mat-formula').inputValue(), '1x500', 'trocar courier preserva numeros');
    assert.equal(await first.getAttribute('data-formula-unit'), 'mL', 'trocar courier preserva unidade dos numeros anteriores');
    assert.equal(await first.locator('.ag-mat-total-line').innerText(), 'Conversão pendente');
    await page.evaluate(() => window.saveData());
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'salvarTransporte').length), 0);
    await page.getByRole('button', { name: 'Converter mL para L' }).click();
    assert.equal(await first.locator('.ag-mat-formula').inputValue(), '1×0,5');
    assert.equal(await first.getAttribute('data-formula-unit'), 'L');
    assert.equal(await page.getByRole('button', { name: 'Converter mL para L' }).isDisabled(), true, 'impede segunda conversao');
    const stool = page.locator('.ag-mat-line').filter({ has: page.locator('select option:checked[value="fezes"]') });
    assert.equal(await stool.locator('.ag-mat-formula').inputValue(), '2x5');
    await page.evaluate(() => window.saveData());
    const call = await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte'));
    assert.ok(call);
    assert.equal(call.args[0].materiais.find(item => item.material === 'Soro').total, 0.5);
    assert.equal(call.args[0].materiais.find(item => item.material === 'Fezes').unit, 'g');
    assert.equal(await page.locator('#stVolume').innerText(), '0,50000 L', 'massa nao e somada ao volume');
    await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte').success({}));
    await first.locator('.ag-mat-formula').fill('2x5 + 3x');
    assert.equal(await first.locator('.ag-mat-formula').getAttribute('aria-invalid'), 'true');
    await page.waitForFunction(() => window.transportMatBioTimer === null);
    assert.equal(await first.locator('.ag-mat-total-line').innerText(), 'Inválido');
    await page.evaluate(() => window.saveData());
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'salvarTransporte').length), 1);
    await first.locator('.ag-mat-formula').fill('1000x0,000001');
    assert.equal(await first.locator('.ag-mat-formula').getAttribute('aria-invalid'), 'false');
  });
});

test('Transporte: salvar materiais sem formula preserva descricao e passa na validacao real do servidor', async () => {
  const server = runFile('TransporteCodexConfig.gs');
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => window.renderMatBioEditor([
        { key: 'soro', formula: '2x1.500', unit: 'mL', ensaio: 'Exame A' },
        { key: 'plasma', unit: 'mL', ensaio: 'Exame sem volume' },
        { key: 'outro', tipo: 'Lâminas', unit: 'mL', ensaio: 'Hematologia' }
      ]));
      await page.getByRole('button', { name: 'save Salvar', exact: true }).click();
      const payload = await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte').args[0]);
      const outro = payload.materiais.find(item => item.material === 'Lâminas');
      assert.equal(outro.ativo, true);
      assert.equal(outro.ensaio, 'Hematologia');
      assert.equal(outro.formula, '');
      assert.equal(outro.tubos, '');
      assert.equal(outro.total, '');
      const plasma = payload.materiais.find(item => item.material === 'Plasma');
      assert.equal(plasma.ativo, true);
      assert.equal(plasma.ensaio, 'Exame sem volume');
      assert.equal(plasma.tubos, '');
      assert.equal(plasma.total, '');
      assert.doesNotThrow(() => server.codexMatBioValidateTransportPayload_(payload));
      assert.equal(payload.materiais.find(item => item.material === 'Soro').total, 3);
      await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte').success({}));
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), false);
    }, { viewport: { width, height: 900 } });
  }
});

test('Transporte: Fezes recupera gramas e salva sem converter os numeros', async () => {
  await scenario(async page => {
    await page.evaluate(() => window.renderMatBioEditor([{ key: 'fezes', formula: '2x1,0', unit: 'mL', ensaio: 'A2+A4 Fecal RNA' }]));
    const rows = page.locator('.ag-mat-line');
    assert.equal(await rows.first().locator('.ag-mat-total-line').innerText(), '2,00 g');
    const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
    fs.mkdirSync(dir, { recursive: true });
    await page.locator('#matBioLines').screenshot({ path: path.join(dir, 'fezes-gramas.png'), animations: 'disabled' });
    const blank = rows.nth(1);
    await blank.locator('.ag-mat-formula').fill('1x3');
    await blank.locator('select').selectOption('fezes');
    assert.equal(await blank.locator('.ag-mat-total-line').innerText(), '3,00 g');
    await page.evaluate(() => window.saveData());
    const item = await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte').args[0].materiais.find(material => material.material === 'Fezes'));
    assert.equal(item.unit, 'g');
    assert.equal(item.total, 5);
    assert.equal(item.tubos, 3);
    assert.equal(item.ensaio, 'A2+A4 Fecal RNA');
  });
});

// JSON artificial carregado na fixture; nao representa unidade digitada pelo usuario.
test('Transporte: dados externos/legados com unidade desconhecida bloqueiam a gravacao', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => window.renderMatBioEditor([{ key: 'fezes', formula: '2x1', unit: 'uL' }]));
      assert.equal(await page.locator('.ag-mat-line').first().getAttribute('data-formula-unit'), 'uL');
      await page.evaluate(() => window.saveData());
      assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'salvarTransporte')), false);
      assert.match(await page.locator('#toast').innerText(), /unidade/i);
      assert.equal(await page.locator('.ag-mat-formula').first().inputValue(), '2x1');
    }, { viewport: { width, height: 900 } });
  }
});

test('Transporte: avisos de geracao aparecem em desktop e celular', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.locator('#btnPdfTransport').click();
      await page.evaluate(() => window.calls.find(call => call.method === 'gerarPdfTransporte').success({
        type: 'pdf', fileId: 'PDF-TEST', fileName: 'teste.pdf', fileUrl: 'https://example.invalid/pdf',
        message: 'PDF gerado.', draftOk: true, warnings: [{ code: 'PESO', message: 'Revise o peso do gelo. <teste>' }]
      }));
      assert.match(await page.locator('#pdfGenerationWarnings').innerText(), /Revise o peso do gelo\. <teste>/);
      assert.equal(await page.locator('#pdfGenerationWarnings teste').count(), 0);
      assert.match(await page.locator('#issues').innerText(), /Revise o peso do gelo/);
      assert.doesNotMatch(await page.locator('#pdfModal').innerText(), /quantidade correta/);
      assert.match(await page.locator('#toast').getAttribute('class'), /warn/);
      assert.equal(await page.locator('#btnPdfTransport').isDisabled(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'transport-review-warning-' + width + '.png'), fullPage: true });
    }, { viewport: { width, height: 900 } });
  }
});

test('Transporte: quantificacao legada sem formula sobrevive a reabertura e salvamento', async () => {
  await scenario(async page => {
    await page.evaluate(() => window.renderMaterials([
      { ativo: true, material: 'Soro', tubos: 2, total: 3, formula: '', ensaio: 'Legado', unit: 'mL' },
      { ativo: true, material: 'Fezes', tubos: 1, total: 0, formula: '', unit: 'g' }
    ]));
    await page.getByRole('button', { name: 'save Salvar', exact: true }).click();
    const payload = await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte').args[0]);
    assert.equal(payload.materiais.find(item => item.material === 'Soro').total, 3);
    assert.equal(payload.materiais.find(item => item.material === 'Soro').tubos, 2);
    assert.equal(payload.materiais.find(item => item.material === 'Fezes').total, 0);
    await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte').success({}));
    await page.evaluate(() => window.renderMaterials([{ ativo: true, material: 'Soro', tubos: 2, total: '', formula: '' }]));
    await page.evaluate(() => window.saveData());
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'salvarTransporte').length), 1, 'quantificacao incompleta exige revisao');
    await page.evaluate(() => window.renderMaterials([{ ativo: true, material: 'Soro', tubos: '', total: 3, formula: '' }]));
    await page.evaluate(() => window.saveData());
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'salvarTransporte').length), 1, 'total isolado exige revisao');
  });
});

test('Transporte: Outro sempre no final preserva materiais, formulas, ensaios e descricao', async () => {
  for (const width of [1440, 1024, 390]) {
    await scenario(async page => {
      await page.evaluate(() => {
        window.renderMatBioEditor([
          { key: 'sangue', formula: '2 x 0,5', ensaio: 'Exame A' },
          { key: 'plasma', formula: '3 x 1,5', ensaio: 'Exame B' }
        ]);
        window.transportClearUnsaved();
      });
      const rows = page.locator('.ag-mat-line');
      const firstId = await rows.first().getAttribute('data-idx');
      await rows.first().locator('.ag-mat-type-select').selectOption('outro');
      assert.equal(await rows.last().getAttribute('data-idx'), firstId);
      assert.equal(await rows.first().locator('.ag-mat-type-select').inputValue(), 'plasma');
      assert.equal(await rows.first().locator('.ag-mat-formula').inputValue(), '3 x 1,5');
      assert.equal(await rows.first().locator('.ag-mat-ensaio').inputValue(), 'Exame B');
      assert.equal(await rows.last().locator('.ag-mat-formula').inputValue(), '2 x 0,5');
      assert.equal(await rows.last().locator('.ag-mat-ensaio').inputValue(), 'Exame A');
      await rows.last().locator('.ag-mat-other').fill('Lâminas "revisar"');
      const beforeAdd = await rows.count();
      await page.getByRole('button', { name: /Adicionar material/ }).click();
      assert.equal(await rows.count(), beforeAdd + 1);
      assert.equal(await rows.last().locator('.ag-mat-type-select').inputValue(), 'outro');
      assert.equal(await rows.last().locator('.ag-mat-other').inputValue(), 'Lâminas "revisar"');
      assert.equal(await rows.nth(beforeAdd - 1).locator('.ag-mat-type-select').inputValue(), '');
      const payload = await page.evaluate(() => window.collectPayload());
      assert.ok(payload.materiais.some(row => row.material === 'Plasma' && row.formula === '3×1,5' && row.ensaio === 'Exame B'));
      assert.ok(payload.materiais.some(row => row.material === 'Lâminas "revisar"'));
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sem rolagem horizontal');
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'transport-outro-' + width + '.png'), fullPage: true });
      await page.locator('#materials').screenshot({ path: path.join(dir, 'transport-materials-' + width + '.png') });
      await rows.last().locator('.ag-mat-type-select').selectOption('soro');
      assert.equal(await rows.nth(beforeAdd).getAttribute('data-idx'), firstId, 'Outro convertido nao muda de posicao');
      assert.equal(await rows.last().locator('.ag-mat-type-select').inputValue(), '', 'linha vazia automatica retomada');
      assert.equal(await rows.nth(beforeAdd).locator('.ag-mat-formula').inputValue(), '2 x 0,5');
    }, { viewport: { width, height: 900 } });
  }
});

test('Transporte: renderizacao de Outro legado preserva linhas seguintes e varios textos livres', async () => {
  await scenario(async page => {
    await page.evaluate(() => {
      window.renderMatBioEditor([
        { key: 'outro', tipo: 'Lâminas A' }, { key: 'plasma', formula: '1 x 0,5', ensaio: 'Exame' },
        { key: 'outro', tipo: 'Lâminas B' }, { key: 'soro', formula: '2 x 1' }
      ]);
    });
    assert.deepEqual(await page.locator('.ag-mat-type-select').evaluateAll(elements => elements.map(el => el.value)), ['plasma', 'soro', '', 'outro', 'outro']);
    assert.deepEqual(await page.locator('.ag-mat-line.other-on .ag-mat-other').evaluateAll(elements => elements.map(el => el.value)), ['Lâminas A', 'Lâminas B']);
  });
});

test('Transporte: botoes e conversao ativam aviso de alteracoes nao salvas', async () => {
  await scenario(async page => {
    await page.locator('#temperaturas button').filter({ hasText: 'CONGELADO' }).click();
    assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
    await page.evaluate(() => window.transportClearUnsaved());
    await page.locator('#couriers button').filter({ hasText: 'DHL' }).click();
    assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
    await page.evaluate(() => {
      window.renderMatBioEditor([{ key: 'plasma', formula: '2 x 0,5', unit: 'mL' }]);
      window.transportClearUnsaved();
    });
    await page.locator('#btnConvertDhlVolumes').click();
    assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
    assert.equal(await page.locator('.ag-mat-formula').first().inputValue(), '2×0,0005');
    await page.evaluate(() => window.transportClearUnsaved());
    await page.locator('.ag-mat-remove').first().click();
    assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true);
  });
});

test('Transporte: participantes e CE ignoram retornos atrasados sem trocar o estudo selecionado', async () => {
  await scenario(async page => {
    await page.locator('#pacienteSearch').fill('Pessoa B');
    await page.getByRole('option', { name: /Pessoa B/ }).click();
    await page.evaluate(rows => {
      window.calls.find(call => call.method === 'getTransporteParticipantesOptions').success(rows);
      const requests = window.calls.filter(call => call.method === 'getTransporteCeStatus');
      requests.filter(call => call.args[0] === 'Estudo B').at(-1).success({ checked: true, found: true, message: 'CE do estudo B' });
      requests.filter(call => call.args[0] === 'Estudo A').forEach(call => call.success({ checked: true, found: true, message: 'CE antiga A' }));
    }, participants);
    assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-B');
    assert.equal(await page.locator('#protocolo').inputValue(), 'Estudo B');
    assert.equal(await page.locator('#identificacaoParticipante').inputValue(), '456');
    assert.ok((await page.locator('#issues').innerText()).includes('CE do estudo B'));
    assert.ok(!(await page.locator('#issues').innerText()).includes('CE antiga A'));
  }, { partialParticipants: true });
});

test('Transporte: modal prende foco, fecha com Escape e devolve foco sem acessar servicos reais', async () => {
  await scenario(async page => {
    const clear = page.locator('.actions-top button.danger');
    await clear.click();
    assert.equal(await page.locator('#confirmClearModal').evaluate(el => el.contains(document.activeElement)), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#confirmClearModal .modal-actions button').last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#confirmClearModal .modal-close').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#confirmClearModal').isVisible(), false);
    assert.equal(await clear.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#pacienteSearch').evaluate(el => el.labels.length), 1);
    assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'limparTransporte')), false);
  });
});

test('Transporte: RPC pendente mantem controles bloqueados mesmo com recalculo tardio', async () => {
  await scenario(async page => {
    await page.locator('#btnSaveTransport').click();
    await page.evaluate(() => window.renderDerived());
    assert.equal(await page.locator('#btnSaveTransport').isDisabled(), true);
    assert.equal(await page.locator('#btnPdfTransport').isDisabled(), true);
    assert.equal(await page.locator('#app').evaluate(el => el.inert), true);
    await page.evaluate(() => window.calls.find(call => call.method === 'salvarTransporte').failure(new Error('Falha simulada')));
    assert.equal(await page.locator('#app').evaluate(el => el.inert), false);
    assert.equal(await page.locator('#btnSaveTransport').isDisabled(), false);
    assert.equal(await page.locator('#btnConvertDhlVolumes').isDisabled(), true, 'preserva bloqueio por regra de conversao');
  });
});

test('Transporte: sair sem salvar restaura os dados salvos e a proxima edicao volta a exigir aviso', async () => {
  await scenario(async page => {
    await page.locator('#temperaturas button').filter({ hasText: 'CONGELADO' }).click();
    await page.locator('#observacoes').fill('Alteracao local nao salva');
    await page.evaluate(() => window.transportConfirmLeaveDirty());
    await page.locator('#confirmTransportUnsavedModal .btn.danger').click();
    assert.equal(await page.locator('#observacoes').inputValue(), '');
    assert.equal(await page.locator('#temperaturas button[aria-pressed="true"]').innerText(), 'AMBIENTE');
    assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), false);
    await page.locator('#observacoes').fill('Outra alteracao');
    assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
    assert.equal(await page.evaluate(() => window.transportAllowLeaveOnce), false);
    assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'salvarTransporte' || call.method === 'limparTransporte')), false);
  });
});

test('Transporte manual: busca por nome, estudo e ID preserva participacoes homonimas em desktop e celular', async () => {
  const homonyms = [
    { id: 'CAD-A', nome: 'Márcia Silva', projeto: 'Estudo A', idParticipante: '123', investigador: 'Investigador A' },
    { id: 'CAD-B', nome: 'Márcia Silva', projeto: 'Estudo B', idParticipante: '456', investigador: 'Investigador B' }
  ];
  for (const width of [1280, 390]) {
    await scenario(async page => {
      const search = page.locator('#pacienteSearch');
      assert.equal(await search.inputValue(), 'Márcia Silva');
      assert.ok((await page.locator('#pacienteSearchDetail').innerText()).includes('Estudo A · ID 123'));
      await search.fill('marcia');
      await page.waitForFunction(() => window.transportParticipantSearchTimer === null);
      assert.equal(await page.locator('#pacienteSearchList [role="option"]').count(), 2);
      assert.ok((await page.locator('#pacienteSearchList').innerText()).includes('Estudo B'));
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), false, 'digitar busca nao altera dados');
      await search.press('Enter');
      assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-A', 'nome ambiguo nao seleciona automaticamente');
      await search.press('ArrowDown');
      await search.press('ArrowDown');
      await search.press('Enter');
      assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-B');
      assert.equal(await page.locator('#protocolo').inputValue(), 'Estudo B');
      assert.equal(await page.locator('#identificacaoParticipante').inputValue(), '456');
      assert.equal(await page.evaluate(() => window.collectPayload().participanteCadastroId), 'CAD-B');
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
      await page.evaluate(() => window.transportClearUnsaved());
      await search.fill('estudo a');
      await page.waitForFunction(() => window.transportParticipantSearchTimer === null);
      assert.equal(await page.locator('#pacienteSearchList [role="option"]').count(), 1);
      await search.press('Escape');
      assert.equal(await search.inputValue(), 'Márcia Silva');
      assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-B');
      await search.fill('456');
      await page.waitForFunction(() => window.transportParticipantSearchTimer === null);
      assert.equal(await page.locator('#pacienteSearchList [role="option"]').count(), 1);
      await search.press('Enter');
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), false, 'reconfirmar mesma participacao nao marca alteracao');
      await search.fill('inexistente');
      await page.waitForFunction(() => window.transportParticipantSearchTimer === null);
      assert.ok((await page.locator('#pacienteSearchList').innerText()).includes('Nenhuma participação'));
      await search.press('Tab');
      assert.equal(await search.inputValue(), 'Márcia Silva');
      assert.equal(await page.evaluate(() => window.collectPayload().participanteCadastroId), 'CAD-B');
      await search.fill('marcia');
      await page.waitForFunction(() => window.transportParticipantSearchTimer === null);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.locator('.study-grid').screenshot({ path: path.join(dir, 'transport-participant-search-' + width + '.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }, { viewport: { width, height: 900 }, participants: homonyms });
  }
});

test('Transporte da Agenda: participante pronto, somente leitura e sem carregar lista completa', async () => {
  await scenario(async page => {
    const search = page.locator('#pacienteSearch');
    assert.equal(await search.inputValue(), 'Pessoa A');
    assert.equal(await search.evaluate(el => el.readOnly), true);
    assert.ok((await page.locator('#pacienteSearchDetail').innerText()).includes('Definido na Agenda'));
    assert.equal(await page.locator('#agendaContext').isVisible(), true);
    await search.click();
    await search.press('KeyX');
    assert.equal(await search.inputValue(), 'Pessoa A');
    assert.equal(await page.locator('#pacienteSearchList').isVisible(), false);
    assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'getTransporteParticipantesOptions')), false);
    const payload = await page.evaluate(() => window.collectPayload());
    assert.equal(payload.participanteCadastroId, 'CAD-A');
    assert.equal(payload.identificacaoParticipante, '123');
    assert.equal(payload.protocolo, 'Estudo A');
    assert.equal(payload.idAgenda, 'EVT-A');
    assert.equal(payload.agendaSlot, '2');
    assert.equal(await page.locator('#btnSaveTransport').isDisabled(), false);
    assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), false);
  }, { fromAgenda: true });
});

test('Transporte manual: retorno tardio preserva texto da busca e nao reabre lista depois da selecao', async () => {
  await scenario(async page => {
    const search = page.locator('#pacienteSearch');
    await search.fill('Pessoa B');
    await page.evaluate(rows => window.calls.find(call => call.method === 'getTransporteParticipantesOptions').success(rows), participants);
    assert.equal(await search.inputValue(), 'Pessoa B');
    assert.equal(await page.locator('#pacienteSearchList [role="option"]').count(), 1);
    assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-A');
    await page.getByRole('option', { name: /Pessoa B/ }).click();
    assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-B');
    assert.equal(await page.locator('#pacienteSearchList').isVisible(), false);
  }, { partialParticipants: true });
});

test('Transporte manual: nomes com HTML e aspas aparecem como texto sem executar codigo', async () => {
  await scenario(async page => {
    await page.locator('#pacienteSearch').fill('img');
    assert.equal(await page.locator('#pacienteSearchList img').count(), 0);
    assert.ok((await page.locator('#pacienteSearchList').innerText()).includes('<img'));
    await page.locator('#pacienteSearchList').getByRole('option').click();
    assert.equal(await page.evaluate(() => !!window.injected), false);
    assert.equal(await page.evaluate(() => window.collectPayload().participanteCadastroId), 'CAD-X');
  }, { participants: participants.concat([{ id: 'CAD-X', nome: 'Pessoa "A" <img src=x onerror="window.injected=true">', projeto: 'Estudo X', idParticipante: '789', investigador: 'Investigador' }]) });
});

test('Transporte manual: limpar selecao esvazia identificacao e impede salvar texto livre', async () => {
  await scenario(async page => {
    await page.getByRole('button', { name: 'Limpar seleção do participante' }).click();
    assert.equal(await page.locator('#paciente').inputValue(), '');
    assert.equal(await page.locator('#pacienteSearch').inputValue(), '');
    assert.equal(await page.locator('#protocolo').inputValue(), '');
    assert.equal(await page.locator('#identificacaoParticipante').inputValue(), '');
    assert.equal(await page.locator('#btnSaveTransport').isDisabled(), true);
    await page.locator('#pacienteSearch').fill('Nome livre nao cadastrado');
    await page.locator('#pacienteSearch').press('Enter');
    assert.equal(await page.evaluate(() => window.collectPayload().participanteCadastroId), '');
    assert.equal(await page.locator('#btnSaveTransport').isDisabled(), true);
  });
});


test('Transporte: falha legada nao abre modal nem apresenta sucesso', async () => {
  await scenario(async page => {
    await page.locator('#btnPdfTransport').click();
    await page.evaluate(() => window.calls.find(call => call.method === 'gerarPdfTransporte').success('Erro ao gerar PDF: identificação nominal presente'));
    assert.match(await page.locator('#toast').getAttribute('class'), /danger/);
    assert.match(await page.locator('#actionStatus').innerText(), /identificação nominal/);
    assert.equal(await page.locator('#pdfModal').isVisible(), false);
    assert.equal(await page.locator('#btnPdfTransport').isDisabled(), false);
    await page.evaluate(() => window.serverCall('sincronizarTransporte', [], 'Sucesso', () => { window.unexpectedAfter = true; }));
    await page.evaluate(() => window.calls.find(call => call.method === 'sincronizarTransporte').success('Erro ao sincronizar'));
    assert.match(await page.locator('#toast').getAttribute('class'), /danger/);
    assert.equal(await page.evaluate(() => !!window.unexpectedAfter), false);
  });
});

test('Transporte: mensagens especificas de seguranca e Gmail sao preservadas', async () => {
  await scenario(async page => {
    for (const message of ['PDF bloqueado: identificação nominal ainda presente. Revise o modelo.', 'Autorizacao do Gmail pendente. Abra o link de autorizacao.']) {
      assert.equal(await page.evaluate(message => window.transportErrorMessage({ message }), message), message);
    }
    await page.evaluate(() => window.showPdfModal({ type: 'pdf', fileId: 'PDF', fileUrl: 'https://example.invalid/pdf', draftOk: false,
      draftErrorCode: 'GMAIL_AUTH', draftError: 'Autorize o Gmail.', draftAuthUrl: 'https://example.invalid/auth', warnings: [{ message: 'Revise o volume MARKEN.' }] }));
    assert.match(await page.locator('#pdfDraftWarning').innerText(), /Autorize o Gmail/);
    assert.equal(await page.locator('#pdfDraftWarning a').getAttribute('href'), 'https://example.invalid/auth');
    assert.match(await page.locator('#pdfGenerationWarnings').innerText(), /volume MARKEN/);
    await page.evaluate(() => window.showPdfModal({ type: 'pdf', fileId: 'PDF2', fileUrl: 'https://example.invalid/pdf2', draftOk: true, warnings: [] }));
    assert.equal(await page.locator('#pdfGenerationWarnings').innerText(), '');
    assert.equal(await page.locator('#pdfDraftWarning').innerText(), '');
  });
});


test('Transporte: colagem chega ao campo e somente input marca alteracao', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => {
        window.selectCourier('MARKEN');
        window.transportClearUnsaved();
        const input = document.getElementById('awb');
        window.transportPasteReached = false;
        input.addEventListener('paste', () => { window.transportPasteReached = true; });
        input.dispatchEvent(new window.ClipboardEvent('paste', { bubbles: true, cancelable: true }));
      });
      assert.equal(await page.evaluate(() => window.transportPasteReached), true);
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), false, 'paste sem mudanca nao marca alteracao');
      // Evento sintetico nao insere texto: simula separadamente a insercao nativa e seu input.
      await page.evaluate(() => {
        const input = document.getElementById('awb');
        input.value = 'ab-12 cd34 ef56';
        input.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: 'ab-12 cd34 ef56' }));
      });
      assert.equal(await page.locator('#awb').inputValue(), 'AB12CD34EF56');
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), true);
      assert.match(await page.locator('#actionStatus').innerText(), /nao salvas/);
    }, { viewport: { width, height: 900 } });
  }
});


test('Transporte: geracao usa uma RPC, preserva aviso da Agenda e alerta durante processamento', async () => {
  await scenario(async page => {
    await page.locator('#btnPdfTransport').click();
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'salvarTransporte').length), 0);
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'gerarPdfTransporte').length), 1);
    const blocked = await page.evaluate(() => {
      window.transportClearUnsaved();
      const event = new window.Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(blocked, true);
    await page.evaluate(() => window.calls.find(c => c.method === 'gerarPdfTransporte').success({ type: 'pdf', fileId: 'PDF', fileUrl: 'https://example.invalid/pdf',
      message: 'PDF gerado.', agendaSync: { warnings: ['Agenda possui AWB diferente.'] } }));
    assert.match(await page.locator('#actionStatus').innerText(), /AWB diferente/);
    assert.match(await page.locator('#toast').getAttribute('class'), /warn/);
    assert.equal(await page.evaluate(() => {
      const event = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
    }), false);
  });
});

test('Transporte: download usa Blob com bytes corretos e libera URL', async () => {
  await scenario(async page => {
    await page.evaluate(() => {
      window._lastGeneratedPdf = { fileId: 'PDF', fileName: 'teste.pdf' };
      window.URL.createObjectURL = blob => { window.downloadBlob = blob; return 'blob:teste'; };
      window.URL.revokeObjectURL = url => { window.revokedDownload = url; };
      window.HTMLAnchorElement.prototype.click = function() { window.downloadHref = this.getAttribute('href'); };
      const originalTimeout = window.setTimeout;
      window.setTimeout = (fn, delay) => delay === 60000 ? (window.downloadCleanup = fn, 0) : originalTimeout(fn, delay);
      window.downloadGeneratedPdf();
      window.calls.find(c => c.method === 'baixarPdfTransporte').success({ base64: 'JVBERi0=', mimeType: 'application/pdf' });
    });
    assert.equal(await page.evaluate(() => window.downloadHref), 'blob:teste');
    assert.equal(await page.evaluate(() => window.downloadBlob.text()), '%PDF-');
    assert.equal(await page.evaluate(() => window.downloadBlob.type), 'application/pdf');
    await page.evaluate(() => window.downloadCleanup());
    assert.equal(await page.evaluate(() => window.revokedDownload), 'blob:teste');
    assert.equal(await page.locator('#pdfDownloadLink').isDisabled(), false);
  });
});


test('Transporte: retentativas conservam token, armazenamento guarda somente identificador', async () => {
  await scenario(async page => {
    await page.locator('#btnPdfTransport').click();
    const first = await page.evaluate(() => window.calls.find(c => c.method === 'gerarPdfTransporte').args[0].generationRequestId);
    assert.match(first, /^[a-f0-9]{32}$/);
    await page.evaluate(() => window.calls.find(c => c.method === 'gerarPdfTransporte').failure(new Error('Resposta perdida')));
    await page.locator('#btnPdfTransport').click();
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'gerarPdfTransporte')[1].args[0].generationRequestId), first);
    const stored = await page.evaluate(() => JSON.stringify(window.transportTestStorage));
    assert.doesNotMatch(stored, /Pessoa A|Estudo A|materiais|paciente/);
    await page.evaluate(() => window.calls.filter(c => c.method === 'gerarPdfTransporte')[1].success({ type: 'pdf', fileId: 'PDF', fileUrl: 'https://example.invalid/pdf', message: 'PDF recuperado.' }));
    await page.evaluate(() => { window.confirm = () => false; window.newTransportGeneration(); });
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.method === 'gerarPdfTransporte').length), 2);
    await page.evaluate(() => { window.confirm = () => true; window.newTransportGeneration(); });
    const third = await page.evaluate(() => window.calls.filter(c => c.method === 'gerarPdfTransporte')[2].args[0].generationRequestId);
    assert.notEqual(third, first);
  });
});

test('Transporte: falha de armazenamento bloqueia RPC e mudanca de payload usa outro token', async () => {
  await scenario(async page => {
    await page.evaluate(() => { window.localStorage.setItem = () => { throw new Error('storage'); }; });
    await page.locator('#btnPdfTransport').click();
    assert.equal(await page.evaluate(() => window.calls.some(c => c.method === 'gerarPdfTransporte')), false);
    assert.match(await page.locator('#actionStatus').innerText(), /armazenamento/);
  });
  await scenario(async page => {
    const first = await page.evaluate(() => window.transportGenerationRequest(window.collectPayload()));
    await page.locator('#awb').fill('AB12CD34EF56');
    const second = await page.evaluate(() => window.transportGenerationRequest(window.collectPayload()));
    assert.notEqual(second, first);
  });
});


test('Transporte: recuperacao incerta nao afirma que draft deixou de ser criado', async () => {
  await scenario(async page => {
    await page.evaluate(() => window.showPdfModal({ type: 'pdf', fileId: 'PDF', fileUrl: 'https://example.invalid/pdf',
      draftOk: false, draftErrorCode: 'GENERATION_UNCERTAIN', draftError: 'O rascunho pode ter sido criado. Confira o Gmail.' }));
    const warning = await page.locator('#pdfDraftWarning').innerText();
    assert.match(warning, /não foi possível confirmar/);
    assert.doesNotMatch(warning, /não foi criado/);
    assert.match(await page.locator('#issues').innerText(), /nao confirmado/);
  });
});


test('Transporte: trocar courier preserva AWB e exige revisao antes de salvar codigo incompatível', async () => {
  await scenario(async page => {
    await page.locator('#awb').fill('AB12CD34EF56');
    await page.evaluate(() => window.selectCourier('DHL'));
    assert.equal(await page.locator('#awb').inputValue(), 'AB12CD34EF56');
    await page.evaluate(() => window.saveData());
    assert.equal(await page.evaluate(() => window.calls.some(c => c.method === 'salvarTransporte')), false);
    await page.evaluate(() => window.selectCourier('MARKEN'));
    assert.equal(await page.locator('#awb').inputValue(), 'AB12CD34EF56');
  });
});

test('Transporte: participante sem ID conserva chave na ordenacao e recusa duplicatas ambiguas', async () => {
  await scenario(async page => {
    await page.evaluate(() => {
      window.state.options.participantes = [{ nome: 'Zoe', projeto: 'Estudo B', idParticipante: '9' }, { nome: 'Ana', projeto: 'Estudo A', idParticipante: '7' }];
      window.fillParticipantOptions(window.sortRowsByText(window.state.options.participantes, 'nome'), {});
      document.getElementById('paciente').value = window.participantOptionKey(window.state.options.participantes[1], 1);
    });
    assert.equal(await page.evaluate(() => window.selectedParticipantInfo().nome), 'Ana');
    assert.equal(await page.evaluate(() => window.transportParticipantSearchRows().find(r => r.name === 'Ana').key), await page.locator('#paciente').inputValue());
    await page.evaluate(() => window.state.options.participantes.push({ nome: 'Ana', projeto: 'Estudo A', idParticipante: '7' }));
    assert.deepEqual(await page.evaluate(() => window.selectedParticipantInfo()), {});
  });
});

test('Transporte: total legado fracionario permanece exato sem inferir segmentos', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => window.renderMaterials([{ ativo: true, material: 'Soro', tubos: 7, total: 0.03, formula: '', unit: 'mL', ensaio: 'Original' }]));
      const row = page.locator('.ag-mat-line').first();
      assert.equal(await row.locator('.ag-mat-formula').inputValue(), '');
      assert.equal(await row.locator('.ag-mat-tubos').innerText(), '7');
      assert.equal(await row.locator('.ag-mat-total-line').innerText(), '0,03 mL');
      await row.locator('.ag-mat-ensaio').fill('Revisado');
      const material = await page.evaluate(() => window.collectPayload().materiais.find(m => m.material === 'Soro'));
      assert.equal(material.tubos, 7); assert.equal(material.total, 0.03); assert.equal(material.formula, '');
      const server = runFile('TransporteCodexConfig.gs');
      server.codexMatBioValidateTransportPayload_({ courier: 'MARKEN', materiais: [material] });
      assert.equal(material.total, 0.03);
      await page.evaluate(() => window.selectCourier('DHL'));
      assert.equal(await page.evaluate(() => window.dhlVolumeConversionPending()), true);
      await page.locator('#btnConvertDhlVolumes').click();
      const converted = await page.evaluate(() => window.collectPayload().materiais.find(m => m.material === 'Soro'));
      assert.equal(converted.total, 0.03 / 1000); assert.equal(converted.tubos, 7); assert.equal(converted.formula, '');
      await row.locator('.ag-mat-formula').fill('2x0,5');
      assert.equal(await page.evaluate(() => window.collectPayload().materiais.find(m => m.material === 'Soro').total), 1);
    }, { viewport: { width, height: 900 } });
  }
});
