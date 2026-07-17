'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

test('parametros da URL usam JSON seguro e escape contextual no script inicial', () => {
  const server = runFile('WebApp.gs');
  const payload = '</script><script>alert(1)</script>&\u2028\u2029';
  const serialized = server.codexJsonForScript_(payload);

  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.equal(JSON.parse(serialized), payload);
  assert.equal(server.codexJsonForScript_(undefined), 'null');

  const index = readProjectFile('Index.html');
  assert.doesNotMatch(index, /<\?!=\s*(?:JSON\.stringify|codexJsonForScript_)/);
  assert.match(index, /JSON\.parse\(<\?=\s*codexJsonForScript_\(paginaInicial/);
  assert.match(index, /JSON\.parse\(<\?=\s*codexJsonForScript_\(agendaAbrirInicial/);
  assert.match(index, /JSON\.parse\(<\?=\s*codexJsonForScript_\(Boolean\(includeEstoque\)/);
});

test('HTML de courier preserva somente tags permitidas sem atributos', () => {
  const server = runFile('WebApp.gs');
  const dirty = '<p class="x" onclick="alert(1)">Texto <strong style="color:red">forte</strong>' +
    '<img src=x onerror=alert(2)><script>alert(3)</script><br data-x="1"><a href="javascript:alert(4)">link</a></p>';
  const clean = server.codexSanitizeCourierHtml_(dirty);

  assert.equal(
    clean,
    '<p>Texto <strong>forte</strong>&lt;img src=x onerror=alert(2)&gt;&lt;script&gt;alert(3)&lt;/script&gt;<br>&lt;a href=&quot;javascript:alert(4)&quot;&gt;link&lt;/a&gt;</p>'
  );
  assert.doesNotMatch(clean, /<(?:img|script|a)\b|<(?:p|strong|br)\b[^>]*\s(?:on|style|class|data-)/i);
});

test('gravacao e leitura de courier aplicam a sanitizacao server-side', () => {
  const source = readProjectFile('WebApp.gs');
  assert.match(source, /conteudoDeclaracao:\s*codexSanitizeCourierHtml_\(r\[10\]\)/);
  assert.match(source, /codexSanitizeCourierHtml_\(dados\.conteudoDeclaracao\)/);

  const client = readProjectFile('IndexCoreScripts.html');
  assert.match(client, /function courierSanitizeHtmlClient\(html\)/);
  assert.match(client, /var sanitized = courierSanitizeHtmlClient\(html\)/);
});
