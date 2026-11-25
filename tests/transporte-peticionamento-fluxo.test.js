'use strict';

// Fluxo ANVISA ponta a ponta no servidor, com os caminhos reais que os outros testes substituem:
// lista de autorizados lida de linhas de Config_App, razão social/CNPJ da courier pelo cadastro de Courier,
// N° do CE pelo cadastro de Projetos (estudo com código) e passos da PINEX desde a espera pelos números.
// Caso modelado no envio real parado em 25/11: PINEX, CLEOPATTRA (NN6019-4958) para ICON (FARMINGDALE).

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const plano = (v) => JSON.parse(JSON.stringify(v));
const PREPARA = 'mlreis@example.invalid';
const LEO = 'lrmotta@example.invalid';
const ALINE = 'agregor1@example.invalid';

function servidor() {
  const book = new FakeSpreadsheet({});
  const celulas = {};
  const enviados = [];
  let ativo = false;
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs', 'TransporteTarefas.gs',
    'TransporteEmails.gs', 'TransporteEnvio.gs', 'TransporteEnvioGerar.gs', 'TransportePeticaoHtml.gs', 'TransportePeticionamento.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    LockService: { getDocumentLock: () => ({ tryLock: () => { ativo = true; return true; }, releaseLock() { ativo = false; } }) },
    MimeType: { PDF: 'application/pdf' },
    Utilities: { formatDate: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') },
    HtmlService: { createHtmlOutput: (html) => ({ getBlob: () => ({ getAs: () => ({ setName: (nome) => ({ nome, html }) }) }) }) },
    CodexExternalEffects_: { sendEmail: (mensagem) => { enviados.push(mensagem); } }
  });
  s.getCodexSpreadsheet_ = () => book;
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  s.usuario = PREPARA;
  s.transporteAssertOperador_ = () => ({ ok: true, role: 'user', userEmail: s.usuario });
  // Config_App como a aba: só a leitura bruta é simulada; filtro por grupo, chave e Ativo é o real.
  s.configRows = [];
  s.readConfigAppRows_ = () => s.configRows;
  // Cadastro de Courier como a aba: linha Pinex sem razão social/CNPJ, como estava em 25/11.
  s.courierPinex = { nome: 'Pinex', empresa1: '', cnpj1: '' };
  s.getAgendaCourierConfigs_ = () => ({ pinex: s.courierPinex, 'pinex (agendamento)': { nome: 'Pinex (Agendamento)' } });
  s.transporteReadProjetosDireto_ = () => [{ nomeAbreviado: 'CLEOPATTRA', codigo: 'NN6019-4958', numeroCE: '150/2025' }];
  s.transporteLabCentralByDestino_ = () => ({ nomeCompleto: 'ICON Laboratories Services', endereco: '123 Smith Street', cidade: 'Farmingdale, NY', cep: '11735', telefone: '+1 (857) 957 5004', pais: 'USA' });
  const idx = s.AGENDA_CFG.idx;
  const linhaAgenda = () => {
    const r = Array(s.AGENDA_CFG.lastCol).fill('');
    r[idx.id] = 'ag72d761'; r[idx.data] = '30/11/2026'; r[idx.projeto] = 'CLEOPATTRA (NN6019-4958)'; r[idx.participante] = 'Fatima Lemos'; r[idx.status] = 'Agendado';
    r[idx.c1.nome] = 'PINEX'; r[idx.c1.awb] = '120447'; r[idx.c1.destino] = 'ICON (FARMINGDALE)'; r[idx.c1.status] = celulas['7:' + (idx.c1.status + 1)] || '';
    return r;
  };
  s.getAgendaSheet_ = () => ({ getRange: (linha, coluna, n, w) => (n ? { getValues: () => [Array.from({ length: w }, (_v, c) => celulas[linha + ':' + (coluna + c)] || '')] }
    : { getValue: () => celulas[linha + ':' + coluna] || '', setValue: (v) => { if (!ativo) throw new Error('escrita na Agenda fora do lock'); celulas[linha + ':' + coluna] = v; } }) });
  s.encontrarLinhaPorId = (_a, id) => (id === 'ag72d761' ? 7 : 0);
  s.getDashboardAgendaSheetForRead_ = () => ({});
  s.getDashboardAgendaDisplayRows_ = () => [linhaAgenda()];
  s.codexWriteAuditChanges_ = () => {};
  s.agendaInvalidateWindowCache_ = () => {};
  s.agendaInvalidateDateIndexCache_ = () => {};
  s.ipsEmailLogoUrl_ = () => 'https://logo.example.invalid/x.png';
  s.escHtmlServer_ = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  s.gerarRodapeEmailAgenda_ = (label, u) => '<hr><p>' + label + ': ' + u.getEmail() + '</p>';
  s.enviados = enviados;
  s.status = () => celulas['7:' + (idx.c1.status + 1)];
  celulas['7:' + (idx.c1.status + 1)] = 'Docs gerados';
  return s;
}

