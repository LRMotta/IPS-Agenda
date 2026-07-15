$ErrorActionPreference = 'Stop'

$clasp = Join-Path $env:APPDATA 'npm\clasp.cmd'
if (-not (Test-Path -LiteralPath $clasp)) {
  Write-Error 'clasp nao encontrado em %APPDATA%\npm\clasp.cmd. Instale ou restaure o clasp antes de publicar.'
  exit 1
}

Write-Host 'Testes aprovados. Iniciando clasp push --force...'
& $clasp push --force
exit $LASTEXITCODE
