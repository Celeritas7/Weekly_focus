# Weekly Focus - verify local files are the NEW cloud-first build.
# Run from your repo folder:   powershell -ExecutionPolicy Bypass -File verify.ps1
$ErrorActionPreference = 'SilentlyContinue'
function Chk($file, $pat, $desc) {
  if (Select-String -Path $file -Pattern $pat -SimpleMatch -Quiet) {
    Write-Host "  PASS  $desc" -ForegroundColor Green
  } else {
    Write-Host "  FAIL  $desc  (missing in $file)" -ForegroundColor Red
  }
}
Write-Host "Weekly Focus - local file check"
Write-Host "--------------------------------"
foreach ($f in 'index.html','config.js','weekly-focus-app.js','weekly-focus.css','sw.js','manifest.webmanifest') {
  if (Test-Path $f) { Write-Host "  PASS  exists: $f" -ForegroundColor Green }
  else { Write-Host "  FAIL  MISSING FILE: $f" -ForegroundColor Red }
}
Write-Host ""
Chk 'config.js'           'window.WF_CONFIG'    'config.js defines WF_CONFIG'
Chk 'config.js'           'wylxvmkcrexwfpjpbhyy' 'config.js has your Supabase URL'
Chk 'index.html'          'src="config.js"'     'index.html loads config.js'
Chk 'weekly-focus-app.js' 'WF_CONFIG'           'app JS reads WF_CONFIG (cloud-first build)'
Chk 'weekly-focus-app.js' 'wireBoards'          'app JS has the boards feature'
Chk 'weekly-focus-app.js' 'function celebrate'  'app JS has confetti/animations'
Chk 'weekly-focus.css'    '.boardbtn'           'CSS has the styled board switcher'
Chk 'weekly-focus.css'    'confetti-piece'      'CSS has the confetti styles'
Write-Host ""
$v = (Select-String -Path sw.js -Pattern 'weekly-focus-v\d+').Matches.Value
Write-Host "  sw.js cache: $v   (should be weekly-focus-v15)"
Write-Host "--------------------------------"
Write-Host "Any FAIL -> re-paste that file from the app/ download and push."
Write-Host "All PASS but site still old -> it's the Service Worker cache:"
Write-Host "  F12 -> Application -> Service Workers -> Unregister -> Clear site data -> hard reload x2"
