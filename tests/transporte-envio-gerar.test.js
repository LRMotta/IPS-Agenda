'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const plano = (v) => JSON.parse(JSON.stringify(v));
const A = 'ana@example.invalid';
const B = 'bia@example.invalid';
const TOKEN = 'a'.repeat(32);

function servidor(opcoes) {
  opcoes = opcoes || {};
  const book = new FakeSpreadsheet({});
  const eventos = [];
  const propriedades = {};
  let ativo = false;
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs',
    'TransporteTarefas.gs', 'TransporteEmails.gs', 'TransporteEnvio.gs', 'TransporteEnvioGerar.gs',
    'TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteFolhaAgendamentoHtml.gs', 'TransporteLayoutsModelo.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    LockService: { getDocumentLock: () => ({ tryLock: () => { ativo = true; return true; }, releaseLock() { ativo = false; } }) },
    PropertiesService: {
      getUserProperties: () => ({
        getProperty: (k) => (k in propriedades ? propriedades[k] : null), setProperty: (k, v) => { propriedades[k] = v; },
        getProperties: () => Object.assign({}, propriedades), deleteProperty: (k) => { delete propriedades[k]; }
      }),
      getScriptProperties: () => ({ getProperty: () => '', setProperty() {} }), getDocumentProperties: () => ({ getProperty: () => '' })
    },
    Utilities: {
      newBlob: (t) => ({ getBytes: () => Buffer.from(String(t)) }),
      computeDigest: (_alg, texto) => Array.from(crypto.createHash('sha256').update(String(texto)).digest()),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'), DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
      formatDate: (d) => d.toISOString().slice(0, 10), getUuid: () => '00000000-0000-4000-8000-000000000000'
    },
    GmailApp: {
      createDraft: (para, assunto, _corpo, o) => {
        eventos.push(['rascunho', ativo, para, assunto, o.cc || '']);
        if (opcoes.falhaRascunho) throw new Error('Gmail indisponível');
        return { getId: () => 'DRAFT-1' };
      }
    },
    DriveApp: {}
  });
  s.eventos = eventos;
  s.lockAtivo = () => ativo;
  s.getCodexSpreadsheet_ = () => book;
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  s.codexAssertAdmin_ = () => ({ ok: true, role: 'admin', email: s.usuarioAtual || A });
  s.codexGetAllowedUsers_ = () => ({ [A]: { firstName: 'Ana' }, [B]: { firstName: 'Bia' } });
  s.codexCourierRequiresAwb_ = () => true;
  // Validações de cadastro e serviços externos: simulados na fronteira.
  s.transporteValidarObrigatoriosWebApp_ = () => {};
  s.transporteValidarDataEnvioMinima_ = () => {};
  s.codexMatBioValidateTransportPayload_ = () => {};
  s.transporteProjetoDisplay_ = (p) => String(p || '').trim();
  s.transporteDocsDados_ = (registro) => { eventos.push(['docs', ativo, registro.courier]); return { ss: {}, abas: () => ({}) }; };
  s.transportePdfSpec_ = () => ({ ordem: ['Folha'], copias: { Folha: 1 } });
  s.transporteDocsGradeGerarPdfHtml_ = () => ({ blob: { getName: () => 'x.pdf' }, conteudo: [['conteudo do PDF']] });
  s.transportePdfDestinationFolder_ = () => ({
    getUrl: () => 'https://drive.example.invalid/pasta', getName: () => 'Estudo X',
    createFile: () => { eventos.push(['pdf', ativo]); return { getId: () => 'PDF-1', getUrl: () => 'https://drive.example.invalid/pdf' }; }
  });
  s.transporteShareGeneratedPdfWithActiveUser_ = () => ({ fileShared: true });
  s.transporteComunicadoEspecialDaExecucao_ = () => ({ getName: () => 'Estudo X_CE.pdf', getUrl: () => 'https://drive.example.invalid/ce' });
  s.transporteCodexEmailAttachments_ = () => [];
  s.transporteAssertGmailDraftAllowed_ = () => ({ ok: true, userEmail: A, activeUserEmail: A, requestedByEmail: A });
  s.transporteActiveUserEmail_ = () => A;
  s.transporteDraftCcRecipients_ = () => ['equipe@example.invalid'];
  s.getGmailSignature = () => '';
  s.transporteReadAgendaCourierConfigs_ = () => ({ marken: { emailCongelado: 'marken@example.invalid' }, ocasa: { email: 'ocasa@example.invalid' } });
  s.transporteSincronizarAgenda_ = (r) => { eventos.push(['agenda', ativo, r.awb]); return { atualizado: true }; };
  s.transporteMarcarDocsGeradosAgenda_ = () => { eventos.push(['status', ativo]); return { atualizado: true }; };
  s.getAgendaSheetForRead_ = () => ({});
  s.agendaAwbContextoFocado_ = () => ({ entries: [] });
  s.transporteAwbRegistro_ = (r) => ({ owner: r.idAgenda, awb: r.awb });
  s.agendaAwbReservar_ = (_c, entradas) => { eventos.push(['awb', ativo, entradas[0].awb]); };
  s.book = book;
  return s;
}

