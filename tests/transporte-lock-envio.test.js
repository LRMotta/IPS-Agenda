'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

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

function servidor(book) {
  let locks = 0;
  let ativo = false;
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs',
    'TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteFolhaAgendamentoHtml.gs', 'TransporteLayoutsModelo.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    SpreadsheetApp: textoRico(),
    LockService: { getDocumentLock: () => ({ tryLock: () => { locks++; ativo = true; return true; }, releaseLock() { ativo = false; } }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, getAll: () => ({}), putAll() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => 'PLANILHA-REAL', setProperty() {} }),
      getDocumentProperties: () => ({ getProperty: () => '' })
    }
  });
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

const T0 = new Date('2026-11-09T10:00:00Z');
const mais = (minutos) => new Date(T0.getTime() + minutos * 60000);
const A = 'a@example.invalid';
const B = 'b@example.invalid';

test('preparo: uma pessoa por envio, envios diferentes em paralelo e expiração', () => {
  const s = servidor(new FakeSpreadsheet({}));
  assert.deepEqual(plano(s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: T0 })), { ok: true, versao: 0, assumiu: true });
  const recusa = s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: mais(1) });
  assert.equal(recusa.ok, false);
  assert.equal(recusa.emPreparoPor, A);
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '2', B, { agora: mais(1) }).ok, true);
  // Renovar (e-mail com outra caixa) mantém o dono e não muda a versão dos dados.
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '1', 'A@Example.Invalid', { agora: mais(10) }).assumiu, false);
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: mais(24) }).ok, false);
  const assumiu = s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: mais(26) });
  assert.deepEqual([assumiu.ok, assumiu.assumiu], [true, true]);
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').emPreparoPor, B);
});

test('gravar exige o dono do preparo, renova o sinal e não grava quando recusa', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: T0 });
  const vazio = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([vazio.existe, vazio.registro, vazio.versao], [true, null, 0]);
  assert.throws(() => s.transporteRegistroDocsDados_('ab12cd34', '1', {}), /não encontrado/);
  const escritas = book.sheets.Transporte_Registros.writes;
  assert.throws(() => s.transporteRegistroGravar_('ab12cd34', '1', registro(), { versaoEsperada: 0, usuario: B, agora: mais(5) }),
    (erro) => erro.code === 'TRANSPORTE_REGISTRO_EM_PREPARO' && erro.emPreparoPor === A);
  assert.equal(book.sheets.Transporte_Registros.writes, escritas);
  const a = s.transporteRegistroGravar_('ab12cd34', '1', registro(), { versaoEsperada: 0, usuario: A, agora: mais(8) });
  assert.equal(a.versao, 1);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.equal(lido.emPreparoPor, A);
  assert.equal(lido.emPreparoDesde, mais(8).toISOString());
  // Com o sinal renovado em +8 min, B ainda não assume em +20; em +24 o preparo expirou.
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: mais(20) }).ok, false);
  assert.throws(() => s.transporteRegistroGravar_('ab12cd34', '1', registro({ awb: 'X' }), { versaoEsperada: 1, usuario: B, agora: mais(20) }), /preparado por outra pessoa/);
  const b = s.transporteRegistroGravar_('ab12cd34', '1', registro({ awb: 'X' }), { versaoEsperada: 1, usuario: B, agora: mais(24) });
  assert.equal(b.versao, 2);
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').emPreparoPor, '');
  // A, sem preparo e com versão antiga, é recusada pela versão.
  assert.throws(() => s.transporteRegistroGravar_('ab12cd34', '1', registro(), { versaoEsperada: 1, usuario: A, agora: mais(25) }),
    (erro) => erro.code === 'TRANSPORTE_REGISTRO_VERSAO');
});

