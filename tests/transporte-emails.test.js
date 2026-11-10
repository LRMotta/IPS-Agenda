'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFiles } = require('./helpers/load-app-script');

function servidor() {
  const s = runFiles(['TransporteCodexConfig.gs', 'TransporteEmails.gs'], {
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: {
      formatDate: (d, _fuso, padrao) => padrao.replace('dd', String(d.getDate()).padStart(2, '0'))
        .replace('MM', String(d.getMonth() + 1).padStart(2, '0')).replace('yyyy', d.getFullYear())
    }
  });
  // A planilha de Transporte nunca pode ser aberta pelo caminho novo.
  s.getTransporteSpreadsheetCodex_ = () => { throw new Error('planilha de Transporte aberta'); };
  s.transporteProjetoDisplay_ = (valor) => String(valor || '').trim();
  s.transporteReadAgendaCourierConfigs_ = () => ({
    marken: { emailCongelado: 'congelado@marken.example.invalid', emailAmbiente: 'ambiente@marken.example.invalid' },
    ocasa: { email: 'agenda@ocasa.example.invalid; extra@ocasa.example.invalid' },
    dhl: { email: 'dhl@example.invalid' },
    'pinex (agendamento)': { email: 'pinex@example.invalid' }
  });
  s.transporteReadLabCentral_ = () => [{
    nomeAbreviado: 'PPD Global (Covington)', nomeCompleto: 'PPD Global Central Lab Specimen Processing',
    endereco: '155 West 38th Street', cidade: 'Covington, Ohio - KY', pais: 'Estados Unidos'
  }];
  s.transporteCodexSaudacao_ = () => 'Bom dia';
  return s;
}

function registro(extra) {
  return Object.assign({
    paciente: 'Pessoa Participante', protocolo: 'EMBARQ (CDX0159-12)', investigador: 'Taciana Cappelletti',
    temperatura: 'CONGELADO', dataColeta: '2026-11-16', dataEnvio: '2026-11-16', horaEnvio: '13:00 - 15:00',
    courier: 'OCASA', destino: 'PPD Global (Covington)', awb: 'PK2PMY296965', refInterna: 'IPS-TRP-AB12CD34-T1',
    solicitarCaixa: '', materiais: []
  }, extra || {});
}

// Modelo "antigo": a aba como a planilha a entregava, com os valores das formulas da copia de 2026-11-09.
function ssAntigo(nomeAba, a1, valores, estilos) {
  const range = {
    getDisplayValues: () => valores.map((l) => l.slice()),
    getBackgrounds: () => estilos.bg, getFontColors: () => estilos.fg,
    getFontWeights: () => estilos.peso, getHorizontalAlignments: () => estilos.al
  };
  const aba = { getRange: (pedido) => { assert.equal(pedido, a1); return range; } };
  return { getId: () => 'antigo', getSheetByName: (nome) => (nome === nomeAba ? aba : null), getSheets: () => [] };
}

