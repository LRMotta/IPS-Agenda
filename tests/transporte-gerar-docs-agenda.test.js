'use strict';

// "Gerar docs" da Agenda abre o passo a passo da tela Transporte (não o módulo antigo em outra janela), inclusive
// para transporte já agendado: é por ele que os documentos são refeitos quando a Agenda muda.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile } = require('./helpers/load-app-script');

function tela(opcoes) {
  opcoes = opcoes || {};
  const eventos = [];
  const estado = { pagina: 'agenda', sujo: !!opcoes.sujo, continuar: null };
  const context = vm.createContext({
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    TC_ENVIO: Object.assign({ aberto: false, agendaId: '', slot: '', passo: '', gerando: false }, opcoes.envio || {}),
    CURRENT_ACCESS: { ok: true, email: 'eu@ucs.example' },
    snack: (m) => eventos.push('snack:' + m),
    snackErro: (m) => eventos.push('erro:' + m),
    getCurrentPage: () => estado.pagina,
    appClearUnsavedChanges: () => { estado.sujo = false; },
    appConfirmNavigationIfDirty: (_painel, continuar) => {
      if (!estado.sujo) return true;
      estado.continuar = continuar;
      return false;
    },
    esc: (v) => String(v == null ? '' : v)
  });
  vm.runInContext(readProjectFile('IndexTransporteCentralScripts.html').replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, ''), context);
  // Navegação real: a página muda e a tela é carregada na mesma chamada (como irPara faz).
  context.irPara = (pagina) => {
    eventos.push('irPara:' + pagina);
    if (opcoes.recusar) return;
    estado.pagina = pagina;
    if (pagina === 'transporte-central') context.carregarTransporteCentral();
  };
  context.transpCentralAbrirEnvio = (agendaId, slot) => eventos.push('abrir:' + agendaId + '|' + slot);
  context.transpCentralAba = () => {};
  context.transpCentralCarregar = () => eventos.push('lista');
  return { context, eventos, estado };
}

test('Gerar docs pela Agenda vai à tela Transporte e abre só o envio daquele transporte', () => {
  const { context, eventos } = tela();
  context.transpCentralAbrirEnvioPelaAgenda('AG1', '2');
  assert.deepEqual(eventos, ['irPara:transporte-central', 'abrir:AG1|2']);
  // O pedido foi usado: voltar à tela depois mostra a lista, sem reabrir o envio.
  context.carregarTransporteCentral();
  assert.deepEqual(eventos.slice(2), ['lista']);
});

test('alterações não salvas: só navega depois de confirmar, e abre o envio pedido', () => {
  const { context, eventos, estado } = tela({ sujo: true });
  context.transpCentralAbrirEnvioPelaAgenda('AG1', '1');
  assert.deepEqual(eventos, []);
  estado.continuar();
  assert.deepEqual(eventos, ['irPara:transporte-central', 'abrir:AG1|1']);
});

test('navegação recusada não deixa o pedido para a próxima visita à tela', () => {
  const { context, eventos } = tela({ recusar: true });
  context.transpCentralAbrirEnvioPelaAgenda('AG1', '1');
  assert.deepEqual(eventos, ['irPara:transporte-central']);
  context.carregarTransporteCentral();
  assert.deepEqual(eventos.slice(1), ['lista']);
});

test('geração em curso na tela não é trocada por outro envio', () => {
  const { context, eventos } = tela({ envio: { aberto: true, agendaId: 'AG9', slot: '1', passo: 'gerar', gerando: true } });
  context.transpCentralAbrirEnvioPelaAgenda('AG1', '1');
  assert.ok(!eventos.some((e) => e.startsWith('abrir:')));
  assert.ok(eventos.some((e) => /Aguarde terminar/.test(e)));
});

test('sem agendamento ou transporte: avisa e não navega', () => {
  const { context, eventos } = tela();
  context.transpCentralAbrirEnvioPelaAgenda('', '1');
  assert.deepEqual(eventos, ['erro:Transporte não encontrado.']);
});

test('botões da Agenda não abrem mais o módulo antigo', () => {
  const agenda = readProjectFile('IndexAgendaScripts.html');
  for (const nome of ['gerarTransporteAgenda', 'gerarTransporteAgendaCard']) {
    const inicio = agenda.indexOf('  function ' + nome + '(');
    const corpo = agenda.slice(inicio, agenda.indexOf('\n  function ', inicio + 3));
    assert.ok(inicio > 0, nome);
    assert.doesNotMatch(corpo, /abrirTransporteModulo|prepararJanelaTransporte/, nome);
    assert.match(corpo, /transpCentralAbrirEnvioPelaAgenda\(/, nome);
  }
});
