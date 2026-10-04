# Primeira melhoria de desempenho do Dashboard

## Evidência e escopo

Na implantação 248, três consultas reais do Dashboard tiveram mediana de
18.013 ms na RPC, 15.086 ms no total instrumentado do servidor e 72 ms de
renderização síncrona. Projetos foi a maior etapa individual, com mediana de
5.295 ms. A preparação da aba em Pendências teve mediana de 920 ms dentro do
Dashboard. Essas observações são de uma conta e um horário, sem limpeza de cache.

Projetos/SIV, resumo da Agenda e Pendências chamavam separadamente o getter
somente leitura da mesma aba dentro de uma RPC. A primeira melhoria reutiliza
essa preparação durante `getDashboardData`, sem unir as matrizes bruta e
formatada: datas tipadas e identificadores formatados têm contratos diferentes.

O contexto é criado após a autorização e restaurado em `finally`. Falhas e
ausência da aba não são memorizadas. Chamadas independentes e a próxima RPC
preparam novamente a aba. Não há cache persistente, mudança de permissão,
alteração de schema ou escrita adicionada.

## Medição e regressão local

O simulador demonstra três preparações antes e uma durante o Dashboard,
mantendo uma leitura bruta e uma formatada e resultados equivalentes de SIV,
indicadores e Pendências. Também cobre falha, aba vazia, ausência, acesso negado,
atualização entre RPCs, exceção e restauração de contexto aninhado.

Essa redução de chamadas não comprova economia de segundos em produção.
`getProjetos` agora registra `projects_sheet`, `projects_participants_stats` e
`projects_siv` dentro do Dashboard, com o mesmo trace. Essas etapas estão
contidas em `projects`; não somar os tempos novamente.

Um contrato estático em `tests/agenda-windowing.test.js` foi atualizado para
acompanhar o getter intermediário e verificar que ele delega ao getter sem
escritas, mantendo a proteção dos três consumidores.

## Próxima medição após publicação autorizada

Repetir três consultas de atualização do Dashboard e comparar RPC, total do
servidor, `projects` e suas subetapas, `agenda` e `pending_sheet`. Preservar os
contadores de leituras e as condições de cache na interpretação. Investigar a
maior subetapa de Projetos antes de reduzir faixas ou remover campos. Pendências
fora do Dashboard continua com sua própria preparação; esta mudança não promete
ganho nessa tela isolada.

As alterações desta etapa são locais. A instrumentação publicada na implantação
248 permanece ativa até uma nova publicação autorizada.
