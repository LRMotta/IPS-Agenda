'use strict';
/* global window, document */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { agendaBrowserFixture } = require('../helpers/agenda-browser-fixture');
let browser;
before(async () => { browser = await loadPlaywright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function scenario(run, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Tokyo', ...options });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    const errors = await agendaBrowserFixture(page);
    assert.equal(await page.title(), 'Agenda — teste local');
    assert.ok((await page.locator('body').innerText()).includes('AGENDA'));
    await run(page);
    assert.deepEqual(errors, [], 'nenhum erro de JavaScript ou console');
  } finally { await context.close(); }
}

test('Close-out fica junto de Monitorias e SIV com tipo correto e secao recolhivel', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => {
        document.getElementById('agendaCreatePanel').classList.remove('open');
        const mount = document.createElement('div');
        mount.id = 'closeoutTest';
        document.body.prepend(mount);
        const rows = [
          { id: 'M1', rowIndex: 1, tipo: 'Monitoria', status: 'Agendado', projeto: 'Estudo A' },
          { id: 'S1', rowIndex: 2, tipo: 'SIV', status: 'Agendado', projeto: 'Estudo B' },
          { id: 'C1', rowIndex: 3, tipo: 'Close-out', status: 'Agendado', projeto: 'ENERGIZE', participante: 'legacy-event:01e12b5a', medico: 'Medico de teste', hora: '08:00' },
          { id: 'C2', rowIndex: 4, tipo: 'Close-out', status: 'Cancelado', projeto: 'Estudo C' }
        ];
        window.renderAgendaLista = () => { mount.innerHTML = window.agendaDayRowsHtml(rows, '2026-10-07'); };
        window.renderAgendaLista();
      });
      const group = page.locator('#closeoutTest .ag-monitorias-group');
      assert.equal(await group.locator('.ag-monitoria-compact').count(), 3);
      const closeout = group.locator('#agCard3');
      assert.equal(await closeout.locator('.ag-appt-name').innerText(), 'ENERGIZE');
      assert.ok((await closeout.innerText()).includes('Close-out'));
      assert.ok((await closeout.innerText()).includes('Medico de teste'));
      assert.ok(!(await closeout.innerText()).includes('legacy-event:'));
      assert.equal(await page.locator('#closeoutTest .ag-cancelados-items .ag-appt').count(), 1);
      await group.locator('.ag-monitorias-toggle').click();
      assert.equal(await group.locator('.ag-monitoria-compact').count(), 0);
      await group.locator('.ag-monitorias-toggle').click();
      assert.equal(await group.locator('.ag-monitoria-compact').count(), 3);
    }, { viewport: { width, height: 900 } });
  }
});

