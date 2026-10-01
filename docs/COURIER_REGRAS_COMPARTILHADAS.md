# Regras compartilhadas de courier

As regras operacionais de datas, feriados e temperaturas têm fonte única em
`tools/courier-rules-core.js`. `npm run rules:generate` atualiza os blocos marcados
em `SharedCourierRules.html` e `CourierServerRules.gs`, além das regras da Agenda.
`npm run rules:check`, incluído em `verify`, detecta divergências sem escrever.
Não edite os blocos gerados diretamente.

## AWB

A normalização mantém os formatos aceitos, remove separadores conforme a courier
e não corta o identificador. Comprimento excedente deve ser rejeitado pela
validação, inclusive no servidor antes de gerar documentos. Os inputs não usam
`maxlength`, para que uma colagem excedente permaneça visível e seja validada.
PINEX e couriers livres removem espaços apenas nas extremidades. O auxiliar
direto de OCASA aceita o mesmo formato normalizado no cliente e servidor.

As exceções de obrigatoriedade para DHL e PINEX (Agendamento), o contexto
documental e o rastreamento `awbTouched` permanecem preservados. As funções de
AWB do servidor continuam em `WebApp.gs`; sua equivalência com o cliente é
coberta pelos testes de Transporte e `tests/courier-rules-review.test.js`.

## Índice de feriados

`createHolidayIndex(holidays)` prepara datas específicas e recorrências anuais
por mês/dia, preservando ordem, flags e registros originais. Os consumidores
podem passar o índice a `holidayItemsForDate` e `operationalRisk`; arrays legados
continuam aceitos. O índice é um retrato da avaliação atual: refaça-o após mudar
as referências. Não serialize nem mantenha o índice em cache permanente.

Os alertas da Agenda preparam um índice por avaliação e o reutilizam para os
couriers e datas. O dia pós-feriado continua sendo o dia de calendário
imediatamente seguinte. Recorrências de 29 de fevereiro valem somente em anos
bissextos. A classificação de temperaturas congeladas permanece igual.

`activeHolidayMap(holidays)` mantém as chaves legadas do ano cadastrado.
`activeHolidayMap(holidays, year)` filtra datas específicas para o ano indicado e
expande recorrências anuais válidas nesse ano. O fluxo de alertas usa o índice,
não esse mapa auxiliar.

## Validação e desempenho

Regressões cobrem AWB excedente sem perda de caracteres, equivalência dos
auxiliares, flags, ordem, recorrência anual, bissextos, renovação do índice e
sincronização dos blocos. Os testes de interface exercitam colagem e correção de
AWB nos formulários locais de Agenda e Transporte, com RPCs simuladas e rede
bloqueada.

No cenário com 100 feriados e quatro avaliações, a criação de objetos de data
caiu de 816 para 104 com o índice reutilizado. Essa contagem comprova redução de
trabalho local; não mede latência nem chamadas a serviços Google em produção.
