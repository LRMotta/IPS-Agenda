'use strict';

const path = require('node:path');
const os = require('node:os');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    'playwright',
    path.join(os.homedir(), 'Documents', 'IPS-Testes-Playwright', 'node_modules', 'playwright'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    let resolved;
    try { resolved = require.resolve(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
      continue;
    }
    return require(resolved);
  }
  throw new Error('Playwright indisponivel. Instale playwright no projeto de testes ou defina PLAYWRIGHT_MODULE_PATH. Consulte PLAYWRIGHT.md.');
}

module.exports = { loadPlaywright };
