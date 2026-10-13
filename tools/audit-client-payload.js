'use strict';

// Inventário estático: não faz chamadas externas nem estima latência do navegador.
const fs = require('node:fs');
const path = require('node:path');
const { findScriptBlocks } = require('./validate-syntax');

function auditRoute(root, flags) {
  const includes = [];
  let enabled = true;
  for (const line of fs.readFileSync(path.join(root, 'Index.html'), 'utf8').split(/\r?\n/)) {
    const condition = /<\? if \((includeDashboard|includeEstoque)\) \{ \?>/.exec(line);
    if (condition) enabled = !!flags[condition[1]];
    if (line.includes('<? } ?>')) enabled = true;
    const include = /include\('([^']+)'\)/.exec(line);
    if (!include || !enabled) continue;
    const source = fs.readFileSync(path.join(root, include[1] + '.html'), 'utf8');
    const scripts = findScriptBlocks(source);
    includes.push({ file: include[1] + '.html', sourceBytes: Buffer.byteLength(source),
      inlineJsBytes: scripts.reduce((total, block) => total + Buffer.byteLength(block.code), 0) });
  }
  return { includes, sourceBytes: includes.reduce((total, item) => total + item.sourceBytes, 0),
    inlineJsBytes: includes.reduce((total, item) => total + item.inlineJsBytes, 0) };
}

function main() {
  const root = path.resolve(__dirname, '..');
  console.log(JSON.stringify({
    scope: 'Includes estáticos locais; sem HTML gerado, CDN, compressão ou medição de latência.',
    agenda: auditRoute(root, { includeEstoque: false, includeDashboard: false }),
    dashboard: auditRoute(root, { includeEstoque: false, includeDashboard: true }),
    estoque: auditRoute(root, { includeEstoque: true, includeDashboard: false })
  }, null, 2));
}

module.exports = { auditRoute };
if (require.main === module) main();
