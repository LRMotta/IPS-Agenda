# Orientacoes para agentes

## Escopo

Este arquivo vale para todo o repositorio. Antes de alterar codigo, consulte tambem a documentacao especifica relacionada a tarefa, especialmente `PUBLICACAO_SEGURA.md` quando houver qualquer assunto de entrega ou publicacao.

## Contexto do projeto

- Este repositorio contem o web app interno **IPS | UCS**, implementado em Google Apps Script com runtime V8.
- A aplicacao atende principalmente Agenda, cadastros de projetos e participantes, pendencias, Dashboard, Estoque e Transporte.
- O fuso de negocio e `America/Sao_Paulo`.
- O web app executa como o usuario que o acessa e tem acesso restrito ao dominio. Autorizacao e perfil de acesso fazem parte das regras de negocio, nao sao apenas detalhes de interface.
- O codigo interage com dados e servicos reais do Google, incluindo Sheets, Drive, Gmail e Calendar. Preserve a seguranca desses efeitos externos.

## Mapa rapido

- `WebApp.gs`: entrada `doGet`, composicao da aplicacao, RPCs e grande parte da logica de servidor.
- `Index.html`: shell da pagina e ordem dos `include(...)`.
- `IndexContent*.html` e `IndexStyles*.html`: estrutura e estilos da interface principal.
- `IndexCoreScripts.html`: infraestrutura compartilhada do cliente.
- `IndexAgendaScripts.html`: comportamento da Agenda no cliente.
- `AgendaServerRules.gs` e `SharedAgendaRules.html`: regras puras equivalentes no servidor e no navegador.
- `CadastroRules.gs`: regras puras de projetos e participantes.
- `IndexDashboard*.html`: conteudo, estilos e scripts do Dashboard.
- `IndexEstoque*.html`: modulo de Estoque.
- `TransporteApp.html` e `TransporteCodexConfig.gs`: interface, integracao e automacoes de Transporte.
- `SharedAccessRules.html`, `SharedCourierRules.html` e `SharedMatBio*.html`: contratos compartilhados entre modulos.
- `CodexExternalEffects.gs`: adaptadores de efeitos externos que permitem testes seguros.
- `tests/`: regressao executada com o test runner nativo do Node.
- `tools/validate-syntax.js`: valida JavaScript, templates Apps Script, includes e arquivos de configuracao.
- `tools/push-clasp.ps1`: unico pipeline autorizado de publicacao.

## Forma de trabalhar

1. Comece com `git status --short` e preserve alteracoes do usuario que nao pertencem a tarefa.
2. Localize a implementacao e os testes do comportamento antes de editar. Trate testes existentes como contratos de negocio.
3. Prefira mudancas pequenas e focadas. Estes arquivos sao grandes; nao reformate nem reorganize trechos alheios.
4. Ao corrigir um defeito, adicione ou ajuste um teste de regressao que falharia antes da correcao sempre que isso for viavel.
5. Execute `npm run verify` antes de concluir uma alteracao de codigo. Se houver falha, informe exatamente o comando e a causa.
6. Nunca publique apenas porque a implementacao terminou. Publicacao exige pedido explicito do usuario.

## Contratos que nao podem ser quebrados

### Apps Script e RPCs

- O projeto usa namespace global. Verifique colisoes de nomes entre todos os arquivos `.gs` e blocos `<script>`.
- Funcoes terminadas em `_` sao privadas por convencao. Funcoes chamadas pela interface via `google.script.run` precisam continuar publicas.
- Toda RPC que consulta dados protegidos ou produz mutacao deve aplicar a autorizacao adequada no servidor. Esconder um controle na interface nao substitui essa verificacao.
- Ao renomear uma funcao publica, atualize todas as chamadas do cliente e os contratos cobertos por `tests/frontend-contracts.test.js`.

### Regras compartilhadas

