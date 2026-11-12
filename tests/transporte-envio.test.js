'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSpreadsheet, FakeSheet } = require('./helpers/fake-spreadsheet');

const plano = (v) => JSON.parse(JSON.stringify(v));
const A = 'ana@example.invalid';
const B = 'bia@example.invalid';

function servidor(book) {
  let ativo = false;
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs',
    'TransporteTarefas.gs', 'TransporteEmails.gs', 'TransporteEnvio.gs', 'TransporteEnvioGerar.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    LockService: { getDocumentLock: () => ({ tryLock: () => { ativo = true; return true; }, releaseLock() { ativo = false; } }) }
  });
  s.getCodexSpreadsheet_ = () => book;
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  s.codexAssertAdmin_ = () => ({ ok: true, role: 'admin', email: A });
  s.codexGetAllowedUsers_ = () => ({ [A]: { firstName: 'Ana' }, [B]: { firstName: 'Bia' } });
  s.lockAtivo = () => ativo;
  // Regra real vem do cadastro de couriers; aqui toda courier exige AWB, exceto o agendamento da PINEX.
  s.codexCourierRequiresAwb_ = (courier) => String(courier || '').toLowerCase() !== 'pinex (agendamento)';
  return s;
}

function registro(extra) {
  return Object.assign({
    paciente: 'Pessoa Participante', protocolo: 'Estudo X', investigador: 'Pessoa Investigadora', temperatura: 'CONGELADO',
    dataColeta: '2026-11-16', dataEnvio: '2026-11-16', horaEnvio: '13:00 - 15:00', courier: 'MARKEN', destino: 'LAB X',
    awb: '111122223333', agendadoPor: 'Equipe', idAgenda: 'ab12cd34', agendaSlot: '1', materiais: []
  }, extra || {});
}

test('resposta da PINEX: coleta com 5 ou 6 dígitos, frete, protocolo e data', () => {
  const s = servidor(new FakeSpreadsheet({}));
  const linha = 'Confirmação de agendamento - Coleta: 78429 - Frete: 94624 - Protocolo: MB12C0224 - Data da coleta: 11/03/2026';
  assert.deepEqual(plano(s.transportePinexParseResposta_(linha)),
    { ok: true, coleta: '78429', frete: '94624', protocolo: 'MB12C0224', dataColeta: '2026-03-11', faltando: [] });
  assert.equal(s.transportePinexParseResposta_(linha.replace('78429', '418207')).coleta, '418207');
  for (const ruim of ['Coleta: 1234 - Frete: 9 - Protocolo: X - Data da coleta: 11/03/2026', 'Coleta: 1234567 - Frete: 9 - Protocolo: X - Data da coleta: 11/03/2026']) {
    const r = s.transportePinexParseResposta_(ruim);
    assert.equal(r.ok, false);
    assert.match(r.faltando.join(), /Coleta/);
  }
  assert.deepEqual(plano(s.transportePinexParseResposta_('')).faltando.length, 4);
});

test('passos: Conferir, AWB ou números da PINEX só se faltar, Gerar e Enviar', () => {
  const s = servidor(new FakeSpreadsheet({}));
  const passos = (extra) => plano(s.transporteEnvioPassos_(registro(extra)));
  assert.deepEqual(passos(), ['conferir', 'gerar', 'enviar']);
  assert.deepEqual(passos({ awb: '' }), ['conferir', 'awb', 'gerar', 'enviar']);
  assert.deepEqual(passos({ courier: 'DHL', awb: '' }), ['conferir', 'awb', 'gerar', 'enviar']);
  assert.deepEqual(passos({ courier: 'PINEX', awb: '', pinexColeta: '' }), ['conferir', 'pinex_numeros', 'gerar', 'anvisa']);
  assert.deepEqual(passos({ courier: 'PINEX', awb: '94624', pinexColeta: '' }), ['conferir', 'pinex_numeros', 'gerar', 'anvisa']);
  assert.deepEqual(passos({ courier: 'PINEX', awb: '94624', pinexColeta: '78429' }), ['conferir', 'gerar', 'anvisa']);
  // Envio internacional já peticionado: só falta anexar a GRU e o extrato e enviar.
  assert.deepEqual(passos({ courier: 'PINEX', awb: '94624', pinexColeta: '78429', peticionamentoEnviadoEm: '2026-11-09T10:00:00.000Z', gruPronta: true }), ['enviar']);
  assert.deepEqual(passos({ courier: 'PINEX', awb: '94624', pinexColeta: '78429', peticionamentoEnviadoEm: '2026-11-09T10:00:00.000Z' }), ['conferir', 'gerar', 'enviar']);
  assert.deepEqual(passos({ courier: 'PINEX (Agendamento)', awb: '' }), ['conferir', 'gerar', 'enviar']);
});

