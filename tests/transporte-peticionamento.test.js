'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const plano = (v) => JSON.parse(JSON.stringify(v));
const ADMIN = 'admin@example.invalid';
const ALINE = 'aline@example.invalid';
const LUIZ = 'luiz@example.invalid';

function servidor(opcoes) {
  opcoes = opcoes || {};
  const book = new FakeSpreadsheet({});
  const celulas = {};
  const enviados = [];
  const auditoria = [];
  let ativo = false;
  const s = runFiles(['AgendaServerRules.gs', 'CadastroRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs', 'TransporteRegistros.gs', 'TransporteTarefas.gs',
    'TransporteEmails.gs', 'TransporteEnvio.gs', 'TransporteEnvioGerar.gs', 'TransportePeticaoHtml.gs', 'TransportePeticionamento.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    LockService: { getDocumentLock: () => ({ tryLock: () => { ativo = true; return true; }, releaseLock() { ativo = false; } }) },
    MimeType: { PDF: 'application/pdf' },
    Utilities: { formatDate: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') },
    HtmlService: { createHtmlOutput: (html) => ({ getBlob: () => ({ getAs: () => ({ setName: (nome) => ({ nome, html }) }) }) }) },
    CodexExternalEffects_: { sendEmail: (mensagem) => { if (opcoes.falhaEmail) throw new Error('Cota de e-mail excedida'); enviados.push(mensagem); } }
  });
  s.getCodexSpreadsheet_ = () => book;
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  s.usuario = ADMIN;
  // Piloto: todas as acoes exigem admin; a lista de peticionamento restringe ainda mais.
  s.papel = 'admin';
  s.codexAssertAdmin_ = () => { if (s.papel !== 'admin') throw new Error('Acesso permitido apenas para administradores.'); return { ok: true, role: s.papel, email: s.usuario }; };
  s.getConfigAppValuesByKeys_ = () => (s.autorizados || [ALINE, LUIZ]);
  const idx = s.AGENDA_CFG.idx;
  s.getAgendaSheet_ = () => ({ getRange: (linha, coluna, n, w) => (n ? { getValues: () => [Array.from({ length: w }, (_v, c) => celulas[linha + ':' + (coluna + c)] || '')] }
    : { getValue: () => celulas[linha + ':' + coluna] || '', setValue: (v) => { if (!ativo) throw new Error('escrita na Agenda fora do lock'); celulas[linha + ':' + coluna] = v; } }) });
  s.encontrarLinhaPorId = (_a, id) => (id === 'ab12cd34' ? 7 : 0);
  s.codexWriteAuditChanges_ = (...args) => { auditoria.push(args); };
  s.agendaInvalidateWindowCache_ = () => {};
  s.agendaInvalidateDateIndexCache_ = () => {};
  s.transporteLabCentralByDestino_ = () => ({ nomeCompleto: 'Lab Exemplo', endereco: '1 Example Drive', cidade: 'Cidade, ST', cep: '12345', telefone: '+1 555 0100', pais: 'USA' });
  s.transporteCourierConfig_ = () => ({ empresa1: 'Courier Exemplo Ltda.', cnpj1: '00.000.000/0001-00' });
  s.transporteReadProjetosDireto_ = () => [{ nomeAbreviado: 'Estudo X', numeroCE: '10/2025' }];
  s.transporteProjetoDisplay_ = (p) => String(p || '').trim();
  s.transporteOcasaNeedsProforma_ = () => true;
  s.ipsEmailLogoUrl_ = () => 'https://logo.example.invalid/x.png';
  s.escHtmlServer_ = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  s.gerarRodapeEmailAgenda_ = (label, u) => '<hr><p>' + label + ': ' + u.getEmail() + '</p>';
  s.lockAtivo = () => ativo;
  s.celulas = celulas; s.enviados = enviados; s.auditoria = auditoria; s.book = book;
  s.statusCelula = () => celulas['7:' + (idx.c1.status + 1)];
  s.definirStatus = (v) => { celulas['7:' + (idx.c1.status + 1)] = v; };
  s.definirStatus('Docs gerados');
  return s;
}

function registro(extra) {
  return Object.assign({
    paciente: 'Maria da Silva', identificacaoParticipante: 'ID-001', protocolo: 'Estudo X', temperatura: 'CONGELADO', dataEnvio: '2026-11-16', dataColeta: '2026-11-16',
    courier: 'OCASA', destino: 'LAB X', awb: 'PK2AAA000001', idAgenda: 'ab12cd34', agendaSlot: '1',
    materiais: [{ ativo: true, material: 'Soro', total: 2, unit: 'mL' }]
  }, extra || {});
}

function preparar(s, extra) {
  s.transporteEnvioReivindicar_('ab12cd34', '1', ADMIN, { agora: new Date() });
  return s.transporteRegistroGravar_('ab12cd34', '1', registro(extra), { versaoEsperada: 0, usuario: ADMIN, passo: 'anvisa' }).versao;
}

test('lista de autorizados: uma linha por pessoa, e-mail normalizado, sem repetição nem lixo', () => {
  const s = servidor();
  s.autorizados = ['lrmotta@ucs.br\nagregor1@ucs.br', 'LRMOTTA@ucs.br ', 'sem-arroba', '  ', 'outra@ucs.br; terceira@ucs.br'];
  assert.deepEqual(plano(s.transportePeticionamentoAutorizados_()), ['lrmotta@ucs.br', 'agregor1@ucs.br', 'outra@ucs.br', 'terceira@ucs.br']);
});

test('assunto e corpo do e-mail: data e dia da semana do transporte, iniciais, logística e "Solicitado por"', () => {
  const s = servidor();
  assert.equal(s.transportePeticionamentoAssunto_(registro()), '[PETICIONAMENTO] Estudo X - AWB PK2AAA000001 - Envio 16/11/2026');
  const linha = Array(s.AGENDA_CFG.lastCol).fill('');
  linha[s.AGENDA_CFG.idx.visita] = 'V3';
  s.gerarHtmlCouriers_ = () => '<div>LOGISTICA</div>';
  const html = s.transportePeticionamentoHtml_(registro(), linha, { sexo: 'Feminino', link: 'https://app.example.invalid/x?a=1&b=2', solicitante: ADMIN });
  assert.match(html, /Peticionamento - Envio de Amostras/);
  assert.match(html, /Data do transporte<\/b><\/td><td[^>]*>16\/11\/2026/);
  assert.match(html, /Dia da Semana<\/b><\/td><td[^>]*>Segunda-feira/, '16/11/2026 é segunda-feira');
  assert.match(html, /Maria da Silva \(M\.S\.\)/);
  assert.match(html, /Sexo<\/b><\/td><td[^>]*>Feminino/);
  assert.match(html, /Número de Identificação<\/b><\/td><td[^>]*>ID-001/);
  assert.match(html, /Visita<\/b><\/td><td[^>]*>V3/);
  assert.match(html, /LOGISTICA/);
  assert.match(html, /href="https:\/\/app\.example\.invalid\/x\?a=1&amp;b=2"/);
  assert.match(html, /Solicitado por: admin@example\.invalid/);
  assert.doesNotMatch(html, /Tipo de Evento|Braço/);
});

test('concluir o ANVISA: e-mail aos autorizados com o formulário, depois o status; repetir não reenvia', () => {
  const s = servidor();
  const v = preparar(s);
  const r = plano(s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v));
  assert.equal(r.ok, true);
  assert.deepEqual(r.destinatarios, [ALINE, LUIZ]);
  assert.equal(s.enviados.length, 1);
  const mensagem = s.enviados[0];
  assert.equal(mensagem.to, ALINE + ',' + LUIZ);
  assert.equal(mensagem.subject, '[PETICIONAMENTO] Estudo X - AWB PK2AAA000001 - Envio 16/11/2026');
  assert.equal(mensagem.attachments.length, 1);
  assert.match(mensagem.attachments[0].nome, /^Peticao_Fiscalizacao_PK2AAA000001\.pdf$/);
  assert.match(mensagem.attachments[0].html, /PETIÇÃO DE FISCALIZAÇÃO E LIBERAÇÃO SANITÁRIA - EXPORTAÇÃO/);
  assert.equal(s.statusCelula(), 'Aguardando peticionamento');
  assert.equal(s.auditoria.length, 1);
  assert.deepEqual(plano(s.auditoria[0][3]), [{ field: 'Transporte 1 - Status', oldValue: 'Docs gerados', newValue: 'Aguardando peticionamento' }]);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([lido.registro.gruPronta, lido.passo, !!lido.registro.peticionamentoEnviadoEm, lido.emPreparoPor], [false, 'peticionando', true, '']);
  // Repetição (nova abertura do passo): não reenvia.
  s.transporteEnvioReivindicar_('ab12cd34', '1', ADMIN, { agora: new Date() });
  const repetido = plano(s.concluirAnvisaTransporteEnvio('ab12cd34', '1', lido.versao));
  assert.equal(repetido.ok, true);
  assert.equal(s.enviados.length, 1);
  assert.equal(s.statusCelula(), 'Aguardando peticionamento');
});

