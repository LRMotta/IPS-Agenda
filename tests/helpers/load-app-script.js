'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..');

function readProjectFile(fileName) {
  return fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
}

function runFile(fileName, contextValues) {
  const context = vm.createContext(Object.assign({ console }, contextValues || {}));
  vm.runInContext(readProjectFile(fileName), context, { filename: fileName });
  return context;
}

function runHtmlScript(fileName, contextValues) {
  const source = readProjectFile(fileName)
    .replace(/^\s*<script>\s*/i, '')
    .replace(/\s*<\/script>\s*$/i, '');
  const window = {};
  const context = vm.createContext(Object.assign({ console, window }, contextValues || {}));
  vm.runInContext(source, context, { filename: fileName });
  return context.window;
}

module.exports = { projectRoot, readProjectFile, runFile, runHtmlScript };
