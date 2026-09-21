@echo off
setlocal

set CLOUDFLARED=%LOCALAPPDATA%\Temp\cloudflared.exe
if not exist "%CLOUDFLARED%" (
  where cloudflared >nul 2>&1
  if errorlevel 1 (
    echo cloudflared.exe was not found.
    echo Expected: %LOCALAPPDATA%\Temp\cloudflared.exe
    echo Install Cloudflare Tunnel or place cloudflared.exe at that path.
    pause
    exit /b 1
  )
  set CLOUDFLARED=cloudflared
)

echo Checking local frontend...
curl.exe --fail --silent --show-error http://localhost:3000/ >nul 2>&1
if errorlevel 1 (
  echo Frontend is not reachable at http://localhost:3000
  echo Start start.bat first, then run this file again.
  pause
  exit /b 1
)

echo.
echo Local frontend is available.
echo Starting Cloudflare HTTPS tunnel to http://localhost:3000
echo.
echo Keep this window open. Cloudflare will print the phone URL below.
echo Open the fresh https URL on your phone, not the old URL.
echo Press Ctrl+C to stop the tunnel.
echo.

"%CLOUDFLARED%" tunnel --config "%~dp0cloudflared-quick.yml" --url http://localhost:3000 --no-autoupdate

echo.
echo Cloudflare tunnel stopped.
pause
