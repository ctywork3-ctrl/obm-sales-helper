@echo off
echo ========================================
echo  Starting OBM Sales Helper
echo ========================================
echo.
echo Backend:  http://localhost:8001
echo Frontend: http://localhost:3000
echo API Docs: http://localhost:8001/docs
echo.

start "OBM Backend" cmd /k "title OBM Backend && cd /d F:\season takle webapp\backend && "C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001"

timeout /t 3 /nobreak >nul

start "OBM Frontend" cmd /k "title OBM Frontend && cd /d F:\season takle webapp\frontend && npx vite --port 3000 --host"

echo.
echo Both servers started!
echo.
echo Open browser: http://localhost:3000
echo.
echo Test login:
echo   Username: sales01
echo   Password: password123
echo.
pause
