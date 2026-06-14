# Agent QA findings

Leap or Keep の AI agent / INANNA 実走キャンペーンで得た運用知見を残す場所。
恒久的な再発防止は `tasks/lessons.md`、仕様採択は `SPEC.md` / `ROADMAP.md` へ昇格する。

## 2026-06-14 AP INANNA QA campaign M1 batch 1/5

Source:
- AP runs JSONL: `E:\Project\Artificial Personality\personality\context\leap_or_keep\qa\runs.jsonl`
- AP batch summary: `E:\Project\Artificial Personality\personality\context\leap_or_keep\qa\batch_summaries.jsonl`
- Seeds: `2026061601`-`2026061620`
- Runner: `scripts/run_leap_or_keep_qa_campaign.py --runs 20 --seed-start 2026061601 --batch-size 20 --persist-memory-every 20 --run-ordinal-start 1`

Result:
- 20 runs: 16 completed / 4 stuck / 0 error.
- INANNA memory persistence: 1 run, ordinal 20 only.
- Completed runs: all `win`, all zone 1.
- Scores: min 147 / max 198 / avg 163.2.
- Captain skew: `商人型` 15, `蛮勇型` 1.
- Stuck reason: `undo_repeat` 4.

Findings:
- The first blocker is agent-side, not core rules: INANNA repeatedly chose `undo` and returned to the same state.
- The dominant play pattern is shallow safe return. The notes repeatedly justify zone 1 return as non-cowardice / reliable carrying back.
- This is useful personality flavor, but weak QA coverage for deeper zones, burn usage, boss pressure, and multi-leg strategy.

Action taken in AP:
- QA runner now has an `undo` recovery guard. If the same state reappears after `undo` and other legal progress choices exist, the runner hides `undo` once for that state signature.
- If the guard cannot progress, the run still becomes `stuck`, preserving the bug signal.

Next strategy seed:
- Batch 2 should compare stuck rate after the undo guard.
- If zone 1 safe-return skew remains high, add an agent-facing exploration mode or score/contract pressure before changing game rules.
- Design candidates should be audited with `game-design-essence`: avoid a strictly-better choice, define the shining moment first, and measure whether burn / physical kills / return timing actually diversify.

## 2026-06-14 AP INANNA QA campaign M1 batch 2/5

Source:
- AP runs JSONL: `E:\Project\Artificial Personality\personality\context\leap_or_keep\qa\runs.jsonl`
- Seeds: `2026061621`-`2026061640`
- Runner: `scripts/run_leap_or_keep_qa_campaign.py --runs 20 --seed-start 2026061621 --batch-size 20 --persist-memory-every 20 --run-ordinal-start 21`

Result:
- 20 runs: 19 completed / 1 stuck / 0 error.
- INANNA memory persistence: 1 run, ordinal 40 only.
- Completed runs: all `win`, all zone 1.
- Scores: min 147 / max 182 / avg 159.0.
- Captain skew: `商人型` 18, `測量型` 1.
- Stuck reason: `undo_repeat` 1.
- Undo guard fired 9 times across 5 runs.

Findings:
- The AP-side undo guard reduced `undo_repeat` from 4/20 to 1/20, so the original issue is mainly agent-loop handling.
- The remaining stuck run still had many legal choices, so one guard attempt was not enough for every repeated state.
- Safe zone 1 return became even clearer: 35/35 completed runs across batches 1-2 ended at zone 1.

Action taken in AP:
- `undo_guard_attempts` default increased from 1 to 2.
- Batch summary index now uses campaign ordinal, so resumed batches are written as batch 2/3/... instead of repeating batch 1.

Next strategy seed:
- Batch 3 should verify whether `undo_repeat` reaches 0/20.
- If zone 1 remains dominant, treat it as an agent-goal / information-design problem before changing balance.
- Candidate extension: an explicit exploration QA mode that rewards reaching zone 2+ or assigns a contract pressure, then compare against normal INANNA mode.

## 2026-06-14 AP INANNA QA campaign M1 batch 3/5

Source:
- AP runs JSONL: `E:\Project\Artificial Personality\personality\context\leap_or_keep\qa\runs.jsonl`
- Seeds: `2026061641`-`2026061660`
- Runner: `scripts/run_leap_or_keep_qa_campaign.py --runs 20 --seed-start 2026061641 --batch-size 20 --persist-memory-every 20 --run-ordinal-start 41`

Result:
- 20 runs: 19 completed / 1 stuck / 0 error.
- INANNA memory persistence: 1 run, ordinal 60 only.
- Completed runs: all `win`, all zone 1.
- Scores: min 147 / max 177 / avg 158.7.
- Captain skew: `商人型` 19.
- Stuck reason: `undo_repeat` 1.
- Aggregate first 60 runs: 54 completed / 6 stuck / 0 error; all completed runs ended at zone 1.

Findings:
- The undo guard is good enough to keep the campaign moving, but not sufficient to eliminate all loops.
- Zone 1 safe return is now the dominant campaign finding, not an isolated sample artifact.
- Normal INANNA mode is useful for personality-flavored play logs, but weak as coverage for deeper mechanics.

Action taken in AP:
- Added QA-only `--objective explore --min-explore-zone 3`.
- In explore objective, when `keep` and `leap:*` are both legal before the target zone, the runner hides `keep`; it does not alter combat choices or survival escape at 1 HP.

