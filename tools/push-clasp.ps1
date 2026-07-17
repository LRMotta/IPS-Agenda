$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$webAppPath = Join-Path $projectRoot 'WebApp.gs'
$clasp = Join-Path $env:APPDATA 'npm\clasp.cmd'
if (-not (Test-Path -LiteralPath $clasp)) {
  Write-Error 'clasp nao encontrado em %APPDATA%\npm\clasp.cmd. Instale ou restaure o clasp antes de publicar.'
  exit 1
}

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

  $originalBytes = [System.IO.File]::ReadAllBytes($webAppPath)
  $source = [System.IO.File]::ReadAllText($webAppPath)
  $sha = (& git rev-parse --short=8 HEAD).Trim()
  $label = (& git log -1 --pretty=%s).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sha) { throw 'Nao foi possivel identificar o commit da publicacao.' }
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
  Write-Host "Publicacao concluida com a versao $version. Enviando main para o GitHub..."
  & git push origin main
  if ($LASTEXITCODE -ne 0) { throw 'A publicacao no Apps Script foi concluida, mas o git push origin main falhou.' }
  Write-Host 'GitHub atualizado com sucesso.'
  $exitCode = 0
} catch {
  Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
  $exitCode = 1
} finally {
  if ($null -ne $originalBytes) {
    [System.IO.File]::WriteAllBytes($webAppPath, $originalBytes)
    Write-Host 'WebApp.gs local restaurado para o conteudo aprovado no Git.'
  }
  Pop-Location
}
exit $exitCode
