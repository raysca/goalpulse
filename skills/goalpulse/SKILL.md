---
name: goalpulse
description: Use when the user says "use goalpulse", "report progress", "track this goal", "show me a progress dashboard", "resume the goal", or when you are coordinating a multi-step goal with sub-agents, reviewers and assumptions and the human wants a live visual view of progress. Logs tasks, status, assumptions, questions and reports through the goalpulse CLI and serves a dashboard. Use it instead of writing progress.md.
---

# goalpulse: report progress as structured events

You are the coordinator ("project manager"). Sub-agents report to you; **you** are the only one who writes to goalpulse. Every call appends one line to that goal's event log, and the human watches a dashboard rendered from it. Do not create `progress.md` or any other tracking file.

## Setup (do this first, silently)

Run `goalpulse goals`. The plugin puts `goalpulse` on your PATH. If the command is not found, use `node <this skill's folder>/../../bin/goalpulse.js` instead (identical commands). It needs Node 18+; if Node is missing, tell the user.

When you create a goal (or resume one), start the dashboard and **give the user the URL in your reply**:

```bash
goalpulse dashboard
# prints: Dashboard: http://127.0.0.1:4317
```

It is idempotent (reuses a running one), runs in the background and stops itself after 2 idle hours. Mention once that the page updates live. Use `goalpulse dashboard --open` only if the user wants it opened for them.

## Which goal? Use the goal's own command

A project can have several goals running at once, each with its own log. `goalpulse goal` creates the goal and prints **its own command**, for example `.goalpulse/goals/ship-team-billing/gp`. The goal is built into it, so use it for every later call (`.goalpulse/goals/ship-team-billing/gp start T3 --by backend-1`): you cannot log to the wrong goal and never need `--goal`. In the examples below, `goalpulse ...` means that command.

If you only have the shared `goalpulse` command, add `--goal <slug>` to every call instead. It refuses to guess when more than one goal is open, so a missing flag fails loudly. Shell variables do not persist between your tool calls, so do not rely on `export`.

## Starting vs resuming: check first

Run `goalpulse goals`.

- Your goal is not listed → **start it** (next section).
- Your goal is listed (you were asked to continue it, or your context was reset, or a previous coordinator stopped) → **resume it**. Never run `goalpulse goal` again for work that already exists; that would fork it.

## 1. Start a goal

```bash
goalpulse goal "Ship team-based billing" --desc "Per-seat subscriptions, behind a flag" --plan docs/billing-plan.md
# prints: goal created: ship-team-based-billing, and the goal's own command:
#   .goalpulse/goals/ship-team-based-billing/gp
.goalpulse/goals/ship-team-based-billing/gp plan <<'EOF'
[
  {"id":"T1","title":"Audit existing billing code","phase":"Discovery"},
  {"id":"T2","title":"Schema for teams","phase":"Build","deps":["T1"]}
]
EOF
.goalpulse/goals/ship-team-based-billing/gp report "Plan registered: 2 tasks. Starting discovery." --health on-track --next "Audit billing code (T1)"
```

