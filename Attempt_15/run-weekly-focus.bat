@echo off
title Weekly Focus local server
REM Weekly Focus - run the app locally (no GitHub upload, no installs needed).
REM Put this file in your repo root (next to the "app" folder... or next to
REM index.html if your files are in the root) and double-click.
REM Leave this window open while testing. Close it to stop the server.
cd /d "%~dp0"

REM Serve from the "app" subfolder if it exists, else the current folder.
set "ROOT=."
if exist "app\index.html" set "ROOT=app"

echo.
echo   Weekly Focus - local server
echo   Serving folder: %ROOT%
echo   Open:  http://localhost:5173/
echo   (Close this window to stop.)
echo.

REM Try Python 3, then the old "python -m SimpleHTTPServer", then Node's npx serve.
where python >nul 2>nul && (
  python -m http.server 5173 --directory "%ROOT%"
  goto :eof
)
where py >nul 2>nul && (
  py -m http.server 5173 --directory "%ROOT%"
  goto :eof
)
where npx >nul 2>nul && (
  npx --yes serve "%ROOT%" -l 5173
  goto :eof
)

echo Could not find Python or Node. Install Python from python.org, then double-click this again.
pause
