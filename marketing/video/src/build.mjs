// Bakes the real demo goal (from a goalpulse server on :4500) into index.html.
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('../goals.json', 'utf8'));
const g = d.goals.find((x) => x.slug === 'ship-team-billing');
const STATUS = ['active', 'review', 'done', 'blocked', 'failed', 'todo'];
const data = {
  title: g.goal.title,
  phases: g.phases.map((p) => p.name),
  tasks: g.tasks.map((t) => ({ id: t.id, title: t.title, phase: t.phase, owner: t.owner })),
  asks: g.asks.map((q) => ({ id: q.id, text: q.text, options: q.options, task: q.task })),
  events: g.activity
    .filter((e) => STATUS.includes(e.kind) || e.kind === 'ask' || e.kind === 'answer')
    .map((e) => ({ kind: e.kind, task: e.task, ref: e.ref || null, by: e.by })),
  wall: g.activity.map((e) => e.text),
};
// SFX: a soft click on every task completion, a ping when the goal completes (times mirror the template's C_EVENTS_FROM / STEP).
const FROM = 12.0, STEP = 0.23;
const doneIdx = data.events.map((e, i) => (e.kind === 'done' ? i : -1)).filter((i) => i >= 0);
const sfx = doneIdx.map((ev, n) => `<audio id="sfx-done-${n}" src="assets/sfx-click.mp3" data-start="${(FROM + ev * STEP).toFixed(2)}" data-duration="0.37" data-track-index="${6 + (n % 3)}" data-volume="0.45"></audio>`);
sfx.push(`<audio id="sfx-complete" src="assets/sfx-ping.mp3" data-start="${(FROM + doneIdx[doneIdx.length - 1] * STEP + 0.1).toFixed(2)}" data-duration="1.3" data-track-index="9" data-volume="0.55"></audio>`);

const VERTICAL_CSS = `
      .cap { font-size: 88px; padding: 0 60px; }
      #cap1 { top: 700px; } #cap2 { top: 900px; }
      #wall { left: 40px; top: 120px; } #fname { left: 60px; top: 140px; }
      #brand { top: 740px; } #brand .logo { width: 72px; height: 72px; margin-right: 22px; } #brand .logo::after { left: 26px; top: 26px; }
      #brand .name { font-size: 112px; } #tag { top: 940px; font-size: 40px; padding: 0 60px; }
      #dash { left: 40px; top: 150px; width: 1000px; height: 1640px; grid-template-columns: 1fr; grid-template-rows: auto 1fr; gap: 28px; }
      #gtitle { font-size: 52px; } #qbox { min-height: 300px; }
      .row { height: 76px; } .ph { height: 64px; font-size: 28px; } .ttl { font-size: 32px; } .tid { font-size: 26px; width: 76px; } .who { font-size: 24px; }
      .hl, .pct { font-size: 36px; } #counts { font-size: 30px; } .q .qt { font-size: 32px; } .opt { font-size: 24px; } .ans { font-size: 26px; } #qbox h3 { font-size: 28px; }
      #plabel { left: 60px; top: 560px; } #pbox { left: 60px; top: 620px; width: 960px; min-height: 420px; padding: 40px 40px; } #ptext { width: 800px; font-size: 40px; } #pnote { top: 1120px; font-size: 40px; padding: 0 60px; }
      #cta1 { left: 60px; right: 60px; top: 480px; font-size: 84px; line-height: 1.1; }
      #cta2 { left: 60px; right: 60px; top: 760px; font-size: 38px; }
      .code { left: 60px; width: 960px; font-size: 28px; padding: 24px 28px; } #code1 { top: 1000px; } #code2 { top: 1110px; }
      #repo { top: 1300px; font-size: 44px; }`;
const vertical = process.argv[2] === 'vertical';
let html = fs.readFileSync('index.tpl.html', 'utf8').replace('/*__DATA__*/null', JSON.stringify(data)).replace('<!--__SFX__-->', sfx.join('\n      '));
if (vertical) {
  html = html.replace('width=1920, height=1080', 'width=1080, height=1920').replace('width: 1920px; height: 1080px;', 'width: 1080px; height: 1920px;').replace('data-width="1920" data-height="1080"', 'data-width="1080" data-height="1920"')
    .replace('</style>', VERTICAL_CSS + '\n    </style>');
}
const dir = vertical ? '../ad-vertical' : '../ad';
fs.mkdirSync(dir + '/assets', { recursive: true });
for (const f of ['hyperframes.json', 'meta.json', 'package.json']) fs.copyFileSync('../ad/' + f, dir + '/' + f);
for (const f of fs.readdirSync('../ad/assets')) fs.copyFileSync('../ad/assets/' + f, dir + '/assets/' + f);
fs.writeFileSync(dir + '/index.html', html);
console.log(data.events.length, 'events,', data.tasks.length, 'tasks');
