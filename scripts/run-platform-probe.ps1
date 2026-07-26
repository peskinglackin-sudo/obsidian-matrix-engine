param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("prepare", "finalize")]
  [string]$Mode,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Options
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
& node --import=tsx "$Root/spike/platform-runner/operator.ts" $Mode @Options
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
