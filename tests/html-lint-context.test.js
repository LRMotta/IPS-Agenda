'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Linter, ESLint } = require('eslint');
const { htmlScriptSource, collectBrowserGlobals } = require('../tools/html-lint-context');

test('extracao de scripts preserva linhas, ignora tags comentadas e scripts externos', () => {
  const source = '<!-- <script>invalid(</script> -->\n<script src="x">invalid(</script>\n<script data-label=">">\nconst value = <?=\njson() ?>;\n</script>';
  const extracted = htmlScriptSource(source);
  assert.equal(extracted.split('\n').length, source.split('\n').length);
  assert.ok(!extracted.includes('invalid(')); assert.ok(extracted.includes('const value'));
  assert.deepEqual(new Linter().verify(extracted, [{ languageOptions: { sourceType: 'script' } }]), []);
});

test('lint conhece contratos globais entre HTMLs e identifica chamada inexistente na Agenda', async () => {
  const root = path.resolve(__dirname, '..');
  const globals = collectBrowserGlobals(root);
  assert.equal(globals.AgendaRules, 'writable'); assert.equal(globals.CodexMatBioTypes, 'writable');
  assert.equal(globals.abrirAgendaEdicaoComRegistro_, 'writable');
  assert.equal(globals.agendaAbrirEdicaoComRegistro_, undefined);
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText('<script>AgendaRules.isType({}); agendaAbrirEdicaoComRegistro_({});</script>', { filePath: 'IndexAgendaScripts.html' });
  assert.equal(result.errorCount, 1); assert.equal(result.messages[0].ruleId, 'no-undef');
  assert.match(result.messages[0].message, /agendaAbrirEdicaoComRegistro_/);
});
