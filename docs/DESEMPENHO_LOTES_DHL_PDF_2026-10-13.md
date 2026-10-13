# Otimizações locais de Agenda, Estoque, DHL e PDF

## Escopo e estado

Implementação local sobre o commit `5bd39f7`. Não há publicação, alteração de gatilhos reais, geração de documentos reais nem ativação do piloto PDF. Os testes usam simuladores de Sheets, locks, propriedades, HTTP e relógio.

## Exclusões e período da Agenda

- Itens excluídos na edição/exclusão de pedidos usam blocos contíguos em ordem descendente. Os IDs, as validações anteriores à escrita e as colunas legadas permanecem preservados.
- A exclusão de 50 itens contíguos foi verificada com uma chamada `deleteRows`, mantendo os itens de outros pedidos.
- Ao atualizar períodos, todas as escritas precedem uma leitura do intervalo necessário. O resultado é indexado pela posição original, inclusive com outros eventos intercalados. A leitura e a auditoria das alterações ocorrem antes das exclusões e da ordenação.
- As remoções mantêm auditoria individual por ID. Cada bloco concluído é auditado antes de excluir o bloco seguinte, inclusive se uma exclusão posterior falhar.

Esses testes demonstram redução de chamadas, não um ganho de latência medido em produção.

## Monitor DHL

- Teto absoluto de 45 consultas por execução, mesmo quando a chamada pede mais.
- Orçamento de 240 segundos, incluindo as leituras iniciais; reserva de 60 segundos antes de iniciar uma nova consulta. Após atingir o orçamento, os resultados já obtidos ainda são revalidados e persistidos sob document lock.
- Intervalo de 5.200 ms entre consultas preservado. A próxima consulta só começa quando cabe no orçamento; nenhum sleep ocorre sob lock.
- Reserva de execução com token em Script Properties, criada e liberada sob script lock curto. Reserva expira em sete minutos, permitindo recuperação após encerramento abrupto. Um executor antigo não pode liberar a reserva de outro.
- Cursor estável da última AWB consultada permite rodízio entre lotes. Falhas HTTP também avançam o rodízio; falha da etapa final de persistência não avança o cursor do lote. Não há agendamento novo por chamada: o gatilho existente continua a cada quatro horas.
- `verificados` informa as consultas realmente feitas; `restantes` e `interrompidoPorTempo` descrevem a execução parcial. Telemetria `bounded_batch` registra duração e quantidade, sem AWBs ou dados clínicos.

O orçamento deixa margem para o trecho de persistência, mas não constitui garantia contra indisponibilidade prolongada dos serviços Google. A reserva evita consultas simultâneas desse monitor sem impedir o uso da Agenda durante HTTP.

## Auditoria dos flush

Foram revisadas 52 chamadas: 39 em `WebApp.gs` e 13 em `TransporteCodexConfig.gs`. Duas foram removidas de `transportePdfPruneDuplicateAndOrder_`: eram barreiras intermediárias de visibilidade/duplicação/reordenação da cópia temporária. O único chamador conserva o flush depois de concluir a preparação, antes de verificar anonimização e exportar. Fontes, nomes, cópias, ordem, visibilidade e fontes tipográficas permanecem iguais.

As 50 restantes possuem justificativa local por chamada:

| Grupo | Dependência preservada |
|---|---|
| Projetos, recebimento, estoque e reservas | Persistência sob lock e/ou antes de invalidar referências; operações opcionais relêem Jornada. |
| Agenda e status | Conferência de valores, versões devolvidas ao cliente, auditoria, ordenação e invalidação de índice. |
| Monitores de entrega/confirmação | Persistência final do lote antes de invalidar o índice e liberar o lock. |
| Configuração | Persistência antes de liberar o lock para outro escritor. |
| Transporte e limpeza | Sincronização, fórmulas e releitura do bootstrap. |
| PDF e cópias temporárias | Leitura exibida, cópia externa, validação de manifesto, anonimização, locale e exportação HTTP. |

Não se presume um custo fixo por flush; a economia das duas chamadas deve ser medida na geração real de PDFs.

## Piloto PDF preparado e desativado

O fluxo principal atual pede o exportador HTML institucional. O piloto abaixo afeta apenas o caminho Google Sheets; não reduz as esperas da cópia temporária.

Script Property de habilitação: `REQ_EXAMES_PDF_RETRY_ONLY_PILOT_V1=true`. Ausência, outro valor ou falha ao ler a configuração mantêm a espera inicial de 900 ms. Somente com o opt-in, a primeira consulta do exportador Sheets não espera; o backoff após HTTP transitório e a validação de tamanho/tipo do PDF permanecem. O fallback por cópia temporária conserva sua espera mesmo com o piloto ativo.

A telemetria `reqExamesPdf` registra `initial_wait`, `fetch_N` e `retry_wait_N`; não registra URL, token, nome de arquivo ou conteúdo clínico.

### Procedimento de piloto após autorização de publicação e geração real

1. Publicar com o gate habitual; manter a propriedade desativada.
2. Medir baseline no caminho Sheets, distinguindo esse caminho do HTML principal e da cópia temporária.
3. Ativar o piloto explicitamente para um conjunto pequeno de requisições revisadas pela equipe. Manter as mesmas entradas para comparar duração, tentativas, taxa de fallback e conteúdo exibido no PDF.
4. Conferir datas, exames, protocolo e identificação no PDF; resposta HTTP 200 e tamanho correto não comprovam conteúdo atualizado.
5. Em conteúdo incompleto/desatualizado, erros ou aumento de fallback, remover a propriedade ou mudar para `false`. A cópia temporária permanece protegida pelas esperas atuais.

Esses fluxos criam arquivos e rascunhos reais. A execução do piloto depende de escolher as requisições e autorizar esses efeitos; não foi realizada durante os testes locais.

## Código do cliente

`node tools/audit-client-payload.js` inventaria os includes por rota, preservando a ordem de `Index.html`. Não executa RPCs nem usa dados de pessoas.

| Rota | JavaScript inline nos includes locais |
|---|---:|
| Agenda | 1.027.348 bytes |
| Dashboard | 1.098.577 bytes |
| Estoque | 1.260.197 bytes |

São bytes de código-fonte antes da geração do HTML e da compressão, excluindo bootstrap inline de `Index.html`, CDN e dados injetados. Não são bytes transferidos nem tempo de abertura. A Agenda já exclui Estoque e Dashboard; Transporte usa template próprio. Core e Agenda são a maior parte do código comum.

Não houve separação adicional de módulos nesta entrega. O próximo diagnóstico deve medir geração do HTML, transferência, processamento do JavaScript, RPC de bootstrap e renderização nas mesmas condições. Só então escolher uma separação que preserve ordem de inicialização, autorização, handlers públicos, rotas diretas e respostas assíncronas.

## Validação local

- `npm run verify`: sintaxe, regras geradas, lint e 1.287 testes Node aprovados.
- `npm run test:ui`: 104 testes de interface aprovados em ambiente isolado.
- Casos novos: exclusões contíguas/intercaladas, vizinhos preservados, auditoria de blocos concluídos, IDs do período, teto/tempo/cursor/concorrência DHL, recuperação de reserva expirada, liberação em erro e piloto PDF conservador.
