// Adaptadores para efeitos externos. Regras e testes devem depender deste objeto,
// nunca chamar os servicos Google diretamente.
var CodexExternalEffects_ = (function() {
  'use strict';

  function sendEmail(message) {
    return MailApp.sendEmail(message);
  }

  return Object.freeze({
    sendEmail: sendEmail
  });
})();
