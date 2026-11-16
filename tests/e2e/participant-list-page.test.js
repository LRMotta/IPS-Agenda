'use strict';
/* global document, window, renderParticipantes, DASHBOARD_PENDING_FILTER:writable */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');
const { installMaterialIcons } = require('../helpers/material-icons');

const FUNCTIONS = ['applyDashboardPendingFilter_', 'bindTableRecordActions', 'formatDateBr', 'participanteNoGrupo_', 'participantesContarGrupo_',
  'participanteProjetoChave_', 'parPreencherFiltroProjeto_', 'parSetGrupo', 'parStatKeydown', 'parStatusFiltroAlterado', 'parLimparFiltros',
  'parAtualizarFiltrosUi_', 'renderParticipantes', 'participantesParaListagemUnificada_', 'filtrarParticipantes', 'chipStatus',
  'participanteStatusDynamicClass', 'participanteProjetoCellHtml', 'participanteUltimaVisitaCellHtml', 'participanteDetalheItemHtml_',
  'toggleParticipanteDetalhe', 'renderTabelaPart', 'normalizarProjetoParticipante', 'encontrarProjetoParticipante',
  'participanteStatusEncerrado_', 'codexRunSearchFilter'];

const PARTICIPANTES = [
  { id: '1', idPessoa: 'PES-1', nome: 'Ana Exemplo', idParticipante: 'AUR-001', dataNascimento: '1970-03-12', idade: '56', cpf: '111.111.111-11',
    projeto: 'AURORA', braco: 'Braço A', status: 'Ativo', telefone: '(54) 99999 0001', observacoes: 'Prefere contato pela manhã.\nSegunda linha.',
    ultimaVisita: 'C2D1', ultimaVisitaData: '02/11/2026' },
  { id: '2', idPessoa: 'PES-2', nome: 'Bruno Exemplo', idParticipante: 'AUR-002', dataNascimento: '1985-07-01', idade: '41',
    projeto: 'AURORA', status: 'Em triagem' },
  { id: '3', idPessoa: 'PES-3', nome: 'Carla Exemplo', idParticipante: 'BOR-010', projeto: 'BOR-22', status: 'Em Seguimento', telefone: '(54) 99999 0003' },
  { id: '4', idPessoa: 'PES-4', nome: 'Diego Exemplo', idParticipante: 'BOR-011', projeto: 'Boreal', status: 'Descontinuado' },
  // Mesma pessoa em dois protocolos: conta uma vez e aparece no grupo de cada participação.
  { id: '5', idPessoa: 'PES-5', nome: 'Eva Exemplo', idParticipante: 'AUR-003', projeto: 'AURORA', status: 'Em triagem' },
  { id: '6', idPessoa: 'PES-5', nome: 'Eva Exemplo', idParticipante: 'BOR-012', projeto: 'Boreal', status: 'Ativo' }
];

async function openPage(browser, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.abort());
  const content = readProjectFile('IndexContentAfterDashboard.html');
  const block = content.slice(content.indexOf('<div class="page" id="page-participantes">'), content.indexOf('<!-- ═══ AGENDA ═══ -->'));
  await page.setContent('<html lang="pt-BR"><head><title>IPS — participantes locais</title>' + readProjectFile('IndexStyles.html') +
    readProjectFile('IndexStylesAfterDashboard.html') + '</head><body><div class="content">' + block + '</div></body></html>');
  await installMaterialIcons(page);
  const source = readProjectFile('IndexCoreScripts.html');
  const functions = FUNCTIONS.map(name => {
    const m = source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'));
    assert.ok(m, name);
    return m[0];
  }).join('\n');
  await page.addScriptTag({ content: `
    var _participantes = [], _projListPart = [{ nome: 'AURORA', codigo: 'AUR-21' }, { nome: 'Boreal', codigo: 'BOR-22' }], STATUS_PART = [];
    var PAR_GRUPOS = { todos: 'Todos', ativos: 'Ativos / Em seguimento', triagem: 'Em triagem' }, _parGrupo = 'todos', _parTotalPessoas = 0;
    var DASHBOARD_PENDING_FILTER = '', DASHBOARD_PENDING_KEYS = '';
    var CODEX_SEARCH_FILTER_DELAY_MS = 0, CODEX_SEARCH_FILTER_TIMERS = {};
    window.actions = [];
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>'"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]; }); }
    function normSelectValue(v) { return String(v || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim(); }
    function formatarTelefoneBrasileiro(v) { return v || ''; }
    function abrirJornadaParticipante(p) { window.actions.push('journey:' + p.id); }
    function abrirFormPart(p) { window.actions.push('edit:' + p.id); }
    function confirmarExcluirPart(id) { window.actions.push('delete:' + id); }
    ${functions}
    document.getElementById('page-participantes').classList.add('active');` });
  return { page, errors };
}

const people = page => page.locator('#bodyParticipantes .part-row .part-id > .row-name').allTextContents();

