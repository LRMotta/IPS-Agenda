# Farmácia: produtos e inventário inicial por estudo e estoque comum

Segunda entrega local, sobre a base de permissões por estudo, ampliada com estoque
comum do IPS a pedido do usuário. Não há importação da planilha anterior,
integração com Tasy/IRT, dispensação, preparo, prescrição ou movimentação posterior.

## Uso

Selecionar um estoque autorizado na Farmácia: um estudo ou **Estoque comum do IPS**.
O comum atende materiais compartilhados, como equipos e seringas, e tem saldo próprio.
O mesmo produto exclusivo de um protocolo deve ser cadastrado no estoque do estudo.
Não há transferência automática, retirada nem rateio de custos por estudo nesta fase.
A classe padrão é aberta inicialmente nos estudos.
A classe **Informações restritas** só pode ser consultada com a concessão adicional
no estudo e tem armazenamento físico separado; trocar estudo/classe limpa dados
e formulários anteriores e descarta respostas obsoletas.

- `read` e `operate` consultam. Nesta entrega, só `manage` cadastra produtos e
  confirma inventário inicial. Admin não substitui essas concessões.
- O comum usa concessão própria em Users K, **Acesso ao estoque comum da Farmácia**:
  `none/read/operate/manage`. Não depende de I/J nem concede estudos, e não tem
  classe restrita. Campo ausente/inválido ou cabeçalho alheio nega acesso. Só Admin
  altera K, com snapshot `farmaciaCommonOriginal` revalidado sob lock; payload legado
  que omite a concessão preserva K. Perfil próprio e carga rápida não alteram K.
- `@IPS_COMMON` é identidade reservada do escopo comum nas RPCs e no ledger, jamais
  um ID válido de Projetos ou de concessão por estudo. Os endpoints continuam
  `getFarmaciaEstudo`, `getFarmaciaEstoque`, `cadastrarProdutoFarmacia` e
  `registrarInventarioInicialFarmacia`, todos com autorização do escopo no servidor.
- Produto: ID estável gerado no servidor, nome/rótulo autorizado, apresentação,
  unidade e controle por quantidade ou por kit individualizado, condições de
  conservação e referência documental com versão/data. Produtos iguais
  em nome/apresentação/unidade/controle não são cadastrados duas vezes.
- Inventário: produto, lote, validade civil, localização, kit quando aplicável,
  quantidade física positiva, quantidade bloqueada, data e confirmação da contagem,
  observação opcional, autor autenticado e instante do registro.
- Quantidades inteiras para unidades discretas; até três casas para mL/g. Cada kit
  individual tem quantidade física 1 e seu número é único dentro do estudo/classe.
- Não somar unidades diferentes. O disponível é físico menos bloqueado. Vencidos
  entram integralmente bloqueados. Vencimento posterior zera o disponível no DTO,
  sem reescrever a contagem; `initialBlocked` preserva o bloqueio originalmente contado.
- Uma posição nova é produto + lote + equipamento/posição cadastrados + kit, comparados exatamente após
  remoção de espaços nas extremidades. Alterar a validade não cria nova posição.
  Não há correção por nova contagem inicial, exclusão ou edição das entradas nesta
  entrega; ajustes e recebimentos posteriores pertencem à etapa de movimentações.

## Armazenamento e configuração futura

As novas RPCs não usam a planilha principal como fallback. A propriedade de script
`FARMACIA_STORAGE_V1` associa IDs estáveis de Projetos a arquivos dedicados:

```json
{
  "version": 1,
  "common": "ID_DO_ARQUIVO_EXCLUSIVO_DO_ESTOQUE_COMUM",
  "locations": "ID_DO_ARQUIVO_EXCLUSIVO_DO_CATALOGO_FISICO",
  "studies": [
    {
      "studyId": "PROJ-EXEMPLO",
      "standard": "ID_DO_ARQUIVO_PADRAO_DO_ESTUDO",
      "restricted": "ID_DO_ARQUIVO_RESTRITO_DO_ESTUDO"
    }
  ]
}
```

