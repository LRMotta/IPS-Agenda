'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const MED = '💊 Medicamentos';

function item(id, data, projeto, nf, remetente, movimento, descricao) {
  return [id, new Date(data + 'T12:00:00Z'), projeto, movimento ? 'Sim' : 'Não', nf, remetente, movimento, descricao, 1, 'L1', '', 'Resp', 'Farmácia', '', '', 'quem@ucs.br'];
}

function setup(rows, metaRows, extra) {
  const effects = { drafts: [], files: [], props: {}, scriptProps: {}, audit: [] };
  const server = runFiles(['WebApp.gs', 'FarmaciaEstoque.gs', 'MedicamentosNotasFiscais.gs'], Object.assign({
    Date,
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: {
      formatDate: (date) => date.toISOString().slice(0, 10),
      base64Decode: (text) => Array.from(Buffer.from(text, 'base64')),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name })
    },
    PropertiesService: { getUserProperties: () => ({
      getProperty: (k) => effects.props[k] || null,
      setProperty: (k, v) => { effects.props[k] = v; }
    }), getScriptProperties: () => ({ getProperty: (k) => effects.scriptProps[k] || null }) }
  }, extra || {}));
  const medSheet = new FakeSheet(MED, [Array.from(server.MEDICAMENTOS_HEADERS_), ...rows]);
  const sheets = { [MED]: medSheet };
  if (metaRows) sheets.Medicamentos_NF = new FakeSheet('Medicamentos_NF', [Array.from(server.MED_NF_HEADERS_), ...metaRows]);
  const ss = new FakeSpreadsheet(sheets);
  server.getCodexSpreadsheet_ = () => ss;
  // Notas de medicamentos ficam na Farmácia: o perfil padrão é o de Farmacêutico(a).
  server.codexAssertCanRead_ = () => Object.assign({ ok: true, farmaciaAccess: 'manage', farmaciaCommonAccess: 'manage', farmaciaAllStudies: true, farmaciaStudies: [] }, effects.access);
  server.codexWriteAuditLog_ = (action, modulo, id) => { effects.audit.push([action, modulo, id]); };
  server.codexAssertCanWrite_ = (action, modulo, id) => { effects.audit.push([action, modulo, id]); return { ok: true }; };
  server.codexWithDocumentLock_ = (label, fn) => fn();
  server.getUsuarioEmail = () => 'samya@ucs.br';
  server.getGmailSignature = () => '<b>Assinatura</b>';
  server.getConfigAppValuesByKeys_ = () => [];
  return { server, ss, medSheet, effects };
}

const BASE = [
  item('M1', '2026-09-16', 'STAR-121', '000192726', 'Thermo Fisher Brasil - Logistica ', '0094', 'Zimberelimab'),
  item('M2', '2026-09-16', 'STAR-121', '192726', 'THERMO FISHER S BRASIL - LOGISTICA', '0094', 'Domvalimab'),
  item('M3', '2026-04-17', 'P1', '36510', 'Pharmaceutical Research Associates LTDA', '1677', 'A'),
  item('M4', '2026-09-25', 'P2', '36510', 'ISP- Innovative Solutions Pharma LTDA', '605', 'B'),
  item('M5', '2026-11-13', 'lidERA', '96517', 'Produtos Roche', '', 'Anastrozole'),
  item('M6', '2026-11-13', 'lidERA', '96517', 'Produtos Roche', '', 'Letrozol'),
  item('M7', '2026-10-01', 'P3', '40562', 'Innovative Solutions Pharma LTDA', '611', 'C'),
  item('M8', '2026-10-01', 'P3', '40562', 'ISP- INNOVATIVE SOLUTIONS PHARMA LTDA', '611', 'D'),
  item('M9', '2026-10-02', 'P3', '', 'Sem NF', '', 'Sem nota')
];