test('edicao consulta evento e periodo juntos preservando pulldowns e valores historicos', async () => {
  await scenario(async page => {
    await page.evaluate(() => {
      document.getElementById('agendaCreatePanel').classList.remove('open');
      window._agendaEditId = '';
      const data = { ...window._agendaDados, courierConfig: {}, projectCourierMap: {}, emailLabAtivo: false };
      ['tiposEvento', 'status', 'medicos', 'prestadores', 'monitores', 'salasMonitoria', 'couriers', 'temperaturas', 'statusCourier', 'laboratoriosDestino', 'procedimentoChips', 'laboratorios', 'feriados'].forEach(key => { data[key] = []; });
      Object.assign(data, { tiposEvento: ['Visita', 'Monitoria'], status: ['Agendado', 'Realizado'], medicos: ['Medico A', 'Medico B'], prestadores: ['Prestador A', 'Prestador B'], salasMonitoria: ['Sala 1', 'Sala 2'], couriers: ['Marken', 'Ocasa'], temperaturas: ['Ambiente', 'Congelado'], statusCourier: ['Agendado', 'Enviado'], laboratoriosDestino: ['Lab A', 'Lab B'] });
      window.applyAgendaFormData(data);
      window._agendaEventosScope = 'window';
      window._agendaEventosTruncated = false;
      window.calls.length = 0;
      window.abrirAgendaEdicao('M1', 7);
    });
    assert.equal(await page.locator('#agendaCreatePanel').evaluate(el => el.classList.contains('open')), false);
    assert.deepEqual(await page.evaluate(() => window.calls.map(c => ({ method: c.method, args: c.args }))), [{ method: 'getAgendaEdicaoContexto', args: ['M1', 7, true] }]);
    await page.evaluate(() => window.calls[0].success({ evento: { id: 'M1', rowIndex: 7, tipo: 'Monitoria', status: 'Agendado', projeto: 'Estudo A', monitorName: 'Monitor historico', salaMonitoria: 'Sala 1', dataIso: '2026-10-05', hora: '08:00', recordVersion: 'atual', editRecordVersion: 'editavel' }, periodo: { eventoId: 'M1', ids: ['M1', 'M2'], inicio: '2026-10-05', fim: '2026-10-06' } }));
    assert.equal(await page.locator('#agendaCreatePanel').evaluate(el => el.classList.contains('open')), true);
    assert.equal(await page.locator('#agData').inputValue(), '2026-10-05');
    assert.equal(await page.locator('#agDataFim').inputValue(), '2026-10-06');
    assert.equal(await page.locator('#agMonitor1').inputValue(), 'Monitor historico');
    assert.equal(await page.locator('#agSalaMonitoria').inputValue(), 'Sala 1');
    assert.deepEqual(await page.locator('#agMedico option').allTextContents(), ['', 'Medico A', 'Medico B']);
    assert.deepEqual(await page.locator('#agPrestador option').allTextContents(), ['', 'Prestador A', 'Prestador B']);
    assert.ok((await page.locator('#agC1Nome option').allTextContents()).includes('Ocasa'));
    assert.equal(await page.evaluate(() => window.calls.filter(c => ['getAgendaEventoPorId', 'getAgendaPeriodoOperacionalPorEventoId', 'getDadosFormularioAgenda'].includes(c.method)).length), 0);
    assert.equal(await page.evaluate(() => window._agendaEditRecordVersion), 'atual');
    assert.equal(await page.evaluate(() => window.agendaFormularioEstaPronto_()), true);
  });
});

test('Agenda: colagem de AWB excedente permanece visivel e invalida em desktop e celular', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => {
        const courier = document.getElementById('agC1Nome');
        courier.innerHTML = '<option value="MARKEN">MARKEN</option>';
        courier.value = 'MARKEN';
        const input = document.getElementById('agC1Awb');
        for (let el = input; el && el !== document.body; el = el.parentElement) {
          if (window.getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        window.applyAgendaAwbRule('agC1', true);
      });
      const input = page.locator('#agC1Awb');
      await input.fill('AB12CD34EF567');
      assert.equal(await input.inputValue(), 'AB12CD34EF567');
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await input.scrollIntoViewIfNeeded();
      await input.screenshot({ path: path.join(dir, 'courier-awb-excedente-' + width + '.png') });
      await input.fill('ab-12 cd34 ef56');
      assert.equal(await input.inputValue(), 'AB12CD34EF56');
      assert.equal(await input.getAttribute('aria-invalid'), 'false');
    }, { viewport: { width, height: 900 } });
  }
});

