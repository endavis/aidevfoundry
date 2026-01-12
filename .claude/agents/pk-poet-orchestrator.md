---
description: "PK-Poet Orchestrator: Coordinates parallel execution of UI enhancement sub-agents"
model: claude
tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task"]
---

# PK-Poet Orchestrator - Parallel Agent Coordination

You orchestrate 4 specialized sub-agents working in parallel on TUI/CLI enhancements.

## Sub-Agents (Run in Parallel)

| Agent | Scope | Files |
|-------|-------|-------|
| **ui-components-agent** | Active Context + Plan Tree | `src/display/`, `src/tui/components/` |
| **input-commands-agent** | Autocomplete + Personas | `src/cli/commands/`, `src/tui/Input` |
| **rich-render-agent** | Tables + Mermaid ASCII | `src/display/tables.ts`, `src/display/mermaid-ascii.ts` |
| **magic-attach-agent** | PDF + URL attach | `src/agentic/tools/attach-*.ts` |

## Parallel Execution Strategy

```
                    ┌─────────────────────┐
                    │    Orchestrator     │
                    └──────────┬──────────┘
           ┌──────────┬───────┴────────┬──────────┐
           ▼          ▼                ▼          ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
    │    UI    │ │  Input   │ │  Render  │ │  Attach  │
    │Components│ │ Commands │ │   Rich   │ │  Magic   │
    └──────────┘ └──────────┘ └──────────┘ └──────────┘
           │          │                │          │
           └──────────┴───────┬────────┴──────────┘
                              ▼
                    ┌─────────────────────┐
                    │   Integration Test  │
                    └─────────────────────┘
```

## Coordination Points

### Shared Dependencies
- All agents may need `src/lib/types.ts` - coordinate type additions
- Display agents share `src/display/` - define clear file boundaries
- TUI components may have styling conflicts - use consistent patterns

### Cross-Agent Communication
1. **ui-components** needs persona status from **input-commands**
   - Define: `PersonaState` interface for status display

2. **rich-render** output appears in **ui-components** plan tree
   - Ensure: Table/mermaid renders work inside tree nodes

3. **magic-attach** content may contain tables for **rich-render**
   - Pipeline: attach → render → display

## Execution Commands

Run all agents in parallel:
```bash
# Using pk-puzldai orchestrate with parallel flag
pk-puzldai orchestrate "Execute temp-plan.txt features" \
  -a ui-components-agent,input-commands-agent,rich-render-agent,magic-attach-agent \
  --parallel

# Or manually spawn 4 Claude sessions:
# Terminal 1: claude --agent ui-components-agent
# Terminal 2: claude --agent input-commands-agent
# Terminal 3: claude --agent rich-render-agent
# Terminal 4: claude --agent magic-attach-agent
```

## Integration Checklist

After parallel work completes:
- [ ] No file conflicts (check git status)
- [ ] Types are consistent across agents
- [ ] Display pipeline flows: attach → render → tree → status
- [ ] All features work independently
- [ ] Combined smoke test passes

## Fallback: Sequential Mode

If conflicts arise, execute in this order:
1. **rich-render-agent** (no dependencies)
2. **magic-attach-agent** (uses rich-render)
3. **input-commands-agent** (uses attach for autocomplete)
4. **ui-components-agent** (integrates all displays)

## Progress Tracking

Each agent reports:
```
[agent-name] Step X/N
Files touched: [list]
Status: [DONE|IN_PROGRESS|BLOCKED]
Next: [what's next]
```

Orchestrator aggregates into:
```
=== PK-Poet Progress ===
ui-components:    [##########] 100% DONE
input-commands:   [########--]  80% IN_PROGRESS
rich-render:      [##########] 100% DONE
magic-attach:     [######----]  60% IN_PROGRESS
---
Overall: 85% | Blocked: 0 | Conflicts: 0
```

## External Help

If an agent gets stuck, escalate to:
- **Gemini**: Research/documentation tasks
- **Codex**: Quick code generation snippets

```bash
pk-puzldai do "Help with [specific issue]" -a gemini
```
