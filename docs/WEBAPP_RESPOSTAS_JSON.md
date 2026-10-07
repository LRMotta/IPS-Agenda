# Respostas JSON do WebApp

`doPost` usa `codexJsonResponse_(body, statusCode)` em `WebApp.gs`.
O parâmetro `statusCode` é acrescentado ao corpo JSON; **não define o status HTTP**.
`ContentService` retorna um `TextOutput`, cuja API não oferece método para configurar
o código HTTP. Uma resposta JSON entregue normalmente termina em HTTP 200,
mesmo quando a operação foi negada ou falhou.

Exemplo de erro de aplicação entregue com HTTP 200:

```json
{"ok":false,"error":"Acesso negado.","statusCode":403}
```

O contrato atual de `doPost` usa `ok: true` e `data` no sucesso, e `ok: false`
e `error` na falha. `statusCode` é opcional e descreve o resultado da aplicação:
400 para corpo inválido, 403 para acesso negado, 404 para ação não suportada e
500 para erro capturado durante a operação. Sucessos não precisam conter esse campo.

Clientes devem seguir os redirecionamentos do ContentService para
`script.googleusercontent.com`, verificar falhas HTTP/transporte, analisar o JSON
e exigir `ok === true` antes de considerar a operação concluída. HTTP 200 sozinho
não indica sucesso. Respostas sem JSON válido também devem ser tratadas como falha.
Erros da infraestrutura Google, autenticação da implantação, limites ou exceções
não capturadas podem produzir outros códigos HTTP ou HTML; não passam por este helper.

`gerarDocumentacaoTransporteCodex` já verifica o HTTP, analisa JSON e verifica
`parsed.ok`. `testarUrlWebAppTransporteCodex` devolve `postCode` e `postPreview`
como diagnóstico de transporte; `postCode: 200` não comprova que o ping foi autorizado.

Esta documentação não altera a execução nem tenta simular códigos HTTP reais.

Referências oficiais: [TextOutput](https://developers.google.com/apps-script/reference/content/text-output)
e [Content Service e redirecionamentos](https://developers.google.com/apps-script/guides/content).