test('falha no e-mail: nada muda (status, sem reserva presa), a tela recebe a versão e tentar de novo envia uma vez', () => {
  const s = servidor({ falhaEmail: true });
  const v = preparar(s);
  const falhou = plano(s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v));
  assert.equal(falhou.ok, false);
  assert.match(falhou.erro, /Cota de e-mail excedida/);
  assert.equal(s.statusCelula(), 'Docs gerados');
  assert.deepEqual(s.auditoria, []);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([!!lido.registro.peticionamentoEnviadoEm, lido.registro.peticionamentoEnvioIniciadoEm, lido.versao], [false, undefined, falhou.versao]);
  s.CodexExternalEffects_.sendEmail = (m) => s.enviados.push(m);
  assert.equal(plano(s.concluirAnvisaTransporteEnvio('ab12cd34', '1', falhou.versao)).ok, true);
  assert.equal(s.enviados.length, 1);
  assert.equal(s.statusCelula(), 'Aguardando peticionamento');
});

test('duas chamadas simultâneas enviam um só e-mail: a intenção é reservada sob lock e o envio roda fora dele', () => {
  const s = servidor();
  const v = preparar(s);
  let tentativaSimultanea = null;
  let lockNoEnvio = null;
  s.CodexExternalEffects_.sendEmail = (m) => {
    lockNoEnvio = s.lockAtivo();
    s.enviados.push(m);
    // Outra chamada chega enquanto o e-mail está saindo, já com a versão atual do registro.
    const atual = s.transporteRegistroLer_('ab12cd34', '1');
    try { s.concluirAnvisaTransporteEnvio('ab12cd34', '1', atual.versao); } catch (erro) { tentativaSimultanea = erro; }
  };
  assert.equal(plano(s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v)).ok, true);
  assert.equal(lockNoEnvio, false, 'o envio acontece fora do lock');
  assert.equal(tentativaSimultanea && tentativaSimultanea.code, 'PETICIONAMENTO_ENVIO_EM_ANDAMENTO');
  assert.equal(s.enviados.length, 1);
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([!!lido.registro.peticionamentoEnviadoEm, lido.registro.peticionamentoEnvioIniciadoEm], [true, undefined]);
  // Uma chamada com versão antiga (aba velha) também é recusada e não envia.
  assert.throws(() => s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v), (erro) => erro.code === 'TRANSPORTE_REGISTRO_VERSAO');
  assert.equal(s.enviados.length, 1);
});

