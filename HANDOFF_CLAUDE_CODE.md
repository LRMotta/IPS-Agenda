# Handoff para Claude Code — IPS Agenda / IPS | UCS

Preparado em 28/10/2026, fuso America/Sao_Paulo.

## 1. Objetivo e primeira leitura

Este documento transfere o contexto técnico do projeto. Não autoriza uma nova funcionalidade, migração de dados ou publicação. A próxima tarefa deve seguir o pedido do usuário.

Repositório local: `C:\Users\lrmotta\Documents\IPS Agenda`.

**Leia `AGENTS.md` na raiz antes de trabalhar. Suas instruções valem também para Claude Code.** Este handoff é um guia de navegação, não substitui os contratos do repositório. Para publicar, leia integralmente `PUBLICACAO_SEGURA.md`.

Comece com:

```powershell
Set-Location 'C:\Users\lrmotta\Documents\IPS Agenda'
git status --short
git status -sb
git log -5 --oneline
```

Preserve alterações e arquivos não rastreados que já existam. Faça mudanças focadas. Use subagentes apenas quando houver benefício material de investigação ou revisão independente, conforme `AGENTS.md`.

## 2. Estado confirmado nesta passagem

- Antes da criação deste documento, `git status --short` estava vazio.
- Branch: `main`, sem divergência indicada em relação à referência local `origin/main`. Não houve fetch nem consulta ao GitHub nesta tarefa; isso não comprova sincronização com o servidor neste instante.
- HEAD: `71471b4` — `Merge pull request #306 from LRMotta/agent/publish-d5bd6f7b`.
- Commit funcional recente: `d5bd6f7` — `Farmácia: documentos de impressão, marca e ajustes de transporte`.
- Outros marcos recentes: `fb9eb4a` (consolidação do ciclo, estoque e transporte) e `fdc6d2d` (produtos da Farmácia e agregados de Transporte).
- Nenhum código de aplicação foi alterado nesta passagem. O handoff foi criado sem commit ou publicação.
- A suite de testes não foi executada para esta alteração exclusivamente documental. Não há declaração de baseline atual aprovado.
- Não foram consultados Apps Script remoto, implantação ativa, planilhas ou outros serviços reais. A versão publicada precisa ser conferida quando relevante à próxima tarefa.

**Atenção à versão local:** `WebApp.gs` contém `CODEX_APP_VERSION_ = '2026.10.08-transporte-config-confirm-local'`, com data `2026-10-08`. Isso não comprova versão antiga em produção: o publicador injeta os metadados temporariamente e restaura o arquivo local byte a byte. Não atualize esses valores manualmente apenas para fazê-los parecer atuais.

## 3. Produto e execução

Web app interno de pesquisa clínica, com Agenda, cadastros, pendências, Dashboard, Estoque, Farmácia e Transporte. Backend Google Apps Script V8; interface HTML/CSS/JavaScript composta por includes.

O `appsscript.json` confirma:

- Fuso de negócio `America/Sao_Paulo`.
- Execução como `USER_ACCESSING` e acesso `DOMAIN`.
- Serviços avançados Gmail v1 e Drive v3.
- Integrações com Sheets, Drive, Gmail, Calendar e HTTP, capazes de produzir efeitos reais.

Não transforme uma investigação local em execução de operações reais. Testes devem usar simuladores e adaptadores.

## 4. Mapa de implementação e documentação

| Área | Onde começar |
| --- | --- |
| Servidor, RPCs e integração principal | `WebApp.gs` |
| Regras de cadastros | `CadastroRules.gs` |
| Composição da interface e infraestrutura | `Index.html`, `IndexCoreScripts.html` |
| Agenda | `IndexAgendaScripts.html`, `AgendaServerRules.gs`, `SharedAgendaRules.html` |
| Dashboard | `IndexDashboard*.html` |
| Estoque | `IndexEstoque*.html` |
| Farmácia: estoque e catálogo | `FarmaciaEstoque.gs`, `FarmaciaCatalogActions.gs`, `IndexFarmaciaScripts.html`, `IndexFarmaciaActions.html`, `IndexFarmaciaViewScripts.html` |
| Farmácia: ciclo e documentos | `FarmaciaCiclo.gs`, `IndexFarmaciaCiclo.html`, `IndexFarmaciaDocumentos.html` |
| Farmácia: locais | `FarmaciaLocais.gs`, `FarmaciaLocationActions.gs`, `IndexFarmaciaLocationActions.html` |
| Transporte | `TransporteApp.html`, `TransporteCodexConfig.gs`, contratos `Shared*.html` pertinentes |
| Planejamento/SoA | `SoAPlanning.gs`, `SharedSoAPlanningImport.html`, `docs/IMPORTACAO_PLANEJAMENTO_IA.md`, `docs/INSTRUCOES_EXTRACAO_IA.txt` |
| Efeitos externos e simuladores | `CodexExternalEffects.gs`, `tests/helpers/` |
| Publicador | `tools/push-clasp.ps1`, `PUBLICACAO_SEGURA.md` |