Os IDs de arquivos são IDs puros, não URLs. O arquivo restrito é opcional; sua
ausência não redireciona à classe padrão. Todo o mapa é validado: arquivo não pode
ser o principal nem ser compartilhado entre estudos/classes, comum ou catálogo físico.
`common` é opcional: ausente não redireciona para estudos nem para o arquivo principal.
Pode-se configurar somente o comum usando `studies: []`. Arquivos contendo
abas preenchidas de outros módulos são recusados. Não apontar para a planilha
histórica da Farmácia, ainda pendente de saneamento e validação.

Sem configuração, a consulta retorna `configured: false` e listas vazias, sem
criar nada. A interface informa a pendência e não libera formulários de escrita.
Não foi criada configuração nem alterada permissão ou planilha real nesta entrega.

O web app executa como usuário que acessa. Portanto, antes do uso real, cada arquivo
precisa ser compartilhado somente com as pessoas autorizadas para aquele estudo e
classe, ou para o comum: leitura para consulta e edição para os responsáveis por gravações. Revogar
uma concessão no app não revoga automaticamente permissões no Drive; as duas
camadas precisam ser administradas conjuntamente. Esta entrega não altera ACLs do
Drive nem comprova suas permissões. Conteúdo que revele tratamento/alocação exige
decisão e validação da Farmácia antes de qualquer cadastro real.

## Integridade, concorrência e auditoria

Arquivo usa uma única aba `Farmacia_Registros_v1`, com cabeçalho fixo. Cada linha
é um produto ou uma contagem inicial e inclui ID, estudo, classe, identificador da
operação, instante, autor e payload JSON. Texto livre permanece em JSON, evitando
interpretação como fórmula de planilha. Datas são armazenadas em ISO; exibição usa
português e America/Sao_Paulo. Não há cópia detalhada em Audit_Log da planilha
principal, evitando expor nomes/lotes restritos a quem só administra o app.

## Equipamentos, posições e conservação

`locations` é opcional no mapa, mas necessário para novos inventários. Aponta a um
arquivo dedicado com a aba `Farmacia_Locais_v1`; leituras não criam abas ou registros.
O catálogo só é lido após autorizar o estoque solicitado. Seus metadados físicos são
compartilhados com quem tem acesso à Farmácia, sem ocupação, estudos, produtos,
tratamentos ou saldos de outros escopos. O Drive deve permitir leitura do catálogo
a esses usuários e edição apenas aos responsáveis pelo estoque comum (`manage`).
Admin ou `manage` em um estudo não substituem a concessão de administração comum.
`@IPS_LOCATIONS` é reservado internamente e não pode ser cadastrado como estudo.

O equipamento tem código interno/patrimonial exclusivo, tipo, fabricante/modelo,
sala, faixa operacional documentada (ou pendente), referência/versão, situação e
de 1 a 100 posições internas. Códigos e posições são estáveis nesta entrega; não há
renomeação, exclusão nem transferência. Situação pode mudar entre ativo, manutenção
e indisponível, com motivo e revisão concorrente, sem sobrescrever o histórico.

O armário IPS AF-01 e os modelos phcbi MPR-721R-PA, MPR-722R-PA e SF-L6111W-PA
informados pelo usuário servem de referência de preenchimento. Nenhum código de
patrimônio, posição, faixa ou equipamento real foi criado. O modelo não determina
automaticamente a faixa aprovada. Não preencher uma faixa presumida de ambiente,
refrigerado ou congelado.

Produtos novos exigem `storage` no servidor: min/max em °C (ambos numéricos ou
ambos null), instruções, fonte e versão/data. Sem faixa, as instruções são obrigatórias
e a comparação permanece pendente. Produtos históricos sem esse objeto continuam
legíveis e seus replays são preservados, sem migração silenciosa.

