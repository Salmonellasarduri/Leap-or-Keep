# /save — Save Autopilot

> origin: Artificial Personality `.agents/commands/save.md` (Codex版) を Fable / Leap-or-Keep 向けに適応。INANNA固有ゲート(inanna-skill-validate等)を除去し、未初期化リポジトリ対応を追加。

## Purpose

Persist completed work with minimal user involvement: update scoped documentation, stage only intended files, commit, and push automatically when safety checks are green.

## Done

- Verification (/debugging equivalent) evidence exists.
- Review verdict is LGTM (built-in /code-review or self-review for low-risk diffs).
- User explicitly approved save (`せーぶ`, `/save`, or equivalent).
- Relevant docs (SPEC.md, README, tasks/todo.md) are updated or intentionally skipped.
- Only intended files are staged. Commit succeeds.
- Push succeeds when safety checks are green AND a remote exists; otherwise commit-only completion is reported.
- The user receives a short outcome summary, not a branch/upstream tutorial.

## Autonomy

After explicit approval, Claude may update docs, stage intended files, commit with project conventions, and push without additional confirmation when safety checks are green.

Treat `せーぶ` as approval for **commit + safe auto-push**. Keep branch/upstream/push mechanics internal unless a red-light condition requires user choice.

**This project**: if the directory is not yet a git repository, `/save` may run `git init` + create an initial `.gitignore` (tmp/, *.bak, node_modules/) as part of the first save. No remote is configured by default — commit-only is the normal green path until the owner adds one.

## Must

- Run `git status --short` and `git diff --stat` first.
- Respect unrelated dirty work; stage explicit paths only.
- Keep throwaway artifacts (tmp/, screenshots, scratch logs) out of commits; add `.gitignore` rules rather than committing them.
- Check push safety internally when a remote exists: branch/upstream, fetch, behind/ahead, secret-like filenames/content, unexpectedly large diff. Treat the push range as the full `@{u}..HEAD` range.
- Auto-push only when all green: not on `main`/`master` (or owner has said main-direct is fine for this solo project), upstream resolvable, fetch succeeds, no divergence, range contains only intended reviewed commits, no secret-like content.
- If a red-light condition appears, stop and present a concise A/B/C choice set, recommended option first and labeled `(Recommended)`, with reason and impact per option.
- Commit messages: short Japanese or English summary line; end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Must Not

- Do not run `/save` without explicit user approval.
- Do not use blanket `git add .` when unrelated changes exist.
- Do not push with secret-like content, remote divergence, or ambiguous upstream.
- Do not rewrite unrelated docs for style.
- Do not ask whether to push when green conditions hold; approval already covered safe auto-push.
- Do not offer force push, destructive rollback, or reverting unrelated user changes as red-light options.

## Iterate

If documentation updates create conflicts or stale reads, reread and reapply narrowly. If review becomes stale due to substantive changes, re-review before committing.

## Evidence

Completion summary: what was committed (files + one-line intent), commit hash, push status (pushed / commit-only: no remote / blocked: reason), docs updated or skip reason.
