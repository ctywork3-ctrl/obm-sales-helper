@echo off
echo ========================================
echo  Seeding Default Users
echo ========================================
echo.
cd /d "F:\season takle webapp\backend"
"C:\Users\chiam\AppData\Local\Programs\Python\Python313\python.exe" -c "
import asyncio
from app.database import async_session
from app.seed import seed_database

async def main():
    async with async_session() as db:
        await seed_database(db)
        print('Default users seeded!')

asyncio.run(main())
"
echo.
pause
