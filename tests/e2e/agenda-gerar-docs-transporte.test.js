'use strict';
/* global window, document */

// Ponta a ponta no navegador: "Gerar docs" da Agenda (modal e cartão) chega ao passo a passo da tela Transporte,
// com os scripts reais da Agenda e do Transporte. Só a navegação (irPara) e as RPCs são simuladas.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');
const { readProjectFile } = require('../helpers/load-app-script');

let browser;
before(async () => { browser = await loadPlaywright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const sem = (nome) => readProjectFile(nome).replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '');

const ENVIO = {
  ok: true, versao: 3, passo: 'conferir', passos: ['conferir', 'gerar', 'enviar'], internacional: false, avisos: [], dadosAtualizados: true,
  registro: { paciente: 'Participante de teste', protocolo: 'Estudo A', courier: 'MARKEN', temperatura: 'CONGELADO', dataColeta: '2026-10-06', dataEnvio: '2026-10-06',
    destino: 'LAB X', awb: '123456789012', materiais: [{ ativo: true, material: 'Soro', tubos: 2, total: 2, unit: 'mL' }] }
};

async function cenario(run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const erros = await agendaBrowserFixture(page);
    await page.evaluate((html) => {
      const div = document.createElement('div');
      div.innerHTML = html;
      document.body.appendChild(div.firstElementChild);
      window.CURRENT_ACCESS = { ok: true, email: 'eu@example.invalid', role: 'user' };
      window.STATE_PAGINA = 'agenda';
      window.getCurrentPage = () => window.STATE_PAGINA;
      window.appConfirmNavigationIfDirty = () => true;
      window.agendaReleaseEditPresence = () => {};
      // irPara real: troca a página ativa e carrega a tela na mesma chamada.
      window.irPara = (pagina) => {
        window.STATE_PAGINA = pagina;
        document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + pagina));
        if (pagina === 'transporte-central') window.carregarTransporteCentral();
      };
    }, readProjectFile('IndexTransporteCentralContent.html'));
    for (const arquivo of ['IndexTransporteCentralScripts.html', 'IndexTransporteCentralEnvio.html']) await page.addScriptTag({ content: sem(arquivo) });
    await run(page);
    assert.deepEqual(erros, [], 'nenhum erro de JavaScript ou console');
  } finally { await context.close(); }
}

async function responder(page, metodo, resposta) {
  await page.evaluate(({ metodo, resposta }) => {
    const i = window.calls.findIndex((c) => c.method === metodo);
    if (i < 0) throw new Error('RPC não chamada: ' + metodo + ' (' + window.calls.map((c) => c.method).join() + ')');
    window.calls.splice(i, 1)[0].success(resposta);
  }, { metodo, resposta });
}

const rpcs = (page) => page.evaluate(() => window.calls.map((c) => c.method));

test('modal: Gerar docs salva, fecha a edição e abre o envio na tela Transporte', async () => {
  await cenario(async (page) => {
    await page.evaluate(() => {
      window.setAgendaSelectValue('agC1Nome', 'Marken');
      window.setAgendaSelectValue('agC1Temp', 'Congelado');
      window.setAgendaSelectValue('agC1Destino', 'Lab C');
      window.setAgendaFieldValue('agC1Awb', '123456789012');
      window.calls.length = 0;
    });
    // O bloco do transporte fica recolhido na fixture: o clique do próprio botão executa o onclick real.
    await page.locator('#btnGerarTransp1').evaluate((botao) => botao.click());
    assert.deepEqual(await rpcs(page), ['atualizarAgendaEventoCompleto']);
    assert.equal(await page.evaluate(() => window.calls[0].args[0].transporteDocumentosSlot), '1');
    // Nada muda antes de o salvamento responder.
    assert.equal(await page.locator('#agendaCreatePanel').evaluate((p) => p.classList.contains('open')), true);
    await responder(page, 'atualizarAgendaEventoCompleto', { recordVersion: 'v2', editRecordVersion: 'e2' });
    assert.equal(await page.locator('#agendaCreatePanel').evaluate((p) => p.classList.contains('open')), false, 'o modal fecha');
    assert.equal(await page.evaluate(() => window.getCurrentPage()), 'transporte-central');
    const envio = await page.evaluate(() => window.calls.find((c) => c.method === 'getTransporteEnvio'));
    assert.deepEqual(envio.args, ['A', '1']);
    assert.ok(!(await rpcs(page)).includes('getTransporteTarefas'), 'vai direto ao envio, sem a lista');
    await responder(page, 'getTransporteEnvio', ENVIO);
    assert.equal(await page.locator('#tcWizard').isVisible(), true);
    assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 1 de 3 · Conferir/);
    assert.match(await page.evaluate(() => window.notifications.join('|')), /mudaram na Agenda/);
  });
});

test('cartão da Agenda: transporte já agendado abre o envio; perfil sem permissão volta à lista', async () => {
  await cenario(async (page) => {
    await page.evaluate(() => {
      document.getElementById('agendaCreatePanel').classList.remove('open');
      window._agendaEditRecord = null;
      window._agendaEventosPorId = { B: { id: 'B', courier1: { nome: 'MARKEN', awb: '123456789012', status: 'Agendado', temperatura: 'Congelado' } } };
      const alvo = document.createElement('div');
      alvo.id = 'cartaoTeste';
      alvo.innerHTML = window.agendaCourierCard(window._agendaEventosPorId.B.courier1, 'I', false, 'B', '1');
      document.getElementById('page-agenda').appendChild(alvo);
      window.calls.length = 0;
    });
    await page.locator('#cartaoTeste .ag-c-doc-btn').click();
    assert.equal(await page.evaluate(() => window.getCurrentPage()), 'transporte-central');
    assert.deepEqual(await page.evaluate(() => window.calls.map((c) => [c.method, c.args])), [['getTransporteEnvio', ['B', '1']]]);
    // Perfil só leitura: o servidor recusa; a tela fecha o passo a passo e mostra a lista.
    await page.evaluate(() => window.calls.splice(0, 1)[0].failure(new Error('Seu perfil é somente leitura. Esta ação do Transporte não está autorizada.')));
    assert.equal(await page.locator('#tcWizard').isVisible(), false);
    assert.equal(await page.locator('#tcTabs').isVisible(), true);
    assert.deepEqual(await rpcs(page), ['getTransporteTarefas'], 'a lista é lida');
    assert.match(await page.evaluate(() => window.notifications.join('|')), /somente leitura/);
  });
});

test('cartão sem AWB: avisa e fica na Agenda', async () => {
  await cenario(async (page) => {
    await page.evaluate(() => {
      document.getElementById('agendaCreatePanel').classList.remove('open');
      window._agendaEditRecord = null;
      window._agendaEventosPorId = { C: { id: 'C', courier1: { nome: 'MARKEN', awb: '' } } };
      const alvo = document.createElement('div');
      alvo.id = 'cartaoTeste';
      alvo.innerHTML = window.agendaCourierCard({ nome: 'MARKEN', awb: '', status: 'Não agendado' }, 'I', false, 'C', '1');
      document.getElementById('page-agenda').appendChild(alvo);
      window.calls.length = 0;
    });
    await page.locator('#cartaoTeste .ag-c-doc-btn').click();
    assert.equal(await page.evaluate(() => window.getCurrentPage()), 'agenda');
    assert.deepEqual(await rpcs(page), []);
    assert.match(await page.evaluate(() => window.notifications.join('|')), /AWB/);
  });
});
