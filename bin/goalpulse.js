#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parse, one, many, csv } = require('../lib/args');
const store = require('../lib/store');
const { loadGoal, loadAll, resolveGoal, uniqueSlug } = require('../lib/goals');
const { statusText, goalsTable, briefing } = require('../lib/text');
const { renderHtml } = require('../lib/render');
const { spawn } = require('child_process');
const { serve, ping, openBrowser } = require('../lib/server');

const HELP = `goalpulse — structured progress reporting for agent-driven goals

Every command except goal/goals/serve/render acts on ONE goal. Pass --goal <slug> (or set
GOALPULSE_GOAL). It can be omitted only when exactly one goal is open; otherwise goalpulse
refuses to guess so parallel goals never write into each other.

Goals
  goalpulse goal "Title" [--desc "..."] [--plan docs/plan.md] [--id slug]   create a goal (prints its slug)
  goalpulse goals [--json]                     list all goals
  goalpulse resume [--no-log]                  take over an existing goal: logs the handover, prints a full briefing
  goalpulse archive | unarchive                hide / restore a goal on the dashboard

Setup
  goalpulse plan [--file plan.json]            register many tasks from JSON (file or stdin)
  goalpulse add "Title" [--id T4] [--deps T1,T2] [--phase "Build"] [--owner agent] [--desc "..."]

Task lifecycle (use --by <agent> to say who did it)
  goalpulse start   <id> ["note"]              todo/review -> in progress
  goalpulse review  <id> ["note"]              ready for review
  goalpulse done    <id> "one-line result"
  goalpulse block   <id> "reason"              stuck on something outside the team
  goalpulse unblock <id> ["note"]
  goalpulse fail    <id> "reason"
  goalpulse drop    <id> ["reason"]            no longer needed
  goalpulse reopen  <id>                       back to to-do (e.g. its agent vanished)

Judgement calls
  goalpulse assume "text" [--why "..."] [--alt "alternative"] [--confidence low|medium|high]
                          [--impact low|medium|high] [--task T3]
  goalpulse resolve <A-id> confirmed|rejected|revised ["note"]
  goalpulse ask     "question" [--task T3] [--option "a" --option "b"]
  goalpulse answer  <Q-id> "answer"
  goalpulse note    "text" [--kind decision|finding|risk|note] [--task T3]

Reporting
  goalpulse report "summary" [--health on-track|at-risk|blocked] [--next "..."]... [--risk "..."]...
  goalpulse status [--json]                    one goal's summary (all goals if ambiguous)
  goalpulse dashboard [--open] [--stop]        start (or reuse) a background dashboard, print its URL
  goalpulse serve  [--port 4317] [--host 127.0.0.1] [--open]    live dashboard for every goal
  goalpulse render [--goal slug] [-o file.html] [--open]        self-contained snapshot (all goals by default)

Environment: GOALPULSE_DIR (the .goalpulse folder), GOALPULSE_GOAL (default --goal), GOALPULSE_AGENT (default --by)
`;

const SHORT = {
  start: 'active',
  review: 'review',
  done: 'done',
  block: 'blocked',
  unblock: 'active',
  fail: 'failed',
  drop: 'dropped',
  reopen: 'todo',
};
const LEVELS = { low: 'low', l: 'low', medium: 'medium', med: 'medium', m: 'medium', high: 'high', h: 'high' };

