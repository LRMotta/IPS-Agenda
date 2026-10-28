# Transporte IV na Agenda

O Transporte IV é um quarto envio independente no mesmo agendamento e segue as
regras dos Transportes II e III: courier, laboratório destino, temperatura,
status, AWB e material biológico próprios, documentos por slot, AWB única,
pendências, cobrança por e-mail, auditoria, versão do registro e Dashboard.

## Interface e agendamento

- O bloco vazio começa recolhido e abre por `Adicionar Transporte IV`. Ele
  também aparece quando o Transporte III tem dados ou quando o IV já está
  preenchido, como o III faz em relação ao II.
- `Gerar docs` do IV usa o slot `4`; a referência de acompanhamento é
  `IPS-TRP-<id>-T4` e o rótulo apresentado é `Transporte IV`.
- Backup I e Backup II podem usar o Transporte IV vazio de uma visita futura
  elegível, além dos Transportes II e III. O vínculo registra `slot: "IV"` e a
  AWB do IV é sincronizada para o backup vinculado.

## Persistência e compatibilidade

As colunas são opcionais e identificadas pelo cabeçalho, sem posição fixa:
`Transporte IV - Courier`, `- Temperatura`, `- Status`, `- AWB`, `- Material`,
`- Destino` e `- Material estruturado`. O caminho de escrita autorizado
(`getAgendaSheet_`) acrescenta as sete colunas ao fim da aba; leituras
(`getAgendaSheetForRead_`) apenas as localizam. Sem o conjunto completo de
cabeçalhos, o Transporte IV é um slot vazio e indisponível: nada é criado nem
gravado e `courier4` volta vazio. Os índices ausentes valem `-1`.

Payloads legados que omitem `courier4` preservam o Transporte IV existente. A
versão do registro e a das edições de campos só incluem o IV quando as colunas
existem, portanto registros e clientes legados mantêm as mesmas versões. As
colunas do IV passam a compor essas versões e a auditoria a partir de então.

## Validação local

`tests/agenda-transporte4.test.js` cobre schema ausente, criação única das
colunas, localização por cabeçalho, preservação por payload legado, vínculo de
Backup, AWB do slot 4 e pendências. `tests/e2e/agenda-client.test.js` cobre o
bloco, o payload `courier4`, a restauração na edição e o botão `Usar Transporte
IV`, em desktop e celular.
