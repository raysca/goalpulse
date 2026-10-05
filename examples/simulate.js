#!/usr/bin/env node
'use strict';

// Simulates a coordinator agent driving a goal through the goalpulse CLI, the way a real
// run would: plan, spin up sub-agents, review loop, assumptions, a blocker, a question.
//
//   node examples/simulate.js                      full run, instantly
//   node examples/simulate.js --until 38           stop partway (mid-flight snapshot)
//   node examples/simulate.js --live --serve       replay in real time with the dashboard open
//   node examples/simulate.js --dir /tmp/demo      write the log somewhere specific

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { parse, one } = require('../lib/args');

const BIN = path.join(__dirname, '..', 'bin', 'goalpulse.js');
const { flags } = parse(process.argv.slice(2), { boolean: ['live', 'serve', 'count', 'force'] });
const dir = path.resolve(one(flags.dir) || path.join(process.cwd(), '.goalpulse-demo'));
const env = { ...process.env, GOALPULSE_DIR: dir };

const PLAN = [
  { id: 'T1', title: 'Audit existing billing code', phase: 'Discovery' },
  { id: 'T2', title: 'Choose payment provider integration approach', phase: 'Discovery' },
  { id: 'T3', title: 'Schema for teams and subscriptions', phase: 'Build', deps: ['T1'] },
  { id: 'T4', title: 'Stripe webhook handler', phase: 'Build', deps: ['T2', 'T3'] },
  { id: 'T5', title: 'Checkout session API', phase: 'Build', deps: ['T3'] },
  { id: 'T6', title: 'Seat management UI', phase: 'Build', deps: ['T5'] },
  { id: 'T7', title: 'Usage metering job', phase: 'Build', deps: ['T4'] },
  { id: 'T8', title: 'Integration test suite', phase: 'Verify', deps: ['T4', 'T5'] },
  { id: 'T9', title: 'Security review', phase: 'Verify', deps: ['T4', 'T5', 'T7'] },
  { id: 'T10', title: 'Docs and migration guide', phase: 'Verify', deps: ['T6'] },
  { id: 'T11', title: 'Rollout plan behind feature flag', phase: 'Verify', deps: ['T8', 'T9'] },
];

// Each step: [delay-before-ms (live mode), argv, optional stdin]
const S = [];
const MAIN = 'ship-team-billing';
const FLAKY = 'fix-flaky-ci';
const NODE = 'upgrade-node-22';
let CUR = MAIN;
const use = (g) => {
  CUR = g;
};
const step = (ms, ...args) => S.push({ ms, args, goal: CUR });

// A third, already-finished goal that has been archived (shows the archived toggle).
use(NODE);
step(0, 'goal', 'Upgrade to Node 22', '--id', NODE, '--desc', 'Move CI and production images from Node 18 to 22.');
S.push({
  ms: 200,
  goal: CUR,
  args: ['plan'],
  input: JSON.stringify([
    { id: 'N1', title: 'Update CI images' },
    { id: 'N2', title: 'Fix deprecated API usage', deps: ['N1'] },
    { id: 'N3', title: 'Roll out to production', deps: ['N2'] },
  ]),
});
step(100, 'start', 'N1', '--by', 'devops-1');
step(100, 'done', 'N1', 'CI matrix now on Node 22', '--by', 'devops-1');
step(100, 'start', 'N2', '--by', 'backend-1');
step(100, 'done', 'N2', 'Replaced 4 deprecated calls', '--by', 'backend-1');
step(100, 'start', 'N3', '--by', 'devops-1');
step(100, 'done', 'N3', 'Rolled out with no errors', '--by', 'devops-1');
step(100, 'report', 'Upgrade finished across CI and production with no regressions.', '--health', 'on-track');
step(100, 'archive');
use(MAIN);