test('OCASA: corpo igual ao da aba "Email (OCASA)" com os valores da planilha de referência', () => {
  const s = servidor();
  const email = s.transporteEmailDoRegistro_(registro());
  const valores = [
    ['Nome da Instituição/Hospital:', 'Fundação Universidade de Caxias do Sul\nInstituto de Pesquisas em Saúde'],
    ['Endereço:', 'Rua Francisco Getúlio Vargas, 1130, Bairro Petrópolis'],
    ['Departamento/setor:', 'Bloco S, Sala 315'],
    ['Cidade/Estado:', 'Caxias do Sul, RS'],
    ['Telefone / Ramal:', '55 54 3218 2026'],
    ['Protocolo do estudo:', 'EMBARQ (CDX0159-12)'],
    ['Laboratório de Destino:', 'PPD Global Central Lab Specimen Processing. 155 West 38th Street. Covington, Ohio - KY, Estados Unidos'],
    ['Data:', '16/11/2026'],
    ['Horário (intervalo de duas horas):', '13:00 - 15:00'],
    ['Número da AWB / temperatura', 'PK2PMY296965 / CONGELADO']
  ];
  const estilos = {
    bg: valores.map(() => ['#ffffff', '#ffffff']), fg: valores.map((_l, i) => ['#000000', i === 9 ? '#0000ff' : '#ff0000']),
    peso: valores.map(() => ['bold', 'normal']), al: valores.map(() => ['left', 'left'])
  };
  const antigo = s.transporteCodexEmailHtml_(ssAntigo('Email (OCASA)', 'A1:B10', valores, estilos), 'emailOcasa', 'OCASA', 'Bom dia');
  assert.equal(email.html, antigo);
  assert.match(email.html, /Funda..o Universidade de Caxias do Sul<br>Instituto de Pesquisas/);
  assert.equal(email.assunto, 'EMBARQ (CDX0159-12) - PK2PMY296965 - 16NOV2026 - PPD Global (Covington) - AGENDAMENTO DE COLETA');
  assert.deepEqual(Array.from(email.destinatarios), ['agenda@ocasa.example.invalid', 'extra@ocasa.example.invalid']);
});

test('OCASA sem laboratório cadastrado preserva a concatenação da planilha', () => {
  const s = servidor();
  const email = s.transporteEmailDoRegistro_(registro({ destino: 'Desconhecido' }), { lab: null });
  assert.match(email.html, /\. \. <\/td>/);
});

test('MARKEN: corpo igual ao da aba "Email (MARKEN)", temperatura confirmada e volumes pela temperatura', () => {
  const s = servidor();
  const email = s.transporteEmailDoRegistro_(registro({ courier: 'MARKEN' }));
  const valores = [
    ['Agendamento', ''], ['Nº HAWB', 'PK2PMY296965'], ['PI', 'Taciana Cappelletti'], ['Data da Coleta', '16/11/2026'],
    ['Horário (Janela de 1 a 2 hrs)', '13:00 - 15:00'], ['Quantidade de volumes', '1'], ['Temperatura', 'CONGELADO'],
    ['Enviar Caixa de Transporte', 'Não'], ['Cidade', 'Caxias do Sul']
  ];
  const estilos = {
    bg: valores.map((_l, i) => (i === 0 ? ['#00b050', '#00b050'] : ['#2f5496', '#ffffff'])),
    fg: valores.map((_l, i) => (i === 0 ? ['#000000', '#000000'] : ['#ffffff', '#000000'])),
    peso: valores.map(() => ['bold', 'bold']), al: valores.map((_l, i) => (i === 0 ? ['center', 'center'] : ['left', 'left']))
  };
  const antigo = s.transporteCodexEmailHtml_(ssAntigo('Email (MARKEN)', 'A1:B9', valores, estilos), 'emailMarken', 'MARKEN', 'Bom dia', 'CONGELADO', false);
  assert.equal(email.html, antigo);
  assert.deepEqual(Array.from(email.destinatarios), ['congelado@marken.example.invalid']);
  // Temperatura mista: 2 volumes, como na Invoice (Excluir!B26 era um 1 fixo, corrigido).
  for (const temperatura of ['AMBIENTE + CONGELADO', 'AMBIENTE + REFRIGERADO']) {
    const mista = s.transporteEmailDoRegistro_(registro({ courier: 'MARKEN', temperatura }));
    assert.match(mista.html, /Quantidade de volumes<\/td><td[^>]*>2<\/td>/, temperatura);
  }
  for (const temperatura of ['AMBIENTE', 'CONGELADO', 'REFRIGERADO']) {
    assert.match(s.transporteEmailDoRegistro_(registro({ courier: 'MARKEN', temperatura })).html, /Quantidade de volumes<\/td><td[^>]*>1<\/td>/, temperatura);
  }
  // O PDF e o registro precisam ter a mesma temperatura.
  assert.throws(() => s.transporteEmailDoRegistro_(registro({ courier: 'MARKEN' }), { temperaturaPdf: 'AMBIENTE' }), /mesma temperatura/);
});

