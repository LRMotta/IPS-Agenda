# Auditoria: diagnóstico local e desenho da paginação

Implementação local posterior: [contrato e validações](AUDITORIA_PAGINACAO_LOCAL.md).
O diagnóstico e o protótipo abaixo são a evidência anterior à implementação.

## Estado e escopo

Diagnóstico de 07/10/2026, sobre o checkout local após as correções pontuais.
O aplicativo não foi alterado nesta etapa. Foram acrescentados um simulador
offline, seu resultado agregado e este desenho. Não houve acesso a dados reais,
serviços Google, publicação, arquivamento ou exclusão de registros.

**Recomendação:** manter o caminho barato sem filtros e substituir as varreduras
repetidas com filtros por um recorte de consulta com totais e limites de páginas
calculados uma vez. Armazenar os limites, contagens e hashes dos IDs; carregar o
conteúdo apenas da página solicitada. Não armazenar toda a auditoria no cache.

## Evidência no código atual

| Componente | Comportamento confirmado |
| --- | --- |
| `WebApp.gs`, `getAuditRowsPage_` | Sem filtro: uma faixa limitada à página, em ordem física inversa. Com filtro: todas as 6 ou 10 colunas, inversão, seleção, contagens globais e depois `slice`. |
| `codexPrepareAuditFilters_` | A correção local já prepara texto e datas uma vez por consulta. |
| `getAuditLogPage`, `getAuditChangesPage` | Ambas exigem administrador; preservam DTOs diferentes e datas formatadas. |
| `getAuditPage` | Entrada do cliente; valida leitura e encaminha para as RPCs com guarda de administrador. Essa restrição deve continuar em toda página e prefetch. |
| `IndexCoreScripts.html`, `carregarAuditPage` | Cache de páginas em memória do navegador por tipo, filtros, limite e offset. Voltar a uma página em cache evita RPC. |
| `prefetchAuditNextPage` | Faz a mesma RPC para a próxima página. Com filtros, antecipa outra varredura inteira, mesmo se a pessoa não avançar. |
| Escritores de auditoria | `codexWriteAuditLog_`, `codexWriteAuditLogBatch_` e `codexWriteAuditChangesBatch_` acrescentam registros. Não foi encontrada manutenção interna que reordene o histórico. |
| `renderAuditLog` | A busca livre `searchAudit` filtra somente os registros da página carregada. Não equivale aos filtros globais de usuário, ação e período. |
| Cartões de usuários/módulos | Com filtros, contam todo o resultado; sem filtros, hoje usam valores derivados da página. Preservar essa diferença na primeira entrega. |

A ordem atual é a ordem de inserção física, invertida; não é uma ordenação global
por timestamp. Não trocar essas regras junto com a otimização.

O controle assíncrono existente descarta respostas de outro filtro, aba, limite
ou requisição e impede que prefetch antigo repovoe um cache substituído. A nova
paginação deve acrescentar a identidade da consulta a essas mesmas verificações.

## Método reproduzível

```powershell
node tools/audit-pagination-diagnostic.js
```

Saída: `docs/audit-pagination-diagnostic-2026-10-07.json`. O arquivo registra
hash SHA-256 do `WebApp.gs`, versão Node, fuso, data e métricas agregadas.

- Executa o leitor atual em VM com planilha virtual somente leitura.
- Volumes: 1.000, 10.000, 50.000 e 100.000 registros, em ambas as trilhas.
- Limites: 100 e 500 registros por página.
- Cenários: sem filtro, filtro abrangente, ação que seleciona 1%, datas que
  selecionam 10% e usuário sem resultado.
- Até três páginas novas por consulta, encerrando quando `hasMore` é falso.
- Três execuções por combinação: 80 combinações e 240 comparações integrais de
  páginas, ordem, IDs, totais, contagens e `hasMore`.
- Alterações simuladas têm 500 caracteres em cada campo Antes/Depois, valor
  compatível com o limite do escritor atual. Todos os identificadores e e-mails
  são sintéticos.
- Compara também um protótipo offline da estratégia descrita abaixo, sem cache
  persistente, ACL real ou integração com a interface.

Os mapeadores do simulador preservam os campos das RPCs, mas usam ISO nas datas
para permitir comparação determinística. A formatação pública atual deve ser
preservada na implementação; este experimento não a valida.

### Resultado: 100 mil linhas, páginas de 100

As leituras incluem `getValues`; chamadas de metadados como `getLastRow` estão
registradas separadamente no JSON. Não são contagens completas de chamadas Google.