step(
  0,
  'goal',
  'Ship team-based billing',
  '--id',
  MAIN,
  '--plan',
  'docs/billing-plan.md',
  '--desc',
  'Per-seat subscriptions for teams, following docs/billing-plan.md. Target: live behind a feature flag by Friday.',
);
S.push({ ms: 400, goal: CUR, args: ['plan'], input: JSON.stringify(PLAN) });
step(
  600,
  'report',
  'Plan registered: 11 tasks across Discovery, Build and Verify. Starting with the two discovery tasks in parallel.',
  '--health',
  'on-track',
  '--next',
  'Audit existing billing code (T1)',
  '--next',
  'Choose provider integration approach (T2)',
);

// -- Discovery
step(1200, 'start', 'T1', '--by', 'explorer-1');
step(300, 'start', 'T2', '--by', 'architect-1');
step(
  1500,
  'assume',
  'Stripe is the payment provider. The plan references Stripe objects but never says it is mandated.',
  '--why',
  'Billing plan section 2 uses Stripe terminology throughout',
  '--alt',
  'Paddle (merchant of record)',
  '--confidence',
  'medium',
  '--impact',
  'high',
  '--task',
  'T2',
  '--by',
  'architect-1',
);
step(
  1200,
  'note',
  'Legacy billing code lives in app/billing/legacy; 3 callers still import it.',
  '--kind',
  'finding',
  '--task',
  'T1',
  '--by',
  'explorer-1',
);
step(
  1500,
  'assume',
  'Keep legacy invoices read-only instead of migrating them.',
  '--why',
  'Migrating 40k rows has no stated requirement',
  '--alt',
  'One-off backfill into the new schema',
  '--confidence',
  'high',
  '--impact',
  'low',
  '--task',
  'T1',
  '--by',
  'explorer-1',
);
step(1200, 'done', 'T1', 'Mapped 14 files; 3 legacy callers need a compatibility shim', '--by', 'explorer-1');

// A second goal starts in the same project while the first is running.
use(FLAKY);
step(
  600,
  'goal',
  'Fix flaky CI tests',
  '--id',
  FLAKY,
  '--plan',
  'docs/flaky-tests.md',
  '--desc',
  'The checkout suite fails about 1 in 8 CI runs. Find the cause, fix it, and prove it with 50 green runs.',
);
S.push({
  ms: 200,
  goal: CUR,
  args: ['plan'],
  input: JSON.stringify([
    { id: 'F1', title: 'Reproduce the failure locally', phase: 'Diagnose' },
    { id: 'F2', title: 'Identify the root cause', phase: 'Diagnose', deps: ['F1'] },
    { id: 'F3', title: 'Fix and add a regression test', phase: 'Fix', deps: ['F2'] },
    { id: 'F4', title: '50-run soak test on CI', phase: 'Fix', deps: ['F3'] },
  ]),
});
step(400, 'start', 'F1', '--by', 'debugger-1');
step(900, 'done', 'F1', 'Reproduced with --repeat 40; fails when two specs share a session', '--by', 'debugger-1');
step(300, 'start', 'F2', '--by', 'debugger-1');
step(
  900,
  'assume',
  'The shared test session store is the cause, not network timing.',
  '--why',
  'Failures only appear when specs run in parallel',
  '--alt',
  'CI runner network jitter',
  '--confidence',
  'low',
  '--impact',
  'high',
  '--task',
  'F2',
  '--by',
  'debugger-1',
);
step(
  600,
  'ask',
  'Can we quarantine checkout.spec on CI while we investigate?',
  '--task',
  'F2',
  '--option',
  'Yes, quarantine it',
  '--option',
  'No, keep it blocking',
);
step(
  300,
  'report',
  'Failure reproduced locally; investigating the shared session store as the likely cause.',
  '--health',
  'on-track',
  '--next',
  'Confirm the root cause (F2)',
);
use(MAIN);
step(900, 'review', 'T2', '--by', 'reviewer-1');
step(
  1500,
  'note',
  'Webhook-driven state sync with idempotency keys, not polling.',
  '--kind',
  'decision',
  '--task',
  'T2',
  '--by',
  'architect-1',
);
step(1200, 'done', 'T2', 'Approach agreed; ADR written to docs/adr/012-billing-sync.md', '--by', 'architect-1');
step(
  600,
  'report',
  'Discovery finished. Provider approach settled on webhook-driven sync; legacy code needs a thin shim. Moving into the build phase.',
  '--health',
  'on-track',
  '--next',
  'Schema for teams and subscriptions (T3)',
  '--risk',
  'Plan is silent on proration rules',
);