test('reconstruir pela Agenda preserva o que a pessoa preencheu e a AWB da Agenda prevalece', () => {
  const s = servidor(new FakeSpreadsheet({}));
  const antigo = registro({ agendadoPor: 'Ana', horaEnvio: '14:00 - 16:00', responsavelEntrega: 'Fulano', pinexColeta: '78429', awb: 'DIGITADA' });
  const novo = plano(s.transporteEnvioMesclarLocais_(registro({ agendadoPor: '', horaEnvio: '13:00 - 15:00', awb: '' }), antigo));
  assert.deepEqual([novo.agendadoPor, novo.horaEnvio, novo.responsavelEntrega, novo.pinexColeta, novo.awb], ['Ana', '14:00 - 16:00', 'Fulano', '78429', 'DIGITADA']);
  const comAgenda = plano(s.transporteEnvioMesclarLocais_(registro({ awb: 'DA-AGENDA' }), antigo));
  assert.equal(comAgenda.awb, 'DA-AGENDA');
});

test('abrir o envio: assume o preparo, grava o registro montado e outra pessoa recebe "Com <pessoa>"', () => {
  const book = new FakeSpreadsheet({});
  const s = servidor(book);
  let montagens = 0;
  s.transporteEnvioMontarRegistro_ = () => { montagens++; return registro({ awb: '' }); };
  const aberto = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.equal(aberto.ok, true);
  assert.deepEqual(aberto.passos, ['conferir', 'awb', 'gerar', 'enviar']);
  assert.equal(aberto.versao, 1);
  assert.equal(aberto.internacional, false);
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').emPreparoPor, A);
  // Reabrir sem mudança na Agenda não grava de novo; com mudança, versiona.
  assert.equal(s.getTransporteEnvio('ab12cd34', '1').versao, 1);
  assert.equal(montagens, 2);
  // Outra pessoa não abre o mesmo envio.
  s.codexAssertAdmin_ = () => ({ ok: true, role: 'admin', email: B });
  const ocupado = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([ocupado.ok, ocupado.motivo, ocupado.comPessoa], [false, 'EM_PREPARO', 'Ana']);
  // ...mas abre outro envio ao mesmo tempo.
  assert.equal(s.getTransporteEnvio('ab12cd34', '2').ok, true);
});

test('envio já gerado não é reconstruído ao reabrir', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.transporteEnvioMontarRegistro_ = () => registro({ awb: '' });
  s.getTransporteEnvio('ab12cd34', '1');
  s.transporteRegistroGravar_('ab12cd34', '1', registro({ awb: 'GRAVADA' }), { versaoEsperada: 1, usuario: A, passo: 'enviar' });
  s.transporteEnvioMontarRegistro_ = () => { throw new Error('não deveria remontar'); };
  const reaberto = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([reaberto.registro.awb, reaberto.passo, reaberto.versao], ['GRAVADA', 'enviar', 2]);
});

test('salvar: só campos permitidos, passo válido, versão conferida e PINEX 5 ou 6 dígitos', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.transporteEnvioMontarRegistro_ = () => registro({ courier: 'PINEX', awb: '', pinexColeta: '' });
  const v = s.getTransporteEnvio('ab12cd34', '1').versao;
  const salvo = plano(s.salvarTransporteEnvio('ab12cd34', '1', v, { agendadoPor: 'Ana', courier: 'OUTRA', destino: 'HACK', pinexColeta: '418207' }, 'conferir'));
  assert.equal(salvo.ok, true);
  const lido = s.transporteRegistroLer_('ab12cd34', '1').registro;
  assert.deepEqual([lido.agendadoPor, lido.pinexColeta, lido.courier, lido.destino], ['Ana', '418207', 'PINEX', 'LAB X']);
  assert.throws(() => s.salvarTransporteEnvio('ab12cd34', '1', salvo.versao, { pinexColeta: '1234' }), /5 ou 6 dígitos/);
  assert.throws(() => s.salvarTransporteEnvio('ab12cd34', '1', salvo.versao, {}, 'inexistente'), /Passo inválido/);
  assert.throws(() => s.salvarTransporteEnvio('ab12cd34', '1', 1, { agendadoPor: 'X' }), (erro) => erro.code === 'TRANSPORTE_REGISTRO_VERSAO');
  assert.throws(() => s.salvarTransporteEnvio('zzzz9999', '1', 0, {}), /Abra o envio/);
});

