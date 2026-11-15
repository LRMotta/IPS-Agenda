'use strict';
/* global window */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('../helpers/load-app-script');
const { loadPlaywright } = require('../helpers/playwright-runtime');

// Playwright local com RPCs simuladas e rede bloqueada: exercita somente a
// partida do app (startCodexAppOnce) com e sem o bootstrap embutido pelo doGet.
async function openStartupPage(browser, inlineBootstrap) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await page.route('**/*', request => request.abort());
  await page.setContent('<!doctype html><html><head><title>Teste local — bootstrap embutido</title></head>' +
    '<body><span id="topDate"></span></body></html>');
  await page.evaluate(() => {
    window.INDEX_INITIAL_PAGE = 'agenda';
    window.INDEX_INITIAL_AGENDA_CANARY_SHELL = true;
    window.APP_USER_NAVIGATED = false;
    window.calls = [];
    window.requests = [];
    window.isEmbeddedModuleEnabled = () => false;
    window.getCurrentPage = () => '';
    window.codexClientNow_ = () => 0;
    window.codexClientBootstrapTraceId_ = () => 'inline-startup';
    window.codexClientBootstrapPayloadBytes_ = () => 0;
    window.codexLogClientBootstrapPerformance_ = metrics => window.calls.push(['perf', metrics.success, metrics.rpcDurationMs]);
    window.applyAppBootstrapData = data => {
      window.APP_BOOTSTRAP_DATA = data || {};
      window.calls.push(['apply', window.APP_BOOTSTRAP_PENDING, !!(data && data.agendaBootstrap)]);
    };
    window.handleAppBootstrapFailure = () => window.calls.push(['failure']);
    window.irPara = (pagina, options) => window.calls.push(['irPara', pagina, !!(options && options.shellOnly)]);
    window.agendaRegistrarShellVisivel_ = () => {};
    function runner(success, failure) {
      const rpc = { withSuccessHandler: fn => runner(fn, failure), withFailureHandler: fn => runner(success, fn) };
      rpc.getAppBootstrapData = request => window.requests.push({ request, success, failure });
      return rpc;
    }
    window.google = { script: { run: runner() } };
  });
  const core = readProjectFile('IndexCoreScripts.html');
  await page.addScriptTag({
    content: core.slice(core.indexOf('function startCodexAppOnce('), core.indexOf('function navegarParaRotaWebApp('))
  });
  await page.evaluate(inline => {
    const request = window.appInitialBootstrapRequest_();
    window.expectedRange = request.agendaRange;
    if (inline === 'matching' || inline === 'other-range') {
      const range = inline === 'matching' ? request.agendaRange : { start: '2000-01-03', endExclusive: '2000-01-24' };
      window.INDEX_INLINE_BOOTSTRAP = {
        bootstrapTraceId: 'inline-trace-0001',
        access: { ok: true },
        agendaBootstrap: { complete: true, events: [], range: { start: range.start, endExclusive: range.endExclusive } }
      };
    } else {
      window.INDEX_INLINE_BOOTSTRAP = null;
    }
    window.startCodexAppOnce();
    // Estado logo após a partida síncrona, antes de qualquer tarefa pendente.
    window.syncState = { calls: window.calls.slice(), pending: window.APP_BOOTSTRAP_PENDING, requests: window.requests.length };
  }, inlineBootstrap);
  return { page, errors };
}

test('partida da Agenda aplica o bootstrap embutido sem RPC e recorre a RPC nos demais casos', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    // Bootstrap embutido com o mesmo período: nenhuma RPC inicial.
    const warm = await openStartupPage(browser, 'matching');
    const warmSync = await warm.page.evaluate(() => window.syncState);
    // O shell aparece na hora; os dados são aplicados fora do evento de carga,
    // e um clique nesse intervalo ainda encontra a carga inicial em curso.
    assert.deepEqual(warmSync.calls, [['irPara', 'agenda', true]]);
    assert.equal(warmSync.pending, true);
    assert.equal(warmSync.requests, 0);
    await warm.page.waitForFunction(() => window.calls.some(call => call[0] === 'perf'));
    assert.deepEqual(await warm.page.evaluate(() => window.calls), [
      ['irPara', 'agenda', true],
      ['apply', false, true],
      ['irPara', 'agenda', false],
      ['perf', true, 0]
    ]);
    assert.equal(await warm.page.evaluate(() => window.requests.length), 0);
    assert.equal(await warm.page.evaluate(() => window.APP_BOOTSTRAP_PENDING), false);
    assert.equal(await warm.page.evaluate(() => window.INDEX_INLINE_BOOTSTRAP), null);
    assert.equal(await warm.page.evaluate(() => window.APP_BOOTSTRAP_DATA.bootstrapTraceId), 'inline-trace-0001');
    assert.deepEqual(warm.errors, []);
    await warm.page.close();

    // Sem dados embutidos, ou com período diferente do pedido por este
    // navegador, a abertura continua pela RPC com o período do cliente.
    for (const variant of ['none', 'other-range']) {
      const cold = await openStartupPage(browser, variant);
      const coldSync = await cold.page.evaluate(() => window.syncState);
      assert.deepEqual(coldSync.calls, [['irPara', 'agenda', true]], variant);
      assert.equal(coldSync.pending, true, variant);
      assert.equal(coldSync.requests, 1, variant);
      assert.deepEqual(
        await cold.page.evaluate(() => window.requests[0].request.agendaRange),
        await cold.page.evaluate(() => window.expectedRange), variant);
      await cold.page.evaluate(() => window.requests[0].success({ access: { ok: true }, agendaBootstrap: { marker: true } }));
      assert.deepEqual(await cold.page.evaluate(() => window.calls.slice(1)), [
        ['apply', false, true],
        ['irPara', 'agenda', false],
        ['perf', true, 0]
      ], variant);
      assert.equal(await cold.page.evaluate(() => window.requests.length), 1, variant);
      assert.deepEqual(cold.errors, [], variant);
      await cold.page.close();
    }
  } finally { await browser.close(); }
});
