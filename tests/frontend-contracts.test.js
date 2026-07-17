'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeHtml, removeAppsScriptTemplates } = require('../tools/validate-syntax');
const { projectRoot, readProjectFile } = require('./helpers/load-app-script');

const BUILTIN_CALLS = new Set([
  'Array', 'Boolean', 'Date', 'Number', 'Object', 'Promise', 'RegExp', 'String',
  'alert', 'clearInterval', 'clearTimeout', 'confirm', 'decodeURIComponent',
  'encodeURIComponent', 'function', 'if', 'isFinite', 'isNaN', 'open', 'parseFloat', 'parseInt',
  'requestAnimationFrame', 'setInterval', 'setTimeout'
]);

function htmlSources() {
  return fs.readdirSync(projectRoot)
    .filter((fileName) => fileName.endsWith('.html'))
    .map((fileName) => ({ fileName, source: readProjectFile(fileName) }));
}

function clientFunctionNames(files) {
  const names = new Set();
  files.forEach(({ source }) => {
    const clean = removeAppsScriptTemplates(source);
    for (const match of clean.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(match[1]);
    for (const match of clean.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function\b/g)) names.add(match[1]);
    for (const match of clean.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(match[1]);
  });
  return names;
}

function publicServerFunctionNames() {
  const names = new Set();
  fs.readdirSync(projectRoot).filter((fileName) => fileName.endsWith('.gs')).forEach((fileName) => {
    for (const match of readProjectFile(fileName).matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (!match[1].endsWith('_')) names.add(match[1]);
    }
  });
  return names;
}

function chainMethods(source, startIndex) {
  const methods = [];
  let index = startIndex;
  const skipSpace = () => { while (/\s/.test(source[index] || '')) index += 1; };
  skipSpace();
  while (source[index] === '.') {
    index += 1;
    const nameMatch = source.slice(index).match(/^([A-Za-z_$][\w$]*)/);
    if (!nameMatch) break;
    const name = nameMatch[1];
    index += name.length;
    skipSpace();
    if (source[index] !== '(') break;
    let depth = 0;
    let quote = '';
    for (; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (quote) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '/' && next === '/') {
        index = source.indexOf('\n', index + 2);
        if (index < 0) return methods;
        continue;
      }
      if (char === '/' && next === '*') {
        index = source.indexOf('*/', index + 2);
        if (index < 0) return methods;
        index += 1;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }
    methods.push(name);
    skipSpace();
  }
  return methods;
}

function referencedRpcNames(files) {
  const names = new Set();
  files.forEach(({ source }) => {
    for (const match of source.matchAll(/\bserverCall\s*\(\s*(['"])([A-Za-z_$][\w$]*)\1/g)) names.add(match[2]);
    for (const match of source.matchAll(/\bmethod\s*:\s*(['"])([A-Za-z_$][\w$]*)\1/g)) names.add(match[2]);
    for (const match of source.matchAll(/google\.script\.run/g)) {
      chainMethods(source, match.index + match[0].length).forEach((name) => {
        if (!name.startsWith('with')) names.add(name);
      });
    }
  });
  return names;
}

test('manipuladores inline dos botoes chamam funcoes cliente existentes', () => {
  const files = htmlSources();
  const defined = clientFunctionNames(files);
  const unresolved = [];
  const handlerPattern = /\s(on[a-z][\w:-]*)\s*=\s*(["'])([\s\S]*?)\2/gi;

  files.forEach(({ fileName, source }) => {
    for (const handler of source.matchAll(handlerPattern)) {
      const code = removeAppsScriptTemplates(decodeHtml(handler[3]));
      for (const call of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = call[1];
        if (!BUILTIN_CALLS.has(name) && !defined.has(name)) unresolved.push(`${fileName}:${handler[1]} -> ${name}`);
      }
    }
  });

  assert.deepEqual(unresolved, []);
});

test('RPCs referenciadas pela interface continuam publicas no servidor', () => {
  const rpcNames = referencedRpcNames(htmlSources());
  const publicFunctions = publicServerFunctionNames();
  const missing = Array.from(rpcNames).filter((name) => !publicFunctions.has(name)).sort();
  assert.deepEqual(missing, []);
  assert.ok(rpcNames.size >= 40, `poucas RPCs detectadas: ${rpcNames.size}`);
});

test('nomes privatizados nao permanecem referenciados pela interface', () => {
  const html = htmlSources().map(({ source }) => source).join('\n');
  const internalNames = [
    'performContentDeletion', 'criarRascunhoEmail', 'criarRascunhoTransporte',
    'atualizarAbasDependentesDeclaracao', 'atualizarOcasaProformaTipoAmostra',
    'manageSheetVisibilityUnified', 'aplicarLogicaCancelamento',
    'enviarEmailAgendamento', 'enviarEmailCancelamento', 'enviarEmailReagendamento',
    'gerarHtmlCouriers', 'gerarListaDestinatarios'
  ];

  internalNames.forEach((name) => {
    assert.doesNotMatch(html, new RegExp(`\\b${name}_?\\s*\\(`), name);
  });
});
