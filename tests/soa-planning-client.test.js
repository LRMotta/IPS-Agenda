'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {contentAccessibilitySource} = require('./helpers/content-accessibility-source');
function fixture() {
 const requests=[],statuses=[];
 const elements={};
 const document={getElementById(id){return elements[id] ||= {value:'',checked:false,disabled:false,hidden:false,innerHTML:'',classList:{contains:()=>true}};}};
 document.getElementById('soaImportTexto').value=JSON.stringify({schema:'ips-agenda-study-planning-poc',rules:[{id:'r'}]});
 document.getElementById('soaImportModo').value='adicionar';
 const c=vm.createContext({document,_soaProjetoAtual:{codigo:'ABC'},_soaImportDadosAtual:null,_soaImportFingerprintAtual:'',_soaImportRevisao:0,_soaImportEmAndamento:false,_soaImportResultadoAtual:null,_soaDraftSaving:false,_soaDraftRequest:0,esc:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),soaOrdemLabel_:String,appServerRun:r=>requests.push(r),appSetStatus:(...x)=>statuses.push(x),appSetButtonBusy:(b,v)=>b.disabled=v,appErrorMessage:e=>e.message,fecharOverlay(){},snack(){},carregarSoAVisitasProjeto(){},carregarBracosProjeto(){}});
 vm.runInContext(contentAccessibilitySource(['invalidarPreviaImportacaoSoA_','soaImportTextoPayload_','renderSoAImportPreview_','previsualizarSoAJsonApp','confirmarImportacaoSoAApp','atualizarRevisaoPlanejamentoSoAApp','soaPlanningValue_','renderPlanejamentoSoA_','listarPlanejamentosSoAApp','carregarPlanejamentoSoAApp','salvarPlanejamentoSoAApp']),c);
 function preview(extra={}){c.previsualizarSoAJsonApp();requests.at(-1).onSuccess({ok:true,podeImportar:false,fingerprint:'signed',visitas:[],planejamento:{draftOnly:true,study:{},rules:[],issues:[]},...extra});}
 return {c,e:elements,requests,statuses,preview};
}
test('rascunho permite salvar original sem aplicar visitas',()=>{const {c,e,requests,preview}=fixture();preview();assert.equal(e.btnImportarSoAConfirm.disabled,true);assert.equal(e.btnSalvarPlanejamentoSoA.disabled,false);c.confirmarImportacaoSoAApp();assert.equal(requests.some(r=>r.method==='importarSoAJson'),false);c.salvarPlanejamentoSoAApp();assert.equal(requests.at(-1).method,'salvarPlanejamentoSoA');assert.equal(requests.at(-1).args[0].dados.rules[0].id,'r');assert.equal(requests.at(-1).args[0].confirmarRevisaoPlanejamento,undefined);});
test('aplicar exige revisão humana e envia fingerprint da prévia',()=>{const {c,e,requests,preview}=fixture();preview({podeImportar:true,visitas:[{codigo:'V1'}]});c.confirmarImportacaoSoAApp();assert.equal(requests.some(r=>r.method==='importarSoAJson'),false);e.soaImportRevisado.checked=true;c.atualizarRevisaoPlanejamentoSoAApp();assert.equal(e.btnImportarSoAConfirm.disabled,false);c.confirmarImportacaoSoAApp();assert.equal(requests.at(-1).args[0].fingerprintPlanejamento,'signed');assert.equal(requests.at(-1).args[0].confirmarRevisaoPlanejamento,true);});
test('alteração do texto invalida salvar e revisão mesmo sem evento',()=>{const {c,e,requests,preview}=fixture();preview();e.soaImportTexto.value='{}';c.salvarPlanejamentoSoAApp();assert.equal(requests.length,1);assert.equal(c._soaImportDadosAtual,null);});
test('resposta de carregar rascunho não sobrescreve edição mais recente',()=>{const {c,e,requests}=fixture();e.soaPlanejamentoSalvo={value:'id'};c.carregarPlanejamentoSoAApp();e.soaImportTexto.value='novo';c.invalidarPreviaImportacaoSoA_();requests.at(-1).onSuccess({dados:{old:true}});assert.equal(e.soaImportTexto.value,'novo');});
test('resposta antiga de salvar não apaga edição nem habilita snapshot inválido',()=>{const {c,e,requests,preview}=fixture();preview();c.salvarPlanejamentoSoAApp();const req=requests.at(-1);e.soaImportTexto.value='novo';c.invalidarPreviaImportacaoSoA_();req.onSuccess({ok:true});assert.equal(e.soaImportTexto.value,'novo');assert.equal(e.btnSalvarPlanejamentoSoA.disabled,true);assert.equal(c._soaImportDadosAtual,null);});
test('prévia protege HTML e apresenta todas regras e pendências',()=>{const {e,preview}=fixture();preview({planejamento:{study:{protocol_id:'<img onerror=alert(1)>'},rules:[{id:'<svg>',scope:'<script>',source:{file:'<script>'}}],issues:[{message:'<script>',blocking:true}]}});assert.doesNotMatch(e.soaImportPreview.innerHTML,/<script>|<svg>|<img/);assert.match(e.soaImportPreview.innerHTML,/&lt;script&gt;/);assert.match(e.soaImportPreview.innerHTML,/impede aplicar/i);});
test('limite de conteúdo é conferido antes da RPC',()=>{const {c,e,requests}=fixture();e.soaImportTexto.value='x'.repeat(300001);c.previsualizarSoAJsonApp();assert.equal(requests.length,0);});
test('regra malformada continua visível para correção sem quebrar a prévia',()=>{const {e,preview}=fixture();preview({ok:false,planejamento:{study:{},rules:[null],issues:[]}});assert.match(e.soaImportPreview.innerHTML,/Regra inválida/);assert.equal(e.btnImportarSoAConfirm.disabled,true);});
test('lista de rascunhos atrasada não substitui lista do projeto atual',()=>{const {c,e,requests}=fixture();c.listarPlanejamentosSoAApp();c._soaProjetoAtual={codigo:'DEF'};c.listarPlanejamentosSoAApp();requests[1].onSuccess([{id:'new',label:'Novo'}]);requests[0].onSuccess([{id:'old',label:'Antigo'}]);assert.match(e.soaPlanejamentoSalvo.innerHTML,/Novo/);assert.doesNotMatch(e.soaPlanejamentoSalvo.innerHTML,/Antigo/);});

