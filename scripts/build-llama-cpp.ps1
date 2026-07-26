param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [Parameter(Mandatory = $true)][string]$OutputDir
)

$ErrorActionPreference = "Stop"
$ExpectedCommit = "22b208b1cacb67bae191b00d795dae7cc819edb8"
$ActualCommit = (git -C $SourceDir rev-parse HEAD).Trim()
if ($ActualCommit -ne $ExpectedCommit) { throw "LLAMA_COMMIT_INVALID" }
$Dirty = @(git -C $SourceDir status --porcelain)
if ($Dirty.Count -ne 0) { throw "LLAMA_SOURCE_DIRTY" }

cmake -S $SourceDir -B "$OutputDir/build" -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DGGML_METAL=OFF
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
cmake --build "$OutputDir/build" --config Release --target llama-server --parallel
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$Candidates = @(
  "$OutputDir/build/bin/Release/llama-server.exe",
  "$OutputDir/build/bin/llama-server.exe"
)
$Binary = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($null -eq $Binary) { throw "LLAMA_BINARY_MISSING" }
Copy-Item $Binary "$OutputDir/llama-server.exe" -Force
node "$PSScriptRoot/write-llama-build-manifest.mjs" `
  --source $SourceDir --build "$OutputDir/build" --binary "$OutputDir/llama-server.exe" `
  --target windows-vulkan --output "$OutputDir/build-manifest.json"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