test('Backup: opções persistentes, liberação por temperatura e vínculo em desktop e celular', async () => {
  for (const width of [1280, 390]) {
    await scenario(async page => {
      await page.evaluate(() => {
        const wrap = document.getElementById('agBackupWrap');
        wrap.dataset.forceOpen = '1';
        for (let el = wrap; el && el !== document.body; el = el.parentElement) {
          if (window.getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        document.getElementById('agBackupTemp').innerHTML = '<option value="">Selecione</option><option value="Congelado">Congelado</option>';
        window._agendaEditRecord = { id: 'A', backup: {} };
        window.atualizarEstadoNovoEnvioBackup_();
      });
      const step = page.locator('#backupAgendaStep');
      const actions = step.locator('button.ag-backup-agenda-choice');
      assert.equal(await step.isVisible(), true);
      assert.equal(await actions.count(), 2);
      for (const action of await actions.all()) assert.equal(await action.isDisabled(), true);
      assert.match(await page.locator('#backupAgendaHint').innerText(), /Informe a temperatura/);
      await page.locator('#agBackupTemp').selectOption('Congelado');
      for (const action of await actions.all()) assert.equal(await action.isEnabled(), true);
      assert.match(await page.locator('#backupAgendaHint').innerText(), /Você já pode agendar/);
      await page.locator('#btnUsarVisitaFuturaBackup').click();
      assert.equal(await page.locator('#backupAgendaVisitas').isVisible(), true);
      assert.equal(await page.evaluate(() => window.calls.at(-1).method), 'getAgendaVisitasFuturasParaBackup');
      await page.locator('#agBackupTemp').selectOption('');
      await page.evaluate(() => window.calls.at(-1).success({ visitas: [] }));
      assert.equal(await page.locator('#backupAgendaVisitas').isVisible(), false, 'resposta tardia não reabre opções bloqueadas');
      await page.locator('#agBackupTemp').selectOption('Congelado');
      await step.scrollIntoViewIfNeeded();
      const box = await step.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, 'etapa cabe na tela');
      if (width === 390) {
        const save = await page.locator('.ag-modal-actions').boundingBox();
        assert.ok(box.y + box.height <= save.y, 'barra de salvar não cobre as opções');
      }
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await step.screenshot({ path: path.join(dir, 'backup-agendamento-' + width + '.png'), animations: 'disabled' });
      await page.evaluate(() => {
        window._agendaEditRecord = { id: 'A', backup: { agendamento: { id: 'FUTURA', slot: 'III' } } };
        window.atualizarEstadoNovoEnvioBackup_();
      });
      assert.equal(await step.isVisible(), false);
      assert.match(await page.locator('#backupAgendaRefInfo').innerText(), /Agendamento vinculado/);
      await page.evaluate(() => {
        window._agendaEditRecord = { id: 'OUTRO', backup: {} };
        document.getElementById('agBackupTemp').value = '';
        window.atualizarEstadoNovoEnvioBackup_();
      });
      assert.equal(await step.isVisible(), true, 'nova edição recupera a etapa');
      for (const action of await actions.all()) assert.equal(await action.isDisabled(), true);
    }, { viewport: { width, height: 900 } });
  }
});

test('Agenda: Courier fixa bloqueia mistura durante transicao, preserva gramas e valida formula completa', async () => {
  await scenario(async page => {
    await page.evaluate(() => {
      const courier = document.getElementById('agC1Nome');
      courier.innerHTML = '<option value="MARKEN">MARKEN</option><option value="DHL">DHL</option>';
      courier.value = 'MARKEN';
      document.getElementById('agTransporteCard').style.display = 'block';
      window.agendaMatBioSetItems('agC1', [{ key: 'soro', formula: '1x500', unit: 'mL' }, { key: 'fezes', formula: '2x5', unit: 'g' }]);
      courier.value = 'DHL';
      window.onAgendaCourierChange('agC1');
      window.agendaMatBioAddRow('agC1', { key: 'soro', formula: '' });
    });
    const soro = page.locator('.ag-mat-line[data-prefix="agC1"]').filter({ has: page.locator('select option:checked[value="soro"]') });
    await soro.last().locator('.ag-mat-formula').fill('1x0,5');
    assert.equal(await soro.first().locator('.ag-mat-formula').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => window.agendaMatBioValidateAll()), false);
    await page.evaluate(() => window.agendaMatBioConvertDhlVolumes('agC1'));
    assert.equal(await soro.first().locator('.ag-mat-formula').inputValue(), '1×0,5');
    assert.equal(await page.evaluate(() => window.agendaMatBioValidateAll()), true);
    const serialized = await page.evaluate(() => window.agendaMatBioSerialize('agC1'));
    assert.equal(serialized.items.find(item => item.key === 'soro').total, 1);
    assert.equal(serialized.items.find(item => item.key === 'fezes').unit, 'g');
    await soro.last().locator('.ag-mat-formula').fill('-2x5');
    assert.equal(await page.evaluate(() => window.agendaMatBioValidateAll()), false);
    assert.equal(await soro.last().locator('.ag-mat-formula').getAttribute('aria-invalid'), 'true');
    await soro.last().locator('.ag-mat-formula').fill('2x0,5');
    assert.equal(await page.evaluate(() => window.agendaMatBioValidateAll()), true);
    await page.evaluate(() => { document.getElementById('agC1Nome').value = 'MARKEN'; window.onAgendaCourierChange('agC1'); });
    assert.equal(await page.evaluate(() => window.agendaMatBioValidateAll()), false, 'voltar para mL tambem exige revisao');
  });
});

