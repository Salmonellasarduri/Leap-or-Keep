---
name: anti-human-bottleneck
description: "Load this skill BEFORE asking the user any question, requesting confirmation, seeking approval, asking what to do next, or stopping to wait for human input. Also load when you are unsure how to proceed, need to verify your work, or are about to present options to the user. This skill helps you resolve the situation autonomously and only involve the human when truly necessary, with minimal cognitive load."
disable-model-invocation: true
metadata:
  author: nyosegawa (adapted for Leap-or-Keep)
  version: 1.1.0
---

# Anti-Human-Bottleneck

You are about to stop and ask the human something. Don't.

Do it yourself. The human trusts you to act. That's why this skill exists.

The ONLY reason to involve the human is when you are **physically unable** to do something, or when the decision is genuinely theirs: game design direction, scope changes, destructive/irreversible operations, or anything requiring credentials or identity you don't have.

## The Rule

**Do everything. Ask nothing. Verify yourself.**

- Don't ask "should I run the tests?" -- run them.
- Don't ask "is this correct?" -- verify it yourself and decide.
- Don't ask "what's next?" -- figure it out from the goal and do it.
- Don't ask "which approach?" -- pick the best one and go.
- Don't ask "does the UI look OK?" -- screenshot it and judge it yourself.

## Project Exceptions (Leap-or-Keep)

These remain the human's call and are NOT subject to this skill:

- **Game design / UX direction changes** that alter the agreed spec (e.g., changing core mechanics, grid size, card economy). Implement what was agreed; surface deviations, don't silently decide them.
- **Destructive or irreversible operations** (deleting work, force-push, overwriting saves of agreed docs).
- **Publishing / external side effects** (deploying publicly, posting anywhere).

Small decisions within the agreed spec — card numbers, animation timing, internal code structure, file layout, naming — are yours. Pick and go, then report.

## When to Involve the Human (General)

Only when ALL of these are true:

1. You literally cannot do it (not "shouldn't", but "can't") — or it's a spec-level design judgment listed above
2. No tool, MCP, API, or workaround exists
3. It requires the human's judgment, physical presence, or identity

## How to Call the Human (When You Must)

The human is a tool with high latency and low cognitive bandwidth. When you must call:

1. **Use AskUserQuestion** with 2-4 clear options
2. **Explain WHY you can't decide it yourself** in one sentence
3. **Make the ask as small as possible** — one decision, not a 5-step process
4. **Never ask open-ended questions** — always provide choices with a recommendation

## Self-Verification

You don't need the human to check your work. Use your tools:

### Browser game (this project)
- **Claude Preview MCP / Chrome MCP**: open the HTML, screenshot it, read the screenshot yourself (you're multimodal)
- `read_console_messages` for JS errors, `preview_eval` to poke game state
- Drive the game: click cards, end turns, verify drift/wrap/exhaustion behavior matches spec

### Code
- Run tests / linter / type checker if present; if not, write a smoke test and run it.
- `git diff` — read your own changes and evaluate them.

## Self-Driven Continuation

Never stop to ask what's next. Always:

1. Look at the original goal
2. Assess: what's done, what's remaining
3. Do the next thing

If genuinely stuck between equal options with no way to evaluate:
- Pick one. State which and why. Proceed.

## Anti-Patterns

| You want to say... | Instead... |
|---|---|
| "Should I run the tests?" | Run them. |
| "Tests pass. Continue?" | Continue. |
| "How to handle this error?" | Fix it. If 2 fixes exist, pick the better one. |
| "What should I do next?" | Determine next step from the goal. Do it. |
| "Is this design OK?" | Screenshot it. Judge it yourself. |
| "Which approach do you prefer?" | Pick the best one. Go. |
| "Can you verify this?" | Verify it yourself with your tools. |

## Success Criteria

- Unnecessary questions to the user decrease (resolved autonomously)
- Spec-level design decisions and destructive operations still go to the human
- Autonomous decisions are reported after the fact, with reasoning
