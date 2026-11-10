'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const ARQUIVO = readProjectFile('TransporteLayoutsDados.html');
const plano = (v) => JSON.parse(JSON.stringify(v));

function textoRico() {
  return {
    newTextStyle: () => {
      const e = { bold: null, italic: null, underline: null };
      const b = {
        setBold(v) { e.bold = v; return b; }, setItalic(v) { e.italic = v; return b; }, setUnderline(v) { e.underline = v; return b; },
        build: () => ({ isBold: () => e.bold, isItalic: () => e.italic, isUnderline: () => e.underline })
      };
      return b;
    },
    newRichTextValue: () => {
      let texto = '';
      const trechos = [];
      const b = {
        setText(t) { texto = t; return b; },
        setTextStyle(ini, fim, estilo) { trechos.push({ ini, fim, estilo }); return b; },
        build: () => ({
          getText: () => texto,
          getRuns: () => trechos.map((t) => ({ getTextStyle: () => t.estilo, getStartIndex: () => t.ini, getEndIndex: () => t.fim }))
        })
      };
      return b;
    }
  };
}

function formatDate(data, fuso, padrao) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, year: 'numeric', month: 'long', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(data).map((p) => [p.type, p.value]));
  const mes = String(new Intl.DateTimeFormat('en-US', { timeZone: fuso, month: '2-digit' }).format(data));
  return padrao.replace('MMMM', partes.month).replace('yyyy', partes.year).replace('MM', mes).replace('dd', partes.day)
    .replace('HH', partes.hour).replace('mm', partes.minute);
}

function servidor(book) {
  let locks = 0;
  let ativo = false;
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs',
    'TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteFolhaAgendamentoHtml.gs', 'TransporteLayoutsModelo.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone },
    SpreadsheetApp: textoRico(),
    LockService: { getDocumentLock: () => ({ tryLock: () => { locks++; ativo = true; return true; }, releaseLock() { ativo = false; } }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, getAll: () => ({}), putAll() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'PLANILHA-REAL', setProperty() {} }),
      getDocumentProperties: () => ({ getProperty: () => '' })
    }
  });
  s.Utilities = Object.assign({}, s.Utilities, { formatDate });
  s.getCodexSpreadsheet_ = () => book;
  s.getMedicos = () => [{ nome: 'Pessoa Investigadora', cpf: '000.000.000-00', cremers: '12345' }];
  s.transporteReadLabCentral_ = () => [{ nomeAbreviado: 'LAB X', nomeCompleto: 'Laboratorio Exemplo', endereco: 'Rua Exemplo 1', cidade: 'Cidade', pais: 'EUA' }];
  s.transporteReadAgendaCourierConfigs_ = () => ({ marken: { nome: 'MARKEN', empresa1: 'Courier Exemplo Ltda', cnpj1: '00.000.000/0001-00' } });
  s.transporteReadProjetosDireto_ = () => [{ nomeAbreviado: 'Estudo X', numeroCE: 'CE-1', expedienteCE: 'EXP-1', tituloCompleto: 'Titulo do Estudo X' }];
  s.locks = () => locks;
  s.lockAtivo = () => ativo;
  return s;
}

function registro(extra) {
  const materiais = Array(8).fill(null).map(() => ({}));
  materiais[1] = { ativo: true, material: 'Soro', tipo: 'soro', tubos: 2, formula: '2x1,0', total: 2, unit: 'mL' };
  return Object.assign({
    paciente: 'Pessoa Participante Teste', identificacaoParticipante: 'ID-001', protocolo: 'Estudo X',
    investigador: 'Pessoa Investigadora', temperatura: 'CONGELADO', dataColeta: '2026-11-05', dataEnvio: '2026-11-05',
    horaEnvio: '10:00', courier: 'MARKEN', destino: 'LAB X', awb: '123456789012', agendadoPor: 'Equipe',
    observacoes: '', materiais, solicitarCaixa: 'Sim'
  }, extra || {});
}

const CABECALHOS = ['Chave', 'Agenda_ID', 'Slot', 'Dados_JSON', 'Passo', 'Versao', 'Atualizado_Em', 'Atualizado_Por', 'Em_Preparo_Por', 'Em_Preparo_Desde'];

test('leitura nunca cria a aba nem altera o schema', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.equal(lido.existe, false);
  assert.equal(lido.versao, 0);
  assert.equal(lido.chave, 'ab12cd34|1');
  assert.deepEqual(Object.keys(book.sheets), []);
  book.sheets.Transporte_Registros = new FakeSheet('Transporte_Registros', [CABECALHOS]);
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').existe, false);
  assert.equal(book.sheets.Transporte_Registros.writes, 0);
});