const die = (msg) => {
  console.error(`goalpulse: ${msg}`);
  process.exit(1);
};

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  const { pos, flags } = parse(argv, {
    boolean: ['json', 'open', 'help', 'no-log', 'stop'],
    alias: { o: 'out', p: 'port', h: 'help' },
  });

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || flags.help) {
    process.stdout.write(HELP);
    return;
  }
  if (flags.dir) process.env.GOALPULSE_DIR = one(flags.dir);

  const by = one(flags.by) || process.env.GOALPULSE_AGENT || undefined;
  const wanted = one(flags.goal) || process.env.GOALPULSE_GOAL || undefined;
  let root = null;
  let slug = null;

  const needRoot = () => {
    root = store.findRoot();
    if (!root) die('no goals here yet. Start with: goalpulse goal "Title"');
    return root;
  };
  // Resolve the goal this command applies to (dies, with the goal list, if ambiguous).
  const needGoal = () => {
    needRoot();
    const r = resolveGoal(root, wanted);
    if (r.error) {
      if (r.ambiguous) console.error(goalsTable(loadAll(root)) + '\n');
      die(r.error);
    }
    slug = r.slug;
    return slug;
  };
  const state = () => loadGoal(root, slug);
  // (Re)create this goal's own command and return how to call it from the current directory.
  const goalCommand = () => {
    const file = store.ensureWrapper(root, slug, fs.realpathSync(__filename));
    const rel = path.relative(process.cwd(), file);
    return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.startsWith('.') ? rel : `./${rel}`;
  };
  const emit = (event) => store.append(root, slug, { ...event, by });
  const nextId = (prefix, ids) => {
    const n = ids
      .map((i) => (new RegExp(`^${prefix}(\\d+)$`).exec(i) || [])[1])
      .filter(Boolean)
      .map(Number);
    return `${prefix}${(n.length ? Math.max(...n) : 0) + 1}`;
  };
  const level = (v, name) => {
    if (v === undefined) return undefined;
    const l = LEVELS[String(one(v)).toLowerCase()];
    if (!l) die(`--${name} must be low, medium or high`);
    return l;
  };

  // ---- task lifecycle shortcuts ----------------------------------------------
  if (SHORT[cmd]) {
    needGoal();
    const id = pos[0];
    if (!id)
      die(
        `usage: goalpulse ${cmd} <task-id>${cmd === 'done' || cmd === 'block' || cmd === 'fail' ? ' "text"' : ' ["text"]'}`,
      );
    const text = pos[1];
    if ((cmd === 'block' || cmd === 'fail') && !text) die(`${cmd} needs a reason: goalpulse ${cmd} ${id} "why"`);
    if (!state().tasks.some((t) => t.id === id))
      console.error(`note: ${id} was not in the plan; created implicitly (add it with: goalpulse add)`);
    emit({ type: 'status', id, status: SHORT[cmd], text });
    console.log(`${id} → ${SHORT[cmd]}`);
    if (cmd === 'done' && !text) console.error('tip: add a one-line result so the report shows what was delivered');
    return;
  }

  switch (cmd) {
    case 'init': {
      root = store.initRoot(pos[0] || process.cwd());
      console.log(`initialised ${root}`);
      break;
    }

    case 'goal': {
      const title = pos[0];
      if (!title) die('usage: goalpulse goal "Title" [--desc "..."] [--plan docs/plan.md] [--id slug]');
      root = store.findRoot() || store.initRoot(process.cwd());
      let id = one(flags.id);
      if (id) {
        if (!store.validSlug(id)) die('--id must be lowercase letters, digits and dashes (max 60)');
      } else {
        // Re-running `goal` after a crash would silently fork the work; point at resume instead.
        const dup = loadAll(root).find(
          (g) => !g.archived && g.goal && g.goal.title.trim().toLowerCase() === title.trim().toLowerCase(),
        );
        if (dup)
          die(
            `a goal with this title already exists (${dup.slug}). To continue it run: goalpulse resume --goal ${dup.slug}   (to start a separate goal, pass --id <new-slug>)`,
          );
        id = uniqueSlug(root, title);
      }
      const existed = store.listSlugs(root).includes(id);
      if (!existed) store.createGoal(root, id);
      slug = id;
      emit({ type: 'goal', title, desc: one(flags.desc), plan: one(flags.plan) });
      console.log(existed ? `goal ${id} updated` : `goal created: ${id}`);
      console.log(`Use this goal's own command for everything that follows (the goal is built in):`);
      console.log(`  ${goalCommand()} <command> ...`);
      console.log(`or the shared command with: goalpulse <command> --goal ${id}`);
      break;
    }

    case 'goals': {
      needRoot();
      const goals = loadAll(root);
      console.log(flags.json ? JSON.stringify(goals, null, 2) : goalsTable(goals));
      break;
    }

    case 'resume': {
      needGoal();
      const prior = state().resumes.length;
      if (!flags['no-log']) emit({ type: 'resume' });
      console.log(briefing(state(), { priorResumes: prior, cmd: goalCommand() }));
      break;
    }

    case 'archive':
    case 'unarchive': {
      needGoal();
      emit({ type: cmd });
      console.log(`${slug} ${cmd}d`);
      break;
    }

    case 'add': {
      needGoal();
      if (!pos[0]) die('usage: goalpulse add "Title" [--id T4] [--deps T1,T2] [--phase "..."]');
      const id =
        one(flags.id) ||
        nextId(
          'T',
          state().tasks.map((t) => t.id),
        );
      emit({
        type: 'task',
        id,
        title: pos[0],
        desc: one(flags.desc),
        owner: one(flags.owner),
        phase: one(flags.phase),
        deps: csv(flags.deps),
      });
      console.log(`${id} added`);
      break;
    }

    case 'plan': {
      needGoal();
      const file = one(flags.file);
      if (!file && process.stdin.isTTY) die('usage: goalpulse plan --file plan.json   (or pipe JSON on stdin)');
      let plan;
      try {
        plan = JSON.parse(fs.readFileSync(file || 0, 'utf8'));
      } catch (e) {
        die(`could not read plan JSON: ${e.message}`);
      }
      const list = Array.isArray(plan) ? plan : plan.tasks;
      if (!Array.isArray(list) || !list.length) die('plan must be an array of tasks (or {"tasks": [...]})');
      if (plan.goal && plan.goal.title)
        emit({ type: 'goal', title: plan.goal.title, desc: plan.goal.desc, plan: plan.goal.plan });
      const ids = state().tasks.map((t) => t.id);
      const made = [];
      for (const t of list) {
        if (!t.title) die('every task needs a title');
        const id = t.id || nextId('T', ids);
        ids.push(id);
        made.push(id);
        emit({ type: 'task', id, title: t.title, desc: t.desc, owner: t.owner, phase: t.phase, deps: t.deps || [] });
      }
      console.log(`planned ${made.length} tasks: ${made.join(' ')}`);
      break;
    }

    case 'assume': {
      needGoal();
      if (!pos[0])
        die('usage: goalpulse assume "text" [--why ...] [--alt ...] [--confidence ...] [--impact ...] [--task T3]');
      const id = nextId(
        'A',
        state().assumptions.map((a) => a.id),
      );
      emit({
        type: 'assume',
        id,
        text: pos[0],
        why: one(flags.why),
        alt: one(flags.alt),
        confidence: level(flags.confidence, 'confidence') || 'medium',
        impact: level(flags.impact, 'impact') || 'medium',
        task: one(flags.task),
      });
      console.log(`${id} recorded`);
      break;
    }

    case 'resolve': {
      needGoal();
      const [id, status, text] = pos;
      if (!id || !['confirmed', 'rejected', 'revised'].includes(status))
        die('usage: goalpulse resolve <A-id> confirmed|rejected|revised ["note"]');
      if (!state().assumptions.some((a) => a.id === id)) die(`no assumption ${id}`);
      emit({ type: 'resolve', id, status, text });
      console.log(`${id} ${status}`);
      break;
    }

    case 'note': {
      needGoal();
      if (!pos[0]) die('usage: goalpulse note "text" [--kind decision|finding|risk|note] [--task T3]');
      const kind = one(flags.kind) || 'note';
      if (!['decision', 'finding', 'risk', 'note'].includes(kind))
        die('--kind must be decision, finding, risk or note');
      emit({ type: 'note', text: pos[0], kind, task: one(flags.task) });
      console.log(`${kind} recorded`);
      break;
    }

    case 'ask': {
      needGoal();
      if (!pos[0]) die('usage: goalpulse ask "question" [--task T3] [--option "a" --option "b"]');
      const id = nextId(
        'Q',
        state().asks.map((q) => q.id),
      );
      emit({ type: 'ask', id, text: pos[0], task: one(flags.task), options: many(flags.option) });
      console.log(`${id} asked`);
      break;
    }

    case 'answer': {
      needGoal();
      const [id, text] = pos;
      if (!id || !text) die('usage: goalpulse answer <Q-id> "answer"');
      if (!state().asks.some((q) => q.id === id)) die(`no question ${id}`);
      emit({ type: 'answer', id, text });
      console.log(`${id} answered`);
      break;
    }

    case 'report': {
      needGoal();
      if (!pos[0])
        die(
          'usage: goalpulse report "summary" [--health on-track|at-risk|blocked] [--next "..."]... [--risk "..."]...',
        );
      const health = one(flags.health);
      if (health && !['on-track', 'at-risk', 'blocked'].includes(health))
        die('--health must be on-track, at-risk or blocked');
      emit({ type: 'report', summary: pos[0], health, next: many(flags.next), risks: many(flags.risk) });
      console.log('report recorded');
      break;
    }

    case 'status': {
      needRoot();
      const r = resolveGoal(root, wanted);
      if (r.ambiguous) {
        console.log(goalsTable(loadAll(root)));
        console.log("\nSeveral goals are open. Pass --goal <slug> for one goal's detail.");
        break;
      }
      if (r.error) die(r.error);
      slug = r.slug;
      const s = state();
      console.log(flags.json ? JSON.stringify(s, null, 2) : statusText(s));
      break;
    }

    case 'render': {
      needRoot();
      let goals;
      if (wanted) {
        const r = resolveGoal(root, wanted);
        if (r.error) die(r.error);
        goals = [loadGoal(root, r.slug)];
      } else {
        goals = loadAll(root);
      }
      const out = path.resolve(one(flags.out) || path.join(root, 'report.html'));
      fs.writeFileSync(out, renderHtml({ goals }));
      console.log(out);
      if (flags.open) openBrowser(`file://${out}`);
      break;
    }

    case 'serve': {
      needRoot();
      const host = one(flags.host) || '127.0.0.1';
      const idle = Number(one(flags['idle-exit'])) || 0;
      const { url, port } = await serve({
        root,
        port: Number(one(flags.port)) || 4317,
        host,
        idleExitMs: idle * 60000,
      });
      const sf = path.join(root, 'server.json');
      fs.writeFileSync(sf, JSON.stringify({ pid: process.pid, port, url, startedAt: new Date().toISOString() }));
      const cleanup = () => {
        try {
          fs.unlinkSync(sf);
        } catch (_) {}
      };
      process.on('exit', cleanup);
      process.on('SIGINT', () => process.exit(0));
      process.on('SIGTERM', () => process.exit(0));
      console.log(`goalpulse dashboard: ${url}   (Ctrl+C to stop)`);
      if (host !== '127.0.0.1' && host !== 'localhost')
        console.log('warning: listening beyond localhost — the dashboard has no authentication');
      if (flags.open) openBrowser(url);
      break;
    }

    case 'dashboard': {
      needRoot();
      const sf = path.join(root, 'server.json');
      let info = null;
      try {
        info = JSON.parse(fs.readFileSync(sf, 'utf8'));
      } catch (_) {}
      const alive = info && (await ping(info.url, root));
      if (flags.stop) {
        if (alive) {
          try {
            process.kill(info.pid);
          } catch (_) {}
        }
        try {
          fs.unlinkSync(sf);
        } catch (_) {}
        console.log(alive ? 'dashboard stopped' : 'no dashboard running');
        break;
      }
      if (alive) {
        console.log(`Dashboard: ${info.url}`);
        if (flags.open) openBrowser(info.url);
        break;
      }
      try {
        fs.unlinkSync(sf);
      } catch (_) {}
      const args = [__filename, 'serve', '--idle-exit', '120'];
      if (one(flags.port)) args.push('--port', String(one(flags.port)));
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, GOALPULSE_DIR: root },
      });
      child.unref();
      let url = null;
      for (let i = 0; i < 40 && !url; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          const j = JSON.parse(fs.readFileSync(sf, 'utf8'));
          if (await ping(j.url, root)) url = j.url;
        } catch (_) {}
      }
      if (!url) die('could not start the dashboard; try: goalpulse serve');
      console.log(`Dashboard: ${url}`);
      if (flags.open) openBrowser(url);
      break;
    }

    default:
      die(`unknown command "${cmd}". Run: goalpulse help`);
  }
}

main().catch((e) => die(e.message));
