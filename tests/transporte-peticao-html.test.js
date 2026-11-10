'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runFiles, projectRoot } = require('./helpers/load-app-script');

const plano = (v) => JSON.parse(JSON.stringify(v));
const normaliza = (html) => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim();

// Referência aprovada pelo usuário como fiel ao .doc (docs/PETICAO_FISCALIZACAO_REFERENCIA.js.txt).
function referencia() {
  const fonte = fs.readFileSync(path.join(projectRoot, 'docs', 'PETICAO_FISCALIZACAO_REFERENCIA.js.txt'), 'utf8');
  const modulo = { exports: {} };
  const corpo = fonte + '\n;module.exports = { html, dados, telefoneDe, cidadeDe, linhasMaterial };';
  new vm.Script(corpo).runInNewContext({ require, module: modulo, process: { argv: [] }, console });
  return modulo.exports;
}

function servidor() {
  const s = runFiles(['TransporteCodexConfig.gs', 'TransportePeticaoHtml.gs'], { Logger: { log() {} } });
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  return s;
}

const OCASA = { empresa: 'Internacional Latino Americana de Serviços Ltda.', cnpj: '35.795.236/0002-27' };
const PINEX = { empresa: 'Transportes Brasil Cargo Express LTDA.', cnpj: '20.494.657/0001-60' };
const COV = { nomeCompleto: 'PPD Global Central Lab Specimen Processing', endereco: '155 West 38th Street', cidade: 'Covington, Ohio - KY', cep: '41015', telefone: '+1-513-283-9816', pais: 'Estados Unidos' };
const HH = { nomeCompleto: 'PPD Global Central Lab Specimen Processing', endereco: '2 Tessender Drive', cidade: 'Highland Heights, KY', cep: '41076', telefone: '', pais: 'USA' };

function registro(extra, materiais) {
  const itens = (materiais || [['Soro', 2]]).map(([material, total]) => ({ ativo: true, material, total, unit: 'mL' }));
  return Object.assign({ awb: 'PK2AAA000001', protocolo: 'Estudo X', destino: 'LAB', courier: 'OCASA', materiais: itens }, extra || {});
}

test('o HTML porta a referência aprovada, caractere por caractere (OCASA e PINEX)', () => {
  const ref = referencia();
  const s = servidor();
  const casos = [
    { registro: registro({}, [['Soro', 2], ['Urina', 5], ['Sangue', 4]]), fontes: { lab: COV, courier: OCASA, numeroCE: '101/2023' },
      ref: { awb: 'PK2AAA000001', numeroCE: '101/2023', courier: OCASA, lab: COV, materiais: [{ tipo: 'Soro', totalMl: 2 }, { tipo: 'Urina', totalMl: 5 }, { tipo: 'Sangue', totalMl: 4 }] } },
    { registro: registro({ awb: '94624', courier: 'PINEX' }), fontes: { lab: HH, courier: PINEX, numeroCE: '24/2025' },
      ref: { awb: '94624', numeroCE: '24/2025', courier: PINEX, lab: HH, materiais: [{ tipo: 'Soro', totalMl: 2 }] } }
  ];
  for (const caso of casos) {
    const gerado = plano(s.transportePeticaoGerar_(caso.registro, caso.fontes));
    assert.equal(gerado.ok, true);
    assert.equal(normaliza(gerado.html), normaliza(ref.html(caso.ref)));
    assert.deepEqual(gerado.avisos, plano(ref.dados(caso.ref).avisos));
  }
  const hh = plano(s.transportePeticaoGerar_(casos[1].registro, casos[1].fontes));
  assert.deepEqual(hh.avisos, ['Laboratório sem telefone no cadastro.']);
});

test('conteúdo do formulário: materiais em maiúsculas com 2 casas, CE, HAWB, destino e CEP em caixas', () => {
  const s = servidor();
  const { html } = plano(s.transportePeticaoGerar_(registro({}, [['Soro', 2], ['Plasma', 2.5]]), { lab: COV, courier: OCASA, numeroCE: '101/2023' }));
  assert.match(html, /01\. MATERIAL BIOLÓGICO HUMANO\. SORO\. QUANTIDADE: 2,00 mL/);
  assert.match(html, /02\. MATERIAL BIOLÓGICO HUMANO\. PLASMA\. QUANTIDADE: 2,50 mL/);
  assert.match(html, /03\.<\/td>/, 'linhas vazias numeradas');
  assert.match(html, /CE 101\/2023/);
  assert.match(html, /HAWB<\/td><td class="lin"[^>]*>Nº <b>PK2AAA000001<\/b>/);
  assert.match(html, /Modalidade de Exportação: <span[^>]*>Remessa Expressa<\/span>/);
  assert.match(html, /3 - PESQUISA CLÍNICA/);
  assert.match(html, /2 - MATERIAL BIOLÓGICO HUMANO/);
  assert.equal((html.match(/class="cepc"/g) || []).length, 18, 'CEP do exportador e do destinatário: 9 caixas cada');
  assert.match(html, /<td class="cepc" style="width:19\.2pt">-<\/td>/);
  assert.match(html, /Endereço eletrônico \(e-mail\)<\/td><td class="val" style="width:360pt">ips@ucs\.br/);
});

