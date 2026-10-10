'use strict';
/* global window, document */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

test('requisição: Agenda e Pendências exibem o lembrete no DOM, troca e limpeza o removem', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const content = readProjectFile('IndexContentAfterDashboard.html');
    const form = content.slice(content.indexOf('<div class="page" id="page-requisicao">'), content.indexOf('<div class="modal-overlay" id="modalReqSuccess"')).replace('class="page"', 'class="page active"');
    const core = contentAccessibilitySource(['atualizarRequisicaoLembreteVisita', 'limparRequisicaoOrigem', 'requisicaoAgendaOrigemIdAtual', 'requisicaoEl', 'rqLookupKey', 'preencherDadosPaciente', 'onRequisicaoRequiredInput', 'limparRequisicaoForm']);
    const agenda = readProjectFile('IndexAgendaScripts.html').match(/  function aplicarAgendaNaRequisicao\([^]*?\n  \}/)[0];
    const pendencias = readProjectFile('IndexPendenciasScripts.html').match(/  function abrirPendenciaAgenda\([^]*?\n  \}/)[0];
    for (const width of [1100, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<html><head><title>Requisição — teste local</title>' + readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + '<style>html,body{height:auto;overflow:auto}body{display:block}.main{height:auto;overflow:visible}.content{overflow:visible;max-width:1050px;margin:auto}</style></head><body><main class="main"><header class="top-bar"><div class="page-title">Requisição de Exames</div></header><div class="content">' + form + '</div></main></body></html>');
      await page.addScriptTag({ content: 'var _rqParticipantesNomes=[], _rqOrigemRequestId=0, _rqOrigemContext=null, _rqAgendaOrigemId="", _agendaEditId="", REQUISICAO_ID_ALIASES={prestador:["rqPrestador"],examesLista:["examList"],solicitanteCard:["solicitanteCard"],status:["statusReq"]}, _rqLookup={participantePorNome:{}};\n' + core + '\n' + agenda + '\n' + pendencias });
      await page.evaluate(() => {
        window.ensureRequisicaoDataLoaded = fn => fn();
        window.preencherSolicitanteUsuarioAtual = window.preencherEnderecoReq = window.updateRequisicaoGenerateAvailability = window.setRequisicaoFieldInvalid = window.clearRequisicaoValidation = window.snack = window.snackErro = window.renderReqAC = window.fecharReqAC = () => {};
        window.adicionarExame = () => {};
        window.irPara = () => window.limparRequisicaoOrigem();
        window.agendaFindEventoLocal_ = () => ({ id: 'A', participante: 'Participante Exemplo', braco: 'Braço A — intervenção', visita: 'V3 — Semana 12' });
        document.addEventListener('input', window.onRequisicaoRequiredInput);
        window.aplicarAgendaNaRequisicao(window.agendaFindEventoLocal_());
      });
      assert.equal(await page.locator('#rqVisitReminder').isVisible(), true);
      assert.equal(await page.locator('#rqReminderVisita').innerText(), 'V3 — Semana 12');
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'req-visit-reminder-' + width + '.png'), fullPage: true });
      await page.locator('#rqPaciente').fill('Outra pessoa');
      assert.equal(await page.locator('#rqVisitReminder').isVisible(), false);
      assert.equal(await page.evaluate(() => window.requisicaoAgendaOrigemIdAtual()), '');
      await page.evaluate(() => window.abrirPendenciaAgenda('A'));
      await page.locator('#rqVisitReminder').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#rqReminderBraco').innerText(), 'Braço A — intervenção');
      await page.evaluate(() => window.limparRequisicaoForm());
      assert.equal(await page.locator('#rqVisitReminder').isVisible(), false);
      assert.equal(await page.locator('#rqPaciente').inputValue(), '');
      await page.evaluate(() => window.aplicarAgendaNaRequisicao({ id: 'B', participante: 'Exemplo sem dados' }));
      assert.equal(await page.locator('#rqReminderBraco').innerText(), 'Não informado');
      assert.equal(await page.locator('#rqReminderVisita').innerText(), 'Não informada');
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('#rqVisitReminder').isVisible(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});


