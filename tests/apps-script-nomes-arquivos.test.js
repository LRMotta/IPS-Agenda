'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectRoot } = require('./helpers/load-app-script');

// O Apps Script identifica cada arquivo pelo nome sem extensao: um .gs e um .html com o mesmo
// nome base fazem o clasp push falhar ("A file with this name already exists in the current
// project"), depois que o PR ja foi integrado.
test('arquivos enviados ao Apps Script nao repetem o nome base entre .gs e .html', () => {
  const nomes = fs.readdirSync(projectRoot).filter((f) => /\.(gs|html)$/.test(f));
  const vistos = {};
  const repetidos = [];
  for (const arquivo of nomes) {
    const base = path.basename(arquivo, path.extname(arquivo)).toLowerCase();
    if (vistos[base]) repetidos.push(vistos[base] + ' / ' + arquivo);
    else vistos[base] = arquivo;
  }
  assert.deepEqual(repetidos, []);
  assert.ok(nomes.includes('TransporteLayoutsModelo.gs') && nomes.includes('TransporteLayoutsDados.html'));
});