test('colar a resposta da PINEX preenche coleta, frete e protocolo e avisa se a data difere', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.transporteEnvioMontarRegistro_ = () => registro({ courier: 'PINEX', awb: '', pinexColeta: '', dataEnvio: '2026-03-12' });
  s.codexCourierAssertDocumentAwb_ = () => {};
  const v = s.getTransporteEnvio('ab12cd34', '1').versao;
  const linha = 'Confirmação de agendamento - Coleta: 78429 - Frete: 94624 - Protocolo: MB12C0224 - Data da coleta: 11/03/2026';
  const r = plano(s.registrarRespostaPinexEnvio('ab12cd34', '1', v, linha));
  assert.equal(r.ok, true);
  assert.match(r.avisos[0], /11\/03\/2026.*12\/03\/2026/);
  const lido = s.transporteRegistroLer_('ab12cd34', '1').registro;
  assert.deepEqual([lido.pinexColeta, lido.awb, lido.pinexProtocolo], ['78429', '94624', 'MB12C0224']);
  assert.equal(plano(s.registrarRespostaPinexEnvio('ab12cd34', '1', r.versao, 'texto sem dados')).ok, false);
});

test('última AWB do estudo e da courier, lida sem alterar a aba', () => {
  const cabecalho = ['AWB', 'Owner', 'ID', 'Slot', 'Courier', 'Temperatura', 'Participante', 'Projeto', 'Data', 'Status', 'Registrado'];
  const book = new FakeSpreadsheet({ AWB_Utilizadas: new FakeSheet('AWB_Utilizadas', [cabecalho,
    ['111', 'o1', 'a', '1', 'MARKEN', 'CONGELADO', 'P', 'Estudo X', '2026-10-01', '', ''],
    ['222', 'o2', 'b', '1', 'DHL', 'AMBIENTE', 'P', 'Estudo X', '2026-10-02', '', ''],
    ['333', 'o3', 'c', '1', 'MARKEN', 'CONGELADO', 'P', 'Estudo Y', '2026-10-03', '', ''],
    ['444', 'o4', 'd', '1', 'MARKEN', 'CONGELADO', 'P', 'Estudo X', '2026-10-04', '', '']]) });
  const s = servidor(book);
  s.transporteProjetoDisplay_ = (p) => String(p || '').trim();
  assert.equal(s.transporteAwbUltimaDoEstudo_('Estudo X', 'MARKEN').awb, '444');
  assert.equal(s.transporteAwbUltimaDoEstudo_('Estudo X', 'DHL').awb, '222');
  assert.equal(s.transporteAwbUltimaDoEstudo_('Estudo Z', 'MARKEN'), null);
  assert.equal(plano(s.getTransporteAwbUltima('Estudo Y', 'MARKEN')).ultima.awb, '333');
  assert.equal(book.sheets.AWB_Utilizadas.writes, 0);
  assert.equal(s.lockAtivo(), false);
});

