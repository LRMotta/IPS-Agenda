'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');
test('shell identifica navegação, conteúdo, busca e ícones sem depender do mouse', () => {
  const html = readProjectFile('IndexContent.html');
  assert.doesNotMatch(html, /<div[^>]*class="nav-(?:item|group-toggle)/);
  assert.ok((html.match(/<button type="button" class="nav-item/g) || []).length > 20);
  for (const group of ['Cadastros', 'Estoque']) {
    assert.ok(html.includes('aria-controls="nav' + group + 'Body" aria-expanded="false"'));
  }
  assert.ok(html.includes('role="main" aria-labelledby="topTitle"'));
  assert.ok(html.includes('<h1 class="page-title">'));
  assert.ok(html.includes('id="searchMedicos" aria-label="Buscar médicos"'));
  for (const icon of html.match(/<span class="material-symbols-outlined[^>]*>/g)) assert.ok(icon.includes('aria-hidden="true"'));
  assert.ok(html.includes('stats-row content-stats-row content-stats-cols-2'));
});
