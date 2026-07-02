param(
  [string]$Path = ".\Estoque_de_Kits_Coleta.xlsx"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ExcelColumnNumber {
  param([string]$CellRef)
  $letters = ($CellRef -replace '[0-9]', '').ToUpperInvariant()
  $n = 0
  foreach ($ch in $letters.ToCharArray()) {
    $n = ($n * 26) + ([int][char]$ch - [int][char]'A' + 1)
  }
  return $n
}

function Get-ExcelText {
  param($Node)
  if ($null -eq $Node) { return "" }
  $texts = New-Object System.Collections.Generic.List[string]
  foreach ($t in $Node.SelectNodes(".//*[local-name()='t']")) {
    $texts.Add([string]$t.InnerText)
  }
  if ($texts.Count -gt 0) { return ($texts -join "") }
  return [string]$Node.InnerText
}

function Convert-ExcelSerialDate {
  param($Value)
  $n = 0.0
  if (-not [double]::TryParse([string]$Value, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) {
    return ""
  }
  if ($n -lt 1) { return "" }
  return ([datetime]"1899-12-30").AddDays([math]::Floor($n)).ToString("yyyy-MM-dd")
}

function Normalize-Text {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $s = $Value.Normalize([Text.NormalizationForm]::FormD)
  $chars = $s.ToCharArray() | Where-Object {
    [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark
  }
  return (($chars -join '').ToLowerInvariant() -replace '\s+', ' ').Trim()
}

if (-not (Test-Path -LiteralPath $Path)) {
  throw "Arquivo nao encontrado: $Path"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)

try {
  $sharedStrings = New-Object System.Collections.Generic.List[string]
  $sstEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/sharedStrings.xml" } | Select-Object -First 1
  if ($sstEntry) {
    $reader = [IO.StreamReader]::new($sstEntry.Open())
    [xml]$sst = $reader.ReadToEnd()
    $reader.Close()
    foreach ($si in $sst.SelectNodes("//*[local-name()='si']")) {
      $sharedStrings.Add((Get-ExcelText $si))
    }
  }

  $wbReader = [IO.StreamReader]::new(($zip.Entries | Where-Object { $_.FullName -eq "xl/workbook.xml" } | Select-Object -First 1).Open())
  [xml]$workbook = $wbReader.ReadToEnd()
  $wbReader.Close()

  $relReader = [IO.StreamReader]::new(($zip.Entries | Where-Object { $_.FullName -eq "xl/_rels/workbook.xml.rels" } | Select-Object -First 1).Open())
  [xml]$rels = $relReader.ReadToEnd()
  $relReader.Close()

  $relMap = @{}
  foreach ($rel in $rels.Relationships.Relationship) {
    $relMap[[string]$rel.Id] = [string]$rel.Target
  }

  $sheets = @()
  foreach ($sheet in $workbook.SelectNodes("//*[local-name()='sheet']")) {
    $rid = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
    $target = $relMap[$rid]
    if ($target.StartsWith("/")) { $fullName = $target.TrimStart("/") } else { $fullName = "xl/$target" }
    $entry = $zip.Entries | Where-Object { $_.FullName -eq $fullName } | Select-Object -First 1
    if (-not $entry) { continue }

    $reader = [IO.StreamReader]::new($entry.Open())
    [xml]$ws = $reader.ReadToEnd()
    $reader.Close()

    $sheetRows = @()
    foreach ($row in $ws.SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']")) {
      $values = @{}
      foreach ($cell in $row.SelectNodes("*[local-name()='c']")) {
        $col = Get-ExcelColumnNumber $cell.GetAttribute("r")
        $value = ""
        $formula = $cell.SelectSingleNode("*[local-name()='f']")
        if ($formula) {
          $value = "=" + [string]$formula.InnerText
        } else {
          $type = [string]$cell.GetAttribute("t")
          $vNode = $cell.SelectSingleNode("*[local-name()='v']")
          $rawValue = if ($vNode) { [string]$vNode.InnerText } else { "" }
          if ($type -eq "s") {
            $idx = 0
            if ([int]::TryParse($rawValue, [ref]$idx) -and $idx -ge 0 -and $idx -lt $sharedStrings.Count) {
              $value = $sharedStrings[$idx]
            }
          } elseif ($type -eq "inlineStr") {
            $value = Get-ExcelText $cell
          } else {
            $value = $rawValue
          }
        }
        $values[$col] = $value
      }
      $sheetRows += [pscustomobject]@{
        number = [int]$row.r
        values = $values
      }
    }

    $sheets += [pscustomobject]@{
      name = [string]$sheet.name
      dimension = [string]$ws.worksheet.dimension.ref
      rows = $sheetRows
      mergedRanges = @($ws.SelectNodes("//*[local-name()='mergeCell']") | ForEach-Object { [string]$_.ref })
    }
  }

  $main = $sheets | Where-Object { $_.name -eq "Suprimentos" } | Select-Object -First 1
  if (-not $main) { throw "Aba Suprimentos nao encontrada." }

  $headers = [ordered]@{
    "A" = "PROJETO"
    "B" = "KIT"
    "C" = "QTDE"
    "D" = "VALIDADE"
    "E" = "LOCALIZACAO"
    "F" = "NUMERO_PEDIDO"
    "G" = "DATA_PEDIDO"
    "H" = "QTDE_SOLICITADA"
    "I" = "RESPONSAVEL_PEDIDO"
    "J" = "OBSERVACOES"
  }

  $records = @()
  $lastKit = ""
  $lastProjeto = ""
  foreach ($row in $main.rows | Where-Object { $_.number -gt 1 }) {
    $v = $row.values
    $record = [ordered]@{
      linha = $row.number
      projeto = [string]$v[1]
      kit = [string]$v[2]
      qtde = [string]$v[3]
      validadeRaw = [string]$v[4]
      validadeISO = Convert-ExcelSerialDate $v[4]
      localizacao = [string]$v[5]
      numeroPedido = [string]$v[6]
      dataPedidoRaw = [string]$v[7]
      dataPedidoISO = Convert-ExcelSerialDate $v[7]
      qtdeSolicitada = [string]$v[8]
      responsavelPedido = [string]$v[9]
      observacoes = [string]$v[10]
    }

    $hasAny = $false
    foreach ($idx in 1..10) {
      if (-not [string]::IsNullOrWhiteSpace([string]$v[$idx])) { $hasAny = $true; break }
    }
    if (-not $hasAny) { continue }

    $record["kitHerdado"] = if ([string]::IsNullOrWhiteSpace($record.kit)) { $lastKit } else { $record.kit }
    $record["projetoHerdado"] = if ([string]::IsNullOrWhiteSpace($record.projeto)) { $lastProjeto } else { $record.projeto }
    $record["classificacao"] = "saldo"

    if (-not [string]::IsNullOrWhiteSpace($record.kit)) { $lastKit = $record.kit }
    if (-not [string]::IsNullOrWhiteSpace($record.projeto)) { $lastProjeto = $record.projeto }

    if ([string]::IsNullOrWhiteSpace($record.qtde) -and [string]::IsNullOrWhiteSpace($record.projeto) -and -not [string]::IsNullOrWhiteSpace($record.kit)) {
      $record["classificacao"] = "cabecalho_contexto"
    } elseif ([string]::IsNullOrWhiteSpace($record.kit) -and -not [string]::IsNullOrWhiteSpace($record.qtde)) {
      $record["classificacao"] = "saldo_com_kit_herdado"
    } elseif (-not [string]::IsNullOrWhiteSpace($record.numeroPedido) -or -not [string]::IsNullOrWhiteSpace($record.dataPedidoRaw) -or -not [string]::IsNullOrWhiteSpace($record.qtdeSolicitada)) {
      $record["classificacao"] = "saldo_com_pedido"
    }

    $records += [pscustomobject]$record
  }

  $numericValidity = $records | Where-Object { $_.validadeRaw -match '^\d+(\.\d+)?$' }
  $textValidity = $records | Where-Object { -not [string]::IsNullOrWhiteSpace($_.validadeRaw) -and $_.validadeRaw -notmatch '^\d+(\.\d+)?$' }
  $quantityRows = $records | Where-Object { $_.qtde -match '^-?\d+([.,]\d+)?$' }
  $pedidoRows = $records | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_.numeroPedido) -or
    -not [string]::IsNullOrWhiteSpace($_.dataPedidoRaw) -or
    -not [string]::IsNullOrWhiteSpace($_.qtdeSolicitada) -or
    -not [string]::IsNullOrWhiteSpace($_.responsavelPedido)
  }
  $saldoCandidateRows = $records | Where-Object {
    $_.qtde -match '^-?\d+([.,]\d+)?$' -and
    -not [string]::IsNullOrWhiteSpace($_.validadeRaw) -and
    -not [string]::IsNullOrWhiteSpace($_.kitHerdado) -and
    -not [string]::IsNullOrWhiteSpace($_.projetoHerdado)
  }
  $saldoImportavelRows = $saldoCandidateRows | Where-Object { $_.validadeRaw -match '^\d+(\.\d+)?$' }
  $saldoRevisaoRows = $saldoCandidateRows | Where-Object { $_.validadeRaw -notmatch '^\d+(\.\d+)?$' }

  $projects = $records |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.projeto) } |
    Group-Object { $_.projeto } |
    Sort-Object Count -Descending |
    ForEach-Object { [pscustomobject]@{ projeto = [string]$_.Name; linhas = $_.Count } }

  $normalizedProjects = $records |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.projeto) } |
    Group-Object { (Normalize-Text $_.projeto) } |
    Sort-Object Count -Descending |
    ForEach-Object {
      $first = $_.Group[0]
      [pscustomobject]@{
        projetoNormalizado = (Normalize-Text $first.projeto)
        exemplo = $first.projeto.Trim()
        linhas = $_.Count
      }
    }

  $kits = $records |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.kitHerdado) } |
    Group-Object { (Normalize-Text $_.projetoHerdado) + "||" + (Normalize-Text $_.kitHerdado) } |
    ForEach-Object {
      $first = $_.Group[0]
      [pscustomobject]@{
        projeto = $first.projetoHerdado
        kit = $first.kitHerdado
        linhas = $_.Count
      }
    } |
    Sort-Object projeto, kit

  $issues = [ordered]@{
    linhasSemProjetoMasComDados = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.projeto) -and (-not [string]::IsNullOrWhiteSpace($_.kit) -or -not [string]::IsNullOrWhiteSpace($_.qtde) -or -not [string]::IsNullOrWhiteSpace($_.observacoes)) } | Select-Object -First 30)
    linhasComQtdeSemKitProprio = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.kit) -and -not [string]::IsNullOrWhiteSpace($_.qtde) } | Select-Object -First 30)
    validadeTextual = @($textValidity | Select-Object -First 30)
    pedidoParcial = @($pedidoRows | Where-Object {
      [string]::IsNullOrWhiteSpace($_.numeroPedido) -or
      [string]::IsNullOrWhiteSpace($_.dataPedidoRaw) -or
      [string]::IsNullOrWhiteSpace($_.qtdeSolicitada) -or
      [string]::IsNullOrWhiteSpace($_.responsavelPedido)
    } | Select-Object -First 30)
    saldoSemLocalizacao = @($saldoCandidateRows | Where-Object { [string]::IsNullOrWhiteSpace($_.localizacao) } | Select-Object -First 30)
  }

  [pscustomobject]@{
    arquivo = $resolvedPath
    geradoEm = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    workbook = [pscustomobject]@{
      sheets = @($sheets | ForEach-Object { [pscustomobject]@{ name = $_.name; dimension = $_.dimension; mergedRanges = $_.mergedRanges.Count } })
      sharedStrings = $sharedStrings.Count
    }
    suprimentos = [pscustomobject]@{
      headersEsperados = $headers
      totalLinhasComDados = $records.Count
      projetosUnicos = @($projects).Count
      projetosUnicosNormalizados = @($normalizedProjects).Count
      kitsUnicosPorProjeto = @($kits).Count
      linhasComQtdeNumerica = @($quantityRows).Count
      linhasCandidatasSaldo = @($saldoCandidateRows).Count
      linhasSaldoImportavel = @($saldoImportavelRows).Count
      linhasSaldoParaRevisao = @($saldoRevisaoRows).Count
      linhasComValidadeNumerica = @($numericValidity).Count
      linhasComValidadeTextual = @($textValidity).Count
      linhasComPedido = @($pedidoRows).Count
      linhasComObservacoes = @($records | Where-Object { -not [string]::IsNullOrWhiteSpace($_.observacoes) }).Count
      linhasComKitVazio = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.kit) }).Count
      topProjetos = @($projects | Select-Object -First 20)
      topProjetosNormalizados = @($normalizedProjects | Select-Object -First 20)
      classificacoes = @($records | Group-Object classificacao | Sort-Object Name | ForEach-Object { [pscustomobject]@{ tipo = $_.Name; linhas = $_.Count } })
      contagemProblemas = [pscustomobject]@{
        linhasSemProjetoMasComDados = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.projeto) -and (-not [string]::IsNullOrWhiteSpace($_.kit) -or -not [string]::IsNullOrWhiteSpace($_.qtde) -or -not [string]::IsNullOrWhiteSpace($_.observacoes)) }).Count
        linhasComQtdeSemKitProprio = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.kit) -and -not [string]::IsNullOrWhiteSpace($_.qtde) }).Count
        validadeTextual = @($textValidity).Count
        pedidoParcial = @($pedidoRows | Where-Object {
          [string]::IsNullOrWhiteSpace($_.numeroPedido) -or
          [string]::IsNullOrWhiteSpace($_.dataPedidoRaw) -or
          [string]::IsNullOrWhiteSpace($_.qtdeSolicitada) -or
          [string]::IsNullOrWhiteSpace($_.responsavelPedido)
        }).Count
        saldoSemLocalizacao = @($saldoCandidateRows | Where-Object { [string]::IsNullOrWhiteSpace($_.localizacao) }).Count
      }
      problemas = $issues
    }
  } | ConvertTo-Json -Depth 8
} finally {
  $zip.Dispose()
}
