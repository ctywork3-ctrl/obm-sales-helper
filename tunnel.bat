@echo off
REM ============================================================
REM  Expose the app publicly with a Cloudflare quick tunnel.
REM
REM  NOTE: start-cloudflare.bat is the preferred launcher (it
REM  checks the app is up first and finds cloudflared for you).
REM  This file is the minimal one-liner version, kept because
REM  it is easy to read.
REM
REM  The tunnel points at the FRONTEND, which proxies /api to the
REM  backend - so one tunnel is enough for the whole app.
REM  You get an https://<random>.trycloudflare.com URL that works
REM  on iPhone, iPad and Android, and gives the camera the secure
REM  context it needs for barcode scanning.
REM ============================================================
setlocal
cd /d "%~dp0"

set "CLOUDFLARED=%TEMP%\cloudflared.exe"
if not exist "%CLOUDFLARED%" (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo cloudflared.exe was not found.
    echo Expected: %%TEMP%%\cloudflared.exe
    echo See start-cloudflare.bat for install notes.
    pause
    exit /b 1
  )
  set "CLOUDFLARED=cloudflared"
)

echo Checking the frontend is up on http://localhost:3000 ...
curl.exe --fail --silent --show-error http://localhost:3000/ >nul 2>&1
if errorlevel 1 (
  echo The frontend is not reachable at http://localhost:3000
  echo Start start.bat first, then run this again.
  pause
  exit /b 1
)

echo.
echo Starting tunnel. Look for the trycloudflare.com URL below.
echo The URL is DIFFERENT every time - always open the newest one on the phone.
echo Press Ctrl+C to stop.
echo.

REM --config is REQUIRED. Without it, the named-tunnel config in
REM ~/.cloudflared/config.yml takes over and silently sends traffic to
REM its own ingress (localhost:8080) instead of the port given to --url.
"%CLOUDFLARED%" tunnel --config "%~dp0cloudflared-quick.yml" --url http://localhost:3000 --no-autoupdate

echo.
echo Cloudflare tunnel stopped.
pause