| Trilha / filtro | Páginas | Células atuais | Células do protótipo | Leituras atual → protótipo |
| --- | ---: | ---: | ---: | ---: |
| Log / sem filtro | 3 | 1.800 | 1.800 | 3 → 3 |
| Log / abrangente | 3 | 1.800.000 | 501.800 | 3 → 4 |
| Log / 1% | 3 | 1.800.000 | 678.218 | 3 → 4 |
| Log / datas 10% | 3 | 1.800.000 | 516.380 | 3 → 4 |
| Log / nenhum | 1 | 600.000 | 500.000 | 1 → 1 |
| Alterações / sem filtro | 3 | 3.000 | 3.000 | 3 → 3 |
| Alterações / abrangente | 3 | 3.000.000 | 503.000 | 3 → 4 |
| Alterações / 1% | 3 | 3.000.000 | 797.030 | 3 → 4 |
| Alterações / datas 10% | 3 | 3.000.000 | 527.300 | 3 → 4 |
| Alterações / nenhum | 1 | 1.000.000 | 500.000 | 1 → 1 |

No filtro abrangente de alterações, a redução de células é de **83,2%** para
três páginas; no filtro de 1%, **73,4%**. As páginas seguintes acrescentam apenas
suas faixas físicas, em vez de outra leitura completa do histórico.

**Contrapartida:** a construção inicial lê A:E e a primeira página exige outra
leitura. Para uma única página, consultas pequenas ou cache perdido, essa
chamada adicional pode anular o benefício em latência. Filtros muito esparsos
podem gerar faixas largas mesmo para páginas pequenas. Não substituir isso por
uma chamada por ID: até 500 chamadas por página seria uma regressão possível.

### Limites de cache demonstrados

- O índice de limites das 1.000 páginas de um filtro abrangente em 100 mil
  registros ocupa **124.782 bytes**, já acima de uma única entrada de cache.
- Com limite 500, são 200 páginas e **24.958 bytes** de índice.
- Uma página de 500 alterações simuladas ocupa **633.172 bytes**; uma página
  correspondente do log ocupa **100.672 bytes**. O formato de data do simulador
  e os dados sintéticos influenciam esses números.

