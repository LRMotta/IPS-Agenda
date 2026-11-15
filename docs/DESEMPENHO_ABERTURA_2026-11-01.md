# Abertura da Agenda — medição e instrumentação (01/11/2026)

## Linha de base (versão 326, perfil admin, Chrome, domingo)

| Medição | Mediana | Faixa |
| --- | ---: | ---: |
| `doGet` até o primeiro byte | 5,1 s | 3,8–5,4 s |
| RPC `getAppBootstrapData` | 8,0 s | 5,4–10,3 s |
| Pronto com dados | 14,7 s | 12,7–17,4 s |

Página principal: ~423 KB comprimidos. Resposta do bootstrap: ~369 KB.
Etapas do bootstrap numa carga com janela fria: `access` 1,6 s,
`date_index` 1,9 s, `row_read` 0,8 s (112.710 células para 130 eventos),
`hydrate` 1,4 s. Referência fria: ~8 s adicionais.

## Instrumentação do doGet

Logs `[CODEX_PERF]` com `operation: doGet` e um `traceId` por abertura:

- `access`: autorização, com `cacheHit`/`cacheMiss` da ACL.
- `template`: `createTemplateFromFile`.
- `canary_flag`: leitura da propriedade da janela (somente página principal).
- `evaluate_<rota>`: avaliação do template (`index`, `dashboard`, `estoque`, `transporte`).
- `includes_<rota>`: parte do evaluate gasta nos `include()`; `rowCount` é a
  quantidade de includes. Não somar com `evaluate_<rota>`.
- `total`: duração medida dentro do `doGet`. A diferença para a duração da
  execução no painel do Apps Script é a inicialização do runtime.

## Cache da ACL na abertura

`codexGetAllowedUsersForPageLoad_` mantém o mapa de Users no `CacheService`
por 300 s (`CodexPageLoadAcl:v1`). Decisão de produto: com cerca de 20
usuários e poucas mudanças de permissão, uma revogação pode levar até o TTL
para valer **somente na abertura da página** (`doGet` e etapa `access` de
`getAppBootstrapData`).

- Mutações, leituras protegidas e demais RPCs continuam lendo Users.
- O cache só libera: usuário ausente ou inativo no cache é confirmado com
  leitura atual de Users, que também renova o cache.
- `salvarMeuPerfil`, `salvarPerfisUsuariosAdmin`, `salvarUsuarioAdmin` e
  `inativarUsuarioAdmin` invalidam o cache. Edições manuais na planilha valem
  após o TTL.
- `CODEX_CACHE_BYPASS_READS_` ignora a leitura do cache.

Os ganhos em produção precisam ser medidos após publicação.

## Ajustes de 15/11/2026

Decisão de produto: a planilha não é editada diretamente pelos usuários.

- `AGENDA_DATE_INDEX_CACHE_TTL_SECONDS_` (60 s) e
  `AGENDA_WINDOW_CACHE_TTL_SECONDS_` (45 s) passaram a 300 s. Escritas da
  Agenda pelo Web App continuam invalidando ambos; `forceRefresh` (atualização
  explícita e revalidação do cliente após 3 min) continua ignorando o cache.
  Uma edição manual na planilha pode levar até 5 min para aparecer na abertura.
  O cache de últimas visitas usa o mesmo TTL.
- `vincularReservaKitAgenda` (ao gerar o ID de um evento legado) e
  `verificarNotificacoes_` (ao gravar o controle do Lab Central) passaram a
  invalidar o cache de janelas.
- Novo Agendamento: a abertura só revalida referências vencidas
  (`AGENDA_FORMDATA_TTL_MS`, 10 min) em vez de forçar a cada clique. Cadastros
  feitos por outro usuário podem levar até esse prazo para aparecer nas listas;
  o salvamento continua validado no servidor.
- Clique durante a carga inicial (`APP_BOOTSTRAP_PENDING`, bootstrap da janela
  ou carga legada do formulário em voo) aguarda as referências em vez de acionar
  a carga completa, que desligava a carga por janela pelo resto da sessão.
- `preencherAgendaSelect` monta cada lista com uma única atribuição de HTML.

### Medição nos logs de produção (versão 372, abertura fria de 14/11, 13:14)

| Execução | Painel | Medido no código |
| --- | ---: | ---: |
| `doGet` | 6,4 s | 2,9 s (`access` sem cache 2,3 s; `evaluate` 0,4 s) |
| `getAppBootstrapData` | 18,6 s | 15,1 s |
| `getAgendaReferenceDataBackgroundRevalidate` | 31,4 s | 28,4 s |

- Custo fixo por chamada: `getAppRuntimeInfo`, que não lê planilha, levou em
  média 2,8 s (41 execuções, 1,8–3,9 s). A diferença entre painel e código nas
  linhas acima (~3,5 s) é o mesmo custo. A causa não foi isolada.
- Bootstrap frio: `reference` 9,1 s, `date_index` 1,6 s, `row_read` 0,3 s,
  `hydrate_convert` 1,9 s (141 eventos), `hydrate_participant_index` 0,6 s.
- Tamanho dos caches: referências com 72.995 bytes (limite de 95.000,
  `stored`); janela com 250 KB em 3 blocos. Nenhum `skip_oversize` ou
  `put_too_large` nessas execuções; gravação das referências em blocos não é
  necessária hoje.
- A revalidação em segundo plano reconstruía todas as listas logo depois de o
  bootstrap frio tê-las lido. Agora `agendaGetReferenceData_` grava o marcador
  de revalidação quando nenhuma lista veio do cache de partes.
- `hydrate_convert`: cada linha fazia de 12 a 16 chamadas de serviço para
  formatar data, nascimento e hora. `codexFormatDateMemo_` reaproveita o
  resultado por instante e padrão dentro da mesma execução.

### Versão 374 e bootstrap embutido no doGet

Medido na versão 374 com caches quentes: `getAppBootstrapData` com 1,7 s e
3,3 s de código (5,4 s no painel), `hydrate_convert` 0,6 s, revalidação
completa 13,7 s. O restante é o custo fixo por chamada.

Por isso o `doGet` passou a embutir o bootstrap na página
(`codexDoGetInlineBootstrap_`, etapa `inline_bootstrap` com `cacheHit`):

- Somente na página principal da Agenda, com a carga por janela ativa, e
  somente quando as referências e a janela inicial já estão no `CacheService`.
  Nunca lê referências ou eventos das planilhas; sem cache completo devolve
  `null` e a abertura segue pela RPC `getAppBootstrapData`, como antes.
- Os dados são os mesmos que a RPC devolveria desses caches (mesmo formato e
  mesma revisão), com o mesmo acesso de abertura (`codexGetPageLoadAccess_`).
- O cliente só os usa se o período for o que ele próprio pediria
  (`appInlineBootstrapUsavel_`); caso contrário faz a RPC.
- Custo: com cache quente a estrutura da página chega depois (o `doGet` abre a
  planilha para conferir a última linha e envia cerca de 0,4 MB a mais). Com as
  referências em cache e a janela vencida, o `doGet` gasta essa conferência e
  ainda segue pela RPC.

Ganho esperado: uma chamada a menos por abertura quente (cerca de 3 s). Ainda
não medido em produção.

Não implementado: gatilho de aquecimento. Os gatilhos existentes já consomem
cerca de 2 h por dia (`monitorarConfirmacoesCourierAgendadas` leva de 45 a
130 s a cada 15 min); aguarda decisão.
