# Orientacoes para agentes

## Contexto e limites

Este arquivo vale para todo o repositorio e para qualquer modelo usado pelo agente.

- O web app interno **IPS | UCS** usa Google Apps Script V8 e atende Agenda, cadastros, pendencias, Dashboard, Estoque e Transporte. O fuso de negocio e `America/Sao_Paulo`.
- O app executa como o usuario que o acessa, com acesso restrito ao dominio. Autorizacao e perfil sao regras de negocio.
- Sheets, Drive, Gmail, Calendar e HTTP podem produzir efeitos reais. Testes locais devem permanecer isolados desses servicos.
- Comece com `git status --short` e preserve alteracoes preexistentes. Localize a implementacao e os testes relevantes; prefira mudancas focadas, sem reformatar ou reorganizar trechos alheios.
- Conclua implementacao e validacoes locais autorizadas sem pedir confirmacao para decisoes rotineiras. Pedidos de revisao ou planejamento permanecem nesse escopo; publicacao exige solicitacao explicita.
- Testes existentes sao evidencia dos contratos de negocio. Se um teste preservar um defeito ou contrariar a regra solicitada, ajuste-o e explique o motivo. Esclareca mudancas de regra de negocio que nao estejam autorizadas; nao enfraqueca testes ou gates para obter aprovacao.

## Orquestracao multi-agent

O agente principal Codex coordena o trabalho e permanece responsavel pelo resultado final, pelo estado do repositorio e pelo diff integrado.

### Comportamento padrao

- Nao use subagentes automaticamente em toda tarefa. Mudancas simples, localizadas ou com causa e solucao claras devem ser executadas pelo agente principal: textos e rotulos, pequenos ajustes de CSS, correcoes evidentes em um arquivo e condicoes simples.
- Use subagentes somente quando investigacao paralela ou independente puder melhorar materialmente a qualidade, a confianca ou o tempo de conclusao. O beneficio esperado deve superar o custo de coordenacao e de tokens.

### Quando usar subagentes

Considere de 1 a 3 subagentes para:

- causas incertas, multiplas causas possiveis ou hipoteses investigaveis de forma independente;
- mudancas em varios componentes ou camadas de arquitetura;
- problemas de cache, desempenho, concorrencia, sincronizacao ou gerenciamento de estado;
- refatoracoes significativas, mudancas sensiveis a regressao ou areas pouco conhecidas do projeto;
- revisao independente de uma implementacao nao trivial.

Use o menor numero necessario:

- 1 subagente para segunda opiniao independente ou investigacao focada;
- 2 subagentes para duas areas ou hipoteses substancialmente diferentes e independentes;
- 3 subagentes somente para trabalho complexo com tres frentes independentes e uteis.

Nao crie agentes apenas para preencher essa estrutura.

### Estrategia de delegacao

- Antes de delegar, o agente principal deve entender o pedido e elaborar um plano concreto.
- Delegue tarefas delimitadas, com perguntas claras e resultados esperados. Exemplos: identificar a causa na implementacao atual; rastrear um fluxo especifico de dados ou estado; analisar invalidacao de cache e concorrencia; identificar riscos de regressao e casos de borda; revisar a implementacao; inspecionar testes relevantes e propor validacoes adicionais.
- Evite atribuir a varios subagentes a mesma tarefa ampla, salvo quando opinioes independentes forem deliberadamente uteis.
- Prefira delegar investigacao, analise e revisao antes de delegar implementacao.

### Eficiencia de contexto

- Forneca a cada subagente somente o contexto e o escopo do repositorio necessarios a sua tarefa, sempre que praticavel.
- Compartilhe o contexto relevante ja identificado pelo agente principal; nao faca cada subagente redescobrir toda a arquitetura.
- Evite duplicacao desnecessaria de exploracao, leitura de arquivos grandes, execucao de testes e analise. O objetivo e paralelismo util e verificacao independente, nao maximizar agentes ou tokens.

### Modificacoes concorrentes

- Nao permita que varios agentes modifiquem os mesmos arquivos simultaneamente.
- Delegue implementacao somente quando componentes ou arquivos puderem ser divididos de forma independente e segura. Caso contrario, os subagentes investigam ou revisam, e o agente principal realiza a modificacao final.
- O agente principal e responsavel pela integracao e pelo diff final completo.

### Consolidacao

Ao receber os resultados dos subagentes, o agente principal deve avalia-los criticamente:

1. Reconciliar conclusoes conflitantes.
2. Verificar afirmacoes importantes no repositorio quando necessario.
3. Escolher a menor implementacao segura.
4. Evitar combinar solucoes propostas sem necessidade.
5. Implementar ou integrar a solucao final.
6. Inspecionar o diff completo.
7. Executar as verificacoes aplicaveis, conforme `Validacao e conclusao local`.
8. Resolver regressoes ou inconsistencias antes de concluir.

Resultados de subagentes sao consultivos ate serem validados pelo agente principal.

### Revisao independente

Para mudancas nao triviais ou sensiveis a regressao, considere um subagente como revisor independente apos a implementacao. A revisao deve procurar:

