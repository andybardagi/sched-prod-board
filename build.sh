#!/bin/sh
# Copies app/ to dist/ and stamps the last commit that changed app/ (R6). Refuses a dirty app/, so the sha is the build.
set -e
cd "$(dirname "$0")"
if [ -n "$(git status --porcelain -- app)" ]; then echo "app/ has uncommitted changes" >&2; exit 1; fi
SHA=$(git log -1 --format=%H -- app)  # the last commit that changed the board itself
rm -rf dist && cp -R app dist && if [ -d .deploy/.vercel ]; then cp -R .deploy/.vercel .deploy/.vercelignore dist/; [ -d .deploy/proof ] && cp -R .deploy/proof dist/; fi
sed -i '' "s/__BUILD_SHA__/$SHA/g" dist/index.html
# The session is not in git: it comes from the challenge folder's git-ignored session.secret.json, or $SESSION.
SESSION=${SESSION:-$(node -p "require('../../session.secret.json').session")}
sed -i '' "s/__SESSION__/$SESSION/" dist/config.js
echo "$SHA"
