# Cache de últimas visitas e invalidação por escopo

`clearCodexRuntimeCaches_(parts, eventScope)` mantém a limpeza completa quando o segundo argumento é omitido. Os cadastros auditados usam `references` (referências apenas) ou `participants` (referências, hidratação e geração de eventos, preservando o índice de datas). Escritas na Agenda continuam invalidando o índice e a geração.

O mapa usado pela listagem de Participantes mantém ID de cadastro e fallback por nome, com visitas concluídas até o dia atual em `America/Sao_Paulo`. A chave contém versão, geração da Agenda, quantidade de linhas e dia. O armazenamento reutiliza segmentação, checksum e proteção de geração do cache de janelas, com TTL de 45 segundos. Falhas usam leitura fresca ou o fallback histórico sem armazenar resultado parcial. `forceRefresh === true` e `CODEX_CACHE_BYPASS_READS_` ignoram a leitura do cache.

Nos logs `[CODEX_PERF]`, filtre `operation: Participantes` e `stage: ultima_visita`:

- `instrumentedReadCalls`: chamadas instrumentadas de leitura de valores.
- `instrumentedCellsRead`: células retornadas nessas leituras.
- `cacheHit` / `cacheMiss`: resultado da consulta do cache; refresh forçado conta como miss.
- `durationMs`: duração da etapa, incluindo cache e processamento.

Taxa de acerto = quantidade de `cacheHit: true` dividida pela quantidade total de registros da etapa. Uma leitura fria transfere `(lastRow - 1) * AGENDA_CFG.lastCol` células em uma leitura; um acerto transfere zero células da Agenda. Metadados de Sheets (`getLastRow`, localização da aba), ACL, escritas e serviços externos não estão incluídos nessas contagens. Os logs não contêm nomes, IDs, datas de visitas nem chaves de cache.

Os simuladores comprovam as leituras evitadas; duração e taxa de acerto em produção precisam ser observadas após publicação. Alterações manuais na planilha são recuperadas após o TTL ou atualização forçada. A RPC legada `getUltimaVisita` conserva seu cálculo separado, inclusive seu tratamento de datas futuras.
