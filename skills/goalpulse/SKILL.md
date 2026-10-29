---
name: goalpulse
description: Use when the user says "use goalpulse", "report progress", "track this goal", "show me a progress dashboard", "resume the goal", or when coordinating multi-step work that needs durable handoffs, parallel task tracking, assumptions, questions, or a live visual view. Logs structured progress through the goalpulse CLI and serves a dashboard. Use it instead of writing progress.md.
---

# goalpulse: report progress as structured events

You are the coordinator ("project manager"). Sub-agents report to you; **you** are the only one who writes to goalpulse. Every call appends one line to that goal's event log, and the human watches a dashboard rendered from it. Do not create `progress.md` or any other tracking file.

## Setup (do this first)

Run `goalpulse goals`. In Claude Code the plugin puts `goalpulse` on your PATH. If the command is not found, use `npx -y github:raysca/goalpulse <command>` instead (identical commands; or `npm install -g github:raysca/goalpulse` once). It needs Node 18+; if Node is missing, tell the user.

When you create a goal (or resume one), start the dashboard and **give the user both the local URL and any LAN URLs printed by the command**. The LAN URLs let them follow along from a phone or tablet on the same network. Mention once that the dashboard updates live; do not repeat the URLs in every progress update:

```bash
goalpulse dashboard
# prints the local URL and detected LAN URLs (for example, http://192.168.1.24:4317)
```

