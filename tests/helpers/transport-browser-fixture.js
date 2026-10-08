'use strict';
/* global window */

const { readProjectFile } = require('./load-app-script');

const participants = [
  { id: 'CAD-A', nome: 'Pessoa A', projeto: 'Estudo A', idParticipante: '123', investigador: 'Investigador A' },
  { id: 'CAD-B', nome: 'Pessoa B', projeto: 'Estudo B', idParticipante: '456', investigador: 'Investigador B' }
];

async function transportBrowserFixture(page, options = {}) {
  const errors = [];
  await page.route('**/*', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.text()); });
  let html = readProjectFile('TransporteApp.html');
  html = html.replace(/<link\b[^>]*>/g, '');
  html = html.replace(/<\?!= include\('([^']+)'\); \?>/g, (_match, name) => readProjectFile(name + '.html'));
  // Simula a saida contextual do template Apps Script, sem executar o servidor.
  html = html.replace(/JSON\.parse\(<\?= codexJsonForScript_\(initialTransporteArgs \|\| \{\}\) \?>\)/, 'JSON.parse("{}")');
  html = html.replace('<head>', '<head><title>Transporte — teste local</title>');
  const mock = `<script>
    // setContent usa origem opaca: armazenamento isolado, sem acessar perfil real.
    window.transportTestStorage = {};
    Object.defineProperty(window, 'localStorage', { configurable: true, value: {
      getItem: key => window.transportTestStorage[key] || null,
      setItem: (key, value) => { window.transportTestStorage[key] = String(value); },
      removeItem: key => { delete window.transportTestStorage[key]; }
    } });
    window.calls = [];
    function transportTestRunner(success, failure) {
      return new Proxy({}, { get: function(_target, method) {
        if (method === 'withSuccessHandler') return function(fn) { return transportTestRunner(fn, failure); };
        if (method === 'withFailureHandler') return function(fn) { return transportTestRunner(success, fn); };
        return function() { window.calls.push({ method: method, args: Array.prototype.slice.call(arguments), success: success, failure: failure }); };
      } });
    }
    window.google = { script: { run: transportTestRunner() } };
  </script>`;
  html = html.replace('<body>', '<body>' + mock);
  await page.setContent(html);
  await page.evaluate(({ participants, partialParticipants, fromAgenda }) => {
    const bootstrap = window.calls.find(call => call.method === 'getTransporteBootstrap');
    bootstrap.success({
      registro: { idAgenda: fromAgenda ? 'EVT-A' : '', agendaSlot: fromAgenda ? '2' : '', paciente: 'Pessoa A', participanteCadastroId: 'CAD-A', protocolo: 'Estudo A', identificacaoParticipante: '123',
        investigador: 'Investigador A', temperatura: 'AMBIENTE', courier: 'MARKEN', destino: 'Lab A',
        dataColeta: '2026-09-30', dataEnvio: '2026-09-30', horaEnvio: '08:00 - 12:00', agendadoPor: 'Equipe', awb: '123456789' },
      options: { participantes: fromAgenda ? [] : participants, participantesLoaded: !partialParticipants && !fromAgenda, temperaturas: ['AMBIENTE', 'CONGELADO'],
        couriers: ['MARKEN', 'DHL', 'OCASA'], destinos: [{ nome: 'Lab A' }], janelasEnvio: ['08:00 - 12:00'], agendadores: ['Equipe'],
        projetos: [{ nomeAbreviado: 'Estudo A' }, { nomeAbreviado: 'Estudo B' }] }
    });
  }, { participants: options.participants || participants, partialParticipants: !!options.partialParticipants, fromAgenda: !!options.fromAgenda });
  return errors;
}

module.exports = { transportBrowserFixture, participants };