- Mantenha `AgendaServerRules.gs` semanticamente alinhado a `SharedAgendaRules.html`. Se uma classificacao, normalizacao ou permissao mudar em um lado, revise o outro e os testes correspondentes.
- Preserve IDs estaveis como identidade de registros. Nomes, rotulos e grafias historicas nao devem substituir IDs em vinculos entre Agenda, participantes, projetos e Transporte.
- Nao remova validacoes ou comportamentos de dominio ja cobertos pelos testes sem confirmar explicitamente a mudanca de regra com o usuario.

### Templates e seguranca do cliente

- Preserve a ordem dos `include(...)` em `Index.html`, salvo quando a dependencia entre modulos exigir uma mudanca deliberada.
- Dados injetados em JavaScript pelo template devem usar serializacao segura, como `codexJsonForScript_`; nao concatene entrada do usuario em HTML ou script.
- Preserve a sanitizacao de HTML de courier e os demais limites cobertos por `tests/xss-hardening.test.js`.

### Efeitos externos e testes

- Testes locais nao podem enviar e-mail, alterar calendarios nem acessar planilhas, Drive ou Gmail reais.
- Use os adaptadores de `CodexExternalEffects.gs` e os simuladores de `tests/helpers/` para isolar efeitos externos.
- Evite introduzir chamadas diretas a `MailApp`, Calendar ou servicos equivalentes em fluxos que ja possuem adaptador simulavel.
- Alteracoes em planilhas devem ser validadas antes da primeira escrita para evitar estados parciais.

## Validacao

Comandos locais oficiais:

```powershell
npm run syntax  # validacao sintatica e estrutural
npm test        # suite de regressao
npm run verify  # validacao completa; preferido antes da entrega
```

Ao mexer em um modulo, rode primeiro o teste focado quando isso acelerar o ciclo e finalize com `npm run verify`. Areas sensiveis ja possuem suites dedicadas, incluindo autorizacao, contratos frontend-servidor, Agenda, cadastros, Transporte, Dashboard, XSS, efeitos externos e pipeline de publicacao.

## Publicacao

- O unico comando autorizado e `npm run push` (ou o alias equivalente `npm run push:safe`).
- Nunca execute `clasp push`, `clasp push --force` ou uma variante diretamente.
- O pipeline exige `main` limpa, executa a verificacao, passa por branch/PR/checks/merge no GitHub, sincroniza a `main` e so entao envia o codigo ao Apps Script.
- Nao contorne checks, protecao de branch, restauracao do arquivo versionado ou verificacoes do pipeline.
- Leia `PUBLICACAO_SEGURA.md` antes de qualquer publicacao.
- Depois de `npm run push`, use obrigatoriamente o `@Chrome` com a sessao autenticada para concluir a publicacao: recarregue o editor do Google Apps Script, abra o `WebApp.gs` remoto e confirme que `CODEX_APP_VERSION_`, `CODEX_APP_BUILD_LABEL_` e `CODEX_APP_BUILD_DATE_` correspondem exatamente a entrega enviada. Quando a entrega alterar esse arquivo, confira tambem ao menos um trecho funcional exclusivo da mudanca, nao apenas o cabecalho de versao.
- No mesmo gate do `@Chrome`, edite a implantacao ativa do Web App, selecione **Nova versao** e implante. Em seguida, recarregue a URL `/exec`, confirme que o badge exibe a nova versao e que a versao anterior nao aparece, e execute um smoke test somente leitura do fluxo relevante, verificando tambem o console do navegador.
- O `WebApp.gs` local nao prova o que foi enviado: o publicador restaura esse arquivo depois do push. Se o `@Chrome` estiver indisponivel, o conteudo remoto divergir ou a implantacao ativa nao puder ser confirmada, informe **publicacao pendente** e nunca **publicacao concluida**.

## Criterio de conclusao

Uma alteracao esta pronta quando:

- o comportamento solicitado foi implementado sem modificar trabalho alheio;
- autorizacao, seguranca e efeitos externos foram revisados quando aplicaveis;
- regras equivalentes de cliente e servidor permanecem alinhadas;
- o teste de regressao relevante existe ou a ausencia dele foi justificada;
- `npm run verify` passa;
- o resumo final informa arquivos alterados, validacao executada e qualquer risco ou passo manual restante.