// Registro do envio depois dos números da PINEX e da geração dos documentos (passo ANVISA).
function prepararNoAnvisa(s) {
  s.transporteEnvioReivindicar_('ag72d761', '1', PREPARA, { agora: new Date() });
  const registro = s.transporteEnvioAplicarFasePinex_({
    paciente: 'Fatima Lemos', identificacaoParticipante: '182001', protocolo: 'CLEOPATTRA (NN6019-4958)', temperatura: 'AMBIENTE',
    dataEnvio: '2026-11-30', dataColeta: '2026-11-30', courier: 'PINEX (Agendamento)', destino: 'ICON (FARMINGDALE)', awb: '120447',
    pinexColeta: '54321', idAgenda: 'ag72d761', agendaSlot: '1',
    materiais: [{ ativo: true, material: 'Soro', total: 5, unit: 'mL' }, { ativo: true, material: 'Urina', total: 8, unit: 'mL' }]
  }, { fasePinex: 'resposta' });
  const atual = s.transporteRegistroLer_('ag72d761', '1');
  return s.transporteRegistroGravar_('ag72d761', '1', registro, { versaoEsperada: atual.versao, usuario: PREPARA, passo: 'anvisa' }).versao;
}

const linhaConfig = (chave, valor, ativo) => ({ grupo: 'Transporte', chave, valor, ativo: ativo || 'Sim', ordem: '' });

test('PINEX: aguardando os números não tem ANVISA; com o PINEX COL. Nº o envio vira PINEX e o passo ANVISA entra antes do envio', () => {
  const s = servidor();
  const aguardando = { courier: 'PINEX (Agendamento)', fasePinex: 'resposta', awb: '120447', destino: 'ICON (FARMINGDALE)' };
  assert.deepEqual(plano(s.transporteEnvioPassos_(aguardando)), ['pinex_numeros', 'conferir', 'gerar', 'enviar']);
  const comNumeros = s.transporteEnvioAplicarFasePinex_(Object.assign({}, aguardando, { pinexColeta: '54321' }), aguardando);
  assert.deepEqual([comNumeros.courier, comNumeros.fasePinex], ['PINEX', 'documentos']);
  assert.equal(s.transporteEnvioInternacional_(comNumeros), true);
  assert.deepEqual(plano(s.transporteEnvioPassos_(comNumeros)), ['conferir', 'gerar', 'anvisa']);
});

