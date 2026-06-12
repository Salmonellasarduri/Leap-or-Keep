# /debugging — Proof and Repair Loop

> origin: Artificial Personality `.agents/commands/debugging.md` (Codex版) を Fable / Leap-or-Keep 向けに適応。INANNA固有のlive-checkを除去し、ブラウザゲーム検証に置換。

## Purpose

Prove that the work satisfies its completion conditions, and repair it when proof fails.

## Done

- Every acceptance criterion has an observed check.
- Every expected observation has a named source or is marked `[要確認]` (needs oracle).
- The proof strength matches risk.
- Failures have been resolved or escalated with a clear blocker.
- Temporary test data and throwaway artifacts are cleaned up.

## Autonomy

Claude chooses the smallest sufficient proof: existing focused tests, new focused tests, one-line commands, browser checks (Claude Preview / Chrome MCP: screenshot + console + driving the game), or markdown path/link checks for docs.

Claude may add tests or diagnostic commands without asking when they are scoped and non-destructive.

For this project (browser game in a single HTML file), the proof surface includes:
- Open `index.html` in Claude Preview / Chrome, screenshot, and **read the screenshot yourself**.
- `read_console_messages` for JS errors after each interaction sequence.
- Drive actual play: select cards, end turns, verify drift/wrap/exhaustion/relic flows against SPEC.md.
- For game logic, prefer a seeded RNG + a headless smoke test (e.g., Node executing the extracted logic, or in-page `preview_eval` assertions) over eyeballing.

## Dispatch

- Use the **Explore agent** for locating relevant code paths or prior behavior.
- Use a **high-reasoning review agent** for unclear failures, state-machine bugs, or repeated failures of the same class.

## Must

- Inspect actual output, not just exit codes.
- Record the expectation basis before treating a check as proof: user request, SPEC.md, existing accepted behavior, test assertion, or owner answer.
- Do not promote an AI-guessed expected result into a proof. If the oracle is missing, keep it `[要確認]` and report it as residual risk.
- Select proofs through the black-box QA lenses (see `qa-lenses` skill): canonical valid, invalid single fault, boundary, rule combination, state transition, history/persistence, external dependency, environment, regression. Use only the lenses that can change the risk profile.
- Prefer `invalid_single_fault` for negative checks: break one precondition at a time.
- Keep added tests readable as Arrange / Act / Assert / Cleanup.
- Re-run the proof after each fix.

## Must Not

- Do not weaken acceptance criteria to make a check pass.
- Do not call work complete because a command ran without inspecting meaning.
- Do not leave `_test_` artifacts or temporary files behind.

## Iterate

Failure loop: 1. reproduce → 2. localize → 3. reduce → 4. fix root cause → 5. guard with a test/assertion if useful → 6. rerun proof.

If the same failure class recurs twice, dispatch an independent high-reasoning review agent.

## Stop Only When

- The expected behavior is a game-design / spec-level judgment (owner's call).
- The failure exposes a blocker outside the requested scope.

## Evidence

Report each proof as: command/check, expectation basis and oracle status (`supported` / `[要確認]` / `exploratory`), expected observation, actual observation, risk reduced, PASS/FAIL, cleanup performed.