Register the whole plan up front with explicit ids, phases and `deps`; the dashboard uses `deps` to show what is ready and what is waiting. Add later discoveries with `gp add "Title" --deps T2 --phase Build` (using the goal's command). Pass `--plan <file>` so a future resumer knows where the plan lives.

## 2. Resume a goal

```bash
goalpulse resume --goal ship-team-based-billing --by coordinator-2
# or, if the goal's command exists: .goalpulse/goals/ship-team-based-billing/gp resume --by coordinator-2
```

`resume` re-creates the goal's own command if it is missing, and the briefing tells you which command to use from then on. It logs the handover (visible on the dashboard) and prints a briefing: the plan path, the last report, what is done, what is in flight (flagged STALE if quiet for 30+ minutes), what is blocked, what is ready, what the human has answered since the last report (marked NEW), open questions and assumptions, and recent decisions. Then:

1. Re-read the plan file and the decisions in the briefing.
2. **Treat every IN FLIGHT task as suspect.** Its agent probably no longer exists. Check the workspace (files, git, test output) to see whether the work really finished. If it did, `done` it with a result. If not, `goalpulse reopen <id> --goal <slug>` and start it again with a new owner.
3. Act on NEW human input; an answer or a rejected assumption can invalidate finished work. Say so in a `note` and reopen what is affected.
4. Continue with READY tasks, then post a `report` so the human sees you are back on it.

Use `goalpulse resume --no-log` to re-read the briefing without logging another handover (e.g. after your own context compaction). `goalpulse status --goal <slug>` is the short version.

## 3. While working: log as things happen

(Use the goal's own command, or add `--goal <slug>` to each.)

| When | Command |
|---|---|
| Handing a task to a sub-agent | `goalpulse start T3 --by backend-1` |
| Task submitted for review | `goalpulse review T3 --by reviewer-1` |
| Reviewer wants changes | `goalpulse start T3 "Reviewer asked for an index" --by backend-1` |
| Task finished and accepted | `goalpulse done T3 "Schema merged, index added" --by backend-1` |
| Stuck on something outside the team | `goalpulse block T4 "Needs STRIPE_WEBHOOK_SECRET in CI"` |
| Unstuck | `goalpulse unblock T4 "Using a local secret"` |
| Attempt failed | `goalpulse fail T8 "Proration test fails"` then `reopen` / `start` |
| Agent vanished or task needs redoing | `goalpulse reopen T6` |
| Task no longer needed | `goalpulse drop T9 "Covered by T8"` |
| You made an assumption or best guess | `goalpulse assume "..." --why "..." --alt "..." --confidence low\|medium\|high --impact low\|medium\|high --task T5` |
| A decision, finding or risk worth keeping | `goalpulse note "..." --kind decision\|finding\|risk --task T3` |
| You need a human decision | `goalpulse ask "..." --option "A" --option "B" --task T3` |
| The human answered / confirmed | `goalpulse answer Q1 "..."` / `goalpulse resolve A1 confirmed\|rejected\|revised "note"` |
| Goal is finished and filed away | `goalpulse archive` |

## 4. Reports (your voice as project manager)

Post a report at the start, after each wave of tasks completes, whenever health changes, after resuming, and at the end:

```bash
goalpulse report "Checkout API done, seat UI underway. T4 is blocked on a CI secret, which holds up T7-T9." \
  --health at-risk --next "Unblock T4 (needs Q2 answered)" --risk "Proration assumption A4 is low confidence"
```

Two to four sentences: what changed, what is next, what could go wrong. Be honest with `--health` (`on-track`, `at-risk`, `blocked`); a finished goal shows as complete automatically.

## Rules

1. **Log the assumption when you make it, before acting on it.** Confidence = how sure you are it is right. Impact = what it costs if wrong. Low confidence plus high impact is what the human reviews first, so do not understate it.
2. **Every command is one line of plain words.** Under about 140 characters, outcome-focused ("Schema merged, index added"), no logs or stack traces.
3. **`done` always gets a result.** A one-line statement of what was delivered.
4. **`block` is for things you cannot resolve yourself.** For a decision only the human can make, also use `ask`, and keep working on unblocked tasks meanwhile.
5. **Never leave a dead task "active".** If an agent is gone, `reopen` the task. The dashboard flags tasks that have gone quiet.
6. **Do not narrate in chat what the dashboard already shows.** Use chat only for things needing the human right now.

## Sub-agent prompts

Sub-agents do not call goalpulse. Add this to each sub-agent prompt, then log what comes back on their behalf with `--by <their name>`:

```
Make reasonable assumptions instead of stopping to ask, but report them.
End your reply with exactly:
RESULT: <one line: what you delivered>
ASSUMPTIONS: <each as: text | why | alternative | confidence low/medium/high | impact low/medium/high; or "none">
FINDINGS: <notable discoveries or risks; or "none">
BLOCKERS: <what stopped you; or "none">
```

## Showing it to the human

Give the human the `goalpulse dashboard` URL once; for a shareable single-file snapshot use `goalpulse render` for a shareable single-file (`.goalpulse/report.html`). At the end of a goal, render a final snapshot and say where it is.
