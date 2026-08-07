@echo off
echo ========================================
echo  Creating Database Tables
echo ========================================
echo.
cd /d "F:\season takle webapp\backend"
"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -c "import asyncio; from app.database import engine, Base; import app.models; asyncio.run(engine.begin().run_sync(Base.metadata.create_all)); print('All tables created successfully!')"
echo.
pause