test('Agenda: JSON corrompido nao pode ser silenciosamente salvo como material vazio', async () => {
  await scenario(async page => {
    await page.evaluate(() => window.agendaMatBioLoad('agC1', { matBioJson: '{', material: 'Resumo legado' }));
    assert.equal(await page.evaluate(() => window.agendaMatBioValidateAll()), false);
    await page.evaluate(() => window.agendaMatBioClear('agC1'));
    assert.equal(await page.evaluate(() => window.agendaMatBioValidateAll()), true, 'substituicao explicita libera revisao');
  });
});

test('DOM real: kits filtrados por identidade exata em desktop e celular', async () => {
  for (const width of [1280, 390]) {
    await scenario(async (page) => {
      assert.deepEqual(await page.locator('#agKit1 option').allTextContents(), ['-- kit de coleta --', 'Kit A']);
      await page.locator('#agKit1').selectOption('K1');
      assert.equal(await page.locator('#agKit1').inputValue(), 'K1');
      const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'agenda-' + width + '.png'), fullPage: true, animations: 'disabled' });
    }, { viewport: { width, height: 900 } });
  }
});

test('resumo remoto preserva projeto, kit e monitor historicos no formulario', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      // Componentes de resumo do shell, fora do contrato exercitado aqui.
      window.atualizarAgendaProjetoLock = window.agendaMatBioUpdateAllCopyOptions = window.agendaMostrarParticipanteInfo = () => {};
      window.onAgendaParticipanteChange({ preservarCampos: true });
      window.calls.find((call) => call.method === 'getInfoParticipante').success({ id: 'P', nome: 'Participante de teste', projeto: 'Estudo AB' });
    });
    assert.equal(await page.locator('#agProjeto').inputValue(), 'Estudo A');
    assert.equal(await page.locator('#agKit1').inputValue(), 'K1');
    assert.equal(await page.locator('#agMonitor1').inputValue(), 'M');
  });
});

test('confirmacao e retorno de reserva, baixa e devolucao nao alteram outra edicao', async () => {
  for (const mode of ['reservar', 'baixar', 'devolver']) {
    await scenario(async (page) => {
      await page.evaluate((mode) => {
        // Payload ja validado: este cenario verifica a confirmacao e o retorno.
        window.coletarAgendaEvento = () => ({ projeto: 'Estudo A', participante: 'Teste' });
        window._agendaKitsBaixados = mode === 'devolver';
      }, mode);
      const button = mode === 'reservar' ? '#btnReservarKitsAgenda' : '#btnBaixarKitsAgenda';
      await page.locator(button).click();
      if (mode === 'reservar') {
        const dir = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(), 'ips-agenda-playwright');
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, 'agenda-confirmacao-kits.png'), animations: 'disabled' });
      }
      await page.locator('#btnConfirmAgendaKits').click();
      assert.equal(await page.evaluate(() => window.calls[0].args[0].agendaId), 'A');
      await page.evaluate(() => {
        window._agendaEditId = 'B'; window._agendaEditOpenRequestId += 1;
        window.setAgendaKitsReservaState(false); window.setAgendaKitsBaixaState(false);
        document.getElementById('btnBaixarKitsAgenda').disabled = false;
        window.calls[0].success({});
        window.calls[0].failure(new Error('Resposta atrasada'));
      });
      assert.equal(await page.locator('#btnReservarKitsAgenda').isEnabled(), true);
      assert.equal(await page.evaluate(() => window._agendaKitsBaixados), false);
      assert.deepEqual(await page.evaluate(() => window.notifications), []);
      // A confirmacao aberta para B tambem deve perder validade ao trocar a edicao.
      await page.locator(button).click();
      await page.evaluate(() => { window._agendaEditId = 'C'; window._agendaEditOpenRequestId += 1; });
      await page.locator('#btnConfirmAgendaKits').click();
      assert.equal(await page.evaluate(() => window.calls.length), 1);
    });
  }
});