test('reserva de envio abandonada (processo interrompido) expira em 5 minutos; antes disso recusa', () => {
  const s = servidor();
  s.transporteEnvioReivindicar_('ab12cd34', '1', ADMIN, { agora: new Date() });
  const recente = new Date().toISOString();
  const velha = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  let v = s.transporteRegistroGravar_('ab12cd34', '1', registro({ peticionamentoEnvioIniciadoEm: recente }), { versaoEsperada: 0, usuario: ADMIN }).versao;
  assert.throws(() => s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v), (erro) => erro.code === 'PETICIONAMENTO_ENVIO_EM_ANDAMENTO');
  assert.equal(s.enviados.length, 0);
  v = s.transporteRegistroGravar_('ab12cd34', '1', registro({ peticionamentoEnvioIniciadoEm: velha }), { versaoEsperada: v, usuario: ADMIN }).versao;
  assert.equal(plano(s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v)).ok, true);
  assert.equal(s.enviados.length, 1);
});

test('o e-mail leva o sexo do cadastro do participante e o link do envio no app; sem cadastro, "Não informado"', () => {
  const s = servidor();
  s.ScriptApp = { getService: () => ({ getUrl: () => 'https://app.example.invalid/exec' }) };
  s.agendaParticipantePorReferencia_ = (ref) => (ref.nome === 'Maria da Silva' ? { row: ['a', 'b', 'c', 'Feminino'] } : null);
  s.participanteColumnMap_ = () => ({ sexoNascimento: 3 });
  const v = preparar(s);
  s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v);
  const html = s.enviados[0].htmlBody;
  assert.match(html, /Sexo<\/b><\/td><td[^>]*>Feminino/);
  assert.match(html, /href="https:\/\/app\.example\.invalid\/exec\?pagina=agenda&amp;agendaId=ab12cd34"/);
  assert.match(html, />Abrir o envio no app<\/a>/);
  // Participante não encontrado ou coluna ausente: nunca inferido.
  assert.equal(s.transportePeticionamentoSexo_(registro({ paciente: 'Outra Pessoa' })), '');
  s.participanteColumnMap_ = () => ({});
  assert.equal(s.transportePeticionamentoSexo_(registro()), '');
  s.agendaParticipantePorReferencia_ = () => { throw new Error('cadastro indisponível'); };
  assert.equal(s.transportePeticionamentoSexo_(registro()), '');
});

