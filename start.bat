@echo off
setlocal enabledelayedexpansion

set LANIP=
for /f %%a in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress" 2^>nul') do set LANIP=%%a

echo ========================================
echo  Starting OBM Sales Helper
echo ========================================
echo.
echo Backend:  http://localhost:8001
echo Frontend: http://localhost:3000
echo API Docs: http://localhost:8001/docs
if defined LANIP (
  echo.
  echo LAN access for phones or other PCs on same Wi-Fi:
  echo   Catalog:  http://!LANIP!:3000/catalog
  echo   Staff:    http://!LANIP!:3000/app/login
)
echo.

start "OBM Backend" cmd /k "title OBM Backend && cd /d F:\season takle webapp\backend && "C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"

timeout /t 3 /nobreak >nul

start "OBM Frontend" cmd /k "title OBM Frontend && cd /d F:\season takle webapp\frontend && npx vite --port 3000 --host"

echo.
echo Both servers started!
echo.
echo Catalog:       http://localhost:3000/catalog
echo Staff login:   http://localhost:3000/app/login
if defined LANIP (
  echo.
  echo ON THIS PC:    http://localhost:3000/app/login
  echo ON OTHER DEVICES - same Wi-Fi: http://!LANIP!:3000/app/login
  echo.
  echo Note: camera barcode scanning on phones needs HTTPS;
  echo       manual input works over LAN.
)
echo.
echo ========================================
echo  INTERNAL LOGIN: http://localhost:3000/app/login
echo ========================================
echo  developer     / password123  (DEVELOPER)
echo  itadmin       / password123  (IT_ADMIN)
echo  sales01       / password123  (OUTSIDE_SALES)
echo  sales02       / password123  (OUTSIDE_SALES)
echo  inside01      / password123  (INSIDE_SALES)
echo  stockkeeper01 / password123  (STOCK_KEEPER)
echo  manager01     / password123  (MANAGER)
echo.
echo  STORE LOGIN:   http://localhost:3000/login
echo ========================================
echo.
pause
