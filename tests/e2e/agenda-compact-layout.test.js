'use strict';
/* global window, document, getComputedStyle */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');
const { installMaterialIcons } = require('../helpers/material-icons');
let browser;
before(async () => { browser = await loadPlaywright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

// Relogio fixo: hoje (Sao Paulo) e domingo 04/10; a semana atual vai de 28/09 a 04/10.
// Apenas 30/09 tem agendamentos; os demais dias sao livres.
async function scenario(run, width, height = 844) {
  const context = await browser.newContext({ viewport: { width, height } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const errors = await agendaBrowserFixture(page);
    await page.addStyleTag({ content: 'body{padding:0}#page-agenda{display:block}' });
    // Fonte de icones local (quando instalada) para medir larguras como no app; senao, aproximacao por CSS.
    await installMaterialIcons(page);
    await page.evaluate(() => {
      document.getElementById('agendaCreatePanel').classList.remove('open');
      const main = document.createElement('main');
      main.className = 'main';
      main.style.height = '100vh';
      const content = document.createElement('div');
      content.className = 'content';
      document.body.append(main);
      main.append(content);
      content.append(document.getElementById('page-agenda'));
      const rows = [];
      for (let i = 0; i < 8; i++) {
        rows.push({
          id: 'A' + i, rowIndex: i + 2, dataIso: '2026-09-30', tipo: 'Visita',
          hora: String(8 + i).padStart(2, '0') + ':00', status: 'Agendado',
          participante: 'Participante ' + i, projeto: 'Estudo AB', visita: 'Visita ' + i, _search: 'participante ' + i,
        });
      }
      window._agendaEventos = rows;
      window._agendaEventosScope = 'window';
      window._agendaEventosTruncated = false;
      window.renderAgendaOperacional();
    });
    await run(page);
    assert.deepEqual(errors, [], 'nenhum erro de JavaScript ou console');
  } finally { await context.close(); }
}

const rect = (page, selector) => page.locator(selector).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
});
const shot = async (page, name) => {
  const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + '.png'), animations: 'disabled' });
};

