'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

const TITULOS = {
  folhaAgendamento: 'Folha de Agendamento',
  folhaDhlPinex: 'Folha de Agendamento (DHL/PINEX)',
  declaracaoTransp: 'Declaração de Transporte'
};

function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function carregar(extra) {
  return runFiles(['TransporteDocumentosHtml.gs', 'TransporteDocumentosGrade.gs', 'TransporteFolhaAgendamentoHtml.gs'], Object.assign({
    Utilities: { formatDate: () => '30/10/2026 09:42' },
    transporteNormalizeCourierFromCodex_: v => {
      const n = norm(v);
      if (n.includes('dhl')) return 'DHL';
      if (n.includes('pinex')) return n.includes('agendamento') ? 'PINEX (Agendamento)' : 'PINEX';
      return String(v || '').trim().toUpperCase();
    },
    transporteNormalizeTemperaturaFromCodex_: v => String(v || '').trim().toUpperCase(),
    transporteParticipanteDocumento_: p => ({ iniciais: 'A.B.C.', identificacao: p.identificacaoParticipante || '', texto: '' }),
    transportePdfActualSheetName_: chave => TITULOS[chave] || '',
    transportePdfManifestText_: norm,
    codexMatBioItemUnit_: item => (norm(item.material) === 'fezes' ? 'g' : 'mL'),
    transporteLabCentralByDestino_: () => null
  }, extra || {}));
}

function registroBase(extra) {
  return Object.assign({
    paciente: 'Fulana de Tal Exemplo',
    identificacaoParticipante: '0021-0047',
    protocolo: 'MK-0000-021',
    investigador: 'Dra. Ana Exemplo',
    temperatura: 'Congelado',
    dataColeta: '2026-11-03',
    dataEnvio: '2026-11-03',
    horaEnvio: '09:00 - 12:00',
    courier: 'MARKEN',
    destino: 'Lab Exemplo',
    awb: '7741 2093 5812',
    agendadoPor: 'Maria Coordenadora',
    observacoes: 'Participante em jejum.',
    idAgenda: 'ag-destino',
    agendaSlot: '1',
    solicitarCaixa: 'Sim',
    materiais: [
      { row: 21, ativo: true, material: 'Sangue', tubos: 2, formula: '2×4,0', total: 8, ensaio: 'Hematologia' },
      { row: 22, ativo: false, material: 'Soro', tubos: '', formula: '', total: '', ensaio: '' },
      { row: 27, ativo: true, material: 'Fezes', tubos: 1, formula: '1×5,0', total: 5, ensaio: '', unit: 'g' },
      { row: 30, ativo: true, material: 'Swab <nasal>', tubos: '', formula: '', total: '', ensaio: '' }
    ]
  }, extra || {});
}

const SPEC_MARKEN = {
  ordem: ['Folha de Agendamento', 'Declaração de Transporte', 'Invoice (MARKEN)'],
  copias: { 'Folha de Agendamento': 1, 'Declaração de Transporte': 4, 'Invoice (MARKEN)': 4 }
};

const ORIGEM = { visita: 'Ciclo 3 · Dia 1', origem: { slot: 'backup', data: '2026-10-28', protocolo: 'MK-0000-021', iniciais: 'A.B.C.', visita: 'Ciclo 3 · Dia 1' } };