test('agrupa itens por NF + remetente, sem zeros à esquerda e com variações de digitação', () => {
  const { server } = setup(BASE);
  assert.equal(server.medNfChave_('000192726', 'Thermo Fisher Brasil'), '192726|THERMO');
  assert.equal(server.medNfChave_('40562', 'ISP- Innovative Solutions'), server.medNfChave_('40562', 'Innovative Solutions'));
  assert.notEqual(server.medNfChave_('36510', 'ISP- Innovative'), server.medNfChave_('36510', 'Pharmaceutical Research'));
  const notas = Array.from(server.getMedicamentosNotasFiscais().notas);
  const porChave = Object.fromEntries(notas.map((n) => [n.chave, n]));
  assert.equal(notas.length, 5, 'linha sem NF fica fora');
  assert.equal(porChave['192726|THERMO'].itens.length, 2);
  assert.equal(porChave['192726|THERMO'].movimentoRm, '0094');
  assert.equal(porChave['192726|THERMO'].situacao, 'falta_pdf');
  assert.equal(porChave['36510|PHARMACEUTICAL'].movimentoRm, '1677');
  assert.equal(porChave['36510|INNOVATIVE'].movimentoRm, '605');
  assert.equal(porChave['40562|INNOVATIVE'].itens.length, 2);
  assert.equal(porChave['96517|PRODUTOS'].situacao, 'rm_pendente');
  assert.equal(notas[0].chave, '96517|PRODUTOS', 'mais recentes primeiro');
});

test('situação considera PDF, envio e movimentos divergentes; leitura não cria a aba de controle', () => {
  const rows = [
    item('A', '2026-10-01', 'P', '1', 'X', '10', 'a'),
    item('B', '2026-10-01', 'P', '2', 'X', '11', 'b'),
    item('C', '2026-10-01', 'P', '3', 'X', '12', 'c'),
    item('D', '2026-10-01', 'P', '4', 'X', '13', 'd'),
    item('E', '2026-10-01', 'P', '4', 'X', '14', 'e')
  ];
  const meta = [
    ['2|X', '2', 'X', 'pdf2', 'NF 2.pdf', new Date(), 'a@ucs.br', '', '', '', '', ''],
    ['3|X', '3', 'X', 'pdf3', 'NF 3.pdf', new Date(), 'a@ucs.br', new Date(), 'a@ucs.br', 'r1', '', '']
  ];
  const { server, ss } = setup(rows, meta);
  const notas = Object.fromEntries(Array.from(server.getMedicamentosNotasFiscais().notas).map((n) => [n.chave, n]));
  assert.equal(notas['1|X'].situacao, 'falta_pdf');
  assert.equal(notas['2|X'].situacao, 'pronta');
  assert.equal(notas['3|X'].situacao, 'concluida');
  assert.equal(notas['4|X'].movimentosDivergentes, true);
  assert.equal(notas['4|X'].movimentoRm, '');
  const vazio = setup(rows);
  vazio.server.getMedicamentosNotasFiscais();
  assert.equal(vazio.ss.getSheetByName('Medicamentos_NF'), null);
  assert.ok(ss.getSheetByName('Medicamentos_NF'));
});

test('movimento RM grava em todos os itens da nota e recusa lista desatualizada', () => {
  const { server, medSheet, effects } = setup(BASE);
  const r = server.salvarMovimentoRmNotaFiscal({ chave: '96517|PRODUTOS', movimentoRm: '620', movimentosAtuais: '' });
  assert.equal(r.itens, 2);
  for (const row of [6, 7]) {
    assert.equal(medSheet.rows[row - 1][3], 'Sim');
    assert.equal(medSheet.rows[row - 1][6], '620');
  }
  assert.equal(medSheet.rows[1][6], '0094', 'outras notas intactas');
  assert.deepEqual(effects.audit[0], ['salvarMovimentoRmNotaFiscal', 'Farmácia', '96517|PRODUTOS']);
  assert.throws(() => server.salvarMovimentoRmNotaFiscal({ chave: '96517|PRODUTOS', movimentoRm: '621', movimentosAtuais: '' }), /mudou/);
  assert.throws(() => server.salvarMovimentoRmNotaFiscal({ chave: '96517|PRODUTOS', movimentoRm: ' ', movimentosAtuais: '620' }), /Informe/);
  assert.throws(() => server.salvarMovimentoRmNotaFiscal({ chave: '1|X', movimentoRm: '1', movimentosAtuais: '' }), /não foi encontrada/);
});

