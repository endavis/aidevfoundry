# IMPLEMENTATION_PLAN.md

## Goal
Fix `pk-puzldai` so that:

1. Claude runs in `-p/--print` mode without the "Input must be provided…" error.
2. The TUI banner/status area consistently shows the Factory (droid) agent alongside Claude/Gemini/etc.
3. Codex can be selected in the UI and its availability is reported correctly.

## Phases (one mergeable phase at a time)

### Phase 1 — Fix Claude `--tools` argument parsing (and add oracle)
- Reproduce: `claude -p ... --tools "" "hello"` fails because `--tools <tools...>` greedily consumes the positional prompt.
- Add a unit test that asserts we pass `--tools=` (equals form) so the prompt stays positional.
- Update `src/adapters/claude.ts` to use `--tools=` when disabling tools.
- Run `bun test` (and typecheck if needed).

### Phase 2 — Always render Factory in the banner/status panel
- Update `src/tui/components/Banner.tsx` so the 6th agent row is not dependent on changelog length.
- Ensure the banner still stays within layout constraints.

### Phase 3 — Allow selecting Factory in the Agent picker
- Update `src/tui/components/AgentPanel.tsx` to include `factory` (and show readiness).

### Phase 4 — Config robustness (only if needed after verification)
- If existing user configs cause codex/factory to remain disabled unexpectedly, implement a *deep merge* with defaults in `src/lib/config.ts` (without overriding explicit user settings).

### Phase 5 — Validators
- Run: `bun test` and `npm run typecheck` (or project equivalents).

### Phase 6 — Adversarial pass
- Empty/whitespace prompts, very long prompts, prompts containing quotes/newlines.
- Windows-specific arg parsing (.cmd shims, PATH resolution).
- Ensure “disable tools” doesn’t break Claude prompt delivery.