function registro(extra) {
  return Object.assign({
    paciente: 'Pessoa Participante', protocolo: 'Estudo X', investigador: 'Pessoa Investigadora', temperatura: 'CONGELADO',
    dataColeta: '2026-11-16', dataEnvio: '2026-11-16', horaEnvio: '13:00 - 15:00', courier: 'MARKEN', destino: 'LAB X',
    awb: '111122223333', agendadoPor: 'Equipe', idAgenda: 'ab12cd34', agendaSlot: '1', materiais: []
  }, extra || {});
}

function abrir(s, extra) {
  s.transporteEnvioMontarRegistro_ = () => registro(extra);
  return s.getTransporteEnvio('ab12cd34', '1');
}

const dentro = (s) => s.eventos.map((e) => e[0]);

test('gerar: AWB e Agenda sob lock curto; documentos, PDF e rascunho fora do lock; passo enviar', () => {
  const s = servidor();
  const aberto = abrir(s);
  const r = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', aberto.versao, TOKEN));
  assert.equal(r.ok, true);
  assert.deepEqual(dentro(s), ['awb', 'agenda', 'docs', 'pdf', 'rascunho', 'status']);
  const emLock = Object.fromEntries(s.eventos.map((e) => [e[0], e[1]]));
  assert.deepEqual(emLock, { awb: true, agenda: true, docs: false, pdf: false, rascunho: false, status: true });
  assert.deepEqual([r.fileId, r.draftOk, r.draftId, r.passo], ['PDF-1', true, 'DRAFT-1', 'enviar']);
  assert.equal(r.ce.found, true);
  assert.equal(r.monitorRef, 'IPS-TRP-AB12CD34-T1');
  const rascunho = s.eventos.find((e) => e[0] === 'rascunho');
  assert.deepEqual(rascunho.slice(2), ['marken@example.invalid', 'Estudo X - 111122223333 - 16NOV2026 - LAB X - AGENDAMENTO DE COLETA', 'equipe@example.invalid']);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([lido.passo, lido.versao, lido.registro.caixaTransporte], ['enviar', r.versao, undefined]);
  assert.equal(s.book.sheets.Transporte_Operacoes.rows.length, 2);
  assert.equal(s.lockAtivo(), false);
});

test('repetir o mesmo token devolve o resultado sem novo PDF, rascunho ou reserva', () => {
  const s = servidor();
  const v = abrir(s).versao;
  const primeiro = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, TOKEN));
  const antes = s.eventos.length;
  const segundo = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', primeiro.versao, TOKEN));
  assert.equal(segundo.ok, true);
  assert.equal(segundo.recovered, true);
  assert.equal(segundo.fileId, 'PDF-1');
  assert.equal(s.eventos.length, antes);
});

