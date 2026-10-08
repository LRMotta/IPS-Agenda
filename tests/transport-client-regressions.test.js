'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readProjectFile, runFile } = require('./helpers/load-app-script');

const source = readProjectFile('TransporteApp.html');
function functions(names, context) {
  const code = names.map(name => {
    const match = source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'));
    assert.ok(match, name);
    return match[0];
  }).join('\n');
  const sandbox = vm.createContext(context);
  vm.runInContext(code, sandbox);
  return sandbox;
}

function rpcQueue() {
  const pending = [];
  // Cada cadeia google.script.run guarda seus proprios handlers.
  const run = new Proxy({}, {
    get: (_target, method) => {
      if (method === 'withSuccessHandler') return success => chain(success);
      return (...args) => pending.push({ method, args });
    }
  });
  function chain(success, failure) {
    return new Proxy({}, {
      get: (_target, method) => {
        if (method === 'withFailureHandler') return fn => chain(success, fn);
        return (...args) => pending.push({ method, args, success, failure });
      }
    });
  }
  return { pending, google: { script: { run } } };
}

test('Transporte serializa parametros no script com escape seguro e preserva os valores', () => {
  const server = runFile('WebApp.gs');
  const args = { agendaId: '</script><script>alert(1)</script>&\u2028', slot: '2' };
  const json = server.codexJsonForScript_(args);
  assert.doesNotMatch(json, /[<>&\u2028\u2029]/u);
  assert.deepEqual(JSON.parse(json), args);
  assert.match(source, /JSON\.parse\(<\?= codexJsonForScript_\(initialTransporteArgs \|\| \{\}\) \?>\)/);
  assert.doesNotMatch(source, /<\?!=\s*JSON\.stringify\(initialTransporteArgs/);
});

function ceFixture() {
  const rpc = rpcQueue();
  const protocolo = { value: 'Estudo A' };
  const c = functions(['loadCeStatus'], {
    ...rpc, transportCeRequestId: 0, transportFormGeneration: 0,
    state: {}, document: { getElementById: () => protocolo }, renderIssues() {}
  });
  return { c, protocolo, pending: rpc.pending };
}

for (const response of ['success', 'failure']) {
  test('CE ignora ' + response + ' tardio de outro estudo', () => {
    const { c, protocolo, pending } = ceFixture();
    c.loadCeStatus(true);
    protocolo.value = 'Estudo B';
    c.loadCeStatus(true);
    pending[1].success({ checked: true, found: false, message: 'CE B' });
    if (response === 'success') pending[0].success({ checked: true, found: true, message: 'CE A' });
    else pending[0].failure(new Error('Falha A'));
    assert.equal(c.state.ceStatus.protocolo, 'Estudo B');
    assert.equal(c.state.ceStatus.message, 'CE B');
  });
}

test('CE invalida consulta ao limpar protocolo, mas nao cancela uma consulta pendente ao reutiliza-la', () => {
  const { c, protocolo, pending } = ceFixture();
  c.loadCeStatus(true);
  c.loadCeStatus(false);
  assert.equal(pending.length, 1);
  pending[0].success({ checked: true, found: true });
  assert.equal(c.state.ceStatus.found, true);
  c.loadCeStatus(true);
  protocolo.value = '';
  c.loadCeStatus(false);
  pending[1].success({ checked: true, found: true });
  assert.equal(c.state.ceStatus, null);
});

test('CE ignora resposta de uma renderizacao anterior mesmo com o mesmo protocolo', () => {
  const { c, pending } = ceFixture();
  c.loadCeStatus(true);
  c.transportFormGeneration++;
  c.state.ceStatus = null;
  pending[0].success({ checked: true, found: true });
  assert.equal(c.state.ceStatus, null);
});

test('atualizar dados nao repete a importacao da Agenda depois do bootstrap inicial', () => {
  const calls = [];
  const c = functions(['loadData'], {
    INITIAL_TRANS_ARGS: { agendaId: 'EVT-1', slot: '2' }, state: {},
    serverCall(name, args, _message, after) { calls.push({ name, args }); after({}); },
    transportClearUnsaved() {}, renderAll() {}
  });
  c.loadData(false);
  c.loadData(true);
  c.loadData(false);
  assert.deepEqual(calls.map(call => call.name), ['getTransporteBootstrapFromAgenda', 'getTransporteBootstrap', 'getTransporteBootstrap']);
  assert.deepEqual(Array.from(calls[0].args), ['EVT-1', '2']);
});

for (const action of ['selectTemp', 'selectCourier', 'matBioRemoveRow', 'convertDhlVolumesToLiters']) {
  test(action + ' marca alteracao do usuario e invalida PDF anterior', () => {
    let removed = false;
    let converted = false;
    let dirty = 0;
    const formula = { value: '2 x 0,5' };
    const row = { dataset: { formulaUnit: 'mL' }, querySelector: selector => selector === '.ag-mat-formula' ? formula : { value: 'plasma' }, remove() { removed = true; } };
    const c = functions([action], {
      selectedTemp: 'AMBIENTE', selectedCourier: action === 'convertDhlVolumesToLiters' ? 'DHL' : 'MARKEN',
      state: { options: { temperaturas: [], couriers: [] }, lastPdfResult: {} },
      canonicalCourier: value => value, segmented() {}, setTransportFieldInvalid() {},
      applySolicitarCaixaDefault() {}, applyAwbRule() {}, updateResponsavelEntregaField() {},
      renderDerived() {}, matBioRecalc() {}, matBioAddRow() {}, toast() {},
      matBioTypeConfig: () => ({ unit: 'mL' }), matBioUnitKey: value => value,
      matBioParseFormula: () => ({ segmentos: [{}] }),
      convertFormulaUnit() { converted = true; return '2 x 0,0005'; },
      document: { querySelectorAll: () => [row] },
      transportMarkUnsaved() { dirty++; c.state.lastPdfResult = null; }
    });
    if (action === 'selectTemp') c[action]('CONGELADO');
    else if (action === 'selectCourier') c[action]('DHL');
    else if (action === 'matBioRemoveRow') c[action]({ closest: () => row });
    else c[action]();
    assert.equal(dirty, 1);
    assert.equal(c.state.lastPdfResult, null);
    if (action === 'matBioRemoveRow') assert.equal(removed, true);
    if (action === 'convertDhlVolumesToLiters') { assert.equal(converted, true); assert.equal(row.dataset.formulaUnit, 'L'); }
  });
}

function participantsFixture() {
  const rpc = rpcQueue();
  const fields = Object.fromEntries(['paciente', 'protocolo', 'investigador', 'identificacaoParticipante'].map(id => [id, { value: '', tagName: 'SELECT', innerHTML: '' }]));
  const rows = [
    { id: 'A', nome: 'Pessoa A', idParticipante: '123', projeto: 'Estudo A', investigador: 'Investigador A' },
    { id: 'B', nome: 'Pessoa B', idParticipante: '456', projeto: 'Estudo B', investigador: 'Investigador B' }
  ];
  fields.paciente.value = 'participante:A';
  const c = functions(['loadParticipantsOptions', 'participantOptionKey', 'transportParticipantData', 'resolveParticipantOption', 'fillParticipantOptions',
    'selectedParticipantInfo', 'selectedParticipantName', 'selectedParticipantIdentification', 'applyParticipantSelection'], {
    ...rpc, transportFormGeneration: 1, transportParticipantSearchTimer: null,
    transportParticipantIndex: null, transportCollator: new Intl.Collator('pt-BR'),
    state: { registro: { paciente: 'Pessoa A', participanteCadastroId: 'A', protocolo: 'Estudo A' }, options: { participantes: rows } },
    window: {}, document: { getElementById: id => fields[id] },
    norm: value => String(value || '').toLowerCase(), esc: value => String(value || ''), projectDisplay: value => value,
    sortRowsByText: value => value, participantProjectsMatch: (a, b) => a === b,
    renderDerived() {}, loadCeStatus() {}, setActionStatus() {}, syncTransportParticipantSearch() {}, renderTransportParticipantSearch() {}
  });
  return { c, fields, rows, pending: rpc.pending };
}

test('carga tardia de participantes preserva selecao feita durante a consulta', () => {
  const { c, fields, rows, pending } = participantsFixture();
  c.loadParticipantsOptions();
  fields.paciente.value = 'participante:B';
  c.applyParticipantSelection({ loadCe: false });
  pending[0].success(rows);
  assert.equal(fields.paciente.value, 'participante:B');
  assert.equal(fields.protocolo.value, 'Estudo B');
  assert.equal(fields.identificacaoParticipante.value, '456');
});

test('carga tardia de participantes preserva selecao vazia e encerra resultado vazio', () => {
  const { c, fields, pending } = participantsFixture();
  c.loadParticipantsOptions();
  fields.paciente.value = '';
  pending[0].success([]);
  assert.equal(fields.paciente.value, '');
  assert.equal(fields.protocolo.value, '');
  assert.equal(c.state.options.participantesLoaded, true);
  c.loadParticipantsOptions();
  assert.equal(pending.length, 1);
});

for (const response of ['success', 'failure']) {
  test('carga de participantes ignora ' + response + ' do formulario anterior', () => {
    const { c, rows, pending } = participantsFixture();
    c.loadParticipantsOptions();
    c.transportFormGeneration++;
    c.state.options = { participantes: [], participantesLoading: true };
    if (response === 'success') pending[0].success(rows);
    else pending[0].failure(new Error('Falha antiga'));
    assert.equal(c.state.options.participantes.length, 0);
    assert.equal(c.state.options.participantesLoading, true);
  });
}

function materialFixture(types) {
  const rows = types.map((type, i) => ({
    type, formula: '2 x ' + (i + 1), assay: 'Ensaio ' + i, freeText: 'Texto ' + i,
    querySelector() { return { value: this.type }; },
    querySelectorAll() { return [{ value: this.type }, { value: this.formula }]; }
  }));
  const originalRows = rows.slice();
  const wrap = {
    dataset: {}, contains: () => true,
    appendChild(row) { rows.splice(rows.indexOf(row), 1); rows.push(row); }
  };
  let messages = 0;
  const c = functions(['matBioEnsureTrailingRow'], {
    document: { activeElement: null, getElementById: () => wrap, querySelectorAll: () => rows },
    matBioTypeConfig: value => value ? { outro: value === 'outro' } : null,
    toast() { messages++; },
    matBioAddRow() {
      const blank = { type: '', formula: '', assay: '', freeText: '', querySelector: () => ({ value: '' }), querySelectorAll: () => [] };
      const firstOther = rows.findIndex(row => row.type === 'outro');
      rows.splice(firstOther < 0 ? rows.length : firstOther, 0, blank);
    }
  });
  return { c, rows, originalRows, messages: () => messages };
}

test('Outro vai para o final sem perder elementos, formulas, ensaios ou textos das linhas seguintes', () => {
  const { c, rows, originalRows, messages } = materialFixture(['outro', 'plasma', 'sangue']);
  const before = originalRows.map(row => ({ ...row }));
  c.matBioEnsureTrailingRow();
  assert.deepEqual(rows.map(row => row.type), ['plasma', 'sangue', '', 'outro']);
  originalRows.forEach((row, i) => {
    assert.ok(rows.includes(row), 'mesmo elemento preservado');
    assert.equal(row.formula, before[i].formula);
    assert.equal(row.assay, before[i].assay);
    assert.equal(row.freeText, before[i].freeText);
  });
  assert.equal(messages(), 1);
  c.matBioEnsureTrailingRow();
  assert.equal(rows.length, 4, 'recalculo nao duplica linha vazia');
  assert.equal(messages(), 1, 'nao repete mensagem sem movimento');
});

test('Outro sozinho ganha linha vazia antes e varios Outros preservam a ordem e os textos', () => {
  const single = materialFixture(['outro']);
  single.c.matBioEnsureTrailingRow();
  assert.deepEqual(single.rows.map(row => row.type), ['', 'outro']);
  const multi = materialFixture(['outro', 'plasma', 'outro', 'sangue']);
  multi.c.matBioEnsureTrailingRow();
  assert.deepEqual(multi.rows.map(row => row.type), ['plasma', 'sangue', '', 'outro', 'outro']);
  assert.equal(multi.rows[3], multi.originalRows[0]);
  assert.equal(multi.rows[4], multi.originalRows[2]);
});

test('Outro convertido em material comum permanece no lugar e retoma linha vazia automatica', () => {
  const { c, rows, originalRows } = materialFixture(['plasma', 'outro']);
  c.matBioEnsureTrailingRow();
  originalRows[1].type = 'sangue';
  c.matBioEnsureTrailingRow();
  assert.deepEqual(rows.map(row => row.type), ['plasma', '', 'sangue', '']);
  assert.equal(rows[2], originalRows[1]);
});

test('busca de participantes diferencia cadastros homonimos e aceita nome sem acento, estudo ou identificacao', () => {
  const c = functions(['transportParticipantSearchRows', 'transportParticipantData', 'participantOptionKey'], {
    transportParticipantIndex: null, transportCollator: new Intl.Collator('pt-BR'),
    state: { options: { participantes: [
      { id: 'A', nome: 'Márcia Silva', projeto: 'Estudo A', idParticipante: '001' },
      { id: 'B', nome: 'Márcia Silva', projeto: 'Estudo B', idParticipante: '002' },
      { id: 'C', nome: 'João Souza', projeto: 'Estudo C', idParticipante: '003' }
    ] } },
    norm: value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    projectDisplay: value => value
  });
  assert.deepEqual(Array.from(c.transportParticipantSearchRows('marcia'), row => row.key), ['participante:A', 'participante:B']);
  assert.deepEqual(Array.from(c.transportParticipantSearchRows('marcia estudo b'), row => row.key), ['participante:B']);
  assert.deepEqual(Array.from(c.transportParticipantSearchRows('estudo a'), row => row.key), ['participante:A']);
  assert.deepEqual(Array.from(c.transportParticipantSearchRows('002'), row => row.key), ['participante:B']);
  assert.deepEqual(Array.from(c.transportParticipantSearchRows('joao'), row => row.key), ['participante:C']);
});

test('indice de participantes normaliza uma vez, invalida catalogos e preserva ambiguidades', () => {
  let normalizations = 0;
  const rows = Array.from({ length: 2000 }, (_, id) => ({ id: String(id), nome: 'Pessoa ' + id, projeto: 'Estudo A' }));
  const c = functions(['transportParticipantSearchRows', 'transportParticipantData', 'participantOptionKey', 'selectedParticipantInfo'], {
    transportParticipantIndex: null, transportCollator: new Intl.Collator('pt-BR'),
    state: { registro: {}, options: { participantes: rows, projetos: [] } },
    document: { getElementById: () => ({ value: 'participante:1999' }) },
    norm(value) { normalizations++; return String(value || '').toLowerCase().trim(); }, projectDisplay: value => value
  });
  c.transportParticipantSearchRows('pessoa');
  const built = normalizations;
  for (let i = 0; i < 3; i++) {
    assert.equal(c.transportParticipantSearchRows('1999').length, 1);
    assert.equal(c.selectedParticipantInfo(), rows[1999]);
  }
  assert.equal(normalizations - built, 3, 'somente consultas sao normalizadas depois de criar o indice');
  const firstIndex = c.transportParticipantIndex;
  c.state.options.projetos = [];
  assert.notEqual(c.transportParticipantData(), firstIndex);
  c.state.options.participantes = [{ id: '1999', nome: 'Renomeada' }];
  assert.equal(c.transportParticipantSearchRows('renomeada').length, 1);
  c.state.options.participantes = [{ id: '1999', nome: 'Outra' }];
  assert.equal(c.transportParticipantSearchRows('renomeada').length, 0, 'substituicao com mesmo tamanho invalida');
  c.state.options.participantes.push({ id: '1999', nome: 'Outra' });
  assert.equal(Object.keys(c.selectedParticipantInfo()).length, 0, 'ID duplicado nao seleciona arbitrariamente');
  assert.equal(c.transportParticipantData().byName.outra, null);
});

test('Transporte da Agenda preserva ID, estudo e identificacao sem carregar o catalogo de participantes', () => {
  const rpc = rpcQueue();
  const c = functions(['loadParticipantsOptions', 'selectedParticipantInfo', 'selectedParticipantName', 'selectedParticipantIdentification'], {
    ...rpc, state: { registro: { idAgenda: 'EVT-A', participanteCadastroId: 'CAD-A', paciente: 'Nome da Agenda', protocolo: 'Estudo A', identificacaoParticipante: '001', investigador: 'Investigador' }, options: {} },
    document: { getElementById: () => ({ value: 'legado:Nome da Agenda' }) }
  });
  c.loadParticipantsOptions();
  assert.equal(rpc.pending.length, 0);
  assert.equal(c.selectedParticipantInfo().participanteCadastroId, 'CAD-A');
  assert.equal(c.selectedParticipantInfo().projeto, 'Estudo A');
  assert.equal(c.selectedParticipantName(), 'Nome da Agenda');
  assert.equal(c.selectedParticipantIdentification(), '001');
});