Documentos úteis por assunto:

- Agenda: `docs/AGENDA_REGRAS_COMPARTILHADAS.md`, `docs/FERIADOS.md`, `docs/MARCOS_PARTICIPACAO.md`, `docs/BACKUP_II.md`.
- Farmácia: `docs/FARMACIA_ESTOQUE.md`, `docs/FARMACIA_ACESSO.md`, `docs/FARMACIA_CICLO.md`.
- Transporte: `docs/TRANSPORTE_OPERACOES_CICLO.md`, `docs/TRANSPORTE_IDEMPOTENCIA_LOCAL.md`, `docs/AWB_UNICIDADE.md`, `docs/COURIER_REGRAS_COMPARTILHADAS.md`.
- Desempenho: `docs/DESEMPENHO_LOTES_DHL_PDF_2026-10-13.md` e os documentos específicos de Dashboard em `docs/`.
- Validação: `PLAYWRIGHT.md`, `ESLINT.md`, `package.json`.

Arquivos datados, pareceres antigos e patches em `docs/` são contexto histórico. Não aplique patches nem trate propostas ou pendências antigas como estado atual sem comparar com código e testes. Há documentação inicial da Farmácia anterior ao ciclo atual; descrições de escopo podem refletir etapas distintas.

## 5. Contratos que não podem se perder

1. **Autorização no servidor:** toda RPC de dados protegidos ou mutação deve verificar permissão. Ocultar um botão não protege o dado. Admin geral não implica acesso farmacêutico a estudos ou informações restritas.
2. **Namespace global:** confira colisões nos `.gs` e, separadamente, no cliente. Funções com sufixo `_` são privadas; chamadas por `google.script.run` precisam permanecer públicas. Renomeações exigem atualizar cliente e `tests/frontend-contracts.test.js`.
3. **Templates e XSS:** preserve ordem de includes e serialização segura com `codexJsonForScript_` ou equivalente. Consulte `tests/xss-hardening.test.js`.
4. **Regras geradas:** altere a fonte `tools/agenda-rules-core.js`, não os blocos gerados de `AgendaServerRules.gs` e `SharedAgendaRules.html`. O comando de geração também processa regras de courier; consulte a documentação correspondente ao alterá-las.
5. **Dados legados e clínicos:** mantenha IDs estáveis, vínculos históricos e campos opcionais. Campo omitido não significa exclusão. Não infira datas, ciclos, eventos, vínculos ou identificação por semelhança de nomes. Ambiguidades continuam pendentes até fonte explícita.
6. **Concorrência:** respostas antigas não podem sobrescrever o registro atual. Preserve locks e revalide permissão, revisão e condições de escrita dentro da seção protegida. Valide antes da primeira gravação.
7. **Efeitos externos:** use os adaptadores simuláveis existentes. Testes não enviam e-mail nem acessam dados reais. Reexecuções não podem duplicar efeitos.
8. **Desempenho:** leia e escreva em lote, evite chamadas Google em laços e não use `flush()` como correção genérica. Cache exige invalidação e fallback; não pode decidir autorização, saldo ou dado clínico mutável.

### Cuidados específicos da Farmácia

O ciclo documentado aplica-se a medicamentos explicitamente classificados como fornecidos pelo patrocinador, em estudo autorizado. Não amplie seu escopo por inferência.

