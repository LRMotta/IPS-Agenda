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

async function scenario(run, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', ...options });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const errors = await agendaBrowserFixture(page);
    assert.equal(await page.title(), 'Agenda — teste local');
    assert.ok((await page.locator('body').innerText()).includes('AGENDA'));
    await run(page);
    assert.deepEqual(errors, [], 'nenhum erro de JavaScript ou console');
  } finally { await context.close(); }
}

test('DOM real: kits filtrados por identidade exata em desktop e celular', async () => {
  for (const width of [1280, 390]) {
    await scenario(async (page) => {
      assert.deepEqual(await page.locator('#agKit1 option').allTextContents(), ['-- kit de coleta --', 'Kit A']);
      await page.locator('#agKit1').selectOption('K1');
      assert.equal(await page.locator('#agKit1').inputValue(), 'K1');
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'agenda-' + width + '.png'), fullPage: true, animations: 'disabled' });
    }, { viewport: { width, height: 900 } });
  }
});

test('resumo remoto preserva projeto, kit e monitor historicos no formulario', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      // Componentes de resumo do shell, fora do contrato exercitado aqui.
      window.atualizarAgendaProjetoLock = window.agendaMatBioUpdateAllCopyOptions = window.agendaMostrarParticipanteInfo = () => {};
      window.onAgendaParticipanteChange({ preservarCampos: true });
      window.calls.find((call) => call.method === 'getInfoParticipante').success({ id: 'P', nome: 'Participante de teste', projeto: 'Estudo AB' });
    });
    assert.equal(await page.locator('#agProjeto').inputValue(), 'Estudo A');
    assert.equal(await page.locator('#agKit1').inputValue(), 'K1');
    assert.equal(await page.locator('#agMonitor1').inputValue(), 'M');
  });
});

test('confirmacao e retorno de reserva, baixa e devolucao nao alteram outra edicao', async () => {
  for (const mode of ['reservar', 'baixar', 'devolver']) {
    await scenario(async (page) => {
      await page.evaluate((mode) => {
        // Payload ja validado: este cenario verifica a confirmacao e o retorno.
        window.coletarAgendaEvento = () => ({ projeto: 'Estudo A', participante: 'Teste' });
        window._agendaKitsBaixados = mode === 'devolver';
      }, mode);
      const button = mode === 'reservar' ? '#btnReservarKitsAgenda' : '#btnBaixarKitsAgenda';
      await page.locator(button).click();
      if (mode === 'reservar') {
        const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, 'agenda-confirmacao-kits.png'), animations: 'disabled' });
      }
      await page.locator('#btnConfirmAgendaKits').click();
      assert.equal(await page.evaluate(() => window.calls[0].args[0].agendaId), 'A');
      await page.evaluate(() => {
        window._agendaEditId = 'B'; window._agendaEditOpenRequestId += 1;
        window.setAgendaKitsReservaState(false); window.setAgendaKitsBaixaState(false);
        document.getElementById('btnBaixarKitsAgenda').disabled = false;
        window.calls[0].success({});
        window.calls[0].failure(new Error('Resposta atrasada'));
      });
      assert.equal(await page.locator('#btnReservarKitsAgenda').isEnabled(), true);
      assert.equal(await page.evaluate(() => window._agendaKitsBaixados), false);
      assert.deepEqual(await page.evaluate(() => window.notifications), []);
      // A confirmacao aberta para B tambem deve perder validade ao trocar a edicao.
      await page.locator(button).click();
      await page.evaluate(() => { window._agendaEditId = 'C'; window._agendaEditOpenRequestId += 1; });
      await page.locator('#btnConfirmAgendaKits').click();
      assert.equal(await page.evaluate(() => window.calls.length), 1);
    });
  }
});

test('retorno de salvar A conserva formulario e alteracoes pendentes de B', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      // Isola o ciclo de resposta do salvamento; validacoes de dominio ficam na suite Node.
      window.updateAgendaSaveAvailability = window.validarAgendaCampo = window.validarAgendaAlertasDataPassada = window.validarAgendaRealizadoFuturo = window.validarAgendaCourierStatusData_ = window.validateAgendaAwbs = () => true;
      window.coletarAgendaEvento = () => ({ data: '2026-10-04', status: 'Agendado' });
      window.agendaDataAlteradaInfo_ = () => null;
      document.getElementById('agData').value = '2026-10-04';
      document.getElementById('agHora').value = '10:00';
      document.getElementById('agLabCentral').value = 'Não';
    });
    await page.locator('#btnSalvarAgenda').click();
    assert.equal(await page.evaluate(() => window.calls[0].args[0].id), 'A');
    await page.evaluate(() => {
      window._agendaEditId = 'B'; window._agendaEditOpenRequestId += 1; window.dirty = true;
      document.getElementById('agVisita').value = 'Visita B';
      window.calls[0].success({ id: 'A' });
      window.calls[0].failure(new Error('Atrasada'));
    });
    assert.equal(await page.locator('#agVisita').inputValue(), 'Visita B');
    assert.equal(await page.evaluate(() => window.dirty), true);
    assert.equal(await page.locator('#agendaCreatePanel').evaluate((element) => element.classList.contains('open')), true);
  });
});

test('apagar a busca descarta falha antiga durante debounce', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      window.renderAgendaOperacional = () => { document.getElementById('agendaViewLista').textContent = 'Lista atual'; };
      document.getElementById('agendaBusca').value = 'Pessoa A';
      window.agendaCarregarHistorico('Pessoa A', null, 0);
    });
    await page.locator('#agendaBusca').fill('');
    await page.evaluate(() => window.calls[0].failure(new Error('Atrasada')));
    assert.equal(await page.locator('#agendaViewLista').textContent(), 'Lista atual');
  });
});

test('recibo real descarta resposta antiga e usa a data de Sao Paulo em outro fuso', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      window.abrirAgendaRecibo('A'); window.abrirAgendaRecibo('B');
      const data = { projeto: 'Estudo B', dataVisitaIso: '2026-10-04', beneficiarios: [{ nome: 'Pessoa B de teste', tipo: 'Participante', cpf: '52998224725', valorPadrao: 10 }] };
      window.calls[1].success(data);
      window.calls[0].failure(new Error('Atrasada'));
      window.calls[0].success({ ...data, projeto: 'Estudo A', beneficiarios: [{ nome: 'Pessoa A de teste', tipo: 'Participante' }] });
    });
    assert.equal(await page.locator('#agendaReciboTitular').inputValue(), 'Pessoa B de teste');
    assert.equal(await page.locator('#agendaReciboDataEmissao').inputValue(), '2026-10-04');
    assert.equal(await page.evaluate(() => window.agendaIso(window.agendaWeekStartForOffset_(0))), '2026-09-28');
  });
});
