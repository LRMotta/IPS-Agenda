# Migracao do Estoque de Kits de Coleta - Fase 1

Gerado em: 2026-07-01  
Arquivo analisado: `Estoque_de_Kits_Coleta.xlsx`  
Saida tecnica completa: `Estoque_Migracao_Fase1_Diagnostico.json`  
Script usado: `tools/DiagnosticoEstoqueKits.ps1`

## Escopo

Esta fase analisou a planilha local sem gravar dados no WebApp e sem alterar as abas produtivas. O objetivo foi identificar como o controle atual pode ser migrado para o modulo de Estoque existente.

## Estrutura encontrada

A planilha contem uma aba principal:

| Aba | Dimensao | Observacao |
| --- | --- | --- |
| `Suprimentos` | `A1:Z1366` | Dados uteis concentrados em `A:J`; demais colunas nao entraram no diagnostico de migracao. |

Cabecalhos esperados na aba `Suprimentos`:

| Coluna | Campo |
| --- | --- |
| A | Projeto |
| B | Kit |
| C | Qtde |
| D | Validade |
| E | Localizacao |
| F | Numero do pedido |
| G | Data do pedido |
| H | Qtde solicitada |
| I | Responsavel pedido |
| J | Observacoes |

## Numeros principais

| Indicador | Valor |
| --- | ---: |
| Linhas com dados uteis em `A:J` | 1.150 |
| Projetos unicos brutos | 45 |
| Projetos unicos normalizados | 42 |
| Kits unicos por projeto | 904 |
| Linhas com quantidade numerica | 1.012 |
| Linhas candidatas a saldo | 916 |
| Linhas de saldo importaveis diretamente | 750 |
| Linhas de saldo que precisam revisao | 166 |
| Linhas com validade numerica | 752 |
| Linhas com validade textual | 207 |
| Linhas com dados de pedido | 191 |
| Linhas com observacoes | 236 |

Classificacao inicial das linhas:

| Tipo | Linhas |
| --- | ---: |
| Saldo | 870 |
| Saldo com pedido | 185 |
| Cabecalho/contexto | 93 |
| Saldo com kit herdado | 2 |

## Pontos de atencao

1. Existem 93 linhas de cabecalho/contexto. Elas carregam informacoes como laboratorio, localizacao geral, coordenador ou observacoes do estudo, mas nao representam saldo direto.
2. Existem 207 linhas com validade textual. Em muitos casos a coluna `VALIDADE` esta sendo usada como laboratorio ou contexto, por exemplo `Labcorp`, `LabCorp` ou `PPD`.
3. Existem 191 linhas com informacoes de pedido, mas 11 delas estao parciais, com algum dos campos de pedido incompleto.
4. Existem 718 linhas candidatas a saldo sem localizacao propria. Parte dessas linhas provavelmente deve herdar a localizacao do cabecalho/contexto anterior.
5. Existem 42 projetos normalizados contra 45 valores brutos. A diferenca vem de variacoes como espacos antes/depois do nome do projeto.
6. O arquivo mistura catalogo, saldo, pedido, localizacao, laboratorio e observacoes em uma unica tabela. A importacao direta para uma unica aba do WebApp nao e recomendada.

## Mapeamento recomendado para o WebApp

O modulo atual de Estoque ja separa os conceitos que o Excel mistura:

| Origem no Excel | Destino recomendado | Regra inicial |
| --- | --- | --- |
| `PROJETO` + `KIT` | `Itens` | Criar/atualizar catalogo de item por projeto e descricao do kit. |
| `QTDE` + `VALIDADE` + `LOCALIZACAO` | `Estoque` | Criar saldo por item, validade e localizacao. |
| `N DO PEDIDO`, `DATA DO PEDIDO`, `QTDE SOLICITADA`, `RESPONSAVEL PEDIDO` | `Pedidos` e `Pedidos_Itens` | Criar pedido somente quando os campos minimos estiverem consistentes. |
| Cada saldo importado | `Movimentacoes` | Registrar entrada inicial como `Entrada - Migracao Excel`. |
| `OBSERVACOES` | Observacoes do item, pedido ou movimentacao | Preservar texto, mas decidir destino conforme a linha seja contexto, saldo ou pedido. |

## Regras sugeridas para a Fase 2

1. Importar primeiro para uma area de staging, nao direto nas abas produtivas.
2. Normalizar projeto com `trim`, remocao de acentos para comparacao e preservacao do texto original para exibicao.
3. Converter validade numerica de Excel para data real.
4. Tratar validade textual como contexto/laboratorio, nao como vencimento.
5. Herdar localizacao de cabecalhos/contexto quando uma sequencia de kits abaixo nao tiver localizacao propria.
6. Registrar todo saldo inicial em `Movimentacoes` para preservar auditoria.
7. Nao sobrescrever item existente sem reconciliacao por projeto + descricao + laboratorio.
8. Separar importacao de pedidos da importacao de saldo. Pedido parcial deve ir para fila de revisao.

## Decisoes pendentes antes da importacao

1. Quando uma linha de saldo nao tem localizacao, devemos herdar a ultima localizacao de contexto do bloco?
2. A coluna `VALIDADE` textual deve virar `Laboratorio` no catalogo quando contem `Labcorp`, `PPD` ou similar?
3. As observacoes de cabecalho do estudo devem ficar no item, no projeto, ou em uma aba auxiliar de notas de estoque?
4. Pedidos historicos devem ser migrados como pedidos operacionais editaveis ou apenas como referencia na observacao/movimentacao?
5. Para kits repetidos com mesmo projeto, validade e localizacao, o saldo deve ser somado em uma linha unica ou preservado como linhas separadas?

## Proxima fase proposta

Fase 2 deve criar um importador de staging com tres saidas:

1. `Import_Estoque_Kits_Staging`: linhas normalizadas e classificadas.
2. `Import_Estoque_Kits_Erros`: linhas bloqueadas ou ambiguas.
3. `Import_Estoque_Kits_Resumo`: totais por projeto, laboratorio, validade e status de importacao.

Somente depois da conferencia desses tres resultados a importacao deveria gravar em `Itens`, `Estoque`, `Pedidos`, `Pedidos_Itens` e `Movimentacoes`.
