# Paginação da auditoria — implementação local

Implementada em 07/10/2026, a partir do
[diagnóstico offline](AUDITORIA_PAGINACAO_DIAGNOSTICO_2026-10-07.md).
Nenhuma publicação está incluída nesta entrega.

## Contrato

A interface usa a RPC existente `getAuditPage(type, limit, offset, filters, query)`
com quinto argumento opcional:

```javascript
{ paginationVersion: 2, snapshotId: '' }
```

`snapshotId` vazio cria um recorte. As páginas seguintes e o prefetch enviam o
mesmo token. `forceRefresh: true` cria outro recorte. Chamadas antigas, sem esse
argumento, e `getAuditLogPage`/`getAuditChangesPage` continuam compatíveis.
Os DTOs e a formatação das datas são compartilhados entre ambos os caminhos.

Toda chamada da versão 2 exige administrador antes de ler cache ou auditoria.
O token é assinado com HMAC-SHA256 e vinculado a administrador, planilha, aba,
filtros normalizados, limite, última linha, validade e digest do índice filtrado.
Não contém filtros literais, valores de células ou listas de registros.

Uma chave de assinatura é criada uma única vez em ScriptProperties, protegida
pelo lock existente. Não há escrita de propriedades por consulta ou por página.
Alterar/remover essa chave invalida tokens existentes, que exigirão atualização.

## Leituras e cache

- Sem filtros: uma leitura da página, calculada a partir da última linha capturada.
  Novos registros aparecem ao atualizar, sem deslocar offsets em andamento.
- Com filtros: primeira consulta lê A:E em blocos de até 50.000 linhas, calcula
  total e contagens e registra limites físicos e hash da sequência de IDs de cada
  página. A:E contém todos os campos dos filtros em ambas as trilhas.
- Página filtrada: uma faixa entre seus limites, nas seis/dez colunas. Somente
  essa faixa é filtrada e mapeada. Quantidade/IDs divergentes pedem consulta nova.
- Cache: manifesto com contagens e referências às partes; partes contêm somente
  `{firstRow,lastRow,count,idDigest}`. Nenhum conteúdo Antes/Depois/Observação,
  DTO, e-mail ou ID de registro é armazenado nessas partes.
- Partes de até 90.000 bytes UTF-8 após JSON; orçamento de 512 KiB por consulta.
  Validade absoluta de cinco minutos, preservada em todas as páginas.
- Cache miss, parte ausente, falha de escrita ou orçamento excedido: reconstruir
  A:E até a última linha do token, verificar digest e devolver a página correta.
  Não deslocar o recorte, truncar resultados ou depender do cache para autorizar.
- Expiração absoluta, fonte reduzida/trocada ou seleção divergente:
  `{ok:false,refreshRequired:true,reason:'expired'|'source_changed'}`.

O custo de construção continua linear no histórico. Os blocos limitam o volume
de células por leitura, mas não garantem limite de tempo para qualquer tamanho
de aba. Filtros esparsos podem produzir faixas largas; não há leitura por ID em
laços. Cache indisponível preserva correção, mas perde a economia entre páginas.
O orçamento do índice limita a persistência em cache, não toda a memória da
construção; volumes extremos ainda precisam de índice persistente ou arquivamento.

## Interface e concorrência

O estado conserva token/validade junto às páginas. Atualizar, mudar filtros ou
limite limpa as consultas anteriores; a troca de trilha mantém estado separado.
Respostas verificam request ID, aba, filtros, limite, objeto do cache e identidade
da consulta. Prefetch antigo não repovoa cache substituído nem apaga operação nova.

Avançar enquanto o prefetch está em andamento aguarda a mesma operação. Expiração
durante navegação renova a consulta, volta à primeira página e exibe aviso.
Um prefetch expirado em segundo plano marca a consulta para renovar no próximo
avanço, sem interromper a leitura da página atual.

A busca livre continua restrita à página carregada. Contagens globais de
usuários/módulos continuam disponíveis quando há filtros; sem filtros, os cartões
preservam a semântica da página. A ordem continua sendo inserção física inversa.

## Limites de consistência

O histórico produzido pelo aplicativo é acrescentado ao final. O recorte fixa
seleção, universo e contagens; não é cópia imutável de todos os conteúdos.
Alterações manuais que mantenham IDs e seleção podem modificar valores sem mudar
o hash. Novas rotinas de arquivamento/reordenação devem invalidar os recortes e
definir uma geração de manutenção. Esta entrega não move nem exclui registros.

## Evidência e validação

`tests/audit-pagination.test.js` cobre ambas as trilhas, equivalência com o legado,
limites 100/200/500, bordas, contagens, blocos, cache fragmentado/ausente, orçamento,
append, IDs deslocados, expiração, revogação, tokens adulterados e criação da chave.

`tests/core-async-regressions.test.js` cobre identidade da consulta, expiração,
reuso do prefetch e respostas obsoletas. `tests/e2e/audit-pagination.test.js` usa
os scripts e DOM locais, com RPCs simuladas e rede bloqueada, em desktop/celular.

Telemetria `[CODEX_AUDIT_PAGE]`: tipo, duração, sucesso, leituras/células, cache hit,
reconstrução, bytes do índice e resultado da escrita em cache quando aplicável.
Não registra filtros, proprietário, token, IDs ou valores de células.

```powershell
node --test --test-isolation=none tests/audit-pagination.test.js tests/core-async-regressions.test.js
npm.cmd run verify
npm.cmd run test:ui
```

A redução de leituras repetidas está coberta por simuladores. Latência, cotas e
capacidade no ambiente publicado precisam de medição após publicação autorizada.
