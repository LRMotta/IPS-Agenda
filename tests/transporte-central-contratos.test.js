'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectRoot, readProjectFile } = require('./helpers/load-app-script');

function funcoesPublicas() {
  const nomes = new Set();
  fs.readdirSync(projectRoot).filter((arquivo) => arquivo.endsWith('.gs')).forEach((arquivo) => {
    for (const m of readProjectFile(arquivo).matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (!m[1].endsWith('_')) nomes.add(m[1]);
    }
  });
  return nomes;
}

test('Transporte (piloto): admin no servidor e no cliente, includes na ordem e prefixos próprios', () => {
  const index = readProjectFile('Index.html');
  const posicao = (nome) => index.indexOf("include('" + nome + "')");
  assert.ok(posicao('IndexTransporteCentralStyles') > posicao('IndexStylesAfterDashboard'));
  // A página precisa entrar antes de IndexContentAfterStock, que fecha .content e .main;
  // depois dele ela aparecia ao lado do cabeçalho (ver tests/index-page-placement.test.js).
  assert.ok(posicao('IndexTransporteCentralContent') > 0);
  assert.ok(posicao('IndexTransporteCentralContent') < posicao('IndexContentAfterStock'));
  assert.ok(posicao('IndexTransporteCentralScripts') > posicao('IndexCoreScripts'));
  assert.equal(index.includes("include('TransporteApp')"), false, 'TransporteApp.html tem globais genéricos');
  assert.ok(posicao('IndexTransporteCentralEnvio') > posicao('IndexTransporteCentralScripts'));
  const publicas = funcoesPublicas();
  for (const rpc of ['getTransporteEnvio', 'salvarTransporteEnvio', 'registrarRespostaPinexEnvio', 'getTransporteAwbUltima',
    'gerarDocumentosTransporteEnvio', 'sairEnvioTransporte', 'concluirEnvioTransporte', 'editarMateriaisTransporteEnvio',
    'renovarPreparoTransporteEnvio']) {
    assert.ok(publicas.has(rpc), rpc);
    assert.ok(readProjectFile('IndexTransporteCentralEnvio.html').includes('.' + rpc + '('), rpc);
  }
  // Toda RPC do passo a passo autoriza no servidor um perfil que edita (admin ou user).
  for (const arquivo of ['TransporteEnvio.gs', 'TransporteEnvioGerar.gs', 'TransporteMateriais.gs', 'TransportePeticionamento.gs', 'TransporteConfirmadas.gs']) {
    const fonte = readProjectFile(arquivo);
    for (const m of fonte.matchAll(/^function ([A-Za-z]\w*)\(([^)]*)\) \{\n([\s\S]*?)\n\}/gm)) {
      if (m[1].endsWith('_')) continue;
      // A lista de peticionamento autoriza, além do perfil, as ações dos autorizados.
      const porLista = ['marcarGruExtratoProntosTransporte', 'getTransportePeticionamentos'].includes(m[1]);
      assert.match(m[3], porLista ? /transportePeticionamentoAssertAutorizado_\(\)/ : /transporteAssertOperador_\(\)/, m[1]);
    }
  }
  const envio = readProjectFile('TransporteEnvio.gs');
  const operador = envio.slice(envio.indexOf('function transporteAssertOperador_('));
  assert.match(operador, /codexAuthorizeWebAppRequest_\(\)[\s\S]*?access\.role !== 'admin' && access\.role !== 'user'/);
  assert.match(readProjectFile('TransportePeticionamento.gs'), /function transportePeticionamentoAssertAutorizado_\(\) \{\n  var acesso = transporteAssertOperador_\(\);/);

  const servidor = readProjectFile('TransporteTarefas.gs');
  const corpo = servidor.slice(servidor.indexOf('function getTransporteTarefas('));
  assert.match(corpo, /^function getTransporteTarefas\(request\) \{\s*var access = codexAssertCanRead_\(\);/);
  assert.ok(funcoesPublicas().has('getTransporteTarefas'));
  assert.ok(readProjectFile('IndexTransporteCentralScripts.html').includes('.getTransporteTarefas('));

  // Estilos da tela nova só com a classe .tc-.
  const estilos = readProjectFile('IndexTransporteCentralStyles.html').replace(/\/\*[\s\S]*?\*\//g, '');
  const seletores = estilos.match(/^[ \t]*[^@{}\s][^{}\n]*\{/gm) || [];
  assert.ok(seletores.length > 10);
  seletores.forEach((seletor) => assert.match(seletor, /\.tc-/, seletor));

  const core = readProjectFile('IndexCoreScripts.html');
  assert.equal(core.includes("isModuleVisible(CURRENT_ACCESS, 'transporte-central')"), false, 'sem trava de admin no cliente');
  assert.ok(core.includes("'transporte-central': { label:'Transporte', icon:'flight_takeoff' }"));
  assert.ok(core.includes("if (pagina === 'transporte-central') carregarTransporteCentral();"));
  const conteudo = readProjectFile('IndexContent.html');
  // Disponível para todos os perfis, com o ícone de avião.
  assert.match(conteudo, /<button type="button" class="nav-item" id="navTransporteCentral" data-page="transporte-central" onclick="irPara\('transporte-central'\)">\s*<span class="nav-icon"><span class="material-symbols-outlined" aria-hidden="true">flight_takeoff<\/span><\/span> Transporte\s*<\/button>/);
  // O item antigo, que abre a janela, segue disponível para todos os perfis.
  assert.match(conteudo, /<button type="button" class="nav-item" onclick="abrirTransporteModulo\(\)">/);
});