test('liberar só vale para o dono ativo e não mexe nos dados', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  assert.deepEqual(plano(s.transporteEnvioLiberar_('ab12cd34', '1', A)), { ok: true, liberou: false });
  assert.deepEqual(Object.keys(book.sheets), []);
  s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: T0 });
  s.transporteRegistroGravar_('ab12cd34', '1', registro(), { versaoEsperada: 0, usuario: A, agora: mais(1) });
  assert.equal(s.transporteEnvioLiberar_('ab12cd34', '1', B, { agora: mais(2) }).ok, false);
  assert.equal(s.transporteEnvioLiberar_('ab12cd34', '1', A, { agora: mais(2) }).liberou, true);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([lido.emPreparoPor, lido.versao, lido.registro.awb], ['', 1, '123456789012']);
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: mais(3) }).ok, true);
});

function envioComDono(s, extra) {
  s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: T0 });
  s.transporteRegistroGravar_('ab12cd34', '1', registro(Object.assign({ idAgenda: 'ab12cd34' }, extra || {})), { versaoEsperada: 0, usuario: A, agora: mais(1) });
}

test('reserva de AWB usa o registro gravado, sob lock curto, sem a planilha de Transporte, e só para o dono', () => {
  const s = servidor(new FakeSpreadsheet({}));
  const chamadas = [];
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  s.getAgendaSheetForRead_ = () => ({ nome: 'agenda' });
  s.agendaAwbContextoFocado_ = (_aba, awb, ids) => { chamadas.push(['contexto', s.lockAtivo(), awb, ids.join()]); return { entries: [] }; };
  s.transporteAwbRegistro_ = (reg) => ({ owner: reg.idAgenda, awb: reg.awb });
  s.agendaAwbReservar_ = (_contexto, entradas, strict) => { chamadas.push(['reservar', s.lockAtivo(), entradas[0].awb, strict]); };
  assert.throws(() => s.transporteAwbReservarEnvio_('ab12cd34', '1', A, { agora: T0 }), /não encontrado/);
  envioComDono(s);
  assert.deepEqual(plano(s.transporteAwbReservarEnvio_('ab12cd34', '1', A, { agora: mais(2) })), { reservada: true, awb: '123456789012' });
  assert.deepEqual(plano(chamadas), [['contexto', true, '123456789012', 'ab12cd34'], ['reservar', true, '123456789012', true]]);
  assert.equal(s.lockAtivo(), false);
  // Outra pessoa com o preparo ativo do envio não reserva (nem com a tela antiga em mãos).
  chamadas.length = 0;
  assert.throws(() => s.transporteAwbReservarEnvio_('ab12cd34', '1', B, { agora: mais(3) }), (erro) => erro.code === 'TRANSPORTE_REGISTRO_EM_PREPARO');
  assert.deepEqual(chamadas, []);
  assert.equal(s.lockAtivo(), false);
  // Duplicidade: o erro da reserva sobe e o lock é liberado.
  s.agendaAwbReservar_ = () => { throw new Error('AWB já usada'); };
  assert.throws(() => s.transporteAwbReservarEnvio_('ab12cd34', '1', A, { agora: mais(3) }), /AWB já usada/);
  assert.equal(s.lockAtivo(), false);
});

test('reserva de AWB: sem AWB nada reserva e sem vínculo com a Agenda recusa', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.agendaAwbContextoFocado_ = () => { throw new Error('não deveria consultar'); };
  s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: T0 });
  s.transporteRegistroGravar_('ab12cd34', '1', registro({ idAgenda: 'ab12cd34', awb: '' }), { versaoEsperada: 0, usuario: A, agora: mais(1) });
  assert.deepEqual(plano(s.transporteAwbReservarEnvio_('ab12cd34', '1', A, { agora: mais(2) })), { reservada: false });
  s.transporteRegistroGravar_('ab12cd34', '1', registro(), { versaoEsperada: 1, usuario: A, agora: mais(3) });
  assert.throws(() => s.transporteAwbReservarEnvio_('ab12cd34', '1', A, { agora: mais(4) }), /sem vínculo com a Agenda/);
});