test('anexar PDF valida o conteúdo e registra o arquivo da nota', () => {
  const created = [];
  const folder = { createFile: (blob) => { created.push(blob); return { getId: () => 'file-1', getName: () => blob.name }; } };
  const { server, ss } = setup(BASE, null, {
    DriveApp: { getRootFolder: () => ({ getFoldersByName: () => ({ hasNext: () => true, next: () => folder }) }) }
  });
  assert.throws(() => server.anexarPdfNotaFiscal({ chave: '192726|THERMO', conteudoBase64: Buffer.from('nao pdf').toString('base64') }), /não é um PDF/);
  assert.equal(created.length, 0);
  const r = server.anexarPdfNotaFiscal({ chave: '192726|THERMO', conteudoBase64: Buffer.from('%PDF-1.4 teste').toString('base64') });
  assert.equal(r.pdfId, 'file-1');
  assert.equal(created[0].mime, 'application/pdf');
  assert.match(created[0].name, /^NF 000192726 - Thermo Fisher/);
  const meta = ss.getSheetByName('Medicamentos_NF').rows;
  assert.deepEqual(meta[0], Array.from(server.MED_NF_HEADERS_));
  assert.equal(meta[1][0], '192726|THERMO');
  assert.equal(meta[1][3], 'file-1');
  const nota = Array.from(server.getMedicamentosNotasFiscais().notas).find((n) => n.chave === '192726|THERMO');
  assert.equal(nota.situacao, 'pronta');
});

test('pasta dos PDFs: Config_App prevalece, depois a propriedade do script, depois o Meu Drive', () => {
  const abertas = [];
  const drive = {
    getFolderById: (id) => { abertas.push(id); return { id }; },
    getRootFolder: () => ({ getFoldersByName: () => ({ hasNext: () => true, next: () => ({ id: 'raiz' }) }) })
  };
  const { server, effects } = setup(BASE, null, { DriveApp: drive });
  assert.equal(server.medNfPastaDestino_().id, 'raiz');
  effects.scriptProps.MED_NF_PASTA_ID = 'https://drive.google.com/drive/folders/13RQvz2lP7BcIHER5U0FW2Bp-pcmnSMIJ?usp=drive_link';
  assert.equal(server.medNfPastaDestino_().id, '13RQvz2lP7BcIHER5U0FW2Bp-pcmnSMIJ');
  server.getConfigAppValuesByKeys_ = () => ['1AbCdEfGhIjKlMnOpQr'];
  assert.equal(server.medNfPastaDestino_().id, '1AbCdEfGhIjKlMnOpQr');
  effects.scriptProps.MED_NF_PASTA_ID = 'pasta';
  server.getConfigAppValuesByKeys_ = () => [];
  assert.throws(() => server.medNfPastaDestino_(), /inválida/);
});

