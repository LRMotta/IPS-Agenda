'use strict';
/* global document, window, transpCentralCarregar, transpCentralAba */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

function script(nome) {
  return readProjectFile(nome).replace(/^\s*<script>/i, '').replace(/<\/script>\s*$/i, '');
}

async function abrir(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const erros = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  page.on('console', (mensagem) => { if (['error', 'warning'].includes(mensagem.type())) erros.push(mensagem.text()); });
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Transporte — teste local</title>' +
    readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + readProjectFile('IndexTransporteCentralStyles.html') +
    '<style>.material-symbols-outlined{display:inline-block;width:1em;overflow:hidden}</style></head><body>' +
    '<div class="main"><div class="top-bar"><span class="page-title">Transporte (piloto)</span></div><div class="content">' +
    readProjectFile('IndexTransporteCentralContent.html') + '</div></div></body></html>');
  await page.evaluate(() => {
    window.CURRENT_ACCESS = { ok: true, email: 'admin@example.invalid', role: 'admin' };
    window.getCurrentPage = () => 'transporte-central';
    window.esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    window.appErrorMessage = (erro) => String((erro && erro.message) || erro || 'Erro');
    window.snack = (mensagem) => { window.__erros = (window.__erros || []).concat(String(mensagem)); };
    window.snackErro = (mensagem) => { window.__erros = (window.__erros || []).concat(String((mensagem && mensagem.message) || mensagem)); };
    window.abrirPendenciaAgendaRegistro = (id) => { window.__aberto = id; };
    window.__pedidos = [];
    window.google = { script: { run: { withSuccessHandler(ok) { return { withFailureHandler(falha) { return { getTransporteTarefas() { window.__pedidos.push({ ok, falha }); }, getTransporteEnvio(...args) { window.__pedidos.push({ rpc: 'getTransporteEnvio', args, ok, falha }); } }; } }; } } } };
    document.getElementById('page-transporte-central').classList.add('active');
  });
  await page.addScriptTag({ content: script('SharedAccessRules.html') });
  await page.addScriptTag({ content: script('IndexTransporteCentralScripts.html') });
  await page.addScriptTag({ content: script('IndexTransporteCentralEnvio.html') });
  return { page, erros };
}

const RESPOSTA = {
  ok: true, janelaDiasUteis: 7, maisAdiante: { transportes: 3, visitas: 2, primeiraData: '13/10/2026' },
  tarefas: [
    { agendaId: 'a1', data: '02/10/2026', hora: '09:00', participante: 'Pessoa A', projeto: 'Estudo X', visita: 'V1', titulo: 'Preparar 2 transportes',
      prazoLabel: 'Em 3h', comPessoa: 'Ana', parouNoPasso: 2,
      transportes: [{ slotRotulo: 'Transporte I', courier: 'OCASA', temperatura: 'CONGELADO', destino: 'LAB X', situacao: 'preparar' },
        { slotRotulo: 'Backup', courier: 'MARKEN', temperatura: 'AMBIENTE', destino: 'LAB X', situacao: 'preparar' }] },
    { agendaId: 'a2', data: '06/10/2026', hora: '10:00', participante: 'Pessoa B', projeto: 'Estudo Y', visita: 'V2', titulo: 'Enviar o pedido de coleta à courier',
      prazoLabel: '', comPessoa: '', parouNoPasso: 0, transportes: [{ slotRotulo: 'Transporte I', courier: 'MARKEN', temperatura: 'CONGELADO', destino: 'LAB Y', awb: '123', situacao: 'enviar_doc' }] }
  ]
};

