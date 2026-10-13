const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
function fixture() {
  const sheets = {}, state = {writes:0, arms:[], visits:[], denied:false};
  const context = {
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,v)=>Array.from(crypto.createHash('sha256').update(v).digest())},
    normText_:v=>String(v || '').trim().toLowerCase(), soaArmSignature_:v=>(v || []).slice().sort().join('|'),
    soaDelimitedIds_:v=>Array.isArray(v) ? v : String(v || '').split(';').filter(Boolean),
    soaImportParsePayload_:p=>({projeto:p.projeto,dados:typeof p.dados==='string'?JSON.parse(p.dados):p.dados,modo:p.modo||'adicionar',criarBracos:p.criarBracos!==false}),
    getCodexSheetDataByName_:()=>[['ID','Nome','Código'],['1','Projeto','P1']],getBracosProjeto:()=>state.arms,getSoAVisitasProjeto:()=>state.visits,
    codexAssertCanRead_:()=>{if(state.denied) throw Error('denied');},codexAssertCanWrite_:()=>{if(state.denied) throw Error('denied');},codexWithDocumentLock_:(_,fn)=>fn(),
    soaCreateImportArms_:(_,names)=>names.map((nome,i)=>{const a={nome,idBraco:'ARM'+i};state.arms.push(a);return a;}),
    soaWriteImportRows_:p=>{state.writes++;state.visits=p.visitas;},
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>sheets[n],insertSheet:n=>{
      const rows=[]; const sh={getDataRange:()=>({getValues:()=>rows}),getLastRow:()=>rows.length,getRange:row=>({setValues:values=>{values.forEach((v,i)=>{rows[row-1+i]=v;});}})};sheets[n]=sh;return sh;
    }})}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync('SoAPlanning.gs','utf8'),context);
  const source={file:'protocol.pdf',printed_page:10,section:'1.2'};
  const timing={anchor:'randomization_date',offset_days:0,window_before_days:0,window_after_days:2,basis:'planned'};
  const data={schema:'ips-agenda-study-planning',schema_version:'1.0.0',import_mode:'review',approved_for_clinical_scheduling:false,study:{protocol_id:'P1',protocol_version:'1'},arms:[],rules:[],visits:[{id:'v1',code:'C1D1',name:'C1D1',order:1,arm_ids:[],timing,source,status:'extracted'}]};
  return {c:context,state,sheets,p:{projeto:'Projeto',dados:data}};
}
test('canonical preview deterministic, read-only; approval and unchanged catalog required',()=>{
  const {c,p,sheets,state}=fixture();let a=c.soaPlanningPrepare_(p);assert.equal(a.podeImportar,true);assert.equal(c.soaPlanningPrepare_(p).fingerprint,a.fingerprint);assert.equal(Object.keys(sheets).length,0);
  assert.throws(()=>c.soaPlanningApply_(p),/confirme/);p.confirmarRevisaoPlanejamento=true;p.fingerprintPlanejamento=a.fingerprint;
  state.visits.push({idSoA:'other',codigo:'OTHER',bracoIds:[]});assert.throws(()=>c.soaPlanningApply_(p),/Valide/);assert.equal(state.writes,0);
  p.fingerprintPlanejamento=c.soaPlanningPrepare_(p).fingerprint;assert.equal(c.soaPlanningApply_(p).ok,true);assert.equal(state.writes,1);assert.equal(c.listarPlanejamentosSoA('Projeto').length,1);
});
test('PoC is archived losslessly and never executable; archive deduplicates and scopes reads',()=>{
  const {c,p,sheets}=fixture();p.dados={schema:'ips-agenda-study-planning-poc',schema_version:'0.1.0',import_mode:'preview_only',approved_for_clinical_scheduling:false,study:{protocol_id:'P1',protocol_version:'1'},rules:[{id:'recurrence',recurrence_weeks:8,unknown:'=IMPORTXML()'}],metadata:'x'.repeat(45000)};
  assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);const saved=c.salvarPlanejamentoSoA(p);assert.equal(c.salvarPlanejamentoSoA(p).id,saved.id);assert.equal(JSON.stringify(c.carregarPlanejamentoSoA('Projeto',saved.id).dados),JSON.stringify(p.dados));assert.equal(c.listarPlanejamentosSoA('Outro').length,0);assert.throws(()=>c.carregarPlanejamentoSoA('Outro',saved.id));assert.throws(()=>c.soaPlanningApply_(p));
  const rows=sheets.SoA_Planejamentos.getDataRange().getValues();assert.equal(rows.length,4);assert.ok(rows.slice(1).every(r=>!r[5].startsWith('=')));rows.pop();assert.throws(()=>c.salvarPlanejamentoSoA(p),/incompleto/);
});
test('reusable simple rule works; conflicts, unsupported rules, missing basis and unknown timing block',()=>{
  const {c,p}=fixture();const v=p.dados.visits[0];p.dados.rules=[{id:'r',kind:'visit_timing',status:'extracted',timing:v.timing,source:v.source}];v.rule_ids=['r'];delete v.timing;delete v.source;assert.equal(c.soaPlanningPrepare_(p).podeImportar,true);
  v.timing={...p.dados.rules[0].timing,offset_days:4};assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);delete v.timing;p.dados.rules[0].timing.conditional=true;assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);delete p.dados.rules[0].timing.conditional;delete p.dados.rules[0].timing.basis;assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);
});
test('malformed, ambiguous and unknown versions never apply; permissions enforced',()=>{
  for(const mutate of [d=>d.schema_version='9',d=>d.visits[0].arm_ids='a',d=>d.arms=[null],d=>d.visits[0].timing.offset_days='0',d=>d.study.protocol_id='OTHER',d=>d.schema='unknown']){
    const {c,p,state}=fixture();mutate(p.dados);assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);assert.throws(()=>c.soaPlanningApply_(p));assert.equal(state.writes,0);
  }
  const {c,p,state}=fixture();state.denied=true;assert.throws(()=>c.salvarPlanejamentoSoA(p),/denied/);assert.throws(()=>c.listarPlanejamentosSoA('Projeto'),/denied/);assert.throws(()=>c.carregarPlanejamentoSoA('Projeto','id'),/denied/);
});
test('cyclic and incompatible-arm visit anchors block',()=>{
  const {c,p}=fixture();const a=p.dados.visits[0];a.timing.anchor='visit';a.timing.anchor_visit_id='v2';p.dados.visits.push({...a,id:'v2',code:'C2',timing:{...a.timing,anchor_visit_id:'v1'}});assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);
});
test('public importer routes schema documents through guarded pipeline under lock',()=>{
  const {c,p,state}=fixture();const code=fs.readFileSync('WebApp.gs','utf8');
  for(const name of ['validarImportacaoSoA','importarSoAJson']) {
    const start=code.indexOf('function '+name+'(');const end=code.indexOf('\nfunction ',start+1);vm.runInContext(code.slice(start,end),c);
  }
  c.soaImportPrepare_=()=>{throw Error('legacy fallback forbidden');};
  assert.equal(c.validarImportacaoSoA(p).podeImportar,true);p.dados.schema='unknown';assert.equal(c.validarImportacaoSoA(p).ok,false);assert.throws(()=>c.importarSoAJson(p),/Planejamento/);assert.equal(state.writes,0);
});
test('missing timing can be saved as draft and formula-like visit text cannot execute',()=>{
  const {c,p}=fixture();delete p.dados.visits[0].timing.offset_days;assert.equal(c.soaPlanningPrepare_(p).ok,true);assert.equal(c.salvarPlanejamentoSoA(p).ok,true);assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);
  p.dados.visits[0].timing.offset_days=0;p.dados.visits[0].name='=IMPORTXML("url")';assert.equal(c.soaPlanningPrepare_(p).podeImportar,false);
});
