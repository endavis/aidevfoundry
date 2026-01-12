$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$agent = "claude"

function Invoke-PkRun($text) {
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    & bun run src/cli/index.ts run $text -a $agent -x
  } elseif (Get-Command pk-puzldai -ErrorAction SilentlyContinue) {
    & pk-puzldai run $text -a $agent -x
  } else {
    Write-Host "pk-puzldai CLI not found. Install and rerun."
    return $false
  }
  return $true
}

Write-Host "pk-puzldai agentic smoke test"

$prompt = @'
Use view/edit tools only (no bash). Do not run shell commands.

Tasks (do all):
1) List files in scripts/agentic-smoke/fixture and read notes.txt and data.json.
2) Append exactly one line "agentic-smoke: updated" to notes.txt without removing existing lines.
3) Set summary.txt to exactly {"sum":6} (use edit to replace full contents if it exists).
4) Add and export function sumNumbers(numbers) { return numbers.reduce((a, b) => a + b, 0); } in calc.js without changing other functions.
5) Re-open notes.txt and summary.txt to confirm exact contents; fix if incorrect.

Include DONE after completing each task and <promise>COMPLETE</promise> when finished.
'@

Write-Host "Prompt:"
Write-Host $prompt

if ($agent -like "gemini*") {
  if (Get-Command gemini -ErrorAction SilentlyContinue) {
    $geminiPromptPath = Join-Path $root "prompts\\agentic-smoke-gemini.txt"
    $geminiPrompt = Get-Content -Raw -Path $geminiPromptPath
    & gemini --approval-mode auto_edit --output-format json -- $geminiPrompt       
  } else {
    Write-Host "Gemini CLI not found. Install and rerun."
  }
} else {
  Invoke-PkRun $prompt | Out-Null
}

Write-Host ""
Write-Host "Basic checks:"
$fixture = Join-Path $root "fixture"
$notes = Join-Path $fixture "notes.txt"
$summary = Join-Path $fixture "summary.txt"
$calc = Join-Path $fixture "calc.js"

if (Test-Path $notes) {
  $notesLines = Get-Content -Path $notes
  $updatedCount = ($notesLines | Where-Object { $_ -eq "agentic-smoke: updated" }).Count
  $hasBare = ($notesLines | Where-Object { $_ -eq "agentic-smoke:" }).Count -gt 0
  $notesOk = ($updatedCount -eq 1) -and (-not $hasBare)
  Write-Host ("notes.txt updated: " + $notesOk)
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
  $calcOk = $calcContent -match "sumNumbers"
  Write-Host ("calc.js has sumNumbers: " + $calcOk)
} else {
  Write-Host "calc.js missing"
}

if ((-not $notesOk) -or (-not $summaryOk) -or (-not $calcOk)) {
  Write-Host ""
  Write-Host "Retrying pk-puzldai to fix fixture files..."
  $fixInstructionPath = Join-Path $root "prompts\\agentic-smoke-pk-fix.txt"
  $fixPrompt = "Read and follow fix instructions in $fixInstructionPath. Use tools."
  if (Get-Command bun -ErrorAction SilentlyContinue) {
    & bun run src/cli/index.ts run $fixPrompt -a $agent -x
  } elseif (Get-Command pk-puzldai -ErrorAction SilentlyContinue) {
    & pk-puzldai run $fixPrompt -a $agent -x
  }
  if (Test-Path $notes) {
    $notesLines = Get-Content -Path $notes
    $updatedCount = ($notesLines | Where-Object { $_ -eq "agentic-smoke: updated" }).Count
    $hasBare = ($notesLines | Where-Object { $_ -eq "agentic-smoke:" }).Count -gt 0
    $notesOk = ($updatedCount -eq 1) -and (-not $hasBare)
    Write-Host ("notes.txt updated after retry: " + $notesOk)
  }
  if (Test-Path $summary) {
    $summaryContent = Get-Content -Raw -Path $summary
    $summaryOk = $summaryContent.Trim() -eq '{"sum":6}'
    Write-Host ("summary.txt correct after retry: " + $summaryOk)
  }
  if (Test-Path $calc) {
    $calcContent = Get-Content -Raw -Path $calc
    $calcOk = $calcContent -match "sumNumbers"
    Write-Host ("calc.js has sumNumbers after retry: " + $calcOk)
  }

  if ((-not $notesOk) -or (-not $summaryOk) -or (-not $calcOk)) {
    Write-Host ""
    if (Get-Command gemini -ErrorAction SilentlyContinue) {
      Write-Host "Falling back to Gemini CLI to complete fixture updates..."
      $geminiPromptPath = Join-Path $root "prompts\\agentic-smoke-gemini.txt"
      $geminiPrompt = Get-Content -Raw -Path $geminiPromptPath
      & gemini --approval-mode auto_edit --output-format json -- $geminiPrompt     
      if (Test-Path $notes) {
        $notesLines = Get-Content -Path $notes
        $updatedCount = ($notesLines | Where-Object { $_ -eq "agentic-smoke: updated" }).Count
        $hasBare = ($notesLines | Where-Object { $_ -eq "agentic-smoke:" }).Count -gt 0
        $notesOk = ($updatedCount -eq 1) -and (-not $hasBare)
        Write-Host ("notes.txt updated after gemini fallback: " + $notesOk)
      }
      if (Test-Path $summary) {
        $summaryContent = Get-Content -Raw -Path $summary
        $summaryOk = $summaryContent.Trim() -eq '{"sum":6}'
        Write-Host ("summary.txt correct after gemini fallback: " + $summaryOk)
      }
      if (Test-Path $calc) {
        $calcContent = Get-Content -Raw -Path $calc
        $calcOk = $calcContent -match "sumNumbers"
        Write-Host ("calc.js has sumNumbers after gemini fallback: " + $calcOk)
      }
    } else {
      Write-Host "Gemini CLI not available for fallback."
    }
  }
}
