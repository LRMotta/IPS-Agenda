'use strict';
/* global window, document */

const fs = require('node:fs');
const path = require('node:path');
const { contentAccessibilitySource } = require('./content-accessibility-source');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// DOM e scripts reais; apenas infraestrutura do shell e RPCs sao simulados.
async function agendaBrowserFixture(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', (route) => route.abort());
  await page.clock.install({ time: new Date('2026-10-05T01:00:00Z') });
  await page.setContent('<!doctype html><html lang="pt-BR"><head><title>Agenda — teste local</title>' +
    read('IndexStyles.html') + read('IndexStylesAfterDashboard.html') +
    '<style>#page-agenda{display:block}body{padding:16px}.material-symbols-outlined{font-size:14px}</style></head><body>' +
    read('IndexContentAfterDashboard.html') + read('IndexContentAfterStock.html') + read('IndexExtraModals.html') + '</body></html>');
  await page.evaluate(() => {
    window.APP_BOOTSTRAP_STARTED = true;
    window.calls = [];
    window.notifications = [];
    window.refreshes = 0;
    window.dirty = false;
    window.codexNormText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    window.esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    window.appErrorMessage = (error) => error?.message || String(error);
    window.snack = window.snackErro = (value) => window.notifications.push(String(value));
    window.limparErro = (id, errorId) => {
      document.getElementById(id)?.classList.remove('invalid');
      document.getElementById(errorId)?.classList.remove('show');
    };
    window.abrirOverlay = (id) => document.getElementById(id).classList.add('open');
    window.fecharOverlay = (id) => document.getElementById(id).classList.remove('open');
    window.appSetInlineStatusMessage = (id, message) => {
      const element = typeof id === 'string' ? document.getElementById(id) : id;
      if (element) element.textContent = message;
    };
    window.appClearUnsavedChanges = () => { window.dirty = false; };
    window.appSetButtonBusy = (button, busy) => { button.disabled = busy; };
    function runner(success, failure) {
      return new Proxy({}, { get(_target, method) {
        if (method === 'withSuccessHandler') return (callback) => runner(callback, failure);
        if (method === 'withFailureHandler') return (callback) => runner(success, callback);
        return (...args) => window.calls.push({ method, args, success, failure });
      } });
    }
    window.google = { script: { run: runner() } };
    window.appServerRun = ({ method, args, onSuccess, onFailure }) => window.calls.push({ method, args, success: onSuccess, failure: onFailure });
  });
  // Os overlays locais usam inert; inicializar a infraestrutura real que acompanha a classe open.
  await page.addScriptTag({ content: 'var APP_ACCESSIBLE_DIALOGS = [], APP_CONTENT_ACCESSIBILITY_READY = false;\n' +
    contentAccessibilitySource(['cpfValido', 'formatarTelefoneBrasileiro', 'appDialogFocusable', 'appFocusDialog', 'appSyncContentFieldAccessibility',
      'appSyncAccessibleDialogs', 'appAccessibleDialogKeydown', 'appInitContentAccessibility']) +
    '\nappInitContentAccessibility();' });
  for (const file of ['SharedAccessRules.html', 'SharedCourierRules.html', 'SharedMatBioTypes.html', 'SharedMatBioCore.html', 'SharedAgendaRules.html', 'IndexAgendaScripts.html']) {
    await page.addScriptTag({ content: read(file).replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, '') });
  }
  await page.evaluate(() => {
    window._agendaDados = {
      projetos: [{ id: 'P1', nome: 'Estudo A', codigo: 'EA' }, { id: 'P2', nome: 'Estudo AB', codigo: 'EAB' }],
      participantes: [{ id: 'P', nome: 'Participante de teste', projeto: 'Estudo AB' }],
      kitsColeta: [{ id: 'K1', label: 'Kit A', projeto: 'EA', idLote: 'L1' }, { id: 'K2', label: 'Kit AB', projetoId: 'P2', idLote: 'L2' }],
    };
    for (const [id, value] of Object.entries({ agProjeto: 'Estudo A', agParticipante: 'P', agMonitor1: 'M', agTipo: 'Visita' })) {
      document.getElementById(id).innerHTML = '<option value="' + value + '">' + value + '</option>';
    }
    window._agendaEditId = 'A';
    window._agendaEditOpenRequestId = 1;
    document.getElementById('agendaCreatePanel').classList.add('open');
    window.preencherAgendaKitsSelects(window._agendaDados.kitsColeta);
    document.getElementById('agKit1').value = 'K1';
    document.getElementById('agLabCentral').value = 'Sim';
    document.getElementById('agKitCard').style.display = 'block';
    document.getElementById('btnReservarKitsAgenda').style.display = 'flex';
    document.getElementById('btnBaixarKitsAgenda').style.display = 'flex';
    window.setAgendaKitsReservaState(false);
    window.setAgendaKitsBaixaState(false);
    window.carregarAgendaEventos = window.agendaRecarregarJanelaAtual_ = () => { window.refreshes += 1; };
  });
  return errors;
}

module.exports = { agendaBrowserFixture };
