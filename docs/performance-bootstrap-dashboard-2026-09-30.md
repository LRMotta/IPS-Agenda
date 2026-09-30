# Medição de bootstrap e Dashboard — 30/09/2026

## Ambiente e método

Web App autenticado no Chrome, perfil de administrador, versão exibida
`2026.09.30.1708-a927ab85`. As medições foram somente leitura, em aba separada;
a tela original de recibo foi preservada. Nenhuma publicação foi realizada.
As mudanças locais podem diferir da versão implantada.

O bootstrap foi medido pelos registros existentes `[CODEX_PERF_CLIENT]`.
Foram feitas três cargas da Agenda sem limpar caches do servidor. O tempo
registrado é da RPC, separado da aplicação da resposta no cliente.

O Dashboard foi medido do clique em **Atualizar dados** até o botão voltar a
ficar habilitado. Essa ação evita o cache de sessão do Dashboard, mas não limpa
caches do servidor. Os tempos são observados pela automação e incluem RPC,
processamento da resposta, renderização e atraso de observação. São aproximações
do tempo percebido na atualização; não são tempos isolados do servidor.

## Resultados reais

| Medição | Amostra 1 | Amostra 2 | Amostra 3 | Mediana |
| --- | ---: | ---: | ---: | ---: |
| Bootstrap da Agenda: RPC | 7,156 s | 7,871 s | 5,551 s | 7,156 s |
| Bootstrap da Agenda: aplicação da resposta | 2 ms | 4 ms | 1 ms | 2 ms |
| Bootstrap da Agenda: prontidão registrada | 7,195 s | 7,942 s | 5,623 s | 7,195 s |
| Dashboard: atualização observada | 23,263 s | 21,554 s | 23,210 s | 23,210 s |

As três respostas de bootstrap da Agenda tinham **259.571 bytes (253,5 KiB)**.
Uma abertura do Dashboard registrou bootstrap de **4,092 s**, com aplicação
de **2 ms** e resposta de **2.763 bytes (2,7 KiB)**. Essa única amostra não basta
para caracterizar a variação do bootstrap do Dashboard.

Na aba original, antes da série controlada, havia um registro de bootstrap
da Agenda de **11,860 s**, com 259.568 bytes. É uma observação complementar;
não foi incluída na mediana das novas cargas.

Não apareceram erros de console nas consultas realizadas. Cada atualização do
Dashboard concluiu e exibiu os indicadores. A amostra representa uma conta,
um perfil, um navegador e uma sessão; não fornece percentis de produção nem
comparação entre cache frio e quente.

## Interpretação

O Dashboard merece a primeira investigação: sua atualização levou cerca de
22–23 segundos. A medição atual não distingue custo do servidor e renderização.
O bootstrap da Agenda também é relevante, com mediana de 7,2 segundos e resposta
de aproximadamente 254 KiB. Os 1–4 ms de aplicação da resposta medem somente a
etapa existente de bootstrap, não toda a renderização posterior da Agenda.

O bootstrap do Dashboard observado foi muito menor em bytes que o da Agenda.
Assim, nesta sessão a navegação já separava as cargas por seção; não há evidência
para tratar uma suposta carga completa da Agenda no Dashboard como o gargalo.

## Instrumentação adicional preparada localmente

`WebApp.gs` mantém o contrato das respostas e acrescenta:

- Etapas `access`, `projects`, `participants`, `stock`, `agenda`, `pending`,
  `serialize` e `total` a `getDashboardData`, com duração e sucesso da etapa.
- Tamanho UTF-8 da resposta do Dashboard e contagem de projetos + participantes
  retornados em `rowCount` do total.
- `instrumentedReadCalls` e `instrumentedCellsRead` no bootstrap e no Dashboard.
  São deltas por etapa: etapas internas e total não devem ser somados juntos.
- Leitura medida nos pontos centrais de Users, cache em memória de planilhas,
  SIV, resumo da Agenda, pendências, estoque, reservas de kits, couriers,
  listas de referência e índice/leitura de janela da Agenda.

As contagens cobrem apenas os pontos instrumentados de `getValues` e
`getDisplayValues`. Não incluem todos os caminhos possíveis, metadados como
`getLastRow`, escritas, CacheService, PropertiesService, OAuth ou outros serviços.
Não são contagens completas de chamadas externas. Um cache atendido sem leitura
medida resulta em zero; isso não identifica sozinho qual cache foi utilizado.

Os novos registros de desempenho contêm somente nomes fixos de operação/etapa,
durações, números e trace efêmero do bootstrap. Não registram os dados das
planilhas ou conteúdo das respostas. Cinco testes com simuladores validam
tempos, contagens, isolamento entre operações, autorização, falhas parciais,
bytes UTF-8 e preservação dos resultados mesmo quando o log falha.

Essa instrumentação adicional **ainda não está implantada**. As etapas e
contagens novas não foram medidas contra os serviços reais. Depois de uma
publicação explicitamente autorizada, repetir várias cargas e comparar os
registros `[CODEX_PERF]` da mesma execução será o próximo passo para localizar
o custo dentro do servidor. Nenhuma otimização foi aplicada nesta tarefa.
