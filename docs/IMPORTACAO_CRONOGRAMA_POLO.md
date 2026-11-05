# Importação do Cronograma de Avaliações pelo Polo Trial

## Fluxo

No Polo Trial, exporte o Flowchart do estudo em **CSV**. Em **Projetos > Cronograma de Avaliações > Importar CSV**, selecione o arquivo, informe o **nome do braço**, pré-visualize, confira as visitas e confirme a revisão.

Este fluxo substitui a extração por IA. O servidor ainda lê os rascunhos e o formato JSON anteriores, mas a interface não os oferece mais.

A exportação em Excel tem o mesmo conteúdo do CSV e não é aceita. Abrir e salvar o CSV em outro programa pode alterar a codificação; nesse caso, exporte novamente.

## O que é lido

`SharedSoAPlanningImport.html` localiza as linhas pelos rótulos da coluna "Nome da Visita", porque o número e a ordem das colunas variam entre estudos. Só estes campos saem do navegador: nome da visita, observações, intervalo, unidade, após, visita de referência e janelas.

Valores, custos e a matriz de procedimentos são descartados antes do envio. `soaPoloRows_` recusa qualquer outro campo. O conteúdo enviado é arquivado em `SoA_Planejamentos`, que usuários com leitura podem consultar.

## Identificação

A exportação não informa protocolo nem braço: o projeto é o que está aberto, e o braço é informado pela pessoa. As visitas ficam vinculadas a esse braço, que é criado se ainda não existir. Em um estudo com vários braços, importe o arquivo uma vez para cada braço.

Visitas já cadastradas são reconhecidas por código, nome ou alias, no mesmo braço ou entre as comuns a todos os braços. Elas mantêm ID, código, nome e escopo. No modo "Adicionar", são ignoradas; no modo "Atualizar", recebem a nova regra e os nomes do Polo como aliases.

Sem código no arquivo, ele é derivado do nome (`C1D1`, `Ciclo 2` → `C2`, `EOT`, ou as iniciais). Nomes usam `PT / EN` ou `EN \ PT`; o nome em português vira o nome padrão, e os demais viram aliases.

## Regras de cálculo

| Situação no arquivo | Resultado |
|---|---|
| "Após" = Visita, Randomização, Inclusão, Fim do tratamento, Última dose ou Progressão da doença, com intervalo e janelas válidos | Visita calculada |
| "Por demanda" usada como referência de outras visitas | Marco: a data vem da própria realização |
| Demais "Por demanda" | Manual |
| Janela ou intervalo negativos, janela ausente ou unidade diferente de dias e semanas | Manual |
| Fim do tratamento, fim do estudo ou acompanhamento | Manual, para conferir a referência com o protocolo |
| Visita que depende de uma visita manual | Manual |

Nas visitas manuais, a regra do Polo fica na observação. Janela 0/0 em "Por demanda" não é tratada como tolerância zero.

A visita de referência vem do arquivo. A exportação não informa se a contagem usa a data prevista ou a realizada, mas isso só muda as datas quando uma visita conta a partir de outra visita **calculada**:

| Situação | Contagem das datas |
|---|---|
| Escolhida na janela de importação | Gravada nas visitas calculadas, inclusive sobre a base do protocolo |
| Sem escolha, com Base padrão no protocolo | As visitas herdam a base do protocolo |
| Sem escolha nem base, referências a um marco ou evento fixo | Grava "Manter datas previstas", que dá o mesmo resultado |
| Sem escolha nem base, visitas encadeadas | Importação bloqueada até escolher na janela |

## Conferência entre prévia e gravação

A gravação compara o plano revisado com o plano recalculado dentro do lock: escolhas da janela, visitas, referências, janelas, escopo e braços a criar. Leituras que não alteram esse plano não invalidam a revisão. Se algo divergir, o log `[SOA_PREVIA_DIVERGENTE]` registra só o nome das partes alteradas: arquivo, escolhas, plano, projeto, braços ou visitas.

## Bloqueios

A importação não é aplicada, e nada é corrigido automaticamente, quando há:

- valor desconhecido em "Após";
- visita de referência inexistente ou referência circular;
- número inválido ou intervalo ausente;
- visita repetida;
- ciclo que não avança no tempo em relação ao anterior, como um intervalo digitado errado no Polo;
- braço inativo ou ambíguo.

Corrija no Polo Trial, exporte novamente e pré-visualize de novo.

## Limites conhecidos

- A ordem de visitas "Por demanda" segue a coluna do arquivo e pode ser ajustada depois.
- Uma coluna que representa uma visita repetida, como `C2 (D4 de cada semana)`, entra como uma única visita manual.
- A matriz de procedimentos não é importada. Em um dos estudos analisados, as marcações `P` não explicam o valor da visita, então seu significado precisa de revisão antes de qualquer uso.