test('dados da folha reunem registro, Agenda, LabCentral e copias do PDF', () => {
  const app = carregar();
  const lab = { nomeCompleto: 'Laboratório Central Exemplo', endereco: '1000 Example Parkway', cidade: 'Indianapolis, IN', cep: '46200', pais: 'Estados Unidos' };
  const dados = app.transporteFolhaHtmlDados_({}, registroBase(), SPEC_MARKEN, { agendaContexto: ORIGEM, labCentral: lab, agora: '30/10/2026 09:42' });
  assert.equal(dados.dataEnvio, '03/11/2026');
  assert.equal(dados.diaEnvio, 'Terça');
  assert.equal(dados.transporte, 'Transporte I');
  assert.equal(dados.caixa, 'Sim');
  assert.equal(dados.temperatura, 'CONGELADO');
  assert.equal(dados.visita, 'Ciclo 3 · Dia 1');
  assert.equal(dados.cidade, 'Indianapolis, IN 46200');
  assert.equal(dados.assinaturaCourier, false);
  assert.deepEqual(JSON.parse(JSON.stringify(dados.origem)), { backup: 'Backup I', data: '28/10/2026', dia: 'Quarta', protocolo: 'MK-0000-021', iniciais: 'A.B.C.', visita: 'Ciclo 3 · Dia 1' });
  assert.deepEqual(JSON.parse(JSON.stringify(dados.documentos)), [
    { nome: 'Folha de Agendamento', copias: 1 }, { nome: 'Declaração de Transporte', copias: 4 }, { nome: 'Invoice (MARKEN)', copias: 4 }
  ]);
  // Somente materiais ativos; "Outro" sem quantidades; totais por unidade.
  assert.deepEqual(JSON.parse(JSON.stringify(dados.materiais.linhas.map(l => [l.material, l.quantidade, l.total, l.outro]))), [
    ['Sangue', '2×4,0 mL', '8 mL', false], ['Fezes', '1×5,0 g', '5 g', false], ['Swab <nasal>', '', '', true]
  ]);
  assert.equal(dados.materiais.tubos, 3);
  assert.equal(dados.materiais.total, '8 mL · 5 g');
});

test('DHL/PINEX usam AWB, agendador e COL. Nº da folha DHL/PINEX e pedem a assinatura do agente', () => {
  const app = carregar();
  const dados = app.transporteFolhaHtmlDados_({}, registroBase({
    courier: 'Pinex', awb: '', pinexAwb: '2210 8846 31', agendadoPor: 'X', pinexAgendadoPor: 'João Exemplo', pinexColeta: '418207', agendaSlot: '3'
  }), SPEC_MARKEN, { agendaContexto: { visita: '', origem: null }, labCentral: null });
  assert.equal(dados.courier, 'PINEX');
  assert.equal(dados.awb, '2210 8846 31');
  assert.equal(dados.agendadoPor, 'João Exemplo');
  assert.equal(dados.pinexColeta, '418207');
  assert.equal(dados.caixa, '');
  assert.equal(dados.transporte, 'Transporte III');
  assert.equal(dados.laboratorio, 'Lab Exemplo');
  assert.equal(dados.assinaturaCourier, true);

  const html = app.transporteFolhaHtmlPagina_(dados, {});
  assert.match(html, /Recebido pelo agente do courier/);
  assert.match(html, /COL\. Nº <b class="mono">418207<\/b>/);
  assert.doesNotMatch(html, /Origem/);
  assert.doesNotMatch(html, /Documento<\/td>/);
  // Assinatura ocupa espaco: menos linhas de observacao; com poucos materiais o layout e o normal.
  assert.match(html, /<div class="fa">/);
  assert.match(html, /<p>Participante em jejum\.<\/p>(<div class="linha"><\/div>){5}<\/div>/);

  // DHL/PINEX com muitos materiais usa o modo compacto para caber com a assinatura.
  const muitos = Array.from({ length: 7 }, (_, i) => ({ row: 21 + i, ativo: true, material: 'M' + i, tubos: 1, formula: '1×1,0', total: 1 }));
  const compacto = app.transporteFolhaHtmlPagina_(Object.assign({}, dados, { materiais: app.transporteFolhaHtmlMateriais_(muitos) }), {});
  assert.match(compacto, /<div class="fa compacto">/);
  assert.match(compacto, /<p>Participante em jejum\.<\/p>(<div class="linha"><\/div>){3}<\/div>/);
  assert.equal((compacto.match(/<div style="height:8px"><\/div>/g) || []).length, 5);
});

