# Farmácia: primeira etapa de acesso

Implementação local da base de permissões, independente de `admin`, `user` e
`readonly`. Não importa a planilha da Farmácia nem habilita estoque, dispensação,
prescrição, dados por estudo ou informações unblinded.

## Administração

Em Usuários, editar **Acesso à Farmácia**:

| Valor persistido | Rótulo | Finalidade futura |
| --- | --- | --- |
| `none` | Sem acesso | Não abre a área |
| `read` | Consulta | Consultar dados autorizados |
| `operate` | Operação | Também registrar recebimentos, dispensações e devoluções |
| `manage` | Responsável pela Farmácia | Também liberar estoque, ajustar e reconciliar |

Nesta etapa os três níveis autorizados abrem somente a página inicial, sem dados.
Ser Admin não concede permissão farmacêutica automaticamente. Um usuário readonly
pode receber uma permissão de Farmácia independente, sem ganhar escrita nos outros
módulos. Apenas Admin altera essa concessão; perfil próprio e carga rápida não a
alteram. A auditoria registra autor, instante e valores anteriores/novos pelo fluxo
existente de administração de usuários.

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

## Fronteira do servidor

`getFarmaciaBootstrap` revalida o usuário ativo e sua permissão em cada consulta.
Retorna apenas nível, etapa e lista vazia de estudos. Não usa permissões do cliente
nem cache como autoridade. O menu e a rota também verificam a apresentação do
acesso. Respostas obsoletas são ignoradas ao reabrir, navegar ou trocar acesso.

`codexAssertFarmaciaAccess_` é privado e distingue `read`, `operate` e `manage`.
Qualquer solicitação com estudo é recusada nesta etapa, inclusive ID vazio ou `*`.
Não há atribuição automática de estudos, inferência de vínculo ou acesso unblinded.

Antes de criar RPCs com dados, implementar vínculo por ID estável de estudo e
política de cegamento no servidor e no armazenamento. Toda consulta de dados deve
exigir esse vínculo; toda mutação deve revalidar nível e vínculo sob lock. A guarda
sem estudo serve somente à área inicial, não autoriza consulta global de dados.

## Validação local

`npm.cmd run verify` e `npm.cmd run test:ui`. Os testes de Farmácia usam Users e RPCs
simulados, rede bloqueada e dados fictícios. Não substituem validação de um futuro
módulo farmacêutico com a equipe responsável. Publicação não faz parte desta etapa.
