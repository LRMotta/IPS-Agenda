# Remoção dos feriados legados da Agenda — 2026-10-01

Regra solicitada: apenas o módulo Feriados deve alimentar as referências operacionais. Não migrar nem inferir feriados a partir de eventos antigos.

## Operação na base ativa

- Planilha: [Agenda](https://docs.google.com/spreadsheets/d/1GElUcP6IZiLaT62VOqk0lRoA7tJ_9hvZIAoBa7kOWuU/edit).
- Aba: `📅 Agenda`, `sheetId=0`.
- Removidas 15 linhas com tipo exatamente `Feriado`, após conferir todas as colunas dessas linhas e a ausência de vínculos pelos respectivos IDs em `Transporte_Operacoes`, `Courier_Lembretes`, `Reservas_Kits` e `Agenda_SoA_Conciliacao`.
- Backup completo anterior à exclusão: [Agenda — backup antes de remover 15 feriados legados](https://docs.google.com/spreadsheets/d/1G-b_WbCdlz7h_rvmRaoKjkWTOW7kJ_jmUaXX0vr8AUQ/edit). Conteúdo das 15 linhas conferido na cópia antes da exclusão.
- Exclusão feita em um batch de `deleteDimension`, de baixo para cima, após releitura e comparação do bloco A:D da Agenda. A aba Feriados foi comparada antes e depois.
- Resultado: 1.345 eventos restantes. A:D dos eventos restantes correspondem exatamente à sequência anterior sem as 15 linhas removidas, preservando IDs e ordem. Os 14 cadastros centrais permanecem intactos. A grade da Agenda passou de 1.361 para 1.346 linhas, incluindo cabeçalho.

## Linhas removidas na posição anterior à limpeza

| Linha | ID Agenda | Data |
| --- | --- | --- |
| 429 | f0e922b3 | 03/04/2026 |
| 487 | a6414829 | 20/04/2026 |
| 488 | cd35c51e | 21/04/2026 |
| 535 | 10449496 | 01/05/2026 |
| 602 | 3298d5eb | 25/05/2026 |
| 604 | b7c65c07 | 26/05/2026 |
| 662 | cbc7263f | 04/06/2026 |
| 1077 | c1761956 | 07/09/2026 |
| 1270 | 5b8dfb75 | 12/10/2026 |
| 1271 | a4ade809 | 13/10/2026 |
| 1307 | 189d7619 | 02/11/2026 |
| 1321 | dc1c98d6 | 15/11/2026 |
| 1328 | 55af8001 | 20/11/2026 |
| 1329 | 1457fc70 | 21/11/2026 |
| 1344 | a3b631c1 | 25/12/2026 |

## Código local

`getAgendaFeriadosOperacionais_()` lê apenas o cadastro central, filtra datas válidas e cadastros ativos e preserva recorrência/configuração de restrições. Não consulta a Agenda. Os testes que exigiam leitura e incorporação do legado foram ajustados porque a regra de negócio foi expressamente substituída.

Chaves versionadas: agregado `AgendaBootstrapReferenceData:v3`, marca `AgendaBootstrapReferenceRevalidated:v2`, parte de feriados com sufixo `:central-v2`, formulários `AgendaFormData:v12` e `AgendaFormDataStrict:v6`. As invalidações locais incluem as novas chaves. Nenhuma publicação de código foi realizada nesta operação.

Validação: `npm.cmd run verify` (857 testes) e `npm.cmd run test:ui` (45 testes) aprovados. Simuladores comprovam ausência da leitura histórica; o ganho em segundos exige nova medição após publicação.

## Recuperação

As posições da tabela acima pertencem ao backup. Para recuperar, localizar os IDs na cópia e restaurar somente as linhas necessárias, preservando os eventos criados ou editados depois desta operação; não substituir a planilha ativa inteira pelo backup.
