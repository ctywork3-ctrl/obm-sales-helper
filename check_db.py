import asyncio
import asyncpg

async def check():
    try:
        conn = await asyncpg.connect("postgresql://postgres:postgres@localhost:5432/obm_sales")
        rows = await conn.fetch("SELECT username, role, is_active FROM users")
        if not rows:
            print("NO USERS FOUND in database!")
        for r in rows:
            print(f"  {r['username']:15} role={r['role']:20} active={r['is_active']}")
        await conn.close()
    except Exception as e:
        print(f"DB ERROR: {e}")

asyncio.run(check())