// -- Build wave 1 (with a review round-trip)
step(1200, 'start', 'T3', '--by', 'backend-1');
step(
  1500,
  'assume',
  'Seat limits are enforced in the application layer, not by a database constraint.',
  '--why',
  'Limits change per plan, so a constraint would need a migration each time',
  '--alt',
  'Check constraint driven by a plans table',
  '--confidence',
  'medium',
  '--impact',
  'medium',
  '--task',
  'T3',
  '--by',
  'backend-1',
);
step(
  1200,
  'ask',
  'Should free-trial teams be capped at 5 seats?',
  '--task',
  'T3',
  '--option',
  'Yes, cap at 5',
  '--option',
  'No cap during trial',
);
step(
  900,
  'note',
  'The plan does not say how to prorate mid-cycle seat changes.',
  '--kind',
  'risk',
  '--task',
  'T3',
  '--by',
  'backend-1',
);
step(1500, 'review', 'T3', '--by', 'reviewer-1');
step(1500, 'start', 'T3', 'Reviewer asked for an index on subscriptions.team_id', '--by', 'backend-1');
step(1200, 'review', 'T3', '--by', 'reviewer-1');
step(1200, 'done', 'T3', 'Schema and migration merged, index added', '--by', 'backend-1');
step(600, 'resume', '--by', 'coordinator-2'); // handover: the first coordinator ran out of context

// -- Build wave 2 (parallel)
step(900, 'start', 'T4', '--by', 'backend-1');
step(300, 'start', 'T5', '--by', 'backend-2');
step(
  1500,
  'assume',
  'Prorate seat changes to the day, matching Stripe default behaviour.',
  '--why',
  'Plan is silent; this needs no custom logic',
  '--alt',
  'Apply changes from the next billing cycle',
  '--confidence',
  'low',
  '--impact',
  'high',
  '--task',
  'T5',
  '--by',
  'backend-2',
);
step(
  1500,
  'block',
  'T4',
  'Needs STRIPE_WEBHOOK_SECRET for the test environment; not in the repo or CI secrets',
  '--by',
  'backend-1',
);
step(
  600,
  'ask',
  'Can you add a Stripe test-mode webhook secret to CI?',
  '--task',
  'T4',
  '--option',
  'I will add it',
  '--option',
  'Use the Stripe CLI locally for now',
);
step(1500, 'review', 'T5', '--by', 'reviewer-2');
step(1500, 'done', 'T5', 'Checkout session API with 9 passing tests', '--by', 'backend-2');
step(900, 'start', 'T6', '--by', 'frontend-1');
step(
  1200,
  'assume',
  'Seat picker caps at 50 seats, then shows "contact sales".',
  '--why',
  'Common pattern; keeps large accounts on invoicing',
  '--confidence',
  'medium',
  '--impact',
  'low',
  '--task',
  'T6',
  '--by',
  'frontend-1',
);
const MIDFLIGHT = S.length;
step(
  600,
  'report',
  'Checkout API is done and the seat UI is underway. Webhook handler (T4) is blocked on a CI secret, which holds up metering, tests and the security review. Two assumptions about proration and the provider need your eyes.',
  '--health',
  'at-risk',
  '--next',
  'Unblock T4 (needs your answer on Q2)',
  '--next',
  'Finish seat UI (T6)',
  '--risk',
  'T7, T8, T9 and T11 are all waiting behind T4',
  '--risk',
  'Proration assumption (A4) is low confidence and high impact',
);

