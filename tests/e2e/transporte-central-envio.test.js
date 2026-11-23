'use strict';
/* global document, window, transpCentralCarregar, transpCentralComecar, TC_ENVIO, transpCentralMarcarFeito, transpCentralProximoTransporte */

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
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) erros.push(m.text()); });
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Transporte — teste local</title>' +
    readProjectFile('IndexStyles.html') + readProjectFile('IndexStylesAfterDashboard.html') + readProjectFile('IndexTransporteCentralStyles.html') +
    '<style>.material-symbols-outlined{display:inline-block;width:1em;overflow:hidden}</style></head><body>' +
    '<div class="main"><div class="top-bar"><span class="page-title">Transporte</span></div><div class="content">' +
    readProjectFile('IndexTransporteCentralContent.html') + '</div></div></body></html>');
  await page.evaluate(() => {
    window.CURRENT_ACCESS = { ok: true, email: 'admin@example.invalid', role: 'admin' };
    window.getCurrentPage = () => 'transporte-central';
    window.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    window.appErrorMessage = (e) => String((e && e.message) || e || 'Erro');
    window.__msgs = [];
    window.snack = (m) => window.__msgs.push(String(m));
    window.snackErro = (m) => window.__msgs.push(String((m && m.message) || m));
    window.__limpou = 0;
    window.appClearUnsavedChanges = () => { window.__limpou++; };
    window.abrirPendenciaAgendaRegistro = (id) => { window.__aberto = id; };
    window.__rpc = [];
    // Qualquer RPC vira um pedido registrado; o teste responde manualmente.
    window.google = { script: { run: new Proxy({}, { get: (_t, nome) => {
      if (nome === 'withSuccessHandler') return (ok) => ({ withFailureHandler: (falha) => new Proxy({}, { get: (_x, rpc) => (...args) => { window.__rpc.push({ rpc, args, ok, falha }); } }) });
      return undefined;
    } }) } };
    document.getElementById('page-transporte-central').classList.add('active');
  });
  await page.addScriptTag({ content: script('SharedAccessRules.html') });
  await page.addScriptTag({ content: script('IndexTransporteCentralScripts.html') });
  await page.addScriptTag({ content: script('IndexTransporteCentralEnvio.html') });
  return { page, erros };
}

const TAREFAS = {
  ok: true, janelaDiasUteis: 7, maisAdiante: { transportes: 0 },
  tarefas: [{ agendaId: 'a1', data: '02/10/2026', hora: '09:00', participante: 'Pessoa A', projeto: 'Estudo X', visita: 'V1', titulo: 'Preparar o transporte',
    prazoLabel: '', comPessoa: '', parouNoPasso: 0, transportes: [{ slot: '1', slotRotulo: 'Transporte I', courier: 'MARKEN', temperatura: 'CONGELADO', destino: 'LAB X', situacao: 'preparar' }] }]
};

function envio(extra) {
  return Object.assign({
    ok: true, versao: 3, passo: 'conferir', passos: ['conferir', 'gerar', 'enviar'], internacional: false, avisos: [],
    registro: { paciente: 'Pessoa A', protocolo: 'Estudo X', courier: 'MARKEN', temperatura: 'CONGELADO', dataColeta: '2026-11-16', dataEnvio: '2026-11-16',
      destino: 'LAB X', awb: '111122223333', agendadoPor: '', horaEnvio: '13:00 - 15:00',
      materiais: [{ ativo: true, material: 'Soro', tubos: 2, total: 2, unit: 'mL' }, { ativo: false, material: 'Urina' }] }
  }, extra || {});
}

// Responde ao pedido mais antigo da RPC indicada e o remove da fila.
async function responder(page, rpc, resposta) {
  await page.evaluate(({ rpc, resposta }) => {
    const i = window.__rpc.findIndex((p) => p.rpc === rpc);
    if (i < 0) throw new Error('RPC não chamada: ' + rpc + ' (fila: ' + window.__rpc.map((p) => p.rpc).join() + ')');
    const [pedido] = window.__rpc.splice(i, 1);
    pedido.ok(resposta);
  }, { rpc, resposta });
}

async function iniciar(page, respostaEnvio) {
  await page.evaluate(() => transpCentralCarregar(false));
  await responder(page, 'getTransporteTarefas', TAREFAS);
  await page.locator('[data-tc-comecar]').click();
  await responder(page, 'getTransporteEnvio', respostaEnvio || envio());
}

