const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bin = path.join(__dirname, '..', 'bin', 'goalpulse.js');

test('create goal, add task, render snapshot', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'));
  const run = (...a) => execFileSync('node', [bin, ...a], { cwd, encoding: 'utf8' });
  run('goal', 'Smoke');
  assert.match(run('add', 'first task'), /T1 added/);
  assert.ok(fs.existsSync(run('render').trim()));
  run('install-skill');
  assert.ok(fs.existsSync(path.join(cwd, '.agents', 'skills', 'goalpulse', 'SKILL.md')));
});
