'use strict';

// Toda página do app precisa ficar dentro de .content (e, portanto, de .main).
// Uma página incluída depois de "fim .content" vira irmã de .main no layout flex
// do body e aparece ao lado do cabeçalho, como aconteceu com o Transporte (piloto).

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

function includesDoIndex() {
  const index = readProjectFile('Index.html');
  return [...index.matchAll(/include\('([^']+)'\)/g)].map((m) => m[1]);
}

test('todas as páginas incluídas pelo Index ficam dentro de .content', () => {
  const nomes = includesDoIndex();
  let html = '';
  const origem = [];
  nomes.forEach((nome) => {
    const conteudo = readProjectFile(nome + '.html');
    origem.push({ nome, inicio: html.length });
    html += conteudo + '\n';
  });
  const fimContent = html.indexOf('<!-- fim .content -->');
  assert.ok(fimContent > 0, 'marcador "fim .content" não encontrado nos includes do Index');
  const paginas = [...html.matchAll(/<div class="page[^"]*" id="(page-[^"]+)"/g)];
  assert.ok(paginas.some((m) => m[1] === 'page-transporte-central'), 'página do Transporte (piloto) não incluída');
  const fora = paginas.filter((m) => m.index > fimContent).map((m) => {
    const arquivo = origem.filter((o) => o.inicio <= m.index).pop();
    return m[1] + ' (' + (arquivo ? arquivo.nome : '?') + ')';
  });
  assert.deepEqual(fora, [], 'páginas fora de .content: ' + fora.join(', '));
});
