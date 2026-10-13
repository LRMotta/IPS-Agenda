'use strict';

const crypto = require('node:crypto');
const { runFiles, readProjectFile } = require('./load-app-script');
const { FakeSpreadsheet } = require('./fake-spreadsheet');

function planningIntegration() {
  const spreadsheet = new FakeSpreadsheet();
  const server = runFiles(['WebApp.gs', 'SoAPlanning.gs'], {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => Array.from(crypto.createHash('sha256').update(value).digest()),
      getUuid: () => crypto.randomUUID()
    }
  });
  server.codexAssertCanRead_ = () => ({ role: 'admin' });
  server.codexAssertCanWrite_ = () => ({ role: 'admin' });
  server.codexWithDocumentLock_ = (_, callback) => callback();
  server.getCodexSheetDataByName_ = () => [['ID', 'Nome', 'Código'], ['P1', 'Estudo local', 'EXEMPLO-NAO-CLINICO'], ['P2', 'BGB-43395-302', 'BGB-43395-302']];
  const canonical = JSON.parse(readProjectFile('docs/examples/planejamento-modelo-1.0.0.json'));
  const poc = JSON.parse(readProjectFile('docs/examples/planejamento-bgb-43395-302-poc.json'));
  return { server, spreadsheet, canonical, poc };
}

module.exports = { planningIntegration };