It is idempotent (reuses a running one), runs in the background and stops itself after 2 idle hours. It binds to all network interfaces by default and prints the host URL, LAN URLs, and terminal QR codes. The live dashboard also has a **Share to phone** popup with scannable codes. The dashboard has no authentication; make this clear and tell the user to use it on a trusted network. Use `goalpulse dashboard --open` only if the user wants it opened for them.

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
.goalpulse/goals/ship-team-based-billing/gp report "Goal recorded; discovery is underway. No implementation has started yet." --health on-track --next "Audit billing code (T1)"
```

Write the goal description as a compact feature brief: what is being built, who or what it helps, and the observable outcome or acceptance criteria. This appears in the dashboard's **At a glance** handoff panel, so avoid vague descriptions such as "improve the app". Put the detailed acceptance criteria in the plan file and pass `--plan <file>` so a future resumer can find them.

Register the whole plan up front with stable, explicit ids, phases and `deps`; the dashboard uses `deps` to show what is ready and what is waiting. Make each task small enough to own, verify, and hand off independently. Give tasks outcome-focused titles and useful descriptions, including likely files or boundaries when known. Add later discoveries with `gp add "Title" --deps T2 --phase Build` (using the goal's command).

### Mark parallel work clearly

GoalPulse's task model has dependencies, phases, descriptions and owners; it does not have a separate parallel flag. Make parallelism visible using the plan itself:

- Tasks in the same phase with no dependency path between them are candidates to run concurrently. Add a short note in each description such as `Parallel set: P1; boundary: src/api/**` so the dashboard makes the intended grouping and file boundary legible.
- Add dependencies wherever one task needs another task's output. Do not use phase labels as a substitute for `deps`.
- Before dispatching a candidate set, check for shared files, shared mutable state, and ordering constraints. If boundaries overlap, sequence those tasks or split them into safer pieces.
- Dispatch only as many independent tasks as the available agents and review capacity can support. Keep one coordinator responsible for integration and the dashboard.
- If no work is actually independent, say that the work is sequential; do not manufacture parallel tasks.

When delegating, tell each worker its task id, acceptance criteria, permitted scope, relevant dependencies, and whether another task may edit nearby files. Ask it to avoid changing files outside that scope and to report changed files, verification performed, and any partial work. Workers never write GoalPulse events; the coordinator records assignments and outcomes.

## 2. Resume a goal

```bash
goalpulse resume --goal ship-team-based-billing --by coordinator-2
# or, if the goal's command exists: .goalpulse/goals/ship-team-based-billing/gp resume --by coordinator-2
```

`resume` re-creates the goal's own command if it is missing, and the briefing tells you which command to use from then on. It logs the handover (visible on the dashboard) and prints a briefing: the plan path, the last report, what is done, what is in flight (flagged STALE if quiet for 30+ minutes), what is blocked, what is ready, what the human has answered since the last report (marked NEW), open questions and assumptions, and recent decisions. Then:

1. Re-read the plan file and the decisions in the briefing. Read the repo's current instructions and inspect `git status` / recent diffs before editing; the log records intent, while the workspace is the evidence of what actually changed.
2. **Treat every IN FLIGHT or REVIEW task as unverified.** Identify its owner, inspect changed files and available verification output, and decide whether it is complete, partially done, or untouched. Never overwrite or discard partial work just to restart cleanly.
3. If complete and its acceptance criteria are met, record `done` with a concrete result. If partial, preserve the work, record a note describing what exists and what remains, then `reopen` and assign the remaining work. If untouched or the previous owner is gone, `reopen` and assign a new owner. Do not leave abandoned work active.
4. Act on NEW human input; an answer or a rejected/revised assumption can invalidate prior work. Record the impact with a `note` and reopen affected tasks, even if they were previously marked done.
5. Recompute which tasks are READY and which can safely run in parallel using the plan's dependencies and file boundaries. Do not assume the previous agent's parallel group is still safe after discovering new work.
6. Post a concise `report` that states the current position, what you are continuing, and the next milestone. Continue with ready work.

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
| Partial work or handoff detail worth preserving | `goalpulse note "T3: parser is implemented in src/parse.js; remaining: error cases and verification" --kind finding --task T3` |
| You made an assumption or best guess | `goalpulse assume "..." --why "..." --alt "..." --confidence low\|medium\|high --impact low\|medium\|high --task T5` |
| A decision, finding or risk worth keeping | `goalpulse note "..." --kind decision\|finding\|risk --task T3` |
| You need a human decision | `goalpulse ask "..." --option "A" --option "B" --task T3` |
| The human answered / confirmed | `goalpulse answer Q1 "..."` / `goalpulse resolve A1 confirmed\|rejected\|revised "note"` |
| Goal is finished and filed away | `goalpulse archive` |

## 4. Reports (your voice as project manager)

Post a report at the start, after each wave of tasks completes, whenever health changes, after resuming, and at the end. A wave is a set of independent tasks that have all reached a meaningful checkpoint. The dashboard's **At a glance** panel puts the goal description beside the latest report, next actions, and risks; keep them complementary. The report summary should state current state and completed outcomes, `--next` should name the next concrete action (with task id/owner when useful), and `--risk` should capture material risks. Include enough state that a different agent can orient quickly without needing this chat:

```bash
goalpulse report "Checkout API done, seat UI underway. T4 is blocked on a CI secret, which holds up T7-T9." \
  --health at-risk --next "Unblock T4 (needs Q2 answered)" --risk "Proration assumption A4 is low confidence"
```

Two to four sentences: what changed, what is next, and what could go wrong. Mention task IDs and parallel candidates where useful. Be honest with `--health` (`on-track`, `at-risk`, `blocked`); a finished goal shows as complete automatically.

## Rules

1. **Log the assumption when you make it, before acting on it.** Confidence = how sure you are it is right. Impact = what it costs if wrong. Low confidence plus high impact is what the human reviews first, so do not understate it.
2. **Every command is one line of plain words.** Under about 140 characters, outcome-focused ("Schema merged, index added"), no logs or stack traces.
3. **`done` always gets a result.** A one-line statement of what was delivered.
4. **`block` is for things you cannot resolve yourself.** For a decision only the human can make, also use `ask`, and keep working on unblocked tasks meanwhile.
5. **Never leave a dead task "active".** If an agent is gone, `reopen` the task. The dashboard flags tasks that have gone quiet.
6. **Do not narrate in chat what the dashboard already shows.** Use chat only for things needing the human right now.
7. **Make handoffs actionable.** Before ending a session, ensure every active task has a named owner and recent status. Record partial results, changed-file locations, verification, unresolved decisions, and the next concrete action in task notes or a report. A future agent must not need the prior agent's private context to safely continue.
8. **Keep the dashboard human-readable.** Use plain, outcome-focused task titles and short results; put implementation detail in notes. Avoid logging raw command output, stack traces, or speculative narration.

## Sub-agent prompts

Sub-agents do not call goalpulse. Add this to each sub-agent prompt, then log what comes back on their behalf with `--by <their name>`:

```
Make reasonable assumptions instead of stopping to ask, but report them.
Work only within the assigned task scope. Preserve uncommitted work and report partial progress clearly; do not claim a task is complete unless its acceptance criteria are met.
End your reply with exactly:
RESULT: <one line: what you delivered>
CHANGED: <files changed, or "none">
VERIFICATION: <checks run and outcome, or "not run" with reason>
ASSUMPTIONS: <each as: text | why | alternative | confidence low/medium/high | impact low/medium/high; or "none">
FINDINGS: <notable discoveries or risks; or "none">
BLOCKERS: <what stopped you; or "none">
```

## Showing it to the human

Give the human the `goalpulse dashboard` URL once; for a shareable single-file snapshot use `goalpulse render` for a shareable single-file (`.goalpulse/report.html`). At the end of a goal, render a final snapshot and say where it is.