test('preparar e-mail cria só rascunho, com cópia fixa, movimentos e PDFs, e marca as notas', () => {
  const meta = [
    ['192726|THERMO', '192726', 'Thermo', 'pdf-a', 'a.pdf', new Date(), 'x', '', '', '', '', ''],
    ['36510|INNOVATIVE', '36510', 'ISP', 'pdf-b', 'b.pdf', new Date(), 'x', '', '', '', '', '']
  ];
  const drafts = [];
  const blob = (id) => ({ id, name: '', getBytes: () => [1, 2, 3], setName(n) { this.name = n; return this; } });
  const { server, ss, effects } = setup(BASE, meta, {
    DriveApp: { getFileById: (id) => ({ getBlob: () => blob(id) }) },
    GmailApp: {
      createDraft: (to, subject, body, options) => { drafts.push({ to, subject, body, options }); return { getId: () => 'draft-1' }; },
      sendEmail: () => { throw new Error('não deve enviar'); }
    }
  });
  assert.throws(() => server.prepararEmailNotasFiscais({ chaves: ['96517|PRODUTOS'], destinatarios: 'a@ucs.br' }), /movimento RM único e PDF/);
  assert.throws(() => server.prepararEmailNotasFiscais({ chaves: ['192726|THERMO'], destinatarios: 'ips@ucs.br' }), /além de ips@ucs.br/);
  assert.equal(drafts.length, 0);
  const r = server.prepararEmailNotasFiscais({ chaves: ['192726|THERMO', '36510|INNOVATIVE'], destinatarios: 'Financeiro@ucs.br; ips@ucs.br' });
  assert.equal(r.draftId, 'draft-1');
  assert.equal(drafts.length, 1);
  const d = drafts[0];
  assert.equal(d.to, 'financeiro@ucs.br');
  assert.equal(d.options.cc, 'ips@ucs.br');
  assert.equal(d.subject, 'IPS - NOTAS FISCAIS - REMESSA MEDICAMENTOS');
  assert.match(d.body, /NF 000192726 - Movimento 0094\nNF 36510 - Movimento 605/);
  assert.match(d.options.htmlBody, /<p>Olá,<\/p>/);
  assert.doesNotMatch(d.options.htmlBody + d.body, /Ester/);
  assert.match(d.options.htmlBody, /Assinatura/);
  assert.deepEqual(d.options.attachments.map((a) => [a.id, a.name]), [['pdf-a', 'NF 000192726.pdf'], ['pdf-b', 'NF 36510.pdf']]);
  assert.equal(effects.props.MED_NF_ULTIMOS_DESTINATARIOS, 'financeiro@ucs.br');
  const rows = ss.getSheetByName('Medicamentos_NF').rows;
  assert.equal(rows.length, 3);
  assert.ok(rows[1][7] instanceof Date);
  assert.equal(rows[1][9], 'draft-1');
  const notas = Object.fromEntries(Array.from(server.getMedicamentosNotasFiscais().notas).map((n) => [n.chave, n]));
  assert.equal(notas['192726|THERMO'].situacao, 'concluida');
});

test('preparar e-mail recusa anexos acima do limite do Gmail antes de criar o rascunho', () => {
  const meta = [['192726|THERMO', '192726', 'Thermo', 'pdf-a', 'a.pdf', new Date(), 'x', '', '', '', '', '']];
  let created = 0;
  const { server } = setup(BASE, meta, {
    DriveApp: { getFileById: () => ({ getBlob: () => ({ getBytes: () => ({ length: 19 * 1024 * 1024 }), setName() { return this; } }) }) },
    GmailApp: { createDraft: () => { created++; return { getId: () => 'x' }; } }
  });
  assert.throws(() => server.prepararEmailNotasFiscais({ chaves: ['192726|THERMO'], destinatarios: 'a@ucs.br' }), /duas partes/);
  assert.equal(created, 0);
});

test('marcar como enviadas exige movimento RM e grava data e responsável', () => {
  const { server, ss } = setup(BASE);
  assert.throws(() => server.marcarNotasFiscaisEnviadas({ chaves: ['96517|PRODUTOS'] }), /Informe o movimento RM/);
  assert.equal(ss.getSheetByName('Medicamentos_NF'), null);
  const r = server.marcarNotasFiscaisEnviadas({ chaves: ['192726|THERMO', '192726|THERMO', '40562|INNOVATIVE'] });
  assert.equal(r.quantidade, 2);
  const rows = ss.getSheetByName('Medicamentos_NF').rows;
  assert.equal(rows.length, 3);
  assert.ok(rows[1][10] instanceof Date);
  assert.equal(rows[1][11], 'samya@ucs.br');
  assert.throws(() => server.marcarNotasFiscaisEnviadas({ chaves: ['x'] }), /inválida/);
});

