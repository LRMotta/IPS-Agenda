# Publicacao segura da Agenda IPS

## Comando oficial

Use somente:

```powershell
npm run push
```

O publicador exige a branch `main` sem alteracoes locais e uma sessao autenticada no GitHub CLI. Primeiro executa `npm run verify`, envia o commit atual para uma branch `agent/publish-*`, abre um Pull Request e aguarda o check obrigatorio **Testes de regressao**. Em seguida, solicita o merge normal sujeito as regras protegidas da branch. Se o GitHub informar especificamente que a politica da branch base ainda bloqueia o merge, o pipeline tenta novamente por ate dez minutos; outros erros interrompem a publicacao. Nao ha bypass de regras nem merge automatico. Depois, aguarda a confirmacao de integracao, sincroniza a `main` local por fast-forward e confirma que ela contem o commit aprovado antes de gerar temporariamente a versao da entrega e repetir `npm run verify`. O `clasp push --force` so comeca depois que o GitHub integrou o PR e todas as verificacoes terminaram com codigo de saida zero.

A versao segue o formato `AAAA.MM.DD.HHmm-commit`, usa o titulo do commit aprovado como rotulo e registra a data/hora de Sao Paulo. Depois do push, `WebApp.gs` e restaurado byte a byte para o conteudo aprovado no Git, inclusive quando ocorre falha. Por isso, o arquivo local nao pode ser usado como comprovacao da versao enviada.

`npm run push:safe` permanece como alias equivalente.

Nao use `clasp push` diretamente, pois esse comando ignora a barreira local.

## Gate final obrigatorio no Chrome

`npm run push` envia o codigo, mas nao comprova que a implantacao ativa do Web App foi atualizada. A entrega permanece com o estado **publicacao pendente** ate que as verificacoes abaixo sejam realizadas no Chrome autenticado na conta Google que acessa o Apps Script. No Claude Code (CLI ou app desktop), use a extensao Claude in Chrome (ferramentas `mcp__claude-in-chrome__*`); no Codex, o plugin `@Chrome`:

1. Recarregue o editor do Google Apps Script para descartar qualquer conteudo antigo exibido pela interface.
2. Abra o arquivo remoto `WebApp.gs` e confirme os valores exatos de `CODEX_APP_VERSION_`, `CODEX_APP_BUILD_LABEL_` e `CODEX_APP_BUILD_DATE_` informados pelo publicador. Se a entrega alterou o `WebApp.gs`, confira tambem ao menos um trecho funcional exclusivo da mudanca; validar somente o cabecalho nao e suficiente nesse caso.
3. Abra **Implantar > Gerenciar implantacoes**, edite a implantacao ativa do Web App, selecione **Nova versao** e conclua a implantacao.
4. Recarregue a URL publicada terminada em `/exec` e confirme que o badge mostra exatamente a nova versao e que a versao anterior nao aparece.
5. Execute um smoke test somente leitura do fluxo alterado e verifique se o console do navegador nao apresenta novos erros relacionados.

Se qualquer passo nao puder ser comprovado, se o conteudo remoto divergir ou se o Chrome autenticado estiver indisponivel, nao informe que a publicacao foi concluida. Registre a entrega como **publicacao pendente**, com o passo e a divergencia encontrados. Ao concluir, informe a versao do codigo, o numero da versao criada na implantacao ativa e o badge conferido.

### Orientacoes praticas para o gate (Claude Code)

Estas orientacoes tornam o gate repetivel; nenhuma delas dispensa um passo acima.

- **URL `/exec`:** o publicador nao a informa. Obtenha-a em **Implantar > Gerenciar implantacoes** (link de **App da Web** da implantacao ativa, lendo o `href` completo com `find`/`read_page`; o texto visivel vem truncado). A URL e a mesma entre versoes. Nao use a URL `/dev`.
- **Conteudo remoto sem editar:** no editor, `monaco.editor.getModels()` expoe os arquivos como `file_N`. Localize o `WebApp.gs` pelo texto `CODEX_APP_VERSION_` (e o maior arquivo `.js`) e confira por `javascript_tool` os tres valores do cabecalho e o trecho funcional exclusivo. Nunca digite nem salve nada no editor.
- **Cliques:** a janela muda de tamanho entre sessoes; tire um screenshot antes de clicar por coordenada. O primeiro clique em um item de menu pode nao registrar; confirme que o dialogo abriu antes de prosseguir.
- **Implantacao:** a etapa **Atualizando a implantacao...** leva cerca de 30 a 40 segundos. Aguarde **Implantacao atualizada** e registre o numero da versao antes de fechar o dialogo. Se a conexao com o navegador cair, confira o estado da tela antes de repetir; nunca reimplante sem verificar.
- **`/exec`:** o primeiro carregamento pode levar cerca de 30 segundos e exibir o badge anterior com o aviso **Nova versao disponivel**. Recarregue a URL e exija o badge exato; a versao anterior nao pode permanecer.
- **Console:** o monitoramento comeca na primeira leitura; leia somente erros depois do carregamento completo, na mesma aba, sem navegar para outro dominio entre as chamadas.
- **Smoke test somente leitura:** abra a Agenda e confira que os dados do dia carregam. Nao use acoes que gravam, enviam e-mail ou geram documentos; isso nao e um smoke test.
- **Abas:** feche as abas abertas para o gate ao terminar.

## Verificacao sem publicar

```powershell
npm run verify
```

Esse comando nao acessa planilhas, Gmail, Drive ou calendarios reais.

Antes dos testes, ele verifica todos os arquivos `.gs`, blocos `<script>` e manipuladores JavaScript inline dos arquivos `.html`. Tambem valida `appsscript.json`, `.clasp.json`, referencias `include(...)` e marcadores de conflito Git. Qualquer erro interrompe a publicacao.

## GitHub Actions

O workflow `.github/workflows/regression-tests.yml` executa a mesma validacao sintatica e suite de testes:

- a cada push para `main`;
- em todo pull request destinado a `main`;
- manualmente pela aba Actions do GitHub.

O workflow possui apenas permissao de leitura do repositorio. Ele nao recebe credenciais do Apps Script e nao executa `clasp push`.

## Protecao da branch main

Depois que o workflow estiver no GitHub e tiver executado ao menos uma vez:

1. Abra **Settings > Branches** ou **Settings > Rules > Rulesets**.
2. Crie uma regra para a branch `main`.
3. Ative a exigencia de status checks antes do merge.
4. Selecione o check **Testes de regressao**.
5. Opcionalmente exija pull request antes de mergear.

Assim, codigo com teste quebrado nao entra em `main`. O envio dos commits aprovados ao GitHub e do codigo ao Apps Script deve usar `npm run push`; a publicacao so termina depois do gate final obrigatorio no Chrome.