test('falha do Gmail mantém o PDF; tentar de novo com o mesmo token cria só o rascunho', () => {
  const s = servidor({ falhaRascunho: true });
  const v = abrir(s).versao;
  const r = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, TOKEN));
  assert.deepEqual([r.ok, r.draftOk, r.fileId], [true, false, 'PDF-1']);
  assert.match(r.draftError, /Gmail indisponível/);
  // A falha de rascunho sai do estado DRAFT_INTENT incerto: a tela mostra "Tentar de novo".
  const sTentar = servidor();
  const v2 = abrir(sTentar).versao;
  sTentar.transporteEnvioCriarRascunho_ = () => ({ ok: false, message: 'falhou' });
  const falho = plano(sTentar.gerarDocumentosTransporteEnvio('ab12cd34', '1', v2, 'b'.repeat(32)));
  assert.equal(falho.draftOk, false);
  assert.equal(dentro(sTentar).filter((e) => e === 'pdf').length, 1);
  sTentar.transporteEnvioCriarRascunho_ = () => ({ ok: true, draftId: 'DRAFT-2', message: 'ok' });
  const retomado = plano(sTentar.gerarDocumentosTransporteEnvio('ab12cd34', '1', falho.versao, 'b'.repeat(32)));
  assert.equal(retomado.draftOk, true);
  assert.equal(retomado.draftId, 'DRAFT-2');
  assert.equal(dentro(sTentar).filter((e) => e === 'pdf').length, 1, 'o PDF não é criado de novo');
});

test('recusa: preparo de outra pessoa, versão antiga e envio não aberto; nada é criado', () => {
  const s = servidor();
  const v = abrir(s).versao;
  s.usuarioAtual = B;
  assert.throws(() => s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, TOKEN), (erro) => erro.code === 'TRANSPORTE_REGISTRO_EM_PREPARO');
  s.usuarioAtual = A;
  assert.throws(() => s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v + 5, TOKEN), (erro) => erro.code === 'TRANSPORTE_REGISTRO_VERSAO');
  assert.throws(() => s.gerarDocumentosTransporteEnvio('zzzz9999', '1', 0, TOKEN), /Abra o envio/);
  assert.throws(() => s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, 'token-ruim'), /Identificador de geração inválido/);
  assert.deepEqual(s.eventos, []);
});

test('validação falha antes de AWB, arquivo ou rascunho', () => {
  const s = servidor();
  const v = abrir(s).versao;
  s.transporteValidarObrigatoriosWebApp_ = () => { throw new Error('Preencha os campos obrigatorios: Agendado por.'); };
  assert.throws(() => s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, TOKEN), /campos obrigatorios/);
  assert.deepEqual(s.eventos, []);
});

test('duplicidade de AWB bloqueia antes de qualquer arquivo e o lock é liberado', () => {
  const s = servidor();
  const v = abrir(s).versao;
  s.agendaAwbReservar_ = () => { throw new Error('AWB já usada em outro envio'); };
  assert.throws(() => s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, TOKEN), /AWB já usada/);
  assert.deepEqual(dentro(s), []);
  assert.equal(s.lockAtivo(), false);
});

test('PINEX não registra operação nem promove status; PINEX (Agendamento) anexa o PDF e não usa AWB', () => {
  const s = servidor();
  const v = abrir(s, { courier: 'PINEX', pinexColeta: '78429' }).versao;
  s.transporteEnvioCriarRascunho_ = () => ({ ok: true, skipped: true, message: 'Rascunho nao criado para PINEX' });
  const r = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, TOKEN));
  assert.equal(r.draftSkipped, true);
  assert.equal(s.book.sheets.Transporte_Operacoes, undefined);
  const s2 = servidor();
  s2.transporteEmailDoRegistro_ = (reg) => ({ courier: reg.courier, assunto: 'Assunto', destinatarios: ['pinex@example.invalid'], html: '<p>x</p>', caixaPayload: null });
  const anexados = [];
  s2.DriveApp.getFileById = (id) => ({ getBlob: () => { anexados.push(id); return {}; } });
  const v2 = abrir(s2, { courier: 'PINEX (Agendamento)', awb: '' }).versao;
  s2.gerarDocumentosTransporteEnvio('ab12cd34', '1', v2, TOKEN);
  assert.deepEqual(anexados, ['PDF-1']);
});

test('concluir e sair guardam o passo e liberam o preparo para outra pessoa', () => {
  const s = servidor();
  const v = abrir(s).versao;
  const saiu = plano(s.sairEnvioTransporte('ab12cd34', '1', v, 'conferir'));
  assert.equal(saiu.passo, 'conferir');
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').emPreparoPor, '');
  s.usuarioAtual = B;
  const aberto = s.getTransporteEnvio('ab12cd34', '1');
  assert.equal(aberto.ok, true);
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').emPreparoPor, B);
  const fim = plano(s.concluirEnvioTransporte('ab12cd34', '1', aberto.versao));
  assert.equal(fim.ok, true);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([lido.passo, lido.emPreparoPor], ['concluido', '']);
});

