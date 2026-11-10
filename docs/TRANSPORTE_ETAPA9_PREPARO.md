# Etapa 9: preparo (nada foi removido)

Escopo combinado com o usuário em 2026-11-09: **só preparar**. O módulo continua só para admin, a janela antiga e o
"Gerar PDF" pela planilha continuam, e nenhuma função foi removida. Layouts congelados (`TransporteLayoutsDados.html`)
ficam; as rotinas `diagnosticar*` que leem a planilha saem **na hora da remoção**, não antes.

## 1. Comparar PDFs e e-mails novos com os atuais (só em produção)

Precisa de envios reais, então fica para depois dos testes do usuário:

- PDFs: `diagnosticarDocsDadosLoteTransporteHtml*` compara a geração em memória com a da planilha (ainda existem).
- E-mails: não há comparador automático. Comparar o rascunho novo (passo "Gerar") com o do fluxo antigo, courier por
  courier, e conferir as cores do e-mail OCASA (o xlsx exportado não entregou as cores com segurança).
- Itens para o usuário conferir: MARKEN, OCASA nacional e internacional, DHL ambiente e congelado, PINEX (as duas fases),
  visita com vários transportes, sair e retomar, duas pessoas no mesmo envio, formulário ANVISA e e-mail de peticionamento.

## 2. Abrir a todos (não feito)

Hoje o acesso é admin em dois lugares, que precisam mudar juntos:

| Onde | O que fazer na abertura |
|---|---|
| `SharedAccessRules.html` (`ADMIN_ONLY_MODULES`) | retirar `transporte-central` |
| `IndexContent.html` | o item `navTransporteCentral` deixa de ser `admin-only` e substitui "Transp. Amostras" |
| `IndexCoreScripts.html` (`irPara`, `applyAppBootstrapData`) | retirar o bloqueio e o mapeamento admin do item |
| RPCs novas (`TransporteTarefas.gs`, `TransporteEnvio.gs`, `TransporteEnvioGerar.gs`, `TransporteMateriais.gs`, `TransportePeticionamento.gs`) | trocar `codexAssertAdmin_()` pelo perfil que poderá preparar (mínimo: quem escreve no Transporte) e ajustar `tests/transporte-central-contratos.test.js` |
| Peticionamento | item próprio, só para a lista `Autorizado a peticionar`, sem exigir admin e sem abrir o resto (proposta pendente de decisão) |
| Pontos que abrem a janela antiga: `abrirTransporteModulo` em `IndexContent.html`, `IndexAgendaScripts.html` (2 chamadas) e `IndexPendenciasScripts.html` | apontar para a página nova (abrindo o envio pelo `agendaId` e slot) |

## 3. Funções que ainda usam `getTransporteSpreadsheetCodex_` (45 usos)

**O fluxo novo não as chama nos caminhos normais.** Tocam a planilha só por fallback, quando o cadastro principal falha:

- `transporteProjetoInfo_` e `transporteProjetoInvestigadorMap_`: usam a aba Projetos da planilha de Transporte se
  `transporteReadProjetosDireto_` vier vazio ou falhar. Remover o fallback é seguro se Projetos estiver sempre disponível.
- `transporteValidarEntradaAwbOcasa_`: só lê a planilha quando o payload traz `envioId` (envio manual sem Agenda), que não existe no fluxo novo.
- `transporteCodexFindComunicadoEspecial_`: o fluxo novo passa uma planilha vazia; a aba Protocolos tem só 2 links diretos de CE
  (o resto sai pela busca por nome na pasta). Decidir se esses 2 links migram para o cadastro de Projetos.

**Só da tela antiga (saem com ela):** `salvarTransporteInterno_`, `transporteReadRegistro_`, `gerarPdfTransporteInterno_`,
`imprimirTodasAbas_`, `concluirDocumentosTransporte`, `criarRascunhoEmail_`, `transporteValidarManifestoPdf_`,
`transporteSincronizarDependencias_`, `performContentDeletion_`, `manageSheetVisibilityUnified_`, `transporteAwbPreservarFormulario_`,
`transporteCeStatus_`, `transportePdfActualSheetName_`, `transporteCodexGetSheet_` (default) e as rotinas `atualizar*`
que preenchem abas (Declaração, Invoices, Petições, Formulário PINEX, volumes MARKEN, etc.).

**Diagnósticos e ferramentas (saem na remoção, por decisão do usuário):** `diagnosticarDocsDadosTransporteHtml`,
`diagnosticarDocsDadosLoteTransporteHtml*`, `diagnosticarGradeTransporteHtml*` (`TransporteDocumentosGrade.gs`),
`exportarImagensLayoutTransporteHtml` (precisa da planilha para gerar `TransporteLayoutsDados.html`; só se mantém enquanto o
layout puder precisar ser regenerado, então decidir com o usuário se a exportação de layouts continua).
`transporteDocsMemoriaPreparar_` ainda cai nas abas reais quando a memória falha (tela antiga).

Observação: `getTransporteSpreadsheetCodex_` também é usada por `transporteDocsDados_` apenas para bloquear o acesso durante a
geração em memória (`TRANSPORTE_LAYOUTS_BLOQUEIO_PLANILHA_`); esse bloqueio pode ficar como proteção ou sair junto.

## 4. Testes que deixam de valer com a tela antiga

Cerca de 490 testes em 37 arquivos `transport*`, dos quais os da tela nova (`transporte-*` criados nas Etapas 2 a 8) permanecem.
Dependem da planilha ou do fluxo antigo (a reescrever ou remover, sem enfraquecer regras):

- `transport.test.js`, `transport-document-review.test.js`, `transport-idempotency.test.js`,
  `transport-review-regressions.test.js`, `transport-slots-generation.test.js`, `transport-special-boxes.test.js`,
  `transport-temperature-consistency.test.js`, `transport-email-workflow.test.js`, `transport-performance-laps.test.js`,
  `transport-data-review.test.js`, `transport-bootstrap-referencias.test.js`;
- `transporte-documentos-grade.test.js`, `transporte-layouts-modelo.test.js`, `transporte-pdf-formato-html.test.js` (diagnósticos e modo sombra);
- `awb-contexto-focado.test.js` e `awb-uniqueness.test.js` (partes que passam pela tela antiga);
- interface: `e2e/transport-client.test.js`, `transport-client-regressions.test.js`, `transport-identification-message.test.js`;
- referências pontuais em `agenda-client-review`, `agenda-windowing`, `agenda-history`, `client-state-review`, `pendencias-client`,
  `rpc-public-authorization`, `server-authorization`, `webapp-api-token`, `agenda-leituras-compartilhadas`, `matbio-core`.

Regras de negócio que esses testes protegem e que precisam continuar cobertas pelos testes novos: unicidade de AWB,
caixa especial por projeto, temperatura confirmada no PDF e no rascunho, volumes que não cabem na Declaração,
identificação do participante e recuperação da geração por token.

## 5. Ordem sugerida da remoção (depois dos testes reais aprovados)

1. Abrir a todos e trocar os pontos de entrada pela página nova (itens da seção 2), publicar e conferir.
2. Remover a janela antiga (`TransporteApp.html`, `abrirTransporteModulo`, `?page=transporte`) e o "Gerar PDF" pela planilha.
3. Remover as funções da seção 3 e os diagnósticos, rodando `npm.cmd run verify` a cada bloco.
4. Reescrever ou remover os testes da seção 4, sem enfraquecer regras.
5. Desativar a planilha de Transporte (ID em propriedade do script e configuração) e limpar `.claspignore`/documentos que a citam.
