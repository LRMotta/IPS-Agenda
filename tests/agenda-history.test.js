'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runFiles}=require('./helpers/load-app-script');
const {FakeSheet,FakeSpreadsheet}=require('./helpers/fake-spreadsheet');
function row(id='A',field='Data',old='20/10/2026',value='22/10/2026',action='atualizarAgendaEventoCompleto') {
  return ['AUD',new Date('2026-10-15T12:00:00Z'),'equipe@exemplo.org','Agenda',action,id,field,old,value,'Nota técnica privada'];
}
function fixture(rows) {
  const sheet=new FakeSheet('Audit_Changes',[Array(10).fill('header'),...rows]);
  const reads=[];
  const c=runFiles(['AgendaHistory.gs'],{Date,
    Utilities:{formatDate:(date,zone)=>{assert.equal(zone,'America/Sao_Paulo');return date.toISOString();}}
  });
  c.codexAssertCanRead_=()=>({ok:true});
  c.getCodexSpreadsheet_=()=>new FakeSpreadsheet({Audit_Changes:sheet});
  c.codexMeasureReadPerformance_=(_o,_s,_m,fn)=>fn();
  c.codexReadValuesMeasured_=(range)=>{reads.push({rows:range.numRows,cells:range.numRows*range.numColumns});return range.getValues();};
  return {c,sheet,reads};
}

test('histórico autoriza antes de acessar a fonte, rejeita IDs/cursor e não cria abas',()=>{
  const {c,sheet}=fixture([]);
  c.codexAssertCanRead_=()=>{throw Error('NEGADO');};
  c.getCodexSpreadsheet_=()=>{throw Error('Não ler');};
  assert.throws(()=>c.getAgendaHistorico('A'),/NEGADO/);
  c.codexAssertCanRead_=()=>({ok:true});
  assert.throws(()=>c.getAgendaHistorico(''),/agendamento válido/);
  for(const before of [0,1,-1,2.5,'3',Infinity])assert.throws(()=>c.getAgendaHistorico('A',before),/Página inválida/);
  c.getCodexSpreadsheet_=()=>new FakeSpreadsheet({});
  assert.equal(c.getAgendaHistorico('A').rows.length,0);
  assert.equal(sheet.writes,0);
});

test('retorna somente alterações permitidas do ID exato, oculta identidade anterior e notas',()=>{
  const rows=[row('A','Data de nascimento','NASCIMENTO_PRIVADO'),row('A','Participante','NOME_PRIVADO','OUTRO_PRIVADO'),row('AA'),row('A','Backup JSON'),row('A','Data','','','salvarNovoEventoCompleto'),row()];
  rows.push([...row()].map((v,i)=>i===3?'Cadastros':v));
  const f=fixture(rows), result=f.c.getAgendaHistorico('A');
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].field,'Data');
  assert.equal(result.rows[1].field,'Vínculo do participante');
  assert.equal(result.rows[1].newValue,'Alterado');
  assert.doesNotMatch(JSON.stringify(result),/PRIVADO|Nota técnica|NOME_|NASCIMENTO/);
  assert.equal(f.sheet.writes,0);
});

test('pagina até quarenta mudanças sem perder linhas; append não duplica páginas',()=>{
  const f=fixture(Array.from({length:95},(_,i)=>row('A','Visita',String(i),String(i+1))));
  const first=f.c.getAgendaHistorico('A');
  assert.equal(first.rows.length,40);
  f.sheet.rows.push(row('A','Visita','nova','nova'));
  const second=f.c.getAgendaHistorico('A',first.nextBefore);
  const third=f.c.getAgendaHistorico('A',second.nextBefore);
  const all=[...first.rows,...second.rows,...third.rows].map(r=>r.oldValue);
  assert.equal(all.length,95);
  assert.equal(new Set(all).size,95);
  assert.equal(third.hasMore,false);
});

test('lote vazio permite continuar e não promete ausência de histórico; fonte encurtada exige reabrir',()=>{
  const f=fixture([row(),...Array.from({length:600},()=>row('OUTRO'))]);
  const first=f.c.getAgendaHistorico('A');
  assert.equal(first.rows.length,0);
  assert.equal(first.hasMore,true);
  assert.equal(f.c.getAgendaHistorico('A',first.nextBefore).rows.length,1);
  f.sheet.rows.length=3;
  assert.throws(()=>f.c.getAgendaHistorico('A',first.nextBefore),/histórico mudou/);
});

test('orçamento integrado fica em uma leitura e 5 mil células por chamada em fontes grandes',t=>{
  for(const total of [1000,10000,100000]) {
    const f=fixture(Array.from({length:total},()=>row('OUTRO')));
    f.c.getAgendaHistorico('A');
    assert.deepEqual(f.reads,[{rows:500,cells:5000}]);
    assert.equal(f.sheet.writes,0);
    t.diagnostic(JSON.stringify({sourceRows:total,valueReads:1,cellsRead:5000,fullScanCells:total*10}));
  }
});

test('criação registra o ID definitivo depois da escrita e não registra criação se a escrita falhar',()=>{
  const {readProjectFile}=require('./helpers/load-app-script');
  const vm=require('node:vm');
  const source=readProjectFile('WebApp.gs');
  const start=source.indexOf('function _gravarLinhaEvento(');
  const end=source.indexOf('function agendaWriteInitialEventRow_(',start);
  const sheet=new FakeSheet('Agenda',[['ID']]);
  const events=[];
  let fail=false;
  const range=sheet.getRange.bind(sheet);
  sheet.getRange=(...args)=>{const r=range(...args);r.getValue=()=>false;return r;};
  const c=vm.createContext({
    AgendaServerRules_:{formPolicy:()=>({labChoiceAllowed:true,isVisit:false}),isCancelled:()=>false,isLabCentral:()=>false},
    agendaMeasureSaveStage_:(_operation,_stage,_meta,fn)=>fn(),
    agendaSincronizarProjetoDoParticipante_:()=>null,
    agendaRealizadoFuturoErro_:()=>null,agendaTipoExigeLabCentralServer_:()=>false,
    agendaDateIsBeforeToday_:()=>false,
    Utilities:{getUuid:()=> 'EVT-1234-UUID'},
    SpreadsheetApp:{flush(){}},
    Session:{getActiveUser:()=>({})},
    agendaWriteInitialEventRow_:(_sheet,_line,id)=>{if(fail)throw Error('Falha simulada');sheet.rows.push([id]);},
    agendaBooleanValue_:()=>false,agendaGravarTransportesDoEvento_(){},verificarNotificacoes(){},
    AGENDA_CFG:{col:{carroRequerido:1,data:1,projeto:1,labCentral:1},lastCol:1},
    codexWriteAuditChanges_:(module,action,id,changes)=>{
      assert.equal(sheet.rows[1][0],id);
      events.push({module,action,id,changes});
    },
    agendaInvalidateDateIndexCache_(){},agendaEmailEnabled_:()=>false
  });
  vm.runInContext(source.slice(start,end),c);
  assert.equal(c._gravarLinhaEvento(sheet,new Date(),{tipo:'Evento'},{}).id,'EVT-1234');
  assert.equal(events.length,1);
  assert.equal(events[0].action,'criarAgendaEventoConcluido');
  assert.equal(events[0].id,'EVT-1234');
  fail=true;
  assert.throws(()=>c._gravarLinhaEvento(sheet,new Date(),{tipo:'Evento'},{}),/Falha simulada/);
  assert.equal(events.length,1);
});
