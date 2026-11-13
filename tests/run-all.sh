#!/bin/bash
# Runs every test that does not need After Effects or Figma.
set -e
cd "$(dirname "$0")/.."
echo "== unit tests"
node tests/unit.js
node tests/illustrator-nodoc.js
echo "== lint"
for f in release/illustrator-panel.jsx after-effects/layerboat-core.jsx after-effects/illustrator-export.jsx after-effects/illustrator-import.jsx photoshop/photoshop-export.jsx "release/Uninstall LayerBoat.jsx" figma-plugin/code.js "release/Install LayerBoat.jsx"; do cp "$f" /tmp/lint-check.js; (cd tools && [ -d node_modules ] || npm install --silent) && (cd tools && npx eslint -c .eslintrc.json --no-eslintrc /tmp/lint-check.js); done
echo "lint clean"
echo "== helper build"
[ -f relay/layerboat-helper-arm64 ] || sh relay/build.sh
echo "== release build"
python3 tools/build_release.py
if command -v wine >/dev/null; then
  echo "== Windows install and live connection (Wine)"
  node tests/windows-sim.js "$(pwd)/$(ls -t release/dist/*.zip | head -1)"
else
  echo "== Windows simulation skipped (Wine not installed)"
fi