test('passo a passo MARKEN: conferir, gerar, enviar e concluir', async () => {
  // Browser plugin not available: Chromium local com rede bloqueada e RPCs simuladas.
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, erros } = await abrir(browser, width);
      await iniciar(page);
      assert.equal(await page.locator('#tcWizard').isVisible(), true);
      assert.equal(await page.locator('#tcTabs').isVisible(), false);
      assert.equal(await page.locator('#tcRefresh').isVisible(), false, 'o botão da lista não cobre o indicador de passo');
      assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 1 de 3 · Conferir/);
      assert.match(await page.locator('.tc-wiz-main').innerText(), /Transporte[\s\S]*MARKEN[\s\S]*Destino[\s\S]*LAB X[\s\S]*Materiais[\s\S]*Soro/);
      assert.doesNotMatch(await page.locator('.tc-wiz-main').innerText(), /Urina/, 'só os materiais marcados');
      // No Conferir o painel lateral não aparece (repetiria o conteúdo): a linha de resumo diz de quem é o envio.
      assert.match(await page.locator('.tc-wiz-resumo').innerText(), /Pessoa A[\s\S]*Estudo X[\s\S]*V1/);
      assert.equal(await page.locator('.tc-wiz-side').count(), 0);
      assert.deepEqual(await page.locator('.tc-trilha-item').evaluateAll((itens) => itens.map((li) => li.className.replace('tc-trilha-item tc-trilha-', '') + ':' + li.querySelector('.tc-trilha-nome').textContent)),
        ['atual:Conferir', 'depois:Gerar', 'depois:Enviar']);
      assert.equal(await page.getByRole('button', { name: 'Corrigir' }).count(), 1, 'um só Corrigir na Agenda');
      assert.equal(await page.getByRole('button', { name: 'Editar' }).isEnabled(), true);
      assert.match(await page.locator('.tc-wiz-main').innerText(), /Data do envio[\s\S]*16\/11\/2026/);
      const pasta = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(pasta, { recursive: true });
      await page.screenshot({ path: path.join(pasta, 'transporte-envio-conferir-' + width + '.png'), fullPage: true });
      // Campo obrigatório vazio: não avança.
      await page.getByRole('button', { name: /Sim, está tudo certo/ }).click();
      assert.match(await page.evaluate(() => window.__msgs.join('|')), /Agendado por/);
      assert.equal(await page.evaluate(() => window.__rpc.length), 0);
      await page.fill('#tcCampo_agendadoPor', 'Ana');
      await page.locator('#tcCampo_horaEnvio').focus(); // sair do campo salva sozinho, sem mudar de passo
      assert.deepEqual((await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'salvarTransporteEnvio').args)).slice(0, 4), ['a1', '1', 3, { agendadoPor: 'Ana' }]);
      await responder(page, 'salvarTransporteEnvio', { ok: true, versao: 4, passos: ['conferir', 'gerar', 'enviar'], passo: 'conferir' });
      await page.getByRole('button', { name: /Sim, está tudo certo/ }).click();
      const salvar = await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'salvarTransporteEnvio').args);
      assert.deepEqual(salvar, ['a1', '1', 4, { agendadoPor: 'Ana', horaEnvio: '13:00 - 15:00' }, 'gerar']);
      await responder(page, 'salvarTransporteEnvio', { ok: true, versao: 4, passos: ['conferir', 'gerar', 'enviar'], passo: 'gerar' });
      assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 2 de 3 · Gerar/);
      await page.getByRole('button', { name: /Gerar documentos/ }).click();
      assert.equal(await page.locator('.tc-bloco[aria-busy="true"]').count(), 1);
      const gerar = await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'gerarDocumentosTransporteEnvio').args);
      assert.deepEqual(gerar.slice(0, 3), ['a1', '1', 4]);
      assert.match(gerar[3], /^[a-f0-9]{32}$/);
      await responder(page, 'gerarDocumentosTransporteEnvio', { ok: true, versao: 5, fileName: 'x.pdf', fileUrl: 'https://drive.example.invalid/x', draftOk: true, ce: { found: true, name: 'CE.pdf' } });
      assert.match(await page.locator('.tc-wiz-main').innerText(), /x\.pdf[\s\S]*Rascunho de e-mail criado[\s\S]*Comunicado Especial localizado/);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 3 de 3 · Enviar/);
      // Documentos impressos vão com as amostras; o e-mail é só o pedido de coleta (MARKEN: com a CE do estudo).
      assert.match(await page.locator('.tc-wiz-main').innerText(), /Imprima os documentos[\s\S]*agente da courier[\s\S]*Abra o rascunho do pedido de coleta no Gmail[\s\S]*CE do estudo[\s\S]*Clique em Enviar/);
      assert.doesNotMatch(await page.locator('.tc-wiz-main').innerText(), /PDFs anexados/);
      // Lista de marcar: o botão só libera com todos os itens marcados; a trilha mostra os passos feitos.
      assert.deepEqual(await page.locator('.tc-trilha-item').evaluateAll((itens) => itens.map((li) => li.className.replace('tc-trilha-item tc-trilha-', ''))), ['feito', 'feito', 'atual']);
      const caixas = page.locator('[data-tc-check]');
      const total = await caixas.count();
      assert.equal(total, 4);
      for (let i = 0; i < total; i++) {
        assert.equal(await page.getByRole('button', { name: /Pronto, enviei/ }).isDisabled(), true);
        await caixas.nth(i).check();
      }
      assert.equal(await page.locator('#tcCheckDica').isVisible(), false);
      await page.getByRole('button', { name: /Pronto, enviei/ }).click();
      assert.deepEqual(await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'concluirEnvioTransporte').args), ['a1', '1', 5]);
      await responder(page, 'concluirEnvioTransporte', { ok: true, versao: 6 });
      assert.match(await page.locator('.tc-wiz-main').innerText(), /Tudo feito por agora/);
      const overflow = await page.evaluate(() => { const c = document.querySelector('.content'); return c.scrollWidth > c.clientWidth; });
      assert.equal(overflow, false, 'sem rolagem horizontal em ' + width + 'px');
      const saida = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(saida, { recursive: true });
      await page.screenshot({ path: path.join(saida, 'transporte-envio-' + width + '.png'), fullPage: true });
      await page.getByRole('button', { name: 'Voltar às tarefas' }).click();
      assert.equal(await page.locator('#tcTabs').isVisible(), true);
      assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'sairEnvioTransporte' || p.rpc === 'getTransporteTarefas')), true);
      assert.deepEqual(erros, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('passo AWB com dica da última AWB; números da PINEX com aviso de data', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    await iniciar(page, envio({ passo: 'awb', passos: ['conferir', 'awb', 'gerar', 'enviar'], registro: Object.assign(envio().registro, { awb: '' }) }));
    assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 2 de 4 · AWB/);
    const ultima = await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'getTransporteAwbUltima').args);
    assert.deepEqual(ultima, ['Estudo X', 'MARKEN', 'CONGELADO']);
    await responder(page, 'getTransporteAwbUltima', { ok: true, ultima: { awb: '999888777666' } });
    assert.match(await page.locator('.tc-dica').innerText(), /999888777666/);
    await page.getByRole('button', { name: /Salvar AWB/ }).click();
    assert.match(await page.evaluate(() => window.__msgs.join('|')), /Informe a AWB/);
    // AWB já usada: avisa antes de gravar; corrigir consulta de novo e só então grava.
    await page.fill('#tcCampo_awb', '111111111111');
    await page.getByRole('button', { name: /Salvar AWB/ }).click();
    const consulta = await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'getTransporteAwbAviso').args[0]);
    assert.deepEqual([consulta.awb, consulta.courier], ['111111111111', 'MARKEN']);
    await responder(page, 'getTransporteAwbAviso', { awb: '111111111111', text: 'A AWB já foi utilizada em outro envio: Transporte I · Pessoa B.' });
    assert.match(await page.locator('.tc-wiz-main').innerText(), /já foi utilizada em outro envio[\s\S]*Confira o número/);
    assert.equal(await page.locator('#tcCampo_awb').inputValue(), '111111111111');
    assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'salvarTransporteEnvio')), false);
    await page.fill('#tcCampo_awb', '123456789012');
    await page.getByRole('button', { name: /Usar esta AWB/ }).click();
    await responder(page, 'getTransporteAwbAviso', null);
    assert.match(await page.locator('.tc-wiz-side').innerText(), /AWB/);
    assert.deepEqual(await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'salvarTransporteEnvio').args), ['a1', '1', 3, { awb: '123456789012' }, 'gerar']);
    await responder(page, 'salvarTransporteEnvio', { ok: true, versao: 4, passos: ['conferir', 'gerar', 'enviar'] });
    assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 2 de 3 · Gerar/);
    await page.close();

    const p2 = await abrir(browser, 1280);
    await iniciar(p2.page, envio({ passo: 'pinex_numeros', passos: ['conferir', 'pinex_numeros', 'gerar', 'enviar'], registro: Object.assign(envio().registro, { courier: 'PINEX', awb: '' }) }));
    assert.match(await p2.page.locator('.tc-wiz-main').innerText(), /Número da coleta da PINEX[\s\S]*Frete/);
    await p2.page.getByRole('button', { name: 'Salvar e continuar' }).click();
    assert.match(await p2.page.locator('.tc-wiz-main').innerText(), /Informe o número da coleta/);
    assert.equal(await p2.page.evaluate(() => window.__rpc.some((p) => p.rpc === 'registrarRespostaPinexEnvio')), false);
    await p2.page.fill('#tcPinexColeta', '78429');
    await p2.page.fill('#tcPinexAwb', '94624');
    await p2.page.getByRole('button', { name: 'Salvar e continuar' }).click();
    assert.deepEqual(await p2.page.evaluate(() => window.__rpc.find((p) => p.rpc === 'registrarRespostaPinexEnvio').args), ['a1', '1', 3, { coleta: '78429', awb: '94624' }]);
    await responder(p2.page, 'registrarRespostaPinexEnvio', { ok: true, versao: 4, passo: 'conferir', passos: ['conferir', 'gerar', 'anvisa'],
      registro: Object.assign(envio().registro, { courier: 'PINEX', awb: '94624', pinexColeta: '78429' }), avisos: [] });
    assert.match(await p2.page.locator('.tc-wiz-progress').innerText(), /Passo 1 de 3 · Conferir/);
    assert.equal(await p2.page.evaluate(() => window.__rpc.some((p) => p.rpc === 'salvarTransporteEnvio')), false, 'sem segunda chamada');
    await p2.page.close();

    // Com a AWB já na Agenda, só o número da coleta.
    const p3 = await abrir(browser, 1280);
    await iniciar(p3.page, envio({ passo: 'pinex_numeros', passos: ['pinex_numeros', 'conferir', 'gerar', 'enviar'], registro: Object.assign(envio().registro, { courier: 'PINEX (Agendamento)', awb: '120447' }) }));
    assert.equal(await p3.page.locator('#tcPinexAwb').count(), 0);
    await p3.page.fill('#tcPinexColeta', '78429');
    await p3.page.getByRole('button', { name: 'Salvar e continuar' }).click();
    assert.deepEqual((await p3.page.evaluate(() => window.__rpc.find((p) => p.rpc === 'registrarRespostaPinexEnvio').args))[3], { coleta: '78429', awb: '' });
    await responder(p3.page, 'registrarRespostaPinexEnvio', { ok: false, mensagem: 'O número da coleta da PINEX tem 5 ou 6 dígitos.' });
    assert.match(await p3.page.locator('.tc-wiz-main').innerText(), /5 ou 6 dígitos/);
    assert.equal(await p3.page.locator('#tcPinexColeta').inputValue(), '78429');
    p2.erros.push(...p3.erros);
    assert.deepEqual(erros.concat(p2.erros), []);
  } finally { await browser.close(); }
});