Novos inventários exigem `locationRef: {unitId, position}` válido no catálogo. O
rótulo `location` é derivado no servidor. Localizações históricas livres permanecem
intactas, sem inferir vínculos. Igualdade exata do rótulo também impede recontagem
equivalente entre registro livre e estruturado; equivalências não documentadas
precisam de revisão humana, nunca de novo inventário para ajustar o saldo.

O servidor sinaliza faixa incompatível, faixa pendente, vínculo histórico e equipamento
indisponível. O cliente antecipa os avisos na seleção. Uma faixa do equipamento só é
compatível se estiver integralmente dentro da faixa do produto. Isso não representa
medição nem verifica condições adicionais (luz, umidade etc.). Esses avisos não
alteram físico, disponível ou bloqueado e não realizam liberação/quarentena clínica.

## Sondas e calibração

Cada sonda é cadastrada individualmente no equipamento, com ID estável, número
interno, número de série, fabricante/modelo e ponto de instalação opcional. Número
interno e série são exclusivos no catálogo inteiro, ignorando maiúsculas/minúsculas.
O IPS informou duas sondas por equipamento: cadastre ambas, sem inventar identidades.
Não há limite fixo de duas, para permitir outros arranjos físicos. Identificador simples
de sensor de registro anterior não é convertido em sonda automaticamente.

Calibração pode ser pendente/não informada, calibrada conforme certificado ou fora
de uso. Para declarar calibrada, o servidor exige data realizada não futura, validade
documentada igual ou posterior e referência do certificado. Não há prazo padrão.
Após a validade civil em America/Sao_Paulo, a consulta exibe **Vencida**, sem escrever
no arquivo. Datas opcionais em registros pendentes também são validadas.

A calibração pode ser atualizada com revisão do registro, referência e observação;
o valor anterior permanece no ledger. Cadastro, situação e calibração usam o mesmo
document lock, autorização comum `manage` e requestId persistido para idempotência.
Cada linha inclui autor e instante. Arquivo é append-only pela aplicação, sem garantir
imutabilidade contra edição direta. Não há importação de leituras, certificado PDF,
integração com sondas, alarmes automáticos ou bloqueio de estoque por calibração.

RPCs adicionais: `cadastrarLocalFarmacia`, `atualizarSituacaoLocalFarmacia`,
`cadastrarSondaFarmacia` e `atualizarCalibracaoSondaFarmacia`. São autorizadas no
servidor; ocultar o formulário não é a proteção de acesso.

As RPCs revalidam autorização e configuração sob document lock. Validam schema,
registros anteriores, referências e duplicidades antes da primeira escrita.
Leituras não criam schema, alteram saldos ou corrigem inconsistências silenciosamente.
Novas gravações são append-only pela aplicação; a permissão de edição direta do
arquivo continua sendo uma fronteira operacional e não há promessa de trilha
criptográfica imutável contra edição externa.

O identificador da operação é persistido junto com os dados: mesmo identificador e
payload devolvem o registro existente; payload diferente é recusado. A interface
preserva o identificador e o formulário após falha, inclusive resposta perdida
depois da gravação. Nova chave também não permite repetir posição ou kit.

## Validação local

`npm.cmd run verify` e `npm.cmd run test:ui`, com simuladores de Users, Projetos,
ScriptProperties, arquivos segregados, locks e RPCs. Rede bloqueada nas fixtures.
Cobertura inclui isolamento, revogação sob lock, vencimento, corrupção, fórmulas,
retentativas após gravação, duplicidade de kits e troca de estudo/classe.

Antes de operação real: configurar e conferir arquivos/ACLs, definir permissões
nominais e política de cegamento e validar um inventário físico de um estudo com a
equipe. Publicação exige solicitação explícita e o fluxo de PUBLICACAO_SEGURA.md.
