@echo off
echo ========================================
echo  Starting Backend Only
echo ========================================
echo.
echo Backend: http://localhost:8001
echo API Docs: http://localhost:8001/docs
echo.
cd /d "F:\season takle webapp\backend"
"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