test('outra pessoa no envio, falha e nova tentativa com o mesmo token, saída e respostas antigas', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    await page.evaluate(() => transpCentralCarregar(false));
    await responder(page, 'getTransporteTarefas', TAREFAS);
    await page.locator('[data-tc-comecar]').click();
    await responder(page, 'getTransporteEnvio', { ok: false, motivo: 'EM_PREPARO', comPessoa: 'Bia', mensagem: 'Com Bia agora. Este transporte está sendo preparado por outra pessoa.' });
    assert.match(await page.evaluate(() => window.__msgs.join('|')), /Com Bia agora/);
    assert.equal(await page.locator('#tcTabs').isVisible(), true);
    // Abrir, falhar a geração, tentar de novo: mesmo token.
    await page.evaluate(() => window.__rpc.splice(0));
    await page.locator('[data-tc-comecar]').click();
    await responder(page, 'getTransporteEnvio', envio({ passo: 'gerar' }));
    await page.getByRole('button', { name: /Gerar documentos/ }).click();
    const token1 = await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'gerarDocumentosTransporteEnvio').args[3]);
    await page.evaluate(() => { const i = window.__rpc.findIndex((p) => p.rpc === 'gerarDocumentosTransporteEnvio'); window.__rpc.splice(i, 1)[0].falha(new Error('Preencha os campos obrigatorios: Agendado por.')); });
    assert.match(await page.locator('.tc-wiz-main').innerText(), /Não foi possível gerar[\s\S]*Agendado por/);
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    const token2 = await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'gerarDocumentosTransporteEnvio').args[3]);
    assert.equal(token2, token1);
    // Resposta nula (a geração pode ter terminado no servidor): relê o envio, não volta ao "Gerar documentos".
    await page.evaluate(() => window.__rpc.splice(0));
    await page.evaluate(() => { TC_ENVIO.gerando = false; window.transpCentralGerar(); });
    await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'gerarDocumentosTransporteEnvio').ok(null));
    assert.equal(await page.evaluate(() => window.__rpc.filter((p) => p.rpc === 'getTransporteEnvio').length), 1);
    await responder(page, 'getTransporteEnvio', envio({ passo: 'enviar', versao: 7 }));
    assert.equal(await page.evaluate(() => [TC_ENVIO.passo, TC_ENVIO.dados.versao].join('|')), 'enviar|7');
    assert.match(await page.evaluate(() => window.__msgs.join('|')), /resposta da geração não chegou/);
    // Versão antiga recusada: também relê, em vez de deixar "Tentar de novo" que só repete a recusa.
    await page.evaluate(() => window.__rpc.splice(0));
    await page.evaluate(() => { TC_ENVIO.passo = 'gerar'; window.transpCentralGerar(); });
    await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'gerarDocumentosTransporteEnvio').falha(new Error('Este transporte foi alterado por outra pessoa. Recarregue antes de continuar.')));
    assert.equal(await page.evaluate(() => window.__rpc.filter((p) => p.rpc === 'getTransporteEnvio').length), 1);
    await responder(page, 'getTransporteEnvio', envio({ passo: 'enviar', versao: 7 }));
    assert.equal(await page.evaluate(() => TC_ENVIO.passo), 'enviar');
    // Resposta de uma abertura antiga não sobrescreve a atual.
    await page.evaluate(() => window.__rpc.splice(0));
    await page.evaluate(() => { TC_ENVIO.aberto = false; transpCentralComecar('a1', '1'); transpCentralComecar('a1', '1'); });
    const pedidos = await page.evaluate(() => window.__rpc.filter((p) => p.rpc === 'getTransporteEnvio').length);
    assert.equal(pedidos, 2);
    await page.evaluate(() => { window.__rpc[1].ok({ ok: true, versao: 9, passo: 'conferir', passos: ['conferir', 'gerar', 'enviar'], registro: { paciente: 'ATUAL', courier: 'MARKEN', materiais: [] } }); });
    await page.evaluate(() => { window.__rpc[0].ok({ ok: true, versao: 1, passo: 'conferir', passos: ['conferir', 'gerar', 'enviar'], registro: { paciente: 'ANTIGA', courier: 'MARKEN', materiais: [] } }); });
    assert.match(await page.locator('.tc-wiz-resumo').innerText(), /ATUAL/);
    // Sair e continuar depois guarda o passo e volta às tarefas.
    await page.evaluate(() => window.__rpc.splice(0));
    await page.getByRole('button', { name: 'Sair e continuar depois' }).click();
    assert.deepEqual(await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'sairEnvioTransporte').args), ['a1', '1', 9, 'conferir']);
    await responder(page, 'sairEnvioTransporte', { ok: true, versao: 10, passo: 'conferir' });
    assert.equal(await page.locator('#tcTabs').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'getTransporteTarefas')), true);
    assert.deepEqual(erros, []);
  } finally { await browser.close(); }
});

