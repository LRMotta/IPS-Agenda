'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, readProjectFile } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

const LARGURA = 60;

// Conta as leituras da Agenda: largura inteira, coluna inteira e linha avulsa.
function comContagem(aba, opcoes = {}) {
  const getRange = aba.getRange.bind(aba);
  aba.leiturasCompletas = 0;
  aba.leiturasColuna = 0;
  aba.leiturasLinha = 0;
  aba.getRange = (row, col, nr, nc) => {
    const range = getRange(row, col, nr, nc);
    if (typeof row !== 'number') return range;
    const getValues = range.getValues.bind(range);
    range.getValues = () => {
      if (nr > 1 && nc > 1) aba.leiturasCompletas++;
      else if (nr > 1) aba.leiturasColuna++;
      else aba.leiturasLinha++;
      return getValues();
    };
    if (opcoes.semBusca) range.createTextFinder = undefined;
    if (opcoes.buscaFalha) range.createTextFinder = () => { throw new Error('busca indisponivel'); };
    return range;
  };
  return aba;
}

function fixture(opcoes) {
  const agenda = comContagem(new FakeSheet('Agenda', [Array(LARGURA).fill('')]), opcoes);
  const folha = new FakeSheet('Folha de Agendamento', Array.from({ length: 15 }, () => ['', '', '']));
  const range = folha.getRange.bind(folha);
  folha.getRange = (address, ...args) => {
    if (typeof address === 'number') return range(address, ...args);
    const r = address === 'C3:C15' ? range(3, 3, 13, 1) : range(15, 3);
    r.getNote = () => '';
    return r;
  };
  const ss = new FakeSpreadsheet({ Agenda: agenda, 'Folha de Agendamento': folha });
  let seq = 0;
  const c = runFiles(['AgendaServerRules.gs', 'WebApp.gs', 'TransporteCodexConfig.gs'], {
    Logger: { log() {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => (++seq).toString(16).padStart(32, '0'), formatDate: () => '21/10/2026' }
  });
  c.getAgendaSheetForRead_ = () => agenda;
  c.getTransporteSpreadsheetCodex_ = () => ss;
  const i = c.AGENDA_CFG.idx;
  const slots = [i.c1, i.c2, i.c3];
  function row(id, { awb = '', slot = 1, courier = 'MARKEN', temp = 'CONGELADO', status = 'Agendado', courierStatus = 'Agendado', campos = {} } = {}) {
    const r = Array(LARGURA).fill('');
    Object.assign(r, { [i.id]: id, [i.participante]: 'Pessoa ' + id, [i.projeto]: 'Estudo', [i.data]: '21/10/2026', [i.status]: status }, campos);
    const s = slots[slot - 1];
    Object.assign(r, { [s.awb]: awb, [s.nome]: courier, [s.temp]: temp, [s.status]: courierStatus });
    agenda.rows.push(r);
    return r;
  }
  function historico(linhas) {
    const sheet = new FakeSheet('AWB_Utilizadas', [c.CODEX_AWB_HEADERS_.slice()].concat(linhas));
    ss.sheets = ss.sheets || {};
    const getSheetByName = ss.getSheetByName.bind(ss);
    ss.getSheetByName = (nome) => (nome === 'AWB_Utilizadas' ? sheet : getSheetByName(nome));
    return sheet;
  }
  return { c, agenda, ss, i, row, historico, comLock: (fn) => c.codexWithDocumentLock_('teste-awb', fn) };
}

function cenario(f) {
  const { i, row } = f;
  row('ATIVA', { awb: '620X41337652' });
  row('CANCELADA', { awb: '620X11111111', courierStatus: 'Cancelado' });
  row('REUSO-1', { awb: '620X22222222', status: 'Cancelado' });
  row('REUSO-2', { awb: '620X22222222', slot: 2 });
  row('DHL-AMB', { awb: '3539829812', courier: 'DHL', temp: 'Ambiente', courierStatus: 'Cancelado' });
  row('DHL-REF', { awb: '3539829813', courier: 'DHL', temp: 'Refrigerado', courierStatus: 'Cancelado' });
  row('SEPARADA', { awb: '620-x 33333333' });
  row('OCASA', { awb: 'PK2OZB276947', courier: 'OCASA', temp: 'AMBIENTE', slot: 3 });
  row('BACKUP', { campos: {
    [i.cb.nome]: 'MARKEN', [i.cb.temp]: 'CONGELADO', [i.cb.status]: 'Agendado',
    [i.backupAgendaRef]: JSON.stringify([{ id: 'DESTINO', slot: 'II', awb: '620X55555555' }])
  } });
  row('DESTINO', { awb: '620X55555555', slot: 2 });
  // O destino so aparece pelo vinculo: sem a AWB na linha, o cancelamento dele decide a liberacao.
  row('BACKUP-2', { campos: {
    [i.cb.nome]: 'MARKEN', [i.cb.temp]: 'CONGELADO', [i.cb.status]: 'Agendado',
    [i.backupAgendaRef]: JSON.stringify([{ id: 'DESTINO-CANCELADO', slot: 'I', awb: '620X88888888' }])
  } });
  row('DESTINO-CANCELADO', { courierStatus: 'Cancelado' });
  row('SEM-AWB-AGORA', { courierStatus: 'Cancelado' });
  row('NUMERICA', { awb: 3539829814, courier: 'DHL', temp: 'Refrigerado' }); // Celula numerica, como em dados antigos.
  row('LIVRE');
  f.historico([
    ['620X44444444', 'AGD:SEM-AWB-AGORA:1', 'SEM-AWB-AGORA', '1', 'MARKEN', 'CONGELADO', 'Pessoa', 'Estudo', '', 'Agendado', ''],
    ['620X66666666', 'MANUAL:abc', '', '', 'OCASA', 'AMBIENTE', 'Pessoa', 'Estudo', '', '', ''],
    // Forma antiga na Agenda: a busca nao a acha, o historico sim (ver limite conhecido).
    ['620-x 33333333', 'AGD:SEPARADA:1', 'SEPARADA', '1', 'MARKEN', 'CONGELADO', 'Pessoa', 'Estudo', '', 'Agendado', '']
  ]);
}

test('contexto focado decide igual ao completo para todas as combinacoes do cenario', () => {
  const f = fixture();
  cenario(f);
  const awbs = ['620X41337652', '620x-41337652', '620X11111111', '620X22222222', '3539829812', '3539829813', '620X33333333',
    'PK2OZB276947', '620X55555555', '620X44444444', '620X66666666', '620X88888888', '3539829814', '620X99999999'];
  const couriers = [['MARKEN', 'CONGELADO'], ['DHL', 'AMBIENTE'], ['OCASA', 'AMBIENTE']];
  const envios = [['LIVRE', '1'], ['ATIVA', '1'], ['DESTINO', '2'], ['BACKUP', 'backup'], ['CANCELADA', '1'], ['', '']];
  const decidir = (context, entry, strict) => {
    const conflito = f.c.agendaAwbConflito_(context, entry);
    let mensagem = '';
    try { f.c.agendaAwbReservar_(context, [entry], strict, true); } catch (e) { mensagem = e.message; }
    return { conflito: conflito ? f.c.agendaAwbMensagem_(entry.awb, conflito) : null, mensagem };
  };
  let conflitos = 0, combinacoes = 0;
  for (const awb of awbs) for (const [courier, temperatura] of couriers) for (const [idAgenda, agendaSlot] of envios) for (const strict of [true, false]) {
    const registro = { awb, courier, temperatura, idAgenda, agendaSlot, envioId: 'a'.repeat(32) };
    const entry = f.c.transporteAwbRegistro_(registro);
    const completo = decidir(f.c.agendaAwbContexto_(f.agenda), entry, strict);
    const focado = decidir(f.c.agendaAwbContextoFocado_(f.agenda, awb, [idAgenda]), entry, strict);
    assert.deepEqual(focado, completo, JSON.stringify(registro));
    combinacoes++;
    if (completo.conflito) conflitos++;
  }
  assert.equal(combinacoes, awbs.length * couriers.length * envios.length * 2);
  assert.ok(conflitos > 50, 'o cenario precisa exercitar conflitos reais');
  assert.ok(conflitos < combinacoes, 'o cenario precisa exercitar liberacoes');
});

test('geracao reserva, grava e avisa a AWB sem ler a Agenda inteira', () => {
  const f = fixture();
  cenario(f);
  const payload = { awb: '620X77777777', courier: 'MARKEN', temperatura: 'CONGELADO', idAgenda: 'LIVRE', agendaSlot: '1' };
  const linhaLivre = f.agenda.rows.findIndex((r) => r[f.i.id] === 'LIVRE') + 1;
  f.comLock(() => {
    f.c.transporteAwbReservar_(payload, true);
    const leituras = f.agenda.leiturasColuna + f.agenda.leiturasLinha;
    assert.ok(f.agenda.leiturasColuna <= 1, 'no maximo a coluna de ID, que a producao ja traz lembrada');
    f.c.agendaAwbReservarCelula_(f.agenda.getRange(linhaLivre, f.i.c1.awb + 1), payload.awb, 'MARKEN');
    assert.equal(f.c.transporteAwbAviso_(payload), null);
    assert.equal(f.agenda.leiturasColuna + f.agenda.leiturasLinha, leituras + 2, 'gravacao e aviso reaproveitam o contexto do lock; so a celula gravada e relida');
  });
  assert.equal(f.agenda.leiturasCompletas, 0);
  const ledger = f.ss.getSheetByName('AWB_Utilizadas').rows;
  assert.equal(ledger.filter((r) => r[0] === '620X77777777' && r[1] === 'AGD:LIVRE:1').length, 1, 'reserva entra uma vez no historico');
});

test('AWB ja usada continua bloqueando a geracao, com a mesma mensagem, pelo contexto focado', () => {
  const f = fixture();
  cenario(f);
  const payload = { awb: '620 x 41337652', courier: 'MARKEN', temperatura: 'CONGELADO', idAgenda: 'LIVRE', agendaSlot: '1' };
  assert.throws(() => f.comLock(() => f.c.transporteAwbReservar_(payload, true)), /já foi utilizada em outro envio.*Agendamento ATIVA/);
  assert.equal(f.agenda.leiturasCompletas, 0);
});

test('aviso de AWB fora do lock nao le a Agenda inteira nem guarda contexto', () => {
  const f = fixture();
  cenario(f);
  const aviso = f.c.transporteAwbAviso_({ awb: '620X41337652', courier: 'MARKEN', idAgenda: 'LIVRE', agendaSlot: '1' });
  assert.match(aviso.text, /Agendamento ATIVA/);
  assert.equal(f.agenda.leiturasCompletas, 0);
  assert.equal(f.c.CODEX_AWB_CONTEXT_FOCO_, null);
});

test('contexto do lock nao passa para o proximo lock nem serve a outra AWB ou outro envio', () => {
  const f = fixture();
  cenario(f);
  f.comLock(() => {
    const primeiro = f.c.agendaAwbContextoFocado_(f.agenda, '620X77777777', ['LIVRE']);
    assert.equal(f.c.agendaAwbContextoFocado_(f.agenda, '620x-77777777', ['LIVRE']), primeiro);
    assert.notEqual(f.c.agendaAwbContextoFocado_(f.agenda, '620X88888888', ['LIVRE']), primeiro);
    const atual = f.c.agendaAwbContextoFocado_(f.agenda, '620X88888888', ['LIVRE']);
    assert.notEqual(f.c.agendaAwbContextoFocado_(f.agenda, '620X88888888', ['ATIVA']), atual);
  });
  assert.equal(f.c.CODEX_AWB_CONTEXT_FOCO_, null);
});

test('reusar sem contexto focado compativel faz a leitura completa', () => {
  const f = fixture();
  cenario(f);
  f.comLock(() => {
    f.c.agendaAwbContextoFocado_(f.agenda, '620X77777777', ['LIVRE']);
    f.c.agendaAwbContextoReusar_(f.agenda, '620X88888888', 'LIVRE');
  });
  assert.equal(f.agenda.leiturasCompletas, 1);
});

for (const [nome, opcoes] of [['sem TextFinder', { semBusca: true }], ['com falha da busca', { buscaFalha: true }]]) {
  test('contexto focado cai na leitura completa ' + nome, () => {
    const f = fixture(opcoes);
    cenario(f);
    const payload = { awb: '620X41337652', courier: 'MARKEN', temperatura: 'CONGELADO', idAgenda: 'LIVRE', agendaSlot: '1' };
    assert.throws(() => f.comLock(() => f.c.transporteAwbReservar_(payload, true)), /Agendamento ATIVA/);
    assert.equal(f.agenda.leiturasCompletas, 1);
  });
}

test('limite conhecido: forma antiga da AWB fora do historico so aparece se digitada igual', () => {
  const f = fixture();
  f.row('ANTIGA', { awb: '620-X 12345678' });
  f.row('LIVRE');
  const conflito = (awb) => f.c.agendaAwbConflito_(f.c.agendaAwbContextoFocado_(f.agenda, awb, ['LIVRE']),
    f.c.transporteAwbRegistro_({ awb, courier: 'MARKEN', temperatura: 'CONGELADO', idAgenda: 'LIVRE', agendaSlot: '1' }));
  assert.equal(conflito('620X12345678'), null, 'nao vista: depende do historico');
  assert.ok(f.c.agendaAwbConflito_(f.c.agendaAwbContexto_(f.agenda), f.c.transporteAwbRegistro_({ awb: '620X12345678', courier: 'MARKEN', temperatura: 'CONGELADO', idAgenda: 'LIVRE', agendaSlot: '1' })), 'o contexto completo ve e repoe no historico');
  assert.ok(conflito('620-X 12345678'), 'digitada igual e vista');
});

test('envio com ID em outra caixa e achado pela coluna de IDs', () => {
  const f = fixture();
  f.row('envio-minusculo', { awb: '', courierStatus: 'Cancelado' });
  f.row('LIVRE');
  f.historico([['620X77777777', 'AGD:ENVIO-MINUSCULO:1', '', '1', 'MARKEN', 'CONGELADO', 'Pessoa', 'Estudo', '', 'Agendado', '']]);
  const contexto = f.c.agendaAwbContextoFocado_(f.agenda, '620X77777777', ['LIVRE']);
  assert.ok(contexto.current['AGD:ENVIO-MINUSCULO:1'], 'o status atual do dono decide a liberacao');
});

test('AWB citada em linhas demais usa a leitura completa', () => {
  const f = fixture();
  for (let n = 0; n < f.c.CODEX_AWB_FOCO_MAX_LINHAS_ + 1; n++) f.row('LOTE-' + n, { awb: 'ABC123', courier: 'PINEX' });
  f.c.agendaAwbContextoFocado_(f.agenda, 'ABC123', []);
  assert.equal(f.agenda.leiturasCompletas, 1);
});

test('historico invalido continua bloqueando pelo contexto focado', () => {
  const f = fixture();
  f.row('LIVRE');
  f.row('OUTRA');
  f.historico([['', 'AGD:X:1', 'X', '1', '', '', '', '', '', '', '']]);
  assert.throws(() => f.c.agendaAwbContextoFocado_(f.agenda, '620X77777777', ['LIVRE']), /registro inválido no histórico/);
});

test('vinculo de Backup e atualizado sem ler a Agenda inteira, conferindo o ID exato', () => {
  const f = fixture({ comBusca: true });
  const { c, i, agenda } = f;
  c.codexWriteAuditChanges_ = () => {};
  const ref = (id) => JSON.stringify({ id, slot: 'I', awb: 'ANTIGA' });
  f.row('ORIGEM', { campos: { [i.backupAgendaRef]: ref('DESTINO') } });
  f.row('PARECIDO', { campos: { [i.backupAgendaRef]: ref('DESTINO-2') } });
  f.row('TEXTO', { campos: { [i.obs]: 'cita DESTINO na observacao' } });
  const destino = f.row('DESTINO');
  assert.equal(c.agendaAtualizarBackupAwbVinculado_(agenda, agenda.rows.indexOf(destino) + 1, 'NOVA', 'I').atualizado, 1);
  assert.equal(JSON.parse(agenda.rows[1][i.backupAgendaRef]).awb, 'NOVA');
  assert.equal(JSON.parse(agenda.rows[2][i.backupAgendaRef]).awb, 'ANTIGA');
  assert.equal(agenda.leiturasCompletas, 0);
});

test('Backup II vinculado e atualizado pela busca na mesma linha da varredura', () => {
  for (const opcoes of [{ comBusca: true }, { semBusca: true }]) {
    const f = fixture(opcoes);
    const { c, agenda } = f;
    c.AGENDA_CFG.col.backup2Dados = 50;
    c.AGENDA_CFG.idx.backup2Dados = 49;
    c.codexWriteAuditChanges_ = () => {};
    const gravadas = [];
    c.agendaBackup2Write_ = (_aba, linha, dados) => gravadas.push([linha, dados.agendamentos[0].awb]);
    const dados = JSON.stringify({ nome: 'MARKEN', agendamentos: [{ id: 'DESTINO', slot: 'I', awb: 'ANTIGA' }] });
    f.row('SEM-VINCULO');
    f.row('ORIGEM', { campos: { 49: dados } });
    const destino = f.row('DESTINO');
    c.agendaAtualizarBackupAwbVinculado_(agenda, agenda.rows.indexOf(destino) + 1, 'NOVA', 'I');
    assert.deepEqual(gravadas, [[3, 'NOVA']]);
    assert.equal(agenda.leiturasCompletas, opcoes.semBusca ? 1 : 0);
  }
});

test('Gerar PDF e Gerar PDF (HTML) passam pela mesma checagem focada no salvamento', () => {
  const fonte = readProjectFile('TransporteCodexConfig.gs').replace(/\r\n/g, '\n');
  const corpo = (nome) => { const a = fonte.indexOf('function ' + nome + '('); return fonte.slice(a, fonte.indexOf('\nfunction ', a + 10)); };
  assert.match(corpo('gerarPdfTransporteInterno_'), /savedTransport = salvarTransporteInterno_\(options\.payload/);
  assert.doesNotMatch(corpo('salvarTransporteInterno_'), /formato/i, 'o salvamento nao depende do formato do PDF');
  assert.match(corpo('salvarTransporteInterno_'), /transporteAwbReservar_\(payload/);
  assert.match(corpo('transporteAwbReservar_'), /agendaAwbContextoFocado_\(agendaAwb, payload\.awb/);
  assert.doesNotMatch(corpo('transporteAwbReservar_'), /agendaAwbContexto_\(/);
  assert.match(corpo('transporteAwbAviso_'), /agendaAwbContextoFocado_\(/);
});

test('caixa nao le Courier nem LabCentral quando o projeto nao tem regra', () => {
  const { c } = fixture();
  const coluna = 'Caixas especiais transporte (JSON)';
  c.getCodexSheetDataByName_ = () => [['ID', 'Nome', 'Codigo', coluna], ['1', 'Outro', 'OUT', '[{"courierId":"1"}]'], ['2', 'Estudo', 'EST', '']];
  c.getAgendaCourierRows_ = () => { throw new Error('leitura desnecessaria'); };
  c.getProjetoCaixasLaboratorios_ = () => { throw new Error('leitura desnecessaria'); };
  assert.deepEqual(Array.from(c.transporteCaixasRegras_(c.transporteParticipantKey_('Estudo'))), []);
  c.getAgendaCourierRows_ = () => [{ id: '1', nome: 'MARKEN' }];
  c.getProjetoCaixasLaboratorios_ = () => [];
  const regras = c.transporteCaixasRegras_(c.transporteParticipantKey_('Outro'));
  assert.equal(regras.length, 1);
  assert.match(regras[0].erro, /Revise as caixas especiais/);
  assert.equal(c.transporteCaixasRegras_().length, 1, 'sem chave, todas as regras seguem disponiveis');
});

test('registrar a base do lembrete nao le os feriados', () => {
  const fonte = readProjectFile('CourierLembretes.gs').replace(/\r\n/g, '\n');
  const a = fonte.indexOf('function courierLembreteRegistrarBase_(');
  assert.match(fonte.slice(a, fonte.indexOf('\nfunction ', a + 10)), /courierLembreteAgendaSnapshot_\(true, true\)/);
  assert.match(fonte, /feriados: semFeriados \? null : getAgendaFeriadosPendenciasMap_\(\)/);
});

test('abrir a Agenda para gravacao le o cabecalho uma vez quando as colunas ja existem', () => {
  const { c } = fixture();
  const largura = c.AGENDA_CFG.lastCol + 10;
  const cabecalho = Array(largura).fill('x');
  ['Backup - Temperatura', 'ID Cadastro Participante', 'Backup II - Dados'].forEach((nome, n) => { cabecalho[largura - 1 - n] = nome; });
  c.AGENDA_TRANSPORTE4_COLUNAS_.forEach((def, n) => { cabecalho[largura - 4 - n] = def.label; });
  let leituras = 0, celulas = 0;
  const aba = {
    getLastColumn: () => largura,
    getMaxColumns: () => largura,
    getRange(row, col, nr, nc) {
      if (row === 1 && col === 1 && nc === largura) return { getValues: () => { leituras++; return [cabecalho.slice()]; } };
      return { getValue: () => { celulas++; return 'x'; }, setValue() { throw new Error('nao grava com as colunas presentes'); } };
    }
  };
  c.codexCacheGet_ = () => null;
  c.codexCachePut_ = () => {};
  c.ensureAgendaDestinoLabColumns_(aba);
  assert.equal(leituras, 1);
  assert.equal(celulas, 0, 'a conferencia dos rotulos usa o cabecalho ja lido');
  assert.ok(c.AGENDA_CFG.col.backup2Dados > 0 && c.AGENDA_CFG.col.c4.awb > 0);
});

test('coluna opcional ausente continua sendo criada ao abrir a Agenda para gravacao', () => {
  const { c } = fixture();
  const cabecalho = Array(c.AGENDA_CFG.lastCol).fill('x');
  const gravadas = [];
  const aba = {
    getLastColumn: () => cabecalho.length,
    getMaxColumns: () => 500,
    insertColumnsAfter() {},
    getRange(row, col, nr, nc) {
      if (nc > 1) return { getValues: () => [cabecalho.slice()] };
      return { setValue(valor) { gravadas.push(valor); cabecalho[col - 1] = valor; } };
    }
  };
  c.codexCacheGet_ = () => null;
  c.codexCachePut_ = () => {};
  c.ensureAgendaDestinoLabColumns_(aba);
  for (const nome of ['Backup - Temperatura', 'ID Cadastro Participante', 'Backup II - Dados', 'Transporte IV - Courier']) assert.ok(gravadas.includes(nome), nome);
});

test('CE e procurada uma vez por execucao para o aviso e o anexo', () => {
  const { c } = fixture();
  let buscas = 0;
  const arquivo = { getName: () => 'CE.pdf', getUrl: () => 'url', getBlob: () => 'blob' };
  c.transporteCodexFindComunicadoEspecial_ = () => { buscas++; return arquivo; };
  assert.equal(c.transporteComunicadoEspecialDaExecucao_({}, 'Estudo'), arquivo);
  assert.equal(c.transporteCodexEmailAttachments_({}, 'Estudo')[0], 'blob');
  assert.equal(buscas, 1);
  c.transporteComunicadoEspecialDaExecucao_({}, 'Outro');
  assert.equal(buscas, 2, 'outro projeto procura o proprio arquivo');
  c.transporteCodexFindComunicadoEspecial_ = () => { buscas++; return null; };
  assert.equal(c.transporteComunicadoEspecialDaExecucao_({}, 'Sem CE'), null);
  c.transporteComunicadoEspecialDaExecucao_({}, 'Sem CE');
  assert.equal(buscas, 4, 'ausencia nao fica guardada');
});

test('aba com esquema garantido na execucao nao rele o cabecalho, exceto na leitura instrumentada', () => {
  // A fixture substitui esta funcao; aqui vale a original.
  const c = runFiles(['AgendaServerRules.gs', 'WebApp.gs'], { Logger: { log() {} } });
  const planilha = {};
  let buscas = 0;
  const aba = { getLastColumn: () => 0 };
  c.getCodexSpreadsheet_ = () => planilha;
  c.getSheetByPossibleNames_ = () => { buscas++; return aba; };
  c.CODEX_AGENDA_SHEET_MEMO_ = { ss: planilha, sh: aba };
  assert.equal(c.getAgendaSheetForRead_(), aba);
  assert.equal(buscas, 0);
  c.CODEX_AGENDA_SHEET_MEMO_ = { ss: {}, sh: {} };
  assert.equal(c.getAgendaSheetForRead_(), aba, 'memoria de outra planilha nao vale');
  assert.equal(buscas, 1);
});