- As novas operações do ciclo exigem `manage`, conforme `docs/FARMACIA_CICLO.md`; não deduza capacidade de escrita apenas dos nomes dos níveis de acesso.
- Preserve produto + lote + kit, unidades e posições; contagens entre situações não são necessariamente somáveis.
- Retorno cria posição segregada bloqueada e não aumenta disponível na origem.
- Transporte de armazenamento reserva disponível na saída; chegada transfere físico e cria posição no destino. Preparo/administração vinculados a dispensação não podem baixar estoque duas vezes.
- Excursão exige avaliação documentada; não invente liberação clínica ou comunicação externa.
- Preserve ledger, revisões e idempotência por `requestId`. Não remova inventário com histórico operacional para contornar validação.
- Documento de impressão/referência não equivale a upload, assinatura eletrônica ou substituição dos documentos controlados.

### Pontos que exigem verificação antes de retomar

- Não há backlog novo autorizado por este handoff; aguarde o pedido funcional do usuário.
- Migração, correção de cadastro e exclusão de registros reais exigem escopo explícito. Uma autorização pontual anterior não se estende a outros registros.
- A documentação do piloto PDF descreve opt-in por `REQ_EXAMES_PDF_RETRY_ONLY_PILOT_V1=true`. A propriedade real não foi consultada nesta passagem. Não ative o piloto nem reduza esperas ou validações por suposição.
- Exemplos de importação SoA não comprovam aprovação clínica ou aptidão para agendamento. Confira fontes e pendências do protocolo antes de importar ou gerar visitas.

## 6. Validação local

Comandos confirmados no `package.json` (PowerShell):

```powershell
npm.cmd run rules:generate  # somente quando alterar fontes de regras geradas
npm.cmd run rules:check
npm.cmd run syntax
npm.cmd run lint
npm.cmd test
npm.cmd run verify
npm.cmd run test:ui
```

`verify` reúne regras, sintaxe, lint e regressão Node. O lint tem escopo definido em `ESLINT.md`; não assuma que cobre todo o frontend.

Para defeitos, adicione regressão que falharia antes da correção sempre que viável. Rode testes focados durante o trabalho e termine mudanças de código com `npm.cmd run verify`. Alterações na Agenda também exigem `npm.cmd run test:ui`; para outros módulos com mudanças visuais/interativas, valide os cenários afetados no navegador.

`PLAYWRIGHT.md` descreve o runner local: procura Playwright no repositório, em `C:\Users\lrmotta\Documents\IPS-Testes-Playwright\node_modules\playwright` ou via `PLAYWRIGHT_MODULE_PATH`. As RPCs são simuladas e a rede bloqueada. Capturas usam a pasta temporária `ips-agenda-playwright` ou `PLAYWRIGHT_ARTIFACTS_DIR`.

Não declare testes aprovados sem executá-los. Diferencie falhas preexistentes e introduzidas. Fixtures locais não comprovam implantação publicada.

## 7. Publicação — somente sob pedido explícito

Siga **todo** o procedimento em `PUBLICACAO_SEGURA.md`; esta lista serve apenas de orientação:

1. Prepare a entrega e os commits conforme o fluxo protegido. O publicador exige `main` limpa e GitHub CLI autenticado.
2. Use exclusivamente `npm.cmd run push` ou `npm.cmd run push:safe`. Nunca execute `clasp push` diretamente.
3. Preserve gates de testes, PR, check obrigatório **Testes de regressao**, merge sujeito às proteções e sincronização da `main`. Não faça bypass nem use merge administrativo para destravar.
4. Registre os três metadados exatos emitidos pelo publicador: versão, rótulo e data. O `WebApp.gs` local será restaurado.
5. No **Chrome autenticado**, recarregue o editor remoto e confira os valores em `WebApp.gs`. Se esse arquivo mudou funcionalmente, confira também um trecho exclusivo da entrega.
6. Atualize a implantação ativa em **Implantar > Gerenciar implantações > Nova versão**.
7. Recarregue `/exec`, confira o badge exato, faça smoke test somente leitura e verifique o console.

Se qualquer gate estiver indisponível, divergente ou não comprovado, informe **publicação pendente** e o passo restante. Enviar código ao Apps Script não encerra a publicação. Se Claude Code não dispuser do Chrome autenticado, registre a limitação para conclusão desse gate.

## 8. Como concluir a próxima tarefa

Informe o comportamento entregue, arquivos alterados, verificações efetivamente executadas e limitações ou pendências. Confira o diff integrado e o estado final do Git. Não publique por iniciativa própria e não exponha credenciais ou dados pessoais/clínicos em logs e documentação.