test('pagina MARKEN mostra Transporte e Origem, sem assinatura, Ref. interna ou horarios indisponiveis', () => {
  const app = carregar();
  const dados = app.transporteFolhaHtmlDados_({}, registroBase(), SPEC_MARKEN, { agendaContexto: ORIGEM, labCentral: null, agora: '30/10/2026 09:42' });
  const html = app.transporteFolhaHtmlPagina_(dados, { logoSrc: 'data:image/png;base64,AAA' });
  assert.match(html, /<img class="logo" src="data:image\/png;base64,AAA"/);
  assert.match(html, /<span class="lbl">Transporte<\/span><b>Transporte I<\/b>/);
  assert.match(html, /Criado a partir do <b>Backup I<\/b> do agendamento de <b>28\/10\/2026 \(qua\)<\/b> · MK-0000-021 · A\.B\.C\. · Ciclo 3 · Dia 1/);
  assert.match(html, /<span class="tipo">CONGELADO<\/span>/);
  assert.match(html, /Terça · retirada <b>09:00 - 12:00<\/b>/);
  assert.match(html, /Caixa de transporte: <b>Sim<\/b>/);
  assert.match(html, /<b>Outro:<\/b> Swab &lt;nasal&gt;/);
  assert.match(html, /3 materiais<\/td><td class="c">3<\/td><td><\/td><td class="r">8 mL · 5 g<\/td>/);
  assert.match(html, /Invoice \(MARKEN\)<\/td><td class="r copias">4<\/td>/);
  assert.match(html, /<p>Participante em jejum\.<\/p>(<div class="linha"><\/div>){7}<\/div>/);
  assert.match(html, /<div class="fa">/);
  assert.doesNotMatch(html, /Recebido pelo agente|Ref\. interna|Confirma|Agendado em|P[aá]gina \d/);
  // O conversor HtmlService nao aceita flex/grid e nao imprime fundos.
  assert.doesNotMatch(html, /display:\s*(flex|grid)|background/);
});

test('folha sem transporte nem origem omite a faixa; sem materiais avisa', () => {
  const app = carregar();
  const dados = app.transporteFolhaHtmlDados_({}, registroBase({ agendaSlot: '', idAgenda: '', materiais: [], observacoes: '' }), SPEC_MARKEN, {
    agendaContexto: { visita: '', origem: null }, labCentral: null
  });
  const html = app.transporteFolhaHtmlPagina_(dados, {});
  assert.doesNotMatch(html, /class="meta"/);
  assert.doesNotMatch(html, />Visita</);
  assert.match(html, /Nenhum material marcado na Declaração de Transporte\./);
  assert.match(html, /Observações<\/h2>(<div class="linha"><\/div>){8}<\/div>/);
});

test('nome do participante bloqueia a folha', () => {
  const app = carregar();
  const spec = SPEC_MARKEN;
  const registro = registroBase({ observacoes: 'Ligar para Fulana de Tal Exemplo' });
  assert.throws(() => app.transporteFolhaHtmlParaGrade_({}, registro, spec, { agendaContexto: ORIGEM, labCentral: null }),
    /identificação nominal presente na Folha de Agendamento/);
  const ok = app.transporteFolhaHtmlParaGrade_({}, registroBase(), spec, { agendaContexto: ORIGEM, labCentral: null });
  assert.deepEqual(Array.from(ok.abas), ['Folha de Agendamento']);
  assert.doesNotMatch(ok.html, /Fulana/);
});

test('montagem da grade usa o HTML da folha no lugar da aba, com as copias', () => {
  const app = carregar({ transporteDocsHtmlValidarAltura_: () => {} });
  const html = app.transporteDocsGradeMontar_({}, [{ aba: 'Folha de Agendamento', copias: 1, html: '<p>FOLHA</p>' }], {});
  assert.equal((html.match(/<div class="pagina"><p>FOLHA<\/p><\/div>/g) || []).length, 1);
  assert.throws(() => app.transporteDocsGradeMontar_({}, [{ aba: 'Outra', copias: 1 }], {}), /Aba necessária não encontrada: Outra/);
});