Next strategy seed:
- Batch 4 should run exploration objective to force zone 2+ data without changing game rules.
- Compare normal vs explore on losses, stucks, burn/HP pressure, captain type, and whether deeper chronicle moments appear.

## 2026-06-14 AP INANNA QA campaign M1 batches 4-5/5 and 100-run summary

Source:
- AP runs JSONL: `E:\Project\Artificial Personality\personality\context\leap_or_keep\qa\runs.jsonl`
- AP batch summaries: `E:\Project\Artificial Personality\personality\context\leap_or_keep\qa\batch_summaries.jsonl`
- Batch 4 seeds: `2026061661`-`2026061680`
- Batch 5 seeds: `2026061681`-`2026061700`

Batch 4 result:
- Runner: `--objective explore --min-explore-zone 3 --max-turns 120`.
- 20 runs: 11 completed / 2 stuck / 7 error.
- Completed zones: zone 3 = 9, zone 2 = 2.
- Scores: min 66 / max 176 / avg 132.5.
- INANNA memory persistence: 0; ordinal 80 hit decision-side errors.
- Error cluster: `OSError: [Errno 22] Invalid argument` during decision.

Batch 5 result:
- Runner: same explore objective, after AP decision fallback was widened.
- 20 runs: 13 completed / 7 stuck / 0 error.
- Completed zones: zone 3 = 7, zone 2 = 6.
- Scores: min 87 / max 185 / avg 128.7.
- INANNA memory persistence: 1 run, ordinal 100 only.
- Stuck reasons: `undo_repeat` 4, `repeated_choice` 2, `max_turns_exceeded` 1.

100-run aggregate:
- 100 runs: 78 completed / 15 stuck / 7 error.
- INANNA memory persistence: ordinals 20, 40, 60, and 100. Ordinal 80 was not persisted because it errored.
- Completed zones: zone 1 = 54, zone 2 = 8, zone 3 = 16.
- Captain skew: `商人型` 70, `蛮勇型` 4, `測量型` 3, `技師型` 1.
- Scores: min 66 / max 198 / avg 151.0.
- QA guards fired: objective guard 45, undo guard 32.

Findings:
- Normal INANNA mode is stable and flavorful, but overwhelmingly returns at zone 1.
- Explore objective successfully exposes zone 2/3, but deeper play stresses the decision loop: `undo_repeat`, repeated legal id selection, and max-turns exhaustion rise.
- The strongest game-design signal is not immediate balance change. It is that the agent interface needs explicit objective modes: normal personality run, exploration coverage run, and possibly score-chase/contract run.
- `商人型` currently dominates because early safe return heavily maps to that captain type. This may be correct for normal mode, but explore mode should probably be evaluated with separate captain/type expectations.

AP fixes already made:
- `--persist-memory-every N` and campaign ordinals.
- QA-only undo recovery guard.
- Resumed batch index fix.
- `--objective explore --min-explore-zone`.
- Decision-side broad fallback for transient LLM/CLI bridge exceptions.

Recommended next implementation candidates:
- Add progress proof to QA decisions: if the same choice id or state recurs after fallback/guard, annotate the next prompt with the failed choice and suppress that exact id for one attempt.
- Keep objective metadata on QA records, and add it to keepsake/carryover context before the next forced-exploration memory batch so those memories are distinguishable from normal personality runs.
- Add LoK-side or AP-side agent protocol mode text: `normal`, `explore-to-zone-3`, `score-chase`, `contract-pressure`.
- Run a separate 20-run contract-pressure batch, e.g. `heavy,minefield` or `throttle`, only after objective metadata is recorded.

Review fixes applied in AP after this batch:
- CLI no longer exposes all-run `--persist-memory`; campaign memory persistence is interval-based only.
- Interval-less `persist_memory=True` is rejected by config validation.
- Custom memory persistence paths must be the expected filenames under the QA state dir, or the normal default AP memory paths.
- Distill failure now happens before any INANNA memory append, avoiding hidden partial carryover writes.

## 2026-06-14 LoK-side non-human undo budget

Source:
- AP production-like Opus API run after the AP-side guard.
- LoK agent protocol review: `agent/protocol.mjs`, `agent/cli.mjs`, `agent/mcp-server.mjs`, `agent/llm-driver.mjs`.

Finding:
- AP-side undo guards help INANNA through the AP runner, but direct MCP/CLI/API users still receive `undo` as a normal legal choice.
- A cleaner shared fix is to enforce undo as a finite non-human resource at the LoK agent protocol boundary.

Action taken in LoK:
- Agent protocol now applies an AI undo budget per boss chapter. Default is 2.
- `legalChoices` hides `undo` when the budget is exhausted.
- Direct `applyChoice("undo")` is rejected after exhaustion, so agents cannot bypass the legal list.
- Observations now show `AI undo残り n/N`, and the undo label includes remaining budget.
- CLI/LLM driver support `--undo-limit 0|N|unlimited`; MCP `lok_new_run` supports `undoLimit`.
- Legacy replay logs without `agentUndoLimit` remain unlimited for compatibility.

Verification:
- `npm run test:agent`: 278 passed.
- `npm test`: 281 passed.
- CLI smoke: `--undo-limit 0` shows `AI undo残り 0/0`.
