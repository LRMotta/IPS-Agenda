'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runHtmlScript } = require('./helpers/load-app-script');

test('perfil altera somente a visibilidade dos modulos administrativos', () => {
  const rules = runHtmlScript('SharedAccessRules.html').CodexAccessRules;
  const operational = ['agenda', 'projetos', 'participantes', 'transporte'];
  const administrative = ['usuarios', 'audit-log', 'diagnostico'];

  operational.forEach((moduleName) => {
    assert.equal(rules.isModuleVisible('admin', moduleName), true);
    assert.equal(rules.isModuleVisible('user', moduleName), true);
    assert.equal(rules.isModuleVisible('readonly', moduleName), true);
  });
  administrative.forEach((moduleName) => {
    assert.equal(rules.isModuleVisible({ role: 'admin' }, moduleName), true);
    assert.equal(rules.isModuleVisible({ role: 'user' }, moduleName), false);
    assert.equal(rules.isModuleVisible({ role: 'readonly' }, moduleName), false);
  });
});
