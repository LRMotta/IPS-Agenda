'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFile } = require('./helpers/load-app-script');

function fixture(sexo, cadastroId = 'P-2') {
  const idx = { data: 0, tipo: 1, projeto: 2, participante: 3, nasc: 4, idParticipante: 5, braco: 6, visita: 7, participanteCadastroId: 8 };
  const rows = [
    ['P-1', 'Pessoa Teste', '01/01/1980', '', '001', 'Estudo', '', '', '', 'Masculino'],
    ['P-2', 'Pessoa Teste', '02/02/1981', '', '002', 'Estudo', '', '', '', sexo]
  ];
  const headers = ['ID', 'Nome', 'Nascimento', '', 'Número', 'Projeto', 'Braço', '', '', 'Sexo no nascimento'];
  const sheet = {
    getLastRow: () => 3,
    getLastColumn: () => headers.length,
    getRange: row => ({ getValues: () => row === 1 ? [headers] : rows })
  };
  const server = runFile('WebApp.gs', {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) }
  });
  server.AGENDA_CFG = { idx };
  const dados = ['28/out./2026', 'Visita', 'Estudo', 'Pessoa Teste', '', '002', '', 'C1D1', cadastroId];
  return { server, dados, headers };
}

test('tabela inclui dia e sexo na ordem solicitada, usando cadastro exato entre homônimos', () => {
  const { server, dados } = fixture('Feminino');
  const html = server.gerarTabelaAgendaEmail_(dados, true);
  const labels = [...html.matchAll(/<b>(.*?)<\/b>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Data', 'Dia da Semana', 'Tipo de Evento', 'Protocolo', 'Participante', 'Sexo', 'Data de Nascimento', 'Número de Identificação', 'Braço/Grupo', 'Visita']);
  assert.match(html, />Quarta-feira<\/td>/);
  assert.match(html, />Feminino<\/td>/);
  assert.match(html, />02\/02\/1981<\/td>/);
});

for (const sexo of ['', '   ', 'Não informado', '<b>Feminino</b>']) {
  test('sexo vazio tem fallback e conteúdo é escapado: ' + JSON.stringify(sexo), () => {
    const { server, dados } = fixture(sexo);
    dados[4] = '03/03/1982';
    const html = server.gerarTabelaAgendaEmail_(dados, true, 'Data Original');
    assert.match(html, /<b>Data Original<\/b>/);
    assert.match(html, />03\/03\/1982<\/td>/);
    assert.ok(html.includes(sexo.includes('<') ? '&lt;b&gt;Feminino&lt;/b&gt;' : 'Não informado'));
  });
}

test('cadastro legado sem coluna sexo não altera schema e exibe fallback', () => {
  const { server, dados, headers } = fixture('Feminino');
  headers.pop();
  assert.match(server.gerarTabelaAgendaEmail_(dados, true), />Não informado<\/td>/);
});

test('referência ambígua não usa sexo de homônimo', () => {
  const { server, dados } = fixture('Feminino', '');
  dados[5] = '';
  assert.match(server.gerarTabelaAgendaEmail_(dados, true), />Não informado<\/td>/);
});

test('dia da semana cobre sete dias, datas legadas e ausência de data', () => {
  const { server } = fixture('Feminino');
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  dias.forEach((dia, index) => assert.equal(server.agendaDiaSemanaEmail_('2026-10-' + (25 + index)), dia));
  assert.equal(server.agendaDiaSemanaEmail_('28/10/2026'), 'Quarta-feira');
  for (const valor of ['', null, 'inválida']) assert.equal(server.agendaDiaSemanaEmail_(valor), 'Não informado');
});

test('dia da semana de um instante respeita São Paulo perto da meia-noite UTC', () => {
  const calls = [];
  const server = runFile('WebApp.gs', {
    Date,
    Utilities: { formatDate: (date, tz, pattern) => {
      calls.push([tz, pattern]);
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    } }
  });
  assert.equal(server.agendaDiaSemanaEmail_(new Date('2026-10-29T01:00:00Z')), 'Quarta-feira');
  assert.deepEqual(calls, [['America/Sao_Paulo', 'yyyy-MM-dd']]);
});