test('reabrir depois de conferir: a Agenda alterada volta ao Conferir com os dados novos; sem mudança, segue no Gerar', () => {
  const s = servidor();
  const aberto = abrir(s);
  const salvo = plano(s.salvarTransporteEnvio('ab12cd34', '1', aberto.versao, { agendadoPor: 'Equipe' }, 'gerar'));
  const igual = plano(abrir(s));
  assert.deepEqual([igual.passo, igual.dadosAtualizados, igual.versao], ['gerar', false, salvo.versao]);
  const mudou = plano(abrir(s, { dataEnvio: '2026-11-23', dataColeta: '2026-11-23', awb: '999988887777', destino: 'LAB Y' }));
  assert.deepEqual([mudou.passo, mudou.dadosAtualizados], ['conferir', true]);
  assert.deepEqual([mudou.registro.dataEnvio, mudou.registro.awb, mudou.registro.destino], ['2026-11-23', '999988887777', 'LAB Y']);
  assert.equal(mudou.registro.agendadoPor, 'Equipe', 'o que a pessoa preencheu continua');
  assert.equal(plano(s.transporteRegistroLer_('ab12cd34', '1')).passo, 'conferir');
});

test('reabrir com documentos gerados: só a Agenda alterada reinicia o preparo', () => {
  const s = servidor();
  const g = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', abrir(s).versao, TOKEN));
  const fim = plano(s.concluirEnvioTransporte('ab12cd34', '1', g.versao));
  const igual = plano(abrir(s));
  assert.deepEqual([igual.passo, igual.dadosAtualizados, igual.versao], ['concluido', false, fim.versao]);
  // Reagendamento: os documentos impressos trazem a data antiga.
  const mudou = plano(abrir(s, { dataEnvio: '2026-11-30', dataColeta: '2026-11-30' }));
  assert.deepEqual([mudou.passo, mudou.dadosAtualizados, mudou.registro.dataEnvio], ['conferir', true, '2026-11-30']);
  assert.deepEqual(mudou.passos, ['conferir', 'gerar', 'enviar']);
});

test('reabrir com o formulário ANVISA já enviado: a Agenda alterada só avisa, sem refazer sozinho', () => {
  const s = servidor();
  const aberto = abrir(s);
  const comPeticao = Object.assign({}, plano(aberto.registro), { peticionamentoEnviadoEm: '2026-11-10T12:00:00.000Z' });
  s.transporteRegistroGravar_('ab12cd34', '1', comPeticao, { versaoEsperada: aberto.versao, usuario: A, passo: 'peticionando' });
  const mudou = plano(abrir(s, { dataEnvio: '2026-11-30' }));
  assert.deepEqual([mudou.passo, mudou.dadosAtualizados, mudou.registro.dataEnvio], ['peticionando', false, '2026-11-16']);
  assert.match(mudou.avisos.join(' '), /mudaram na Agenda depois do formulário ANVISA/);
});

test('"Sair e continuar depois" durante a geração não derruba a geração', () => {
  const s = servidor();
  const aberto = abrir(s);
  const original = s.transporteDocsGradeGerarPdfHtml_;
  s.transporteDocsGradeGerarPdfHtml_ = function() {
    s.sairEnvioTransporte('ab12cd34', '1', aberto.versao, 'gerar');
    return original.apply(this, arguments);
  };
  const r = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', aberto.versao, TOKEN));
  assert.deepEqual([r.ok, r.passo, r.draftOk], [true, 'enviar', true]);
  const lido = plano(s.transporteRegistroLer_('ab12cd34', '1'));
  assert.deepEqual([lido.passo, lido.versao], ['enviar', r.versao]);
});

