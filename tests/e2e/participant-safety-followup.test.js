'use strict';
/* global window, renderParticipacoesPessoa_, abrirNovaParticipacaoPessoa, _participantes, _participanteEdicaoAtual */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadPlaywright } = require('../helpers/playwright-runtime');
const { readProjectFile } = require('../helpers/load-app-script');

test('acompanhamento libera nova participação com aviso e bloqueia ativa e óbito no desktop e celular', async () => {
  const browser = await loadPlaywright().chromium.launch({ headless:true });
  try {
    for (const width of [1280,390]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (['error','warning'].includes(m.type())) errors.push(m.text()); });
      await page.route('**/*', r => r.abort());
      const content = readProjectFile('IndexContentAfterStock.html');
      const section = content.slice(content.indexOf('<div class="form-section participant-participations-section"'), content.indexOf('<div class="form-section participant-milestones-section"'));
      await page.setContent('<html><head><title>IPS — acompanhamento local</title>'+readProjectFile('IndexStyles.html')+readProjectFile('IndexStylesAfterDashboard.html')+'</head><body><main style="padding:16px"><input type="hidden" id="editPartId" value="1">'+section+'</main></body></html>');
      const source = readProjectFile('IndexCoreScripts.html');
      const functions = ['participanteMesmoCadastroPessoa_','participantePodeNovaParticipacao_','participacoesDaPessoa_','renderParticipacoesPessoa_','abrirNovaParticipacaoPessoa'].map(name => {
        const match = source.match(new RegExp('function '+name+'\\([^]*?\\n\\}')); assert.ok(match,name); return match[0];
      }).join('\n');
      await page.addScriptTag({content:`
        window.created=null;window.messages=[];
        var _participanteEdicaoAtual={id:'1',idPessoa:'P1',nome:'Pessoa teste',projeto:'DUET',idParticipante:'D-1',status:'Em acompanhamento de segurança'};
        var _participantes=[_participanteEdicaoAtual];
        function normSelectValue(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().trim();}
        function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
        function chipStatus(s){return '<span>'+esc(s)+'</span>';}
        function snackErro(s){window.messages.push(s);}
        function appConfirmNavigationIfDirty(){return true;}
        function prepararNovaParticipacaoPessoa_(p){window.created=p;renderParticipacoesPessoa_(p,true);}
        ${functions}
        renderParticipacoesPessoa_(_participanteEdicaoAtual,false);
      `});
      assert.equal(page.url(),'about:blank');
      assert.equal(await page.title(),'IPS — acompanhamento local');
      assert.equal(await page.locator('nextjs-portal,vite-error-overlay').count(),0);
      assert.equal(await page.getByRole('button',{name:'Nova participação'}).isEnabled(),true);
      assert.match(await page.locator('#ptParticipacoesHint').textContent(),/acompanhamento de segurança em: DUET/);
      await page.getByRole('button',{name:'Nova participação'}).click();
      assert.equal(await page.evaluate(() => window.created.idPessoa),'P1');
      assert.match(await page.locator('#ptParticipacoesHint').textContent(),/equipe responsável/);
      assert.equal(await page.locator('#ptParticipacoesSection').evaluate(el=>el.scrollWidth>el.clientWidth),false);
      const artifacts = process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(os.tmpdir(),'ips-agenda-playwright');
      fs.mkdirSync(artifacts,{recursive:true});
      await page.screenshot({path:path.join(artifacts,'participant-safety-followup-'+width+'.png')});
      for (const status of ['Ativo','Óbito']) {
        await page.evaluate(status => {
          window.created=null;
          _participantes.push({id:'2',idPessoa:'P1',nome:'Pessoa teste',projeto:'SPY',status});
          renderParticipacoesPessoa_(_participanteEdicaoAtual,false);
          abrirNovaParticipacaoPessoa();
        },status);
        assert.equal(await page.getByRole('button',{name:'Nova participação'}).isDisabled(),true);
        assert.equal(await page.evaluate(()=>window.created),null);
        assert.match(await page.evaluate(()=>window.messages.at(-1)),status==='Óbito'?/óbito/:/Encerre/);
        await page.evaluate(()=>_participantes.pop());
      }
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close(); }
});
