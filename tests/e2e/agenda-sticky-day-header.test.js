'use strict';
/* global window, document */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');
let browser;
before(async () => { browser = await loadPlaywright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

// Relogio fixo: hoje (Sao Paulo) e domingo 04/10; a semana atual vai de 28/09 a 04/10, logo quase todos os dias sao passados.

async function scenario(run, width) {
  const context = await browser.newContext({ viewport: { width, height: 700 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const errors = await agendaBrowserFixture(page);
    await page.addStyleTag({ content: 'body{padding:0}#page-agenda{display:block}' });
    await page.evaluate(() => {
      document.getElementById('agendaCreatePanel').classList.remove('open');
      // Shell real: .main (overflow hidden, altura fixa) > .content (overflow-y auto) > pagina.
      const main = document.createElement('main');
      main.className = 'main';
      main.style.height = '100vh';
      const content = document.createElement('div');
      content.className = 'content';
      document.body.append(main);
      main.append(content);
      content.append(document.getElementById('page-agenda'));
      window._agendaView = 'lista';
      window._agendaWeekOffset = 0;
      // Terca a sexta (29/09 a 02/10) com muitos agendamentos; os demais dias ficam livres.
      const rows = [];
      ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].forEach((iso) => {
        for (let i = 0; i < 14; i++) {
          rows.push({
            id: iso + '-' + i, rowIndex: rows.length + 2, dataIso: iso, tipo: 'Visita',
            hora: String(8 + (i % 9)).padStart(2, '0') + ':00', status: 'Agendado',
            participante: 'Participante ' + i, projeto: 'Estudo AB', visita: 'Visita ' + i,
            _search: 'participante ' + i,
          });
        }
      });
      window._agendaEventos = rows;
      window._agendaEventosScope = 'window';
      window._agendaEventosTruncated = false;
      window.renderAgendaOperacional();
    });
    await run(page);
    assert.deepEqual(errors, [], 'nenhum erro de JavaScript ou console');
  } finally { await context.close(); }
}

// Cabecalho do dia que ocupa o topo da area rolavel (o ultimo que ja alcancou o topo).
const headerAtTop = () => {
  const scroller = document.querySelector('.main .content');
  const top = scroller.getBoundingClientRect().top;
  const headers = [...document.querySelectorAll('#agendaViewLista .ag-day-hdr')];
  const visible = headers.map((el) => ({ id: el.id, rect: el.getBoundingClientRect() }))
    .filter((h) => h.rect.top <= top + 1 && h.rect.bottom > top + 1);
  const last = visible[visible.length - 1];
  return last ? { id: last.id, top: Math.round(last.rect.top - top) } : null;
};

for (const width of [1280, 390]) {
  test('Agenda: cabecalho do dia permanece visivel ao rolar a lista em ' + width + 'px', async () => {
    await scenario(async (page) => {
      const scroller = page.locator('.main .content');
      const maxScroll = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
      assert.ok(maxScroll > 1500, 'fixture precisa rolar bastante: ' + maxScroll);

      // Para cada dia com agendamentos, rola ate o meio dele e confere o cabecalho correto no topo.
      for (const iso of ['2026-09-29', '2026-09-30', '2026-10-01']) {
        const middle = await page.evaluate((day) => {
          const scrollerEl = document.querySelector('.main .content');
          const hdr = document.getElementById('agendaDay-' + day);
          const cards = [...document.querySelectorAll('#agendaViewLista .ag-appt-main')]
            .filter((el) => el.closest('[id^="agCard"]') && el.getBoundingClientRect().top > hdr.getBoundingClientRect().top);
          const target = cards[8] || cards[0];
          const delta = target.getBoundingClientRect().top - scrollerEl.getBoundingClientRect().top - 120;
          scrollerEl.scrollTop += delta;
          return scrollerEl.scrollTop;
        }, iso);
        assert.ok(middle > 0);
        const atTop = await page.evaluate(headerAtTop);
        assert.ok(atTop, 'algum cabecalho de dia deve estar no topo em ' + iso);
        assert.equal(atTop.id, 'agendaDay-' + iso, 'cabecalho do dia ' + iso + ' deve estar no topo');
        assert.equal(atTop.top, 0, 'cabecalho colado no topo da area rolavel');
      }

      // O proximo dia assume o topo ao chegar nele (cabecalho de 02/10 apos o fim de 01/10).
      await page.evaluate(() => {
        const scrollerEl = document.querySelector('.main .content');
        const next = document.getElementById('agendaDay-2026-10-02');
        scrollerEl.scrollTop += next.getBoundingClientRect().top - scrollerEl.getBoundingClientRect().top + 4;
      });
      assert.equal((await page.evaluate(headerAtTop)).id, 'agendaDay-2026-10-02');

      // Cabecalho fixo permanece legivel: sem transparencia que deixe o conteudo ou outro dia aparecer.
      const look = await page.evaluate(() => {
        const hdr = document.getElementById(document.querySelector('.main .content') && 'agendaDay-2026-10-02');
        const style = window.getComputedStyle(hdr);
        return { position: style.position, opacity: style.opacity, background: style.backgroundColor };
      });
      assert.equal(look.position, 'sticky');
      assert.equal(look.opacity, '1', 'cabecalho fixo nao pode ser translucido');
      assert.notEqual(look.background, 'rgba(0, 0, 0, 0)');

      // Voltar ao topo restaura o fluxo normal e o recorte arredondado do contêiner.
      await scroller.evaluate((el) => { el.scrollTop = 0; });
      const first = await page.evaluate(() => {
        const scrollerEl = document.querySelector('.main .content');
        const toolbar = document.querySelector('.ag-toolbar').getBoundingClientRect();
        const hdr = document.getElementById('agendaDay-2026-09-28').getBoundingClientRect();
        return { toolbarBottom: toolbar.bottom, headerTop: hdr.top, scrollTop: scrollerEl.scrollTop };
      });
      assert.equal(first.scrollTop, 0);
      assert.ok(first.headerTop >= first.toolbarBottom - 1, 'primeiro cabecalho permanece abaixo da barra de ferramentas: ' + JSON.stringify(first));
      const wrap = await page.evaluate(() => {
        const style = window.getComputedStyle(document.querySelector('.ag-view-wrap'));
        return { overflowX: style.overflowX, overflowY: style.overflowY, radius: style.borderBottomLeftRadius };
      });
      assert.notEqual(wrap.overflowY, 'hidden', 'overflow:hidden anula o sticky do cabecalho');
      assert.notEqual(wrap.radius, '0px', 'recorte arredondado preservado');

      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.evaluate(() => {
        const scrollerEl = document.querySelector('.main .content');
        const hdr = document.getElementById('agendaDay-2026-09-30');
        scrollerEl.scrollTop += hdr.getBoundingClientRect().top - scrollerEl.getBoundingClientRect().top + 500;
      });
      await page.screenshot({ path: path.join(dir, 'agenda-cabecalho-fixo-' + width + '.png'), animations: 'disabled' });
    }, width);
  });
}

test('Agenda: cabecalhos fixos de dia passado e do dia atual nao ficam translucidos', async () => {
  await scenario(async (page) => {
    const states = await page.evaluate(() => {
      const hdr = (iso) => document.getElementById('agendaDay-' + iso);
      return ['2026-09-29', '2026-09-30', '2026-10-04'].map((iso) => {
        const style = window.getComputedStyle(hdr(iso));
        return { iso, cls: hdr(iso).className, opacity: style.opacity, position: style.position };
      });
    });
    assert.ok(states.some((s) => /\bpast\b/.test(s.cls)), JSON.stringify(states));
    assert.ok(states.some((s) => /\btoday\b/.test(s.cls)), JSON.stringify(states));
    for (const s of states) {
      assert.equal(s.position, 'sticky');
      assert.equal(s.opacity, '1', 'sobreposicao de cabecalhos fixos nao pode ficar translucida: ' + JSON.stringify(s));
    }
  }, 1280);
});
