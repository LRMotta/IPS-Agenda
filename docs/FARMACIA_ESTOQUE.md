# Farmácia: produtos, estoque e base do ciclo de vida

Base local com permissões por estudo, estoque comum e ciclo inicial de produtos
fornecidos pelo patrocinador. Há inventário inicial, recebimentos, bloqueio/liberação
e transferência de localização, com histórico. Não há importação da planilha anterior,
integração com Tasy/IRT, dispensação, preparo, prescrição, devoluções ou destruição.

## Uso

A Farmácia mantém o título de seção **FARMÁCIA** acima do grupo expansível e usa
submenu lateral próprio: **Estoque**, **Produtos**, **Equipamentos**
e **Sondas e calibração**. Cada área tem tabela, busca local e ação de cadastro em
modal, conforme os componentes do app. Trocar de área preserva o estoque selecionado
e não consulta outros estudos. O seletor de estoque aparece somente em Estoque e
Produtos. Equipamentos e Sondas são um catálogo compartilhado, consultado pela RPC
`getFarmaciaCatalogo()` sem ID de projeto, classe restrita ou seleção de estoque.
O cabeçalho azul mantém o ícone de Farmácia (`local_pharmacy`) e o caminho
**Farmácia › Estoque**, **Farmácia › Produtos**, **Farmácia › Equipamentos** ou
**Farmácia › Sondas e calibração**, conforme a subseção atual. O chevron é decorativo.
Não há título repetido na barra da tabela ou parágrafos descritivos.
Não exibem seletor de estoque, linha de contexto ou texto sobre compartilhamento.
O catálogo segue a apresentação de Cadastros: indicadores, barra de busca/ações e
tabela, sem parágrafos descritivos. Carregamento usa a linha com spinner da tabela;
listas vazias mantêm as colunas e uma única mensagem, sem painel de instruções.
Equipamentos e Sondas não exibem botão Atualizar. A consulta é carregada ao abrir
o catálogo e os dados são atualizados após salvar; em falha, reabrir a área permite
nova tentativa. Estoque e Produtos mantêm sua ação de atualização manual.

Formulários usam confirmação de descarte, foco de teclado e bloqueio de fechamento
enquanto a gravação está em andamento. Em falha, preservam dados e requestId para
nova tentativa; sucesso fecha o modal e atualiza a tabela. Revogar acesso ou trocar
o estoque limpa os dados anteriores. Configuração ausente é exibida em um único
estado vazio; não há contagens de zero apresentadas como se fossem dados conhecidos.

Selecionar um estoque autorizado na Farmácia: um estudo ou **Estoque comum do IPS**.
O comum atende materiais compartilhados, como equipos e seringas, e tem saldo próprio.
O mesmo produto exclusivo de um protocolo deve ser cadastrado no estoque do estudo.
Não há transferência automática, retirada nem rateio de custos por estudo nesta fase.
A classe padrão é aberta inicialmente nos estudos.
A classe **Informações restritas** só pode ser consultada com a concessão adicional
no estudo e tem registros separados por estudo e classe na mesma base; trocar estudo/classe limpa dados
e formulários anteriores e descarta respostas obsoletas.

- `read` e `operate` consultam. Nesta entrega, só `manage` cadastra produtos e
  confirma inventário inicial e registra recebimentos/movimentações. Admin não substitui essas concessões.
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
  entrega. Recebimentos do patrocinador são entradas distintas, nunca novas contagens iniciais.

## Base do ciclo de vida do patrocinador

Produtos novos exigem `supplySource`: `sponsor` (fornecido pelo patrocinador) ou
`site` (próprio do IPS). O estoque comum não aceita produtos do patrocinador.
Registros anteriores sem origem continuam legíveis, sem classificação inferida e
sem habilitar recebimentos/movimentações. Não recriar um produto histórico para
migrar seu saldo: a classificação/migração histórica exige procedimento posterior.

O saldo inicial representa apenas a contagem física. Para produtos do patrocinador,
a parte não bloqueada entra automaticamente como **Aguardando avaliação**. O
recebimento registra data, documento/remessa e item, produto, lote/kit, validade,
quantidade e equipamento/posição; sua quantidade também aguarda avaliação.
Vencidos não ficam disponíveis. A referência documental deve identificar o item
da remessa: mesma referência + produto + lote + kit não pode ser recebida duas vezes.
Kits individuais permanecem únicos no estudo/classe, inclusive entre tipos de entrada.

O físico se divide em disponível, aguardando avaliação e bloqueado, sem somar
unidades distintas. Vencimento zera disponível e pendente na consulta e apresenta
todo o físico como bloqueado, preservando os eventos originalmente registrados.

