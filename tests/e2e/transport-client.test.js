'use strict';
/* global window, document */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { transportBrowserFixture, participants } = require('../helpers/transport-browser-fixture');

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
      assert.equal(await page.locator('#pacienteSearchList [role="option"]').count(), 1);
      await search.press('Escape');
      assert.equal(await search.inputValue(), 'Márcia Silva');
      assert.equal(await page.locator('#paciente').inputValue(), 'participante:CAD-B');
      await search.fill('456');
      assert.equal(await page.locator('#pacienteSearchList [role="option"]').count(), 1);
      await search.press('Enter');
      assert.equal(await page.evaluate(() => window.transportHasUnsavedChanges), false, 'reconfirmar mesma participacao nao marca alteracao');
      await search.fill('inexistente');
      assert.ok((await page.locator('#pacienteSearchList').innerText()).includes('Nenhuma participação'));
      await search.press('Tab');
      assert.equal(await search.inputValue(), 'Márcia Silva');
      assert.equal(await page.evaluate(() => window.collectPayload().participanteCadastroId), 'CAD-B');
      await search.fill('marcia');
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
