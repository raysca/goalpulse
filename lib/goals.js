'use strict';

const store = require('./store');
const { reduce } = require('./reduce');

const loadGoal = (root, slug) => reduce(store.readEvents(root, slug), { slug });
const loadAll = (root) => store.listSlugs(root).map((slug) => loadGoal(root, slug));

// Decide which goal a command applies to.
//   explicit --goal / GOALPULSE_GOAL wins; otherwise the only candidate, if there is exactly one;
//   otherwise an error listing candidates. Refusing to guess keeps parallel goals from
//   writing into each other's logs.
function resolveGoal(root, wanted) {
  const slugs = store.listSlugs(root);
  if (wanted) {
    if (!store.validSlug(wanted) || !slugs.includes(wanted)) {
      return { error: `no goal "${wanted}". Known goals: ${slugs.join(', ') || '(none)'}` };
    }
    return { slug: wanted };
  }
  if (!slugs.length) return { error: 'no goals yet. Start one with: goalpulse goal "Title"' };
  if (slugs.length === 1) return { slug: slugs[0] };

  const all = slugs.map((s) => loadGoal(root, s));
  const live = all.filter((g) => !g.archived);
  if (live.length === 1) return { slug: live[0].slug };
  const open = live.filter((g) => g.health.value !== 'complete');
  if (open.length === 1) return { slug: open[0].slug };

  const candidates = (open.length ? open : live.length ? live : all).map((g) => g.slug);
  return { error: `several goals could apply (${candidates.join(', ')}). Pass --goal <slug>`, ambiguous: true };
}

// Unique slug derived from a title: ship-it, ship-it-2, ...
function uniqueSlug(root, title) {
  const taken = new Set(store.listSlugs(root));
  const base = store.slugify(title);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base.slice(0, 55)}-${i}`;
    if (!taken.has(cand)) return cand;
  }
}

module.exports = { loadGoal, loadAll, resolveGoal, uniqueSlug };
