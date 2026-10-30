# Brief: flow (working name)

An agent-agnostic runner that takes a defined feature and drives it through spec, plan and implementation with loops of cheap and moderate models, reporting progress to GoalPulse so the human sees a dashboard instead of agent text.

Status: draft v0, for refinement. Nothing here is built.

## 1. Problem

Building a feature with agents today means one long chat, or a head agent that spawns subagents and writes progress to a markdown file. Four things go wrong:

- **Progress is unreadable.** A `progress.md` or a scrolling transcript is a wall of text. You cannot tell at a glance what is done, blocked or waiting on you.
- **Process lives in the model's head.** Loop caps, review rules and dependency order are followed when the head agent remembers to follow them.
- **It is tied to one agent.** Subagent and model-routing features differ in every tool, so the workflow cannot move.
- **Cost is uncontrolled.** Review loops can run indefinitely, and the strong model is used for work a cheap one could do.

## 2. Goal

After the human defines the feature, one command runs it to completion, with no further involvement except answering questions the run raises. Progress is visible at a glance in GoalPulse throughout.

Non-goals (v1):

- The interactive "refine the feature with an agent" phase. It happens in whatever chat the human prefers and ends by producing `brief.md`. A template and skill for it can come later.
- Replacing GoalPulse. Flow emits events; GoalPulse renders them.
- Running agents in the cloud, scheduling, or multi-repo changes.
- A GUI for editing the workflow. The pipeline is fixed in v1; only roles, tiers and caps are configurable.

## 3. The workflow

```
brief.md ──▶ SPEC loop ──▶ PLAN loop ──▶ IMPLEMENT ──▶ done
             write         write          per task, in dependency order,
             review        review         parallel where the plan allows:
             refine        refine         implement → review → test
```

Each loop follows the same rule: **write, review, refine, repeat until the reviewer reports zero blocking findings or the round cap is hit.** On a cap, flow raises a question to the human instead of continuing.

| Stage | Output | Exit rule |
|---|---|---|
| Spec loop | `spec.md` | No blocking findings, or N rounds (default 4), then ask |
| Plan loop | `plan.json` | Valid against the schema and no blocking findings, or N rounds, then ask |
| Implement (per task) | commits on a task branch | Reviewer approves and the task's test command passes, or M attempts (default 3), then block the task and ask |
| Integrate | feature branch | All tasks done and the full test command passes |

Tests are the objective gate. Reviewers are models and can agree with each other and still be wrong, so a passing test run, not a second opinion, is what moves a task to done.

## 4. Design

### 4.1 Runner, not a head agent

A small zero-dependency Node CLI (same style as GoalPulse) owns the pipeline: loops, exit rules, ordering, parallelism, retries, resuming. Models only perform roles. This keeps the workflow identical across agents, costs nothing for the "project manager", and makes behaviour deterministic and resumable.

For the rare judgment call (a task stuck after its attempts), the runner raises a GoalPulse question. It does not call a model to decide.

### 4.2 Roles and tiers

Roles are fixed: `spec-writer`, `spec-reviewer`, `planner`, `plan-reviewer`, `implementer`, `code-reviewer`, `tester`. Each role has a prompt template (shipped, overridable) and a tier. Tiers map to concrete agent commands in one config file, so swapping an agent is a config change.

```yaml
# .flow/config.yml  (command lines are placeholders; real non-interactive flags must be verified per agent)
tiers:
  cheap:    { run: "<agent-cli> --model <small-model> {prompt_file}" }
  standard: { run: "<agent-cli> --model <mid-model>   {prompt_file}" }
roles:
  spec-writer: standard   spec-reviewer: standard
  planner: standard       plan-reviewer: standard
  implementer: cheap      code-reviewer: standard    tester: cheap
caps: { loop_rounds: 4, task_attempts: 3, parallel: 3 }
test: { task: "npm test", full: "npm test" }
```

A role invocation is: render the prompt to a file, run the tier's command in the task's working directory, capture the output, validate it against the role's contract. A contract failure counts as a failed round.

### 4.3 Contracts on disk

Everything is a file, so any agent or human can read it and a run can resume after a crash.

- `.flow/<feature>/brief.md`: the human's input (goal, constraints, acceptance criteria).
- `.flow/<feature>/spec.md`, `plan.json`, and one `findings-<stage>-<round>.json` per review.
- `.flow/<feature>/state.json`: current stage, round counters, task statuses and attempts. The runner reads this to resume.

