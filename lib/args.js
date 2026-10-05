'use strict';

// Minimal argv parser: positionals, --flag value, --flag=value, repeated flags -> arrays,
// bare boolean flags, and single-letter aliases.
function parse(argv, { boolean = [], alias = {} } = {}) {
  const pos = [];
  const flags = {};
  const bools = new Set(boolean);

  const set = (k, v) => {
    if (k in flags) flags[k] = [].concat(flags[k], v);
    else flags[k] = v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2 && isNaN(a))) {
      let key = a.replace(/^--?/, '');
      let val;
      const eq = key.indexOf('=');
      if (eq !== -1) {
        val = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      key = alias[key] || key;
      if (val === undefined) {
        if (bools.has(key)) val = true;
        else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i];
        else val = true;
      }
      set(key, val);
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

// Last value wins for scalar flags that were repeated.
const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v === true ? undefined : v);
// Always an array (repeated flags), dropping bare booleans.
const many = (v) => (v === undefined ? [] : [].concat(v).filter((x) => x !== true));
// Comma separated list -> array.
const csv = (v) =>
  v === undefined
    ? []
    : many(v)
        .join(',')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

module.exports = { parse, one, many, csv };
