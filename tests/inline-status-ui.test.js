'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile } = require('./helpers/load-app-script');

test('mensagens inline de erro e validacao compartilham o mesmo componente visual', () => {
  const styles = readProjectFile('IndexStyles.html');
  const core = readProjectFile('IndexCoreScripts.html');
  const agenda = readProjectFile('IndexAgendaScripts.html');

  assert.match(styles, /\.app-inline-notice--danger\s*\{/);
  assert.match(styles, /\.app-inline-notice--warning\s*\{/);
  assert.match(styles, /\.status-msg > span\[style\*="#e53935"\]/);
  assert.match(core, /function appSetInlineStatusMessage\(elOrId, msg, type, color\)/);
  assert.match(core, /function appSetStatus\(elOrId, msg, color\)\s*\{[\s\S]*?appSetInlineStatusMessage\(elOrId, msg, type, color\)/);
  assert.match(core, /function setRequisicaoStatus\(msg, type\)\s*\{[\s\S]*?appSetInlineStatusMessage\(statusEl, msg, type\)/);
  assert.match(agenda, /function setAgendaStatus\(msg, type\)\s*\{[\s\S]*?appSetInlineStatusMessage\(el, msg, type\)/);
});