test('fluxo completo: bloqueios do cadastro, e-mail aos autorizados de Config_App, GRU pronta e envio à courier', () => {
  const s = servidor();
  let versao = prepararNoAnvisa(s);

  // 1. Como estava em 25/11: sem a lista em Config_App e Pinex sem razão social/CNPJ. Nada sai, o status não muda.
  s.configRows = [{ grupo: 'Agenda', chave: 'Destinatarios email lab central', valor: 'outro@example.invalid', ativo: 'Sim' }];
  assert.throws(() => s.concluirAnvisaTransporteEnvio('ag72d761', '1', versao), /Courier sem razão social ou CNPJ no cadastro/);
  s.courierPinex = { nome: 'Pinex', empresa1: 'Transportes Brasil Cargo Express LTDA.', cnpj1: '20.494.657/0001-60' };
  assert.throws(() => s.concluirAnvisaTransporteEnvio('ag72d761', '1', versao), /Cadastre os autorizados a peticionar/);
  assert.equal(s.enviados.length, 0);
  assert.equal(s.status(), 'Docs gerados');

  // 2. A prévia do formulário já sai com os cadastros (CE do estudo com código, courier e laboratório).
  const previa = s.transportePeticaoGerar_(s.transporteRegistroLer_('ag72d761', '1').registro);
  assert.equal(previa.ok, true, String(previa.erros));
  assert.match(previa.html, /CE 150\/2025/);
  assert.match(previa.html, /Transportes Brasil Cargo Express LTDA\./);
  assert.match(previa.html, /ICON Laboratories Services/);

  // 3. Lista cadastrada pelo app (grupo Transporte, uma linha por pessoa); linha inativa e outra chave ficam de fora.
  s.configRows = [
    linhaConfig('Autorizado a peticionar', LEO), linhaConfig('Autorizado a peticionar', ALINE),
    linhaConfig('Autorizado a peticionar', 'antigo@example.invalid', 'Não'), linhaConfig('Agendado por', 'Pessoa')
  ];
  const r = plano(s.concluirAnvisaTransporteEnvio('ag72d761', '1', versao));
  assert.equal(r.ok, true);
  // Config_App ordena por Ordem e depois pelo valor.
  assert.deepEqual(r.destinatarios, [ALINE, LEO]);
  assert.equal(s.enviados.length, 1);
  const email = s.enviados[0];
  assert.equal(email.to, ALINE + ',' + LEO);
  assert.equal(email.subject, '[PETICIONAMENTO] CLEOPATTRA (NN6019-4958) - AWB 120447 - Envio 30/11/2026');
  assert.match(email.attachments[0].nome, /^Peticao_Fiscalizacao_120447\.pdf$/);
  assert.match(email.attachments[0].html, /CE 150\/2025/);
  assert.match(email.htmlBody, /Solicitado por: mlreis@example\.invalid/);
  assert.equal(s.status(), 'Aguardando peticionamento');
  let lido = s.transporteRegistroLer_('ag72d761', '1');
  assert.deepEqual([lido.passo, lido.emPreparoPor], ['peticionando', '']);
  assert.deepEqual(plano(s.transporteEnvioPassos_(lido.registro)), ['anvisa'], 'sem envio à courier antes da GRU');
  versao = lido.versao;

  // 4. Quem prepara não está na lista: não vê os peticionamentos nem marca a GRU.
  assert.throws(() => s.getTransportePeticionamentos(), /não está autorizado a peticionar/);
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ag72d761', '1'), /não está autorizado a peticionar/);

  // 5. Quem peticiona vê o envio (iniciais) e marca GRU e extrato prontos: status volta a Docs gerados.
  s.usuario = ALINE;
  const lista = plano(s.getTransportePeticionamentos());
  assert.deepEqual(lista.itens.map((x) => [x.agendaId, x.slotRotulo, x.participante, x.awb]), [['ag72d761', 'Transporte I', 'F.L.', '120447']]);
  assert.equal(plano(s.marcarGruExtratoProntosTransporte('ag72d761', '1')).ok, true);
  assert.equal(s.status(), 'Docs gerados');
  lido = s.transporteRegistroLer_('ag72d761', '1');
  assert.deepEqual([lido.registro.gruPronta, lido.registro.gruProntaPor, lido.passo], [true, ALINE, 'enviar']);
  assert.deepEqual(plano(s.transporteEnvioPassos_(lido.registro)), ['enviar']);
  assert.deepEqual(plano(s.getTransportePeticionamentos().itens), [], 'sai da lista de quem peticiona');

  // 6. Quem prepara anexa GRU e extrato, envia à courier e conclui; o e-mail de peticionamento não se repete.
  s.usuario = PREPARA;
  s.transporteEnvioReivindicar_('ag72d761', '1', PREPARA, { agora: new Date() });
  const fim = plano(s.concluirEnvioTransporte('ag72d761', '1', lido.versao));
  assert.equal(fim.ok, true);
  assert.equal(s.transporteRegistroLer_('ag72d761', '1').passo, 'concluido');
  assert.equal(s.enviados.length, 1);
});
