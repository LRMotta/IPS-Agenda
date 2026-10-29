# Claude Code — IPS Agenda

Antes de qualquer trabalho, leia integralmente `AGENTS.md`. Para contexto técnico,
leia `HANDOFF_CLAUDE_CODE.md`; o estado atual do Git prevalece sobre o snapshot do handoff.

## Commits e publicação

- Comece com `git status --short`. Preserve mudanças preexistentes e identifique
  quais pertencem à tarefa antes de preparar o commit. Prefira `git add` com caminhos
  explícitos; não inclua todo o diretório sem revisar o diff.
- Quando o usuário solicitar commit, revise o diff, conclua as validações aplicáveis
  de `AGENTS.md` e faça o commit. Não peça novamente autorização já dada.
- Quando o usuário solicitar publicação, leia integralmente `PUBLICACAO_SEGURA.md`
  e conclua o fluxo autorizado, incluindo os commits necessários da entrega revisada.
- A permissão técnica em `.claude/settings.json` evita prompts para comandos
  conhecidos; não autoriza publicar sem pedido do usuário.
- Execute os comandos a partir da raiz deste projeto. No Windows, prefira
  `npm.cmd`. Use chamadas simples `git add ...`, `git commit ...` e
  `npm.cmd run push`, compatíveis com as regras de permissão.
- Use somente `npm.cmd run push` ou `npm.cmd run push:safe` para publicar.
  O publicador exige `main` limpa, faz as verificações, cria/reutiliza PR,
  aguarda checks, faz merge protegido, sincroniza e envia ao Apps Script.
  Não substitua isso por `git push`, `clasp push`, merge administrativo ou
  comandos que ignorem os gates. Não modifique o pipeline para conseguir passar.
- Verifique `gh auth status`. Se a credencial falhar, informe o erro e peça ao
  usuário para autenticar interativamente; não procure tokens nem os registre em arquivos.
- O envio pelo publicador não atualiza, por si só, a implantação ativa.
  Conclua o gate obrigatório no Chrome autenticado descrito em
  `PUBLICACAO_SEGURA.md`: editor remoto recarregado, metadados exatos e trecho
  funcional quando aplicável, nova versão na implantação ativa, badge `/exec`,
  smoke somente leitura e console.
- Se não houver integração com Chrome autenticado, ou se qualquer gate falhar,
  informe **publicação pendente** e identifique o passo restante.

## Configuração da sessão

As permissões compartilhadas ficam em `.claude/settings.json`. Após abrir ou
reiniciar o Claude Code nesta pasta, confira `/permissions` e aceite a confiança
no projeto se solicitado. Políticas administradas e regras `deny`/`ask` podem
prevalecer sobre `allow`. Não use bypass de permissões para resolver bloqueios.

Para o gate de navegador na CLI, configure a extensão oficial Claude in Chrome
no Google Chrome e inicie `claude --chrome`; confira a conexão com `/chrome`.
No app desktop, a mesma extensão fornece as ferramentas `mcp__claude-in-chrome__*`
(carregue-as com `ToolSearch` antes de usar). O Chrome deve estar autenticado na
conta Google que acessa o Apps Script. O navegador embutido do app não substitui
o gate: ele não usa a sessão autenticada do Chrome do usuário. As orientações
práticas do gate estão em `PUBLICACAO_SEGURA.md`; o gate já foi executado com
sucesso nesta configuração.

Referências oficiais:

- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/chrome