test('prévia mostra resumo e visitas antes de agrupar impedimentos repetidos',()=>{
 const {e,preview}=fixture();
 preview({totalVisitas:2,visitas:[{codigo:'V1',nome:'Triagem'},{codigo:'V2',nome:'Inclusão'}],planejamento:{study:{},rules:[],issues:[{id:'basis-0',message:'Informe a base das datas.',blocking:true},{id:'basis-1',message:'Informe a base das datas.',blocking:true},{id:'guide',message:'Conferir condições.',blocking:false}]}});
 const html=e.soaImportPreview.innerHTML;
 assert.ok(html.indexOf('visitas encontradas')<html.indexOf('Pontos de atenção'));
 assert.ok(html.indexOf('Triagem')<html.indexOf('Pontos de atenção'));
 assert.equal((html.match(/2 ocorrências/g)||[]).length,1);
 assert.match(html,/2 impedimento\(s\) · 1 orientação/);
 assert.match(html,/basis-0/);assert.match(html,/basis-1/);
});
test('regras exibem descrição e visitas manuais não sugerem cálculo automático',()=>{
 const {e,preview}=fixture();
 preview({visitas:[{codigo:'V1',nome:'Triagem',schedulingMode:'manual',manualReason:'Definir após triagem.'},{codigo:'V2',nome:'Baseline',baseCalculo:''}],planejamento:{study:{},rules:[{id:'r1',name:'Condição clínica',description:'Realizar conforme avaliação.',handling:'manual',reason:'Requer decisão clínica.'}],issues:[]}});
 const html=e.soaImportPreview.innerHTML;
 assert.match(html,/Condição clínica/);assert.match(html,/Realizar conforme avaliação/);
 assert.match(html,/Agendamento manual · Definir após triagem/);
 assert.match(html,/Base das datas: Não informada/);
 assert.doesNotMatch(html,/Base das datas: Data prevista/);
});
