$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$promptPath = Join-Path $root "prompts\\agentic-smoke-gemini.txt"
$prompt = Get-Content -Raw -Path $promptPath

Write-Host "Gemini agentic smoke test"
Write-Host "Prompt:"
Write-Host $prompt

if (Get-Command gemini -ErrorAction SilentlyContinue) {
  & gemini --approval-mode auto_edit --output-format json -- $prompt
} else {
  Write-Host "Gemini CLI not found. Install and rerun."
}

Write-Host ""
Write-Host "Basic checks:"
$fixture = Join-Path $root "fixture"
$notes = Join-Path $fixture "notes.txt"
$summary = Join-Path $fixture "summary.txt"
$calc = Join-Path $fixture "calc.js"

if (Test-Path $notes) {
  $notesContent = Get-Content -Raw -Path $notes
  Write-Host ("notes.txt updated: " + ($notesContent -match "agentic-smoke: updated"))
} else {
  Write-Host "notes.txt missing"
}

if (Test-Path $summary) {
  $summaryContent = Get-Content -Raw -Path $summary
  $summaryOk = $summaryContent.Trim() -eq '{"sum":6}'
  Write-Host ("summary.txt correct: " + $summaryOk)
} else {
  Write-Host "summary.txt missing"
  $summaryOk = $false
}

if (Test-Path $calc) {
  $calcContent = Get-Content -Raw -Path $calc
  Write-Host ("calc.js has sumNumbers: " + ($calcContent -match "sumNumbers"))
} else {
  Write-Host "calc.js missing"
}

if (-not $summaryOk -and (Get-Command gemini -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Retrying Gemini to fix summary.txt..."
  $fixPrompt = @"
Overwrite scripts/agentic-smoke/fixture/summary.txt with EXACT content {"sum":6}. Use write_file. Do not use markdown. The quotes around "sum" are required. Write exactly 9 characters: {"sum":6}. ASCII bytes: 7B 22 73 75 6D 22 3A 36 7D. Include DONE.
"@
  & gemini --approval-mode auto_edit --output-format json -- $fixPrompt
  $summaryContent = Get-Content -Raw -Path $summary
  Write-Host ("summary.txt correct after retry: " + ($summaryContent.Trim() -eq '{"sum":6}'))
}
