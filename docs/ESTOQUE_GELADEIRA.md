# Geladeira do Estoque

O Estoque de kits de coleta e bulk supplies não está em uso e fica congelado por padrão. A chave está em `EstoqueGeladeira.gs`. A Farmácia tem estoque próprio e não é afetada.

## Enquanto congelado

- O menu Estoque some, e as rotas `?page=estoque`, `?page=pedidos` e `?page=estoque-view` abrem a Agenda.
- Agenda: novos agendamentos não mostram kits. Agendamentos com kit gravado mostram o valor somente para consulta, e salvar o preserva. Reserva e baixa ficam ocultas, sem consultas a Movimentações e Reservas_Kits.
- Jornada, Dashboard e Pendências deixam de ler o Estoque e ocultam kits, o bloco de indicadores e "Kits vencendo".
- As RPCs do módulo recusam a operação no servidor, inclusive em abas abertas antes do congelamento.

## O que continua ativo

- Cancelar uma visita cancela suas reservas de kit, mantendo Reservas_Kits coerente para quando o módulo voltar.
- `getEstoqueConfig` segue disponível, pois equipamentos e medicamentos usam as localizações.
- A replicação do Cronograma ainda lê o catálogo da aba Itens.
- O diagnóstico administrativo continua verificando as abas.

Nenhuma aba, dado ou histórico é apagado.

## Religar e congelar

No editor do Apps Script, com usuário administrador, execute `religarEstoqueModuloAdmin` ou `congelarEstoqueModuloAdmin`. A mudança vale sem nova publicação, depois de recarregar a página. A propriedade de script usada é `ESTOQUE_MODULO_CONGELADO` (`true` ou `false`); sem ela, vale o padrão do código.

Reservas ativas ficam como estão durante o congelamento. Ao religar, confira as que tenham visitas já passadas.

## Testes

Os testes do módulo carregam `WebApp.gs` sem `EstoqueGeladeira.gs` e, por isso, exercitam o Estoque ativo. O comportamento congelado está em `tests/estoque-geladeira.test.js`.
