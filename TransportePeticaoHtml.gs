/**
 * Petição de Fiscalização e Liberação Sanitária - Exportação (formulário ANVISA), em HTML.
 *
 * Porta de docs/PETICAO_FISCALIZACAO_REFERENCIA.js.txt (layout aprovado como fiel ao .doc, medidas em pt).
 * Gerada a partir do registro do envio, sem a planilha de Transporte. NAO entra na lista de PDFs enviados à
 * courier e não altera a Petição de Anuência. Aparece no passo ANVISA, para conferir e imprimir.
 *
 * transportePeticaoDados_ devolve { erros, avisos, ... }: com erros o formulário não é gerado.
 */
var TRANSPORTE_PETICAO_EXPORTADOR_ = {
  nome: 'FUNDAÇÃO UNIVERSIDADE DE CAXIAS DO SUL', cnpj: '88.648.761/0001-03', rua: 'FRANCISCO GETÚLIO VARGAS', numero: '1130',
  complemento: 'BL. S SALA 315', bairro: 'PETRÓPOLIS', cep: '95070-560', municipio: 'CAXIAS DO SUL', uf: 'RS', ddd: '54',
  telefone: '3218-2737', dddFax: '54', fax: '3218-2056', email: 'ips@ucs.br'
};
var TRANSPORTE_PETICAO_DDI_ = { usa: '+1', 'estados unidos': '+1', germany: '+49', alemanha: '+49' };
var TRANSPORTE_PETICAO_MAX_MATERIAIS_ = 6;

function transportePeticaoEsc_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function transportePeticaoVal_(valor) {
  var texto = String(valor === null || valor === undefined ? '' : valor).trim();
  return texto && texto !== '---' ? texto : '-';
}

// Telefone do laboratório: com "+" o código vai em DDD; senão, DDD pelo país. Sem telefone: "-" e aviso.
function transportePeticaoTelefone_(lab) {
  var telefone = String((lab && lab.telefone) || '').trim();
  if (!telefone) return { ddd: '-', numero: '-', falta: true };
  var m = /^(\+\d{1,3})[\s-]*(.+)$/.exec(telefone);
  if (m) return { ddd: m[1], numero: m[2].trim() };
  return { ddd: TRANSPORTE_PETICAO_DDI_[String((lab && lab.pais) || '').trim().toLowerCase()] || '-', numero: telefone };
}

// Cidade separada na última vírgula (município / UF); sem vírgula, UF "-".
function transportePeticaoCidade_(texto) {
  var s = String(texto || '').trim();
  var i = s.lastIndexOf(',');
  return i < 0 ? { municipio: s, uf: '-' } : { municipio: s.slice(0, i).trim(), uf: s.slice(i + 1).trim() };
}

function transportePeticaoVolume_(valor, unidade) {
  return Number(valor).toFixed(2).replace('.', ',') + ' ' + (unidade === 'g' ? 'g' : 'mL');
}

// Um material por linha: "01. MATERIAL BIOLÓGICO HUMANO. SORO. QUANTIDADE: 2,00 mL".
function transportePeticaoLinhasMaterial_(materiais) {
  return materiais.map(function(m, i) {
    return ('0' + (i + 1)).slice(-2) + '. MATERIAL BIOLÓGICO HUMANO. ' + String(m.tipo).toUpperCase() + '. QUANTIDADE: ' + transportePeticaoVolume_(m.total, m.unidade);
  });
}

// Materiais ativos do registro, com o total do transporte.
function transportePeticaoMateriais_(registro) {
  return (registro.materiais || []).filter(function(m) { return m && m.ativo && m.material; }).map(function(m) {
    return { tipo: String(m.material), total: Number(String(m.total).replace(',', '.')) || 0, unidade: m.unit === 'g' ? 'g' : 'mL' };
  });
}

/**
 * Dados do formulário a partir do registro. fontes (opcional): { lab, courier: { empresa, cnpj }, numeroCE }.
 * Sem fontes, usa os cadastros (LabCentral, aba Courier e Projetos).
 */
