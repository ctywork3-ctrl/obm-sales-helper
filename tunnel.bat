@echo off
echo Starting Cloudflare Tunnel for OBM Sales Helper...
echo.
echo Tunnel will be available at a *.trycloudflare.com URL
echo Press Ctrl+C to stop the tunnel
echo.
echo Connecting...
%TEMP%\cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate 2>&1 | findstr "trycloudflare.com"
pause