for (const width of [1440, 390]) {
  test('Agenda: dia livre ocupa uma linha compacta e dias com agendamentos nao mudam em ' + width + 'px', async () => {
    await scenario(async (page) => {
      const free = page.locator('#agendaDay-2026-09-29');
      assert.ok(/\bfree\b/.test(await free.getAttribute('class')));
      assert.match(await free.innerText(), /Dia livre/);
      assert.doesNotMatch(await free.innerText(), /evento\(s\)/, 'sem a pilula 0 evento(s)');
      const freeBox = await rect(page, '#agendaDay-2026-09-29');
      assert.ok(freeBox.height <= 52, 'cabecalho de dia livre compacto: ' + freeBox.height);
      // O proprio cabecalho e o proximo elemento: nao sobra bloco "Dia livre - sem agendamentos".
      assert.equal(await page.evaluate(() => document.getElementById('agendaDay-2026-09-29').nextElementSibling.id), 'agendaDay-2026-09-30');
      assert.equal(await page.locator('#agendaViewLista > .ag-empty').count(), 0);
      // Impressao do dia segue disponivel e dentro da linha.
      const print = await rect(page, '#agendaDay-2026-09-29 .ag-print-day');
      assert.ok(print.top >= freeBox.top - 1 && print.bottom <= freeBox.bottom + 1, JSON.stringify({ print, freeBox }));

      const busy = page.locator('#agendaDay-2026-09-30');
      assert.ok(!/\bfree\b/.test(await busy.getAttribute('class')));
      assert.match(await busy.innerText(), /8 Visitas/);
      assert.equal(await page.locator('#agendaViewLista [id^="agCard"]').count(), 8);
      // Sete cabecalhos continuam presentes na semana (um por dia).
      assert.equal(await page.locator('#agendaViewLista .ag-day-hdr').count(), 7);
      // Sem rolagem horizontal no cabecalho livre.
      assert.ok(await free.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      await shot(page, 'agenda-dia-livre-' + width);
    }, width);
  });
}

test('Agenda: barra de ferramentas em desktop mantem busca visivel e Novo Agendamento rotulado', async () => {
  await scenario(async (page) => {
    assert.equal(await page.locator('#agendaBtnBuscaToggle').isVisible(), false);
    assert.equal(await page.locator('#agendaBusca').isVisible(), true);
    const novo = page.locator('#agendaBtnNovo');
    assert.equal(await novo.evaluate((el) => getComputedStyle(el).position), 'static');
    assert.equal(await novo.locator('.ag-tb-label').isVisible(), true);
    assert.equal(await novo.getAttribute('aria-label'), 'Novo Agendamento');
  }, 1440, 900);
});

test('Agenda: barra compacta no celular com busca recolhida e Novo flutuante', async () => {
  await scenario(async (page) => {
    // Linha 1 (navegacao) e linha 2 (periodo e visoes): bem abaixo dos ~230px da barra anterior.
    const toolbar = await rect(page, '.ag-toolbar');
    assert.ok(toolbar.height <= 100, 'barra compacta: ' + toolbar.height);
    for (const sel of ['[title="Semana anterior"]', '#agendaBtnHoje', '#agendaDateJump', '[title="Próxima semana"]',
      '#agendaBtnBuscaToggle', '#agendaBtnAtualizar', '#agendaPeriodo', '#agendaBtnLista', '#agendaBtnSemana']) {
      const box = await rect(page, sel);
      assert.ok(box.width > 0 && box.height > 0, sel + ' visivel');
      assert.ok(box.left >= 0 && box.right <= 390 + 0.5, sel + ' dentro da tela: ' + JSON.stringify(box));
    }
    assert.equal(await page.locator('#agendaBusca').isVisible(), false);
    assert.equal(await page.locator('#agendaBtnBuscaToggle').getAttribute('aria-expanded'), 'false');

    // Abrir a busca mostra e foca o campo.
    await page.locator('#agendaBtnBuscaToggle').click();
    assert.equal(await page.locator('#agendaBusca').isVisible(), true);
    assert.equal(await page.locator('#agendaBtnBuscaToggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'agendaBusca');
    await page.locator('#agendaBusca').fill('Part');
    // Fechar com texto limpa a busca (nao deixa filtro oculto ativo) e restaura a lista.
    await page.locator('#agendaBtnBuscaToggle').click();
    assert.equal(await page.locator('#agendaBusca').isVisible(), false);
    assert.equal(await page.locator('#agendaBusca').inputValue(), '');
    assert.equal(await page.locator('#agendaBtnBuscaToggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#agendaViewLista .ag-day-hdr').count(), 7, 'lista semanal restaurada');

    // Novo Agendamento: botao flutuante circular, sem rotulo visivel e dentro da tela.
    const novo = page.locator('#agendaBtnNovo');
    assert.equal(await novo.evaluate((el) => getComputedStyle(el).position), 'fixed');
    assert.equal(await novo.locator('.ag-tb-label').isVisible(), false);
    assert.equal(await novo.getAttribute('aria-label'), 'Novo Agendamento');
    const fab = await rect(page, '#agendaBtnNovo');
    assert.ok(fab.width >= 44 && fab.height >= 44, 'alvo de toque: ' + JSON.stringify(fab));
    assert.ok(fab.right <= 390 && fab.bottom <= 844 && fab.left > 200 && fab.top > 600, JSON.stringify(fab));

    // Permanece no lugar ao rolar e nao cobre o fim da lista.
    await page.locator('.main .content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const after = await rect(page, '#agendaBtnNovo');
    assert.deepEqual({ top: after.top, left: after.left }, { top: fab.top, left: fab.left });
    const wrapBottom = (await rect(page, '.ag-view-wrap')).bottom;
    assert.ok(wrapBottom <= after.top, 'fim da lista acima do botao flutuante: ' + wrapBottom + ' > ' + after.top);
    await page.locator('.main .content').evaluate((el) => { el.scrollTop = 0; });
    await shot(page, 'agenda-barra-compacta-390');

    // O botao abre o formulario normalmente e o formulario fica acima dele.
    await page.evaluate(() => { window.toggleAgendaCreate = () => { document.getElementById('agendaCreatePanel').classList.add('open'); }; });
    await novo.click();
    const center = { x: fab.left + fab.width / 2, y: fab.top + fab.height / 2 };
    assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y).closest('#agendaCreatePanel'), center), true,
      'formulario cobre o botao flutuante');
  }, 390);
});

test('Agenda: visao Semana no celular mantem a barra compacta e impressao em icone', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => window.agendaSetView('semana'));
    const print = page.locator('#agendaBtnPrintWeek');
    assert.equal(await print.isVisible(), true);
    assert.equal(await print.locator('.ag-tb-label').isVisible(), false);
    assert.equal((await rect(page, '#agendaBtnPrintWeek')).width, 32);
    assert.equal(await print.getAttribute('title'), 'Imprimir semana');
    const toolbar = await rect(page, '.ag-toolbar');
    assert.ok(toolbar.height <= 140, 'barra na Semana: ' + toolbar.height);
    await shot(page, 'agenda-barra-semana-390');
  }, 390);
});
