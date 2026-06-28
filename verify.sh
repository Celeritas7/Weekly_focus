#!/usr/bin/env sh
# Weekly Focus — verify local files are the NEW cloud-first build.
# Run from your repo folder:   sh verify.sh
ok() { printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
no() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; FAILED=1; }
chk() { if grep -q "$2" "$1" 2>/dev/null; then ok "$3"; else no "$3  (missing in $1)"; fi; }
FAILED=0
echo "Weekly Focus — local file check"
echo "--------------------------------"

# files exist
for f in index.html config.js weekly-focus-app.js weekly-focus.css sw.js manifest.webmanifest; do
  [ -f "$f" ] && ok "exists: $f" || no "MISSING FILE: $f"
done
echo

# config baked in
chk config.js "window.WF_CONFIG" "config.js defines WF_CONFIG"
chk config.js "wylxvmkcrexwfpjpbhyy" "config.js has your Supabase URL"

# index loads config BEFORE the app
chk index.html 'src="config.js"' "index.html loads config.js"
if [ -f index.html ] && [ "$(grep -n 'config.js' index.html | head -1 | cut -d: -f1)" -lt "$(grep -n 'weekly-focus-app.js' index.html | head -1 | cut -d: -f1)" ] 2>/dev/null; then
  ok "config.js loads BEFORE weekly-focus-app.js"; else no "config.js must load before weekly-focus-app.js"; fi

# the APP is the cloud-first build (this is the one that was stale for you)
chk weekly-focus-app.js "WF_CONFIG" "app JS reads WF_CONFIG (cloud-first)"
chk weekly-focus-app.js "wireBoards" "app JS has the boards feature"
chk weekly-focus-app.js "function celebrate" "app JS has confetti/animations"

# CSS is the new one (styled board switcher + confetti)
chk weekly-focus.css ".boardbtn" "CSS has the styled board switcher"
chk weekly-focus.css "confetti-piece" "CSS has the confetti styles"

# service worker version
echo
printf "  sw.js cache: "; grep -o 'weekly-focus-v[0-9]*' sw.js 2>/dev/null || echo "?? (sw.js not found)"
echo "  (should be weekly-focus-v15 for the latest build)"

echo "--------------------------------"
[ "$FAILED" = 1 ] && echo "Some checks FAILED — re-paste those files from the app/ download, then push." \
                  || echo "All local files look like the new build. If the site still shows old UI, it's the Service Worker cache — unregister it + Clear site data + hard-reload."
