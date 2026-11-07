// Geladeira do Estoque de kits de coleta e bulk supplies (docs/ESTOQUE_GELADEIRA.md).
// O modulo nasce congelado: as abas e o codigo sao preservados, mas a interface
// some e as operacoes compartilhadas deixam de le-lo. A propriedade de script
// ESTOQUE_MODULO_CONGELADO = false religa o modulo sem nova publicacao.
// A Farmacia tem estoque proprio e nao passa por esta chave.
var ESTOQUE_MODULO_CONGELADO = true;

function estoqueModuloCongelado_() {
  var configured;
  try {
    configured = PropertiesService.getScriptProperties().getProperty('ESTOQUE_MODULO_CONGELADO');
  } catch (e) {
    configured = '';
  }
  if (configured === null || configured === undefined || String(configured).trim() === '') return ESTOQUE_MODULO_CONGELADO === true;
  return String(configured).trim().toLowerCase() === 'true';
}

function estoqueDefinirCongelamento_(congelado) {
  codexAssertAdmin_();
  PropertiesService.getScriptProperties().setProperty('ESTOQUE_MODULO_CONGELADO', congelado ? 'true' : 'false');
  // A lista de kits da Agenda e cacheada; sem isto, religar levaria ate 30 min para aparecer.
  agendaInvalidateKitsReference_();
  Logger.log('[CODEX_ESTOQUE_GELADEIRA] ' + JSON.stringify({ operation: congelado ? 'freeze' : 'activate', success: true }));
  return { congelado: congelado };
}

function congelarEstoqueModuloAdmin() {
  return estoqueDefinirCongelamento_(true);
}

function religarEstoqueModuloAdmin() {
  return estoqueDefinirCongelamento_(false);
}
