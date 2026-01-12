---
description: "Continue executing temp-plan.txt with parallel PK-Poet agents"
argument-hint: "[--sequential] [--agent <name>]"
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*)
---

# Continue Plan Execution

You are executing the plan from `temp-plan.txt` in the project root. This plan outlines TUI/CLI enhancements for PuzldAI.

## Plan Summary

The plan has these main work streams that can run in parallel:

1. **UI Components** (Steps 2, 5)
   - Active Context display in status bar
   - Visual plan tree with collapse/expand

2. **Input & Commands** (Steps 3, 4)
   - File path autocomplete (`./`, `/add-dir`)
   - Persona modes (`/persona <style>`)

3. **Rich Rendering** (Step 6)
   - Markdown table ASCII rendering
   - Mermaid diagram ASCII rendering

4. **Magic Attach** (Step 7)
   - PDF text extraction
   - URL content scraping

## Execution Strategy

$ARGUMENTS

### Default: Parallel Execution

Spawn all 4 agents simultaneously:
```bash
pk-puzldai spawn ui-components-agent input-commands-agent rich-render-agent magic-attach-agent --parallel
```

### Sequential Execution (if `--sequential` flag)

Run agents one at a time in dependency order:
1. rich-render-agent (no dependencies)
2. magic-attach-agent (uses rich-render for output)
3. input-commands-agent (independent)
4. ui-components-agent (integrates all)

### Single Agent (if `--agent <name>` specified)

Run only the specified agent to work on its portion of the plan.

## Your Task

1. Read `temp-plan.txt` to understand the full context
2. Based on arguments, either:
   - Spawn all 4 agents in parallel (default)
   - Run sequentially if `--sequential`
   - Run single agent if `--agent <name>`
3. Monitor progress and report completion

## Progress Tracking

As work progresses, update `temp-plan.txt` by marking completed items:
- `[ ]` → `[x]` for completed steps
- Add notes about what was implemented

## Key Files Reference

```
.claude/agents/
├── ui-components-agent.md    # Active Context + Plan Tree
├── input-commands-agent.md   # Autocomplete + Personas
├── rich-render-agent.md      # Tables + Mermaid
├── magic-attach-agent.md     # PDF + URL attach
├── pk-poet-orchestrator.md   # Coordinator
├── gemini-research-agent.md  # Research support
└── codex-snippet-agent.md    # Code generation support
```

## Verification Checklist

After execution, verify:
- [ ] Active files display in status bar
- [ ] Plan tree renders and collapses
- [ ] `./` triggers file autocomplete
- [ ] `/persona borris` changes tone
- [ ] Markdown tables render as ASCII
- [ ] Mermaid diagrams render as ASCII
- [ ] `/attach file.pdf` extracts content
- [ ] `/attach https://...` scrapes content

## Start Execution

Begin by reading the plan and spawning the appropriate agents.
