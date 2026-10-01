# Cadastro e referências de feriados

O cadastro aceita cabeçalhos canônicos e aliases legados pelo mesmo mapa na leitura e na escrita. Colunas ausentes são acrescentadas apenas ao salvar um registro válido. Edição e exclusão exigem ID existente e único antes de qualquer alteração de schema ou dados; IDs duplicados precisam de saneamento explícito, sem exclusão automática. A coluna ocultada é a coluna de ID resolvida pelo cabeçalho.

Datas textuais aceitas: `AAAA-MM-DD` (também mês/dia com um dígito), `DD/MM/AAAA` e mês textual em português, como `25/dez./2026`. A validação exige uma data de calendário real e o formato completo. Valores Date da planilha usam o fuso do script, configurado para America/Sao_Paulo.

O cadastro central prevalece sobre registros de feriado da Agenda na mesma data, mesmo quando inativo ou sem restrições de transporte. Para recorrência anual, a precedência usa dia e mês em todos os anos. Um cadastro inativo não é retornado como feriado operacional, mas impede que o legado o reative. A precedência não exclui outros registros explícitos do próprio cadastro central.

Agenda ausente ou vazia mantém os registros centrais. Uma falha ao consultar a Agenda é registrada e propagada como erro de lista operacional possivelmente incompleta; a execução não retorna sucesso com uma lista parcial. A leitura continua em bloco e não modifica o schema da Agenda. A invalidação dos caches existentes permanece ligada às mutações do cadastro.

O bootstrap público de cadastros exige autorização de leitura no servidor, incluindo Feriados. Edição e exclusão mantêm autorização de escrita e lock de documento.

## Desempenho e diagnóstico

Os logs `[CODEX_FERIADOS_PERF]` registram `stage`, `durationMs`, `success` e contagens disponíveis, sem nomes, IDs, datas de feriados ou conteúdo das linhas. Etapas: `authorization`, `cadastro`, `legacy`, `save_locked`, `risk_reference_aggregate` e `risk_reference_parts`. `readCalls` e `cellsRead` contam as leituras de valores, não todas as chamadas de metadados ao Sheets. `save_locked` mede a gravação bem-sucedida já dentro do lock, sem incluir a espera para adquiri-lo.

O cadastro lê valores exibidos e somente a coluna de datas brutas. A edição reutiliza cabeçalhos e sheet em um contexto local, lendo o cabeçalho uma única vez; a checagem dos IDs permanece em bloco antes da escrita. O bootstrap reutiliza o resultado da autorização para apresentar o perfil, sem uma segunda consulta de acesso.

Alertas operacionais reutilizam primeiro o cache agregado e, quando ele falta, as partes existentes `project_courier_map`, `courier_config` e `feriados`. Apenas partes ausentes ou inválidas são reconstruídas. As partes reconstruídas usam o limite de tamanho e TTL já existentes; nenhuma nova tolerância a dados antigos foi introduzida. Bypass de leitura ignora o agregado e as partes. A invalidação de feriados existente continua removendo agregado e parte correspondente.

A consulta direta `getAgendaFeriadosOperacionais_()` permanece fresca. Sem cache de referências, ainda é necessária uma leitura em bloco das colunas de data/tipo por todo o histórico da Agenda. Um cache parcial válido evita essa varredura nos alertas; não reduz o volume da primeira consulta sem cache.

Validação local comprova chamadas evitadas, não latência dos serviços Google. Depois de uma futura publicação autorizada, comparar `cadastro` e `legacy` com cache ausente, cache agregado presente, cache parcial presente e atualização explícita. Usar duração e contagens para avaliar o gargalo real, sem atribuir ganho em segundos a testes com simuladores.