test('tela usa somente RPCs públicas existentes e mantém o rótulo genérico do e-mail', () => {
  const script = readProjectFile('IndexMedicamentosNfScripts.html');
  const server = readProjectFile('MedicamentosNotasFiscais.gs');
  for (const rpc of ['getMedicamentosNotasFiscais', 'getEquipamentosNotasFiscais', 'salvarMovimentoRmNotaFiscal', 'anexarPdfNotaFiscal', 'prepararEmailNotasFiscais', 'marcarNotasFiscaisEnviadas']) {
    assert.match(script, new RegExp("method: '" + rpc + "'"));
    assert.match(server, new RegExp('^function ' + rpc + '\\(', 'm'));
  }
  assert.match(readProjectFile('Index.html'), /include\('IndexCoreScripts'\); \?>\r?\n<\?!= include\('IndexMedicamentosNfScripts'\)/);
  const content = readProjectFile('IndexContentAfterDashboard.html') + readProjectFile('IndexContentAfterStock.html');
  assert.match(content, /Preparar e-mail/);
  assert.doesNotMatch(content + script, /Ester/);
});

const EQP = '🖥️ Equipamentos';

function equip(id, data, projeto, nf, remetente, movimento, descricao, serie) {
  return [id, new Date(data + 'T12:00:00Z'), projeto, 'Sim', movimento ? 'Sim' : 'Não', nf, remetente, movimento, 'TOTVS-1', descricao, 1, serie, 'Resp', 'Sala 1', '', '', '', 'quem@ucs.br'];
}

const EQ_BASE = [
  equip('E1', '2026-11-10', 'STAR-121', '000555', 'Fisher Clinical Services', '', 'Centrífuga', 'SN-1'),
  equip('E2', '2026-11-10', 'STAR-121', '555', 'FISHER CLINICAL', '', 'Freezer', 'SN-2'),
  equip('E3', '2026-11-01', 'P1', '777', 'Marken', '900', 'Tablet', 'SN-3'),
  equip('E4', '2026-11-01', 'P1', '', 'Sem NF', '', 'Sem nota', 'SN-4')
];

function setupEq(rows, extra) {
  const ctx = setup([], null, extra);
  const eqSheet = new FakeSheet(EQP, [Array.from(ctx.server.EQUIPAMENTOS_HEADERS_), ...rows]);
  ctx.ss.sheets[EQP] = eqSheet;
  return Object.assign(ctx, { eqSheet });
}

test('equipamentos: notas agrupadas da aba de equipamentos, com série nos itens e controle próprio', () => {
  const { server, ss } = setupEq(EQ_BASE);
  const notas = Array.from(server.getEquipamentosNotasFiscais().notas);
  assert.deepEqual(notas.map((n) => n.chave), ['555|FISHER', '777|MARKEN']);
  assert.equal(notas[0].itens.length, 2);
  assert.equal(notas[0].itens[0].serie, 'SN-1');
  assert.equal(notas[0].situacao, 'rm_pendente');
  assert.equal(notas[1].movimentoRm, '900');
  assert.equal(Array.from(server.getMedicamentosNotasFiscais().notas).length, 0, 'medicamentos não misturam equipamentos');
  assert.equal(ss.getSheetByName('Equipamentos_NF'), null, 'leitura não cria a aba de controle');
  assert.throws(() => server.marcarNotasFiscaisEnviadas({ tipo: 'outro', chaves: ['777|MARKEN'] }), /Tipo de nota fiscal inválido/);
});