No histórico da entrada, `manage` pode bloquear uma quantidade disponível/pendente
ou liberar uma quantidade pendente/bloqueada. Toda ação exige motivo e referência
documental; liberar é uma declaração explícita do usuário autorizado, baseada nos
documentos do estudo, sem aprovação automática por conservação ou contagem.
Material vencido não pode ser liberado. Não há prescrição, cálculo de dose nem IRT.

A transferência move o **saldo integral da entrada** para outra posição cadastrada;
preserva situações e quantidades, produto, lote/kit e estudo/classe. Não há
transferência entre estudos/classes nem fracionamento da entrada nesta etapa.
Equipamentos continuam compartilhados; o catálogo não expõe sua ocupação clínica.

As RPCs `registrarRecebimentoFarmacia` e `registrarMovimentacaoFarmacia` revalidam
`manage`, configuração, schema e saldo sob lock. Movimentações exigem a revisão atual
da entrada; resposta perdida aceita repetição idêntica do requestId mesmo depois de
outras movimentações, sem duplicar o efeito. O cliente preserva formulário/chave em
falhas e descarta respostas após mudança de estudo/classe ou identidade.

Os eventos ficam na aba do respectivo projeto (ou do estoque comum), com os
tipos `RECEIPT` e `MOVEMENT`, além de `PRODUCT` e `INITIAL`. Cada linha registra
autor autenticado, instante, motivo/referência e payload JSON. Leituras reconstroem
o saldo e validam a sequência sem escrever ou migrar schema. O botão **Histórico**
permite consulta aos perfis autorizados, mantendo as restrições do estudo/classe.
As concessões do WebApp continuam exigindo configuração administrativa antes do uso.

## Armazenamento no arquivo principal

Todos os projetos continuam na aba Projetos do arquivo principal. A Farmácia usa
esse mesmo arquivo, sem arquivos externos por estudo ou classe:

- Farmacia_ID_<ID estável em hexadecimal>: produtos, inventários, recebimentos, movimentações e correções de cada projeto;
- Farmacia_Comum_v1: registros do estoque comum do IPS;
- Farmacia_Locais_v1: equipamentos, posições, sondas, calibrações e histórico.

Cada registro mantém ID, estudo (Estudo_JSON), classe (Restrito), requestId,
instante, autor e payload JSON. A autorização precede a leitura. O replay filtra
estudo e classe antes de interpretar payloads; vínculos a outro contexto são
recusados. RequestId é idempotente por estudo/classe. O comum usa uma aba independente,
com identidade @IPS_COMMON e concessão própria, sem classe restrita.
Leituras não criam abas nem cabeçalhos; a primeira escrita válida cria o schema
sob lock, preservando outras abas.

O ID do projeto determina o nome da aba, preservado quando seu nome/código muda.
IDs longos ou com caracteres especiais usam SHA-256 para gerar um nome válido.
FARMACIA_STORAGE_V1 não participa do armazenamento. A instalação começa vazia,
conforme a regra solicitada: sem migração nem leitura de arquivos externos.

As concessões por estudo e classe permanecem no servidor. O app executa com a
conta de quem acessa, que precisa do acesso adequado apenas ao arquivo principal.
O compartilhamento direto do arquivo permite ler suas abas, inclusive registros
restritos: o Sheets não oferece sigilo de leitura por aba. Proteção de edição não
substitui segregação de leitura.

## Instalação nova

A seleção de um projeto sem aba retorna estoque vazio. O primeiro salvamento
válido cria sua aba e cabeçalho sob lock. Equipamentos e sondas permanecem no
catálogo físico compartilhado. As rotinas de migração foram removidas porque
não há dados a migrar nesta instalação. Nenhuma aba real é criada por testes.

## Integridade, concorrência e auditoria

O ledger é append-only no principal. Correções e exclusões lógicas preservam o
histórico. Texto livre fica em JSON, evitando fórmulas. Datas são ISO e a exibição
usa português e America/Sao_Paulo. A auditoria detalhada fica no ledger e não é
duplicada em Audit_Log.

## Equipamentos, posições e conservação

