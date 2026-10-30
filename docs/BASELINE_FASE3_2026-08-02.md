# Baseline da Fase 3 - Agenda

Data da coleta: 2026-08-02, entre 20:10 e 20:15 (America/Sao_Paulo).

Ambiente observado: implantacao 61, build `2026.08.01.1928-3e6c07cc`, web app `/exec`, usuario administrador autenticado.

## Metodo

- Foram feitas dez recargas completas e consecutivas do `/exec`, sem criar, editar ou salvar registros.
- Em cada abertura foram medidos, a partir do inicio da recarga:
  - retorno da navegacao;
  - exibicao do bootstrap geral (versao/titulo da aplicacao);
  - referencias obrigatorias prontas (78 opcoes de projeto e 166 de participante);
  - Agenda renderizada e utilizavel no navegador.
- As dez chamadas correspondentes de `getAgendaEventos(5000)` e de `getAppBootstrapData` foram confirmadas na pagina de Execucoes do Apps Script.
- Ao final, a alternancia Lista -> Semana foi exercitada e a semana `27/jul./2026 - 02/ago./2026` permaneceu renderizada.

## Amostras do navegador

Tempos em segundos.

| Abertura | Retorno da recarga | Bootstrap visivel | Referencias prontas | Agenda percebida |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 4,639 | 7,926 | 7,453 | 25,810 |
| 2 | 2,364 | 5,093 | 5,093 | 24,353 |
| 3 | 2,166 | 4,728 | 4,728 | 18,433 |
| 4 | 2,088 | 4,198 | 4,198 | 22,003 |
| 5 | 1,894 | 4,633 | 4,633 | 25,647 |
| 6 | 3,041 | 6,101 | 5,660 | 31,374 |
| 7 | 2,446 | 5,061 | 5,061 | 19,390 |
| 8 | 2,493 | 5,050 | 5,050 | 24,227 |
| 9 | 2,137 | 9,089 | 9,089 | 34,598 |
| 10 | 4,848 | 7,336 | 7,336 | 27,234 |

## Execucoes confirmadas no servidor

Tempos em segundos. `getAgendaEventos(5000)` inclui obtencao da planilha, leitura das linhas e conversao/hidratacao; `getAppBootstrapData` representa o bootstrap geral do servidor.

| Inicio | `getAppBootstrapData` | `getAgendaEventos(5000)` |
| --- | ---: | ---: |
| 20:10:13 / 20:10:15 | 1,521 | 17,209 |
| 20:10:42 / 20:10:44 | 1,801 | 18,343 |
| 20:11:10 / 20:11:12 | 1,481 | 12,818 |
| 20:11:34 / 20:11:36 | 1,043 | 16,912 |
| 20:12:01 / 20:12:03 | 1,723 | 20,239 |
| 20:12:32 / 20:12:34 | 1,890 | 24,489 |
| 20:13:11 / 20:13:13 | 1,425 | 13,523 |
| 20:13:36 / 20:13:38 | 1,430 | 18,073 |
| 20:14:06 / 20:14:12 | 5,847 | 24,666 |
| 20:14:48 / 20:14:49 | 1,441 | 18,870 |

## Resumo estatistico

Tempos em segundos. P90 calculado pelo metodo nearest-rank para dez amostras.

| Componente | Minimo | Mediana | Media | P90 | Maximo |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bootstrap geral do servidor | 1,043 | 1,501 | 1,960 | 1,890 | 5,847 |
| Referencias prontas no navegador | 4,198 | 5,077 | 5,830 | 7,453 | 9,089 |
| `getAgendaEventos(5000)` no servidor | 12,818 | 18,208 | 18,514 | 24,489 | 24,666 |
| Abertura percebida da Agenda | 18,433 | 25,000 | 25,307 | 31,374 | 34,598 |

O intervalo mediano entre referencias prontas e Agenda pronta foi de 19,219 s. O tempo mediano total de `getAgendaEventos(5000)` foi de 18,208 s, equivalente a aproximadamente 73% da abertura percebida mediana. Isso confirma que a leitura/conversao da colecao completa e o principal alvo da Fase 3; o bootstrap geral nao e o gargalo dominante.

## Leitura versus hidratacao

O codigo publicado ja registra separadamente `sheet`, `read`, `convert_hydrate` e `total` em `[CODEX_PERF]`. Entretanto, durante esta coleta, o painel de detalhes das Execucoes permaneceu indefinidamente em `Carregando...` para as amostras novas. A tentativa alternativa com `clasp logs` tambem nao foi utilizavel porque o projeto nao possui `gcpProjectId` configurado no `.clasp.json`.

Por isso, os dez totais de `getAgendaEventos(5000)` estao confirmados, mas a divisao numerica interna entre leitura e hidratacao nao foi inventada nem estimada. Antes de comparar uma implementacao da Fase 3, deve-se recuperar os quatro registros `[CODEX_PERF]` das mesmas execucoes (ou de uma nova bateria equivalente) quando o Cloud Logging estiver disponivel. A instrumentacao existente e suficiente; nao e necessario alterar o comportamento da Agenda para isso.

## Observacoes de regressao

- Projeto e participante estavam integralmente preenchidos durante todas as aberturas (78 e 166 opcoes observadas).
- A Agenda foi exibida na visao semanal e a alternancia Lista -> Semana funcionou ao final.
- Nao houve erro de console. Foram encontrados quatro registros do mesmo instante com o aviso: `Consulta especifica de materiais divergente; fallback completo preservado.` Como os registros persistiram entre recargas, eles nao devem ser interpretados como quatro ocorrencias independentes. O fallback completo preservou o comportamento, mas a divergencia deve continuar coberta antes de ativar carregamento por janela.
- Nenhuma alteracao de dados, codigo publicado ou implantacao foi realizada nesta coleta.

## Preparacao do worktree

- As alteracoes locais do fluxo de publicacao foram validadas por `npm run verify` (153 testes aprovados) e registradas no commit `7e5b1c9` (`chore: exige verificacao final da publicacao`).
- Os mockups nao rastreados e sem referencias no codigo foram preservados fora do repositorio em `C:\Users\lrmotta\.codex\visualizations\2026\07\30\019fb2be-64c0-7370-8852-60d520e6d779\archived-mocks`.
- Nenhuma publicacao ou `push` foi executado.
