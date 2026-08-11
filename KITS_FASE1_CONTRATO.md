# Kits de coleta — contrato da Fase 1

Este documento registra o comportamento existente antes da introdução de reservas,
transferências entre localizações e perfis de visitas. Ele funciona como contrato de
caracterização para as próximas fases.

## Comportamento atual preservado

- A Agenda recebe somente kits de coleta com saldo positivo (ou saldo ausente),
  excluindo itens de exames/serviços.
- Os kits da Agenda são filtrados pelo projeto e exibidos em ordem alfabética do
  rótulo que combina descrição, validade e quantidade.
- O estoque consolida linhas pela combinação de projeto, descrição, tipo, validade,
  localização e status. Portanto, lotes com a mesma validade em localizações
  diferentes continuam sendo saldos distintos.
- A visualização consolidada soma os lotes do mesmo item e mantém a lista detalhada
  de lotes para exibição.
- A baixa atual da Agenda registra uma unidade por item selecionado e identifica a
  movimentação pelo evento da Agenda quando esse metadado está disponível.
- Uma baixa já registrada para o mesmo evento não deve ser repetida; a devolução
  registra uma operação complementar.

## Critérios de aceitação para as próximas fases

1. A ordem configurável de kits será uma regra explícita por projeto/uso e não uma
   alteração silenciosa da ordenação alfabética legada.
2. Uma transferência entre Estoque Principal e Laboratório terá origem, destino,
   lote, quantidade e identificador de operação compartilhado.
3. Reserva não reduzirá o saldo físico; o sistema exibirá físico, reservado e
   disponível separadamente.
4. Uma reserva ficará vinculada ao evento real da Agenda, mesmo quando o nome da
   visita não estiver mapeado ao SoA.
5. A baixa futura deverá identificar explicitamente o lote e a localização escolhidos;
   não poderá depender da primeira linha encontrada para um `ID_Item`.
6. Aliases e perfis de visita poderão sugerir kits, mas correspondências ambíguas
   exigirão confirmação humana.
7. Eventos históricos sem identificador técnico poderão receber um ID interno sem
   alterar o nome, a data ou os demais valores exibidos ao usuário.

## Decisões confirmadas para a implementação

- localizações iniciais: `Estoque Principal` e `Laboratório`;
- margem mínima de validade: 10 dias antes da visita;
- a reserva será limitada às visitas cuja data esteja coberta por algum lote válido;
- o cancelamento não libera a reserva automaticamente;
- o controle atual é por lote/validade; `Accession Number` permanece uma extensão futura.

## Decisões de negócio ainda abertas

- comportamento quando nenhuma validade cobre a data da visita;
- perfis autorizados a transferir kits entre localizações;
- possibilidade de reservar um lote com exceção justificada;
- formato futuro e escopo do `Accession Number`.

Enquanto essas decisões não forem confirmadas, as próximas implementações usarão
valores configuráveis e não fixarão os nomes ou prazos diretamente na interface.