test('contexto da Agenda usa uma unica busca de texto e confirma ID e vinculo do Backup', () => {
  // Colunas (1-based): 1 id, 2 data, 6 participante, 9 projeto, 11 visita, 12 backup ref, 13 backup II.
  const linhas = [
    ['ag-origem-falsa', '2026-10-20', 'Outra Pessoa', 'P-1', 'V1', '{"id":"ag-destino-2"}', ''],
    ['ag-destino-2', '03/11/2026', 'Outra Pessoa', 'P-1', 'Outra visita', '', ''],
    ['ag-origem', '28/10/2026', 'Fulana de Tal Exemplo', 'MK-0000-021', 'Ciclo 3 · Dia 1', '{"id":"ag-destino"}', ''],
    ['ag-destino', '03/11/2026', 'Fulana de Tal Exemplo', 'MK-0000-021', 'Envio C3D1', '', '']
  ].map(([id, data, part, proj, vis, ref, b2]) => {
    const row = Array(13).fill('');
    row[0] = id; row[1] = data; row[5] = part; row[8] = proj; row[10] = vis; row[11] = ref; row[12] = b2;
    return row;
  });
  const chamadas = { buscas: 0, leituras: [] };
  const sheet = {
    getLastRow: () => linhas.length + 1,
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => {
          chamadas.leituras.push(nr);
          return linhas.slice(r - 2, r - 2 + nr).map(l => l.slice(c - 1, c - 1 + nc));
        },
        createTextFinder: texto => ({
          matchCase() { return this; },
          findAll: () => {
            chamadas.buscas++;
            const out = [];
            linhas.slice(r - 2, r - 2 + nr).forEach((l, i) => l.slice(c - 1, c - 1 + nc).forEach((v, j) => {
              if (String(v).includes(texto)) out.push({ getRow: () => r + i, getColumn: () => c + j });
            }));
            return out;
          }
        })
      };
    }
  };
  const app = carregar({
    AGENDA_CFG: {
      lastCol: 13,
      col: { id: 1, visita: 11, backupAgendaRef: 12, backup2Dados: 13 },
      idx: { id: 0, data: 1, participante: 5, projeto: 8, visita: 10 }
    },
    getAgendaSheetForRead_: () => sheet,
    agendaBackupFromRow_: (row, slot) => ({ agendamentos: slot === 'backup' && row[11] ? [JSON.parse(row[11])] : [] }),
    extrairIniciais_: nome => String(nome).split(/\s+/).filter(p => !['de', 'da', 'do'].includes(p.toLowerCase())).map(p => p[0].toUpperCase() + '.').join('')
  });
  const tempos = {};
  const ctx = app.transporteFolhaHtmlAgendaContexto_('ag-destino', tempos);
  // "ag-destino" tambem aparece em "ag-destino-2" (ID e vinculo de outra linha): so o ID exato e o vinculo valido contam.
  assert.equal(ctx.visita, 'Envio C3D1');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.origem)), { slot: 'backup', data: '28/10/2026', protocolo: 'MK-0000-021', iniciais: 'F.T.E.', visita: 'Ciclo 3 · Dia 1' });
  // Uma busca; leituras so de linhas inteiras individuais, sem ler a coluna de IDs.
  assert.equal(chamadas.buscas, 1);
  assert.ok(chamadas.leituras.every(n => n === 1));
  assert.ok(chamadas.leituras.length <= 4);
  assert.ok(['abrirMs', 'buscaMs', 'linhasMs', 'linhasLidas'].every(k => typeof tempos[k] === 'number'));

  assert.equal(app.transporteFolhaHtmlDataAgenda_('28/10/2026').texto, '28/10/2026');
  assert.equal(app.transporteFolhaHtmlAgendaContexto_('ag-origem').origem, null);
  assert.equal(app.transporteFolhaHtmlAgendaContexto_('inexistente').visita, '');
  assert.deepEqual(JSON.parse(JSON.stringify(app.transporteFolhaHtmlAgendaContexto_(''))), { visita: '', origem: null });
});
