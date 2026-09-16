$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvRoot = Join-Path $projectRoot ".vendor\ocr-sidecar-venv"
$outputRoot = Join-Path $projectRoot "build-resources\ocr"
$workRoot = Join-Path $projectRoot ".vendor\ocr-sidecar-build"
$entry = Join-Path $PSScriptRoot "ocr-sidecar\mirror_ocr.py"
$requirements = Join-Path $PSScriptRoot "ocr-sidecar\requirements.txt"

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "The bundled PP-OCRv6 sidecar currently requires Windows x64."
}

$python = (Get-Command python -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $venvRoot "Scripts\python.exe"))) {
  & $python -m venv $venvRoot
}
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
& $venvPython -m pip install --disable-pip-version-check -r $requirements

if (Test-Path $outputRoot) { Remove-Item -LiteralPath $outputRoot -Recurse -Force }
if (Test-Path $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outputRoot, $workRoot | Out-Null

& $venvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name mirror-ocr `
  --distpath $outputRoot `
  --workpath (Join-Path $workRoot "work") `
  --specpath (Join-Path $workRoot "spec") `
  --collect-all rapidocr `
  --collect-all fitz `
  $entry

$builtDir = Join-Path $outputRoot "mirror-ocr"
$exe = Join-Path $builtDir "mirror-ocr.exe"
if (-not (Test-Path $exe)) { throw "OCR sidecar build failed: missing $exe" }

# Keep a stable executable location while preserving PyInstaller's dependency folder.
Move-Item -LiteralPath $exe -Destination (Join-Path $outputRoot "mirror-ocr.exe")
Get-ChildItem -LiteralPath $builtDir -Force | Move-Item -Destination $outputRoot
Remove-Item -LiteralPath $builtDir -Force

$liveTest = Join-Path $PSScriptRoot "ocr-sidecar\live_test.py"
& $venvPython $liveTest (Join-Path $outputRoot "mirror-ocr.exe")
if ($LASTEXITCODE -ne 0) { throw "OCR sidecar self-check failed (exit=$LASTEXITCODE)." }
Write-Host "PP-OCRv6 Sidecar ready: $outputRoot"