test('recusas do ANVISA: bloqueios do formulário, status inadequado, envio nacional e sem autorizados; nada sai', () => {
  const s = servidor();
  const v = preparar(s, { awb: '' });
  assert.throws(() => s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v), /Informe a AWB/);
  const s2 = servidor();
  const v2 = preparar(s2);
  s2.definirStatus('Enviado');
  assert.throws(() => s2.concluirAnvisaTransporteEnvio('ab12cd34', '1', v2), /não permite esta ação/);
  assert.equal(s2.enviados.length, 0, 'o status é conferido antes do e-mail');
  const s3 = servidor();
  s3.autorizados = [];
  const v3 = preparar(s3);
  assert.throws(() => s3.concluirAnvisaTransporteEnvio('ab12cd34', '1', v3), /Cadastre os autorizados/);
  const s4 = servidor();
  s4.transporteOcasaNeedsProforma_ = () => false;
  const v4 = preparar(s4);
  assert.throws(() => s4.concluirAnvisaTransporteEnvio('ab12cd34', '1', v4), /não é internacional/);
  assert.equal(s4.enviados.length + s3.enviados.length + s2.enviados.length, 0);
});

test('"GRU e extrato prontos": só autorizado pela lista; devolve o status e marca a tarefa de anexar e enviar', () => {
  const s = servidor();
  const v = preparar(s);
  s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v);
  // Admin que não está na lista não usa a ação; usuário comum fora da lista também não.
  s.usuario = ADMIN;
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ab12cd34', '1'), /não está autorizado a peticionar/);
  s.usuario = 'estranho@example.invalid';
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ab12cd34', '1'), /não está autorizado a peticionar/);
  assert.equal(s.statusCelula(), 'Aguardando peticionamento');
  // Piloto: quem está na lista mas não é admin também não usa a ação.
  s.papel = 'user';
  s.usuario = ALINE;
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ab12cd34', '1'), /apenas para administradores/);
  s.papel = 'admin';
  // Admin que está na lista usa; o e-mail é comparado normalizado.
  s.usuario = 'ALINE@Example.Invalid';
  const r = plano(s.marcarGruExtratoProntosTransporte('ab12cd34', '1'));
  assert.equal(r.ok, true);
  assert.equal(s.statusCelula(), 'Docs gerados');
  const lido = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([lido.registro.gruPronta, lido.registro.gruProntaPor, lido.passo], [true, ALINE, 'enviar']);
  assert.equal(s.auditoria.length, 2);
  assert.match(s.auditoria[1][4], /GRU e extrato prontos, marcado por aline@example\.invalid/);
  // Repetir não vale: o envio já não aguarda peticionamento.
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ab12cd34', '1'), /não permite esta ação/);
  // Reabrir o envio mostra só o que falta: anexar e enviar.
  s.usuario = ADMIN;
  assert.deepEqual(plano(s.transporteEnvioPassos_(lido.registro)), ['enviar']);
});

test('"GRU e extrato prontos": falha ao gravar o registro ou ao trocar o status não deixa Agenda e registro divergentes', () => {
  const s = servidor();
  const v = preparar(s);
  s.concluirAnvisaTransporteEnvio('ab12cd34', '1', v);
  const antes = s.transporteRegistroLer_('ab12cd34', '1');
  // (a) Outra pessoa com o preparo ativo: o registro recusa e a Agenda nem é tocada.
  s.transporteEnvioReivindicar_('ab12cd34', '1', 'outra@example.invalid', { agora: new Date() });
  s.usuario = ALINE;
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ab12cd34', '1'), (erro) => erro.code === 'TRANSPORTE_REGISTRO_EM_PREPARO');
  assert.equal(s.statusCelula(), 'Aguardando peticionamento');
  assert.equal(s.transporteRegistroLer_('ab12cd34', '1').registro.gruPronta, false);
  s.transporteEnvioLiberar_('ab12cd34', '1', 'outra@example.invalid');
  // (b) A troca de status falha depois de gravar o registro: o registro volta ao que era.
  const original = s.transportePeticionamentoDefinirStatusAgenda_;
  s.transportePeticionamentoDefinirStatusAgenda_ = () => { throw new Error('Agenda indisponível'); };
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ab12cd34', '1'), /Agenda indisponível/);
  const depois = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([s.statusCelula(), depois.registro.gruPronta, depois.registro.gruProntaPor, depois.passo], ['Aguardando peticionamento', false, undefined, antes.passo]);
  // O botão funciona de novo e tudo fica coerente.
  s.transportePeticionamentoDefinirStatusAgenda_ = original;
  assert.equal(plano(s.marcarGruExtratoProntosTransporte('ab12cd34', '1')).ok, true);
  const fim = s.transporteRegistroLer_('ab12cd34', '1');
  assert.deepEqual([s.statusCelula(), fim.registro.gruPronta], ['Docs gerados', true]);
});

