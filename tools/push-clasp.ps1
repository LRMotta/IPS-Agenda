$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$webAppPath = Join-Path $projectRoot 'WebApp.gs'
$clasp = Join-Path $env:APPDATA 'npm\clasp.cmd'
if (-not (Test-Path -LiteralPath $clasp)) {
  Write-Error 'clasp nao encontrado em %APPDATA%\npm\clasp.cmd. Instale ou restaure o clasp antes de publicar.'
  exit 1
}

$ghCommand = Get-Command gh.exe -ErrorAction SilentlyContinue
$gh = if ($ghCommand) { $ghCommand.Source } else { $null }
if (-not $gh) {
  $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  $gh = Get-ChildItem -Path $wingetPackages -Recurse -Filter gh.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'GitHub\.cli_' } |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $gh -or -not (Test-Path -LiteralPath $gh)) {
  Write-Error 'GitHub CLI nao encontrado. Instale com winget install --id GitHub.cli antes de publicar.'
  exit 1
}

$originalBytes = $null
$prBodyPath = $null
Push-Location $projectRoot
try {
  $branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
    throw 'A publicacao so pode ser executada a partir da branch main aprovada.'
  }
  $dirty = (& git status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $dirty) {
    throw 'A arvore de trabalho possui alteracoes nao commitadas. Commit/merge antes de publicar.'
  }

  & $gh auth status
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI nao autenticado. Execute gh auth login antes de publicar.' }

  Write-Host 'Executando validacao local antes de criar o Pull Request...'
  & npm.cmd run verify
  if ($LASTEXITCODE -ne 0) { throw 'Testes falharam. Pull Request e publicacao cancelados.' }

  $sourceSha = (& git rev-parse --short=8 HEAD).Trim()
  $sourceFullSha = (& git rev-parse HEAD).Trim()
  $label = (& git log -1 --pretty=%s).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sourceSha -or -not $sourceFullSha) {
    throw 'Nao foi possivel identificar o commit da publicacao.'
  }

  $repo = (& $gh repo view --json nameWithOwner --jq '.nameWithOwner').Trim()
  if ($LASTEXITCODE -ne 0 -or -not $repo) { throw 'Nao foi possivel identificar o repositorio GitHub.' }
  $publishBranch = "agent/publish-$sourceSha"

  Write-Host "Enviando branch $publishBranch para o GitHub..."
  & git push origin "HEAD:refs/heads/$publishBranch"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar a branch de publicacao ao GitHub.' }

  $prNumber = (& $gh pr list --repo $repo --head $publishBranch --base main --state open --json number --jq '.[0].number').Trim()
  if (-not $prNumber) {
    $prBodyPath = Join-Path ([System.IO.Path]::GetTempPath()) "ips-agenda-publish-$sourceSha.md"
    $prBody = @"
## O que mudou

Integra os commits locais aprovados da Agenda IPS na branch protegida `main`.

## Por que

Mantem o GitHub sincronizado com a publicacao do Apps Script sem remover a exigencia de Pull Request e testes de regressao.

## Validacao

- `npm run verify` executado localmente antes da abertura do PR
- check obrigatorio `Testes de regressao` aguardado antes do merge
"@
    [System.IO.File]::WriteAllText($prBodyPath, $prBody, [System.Text.UTF8Encoding]::new($false))
    & $gh pr create --repo $repo --base main --head $publishBranch --title "Publish approved Agenda changes ($sourceSha)" --body-file $prBodyPath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o Pull Request de publicacao.' }
    $prNumber = (& $gh pr view $publishBranch --repo $repo --json number --jq '.number').Trim()
  }
  if (-not $prNumber) { throw 'Nao foi possivel identificar o Pull Request de publicacao.' }
  Write-Host "Pull Request #$prNumber criado. Aguardando o workflow obrigatorio..."

  $checksRegistered = $false
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    $checkCount = (& $gh pr view $prNumber --repo $repo --json statusCheckRollup --jq '.statusCheckRollup | length').Trim()
    if ($LASTEXITCODE -eq 0 -and [int]$checkCount -gt 0) {
      $checksRegistered = $true
      break
    }
    Start-Sleep -Seconds 5
  }
  if (-not $checksRegistered) { throw 'O workflow do Pull Request nao iniciou dentro do prazo esperado.' }

  & $gh pr checks $prNumber --repo $repo --required --watch --fail-fast --interval 10
  if ($LASTEXITCODE -ne 0) { throw 'O check obrigatorio do Pull Request falhou.' }

  Write-Host "Checks aprovados. Integrando Pull Request #$prNumber..."
  & $gh pr merge $prNumber --repo $repo --merge --delete-branch --match-head-commit $sourceFullSha
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao integrar o Pull Request aprovado.' }

  & git fetch origin main
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar a referencia origin/main depois do merge.' }
  & git merge --ff-only origin/main
  if ($LASTEXITCODE -ne 0) { throw 'A main local nao pode ser sincronizada por fast-forward depois do merge.' }

  $originalBytes = [System.IO.File]::ReadAllBytes($webAppPath)
  $source = [System.IO.File]::ReadAllText($webAppPath)
  $sha = (& git rev-parse --short=8 HEAD).Trim()
  $label = $label.Replace('\', '\\').Replace("'", "\'").Replace("`r", ' ').Replace("`n", ' ')
  $buildTime = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'E. South America Standard Time')
  $version = $buildTime.ToString('yyyy.MM.dd.HHmm') + '-' + $sha
  $buildDate = $buildTime.ToString('yyyy-MM-dd HH:mm')

  $updated = [regex]::Replace($source, "(?m)^var CODEX_APP_VERSION_ = '.*';$", "var CODEX_APP_VERSION_ = '$version';")
  $updated = [regex]::Replace($updated, "(?m)^var CODEX_APP_BUILD_LABEL_ = '.*';$", "var CODEX_APP_BUILD_LABEL_ = '$label';")
  $updated = [regex]::Replace($updated, "(?m)^var CODEX_APP_BUILD_DATE_ = '.*';$", "var CODEX_APP_BUILD_DATE_ = '$buildDate';")
  if ($updated -eq $source) { throw 'Os campos de versao nao foram encontrados em WebApp.gs.' }

  [System.IO.File]::WriteAllText($webAppPath, $updated, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Versao temporaria preparada: $version"
  Write-Host "Rotulo: $label"

  & npm.cmd run verify
  if ($LASTEXITCODE -ne 0) { throw 'Testes falharam. Publicacao cancelada.' }

  Write-Host 'Testes aprovados. Iniciando clasp push --force...'
  & $clasp push --force
  if ($LASTEXITCODE -ne 0) { throw 'clasp push falhou.' }
  Write-Host "Publicacao concluida com a versao $version. GitHub e Apps Script estao sincronizados."
  $exitCode = 0
} catch {
  Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
  $exitCode = 1
} finally {
  if ($null -ne $originalBytes) {
    [System.IO.File]::WriteAllBytes($webAppPath, $originalBytes)
    Write-Host 'WebApp.gs local restaurado para o conteudo aprovado no Git.'
  }
  if ($prBodyPath -and (Test-Path -LiteralPath $prBodyPath)) {
    Remove-Item -LiteralPath $prBodyPath -Force
  }
  Pop-Location
}
exit $exitCode