test('MARKEN com caixa especial: resposta, destinatário e cópias seguem o registro', () => {
  const s = servidor();
  const caixa = (tipoCaixa) => ({ tipoCaixa });
  const credo = s.transporteEmailDoRegistro_(registro({ courier: 'MARKEN', caixaTransporte: caixa('CREDO_CUBE') }));
  assert.deepEqual(Array.from(credo.destinatarios), ['protocolos.credo@marken.com']);
  assert.match(credo.html, new RegExp(s.TRANSPORTE_CAIXA_CREDO_CUBE_RESPOSTA_));
  const bio = s.transporteEmailDoRegistro_(registro({ courier: 'MARKEN', temperatura: 'AMBIENTE', caixaTransporte: caixa('BIOSYSTEM') }));
  assert.deepEqual(Array.from(bio.destinatarios), ['operacoes.cs@marken.com']);
  assert.match(bio.html, new RegExp(s.TRANSPORTE_CAIXA_BIOSYSTEM_RESPOSTA_));
  const ambiente = s.transporteEmailDoRegistro_(registro({ courier: 'MARKEN', temperatura: 'AMBIENTE' }));
  assert.match(ambiente.html, /Enviar Caixa de Transporte<\/td><td[^>]*>N.o<\/td>/);
});

test('DHL, PINEX (Agendamento), PINEX e courier sem rascunho', () => {
  const s = servidor();
  const dhl = s.transporteEmailDoRegistro_(registro({ courier: 'DHL', temperatura: 'AMBIENTE' }));
  assert.deepEqual(Array.from(dhl.destinatarios), ['dhl@example.invalid']);
  assert.match(dhl.html, /Ref\. interna<\/td><td[^>]*>IPS-TRP-AB12CD34-T1</);
  assert.match(dhl.html, /Solicitar Caixa de Transporte<\/td><td[^>]*>Sim</);
  assert.match(dhl.html, /Data de envio<\/td><td[^>]*>16\/11\/2026</);
  const semRef = s.transporteEmailDoRegistro_(registro({ courier: 'DHL', refInterna: '' }));
  assert.doesNotMatch(semRef.html, /Ref\. interna/);

  const pinexAg = s.transporteEmailDoRegistro_(registro({ courier: 'PINEX (Agendamento)', awb: '' }));
  assert.equal(pinexAg.assunto, 'EMBARQ (CDX0159-12) - 16NOV2026 - PPD Global (Covington) - AGENDAMENTO DE COLETA');
  assert.match(pinexAg.html, /Seguem anexos os dados para agendamento de coleta \(CNPJ : 88\.648\.761\/0001-03\)/);
  assert.deepEqual(Array.from(pinexAg.destinatarios), ['pinex@example.invalid']);

  const pinex = s.transporteEmailDoRegistro_(registro({ courier: 'PINEX' }));
  assert.equal(pinex.semRascunho, true);
  assert.equal(pinex.ok, true);
  const outra = s.transporteEmailDoRegistro_(registro({ courier: 'FEDEX' }));
  assert.deepEqual(JSON.parse(JSON.stringify([outra.semRascunho, outra.ok, outra.erro])), [true, false, 'COURIER_DRAFT_NOT_CONFIGURED']);
});

test('datas em dd/MM/yyyy ou ISO geram o mesmo texto e courier sem e-mail cadastrado é recusada', () => {
  const s = servidor();
  const iso = s.transporteEmailDoRegistro_(registro());
  const br = s.transporteEmailDoRegistro_(registro({ dataColeta: '16/11/2026', dataEnvio: '16/11/2026' }));
  assert.equal(br.html, iso.html);
  assert.equal(br.assunto, iso.assunto);
  s.transporteReadAgendaCourierConfigs_ = () => ({});
  assert.throws(() => s.transporteEmailDoRegistro_(registro()), /Cadastre o e-mail da courier/);
});
