# Ciclo do medicamento na Farmácia

Implementação local das telas de estoque, ciclo do lote/posição, dispensação,
retorno e adesão, transporte e destinação. O visual mantém o sistema do app:
cabeçalho azul, Roboto, Material Symbols, cartões de situação, tabelas e formulários.
As abas do ciclo ficam no conteúdo da Farmácia; a barra inferior do mockup era
somente navegação da proposta.

## Procedimentos e escopo

Base funcional: PA 103 revisão 02; FG 172 revisão 01; FG 173 revisão 02;
FG 174 revisão 00; procedimento de segurança na prescrição/dispensação enviado
como PA 024 revisão 00; PA 010 revisão 06. A correspondência entre a numeração
PA 024/104 e PA 019/103 foi confirmada pelo usuário. Não foi feita alteração nos
documentos controlados.

Somente medicamentos classificados explicitamente como fornecidos pelo patrocinador,
em um estudo autorizado, usam as novas operações. O estoque comum e produtos sem
classificação mantêm seus contratos anteriores. Nenhum vínculo clínico, cronograma,
origem ou autorização é inferido a partir de nomes ou de saldos.

Permissões de consulta e gestão continuam as existentes: leitura no estudo/classe
autorizados. Dispensação, retorno/adesão e transporte (saída e chegada) exigem `operate`
ou `manage`; destinação final exige `manage`. A permissão do app não substitui delegação,
treinamento ou a documentação exigida pelo estudo.

## Situações e navegação

- Cartões filtram disponível, quarentena/bloqueio, dispensações, retornos,
  materiais vencidos/retornados aguardando destinação e todos os lotes/kits.
- Contagens de lotes/kits usam produto + lote + kit. Um mesmo lote pode aparecer
  em mais de uma situação; essas contagens não se somam.
- Aguardando avaliação permanece separado de quarentena. Não se transforma uma
  conferência operacional pendente em decisão clínica automática.
- Quantidades aparecem na unidade do produto. Não há total agregando unidades diferentes.
- O ciclo consolida saldos, linha do tempo, referências e contabilidade do mesmo
  produto + lote + kit em todas as posições, sem duplicar transferências internas.
  Retornos e chegadas têm registros próprios ligados à origem. O seletor de posição
  identifica a entrada usada em cada nova operação; a localização e a revisão
  continuam específicas dessa entrada. Validades divergentes são indicadas,
  sem escolher automaticamente uma delas.
- A referência de documento não representa upload, assinatura eletrônica ou substituição
  dos formulários e documentos originais do estudo.

## Operações

### Dispensação

Seleciona participação cadastrada pelo ID estável. A RPC de seleção expõe somente
ID e código do participante no estudo, sem nome, nascimento ou outros dados pessoais.
O vínculo de projeto legado explícito só resolve quando corresponde a um único
projeto do catálogo; cadastro duplicado ou vínculo ambíguo não autoriza dispensação.

Exige quantidade disponível, data, visita/ciclo informado, prescrição/Documento Fonte,
referência na plataforma do estudo e último dia previsto de uso. A mesma referência,
entrada de estoque e participante não podem duplicar uma dispensação. Uma operação
da plataforma pode identificar itens distintos sem ser recusada apenas por isso. O servidor
verifica validade para o período, unidade, quantidade e confirmação da conferência.
Baixa físico e disponível. Não prescreve, calcula dose, randomiza nem acessa IRT/Tasy.

### Retorno e adesão

O retorno aponta uma dispensação do mesmo escopo. Retornos acumulados não podem
exceder a quantidade dispensada; material ainda em transporte não pode retornar.
Exige confirmação da contagem e posição segregada cadastrada. Cria uma posição
`origin: return`, integralmente bloqueada, sem aumentar o saldo disponível da origem.
A liberação de produto retornado é recusada, inclusive pela RPC antiga de movimentação.

Adesão é opcional, exclusiva de controle por quantidade em comprimidos/cápsulas.
Exige confirmação de dose diária fixa e ausência de pausas/alterações no período.
O período começa na data da primeira dose e inclui a última data. Consumo estimado
é dispensado menos retornado acumulado. Resultado = consumo / (dose diária × dias).
Percentuais acima de 100% permanecem visíveis. O período deve ser compatível com
dispensação e retorno; outros esquemas exigem avaliação específica.

### Transporte

Registra operação (armazenamento, preparo/manipulação ou administração), quantidade,
datas/horários, termômetro, referências e temperaturas. A faixa deve corresponder
à conservação documentada no produto; ausência dessa faixa impede o registro.

Transporte para armazenamento exige destino cadastrado. Origem e destino são
derivados pelo servidor. A saída reserva o disponível, sem reduzir o físico. O DTO
expõe `inTransit`; a quantidade reservada não pode ser dispensada. Movimentação
manual e destinação da entrada ficam impedidas enquanto há reserva em trânsito.
Saída de estoque ativo fora da faixa é recusada para avaliação prévia.