test('telefone, cidade e CEP do laboratório', () => {
  const s = servidor();
  const tel = (lab) => plano(s.transportePeticaoTelefone_(lab));
  assert.deepEqual(tel({ telefone: '+1-513-283-9816' }), { ddd: '+1', numero: '513-283-9816' });
  assert.deepEqual(tel({ telefone: '(317) 2711200', pais: 'USA' }), { ddd: '+1', numero: '(317) 2711200' });
  assert.deepEqual(tel({ telefone: '123', pais: 'Alemanha' }), { ddd: '+49', numero: '123' });
  assert.deepEqual(tel({ telefone: '123', pais: 'Brasil' }), { ddd: '-', numero: '123' });
  assert.deepEqual(tel({ telefone: '', pais: 'Germany' }), { ddd: '-', numero: '-', falta: true });
  assert.deepEqual(plano(s.transportePeticaoCidade_('Covington, Ohio - KY')), { municipio: 'Covington', uf: 'Ohio - KY' });
  assert.deepEqual(plano(s.transportePeticaoCidade_('Rostock')), { municipio: 'Rostock', uf: '-' });
  const { avisos } = plano(s.transportePeticaoDados_(registro(), { lab: Object.assign({}, COV, { cep: '1234567890' }), courier: OCASA, numeroCE: '1/2020' }));
  assert.deepEqual(avisos, ['O CEP do laboratório tem mais de 8 caracteres.']);
});

test('bloqueios: sem AWB, sem CE, courier sem razão social ou CNPJ, mais de 6 materiais e laboratório desconhecido', () => {
  const s = servidor();
  const ok = { lab: COV, courier: OCASA, numeroCE: '1/2020' };
  const erros = (r, f) => plano(s.transportePeticaoGerar_(r, Object.assign({}, ok, f || {})));
  assert.deepEqual(erros(registro({ awb: '' })), { ok: false, erros: ['Informe a AWB antes de gerar.'], avisos: [] });
  assert.deepEqual(erros(registro(), { numeroCE: '' }).erros, ['O estudo não tem N° do CE no cadastro.']);
  assert.deepEqual(erros(registro(), { courier: { empresa: '', cnpj: '' } }).erros, ['Courier sem razão social ou CNPJ no cadastro.']);
  assert.deepEqual(erros(registro(), { courier: { empresa: 'X', cnpj: '' } }).erros, ['Courier sem razão social ou CNPJ no cadastro.']);
  const sete = Array.from({ length: 7 }, (_v, i) => ['Material ' + i, 1]);
  assert.deepEqual(erros(registro({}, sete)).erros, ['O formulário aceita até 6 materiais.']);
  assert.equal(erros(registro({}, sete.slice(0, 6))).ok, true);
  assert.deepEqual(erros(registro(), { lab: null }).erros, ['Laboratório de destino não encontrado no cadastro.']);
  assert.equal(erros(registro()).ok, true);
});

test('os dados vêm dos cadastros e a planilha de Transporte não é aberta', () => {
  const s = servidor();
  s.transporteLabCentralByDestino_ = () => COV;
  s.transporteCourierConfig_ = () => ({ empresa1: OCASA.empresa, cnpj1: OCASA.cnpj });
  s.transporteProjetoDisplay_ = (p) => String(p || '').trim();
  s.transporteReadProjetosDireto_ = () => [{ nomeAbreviado: 'Estudo X', numeroCE: '101/2023' }, { nomeAbreviado: 'Outro', numeroCE: '9/2000' }];
  const gerado = plano(s.transportePeticaoGerar_(registro()));
  assert.equal(gerado.ok, true);
  assert.match(gerado.html, /CE 101\/2023/);
  assert.match(gerado.html, /Internacional Latino Americana de Serviços Ltda\./);
  // Estudo sem N° do CE no cadastro.
  assert.deepEqual(plano(s.transportePeticaoGerar_(registro({ protocolo: 'Sem CE' }))).erros, ['O estudo não tem N° do CE no cadastro.']);
});