function transportePeticaoDados_(registro, fontes) {
  fontes = fontes || {};
  registro = registro || {};
  var erros = [];
  var avisos = [];
  var lab = fontes.lab !== undefined ? fontes.lab : transporteLabCentralByDestino_(registro.destino);
  var cfg = fontes.courier || transporteCourierConfig_(registro.courier);
  var courier = { empresa: String(cfg.empresa || cfg.empresa1 || '').trim(), cnpj: String(cfg.cnpj || cfg.cnpj1 || '').trim() };
  var numeroCE = fontes.numeroCE !== undefined ? fontes.numeroCE : transportePeticaoNumeroCE_(registro.protocolo);
  var materiais = transportePeticaoMateriais_(registro);
  if (!String(registro.awb || '').trim()) erros.push('Informe a AWB antes de gerar.');
  if (!String(numeroCE || '').trim()) erros.push('O estudo não tem N° do CE no cadastro.');
  if (materiais.length > TRANSPORTE_PETICAO_MAX_MATERIAIS_) erros.push('O formulário aceita até 6 materiais.');
  if (!courier.empresa || !courier.cnpj) erros.push('Courier sem razão social ou CNPJ no cadastro.');
  if (!lab) erros.push('Laboratório de destino não encontrado no cadastro.');
  lab = lab || {};
  var tel = transportePeticaoTelefone_(lab);
  if (tel.falta) avisos.push('Laboratório sem telefone no cadastro.');
  var cep = String(lab.cep || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (cep.length > 8) avisos.push('O CEP do laboratório tem mais de 8 caracteres.');
  return {
    erros: erros, avisos: avisos, lab: lab, courier: courier, numeroCE: String(numeroCE || '').trim(), awb: String(registro.awb || '').trim(),
    tel: tel, cep: cep, cidade: transportePeticaoCidade_(lab.cidade), linhas: transportePeticaoLinhasMaterial_(materiais)
  };
}

function transportePeticaoNumeroCE_(protocolo) {
  var chave = transporteParticipantKey_(transporteProjetoDisplay_(protocolo));
  var projetos = transporteReadProjetosDireto_() || [];
  for (var i = 0; i < projetos.length; i++) {
    if (transporteParticipantKey_(projetos[i].nomeAbreviado) === chave) return String(projetos[i].numeroCE || '').trim();
  }
  return '';
}

// 9 caixas do CEP: 5 dígitos, hífen e 3 dígitos.
function transportePeticaoCelulasCep_(cep) {
  var c = String(cep || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().split('');
  var larguras = [19.15, 19.2, 19.25, 19.2, 19.25, 19.2, 19.25, 19.2, 19.25];
  return larguras.map(function(w, i) {
    return '<td class="cepc" style="width:' + w + 'pt">' + (i === 5 ? '-' : transportePeticaoEsc_(c[i < 5 ? i : i - 1] || '')) + '</td>';
  }).join('');
}

function transportePeticaoLinha_(colunas) {
  return colunas.map(function(c) { return '<td class="' + (c[2] || '') + '" style="width:' + c[0] + 'pt">' + c[1] + '</td>'; }).join('');
}

function transportePeticaoTabela_(largura, conteudo) {
  return '<table style="width:' + largura + 'pt"><tr>' + conteudo + '</tr></table>';
}

/** HTML do formulário (3 páginas A4). dados: resultado de transportePeticaoDados_ sem erros. */
function transportePeticaoHtml_(dados) {
  var e = TRANSPORTE_PETICAO_EXPORTADOR_;
  var lab = dados.lab;
  var L = 'rot', B = 'val neg', V = 'val';
  var linha = transportePeticaoLinha_, tab = transportePeticaoTabela_, esc = transportePeticaoEsc_, val = transportePeticaoVal_;
  var itens = [0, 1, 2, 3, 4, 5].map(function(i) {
    return '<tr><td class="val item" colspan="4">' + esc(dados.linhas[i] || ('0' + (i + 1) + '.')) + '</td></tr>';
  }).join('');
  var estilo = '@page { size: A4; margin: 0; }\nhtml, body { margin: 0; background: #fff; }\n' +
    '.pag { width: 595.3pt; height: 841.9pt; box-sizing: border-box; padding: 36pt 28pt 36pt 72pt; overflow: hidden; page-break-after: always; font: 11pt/1.07 Calibri, Carlito, Arial, sans-serif; color: #000; }\n' +
    '.pag:last-child { page-break-after: auto; }\n@media screen { body { background: #d9d9d9; } .pag { background: #fff; margin: 12pt auto; } }\n' +
    'table { border-collapse: collapse; table-layout: fixed; }\ntd { padding: 0 3.5pt; vertical-align: top; height: 22.7pt; box-sizing: border-box; overflow: hidden; }\n' +
    '.rot, .val, .cepc { border: 1pt solid #000; }\n.rot { font-family: "Times New Roman", serif; }\n.cal { font-family: Calibri, Carlito, Arial, sans-serif; }\n.neg { font-weight: 700; }\n.negT { font-family: "Times New Roman", serif; font-weight: 700; }\n' +
    '.cepc { text-align: center; padding: 0; }\n.esp { height: 22.7pt; } .esp6 { height: 20.7pt; } .esp2 { height: 8pt; }\n.titulo { text-align: center; height: 22.7pt; }\n' +
    '.sec { font-family: "Times New Roman", serif; font-weight: 700; height: 15pt; padding-left: 3.5pt; }\n' +
    '.num { border: 1pt solid #000; background: #ccc; text-align: center; font-weight: 700; height: 21pt; padding: 0; }\n.tit { font-family: "Times New Roman", serif; font-weight: 700; }\n' +
    '.lin { border: 0; border-bottom: 1pt solid #000; border-left: 1pt solid #000; border-right: 1pt solid #000; }\n' +
    '.cabec { background: #e0e0e0; text-align: center; vertical-align: middle; height: 42pt; border: 0; border-left: 1pt solid #000; border-right: 1pt solid #000; }\n' +
    '.item { height: 22.7pt; }\n.vermelho { color: #f00; }\n.inst { font: 11pt/1.07 Arial, sans-serif; }\n.inst p { margin: .35pt 0 8pt; }\n.inst .tt { font-weight: 700; margin-bottom: 4pt; }\n' +
    '.inst ol { margin: 0 0 22pt; padding: 0 0 0 18pt; } .inst li { margin: .35pt 0 0; }';
  var pagina1 = '<div class="pag">\n  <div class="titulo">PETIÇÃO DE FISCALIZAÇÃO E LIBERAÇÃO SANITÁRIA - EXPORTAÇÃO</div>\n' +
    tab(489.5, linha([[77.75, 'Exportador', L + ' neg'], [411.75, esc(e.nome), B]])) + '\n  <div class="esp"></div>\n' +
    tab(489.5, linha([[77.75, 'CPF ou CNPJ', L + ' neg'], [411.75, esc(e.cnpj), B]])) + '\n  <div class="sec" style="margin-top:8pt">Endereço do Exportador</div>\n' +
    tab(489.5, linha([[69, 'Rua/Avenida', L], [215.45, esc(e.rua), V], [20.1, 'Nº', V], [39.25, esc(e.numero), V], [69.35, 'Complemento', L], [76.35, esc(e.complemento), V]])) + '\n  <div class="esp"></div>\n' +
    tab(489.5, linha([[59, 'Bairro', L], [232, esc(e.bairro), V], [25.55, 'CEP', L]]) + transportePeticaoCelulasCep_(e.cep)) + '\n  <div class="esp"></div>\n' +
    tab(489.5, linha([[59.1, 'Município', L], [232.4, esc(e.municipio), V], [25, 'UF', L], [173, esc(e.uf), V]])) + '\n  <div class="esp"></div>\n' +
    tab(489.5, linha([[30.85, 'DDD', L], [31.5, esc(e.ddd), V], [51.75, 'Telefone', L], [89.85, esc(e.telefone), V], [30.85, 'DDD', L], [43.55, esc(e.dddFax), V], [29.05, 'FAX', L], [182.1, esc(e.fax), V]])) + '\n  <div class="esp"></div>\n' +
    tab(489.5, linha([[129.5, 'Endereço eletrônico (e-mail)', V], [360, esc(e.email), V]])) + '\n  <div class="esp"></div>\n' +
    tab(489.5, linha([[127.35, 'Razão Social da Empresa Remessa Expressa', V + ' neg'], [216.35, esc(dados.courier.empresa), B], [35.45, 'CNPJ', V + ' neg'], [110.35, esc(dados.courier.cnpj), B]])) + '\n  <div class="esp6"></div>\n' +
    tab(489.5, '<td class="num">01</td><td class="tit" style="width:467.5pt">Modalidade de Exportação: <span style="font-weight:400">Remessa Expressa</span></td>') + '\n  <div class="esp2"></div>\n' +
    '  <table style="width:489.5pt"><colgroup><col style="width:22pt"><col style="width:24pt"><col style="width:60pt"><col style="width:44pt"><col style="width:100pt"><col style="width:19.5pt"><col style="width:22pt"><col style="width:198pt"></colgroup>\n' +
    '    <tr><td class="num">02</td><td class="tit" colspan="4">Registro de Exportação:</td><td></td><td class="num" style="height:15pt">03</td><td class="tit" style="height:15pt;font-family:Calibri,Carlito,Arial,sans-serif">N° do CE ou CEE (expediente)</td></tr>\n' +
    '    <tr><td colspan="2" style="height:16pt">MAWB</td><td class="lin" style="height:16pt">Nº <b>-</b></td><td style="height:16pt;text-align:right">HAWB</td><td class="lin" style="height:16pt">Nº <b>' + esc(dados.awb) + '</b></td><td style="height:16pt"></td><td colspan="2" style="height:16pt">CE ' + esc(dados.numeroCE) + '</td></tr>\n  </table>\n  <div class="esp"></div>\n' +
    '  <table style="width:489.5pt"><colgroup><col style="width:22pt"><col style="width:2.8pt"><col style="width:177.15pt"><col style="width:78pt"><col style="width:28.35pt"><col style="width:181.2pt"></colgroup>\n' +
    '    <tr><td class="num">04</td><td class="tit" colspan="3">Finalidade da Exportação:</td><td class="num">05</td><td class="tit">Classe do Produto:</td></tr>\n' +
    '    <tr><td style="height:22.65pt"></td><td style="height:22.65pt"></td><td class="lin" style="height:22.65pt">3 - PESQUISA CLÍNICA</td><td colspan="2" style="height:22.65pt"></td><td class="val" style="height:22.65pt">2 - MATERIAL BIOLÓGICO HUMANO</td></tr>\n  </table>\n  <div class="esp"></div>\n' +
    '  <table style="width:489.5pt"><colgroup><col style="width:22pt"><col style="width:2.8pt"><col style="width:453.6pt"><col style="width:11.1pt"></colgroup>\n' +
    '    <tr><td class="num">06</td><td class="tit" colspan="3">Nome do Destinatário:</td></tr>\n' +
    '    <tr><td style="height:22.25pt"></td><td style="height:22.25pt"></td><td class="lin" style="height:22.25pt">' + esc(val(lab.nomeCompleto)) + '</td><td style="height:22.25pt"></td></tr>\n  </table>\n  <div class="esp2"></div>\n' +
    tab(489.5, '<td class="num">07</td><td class="tit" style="width:467.5pt">Endereço do Destinatário:</td>') + '\n</div>\n';
  var pagina2 = '<div class="pag">\n  ' +
    tab(489.5, linha([[70.5, 'Rua/Avenida', L], [213.95, esc(val(lab.endereco)), V], [24.55, 'Nº', V], [34.8, '-', V], [69.35, 'Complemento', L], [76.35, '-', V]])) + '\n  <div class="esp"></div>\n  ' +
    tab(489.5, linha([[59, 'Bairro', L], [232, '-', V], [25.55, 'CEP', L]]) + transportePeticaoCelulasCep_(dados.cep)) + '\n  <div class="esp"></div>\n  ' +
    tab(489.5, linha([[59.1, 'Município', L], [232.4, esc(val(dados.cidade.municipio)), V], [25, 'UF', L], [173, esc(val(dados.cidade.uf)), V]])) + '\n  <div class="esp"></div>\n  ' +
    tab(489.5, linha([[30.85, 'DDD', L], [31.5, esc(dados.tel.ddd), V], [51, 'Telefone', L], [90.6, esc(dados.tel.numero), V], [30.85, 'DDD', L], [43.55, esc(dados.tel.ddd), V], [33.75, 'FAX', L], [177.4, esc(dados.tel.numero), V]])) + '\n  <div class="esp"></div>\n  ' +
    tab(489.5, linha([[138, 'Endereço eletrônico (e-mail)', V], [351.5, '-', V]])) + '\n  <div class="esp"></div><div class="esp2"></div>\n' +
    '  <table style="width:489.5pt"><colgroup><col style="width:22pt"><col style="width:151.95pt"><col style="width:227.4pt"><col style="width:88.15pt"></colgroup>\n' +
    '    <tr><td class="num">08</td><td class="tit" colspan="3">Descrição das Mercadorias Exportadas (<span class="vermelho">Quando possível preencher com todas as informações</span>)</td></tr>\n' +
    '    <tr><td class="cabec" colspan="2">Nome Produto ou matéria–prima</td><td class="cabec">Natureza da mercadoria /Estágio de Fabricação</td><td class="cabec">QUANTIDADE EXPORTADA</td></tr>\n    ' + itens + '\n  </table>\n  <div class="esp"></div>\n' +
    '  <div class="inst">\n    <p class="tt">Forma de preenchimento</p>\n    <p>Item 2 – Preencha como número do conhecimento de carga (MAWB ou HAWB);</p>\n' +
    '    <p>Item 3 – Preencha com o número do Comunicado especial (CE) ou do Comunicado especial específico (CEE) emitido pela ANVISA;</p>\n    <p>Item 4 – Preencha com a finalidade de importação;</p>\n' +
    '    <p>Item 5 – Preencha com a classe do produto;</p>\n    <p>Item 6 – Identificar com o nome completo do destinatário da carga/encomenda no exterior;</p>\n    <p>Item 7 – Preencher com o endereço completo do destinatário no exterior;</p>\n  </div>\n</div>\n';
  var pagina3 = '<div class="pag">\n  <div class="inst">\n' +
    '    <p>Item 8 – Descrever livremente da melhor forma possível cada item solicitado da característica do produto importado, separando-os por hífen; O estágio de fabricação encontra-se delimitado abaixo de Natureza do produto.</p>\n    <p>&nbsp;</p>\n' +
    '    <p class="tt">Classes de Produtos</p>\n    <ol><li>Células e tecidos;</li><li>Material biológico humano;</li><li>Produto de terapia avançada investigacional.</li></ol>\n' +
    '    <p class="tt">Finalidades de Exportação</p>\n    <ol><li>Diagnóstico laboratorial;</li><li>Pesquisa científica;</li><li>Pesquisa clínica;</li><li>Terapia avançada investigacional;</li></ol>\n' +
    '    <p class="tt">Natureza da mercadoria/Estágio de Fabricação</p>\n    <ol><li>Produto acabado;</li><li>Amostras.</li></ol>\n  </div>\n</div>\n';
  return '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>Petição de Fiscalização e Liberação Sanitária - Exportação</title>\n<style>\n' + estilo + '\n</style></head><body>\n' + pagina1 + pagina2 + pagina3 + '</body></html>';
}

/**
 * Gera o HTML do formulário a partir do registro. Com erros (sem AWB, sem N° do CE, courier sem razão social
 * ou CNPJ, mais de 6 materiais...) nao gera e explica. Avisos (ex.: laboratorio sem telefone) nao bloqueiam.
 */
function transportePeticaoGerar_(registro, fontes) {
  var dados = transportePeticaoDados_(registro, fontes);
  if (dados.erros.length) return { ok: false, erros: dados.erros, avisos: dados.avisos };
  return { ok: true, html: transportePeticaoHtml_(dados), avisos: dados.avisos, erros: [] };
}