test('retorno de salvar A conserva formulario e alteracoes pendentes de B', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      // Isola o ciclo de resposta do salvamento; validacoes de dominio ficam na suite Node.
      window.updateAgendaSaveAvailability = window.validarAgendaCampo = window.validarAgendaAlertasDataPassada = window.validarAgendaRealizadoFuturo = window.validarAgendaCourierStatusData_ = window.validateAgendaAwbs = () => true;
      window.coletarAgendaEvento = () => ({ data: '2026-10-04', status: 'Agendado' });
      window.agendaDataAlteradaInfo_ = () => null;
      document.getElementById('agData').value = '2026-10-04';
      document.getElementById('agHora').value = '10:00';
      document.getElementById('agLabCentral').value = 'Não';
    });
    await page.locator('#btnSalvarAgenda').click();
    assert.equal(await page.evaluate(() => window.calls[0].args[0].id), 'A');
    await page.evaluate(() => {
      window._agendaEditId = 'B'; window._agendaEditOpenRequestId += 1; window.dirty = true;
      document.getElementById('agVisita').value = 'Visita B';
      window.calls[0].success({ id: 'A' });
      window.calls[0].failure(new Error('Atrasada'));
    });
    assert.equal(await page.locator('#agVisita').inputValue(), 'Visita B');
    assert.equal(await page.evaluate(() => window.dirty), true);
    assert.equal(await page.locator('#agendaCreatePanel').evaluate((element) => element.classList.contains('open')), true);
  });
});

test('apagar a busca descarta falha antiga durante debounce', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      // A busca fica fora do diálogo: fechar a edição antes de interagir com a lista.
      window.fecharOverlay('agendaCreatePanel');
      window.renderAgendaOperacional = () => { document.getElementById('agendaViewLista').textContent = 'Lista atual'; };
      document.getElementById('agendaBusca').value = 'Pessoa A';
      window.agendaCarregarHistorico('Pessoa A', null, 0);
    });
    await page.locator('#agendaBusca').fill('');
    await page.evaluate(() => window.calls[0].failure(new Error('Atrasada')));
    assert.equal(await page.locator('#agendaViewLista').textContent(), 'Lista atual');
  });
});

test('recibo real descarta resposta antiga e usa a data de Sao Paulo em outro fuso', async () => {
  await scenario(async (page) => {
    await page.evaluate(() => {
      window.abrirAgendaRecibo('A'); window.abrirAgendaRecibo('B');
      const data = { projeto: 'Estudo B', dataVisitaIso: '2026-10-04', beneficiarios: [{ nome: 'Pessoa B de teste', tipo: 'Participante', cpf: '52998224725', valorPadrao: 10 }] };
      window.calls[1].success(data);
      window.calls[0].failure(new Error('Atrasada'));
      window.calls[0].success({ ...data, projeto: 'Estudo A', beneficiarios: [{ nome: 'Pessoa A de teste', tipo: 'Participante' }] });
    });
    assert.equal(await page.locator('#agendaReciboTitular').inputValue(), 'Pessoa B de teste');
    assert.equal(await page.locator('#agendaReciboDataEmissao').inputValue(), '2026-10-04');
    assert.equal(await page.evaluate(() => window.agendaIso(window.agendaWeekStartForOffset_(0))), '2026-09-28');
  });
});
