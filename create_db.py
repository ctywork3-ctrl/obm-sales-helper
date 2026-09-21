import asyncio
import asyncpg

async def create():
    try:
        conn = await asyncpg.connect("postgresql://postgres:postgres@localhost:5432/postgres")
        # Check if obm_sales exists
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = 'obm_sales'")
        if not exists:
            await conn.execute("CREATE DATABASE obm_sales")
            print("Created database 'obm_sales'")
        else:
            print("Database 'obm_sales' already exists")
        await conn.close()
    except Exception as e:
        print(f"ERROR: {e}")

asyncio.run(create())
