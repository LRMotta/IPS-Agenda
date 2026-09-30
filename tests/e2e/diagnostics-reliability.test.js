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

const functions = contentAccessibilitySource(['carregarDiagnosticoImplantacao', 'diagSnapshotFresh', 'diagBeginRequest',
  'diagApplyResult', 'diagRenderFreshness', 'diagClientContext', 'diagSetText', 'diagDl', 'diagStatusIcon',
  'diagCheckItem', 'renderDiagnosticoImplantacao', 'renderSmokeChecklist', 'copiarDiagnosticoImplantacao']);
const content = readProjectFile('IndexContentAfterDashboard.html');
const diagnosticPage = content.slice(content.indexOf('    <!-- ═══ DIAGNÓSTICO'), content.indexOf('    <!-- ═══ PRESTADORES'));

for (const width of [1280, 390]) {
  test('diagnostico local: atualizacao, divergencia, copia, expiracao e erros em ' + width + 'px', async () => {
    // Browser plugin not available. Playwright com DOM real, rede e RPCs isoladas.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
      await page.clock.install({ time: new Date('2026-09-30T22:00:00Z') });
      await page.setContent('<!doctype html><html lang="pt-BR"><head><title>IPS — diagnóstico local</title>' +
        readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') +
        '<style>#page-diagnostico{display:block}body{padding:16px}</style></head><body>' + diagnosticPage + '</body></html>');
      await page.addScriptTag({ content: `
        var APP_DEPLOYMENT_DIAGNOSTICS = null, APP_DIAGNOSTICS_REQUEST_ID = 0, APP_DIAGNOSTICS_IN_FLIGHT = false;
        var APP_DIAGNOSTICS_CLEARING = false, APP_DIAGNOSTICS_RECEIVED_AT = 0, APP_DIAGNOSTICS_EXPIRY_TIMER = null;
        var APP_DIAGNOSTICS_TTL_MS = 300000, APP_LOADED_VERSION = 'v-local', APP_VERSION_CHECK_TIMER = 1, APP_VERSION_NOTICE_VISIBLE = false;
        window.requests = []; window.notifications = [];
        function snack(text) { window.notifications.push(text); } function snackErro(text) { window.notifications.push(text); }
        function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) { return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]; }); }
        function runner(success, failure) { return {
          withSuccessHandler: function(callback) { return runner(callback, failure); },
          withFailureHandler: function(callback) { return runner(success, callback); },
          getCodexDeploymentDiagnostics: function() { window.requests.push({success:success, failure:failure}); }
        }; }
        var google = {script:{run:runner()}};
        ${functions}
      ` });
      const data = {
        appVersion: { version: 'v-local' }, checkedAt: '2026-09-30 19:00:00',
        coverage: 'Leitura administrativa. Não valida saldos, reservas ou conciliação SoA.',
        auth: { ok: true }, spreadsheet: { ok: true },
        operational: { overall: { status: 'Atencao', errors: 0, warnings: 1, unverified: 1, checks: [
          { label: 'Referências divergentes', ok: false, severity: 'warning', detail: 'linha 794: ID cadastro CAD-1 | Agenda SUNSCAPE-1, cadastro TOPAZ-UC | Próximo passo: revisar o protocolo original.' },
          { label: 'Confirmação da última entrega', ok: null, severity: 'unverified', detail: 'Confira código remoto, implantação e /exec.' }
        ] }, versionSync: { loadedVersion: 'v-local', publishedVersion: 'v-local', status: 'Sincronizada' },
        integrity: { items: [{ label: 'Referências divergentes', ok: false, detail: 'linha 794: CAD-1' }] } },
        automationRuns: { items: [{ label: 'Lembretes de courier', status: 'Nunca registrado', ok: false }] }
      };
      assert.equal(page.url(), 'about:blank');
      assert.equal(await page.title(), 'IPS — diagnóstico local');
      assert.ok((await page.locator('body').innerText()).includes('Saúde das verificações'));
      assert.equal(await page.locator('nextjs-portal, vite-error-overlay').count(), 0);
      await page.getByRole('button', { name: 'Atualizar diagnóstico' }).click();
      await page.evaluate(value => window.requests[0].success(value), data);
      assert.equal(await page.locator('#diagOverall').innerText(), 'Atencao');
      assert.match(await page.locator('#diagHealthSummary').innerText(), /linha 794/);
      assert.equal(await page.locator('#diagHealthSummary .material-symbols-outlined').last().innerText(), 'help');
      assert.equal(await page.locator('#diagAutomationRuns .material-symbols-outlined').innerText(), 'help');
      assert.match(await page.locator('#diagVersionSync').innerText(), /Não verificado nesta página/);
      let copied;
      page.on('dialog', async dialog => { copied = dialog.defaultValue(); await dialog.dismiss(); });
      await page.getByRole('button', { name: 'Copiar resumo' }).click();
      assert.match(copied, /linha 794/);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({ path: path.join(artifacts, 'diagnostics-' + width + '.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await page.clock.fastForward(300000);
      assert.equal(await page.locator('#diagOverall').innerText(), 'Não verificado');
      assert.match(await page.locator('#diagFreshness').innerText(), /vencida/);
      assert.equal(await page.evaluate(() => window.requests.length), 1);
      await page.getByRole('button', { name: 'Atualizar diagnóstico' }).click();
      await page.evaluate(() => window.requests[1].failure({ message: 'Falha simulada' }));
      assert.match(await page.locator('#diagEnvironment').innerText(), /Falha simulada/);
      assert.equal(await page.locator('#diagOverall').innerText(), 'Não verificado');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