test('Transporte (piloto): próxima tarefa, lista, etiquetas e em breve', async () => {
  // Browser plugin not available: Chromium local com rede bloqueada e RPCs simuladas.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, erros } = await abrir(browser, width);
      await page.evaluate(() => transpCentralCarregar(false));
      assert.equal(await page.evaluate(() => window.__pedidos.length), 1);
      assert.equal(await page.locator('#tcFazer').getAttribute('aria-busy'), 'true');
      await page.evaluate((resposta) => window.__pedidos[0].ok(resposta), RESPOSTA);
      assert.equal(await page.locator('#tcFazer').getAttribute('aria-busy'), 'false');
      assert.equal(await page.locator('.tc-title').innerText(), 'Preparar 2 transportes');
      const titulo = await page.locator('.tc-title').innerText();
      assert.doesNotMatch(titulo, /Backup|Transporte I/, 'o tipo do transporte não vai no título');
      // Cada transporte numa faixa: tipo, situação, courier · temperatura e destino em blocos próprios.
      assert.match(await page.locator('.tc-transports').innerText(), /Transporte I\s+Preparar\s+OCASA · CONGELADO\s+LAB X/);
      assert.match(await page.locator('.tc-transports').innerText(), /Backup/);
      assert.match(await page.locator('.tc-badges').innerText(), /Em 3h/);
      assert.match(await page.locator('.tc-badges').innerText(), /Parou no passo 2/);
      assert.match(await page.locator('.tc-badges').innerText(), /Com Ana agora/);
      assert.equal(await page.locator('.tc-list .tc-item').count(), 1);
      assert.match(await page.locator('.tc-list').innerText(), /Enviar o pedido de coleta à courier/);
      assert.equal(await page.locator('.tc-item.urgent').count(), 0);
      assert.match(await page.locator('.tc-footer').innerText(), /3 transportes viram tarefa em breve/);
      await page.locator('[data-tc-abrir]').click();
      assert.equal(await page.evaluate(() => window.__aberto), 'a1');
      // O link do rodapé abre a aba; as demais seções ainda são casca.
      await page.locator('[data-tc-ir="adiante"]').click();
      assert.equal(await page.locator('#tcPanelAdiante').isVisible(), true);
      assert.equal(await page.locator('#tcPanelFazer').isVisible(), false);
      assert.equal(await page.locator('#tcTabAdiante').getAttribute('aria-selected'), 'true');
      await page.evaluate(() => transpCentralAba('fazer'));
      const overflow = await page.evaluate(() => { const c = document.querySelector('.content'); return c.scrollWidth > c.clientWidth; });
      assert.equal(overflow, false, 'sem rolagem horizontal em ' + width + 'px');
      const saida = path.join(process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright'));
      fs.mkdirSync(saida, { recursive: true });
      await page.screenshot({ path: path.join(saida, 'transporte-central-' + width + '.png'), fullPage: true });
      assert.deepEqual(erros, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Transporte (piloto): vazio, erro e respostas fora de ordem', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    await page.evaluate(() => { transpCentralCarregar(false); transpCentralCarregar(true); });
    // A resposta da primeira consulta chega depois da segunda e não pode sobrescrever a tela.
    await page.evaluate((resposta) => { window.__pedidos[1].ok({ ok: true, tarefas: [], maisAdiante: { transportes: 0 } }); window.__pedidos[0].ok(resposta); }, RESPOSTA);
    assert.match(await page.locator('#tcFazer').innerText(), /Tudo feito por agora/);
    assert.equal(await page.locator('.tc-footer').count(), 0);
    // Outra conta ou outra tela: resposta ignorada.
    await page.evaluate(() => transpCentralCarregar(true));
    await page.evaluate((resposta) => { window.CURRENT_ACCESS = { ok: true, email: 'outra@example.invalid', role: 'admin' }; window.__pedidos[2].ok(resposta); }, RESPOSTA);
    assert.match(await page.locator('#tcFazer').innerText(), /Tudo feito por agora/);
    await page.evaluate(() => { window.CURRENT_ACCESS = { ok: true, email: 'admin@example.invalid', role: 'admin' }; transpCentralCarregar(true); });
    await page.evaluate(() => window.__pedidos[3].falha(new Error('Acesso permitido apenas para administradores.')));
    assert.deepEqual(await page.evaluate(() => window.__erros), ['Acesso permitido apenas para administradores.']);
    // Perfil que não é admin nem chama a RPC.
    await page.evaluate(() => { window.CURRENT_ACCESS = { ok: true, email: 'u@example.invalid', role: 'user' }; transpCentralCarregar(true); });
    assert.equal(await page.evaluate(() => window.__pedidos.length), 4);
    assert.deepEqual(erros, []);
  } finally { await browser.close(); }
});

const ITEM = (extra) => Object.assign({ agendaId: 'x1', data: '06/10/2026', hora: '09:00', participante: 'Pessoa X', projeto: 'Estudo X', visita: 'V1', prazoLabel: '',
  slot: '1', slotRotulo: 'Transporte I', courier: 'OCASA', temperatura: 'CONGELADO', destino: 'LAB X', awb: '111' }, extra || {});

const COMPLETA = {
  ok: true, janelaDiasUteis: 7, tarefas: [],
  maisAdiante: { transportes: 3, visitas: 3, primeiraData: '13/10/2026', semanas: [
    { chave: '12/10/2026', rotulo: 'Semana de 12/10 a 18/10', itens: [ITEM({ agendaId: 's1', data: '16/10/2026', viraTarefaEm: '09/10/2026' }), ITEM({ agendaId: 's2', data: '16/10/2026', viraTarefaEm: '09/10/2026' })] },
    { chave: '19/10/2026', rotulo: 'Semana de 19/10 a 25/10', itens: [ITEM({ agendaId: 's3', data: '19/10/2026', viraTarefaEm: '12/10/2026' })] }] },
  acompanhar: {
    confirmacao: [ITEM({ agendaId: 'c1', prazoLabel: 'Em 3h' })],
    pinex: [ITEM({ agendaId: 'p1', courier: 'PINEX (Agendamento)', awb: '' })],
    transito: [ITEM({ agendaId: 't1', slot: '2', slotRotulo: 'Transporte II', courier: 'DHL', awb: '222', trackingUrl: 'https://rastreio.example.invalid/222', diasDesdeEnvio: 3 }),
      ITEM({ agendaId: 't2', courier: 'MARKEN', awb: '333', trackingUrl: '', diasDesdeEnvio: 1 })] },
  backups: [ITEM({ agendaId: 'b1', slotRotulo: 'Backup', prazoLabel: 'Atrasada', awb: '' }), ITEM({ agendaId: 'b2', slotRotulo: 'Backup II', awb: '' })]
};

test('Acompanhar, Em breve e Backups: seções, acordeão, rastreio, entrega e abertura da Agenda', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, erros } = await abrir(browser, width);
      await page.evaluate(() => {
        window.abrirPendenciaTracking = (_e, url) => { window.__rastreio = url; };
        window.confirmarEntregaPendencia = (...args) => { window.__entrega = args.slice(1); };
      });
      await page.evaluate(() => transpCentralCarregar(false));
      await page.evaluate((resposta) => window.__pedidos[0].ok(resposta), COMPLETA);
      // Contagens nas abas.
      assert.equal(await page.locator('#tcTabAcompanhar').innerText(), 'Acompanhar (2)');
      assert.equal(await page.locator('#tcTabTransito').innerText(), 'Em trânsito (2)');
      assert.equal(await page.locator('#tcTabAdiante').innerText(), 'Em breve (3)');
      assert.equal(await page.locator('#tcTabBackups').innerText(), 'Backups não agendados (2)');
      // Acompanhar.
      await page.evaluate(() => transpCentralAba('acompanhar'));
      const acomp = await page.locator('#tcAcompanhar').innerText();
      assert.match(acomp, /Aguardando confirmação da courier[\s\S]*Em 3h[\s\S]*Aguardando resposta da PINEX/i);
      assert.doesNotMatch(acomp, /Em trânsito/i, 'os envios em trânsito ficam na aba própria');
      await page.locator('#tcAcompanhar [data-tc-abrir="c1"]').click();
      assert.equal(await page.evaluate(() => window.__aberto), 'c1');
      // Em trânsito: aba própria, contagem de dias e ações lado a lado.
      await page.evaluate(() => transpCentralAba('transito'));
      assert.equal(await page.locator('#tcPanelTransito').isVisible(), true);
      assert.equal(await page.locator('#tcPanelAcompanhar').isVisible(), false);
      const transito = await page.locator('#tcTransito').innerText();
      assert.match(transito, /Pessoa X[\s\S]*Enviada há 3 dias[\s\S]*Enviada há 1 dia/);
      assert.equal(await page.locator('[data-tc-rastreio]').count(), 1, 'lupa só com rastreio');
      if (width >= 1280) {
        const lupa = await page.locator('#tcTransito [data-tc-rastreio]').boundingBox();
        const botao = await page.locator('#tcTransito [data-tc-entrega^="t1|"]').boundingBox();
        assert.ok(Math.abs((lupa.y + lupa.height / 2) - (botao.y + botao.height / 2)) < 4, 'lupa e Confirmar entrega na mesma linha');
        const pagina = await page.locator('#page-transporte-central .tc-wrap').boundingBox();
        assert.ok(pagina.width > 1000, 'a tela usa a largura toda: ' + pagina.width);
      }
      await page.locator('[data-tc-rastreio]').click();
      assert.equal(await page.evaluate(() => window.__rastreio), 'https://rastreio.example.invalid/222');
      await page.locator('[data-tc-entrega^="t1|"]').click();
      assert.deepEqual(await page.evaluate(() => window.__entrega), ['t1', 'Transporte II', '222', 'Pessoa X', 'DHL', 'CONGELADO', '06/10/2026', '09:00', 'Estudo X', 'V1']);
      // Depois da confirmação (gancho do modal das Pendências) a lista é relida.
      await page.evaluate(() => window.transpCentralAposEntrega());
      assert.equal(await page.evaluate(() => window.__pedidos.length), 2);
      await page.evaluate((resposta) => window.__pedidos[1].ok(resposta), Object.assign({}, COMPLETA, { acompanhar: Object.assign({}, COMPLETA.acompanhar, { transito: [] }) }));
      assert.match(await page.locator('#tcTransito').innerText(), /Nenhum transporte em trânsito/i);
      assert.equal(await page.locator('#tcTabTransito').innerText(), 'Em trânsito');
      // Em breve: primeira semana aberta, uma por vez, só consulta; uma linha por visita.
      await page.evaluate(() => transpCentralAba('adiante'));
      assert.equal(await page.locator('.tc-semana-cab').first().getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.tc-semana-cab').nth(1).getAttribute('aria-expanded'), 'false');
      assert.match(await page.locator('#tcSemana0').innerText(), /16\/10\/2026[\s\S]*Pessoa X[\s\S]*Transporte I[\s\S]*OCASA · CONGELADO[\s\S]*LAB X[\s\S]*Vira tarefa em[\s\S]*09\/10\/2026/i);
      // s1 e s2 são visitas diferentes no mesmo dia: duas linhas; a data em destaque vem de dataOrdem quando houver.
      assert.equal(await page.locator('#tcSemana0 .tc-breve-linha').count(), 2);
      assert.equal(await page.locator('#tcAdiante button:not(.tc-semana-cab)').count(), 0, 'sem ações: só consulta');
      await page.locator('.tc-semana-cab').nth(1).click();
      assert.equal(await page.locator('.tc-semana-cab').first().getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.tc-semana-cab').nth(1).getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#tcSemana0').isVisible(), false);
      assert.equal(await page.locator('#tcSemana1').isVisible(), true);
      // Backups não agendados.
      await page.evaluate(() => transpCentralAba('backups'));
      // Rótulo do slot em maiúsculas pelo CSS: a comparação ignora caixa.
      assert.match(await page.locator('#tcBackups').innerText(), /Atrasada[\s\S]*Backup II/i);
      assert.equal(await page.locator('#tcBackups .tc-acomp.urgent').count(), 1);
      await page.getByRole('button', { name: 'Abrir agendamento' }).first().click();
      assert.equal(await page.evaluate(() => window.__aberto), 'b1');
      // Aguardando a PINEX: "Informar os números" abre o passo a passo do mesmo transporte, no slot certo.
      await page.evaluate(() => transpCentralAba('acompanhar'));
      await page.getByRole('button', { name: 'Informar os números da PINEX' }).click();
      assert.deepEqual(await page.evaluate(() => window.__pedidos[window.__pedidos.length - 1].args), ['p1', '1']);
      assert.equal(await page.evaluate(() => window.TC_ENVIO.agendaId + '|' + window.TC_ENVIO.slot), 'p1|1');
      await page.evaluate(() => { window.TC_ENVIO.aberto = false; transpCentralAba('backups'); });
      const overflow = await page.evaluate(() => { const c = document.querySelector('.content'); return c.scrollWidth > c.clientWidth; });
      assert.equal(overflow, false, 'sem rolagem horizontal em ' + width + 'px');
      const saida = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(saida, { recursive: true });
      await page.evaluate(() => transpCentralAba('acompanhar'));
      await page.screenshot({ path: path.join(saida, 'transporte-acompanhar-' + width + '.png'), fullPage: true });
      assert.deepEqual(erros, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('Aguardando peticionamento: botão só para quem peticiona, em dois cliques', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    await page.evaluate(() => {
      window.__rpcGru = [];
      const run = window.google.script.run;
      window.google.script.run = { withSuccessHandler: (ok) => ({ withFailureHandler: (falha) => ({
        getTransporteTarefas() { window.__pedidos.push({ ok, falha }); },
        marcarGruExtratoProntosTransporte(...args) { window.__rpcGru.push({ args, ok, falha }); }
      }) }) };
      void run;
    });
    const dados = (pode) => ({ ok: true, janelaDiasUteis: 7, tarefas: [], maisAdiante: { transportes: 0, semanas: [] }, backups: [], podePeticionar: pode,
      acompanhar: { confirmacao: [], pinex: [], transito: [], peticionamento: [ITEM({ agendaId: 'g1', slot: '2', slotRotulo: 'Transporte II', participante: 'M.S.' })] } });
    await page.evaluate(() => transpCentralCarregar(false));
    await page.evaluate((d) => window.__pedidos[0].ok(d), dados(false));
    await page.evaluate(() => transpCentralAba('acompanhar'));
    assert.match(await page.locator('#tcAcompanhar').innerText(), /Aguardando peticionamento \(GRU e extrato\)[\s\S]*Aguardando quem peticiona/i);
    assert.equal(await page.locator('[data-tc-gru]').count(), 0, 'quem não está na lista não vê a ação');
    assert.equal(await page.locator('#tcTabAcompanhar').innerText(), 'Acompanhar (1)');
    await page.evaluate(() => transpCentralCarregar(true));
    await page.evaluate((d) => window.__pedidos[1].ok(d), dados(true));
    await page.locator('[data-tc-gru]').click();
    assert.equal(await page.evaluate(() => window.__rpcGru.length), 0, 'o primeiro clique só arma a confirmação');
    assert.match(await page.locator('[data-tc-gru]').innerText(), /Confirmar: GRU e extrato prontos\?/);
    await page.locator('[data-tc-gru]').click();
    assert.deepEqual(await page.evaluate(() => window.__rpcGru[0].args), ['g1', '2']);
    await page.evaluate(() => window.__rpcGru[0].ok({ ok: true }));
    assert.match(await page.evaluate(() => (window.__erros || []).join('|')), /tarefa de anexar e enviar voltou/);
    assert.equal(await page.evaluate(() => window.__pedidos.length), 3, 'a lista é relida');
    assert.deepEqual(erros, []);
  } finally { await browser.close(); }
});