test('equipamentos: movimento RM grava nas colunas de Registro no RM e Movimento da aba de equipamentos', () => {
  const { server, eqSheet } = setupEq(EQ_BASE);
  const r = server.salvarMovimentoRmNotaFiscal({ tipo: 'equipamentos', chave: '555|FISHER', movimentoRm: '1200', movimentosAtuais: '' });
  assert.equal(r.itens, 2);
  for (const row of [2, 3]) {
    assert.equal(eqSheet.rows[row - 1][4], 'Sim');
    assert.equal(eqSheet.rows[row - 1][7], '1200');
    assert.equal(eqSheet.rows[row - 1][3], 'Sim', 'Cadastro na UCS intacto');
  }
  assert.equal(eqSheet.rows[3][7], '900', 'outras notas intactas');
  assert.throws(() => server.salvarMovimentoRmNotaFiscal({ chave: '555|FISHER', movimentoRm: '1', movimentosAtuais: '' }), /não foi encontrada/, 'sem tipo vale Medicamentos');
});

test('equipamentos: PDF vai para a pasta própria e o e-mail usa assunto e texto de equipamentos', () => {
  const abertas = [];
  const created = [];
  const drafts = [];
  const blob = (id) => ({ id, name: '', getBytes: () => [1], setName(n) { this.name = n; return this; } });
  const { server, ss, effects } = setupEq(EQ_BASE, {
    DriveApp: {
      getFolderById: (id) => { abertas.push(id); return { createFile: (b) => { created.push(b); return { getId: () => 'eq-file', getName: () => b.name }; } }; },
      getFileById: (id) => ({ getBlob: () => blob(id) })
    },
    GmailApp: { createDraft: (to, subject, body, options) => { drafts.push({ to, subject, body, options }); return { getId: () => 'draft-eq' }; } }
  });
  effects.scriptProps.MED_NF_PASTA_ID = '13RQvz2lP7BcIHER5U0FW2Bp-pcmnSMIJ';
  effects.scriptProps.EQP_NF_PASTA_ID = 'https://drive.google.com/drive/folders/1OmuqRoLrEiOeQfuh5DHokFreMuTVTguX?usp=drive_link';
  const grupos = [];
  server.getConfigAppValuesByKeys_ = (g) => { grupos.push(g[0]); return []; };
  server.anexarPdfNotaFiscal({ tipo: 'equipamentos', chave: '777|MARKEN', conteudoBase64: Buffer.from('%PDF-1.4').toString('base64') });
  assert.deepEqual(abertas, ['1OmuqRoLrEiOeQfuh5DHokFreMuTVTguX']);
  assert.deepEqual(grupos, ['Equipamentos']);
  assert.match(created[0].name, /^NF 777 - Marken/);
  assert.equal(ss.getSheetByName('Medicamentos_NF'), null);
  const meta = ss.getSheetByName('Equipamentos_NF').rows;
  assert.deepEqual(meta[0], Array.from(server.MED_NF_HEADERS_));
  assert.equal(meta[1][3], 'eq-file');

  server.prepararEmailNotasFiscais({ tipo: 'equipamentos', chaves: ['777|MARKEN'], destinatarios: 'financeiro@ucs.br' });
  const d = drafts[0];
  assert.equal(d.subject, 'IPS - NOTAS FISCAIS - REMESSA EQUIPAMENTOS');
  assert.equal(d.options.cc, 'ips@ucs.br');
  assert.match(d.body, /notas fiscais de equipamentos recebidos/);
  assert.match(d.body, /NF 777 - Movimento 900/);
  assert.equal(effects.props.EQP_NF_ULTIMOS_DESTINATARIOS, 'financeiro@ucs.br');
  assert.equal(effects.props.MED_NF_ULTIMOS_DESTINATARIOS, undefined);
  const nota = Array.from(server.getEquipamentosNotasFiscais().notas).find((n) => n.chave === '777|MARKEN');
  assert.equal(nota.situacao, 'concluida');
});