Reviewer findings:

```json
{ "blocking": [{ "where": "spec.md#auth", "issue": "..." }], "notes": ["..."] }
```

Plan (sketch):

```json
{ "phases": ["Foundations", "Core", "Polish"],
  "tasks": [
    { "id": "T1", "title": "...", "phase": "Foundations", "deps": [],
      "files": ["src/db/**"], "test": "npm test -- db", "parallel": true } ] }
```

`files` globs let the runner avoid running two tasks that touch the same files at once.

### 4.4 Isolation and parallelism

Each task runs in its own git worktree on its own branch. Finished tasks merge into a feature branch in dependency order. A merge conflict blocks the task and raises a question. Nothing touches the main branch.

### 4.5 GoalPulse integration

The runner calls the GoalPulse CLI directly, so the dashboard works whichever agent ran: one goal per feature, one phase per workflow stage and plan phase, tasks from `plan.json`, questions and assumptions as they arise, a coordinator report after each stage.

## 5. Changes needed in GoalPulse

These are generic and useful to any user, not specific to flow:

1. **Task stages:** implement, review and test pips on a task row.
2. **Loops:** a named loop with a round counter and open-findings count per round (for example 9, 4, 1, 0, exit), shown compactly with a convergence sparkline.
3. **Model tag:** a cheap or standard tag on the owner of each task, so cost is visible.
4. **Spend counter** (optional, if agents report usage): a running total on the status line.

## 6. Guardrails

- Hard caps on loop rounds, task attempts and parallelism, all configurable.
- Optional run budget; flow stops and asks when it is reached.
- Agents run non-interactively, so they need pre-approved permissions. Runs happen in worktrees, and the docs recommend a container or sandbox. Flow never runs an agent with unrestricted permissions by default.
- Prompts are files in the repo, so they are reviewable and versioned.

## 7. Success criteria

- A feature of about 10 tasks runs from `brief.md` to a green feature branch with no human input except questions.
- The same run works with at least two different agents by changing only `config.yml`.
- Killing the runner mid-run and restarting resumes without redoing finished tasks.
- At any moment the GoalPulse dashboard answers: which stage, how many tasks done, what is blocked, what is waiting on me, which loop is not converging.
- A stuck loop or task stops within its cap and asks, rather than spinning.

## 8. Milestones (each is a demo)

1. **Skeleton:** `flow run` reads a hand-written `plan.json` and runs the implement stage for one agent, one task at a time, reporting to GoalPulse. Proves the role contract and resume.
2. **Parallel and isolated:** worktrees, dependency order, file-overlap check, merge to the feature branch.
3. **Plan loop:** planner and plan reviewer with findings, caps and questions.
4. **Spec loop:** same machinery in front of the plan.
5. **GoalPulse extensions:** stage pips, loop rounds, model tags.
6. **Second agent:** prove the config swap, and write the setup docs and ad.

## 9. Open questions

1. **Name and repo.** Separate repo that depends on the GoalPulse CLI. Name to pick.
2. **Which agent CLIs first?** Their non-interactive modes, permission flags and output formats need checking before the config format is final.
3. **Human gate before implementation?** You want involvement to end after the feature is defined. A single optional "approve the plan" pause, off by default, is a cheap safeguard against an expensive wrong run. Include it?
4. **Where tests come from.** Declared in config, declared per task in the plan, or detected from the repo?
5. **Merge policy.** Auto-merge task branches into the feature branch, or open a PR per task? Who resolves conflicts?
6. **Where artifacts live.** `.flow/` (gitignored by default) or `docs/<feature>/` (committed, reviewable)?
7. **Budget.** Is a token or dollar cap needed in v1, or only round and attempt caps?
8. **The interactive refine phase.** Out of scope for v1 as written. Should a `brief.md` template and a skill for that phase ship alongside, so the hand-off is smooth?

## 10. Risks

- "Rock solid" is subjective; reviewers need a checklist they can fail, and the prompts are the product.
- Cheap models may produce plausible code that passes weak tests. Test quality matters more than reviewer count.
- Agent CLIs change often. Keeping the command template in config contains this but does not remove it.
- Worktree merges on a large parallel plan can produce painful conflicts; the `files` overlap check reduces this but depends on the planner being accurate.
