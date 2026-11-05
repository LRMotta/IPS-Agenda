'use strict';

const vm = require('node:vm');
const { readProjectFile } = require('./load-app-script');

function poloParser() {
  const context = vm.createContext({});
  vm.runInContext(readProjectFile('SharedSoAPlanningImport.html').replace(/^<script>/i, '').replace(/<\/script>\s*$/i, ''), context);
  return context;
}

function cell(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// Synthetic export with the layout of the Polo Trial Flowchart; values are fictitious.
function poloCsv(visits, separator = ',') {
  const field = key => visits.map(visit => visit[key] == null ? '' : visit[key]);
  const line = (head, label, values) => head.concat(label, values).map(cell).join(separator);
  const names = field('label');
  return '﻿' + [
    line(['Nome_do_estudo', '', '', '', 'Pendentes e Realizados'], 'Nome da Visita', names),
    line(['Braço_do_estudo', '', '', '', 'Data de Inclusão'], 'Observações', field('note')),
    line(['Moeda', 'Real_Brasileiro', '', '', ''], 'Intervalo', field('interval')),
    line(['Protocolo', '', '', '', ''], 'Unidade', visits.map(visit => visit.unit === undefined ? 'Dia(s)' : visit.unit)),
    line(['Versão', '1.0', '', '', ''], 'Após', field('after')),
    line(['', '', '', '', ''], 'Visita Referência', field('reference')),
    line(['', '', '', '', ''], 'Janela -', field('before')),
    line(['', '', '', '', ''], 'Janela +', field('later')),
    line(['', '', '', '', ''], 'Valor Visita', visits.map(() => '98765.43')),
    line(['', '', '', '', ''], 'Custo Visita (R$)', visits.map(() => '0')),
    line(['Nº', 'Nome do Procedimento', 'Valor', 'Custo no Protocolo (R$)', 'Observações'], '', names),
    line(['1', 'Procedimento confidencial, com vírgula', '12345.67', '0', '[1] Invoiceable.\n[2] Inc. OH.'], '', visits.map(() => 'P'))
  ].join('\r\n') + '\r\n';
}

const fixed = (label, interval, extra = {}) => ({ label, interval, after: 'Visita', reference: 'Ciclo 1 / Cycle 1', before: 1, later: 3, ...extra });

// Everything counts from a first visit dated by its own realization.
function singleAnchorVisits() {
  return [
    { label: 'Triagem / Screening', unit: 'Dias', after: 'Por demanda', before: 0, later: 0 },
    { label: 'Ciclo 1 / Cycle 1', unit: 'Dias', after: 'Por demanda', before: 0, later: 0 },
    fixed('Ciclo 2 / Cycle 2', 14), fixed('Ciclo 3 / Cycle 3', 28),
    fixed('Fim do tratamento / EOT', 364, { before: 7, later: 7 }),
    fixed('Período de acompanhamento de segurança 1 / Follow-Up Safety Period 1', 406, { before: 0, later: 7 }),
    { label: 'Visita não programada / Unscheduled Visit', unit: 'Dias', after: 'Por demanda', before: 0, later: 0 }
  ];
}

// Chained references, columns out of clinical order and clinical notes.
function chainedVisits() {
  const ramp = 'C2D1 (Ramp-up D1 of each week)';
  return [
    { label: 'Screening \\ Triagem', interval: 0, after: 'Inclusão', before: 28, later: -1 },
    { label: 'C1D1', interval: 0, after: 'Randomização', before: 0, later: 0 },
    { label: ramp, interval: 28, after: 'Visita', reference: 'C1D1', before: 0, later: 0 },
    { label: 'C3D1', interval: 28, after: 'Visita', reference: ramp, before: 2, later: 2 },
    { label: 'Safety Follow-Up \\ Acompanhamento de Segurança', interval: 30, after: 'Fim do tratamento', before: 7, later: 7, note: '[1] 30 dias após a última dose.' },
    { label: 'Long-Term Follow-Up \\ Acompanhamento a Longo Prazo', unit: 'Dias', after: 'Por demanda', before: 7, later: 7, note: 'A cada 12 semanas, a partir da randomização.' },
    { label: 'C2 (Ramp-up D4 of each week) \\ C2 (D4 do Escalonamento de cada semana)', unit: 'Dias', after: 'Por demanda', before: 0, later: 0, note: '[1] Invoiceable.' },
    { label: 'Screening Failure \\ Falha de Triagem', unit: 'Dias', after: 'Por demanda', before: 0, later: 0 },
    { label: 'C2D8 (Ramp-up D1 of each week)', interval: 7, after: 'Visita', reference: ramp, before: 0, later: 0 }
  ];
}

module.exports = { poloParser, poloCsv, singleAnchorVisits, chainedVisits, fixed };