O catálogo físico também usa o arquivo principal, sem configuração de arquivo externo.
A aba `Farmacia_Locais_v1` e seus cabeçalhos são criados automaticamente no primeiro
cadastro válido, após autorização e validação sob lock; leituras não criam abas ou
registros. Não é necessário fornecer uma relação prévia de equipamentos.
As colunas são `ID`, `Tipo`, `Request_ID`, `Registrado_em_JSON`, `Autor_JSON` e
`Dados_JSON`; os campos do equipamento, posições, sondas e calibrações ficam no
payload JSON, preservando o histórico e evitando interpretação de texto como fórmula.
Abas existentes com estrutura divergente são recusadas, sem sobrescrever dados.
O catálogo pode ser lido por todos os usuários ativos autenticados do app, mesmo
sem concessão de Farmácia ou projeto. O menu de Farmácia permanece disponível para
eles; Estoque e Produtos aparecem somente com suas concessões específicas.
Farmácia, Equipamentos e Sondas já estão presentes no HTML inicial, antes do retorno
do perfil; o grupo lateral segue o mesmo comportamento expansível dos demais menus.
Estoque e Produtos começam ocultos. A visibilidade da navegação não autoriza RPCs:
o servidor continua validando usuário e perfil em cada consulta ou alteração.
Entrar no catálogo durante a carga do perfil retoma a consulta com a identidade
validada, descartando respostas vinculadas ao estado anterior.
As alterações no catálogo seguem o perfil geral: `admin` e `user` cadastram e
atualizam, `readonly` apenas consulta. Perfil e ativação são revalidados sob lock.
Essas permissões não concedem produtos, saldos, acesso a estudos ou classe restrita.
O catálogo contém metadados físicos, sem ocupação, estudos, produtos ou tratamentos.
O Drive também deve permitir leitura/edição de acordo com esses perfis: o app
executa como usuário e não altera automaticamente o compartilhamento dos arquivos.
`@IPS_LOCATIONS` é reservado internamente e não pode ser cadastrado como estudo.

O equipamento tem código interno/patrimonial exclusivo, tipo, fabricante/modelo,
sala, faixa operacional informada (ou pendente), situação e
de 1 a 100 posições internas. Na criação e edição, Gavetas numeradas permite informar
colunas e gavetas por coluna: 3 × 13 gera posições de 1 a 39; 1 × 5 gera de 1 a 5.
O objeto opcional `layout: {columns, drawersPerColumn}` guarda as dimensões para
representação futura, sem inferir a disposição física de registros antigos. O total
deve corresponder às posições (até 100). Posições personalizadas mantém a entrada
de uma por linha. A edição acrescenta posições, preservando os nomes exatos
de todas as posições existentes. Renomear ou excluir posições continua bloqueado
no servidor para preservar os vínculos históricos de estoque. A edição usa revisão
concorrente e registro de histórico. Situação pode mudar entre ativo, manutenção
e indisponível, com motivo e revisão concorrente, sem sobrescrever o histórico.
O formulário de equipamentos não solicita referência documental nem versão/data
da faixa. Esses campos foram removidos do cadastro e dos novos dados persistidos.
Os modais de editar equipamento e sonda usam campos e ações no padrão do app,
com Alterar situação / Atualizar calibração no rodapé, Cancelar e Salvar alterações.
A faixa informada não
comprova qualificação ou medição; referências de conservação dos produtos e
certificados de calibração das sondas continuam com suas regras próprias.

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

## Características do produto

Cadastro, edição e visualização incluem código do produto no estudo (`productCode`,
até 80 caracteres), forma farmacêutica (`dosageForm`, até 80), dosagem/concentração
(`strength`, até 120) e via de administração (`route`, até 80). São textos opcionais,
preenchidos conforme rótulo/documento autorizado; não representam dose administrada
ao participante nem revelam características ocultas pelo cegamento. Não há preenchimento
automático de registros anteriores. Apresentação/embalagem continua separada.

Os novos campos aparecem nas tabelas, busca, seleção de produto para inventário e
recebimento e no histórico do lote. Entram na distinção entre cadastros para permitir,
por exemplo, o mesmo nome/embalagem com concentrações diferentes, mantendo o ID como
vínculo estável. Edição documentada preserva valores omitidos; um texto vazio explícito
limpa o campo. O ledger mantém os valores anteriores, revisão, autoria e idempotência.

O modal de cadastro separa identificação/apresentação, controle do estoque e conservação.
Edição e visualização usam cabeçalho, campos e ações do padrão do app, com rodapé acessível
durante a rolagem. Lotes, kits e validade permanecem nos fluxos de inventário/recebimento.

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

## Consulta geral de produtos

Usuários ativos da equipe (incluindo somente leitura) podem consultar Produtos
de todos os projetos e do estoque comum, sem concessão de estoque. A RPC
getFarmaciaProdutos autoriza no servidor e retorna apenas identidade e campos
gerais do catálogo: apresentação, categoria, unidade, códigos gerais do produto,
forma farmacêutica, concentração, via, conservação e origem do fornecimento.
Não retorna autoria, datas de cadastro, lotes, kits, participantes, saldos,
localizações ou movimentações. Somente eventos de produto da classe autorizada
são interpretados, incluindo correções e exclusões lógicas.

A classe restrita continua exigindo concessão específica. Cadastro e edição
continuam exigindo manage por estudo/classe, revalidado sob lock. A tela de
Produtos usa a RPC própria e não consulta estoque; o seletor de Estoque continua
mostrando somente os projetos autorizados. Respostas atrasadas de outra área
não substituem a tela atual.