// -- Resolution
step(1500, 'answer', 'Q2', 'Use the Stripe CLI locally for now; I will add the CI secret Monday');
step(900, 'unblock', 'T4', 'Using a locally generated secret from the Stripe CLI', '--by', 'backend-1');
step(1500, 'answer', 'Q1', 'Cap at 5 seats during trial');
step(900, 'resolve', 'A1', 'confirmed', 'Stripe is correct');
step(900, 'resolve', 'A4', 'revised', 'Apply seat changes from the next billing cycle instead');
step(1500, 'review', 'T6', '--by', 'reviewer-2');
step(1200, 'done', 'T6', 'Seat UI shipped with cap and contact-sales state', '--by', 'frontend-1');
step(1200, 'review', 'T4', '--by', 'reviewer-1');
step(1200, 'done', 'T4', 'Webhook handler with idempotency, retries and signature checks', '--by', 'backend-1');
step(900, 'start', 'T7', '--by', 'backend-2');
step(300, 'start', 'T8', '--by', 'qa-1');
step(300, 'start', 'T10', '--by', 'writer-1');
step(1500, 'fail', 'T8', 'Proration test fails: day-based proration was removed under A4', '--by', 'qa-1');
step(900, 'reopen', 'T8');
step(600, 'start', 'T8', 'Rewriting proration tests for next-cycle behaviour', '--by', 'qa-1');
step(1500, 'review', 'T7', '--by', 'reviewer-1');
step(1200, 'done', 'T7', 'Hourly metering job with backfill command', '--by', 'backend-2');
step(900, 'done', 'T10', 'Migration guide and API docs updated', '--by', 'writer-1');
step(1200, 'review', 'T8', '--by', 'reviewer-2');
step(1200, 'done', 'T8', '41 integration tests passing', '--by', 'qa-1');
step(900, 'start', 'T9', '--by', 'security-1');
step(
  1500,
  'note',
  'Webhook endpoint verifies signatures and rejects replays older than 5 minutes.',
  '--kind',
  'finding',
  '--task',
  'T9',
  '--by',
  'security-1',
);
step(1200, 'done', 'T9', 'No critical findings; one low-severity logging fix applied', '--by', 'security-1');
step(900, 'start', 'T11', '--by', 'coordinator');
step(1200, 'done', 'T11', 'Staged rollout: 5% of teams, then 25%, then everyone', '--by', 'coordinator');
step(
  600,
  'report',
  'All 11 tasks are done. Team billing is complete behind the feature flag, with staged rollout planned. Remaining follow-up for you: add the Stripe test secret to CI.',
  '--health',
  'on-track',
  '--next',
  'Add the CI webhook secret',
  '--next',
  'Flip the flag for 5% of teams',
);

if (flags.count) {
  console.log(`${S.length} steps; mid-flight cut (just after the at-risk report) is --until ${MIDFLIGHT + 1}`);
  process.exit(0);
}

const until = flags.until ? Number(one(flags.until)) : S.length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Start from a clean slate, but only ever touch this simulation's own goals.
  for (const g of [MAIN, FLAKY, NODE]) {
    const gdir = path.join(dir, 'goals', g);
    if (fs.existsSync(path.join(gdir, 'events.jsonl')) && !flags.force) {
      console.error(
        `${gdir} already exists. Re-run with --force to replace the simulated goals, or pick another --dir.`,
      );
      process.exit(1);
    }
    fs.rmSync(gdir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(dir, 'goals'), { recursive: true });

  if (flags.serve) {
    const { serve } = require('../lib/server');
    const { url } = await serve({ root: dir });
    console.log(`dashboard: ${url}`);
  }

  for (const [i, s] of S.slice(0, until).entries()) {
    if (flags.live) await sleep(s.ms);
    const r = spawnSync(process.execPath, [BIN, ...s.args], {
      env: { ...env, GOALPULSE_GOAL: s.goal },
      input: s.input,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.error(`step ${i + 1} failed: goalpulse ${s.args.join(' ')}\n${r.stderr}`);
      process.exit(1);
    }
    if (flags.live) console.log(`[${i + 1}/${Math.min(until, S.length)}] goalpulse ${s.args.slice(0, 3).join(' ')}`);
  }
  console.log(`simulated ${Math.min(until, S.length)} of ${S.length} steps → ${path.join(dir, 'goals')}`);
  if (!flags.serve) process.exit(0);
  console.log('replay finished; dashboard still running (Ctrl+C to stop)');
})();
