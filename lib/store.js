'use strict';

const fs = require('fs');
const path = require('path');

// Layout:
//   .goalpulse/goals/<slug>/events.jsonl      one append-only log per goal
//   .goalpulse/events.jsonl                   (legacy single-goal log, exposed as goal "default")
const DIR_NAME = '.goalpulse';
const FILE = 'events.jsonl';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

const validSlug = (s) => typeof s === 'string' && SLUG_RE.test(s);

function slugify(title) {
  const s = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'goal';
}

// Locate the .goalpulse root: GOALPULSE_DIR wins, otherwise walk up from cwd.
function findRoot(start = process.cwd()) {
  if (process.env.GOALPULSE_DIR) {
    const d = path.resolve(process.env.GOALPULSE_DIR);
    return fs.existsSync(d) ? d : null;
  }
  let cur = path.resolve(start);
  for (;;) {
    const cand = path.join(cur, DIR_NAME);
    if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) return cand;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function initRoot(base = process.cwd()) {
  const root = process.env.GOALPULSE_DIR
    ? path.resolve(process.env.GOALPULSE_DIR)
    : path.join(path.resolve(base), DIR_NAME);
  fs.mkdirSync(path.join(root, 'goals'), { recursive: true });
  const gi = path.join(root, '.gitignore');
  if (!fs.existsSync(gi))
    fs.writeFileSync(gi, '# goalpulse logs are local by default. Delete this file to commit them.\n*\n');
  return root;
}

function goalFile(root, slug) {
  if (!validSlug(slug)) throw new Error(`invalid goal id "${slug}"`);
  const p = path.join(root, 'goals', slug, FILE);
  if (slug === 'default' && !fs.existsSync(p) && fs.existsSync(path.join(root, FILE))) return path.join(root, FILE);
  return p;
}

function listSlugs(root) {
  const out = [];
  const dir = path.join(root, 'goals');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (validSlug(name) && fs.existsSync(path.join(dir, name, FILE))) out.push(name);
    }
  }
  if (fs.existsSync(path.join(root, FILE)) && !out.includes('default')) out.push('default');
  return out;
}

function createGoal(root, slug) {
  const file = goalFile(root, slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '');
}

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// A tiny command bound to one goal (a sh script plus a .cmd twin for Windows). Because the goal
// is built in, an agent never passes --goal and cannot log to the wrong goal. It locates the
// .goalpulse folder relative to itself, so it survives moving the project. Returns the sh path.
function ensureWrapper(root, slug, bin) {
  const file = goalFile(root, slug);
  const dir = path.dirname(file);
  const rel = path.relative(dir, root) || '.';
  const sh = path.join(dir, 'gp');
  const cmd = path.join(dir, 'gp.cmd');
  const binOk = bin && fs.existsSync(bin);

  const shText = [
    '#!/bin/sh',
    `# goalpulse command bound to the goal "${slug}". Generated; safe to delete (goalpulse resume re-creates it).`,
    `GOALPULSE_DIR="$(cd "$(dirname "$0")/${rel.split(path.sep).join('/')}" && pwd)"`,
    'export GOALPULSE_DIR',
    `export GOALPULSE_GOAL=${shq(slug)}`,
    binOk ? `if [ -f ${shq(bin)} ]; then exec node ${shq(bin)} "$@"; fi` : '',
    'exec goalpulse "$@"',
    '',
  ]
    .filter((l, i, a) => l !== '' || i === a.length - 1)
    .join('\n');

  const cmdText = [
    '@echo off',
    `set "GOALPULSE_DIR=%~dp0${rel.split(path.sep).join('\\')}"`,
    `set "GOALPULSE_GOAL=${slug}"`,
    binOk ? `if exist "${bin}" (node "${bin}" %* & exit /b %errorlevel%)` : '',
    'goalpulse %*',
    '',
  ]
    .filter((l, i, a) => l !== '' || i === a.length - 1)
    .join('\r\n');

  const write = (p, text, mode) => {
    let cur = null;
    try {
      cur = fs.readFileSync(p, 'utf8');
    } catch (_) {
      /* new file */
    }
    if (cur !== text) fs.writeFileSync(p, text);
    if (mode) fs.chmodSync(p, mode);
  };
  write(sh, shText, 0o755);
  write(cmd, cmdText);
  return sh;
}

// One JSON object per line. O_APPEND writes of a single short line are atomic enough
// that concurrent writers do not interleave.
function append(root, slug, event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(goalFile(root, slug), line);
}

// Tolerant reader: skips blank and unparsable lines (e.g. a half-written last line).
function readEvents(root, slug) {
  const file = goalFile(root, slug);
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_) {
      /* ignore */
    }
  }
  return out;
}

module.exports = {
  DIR_NAME,
  FILE,
  validSlug,
  slugify,
  findRoot,
  initRoot,
  goalFile,
  listSlugs,
  createGoal,
  ensureWrapper,
  append,
  readEvents,
};