test('Participantes: cartões, filtros e detalhe expansível no desktop e no celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless: true });
  const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
  fs.mkdirSync(artifacts, { recursive: true });
  try {
    for (const width of [1280, 390]) {
      const { page, errors } = await openPage(browser, width);
      await page.evaluate(lista => renderParticipantes(lista), PARTICIPANTES);

      // Cartões contam pessoas, pelo mesmo critério que a lista usa ao filtrar.
      assert.equal(await page.locator('#parTotal').textContent(), '5');
      assert.equal(await page.locator('#parAtivos').textContent(), '3');
      assert.equal(await page.locator('#parTriagem').textContent(), '2');
      // "BOR-22" (código) e "Boreal" (nome) são o mesmo projeto cadastrado.
      assert.equal(await page.locator('#parProjetos').textContent(), '2');
      assert.equal(await page.locator('#parContagem').textContent(), '5 participantes');
      assert.equal(await page.locator('#parLimparFiltros').isHidden(), true);
      assert.deepEqual(await people(page), ['Ana Exemplo', 'Bruno Exemplo', 'Carla Exemplo', 'Diego Exemplo', 'Eva Exemplo']);
      assert.deepEqual(await page.locator('#filterProjetoPar option').allTextContents(), ['Todos os projetos', 'AURORA', 'Boreal']);
      assert.equal(await page.locator('#bodyParticipantes tr:first-child td').count(), await page.locator('#page-participantes thead th').count());

      // O detalhe começa fechado: CPF e telefone não ficam expostos na lista.
      assert.equal(await page.locator('#bodyParticipantes .part-detail:visible').count(), 0);
      assert.equal(await page.getByText('111.111.111-11').isVisible(), false);
      const toggle = page.locator('#bodyParticipantes .part-row').first().locator('[data-par-detail-target]');
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.getByText('111.111.111-11').isVisible(), true);
      assert.equal(await page.locator('#par-detail-0 .par-det-obs').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await page.screenshot({ path: path.join(artifacts, 'participant-list-' + width + '.png') });
      // Clique na linha também alterna; clique em ação não abre o detalhe.
      await page.locator('#bodyParticipantes .part-row').first().locator('td').nth(2).click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await page.locator('#bodyParticipantes .part-row').nth(1).locator('[data-record-action="edit"]').click();
      assert.deepEqual(await page.evaluate(() => window.actions), ['edit:2']);
      assert.equal(await page.locator('#bodyParticipantes .part-detail:visible').count(), 0);
      await page.locator('#bodyParticipantes .part-row').nth(1).locator('[data-par-detail-target]').click();
      assert.match(await page.locator('#par-detail-1').textContent(), /Sem CPF, telefone ou observações/);

      // Cartão filtra por grupo e fica marcado.
      await page.locator('[data-par-card-grupo="ativos"]').click();
      assert.deepEqual(await people(page), ['Ana Exemplo', 'Carla Exemplo', 'Eva Exemplo']);
      assert.equal(await page.locator('[data-par-card-grupo="ativos"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#parContagem').textContent(), '3 de 5 participantes');
      assert.equal(await page.locator('#parLimparFiltros').isVisible(), true);
      // Projeto combina com o grupo, pelo nome ou pelo código gravado no cadastro.
      await page.locator('#filterProjetoPar').selectOption({ label: 'Boreal' });
      assert.deepEqual(await people(page), ['Carla Exemplo', 'Eva Exemplo']);
      // O seletor de status substitui o grupo do cartão, e vice-versa.
      await page.locator('#filterStatusPar').evaluate(el => { el.innerHTML = '<option value="">Todos os status</option><option>Descontinuado</option>'; });
      await page.locator('#filterStatusPar').selectOption('Descontinuado');
      assert.deepEqual(await people(page), ['Diego Exemplo']);
      assert.equal(await page.locator('[data-par-card-grupo="todos"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-par-card-grupo="triagem"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#filterStatusPar').inputValue(), '');
      assert.deepEqual(await people(page), []);
      assert.match(await page.locator('#bodyParticipantes .empty-row').textContent(), /Nenhum participante encontrado/);
      await page.locator('#bodyParticipantes .empty-row button').click();
      assert.equal(await page.locator('#filterProjetoPar').inputValue(), '');
      assert.equal(await page.locator('#bodyParticipantes .part-row').count(), 5);

      // Busca por CPF, ID e código do projeto continua funcionando.
      await page.locator('#searchParticipantes').fill('111.111');
      await page.waitForFunction(() => document.querySelectorAll('#bodyParticipantes .part-row').length === 1);
      await page.locator('#searchParticipantes').fill('bor-22');
      await page.waitForFunction(() => document.querySelectorAll('#bodyParticipantes .part-row').length === 3);

      // Filtro vindo do Dashboard limpa os demais e aplica o grupo, com pessoas unificadas.
      await page.evaluate(() => { DASHBOARD_PENDING_FILTER = 'participantesAtivos'; renderParticipantes(window._participantes); });
      assert.equal(await page.locator('#searchParticipantes').inputValue(), '');
      assert.deepEqual(await people(page), ['Ana Exemplo', 'Carla Exemplo', 'Eva Exemplo']);
      assert.equal(await page.evaluate(() => DASHBOARD_PENDING_FILTER), '');

      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