test('gravar cria a aba, versiona e mantém envios diferentes em linhas separadas', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  const a = s.transporteRegistroGravar_('1417e053', '1', registro(), { versaoEsperada: 0, passo: 'conferir', usuario: 'a@example.invalid' });
  s.transporteEnvioReivindicar_('1417e053', '2', 'b@example.invalid', { agora: new Date('2026-11-09T10:00:00Z') });
  const b = s.transporteRegistroGravar_('1417e053', '2', registro({ courier: 'OCASA' }), {
    versaoEsperada: 0, usuario: 'b@example.invalid', agora: new Date('2026-11-09T10:00:00Z')
  });
  assert.deepEqual(plano([a.versao, b.versao, a.linha, b.linha]), [1, 1, 2, 3]);
  assert.equal(s.locks(), 3); // duas gravações + uma reivindicação
  const sheet = book.sheets.Transporte_Registros;
  assert.deepEqual(plano(sheet.rows[0]), CABECALHOS);
  const lidoA = s.transporteRegistroLer_('1417e053', '1');
  const lidoB = s.transporteRegistroLer_('1417e053', 'II');
  assert.equal(lidoA.passo, 'conferir');
  assert.equal(lidoA.atualizadoPor, 'a@example.invalid');
  assert.deepEqual(plano(lidoA.registro), plano(registro()));
  assert.equal(lidoB.registro.courier, 'OCASA');
  assert.equal(lidoB.emPreparoPor, 'b@example.invalid');
  // Segunda gravação do mesmo envio atualiza a linha; o preparo expirado de b não é herdado.
  const c = s.transporteRegistroGravar_('1417e053', '2', registro({ courier: 'OCASA', awb: '999' }), { versaoEsperada: 1, usuario: 'c@example.invalid', agora: new Date('2026-11-09T10:30:00Z') });
  assert.equal(c.versao, 2);
  assert.equal(c.linha, b.linha);
  const lidoC = s.transporteRegistroLer_('1417e053', '2');
  assert.equal(lidoC.registro.awb, '999');
  assert.equal(lidoC.emPreparoPor, ''); // preparo de b expirou (30 min sem sinal)
  assert.equal(sheet.rows.length, 3);
});

test('versão desatualizada é recusada dentro do lock e nada é gravado', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  s.transporteRegistroGravar_('ab12cd34', '1', registro(), { versaoEsperada: 0 });
  const escritas = book.sheets.Transporte_Registros.writes;
  for (const esperada of [0, 2]) {
    assert.throws(() => s.transporteRegistroGravar_('ab12cd34', '1', registro({ awb: 'X' }), { versaoEsperada: esperada }),
      (erro) => erro.code === 'TRANSPORTE_REGISTRO_VERSAO' && /alterado por outra pessoa/.test(erro.message));
  }
  assert.throws(() => s.transporteRegistroGravar_('ab12cd34', '1', registro(), {}), /Versão esperada/);
  assert.equal(book.sheets.Transporte_Registros.writes, escritas);
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').registro.awb, '123456789012');
});

test('registro acima de 50 mil caracteres é recusado antes de criar a aba', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  assert.throws(() => s.transporteRegistroGravar_('ab12cd34', '1', registro({ observacoes: 'x'.repeat(50001) }), { versaoEsperada: 0 }), /grande demais/);
  assert.deepEqual(Object.keys(book.sheets), []);
  s.transporteRegistroGravar_('ab12cd34', '1', registro({ observacoes: 'x'.repeat(40000) }), { versaoEsperada: 0 });
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').registro.observacoes.length, 40000);
});

test('cabeçalhos divergentes bloqueiam escrita e leitura sem alterar a aba; chave inválida é recusada', () => {
  const book = new FakeSpreadsheet({});
  const errado = CABECALHOS.slice(); errado[3] = 'Outro';
  book.sheets.Transporte_Registros = new FakeSheet('Transporte_Registros', [errado, ['k|1', 'k', '1', '{}', '', 1]]);
  const s = servidor(book);
  assert.throws(() => s.transporteRegistroGravar_('k', '1', registro(), { versaoEsperada: 1 }), /incompatíveis/);
  assert.throws(() => s.transporteRegistroLer_('k', '1'), /incompatíveis/);
  assert.equal(book.sheets.Transporte_Registros.writes, 0);
  assert.throws(() => s.transporteRegistroChave_('', '1'), /ID da Agenda/);
  assert.throws(() => s.transporteRegistroChave_('a|b', '1'), /ID da Agenda/);
  assert.throws(() => s.transporteRegistroChave_('abc', 'zzz'), /Slot de transporte inválido/);
});

test('documentos dos 5 couriers saem do registro gravado sem abrir a planilha de Transporte', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  let aberturas = 0;
  s.SpreadsheetApp.openById = () => { aberturas++; throw new Error('planilha real'); };
  s.getTransporteSpreadsheetCodex_ = () => { aberturas++; throw new Error('planilha de Transporte'); };
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  const casos = [
    ['MARKEN', {}], ['OCASA', {}], ['DHL', { temperatura: 'AMBIENTE' }],
    ['PINEX', { pinexColeta: '78429', pinexAwb: '123456789012' }],
    ['PINEX (Agendamento)', { responsavelEntrega: 'Pessoa Entregadora' }]
  ];
  casos.forEach(([courier, extra], indice) => {
    s.transporteRegistroGravar_('ab12cd3' + indice, '1', registro(Object.assign({ courier }, extra)), { versaoEsperada: 0 });
    const dados = s.transporteRegistroDocsDados_('ab12cd3' + indice, '1', { arquivo });
    assert.equal(dados.ss.problemas_.length, 0, courier + ': ' + dados.ss.problemas_.join('; '));
    const spec = s.transportePdfSpec_(courier, extra.temperatura || 'CONGELADO', 'LAB X', dados.ss);
    assert.ok(spec.ordem.length >= 1, courier);
    assert.ok(Object.keys(dados.abas(spec.ordem)).length >= 1, courier);
  });
  assert.equal(aberturas, 0);
  assert.equal(s.TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_, 0);
  assert.throws(() => s.transporteRegistroDocsDados_('inexistente', '1', { arquivo }), /não encontrado/);
});