test('PINEX em fases: formulário, resposta por e-mail e documentos no mesmo transporte', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.codexCourierAssertDocumentAwb_ = () => {};
  s.transporteEnvioMontarRegistro_ = () => registro({ courier: 'PINEX', awb: '', pinexColeta: '', dataEnvio: '2026-03-11' });
  // Fase 1: o Agenda diz PINEX, mas o primeiro passo é o Formulário (PINEX (Agendamento)).
  const aberto = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([aberto.registro.courier, aberto.registro.fasePinex, aberto.passos], ['PINEX (Agendamento)', 'agendamento', ['conferir', 'gerar', 'enviar']]);
  // Concluir o envio do Formulário passa a aguardar a PINEX (e libera o preparo).
  s.transporteRegistroGravar_('ab12cd34', '1', Object.assign({}, aberto.registro), { versaoEsperada: aberto.versao, usuario: A, passo: 'enviar' });
  const v = s.transporteRegistroLer_('ab12cd34', '1').versao;
  const fim = plano(s.concluirEnvioTransporte('ab12cd34', '1', v));
  assert.equal(fim.aguardaPinex, true);
  const aguardando = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([aguardando.registro.fasePinex, aguardando.passo, aguardando.emPreparoPor], ['resposta', 'pinex_numeros', '']);
  // Fase 2: reabrir mostra primeiro os números da PINEX; colar vira PINEX com documentos.
  const reaberto = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([reaberto.passo, reaberto.passos, reaberto.registro.fasePinex], ['pinex_numeros', ['pinex_numeros', 'conferir', 'gerar', 'enviar'], 'resposta']);
  const linha = 'Confirmação de agendamento - Coleta: 78429 - Frete: 94624 - Protocolo: MB12C0224 - Data da coleta: 11/03/2026';
  const colado = plano(s.registrarRespostaPinexEnvio('ab12cd34', '1', reaberto.versao, linha));
  assert.equal(colado.ok, true);
  assert.deepEqual([colado.registro.courier, colado.registro.fasePinex, colado.registro.awb, colado.registro.pinexColeta, colado.passos], ['PINEX', 'documentos', '94624', '78429', ['conferir', 'gerar', 'anvisa']]);
  assert.deepEqual(colado.avisos, []);
  // Reabrir não volta para a fase 1, mesmo com a Agenda ainda dizendo PINEX sem AWB.
  const depois = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([depois.registro.courier, depois.registro.fasePinex, depois.registro.awb, depois.passo], ['PINEX', 'documentos', '94624', 'conferir']);
});

test('PINEX com o Formulário já enviado fora do passo a passo abre nos números da PINEX', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.transporteEnvioMontarRegistro_ = () => registro({ courier: 'PINEX', awb: '', pinexColeta: '' });
  s.transporteOperacoesRows_ = () => [{ agendaId: 'ab12cd34', slot: '1', courier: 'PINEX (Agendamento)', estado: 'INATIVA', emailIdentificadoEm: '10/11/2026', emailEnviadoEm: '' }];
  const aberto = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.deepEqual([aberto.registro.fasePinex, aberto.passo, aberto.passos], ['resposta', 'pinex_numeros', ['pinex_numeros', 'conferir', 'gerar', 'enviar']]);
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').passo, 'pinex_numeros');
  // Sem Formulário enviado, continua pela fase 1.
  const outro = plano(s.getTransporteEnvio('ab12cd34', '2'));
  assert.deepEqual([outro.registro.fasePinex, outro.passo], ['agendamento', 'conferir']);
});

test('o número do passo é gravado com o passo e reflete os passos do envio (AWB, PINEX, internacional)', () => {
  const s = servidor(new FakeSpreadsheet({}));
  s.codexCourierAssertDocumentAwb_ = () => {};
  s.transporteEnvioMontarRegistro_ = () => registro({ awb: '' });
  const aberto = plano(s.getTransporteEnvio('ab12cd34', '1'));
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').registro.passoNumero, 1);
  const salvo = plano(s.salvarTransporteEnvio('ab12cd34', '1', aberto.versao, { awb: '111122223333' }, 'gerar'));
  // Depois de salvar a AWB os passos são conferir, gerar, enviar: "gerar" é o passo 2.
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').registro.passoNumero, 2);
  assert.equal(salvo.ok, true);
  assert.equal(s.transporteEnvioNumeroPasso_(registro({ awb: '' }), 'gerar'), 3);
  assert.equal(s.transporteEnvioNumeroPasso_(registro({ courier: 'PINEX', awb: '9', pinexColeta: '78429' }), 'anvisa'), 3);
  assert.equal(s.transporteEnvioNumeroPasso_(registro(), 'concluido'), 0);
  assert.equal(s.transporteEnvioNumeroPasso_(registro({ fasePinex: 'resposta' }), 'pinex_numeros'), 1);
});
