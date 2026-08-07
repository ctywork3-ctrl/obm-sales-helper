import asyncio
from sqlalchemy import select
from app.database import async_session
from app.models.customer import Customer

async def add_walkin():
    async with async_session() as db:
        existing = await db.execute(select(Customer).where(Customer.code == "WALK-IN"))
        if existing.scalar_one_or_none():
            print("Walk-in Customer already exists")
            return
        walkin = Customer(code="WALK-IN", name="Walk-in Customer", phone="-", email="-", address="-")
        db.add(walkin)
        await db.commit()
        print("Added Walk-in Customer")

asyncio.run(add_walkin())