test('Transporte_Operacoes: só o dono registra, sem duplicar na reexecução, e a base de cobrança sai do lock da gravação', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  envioComDono(s);
  const bases = [];
  s.courierLembreteRegistrarBase_ = (id, slot) => { bases.push([id, slot, s.lockAtivo()]); throw new Error('Agenda lenta demais'); };
  const info = { agendaId: 'ab12cd34', slot: '1', courier: 'MARKEN', geradoPor: A, pdfId: 'PDF-1', pdfNome: 'x.pdf',
    pdfHash: 'hash-1', rascunhoId: 'DRAFT-1', rascunhoOk: true, generationRequestId: 'a'.repeat(32) };
  assert.throws(() => s.transporteOperacaoRegistrarEnvio_(info, B, { agora: mais(2) }), (erro) => erro.code === 'TRANSPORTE_REGISTRO_EM_PREPARO');
  assert.equal(book.sheets.Transporte_Operacoes, undefined);
  const antes = s.locks();
  const primeiro = s.transporteOperacaoRegistrarEnvio_(info, A, { agora: mais(2) });
  assert.equal(primeiro.registrado, true);
  assert.equal(s.locks(), antes + 2); // lock da gravação + lock próprio da base de cobrança
  s.transporteOperacaoRegistrarEnvio_(info, A, { agora: mais(3) });
  assert.equal(book.sheets.Transporte_Operacoes.rows.length, 2); // cabeçalho + uma operação
  // A falha da base de cobrança não desfaz o registro; ela roda dentro de lock próprio, depois do primeiro.
  assert.deepEqual(plano(bases), [['ab12cd34', '1', true], ['ab12cd34', '1', true]]);
  assert.equal(s.lockAtivo(), false);
});

test('expiração do preparo: limite exato de 15 min, relógio no futuro e aviso de preparo perdido', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: T0 });
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: new Date(T0.getTime() + 15 * 60000 - 1) }).ok, false);
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: mais(15) }).ok, true);
  // Sinal gravado no futuro (relógio errado) não prende o envio para sempre.
  s.transporteEnvioLiberar_('ab12cd34', '1', B, { agora: mais(16) });
  s.transporteEnvioReivindicar_('ab12cd34', '1', A, { agora: mais(300) });
  assert.equal(s.transporteEnvioReivindicar_('ab12cd34', '1', B, { agora: mais(100) }).ok, true);
  // Quem era dono, deixou expirar e grava, recebe o aviso.
  s.transporteEnvioReivindicar_('ab12cd34', '2', A, { agora: T0 });
  const gravacao = s.transporteRegistroGravar_('ab12cd34', '2', registro(), { versaoEsperada: 0, usuario: A, agora: mais(20) });
  assert.equal(gravacao.perdeuPreparo, true);
  assert.equal(s.transporteRegistroGravar_('ab12cd34', '2', registro(), { versaoEsperada: 1, usuario: A, agora: mais(21) }).perdeuPreparo, false);
});

test('dois envios gerados de forma intercalada não misturam dados', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  const arquivo = s.transporteLayoutsCarregar_(ARQUIVO);
  s.transporteRegistroGravar_('aaaa0001', '1', registro({ awb: '111111111111' }), { versaoEsperada: 0 });
  s.transporteRegistroGravar_('bbbb0002', '1', registro({ awb: '222222222222', paciente: 'Outra Pessoa' }), { versaoEsperada: 0 });
  const awbDaFolha = (id) => {
    const abas = s.transporteRegistroDocsDados_(id, '1', { arquivo }).abas();
    const f = s.transporteLayoutsFaixa_('C12');
    return abas['Folha de Agendamento'].data[0].rowData[f.r0].values[f.c0].formattedValue;
  };
  assert.deepEqual([awbDaFolha('aaaa0001'), awbDaFolha('bbbb0002'), awbDaFolha('aaaa0001')], ['111111111111', '222222222222', '111111111111']);
});
