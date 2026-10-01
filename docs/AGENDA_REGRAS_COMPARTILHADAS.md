# Regras compartilhadas da Agenda

`tools/agenda-rules-core.js` e a fonte unica para a classificacao de tipos e status,
comparacoes, politicas do formulario, laboratorio, transporte, rotulos, classes, icones,
confirmacao de requisicoes e regras de status do courier.
A ordem da tabela de tipos preserva a prioridade dos aliases compostos.

Para mudar um tipo, edite sua definicao nessa tabela e execute:

```powershell
npm run rules:generate
npm run verify
```

O gerador atualiza apenas os blocos demarcados em `AgendaServerRules.gs` e
`SharedAgendaRules.html`. Os dois arquivos continuam independentes no Apps Script
e no navegador, sem biblioteca ou chamada externa adicional. As funcoes especificas
de cada runtime ficam fora dos blocos gerados.

`npm run rules:check`, incluido no inicio de `npm run verify`, recusa divergencias
entre a fonte e qualquer bloco gerado. A verificacao nao modifica arquivos.

Os tipos personalizados preservam seu texto. `typePluralLabel` aceita um objeto
`{tipo, singular, plural}` ou um fallback `{singular, plural}` para pluralizacao
explicita. Sem plural informado, conserva o fallback legado de adicionar `s`.

`isStatus` recusa um status esperado desconhecido, mesmo que a classificacao
legada de um registro desconhecido use `agendado`. `isType` aceita aliases e
tipos personalizados, mas nao compara uma expectativa vazia como `evento`.

Contato telefonico, inclusive `Visita — contato telefônico`, dispensa transporte
e laboratorio. O formulario oculta os campos tecnicos e o servidor ignora escritas
de transporte nesse tipo, preservando dados de envios historicos.

`canPerform` recusa acoes desconhecidas. Essa funcao e uma regra do cliente;
a autorizacao das RPCs continua obrigatoria no servidor.

`AgendaRules.Context` e `AgendaRules.Indicator` definem as chaves da visibilidade
e das contagens. Os chamadores devem usar essas constantes. Espacos nas extremidades,
acentos e caixa sao normalizados; chaves desconhecidas ou vazias retornam `false`.
As contagens e a visibilidade dos contextos conhecidos preservam os contratos legados.

Nas observacoes, uma negacao com outro sujeito explicito (transporte, amostras,
courier ou coleta) nao invalida uma confirmacao da requisicao. Uma negacao da
propria requisicao, ou sem sujeito identificavel, continua impedindo essa inferencia.
Um status de requisicao preenchido continua prevalecendo sobre a observacao.

As regras de courier usam a mesma classificacao para aliases de agendamento,
pendencias e confirmacao. Entrega afirmada prevalece sobre envio e confirmacao
em rotulos compostos. Negacoes como `Nao enviado` ou `Nao foi entregue` nao
comprovam esses estados. O fallback visual `pendente` para texto desconhecido
nao autoriza confirmacao automatica nem cria pendencia de agendamento.
Na Agenda, negacoes como `Nao realizado`, `Nao concluido` ou `Nao cancelado`
tambem nao comprovam conclusao ou cancelamento. O fallback legado de status
desconhecido permanece `agendado`; `Nao agendado` conserva sua chave propria.

Estas regras sao puras, sem acesso a servicos Google ou cache externo.
`formPolicy` classifica o tipo uma vez e os padroes de requisicao sao compilados
uma vez por runtime. Nos chamadores, a notificacao le seu estado em um bloco;
o alinhamento legado le uma vez e escreve apenas os alvos com `RangeList`.
