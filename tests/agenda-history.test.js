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
  const reads=[],searches=[];
  const c=runFiles(['AgendaHistory.gs'],{Date,
    Utilities:{formatDate:(date,zone)=>{assert.equal(zone,'America/Sao_Paulo');return date.toISOString();}}
  });
  c.codexAssertCanRead_=()=>({ok:true});
  c.getCodexSpreadsheet_=()=>new FakeSpreadsheet({Audit_Changes:sheet});
  c.codexMeasureReadPerformance_=(_o,_s,_m,fn)=>fn();
  c.codexReadValuesMeasured_=(range)=>{reads.push({start:range.row,rows:range.numRows,cells:range.numRows*range.numColumns});return range.getValues();};
  const getRange=sheet.getRange.bind(sheet);
  sheet.getRange=(...args)=>{
    const range=getRange(...args),create=range.createTextFinder.bind(range);
    range.createTextFinder=(search)=>{searches.push({column:range.column,rows:range.numRows,columns:range.numColumns,search});return create(search);};
    return range;
  };
  return {c,sheet,reads,searches};
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

test('busca ID literal completo, preserva espaços legados e não mistura módulos, prefixos ou caixa',()=>{
  const f=fixture([row(' A.+ '),row('A.+'),row('a.+'),row('A.++'),row('Axx'),row('A.+')]);
  f.sheet.rows[6][3]='Cadastros';
  const data=f.c.getAgendaHistorico('A.+');
  assert.equal(data.rows.length,2);
  assert.equal(f.searches.length,1);
  assert.equal(f.searches[0].column,6);
  assert.equal(f.searches[0].columns,1);
  assert.equal(f.sheet.writes,0);
});

test('amplia ações/campos operacionais, normaliza slots legados e protege dados pessoais/JSON/notas',()=>{
  const rows=[
    row('A','Data de nascimento','NASCIMENTO_PRIVADO'),
    row('A','Participante','NOME_PRIVADO','OUTRO_PRIVADO'),
    row('A','Backup JSON'),row('A','Data','','','salvarNovoEventoCompleto'),
    row('A','Kit'),row('A','Controle Lab Central'),row('A','Polo Trial concluído'),row('A','eCRF concluída'),
    row('A','Status Requisição','Pendente','Enviada','atualizarStatusRequisicaoAgenda'),
    row('A','Transporte II - Status','Agendado','Confirmado','monitorarConfirmacoesCourierAgendadas'),
    row('A','Transporte 1 - AWB','123','456','salvarTransporte'),
    row('A','Transporte 2 - Status','','Docs gerados','gerarPdfTransporte'),
    row('A','Backup - Agendamento','JSON_PRIVADO','{"id":"ID_PRIVADO"}','vincularBackupAoAgendamento'),
    row('A','Backup - Status','Agendado','Adicionado','atualizarStatusBackupAgenda'),
    row('A','Transporte I - Status','Confirmado','Entregue','confirmarEntregaTransportePendencia'),
    row('A','Transporte I - Status','','Entregue','monitorarEntregasDhlAgendadas'),
    row('A','Transporte I - Status','','Enviado','transporteMonitorarEnviosPorEmail'),
    row('A','Backup - AWB do agendamento vinculado','123','456','sincronizarBackupAwb'),
    row('A','Transporte I - Material','["JSON_PRIVADO"]','{"PII_PRIVADO":"x"}'),
    row('A','Transporte I - Destino','Local A','Local B','vincularBackupAVisitaFutura'),
    row('A','Transporte I - Material','Sangue','Soro'),
    row('A','Status','','Tentativa','bloquearEdicaoAgenda')
  ];
  const data=fixture(rows).c.getAgendaHistorico('A');
  assert.equal(data.rows.length,18);
  assert.ok(data.rows.some(r=>r.field==='Transporte I - AWB'&&r.newValue==='456'));
  assert.ok(data.rows.some(r=>r.field==='Vínculo do participante'&&r.summary));
  assert.ok(data.rows.some(r=>r.field==='Agendamento de destino · Transporte I - Destino'));
  assert.ok(data.rows.some(r=>r.field==='Transporte I - Material'&&r.newValue==='Soro'));
  assert.doesNotMatch(JSON.stringify(data),/PRIVADO|Nota técnica|NOME_|NASCIMENTO|bloquearEdicao/);
});

test('pagina quarenta itens do próprio evento, pula campos excluídos e preserva lookahead/append',()=>{
  const rows=[];
  for(let i=0;i<95;i++) {
    rows.push(row('A','Visita',String(i),String(i+1)));
    rows.push(row('A','Data de nascimento','PRIVADO'));
    rows.push(...Array.from({length:15},()=>row('OUTRO')));
  }
  const f=fixture(rows),first=f.c.getAgendaHistorico('A');
  assert.equal(first.rows.length,40);
  f.sheet.rows.push(row('A','Visita','nova','nova'));
  const second=f.c.getAgendaHistorico('A',first.nextBefore);
  const third=f.c.getAgendaHistorico('A',second.nextBefore);
  const all=[...first.rows,...second.rows,...third.rows].map(r=>r.oldValue);
  assert.equal(all.length,95);
  assert.equal(new Set(all).size,95);
  assert.equal(third.hasMore,false);
  assert.equal(third.nextBefore,null);
  assert.ok(f.reads.every(r=>r.rows<=160));
});

