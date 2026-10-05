#!/bin/sh
# Publish site/ (page + rendered videos) to the gh-pages branch. main never carries the videos.
# Each deploy replaces the branch with a single commit, so the videos do not pile up in history.
set -e
root=$(git rev-parse --show-toplevel)
origin=$(git -C "$root" remote get-url origin)
tmp=$(mktemp -d)
cp -R "$root/site/." "$tmp"
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy site"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -f "$origin" gh-pages
rm -rf "$tmp"
