# Farmácia: acesso geral, estudos e informações restritas

Base de permissões independente de `admin`, `user` e `readonly`, com concessões
explícitas por estudo e autorização adicional para informações restritas.
O cadastro de produtos e inventário inicial está descrito em
[FARMACIA_ESTOQUE.md](FARMACIA_ESTOQUE.md). Não há importação automática da planilha
existente, dispensação, prescrição ou conteúdo de alocação de tratamento.

## Administração

Em Usuários, editar **Acesso à Farmácia**:

| Valor persistido | Rótulo | Finalidade futura |
| --- | --- | --- |
| `none` | Sem acesso | Não abre estoques de estudos; acesso comum é independente |
| `read` | Consulta | Consultar dados autorizados |
| `operate` | Operação | Também registrar recebimentos, dispensações e devoluções |
| `manage` | Responsável pela Farmácia | Também liberar estoque, ajustar e reconciliar |

Os três níveis autorizados abrem o índice com os estudos concedidos ao usuário.
O nível geral aplica-se apenas nesses estudos. `none` bloqueia toda a Farmácia,
preservando a seleção para evitar perda acidental. Nenhum estudo é concedido por padrão.
Ser Admin não concede permissão farmacêutica automaticamente. Um usuário readonly
pode receber uma permissão de Farmácia independente, sem ganhar escrita nos outros
módulos. Apenas Admin altera essa concessão; perfil próprio e carga rápida não a
alteram. A auditoria registra autor, instante e valores anteriores/novos pelo fluxo
existente de administração de usuários.

## Concessão por estudo

Em **Usuários > Editar > Estudos autorizados na Farmácia**, selecionar cada estudo
e, somente quando houver definição da equipe responsável, marcar **Informações
restritas**. Selecionar um estudo não marca essa opção automaticamente. Nem Admin
nem Responsável pela Farmácia têm acesso implícito a outros estudos ou a conteúdo
restrito. A opção não executa quebra de cegamento e não substitui a definição de
delegação e procedimentos do estudo pela equipe.

O usuário autorizado pode selecionar um estudo e consultar seu próprio nível,
a existência da autorização adicional e o estoque da classe escolhida, quando o
armazenamento dedicado estiver configurado. Não são retornados dados de
participantes, braço ou alocação de tratamento.

## Compatibilidade e armazenamento

- Coluna opcional I de `Users`, com cabeçalho exato `Acesso à Farmácia`
  (comparação sem acentos e sem distinção entre maiúsculas/minúsculas).
- Contas sem valor reconhecido ou sem o cabeçalho ficam sem acesso, inclusive Admin.
- Leituras não criam cabeçalhos. Só salvar usuário com o campo explicitamente
  informado prepara I, validando E:I antes da primeira escrita. Coluna ocupada com
  outro cabeçalho ou com dados sem cabeçalho bloqueia o salvamento sem sobrescrever
  o conteúdo ou transformar valores antigos em concessões.
- Clientes legados que omitam o campo preservam a permissão atual; contas novas
  sem concessão ficam sem acesso. Nenhum lote migra permissões existentes.
- O salvamento revalida Admin sob document lock e registra a mudança na auditoria.
- Coluna opcional J de `Users`, com cabeçalho `Estudos da Farmácia (JSON)`. Contém
  somente IDs e flags de autorização: `[{"studyId":"ID_ESTAVEL","restricted":false}]`.
  Não contém informações clínicas. Até 200 estudos e 40.000 caracteres por célula.
- JSON inválido, IDs vazios/coringas/duplicados, flags que não sejam booleanos ou
  cabeçalho alheio negam a lista inteira. A escrita explícita rejeita payload inválido.
- Campo omitido preserva J byte a byte. `[]` revoga os vínculos. Perfil próprio e
  carga rápida não podem alterar J. Cabeçalhos E:J são validados antes das escritas.
- O formulário envia o valor original de J. Se outra edição o alterou enquanto o
  Admin preenchia ou aguardava o lock, o servidor exige reabrir o cadastro.
- Vínculos com estudos removidos são apresentados como indisponíveis, preservados
  e revogáveis. Não concedem dados nem podem receber elevação de autorização.
- O catálogo lê apenas Projetos A:C, usa ID exato e exclui IDs duplicados. Não faz
  associação por nome, título de aba, código, posição da linha ou aproximação.

## Fronteira do servidor

`getFarmaciaBootstrap` revalida o usuário ativo e sua permissão em cada consulta.
Retorna apenas nível e identidade/rótulos dos estudos autorizados. O catálogo
completo é retornado somente ao Admin pelo bootstrap administrativo. Não usa
permissões do cliente nem cache como autoridade. Menu e rota também verificam
o acesso. Respostas obsoletas são ignoradas ao reabrir, navegar, trocar estudo,
revalidar o índice ou alterar acesso.

`codexAssertFarmaciaAccess_` é privado e distingue `read`, `operate` e `manage`.
Com ID de estudo, exige concessão explícita e existência do ID no catálogo atual.
Com terceiro argumento `true`, também exige `restricted: true` nesse vínculo.
`getFarmaciaEstudo(studyId)` usa a guarda e retorna somente o contexto mínimo
da própria autorização. ID ausente, vazio, coringa ou não concedido é recusado.

Antes do uso real, definir a política de cegamento e configurar os arquivos e suas
permissões conforme FARMACIA_ESTOQUE.md. As concessões ficam na ACL `Users`, como os perfis atuais; esconder
informações na interface não protege conteúdo que possa ser aberto diretamente
em uma planilha compartilhada. Não colocar conteúdo restrito nesse armazenamento
sem resolver suas permissões de acesso direto.

Toda consulta de dados futura deve exigir ID de estudo; conteúdo restrito deve
usar também a autorização adicional. Mutações revalidam nível e vínculo sob lock.
A guarda sem estudo serve somente ao índice, não autoriza consulta global de dados.

## Validação local

`npm.cmd run verify` e `npm.cmd run test:ui`. Os testes de Farmácia usam Users e RPCs
simulados, rede bloqueada e dados fictícios. Não substituem validação de um futuro
módulo farmacêutico com a equipe responsável. Publicação não faz parte desta etapa.

## Estoque comum

O estoque comum tem concessão independente em Users K, **Acesso ao estoque comum
da Farmácia**, com `none`, `read`, `operate` e `manage`. Não concede estudos nem
informações restritas. Um usuário com somente esta concessão pode abrir Farmácia.
Admin configura o nível no formulário de usuário; campos omitidos são preservados,
cabeçalho conflitante bloqueia gravação e alteração concorrente exige reabrir o formulário.
O armazenamento e as permissões de arquivo são separados dos estudos; consulte
[FARMACIA_ESTOQUE.md](FARMACIA_ESTOQUE.md). Alterações locais, sem migração real.