function ledgerRow(id, type, studyId, restricted, data) {
  return [id, type, JSON.stringify(studyId), restricted, 'request-' + id.toLowerCase() + '-0001', JSON.stringify('2026-11-20T12:00:00.000Z'), JSON.stringify('farm@ucs.br'), JSON.stringify(data)];
}
function receipt(id, restricted, number, sender, extra) {
  return ledgerRow(id, 'RECEIPT', 'P1', restricted, Object.assign({ productId: restricted ? 'FPR-R' : 'FPR-1', lot: 'LT-' + id, expiry: '2027-01-31', location: 'A', kit: '', physical: 5,
    receivedOn: '2026-11-20', document: 'DOC', note: '', invoice: { number, sender, unitValue: 10.5 } }, extra || {}));
}
function setupFarmacia(rows, ledger, metaRows) {
  const ctx = setup(rows, metaRows);
  ctx.ss.sheets.Projetos = new FakeSheet('Projetos', [['ID', 'Nome', 'Código'], ['P1', 'Estudo Um', 'E1']]);
  const name = ctx.server.farmaciaLedgerSheetName_('P1');
  ctx.ss.sheets[name] = new FakeSheet(name, [Array.from(ctx.server.FARMACIA_LEDGER_HEADERS_),
    ledgerRow('FPR-1', 'PRODUCT', 'P1', false, { name: 'Droga A', presentation: 'Comprimido 10 mg', unit: 'comprimido' }),
    ledgerRow('FPR-R', 'PRODUCT', 'P1', true, { name: 'Droga cega', presentation: 'Frasco', unit: 'frasco' }),
    ...ledger]);
  return ctx;
}

test('farmácia: recebimentos com nota entram na lista, juntam com o Cadastro pela mesma NF e o RM vale para os dois', () => {
  const legado = [item('M1', '2026-09-16', 'STAR-121', '777', 'Marken Ltda', '', 'Item antigo')];
  const { server, ss, medSheet, effects } = setupFarmacia(legado, [receipt('FRC-1', false, '000777', 'MARKEN LOGISTICA'), receipt('FRC-2', false, '888', 'Almac'), receipt('FRC-3', false, '', '')],
    [['777|MARKEN', '777', 'Marken Ltda', '', '', '', '', '', '', '', '', '']]);
  const notas = Array.from(server.getMedicamentosNotasFiscais().notas);
  assert.equal(notas.length, 2, 'recebimento sem número fica fora');
  const marken = notas.find((n) => n.chave === '777|MARKEN'), almac = notas.find((n) => n.chave === '888|ALMAC');
  assert.equal(marken.itens.length, 2); assert.equal(marken.itensCadastro, 1); assert.equal(marken.itensFarmacia, 1);
  assert.equal(almac.itens[0].descricao, 'Droga A · Comprimido 10 mg'); assert.equal(almac.itens[0].valorUnitario, 10.5);
  assert.equal(almac.projetos[0], 'Estudo Um'); assert.equal(almac.dataRecebimento, '20/11/2026');
  assert.equal(almac.situacao, 'rm_pendente'); assert.equal(almac.restrita, false);
  server.salvarMovimentoRmNotaFiscal({ chave: '777|MARKEN', movimentoRm: '5001', movimentosAtuais: '' });
  assert.equal(medSheet.rows[1][6], '5001');
  const meta = ss.getSheetByName('Medicamentos_NF');
  assert.equal(meta.rows[0][12], 'Movimento_RM', 'aba antiga recebe o cabeçalho novo');
  assert.equal(meta.rows[1][12], '5001');
  const depois = Array.from(server.getMedicamentosNotasFiscais().notas).find((n) => n.chave === '777|MARKEN');
  assert.equal(depois.movimentoRm, '5001'); assert.equal(depois.situacao, 'falta_pdf');
  server.salvarMovimentoRmNotaFiscal({ chave: '888|ALMAC', movimentoRm: '5002', movimentosAtuais: '' });
  assert.equal(Array.from(server.getMedicamentosNotasFiscais().notas).find((n) => n.chave === '888|ALMAC').movimentoRm, '5002');
  assert.throws(() => server.salvarMovimentoRmNotaFiscal({ chave: '888|ALMAC', movimentoRm: '5003', movimentosAtuais: '' }), /mudou/);
  assert.equal(effects.audit.at(-1)[1], 'Farmácia');
});

