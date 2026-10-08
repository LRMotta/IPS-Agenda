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

async function scenario(run, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Tokyo' });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const errors = await agendaBrowserFixture(page);
    assert.equal(await page.title(), 'Agenda — teste local');
    assert.ok((await page.locator('body').innerText()).includes('AGENDA'));
    await page.evaluate(() => {
      window._agendaDados.feriados = [
        { dataIso: '2025-10-12', nome: 'Nossa Senhora Aparecida', recorrencia: 'Anual', ativo: 'Sim', afetaOperacao: 'Não', observacao: 'Verificar funcionamento do serviço.' },
        { dataIso: '2026-10-13', nome: 'Feriado inativo', ativo: 'Não', afetaOperacao: 'Sim' },
        { dataIso: '2026-10-14', nome: 'Restrição de transporte', ativo: 'Sim', afetaOperacao: 'Sim' }
      ];
      window._agendaDados.courierConfig = {};
      window._agendaDados.projectCourierMap = {};
      document.getElementById('agLabCentral').value = 'Nao';
      window.onAgendaLabCentralChange();
    });
    await run(page);
    assert.deepEqual(errors, [], 'nenhum erro de JavaScript ou console');
  } finally { await context.close(); }
}

test('feriado aparece sem Lab Central e sem restricao operacional em desktop e celular', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.locator('#agData').fill('2026-10-12');
      const general = page.locator('#agendaHolidayAlert');
      assert.equal(await general.isVisible(), true);
      assert.match(await general.innerText(), /12\/10\/2026.*Nossa Senhora Aparecida/);
      assert.match(await general.innerText(), /Verificar funcionamento do serviço/);
      assert.match(await general.innerText(), /agendamento continua permitido/);
      assert.equal(await page.locator('#agendaCourierRiskAlert').isVisible(), false);
      const colors = await page.evaluate(() => {
        const reference = document.createElement('div');
        reference.innerHTML = window.agendaHolidayBannerHtml_('2026-10-12', false);
        document.body.appendChild(reference);
        const properties = ['backgroundColor', 'borderColor', 'borderLeftColor', 'color'];
        const readColors = element => Object.fromEntries(properties.map(property => [property, window.getComputedStyle(element)[property]]));
        const result = {
          general: readColors(document.getElementById('agendaHolidayAlert')),
          calendar: readColors(reference.querySelector('.ag-holiday-banner')),
          courier: readColors(document.getElementById('agendaCourierRiskAlert'))
        };
        reference.remove();
        return result;
      });
      assert.deepEqual(colors.general, colors.calendar, 'aviso geral usa as cores dos feriados no calendario');
      assert.notEqual(colors.general.backgroundColor, colors.courier.backgroundColor, 'courier conserva sua cor distinta');
      await page.locator('#agLabCentral').selectOption('');
      assert.equal(await general.isVisible(), true);
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.locator('#agendaCreatePanel .ag-create-box').screenshot({ path: path.join(dir, 'agenda-feriado-geral-' + width + '.png'), animations: 'disabled' });
      await page.locator('#agData').fill('2026-10-13');
      assert.equal(await general.isVisible(), false);
      await page.locator('#agData').fill('2027-10-12');
      assert.equal(await general.isVisible(), true);
      await page.locator('#agData').fill('');
      assert.equal(await general.isVisible(), false);
      assert.equal(await general.innerHTML(), '');
    }, width);
  }
});

