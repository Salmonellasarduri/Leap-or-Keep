---
name: autonomous-milestone-runner
description: "Use when cutting a roadmap item into a bounded autonomous milestone that Claude should keep pursuing through trial-and-error for hours, such as game-balance tuning, flaky browser validation, or multi-iteration bug hunts. Requires a goal contract with completion conditions, stop conditions, checkpoints, and verification evidence."
metadata:
  version: 1.1.0-fable
  origin: "Artificial Personality .agents/skills/autonomous-milestone-runner (Codex), adapted for Claude Fable"
---

# autonomous-milestone-runner — 長時間自走マイルストーン

## Purpose

Turn a roadmap slice into a bounded milestone that Claude can pursue autonomously through repeated investigation, implementation, verification, and review until the milestone is complete or a defined stop condition is hit.

Use this when the hard part is not one patch, but many evidence-driven iterations: game-balance tuning, browser runtime validation, repeated playtest/log diagnosis, or a roadmap item whose completion needs several trial-and-error cycles.

## Done

- A single milestone is cut from the roadmap or current task list.
- The milestone has observable completion conditions and explicit non-goals.
- Stop conditions distinguish owner judgment from ordinary technical failure.
- The goal contract is stated before autonomous execution begins (or the user explicitly waived it).
- Claude has run autonomous implement → verify → review loops until completion or stop.
- Long-run checkpoints preserve state, evidence, failures, and next action.

## Trigger Fit

Use this skill when at least two are true:

- The user asks Claude to continue autonomously, run for hours, or keep trying until a condition is met.
- A roadmap/current-task item must be cut into a smaller milestone before work can start.
- The task requires runtime observation, repeated test/debug cycles, or adaptive patches.
- Previous one-shot fixes did not reach the outcome, and progress must be measured by behavior, not by patch count.

Do not use it for one obvious bug fix, routine docs edits, or simple one-command verification. Ask the owner first when success itself is undefined.

## Milestone Contract

Before implementation, define:

- **Objective**: one owner-visible sentence.
- **Source slice**: roadmap/current-task section and why this slice is small enough.
- **Completion conditions**: observed behavior, test result, log state, screenshot, metric, or diff proof.
- **source_refs**: user request, roadmap lines, accepted behavior, logs, tests, or owner answers that make expected results legitimate.
- **assumptions**: tactical assumptions Claude may use while iterating; distinguish them from owner judgments.
- **oracle_gaps**: expected behaviors that cannot yet be judged from available sources. Mark them `[要確認]` and do not let them become proof by guesswork.
- **primary_metric / primary_evidence**: the one measurement, log state, runtime observation, screenshot, or test result that most directly proves the milestone claim.
- **no_go_conditions**: failed critical proof, missing critical oracle, side-effect detection, primary metric below threshold at the stop review, invalidated assumption, or owner judgment required.
- **Non-goals**: nearby attractive work that must not be pulled in.
- **Stop conditions**: destructive action, external side effect, secrets, design/UX/spec-level choice, invalidated goal, or inability to verify.
- **Checkpoint cadence**: target interval for summarizing state; default 30-60 minutes for long runs.
- **Time budget**: a persistence target, not permission to bypass gates.
- **Verification ladder**: fastest focused proof first, then broader proof or live browser validation when focused proof passes.

If the contract cannot be written with observable completion conditions, stop and ask for the smallest missing owner decision.

## Autonomy

After the goal contract is in place, Claude may:

- choose technical implementation details,
- edit files within the milestone scope,
- add focused tests or diagnostics,
- run local commands, test suites, dry-runs, and log inspections,
- dispatch subagents (Agent tool / Workflow) for sidecar investigation or review,
- revise tactical implementation based on failed evidence,
- continue through repeated failures while the objective and stop conditions remain valid.

Keep moving until Done or Stop Only When. Do not pause for routine test selection, minor refactors inside scope, next-step choice, or whether to retry a failed check.

## Dispatch (Claude Fable mapping)

- Use the **Explore agent** for affected-file discovery, log interpretation, scope drift checks.
- Use **general-purpose agents** (worktree isolation when mutating in parallel) for bounded implementation slices with disjoint write sets.
- Use an **adversarial review agent** after two failed cycles with the same failure class, before high-risk changes, or when review must challenge the current approach.
- Use the **Workflow tool** when the iteration fans out (e.g., N balance scenarios verified in parallel) — only with explicit user opt-in.

Require subagent summaries with: 結論 / 根拠 / 未確定点 / 参照先.

## Iteration Loop

For each cycle:

1. State the current hypothesis and proof target.
2. Make the smallest scoped change or diagnostic step.
3. Run the closest relevant proof.
4. Record execution evidence: command/check, expected observation, actual observation, PASS/FAIL, evidence path or log pointer.
5. Inspect output meaning, not only exit code.
6. Record whether the primary metric/evidence moved.
7. If proof fails, classify the failure: implementation bug, weak assumption, invalid contract, environment blocker, owner judgment, missing oracle, or no-go condition.
8. Set checkpoint decision: `continue` when evidence moved toward the objective, `retry` when the next technical step is clear, or `stop` when a no-go/owner-judgment condition is hit.
9. Escalate dispatch when repeated failures stop producing new information.
10. Update the checkpoint note before long pauses or context-heavy transitions.

## Checkpoint Note

For long autonomous runs, maintain a short checkpoint in `tasks/todo.md` (create it if absent). Keep it concise:

- current milestone, source refs, active assumptions,
- oracle gaps still open,
- primary metric/evidence current value,
- latest verified state,
- failed approaches and why,
- active hypothesis and next action,
- checkpoint decision: `continue` / `retry` / `stop`,
- cleanup or process state,
- tests/logs proving the latest state.

Use `tmp/` for throwaway logs, screenshots, or scratch notes unless the user asked for a durable artifact.

## Must

- Keep the milestone smaller than the whole roadmap phase.
- Prefer behavior proof over code-shape proof.
- Keep the primary metric/evidence and no-go conditions visible across long loops; do not let passing incidental tests replace the milestone claim.
- Avoid overfitting to the latest failure: isolate one failed precondition at a time, cover state transitions and persistence, and check regression surfaces after adaptive fixes.
- Stop owner-visible scope creep early and return to the owner when the objective changes.
- Clean up temporary processes, test data, and generated artifacts before completion when they are not meant to persist.
- Report whether runtime changes are immediate or require reload/restart.

## Must Not

- Do not use a time budget as permission to run destructive or externally-visible operations.
- Do not silently change game design, UX direction, or roadmap priority.
- Do not broaden the milestone because nearby work is convenient.
- Do not count "a patch was made" as progress unless verification shows behavior moved toward completion.
- Do not leave servers, monitors, or helper processes running after the verification window unless the contract explicitly requires it.

## Stop Only When

- Completion conditions are met and review passes.
- A stop condition from the milestone contract is hit.
- Further progress requires owner value judgment, design/UX direction, secrets, destructive action, or external side effects.
- The evidence invalidates the milestone objective or makes completion unverifiable.
- The environment cannot support required verification and no safe substitute proof exists.

## Evidence

Completion summary must include:

- milestone objective and source slice,
- completion conditions and which proofs satisfied them,
- commands/logs/screenshots/metrics used as evidence,
- assumptions used, oracle gaps closed or still open,
- primary metric/evidence final value,
- checkpoint summary for long runs,
- remaining risks or explicit non-goals.
