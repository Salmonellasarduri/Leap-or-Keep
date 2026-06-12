---
name: qa-lenses
description: "Use when designing verification for a change: choosing test cases, deciding what proof is sufficient, reviewing whether checks cover the real risks, or when /debugging needs lens selection. Provides black-box QA lenses (boundary, state transition, regression, etc.), oracle discipline, risk-based prioritization, and complexity budgets."
metadata:
  version: 1.0.0
  origin: "Artificial Personality .agents/commands/_shared.md の QA Artifact Chain / Black-Box QA Knowledge 節を抽出・適応"
---

# qa-lenses — 検証設計の道具箱

Black-box QA design knowledge as a **risk lens**, not a mandate to create every possible case. Pick the smallest relevant lenses for the changed behavior.

## QA Artifact Chain

Carry enough QA structure from proof to completion that the final answer explains **why the change is ready**, not only what commands ran:

- `expectation_basis`: the source of expected behavior — user request, SPEC.md, tests, existing accepted behavior, owner answer, runtime evidence.
- `risk_register`: task-scoped risks prioritized P0–P3, what proof reduced each, what remains.
- `proof_coverage`: the checks that actually lower those risks.
- `gate_decision`: `go` / `conditional_go` / `no_go` with a short reason.

**Oracle discipline**: do not let AI invent an expected result. If expected behavior has no source, mark it `[要確認]` and treat the missing oracle as residual risk. `go` requires P0/P1 risks covered by evidence or explicitly non-applicable.

## Core Lenses

- `canonical_valid`: the happy path / representative valid state.
- `invalid_single_fault`: one broken precondition at a time, so the failure cause is attributable.
- `boundary3`: min-1 / min / min+1 and max-1 / max / max+1 for numeric, length, time, quota limits. (このゲームなら: 手札0/1/2枚、HP 0/1、デッキ上限、グリッド端のラップ)
- `rule_combo`: important rule combinations; decision-table thinking when rules interact. (例: ドリフト×衝突×ラップアラウンドの同時発生)
- `state_transition`: before/after state, repeated actions, cancellation, retry, interruption, resume. (例: 休息→ロスト→手札復帰、エンカウント間の状態引き継ぎ)
- `role_permission`: actor differences. (例: 船とドローンで同じカードが正しく動くか)
- `history_seed`: persisted state, duplicate events, previous failures. (例: レリックDeploy後のデッキ、ドローン撃破後の復帰HP)
- `external_dependency`: network/API/tool failures — このプロジェクトではほぼ非該当(オフライン単一HTML)。
- `environment_platform`: browser differences when relevant.
- `regression_surface`: existing accepted behavior that must remain unchanged.

Risk-based prioritization: high-impact, likely, hard-to-detect, persistence-touching risks move earlier (P0/P1).

## Test-Diff Heuristics

- A test needing oversized setup, deep object chains, or collapsed Arrange/Act/Assert/Cleanup phases is a **design-smell signal** on the production boundary, not just a test problem.
- Adding black-box cases is usually healthy. Deleting is acceptable when redundant/obsolete/wrong-oracle — record the reason.
- **Changing an existing test expectation is a high-signal event**: require a source proving a spec change or a wrong old oracle. Do not silently retune tests to match an implementation.
- Combinatorial explosion → consider a policy split, clearer state classification, or decision-table tests first.

## Complexity Budget

- `CC > 10`: warning — needs a short explanation, focused tests, or refactor candidate.
- `CC > 15`: refactor by default. Preferred escapes: early returns, extracting policy objects, explicit state categories, black-box case tables instead of branch-by-branch white-box tests.