test('farmácia: nota com item da classe restrita só aparece para quem tem a concessão restrita do estudo, e inteira', () => {
  const legado = [item('M1', '2026-09-16', 'P1', '999', 'Marken', '', 'Item antigo')];
  const { server, effects } = setupFarmacia(legado, [receipt('FRC-1', true, '999', 'Marken'), receipt('FRC-2', true, '555', 'Fisher'), receipt('FRC-3', false, '444', 'Almac')]);
  let chaves = Array.from(server.getMedicamentosNotasFiscais().notas).map((n) => n.chave).sort();
  assert.deepEqual(chaves, ['444|ALMAC'], 'sem concessão restrita: some a nota restrita e a nota mista');
  assert.throws(() => server.salvarMovimentoRmNotaFiscal({ chave: '555|FISHER', movimentoRm: '1', movimentosAtuais: '' }), /não foi encontrada/);
  effects.access = { farmaciaStudies: [{ studyId: 'P1', restricted: true }] };
  const notas = Array.from(server.getMedicamentosNotasFiscais().notas);
  assert.equal(notas.length, 3);
  assert.equal(notas.find((n) => n.chave === '999|MARKEN').restrita, true);
  assert.equal(notas.find((n) => n.chave === '999|MARKEN').itens.length, 2);
  assert.equal(notas.find((n) => n.chave === '444|ALMAC').restrita, false);
});

test('farmácia: quem não acessa a Farmácia não lista nem altera notas de medicamentos; equipamentos seguem no Cadastro', () => {
  const { server, effects } = setupFarmacia([], [receipt('FRC-1', false, '444', 'Almac')]);
  effects.access = { farmaciaAccess: 'none', farmaciaCommonAccess: 'none', farmaciaAllStudies: false };
  assert.throws(() => server.getMedicamentosNotasFiscais(), /notas fiscais da Farmácia/);
  assert.throws(() => server.salvarMovimentoRmNotaFiscal({ chave: '444|ALMAC', movimentoRm: '1', movimentosAtuais: '' }), /notas fiscais da Farmácia/);
  assert.equal(effects.audit.length, 0);
  effects.access = { farmaciaAccess: 'read', farmaciaCommonAccess: 'read' };
  assert.equal(Array.from(server.getMedicamentosNotasFiscais().notas).length, 1);
  assert.throws(() => server.marcarNotasFiscaisEnviadas({ chaves: ['444|ALMAC'] }), /notas fiscais da Farmácia/);
  effects.access = { farmaciaAccess: 'none', farmaciaCommonAccess: 'none', farmaciaAllStudies: false };
  assert.equal(Array.from(server.getEquipamentosNotasFiscais().notas).length, 0);
});

test('farmácia: nota informada ou corrigida depois do recebimento move o item para a nota nova', () => {
  const { server } = setupFarmacia([], [receipt('FRC-1', false, '', ''), receipt('FRC-2', false, '111', 'Almac'),
    ledgerRow('FNF-1', 'RECEIPT_INVOICE', 'P1', false, { receiptId: 'FRC-1', invoice: { number: '900', sender: 'Marken', unitValue: 2 }, reason: 'Chegou depois' }),
    ledgerRow('FNF-2', 'RECEIPT_INVOICE', 'P1', false, { receiptId: 'FRC-2', invoice: { number: '112', sender: 'Almac', unitValue: 3 }, reason: 'Número errado' })]);
  const chaves = Array.from(server.getMedicamentosNotasFiscais().notas).map((n) => n.chave).sort();
  assert.deepEqual(chaves, ['112|ALMAC', '900|MARKEN']);
});