- regressoes de comportamento e premissas incorretas;
- complexidade desnecessaria;
- problemas de concorrencia ou estado;
- riscos de seguranca e casos de borda ausentes;
- violacoes das convencoes do projeto;
- testes ou validacoes insuficientes.

O agente principal decide quais achados exigem ajustes, respeitando os contratos e gates existentes.

### Consideracoes do IPS Agenda

Na divisao e revisao do trabalho, dedique atencao a:

- limites e cotas de execucao do Google Apps Script;
- limites de tamanho e expiracao do `CacheService`;
- leituras e escritas desnecessarias em Sheets e servicos externos;
- comportamento de gatilhos, execucoes duplicadas e condicoes de corrida;
- sincronizacao de estado entre cliente e servidor;
- preservacao dos fluxos e comportamentos existentes;
- comportamento de publicacao e implantacao ativa do Apps Script.

Esses pontos complementam os `Contratos essenciais` abaixo. Prefira a menor mudanca que resolva o problema com seguranca; evite reescritas amplas quando uma correcao localizada for suficiente.

### Git e seguranca de publicacao

- A orquestracao nao pode contornar as regras existentes de Git, GitHub, testes ou publicacao. Preserve alteracoes locais alheias e arquivos nao rastreados.
- Nao permita que subagentes publiquem, implantem, facam merge ou push, nem criem commits concorrentes de forma independente, salvo exigencia explicita do fluxo estabelecido e dentro da autorizacao do usuario.
- O agente principal continua responsavel por seguir integralmente a secao `Publicacao` e `PUBLICACAO_SEGURA.md`, incluindo `npm run push` ou `npm run push:safe` quando a publicacao estiver solicitada e for apropriada.

### Principio de eficiencia

Uma tarefa simples deve permanecer simples. Decomponha uma tarefa complexa somente onde houver trabalho independente e util. Priorize corretude, manutencao, contexto focado e uso eficiente de recursos.

## Localizacao e documentacao

Consulte a documentacao conforme o assunto da tarefa, sem exigir a leitura de todo o projeto a cada edicao.

- Servidor e RPCs: `WebApp.gs`; regras de cadastros: `CadastroRules.gs`.
- Interface: `Index.html` compoe os includes; `IndexCoreScripts.html` concentra infraestrutura; `IndexAgendaScripts.html`, `IndexDashboard*.html` e `IndexEstoque*.html` atendem seus modulos.
- Transporte: `TransporteApp.html`, `TransporteCodexConfig.gs` e contratos `Shared*.html` usados pelo fluxo.
- Regras compartilhadas da Agenda: `docs/AGENDA_REGRAS_COMPARTILHADAS.md`, fonte `tools/agenda-rules-core.js` e gerador `tools/generate-agenda-rules.js`.
- Feriados e referencias operacionais: `docs/FERIADOS.md`.
- Testes e simuladores: `tests/`, `tests/helpers/` e `CodexExternalEffects.gs`. Interface local: `PLAYWRIGHT.md`; escopo do lint: `ESLINT.md`.
- Preparacao ou execucao de publicacao: leia `PUBLICACAO_SEGURA.md`; o pipeline e `tools/push-clasp.ps1`.

## Contratos essenciais

### Apps Script, acesso e templates

- O namespace e global: verifique colisoes nos arquivos `.gs` e, separadamente, nos scripts do cliente. Funcoes terminadas em `_` sao privadas; RPCs chamadas por `google.script.run` devem continuar publicas.
- Toda RPC que consulta dados protegidos ou produz mutacao deve autorizar a operacao no servidor. Esconder controles na interface nao substitui essa verificacao.
- Ao renomear uma funcao publica, atualize chamadas do cliente e contratos em `tests/frontend-contracts.test.js`.
- Preserve a ordem dos includes em `Index.html`, salvo mudanca deliberada de dependencia. Serialize dados injetados em scripts com `codexJsonForScript_` ou mecanismo seguro equivalente; nao concatene entrada do usuario em HTML ou script. Preserve sanitizacao e limites cobertos por `tests/xss-hardening.test.js`.

### Regras compartilhadas e dados legados

- Para regras nos blocos gerados de `AgendaServerRules.gs` e `SharedAgendaRules.html`, edite `tools/agenda-rules-core.js` e execute `npm run rules:generate`. Nao edite os blocos diretamente. Funcoes fora deles continuam exigindo revisao de equivalencia entre cliente e servidor e dos testes correspondentes.
- Preserve IDs estaveis nos vinculos entre Agenda, participantes, projetos e Transporte; nomes e rotulos historicos nao substituem identidade.
- Preserve campos opcionais, cabecalhos legados e vinculos historicos. Campo omitido nao significa apagar seu valor. Leituras nao devem alterar schema. Nao infira dados clinicos ou vinculos ausentes sem fonte explicita.
- Valide alteracoes em planilhas antes da primeira escrita para evitar estados parciais.

### Concorrencia e efeitos externos

