# Farmácia no IPS | UCS — etapa 0
Data: 25/09/2026. Estado: levantamento técnico concluído; decisões operacionais e validação da equipe pendentes.

## 1. Resultado e escopo

Recomenda-se uma seção própria de Farmácia, começando por consulta de orientações revisadas. Manter inicialmente o Google Sheets farmacêutico separado, com integração explícita por IDs, evitando misturar seu estoque ao de kits de coleta.

Esta entrega contém inventário, dicionário de dados, diagnóstico das fórmulas e vínculos, proposta de acesso, transição, backup e critérios para o piloto. Não implementa o módulo, não corrige a fonte, não importa registros e não publica o app.

O usuário informou que a separação de acesso por estudo/cegamento ainda precisa ser definida. A validação será da equipe de Farmácia, sem pessoa responsável designada. Nenhuma dessas decisões foi presumida como aprovada.

Documento complementar: [Mapa de estudos e vínculos](FARMACIA_MAPA_ESTUDOS_2026-09-25.md).

## 2. Fontes, método e limites

- [Farmácia — arquivo original](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit): metadados, valores efetivos, fórmulas nativas, validações e cores; leitura pelo conector autenticado.
- [Agenda — referência cadastral](https://docs.google.com/spreadsheets/d/1GElUcP6IZiLaT62VOqk0lRoA7tJ_9hvZIAoBa7kOWuU/edit): 81 projetos em A2:C82, cabeçalhos de Users, Participantes, Monitores e Medicamentos; IDs e identificação/projeto de participantes para comparação mínima. A aba Migração contém o link de acesso ao web app. Não houve validação de versão da implantação.
- Código local: WebApp.gs, SharedAccessRules.html, Index.html, appsscript.json, testes de autorização e de perfis, PUBLICACAO_SEGURA.md.
- Chrome autenticado: inspeção de “Páginas e intervalos protegidos”, com “Mostrar todos”. Apenas Movimentacoes!K:K foi listado, como “Somente ver” para a conta utilizada. Nenhuma proteção foi criada ou alterada.
- Metadado de modificação da Farmácia na leitura: 2026-09-25T12:54:05.523Z.
- Leitura integral das colunas de estoque A:M até a linha 997 e movimentos A:K até a linha 985. Fichas de estudo: A1:N80; demais recortes constam do inventário.
- Não houve auditoria clínica das orientações nem validação contra manuais de patrocinadores. Texto de preparo é conteúdo a revisar, não instrução para executar operações.
- Não houve inspeção de Apps Script vinculado à planilha farmacêutica, gatilhos, histórico completo de revisões, comentários em discussão ou anexos externos. Esses itens devem ser inventariados antes de uma migração que substitua o arquivo.
- Este levantamento não é backup recuperável. A política de backup está definida na seção 9; nenhuma cópia foi criada.

## 3. Inventário da fonte

26 abas: cinco tabelas de orientação/contatos, estoque, movimentações, 18 fichas específicas e configuração. Os tamanhos abaixo são de grade, não quantidade de registros.

| Aba original | sheetId | Grade (linhas × colunas) | Recorte inspecionado | Uso |
|---|---|---|---|---|
| [Manipulação e dispensação](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1096643942) | 1096643942 | 1005 × 26 | A1:N125; A120:D122 | Orientação/contatos |
| [Embalagens](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1374961366) | 1374961366 | 962 × 25 | A1:I70 | Orientação/contatos |
| [Worksheets](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=466785522) | 466785522 | 964 × 25 | A1:G70 | Orientação/contatos |
| [IWRS/IRTs/Logs](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=2048074743) | 2048074743 | 969 × 24 | A1:E65 | Orientação/contatos |
| [Monitores](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=588254643) | 588254643 | 961 × 26 | A1:G65 | Orientação/contatos |
| [Movimentacoes](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=348822661) | 348822661 | 985 × 30 | A1:K985 | Movimentações |
| [Estoque](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=510339202) | 510339202 | 997 × 29 | A1:M997; O1:Q10 | Estoque |
| [BENITO](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1912317573) | 1912317573 | 1003 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [BGB43395-101](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=238043597) | 238043597 | 1010 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [DUET](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1858330464) | 1858330464 | 989 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [GZBO](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1189980125) | 1189980125 | 1008 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [KANDELA (BGB 43395-302)](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1478734636) | 1478734636 | 991 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [KWAN (TOPAZ)](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1204935136) | 1204935136 | 1002 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [LEON](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1453397405) | 1453397405 | 1002 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [MonumenTAL-3](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=2101176707) | 2101176707 | 995 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [Origami-2](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1648139317) | 1648139317 | 1001 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [Origami-3](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=880783133) | 880783133 | 1001 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [SKYLINE-UC](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1500646567) | 1500646567 | 988 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [STAR-121](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1058106705) | 1058106705 | 997 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [STARSCAPE-1](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=499909067) | 499909067 | 1001 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [SUNSCAPE-1](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=2071005260) | 2071005260 | 1001 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [Talisman](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=821171953) | 821171953 | 988 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [Trilogy-4](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=71478587) | 71478587 | 987 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [Tropion-7](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=667612344) | 667612344 | 1007 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [Tropion-8](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=1845927562) | 1845927562 | 950 × 26 | A1:N80 | Ficha de estudo e blocos individuais |
| [Configurações](https://docs.google.com/spreadsheets/d/1FHr9C6j-ALWGrCOj9LakAYsYwKrSTYUT4AsjcAyZZGQ/edit#gid=265245698) | 265245698 | 1000 × 27 | A1:J12 | Configuração |

Conteúdo tabular confirmado:
- 60 rótulos de estudo em Manipulação e dispensação!A3:A117, com candidatos em 59 projetos da Agenda. BGB-58067-101 possui partes C e D distintas na Farmácia.
- 59 itens/lotes em Estoque!A2:M60.
- 252 movimentos em Movimentacoes!A2:K253, entre 13/07/2026 e 25/09/2026.
- Tipos presentes: 46 saldos iniciais, 180 dispensações, 11 devoluções, 11 entradas, 2 ajustes negativos e 2 positivos.
- Nenhuma chave ID_ITEM duplicada entre os 59 cadastros no recorte lido.
- 31 lotes estão armazenados como números; no destino, lote deverá ser texto, preservando a representação da fonte e sem inventar zeros perdidos.

## 4. Dicionário de dados e contratos propostos

Os nomes de entidades abaixo são proposta de desenho, não novas abas criadas.

### 4.1 Orientações e documentação por estudo

| Origem | Campo de destino proposto | Regra de transformação |
|---|---|---|
| Manipulação e dispensação!A | projetoId + rotuloOriginal + subgrupoOriginal | Resolver pelo mapa revisado; preservar partes C/D. Nunca usar linha ou nome como identidade definitiva |
| B | medicamentoTexto / apresentação farmacêutica | Pode conter mais de um medicamento ou apresentação; não dividir automaticamente por “+” ou “ou” |
| C | formaViaOriginal | Campo hoje combina forma farmacêutica e via; manter texto até revisão |
| D | exigePreparo | Distinguir Sim, Não e não informado |
| E | reconstituicaoTexto | Preservar N/A, vazio e texto sem conversão em cálculo |
| F | diluenteTexto | Mesmo contrato de preservação |
| G | equipoTexto | Mesmo contrato de preservação |
| H/I | localPreparoIPS / localPreparoUNACON | Campos independentes; não tratar um como exclusão do outro |
| J | horariosTexto | Não forçar tipo hora: contém valores como “Refrigerador” |
| K | tempoEquilibrioTexto | Texto original; unidade só poderá ser estruturada após revisão |
| L | tipoDocumentoPreparo | Preservar valores existentes e revisar grafias |
| M | orientacaoEmbalagem | Manter orientação; não executar descarte |
| N | observacoes | Texto com versão e origem |
| Embalagens!A:F | projeto, guardaRotulo, guardaCaixa, destinoEtiqueta, descarte, observacao | Uma orientação pode coexistir com as demais; guardar os valores originais |
| Worksheets!A:D | projeto, assinaturaExtra, localArquivo, observacao | “2ª farma” é exigência documental, não concessão automática de permissão |
| IWRS/IRTs/Logs!A:E | projeto, sistema, acoesTexto, formatoLog, observacao | Cabeçalho A está em branco; mapear explicitamente. Sem integração ou ação automática no IWRS |
| Monitores!A:D | projeto, contatoOriginal, emailOriginal, observacao | Pode haver vários nomes numa célula. Correspondência revisada com ID_Monitor; não sobrescrever cadastro geral |
| Cores e legendas | classificacaoOriginal + evidenciaClassificacao | Amarelo aparece como “Estudos unblided”; vermelho como “Estudos não iniciados”. Cor não concede acesso nem muda status do projeto |
| Fichas específicas A1:N80 | versão de orientação e blocos individuais separados | Limites candidatos por aba no mapa complementar; não publicar a ficha inteira como orientação geral |

Para cada orientação: ID próprio, projetoId, subgrupo, versão, estado de revisão, fonte (arquivo/aba/célula), data de captura, hash do conteúdo, revisor e data de aprovação quando existirem. Não inventar autor ou data de criação histórica.

Mesclagens devem ser interpretadas apenas dentro do intervalo efetivamente mesclado. Preencher todas as células vazias com o valor anterior propagaria estudos e observações indevidamente. Preservar o original e registrar a transformação. A exportação Excel já evidenciou mesclagens; seus limites completos precisam ser relidos da fonte nativa no futuro importador, não presumidos por espaços vazios.

### 4.2 Estoque farmacêutico

| Estoque | Destino | Contrato |
|---|---|---|
| A MEDICAMENTO | medicamentoTexto / medicamentoId futuro | Não reutilizar ID_Medicamento_Rec como ID do produto |
| B CONCENTRACAO | apresentacaoTexto | Preservar unidade e concentração como informadas |
| C UNIDADE_CONTROLE | unidadeControle | Quantidades só podem ser reconciliadas na mesma unidade |
| D LOTE | numeroLote | Texto, separado do ID técnico do lote |
| E VALIDADE | validadeCivil | Data civil; não converter inadvertidamente por UTC |
| F LOCALIZAÇÃO | localizacaoOriginal / localizacaoId futuro | Normalizar por mapa aprovado, preservando texto original |
| G ESTOQUE_MÍNIMO | minimoInformado | Hoje ligado à linha/lote; decidir se no futuro pertence ao produto, projeto ou localização |
| H SALDO_ATUAL | saldo calculado de movimentos | Não importar como segunda fonte aditiva de saldo |
| I STATUS_ ESTOQUE | status calculado | Manter regra legada na comparação; novos bloqueios são outra decisão |
| J STATUS_ VALIDADE | status calculado por data | Datas de corte 30/90 dias observadas; revisar fuso antes de reproduzir |
| K ID_ITEM | chaveLegada | Atualmente medicamento + “ | ” + lote; novo ID estável independente do nome |
| L ORIGEM | origemSuprimento | Compra própria IPS, Patrocinador, Doação, Outro |
| M OBSERVAÇÕES | observacoes | Preservar integralmente na área restrita |

Modelo futuro mínimo: produto/apresentação, lote/localização e movimento. A chave do estoque poderá precisar incluir proprietário/projeto, apresentação e localização. Mesmo número de lote não autoriza fusão de estoques diferentes.

### 4.3 Movimentações

| Movimentacoes | Destino | Contrato |
|---|---|---|
| A DATA | dataOperacaoCivil | Não inventar horário |
| B ID_ITEM | chaveLegada + loteId resolvido | Referência órfã fica pendente; não corrigir por semelhança |
| C MEDICAMENTO / D LOTE | valores derivados e evidência original | Hoje são lookups; guardar a referência usada, sem depender de nome mutável |
| E TIPO | tipoOriginal + tipoNormalizado revisado | Devolução e Troca exigem definição operacional |
| F QUANTIDADE | quantidade | Unidade herdada do lote; preservar saldo inicial zero histórico |
| G PROTOCOLO | protocoloOriginal + projetoId candidato | Aliases só após confirmação |
| H ID_PACIENTE | identificacaoExternaOriginal + ID_Participante candidato | Não confundir número externo com ID interno ou ID Pessoa |
| I RESPONSÁVEL | responsavelHistoricoTexto | Nome histórico não prova e-mail autenticado; futuro ator capturado separadamente |
| J OBSERVAÇÕES | observacoes | Não expor em logs gerais ou telemetria |
| K MOVIMENTO CALCULADO | quantidadeComSinal | Derivada do tipo; não editar manualmente como saldo |

Cada novo movimento deve ter ID, identificador de operação idempotente, estado, data/hora do registro, ator e vínculo com estorno, quando aplicável. Na importação: lote de importação, origem, linha original e hash de conteúdo. Hash isolado não é chave de deduplicação: movimentos legítimos podem ser iguais.

### 4.4 Configurações

Configurações!A: tipos de movimento; C: origens (apesar do cabeçalho TIPOS_MEDICAMENTO); E: estados Ativo/Inativo/Bloqueado/Quarentena; G: unidades; I: localizações; J: lista calculada de itens com saldo positivo.

A lista de estados não prova que bloqueio/quarentena já esteja aplicado ao estoque. O cadastro A:M não contém coluna correspondente e a lista J filtra apenas saldo. No app futuro, opções de saída precisam considerar elegibilidade real; entradas e ajustes não podem depender apenas de saldo positivo.

## 5. Fórmulas e conciliação

Fórmulas nativas conferidas:
- Estoque!K2: forma a chave a partir de medicamento e lote.
- Estoque!H2: SUMIFS dos movimentos assinados, usando igualdade de chave.
- Estoque!I2: negativo, zerado, baixo quando saldo <= mínimo, senão OK.
- Estoque!J2: compara validade com TODAY(), depois limites de 30 e 90 dias.
- Movimentacoes!C2:D2: INDEX/MATCH pelo ID_ITEM, com IFERROR retornando vazio.
- Movimentacoes!K2: saldo inicial, entrada, devolução e ajuste positivo somam; demais tipos subtraem.
- Configurações!J2: FILTER de IDs com saldo > 0, envolvido em IFERROR.

Foram encontradas 2.952 fórmulas em Movimentacoes!A1:K985 e 3.984 em Estoque!A1:M997. Não foram encontrados valores manuais substituindo as fórmulas nas colunas calculadas examinadas, nem erros de cálculo efetivos nesses recortes.

Recalculei em memória os sinais e os saldos: os 252 movimentos têm sinal coerente com a regra atual e os 59 saldos cadastrados coincidem com a soma por chave. Isso não comprova completude: duas movimentações referenciam chaves inexistentes e não entram em nenhum desses saldos.

Não foi somado um “estoque total” de medicamentos: unidades e produtos diferentes não são comparáveis.

## 6. Divergências e ações para revisão

| ID | Evidência | Consequência | Tratamento proposto |
|---|---|---|---|
| F01 | Fuso da Farmácia America/Los_Angeles; Agenda America/Sao_Paulo | TODAY e conversões de data podem divergir perto da virada do dia | Definir semântica de data civil e fuso de negócio; comparar antes de alterar configuração |
| F02 | Movimentacoes!B17: Filgrastim, lote 2408052, saldo inicial 9; cadastro atual em Estoque!22 usa lote 153846 | C17/D17 ficam vazios e o movimento não participa do saldo cadastrado | Revisar fonte do recebimento/lote; não transferir as 9 unidades automaticamente |
| F03 | Movimentacoes!B61: Leuprorrelina, lote 225652U, entrada 3; Estoque!K37 inclui “7,5mg” no nome | Chaves distintas, lookup vazio e entrada fora do saldo desse cadastro | Candidato a renomeação, não fato confirmado; conferir apresentação, lote e origem antes de vincular |
| F04 | Estoque!H30 = -4 (Humectol D); H37 = -2 (Leuprorrelina 7,5mg) | Saldo operacional inconsistente | Reconciliar cada histórico e contagem física. F03 pode estar relacionado a H37, mas não autoriza ajuste |
| F05 | BENITO!D1, Origami-2!D1, STARSCAPE-1!D1, SUNSCAPE-1!D1, Tropion-7!D1 e Tropion-8!D1 divergem do nome da aba | Associação incorreta de orientação | Quarentenar para revisão; títulos corretos não garantem conteúdo correto |
| F06 | BGB43395-101!B2/F2/B4 divergem do resumo em Manipulação e dispensação | Conteúdo potencialmente copiado de outro modelo | Farmácia valida contra a fonte documental, sem conclusão clínica automatizada |
| F07 | Coloração cinza varia entre tabelas; amarelo/vermelho têm legenda, outras cores não têm significado completo documentado | Classificação automática pode inventar estado | Guardar cor como evidência, classificar explicitamente após revisão |
| F08 | Blocos “Nome”, “Baseline”, dose e ciclo nas fichas | Mistura orientação geral com registro individual | Separar entidades e acesso; primeira versão não expõe blocos individuais como ficha de estudo |
| F09 | ID_ITEM depende do nome; 31 números de lote são numéricos | Renomeação rompe histórico; risco de perder representação do lote | IDs estáveis e mapa de chaves legadas, sem reformatação automática |
| F10 | Validação B de Movimentacoes usa itens com saldo > 0 para todos os tipos | Item zerado não aparece também para reposição/devolução | Futuras listas dependem do tipo de operação; preservar edição histórica |
| F11 | “Troca” consta da validação de Movimentacoes!E, mas não de Configurações!A2:A9 | Catálogos divergentes e sinal de saída genérico | Definir troca e eventual par saída/entrada; não reinterpretar históricos |
| F12 | “Devolução” adiciona quantidade ao saldo | Retorno físico e disponibilidade podem ser conceitos diferentes | Equipe define inspeção, segregação/quarentena e liberação |
| F13 | Apenas Movimentacoes!K:K listado em proteções; demais colunas calculadas não constaram da lista | Aviso textual em Estoque!O3 não equivale a proteção | Revisar proteção na transição; não alterar agora |
| F14 | Uma regra condicional busca ESTOQUE BAIXO sem símbolo; a fórmula produz “⚠ ESTOQUE BAIXO”; existe outra regra com símbolo | Redundância/inconsistência de apresentação | Levar semântica para regra explícita do módulo |
| F15 | Movimentacoes!F19 = 0, tipo Saldo inicial | Registro sem impacto no saldo | Preservar como histórico; não excluir nem classificar como erro por si só |
| F16 | 49 dispensações com alias de projeto e 22 sem participante correspondente no projeto reconhecido | Vínculos individuais não estão prontos para migração automática | Fila de revisão no mapa complementar; nenhum cadastro automático |
| F17 | BGB-58067-101 partes C/D têm um único projeto candidato na Agenda | Perda de diferença de subgrupo se consolidado sem cuidado | Manter subgrupo separado do projeto e do braço até definição |
| F18 | Users atual não possui setor/permissão de Farmácia | Perfil geral não protege o conteúdo farmacêutico | Adicionar controle independente, com decisão por estudo pendente |

## 7. Integração com o app e fontes oficiais propostas

| Informação | Fonte de referência proposta | Integração |
|---|---|---|
| Identidade de projeto | Projetos da Agenda, ID_Projeto | Preservar aliases e subgrupos farmacêuticos |
| Identidade de participante | Participantes, ID_Participante + projeto | Número externo é chave de busca, não substituto do ID interno |
| Identidade de usuário | Users e identidade autenticada | Não inferir acesso a partir de formação ou de compartilhamento atual |
| Monitor | Cadastro geral Monitores | Já possui vínculo por projeto e indicador unblinded; isso não autoriza acesso do usuário ao módulo |
| Orientações farmacêuticas | Sheets da Farmácia, revisado | Versão aprovada e fonte visível; mudanças posteriores exigem nova revisão |
| Saldo farmacêutico | Movimentações da Farmácia reconciliadas | Não somar saldo importado a todo o histórico, o que duplicaria quantidades |
| Recebimentos administrativos | 💊 Medicamentos da Agenda | É registro de recebimentos, não catálogo mestre nem saldo; futura entrada usa ID_Medicamento_Rec para evitar duplicidade |
| Visita agendada | Agenda/Jornada | Apenas referência/previsão; não comprova dispensação ou administração |

Pontos técnicos verificados no código:
- WebApp.gs: getProjetos (3739), getParticipantes (6114), getMonitores (6776), getMedicamentosRecebidos (11238).
- getMedicamentosSheet_ (11224) pode criar aba/cabeçalhos. O piloto somente leitura deve usar leitor sem efeitos colaterais, não reutilizar esse getter.
- getCodexSpreadsheet_ (1873) usa a planilha ativa. A Farmácia precisa de resolvedor dedicado para o arquivo configurado; não alterar o getter global.
- codexGetAllowedUsers_ (1688) utiliza cache ACL de 120 segundos. O desenho de Farmácia deve prever revogação e checagem autoritativa, sem transformar cache em fonte de autorização.
- SharedAccessRules.html protege visualmente apenas alguns módulos administrativos. Nova permissão precisa existir no cliente e em todas as RPCs, inclusive leituras.
- codexAssertCanWrite_ (760) atende perfil geral e possui caminho de API token. A Farmácia deve exigir autorização específica, sem herdar liberação ampla inadvertidamente.
- codexWriteAuditLog_ (1110) e codexWriteAuditChanges_ (1148) capturam erros sem propagar; auditoria de alterações ainda trunca valores para 500 caracteres. São infraestrutura útil, mas não bastam para uma trilha farmacêutica completa.
- Index.html já usa inclusão condicional de módulos. Manter conteúdo e dados da Farmácia sob demanda.
- O estoque existente de kits inclui reservas por lote e regras de SoA. Não reutilizar seu saldo ou seus lançamentos para medicamentos.

Não adicionar detalhes de preparação, medicamentos restritos ou dados individuais à auditoria geral, ao bootstrap compartilhado ou aos logs de diagnóstico. Eventos gerais podem conter apenas ID opaco e ação; detalhes ficam na área com a mesma autorização do registro.

## 8. Acesso — proposta sujeita à decisão da equipe

Separar pertencimento à equipe de autorização:
1. Equipe Farmácia: Sim/Não (classificação administrativa).
2. Acesso Farmácia: nenhum / consulta / operação / gestão.
3. Escopo por projeto/conteúdo: concessão explícita, ainda não definida.

| Combinação | Comportamento proposto |
|---|---|
| Usuário ativo, sem concessão Farmácia | Sem menu, sem dados em respostas e sem RPC autorizada |
| Consulta + estudo autorizado | Consulta apenas do conteúdo aprovado e permitido |
| Operação + perfil geral user/admin + escopo | Operações previstas para a atribuição concedida |
| readonly + qualquer nível farmacêutico | Continua impedido de gravar |
| Gestão farmacêutica | Mantém conteúdo e revisões autorizadas; não concede a si próprio novos privilégios |
| admin geral sem concessão de conteúdo | Administração técnica não libera automaticamente informação unblinded |

Enquanto não houver definição, o padrão proposto é nenhum acesso, sem criação de concessões por inferência. Não escolher usuários a partir de nome, profissão ou da lista de compartilhamento.

Permissões do arquivo original retornadas: uma proprietária e cinco editores, todos com contas UCS; não apareceu concessão anyone/domain na resposta. Isso descreve o compartilhamento observado, não uma aprovação de acesso por estudo. O arquivo possui dados de vários estudos sob o mesmo compartilhamento.

No modelo USER_ACCESSING configurado no app, a pessoa precisa de acesso compatível ao arquivo de dados. Se houver necessidade de segregação dentro da Farmácia, filtrar linhas na interface é insuficiente para quem consegue abrir o arquivo completo. Antes do piloto, escolher entre arquivos fisicamente segregados por escopo ou arquitetura de backend que aplique essa segregação. Não mudar a identidade de execução do app inteiro apenas para contornar esse ponto.

A lista de concessões também precisa de armazenamento/proteção que impeça autoelevação por edição direta. Preservar o schema Users!A:H; eventual extensão deve mapear cabeçalhos, não sobrescrever colunas. Para escopo por estudo, é preferível uma tabela de concessões própria com usuário, projeto, permissões, vigência, concedente e histórico.

## 9. Migração, backup e retorno

### Fonte oficial por fase
- Etapa 0: originais permanecem como estão.
- Etapa 1: Sheets farmacêutico continua sendo a fonte; o app oferece consulta de conteúdo explicitamente revisado. Sem escrita de saldo ou operação.
- Etapa 2 em diante: corte por processo/piloto, com um canal de escrita oficial e reconciliação. Não operar app e edição livre da mesma movimentação como dois canais independentes.

### Plano de backup antes da primeira escrita
1. Designar responsável e destino restrito, com acesso não mais amplo que o original.
2. Criar cópia nativa completa do arquivo na janela de corte, preservando abas, fórmulas, validações, mesclagens, cores, notas e links.
3. Registrar ID/URL da cópia, origem, data/hora, versão disponível, responsável e matriz de compartilhamento/proteções.
4. Inventariar separadamente scripts vinculados, gatilhos, integrações e histórico necessário: não presumir que uma cópia nativa preserve todos esses elementos.
5. Produzir manifesto de contagens por aba e chaves, além da conciliação por item/lote. Guardar valores e fórmulas necessários à reconstrução em área restrita, fora do Git.
6. Verificar a cópia por releitura e ensaiar restauração em ambiente de teste. XLSX é evidência complementar, não substituto da cópia nativa.
7. Se houver edição concorrente entre leitura e importação, invalidar a prévia. Recalcular hashes, contagens e validação na nova fonte antes de gravar.

### Importação futura
- Prévia antes da primeira gravação, com classificação de cada registro: apto, pendente, bloqueado ou sem vínculo.
- Não apagar nem renomear originais no primeiro ciclo.
- IDs de destino persistidos em mapa de importação. Reexecução não cria novas linhas para a mesma origem aprovada.
- Movimentos idênticos legítimos não devem ser eliminados por deduplicação de conteúdo.
- Pré-validar lote inteiro; escrita em blocos, cursor e estado de conclusão para recuperação. Sheets não oferece transação entre múltiplas abas: fluxo deve tolerar interrupção.
- Na etapa operacional, garantir exclusão mútua para o mesmo saldo e validar versão/quantidade antes de efetivar a saída. Bloqueio do script não impede edição manual externa.
- Não misturar estratégia “saldo de abertura no corte” com replay integral do histórico. Escolher uma, documentar e reconciliar.
- Erros históricos ficam preservados com vínculo pendente; sua correção exige evidência e decisão da equipe.

### Retorno
- No piloto de consulta: desativar a seção/integração e retomar consulta pelo original, sem perda de dados.
- Após operações reais pelo app: interromper novas escritas, reconciliar os lançamentos posteriores ao corte e preservar toda a trilha. Não restaurar cegamente um backup antigo sobre movimentos posteriores.
- Corrigir por lançamento rastreável/estorno, conforme regra aprovada; não remover registros para “fazer bater”.

## 10. Piloto proposto e critérios de aceitação

Escopo inicial: consulta de orientações e documentação de poucos estudos aprovados. Sem saldos operacionais editáveis, preparo, dose, dispensação ou envio automático.

Candidatos de diversidade: um fluxo oral, um subcutâneo e um intravenoso, escolhidos pela Farmácia após resolver as divergências relevantes. Nenhum estudo foi selecionado ou liberado automaticamente.

Critérios:
- Vínculo com projeto validado, subgrupos preservados e nenhuma ficha com título/conteúdo divergente liberada.
- Dados individuais separados das orientações e excluídos da primeira consulta geral.
- Matriz de acesso definida e validada com cenários permitido/negado, incluindo URL/RPC direta, exportação, busca e usuário revogado.
- Nenhuma escrita na planilha de origem causada por abrir a seção.
- Mudança no conteúdo-fonte detectada; conteúdo novo não herda aprovação de versão antiga.
- Fonte, data de revisão e pendências visíveis; campos vazios não aparecem como “Não” ou zero.
- Leituras em lote, carregamento sob demanda, erro de acesso claro e sem resposta parcial que vaze informações.
- Testes locais isolados de serviços reais; testes de contrato de leitura, autorização e importação idempotente nas fases correspondentes.
- npm run verify antes de qualquer entrega de código. Publicação somente mediante pedido explícito e pipeline de PUBLICACAO_SEGURA.md.
- Antes da etapa operacional: saldos negativos e referências órfãs tratados, unidades reconciliadas, critérios de devolução/troca e auditoria completos.

## 11. Registro de decisões pendentes

| Decisão | Responsável | Situação |
|---|---|---|
| Pessoas autorizadas e segregação por estudo/cegamento | Equipe de Farmácia + gestão do app | Usuário informou que ainda precisa definir |
| Pessoa que aprova o conteúdo e substituto | Equipe de Farmácia | Equipe indicada; pessoa ainda não definida |
| Tratamento de F01–F18 | Equipe de Farmácia, com apoio técnico | Relacionado para revisão; nenhum ajuste aplicado |
| Documentos de referência e vigência das orientações | Farmácia | A definir; planilha não é validação clínica |
| Critério de devolução, troca, quarentena e saldo disponível | Farmácia | A definir antes de operações |
| Unidade e escopo do estoque mínimo | Farmácia | A definir |
| Conciliação com recebimentos em Medicamentos/RM | Farmácia + responsável pelo recebimento | A definir antes de gerar entradas |
| Destino, responsável e teste de restauração do backup | Gestão + Farmácia | Plano preparado; cópia não executada |
| Estudos e usuários do piloto | Farmácia | A definir após revisão e acesso |
| Inventário de scripts/gatilhos da fonte | Responsável técnico pelo arquivo | A concluir antes de substituir o fluxo original |

A etapa 0 técnica está entregue. O aceite operacional da equipe é a condição para fechar a etapa como aprovada e iniciar o piloto; não foi substituído por uma suposição do agente.

## 12. Validação desta entrega

Leituras nativas e conferência da proteção no Chrome realizadas sem alterações remotas. Cálculos em memória conferiram sinais e saldos, com exceções documentadas. Somente dois documentos Markdown foram criados no repositório; alterações de código preexistentes foram preservadas. Não houve testes do app nem npm run verify, pois não houve alteração de código. Nenhum commit, push, implantação, mensagem ou compartilhamento foi realizado.

