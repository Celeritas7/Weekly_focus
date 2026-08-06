# Weekly Focus — folder reorganisation

New layout (root of Weekly_focus):

    index.html
    sw.js                  <- MUST stay at root (PWA scope)
    manifest.webmanifest
    README.md, .gitignore
    css/
      weekly-focus.css
      home-screens.css
    js/
      config.js
      info-feeds.js
      weekly-focus-app.js
      wf-cc-bridge-v2.js
    icons/
      icon-180.png
      icon-192.png
      icon-512.png

## Steps
1. Create folders: css, js, icons
2. Move the files as shown above (drag in Explorer, or in PowerShell from the Weekly_focus folder):

    mkdir css, js, icons
    mv weekly-focus.css, home-screens.css css\
    mv config.js, info-feeds.js, weekly-focus-app.js, wf-cc-bridge-v2.js js\
    mv icon-180.png, icon-192.png, icon-512.png icons\

3. Replace these 3 root files with the updated copies in this zip:
   - index.html   (css/js/icon paths updated)
   - sw.js        (asset list updated, cache bumped to v36 so the new build installs)
   - manifest.webmanifest (icon paths updated)

Nothing inside the JS/CSS files references other files by path, so they move as-is.
