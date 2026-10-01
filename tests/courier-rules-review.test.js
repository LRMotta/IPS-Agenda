'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles, runHtmlScript, readProjectFile, projectRoot } = require('./helpers/load-app-script');
const { generate, renderTarget } = require('../tools/generate-courier-rules');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('AWB excedente e preservada e rejeitada no cliente e servidor antes dos documentos', () => {
  const client = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const server = runFiles(['WebApp.gs']);
  for (const [courier, value] of [['DHL', '12345678901'], ['MARKEN', 'AB12CD34EF567'], ['OCASA', 'PK2WIZ177555X']]) {
    assert.equal(client.normalizeAwb(value, courier), value);
    assert.equal(server.codexCourierNormalizeAwb_(value, courier), value);
    assert.equal(client.isValidAwb(value, courier, true), false);
    assert.equal(server.codexCourierIsValidAwb_(value, courier, true), false);
    assert.throws(() => server.codexCourierAssertDocumentAwb_(value, courier), /AWB/);
    const input = { value, removeAttribute(name) { delete this[name]; } };
    client.applyToInput(input, courier, true);
    assert.equal(input.value, value, 'aplicar regra nao apaga caracteres');
    assert.equal(input.maxLength, undefined, 'maxlength nao corta colagem antes da validacao');
  }
});

test('normalizacao PINEX e auxiliar OCASA permanecem iguais nos dois runtimes', () => {
  const client = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const server = runFiles(['WebApp.gs']);
  for (const value of [' PIN-123 ', '', '   ', 123]) {
    assert.equal(client.normalizeAwb(value, 'PINEX'), server.codexCourierNormalizeAwb_(value, 'PINEX'));
  }
  for (const value of ['a-1234567', 'pk2 wiz177555', 'PK2WIZ177555X', '', null]) {
    assert.equal(client.isValidOcasaAwb(value), server.codexCourierIsValidOcasaAwb_(value));
  }
});

test('indice respeita recorrencia, bissexto, flags, aliases e ordem entre feriados', () => {
  const client = runHtmlScript('SharedCourierRules.html').CodexCourierRules;
  const server = runFiles(['CourierServerRules.gs']).CodexCourierRiskRules_;
  const holidays = [
    { dataIso: '2026-12-25', recorrencia: 'Anual', nome: 'Anual' },
    { data: '2027-12-25', nome: 'Especifico' },
    { dataIso: '2024-02-29', recurrence: 'Todo ano', nome: 'Bissexto' },
    { dataIso: '2026-12-25', recorrencia: 'Anual', ativo: 'Não', nome: 'Inativo' },
    { dataIso: '2026-12-25', recorrencia: 'Anual', afetaOperacao: 'Não', nome: 'Visual' },
    { dataIso: '2027-02-30', nome: 'Invalido' }
  ];
  for (const rules of [client, server]) {
    const index = rules.createHolidayIndex(holidays);
    assert.deepEqual(plain(rules.holidayItemsForDate('2027-12-25', index, true)).map(item => item.nome), ['Anual', 'Especifico']);
    assert.deepEqual(plain(rules.holidayItemsForDate('2027-12-25', index, false)).map(item => item.nome), ['Anual', 'Especifico', 'Visual']);
    assert.equal(rules.holidayItemsForDate('2027-02-29', index, true).length, 0);
    assert.equal(rules.holidayItemsForDate('2028-02-29', index, true).length, 1);
    assert.equal(rules.holidayItemsForDate('2028-12-25', index, true).length, 1);
    for (const date of ['2027-12-25', '2027-12-26', '2028-02-29', '2028-03-01', 'invalida']) {
      assert.deepEqual(plain(rules.operationalRisk(date, { restricaoAposFeriado: 'Sim' }, index)), plain(rules.operationalRisk(date, { restricaoAposFeriado: 'Sim' }, holidays)));
    }
    assert.equal(rules.activeHolidayMap(holidays, 2027)['2027-12-25'].length, 2);
    assert.equal(rules.activeHolidayMap(holidays, 2027)['2027-02-29'], undefined);
    assert.equal(rules.activeHolidayMap(holidays, 2028)['2028-02-29'].length, 1);
    assert.equal(rules.activeHolidayMap(holidays)['2026-12-25'].length, 1, 'contrato sem ano preservado');
    holidays[0].ativo = 'Não';
    assert.equal(rules.holidayItemsForDate('2027-12-25', rules.createHolidayIndex(holidays), true).length, 1, 'nova avaliacao reflete mutacao');
    delete holidays[0].ativo;
  }
});

test('indice reutilizado evita revalidar todos os feriados para cada courier e data', () => {
  for (const runtime of ['client', 'server']) {
    let dates = 0;
    class CountingDate extends Date { constructor(...args) { super(...args); dates++; } }
    const rules = runtime === 'client'
      ? runHtmlScript('SharedCourierRules.html', { Date: CountingDate }).CodexCourierRules
      : runFiles(['CourierServerRules.gs'], { Date: CountingDate }).CodexCourierRiskRules_;
    const holidays = Array.from({ length: 100 }, () => ({ dataIso: '2026-12-25', recorrencia: 'Anual' }));
    const index = rules.createHolidayIndex(holidays);
    for (let i = 0; i < 4; i++) assert.equal(rules.operationalRisk('2027-12-25', {}, index).holiday.length, 100);
    assert.equal(dates, 104);
  }
});

test('gerador detecta divergencias e preserva conteudo fora do bloco courier', () => {
  assert.equal(generate(projectRoot, true), 0);
  const source = readProjectFile('SharedCourierRules.html');
  const stale = source.replace("return recurrence === 'ANUAL'", "return recurrence === 'MENSAL'");
  assert.equal(renderTarget(stale), source);
  const outside = source.replace("placeholder: 'AWB'", "placeholder: 'AWB externo'");
  assert.equal(renderTarget(outside), outside);
  assert.throws(() => renderTarget('sem bloco'), /ausente/);
});
