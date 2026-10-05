'use strict';

const { clip } = require('./reduce');

function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const d = Math.max(0, (now - new Date(ts).getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

const pad = (s, n) => String(s).padEnd(n);

// Compact plain-text view of one goal.
function statusText(s) {
  const L = [];
  L.push(
    `GOAL      ${s.goal ? s.goal.title : '(not set — run: goalpulse goal "...")'}${s.slug ? `  [${s.slug}]` : ''}`,
  );
  const c = s.counts;
  L.push(
    `PROGRESS  ${s.progress.done}/${s.progress.total} done (${s.progress.pct}%) · ` +
      `active ${c.active} · review ${c.review} · blocked ${c.blocked} · failed ${c.failed} · todo ${c.todo}` +
      `   health: ${s.health.value}${s.archived ? ' (archived)' : ''}`,
  );

  const inFlight = s.tasks.filter((t) => t.status === 'active' || t.status === 'review');
  if (inFlight.length) {
    L.push('', 'IN FLIGHT');
    for (const t of inFlight) {
      const who = t.status === 'review' ? t.reviewer || t.owner : t.owner;
      L.push(`  ${t.id}  [${t.status}] ${clip(t.title, 70)}${who ? ' — ' + who : ''}`);
    }
  }

  if (s.attention.length) {
    L.push('', 'NEEDS ATTENTION');
    for (const a of s.attention) {
      const tag = { question: '?', blocked: '!', failed: '✕', assumption: '~' }[a.kind];
      const extra = a.kind === 'assumption' ? ` (confidence ${a.confidence}, impact ${a.impact})` : '';
      L.push(`  ${tag} ${a.id}  ${clip(a.text, 100)}${extra}`);
    }
  }

  const ready = s.tasks.filter((t) => t.ready);
  if (ready.length) {
    L.push('', 'READY TO START');
    for (const t of ready.slice(0, 10)) L.push(`  ${t.id}  ${clip(t.title, 70)}`);
    if (ready.length > 10) L.push(`  … and ${ready.length - 10} more`);
  }

  const open = s.assumptions.filter((a) => a.status === 'open');
  if (open.length) L.push('', `ASSUMPTIONS  ${open.length} open of ${s.assumptions.length}`);

  if (s.report) L.push('', `LAST REPORT  ${clip(s.report.summary, 200)}`);
  return L.join('\n');
}

// One line per goal, for `goalpulse goals` and ambiguity errors.
function goalsTable(goals, now = Date.now()) {
  if (!goals.length) return 'No goals yet. Start one with: goalpulse goal "Title"';
  const rows = goals.map((g) => ({
    slug: g.slug,
    health: g.archived ? 'archived' : g.health.value,
    progress: `${g.progress.done}/${g.progress.total} ${g.progress.pct}%`,
    attn: String(g.attention.length),
    updated: ago(g.updatedAt, now),
    title: g.goal ? clip(g.goal.title, 60) : '',
  }));
  const w = (k, h) => Math.max(h.length, ...rows.map((r) => r[k].length));
  const W = {
    slug: w('slug', 'GOAL'),
    health: w('health', 'HEALTH'),
    progress: w('progress', 'PROGRESS'),
    attn: w('attn', 'NEEDS YOU'),
    updated: w('updated', 'UPDATED'),
  };
  const out = [
    `${pad('GOAL', W.slug)}  ${pad('HEALTH', W.health)}  ${pad('PROGRESS', W.progress)}  ${pad('NEEDS YOU', W.attn)}  ${pad('UPDATED', W.updated)}  TITLE`,
  ];
  for (const r of rows) {
    out.push(
      `${pad(r.slug, W.slug)}  ${pad(r.health, W.health)}  ${pad(r.progress, W.progress)}  ${pad(r.attn, W.attn)}  ${pad(r.updated, W.updated)}  ${r.title}`,
    );
  }
  return out.join('\n');
}

// Full handover briefing for an agent picking a goal back up (new session, crashed run,
// compacted context). Everything it needs to decide what to do next, in one read.
function briefing(s, opts = {}) {
  const now = opts.now || Date.now();
  const staleMs = (opts.staleMin == null ? 30 : opts.staleMin) * 60000;
  const L = [];
  const reportTs = s.report ? new Date(s.report.ts).getTime() : 0;
  const prior = opts.priorResumes == null ? s.resumes.length : opts.priorResumes; // excludes this resume

  L.push(`RESUMING GOAL  ${s.slug}`);
  L.push(s.goal ? s.goal.title : '(no title)');
  if (s.goal && s.goal.desc) L.push(`  ${s.goal.desc}`);
  if (s.goal && s.goal.plan) L.push(`  Plan: ${s.goal.plan}   <- re-read this before continuing`);
  L.push(
    `Health: ${s.health.value} · ${s.progress.done}/${s.progress.total} done (${s.progress.pct}%) · ` +
      `last activity ${ago(s.updatedAt, now)} · resumed ${prior} time${prior === 1 ? '' : 's'} before`,
  );

  if (s.report) {
    L.push('', `LAST REPORT (${ago(s.report.ts, now)})`, `  ${s.report.summary}`);
    if (s.report.next.length) L.push(`  Next: ${s.report.next.join(' | ')}`);
    if (s.report.risks.length) L.push(`  Risks: ${s.report.risks.join(' | ')}`);
  }

  const done = s.tasks.filter((t) => t.status === 'done');
  if (done.length) {
    L.push('', `DONE (${done.length})`);
    for (const t of done.slice(-15))
      L.push(`  ${t.id}  ${clip(t.title, 60)}${t.result ? ' — ' + clip(t.result, 90) : ''}`);
    if (done.length > 15) L.push(`  … ${done.length - 15} earlier tasks not shown (goalpulse status --json for all)`);
  }

  const flight = s.tasks.filter((t) => t.status === 'active' || t.status === 'review');
  if (flight.length) {
    L.push('', `IN FLIGHT (${flight.length})   these agents may no longer exist: verify before trusting them`);
    for (const t of flight) {
      const who = t.status === 'review' ? t.reviewer || t.owner : t.owner;
      const quiet = now - new Date(t.updatedAt).getTime();
      L.push(
        `  ${t.id}  [${t.status}] ${clip(t.title, 60)}${who ? ' — ' + who : ''} · last update ${ago(t.updatedAt, now)}${quiet > staleMs ? '  ** STALE **' : ''}`,
      );
    }
  }

  const stuck = s.tasks.filter((t) => t.status === 'blocked' || t.status === 'failed');
  if (stuck.length) {
    L.push('', 'BLOCKED / FAILED');
    for (const t of stuck)
      L.push(`  ${t.id}  [${t.status}] ${clip(t.title, 60)} — ${clip(t.blocker || 'no reason given', 110)}`);
  }

  const ready = s.tasks.filter((t) => t.ready);
  if (ready.length) {
    L.push('', 'READY TO START');
    for (const t of ready) L.push(`  ${t.id}  ${clip(t.title, 70)}`);
  }
  const waiting = s.tasks.filter((t) => t.status === 'todo' && t.waitingOn.length);
  if (waiting.length) {
    L.push('', 'WAITING ON DEPENDENCIES');
    for (const t of waiting) L.push(`  ${t.id}  ${clip(t.title, 55)} (needs ${t.waitingOn.join(', ')})`);
  }

  // What the human said. Anything newer than the last report has probably not been acted on.
  const human = [];
  for (const q of s.asks.filter((q) => q.status === 'answered'))
    human.push({ ts: q.answeredAt, text: `${q.id} answered: "${clip(q.answer, 110)}"  (Q: ${clip(q.text, 70)})` });
  for (const a of s.assumptions.filter((a) => a.status !== 'open'))
    human.push({
      ts: a.resolvedAt,
      text: `${a.id} ${a.status}${a.note ? ': "' + clip(a.note, 110) + '"' : ''}  (A: ${clip(a.text, 70)})`,
    });
  if (human.length) {
    human.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    L.push('', 'HUMAN INPUT   items marked NEW arrived after your last report: act on them');
    for (const h of human) L.push(`  ${new Date(h.ts).getTime() > reportTs ? 'NEW ' : '    '}${h.text}`);
  }

  const openQ = s.asks.filter((q) => q.status === 'open');
  if (openQ.length) {
    L.push('', 'OPEN QUESTIONS (still waiting on the human)');
    for (const q of openQ)
      L.push(`  ${q.id}  ${clip(q.text, 110)}${q.options.length ? '  [' + q.options.join(' / ') + ']' : ''}`);
  }
  const openA = s.assumptions.filter((a) => a.status === 'open');
  if (openA.length) {
    L.push('', 'OPEN ASSUMPTIONS (unconfirmed; you are building on these)');
    for (const a of openA)
      L.push(
        `  ${a.id}  ${clip(a.text, 100)} (confidence ${a.confidence}, impact ${a.impact})${a.task ? ' · ' + a.task : ''}`,
      );
  }

  if (s.notes.length) {
    L.push('', 'DECISIONS, FINDINGS AND RISKS (latest)');
    for (const n of s.notes.slice(-12)) L.push(`  ${n.kind}${n.task ? ' ' + n.task : ''}: ${clip(n.text, 120)}`);
  }

  L.push('', 'TO RESUME');
  // With a per-goal command (opts.cmd) the goal is built in; otherwise every command needs --goal.
  const run = opts.cmd || 'goalpulse';
  const g = opts.cmd ? '' : ` --goal ${s.slug}`;
  if (!s.tasks.length) {
    L.push(`  No tasks are registered. Re-read the plan, then register it: ${run} plan${g}`);
  } else if (s.health.value === 'complete') {
    L.push(`  Every task is done. Post a final report (${run} report${g} "...") and tell the human.`);
  } else {
    L.push('  1. Re-read the plan file (if any) and the decisions above.');
    if (flight.length)
      L.push(
        `  2. For each IN FLIGHT task, check the workspace to see if it really finished. If its agent is gone, run ${run} reopen <id>${g} (or start it again with a new owner). Do not leave stale tasks "active".`,
      );
    else L.push('  2. Nothing is in flight.');
    L.push('  3. Apply any NEW human input; it may change work already marked done.');
    L.push('  4. Continue with READY tasks, or unblock BLOCKED ones.');
    L.push(`  5. Post a report (${run} report${g} "...") so the dashboard shows you are back on it.`);
  }
  L.push(
    opts.cmd
      ? `  Use ${opts.cmd} for every command: it is bound to this goal. Do not run "goalpulse goal" again; it would start a separate goal.`
      : `  Pass${g} on every goalpulse command. Do not run "goalpulse goal" again; it would start a separate goal.`,
  );
  return L.join('\n');
}

module.exports = { statusText, goalsTable, briefing, ago };
