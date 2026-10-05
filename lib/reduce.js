'use strict';

// Turns the append-only event list into the state the dashboard and `status` render.
// Pure function: same events in, same state out.

const STATUSES = ['todo', 'active', 'review', 'blocked', 'failed', 'done', 'dropped'];

const clip = (s, n = 140) => {
  s = String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function reduce(events, opts = {}) {
  const s = {
    slug: opts.slug || null,
    rev: events.length,
    archived: false,
    resumes: [],
    goal: null,
    tasks: [],
    assumptions: [],
    asks: [],
    notes: [],
    report: null,
    activity: [],
    startedAt: null,
    updatedAt: null,
  };
  const tasks = new Map();
  const assumptions = new Map();
  const asks = new Map();

  const ensure = (id, ts) => {
    let t = tasks.get(id);
    if (!t) {
      t = {
        id,
        title: id,
        desc: '',
        owner: null,
        reviewer: null,
        phase: null,
        deps: [],
        status: 'todo',
        result: null,
        blocker: null,
        createdAt: ts,
        updatedAt: ts,
        history: [],
        implicit: true, // true until a `task` event defines it
      };
      tasks.set(id, t);
      s.tasks.push(t);
    }
    return t;
  };

  const act = (e, kind, text, task, extra) => {
    s.activity.push({ ts: e.ts, kind, text, task: task || null, by: e.by || null, ...extra });
  };

  for (const e of events) {
    if (!s.startedAt) s.startedAt = e.ts;
    s.updatedAt = e.ts;

    switch (e.type) {
      case 'goal': {
        // Later goal events edit only the fields they carry.
        const prev = s.goal;
        s.goal = {
          title: e.title != null ? e.title : (prev && prev.title) || '',
          desc: e.desc != null ? e.desc : (prev && prev.desc) || '',
          plan: e.plan != null ? e.plan : (prev && prev.plan) || '',
          ts: prev ? prev.ts : e.ts,
        };
        act(e, 'goal', `${prev ? 'Goal updated' : 'Goal set'}: ${clip(s.goal.title)}`);
        break;
      }

      case 'resume':
        s.resumes.push({ ts: e.ts, by: e.by || null });
        act(e, 'resume', `Work resumed${e.by ? ' by ' + e.by : ''}`);
        break;

      case 'archive':
      case 'unarchive':
        s.archived = e.type === 'archive';
        act(e, e.type, e.type === 'archive' ? 'Goal archived' : 'Goal restored');
        break;

      case 'task': {
        const t = ensure(e.id, e.ts);
        t.implicit = false;
        if (e.title) t.title = e.title;
        if (e.desc != null) t.desc = e.desc;
        if (e.owner) t.owner = e.owner;
        if (e.phase) t.phase = e.phase;
        if (Array.isArray(e.deps)) t.deps = e.deps;
        t.updatedAt = e.ts;
        // Collapse a burst of task definitions (a plan import) into one feed entry.
        const last = s.activity[s.activity.length - 1];
        if (last && last.kind === 'plan') {
          last.count += 1;
          last.text = `Planned ${last.count} tasks`;
          last.ts = e.ts;
        } else {
          act(e, 'plan', 'Added 1 task', null, { count: 1 });
        }
        break;
      }

      case 'status': {
        const t = ensure(e.id, e.ts);
        t.status = e.status;
        t.updatedAt = e.ts;
        if (e.status === 'active' && e.by) t.owner = e.by;
        if (e.status === 'review' && e.by) t.reviewer = e.by;
        if (e.status === 'done') {
          if (e.text) t.result = e.text;
          if (e.by) t.doneBy = e.by;
        }
        t.blocker = e.status === 'blocked' || e.status === 'failed' ? e.text || null : null;
        t.history.push({ ts: e.ts, status: e.status, by: e.by || null, text: e.text || '' });

        const title = clip(t.title, 80);
        const why = e.text ? ` — ${clip(e.text)}` : '';
        const text =
          {
            active: `Started ${e.id} · ${title}${why}`,
            review: `${e.id} ready for review · ${title}`,
            done: `Finished ${e.id} · ${title}${why}`,
            blocked: `Blocked ${e.id} · ${title}${why}`,
            failed: `Failed ${e.id} · ${title}${why}`,
            dropped: `Dropped ${e.id} · ${title}${why}`,
            todo: `Reopened ${e.id} · ${title}`,
          }[e.status] || `${e.id} → ${e.status}`;
        act(e, e.status, text, e.id);
        break;
      }

      case 'assume': {
        const a = {
          id: e.id,
          text: e.text,
          why: e.why || '',
          alt: e.alt || '',
          confidence: e.confidence || 'medium',
          impact: e.impact || 'medium',
          task: e.task || null,
          by: e.by || null,
          status: 'open',
          note: '',
          ts: e.ts,
          resolvedAt: null,
        };
        assumptions.set(a.id, a);
        s.assumptions.push(a);
        act(e, 'assume', `Assumed: ${clip(e.text)}`, e.task, { ref: a.id });
        break;
      }

      case 'resolve': {
        const a = assumptions.get(e.id);
        if (!a) break;
        a.status = e.status || 'confirmed';
        a.note = e.text || '';
        a.resolvedAt = e.ts;
        act(
          e,
          'resolve',
          `${a.status[0].toUpperCase()}${a.status.slice(1)} ${e.id}${e.text ? ' — ' + clip(e.text) : ''}`,
          a.task,
          { ref: a.id },
        );
        break;
      }

      case 'note': {
        const n = { ts: e.ts, kind: e.kind || 'note', text: e.text, task: e.task || null, by: e.by || null };
        s.notes.push(n);
        act(
          e,
          n.kind,
          `${n.kind === 'note' ? '' : n.kind[0].toUpperCase() + n.kind.slice(1) + ': '}${clip(e.text)}`,
          e.task,
        );
        break;
      }

      case 'ask': {
        const q = {
          id: e.id,
          text: e.text,
          task: e.task || null,
          options: e.options || [],
          by: e.by || null,
          status: 'open',
          answer: null,
          ts: e.ts,
        };
        asks.set(q.id, q);
        s.asks.push(q);
        act(e, 'ask', `Question: ${clip(e.text)}`, e.task, { ref: q.id });
        break;
      }

      case 'answer': {
        const q = asks.get(e.id);
        if (!q) break;
        q.status = 'answered';
        q.answer = e.text || '';
        q.answeredAt = e.ts;
        act(e, 'answer', `Answered ${e.id}${e.text ? ' — ' + clip(e.text) : ''}`, q.task, { ref: q.id });
        break;
      }

      case 'report':
        s.report = {
          ts: e.ts,
          summary: e.summary || '',
          health: e.health || null,
          next: e.next || [],
          risks: e.risks || [],
          by: e.by || null,
        };
        act(e, 'report', `Status report: ${clip(e.summary)}`);
        break;

      default:
        break;
    }
  }

  // ---- derived values -------------------------------------------------------
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]));
  for (const t of s.tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  s.counts = counts;

  const total = s.tasks.length - counts.dropped;
  s.progress = { total, done: counts.done, pct: total ? Math.round((100 * counts.done) / total) : 0 };

  // A todo task is "waiting" while any dependency is unfinished; otherwise it is ready.
  for (const t of s.tasks) {
    t.waitingOn = [];
    if (t.status === 'todo') {
      t.waitingOn = t.deps.filter((d) => {
        const dep = tasks.get(d);
        return dep && dep.status !== 'done' && dep.status !== 'dropped';
      });
    }
    t.ready = t.status === 'todo' && t.waitingOn.length === 0;
  }

  // Phases (only when at least one task declares one).
  s.phases = [];
  if (s.tasks.some((t) => t.phase)) {
    const pm = new Map();
    for (const t of s.tasks) {
      if (t.status === 'dropped') continue;
      const name = t.phase || 'Other';
      if (!pm.has(name)) pm.set(name, { name, total: 0, done: 0 });
      const p = pm.get(name);
      p.total += 1;
      if (t.status === 'done') p.done += 1;
    }
    s.phases = [...pm.values()];
  }

  // What needs a human: open questions, blocked/failed work, and risky open assumptions.
  const needsReview = (a) => a.status === 'open' && (a.impact === 'high' || a.confidence === 'low');
  s.attention = [
    ...s.asks
      .filter((q) => q.status === 'open')
      .map((q) => ({ kind: 'question', id: q.id, text: q.text, task: q.task })),
    ...s.tasks
      .filter((t) => t.status === 'blocked')
      .map((t) => ({ kind: 'blocked', id: t.id, title: t.title, text: t.blocker || 'No reason given', task: t.id })),
    ...s.tasks
      .filter((t) => t.status === 'failed')
      .map((t) => ({ kind: 'failed', id: t.id, title: t.title, text: t.blocker || 'No reason given', task: t.id })),
    ...s.assumptions.filter(needsReview).map((a) => ({
      kind: 'assumption',
      id: a.id,
      text: a.text,
      task: a.task,
      confidence: a.confidence,
      impact: a.impact,
    })),
  ];

  // Health: the coordinator's stated health wins, except that a finished goal is complete and live blocked work overrides a stale on-track.
  const derived = !total
    ? 'planning'
    : counts.done === total
      ? 'complete'
      : counts.blocked || counts.failed
        ? 'at-risk'
        : 'on-track';
  const reported = s.report && s.report.health;
  s.health = { value: derived === 'complete' ? 'complete' : reported === 'on-track' && derived === 'at-risk' ? 'at-risk' : reported || derived, derived, reported: reported || null };

  return s;
}

module.exports = { reduce, STATUSES, clip };
