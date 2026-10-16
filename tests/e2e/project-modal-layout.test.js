'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { projectModalBrowserFixture } = require('../helpers/project-modal-browser-fixture');

for (const width of [1280, 390]) {
  test('Projeto e SoA mantêm ações visíveis, navegação aninhada e campos salvos em ' + width + 'px', async () => {
    // Browser plugin not available. HTML/CSS e handlers reais, rede e RPCs isoladas.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(6000);
      const errors = await projectModalBrowserFixture(page);
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — Projeto e SoA locais');
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
      await page.locator('#fixtureOpenProject').click();
      await page.waitForFunction(() => document.activeElement.id === 'pNome');
      async function assertShell(id) {
        const modal = page.locator('#' + id);
        await modal.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
        await modal.locator('.modal-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
        const box = await modal.locator('.modal-box').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        for (const selector of ['.modal-header', '.project-modal-footer']) {
          const position = await modal.locator(selector).boundingBox();
          assert.ok(position.y >= 0 && position.y + position.height <= 901, id + ' ' + selector);
        }
        const metrics = await modal.locator('.modal-box').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight }));
        assert.ok(metrics.scrollWidth <= metrics.width + 1, id + ' sem overflow horizontal');
        assert.ok(metrics.scrollHeight <= metrics.height + 1, id + ' somente o corpo rola');
      }
      await assertShell('modalProjeto');
      if (width === 1280) assert.equal((await page.locator('#modalProjeto .modal-box').boundingBox()).width, 900);
      await page.locator('#btnAdicionarSoA').click();
      await page.waitForFunction(() => document.activeElement.closest('#modalSoAVisita'));
      assert.equal(await page.locator('#modalProjeto').getAttribute('inert'), '');
      assert.equal(await page.locator('#modalSoAVisita .section-label').count(), 4);
      await assertShell('modalSoAVisita');
      await page.locator('#modalSoAVisita').getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.waitForFunction(() => document.activeElement.id === 'btnAdicionarSoA');
      assert.equal(await page.locator('#modalProjeto').getAttribute('inert'), null);
      await page.locator('#btnAdicionarSoA').click();
      await page.locator('#btnSalvarSoA').click();
      assert.equal(await page.evaluate(() => window.testRequests.length), 0);
      await page.waitForFunction(() => document.activeElement.id === 'soaNome');
      await page.locator('#soaNome').fill('Visita de acompanhamento');
      await page.locator('#soaCodigo').fill('V2');
      await page.locator('#soaJanelaMenos').fill('3');
      await page.locator('#soaJanelaMais').fill('5');
      await page.locator('#soaAliases').fill('Visita 2; V 2');
      await page.locator('#soaObservacoes').fill('Observação preservada');
      await page.locator('#soaBracosOpcoes input[value="B1"]').check();
      await page.locator('#btnSalvarSoA').click();
      const request = await page.evaluate(() => ({ method: window.testRequests.at(-1).method, payload: window.testRequests.at(-1).args[0] }));
      assert.equal(request.method, 'salvarSoAVisita');
      assert.equal(request.payload.janelaDiasMenos, '3');
      assert.equal(request.payload.janelaDiasMais, '5');
      assert.equal(request.payload.aliases, 'Visita 2; V 2');
      assert.equal(request.payload.observacoes, 'Observação preservada');
      assert.deepEqual(request.payload.bracoIds, ['B1']);
      await page.evaluate(() => window.testRequests.at(-1).onSuccess({ msg: 'Salva' }));
      await page.waitForFunction(() => document.activeElement.id === 'btnAdicionarSoA');
      // Os auxiliares usam o mesmo shell sem alterar a ordem de foco dos diálogos.
      for (const id of ['modalBracoProjeto', 'modalSoAImport', 'modalSoAOrdem', 'modalSoAReplicarCiclo']) {
        await page.evaluate(id => window.abrirOverlay(id), id);
        await page.waitForFunction(id => document.activeElement.closest('#' + id), id);
        await assertShell(id);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.activeElement.id === 'btnAdicionarSoA');
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