Portanto, nem índices inteiros nem páginas completas devem presumir que cabem
em uma entrada. O CacheService limita valores a 100 KB e pode removê-los antes
do TTL. Consultar a [documentação oficial](https://developers.google.com/apps-script/reference/cache/cache).

### Concorrência reproduzida

Com 250 registros, foi lida a primeira página de 100. Após duas inclusões,
o offset 100 repetiu **dois IDs** na página seguinte. Isso ocorre porque a última
linha mudou entre as consultas. O prefetch pode esconder ou reduzir o intervalo
em alguns casos, mas não garante estabilidade.

O protótipo mantém a última linha do recorte inicial: nesse cenário, houve
**zero repetição**. Trocar dois IDs dentro de uma página também foi detectado
pelo hash da sequência de IDs, impedindo retorno de uma página divergente.

### Limitações das medições

Os tempos no JSON são medianas locais do Node, incluindo processamento e
materialização da planilha virtual. Excluem latência do Sheets, Apps Script,
ACL, OAuth, cache, transporte RPC e renderização. Não medem memória máxima nem
estabelecem ganho de latência ou limite seguro em produção.

Não sabemos, nesta etapa, o volume atual, taxa de crescimento ou duração real
das consultas da auditoria publicada. Esses dados devem orientar tamanho dos
blocos e orçamento da implementação. O limite de execução do Apps Script não
pode ser inferido dos tempos do Node; consultar as
[cotas oficiais](https://developers.google.com/apps-script/guides/services/quotas).

## Desenho recomendado

### 1. RPC versionada e compatibilidade

Adicionar `getAuditPageV2(request)` e leitor privado já autorizado. Manter as
RPCs atuais durante o piloto, incluindo contratos de chamadas diretas e
formatação dos DTOs. Esta RPC ainda não foi implementada.

Pedido:

```javascript
{
  type: 'log',            // 'log' ou 'changes'
  limit: 100,             // 100, 200 ou 500
  offset: 0,              // múltiplo do limite
  filters: { user: '', action: '', startDate: '', endDate: '' },
  snapshotId: '',         // vazio cria novo recorte
  forceRefresh: false,
  traceId: 'audit-query-001'
}
```

Resposta bem-sucedida mantém `rows`, `total`, `limit`, `offset`, `hasMore`,
`type` e as contagens quando aplicáveis. Acrescenta `snapshotId`, `createdAt`,
`expiresAt` e `paginationVersion: 2`.

O recorte fixa o universo e a seleção da consulta; não é cópia imutável de todo
o conteúdo das células. O contrato assume histórico acrescentado pelo aplicativo
e sem edição retrospectiva. Exibir discretamente o horário da consulta e manter
a ação explícita de atualização, que inclui registros novos.

### 2. Construção da consulta filtrada

1. Autorizar como administrador antes de consultar dados ou cache.
2. Validar tipo, limite, offset e filtros; resolver planilha/aba no servidor.
3. Capturar última linha e ID da aba. Não ordenar nem alterar schema.
4. Ler **A:E**: ambas as trilhas contêm ali ID, data, usuário, ação e módulo.
   Antes/Depois/Observação e ID de registro não são necessários para esses
   filtros, totais ou limites de página.
5. Percorrer de baixo para cima até a última linha capturada; aplicar a mesma
   normalização e os mesmos limites inclusivos de datas.
6. Calcular total, usuários/módulos distintos e, para cada página:
   `{ firstRow, lastRow, count, idDigest }`. O hash corresponde à sequência dos
   IDs que devem aparecer naquela página, na ordem atual.
7. Persistir apenas esses limites e metadados, divididos por tamanho, e retornar
   o conteúdo da primeira página com o mesmo mapeador público atual.

No protótipo, A:E é lido em uma faixa. Para volumes grandes, a implementação
deve permitir blocos contíguos e processamento incremental do resumo em memória.
O tamanho depende da medição no Apps Script: blocos menores limitam memória,
mas aumentam chamadas. Não garantir contagens parciais como se fossem completas.
Se a construção ultrapassar o orçamento, retornar erro/requerimento explícito
de período menor; uma continuação por gatilho ou armazenamento externo é fase
posterior, sujeita a novo desenho.

### 3. Leitura de página

Localizar o limite da página no índice; ler uma faixa contínua de `lastRow` até
`firstRow`, nas seis ou dez colunas. Inverter, filtrar, conferir quantidade e hash
dos IDs, mapear DTOs e devolver os mesmos totais do recorte.

Uma página sem resultado não lê corpo da aba. Faixas muito largas podem ser
lidas em blocos contíguos, com orçamento explícito de chamadas/tempo. Verificação
de contagem ou hash divergente invalida a consulta; não retornar uma página
parcial com os totais anteriores.

Esse algoritmo melhora o custo entre páginas, mas não elimina a primeira
varredura necessária para totais exatos e filtros textuais arbitrários. Eliminar
também esse custo exige um índice persistente ou outro armazenamento.

### 4. Caminho sem filtro

Continuar lendo somente a página. A nova RPC captura a última linha da consulta
e a reutiliza para calcular as faixas seguintes. Assim, novas inclusões não
deslocam o offset durante a navegação. Não construir índice filtrado nesse caso.

Preservar inicialmente as contagens de usuários/módulos da página. Transformá-las
em contagens globais é uma mudança separada de semântica e custo.

### 5. Cache, validade e falhas

- Identificador opaco aleatório; namespace versionado e chave ligada à
  identidade do administrador, planilha, aba, filtros normalizados e limite.
- Revalidar ACL em **cada** RPC e prefetch. Cache não representa autorização;
  confirmar o proprietário também no envelope da consulta.
- TTL proposto: cinco minutos, com validade absoluta. Não renovar indefinidamente
  ao navegar; usar o mesmo vencimento para manifesto e partes.
- Partes com no máximo **90.000 bytes UTF-8**, medidos depois de JSON; índices
  divididos por página, nunca por tamanho presumido ou número fixo de itens.
- Orçamento inicial proposto: **512 KiB por consulta**, sujeito a medição.
  Construções acima dele usam modo sem cache: reconstruir o resumo A:E a cada
  página para o mesmo limite superior de linhas, deixando a perda de otimização
  explícita na telemetria. Nunca truncar o conjunto ou falsear `total`.
- Gravar partes antes do manifesto. Parte ausente, erro de cache ou expiração
  torna a consulta indisponível; partes órfãs vencem sozinhas. Não gravar metadados
  em PropertiesService a cada página.
- Requisições simultâneas podem construir consultas independentes. Uma consulta
  publicada no cache é somente leitura; evita-se atualizar listas compartilhadas
  sob lock a cada página. A implementação não deve reaproveitar identificador
  durante reconstrução nem anexar partes de outra tentativa.
- Cache expirado ou divergir hash: resposta específica
  `{ ok: false, refreshRequired: true, reason: 'expired' }` ou `source_changed`.
  Não transformar perda de cache em ausência de registros.

Em falha ao criar cache, a primeira página ainda pode ser devolvida no modo sem
cache. Para isso, o contexto de continuação precisa ser um token assinado pelo
servidor, ligado ao proprietário, filtros, limite, planilha/aba, validade e última
linha; não confiar em limites fornecidos pelo cliente. A chave de assinatura é
configuração persistente única, não metadado por página. Caso esse fallback não
seja incluído no piloto, falhar explicitamente e manter a RPC antiga disponível,
sem afirmar estabilidade entre páginas no modo legado.

Manutenção que exclua/reordene/arquive registros deve mudar uma geração da fonte
e invalidar consultas antes da operação protegida. Novas inclusões não invalidam
o recorte existente; aparecem após atualização. Alterações manuais que conservem
IDs e filtros podem mudar o conteúdo sem disparar o hash: não prometer detecção
universal ou imutabilidade das células. A política para edição externa das abas
precisa ser definida antes de oferecer garantias mais fortes.

### 6. Cliente e prefetch

- Manter o estado por tipo, filtros, limite e **snapshotId**. Mudança de filtros,
  limite ou atualização cria consulta nova e invalida respostas antigas.
- Próxima/Anterior usa os limites da mesma consulta; prefetch envia o mesmo ID.
- No máximo um prefetch por próxima página, reaproveitando operação em andamento
  quando o usuário avança. Na criação inicial, só prefetch após obter o ID válido.
- Preservar `AUDIT_PAGE_REQUEST_ID` e verificações de aba, filtro, limite e objeto
  de cache; acrescentar identidade da consulta em sucesso, erro e prefetch.
- Em `refreshRequired`, cancelar prefetch, limpar páginas da consulta e voltar à
  primeira página com aviso de atualização. Não misturar páginas antigas e novas.
- Preservar a busca livre na página. Esclarecer seu alcance no rótulo em eventual
  melhoria de interface; torná-la pesquisa global exige novo contrato e leitura
  dos campos Antes/Depois/Observação.

## Validação prevista para implementação

- Equivalência de IDs, ordem, DTOs, datas inclusivas, texto normalizado, totais e
  contagens nas duas trilhas, incluindo schemas e IDs legados.
- 0, 1, limite-1, limite, limite+1 registros; 100/200/500 por página; final vazio.
- Filtros raros, ausência de resultado, datas inválidas e offset inválido.
- Append concorrente entre páginas e antes/depois do prefetch, sem repetição.
- IDs deslocados, geração alterada e fonte reduzida: invalidar sem dados parciais.
- Cache miss, partes incompletas, expiração antecipada, limites de bytes, orçamento
  ultrapassado, fallback sem cache e adulteração de token.
- Revogação de perfil entre páginas; ID de consulta de outra conta; nenhuma leitura
  protegida antes de autorizar e nenhum dado pessoal/valor de célula na telemetria.
- Troca de filtros/aba/limite durante consulta, sucesso/erro fora de ordem, clique
  simultâneo ao prefetch, atualização e expiração durante navegação.
- Sintaxe, lint, contratos frontend, `npm run verify` e cenários locais de navegador
  da auditoria. Fixtures locais não validam a implantação publicada.

Telemetria proposta: tipo/versão, etapa, duração, células/faixas lidas, linhas
examinadas/retornadas, bytes do índice, cache hit/miss, reconstrução, modo sem cache
e motivo técnico de expiração. Não registrar filtros, e-mails, IDs ou conteúdos.

## Ordem de entrega

1. Diagnóstico offline e contratos: esta etapa.
2. Instrumentação local do leitor atual; RPC V2 e simuladores, preservando APIs.
3. Integração local do cliente, cache/expiração e prefetch, com regressões.
4. Medições autorizadas no ambiente real, comparando primeira página e navegação,
   cache frio/quente, filtros abrangentes/raros e chamadas totais.
5. Publicação apenas mediante solicitação explícita e gates do repositório.

Arquivamento fica separado: definir retenção, backup recuperável, consulta ao
histórico e manutenção com geração antes de mover qualquer registro. O presente
desenho não torna o histórico inacessível nem introduz exclusão automática.
