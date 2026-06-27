#!/usr/bin/env sh
# Weekly Focus — build step.
# Authoring lives in src/*.part (ordered fragments of one IIFE). This concatenates
# them, in filename order, into the shipped weekly-focus-app.js. Run before deploy:
#   sh build.sh        (from the app/ folder)
# Output is byte-identical to hand-editing the big file — zero runtime change.
# The .part extension keeps these fragments out of any JS/bundler tooling; only the
# concatenated weekly-focus-app.js is ever loaded by a browser.
cd "$(dirname "$0")" || exit 1
cat src/*.part > weekly-focus-app.js
echo "Built weekly-focus-app.js from $(ls src/*.part | wc -l | tr -d ' ') parts."
