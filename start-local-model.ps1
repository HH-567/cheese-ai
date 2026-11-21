param([string]$Device = 'Vulkan1', [int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$server = Join-Path $PSScriptRoot 'data/runtime/llama-b9203-vulkan/llama-server.exe'
$model = Join-Path $PSScriptRoot 'data/models/qwen2.5-0.5b-instruct-q4_k_m.gguf'
if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $model)) {
    throw 'The local llama.cpp runtime or Qwen model is missing from data/.'
}
if ($Port -lt 1 -or $Port -gt 65535) {
    throw 'Choose a valid port.'
}

$launch = @(
    '--model', './data/models/qwen2.5-0.5b-instruct-q4_k_m.gguf', '--alias', 'qwen2.5-0.5b', '--host', '127.0.0.1', '--port', "$Port",
    '--device', $Device, '--n-gpu-layers', '99', '--ctx-size', '16384', '--parallel', '1',
    '--no-webui', '--no-slots', '--cache-ram', '0', '--no-mmap'
)
Push-Location -LiteralPath $PSScriptRoot
try {
    & $server @launch
} finally {
    Pop-Location
}
exit $LASTEXITCODE