test('sair logo depois de editar um campo espera o salvamento automático e manda a versão nova', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    await iniciar(page);
    await page.fill('#tcCampo_agendadoPor', 'Ana');
    // O clique no botão tira o foco do campo: o "change" salva antes do clique chegar.
    await page.getByRole('button', { name: 'Sair e continuar depois' }).click();
    assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'salvarTransporteEnvio')), true);
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'sairEnvioTransporte')), false, 'não sai com a versão antiga');
    await responder(page, 'salvarTransporteEnvio', { ok: true, versao: 4, passos: ['conferir', 'gerar', 'enviar'], passo: 'conferir' });
    await page.waitForFunction(() => window.__rpc.some((p) => p.rpc === 'sairEnvioTransporte'));
    assert.deepEqual(await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'sairEnvioTransporte').args), ['a1', '1', 4, 'conferir']);
    assert.deepEqual(erros, []);
  } finally { await browser.close(); }
});

test('editar materiais: editor, salvar na Agenda, nota e recusa; Corrigir reabre o envio ao voltar', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    await iniciar(page);
    await page.getByRole('button', { name: 'Editar' }).click();
    assert.equal(await page.locator('.tc-mat-linha').count(), 1);
    assert.equal(await page.locator('#tcMatTipo0').inputValue(), 'Soro');
    assert.equal(await page.locator('#tcMatFormula0').inputValue(), '2x1');
    // Adicionar uma linha preserva o que já foi digitado.
    await page.fill('#tcMatFormula0', '2x1,5');
    await page.getByRole('button', { name: 'Adicionar material' }).click();
    assert.equal(await page.locator('.tc-mat-linha').count(), 2);
    assert.equal(await page.locator('#tcMatFormula0').inputValue(), '2x1,5');
    await page.selectOption('#tcMatTipo1', 'Plasma');
    await page.fill('#tcMatFormula1', '1x2');
    await page.fill('#tcMatEnsaio1', 'PK');
    // Editar não dispara o salvamento automático dos campos do passo.
    assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'salvarTransporteEnvio')), false);
    await page.getByRole('button', { name: 'Salvar materiais' }).click();
    const args = await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'editarMateriaisTransporteEnvio').args);
    assert.deepEqual(args, ['a1', '1', 3, [{ material: 'Soro', formula: '2x1,5', ensaio: '' }, { material: 'Plasma', formula: '1x2', ensaio: 'PK' }]]);
    await responder(page, 'editarMateriaisTransporteEnvio', { ok: true, alterado: true, versao: 4, ajuste: { por: 'admin@example.invalid', em: '2026-11-09T10:00:00.000Z', anterior: 'Soro: 2 tubo(s), 2,00 mL' },
      registro: Object.assign(envio().registro, { materiais: [{ ativo: true, material: 'Soro', tubos: 2, total: 3, unit: 'mL' }, { ativo: true, material: 'Plasma', tubos: 1, total: 2, unit: 'mL' }] }) });
    assert.equal(await page.locator('.tc-mat-linha').count(), 0);
    assert.match(await page.locator('.tc-wiz-main').innerText(), /Plasma[\s\S]*Material ajustado na preparação do transporte\. Valor anterior: Soro: 2 tubo\(s\), 2,00 mL/);
    assert.match(await page.evaluate(() => window.__msgs.join('|')), /Materiais atualizados na Agenda/);
    // Erro do servidor mantém o editor aberto com o que foi digitado.
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.fill('#tcMatFormula0', 'abc');
    await page.getByRole('button', { name: 'Salvar materiais' }).click();
    await page.evaluate(() => { const i = window.__rpc.findIndex((p) => p.rpc === 'editarMateriaisTransporteEnvio'); window.__rpc.splice(i, 1)[0].falha(new Error('Fórmula inválida')); });
    assert.equal(await page.locator('#tcMatFormula0').inputValue(), 'abc');
    assert.match(await page.evaluate(() => window.__msgs.join('|')), /Fórmula inválida/);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    assert.equal(await page.locator('.tc-mat-linha').count(), 0);
    // Corrigir abre a Agenda; ao voltar para a tela, o envio é relido.
    await page.evaluate(() => window.__rpc.splice(0));
    await page.getByRole('button', { name: 'Corrigir' }).first().click();
    assert.equal(await page.evaluate(() => window.__aberto), 'a1');
    await page.evaluate(() => window.carregarTransporteCentral());
    assert.equal(await page.evaluate(() => window.__rpc.filter((p) => p.rpc === 'getTransporteEnvio').length), 1);
    assert.deepEqual(erros, []);
  } finally { await browser.close(); }
});

