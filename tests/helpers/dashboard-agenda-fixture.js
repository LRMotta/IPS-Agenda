'use strict';
const { runFiles } = require('./load-app-script');
const { FakeSheet } = require('./fake-spreadsheet');
class DashboardDate extends Date {
  constructor(...args) { super(...(args.length ? args : [2026, 9, 2, 12])); }
}
function dashboardAgendaFixture() {
  const server = runFiles(['AgendaServerRules.gs', 'WebApp.gs'], { Date: DashboardDate,
    Utilities: { formatDate: d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') } });
  const cfg = server.AGENDA_CFG;
  cfg.idx.participanteCadastroId = cfg.lastCol++;
  function row(data, tipo, status, values = {}) {
    const out = Array(cfg.lastCol).fill('');
    Object.entries(Object.assign({ data, tipo, status, projeto: 'Aurora', medico: 'Médico', participanteCadastroId: 'P1', labCentral: 'Sim' }, values))
      .forEach(([key, value]) => { out[cfg.idx[key]] = value; });
    out[cfg.idx.c1.nome] = 'Courier';
    out[cfg.idx.c2.nome] = 'Courier';
    out[cfg.idx.c3.nome] = 'Não aplicável';
    return out;
  }
  const rows = [
    row('06/01/2026', 'Visita', 'Realizado'), row('03/02/2026', 'Visita', 'Concluído'),
    row('04/02/2026', 'Visita', 'Cancelado'), row('04/02/2026', 'Visita', 'Reagendado'),
    row('04/02/2026', 'Visita', 'Não realizado'),
    row('04/02/2026', 'Monitoria', 'Realizado'), row('04/02/2026', 'Monitoria', 'Realizado'),
    row('04/02/2026', 'Monitoria', 'Agendado', { projeto: 'Outro' }),
    row('04/02/2026', 'SIV', 'Realizado'), row('04/02/2026', 'Monitoria', 'Cancelado'),
    row('02/10/2026', 'Visita', 'Realizado'), row('03/10/2026', 'Visita', 'Realizado'),
    row('03/10/2026', 'Monitoria', 'Agendado'), row('06/01/2027', 'Visita', 'Realizado'),
    row('inválida', 'Visita', 'Realizado'),
    row('04/02/2026', 'Envio de amostras', 'Realizado'),
    row('05/02/2026', 'Consulta', 'Realizado'),
    row('06/02/2026', 'Visita', 'Realizado', { participanteCadastroId: '', idParticipante: 'LEG-1' }),
    row('07/02/2026', 'Visita', 'Realizado', { participanteCadastroId: '', idParticipante: '', participante: 'Legado' }),
    row('08/02/2026', 'Visita', 'Realizado', { participanteCadastroId: '', idParticipante: '', participante: '' })
  ];
  const sheet = new FakeSheet('Agenda', [Array(cfg.lastCol).fill(''), ...rows]);
  let reads = 0;
  const getRange = sheet.getRange.bind(sheet);
  sheet.getRange = (...args) => { reads++; return getRange(...args); };
  server.getAgendaSheetForRead_ = () => sheet;
  return { server, sheet, rows, row, reads: () => reads, Date: DashboardDate };
}
module.exports = { dashboardAgendaFixture };
