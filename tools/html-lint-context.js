'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');
const { findScriptBlocks, hasHtmlAttribute, maskPreservingLineBreaks, removeAppsScriptTemplates } = require('./validate-syntax');

// Preserve original line numbers; templates are checked separately by syntax.
function htmlScriptSource(source) {
  let result = '';
  let cursor = 0;
  for (const block of findScriptBlocks(source)) {
    result += maskPreservingLineBreaks(source.slice(cursor, block.index));
    const start = block.codeIndex - block.index;
    if (hasHtmlAttribute(block.attrs, 'src')) result += maskPreservingLineBreaks(block.raw);
    else {
      result += maskPreservingLineBreaks(block.raw.slice(0, start));
      result += block.code.replace(/<\?(?:!=|=)?[\s\S]*?\?>/g, (template) => {
        const masked = maskPreservingLineBreaks(template);
        const firstLineLength = masked.split(/\r?\n/)[0].length;
        return 'null' + masked.slice(Math.min(4, firstLineLength));
      });
      result += maskPreservingLineBreaks(block.raw.slice(start + block.code.length));
    }
    cursor = block.end;
  }
  return result + maskPreservingLineBreaks(source.slice(cursor));
}

function collectBrowserGlobals(projectRoot) {
  const result = { google: 'readonly' };
  const linter = new Linter();
  for (const filename of fs.readdirSync(projectRoot).filter((name) => name.endsWith('.html'))) {
    const source = htmlScriptSource(fs.readFileSync(path.join(projectRoot, filename), 'utf8'));
    const messages = linter.verify(removeAppsScriptTemplates(source), [{ languageOptions: { sourceType: 'script' } }]);
    if (messages.some((message) => message.fatal)) throw new Error(`Nao foi possivel analisar os globais de ${filename}`);
    const code = linter.getSourceCode();
    for (const variable of code.scopeManager.globalScope.variables) {
      if (variable.defs.length) result[variable.name] = 'writable';
    }
    // IIFEs expose shared contracts through window (e.g. AgendaRules).
    function visit(node, aliases = new Set(['window', 'globalThis'])) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee.type === 'FunctionExpression') {
        const localAliases = new Set(aliases);
        node.arguments.forEach((argument, index) => {
          if (argument.type === 'Identifier' && aliases.has(argument.name) && node.callee.params[index]?.type === 'Identifier') {
            localAliases.add(node.callee.params[index].name);
          }
        });
        visit(node.callee, localAliases);
        node.arguments.forEach((argument) => visit(argument, aliases));
        return;
      }
      if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
          node.left.object.type === 'Identifier' && aliases.has(node.left.object.name)) {
        const name = node.left.computed ? node.left.property.value : node.left.property.name;
        if (typeof name === 'string') result[name] = 'writable';
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;
        if (Array.isArray(value)) value.forEach((child) => visit(child, aliases));
        else if (value && typeof value === 'object') visit(value, aliases);
      }
    }
    visit(code.ast);
  }
  return result;
}

module.exports = { htmlScriptSource, collectBrowserGlobals };