test('passo ANVISA: formulário no quadro isolado, bloqueios, concluir e fim com aviso', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    await iniciar(page, envio({ passo: 'gerar', passos: ['conferir', 'gerar', 'anvisa'], internacional: true }));
    await page.getByRole('button', { name: /Gerar documentos/ }).click();
    await responder(page, 'gerarDocumentosTransporteEnvio', { ok: true, versao: 5, passo: 'anvisa', fileName: 'x.pdf', fileUrl: 'https://drive.example.invalid/x', draftOk: true, ce: { found: true, name: 'CE.pdf' } });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 3 de 3 · Formulário ANVISA/);
    // Bloqueios: não gera o formulário e explica.
    assert.deepEqual(await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'getTransporteFormularioAnvisa').args), ['a1', '1']);
    await responder(page, 'getTransporteFormularioAnvisa', { ok: false, erros: ['O estudo não tem N° do CE no cadastro.'], avisos: [] });
    assert.match(await page.locator('.tc-wiz-main').innerText(), /não pôde ser gerado[\s\S]*N° do CE/);
    await page.getByRole('button', { name: 'Conferir de novo' }).click();
    await responder(page, 'getTransporteFormularioAnvisa', { ok: true, versao: 5, avisos: ['Laboratório sem telefone no cadastro.'], html: '<!doctype html><body><p id="formulario">PETIÇÃO DE FISCALIZAÇÃO</p></body>' });
    assert.match(await page.locator('.tc-wiz-main').innerText(), /Laboratório sem telefone no cadastro\./);
    const quadro = page.frameLocator('#tcAnvisaFrame');
    assert.match(await quadro.locator('#formulario').innerText(), /PETIÇÃO DE FISCALIZAÇÃO/);
    assert.match(await page.locator('#tcAnvisaFrame').getAttribute('sandbox'), /allow-same-origin/);
    assert.doesNotMatch(await page.locator('#tcAnvisaFrame').getAttribute('sandbox'), /allow-scripts/);
    await page.getByRole('button', { name: /Concluir e avisar quem peticiona/ }).click();
    assert.deepEqual(await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'concluirAnvisaTransporteEnvio').args), ['a1', '1', 5]);
    await responder(page, 'concluirAnvisaTransporteEnvio', { ok: true, versao: 6, destinatarios: ['aline@example.invalid'] });
    assert.match(await page.locator('.tc-wiz-main').innerText(), /formulário ANVISA foi enviado por e-mail a quem peticiona[\s\S]*anexar e enviar à courier/);
    assert.deepEqual(erros, []);
  } finally { await browser.close(); }
});

