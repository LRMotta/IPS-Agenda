'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');
const vm = require('node:vm');
const { contentAccessibilitySource } = require('./helpers/content-accessibility-source');
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

test('rotas do menu têm vínculo explícito e perfil usa botão nativo', () => {
  const html = readProjectFile('IndexContent.html');
  for (const tag of html.match(/<button[^>]*onclick="irPara\('[^>]+/g)) {
    const route = tag.match(/irPara\('([^']+)'/)[1];
    assert.ok(tag.includes('data-page="' + route + '"'), route);
  }
  assert.match(html, /<button type="button" class="user-chip" id="userProfileChip"/);
  assert.doesNotMatch(html, /onkeydown="userProfileChipKeydown/);
  assert.match(readProjectFile('Index.html'), /<html lang="pt-BR">/);
  assert.match(html, /<table[^>]*aria-label="Médicos cadastrados"/);
  assert.equal((html.match(/<th scope="col"/g) || []).length, 6);
});

test('falha de médicos encerra loading e permite nova consulta forçada', () => {
  const elements = {};
  const calls = [];
  const context = vm.createContext({
    document: { getElementById(id) { return elements[id] ||= { setAttribute(k, v) { this[k] = v; } }; } },
    getCadastrosBootstrapCached(...args) { calls.push(args); },
    snackErro() {},
    sortCadastroByField(list) { return list; },
    filtrarMedicos() {},
  });
  vm.runInContext(contentAccessibilitySource(['carregarMedicos', 'renderMedicos']), context);
  context.carregarMedicos(false);
  assert.equal(elements.tableMedicos['aria-busy'], 'true');
  calls[0][2](new Error('offline'));
  assert.equal(elements.tableMedicos['aria-busy'], 'false');
  assert.doesNotMatch(elements.bodyMedicos.innerHTML, /Carregando/);
  assert.match(elements.medicosStatus.textContent, /Não foi possível/);
  elements.btnMedicosRetry.onclick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][3], true);
  calls[1][1]({ data: [{ nome: 'Ana', especialidade: 'Clínica' }], config: {} });
  assert.equal(elements.medTotal.textContent, 1);
});
