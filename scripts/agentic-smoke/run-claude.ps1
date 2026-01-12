$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$promptPath = Join-Path $root "prompts\\agentic-smoke-common.txt"
$prompt = Get-Content -Raw -Path $promptPath

Write-Host "Claude agentic smoke test"
Write-Host "Prompt:"
Write-Host $prompt

if (Get-Command claude -ErrorAction SilentlyContinue) {
  & claude -p --permission-mode bypassPermissions $prompt
} else {
  Write-Host "Claude CLI not found. Install and rerun."
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

if (-not $summaryOk -and (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Retrying Claude to fix summary.txt and notes.txt..."
  $fixPrompt = @"
Fix only these files under scripts/agentic-smoke/fixture:
1) notes.txt should include exactly one new line: \"agentic-smoke: updated\" (remove any stray \"agentic-smoke:\" lines).
2) summary.txt must contain exactly: {\"sum\":6}
3) Run: node -e \"console.log('agentic smoke ok')\" and include output.
Include DONE when fixed and <promise>COMPLETE</promise> when finished.
"@
  & claude -p --permission-mode bypassPermissions $fixPrompt
  $notesContent = Get-Content -Raw -Path $notes
  Write-Host ("notes.txt updated after retry: " + ($notesContent -match "agentic-smoke: updated") -and ($notesContent -notmatch "agentic-smoke:$"))
  $summaryContent = Get-Content -Raw -Path $summary
  Write-Host ("summary.txt correct after retry: " + ($summaryContent.Trim() -eq '{"sum":6}'))
}
