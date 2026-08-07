@echo off
echo ========================================
echo  OBM Sales Helper - First Time Setup
echo ========================================
echo.

echo [1/5] Checking Python...
"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" --version
if errorlevel 1 (
    echo ERROR: Python not found
    pause
    exit /b 1
)

echo.
echo [2/5] Installing backend dependencies...
cd backend
"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install backend dependencies
    pause
    exit /b 1
)
cd ..

echo.
echo [3/5] Installing frontend dependencies (may take a few minutes)...
cd frontend
"C:\Program Files\nodejs\npm.cmd" install
if errorlevel 1 (
    echo ERROR: Failed to install frontend dependencies
    pause
    exit /b 1
)
cd ..

echo.
echo [4/5] Creating uploads directory...
if not exist "backend\uploads" mkdir backend\uploads
if not exist "backend\uploads\products" mkdir backend\uploads\products

echo.
echo [5/5] Copying .env if not exists...
if not exist "backend\.env" (
    if exist "backend\.env.example" (
        copy "backend\.env.example" "backend\.env"
        echo Created backend\.env from template - please edit it with your settings
    )
)

echo.
echo ========================================
echo  Setup Complete!
echo ========================================
echo.
echo Next steps:
echo  1. Make sure PostgreSQL is running
echo  2. Create database: salesapp
echo  3. Edit backend\.env if needed
echo  4. Run: create-db.bat
echo  5. Run: seed-users.bat
echo  6. Run: start.bat
echo.
pause
