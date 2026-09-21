@echo off
setlocal enabledelayedexpansion

set LANIP=
for /f %%a in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress" 2^>nul') do set LANIP=%%a

echo ========================================
echo  Starting OBM Sales Helper - HTTPS LAN
echo ========================================
echo.
echo Frontend HTTPS: https://localhost:3000
if defined LANIP echo Phone access:    https://!LANIP!:3000/app/login
echo.
echo The first browser visit will show a local certificate warning.
echo Choose Advanced, then Continue to the site.
echo Camera permission requires this HTTPS mode on phones.
echo.

start "OBM Backend" cmd /k "title OBM Backend && cd /d F:\season takle webapp\backend && "C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"

timeout /t 3 /nobreak >nul

start "OBM Frontend HTTPS" cmd /k "title OBM Frontend HTTPS && cd /d F:\season takle webapp\frontend && set VITE_HTTPS=true && npx vite --port 3000 --host"

echo HTTPS servers started.
if defined LANIP echo Open: https://!LANIP!:3000/app/login
pause
