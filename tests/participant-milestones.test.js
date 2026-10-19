'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');
const { FakeSheet, FakeSpreadsheet } = require('./helpers/fake-spreadsheet');

function fixture() {
  const headers = ['ID','Nome','Nascimento','Idade','ID Participante','Projeto','Braço','Última visita','Status','Telefone','CPF','Obs','ID Pessoa','CTMS Marcos (JSON)','CTMS Escolhas de Referência (JSON)'];
  const row = ['1','Pessoa','','','P1','Estudo','A','','Ativo','','','','PES1',JSON.stringify({ RANDOMIZACAO:'2026-09-01', ULTIMA_DOSE:'2026-10-01', OUTRA:'2026-08-01' }),''];
  const other = ['2','Outra','','','P2','Outro estudo','B','','Ativo','','','','PES2',JSON.stringify({ RANDOMIZACAO:'2025-01-01' }),''];
  const sheet = new FakeSheet('Participantes',[headers,row,other]);
  const book = new FakeSpreadsheet({ Participantes:sheet });
  const server = runFiles(['CadastroRules.gs','WebApp.gs'], {
    Date, SpreadsheetApp:{getActiveSpreadsheet:()=>book, flush() {}}, Session:{getScriptTimeZone:()=> 'America/Sao_Paulo'},
    Utilities:{getUuid:()=> 'unique-test-id',formatDate:d=> [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
  });
  server.codexAssertCanWrite_ = () => {};
  server.codexAssertCanRead_ = () => {};
  server.codexWithDocumentLock_ = (_,f) => f();
  server.codexLogPerformance_ = () => {};
  server.getProjetosParticipantesOptions_ = () => ['Estudo','Outro estudo'];
  server.brasilNormalizarLocalidade_ = () => {};
  server.clearCodexRuntimeCaches_ = () => {};
  server.clearTransporteOptionsCache_ = () => {};
  server.codexWriteAuditChanges_ = () => {};
  server.participantePossuiEventoAgenda_ = () => false;
  server.getCodexSpreadsheet_ = () => book;
  server.getSoAVisitasProjeto = () => [];
  server.getBracosProjeto = () => [];
  server.getJornadaParticipante = () => ({});
  const payload = {sexoNascimento:'Não informado',id:'1',nome:'Pessoa',idParticipante:'P1',projeto:'Estudo',braco:'A',status:'Ativo',cpf:''};
  const read = () => server.participanteCtmsJsonObject_(sheet.rows[1][server.participanteCtmsColumnMapFromHeaders_(sheet.rows[0]).marcosJson]);
  return { server, sheet, payload, read };
}

test('cadastro atualiza apenas os marcos enviados, preserva outra participação e compartilha os dados da Jornada', () => {
  const {server:s,sheet,payload:p,read} = fixture();
  p.marcosParticipacao = {DECISAO_INTERRUPCAO_TRATAMENTO:'2026-10-03', ULTIMA_DOSE:''};
  p.marcosParticipacaoBase = {DECISAO_INTERRUPCAO_TRATAMENTO:'', ULTIMA_DOSE:'2026-10-01'};
  const other = JSON.stringify(sheet.rows[2]);
  assert.match(s.salvarDadosParticipante(p), /atualizado/);
  assert.equal(read().DECISAO_INTERRUPCAO_TRATAMENTO,'2026-10-03');
  assert.equal(read().RANDOMIZACAO,'2026-09-01');
  assert.equal(read().OUTRA,'2026-08-01');
  assert.equal(read().ULTIMA_DOSE,undefined);
  assert.equal(JSON.stringify(sheet.rows[2].slice(0,JSON.parse(other).length)),other);
  s.getCodexSheetDataByName_ = () => sheet.rows;
  assert.equal(s.jornadaCtmsLerConfigParticipante_({idCadastro:'1',projeto:'Estudo'}).marcos.DECISAO_INTERRUPCAO_TRATAMENTO,'2026-10-03');
});

test('data inválida ou marco desatualizado rejeita todo o cadastro antes de qualquer escrita', () => {
  for (const value of ['2026-02-30','2026-13-01',null]) {
    const {server:s,sheet,payload:p} = fixture();
    p.marcosParticipacao = {RANDOMIZACAO:value}; p.marcosParticipacaoBase = {RANDOMIZACAO:'2026-09-01'};
    const before = JSON.stringify(sheet.rows);
    assert.throws(()=>s.salvarDadosParticipante(p), /data|Data/);
    assert.equal(sheet.writes,0);
    assert.equal(JSON.stringify(sheet.rows),before);
  }
  const {server:s,sheet,payload:p} = fixture();
  p.marcosParticipacao = {RANDOMIZACAO:'2026-09-02'}; p.marcosParticipacaoBase = {RANDOMIZACAO:'2026-08-01'};
  assert.throws(()=>s.salvarDadosParticipante(p), /mudaram/);
  assert.equal(sheet.writes,0);
});

test('omissão dos marcos mantém datas; atualização parcial da Jornada conserva campos não exibidos', () => {
  const {server:s,payload:p,read} = fixture();
  s.salvarDadosParticipante(p);
  assert.equal(read().ULTIMA_DOSE,'2026-10-01');
  s.salvarConfiguracaoCtmsParticipante_({idCadastro:'1',projeto:'Estudo',marcos:{RANDOMIZACAO:'2026-09-02'},marcosParticipacaoBase:{RANDOMIZACAO:'2026-09-01'},marcosAtualizacaoParcial:true});
  assert.equal(read().RANDOMIZACAO,'2026-09-02');
  assert.equal(read().ULTIMA_DOSE,'2026-10-01');
  assert.equal(read().OUTRA,'2026-08-01');
});

test('configuração CTMS rejeita base obsoleta ou ausente antes de qualquer escrita', () => {
  for (const base of [undefined, {}, { RANDOMIZACAO: '2026-08-01' }]) {
    const {server:s,sheet} = fixture();
    const before = JSON.stringify(sheet.rows);
    assert.throws(() => s.salvarConfiguracaoCtmsParticipante_({ idCadastro:'1', projeto:'Estudo', marcos:{RANDOMIZACAO:'2026-09-02'}, marcosParticipacaoBase:base, marcosAtualizacaoParcial:true }), /mudaram/);
    assert.equal(sheet.writes, 0);
    assert.equal(JSON.stringify(sheet.rows), before);
  }
});

test('CTMS lê regras sob lock, detecta concorrência e audita datas e escolhas efetivas', () => {
  const {server:s,sheet,read} = fixture();
  let locked = false;
  const audits = [];
  s.codexWithDocumentLock_ = (_, action) => { locked = true; try { return action(); } finally { locked = false; } };
  s.getSoAVisitasProjeto = () => { assert.equal(locked, true); return [{ idSoA:'V1', criterioReferencias:'SELECAO_MANUAL', referencia:'RANDOMIZACAO', referenciaAlternativa:'ULTIMA_DOSE' }]; };
  s.getBracosProjeto = () => { assert.equal(locked, true); return [{idBraco:'BR1'}]; };
  s.SpreadsheetApp.flush = () => assert.equal(locked, true);
  s.codexWriteAuditChanges_ = (...args) => { assert.equal(locked, true); audits.push(args); };
  s.salvarConfiguracaoCtmsParticipante_({idCadastro:'1', projeto:'Estudo', bracoId:'BR1', escolhasReferencias:{V1:'ULTIMA_DOSE'}, marcos:{RANDOMIZACAO:'2026-09-02', ULTIMA_DOSE:''}, marcosParticipacaoBase:{RANDOMIZACAO:'2026-09-01', ULTIMA_DOSE:'2026-10-01'}, marcosAtualizacaoParcial:true});
  assert.equal(read().RANDOMIZACAO, '2026-09-02');
  assert.equal(read().ULTIMA_DOSE, undefined);
  assert.equal(read().OUTRA, '2026-08-01');
  assert.equal(audits[0][2], '1');
  assert.equal(audits[0][3].length, 4);
  const before = JSON.stringify(sheet.rows);
  assert.throws(() => s.salvarConfiguracaoCtmsParticipante_({idCadastro:'1', projeto:'Estudo', marcos:{RANDOMIZACAO:'2026-09-03'}, marcosParticipacaoBase:{RANDOMIZACAO:'2026-09-01'}, marcosAtualizacaoParcial:true}), /mudaram/);
  assert.equal(JSON.stringify(sheet.rows), before);
});

test('referência ausente fica pendente; decisão documentada calcula EOT sem usar a última dose', () => {
  const {server:s} = fixture();
  const visits = [{idSoA:'EOT',codigo:'EOT',nome:'Fim do tratamento',ativo:true,ordem:1,bracoIds:[],referencia:'DECISAO_INTERRUPCAO_TRATAMENTO',intervaloDias:7,janelaDiasMenos:0,janelaDiasMais:0,baseCalculo:'MANTER_DATAS_PREVISTAS',papelCronograma:'VISITA_CALCULADA'}];
  const input = {visitas:visits,marcos:{ULTIMA_DOSE:'2026-10-01'},eventos:[]};
  const pending = s.jornadaCtmsCalcularPreviaPura_(input);
  assert.equal(pending.linhas[0].statusCalculo,'PENDENTE');
  input.marcos.DECISAO_INTERRUPCAO_TRATAMENTO = '2026-10-03';
  const ready = s.jornadaCtmsCalcularPreviaPura_(input);
  assert.equal(ready.linhas[0].dataPrevistaIso,'2026-10-10');
});

test('participação com marcos documentados não pode transferir suas datas a outro estudo', () => {
  const {server:s,sheet,payload:p} = fixture();
  p.projeto = 'Outro estudo';
  assert.throws(()=>s.salvarDadosParticipante(p), /nova participação/);
  assert.equal(sheet.writes,0);
});
