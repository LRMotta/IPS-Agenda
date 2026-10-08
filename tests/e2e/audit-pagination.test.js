'use strict';
/* global window, document, AUDIT_PAGE_META, AUDIT_PAGE_OFFSET, AUDIT_VIEW */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { contentAccessibilitySource } = require('../helpers/content-accessibility-source');

const source = contentAccessibilitySource([
  'carregarAuditLogPaginado', 'auditFilterKeydown', 'auditFilters', 'auditFilterSignature', 'auditCacheKey',
  'setAuditRows', 'auditRowsForView', 'carregarAuditPage', 'auditResetQuery_', 'auditPageMeta_',
  'prefetchAuditNextPage', 'renderAuditLog', 'renderAuditPager', 'updateAuditTabAccessibility',
  'auditNextPage', 'auditPrevPage'
]);

for (const width of [1280, 390]) {
  test('auditoria paginada: recorte, prefetch, filtros e expiração no DOM em ' + width + 'px', async () => {
    // Runner oficial local: RPCs simuladas e todas as requisições de rede bloqueadas.
    const browser = await loadPlaywright().chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      await page.route('**/*', route => route.abort());
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<!doctype html><html><head>' + readProjectFile('IndexStyles.html') +
        readProjectFile('IndexStylesAfterDashboard.html') + '</head><body>' +
        readProjectFile('IndexContentAfterDashboard.html') + '</body></html>');
      await page.addScriptTag({ content: `
        var AUDIT_VIEW='log', AUDIT_PAGE_SIZE=100, AUDIT_PAGE_REQUEST_ID=0, AUDIT_FILTER_SIGNATURE='';
        var AUDIT_PAGE_OFFSET={log:0,changes:0}, AUDIT_PAGE_CACHE={log:{},changes:{}}, AUDIT_PAGE_META={log:{},changes:{}};
        var AUDIT_PREFETCHING={}, AUDIT_LOG_ROWS=[], AUDIT_CHANGES_ROWS=[];
        window.auditRequests=[]; window.auditNotices=[];
        function norm(v){return String(v||'').toLowerCase();}
        function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
        function appErrorMessage(e){return e.message;}
        function snack(msg){window.auditNotices.push(msg);}
        function appTableSkeletonRow(){return '<tr><td>Carregando</td></tr>';}
        function codexRunSearchFilter(id,scope,fn){fn();}
        function carregarAuditLog(){carregarAuditLogPaginado();}
        var google={script:{run:{withSuccessHandler(ok){return {withFailureHandler(fail){return {
          getAuditPage(type,limit,offset,filters,query){window.auditRequests.push({ok,fail,type,limit,offset,filters,query});}
        }}}}}}};
      ` + source });
      await page.evaluate(() => {
        document.getElementById('page-audit-log').classList.add('active');
        window.carregarAuditLogPaginado();
        const rows = Array.from({ length: 100 }, (_, i) => ({ id: 'ID-' + i, email: 'simulado@example.invalid', action: 'Salvar', module: 'Agenda' }));
        window.auditRequests[0].ok({ rows, total: 250, hasMore: true, limit: 100, snapshotId: 'query-1', expiresAt: Date.now() + 300000 });
      });
      assert.match(await page.locator('#auditPager').innerText(), /1-100 de 250/);
      await page.locator('#auditPager button').nth(1).click();
      assert.equal(await page.evaluate(() => window.auditRequests.length), 2);
      assert.equal(await page.evaluate(() => window.auditRequests[1].query.snapshotId), 'query-1');
      await page.evaluate(() => window.auditRequests[1].ok({
        rows: Array.from({ length: 100 }, (_, i) => ({ id: 'ID-' + (100 + i), action: 'Salvar' })),
        total: 250, offset: 100, limit: 100, hasMore: true, snapshotId: 'query-1', expiresAt: Date.now() + 300000
      }));
      assert.match(await page.locator('#auditPager').innerText(), /101-200 de 250/);
      await page.locator('#auditPager button').nth(0).click();
      assert.match(await page.locator('#auditPager').innerText(), /1-100 de 250/);
      assert.equal(await page.evaluate(() => window.auditRequests.length), 3);
      await page.evaluate(() => { AUDIT_PAGE_META.log.expiresAt = Date.now() - 1; });
      await page.locator('#auditPager button').nth(1).click();
      assert.equal(await page.evaluate(() => window.auditRequests[3].offset), 0);
      assert.equal(await page.evaluate(() => window.auditRequests[3].query.snapshotId), '');
      await page.evaluate(() => {
        window.auditRequests[3].ok({ rows: [{ id: 'NEW' }], total: 1, snapshotId: 'query-2', expiresAt: Date.now() + 300000 });
        window.auditRequests[2].ok({ rows: [{ id: 'STALE' }], offset: 200, total: 250, snapshotId: 'query-1' });
      });
      assert.match(await page.locator('#bodyAuditLog').innerText(), /NEW/);
      assert.doesNotMatch(await page.locator('#bodyAuditLog').innerText(), /STALE/);
      assert.equal(await page.evaluate(() => window.auditNotices.length), 1);
      await page.locator('#auditFilterUser').fill('Outra pessoa');
      await page.locator('#auditFilterUser').press('Tab');
      assert.equal(await page.evaluate(() => window.auditRequests[4].filters.user), 'Outra pessoa');
      assert.equal(await page.evaluate(() => window.auditRequests[4].query.snapshotId), '');
      await page.evaluate(() => window.auditRequests[4].ok({ rows: [], total: 0, snapshotId: 'query-3' }));
      assert.match(await page.locator('#bodyAuditLog').innerText(), /Nenhum registro/);
      assert.equal(await page.evaluate(() => AUDIT_PAGE_OFFSET[AUDIT_VIEW]), 0);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
