# Publicacao segura da Agenda IPS

## Comando oficial

Use somente:

```powershell
npm run push
```

O publicador exige a branch `main` sem alteracoes locais e uma sessao autenticada no GitHub CLI. Primeiro executa `npm run verify`, envia o commit atual para uma branch `agent/publish-*`, abre um Pull Request, aguarda o check obrigatorio **Testes de regressao** e faz o merge. Depois sincroniza a `main` local por fast-forward, gera temporariamente a versao da entrega e repete `npm run verify`. O `clasp push --force` so comeca depois que o GitHub aceitou o PR e todas as verificacoes terminaram com codigo de saida zero.

A versao segue o formato `AAAA.MM.DD.HHmm-commit`, usa o titulo do commit aprovado como rotulo e registra a data/hora de Sao Paulo. Depois do push, `WebApp.gs` e restaurado byte a byte para o conteudo aprovado no Git, inclusive quando ocorre falha.

`npm run push:safe` permanece como alias equivalente.

Nao use `clasp push` diretamente, pois esse comando ignora a barreira local.

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

Assim, codigo com teste quebrado nao entra em `main`. A publicacao no Apps Script e o envio dos commits aprovados ao GitHub devem usar `npm run push`.