test('avisos geral e de transporte sao independentes e preservam riscos de courier', async () => {
  await scenario(async page => {
    await page.locator('#agData').fill('2026-10-14');
    assert.equal(await page.locator('#agendaHolidayAlert').isVisible(), true);
    assert.equal(await page.locator('#agendaCourierRiskAlert').isVisible(), false);
    await page.locator('#agLabCentral').selectOption('Sim');
    assert.equal(await page.locator('#agendaHolidayAlert').isVisible(), true);
    assert.equal(await page.locator('#agendaCourierRiskAlert').isVisible(), true);
    await page.locator('#agData').fill('2026-10-12');
    assert.equal(await page.locator('#agendaCourierRiskAlert').isVisible(), false);
    await page.evaluate(() => {
      window._agendaDados.projectCourierMap = { P1: { nome: 'Estudo A', couriers: [{ courierId: 'C1', temperaturas: ['Ambiente'] }] } };
      window._agendaDados.courierConfig = { c1: { id: 'C1', nome: 'Courier de teste', restricaoSegunda: 'Sim' } };
      window.agendaAtualizarRiscoCourier_();
    });
    assert.equal(await page.locator('#agendaCourierRiskAlert').isVisible(), false);
    await page.evaluate(() => {
      window._agendaDados.projectCourierMap.P1.couriers[0].temperaturas = ['Congelado'];
      window.agendaAtualizarRiscoCourier_();
    });
    assert.match(await page.locator('#agendaCourierRiskAlert').innerText(), /restrição às segundas-feiras/);
    await page.locator('#agLabCentral').selectOption('Nao');
    assert.equal(await page.locator('#agendaCourierRiskAlert').isVisible(), false);
    assert.equal(await page.locator('#agendaHolidayAlert').isVisible(), true);
  });
});

test('aviso cobre feriado dentro do periodo e atualiza ao trocar data final e tipo', async () => {
  await scenario(async page => {
    await page.evaluate(() => {
      document.getElementById('agTipo').insertAdjacentHTML('beforeend', '<option>Monitoria</option>');
    });
    await page.locator('#agData').fill('2026-10-11');
    await page.locator('#agTipo').selectOption('Monitoria');
    await page.locator('#agDataFim').fill('2026-10-12');
    assert.match(await page.locator('#agendaHolidayAlert').innerText(), /12\/10\/2026.*Nossa Senhora Aparecida/);
    await page.locator('#agDataFim').fill('2026-10-11');
    assert.equal(await page.locator('#agendaHolidayAlert').isVisible(), false);
    await page.locator('#agDataFim').fill('2026-10-14');
    assert.equal(await page.locator('#agendaHolidayAlert .ag-operational-alert-line').count(), 2);
    await page.locator('#agTipo').selectOption('Visita');
    assert.equal(await page.locator('#agendaHolidayAlert').isVisible(), false);
  });
});

test('revalidacao de referencias atualiza o aviso e escapa texto cadastrado', async () => {
  await scenario(async page => {
    await page.locator('#agData').fill('2026-10-12');
    await page.evaluate(() => {
      const data = { ...window._agendaDados, emailLabAtivo: false };
      ['status', 'medicos', 'prestadores', 'monitores', 'salasMonitoria', 'couriers', 'temperaturas', 'statusCourier', 'laboratoriosDestino', 'procedimentoChips', 'laboratorios'].forEach(key => { data[key] = []; });
      data.tiposEvento = ['Visita'];
      data.feriados = [{ dataIso: '2026-10-12', nome: '<img src=x onerror=alert(1)>', observacao: '<script>alert(1)</script>', ativo: 'Sim', afetaOperacao: 'Não' }];
      window.atualizarAgendaFormDataOpcoes(data, { preservarValoresAtuais: true });
    });
    const general = page.locator('#agendaHolidayAlert');
    assert.match(await general.innerText(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await general.locator('img, script').count(), 0);
    await page.evaluate(() => {
      window.atualizarAgendaFormDataOpcoes({ ...window._agendaDados, feriados: [] }, { preservarValoresAtuais: true });
    });
    assert.equal(await general.isVisible(), false);
    // Referencias recebidas pelo bootstrap durante uma edicao atualizam apenas os avisos.
    await page.locator('#agProcedimentos').fill('Texto em edição');
    assert.equal(await page.evaluate(() => window.applyAgendaFormData({ ...window._agendaDados, feriados: [
      { dataIso: '2026-10-12', nome: 'Feriado atualizado', ativo: 'Sim', afetaOperacao: 'Não' }
    ] })), true);
    assert.match(await general.innerText(), /Feriado atualizado/);
    assert.equal(await page.locator('#agProcedimentos').inputValue(), 'Texto em edição');
    await page.evaluate(() => window.applyAgendaFormData({ ...window._agendaDados, feriados: [] }));
    assert.equal(await general.isVisible(), false);
    assert.equal(await page.locator('#agProcedimentos').inputValue(), 'Texto em edição');
  });
});
