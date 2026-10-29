'use strict';
// Gera a previa local do prototipo HTML da documentacao de Transporte com dados
// ficticios. Uso: node tools/preview-transporte-docs.js <saida.html> [copias]
const fs = require('node:fs');
const path = require('node:path');
const { runFile } = require('../tests/helpers/load-app-script');

const saida = process.argv[2];
if (!saida) {
  console.error('Informe o arquivo de saida: node tools/preview-transporte-docs.js <saida.html> [copias]');
  process.exit(1);
}
const copias = Number(process.argv[3] || 1);
const app = runFile('TransporteDocumentosHtml.gs');

const dados = {
  courier: 'MARKEN',
  temperatura: 'CONGELADO',
  dataEnvio: '2026-11-05',
  awb: '620X00000000',
  medico: { nome: 'Pessoa Investigadora Exemplo', cpf: '000.000.000-00', cremers: '00000' },
  destino: {
    nome: 'Laboratório Central Exemplo Specimen Processing',
    endereco: '1000 Example Drive',
    cidadePais: 'Indianapolis, IN, USA',
    zip: '00000',
    telefone: '(000) 0000000',
    contato: ''
  },
  materiais: [{ tipo: 'plasma', tubos: 4, formula: '4×1,0', total: 4 }],
  outroTipo: '',
  geloSecoKg: 4,
  contatoEmergencia: 'Telefone de Emergência (24H): +55 54 99909-1656',
  invoice: { packages: 1, totalWeight: '5 Kg' }
};

const html = app.transporteDocsHtmlMontar_(dados, [
  { chave: 'declaracaoTransp', copias },
  { chave: 'invoiceMarken', copias }
], { logoSrc: 'https://i0.wp.com/www.ucs.br/ips/wp-content/uploads/2024/08/logo_ips_2024_2.png?ssl=1' });
fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
fs.writeFileSync(saida, html, 'utf8');
console.log('Previa gerada: ' + path.resolve(saida));