- Respostas assincronas obsoletas nao devem substituir o estado atual da interface. Cubra os cenarios afetados de troca de registro, recarga ou respostas fora de ordem.
- Em mutacoes concorrentes, preserve os locks e revalide dentro da secao protegida as condicoes necessarias a escrita.
- Testes locais nao podem enviar e-mail, alterar calendarios nem acessar Sheets, Drive ou Gmail reais. Use adaptadores de `CodexExternalEffects.gs` e simuladores de `tests/helpers/`; evite chamadas diretas em fluxos que ja possuem adaptador simulavel.

### Desempenho

- Minimize chamadas Google e HTTP: leia os dados necessarios uma vez, processe em memoria e grave em blocos com `getValues()`/`setValues()` ou equivalente. Evite alternar leituras e escritas em lacos quando uma faixa, matriz ou `RangeList` puder expressar a operacao.
- Use `SpreadsheetApp.flush()` somente quando houver dependencia real de persistencia imediata, como antes de exportar PDF; documente-a. Nunca use em lacos ou como tentativa generica de corrigir consistencia ou desempenho.
- Use `CacheService` quando houver beneficio demonstravel, com chave versionada, TTL proporcional, invalidacao explicita, atualizacao forcada e fallback preservados. Cache nao e fonte de autorizacao, controle de acesso, saldo, reserva ou dado clinico mutavel.
- Nao adicione bibliotecas Apps Script sem necessidade comprovada. Para RPCs curtas e frequentes, prefira codigo local.
- Quando necessario para respeitar limites de execucao e compativel com o fluxo, use lotes idempotentes, cursor minimo em `PropertiesService` e continuacao por gatilho instalavel. Reexecucoes nao devem duplicar efeitos externos.
- Meca chamadas e duracao antes de atribuir gargalos. Telemetria nao deve conter dados pessoais ou clinicos. Simuladores comprovam estrategia e chamadas evitadas, nao ganhos de latencia em producao.
- Ao alterar integracoes, revise chamadas externas e cubra estrategias relevantes de lote, cache ou retomada com regressao. Justifique excecoes pequenas no codigo.

## Validacao e conclusao local

Comandos oficiais (no PowerShell, `npm.cmd` e equivalente a `npm`):

```powershell
npm run rules:generate  # atualiza os blocos compartilhados a partir da fonte
npm run rules:check     # verifica os blocos sem modificar arquivos
npm run syntax         # validacao sintatica e estrutural
npm run lint           # analise de corretude no escopo de ESLINT.md
npm test               # regressao Node
npm run verify         # rules:check, syntax, lint e regressao Node
npm run test:ui        # testes locais de interface; separado de verify
```

- Ao corrigir um defeito, adicione ou ajuste regressao que falharia antes da correcao sempre que viavel; justifique a ausencia quando necessario.
- Rode testes focados quando acelerarem o ciclo e finalize alteracoes de codigo com `npm run verify`. Os testes locais usam simuladores; execute-os e corrija falhas causadas pela tarefa sem pedir aprovacao a cada passo.
- Para alteracoes na Agenda, execute tambem `npm run test:ui`, conforme `PLAYWRIGHT.md`. Em outros modulos com mudancas visuais ou de interacao, valide os cenarios afetados no navegador. Fixtures locais nao comprovam a implantacao publicada.
- Diferencie falhas introduzidas pela mudanca de falhas preexistentes. Informe o comando que falhou e a causa conhecida; nao declare validacao aprovada com verificacoes pendentes.
- A conclusao local exige comportamento solicitado implementado, contratos aplicaveis revisados e validacoes acima aprovadas. O resumo final informa arquivos alterados, verificacoes executadas, limitacoes e pendencias. Para alteracoes exclusivamente documentais, confira diff, referencias e comandos; testes de codigo nao sao obrigatorios.

## Publicacao

- Publique somente quando solicitado, usando `npm run push` ou `npm run push:safe`. Nunca execute variantes de `clasp push` diretamente.
- Siga integralmente `PUBLICACAO_SEGURA.md`: `main` limpa, verificacoes, PR/checks/merge e sincronizacao. Nao contorne checks, protecao de branch, restauracao do arquivo versionado ou verificacoes do pipeline.
- A publicacao so termina apos o gate obrigatorio no `@Chrome` autenticado: codigo e versao remotos conferidos, implantacao ativa atualizada, badge `/exec` correto, smoke test somente leitura e console verificado, conforme o procedimento detalhado naquele documento.
- Recarregue o editor remoto e confira em `WebApp.gs` os valores exatos de `CODEX_APP_VERSION_`, `CODEX_APP_BUILD_LABEL_` e `CODEX_APP_BUILD_DATE_` informados pelo publicador. Se a entrega alterou esse arquivo, confira tambem ao menos um trecho funcional exclusivo da mudanca; somente o cabecalho nao comprova a atualizacao.
- O `WebApp.gs` local e restaurado pelo publicador e nao comprova a versao enviada. Se qualquer gate estiver indisponivel, divergente ou nao comprovado, informe **publicacao pendente** e identifique o passo restante.