test('geração: dados dos documentos alterados por outra gravação mantêm a recusa por versão', () => {
  const s = servidor();
  const aberto = abrir(s);
  const original = s.transporteDocsGradeGerarPdfHtml_;
  s.transporteDocsGradeGerarPdfHtml_ = function() {
    const outro = Object.assign({}, plano(aberto.registro), { destino: 'LAB Z' });
    s.transporteRegistroGravar_('ab12cd34', '1', outro, { versaoEsperada: aberto.versao, usuario: A });
    return original.apply(this, arguments);
  };
  assert.throws(() => s.gerarDocumentosTransporteEnvio('ab12cd34', '1', aberto.versao, TOKEN), (erro) => erro.code === 'TRANSPORTE_REGISTRO_VERSAO');
});

test('salvar pela tela não altera campos de controle (GRU, peticionamento, fase da PINEX, número do passo)', () => {
  const s = servidor();
  s.transporteOcasaNeedsProforma_ = () => true;
  const aberto = abrir(s, { courier: 'OCASA' });
  assert.deepEqual(plano(aberto.passos), ['conferir', 'gerar', 'anvisa']);
  const salvo = plano(s.salvarTransporteEnvio('ab12cd34', '1', aberto.versao,
    { gruPronta: 'true', gruProntaPor: 'x', peticionamentoEnviadoEm: '2026-01-01', fasePinex: 'resposta', passoNumero: '9', horaEnvio: '14:00 - 16:00' }, undefined));
  assert.deepEqual(salvo.passos, ['conferir', 'gerar', 'anvisa']);
  const gravado = plano(s.transporteRegistroLer_('ab12cd34', '1')).registro;
  assert.deepEqual([gravado.gruPronta, gravado.gruProntaPor, gravado.peticionamentoEnviadoEm, gravado.fasePinex, gravado.horaEnvio],
    [undefined, undefined, undefined, undefined, '14:00 - 16:00']);
  assert.notEqual(String(gravado.passoNumero), '9');
});