Na chegada, a origem perde o físico transportado e uma nova posição é criada no
destino, preservando a quantidade e o kit. Excursão bloqueia a quantidade chegada;
não afeta indiscriminadamente todo o lote. Registra a ocorrência para avaliação
documentada, sem comunicação externa automática.

Transportes para preparo/administração exigem dispensação vinculada e não baixam
novamente estoque já dispensado. Não permitem que a mesma quantidade esteja em dois
transportes abertos. A chegada registra excursão, se presente na saída ou chegada,
sem modificar saldo que já saiu do IPS por dispensação.

### Destinação

Permite devolução ao patrocinador/ORPC ou descarte efetivamente documentado a partir
de saldo bloqueado ou pendente. Exige data, quantidade, motivo, autorização e
referência documental. Vencidos são baixados do bloqueado apurado na consulta,
preservando os eventos e buckets históricos. Não gera MTR, certificado de destruição,
solicitação de coleta ou comprovação de destinação por conta própria.

## Persistência, concorrência e segurança

Os eventos usam o mesmo cabeçalho do ledger da Farmácia, com tipo `LIFECYCLE`, prefixo
`FLC-` e `data.action`. São acrescentados sem reescrever registros anteriores.
Leituras não criam planilhas ou colunas. Posições de retorno/chegada são reconstruídas
do histórico, com ID do evento que as criou. Correção/exclusão de inventário com
histórico operacional é impedida.

`registrarCicloFarmacia()` autoriza o escopo sob lock, lê estado fresco, normaliza e
valida tudo antes da primeira escrita. Revisão obsoleta é recusada, exceto no retorno,
que é validado pela dispensação vinculada (mesmo escopo, acumulado e trânsito) e não pela
revisão da entrada de origem, pois não altera o saldo dela. A revisão da origem continua
avançando a cada retorno, para que o histórico gravado permaneça legível. A linha nova é
conferida contra a mesma releitura das consultas antes de ser gravada; se fosse recusada,
nada é gravado. Repetição idêntica
de `requestId` retorna o evento existente mesmo após novas movimentações, sem
duplicação. Reuso do identificador com outros dados falha.

### Lançamento retroativo

As operações seguem a ordem cronológica da entrada: nenhuma pode ter data anterior à
última operação já registrada nela. Retorno e chegada de transporte são a exceção, porque
não reduzem o disponível da origem e costumam ser lançados depois do fato. Eles aceitam a
data real, desde que o motivo seja informado, mesmo anterior à última operação. O registro e o documento de impressão
ficam sinalizados como **Lançamento retroativo**. O critério é apenas a data anterior
à última operação da entrada; um lançamento tardio que não a anteceda não exige motivo.
Retorno ainda não pode anteceder a dispensação, nem a chegada a saída; nada anterior à
entrada do produto é aceito.

O cliente preserva campos e identificador em falha. Navegação, atualização, troca de
estudo/classe e subseção pedem descarte de rascunho quando necessário. Respostas
obsoletas não alteram outro estudo, classe ou formulário. Referências e dados exibidos
usam escape HTML e atributos, sem interpolar entrada em manipuladores JavaScript.

## Validação local

- `tests/farmacia-ciclo.test.js`: saldo, autorização, locks, idempotência, vínculos,
  devoluções cumulativas, adesão, transporte, vencimento, destinação e kits.
- `tests/e2e/farmacia-cycle.test.js`: DOM real, filtros, abas, formulários, respostas
  obsoletas, preservação de operação, adesão, excursão e desktop/celular.
- `npm run verify` e `npm run test:ui` são os gates de conclusão local.

Todos os testes usam simuladores; não enviam e-mails, alteram prontuários, calendários,
planilhas ou arquivos reais. A entrega local não implica publicação do Apps Script.

## Documentos para impressão

Ações de impressão nas listas, linha do tempo e aba Documentos abrem uma prévia
com botão Imprimir / Salvar em PDF. Há registros de dispensação, retorno/adesão,
transporte (saída e chegada vinculadas), destinação e ficha consolidada do lote/kit.
Todos incluem campos de assinatura manual, nome legível e data. O autor do
lançamento é identificado separadamente da assinatura. Não seguem numeração FG.

A emissão usa exclusivamente a consulta autorizada já carregada, sem RPC, gravação
ou alteração de saldo. Atualize a consulta antes de emitir para incluir operações
recentes. Retornos acumulados e adesão respeitam o ponto do evento no ledger;
saldos da ficha são os da consulta, com localização e validade por posição.
Catálogo atual é identificado como tal. Não há arquivo imutável das emissões nem
assinatura eletrônica: preserve o PDF ou exemplar assinado. Reimpressões podem
refletir atualizações. As versões anteriores de formulários não são alteradas.

O cabeçalho segue a impressão da Agenda: logo, título e dados de emissão lado a
lado, com linha azul. O nome completo de CURRENT_ACCESS.name preenche o nome
legível da primeira assinatura, sem usar primeiro nome, e-mail ou autor histórico
como substituto. Sem nome cadastrado, o campo fica em branco. No transporte,
a assinatura de emissão é separada das assinaturas de entrega e recebimento.
Assinatura e data continuam manuais.
