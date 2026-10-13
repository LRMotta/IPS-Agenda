# Marcos da participação e continuidade de ciclos

Em Cadastros → Participantes, cada participação possui a seção **Marcos desta participação no estudo**: randomização, inclusão, última dose, fim do tratamento, decisão de interrupção definitiva, progressão e outra referência. São datas opcionais; os dados são os mesmos consultados em Jornada → Prévia CTMS → Marcos e escolhas.

Os marcos pertencem ao cadastro da participação, identificado pelo ID cadastral, e não ao ID Pessoa. Nova participação começa com marcos vazios. As datas não são herdadas de outro estudo, inferidas a partir do status ou preenchidas pelo importador do protocolo.

Campo omitido pelo cliente preserva o valor atual. O formulário envia somente os marcos alterados; apagar explicitamente um campo remove aquele marco, preservando os demais. Uma edição concorrente do mesmo marco exige reabrir o cadastro; mudança de um marco não editado não é sobrescrita. A validação de datas ocorre antes de qualquer escrita de dados ou schema. A consulta dos detalhes não cria colunas.

Sem uma referência documental, o cálculo das visitas dependentes fica pendente. O motor pode usar um marco de visita realizada já documentado e inequivocamente associado, conforme as regras existentes. Agendamentos e visitas realizadas continuam preservados; o cadastro manual permanece utilizável. Não há substituição automática de randomização por inclusão, ou de decisão de interrupção por última dose/fim do tratamento.

## Ciclos além do quadro inicial

Quando o protocolo prevê continuidade (por exemplo, repetir ciclos até um critério de interrupção), use o ciclo-modelo e **Replicar ciclo** para criar lotes definidos, como 2–12, e amplie quando necessário. Códigos e referências são remapeados, preservando braços, intervalos, tolerâncias e bases de cálculo. Previsões só são calculáveis quando o marco inicial e as referências estão disponíveis. A replicação não cria agendamentos clínicos automaticamente.

A quantidade de ciclos do orçamento não é necessariamente o limite clínico. Se a extensão não estiver definida na documentação disponível, obter a regra do estudo e registrar sua origem nas observações do modelo antes de replicar. Não prolongar o calendário por suposição. A extração JSON preserva recorrências ainda não representáveis como pendências; não gera quantidade infinita de visitas.

Informar última dose, decisão de interrupção e fim do tratamento mantém as referências corretas para visitas terminais. Nesta etapa esses campos não cancelam nem removem automaticamente ciclos, previsões de tratamento ou eventos previamente cadastrados; encerramento e revisão do calendário continuam explícitos.