test('visita com 3 transportes: "Ir ao próximo" nunca volta a um transporte já concluído nesta tela', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    const resultado = await page.evaluate(() => {
      const tarefa = { agendaId: 'v3', transportes: [{ slot: '1' }, { slot: '2' }, { slot: '3' }] };
      const proximo = (atual) => { transpCentralMarcarFeito('v3', atual); const p = transpCentralProximoTransporte(tarefa, atual); return p ? p.slot : null; };
      // Sequência I -> II -> III: depois do II vem o III (antes voltava ao I).
      const sequencia = [proximo('1'), proximo('2'), proximo('3')];
      // Começando só pelo II: depois dele vem o III e, em seguida, o I que ainda falta.
      const outra = { agendaId: 'w3', transportes: [{ slot: '1' }, { slot: '2' }, { slot: '3' }] };
      const pelo = (atual) => { transpCentralMarcarFeito('w3', atual); const p = transpCentralProximoTransporte(outra, atual); return p ? p.slot : null; };
      return { sequencia, comecandoPeloII: [pelo('2'), pelo('3'), pelo('1')] };
    });
    assert.deepEqual(resultado.sequencia, ['2', '3', null]);
    assert.deepEqual(resultado.comecandoPeloII, ['3', '1', null]);
    assert.deepEqual(erros, []);
    await page.close();
  } finally { await browser.close(); }
});

test('Agenda alterada avisa; sair durante a geração não grava; preparo expirado é retomado', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    // Sair com a geração em andamento: o servidor termina sozinho; a tela não grava o passo por cima.
    await iniciar(page, envio({ passo: 'gerar' }));
    await page.getByRole('button', { name: /Gerar documentos/ }).click();
    assert.match(await page.locator('.tc-wiz-main').innerText(), /Gerando os documentos/);
    await page.getByRole('button', { name: 'Sair e continuar depois' }).click();
    assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'sairEnvioTransporte')), false);
    assert.equal(await page.locator('#tcTabs').isVisible(), true);
    await responder(page, 'getTransporteTarefas', TAREFAS);
    // Reabrir com a Agenda alterada: aviso (o token de geração é descartado no servidor).
    await page.evaluate(() => window.__rpc.splice(0));
    await page.locator('[data-tc-comecar]').click();
    await responder(page, 'getTransporteEnvio', envio({ dadosAtualizados: true }));
    assert.match(await page.evaluate(() => window.__msgs.join('|')), /mudaram na Agenda/);
    assert.match(await page.locator('.tc-wiz-progress').innerText(), /Passo 1 de 3 · Conferir/);
    // Gravação com o preparo expirado: a tela retoma o preparo; se outra pessoa assumiu, fecha.
    await page.fill('#tcCampo_agendadoPor', 'Ana');
    await page.locator('#tcCampo_agendadoPor').press('Tab');
    await responder(page, 'salvarTransporteEnvio', { ok: true, versao: 4, passos: ['conferir', 'gerar', 'enviar'], perdeuPreparo: true });
    assert.deepEqual(await page.evaluate(() => window.__rpc.find((p) => p.rpc === 'renovarPreparoTransporteEnvio').args), ['a1', '1']);
    await responder(page, 'renovarPreparoTransporteEnvio', { ok: true, versao: 4 });
    assert.equal(await page.locator('#tcWizard').isVisible(), true);
    await page.evaluate(() => window.transpCentralRenovarPreparo(true));
    await responder(page, 'renovarPreparoTransporteEnvio', { ok: false, motivo: 'EM_PREPARO', comPessoa: 'Bia', mensagem: 'Com Bia agora. Este transporte está sendo preparado por outra pessoa.' });
    assert.equal(await page.locator('#tcWizard').isVisible(), false);
    assert.equal(await page.locator('#tcTabs').isVisible(), true);
    assert.match(await page.evaluate(() => window.__msgs.join('|')), /Com Bia agora/);
    // Sem envio aberto, o sinal periódico não chama o servidor.
    await page.evaluate(() => { window.__rpc.splice(0); window.transpCentralRenovarPreparo(false); });
    assert.equal(await page.evaluate(() => window.__rpc.some((p) => p.rpc === 'renovarPreparoTransporteEnvio')), false);
    assert.deepEqual(erros, []);
  } finally { await browser.close(); }
});

