'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

test('faixas etárias usam anos completos, status Ativo e preservam intervalos vazios', () => {
  const server = runFile('WebApp.gs');
  const rows = [
    ['19/10/2016', 'Ativo'], ['20/10/2016', 'Ativo'],
    ['19/10/2006', 'Ativo'], ['20/10/2006', 'Ativo'],
    ['19/10/1996', 'Ativo'], ['19/10/1926', 'Ativo'],
    ['19/10/2000', 'Em seguimento'], ['19/10/2000', 'Concluído'],
    ['', 'Ativo'], ['31/02/2000', 'Ativo'], ['2027-01-01', 'Ativo'], ['texto', 'Ativo']
  ].map(([nascimento, status]) => ({ nascimento, status }));
  const result = JSON.parse(JSON.stringify(server.dashboardAgregarParticipantes_(rows, '2026-10-19').faixasEtarias));
  assert.equal(result.total, 6);
  assert.equal(result.semNascimentoValido, 4);
  assert.deepEqual(result.faixas.slice(0, 4), [
    { label: '0–9', value: 1 }, { label: '10–19', value: 2 },
    { label: '20–29', value: 1 }, { label: '30–39', value: 1 }
  ]);
  assert.deepEqual(result.faixas.at(-1), { label: '100–109', value: 1 });
  assert.equal(result.faixas.find(f => f.label === '40–49').value, 0);
  assert.equal(result.faixas.reduce((sum, f) => sum + f.value, 0) + result.semNascimentoValido, 10);
  assert.equal(server.dashboardIdadeParticipante_('29/02/2000', '2026-02-28'), 25);
  assert.equal(server.dashboardIdadeParticipante_('29/02/2000', '2026-03-01'), 26);
  assert.equal(server.dashboardIdadeParticipante_('29/02/2001', '2026-03-01'), null);
});

test('nascimento Date considera o dia civil em São Paulo e não sai no agregado', () => {
  const server = runFile('WebApp.gs');
  server.Utilities = { formatDate: (date, zone, pattern) => {
    assert.equal(zone, 'America/Sao_Paulo');
    assert.equal(pattern, 'yyyy-MM-dd');
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } };
  const birth = require('node:vm').runInContext('new Date("2006-10-20T02:00:00Z")', server);
  assert.equal(server.dashboardIdadeParticipante_(birth, '2026-10-19'), 20);
  const result = server.dashboardAgregarParticipantes_([{ nome: 'Privado', nascimento: birth, status: 'Ativo' }], '2026-10-19');
  assert.equal(JSON.stringify(result).includes('Privado'), false);
  assert.equal(JSON.stringify(result).includes('2006'), false);
});
