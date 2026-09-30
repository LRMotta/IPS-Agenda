'use strict';

const { readProjectFile } = require('./load-app-script');

function contentAccessibilitySource(names) {
  const source = readProjectFile('IndexCoreScripts.html');
  return names.map(name => {
    const match = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
    if (!match) throw new Error('Função não encontrada: ' + name);
    return match[0];
  }).join('\n');
}

module.exports = { contentAccessibilitySource };