test('quarenta itens exatos não anunciam página vazia, e filtros restantes não criam mais páginas',()=>{
  const f=fixture([row('A','Data de nascimento','PRIVADO'),...Array.from({length:40},(_,i)=>row('A','Visita',String(i),'Nova'))]);
  const page=f.c.getAgendaHistorico('A');
  assert.equal(page.rows.length,40);
  assert.equal(page.hasMore,false);
  assert.equal(page.nextBefore,null);
});

test('encontra o evento antigo logo na primeira consulta e detecta fonte encurtada ou movida',()=>{
  const f=fixture([row(),...Array.from({length:600},()=>row('OUTRO'))]);
  const first=f.c.getAgendaHistorico('A');
  assert.equal(first.rows.length,1);
  assert.equal(first.hasMore,false);
  assert.equal(f.reads.length,1);
  assert.equal(f.reads[0].cells,10);
  f.sheet.rows.length=3;
  assert.throws(()=>f.c.getAgendaHistorico('A',502),/histórico mudou/);
  const g=fixture([row()]);
  g.c.codexReadValuesMeasured_=()=>[row('MOVIDO')];
  assert.throws(()=>g.c.getAgendaHistorico('A'),/histórico mudou/);
});

test('desempenho: 100 mil linhas alheias não são transferidas; ausência não lê valores',t=>{
  for(const total of [1000,10000,100000]) {
    const rows=Array.from({length:total},()=>row('OUTRO'));
    rows[4]=row('A');
    const f=fixture(rows);
    assert.equal(f.c.getAgendaHistorico('A').rows.length,1);
    assert.equal(f.searches.length,1);
    assert.equal(f.reads.length,1);
    assert.equal(f.reads[0].cells,10);
    assert.equal(f.sheet.writes,0);
    t.diagnostic(JSON.stringify({sourceRows:total,nativeIdSearches:1,valueReads:1,cellsTransferred:10}));
  }
  const f=fixture([row('OUTRO')]);
  assert.equal(f.c.getAgendaHistorico('SEM').rows.length,0);
  assert.equal(f.reads.length,0);
});

test('inclui aliases do Transporte backup, materiais e remoção de dia de Auditoria',()=>{
  const f=fixture([
    row('A','Transporte backup - Status','Pendente','Agendado','salvarTransporte'),
    row('A','Transporte backup - AWB','123','456','salvarTransporte'),
    row('A','Transporte 1 - Materiais','Sangue','Soro','salvarTransporte'),
    row('A','Transporte backup - Materiais estruturados','{"PII_PRIVADO":1}','Resumo','salvarTransporte'),
    row('A','Auditoria','17/10/2026','','atualizarAgendaEventoCompleto')
  ]);
  const data=f.c.getAgendaHistorico('A');
  assert.equal(data.rows.length,5);
  assert.ok(data.rows.some(r=>r.field==='Backup - Status'&&r.newValue==='Agendado'));
  assert.ok(data.rows.some(r=>r.field==='Backup - AWB'&&r.newValue==='456'));
  assert.ok(data.rows.some(r=>r.field==='Transporte I - Material'&&r.newValue==='Soro'));
  assert.ok(data.rows.some(r=>r.field==='Backup - Detalhes dos materiais'&&r.summary));
  assert.ok(data.rows.some(r=>r.field==='Auditoria'&&r.oldValue==='17/10/2026'));
  assert.doesNotMatch(JSON.stringify(data),/PII_PRIVADO/);
});


test('rotinas automáticas mostram Sistema e preservam conta técnica sem inferir iniciador',()=>{
  const actions=['monitorarEntregasDhlAgendadas','monitorarConfirmacoesCourierAgendadas',
    'transporteMonitorarEnviosPorEmail','sincronizarBackupAwb'];
  const registros=actions.map(action=>row('A','Transporte I - Status','Agendado','Confirmado',action));
  registros.push(row('A','Status','Agendado','Confirmado'));
  const f=fixture(registros),data=f.c.getAgendaHistorico('A');
  const manual=data.rows[0];
  assert.equal(manual.origin,'usuario');
  assert.equal(manual.actorLabel,'equipe@exemplo.org');
  data.rows.slice(1).forEach(item=>{
    assert.equal(item.origin,'automatico');
    assert.equal(item.actorLabel,'Sistema');
    assert.equal(item.email,'equipe@exemplo.org');
    assert.equal(item.initiatedBy,undefined);
  });
  assert.equal(f.sheet.writes,0);
  assert.equal(f.sheet.rows[1][2],'equipe@exemplo.org');
  for(const email of ['', 'api-token','legado sem conta']) {
    const actor=f.c.agendaHistoricoResponsavel_('atualizarAgendaEventoCompleto',email);
    assert.equal(actor.origin,'nao_identificada');
    assert.equal(actor.label,'Responsável não disponível');
    assert.equal(f.c.agendaHistoricoResponsavel_('monitorarEntregasDhlAgendadas',email).label,'Sistema');
  }
});

test('datas textuais legadas preservam o valor registrado sem inventar horário',()=>{
  const f=fixture([]);
  assert.equal(f.c.agendaHistoricoData_('17/10/2026'),'17/10/2026');
  assert.equal(f.c.agendaHistoricoData_('17/10/2026 14:20'),'17/10/2026 14:20');
  assert.equal(f.c.agendaHistoricoData_('inválida'),'Data não disponível');
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
    agendaAwbValidarPayload_(){},
    agendaBooleanValue_:()=>false,agendaGravarTransportesDoEvento_(){},verificarNotificacoes_(){},
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
