'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createAgendaRulesCore } = require('./agenda-rules-core');

const START = '  // BEGIN GENERATED AGENDA RULES';
const END = '  // END GENERATED AGENDA RULES';
const TARGETS = ['AgendaServerRules.gs', 'SharedAgendaRules.html'];

function generatedBlock() {
  const source = createAgendaRulesCore.toString().replace(/\r\n/g, '\n');
  const body = source.slice(source.indexOf('{') + 1, source.lastIndexOf('  return Object.freeze({')).trimEnd();
  return START + ' — editar tools/agenda-rules-core.js\n' + body + '\n' + END;
}

function renderTarget(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start || source.indexOf(START, start + START.length) > -1 || source.indexOf(END, end + END.length) > -1) {
    throw new Error('Bloco gerado ausente ou duplicado');
  }
  const newline = source.slice(start, source.indexOf('\n', start) + 1).endsWith('\r\n') ? '\r\n' : '\n';
  const block = generatedBlock().replace(/\n/g, newline);
  return source.slice(0, start) + block + source.slice(end + END.length);
}

function generate(root, checkOnly) {
  // Validar todos os alvos antes de escrever; nunca sobrescrever conteudo fora do bloco.
  const outputs = TARGETS.map((name) => {
    const filename = path.join(root, name);
    const source = fs.readFileSync(filename, 'utf8');
    return { filename, source, rendered: renderTarget(source) };
  });
  const stale = outputs.filter((output) => output.source !== output.rendered);
  if (checkOnly && stale.length) throw new Error('Regras geradas divergentes: execute npm run rules:generate');
  if (!checkOnly) stale.forEach((output) => fs.writeFileSync(output.filename, output.rendered, 'utf8'));
  return stale.length;
}

if (require.main === module) {
  try {
    generate(path.resolve(__dirname, '..'), process.argv.includes('--check'));
    console.log('Regras compartilhadas da Agenda alinhadas.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { generatedBlock, renderTarget, generate, TARGETS };
