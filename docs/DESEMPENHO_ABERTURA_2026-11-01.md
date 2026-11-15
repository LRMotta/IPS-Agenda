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

Pendente: conferir nos logs de produção `put_too_large` (`[CODEX_CACHE]`) e
`skip_oversize` (`[CODEX_AGENDA_REFERENCE_CACHE]`) antes de decidir sobre
gravação das referências em blocos e gatilho de aquecimento.
