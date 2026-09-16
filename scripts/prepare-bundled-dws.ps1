$ErrorActionPreference = "Stop"

$version = "v1.0.54"
$assetName = "dws-windows-amd64.zip"
$repository = "DingTalk-Real-AI/dingtalk-workspace-cli"
$projectRoot = Split-Path -Parent $PSScriptRoot
$destinationDirectory = Join-Path $projectRoot "build-resources\dws"
$destination = Join-Path $destinationDirectory "dws.exe"

New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null

if (Test-Path -LiteralPath $destination) {
  $installedVersion = (& $destination version 2>$null | Out-String)
  if ($installedVersion -match [regex]::Escape($version)) {
    Write-Output "Bundled DWS $version is ready."
    exit 0
  }
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("mirror-dws-" + [guid]::NewGuid().ToString("N"))
$resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryDirectory)
New-Item -ItemType Directory -Path $resolvedTemporaryRoot -Force | Out-Null

try {
  $archive = Join-Path $resolvedTemporaryRoot $assetName
  $checksums = Join-Path $resolvedTemporaryRoot "checksums.txt"
  $releaseBase = "https://github.com/$repository/releases/download/$version"

  Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$assetName" -OutFile $archive
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/checksums.txt" -OutFile $checksums

  $checksumLine = Get-Content -LiteralPath $checksums | Where-Object { $_ -match ("\s+" + [regex]::Escape($assetName) + "$") } | Select-Object -First 1
  if (-not $checksumLine) { throw "The official DWS checksum entry was not found." }
  $expected = ($checksumLine -split "\s+")[0].ToUpperInvariant()
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actual -ne $expected) { throw "DWS checksum verification failed." }

  $expanded = Join-Path $resolvedTemporaryRoot "expanded"
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
  $binary = Get-ChildItem -LiteralPath $expanded -Recurse -Filter "dws.exe" -File | Select-Object -First 1
  if (-not $binary) { throw "dws.exe was not present in the official archive." }
  Copy-Item -LiteralPath $binary.FullName -Destination $destination -Force
  Write-Output "Downloaded and verified DWS $version."
}
finally {
  $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTemporaryRoot.StartsWith($systemTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTemporaryRoot).StartsWith("mirror-dws-")) {
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