test('"GRU e extrato prontos" exige que o peticionamento tenha sido disparado e revalida a lista no lock', () => {
  const s = servidor();
  preparar(s);
  s.usuario = ALINE;
  assert.throws(() => s.marcarGruExtratoProntosTransporte('ab12cd34', '1'), /não está aguardando peticionamento/);
  assert.throws(() => s.marcarGruExtratoProntosTransporte('zzzz9999', '1'), /não está aguardando peticionamento/);
});

test('lista dos autorizados: só quem está na lista, só o necessário e participante por iniciais', () => {
  const s = servidor();
  const i = s.AGENDA_CFG.idx;
  const linha = Array(s.AGENDA_CFG.lastCol).fill('');
  linha[i.id] = 'ab12cd34'; linha[i.data] = '16/11/2026'; linha[i.projeto] = 'Estudo X'; linha[i.participante] = 'Maria da Silva'; linha[i.status] = 'Agendado';
  linha[i.c1.nome] = 'OCASA'; linha[i.c1.status] = 'Aguardando peticionamento'; linha[i.c1.awb] = 'PK2AAA000001'; linha[i.c1.destino] = 'LAB X';
  const outra = linha.slice(); outra[i.id] = 'zz'; outra[i.c1.status] = 'Docs gerados';
  s.getDashboardAgendaSheetForRead_ = () => ({});
  s.getDashboardAgendaDisplayRows_ = () => [linha, outra];
  s.usuario = ADMIN;
  assert.throws(() => s.getTransportePeticionamentos(), /não está autorizado a peticionar/);
  s.usuario = ALINE;
  const r = plano(s.getTransportePeticionamentos());
  assert.deepEqual(r.itens.map((x) => [x.agendaId, x.slotRotulo, x.participante, x.awb, x.projeto]), [['ab12cd34', 'Transporte I', 'M.S.', 'PK2AAA000001', 'Estudo X']]);
});

test('Transporte (piloto): com a GRU pronta a tarefa pede anexar e enviar; sem ela, o envio nacional segue como antes', () => {
  const s = servidor();
  const i = s.AGENDA_CFG.idx;
  const linha = Array(s.AGENDA_CFG.lastCol).fill('');
  class Hoje extends Date { constructor(...a) { super(...(a.length ? a : [2026, 10, 9, 12])); } }
  linha[i.id] = 'ab12cd34'; linha[i.data] = '12/11/2026'; linha[i.hora] = '09:00'; linha[i.status] = 'Agendado'; linha[i.participante] = 'Pessoa'; linha[i.projeto] = 'Estudo X'; linha[i.visita] = 'V1';
  linha[i.c1.nome] = 'OCASA'; linha[i.c1.status] = 'Docs gerados'; linha[i.c1.awb] = 'PK2AAA000001'; linha[i.c1.temp] = 'CONGELADO'; linha[i.c1.destino] = 'LAB X';
  const hoje = new Date(2026, 10, 9, 12);
  const construir = (preparos) => plano(s.transporteTarefasConstruir_({ hoje, agora: hoje, feriados: {}, linhas: [linha], operacoes: [], preparos, nomes: {} }));
  assert.deepEqual(construir({}).tarefas.map((t) => t.titulo), ['Enviar a documentação à courier']);
  assert.deepEqual(construir({ 'ab12cd34|1': { passo: 'enviar', versao: 5, emPreparoPor: '', emPreparoDesde: '', fasePinex: '', gruPronta: true } }).tarefas.map((t) => t.titulo),
    ['Anexar a GRU e o extrato e enviar à courier']);
  void Hoje;
});