test('passo Enviar: GRU e extrato, PINEX sem rascunho; AWB avisada pode ser confirmada; material fora da lista', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    const { page, erros } = await abrir(browser, 1280);
    // OCASA internacional com a GRU pronta: anexar é um passo da lista.
    await iniciar(page, envio({ passo: 'enviar', passos: ['enviar'], registro: Object.assign(envio().registro, { courier: 'OCASA', gruPronta: true }) }));
    const ocasa = await page.locator('.tc-wiz-main').innerText();
    assert.match(ocasa, /Anexar a GRU e o extrato e enviar à courier[\s\S]*Abra o rascunho[\s\S]*Anexe a GRU e o extrato[\s\S]*pasta deste envio/);
    await page.close();
    // PINEX com os números: não há rascunho; responde na conversa do agendamento.
    const p2 = await abrir(browser, 1280);
    await iniciar(p2.page, envio({ passo: 'enviar', passos: ['enviar'], registro: Object.assign(envio().registro, { courier: 'PINEX', gruPronta: true }) }));
    const pinex = await p2.page.locator('.tc-wiz-main').innerText();
    assert.match(pinex, /conversa do agendamento com a PINEX[\s\S]*Anexe a GRU e o extrato/);
    assert.doesNotMatch(pinex, /Abra o rascunho/);
    await p2.page.close();
    // Sem GRU (envio nacional), o texto segue o de sempre.
    const p3 = await abrir(browser, 1280);
    await iniciar(p3.page, envio({ passo: 'enviar' }));
    const marken = await p3.page.locator('.tc-wiz-main').innerText();
    assert.match(marken, /Pedir a coleta à courier[\s\S]*Abra o rascunho/);
    assert.doesNotMatch(marken, /GRU/);
    // Envio gerado antes de o registro guardar o PDF: indica a pasta do Drive.
    assert.match(marken, /Imprima os documentos[\s\S]*Meu Drive › Documentação para Transporte de Amostras/);
    await p3.page.close();
    // Com o PDF no registro (envio reaberto): link para imprimir, em outra aba.
    const pPdf = await abrir(browser, 1280);
    await iniciar(pPdf.page, envio({ passo: 'enviar', registro: Object.assign(envio().registro, { pdfArquivoId: 'PDF-9', pdfArquivoNome: 'AWB123 - Transporte.pdf' }) }));
    const pdf = pPdf.page.getByRole('link', { name: 'Abrir o PDF para imprimir' });
    assert.equal(await pdf.getAttribute('href'), 'https://drive.google.com/file/d/PDF-9/view');
    assert.equal(await pdf.getAttribute('target'), '_blank');
    assert.match(await pPdf.page.locator('.tc-wiz-main').innerText(), /AWB123 - Transporte\.pdf/);
    // Clicar no link não marca o item da lista.
    await pdf.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
    await pdf.click();
    assert.equal(await pPdf.page.locator('#tcCheck0').isChecked(), false);
    await pPdf.page.close();
    // Mesma AWB avisada, segundo clique: grava sem nova consulta.
    const p4 = await abrir(browser, 1280);
    await iniciar(p4.page, envio({ passo: 'awb', passos: ['conferir', 'awb', 'gerar', 'enviar'], registro: Object.assign(envio().registro, { courier: 'OCASA', awb: '' }) }));
    // Link para gerar a AWB no site da OCASA: abre em outra aba e o endereço não aparece no texto.
    const siteOcasa = p4.page.getByRole('link', { name: /Clique aqui para gerar a AWB no site da OCASA/ });
    assert.match(await siteOcasa.getAttribute('href'), /^https:\/\/pobdigital\.ocasa\.com\/mylifescience\?adr=/);
    assert.equal(await siteOcasa.getAttribute('target'), '_blank');
    assert.equal(await siteOcasa.getAttribute('rel'), 'noopener noreferrer');
    assert.doesNotMatch(await p4.page.locator('#page-transporte-central').innerText(), /pobdigital/);
    await p4.page.fill('#tcCampo_awb', 'PK2AAA000001');
    await p4.page.getByRole('button', { name: /Salvar AWB/ }).click();
    await responder(p4.page, 'getTransporteAwbAviso', { awb: 'PK2AAA000001', text: 'A AWB já foi utilizada em outro envio.' });
    await p4.page.getByRole('button', { name: /Usar esta AWB/ }).click();
    assert.equal(await p4.page.evaluate(() => window.__rpc.some((p) => p.rpc === 'getTransporteAwbAviso')), false);
    assert.deepEqual(await p4.page.evaluate(() => window.__rpc.find((p) => p.rpc === 'salvarTransporteEnvio').args.slice(3)), [{ awb: 'PK2AAA000001' }, 'gerar']);
    await p4.page.close();
    // Falha da consulta não impede gravar: a geração confere a AWB de qualquer forma.
    const p5 = await abrir(browser, 1280);
    await iniciar(p5.page, envio({ passo: 'awb', passos: ['conferir', 'awb', 'gerar', 'enviar'], registro: Object.assign(envio().registro, { courier: 'OCASA', awb: '' }) }));
    await p5.page.fill('#tcCampo_awb', 'PK2AAA000002');
    await p5.page.getByRole('button', { name: /Salvar AWB/ }).click();
    await p5.page.evaluate(() => { const i = window.__rpc.findIndex((p) => p.rpc === 'getTransporteAwbAviso'); window.__rpc.splice(i, 1)[0].falha(new Error('indisponível')); });
    assert.deepEqual(await p5.page.evaluate(() => window.__rpc.find((p) => p.rpc === 'salvarTransporteEnvio').args.slice(3)), [{ awb: 'PK2AAA000002' }, 'gerar']);
    await p5.page.close();
    // Material fora da lista do editor aparece como está, não como o primeiro item.
    const p6 = await abrir(browser, 1280);
    await iniciar(p6.page, envio({ registro: Object.assign(envio().registro, { materiais: [{ ativo: true, material: 'Líquor', tubos: 1, total: 1, unit: 'mL' }] }) }));
    await p6.page.getByRole('button', { name: 'Editar' }).click();
    assert.equal(await p6.page.locator('#tcMatTipo0').inputValue(), 'Líquor');
    assert.deepEqual(erros.concat(p2.erros, p3.erros, p4.erros, p5.erros, p6.erros, pPdf.erros), []);
  } finally { await browser.close(); }
});

