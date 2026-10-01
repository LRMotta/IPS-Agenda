'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createCourierRulesCore } = require('./courier-rules-core');
const START = '  // BEGIN GENERATED COURIER RULES';
const END = '  // END GENERATED COURIER RULES';
const TARGETS = ['SharedCourierRules.html', 'CourierServerRules.gs'];

function renderTarget(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start || source.indexOf(START, start + START.length) >= 0 || source.indexOf(END, end + END.length) >= 0) throw new Error('Bloco courier ausente ou duplicado');
  const core = createCourierRulesCore.toString().replace(/\r\n/g, '\n');
  const body = core.slice(core.indexOf('{') + 1, core.lastIndexOf('  return { norm')).trimEnd();
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const block = (START + ' — editar tools/courier-rules-core.js\n' + body + '\n' + END).replace(/\n/g, newline);
  return source.slice(0, start) + block + source.slice(end + END.length);
}

function generate(root, checkOnly) {
  const outputs = TARGETS.map(name => {
    const filename = path.join(root, name);
    const source = fs.readFileSync(filename, 'utf8');
    return { filename, source, rendered: renderTarget(source) };
  });
  const stale = outputs.filter(output => output.source !== output.rendered);
  if (checkOnly && stale.length) throw new Error('Regras courier divergentes: execute npm run rules:generate');
  if (!checkOnly) stale.forEach(output => fs.writeFileSync(output.filename, output.rendered, 'utf8'));
  return stale.length;
}

if (require.main === module) {
  try {
    generate(path.resolve(__dirname, '..'), process.argv.includes('--check'));
    console.log('Regras compartilhadas de courier alinhadas.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { renderTarget, generate, TARGETS };
