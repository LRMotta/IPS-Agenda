# Cadastro e referências de feriados

O cadastro aceita cabeçalhos canônicos e aliases legados pelo mesmo mapa na leitura e na escrita. Colunas ausentes são acrescentadas apenas ao salvar um registro válido. Edição e exclusão exigem ID existente e único antes de qualquer alteração de schema ou dados; IDs duplicados precisam de saneamento explícito, sem exclusão automática. A coluna ocultada é a coluna de ID resolvida pelo cabeçalho.

Datas textuais aceitas: `AAAA-MM-DD` (também mês/dia com um dígito), `DD/MM/AAAA` e mês textual em português, como `25/dez./2026`. A validação exige uma data de calendário real e o formato completo. Valores Date da planilha usam o fuso do script, configurado para America/Sao_Paulo.

O módulo Feriados é a única fonte de feriados operacionais. Eventos de tipo Feriado na Agenda são ignorados, sem leitura de dados ou metadados dessa aba. Apenas cadastros com data válida e ativos são retornados, preservando recorrência anual e configuração de restrições. Cadastro ausente retorna lista vazia; falha de leitura do cadastro continua propagada. Nenhum registro legado é migrado ou inferido automaticamente. A invalidação dos caches permanece ligada às mutações do cadastro.

O cálculo de prazos das Pendências/Dashboard e os lembretes de courier também usam esse cadastro. Para dias operacionais, registros com `afetaOperacao=Não` não bloqueiam o dia. O mapa mantém datas específicas e chaves anuais `--MM-DD`, sem limitar o calendário a um ano. Cada snapshot de courier lê o cadastro novamente, inclusive nas revalidações anteriores ao envio: erro do cadastro interrompe a decisão, sem fallback para a Agenda. Na releitura dos eventos, somente a coluna ID e a linha selecionada são consultadas; unicidade, locks e verificação de alterações são preservadas. Mutações de eventos da Agenda não invalidam mais referências de feriados.

Benefício adicional: o Dashboard deixa de percorrer a matriz de eventos para descobrir feriados; courier reduz a largura do índice histórico para uma coluna. Esses fluxos já precisavam ler a Agenda e agora consultam também o cadastro central, portanto o ganho líquido em segundos deve ser medido. A eliminação da consulta histórica exclusiva no bootstrap e nas referências de risco é um benefício distinto, observado anteriormente em cerca de 2,1 s de leitura legada por reconstrução.

O bootstrap público de cadastros exige autorização de leitura no servidor, incluindo Feriados. Edição e exclusão mantêm autorização de escrita e lock de documento.

## Desempenho e diagnóstico

Os logs `[CODEX_FERIADOS_PERF]` registram `stage`, `durationMs`, `success` e contagens disponíveis, sem nomes, IDs, datas de feriados ou conteúdo das linhas. Etapas: `authorization`, `cadastro`, `save_locked`, `risk_reference_aggregate` e `risk_reference_parts`. `readCalls` e `cellsRead` contam as leituras de valores, não todas as chamadas de metadados ao Sheets. `save_locked` mede a gravação bem-sucedida já dentro do lock, sem incluir a espera para adquiri-lo.

### Revalidação de referências da Agenda

A RPC `getAgendaReferenceDataBackgroundRevalidate` emite `[CODEX_PERF]` para autorização, consulta da marca de revalidação, referências, cada lista reconstruída, gravação da marca e total. Todas essas etapas compartilham um `traceId` aleatório, sem identidade de usuário. `reference_kits_coleta` é o total de preparação das opções de kits; `reference_kits_estoque` é seu subtotal de consulta do estoque, catálogo e reservas. Não some etapas aninhadas. `instrumentedReadCalls` e `instrumentedCellsRead` contam somente os pontos de leitura instrumentados, não todos os acessos ao Google.

O resumo `[CODEX_AGENDA_REFERENCE_REVALIDATE]` contém `traceId`, `startedAtMs`, `durationMs`, TTL e `outcome`: `recent_revalidation`, `rebuilt_marked`, `rebuilt_marker_failed` ou `failed`. A falha ao gravar a marca também pode ser falha dos metadados do cache; não prova que a entrada inexiste. Cruzar intervalos de resumos `rebuilt_*` permite identificar reconstruções sobrepostas. Uma marca recente pode ainda exigir reconstrução se o cache agregado tiver expirado ou sido invalidado: confira também `[CODEX_AGENDA_REFERENCE_CACHE]` na mesma execução. Etapas com sufixo `_cache` indicam reutilização de uma lista no cache parcial.

A marca só é gravada após a reconstrução; não funciona como lock entre execuções. A instrumentação preserva esse comportamento, TTL, invalidações, atualização forçada e fallback. Ganhos de latência e frequência de sobreposição exigem medição após publicação; os testes locais apenas comprovam o diagnóstico e os contratos.

O cadastro lê valores exibidos e somente a coluna de datas brutas. A edição reutiliza cabeçalhos e sheet em um contexto local, lendo o cabeçalho uma única vez; a checagem dos IDs permanece em bloco antes da escrita. O bootstrap reutiliza o resultado da autorização para apresentar o perfil, sem uma segunda consulta de acesso.

Alertas operacionais reutilizam primeiro o cache agregado e, quando ele falta, as partes existentes `project_courier_map`, `courier_config` e `feriados`. Apenas partes ausentes ou inválidas são reconstruídas. As partes reconstruídas usam o limite de tamanho e TTL já existentes; nenhuma nova tolerância a dados antigos foi introduzida. Bypass de leitura ignora o agregado e as partes. A invalidação de feriados existente continua removendo agregado e parte correspondente.

A consulta direta `getAgendaFeriadosOperacionais_()` permanece fresca e lê somente o cadastro do módulo Feriados. A Agenda não é consultada, mesmo com cache ausente. As chaves dos caches agregados, da revalidação e da parte de feriados foram versionadas para que uma publicação futura não reutilize listas operacionais antigas contendo legado.

Validação local comprova chamadas evitadas, não latência dos serviços Google. Depois de uma futura publicação autorizada, medir `cadastro` e `reference_feriados` com cache ausente, cache agregado presente, cache parcial presente e atualização explícita. Usar duração e contagens para avaliar o gargalo real, sem atribuir ganho em segundos a testes com simuladores.
