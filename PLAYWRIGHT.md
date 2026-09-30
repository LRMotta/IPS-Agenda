# Testes locais da Agenda

Na pasta do repositorio, execute no PowerShell:

```powershell
npm.cmd run test:ui
```

O runner reutiliza o pacote `playwright` instalado em
`$env:USERPROFILE\Documents\IPS-Testes-Playwright\node_modules\playwright`.
Tambem aceita uma instalacao no repositorio ou um caminho explicito:

```powershell
$env:PLAYWRIGHT_MODULE_PATH = 'C:\caminho\node_modules\playwright'
npm.cmd run test:ui
```

Caso o Chromium ainda nao esteja instalado, execute na pasta que contem o
pacote Playwright `npx.cmd playwright install chromium`. O navegador e instalado
no perfil do usuario; estes comandos nao exigem administrador.

Os testes carregam os arquivos locais de estrutura, estilos e scripts da Agenda.
Todas as RPCs sao simuladas e qualquer requisicao de rede e bloqueada. Nao ha
acesso a planilhas, Calendar, Gmail ou dados reais. Os cenarios de salvamento
isolam o tratamento de respostas; as validacoes de dominio continuam cobertas
pela suite Node. Estes testes nao substituem o smoke test da implantacao.

Ha cenarios de kits, resumo de participante, respostas concorrentes de
salvamento/movimentacao, busca historica e recibos em outro fuso. As capturas
desktop/celular ficam em `$env:TEMP\ips-agenda-playwright`; defina
`PLAYWRIGHT_ARTIFACTS_DIR` para escolher outra pasta.

`npm.cmd run verify` permanece a verificacao completa de sintaxe, lint e
regressao Node. Execute tambem `npm.cmd run test:ui` ao alterar a Agenda.