test('renovar o preparo: mantém ou retoma o dono; com outra pessoa ativa, recusa', () => {
  const s = servidor();
  const aberto = abrir(s);
  const sh = s.book.getSheetByName('Transporte_Registros');
  // 16 minutos sem sinal: o preparo expirou e gravar não o retoma sozinho.
  sh.getRange(2, 10).setValue(new Date(Date.now() - 16 * 60 * 1000).toISOString());
  const salvo = plano(s.salvarTransporteEnvio('ab12cd34', '1', aberto.versao, { horaEnvio: '14:00 - 16:00' }, undefined));
  assert.equal(salvo.perdeuPreparo, true);
  assert.equal(plano(s.transporteRegistroLer_('ab12cd34', '1')).emPreparoPor, '');
  assert.deepEqual(plano(s.renovarPreparoTransporteEnvio('ab12cd34', '1')), { ok: true, versao: salvo.versao });
  assert.equal(plano(s.transporteRegistroLer_('ab12cd34', '1')).emPreparoPor, A);
  s.usuarioAtual = B;
  const ocupado = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([ocupado.ok, ocupado.motivo, ocupado.comPessoa], [false, 'EM_PREPARO', 'Ana']);
  const recusa = plano(s.renovarPreparoTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([recusa.ok, recusa.comPessoa], [false, 'Ana']);
});

test('sair sem conseguir guardar o passo ainda libera o preparo', () => {
  const s = servidor();
  const aberto = abrir(s);
  assert.throws(() => s.sairEnvioTransporte('ab12cd34', '1', aberto.versao + 5, 'conferir'), (erro) => erro.code === 'TRANSPORTE_REGISTRO_VERSAO');
  assert.equal(plano(s.transporteRegistroLer_('ab12cd34', '1')).emPreparoPor, '');
});

test('token de geração no registro: outro navegador retoma a mesma geração, sem outro PDF nem outro rascunho', () => {
  const s = servidor();
  const aberto = abrir(s);
  // Recusa antes de pedir o rascunho ao Gmail (a exceção do próprio Gmail é estado incerto, que não repete).
  s.transporteEnvioCriarRascunho_ = () => ({ ok: false, message: 'falhou' });
  const r1 = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', aberto.versao, TOKEN));
  assert.deepEqual([r1.draftOk, r1.passo], [false, 'enviar']);
  assert.equal(plano(s.transporteRegistroLer_('ab12cd34', '1')).registro.geracaoToken, TOKEN);
  // Outro computador: a tela manda um token diferente; vale o do registro.
  s.transporteEnvioCriarRascunho_ = () => ({ ok: true, draftId: 'DRAFT-2', message: 'ok' });
  const reaberto = plano(abrir(s));
  assert.deepEqual([reaberto.passo, reaberto.dadosAtualizados], ['enviar', false]);
  const r2 = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', reaberto.versao, 'b'.repeat(32)));
  assert.deepEqual([r2.fileId, r2.draftOk, r2.draftId], ['PDF-1', true, 'DRAFT-2']);
  assert.equal(dentro(s).filter((e) => e === 'pdf').length, 1, 'um PDF só');
  assert.equal(plano(s.transporteRegistroLer_('ab12cd34', '1')).registro.geracaoToken, TOKEN);
});

test('guardar o token não muda a versão: falha adiante permite tentar de novo com a versão da tela', () => {
  const s = servidor();
  const aberto = abrir(s);
  s.agendaAwbReservar_ = () => { throw new Error('A AWB já foi utilizada em outro envio.'); };
  assert.throws(() => s.gerarDocumentosTransporteEnvio('ab12cd34', '1', aberto.versao, TOKEN), /já foi utilizada/);
  const lido = plano(s.transporteRegistroLer_('ab12cd34', '1'));
  assert.deepEqual([lido.versao, lido.registro.geracaoToken], [aberto.versao, TOKEN]);
  s.agendaAwbReservar_ = () => {};
  assert.equal(plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', aberto.versao, TOKEN)).ok, true);
});

test('assunto e destinatários do rascunho ficam no registro; Agenda alterada descarta token e rascunho', () => {
  const s = servidor();
  const r = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', abrir(s).versao, TOKEN));
  assert.match(r.draftSubject, /Estudo X - 111122223333 - .* - LAB X - AGENDAMENTO DE COLETA/);
  assert.equal(r.draftRecipients, 'marken@example.invalid');
  const gravado = plano(s.transporteRegistroLer_('ab12cd34', '1')).registro;
  assert.deepEqual([gravado.rascunhoAssunto, gravado.rascunhoDestinatarios], [r.draftSubject, r.draftRecipients]);
  // Sem mudança na Agenda, reabrir preserva; com mudança, a geração seguinte nasce do zero.
  assert.equal(plano(abrir(s)).registro.rascunhoAssunto, r.draftSubject);
  const mudou = plano(abrir(s, { dataEnvio: '2026-11-30', dataColeta: '2026-11-30' })).registro;
  assert.deepEqual([mudou.geracaoToken, mudou.rascunhoAssunto, mudou.rascunhoDestinatarios], [undefined, undefined, undefined]);
});

test('token do registro com outros dados (mudança que não reinicia o preparo): começa outra geração, sem prender o envio', () => {
  const s = servidor({ falhaRascunho: true });
  const aberto = abrir(s);
  const r1 = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', aberto.versao, TOKEN));
  // Investigador não está entre os dados que reiniciam o preparo, mas entra nos documentos.
  const lido = plano(s.transporteRegistroLer_('ab12cd34', '1'));
  const v = s.transporteRegistroGravar_('ab12cd34', '1', Object.assign({}, lido.registro, { investigador: 'Outra Pessoa' }), { versaoEsperada: r1.versao, usuario: A }).versao;
  const r2 = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', v, TOKEN));
  assert.equal(r2.ok, true);
  const token = plano(s.transporteRegistroLer_('ab12cd34', '1')).registro.geracaoToken;
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.notEqual(token, TOKEN);
  assert.equal(dentro(s).filter((e) => e === 'pdf').length, 2, 'dados novos, PDF novo');
});

test('resultado repetido devolve a versão atual do registro, não a da época', () => {
  const s = servidor();
  const r1 = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', abrir(s).versao, TOKEN));
  const saiu = plano(s.sairEnvioTransporte('ab12cd34', '1', r1.versao, 'enviar'));
  assert.ok(saiu.versao > r1.versao);
  const reaberto = plano(abrir(s));
  const r2 = plano(s.gerarDocumentosTransporteEnvio('ab12cd34', '1', reaberto.versao, TOKEN));
  assert.deepEqual([r2.recovered, r2.versao], [true, reaberto.versao]);
});