test('rascunho pelo assunto, dica da AWB só no pacote do estudo e confirmação ao sair com algo digitado', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  try {
    // Passo Enviar em outra sessão: assunto e destinatários vêm do registro; o link procura o rascunho no Gmail.
    const { page, erros } = await abrir(browser, 1280);
    const assunto = 'Estudo X - 111122223333 - 16NOV2026 - LAB X - AGENDAMENTO DE COLETA';
    await iniciar(page, envio({ passo: 'enviar', registro: Object.assign(envio().registro, { rascunhoAssunto: assunto, rascunhoDestinatarios: 'courier@example.invalid' }) }));
    assert.match(await page.locator('.tc-rascunho').innerText(), /Assunto[\s\S]*AGENDAMENTO DE COLETA[\s\S]*Para[\s\S]*courier@example\.invalid/);
    const href = await page.getByRole('link', { name: 'Abrir este rascunho' }).getAttribute('href');
    assert.equal(href, 'https://mail.google.com/mail/#search/' + encodeURIComponent('in:drafts subject:"' + assunto + '"'));
    assert.equal(readProjectFile('IndexTransporteCentralEnvio.html').includes('localStorage'), false, 'o token de geração não fica mais no navegador');
    await page.close();
    // Sem assunto conhecido (envio antigo): a lista de rascunhos, sem conta fixa.
    const p2 = await abrir(browser, 1280);
    await iniciar(p2.page, envio({ passo: 'enviar' }));
    assert.equal(await p2.page.getByRole('link', { name: 'Abrir rascunhos' }).getAttribute('href'), 'https://mail.google.com/mail/#drafts');
    await p2.page.close();
    // DHL congelado: sem dica de pacote nem consulta; DHL Ambiente: consulta com a temperatura.
    const awb = (temperatura) => envio({ passo: 'awb', passos: ['conferir', 'awb', 'gerar', 'enviar'], registro: Object.assign(envio().registro, { courier: 'DHL', temperatura, awb: '' }) });
    const p3 = await abrir(browser, 1280);
    await iniciar(p3.page, awb('CONGELADO'));
    assert.match(await p3.page.locator('.tc-wiz-main').innerText(), /Informe a AWB deste transporte/);
    assert.equal(await p3.page.evaluate(() => window.__rpc.some((p) => p.rpc === 'getTransporteAwbUltima')), false);
    await p3.page.close();
    const p4 = await abrir(browser, 1280);
    await iniciar(p4.page, awb('AMBIENTE'));
    assert.match(await p4.page.locator('.tc-wiz-main').innerText(), /pacote recebido no início do estudo/);
    assert.deepEqual(await p4.page.evaluate(() => window.__rpc.find((p) => p.rpc === 'getTransporteAwbUltima').args), ['Estudo X', 'DHL', 'AMBIENTE']);
    // AWB digitada e não gravada: sair pede confirmação; confirmar sai.
    await p4.page.evaluate(() => { window.__confirmacoes = []; window.appOpenUnsavedConfirm = (sim) => { window.__confirmacoes.push(sim); }; });
    await p4.page.fill('#tcCampo_awb', '1234567890');
    await p4.page.getByRole('button', { name: 'Sair e continuar depois' }).click();
    assert.equal(await p4.page.evaluate(() => window.__confirmacoes.length), 1);
    assert.equal(await p4.page.evaluate(() => window.__rpc.some((p) => p.rpc === 'sairEnvioTransporte')), false);
    assert.equal(await p4.page.locator('#tcWizard').isVisible(), true);
    await p4.page.evaluate(() => window.__confirmacoes[0]());
    assert.equal(await p4.page.evaluate(() => window.__rpc.some((p) => p.rpc === 'sairEnvioTransporte')), true);
    await p4.page.close();
    // Editor de materiais aberto: confirma; sem nada digitado: sai direto.
    const p5 = await abrir(browser, 1280);
    await iniciar(p5.page);
    await p5.page.evaluate(() => { window.__confirmacoes = []; window.appOpenUnsavedConfirm = (sim) => { window.__confirmacoes.push(sim); }; });
    await p5.page.getByRole('button', { name: 'Editar' }).click();
    await p5.page.getByRole('button', { name: 'Sair e continuar depois' }).click();
    assert.equal(await p5.page.evaluate(() => window.__confirmacoes.length), 1);
    await p5.page.getByRole('button', { name: 'Cancelar' }).click();
    await p5.page.getByRole('button', { name: 'Sair e continuar depois' }).click();
    assert.equal(await p5.page.evaluate(() => window.__confirmacoes.length), 1);
    assert.equal(await p5.page.evaluate(() => window.__rpc.some((p) => p.rpc === 'sairEnvioTransporte')), true);
    assert.deepEqual(erros.concat(p2.erros, p3.erros, p4.erros, p5.erros), []);
  } finally { await browser.close(); }
});
