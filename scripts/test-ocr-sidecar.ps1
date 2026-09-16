$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".vendor\ocr-sidecar-venv\Scripts\python.exe"
$executable = Join-Path $projectRoot "build-resources\ocr\mirror-ocr.exe"
$test = Join-Path $PSScriptRoot "ocr-sidecar\live_test.py"

if (-not (Test-Path -LiteralPath $python)) {
  throw "Missing OCR build test environment. Run npm run prepare:ocr first."
}
if (-not (Test-Path -LiteralPath $executable)) {
  throw "Missing OCR sidecar. Run npm run prepare:ocr first."
}

& $python $test $executable
if ($LASTEXITCODE -ne 0) { throw "OCR black-box test failed (exit=$LASTEXITCODE)." }
