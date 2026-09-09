'use strict';

const fs = require('node:fs');
const path = require('node:path');

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error('Informe o JSON de municípios baixado da API de Localidades do IBGE.');
}

const municipalities = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const byState = {};

municipalities.forEach((municipality) => {
  const state = municipality['regiao-imediata']?.['regiao-intermediaria']?.UF ||
    municipality.microrregiao?.mesorregiao?.UF;
  if (!state?.sigla || !municipality.id || !municipality.nome) return;
  if (!byState[state.sigla]) byState[state.sigla] = [];
  byState[state.sigla].push([String(municipality.id), String(municipality.nome)]);
});

Object.values(byState).forEach((rows) => rows.sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')));

const expectedStates = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
expectedStates.forEach((state) => {
  if (!byState[state]?.length) throw new Error(`Nenhum município encontrado para ${state}.`);
});

const sourceUrl = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';
const mapSource = '{\n' + Object.keys(byState).sort().map((state) =>
  `  ${JSON.stringify(state)}:${JSON.stringify(byState[state])}`
).join(',\n') + '\n}';
const output = [
  '/**',
  ' * Relação oficial de municípios usada pelo cadastro de participantes.',
  ` * Fonte: ${sourceUrl}`,
  ' * Gerado por tools/generate-brazil-locations.js; não editar manualmente.',
  ' */',
  `var BRASIL_MUNICIPIOS_IBGE_ = ${mapSource};`,
  '',
  "function brasilUfNormalizada_(value) {",
  "  var uf = String(value || '').trim().toUpperCase();",
  "  return Object.prototype.hasOwnProperty.call(BRASIL_MUNICIPIOS_IBGE_, uf) ? uf : '';",
  '}',
  '',
  'function brasilMunicipioPorCodigo_(uf, codigo) {',
  '  uf = brasilUfNormalizada_(uf);',
  "  codigo = String(codigo || '').replace(/\\D/g, '');",
  '  if (!uf || !codigo) return null;',
  '  var rows = BRASIL_MUNICIPIOS_IBGE_[uf] || [];',
  '  for (var i = 0; i < rows.length; i++) {',
  '    if (rows[i][0] === codigo) return { codigo: rows[i][0], nome: rows[i][1], uf: uf };',
  '  }',
  '  return null;',
  '}',
  '',
  'function getMunicipiosBrasil(uf) {',
  '  uf = brasilUfNormalizada_(uf);',
  "  if (!uf) throw new Error('Selecione uma UF válida.');",
  '  return (BRASIL_MUNICIPIOS_IBGE_[uf] || []).map(function(row) {',
  '    return { codigo: row[0], nome: row[1] };',
  '  });',
  '}',
  '',
  'function brasilNormalizarLocalidade_(dados, contexto) {',
  '  dados = dados || {};',
  "  contexto = contexto ? ' ' + contexto : '';",
  "  var ufInformada = String(dados.estado || '').trim().toUpperCase();",
  "  var cidadeInformada = String(dados.cidade || '').trim();",
  "  var codigoInformado = String(dados.municipioCodigo || '').replace(/\\D/g, '');",
  '  if (!ufInformada && !cidadeInformada && !codigoInformado) {',
  "    dados.estado = ''; dados.cidade = ''; dados.municipioCodigo = '';",
  '    return dados;',
  '  }',
  '  var uf = brasilUfNormalizada_(ufInformada);',
  "  if (!uf) throw new Error('Selecione uma UF válida' + contexto + '.');",
  "  if (!cidadeInformada || !codigoInformado) throw new Error('Selecione um município da lista' + contexto + '.');",
  '  var municipio = brasilMunicipioPorCodigo_(uf, codigoInformado);',
  "  if (!municipio || participanteCampoKey_(municipio.nome) !== participanteCampoKey_(cidadeInformada)) {",
  "    throw new Error('O município selecionado não corresponde à UF informada' + contexto + '.');",
  '  }',
  '  dados.estado = municipio.uf;',
  '  dados.cidade = municipio.nome;',
  '  dados.municipioCodigo = municipio.codigo;',
  '  return dados;',
  '}',
  ''
].join('\n');

const outputPath = path.resolve(__dirname, '..', 'BrazilLocations.gs');
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Gerado ${outputPath} com ${municipalities.length} municípios em ${Object.keys(byState).length} UFs.`);
